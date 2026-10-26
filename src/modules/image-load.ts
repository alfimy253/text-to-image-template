/*
 * Server-load balancing + provider backoff for AI image generation
 * (`src/modules/image-load.ts`).
 *
 * The studio no longer hides behind a hard "N images per time window" rule to
 * keep the isolate alive. Pacing per video/row (3 per 3 s) is still applied by
 * `ImageTaskQueue` so one row cannot monopolise the worker, but the *global*
 * safety valve is now demand driven:
 *
 *   1. Adaptive concurrency (AIMD).
 *      The governor publishes how many image model calls may run at once.
 *      It starts conservatively (`IMAGE_LOAD_START_CONCURRENCY`), grows by one
 *      after every `IMAGE_LOAD_RECOVERY_WINDOW` consecutive successful calls
 *      (up to `IMAGE_LOAD_MAX_CONCURRENCY`), and halves itself the moment the
 *      provider answers with a load signal. This is additive-increase /
 *      multiplicative-decrease, the same control loop TCP uses.
 *
 *   2. Cooldown after an overload signal.
 *      A provider "capacity / 429 / 503 / overload" answer parks *new* image
 *      work for `cooldownBase * 2^streak` ms (capped). `ImageTaskQueue` folds
 *      that cooldown into `readyAt`, so waiters sleep in their own request's
 *      `IoContext` (`abortableSleep`) instead of cross-request timers.
 *
 *   3. Exponential backoff with jitter for retries.
 *      `retryDelayMs()` returns base * 2^(attempt-1) with 50–100 % jitter so a
 *      burst of scenes does not retry in lockstep (thundering herd). A
 *      provider supplied `Retry-After` (header, `retryAfterMs`, or "retry after
 *      3s" in the message) always wins, clamped to `retryMaxMs`.
 *
 *   4. Failure classification.
 *      `classify()` separates load failures (retry after backoff, cut
 *      concurrency) from transient ones (retry, keep concurrency) and from
 *      fatal ones (bad model slug, rejected prompt: do NOT burn another paid
 *      provider call).
 *
 * Everything here is pure in-memory state inside one isolate, so it is a
 * load-shedding heuristic, not a quota: it never denies a request, it only
 * decides *when* the work runs. No KV, Durable Object or migration is used.
 */

export type ImageLoadFailureKind = "overload" | "transient" | "fatal";

export interface ImageFailureClassification {
	/** What kind of failure this is. */
	kind: ImageLoadFailureKind;
	/** Whether another attempt could plausibly succeed. */
	retryable: boolean;
	/** Provider supplied retry hint in ms (already normalised), or null. */
	retryAfterMs: number | null;
	/** Short reason kept for logs / headers. */
	reason: string;
}

export interface ImageLoadSnapshot {
	/** Current global image-call concurrency ceiling (>= minConcurrency). */
	limit: number;
	minConcurrency: number;
	maxConcurrency: number;
	/** Consecutive successful calls counted toward the next increase. */
	consecutiveOk: number;
	/** Consecutive overload signals (drives the cooldown doubling). */
	overloadStreak: number;
	/** Milliseconds of load cooldown still pending (0 = open). */
	cooldownRemainingMs: number;
	/** Total calls seen, for observability only. */
	successes: number;
	failures: number;
}

export interface ImageLoadGovernorOptions {
	minConcurrency?: number;
	startConcurrency?: number;
	maxConcurrency?: number;
	/** Successful calls needed before concurrency grows by one. */
	recoveryWindow?: number;
	/** First retry delay (ms) before jitter/doubling. */
	retryBaseMs?: number;
	/** Hard ceiling for a single retry delay (ms). */
	retryMaxMs?: number;
	/** First cooldown after an overload signal (ms). */
	cooldownBaseMs?: number;
	/** Hard ceiling for the load cooldown (ms). */
	cooldownMaxMs?: number;
	/** Clock override for deterministic tests. */
	now?: () => number;
	/** Jitter source in [0, 1) for deterministic tests. */
	random?: () => number;
}

export const IMAGE_LOAD_MIN_CONCURRENCY = 1;
export const IMAGE_LOAD_START_CONCURRENCY = 3;
export const IMAGE_LOAD_MAX_CONCURRENCY = 6;
export const IMAGE_LOAD_RECOVERY_WINDOW = 4;
export const IMAGE_LOAD_RETRY_BASE_MS = 800;
export const IMAGE_LOAD_RETRY_MAX_MS = 20000;
export const IMAGE_LOAD_COOLDOWN_BASE_MS = 750;
export const IMAGE_LOAD_COOLDOWN_MAX_MS = 10000;

