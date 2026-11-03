/*
 * WHO OWNS A SCRIPT RETRY? THE WORKER (session 279).
 *
 * Session 278 moved the ladder into the page: the worker did exactly ONE
 * attempt per request and the browser looped three times. That was measured
 * (bench/pipeline-sim/results/baseline-scale1.json) as 12 submissions and 934
 * note polls for nine scripts, because every browser attempt is a fresh
 * POST /api/script?async=1, a fresh admission check against the 2-lane loop and
 * a FRESH 900 ms-quantised poll stream. Session 279 moves the ladder back: the
 * page makes one request and the worker retries inside it.
 *
 * The contract guarded here:
 *
 *  W1  `browserRetries: true` (a cached pre-278/279 page) still gets exactly
 *      ONE planner inference and ONE writer inference per request, and a 500
 *      that names the stage it failed in;
 *  W2  a request without the flag - what this page now sends - runs the
 *      worker's own ladder: three planner attempts inside ONE request;
 *  W3  a writer-stage failure still hands the validated `keywordSet` back
 *      (diagnostics, and the resume point a cached page relies on);
 *  W4  a cached page's `attempt: 1` replay rotates the model slug;
 *  W4b the WORKER's own ladder rotates the slug too, so attempt 2 inside one
 *      request is not a replay of attempt 1;
 *  W5  a configuration failure (no AI binding) is `retryable: false`, so no
 *      ladder - worker or browser - burns attempts on it;
 *  W6  the capabilities advertise `retryOwner`/`scriptRetryOwner: "worker"`
 *      plus `workerScriptRetries`, and keep `browserScriptRetries` ONLY so a
 *      cached page keeps working;
 *  W7  the async note carries the same verdict back to the browser, and
 *  W8  a note run without the flag spends the worker's three planner attempts;
 *  B1  the page makes exactly ONE request - no loop, no `browserRetries`, no
 *      `previousFailure`, no resume set - and
 *  B2  it reports the attempts the WORKER spent, against the real APP_JS.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { handleSeoScriptGeneration } from "../src/modules/script-seo.ts";
import { clearScriptNoteMemory } from "../src/modules/script-notes.ts";
import { handleScriptNoteRead, submitAsyncScriptJob } from "../src/modules/script-notes-api.ts";
import { ScriptEventLoop } from "../src/modules/script-event-loop.ts";
import { harness } from "./studio-render-harness.mjs";

const plan = {
	title: "Yoga for a Calmer Morning",
	headings: ["Start with Yoga", "Find Your Balance"],
	longTail: "morning yoga poses for beginners in a small home studio",
	short: ["yoga", "breathing", "stretching", "balance"]
};

/* A different set, so a resumed plan is distinguishable from the pick. */
const otherPlan = {
	title: "Evening Wind Down",
	headings: ["Settle Down", "Sleep Better"],
	longTail: "evening wind down routine for better sleep",
	short: ["evening", "wind down", "sleep", "calm"]
};

const sentences = [
	`Try ${plan.longTail} today.`,
	"Let breathing settle into a steady rhythm.",
	"Gentle stretching can release tension.",
	"Practice balance with a chair nearby.",
	"Keep your breathing relaxed and natural.",
	"Comfortable stretching should never hurt.",
	"Your balance improves with patient practice.",
	`Return to ${plan.longTail} tomorrow.`
];

function makeSrt(lines = sentences) {
	const stamp = (seconds) => `00:00:${String(seconds).padStart(2, "0")},000`;
	return lines
		.map((line, index) => `${index + 1}\n${stamp(index * 4)} --> ${stamp((index + 1) * 4)}\n${line}`)
		.join("\n\n");
}

/* The model is scripted: each entry is either a reply string or a throw. */
function aiWith(script, calls = []) {
	let next = 0;
	return {
		calls,
		env: {
			AI: {
				run: async (model, input) => {
					calls.push({ model, prompt: String(input.prompt || "") });
					const step = script[Math.min(next, script.length - 1)];
					next += 1;
					if (step instanceof Error) throw step;
					return { response: step };
				}
			}
		}
	};
}

function scriptRequest(body) {
	return new Request("https://studio.test/api/script", {
		method: "POST",
		body: JSON.stringify(body)
	});
}

const run = (env, body) =>
	handleSeoScriptGeneration(
		scriptRequest(body),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct",
		async () => {},
		{}
	);

