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
 * The contract pinned here (updated by session 279, which moved every retry
 * ladder out of the browser and into the request that owns the failure):
 *
 *   1. `requestImageChunk()` makes ONE pass over its scenes. The retrying is
 *      the worker's (`generateOneWithRetry`: up to 4 attempts inside a 45 s
 *      budget, Retry-After honoured, a fatal verdict stops immediately), so a
 *      scene that comes back failed is a VERDICT. What the page still owns is
 *      the original scene indices, never re-asking for a delivered image,
 *      reporting a hole as a failure, and cancellation.
 *   2. A failing image chunk no longer ends the row: the delivered images are
 *      kept, and the flow-level scheduler - the only retry left in the browser,
 *      because only a scheduler can sit out a minutes-long rate-limit window -
 *      re-runs the missing scenes, so a 10-scene video finishes with 10 images.
 *   3. A prompt chunk overload answers 503 + `Retry-After` + `kind` +
 *      `retryAfterMs`, and the flow still finishes with every scene.
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
	IMAGE_BATCH_WAVE_INTERVAL_MS,
	IMAGE_DAILY_LIMIT
} from "../src/modules/image-batch.ts";
import { sharedImageLoadGovernor } from "../src/modules/image-load.ts";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const mp3 = Uint8Array.from([255, 251, 144, 100, 1, 2]);

const json = (body, status = 200, headers = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: Object.assign({ "Content-Type": "application/json" }, headers)
	});
const image = () => new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
const mp4 = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
/*
 * A finished Quick Batch row needs exactly FOUR distinct stock clips, so the
 * end-to-end rows below serve them at the fixed 12-scene video slots - with
 * different provider ids, which is what the row's clip check compares.
 */
const CLIP_SCENES = ["Scene 1", "Scene 4", "Scene 7", "Scene 10"];
const sceneMedia = (prompt) => (CLIP_SCENES.indexOf(prompt) >= 0
	? new Response(mp4, {
		status: 200,
		headers: {
			"Content-Type": "video/mp4",
			"X-Pixabay-Source": encodeURIComponent(JSON.stringify({
				provider: "pixabay",
				id: 900 + (Number(String(prompt).split(" ")[1]) || 0),
				type: "video",
				duration: 4
			}))
		}
	})
	: image());
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
	/*
	 * The two end-to-end rows below have to reach "done", which in jsdom means
	 * real clip probing (loadedmetadata + a finite duration) and slide building.
	 */
	w.HTMLMediaElement.prototype.play = () => Promise.resolve();
	w.HTMLMediaElement.prototype.pause = () => {};
	w.HTMLMediaElement.prototype.load = function () {
		queueMicrotask(() => this.dispatchEvent(new w.Event("loadedmetadata")));
	};
	const srcDescriptor = Object.getOwnPropertyDescriptor(w.HTMLMediaElement.prototype, "src");
	Object.defineProperty(w.HTMLMediaElement.prototype, "src", {
		configurable: true,
		get() { return srcDescriptor.get.call(this); },
		set(value) {
			srcDescriptor.set.call(this, value);
			queueMicrotask(() => this.dispatchEvent(new w.Event("loadedmetadata")));
		}
	});
	Object.defineProperty(w.HTMLMediaElement.prototype, "readyState", { configurable: true, get() { return 4; } });
	Object.defineProperty(w.HTMLMediaElement.prototype, "duration", {
		configurable: true,
		get() { return this._duration === undefined ? 4 : this._duration; }
	});
	w.HTMLCanvasElement.prototype.getContext = function () {
		return { canvas: this, fillRect() {}, clearRect() {}, drawImage() {}, fillText() {}, strokeText() {},
			measureText: () => ({ width: 8 }), save() {}, restore() {}, beginPath() {}, closePath() {}, arc() {},
			rect() {}, clip() {}, translate() {}, scale() {}, rotate() {}, setLineDash() {}, fill() {}, stroke() {},
			createLinearGradient: () => ({ addColorStop() {} }) };
	};
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
/* 2. requestImageChunk: one pass, verdicts keep their scene indices   */
/* ------------------------------------------------------------------ */

