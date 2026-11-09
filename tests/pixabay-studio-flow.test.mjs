import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { harness } from './studio-render-harness.mjs';
import { handleGenerateImagePrompts } from '../src/modules/image-prompts.ts';
import { handleImageBinary, handleImageBatch } from '../src/modules/image-batch.ts';
import { handlePixabayApi } from '../src/modules/pixabay.ts';
globalThis.crypto ||= webcrypto;
const png = Uint8Array.from([137,80,78,71,13,10,26,10,1,2,3,4]);
let sequence = 0;
function setup(t, options = {}) {
	const app = harness(); const { w } = app;
	t.after(() => w.close());
	const native = globalThis.fetch; const calls = [];
	const plannerCalls = [];
	const env = { PIXABAY_API_KEY: 'browser-fixture-' + ++sequence, AI: { async run(model, input) {
		assert.equal(model, 'text-planner'); plannerCalls.push(input.prompt);
		const slots = JSON.parse(input.prompt.match(/Requested slots of \d+ total: ([^\n]+)/)[1]);
		return { response: { scenes: slots.map(slot => ({ type: slot.type, keywords: 'garden flowers ' + slot.scene })) } };
	} } };
	globalThis.fetch = async (input) => {
		const url = new URL(String(input)); calls.push(url);
		if (url.pathname.startsWith('/api/')) {
			const ids = url.searchParams.has('id') ? [Number(url.searchParams.get('id'))] : Array.from({ length: 12 }, (_, i) => (Number(url.searchParams.get('page') || 1) - 1) * 12 + i + 1);
			const video = url.pathname.includes('videos');
			return Response.json({ totalHits: 100, hits: ids.map(id => ({ id, pageURL: `https://pixabay.com/${video ? 'videos' : 'photos'}/id-${id}/`, user: 'Artist', tags: 'flowers',
				largeImageURL: `https://cdn.pixabay.com/photo/${id}.png`, previewURL: `https://cdn.pixabay.com/photo/${id}_150.png`, imageWidth: 1280, imageHeight: 720,
				duration: 2, videos: { small: { url: `https://cdn.pixabay.com/video/${id}.mp4`, thumbnail: `https://cdn.pixabay.com/video/${id}.jpg`, width: 1280, height: 720, size: 12 } }
			})) });
		}
		return url.pathname.endsWith('.mp4')
			? new Response(Uint8Array.from([0,0,0,24,102,116,121,112,105,115,111,109]), { headers: { 'Content-Type': 'video/mp4' } })
			: new Response(png, { headers: { 'Content-Type': 'image/png' } });
	};
	t.after(() => { globalThis.fetch = native; });
	const previous = w.fetch;
	const credit = { consume: async n => ({ allowed: true, granted: n }), refund: async () => null };
	w.Blob = Blob;
	w.AudioContext = class {
		constructor() { this.state = 'running'; }
		decodeAudioData() { return Promise.resolve({ duration: 1, sampleRate: 8000, length: 8000, numberOfChannels: 1, getChannelData: () => new Float32Array(8000) }); }
	};
	// Upload/probe events at the browser edge; the real import and renderer code still runs.
	w.HTMLMediaElement.prototype.load = function () { queueMicrotask(() => this.dispatchEvent(new w.Event('loadedmetadata'))); };
	const srcDescriptor = Object.getOwnPropertyDescriptor(w.HTMLMediaElement.prototype, 'src');
	Object.defineProperty(w.HTMLMediaElement.prototype, 'src', {
		configurable: true, get() { return srcDescriptor.get.call(this); },
		set(value) { srcDescriptor.set.call(this, value); queueMicrotask(() => this.dispatchEvent(new w.Event('loadedmetadata'))); }
	});
	w.fetch = async (input, init = {}) => {
		const url = new URL(String(input), 'https://studio.test');
		const request = new Request(url, { ...init, signal: undefined });
		if (url.pathname === '/api/pipeline-capabilities') return Response.json({ version: 261, binaryImages: options.binaryImages !== false, compactPrompts: true, imageChunks: 2, imageSlots: 6, mediaProvider: 'pixabay' });
		if (url.pathname === '/api/image-prompts') return handleGenerateImagePrompts(request, env, 'text-planner');
		if (url.pathname === '/api/image') return handleImageBinary(request, env, credit);
		if (url.pathname === '/api/image-batch') return handleImageBatch(request, env, credit, {waveIntervalMs:0});
		if (url.pathname.startsWith('/api/media/')) return handlePixabayApi(request, env);
		if (url.pathname === '/api/voiceover') return new Response(Uint8Array.from([255,251,144,100,1,2]), { headers: { 'Content-Type': 'audio/mpeg' } });
		return previous(input, init);
	};
	return { ...app, calls, plannerCalls };
}
async function deadline(promise, milliseconds = 20000) {
	let timer;
	try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('flow deadline exceeded')), milliseconds); })]); }
	finally { clearTimeout(timer); }
}

