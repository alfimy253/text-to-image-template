/*
 * ---------------------------------------------------------------------------
 * RULE 35 (2026-11-03) — CLIENT-SIDE SCRIPT NOTES, NO KV WRITES.
 *
 * These routes expose the Worker's EPHEMERAL, per-isolate job ledger only.
 * `handleScriptNoteWrite`, `submitAsyncScriptJob`, the read watchdog and every
 * pipeline heartbeat now go through `writeScriptNote()` in
 * `src/modules/script-notes.ts`, whose store is memory-only (no KV get/put).
 * The durable copy of the narration text, keyword set and beat plan lives in
 * the browser's localStorage + cookie (src/client/script-notes-client.ts),
 * guarded by digest consistency checks. Nothing about a script is persisted
 * server-side; a Worker restart simply loses the ledger.
 * ---------------------------------------------------------------------------
 *
 * SCRIPT NOTE API — the dynamic URL that a waiting script request returns to.
 *
 *   POST   /api/script/notes          write a note down (research a URL)
 *   GET    /api/script/notes/<id>     read it back; `state` is the job status
 *   DELETE /api/script/notes/<id>     forget it
 *   POST   /api/script?async=1        park the job on the event loop, answer
 *                                     202 { noteId, noteUrl, pollAfterMs }
 *
 * The sync `POST /api/script` still exists and is unchanged for old clients.
 * The async form exists because a script legitimately takes 20-90 s while the
 * browser/proxy connection does not have to stay open for it: the request
 * hands back a note id, and the caller "returns to the request" by polling the
 * note URL until `state` is `done` (script included) or `error`.
 * ---------------------------------------------------------------------------
 */

import {
	buildNoteOutline,
	canonicalSourceUrl,
	clientNote,
	emptyScriptNote,
	isScriptNoteId,
	noteHit,
	noteRunActive,
	noteRunExpire,
	noteRunFailed,
	noteRunAdopt,
	noteRunStart,
	noteStaleReason,
	readScriptNote,
	readScriptNoteChecked,
	readScriptNoteFresh,
	researchSourceUrl,
	scriptNoteStore,
	scriptNoteId,
	SCRIPT_NOTE_CLIENT_WAIT_MS,
	SCRIPT_NOTE_DEADLINE_MS,
	SCRIPT_NOTE_QUEUE_GRACE_MS,
	SCRIPT_NOTE_RESEARCH_TTL_MS,
	writeScriptNote,
	writeScriptNoteGuarded,
	type NoteFetch,
	type ScriptNote,
	type ScriptNoteKv
} from "./script-notes";
import {
	SCRIPT_JOB_POLL_AFTER_MS,
	isTerminalNoteState,
	scriptEventLoop,
	type ScriptEventLoop
} from "./script-event-loop";
import {
	parseKeywordSet,
	SPEED_WORDS,
	handleSeoScriptGeneration,
	SEO_PROGRESS_BUDGET_MS
} from "./script-seo";

export interface ScriptNoteApiDeps {
	fetchImpl?: NoteFetch;
	loop?: ScriptEventLoop;
	waitUntil?: (task: Promise<unknown>) => void;
	onValidated?: () => Promise<void>;
	/** Testable/configurable wall-clock budget for a parked job. */
	jobDeadlineMs?: number;
	/**
	 * How long the caller will actually wait for the note (the page's
	 * SCRIPT_NOTE_MAX_WAIT_MS, advertised as `scriptNoteWaitMs`). Admission
	 * refuses a ticket that cannot finish inside it, so the two numbers must
	 * agree; defaults to SCRIPT_NOTE_CLIENT_WAIT_MS.
	 */
	clientWaitMs?: number;
}

type NoteEnv = {
	AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
	KV_BINDING?: ScriptNoteKv;
};

function noteJson(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
			...headers
		}
	});
}

