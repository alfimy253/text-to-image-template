import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHTML } from "../src/page.ts";

function makeMemoryStorage(seed) {
	const map = new Map(seed ? Object.entries(seed) : []);
	return {
		get length() { return map.size; },
		key(index) { return Array.from(map.keys())[index] ?? null; },
		getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null; },
		setItem(key, value) { map.set(String(key), String(value)); },
		removeItem(key) { map.delete(String(key)); },
		clear() { map.clear(); }
	};
}

function makeCookieJar(initial = "") {
	const store = new Map();
	if (initial) {
		for (const part of String(initial).split(";")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			store.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
		}
	}
	return {
		get cookie() {
			return Array.from(store.entries()).map(([k, v]) => k + "=" + v).join("; ");
		},
		set cookie(raw) {
			const parts = String(raw || "").split(";");
			const first = parts[0] || "";
			const eq = first.indexOf("=");
			if (eq < 0) return;
			const name = first.slice(0, eq).trim();
			const val = first.slice(eq + 1).trim();
			const attrs = parts.slice(1).map((p) => p.trim().toLowerCase());
			const maxAge = attrs.find((a) => a.startsWith("max-age="));
			const expired = maxAge && Number(maxAge.slice(8)) <= 0;
			const hasPastExpires = attrs.some((a) => a.startsWith("expires=") && Date.parse(a.slice(8)) <= Date.now());
			if (expired || hasPastExpires || val === "") store.delete(name);
			else store.set(name, val);
		},
		names() { return Array.from(store.keys()); }
	};
}

function makeMemoryIndexedDB() {
	const records = new Map();
	let storeCreated = false;
	return {
		records,
		factory: {
			open() {
				const req = {};
				setTimeout(() => {
					const db = {
						objectStoreNames: { contains: (n) => n === "projects" && storeCreated || n === "assets" },
						createObjectStore: () => { storeCreated = true; return {}; },
						transaction() {
							const tx = {
								objectStore() {
									return {
										get(key) {
											const r = {};
											setTimeout(() => {
												r.result = records.get(String(key)) || null;
												r.onsuccess?.({ target: r });
												tx.oncomplete?.();
											}, 0);
											return r;
										},
										put(record) {
											const r = {};
											setTimeout(() => {
												records.set(String(record.id), record);
												r.onsuccess?.({ target: r });
												tx.oncomplete?.();
											}, 0);
											return r;
										},
										delete(key) {
											const r = {};
											setTimeout(() => {
												records.delete(String(key));
												r.onsuccess?.({ target: r });
												tx.oncomplete?.();
											}, 0);
											return r;
										}
									};
								}
							};
							return tx;
						},
						close() {}
					};
					req.result = db;
					if (!storeCreated) req.onupgradeneeded?.({ target: req });
					req.onsuccess?.({ target: req });
				}, 0);
				return req;
			}
		}
	};
}

function makeCanvasContext(canvas, opsLog) {
	return {
		canvas,
		ops: opsLog,
		globalAlpha: 1,
		font: "16px sans-serif",
		fillStyle: "#000",
		strokeStyle: "#000",
		lineWidth: 1,
		filter: "none",
		save() {},
		restore() {},
		setTransform() {},
		getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
		transform() {},
		translate() {},
		scale() {},
		rotate() {},
		clearRect() {},
		fillRect() {},
		strokeRect() {},
		beginPath() {},
		closePath() {},
		moveTo() {},
		lineTo() {},
		quadraticCurveTo() {},
		bezierCurveTo() {},
		arc() {},
		ellipse() {},
		rect() {},
		roundRect() {},
		clip() {},
		fill() {},
		stroke() {},
		setLineDash() {},
		fillText(text, x, y) { opsLog.push({ method: "fillText", text: String(text), x, y }); },
		strokeText(text, x, y) { opsLog.push({ method: "strokeText", text: String(text), x, y }); },
		drawImage(img, ...rest) { opsLog.push({ method: "drawImage", img, rest }); },
		measureText(t) { return { width: String(t || "").length * 8 }; },
		createLinearGradient() { return { addColorStop() {} }; },
		createRadialGradient() { return { addColorStop() {} }; },
		createPattern() { return {}; },
		getImageData(_x, _y, w, h) { return { data: new Uint8ClampedArray(Math.max(4, (w || 1) * (h || 1) * 4)) }; },
		putImageData() {}
	};
}

