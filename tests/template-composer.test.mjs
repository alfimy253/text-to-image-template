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
	assert.doesNotMatch(h.document.querySelector("#tm-scene-controls").textContent, /editable designs/);
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
