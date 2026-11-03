/*
 * SLOW-PIPELINE REGRESSIONS (session 277) — the latency half of the script
 * audit, including the latency the previous session's fixes introduced.
 *
 * The hang pass (session 276) bought safety with budget checks and extra
 * authoritative reads. That is the right trade, but three slow-path defects
 * were still there, and one of them was NEW:
 *
 *  S1  the retry ladder (3 x 45 s + 3 x 90 s = 405 s) never fit the run's
 *      promise (240 s), so the last attempts were started with less budget than
 *      they could use and were cut off mid-flight — a paid inference whose
 *      answer was thrown away, and a generic "exceeded its budget" instead of a
 *      real verdict. Measured: attempt 2 of a 600 ms run began with 251 ms left.
 *  S2  every attempt left a heartbeat write in the ordered chain, so the
 *      TERMINAL write waited for all of them: 9 serial KV writes for a
 *      6-attempt run, `done` landing 9 x the store's latency late.
 *  S3  (NEW in session 276) the new KV budget turned a slow-but-healthy store
 *      into `null`, i.e. "no note", which the read route reported as
 *      `404 { state:"empty", terminal:true }`. A healthy run was declared dead.
 *  S4  a deep queue still handed out a 202 for a job whose estimate exceeded its
 *      own budget, so the caller polled for seconds (minutes at production
 *      scale) to be told it never ran.
 *
 * Every assertion below is a measured number, not a shape.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
import {
	clearScriptNoteMemory,
	emptyScriptNote,
	noteRunStart,
	scriptNoteId,
	writeScriptNote
} from "../src/modules/script-notes.ts";
import {
	estimateQueueWaitMs,
	handleScriptNoteRead,
	submitAsyncScriptJob
} from "../src/modules/script-notes-api.ts";
import { ScriptEventLoop } from "../src/modules/script-event-loop.ts";
import {
	handleSeoScriptGeneration,
	SCRIPT_MIN_ATTEMPT_MS,
	SEO_PLAN_AI_TIMEOUT_MS,
	SEO_SCRIPT_AI_TIMEOUT_MS
} from "../src/modules/script-seo.ts";

/* ------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

const plan = {
	title: "Yoga for a Calmer Morning",
	headings: ["Start with Yoga", "Find Your Balance"],
	longTail: "morning yoga poses for beginners in a small home studio",
	short: ["yoga", "breathing", "stretching", "balance"]
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

const isPlanner = (input) => String(input.prompt || "").includes("SEO strategist");

/*
 * A model whose calls take `ms`, records every call it STARTED, and can be told
 * to fail the first `failPlanner` / `failWriter` attempts.
 */
function slowModel({ ms = 0, failPlanner = 0, failWriter = 0 } = {}) {
	const calls = [];
	const model = {
		calls,
		async run(_model, input) {
			const planner = isPlanner(input);
			const record = { kind: planner ? "planner" : "writer", startMs: Date.now() };
			calls.push(record);
			await new Promise((resolve) => setTimeout(resolve, ms));
			record.endMs = Date.now();
			if (planner) {
				const seen = calls.filter((call) => call.kind === "planner").length;
				if (seen <= failPlanner) throw new Error("planner upstream 429");
				return { response: JSON.stringify(plan) };
			}
			const seen = calls.filter((call) => call.kind === "writer").length;
			if (seen <= failWriter) return { response: "this is not an SRT at all" };
			return { response: makeSrt() };
		}
	};
	return model;
}

function request(body = {}) {
	return new Request("https://studio.test/api/script", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ topic: "Morning yoga", minutes: 1, speed: "medium", ...body })
	});
}

/* A KV that records every write and can be made slow. */
function tracingKv(ms = 0) {
	const store = new Map();
	const ops = { get: 0, put: 0, delete: 0 };
	const puts = [];
	const kv = {
		store,
		ops,
		puts,
		async get(key) {
			ops.get++;
			if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
			return store.has(key) ? store.get(key) : null;
		},
		async put(key, value) {
			ops.put++;
			const record = { startMs: Date.now(), state: JSON.parse(String(value)).state };
			puts.push(record);
			if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
			store.set(key, String(value));
			record.endMs = Date.now();
		},
		async delete(key) {
			ops.delete++;
			store.delete(key);
		}
	};
	return kv;
}

