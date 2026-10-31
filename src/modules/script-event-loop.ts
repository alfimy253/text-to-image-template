/*
 * ---------------------------------------------------------------------------
 * SCRIPT EVENT LOOP — Node-style scheduling for the script pipeline.
 *
 * WHY
 *
 * `/api/script` was strictly sequential: the planner call had to finish before
 * the writer call started, both inside one HTTP request, and the browser held a
 * connection open for the whole thing (the client timeout is 105 s while the
 * server allows 45 s + 90 s + 90 s). When the connection died the work died
 * with it, and a second video had to wait behind the first because nothing
 * scheduled the two jobs.
 *
 * This module is a small, explicit event loop with the same phase order as
 * Node's:
 *
 *   timers  →  pending  →  poll  →  check  →  close
 *
 *   - timers : delayed callbacks (backoff, note refresh, poll deadlines)
 *   - pending: I/O callbacks handed back by the previous tick
 *   - poll   : the actual script jobs, started while `active < concurrency`
 *   - check  : `setImmediate` work — note write-backs, telemetry, log flush
 *   - close  : cleanup once the loop is idle
 *
 * A script job is submitted with `schedule()` and returns a promise, but the
 * REQUEST no longer has to wait for it: the async route hands back the note id
 * (see /api/script/notes/<id>) and the waiting caller "returns to the request"
 * by polling that note. `drain()`/`stats()` make the phases observable in the
 * `debug` payload, so a slow run can be attributed to a phase instead of a
 * vague "the AI was slow".
 * ---------------------------------------------------------------------------
 */

export type LoopPhase = "timers" | "pending" | "poll" | "check" | "close";

export type LoopJobState = "queued" | "active" | "done" | "error" | "cancelled";

export interface LoopJobSnapshot {
	id: string;
	state: LoopJobState;
	phase: LoopPhase;
	queuedAt: number;
	startedAt: number | null;
	finishedAt: number | null;
	waitMs: number;
	runMs: number;
	error?: string;
}

export interface LoopScheduleOptions<T> {
	id: string;
	/* Reported in the snapshot: the named step this job represents. */
	label?: string;
	onStart?: () => void | Promise<void>;
	onFinish?: (result: T) => void | Promise<void>;
	onError?: (error: unknown) => void | Promise<void>;
	/* Wall-clock budget for the job body; 0/absent = unbounded. */
	deadlineMs?: number;
}

export interface ScriptEventLoopStats {
	ticks: number;
	phases: Record<LoopPhase, number>;
	concurrency: number;
	active: number;
	queued: number;
	maxQueue: number;
	started: number;
	completed: number;
	failed: number;
	timerWaitMs: number;
	checkJobs: number;
	pendingWaitMs: number;
	lastTickAt: number | null;
	jobs: LoopJobSnapshot[];
}

interface TimerEntry {
	at: number;
	seq: number;
	fn: () => void;
}

interface QueuedJob {
	snapshot: LoopJobSnapshot;
	run: () => Promise<unknown>;
	options: LoopScheduleOptions<unknown>;
	settle: (outcome: { ok: boolean; value?: unknown; error?: unknown }) => void;
}

export const SCRIPT_LOOP_DEFAULT_CONCURRENCY = 2;
export const SCRIPT_LOOP_MAX_QUEUE = 24;

export class ScriptEventLoop {
	readonly concurrency: number;
	readonly maxQueue: number;

	private timers: TimerEntry[] = [];
	private pending: Array<() => void> = [];
	private immediates: Array<() => void> = [];
	private closers: Array<() => void> = [];
	private queue: QueuedJob[] = [];
	private activeJobs = new Map<string, QueuedJob>();
	private snapshots = new Map<string, LoopJobSnapshot>();

	private tickCount = 0;
	private phaseCount: Record<LoopPhase, number> = {
		timers: 0,
		pending: 0,
		poll: 0,
		check: 0,
		close: 0
	};
	private started = 0;
	private completed = 0;
	private failed = 0;
	private timerWaitMs = 0;
	private pendingWaitMs = 0;
	private checkJobs = 0;
	private lastTickAt: number | null = null;
	private seq = 0;
	private idleWaiters: Array<() => void> = [];
	private pumping = false;
	private pumpAgain = false;
	private closed = false;

	constructor(options: { concurrency?: number; maxQueue?: number } = {}) {
		const concurrency = Number(options.concurrency);
		this.concurrency = Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : SCRIPT_LOOP_DEFAULT_CONCURRENCY;
		const maxQueue = Number(options.maxQueue);
		this.maxQueue = Number.isFinite(maxQueue) && maxQueue > 0 ? Math.floor(maxQueue) : SCRIPT_LOOP_MAX_QUEUE;
	}

	/* process.nextTick equivalent: run at the next `pending` boundary, never
	 * inside the caller's synchronous stack. */
	nextTick(fn: () => void): void {
		if (this.closed) return;
		this.pending.push(fn);
		this.pump();
	}

	/* setImmediate equivalent: run in the `check` phase. */
	immediate(fn: () => void): void {
		if (this.closed) return;
		this.immediates.push(fn);
		this.pump();
	}

