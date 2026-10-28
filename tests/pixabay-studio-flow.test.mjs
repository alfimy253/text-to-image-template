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
	assert.equal(row.images.length, 10); assert.equal(row.slides.length, 10);
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
	assert.equal(project.assets.length, 10);
	assert.equal(project.aiImagesDone, 10);
	assert.ok(project.assets.every(a => a.stockSource?.provider === 'pixabay'));
	assert.equal(project._imageFlowActive, false);
	assert.equal(project.assets.filter(a => a.kind === 'mp4').length, 2);
	assert.deepEqual(Array.from(project.assets, a => a.sceneIndex), [0,1,2,3,4,5,6,7,8,9]);
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
	assert.equal(project.assets.length,10); assert.equal(project.assets.filter(a=>a.kind==='mp4').length,2);
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
	assert.equal(project.assets.length,10); assert.equal(project.assets.filter(a=>a.kind==='mp4').length,2);
	assert.deepEqual(Array.from(project.assets,a=>a.sceneIndex),[0,1,2,3,4,5,6,7,8,9]);
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
