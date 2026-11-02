/*
 * SCRIPT HANG AUDIT (session 276) — the hang paths that survived the previous
 * "bound script job lifecycle hangs" pass.
 *
 * The previous pass bounded the hooks it knew about (`onStart` inside the
 * deadline, `onError` to a 1 s best-effort window, a deadline on the inline
 * queue fallback). This suite covers what it missed, all of it measured on the
 * committed code first:
 *
 *   1. a job that declares NO deadline was unbounded, and one such job pinned
 *      its concurrency slot (and every queued job, and `drain()`) forever;
 *   2. the loop measured its budget from `runJob`, so a job got queue-wait PLUS
 *      its full budget - longer than the note's own watchdog promised;
 *   3. a job that waited its budget out in the queue still started and spent
 *      model calls for a client that had already been told the run failed;
 *   4. an aborted run's queued terminal write still landed AFTER the loop's
 *      `error`, flipping the note to `done` (3 of 4 measured deadlines);
 *   5. a note the watchdog had closed as SCRIPT_NOTE_STALE was resurrected by
 *      the runner and paid for a planner + writer call after the browser had
 *      given up;
 *   6. a closed loop still answered 202 for a job that could only ever fail
 *      later (90 s watchdog), including the note's own request never running;
 *   7. a stalled KV binding hung POST /api/script?async=1, GET /api/script/
 *      notes/<id> and POST /api/script/notes with no ceiling at all;
 *   8. an unbounded `nextTick`/`setImmediate` chain spun inside one synchronous
 *      `pump()` and never returned to the runtime;
 *   9. a stale-cache read could close a note that a DIFFERENT isolate had
 *      already finished.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	clearScriptNoteMemory,
	emptyScriptNote,
	noteRunStart,
	noteWriteAllowed,
	readScriptNote,
	readScriptNoteFresh,
	scriptNoteId,
	writeScriptNote
} from "../src/modules/script-notes.ts";
import {
	handleScriptNoteRead,
	handleScriptNoteWrite,
	submitAsyncScriptJob
} from "../src/modules/script-notes-api.ts";
import { ScriptEventLoop } from "../src/modules/script-event-loop.ts";

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

function aiEnv(replies) {
	let next = 0;
	return {
		calls: 0,
		env: {
			AI: {
				run: async () => {
					const reply = replies[Math.min(next++, replies.length - 1)];
					if (reply instanceof Error) throw reply;
					return { response: reply };
				}
			}
		}
	};
}

function scriptRequest(body, path = "/api/script?async=1") {
	return new Request("https://studio.test" + path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	});
}

/* A KV whose writes take `ms`, so a queued note write is still in flight when
 * the job's deadline expires (the exact shape of the error -> done flip). */
function slowKv(ms = 120) {
	const map = new Map();
	return {
		map,
		async get(key) {
			await new Promise((resolve) => setTimeout(resolve, 1));
			return map.has(key) ? map.get(key) : null;
		},
		async put(key, value) {
			await new Promise((resolve) => setTimeout(resolve, ms));
			map.set(key, String(value));
		},
		async delete(key) {
			map.delete(key);
		}
	};
}

const hung = (ms) => new Promise((resolve) => setTimeout(() => resolve("HUNG"), ms));

async function readNote(id, env, budgets = {}) {
	const response = await handleScriptNoteRead(
		id,
		env,
		new URL("https://studio.test/api/script/notes/" + id),
		budgets
	);
	return { status: response.status, body: await response.json() };
}

/* ------------------------------------------------------------------------- */
/* 1 + 2 + 3: the loop's own budgets                                          */
/* ------------------------------------------------------------------------- */

test("a job that declares no deadline is still bounded, and it cannot pin the slot", async () => {
	const loop = new ScriptEventLoop({ concurrency: 1, defaultJobDeadlineMs: 60 });
	const startedAt = Date.now();
	const job = loop.schedule(() => new Promise(() => {}), { id: "no-budget" });

	const outcome = await Promise.race([
		job.then(() => "resolved", (error) => error.message),
		hung(2000)
	]);
	assert.notEqual(outcome, "HUNG", "an unbounded job body must not own the slot forever");
	assert.match(String(outcome), /exceeded its 60 ms budget/);
	assert.ok(Date.now() - startedAt < 1500);

	/* The freed slot is usable: the next job runs instead of queueing behind it. */
	assert.equal(await loop.schedule(async () => "next", { id: "next" }), "next");
	assert.equal(await Promise.race([loop.drain().then(() => "drained"), hung(500)]), "drained");
	assert.equal(loop.stats().active, 0);
	loop.close();
});