test('Quick Batch recreates Pixabay search -> image imports -> slides -> Actions -> browser MP4', async t => {
	const { w, calls, stats } = setup(t);
	while (w.__BATCH_ROWS.length) w.removeBatchRow(w.__BATCH_ROWS[0].id);
	const row = w.addBatchRow({ script: 'Yellow flowers in the garden.', minutes: 1, orientation: 'portrait', resolution: 720 });
	await deadline(w.runBatchRow(row));
	assert.equal(w.batchRowFinished(row), true);
	/* FINAL MEDIA CAP: every script length plans 12 scenes (8 photos + 4 clips). */
	assert.equal(row.images.length, 12); assert.equal(row.slides.length, 12);
	assert.equal(row.slides.filter(s => s.type === 'mp4').length, 4);
	assert.equal(row.slides.reduce((frames, slide) => frames + Math.round(slide._partialSec * 30), 0), 30, 'both clips fit within the 1s test narration');
	assert.ok(row.prompts.every(p => p.startsWith('pixabay:')));
	const element = w.document.querySelector(`[data-batch-row="${row.id}"]`);
	assert.ok(element.querySelector('[data-batch-action="preview"]'));
	assert.ok(element.querySelector('[data-batch-action="export"]'));
	assert.ok(element.querySelector('[data-batch-action="edit"]'));
	assert.ok(calls.filter(u => u.pathname === '/api/').every(u => u.searchParams.get('per_page') === '12'));
	await deadline(w.exportBatchRow(row.id));
	assert.ok(stats().encoded > 0, 'shared VideoEncoder was exercised');
	assert.ok(stats().frameDurations.every(d=>d===33333), 'muxer must retain the last frame duration');
	assert.ok(w.__lastRenderBlob?.size > 0, 'mocked muxer output reaches the download path');
});

test('editor accordion removes the manual image prompt/search panel but retains media gallery and uploads', t => {
	const { w } = setup(t); w.addVideoAccordion();
	for (const id of ['va-ai-prompt-1', 'va-ai-btn-1', 'va-stock-type-1', 'va-ai-results-1']) assert.equal(w.document.getElementById(id), null);
	assert.ok(w.document.getElementById('va-gallery-1'));
	assert.ok(w.document.getElementById('va-upload-btn-1'));
	assert.ok(w.document.getElementById('va-ai-status-1'));
});

test('editor automatic LLM-keyword flow imports eight photos and four videos in scene order, then exports', async t => {
	const { w, stats, plannerCalls } = setup(t); w.addVideoAccordion(); const project = w.__VIDEO_PROJECTS[0];
	project.script = 'Opening flowers. Entire middle gardening idea. Closing garden.';
	project._seoTopic = 'yellow flowers'; project._seoMinutes = 1; project._imageFlowActive = true;
	project.selectedSeoSet = { longTail: 'yellow flowers', short: ['garden', 'flowers', 'yellow', 'plants'] };
	await deadline(w.startImagePromptFlow(1));
	assert.equal(project.assets.length, 12);
	assert.equal(project.aiImagesDone, 12);
	assert.ok(project.assets.every(a => a.stockSource?.provider === 'pixabay'));
	assert.equal(project._imageFlowActive, false);
	assert.equal(project.assets.filter(a => a.kind === 'mp4').length, 4);
	assert.deepEqual(Array.from(project.assets, a => a.sceneIndex), Array.from({ length: 12 }, (_, i) => i));
	assert.ok(plannerCalls.every(prompt => prompt.includes(project.script)));
	await deadline(w.runGenerationQueue());
	assert.equal(project.status, 'done'); assert.ok(stats().encoded > 0);
});

