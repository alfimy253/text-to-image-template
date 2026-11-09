/*
 * The eight requirements of the current session, guarded end to end:
 *
 *  1. the script is plain narration text - no subtitle format ever reaches
 *     the browser, so there is nothing for the voiceover model to misread;
 *  2. every scene prompt is a three-paragraph art direction (worker side);
 *  3-4. the script window tells the user they can walk away, and a failed
 *     script is retried seven times silently by the browser before it stops;
 *  5. one walkthrough / voiceover window per video, stacked;
 *  6. the table layout is an editable quick-batch table whose Preview and
 *     Export cells unlock together, once a row's MP3 + images + animation
 *     are through, with the export built in the browser.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
import { APP_CSS } from "../src/client/styles.ts";
import {
	IMAGE_PROMPT_MIN_PARAGRAPHS,
	IMAGE_PROMPT_MAX_CHARS,
	IMAGE_STYLES,
	buildImagePromptInstruction,
	applyImageStyleToPrompts,
	countPromptParagraphs,
	splitPromptParagraphs
} from "../src/modules/image-prompts.ts";
import { plainScriptFromSrt } from "../src/modules/script-seo.ts";

const script = "Morning yoga opens the shoulders. Long tails follow the breath.";

function makeApp() {
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	const w = dom.window;
	let objectUrlId = 0;
	w.alert = () => { };
	w.confirm = () => true;
	w.scrollTo = () => { };
	w.URL.createObjectURL = () => "blob:batch-test-" + (++objectUrlId);
	w.URL.revokeObjectURL = () => { };
	w.__PLAN_MODE = "freemium";
	/* JSDOM is hidden/2-core by default; the concurrency tests model a visible 8-core tab. */
	Object.defineProperty(w.document, "hidden", { configurable: true, get: () => false });
	Object.defineProperty(w.navigator, "hardwareConcurrency", { configurable: true, get: () => 8 });
	Object.defineProperty(w.navigator, "deviceMemory", { configurable: true, get: () => 8 });
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	(() => { const raw = w.setTimeout.bind(w); w.setTimeout = (cb, ms, ...a) => raw(cb, Number(ms) === 40000 ? 0 : ms, ...a); })();
	/* The fixed plan includes four mock MP4s; make their metadata probe succeed. */
	w.__CLIP_PROBE_TIMING = { timeoutMs: 1 };
	Object.defineProperty(w.HTMLMediaElement.prototype, "src", {
		configurable: true,
		get: function () { return this.getAttribute("src") || ""; },
		set: function (value) {
			this.setAttribute("src", value);
			w.setTimeout(() => this.dispatchEvent(new w.Event("loadedmetadata")), 0);
		}
	});
	w.HTMLMediaElement.prototype.load = function () {
		w.setTimeout(() => this.dispatchEvent(new w.Event("loadedmetadata")), 0);
	};
	w.HTMLMediaElement.prototype.pause = function () { };
	Object.defineProperty(w.HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 1 });
	Object.defineProperty(w.HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 2 });
	Object.defineProperty(w.HTMLMediaElement.prototype, "videoWidth", { configurable: true, get: () => 1024 });
	Object.defineProperty(w.HTMLMediaElement.prototype, "videoHeight", { configurable: true, get: () => 576 });
	/* Keep the seven-retry ladder, but make its 40 s backoffs instant here. */
	w.__SCRIPT_RETRY_TIMING.maxRetries = 7;
	w.__SCRIPT_RETRY_TIMING.backoffMs = 0;
	w.__SCRIPT_RETRY_TIMING.uiCheckMs = 0;
	return { dom, w };
}

/* the click path is fire-and-forget: poll until the row says it is done */
async function waitFor(w, predicate, timeoutMs = 6000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		let value = false;
		try {
			value = !!predicate();
		}
		catch (waitError) {
			value = false;
		}
		if (value) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return false;
}

const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

function mediaBatchEvents(body) {
	const scenes = Array.isArray(body.sceneIndexes)
		? body.sceneIndexes.map((value) => Number(value))
		: body.prompts.map((_, index) => index);
	const clipSlots = [1, 4, 7, 10];
	const events = [{ type: "start", count: body.prompts.length, width: 1024, height: 576 }];
	body.prompts.forEach((_, index) => {
		const scene = Number.isInteger(scenes[index]) ? scenes[index] : index;
		const clip = clipSlots.indexOf(scene) !== -1;
		events.push({
			type: "image", index, ok: true,
			mime: clip ? "video/mp4" : "image/png",
			data: pngBase64,
			source: { id: "media-" + scene, type: clip ? "video" : "image" }
		});
	});
	events.push({ type: "done", generated: body.prompts.length, failed: 0 });
	return events;
}

