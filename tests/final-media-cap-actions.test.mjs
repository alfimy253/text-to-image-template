/*
 * FINAL RULE — fixed 12-scene media cap, individual media retries, unique
 * filenames, one Actions column and transition-only Edit JSON. These tests
 * guard the live source contracts rather than a rendered screenshot.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHTML } from "../src/page.ts";
import { PAGE_MARKUP } from "../src/client/markup.ts";
import { APP_JS } from "../src/client/app-js.ts";
import { APP_CSS } from "../src/client/styles.ts";
import { PROGRESSIVE_IMAGE_PIPELINE_JS } from "../src/client/progressive-image-pipeline.ts";
import {
	SCENE_MEDIA_TOTAL,
	SCENE_VIDEO_COUNT,
	SCENE_IMAGE_COUNT,
	SCENE_COUNT_MIN,
	SCENE_COUNT_MAX,
	sceneCountForScript,
	sceneCountCeiling,
	resolveSceneTotal,
	videoScenePositions
} from "../src/modules/image-prompts.ts";
import {
	PIXABAY_PER_PAGE,
	PIXABAY_IMAGE_RESULTS,
	PIXABAY_VIDEO_RESULTS,
	PIXABAY_MAX_PAGES,
	sceneSearchToken
} from "../src/modules/pixabay.ts";
import { IMAGE_BATCH_MAX_PROMPTS } from "../src/modules/image-batch.ts";

function makeApp(url = "https://studio.test/free", prepare) {
	const dom = new JSDOM(createHTML(), {
		url,
		runScripts: "outside-only",
		pretendToBeVisual: true
	});
	const w = dom.window;
	let objectUrlId = 0;
	w.alert = () => { };
	w.confirm = () => true;
	w.scrollTo = () => { };
	w.URL.createObjectURL = () => "blob:final-media-" + (++objectUrlId);
	w.URL.revokeObjectURL = () => { };
	w.__PLAN_MODE = "freemium";
	if (prepare) prepare(w);
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	(() => {
		const raw = w.setTimeout.bind(w);
		w.setTimeout = (cb, ms, ...a) => raw(cb, Number(ms) === 40000 ? 0 : ms, ...a);
	})();
	w.__MEDIA_ITEM_RETRY_TIMING = { maxRetries: 7, backoffMs: 0, uiCheckMs: 0 };
	if (w.__SCRIPT_RETRY_TIMING) {
		w.__SCRIPT_RETRY_TIMING.maxRetries = 7;
		w.__SCRIPT_RETRY_TIMING.backoffMs = 0;
		w.__SCRIPT_RETRY_TIMING.uiCheckMs = 0;
	}
	return { dom, w };
}

test("the planner and Pixabay search always use 12 scenes: 4 videos + 8 photos", () => {
	assert.equal(SCENE_MEDIA_TOTAL, 12);
	assert.equal(SCENE_VIDEO_COUNT, 4);
	assert.equal(SCENE_IMAGE_COUNT, 8);
	assert.equal(SCENE_COUNT_MIN, 12);
	assert.equal(SCENE_COUNT_MAX, 12);
	assert.equal(IMAGE_BATCH_MAX_PROMPTS, 12);
	for (const text of ["one", "a ".repeat(129), "a ".repeat(400), "a ".repeat(900)]) {
		assert.equal(sceneCountForScript(text), 12, "fixed total for every script length");
		assert.equal(sceneCountCeiling(text, 1), 12, "short duration keeps the fixed total");
		assert.equal(sceneCountCeiling(text, 6), 12, "long duration keeps the fixed total");
		assert.equal(resolveSceneTotal({ script: text, minutes: 3 }), 12);
	}
	const positions = videoScenePositions(12);
	assert.equal(positions.length, 4);
	assert.equal(new Set(positions).size, 4);
	assert.ok(positions.every((position) => Number.isInteger(position) && position >= 0 && position < 12));
	assert.equal(PIXABAY_PER_PAGE, 12);
	assert.equal(PIXABAY_IMAGE_RESULTS, 8);
	assert.equal(PIXABAY_VIDEO_RESULTS, 4);
	assert.equal(PIXABAY_MAX_PAGES, 2);
	const token = JSON.parse(sceneSearchToken("calm yoga", 11).slice(8));
	assert.equal(token.type, "image");
	assert.equal(token.index, 7);
	assert.equal(token.scene, 11);
	assert.match(PROGRESSIVE_IMAGE_PIPELINE_JS, /IMAGE_SCENE_MEDIA_TOTAL = 12/);
	assert.match(PROGRESSIVE_IMAGE_PIPELINE_JS, /IMAGE_SCENE_VIDEO_COUNT = 4/);
	assert.match(PROGRESSIVE_IMAGE_PIPELINE_JS, /IMAGE_SCENE_IMAGE_COUNT = 8/);
	assert.doesNotMatch(PROGRESSIVE_IMAGE_PIPELINE_JS, /\[\[130, 6\], \[240, 8\], \[500, 10\]\]/);
});

test("the last table column is Actions with Preview, Process Export and Edit icons", () => {
	assert.match(PAGE_MARKUP, /<th class="batch-col-actions">Actions<\/th>/);
	assert.doesNotMatch(PAGE_MARKUP, /batch-col-preview|batch-col-export/);
	assert.match(APP_CSS, /batch-col-actions/);
	assert.match(APP_CSS, /batch-action-icons/);
	assert.match(APP_JS, /data-batch-slot="actions"/);
	assert.match(APP_JS, /data-batch-action="preview"/);
	assert.match(APP_JS, /data-batch-action="export"/);
	assert.match(APP_JS, /data-batch-action="edit"/);
	assert.match(APP_JS, /title="Process export"/);
	assert.match(APP_JS, /"Preview Here"/);
	assert.match(APP_JS, /"Export Video"/);
	assert.doesNotMatch(APP_JS, /data-batch-generate|batch-row-ai/);
	assert.doesNotMatch(APP_CSS, /batch-row-ai/);
	assert.match(APP_JS, /AUTO_MEDIA_TOTAL = 12/);
	assert.match(APP_JS, /AUTO_VIDEO_SCENES = 4/);
	assert.match(APP_JS, /AUTO_IMAGE_SCENES = 8/);
});

test("Edit opens a new page with transition-only basic settings and no AI enhancer row button", async () => {
	let opened = "";
	const { dom, w } = makeApp("https://studio.test/free", (win) => {
		win.open = (href) => { opened = String(href); return null; };
	});
	test.after(() => dom.window.close());
	const row = w.addBatchRow({
		script: "Quiet rooftop gardens in the morning.",
		style: "Neon Night",
		minutes: 3,
		resolution: "720p",
		orientation: "landscape"
	});
	row.images = Array.from({ length: 12 }, (_, index) => ({
		index,
		blob: { type: index === 3 ? "video/mp4" : "image/jpeg", stockFilename: "scene-" + (index + 1) },
		stockFilename: "scene-" + (index + 1)
	}));
	const tr = w.document.querySelector('[data-batch-row="' + row.id + '"]');
	assert.ok(tr, "the row is rendered");
	assert.equal(tr.querySelector("[data-batch-generate]"), null, "AI enhancer button is gone");
	assert.ok(tr.querySelector('[data-batch-action="edit"]'), "Edit icon is present");
	const actions = tr.querySelector('[data-batch-slot="actions"]');
	assert.ok(actions, "one Actions cell replaces the Preview/Export cells");
	assert.match(actions.textContent, /Preview Here/);
	tr.querySelector('[data-batch-action="edit"]').click();
	assert.match(opened, /layout=timeline/);
	assert.match(opened, /pipelinePage=/);
	assert.match(opened, /projectEdit=/);
	assert.doesNotMatch(opened, /projectJson=/, "the full project no longer rides in the URL");
	assert.ok(w.__BATCH_EDIT_PROJECT__, "the opener exposes the project JSON");
	assert.equal(w.__BATCH_EDIT_PROJECT__.transitionOnly, true);
	assert.equal(w.__BATCH_EDIT_PROJECT__.source, "quick-batch-table-edit");
	assert.ok(w.__BATCH_EDIT_PROJECT__.sourcePageId, "the source page id is recorded");
	assert.equal(w.__BATCH_EDIT_PROJECT__.targetPageId, "timeline-" + w.__PIPELINE_MANAGEMENT_STORE__.pageId + "-row-" + String(row.id), "the timing project id is stable per Quick Batch row");
	assert.ok(w.__BATCH_EDIT_PROJECT__.basicSettings.vid, "the drafted row has a page-scoped vid");
	assert.equal(w.__BATCH_EDIT_PROJECT__.timelineState.scenes.length, 12, "handoff includes one timing record per scene");
	assert.deepEqual(Array.from(w.__BATCH_EDIT_PROJECT__.timelineState.tracks, (track) => track.kind), ["audio", "audio", "audio", "media", "visual"]);
	assert.equal(w.__BATCH_EDIT_PROJECT__.timelineState.soundExpanded, false, "Soundtrack starts collapsed");
	const mediaTrack = w.__BATCH_EDIT_PROJECT__.timelineState.tracks.find((track) => track.kind === "media");
	assert.equal(mediaTrack.items.length, 12, "the 12 Quick Batch media slots are retained in the timeline");
	assert.deepEqual(Array.from(mediaTrack.items, (item) => item.assetId), Array.from({ length: 12 }, (_, index) => "scene-" + (index + 1)));
	assert.equal(mediaTrack.items[3].mediaType, "video", "MP4 scene metadata survives the handoff");
	assert.equal(w.__BATCH_EDIT_PROJECT__.timelineState.scenes[0].durationSec, 15, "scene durations follow the requested three-minute draft");
	assert.equal(w.__BATCH_EDIT_PROJECT__.basicSettings.script, row.script);
	assert.equal(w.__BATCH_EDIT_PROJECT__.basicSettings.style, "Neon Night");
	assert.equal(w.__BATCH_EDIT_PROJECT__.basicSettings.minutes, 3);
	assert.equal(w.__BATCH_EDIT_PROJECT__.basicSettings.resolution, "720p");
	assert.equal(w.__BATCH_EDIT_PROJECT__.basicSettings.orientation, "landscape");
	const key = new URL(opened, "https://studio.test").searchParams.get("projectEdit");
	const stored = JSON.parse(w.localStorage.getItem("ytvs.transition-project.v1." + key));
	assert.equal(stored.transitionOnly, true, "the full handoff lives in localStorage");
	assert.equal(stored.createdAt, w.__BATCH_EDIT_PROJECT__.createdAt, "localStorage and cookie timestamps match");
	assert.match(w.document.cookie, /ytvs_transition_project_/, "the short cookie mirror is present");
});

test("a Quick Batch row hands off one dummy text at 0:00 instead of caption clips", () => {
	let opened = "";
	const { dom, w } = makeApp("https://studio.test/free", (win) => {
		win.open = (href) => { opened = String(href); return null; };
	});
	test.after(() => dom.window.close());
	const row = w.addBatchRow({ script: "Quiet rooftop gardens in the morning.", style: "Neon Night", minutes: 1 });
	/* the row carries subtitle cues, but cues are no longer timeline clips */
	row.subtitles = [
		{ startMs: 0, endMs: 2000, text: "Quiet rooftop gardens" },
		{ startMs: 2000, endMs: 4000, text: "in the morning" }
	];
	w.renderBatchTable();
	w.document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-action="edit"]').click();
	assert.match(opened, /layout=timeline/);
	const state = w.__BATCH_EDIT_PROJECT__.timelineState;
	const visual = state.tracks.find((track) => track.kind === "visual");
	assert.equal(visual.items.length, 1, "the text lane holds exactly one clip");
	assert.equal(visual.items[0].id, "dummy-text-1");
	assert.equal(visual.items[0].kind, "text");
	assert.equal(visual.items[0].startSec, 0, "the dummy text sits at 0:00");
	assert.equal(visual.items[0].text, "Your text here");
	assert.equal(visual.items[0].dummy, true);
	const captionIds = state.scenes.flatMap((scene) => (scene.elements || []).map((element) => element.id))
		.filter((id) => /-caption-\d+$/.test(String(id)));
	assert.equal(captionIds.length, 0, "subtitle cues never become timeline clips");
	assert.deepEqual(
		Array.from(state.subtitles, (cue) => ({ startMs: cue.startMs, endMs: cue.endMs, text: cue.text })),
		[
			{ startMs: 0, endMs: 2000, text: "Quiet rooftop gardens" },
			{ startMs: 2000, endMs: 4000, text: "in the morning" }
		],
		"the row's subtitle cues ride along as data so the timeline preview can paint them"
	);
	assert.deepEqual(
		Array.from(state.scenes[0].elements, (element) => element.id),
		["dummy-text-1"],
		"the dummy text is also listed on the first scene"
	);
});

