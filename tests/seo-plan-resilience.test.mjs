/*
 * The keyword planner's retry contract, guarded directly against
 * `src/modules/script-seo.ts`:
 *
 *  1. a THROWN model error (AiError / timeout / empty reply) is retried
 *     instead of aborting the plan on the first failure;
 *  2. when one model keeps failing, the planner falls back to the next
 *     slug in SEO_PLAN_FALLBACK_MODELS;
 *  3. when only the FIRST set can be planned the route still answers 200
 *     with one validated set (`partial: true` + `warning`), so the
 *     walkthrough can continue instead of dead-ending;
 *  4. the lenient reply shapes (`long_tail`, `shorts`, objects, delimited
 *     strings, five shorts) are accepted by `parseKeywordSet` while every
 *     RULE 7 rule is still enforced;
 *  5. the /api/script planner loop turns a model error into one consumed
 *     retry rather than an immediate 500.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
	SEO_PLAN_FALLBACK_MODELS,
	handleSeoPlanGeneration,
	handleSeoScriptGeneration,
	parseKeywordSet,
	planOneSeoKeywordSet
} from "../src/modules/script-seo.ts";

const setA = {
	title: "Yoga for a Calmer Morning",
	headings: ["Start with Yoga", "Find Your Balance"],
	longTail: "morning yoga poses for beginners in a small home studio",
	short: ["yoga", "breathing", "stretching", "balance"]
};

const setB = {
	title: "Morning Yoga Balance Guide",
	headings: ["Morning Yoga for Stiff Beginners", "Build a Home Practice"],
	longTail: "gentle morning yoga routine for stiff beginners at home",
	short: ["morning yoga", "gentle stretch", "home practice", "yoga routine"]
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

	const planned = await planOneSeoKeywordSet(env, "primary-model", "Morning yoga", null, []);
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
		null,
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

	const planned = await planOneSeoKeywordSet(env, "mock-instruct", "Morning yoga", null, []);
	assert.equal(planned.longTail, setA.longTail);
	assert.equal(calls, 2);
});

test("seo-plan returns one validated set (200, partial) when the second set cannot differ", async () => {
	const env = {
		AI: {
			run: async (_model, input) => {
				/* Always the same set, even when asked to be different. */
				return { response: JSON.stringify(setA) };
			}
		}
	};

	const response = await handleSeoPlanGeneration(
		jsonRequest("https://studio.test/api/seo-plan", { topic: "Morning yoga" }),
		env,
		"mock-instruct"
	);

	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(data.success, true);
	assert.equal(data.partial, true);
	assert.equal(data.sets.length, 1);
	assert.deepEqual(data.sets[0].short, setA.short);
	assert.match(data.warning, /Only one keyword set/);
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
