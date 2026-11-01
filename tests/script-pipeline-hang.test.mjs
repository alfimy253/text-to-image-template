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
	clientNote,
	emptyScriptNote,
	noteRunActive,
	noteRunHeartbeat,
	noteRunStart,
	noteStaleReason,
	readScriptNote,
	scriptNoteId,
	SCRIPT_NOTE_DEADLINE_MS,
	SCRIPT_NOTE_QUEUE_GRACE_MS,
	writeScriptNote
} from "../src/modules/script-notes.ts";
import {
	handleScriptNoteRead,
	handleScriptNoteWrite,
	submitAsyncScriptJob
} from "../src/modules/script-notes-api.ts";
import { ScriptEventLoop } from "../src/modules/script-event-loop.ts";
import {
	handleSeoScriptGeneration,
	SEO_PROGRESS_BUDGET_MS
} from "../src/modules/script-seo.ts";

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

/* ------------------------------------------------------------------------- */
/* H6 — the note layer deadlocked the scriptwriter that created it            */
/* ------------------------------------------------------------------------- */
/*
 * H1-H5 all drive the pipeline with a bare topic, so `needsResearch` is false
 * and no page is ever fetched. That is exactly the blind spot: the note
 * research used to be parked on the SAME bounded event loop that the script job
 * already occupied, so two concurrent note-backed scripts held both concurrency
 * slots while both research tasks waited in the queue that only those two jobs
 * could free. Measured before the fix: active=2 queued=2 completed=0 after 5 s,
 * terminal only at 240.3 s (the job deadline), and the abandoned pipeline then
 * wrote `state:"done"` over the terminal error the loop had recorded.
 */

function envByPrompt(calls = []) {
	return {
		calls,
		env: {
			AI: {
				run: async (model, input) => {
					calls.push({ model, prompt: input.prompt });
					const isWriter = /Answer with ONLY valid SRT/.test(input.prompt);
					return { response: isWriter ? makeSrt() : JSON.stringify(plan) };
				}
			}
		}
	};
}

function noteFetch(html, hits = []) {
	return async (url) => {
		hits.push(String(url));
		return {
			ok: true,
			status: 200,
			headers: { get: () => "text/html; charset=utf-8" },
			text: async () => html
		};
	};
}

const pageHtml = `<!doctype html><html><head>
<title>Morning Yoga for Beginners</title>
<meta name="description" content="A short morning routine.">
</head><body><h1>Morning Yoga for Beginners</h1>
<h2>Start with breathing</h2><h2>Move into gentle stretches</h2>
<p>Most beginners rush the warm-up and pay for it later.</p></body></html>`;

test("H6: two concurrent note-backed scripts both finish instead of deadlocking", async () => {
	/* the real defaults: two slots, and two different articles to take notes on */
	const loop = new ScriptEventLoop({ concurrency: 2 });
	const { env, calls } = envByPrompt();
	const fetchImpl = noteFetch(pageHtml);

	const first = await submitAsyncScriptJob(
		asyncRequest({ topic: "Morning yoga", sourceUrl: "https://example.com/h6-a", minutes: 1, speed: "medium" }),
		env, "mock-instruct", { loop, fetchImpl }
	);
	const second = await submitAsyncScriptJob(
		asyncRequest({ topic: "Evening yoga", sourceUrl: "https://example.com/h6-b", minutes: 1, speed: "medium" }),
		env, "mock-instruct", { loop, fetchImpl }
	);
	assert.equal(first.status, 202);
	assert.equal(second.status, 202);

	/* The whole point: the loop reaches idle. Before the fix it never did. */
	const drained = await Promise.race([
		loop.drain().then(() => true),
		new Promise((resolve) => setTimeout(() => resolve(false), 10000))
	]);
	assert.equal(drained, true, "the loop drains; no job waits on its own sub-job");

	const stats = loop.stats();
	assert.equal(stats.queued, 0, "nothing is left waiting for a slot");
	assert.equal(stats.failed, 0, "no job was killed by its deadline");
	assert.ok(stats.completed >= 2, "both script jobs completed");
	assert.equal(calls.length, 4, "planner + writer for each of the two scripts");

	for (const response of [first, second]) {
		const ticket = await response.clone().json();
		const poll = await handleScriptNoteRead(
			ticket.noteId, env, new URL("https://studio.test" + ticket.noteUrl)
		);
		const note = await poll.json();
		assert.equal(note.state, "done");
		assert.equal(note.terminal, true);
		assert.equal(note.source.status, "fetched", "the notes really were taken");
		assert.ok(note.script.length > 40);
	}
	loop.close();
});

