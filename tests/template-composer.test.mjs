import assert from "node:assert/strict";
import test from "node:test";
import { composerHarness } from "./composer-harness.mjs";

function harness(t, scene = 0) {
	const h = composerHarness();
	t.after(() => h.close());
	if (scene !== null) h.api.openScene(scene);
	return h;
}

test("gallery contains 15 scenes and no graphics/shape template tab or cards", (t) => {
	const h = harness(t, null);
	assert.equal(h.document.querySelectorAll(".tm-scene-card").length, 15);
	assert.equal(h.document.querySelectorAll(".tm-gallery-tab").length, 1);
	assert.equal(h.document.querySelector("#tm-tab-shapes, #tm-shape-grid, .tm-shape-card"), null);
	assert.equal(h.document.querySelector(".tm-scene-switcher, #tm-scene-list"), null);
	assert.equal(h.document.querySelector(".tm-scene-sticker-grid, .tm-scene-sticker"), null);
	assert.doesNotMatch(h.document.querySelector("#tm-scene-controls").textContent, /editable designs|Shapes & stickers/);
});

test("delete action sits beside + Text/+ Graphic and deletes/restores the selected element", (t) => {
	const h = harness(t);
	const add = h.document.querySelector("#tm-scene-add-text");
	const remove = h.document.querySelector("#tm-scene-delete");
	assert.ok(add);
	assert.ok(remove);
	assert.equal(add.parentElement, remove.parentElement);
	assert.equal(remove.previousElementSibling, add);
	assert.equal(remove.hidden, false);
	assert.equal(remove.disabled, false);
	remove.click();
	assert.equal(h.api.state().elements.headline.deleted, true);
	assert.equal(h.api.state().elements.headline.visible, false);
	assert.equal(remove.hidden, true);
	h.api.select("headline");
	assert.equal(h.document.querySelector("#tm-scene-inspector button").textContent, "Restore element");
	h.button("Restore element").click();
	assert.equal(h.api.state().elements.headline.deleted, false);
	assert.equal(remove.hidden, false);
	h.api.select("bg");
	assert.equal(remove.hidden, true);
});

test("all 13 animated objects are in Graphics, alongside the original nine shapes", (t) => {
	const h = harness(t);
	h.api.select("graphic");
	const options = [...h.field("Graphics").querySelector("select").options];
	assert.equal(options.length, 22);
	assert.equal(options.filter((option) => option.value.startsWith("motion:")).length, 13);
	assert.equal(Object.keys(h.api.graphics).length, 13);
	for (const name of ["Morphing SVG Blob", "Rotating 3D Box", "Pulsing Ripple Ring", "Floating Glass Card", "Orbiting Satellite", "DNA Helix Pulse", "Infinite Tunnel Zoom", "Kaleidoscope Spinner", "Elastic Bounce Ball", "Audio Equalizer Bars", "Diamond Crystal Spin", "Neon Laser Beam", "Shimmer Spinner Ring"]) {
		assert.ok(options.some((option) => option.textContent === name), name);
	}
	assert.ok(!options.some((option) => /confetti|particle/i.test(option.textContent)));
});

test("animated graphics remain selectable, editable and rendered inside every Reel template", (t) => {
	const h = harness(t);
	for (let scene = 0; scene < 14; scene++) {
		h.api.openScene(scene);
		h.api.select("graphic");
		assert.equal(h.field("Graphics").querySelectorAll("option").length, 22);
		assert.ok(h.button("+ Front layer"));
		assert.ok(h.button("- Back Layer"));
		assert.ok(h.button("+ Front layer").classList.contains("tm-tool"));
		assert.ok(h.button("- Back Layer").classList.contains("tm-tool"));
		assert.ok(h.field("Rotate degrees"));
	}
	for (const kind of Object.keys(h.api.graphics)) {
		h.change(h.field("Graphics").querySelector("select"), kind, "change");
		const element = h.api.state().elements.graphic;
		assert.equal(element.kind, kind);
		assert.equal(element.visible, true);
		assert.equal(element.size, 240);
		assert.ok(h.field("Accent color"));
		h.context().ops.length = 0;
		h.api.render(2, true);
		assert.ok(h.context().ops.some((op) => ["fill", "stroke", "strokeRect"].includes(op.method)));
	}
});

