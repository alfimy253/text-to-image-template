/*
 * Event-driven, non-blocking image task queue (`src/modules/image-queue.ts`).
 *
 * Mirrors Node.js's single-threaded event-loop + libuv worker-pool architecture
 * inside the Cloudflare Workers / WinterCG runtime while strictly respecting
 * `workerd` per-request `IoContext` isolation:
 *
 *   1. Single-threaded non-blocking coordinator (`ImageTaskQueue`):
 *      - Callers submit image tasks (`enqueue`) without blocking the JS thread;
 *        hundreds of tasks arriving in a short burst are registered in O(1) per
 *        task into per-group FIFO lanes (`Map<string, GroupLane>`).
 *      - Pure-JS microtask scheduling (`notifyWaiters`) coordinates global
 *        worker-pool capacity, per-group concurrency, and round-robin fairness
 *        across concurrent videos/rows/users so a 20-scene batch never starves
 *        a later 2-image request.
 *
 *   2. Caller-isolated timers & background I/O execution:
 *      - Every rate-window wait (`setTimeout`) and every slow model inference
 *        (`descriptor.execute()`, e.g. `env.AI.run`) executes strictly inside
 *        the calling request's own `enqueue()` async frame (`IoContext`), never
 *        inside another request's timer callback. Disconnecting Request A can
 *        never cancel Request B's timers or trigger cross-request I/O errors.
 *
 *   3. Event-loop CPU yielding (`EventLoopCpuSerializer`):
 *      - Synchronous CPU work (such as multi-megabyte `Uint8Array -> base64`
 *        encoding and JSON framing) is serialized one image per macrotask turn
 *        (`setTimeout(..., 0)`) per request so bursts of completed images never
 *        monopolize the single JS thread or breach Worker CPU limits.
 */

export const DEFAULT_GLOBAL_IMAGE_CONCURRENCY = 6;
export const DEFAULT_GROUP_IMAGE_CONCURRENCY = 3;
export const DEFAULT_GROUP_WINDOW_LIMIT = 3;
export const DEFAULT_GROUP_WINDOW_MS = 3000;
export const DEFAULT_MIN_COOLDOWN_MS = 0;

export interface ImageTaskQueueOptions {
	/** Maximum concurrent background image model calls across the isolate. */
	maxGlobalConcurrency?: number;
	/** Maximum concurrent in-flight image model calls for a single video/row group. */
	maxGroupConcurrency?: number;
	/** Maximum images a single video/row group may start within `groupWindowMs`. */
	groupWindowLimit?: number;
	/** Sliding rate-limit window in ms per video/row group (`3` per `3000` ms). */
	groupWindowMs?: number;
	/** Optional minimum spacing between consecutive starts in the same group. */
	minCooldownMs?: number;
	/** Clock override for deterministic unit testing. */
	now?: () => number;
}

export interface ImageTaskDescriptor<T> {
	/** Logical owner (`batch-<id>` per video/row or `image-gen:<user>`). */
	groupId: string;
	/** Background I/O work (`env.AI.run` / network fetch). */
	execute: () => Promise<T>;
	/** Optional cancellation signal; aborts queued tasks before they consume I/O. */
	signal?: AbortSignal;
}

export interface ImageTaskQueueStats {
	active: number;
	queued: number;
	groups: number;
	maxGlobalConcurrency: number;
	maxGroupConcurrency: number;
	groupWindowLimit: number;
	groupWindowMs: number;
}

type WaitResolution =
	| { granted: true }
	| { granted: false; waitMs: number };

interface SlotWaiter {
	cancelled: boolean;
	signal?: AbortSignal;
	cleanupAbort: (() => void) | null;
	resolve: (resolution: WaitResolution) => void;
	reject: (reason: unknown) => void;
}

interface GroupLane {
	readonly id: string;
	readonly waiters: SlotWaiter[];
	active: number;
	rateSleeping: number;
	readonly startedTimestamps: number[];
	lastDispatchedAt: number;
}

function createAbortError(reason?: unknown): Error {
	if (reason instanceof Error && reason.name === "AbortError") {
		return reason;
	}
	const msg =
		reason instanceof Error && reason.message
			? reason.message
			: typeof reason === "string" && reason
				? reason
				: "Image task aborted";
	const err = new Error(msg);
	err.name = "AbortError";
	return err;
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	const delay = Math.max(0, Math.ceil(ms));
	if (signal && signal.aborted) {
		return Promise.reject(createAbortError(signal.reason));
	}
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		let cleanup: (() => void) | null = null;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			if (cleanup) cleanup();
			resolve();
		}, delay);
		if (signal && typeof signal.addEventListener === "function") {
			const onAbort = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				cleanup = null;
				reject(createAbortError(signal.reason));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			cleanup = () => {
				signal.removeEventListener("abort", onAbort);
			};
		}
	});
}

