import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import worker from "../src/index.ts";
import { APP_JS } from "../src/client/app-js.ts";
import { createHTML } from "../src/page.ts";
import { BROWSER_OFFLOAD_JS } from "../src/client/browser-offload.ts";
import { handleImageBinary } from "../src/modules/image-batch.ts";
import { handleVoiceover } from "../src/modules/voiceover.ts";
import { handleSeoScriptGeneration, SEO_PLAN_FALLBACK_MODELS } from "../src/modules/script-seo.ts";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const mp3 = Uint8Array.from([255, 251, 144, 100, 1, 2]);
const taggedMp3 = Uint8Array.from([73,68,51,4,0,0,0,0,0,0, ...mp3]);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const request = (path, body) => new Request("https://studio.test" + path, { method: "POST", body: JSON.stringify(body) });
const tick = () => new Promise((r) => setTimeout(r, 5));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function runtime(overrides = {}) {
	const win = { navigator: { hardwareConcurrency: 8, deviceMemory: 8 }, document: { hidden: false },
		setTimeout, clearTimeout, Blob, URL, AbortController, fetch: async () => json({}), ...overrides };
	const context = vm.createContext({ window: win, URL, console, setTimeout, clearTimeout, Blob, AbortController });
	vm.runInContext(BROWSER_OFFLOAD_JS + "\nthis.runtime = studioOffload;", context);
	return { runtime: context.runtime, win, context };
}
function wav(data = [1,2,3,4], sampleRate = 22050) {
	const out = new Uint8Array(44 + data.length), dv = new DataView(out.buffer);
	out.set([82,73,70,70], 0); dv.setUint32(4, out.length - 8, true);
	out.set([87,65,86,69,102,109,116,32], 8); dv.setUint32(16, 16, true);
	dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sampleRate, true);
	dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
	out.set([100,97,116,97], 36); dv.setUint32(40, data.length, true); out.set(data, 44); return out;
}

test("#261 capability negotiation is non-billable and old servers fall back before generation", async () => {
	const entry = worker.fetch ? worker : worker.default;
	const response = await entry.fetch(new Request("https://studio.test/api/pipeline-capabilities"), {}, {});
	assert.equal(response.status, 200);
	assert.equal((await response.json()).version, 261);
	let calls = 0;
	const { runtime: r } = runtime({ fetch: async () => { calls++; return json({}, 404); } });
	assert.equal((await r.capabilities()).binaryImages, undefined);
	await r.capabilities();
	assert.equal(calls, 1);
});

test("#261 binary route reserves exactly one credit and returns raw bytes and frame", async () => {
	const charges = [], inputs = [];
	const response = await handleImageBinary(request("/api/image", { prompt: "forest", resolution: 720, orientation: "portrait" }),
		{ AI: { run: async (_m, input) => { inputs.push(input); return png; } } },
		{ consume: async (n) => { charges.push(n); return { allowed: true, granted: n }; }, refund: async () => assert.fail("no refund") });
	assert.equal(response.headers.get("Content-Type"), "image/png");
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	assert.deepEqual(new Uint8Array(await response.arrayBuffer()), png);
	assert.deepEqual(charges, [1]);
	assert.equal(inputs[0].height, 720);
	assert.equal(inputs[0].width, 408);
});

test("#261 binary failure refunds once; invalid frame and quota rejection do no inference", async () => {
	let refunds = 0, calls = 0;
	const env = { AI: { run: async () => { calls++; throw new Error("model unavailable"); } } };
	const hooks = { consume: async () => ({ allowed: true, granted: 1 }), refund: async () => { refunds++; return null; } };
	const failed = await handleImageBinary(request("/api/image", { prompt: "forest" }), env, hooks);
	assert.equal(failed.status, 502); assert.equal(refunds, 1); assert.equal(calls, 6, "two bounded attempts, each with the existing primary/fallback chain");
	calls = 0;
	assert.equal((await handleImageBinary(request("/api/image", { prompt: "forest", orientation: "typo" }), env, hooks)).status, 400);
	assert.equal((await handleImageBinary(request("/api/image", { prompt: "forest" }), env,
		{ ...hooks, consume: async () => ({ allowed: false, granted: 0 }) })).status, 429);
	assert.equal(calls, 0);
});

test("#261 binary transport never replays a failed paid request", async () => {
	let calls = 0;
	const { runtime: r } = runtime({ fetch: async (url) => { calls++; assert.equal(url, "/api/image"); throw new Error("connection lost after submit"); } });
	const results = await r.images(["forest"], {}, {});
	assert.equal(results[0].ok, false); assert.equal(calls, 1);
});

