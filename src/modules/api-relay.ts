/*
 * API rotation across the primary Worker and the registered backup Workers
 * (`src/modules/api-relay.ts`).
 *
 * ------------------------------------------------------------------
 * WHY
 * ------------------------------------------------------------------
 * The settings page (/{day}/config/uvxyz) has always been able to store up to
 * three backup Worker URLs (`config:workers`), but until now nothing in the
 * codebase ever contacted them: they were documented as "stored only". Every
 * image, prompt, script and voiceover therefore burned the *primary* Worker's
 * Workers AI neurons (the free plan is 10,000 neurons/day per account), and all
 * of the inference load sat on one deployment.
 *
 * This module turns that list into a live pool:
 *
 *   local Worker  +  up to 3 registered backup Workers  =  one API pool
 *
 * Every route that would call `env.AI.run(...)` can now run that call on
 * whichever pool member the rotation policy picks, with health tracking,
 * circuit breaking and automatic failover back to local. Credentials, KV,
 * credits, CMS and payments stay on the local Worker: only the *inference*
 * hop is distributed, so a session cookie, a credit counter or a payment
 * record can never be split across two deployments.
 *
 * ------------------------------------------------------------------
 * HOW (three layers)
 * ------------------------------------------------------------------
 * 1. `withRelayedAi(env, request)`
 *      Wraps the Worker's `env` in a Proxy whose `AI` binding is a relay
 *      runtime. Every existing `env.AI.run(model, payload)` call site (image
 *      generation, image prompts, SEO planner/writer, MeloTTS, the /tts
 *      fallback models, the demo /image/:i route) is therefore routed through
 *      the pool without touching a single call site.
 *
 * 2. `POST /api/relay/ai` (inbound compute endpoint)
 *      Executes ONE model call locally and returns the result. It is
 *      authenticated with a short-lived HMAC token (`x-yvs-relay-token`),
 *      restricted to Workers AI model slugs, size-capped, and it NEVER relays
 *      again — that is what makes worker -> worker -> worker loops impossible.
 *
 * 3. Browser rotation (`/api/relay/pool` + `src/client/api-rotation.ts`)
 *      Optionally the studio itself rotates the *whole* AI request across the
 *      pool (not just the model hop) using a signed, short-lived ticket. The
 *      ticket carries only the identity needed to authorize the AI routes and
 *      is scoped to those paths, so `/api/config/*`, `/api/payments/*` and
 *      account routes always stay on the primary Worker.
 *
 * ------------------------------------------------------------------
 * INVARIANTS
 * ------------------------------------------------------------------
 *   - KV, accounts, credits, CMS, payments, render jobs: local only.
 *   - Inference: local or any healthy pool member.
 *   - A relayed call is a plain `fetch` to `<worker>/api/relay/ai`; the
 *     receiving Worker answers with the same result shape `env.AI.run` would.
 *   - No new binding, Durable Object or migration is required. Everything is
 *     in-isolate memory plus the two existing KV keys (`config:workers`,
 *     `config:relay`).
 *   - Relay is ON by default, but a pool with no registered backups resolves
 *     to `[local]`, so a single-Worker deployment behaves exactly as before.
 *   - A failing backup is circuit-broken (30 s -> 5 min) and never blocks the
 *     request: the call falls through to the next member and finally to local.
 */

import { classifyImageFailure } from "./image-load";
import {
	isInstructModel,
	orderLlmProviders,
	promptFromAiInput,
	readLlmConfig,
	resolveOpenRouterKey,
	runOpenRouterCompletion,
	type LlmConfig
} from "./llm-openrouter";

/* =============================================================
 * CONSTANTS
 * ============================================================= */

export const RELAY_CONFIG_KEY = "config:relay";
export const RELAY_WORKERS_KEY = "config:workers";

export const RELAY_AI_PATH = "/api/relay/ai";
export const RELAY_PING_PATH = "/api/relay/ping";
export const RELAY_POOL_PATH = "/api/relay/pool";
export const RELAY_STATUS_PATH = "/api/relay/status";
export const RELAY_CONFIG_PATH = "/api/relay/config";
export const RELAY_TEST_PATH = "/api/relay/test";

export const RELAY_TOKEN_HEADER = "x-yvs-relay-token";
export const RELAY_TICKET_HEADER = "x-yvs-relay-ticket";
export const RELAY_VERSION = 1;

/** Response header: `json` | `binary` (what the relay body contains). */
export const RELAY_RESULT_HEADER = "x-yvs-relay-result";
/** Response header on the compute endpoint when the model itself failed. */
export const RELAY_ERROR_KIND_HEADER = "x-yvs-relay-error-kind";

/**
 * Paths whose responses may be read cross-origin when a valid ticket is
 * present, and the only paths a client ticket is allowed to call.
 *
 * The list is deliberately limited to AI work: those are the routes whose
 * whole point is spending provider capacity. Anything stateful or privileged
 * (`/api/config/*`, `/api/payments/*`, `/api/session`, `/api/credits`, CMS,
 * render jobs) is intentionally absent and can never be reached with a ticket.
 */
function permitsNonVisualModel(model: string): boolean {
	return !/image|diffusion|flux|sdxl|dreamshaper/i.test(model) &&
		(isInstructModel(model) || /melotts|aura|whisper|tts/i.test(model));
}

export const RELAY_AI_PATHS = [
	"/api/script",
	"/api/seo-plan",
	"/api/voiceover",
	"/tts"
];

export const RELAY_CORS_EXPOSE_HEADERS = [
	"Content-Type",
	"Retry-After",
	"X-Credit-Usertype",
	"X-Credit-Images-Limit",
	"X-Credit-Images-Used",
	"X-Credit-Images-Remaining",
	"X-Voice-Index",
	"X-Image-Variant",
	"X-Pipeline-Version",
	"X-YVS-Relay-Served-By"
].join(", ");

/** Hard cap on a relayed request body (a model payload, never a file). */
export const RELAY_MAX_BODY_BYTES = 512 * 1024;
/** Hard cap on a relayed binary result (image / audio). */
export const RELAY_MAX_RESULT_BYTES = 24 * 1024 * 1024;
/** How long a worker->worker compute token stays valid. */
export const RELAY_TOKEN_TTL_MS = 120_000;
/** How long a browser ticket stays valid. */
export const RELAY_TICKET_TTL_MS = 180_000;
/** How long the resolved pool / config stays cached inside one isolate. */
export const RELAY_POOL_CACHE_MS = 20_000;
export const RELAY_CONFIG_CACHE_MS = 15_000;
/** Circuit breaker: first cooldown, doubling, and the ceiling. */
export const RELAY_COOLDOWN_BASE_MS = 30_000;
export const RELAY_COOLDOWN_MAX_MS = 300_000;

/**
 * The built-in HMAC secret. It is only a fallback: set the `RELAY_SECRET`
 * environment variable to the SAME value on every Worker in the pool to make
 * relay tokens unforgeable. With the fallback, any deployment of this source
 * can mint one (exactly like the hard-coded administrator password), so
 * `GET /api/relay/status` reports `usingDefaultSecret: true` as a warning.
 */
const DEFAULT_RELAY_SECRET = "yvs-api-relay-v1:4f2a9c17d8b64e05";

/** Models we are willing to execute for a caller. Workers AI slugs only. */
const RELAY_MODEL_PATTERN = /^@[a-z0-9-]+\/[A-Za-z0-9._/-]{2,120}$/;

/* =============================================================
 * TYPES
 * ============================================================= */

export type RelayStrategy = "round-robin" | "least-pending" | "weighted";