test("all animated graphics respect the scene element's fade transition", (t) => {
	const h = harness(t);
	h.api.select("graphic");
	for (const kind of Object.keys(h.api.graphics)) {
		h.change(h.field("Graphics").querySelector("select"), kind, "change");
		h.api.state().elements.graphic.transition = "fade";
		h.context().ops.length = 0;
		h.api.renderGraphic(0);
		const paint = h.context().ops.filter((op) => ["fill", "stroke", "fillRect", "strokeRect"].includes(op.method));
		assert.ok(paint.length > 0, kind);
		assert.ok(paint.every((op) => op.alpha === 0), kind);
	}
});

test("+ Front layer and - Back Layer change paint order and topmost canvas selection", (t) => {
	const h = harness(t);
	const state = h.api.state();
	for (const element of Object.values(state.elements)) {
		element.visible = true;
		element.x = 50;
		element.y = 50;
		element.anim = "none";
		element.transition = "none";
	}
	h.api.select("headline");
	assert.deepEqual(Array.from(h.api.keys()), ["eyebrow", "headline", "sub", "graphic"]);
	h.button("+ Front layer").click();
	assert.deepEqual(Array.from(h.api.keys()), ["eyebrow", "sub", "headline", "graphic"]);
	h.button("+ Front layer").click();
	assert.equal(h.api.keys().at(-1), "headline");
	assert.equal(h.button("+ Front layer").disabled, true);
	h.api.render(2);
	assert.equal(h.api.hitTest({ x: 960, y: 540 }), "headline");
	h.context().ops.length = 0;
	h.api.render(2, true);
	const paint = h.context().ops.filter((op) => ["fill", "fillText"].includes(op.method));
	assert.equal(paint.at(-1).args[0], state.elements.headline.text);
	h.button("- Back Layer").click();
	assert.equal(h.api.keys().at(-1), "graphic");
	h.api.render(2);
	assert.equal(h.api.hitTest({ x: 960, y: 540 }), "graphic");
	while (!h.button("- Back Layer").disabled) h.button("- Back Layer").click();
	assert.equal(h.api.keys()[0], "headline");
	assert.ok(!h.api.keys().includes("bg"));
});

test("0–360° rotation changes real text and graphic transforms in preview and export frames", (t) => {
	const h = harness(t);
	for (const key of ["headline", "graphic"]) {
		h.api.select(key);
		const element = h.api.state().elements[key];
		element.visible = true;
		element.anim = "none";
		element.transition = "none";
		const field = h.field("Rotate degrees");
		const range = field.querySelector("input");
		assert.equal(range.min, "0");
		assert.equal(range.max, "360");
		h.change(range, 90);
		assert.equal(element.rotation, 90);
		assert.equal(field.querySelector("output").textContent, "90°");
		for (const exporting of [false, true]) {
			h.context().ops.length = 0;
			h.api.render(2, exporting);
			assert.ok(h.context().ops.some((op) => op.method === "rotate" && Math.abs(op.angle - Math.PI / 2) < 1e-9));
		}
	}
});

test("rotated hit boxes follow the element instead of its unrotated rectangle", (t) => {
	const h = harness(t);
	const elements = h.api.state().elements;
	for (const element of Object.values(elements)) element.visible = false;
	const element = elements.headline;
	Object.assign(element, { visible: true, text: "Long text", rotation: 90, anim: "none", transition: "none" });
	h.api.select("headline");
	h.api.render(2);
	const area = h.api.hitAreas().find((area) => area.key === "headline");
	assert.ok(area.height > area.width);
	assert.equal(h.api.hitTest({ x: 960, y: 1080 * element.y / 100 + 130 }), "headline");
	assert.equal(h.api.hitTest({ x: 1090, y: 1080 * element.y / 100 }), "bg");
});