function sanitizeTopic(value: unknown): string {
	return String(value ?? "")
		.replace(/[\u0000-\u001F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 160);
}

function sanitizeMinutes(value: unknown): number {
	const minutes = Number(value);
	if (!Number.isInteger(minutes) || minutes < 1 || minutes > 6) return 1;
	return minutes;
}

function sanitizeSpeed(value: unknown): string {
	const speed = String(value ?? "medium").toLowerCase().trim();
	return SPEED_WORDS[speed] ? speed : "medium";
}

/* `/api/script/notes/<id>` — the dynamic note URL. */
export function matchScriptNoteRoute(pathname: string): { id: string } | null {
	const hit = /^\/api\/script\/notes\/([A-Za-z0-9-]+)$/.exec(String(pathname || ""));
	if (!hit) return null;
	return { id: hit[1] };
}

export function isScriptNoteRoute(pathname: string): boolean {
	return pathname === "/api/script/notes" || Boolean(matchScriptNoteRoute(pathname));
}

/*
 * Writes a note down.
 *
 * With `url`, the page is read once (bounded, model-free) and its title,
 * description, headings, keywords and first sentences become the note's
 * research block; the beat plan is derived from those headings. Without a URL
 * the note is still created and keyed on the topic, so the first script run
 * fills it in.
 */
export async function handleScriptNoteWrite(
	request: Request,
	env: NoteEnv,
	deps: ScriptNoteApiDeps = {}
): Promise<Response> {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return noteJson({ success: false, error: "Expected a JSON object" }, 400);
	}

	const rawUrl = String(body.url ?? body.sourceUrl ?? "");
	const url = canonicalSourceUrl(rawUrl);
	if (rawUrl && !url) {
		return noteJson(
			{ success: false, error: "Expected an http(s) URL in `url`" },
			400
		);
	}
	const topic = sanitizeTopic(body.topic) || url || "my video";
	const minutes = sanitizeMinutes(body.minutes);
	const speed = sanitizeSpeed(body.speed);

	let keywordSet = null;
	if (body.keywordSet !== undefined && body.keywordSet !== null) {
		const parsed = parseKeywordSet(JSON.stringify(body.keywordSet));
		if (!parsed.ok) {
			return noteJson(
				{ success: false, error: "keywordSet invalid (" + parsed.error + ")" },
				400
			);
		}
		keywordSet = parsed.data;
	}

	const id = isScriptNoteId(body.noteId) ? String(body.noteId) : scriptNoteId({ topic, sourceUrl: url, minutes, speed });
	const existing = await readScriptNote(env, id);
	const note: ScriptNote = existing
		? noteHit(existing)
		: emptyScriptNote({ id, topic, sourceUrl: url, minutes, speed });
	note.topic = topic;
	note.minutes = minutes;
	note.speed = speed;
	if (url) note.sourceUrl = url;
	if (keywordSet) note.keywordSet = keywordSet;
	note.state = note.script ? "done" : "empty";

	const startedAt = Date.now();
	const refresh = body.refresh === true;
	const shouldResearch = Boolean(
		url &&
			(refresh ||
				!note.source ||
				note.source.status !== "fetched" ||
				Date.now() - (note.updatedAt || 0) > SCRIPT_NOTE_RESEARCH_TTL_MS)
	);
	let researchMs = 0;
	if (shouldResearch) {
		/*
		 * Run inline, not on the script event loop. This task is awaited
		 * immediately, so the loop's only possible contributions were queue
		 * latency and starvation: while the loop's two slots were busy it made
		 * `POST /api/script/notes` wait behind unrelated script jobs. The fetch
		 * is already bounded (4 s, 400 KB, SSRF-guarded) and never throws.
		 */
		const source = await researchSourceUrl(url, deps.fetchImpl);
		note.source = source;
		researchMs = Date.now() - startedAt;
		if (source.status !== "fetched") {
			/* A dead URL must not leave the note empty: keep the beat plan. */
			note.outline = note.outline.length
				? note.outline
				: buildNoteOutline(note.source, note.keywordSet, minutes * SPEED_WORDS[speed]);
		}
	}
	if (!note.outline.length || url) {
		note.outline = buildNoteOutline(
			note.source,
			note.keywordSet,
			minutes * SPEED_WORDS[speed]
		);
	}

	await writeScriptNote(env, note);
	console.log("[script-notes] written", {
		noteId: note.id,
		url: note.sourceUrl || undefined,
		status: note.source?.status,
		researchMs,
		headings: note.source?.headings.length || 0,
		facts: note.source?.facts.length || 0
	});

	return noteJson({
		success: true,
		noteId: note.id,
		noteUrl: "/api/script/notes/" + note.id,
		researchMs,
		note: clientNote(note),
		/* RULE 35: the caller must persist this note in localStorage + cookie.
		 * The Worker's copy is ephemeral memory and is never written to KV. */
		clientSideOnly: true,
		persisted: false,
		storage: ["localStorage:ytvs.script-notes.v1", "cookie:ytvs_note"]
	});
}