function jsonResponse(data, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => "application/json" },
		json: async () => data,
		blob: async () => new Blob([JSON.stringify(data)]),
		body: null
	};
}

/* Voiceover + one prompt call + one NDJSON batch, per row. */
function mockBatchRoutes(w, calls, options = {}) {
	w.fetch = async (url, opts = {}) => {
		const path = String(url);
		const method = String(opts.method || "GET").toUpperCase();
		calls.push({ path, method, body: opts.body || null });

		if (path === "/api/session") return jsonResponse({ success: true, authenticated: true, user: { username: "T", usertype: "free" }, remaining: {} });
		if (path === "/api/credits") return jsonResponse({ success: true, plan: { id: "free", label: "Free", limits: { images: 50 } }, remaining: { images: 20 } });
		if (path === "/api/voiceover") {
			if (options.failVoiceover) return jsonResponse({ success: false, error: "MeloTTS is busy" }, 503);
			return {
				ok: true,
				status: 200,
				headers: { get: () => "audio/mpeg" },
				blob: async () => new w.Blob([new Uint8Array([255, 243, 1, 2, 3, 4])], { type: "audio/mpeg" })
			};
		}
		if (path === "/api/image-prompts" && method === "POST") {
			const batch = JSON.parse(opts.body).batch || { count: 2, offset: 0 };
			const count = Math.min(batch.count, options.promptCount === undefined ? 3 : options.promptCount);
			return jsonResponse({
				success: true,
				prompts: Array.from({ length: count }, (_, i) => "Lead paragraph about scene " + (batch.offset + i + 1) + ".\n\nMiddle paragraph about scene " + (batch.offset + i + 1) + ".\n\nClosing paragraph about scene " + (batch.offset + i + 1) + "."),
				count,
				expectedCount: count,
				style: "Neon Night"
			});
		}
		if (path === "/api/image-batch" && method === "POST") {
			const body = JSON.parse(opts.body);
			const events = mediaBatchEvents(body);
			return {
				ok: true,
				status: 200,
				headers: { get: () => "application/x-ndjson" },
				body: new ReadableStream({
					start(controller) {
						const encoder = new TextEncoder();
						for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
						controller.close();
					}
				})
			};
		}
		return jsonResponse({ success: false, error: "Unexpected mock request: " + method + " " + path }, 404);
	};
}

test("the client carries no subtitle format at all", () => {
	assert.doesNotThrow(() => new vm.Script(APP_JS));

	for (const gone of [
		"downloadSrt",
		"parseSrtCues",
		"spokenScriptFromSrt",
		"srtTimeToMs",
		"data.srt",
		"project.srt",
		"va-script-dl-",
		"Script (SRT)",
		"Download .srt"
	]) {
		assert.ok(!APP_JS.includes(gone), gone + " must be gone from the client");
	}

	/* the script box holds plain narration and the voice reads it verbatim */
	assert.ok(APP_JS.includes("project.script"));
	assert.ok(APP_JS.includes('box.textContent = script;'));
	assert.ok(APP_JS.includes("String(project.script || \"\").trim();"));

	/* the worker-side SRT stays where it belongs: validation only */
	const plain = plainScriptFromSrt("1\n00:00:00,000 --> 00:00:04,000\nHello there.\n\n2\n00:00:04,000 --> 00:00:08,000\nKeep the breath steady.");
	assert.equal(plain, "Hello there. Keep the breath steady.");
});

test("a failed script is silently retried seven times and never reports an error", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockBatchRoutes(w, calls);
	await new Promise((resolve) => setTimeout(resolve, 0));

	w.addVideoAccordion();
	w.document.getElementById("va-script-topic-1").value = "Morning yoga";

	/* /api/script is not mocked here, so the request fails. */
	const ok = await w.runSeoScriptRequest(1, "Morning yoga", 1, "medium");
	assert.equal(ok, false);

	/* The browser owns the ladder: one initial write plus seven silent retries. */
	const scripted = calls.filter((call) => call.path === "/api/script");
	assert.equal(scripted.length, 8, "one initial write plus seven retries");

	const status = w.document.getElementById("va-script-status-1").textContent;
	assert.match(status, /Writing your SEO script/);
	assert.doesNotMatch(status, /Script failed|retry|attempt|error/i, "no retry or failure wording reaches the UI");
	const box = w.document.getElementById("va-script-box-1");
	assert.equal(box.classList.contains("va-script-loading"), true);
	assert.notEqual(box.style.display, "none");
	assert.ok(box.querySelector(".va-spinner"), "the loading animation remains continuously");
});

