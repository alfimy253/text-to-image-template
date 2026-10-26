/*
 * Bug fix #263 — "the video finished with 3 images" and "the image flow stops
 * instead of proceeding".
 *
 * Root causes (both in the browser half of the pipeline):
 *
 *   1. `runProgressiveImagePipeline()` asks for scene prompts in chunks of 3
 *      and renders each chunk with ONE request. That request had no retry at
 *      all: one transient 5xx/overload on the *second* chunk set the flow's stop
 *      reason, and `finalizeImagePromptFlow()` ended the row after the images of
 *      the first chunk — exactly 3 of 10.
 *   2. A prompt chunk that failed answered a blanket `502` with no hint, so the
 *      browser could not tell "wait a moment" from "this request is invalid".
 *      Its retries were 500 ms, 1000 ms — shorter than the wait the fleet was
 *      asking for — so the same failure ended the video.
 *
 * The contract pinned here:
 *
 *   1. `requestImageChunk()` retries ONLY the scenes that failed, keeps the
 *      original scene indices, never re-requests a delivered image, gives up
 *      after a bounded number of rounds, and never retries 4xx (except 429/408,
 *      which are load answers).
 *   2. A failing image chunk no longer ends the row: the delivered images are
 *      kept and the retried scenes are appended, so a 10-scene video finishes
 *      with 10 images.
 *   3. A prompt chunk overload answers 503 + `Retry-After` + `kind` +
 *      `retryAfterMs`, the browser waits that long, and the flow still finishes
 *      with every scene.
 *   4. Pacing is unchanged: 3 images per 3 s per row, 10,000 images/day.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import worker from "../src/index.ts";
import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
import { handleGenerateImagePrompts } from "../src/modules/image-prompts.ts";
import {
	IMAGE_BATCH_CONCURRENCY,
	IMAGE_BATCH_WAVE_INTERVAL_MS
} from "../src/modules/image-batch.ts";
import { IMAGE_DAILY_LIMIT } from "../src/index.ts";
import { sharedImageLoadGovernor } from "../src/modules/image-load.ts";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const mp3 = Uint8Array.from([255, 251, 144, 100, 1, 2]);

const json = (body, status = 200, headers = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: Object.assign({ "Content-Type": "application/json" }, headers)
	});
const image = () => new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function client() {
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	const w = dom.window;
	w.__PLAN_MODE = "freemium";
	w.alert = () => {};
	w.confirm = () => true;
	w.scrollTo = () => {};
	let id = 0;
	w.URL.createObjectURL = () => "blob:test/" + ++id;
	w.URL.revokeObjectURL = () => {};
	w.AudioContext = class {
		constructor() { this.state = "running"; }
		decodeAudioData() { return Promise.resolve({ duration: 60 }); }
	};
	w.Image = class { decode() { return Promise.resolve(); } };
	return { dom, w };
}

function capabilities() {
	return json({ version: 261, binaryImages: true, chunkVoiceover: true, compactPrompts: true });
}

/* ------------------------------------------------------------------ */
/* 1. Pacing and the daily ceiling are unchanged by this fix          */
/* ------------------------------------------------------------------ */

test("#263 pacing stays 3 images per 3 s per row and 10,000 images per day", () => {
	assert.equal(IMAGE_BATCH_CONCURRENCY, 3);
	assert.equal(IMAGE_BATCH_WAVE_INTERVAL_MS, 3000);
	assert.equal(IMAGE_DAILY_LIMIT, 10000);
});

/* ------------------------------------------------------------------ */
/* 2. requestImageChunk: retry only the failed scenes                 */
/* ------------------------------------------------------------------ */

test("#263 a failed image chunk retries only its failed scenes and keeps original indices", async (t) => {
	const { dom, w } = client();
	t.after(() => dom.window.close());

	const attempts = new Map();
	let injected = false;
	w.fetch = async (url, init = {}) => {
		if (url === "/api/pipeline-capabilities") return capabilities();
		if (url === "/api/image") {
			const prompt = JSON.parse(init.body).prompt;
			const seen = (attempts.get(prompt) || 0) + 1;
			attempts.set(prompt, seen);
			/* The *second* chunk's scenes fail once with a transient 500. */
			if (injected && /Scene [34]$/.test(prompt) && seen === 1) {
				return json({ error: "internal error" }, 500);
			}
			return image();
		}
		return json({ success: true, remaining: {} });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	await tick();

	const prompts = ["Scene 0", "Scene 1", "Scene 2", "Scene 3", "Scene 4", "Scene 5"];
	injected = true;
	const delivered = [];
	const results = await w.__REQUEST_IMAGE_CHUNK(prompts, { resolution: 1024, orientation: "landscape" }, {
		onImage: (blob, index) => { delivered.push(index); }
	});

	assert.deepEqual(delivered.sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], "every scene is delivered");
	assert.deepEqual(results.map((r) => r.ok), [true, true, true, true, true, true]);
	assert.deepEqual(results.map((r) => r.index), [0, 1, 2, 3, 4, 5], "results keep the original indices");
	/* Delivered scenes were never asked twice; the two failures were retried once. */
	assert.equal(attempts.get("Scene 0"), 1);
	assert.equal(attempts.get("Scene 1"), 1);
	assert.equal(attempts.get("Scene 3"), 2);
	assert.equal(attempts.get("Scene 4"), 2);
	assert.equal(attempts.get("Scene 5"), 1);
});

