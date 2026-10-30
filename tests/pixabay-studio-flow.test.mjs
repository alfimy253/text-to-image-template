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
			const ids = url.searchParams.has('id') ? [Number(url.searchParams.get('id'))] : [0,1,2].map(i => (Number(url.searchParams.get('page')) - 1) * 3 + i + 1);
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

test('Quick Batch recreates Pixabay search -> image imports -> slides -> Preview/Export -> browser MP4', async t => {
	const { w, calls, stats } = setup(t);
	while (w.__BATCH_ROWS.length) w.removeBatchRow(w.__BATCH_ROWS[0].id);
	const row = w.addBatchRow({ script: 'Yellow flowers in the garden.', minutes: 1, orientation: 'portrait', resolution: 720 });
	await deadline(w.runBatchRow(row));
	assert.equal(w.batchRowFinished(row), true);
	/*
	 * #275 — scene count follows the script word count: a five-word script plans
	 * 6 scenes (4 photos + 2 clips) on both sides of the wire.
	 */
	assert.equal(row.images.length, 6); assert.equal(row.slides.length, 6);
	assert.equal(row.slides.filter(s => s.type === 'mp4').length, 2);
	assert.equal(row.slides.reduce((frames, slide) => frames + Math.round(slide._partialSec * 30), 0), 30, 'both clips fit within the 1s test narration');
	assert.ok(row.prompts.every(p => p.startsWith('pixabay:')));
	const element = w.document.querySelector(`[data-batch-row="${row.id}"]`);
	assert.ok(element.querySelector('[data-batch-slot="preview"] button'));
	assert.ok(element.querySelector('[data-batch-slot="export"] button'));
	assert.ok(calls.filter(u => u.pathname === '/api/').every(u => u.searchParams.get('per_page') === '3'));
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

test('editor automatic LLM-keyword flow imports eight photos and two videos in scene order, then exports', async t => {
	const { w, stats, plannerCalls } = setup(t); w.addVideoAccordion(); const project = w.__VIDEO_PROJECTS[0];
	project.script = 'Opening flowers. Entire middle gardening idea. Closing garden.';
	project._seoTopic = 'yellow flowers'; project._seoMinutes = 1; project._imageFlowActive = true;
	project.selectedSeoSet = { longTail: 'yellow flowers', short: ['garden', 'flowers', 'yellow', 'plants'] };
	await deadline(w.startImagePromptFlow(1));
	assert.equal(project.assets.length, 6);
	assert.equal(project.aiImagesDone, 6);
	assert.ok(project.assets.every(a => a.stockSource?.provider === 'pixabay'));
	assert.equal(project._imageFlowActive, false);
	assert.equal(project.assets.filter(a => a.kind === 'mp4').length, 2);
	assert.deepEqual(Array.from(project.assets, a => a.sceneIndex), [0,1,2,3,4,5]);
	assert.ok(plannerCalls.every(prompt => prompt.includes(project.script)));
	await deadline(w.runGenerationQueue());
	assert.equal(project.status, 'done'); assert.ok(stats().encoded > 0);
});

test('rerunning editor planning replaces prior automatic media rather than accumulating four clips', async t => {
	const {w}=setup(t); w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[0];
	project.script='Gardens and flowers bring communities together.'; project._seoTopic='garden'; project._seoMinutes=1;
	project._imageFlowActive=true; await deadline(w.startImagePromptFlow(1));
	const prior=project.assets.map(a=>a.url);
	project._imageFlowActive=true; await deadline(w.startImagePromptFlow(1));
	assert.equal(project.assets.length,6); assert.equal(project.assets.filter(a=>a.kind==='mp4').length,2);
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

test('legacy NDJSON editor delivery also probes two clips and restores planned scene order', async t => {
	const {w}=setup(t,{binaryImages:false}); w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[0];
	project.script='Gardening connects the whole community.'; project._seoTopic='garden'; project._seoMinutes=1;
	project._imageFlowActive=true; await deadline(w.startImagePromptFlow(1));
	assert.equal(project.assets.length,6); assert.equal(project.assets.filter(a=>a.kind==='mp4').length,2);
	assert.deepEqual(Array.from(project.assets,a=>a.sceneIndex),[0,1,2,3,4,5]);
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
test('Quick Batch does not mark two clips plus a partial photo set as complete after repeated Pixabay image failures', async t => {
	const { w } = setup(t);
	while (w.__BATCH_ROWS.length) w.removeBatchRow(w.__BATCH_ROWS[0].id);
	const row = w.addBatchRow({ script: 'Short garden flowers connect neighbors.', minutes: 1 });
	const nativeFetch = w.fetch;
	let injectFailure = true;
	let simulatedFailures = 0;
	w.fetch = async (input, init = {}) => {
		const url = new URL(String(input), 'https://studio.test');
		if (url.pathname === '/api/image') {
			const body = JSON.parse(String(init.body || '{}'));
			if (injectFailure && String(body.prompt || '').includes('garden flowers 0')) {
				simulatedFailures++;
				return Response.json({ error: 'Pixabay search is unavailable (TypeError: simulated redirect failure)', kind: 'transient', requestId: 'simulated-table-search-failure' }, { status: 502 });
			}
		}
		return nativeFetch(input, init);
	};

	await deadline(w.runBatchRow(row), 30000);
	assert.equal(simulatedFailures, 3, 'browser exhausts its bounded per-scene retries for the failed photo');
	assert.equal(row.images.length, 5, 'other scenes, including both required clips, were retained as partial progress');
	assert.equal(row.images.filter(image => image.blob.type === 'video/mp4').length, 2);
	assert.equal(w.batchRowFinished(row), false, 'partial delivery must not enable Preview/Export');
	assert.equal(row.stage, 'error');
	assert.match(row.error, /Pixabay image pipeline incomplete: 1 of 6 planned scenes/);

	/* Quick Batch has no scene-only Pixabay retry control. Its documented
	 * recovery action is the layout's Generate button, which reruns the
	 * unfinished row; after the simulated outage clears it must complete. */
	injectFailure = false;
	w.document.querySelector('[data-layout="table"]').click();
	w.document.getElementById('top-generate').click();
	await deadline((async () => {
		while (!w.batchRowFinished(row)) await new Promise(resolve => setTimeout(resolve, 10));
	})(), 30000);
	assert.equal(w.batchRowFinished(row), true);
	assert.equal(row.images.length, 6);
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

test('editor startImagePromptFlow recovers from a transient wrong-scene-count attempt and passes previousError on retry', async t => {
	const { w } = setup(t);
	const retryBatches = [];
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
				return {
					response: JSON.stringify({
						scenes: slots.map((s) => ({ scene: s.scene, type: s.type, keywords: `garden scene ${s.scene}` }))
					})
				};
			}
		}
	};
	const baseFetch = w.fetch;
	w.fetch = async (input, init = {}) => {
		const url = new URL(String(input), 'https://studio.test');
		if (url.pathname === '/api/image-prompts') {
			const cloned = init?.body ? JSON.parse(String(init.body)) : {};
			if (cloned.batch && cloned.batch.attempt > 0) retryBatches.push(cloned.batch);
			return handleGenerateImagePrompts(
				new Request(url, { ...init, signal: undefined }),
				flakyEnv,
				'text-planner'
			);
		}
		return baseFetch(input, init);
	};
	const native = w.setTimeout.bind(w);
	w.setTimeout = (fn, ms, ...args) => native(fn, ms >= 500 && ms <= 5000 ? 5 : ms, ...args);

	w.addVideoAccordion();
	const project = w.__VIDEO_PROJECTS[0];
	project._seoTopic = 'garden';
	project._seoMinutes = 1;
	project.script = 'Grow fresh food together in a sunny neighborhood garden.';
	project._imageFlowActive = true;
	await deadline(w.startImagePromptFlow(1));

	assert.equal(firstChunkCalls, 2, 'chunk 0 should fail once and succeed on retry');
	assert.equal(retryBatches.length, 1);
	assert.equal(retryBatches[0].attempt, 1);
	assert.match(retryBatches[0].previousError, /wrong scene count/);
	assert.equal(project.assets.length, 6);
	assert.equal(project.assets.filter((a) => a.kind === 'mp4').length, 2);
	const statusText = w.document.getElementById('va-ai-status-1').textContent;
	assert.doesNotMatch(statusText, /flow stopped/i);
	assert.match(statusText, /6 image\(s\) in the gallery/);
});

test('a missing Pixabay API key reports the real configuration error, not a fake "server busy, then continue" stop', async t => {
	const { w } = setup(t);
	let imageRequests = 0;
	const baseFetch = w.fetch;
	w.fetch = async (input, init = {}) => {
		const url = new URL(String(input), 'https://studio.test');
		if (url.pathname === '/api/image') {
			imageRequests += 1;
			/* Byte-for-byte what POST /api/image answers without the key (verified on wrangler dev). */
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


test('both layouts plan the same eight scenes for punctuation-separated words and emoji', async t => {
 const {w, plannerCalls} = setup(t);
 const script = 'forest🌲garden '.repeat(66);
 while (w.__BATCH_ROWS.length) w.removeBatchRow(w.__BATCH_ROWS[0].id);
 const row = w.addBatchRow({script, minutes:1});
 await deadline(w.runBatchRow(row));
 assert.equal(w.batchRowFinished(row), true); assert.equal(row.images.length,8);
 assert.ok(plannerCalls.every(prompt => prompt.includes(script)));
 w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[0];
 project.script=script; project._seoTopic='forest'; project._seoMinutes=1; project._imageFlowActive=true;
 await deadline(w.startImagePromptFlow(1));
 assert.equal(project.assets.length,8); assert.equal(project.assets.filter(a=>a.kind==='mp4').length,2);
 assert.deepEqual(Array.from(project.assets, a=>a.sceneIndex), [0,1,2,3,4,5,6,7]);
});

test('editor and Quick Batch retry transient HTTP 408 keyword-planning failures', async t => {
 const {w}=setup(t); const original=w.fetch; let promptRequests=0, failed=0;
 w.fetch=async (input,init={})=>{
  if (new URL(String(input),'https://studio.test').pathname==='/api/image-prompts') {
   promptRequests++;
   if (failed++ === 0) return Response.json({success:false,error:'planner timed out'}, {status:408});
  }
  return original(input,init);
 };
 w.addVideoAccordion(); const project=w.__VIDEO_PROJECTS[0];
 project.script='Gardens connect people.'; project._seoTopic='garden'; project._seoMinutes=1; project._imageFlowActive=true;
 await deadline(w.startImagePromptFlow(1));
 assert.equal(project.assets.length,6); assert.ok(promptRequests>=3);
 failed=0; promptRequests=0;
 while (w.__BATCH_ROWS.length) w.removeBatchRow(w.__BATCH_ROWS[0].id);
 const row=w.addBatchRow({script:'Gardens connect people.',minutes:1});
 await deadline(w.runBatchRow(row));
 assert.equal(w.batchRowFinished(row),true); assert.equal(row.images.length,6); assert.ok(promptRequests>=3);
});

test('editor Retry Pixabay search reuses visible terms and adds a missing stock clip without re-importing successful scenes', async t => {
	const { w } = setup(t); w.addVideoAccordion(); const project = w.__VIDEO_PROJECTS[0];
	project.script = 'Garden flowers bring neighbors together in spring.';
	project._seoTopic = 'garden flowers'; project._seoMinutes = 1; project._imageFlowActive = true;
	project.selectedSeoSet = { longTail: 'garden flowers', short: ['garden', 'flowers', 'neighbors', 'spring'] };
	await deadline(w.startImagePromptFlow(1));
	assert.equal(project.assets.filter(asset => asset.kind === 'mp4').length, 2);
	const missingClip = project.assets.find(asset => asset.kind === 'mp4');
	const missingScene = missingClip.sceneIndex;
	if (missingClip.card?.parentNode) missingClip.card.parentNode.removeChild(missingClip.card);
	project.assets = project.assets.filter(asset => asset !== missingClip);
	if (missingClip.url) w.URL.revokeObjectURL(missingClip.url);
	assert.equal(project.assets.filter(asset => asset.kind === 'mp4').length, 1);

	await deadline(w.retryImagePromptFlow(1));
	const clips = project.assets.filter(asset => asset.kind === 'mp4');
	assert.equal(clips.length, 2, 'the missing clip is searched and restored to the gallery');
	assert.ok(clips.some(asset => asset.sceneIndex === missingScene), 'restored clip keeps its planned scene index');
	assert.equal(project.assets.filter(asset => asset.imagePromptFlowId === project.imagePromptFlowId).length, 6,
		'successful photos/clips remain and are not imported a second time');
	assert.equal(project.imagePromptStates[String(missingScene)].state, 'imported');
});
