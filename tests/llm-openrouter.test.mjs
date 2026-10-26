/*
 * Bug fix #271 — the second instruct-model API (OpenRouter) and the provider
 * rotation that sits above the Worker pool rotation.
 *
 * Contract pinned here:
 *
 *   1. Only instruct models may leave for OpenRouter; image and TTS slugs keep
 *      running on Workers AI.
 *   2. The provider order honours `config:llm` ("rotate" | "cloudflare" |
 *      "openrouter"), the weights, and the OpenRouter circuit breaker.
 *   3. An OpenRouter answer is returned in the `env.AI.run()` shape
 *      (`{response}`), so `aiText()` and every validator are unaffected.
 *   4. A failed provider falls through to the other one, so a rejected key or
 *      a Cloudflare outage never breaks a script.
 *   5. The key is resolved env → KV → built-in default, and is never echoed in
 *      full by any route.
 *   6. `POST /api/llm/generate` is the user-facing raw API: auth like the
 *      studio, `provider` optional, rotation by default.
 *   7. The admin routes are password-gated where they mutate.
 *   8. `POST /api/relay/ai` never reaches a provider API: a relayed call and an
 *      inbound compute call are both strictly one hop.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_OPENROUTER_MODEL,
	LLM_DEFAULT_CONFIG,
	OPENROUTER_ENDPOINT,
	buildOpenRouterPayload,
	describeLlmProviders,
	handleLlmRoutes,
	invalidateLlmCache,
	isInstructModel,
	normalizeLlmConfig,
	noteOpenRouterFailure,
	openRouterText,
	orderLlmProviders,
	promptFromAiInput,
	readLlmConfig,
	resetLlmHealth,
	resolveOpenRouterKey,
	runOpenRouterCompletion,
	writeLlmConfig
} from "../src/modules/llm-openrouter.ts";
import {
	createRelayRuntime,
	invalidateRelayCache,
	resetRelayHealth,
	signRelayToken
} from "../src/modules/api-relay.ts";
import { aiText } from "../src/modules/script-seo.ts";
import { default as workerModule } from "../src/index.ts";

const worker = workerModule.default || workerModule;
const SELF = "https://studio.test";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeKv(seed = {}) {
	const store = new Map(Object.entries(seed));
	return {
		store,
		async get(key) {
			return store.has(key) ? store.get(key) : null;
		},
		async put(key, value) {
			store.set(key, String(value));
		},
		async delete(key) {
			store.delete(key);
		},
		async list({ prefix = "", limit = 1000 } = {}) {
			const keys = [];
			for (const name of Array.from(store.keys()).sort()) {
				if (name.startsWith(prefix)) {
					keys.push({ name });
					if (keys.length >= limit) break;
				}
			}
			return { keys, list_complete: true };
		}
	};
}

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

function reset() {
	invalidateRelayCache();
	resetRelayHealth();
	invalidateLlmCache();
	resetLlmHealth();
}

function config(overrides = {}) {
	return normalizeLlmConfig(Object.assign({}, LLM_DEFAULT_CONFIG, overrides));
}

/** A fetch stand-in that answers an OpenRouter completion. */
function openRouterFetch(text = "hello from openrouter", seen = []) {
	return async (url, init) => {
		seen.push({ url, init });
		return json({
			id: "gen-1",
			model: JSON.parse(init.body).model,
			choices: [{ message: { role: "assistant", content: text } }],
			usage: { prompt_tokens: 10, completion_tokens: 5 }
		});
	};
}

/* ------------------------------------------------------------------ */
/* 1. Which models may go to OpenRouter?                              */
/* ------------------------------------------------------------------ */

test("#271 only instruct models are routed to OpenRouter", () => {
	for (const model of [
		"@cf/meta/llama-3.1-8b-instruct-fp8",
		"@cf/meta/llama-3.3-70b-instruct-fp8-fast",
		"@cf/mistralai/mistral-small-3.1-24b-instruct",
		"@hf/thebloke/deepseek-coder-6.7b-instruct-awq"
	]) {
		assert.equal(isInstructModel(model), true, model);
	}
	for (const model of [
		"@cf/stabilityai/stable-diffusion-xl-base-1.0",
		"@cf/black-forest-labs/flux-1-schnell",
		"@cf/myshell-ai/melotts",
		"@cf/deepgram/aura-2-en",
		"@cf/baai/bge-small-en-v1.5",
		""
	]) {
		assert.equal(isInstructModel(model), false, model);
	}
});

