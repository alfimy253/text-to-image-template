/*
 * Session #264 — the editor layout's video export ("🎬 Generate Videos")
 * used to stop dead on its first MP4 slide and never finish.
 *
 * Root cause (reproduced here, not inferred):
 *
 *   `generateMP4()` advanced a clip by awaiting
 *   `video.requestVideoFrameCallback()` once per output frame. That callback
 *   is only delivered while the browser actually composites the element, so
 *   it never fires for
 *     - the editor's probe <video> (`asset.videoEl`, created with
 *       createElement and never attached to the document),
 *     - the legacy gallery, which lives in a `display:none` panel,
 *     - a background/throttled tab, or
 *     - an element whose `play()` was rejected by the autoplay policy.
 *   Nothing timed out, nothing threw: the status line froze on the last
 *   "Completed image N of M", `project.status` stayed "rendering" forever and
 *   every later video in the bulk queue never started.
 *
 * The export now (a) waits for a real presented frame with a deadline,
 * (b) switches that slide to deterministic seek-based capture when frames stop
 * arriving, (c) refuses to draw a video without a decoded frame, (d) clamps
 * non-finite clip durations that used to make the frame loop unbounded, and
 * (e) fails a stalled encoder instead of spinning forever.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";

const PAGE = createHTML();

/* Everything the studio's exporter touches, stubbed at the DOM/WebCodecs edge. */
function harness({ presentFrames = true, blockPlay = false, clipDuration = 2 } = {}) {
	const dom = new JSDOM(PAGE, {
		url: "https://studio.test/free",
		runScripts: "outside-only",
		pretendToBeVisual: true
	});
	const w = dom.window;
	const warnings = [];
	const drawCalls = { count: 0 };

	const ctx = {
		canvas: null,
		globalAlpha: 1,
		fillStyle: "",
		font: "",
		textAlign: "",
		textBaseline: "",
		clearRect() {}, fillRect() {}, strokeRect() {}, save() {}, restore() {},
		beginPath() {}, closePath() {}, rect() {}, clip() {}, arc() {}, ellipse() {},
		fill() {}, stroke() {}, fillText() {}, strokeText() {}, putImageData() {},
		setLineDash() {}, setTransform() {}, translate() {}, scale() {}, rotate() {},
		drawImage() { drawCalls.count += 1; },
		measureText: (text) => ({ width: String(text || "").length * 8 }),
		createLinearGradient: () => ({ addColorStop() {} }),
		createRadialGradient: () => ({ addColorStop() {} }),
		getImageData: () => ({ data: new Uint8ClampedArray(4) })
	};
	w.HTMLCanvasElement.prototype.getContext = function () { ctx.canvas = this; return ctx; };
	w.Image.prototype.decode = () => Promise.resolve();
	Object.defineProperty(w.document, "fonts", {
		configurable: true,
		value: { load: () => Promise.resolve([]), ready: Promise.resolve() }
	});

	/* Media elements: play/pause plus the presentation callback under test. */
	w.HTMLMediaElement.prototype.play = function () {
		if (blockPlay) return Promise.reject(new Error("NotAllowedError"));
		this._playing = true;
		this.muted = true;
		return Promise.resolve();
	};
	w.HTMLMediaElement.prototype.pause = function () { this._playing = false; };
	w.HTMLMediaElement.prototype.load = function () {};
	w.HTMLMediaElement.prototype.requestVideoFrameCallback = function (callback) {
		return setTimeout(() => {
			/* A detached / display:none / backgrounded element presents nothing. */
			if (!presentFrames || !this._playing) return;
			callback(1, { mediaTime: this.currentTime });
		}, 2);
	};
	w.HTMLMediaElement.prototype.cancelVideoFrameCallback = function (id) { clearTimeout(id); };
	Object.defineProperty(w.HTMLMediaElement.prototype, "readyState", {
		configurable: true,
		get() { return 4; }
	});
	Object.defineProperty(w.HTMLMediaElement.prototype, "duration", {
		configurable: true,
		get() { return this._duration === undefined ? clipDuration : this._duration; }
	});
	Object.defineProperty(w.HTMLMediaElement.prototype, "currentTime", {
		configurable: true,
		get() { return this._time || 0; },
		set(value) {
			this._time = value;
			setTimeout(() => this.dispatchEvent(new w.Event("seeked")), 0);
		}
	});

	w.VideoFrame = class { constructor() { this.timestamp = 0; } close() {} };
	let encoded = 0;
	w.VideoEncoder = class {
		constructor(init) { this._out = init.output; this.encodeQueueSize = 0; this.state = "unconfigured"; }
		configure() { this.state = "configured"; }
		encode() { encoded += 1; this._out({ byteLength: 8 }, {}); }
		async flush() {}
		close() { this.state = "closed"; }
	};
	w.AudioEncoder = class {
		constructor(init) { this._out = init.output; this.encodeQueueSize = 0; this.state = "unconfigured"; }
		configure() { this.state = "configured"; }
		encode() { this._out({ byteLength: 8 }, {}); }
		async flush() {}
		close() { this.state = "closed"; }
	};
	w.AudioData = class { close() {} };
	w.Mp4Muxer = {
		ArrayBufferTarget: class { constructor() { this.buffer = new ArrayBuffer(64); } },
		FileSystemWritableFileStreamTarget: class { constructor(stream) { this.stream = stream; } },
		Muxer: class {
			constructor(config) { this.target = config.target; }
			addVideoChunk() {} addAudioChunk() {} finalize() {}
		}
	};

	w.fetch = async (input) => {
		const url = typeof input === "string" ? input : input.url;
		const path = new URL(url, "https://studio.test").pathname;
		if (path === "/api/session") {
			return new Response(JSON.stringify({ authenticated: true, user: { username: "tester", usertype: "free" } }),
				{ status: 200, headers: { "Content-Type": "application/json" } });
		}
		if (path === "/api/credits") {
			return new Response(JSON.stringify({ plan: { id: "free", label: "Free", limits: { images: 10000 } }, remaining: { images: 10000 } }),
				{ status: 200, headers: { "Content-Type": "application/json" } });
		}
		return new Response("{}", { status: 404 });
	};
	w.URL.createObjectURL = () => "blob:https://studio.test/" + Math.random().toString(36).slice(2);
	w.URL.revokeObjectURL = () => {};
	w.alert = (message) => warnings.push(String(message));
	w.confirm = () => true;
	const warn = w.console.warn;
	w.console.warn = function (...args) { warnings.push(args.map(String).join(" ")); return warn.apply(w.console, args); };

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));

	return { w, warnings, stats: () => ({ encoded, drawCalls: drawCalls.count }) };
}

