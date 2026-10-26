/*
 * Second instruct-model provider: OpenRouter (`src/modules/llm-openrouter.ts`).
 *
 * Bug fix #271. The studio's text work — the SEO planner, the script writer and
 * the scene-prompt writer — is the part that keeps calling an *instruct* model
 * long after an image has been produced, so it is the part that quietly drains
 * the daily Workers AI neuron allowance on whichever Worker happens to answer.
 * This module adds a second implementation of the same call and rotates between
 * them:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 1. PROVIDER rotation (this module)                           │
 *   │    cloudflare (Workers AI instruct model)  ⟷  openrouter     │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │ 2. POOL rotation (src/modules/api-relay.ts, bug fix #265)    │
 *   │    this Worker  ⟷  every backup Worker URL on the admin page │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The two rotations nest: choosing "cloudflare" still runs through the Worker
 * pool (so the instruct model can execute on any healthy deployment), while
 * choosing "openrouter" calls OpenRouter directly from here — it spends no
 * Workers AI neurons at all.
 *
 * Everything the rest of the app sees is unchanged: a rotated answer is
 * returned in the shape `env.AI.run()` would have produced (`{response}`), so
 * `aiText()` and every validator keep working without edits.
 *
 * Configuration lives in KV `config:llm` and is edited on the settings page.
 * The API key comes from `OPENROUTER_API_KEY` (recommended) or the KV value,
 * and falls back to a built-in default so the feature works out of the box.
 */

/* =============================================================
 * CONSTANTS
 * ============================================================= */

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const LLM_CONFIG_KEY = "config:llm";

/** The free instruct model requested for this deployment. */
export const DEFAULT_OPENROUTER_MODEL = "meta-llama/llama-3.3-8b-instruct:free";

/*
 * There is deliberately NO API key in this file.
 *
 * A key committed to a public repository is a leaked key (GitHub push
 * protection rejects it, and it can be spent by anyone who reads the source).
 * The key comes from `OPENROUTER_API_KEY` — `wrangler secret put
 * OPENROUTER_API_KEY` — or from the settings page, which stores it in KV
 * `config:llm` instead of in git.
 *
 * With no key, the OpenRouter half of the rotation is skipped and every
 * instruct call runs on Workers AI; the settings page says so.
 */

const DEFAULT_SYSTEM_PROMPT =
	"You are a helpful AI assistant. Follow the user's instructions exactly and answer only with what was asked for.";

export const LLM_PROVIDERS = ["cloudflare", "openrouter"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export type LlmProviderMode = "rotate" | "cloudflare" | "openrouter";

export const LLM_OPENROUTER_HEALTH_COOLDOWN_MS = 60_000;
export const LLM_OPENROUTER_HEALTH_MAX_COOLDOWN_MS = 600_000;
export const LLM_CONFIG_CACHE_MS = 15_000;

/** Image / audio / embedding families that must never reach OpenRouter. */
const NON_INSTRUCT_MODEL =
	/stable-diffusion|sdxl|flux|dreamshaper|text-to-image|melotts|aura|whisper|tts|embedding|bge|rerank/i;

/** Text-model families that ARE instruct models. */
const INSTRUCT_MODEL =
	/instruct|chat|llama|mistral|mixtral|qwen|gemma|deepseek|phi-|phi\d|falcon|granite|glm|gpt-oss|hermes|zephyr/i;

/* =============================================================
 * TYPES
 * ============================================================= */

export interface LlmConfig {
	/** Master switch for provider rotation. */
	enabled: boolean;
	/** `rotate` (both), `cloudflare` (Workers AI only) or `openrouter` only. */
	provider: LlmProviderMode;
	/** OpenRouter model slug. */
	model: string;
	/** Relative weight of the Cloudflare path while `provider` is `rotate`. */
	cloudflareWeight: number;
	/** Relative weight of the OpenRouter path while `provider` is `rotate`. */
	openrouterWeight: number;
	/** Per-call timeout for an OpenRouter request. */
	timeoutMs: number;
	/** Hard ceiling on `max_tokens` sent to OpenRouter. */
	maxTokensCap: number;
	/** Hard ceiling on prompt characters accepted by the raw API. */
	maxPromptChars: number;
	/** Optional system message. */
	systemPrompt: string;
	/** KV-stored API key override (never returned in full by the status route). */
	apiKey?: string;
}

export const LLM_DEFAULT_CONFIG: LlmConfig = {
	enabled: true,
	provider: "rotate",
	model: DEFAULT_OPENROUTER_MODEL,
	cloudflareWeight: 1,
	openrouterWeight: 1,
	timeoutMs: 90_000,
	maxTokensCap: 4096,
	maxPromptChars: 40_000,
	systemPrompt: DEFAULT_SYSTEM_PROMPT
};

export interface OpenRouterHealth {
	successes: number;
	failures: number;
	consecutiveFailures: number;
	openedUntil: number;
	lastError: string;
	lastUsedAt: number;
	latencyMs: number;
	ewmaMs: number;
	lastModel: string;
}

const LLM_PROVIDER_MODES: LlmProviderMode[] = ["rotate", "cloudflare", "openrouter"];

/* =============================================================
 * SMALL HELPERS
 * ============================================================= */

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const num = Number(value);
	if (!Number.isFinite(num)) return fallback;
	return Math.min(max, Math.max(min, Math.round(num)));
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return String(error == null ? "" : error);
}