test('rerunning editor planning replaces prior automatic media rather than accumulating twelve scenes', async t => {
	const {w}=setup(t); w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[0];
	project.script='Gardens and flowers bring communities together.'; project._seoTopic='garden'; project._seoMinutes=1;
	project._imageFlowActive=true; await deadline(w.startImagePromptFlow(1));
	const prior=project.assets.map(a=>a.url);
	project._imageFlowActive=true; await deadline(w.startImagePromptFlow(1));
	assert.equal(project.assets.length,12); assert.equal(project.assets.filter(a=>a.kind==='mp4').length,4);
	assert.ok(project.assets.every(a=>!prior.includes(a.url)));
});
test('planned editor export refuses a missing required clip instead of silently making a photo-only video', async t => {
	const {w}=setup(t); w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[0];
	project.script='Garden conservation.'; project._seoTopic='garden'; project._seoMinutes=1;
	project._imageFlowActive=true; await deadline(w.startImagePromptFlow(1));
	const clip=project.assets.find(a=>a.kind==='mp4'); project.assets=project.assets.filter(a=>a!==clip);
	await deadline(w.runGenerationQueue());
	assert.equal(project.status,'error');
});

test('legacy NDJSON editor delivery also probes four clips and restores planned scene order', async t => {
	const {w}=setup(t,{binaryImages:false}); w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[0];
	project.script='Gardening connects the whole community.'; project._seoTopic='garden'; project._seoMinutes=1;
	project._imageFlowActive=true; await deadline(w.startImagePromptFlow(1));
	assert.equal(project.assets.length,12); assert.equal(project.assets.filter(a=>a.kind==='mp4').length,4);
	assert.deepEqual(Array.from(project.assets,a=>a.sceneIndex),Array.from({length:12},(_,i)=>i));
});

function audioBufferFixture(){return {sampleRate:8000,numberOfChannels:1,length:1024,getChannelData:()=>new Float32Array(1024)}}
test('a stuck audio encoder queue fails within its deadline and closes the encoder', async t=>{
 const {w}=harness();t.after(()=>w.close());let closed=false;
 let clock=0;w.Date.now=()=>{clock+=8000;return clock};
 w.AudioEncoder=class {constructor(){this.state='unconfigured';this.encodeQueueSize=0}configure(){this.state='configured'}encode(){this.encodeQueueSize=99}close(){closed=true;this.state='closed'}};
 await assert.rejects(w.encodeAudioTrack(audioBufferFixture(),1,64000),/audio encoder stopped accepting/);assert.equal(closed,true);
});
test('a never-settling audio flush is bounded and closes its encoder', async t=>{
 const {w}=harness();t.after(()=>w.close());let closed=false;
 const native=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>native(fn,ms===30000?2:ms,...args);
 w.AudioEncoder=class {constructor(){this.state='unconfigured';this.encodeQueueSize=0}configure(){this.state='configured'}encode(){}flush(){return new Promise(()=>{})}close(){closed=true;this.state='closed'}};
 await assert.rejects(w.encodeAudioTrack(audioBufferFixture(),0.1,64000),/Finalizing audio took longer/);assert.equal(closed,true);
});
test('unsupported audio configuration still closes the created encoder', async t=>{
 const {w}=harness();t.after(()=>w.close());let closed=false;
 w.AudioEncoder=class {constructor(){this.state='unconfigured'}configure(){throw new Error('unsupported codec')}close(){closed=true;this.state='closed'}};
 await assert.rejects(w.encodeAudioTrack(audioBufferFixture(),0.1,64000),/unsupported codec/);assert.equal(closed,true);
});
test('Quick Batch keeps delivered media and does not mark a partial 12-scene plan complete', async t => {
	const { w } = setup(t);
	while (w.__BATCH_ROWS.length) w.removeBatchRow(w.__BATCH_ROWS[0].id);
	const row = w.addBatchRow({ script: 'Short garden flowers connect neighbors.', minutes: 1 });
	const nativeFetch = w.fetch;
	let injectFailure = true;
	let simulatedFailures = 0;
	w.fetch = async (input, init = {}) => {
		const url = new URL(String(input), 'https://studio.test');
		if (url.pathname === '/api/image' || url.pathname === '/api/image-batch') {
			const body = JSON.parse(String(init.body || '{}'));
			/* Session 331: scene 0 is addressed by its own token, not by a model keyword. */
			let scene = null;
			try { scene = JSON.parse(String(body.prompt || '').slice(8)).scene; } catch (_) { scene = null; }
			if (injectFailure && scene === 0) {
				simulatedFailures++;
				return Response.json({ error: 'Pixabay search is unavailable (TypeError: simulated redirect failure)', kind: 'transient', requestId: 'simulated-table-search-failure' }, { status: 502 });
			}
		}
		return nativeFetch(input, init);
	};

	await deadline(w.runBatchRow(row), 30000);
	/* FINAL RULE: only the individually failed scene is retried seven times.
	 * The other eleven successful imports, object URLs and filenames stay put. */
	assert.equal(simulatedFailures, 8, 'one initial item pass plus seven individual retries');
	assert.equal(row.images.length, 11, 'successful media is never reset by a failed item retry');
	assert.equal(w.batchRowFinished(row), false, 'one missing scene cannot enable the Actions buttons');
	assert.equal(row.stage, 'ready');
	assert.equal(row.error, '');

	/* Quick Batch has no scene-only retry control. Generate reruns the
	 * unfinished row; after the simulated outage clears it must complete. */
	injectFailure = false;
	w.document.querySelector('[data-layout="table"]').click();
	w.document.getElementById('top-generate').click();
	await deadline((async () => {
		while (!w.batchRowFinished(row)) await new Promise(resolve => setTimeout(resolve, 10));
	})(), 30000);
	assert.equal(w.batchRowFinished(row), true);
	assert.equal(row.images.length, 12);
});

