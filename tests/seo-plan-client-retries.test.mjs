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
			return reply(calls.length);
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
			: json({ success: true, sets: [plan, { ...plan, longTail: "gentle morning yoga routine at home", short: ["morning yoga", "gentle stretch", "home practice", "yoga routine"] }] })
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
	assert.equal(w.__VIDEO_PROJECTS[0].seoSets.length, 2, "the plan reached the walkthrough");
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