test("H6: a note write is never starved by a busy script loop", async () => {
	/* Both slots held by jobs that never finish: the old code queued the page
	 * read behind them, so `POST /api/script/notes` hung too. */
	const loop = new ScriptEventLoop({ concurrency: 2 });
	const holders = [
		loop.schedule(() => new Promise(() => {}), { id: "hold-1" }),
		loop.schedule(() => new Promise(() => {}), { id: "hold-2" })
	];
	holders.forEach((job) => job.catch(() => {}));
	assert.equal(loop.stats().active, 2, "both slots are busy");

	const fetchImpl = noteFetch(pageHtml);
	const response = await handleScriptNoteWrite(
		new Request("https://studio.test/api/script/notes", {
			method: "POST",
			body: JSON.stringify({ url: "https://example.com/h6-starve", minutes: 1, speed: "medium" })
		}),
		{ AI: { run: async () => ({ response: "unused" }) } },
		{ loop, fetchImpl }
	);
	assert.equal(response.status, 200);
	const written = await response.json();
	assert.equal(written.note.source.status, "fetched", "research is not queued behind script jobs");
	loop.close();
});

test("H6: an expired deadline cancels the run, so a note cannot flip error -> done", async () => {
	const writes = [];
	const rows = new Map();
	const env = {
		KV_BINDING: {
			async get(key) { return rows.has(key) ? rows.get(key) : null; },
			async put(key, value) {
				writes.push(JSON.parse(value).state);
				rows.set(key, value);
			},
			async delete(key) { rows.delete(key); }
		},
		AI: {
			run: async (_model, input) => {
				if (/Answer with ONLY valid SRT/.test(input.prompt)) {
					/* outlive the deadline: the writer is mid-call when it expires */
					await new Promise((resolve) => setTimeout(resolve, 300));
					return { response: makeSrt() };
				}
				return { response: JSON.stringify(plan) };
			}
		}
	};
	const loop = new ScriptEventLoop({ concurrency: 1 });
	const body = { topic: "Morning yoga", sourceUrl: "https://example.com/h6-cancel", minutes: 1, speed: "medium" };

	const job = loop.schedule(
		(context) => handleSeoScriptGeneration(
			new Request("https://studio.test/api/script", { method: "POST", body: JSON.stringify(body) }),
			new URL("https://studio.test/api/script"),
			env, "mock-instruct", undefined,
			{ loop, fetchImpl: noteFetch(pageHtml), signal: context.signal, runCounted: true }
		),
		{ id: "h6-cancel", label: "script", deadlineMs: 120 }
	);
	const outcome = await job.then(() => "resolved", (error) => error.message);
	assert.match(String(outcome), /exceeded its 120 ms budget/, "the deadline fires");

	await loop.drain();
	await new Promise((resolve) => setTimeout(resolve, 400));

	assert.ok(
		!writes.includes("done"),
		"the abandoned pipeline never writes a success (writes were: " + writes.join(",") + ")"
	);
	loop.close();
});

test("H6: a live note advertises a progress budget the stall guard can use", async () => {
	const note = emptyScriptNote({
		id: "nt-h6budget", topic: "yoga", sourceUrl: "", minutes: 1, speed: "medium"
	});
	noteRunStart(note, "planning");
	note.deadlineMs = SCRIPT_NOTE_DEADLINE_MS;
	const env = { AI: { run: async () => ({ response: "unused" }) } };
	await writeScriptNote(env, note);

	const response = await handleScriptNoteRead(
		"nt-h6budget", env, new URL("https://studio.test/api/script/notes/nt-h6budget")
	);
	assert.equal(response.status, 202);
	const payload = await response.json();
	assert.equal(payload.pending, true);
	assert.equal(payload.stallMs, SEO_PROGRESS_BUDGET_MS);
	assert.ok(
		payload.stallMs < payload.waitMs,
		"the progress budget is strictly smaller than the run budget - that gap is the bug"
	);
	/* The client must key its stall guard on the progress budget. Reading
	 * `waitMs` here is what made the guard unreachable. */
	assert.ok(/Number\(note\.stallMs\)/.test(APP_JS), "the page reads the progress budget");
	assert.ok(
		!/const advertised = Number\(note\.waitMs\)/.test(APP_JS),
		"the page no longer extends its stall deadline by the whole run budget"
	);
});

