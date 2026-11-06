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
		/* cue DATA from the Quick Batch row: painted on the preview, never clips */
		subtitles: [
			{ startMs: 0, endMs: 2000, text: "A quiet morning" },
			{ startMs: 2000, endMs: 4500, text: "Across scene two" }
		],
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
	const context = {
		fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "center", textBaseline: "middle",
		globalAlpha: 1,
		clearRect() {}, strokeRect() {}, save() {}, restore() {},
		fillRect(...args) { context.rects.push(args); },
		beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, translate() {}, rotate() {},
		drawnTexts: [], fills: 0, rects: [], gradients: [], radials: 0,
		fill() { this.fills++; }, stroke() {}, fillText(text) { this.drawnTexts.push(String(text)); }, drawImage() {},
		createLinearGradient(x0, y0, x1, y1) {
			const gradient = { kind: "linear", x0, y0, x1, y1, stops: [], addColorStop(offset, color) { gradient.stops.push([offset, color]); } };
			context.gradients.push(gradient);
			return gradient;
		},
		createRadialGradient(x0, y0, r0, x1, y1, r1) {
			const gradient = { kind: "radial", x0, y0, r0, x1, y1, r1, stops: [], addColorStop(offset, color) { gradient.stops.push([offset, color]); } };
			context.gradients.push(gradient);
			context.radials += 1;
			return gradient;
		}
	};
	return context;
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
	assert.deepEqual(Array.from(w.document.querySelectorAll(".te-lane"), (lane) => lane.getAttribute("data-lane-track")), ["visual-1", "background-media"], "text/graphics lanes stack above the pinned background layer, which is the last lane in the dock");
	assert.equal(state.tracks.find((track) => track.id === "visual-1").items[0].id, "dummy-text-1", "the saved caption clip is dropped and the dummy text takes its place");
	assert.equal(w.document.querySelectorAll(".te-lane").length, 2, "Soundtrack is collapsed and there is no separate overlay lane");
	assert.ok(Array.from(w.document.querySelectorAll(".te-group-title .te-group-label")).some((label) => /TEXT & GRAPHICS/i.test(label.textContent)));
	assert.equal(w.document.querySelectorAll(".te-clip").length, 15, "12 scene clips, the dummy text clip and the two hidden subtitle cue clips are in the DOM");
	/*
	 * Subtitles are back as cue data: the cue text exists only inside the
	 * hidden, read-only subtitle layer, never as an editable timeline clip.
	 */
	const subtitleLane = w.document.querySelector(".te-subtitle-lane");
	assert.ok(subtitleLane, "the subtitle layer exists in the tracks");
	assert.equal(subtitleLane.getAttribute("aria-hidden"), "true");
	assert.ok(w.document.body.textContent.includes("A quiet morning"), "the cue text is carried into the tracks as a hidden layer");
	const editableClipText = Array.from(w.document.querySelectorAll(".te-clip"))
		.filter((clip) => !clip.closest(".te-subtitle-lane"))
		.map((clip) => clip.textContent).join(" ");
	assert.ok(!editableClipText.includes("A quiet morning"), "subtitle cues are not editable timeline clips");
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
	assert.deepEqual(new Set(visuals[0].items.map((item) => item.id)), new Set(["legacy-text-graphic", "legacy-overlay-graphic"]), "caption clips are dropped from the migrated lane and the surviving graphics are kept");
	assert.equal(state.selectedTrackId, visuals[0].id, "a previously selected text track resolves to the shared lane");
	assert.ok(visuals[0].items.some((item) => item.id === state.selectedItemId), "a stale caption selection resolves to a clip that still exists");
	assert.equal(state.soundExpanded, false);
	assert.deepEqual(Array.from(w.document.querySelectorAll(".te-lane"), (lane) => lane.getAttribute("data-lane-track")), [visuals[0].id, "background-media"], "the shared text/graphics lane still sits above the background layer");
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
	api.setItemTiming("dummy-text-1", 1, 8);
	const media = state.tracks.find((track) => track.kind === "media");
	assert.ok(media.items.some((item) => item.sceneId === "scene-2" && item.startSec <= state.playheadSec && state.playheadSec < item.startSec + item.durationSec), "the playhead is now in the next background scene");
	assert.ok(previewContext.drawnTexts.includes("Your text here"), "text remains visible after crossing the original scene boundary");
	assert.ok(previewContext.fills > 0, "a graphic clip also renders at a time in the next scene");
	assert.equal(state.tracks.find((track) => track.kind === "visual").items.find((item) => item.id === "dummy-text-1").durationSec, 8);
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
	assert.equal(elements.find((item) => item.id === "dummy-text-1").startSec, 2, "moving a scene carries its timed elements");
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