/* ------------------------------------------------------------------------- */
/* W1: one request = one attempt per stage                                    */
/* ------------------------------------------------------------------------- */

test("a browser-retried request spends exactly one planner inference", async () => {
	clearScriptNoteMemory();
	const { env, calls } = aiWith([new Error("AiError 3043: Internal server error")]);
	const response = await run(env, {
		topic: "Morning yoga",
		minutes: 1,
		speed: "medium",
		browserRetries: true
	});
	assert.equal(response.status, 500);
	assert.equal(calls.length, 1, "one planner attempt, no worker-side ladder");

	const data = await response.json();
	assert.equal(data.success, false);
	assert.equal(data.retryable, true);
	assert.equal(data.failure.stage, "planner");
	assert.equal(data.failure.attempts, 1);
	assert.equal(data.failure.retryable, true);
	assert.match(data.failure.reason, /SEO keywords invalid/);
});

/* ------------------------------------------------------------------------- */
/* W2: the legacy ladder is untouched                                         */
/* ------------------------------------------------------------------------- */

test("a request without the flag runs the worker's three planner attempts", async () => {
	clearScriptNoteMemory();
	const { env, calls } = aiWith([new Error("AiError 3043: Internal server error")]);
	/* This is what the shipped page sends now: no flag, one request. */
	const response = await run(env, { topic: "Morning yoga", minutes: 1, speed: "medium" });
	assert.equal(response.status, 500);
	assert.equal(calls.length, 3, "the ladder ran inside the ONE request");

	const data = await response.json();
	assert.equal(data.failure.attempts, 3);
	assert.equal(data.failure.stage, "planner");
	assert.equal(data.retryOwner, "worker", "the verdict names the owner");
});

/* ------------------------------------------------------------------------- */
/* W4b: the worker's ladder rotates the model, so attempt 2 is not a replay    */
/* ------------------------------------------------------------------------- */

test("the worker's own writer ladder rotates the model slug on attempt 2", async () => {
	clearScriptNoteMemory();
	/* Planner ok, writer overloaded once, then a valid SRT from the fallback. */
	const { env, calls } = aiWith([JSON.stringify(plan), new Error("AiError 5001: overloaded"), makeSrt()]);
	const response = await run(env, { topic: "Morning yoga", minutes: 1, speed: "medium" });
	assert.equal(response.status, 200);
	assert.equal(calls.length, 3, "1 planner + 2 writer attempts, all in one request");

	const data = await response.json();
	assert.equal(data.success, true);
	assert.notEqual(calls[2].model, calls[1].model, "attempt 2 asked a different model");
	assert.equal(data.model, calls[2].model, "the payload names the slug that produced the script");
});

/* ------------------------------------------------------------------------- */
/* W3 + W4: the resume point and the model rotation                           */
/* ------------------------------------------------------------------------- */

test("a writer failure returns the validated plan as the resume point", async () => {
	clearScriptNoteMemory();
	const { env, calls } = aiWith([JSON.stringify(plan), new Error("AiError 5001: overloaded")]);
	const response = await run(env, {
		topic: "Morning yoga",
		minutes: 1,
		speed: "medium",
		browserRetries: true
	});
	assert.equal(response.status, 500);
	assert.equal(calls.length, 2, "1 planner + 1 writer");

	const data = await response.json();
	assert.equal(data.failure.stage, "writer");
	assert.equal(data.failure.attempts, 1);
	/* Exactly the shape the client can send straight back as `keywordSet`. */
	assert.equal(data.keywordSet.title, plan.title);
	assert.equal(data.keywordSet.longTail, plan.longTail);
	assert.deepEqual(data.keywordSet.short, plan.short);
	assert.deepEqual(data.keywordSet.headings, plan.headings);
});

test("replaying that plan with attempt 1 skips the planner and asks another model", async () => {
	clearScriptNoteMemory();
	const { env, calls } = aiWith([makeSrt()]);
	const response = await run(env, {
		topic: "Morning yoga",
		minutes: 1,
		speed: "medium",
		browserRetries: true,
		attempt: 1,
		previousFailure: "Script output invalid (too short) - try again",
		keywordSet: { title: plan.title, headings: plan.headings, longTail: plan.longTail, short: plan.short }
	});
	assert.equal(response.status, 200);
	assert.equal(calls.length, 1, "the planner is skipped: only the writer runs");
	assert.doesNotMatch(calls[0].prompt, /SEO strategist/, "no planner prompt was sent");
	assert.match(calls[0].prompt, /Previous validation failure to correct/);
	assert.notEqual(calls[0].model, "mock-instruct", "a retry is not a replay");
});