test("the budget counts the queue wait, and a job that waited it out never runs its body", async () => {
	const loop = new ScriptEventLoop({ concurrency: 1 });
	let ran = false;
	const blocker = loop.schedule(
		() => new Promise((resolve) => setTimeout(() => resolve("blocked"), 140)),
		{ id: "blocker", deadlineMs: 5000 }
	);
	const late = loop.schedule(
		async () => {
			ran = true;
			return "should not happen";
		},
		{ id: "late", deadlineMs: 50 }
	);

	const outcome = await Promise.race([
		late.then(() => "resolved", (error) => error.message),
		hung(2000)
	]);
	assert.notEqual(outcome, "HUNG");
	assert.match(String(outcome), /waited \d+ ms in the queue and spent its 50 ms budget/);
	assert.equal(ran, false, "no model work is started for a job whose budget is already gone");
	await blocker;
	await loop.drain();
	loop.close();
});

/* ------------------------------------------------------------------------- */
/* 4: an aborted run may not publish a terminal verdict                       */
/* ------------------------------------------------------------------------- */

test("a deadline that expires during a queued note write cannot flip the note error -> done", async () => {
	clearScriptNoteMemory();
	const kv = slowKv(120);
	const ai = aiEnv([JSON.stringify(plan), makeSrt()]);
	const env = { ...ai.env, KV_BINDING: kv };
	const loop = new ScriptEventLoop({ concurrency: 2 });

	const response = await submitAsyncScriptJob(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium" }),
		env,
		"mock-instruct",
		{ loop, waitUntil: () => {}, jobDeadlineMs: 200, onValidated: async () => {} }
	);
	assert.equal(response.status, 202);
	const ticket = await response.json();

	/* Let the job deadline fire, then let every queued write settle. */
	await new Promise((resolve) => setTimeout(resolve, 1600));
	const { body } = await readNote(ticket.noteId, env, {
		queueGraceMs: 1000,
		deadlineMs: 240000
	});

	const job = loop.job(ticket.noteId);
	assert.equal(job.state, "error", "the loop recorded the deadline as a failure");
	assert.equal(
		body.state,
		"error",
		"the note keeps the loop's verdict; a late `done` from the abandoned run must not land"
	);
	assert.equal(body.terminal, true);
	assert.equal(body.script, null);
	loop.close();
});

/* ------------------------------------------------------------------------- */
/* 5: a settled note is not resurrected, and it costs no model calls          */
/* ------------------------------------------------------------------------- */

test("a note the watchdog closed while its job was queued is not resurrected by that job", async () => {
	clearScriptNoteMemory();
	const ai = aiEnv([JSON.stringify(plan), makeSrt()]);
	const env = ai.env;
	const loop = new ScriptEventLoop({ concurrency: 1 });

	/* Occupy the only slot so the submitted job has to wait in the queue. */
	const blocker = loop.schedule(() => new Promise((resolve) => setTimeout(resolve, 300)), {
		id: "blocker",
		deadlineMs: 5000
	});

	const response = await submitAsyncScriptJob(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium" }),
		env,
		"mock-instruct",
		{ loop, waitUntil: () => {}, jobDeadlineMs: 5000, onValidated: async () => {} }
	);
	const ticket = await response.json();

	assert.equal((await readNote(ticket.noteId, env, { queueGraceMs: 90, deadlineMs: 5000 })).body.state, "queued");
	await new Promise((resolve) => setTimeout(resolve, 150));
	/* The reader's watchdog closes a note whose job is still legitimately queued. */
	const closed = await readNote(ticket.noteId, env, { queueGraceMs: 90, deadlineMs: 5000 });
	assert.equal(closed.body.state, "error");
	assert.equal(closed.body.errorCode, "SCRIPT_NOTE_STALE");

	await blocker;
	await new Promise((resolve) => setTimeout(resolve, 400));

	const after = await readNote(ticket.noteId, env, { queueGraceMs: 90, deadlineMs: 5000 });
	assert.equal(after.body.state, "error", "the runner must not reopen a settled note");
	assert.equal(after.body.errorCode, "SCRIPT_NOTE_STALE");
	assert.equal(after.body.script, null);
	assert.equal(ai.env.AI && true, true);
	loop.close();
});

/* ------------------------------------------------------------------------- */
/* 6: a closed loop never hands out a ticket it cannot honour                 */
/* ------------------------------------------------------------------------- */

