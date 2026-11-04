import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { APP_JS } from "../src/client/app-js.ts";
import { APP_CSS } from "../src/client/styles.ts";
import { TIMELINE_EDITOR_JS } from "../src/client/timeline-editor.ts";
import { createHTML } from "../src/page.ts";

function makeTimelineState() {
	const scenes = [];
	const mediaItems = [];
	for (let index = 0; index < 12; index++) {
		const id = "scene-" + (index + 1);
		const startSec = index * 5;
		scenes.push({ id, index, name: "Scene " + (index + 1), startSec, durationSec: 5, mediaType: "image", mediaAssetId: "asset-" + id, elements: [] });
		mediaItems.push({ id: "media-" + (index + 1), kind: "media", sceneId: id, assetId: "asset-" + id, label: "Scene " + (index + 1), mediaType: "image", startSec, durationSec: 5, trimStartSec: 0, fit: "cover", visible: true });
	}
	const caption = { id: "caption-1", kind: "text", label: "Caption", name: "Caption", text: "A quiet morning", sceneId: "scene-1", startSec: 1, durationSec: 2, x: 50, y: 78, fontSize: 28, color: "#ffffff", font: "sans", align: "center", visible: true };
	scenes[0].elements.push({ ...caption });
	return {
		version: 3,
		durationSec: 60,
		playheadSec: 0,
		soundExpanded: false,
		zoom: 1,
		scenes,
		tracks: [
			{ id: "voiceover", kind: "audio", label: "Voiceover", expanded: true, items: [] },
			{ id: "sound-fx", kind: "audio", label: "Sound effects", expanded: true, items: [] },
			{ id: "background-music", kind: "audio", label: "Background music", expanded: true, items: [] },
			{ id: "background-media", kind: "media", label: "Pixabay & uploaded media", expanded: true, items: mediaItems },
			{ id: "visual-1", kind: "visual", label: "Text & graphics 1", expanded: true, items: [{ ...caption }] }
		],
		selectedTrackId: "background-media",
		selectedItemId: "media-1"
	};
}

function canvasContext() {
	return {
		fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "center", textBaseline: "middle",
		clearRect() {}, fillRect() {}, strokeRect() {}, save() {}, restore() {},
		beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, translate() {}, rotate() {},
		drawnTexts: [], fills: 0,
		fill() { this.fills++; }, stroke() {}, fillText(text) { this.drawnTexts.push(String(text)); }, drawImage() {},
		createLinearGradient() { return { addColorStop() {} }; }
	};
}

function memoryIndexedDB() {
	const records = new Map();
	let storeCreated = false;
	const db = {
		objectStoreNames: { contains: (name) => name === "projects" && storeCreated },
		createObjectStore: () => { storeCreated = true; return {}; },
		transaction() {
			const transaction = {
				objectStore() {
					return {
						get(key) {
							const request = {};
						setTimeout(() => { request.result = records.get(String(key)) || null; request.onsuccess?.({ target: request }); transaction.oncomplete?.(); }, 0);
							return request;
						},
						put(record) {
							const request = {};
						setTimeout(() => { records.set(String(record.id), record); request.onsuccess?.({ target: request }); transaction.oncomplete?.(); }, 0);
							return request;
						}
					};
				}
			};
			return transaction;
		},
		close() {}
	};
	return {
		open() {
			const request = { result: db };
			setTimeout(() => {
				if (!storeCreated) request.onupgradeneeded?.({ target: request });
				request.onsuccess?.({ target: request });
			}, 0);
			return request;
		}
	};
}

function openTimeline(savedTimeline = null) {
	const key = "edit-timeline-test";
	const payload = {
		version: 1,
		transitionOnly: true,
		source: "quick-batch-table-edit",
		createdAt: 1730000000123,
		sourcePageId: "p_source_test",
		targetPageId: "timeline-p_source_test-row-7",
		basicSettings: { id: 7, title: "Garden story", script: "A quiet garden story", minutes: 1 },
		timelineState: makeTimelineState()
	};
	const dom = new JSDOM(createHTML(), {
		url: "https://studio.test/free?layout=timeline&pipelinePage=" + encodeURIComponent(payload.targetPageId) + "&projectEdit=" + encodeURIComponent(key),
		runScripts: "outside-only",
		pretendToBeVisual: true
	});
	const w = dom.window;
	const previewContext = canvasContext();
	w.HTMLCanvasElement.prototype.getContext = function () { return previewContext; };
	w.URL.createObjectURL = () => "blob:timeline-test";
	w.URL.revokeObjectURL = () => {};
	w.alert = () => {};
	w.confirm = () => true;
	w.scrollTo = () => {};
	w.localStorage.setItem("ytvs.transition-project.v1." + key, JSON.stringify(payload));
	if (savedTimeline) w.localStorage.setItem("ytvs.timeline-editor.v1." + payload.targetPageId, JSON.stringify(savedTimeline));
	w.document.cookie = "ytvs_transition_project_" + key + "=" + encodeURIComponent(JSON.stringify({
		v: 1, key, createdAt: payload.createdAt, sourcePageId: payload.sourcePageId,
		targetPageId: payload.targetPageId, vid: "p_source_test-row-7"
	})) + "; Path=/; SameSite=Lax";
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	w.eval(TIMELINE_EDITOR_JS);
	return { dom, w, payload, previewContext };
}