test("#271 the prompt is read from the Workers AI payload or an OpenAI messages array", () => {
	assert.equal(promptFromAiInput({ prompt: "direct" }), "direct");
	assert.equal(
		promptFromAiInput({ messages: [{ role: "user", content: "a" }, { role: "user", content: "b" }] }),
		"a\n\nb"
	);
	assert.equal(promptFromAiInput(undefined), "");
	assert.equal(promptFromAiInput({}), "");
});

/* ------------------------------------------------------------------ */
/* 2. Provider order                                                  */
/* ------------------------------------------------------------------ */

test("#271 provider rotation alternates, honours the weights and pins a single provider", () => {
	reset();
	const balanced = config({ provider: "rotate", cloudflareWeight: 1, openrouterWeight: 1 });
	const firsts = [];
	for (let i = 0; i < 4; i++) firsts.push(orderLlmProviders(balanced)[0]);
	assert.deepEqual(firsts, ["cloudflare", "openrouter", "cloudflare", "openrouter"]);
	/* The other provider is always the fallback. */
	assert.deepEqual(orderLlmProviders(balanced), ["cloudflare", "openrouter"]);

	assert.deepEqual(orderLlmProviders(config({ provider: "cloudflare" })), ["cloudflare"]);
	assert.deepEqual(orderLlmProviders(config({ provider: "openrouter" })), ["openrouter", "cloudflare"]);

	/* Weight 0 removes a provider from the rotation entirely. */
	assert.deepEqual(
		orderLlmProviders(config({ provider: "rotate", openrouterWeight: 0 })),
		["cloudflare", "openrouter"]
	);
	assert.equal(orderLlmProviders(config({ enabled: false }))[0], "cloudflare");
});

test("#271 a cooling OpenRouter is skipped, and heals on success", () => {
	reset();
	const now = Date.now();
	noteOpenRouterFailure(new Error("OpenRouter API error 401: no auth"), 60_000, now);
	assert.deepEqual(orderLlmProviders(config({ provider: "rotate" }), now + 1), ["cloudflare"]);
	assert.deepEqual(orderLlmProviders(config({ provider: "openrouter" }), now + 1), ["cloudflare"]);

	/* Once the window passes it is a candidate again. */
	const later = orderLlmProviders(config({ provider: "openrouter" }), now + 61_000);
	assert.equal(later[0], "openrouter");
});

/* ------------------------------------------------------------------ */
/* 3. The OpenRouter call                                             */
/* ------------------------------------------------------------------ */

test("#271 an OpenRouter completion maps the payload and returns the assistant text", async () => {
	reset();
	const seen = [];
	const result = await runOpenRouterCompletion({
		env: { OPENROUTER_API_KEY: "sk-or-test" },
		config: config({ model: DEFAULT_OPENROUTER_MODEL }),
		prompt: "write five scene prompts",
		maxTokens: 500,
		temperature: 0.7,
		fetchImpl: openRouterFetch("scene one\nscene two", seen)
	});
	assert.equal(result.text, "scene one\nscene two");
	assert.equal(result.provider, "openrouter");
	assert.equal(result.model, DEFAULT_OPENROUTER_MODEL);

	assert.equal(seen[0].url, OPENROUTER_ENDPOINT);
	assert.equal(seen[0].init.headers.Authorization, "Bearer sk-or-test");
	const payload = JSON.parse(seen[0].init.body);
	assert.equal(payload.model, DEFAULT_OPENROUTER_MODEL);
	assert.equal(payload.max_tokens, 500);
	assert.equal(payload.temperature, 0.7);
	assert.equal(payload.messages[0].role, "system");
	assert.equal(payload.messages[1].content, "write five scene prompts");
});