export interface NoteReadBudgets {
	queueGraceMs?: number;
	deadlineMs?: number;
	/* Progress budget advertised as `stallMs`; defaults to one model attempt. */
	stallMs?: number;
}

/*
 * `GET /api/script/notes/<id>`.
 *
 * This is also the watchdog: a reader runs in a FRESH isolate, so it is the
 * only place that can notice a run whose isolate died after the ticket was
 * issued (H2). A non-terminal note past its budget is closed here with
 * terminal `error` + `SCRIPT_NOTE_STALE`, which is why a poller can never be
 * told "pending" forever.
 */
export async function handleScriptNoteRead(
	id: string,
	env: NoteEnv,
	url: URL,
	budgets: NoteReadBudgets = {}
): Promise<Response> {
	if (!isScriptNoteId(id)) {
		return noteJson({ success: false, error: "Unknown note id" }, 404);
	}
	const first = await readScriptNoteChecked(env, id);
	let note = first.note;
	if (!note) {
		/*
		 * A STORE THAT DID NOT ANSWER IS NOT AN EMPTY NOTE.
		 *
		 * The KV budget (SCRIPT_NOTE_KV_TIMEOUT_MS) turns a slow binding into a
		 * fast answer, but "no answer" must never become `404 terminal` - the
		 * browser reads that as "the run ended in state 'empty'" and stops
		 * polling a job that is still writing (measured before this branch: a
		 * KV at 2.5 s per op answered 404/terminal while the pre-budget code
		 * simply waited and answered 202). 503 + `terminal:false` says the
		 * truth: the poll failed, the job did not.
		 */
		if (first.unavailable) {
			/* RULE 35: unreachable - there is no KV binding to time out. Kept as
			 * a defensive branch for an adapter that reports `unavailable`. */
			console.warn("[script-notes] note store did not answer", { noteId: id });
			return noteJson(
				{
					success: false,
					error: "The script note store is busy - the job may still be running",
					code: "SCRIPT_NOTE_STORE_BUSY",
					retryable: true,
					pending: true,
					terminal: false,
					noteId: id,
					pollAfterMs: SCRIPT_JOB_POLL_AFTER_MS,
					retryAfterMs: SCRIPT_JOB_POLL_AFTER_MS
				},
				503,
				{ "Retry-After": String(Math.max(1, Math.round(SCRIPT_JOB_POLL_AFTER_MS / 1000))) }
			);
		}
		return noteJson(
			{ success: false, error: "Note not found", noteId: id, state: "empty", terminal: true },
			404
		);
	}
	const stale = noteStaleReason(note, Date.now(), budgets);
	if (stale) {
		/*
		 * A VERDICT IS READ THROUGH TO KV.
		 *
		 * `readScriptNote` is cache-first, so this isolate may be holding a
		 * copy from before the runner finished somewhere else. Closing a note
		 * that KV already has as `done` would report a finished script as a
		 * failure - the same resurrection bug as the runner's late `done`,
		 * mirrored. Re-read the authoritative copy before judging, and let the
		 * note's own terminal state win.
		 */
		const fresh = await readScriptNoteChecked(env, id, { fresh: true });
		/* A store that did not answer cannot be the basis of a verdict: serve the
		 * copy we have and let the next poll judge. */
		if (!fresh.unavailable && fresh.note) note = fresh.note;
		const stillStale = !fresh.unavailable
			? noteStaleReason(note, Date.now(), budgets)
			: null;
		if (stillStale) {
			note = noteRunExpire(note, stillStale, "SCRIPT_NOTE_STALE");
			try {
				await writeScriptNote(env, note);
			} catch (writeError) {
				console.warn("[script-notes] stale note could not be closed", {
					noteId: id,
					reason: stillStale,
					error: String((writeError as { message?: string })?.message || writeError).slice(0, 160)
				});
			}
			console.log("[script-notes] stale note closed", { noteId: id, reason: stillStale });
		} else {
			console.log("[script-notes] stale note already settled elsewhere", {
				noteId: id,
				state: note.state
			});
		}
	}
	const includeScript = url.searchParams.get("script") !== "0";
	const terminal = isTerminalNoteState(note.state);
	const payload: Record<string, unknown> = {
		success: true,
		...clientNote(note, includeScript),
		pending: !terminal,
		terminal,
		/* RULE 35: this is a transient job ledger, not server-side storage. */
		clientSideOnly: true,
		persisted: false,
		storage: ["localStorage:ytvs.script-notes.v1", "cookie:ytvs_note"]
	};
	if (!terminal) {
		payload.pollAfterMs = SCRIPT_JOB_POLL_AFTER_MS;
		/* A live note tells the client how long it may still wait. */
		const startedAt = Number(note.runStartedAt) > 0 ? Number(note.runStartedAt) : Date.now();
		/* The note's own promised wait wins, exactly as in noteStaleReason: the
		 * page must see the same budget the watchdog is judging it against. */
		const budget = note.state === "queued"
			? Number(note.queueGraceMs) > 0
				? Number(note.queueGraceMs)
				: Number(budgets.queueGraceMs) > 0 ? Number(budgets.queueGraceMs) : SCRIPT_NOTE_QUEUE_GRACE_MS
			: Number(note.deadlineMs) > 0 ? Number(note.deadlineMs) : SCRIPT_NOTE_DEADLINE_MS;
		payload.waitMs = Math.max(0, startedAt + budget - Date.now());
		/*
		 * `waitMs` is the RUN budget and `stallMs` is the PROGRESS budget, and
		 * they are not the same number. A healthy run heartbeats the note
		 * before every model call, so silence beyond one attempt means the
		 * runner is gone. The client's stall guard must use this, not `waitMs`.
		 */
		payload.stallMs =
			Number(budgets.stallMs) > 0 ? Number(budgets.stallMs) : SEO_PROGRESS_BUDGET_MS;
		return noteJson(payload, 202, {
			"Retry-After": String(Math.max(1, Math.round(SCRIPT_JOB_POLL_AFTER_MS / 1000)))
		});
	}
	return noteJson(payload, 200);
}

