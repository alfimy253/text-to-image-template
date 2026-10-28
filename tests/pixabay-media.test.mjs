import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { searchPixabay, downloadPixabay, sceneSearchToken, PixabayRateLimiter, handlePixabayApi } from '../src/modules/pixabay.ts';
import { generateImagePrompts, handleGenerateImagePrompts } from '../src/modules/image-prompts.ts';
import { handleImageBinary, handleImageBatch, runImageModel, IMAGE_FALLBACK_MODELS } from '../src/modules/image-batch.ts';
import workerModule from '../src/index.ts';
const worker = workerModule.default || workerModule;

globalThis.crypto ||= webcrypto;
const png = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
let key = 0;
const env = () => ({ PIXABAY_API_KEY: 'test-key-' + ++key, AI: { run() { throw new Error('AI MUST NOT RUN'); } } });
const credits = { consume: async n => ({ allowed: true, granted: n }), refund: async () => null };
const post = (path, body) => new Request('https://studio.test' + path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
function photo(id) { return { id, pageURL: 'https://pixabay.com/photos/id-' + id + '/', user: 'Artist', tags: 'yellow flowers', largeImageURL: 'https://cdn.pixabay.com/photo/' + id + '.png', previewURL: 'https://cdn.pixabay.com/photo/' + id + '_150.png', imageWidth: 1280, imageHeight: 720 }; }
function fixture(t, options = {}) {
	const native = globalThis.fetch; const calls = [];
	globalThis.fetch = async (input, init = {}) => {
		const url = new URL(String(input)); calls.push({ url, init });
		if (url.pathname.startsWith('/api/')) {
			if (options.error) return new Response('secret provider diagnostic', { status: options.error, headers: { 'X-RateLimit-Reset': '60' } });
			if (url.pathname.includes('videos')) return Response.json({ totalHits: 3, hits: [7,8,9].map(id => ({ id, pageURL: 'https://pixabay.com/videos/id-' + id + '/', user: 'Artist', duration: options.duration || 12, videos: { small: { url: 'https://cdn.pixabay.com/video/7.mp4', thumbnail: 'https://cdn.pixabay.com/video/7.jpg', width: 1280, height: 720, size: 1024 } } })) });
			const id = Number(url.searchParams.get('id'));
			return Response.json({ totalHits: options.empty ? 0 : 100, hits: options.empty ? [] : id ? [photo(id)] : [photo(1), photo(2), photo(3), photo(4)] });
		}
		if (options.redirect) return new Response(null, { status: 302, headers: { Location: 'https://evil.test/private' } });
		if (url.pathname.endsWith('.mp4')) return new Response(Uint8Array.from([0,0,0,24,102,116,121,112,105,115,111,109]), { headers: { 'Content-Type': 'video/mp4' } });
		return new Response(options.invalid ? 'not an image' : png, { headers: { 'Content-Type': options.mime || 'image/png', ...(options.large ? { 'Content-Length': '999999999' } : {}) } });
	};
	t.after(() => { globalThis.fetch = native; });
	return calls;
}

test('Pixabay search encodes q, fixes per_page=3, photo+safesearch, and truncates hits', async t => {
	const calls = fixture(t); const result = await searchPixabay(env(), { q: 'yellow flowers & sun', per_page: 3 });
	assert.equal(result.hits.length, 3); assert.equal(result.provider, 'pixabay');
	assert.equal(calls[0].url.searchParams.get('per_page'), '3');
	assert.equal(calls[0].url.searchParams.get('q'), 'yellow flowers & sun');
	assert.equal(calls[0].url.searchParams.get('image_type'), 'photo');
	assert.equal(calls[0].url.searchParams.get('safesearch'), 'true');
	assert.ok(!JSON.stringify(result).includes('test-key'));
});
test('search rejects non-three page sizes, invalid type/page/id and empty queries', async () => {
	for (const input of [{ q: 'rose', per_page: 20 }, { q: 'rose', page: 0 }, { q: 'rose', type: 'other' }, { id: -1 }, {}]) {
		await assert.rejects(searchPixabay(env(), input), e => e.status === 400);
	}
});
test('identical concurrent/repeated searches share one 24-hour cached request', async t => {
	const calls = fixture(t); const e = env();
	await Promise.all(Array.from({ length: 3 }, () => searchPixabay(e, { q: 'yellow flowers', per_page: 3 })));
	await searchPixabay(e, { q: 'yellow flowers', per_page: 3 });
	assert.equal(calls.length, 1);
});
test('LLM scene planner reads the entire script and assigns exactly two stock video scenes', async () => {
	const instructions = [];
	const planner = { AI: { run: async (model, input) => {
		assert.equal(model, 'text-planner'); instructions.push(input.prompt);
		const slots = JSON.parse(input.prompt.match(/Requested slots of \d+ total: ([^\n]+)/)[1]);
		return { response: { scenes: slots.map(slot => ({ type: slot.type, keywords: 'garden flowers ' + slot.scene })) } };
	} } };
	const script = 'OPENING context. MIDDLE important conservation idea. ENDING conclusion.';
	const input = { topic: 'yellow flowers', script, minutes: 1, style: 'Cinematic Film' };
	const tokens = await generateImagePrompts(planner, 'text-planner', input);
	const scenes = tokens.map(token => JSON.parse(token.slice(8)));
	assert.equal(scenes.length, 10); assert.equal(scenes.filter(s => s.type === 'video').length, 2);
	assert.deepEqual(scenes.filter(s => s.type === 'video').map(s => s.scene), [1,8]);
	assert.ok(instructions[0].includes(script)); assert.match(instructions[0], /general idea of the entire script/);
	assert.match(instructions[0], /exactly TWO Pixabay VIDEO/);
	const partial = await generateImagePrompts(planner, 'text-planner', { ...input, batch: { offset: 6, count: 3 } });
	assert.deepEqual(partial, tokens.slice(6,9));
	const response = await handleGenerateImagePrompts(post('/api/image-prompts', { ...input, scriptIdea: 'not the script' }), planner, 'text-planner');
	assert.equal(response.status, 200); assert.equal((await response.json()).model, 'text-planner');
	assert.ok(instructions.at(-1).includes(script), 'full script wins over compact summary');
});
test('legacy model entrypoint downloads a selected Pixabay image and has no fallback models', async t => {
	const calls = fixture(t); const data = await runImageModel(env(), sceneSearchToken('yellow flowers', 1));
	assert.deepEqual(data.bytes, png); assert.equal(data.mime, 'image/png'); assert.deepEqual(IMAGE_FALLBACK_MODELS, []);
	assert.equal(calls[1].url.pathname, '/photo/2.png');
});
test('binary image route returns bytes accepted by both existing layouts', async t => {
	fixture(t); const response = await handleImageBinary(post('/api/image', { prompt: sceneSearchToken('flowers', 0) }), env(), credits);
	assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'image/png');
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
});
test('legacy NDJSON route delivers all three scenes with a single search', async t => {
	const calls = fixture(t); const prompts = [0,1,2].map(i => sceneSearchToken('flowers', i));
	const response = await handleImageBatch(post('/api/image-batch', { prompts }), env(), credits, { waveIntervalMs: 0 });
	const events = (await response.text()).trim().split('\n').map(JSON.parse);
	const images = events.filter(e => e.type === 'image' && e.ok);
	assert.equal(images.length, 3); assert.deepEqual(images.map(e => e.index).sort(), [0,1,2]);
	assert.equal(events.at(-1).generated, 3); assert.equal(calls.filter(c => c.url.pathname === '/api/').length, 1);
});
test('video search and same-origin server import support MP4 without permanent hotlinking', async t => {
	const calls = fixture(t); const e = env();
	const result = await searchPixabay(e, { q: 'flowers', type: 'video', per_page: 3 });
	assert.equal(result.hits[0].duration, 12); assert.equal(calls[0].url.pathname, '/api/videos/');
	const response = await handlePixabayApi(new Request('https://studio.test/api/media/asset?type=video&id=7&per_page=3'), e);
	assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'video/mp4');
});
test('clips longer than the editor 60-second cap are excluded', async t => {
	fixture(t, { duration: 61 }); const result = await searchPixabay(env(), { q: 'flowers', type: 'video', per_page: 3 });
	assert.equal(result.hits.length, 0);
});
test('missing credentials fail clearly, without any AI fallback', async () => {
	const response = await handleImageBinary(post('/api/image', { prompt: 'flowers' }), { AI: { run() { assert.fail('no AI'); } } }, credits);
	assert.equal(response.status, 503); assert.match(await response.text(), /Pixabay API key/);
});
for (const [name, options] of [['invalid signature', { invalid: true }], ['oversize response', { large: true }], ['HTML MIME', { mime: 'text/html' }], ['foreign redirect', { redirect: true }]]) {
	test('download rejects ' + name, async t => {
		fixture(t, options); await assert.rejects(downloadPixabay({ id: 99, type: 'image', url: 'https://cdn.pixabay.com/photo/99.png' }));
	});
}
test('untrusted URL cannot turn import into an SSRF proxy', async () => {
	await assert.rejects(downloadPixabay({ id: 1, type: 'image', url: 'http://127.0.0.1/private' }), /Invalid Pixabay asset/);
});
test('429 cooldown is honored and provider error details/credentials are not leaked', async t => {
	const calls = fixture(t, { error: 429 }); const e = env();
	await assert.rejects(searchPixabay(e, { q: 'flowers' }), error => error.status === 429 && error.retryAfter > 0 && !error.message.includes('secret'));
	await assert.rejects(searchPixabay(e, { q: 'trees' }), error => error.status === 429);
	assert.equal(calls.length, 1);
});
test('no results are explicit and never invoke AI', async t => {
	fixture(t, { empty: true }); await assert.rejects(runImageModel(env(), sceneSearchToken('nothing', 0)), /No suitable Pixabay media/);
});
test('cancelled downloads never start', async t => {
	const calls = fixture(t); const controller = new AbortController(); controller.abort();
	await assert.rejects(downloadPixabay({ id: 1, type: 'image', url: 'https://cdn.pixabay.com/photo/1.png' }, controller.signal), error => error.name === 'AbortError');
	assert.equal(calls.length, 0);
});
test('Durable Object budget enforces 90 provider requests per minute and shared cooldown', async () => {
	const values = new Map();
	const storage = { get: async k => values.get(k), put: async (k,v) => values.set(k,v) };
	storage.transaction = fn => fn(storage);
	const limiter = new PixabayRateLimiter({ storage });
	for (let i=0;i<90;i++) assert.equal((await limiter.fetch(new Request('https://budget/take'))).status, 200);
	const blocked = await limiter.fetch(new Request('https://budget/take'));
	assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
	await limiter.fetch(new Request('https://budget/cooldown', { method: 'POST', body: '90' }));
	assert.ok(Number((await limiter.fetch(new Request('https://budget/take'))).headers.get('Retry-After')) >= 89);
});
test('worker demo image route is retired; capabilities expose Pixabay', async () => {
	assert.equal((await worker.fetch(new Request('https://studio.test/image/0'), env(), {})).status, 410);
	const caps = await worker.fetch(new Request('https://studio.test/api/pipeline-capabilities'), env(), {});
	assert.equal((await caps.json()).mediaProvider, 'pixabay');
});