test("H6: a sync script run is recorded in the note's run count", async () => {
	const env = { ...envByPrompt().env };
	const fetchImpl = noteFetch(pageHtml);
	const body = { topic: "Morning yoga", sourceUrl: "https://example.com/h6-runs", minutes: 1, speed: "medium" };
	let noteId = "";

	for (const expectedRuns of [1, 2, 3]) {
		const response = await handleSeoScriptGeneration(
			new Request("https://studio.test/api/script", { method: "POST", body: JSON.stringify(body) }),
			new URL("https://studio.test/api/script"),
			env, "mock-instruct", undefined, { fetchImpl, loop: new ScriptEventLoop({ concurrency: 2 }) }
		);
		assert.equal(response.status, 200);
		const payload = await response.json();
		noteId = payload.noteId;
		const stored = await readScriptNote(env, noteId);
		assert.equal(stored.runs, expectedRuns, "the sync route counts every run");
	}
	assert.ok(noteId);
});

test("H6: research survives a planner failure and is not fetched twice", async () => {
	const hits = [];
	const env = {
		AI: { run: async (_model, input) => ({
			response: /Answer with ONLY valid SRT/.test(input.prompt) ? makeSrt() : "not json at all"
		}) }
	};
	const body = { topic: "Morning yoga", sourceUrl: "https://example.com/h6-research", minutes: 1, speed: "medium" };

	const first = await handleSeoScriptGeneration(
		new Request("https://studio.test/api/script", { method: "POST", body: JSON.stringify(body) }),
		new URL("https://studio.test/api/script"),
		env, "mock-instruct", undefined, { fetchImpl: noteFetch(pageHtml, hits) }
	);
	assert.equal(first.status, 500, "the planner exhausted its attempts");
	const failed = await first.json();
	const stored = await readScriptNote(env, failed.noteId);
	assert.equal(stored.state, "error");
	assert.equal(stored.source.status, "fetched", "the page read is kept, not thrown away");
	assert.equal(hits.length, 1);

	/* The retry reuses the stored research instead of re-fetching the URL. */
	const second = await handleSeoScriptGeneration(
		new Request("https://studio.test/api/script", { method: "POST", body: JSON.stringify(body) }),
		new URL("https://studio.test/api/script"),
		env, "mock-instruct", undefined, { fetchImpl: noteFetch(pageHtml, hits) }
	);
	assert.equal(second.status, 500);
	assert.equal(hits.length, 1, "no second fetch of the same page");
});

test("H6: a heartbeat advances the note without restarting the staleness clock", () => {
	/*
	 * The pipeline beats before every model call. If that beat went through
	 * `noteRunActive` it would also move `runStartedAt`, which is what
	 * `noteStaleReason` counts the run budget down from - so "240 s for the
	 * whole run" would quietly become "240 s since the last beat". Three 45 s
	 * planner attempts plus three 90 s writer attempts is 405 s, and on the
	 * degraded inline path there is no job deadline, so that watchdog is the
	 * only thing that can ever tell a poller the run is over.
	 */
	const beat = emptyScriptNote({
		id: "nt-h6beat", topic: "yoga", sourceUrl: "", minutes: 1, speed: "medium"
	});
	noteRunStart(beat, "planning");
	beat.runStartedAt = Date.now() - (SCRIPT_NOTE_DEADLINE_MS + 5000);
	beat.updatedAt = beat.runStartedAt;
	const startedAt = beat.runStartedAt;
	const before = clientNote(beat).updatedAt;

	/* what three planner plus three writer attempts produce */
	for (const state of ["planning", "planning", "planning", "writing", "writing", "writing"]) {
		noteRunHeartbeat(beat, state);
	}

	assert.equal(beat.state, "writing");
	assert.equal(beat.runStartedAt, startedAt, "the run clock did not move");
	assert.ok(clientNote(beat).updatedAt > before, "but the poller's signature did");
	assert.ok(
		noteStaleReason(beat, Date.now()),
		"a run past its budget is still closed even while it is beating"
	);

	/* The mistake this guards against, stated explicitly. */
	const wrong = emptyScriptNote({
		id: "nt-h6wrong", topic: "yoga", sourceUrl: "", minutes: 1, speed: "medium"
	});
	noteRunStart(wrong, "planning");
	wrong.runStartedAt = Date.now() - (SCRIPT_NOTE_DEADLINE_MS + 5000);
	noteRunActive(wrong, "writing");
	assert.equal(
		noteStaleReason(wrong, Date.now()),
		null,
		"noteRunActive would have hidden the dead run - which is why the beat must not use it"
	);
});