test("#271 max_tokens and temperature are clamped to the configured ceilings", () => {
	const payload = buildOpenRouterPayload(
		config({ maxTokensCap: 512 }),
		"x",
		{ maxTokens: 999_999, temperature: 9 }
	);
	assert.equal(payload.max_tokens, 512);
	assert.equal(payload.temperature, 2);
	const defaults = buildOpenRouterPayload(config({}), "x", {});
	assert.equal(defaults.max_tokens, 1024);
	assert.equal(defaults.temperature, 0.7);
});

test("#271 an HTTP error opens the circuit and reports the provider message", async () => {
	reset();
	await assert.rejects(
		() =>
			runOpenRouterCompletion({
				env: { OPENROUTER_API_KEY: "sk-or-bad" },
				config: config({}),
				prompt: "x",
				fetchImpl: async () => new Response("{\"error\":\"invalid key\"}", { status: 401 })
			}),
		/OpenRouter API error 401/
	);
	const report = await describeLlmProviders({ OPENROUTER_API_KEY: "sk-or-bad" });
	assert.equal(report.providers.find((entry) => entry.id === "openrouter").state, "cooling");
});

test("#271 an empty completion is an error, and text shapes are read defensively", async () => {
	reset();
	assert.equal(openRouterText({ choices: [{ message: { content: " ok " } }] }), "ok");
	assert.equal(openRouterText({ choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }] }), "ab");
	assert.equal(openRouterText({ choices: [{ text: "legacy" }] }), "legacy");
	assert.equal(openRouterText({}), "");

	await assert.rejects(
		() =>
			runOpenRouterCompletion({
				env: { OPENROUTER_API_KEY: "sk-or-test" },
				config: config({}),
				prompt: "x",
				fetchImpl: async () => json({ choices: [{ message: { content: "" } }] })
			}),
		/empty reply/
	);
});

/* ------------------------------------------------------------------ */
/* 4. The key                                                         */
/* ------------------------------------------------------------------ */

test("#271 the key resolves env -> KV -> none, and never leaks in full", async () => {
	reset();
	const env = { OPENROUTER_API_KEY: "sk-or-env-123456" };
	assert.deepEqual(await resolveOpenRouterKey(env), {
		key: "sk-or-env-123456",
		source: "env",
		tail: "123456",
		configured: true
	});

	const kvEnv = { KV_BINDING: makeKv() };
	await writeLlmConfig(kvEnv, { apiKey: "sk-or-kv-SECRETBODY-9999" });
	const fromKv = await resolveOpenRouterKey(kvEnv);
	assert.equal(fromKv.source, "kv");
	assert.equal(fromKv.tail, "Y-9999", "the last six characters of the key");

	/* No key anywhere: the module refuses rather than shipping a secret. */
	const none = await resolveOpenRouterKey({});
	assert.equal(none.source, "none");
	assert.equal(none.configured, false);
	assert.equal(none.key, "");
	await assert.rejects(
		() =>
			runOpenRouterCompletion({
				env: {},
				config: config({}),
				prompt: "x",
				fetchImpl: async () => {
					throw new Error("must not reach the network without a key");
				}
			}),
		/OpenRouter API key is not configured/
	);
	/* A missing key is a configuration problem: the circuit stays closed. */
	assert.equal((await describeLlmProviders({})).providers.find((entry) => entry.id === "openrouter").state, "ready");

	const report = await describeLlmProviders(kvEnv);
	const serialized = JSON.stringify(report);
	assert.equal(serialized.includes("SECRETBODY"), false, "the key body is never serialized");
	assert.equal(serialized.includes("sk-or-kv"), false);
	assert.equal(report.key.tail, fromKv.tail, "only the tail is reported");
});

/* ------------------------------------------------------------------ */
/* 5. Rotation through env.AI (the whole point)                        */
/* ------------------------------------------------------------------ */

function runtimeWith(envOverrides, options = {}) {
	const env = Object.assign(
		{
			AI: { run: async () => ({ response: "cloudflare-answer" }) },
			KV_BINDING: makeKv()
		},
		envOverrides
	);
	const runtime = createRelayRuntime(env, new Request(SELF + "/api/script"), {
		selfOrigin: SELF,
		...options
	});
	return { env, runtime };
}

