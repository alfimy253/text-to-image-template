import { JSDOM } from "jsdom";
import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
const PAGE = createHTML();

/* Everything the studio's exporter touches, stubbed at the DOM/WebCodecs edge. */
export function harness({ presentFrames = true, blockPlay = false, clipDuration = 2 } = {}) {
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

	const frameDurations = [];
	w.VideoFrame = class { constructor(_, init = {}) { this.timestamp = init.timestamp || 0; frameDurations.push(init.duration); } close() {} };
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

	return { w, warnings, stats: () => ({ encoded, drawCalls: drawCalls.count, frameDurations }) };
}