test('relay runtime refuses SDXL, FLUX and Qwen image inference before contacting providers', async () => {
	const { createRelayRuntime } = await import('../src/modules/api-relay.ts');
	let calls = 0;
	const runtime = createRelayRuntime({ AI: { run() { calls++; } } });
	for (const model of ['@cf/stabilityai/stable-diffusion-xl-base-1.0', '@cf/black-forest-labs/flux-1-schnell', '@cf/qwen/qwen-image']) {
		await assert.rejects(runtime.ai.run(model, { prompt: 'flowers' }), /disabled/);
	}
	assert.equal(calls, 0);
});
test('public media routes fail closed without authorization storage unless local opt-out is explicit', async t => {
	fixture(t); const e = env();
	const request = new Request('https://studio.test/api/media/search?q=flowers&per_page=3');
	assert.equal((await worker.fetch(request, e, {})).status, 503);
	const allowed = await worker.fetch(request, { ...e, PIXABAY_ALLOW_UNMETERED: 'true' }, {});
	assert.equal(allowed.status, 200); assert.equal((await allowed.json()).hits.length, 3);
});
test('no-result binary images are permanent failures, not retry storms', async t => {
	const calls = fixture(t, { empty: true });
	const response = await handleImageBinary(post('/api/image', { prompt: sceneSearchToken('nothing', 0) }), env(), credits);
	assert.equal(response.status, 422); assert.equal((await response.json()).kind, 'fatal');
	assert.equal(calls.length, 1);
});

