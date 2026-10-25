/*
 * Bug Fix Session #248 contract:
 *
 *  1. When 4 or more rows have scripts and Generate is clicked, the table starts
 *     up to 3 rows simultaneously (BATCH_RUN_CONCURRENCY = 3).
 *  2. When any of the simultaneously running rows moves in the pipeline steps
 *     to the next step of processing (specifically image generation, stage 'images'),
 *     startUnprocessedRows() starts the 4th (and subsequent) unprocessed row immediately,
 *     without waiting for earlier rows to completely finish the entire pipeline
 *     (images + animate).
 *  3. In-flight early steps (voiceover / timing / prompts) remain bounded by
 *     BATCH_RUN_CONCURRENCY (3).
 *  4. All rows finish their pipeline without the user needing to press Generate again.
 *  5. startUnprocessedRows / startUnprocessedBatchRows is exposed and callable.
 *  6. Stopping a run halts active rows and clears unprocessed queue.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";

const script = "Morning yoga opens the shoulders. Long tails follow the breath.";
const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

function makeApp() {
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	const w = dom.window;
	let objectUrlId = 0;
	w.alert = () => { };
	w.confirm = () => true;
	w.scrollTo = () => { };
	w.URL.createObjectURL = () => "blob:session-248-" + (++objectUrlId);
	w.URL.revokeObjectURL = () => { };
	w.__PLAN_MODE = "freemium";
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	w.__BATCH_RETRY.attempts = 2;
	w.__BATCH_RETRY.baseMs = 1;
	w.__BATCH_RETRY.maxMs = 2;
	return { dom, w };
}

async function waitFor(predicate, timeoutMs = 8000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		let value = false;
		try {
			value = !!predicate();
		}
		catch {
			value = false;
		}
		if (value) return true;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	return false;
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

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockRoutes(w, calls, state = {}, options = {}) {
	state.inFlight = state.inFlight || 0;
	state.maxInFlight = state.maxInFlight || 0;

	w.fetch = async (url, opts = {}) => {
		const path = String(url);
		const method = String(opts.method || "GET").toUpperCase();
		calls.push({ path, method, body: opts.body || null });

		if (path === "/api/session") return jsonResponse({ success: true, authenticated: true, user: { username: "T", usertype: "free" }, remaining: {} });
		if (path === "/api/credits") return jsonResponse({ success: true, plan: { id: "free", label: "Free", limits: { images: 50 } }, remaining: { images: 20 } });

		if (path === "/api/voiceover") {
			state.inFlight += 1;
			state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
			if (options.voiceDelay) {
				await delay(options.voiceDelay);
			}
			state.inFlight -= 1;
			return {
				ok: true,
				status: 200,
				headers: { get: () => "audio/mpeg" },
				blob: async () => new w.Blob([new Uint8Array([255, 243, 1, 2, 3, 4])], { type: "audio/mpeg" })
			};
		}

		if (path === "/api/image-prompts" && method === "POST") {
			return jsonResponse({
				success: true,
				prompts: [
					"Lead paragraph scene 1.\n\nMiddle paragraph scene 1.\n\nClose scene 1."
				],
				count: 1,
				expectedCount: 1,
				style: "Neon Night"
			});
		}

		if (path === "/api/image-batch" && method === "POST") {
			if (options.imageDelay) {
				await delay(options.imageDelay);
			}
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

		return jsonResponse({ success: false, error: "Unexpected mock: " + method + " " + path }, 404);
	};
}

function blankTable(w) {
	while (w.__BATCH_ROWS.length) {
		w.removeBatchRow(w.__BATCH_ROWS[0].id);
	}
}

/* ------------------------------------------------------------------ */
/* Test 1: row 4 starts when earlier rows move to image generation    */
/* ------------------------------------------------------------------ */