function bootFullApp({ url, localStorage, sessionStorage, cookieJar, indexedDB, probeDurations = [Number.NaN, Number.POSITIVE_INFINITY] }) {
	const html = createHTML();
	const dom = new JSDOM(html, {
		url,
		runScripts: "outside-only",
		pretendToBeVisual: true
	});
	const w = dom.window;
	const contexts = new WeakMap();
	const canvasOps = new WeakMap();
	const encodedFrames = [];
	const muxEvents = [];
	const downloads = [];
	const alerts = [];
	let urlSeq = 0;
	let probeIdx = 0;

	w.alert = (msg) => alerts.push(String(msg));
	w.confirm = () => true;
	w.scrollTo = () => {};
	w.requestAnimationFrame = () => 1;
	w.cancelAnimationFrame = () => {};
	Object.defineProperty(w.document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });

	w.HTMLCanvasElement.prototype.getContext = function () {
		if (!contexts.has(this)) {
			const ops = [];
			canvasOps.set(this, ops);
			contexts.set(this, makeCanvasContext(this, ops));
		}
		return contexts.get(this);
	};
	w.CanvasRenderingContext2D = function () {};
	w.CanvasRenderingContext2D.prototype.filter = "none";

	w.Image = function () {
		const img = w.document.createElement("img");
		Object.defineProperties(img, {
			complete: { get: () => true },
			naturalWidth: { get: () => 640 },
			naturalHeight: { get: () => 480 }
		});
		img.decode = async () => {};
		return img;
	};

	w.URL.createObjectURL = () => `blob:https://example.test/${++urlSeq}`;
	w.URL.revokeObjectURL = () => {};
	const origAnchorClick = w.HTMLAnchorElement.prototype.click;
	w.HTMLAnchorElement.prototype.click = function () {
		if (this.hasAttribute("download")) {
			downloads.push({ href: this.href, name: this.download });
			return;
		}
		return origAnchorClick.call(this);
	};

	w.Audio = class MockAudio {
		constructor(src = "") { this.src = src; this.currentTime = 0; }
		addEventListener() {}
		play() { return Promise.resolve(); }
		pause() {}
	};

	/* Strict mp4-muxer@5.1.3-faithful WebCodecs + Muxer simulation (null chunk.duration, portrait Level 4.0 rejection). */
	w.VideoFrame = class {
		constructor(canvas, opts = {}) {
			this.timestamp = opts.timestamp;
			this.duration = opts.duration;
			encodedFrames.push({ timestamp: opts.timestamp, duration: opts.duration, width: canvas.width, height: canvas.height });
		}
		close() {}
	};
	w.VideoEncoder = class {
		state = "unconfigured";
		encodeQueueSize = 0;
		static async isConfigSupported(cfg) {
			if (cfg.height > 1088 && String(cfg.codec).endsWith("28")) return { supported: false };
			return { supported: true, config: cfg };
		}
		constructor(init) { this.init = init; }
		configure(cfg) { this.state = "configured"; this.codec = cfg.codec; }
		encode(frame, opts) {
			this.init.output(
				{
					type: opts?.keyFrame ? "key" : "delta",
					timestamp: frame.timestamp,
					duration: null,
					byteLength: 24,
					copyTo(dest) { new Uint8Array(dest.buffer || dest).fill(9); }
				},
				{ decoderConfig: { codec: this.codec || "avc1.4d002a" } }
			);
		}
		async flush() { muxEvents.push("flush"); }
		close() { this.state = "closed"; }
	};
	w.Mp4Muxer = {
		ArrayBufferTarget: class { buffer = new Uint8Array(64).buffer; },
		Muxer: class {
			constructor(cfg) { this.target = cfg.target; }
			addVideoChunk(chunk, meta) {
				return this.addVideoChunkRaw(new Uint8Array(chunk.byteLength || 8), chunk.type, chunk.timestamp, chunk.duration, meta);
			}
			addVideoChunkRaw(_data, _type, timestamp, duration) {
				if (!Number.isInteger(timestamp) || timestamp < 0) throw new TypeError("timestamp must be a non-negative integer.");
				if (!Number.isInteger(duration) || duration < 0) throw new TypeError("duration must be a non-negative integer.");
				muxEvents.push("chunk");
			}
			finalize() {
				muxEvents.push("finalize");
				this.target.buffer = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]).buffer;
			}
		}
	};

	Object.defineProperty(w.HTMLMediaElement.prototype, "src", {
		configurable: true,
		get() { return this.getAttribute("src") || ""; },
		set(val) {
			this.setAttribute("src", String(val));
			const assigned = probeDurations[Math.min(probeIdx++, probeDurations.length - 1)];
			this.__assignedDuration = assigned;
			queueMicrotask(() => this.dispatchEvent(new w.Event("loadedmetadata")));
		}
	});
	Object.defineProperty(w.HTMLMediaElement.prototype, "duration", {
		configurable: true,
		get() { return "__assignedDuration" in this ? this.__assignedDuration : Number.NaN; }
	});
	Object.defineProperties(w.HTMLVideoElement.prototype, {
		readyState: { configurable: true, get() { return this.getAttribute("src") ? 4 : 0; } },
		videoWidth: { configurable: true, get() { return this.getAttribute("src") ? 1080 : 0; } },
		videoHeight: { configurable: true, get() { return this.getAttribute("src") ? 1920 : 0; } }
	});
	w.HTMLMediaElement.prototype.play = () => Promise.resolve();
	w.HTMLMediaElement.prototype.pause = () => {};

	w.fetch = async (reqUrl) => {
		if (String(reqUrl).includes("/api/session")) {
			return { ok: true, status: 200, headers: new Map(), json: async () => ({ success: true, authenticated: true, user: { username: "tester", usertype: "free" }, remaining: {} }) };
		}
		return { ok: true, status: 200, headers: new Map(), json: async () => ({}), text: async () => "" };
	};

	if (localStorage) Object.defineProperty(w, "localStorage", { configurable: true, value: localStorage });
	if (sessionStorage) Object.defineProperty(w, "sessionStorage", { configurable: true, value: sessionStorage });
	if (cookieJar) {
		Object.defineProperty(w.document, "cookie", {
			configurable: true,
			get() { return cookieJar.cookie; },
			set(v) { cookieJar.cookie = v; }
		});
	}
	if (indexedDB) Object.defineProperty(w, "indexedDB", { configurable: true, value: indexedDB });

	const rawTimeout = w.setTimeout.bind(w);
	w.setTimeout = (cb, ms, ...args) => rawTimeout(cb, Number(ms) >= 40000 ? 0 : ms, ...args);

	const inlineScripts = [...w.document.querySelectorAll("script:not([src])")].map((s) => s.textContent).join("\n");
	/* Sanity check: assembled bundle parses cleanly before execution. */
	new Function(inlineScripts);
	w.eval(inlineScripts + "\n;window.__testEditorHook = { getProject: (n) => videoProjects[n - 1], payload: (n) => collectVideoPayload(n), snapshot: () => pipelineManagementSnapshot() };");
	w.document.dispatchEvent(new w.Event("DOMContentLoaded"));

	return {
		dom,
		w,
		doc: w.document,
		encodedFrames,
		muxEvents,
		downloads,
		alerts,
		canvasOps: (el) => canvasOps.get(el) || []
	};
}

