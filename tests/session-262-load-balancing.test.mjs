/*
 * Bug fix #262 — server-load balancing + request backoff for AI images.
 *
 * The studio used to lean on fixed waits ("3 images per 3 seconds", a 10-image
 * guest day, a flat 500 ms retry) which made generation *look* broken whenever
 * the fleet was busy: the pacing queue slept, retries collided, and a guest
 * simply ran out after ten images. This suite pins the replacement contract:
 *
 *   1. Provider failures are classified (overload / transient / fatal), and a
 *      provider `Retry-After` is honoured.
 *   2. The shared governor is AIMD: +1 after a healthy streak, halved on an
 *      overload signal, with a bounded cooldown that doubles while the
 *      provider keeps complaining.
 *   3. `ImageTaskQueue` reads that ceiling live and never dispatches during a
 *      cooldown, while keeping the per-row 3-per-3 s pacing.
 *   4. `handleImageBatch` retries load failures with backoff, never retries a
 *      fatal error, and streams the load hint to the browser.
 *   5. `handleImageBinary` answers 503 + Retry-After (instead of a blanket 502)
 *      on load, refunding the credit exactly once.
 *   6. The browser runtime pauses media fan-out for the declared window while
 *      control work keeps flowing.
 *   7. Every plan carries the same 10,000 image/day ceiling.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { BROWSER_OFFLOAD_JS } from "../src/client/browser-offload.ts";
import {
	IMAGE_DAILY_LIMIT,
	default as workerModule
} from "../src/index.ts";
import {
	ImageLoadGovernor,
	IMAGE_LOAD_COOLDOWN_BASE_MS,
	IMAGE_LOAD_MAX_ATTEMPTS,
	IMAGE_LOAD_MAX_CONCURRENCY,
	IMAGE_LOAD_START_CONCURRENCY,
	classifyImageFailure,
	parseRetryAfterMs,
	sharedImageLoadGovernor
} from "../src/modules/image-load.ts";
import { ImageTaskQueue } from "../src/modules/image-queue.ts";
import { handleImageBatch, handleImageBinary } from "../src/modules/image-batch.ts";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const worker = workerModule.default || workerModule;

function overloadError(message = "429 Too Many Requests", retryAfterMs) {
	const error = new Error(message);
	if (typeof retryAfterMs === "number") error.retryAfterMs = retryAfterMs;
	return error;
}

function makeKv() {
	const store = new Map();
	return {
		store,
		async get(key) {
			return store.has(key) ? store.get(key) : null;
		},
		async put(key, value) {
			store.set(key, String(value));
		},
		async delete(key) {
			store.delete(key);
		},
		async list({ prefix = "", limit = 1000 } = {}) {
			const keys = [];
			for (const name of Array.from(store.keys()).sort()) {
				if (name.startsWith(prefix)) {
					keys.push({ name });
					if (keys.length >= limit) break;
				}
			}
			return { keys, list_complete: true };
		}
	};
}

function runtime(overrides = {}) {
	const win = {
		navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
		document: { hidden: false },
		setTimeout,
		clearTimeout,
		Blob,
		URL,
		AbortController,
		fetch: async () =>
			new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
		...overrides
	};
	const context = vm.createContext({
		window: win,
		URL,
		console,
		setTimeout,
		clearTimeout,
		Blob,
		AbortController
	});
	vm.runInContext(BROWSER_OFFLOAD_JS + "\nthis.runtime = studioOffload;", context);
	return { runtime: context.runtime, win };
}

/* ------------------------------------------------------------------ */
/* 1. Classification + Retry-After parsing                            */
/* ------------------------------------------------------------------ */

test("#262 provider failures are classified as overload, transient or fatal", () => {
	const overload = [
		"429 Too Many Requests",
		"AiError: 503 Service Unavailable",
		"Worker capacity exceeded",
		"The model is temporarily overloaded",
		"rate limit reached for this account",
		"Allocation quota exceeded"
	];
	for (const message of overload) {
		const result = classifyImageFailure(new Error(message));
		assert.equal(result.kind, "overload", message);
		assert.equal(result.retryable, true, message);
	}

	const transient = ["AiError: 3043", "Image generation timed out after 75 s", "ECONNRESET socket hang up"];
	for (const message of transient) {
		const result = classifyImageFailure(new Error(message));
		assert.equal(result.kind, "transient", message);
		assert.equal(result.retryable, true, message);
	}

	const fatal = [
		"no such model: @cf/retired/model",
		"invalid prompt: maximum length exceeded",
		"AI binding not configured"
	];
	for (const message of fatal) {
		const result = classifyImageFailure(new Error(message));
		assert.equal(result.kind, "fatal", message);
		assert.equal(result.retryable, false, message);
	}
});