export interface RelayConfig {
	/** Master switch for worker->worker inference rotation. */
	enabled: boolean;
	/** How the next endpoint is chosen for each model call. */
	strategy: RelayStrategy;
	/** Relative weight of the local Worker in the `weighted` strategy. */
	localWeight: number;
	/** Let the studio rotate whole AI requests across the pool. */
	clientRotation: boolean;
	/** Maximum pool members tried for one model call (including local). */
	maxAttempts: number;
	/** Per-attempt timeout for a relayed model call, in ms. */
	timeoutMs: number;
	/** Circuit-breaker cooldown base, in ms. */
	cooldownMs: number;
}

export interface RelayPoolEntry {
	id: string;
	/** Absolute base URL without a trailing slash. */
	url: string;
	local: boolean;
	label: string;
}

export interface RelayHealth {
	successes: number;
	failures: number;
	consecutiveFailures: number;
	inFlight: number;
	openedUntil: number;
	lastError: string;
	lastUsedAt: number;
	latencyMs: number;
	ewmaMs: number;
}

export interface RelayRuntimeOptions {
	/** Test seams. */
	fetchImpl?: typeof fetch;
	now?: () => number;
	/** Request that owns the relayed calls (for AbortSignal + origin). */
	request?: Request;
	/** Extra path prefix used when the Worker is mounted under a route. */
	selfOrigin?: string;
	/** Promise of additional pool URLs (env-supplied), merged with KV. */
	envWorkers?: string[];
	/**
	 * True when this request was itself rotated here by the browser. The
	 * member that was deliberately chosen executes the call, instead of
	 * bouncing the inference back to the primary it just came from.
	 */
	preferLocal?: boolean;
}

export const RELAY_DEFAULT_CONFIG: RelayConfig = {
	enabled: true,
	strategy: "round-robin",
	localWeight: 1,
	clientRotation: true,
	maxAttempts: 3,
	timeoutMs: 100_000,
	cooldownMs: RELAY_COOLDOWN_BASE_MS
};

const RELAY_STRATEGIES: RelayStrategy[] = ["round-robin", "least-pending", "weighted"];

/* =============================================================
 * SMALL HELPERS
 * ============================================================= */

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: Object.assign(
			{ "Content-Type": "application/json", "Cache-Control": "no-store" },
			extraHeaders
		)
	});
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const num = Number(value);
	if (!Number.isFinite(num)) return fallback;
	return Math.min(max, Math.max(min, Math.round(num)));
}