test("#261 image fanout is bounded, returns each Blob immediately and needs no stream reader", async () => {
	let active = 0, max = 0;
	const gate = deferred(), delivered = [];
	const { runtime: r } = runtime({ fetch: async () => {
		active++; max = Math.max(max, active); await gate.promise; active--;
		return new Response(png, { headers: { "Content-Type": "image/png" } });
	} });
	const run = r.images(["a", "b", "c", "d", "e"], {}, { onImage: (b, index) => delivered.push([index, b.size]) });
	await tick(); assert.equal(max, 3); assert.equal(delivered.length, 0);
	gate.resolve(); const result = await run;
	assert.equal(result.length, 5); assert.equal(delivered.length, 5); assert.equal(r.stats().active, 0);
});

test("#261 adaptive limits react to device hints, backgrounding and retained media without deadlock", async () => {
	const { runtime: r, win } = runtime();
	assert.equal(r.limits(), 3);
	win.navigator.deviceMemory = 2; assert.equal(r.limits(), 1);
	win.navigator.deviceMemory = 8; win.document.hidden = true; assert.equal(r.limits(), 1);
	win.document.hidden = false;
	r.retainUrl("blob:large", { size: 220 * 1024 * 1024 }); assert.equal(r.limits(), 1);
	assert.equal(await r.schedule(async () => 42), 42, "retained assets throttle, not permanently pause, generation");
	r.releaseUrl("blob:large"); assert.equal(r.limits(), 3); assert.equal(r.stats().retainedBytes, 0);
});

test("#261 old browser without AbortController stops a hung request by logical cancellation", async () => {
	let owner;
	const { runtime: r } = runtime({ AbortController: undefined, fetch: async () => new Promise(() => {}) });
	const run = r.images(["forest"], {}, { setController: (c) => { owner = c; } });
	await tick(); owner.abort();
	await assert.rejects(run, { name: "AbortError" });
	assert.equal(r.stats().active, 0);
});

test("#261 Web Locks coordinate same-origin tabs and work failures are never retried as lock failures", async () => {
	const held = new Set(); let active = 0, max = 0, calls = 0;
	const locks = { request: async (name, _opts, callback) => {
		if (held.has(name)) return callback(null);
		held.add(name); try { return await callback({ name }); } finally { held.delete(name); }
	} };
	const nav = { locks, hardwareConcurrency: 2, deviceMemory: 2 };
	const a = runtime({ navigator: nav }).runtime, b = runtime({ navigator: nav }).runtime;
	const work = async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 15)); active--; return 1; };
	await Promise.all([a.schedule(work), b.schedule(work)]); assert.equal(max, 1);
	await assert.rejects(a.schedule(async () => { calls++; throw new Error("paid request failed"); }), /paid request failed/);
	assert.equal(calls, 1); assert.equal(held.size, 0);
});

test("#261 BroadcastChannel-only tabs exchange leases; unavailable APIs degrade to per-tab limits", async () => {
	const channels = new Set();
	class Channel {
		constructor() { channels.add(this); }
		postMessage(data) { for (const ch of channels) if (ch !== this) queueMicrotask(() => ch.onmessage?.({ data })); }
		close() { channels.delete(this); }
	}
	const a = runtime({ BroadcastChannel: Channel }).runtime, b = runtime({ BroadcastChannel: Channel }).runtime;
	let active = 0, max = 0;
	const work = async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 15)); active--; };
	await Promise.all([a.schedule(work), b.schedule(work)]); assert.equal(max, 1);
	a.dispose(); b.dispose(); assert.equal(channels.size, 0);
	const old = runtime({ navigator: {} }).runtime;
	assert.equal(await old.schedule(async () => "works"), "works"); old.dispose();
});

test("#261 prompt preparation is bounded and voice splitting is surrogate-safe without modern regex syntax", () => {
	const { runtime: r } = runtime();
	const idea = r.compactIdea("First forest sentence. " + "Middle sentence. ".repeat(1000) + "Last scene closes.", "forest");
	assert.match(idea, /First forest/); assert.match(idea, /Last scene/); assert.ok(idea.length <= 480);
	const chunks = r.voiceChunks("✨ ".repeat(10) + "A forest begins. ".repeat(90) + " \ud800 end ");
	assert.ok(chunks.length > 1); assert.ok(chunks.every((c) => c.length <= 400));
	assert.ok(chunks.every((c) => !/[\ud800-\udfff]/.test(c)));
	assert.equal(r.voiceChunks("✨ ... !!!").length, 0);
});