test("#262 a provider Retry-After is normalised from headers, fields and text", () => {
	assert.equal(parseRetryAfterMs({ retryAfterMs: 2400 }), 2400);
	/* A bare number under a minute is seconds, per the HTTP convention. */
	assert.equal(parseRetryAfterMs({ retryAfter: 3 }), 3000);
	assert.equal(parseRetryAfterMs({ headers: { get: () => "2" } }), 2000);
	assert.equal(parseRetryAfterMs(new Error("429 busy, retry after 4s")), 4000);
	assert.equal(parseRetryAfterMs(new Error("429 busy, retry after 250ms")), 250);
	assert.equal(parseRetryAfterMs(new Error("429 busy")), null);

	const classified = classifyImageFailure(
		Object.assign(new Error("503 Service Unavailable"), { retryAfterMs: 1500 })
	);
	assert.equal(classified.kind, "overload");
	assert.equal(classified.retryAfterMs, 1500);
});

/* ------------------------------------------------------------------ */
/* 2. AIMD governor                                                    */
/* ------------------------------------------------------------------ */

test("#262 the governor grows additively, halves on overload and doubles its cooldown", () => {
	let now = 1000;
	const governor = new ImageLoadGovernor({
		minConcurrency: 1,
		startConcurrency: IMAGE_LOAD_START_CONCURRENCY,
		maxConcurrency: IMAGE_LOAD_MAX_CONCURRENCY,
		recoveryWindow: 4,
		cooldownBaseMs: 100,
		cooldownMaxMs: 400,
		retryBaseMs: 100,
		retryMaxMs: 2000,
		now: () => now,
		random: () => 0.5
	});

	assert.equal(governor.limit, 3, "starts conservatively");
	for (let i = 0; i < 4; i++) governor.noteSuccess();
	assert.equal(governor.limit, 4, "+1 after a healthy streak");
	for (let i = 0; i < 4; i++) governor.noteSuccess();
	assert.equal(governor.limit, 5, "keeps growing toward the ceiling");

	/* A transient failure must not cost capacity. */
	governor.noteFailure({ kind: "transient", retryable: true, retryAfterMs: null, reason: "timeout" });
	assert.equal(governor.limit, 5);

	const first = governor.noteFailure({
		kind: "overload",
		retryable: true,
		retryAfterMs: null,
		reason: "429"
	});
	assert.equal(governor.limit, 2, "overload halves the pool");
	assert.equal(first, 100, "cooldown starts at the base");
	assert.equal(governor.cooldownRemainingMs, 100);

	/*
	 * One scene burns primary + two fallbacks inside a few ms: three overload
	 * answers, ONE load event. Concurrency still halves, the streak does not.
	 */
	const burst = governor.noteFailure({
		kind: "overload",
		retryable: true,
		retryAfterMs: null,
		reason: "429"
	});
	assert.equal(governor.limit, 1, "never drops under the floor");
	assert.equal(burst, 100, "same-window failures do not compound the cooldown");

	now += 50;
	assert.equal(governor.cooldownRemainingMs, 50);
	now += 60;
	assert.equal(governor.cooldownRemainingMs, 0);

	now += 200;
	const second = governor.noteFailure({
		kind: "overload",
		retryable: true,
		retryAfterMs: null,
		reason: "429"
	});
	assert.equal(second, 200, "cooldown doubles when the outage persists across windows");
	assert.equal(governor.limit, 1);

	/* A provider hint always wins over the computed cooldown. */
	now += 300;
	const hinted = governor.noteFailure({
		kind: "overload",
		retryable: true,
		retryAfterMs: 1000,
		reason: "429"
	});
	assert.equal(hinted, 400, "hint is still capped by cooldownMaxMs");
	assert.equal(governor.limit, 1);

	/* Recovery is possible again once the window passes. */
	now += 500;
	for (let i = 0; i < 4; i++) governor.noteSuccess();
	assert.equal(governor.limit, 2, "the pool climbs back after a healthy streak");
	assert.equal(governor.snapshot().successes, 12);
});