test('scene planner enforces two videos across all durations and across batch boundaries', async () => {
	for (const [minutes,total] of [[1,10],[3,14],[6,20]]) {
		const calls = [];
		const planner = { AI: { async run(model, input) {
			calls.push(input.prompt);
			const slots = JSON.parse(input.prompt.match(/Requested slots of \d+ total: ([^\n]+)/)[1]);
			return { response: JSON.stringify({ scenes: slots.map(s => ({ type: s.type, keywords: 'forest community ' + s.scene })) }) };
		} } };
		const tokens = [];
		for (let offset=0;offset<total;offset+=3) tokens.push(...await generateImagePrompts(planner, 'text-only', {
			topic:'forest community', script:'Beginning. THE WHOLE MIDDLE IDEA. Conclusion.', minutes,
			batch:{offset,count:Math.min(3,total-offset),previous:tokens.slice(-4)}
		}));
		assert.equal(tokens.map(s => JSON.parse(s.slice(8))).filter(s => s.type === 'video').length,2);
		assert.ok(calls.every(prompt => prompt.includes('THE WHOLE MIDDLE IDEA')));
	}
});
test('planner rejects wrong types, prose prompts, missing scenes and malformed JSON', async () => {
	const input={topic:'forest',script:'Forest conservation.',minutes:1,batch:{offset:0,count:3}};
	for (const response of ['oops', JSON.stringify({scenes:[]}), JSON.stringify({scenes:[0,1,2].map(() => ({type:'image',keywords:'forest'}))}),
		JSON.stringify({scenes:[{type:'image',keywords:'a long paragraph with far too many words describing a picture'},{type:'video',keywords:'forest'},{type:'image',keywords:'nature'}]})]) {
		await assert.rejects(generateImagePrompts({AI:{run:async()=>({response})}},'text',input), /planner/);
	}
});
test('scene video token returns MP4 bytes with source metadata over binary transport', async t => {
	fixture(t); const token='pixabay:'+JSON.stringify({q:'flowers',type:'video',page:1,index:0,scene:1});
	const response=await handleImageBinary(post('/api/image',{prompt:token}),env(),credits);
	assert.equal(response.status,200); assert.equal(response.headers.get('Content-Type'),'video/mp4');
	const source=JSON.parse(decodeURIComponent(response.headers.get('X-Pixabay-Source')));
	assert.equal(source.type,'video'); assert.equal(source.duration,12);
});
test('NDJSON media stream supports a planned photo and both required video clips', async t => {
	fixture(t); const prompts=['image','video','video'].map((type,i)=>'pixabay:'+JSON.stringify({q:'flowers',type,page:1,index:type==='video'?i-1:0,scene:i}));
	const response=await handleImageBatch(post('/api/image-batch',{prompts}),env(),credits,{waveIntervalMs:0});
	const events=(await response.text()).trim().split('\n').map(JSON.parse);
	const media=events.filter(e=>e.type==='image'&&e.ok);
	assert.equal(media.length,3); assert.equal(media.filter(e=>e.mime==='video/mp4').length,2);
});
test('planner uses full script before scriptIdea and rejects over-limit scripts without silent truncation', async () => {
	const response=await handleGenerateImagePrompts(post('/api/image-prompts',{topic:'forest',script:'x'.repeat(20001),minutes:1}),{},'text');
	assert.equal(response.status,400); assert.match(await response.text(),/20,000/);
});