test('Quick Batch refuses an undecodable photo instead of marking the row ready', async t=>{
 const {w}=harness();t.after(()=>w.close());w.Image.prototype.decode=()=>Promise.reject(new Error('bad image'));
 const row={id:1,audio:{duration:1}};
 await assert.rejects(w.buildBatchSlides(row,[{blob:new Blob(['bad'],{type:'image/jpeg'}),url:'blob:broken'}]),/could not be decoded/);
});

test('a clip whose play() never settles falls back to seek capture instead of hanging',async t=>{
 const {w}=harness();t.after(()=>w.close());
 const native=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>native(fn,ms===5000?2:ms,...args);
 const video=w.document.createElement('video');Object.defineProperty(video,'videoWidth',{value:640});Object.defineProperty(video,'videoHeight',{value:360});video.play=()=>new Promise(()=>{});
 assert.equal(await deadline(w.prepareClip(video),1000),true);
});
test('editor preparation rejects a photo decode that never settles',async t=>{
 const {w}=harness();t.after(()=>w.close());w.addVideoAccordion();
 const native=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>native(fn,ms===10000?2:ms,...args);
 w.Image.prototype.decode=()=>new Promise(()=>{});
 w.__VIDEO_PROJECTS[0].assets.push({kind:'image',url:'blob:stalled'});
 await assert.rejects(deadline(w.prepareVideo(1),1000),/Editor photo decoding timed out/);
});

test('the worker ladder recovers from a transient empty planner reply (Session 331: the script plan needs no model)', async t => {
	const { w } = setup(t);
	let firstChunkCalls = 0;
	const flakyEnv = {
		PIXABAY_API_KEY: 'px-retry-key',
		AI: {
			run: async (_m, input) => {
				const slots = JSON.parse(input.prompt.match(/Requested slots of \d+ total: ([^\n]+)/)[1]);
				if (slots[0].scene === 0) {
					firstChunkCalls += 1;
					if (firstChunkCalls === 1) {
						/* Simulate an 8B model returning no usable scene at all on attempt 0. */
						return { response: JSON.stringify({ scenes: [] }) };
					}
				}
				return { response: JSON.stringify({
					scenes: slots.map((s) => ({ scene: s.scene, type: s.type, keywords: `garden scene ${s.scene}` }))
				}) };
			}
		}
	};
	const response = await handleGenerateImagePrompts(new Request('https://studio.test/api/image-prompts', {
		method: 'POST',
		body: JSON.stringify({
			topic: 'garden', minutes: 1, style: 'Documentary',
			script: 'Grow fresh food together in a sunny neighborhood garden.',
			sceneTotal: 12,
			batch: { offset: 0, count: 3, total: 12, attempt: 0, previous: [] }
		})
	}), flakyEnv, 'text-planner');
	assert.equal(response.status, 200, 'the ladder answers instead of failing the request');
	const data = await response.json();
	assert.equal(data.success, true);
	assert.equal(data.prompts.length, 3);
	assert.equal(firstChunkCalls, 2, 'chunk 0 fails once and succeeds on the worker ladder');
	assert.equal(data.attempts, 2, 'the failed reply cost one extra attempt inside the same request');
});