test("#262 retry delays are exponential with jitter, honour hints and cap out", () => {
	const fast = new ImageLoadGovernor({
		retryBaseMs: 500,
		retryMaxMs: 4000,
		random: () => 1
	});
	assert.equal(fast.retryDelayMs(1), 500);
	assert.equal(fast.retryDelayMs(2), 1000);
	assert.equal(fast.retryDelayMs(3), 2000);
	assert.equal(fast.retryDelayMs(9), 4000, "never exceeds retryMaxMs");
	assert.equal(fast.retryDelayMs(1, 1500), 1500, "a provider hint wins");
	assert.equal(fast.retryDelayMs(1, 60000), 4000, "hint is clamped");

	const jittered = new ImageLoadGovernor({ retryBaseMs: 500, retryMaxMs: 4000, random: () => 0 });
	assert.equal(jittered.retryDelayMs(1), 250, "jitter spreads colliding retries");
});

/* ------------------------------------------------------------------ */
/* 3. Queue follows the governor, pacing stays                         */
/* ------------------------------------------------------------------ */

test("#262 the queue reads the governor's live ceiling and waits out its cooldown", async () => {
	const governor = new ImageLoadGovernor({
		minConcurrency: 1,
		startConcurrency: 3,
		maxConcurrency: 6,
		cooldownBaseMs: 120,
		cooldownMaxMs: 240,
		retryBaseMs: 20
	});
	const queue = new ImageTaskQueue({
		maxGlobalConcurrency: 6,
		maxGroupConcurrency: 3,
		groupWindowLimit: 10,
		groupWindowMs: 1000,
		governor
	});

	assert.equal(queue.effectiveGlobalConcurrency(), 3, "static ceiling starts as the governor's");

	governor.noteFailure({ kind: "overload", retryable: true, retryAfterMs: 120, reason: "429" });
	assert.equal(governor.limit, 1);
	assert.equal(queue.effectiveGlobalConcurrency(), 1, "the pool shrinks with the governor");
	assert.ok(queue.loadCooldownMs() > 0, "the cooldown is visible to the queue");

	let active = 0;
	let peak = 0;
	let firstStart = 0;
	const t0 = Date.now();
	await Promise.all(
		[0, 1, 2].map(() =>
			queue.enqueue({
				groupId: "row-a",
				execute: async () => {
					if (!firstStart) firstStart = Date.now() - t0;
					active++;
					if (active > peak) peak = active;
					await new Promise((resolve) => setTimeout(resolve, 10));
					active--;
					return "ok";
				}
			})
		)
	);

	assert.equal(peak, 1, "one provider call at a time after an overload signal");
	assert.ok(firstStart >= 80, "dispatch waited out the load cooldown: " + firstStart + "ms");

	/* A queue without a governor keeps the historic static behaviour. */
	const plain = new ImageTaskQueue({
		maxGlobalConcurrency: 4,
		maxGroupConcurrency: 2,
		groupWindowLimit: 2,
		groupWindowMs: 50,
		governor: null
	});
	assert.equal(plain.effectiveGlobalConcurrency(), 4);
	assert.equal(plain.loadCooldownMs(), 0);
});

test("#262 the per-row 3-per-3s pacing still holds under the load governor", async () => {
	const governor = new ImageLoadGovernor({ startConcurrency: 6, maxConcurrency: 6 });
	const queue = new ImageTaskQueue({
		maxGlobalConcurrency: 6,
		maxGroupConcurrency: 3,
		groupWindowLimit: 3,
		groupWindowMs: 150,
		governor
	});
	const started = [];
	const t0 = Date.now();
	await Promise.all(
		[0, 1, 2, 3].map((index) =>
			queue.enqueue({
				groupId: "row-paced",
				execute: async () => {
					started.push(Date.now() - t0);
					return index;
				}
			})
		)
	);
	started.sort((a, b) => a - b);
	assert.ok(started[2] < 100, "the first wave (3 images) starts immediately: " + started.join(","));
	assert.ok(started[3] >= 120, "the fourth image waits for the next window: " + started.join(","));
});