export async function handleScriptNoteDelete(id: string, env: NoteEnv): Promise<Response> {
	if (!isScriptNoteId(id)) return noteJson({ success: false, error: "Unknown note id" }, 404);
	const store = scriptNoteStore(env);
	if (store.delete) await store.delete(id);
	return noteJson({
		success: true, noteId: id, deleted: true,
		clientSideOnly: true, persisted: false
	});
}

/* Cold-start guess for one run when the loop has no samples yet. */
export const SCRIPT_NOTE_QUEUE_RUN_ESTIMATE_MS = 60000;

/*
 * HOW LONG WILL THIS TICKET WAIT?
 *
 * The loop runs `concurrency` jobs at a time, so a caller that lands behind
 * `queued` jobs waits for roughly `ceil((queued + 1) / concurrency)` runs. A
 * wait longer than the job's own budget means the ticket can only ever fail:
 * the job would spend the whole budget queueing and be refused when it finally
 * got a slot (measured: a 202 that reported failure 4.5 s later at a 1.2 s
 * budget; at production scale that is minutes of polling for nothing).
 *
 * Returns 0 when nothing is ahead, so an idle loop never rejects a caller.
 */
export function estimateQueueWaitMs(stats: {
	queued?: number;
	concurrency?: number;
	avgRunMs?: number;
}): number {
	const ahead = Math.max(0, Math.floor(Number(stats && stats.queued) || 0));
	if (!ahead) return 0;
	const concurrency = Math.max(1, Math.floor(Number(stats && stats.concurrency) || 1));
	const perRun =
		Number(stats && stats.avgRunMs) > 0
			? Number(stats.avgRunMs)
			: SCRIPT_NOTE_QUEUE_RUN_ESTIMATE_MS;
	return Math.ceil((ahead + 1) / concurrency) * perRun;
}