test("#261 browser MP3 assembly strips repeated ID3 and WAV assembly verifies formats", async () => {
	const { runtime: r } = runtime();
	const joined = await r.assembleAudio([taggedMp3.buffer, taggedMp3.buffer]);
	assert.equal(joined.mime, "audio/mpeg");
	assert.equal(joined.buffer.byteLength, taggedMp3.length + mp3.length);
	const waves = await r.assembleAudio([wav().buffer, wav().buffer]);
	assert.equal(waves.mime, "audio/wav"); assert.equal(waves.buffer.byteLength, 52);
	assert.equal(new DataView(waves.buffer).getUint32(40, true), 8);
	await assert.rejects(r.assembleAudio([wav().buffer, mp3.buffer]), /Mixed WAV and MP3/);
	await assert.rejects(r.assembleAudio([wav().buffer, wav([1,2,3,4], 44100).buffer]), /sample formats differ/);
	await assert.rejects(r.assembleAudio([wav([1]).buffer]), /block alignment/);
});

test("#261 CSP-blocked Worker uses cooperative audio assembly and FileReader replaces Blob.arrayBuffer", async () => {
	const { runtime: r } = runtime({ Worker: class { constructor() { throw new Error("CSP blocked"); } } });
	const assembled = await r.assembleBlobs([new Blob([taggedMp3]), new Blob([taggedMp3])], {});
	assert.equal(assembled.type, "audio/mpeg"); assert.equal(assembled.size, taggedMp3.length + mp3.length);
	const oldBlob = { bytes: mp3 };
	const old = runtime({ FileReader: class {
		readAsArrayBuffer(blob) { this.result = blob.bytes.buffer; queueMicrotask(() => this.onload()); }
	} }).runtime;
	assert.deepEqual(new Uint8Array(await old.readBlob(oldBlob)), mp3);
});

test("#261 audio worker transfers buffers; worker crashes recover from original Blobs", async () => {
	let transferred = 0, terminated = 0;
	const { runtime: r } = runtime({ Worker: class {
		postMessage(buffers, transfer) {
			transferred += transfer.length;
			structuredClone(buffers, { transfer }); // Detach originals exactly as a browser does.
			queueMicrotask(() => this.onerror(new Error("worker crashed")));
		}
		terminate() { terminated++; }
	} });
	const blob = await r.assembleBlobs([new Blob([taggedMp3]), new Blob([taggedMp3])], {});
	assert.equal(transferred, 2); assert.equal(terminated, 1); assert.equal(blob.size, taggedMp3.length + mp3.length);
});

test("#261 TTS chunks use one AI call, allowlisted voice indices and binary output", async () => {
	const calls = [];
	const env = { AI: { run: async (model) => { calls.push(model); return mp3; } } };
	const resp = await handleVoiceover(request("/api/voiceover", { chunk: true, text: "Forest", lang: "en", voiceIndex: 1 }), env);
	assert.equal(resp.status, 200); assert.equal(resp.headers.get("Content-Type"), "audio/mpeg");
	assert.equal(calls.length, 1); assert.match(calls[0], /aura-2/);
	assert.equal((await handleVoiceover(request("/api/voiceover", { chunk: true, text: "x".repeat(401) }), env)).status, 400);
	assert.equal((await handleVoiceover(request("/api/voiceover", { chunk: true, text: "Forest", voiceIndex: 9 }), env)).status, 400);
});

test("#261 voiceover switches voice by restarting chunks instead of mixing formats", async () => {
	const calls = [];
	const { runtime: r } = runtime({ fetch: async (_url, init) => {
		const body = JSON.parse(init.body); calls.push(body);
		if (body.voiceIndex === 0 && calls.length === 2) return json({ error: "primary failed" }, 502);
		return new Response(body.voiceIndex === 0 ? wav() : taggedMp3,
			{ headers: { "Content-Type": body.voiceIndex === 0 ? "audio/wav" : "audio/mpeg" } });
	} });
	const result = await r.voiceover("A long forest sentence for a clear narration. ".repeat(18), "en", {});
	assert.equal(result.type, "audio/mpeg");
	const fallback = calls.filter((c) => c.voiceIndex === 1);
	assert.ok(fallback.length >= 2); assert.equal(fallback[0].text, calls[0].text);
});