/* Video 1 = one still + one MP4 clip, no MP3 (the silent-export path). */
function seedProject(w, clipDuration) {
	const originalCreate = w.document.createElement.bind(w.document);
	w.addVideoAccordion();
	const project = w.__VIDEO_PROJECTS[0];
	project.assets.push({
		kind: "image",
		file: new w.File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "still.png", { type: "image/png" }),
		url: "blob:still",
		card: null
	});
	const clip = originalCreate("video");
	clip.muted = true;
	clip.loop = true;
	if (clipDuration !== undefined) clip._duration = clipDuration;
	project.assets.push({
		kind: "mp4",
		file: new w.File(["x"], "clip.mp4", { type: "video/mp4" }),
		videoEl: clip,
		duration: clipDuration,
		url: "blob:clip",
		card: null
	});
	return project;
}

async function renderWithDeadline(w, ms = 20000) {
	let timer;
	const deadline = new Promise((resolve) => {
		timer = setTimeout(() => resolve("timeout"), ms);
	});
	const finished = w.runGenerationQueue().then(() => "completed");
	try {
		return await Promise.race([finished, deadline]);
	} finally {
		clearTimeout(timer);
	}
}

test("#264 an MP4 clip that never presents frames no longer blocks the editor export", async () => {
	const { w } = harness({ presentFrames: false });
	const project = seedProject(w, 2);

	const outcome = await renderWithDeadline(w);

	assert.equal(outcome, "completed", "the export must finish instead of waiting for a frame that never comes");
	assert.equal(project.status, "done");
	assert.match(w.document.getElementById("status-text").textContent, /Bulk complete: 1 saved/);
});

test("#264 an autoplay-rejected clip is captured by seeking instead of hanging", async () => {
	const { w } = harness({ blockPlay: true });
	const project = seedProject(w, 2);

	const outcome = await renderWithDeadline(w);

	assert.equal(outcome, "completed");
	assert.equal(project.status, "done");
});

test("#264 a non-finite clip duration cannot make the frame loop unbounded", async () => {
	const { w } = harness({});
	const project = seedProject(w, Infinity);

	const outcome = await renderWithDeadline(w);

	assert.equal(outcome, "completed", "Infinity seconds used to mean an endless for-loop");
	assert.equal(project.status, "done");
	/* 9 s still + the 9 s still-length fallback for the unusable clip. */
	assert.equal(w.document.getElementById("status-text").textContent.includes("1 saved"), true);
});

test("#264 a visible clip still uses real-time playback capture", async () => {
	const { w } = harness({ presentFrames: true });
	const project = seedProject(w, 1);

	const outcome = await renderWithDeadline(w);

	assert.equal(outcome, "completed");
	assert.equal(project.status, "done");
});

/* ------------------------------------------------------------------ *
 * Image-path fixes that share the same "too slow" report.
 * ------------------------------------------------------------------ */