test("the script window tells the user they can walk away, and one modal per video stacks", () => {
	assert.ok(APP_JS.includes("You can close this window while you wait for the SEO script."));
	assert.ok(APP_JS.includes("you can close this window, nothing is cancelled."));
	assert.ok(APP_JS.includes("MODAL_BASE_Z_INDEX"));
	assert.ok(APP_JS.includes("modalStack"));
	assert.ok(APP_JS.includes("data-await-choice"));
	assert.ok(APP_JS.includes("function closeSeoWalkthroughTop()"));
	assert.ok(APP_JS.includes("seoWalkthroughModalId"));
	assert.ok(APP_JS.includes("voiceover-modal-"));
	/* the shared single ids are gone: each video owns its window */
	assert.ok(!APP_JS.includes('"seo-walkthrough-modal"'));
	assert.ok(!APP_JS.includes('modal.id =\n\t\t\t\t"voiceover-modal";'));
	assert.ok(APP_CSS.includes('[id^="seo-wt-style-select"]'));
});

test("every scene prompt is a three-paragraph art direction", () => {
	const instruction = buildImagePromptInstruction({ topic: "Morning yoga", minutes: 1, style: "Neon Night", script: script });
	assert.match(instruction, /QUALITY \/ STYLE GUARD - LENGTH/);
	assert.match(instruction, new RegExp("at least " + IMAGE_PROMPT_MIN_PARAGRAPHS + " paragraphs long, separated by a blank line"));
	assert.match(instruction, /Paragraph 1 = the subject and its action/);
	assert.match(instruction, /Paragraph 2 = the setting, atmosphere/);
	assert.match(instruction, /Paragraph 3 = camera and lens/);
	assert.match(instruction, /a prompt of one or two short sentences is rejected/);
	assert.match(instruction, /one three-paragraph string per scene/);

	/* a one-line answer is padded up by the guard, never shipped thin */
	const thin = "A sunrise over a home yoga mat.";
	const styled = applyImageStyleToPrompts([thin], "Neon Night");
	assert.equal(styled.length, 1);
	assert.ok(countPromptParagraphs(styled[0]) >= IMAGE_PROMPT_MIN_PARAGRAPHS, "a thin prompt is padded to three paragraphs");
	assert.ok(splitPromptParagraphs(styled[0]).every((paragraph) => paragraph.trim().length > 0));
	assert.ok(styled[0].length <= IMAGE_PROMPT_MAX_CHARS);
	assert.match(styled[0], /Visual style: Neon Night/);
	assert.ok(styled[0].startsWith(thin), "what the model wrote stays as paragraph 1");

	/* a full prompt is left alone: only the style line is appended */
	const full = [
		"Detail one " + "word ".repeat(34).trim(),
		"Detail two " + "word ".repeat(34).trim(),
		"Detail three " + "word ".repeat(34).trim()
	].join("\n\n");
	const kept = applyImageStyleToPrompts([full], "Minimalist");
	assert.equal(splitPromptParagraphs(kept[0])[0], splitPromptParagraphs(full)[0]);
	assert.equal(countPromptParagraphs(kept[0]), IMAGE_PROMPT_MIN_PARAGRAPHS + 1);
});