export function isInstructModel(model: unknown): boolean {
	const slug = String(model || "");
	if (!slug || slug.length > 160) return false;
	if (NON_INSTRUCT_MODEL.test(slug)) return false;
	return INSTRUCT_MODEL.test(slug);
}

/**
 * Pulls the text prompt out of a Workers AI instruct payload.
 *
 * Every call site in this app sends `{prompt, max_tokens, temperature}`, but a
 * `messages` array is accepted too so an OpenAI-shaped caller cannot silently
 * produce an empty prompt.
 */
export function promptFromAiInput(input: Record<string, unknown> | undefined): string {
	if (!input || typeof input !== "object") return "";
	if (typeof input.prompt === "string") return input.prompt;
	if (typeof input.messages === "string") return input.messages;
	if (Array.isArray(input.messages)) {
		const parts: string[] = [];
		for (const message of input.messages) {
			if (message && typeof message === "object") {
				const content = (message as Record<string, unknown>).content;
				if (typeof content === "string") parts.push(content);
			}
		}
		return parts.join("\n\n");
	}
	return "";
}

/* =============================================================
 * CONFIG
 * ============================================================= */

export function normalizeLlmConfig(raw: unknown): LlmConfig {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	const mode = String(source.provider || "").trim().toLowerCase() as LlmProviderMode;
	const model = String(source.model || "").trim().slice(0, 160);
	const apiKey =
		typeof source.apiKey === "string" && source.apiKey.trim()
			? source.apiKey.trim().slice(0, 400)
			: undefined;
	return {
		enabled: source.enabled === undefined ? LLM_DEFAULT_CONFIG.enabled : Boolean(source.enabled),
		provider: LLM_PROVIDER_MODES.indexOf(mode) === -1 ? LLM_DEFAULT_CONFIG.provider : mode,
		model: model || LLM_DEFAULT_CONFIG.model,
		cloudflareWeight: clampInt(source.cloudflareWeight, 0, 10, LLM_DEFAULT_CONFIG.cloudflareWeight),
		openrouterWeight: clampInt(source.openrouterWeight, 0, 10, LLM_DEFAULT_CONFIG.openrouterWeight),
		timeoutMs: clampInt(source.timeoutMs, 5_000, 240_000, LLM_DEFAULT_CONFIG.timeoutMs),
		maxTokensCap: clampInt(source.maxTokensCap, 128, 32_768, LLM_DEFAULT_CONFIG.maxTokensCap),
		maxPromptChars: clampInt(source.maxPromptChars, 1_000, 200_000, LLM_DEFAULT_CONFIG.maxPromptChars),
		systemPrompt: String(source.systemPrompt || "").trim().slice(0, 4_000) || DEFAULT_SYSTEM_PROMPT,
		apiKey
	};
}

let configCache: { key: string; at: number; value: LlmConfig } | null = null;

export function invalidateLlmCache(): void {
	configCache = null;
}

