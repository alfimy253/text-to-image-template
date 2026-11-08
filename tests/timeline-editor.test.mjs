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
	/* the graphic opened a lane of its own, so look across the shared text/graphics lanes */
	const visualItems = state.tracks.filter((track) => track.kind === "visual").flatMap((track) => track.items);
	assert.equal(visualItems.find((item) => item.id === "dummy-text-1").durationSec, 8);
	assert.equal(visualItems.find((item) => item.id === graphic.id).durationSec, 8);
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
	/* ＋ Text opens a lane of its own, so two manual lanes bring the total to four. */
	assert.equal(state.tracks.filter((track) => track.kind === "visual").length, 2);
	for (let index = 0; index < 2; index++) assert.ok(api.addVisualTrack());
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

function pointerEvent(target, type, x, y, windowRef) {
	target.dispatchEvent(new windowRef.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
}

function frameCanvas(canvas, width, height) {
	canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0 });
}

test("the dock ends in an empty scroll layer that pans the tracks and reads as one more layer", (t) => {
	const { dom, w } = openTimeline();
	t.after(() => dom.window.close());
	const doc = w.document;
	const grid = doc.getElementById("timeline-track-grid");

	const handles = Array.from(doc.querySelectorAll("[data-scroll-lane]"));
	assert.equal(handles.length, 2, "the pinned SCROLL lane and the new bottom layer are the dock's two pan handles");
	const bottom = doc.querySelector('[data-scroll-layer="bottom"]');
	assert.ok(bottom, "the bottom layer is marked as the bottom scroll layer");
	assert.equal(bottom.className, "te-scroll-layer");
	assert.equal(bottom.hasAttribute("data-lane-track"), false, "it is not a track");
	assert.equal(bottom.classList.contains("te-lane"), false, "it never joins the track lane list");
	assert.equal(bottom.querySelectorAll(".te-clip, .te-playhead, .te-lane-empty").length, 0, "the layer is empty: no clips, no playhead, no empty-track button");
	assert.equal(grid.lastElementChild, bottom, "the scroll layer is the bottom-most row of the tracks");

	const background = doc.querySelector('[data-lane-track="background-media"]');
	assert.ok(background.compareDocumentPosition(bottom) & w.Node.DOCUMENT_POSITION_FOLLOWING, "it sits below the pinned background layer");
	assert.equal(doc.querySelectorAll(".te-lane").length, 2, "the extra layer does not add a track lane");
	const label = doc.querySelector(".te-track-scroll");
	assert.ok(label, "the label column has a matching row");
	assert.equal(label.textContent, "", "SCROLL LAYER and empty · drag to pan text are removed from the label cell");

	/* it looks like a lane instead of a scrollbar widget */
	const base = APP_CSS.slice(APP_CSS.indexOf(".te-scroll-layer {"), APP_CSS.indexOf(".te-scroll-layer:active"));
	assert.match(base, /background-color:\s*var\(--te-lane\)/, "the layer reuses the lane background token");
	assert.match(base, /repeating-linear-gradient/, "the layer paints the same 80px lane grid");
	assert.match(base, /cursor:\s*grab/, "the layer advertises the pan gesture with a grab cursor");
	assert.match(base, /min-height:\s*44px/, "the layer is as tall as a lane band");
	assert.doesNotMatch(base, /::-webkit-scrollbar|overflow-x:\s*scroll/, "it is not a scrollbar widget");
	assert.match(APP_CSS, /\.te-scroll-layer \.te-scroll-hint\s*\{[^}]*position:\s*sticky/, "the hint stays readable after the tracks are panned");

	/* dragging it pans the dock exactly like the pinned SCROLL lane */
	const scroll = doc.getElementById("timeline-scroll");
	frameCanvas(bottom, 900, 44);
	pointerEvent(bottom, "pointerdown", 500, 20, w);
	pointerEvent(doc, "pointermove", 380, 20, w);
	assert.equal(scroll.scrollLeft, 120, "dragging the empty layer scrolls the tracks left");
	pointerEvent(doc, "pointermove", 500, 20, w);
	assert.equal(scroll.scrollLeft, 0, "dragging back returns to the start");
	pointerEvent(doc, "pointerup", 500, 20, w);
	assert.equal(doc.querySelectorAll(".te-clip").length, 15, "panning the empty layer changes no clip");
	assert.equal(doc.querySelectorAll(".te-playhead").length >= 1, true);
});

