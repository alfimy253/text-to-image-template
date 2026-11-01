/*
 * HANG REGRESSIONS for the note / event-loop / async-script rewrite.
 *
 * The rewrite made a slow script fast by turning one long response into a
 * ticket plus a note. That opened four ways to hang, plus one layout that had
 * no note path at all. Each is pinned here (see current_code_latest.md §2b):
 *
 *  H1  a full event-loop queue produced a 202 for work nobody would run
 *  H2  a note abandoned mid-run answered "pending" forever
 *  H3  a note that ended in a terminal state other than done/error was ignored
 *      by the client, which polled it forever
 *  H4  the client had no stall guard and no wall-clock ceiling
 *  H5  the table layout had no note path, so the fix only reached one layout
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
import workerModule from "../src/index.ts";
import {
	emptyScriptNote,
	noteRunStart,
	readScriptNote,
	scriptNoteId,
	SCRIPT_NOTE_DEADLINE_MS,
	SCRIPT_NOTE_QUEUE_GRACE_MS,
	writeScriptNote
} from "../src/modules/script-notes.ts";
import {
	handleScriptNoteRead,
	submitAsyncScriptJob
} from "../src/modules/script-notes-api.ts";
import { ScriptEventLoop } from "../src/modules/script-event-loop.ts";

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
	return lines
		.map((line, index) => {
			const stamp = (seconds) => `00:00:${String(seconds).padStart(2, "0")},000`;
			return `${index + 1}\n${stamp(index * 4)} --> ${stamp((index + 1) * 4)}\n${line}`;
		})
		.join("\n\n");
}

function envWith(responses, calls = []) {
	let next = 0;
	return {
		calls,
		env: {
			AI: {
				run: async (model, input) => {
					calls.push({ model, prompt: input.prompt });
					const reply = responses[Math.min(next++, responses.length - 1)];
					if (reply instanceof Error) throw reply;
					return { response: reply };
				}
			}
		}
	};
}

function asyncRequest(body) {
	return new Request("https://studio.test/api/script?async=1", {
		method: "POST",
		body: JSON.stringify(body)
	});
}

/* ------------------------------------------------------------------------- */
/* H1 — a full queue must not hand out a ticket for work that cannot run      */
/* ------------------------------------------------------------------------- */

test("H1: a full event-loop queue answers 503 with a terminal note, never a 202", async () => {
	const loop = new ScriptEventLoop({ concurrency: 1, maxQueue: 1 });
	const { env, calls } = envWith([JSON.stringify(plan), makeSrt()]);

	let release = null;
	const blocker = loop.schedule(
		() => new Promise((resolve) => { release = resolve; }),
		{ id: "blocker" }
	);
	blocker.catch(() => {});
	/* one active + one waiting == the cap */
	const waiting = loop.schedule(() => new Promise(() => {}), { id: "waiting" });
	waiting.catch(() => {});
	assert.equal(loop.stats().queued >= loop.maxQueue, true, "the queue is full");

	const response = await submitAsyncScriptJob(
		asyncRequest({ topic: "Morning yoga", minutes: 1, speed: "medium" }),
		env,
		"mock-instruct",
		{ loop }
	);

	assert.equal(response.status, 503, "no false 202 for work that will not run");
	const body = await response.json();
	assert.equal(body.success, false);
	assert.equal(body.kind, "overload");
	assert.ok(Number(body.retryAfterMs) > 0, "the client is told how long to wait");
	assert.equal(calls.length, 0, "no model call was started");

	/* the note the ticket would have pointed at is closed, not stuck queued */
	const note = await readScriptNote(env, body.noteId);
	assert.equal(note.state, "error");
	assert.equal(note.errorCode, "SCRIPT_LOOP_QUEUE_FULL");

	const poll = await handleScriptNoteRead(body.noteId, env, new URL("https://studio.test" + body.noteUrl));
	const polled = await poll.json();
	assert.equal(poll.status, 200);
	assert.equal(polled.terminal, true);
	assert.equal(polled.pending, false);

	if (release) release();
	loop.close();
});