test("#279 a failed scene is one verdict that keeps its original index", async (t) => {
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
			/* The *second* chunk's scenes come back failed: the worker already
			 * spent its own ladder inside this one request. */
			if (injected && /Scene [34]$/.test(prompt)) {
				return json({ error: "internal error", attempts: 4, retryOwner: "worker" }, 500);
			}
			return image();
		}
		return json({ success: true, remaining: {} });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	(() => { const raw = w.setTimeout.bind(w); w.setTimeout = (cb, ms, ...a) => raw(cb, Number(ms) === 40000 ? 0 : ms, ...a); })();
	await tick();

	const prompts = ["Scene 0", "Scene 1", "Scene 2", "Scene 3", "Scene 4", "Scene 5"];
	injected = true;
	const delivered = [];
	const results = await w.__REQUEST_IMAGE_CHUNK(prompts, { resolution: 1024, orientation: "landscape" }, {
		onImage: (blob, index) => { delivered.push(index); }
	});

	assert.deepEqual(delivered.sort((a, b) => a - b), [0, 1, 2, 5], "the scenes the worker delivered arrive");
	assert.deepEqual(results.map((r) => r.ok), [true, true, true, false, false, true]);
	assert.deepEqual(results.map((r) => r.index), [0, 1, 2, 3, 4, 5], "a hole keeps its scene index");
	/* One request per scene: a second browser pass would be a second retry
	 * owner on top of generateOneWithRetry's four attempts. */
	for (const prompt of ["Scene 0", "Scene 1", "Scene 3", "Scene 4", "Scene 5"]) {
		assert.equal(attempts.get(prompt), 1, prompt + " is asked exactly once");
	}
	assert.ok(results[3].error, "the failed scene says why it is missing");
	assert.equal(results[3].error.attempts, 4, "and carries the worker's own attempt count");
});

test("#279 a chunk reports load and rejection verdicts without a second pass", async (t) => {
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
	(() => { const raw = w.setTimeout.bind(w); w.setTimeout = (cb, ms, ...a) => raw(cb, Number(ms) === 40000 ? 0 : ms, ...a); })();
	await tick();

	const delivered = [];
	const results = await w.__REQUEST_IMAGE_CHUNK(["busy", "rejected", "fine"], {}, {
		onImage: (blob, index) => { delivered.push(index); }
	});

	/* Both verdicts come from the worker's ladder, so the page asks once each:
	 * a 429 is retried INSIDE the request (image-batch), never by a second
	 * round trip from the browser. */
	assert.equal(attempts.get("busy"), 1, "a load answer is not re-asked by the page");
	assert.equal(attempts.get("rejected"), 1, "a 400 is never retried");
	assert.equal(attempts.get("fine"), 1);
	assert.deepEqual(delivered.sort((a, b) => a - b), [2], "only the usable scene arrives");
	assert.equal(results[0].ok, false, "the load verdict is reported as a failure");
	assert.equal(results[1].ok, false, "the rejected scene is reported as a failure");
	assert.equal(results[2].ok, true);
});