/*
 * Attempts per image when the provider signals load/transient trouble. A fatal
 * error stops after the first attempt so a bad model slug never costs a second
 * paid inference. The whole retry sequence also has to fit inside
 * `IMAGE_RETRY_BUDGET_MS` (see `image-batch.ts`).
 */
export const IMAGE_LOAD_MAX_ATTEMPTS = 4;

/*
 * Load signals. Deliberately broad: Workers AI wraps provider trouble in a
 * few different shapes (`AiError: 3043`, `429`, `503`, "capacity exceeded",
 * "Allocation quota exceeded", plain JSON error bodies), and every one of them
 * means "the fleet is unhappy — slow down and retry", not "this prompt is
 * invalid".
 */
const OVERLOAD_PATTERNS: readonly RegExp[] = [
	/\b429\b/,
	/\b502\b/,
	/\b503\b/,
	/\b504\b/,
	/too many requests/i,
	/rate[ _-]?limit/i,
	/capacity/i,
	/overload(?:ed|ing)?/i,
	/service unavailable/i,
	/temporarily unavailable/i,
	/try again later/i,
	/server (?:is )?busy/i,
	/server (?:is )?(?:over)?loaded/i,
	/resource exhausted/i,
	/allocation quota/i,
	/quota exceeded/i,
	/concurren(?:cy|t)[ _-]?limit/i
];

/*
 * Transient, non-load failures: the same request may succeed on a retry but the
 * fleet is not necessarily saturated, so concurrency is left alone.
 */
const TRANSIENT_PATTERNS: readonly RegExp[] = [
	/3043/,
	/internal (?:server )?error/i,
	/timed? ?out/i,
	/timeout/i,
	/econnreset/i,
	/network/i,
	/fetch failed/i,
	/socket/i,
	/premature|unexpected end/i,
	/empty (?:image|response|body)/i,
	/not an image/i,
	/invalid image/i,
	/malformed/i,
	/unexpected response/i
];

/*
 * Fatal failures: retrying cannot help (a retired model slug, a rejected
 * prompt or an unbound binding). Kept narrow on purpose — a false "fatal"
 * costs the user a scene.
 */
const FATAL_PATTERNS: readonly RegExp[] = [
	/\b400\b/,
	/\b401\b/,
	/\b403\b/,
	/\b404\b/,
	/no such (?:model|host)/i,
	/model .*(?:not found|deprecated|retired|does not exist)/i,
	/(?:not found|deprecated|retired) model/i,
	/invalid prompt/i,
	/prompt (?:is )?too long/i,
	/binding not configured/i,
	/unsupported (?:model|parameter)/i
];

function clampNumber(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, Math.floor(value)));
}

function readErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message || error.name || "Error";
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const record = error as Record<string, unknown>;
		for (const key of ["message", "error", "detail", "reason"]) {
			const value = record[key];
			if (typeof value === "string" && value) return value;
			if (value instanceof Error && value.message) return value.message;
		}
		try {
			const serialized = JSON.stringify(error);
			if (serialized && serialized !== "{}") return serialized;
		} catch {
			/* ignore */
		}
	}
	return String(error ?? "");
}

/*
 * Normalises whatever retry hint the provider gave us into milliseconds.
 *
 * Accepted shapes (checked in order):
 *   error.retryAfterMs              -> ms
 *   error.retryAfter                -> seconds when < 1000, else ms
 *   error.headers.get("Retry-After")-> seconds, or an HTTP date
 *   message "retry after 3s" / "Retry-After: 3"
 */
export function parseRetryAfterMs(error: unknown): number | null {
	const record = (error && typeof error === "object" ? error : null) as
		| Record<string, any>
		| null;

	const asMs = (value: unknown): number | null => {
		const number = Number(value);
		if (!Number.isFinite(number) || number <= 0) return null;
		/* A bare number under a minute is seconds (HTTP Retry-After convention). */
		return Math.round(number < 1000 ? number * 1000 : number);
	};

	if (record) {
		/* `retryAfterMs` is explicitly milliseconds: never re-read as seconds. */
		const directMs = Number(record.retryAfterMs);
		if (Number.isFinite(directMs) && directMs > 0) return Math.round(directMs);
		const retryAfter = asMs(record.retryAfter);
		if (retryAfter !== null) return retryAfter;

		const headers = record.headers;
		if (headers && typeof headers.get === "function") {
			try {
				const raw = headers.get("Retry-After");
				if (raw) {
					const seconds = Number(String(raw).trim());
					if (Number.isFinite(seconds) && seconds > 0) {
						return Math.round(seconds * 1000);
					}
					const at = Date.parse(String(raw));
					if (Number.isFinite(at)) {
						return Math.max(0, at - Date.now());
					}
				}
			} catch {
				/* ignore malformed header bags */
			}
		}
	}

	const message = readErrorMessage(error);
	const match = /retry[\s_-]*after[:\s]+(\d+(?:\.\d+)?)\s*(ms|s|seconds?)?/i.exec(message);
	if (match) {
		const value = Number(match[1]);
		if (Number.isFinite(value) && value > 0) {
			return Math.round(/ms/i.test(match[2] || "") ? value : value * 1000);
		}
	}
	return null;
}