export async function readLlmConfig(env: any, now = Date.now()): Promise<LlmConfig> {
	const cacheKey =
		"llm|" +
		(env && env.KV_BINDING ? "kv" : "nokv") +
		"|" +
		(env && env.OPENROUTER_ENABLED ? String(env.OPENROUTER_ENABLED) : "");
	if (configCache && configCache.key === cacheKey && now - configCache.at < LLM_CONFIG_CACHE_MS) {
		return Object.assign({}, configCache.value);
	}

	let stored: unknown = null;
	if (env && env.KV_BINDING && typeof env.KV_BINDING.get === "function") {
		try {
			const raw = await env.KV_BINDING.get(LLM_CONFIG_KEY);
			stored = raw ? JSON.parse(raw) : null;
		} catch {
			stored = null;
		}
	}

	const config = normalizeLlmConfig(stored);
	if (env && String(env.OPENROUTER_ENABLED || "").toLowerCase() === "false") config.enabled = false;
	if (env && env.OPENROUTER_MODEL) config.model = String(env.OPENROUTER_MODEL).trim().slice(0, 160) || config.model;

	configCache = { key: cacheKey, at: now, value: config };
	return Object.assign({}, config);
}

export async function writeLlmConfig(env: any, raw: unknown): Promise<LlmConfig> {
	if (!env || !env.KV_BINDING) throw new Error("User storage not configured (bind the KV namespace)");
	/* An empty apiKey keeps the stored one instead of wiping it. */
	const current = await readLlmConfig(env, 0);
	const next = normalizeLlmConfig(Object.assign({}, current, raw || {}));
	if (raw && typeof raw === "object" && !(raw as any).apiKey) next.apiKey = current.apiKey;
	await env.KV_BINDING.put(LLM_CONFIG_KEY, JSON.stringify(next));
	invalidateLlmCache();
	return next;
}

/* =============================================================
 * API KEY
 * ============================================================= */

export interface ApiKeyInfo {
	key: string;
	source: "env" | "kv" | "none";
	tail: string;
	/** True when a key is available at all. */
	configured: boolean;
}

export async function resolveOpenRouterKey(env: any, config?: LlmConfig): Promise<ApiKeyInfo> {
	const fromEnv = env && (env.OPENROUTER_API_KEY || env.OPEN_ROUTER_KEY);
	const envKey = typeof fromEnv === "string" ? fromEnv.trim() : "";
	if (envKey) return { key: envKey, source: "env", tail: envKey.slice(-6), configured: true };

	const settings = config || (await readLlmConfig(env));
	if (settings.apiKey) {
		return { key: settings.apiKey, source: "kv", tail: settings.apiKey.slice(-6), configured: true };
	}

	return { key: "", source: "none", tail: "", configured: false };
}

/* =============================================================
 * HEALTH + SELECTION
 * ============================================================= */

const openRouterHealth: OpenRouterHealth = {
	successes: 0,
	failures: 0,
	consecutiveFailures: 0,
	openedUntil: 0,
	lastError: "",
	lastUsedAt: 0,
	latencyMs: 0,
	ewmaMs: 0,
	lastModel: ""
};

let providerCursor = 0;

export function openRouterHealthSnapshot(now = Date.now()): OpenRouterHealth & { state: string } {
	return Object.assign({}, openRouterHealth, {
		state: openRouterHealth.openedUntil > now ? "cooling" : "ready"
	});
}

export function resetLlmHealth(): void {
	openRouterHealth.successes = 0;
	openRouterHealth.failures = 0;
	openRouterHealth.consecutiveFailures = 0;
	openRouterHealth.openedUntil = 0;
	openRouterHealth.lastError = "";
	openRouterHealth.lastUsedAt = 0;
	openRouterHealth.latencyMs = 0;
	openRouterHealth.ewmaMs = 0;
	providerCursor = 0;
}

export function noteOpenRouterSuccess(model: string, latencyMs: number, now = Date.now()): void {
	openRouterHealth.successes += 1;
	openRouterHealth.consecutiveFailures = 0;
	openRouterHealth.openedUntil = 0;
	openRouterHealth.lastError = "";
	openRouterHealth.lastUsedAt = now;
	openRouterHealth.latencyMs = Math.max(0, Math.round(latencyMs));
	openRouterHealth.ewmaMs = openRouterHealth.ewmaMs
		? Math.round(openRouterHealth.ewmaMs * 0.7 + openRouterHealth.latencyMs * 0.3)
		: openRouterHealth.latencyMs;
	openRouterHealth.lastModel = model;
}