test("adding a graphic copies its animated object, colours and rotation and paints it on top", (t) => {
	const h = harness(t);
	h.api.select("graphic");
	h.change(h.field("Graphics").querySelector("select"), "motion:cube", "change");
	h.change(h.field("Rotate degrees").querySelector("input"), 37);
	h.button("＋ Graphic").click();
	const state = h.api.state();
	assert.equal(state.elements.graphic2.kind, "motion:cube");
	assert.equal(state.elements.graphic2.rotation, 37);
	assert.equal(state.elements.graphic2.accent, state.elements.graphic.accent);
	assert.equal(h.api.keys().at(-1), "graphic2");
});

test("layer and rotation edits persist between template changes and modal reopen", (t) => {
	const h = harness(t);
	h.api.select("headline");
	h.change(h.field("Rotate degrees").querySelector("input"), 120);
	h.button("+ Front layer").click();
	const order = Array.from(h.api.keys());
	h.api.openScene(1);
	h.api.openScene(0);
	assert.equal(h.api.state().elements.headline.rotation, 120);
	assert.deepEqual(Array.from(h.api.keys()), order);
	h.window.closeTemplateModal();
	h.window.openTemplateModal(2);
	h.api.openScene(0);
	assert.equal(h.api.state().elements.headline.rotation, 120);
	assert.deepEqual(Array.from(h.api.keys()), order);
});

test("ring image upload is the bottom accordion, only on the ring template", (t) => {
	const h = harness(t, 14);
	const accordion = h.document.querySelector("#tm-ring-upload");
	assert.equal(accordion.parentNode.id, "tm-scene-controls");
	assert.equal(accordion.parentNode.lastElementChild, accordion);
	assert.equal(accordion.hidden, false);
	assert.equal(h.document.querySelector("#tm-ring-files").multiple, true);
	assert.equal(h.document.querySelector("#tpl-export").disabled, true);
	assert.equal(h.document.querySelector("#tpl-add").disabled, true);
	h.api.openScene(0);
	assert.equal(accordion.hidden, true);
	assert.equal(h.document.querySelector("#tpl-export").disabled, false);
});

test("ring rejects 4/8 files and non-image files without altering an existing valid set", async (t) => {
	const h = harness(t, 14);
	for (const count of [4, 8]) {
		await h.api.upload(h.files(count));
		assert.equal(h.api.state().ringImages.length, 0);
		assert.match(h.document.querySelector("#tm-ring-status").textContent, /Choose 5–7 images together/);
		assert.equal(h.document.querySelector("#tpl-export").disabled, true);
	}
	await h.api.upload(h.files(5));
	const urls = h.api.state().ringImages.map((entry) => entry.url);
	await h.api.upload(h.files(8));
	assert.deepEqual(Array.from(h.api.state().ringImages, (entry) => entry.url), Array.from(urls));
	const files = h.files(5);
	files[3] = new h.window.File(["text"], "not-an-image.txt", { type: "text/plain" });
	await h.api.upload(files);
	assert.match(h.document.querySelector("#tm-ring-status").textContent, /Only image files/);
	assert.deepEqual(Array.from(h.api.state().ringImages, (entry) => entry.url), Array.from(urls));
});

test("5 and 7 uploaded images drive the real preview and export card count", async (t) => {
	const h = harness(t, 14);
	for (const count of [5, 7]) {
		await h.api.upload(h.files(count));
		assert.equal(h.document.querySelectorAll(".tm-ring-thumb").length, count);
		assert.equal(h.api.state().ringImages.length, count);
		assert.equal(h.document.querySelector("#tpl-export").disabled, false);
		assert.equal(h.document.querySelector("#tpl-add").disabled, false);
		const images = h.api.state().ringImages.map((entry) => entry.image);
		for (const exporting of [false, true]) {
			h.context().ops.length = 0;
			h.api.render(2, exporting);
			const cards = h.context().ops.filter((op) => op.method === "drawImage" && images.includes(op.args[0]));
			assert.equal(cards.length, count);
		}
	}
});