function normalizeUrl(value: unknown): string {
	const raw = String(value == null ? "" : value).trim();
	if (!raw || raw.length > 500) return "";
	if (!/^https?:\/\//i.test(raw)) return "";
	try {
		const parsed = new URL(raw);
		/* Base origin only: `/api/relay/ai` is appended by the relay itself. */
		let path = parsed.pathname.replace(/\/+$/, "");
		if (path === "/api" || path.indexOf("/api/") === 0) path = "";
		return parsed.origin + path;
	} catch {
		return "";
	}
}

function normalizedOrigin(url: string): string {
	try {
		return new URL(url).origin.toLowerCase();
	} catch {
		return "";
	}
}

function toHex(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
	return out;
}

function fromHex(hex: string): Uint8Array | null {
	if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function base64UrlEncode(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string | null {
	try {
		const padded = value.replace(/-/g, "+").replace(/_/g, "/");
		const binary = atob(padded + "===".slice((padded.length + 3) % 4));
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

/** Length-safe equality for hex signatures. */
function timingSafeEqualHex(a: string, b: string): boolean {
	if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/* =============================================================
 * CONFIG
 * ============================================================= */

export function normalizeRelayConfig(raw: unknown): RelayConfig {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const strategy = String(source.strategy || "").trim().toLowerCase() as RelayStrategy;
	return {
		enabled: source.enabled === undefined ? RELAY_DEFAULT_CONFIG.enabled : Boolean(source.enabled),
		strategy: RELAY_STRATEGIES.indexOf(strategy) === -1 ? RELAY_DEFAULT_CONFIG.strategy : strategy,
		localWeight: clampInt(source.localWeight, 0, 10, RELAY_DEFAULT_CONFIG.localWeight),
		clientRotation:
			source.clientRotation === undefined
				? RELAY_DEFAULT_CONFIG.clientRotation
				: Boolean(source.clientRotation),
		maxAttempts: clampInt(source.maxAttempts, 1, 5, RELAY_DEFAULT_CONFIG.maxAttempts),
		timeoutMs: clampInt(source.timeoutMs, 5_000, 240_000, RELAY_DEFAULT_CONFIG.timeoutMs),
		cooldownMs: clampInt(source.cooldownMs, 1_000, 600_000, RELAY_DEFAULT_CONFIG.cooldownMs)
	};
}

let configCache: { key: string; at: number; value: RelayConfig } | null = null;

/** Test / admin hook: drop every isolate cache (config + pool). */
export function invalidateRelayCache(): void {
	configCache = null;
	poolCache = null;
	pingCache.clear();
}

/**
 * Reads `config:relay`. Without KV (e2e mode) or on a KV error the built-in
 * defaults are used, so rotation never depends on storage being available.
 * `RELAY_ENABLED=false` in the environment force-disables it for a deployment.
 */
export async function readRelayConfig(env: any, options: RelayRuntimeOptions = {}): Promise<RelayConfig> {
	/* The cache only has to notice an enabled/disabled env override. */
	const cacheKey = "relay|" + (env && env.RELAY_ENABLED ? String(env.RELAY_ENABLED) : "");
	const now = (options.now || Date.now)();
	if (configCache && configCache.key === cacheKey && now - configCache.at < RELAY_CONFIG_CACHE_MS) {
		/* A copy: a caller can never mutate the cached policy by accident. */
		return Object.assign({}, configCache.value);
	}

	let stored: unknown = null;
	if (env && env.KV_BINDING && typeof env.KV_BINDING.get === "function") {
		try {
			const raw = await env.KV_BINDING.get(RELAY_CONFIG_KEY);
			stored = raw ? JSON.parse(raw) : null;
		} catch {
			stored = null;
		}
	}

	const config = normalizeRelayConfig(stored);
	if (env && String(env.RELAY_ENABLED || "").toLowerCase() === "false") config.enabled = false;

	configCache = { key: cacheKey, at: now, value: config };
	return config;
}

export async function writeRelayConfig(env: any, raw: unknown): Promise<RelayConfig> {
	const config = normalizeRelayConfig(Object.assign({}, RELAY_DEFAULT_CONFIG, raw || {}));
	if (!env || !env.KV_BINDING) throw new Error("User storage not configured (bind the KV namespace)");
	await env.KV_BINDING.put(RELAY_CONFIG_KEY, JSON.stringify(config));
	invalidateRelayCache();
	return config;
}

/* =============================================================
 * POOL RESOLUTION
 * ============================================================= */

interface PoolCacheEntry {
	key: string;
	at: number;
	value: RelayPoolEntry[];
}

let poolCache: PoolCacheEntry | null = null;

function readWorkerUrls(env: any): Promise<string[]> {
	if (!env || !env.KV_BINDING || typeof env.KV_BINDING.get !== "function") return Promise.resolve([]);
	return env.KV_BINDING.get(RELAY_WORKERS_KEY)
		.then((raw: string | null) => {
			if (!raw) return [];
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed : [];
		})
		.catch(() => []);
}

/**
 * Resolves the pool: the local Worker first, then every registered backup
 * that is not the local origin and not a duplicate. Values are validated the
 * same way `POST /api/config/workers` validates them (http(s), <= 500 chars).
 */
export async function resolveRelayPool(
	env: any,
	selfOrigin: string,
	options: RelayRuntimeOptions = {}
): Promise<RelayPoolEntry[]> {
	const now = (options.now || Date.now)();
	const cacheKey = String(selfOrigin || "");
	if (poolCache && poolCache.key === cacheKey && now - poolCache.at < RELAY_POOL_CACHE_MS) {
		return poolCache.value;
	}

	/* KV first, then the deployment-wide env var, then explicit options. */
	const stored = await readWorkerUrls(env);
	const candidates: unknown[] = stored.slice();
	if (typeof env?.RELAY_WORKERS === "string") candidates.push(...env.RELAY_WORKERS.split(","));
	if (Array.isArray(options.envWorkers)) candidates.push(...options.envWorkers);

	const localOrigin = normalizedOrigin(selfOrigin);
	const seen = new Set<string>();
	const pool: RelayPoolEntry[] = [
		{ id: "local", url: selfOrigin || "", local: true, label: "This Worker" }
	];
	if (localOrigin) seen.add(localOrigin);

	for (const candidate of candidates) {
		const url = normalizeUrl(candidate);
		if (!url) continue;
		const origin = normalizedOrigin(url);
		if (!origin || seen.has(origin)) continue;
		seen.add(origin);
		/*
		 * The id is derived from the URL, not random: health and circuit state
		 * are keyed by it, and a random id lost every member's history each
		 * time the 20 s pool cache was rebuilt (so a broken backup looked
		 * healthy again every 20 s and was retried forever).
		 */
		pool.push({
			id: "worker:" + url,
			url,
			local: false,
			label: origin.replace(/^https?:\/\//, "")
		});
	}

	poolCache = { key: cacheKey, at: now, value: pool };
	return pool;
}

/* =============================================================
 * HEALTH + SELECTION
 * ============================================================= */

const healthStore = new Map<string, RelayHealth>();

function healthFor(key: string): RelayHealth {
	let entry = healthStore.get(key);
	if (!entry) {
		entry = {
			successes: 0,
			failures: 0,
			consecutiveFailures: 0,
			inFlight: 0,
			openedUntil: 0,
			lastError: "",
			lastUsedAt: 0,
			latencyMs: 0,
			ewmaMs: 0
		};
		healthStore.set(key, entry);
	}
	return entry;
}

export function relayHealthSnapshot(now = Date.now()): Record<string, RelayHealth & { state: string }> {
	const out: Record<string, RelayHealth & { state: string }> = {};
	healthStore.forEach((value, key) => {
		out[key] = Object.assign({}, value, {
			state: value.openedUntil > now ? "cooling" : value.inFlight > 0 ? "busy" : "ready"
		});
	});
	return out;
}

/** Test hook: forget all health history. */
export function resetRelayHealth(): void {
	healthStore.clear();
	roundRobinCursor = 0;
}

export function noteRelaySuccess(key: string, latencyMs: number, now = Date.now()): void {
	const entry = healthFor(key);
	entry.successes += 1;
	entry.consecutiveFailures = 0;
	entry.openedUntil = 0;
	entry.lastError = "";
	entry.lastUsedAt = now;
	entry.latencyMs = Math.max(0, Math.round(latencyMs));
	entry.ewmaMs = entry.ewmaMs ? Math.round(entry.ewmaMs * 0.7 + entry.latencyMs * 0.3) : entry.latencyMs;
}

export function noteRelayFailure(key: string, error: unknown, cooldownMs: number, now = Date.now()): void {
	const entry = healthFor(key);
	entry.failures += 1;
	entry.consecutiveFailures += 1;
	entry.lastUsedAt = now;
	entry.lastError = (error instanceof Error ? error.message : String(error || "")).slice(0, 200);
	const backoff = Math.min(
		RELAY_COOLDOWN_MAX_MS,
		Math.max(1_000, cooldownMs) * Math.pow(2, Math.max(0, entry.consecutiveFailures - 1))
	);
	entry.openedUntil = now + backoff;
}

/**
 * Worker-side model calls never treat a *fatal* model error (bad slug,
 * rejected prompt) as a pool failure: the endpoint is healthy, the request was
 * not. Overload/transient/unknown errors open the circuit so the next call
 * goes elsewhere. Network errors are always transient.
 */
function isTransientRelayFailure(error: unknown): boolean {
	if (!error) return true;
	const name = error instanceof Error ? error.name : "";
	/* The caller cancelled: never reroute work nobody is waiting for. */
	if (name === "AbortError") return false;
	if (name === "TimeoutError") return true;
	/* A backup that answered "this model call is invalid" is authoritative:
	 * another member would spend the same paid call on the same answer. */
	if (name === "ModelError") return false;
	const message = error instanceof Error ? error.message : String(error);
	/* A member with no AI binding is a pool problem, not a model problem. */
	if (/binding not configured/i.test(message)) return true;
	const classification = classifyImageFailure(error);
	return classification.kind !== "fatal";
}

let roundRobinCursor = 0;

/**
 * Orders the pool for one call.
 *
 * - `round-robin` rotates the starting point so consecutive calls hit
 *   different Workers.
 * - `least-pending` prefers the member with the fewest in-flight calls, then
 *   the lowest moving latency.
 * - `weighted` picks at random with `localWeight` for local and 1 per backup.
 *
 * Cooling members are pushed to the end (never removed) so a fully cooled
 * pool still answers instead of failing the request.
 */
export function orderRelayCandidates(
	pool: RelayPoolEntry[],
	config: RelayConfig,
	now = Date.now()
): RelayPoolEntry[] {
	if (!pool.length) return [];
	if (pool.length === 1) return pool.slice();

	const healthy = pool.filter((entry) => healthFor(entry.id).openedUntil <= now);
	const cooling = pool.filter((entry) => healthFor(entry.id).openedUntil > now);
	if (!healthy.length) {
		/* Everything is cooling: prefer local, then the soonest to recover. */
		return pool
			.slice()
			.sort((a, b) => {
				if (a.local !== b.local) return a.local ? -1 : 1;
				return healthFor(a.id).openedUntil - healthFor(b.id).openedUntil;
			});
	}

	let ordered: RelayPoolEntry[];
	if (config.strategy === "least-pending") {
		ordered = healthy.slice().sort((a, b) => {
			const ha = healthFor(a.id);
			const hb = healthFor(b.id);
			if (ha.inFlight !== hb.inFlight) return ha.inFlight - hb.inFlight;
			return (ha.ewmaMs || 0) - (hb.ewmaMs || 0);
		});
	} else if (config.strategy === "weighted") {
		const remaining = healthy.slice();
		ordered = [];
		while (remaining.length) {
			const weights = remaining.map((entry) => (entry.local ? Math.max(0, config.localWeight) : 1));
			const total = weights.reduce((sum, weight) => sum + weight, 0);
			if (total <= 0) {
				ordered.push(...remaining);
				break;
			}
			let roll = Math.random() * total;
			let picked = remaining.length - 1;
			for (let i = 0; i < remaining.length; i++) {
				roll -= weights[i];
				if (roll <= 0) {
					picked = i;
					break;
				}
			}
			ordered.push(remaining.splice(picked, 1)[0]);
		}
	} else {
		const start = roundRobinCursor % healthy.length;
		roundRobinCursor = (roundRobinCursor + 1) % 1_000_003;
		ordered = healthy.slice(start).concat(healthy.slice(0, start));
	}

	return ordered.concat(cooling);
}

/* =============================================================
 * TOKENS (worker -> worker) AND TICKETS (browser -> worker)
 * ============================================================= */

export function relaySecret(env: any): string {
	const configured = env && (env.RELAY_SECRET || env.YVS_RELAY_SECRET);
	const secret = String(configured == null ? "" : configured).trim();
	return secret || DEFAULT_RELAY_SECRET;
}

export function relayUsesDefaultSecret(env: any): boolean {
	return relaySecret(env) === DEFAULT_RELAY_SECRET;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
	let key = keyCache.get(secret);
	if (!key) {
		key = crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"]
		);
		keyCache.set(secret, key);
	}
	return key;
}

async function hmacHex(secret: string, message: string): Promise<string> {
	const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(message));
	return toHex(new Uint8Array(signature));
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return toHex(new Uint8Array(digest));
}

export interface RelayTokenPayload {
	v: number;
	k: "ai" | "client";
	exp: number;
	/** compute token: model slug + body digest. */
	m?: string;
	d?: string;
	/** client ticket: identity + allowed paths. */
	u?: string;
	e?: string;
	p?: string;
	g?: boolean;
	paths?: string[];
}

export async function signRelayToken(env: any, payload: RelayTokenPayload): Promise<string> {
	const body = base64UrlEncode(JSON.stringify(payload));
	const signature = await hmacHex(relaySecret(env), "yvs-relay." + body);
	return body + "." + signature;
}

export async function verifyRelayToken(
	env: any,
	token: unknown,
	kind: "ai" | "client",
	now = Date.now()
): Promise<RelayTokenPayload | null> {
	if (typeof token !== "string" || !token || token.length > 4096) return null;
	const split = token.lastIndexOf(".");
	if (split <= 0) return null;
	const body = token.slice(0, split);
	const signature = token.slice(split + 1);
	const expected = await hmacHex(relaySecret(env), "yvs-relay." + body);
	if (!timingSafeEqualHex(signature, expected)) return null;
	const decoded = base64UrlDecode(body);
	if (!decoded) return null;
	let payload: RelayTokenPayload;
	try {
		payload = JSON.parse(decoded);
	} catch {
		return null;
	}
	if (!payload || payload.v !== RELAY_VERSION || payload.k !== kind) return null;
	if (typeof payload.exp !== "number" || payload.exp <= now) return null;
	return payload;
}

/** Does this ticket authorize the given AI path? */
export function relayTicketAllowsPath(ticket: RelayTokenPayload | null, pathname: string): boolean {
	if (!ticket || ticket.k !== "client") return false;
	const allowed = Array.isArray(ticket.paths) ? ticket.paths : [];
	return allowed.indexOf(pathname) !== -1 && RELAY_AI_PATHS.indexOf(pathname) !== -1;
}

/**
 * Reads a browser rotation ticket off a request and returns the identity it
 * carries, or null. Used by `authSessionFromRequest` / the guest gate so a
 * rotated request is authorized exactly like the cookie-backed one, without
 * sharing cookies across origins.
 */
export async function readRelayTicket(request: Request, env: any, now = Date.now()): Promise<RelayTokenPayload | null> {
	const raw = request.headers.get(RELAY_TICKET_HEADER);
	if (!raw) return null;
	const ticket = await verifyRelayToken(env, raw, "client", now);
	if (!ticket) return null;
	let pathname = "";
	try {
		pathname = new URL(request.url).pathname;
	} catch {
		return null;
	}
	return relayTicketAllowsPath(ticket, pathname) ? ticket : null;
}

/* =============================================================
 * RESULT ENCODING
 * ============================================================= */

async function readStreamBytes(stream: any): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value && value.byteLength) {
			const view =
				value instanceof Uint8Array
					? value
					: new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
			chunks.push(view);
			total += view.byteLength;
			if (total > RELAY_MAX_RESULT_BYTES) throw new Error("Relayed result too large");
		}
	}
	if (chunks.length === 1) return chunks[0];
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged;
}

/**
 * Turns whatever `env.AI.run()` answered with into either bytes (image/audio)
 * or JSON (text models). Mirrors the decoders already used by the image and
 * voiceover modules, so a relayed result looks EXACTLY like a local one.
 */
export async function encodeRelayResult(result: unknown): Promise<
	{ kind: "binary"; bytes: Uint8Array; mime: string } | { kind: "json"; value: unknown }
> {
	if (result == null) return { kind: "json", value: null };
	if (typeof Uint8Array !== "undefined" && result instanceof Uint8Array) {
		return { kind: "binary", bytes: result, mime: "application/octet-stream" };
	}
	if (typeof ArrayBuffer !== "undefined" && result instanceof ArrayBuffer) {
		return { kind: "binary", bytes: new Uint8Array(result), mime: "application/octet-stream" };
	}
	if (ArrayBuffer.isView(result)) {
		const view = result as ArrayBufferView;
		return {
			kind: "binary",
			bytes: new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
			mime: "application/octet-stream"
		};
	}
	if (typeof Response !== "undefined" && result instanceof Response) {
		const bytes = new Uint8Array(await result.arrayBuffer());
		if (bytes.byteLength > RELAY_MAX_RESULT_BYTES) throw new Error("Relayed result too large");
		return { kind: "binary", bytes, mime: result.headers.get("Content-Type") || "application/octet-stream" };
	}
	if (typeof ReadableStream !== "undefined" && result instanceof ReadableStream) {
		return { kind: "binary", bytes: await readStreamBytes(result), mime: "application/octet-stream" };
	}
	if (typeof result === "object" && typeof (result as any).getReader === "function") {
		return { kind: "binary", bytes: await readStreamBytes(result), mime: "application/octet-stream" };
	}
	if (typeof result === "object" && typeof (result as any).arrayBuffer === "function") {
		const bytes = new Uint8Array(await (result as any).arrayBuffer());
		if (bytes.byteLength > RELAY_MAX_RESULT_BYTES) throw new Error("Relayed result too large");
		return { kind: "binary", bytes, mime: "application/octet-stream" };
	}
	return { kind: "json", value: result };
}

/* =============================================================
 * THE RELAY RUNTIME (env.AI replacement)
 * ============================================================= */

export interface RelayRunContext {
	env: any;
	request?: Request;
	options: RelayRuntimeOptions;
	/** Total calls executed by this request (for diagnostics). */
	stats: { relayed: number; local: number; failedOver: number; endpoints: string[] };
}

function abortSignalFor(request: Request | undefined, timeoutMs: number): { signal?: AbortSignal; cleanup: () => void } {
	const controller = typeof AbortController === "function" ? new AbortController() : null;
	const timer = setTimeout(() => controller?.abort(), Math.max(1_000, timeoutMs));
	let detach: (() => void) | null = null;
	if (request && request.signal && controller) {
		const signal = request.signal;
		const forward = () => controller.abort();
		if (signal.aborted) controller.abort();
		else if (typeof signal.addEventListener === "function") {
			signal.addEventListener("abort", forward, { once: true });
			detach = () => signal.removeEventListener("abort", forward);
		}
	}
	return {
		signal: controller ? controller.signal : undefined,
		cleanup: () => {
			clearTimeout(timer);
			if (detach) detach();
		}
	};
}

interface RelayOutcome {
	value: unknown;
	endpoint: RelayPoolEntry;
}

async function runLocalModel(
	env: any,
	model: string,
	input: Record<string, unknown>,
	timeoutMs: number,
	request: Request | undefined,
	cooldownMs: number
): Promise<unknown> {
	const ai = env && env.AI;
	if (!ai || typeof ai.run !== "function") {
		throw new Error("AI binding not configured");
	}
	const startedAt = Date.now();
	healthFor("local").inFlight += 1;
	try {
		const { signal, cleanup } = abortSignalFor(request, timeoutMs);
		let timer: any = null;
		try {
			const call = ai.run(model, input);
			if (!signal) {
				const value = await call;
				noteRelaySuccess("local", Date.now() - startedAt);
				return value;
			}
			const timeout = new Promise((_, reject) => {
				timer = setTimeout(() => {
					const error = new Error("Relayed model call timed out after " + Math.round(timeoutMs / 1000) + " s");
					error.name = "TimeoutError";
					reject(error);
				}, timeoutMs);
			});
			const value = await Promise.race([call, timeout]);
			noteRelaySuccess("local", Date.now() - startedAt);
			return value;
		} finally {
			if (timer) clearTimeout(timer);
			cleanup();
		}
	} catch (error) {
		if (isTransientRelayFailure(error)) noteRelayFailure("local", error, cooldownMs);
		throw error;
	} finally {
		healthFor("local").inFlight = Math.max(0, healthFor("local").inFlight - 1);
	}
}

/**
 * One remote model call: `POST <worker>/api/relay/ai`.
 *
 * The token binds the model slug and a digest of the body, so a backup can
 * never be asked to run something the primary did not sign for.
 */
async function runRemoteModel(
	entry: RelayPoolEntry,
	env: any,
	model: string,
	input: Record<string, unknown>,
	timeoutMs: number,
	request: Request | undefined,
	options: RelayRuntimeOptions,
	cooldownMs: number = RELAY_DEFAULT_CONFIG.cooldownMs
): Promise<unknown> {
	const payload = { model, input };
	const body = JSON.stringify(payload);
	const token = await signRelayToken(env, {
		v: RELAY_VERSION,
		k: "ai",
		exp: Date.now() + RELAY_TOKEN_TTL_MS,
		m: model,
		d: await sha256Hex(body)
	});

	const fetchImpl = options.fetchImpl || fetch;
	const startedAt = Date.now();
	const { signal, cleanup } = abortSignalFor(request, timeoutMs);
	healthFor(entry.id).inFlight += 1;
	try {
		const response = await fetchImpl(entry.url + RELAY_AI_PATH, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Accept": "application/json, application/octet-stream",
				[RELAY_TOKEN_HEADER]: token,
				"X-YVS-Relay-Hop": "1"
			},
			body,
			signal
		});

		const kind = response.headers.get(RELAY_RESULT_HEADER) || "";
		if (!response.ok) {
			let message = "Relay endpoint answered " + response.status;
			let errorKind = response.headers.get(RELAY_ERROR_KIND_HEADER) || "";
			try {
				const parsed: any = await response.json();
				if (parsed && parsed.error) message = String(parsed.error);
				if (parsed && parsed.kind) errorKind = String(parsed.kind);
			} catch {
				/* keep the status message */
			}
			const error = new Error(message);
			if (errorKind === "model" || response.status === 400) error.name = "ModelError";
			else error.name = "RelayError";
			throw error;
		}

		if (kind === "binary") {
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.byteLength > RELAY_MAX_RESULT_BYTES) throw new Error("Relayed result too large");
			noteRelaySuccess(entry.id, Date.now() - startedAt);
			return bytes;
		}

		const data: any = await response.json();
		if (!data || data.ok !== true) {
			throw new Error((data && data.error) || "Relay endpoint returned no result");
		}
		if (data.resultBinary) {
			const bytes = fromHex(String(data.resultBinary));
			if (!bytes) throw new Error("Relay endpoint returned malformed bytes");
			noteRelaySuccess(entry.id, Date.now() - startedAt);
			return bytes;
		}
		noteRelaySuccess(entry.id, Date.now() - startedAt);
		return data.result;
	} catch (error) {
		if (isTransientRelayFailure(error)) noteRelayFailure(entry.id, error, cooldownMs);
		throw error;
	} finally {
		cleanup();
		healthFor(entry.id).inFlight = Math.max(0, healthFor(entry.id).inFlight - 1);
	}
}