async function waitUntil(predicate, maxTicks = 50) {
	for (let i = 0; i < maxTicks; i++) {
		if (predicate()) return true;
		await new Promise((r) => setTimeout(r, 15));
	}
	return Boolean(predicate());
}

test("Editor accordion 'Add video from template' renders MP4 first, avoids NaN, and records individual scenes with child text/graphics and transitions/styles in projectDetail", async (t) => {
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();
	const idb = makeMemoryIndexedDB();

	const app = bootFullApp({
		url: "https://example.test/?layout=editor",
		localStorage,
		sessionStorage,
		cookieJar,
		indexedDB: idb.factory,
		probeDurations: [Number.NaN, Number.POSITIVE_INFINITY]
	});
	t.after(() => app.dom.window.close());
	const { w, doc } = app;

	/* Ensure Video 1 accordion exists and click its 'Add video from template' link directly. */
	if (!doc.getElementById("va-template-link-1") && typeof w.addVideoAccordion === "function") {
		w.addVideoAccordion();
	}
	const tplLink = doc.getElementById("va-template-link-1");
	assert.ok(tplLink, "Video 1 accordion renders #va-template-link-1");
	tplLink.click();

	const modal = doc.getElementById("tpl-modal");
	assert.ok(modal && modal.style.display === "flex", "clicking #va-template-link-1 opens #tpl-modal");
	assert.equal(doc.getElementById("tpl-add").textContent.trim(), "\u2795 Add to Video 1");

	/* Pick Shape Study (portrait, 2s), add a custom + Text element, and click Add to Video 1. */
	const sceneCards = [...doc.querySelectorAll(".tm-scene-card")];
	const shapeCard = sceneCards.find((card) => /Shape Study/i.test(card.textContent));
	assert.ok(shapeCard, "Shape Study Reel Scene card exists");
	shapeCard.click();

	const orient = doc.getElementById("tpl-orientation");
	orient.value = "portrait";
	orient.dispatchEvent(new w.Event("change", { bubbles: true }));
	const durInput = doc.getElementById("tpl-duration");
	durInput.value = "2";
	durInput.dispatchEvent(new w.Event("change", { bubbles: true }));

	doc.getElementById("tm-scene-add-text").click();

	let galleryCountAtFinalize = -1;
	const origFinalize = w.Mp4Muxer.Muxer.prototype.finalize;
	w.Mp4Muxer.Muxer.prototype.finalize = function () {
		galleryCountAtFinalize = doc.querySelectorAll("#va-gallery-1 .va-card").length;
		return origFinalize.call(this);
	};

	doc.getElementById("tpl-add").click();
	await waitUntil(() => doc.querySelectorAll("#va-gallery-1 .va-card").length === 1);

	assert.equal(galleryCountAtFinalize, 0, "modal renders and finalizes MP4 BEFORE adding the clip card to #va-gallery-1");
	assert.equal(app.encodedFrames.length, 60, "2s @ 30fps rendered 60 portrait frames first");
	assert.equal(app.encodedFrames[0].width, 1080);
	assert.equal(app.encodedFrames[0].height, 1920);
	assert.equal(app.downloads.length, 0, "Add to Video 1 does not download to disk");
	assert.deepEqual(app.alerts, []);

	/* Verify zero NaN/Infinity across modal status, accordion summary, card label, and tooltip. */
	const tplStatus1 = doc.getElementById("tpl-status").textContent;
	const vaSummary1 = doc.getElementById("va-summary-1").textContent;
	const cardLabel1 = doc.querySelector("#va-gallery-1 .va-card-label")?.textContent || "";
	const cardTip1 = doc.querySelector("#va-gallery-1 .va-card-tip")?.textContent || "";
	for (const str of [tplStatus1, vaSummary1, cardLabel1, cardTip1]) {
		assert.doesNotMatch(str, /NaN|Infinity/, `unexpected NaN/Infinity in "${str}"`);
	}
	assert.match(tplStatus1, /Added to Video 1 \(0:02\)/);
	assert.match(vaSummary1, /1 MP4 \(0:02\)/);

	/* Add a second template video (Pointing Up · Neon style · glow effect · 3s) with Infinity probe. */
	tplLink.click();
	const pointingCard = [...doc.querySelectorAll(".tm-scene-card")].find((card) => /Pointing Up/i.test(card.textContent));
	assert.ok(pointingCard, "Pointing Up Reel Scene card exists");
	pointingCard.click();
	durInput.value = "3";
	durInput.dispatchEvent(new w.Event("change", { bubbles: true }));
	doc.getElementById("tpl-add").click();
	await waitUntil(() => doc.querySelectorAll("#va-gallery-1 .va-card").length === 2);

	assert.match(doc.getElementById("va-summary-1").textContent, /2 MP4 \(0:05\)/, "both template clips sum cleanly without NaN");

	/* Inspect projectDetail: both template videos appear as individual scenes with child text & graphics and transitions/styles. */
	const detail = w.getEditorProjectDetail(1);
	assert.ok(detail && Array.isArray(detail.scenes), "getEditorProjectDetail(1) returns structured projectDetail");
	assert.equal(detail.scenes.length, 2, "two template clips produce two individual scenes");

	const [scene1, scene2] = detail.scenes;
	assert.equal(scene1.isTemplateScene, true);
	assert.match(scene1.name, /Shape Study/);
	assert.equal(scene1.style, "duotone");
	assert.equal(scene1.videoStyle, "Duotone");
	assert.ok(scene1.effects.includes("duotone"));
	assert.equal(scene1.transition.type, "zoom");
	assert.equal(scene1.transition.effect, "duotone");
	assert.ok(scene1.elements.some((el) => el.kind === "text" && el.key === "headline" && el.transition && el.style === "duotone"));
	assert.ok(scene1.elements.some((el) => el.kind === "text" && el.key === "text1"), "custom added text element is preserved in scene 1");
	assert.ok(scene1.elements.some((el) => el.kind === "graphic" && el.graphic === "triangle" && el.transition && el.style === "duotone"));

	assert.equal(scene2.isTemplateScene, true);
	assert.match(scene2.name, /Pointing Up/);
	assert.equal(scene2.style, "neon");
	assert.equal(scene2.videoStyle, "Neon");
	assert.ok(scene2.effects.includes("neon"));
	assert.equal(scene2.transition.type, "zoom");
	assert.equal(scene2.transition.effect, "glow");
	assert.ok(scene2.elements.some((el) => el.kind === "graphic" && el.graphic === "arrow" && el.style === "neon"));

	/* Reordering cards in #va-gallery-1 updates projectDetail scene order and startSec offsets. */
	const gallery = doc.getElementById("va-gallery-1");
	gallery.insertBefore(gallery.children[1], gallery.children[0]);
	w.syncVaOrder(1);
	const reordered = w.getEditorProjectDetail(1);
	assert.match(reordered.scenes[0].name, /Pointing Up/);
	assert.equal(reordered.scenes[0].startSec, 0);
	assert.match(reordered.scenes[1].name, /Shape Study/);
	assert.equal(reordered.scenes[1].startSec, 3);

	/* Pipeline snapshot + collectVideoPayload + localStorage + 4-cookie mirror preserve editor projectDetail without dropping scripts. */
	const topicEl = doc.getElementById("va-script-topic-1");
	if (topicEl) topicEl.value = "Retention hooks";
	const scriptBox = doc.getElementById("va-script-box-1");
	if (scriptBox) scriptBox.textContent = "Every great short starts with motion.";
	w.__testEditorHook.getProject(1).script = "Every great short starts with motion.";
	const payload = w.__testEditorHook.payload(1);
	assert.ok(payload && payload.projectDetail, "collectVideoPayload includes projectDetail");
	assert.equal(payload.projectDetail.scenes.length, 2);
	assert.ok(payload.projectDetail.scenes[0].elements.some((el) => el.kind === "graphic" && el.graphic === "arrow"));

	const snap = w.__testEditorHook.snapshot();
	assert.equal(snap.editor.projects[0].projectDetail.scenes.length, 2);
	w.__PIPELINE_MANAGEMENT_STORE__.save(snap);
	assert.ok(cookieJar.names().length <= 4, "cookie mirror stays within the 4-cookie cap");
	const loaded = w.__PIPELINE_MANAGEMENT_STORE__.load();
	assert.equal(loaded.snapshot.editor.projects[0].projectDetail.scenes.length, 2);
	assert.ok(loaded.snapshot.editor.projects[0].projectDetail.scenes[0].elements.length >= 3);
});