test("H6: closing the loop settles every waiter instead of stranding it", async () => {
	const loop = new ScriptEventLoop({ concurrency: 1, maxQueue: 4 });
	const blocker = loop.schedule(() => new Promise(() => {}), { id: "h6-blocker" });
	blocker.catch(() => {});
	/* one active job plus one that will never get a slot */
	const queued = loop.schedule(async () => "never runs", { id: "h6-queued" });
	const draining = loop.drain();
	assert.equal(loop.stats().active, 1);
	assert.equal(loop.stats().queued, 1);

	let queuedSettled = false;
	let drainSettled = false;
	queued.then(() => { queuedSettled = true; }, () => { queuedSettled = true; });
	draining.then(() => { drainSettled = true; }, () => { drainSettled = true; });

	loop.close();
	await new Promise((resolve) => setTimeout(resolve, 50));

	/*
	 * `pump()` returns at once once the loop is closed, so nothing would ever
	 * drain the queue or resolve an idle waiter again. Before this, both
	 * promises stayed pending forever - and `ctx.waitUntil` holding such a
	 * promise keeps an isolate open for nothing.
	 */
	assert.equal(queuedSettled, true, "a queued job gets a verdict when the loop closes");
	assert.equal(drainSettled, true, "drain() resolves when the loop closes");
	await assert.rejects(() => loop.schedule(async () => 1, { id: "h6-after" }), /closed/);
});

test("H6: a huge advertised waitMs cannot disable the client stall guard", async (t) => {
	/*
	 * The exact regression. A live note advertises TWO numbers: `waitMs` (the
	 * remaining share of the 240 s RUN budget - here 60 s) and `stallMs` (the
	 * PROGRESS budget - here 120 ms). The guard used to extend its deadline by
	 * `Math.max(stallMs, waitMs)`, so the larger number always won and the
	 * "stopped advancing" check could never fire; the page sat until its own
	 * wall-clock ceiling and reported a timeout instead of a stall.
	 */
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
				/* a generous wall-clock ceiling, a tight progress budget */
				scriptNoteWaitMs: 5000,
				scriptNoteStallMs: 120,
				scriptNotePollMs: 10
			});
		}
		if (url.indexOf("/api/script/notes/") === 0) {
			polls++;
			/* frozen state, and a run budget 500x the progress budget */
			return json({
				success: true,
				noteId: "nt-h6stall",
				state: "writing",
				terminal: false,
				pending: true,
				updatedAt: 1,
				runs: 1,
				waitMs: 60000,
				stallMs: 120
			}, 202);
		}
		if (url.indexOf("/api/script") === 0) {
			return json({
				success: true, pending: true, noteId: "nt-h6stall",
				noteUrl: "/api/script/notes/nt-h6stall", pollAfterMs: 10, state: "queued"
			}, 202);
		}
		return json({ success: false, error: "unexpected " + url }, 404);
	};

	w.addVideoAccordion();
	const ok = await w.runSeoScriptRequest(1, "morning yoga", 1, "medium");
	const elapsed = Date.now() - startedAt;

	assert.equal(ok, false);
	assert.ok(polls > 0, "the note was actually polled");
	/* Three attempts bounded by the 120 ms progress budget, not by the 5 s
	 * wall-clock ceiling - if waitMs still drove the guard this would take
	 * ~15 s. */
	assert.ok(elapsed < 3000, "gave up on the progress budget, took " + elapsed + "ms");
	const status = w.document.getElementById("va-script-status-1").textContent;
	assert.match(status, /stopped advancing/i, "reported as a stall, not a timeout");
});