const keywords = { title: "Yoga Morning Balance", headings: ["Yoga for Calm", "Morning Stretch"],
	longTail: "morning yoga poses for beginners in a small home studio", short: ["yoga", "breathing", "stretching", "balance"] };
test("#261 single-attempt scripts validate before usage and run one writer inference", async () => {
	let calls = 0, usage = 0;
	const env = { AI: { run: async () => { calls++; throw new Error("upstream failed"); } } };
	const invalid = await handleSeoScriptGeneration(request("/api/script", { singleAttempt: true, topic: "Yoga" }),
		new URL("https://studio.test/api/script"), env, "primary", async () => { usage++; });
	assert.equal(invalid.status, 400); assert.equal(calls, 0); assert.equal(usage, 0);
	const seen = [];
	env.AI.run = async (model) => { seen.push(model); calls++; throw new Error("upstream failed"); };
	const response = await handleSeoScriptGeneration(request("/api/script", { singleAttempt: true, attempt: 1,
		topic: "Yoga", minutes: 1, speed: "medium", keywordSet: keywords }),
		new URL("https://studio.test/api/script"), env, "primary", async () => { usage++; });
	assert.equal(response.status, 500); assert.equal(calls, 1); assert.equal(usage, 1);
	assert.deepEqual(seen, [SEO_PLAN_FALLBACK_MODELS[0]]);
});

function client() {
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	const w = dom.window;
	w.__PLAN_MODE = "freemium"; w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
	let id = 0;
	w.URL.createObjectURL = () => "blob:test/" + ++id; w.URL.revokeObjectURL = () => {};
	w.AudioContext = class { constructor() { this.state = "running"; } decodeAudioData() { return Promise.resolve({ duration: 60 }); } };
	w.Image = class { decode() { return Promise.resolve(); } };
	return { dom, w };
}

test("#261 Quick Batch uses binary images, chunked audio and compact prompts end-to-end", async (t) => {
	const { dom, w } = client(); t.after(() => dom.window.close());
	const calls = [];
	w.fetch = async (url, init = {}) => {
		const body = init.body ? JSON.parse(init.body) : null; calls.push({ url, body });
		if (url === "/api/pipeline-capabilities") return json({ version: 261, binaryImages: true, chunkVoiceover: true, compactPrompts: true });
		if (url === "/api/voiceover") { assert.equal(body.chunk, true); return new Response(mp3, { headers: { "Content-Type": "audio/mpeg" } }); }
		if (url === "/api/image-prompts") return json({ success: true, prompts: Array.from({ length: body.batch.count }, (_, i) => "Scene " + (body.batch.offset + i)) });
		if (url === "/api/image") return new Response(png, { headers: { "Content-Type": "image/png" } });
		if (url === "/api/image-batch") assert.fail("must not use NDJSON in negotiated mode");
		return json({ success: true, remaining: {} });
	};
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]")); await tick();
	const row = w.addBatchRow({ script: "A forest begins. " + "Nature is peaceful. ".repeat(40) + "A forest ends.", minutes: 1 });
	await w.runBatchRow(row);
	assert.equal(w.batchRowFinished(row), true); assert.equal(row.images.length, 10);
	assert.equal(calls.filter((c) => c.url === "/api/image").length, 10);
	assert.ok(calls.filter((c) => c.url === "/api/image-prompts").every((c) => c.body.script === undefined && c.body.scriptIdea.length <= 480));
	assert.deepEqual(Array.from(row.images, (image) => image.index), Array.from({ length: 10 }, (_, i) => i));
});

test("#261 old-server capabilities preserve legacy UI requests", async (t) => {
	const { dom, w } = client(); t.after(() => dom.window.close());
	const calls = [];
	w.fetch = async (url, init = {}) => {
		calls.push(url);
		if (url === "/api/pipeline-capabilities") return json({}, 404);
		if (url === "/api/voiceover") { assert.equal(JSON.parse(init.body).chunk, undefined); return new Response(mp3); }
		return json({ success: true, remaining: {} });
	};
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]")); await tick();
	await w.requestBatchVoiceover({ script: "Forest", stopRequested: false });
	assert.equal(calls.filter((url) => url === "/api/voiceover").length, 1);
	assert.equal(calls.includes("/api/image"), false);
});