export function noteOpenRouterFailure(error: unknown, cooldownMs: number, now = Date.now()): void {
	openRouterHealth.failures += 1;
	openRouterHealth.consecutiveFailures += 1;
	openRouterHealth.lastUsedAt = now;
	openRouterHealth.lastError = errorMessage(error).slice(0, 240);
	const backoff = Math.min(
		LLM_OPENROUTER_HEALTH_MAX_COOLDOWN_MS,
		Math.max(5_000, cooldownMs) * Math.pow(2, Math.max(0, openRouterHealth.consecutiveFailures - 1))
	);
	openRouterHealth.openedUntil = now + backoff;
}

export function openRouterCooling(now = Date.now()): boolean {
	return openRouterHealth.openedUntil > now;
}

/**
 * The provider order for ONE instruct call.
 *
 *   provider = "cloudflare"  → ["cloudflare"]
 *   provider = "openrouter"  → ["openrouter", "cloudflare"]  (fallback kept)
 *   provider = "rotate"      → weighted random, then the other as fallback
 *
 * OpenRouter is skipped while it is cooling down, so a rejected key does not
 * add a failed round trip to every script request.
 */
export function orderLlmProviders(
	config: LlmConfig,
	now = Date.now(),
	random: () => number = Math.random,
	hasOpenRouterKey = true
): LlmProvider[] {
	if (!config.enabled) return ["cloudflare"];
	/* No key: the OpenRouter half is simply not a candidate. */
	if (!hasOpenRouterKey) return ["cloudflare"];
	if (config.provider === "cloudflare") return ["cloudflare"];

	const openRouterAvailable = !openRouterCooling(now);
	if (config.provider === "openrouter") {
		return openRouterAvailable ? ["openrouter", "cloudflare"] : ["cloudflare"];
	}

	if (!openRouterAvailable) return ["cloudflare"];

	const cloudflareWeight = Math.max(0, config.cloudflareWeight);
	const openrouterWeight = Math.max(0, config.openrouterWeight);
	const total = cloudflareWeight + openrouterWeight;

	if (total <= 0) return ["cloudflare"];

	/* Router-level round robin on top of the weights: two equal weights
	   alternate exactly instead of drifting on luck alone. */
	let first: LlmProvider;
	if (cloudflareWeight === openrouterWeight) {
		first = providerCursor % 2 === 0 ? "cloudflare" : "openrouter";
		providerCursor = (providerCursor + 1) % 1_000_003;
	} else {
		first = random() * total < cloudflareWeight ? "cloudflare" : "openrouter";
	}
	const second: LlmProvider = first === "cloudflare" ? "openrouter" : "cloudflare";
	return [first, second];
}

/* =============================================================
 * OPENROUTER CALL
 * ============================================================= */

export interface OpenRouterOptions {
	env: any;
	config?: LlmConfig;
	model?: string;
	prompt: string;
	maxTokens?: number;
	temperature?: number;
	systemPrompt?: string;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
	timeoutMs?: number;
	now?: () => number;
}

export interface OpenRouterResult {
	text: string;
	model: string;
	provider: "openrouter";
	ms: number;
	usage?: unknown;
}

/** Maps a Workers AI `temperature`/`max_tokens` payload onto an OpenAI-style request. */
export function buildOpenRouterPayload(
	config: LlmConfig,
	prompt: string,
	options: { model?: string; maxTokens?: number; temperature?: number; systemPrompt?: string } = {}
): Record<string, unknown> {
	const requested = Number(options.maxTokens);
	const maxTokens = Number.isFinite(requested) && requested > 0
		? Math.min(Math.round(requested), config.maxTokensCap)
		: Math.min(1024, config.maxTokensCap);
	const rawTemperature = Number(options.temperature);
	const temperature = Number.isFinite(rawTemperature)
		? Math.min(2, Math.max(0, rawTemperature))
		: 0.7;
	return {
		model: String(options.model || config.model),
		messages: [
			{ role: "system", content: String(options.systemPrompt || config.systemPrompt || DEFAULT_SYSTEM_PROMPT) },
			{ role: "user", content: prompt }
		],
		temperature,
		max_tokens: maxTokens
	};
}

