import { JSDOM } from "jsdom";
import { TEMPLATE_COMPOSER_JS } from "../src/client/template-composer-js.ts";

function multiply(m, n) {
	return {
		a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
		c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
		e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f
	};
}
const identity = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

function makeContext(canvas) {
	let matrix = identity();
	const stack = [];
	const context = {
		canvas,
		ops: [],
		globalAlpha: 1,
		font: "16px Arial",
		filter: "none",
		save() { stack.push({ matrix: { ...matrix }, alpha: this.globalAlpha }); },
		restore() {
			const old = stack.pop();
			if (old) { matrix = old.matrix; this.globalAlpha = old.alpha; }
		},
		setTransform(a, b, c, d, e, f) { matrix = typeof a === "object" ? { ...a } : { a, b, c, d, e, f }; },
		getTransform() { return { ...matrix }; },
		transform(a, b, c, d, e, f) { matrix = multiply(matrix, { a, b, c, d, e, f }); },
		translate(x, y) { matrix = multiply(matrix, { ...identity(), e: x, f: y }); },
		scale(x, y) { matrix = multiply(matrix, { ...identity(), a: x, d: y }); },
		rotate(angle) {
			matrix = multiply(matrix, { a: Math.cos(angle), b: Math.sin(angle), c: -Math.sin(angle), d: Math.cos(angle), e: 0, f: 0 });
			this.ops.push({ method: "rotate", angle });
		},
		measureText(text) { return { width: String(text).length * (Number(this.font.match(/([\d.]+)px/)?.[1]) || 16) * 0.55 }; },
		createLinearGradient() { return { addColorStop() {} }; },
		createRadialGradient() { return { addColorStop() {} }; },
		createPattern() { return {}; },
		getImageData() { return { data: new Uint8ClampedArray(4) }; }
	};
	const methods = ["clearRect", "fillRect", "strokeRect", "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo", "arc", "ellipse", "rect", "roundRect", "clip", "fill", "stroke", "setLineDash", "fillText", "strokeText", "drawImage", "putImageData"];
	for (const method of methods) {
		context[method] = function (...args) {
			this.ops.push({ method, args, matrix: { ...matrix }, alpha: this.globalAlpha, fillStyle: this.fillStyle });
		};
	}
	return context;
}