test("the served timeline markup orders preview, then selected elements, then the dock", () => {
	const html = createHTML();
	const previewAt = html.indexOf('class="te-preview-panel"');
	const workspaceAt = html.indexOf('class="te-workspace"');
	const inspectorAt = html.indexOf('class="te-inspector-panel"');
	const dockAt = html.indexOf('class="te-dock"');
	assert.ok(previewAt !== -1 && workspaceAt !== -1 && inspectorAt !== -1 && dockAt !== -1, "all three regions are in the served markup");
	assert.ok(previewAt < inspectorAt, "the preview comes before the selected-element panel");
	assert.ok(workspaceAt < inspectorAt && inspectorAt < dockAt, "the selected-element panel comes before the timeline dock");
	assert.ok(previewAt < workspaceAt, "the preview is not inside the selected-element workspace, so it can pin against the page");
	assert.ok(html.indexOf('class="te-dock-tail"') > dockAt, "the dock ends with the tail that keeps the preview pinned");
});

test("timeline styling stacks the full-width sticky preview, the element panel, then the dock", () => {
	assert.match(APP_CSS, /\.te-workspace\s*\{[^}]*flex-direction:\s*column/, "the workspace stacks vertically");
	assert.match(APP_CSS, /\.te-preview-panel\s*\{[^}]*position:\s*sticky/, "the preview stays pinned while the page scrolls");
	assert.match(APP_CSS, /\.te-preview-stage\s*\{[^}]*min-height:\s*320px/, "the preview stage is 320 px tall");
	assert.match(APP_CSS, /\.te-preview-panel\s*\{[^}]*width:\s*100%/, "the preview spans the whole page width");
	assert.match(APP_CSS, /\.te-inspector-panel\s*\{[^}]*position:\s*static/, "the selected-element panel follows the preview in flow");
	assert.match(APP_CSS, /\.te-inspector-panel\s*\{[^}]*width:\s*100%/);
	assert.match(APP_CSS, /\.te-dock\s*\{[^}]*flex:\s*0 0 auto/, "the dock is not given a viewport percentage");
	assert.match(APP_CSS, /\.te-dock-tail\s*\{/, "the dock keeps a tail so the sticky preview is not unpinned early");
	assert.doesNotMatch(APP_CSS, /\.te-timeline-scroll\s*\{[^}]*max-height:\s*46/, "the track scroller grows with its lanes");
	assert.doesNotMatch(APP_CSS, /grid-template-columns:\s*minmax\(270px, 30%\) minmax\(0, 70%\)/, "the old 30/70 side-by-side split is gone");
	assert.doesNotMatch(APP_CSS, /grid-template-columns:\s*31% minmax\(0, 69%\)/);
	assert.match(APP_CSS, /\.te-timeline-scroll\s*\{/);
	assert.match(APP_CSS, /\.te-group-fill\.te-visual-actions/);
	assert.match(TIMELINE_EDITOR_JS, /IndexedDB/);
	assert.match(TIMELINE_EDITOR_JS, /STATE_PREFIX = "ytvs\.timeline-editor\.v1\."/);
});

test("timelines without text or graphics open with one dummy text clip at 0:00 and no caption clips", (t) => {
	const { dom, w, payload } = openTimeline();
	t.after(() => dom.window.close());
	const api = w.__TIMELINE_EDITOR__;
	const state = w.__TIMELINE_EDITOR_STATE__;
	const visual = state.tracks.find((track) => track.kind === "visual");
	const dummy = visual.items.find((item) => item.id === "dummy-text-1");
	assert.ok(dummy, "the dummy text clip exists in the shared text/graphics lane");
	assert.equal(dummy.startSec, 0, "the dummy text sits at 0:00");
	assert.equal(dummy.kind, "text");
	assert.equal(dummy.text, "Your text here");
	assert.equal(visual.items.some((item) => /-caption-\d+$/.test(item.id)), false, "caption clips never reach the timeline lane");

	/* a project saved with an empty text lane gains the dummy on open */
	const empty = makeTimelineState();
	empty.projectId = "timeline-p_source_test-row-7";
	empty.tracks = empty.tracks.map((track) => track.kind === "visual" ? { ...track, items: [] } : track);
	empty.scenes = empty.scenes.map((scene) => ({ ...scene, elements: [] }));
	const reopened = openTimeline(empty);
	t.after(() => reopened.dom.window.close());
	const reopenedVisual = reopened.w.__TIMELINE_EDITOR_STATE__.tracks.find((track) => track.kind === "visual");
	assert.equal(reopenedVisual.items.length, 1, "an empty saved text lane is seeded with exactly one clip");
	assert.equal(reopenedVisual.items[0].id, "dummy-text-1");
	assert.equal(reopenedVisual.items[0].startSec, 0);

	/* a project that already has a graphic never gets a second dummy */
	const graphicProject = makeTimelineState();
	graphicProject.projectId = "timeline-p_source_test-row-7";
	graphicProject.tracks = graphicProject.tracks.map((track) => track.kind === "visual"
		? { ...track, items: [{ id: "graphic-1", kind: "graphic", graphic: "star", label: "Star", sceneId: "scene-1", startSec: 2, durationSec: 3, x: 50, y: 50, size: 60, color: "#7aac2b", visible: true }] }
		: track);
	const withGraphic = openTimeline(graphicProject);
	t.after(() => withGraphic.dom.window.close());
	const graphicItems = withGraphic.w.__TIMELINE_EDITOR_STATE__.tracks.find((track) => track.kind === "visual").items;
	assert.equal(graphicItems.length, 1, "a project with its own graphic is left alone");
	assert.equal(graphicItems[0].id, "graphic-1");

	/* the dummy is an ordinary clip: moving it persists */
	api.setItemTiming("dummy-text-1", 0.5, 3);
	assert.equal(api.save(), true);
	const saved = JSON.parse(w.localStorage.getItem("ytvs.timeline-editor.v1." + payload.targetPageId));
	assert.equal(saved.tracks.find((track) => track.kind === "visual").items[0].id, "dummy-text-1");
	assert.equal(saved.tracks.find((track) => track.kind === "visual").items[0].startSec, 0.5);
});

test("Pixabay media is the one pinned background layer and every stray media lane is folded into it", (t) => {
	const legacy = makeTimelineState();
	legacy.projectId = "timeline-p_source_test-row-7";
	legacy.tracks = legacy.tracks
		.filter((track) => track.kind !== "media")
		.concat([
			{ id: "background-media", kind: "media", label: "Background", expanded: true, items: legacy.tracks.find((track) => track.kind === "media").items.slice(0, 6) },
			{ id: "overlay-media", kind: "media", label: "Overlay media", expanded: true, items: legacy.tracks.find((track) => track.kind === "media").items.slice(6) }
		]);
	const { dom, w } = openTimeline(legacy);
	t.after(() => dom.window.close());
	const state = w.__TIMELINE_EDITOR_STATE__;
	const mediaTracks = state.tracks.filter((track) => track.kind === "media");
	assert.equal(mediaTracks.length, 1, "a saved project cannot keep a second media lane");
	assert.equal(mediaTracks[0].id, "background-media");
	assert.equal(mediaTracks[0].layer, 0, "the background layer is layer zero");
	assert.equal(mediaTracks[0].items.length, 12, "the stray lane's clips move into the background layer instead of being dropped");
	assert.equal(state.tracks.indexOf(mediaTracks[0]), state.tracks.length - 2, "the background layer is the last visual lane in state order");

	const lanes = Array.from(w.document.querySelectorAll(".te-lane"), (lane) => lane.getAttribute("data-lane-track"));
	assert.equal(lanes[lanes.length - 1], "background-media", "the background lane is painted last in the dock");
	assert.equal(w.document.querySelectorAll(".te-background-lane").length, 1);
	assert.equal(w.document.querySelector('[data-lane-track="background-media"]').classList.contains("te-background-lane"), true);
	const heading = Array.from(w.document.querySelectorAll(".te-group-background .te-group-label")).map((node) => node.textContent).join(" ");
	assert.match(heading, /BACKGROUND/i);
	assert.match(heading, /pinned lowest/i);
	assert.equal(w.document.querySelectorAll(".te-track-badge").length, 1, "the background lane carries a BG badge");
});

test("the preview canvas paints the background layer before text and graphics", (t) => {
	/*
	 * JSDOM never decodes a blob image, so the paint order is asserted against the
	 * generated client source: inside drawPreview the background draw must come
	 * before the visual-lane loop, and the visual loop must not draw media clips.
	 */
	const drawPreview = TIMELINE_EDITOR_JS.slice(TIMELINE_EDITOR_JS.indexOf("function drawPreview()"));
	const body = drawPreview.slice(0, drawPreview.indexOf("function previewTick"));
	const backgroundAt = body.indexOf("Layer 0");
	const overlayAt = body.indexOf("Layers 1..4");
	assert.ok(backgroundAt !== -1 && overlayAt !== -1, "the two paint layers are labelled in drawPreview");
	assert.ok(backgroundAt < overlayAt, "the background layer is painted before the text/graphics layers");
	assert.ok(body.indexOf("drawImageCover(") < overlayAt, "the Pixabay/upload frame is drawn first");
	assert.ok(body.slice(overlayAt).includes("visualTracks().forEach("), "every visual lane is drawn afterwards");
	assert.match(TIMELINE_EDITOR_JS, /MEDIA_TRACK_ID = "background-media"/);
	assert.match(TIMELINE_EDITOR_JS, /function mediaTrack\(\) \{ return findTrack\(MEDIA_TRACK_ID\); \}/);
});

test("frame details, ruler seeking, gap preview and controls survive timeline edits", (t) => {
 const saved = makeTimelineState();
 saved.projectId = "timeline-p_source_test-row-7";
 saved.frame = { width: 1080, height: 1920, orientation: "portrait" };
 saved.videoStyle = "Neon Night";
 const { dom, w } = openTimeline(saved);
 t.after(() => dom.window.close());
 const state = w.__TIMELINE_EDITOR_STATE__;
 const canvas = w.document.getElementById("timeline-preview-canvas");
 assert.equal(canvas.width, 1080); assert.equal(canvas.height, 1920);
 assert.equal(state.videoStyle, "Neon Night");
 assert.equal(w.document.querySelectorAll('[data-timeline-action="export"]').length, 3);
 assert.equal(w.document.querySelectorAll('[data-timeline-action="play"]').length, 2);
 assert.ok(w.document.querySelector('[data-scroll-lane]'));
 w.__TIMELINE_EDITOR__.setItemTiming("media-1", 10, 5);
 const ruler = w.document.querySelector('.te-ruler');
 ruler.getBoundingClientRect = () => ({ left: 0 });
 ruler.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 36 }));
 w.document.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
 assert.equal(state.playheadSec, 2);
 assert.equal(w.document.getElementById('timeline-current-scene').textContent, 'No scene selected');
 w.__TIMELINE_EDITOR__.save();
 assert.equal(JSON.parse(w.localStorage.getItem('ytvs.timeline-editor.v1.' + state.projectId)).frame.orientation, 'portrait');
});