test("the edit icon passes the row's live video style into the project detail and the timeline handoff", () => {
	let opened = "";
	const { dom, w } = makeApp("https://studio.test/free", (win) => {
		win.open = (href) => { opened = String(href); return null; };
	});
	test.after(() => dom.window.close());
	const row = w.addBatchRow({ script: "Quiet rooftop gardens in the morning.", style: "Neon Night", minutes: 1 });
	const tr = w.document.querySelector('[data-batch-row="' + row.id + '"]');
	/* the user picks a new style; the click itself must read it even before a change event commits */
	const styleSelect = tr.querySelector('[data-batch-field="style"]');
	styleSelect.value = "Cinematic Film";
	tr.querySelector('[data-batch-action="edit"]').click();

	const payload = w.__BATCH_EDIT_PROJECT__;
	assert.equal(row.style, "Cinematic Film", "the row model follows the control the user picked");
	assert.equal(payload.basicSettings.style, "Cinematic Film", "the style lands in the transition-only basic settings");
	assert.ok(payload.projectDetail, "the handoff now carries a project detail");
	assert.equal(payload.projectDetail.style, "Cinematic Film", "the project detail carries the video style");
	assert.deepEqual(Array.from(payload.projectDetail.effects), ["duotone"], "Cinematic Film resolves to the double gradient");
	assert.equal(payload.projectDetail.effectLabel, "double gradient");
	assert.equal(payload.projectDetail.sceneCount, 12);
	assert.equal(payload.projectDetail.scenes.length, 12);
	assert.ok(
		payload.projectDetail.scenes.every((scene) => Array.from(scene.effects).join(",") === "duotone"),
		"every scene in the project detail carries the double gradient"
	);
	assert.equal(payload.timelineState.videoStyle, "Cinematic Film", "the timeline state carries the same style");
	assert.deepEqual(Array.from(payload.timelineState.videoStyleEffects), ["duotone"]);
	assert.equal(payload.timelineState.scenes.length, 12);
	assert.ok(
		payload.timelineState.scenes.every((scene) => Array.from(scene.effects).join(",") === "duotone" && scene.videoStyle === "Cinematic Film"),
		"all 12 timeline scenes are stamped with the style and its effects"
	);
	const key = new URL(opened, "https://studio.test").searchParams.get("projectEdit");
	const stored = JSON.parse(w.localStorage.getItem("ytvs.transition-project.v1." + key));
	assert.equal(stored.projectDetail.style, "Cinematic Film", "the stored handoff carries the project detail too");
	assert.match(decodeURIComponent(w.document.cookie), /Cinematic Film/, "the short cookie mirror names the style");

	/* a neon row asked for the neon image effect together with the VHS effect */
	styleSelect.value = "Neon Night";
	styleSelect.dispatchEvent(new w.Event("change", { bubbles: true }));
	tr.querySelector('[data-batch-action="edit"]').click();
	assert.deepEqual(Array.from(w.__BATCH_EDIT_PROJECT__.projectDetail.effects), ["neon", "vhs"]);
	assert.deepEqual(Array.from(w.__BATCH_EDIT_PROJECT__.timelineState.videoStyleEffects), ["neon", "vhs"]);
	assert.ok(
		w.__BATCH_EDIT_PROJECT__.timelineState.scenes.every((scene) => Array.from(scene.effects).join(",") === "neon,vhs"),
		"a neon row applies the neon and VHS effects to all scenes"
	);
});