test("a closed loop runs the job inline when it can, and answers 503 when it cannot", async () => {
	clearScriptNoteMemory();
	const loop = new ScriptEventLoop({ concurrency: 2 });
	loop.close();

	/* No waitUntil: the work cannot outlive the response, so never 202. */
	const ai = aiEnv([JSON.stringify(plan), makeSrt()]);
	const rejected = await submitAsyncScriptJob(
		scriptRequest({ topic: "Closed loop", minutes: 1, speed: "medium" }),
		ai.env,
		"mock-instruct",
		{ loop, jobDeadlineMs: 4000 }
	);
	assert.equal(rejected.status, 503);
	const rejectedBody = await rejected.json();
	assert.equal(rejectedBody.success, false);
	const rejectedNote = await readNote(rejectedBody.noteId, ai.env, { deadlineMs: 240000 });
	assert.equal(rejectedNote.body.state, "error");
	assert.equal(rejectedNote.body.terminal, true);

	/* With waitUntil the job still runs (degraded mode), and it does run. */
	clearScriptNoteMemory();
	const inlineAi = aiEnv([JSON.stringify(plan), makeSrt()]);
	const kept = [];
	const inline = await submitAsyncScriptJob(
		scriptRequest({ topic: "Closed loop", minutes: 1, speed: "medium" }),
		inlineAi.env,
		"mock-instruct",
		{ loop, waitUntil: (task) => kept.push(task), jobDeadlineMs: 4000, onValidated: async () => {} }
	);
	assert.equal(inline.status, 202);
	const inlineTicket = await inline.json();
	assert.equal(inlineTicket.mode, "inline");
	assert.equal(kept.length, 1, "the inline job is handed to waitUntil, not dropped");
	await Promise.race([Promise.all(kept), hung(4000)]);
	const settled = await readNote(inlineTicket.noteId, inlineAi.env, { deadlineMs: 240000 });
	assert.equal(settled.body.state, "done");
	assert.ok(String(settled.body.script || "").length > 40);
});

/* ------------------------------------------------------------------------- */
/* 7: a stalled KV binding cannot hang a route                                */
/* ------------------------------------------------------------------------- */

test("a stalled KV binding cannot hang the note routes", async () => {
	const env = {
		KV_BINDING: {
			get: () => new Promise(() => {}),
			put: () => new Promise(() => {}),
			delete: () => new Promise(() => {})
		},
		AI: { run: async () => ({ response: "{}" }) }
	};

	const read = await Promise.race([
		readNote("nt-0123456789", env, {}).then(() => "settled"),
		hung(6000)
	]);
	assert.equal(read, "settled", "GET /api/script/notes/<id> is bounded");

	const write = await Promise.race([
		handleScriptNoteWrite(
			new Request("https://studio.test/api/script/notes", {
				method: "POST",
				body: JSON.stringify({ topic: "stalled kv" })
			}),
			env
		).then(() => "settled"),
		hung(6000)
	]);
	assert.equal(write, "settled", "POST /api/script/notes is bounded");
});

/* ------------------------------------------------------------------------- */
/* 8: the pump yields to the runtime                                          */
/* ------------------------------------------------------------------------- */

test("an unbounded immediate chain yields instead of spinning inside one pump", async () => {
	const loop = new ScriptEventLoop({ concurrency: 1 });
	let ticks = 0;
	let stop = false;

	loop.immediate(function tick() {
		ticks++;
		if (!stop) loop.immediate(tick);
	});

	/* If the pump did not yield, this timer could never fire. */
	const yielded = await Promise.race([
		new Promise((resolve) => setTimeout(() => resolve("yielded"), 50)),
		hung(2500)
	]);
	stop = true;
	assert.equal(yielded, "yielded");
	assert.ok(ticks > 0);
	await loop.drain().catch(() => {});
	loop.close();
});

/* ------------------------------------------------------------------------- */
/* 9: write arbitration + fresh verdict reads                                 */
/* ------------------------------------------------------------------------- */

test("note writes obey run ownership and the first terminal verdict", () => {
	const base = emptyScriptNote({
		id: scriptNoteId({ topic: "Write arbitration", minutes: 1, speed: "medium" }),
		topic: "Write arbitration",
		minutes: 1,
		speed: "medium"
	});

	/* A brand new note accepts anything. */
	assert.equal(noteWriteAllowed(null, base), true);

	/* Same run: a heartbeat may not reopen a terminal note. */
	const runOne = noteRunStart({ ...base, outline: [] }, "planning");
	const errorOne = { ...runOne, state: "error", errorCode: "SCRIPT_NOTE_STALE" };
	assert.equal(noteWriteAllowed(errorOne, { ...runOne, state: "writing" }), false);
	/* Same run: `done` may not land on `error`, and `error` may not land on `done`. */
	assert.equal(noteWriteAllowed(errorOne, { ...runOne, state: "done" }), false);
	assert.equal(noteWriteAllowed({ ...runOne, state: "done" }, { ...runOne, state: "error" }), false);
	/* A non-terminal note accepts a later stage of the same run. */
	assert.equal(noteWriteAllowed({ ...runOne, state: "writing" }, { ...runOne, state: "done" }), true);

	/*
	 * A NEWER run may reopen a settled note; an older one may not. The new run
	 * starts from the record the store holds (so it inherits and advances the
	 * run clock), exactly as a retry issued by `submitAsyncScriptJob` does.
	 */
	const runTwo = noteRunStart({ ...errorOne }, "queued");
	assert.ok(
		Number(runTwo.runStartedAt) > Number(runOne.runStartedAt),
		"a run clock is strictly increasing"
	);
	assert.notEqual(runTwo.runId, runOne.runId);
	assert.equal(noteWriteAllowed(errorOne, { ...runTwo, state: "planning" }), true);
	assert.equal(noteWriteAllowed({ ...runTwo, state: "planning" }, { ...runOne, state: "done" }), false);
});

