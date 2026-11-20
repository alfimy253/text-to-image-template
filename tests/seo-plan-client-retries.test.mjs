/*
 * SEO PLANNING OWNS A CLIENT LADDER (2026-11-20).
 *
 * POST /api/seo-plan used to be a single shot in the editor walkthrough: one
 * failed planner call and the user had to click again. It is a pipeline step
 * like script writing, so the browser now retries it 30 times, 20 s apart,
 * and both numbers come from src/modules/retry-policy.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./studio-render-harness.mjs";

const plan = {
	title: "Yoga Morning Balance",
	headings: ["Yoga for Calm", "Morning Stretch"],
	longTail: "morning yoga poses for beginners at home",
	short: ["yoga", "breathing", "stretching", "balance"]
};

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

function editor(w) {
	w.addVideoAccordion();
	w.document.getElementById("va-script-topic-1").value = "morning yoga";
	w.document.getElementById("va-script-minutes-1").value = "1";
}

function capturePlan(w, reply) {
	const calls = [];
	const original = w.fetch;
	w.fetch = async (input, init = {}) => {
		const path = new URL(String(input), "https://studio.test").pathname;
		if (path === "/api/seo-plan") {
			calls.push(init && init.body ? JSON.parse(init.body) : null);
			return reply(calls.length, init);
		}
		return original(input, init);
	};
	return calls;
}

test("a failed SEO plan is retried silently until it succeeds", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	editor(w);
	const calls = capturePlan(w, (attempt) =>
		attempt < 4
			? json({ success: false, error: "SEO planner model failed - try again" }, 500)
			: json({ success: true, sets: [plan] })
	);

	await w.generateScript(1);

	assert.equal(calls.length, 4, "three failed plans plus the fourth, successful one");
	assert.deepEqual(calls[0], { topic: "morning yoga" });

	const log = w.__SEO_PLAN_RETRY_LOG || [];
	assert.equal(log.filter((entry) => entry.event === "attempt").length, 4);
	assert.equal(log.filter((entry) => entry.event === "backoff").length, 3);
	assert.ok(
		log.filter((entry) => entry.event === "backoff").every((entry) => entry.delayMs === 20000),
		"20 seconds before every retry"
	);
	assert.equal(w.__VIDEO_PROJECTS[0].seoSets.length, 1, "the plan reached the walkthrough");
});

test("a plan that never works spends exactly 30 retries and then reports", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	editor(w);
	const calls = capturePlan(w, () => json({ success: false, error: "SEO plan failed" }, 503));

	await w.generateScript(1);

	assert.equal(calls.length, 31, "one initial attempt plus 30 retries");
	const log = w.__SEO_PLAN_RETRY_LOG || [];
	assert.equal(log.filter((entry) => entry.event === "backoff").length, 30);
	assert.equal(log.filter((entry) => entry.event === "budget-exhausted").length, 1);
	const status = w.document.getElementById("va-script-status-1").textContent;
	assert.match(status, /SEO plan failed/);
});

test("a verdict (a 4xx that can never change) is not retried 30 times", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	editor(w);
	const calls = capturePlan(w, () => json({ success: false, error: "topic is required" }, 400));

	await w.generateScript(1);

	assert.equal(calls.length, 1, "a rejected request stops immediately");
	const log = w.__SEO_PLAN_RETRY_LOG || [];
	assert.equal(log.filter((entry) => entry.event === "verdict").length, 1);
	assert.equal(log.filter((entry) => entry.event === "backoff").length, 0);
	assert.equal(w.document.getElementById("seo-wt-loading-1").style.display, "none");
	assert.equal(w.document.getElementById("seo-wt-retry-plan-1").style.display, "");
});

test("429 and 5xx are worth another attempt", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	editor(w);
	const calls = capturePlan(w, (attempt) =>
		attempt === 1 ? json({ success: false, error: "rate limited" }, 429) : json({ success: true, sets: [plan] })
	);

	await w.generateScript(1);

	assert.equal(calls.length, 2, "429 is retried");
	assert.equal(w.__VIDEO_PROJECTS[0].seoSets.length, 1);
});

for (const stalledPhase of ["fetch", "response body"]) {
	test(`a stalled SEO ${stalledPhase} is aborted and retried instead of freezing the walkthrough`, async (t) => {
		const { w } = harness();
		t.after(() => w.close());
		editor(w);
		w.__SEO_PLAN_RETRY_TIMING.requestTimeoutMs = 25;
		let stalledSignal;
		let modalProgress;
		const calls = capturePlan(w, (attempt, init) => {
			if (attempt === 1) {
				stalledSignal = init.signal;
				const stalled = new Promise(() => {});
				return stalledPhase === "fetch" ? stalled : { ok: true, json: () => stalled };
			}
			modalProgress = w.document.getElementById("seo-wt-plan-status-1").textContent;
			return json({ success: true, sets: [plan] });
		});

		await w.generateScript(1);

		assert.equal(calls.length, 2);
		assert.equal(stalledSignal.aborted, true);
		assert.match(modalProgress, /attempt 2 of 31/);
		assert.match(w.__SEO_PLAN_RETRY_LOG.find((entry) => entry.event === "attempt-failed").reason, /timed out/);
		assert.equal(w.__VIDEO_PROJECTS[0].seoSets.length, 1);
		assert.equal(w.__VIDEO_PROJECTS[0]._seoPlanController, null);
	});
}

test("deleting a video cancels its pending SEO request without retrying", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	editor(w);
	let signal;
	const calls = capturePlan(w, (_attempt, init) => {
		signal = init.signal;
		return new Promise(() => {});
	});
	const planning = w.generateScript(1);
	w.deleteVideoAccordion(1);
	await planning;
	assert.equal(signal.aborted, true);
	assert.equal(calls.length, 1);
	assert.ok(!w.__SEO_PLAN_RETRY_LOG.some((entry) => entry.event === "backoff"));
});

test("the editor shows one Worker-validated keyword set and lets the user accept it", async (t) => {
	const { handleSeoPlanGeneration } = await import("../src/modules/script-seo.ts");
	const { w } = harness();
	t.after(() => w.close());
	editor(w);
	let modelCalls = 0;
	const calls = capturePlan(w, (_attempt, init) => handleSeoPlanGeneration(
		new Request("https://studio.test/api/seo-plan", init),
		{ AI: { run: async () => { modelCalls++; return { response: plan }; } } },
		"mock-instruct"
	));

	await w.generateScript(1);

	assert.equal(calls.length, 1);
	assert.equal(modelCalls, 1);
	const cards = w.document.querySelectorAll("#seo-wt-sets-list-1 .seo-wt-card");
	assert.equal(cards.length, 1);
	assert.match(cards[0].textContent, /Use this keyword set/);
	w.selectSeoKeywordSet(1);
	assert.equal(w.__VIDEO_PROJECTS[0].selectedSeoSet.longTail, plan.longTail);
	assert.equal(w.document.getElementById("seo-wt-style-1").style.display, "");
});

test("the editor shows only the first set from a legacy relay response", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	editor(w);
	capturePlan(w, () => json({ success: true, sets: [plan, { ...plan, title: "Alternative Yoga" }] }));

	await w.generateScript(1);

	assert.equal(w.__VIDEO_PROJECTS[0].seoSets.length, 1);
	assert.equal(w.document.querySelectorAll("#seo-wt-sets-list-1 .seo-wt-card").length, 1);
	assert.doesNotMatch(w.document.getElementById("seo-wt-sets-list-1").textContent, /Alternative Yoga/);
});
