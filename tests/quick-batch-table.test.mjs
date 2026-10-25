/*
 * The eight requirements of the current session, guarded end to end:
 *
 *  1. the script is plain narration text - no subtitle format ever reaches
 *     the browser, so there is nothing for the voiceover model to misread;
 *  2. every scene prompt is a three-paragraph art direction (worker side);
 *  3-4. the script window tells the user they can walk away, and a failed
 *     script is retried twice by the browser before the accordion reports it;
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
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
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
			const count = options.promptCount === undefined ? 2 : options.promptCount;
			return jsonResponse({
				success: true,
				prompts: Array.from({ length: count }, (_, i) => "Lead paragraph about scene " + (i + 1) + ".\n\nMiddle paragraph about scene " + (i + 1) + ".\n\nClosing paragraph about scene " + (i + 1) + "."),
				count,
				expectedCount: count,
				style: "Neon Night"
			});
		}
		if (path === "/api/image-batch" && method === "POST") {
			const body = JSON.parse(opts.body);
			const events = [{ type: "start", count: body.prompts.length, width: 1024, height: 576 }];
			body.prompts.forEach((_, index) => events.push({ type: "image", index, ok: true, mime: "image/png", data: pngBase64 }));
			events.push({ type: "done", generated: body.prompts.length, failed: 0 });
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

test("a failed script is retried twice before the accordion reports it", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockBatchRoutes(w, calls);
	await new Promise((resolve) => setTimeout(resolve, 0));

	w.addVideoAccordion();
	w.document.getElementById("va-script-topic-1").value = "Morning yoga";

	/* /api/script is not mocked here, so every attempt fails. */
	const ok = await w.runSeoScriptRequest(1, "Morning yoga", 1, "medium");
	assert.equal(ok, false);

	const scripted = calls.filter((call) => call.path === "/api/script");
	assert.equal(scripted.length, 3, "one request plus two retries");

	const status = w.document.getElementById("va-script-status-1").textContent;
	assert.match(status, /Script failed after 3 attempts/);
	assert.ok(!/retrying \(3 of 2\)/.test(status));
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

	for (const column of ["Script", "Video style", "Min", "Preview", "Export"]) {
		assert.ok(table.includes(">" + column + "<"), column + " is a table column");
	}

	/* the Generate button belongs to the table header, not the page */
	assert.ok(table.includes('id="batch-generate"'));
	assert.ok(table.indexOf('id="batch-generate"') < table.indexOf("<tbody id=\"batch-rows\">"));

	/* the two action cells read as text before a row is finished */
	assert.ok(APP_JS.includes('"Preview Here"'));
	assert.ok(APP_JS.includes('"Export Video"'));
	assert.ok(APP_CSS.includes(".batch-pending"));

	/* Preview / Export come from ONE renderer and ONE flag: together, or not at all */
	const actionCells = APP_JS.match(/batchActionCell\(row, kind\)/g) || [];
	assert.ok(actionCells.length >= 2, "both cells share one renderer");
	assert.match(APP_JS, /row\.mp3 &&\s+row\.images\.length &&\s+row\.animated &&\s+row\.slides\.length/);

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

	/* only the filled row ran: 1 voiceover, 1 prompt call, 1 batch call */
	assert.equal(calls.filter((call) => call.path === "/api/voiceover").length, 1);
	assert.equal(calls.filter((call) => call.path === "/api/image-prompts").length, 1);
	assert.equal(calls.filter((call) => call.path === "/api/image-batch").length, 1);

	const voice = JSON.parse(calls.find((call) => call.path === "/api/voiceover").body);
	assert.equal(voice.text, script, "the voice reads the row script verbatim");
	assert.doesNotMatch(voice.text, /-->|\d{2}:\d{2}:\d{2}/);

	const prompt = JSON.parse(calls.find((call) => call.path === "/api/image-prompts").body);
	assert.equal(prompt.style, "Neon Night");
	assert.equal(prompt.minutes, 2);
	assert.equal(prompt.script, script);

	const batch = JSON.parse(calls.find((call) => call.path === "/api/image-batch").body);
	assert.equal(batch.prompts.length, 2);

	/* the finished row: both cells are live buttons */
	const row = w.getBatchRow(filled.id);
	assert.ok(row.mp3, "the row has its MP3");
	assert.equal(row.slides.length, 2, "the row has its animation");
	assert.ok(w.batchRowFinished(row));
	const ready = w.document.querySelector('[data-batch-row="' + row.id + '"]');
	assert.equal(ready.querySelectorAll('[data-batch-slot="preview"] button').length, 1);
	assert.equal(ready.querySelectorAll('[data-batch-slot="export"] button').length, 1);

	/* the empty rows stay text-only, and nothing about them was requested */
	for (const idleRow of [blank, whitespace]) {
		const idle = w.document.querySelector('[data-batch-row="' + idleRow.id + '"]');
		assert.ok(idle, "row " + idleRow.id + " is still in the table");
		assert.equal(idle.querySelectorAll("button[data-batch-action]").length, 1, "only the remove button");
		assert.match(idle.querySelector('[data-batch-slot="preview"]').textContent, /Preview Here/);
		assert.match(idle.querySelector('[data-batch-slot="export"]').textContent, /Export Video/);
	}

	/* defaults: an unwritten style / length never reach the request */
	assert.equal(w.getBatchRow(blank.id).minutes, 1);
	assert.equal(w.getBatchRow(blank.id).style, "Cinematic Film");

	/* the toolbar counts the rows that can run and is clickable again */
	assert.equal(w.document.getElementById("batch-generate").disabled, false);
	assert.match(w.document.getElementById("batch-note").textContent, /3 rows . 1 with a script/);
});

