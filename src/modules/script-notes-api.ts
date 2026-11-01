/*
 * ---------------------------------------------------------------------------
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
	noteRunStart,
	noteStaleReason,
	readScriptNote,
	researchSourceUrl,
	scriptNoteStore,
	scriptNoteId,
	SCRIPT_NOTE_DEADLINE_MS,
	SCRIPT_NOTE_QUEUE_GRACE_MS,
	SCRIPT_NOTE_RESEARCH_TTL_MS,
	writeScriptNote,
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
import { parseKeywordSet, SPEED_WORDS, handleSeoScriptGeneration } from "./script-seo";

export interface ScriptNoteApiDeps {
	fetchImpl?: NoteFetch;
	loop?: ScriptEventLoop;
	waitUntil?: (task: Promise<unknown>) => void;
	onValidated?: () => Promise<void>;
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
		const loop = deps.loop || scriptEventLoop();
		const task = () =>
			researchSourceUrl(url, deps.fetchImpl).then((source) => {
				note.source = source;
				return source;
			});
		const source = await (async () => {
			try {
				return await loop.schedule(task, { id: id + ":research", label: "notes" });
			} catch {
				return task();
			}
		})();
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
		note: clientNote(note)
	});
}

export interface NoteReadBudgets {
	queueGraceMs?: number;
	deadlineMs?: number;
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
	let note = await readScriptNote(env, id);
	if (!note) {
		return noteJson(
			{ success: false, error: "Note not found", noteId: id, state: "empty", terminal: true },
			404
		);
	}
	const stale = noteStaleReason(note, Date.now(), budgets);
	if (stale) {
		note = noteRunExpire(note, stale, "SCRIPT_NOTE_STALE");
		try {
			await writeScriptNote(env, note);
		} catch (writeError) {
			console.warn("[script-notes] stale note could not be closed", {
				noteId: id,
				reason: stale,
				error: String((writeError as { message?: string })?.message || writeError).slice(0, 160)
			});
		}
		console.log("[script-notes] stale note closed", { noteId: id, reason: stale });
	}
	const includeScript = url.searchParams.get("script") !== "0";
	const terminal = isTerminalNoteState(note.state);
	const payload: Record<string, unknown> = {
		success: true,
		...clientNote(note, includeScript),
		pending: !terminal,
		terminal
	};
	if (!terminal) {
		payload.pollAfterMs = SCRIPT_JOB_POLL_AFTER_MS;
		/* A live note tells the client how long it may still wait. */
		const startedAt = Number(note.runStartedAt) > 0 ? Number(note.runStartedAt) : Date.now();
		const budget = note.state === "queued"
			? Number(budgets.queueGraceMs) > 0 ? Number(budgets.queueGraceMs) : SCRIPT_NOTE_QUEUE_GRACE_MS
			: Number(note.deadlineMs) > 0 ? Number(note.deadlineMs) : SCRIPT_NOTE_DEADLINE_MS;
		payload.waitMs = Math.max(0, startedAt + budget - Date.now());
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
	return noteJson({ success: true, noteId: id, deleted: true });
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

	const existing = await readScriptNote(env, id);
	const note: ScriptNote = existing
		? noteHit(existing)
		: emptyScriptNote({ id, topic, sourceUrl: url, minutes, speed });
	note.topic = topic;
	note.minutes = minutes;
	note.speed = speed;
	if (url) note.sourceUrl = url;
	noteRunStart(note, "queued");
	note.deadlineMs = SCRIPT_NOTE_DEADLINE_MS;
	await writeScriptNote(env, note);

	const loop = deps.loop || scriptEventLoop();
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
	const runJob = async (): Promise<{ status: number; ok: boolean }> => {
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
				waitUntil: deps.waitUntil
			}
		);
		const status = response.status;
		const payload = await response.json().catch(() => ({}));
		return { status, ok: Boolean((payload as { success?: boolean }).success) };
	};

	/* The job is really running now: the queue wait is over (staleness clock). */
	const markRunning = async (): Promise<void> => {
		try {
			const current = (await readScriptNote(env, id)) || note;
			if (isTerminalNoteState(current.state)) return;
			noteRunActive(current, "planning");
			await writeScriptNote(env, current);
		} catch {
			/* bookkeeping only: the job itself is what matters */
		}
	};

	const failNote = async (error: unknown, code: string): Promise<void> => {
		try {
			const current = (await readScriptNote(env, id)) || note;
			noteRunFailed(
				current,
				String((error as { message?: string })?.message || error || code)
			);
			current.errorCode = code;
			await writeScriptNote(env, current);
		} catch {
			/* the client's staleness watchdog is the backstop */
		}
	};

	const jobOptions = {
		id,
		label: "script",
		deadlineMs: SCRIPT_NOTE_DEADLINE_MS,
		onStart: markRunning,
		onError: (error: unknown) => failNote(error, "SCRIPT_NOTE_FAILED")
	};

	/*
	 * H1: a full queue must not produce a ticket for work that will never run.
	 * The loop refuses the job (`SCRIPT_LOOP_QUEUE_FULL`) and the caller used to
	 * ignore that rejection after the note was already written, so the note sat
	 * in `queued` forever. Now the rejected job runs INLINE under waitUntil
	 * (degraded mode, the work still happens), and when there is no waitUntil
	 * to keep the isolate alive the answer is an honest 503 with the note
	 * closed - never a 202.
	 */
	const queueFull = loop.stats().queued >= loop.maxQueue;
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
		const inline = (async () => {
			await markRunning();
			return runJob();
		})();
		inline.catch((error) => failNote(error, "SCRIPT_NOTE_FAILED"));
		try {
			deps.waitUntil(inline);
		} catch {
			/* best effort */
		}
		console.warn("[script] event loop queue full, running the job inline", {
			noteId: id,
			queued: loop.stats().queued,
			maxQueue: loop.maxQueue
		});
	} else {
		await failNote(
			new Error("script event loop queue is full and this runtime cannot run it after the response"),
			"SCRIPT_LOOP_QUEUE_FULL"
		);
		console.error("[script] async job rejected: queue full, no waitUntil", {
			noteId: id,
			queued: loop.stats().queued,
			maxQueue: loop.maxQueue
		});
		return noteJson(
			{
				success: false,
				error: "The script queue is full - try again in a moment",
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
			state: "queued"
		},
		202,
		{ "Retry-After": String(Math.max(1, Math.round(SCRIPT_JOB_POLL_AFTER_MS / 1000))) }
	);
}