/*
 * Serializes synchronous CPU transformations (e.g. base64 encoding of large PNG
 * buffers) across macrotask turns so two large images never encode back-to-back
 * in the same synchronous turn of the event loop.
 *
 * Instantiate one per streaming request (`new EventLoopCpuSerializer()`) when
 * serving concurrent HTTP requests so macrotask `setTimeout(..., 0)` yields
 * stay inside each request's own `workerd` `IoContext`.
 */
export class EventLoopCpuSerializer {
	private chain: Promise<void> = Promise.resolve();
	private pending = 0;

	get pendingCount(): number {
		return this.pending;
	}

	run<T>(work: () => T | Promise<T>): Promise<T> {
		const shouldYield = this.pending > 0;
		this.pending++;
		const next = this.chain.then(async () => {
			try {
				if (shouldYield) {
					await new Promise<void>((resolve) => setTimeout(resolve, 0));
				}
				return await work();
			} finally {
				this.pending = Math.max(0, this.pending - 1);
			}
		});
		this.chain = next.then(
			() => undefined,
			() => undefined
		);
		return next;
	}
}

export class ImageTaskQueue {
	readonly maxGlobalConcurrency: number;
	readonly maxGroupConcurrency: number;
	readonly groupWindowLimit: number;
	readonly groupWindowMs: number;
	readonly minCooldownMs: number;
	readonly cpu = new EventLoopCpuSerializer();

	private readonly now: () => number;
	private readonly lanes = new Map<string, GroupLane>();
	private readonly groupRing: string[] = [];
	private rrCursor = 0;
	private activeCount = 0;
	private queuedCount = 0;
	private notifyScheduled = false;

	constructor(options: ImageTaskQueueOptions = {}) {
		this.maxGlobalConcurrency = Math.max(
			1,
			Math.floor(options.maxGlobalConcurrency ?? DEFAULT_GLOBAL_IMAGE_CONCURRENCY)
		);
		this.maxGroupConcurrency = Math.max(
			1,
			Math.min(
				this.maxGlobalConcurrency,
				Math.floor(options.maxGroupConcurrency ?? DEFAULT_GROUP_IMAGE_CONCURRENCY)
			)
		);
		this.groupWindowLimit = Math.max(
			1,
			Math.floor(options.groupWindowLimit ?? DEFAULT_GROUP_WINDOW_LIMIT)
		);
		this.groupWindowMs = Math.max(
			0,
			Math.floor(options.groupWindowMs ?? DEFAULT_GROUP_WINDOW_MS)
		);
		this.minCooldownMs = Math.max(
			0,
			Math.floor(options.minCooldownMs ?? DEFAULT_MIN_COOLDOWN_MS)
		);
		this.now = options.now || (() => Date.now());
	}

	stats(): ImageTaskQueueStats {
		for (const groupId of Array.from(this.groupRing)) {
			this.cleanupLaneIfIdle(groupId);
		}
		return {
			active: this.activeCount,
			queued: this.queuedCount,
			groups: this.lanes.size,
			maxGlobalConcurrency: this.maxGlobalConcurrency,
			maxGroupConcurrency: this.maxGroupConcurrency,
			groupWindowLimit: this.groupWindowLimit,
			groupWindowMs: this.groupWindowMs
		};
	}

	/*
	 * Non-blocking task submission. Returns a Promise that settles with the
	 * task's result while all timers (`abortableSleep`) and I/O (`execute()`)
	 * run strictly inside the caller's own async execution context.
	 */
	async enqueue<T>(descriptor: ImageTaskDescriptor<T>): Promise<T> {
		const signal = descriptor.signal;
		if (signal && signal.aborted) {
			throw createAbortError(signal.reason);
		}

		const groupId = String(descriptor.groupId || "default").trim() || "default";
		this.queuedCount++;
		let slotAcquired = false;

		try {
			let prioritizeFront = false;
			while (!slotAcquired) {
				const resolution = await this.waitForTurn(
					groupId,
					signal,
					prioritizeFront
				);
				if (resolution.granted) {
					slotAcquired = true;
					this.queuedCount = Math.max(0, this.queuedCount - 1);
					break;
				}

				/*
				 * Rate-window pacing wait runs in THIS caller's own `IoContext`
				 * (`setTimeout`), never on a shared cross-request timer, and
				 * does not hold a global worker slot while waiting.
				 */
				const lane = this.ensureLane(groupId);
				lane.rateSleeping++;
				try {
					await abortableSleep(resolution.waitMs, signal);
				} finally {
					lane.rateSleeping = Math.max(0, lane.rateSleeping - 1);
					this.cleanupLaneIfIdle(groupId);
				}
				prioritizeFront = true;
			}
		} catch (err) {
			if (!slotAcquired) {
				this.queuedCount = Math.max(0, this.queuedCount - 1);
				this.cleanupLaneIfIdle(groupId);
				this.scheduleNotify();
			}
			throw err;
		}

		try {
			if (signal && signal.aborted) {
				throw createAbortError(signal.reason);
			}
			return await descriptor.execute();
		} finally {
			this.releaseSlot(groupId);
		}
	}

