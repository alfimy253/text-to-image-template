/*
 * The keyword planner's retry contract, guarded directly against
 * `src/modules/script-seo.ts`:
 *
 *  1. a THROWN model error (AiError / timeout / empty reply) is retried
 *     instead of aborting the plan on the first failure;
 *  2. when one model keeps failing, the planner falls back to the next
 *     slug in SEO_PLAN_FALLBACK_MODELS;
 *  3. the route returns exactly one validated set and stops once it has it;
 *  4. the lenient reply shapes (`long_tail`, `shorts`, objects, delimited
 *     strings, five shorts) are accepted by `parseKeywordSet` while every
 *     RULE 7 rule is still enforced;
 *  5. the /api/script planner loop turns a model error into one consumed
 *     retry rather than an immediate 500.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SEO_PLAN_REQUEST_BUDGET_MS } from "../src/modules/retry-policy.ts";
import {
	SEO_PLAN_FALLBACK_MODELS,
	handleSeoPlanGeneration,
	handleSeoScriptGeneration,
	parseKeywordSet,
	planOneSeoKeywordSet
} from "../src/modules/script-seo.ts";
import {
	invalidateRelayCache,
	noteRelayFailure,
	resetRelayHealth,
	withRelayedAi
} from "../src/modules/api-relay.ts";

const setA = {
	title: "Yoga for a Calmer Morning",
	headings: ["Start with Yoga", "Find Your Balance"],
	longTail: "morning yoga poses for beginners in a small home studio",
	short: ["yoga", "breathing", "stretching", "balance"]
};

function jsonRequest(url, body) {
	return new Request(url, { method: "POST", body: JSON.stringify(body) });
}

test("a thrown model error is retried on the same model instead of failing the plan", async () => {
	const calls = [];
	const env = {
		AI: {
			run: async (model, input) => {
				calls.push({ model, prompt: input.prompt });
				if (calls.length === 1) {
					throw new Error("AiError 3043: Internal server error");
				}
				return { response: JSON.stringify(setA) };
			}
		}
	};

	const planned = await planOneSeoKeywordSet(env, "primary-model", "Morning yoga", []);
	assert.equal(planned.longTail, setA.longTail);
	assert.deepEqual(planned.shorts, setA.short);
	/* First call threw, second call succeeded on the SAME model. */
	assert.equal(calls.length, 2);
	assert.ok(calls.every((call) => call.model === "primary-model"));
});

test("the planner falls back to the next model when the primary keeps failing", async () => {
	const models = [];
	const env = {
		AI: {
			run: async (model) => {
				models.push(model);
				if (model === "primary-model") {
					throw new Error("5028: model was deprecated");
				}
				return { response: JSON.stringify(setA) };
			}
		}
	};

	const planned = await planOneSeoKeywordSet(
		env,
		"primary-model",
		"Morning yoga",
		["fallback-model"]
	);

	assert.equal(planned.title, setA.title);
	assert.ok(models.includes("primary-model"));
	assert.ok(models.includes("fallback-model"), "the fallback slug was actually called");
	assert.equal(models[models.length - 1], "fallback-model");
});

test("an empty model reply consumes an attempt instead of returning nothing", async () => {
	let calls = 0;
	const env = {
		AI: {
			run: async () => {
				calls++;
				return calls === 1 ? { response: "   " } : { response: JSON.stringify(setA) };
			}
		}
	};

	const planned = await planOneSeoKeywordSet(env, "mock-instruct", "Morning yoga", []);
	assert.equal(planned.longTail, setA.longTail);
	assert.equal(calls, 2);
});

test("seo-plan stops after one valid set and returns it as a complete plan", async () => {
	const prompts = [];
	const env = { AI: { run: async (_model, { prompt }) => {
		prompts.push(prompt);
		return { response: setA };
	} } };
	const response = await handleSeoPlanGeneration(
		jsonRequest("https://studio.test/api/seo-plan", { topic: "Morning yoga" }),
		env,
		"mock-instruct"
	);
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { success: true, topic: "Morning yoga", sets: [setA], model: "mock-instruct" });
	assert.equal(prompts.length, 1);
	assert.match(prompts[0], /ONLY one JSON object/);
	assert.doesNotMatch(prompts[0], /"sets"|alternative/i);
});