/* ------------------------------------------------------------------------- */
/* S1 — no attempt is started that the run cannot afford                      */
/* ------------------------------------------------------------------------- */

test("S1: a run stops starting attempts when the remaining budget cannot finish one", async () => {
	clearScriptNoteMemory();
	const model = slowModel({ ms: 120, failPlanner: 2 });
	const env = { AI: { run: model.run } };
	const startedAt = Date.now();

	/*
	 * 400 ms of budget, 5 s minimum per attempt (the production constant), and
	 * a deliberately small minimum so the SLOT logic is what is under test: the
	 * first attempt is allowed (its 45 s ceiling is clamped to ~400 ms), the
	 * retry is not (nothing left that can finish inside the run).
	 */
	const response = await handleSeoScriptGeneration(
		request(),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct",
		null,
		{
			useNotes: false,
			deadlineAtMs: Date.now() + 400,
			planAttemptTimeoutMs: 300,
			writeAttemptTimeoutMs: 300
		}
	);
	const body = await response.json();
	const elapsed = Date.now() - startedAt;

	/* Budget < SCRIPT_MIN_ATTEMPT_MS, so not even the first attempt may start. */
	assert.equal(model.calls.length, 0, "no inference was paid for a run with no usable budget");
	assert.equal(response.status, 500);
	assert.match(String(body.error), /run budget was exhausted/);
	assert.ok(elapsed < 250, `the verdict came immediately, not at the deadline (${elapsed} ms)`);
});

test("S1: the last affordable attempt is clamped to the remaining budget, never to the full ceiling", async () => {
	clearScriptNoteMemory();
	/* The planner never answers: only the clamped attempt timeout can end it. */
	const calls = [];
	const env = {
		AI: {
			run: async (_model, input) => {
				calls.push({ kind: isPlanner(input) ? "planner" : "writer", at: Date.now() });
				return new Promise(() => {});
			}
		}
	};
	const startedAt = Date.now();
	const budgetMs = SCRIPT_MIN_ATTEMPT_MS + 700;

	const response = await handleSeoScriptGeneration(
		request(),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct",
		null,
		{ useNotes: false, deadlineAtMs: Date.now() + budgetMs }
	);
	const body = await response.json();
	const elapsed = Date.now() - startedAt;

	assert.equal(calls.length, 1, "exactly one attempt: the second has no budget left to start");
	assert.equal(calls[0].kind, "planner");
	assert.equal(response.status, 500);
	/*
	 * The attempt died at its CLAMPED timeout (the remaining budget), not at the
	 * 45 s planner ceiling, so the run answered inside its own promise: the
	 * elapsed time is the measurement, and it is bounded by the budget.
	 */
	assert.ok(
		elapsed >= budgetMs - 60 && elapsed <= budgetMs + 900,
		`the attempt was clamped to the remaining budget (took ${elapsed} ms of ${budgetMs} ms)`
	);
	/* And the second attempt was refused rather than started with nothing left,
	 * which is the difference between a real verdict and an abort. */
	assert.match(String(body.error), /run budget was exhausted/);
	assert.ok(
		elapsed < SEO_PLAN_AI_TIMEOUT_MS / 4,
		"the run never waited for the 45 s planner ceiling"
	);
});

test("S1: the async route hands the pipeline the ticket's deadline", async () => {
	clearScriptNoteMemory();
	const model = slowModel({ ms: 30 });
	const env = { AI: { run: model.run } };
	const loop = new ScriptEventLoop({ concurrency: 1 });
	const startedAt = Date.now();

	const ticketResponse = await submitAsyncScriptJob(
		new Request("https://studio.test/api/script?async=1", {
			method: "POST",
			body: JSON.stringify({ topic: "Morning yoga", minutes: 1, speed: "medium" })
		}),
		env,
		"mock-instruct",
		{ loop, waitUntil: () => {}, jobDeadlineMs: 1200, onValidated: async () => {} }
	);
	const ticket = await ticketResponse.json();

	/* A jobDeadlineMs under one attempt is refused UP FRONT now, not after the
	 * model has been paid for: the note is terminal, no model call happened. */
	await new Promise((resolve) => setTimeout(resolve, 250));
	const note = await (
		await handleScriptNoteRead(ticket.noteId, env, new URL("https://studio.test" + ticket.noteUrl), {
			queueGraceMs: 90000,
			deadlineMs: 1200
		})
	).json();

	assert.equal(note.terminal, true);
	assert.match(String(note.error), /run budget was exhausted|budget/);
	assert.equal(model.calls.length, 0, "no inference for a run that could not finish an attempt");
	assert.ok(Date.now() - startedAt < 1000, "the caller learns the truth without waiting for the deadline");
	loop.close();
});