test("H1: with waitUntil the overflowing job runs inline instead of being lost", async () => {
	const loop = new ScriptEventLoop({ concurrency: 1, maxQueue: 1 });
	const { env, calls } = envWith([JSON.stringify(plan), makeSrt()]);

	let release = null;
	const blocker = loop.schedule(
		() => new Promise((resolve) => { release = resolve; }),
		{ id: "blocker-2" }
	);
	blocker.catch(() => {});
	const waiting = loop.schedule(() => new Promise(() => {}), { id: "waiting-2" });
	waiting.catch(() => {});
	assert.equal(loop.stats().queued >= loop.maxQueue, true);

	const parked = [];
	const response = await submitAsyncScriptJob(
		asyncRequest({ topic: "Morning yoga", minutes: 1, speed: "medium" }),
		env,
		"mock-instruct",
		{ loop, waitUntil: (task) => parked.push(task) }
	);

	assert.equal(response.status, 202);
	const ticket = await response.json();
	assert.equal(ticket.mode, "inline", "the degraded mode is reported, not hidden");
	assert.ok(ticket.noteUrl);

	/* the inline job is what waitUntil holds; run it to completion */
	await Promise.all(parked);

	const poll = await handleScriptNoteRead(ticket.noteId, env, new URL("https://studio.test" + ticket.noteUrl));
	const note = await poll.json();
	assert.equal(note.state, "done", "the work still happened");
	assert.ok(note.script && note.script.length > 40);
	assert.equal(calls.length, 2, "planner + writer");

	if (release) release();
	loop.close();
});

/* ------------------------------------------------------------------------- */
/* H2 — a note abandoned by its isolate can never say "pending" forever       */
/* ------------------------------------------------------------------------- */

test("H2: a note whose runner died is closed as terminal SCRIPT_NOTE_STALE", async () => {
	const id = scriptNoteId({ topic: "Morning yoga", minutes: 1, speed: "medium" });
	const note = emptyScriptNote({ id, topic: "Morning yoga", minutes: 1, speed: "medium" });
	noteRunStart(note, "queued");
	/* the isolate died right after the ticket: nothing ever wrote again */
	note.runStartedAt = Date.now() - SCRIPT_NOTE_QUEUE_GRACE_MS - 5000;
	const env = {};
	await writeScriptNote(env, note);

	const response = await handleScriptNoteRead(id, env, new URL("https://studio.test/api/script/notes/" + id));
	const body = await response.json();

	assert.equal(response.status, 200, "a stale note is not a pending note");
	assert.equal(body.terminal, true);
	assert.equal(body.pending, false);
	assert.equal(body.state, "error");
	assert.equal(body.errorCode, "SCRIPT_NOTE_STALE");
	assert.match(String(body.error), /SCRIPT_NOTE_STALE/);

	/* and the close is persisted, so the next reader agrees */
	const after = await readScriptNote(env, id);
	assert.equal(after.state, "error");
});

test("H2: a note that is genuinely running is left alone and reports its budget", async () => {
	const id = scriptNoteId({ topic: "Evening yoga", minutes: 1, speed: "medium" });
	const note = emptyScriptNote({ id, topic: "Evening yoga", minutes: 1, speed: "medium" });
	noteRunStart(note, "queued");
	note.state = "writing";
	note.runStartedAt = Date.now() - 1000;
	note.deadlineMs = SCRIPT_NOTE_DEADLINE_MS;
	const env = {};
	await writeScriptNote(env, note);

	const response = await handleScriptNoteRead(id, env, new URL("https://studio.test/api/script/notes/" + id));
	const body = await response.json();
	assert.equal(response.status, 202);
	assert.equal(body.pending, true);
	assert.equal(body.terminal, false);
	assert.ok(Number(body.waitMs) > 0, "the client is told how long the run may still take");
});

/* ------------------------------------------------------------------------- */
/* Client harness                                                             */
/* ------------------------------------------------------------------------- */

const json = (body, status = 200) => new Response(JSON.stringify(body), {
	status,
	headers: { "Content-Type": "application/json" }
});

function makeApp() {
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	const w = dom.window;
	w.alert = () => {};
	w.confirm = () => true;
	w.scrollTo = () => {};
	w.URL.createObjectURL = () => "blob:hang-test-" + Math.random().toString(36).slice(2);
	w.URL.revokeObjectURL = () => {};
	w.__PLAN_MODE = "freemium";
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	return { dom, w };
}

const scriptText = "Try morning yoga poses for beginners today. Breathe. Stretch. Balance.";

/* ------------------------------------------------------------------------- */
/* H3 — a terminal note that is not "done" ends the flow                      */
/* ------------------------------------------------------------------------- */