/* ------------------------------------------------------------------ */
/* 4. Batch route: backoff on load, no retry on fatal                  */
/* ------------------------------------------------------------------ */

test("#262 a load failure is retried with backoff instead of failing the scene", async () => {
	sharedImageLoadGovernor.reset();
	let calls = 0;
	const env = {
		AI: {
			run: async () => {
				calls++;
				if (calls === 1) throw overloadError("429 Too Many Requests", 5);
				return png;
			}
		}
	};
	const response = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompts: ["scene one"] })
		}),
		env,
		{
			consume: async (n) => ({ allowed: true, granted: n, summary: { remaining: { images: 9999 } } }),
			refund: async () => null
		},
		{ groupId: "load-retry", waveIntervalMs: 0, minCooldownMs: 0 }
	);

	const events = (await response.text())
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const done = events[events.length - 1];
	const image = events.find((event) => event.type === "image");

	assert.equal(done.type, "done");
	assert.equal(done.generated, 1, "the retried scene still renders");
	assert.equal(done.failed, 0);
	assert.equal(done.overloadFailures, 0, "a recovered scene is not a failure");
	assert.equal(image.ok, true);
	assert.ok(calls >= 2, "the load failure was retried, not surfaced");

	/* The start event exposes the live load model for the UI/logs. */
	const start = events.find((event) => event.type === "start");
	assert.ok(start.load && typeof start.load.limit === "number");
	assert.equal(sharedImageLoadGovernor.limit >= 1, true);
	sharedImageLoadGovernor.reset();
});

test("#262 a fatal provider error is not retried (no extra paid inference)", async () => {
	sharedImageLoadGovernor.reset();
	let calls = 0;
	const env = {
		AI: {
			run: async () => {
				calls++;
				throw new Error("no such model: @cf/retired/model");
			}
		}
	};
	const response = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompts: ["scene one"] })
		}),
		env,
		{
			consume: async (n) => ({ allowed: true, granted: n, summary: {} }),
			refund: async (n) => ({ remaining: { images: n } })
		},
		{ groupId: "fatal-no-retry", waveIntervalMs: 0, minCooldownMs: 0 }
	);

	const events = (await response.text())
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const image = events.find((event) => event.type === "image");
	assert.equal(image.ok, false);
	assert.equal(image.kind, "fatal");
	assert.equal(image.retryAfterMs, null);
	/* One attempt across the primary + the two fallback models. */
	assert.equal(calls, 3, "the fatal error stopped after the first attempt");
	const done = events[events.length - 1];
	assert.equal(done.generated, 0);
	assert.equal(done.failed, 1);
	sharedImageLoadGovernor.reset();
});

test("#262 an unrecovered overload streams a retry hint for the browser", async () => {
	sharedImageLoadGovernor.reset();
	const env = {
		AI: {
			run: async () => {
				throw overloadError("503 Service Unavailable: capacity exceeded", 1);
			}
		}
	};
	const response = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompts: ["scene one"] })
		}),
		env,
		{
			consume: async (n) => ({ allowed: true, granted: n, summary: {} }),
			refund: async () => null
		},
		{ groupId: "overload-exhausted", waveIntervalMs: 0, minCooldownMs: 0 }
	);

	const events = (await response.text())
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const image = events.find((event) => event.type === "image");
	const done = events[events.length - 1];
	assert.equal(image.ok, false);
	assert.equal(image.kind, "overload");
	assert.ok(image.retryAfterMs > 0, "the failed scene carries a backoff hint");
	assert.equal(done.overloadFailures, 1);
	assert.ok(done.retryAfterMs > 0);
	assert.ok(done.load.cooldownRemainingMs > 0, "the governor reports the pending cooldown");
	assert.equal(IMAGE_LOAD_MAX_ATTEMPTS, 4, "load failures get the longer ladder");
	sharedImageLoadGovernor.reset();
});

/* ------------------------------------------------------------------ */
/* 5. Binary route: 503 + Retry-After, one refund                      */
/* ------------------------------------------------------------------ */