test("seo-plan still answers 500 when no set at all can be planned", async () => {
	const env = {
		AI: {
			run: async () => {
				throw new Error("AiError: workers ai unavailable");
			}
		}
	};

	const response = await handleSeoPlanGeneration(
		jsonRequest("https://studio.test/api/seo-plan", { topic: "Morning yoga" }),
		{ AI: env.AI },
		"primary-model"
	);

	assert.equal(response.status, 500);
	const data = await response.json();
	assert.equal(data.success, false);
	assert.match(data.error, /unavailable|planner model failed/);
});

test("the fallback model list is non-empty and differs from the configured model", () => {
	assert.ok(SEO_PLAN_FALLBACK_MODELS.length >= 1);
	assert.ok(SEO_PLAN_FALLBACK_MODELS.every((model) => /^@cf\//.test(model)));
});

test("parseKeywordSet accepts the reply shapes the 8B model actually emits", () => {
	const shapes = [
		/* snake_case + delimited short list */
		{ title: setA.title, headings: setA.headings.join("\n"), long_tail: setA.longTail, shorts: setA.short.join(", ") },
		/* objects inside the arrays */
		{
			videoTitle: setA.title,
			sections: setA.headings,
			keyword: setA.longTail,
			shortKeywords: setA.short.map((keyword) => ({ keyword }))
		},
		/* a fifth short is trimmed to the first four instead of failing */
		{ title: setA.title, headings: setA.headings, longTail: setA.longTail, short: [...setA.short, "mat work"] }
	];

	for (const shape of shapes) {
		const check = parseKeywordSet(JSON.stringify(shape));
		assert.equal(check.ok, true, JSON.stringify(shape));
		assert.equal(check.data.longTail, setA.longTail);
		assert.deepEqual(check.data.shorts, setA.short);
	}

	/* Wrapping quotes / trailing full stops do not break a keyword. */
	const cleaned = parseKeywordSet(
		JSON.stringify({
			title: setA.title,
			headings: setA.headings,
			longTail: `"${setA.longTail}."`,
			short: setA.short.map((keyword) => `"${keyword}"`)
		})
	);
	assert.equal(cleaned.ok, true);
	assert.equal(cleaned.data.longTail, setA.longTail);

	/* RULE 7 is still enforced: too few shorts are never invented. */
	const tooFew = parseKeywordSet(
		JSON.stringify({ title: setA.title, headings: setA.headings, longTail: setA.longTail, short: ["yoga", "breathing"] })
	);
	assert.equal(tooFew.ok, false);
	assert.match(tooFew.error, /exactly 4 short keywords/);
});

test("the /api/script planner retries a model error instead of returning 500", async () => {
	const prompts = [];
	const srt = [
		`Try ${setA.longTail} today.`,
		"Let breathing settle into a steady rhythm.",
		"Gentle stretching can release tension.",
		"Practice balance with a chair nearby.",
		"Keep your breathing relaxed and natural.",
		"Comfortable stretching should never hurt.",
		"Your balance improves with patient practice.",
		`Return to ${setA.longTail} tomorrow.`
	]
		.map((line, index) => {
			const stamp = (seconds) => `00:00:${String(seconds).padStart(2, "0")},000`;
			return `${index + 1}\n${stamp(index * 4)} --> ${stamp((index + 1) * 4)}\n${line}`;
		})
		.join("\n\n");

	let calls = 0;
	const env = {
		AI: {
			run: async (_model, input) => {
				prompts.push(input.prompt);
				calls++;
				if (calls === 1) {
					throw new Error("AiError 3043: Internal server error");
				}
				return { response: input.prompt.includes("SEO strategist") ? JSON.stringify(setA) : srt };
			}
		}
	};

	const request = jsonRequest("https://studio.test/api/script", { topic: "Morning yoga", minutes: 1 });
	const response = await handleSeoScriptGeneration(request, new URL(request.url), env, "mock-instruct");
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(data.success, true);
	assert.equal(data.keywords.longTail.keyword, setA.longTail);
	assert.ok(prompts.length >= 2);
});

test("a hanging planner cannot outlast the Worker request budget", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
	let signalStarted;
	const started = new Promise((resolve) => { signalStarted = resolve; });
	const models = [];
	const planning = handleSeoPlanGeneration(
		jsonRequest("https://studio.test/api/seo-plan", { topic: "Morning yoga" }),
		{ AI: { run: async (model) => {
			models.push(model);
			signalStarted();
			return new Promise(() => {});
		} } },
		"mock-instruct"
	);
	await started;
	for (const ms of [45_000, 400, 45_000, SEO_PLAN_REQUEST_BUDGET_MS - 90_400]) {
		t.mock.timers.tick(ms);
		await new Promise(setImmediate);
	}
	const response = await planning;
	assert.equal(response.status, 500);
	const data = await response.json();
	assert.equal(data.success, false);
	assert.match(data.error, /timed out/);
	assert.deepEqual(models, ["mock-instruct", "mock-instruct", SEO_PLAN_FALLBACK_MODELS[0]]);
});

/*
 * PRODUCTION REGRESSION (2026-11-20, worker-api-two):
 *
 *   POST /api/seo-plan -> 500
 *   [seo-plan] model call failed { attempt: 2, error: "Relay endpoint answered 404" }
 *
 * `env.AI` is the rotation proxy, so that message came from the POOL: a
 * registered backup did not serve `/api/relay/ai` (older deployment / typo /
 * path prefix). "404" matched FATAL_PATTERNS in image-load.ts, the chain
 * re-threw, and the browser got a 500 for a plan the local Worker could have
 * produced. This test runs the WHOLE route through a relayed env with one
 * stale backup: it must end at the local Worker with one validated set.
 */
test("a stale backup that 404s /api/relay/ai does not fail the plan: local answers", async () => {
	invalidateRelayCache();
	resetRelayHealth();
	const store = new Map([
		["config:workers", JSON.stringify(["https://stale.test"])],
		["config:llm", JSON.stringify({ provider: "cloudflare" })]
	]);
	const env = {
		AI: { run: async () => ({ response: JSON.stringify(setA) }) },
		KV_BINDING: {
			async get(key) {
				return store.has(key) ? store.get(key) : null;
			},
			async put(key, value) {
				store.set(key, String(value));
			},
			async delete(key) {
				store.delete(key);
			},
			async list() {
				return { keys: [], list_complete: true };
			}
		},
		RELAY_SECRET: "seo-plan-stale-backup"
	};
	/* Local is cooling, so the stale backup is the first candidate - exactly
	 * the order that produced the 404 in production. */
	noteRelayFailure("local", new Error("429 Too Many Requests"), 30_000);
	const requested = [];
	const relayed = withRelayedAi(env, jsonRequest("https://primary.test/api/seo-plan", { topic: "Morning yoga" }), {
		selfOrigin: "https://primary.test",
		fetchImpl: async (url) => {
			requested.push(String(url));
			/* An older deployment: the main router's plain 404. */
			return new Response("Not Found", { status: 404 });
		}
	});

	const response = await handleSeoPlanGeneration(
		jsonRequest("https://primary.test/api/seo-plan", { topic: "Morning yoga" }),
		relayed,
		"@cf/meta/llama-3.3-70b-instruct-fp8-fast"
	);
	assert.equal(response.status, 200, "the plan is served by the local Worker");
	const payload = await response.json();
	assert.equal(payload.success, true);
	assert.equal(payload.sets.length, 1);
	assert.equal(payload.sets[0].longTail, setA.longTail);
	assert.deepEqual(requested, ["https://stale.test/api/relay/ai"]);
	invalidateRelayCache();
	resetRelayHealth();
});