test("#271 an instruct call is answered by OpenRouter and keeps the env.AI.run shape", async () => {
	reset();
	const seen = [];
	const { env } = runtimeWith({ OPENROUTER_API_KEY: "sk-or-test" });
	await env.KV_BINDING.put("config:llm", JSON.stringify({ provider: "openrouter" }));
	const runtime = createRelayRuntime(env, new Request(SELF + "/api/script"), {
		selfOrigin: SELF,
		fetchImpl: openRouterFetch("router answer", seen)
	});
	const result = await runtime.ai.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
		prompt: "plan keywords",
		max_tokens: 1024,
		temperature: 0.65
	});
	assert.equal(result.response, "router answer");
	assert.equal(result.provider, "openrouter");
	/* The downstream parser is unchanged. */
	assert.equal(aiText(result), "router answer");
	assert.deepEqual(runtime.stats().openrouter, 1);
	assert.equal(runtime.stats().cloudflare, 0);
	assert.equal(JSON.parse(seen[0].init.body).temperature, 0.65);
});

test("#271 an image model never reaches OpenRouter", async () => {
	reset();
	let openRouterCalls = 0;
	const { env } = runtimeWith({ OPENROUTER_API_KEY: "sk-or-test" });
	await env.KV_BINDING.put("config:llm", JSON.stringify({ provider: "openrouter" }));
	const runtime = createRelayRuntime(env, new Request(SELF + "/api/image"), {
		selfOrigin: SELF,
		fetchImpl: async () => {
			openRouterCalls += 1;
			return json({});
		}
	});
	const result = await runtime.ai.run("@cf/stabilityai/stable-diffusion-xl-base-1.0", { prompt: "a cat" });
	assert.deepEqual(result, { response: "cloudflare-answer" });
	assert.equal(openRouterCalls, 0);
});

test("#271 a failing OpenRouter falls back to Cloudflare instead of failing the script", async () => {
	reset();
	const { env } = runtimeWith({ OPENROUTER_API_KEY: "sk-or-bad" });
	await env.KV_BINDING.put("config:llm", JSON.stringify({ provider: "openrouter" }));
	const runtime = createRelayRuntime(env, new Request(SELF + "/api/script"), {
		selfOrigin: SELF,
		fetchImpl: async () => new Response("nope", { status: 429 })
	});
	const result = await runtime.ai.run("@cf/meta/llama-3.1-8b-instruct-fp8", { prompt: "x" });
	assert.deepEqual(result, { response: "cloudflare-answer" });
	assert.equal(runtime.stats().providerFallback, 1);
});

test("#271 a failing Cloudflare falls back to OpenRouter", async () => {
	reset();
	const seen = [];
	const { env } = runtimeWith({
		OPENROUTER_API_KEY: "sk-or-test",
		AI: {
			run: async () => {
				throw new Error("AiError: 503 Service Unavailable");
			}
		}
	});
	await env.KV_BINDING.put("config:llm", JSON.stringify({ provider: "rotate", cloudflareWeight: 10, openrouterWeight: 1 }));
	const runtime = createRelayRuntime(env, new Request(SELF + "/api/script"), {
		selfOrigin: SELF,
		fetchImpl: openRouterFetch("router rescue", seen)
	});
	/* cloudflare has weight 10, so it is tried first and must fail over. */
	const first = await runtime.ai.run("@cf/meta/llama-3.1-8b-instruct-fp8", { prompt: "x" });
	assert.equal(first.response, "router rescue");
	assert.ok(seen.length >= 1);
});

test("#271 the pool rotation still runs underneath the provider rotation", async () => {
	reset();
	let localCalls = 0;
	const seen = [];
	const env = {
		RELAY_SECRET: "nested-rotation",
		AI: {
			run: async () => {
				localCalls += 1;
				return { response: "local" };
			}
		},
		KV_BINDING: makeKv({
			"config:workers": JSON.stringify(["https://backup.test"]),
			/* force the Cloudflare provider, then the pool picks the backup */
			"config:llm": JSON.stringify({ provider: "cloudflare" }),
			"config:relay": JSON.stringify({ strategy: "weighted", localWeight: 0 })
		})
	};
	const runtime = createRelayRuntime(env, new Request(SELF + "/api/script"), {
		selfOrigin: SELF,
		fetchImpl: async (url, init) => {
			seen.push({ url, init });
			return json({ ok: true, result: { response: "backup-answer" } }, 200);
		}
	});
	const result = await runtime.ai.run("@cf/meta/llama-3.1-8b-instruct-fp8", { prompt: "x" });
	assert.equal(result.response, "backup-answer");
	assert.ok(seen[0].url.startsWith("https://backup.test"), "the pool hop still happens");
	assert.equal(localCalls, 0);
});