	private ensureLane(groupId: string): GroupLane {
		let lane = this.lanes.get(groupId);
		if (!lane) {
			lane = {
				id: groupId,
				waiters: [],
				active: 0,
				rateSleeping: 0,
				startedTimestamps: [],
				lastDispatchedAt: -Infinity
			};
			this.lanes.set(groupId, lane);
			this.groupRing.push(groupId);
		}
		return lane;
	}

	private waitForTurn(
		groupId: string,
		signal: AbortSignal | undefined,
		prioritizeFront: boolean
	): Promise<WaitResolution> {
		if (signal && signal.aborted) {
			return Promise.reject(createAbortError(signal.reason));
		}

		return new Promise<WaitResolution>((resolve, reject) => {
			const lane = this.ensureLane(groupId);
			const waiter: SlotWaiter = {
				cancelled: false,
				signal,
				cleanupAbort: null,
				resolve,
				reject
			};

			if (prioritizeFront) {
				lane.waiters.unshift(waiter);
			} else {
				lane.waiters.push(waiter);
			}

			if (signal && typeof signal.addEventListener === "function") {
				const onAbort = () => {
					if (waiter.cancelled) return;
					waiter.cancelled = true;
					const idx = lane.waiters.indexOf(waiter);
					if (idx !== -1) {
						lane.waiters.splice(idx, 1);
					}
					waiter.cleanupAbort = null;
					this.cleanupLaneIfIdle(groupId);
					reject(createAbortError(signal.reason));
					this.scheduleNotify();
				};
				signal.addEventListener("abort", onAbort, { once: true });
				waiter.cleanupAbort = () => {
					signal.removeEventListener("abort", onAbort);
				};
			}

			this.scheduleNotify();
		});
	}

	private releaseSlot(groupId: string): void {
		this.activeCount = Math.max(0, this.activeCount - 1);
		const lane = this.lanes.get(groupId);
		if (lane) {
			lane.active = Math.max(0, lane.active - 1);
		}
		this.cleanupLaneIfIdle(groupId);
		this.scheduleNotify();
	}

	private scheduleNotify(): void {
		if (this.notifyScheduled) return;
		this.notifyScheduled = true;
		Promise.resolve().then(() => {
			this.notifyScheduled = false;
			this.notifyWaiters();
		});
	}

	private pruneGroupTimestamps(lane: GroupLane, now: number): void {
		if (this.groupWindowMs <= 0) {
			lane.startedTimestamps.length = 0;
			return;
		}
		const cutoff = now - this.groupWindowMs;
		while (
			lane.startedTimestamps.length > 0 &&
			lane.startedTimestamps[0] <= cutoff
		) {
			lane.startedTimestamps.shift();
		}
	}

	private earliestSlotAt(lane: GroupLane, now: number): number {
		let readyAt = now;
		if (this.minCooldownMs > 0 && Number.isFinite(lane.lastDispatchedAt)) {
			readyAt = Math.max(readyAt, lane.lastDispatchedAt + this.minCooldownMs);
		}
		if (this.groupWindowMs > 0) {
			this.pruneGroupTimestamps(lane, now);
			if (lane.startedTimestamps.length >= this.groupWindowLimit) {
				const oldestIdx =
					lane.startedTimestamps.length - this.groupWindowLimit;
				const windowReadyAt =
					lane.startedTimestamps[oldestIdx] + this.groupWindowMs;
				readyAt = Math.max(readyAt, windowReadyAt);
			}
		}
		return readyAt;
	}