test("timeline seeker handle is a red inverted triangle pointing down that moves in sync during playback and scrubbing", (t) => {
	const handleMatch = APP_CSS.match(/\.te-playhead-handle\s*\{([^}]*)\}/);
	assert.ok(handleMatch, ".te-playhead-handle CSS rule exists");
	const handleCss = handleMatch[1];
	assert.match(handleCss, /border-left:\s*8px solid transparent/, "left edge tapers inward");
	assert.match(handleCss, /border-right:\s*8px solid transparent/, "right edge tapers inward");
	assert.match(handleCss, /border-top:\s*13px solid #ef4444/i, "red top border forms an inverted triangle pointing down");
	assert.match(handleCss, /transform:\s*translateX\(-50%\)/, "triangle tip is centered over the seeker line");

	const playheadMatch = APP_CSS.match(/\.te-playhead\s*\{([^}]*)\}/);
	assert.ok(playheadMatch, ".te-playhead CSS rule exists");
	assert.match(playheadMatch[1], /background:\s*#ef4444/i, "seeker line uses matching red");

	const rulerPlayheadMatch = APP_CSS.match(/\.te-ruler\s+\.te-playhead\s*\{([^}]*)\}/);
	assert.ok(rulerPlayheadMatch, ".te-ruler .te-playhead CSS rule exists");
	assert.match(rulerPlayheadMatch[1], /width:\s*2px/, "ruler stem matches the 2px red seeker line rather than a rectangular block");
	assert.match(rulerPlayheadMatch[1], /background:\s*#ef4444/i);

	const { dom, w } = openTimeline();
	t.after(() => dom.window.close());
	const state = w.__TIMELINE_EDITOR_STATE__;

	const rulerPlayhead = w.document.querySelector(".te-ruler [data-playhead]");
	const handle = w.document.querySelector(".te-ruler [data-playhead] [data-playhead-handle]");
	assert.ok(rulerPlayhead, "ruler contains the playhead stem");
	assert.ok(handle, "ruler playhead contains the red inverted-triangle seeker handle");
	assert.equal(handle.classList.contains("te-playhead-handle"), true);
	assert.equal(parseFloat(rulerPlayhead.style.left), 0);

	// Capture requestAnimationFrame so we can step real playback deterministically
	let rafCallback = null;
	let currentNow = 1000;
	w.performance.now = () => currentNow;
	w.requestAnimationFrame = (cb) => { rafCallback = cb; return 1; };

	w.document.querySelector('[data-timeline-action="play"]').click();
	assert.ok(rafCallback, "starting playback schedules a preview animation frame");

	currentNow = 1200; // +0.20s -> 0.20 * 18 pps = 3.6px
	const step1 = rafCallback;
	rafCallback = null;
	step1(currentNow);

	const expectedLeft1 = "3.6px";
	assert.equal(parseFloat(rulerPlayhead.style.left), 3.6);
	const allLinesAfterStep1 = Array.from(w.document.querySelectorAll("[data-playhead]"));
	assert.ok(allLinesAfterStep1.length >= 4, "continuous seeker spans ruler, group fills, and lanes");
	for (const line of allLinesAfterStep1) {
		assert.equal(line.style.left, expectedLeft1, "every seeker segment and the ruler handle parent move in lockstep");
	}
	assert.equal(handle.parentElement.style.left, expectedLeft1, "the red inverted-triangle handle moves with the seeker line");

	// Stop playback and drag directly from the inverted-triangle seeker handle
	w.document.querySelector('[data-timeline-action="play"]').click();
	const ruler = w.document.querySelector(".te-ruler");
	ruler.getBoundingClientRect = () => ({ left: 0 });
	handle.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, clientX: 90 }));
	assert.equal(state.playheadSec, 5, "pressing the inverted-triangle handle seeks immediately");
	w.document.dispatchEvent(new w.MouseEvent("pointermove", { bubbles: true, clientX: 180 }));
	assert.equal(state.playheadSec, 10, "dragging the inverted-triangle handle scrubs the seeker");
	assert.equal(parseFloat(handle.parentElement.style.left), 180);
	w.document.dispatchEvent(new w.MouseEvent("pointerup", { bubbles: true }));
});