/** Reads `choices[0].message.content` (and the shapes OpenRouter variants use). */
export function openRouterText(data: unknown): string {
	if (!data || typeof data !== "object") return "";
	const choices = (data as Record<string, unknown>).choices;
	if (Array.isArray(choices) && choices.length) {
		const first = choices[0] as Record<string, unknown>;
		const message = first && (first.message as Record<string, unknown>);
		if (message && typeof message.content === "string") return message.content.trim();
		if (message && Array.isArray(message.content)) {
			const parts = (message.content as unknown[])
				.map((part) => (part && typeof part === "object" ? (part as any).text : ""))
				.filter((text) => typeof text === "string" && text);
			if (parts.length) return parts.join("").trim();
		}
		if (typeof first.text === "string") return first.text.trim();
	}
	if (typeof (data as any).output_text === "string") return String((data as any).output_text).trim();
	return "";
}

function isTransientOpenRouterError(error: unknown): boolean {
	const message = errorMessage(error);
	if (/abort/i.test(message)) return false;
	/* 401/403 = bad key, 404 = model unavailable: retrying now is pointless,
	   but the Cloudflare path must still answer. */
	if (/\b(401|403|404)\b/.test(message)) return true;
	return true;
}

/**
 * One OpenRouter chat completion.
 *
 * Throws on any failure; the caller (`api-relay.ts`) decides whether to try the
 * Cloudflare path next. A 401/403/404 answer opens the OpenRouter circuit for
 * 60 s → 10 min so a bad key or a retired model does not slow every script.
 */
export async function runOpenRouterCompletion(options: OpenRouterOptions): Promise<OpenRouterResult> {
	const config = options.config || (await readLlmConfig(options.env));
	const prompt = String(options.prompt || "");
	if (!prompt.trim()) throw new Error("OpenRouter call needs a prompt");

	const keyInfo = await resolveOpenRouterKey(options.env, config);
	if (!keyInfo.configured) {
		/* A configuration problem, not a provider failure: no circuit penalty. */
		const missing = new Error(
			"OpenRouter API key is not configured (set OPENROUTER_API_KEY or save a key on the settings page)"
		);
		missing.name = "ConfigError";
		throw missing;
	}
	const payload = buildOpenRouterPayload(config, prompt, options);
	const model = String(payload.model);
	const body = JSON.stringify(payload);
	const timeoutMs = options.timeoutMs || config.timeoutMs;
	const fetchImpl = options.fetchImpl || fetch;
	const now = options.now || Date.now;

	/* An already-cancelled caller never opens a socket. */
	if (options.signal && options.signal.aborted) {
		const abort = new Error("OpenRouter call cancelled");
		abort.name = "AbortError";
		throw abort;
	}

	/*
	 * One internal controller owns BOTH deadlines: the timeout and the caller's
	 * own AbortSignal (a cancelled studio request). Passing the caller's signal
	 * straight to fetch would have left the setTimeout with nothing to abort,
	 * so an OpenRouter hang could hold the request until the runtime killed it.
	 */
	const controller = typeof AbortController === "function" ? new AbortController() : null;
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller?.abort();
	}, timeoutMs);
	let detachCaller: (() => void) | null = null;
	if (controller && options.signal) {
		const callerSignal = options.signal;
		const forward = () => controller.abort();
		if (callerSignal.aborted) controller.abort();
		else if (typeof callerSignal.addEventListener === "function") {
			callerSignal.addEventListener("abort", forward, { once: true });
			detachCaller = () => callerSignal.removeEventListener("abort", forward);
		}
	}
	const startedAt = now();

	try {
		const response = await fetchImpl(OPENROUTER_ENDPOINT, {
			method: "POST",
			headers: {
				"Authorization": "Bearer " + keyInfo.key,
				"Content-Type": "application/json",
				"Accept": "application/json",
				"HTTP-Referer": "https://github.com/alfimy253/text-to-image-template",
				"X-Title": "YouTube Vibe Studio"
			},
			body,
			signal: controller ? controller.signal : options.signal
		});

		if (!response.ok) {
			let detail = "";
			try {
				detail = (await response.text()).slice(0, 300);
			} catch {
				detail = "";
			}
			const error = new Error(
				"OpenRouter API error " + response.status + (detail ? ": " + detail : "")
			);
			noteOpenRouterFailure(error, LLM_OPENROUTER_HEALTH_COOLDOWN_MS, now());
			throw error;
		}

		const data: any = await response.json().catch(() => null);
		const text = openRouterText(data);
		if (!text) {
			const error = new Error(
				"OpenRouter returned an empty reply" +
					(data && data.error && data.error.message ? ": " + data.error.message : "")
			);
			noteOpenRouterFailure(error, LLM_OPENROUTER_HEALTH_COOLDOWN_MS, now());
			throw error;
		}

		noteOpenRouterSuccess(model, now() - startedAt, now());
		return {
			text,
			model,
			provider: "openrouter",
			ms: now() - startedAt,
			usage: data && data.usage ? data.usage : undefined
		};
	} catch (error) {
		/* A caller cancellation is not a provider failure: do not punish it. */
		if (options.signal && options.signal.aborted) {
			const abort = new Error("OpenRouter call cancelled");
			abort.name = "AbortError";
			throw abort;
		}
		if (timedOut) {
			const timeout = new Error(
				"OpenRouter did not answer within " + Math.round(timeoutMs / 1000) + " s"
			);
			timeout.name = "TimeoutError";
			noteOpenRouterFailure(timeout, LLM_OPENROUTER_HEALTH_COOLDOWN_MS, now());
			throw timeout;
		}
		/* fetch-level failures (DNS, TLS, abort) are provider failures too. */
		if (!/OpenRouter/.test(errorMessage(error))) {
			noteOpenRouterFailure(error, LLM_OPENROUTER_HEALTH_COOLDOWN_MS, now());
		}
		throw error;
	} finally {
		clearTimeout(timer);
		if (detachCaller) detachCaller();
	}
}