/** Pure classification of an image-provider failure (no state, safe to unit test). */
export function classifyImageFailure(error: unknown): ImageFailureClassification {
	const message = readErrorMessage(error);
	const retryAfterMs = parseRetryAfterMs(error);

	if (OVERLOAD_PATTERNS.some((pattern) => pattern.test(message))) {
		return {
			kind: "overload",
			retryable: true,
			retryAfterMs,
			reason: message.slice(0, 160) || "provider overloaded"
		};
	}
	if (FATAL_PATTERNS.some((pattern) => pattern.test(message))) {
		return {
			kind: "fatal",
			retryable: false,
			retryAfterMs: null,
			reason: message.slice(0, 160) || "permanent provider failure"
		};
	}
	if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(message))) {
		return {
			kind: "transient",
			retryable: true,
			retryAfterMs,
			reason: message.slice(0, 160) || "transient provider failure"
		};
	}
	/* Unknown shape: treat as transient, retry once with backoff. */
	return {
		kind: "transient",
		retryable: true,
		retryAfterMs,
		reason: message.slice(0, 160) || "unknown provider failure"
	};
}

/**
 * Isolate-local adaptive load governor shared by every image entry point.
 *
 * It never denies work and never stores anything: it only reports how many
 * image model calls may run concurrently right now, and how long new work
 * should wait after the provider complained about load.
 */
export class ImageLoadGovernor {
	readonly minConcurrency: number;
	readonly maxConcurrency: number;
	readonly recoveryWindow: number;
	readonly retryBaseMs: number;
	readonly retryMaxMs: number;
	readonly cooldownBaseMs: number;
	readonly cooldownMaxMs: number;

	private readonly now: () => number;
	private readonly random: () => number;
	private currentLimit: number;
	private consecutiveOk = 0;
	private overloadStreak = 0;
	private cooldownUntil = 0;
	private lastOverloadAt = -Infinity;
	private successes = 0;
	private failures = 0;

	constructor(options: ImageLoadGovernorOptions = {}) {
		this.minConcurrency = Math.max(
			1,
			Math.floor(options.minConcurrency ?? IMAGE_LOAD_MIN_CONCURRENCY)
		);
		this.maxConcurrency = Math.max(
			this.minConcurrency,
			Math.floor(options.maxConcurrency ?? IMAGE_LOAD_MAX_CONCURRENCY)
		);
		this.currentLimit = clampNumber(
			options.startConcurrency ?? IMAGE_LOAD_START_CONCURRENCY,
			this.minConcurrency,
			this.maxConcurrency
		);
		this.recoveryWindow = Math.max(
			1,
			Math.floor(options.recoveryWindow ?? IMAGE_LOAD_RECOVERY_WINDOW)
		);
		this.retryBaseMs = Math.max(1, Math.floor(options.retryBaseMs ?? IMAGE_LOAD_RETRY_BASE_MS));
		this.retryMaxMs = Math.max(this.retryBaseMs, Math.floor(options.retryMaxMs ?? IMAGE_LOAD_RETRY_MAX_MS));
		this.cooldownBaseMs = Math.max(
			1,
			Math.floor(options.cooldownBaseMs ?? IMAGE_LOAD_COOLDOWN_BASE_MS)
		);
		this.cooldownMaxMs = Math.max(
			this.cooldownBaseMs,
			Math.floor(options.cooldownMaxMs ?? IMAGE_LOAD_COOLDOWN_MAX_MS)
		);
		this.now = options.now || (() => Date.now());
		this.random = options.random || Math.random;
	}

	/** Current global image-call concurrency ceiling. */
	get limit(): number {
		return this.currentLimit;
	}