test("Export MP4 buttons appear in topbar, preview controls, and dock toolbar and export a valid MP4 via WebCodecs + Mp4Muxer", async (t) => {
	const shortState = makeTimelineState();
	shortState.projectId = "timeline-p_source_test-row-7";
	shortState.durationSec = 1;
	shortState.scenes = shortState.scenes.slice(0, 1);
	shortState.scenes[0].durationSec = 1;
	shortState.scenes[0].elements = [];
	shortState.tracks.find((tr) => tr.id === "background-media").items = [
		{ ...shortState.tracks.find((tr) => tr.id === "background-media").items[0], startSec: 0, durationSec: 1 }
	];
	shortState.tracks.find((tr) => tr.id === "visual-1").items = [
		{ id: "title-1", kind: "text", label: "Title", text: "Hello timeline", sceneId: "scene-1", startSec: 0, durationSec: 1, x: 50, y: 78, fontSize: 28, color: "#ffffff", font: "sans", align: "center", visible: true }
	];
	shortState.playheadSec = 0.4;

	const { dom, w } = openTimeline(shortState);
	t.after(() => dom.window.close());

	const topbarBtn = w.document.querySelector('.te-topbar [data-timeline-action="export"]');
	const previewBtn = w.document.querySelector('.te-preview-controls [data-timeline-action="export"]');
	const dockBtn = w.document.querySelector('.te-dock-toolbar [data-timeline-action="export"]');
	assert.ok(topbarBtn && topbarBtn.classList.contains("te-export"), "topbar has a prominent Export MP4 button");
	assert.ok(previewBtn && previewBtn.classList.contains("te-export"), "preview controls have an Export MP4 button");
	assert.ok(dockBtn && dockBtn.classList.contains("te-export"), "timeline dock toolbar has an Export MP4 button");
	assert.match(topbarBtn.textContent, /Export MP4/);

	// Install deterministic WebCodecs + Mp4Muxer + AudioContext mocks on the window
	let encodedFrames = 0;
	let closedFrames = 0;
	let muxedVideoChunks = 0;
	let muxedAudioChunks = 0;
	let sawBusyState = false;
	let downloadAnchorInBody = false;
	let downloadedFileName = "";

	w.AudioContext = class {
		async decodeAudioData() {
			const samples = new Float32Array(4800).fill(0.25);
			return { sampleRate: 48000, numberOfChannels: 2, length: 4800, duration: 0.1, getChannelData: () => samples };
		}
		async close() {}
	};
	await w.__TIMELINE_EDITOR__.addAudioFile("voiceover", new w.File([new Uint8Array([1, 2, 3, 4])], "voice.mp3", { type: "audio/mpeg" }));
	w.__TIMELINE_EDITOR_STATE__.durationSec = 1;
	w.__TIMELINE_EDITOR_STATE__.tracks.find((tr) => tr.id === "voiceover").items[0].durationSec = 1;
	w.__TIMELINE_EDITOR_STATE__.playheadSec = 0.4;

	w.HTMLAnchorElement.prototype.click = function () {
		downloadAnchorInBody = w.document.body.contains(this);
		downloadedFileName = this.download;
	};
	w.AudioData = class {
		constructor(init) { this.timestamp = init.timestamp; this.numberOfFrames = init.numberOfFrames; }
		close() {}
	};
	w.EncodedAudioChunk = class {
		constructor(init) { Object.assign(this, init); }
	};
	w.AudioEncoder = class {
		constructor({ output }) { this._output = output; this.encodeQueueSize = 0; this.state = "unconfigured"; }
		configure() { this.state = "configured"; }
		encode(audioData) {
			this._output({
				byteLength: 8,
				timestamp: audioData.timestamp,
				duration: Math.round((audioData.numberOfFrames / 48000) * 1000000),
				type: "key",
				copyTo(dest) { dest.fill(7); }
			}, { decoderConfig: { codec: "mp4a.40.2" } });
		}
		async flush() {}
		close() { this.state = "closed"; }
	};
	w.VideoFrame = class {
		constructor(_source, init) { this.timestamp = init.timestamp; this.duration = init.duration; }
		close() { closedFrames++; }
	};
	w.VideoEncoder = class {
		constructor({ output }) { this._output = output; this.encodeQueueSize = 0; this.state = "unconfigured"; }
		static async isConfigSupported(config) { return { supported: true, config }; }
		configure() { this.state = "configured"; }
		encode(frame, opts) {
			if (topbarBtn.disabled && !w.document.getElementById("timeline-export-progress").hidden) {
				sawBusyState = true;
			}
			encodedFrames++;
			this._output({ byteLength: 16, timestamp: frame.timestamp, type: opts?.keyFrame ? "key" : "delta" }, {});
		}
		async flush() {}
		close() { this.state = "closed"; }
	};
	w.Mp4Muxer = {
		ArrayBufferTarget: class {
			constructor() { this.buffer = new ArrayBuffer(64); }
		},
		Muxer: class {
			constructor(options) { this.target = options.target; this.options = options; }
			addVideoChunk() { muxedVideoChunks++; }
			addAudioChunk() { muxedAudioChunks++; }
			finalize() {}
		}
	};

	const result = await w.__TIMELINE_EDITOR__.exportTimeline();
	assert.equal(result.ok, true);
	assert.equal(result.format, "mp4");
	assert.equal(result.mode, "webcodecs");
	assert.equal(encodedFrames, 30, "1 second timeline renders 30 deterministic frames at 30 fps");
	assert.equal(closedFrames, 30, "every VideoFrame is closed immediately");
	assert.equal(muxedVideoChunks, 30, "every encoded video chunk is muxed into the MP4 container");
	assert.ok(muxedAudioChunks > 0, "encoded AAC soundtrack chunks are muxed into the MP4 container");
	assert.equal(sawBusyState, true, "Export buttons disable and progress bar displays while rendering");
	assert.equal(topbarBtn.disabled, false, "Export button re-enables after completion");
	assert.equal(w.document.getElementById("timeline-export-progress").hidden, true, "progress bar hides after completion");
	assert.equal(downloadAnchorInBody, true, "download link is attached to document.body before clicking");
	assert.equal(downloadedFileName, "YouTubeVibeStudio_Garden_story.mp4");
	assert.equal(Math.abs(w.__TIMELINE_EDITOR_STATE__.playheadSec - 0.4) < 0.001, true, "playhead position is restored after offline MP4 export");
	assert.equal(w.__TIMELINE_LAST_EXPORT__.fileName, "YouTubeVibeStudio_Garden_story.mp4");
});