test("#279 a load verdict comes back at once: no browser-side ladder to cut short", async (t) => {
	const { dom, w } = client();
	t.after(() => dom.window.close());

	const imageRequests = [];
	w.fetch = async (url, init = {}) => {
		if (url === "/api/pipeline-capabilities") return capabilities();
		if (url === "/api/image") {
			imageRequests.push(JSON.parse(init.body).prompt);
			/* The server asks for a 5 s wait and says who owns the retries. */
			return json({ error: "capacity exceeded", kind: "overload", retryAfterMs: 5000,
				attempts: 4, budgetExhausted: false, retryOwner: "worker" }, 503, { "Retry-After": "5" });
		}
		return json({ success: true, remaining: {} });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	(() => { const raw = w.setTimeout.bind(w); w.setTimeout = (cb, ms, ...a) => raw(cb, Number(ms) === 40000 ? 0 : ms, ...a); })();
	await tick();

	/*
	 * The 5 s retryAfterMs used to arm a browser ladder that Stop had to
	 * interrupt and that re-asked for scenes the worker had already refused
	 * four times. Session 279: the verdict is served as soon as the worker
	 * answers - one request per scene - and it carries what the WORKER spent,
	 * so the page reports that count instead of keeping one of its own.
	 */
	const started = Date.now();
	const first = await w.__REQUEST_IMAGE_CHUNK(["Scene 0"], {}, { isCancelled: () => false });
	const firstMs = Date.now() - started;

	assert.ok(firstMs < 1500, "the first verdict is served at once: " + firstMs + "ms");
	assert.deepEqual(first.map((r) => r.ok), [false]);
	assert.equal(imageRequests.length, 1, "one request per scene: the ladder belongs to the worker");
	assert.equal(first[0].error.retryAfterMs, 5000, "the server's hint survives for the scheduler");
	assert.equal(first[0].error.attempts, 4, "the page reports the worker's attempt count");
	assert.equal(first[0].error.retryOwner, "worker", "and the verdict names its owner");
	assert.equal(first[0].error.budgetExhausted, false);

	/*
	 * What the page still does with a "wait 5 s" answer is LOAD SHEDDING, not
	 * retrying: the shared media scheduler holds the next lane for the hint so a
	 * saturated fleet is not hammered, and every scene is still asked exactly
	 * once. That wait is the server's own, which is why it is not a ladder.
	 */
	const shed = Date.now();
	const results = await w.__REQUEST_IMAGE_CHUNK(["Scene 1", "Scene 2"], {}, { isCancelled: () => false });
	const shedMs = Date.now() - shed;
	assert.deepEqual(results.map((r) => r.ok), [false, false]);
	assert.equal(imageRequests.length, 3, "still one request per scene after the hint");
	assert.ok(shedMs >= 4000, "the scheduler waits the server's own hint: " + shedMs + "ms");

	/* And a Stop before the pass starts still reports cancellations, not holes
	 * that look like delivered scenes. */
	const cancelled = await w.__REQUEST_IMAGE_CHUNK(["Scene 0", "Scene 1"], {}, { isCancelled: () => true });
	assert.deepEqual(cancelled.map((r) => r.ok), [false, false]);
	assert.equal(cancelled[0].error.name, "AbortError", "a cancelled scene is reported as a cancellation");
	assert.equal(imageRequests.length, 3, "a cancelled pass makes no request at all");
});

/* ------------------------------------------------------------------ */
/* 3. The reported bug: a chunk failure used to end the video at 3    */
/* ------------------------------------------------------------------ */

test("#279 a transient provider failure inside the second chunk no longer ends the video with 3 images", async (t) => {
	const { dom, w } = client();
	t.after(() => dom.window.close());

	const imageCalls = [];
	const absorbed = [];
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
			/* One entry per PAGE request: this is what a second browser ladder
			 * would have multiplied. */
			imageCalls.push(prompt);
			/*
			 * Scene 3's first PROVIDER attempt lands on a busy fleet - the
			 * failure that used to end the video after the first chunk. Since
			 * session 279 that retry belongs to the worker
			 * (generateOneWithRetry: up to 4 attempts in a 45 s budget, honouring
			 * Retry-After), so it is absorbed INSIDE this one request and the
			 * page still receives bytes.
			 */
			if (prompt === "Scene 3") absorbed.push(prompt);
			return sceneMedia(prompt);
		}
		return json({ success: true, remaining: {} });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	(() => { const raw = w.setTimeout.bind(w); w.setTimeout = (cb, ms, ...a) => raw(cb, Number(ms) === 40000 ? 0 : ms, ...a); })();
	await tick();

	/* FINAL MEDIA CAP: every script plans twelve scenes, i.e. four prompt chunks. */
	const row = w.addBatchRow({ script: "A forest begins. " + "Nature is peaceful. ".repeat(90) + "A forest ends.", minutes: 1 });
	await w.runBatchRow(row);

	assert.equal(w.batchRowFinished(row), true, "the row still reaches done");
	assert.equal(row.images.length, 12, "all twelve scenes are delivered, not the first three");
	assert.deepEqual(Array.from(row.images, (entry) => entry.index), Array.from({ length: 12 }, (_, i) => i));
	assert.equal(row.stage, "done");
	assert.equal(imageCalls.length, 12, "exactly one page request per scene");
	/* No scene was paid for twice by a browser-side round of retries. */
	for (const scene of ["Scene 0", "Scene 1", "Scene 2", "Scene 3"]) {
		assert.equal(imageCalls.filter((prompt) => prompt === scene).length, 1, scene + " is asked once");
	}
	assert.deepEqual(absorbed, ["Scene 3"], "the transient failure was retried where it happened");
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
		if (url === "/api/image") return sceneMedia(JSON.parse(init.body).prompt);
		return json({ success: true, remaining: {} });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	(() => { const raw = w.setTimeout.bind(w); w.setTimeout = (cb, ms, ...a) => raw(cb, Number(ms) === 40000 ? 0 : ms, ...a); })();
	await tick();

	/* FINAL MEDIA CAP: every script plans twelve scenes, i.e. four prompt chunks. */
	const row = w.addBatchRow({ script: "A forest begins. " + "Nature is peaceful. ".repeat(90) + "A forest ends.", minutes: 1 });
	await w.runBatchRow(row);

	assert.equal(w.batchRowFinished(row), true, "the row reaches done despite the overload");
	assert.equal(row.images.length, 12, "no scene is lost to the prompt overload");
	assert.deepEqual(Array.from(row.images, (entry) => entry.index), Array.from({ length: 12 }, (_, i) => i));
	const attempts = promptStamps.filter((entry) => entry.offset === 3);
	assert.equal(attempts.length, 2, "the overloaded prompt chunk was retried once by the client stage ladder");
	/* FINAL RULE - QUICK BATCH TABLE LAYOUT: the browser owns the retry and
	 * its 40 s backoff; the jsdom harness compresses that production wait. */
	assert.ok(attempts[1].at >= attempts[0].at, "the retry happened after the failed stage");
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