/* ------------------------------------------------------------------ */
/* 6. Config                                                          */
/* ------------------------------------------------------------------ */

test("#271 the LLM policy is validated, stored and password-gated", async () => {
	reset();
	const env = { KV_BINDING: makeKv() };
	const url = new URL(SELF + "/api/llm/config");
	const options = { configPassword: "#123admin%", now: () => Date.now() };

	const denied = await handleLlmRoutes(
		new Request(SELF + "/api/llm/config", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: "nope", provider: "openrouter" })
		}),
		url,
		env,
		options
	);
	assert.equal(denied.status, 403);

	const saved = await handleLlmRoutes(
		new Request(SELF + "/api/llm/config", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				pw: "#123admin%",
				provider: "openrouter",
				model: "meta-llama/llama-3.3-8b-instruct:free",
				openrouterWeight: 3,
				timeoutMs: 30_000,
				apiKey: "sk-or-saved-key-123456"
			})
		}),
		url,
		env,
		options
	);
	assert.equal(saved.status, 200);
	const body = await saved.json();
	assert.equal(body.config.provider, "openrouter");
	assert.equal(body.config.openrouterWeight, 3);
	assert.equal(body.config.apiKey, "", "the saved key is not echoed");
	assert.equal(body.hasStoredKey, true);

	const stored = JSON.parse(env.KV_BINDING.store.get("config:llm"));
	assert.equal(stored.apiKey, "sk-or-saved-key-123456");
	assert.equal((await readLlmConfig(env)).provider, "openrouter");

	/* An empty apiKey on a later save keeps the stored one. */
	await writeLlmConfig(env, { provider: "rotate", apiKey: "" });
	assert.equal(JSON.parse(env.KV_BINDING.store.get("config:llm")).apiKey, "sk-or-saved-key-123456");

	/* Clamping. */
	const clamped = normalizeLlmConfig({ provider: "nope", timeoutMs: 1, maxTokensCap: 999_999, cloudflareWeight: 99 });
	assert.equal(clamped.provider, "rotate");
	assert.equal(clamped.timeoutMs, 5_000);
	assert.equal(clamped.maxTokensCap, 32_768);
	assert.equal(clamped.cloudflareWeight, 10);
});

test("#271 GET /api/llm/status reports both providers and the key source", async () => {
	reset();
	const env = { KV_BINDING: makeKv(), OPENROUTER_API_KEY: "sk-or-status-key" };
	const response = await handleLlmRoutes(
		new Request(SELF + "/api/llm/status"),
		new URL(SELF + "/api/llm/status"),
		env,
		{}
	);
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.openRouter.model, DEFAULT_OPENROUTER_MODEL);
	assert.equal(body.openRouter.keySource, "env");
	assert.equal(body.keyConfigured, true);
	assert.deepEqual(body.providers.map((entry) => entry.id), ["cloudflare", "openrouter"]);

	/* No key configured: reported, and the rotation resolves to Cloudflare. */
	const none = await handleLlmRoutes(
		new Request(SELF + "/api/llm/status"),
		new URL(SELF + "/api/llm/status"),
		{},
		{}
	);
	const noneBody = await none.json();
	assert.equal(noneBody.keyConfigured, false);
	assert.equal(noneBody.openRouter.keyConfigured, false);
});