async function promptly(promise, ms = 500) {
 let timer;
 try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('operation hung')),ms)})]); }
 finally {clearTimeout(timer);}
}
test('a cancelled queued download returns promptly without letting successors overtake the active download', async t => {
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native});
 let started;const active=new Promise(r=>{started=r});let calls=0;
 globalThis.fetch=async()=>{calls++;started();return calls===1?new Response(new ReadableStream({start(c){c.enqueue(png)},cancel(){return new Promise(()=>{})}}),{headers:{'Content-Type':'image/png'}}):new Response(png,{headers:{'Content-Type':'image/png'}})};
 const hit={id:500,type:'image',url:'https://cdn.pixabay.com/photo/500.png'};
 const firstControl=new AbortController(),queuedControl=new AbortController();
 const first=downloadPixabay(hit,firstControl.signal);const firstError=assert.rejects(first,e=>e.name==='AbortError');
 await active;
 const queued=downloadPixabay(hit,queuedControl.signal);queuedControl.abort();
 await promptly(assert.rejects(queued,e=>e.name==='AbortError'));
 const next=downloadPixabay(hit);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 firstControl.abort();await promptly(firstError);assert.deepEqual((await promptly(next)).bytes,png);assert.equal(calls,2);
});
test('a stalled response body AND stalled cancel() cannot keep the download queue locked', async t => {
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native});
 let signalStarted;const started=new Promise(r=>{signalStarted=r});let calls=0;
 globalThis.fetch=async()=>{calls++;signalStarted();return new Response(calls===1?new ReadableStream({cancel(){return new Promise(()=>{})}}):png,{headers:{'Content-Type':'image/png'}})};
 const control=new AbortController(),hit={id:501,type:'image',url:'https://cdn.pixabay.com/photo/501.png'};
 const failure=assert.rejects(downloadPixabay(hit,control.signal),e=>e.name==='AbortError');
 await started;control.abort();await promptly(failure);
 assert.deepEqual((await promptly(downloadPixabay(hit))).bytes,png);
});
test('oversize response with an unresponsive cancel() is rejected promptly', async t => {
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native});
 globalThis.fetch=async()=>new Response(new ReadableStream({cancel(){return new Promise(()=>{})}}),{headers:{'Content-Type':'image/png','Content-Length':'999999999'}});
 await promptly(assert.rejects(downloadPixabay({id:502,type:'image',url:'https://cdn.pixabay.com/photo/502.png'}),e=>e.status===413));
});
test('cancelling one metadata subscriber preserves the coalesced request for other callers', async t => {
 const native=globalThis.fetch;t.after(()=>{globalThis.fetch=native});
 let finish,notify;const started=new Promise(r=>{notify=r});let calls=0;
 globalThis.fetch=async()=>{calls++;notify();return new Promise(r=>{finish=r})};
 const e=env(),control=new AbortController(),input={q:'coalesced cancellation unique'};
 const first=assert.rejects(searchPixabay(e,input,control.signal),e=>e.name==='AbortError');
 await started;const second=searchPixabay(e,input);await new Promise(r=>setImmediate(r));
 control.abort();await promptly(first);
 const third=searchPixabay(e,input);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 finish(Response.json({hits:[photo(1)],totalHits:1}));
 assert.equal((await promptly(second)).hits.length,1);assert.equal((await promptly(third)).hits.length,1);assert.equal(calls,1);
});
test('cache write errors do not fail a valid provider download or metadata search', async t => {
 fixture(t);const previous=globalThis.caches;t.after(()=>{globalThis.caches=previous});
 globalThis.caches={default:{match:async()=>undefined,put:async()=>{throw new Error('cache unavailable')}}};
 assert.equal((await searchPixabay(env(),{q:'cache failure unique'})).hits.length,3);
 assert.deepEqual((await downloadPixabay({id:503,type:'image',url:'https://cdn.pixabay.com/photo/503.png'})).bytes,png);
});
test('an unresponsive cache write is bounded and releases the download queue', async t => {
 fixture(t);const previous=globalThis.caches;t.after(()=>{globalThis.caches=previous});
 globalThis.caches={default:{match:async()=>undefined,put:()=>new Promise(()=>{})}};
 assert.deepEqual((await promptly(downloadPixabay({id:504,type:'image',url:'https://cdn.pixabay.com/photo/504.png'}),3000)).bytes,png);
});