/* ------------------------------------------------------------------------- */
/* S2 — heartbeats are coalesced, so the terminal write is not queued behind  */
/*        six dead ones                                                       */
/* ------------------------------------------------------------------------- */

test("S2: a six-attempt run writes a bounded number of notes and publishes `done` promptly", async () => {
	clearScriptNoteMemory();
	const kv = tracingKv(40);
	/* Two planner failures + two writer failures = six paid attempts. */
	const model = slowModel({ ms: 2, failPlanner: 2, failWriter: 2 });
	const env = { AI: { run: model.run }, KV_BINDING: kv };
	const loop = new ScriptEventLoop({ concurrency: 1 });

	const ticketResponse = await submitAsyncScriptJob(
		new Request("https://studio.test/api/script?async=1", {
			method: "POST",
			body: JSON.stringify({ topic: "Morning yoga", minutes: 1, speed: "medium" })
		}),
		env,
		"mock-instruct",
		{ loop, waitUntil: () => {}, jobDeadlineMs: 30000, onValidated: async () => {} }
	);
	const ticket = await ticketResponse.json();

	let note = null;
	for (let i = 0; i < 400; i++) {
		note = await (
			await handleScriptNoteRead(ticket.noteId, env, new URL("https://studio.test" + ticket.noteUrl), {
				queueGraceMs: 90000,
				deadlineMs: 30000
			})
		).json();
		if (note.terminal) break;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	/* The isolate cache reports `done` the moment the write is queued, so give
	 * the KV write itself time to land before measuring it. */
	for (let i = 0; i < 100; i++) {
		if (kv.puts.every((put) => put.endMs)) break;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}

	assert.equal(note.state, "done");
	assert.equal(note.terminal, true);
	assert.equal(note.errorCode, null, "a done note carries no failure code");

	/* Six attempts used to mean 3 + 6 = 9 writes; coalescing bounds it. */
	assert.ok(
		kv.ops.put <= 6,
		`a 6-attempt run must not write the note once per attempt (wrote ${kv.ops.put})`
	);
	assert.ok(kv.ops.put >= 3, "the run still records queued, active and terminal");

	/* The verdict reached the store, and it is the one the client is told. */
	const done = kv.puts.filter((put) => put.state === "done");
	assert.equal(done.length, 1, "exactly one terminal write");
	assert.equal(kv.puts[kv.puts.length - 1].state, "done", "the terminal write is the last one");

	/*
	 * And the terminal write did not queue behind six dead beats: at 40 ms per
	 * write, the old chain needed 9 x 40 = 360 ms after the script was ready.
	 */
	const lastWriteEnd = kv.puts[kv.puts.length - 1].endMs;
	const scriptReadyAt = model.calls[model.calls.length - 1].endMs;
	assert.ok(
		lastWriteEnd - scriptReadyAt < 250,
		`\`done\` was published within one or two writes of the script (${lastWriteEnd - scriptReadyAt} ms)`
	);
	loop.close();
});

/* ------------------------------------------------------------------------- */
/* S3 — a slow store is "unknown", never "empty"                              */
/* ------------------------------------------------------------------------- */

test("S3: a note store that misses its budget answers 503 retryable, not a terminal 404", async () => {
	clearScriptNoteMemory();
	const store = new Map();
	const slowKv = {
		async get(key) {
			await new Promise((resolve) => setTimeout(resolve, 2600));
			return store.has(key) ? store.get(key) : null;
		},
		async put(key, value) {
			await new Promise((resolve) => setTimeout(resolve, 2600));
			store.set(key, String(value));
		},
		async delete(key) {
			store.delete(key);
		}
	};
	const env = { KV_BINDING: slowKv };

	/* A healthy run is in flight: the note exists, the store is just slow. */
	const id = scriptNoteId({ topic: "Slow store", minutes: 1, speed: "medium" });
	const note = emptyScriptNote({ id, topic: "Slow store", minutes: 1, speed: "medium" });
	noteRunStart(note, "writing");
	store.set("script-note:" + id, JSON.stringify(note));

	const response = await handleScriptNoteRead(
		id,
		env,
		new URL("https://studio.test/api/script/notes/" + id),
		{ queueGraceMs: 90000, deadlineMs: 240000 }
	);
	const body = await response.json();

	assert.equal(response.status, 503);
	assert.notEqual(response.status, 404);
	assert.equal(body.terminal, false, "an unknown note is not a finished one");
	assert.equal(body.pending, true);
	assert.equal(body.code, "SCRIPT_NOTE_STORE_BUSY");
	assert.equal(body.retryable, true);
	assert.ok(Number(body.retryAfterMs) > 0, "the client is told how soon to come back");

	/* It also never reports the note as missing: `state` is absent, so the
	 * client's "terminal && state" branches cannot fire. */
	assert.equal(body.state, undefined);
});

test("S3: submitting against a store that misses its budget refuses instead of overwriting the note", async () => {
	clearScriptNoteMemory();
	const store = new Map();
	const unreadable = {
		async get() {
			return new Promise(() => {});
		},
		async put(key, value) {
			store.set(key, String(value));
		},
		async delete(key) {
			store.delete(key);
		}
	};
	/* A warm note with the keyword set that makes the NEXT run cheap. */
	const id = scriptNoteId({ topic: "Morning yoga", minutes: 1, speed: "medium" });
	const warm = emptyScriptNote({ id, topic: "Morning yoga", minutes: 1, speed: "medium" });
	warm.keywordSet = { ...plan, shorts: plan.short, titleMatchedShorts: [], headingMatchedShorts: [] };
	store.set("script-note:" + id, JSON.stringify(warm));

	const loop = new ScriptEventLoop({ concurrency: 2 });
	const response = await submitAsyncScriptJob(
		new Request("https://studio.test/api/script?async=1", {
			method: "POST",
			body: JSON.stringify({ topic: "Morning yoga", minutes: 1, speed: "medium" })
		}),
		{ KV_BINDING: unreadable, AI: { run: async () => ({ response: "{}" }) } },
		"mock-instruct",
		{ loop, waitUntil: () => {}, jobDeadlineMs: 30000 }
	);
	const body = await response.json();
	assert.equal(response.status, 503);
	assert.equal(body.code, "SCRIPT_NOTE_STORE_BUSY");
	assert.equal(store.get("script-note:" + id), JSON.stringify(warm), "the warm note was not clobbered");
	assert.equal(loop.stats().queued, 0, "no job was scheduled for a run that was refused");
	loop.close();
});

/* ------------------------------------------------------------------------- */
/* S4 — a ticket is only issued when the queue can honour it                  */
/* ------------------------------------------------------------------------- */

test("S4: the queue estimate is arithmetic on the loop's own numbers", () => {
	assert.equal(estimateQueueWaitMs({ queued: 0, concurrency: 2, avgRunMs: 60000 }), 0);
	/* 1 waiting + this one, 2 lanes -> one run of wait. */
	assert.equal(estimateQueueWaitMs({ queued: 1, concurrency: 2, avgRunMs: 60000 }), 60000);
	/* 3 waiting + this one, 2 lanes -> two runs. */
	assert.equal(estimateQueueWaitMs({ queued: 3, concurrency: 2, avgRunMs: 60000 }), 120000);
	/* No samples yet: the cold-start estimate is used, not "0 ms". One job
	 * ahead of you on a single lane is two runs of wait (that job, then yours). */
	assert.equal(estimateQueueWaitMs({ queued: 1, concurrency: 1 }), 120000);
	assert.ok(estimateQueueWaitMs({ queued: 1, concurrency: 1 }) > 0);
	/* The loop's EWMA feeds it. */
	const loop = new ScriptEventLoop({ concurrency: 2 });
	assert.equal(loop.stats().avgRunMs, 0);
});

test("S4: a job refused by the queue estimate never reaches the model", async () => {
	clearScriptNoteMemory();
	const loop = new ScriptEventLoop({ concurrency: 1, maxQueue: 24 });
	let modelCalls = 0;
	const env = { AI: { run: async () => { modelCalls++; return { response: "{}" }; } } };

	/* Three long jobs ahead: the estimate is 3 runs x the cold-start guess. */
	const blockers = [0, 1, 2].map((index) =>
		loop.schedule(() => new Promise((resolve) => setTimeout(resolve, 400)), {
			id: "blocker-" + index,
			deadlineMs: 30000
		})
	);
	await new Promise((resolve) => setTimeout(resolve, 20));

	const startedAt = Date.now();
	const response = await submitAsyncScriptJob(
		new Request("https://studio.test/api/script?async=1", {
			method: "POST",
			body: JSON.stringify({ topic: "Behind three" })
		}),
		env,
		"mock-instruct",
		{ loop, jobDeadlineMs: 1200 }
	);
	const elapsed = Date.now() - startedAt;
	const body = await response.json();

	/* No waitUntil: the honest answer is 503, immediately. */
	assert.equal(response.status, 503);
	assert.equal(body.kind, "overload");
	assert.ok(elapsed < 300, `the refusal is immediate, not a 202 that fails later (${elapsed} ms)`);
	assert.equal(modelCalls, 0, "no inference was paid for a refused job");
	const after = loop.stats();
	assert.equal(after.queued, 2, "the refused job never entered the queue (one blocker is active)");
	assert.equal(after.active, 1);
	assert.equal(after.started, 1, "only the blocker ever started");

	const note = await (
		await handleScriptNoteRead(body.noteId, env, new URL("https://studio.test" + body.noteUrl), {
			deadlineMs: 240000
		})
	).json();
	assert.equal(note.terminal, true, "the note is closed, never left queued");
	assert.equal(note.errorCode, "SCRIPT_QUEUE_ETA_EXCEEDED");

	await Promise.all(blockers);
	loop.close();
});

/* ------------------------------------------------------------------------- */
/* S3 (client half) — a busy store counts as a failed poll                    */
/* ------------------------------------------------------------------------- */

const json = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function makeApp() {
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	const w = dom.window;
	w.alert = () => {};
	w.confirm = () => true;
	w.scrollTo = () => {};
	w.URL.createObjectURL = () => "blob=" + Math.random().toString(36).slice(2);
	w.URL.revokeObjectURL = () => {};
	w.__PLAN_MODE = "freemium";
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	return { dom, w };
}

test("S3 client: three busy-store polls end the flow as retryable, and never as a note state", async (t) => {
	const { dom, w } = makeApp();
	t.after(() => dom.window.close());

	let polls = 0;
	w.fetch = async (input) => {
		const url = String(input);
		if (url === "/api/pipeline-capabilities") {
			return json({ version: 261, scriptNotes: 1, asyncScript: 1, noteRepair: 1 });
		}
		if (url.indexOf("/api/script/notes/") === 0) {
			polls++;
			/* The worker's busy-store answer: no state, not terminal. */
			return json(
				{
					success: false,
					error: "The script note store is busy - the job may still be running",
					code: "SCRIPT_NOTE_STORE_BUSY",
					retryable: true,
					pending: true,
					terminal: false,
					retryAfterMs: 900
				},
				503
			);
		}
		if (url.indexOf("/api/script") === 0) {
			return json(
				{
					success: true,
					pending: true,
					noteId: "nt-busy",
					noteUrl: "/api/script/notes/nt-busy",
					pollAfterMs: 5,
					state: "queued"
				},
				202
			);
		}
		return json({ success: false, error: "unexpected " + url }, 404);
	};

	w.addVideoAccordion();
	const startedAt = Date.now();
	const ok = await w.runSeoScriptRequest(1, "morning yoga", 1, "medium");
	const elapsed = Date.now() - startedAt;

	assert.equal(ok, false, "a store that cannot be read does not produce a script");
	/* Session 279: three failed polls for the ONE request the page makes - and
	 * it does not treat the 503 as proof of life, so it never sits through the
	 * 15 s stall guard. (It used to be 3 polls x 3 browser attempts = 9.) */
	assert.equal(polls, 3, "the single request gives up after three busy polls");
	assert.ok(elapsed < 12000, `the flow ends on failed polls, not on the stall guard (${elapsed} ms)`);
	assert.equal(w.__VIDEO_PROJECTS[0].script || "", "", "no script was invented");
	assert.match(w.document.getElementById("va-script-status-1").textContent, /Script failed:/);
});