test("#261 audio worker executes the actual standalone assembly source and transfers its result", async () => {
	const sources = new Map(); let id = 0, transferred = 0, terminated = 0;
	const URLMock = { createObjectURL(blob) { const url = "blob:worker/" + ++id; sources.set(url, blob); return url; }, revokeObjectURL(url) { sources.delete(url); } };
	class AudioWorker {
		constructor(url) { this.ready = sources.get(url).text(); }
		postMessage(buffers, transfer) {
			transferred += transfer.length;
			const input = structuredClone(buffers, { transfer });
			this.ready.then((source) => {
				const context = vm.createContext({ postMessage: (result, transferOut) => {
					const data = structuredClone(result, { transfer: transferOut });
					queueMicrotask(() => this.onmessage({ data }));
				} });
				vm.runInContext(source, context); context.onmessage({ data: input });
			});
		}
		terminate() { terminated++; }
	}
	const { runtime: r } = runtime({ URL: URLMock, Worker: AudioWorker });
	const blob = await r.assembleBlobs([new Blob([wav()]), new Blob([wav()])], {});
	assert.equal(blob.type, "audio/wav"); assert.equal(blob.size, 52);
	assert.equal(transferred, 2); assert.equal(terminated, 1); assert.equal(sources.size, 0);
});

test("#261 worker assembly cancels logically even without AbortController", async () => {
	let cancelled = false, terminated = false;
	const { runtime: r } = runtime({ AbortController: undefined, Worker: class {
		postMessage() {} terminate() { terminated = true; }
	} });
	const run = r.assembleBlobs([new Blob([mp3])], { isCancelled: () => cancelled });
	await tick(); cancelled = true;
	await assert.rejects(run, { name: "AbortError" }); assert.equal(terminated, true);
});

test("#261 missing AbortController still has a finite network/body deadline", async () => {
	const { runtime: r } = runtime({ AbortController: undefined, fetch: async () => new Promise(() => {}) });
	await assert.rejects(r.timedFetch("/hung", {}, 5, {}, (response) => response.blob()), { name: "TimeoutError" });
});

test("#261 binary route retains authentication gate and cancels before charging an already-aborted request", async () => {
	const entry = worker.fetch ? worker : worker.default;
	const response = await entry.fetch(request("/api/image", { prompt: "forest" }),
		{ KV_BINDING: { get: async () => null }, AI: { run: async () => assert.fail("must not call AI") } }, {});
	assert.equal(response.status, 401);
	const controller = new AbortController(); controller.abort();
	const cancelled = new Request("https://studio.test/api/image", { method: "POST", body: JSON.stringify({ prompt: "forest" }), signal: controller.signal });
	assert.equal((await handleImageBinary(cancelled, { AI: { run: async () => assert.fail("must not call AI") } }, {
		consume: async () => assert.fail("must not charge"), refund: async () => assert.fail("must not refund")
	})).status, 499);
});

test("#261 binary route refunds once if cancellation arrives during inference", async () => {
	const gate = deferred(), started = deferred(), controller = new AbortController(); let refunds = 0;
	const req = new Request("https://studio.test/api/image", { method: "POST", body: JSON.stringify({ prompt: "forest" }), signal: controller.signal });
	const run = handleImageBinary(req, { AI: { run: async () => { started.resolve(); await gate.promise; return png; } } }, {
		consume: async () => ({ allowed: true, granted: 1 }), refund: async () => { refunds++; return null; }
	});
	await started.promise; controller.abort(); gate.resolve();
	assert.equal((await run).status, 499); assert.equal(refunds, 1);
});