test("Timeline '+ Add Clips' renders MP4 first, populates child text/graphic lanes and projectDetail, prevents double-painting until edited, and syncs to Quick Batch", async (t) => {
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();
	const idb = makeMemoryIndexedDB();

	const app = bootFullApp({
		url: "https://example.test/?layout=timeline&pipelinePage=timeline-p1-row-1",
		localStorage,
		sessionStorage,
		cookieJar,
		indexedDB: idb.factory,
		probeDurations: [Number.NaN]
	});
	t.after(() => app.dom.window.close());
	const { w, doc } = app;

	await waitUntil(() => Boolean(w.__TIMELINE_EDITOR__ && w.__TIMELINE_EDITOR_STATE__));
	const api = w.__TIMELINE_EDITOR__;
	const state = w.__TIMELINE_EDITOR_STATE__;
	const mediaTrack = state.tracks.find((tr) => tr.kind === "media");
	const initialMediaCount = mediaTrack.items.length;

	/* Open #tpl-modal from Timeline's '+ Add Clips' action. */
	const addClipsBtn = doc.querySelector('[data-timeline-action="add-clips"]');
	assert.ok(addClipsBtn, "Timeline renders + Add Clips button");
	addClipsBtn.click();

	const modal = doc.getElementById("tpl-modal");
	assert.ok(modal && modal.style.display === "flex", "+ Add Clips opens #tpl-modal");
	assert.equal(doc.getElementById("tpl-add").textContent.trim(), "\u2795 Add to Video");

	/* Pick Pointing Up (Neon style, glow effect), customize headline text, set 2s duration, and click Add to Video. */
	const pointingCard = [...doc.querySelectorAll(".tm-scene-card")].find((card) => /Pointing Up/i.test(card.textContent));
	assert.ok(pointingCard);
	pointingCard.click();

	const headlineInput = [...doc.querySelectorAll("#tm-scene-inspector input[type='text'], #tm-scene-inspector textarea")]
		.find((el) => el.value && el.value.length > 0);
	if (headlineInput) {
		headlineInput.value = "WATCH THIS RISE";
		headlineInput.dispatchEvent(new w.Event("input", { bubbles: true }));
	}

	const durInput = doc.getElementById("tpl-duration");
	durInput.value = "2";
	durInput.dispatchEvent(new w.Event("change", { bubbles: true }));

	let mediaCountAtFinalize = -1;
	const origFinalize = w.Mp4Muxer.Muxer.prototype.finalize;
	w.Mp4Muxer.Muxer.prototype.finalize = function () {
		mediaCountAtFinalize = mediaTrack.items.length;
		return origFinalize.call(this);
	};

	doc.getElementById("tpl-add").click();
	await waitUntil(() => mediaTrack.items.length === initialMediaCount + 1);

	assert.equal(mediaCountAtFinalize, initialMediaCount, "Timeline modal renders MP4 FIRST before appending to Scene Media");
	assert.equal(app.encodedFrames.length, 60, "rendered 60 frames before timeline handoff");
	assert.doesNotMatch(doc.getElementById("tpl-status").textContent, /NaN|Infinity/);
	assert.match(doc.getElementById("tpl-status").textContent, /Scene Media/i);
	assert.doesNotMatch(doc.getElementById("timeline-status").textContent, /NaN|Infinity/);

	/* Inspect newly appended Scene Media clip, its child visual items, and MAX_VISUAL_TRACKS = 4 invariant. */
	const parentClip = mediaTrack.items.at(-1);
	assert.equal(parentClip.durationSec, 2);
	const visualTracks = state.tracks.filter((tr) => tr.kind === "visual");
	assert.ok(visualTracks.length <= 4, "never exceeds MAX_VISUAL_TRACKS (4)");
	for (const vt of visualTracks) {
		const sorted = [...vt.items].sort((a, b) => a.startSec - b.startSec);
		for (let i = 1; i < sorted.length; i++) {
			assert.ok(sorted[i].startSec >= sorted[i - 1].startSec + sorted[i - 1].durationSec - 1e-6, `no overlap on ${vt.id}`);
		}
	}

	const children = api.getChildElements(parentClip.id);
	assert.ok(children.length >= 3, "template clip creates bound child text and graphic items in TEXT & GRAPHICS");
	assert.ok(children.some((c) => c.kind === "text"), "has child text item(s)");
	assert.ok(children.some((c) => c.kind === "graphic" && c.graphic === "arrow"), "has child arrow graphic item");
	assert.ok(children.every((c) => c.bakedInTemplateClip === true), "fresh template children are marked bakedInTemplateClip");

	/* Inspect timeline projectDetail: individual template scene has style, transition, and child text/graphics. */
	const projectDetail = api.getProjectDetail();
	const tplScene = projectDetail.scenes.find((s) => s.id === parentClip.sceneId);
	assert.ok(tplScene, "projectDetail includes the appended template scene");
	assert.equal(tplScene.isTemplateScene, true);
	assert.equal(tplScene.style, "neon");
	assert.equal(tplScene.videoStyle, "Neon");
	assert.ok(tplScene.effects.includes("neon"));
	assert.equal(tplScene.transition.type, "zoom");
	assert.equal(tplScene.transition.effect, "glow");
	assert.ok(tplScene.elements.some((el) => el.kind === "text" && el.transition && el.style === "neon"));
	assert.ok(tplScene.elements.some((el) => el.kind === "graphic" && el.graphic === "arrow" && el.style === "neon"));

	/* Anti-double-paint verification: when the template MP4 <video> is ready, bakedInTemplateClip children do NOT paint twice;
	 * once the user edits a child text item in the inspector (or duplicates it), bakedInTemplateClip clears and it paints live! */
	const previewCanvas = doc.getElementById("timeline-preview-canvas");
	api.setPlayhead(parentClip.startSec + 0.5);
	const opsBeforeEdit = app.canvasOps(previewCanvas);
	opsBeforeEdit.length = 0;
	api.setPlayhead(parentClip.startSec + 0.6);
	const textChild = children.find((c) => c.kind === "text" && c.text);
	assert.ok(textChild);
	assert.ok(
		!opsBeforeEdit.some((op) => op.method === "fillText" && op.text.includes(textChild.text)),
		"bakedInTemplateClip suppresses duplicate canvas text painting over a decoded template MP4 frame"
	);

	/* Select child text item and edit its text in the inspector -> promotes to live overlay! */
	const clipNode = doc.querySelector(`[data-clip-id="${textChild.id}"]`);
	assert.ok(clipNode, "timeline renders clip button for template child text");
	clipNode.click();
	const inspectorText = [...doc.querySelectorAll("#timeline-inspector input[type='text'], #timeline-inspector textarea, #timeline-child-panel input[type='text'], #timeline-child-panel textarea")]
		.find((el) => el.value === textChild.text);
	assert.ok(inspectorText, "inspector renders text input for selected template child item");
	inspectorText.value = "LIVE EDITED OVERLAY";
	inspectorText.dispatchEvent(new w.Event("input", { bubbles: true }));
	assert.ok(!textChild.bakedInTemplateClip, "editing child text clears bakedInTemplateClip");

	opsBeforeEdit.length = 0;
	api.setPlayhead(parentClip.startSec + 0.7);
	assert.ok(
		opsBeforeEdit.some((op) => op.method === "fillText" && op.text.includes("LIVE EDITED OVERLAY")),
		"edited child text renders live on the timeline preview canvas"
	);

	/* Duplicating a baked-in graphic child clears bakedInTemplateClip on the duplicate. */
	const graphicChild = children.find((c) => c.kind === "graphic");
	const graphicNode = doc.querySelector(`[data-clip-id="${graphicChild.id}"]`);
	assert.ok(graphicNode, "timeline renders clip button for template child graphic");
	graphicNode.click();
	const dup = api.duplicateSelectedItem();
	assert.ok(dup, "duplicateSelectedItem duplicates child graphic");
	assert.ok(!dup.bakedInTemplateClip, "duplicated child graphic clears bakedInTemplateClip");

	/* Quick Batch sync: composeTimelineSummaryFromState preserves the template scene, its style/transition, and its child elements. */
	if (typeof w.composeTimelineSummaryFromState === "function") {
		const summary = w.composeTimelineSummaryFromState(state);
		const syncedScene = summary.projectDetail.scenes.find((s) => s.id === parentClip.sceneId);
		assert.ok(syncedScene, "Quick Batch timeline summary includes the individual template scene");
		assert.equal(syncedScene.isTemplateScene, true);
		assert.equal(syncedScene.style, "neon");
		assert.equal(syncedScene.transition.effect, "glow");
		assert.ok(syncedScene.elements.some((el) => el.kind === "text" && el.text === "LIVE EDITED OVERLAY"));
		assert.ok(syncedScene.elements.some((el) => el.kind === "graphic" && el.graphic === "arrow"));
	}
});