test("Export falls back cleanly to MediaRecorder when WebCodecs or Mp4Muxer is unavailable", async (t) => {
	const { dom, w } = openTimeline();
	t.after(() => dom.window.close());

	const canvas = w.document.getElementById("timeline-preview-canvas");
	let stoppedTracks = 0;
	canvas.captureStream = () => ({
		getTracks: () => [{ stop() { stoppedTracks++; } }]
	});
	let downloadedName = "";
	w.HTMLAnchorElement.prototype.click = function () { downloadedName = this.download; };
	w.MediaRecorder = class {
		static isTypeSupported(mime) { return mime === "video/webm"; }
		constructor(_stream, opts) {
			this.mimeType = opts?.mimeType || "video/webm";
			this.state = "inactive";
		}
		start() {
			this.state = "recording";
			setTimeout(() => {
				this.ondataavailable?.({ data: new w.Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
				this.state = "inactive";
				this.onstop?.();
			}, 10);
		}
		stop() {
			this.state = "inactive";
			this.onstop?.();
		}
	};

	const result = await w.__TIMELINE_EDITOR__.exportTimeline();
	assert.equal(result.ok, true);
	assert.equal(result.mode, "mediarecorder");
	assert.equal(downloadedName, "YouTubeVibeStudio_Garden_story.webm");
	assert.equal(stoppedTracks, 1);
});

test("subtitle cues paint on the timeline preview while their tracks layer stays hidden and read-only", (t) => {
	const { dom, w, previewContext } = openTimeline();
	t.after(() => dom.window.close());
	const state = w.__TIMELINE_EDITOR_STATE__;
	assert.deepEqual(Array.from(state.subtitles, (cue) => cue.text), ["A quiet morning", "Across scene two"], "the row's cue data survives normalizeState");

	/* the layer exists in the tracks DOM... */
	const lane = w.document.querySelector(".te-subtitle-lane");
	const group = w.document.querySelector(".te-subtitle-group");
	const label = w.document.querySelector(".te-subtitle-label");
	assert.ok(lane && group && label, "the subtitle group, label and lane render inside the track grid");
	assert.equal(lane.getAttribute("aria-hidden"), "true");
	assert.equal(lane.querySelectorAll(".te-clip").length, 2, "one clip per cue");
	/* ...but CSS hides every part of it on every theme */
	for (const cls of ["te-subtitle-group", "te-subtitle-fill", "te-subtitle-label", "te-subtitle-lane"]) {
		assert.match(APP_CSS, new RegExp("\\." + cls + "[^}]*display:\\s*none"), "." + cls + " is hidden by CSS");
	}
	/* read-only: the cues never enter state.tracks, so nothing can select or move them */
	assert.equal(state.tracks.some((track) => track.kind === "subtitle" || String(track.id) === "subtitles"), false, "subtitle cues are not stored as tracks");
	assert.equal(w.document.querySelectorAll('[data-track-select="subtitles"]').length, 0, "the hidden layer exposes no track selector");

	/* the preview canvas burns the active cue in at the playhead */
	const ruler = w.document.querySelector(".te-ruler");
	ruler.getBoundingClientRect = () => ({ left: 0 });
	previewContext.drawnTexts.length = 0;
	ruler.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, clientX: 15 })); /* 15px / 18 pps ≈ 0.83s → cue 1 */
	w.document.dispatchEvent(new w.MouseEvent("pointerup", { bubbles: true }));
	assert.ok(previewContext.drawnTexts.includes("A quiet morning"), "cue 1 is painted on the preview at 0.83s");
	previewContext.drawnTexts.length = 0;
	ruler.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, clientX: 54 })); /* 3s → cue 2 */
	w.document.dispatchEvent(new w.MouseEvent("pointerup", { bubbles: true }));
	assert.ok(previewContext.drawnTexts.includes("Across scene two"), "cue 2 is painted on the preview at 3s");
	previewContext.drawnTexts.length = 0;
	ruler.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, clientX: 108 })); /* 6s → past both cues */
	w.document.dispatchEvent(new w.MouseEvent("pointerup", { bubbles: true }));
	assert.ok(!previewContext.drawnTexts.includes("A quiet morning"), "no subtitle is painted between cues");
	assert.ok(!previewContext.drawnTexts.includes("Across scene two"));
});