test("replacement/removal revokes object URLs and removal never drops below five images", async (t) => {
	const h = harness(t, 14);
	await h.api.upload(h.files(7));
	const oldUrls = Array.from(h.api.state().ringImages, (entry) => entry.url);
	h.document.querySelector(".tm-ring-remove").click();
	assert.equal(h.api.state().ringImages.length, 6);
	h.document.querySelector(".tm-ring-remove").click();
	assert.equal(h.api.state().ringImages.length, 5);
	assert.ok([...h.document.querySelectorAll(".tm-ring-remove")].every((button) => button.disabled));
	h.document.querySelector(".tm-ring-remove").click();
	assert.equal(h.api.state().ringImages.length, 5);
	await h.api.upload(h.files(5, "replacement"));
	assert.ok(oldUrls.every((url) => h.revoked.includes(url)));
	assert.equal(h.api.state().ringImages[0].name, "replacement-1.png");
});

test("corrupt image batches are atomic and staged object URLs are cleaned up", async (t) => {
	const h = harness(t, 14);
	await h.api.upload(h.files(5));
	const urls = Array.from(h.api.state().ringImages, (entry) => entry.url);
	const files = h.files(5);
	files[2] = h.files(1, "corrupt")[0];
	const liveBefore = h.objectUrls.size;
	await h.api.upload(files);
	assert.deepEqual(Array.from(h.api.state().ringImages, (entry) => entry.url), urls);
	assert.equal(h.objectUrls.size, liveBefore);
	assert.match(h.document.querySelector("#tm-ring-status").textContent, /could not be read/);
	assert.equal(h.document.querySelector("#tpl-export").disabled, false);
});

test("late image decodes cannot overwrite a newer upload", async (t) => {
	const h = harness(t, 14);
	let release;
	const delayed = h.files(5, "older");
	delayed[0].delay = new Promise((resolve) => { release = resolve; });
	const first = h.api.upload(delayed);
	assert.equal(h.document.querySelector("#tpl-export").disabled, true);
	await h.api.upload(h.files(7, "newer"));
	release();
	await first;
	assert.equal(h.api.state().ringImages.length, 7);
	assert.equal(h.api.state().ringImages[0].name, "newer-1.png");
	assert.equal(h.objectUrls.size, 7);
});

test("an upload finishing after a template switch does not reveal ring controls on another template", async (t) => {
	const h = harness(t, 14);
	let release;
	const files = h.files(5);
	files[0].delay = new Promise((resolve) => { release = resolve; });
	const upload = h.api.upload(files);
	h.api.openScene(0);
	release();
	await upload;
	assert.equal(h.document.querySelector("#tm-ring-upload").hidden, true);
	assert.equal(h.document.querySelector("#tpl-export").disabled, false);
	h.api.openScene(14);
	assert.equal(h.api.state().ringImages.length, 5);
	assert.equal(h.document.querySelector("#tm-ring-upload").hidden, false);
	assert.equal(h.document.querySelector("#tpl-export").disabled, false);
});

test("ring rotation is functional and resetting transforms preserves uploaded images", async (t) => {
	const h = harness(t, 14);
	await h.api.upload(h.files(5));
	h.change(h.field("Rotate degrees").querySelector("input"), 45);
	h.context().ops.length = 0;
	h.api.render(2, true);
	assert.ok(h.context().ops.some((op) => op.method === "rotate" && Math.abs(op.angle - Math.PI / 4) < 1e-9));
	h.button("Reset carousel").click();
	assert.equal(h.api.state().elements.carousel.rotation, 0);
	assert.equal(h.api.state().ringImages.length, 5);
});