test("H3: a terminal note in state empty stops the client instead of polling forever", async (t) => {
	const { dom, w } = makeApp();
	t.after(() => dom.window.close());

	let polls = 0;
	w.fetch = async (input, init = {}) => {
		const url = String(input);
		if (url === "/api/pipeline-capabilities") {
			return json({ version: 261, singleAttemptScript: true, scriptNotes: 1, asyncScript: 1, noteRepair: 1 });
		}
		if (url.indexOf("/api/script/notes/") === 0) {
			polls++;
			return json({ success: true, noteId: "nt-empty", state: "empty", terminal: true, pending: false });
		}
		if (url.indexOf("/api/script") === 0) {
			return json({ success: true, pending: true, noteId: "nt-empty", noteUrl: "/api/script/notes/nt-empty", pollAfterMs: 10, state: "queued" }, 202);
		}
		return json({ success: false, error: "unexpected " + url }, 404);
	};

	w.addVideoAccordion();
	const ok = await w.runSeoScriptRequest(1, "morning yoga", 1, "medium");

	assert.equal(ok, false, "the flow ends in failure, not in a poll loop");
	/*
	 * One read per attempt (three attempts, the documented retry budget):
	 * the note is terminal on the first read, so no attempt can loop.
	 */
	assert.equal(polls, 3, "each attempt stops after one read");
	assert.ok(polls <= 3, "no attempt polled twice");
	assert.equal(w.__VIDEO_PROJECTS[0].script || "", "", "no script was invented");
	assert.match(w.document.getElementById("va-script-status-1").textContent, /Script failed after 3 attempts/);
});

/* ------------------------------------------------------------------------- */
/* H4 — the client has a stall guard and a wall-clock ceiling                 */
/* ------------------------------------------------------------------------- */

test("H4: a note that never advances ends the flow inside the advertised budget", async (t) => {
	const { dom, w } = makeApp();
	t.after(() => dom.window.close());

	const startedAt = Date.now();
	let polls = 0;
	w.fetch = async (input) => {
		const url = String(input);
		if (url === "/api/pipeline-capabilities") {
			return json({
				version: 261,
				singleAttemptScript: true,
				scriptNotes: 1,
				asyncScript: 1,
				noteRepair: 1,
				/* a deliberately tiny budget so the test is fast */
				scriptNoteWaitMs: 400,
				scriptNoteStallMs: 150,
				scriptNotePollMs: 10
			});
		}
		if (url.indexOf("/api/script/notes/") === 0) {
			polls++;
			/* always the same state, always the same updatedAt: no progress */
			return json({
				success: true,
				noteId: "nt-stuck",
				state: "writing",
				terminal: false,
				pending: true,
				updatedAt: 1,
				runs: 1,
				waitMs: 150
			}, 202);
		}
		if (url.indexOf("/api/script") === 0) {
			return json({ success: true, pending: true, noteId: "nt-stuck", noteUrl: "/api/script/notes/nt-stuck", pollAfterMs: 10, state: "queued" }, 202);
		}
		return json({ success: false, error: "unexpected " + url }, 404);
	};

	w.addVideoAccordion();
	const ok = await w.runSeoScriptRequest(1, "morning yoga", 1, "medium");
	const elapsed = Date.now() - startedAt;

	assert.equal(ok, false);
	/* three attempts x one wall-clock ceiling each, plus backoff */
	assert.ok(elapsed < 8000, "bounded by the advertised budget, took " + elapsed + "ms");
	assert.ok(polls > 0, "the note was actually read");
	const status = w.document.getElementById("va-script-status-1").textContent;
	assert.match(status, /Script failed after 3 attempts/);
	assert.match(status, /timed out|stopped advancing/i);
});

/* ------------------------------------------------------------------------- */
/* H5 — the table layout uses the same pipeline                               */
/* ------------------------------------------------------------------------- */