function seekTo(w, clientX) {
	const ruler = w.document.querySelector(".te-ruler");
	ruler.getBoundingClientRect = () => ({ left: 0 });
	ruler.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, clientX }));
	w.document.dispatchEvent(new w.MouseEvent("pointerup", { bubbles: true }));
}

const DUOTONE_STOPS = ["rgba(255,107,53,0.42)", "rgba(255,107,53,0.12)", "rgba(46,196,182,0.44)"];

function duotoneGradients(context) {
	return context.gradients.filter((gradient) => gradient.kind === "linear" && DUOTONE_STOPS.every((stop) => gradient.stops.some((entry) => entry[1] === stop)));
}

test("the timeline preview applies the passed row video style plus the template-modal neon and VHS effects", (t) => {
	const saved = makeTimelineState();
	saved.projectId = "timeline-p_source_test-row-7";
	saved.videoStyle = "Retro Poster";
	saved.subtitles = [];
	const { dom, w, previewContext } = openTimeline(saved);
	t.after(() => dom.window.close());
	const state = w.__TIMELINE_EDITOR_STATE__;
	assert.equal(state.videoStyle, "Retro Poster", "the Quick Batch row style arrives in the timeline details");
	assert.match(w.document.getElementById("timeline-project-subtitle").textContent, /Retro Poster style/, "the heading details show the passed style");
	assert.equal(state.projectDetail.style, "Retro Poster", "the project detail carries the row style");
	assert.deepEqual(Array.from(state.projectDetail.effects), ["vhs"], "Retro Poster resolves to the VHS treatment");

	/* the shared Quick Batch CSS filter still paints the background layer */
	assert.match(TIMELINE_EDITOR_JS, /window\.__videoStyleFilter && "filter" in context/, "the row style's canvas filter is applied on Layer 0");
	assert.match(TIMELINE_EDITOR_JS, /window\.__videoStyleFilter && "filter" in targetCtx/, "the export painter applies it too");
	/* and the effects copied from the editor layout's template modal run off the same style */
	assert.ok(TIMELINE_EDITOR_JS.includes("function drawStyleEffects("), "the template-modal effect painter exists");
	assert.ok(TIMELINE_EDITOR_JS.includes("function styleEffectsFor("), "the row style resolves to a template-modal effect list");
	assert.ok(TIMELINE_EDITOR_JS.includes('if (/neon/i.test(text)) list.push("neon")'), "neon styles get the neon glow overlay");
	assert.ok(TIMELINE_EDITOR_JS.includes('if (/neon|retro|vhs|glitch/i.test(text)) list.push("vhs")'), "neon, retro and VHS styles get the scanline overlay");
	assert.ok(TIMELINE_EDITOR_JS.includes('if (/duotone|cinematic/i.test(text)) list.push("duotone")'), "cinematic styles get the double gradient");

	/* VHS scanlines: copied from template-scene-editor.ts style "glitch" */
	previewContext.rects.length = 0;
	seekTo(w, 15);
	assert.ok(previewContext.rects.some((args) => args[2] >= 300 && args[3] <= 9), "the Retro Poster style draws rolling VHS scanline bands");
});