test("the table is an editable quick-batch grid with a Generate at its top right", () => {
	const html = createHTML();
	assert.match(html, /<section id="view-table"[\s\S]*?<\/section>/);
	const table = html.match(/<section id="view-table"[\s\S]*?<\/section>/)[0];

	for (const column of ["Script", "Video style", "Resolution", "Orientation", "Actions"]) {
		assert.ok(table.includes(">" + column + "<"), column + " is a table column");
	}

	/* Session 331 follow-up: the typed minute column is gone from the table. */
	assert.equal(table.includes(">Min<"), false, "the Min column header is removed");
	assert.equal(table.includes("batch-col-min"), false, "its header class is removed");
	assert.equal(table.includes("batch-minutes-input"), false, "its input is not rendered in the markup");

	/* the Generate button belongs to the table header, not the page */
	assert.ok(table.includes('id="batch-generate"'));
	assert.ok(table.indexOf('id="batch-generate"') < table.indexOf("<tbody id=\"batch-rows\">"));

	/*
	 * Session 332: the same three icons are drawn for every row from the first
	 * paint; a row that is not finished yet keeps them disabled and its cell
	 * prints no words. The old "Preview Here"/"Export Video" sentence and its
	 * styling are gone.
	 */
	assert.equal(APP_JS.includes('"Preview Here"'), false, "no Preview Here sentence is left in the source");
	assert.equal(APP_JS.includes('"Export Video"'), false, "no Export Video sentence either");
	assert.ok(APP_JS.includes('const locked = ready ? "" : \' disabled aria-disabled="true"\';'), "unfinished rows render the same three icons, disabled");
	assert.equal(/\.batch-pending\s*\{/.test(APP_CSS), false, "the pending sentence styling went with the sentence");

	/* Preview / Export come from ONE renderer and ONE flag: together, or not at all */
	const actionCells = APP_JS.match(/batchActionCell\(row, "(preview|export|edit)"\)/g) || [];
	assert.ok(actionCells.length >= 3, "Preview, Process Export and Edit share one renderer");
	assert.match(APP_JS, /AUTO_MEDIA_TOTAL = 12/);

	/* the style column reuses the script modal's fixed list of ten styles */
	assert.ok(APP_JS.includes("batchStyleOptionsHTML"));
	assert.ok(APP_JS.includes("SEO_IMAGE_STYLES"));
	assert.equal(IMAGE_STYLES.length, 10);

	/* rows are independent of the accordion state, on purpose */
	assert.ok(APP_JS.includes("Rows are deliberately independent of the"));
});

test("one Generate runs every row that has a script and unlocks both cells together", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockBatchRoutes(w, calls);
	await new Promise((resolve) => setTimeout(resolve, 0));

	/* the page seeds one blank row: start from a known table */
	while (w.__BATCH_ROWS.length) {
		w.removeBatchRow(w.__BATCH_ROWS[0].id);
	}

	const filled = w.addBatchRow({ script: script, minutes: 2, style: "Neon Night" });
	const blank = w.addBatchRow();
	const whitespace = w.addBatchRow({ script: "   " });

	w.document.getElementById("batch-generate").click();
	await waitFor(w, () => w.batchRowFinished(w.getBatchRow(filled.id)));

	/* Only the filled row ran: one voiceover and four progressive batches for 12 scenes. */
	assert.equal(calls.filter((call) => call.path === "/api/voiceover").length, 1);
	assert.equal(calls.filter((call) => call.path === "/api/image-prompts").length, 4);
	assert.equal(calls.filter((call) => call.path === "/api/image-batch").length, 4);

	const voice = JSON.parse(calls.find((call) => call.path === "/api/voiceover").body);
	assert.equal(voice.text, script, "the voice reads the row script verbatim");
	assert.doesNotMatch(voice.text, /-->|\d{2}:\d{2}:\d{2}/);

	const prompt = JSON.parse(calls.find((call) => call.path === "/api/image-prompts").body);
	assert.equal(prompt.style, "Neon Night");
	assert.equal(prompt.minutes, 2);
	assert.equal(prompt.script, script);

	const batch = JSON.parse(calls.find((call) => call.path === "/api/image-batch").body);
	assert.equal(batch.prompts.length, 3);

	/* the finished row: both cells are live buttons */
	const row = w.getBatchRow(filled.id);
	assert.ok(row.mp3, "the row has its MP3");
	assert.equal(row.slides.length, 12, "the row has its animation");
	assert.ok(w.batchRowFinished(row));
	const ready = w.document.querySelector('[data-batch-row="' + row.id + '"]');
	assert.equal(ready.querySelectorAll('[data-batch-action="preview"]').length, 1);
	assert.equal(ready.querySelectorAll('[data-batch-action="export"]').length, 1);
	assert.equal(ready.querySelectorAll('[data-batch-action="edit"]').length, 1);

	/*
	 * The empty rows were never generated: all three icons are already there,
	 * every one of them disabled, and the cell prints no words (Session 332).
	 * Nothing about them was requested.
	 */
	for (const idleRow of [blank, whitespace]) {
		const idle = w.document.querySelector('[data-batch-row="' + idleRow.id + '"]');
		assert.ok(idle, "row " + idleRow.id + " is still in the table");
		assert.equal(idle.querySelectorAll("button[data-batch-action]").length, 4, "remove, plus Preview, Process export and Edit");
		const actions = idle.querySelector('[data-batch-slot="actions"]');
		assert.deepEqual(
			Array.from(actions.querySelectorAll("[data-batch-action]"), (button) => button.dataset.batchAction),
			["preview", "export", "edit"],
			"the three icons are present before the row is ready"
		);
		assert.ok(
			Array.from(actions.querySelectorAll("[data-batch-action]")).every((button) => button.disabled && button.getAttribute("aria-disabled") === "true"),
			"and every one of them is disabled while the row is not ready"
		);
		assert.equal(/[A-Za-z]{2,}/.test(actions.textContent), false, "the cell holds no words - only the three icons");
	}

	/* defaults: an unwritten style / length never reach the request */
	assert.equal(w.getBatchRow(blank.id).minutes, 1);
	assert.equal(w.getBatchRow(blank.id).style, "Cinematic Film");

	/* the toolbar counts Ready rows, not merely rows with a script */
	assert.equal(w.document.getElementById("batch-generate").disabled, true);
	assert.match(w.document.getElementById("batch-note").textContent, /3 rows . 1 with a script . 0 ready/);
});