export { isTransientOpenRouterError };

/* =============================================================
 * STATUS
 * ============================================================= */

export async function describeLlmProviders(env: any, now = Date.now()): Promise<{
	config: LlmConfig;
	defaults: LlmConfig;
	/** Key METADATA only: the secret itself is never part of a report. */
	key: { source: ApiKeyInfo["source"]; tail: string };
	providers: Array<Record<string, unknown>>;
}> {
	const config = await readLlmConfig(env, now);
	const key = await resolveOpenRouterKey(env, config);
	const health = openRouterHealthSnapshot(now);
	/* The key is never part of a serialized report: only its source and tail. */
	const publicConfig = Object.assign({}, config, { apiKey: "" });
	return {
		config: publicConfig,
		defaults: LLM_DEFAULT_CONFIG,
		key: { source: key.source, tail: key.tail },
		providers: [
			{
				id: "cloudflare",
				label: "Cloudflare Workers AI",
				model: "configured per route (llama-3.1-8b-instruct-fp8)",
				state: "ready",
				note: "runs through the Worker pool rotation"
			},
			{
				id: "openrouter",
				label: "OpenRouter",
				model: config.model,
				state: health.state,
				successes: health.successes,
				failures: health.failures,
				ewmaMs: health.ewmaMs,
				latencyMs: health.latencyMs,
				lastError: health.lastError,
				lastModel: health.lastModel,
				coolingUntil: health.openedUntil,
				keySource: key.source,
				keyTail: key.tail,
				keyConfigured: key.configured
			}
		]
	};
}

/* =============================================================
 * ROUTES  (/api/llm/*)
 * ============================================================= */

export interface LlmRouteOptions {
	/** The settings password (`CONFIG_PASSWORD` in src/index.ts). */
	configPassword?: string;
	/** Raw Workers AI call used by the "Test providers" button. */
	cloudflareProbe?: (prompt: string) => Promise<string>;
	fetchImpl?: typeof fetch;
	now?: () => number;
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, extraHeaders)
	});
}

const LLM_TEST_PROMPT =
	"Reply with exactly one short sentence: \"The quick brown fox jumps over the lazy dog.\" Do not add anything else.";