import vm from "node:vm";
import workerModule from "../src/index.ts";
import { BROWSER_OFFLOAD_JS } from "../src/client/browser-offload.ts";

const worker = workerModule.default || workerModule;

function offloadRuntime(fetchImpl) {
	const win = {
		navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
		document: { hidden: false },
		setTimeout, clearTimeout, Blob, URL, AbortController, fetch: fetchImpl
	};
	const context = vm.createContext({
		window: win, URL, console, setTimeout, clearTimeout, Blob, AbortController
	});
	vm.runInContext(BROWSER_OFFLOAD_JS + "\nthis.runtime = studioOffload;", context);
	return { runtime: context.runtime, win };
}

test("#264 a failed capability probe is retried instead of pinning the slow legacy path", async () => {
	let calls = 0;
	const { runtime } = offloadRuntime(async () => {
		calls += 1;
		if (calls === 1) throw new TypeError("network hiccup during boot");
		return new Response(JSON.stringify({ version: 261, binaryImages: true }),
			{ status: 200, headers: { "Content-Type": "application/json" } });
	});

	const failed = await runtime.capabilities();
	assert.equal(failed.binaryImages, undefined, "the failed probe answers empty for that call");
	await new Promise((resolve) => setTimeout(resolve, 3100));
	const caps = await runtime.capabilities();
	assert.equal(calls, 2, "a transport failure must not be cached for the session");
	assert.equal(caps.binaryImages, true, "the retry negotiates the binary path");
});

test("#264 a definitive old-server answer is still cached (asked once)", async () => {
	let calls = 0;
	const { runtime } = offloadRuntime(async () => {
		calls += 1;
		return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
	});

	const oldServer = await runtime.capabilities();
	assert.equal(oldServer.binaryImages, undefined);
	await runtime.capabilities();
	assert.equal(calls, 1, "an old Worker is never re-probed");
});

test("#264 a cancelled /image/gen request stops spending paid fallbacks", async () => {
	const controller = new AbortController();
	let modelCalls = 0;
	const env = {
		AI: {
			run: async () => {
				modelCalls += 1;
				/* The browser goes away while the provider is failing. */
				controller.abort();
				throw new Error("capacity exceeded");
			}
		}
	};
	const request = new Request("https://studio.test/image/gen?prompt=forest", { signal: controller.signal });
	const response = await worker.fetch(request, env, {});

	assert.ok(response.status >= 400, "the cancelled request is answered, not left hanging");
	assert.equal(modelCalls, 1, "no fallback model is paid for after the browser cancelled");
});

test("#264 a detached clip is mounted for capture while it renders, then put back", async () => {
	const { w } = harness({ presentFrames: true });
	const project = seedProject(w, 1);
	const clip = project.assets[1].videoEl;
	assert.equal(clip.isConnected, false, "the editor builds clips detached");

	const outcome = await renderWithDeadline(w);

	assert.equal(outcome, "completed");
	assert.equal(clip.isConnected, false, "the clip must not be left in the capture host");
	assert.equal(w.document.getElementById("clip-capture-host").children.length, 0);
});

test("#264 the clip probe resolves an Infinity duration (fragmented MP4)", async () => {
	const { w } = harness({});
	const probe = w.document.createElement("video");
	Object.defineProperty(probe, "duration", {
		configurable: true,
		get() { return this._resolved ? 7.5 : Infinity; }
	});
	Object.defineProperty(probe, "src", {
		configurable: true,
		get() { return this._src || ""; },
		set(value) {
			this._src = value;
			/* metadata arrives, but with a non-finite duration */
			setTimeout(() => this.dispatchEvent(new w.Event("loadedmetadata")), 0);
		}
	});
	Object.defineProperty(probe, "currentTime", {
		configurable: true,
		get() { return this._time || 0; },
		set(value) {
			this._time = value;
			if (value > 1000) {
				this._resolved = true;
				setTimeout(() => {
					this.dispatchEvent(new w.Event("durationchange"));
					this.dispatchEvent(new w.Event("seeked"));
				}, 0);
			}
		}
	});

	const duration = await w.__PROBE_MP4_DURATION(probe, "blob:clip");
	assert.equal(duration, 7.5, "the real length is recovered instead of Infinity");
	assert.equal(probe._time, 0, "the clip is rewound so its first frame is usable");
});

test("#264 the clip probe rejects instead of hanging when the file cannot be decoded", async () => {
	const { w } = harness({});
	const probe = w.document.createElement("video");
	Object.defineProperty(probe, "src", {
		configurable: true,
		get() { return this._src || ""; },
		set(value) {
			this._src = value;
			setTimeout(() => this.dispatchEvent(new w.Event("error")), 0);
		}
	});

	await assert.rejects(() => w.__PROBE_MP4_DURATION(probe, "blob:broken"));
});