export interface RelayAi {
	run(model: string, input?: Record<string, unknown>): Promise<unknown>;
}

export interface RelayRuntime {
	ai: RelayAi;
	config(): Promise<RelayConfig>;
	pool(): Promise<RelayPoolEntry[]>;
	stats(): { relayed: number; local: number; failedOver: number; endpoints: string[] };
}

/**
 * Builds the relay-aware runtime for one request. Everything is lazy: a route
 * that never touches `env.AI` costs zero KV reads and zero network calls.
 */
export function createRelayRuntime(env: any, request?: Request, options: RelayRuntimeOptions = {}): RelayRuntime {
	const stats = {
		relayed: 0,
		local: 0,
		failedOver: 0,
		openrouter: 0,
		cloudflare: 0,
		providerFallback: 0,
		endpoints: [] as string[]
	};
	const selfOrigin = options.selfOrigin || (request ? new URL(request.url).origin : "");
	let configPromise: Promise<RelayConfig> | null = null;
	let poolPromise: Promise<RelayPoolEntry[]> | null = null;

	const config = () => {
		if (!configPromise) configPromise = readRelayConfig(env, options);
		return configPromise;
	};
	const pool = () => {
		if (!poolPromise) poolPromise = resolveRelayPool(env, selfOrigin, options);
		return poolPromise;
	};

	/*
	 * The Workers AI path: this Worker plus every backup in the pool
	 * (bug fix #265). This is the "cloudflare" half of the provider rotation.
	 */
	async function runViaWorkersAi(
		model: string,
		input: Record<string, unknown> = {}
	): Promise<unknown> {
		const settings = await config();
		const members = await pool();

		/* Single-Worker deployment: exactly the old behaviour. */
		if (!settings.enabled || members.length <= 1) {
			const value = await runLocalModel(
				env,
				model,
				input,
				settings.timeoutMs,
				request,
				settings.cooldownMs
			);
			stats.local += 1;
			return value;
		}

		const ordered = orderRelayCandidates(members, settings);
		const attempts = ordered.slice(0, Math.max(1, settings.maxAttempts));
		if (options.preferLocal) {
			/* Do not relay work that was just relayed to us. */
			const localIndex = attempts.findIndex((entry) => entry.local);
			if (localIndex > 0) attempts.unshift(attempts.splice(localIndex, 1)[0]);
		}
		/* Local is the guaranteed backstop, even beyond maxAttempts. */
		if (!attempts.some((entry) => entry.local)) {
			const local = ordered.find((entry) => entry.local);
			if (local) attempts.push(local);
		}

		let lastError: unknown = null;
		let attemptIndex = 0;
		for (const entry of attempts) {
			attemptIndex += 1;
			stats.endpoints.push(entry.local ? "local" : entry.label);
			try {
				if (entry.local) {
					const value = await runLocalModel(
						env,
						model,
						input,
						settings.timeoutMs,
						request,
						settings.cooldownMs
					);
					stats.local += 1;
					return value;
				}
				/* Never forward `stream`: a relayed call returns one complete payload. */
				const safeInput = Object.assign({}, input);
				delete (safeInput as any).stream;
				const value = await runRemoteModel(
					entry,
					env,
					model,
					safeInput,
					settings.timeoutMs,
					request,
					options,
					settings.cooldownMs
				);
				stats.relayed += 1;
				if (attemptIndex > 1) stats.failedOver += 1;
				return value;
			} catch (error) {
				lastError = error;
				/*
				 * A definitive answer (cancelled request, rejected prompt,
				 * retired model slug) is final. Anything else - a timeout,
				 * an overload signal, a dropped connection, a member with no
				 * AI binding - moves on to the next pool member.
				 */
				if (!isTransientRelayFailure(error)) throw error;
				continue;
			}
		}

		throw lastError instanceof Error ? lastError : new Error("All API relay endpoints failed");
	}

	/*
	 * The provider rotation (bug fix #271).
	 *
	 * Instruct models are the only calls that can go to OpenRouter; image and
	 * TTS slugs always stay on Workers AI. Order comes from `config:llm`
	 * ("rotate" | "cloudflare" | "openrouter"), each provider is tried once,
	 * and a transient failure on one provider falls through to the other, so a
	 * bad key or a closed circuit never breaks a script.
	 */
	async function run(model: string, input: Record<string, unknown> = {}): Promise<unknown> {
		if (typeof model !== "string" || !RELAY_MODEL_PATTERN.test(model)) {
			throw new Error("Invalid model slug");
		}
		if (!permitsNonVisualModel(model)) throw new Error("AI image generation is disabled; use Pixabay");

		let llm: LlmConfig | null = null;
		if (isInstructModel(model)) {
			try {
				llm = await readLlmConfig(env);
			} catch {
				llm = null;
			}
		}

		if (!llm || !llm.enabled || llm.provider === "cloudflare") {
			stats.cloudflare += 1;
			return runViaWorkersAi(model, input);
		}

		/* Without a key the OpenRouter half is skipped, not attempted. */
		const keyInfo = await resolveOpenRouterKey(env, llm).catch(() => null);
		const providers = orderLlmProviders(llm, Date.now(), Math.random, !!keyInfo && keyInfo.configured);
		let lastError: unknown = null;
		for (let index = 0; index < providers.length; index++) {
			const provider = providers[index];
			try {
				if (provider === "openrouter") {
					const prompt = promptFromAiInput(input);
					if (!prompt.trim()) throw new Error("OpenRouter call needs a prompt");
					const result = await runOpenRouterCompletion({
						env,
						config: llm,
						prompt,
						maxTokens: Number(input.max_tokens) || undefined,
						temperature: Number(input.temperature) || undefined,
						signal: request ? request.signal : undefined,
						fetchImpl: options.fetchImpl,
						now: options.now
					});
					stats.openrouter += 1;
					if (index > 0) stats.providerFallback += 1;
					/* Same shape as env.AI.run(), so aiText() and the validators
					   are oblivious to which provider answered. */
					return {
						response: result.text,
						provider: "openrouter",
						model: result.model,
						ms: result.ms
					};
				}
				const value = await runViaWorkersAi(model, input);
				stats.cloudflare += 1;
				if (index > 0) stats.providerFallback += 1;
				return value;
			} catch (error) {
				lastError = error;
				if (error instanceof Error && error.name === "AbortError") throw error;
				if (!isTransientRelayFailure(error)) throw error;
				continue;
			}
		}

		throw lastError instanceof Error ? lastError : new Error("All LLM providers failed");
	}

	return {
		ai: { run },
		config,
		pool,
		stats: () => ({
			relayed: stats.relayed,
			local: stats.local,
			failedOver: stats.failedOver,
			openrouter: stats.openrouter,
			cloudflare: stats.cloudflare,
			providerFallback: stats.providerFallback,
			endpoints: stats.endpoints.slice()
		})
	};
}