test("#271 POST /api/llm/test probes OpenRouter and Cloudflare and reports each result", async () => {
	reset();
	const env = { KV_BINDING: makeKv(), OPENROUTER_API_KEY: "sk-or-test" };
	const response = await handleLlmRoutes(
		new Request(SELF + "/api/llm/test", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: "#123admin%" })
		}),
		new URL(SELF + "/api/llm/test"),
		env,
		{
			configPassword: "#123admin%",
			fetchImpl: openRouterFetch("The quick brown fox jumps over the lazy dog."),
			cloudflareProbe: async () => "The quick brown fox jumps over the lazy dog."
		}
	);
	const body = await response.json();
	assert.equal(body.success, true);
	assert.deepEqual(body.results.map((entry) => entry.provider), ["openrouter", "cloudflare"]);
	assert.ok(body.results.every((entry) => entry.ok));

	const denied = await handleLlmRoutes(
		new Request(SELF + "/api/llm/test", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: "x" })
		}),
		new URL(SELF + "/api/llm/test"),
		env,
		{ configPassword: "#123admin%" }
	);
	assert.equal(denied.status, 403);

	const notLlm = await handleLlmRoutes(
		new Request(SELF + "/api/relay/status"),
		new URL(SELF + "/api/relay/status"),
		env,
		{ configPassword: "#123admin%" }
	);
	assert.equal(notLlm, null);
});

/* ------------------------------------------------------------------ */
/* 7. The user-facing raw API                                          */
/* ------------------------------------------------------------------ */

function rawRequest(body, headers = {}) {
	return new Request(SELF + "/api/llm/generate", {
		method: "POST",
		headers: Object.assign({ "Content-Type": "application/json" }, headers),
		body: JSON.stringify(body)
	});
}