test("Quick Batch timeline route is isolated, starts with one media lane and one shared text/graphics lane", (t) => {
	const { dom, w, payload } = openTimeline();
	t.after(() => dom.window.close());
	assert.equal(w.document.getElementById("landing-page").hidden, true);
	assert.equal(w.document.getElementById("studio-app").hidden, false);
	assert.equal(w.document.getElementById("view-timeline").classList.contains("active"), true);
	assert.equal(w.document.getElementById("view-editor").classList.contains("active"), false);
	assert.equal(w.document.getElementById("view-table").classList.contains("active"), false);
	assert.equal(w.__TIMELINE_PROJECT__.targetPageId, payload.targetPageId);
	assert.equal(w.__VIDEO_PROJECTS.length, 0, "the timeline route does not create a video-editor project");
	assert.equal(w.__PIPELINE_MANAGEMENT_LOAD__, undefined, "pipeline-management state is not restored on the timeline route");
	assert.equal(w.__PIPELINE_MANAGEMENT_SAVE__, undefined, "pipeline-management state is not persisted on the timeline route");
	assert.equal(w.document.getElementById("view-switch").hidden, true);
	assert.equal(w.document.getElementById("top-generate").hidden, true);

	const state = w.__TIMELINE_EDITOR_STATE__;
	assert.equal(state.scenes.length, 12);
	assert.equal(state.tracks.length, 5);
	assert.equal(state.tracks.filter((track) => track.kind === "audio").length, 3);
	assert.equal(state.tracks.filter((track) => track.kind === "media").length, 1);
	assert.equal(state.tracks.filter((track) => track.kind === "visual").length, 1);
	assert.equal(state.tracks.some((track) => track.kind === "text" || track.kind === "overlay"), false, "text and graphics share one visual track kind");
	assert.deepEqual(Array.from(state.tracks, (track) => track.id), ["voiceover", "sound-fx", "background-music", "background-media", "visual-1"]);
	assert.equal(state.version, 3, "the row handoff uses the shared text/graphics track schema");
	assert.equal(state.soundExpanded, false, "Soundtrack starts collapsed");
	assert.equal(w.document.querySelector('[data-timeline-action="toggle-sound"]').textContent.includes("Soundtrack"), true);
	assert.equal(w.document.querySelectorAll('[data-lane-track="voiceover"]').length, 0, "collapsed Soundtrack hides its audio lanes");
	assert.deepEqual(Array.from(w.document.querySelectorAll(".te-lane"), (lane) => lane.getAttribute("data-lane-track")), ["background-media", "visual-1"], "only media and the shared text/graphics lane are initially visible");
	assert.equal(state.tracks.find((track) => track.id === "visual-1").items[0].id, "caption-1", "caption and graphic clips share the visual lane");
	assert.equal(w.document.querySelectorAll(".te-lane").length, 2, "Soundtrack is collapsed and there is no separate overlay lane");
	assert.ok(Array.from(w.document.querySelectorAll(".te-group-title .te-group-label")).some((label) => /TEXT & GRAPHICS/i.test(label.textContent)));
	assert.equal(w.document.querySelectorAll(".te-clip").length, 13, "12 scene clips plus one timed caption are rendered");
	assert.ok(w.localStorage.getItem("ytvs.timeline-editor.v1." + payload.targetPageId), "the timeline state is stored under its stable row project id");

	w.document.querySelector('[data-timeline-action="toggle-sound"]').click();
	assert.equal(state.soundExpanded, true, "the Soundtrack accordion expands on request");
	assert.equal(w.document.querySelectorAll('[data-lane-track="voiceover"]').length, 1);
	assert.deepEqual(Array.from(w.document.querySelectorAll(".te-lane"), (lane) => lane.getAttribute("data-lane-track")).slice(-3), ["voiceover", "sound-fx", "background-music"], "expanding Soundtrack reveals the three audio lanes at the bottom");
	w.document.querySelector('[data-timeline-action="toggle-sound"]').click();
	assert.equal(state.soundExpanded, false);
});

