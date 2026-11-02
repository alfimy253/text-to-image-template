/*
 * WHO OWNS A SCRIPT RETRY? THE BROWSER (session 278).
 *
 * The pipeline used to retry for the caller: up to 3 planner attempts and 3
 * writer attempts inside ONE request, while the page ALSO retried the whole
 * request 3 times. One click could therefore cost ~27 paid inferences, and the
 * worker's 405 s ladder could not fit the 240 s the note layer promised.
 *
 * The contract guarded here:
 *
 *  W1  `browserRetries: true` => exactly ONE planner inference and ONE writer
 *      inference per request, and a 500 that names the stage it failed in;
 *  W2  a request without the flag keeps the legacy 3+3 ladder (old clients are
 *      untouched) - measured as inference counts, not as shapes;
 *  W3  a writer-stage failure hands the validated `keywordSet` back, so the
 *      next attempt skips the planner entirely (the resume point);
 *  W4  attempt 1+ rotates the model slug, so a browser retry is not a replay;
 *  W5  a configuration failure (no AI binding) is `retryable: false`, so the
 *      page does not burn its three attempts on something no retry can fix;
 *  W6  the capabilities advertise `browserScriptRetries` + `scriptRetryOwner`,
 *      which is what makes the page send the flag at all;
 *  B1  the page's own loop makes exactly 3 attempts and stops (no 4th), and
 *  B2  it sends `browserRetries`, `previousFailure` and the resumed
 *      `keywordSet` on the retries - against the real APP_JS, not a copy.
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

test("a legacy request (no flag) keeps the three planner attempts", async () => {
	clearScriptNoteMemory();
	const { env, calls } = aiWith([new Error("AiError 3043: Internal server error")]);
	const response = await run(env, { topic: "Morning yoga", minutes: 1, speed: "medium" });
	assert.equal(response.status, 500);
	assert.equal(calls.length, 3, "an old client still gets the worker's ladder");

	const data = await response.json();
	assert.equal(data.failure.attempts, 3);
	assert.equal(data.failure.stage, "planner");
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

test("capabilities advertise the browser as the retry owner", async () => {
	const workerModule = await import("../src/index.ts");
	const worker = workerModule.default || workerModule;
	const response = await worker.fetch(
		new Request("https://studio.test/api/pipeline-capabilities"),
		{},
		{}
	);
	assert.equal(response.status, 200);
	const caps = await response.json();
	assert.equal(caps.scriptRetryOwner, "browser");
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
/* B1 + B2: the page's own attempt loop                                       */
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
			/* Only the retry contract is advertised: the direct path is used. */
			return json({ version: 261, browserScriptRetries: 3, scriptRetryOwner: "browser" });
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

test("the page makes three attempts and then stops", async (t) => {
	const { w } = harness();
	t.after(() => w.close());

	const failure = {
		body: {
			success: false,
			error: "Script output invalid (too short) - try again",
			retryable: true,
			failure: { stage: "writer", reason: "too short", attempts: 1, retryable: true }
		},
		status: 500
	};
	const requests = await walkthrough(w, [failure]);
	await w.confirmSeoStyleAndGenerate(1);

	assert.equal(requests.length, 3, "SCRIPT_RETRY_LIMIT + 1 attempts, never a fourth");
	for (const request of requests) {
		assert.equal(request.body.browserRetries, true, "every attempt declares the contract");
	}
	assert.equal(requests[0].body.previousFailure, "");
	assert.match(requests[1].body.previousFailure, /too short/, "the failure is fed forward");
	assert.match(requests[2].body.previousFailure, /too short/);
});

test("the page resumes from the plan the worker handed back", async (t) => {
	const { w } = harness();
	t.after(() => w.close());

	const firstFailure = {
		body: {
			success: false,
			error: "Script output invalid (too short) - try again",
			retryable: true,
			failure: { stage: "writer", reason: "too short", attempts: 1, retryable: true },
			/* The plan attempt 1 already paid for. */
			keywordSet: { title: otherPlan.title, headings: otherPlan.headings, longTail: otherPlan.longTail, short: otherPlan.short }
		},
		status: 500
	};
	const success = {
		body: {
			success: true,
			script: sentences.join(" "),
			durationMs: 60000,
			title: otherPlan.title,
			headings: otherPlan.headings,
			keywords: {
				longTail: { keyword: otherPlan.longTail, count: 1, min: 1, max: null },
				short: otherPlan.short.map((keyword) => ({ keyword, count: 2, min: 2, max: null }))
			}
		},
		status: 200
	};
	const requests = await walkthrough(w, [firstFailure, success]);
	await w.confirmSeoStyleAndGenerate(1);

	assert.equal(requests.length, 2, "the retry succeeded, so there is no third attempt");
	assert.equal(
		requests[0].body.keywordSet.title,
		plan.title,
		"attempt 1 sends the set the user picked in the walkthrough"
	);
	assert.deepEqual(
		requests[1].body.keywordSet,
		{ title: otherPlan.title, headings: otherPlan.headings, longTail: otherPlan.longTail, short: otherPlan.short },
		"attempt 2 replays the worker's plan instead of paying for the planner again"
	);
	assert.equal(requests[1].body.browserRetries, true);
	assert.match(requests[1].body.previousFailure, /too short/);
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

	assert.equal(requests.length, 1, "a configuration failure is not retried");
});