/*
 * Session #244 changed this contract: a failing step is retried inside the
 * row and NOTHING about the failure is shown. The row keeps its cells as
 * text (no dead buttons) and goes back to Ready, so the next Generate
 * simply tries it again. tests/session-244.test.mjs guards the silent
 * retry loop itself.
 */
test("a row that keeps failing stays quiet and keeps its action icons locked", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	/*
	 * Session 332: the editor layout now opens with its own Video 1 accordion, so
	 * the honest baseline for "the table never touched the accordion state" is the
	 * count the page booted with, not zero.
	 */
	const accordionsOnBoot = w.document.querySelectorAll("#video-accordions > .video-accordion").length;
	w.__BATCH_RETRY.attempts = 2;
	w.__BATCH_RETRY.baseMs = 1;
	w.__BATCH_RETRY.maxMs = 2;
	mockBatchRoutes(w, calls, { failVoiceover: true });
	await new Promise((resolve) => setTimeout(resolve, 0));

	while (w.__BATCH_ROWS.length) {
		w.removeBatchRow(w.__BATCH_ROWS[0].id);
	}

	const added = w.addBatchRow({ script: script });
	await w.runBatchRow(added);

	const row = w.getBatchRow(added.id);
	assert.equal(row.stage, "ready");
	assert.equal(row.error, "");
	assert.equal(w.batchRowFinished(row), false);
	const status = w.document.querySelector('[data-batch-row="' + added.id + '"] [data-batch-slot="status"]');
	assert.doesNotMatch(status.textContent, /MeloTTS|failed|error|\u26a0/i);
	assert.equal(status.getAttribute("data-loading"), "0");
	/* every attempt was a quiet retry, never a visible error */
	assert.equal(calls.filter((call) => call.path === "/api/voiceover").length, 2);
	/*
	 * A failed row is not ready, so its icons stay locked: drawn (one per row)
	 * but disabled, with nothing in the cell inviting a press (Session 332).
	 */
	const failedPreviewIcons = Array.from(w.document.querySelectorAll('[data-batch-action="preview"]'));
	assert.equal(failedPreviewIcons.length, w.__BATCH_ROWS.length, "every row still draws its Preview icon");
	assert.ok(failedPreviewIcons.every((button) => button.disabled), "and none of them is clickable");
	assert.equal(
		Array.from(w.document.querySelectorAll('[data-batch-slot="actions"]')).some((cell) => /[A-Za-z]{2,}/.test(cell.textContent)),
		false,
		"no Actions cell prints a word"
	);
	/* and the table never touched the accordion state */
	assert.equal(w.document.querySelectorAll("#video-accordions > .video-accordion").length, accordionsOnBoot, "the failed row created no editor accordion");
});