test("#263 a chunk retries 429/5xx load answers but never a 4xx rejection", async (t) => {
	const { dom, w } = client();
	t.after(() => dom.window.close());

	const attempts = new Map();
	w.fetch = async (url, init = {}) => {
		if (url === "/api/pipeline-capabilities") return capabilities();
		if (url === "/api/image") {
			const prompt = JSON.parse(init.body).prompt;
			const seen = (attempts.get(prompt) || 0) + 1;
			attempts.set(prompt, seen);
			if (prompt === "busy" && seen === 1) return json({ error: "capacity exceeded" }, 429);
			if (prompt === "rejected") return json({ error: "prompt rejected" }, 400);
			return image();
		}
		return json({ success: true, remaining: {} });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	await tick();

	const delivered = [];
	const results = await w.__REQUEST_IMAGE_CHUNK(["busy", "rejected", "fine"], {}, {
		onImage: (blob, index) => { delivered.push(index); }
	});

	assert.equal(attempts.get("busy"), 2, "429 is a load answer and is retried");
	assert.equal(attempts.get("rejected"), 1, "a 400 is never retried");
	assert.equal(attempts.get("fine"), 1);
	assert.deepEqual(delivered.sort((a, b) => a - b), [0, 2], "only the usable scenes arrive");
	assert.equal(results[1].ok, false, "the rejected scene is reported as a failure");
	assert.equal(results[0].ok, true);
});

test("#263 Stop cuts a retry wait short instead of leaving the row generating", async (t) => {
	const { dom, w } = client();
	t.after(() => dom.window.close());

	w.fetch = async (url, init = {}) => {
		if (url === "/api/pipeline-capabilities") return capabilities();
		if (url === "/api/image") {
			/* The server asks for a 5 s wait; Stop arrives after ~50 ms. */
			return json({ error: "capacity exceeded", kind: "overload", retryAfterMs: 5000 }, 503);
		}
		return json({ success: true, remaining: {} });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	await tick();

	let stopped = false;
	setTimeout(() => { stopped = true; }, 50);
	const started = Date.now();
	const results = await w.__REQUEST_IMAGE_CHUNK(["Scene 0", "Scene 1"], {}, {
		isCancelled: () => stopped
	});
	const elapsed = Date.now() - started;

	assert.ok(elapsed < 1500, "the 5 s wait was interrupted by Stop: " + elapsed + "ms");
	assert.deepEqual(results.map((r) => r.ok), [false, false]);
	assert.equal(results[0].error.name, "AbortError", "a cancelled scene is reported as a cancellation");
});

/* ------------------------------------------------------------------ */
/* 3. The reported bug: a chunk failure used to end the video at 3    */
/* ------------------------------------------------------------------ */

test("#263 a transient failure on the second image chunk no longer ends the video with 3 images", async (t) => {
	const { dom, w } = client();
	t.after(() => dom.window.close());

	const imageCalls = [];
	let failedChunk = false;
	w.fetch = async (url, init = {}) => {
		if (url === "/api/pipeline-capabilities") return capabilities();
		if (url === "/api/voiceover") return new Response(mp3, { headers: { "Content-Type": "audio/mpeg" } });
		if (url === "/api/image-prompts") {
			const body = JSON.parse(init.body);
			return json({
				success: true,
				prompts: Array.from({ length: body.batch.count }, (_, i) => "Scene " + (body.batch.offset + i))
			});
		}
		if (url === "/api/image") {
			const prompt = JSON.parse(init.body).prompt;
			imageCalls.push(prompt);
			/* Everything from scene 3 on fails once — the old code stopped here. */
			if (!failedChunk && /Scene (3|4|5)$/.test(prompt)) {
				failedChunk = true;
				return json({ error: "service unavailable" }, 503);
			}
			return image();
		}
		return json({ success: true, remaining: {} });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	await tick();

	const row = w.addBatchRow({ script: "A forest begins. " + "Nature is peaceful. ".repeat(40) + "A forest ends.", minutes: 1 });
	await w.runBatchRow(row);

	assert.equal(w.batchRowFinished(row), true, "the row still reaches done");
	assert.equal(row.images.length, 10, "all ten scenes are delivered, not the first three");
	assert.deepEqual(Array.from(row.images, (entry) => entry.index), Array.from({ length: 10 }, (_, i) => i));
	assert.equal(row.stage, "done");
	/* The three delivered scenes were not paid for twice. */
	assert.equal(imageCalls.filter((prompt) => prompt === "Scene 0").length, 1);
	assert.equal(imageCalls.filter((prompt) => prompt === "Scene 1").length, 1);
	assert.equal(imageCalls.filter((prompt) => prompt === "Scene 2").length, 1);
});

/* ------------------------------------------------------------------ */
/* 4. A prompt-chunk overload carries a usable wait and is survivable */
/* ------------------------------------------------------------------ */

test("#263 a prompt-chunk overload answers 503 + Retry-After + kind + retryAfterMs", async () => {
	/* The governor is isolate-wide by design: start from a quiet window. */
	sharedImageLoadGovernor.reset();
	const body = {
		topic: "Forest",
		minutes: 1,
		style: "Cinematic Film",
		scriptIdea: "A forest wakes up.",
		batch: { offset: 0, count: 3, attempt: 0 }
	};
	const request = () =>
		new Request("https://studio.test/api/image-prompts", {
			method: "POST",
			body: JSON.stringify(body)
		});

	const env = {
		AI: {
			run: async () => {
				throw new Error("503 Service Unavailable: capacity exceeded");
			}
		}
	};

	const response = await handleGenerateImagePrompts(request(), env, {});
	assert.equal(response.status, 503, "a load answer is not a blanket 502");
	const retryAfter = response.headers.get("Retry-After");
	assert.ok(Number(retryAfter) >= 1, "Retry-After is present and at least one second: " + retryAfter);
	const data = await response.json();
	assert.equal(data.success, false);
	assert.equal(data.code, "IMAGE_PROMPT_MODEL_FAILED");
	assert.equal(data.kind, "overload");
	assert.ok(Number(data.retryAfterMs) > 0, "the body carries the wait in ms too");
	assert.deepEqual(data.prompts, []);
});

test("#263 the attempt contract is unchanged (attempt 3 is still rejected before any inference)", async () => {
	let inferred = false;
	const env = { AI: { run: async () => { inferred = true; throw new Error("must not run"); } } };
	const response = await handleGenerateImagePrompts(
		new Request("https://studio.test/api/image-prompts", {
			method: "POST",
			body: JSON.stringify({
				topic: "Forest",
				minutes: 1,
				style: "Cinematic Film",
				batch: { offset: 0, count: 3, attempt: 3 }
			})
		}),
		env,
		{}
	);
	assert.equal(response.status, 400);
	assert.equal(inferred, false, "validation happens before the paid inference");
});

test("#263 a prompt-chunk overload no longer stops the video mid-way", async (t) => {
	const { dom, w } = client();
	t.after(() => dom.window.close());

	let overloaded = false;
	const promptStamps = [];
	w.fetch = async (url, init = {}) => {
		if (url === "/api/pipeline-capabilities") return capabilities();
		if (url === "/api/voiceover") return new Response(mp3, { headers: { "Content-Type": "audio/mpeg" } });
		if (url === "/api/image-prompts") {
			const body = JSON.parse(init.body);
			promptStamps.push({ offset: body.batch.offset, at: Date.now() });
			/* Scene 3 of the video lands on a busy text fleet, once. */
			if (body.batch.offset === 3 && !overloaded) {
				overloaded = true;
				return json({ success: false, error: "capacity exceeded", kind: "overload", retryAfterMs: 400 },
					503, { "Retry-After": "1" });
			}
			return json({
				success: true,
				prompts: Array.from({ length: body.batch.count }, (_, i) => "Scene " + (body.batch.offset + i))
			});
		}
		if (url === "/api/image") return image();
		return json({ success: true, remaining: {} });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	await tick();

	const row = w.addBatchRow({ script: "A forest begins. " + "Nature is peaceful. ".repeat(40) + "A forest ends.", minutes: 1 });
	await w.runBatchRow(row);

	assert.equal(w.batchRowFinished(row), true, "the row reaches done despite the overload");
	assert.equal(row.images.length, 10, "no scene is lost to the prompt overload");
	assert.deepEqual(Array.from(row.images, (entry) => entry.index), Array.from({ length: 10 }, (_, i) => i));
	const attempts = promptStamps.filter((entry) => entry.offset === 3);
	assert.equal(attempts.length, 2, "the overloaded prompt chunk was retried once");
	/* The browser waited the server's hint (>= 400 ms) instead of hammering. */
	assert.ok(attempts[1].at - attempts[0].at >= 350, "retry waited the load hint: " + (attempts[1].at - attempts[0].at) + "ms");
});

/* ------------------------------------------------------------------ */
/* 5. The worker still serves the untouched happy path                */
/* ------------------------------------------------------------------ */

test("#263 the binary capability endpoint still advertises the negotiated transport", async () => {
	const entry = worker.fetch ? worker : worker.default;
	const response = await entry.fetch(new Request("https://studio.test/api/pipeline-capabilities"), {}, {});
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(data.binaryImages, true);
});