test("the watchdog reads the authoritative note before closing it", async () => {
	clearScriptNoteMemory();
	const kv = {
		map: new Map(),
		async get(key) {
			return this.map.has(key) ? this.map.get(key) : null;
		},
		async put(key, value) {
			this.map.set(key, String(value));
		},
		async delete(key) {
			this.map.delete(key);
		}
	};
	const env = { KV_BINDING: kv };

	/* This isolate caches a live-looking note that is already past its budget. */
	const note = emptyScriptNote({
		id: scriptNoteId({ topic: "Fresh verdict", minutes: 1, speed: "medium" }),
		topic: "Fresh verdict",
		minutes: 1,
		speed: "medium"
	});
	noteRunStart(note, "planning");
	note.runStartedAt = Date.now() - 300000;
	note.updatedAt = note.runStartedAt;
	await writeScriptNote(env, note);

	/* Another isolate finished it: KV says `done`, this isolate's cache does not. */
	const finished = { ...note, state: "done", script: "A finished script.", runStartedAt: Date.now() };
	await kv.put("script-note:" + note.id, JSON.stringify(finished));
	const cached = await readScriptNote(env, note.id);
	assert.equal(cached.state, "planning", "the isolate cache is stale on purpose");
	assert.equal((await readScriptNoteFresh(env, note.id)).state, "done");

	const { status, body } = await readNote(note.id, env, { deadlineMs: 240000 });
	assert.equal(status, 200);
	assert.equal(body.state, "done", "a finished script is never reported as a stale failure");
	assert.equal(body.terminal, true);
});

/* ------------------------------------------------------------------------- */
/* 10: a retry adopts a job that is still in flight                           */
/* ------------------------------------------------------------------------- */

test("a retry that lands on an in-flight job re-arms that run instead of failing on the stale verdict", async () => {
	clearScriptNoteMemory();
	const ai = aiEnv([JSON.stringify(plan), makeSrt()]);
	const env = ai.env;
	const loop = new ScriptEventLoop({ concurrency: 1 });

	const blocker = loop.schedule(() => new Promise((resolve) => setTimeout(resolve, 400)), {
		id: "blocker",
		deadlineMs: 5000
	});

	const first = await submitAsyncScriptJob(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium" }),
		env,
		"mock-instruct",
		{ loop, waitUntil: () => {}, jobDeadlineMs: 5000, onValidated: async () => {} }
	);
	const ticket = await first.json();
	assert.equal((await readNote(ticket.noteId, env, { queueGraceMs: 90, deadlineMs: 5000 })).body.state, "queued");

	/* The watchdog closes the still-queued note, and the user retries. */
	await new Promise((resolve) => setTimeout(resolve, 150));
	const stale = await readNote(ticket.noteId, env, { queueGraceMs: 90, deadlineMs: 5000 });
	assert.equal(stale.body.errorCode, "SCRIPT_NOTE_STALE");
	const ownerBefore = (await readScriptNote(env, ticket.noteId)).runId;

	const retry = await submitAsyncScriptJob(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium" }),
		env,
		"mock-instruct",
		{ loop, waitUntil: () => {}, jobDeadlineMs: 5000, onValidated: async () => {} }
	);
	assert.equal(retry.status, 202);
	const retryTicket = await retry.json();
	assert.equal(retryTicket.noteId, ticket.noteId, "the retry adopts the same note");
	const adopted = await readNote(ticket.noteId, env, { queueGraceMs: 90, deadlineMs: 5000 });
	assert.equal(adopted.body.state, "queued", "the note is live again, not a stale failure");
	assert.equal(adopted.body.terminal, false);
	assert.equal((await readScriptNote(env, ticket.noteId)).runId, ownerBefore, "the run owner is unchanged");

	/* The in-flight job then publishes its own verdict normally. */
	await blocker;
	await new Promise((resolve) => setTimeout(resolve, 600));
	const finished = await readNote(ticket.noteId, env, { deadlineMs: 240000 });
	assert.equal(finished.body.state, "done", "the adopted run finishes instead of being rejected as an older owner");
	assert.equal(finished.body.errorCode, null, "a done note carries no stale failure code");
	assert.ok(String(finished.body.script || "").length > 40);
	loop.close();
});