	private cleanupLaneIfIdle(groupId: string): void {
		const lane = this.lanes.get(groupId);
		if (!lane) return;
		if (
			lane.waiters.length === 0 &&
			lane.active === 0 &&
			lane.rateSleeping === 0
		) {
			const now = this.now();
			this.pruneGroupTimestamps(lane, now);
			const cooldownDone =
				this.minCooldownMs <= 0 ||
				!Number.isFinite(lane.lastDispatchedAt) ||
				lane.lastDispatchedAt + this.minCooldownMs <= now;
			if (lane.startedTimestamps.length === 0 && cooldownDone) {
				this.lanes.delete(groupId);
				const ringIdx = this.groupRing.indexOf(groupId);
				if (ringIdx !== -1) {
					this.groupRing.splice(ringIdx, 1);
					if (this.rrCursor >= this.groupRing.length) {
						this.rrCursor = 0;
					}
				}
			}
		}
	}

	private shiftLiveWaiter(lane: GroupLane): SlotWaiter | null {
		while (lane.waiters.length > 0) {
			const candidate = lane.waiters.shift()!;
			if (candidate.cleanupAbort) {
				candidate.cleanupAbort();
				candidate.cleanupAbort = null;
			}
			if (candidate.cancelled || (candidate.signal && candidate.signal.aborted)) {
				candidate.cancelled = true;
				candidate.reject(
					createAbortError(candidate.signal && candidate.signal.reason)
				);
				continue;
			}
			return candidate;
		}
		return null;
	}

	private notifyWaiters(): void {
		/*
		 * Pass 1: grant immediate worker-pool slots in round-robin order across
		 * all groups whose rate windows are currently open (`readyAt <= now`).
		 */
		while (
			this.activeCount < this.maxGlobalConcurrency &&
			this.groupRing.length > 0
		) {
			const now = this.now();
			let grantedOne = false;
			const groupCount = this.groupRing.length;

			for (let offset = 0; offset < groupCount; offset++) {
				if (this.groupRing.length === 0) break;
				const idx = (this.rrCursor + offset) % this.groupRing.length;
				const groupId = this.groupRing[idx];
				const lane = this.lanes.get(groupId);
				if (!lane || lane.waiters.length === 0) {
					continue;
				}
				if (lane.active >= this.maxGroupConcurrency) {
					continue;
				}

				const readyAt = this.earliestSlotAt(lane, now);
				if (readyAt > now) {
					continue;
				}

				const waiter = this.shiftLiveWaiter(lane);
				if (!waiter) {
					this.cleanupLaneIfIdle(groupId);
					grantedOne = true;
					break;
				}

				this.rrCursor = (idx + 1) % Math.max(1, this.groupRing.length);
				this.activeCount++;
				lane.active++;
				lane.lastDispatchedAt = now;
				if (this.groupWindowMs > 0) {
					lane.startedTimestamps.push(now);
				}
				grantedOne = true;
				waiter.resolve({ granted: true });
				break;
			}

			if (!grantedOne) {
				break;
			}
		}

		/*
		 * Pass 2: for any group that still has capacity under `maxGroupConcurrency`
		 * (`lane.active + lane.rateSleeping < this.maxGroupConcurrency`) and whose
		 * waiters are rate-limited (`readyAt > now`), wake those waiters with
		 * `{ granted: false, waitMs }` so they sleep inside their OWN request's
		 * `IoContext` (`abortableSleep`) and wake right on schedule.
		 */
		const now = this.now();
		for (const groupId of Array.from(this.groupRing)) {
			const lane = this.lanes.get(groupId);
			if (!lane || lane.waiters.length === 0) continue;

			const readyAt = this.earliestSlotAt(lane, now);
			if (readyAt <= now) continue;

			const waitMs = Math.max(1, readyAt - now);
			while (
				lane.waiters.length > 0 &&
				lane.active + lane.rateSleeping < this.maxGroupConcurrency
			) {
				const waiter = this.shiftLiveWaiter(lane);
				if (!waiter) break;
				waiter.resolve({ granted: false, waitMs });
			}
			this.cleanupLaneIfIdle(groupId);
		}
	}
}

/*
 * Shared isolate-level non-blocking image task queue used by both
 * `POST /api/image-batch` and `GET /image/gen` so concurrent batch streams and
 * manual 2-image clicks coordinate fairly without cross-request timer hazards.
 */
export const sharedImageTaskQueue = new ImageTaskQueue({
	maxGlobalConcurrency: DEFAULT_GLOBAL_IMAGE_CONCURRENCY,
	maxGroupConcurrency: DEFAULT_GROUP_IMAGE_CONCURRENCY,
	groupWindowLimit: DEFAULT_GROUP_WINDOW_LIMIT,
	groupWindowMs: DEFAULT_GROUP_WINDOW_MS,
	minCooldownMs: DEFAULT_MIN_COOLDOWN_MS
});