test("a Neon Night row applies the neon image effect together with the VHS effect on every scene", (t) => {
	const saved = makeTimelineState();
	saved.projectId = "timeline-p_source_test-row-7";
	saved.videoStyle = "Neon Night";
	saved.subtitles = [];
	const { dom, w, previewContext } = openTimeline(saved);
	t.after(() => dom.window.close());
	const state = w.__TIMELINE_EDITOR_STATE__;
	assert.equal(state.videoStyle, "Neon Night");
	assert.deepEqual(Array.from(state.videoStyleEffects), ["neon", "vhs"], "a neon row resolves to the neon glow plus the VHS bars");
	assert.equal(state.scenes.length, 12);
	assert.ok(state.scenes.every((scene) => scene.effects.join(",") === "neon,vhs"), "every one of the 12 scenes carries both effects");
	assert.deepEqual(Array.from(state.projectDetail.effects), ["neon", "vhs"]);
	assert.ok(state.projectDetail.scenes.every((scene) => scene.effects.join(",") === "neon,vhs"), "the project detail lists both effects on every scene");
	assert.match(w.document.getElementById("timeline-project-subtitle").textContent, /neon glow \+ VHS scanlines/, "the heading names the effects");

	/* the neon radial glow AND the rolling VHS bars are painted, scene after scene */
	for (const clientX of [15, 105]) {
		previewContext.gradients.length = 0;
		previewContext.radials = 0;
		previewContext.rects.length = 0;
		seekTo(w, clientX);
		assert.ok(previewContext.radials >= 1, "the neon pink radial glow is painted at " + clientX + "px");
		assert.ok(
			previewContext.gradients.some((gradient) => gradient.kind === "radial" && gradient.stops.some((entry) => entry[1] === "rgba(255,45,149,0.08)")),
			"the neon glow uses the template modal's pink stop"
		);
		assert.ok(previewContext.rects.some((args) => args[2] >= 300 && args[3] <= 9), "the VHS scanline bands are painted at " + clientX + "px");
	}
});