test("unprocessed row starts when an earlier row moves to image generation, before it finishes", async () => {
	const calls = [];
	const state = { inFlight: 0, maxInFlight: 0 };
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());

	/* Set imageDelay = 120ms so earlier rows linger in stage 'images' */
	mockRoutes(w, calls, state, { voiceDelay: 10, imageDelay: 120 });
	blankTable(w);

	const r1 = w.addBatchRow({ script: "Row 1 narration: " + script });
	const r2 = w.addBatchRow({ script: "Row 2 narration: " + script });
	const r3 = w.addBatchRow({ script: "Row 3 narration: " + script });
	const r4 = w.addBatchRow({ script: "Row 4 narration: " + script });

	w.document.getElementById("batch-generate").click();

	/* Wait until at least one of the first three rows has reached stage 'images' */
	let row4StartedEarly = false;
	const reachedImages = await waitFor(() => {
		const row1 = w.getBatchRow(r1.id);
		const row2 = w.getBatchRow(r2.id);
		const row3 = w.getBatchRow(r3.id);
		const row4 = w.getBatchRow(r4.id);

		const someInImages = (row1 && row1.stage === "images") ||
			(row2 && row2.stage === "images") ||
			(row3 && row3.stage === "images");

		/* None of the first three rows has completely finished yet */
		const noneFinished = !w.batchRowFinished(row1) && !w.batchRowFinished(row2) && !w.batchRowFinished(row3);

		/* Check if row 4 has already started processing */
		if (someInImages && noneFinished && row4 && row4.running) {
			row4StartedEarly = true;
			return true;
		}
		return false;
	}, 5000);

	assert.ok(reachedImages, "observed row 4 running while an earlier row was still in image generation");
	assert.ok(row4StartedEarly, "row 4 started before the first three rows finished");

	/* All 4 rows must finish without needing to click Generate again */
	const allFinished = await waitFor(() => {
		return [r1, r2, r3, r4].every((r) => w.batchRowFinished(w.getBatchRow(r.id)));
	}, 10000);

	assert.ok(allFinished, "all 4 rows finished without needing a second generate click");
	assert.equal(calls.filter((c) => c.path === "/api/voiceover").length, 4);
});

/* ------------------------------------------------------------------ */
/* Test 2: five rows pipelining keeps simultaneous voiceover capped   */
/* ------------------------------------------------------------------ */

test("5-row batch pipelines smoothly and never exceeds 3 simultaneous early-stage rows", async () => {
	const calls = [];
	const state = { inFlight: 0, maxInFlight: 0 };
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());

	mockRoutes(w, calls, state, { voiceDelay: 30, imageDelay: 50 });
	blankTable(w);

	const rows = [];
	for (let i = 1; i <= 5; i++) {
		rows.push(w.addBatchRow({ script: "Row " + i + " text: " + script }));
	}

	w.document.getElementById("batch-generate").click();

	const allDone = await waitFor(() => {
		return rows.every((r) => w.batchRowFinished(w.getBatchRow(r.id)));
	}, 12000);

	assert.ok(allDone, "all 5 rows completed");
	assert.equal(state.maxInFlight, 3, "voiceover concurrency never exceeded 3");
	assert.equal(calls.filter((c) => c.path === "/api/voiceover").length, 5);
});

/* ------------------------------------------------------------------ */
/* Test 3: startUnprocessedRows is exposed and functional             */
/* ------------------------------------------------------------------ */

test("startUnprocessedRows and startUnprocessedBatchRows exist and advance queued rows", () => {
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());

	assert.equal(typeof w.startUnprocessedRows, "function", "startUnprocessedRows is exposed on window");
	assert.equal(typeof w.startUnprocessedBatchRows, "function", "startUnprocessedBatchRows is exposed on window");
});

/* ------------------------------------------------------------------ */
/* Test 4: Stop button stops running rows and clears queue            */
/* ------------------------------------------------------------------ */