test("legacy text and overlay tracks migrate into one shared visual lane without losing clips", (t) => {
	const legacy = makeTimelineState();
	legacy.projectId = "timeline-p_source_test-row-7";
	legacy.version = 2;
	legacy.soundExpanded = false;
	const caption = legacy.tracks.find((track) => track.kind === "visual").items[0];
	const secondCaption = { ...caption, id: "caption-2", text: "Across scene two", sceneId: "scene-2", startSec: 6, durationSec: 3 };
	const thirdCaption = { ...caption, id: "caption-3", text: "Another line", startSec: 11, durationSec: 2 };
	const textGraphic = { id: "legacy-text-graphic", kind: "graphic", label: "Legacy text-lane graphic", graphic: "star", sceneId: "scene-1", startSec: 2, durationSec: 4, x: 50, y: 50, size: 40, color: "#7aac2b", visible: true };
	const overlayGraphic = { ...textGraphic, id: "legacy-overlay-graphic", label: "Legacy overlay graphic", startSec: 12 };
	legacy.tracks = legacy.tracks.filter((track) => track.kind !== "visual").concat([
		{ id: "text-1", kind: "text", label: "Text 1", items: [caption] },
		{ id: "text-2", kind: "text", label: "Text 2", items: [secondCaption, textGraphic] },
		{ id: "text-3", kind: "text", label: "Text 3", items: [thirdCaption] },
		{ id: "overlay-1", kind: "overlay", label: "Overlay", items: [overlayGraphic] }
	]);
	legacy.selectedTrackId = "text-2";
	legacy.selectedItemId = "caption-2";
	const { dom, w } = openTimeline(legacy);
	t.after(() => dom.window.close());
	const state = w.__TIMELINE_EDITOR_STATE__;
	const visuals = state.tracks.filter((track) => track.kind === "visual");
	assert.equal(visuals.length, 1, "the three formerly fixed text tracks merge into the initial shared lane");
	assert.equal(state.tracks.some((track) => track.kind === "text" || track.kind === "overlay"), false);
	assert.equal(visuals[0].label, "Text & graphics 1");
	assert.deepEqual(new Set(visuals[0].items.map((item) => item.id)), new Set(["caption-1", "caption-2", "caption-3", "legacy-text-graphic", "legacy-overlay-graphic"]));
	assert.equal(state.selectedTrackId, visuals[0].id, "a previously selected text track resolves to the shared lane");
	assert.equal(state.selectedItemId, "caption-2");
	assert.equal(state.soundExpanded, false);
	assert.deepEqual(Array.from(w.document.querySelectorAll(".te-lane"), (lane) => lane.getAttribute("data-lane-track")), ["background-media", visuals[0].id]);
});

test("text and graphics continue rendering across background scene boundaries for their full seconds-based range", (t) => {
	const { dom, w, previewContext } = openTimeline();
	t.after(() => dom.window.close());
	const api = w.__TIMELINE_EDITOR__;
	const state = w.__TIMELINE_EDITOR_STATE__;
	const graphic = api.addGraphicElement();
	api.setItemTiming(graphic.id, 2, 8);
	state.playheadSec = 5.25;
	previewContext.drawnTexts.length = 0;
	previewContext.fills = 0;
	api.setItemTiming("caption-1", 1, 8);
	const media = state.tracks.find((track) => track.kind === "media");
	assert.ok(media.items.some((item) => item.sceneId === "scene-2" && item.startSec <= state.playheadSec && state.playheadSec < item.startSec + item.durationSec), "the playhead is now in the next background scene");
	assert.ok(previewContext.drawnTexts.includes("A quiet morning"), "text remains visible after crossing the original scene boundary");
	assert.ok(previewContext.fills > 0, "a graphic clip also renders at a time in the next scene");
	assert.equal(state.tracks.find((track) => track.kind === "visual").items.find((item) => item.id === "caption-1").durationSec, 8);
	assert.equal(state.tracks.find((track) => track.kind === "visual").items.find((item) => item.id === graphic.id).durationSec, 8);
});

test("Quick Batch media and voiceover Blobs transfer through IndexedDB, not localStorage", async (t) => {
	const dom = new JSDOM("", { url: "https://studio.test/free", runScripts: "outside-only" });
	t.after(() => dom.window.close());
	dom.window.indexedDB = memoryIndexedDB();
	dom.window.eval(TIMELINE_EDITOR_JS);
	const api = dom.window.__TIMELINE_EDITOR__;
	const mediaBlob = new Blob(["pixabay-media"], { type: "image/jpeg" });
	const voiceoverBlob = new Blob(["voiceover-audio"], { type: "audio/mpeg" });
	const stored = await api.storeProjectAssets("timeline-source-row-7", {
		assets: [{ id: "scene-1", blob: mediaBlob, name: "garden.jpg", type: "image/jpeg", source: "Pixabay" }],
		voiceover: voiceoverBlob
	});
	assert.equal(stored.ok, true);
	const record = await api.readProjectAssets("timeline-source-row-7");
	assert.equal(record.assets["scene-1"].blob, mediaBlob);
	assert.equal(record.assets["scene-1"].name, "garden.jpg");
	assert.equal(record.voiceover, voiceoverBlob);
	assert.equal(dom.window.localStorage.length, 0, "binary media is not copied into localStorage");
});