test("the new page consumes project JSON for the transition only and restores basic settings", async () => {
	const payload = {
		version: 1,
		transitionOnly: true,
		source: "quick-batch-table-edit",
		createdAt: 1730000000000,
		sourcePageId: "p_source_1",
		targetPageId: "p_target_1",
		basicSettings: {
			id: 9,
			vid: "p_source_1-row-9",
			title: "Rooftop gardens",
			topic: "quiet gardens",
			script: "Quiet rooftop gardens in the morning.",
			style: "Documentary",
			minutes: 4,
			resolution: "1024p",
			orientation: "portrait",
			quality: "sharp"
		}
	};
	const key = "edit-test-1";
	const url = "https://studio.test/free?layout=editor&pipelinePage=" + encodeURIComponent(payload.targetPageId) +
		"&projectEdit=" + encodeURIComponent(key);
	const { dom, w } = makeApp(url, (win) => {
		win.localStorage.setItem("ytvs.transition-project.v1." + key, JSON.stringify(payload));
		win.document.cookie = "ytvs_transition_project_" + key + "=" + encodeURIComponent(JSON.stringify({
			v: 1,
			key: key,
			createdAt: payload.createdAt,
			sourcePageId: payload.sourcePageId,
			targetPageId: payload.targetPageId,
			vid: payload.basicSettings.vid
		})) + "; Path=/; SameSite=Lax";
	});
	test.after(() => dom.window.close());
	assert.equal(w.__TRANSITION_PROJECT__.transitionOnly, true);
	assert.equal(w.localStorage.getItem("ytvs.transition-project.v1." + key), null, "transition JSON is not persistent project storage");
	assert.doesNotMatch(w.document.cookie, /ytvs_transition_project_/, "the cookie mirror is consumed too");
	assert.ok(w.__VIDEO_PROJECTS.length >= 1, "an editor project was created for the transition");
	const project = w.__VIDEO_PROJECTS[0];
	assert.equal(project.script, payload.basicSettings.script);
	assert.equal(project.videoImageStyle, "Documentary");
	assert.equal(project._seoTopic, "quiet gardens");
	assert.equal(project._seoMinutes, 4);
	assert.equal(project.resolution, "1024p");
	assert.equal(project.orientation, "portrait");
	assert.equal(w.document.getElementById("va-title-1").value, "Rooftop gardens");
	assert.equal(project._pipelineVid, "p_source_1-row-9", "the new editor project keeps the page-scoped vid");
});