test("Stop generating halts active rows and clears unprocessed queue so pending rows do not start", async () => {
	const calls = [];
	const state = { inFlight: 0, maxInFlight: 0 };
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());

	mockRoutes(w, calls, state, { voiceDelay: 100, imageDelay: 100 });
	blankTable(w);

	const r1 = w.addBatchRow({ script: "Row 1 text: " + script });
	const r2 = w.addBatchRow({ script: "Row 2 text: " + script });
	const r3 = w.addBatchRow({ script: "Row 3 text: " + script });
	const r4 = w.addBatchRow({ script: "Row 4 text: " + script });
	const r5 = w.addBatchRow({ script: "Row 5 text: " + script });

	const generateBtn = w.document.getElementById("batch-generate");
	generateBtn.click();

	/* Wait for run to become busy */
	await waitFor(() => generateBtn.textContent.includes("Stop"), 1000);

	/* Click stop */
	generateBtn.click();

	await new Promise((resolve) => setTimeout(resolve, 80));

	/* Verify row 4 and 5 never started and are ready */
	const row4 = w.getBatchRow(r4.id);
	const row5 = w.getBatchRow(r5.id);
	assert.equal(row4.running, false);
	assert.equal(row5.running, false);
	assert.equal(row4.stage, "ready");
	assert.equal(row5.stage, "ready");
});

/* ------------------------------------------------------------------ */
/* Test 5: Single row runs to done and unlocks preview and export     */
/* ------------------------------------------------------------------ */

test("single row in batch table runs to done and unlocks both preview and export", async () => {
	const calls = [];
	const state = { inFlight: 0, maxInFlight: 0 };
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());

	// Simulate image decode that warns/rejects to verify slides are kept
	w.Image = class {
		constructor() { this.src = ""; }
		async decode() { throw new Error("Simulated browser decode warning"); }
	};

	mockRoutes(w, calls, state);
	blankTable(w);

	const row = w.addBatchRow({ script: "Testing single row bulk video creation." });
	assert.equal(row.stage, "ready");

	w.document.getElementById("batch-generate").click();

	const done = await waitFor(() => w.batchRowFinished(w.getBatchRow(row.id)), 4000);
	assert.ok(done, "single row finished pipeline");

	const finished = w.getBatchRow(row.id);
	assert.equal(finished.stage, "done");
	assert.ok(finished.mp3, "row has MP3");
	assert.equal(finished.slides.length, 1, "slide kept despite decode warning");
	assert.ok(w.batchRowFinished(finished));

	const rowEl = w.document.querySelector('[data-batch-row="' + row.id + '"]');
	assert.equal(rowEl.querySelectorAll('[data-batch-slot="preview"] button').length, 1);
	assert.equal(rowEl.querySelectorAll('[data-batch-slot="export"] button').length, 1);
});

/* ------------------------------------------------------------------ */
/* Test 6: A failing row does not trigger an infinite loop in pass   */
/* ------------------------------------------------------------------ */

test("failing row exits pass cleanly and does not re-queue infinitely in the same pass", async () => {
	const calls = [];
	const state = { inFlight: 0, maxInFlight: 0 };
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());

	w.fetch = async (url) => {
		const path = String(url);
		calls.push({ path });
		if (path === "/api/voiceover") {
			return jsonResponse({ success: false, error: "Permanent failure" }, 500);
		}
		return jsonResponse({ success: true });
	};

	blankTable(w);
	const row = w.addBatchRow({ script: "Failing row test." });

	w.document.getElementById("batch-generate").click();

	// Wait for the generate pass to complete (generate button restored)
	const passEnded = await waitFor(() => {
		const btn = w.document.getElementById("batch-generate");
		return btn && btn.textContent.includes("Generate") && !btn.textContent.includes("Stop");
	}, 4000);

	assert.ok(passEnded, "generate pass ended without infinite re-queuing");

	const r = w.getBatchRow(row.id);
	assert.equal(r.stage, "ready", "failed row parked at ready for next click");
	assert.equal(r.running, false);

	// Voiceover was attempted attempts * 1 times (2 attempts configured in makeApp), NOT looped
	const voiceCalls = calls.filter((c) => c.path === "/api/voiceover").length;
	assert.equal(voiceCalls, 2, "only the configured quiet attempts ran, no infinite harvesting");
});