test("#261 Editor uses binary chunks, single-attempt script requests and compact prompt payloads", async (t) => {
	const { dom, w } = client(); t.after(() => dom.window.close());
	const calls = [];
	w.fetch = async (url, init = {}) => {
		const body = init.body ? JSON.parse(init.body) : null; calls.push({ url, body });
		if (url === "/api/pipeline-capabilities") return json({ version: 261, binaryImages: true, singleAttemptScript: true, compactPrompts: true });
		if (url === "/api/script") return json({ success: true, script: "A forest begins. " + "Nature is peaceful. ".repeat(10) + "A forest ends.", format: "plain", minutes: 1, durationMs: 60000 });
		if (url === "/api/image-prompts") return json({ success: true, prompts: Array.from({ length: body.batch.count }, (_, i) => "Scene " + (body.batch.offset + i)) });
		if (url === "/api/image") return new Response(png, { headers: { "Content-Type": "image/png" } });
		if (url === "/api/image-batch") assert.fail("no NDJSON in new editor flow");
		return json({ success: true, remaining: {} });
	};
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]")); await tick(); w.addVideoAccordion();
	const project = w.__VIDEO_PROJECTS ? w.__VIDEO_PROJECTS[0] : null;
	assert.ok(project, "live project debug hook exists");
	project.selectedSeoSet = keywords;
	assert.equal(await w.runSeoScriptRequest(1, "Forest", 1, "medium"), true);
	assert.equal(calls.find((c) => c.url === "/api/script").body.singleAttempt, true);
	project._seoMinutes = 1; project._seoTopic = "Forest"; project._imageFlowActive = true;
	await w.startImagePromptFlow(1);
	assert.equal(w.document.querySelectorAll("#va-gallery-1 > .va-card").length, 10);
	assert.equal(w.document.getElementById("va-upload-btn-1").disabled, false);
	assert.equal(calls.filter((c) => c.url === "/api/image").length, 10);
	assert.ok(calls.filter((c) => c.url === "/api/image-prompts").every((c) => c.body.script === undefined && c.body.scriptIdea.length <= 480));
});

test("#261 reserved control lane generates prompt lookahead while all three images are still pending", async () => {
	const gate = deferred(); let images = 0, control = false;
	const { runtime: r } = runtime({ fetch: async (url) => {
		if (url === "/api/image") { images++; await gate.promise; return new Response(png, { headers: { "Content-Type": "image/png" } }); }
		control = true; return json({ success: true, prompts: ["next scene"] });
	} });
	const rendering = r.images(["a", "b", "c"], {}, {});
	await tick(); assert.equal(images, 3);
	const response = await r.jsonRequest("/api/image-prompts", {}, 1000, {});
	assert.equal(control, true); assert.equal((await response.json()).prompts[0], "next scene");
	assert.equal(r.stats().mediaActive, 3);
	gate.resolve(); await rendering;
});

test("#261 cancelling queued prompt work does not wait for another video's occupied control slot", async () => {
	const gate = deferred(); let owner, calls = 0;
	const { runtime: r } = runtime({ fetch: async () => { calls++; await gate.promise; return json({ success: true }); } });
	const first = r.jsonRequest("/api/image-prompts", {}, 1000, {});
	await tick();
	const second = r.jsonRequest("/api/image-prompts", {}, 1000, { setController: (c) => { owner = c; } });
	owner.abort();
	await assert.rejects(second, { name: "AbortError" }); assert.equal(calls, 1);
	gate.resolve(); await first;
});

test("#261 negotiated TTS retries are not multiplied by the legacy Quick Batch step wrapper", async (t) => {
	const { dom, w } = client(); t.after(() => dom.window.close()); let calls = 0;
	w.fetch = async (url) => {
		if (url === "/api/pipeline-capabilities") return json({ version: 261, chunkVoiceover: true });
		if (url === "/api/voiceover") { calls++; return json({ error: "TTS failed" }, 502); }
		return json({ success: true, remaining: {} });
	};
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]")); await tick();
	const row = w.addBatchRow({ script: "Forest", minutes: 1 });
	await w.runBatchRow(row);
	assert.equal(calls, 3); assert.equal(w.batchRowFinished(row), false);
});

test("#261 script cleanup follows its surviving project after accordion renumbering", async (t) => {
	const { dom, w } = client(); t.after(() => dom.window.close());
	const gate = deferred(), started = deferred();
	w.confirm = () => true;
	w.fetch = async (url) => {
		if (url === "/api/pipeline-capabilities") return json({ version: 261, singleAttemptScript: true });
		if (url === "/api/script") { started.resolve(); await gate.promise; return json({ success: true,
			script: "A forest begins. " + "Nature is peaceful. ".repeat(10), format: "plain", minutes: 1, durationMs: 60000 }); }
		return json({ success: true, remaining: {} });
	};
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]")); await tick();
	w.addVideoAccordion(); w.addVideoAccordion();
	const project = w.__VIDEO_PROJECTS[1]; project.selectedSeoSet = keywords;
	const run = w.runSeoScriptRequest(2, "Forest", 1, "medium");
	await started.promise; w.deleteVideoAccordion(1); gate.resolve();
	assert.equal(await run, true); assert.equal(w.__VIDEO_PROJECTS[0], project);
	assert.equal(w.document.getElementById("va-script-box-1").classList.contains("va-script-loading"), false);
	assert.match(project.script, /A forest begins/);
});