function preview(text: string, max = 160): string {
	const clean = String(text || "").replace(/\s+/g, " ").trim();
	return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

/**
 * Dispatches every `/api/llm/*` route. Returns null when the request is not
 * an LLM route so the main router keeps its order.
 *
 * `POST /api/llm/generate` is NOT here: it is a user-facing AI route, so it is
 * handled in `src/index.ts` next to the other AI routes (auth + logging).
 */
export async function handleLlmRoutes(
	request: Request,
	url: URL,
	env: any,
	options: LlmRouteOptions = {}
): Promise<Response | null> {
	const pathname = url.pathname;
	if (pathname !== "/api/llm/status" && pathname !== "/api/llm/config" && pathname !== "/api/llm/test") {
		return null;
	}

	if (pathname === "/api/llm/status") {
		if (request.method !== "GET") {
			return jsonResponse({ success: false, error: "GET only" }, 405, { Allow: "GET" });
		}
		const report = await describeLlmProviders(env, (options.now || Date.now)());
		return jsonResponse({
			success: true,
			version: 271,
			config: report.config,
			defaults: report.defaults,
			providers: report.providers,
			openRouter: {
				endpoint: OPENROUTER_ENDPOINT,
				model: report.config.model,
				keySource: report.key.source,
				keyTail: report.key.tail,
				keyConfigured: report.key.source !== "none"
			},
			keyConfigured: report.key.source !== "none"
		});
	}

	if (pathname === "/api/llm/config") {
		if (request.method === "GET") {
			const report = await describeLlmProviders(env, (options.now || Date.now)());
			return jsonResponse({
				success: true,
				config: Object.assign({}, report.config, { apiKey: "" }),
				defaults: report.defaults,
				hasStoredKey: !!(report.config && report.config.apiKey),
				keySource: report.key.source,
				keyTail: report.key.tail
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
				const saved = await writeLlmConfig(env, body);
				const report = await describeLlmProviders(env, (options.now || Date.now)());
				return jsonResponse({
					success: true,
					config: Object.assign({}, saved, { apiKey: "" }),
					hasStoredKey: !!saved.apiKey,
					keySource: report.key.source,
					keyTail: report.key.tail
				});
			} catch (error) {
				return jsonResponse({ success: false, error: errorMessage(error) }, 503);
			}
		}
		return jsonResponse({ success: false, error: "Method not allowed" }, 405, { Allow: "GET, POST" });
	}

	/* POST /api/llm/test — probe both providers with one tiny prompt. */
	if (request.method !== "POST") {
		return jsonResponse({ success: false, error: "POST only" }, 405, { Allow: "POST" });
	}
	const body: any = await request.json().catch(() => ({}));
	if (!options.configPassword || body.pw !== options.configPassword) {
		return jsonResponse({ success: false, error: "Wrong password" }, 403);
	}
	const config = await readLlmConfig(env, (options.now || Date.now)());
	const now = options.now || Date.now;
	const wanted = String(body.provider || "both");
	const results: Array<Record<string, unknown>> = [];

	if (wanted === "both" || wanted === "openrouter") {
		const startedAt = now();
		try {
			const result = await runOpenRouterCompletion({
				env,
				config,
				prompt: LLM_TEST_PROMPT,
				maxTokens: 64,
				temperature: 0.2,
				fetchImpl: options.fetchImpl,
				timeoutMs: Math.min(config.timeoutMs, 45_000),
				now
			});
			results.push({
				provider: "openrouter",
				ok: true,
				ms: now() - startedAt,
				model: result.model,
				preview: preview(result.text)
			});
		} catch (error) {
			results.push({
				provider: "openrouter",
				ok: false,
				ms: now() - startedAt,
				error: errorMessage(error).slice(0, 400)
			});
		}
	}

	if ((wanted === "both" || wanted === "cloudflare") && typeof options.cloudflareProbe === "function") {
		const startedAt = now();
		try {
			const text = await options.cloudflareProbe(LLM_TEST_PROMPT);
			results.push({
				provider: "cloudflare",
				ok: !!text,
				ms: now() - startedAt,
				preview: preview(text),
				error: text ? "" : "empty reply"
			});
		} catch (error) {
			results.push({
				provider: "cloudflare",
				ok: false,
				ms: now() - startedAt,
				error: errorMessage(error).slice(0, 400)
			});
		}
	}

	return jsonResponse({ success: true, results, config: Object.assign({}, config, { apiKey: "" }) });
}