	/* setTimeout equivalent: run in the `timers` phase once `ms` elapsed. */
	defer(ms: number, fn: () => void): void {
		if (this.closed) return;
		const wait = Number(ms) > 0 ? Number(ms) : 0;
		this.timers.push({ at: Date.now() + wait, seq: ++this.seq, fn });
		this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
		if (wait > 0) {
			/* Wake the loop when the earliest timer is due; the pump never
			 * busy-waits on wall-clock time. */
			const wake = setTimeout(() => this.pump(), wait + 1);
			(wake as { unref?: () => void })?.unref?.();
		}
		this.pump();
	}

	/* Runs `fn` when the loop next reaches the `close` phase (idle cleanup). */
	onIdle(fn: () => void): void {
		if (this.closed) {
			fn();
			return;
		}
		this.closers.push(fn);
		this.pump();
	}

	/*
	 * Submits a script job. The returned promise never rejects for queue
	 * reasons: an over-capacity submission resolves through `onError` and the
	 * returned promise rejects with a `TooManyScriptJobs`-shaped error so the
	 * route can answer 429 without leaking a hung request.
	 */
	schedule<T>(run: () => Promise<T>, options: LoopScheduleOptions<T>): Promise<T> {
		const id = String(options?.id || "job-" + (this.seq + 1));
		if (this.closed) {
			return Promise.reject(new Error("script event loop is closed"));
		}
		const existing = this.snapshots.get(id);
		if (existing && (existing.state === "queued" || existing.state === "active")) {
			/* Same note id submitted twice: one job, two waiters. */
			const job = [...this.queue, ...this.activeJobs.values()].find(
				(candidate) => candidate.snapshot.id === id
			);
			if (job) {
				return new Promise<T>((resolve, reject) => {
					const previous = job.settle;
					job.settle = (outcome) => {
						previous(outcome);
						if (outcome.ok) resolve(outcome.value as T);
						else reject(outcome.error);
					};
				});
			}
		}
		if (this.queue.length >= this.maxQueue) {
			const error = new Error(
				"script event loop queue is full (" + this.queue.length + " waiting)"
			);
			(error as { code?: string }).code = "SCRIPT_LOOP_QUEUE_FULL";
			return Promise.reject(error);
		}

		const now = Date.now();
		const snapshot: LoopJobSnapshot = {
			id,
			state: "queued",
			phase: "poll",
			queuedAt: now,
			startedAt: null,
			finishedAt: null,
			waitMs: 0,
			runMs: 0
		};
		this.snapshots.set(id, snapshot);

		let settle!: (outcome: { ok: boolean; value?: unknown; error?: unknown }) => void;
		const promise = new Promise<T>((resolve, reject) => {
			settle = (outcome) => {
				if (outcome.ok) resolve(outcome.value as T);
				else reject(outcome.error);
			};
		});
		/* Keep a rejection from surfacing before a waiter is attached. */
		promise.catch(() => {});

		this.queue.push({
			snapshot,
			run: run as () => Promise<unknown>,
			options: options as LoopScheduleOptions<unknown>,
			settle
		});
		this.pump();
		return promise;
	}

	/* Starts as many queued jobs as the concurrency allows, inside `poll`. */
	private startReadyJobs(): void {
		while (this.queue.length && this.activeJobs.size < this.concurrency) {
			const job = this.queue.shift();
			if (!job) break;
			this.phaseCount.poll++;
			this.activeJobs.set(job.snapshot.id, job);
			job.snapshot.state = "active";
			job.snapshot.startedAt = Date.now();
			job.snapshot.waitMs = job.snapshot.startedAt - job.snapshot.queuedAt;
			this.started++;
			void this.runJob(job);
		}
	}

	private async runJob(job: QueuedJob): Promise<void> {
		const startedAt = Date.now();
		let outcome: { ok: boolean; value?: unknown; error?: unknown } = {
			ok: false,
			error: new Error("script job did not run")
		};
		try {
			if (job.options.onStart) await job.options.onStart();
			const value = await this.withDeadline(job);
			outcome = { ok: true, value };
			this.completed++;
			job.snapshot.state = "done";
			if (job.options.onFinish) {
				try {
					await job.options.onFinish(value);
				} catch {
					/* hooks are bookkeeping */
				}
			}
		} catch (error: unknown) {
			outcome = { ok: false, error };
			this.failed++;
			job.snapshot.state = "error";
			job.snapshot.error = String(
				(error as { message?: string })?.message || error || "script job failed"
			).slice(0, 300);
			if (job.options.onError) {
				try {
					await job.options.onError(error);
				} catch {
					/* hooks are bookkeeping */
				}
			}
		} finally {
			job.snapshot.finishedAt = Date.now();
			job.snapshot.runMs = job.snapshot.finishedAt - startedAt;
			this.activeJobs.delete(job.snapshot.id);
			job.settle(outcome);
			/* Settled promises resume in the `pending` phase. */
			this.pending.push(() => this.phaseCount.pending++);
			this.pump();
		}
	}