test("client JS records unique filenames and retries only failed media items", async () => {
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	const owner = { mediaFilenames: [] };
	const first = { type: "image/jpeg", stockSource: { id: 481 }, size: 100 };
	const duplicate = { type: "image/jpeg", stockSource: { id: 481 }, size: 100 };
	const different = { type: "image/jpeg", stockSource: { id: 482 }, size: 100 };
	assert.equal(await w.acceptMediaBlob(owner, first, 0), true);
	assert.equal(await w.acceptMediaBlob(owner, duplicate, 1), false, "duplicate Pixabay filename is rejected");
	assert.equal(await w.acceptMediaBlob(owner, different, 2), true);
	assert.equal(owner.mediaFilenames.length, 2);
	assert.equal(new Set(owner.mediaFilenames).size, 2);
	assert.equal(first.stockFilename, owner.mediaFilenames[0]);
	assert.equal(w.__MEDIA_FILENAME_LOG.filter((entry) => entry.filename === first.stockFilename).length, 1);

	const token = "pixabay:" + JSON.stringify({ q: "calm yoga", type: "image", page: 1, index: 0, scene: 0 });
	const next = JSON.parse(w.alternateMediaPrompt(token, 1, 0).slice(8));
	assert.equal(next.index, 1, "a retry searches a different Pixabay result index");
	assert.equal(next.retry, 1);
	assert.equal(next.uniqueFilename, "required");

	const requested = [];
	w.__MEDIA_ITEM_RETRY_LOG = [];
	const result = await w.retryFailedMediaOnly(
		{ mediaFilenames: [] },
		["a", "b", "c"],
		[0, 1, 2],
		async (prompts, scenes) => {
			requested.push(scenes.slice());
			if (requested.length === 1) return { images: ["a", "c"], failed: [1] };
			return { images: ["b"], failed: [] };
		},
		"test-media"
	);
	assert.equal(JSON.stringify(requested), JSON.stringify([[0, 1, 2], [1]]), "only the failed scene is requested again");
	assert.equal(JSON.stringify(result.images), JSON.stringify(["a", "c", "b"]));
	assert.equal(JSON.stringify(result.failed), "[]");
	assert.equal(result.attempts, 2);
});