/** Symbol-keyed handle so the route layer can reach the runtime from `env`. */
const RELAY_RUNTIME_FLAG = Symbol.for("yvs.relay.runtime");

/**
 * Returns `env` with its `AI` binding replaced by the relay runtime. Every
 * other binding (KV, AI-less e2e envs, ...) is passed through untouched, and
 * an env without an `AI` binding still works as long as a healthy backup has
 * one — that is the whole point of the pool.
 */
export function withRelayedAi(env: any, request?: Request, options: RelayRuntimeOptions = {}): any {
	if (!env || typeof env !== "object") return env;
	const runtime = createRelayRuntime(env, request, options);
	const proxy = new Proxy(env, {
		get(target, prop) {
			if (prop === "AI") return runtime.ai;
			if (prop === RELAY_RUNTIME_FLAG) return runtime;
			return Reflect.get(target, prop);
		},
		has(target, prop) {
			if (prop === "AI") return true;
			return Reflect.has(target, prop);
		}
	});
	(proxy as any).__relayRuntime = runtime;
	return proxy;
}

/** Reads the relay runtime back out of a relayed env (or null). */
export function relayRuntimeOf(env: any): RelayRuntime | null {
	if (!env || typeof env !== "object") return null;
	try {
		const runtime = (env as any).__relayRuntime || (env as any)[RELAY_RUNTIME_FLAG];
		return runtime && typeof runtime.ai?.run === "function" ? runtime : null;
	} catch {
		return null;
	}
}