	private withDeadline<T>(job: QueuedJob): Promise<T> {
		const deadlineMs = Number(job.options.deadlineMs);
		if (!(deadlineMs > 0)) return job.run() as Promise<T>;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(
					new Error(
						"script job " + job.snapshot.id + " exceeded its " + deadlineMs + " ms budget"
					)
				);
			}, deadlineMs);
			(job.run() as Promise<T>).then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				(error) => {
					clearTimeout(timer);
					reject(error);
				}
			);
		});
	}

	/*
	 * One loop iteration. Phases run in Node's order; a job started in `poll`
	 * settles on a later tick, so a pump never blocks on model I/O.
	 */
	pump(): void {
		if (this.closed) return;
		if (this.pumping) {
			this.pumpAgain = true;
			return;
		}
		this.pumping = true;
		try {
			do {
				this.pumpAgain = false;
				this.tickCount++;
				this.lastTickAt = Date.now();

				/* timers */
				const now = Date.now();
				let ranTimer = false;
				const due = this.timers.filter((timer) => timer.at <= now);
				this.timers = this.timers.filter((timer) => timer.at > now);
				for (const timer of due) {
					ranTimer = true;
					this.phaseCount.timers++;
					this.timerWaitMs += Math.max(0, now - timer.at);
					try {
						timer.fn();
					} catch {
						/* timer callbacks are isolated */
					}
				}
				if (ranTimer) this.phaseCount.pending++;

				/* pending (I/O callbacks returned by the previous tick) */
				this.drainPending();
				this.pendingWaitMs += 0;

				/* poll */
				this.startReadyJobs();

				/*
				 * Node drains the nextTick queue between two phases, before the
				 * check phase runs. A job body that calls nextTick()/setImmediate()
				 * therefore sees its tick callbacks first, then its immediates.
				 */
				this.drainPending();

				/* check */
				const immediates = this.immediates;
				this.immediates = [];
				for (const fn of immediates) {
					this.checkJobs++;
					this.phaseCount.check++;
					try {
						fn();
					} catch {
						/* isolated */
					}
				}

				/* close (only when nothing is left to do) */
				if (
					!this.queue.length &&
					!this.activeJobs.size &&
					!this.pending.length &&
					!this.immediates.length &&
					this.closers.length
				) {
					const closers = this.closers;
					this.closers = [];
					for (const fn of closers) {
						this.phaseCount.close++;
						try {
							fn();
						} catch {
							/* isolated */
						}
					}
				}

				if (this.isIdle()) {
					const waiters = this.idleWaiters;
					this.idleWaiters = [];
					for (const resolve of waiters) resolve();
				}
			} while (this.pumpAgain);
		} finally {
			this.pumping = false;
		}
	}

	/* Runs process.nextTick-style callbacks queued since the last boundary. */
	private drainPending(): void {
		const pending = this.pending;
		if (!pending.length) return;
		this.pending = [];
		this.phaseCount.pending += pending.length;
		for (const fn of pending) {
			try {
				fn();
			} catch {
				/* isolated */
			}
		}
	}

	isIdle(): boolean {
		return !this.queue.length && !this.activeJobs.size && !this.pending.length && !this.immediates.length;
	}

	/* Resolves when every scheduled job has settled. Used by tests and by
	 * `ctx.waitUntil` in the async route. */
	drain(): Promise<void> {
		if (this.isIdle()) return Promise.resolve();
		return new Promise<void>((resolve) => {
			this.idleWaiters.push(resolve);
			this.pump();
		});
	}

	job(id: string): LoopJobSnapshot | null {
		return this.snapshots.get(id) || null;
	}

	stats(): ScriptEventLoopStats {
		return {
			ticks: this.tickCount,
			phases: { ...this.phaseCount },
			concurrency: this.concurrency,
			active: this.activeJobs.size,
			queued: this.queue.length,
			maxQueue: this.maxQueue,
			started: this.started,
			completed: this.completed,
			failed: this.failed,
			timerWaitMs: this.timerWaitMs,
			checkJobs: this.checkJobs,
			pendingWaitMs: this.pendingWaitMs,
			lastTickAt: this.lastTickAt,
			jobs: [...this.snapshots.values()].slice(-8)
		};
	}

	close(): void {
		this.closed = true;
		this.timers = [];
		this.pending = [];
		this.immediates = [];
		this.closers = [];
	}
}

/* ------------------------------------------------------------------------- */
/* Worker-isolate loop                                                       */
/* ------------------------------------------------------------------------- */

let sharedLoop: ScriptEventLoop | null = null;

export function scriptEventLoop(options?: { concurrency?: number; maxQueue?: number }): ScriptEventLoop {
	if (!sharedLoop) sharedLoop = new ScriptEventLoop(options);
	return sharedLoop;
}

export function resetScriptEventLoop(): void {
	sharedLoop?.close();
	sharedLoop = null;
}

/*
 * "Return to the request that waits": the async route parks the job on the
 * loop and the browser comes back to the note URL until `state` is terminal.
 */
export const SCRIPT_JOB_POLL_AFTER_MS = 900;
export const SCRIPT_JOB_MAX_WAIT_MS = 240000;

export function isTerminalNoteState(state: unknown): boolean {
	return state === "done" || state === "error" || state === "empty";
}