test("a persistent failed image gets seven 40-second-style backoffs and eight total attempts", async () => {
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	w.__MEDIA_ITEM_RETRY_LOG = [];
	w.__MEDIA_ITEM_RETRY_TIMING = { maxRetries: 7, backoffMs: 0, uiCheckMs: 0 };
	let calls = 0;
	const result = await w.retryFailedMediaOnly(
		{ mediaFilenames: [] },
		["persistent-failure"],
		[0],
		async () => { calls += 1; return { images: [], failed: [0] }; },
		"test-media"
	);
	assert.equal(calls, 8, "one initial attempt plus seven retries");
	assert.equal(result.attempts, 8);
	assert.equal(JSON.stringify(result.failed), "[0]");
	assert.equal(w.__MEDIA_ITEM_RETRY_LOG.filter((entry) => entry.event === "backoff").length, 7);
	assert.match(APP_JS, /MEDIA_ITEM_MAX_RETRIES = 7/);
	assert.match(APP_JS, /MEDIA_ITEM_RETRY_BACKOFF_MS = 40000/);
	assert.match(APP_JS, /requestBatchImagesWithIndividualRetries/);
	assert.match(APP_JS, /runEditorMediaWithIndividualRetries/);
});

test("pipeline storage failures show a visible warning and a working reset action", async () => {
	let blocked = true;
	const { dom, w } = makeApp("https://studio.test/free", (win) => {
		const storageProto = Object.getPrototypeOf(win.localStorage);
		const original = storageProto.setItem;
		Object.defineProperty(storageProto, "setItem", {
			configurable: true,
			value: function (key, value) {
				if (blocked) throw new Error("Simulated localStorage quota failure");
				return original.call(this, key, value);
			}
		});
		win.__UNBLOCK_STORAGE__ = () => { blocked = false; };
	});
	test.after(() => dom.window.close());
	const alert = w.document.getElementById("pipeline-storage-alert");
	const message = w.document.getElementById("pipeline-storage-message");
	const resetButton = w.document.getElementById("pipeline-storage-reset");
	assert.ok(alert, "the storage warning container exists");
	assert.ok(resetButton, "the recovery button exists");
	assert.equal(alert.hidden, false, "a failed startup save is visible");
	assert.match(message.textContent, /could not be saved or verified/i);
	assert.equal(w.__PIPELINE_MANAGEMENT_WARNING__.visible, true);
	w.__UNBLOCK_STORAGE__();
	resetButton.click();
	assert.equal(w.__PIPELINE_MANAGEMENT_RESET__.cleared, true, "clear() was wired to the reset action");
	assert.equal(alert.hidden, true, "a successful fresh save hides the warning");
	assert.equal(w.__PIPELINE_MANAGEMENT_WARNING__.visible, false);
});