/* =============================================================
 * INBOUND COMPUTE ENDPOINT  (POST /api/relay/ai)
 * ============================================================= */

async function readBodyText(request: Request, maxBytes: number): Promise<string | null> {
	const declared = Number(request.headers.get("Content-Length") || 0);
	if (declared && declared > maxBytes) return null;
	const text = await request.text();
	if (text.length > maxBytes) return null;
	return text;
}

export async function handleRelayAiCall(
	request: Request,
	env: any,
	options: RelayRuntimeOptions = {}
): Promise<Response> {
	if (request.method !== "POST") {
		return jsonResponse({ success: false, error: "POST only" }, 405, { Allow: "POST" });
	}

	const token = request.headers.get(RELAY_TOKEN_HEADER);
	const payload = await verifyRelayToken(env, token, "ai", (options.now || Date.now)());
	if (!payload) {
		return jsonResponse({ success: false, error: "Invalid or expired relay token" }, 401);
	}

	const body = await readBodyText(request, RELAY_MAX_BODY_BYTES);
	if (body == null) {
		return jsonResponse({ success: false, error: "Relay payload too large" }, 413);
	}

	if (payload.d && payload.d !== (await sha256Hex(body))) {
		return jsonResponse({ success: false, error: "Relay payload digest mismatch" }, 401);
	}

	let parsed: any;
	try {
		parsed = JSON.parse(body);
	} catch {
		return jsonResponse({ success: false, error: "Relay payload must be JSON" }, 400);
	}
	const model = String(parsed?.model || "");
	const input = parsed && typeof parsed.input === "object" && parsed.input !== null ? parsed.input : {};
	if (!RELAY_MODEL_PATTERN.test(model) || (payload.m && payload.m !== model)) {
		return jsonResponse({ success: false, error: "Invalid model slug" }, 400);
	}

	if (!permitsNonVisualModel(model)) {
		return jsonResponse({ success: false, error: "AI image generation is disabled; use Pixabay" }, 410);
	}

	const ai = env && env.AI;
	if (!ai || typeof ai.run !== "function") {
		/* 503 (not 500) so the caller fails over instead of surfacing a hard error. */
		return jsonResponse({ success: false, error: "AI binding not configured", kind: "transient" }, 503, {
			[RELAY_ERROR_KIND_HEADER]: "transient"
		});
	}

	const startedAt = Date.now();
	try {
		/* Never relay again from here: this endpoint always executes locally. */
		const result = await ai.run(model, input);
		const encoded = await encodeRelayResult(result);
		const headers: Record<string, string> = {
			"Cache-Control": "no-store",
			[RELAY_RESULT_HEADER]: encoded.kind,
			"X-YVS-Relay-Served-By": "relay",
			"X-YVS-Relay-Ms": String(Date.now() - startedAt)
		};
		if (encoded.kind === "binary") {
			headers["Content-Type"] = encoded.mime || "application/octet-stream";
			return new Response(encoded.bytes as unknown as BodyInit, { status: 200, headers });
		}
		headers["Content-Type"] = "application/json";
		return new Response(JSON.stringify({ ok: true, result: encoded.value }), { status: 200, headers });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const classification = classifyImageFailure(error);
		const kind = classification.kind === "fatal" ? "model" : "transient";
		return jsonResponse(
			{ success: false, ok: false, error: message, kind },
			502,
			{ [RELAY_RESULT_HEADER]: "json", [RELAY_ERROR_KIND_HEADER]: kind }
		);
	}
}

/* =============================================================
 * PING / POOL / STATUS
 * ============================================================= */