test("both export actions enforce ring minimum; valid uploads use the shared MP4 render loop", async (t) => {
	const h = harness(t, 14);
	assert.equal(await h.api.export({ download: false }), null);
	await h.api.addToVideo();
	assert.equal(h.frames.length, 0);
	assert.equal(h.window.videoProjects[0].assets.length, 0);
	await h.api.upload(h.files(5));
	const duration = h.document.querySelector("#tpl-duration");
	h.change(duration, 1, "change");
	await h.api.export({ download: true });
	assert.equal(h.frames.length, 30);
	assert.equal(h.downloads.length, 1);
	await h.api.addToVideo();
	assert.equal(h.frames.length, 60);
	assert.equal(h.downloads.length, 1, "Add to Video must not trigger a download");
	assert.equal(h.window.videoProjects[0].assets.length, 1);
	assert.equal(h.window.videoProjects[0].assets[0].kind, "mp4");
	assert.deepEqual(h.alerts, []);
});

test("on the timeline page Download MP4 also appends the clip to the end of Scene Media", async (t) => {
	const h = harness(t, 0);
	const duration = h.document.querySelector("#tpl-duration");
	h.change(duration, 1, "change");

	const landed = [];
	h.window.__TIMELINE_TEMPLATE_CLIP__ = (clip) => { landed.push(clip); return 1; };
	/* The timeline page builds/opens the modal after its sink exists. */
	h.window.openTemplateModal(1);
	assert.equal(h.document.querySelector("#tpl-add").textContent.trim(), "\u2795 Add to Video", "the modal keeps the studio's Add to Video wording and drops the invisible Video N number");

	await h.api.export({ download: true });
	assert.equal(h.frames.length, 30, "the clip is rendered once");
	assert.equal(h.downloads.length, 1, "Download MP4 still downloads the file");
	assert.equal(landed.length, 1, "and the same render is handed to the timeline");
	assert.equal(landed[0].durationSec, 1, "with its own length");
	assert.ok(landed[0].blob instanceof h.window.Blob, "and its media bytes");
	assert.match(h.document.querySelector("#tpl-status").textContent, /Scene Media/i, "the modal says where the clip landed");
	assert.equal(h.document.querySelector("#tpl-add").textContent.trim(), "\u2795 Add to Video");

	/* The Add button hands over without downloading, and never fills the gallery. */
	await h.api.addToVideo();
	assert.equal(landed.length, 2, "Add to Video appends another clip");
	assert.equal(h.downloads.length, 1, "Add never downloads");
	assert.equal(h.window.videoProjects[0].assets.length, 0, "the hidden Video N gallery stays empty");

	/* With no sink the modal is the editor layout's again. */
	delete h.window.__TIMELINE_TEMPLATE_CLIP__;
	h.window.openTemplateModal(1);
	assert.equal(h.document.querySelector("#tpl-add").textContent.trim(), "\u2795 Add to Video 1", "the editor layout keeps its numbered gallery label");
	await h.api.addToVideo();
	assert.equal(h.window.videoProjects[0].assets.length, 1, "and its gallery path still fills the accordion");
});