test("export is a client-side job: no render endpoint is ever called", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockBatchRoutes(w, calls);
	await new Promise((resolve) => setTimeout(resolve, 0));

	while (w.__BATCH_ROWS.length) {
		w.removeBatchRow(w.__BATCH_ROWS[0].id);
	}

	const added = w.addBatchRow({ script: script });
	await w.generateBatchRows();

	calls.length = 0;
	assert.ok(w.batchRowFinished(w.getBatchRow(added.id)));

	/* Export is the local renderer, borrowed for one row: no video job. */
	const body = APP_JS.slice(
		APP_JS.indexOf("async function exportBatchRow("),
		APP_JS.indexOf("function downloadBatchBlob(")
	);
	assert.ok(body.length > 400, "exportBatchRow exists");
	assert.ok(body.includes("await generateMP4()"));
	assert.ok(body.includes("window.__lastRenderBlob"));
	assert.ok(!body.includes("fetch("), "the export path never calls the network");
	assert.equal(calls.filter((call) => call.path === "/api/render").length, 0);
});

/*
 * ---------------------------------------------------------------------------
 * Session #211 — the four table/lock corrections.
 * ---------------------------------------------------------------------------
 */

/* A fetch mock whose voiceover call blocks, so overlap can be measured. */
function mockSlowRoutes(w, calls, state, options = {}) {
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	w.fetch = async (url, opts = {}) => {
		const path = String(url);
		const method = String(opts.method || "GET").toUpperCase();
		calls.push({ path, method, body: opts.body || null });

		if (path === "/api/session") return jsonResponse({ success: true, authenticated: true, user: { username: "T", usertype: "free" }, remaining: {} });
		if (path === "/api/credits") return jsonResponse({ success: true, plan: { id: "free", label: "Free", limits: { images: 50 } }, remaining: { images: 20 } });

		if (path === "/api/voiceover") {
			state.inFlight += 1;
			state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
			await delay(options.voiceDelay === undefined ? 40 : options.voiceDelay);
			state.inFlight -= 1;
			return {
				ok: true,
				status: 200,
				headers: { get: () => "audio/mpeg" },
				blob: async () => new w.Blob([new Uint8Array([255, 243, 1, 2, 3, 4])], { type: "audio/mpeg" })
			};
		}

		if (path === "/api/image-prompts" && method === "POST") {
			const batch = JSON.parse(opts.body).batch || { count: 3, offset: 0 };
			const count = Math.min(batch.count, 3);
			return jsonResponse({
				success: true,
				prompts: Array.from({ length: count }, (_, i) => "Scene " + (batch.offset + i + 1) + " lead.\n\nMiddle.\n\nClose."),
				count, expectedCount: count, style: "Neon Night"
			});
		}

		if (path === "/api/image-batch" && method === "POST") {
			const body = JSON.parse(opts.body);
			const events = mediaBatchEvents(body);
			return {
				ok: true,
				status: 200,
				headers: { get: () => "application/x-ndjson" },
				body: new ReadableStream({
					start(controller) {
						const encoder = new TextEncoder();
						for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
						controller.close();
					}
				})
			};
		}

		return jsonResponse({ success: false, error: "Unexpected mock request: " + method + " " + path }, 404);
	};
}

test("three rows render at the same time, and a finished row is never generated twice", async () => {
	const calls = [];
	const state = { inFlight: 0, maxInFlight: 0 };
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockSlowRoutes(w, calls, state);
	await new Promise((resolve) => setTimeout(resolve, 0));

	while (w.__BATCH_ROWS.length) {
		w.removeBatchRow(w.__BATCH_ROWS[0].id);
	}

	const rows = [];
	for (let index = 1; index <= 5; index++) {
		rows.push(w.addBatchRow({ script: "Row " + index + " narration. " + script }));
	}

	w.document.getElementById("batch-generate").click();
	const allDone = await waitFor(w, () => rows.every((row) => w.batchRowFinished(w.getBatchRow(row.id))), 15000);
	assert.ok(allDone, "every row finished");

	/* Session #211: the lanes are three deep, never one. */
	assert.equal(state.maxInFlight, 3, "three voiceovers were in flight at once");
	assert.equal(calls.filter((call) => call.path === "/api/voiceover").length, 5);

	const voiceCalls = calls.filter((call) => call.path === "/api/voiceover").length;

	/* Finished rows are not Ready, so Generate is disabled and cannot re-bill them. */
	assert.equal(w.document.getElementById("batch-generate").disabled, true);
	assert.match(w.document.getElementById("batch-note").textContent, /0 ready/);
	w.document.getElementById("batch-generate").click();
	await new Promise((resolve) => setTimeout(resolve, 120));
	assert.equal(calls.filter((call) => call.path === "/api/voiceover").length, voiceCalls, "no finished row was generated again");

	/* ...and every finished row still offers both live buttons. */
	for (const row of rows) {
		const tr = w.document.querySelector('[data-batch-row="' + row.id + '"]');
		assert.equal(tr.querySelectorAll('[data-batch-action="preview"]').length, 1);
		assert.equal(tr.querySelectorAll('[data-batch-action="export"]').length, 1);
		assert.equal(tr.querySelectorAll('[data-batch-action="edit"]').length, 1);
	}
});