test("a Cinematic Film row paints the template-modal double gradient on every video and image scene", (t) => {
	const saved = makeTimelineState();
	saved.projectId = "timeline-p_source_test-row-7";
	saved.videoStyle = "Cinematic Film";
	saved.subtitles = [];
	/* scene 1 is an image, scene 2 is a video clip: both must be treated */
	saved.scenes[1].mediaType = "video";
	saved.scenes[1].mediaAssetId = "asset-scene-2";
	saved.tracks.find((track) => track.kind === "media").items[1].mediaType = "video";
	const { dom, w, previewContext } = openTimeline(saved);
	t.after(() => dom.window.close());
	const state = w.__TIMELINE_EDITOR_STATE__;
	assert.equal(state.videoStyle, "Cinematic Film");
	assert.deepEqual(Array.from(state.videoStyleEffects), ["duotone"], "Cinematic Film resolves to the double gradient");
	assert.ok(state.scenes.every((scene) => scene.effects.join(",") === "duotone"), "all 12 scenes carry the double gradient");
	assert.ok(state.scenes.some((scene) => scene.mediaType === "image") && state.scenes.some((scene) => scene.mediaType === "video"), "the project mixes image and video scenes");

	/* seek into scene 1 (image) and scene 3 (video at 10s) and check both frames */
	const pps = 18;
	for (const seconds of [1, 10]) {
		previewContext.gradients.length = 0;
		seekTo(w, Math.round(seconds * pps));
		const painted = duotoneGradients(previewContext);
		assert.ok(painted.length >= 1, "the double gradient is painted at " + seconds + "s");
		assert.deepEqual(painted[0].stops.map((entry) => entry[1]), DUOTONE_STOPS, "the double gradient uses the template modal's two colours");
		assert.ok(painted[0].x0 !== painted[0].x1, "the double gradient is a moving horizontal gradient");
	}
});

test("timeline chrome follows the site theme instead of hardcoded black", () => {
	/* the sections that used to render black now come from the site's --t-* tokens */
	assert.doesNotMatch(APP_CSS, /body\.timeline-editor-page\s*\{[^}]*background:\s*#101116/, "the page background follows --bg");
	assert.doesNotMatch(APP_CSS, /\.te-inspector-panel\s*\{[^}]*background:\s*#101116/, "the selected-element panel follows --card");
	assert.doesNotMatch(APP_CSS, /\.te-lane\.collapsed\s*\{[^}]*background:\s*#101116/, "collapsed lanes follow the panel tokens");
	assert.doesNotMatch(APP_CSS, /\.te-group-title\s*\{[^}]*background:\s*#20232a/, "group title rows are tokenized");
	assert.match(APP_CSS, /body\.timeline-editor-page\s*\{[^}]*background:\s*var\(--bg\)/);
	assert.match(APP_CSS, /\.te-inspector-panel\s*\{[^}]*background:\s*var\(--card\)/);
	assert.match(APP_CSS, /--te-border:\s*var\(--t-line, #30333d\)/, "the timeline border token follows --t-line");
	for (const themed of [
		"var(--t-panel-2, #191b22)", /* track label rows */
		"var(--t-panel, #20232a)", /* group title rows */
		"var(--t-btn2-bg, #22252d)", /* toolbar buttons */
		"var(--t-btn2-ink, #e7e9ef)",
		"var(--t-ink, #f3f4f6)", /* inspector text */
		"var(--t-muted, #9398a5)", /* muted labels */
		"var(--t-input, #1d2027)", /* inspector inputs */
		"var(--t-panel-3, #14161c)", /* dock tail stripes */
		"var(--t-track, rgba(255, 255, 255, .12))" /* export progress track */
	]) assert.ok(APP_CSS.includes(themed), "theme token with preserved fallback: " + themed);
	/* the subtitle layer stays hidden on every theme */
	assert.match(APP_CSS, /\.te-subtitle-lane\s*\{[^}]*display:\s*none/, "the subtitle lane is hidden by CSS");
});