test("#271 POST /api/llm/generate rotates by default and reports which provider answered", async () => {
	reset();
	const realFetch = globalThis.fetch;
	const seen = [];
	globalThis.fetch = openRouterFetch("rotated text", seen);
	try {
		const env = {
			KV_BINDING: makeKv({ "config:llm": JSON.stringify({ provider: "openrouter" }) }),
			OPENROUTER_API_KEY: "sk-or-test",
			AI: { run: async () => ({ response: "cloudflare text" }) }
		};
		const response = await worker.fetch(
			rawRequest({ prompt: "say hi" }, { Cookie: "yvs_free=1", "CF-Connecting-IP": "203.0.113.5" }),
			env,
			{}
		);
		assert.equal(response.status, 200, await response.clone().text());
		const body = await response.json();
		assert.equal(body.success, true);
		assert.equal(body.text, "rotated text");
		assert.equal(body.provider, "openrouter");
		assert.equal(body.model, DEFAULT_OPENROUTER_MODEL);
		assert.ok(body.ms >= 0);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("#271 the raw API honours an explicit provider and rejects an unknown one", async () => {
	reset();
	const env = {
		KV_BINDING: makeKv({ "config:llm": JSON.stringify({ provider: "openrouter" }) }),
		OPENROUTER_API_KEY: "sk-or-test",
		AI: { run: async () => ({ response: "cloudflare text" }) }
	};
	const forced = await worker.fetch(
		rawRequest({ prompt: "hi", provider: "cloudflare" }, { Cookie: "yvs_free=1" }),
		env,
		{}
	);
	const forcedBody = await forced.json();
	assert.equal(forcedBody.provider, "cloudflare");
	assert.equal(forcedBody.text, "cloudflare text");

	const bad = await worker.fetch(
		rawRequest({ prompt: "hi", provider: "gemini" }, { Cookie: "yvs_free=1" }),
		env,
		{}
	);
	assert.equal(bad.status, 400);
});

test("#271 the raw API validates input and requires the same access as the studio", async () => {
	reset();
	const realFetch = globalThis.fetch;
	globalThis.fetch = openRouterFetch("ok", []);
	try {
		const env = {
			KV_BINDING: makeKv({ "config:llm": JSON.stringify({ provider: "openrouter" }) }),
			OPENROUTER_API_KEY: "sk-or-test"
		};

		const anonymous = await worker.fetch(rawRequest({ prompt: "hi" }), env, {});
		assert.equal(anonymous.status, 401, "a cold anonymous caller cannot spend the key");

		const missing = await worker.fetch(rawRequest({}, { Cookie: "yvs_free=1" }), env, {});
		assert.equal(missing.status, 400);

		const tooLong = await worker.fetch(
			rawRequest({ prompt: "x".repeat(50_000) }, { Cookie: "yvs_free=1" }),
			env,
			{}
		);
		assert.equal(tooLong.status, 413);

		const notObject = await worker.fetch(
			new Request(SELF + "/api/llm/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: "yvs_free=1" },
				body: JSON.stringify(["nope"])
			}),
			env,
			{}
		);
		assert.equal(notObject.status, 400);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("#271 a relayed compute call never reaches OpenRouter", async () => {
	reset();
	const realFetch = globalThis.fetch;
	let openRouterCalls = 0;
	globalThis.fetch = openRouterFetch("should not happen", []);
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		if (String(url).startsWith("https://openrouter.ai")) openRouterCalls += 1;
		return originalFetch(url, init);
	};
	try {
		const env = {
			RELAY_SECRET: "one-hop",
			KV_BINDING: makeKv({ "config:llm": JSON.stringify({ provider: "openrouter" }) }),
			OPENROUTER_API_KEY: "sk-or-test",
			AI: { run: async () => ({ response: "executed here" }) }
		};
		const body = JSON.stringify({ model: "@cf/meta/llama-3.1-8b-instruct-fp8", input: { prompt: "x" } });
		const token = await signRelayToken(env, {
			v: 1,
			k: "ai",
			exp: Date.now() + 60_000,
			m: "@cf/meta/llama-3.1-8b-instruct-fp8"
		});
		const response = await worker.fetch(
			new Request(SELF + "/api/relay/ai", {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-yvs-relay-token": token },
				body
			}),
			env,
			{}
		);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { ok: true, result: { response: "executed here" } });
		assert.equal(openRouterCalls, 0, "the compute endpoint runs the raw binding only");
	} finally {
		globalThis.fetch = realFetch;
	}
});

/* ------------------------------------------------------------------ */
/* 8. Settings page: the LLM panel                                    */
/* ------------------------------------------------------------------ */

test("#271 the settings page shows the LLM card, loads the policy and tests both providers", async () => {
	const { JSDOM } = await import("jsdom");
	const { CONFIG_PAGE_SCRIPT } = await import("../src/client/config-page-js.ts");
	const { createHTML } = await import("../src/page.ts");

	const scriptStart = CONFIG_PAGE_SCRIPT.indexOf("<script>") + 8;
	const scriptEnd = CONFIG_PAGE_SCRIPT.lastIndexOf("</script>");

	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: SELF + "/26/config/uvxyz" });
	const w = dom.window;
	w.alert = () => {};
	w.confirm = () => true;
	w.scrollTo = () => {};
	w.URL.createObjectURL = () => "blob:llm-test";
	w.URL.revokeObjectURL = () => {};

	const calls = [];
	w.fetch = async (url, init) => {
		const target = String(url);
		calls.push({ url: target, method: (init && init.method) || "GET", body: init && init.body });
		const reply = (body) =>
			new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
		if (target.indexOf("/api/config/verify") !== -1) return reply({ valid: true, theme: "default" });
		if (target.indexOf("/api/llm/test") !== -1) {
			return reply({
				success: true,
				results: [
					{ provider: "openrouter", ok: true, ms: 800, preview: "The quick brown fox." },
					{ provider: "cloudflare", ok: true, ms: 640, preview: "The quick brown fox." }
				]
			});
		}
		if (target.indexOf("/api/llm/config") !== -1) {
			return reply({
				success: true,
				config: {
					provider: "rotate",
					model: "meta-llama/llama-3.3-8b-instruct:free",
					cloudflareWeight: 1,
					openrouterWeight: 2,
					timeoutMs: 90000,
					maxTokensCap: 4096,
					systemPrompt: "Be brief."
				},
				hasStoredKey: true,
				keySource: "kv",
				keyTail: "99-9999"
			});
		}
		if (target.indexOf("/api/llm/status") !== -1) {
			return reply({
				success: true,
				providers: [
					{ id: "cloudflare", label: "Cloudflare Workers AI", state: "ready", model: "llama" },
					{ id: "openrouter", label: "OpenRouter", state: "ready", successes: 3, failures: 0, ewmaMs: 900, keySource: "kv", keyTail: "99-9999" }
				],
				openRouter: { keyConfigured: true }
			});
		}
		if (target.indexOf("/api/relay/") !== -1) return reply({ success: true, config: {}, endpoints: [] });
		return reply({ success: true });
	};

	try {
		w.eval(CONFIG_PAGE_SCRIPT.slice(scriptStart, scriptEnd));
		assert.ok(w.document.getElementById("cfg-llm-card"), "the LLM card is part of the settings page");

		w.document.getElementById("cfg-pw-input").value = "#123admin%";
		w.document.getElementById("cfg-pw-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
		await new Promise((resolve) => setTimeout(resolve, 250));

		assert.equal(w.document.getElementById("cfg-llm-provider").value, "rotate");
		assert.equal(w.document.getElementById("cfg-llm-model").value, "meta-llama/llama-3.3-8b-instruct:free");
		assert.equal(w.document.getElementById("cfg-llm-or-weight").value, "2");
		assert.match(w.document.getElementById("cfg-llm-key").placeholder, /99-9999/);
		assert.match(w.document.getElementById("cfg-llm-providers").textContent, /OpenRouter/);

		w.document.getElementById("cfg-llm-test").click();
		await new Promise((resolve) => setTimeout(resolve, 80));
		assert.match(w.document.getElementById("cfg-llm-msg").textContent, /openrouter: OK in 800 ms/);

		w.document.getElementById("cfg-llm-key").value = "sk-or-new-key";
		w.document.getElementById("cfg-llm-save").click();
		await new Promise((resolve) => setTimeout(resolve, 80));
		const save = calls.find((call) => call.method === "POST" && call.url === "/api/llm/config");
		assert.ok(save, "Save posts the policy");
		const payload = JSON.parse(save.body);
		assert.equal(payload.pw, "#123admin%");
		assert.equal(payload.apiKey, "sk-or-new-key");
		assert.equal(payload.openrouterWeight, 2);
		assert.equal(payload.timeoutMs, 90000);
	} finally {
		w.close();
	}
});

test("#271 an OpenRouter hang is bounded and a caller cancellation is not a provider failure", async () => {
	reset();
	/* A fetch that never resolves: the internal deadline must end the call. */
	await assert.rejects(
		() =>
			runOpenRouterCompletion({
				env: { OPENROUTER_API_KEY: "sk-or-test" },
				config: config({}),
				prompt: "x",
				timeoutMs: 5000,
				fetchImpl: (url, init) =>
					new Promise((resolve, reject) => {
						init.signal.addEventListener("abort", () => reject(new Error("aborted by signal")));
					})
			}),
		/aborted by signal|did not answer/
	);

	/* A cancelled request aborts the call and does not open the circuit. */
	reset();
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		() =>
			runOpenRouterCompletion({
				env: { OPENROUTER_API_KEY: "sk-or-test" },
				config: config({}),
				prompt: "x",
				signal: controller.signal,
				fetchImpl: (url, init) =>
					new Promise((resolve, reject) => {
						if (init.signal.aborted) {
							reject(new Error("aborted"));
							return;
						}
						init.signal.addEventListener("abort", () => reject(new Error("aborted")));
					})
			}),
		/aborted|cancelled/
	);
	const report = await describeLlmProviders({ OPENROUTER_API_KEY: "sk-or-test" });
	assert.equal(report.providers.find((entry) => entry.id === "openrouter").state, "ready");
});

test("#271 without a key every instruct call stays on Workers AI", async () => {
	reset();
	const { env } = runtimeWith({
		AI: { run: async () => ({ response: "cloudflare-only" }) },
		OPENROUTER_API_KEY: undefined
	});
	await env.KV_BINDING.put("config:llm", JSON.stringify({ provider: "openrouter" }));
	let contacted = 0;
	const runtime = createRelayRuntime(env, new Request(SELF + "/api/script"), {
		selfOrigin: SELF,
		fetchImpl: async () => {
			contacted += 1;
			throw new Error("no key, no call");
		}
	});
	const result = await runtime.ai.run("@cf/meta/llama-3.1-8b-instruct-fp8", { prompt: "x" });
	assert.deepEqual(result, { response: "cloudflare-only" });
	assert.equal(contacted, 0);
	assert.equal(runtime.stats().cloudflare, 1);
});