test("the resolution and orientation columns travel with both image calls", async () => {
	const calls = [];
	const state = { inFlight: 0, maxInFlight: 0 };
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockSlowRoutes(w, calls, state);
	await new Promise((resolve) => setTimeout(resolve, 0));

	while (w.__BATCH_ROWS.length) {
		w.removeBatchRow(w.__BATCH_ROWS[0].id);
	}

	/* The columns exist, with the four sizes and the three orientations. */
	const html = createHTML();
	for (const column of ["Resolution", "Orientation"]) {
		assert.ok(html.includes(">" + column + "<"), column + " is a table column");
	}

	const row = w.addBatchRow({ script: script, style: "Neon Night", resolution: 720, orientation: "portrait" });
	assert.equal(row.resolution, 720);
	assert.equal(row.orientation, "portrait");

	const selects = w.document.querySelectorAll('[data-batch-row="' + row.id + '"] select');
	assert.equal(selects.length, 3, "style + resolution + orientation");
	const resolutionSelect = w.document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-field="resolution"]');
	for (const size of ["480", "540", "720", "1024"]) {
		assert.ok(resolutionSelect.innerHTML.includes('value="' + size + '"'), size + " is offered");
	}

	await w.generateBatchRows();
	assert.ok(w.batchRowFinished(w.getBatchRow(row.id)));

	const prompts = JSON.parse(calls.find((call) => call.path === "/api/image-prompts").body);
	assert.equal(prompts.resolution, 720);
	assert.equal(prompts.orientation, "portrait");

	const batch = JSON.parse(calls.find((call) => call.path === "/api/image-batch").body);
	assert.equal(batch.resolution, 720);
	assert.equal(batch.orientation, "portrait");

	/* The client's frame maths matches the worker's: long edge 720, 9:16. */
	const frame = w.batchRowDimensions({ resolution: 720, orientation: "portrait" });
	assert.equal(frame.width, 408);
	assert.equal(frame.height, 720);
	assert.equal(w.batchRowDimensions({ resolution: 720, orientation: "landscape" }).width, 720);
	assert.equal(w.batchRowDimensions({ resolution: 480, orientation: "square" }).height, 480);

	/* A change in the select writes back to the row and the pixel hint. */
	resolutionSelect.value = "480";
	resolutionSelect.dispatchEvent(new w.Event("change", { bubbles: true }));
	assert.equal(w.getBatchRow(row.id).resolution, 480);
});

test("the worker validates the frame and writes it into every scene prompt", async () => {
	const { imageFrameFor, sanitizeImageFrame, IMAGE_RESOLUTIONS, IMAGE_ORIENTATIONS } = await import("../src/modules/image-batch.ts");

	assert.deepEqual([...IMAGE_RESOLUTIONS], [480, 540, 720, 1024]);
	assert.deepEqual([...IMAGE_ORIENTATIONS], ["square", "landscape", "portrait"]);

	/* Defaults: the historical 1024x576 landscape frame. */
	assert.deepEqual(imageFrameFor(undefined, undefined), { resolution: 1024, orientation: "landscape", width: 1024, height: 576 });
	assert.deepEqual(imageFrameFor(720, "portrait"), { resolution: 720, orientation: "portrait", width: 408, height: 720 });
	assert.deepEqual(imageFrameFor(480, "square"), { resolution: 480, orientation: "square", width: 480, height: 480 });
	/* 540 is not a multiple of 8, so the long edge lands on 544 (the hint says so). */
	assert.deepEqual(imageFrameFor("540px", "landscape"), { resolution: 540, orientation: "landscape", width: 544, height: 304 });

	/* Present but invalid = rejected, so a typo cannot silently resize. */
	assert.ok(sanitizeImageFrame({ resolution: 999 }).error);
	assert.ok(sanitizeImageFrame({ orientation: "diagonal" }).error);
	assert.equal(sanitizeImageFrame({ orientation: "portrait" }).orientation, "portrait");

	const instruction = buildImagePromptInstruction({ topic: "Morning yoga", minutes: 1, style: "Neon Night", script, resolution: 720, orientation: "portrait" });
	assert.match(instruction, /FRAME: every image is rendered as a PORTRAIT frame at 408x720 px \(720 px long edge\)/);
	assert.match(instruction, /Compose vertically/);

	const landscape = buildImagePromptInstruction({ topic: "Morning yoga", minutes: 1, style: "Neon Night", script });
	assert.match(landscape, /LANDSCAPE frame at 1024x576 px/);
	assert.match(landscape, /Compose wide/);
});