export function composerHarness() {
	const dom = new JSDOM("<!doctype html><html><body></body></html>", {
		url: "https://studio.test/free", runScripts: "outside-only", pretendToBeVisual: true
	});
	const w = dom.window;
	const contexts = new WeakMap();
	const objectUrls = new Map();
	const revoked = [];
	const downloads = [];
	const alerts = [];
	const frames = [];
	let urlCounter = 0;
	w.HTMLCanvasElement.prototype.getContext = function () {
		if (!contexts.has(this)) contexts.set(this, makeContext(this));
		return contexts.get(this);
	};
	w.CanvasRenderingContext2D = function () {};
	w.CanvasRenderingContext2D.prototype.filter = "none";
	w.Image = function () {
		const image = w.document.createElement("img");
		Object.defineProperties(image, {
			complete: { get: () => true },
			naturalWidth: { get: () => 640 },
			naturalHeight: { get: () => 480 }
		});
		image.decode = async () => {
			const file = objectUrls.get(image.src);
			if (file?.name?.includes("corrupt")) throw new Error("Invalid image");
			if (file?.delay) await file.delay;
		};
		return image;
	};
	w.URL.createObjectURL = (file) => {
		const url = `blob:https://studio.test/${++urlCounter}`;
		objectUrls.set(url, file);
		return url;
	};
	w.URL.revokeObjectURL = (url) => { revoked.push(url); objectUrls.delete(url); };
	w.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, name: this.download }); };
	Object.defineProperty(w.document, "fonts", { value: { ready: Promise.resolve() } });
	w.requestAnimationFrame = () => 1;
	w.cancelAnimationFrame = () => {};
	w.alert = (message) => alerts.push(message);
	w.videoProjects = [{ assets: [] }, { assets: [] }];
	w.videoCounts = (project) => ({ clips: project.assets.filter((asset) => asset.kind === "mp4").length });
	w.MAX_MP4_UPLOADS = 5;
	w.MP4_MAX_DURATION_S = 60;
	w.formatSeconds = (seconds) => `${seconds}s`;
	w.buildVaCard = (_n, asset) => { asset.card = {}; };
	w.updateVideoStatus = () => {};
	w.toggleVideoAccordion = () => {};
	w.toggleGalleryScroll = () => {};

	// Stub only the codecs/muxer, not the composer render loop.
	w.VideoEncoder = class {
		state = "unconfigured";
		encodeQueueSize = 0;
		constructor(config) { this.config = config; }
		configure() { this.state = "configured"; }
		encode(frame) { this.config.output({ timestamp: frame.timestamp }, {}); }
		async flush() {}
		close() { this.state = "closed"; }
	};
	w.VideoFrame = class {
		constructor(canvas, options) { this.timestamp = options.timestamp; frames.push({ canvas, timestamp: this.timestamp }); }
		close() {}
	};
	w.Mp4Muxer = {
		ArrayBufferTarget: class { buffer = new ArrayBuffer(8); },
		Muxer: class {
			constructor(config) { this.target = config.target; }
			addVideoChunk() {}
			finalize() {}
		}
	};
	Object.defineProperty(w.HTMLMediaElement.prototype, "src", {
		configurable: true,
		set(value) { this.setAttribute("src", value); queueMicrotask(() => this.dispatchEvent(new w.Event("loadedmetadata"))); },
		get() { return this.getAttribute("src"); }
	});
	Object.defineProperty(w.HTMLMediaElement.prototype, "duration", { get: () => 1 });

	// Test-only closure access. No debug globals are shipped in the application.
	const code = TEMPLATE_COMPOSER_JS.replace(/\t\}\)\(\);\s*$/, `
		window.__composerTest = {
			openScene: reelOpenSceneEditor,
			select: reelSelectSceneElement,
			state: () => reelSelectedState(),
			keys: () => reelElementKeys(reelSelectedState()),
			scenes: REEL_SCENES,
			graphics: REEL_GRAPHIC_OBJECTS,
			upload: files => ringUploadFiles({target: {files, value: ""}}, reelSelectedState()),
			export: options => exportMP4(options),
			addToVideo: () => addTemplateToVideo(),
			hitTest: reelHitTest,
			renderGraphic: (time = 0) => {
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.globalAlpha = 1;
				const state = reelSelectedState();
				reelDrawGraphic(ctx, TPL_W, TPL_H, TPL_W / 1120, time, state, "graphic", state.elements.graphic, []);
			},
			hitAreas: () => reelSceneHitAreas,
			render: (time = 2, exportingFrame = false) => {
				const previous = exporting;
				exporting = exportingFrame;
				try { drawScene(ctx, TPL_W, TPL_H, time, currentVarDef(), current()); }
				finally { exporting = previous; }
			}
		};
	})();`);
	w.eval(code);
	w.openTemplateModal(1);
	const api = w.__composerTest;
	return {
		window: w, document: w.document, api, revoked, objectUrls, downloads, alerts, frames,
		context: () => w.document.querySelector("#tpl-canvas").getContext("2d"),
		files: (count, prefix = "image") => Array.from({ length: count }, (_, i) => new w.File(["image"], `${prefix}-${i + 1}.png`, { type: "image/png" })),
		button(text, root = w.document) {
			return [...root.querySelectorAll("button")].find((button) => button.textContent.trim() === text);
		},
		field(label) {
			return [...w.document.querySelectorAll(".tm-scene-field")].find((field) => field.querySelector(".tm-scene-field-label")?.textContent === label);
		},
		change(input, value, type = "input") {
			input.value = String(value);
			input.dispatchEvent(new w.Event(type, { bubbles: true }));
		},
		close() { dom.window.close(); }
	};
}