/* ------------------------------------------------------------------------- */
/* W5: a failure no retry can fix is not retryable                            */
/* ------------------------------------------------------------------------- */

test("a missing AI binding is reported as not retryable", async () => {
	clearScriptNoteMemory();
	const response = await run({}, {
		topic: "Morning yoga",
		minutes: 1,
		speed: "medium",
		browserRetries: true
	});
	assert.equal(response.status, 503, "no model to call: the worker is unavailable, not broken");
	const data = await response.json();
	assert.equal(data.retryable, false, "configuration: the page must stop");
	assert.equal(data.failure.retryable, false);
	assert.match(String(data.error), /AI binding not configured/);
});

/* ------------------------------------------------------------------------- */
/* W6: the capability the page reads to opt in                                */
/* ------------------------------------------------------------------------- */

test("capabilities advertise the worker as the retry owner, for every stage", async () => {
	const workerModule = await import("../src/index.ts");
	const worker = workerModule.default || workerModule;
	const response = await worker.fetch(
		new Request("https://studio.test/api/pipeline-capabilities"),
		{},
		{}
	);
	assert.equal(response.status, 200);
	const caps = await response.json();
	assert.equal(caps.retryOwner, "worker");
	assert.equal(caps.scriptRetryOwner, "worker");
	assert.equal(caps.workerScriptRetries, 3);
	/*
	 * Compatibility only: a cached pre-279 page reads this, sends
	 * `browserRetries: true` and keeps its own three-attempt loop. It must
	 * therefore still be advertised - and still mean "one attempt per stage".
	 */
	assert.equal(caps.browserScriptRetries, 3);
});

/* ------------------------------------------------------------------------- */
/* W7: the async note path carries the same verdict back to the browser       */
/* ------------------------------------------------------------------------- */

test("the async note records which stage failed, and the poll carries it", async () => {
	clearScriptNoteMemory();
	const { env } = aiWith([new Error("AiError 3043: Internal server error")]);
	const loop = new ScriptEventLoop({ concurrency: 1 });
	const ticketResponse = await submitAsyncScriptJob(
		new Request("https://studio.test/api/script?async=1", {
			method: "POST",
			body: JSON.stringify({
				topic: "Morning yoga",
				minutes: 1,
				speed: "medium",
				browserRetries: true
			})
		}),
		env,
		"mock-instruct",
		{ loop, waitUntil: () => {}, onValidated: async () => {} }
	);
	assert.equal(ticketResponse.status, 202);
	const ticket = await ticketResponse.json();

	await new Promise((resolve) => setTimeout(resolve, 400));
	const note = await (
		await handleScriptNoteRead(ticket.noteId, env, new URL("https://studio.test" + ticket.noteUrl))
	).json();
	loop.close();

	assert.equal(note.state, "error");
	assert.equal(note.terminal, true);
	assert.equal(
		note.failureStage,
		"planner",
		"the note says which stage failed, so the page's retry resumes correctly"
	);
	assert.match(String(note.error), /SEO keywords invalid/);
	assert.equal(note.keywords, null, "a failed plan has nothing to resume from");
});

/* ------------------------------------------------------------------------- */
/* B1 + B2: what the page does now - one request, and the worker's verdict     */
/* ------------------------------------------------------------------------- */

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

async function walkthrough(w, scriptReplies) {
	const requests = [];
	const sent = scriptReplies.slice();
	const original = w.fetch;
	w.fetch = async (input, init = {}) => {
		const url = String(input);
		const body = init && init.body ? JSON.parse(init.body) : null;
		const path = new URL(url, "https://studio.test").pathname;
		if (path === "/api/pipeline-capabilities") {
			/* The session-279 contract: the worker owns every ladder. */
			return json({
				version: 261,
				retryOwner: "worker",
				scriptRetryOwner: "worker",
				workerScriptRetries: 3,
				browserScriptRetries: 3
			});
		}
		if (path === "/api/seo-plan") return json({ success: true, sets: [plan, otherPlan] });
		if (path === "/api/script") {
			requests.push({ body });
			const reply = sent.length > 1 ? sent.shift() : sent[0];
			return typeof reply === "function" ? reply(body) : json(reply.body, reply.status);
		}
		return original(input, init);
	};

	w.addVideoAccordion();
	w.document.getElementById("va-script-topic-1").value = "morning yoga";
	w.document.getElementById("va-script-minutes-1").value = "1";
	await w.generateScript(1);
	w.selectSeoKeywordSet(1, 0);
	return requests;
}