test("H5: a quick-batch row writes its script through the note pipeline", async (t) => {
	const { dom, w } = makeApp();
	t.after(() => dom.window.close());

	const requests = [];
	let noteDone = false;
	w.fetch = async (input, init = {}) => {
		const url = String(input);
		const body = init.body ? JSON.parse(init.body) : null;
		if (url === "/api/pipeline-capabilities") {
			return json({ version: 261, singleAttemptScript: true, scriptNotes: 1, asyncScript: 1, noteRepair: 1, scriptNotePollMs: 10 });
		}
		if (url === "/api/script/notes/nt-row") {
			if (!noteDone) {
				noteDone = true;
				return json({ success: true, noteId: "nt-row", state: "planning", terminal: false, pending: true, updatedAt: 1 }, 202);
			}
			return json({
				success: true,
				noteId: "nt-row",
				state: "done",
				terminal: true,
				pending: false,
				script: scriptText,
				durationMs: 60000,
				keywords: { title: plan.title, headings: plan.headings },
				outline: [{ heading: "Start with Yoga", beat: "x", words: 70 }]
			});
		}
		if (url.indexOf("/api/script") === 0) {
			requests.push({ url, body });
			return json({ success: true, pending: true, mode: "loop", noteId: "nt-row", noteUrl: "/api/script/notes/nt-row", pollAfterMs: 10, state: "queued" }, 202);
		}
		return json({ success: false, error: "unexpected " + url }, 404);
	};

	const row = w.addBatchRow({ script: "morning yoga for beginners", minutes: 1 });
	const ok = await w.generateBatchRowScript(row.id);

	assert.equal(ok, true, "the row produced a script");
	assert.equal(requests.length, 1);
	assert.match(requests[0].url, /\/api\/script\?async=1$/, "the table layout uses the async ticket too");
	assert.equal(requests[0].body.useNotes, true);
	assert.equal(requests[0].body.topic, "morning yoga for beginners");
	assert.equal(requests[0].body.minutes, 1);
	assert.equal(w.getBatchRow(row.id).script, scriptText, "the narration replaced the topic in the cell");

	/* the same button refuses to run on an empty cell instead of hanging */
	const blank = w.addBatchRow();
	assert.equal(await w.generateBatchRowScript(blank.id), false);
	assert.match(w.getBatchRow(blank.id).error || "", /topic/i);

	/* and the click path reaches the same code (delegated listener, not a hook) */
	const clicked = w.addBatchRow({ script: "evening yoga wind down", minutes: 1 });
	const before = requests.length;
	const button = w.document.querySelector('[data-batch-row="' + clicked.id + '"] [data-batch-generate]');
	assert.ok(button, "the row carries the script button");
	button.click();
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline && w.getBatchRow(clicked.id).script === "evening yoga wind down") {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.equal(w.getBatchRow(clicked.id).script, scriptText, "the click wrote the script into the row");
	assert.equal(requests.length, before + 1);
	assert.equal(requests[before].body.topic, "evening yoga wind down");
	/* the table contract is unchanged: one action button per row */
	assert.equal(
		w.document.querySelectorAll('[data-batch-row="' + clicked.id + '"] button[data-batch-action]').length,
		1
	);
});

/* ------------------------------------------------------------------------- */
/* The budgets are advertised, not guessed                                    */
/* ------------------------------------------------------------------------- */

test("the worker advertises the hang budgets the client must use", async () => {
	const workerEntry = workerModule.default || workerModule;
	const response = await workerEntry.fetch(
		new Request("https://studio.test/api/pipeline-capabilities"),
		{},
		{ waitUntil: () => {}, passThroughOnException: () => {} }
	);
	const caps = await response.json();
	assert.equal(caps.scriptNotes, 1);
	assert.equal(caps.asyncScript, 1);
	assert.ok(Number(caps.scriptNotePollMs) > 0);
	assert.ok(Number(caps.scriptNoteWaitMs) > 0);
	assert.ok(Number(caps.scriptNoteStallMs) > 0);
	assert.equal(caps.scriptNoteQueueGraceMs, SCRIPT_NOTE_QUEUE_GRACE_MS);
	assert.equal(caps.scriptNoteDeadlineMs, SCRIPT_NOTE_DEADLINE_MS);
	assert.ok(caps.scriptNoteWaitMs < caps.scriptNoteDeadlineMs, "the page always gives up before the note deadline");
});

test("the page exposes the same budgets it enforces", () => {
	const { dom, w } = makeApp();
	const timing = w.__SCRIPT_PIPELINE_TIMING;
	assert.equal(timing.requestTimeoutMs, 20000, "20 s per request, not the 105 s hold");
	assert.equal(timing.legacyTimeoutMs, 105000, "the legacy path keeps its documented ceiling");
	assert.ok(timing.noteStallMs > 0 && timing.noteStallMs <= timing.noteWaitMs);
	assert.ok(timing.noteWaitMs < 240000, "the page gives up before the 240 s note deadline");
	assert.equal(timing.notePollAttempts, 3);
	dom.window.close();
});