test("each ＋ Text and ＋ Graphic click opens a new lane on top of the lanes already open", (t) => {
	const { dom, w } = openTimeline();
	t.after(() => dom.window.close());
	const doc = w.document;
	const state = w.__TIMELINE_EDITOR_STATE__;
	const api = w.__TIMELINE_EDITOR__;
	const visuals = () => state.tracks.filter((track) => track.kind === "visual");
	const dockOrder = () => Array.from(doc.querySelectorAll(".te-lane"), (lane) => lane.getAttribute("data-lane-track"));

	assert.equal(visuals().length, 1);
	const firstLane = visuals()[0];
	const firstLaneItems = firstLane.items.length;

	doc.getElementById("timeline-add-text").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	assert.equal(visuals().length, 2, "one click opens exactly one new lane");
	const textLane = visuals()[1];
	assert.notEqual(textLane.id, firstLane.id);
	assert.equal(textLane.items.length, 1, "the new text lives in the new lane");
	assert.equal(textLane.items[0].kind, "text");
	assert.equal(firstLane.items.length, firstLaneItems, "the existing lane is left alone");
	assert.equal(dockOrder()[0], textLane.id, "the new lane is listed on top of the existing layer");
	assert.equal(dockOrder()[dockOrder().length - 1], "background-media", "the pinned background stays the last track lane");
	assert.equal(doc.getElementById("timeline-layer-count").textContent.trim(), "2 / 4");
	assert.equal(state.selectedItemId, textLane.items[0].id, "the new element is selected");

	doc.querySelector('[data-timeline-action="add-graphic"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	assert.equal(visuals().length, 3, "＋ Graphic opens its own lane too");
	const graphicLane = visuals()[2];
	assert.equal(graphicLane.items[0].kind, "graphic");
	assert.equal(dockOrder()[0], graphicLane.id, "the newest lane is the topmost row");
	assert.equal(doc.getElementById("timeline-layer-count").textContent.trim(), "3 / 4");

	/* state order is the paint order: the newest lane paints last, i.e. on top */
	assert.ok(state.tracks.indexOf(graphicLane) > state.tracks.indexOf(textLane), "the newest lane sits above the previous one in state order");
	assert.ok(state.tracks.indexOf(graphicLane) > state.tracks.indexOf(firstLane));

	assert.ok(api.addVisualTrack(), "a manual lane brings the count to four");
	assert.equal(visuals().length, 4);
	const topLane = visuals()[3];
	assert.equal(doc.getElementById("timeline-layer-count").textContent.trim(), "4 / 4");
	doc.getElementById("timeline-add-graphic").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	assert.equal(visuals().length, 4, "the four-lane cap still holds");
	assert.equal(topLane.items.length, 1, "at the cap the new element lands in the current top layer");
	assert.equal(topLane.items[0].kind, "graphic");
	assert.match(doc.getElementById("timeline-status").textContent, /top layer/i, "the status line explains the cap");

	assert.equal(doc.querySelectorAll(".te-lane").length, 5, "four text/graphics lanes plus the pinned background lane");
	assert.equal(doc.querySelector('[data-scroll-layer="bottom"]').hasAttribute("data-lane-track"), false, "the scroll layer stays outside the lane count");
});

test("a selected text or graphic is dragged on the preview canvas and the drag writes the inspector x and y", (t) => {
	const { dom, w, payload } = openTimeline();
	t.after(() => dom.window.close());
	const doc = w.document;
	const state = w.__TIMELINE_EDITOR_STATE__;
	const api = w.__TIMELINE_EDITOR__;
	const canvas = doc.getElementById("timeline-preview-canvas");
	frameCanvas(canvas, 1280, 720);
	state.playheadSec = 0;

	const graphic = api.addGraphicElement();
	assert.equal(state.selectedItemId, graphic.id);
	const xInput = () => doc.querySelector('#timeline-inspector [data-te-position="x"]');
	const yInput = () => doc.querySelector('#timeline-inspector [data-te-position="y"]');
	assert.ok(xInput() && yInput(), "the inspector X and Y controls are tagged for the drag");
	assert.equal(xInput().value, "50");
	assert.equal(yInput().value, "50");
	assert.ok(doc.querySelector("#timeline-inspector .te-inspector-note"), "the inspector tells the user the clip is draggable");

	/* grab the graphic where it is painted: 50% of 1280 by 50% of 720 */
	pointerEvent(canvas, "pointerdown", 640, 360, w);
	assert.equal(canvas.style.cursor, "grabbing", "the canvas shows the dragging cursor");
	pointerEvent(doc, "pointermove", 704, 432, w);
	assert.equal(graphic.x, 55, "64px of 1280 is +5 percent");
	assert.equal(graphic.y, 60, "72px of 720 is +10 percent");
	assert.equal(xInput().value, "55", "the X slider follows the drag");
	assert.equal(yInput().value, "60", "the Y slider follows the drag");
	pointerEvent(doc, "pointermove", 1400, 900, w);
	assert.equal(graphic.x, 100, "the drag clamps to the canvas edges");
	assert.equal(graphic.y, 100);
	pointerEvent(doc, "pointermove", 704, 432, w);
	pointerEvent(doc, "pointerup", 704, 432, w);
	assert.equal(canvas.style.cursor, "", "the cursor is released");
	assert.doesNotMatch(doc.getElementById("timeline-status").textContent, /Graphic moved/i, "dragging does not emit Graphic moved status text");
	assert.equal(graphic.size, 72, "dragging never resizes the clip");

	/* the dragged percentages live on the saved element */
	assert.equal(api.save(), true);
	const saved = JSON.parse(w.localStorage.getItem("ytvs.timeline-editor.v1." + payload.targetPageId));
	const savedGraphic = saved.scenes.flatMap((scene) => scene.elements).find((item) => item.id === graphic.id);
	assert.equal(savedGraphic.x, 55);
	assert.equal(savedGraphic.y, 60);

	/* text clips drag the same way, and the anchor is their own default y of 78 */
	const text = api.addTextElement("Drag me");
	state.playheadSec = 0;
	pointerEvent(canvas, "pointerdown", 640, Math.round(720 * 0.78), w);
	pointerEvent(doc, "pointermove", 512, Math.round(720 * 0.78), w);
	assert.equal(text.x, 40, "-128px of 1280 is -10 percent");
	assert.equal(text.y, 78, "the drag keeps the axis it did not move");
	assert.equal(xInput().value, "40");
	pointerEvent(doc, "pointerup", 512, Math.round(720 * 0.78), w);
	assert.doesNotMatch(doc.getElementById("timeline-status").textContent, /Text moved/i, "dragging does not emit Text moved status text");

	/* a click on an invisible part of the canvas still re-selects nothing else: media is not draggable */
	doc.querySelector('[data-clip-id="media-1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	assert.equal(state.selectedItemId, "media-1");
	const beforeX = text.x;
	pointerEvent(canvas, "pointerdown", 300, 120, w);
	pointerEvent(doc, "pointermove", 500, 320, w);
	pointerEvent(doc, "pointerup", 500, 320, w);
	assert.equal(text.x, beforeX, "media clips and empty canvas clicks never move a text clip");
	assert.equal(state.selectedItemId, "media-1", "the media selection is kept");

	assert.match(APP_CSS, /canvas#timeline-preview-canvas \{[^}]*touch-action:\s*none/, "the canvas opts out of native panning so the drag works on touch screens");
});

test("a duplicated background clip lands in the next time unit after the original and carries its own scene and children", (t) => {
	const { dom, w, payload } = openTimeline();
	t.after(() => dom.window.close());
	const doc = w.document;
	const state = w.__TIMELINE_EDITOR_STATE__;
	const api = w.__TIMELINE_EDITOR__;

	/* select the first background clip (a Pixabay image) */
	doc.querySelector('[data-clip-id="media-1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	assert.equal(state.selectedItemId, "media-1");
	const duplicateButton = doc.getElementById("timeline-duplicate-element");
	assert.equal(duplicateButton.hidden, false, "the duplicate button is available while a clip is selected");
	assert.equal(duplicateButton.disabled, false);

	/* a background clip can own child text/graphics, and its duplicate owns copies of them */
	state.playheadSec = 0;
	const child = api.addChildElement("graphic");
	assert.equal(child.parentId, "media-1", "the child belongs to the background clip");
	assert.equal(api.getChildElements("media-1").length, 1);

	/* the child is selected after adding it; select the background clip again before duplicating it */
	doc.querySelector('[data-clip-id="media-1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	assert.equal(state.selectedItemId, "media-1");

	const mediaTrack = state.tracks.find((track) => track.kind === "media");
	const original = mediaTrack.items.find((item) => item.id === "media-1");
	assert.equal(original.startSec, 0);
	assert.equal(original.durationSec, 5);

	duplicateButton.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

	const copy = mediaTrack.items.find((item) => item.id === state.selectedItemId);
	assert.ok(copy, "the copy is selected after the duplication");
	assert.notEqual(String(copy.id), "media-1");
	assert.equal(copy.startSec, original.startSec + original.durationSec, "the copy starts exactly where the original ends - the next time unit");
	assert.equal(copy.durationSec, original.durationSec, "the copy keeps the original duration");
	assert.equal(copy.assetId, original.assetId, "the copy points at the same local media asset");
	assert.equal(mediaTrack.items.indexOf(copy), mediaTrack.items.indexOf(original) + 1, "the copy sits right after the original in the background lane");
	assert.match(copy.label, /copy/i);
	assert.match(doc.getElementById("timeline-status").textContent, /right after the original ends/i);

	const copyScene = state.scenes.find((scene) => scene.id === copy.sceneId);
	assert.ok(copyScene, "the duplicated background clip owns its own scene");
	assert.notEqual(copy.sceneId, original.sceneId);
	assert.equal(copyScene.startSec, copy.startSec);
	assert.equal(copyScene.durationSec, copy.durationSec);
	assert.equal(state.scenes[state.scenes.indexOf(copyScene) - 1].id, original.sceneId, "the copy's scene follows the original scene");

	const copiedChildren = api.getChildElements(copy.id);
	assert.equal(copiedChildren.length, 1, "the background clip's children are duplicated with it");
	assert.equal(copiedChildren[0].parentId, copy.id);
	assert.equal(copiedChildren[0].sceneId, copy.sceneId);
	assert.equal(copiedChildren[0].startSec, copy.startSec, "the child keeps its offset inside the duplicated window");

	assert.equal(api.save(), true);
	const saved = JSON.parse(w.localStorage.getItem("ytvs.timeline-editor.v1." + payload.targetPageId));
	const savedCopy = saved.tracks.find((track) => track.kind === "media").items.find((item) => item.id === copy.id);
	assert.equal(savedCopy.startSec, 5, "the duplicate placement is persisted");
	assert.ok(saved.scenes.some((scene) => scene.id === copy.sceneId), "the duplicated scene is persisted");
});

test("a duplicated text, graphic or audio clip starts when the original timing ends", (t) => {
	const { dom, w, payload } = openTimeline();
	t.after(() => dom.window.close());
	const doc = w.document;
	const state = w.__TIMELINE_EDITOR_STATE__;
	const api = w.__TIMELINE_EDITOR__;

	const text = api.addTextElement("Keep me");
	api.setItemTiming(text.id, 2, 3);
	assert.equal(state.selectedItemId, text.id, "the new text is selected");
	const track = state.tracks.find((candidate) => candidate.items.some((item) => item.id === text.id));

	doc.getElementById("timeline-duplicate-element").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	const textCopy = track.items.find((item) => item.id === state.selectedItemId);
	assert.ok(textCopy && textCopy.id !== text.id);
	assert.equal(textCopy.startSec, 5, "2 s + 3 s: the copy starts when the original ends");
	assert.equal(textCopy.durationSec, 3);
	assert.equal(textCopy.text, "Keep me");
	assert.equal(track.items.indexOf(textCopy), track.items.indexOf(text) + 1, "the copy is listed next to the original");
	assert.match(doc.getElementById("timeline-status").textContent, /right after the original ends/i);

	const graphic = api.addGraphicElement();
	api.setItemTiming(graphic.id, 1, 2);
	doc.getElementById("timeline-duplicate-element").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	const graphicCopy = state.tracks.flatMap((candidate) => candidate.items).find((item) => item.id === state.selectedItemId);
	assert.equal(graphicCopy.startSec, 3, "the graphic copy starts when the graphic ends");

	/* a child copy that no longer fits the background window becomes a free clip */
	doc.querySelector('[data-clip-id="media-1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	const child = api.addChildElement("text");
	assert.equal(child.parentId, "media-1");
	api.duplicateSelectedItem();
	const childCopy = state.tracks.flatMap((candidate) => candidate.items).find((item) => item.id === state.selectedItemId);
	assert.equal(childCopy.startSec, 5, "the child copy also starts when the original ends");
	assert.equal(childCopy.parentId, "", "outside the background window the copy is a free clip");
	assert.match(doc.getElementById("timeline-status").textContent, /free clip/i);

	assert.equal(api.save(), true);
	const saved = JSON.parse(w.localStorage.getItem("ytvs.timeline-editor.v1." + payload.targetPageId));
	const savedCopies = saved.tracks.flatMap((candidate) => candidate.items).filter((item) => [textCopy.id, graphicCopy.id, childCopy.id].includes(item.id));
	assert.equal(savedCopies.length, 3, "every duplicate is persisted");
	assert.equal(savedCopies.find((item) => item.id === textCopy.id).startSec, 5);
});

test("a selected background clip shrinks the preview to 70 % and opens the 30 % child panel with child timing bound to the clip", (t) => {
	const { dom, w } = openTimeline();
	t.after(() => dom.window.close());
	const doc = w.document;
	const state = w.__TIMELINE_EDITOR_STATE__;
	const api = w.__TIMELINE_EDITOR__;
	const row = doc.getElementById("timeline-stage-row");
	const panel = doc.getElementById("timeline-child-panel");

	/* nothing background-ish selected at first: the panel is closed */
	doc.querySelector('[data-clip-id="dummy-text-1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	assert.equal(panel.hidden, true, "a text selection leaves the child panel closed");
	assert.equal(row.classList.contains("te-child-open"), false, "the preview keeps 100 % width");

	/* selecting the background clip opens the 30 % child section */
	doc.querySelector('[data-clip-id="media-1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	assert.equal(panel.hidden, false);
	assert.equal(row.classList.contains("te-child-open"), true, "the stage row is in the 70 / 30 mode");
	assert.equal(doc.getElementById("timeline-child-title").textContent, "Scene 1");
	assert.match(doc.getElementById("timeline-child-window").textContent, /0:00 – 0:05/, "the panel names the background clip's window");
	assert.equal(doc.querySelectorAll("#timeline-child-panel [data-timeline-action=\"add-child-text\"]").length, 1, "the panel offers the add-text button");
	assert.equal(doc.querySelectorAll("#timeline-child-panel [data-timeline-action=\"add-child-graphic\"]").length, 1, "the panel offers the add-graphic button");
	const inspectorButtons = Array.from(doc.querySelectorAll("#timeline-inspector .tm-scene-add"), (node) => node.textContent);
	assert.equal(inspectorButtons.some((label) => /Child text|Child graphic/i.test(label)), false, "Selected Scene inspector shows background media only and omits child text/graphic buttons");

	/* the child timing is the background window, not the playhead */
	state.playheadSec = 0;
	doc.querySelector('#timeline-child-panel [data-timeline-action="add-child-text"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	const child = api.getChildElements("media-1")[0];
	assert.ok(child, "the child text was created");
	assert.equal(child.parentId, "media-1");
	assert.equal(child.kind, "text");
	assert.equal(child.startSec, 0, "the child starts with its background clip");
	assert.equal(child.durationSec, 5, "the child spans its background clip");
	assert.equal(state.selectedItemId, child.id);
	assert.equal(doc.querySelectorAll("#timeline-child-list .te-child-row").length, 1, "the child is listed in the left panel");
	assert.equal(doc.querySelector("#timeline-child-list .te-child-row").classList.contains("selected"), true);
	assert.ok(doc.querySelector("#timeline-child-editor .tm-scene-field"), "the left panel edits the selected child");
	assert.doesNotMatch(doc.getElementById("timeline-child-editor").textContent, /Child of the background clip/i);
	assert.match(doc.getElementById("timeline-inspector").textContent, /Background media/, "Selected Scene inspector keeps showing the parent background media when a child clip is selected");
	assert.doesNotMatch(doc.getElementById("timeline-inspector").textContent, /Text element|Graphic element|Start inside background/i, "Selected Scene inspector never renders child text or child graphic controls");
	const startLabels = Array.from(doc.querySelectorAll("#timeline-child-editor .tm-scene-field-label"), (node) => node.textContent);
	assert.ok(startLabels.includes("Start inside background (seconds)"), "the child start is bounded by the background");
	assert.ok(startLabels.includes("Duration inside background (seconds)"), "the child duration is bounded by the background");

	/* the child can never leave the background window */
	api.setItemTiming(child.id, 4, 10);
	assert.equal(child.startSec, 4);
	assert.equal(child.durationSec, 1, "the child duration is clipped to the rest of the background window");
	api.setItemTiming(child.id, 30, 2);
	assert.equal(child.startSec, 4.75, "a start past the background is clamped to the last quarter second");
	assert.equal(child.durationSec, 0.25);

	/* moving the background moves the child's whole window */
	child.startSec = 1;
	child.durationSec = 2;
	api.setItemTiming("media-1", 2, 8);
	assert.equal(child.startSec, 3, "the child follows the background move");
	const windowLabel = doc.getElementById("timeline-child-window").textContent;
	assert.match(windowLabel, /0:02 – 0:10/, "the panel window follows the background clip");

	/* any other timeline element closes the panel and restores the full-width preview */
	doc.querySelector('[data-clip-id="dummy-text-1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	assert.equal(panel.hidden, true);
	assert.equal(row.classList.contains("te-child-open"), false);
	assert.equal(doc.getElementById("timeline-child-list").children.length, 0, "the child list is cleared with the panel");

	/* a child keeps the background context open while it is the selection */
	doc.querySelector('[data-clip-id="' + child.id + '"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	assert.equal(panel.hidden, false, "editing a child keeps its background context open");
	assert.equal(api.getBackgroundContext().id, "media-1");

	/* the markup and the stylesheet carry the 70 / 30 rule */
	const html = createHTML();
	assert.ok(html.includes('id="timeline-child-panel"'));
	assert.ok(html.includes('data-timeline-action="add-child-text"'));
	assert.ok(html.includes('data-timeline-action="add-child-graphic"'));
	assert.ok(html.includes('id="timeline-duplicate-element"'));
	assert.match(APP_CSS, /\.te-stage-row\.te-child-open > \.te-preview-panel\s*\{[^}]*flex:\s*0 0 70%/, "the preview shrinks to 70 %");
	assert.match(APP_CSS, /\.te-stage-row\.te-child-open > \.te-child-panel\s*\{[^}]*flex:\s*0 0 30%/, "the child panel owns 30 %");
	assert.match(APP_CSS, /\.te-child-panel\[hidden\]\s*\{[^}]*display:\s*none/, "the hidden panel takes no space");
});

test("timeline editor UI omits the three verbose hint paragraphs and vertically centers the preview video when width is 70%", (t) => {
	const html = createHTML();
	assert.doesNotMatch(html, /Select a clip in the timeline to edit its start and duration\./, "selected-element wall-of-text hint is removed from served HTML");
	assert.doesNotMatch(html, /Child text and graphics are timed by this background clip only:/, "child-panel hint paragraph is removed from served HTML");
	assert.doesNotMatch(html, /class="te-child-hint"/, "no .te-child-hint node in timeline markup");

	const { dom, w } = openTimeline();
	t.after(() => dom.window.close());
	const doc = w.document;
	const api = w.__TIMELINE_EDITOR__;
	const timelineView = doc.getElementById("view-timeline");

	assert.equal(timelineView.querySelector(".tm-scene-hint"), null, "timeline inspector has no .tm-scene-hint paragraph");
	assert.equal(timelineView.querySelector(".te-child-hint"), null, "timeline child panel has no .te-child-hint paragraph");

	/* select a background clip and create both a child text and a child graphic */
	doc.querySelector('[data-clip-id="media-1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	const childText = api.addChildElement("text");
	assert.ok(childText);
	assert.doesNotMatch(timelineView.textContent, /Child of the background clip/i, "child text inspector/editor does not render the removed bound-window hint");
	assert.doesNotMatch(timelineView.textContent, /Select a clip in the timeline to edit its start and duration/i);
	assert.doesNotMatch(timelineView.textContent, /Child text and graphics are timed by this background clip only/i);

	doc.querySelector('[data-clip-id="media-1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
	const childGraphic = api.addChildElement("graphic");
	assert.ok(childGraphic);
	assert.doesNotMatch(timelineView.textContent, /Child of the background clip/i, "child graphic inspector/editor does not render the removed bound-window hint");

	/* 70% / 30% split keeps both columns equal height and expands the preview stage to match */
	const preview70Rule = APP_CSS.match(/\.te-stage-row\.te-child-open > \.te-preview-panel\s*\{([^}]*)\}/);
	assert.ok(preview70Rule, "70% preview panel rule exists");
	assert.match(preview70Rule[1], /width:\s*70%/);
	assert.match(preview70Rule[1], /align-self:\s*stretch/, "70% preview panel stretches to the same height as the 30% column");
	assert.match(preview70Rule[1], /max-height:\s*calc\(100vh - 70px\)/, "70% preview panel matches the 30% child panel max-height cap");
	assert.match(preview70Rule[1], /justify-content:\s*center/);

	const child30Rule = APP_CSS.match(/\.te-stage-row\.te-child-open > \.te-child-panel\s*\{([^}]*)\}/);
	assert.ok(child30Rule, "30% child panel rule exists");
	assert.match(child30Rule[1], /width:\s*30%/);
	assert.match(child30Rule[1], /align-self:\s*stretch/, "30% child panel stretches to match the 70% preview panel");

	const stage70Rule = APP_CSS.match(/\.te-stage-row\.te-child-open \.te-preview-stage\s*\{([^}]*)\}/);
	assert.ok(stage70Rule, "70% preview stage rule exists");
	assert.match(stage70Rule[1], /flex:\s*1 1 auto/, "preview stage grows vertically to match the 30% column height");
	assert.match(stage70Rule[1], /height:\s*auto/);
	assert.match(stage70Rule[1], /min-height:\s*320px/);
	assert.match(stage70Rule[1], /max-height:\s*none/);
	assert.match(stage70Rule[1], /align-items:\s*center/);
	assert.match(stage70Rule[1], /justify-content:\s*center/);

	const canvas70Rule = APP_CSS.match(/\.te-stage-row\.te-child-open \.te-preview-stage canvas#timeline-preview-canvas\s*\{([^}]*)\}/);
	assert.ok(canvas70Rule, "70% preview canvas rule exists");
	assert.match(canvas70Rule[1], /align-self:\s*center/);
	assert.match(canvas70Rule[1], /margin:\s*auto/);

	/* below 860px the preview returns to 100% width and resets its stacked stage height */
	const mobileBlock = APP_CSS.slice(APP_CSS.lastIndexOf("@media (max-width: 860px)"));
	const mobilePreviewRule = mobileBlock.match(/\.te-stage-row\.te-child-open > \.te-preview-panel\s*\{([^}]*)\}/);
	assert.ok(mobilePreviewRule, "responsive 100% override exists");
	assert.match(mobilePreviewRule[1], /width:\s*100%/);
	assert.match(mobilePreviewRule[1], /max-height:\s*none/);
	assert.match(mobilePreviewRule[1], /justify-content:\s*flex-start/);
});

test("timeline editor hides bottom gallery cards, renames Selected Scene and Scene's media, keeps background media only in Selected Scene, and omits dock/scroll-layer copy", async (t) => {
	const html = createHTML();
	assert.ok(html.includes('<div class="tm-sec-title">Selected Scene</div>'), "TIMELINE EDITOR section heading is Selected Scene");
	assert.equal(html.includes('<div class="tm-sec-title">Selected element</div>'), false, "Selected element heading is gone");
	assert.doesNotMatch(html, /Text and graphics lanes stack above the pinned background layer/, "dock footer explanatory paragraph is removed from markup");
	assert.doesNotMatch(html, /Pixabay &amp; uploaded media|Pixabay & uploaded media/, "old media track label is absent from markup");

	/* CSS hides #gallery in timeline mode */
	assert.match(APP_CSS, /body\.timeline-editor-page #gallery[\s\S]*?#studio-app\.timeline-mode > #gallery[\s\S]*?display:\s*none !important/, "CSS hides #gallery on timeline editor page");

	/* Full route boot with APP_JS + TIMELINE_EDITOR_JS confirms no Generating AI Scene cards at bottom */
	const fullDom = new JSDOM(html, {
		url: "https://studio.test/free?layout=timeline&project=test-proj",
		runScripts: "dangerously",
		pretendToBeVisual: true,
		beforeParse(w) {
			const ctx = canvasContext();
			w.HTMLCanvasElement.prototype.getContext = () => ctx;
			w.URL.createObjectURL = () => "blob:test";
			w.URL.revokeObjectURL = () => {};
			w.fetch = async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
		}
	});
	t.after(() => fullDom.window.close());

	const doc = fullDom.window.document;
	const gallery = doc.getElementById("gallery");
	assert.ok(gallery, "#gallery node exists in shell");
	assert.equal(gallery.children.length, 0, "no Generating AI Scene cards are created on layout=timeline");
	assert.equal(gallery.hidden, true, "#gallery is hidden on layout=timeline");
	assert.equal(fullDom.window.getComputedStyle(gallery).display, "none", "#gallery computed display is none on layout=timeline");
	assert.doesNotMatch(doc.getElementById("studio-app").textContent, /Generating AI Scene/i, "no Generating AI Scene text anywhere in #studio-app on timeline editor page");

	/* Media track label is Scene's media */
	const mediaTrackButton = doc.querySelector('.te-track-background [data-track-select="background-media"]');
	assert.ok(mediaTrackButton, "background media track label exists");
	assert.equal(mediaTrackButton.childNodes[0].textContent, "Scene's media", "media track label reads Scene's media");
	assert.doesNotMatch(doc.getElementById("view-timeline").textContent, /Pixabay &\s*uploaded media/i);

	/* Scroll layer label cell has neither SCROLL LAYER nor empty · drag to pan */
	const scrollLabel = doc.querySelector(".te-track-scroll");
	assert.ok(scrollLabel);
	assert.equal(scrollLabel.textContent, "");
	assert.doesNotMatch(doc.getElementById("view-timeline").textContent, /SCROLL LAYER/);
	assert.doesNotMatch(doc.getElementById("view-timeline").textContent, /empty · drag to pan/);

	/* Selected Scene section shows background media only, even when a child text or child graphic is selected */
	const api = fullDom.window.__TIMELINE_EDITOR__;
	doc.querySelector('[data-clip-id="scene-media-1"]')?.dispatchEvent(new fullDom.window.MouseEvent("click", { bubbles: true }));
	const firstMediaId = fullDom.window.__TIMELINE_EDITOR_STATE__.tracks.find((tr) => tr.kind === "media").items[0].id;
	doc.querySelector('[data-clip-id="' + firstMediaId + '"]').dispatchEvent(new fullDom.window.MouseEvent("click", { bubbles: true }));

	const childText = api.addChildElement("text");
	assert.ok(childText);
	assert.equal(doc.querySelector(".te-workspace .tm-sec-title").textContent, "Selected Scene");
	assert.equal(doc.querySelectorAll("#timeline-element-selector .tm-scene-object").length, 0, "Selected Scene selector lists no child text/graphic pills");
	assert.match(doc.getElementById("timeline-inspector").textContent, /Background media/, "Selected Scene inspector shows Background media when child text is selected");
	assert.doesNotMatch(doc.getElementById("timeline-inspector").textContent, /Text element|Child text|Child graphic/i, "Selected Scene inspector omits child text controls");
	assert.match(doc.getElementById("timeline-child-editor").textContent, /Text element/, "30% child panel still edits the selected child text");

	doc.querySelector('[data-clip-id="' + firstMediaId + '"]').dispatchEvent(new fullDom.window.MouseEvent("click", { bubbles: true }));
	const childGraphic = api.addChildElement("graphic");
	assert.ok(childGraphic);
	assert.equal(doc.querySelectorAll("#timeline-element-selector .tm-scene-object").length, 0, "Selected Scene selector lists no child graphic pills");
	assert.match(doc.getElementById("timeline-inspector").textContent, /Background media/, "Selected Scene inspector shows Background media when child graphic is selected");
	assert.doesNotMatch(doc.getElementById("timeline-inspector").textContent, /Graphic element|Child text|Child graphic/i, "Selected Scene inspector omits child graphic controls");
	assert.match(doc.getElementById("timeline-child-editor").textContent, /Graphic element/, "30% child panel still edits the selected child graphic");
});