test("the page makes exactly one request and never loops", async (t) => {
	const { w } = harness();
	t.after(() => w.close());

	const failure = {
		body: {
			success: false,
			error: "Script output invalid (too short) - try again",
			retryable: true,
			/* The worker spent its whole ladder inside this one request. */
			failure: { stage: "writer", reason: "too short", attempts: 3, retryable: true }
		},
		status: 500
	};
	const requests = await walkthrough(w, [failure]);
	await w.confirmSeoStyleAndGenerate(1);

	assert.equal(requests.length, 1, "one request: the ladder belongs to the worker");
	const body = requests[0].body;
	assert.equal(body.browserRetries, undefined, "no flag, so the worker keeps its ladder");
	assert.equal(body.attempt, 0, "the page has no attempt counter to report");
	assert.equal(body.previousFailure, "", "and no failure of its own to feed forward");

	const status = w.document.getElementById("va-script-status-1").textContent;
	assert.match(status, /Script failed:/);
	assert.match(status, /after 3 attempts/, "the user still learns it was retried: " + status);
	assert.ok(!/retrying \(/.test(status), "the page never claims to be retrying");
});

test("the page still sends the keyword set the user picked", async (t) => {
	const { w } = harness();
	t.after(() => w.close());

	const success = {
		body: {
			success: true,
			script: sentences.join(" "),
			durationMs: 60000,
			title: plan.title,
			headings: plan.headings,
			keywords: {
				longTail: { keyword: plan.longTail, count: 1, min: 1, max: null },
				short: plan.short.map((keyword) => ({ keyword, count: 2, min: 2, max: null }))
			}
		},
		status: 200
	};
	const requests = await walkthrough(w, [success]);
	await w.confirmSeoStyleAndGenerate(1);

	assert.equal(requests.length, 1);
	assert.equal(
		requests[0].body.keywordSet.title,
		plan.title,
		"a first-attempt input, not a resume point: the worker keeps the plan in scope itself"
	);
	assert.equal(w.__VIDEO_PROJECTS[0].script, sentences.join(" "), "the script landed on the project");
});

test("the page stops immediately when the worker says the failure is permanent", async (t) => {
	const { w } = harness();
	t.after(() => w.close());

	const permanent = {
		body: {
			success: false,
			error: "AI binding not configured",
			retryable: false,
			failure: { stage: "pipeline", reason: "AI binding not configured", attempts: 1, retryable: false }
		},
		status: 500
	};
	const requests = await walkthrough(w, [permanent]);
	await w.confirmSeoStyleAndGenerate(1);

	assert.equal(requests.length, 1, "a configuration failure is not retried by anybody");
	assert.match(w.document.getElementById("va-script-status-1").textContent, /AI binding not configured/);
});

/* ------------------------------------------------------------------------- */
/* W8: the note run spends the worker's ladder, not the page's                 */
/* ------------------------------------------------------------------------- */

test("an async note run without the flag spends three planner attempts", async () => {
	clearScriptNoteMemory();
	const { env, calls } = aiWith([new Error("AiError 3043: Internal server error")]);
	const loop = new ScriptEventLoop({ concurrency: 1 });
	const ticketResponse = await submitAsyncScriptJob(
		new Request("https://studio.test/api/script?async=1", {
			method: "POST",
			body: JSON.stringify({ topic: "Morning yoga", minutes: 1, speed: "medium" })
		}),
		env,
		"mock-instruct",
		{ loop, waitUntil: () => {}, onValidated: async () => {} }
	);
	assert.equal(ticketResponse.status, 202);
	const ticket = await ticketResponse.json();

	await new Promise((resolve) => setTimeout(resolve, 500));
	const note = await (
		await handleScriptNoteRead(ticket.noteId, env, new URL("https://studio.test" + ticket.noteUrl))
	).json();
	loop.close();

	assert.equal(note.state, "error");
	assert.equal(note.terminal, true);
	assert.equal(calls.length, 3, "one submission, three planner attempts - all inside the note run");
	assert.equal(note.failureStage, "planner");
});