test("Accordion renumbering preserves #va-template-link and projectDetail, and Timeline caps visual lanes at 4 while retaining all child elements in projectDetail", async (t) => {
	/* Part A: Editor Video 2 -> delete Video 1 -> Video 2 renumbers to Video 1 with working #va-template-link-1 and intact projectDetail. */
	const editorApp = bootFullApp({
		url: "https://example.test/?layout=editor",
		localStorage: makeMemoryStorage(),
		sessionStorage: makeMemoryStorage(),
		cookieJar: makeCookieJar(),
		indexedDB: makeMemoryIndexedDB().factory,
		probeDurations: [Number.NaN]
	});
	t.after(() => editorApp.dom.window.close());

	editorApp.w.addVideoAccordion();
	const link2 = editorApp.doc.getElementById("va-template-link-2");
	assert.ok(link2, "Video 2 renders #va-template-link-2");
	link2.click();
	assert.equal(editorApp.doc.getElementById("tpl-add").textContent.trim(), "\u2795 Add to Video 2");

	const card = [...editorApp.doc.querySelectorAll(".tm-scene-card")].find((c) => /Shape Study/i.test(c.textContent));
	card.click();
	const durEl = editorApp.doc.getElementById("tpl-duration");
	durEl.value = "1";
	durEl.dispatchEvent(new editorApp.w.Event("change", { bubbles: true }));
	editorApp.doc.getElementById("tpl-add").click();
	await waitUntil(() => editorApp.doc.querySelectorAll("#va-gallery-2 .va-card").length === 1);

	/* Delete Video 1 so Video 2 renumbers into Video 1 via restoreVideoAccordionState. */
	editorApp.w.deleteVideoAccordion(1);
	const reboundLink1 = editorApp.doc.getElementById("va-template-link-1");
	assert.ok(reboundLink1, "renumbered Video 1 renders #va-template-link-1");
	reboundLink1.click();
	assert.equal(editorApp.doc.getElementById("tpl-add").textContent.trim(), "\u2795 Add to Video 1");
	const detailAfterDelete = editorApp.w.getEditorProjectDetail(1);
	assert.equal(detailAfterDelete.scenes.length, 1);
	assert.equal(detailAfterDelete.scenes[0].isTemplateScene, true);
	assert.equal(detailAfterDelete.scenes[0].style, "duotone");
	assert.ok(detailAfterDelete.scenes[0].elements.some((el) => el.kind === "graphic" && el.graphic === "triangle"));

	/* Part B: Timeline Download MP4 with 7 child elements caps visual lanes at 4 while preserving all 7 in projectDetail. */
	const tlApp = bootFullApp({
		url: "https://example.test/?layout=timeline&pipelinePage=timeline-p1-row-2",
		localStorage: makeMemoryStorage(),
		sessionStorage: makeMemoryStorage(),
		cookieJar: makeCookieJar(),
		indexedDB: makeMemoryIndexedDB().factory,
		probeDurations: [Number.POSITIVE_INFINITY]
	});
	t.after(() => tlApp.dom.window.close());

	await waitUntil(() => Boolean(tlApp.w.__TIMELINE_EDITOR__ && tlApp.w.__TIMELINE_EDITOR_STATE__));
	const api = tlApp.w.__TIMELINE_EDITOR__;
	const state = tlApp.w.__TIMELINE_EDITOR_STATE__;
	const mediaTrack = state.tracks.find((tr) => tr.kind === "media");
	const beforeCount = mediaTrack.items.length;

	tlApp.doc.querySelector('[data-timeline-action="add-clips"]').click();
	const tlCard = [...tlApp.doc.querySelectorAll(".tm-scene-card")].find((c) => /Shape Study/i.test(c.textContent));
	tlCard.click();
	/* Shape Study starts with 4 elements (eyebrow, headline, sub, graphic); add 3 more text elements = 7 total. */
	tlApp.doc.getElementById("tm-scene-add-text").click();
	tlApp.doc.getElementById("tm-scene-add-text").click();
	tlApp.doc.getElementById("tm-scene-add-text").click();

	const tlDur = tlApp.doc.getElementById("tpl-duration");
	tlDur.value = "1";
	tlDur.dispatchEvent(new tlApp.w.Event("change", { bubbles: true }));

	tlApp.doc.getElementById("tpl-export").click();
	await waitUntil(() => mediaTrack.items.length === beforeCount + 1);

	assert.equal(tlApp.downloads.length, 1, "Download MP4 downloads the rendered file");
	const visualTracks = state.tracks.filter((tr) => tr.kind === "visual");
	assert.equal(visualTracks.length, 4, "visual tracks capped at MAX_VISUAL_TRACKS = 4");
	const appendedScene = api.getProjectDetail().scenes.find((s) => s.id === mediaTrack.items.at(-1).sceneId);
	assert.ok(appendedScene);
	assert.equal(appendedScene.elements.length, 7, "all 7 template child elements are preserved in scene projectDetail even when visual lanes cap at 4");
});