test("scene and element timing changes persist; shared text/graphics lanes cap at four", (t) => {
	const { dom, w, payload } = openTimeline();
	t.after(() => dom.window.close());
	const api = w.__TIMELINE_EDITOR__;
	const state = w.__TIMELINE_EDITOR_STATE__;

	api.setItemTiming("media-1", 2, 8);
	state.playheadSec = 2;
	const added = api.addTextElement("A new caption");
	assert.ok(added);
	api.setItemTiming(added.id, 4, 5);
	for (let index = 0; index < 3; index++) assert.ok(api.addVisualTrack());
	assert.equal(api.addVisualTrack(), null, "the maximum is four shared text/graphics lanes");
	assert.equal(state.tracks.length, 8, "three audio, one media and four shared text/graphics tracks");
	assert.equal(state.tracks.filter((track) => track.kind === "visual").length, 4);
	assert.equal(api.save(), true);

	const saved = JSON.parse(w.localStorage.getItem("ytvs.timeline-editor.v1." + payload.targetPageId));
	assert.equal(saved.scenes.length, 12);
	assert.equal(saved.scenes[0].startSec, 2);
	assert.equal(saved.scenes[0].durationSec, 8);
	assert.equal(saved.scenes[1].startSec, 8, "extending a scene ripples the following scene timing");
	const elements = saved.scenes[0].elements;
	assert.equal(elements.length, 2, "existing and newly-added elements are stored on their scene");
	assert.equal(elements.find((item) => item.id === "caption-1").startSec, 3, "moving a scene carries its timed elements");
	const savedCaption = elements.find((item) => item.id === added.id);
	assert.equal(savedCaption.text, "A new caption");
	assert.equal(savedCaption.startSec, 4);
	assert.equal(savedCaption.durationSec, 5);
	assert.equal(saved.tracks.length, 8);
	assert.doesNotMatch(JSON.stringify(saved), /"blob"\s*:/, "Blob bytes are not placed in localStorage");
});

test("reopening the same Quick Batch row restores its saved scene and text timing", (t) => {
	const first = openTimeline();
	const firstApi = first.w.__TIMELINE_EDITOR__;
	firstApi.setItemTiming("media-1", 1.5, 8.5);
	const caption = firstApi.addTextElement("Saved across reopen");
	firstApi.setItemTiming(caption.id, 3, 6);
	assert.equal(firstApi.save(), true);
	const saved = JSON.parse(first.w.localStorage.getItem("ytvs.timeline-editor.v1." + first.payload.targetPageId));
	first.dom.window.close();

	const reopened = openTimeline(saved);
	t.after(() => reopened.dom.window.close());
	const state = reopened.w.__TIMELINE_EDITOR_STATE__;
	assert.equal(state.projectId, first.payload.targetPageId, "the stable row id selects the previous localStorage project");
	assert.equal(state.tracks.find((track) => track.id === "background-media").items[0].startSec, 1.5);
	const visualTrack = state.tracks.find((track) => track.kind === "visual" && track.items.some((item) => item.id === caption.id));
	assert.ok(visualTrack, "the saved caption remains in the shared text/graphics lane");
	const savedCaption = state.tracks.flatMap((track) => track.items).find((item) => item.id === caption.id);
	assert.equal(savedCaption.startSec, 3);
	assert.equal(savedCaption.durationSec, 6);
	assert.equal(savedCaption.text, "Saved across reopen");
});

test("timeline styling allocates roughly 30 percent to preview and 70 percent to inspector", () => {
	assert.match(APP_CSS, /grid-template-columns:\s*minmax\(270px, 30%\) minmax\(0, 70%\)/);
	assert.match(APP_CSS, /grid-template-columns:\s*31% minmax\(0, 69%\)/, "the narrow viewport layout keeps the preview/inspector split within the screen");
	assert.match(APP_CSS, /\.te-dock\s*\{/);
	assert.match(APP_CSS, /\.te-timeline-scroll\s*\{/);
	assert.match(APP_CSS, /\.te-group-fill\.te-visual-actions/);
	assert.match(TIMELINE_EDITOR_JS, /IndexedDB/);
	assert.match(TIMELINE_EDITOR_JS, /STATE_PREFIX = "ytvs\.timeline-editor\.v1\."/);
});