test('a missing Pixabay API key reports the real configuration error, not a fake "server busy, then continue" stop', async t => {
	const { w } = setup(t);
	let imageRequests = 0;
	const baseFetch = w.fetch;
	w.fetch = async (input, init = {}) => {
		const url = new URL(String(input), 'https://studio.test');
		if (url.pathname === '/api/media/config') {
			return Response.json({ success: false, direct: false, key: '', error: 'Pixabay API key is not configured' });
		}
		if (url.pathname === '/api/image' || url.pathname === '/api/image-batch') {
			imageRequests += 1;
			/* Byte-for-byte what the media endpoint answers without the key (verified on wrangler dev). */
			return new Response(JSON.stringify({ error: 'Pixabay API key is not configured' }), {
				status: 503,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
			});
		}
		return baseFetch(input, init);
	};
	/* Compress the client's bounded retry waits so the three rounds finish fast. */
	const native = w.setTimeout.bind(w);
	w.setTimeout = (fn, ms, ...args) => native(fn, ms >= 500 && ms <= 5000 ? 5 : ms, ...args);

	w.addVideoAccordion();
	const project = w.__VIDEO_PROJECTS[0];
	project._seoTopic = 'garden';
	project._seoMinutes = 1;
	project.script = 'Grow fresh food together in a sunny neighborhood garden.';
	project._imageFlowActive = true;
	await deadline(w.startImagePromptFlow(1));

	const statusText = w.document.getElementById('va-ai-status-1').textContent;
	assert.equal(project.assets.length, 0, 'no image can be imported without the key');
	assert.match(statusText, /Pixabay API key is not configured/, 'the real cause must reach the user');
	assert.doesNotMatch(statusText, /pause for about \d+ s and then continue/,
		'the flow stopped for good — it must not promise a pause-and-continue recovery');
	assert.match(statusText, /0 image\(s\) added to the gallery/);
	assert.match(statusText, /Upload Image, GIF or MP4 is enabled again/);
	assert.ok(imageRequests > 0, 'the flow did ask for images');
});


test('both layouts plan the same twelve scenes for punctuation-separated words and emoji', async t => {
 const {w, plannerCalls} = setup(t);
 const script = 'forest🌲garden '.repeat(66);
 while (w.__BATCH_ROWS.length) w.removeBatchRow(w.__BATCH_ROWS[0].id);
 const row = w.addBatchRow({script, minutes:1});
 await deadline(w.runBatchRow(row));
 assert.equal(w.batchRowFinished(row), true); assert.equal(row.images.length,12);
 assert.ok(plannerCalls.every(prompt => prompt.includes(script)));
 w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[0];
 project.script=script; project._seoTopic='forest'; project._seoMinutes=1; project._imageFlowActive=true;
 await deadline(w.startImagePromptFlow(1));
 assert.equal(project.assets.length,12); assert.equal(project.assets.filter(a=>a.kind==='mp4').length,4);
 assert.deepEqual(Array.from(project.assets, a=>a.sceneIndex), Array.from({length:12},(_,i)=>i));
});