test("#262 an overloaded binary image answers 503 with Retry-After and refunds once", async () => {
	sharedImageLoadGovernor.reset();
	let refunds = 0;
	let calls = 0;
	const response = await handleImageBinary(
		new Request("https://studio.test/api/image", {
			method: "POST",
			body: JSON.stringify({ prompt: "forest" })
		}),
		{
			AI: {
				run: async () => {
					calls++;
					throw overloadError("503 Service Unavailable: capacity exceeded", 1);
				}
			}
		},
		{
			consume: async () => ({ allowed: true, granted: 1 }),
			refund: async () => {
				refunds++;
				return { remaining: { images: 10000 } };
			}
		}
	);

	assert.equal(response.status, 503, "load is not a plain 502");
	assert.ok(Number(response.headers.get("Retry-After")) >= 1, "the browser gets a wait hint");
	const body = await response.json();
	assert.equal(body.kind, "overload");
	assert.ok(body.retryAfterMs > 0);
	assert.ok(body.load && typeof body.load.limit === "number");
	assert.equal(refunds, 1, "the credit is refunded exactly once");
	assert.equal(calls, IMAGE_LOAD_MAX_ATTEMPTS * 3, "four backed-off attempts across three models");
	sharedImageLoadGovernor.reset();
});

test("#262 a non-load provider failure stays a 502 (regression guard for #261)", async () => {
	sharedImageLoadGovernor.reset();
	let refunds = 0;
	const response = await handleImageBinary(
		new Request("https://studio.test/api/image", {
			method: "POST",
			body: JSON.stringify({ prompt: "forest" })
		}),
		{
			AI: {
				run: async () => {
					throw new Error("model unavailable");
				}
			}
		},
		{
			consume: async () => ({ allowed: true, granted: 1 }),
			refund: async () => {
				refunds++;
				return null;
			}
		}
	);
	assert.equal(response.status, 502);
	assert.equal(refunds, 1);
	assert.equal(response.headers.get("Retry-After"), null);
	sharedImageLoadGovernor.reset();
});

/* ------------------------------------------------------------------ */
/* 6. Browser runtime honours the server's backoff                     */
/* ------------------------------------------------------------------ */

test("#262 the browser pauses media fan-out for Retry-After while control work continues", async () => {
	let imageCalls = 0;
	const { runtime: r } = runtime({
		fetch: async (url) => {
			if (String(url) === "/api/image") {
				imageCalls++;
				return new Response(
					JSON.stringify({ error: "The fleet is busy", kind: "overload", retryAfterMs: 700 }),
					{
						status: 503,
						headers: { "Content-Type": "application/json", "Retry-After": "1" }
					}
				);
			}
			return new Response(JSON.stringify({ success: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" }
			});
		}
	});

	const results = await r.images(["one"], {}, {});
	assert.equal(results[0].ok, false);
	assert.equal(results[0].error.status, 503);
	assert.equal(results[0].error.retryAfterMs, 1000, "the Retry-After header wins over the JSON hint");
	assert.ok(r.stats().backoffMs > 0, "the runtime remembers the window");

	const started = Date.now();
	/* Control work (prompts/credits) is not media: it must keep flowing. */
	const credits = await r.jsonRequest("/api/credits", {}, 5000, {});
	assert.equal(credits.ok, true);
	await r.schedule(async () => "media ran", {});
	const waited = Date.now() - started;

	assert.ok(
		waited >= 800,
		"media work waited for the server-declared backoff: " + waited + "ms"
	);
	assert.equal(imageCalls, 1, "the failed paid request is never replayed");
});

/* ------------------------------------------------------------------ */
/* 7. Plan ceiling                                                     */
/* ------------------------------------------------------------------ */

test("#262 every plan reports the same 10,000 image/day ceiling", async () => {
	assert.equal(IMAGE_DAILY_LIMIT, 10000);

	const entry = worker.fetch ? worker : worker.default;
	const kv = makeKv();
	const response = await entry.fetch(
		new Request("https://studio.test/api/credits", {
			headers: { Cookie: "yvs_free=1", "CF-Connecting-IP": "203.0.113.77" }
		}),
		{ KV_BINDING: kv },
		{}
	);
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.plan.limits.images, 10000, "the guest tier is no longer capped at 10");
	assert.equal(body.remaining.images, 10000);
	assert.ok(IMAGE_LOAD_COOLDOWN_BASE_MS > 0);
});