/*
 * Session #244 changed this contract: a failing step is retried inside the
 * row and NOTHING about the failure is shown. The row keeps its cells as
 * text (no dead buttons) and goes back to Ready, so the next Generate
 * simply tries it again. tests/session-244.test.mjs guards the silent
 * retry loop itself.
 */
test("a row that keeps failing stays quiet and keeps its cells as text", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
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
	/* a failed row keeps its cells as text: no dead buttons to press */
	assert.equal(w.document.querySelectorAll('[data-batch-slot="preview"] button').length, 0);
	/* and the table never touched the accordion state */
	assert.equal(w.document.querySelectorAll("#video-accordions > .video-accordion").length, 0);
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
			return jsonResponse({ success: true, prompts: ["Scene one lead.\n\nScene one middle.\n\nScene one close."], count: 1, expectedCount: 1, style: "Neon Night" });
		}

		if (path === "/api/image-batch" && method === "POST") {
			const body = JSON.parse(opts.body);
			const events = [{ type: "start", count: body.prompts.length, width: 1024, height: 576 }];
			body.prompts.forEach((_, index) => events.push({ type: "image", index, ok: true, mime: "image/png", data: pngBase64 }));
			events.push({ type: "done", generated: body.prompts.length, failed: 0 });
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

	/* Pressing Generate again must not re-bill a finished row. */
	w.document.getElementById("batch-generate").click();
	await new Promise((resolve) => setTimeout(resolve, 120));
	assert.equal(calls.filter((call) => call.path === "/api/voiceover").length, voiceCalls, "no finished row was generated again");
	assert.match(
		w.document.getElementById("required-modal-list").textContent,
		/already finished/
	);

	/* ...and every finished row still offers both live buttons. */
	for (const row of rows) {
		const tr = w.document.querySelector('[data-batch-row="' + row.id + '"]');
		assert.equal(tr.querySelectorAll('[data-batch-slot="preview"] button').length, 1);
		assert.equal(tr.querySelectorAll('[data-batch-slot="export"] button').length, 1);
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

test("the accordion's Generate AI Image button is locked only while its own walkthrough renders", async () => {
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
	assert.equal(w.document.getElementById("va-ai-btn-1").disabled, true, "video 1 is locked");
	assert.equal(w.document.getElementById("va-ai-btn-2").disabled, false, "video 2 may still generate");

	/* A programmatic submit is refused while the flow owns the gallery. */
	await w.submitAiImages(1);
	assert.match(w.document.getElementById("va-ai-status-1").textContent, /unlocks when it finishes/);

	await flow;
	assert.equal(w.document.getElementById("va-ai-btn-1").disabled, false, "video 1 unlocks when the flow ends");
	assert.equal(w.document.getElementById("va-ai-btn-2").disabled, false, "video 2 was never touched");
});