test('editor and Quick Batch recover from a transient HTTP 408 keyword-planning failure with one request per pass', async t => {
 const {w}=setup(t); const original=w.fetch; let promptRequests=0, failuresLeft=1;
 w.fetch=async (input,init={})=>{
  if (new URL(String(input),'https://studio.test').pathname==='/api/image-prompts') {
   promptRequests++;
   if (failuresLeft-- > 0) return Response.json({success:false,error:'planner timed out'}, {status:408});
  }
  return original(input,init);
 };
 /* Shrink the scheduled retry's wait so the test does not sit out 15 s. */
 w.__IMAGE_AUTO_RETRY_TIMING={limit:2,minDelayMs:0,maxDelayMs:200,fallbackDelayMs:20,tickMs:0};
 w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[0];
 project.script='Gardens connect people.'; project._seoTopic='garden'; project._seoMinutes=1; project._imageFlowActive=true;
 await deadline(w.startImagePromptFlow(1));
 /* Session 279: ONE request per pass. A transient failure on the very first
  * chunk used to be re-asked inside the request; now the flow ends, reports
  * the reason, and the scheduled flow-level retry owns the recovery - which is
  * also the only owner that can sit out a minutes-long rate-limit window. */
 assert.equal(promptRequests,1,'the page asks the worker once per prompt pass');
 assert.equal(project.assets.length,0);
 assert.equal(project._imageFlowActive,false);
 assert.match(w.document.getElementById('va-ai-status-1').textContent,/retry/i);
 const scheduled=w.__IMAGE_AUTO_RETRY_LOG.filter(entry=>entry.event==='scheduled');
 assert.equal(scheduled.length,1,'the failed flow armed one automatic retry');
 assert.equal(scheduled[0].missing,12,'the retry counts the scenes the flow was asked for');
 await deadline((async()=>{while(project.assets.length<12)await new Promise(resolve=>setTimeout(resolve,10));})(),20000);
 assert.equal(project.assets.length,12);
 assert.ok(promptRequests>=2,'the scheduled retry asked again and the worker answered');

 /* FINAL RULE - QUICK BATCH TABLE LAYOUT: client JS retries the failed
  * scene-plan stage silently and continues to the next pipeline. */
 failuresLeft=1; promptRequests=0;
 while (w.__BATCH_ROWS.length) w.removeBatchRow(w.__BATCH_ROWS[0].id);
 const row=w.addBatchRow({script:'Gardens connect people.',minutes:1});
 await deadline(w.runBatchRow(row));
 assert.ok(promptRequests>=2,'the client retried the failed scene-plan stage');
 assert.equal(w.batchRowFinished(row),true);
 assert.equal(row.images.length,12);
 assert.equal(row.error,'');
});

test('editor Retry Pixabay search reuses visible terms and adds a missing stock clip without re-importing successful scenes', async t => {
	const { w } = setup(t); w.addVideoAccordion(); const project = w.__VIDEO_PROJECTS[0];
	project.script = 'Garden flowers bring neighbors together in spring.';
	project._seoTopic = 'garden flowers'; project._seoMinutes = 1; project._imageFlowActive = true;
	project.selectedSeoSet = { longTail: 'garden flowers', short: ['garden', 'flowers', 'neighbors', 'spring'] };
	await deadline(w.startImagePromptFlow(1));
	assert.equal(project.assets.filter(asset => asset.kind === 'mp4').length, 4);
	const missingClip = project.assets.find(asset => asset.kind === 'mp4');
	const missingScene = missingClip.sceneIndex;
	if (missingClip.card?.parentNode) missingClip.card.parentNode.removeChild(missingClip.card);
	project.assets = project.assets.filter(asset => asset !== missingClip);
	if (missingClip.url) w.URL.revokeObjectURL(missingClip.url);
	assert.equal(project.assets.filter(asset => asset.kind === 'mp4').length, 3);

	await deadline(w.retryImagePromptFlow(1));
	const clips = project.assets.filter(asset => asset.kind === 'mp4');
	assert.equal(clips.length, 4, 'the missing clip is searched and restored to the gallery');
	assert.ok(clips.some(asset => asset.sceneIndex === missingScene), 'restored clip keeps its planned scene index');
	assert.equal(project.assets.filter(asset => asset.imagePromptFlowId === project.imagePromptFlowId).length, 12,
		'successful photos/clips remain and are not imported a second time');
	assert.equal(project.imagePromptStates[String(missingScene)].state, 'imported');
});