	/** Milliseconds of pending load cooldown (0 when the fleet is healthy). */
	get cooldownRemainingMs(): number {
		const remaining = this.cooldownUntil - this.now();
		return remaining > 0 ? Math.round(remaining) : 0;
	}

	snapshot(): ImageLoadSnapshot {
		return {
			limit: this.currentLimit,
			minConcurrency: this.minConcurrency,
			maxConcurrency: this.maxConcurrency,
			consecutiveOk: this.consecutiveOk,
			overloadStreak: this.overloadStreak,
			cooldownRemainingMs: this.cooldownRemainingMs,
			successes: this.successes,
			failures: this.failures
		};
	}

	/** Forget all learned state (used by tests and by a fresh isolate boot). */
	reset(): void {
		this.currentLimit = clampNumber(
			IMAGE_LOAD_START_CONCURRENCY,
			this.minConcurrency,
			this.maxConcurrency
		);
		this.consecutiveOk = 0;
		this.overloadStreak = 0;
		this.cooldownUntil = 0;
		this.lastOverloadAt = -Infinity;
		this.successes = 0;
		this.failures = 0;
	}

	classify(error: unknown): ImageFailureClassification {
		return classifyImageFailure(error);
	}

	/** One image model call finished successfully: consider widening the pool. */
	noteSuccess(): void {
		this.successes++;
		this.overloadStreak = 0;
		if (this.cooldownRemainingMs > 0) {
			/* Still inside the cooldown: hold the ceiling, but keep the streak. */
			this.consecutiveOk = 0;
			return;
		}
		this.consecutiveOk++;
		if (this.consecutiveOk >= this.recoveryWindow && this.currentLimit < this.maxConcurrency) {
			this.currentLimit++;
			this.consecutiveOk = 0;
		}
	}

	/*
	 * One image model call failed. Overload halving is immediate and
	 * deterministic; the cooldown doubles per consecutive overload signal so a
	 * sustained outage backs off geometrically instead of hammering.
	 */
	noteFailure(classification: ImageFailureClassification): number {
		this.failures++;
		this.consecutiveOk = 0;
		if (classification.kind !== "overload") {
			return 0;
		}
		this.currentLimit = Math.max(this.minConcurrency, Math.floor(this.currentLimit / 2));
		/*
		 * One scene can burn three provider calls (primary + fallbacks) in a few
		 * hundred ms. Those are one load event, not three, so the streak only
		 * grows once per cooldown window — otherwise a single doomed scene would
		 * park the whole fleet for the maximum cooldown.
		 */
		const now = this.now();
		if (now - this.lastOverloadAt >= this.cooldownBaseMs) {
			this.overloadStreak = Math.min(8, this.overloadStreak + 1);
		}
		this.lastOverloadAt = now;
		const grown = this.cooldownBaseMs * Math.pow(2, this.overloadStreak - 1);
		const hinted =
			typeof classification.retryAfterMs === "number" && classification.retryAfterMs > 0
				? classification.retryAfterMs
				: 0;
		const cooldown = Math.min(
			this.cooldownMaxMs,
			Math.max(this.cooldownBaseMs, Math.max(grown, hinted))
		);
		this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldown);
		return cooldown;
	}

	/** Convenience: classify + note in one call; returns the classification. */
	observeFailure(error: unknown): ImageFailureClassification {
		const classification = this.classify(error);
		this.noteFailure(classification);
		return classification;
	}

	/**
	 * Delay before retry number `attempt` (1-based).
	 *
	 * Provider hint wins; otherwise exponential with 50–100 % jitter, so eight
	 * scenes that all hit `429` spread their retries instead of retrying in
	 * lockstep.
	 */
	retryDelayMs(attempt: number, retryAfterMs?: number | null): number {
		const hinted = Number(retryAfterMs);
		if (Number.isFinite(hinted) && hinted > 0) {
			return clampNumber(hinted, 1, this.retryMaxMs);
		}
		const step = Math.max(0, Math.floor(attempt) - 1);
		const base = Math.min(this.retryMaxMs, this.retryBaseMs * Math.pow(2, step));
		const jitter = 0.5 + this.random() * 0.5;
		return clampNumber(base * jitter, 1, this.retryMaxMs);
	}
}

/*
 * One governor per isolate: `/image/gen`, `POST /api/image`, `POST
 * /api/image-batch` and every per-row pacing queue read the same ceiling, so a
 * burst from one browser cannot multiply the fleet-wide concurrency.
 */
export const sharedImageLoadGovernor = new ImageLoadGovernor();