test("render-first MP4 muxes finite microsecond durations (mp4-muxer@5.1.3), falls back to Level 4.2 in portrait, and never emits NaN on NaN/Infinity probes", async (t) => {
	const h = harness(t, null);
	h.api.openScene(h.api.scenes.findIndex((s) => s.name === "Shape Study"));
	const frameDurations = [];
	const muxedDurations = [];
	const configuredCodecs = [];

	/* Reproduce mp4-muxer@5.1.3's strict addVideoChunkRaw duration check and null chunk.duration from VideoEncoder. */
	h.window.VideoFrame = class {
		constructor(canvas, options) {
			this.timestamp = options.timestamp;
			this.duration = options.duration;
			frameDurations.push(options.duration);
			h.frames.push({ canvas, timestamp: this.timestamp, duration: this.duration });
		}
		close() {}
	};
	h.window.VideoEncoder = class {
		state = "unconfigured";
		encodeQueueSize = 0;
		static async isConfigSupported(cfg) {
			/* Reject Level 4.0 (*28) at 1080x1920 portrait; accept Level 4.2 (*2a). */
			if (cfg.height > 1088 && cfg.codec.endsWith("28")) return { supported: false };
			return { supported: true, config: cfg };
		}
		constructor(config) { this.config = config; }
		configure(cfg) { this.state = "configured"; configuredCodecs.push(cfg.codec); }
		encode(frame, opts) {
			const chunk = {
				type: opts?.keyFrame ? "key" : "delta",
				timestamp: frame.timestamp,
				duration: null,
				byteLength: 16,
				copyTo(dest) { new Uint8Array(dest.buffer || dest).fill(7); }
			};
			this.config.output(chunk, { decoderConfig: { codec: configuredCodecs.at(-1) || "avc1.4d002a" } });
		}
		async flush() {}
		close() { this.state = "closed"; }
	};
	h.window.Mp4Muxer.Muxer = class {
		constructor(config) { this.target = config.target; }
		addVideoChunk(chunk, meta) {
			return this.addVideoChunkRaw(new Uint8Array(chunk.byteLength || 8), chunk.type, chunk.timestamp, chunk.duration, meta);
		}
		addVideoChunkRaw(_data, _type, timestamp, duration) {
			if (!Number.isInteger(timestamp) || timestamp < 0) throw new TypeError("timestamp must be a non-negative integer.");
			if (!Number.isInteger(duration) || duration < 0) throw new TypeError("duration must be a non-negative integer.");
			muxedDurations.push(duration);
		}
		finalize() {
			this.target.buffer = new Uint8Array(64).buffer;
		}
	};

	/* Hostile detached <video> probe returning NaN on editor add, then Infinity on timeline add, plus blank duration input. */
	let probeCycle = 0;
	Object.defineProperty(h.window.HTMLMediaElement.prototype, "duration", {
		configurable: true,
		get() { return probeCycle++ % 2 === 0 ? Number.NaN : Number.POSITIVE_INFINITY; }
	});

	const orient = h.document.querySelector("#tpl-orientation");
	h.change(orient, "portrait", "change");
	const durationInput = h.document.querySelector("#tpl-duration");
	h.change(durationInput, "", "input");
	assert.doesNotMatch(h.document.querySelector("#tpl-status").textContent, /NaN/);
	h.change(durationInput, 2, "change");

	/* Clicking Add to Video renders MP4 first, then adds to Video 1 with finite duration and Reel Scene filename. */
	h.document.querySelector("#tpl-add").click();
	for (let i = 0; i < 30 && h.window.videoProjects[0].assets.length === 0; i++) {
		await new Promise((r) => setTimeout(r, 10));
	}

	assert.equal(configuredCodecs[0], "avc1.4d002a", "portrait 1080x1920 selects Level 4.2 Main Profile");
	assert.equal(frameDurations.length, 60, "2s @ 30fps renders 60 frames before adding");
	assert.ok(frameDurations.every((d) => Number.isInteger(d) && d > 0), "every VideoFrame carries finite integer microsecond duration");
	assert.equal(muxedDurations.length, 60, "all 60 chunks muxed cleanly through strict addVideoChunkRaw");
	assert.equal(h.downloads.length, 0, "Add to Video never downloads");
	assert.equal(h.window.videoProjects[0].assets.length, 1);
	const added = h.window.videoProjects[0].assets[0];
	assert.equal(added.duration, 2, "NaN probe falls back to the rendered clip duration");
	assert.match(added.name, /^template_shape_study_portrait\.mp4$/, "filename reflects active Reel Scene and orientation");
	assert.doesNotMatch(h.document.querySelector("#tpl-status").textContent, /NaN|Infinity/);

	/* Real DOM click on #tpl-export passes a MouseEvent and must still trigger a download. */
	h.document.querySelector("#tpl-export").click();
	for (let i = 0; i < 30 && h.downloads.length === 0; i++) {
		await new Promise((r) => setTimeout(r, 10));
	}
	assert.equal(h.downloads.length, 1, "DOM click on Download MP4 downloads the rendered file");
});