export interface AsyncScriptResult {
	noteId: string;
	noteUrl: string;
	pollAfterMs: number;
}

/*
 * The async entry point: answer immediately with a note id, run the pipeline
 * on the event loop, let the caller come back to the note URL.
 *
 * `waitUntil` (ctx.waitUntil) keeps the isolate alive past the response, which
 * is exactly the "request returns, work continues, note reports it" contract.
 */
export async function submitAsyncScriptJob(
	request: Request,
	env: NoteEnv,
	scriptModel: string,
	deps: ScriptNoteApiDeps & { body?: Record<string, unknown> } = {}
): Promise<Response> {
	const body =
		deps.body ||
		((await request.clone().json().catch(() => null)) as Record<string, unknown> | null);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return noteJson({ success: false, error: "Expected a JSON object" }, 400);
	}

	const topic = sanitizeTopic(body.topic) || "my video";
	const minutes = sanitizeMinutes(body.minutes);
	const speed = sanitizeSpeed(body.speed);
	const url = canonicalSourceUrl(body.sourceUrl ?? body.url ?? "");
	const id = isScriptNoteId(body.noteId)
		? String(body.noteId)
		: scriptNoteId({ topic, sourceUrl: url, minutes, speed });

	const jobDeadlineMs =
		Number(deps.jobDeadlineMs) > 0 ? Number(deps.jobDeadlineMs) : SCRIPT_NOTE_DEADLINE_MS;
	const loop = deps.loop || scriptEventLoop();
	/*
	 * THE SAME NOTE SUBMITTED TWICE IS ONE RUN.
	 *
	 * `schedule()` already coalesces two submissions with the same id into one
	 * job, but this route used to write `noteRunStart` first - so the second
	 * ticket minted a NEW run over a job that was about to finish under the old
	 * one, and the old run's terminal write then belonged to "an older run".
	 * Nothing is written when the ticket is a duplicate: the note already says
	 * where the run is, and the caller gets the same job through `schedule()`.
	 */
	const inFlight = typeof loop.job === "function" ? loop.job(id) : null;
	const alreadyRunning = Boolean(
		inFlight && (inFlight.state === "queued" || inFlight.state === "active")
	);
	const loopStats = loop.stats();
	/*
	 * ADMISSION: never hand out a ticket this queue cannot honour.
	 *
	 * Checked before the note write so a rejected submission does not rewrite
	 * (or, behind a slow store, clobber) the note of the run it is refusing.
	 * `alreadyRunning` submissions are exempt: they adopt the job that is
	 * already in the queue, so they add no wait.
	 */
	const queueEtaMs = alreadyRunning ? 0 : estimateQueueWaitMs(loopStats);
	/*
	 * ADMISSION AND THE WATCHDOG MUST AGREE (session 279).
	 *
	 * This used to refuse a ticket only when its ETA reached the RUN deadline
	 * (240 s), while the reader-side watchdog killed a note that was still
	 * `queued` after a flat 90 s grace. Every ticket with an ETA between the two
	 * was therefore admitted and then killed while waiting in line - and once the
	 * browser stopped re-submitting (its ladder moved into the worker), a killed
	 * note was a dead row instead of a retry nobody noticed.
	 *
	 * The limit is now what the CLIENT will actually wait for
	 * (SCRIPT_NOTE_CLIENT_WAIT_MS, advertised as `scriptNoteWaitMs`): a ticket
	 * that cannot complete before the page gives up is refused immediately with
	 * 503 + Retry-After, and a ticket that can is written with the wait it was
	 * promised (`note.queueGraceMs`) so the watchdog judges it against that.
	 */
	const runEstimateMs =
		Number(loopStats.avgRunMs) > 0
			? Number(loopStats.avgRunMs)
			: SCRIPT_NOTE_QUEUE_RUN_ESTIMATE_MS;
	const clientWaitMs =
		Number(deps.clientWaitMs) > 0 ? Number(deps.clientWaitMs) : SCRIPT_NOTE_CLIENT_WAIT_MS;
	const admissionRefused =
		queueEtaMs > 0 && (queueEtaMs >= clientWaitMs || queueEtaMs >= jobDeadlineMs);
	/*
	 * The grace this ticket is promised: its own ETA plus one run's worth of
	 * slack (the ETA is a completion estimate, so it already contains the run),
	 * never below the flat default and never above what the client waits for.
	 */
	const promisedQueueGraceMs = Math.min(
		clientWaitMs,
		Math.max(SCRIPT_NOTE_QUEUE_GRACE_MS, queueEtaMs + Math.min(runEstimateMs, SCRIPT_NOTE_QUEUE_GRACE_MS))
	);
	if (queueEtaMs > 0) {
		console.log("[script] admission", {
			noteId: id,
			queued: loopStats.queued,
			concurrency: loopStats.concurrency,
			etaMs: queueEtaMs,
			runEstimateMs,
			clientWaitMs,
			jobDeadlineMs,
			refused: admissionRefused,
			promisedQueueGraceMs
		});
	}
	const loaded = await readScriptNoteChecked(env, id);
	if (!alreadyRunning && !admissionRefused && loaded.unavailable) {
		/*
		 * The store is too slow to trust: issuing a ticket would (a) replace a
		 * note we could not read - losing the keyword set and beat plan that
		 * make the next run cheap - and (b) promise a note URL we may not be
		 * able to serve. Answer honestly and let the caller retry.
		 */
		console.warn("[script] async job refused: note store did not answer", { noteId: id });
		return noteJson(
			{
				success: false,
				error: "The script note store is busy - try again in a moment",
				kind: "busy",
				code: "SCRIPT_NOTE_STORE_BUSY",
				retryAfterMs: 1500,
				noteId: id,
				noteUrl: "/api/script/notes/" + id
			},
			503,
			{ "Retry-After": "2" }
		);
	}
	const existing = loaded.note;
	const note: ScriptNote = existing
		? noteHit(existing)
		: emptyScriptNote({ id, topic, sourceUrl: url, minutes, speed });
	note.topic = topic;
	note.minutes = minutes;
	note.speed = speed;
	if (url) note.sourceUrl = url;
	if (!alreadyRunning) {
		noteRunStart(note, "queued");
		note.deadlineMs = jobDeadlineMs;
		/* The wait this ticket was promised, so the watchdog cannot kill a job
		 * the loop itself admitted (see admissionRefused above). */
		note.queueGraceMs = promisedQueueGraceMs;
		/*
		 * Deliberately the UNGUARDED write: issuing a ticket is the one moment a
		 * run is allowed to reopen a settled note (a retry after `error`). Every
		 * write after this goes through `writeScriptNoteGuarded`.
		 */
		await writeScriptNote(env, note);
	} else if (note.state !== "done" && note.state !== "empty") {
		/*
		 * A retry that lands on a job which is still in flight re-arms that SAME
		 * run instead of minting a second owner (the job's own writes would
		 * belong to the old one and be rejected). This is the "the watchdog
		 * closed it too early, the user tried again" path: the note goes back to
		 * `queued` with a fresh staleness clock and the job finishes normally.
		 */
		noteRunAdopt(note, "queued");
		await writeScriptNote(env, note);
	}
	const innerBody: Record<string, unknown> = { ...body, useNotes: true, async: false };
	const innerRequest = new Request(request.url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(innerBody)
	});

	/*
	 * The job body. Whatever runs it (the loop or the inline fallback) it must
	 * leave the note in a terminal state: `handleSeoScriptGeneration` writes
	 * `done`/`error` itself, and `onError` covers a throw before it can.
	 */
	/*
	 * THE TRANSITION TO `planning` HAPPENS ONCE PER RUN, and it is also the
	 * place where a note that is ALREADY SETTLED is detected: a reader's
	 * watchdog can close a note while its job is still waiting for a slot
	 * (queue grace 90 s, run deadline 240 s), and the job used to run anyway -
	 * paying for a planner and a writer call for a browser that had already
	 * been told the run failed. `settled` short-circuits the body; the note's
	 * own verdict is left alone.
	 */
	let runMarked = false;
	let settled: string | null = null;
	const markRunning = async (context?: { signal?: AbortSignal }): Promise<void> => {
		if (runMarked) return;
		runMarked = true;
		try {
			/* Fresh: a verdict written by another isolate must be visible here. */
			const current = (await readScriptNoteFresh(env, id)) || note;
			/* A slow KV read can outlive the job deadline. Do not persist a stale
			 * active transition after the watchdog has already closed the note. */
			if (context?.signal?.aborted) return;
			if (isTerminalNoteState(current.state)) {
				settled = String(current.state);
				console.warn("[script-notes] job skipped: the note is already settled", {
					noteId: id,
					state: current.state,
					errorCode: current.errorCode
				});
				return;
			}
			noteRunActive(current, "planning");
			await writeScriptNoteGuarded(env, current);
		} catch {
			/* bookkeeping only: the job itself is what matters */
		}
	};

	const runJob = async (context?: { signal?: AbortSignal }): Promise<{ status: number; ok: boolean }> => {
		await markRunning(context);
		if (settled) {
			/*
			 * Do not spend a model call on a note nobody is waiting for, and do
			 * not overwrite its verdict: the HTTP shape is only used for logging.
			 */
			return { status: 409, ok: false };
		}
		const response = await handleSeoScriptGeneration(
			innerRequest,
			new URL(request.url),
			env,
			scriptModel,
			deps.onValidated,
			{
				noteId: id,
				useNotes: true,
				fetchImpl: deps.fetchImpl,
				loop,
				waitUntil: deps.waitUntil,
				/* This route already counted the run when it issued the ticket. */
				runCounted: true,
				/* So an expired deadline actually stops the pipeline instead of
				 * leaving an orphan that rewrites the note's terminal state. */
				signal: context?.signal,
				/*
				 * The SAME clock the note's watchdog and the loop use: the
				 * ticket. Without it the pipeline's retry ladder (3 x 45 s +
				 * 3 x 90 s = 405 s) cannot fit inside this run's 240 s promise,
				 * so the last attempt is always started and then thrown away -
				 * see the attempt-budget check in script-seo.
				 */
				deadlineAtMs: Number(note.runStartedAt || Date.now()) + jobDeadlineMs
			}
		);
		const status = response.status;
		const payload = await response.json().catch(() => ({}));
		return { status, ok: Boolean((payload as { success?: boolean }).success) };
	};

	const failNote = async (error: unknown, code: string): Promise<void> => {
		try {
			/* Fresh: this write is a verdict, so it must see the authoritative
			 * copy (and `writeScriptNoteGuarded` then keeps the first verdict). */
			const current = (await readScriptNoteFresh(env, id)) || note;
			noteRunFailed(
				current,
				String((error as { message?: string })?.message || error || code)
			);
			current.errorCode = code;
			await writeScriptNoteGuarded(env, current);
		} catch {
			/* the client's staleness watchdog is the backstop */
		}
	};

	const jobOptions = {
		id,
		label: "script",
		deadlineMs: jobDeadlineMs,
		onStart: markRunning,
		onError: (error: unknown) => failNote(error, "SCRIPT_NOTE_FAILED")
	};

	/*
	 * H1: a loop that will not take the job must not produce a ticket for work
	 * that will never run.
	 *
	 * Two ways the loop refuses, and BOTH have to land in the same fallback:
	 * the queue is at `maxQueue`, or the loop has been closed (a teardown, a
	 * harness, a reused isolate) and `schedule()` rejects synchronously with
	 * "script event loop is closed". The second one was checked nowhere, so a
	 * closed loop still produced a 202 for a note that could only ever be
	 * closed by the 90 s watchdog later on. Now the rejected job runs INLINE
	 * under waitUntil (degraded mode, the work still happens), and when there
	 * is no waitUntil to keep the isolate alive the answer is an honest 503
	 * with the note closed - never a 202.
	 */
	const closed = typeof loop.isClosed === "function" ? loop.isClosed() : false;
	const queueFull = closed || admissionRefused || loopStats.queued >= loop.maxQueue;
	let mode: "loop" | "inline" = "loop";

	if (!queueFull) {
		const job = loop.schedule(runJob, jobOptions);
		job.catch(() => {});
		if (deps.waitUntil) {
			try {
				deps.waitUntil(job);
			} catch {
				/* best effort */
			}
		}
	} else if (deps.waitUntil) {
		mode = "inline";
		const controller = new AbortController();
		let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
		const work = runJob({ signal: controller.signal });
		const deadline = new Promise<never>((_resolve, reject) => {
			deadlineTimer = setTimeout(() => {
				controller.abort();
				const error = new Error("script job exceeded its " + jobDeadlineMs + " ms budget");
				(error as { code?: string }).code = "SCRIPT_NOTE_DEADLINE";
				reject(error);
			}, jobDeadlineMs);
		});
		const settleFailure = (error: unknown): Promise<void> => {
			const code = (error as { code?: string })?.code === "SCRIPT_NOTE_DEADLINE"
				? "SCRIPT_NOTE_DEADLINE"
				: "SCRIPT_NOTE_FAILED";
			/* A broken KV must not turn the fallback task into another hang. */
			return failNote(error, code).catch(() => undefined);
		};
		const inline = Promise.race([work, deadline]).finally(() => {
			if (deadlineTimer) clearTimeout(deadlineTimer);
		});
		/*
		 * The verdict write is part of the waitUntil contract, not a detached
		 * promise: `void failNote(...)` could be dropped the moment the isolate
		 * unwound, leaving the note `planning` until a reader's watchdog closed
		 * it 90 s later.
		 */
		const settledInline = inline.catch((error) => settleFailure(error));
		try {
			deps.waitUntil(settledInline);
		} catch {
			/* best effort */
		}
		console.warn("[script] event loop is not accepting jobs, running inline", {
			noteId: id,
			queued: loop.stats().queued,
			maxQueue: loop.maxQueue
		});
	} else {
		/* Two distinct refusals, two distinct codes: "the queue is full" is not
		 * "this isolate is shutting down", and the browser's retry hint is the
		 * same either way. */
		const unavailableCode = closed
			? "SCRIPT_LOOP_CLOSED"
			: admissionRefused
				? "SCRIPT_QUEUE_ETA_EXCEEDED"
				: "SCRIPT_LOOP_QUEUE_FULL";
		const unavailableMessage = closed
			? "This runtime is not accepting script jobs right now - try again in a moment"
			: admissionRefused
				? "The script queue is too long for this request to finish in time - try again in a moment"
				: "The script queue is full - try again in a moment";
		await failNote(
			new Error(
				(closed
					? "the script event loop is closed"
					: admissionRefused
						? "the estimated queue wait (" + queueEtaMs + " ms) exceeds this run's " + jobDeadlineMs + " ms budget"
						: "script event loop queue is full") +
					" and this runtime cannot run it after the response"
			),
			unavailableCode
		);
		console.error("[script] async job rejected: no capacity after the response", {
			noteId: id,
			closed,
			admissionRefused,
			queueEtaMs,
			queued: loopStats.queued,
			maxQueue: loop.maxQueue
		});
		return noteJson(
			{
				success: false,
				error: unavailableMessage,
				kind: "overload",
				retryAfterMs: 1500,
				noteId: id,
				noteUrl: "/api/script/notes/" + id
			},
			503,
			{ "Retry-After": "2" }
		);
	}

	console.log("[script] async queued", {
		noteId: id,
		mode,
		topic: topic.slice(0, 80),
		minutes,
		speed,
		noteUrl: "/api/script/notes/" + id
	});

	return noteJson(
		{
			success: true,
			pending: true,
			mode,
			noteId: id,
			noteUrl: "/api/script/notes/" + id,
			pollAfterMs: SCRIPT_JOB_POLL_AFTER_MS,
			state: "queued",
			/* RULE 35: the ticket is an ephemeral in-isolate job, not a KV
			 * record. The client owns the durable note. */
			clientSideOnly: true,
			persisted: false,
			storage: ["localStorage:ytvs.script-notes.v1", "cookie:ytvs_note"]
		},
		202,
		{ "Retry-After": String(Math.max(1, Math.round(SCRIPT_JOB_POLL_AFTER_MS / 1000))) }
	);
}