export function handleRelayPing(request: Request): Response {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return jsonResponse({ success: false, error: "GET only" }, 405, { Allow: "GET" });
	}
	return jsonResponse({
		success: true,
		app: "youtube-vibe-studio",
		relay: RELAY_VERSION,
		capabilities: {
			ai: true,
			binaryResults: true,
			clientRotation: true,
			paths: RELAY_AI_PATHS
		},
		time: new Date().toISOString()
	});
}

interface PingCacheEntry {
	at: number;
	ok: boolean;
	latencyMs: number;
	error: string;
	version: number;
}

const pingCache = new Map<string, PingCacheEntry>();
const PING_CACHE_MS = 60_000;

/**
 * Reachability probe used by the admin page (and, when needed, by the pool
 * endpoint). A backup that does not answer `/api/relay/ping` — an older
 * deployment, a typo, a paused Worker — is never offered to the browser and
 * is circuit-broken for worker-side rotation by its failed calls.
 */
export async function probeRelayEndpoint(
	entry: RelayPoolEntry,
	options: RelayRuntimeOptions = {},
	force = false
): Promise<PingCacheEntry> {
	if (entry.local) {
		return { at: Date.now(), ok: true, latencyMs: 0, error: "", version: RELAY_VERSION };
	}
	const now = (options.now || Date.now)();
	const cached = pingCache.get(entry.url);
	if (!force && cached && now - cached.at < PING_CACHE_MS) return cached;

	const fetchImpl = options.fetchImpl || fetch;
	const controller = typeof AbortController === "function" ? new AbortController() : null;
	const timer = setTimeout(() => controller?.abort(), 5000);
	const startedAt = Date.now();
	let result: PingCacheEntry;
	try {
		const response = await fetchImpl(entry.url + RELAY_PING_PATH, {
			method: "GET",
			headers: { Accept: "application/json" },
			signal: controller ? controller.signal : undefined
		});
		if (!response.ok) {
			result = {
				at: Date.now(),
				ok: false,
				latencyMs: Date.now() - startedAt,
				error: "HTTP " + response.status,
				version: 0
			};
		} else {
			const data: any = await response.json().catch(() => null);
			const version = Number(data && data.relay) || 0;
			result = {
				at: Date.now(),
				ok: version >= 1 && !!(data && data.capabilities && data.capabilities.ai),
				latencyMs: Date.now() - startedAt,
				error: version >= 1 ? "" : "Not a relay-capable deployment",
				version
			};
		}
	} catch (error) {
		result = {
			at: Date.now(),
			ok: false,
			latencyMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
			version: 0
		};
	} finally {
		clearTimeout(timer);
	}
	pingCache.set(entry.url, result);
	return result;
}

export interface RelayEndpointReport extends RelayPoolEntry {
	state: string;
	successes: number;
	failures: number;
	inFlight: number;
	latencyMs: number;
	ewmaMs: number;
	lastError: string;
	coolingUntil: number;
	reachable: boolean | null;
	probeMs: number;
	probeError: string;
}

export async function describeRelayPool(
	env: any,
	selfOrigin: string,
	options: RelayRuntimeOptions = {},
	probe = false
): Promise<{ config: RelayConfig; endpoints: RelayEndpointReport[]; usingDefaultSecret: boolean }> {
	const [config, pool] = await Promise.all([
		readRelayConfig(env, options),
		resolveRelayPool(env, selfOrigin, options)
	]);
	const now = (options.now || Date.now)();
	const endpoints: RelayEndpointReport[] = [];
	/* One round trip per member, all in parallel (a probe is 8 s at worst). */
	const probes = new Map<string, PingCacheEntry>();
	await Promise.all(
		pool.map(async (entry) => {
			if (entry.local) return;
			const cached = pingCache.get(entry.url);
			if (cached && !probe) {
				probes.set(entry.url, cached);
				return;
			}
			probes.set(entry.url, await probeRelayEndpoint(entry, options, probe));
		})
	);
	for (const entry of pool) {
		const health = healthFor(entry.id);
		const probeInfo = entry.local ? null : probes.get(entry.url) || null;
		endpoints.push(
			Object.assign({}, entry, {
				state: health.openedUntil > now ? "cooling" : health.inFlight > 0 ? "busy" : "ready",
				successes: health.successes,
				failures: health.failures,
				inFlight: health.inFlight,
				latencyMs: health.latencyMs,
				ewmaMs: health.ewmaMs,
				lastError: health.lastError,
				coolingUntil: health.openedUntil,
				reachable: entry.local ? true : probeInfo ? probeInfo.ok : null,
				probeMs: probeInfo ? probeInfo.latencyMs : 0,
				probeError: probeInfo ? probeInfo.error : "not probed"
			})
		);
	}
	return { config, endpoints, usingDefaultSecret: relayUsesDefaultSecret(env) };
}

/* =============================================================
 * ROUTE LAYER
 * ============================================================= */

export interface RelayRouteOptions extends RelayRuntimeOptions {
	/** The settings password (`CONFIG_PASSWORD` in src/index.ts). */
	configPassword?: string;
	/** Resolves the signed-in identity for a client ticket (optional). */
	identity?: () => Promise<{ username: string; email?: string; usertype?: string } | null>;
	/** Is this visitor an allowed guest (freemium cookie / open mode)? */
	guest?: () => boolean;
	/** ctx.waitUntil, for background probes. */
	waitUntil?: (promise: Promise<unknown>) => void;
}

function isRelayPath(pathname: string): boolean {
	return pathname === RELAY_AI_PATH ||
		pathname === RELAY_PING_PATH ||
		pathname === RELAY_POOL_PATH ||
		pathname === RELAY_STATUS_PATH ||
		pathname === RELAY_CONFIG_PATH ||
		pathname === RELAY_TEST_PATH;
}

/**
 * Dispatches every `/api/relay/*` route. Returns null when the request is not
 * a relay route, so the main router keeps its existing order.
 */