test("the accordion's own script controls are locked only while its own walkthrough renders", async () => {
	const calls = [];
	const state = { inFlight: 0, maxInFlight: 0 };
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockSlowRoutes(w, calls, state);
	await new Promise((resolve) => setTimeout(resolve, 0));

	w.addVideoAccordion();
	w.addVideoAccordion();

	const first = w.__VIDEO_PROJECTS[0];
	first.script = script;
	first._seoTopic = "Morning yoga";
	first._seoMinutes = 1;
	first._seoSpeed = "medium";
	first._imageFlowActive = true;

	const flow = w.startImagePromptFlow(1);

	/* Synchronously locked for video 1 only. */
	assert.equal(w.document.getElementById("va-script-btn-1").disabled, true, "video 1 is locked");
	assert.equal(w.document.getElementById("va-script-btn-2").disabled, false, "video 2 may still generate");

	/* A programmatic retry is refused while the flow owns the gallery. */
	await w.retryImagePromptFlow(1);
	assert.match(w.document.getElementById("va-ai-status-1").textContent, /Planning Pixabay|Searching Pixabay|Pixabay/i);

	await flow;
	assert.equal(w.document.getElementById("va-script-btn-1").disabled, false, "video 1 unlocks when the flow ends");
	assert.equal(w.document.getElementById("va-script-btn-2").disabled, false, "video 2 was never touched");
});

test("Quick Batch renders its first chunk before the next prompt batch finishes", async (t) => {
	const calls = [];
	const { dom, w } = makeApp();
	t.after(() => dom.window.close());
	mockBatchRoutes(w, calls);
	const baseFetch = w.fetch;
	let release;
	const gate = new Promise((resolve) => { release = resolve; });
	let lookahead = false;
	w.fetch = async (url, init = {}) => {
		if (url === "/api/image-prompts" && JSON.parse(init.body).batch.offset === 3) {
			lookahead = true;
			await gate;
		}
		return baseFetch(url, init);
	};
	await new Promise((resolve) => setTimeout(resolve, 0));
	const row = w.addBatchRow({ script, minutes: 1 });
	const run = w.runBatchRow(row);
	assert.equal(await waitFor(w, () => row.images.length === 3), true);
	assert.equal(lookahead, true);
	assert.equal(w.batchRowFinished(row), false);
	release();
	await run;
	assert.equal(row.images.length, 12);
	assert.deepEqual(Array.from(row.images, (image) => image.index), Array.from({ length: 12 }, (_, i) => i));
	assert.equal(w.batchRowFinished(row), true);
});

test("Quick Batch Stop aborts both the image stream and concurrent prompt request", async (t) => {
	const calls = [];
	const { dom, w } = makeApp();
	t.after(() => dom.window.close());
	mockBatchRoutes(w, calls);
	const baseFetch = w.fetch;
	let promptAborted = false, imageAborted = false, promptStarted = false, imageStarted = false;
	w.fetch = async (url, init = {}) => {
		const prompt = url === "/api/image-prompts" && JSON.parse(init.body).batch.offset === 3;
		if (prompt || url === "/api/image-batch") {
			if (prompt) promptStarted = true; else imageStarted = true;
			return new Promise((_, reject) => {
				init.signal.addEventListener("abort", () => {
					if (prompt) promptAborted = true; else imageAborted = true;
					reject(Object.assign(new Error("signal is aborted without reason"), { name: "AbortError" }));
				}, { once: true });
			});
		}
		return baseFetch(url, init);
	};
	await new Promise((resolve) => setTimeout(resolve, 0));
	const row = w.addBatchRow({ script, minutes: 1 });
	const run = w.runBatchRow(row);
	assert.equal(await waitFor(w, () => promptStarted && imageStarted), true);
	w.stopBatchRows();
	await run;
	assert.equal(promptAborted, true);
	assert.equal(imageAborted, true);
	assert.equal(w.batchRowFinished(row), false);
});