test("Generate refuses unprepared staged rows and starts only ready rows", async () => {
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	while (w.__BATCH_ROWS.length) w.removeBatchRow(w.__BATCH_ROWS[0].id);
	const staged = w.addBatchRow({ script: "A staged row with a script." });
	staged.stage = "voice";
	staged.running = true;
	staged.retrying = false;
	staged.stopRequested = false;
	w.document.getElementById("batch-generate").click();
	assert.match(
		w.document.getElementById("required-modal-list").textContent,
		/Generate starts only rows marked Ready/
	);
	assert.equal(staged.running, true, "the staged row was left unchanged");
	assert.equal(staged.stage, "voice", "the staged row was not requeued");
});

test("duplicate row media indices still reach the background layer as distinct scene keys", async () => {
	/*
	 * Session 331 follow-up: the timeline keeps ONE background layer keyed by
	 * scene id. Two row images that report the same index would collapse onto the
	 * same key, so the handoff must move the duplicate to the next free slot.
	 */
	const transfers = [];
	const { dom, w } = makeApp("https://studio.test/free", (win) => {
		win.open = () => null;
		win.__TIMELINE_EDITOR__ = {
			storeProjectAssets: (id, transfer) => { transfers.push({ id, transfer }); return Promise.resolve({ ok: true }); }
		};
	});
	test.after(() => dom.window.close());
	const row = w.addBatchRow({ script: "Two clips share an index.", minutes: 1 });
	row.images = [
		{ index: 0, blob: new w.Blob(["a"], { type: "image/jpeg" }), stockFilename: "first.jpg" },
		{ index: 0, blob: new w.Blob(["b"], { type: "image/jpeg" }), stockFilename: "second.jpg" }
	];
	w.document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-action="edit"]').click();
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(transfers.length, 1, "the Edit handoff wrote one IndexedDB transfer");
	const keys = transfers[0].transfer.assets.map((asset) => asset.id);
	assert.equal(keys.length, 2, "both Blobs are transferred - neither is dropped");
	assert.equal(new Set(keys).size, 2, "the duplicate index got its own background scene key");
	assert.deepEqual(keys, ["scene-1", "scene-2"]);
	assert.equal(transfers[0].id, w.__BATCH_EDIT_PROJECT__.targetPageId, "the transfer is keyed by the stable row project id");
});