test("templateScene captures individual scene style, transition, child text, graphics, motion shapes, and 3D Ring Carousel", async (t) => {
	const h = harness(t, null);
	h.api.openScene(h.api.scenes.findIndex((s) => s.name === "Shape Study"));
	const durationInput = h.document.querySelector("#tpl-duration");
	h.change(durationInput, 2, "change");

	/* Customize Shape Study: add a custom text element, add a custom motion graphic element, and hide eyebrow. */
	h.api.state().elements.eyebrow.visible = false;
	h.api.select("headline");
	h.document.querySelector("#tm-scene-add-text").click();
	const motionKey = Object.keys(h.api.graphics)[0];
	h.api.select("graphic");
	h.document.querySelector("#tm-scene-add-text").click();
	h.change(h.field("Graphics").querySelector("select"), motionKey, "change");

	await h.api.addToVideo();
	const reelAsset = h.window.videoProjects[0].assets[0];
	assert.ok(reelAsset.templateScene, "added MP4 asset carries templateScene metadata");
	assert.equal(reelAsset.templateScene.isTemplateScene, true);
	assert.equal(reelAsset.templateScene.mode, "reel-scene");
	assert.equal(reelAsset.templateScene.name, "Shape Study");
	assert.equal(reelAsset.templateScene.style, "duotone");
	assert.equal(reelAsset.templateScene.videoStyle, "Duotone");
	assert.ok(reelAsset.templateScene.effects.includes("duotone"));
	assert.equal(reelAsset.templateScene.transition.type, "zoom");
	assert.equal(reelAsset.templateScene.transition.effect, "duotone");
	assert.ok(!reelAsset.templateScene.elements.some((el) => el.key === "eyebrow"), "hidden elements are omitted");
	assert.ok(reelAsset.templateScene.elements.some((el) => el.kind === "text" && el.key === "text1"), "custom + Text element is captured");
	const motionChild = reelAsset.templateScene.elements.find((el) => el.key === "graphic2");
	assert.ok(motionChild, "custom + Graphic motion element is captured");
	assert.equal(motionChild.kind, "graphic");
	assert.equal(motionChild.graphic, motionKey);
	assert.equal(motionChild.motionKind, motionKey.slice("motion:".length));
	assert.ok(typeof motionChild.transition === "string" && motionChild.transition.length > 0, "child graphic carries its own transition");
	assert.equal(motionChild.style, "duotone", "child graphic carries its own style");

	/* 15th scene: 3D Ring Carousel captures ring-carousel child graphic metadata. */
	h.api.openScene(14);
	await h.api.upload(h.files(5, "ringcard"));
	await h.api.addToVideo();
	const ringAsset = h.window.videoProjects[0].assets[1];
	assert.equal(ringAsset.templateScene.isTemplateScene, true);
	assert.equal(ringAsset.templateScene.mode, "ring-carousel");
	assert.equal(ringAsset.templateScene.style, "carousel");
	assert.equal(ringAsset.templateScene.elements.length, 1);
	assert.equal(ringAsset.templateScene.elements[0].kind, "graphic");
	assert.equal(ringAsset.templateScene.elements[0].graphic, "ring-carousel");
	assert.equal(ringAsset.templateScene.elements[0].imageCount, 5);
	assert.deepEqual(Array.from(ringAsset.templateScene.elements[0].imageNames), [
		"ringcard-1.png",
		"ringcard-2.png",
		"ringcard-3.png",
		"ringcard-4.png",
		"ringcard-5.png"
	]);
});