export async function handleRelayRoutes(
	request: Request,
	url: URL,
	env: any,
	options: RelayRouteOptions = {}
): Promise<Response | null> {
	const pathname = url.pathname;
	if (!isRelayPath(pathname)) return null;

	/* Inbound compute endpoint: worker -> worker. */
	if (pathname === RELAY_AI_PATH) {
		return handleRelayAiCall(request, env, options);
	}

	if (pathname === RELAY_PING_PATH) {
		return handleRelayPing(request);
	}

	/* ------------------------------------------------------------------
	 * GET /api/relay/pool — what the studio may rotate, plus a ticket.
	 * Public shape (URLs are already public via /api/config/workers); the
	 * ticket is only issued to a signed-in user or an allowed guest, is
	 * scoped to the AI paths, and expires in three minutes.
	 * ------------------------------------------------------------------ */
	if (pathname === RELAY_POOL_PATH) {
		if (request.method !== "GET") {
			return jsonResponse({ success: false, error: "GET only" }, 405, { Allow: "GET" });
		}
		const config = await readRelayConfig(env, options);
		const pool = await resolveRelayPool(env, options.selfOrigin || url.origin, options);

		/* Only advertise backups that answered /api/relay/ping recently. */
		const endpoints: Array<{ id: string; url: string; local: boolean; verified: boolean }> = [];
		const probes: Promise<unknown>[] = [];
		for (const entry of pool) {
			if (entry.local) {
				endpoints.push({ id: entry.id, url: "", local: true, verified: true });
				continue;
			}
			const cached = pingCache.get(entry.url);
			if (cached && cached.ok) {
				endpoints.push({ id: entry.id, url: entry.url, local: false, verified: true });
			} else {
				probes.push(probeRelayEndpoint(entry, options));
			}
		}
		if (probes.length) {
			const probeAll = Promise.all(probes).then(() => undefined);
			if (options.waitUntil) options.waitUntil(probeAll);
			else await probeAll;
		}

		let ticket: string | null = null;
		let expiresAt = 0;
		const wantsTicket = config.enabled && config.clientRotation;
		if (wantsTicket && typeof options.identity === "function") {
			const user = await options.identity().catch(() => null);
			if (user && user.username) {
				const exp = Date.now() + RELAY_TICKET_TTL_MS;
				ticket = await signRelayToken(env, {
					v: RELAY_VERSION,
					k: "client",
					exp,
					u: String(user.username),
					e: String(user.email || ""),
					p: String(user.usertype || "free_user"),
					g: false,
					paths: RELAY_AI_PATHS.slice()
				});
				expiresAt = exp;
			} else if (typeof options.guest === "function" && options.guest()) {
				const exp = Date.now() + RELAY_TICKET_TTL_MS;
				ticket = await signRelayToken(env, {
					v: RELAY_VERSION,
					k: "client",
					exp,
					g: true,
					paths: RELAY_AI_PATHS.slice()
				});
				expiresAt = exp;
			}
		}

		return jsonResponse({
			success: true,
			version: RELAY_VERSION,
			enabled: config.enabled,
			clientRotation: wantsTicket && !!ticket,
			strategy: config.strategy,
			endpoints,
			ticket,
			expiresAt
		});
	}

	/* ------------------------------------------------------------------
	 * GET /api/relay/status — pool + health + probe results (public).
	 * Mirrors the existing public `GET /api/config/workers` disclosure.
	 * ------------------------------------------------------------------ */
	if (pathname === RELAY_STATUS_PATH) {
		if (request.method !== "GET") {
			return jsonResponse({ success: false, error: "GET only" }, 405, { Allow: "GET" });
		}
		const report = await describeRelayPool(env, options.selfOrigin || url.origin, options, url.searchParams.get("probe") === "1");
		return jsonResponse({
			success: true,
			version: RELAY_VERSION,
			config: report.config,
			endpoints: report.endpoints,
			usingDefaultSecret: report.usingDefaultSecret,
			health: relayHealthSnapshot()
		});
	}

	/* ------------------------------------------------------------------
	 * GET/POST /api/relay/config — rotation policy (POST needs the admin
	 * password, exactly like the other settings mutations).
	 * ------------------------------------------------------------------ */
	if (pathname === RELAY_CONFIG_PATH) {
		if (request.method === "GET") {
			const config = await readRelayConfig(env, options);
			const pool = await resolveRelayPool(env, options.selfOrigin || url.origin, options);
			return jsonResponse({
				success: true,
				config,
				defaults: RELAY_DEFAULT_CONFIG,
				endpoints: pool.map((entry) => ({ id: entry.id, url: entry.url, local: entry.local, label: entry.label })),
				usingDefaultSecret: relayUsesDefaultSecret(env)
			});
		}
		if (request.method === "POST") {
			const body: any = await request.json().catch(() => ({}));
			if (!options.configPassword || body.pw !== options.configPassword) {
				return jsonResponse({ success: false, error: "Wrong password" }, 403);
			}
			if (!env || !env.KV_BINDING) {
				return jsonResponse({ success: false, error: "User storage not configured (bind the KV namespace)" }, 503);
			}
			try {
				const saved = await writeRelayConfig(env, body);
				return jsonResponse({ success: true, config: saved });
			} catch (error) {
				return jsonResponse(
					{ success: false, error: error instanceof Error ? error.message : String(error) },
					503
				);
			}
		}
		return jsonResponse({ success: false, error: "Method not allowed" }, 405, { Allow: "GET, POST" });
	}

	/* ------------------------------------------------------------------
	 * POST /api/relay/test — force a fresh probe of every registered
	 * backup (password-gated, settings page only).
	 * ------------------------------------------------------------------ */
	if (pathname === RELAY_TEST_PATH) {
		if (request.method !== "POST") {
			return jsonResponse({ success: false, error: "POST only" }, 405, { Allow: "POST" });
		}
		const body: any = await request.json().catch(() => ({}));
		if (!options.configPassword || body.pw !== options.configPassword) {
			return jsonResponse({ success: false, error: "Wrong password" }, 403);
		}
		pingCache.clear();
		const report = await describeRelayPool(env, options.selfOrigin || url.origin, options, true);
		return jsonResponse({
			success: true,
			endpoints: report.endpoints,
			usingDefaultSecret: report.usingDefaultSecret
		});
	}

	return null;
}

/* =============================================================
 * CORS (browser rotation only)
 * ============================================================= */

function isCorsPath(pathname: string): boolean {
	return RELAY_AI_PATHS.indexOf(pathname) !== -1 || isRelayPath(pathname);
}

const PREFLIGHT_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Accept, " + RELAY_TICKET_HEADER,
	"Access-Control-Max-Age": "600",
	"Cache-Control": "no-store"
};

/**
 * Answers a cross-origin preflight for an AI path. Returns null for anything
 * else (including same-origin requests, which never send `Origin`).
 *
 * Deliberately preflight-only: the *actual* cross-origin response only gains
 * `Access-Control-Allow-Origin` when the request carries a valid ticket
 * (see `applyRelayCors`), so a random web page cannot read AI output from a
 * visitor's browser or drain a public `/image/gen`.
 */
export function relayPreflightResponse(request: Request): Response | null {
	if (request.method !== "OPTIONS") return null;
	if (!request.headers.get("Origin")) return null;
	let pathname = "";
	try {
		pathname = new URL(request.url).pathname;
	} catch {
		return null;
	}
	if (!isCorsPath(pathname)) return null;
	return new Response(null, { status: 204, headers: PREFLIGHT_HEADERS });
}

/**
 * Adds the CORS read permission to a cross-origin AI response, but only when
 * the caller proved it holds a ticket signed by this Worker.
 */
export async function applyRelayCors(request: Request, response: Response, env?: any): Promise<Response> {
	const origin = request.headers.get("Origin");
	if (!origin || !response) return response;
	let pathname = "";
	try {
		pathname = new URL(request.url).pathname;
	} catch {
		return response;
	}
	if (!isCorsPath(pathname)) return response;

	/* Only a ticket this Worker signed for this path unlocks a cross-origin read. */
	const ticket = await readRelayTicket(request, env === undefined ? {} : env).catch(() => null);
	if (!ticket) return response;

	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", "*");
	headers.set("Access-Control-Expose-Headers", RELAY_CORS_EXPOSE_HEADERS);
	headers.append("Vary", "Origin");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

/* =============================================================
 * TICKET -> IDENTITY (used by src/index.ts auth helpers)
 * ============================================================= */

/**
 * The identity a client ticket carries. `authSessionFromRequest()` calls this
 * FIRST: a rotated request has no cookie for the backup's origin, so the
 * ticket is the credential. Values are still re-read from KV by
 * `creditSessionUser()` on the receiving Worker when its KV is shared.
 */
export async function relayTicketIdentity(
	request: Request,
	env: any,
	now = Date.now()
): Promise<{ username: string; email: string; usertype: string; relayed: true } | null> {
	const ticket = await readRelayTicket(request, env, now).catch(() => null);
	if (!ticket || ticket.g || !ticket.u) return null;
	return {
		username: String(ticket.u),
		email: String(ticket.e || ""),
		usertype: String(ticket.p || "free_user"),
		relayed: true
	};
}

/** Is this request a guest carrying a signed guest ticket? */
export async function relayGuestTicket(request: Request, env: any, now = Date.now()): Promise<boolean> {
	const ticket = await readRelayTicket(request, env, now).catch(() => null);
	return !!ticket && ticket.g === true;
}
