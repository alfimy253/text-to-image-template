/*
 * API rotation across the primary Worker and the registered backup Workers
 * (Session #265, `src/modules/api-relay.ts` + `src/client/api-rotation.ts`).
 *
 * The settings page has always stored up to three backup Worker URLs and
 * nothing ever contacted them. This suite pins the replacement contract:
 *
 *   1. The pool is `[this Worker, ...registered backups]`, deduplicated
 *      against our own origin and validated as http(s).
 *   2. Selection honours the strategy, health and circuit breaking, and never
 *      drops the local Worker out of the candidate list.
 *   3. A relayed model call is a signed `POST <backup>/api/relay/ai`; the
 *      backup runs the model ONCE, locally, and answers the same shape
 *      `env.AI.run()` would (JSON or raw bytes).
 *   4. Any transport / overload failure fails over to the next member and
 *      finally to local; a cancelled request is never rerouted.
 *   5. `withRelayedAi()` upgrades env.AI for every existing call site, so
 *      images, prompts, script, seo-plan, voiceover and /tts all rotate.
 *   6. Browser rotation needs a signed, path-scoped ticket, only the AI paths
 *      gain CORS, and account/settings/payment/CMS routes can never be
 *      reached with a ticket.
 *   7. The rotation policy is password-gated, stored in KV, and the admin
 *      panel can probe every endpoint on demand.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
	MAX_RELAY_WORKERS,
	RELAY_AI_PATH,
	RELAY_AI_PATHS,
	RELAY_DEFAULT_CONFIG,
	RELAY_ENDPOINT_PATH,
	RELAY_MAX_BODY_BYTES,
	RELAY_PING_PATH,
	RELAY_RESULT_HEADER,
	RELAY_TOKEN_HEADER,
	RELAY_TICKET_HEADER,
	applyRelayCors,
	createRelayRuntime,
	describeRelayPool,
	handleRelayAiCall,
	handleRelayRoutes,
	invalidateRelayCache,
	noteRelayFailure,
	noteRelaySuccess,
	normalizeRelayConfig,
	orderRelayCandidates,
	pickRelayEndpoint,
	probeRelayEndpoint,
	readRelayConfig,
	readRelayReportTicket,
	relayHealthSnapshot,
	relayPreflightResponse,
	relayTicketIdentity,
	resetRelayHealth,
	resolveRelayPool,
	RELAY_CHAIN_MAX_MS,
	signRelayToken,
	verifyRelayToken,
	withRelayedAi,
	writeRelayConfig
} from "../src/modules/api-relay.ts";
import { JSDOM } from "jsdom";

import { invalidateLlmCache, resetLlmHealth } from "../src/modules/llm-openrouter.ts";
import { API_ROTATION_JS } from "../src/client/api-rotation.ts";
import { CONFIG_PAGE_SCRIPT } from "../src/client/config-page-js.ts";
import { createHTML } from "../src/page.ts";
import { default as workerModule } from "../src/index.ts";

const worker = workerModule.default || workerModule;
const SELF = "https://primary.test";
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

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

function json(body, status = 200, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: Object.assign({ "Content-Type": "application/json" }, headers)
	});
}

function requestFor(path, init = {}) {
	return new Request(SELF + path, init);
}

function config(overrides = {}) {
	return normalizeRelayConfig(Object.assign({}, RELAY_DEFAULT_CONFIG, overrides));
}

/** Resets isolate caches between tests so one case cannot leak into the next. */
function resetIsolate() {
	invalidateRelayCache();
	resetRelayHealth();
	invalidateLlmCache();
	resetLlmHealth();
}

/*
 * Bug fix #271 adds a provider rotation above the pool rotation: an instruct
 * model can now also be answered by OpenRouter. The pool tests below are about
 * the Worker pool only, so they pin the provider to Cloudflare.
 */
function cloudflareOnly(kv) {
	kv.store.set("config:llm", JSON.stringify({ provider: "cloudflare" }));
	return kv;
}

async function seedWorkers(env, urls) {
	await env.KV_BINDING.put("config:workers", JSON.stringify(urls));
	invalidateRelayCache();
}

/* ------------------------------------------------------------------ */
/* 1. Pool resolution                                                 */
/* ------------------------------------------------------------------ */

test("relay pool = this Worker + valid registered backups, deduplicated", async () => {
	resetIsolate();
	const env = {
		KV_BINDING: makeKv({
			"config:workers": JSON.stringify([
				"https://backup-a.workers.dev",
				"https://primary.test",
				"https://backup-a.workers.dev/",
				"not-a-url",
				"ftp://nope.test",
				"https://backup-b.workers.dev/sub/"
			])
		})
	};
	const pool = await resolveRelayPool(env, SELF);
	assert.deepEqual(
		pool.map((entry) => entry.url),
		["https://primary.test", "https://backup-a.workers.dev", "https://backup-b.workers.dev/sub"]
	);
	assert.equal(pool[0].local, true);
	assert.equal(pool[1].local, false);

	/* Without KV the pool is just this Worker: single-deployment behaviour. */
	invalidateRelayCache();
	const bare = await resolveRelayPool({}, SELF);
	assert.deepEqual(bare.map((entry) => entry.url), [SELF]);
});

test("RELAY_WORKERS env and options.envWorkers are merged into the pool", async () => {
	resetIsolate();
	const env = { RELAY_WORKERS: "https://env-a.test, https://env-b.test" };
	const pool = await resolveRelayPool(env, SELF, { envWorkers: ["https://opt.test"] });
	assert.deepEqual(
		pool.map((entry) => entry.url).slice(1),
		["https://env-a.test", "https://env-b.test", "https://opt.test"]
	);
});

/* ------------------------------------------------------------------ */
/* 2. Strategy + health                                               */
/* ------------------------------------------------------------------ */

test("round robin walks the weighted ring: each backup gets 3 turns, the UI Worker 1", () => {
	resetIsolate();
	const pool = [
		{ id: "local", url: SELF, local: true, label: "local" },
		{ id: "a", url: "https://a.test", local: false, label: "a" },
		{ id: "b", url: "https://b.test", local: false, label: "b" }
	];
	const rotation = config({ strategy: "round-robin" });

	/*
	 * Ring = local x1 + a x3 + b x3 (RELAY_BACKUP_RING_WEIGHT). Seven picks
	 * walk every slot once, which is the whole point of Session 331: the
	 * UI-serving Worker gets the smaller share of the API work.
	 */
	const picks = [];
	for (let i = 0; i < 7; i++) picks.push(orderRelayCandidates(pool, rotation)[0].id);
	assert.equal(picks.filter((id) => id === "local").length, 1, "the UI Worker is one slot in seven");
	assert.equal(picks.filter((id) => id === "a").length, 3);
	assert.equal(picks.filter((id) => id === "b").length, 3);

	/* Round robin is the ONLY scheme: an old value is dropped. */
	assert.equal(normalizeRelayConfig({ strategy: "least-pending" }).strategy, "round-robin");
	assert.equal(normalizeRelayConfig({ strategy: "weighted", localWeight: 4 }).strategy, "round-robin");

	/* Weight 0 keeps this Worker out of the ring, never out of the pool. */
	const off = orderRelayCandidates(pool, config({ localWeight: 0 }));
	assert.equal(off[0].local, false, "the first pick is a backup");
	assert.equal(off[off.length - 1].id, "local", "but this Worker is still the last resort");
});

test("a failing backup is circuit-broken, cooling members move to the end, success heals it", () => {
	resetIsolate();
	const pool = [
		{ id: "local", url: SELF, local: true, label: "local" },
		{ id: "flaky", url: "https://flaky.test", local: false, label: "flaky" }
	];
	const now = Date.now();
	noteRelayFailure("flaky", new Error("503 Service Unavailable"), 30_000, now);
	let ordered = orderRelayCandidates(pool, config({ strategy: "round-robin" }), now + 1);
	assert.equal(ordered[0].id, "local", "the cooling backup is skipped");
	assert.equal(ordered[ordered.length - 1].id, "flaky", "but it stays as a last resort");

	/* Everything cooling: local is still tried first, never dropped. */
	noteRelayFailure("local", new Error("429 Too Many Requests"), 30_000, now);
	ordered = orderRelayCandidates(pool, config(), now + 2);
	assert.equal(ordered[0].id, "local");

	noteRelaySuccess("flaky", 42, now + 3);
	ordered = orderRelayCandidates(pool, config({ strategy: "least-pending" }), now + 4);
	assert.equal(ordered[0].id, "flaky", "a success closes the circuit again");
});

/* ------------------------------------------------------------------ */
/* 3. Tokens                                                          */
/* ------------------------------------------------------------------ */

test("relay tokens are signed, expired and kind-checked", async () => {
	resetIsolate();
	const env = { RELAY_SECRET: "unit-test-secret" };
	const token = await signRelayToken(env, { v: 1, k: "ai", exp: Date.now() + 60_000, m: "@cf/x/y" });
	const payload = await verifyRelayToken(env, token, "ai");
	assert.equal(payload.m, "@cf/x/y");

	assert.equal(await verifyRelayToken(env, token, "client"), null, "kind is enforced");
	assert.equal(await verifyRelayToken({ RELAY_SECRET: "other" }, token, "ai"), null, "secret is enforced");

	const [body, signature] = [token.slice(0, token.lastIndexOf(".")), token.slice(token.lastIndexOf(".") + 1)];
	const tampered = body.slice(0, -2) + (body.endsWith("AA") ? "BB" : "AA") + "." + signature;
	assert.equal(await verifyRelayToken(env, tampered, "ai"), null, "payload is authenticated");

	const expired = await signRelayToken(env, { v: 1, k: "ai", exp: Date.now() - 1 });
	assert.equal(await verifyRelayToken(env, expired, "ai"), null);
	assert.equal(await verifyRelayToken(env, "garbage", "ai"), null);
});

test("a client ticket authorizes only the AI paths", async () => {
	resetIsolate();
	const env = {};
	const ticket = await signRelayToken(env, {
		v: 1,
		k: "client",
		exp: Date.now() + 60_000,
		u: "alice",
		e: "alice@example.com",
		p: "paid_user",
		paths: RELAY_AI_PATHS.slice()
	});
	const imageRequest = requestFor("/api/image", { headers: { [RELAY_TICKET_HEADER]: ticket } });
	const identity = await relayTicketIdentity(imageRequest, env);
	assert.equal(identity.username, "alice");
	assert.equal(identity.usertype, "paid_user");

	for (const path of ["/api/config/workers", "/api/payments/my", "/api/session", "/account"]) {
		const blocked = requestFor(path, { headers: { [RELAY_TICKET_HEADER]: ticket } });
		assert.equal(await relayTicketIdentity(blocked, env), null, path + " must reject a ticket");
	}

	const guest = await signRelayToken(env, { v: 1, k: "client", exp: Date.now() + 60_000, g: true, paths: RELAY_AI_PATHS.slice() });
	const guestRequest = requestFor("/api/image-batch", { headers: { [RELAY_TICKET_HEADER]: guest } });
	assert.equal(await relayTicketIdentity(guestRequest, env), null, "a guest ticket is not an account");
});

/* ------------------------------------------------------------------ */
/* 4. env.AI upgrade + failover                                       */
/* ------------------------------------------------------------------ */

test("withRelayedAi keeps the old behaviour when no backup is registered", async () => {
	resetIsolate();
	let calls = 0;
	const env = {
		AI: {
			run: async (model) => {
				calls += 1;
				return { response: "local:" + model };
			}
		}
	};
	const wrapped = withRelayedAi(env, requestFor("/api/script"));
	assert.deepEqual(await wrapped.AI.run("@cf/meta/llama", { prompt: "hi" }), {
		response: "local:@cf/meta/llama"
	});
	assert.equal(calls, 1);
	assert.equal(wrapped.KV_BINDING, env.KV_BINDING, "other bindings pass through");
});

test("a registered backup receives the model call; the primary binding is not used", async () => {
	resetIsolate();
	let localCalls = 0;
	const env = {
		AI: {
			run: async () => {
				localCalls += 1;
				return { response: "local" };
			}
		},
		KV_BINDING: cloudflareOnly(makeKv({ "config:workers": JSON.stringify(["https://backup.test"]) }))
	};
	const seen = [];
	const fetchImpl = async (url, init) => {
		seen.push({ url, init });
		return json({ ok: true, result: { response: "remote" } }, 200, { [RELAY_RESULT_HEADER]: "json" });
	};

	const runtime = createRelayRuntime(env, requestFor("/api/script"), {
		fetchImpl,
		selfOrigin: SELF
	});
	/* Round-robin may pick either member, so take the local Worker out of
	   the first position exactly like an overloaded primary would. */
	noteRelayFailure("local", new Error("429 Too Many Requests"), 30_000);

	const result = await runtime.ai.run("@cf/meta/llama", { prompt: "hello" });
	assert.deepEqual(result, { response: "remote" });
	assert.equal(localCalls, 0);
	assert.equal(seen[0].url, "https://backup.test" + RELAY_AI_PATH);
	assert.ok(seen[0].init.headers[RELAY_TOKEN_HEADER], "the call is signed");
	const payload = JSON.parse(seen[0].init.body);
	assert.equal(payload.model, "@cf/meta/llama");
	assert.equal(payload.input.prompt, "hello");
});

test("binary model results survive the relay as bytes", async () => {
	resetIsolate();
	const env = {
		AI: { run: async () => PNG },
		KV_BINDING: makeKv({ "config:workers": JSON.stringify(["https://backup.test"]) })
	};
	const fetchImpl = async () =>
		new Response(PNG, { status: 200, headers: { [RELAY_RESULT_HEADER]: "binary" } });
	noteRelayFailure("local", new Error("503 Service Unavailable"), 30_000);
	const runtime = createRelayRuntime(env, requestFor("/api/image"), { fetchImpl, selfOrigin: SELF });
	/* Session 331 removed AI image generation (Pixabay only), so the binary
	 * relay contract is pinned on a model the policy still runs: MeloTTS
	 * answers audio bytes and travels the identical `binary` path. */
	const value = await runtime.ai.run("@cf/myshell-ai/melotts", { prompt: "x" });
	assert.ok(value instanceof Uint8Array);
	assert.deepEqual(Array.from(value.slice(0, 4)), [137, 80, 78, 71]);
});

test("a backup failure fails over to the next member and finally to local", async () => {
	resetIsolate();
	const local = { calls: 0 };
	const env = {
		AI: {
			run: async () => {
				local.calls += 1;
				return { response: "local-answer" };
			}
		},
		KV_BINDING: cloudflareOnly(makeKv({
			"config:workers": JSON.stringify(["https://dead.test", "https://alive.test"])
		})),
		RELAY_SECRET: "failover-secret"
	};
	const attempted = [];
	const fetchImpl = async (url) => {
		attempted.push(url);
		if (url.startsWith("https://dead.test")) throw new TypeError("network down");
		return json({ ok: true, result: { response: "alive-answer" } }, 200, { [RELAY_RESULT_HEADER]: "json" });
	};
	/* Local is cooling, so the dead backup is the first candidate. */
	noteRelayFailure("local", new Error("429 Too Many Requests"), 30_000);
	const runtime = createRelayRuntime(env, requestFor("/api/script"), { fetchImpl, selfOrigin: SELF });
	const result = await runtime.ai.run("@cf/meta/llama", { prompt: "x" });
	assert.ok(attempted.some((url) => url.startsWith("https://dead.test")), "the dead worker was tried");
	assert.ok(result.response === "alive-answer" || result.response === "local-answer");
	assert.ok(runtime.stats().failedOver >= 1, "the failover is reported");

	/* Now make every backup fail: local must answer. */
	resetIsolate();
	const attempted2 = [];
	const env2 = {
		AI: {
			run: async () => {
				local.calls += 1;
				return { response: "local-answer" };
			}
		},
		KV_BINDING: cloudflareOnly(makeKv({ "config:workers": JSON.stringify(["https://dead.test"]) }))
	};
	const runtime2 = createRelayRuntime(env2, requestFor("/api/script"), {
		fetchImpl: async (url) => {
			attempted2.push(url);
			throw new TypeError("network down");
		},
		selfOrigin: SELF
	});
	noteRelayFailure("local", new Error("429 Too Many Requests"), 1);
	const value = await runtime2.ai.run("@cf/meta/llama", { prompt: "x" });
	assert.deepEqual(value, { response: "local-answer" });
	assert.ok(attempted2.length >= 1);
});

test("an invalid model slug is rejected before any endpoint is contacted", async () => {
	resetIsolate();
	let contacted = 0;
	const runtime = createRelayRuntime(
		{ AI: { run: async () => ({ response: "x" }), }, KV_BINDING: makeKv() },
		requestFor("/api/script"),
		{
			fetchImpl: async () => {
				contacted += 1;
				return json({ ok: true, result: null });
			},
			selfOrigin: SELF
		}
	);
	await assert.rejects(() => runtime.ai.run("https://evil.test/exfiltrate", {}), /Invalid model slug/);
	assert.equal(contacted, 0);
});

test("rotation disabled keeps every call local even with backups registered", async () => {
	resetIsolate();
	const env = {
		AI: { run: async () => ({ response: "local" }) },
		KV_BINDING: makeKv({
			"config:workers": JSON.stringify(["https://backup.test"]),
			"config:relay": JSON.stringify({ enabled: false })
		})
	};
	let contacted = 0;
	const runtime = createRelayRuntime(env, requestFor("/api/script"), {
		fetchImpl: async () => {
			contacted += 1;
			return json({ ok: true, result: null });
		},
		selfOrigin: SELF
	});
	assert.deepEqual(await runtime.ai.run("@cf/meta/llama", { prompt: "x" }), { response: "local" });
	assert.equal(contacted, 0);
});

/* ------------------------------------------------------------------ */
/* 5. Inbound compute endpoint                                        */
/* ------------------------------------------------------------------ */

test("POST /api/relay/ai requires a valid signed token and executes once", async () => {
	resetIsolate();
	const env = {
		RELAY_SECRET: "endpoint-secret",
		AI: { run: async (model, input) => ({ response: "ran:" + input.prompt }) }
	};

	const anonymous = await handleRelayAiCall(
		requestFor(RELAY_AI_PATH, { method: "POST", body: JSON.stringify({ model: "@cf/meta/llama", input: {} }) }),
		env
	);
	assert.equal(anonymous.status, 401);

	const body = JSON.stringify({ model: "@cf/meta/llama", input: { prompt: "ping" } });
	const token = await signRelayToken(env, { v: 1, k: "ai", exp: Date.now() + 60_000, m: "@cf/meta/llama" });
	const ok = await handleRelayAiCall(
		requestFor(RELAY_AI_PATH, {
			method: "POST",
			headers: { [RELAY_TOKEN_HEADER]: token, "Content-Type": "application/json" },
			body
		}),
		env
	);
	assert.equal(ok.status, 200);
	assert.equal(ok.headers.get(RELAY_RESULT_HEADER), "json");
	assert.deepEqual(await ok.json(), { ok: true, result: { response: "ran:ping" } });

	/* A token bound to a body digest rejects any other body. */
	const { createHash } = await import("node:crypto");
	const digest = (text) => createHash("sha256").update(text).digest("hex");
	const boundBody = JSON.stringify({ model: "@cf/meta/llama", input: { prompt: "bound" } });
	const boundToken = await signRelayToken(env, {
		v: 1,
		k: "ai",
		exp: Date.now() + 60_000,
		m: "@cf/meta/llama",
		d: digest(boundBody)
	});
	const boundOk = await handleRelayAiCall(
		requestFor(RELAY_AI_PATH, {
			method: "POST",
			headers: { [RELAY_TOKEN_HEADER]: boundToken, "Content-Type": "application/json" },
			body: boundBody
		}),
		env
	);
	assert.equal(boundOk.status, 200);
	const rebound = await handleRelayAiCall(
		requestFor(RELAY_AI_PATH, {
			method: "POST",
			headers: { [RELAY_TOKEN_HEADER]: boundToken, "Content-Type": "application/json" },
			body: JSON.stringify({ model: "@cf/meta/llama", input: { prompt: "different" } })
		}),
		env
	);
	assert.equal(rebound.status, 401, "a body-bound token cannot be replayed with another payload");
});

test("the compute endpoint returns raw bytes and 503 when this Worker has no AI binding", async () => {
	resetIsolate();
	const env = { RELAY_SECRET: "bytes-secret", AI: { run: async () => PNG } };
	const body = JSON.stringify({ model: "@cf/myshell-ai/melotts", input: { prompt: "x" } });
	const token = await signRelayToken(env, { v: 1, k: "ai", exp: Date.now() + 60_000, m: "@cf/myshell-ai/melotts" });
	const response = await handleRelayAiCall(
		requestFor(RELAY_AI_PATH, {
			method: "POST",
			headers: { [RELAY_TOKEN_HEADER]: token, "Content-Type": "application/json" },
			body
		}),
		env
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get(RELAY_RESULT_HEADER), "binary");
	assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from(PNG));

	const noAi = { RELAY_SECRET: "bytes-secret" };
	const unavailable = await handleRelayAiCall(
		requestFor(RELAY_AI_PATH, {
			method: "POST",
			headers: { [RELAY_TOKEN_HEADER]: token, "Content-Type": "application/json" },
			body
		}),
		noAi
	);
	assert.equal(unavailable.status, 503, "a backup without the binding must let the caller fail over");
	assert.equal(unavailable.headers.get("x-yvs-relay-error-kind"), "transient");
});

test("a model failure at the endpoint is reported as a model error", async () => {
	resetIsolate();
	const env = {
		RELAY_SECRET: "err-secret",
		AI: {
			run: async () => {
				throw new Error("no such model: @cf/retired/model");
			}
		}
	};
	const body = JSON.stringify({ model: "@cf/myshell-ai/melotts", input: {} });
	const token = await signRelayToken(env, { v: 1, k: "ai", exp: Date.now() + 60_000 });
	const response = await handleRelayAiCall(
		requestFor(RELAY_AI_PATH, {
			method: "POST",
			headers: { [RELAY_TOKEN_HEADER]: token, "Content-Type": "application/json" },
			body
		}),
		env
	);
	assert.equal(response.status, 502);
	assert.equal(response.headers.get("x-yvs-relay-error-kind"), "model");
	const payload = await response.json();
	assert.match(payload.error, /no such model/);
});

test("an oversized relay body is rejected", async () => {
	resetIsolate();
	const env = { RELAY_SECRET: "big-secret", AI: { run: async () => ({}) } };
	const token = await signRelayToken(env, { v: 1, k: "ai", exp: Date.now() + 60_000 });
	const response = await handleRelayAiCall(
		requestFor(RELAY_AI_PATH, {
			method: "POST",
			headers: { [RELAY_TOKEN_HEADER]: token, "Content-Type": "application/json" },
			body: JSON.stringify({ model: "@cf/meta/llama", input: { prompt: "x".repeat(RELAY_MAX_BODY_BYTES) } })
		}),
		env
	);
	assert.equal(response.status, 413);
});

/* ------------------------------------------------------------------ */
/* 6. Route layer: config, status, pool, probe                        */
/* ------------------------------------------------------------------ */

test("the rotation policy is password-gated and stored in KV", async () => {
	resetIsolate();
	const env = { KV_BINDING: makeKv() };
	const options = { selfOrigin: SELF, configPassword: "#123admin%" };

	const denied = await handleRelayRoutes(
		requestFor("/api/relay/config", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: "wrong", strategy: "weighted" })
		}),
		new URL(SELF + "/api/relay/config"),
		env,
		options
	);
	assert.equal(denied.status, 403);

	const saved = await handleRelayRoutes(
		requestFor("/api/relay/config", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: "#123admin%", strategy: "least-pending", localWeight: 2, clientRotation: false })
		}),
		new URL(SELF + "/api/relay/config"),
		env,
		options
	);
	assert.equal(saved.status, 200);
	const savedBody = await saved.json();
	/* Session 331: a posted scheme no longer survives — round robin only. */
	assert.equal(savedBody.config.strategy, "round-robin");
	assert.equal(savedBody.config.localWeight, 2);
	assert.ok(env.KV_BINDING.store.has("config:relay"));

	const readBack = await readRelayConfig(env);
	assert.equal(readBack.strategy, "round-robin");

	/* Clamping: nonsense values never escape the documented ranges. */
	const clamped = normalizeRelayConfig({ strategy: "nope", maxAttempts: 99, timeoutMs: 1, localWeight: 42 });
	assert.equal(clamped.strategy, "round-robin");
	assert.equal(clamped.maxAttempts, 5);
	assert.equal(clamped.timeoutMs, 5_000);
	assert.equal(clamped.localWeight, 10);
});

test("GET /api/relay/status reports every member and GET /api/relay/ping identifies the app", async () => {
	resetIsolate();
	const env = {
		KV_BINDING: makeKv({ "config:workers": JSON.stringify(["https://alive.test", "https://dead.test"]) })
	};
	const fetchImpl = async (url) => {
		if (url === "https://alive.test" + RELAY_PING_PATH) {
			return json({ success: true, relay: 1, capabilities: { ai: true } });
		}
		throw new TypeError("unreachable");
	};

	const status = await handleRelayRoutes(
		requestFor("/api/relay/status"),
		new URL(SELF + "/api/relay/status"),
		env,
		{ selfOrigin: SELF, fetchImpl }
	);
	assert.equal(status.status, 200);
	const report = await status.json();
	assert.equal(report.endpoints.length, 3);
	assert.equal(report.endpoints[0].local, true);
	const alive = report.endpoints.find((entry) => entry.url === "https://alive.test");
	const dead = report.endpoints.find((entry) => entry.url === "https://dead.test");
	assert.equal(alive.reachable, true);
	assert.equal(dead.reachable, false);

	const ping = await handleRelayRoutes(
		requestFor(RELAY_PING_PATH),
		new URL(SELF + RELAY_PING_PATH),
		env,
		{ selfOrigin: SELF }
	);
	const pingBody = await ping.json();
	assert.equal(pingBody.relay, 1);
	assert.ok(pingBody.capabilities.paths.includes("/api/voiceover"));
});

test("GET /api/relay/pool only advertises verified backups and issues a scoped ticket", async () => {
	resetIsolate();
	const env = { KV_BINDING: makeKv({ "config:workers": JSON.stringify(["https://alive.test", "https://dead.test"]) }) };
	const fetchImpl = async (url) => {
		if (url === "https://alive.test" + RELAY_PING_PATH) {
			return json({ success: true, relay: 1, capabilities: { ai: true } });
		}
		throw new TypeError("unreachable");
	};
	const options = {
		selfOrigin: SELF,
		fetchImpl,
		identity: async () => ({ username: "bob", email: "bob@example.com", usertype: "paid_user" })
	};
	/* First call learns the pool and probes in the background; the second sees it. */
	await handleRelayRoutes(requestFor("/api/relay/pool"), new URL(SELF + "/api/relay/pool"), env, options);
	const second = await handleRelayRoutes(
		requestFor("/api/relay/pool"),
		new URL(SELF + "/api/relay/pool"),
		env,
		options
	);
	const body = await second.json();
	assert.equal(body.success, true);
	assert.deepEqual(
		body.endpoints.filter((entry) => !entry.local).map((entry) => entry.url),
		["https://alive.test"],
		"the dead backup is not offered to the browser"
	);
	assert.ok(body.ticket, "a signed-in caller gets a ticket");
	const ticket = await verifyRelayToken(env, body.ticket, "client");
	assert.equal(ticket.u, "bob");
	assert.deepEqual(Array.from(ticket.paths), RELAY_AI_PATHS);

	/* A caller with no identity and no guest pass gets no ticket. */
	resetIsolate();
	const anonymous = await handleRelayRoutes(
		requestFor("/api/relay/pool"),
		new URL(SELF + "/api/relay/pool"),
		env,
		{ selfOrigin: SELF, fetchImpl, identity: async () => null, guest: () => false }
	);
	assert.equal((await anonymous.json()).ticket, null);
});

test("POST /api/relay/test re-probes every endpoint with the admin password", async () => {
	resetIsolate();
	const env = { KV_BINDING: makeKv({ "config:workers": JSON.stringify(["https://alive.test"]) }) };
	const options = {
		selfOrigin: SELF,
		configPassword: "#123admin%",
		fetchImpl: async () => json({ success: true, relay: 1, capabilities: { ai: true } })
	};
	const denied = await handleRelayRoutes(
		requestFor("/api/relay/test", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: "nope" })
		}),
		new URL(SELF + "/api/relay/test"),
		env,
		options
	);
	assert.equal(denied.status, 403);

	const allowed = await handleRelayRoutes(
		requestFor("/api/relay/test", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: "#123admin%" })
		}),
		new URL(SELF + "/api/relay/test"),
		env,
		options
	);
	const body = await allowed.json();
	assert.equal(body.success, true);
	assert.equal(body.endpoints.find((entry) => entry.url === "https://alive.test").reachable, true);
});

test("an unknown /api/relay route falls through to the main router", async () => {
	resetIsolate();
	const response = await handleRelayRoutes(
		requestFor("/api/relay/nope"),
		new URL(SELF + "/api/relay/nope"),
		{},
		{ selfOrigin: SELF }
	);
	assert.equal(response, null);
});

/* ------------------------------------------------------------------ */
/* 7. CORS                                                            */
/* ------------------------------------------------------------------ */

test("only AI paths answer a preflight, and only a ticketed call may read the response", async () => {
	resetIsolate();
	const env = { RELAY_SECRET: "cors-secret" };
	const preflight = relayPreflightResponse(
		requestFor("/api/script", { method: "OPTIONS", headers: { Origin: "https://studio.test" } })
	);
	assert.ok(preflight);
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
	assert.match(preflight.headers.get("Access-Control-Allow-Headers"), new RegExp(RELAY_TICKET_HEADER));

	assert.equal(
		relayPreflightResponse(requestFor("/api/config/workers", { method: "OPTIONS", headers: { Origin: "https://x.test" } })),
		null,
		"a settings route never answers a cross-origin preflight"
	);
	assert.equal(
		relayPreflightResponse(requestFor("/api/script", { method: "OPTIONS" })),
		null,
		"a same-origin request has no Origin header"
	);

	const ticket = await signRelayToken(env, {
		v: 1,
		k: "client",
		exp: Date.now() + 60_000,
		u: "alice",
		paths: RELAY_AI_PATHS.slice()
	});
	const ticketed = await applyRelayCors(
		requestFor("/api/image", { headers: { Origin: "https://studio.test", [RELAY_TICKET_HEADER]: ticket } }),
		json({ ok: true }),
		env
	);
	assert.equal(ticketed.headers.get("Access-Control-Allow-Origin"), "*");

	const unticketed = await applyRelayCors(
		requestFor("/api/image", { headers: { Origin: "https://studio.test" } }),
		json({ ok: true }),
		env
	);
	assert.equal(unticketed.headers.get("Access-Control-Allow-Origin"), null);

	/* A forged ticket unlocks nothing. */
	const forged = await applyRelayCors(
		requestFor("/api/image", { headers: { Origin: "https://studio.test", [RELAY_TICKET_HEADER]: "v1.forged.value" } }),
		json({ ok: true }),
		env
	);
	assert.equal(forged.headers.get("Access-Control-Allow-Origin"), null);

	/* A ticket for an AI path does not unlock a settings path. */
	const otherPath = await applyRelayCors(
		requestFor("/api/config/workers", { headers: { Origin: "https://studio.test", [RELAY_TICKET_HEADER]: ticket } }),
		json({ ok: true }),
		env
	);
	assert.equal(otherPath.headers.get("Access-Control-Allow-Origin"), null);
});

/* ------------------------------------------------------------------ */
/* 8. End-to-end through the Worker                                   */
/* ------------------------------------------------------------------ */

function imageWorkerEnv() {
	const kv = makeKv();
	return {
		kv,
		env: {
			AI: {
				run: async () => PNG
			},
			KV_BINDING: kv,
			RELAY_SECRET: "e2e-secret"
		}
	};
}

/* A 10-byte MP3 header: enough for the voiceover route to hand back bytes. */
const MP3 = Uint8Array.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]);
const MP3_DATA_URL = "data:audio/mpeg;base64," + Buffer.from(MP3).toString("base64");

/*
 * Session 331 replaced AI image generation with the Pixabay importer, so
 * `/api/image` is no longer a model route and can no longer prove that a
 * relayed request is authorised by its ticket alone. `/api/voiceover` is the
 * closest live equivalent: a ticket-only caller gets real model bytes back.
 */
function voiceWorkerEnv() {
	const kv = makeKv();
	return {
		kv,
		env: {
			AI: {
				run: async () => ({ audio: MP3_DATA_URL })
			},
			KV_BINDING: kv,
			RELAY_SECRET: "e2e-secret"
		}
	};
}

test("the studio can rotate an AI call to a backup with only a ticket (no cookie)", async () => {
	resetIsolate();
	const { env } = voiceWorkerEnv();
	const ticket = await signRelayToken(env, {
		v: 1,
		k: "client",
		exp: Date.now() + 60_000,
		u: "carol",
		e: "carol@example.com",
		p: "free_user",
		paths: RELAY_AI_PATHS.slice()
	});
	const response = await worker.fetch(
		new Request(SELF + "/api/voiceover", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "203.0.113.9",
				[RELAY_TICKET_HEADER]: ticket
			},
			body: JSON.stringify({ text: "A quiet garden story about bees.", voice: "voice-01" })
		}),
		env,
		{}
	);
	assert.equal(response.status, 200, await response.clone().text());
	assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
	assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from(MP3));
});

test("a ticket cannot open account, settings or payment routes on a backup", async () => {
	resetIsolate();
	const { env } = imageWorkerEnv();
	await env.KV_BINDING.put("config:workers", JSON.stringify(["https://backup.test"]));
	const ticket = await signRelayToken(env, {
		v: 1,
		k: "client",
		exp: Date.now() + 60_000,
		u: "carol",
		paths: RELAY_AI_PATHS.slice()
	});

	const session = await worker.fetch(
		new Request(SELF + "/api/session", { headers: { [RELAY_TICKET_HEADER]: ticket } }),
		env,
		{}
	);
	const sessionBody = await session.json();
	assert.notEqual(sessionBody.username, "carol", "a ticket must not authenticate a session");

	const settings = await worker.fetch(
		new Request(SELF + "/api/config/workers", {
			method: "POST",
			headers: { "Content-Type": "application/json", [RELAY_TICKET_HEADER]: ticket },
			body: JSON.stringify({ urls: ["https://evil.test"] })
		}),
		env,
		{}
	);
	assert.equal(settings.status, 403, "a ticket is not an administrator password");

	const payments = await worker.fetch(
		new Request(SELF + "/api/payments/my", { headers: { [RELAY_TICKET_HEADER]: ticket } }),
		env,
		{}
	);
	assert.notEqual(payments.status, 200);
});

test("the Worker serves /api/relay/ping and answers a preflight before routing", async () => {
	resetIsolate();
	const { env } = imageWorkerEnv();
	const ping = await worker.fetch(new Request(SELF + RELAY_PING_PATH), env, {});
	assert.equal(ping.status, 200);
	assert.equal((await ping.json()).relay, 1);

	const preflight = await worker.fetch(
		new Request(SELF + "/api/image", { method: "OPTIONS", headers: { Origin: "https://studio.test" } }),
		env,
		{}
	);
	assert.equal(preflight.status, 204);
	assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
});

/* ------------------------------------------------------------------ */
/* 9. Browser rotation script                                         */
/* ------------------------------------------------------------------ */

function browserRuntime(handler, answer) {
	const calls = [];
	const asks = [];
	const win = {
		location: { href: SELF + "/studio", origin: SELF },
		navigator: { onLine: true },
		setTimeout,
		clearTimeout,
		URL,
		AbortController,
		Headers,
		fetch: async (input, init) => {
			const url = typeof input === "string" ? input : input.url;
			if (url.indexOf("/api/relay/endpoint") === 0) {
				const parsed = new URL(url, SELF);
				const path = parsed.searchParams.get("path") || "";
				const failed = parsed.searchParams.get("failed") || "";
				asksPush(asks, { url, path, failed, init });
				const body = typeof answer === "function" ? answer(path, failed) : answer;
				return json(body || { success: false });
			}
			calls.push({ url, init });
			return handler(url, init);
		}
	};
	function asksPush(list, entry) { list.push(entry); }
	win.fetch = win.fetch.bind(win);
	const context = vm.createContext({ window: win, URL, Headers, AbortController, console, setTimeout, clearTimeout, Promise, Blob, FormData, URLSearchParams });
	vm.runInContext(API_ROTATION_JS, context);
	return { win, calls, asks };
}

test("the browser asks the Worker for the URL of an AI path and calls exactly that URL", async () => {
	const ticket = "ticket-value";
	const { win, calls, asks } = browserRuntime(
		(url) => json({ ok: true, servedBy: url }),
		(path) => ({
			success: true,
			path,
			url: "https://backup.test" + path,
			local: false,
			endpointId: "worker:https://backup.test",
			ticket,
			expiresAt: Date.now() + 60_000
		})
	);

	await win.fetch("/api/script", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

	/* One ask — the browser never picks the endpoint itself. */
	assert.deepEqual(asks.map((ask) => ask.path), ["/api/script"]);
	assert.equal(asks[0].url, "/api/relay/endpoint?path=%2Fapi%2Fscript", "the ask is a same-origin GET");
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "https://backup.test/api/script", "exactly the URL the server handed out");
	assert.equal(calls[0].init.headers[RELAY_TICKET_HEADER], ticket);
	assert.equal(calls[0].init.credentials, "omit", "a backup never receives this origin's cookies");
	assert.equal(win.__yvsApiRotation.stats().rotated, 1);
});

test("a failing backup is reported to the server, which hands out the next URL", async () => {
	const { win, calls, asks } = browserRuntime(
		(url) => (url.indexOf("https://backup.test") === 0 ? json({ error: "no" }, 503) : json({ ok: true })),
		(path, failed) => (failed
			? { success: true, path, url: path, local: true, endpointId: "local" }
			: { success: true, path, url: "https://backup.test" + path, local: false, endpointId: "worker:https://backup.test", ticket: "t", expiresAt: Date.now() + 60_000 })
	);

	const response = await win.fetch("/api/voiceover", { method: "POST", body: "{}" });
	assert.equal(response.status, 200);
	assert.equal(asks.length, 2, "the browser asks again instead of rotating on its own");
	assert.equal(asks[1].failed, "worker:https://backup.test", "the failed endpoint id travels back to the server");
	assert.ok(calls.some((call) => call.url.indexOf("https://backup.test") === 0), "the backup was tried");
	assert.ok(calls.some((call) => call.url === "/api/voiceover"), "the UI Worker answered the retry");
	assert.equal(win.__yvsApiRotation.stats().failovers, 1);
});

test("non-AI paths and relay routes never ask the server and are never rewritten", async () => {
	const { win, calls, asks } = browserRuntime(
		() => json({ ok: true }),
		() => ({ success: false, error: "must not be asked" })
	);
	const before = calls.length;
	await win.fetch("/api/config/workers");
	await win.fetch("/api/payments/my");
	await win.fetch("/account");
	await win.fetch("/api/relay/status");
	assert.equal(asks.length, 0, "no allow-listed path, no ask");
	assert.deepEqual(
		calls.slice(before).map((call) => call.url),
		["/api/config/workers", "/api/payments/my", "/account", "/api/relay/status"]
	);
});

test("when the server answers with this Worker's own URL the request keeps its cookies", async () => {
	const { win, calls, asks } = browserRuntime(
		() => json({ ok: true }),
		(path) => ({ success: true, path, url: path, local: true, endpointId: "local" })
	);
	await win.fetch("/api/image", { method: "POST", body: "{}" });
	assert.equal(asks.length, 1);
	assert.deepEqual(calls.map((call) => call.url), ["/api/image"]);
	assert.equal(calls[0].init.credentials, undefined, "the same-origin request is untouched");
	assert.equal(win.__yvsApiRotation.stats().local, 1);
});

/* ------------------------------------------------------------------ */
/* 10. Two real Worker deployments talking to each other              */
/* ------------------------------------------------------------------ */

test("worker A relays a real model call to worker B and returns B's bytes", async () => {
	resetIsolate();
	let primaryCalls = 0;
	let backupCalls = 0;
	const envA = {
		RELAY_SECRET: "shared-pool-secret",
		AI: {
			run: async () => {
				primaryCalls += 1;
				throw new Error("503 Service Unavailable");
			}
		},
		KV_BINDING: makeKv({ "config:workers": JSON.stringify(["https://backup.test"]) })
	};
	const envB = {
		RELAY_SECRET: "shared-pool-secret",
		AI: {
			run: async () => {
				backupCalls += 1;
				return { audio: MP3_DATA_URL };
			}
		},
		KV_BINDING: makeKv()
	};

	const ticket = await signRelayToken(envA, {
		v: 1,
		k: "client",
		exp: Date.now() + 60_000,
		u: "dana",
		p: "free_user",
		paths: RELAY_AI_PATHS.slice()
	});

	/* The backup is a real deployment of this same Worker. */
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => worker.fetch(new Request(input, init), envB, {});
	try {
		const response = await worker.fetch(
			new Request(SELF + "/api/voiceover", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": "203.0.113.20",
					[RELAY_TICKET_HEADER]: ticket
				},
				body: JSON.stringify({ text: "A relayed scene, read aloud.", voice: "voice-01" })
			}),
			envA,
			{}
		);
		assert.equal(response.status, 200, await response.clone().text());
		assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
		assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from(MP3));
		assert.ok(primaryCalls >= 1, "the cooling primary was tried first");
		assert.equal(backupCalls, 1, "the backup ran the model exactly once");
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("a relayed call is never relayed a second time (no A -> B -> A loop)", async () => {
	resetIsolate();
	const envA = {
		RELAY_SECRET: "loop-secret",
		AI: { run: async () => PNG },
		KV_BINDING: cloudflareOnly(makeKv({
			"config:workers": JSON.stringify(["https://backup.test"])
		}))
	};
	let hops = 0;
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		hops += 1;
		/* Whatever the backup is asked, it answers as the compute endpoint would. */
		return worker.fetch(new Request(input, init), envA, {});
	};
	try {
		const body = JSON.stringify({ model: "@cf/meta/llama", input: { prompt: "x" } });
		const token = await signRelayToken(envA, { v: 1, k: "ai", exp: Date.now() + 60_000, m: "@cf/meta/llama" });
		const response = await worker.fetch(
			new Request(SELF + RELAY_AI_PATH, {
				method: "POST",
				headers: { "Content-Type": "application/json", [RELAY_TOKEN_HEADER]: token },
				body
			}),
			envA,
			{}
		);
		assert.equal(response.status, 200);
		assert.equal(hops, 0, "the inbound compute endpoint never fetches another Worker");
	} finally {
		globalThis.fetch = realFetch;
	}
});

/* ------------------------------------------------------------------ */
/* 11. Settings page: the rotation panel                              */
/* ------------------------------------------------------------------ */

test("the settings page renders the rotation panel, loads the policy and saves it", async () => {
	const scriptStart = CONFIG_PAGE_SCRIPT.indexOf("<script>") + 8;
	const scriptEnd = CONFIG_PAGE_SCRIPT.lastIndexOf("</script>");
	const script = CONFIG_PAGE_SCRIPT.slice(scriptStart, scriptEnd);
	const style = CONFIG_PAGE_SCRIPT.slice(0, CONFIG_PAGE_SCRIPT.indexOf("<script>"));

	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: SELF + "/26/config/uvxyz" });
	const w = dom.window;
	w.alert = () => {};
	w.confirm = () => true;
	w.scrollTo = () => {};
	w.URL.createObjectURL = () => "blob:cfg-test";
	w.URL.revokeObjectURL = () => {};
	w.document.head.insertAdjacentHTML(
		"beforeend",
		style.replace(/<\/?style[^>]*>/g, (match) => (match.startsWith("</") ? "" : ""))
	);

	const calls = [];
	w.fetch = async (url, init) => {
		calls.push({ url: String(url), method: (init && init.method) || "GET", body: init && init.body });
		const reply = (body) =>
			new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
		if (String(url).indexOf("/api/config/verify") !== -1) return reply({ valid: true, theme: "default" });
		if (String(url).indexOf("/api/relay/test") !== -1) {
			return reply({
				success: true,
				endpoints: [
					{ id: "local", url: SELF, local: true, state: "ready", reachable: true },
					{ id: "w1", url: "https://backup.test", local: false, state: "ready", reachable: true, probeMs: 9 }
				]
			});
		}
		if (String(url).indexOf("/api/relay/config") !== -1) {
			return reply({
				success: true,
				config: {
					enabled: true,
					strategy: "round-robin",
					localWeight: 2,
					maxAttempts: 3,
					timeoutMs: 100000
				},
				usingDefaultSecret: true
			});
		}
		if (String(url).indexOf("/api/relay/status") !== -1) {
			return reply({
				success: true,
				endpoints: [
					{ id: "local", url: SELF, local: true, state: "ready", successes: 4, failures: 0, ewmaMs: 900, reachable: true },
					{ id: "w1", url: "https://backup.test", local: false, state: "cooling", successes: 1, failures: 2, ewmaMs: 500, reachable: true, probeMs: 12 }
				],
				usingDefaultSecret: true
			});
		}
		if (String(url).indexOf("/api/config/workers") !== -1) return reply({ success: true, urls: ["https://backup.test"] });
		return reply({ success: true });
	};

	try {
		w.eval(script);
		assert.ok(w.document.getElementById("cfg-relay-card"), "the rotation card is part of the settings page");

		w.document.getElementById("cfg-pw-input").value = "#123admin%";
		w.document.getElementById("cfg-pw-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
		await new Promise((resolve) => setTimeout(resolve, 250));

		assert.ok(calls.some((call) => call.url === "/api/relay/config"), "the policy is read after unlock");
		assert.ok(calls.some((call) => call.url === "/api/relay/status"), "the pool status is read after unlock");
		/*
		 * Session 331: no scheme dropdown and no browser-rotation switch exist
		 * any more — the scheme is fixed to round robin on the server.
		 */
		assert.equal(w.document.getElementById("cfg-relay-strategy"), null, "the strategy dropdown is gone");
		assert.equal(w.document.getElementById("cfg-relay-client"), null, "the browser-rotation checkbox is gone");
		assert.match(w.document.getElementById("cfg-relay-scheme").textContent, /Round robin/);
		assert.equal(w.document.getElementById("cfg-relay-weight").value, "2");
		const statusHtml = w.document.getElementById("cfg-relay-status").innerHTML;
		assert.match(statusHtml, /backup\.test/);
		assert.match(statusHtml, /cooling/);
		assert.match(statusHtml, /RELAY_SECRET is not set/, "the default-secret warning is shown");

		/* Save posts the password with the policy. */
		w.document.getElementById("cfg-relay-weight").value = "3";
		w.document.getElementById("cfg-relay-save").click();
		await new Promise((resolve) => setTimeout(resolve, 50));
		const saveCall = calls.find((call) => call.method === "POST" && call.url === "/api/relay/config");
		assert.ok(saveCall, "Save Rotation posts to /api/relay/config");
		const saved = JSON.parse(saveCall.body);
		assert.equal(saved.pw, "#123admin%");
		assert.equal("strategy" in saved, false, "the scheme is not even sent: round robin is fixed");
		assert.equal("clientRotation" in saved, false);
		assert.equal(saved.localWeight, 3);
		assert.equal(saved.timeoutMs, 100000);

		/* Test Endpoints posts the password to the probe route. */
		w.document.getElementById("cfg-relay-test").click();
		await new Promise((resolve) => setTimeout(resolve, 50));
		const testCall = calls.find((call) => call.method === "POST" && call.url === "/api/relay/test");
		assert.ok(testCall, "Test Endpoints Now posts to /api/relay/test");
		assert.equal(JSON.parse(testCall.body).pw, "#123admin%");
	} finally {
		w.close();
	}
});

test("a request that was rotated here runs its inference locally", async () => {
	resetIsolate();
	const env = {
		AI: { run: async () => ({ response: "served-here" }) },
		KV_BINDING: cloudflareOnly(makeKv({
			"config:workers": JSON.stringify(["https://peer.test"]),
			/* Weight 0 would send the call to the peer without preferLocal. */
			"config:relay": JSON.stringify({ strategy: "weighted", localWeight: 0 })
		}))
	};
	/* Control: without preferLocal the weighted policy sends the call away. */
	let peerContacted = 0;
	const away = createRelayRuntime(env, requestFor("/api/image"), {
		selfOrigin: SELF,
		fetchImpl: async () => {
			peerContacted += 1;
			throw new TypeError("peer down");
		}
	});
	await away.ai.run("@cf/meta/llama", { prompt: "x" });
	assert.equal(peerContacted, 1, "the weighted policy would have used the peer");

	/* A rotated request executes here instead. */
	const runtime = createRelayRuntime(env, requestFor("/api/image", { headers: { [RELAY_TICKET_HEADER]: "rotated" } }), {
		selfOrigin: SELF,
		preferLocal: true,
		fetchImpl: async () => {
			throw new Error("the peer must not be contacted for already-rotated work");
		}
	});
	assert.deepEqual(await runtime.ai.run("@cf/meta/llama", { prompt: "x" }), { response: "served-here" });
	assert.equal(runtime.stats().local, 1);
	assert.equal(runtime.stats().relayed, 0);
});

test("a handed-out URL keeps the original query string", async () => {
	const { win, calls } = browserRuntime(
		() => json({ ok: true }),
		(path) => ({
			success: true,
			path,
			url: "https://backup.test" + path,
			local: false,
			endpointId: "worker:https://backup.test",
			ticket: "t",
			expiresAt: Date.now() + 60_000
		})
	);
	await win.fetch("/image/gen?prompt=a%20cat&variant=2", { method: "GET" });
	assert.deepEqual(calls.map((call) => call.url), [
		"https://backup.test/image/gen?prompt=a%20cat&variant=2"
	]);
});

/* ------------------------------------------------------------------ */
/* 11. Server-side rotation hand-out (Session 331)                    */
/* ------------------------------------------------------------------ */

test("GET /api/relay/endpoint hands out the server's round-robin URL for one AI path", async () => {
	resetIsolate();
	const env = {
		RELAY_SECRET: "endpoint-test",
		KV_BINDING: cloudflareOnly(makeKv({ "config:workers": JSON.stringify(["https://backup.test"]) }))
	};
	const options = {
		selfOrigin: SELF,
		identity: async () => ({ username: "bob", email: "bob@example.com", usertype: "paid_user" }),
		guest: () => false
	};
	const ask = () => handleRelayRoutes(
		requestFor(RELAY_ENDPOINT_PATH + "?path=%2Fapi%2Fscript"),
		new URL(SELF + RELAY_ENDPOINT_PATH + "?path=%2Fapi%2Fscript"),
		env,
		options
	);

	/* Ring = this Worker once + the backup three times: four asks cover it. */
	const answers = [];
	for (let index = 0; index < 4; index++) {
		const response = await ask();
		assert.equal(response.status, 200);
		answers.push(await response.json());
	}
	const urls = answers.map((answer) => answer.url);
	assert.equal(urls.filter((url) => url === "/api/script").length, 1, "the UI Worker is one slot in four");
	assert.equal(urls.filter((url) => url === "https://backup.test/api/script").length, 3, "the backup is three");

	const remote = answers.find((answer) => answer.local === false);
	assert.equal(remote.path, "/api/script");
	assert.equal(remote.endpointId, "worker:https://backup.test");
	assert.equal(remote.strategy, "round-robin");
	const ticket = await verifyRelayToken(env, remote.ticket, "client");
	assert.equal(ticket.u, "bob", "the ticket carries the signed-in identity");
	assert.deepEqual(Array.from(ticket.paths), RELAY_AI_PATHS, "and is scoped to the AI paths");

	const local = answers.find((answer) => answer.local === true);
	assert.equal(local.ticket, null, "this Worker's own URL needs no ticket");

	/* Any path outside the AI list is refused, and the route is GET only. */
	const refused = await handleRelayRoutes(
		requestFor(RELAY_ENDPOINT_PATH + "?path=%2Fapi%2Fconfig%2Fworkers"),
		new URL(SELF + RELAY_ENDPOINT_PATH + "?path=%2Fapi%2Fconfig%2Fworkers"),
		env,
		options
	);
	assert.equal(refused.status, 400);
	const posted = await handleRelayRoutes(
		requestFor(RELAY_ENDPOINT_PATH + "?path=%2Fapi%2Fscript", { method: "POST" }),
		new URL(SELF + RELAY_ENDPOINT_PATH + "?path=%2Fapi%2Fscript"),
		env,
		options
	);
	assert.equal(posted.status, 405);

	/* Anonymous callers are answered by the UI Worker: rotation never breaks them. */
	resetIsolate();
	let fellBack = 0;
	for (let index = 0; index < 4; index++) {
		const anonymous = await handleRelayRoutes(
			requestFor(RELAY_ENDPOINT_PATH + "?path=%2Fapi%2Fscript"),
			new URL(SELF + RELAY_ENDPOINT_PATH + "?path=%2Fapi%2Fscript"),
			env,
			{ selfOrigin: SELF, identity: async () => null, guest: () => false }
		);
		const anonymousBody = await anonymous.json();
		assert.equal(anonymousBody.local, true, "an anonymous visitor never leaves this origin");
		assert.equal(anonymousBody.ticket, null);
		if (anonymousBody.reason === "no client ticket") fellBack += 1;
	}
	assert.equal(fellBack, 3, "the three backup slots of the ring fall back to the UI Worker");
});

test("the admin page accepts five backup Worker URLs and the pool keeps all five", async () => {
	resetIsolate();
	const urls = ["https://w1.test", "https://w2.test", "https://w3.test", "https://w4.test", "https://w5.test", "https://w6.test"];
	const env = { KV_BINDING: cloudflareOnly(makeKv()) };
	const saved = await worker.fetch(
		new Request(SELF + "/api/config/workers", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: "#123admin%", urls })
		}),
		env,
		{}
	);
	const savedBody = await saved.json();
	assert.deepEqual(savedBody.urls, urls.slice(0, MAX_RELAY_WORKERS), "five URLs are stored, the sixth is dropped");
	invalidateRelayCache();
	const pool = await resolveRelayPool(env, SELF);
	assert.equal(pool.length, MAX_RELAY_WORKERS + 1, "this Worker + five backups");
	assert.equal(MAX_RELAY_WORKERS, 5);
});

/* ==================================================================
 * 12. The rotation cannot hang (Session 331 follow-up)
 * ================================================================== */

test("a backup that never answers times out, is cooled, and the call still lands on the UI Worker", async () => {
	resetIsolate();
	const env = {
		AI: { run: async () => ({ response: "local-answer" }) },
		RELAY_SECRET: "hang-secret",
		KV_BINDING: cloudflareOnly(makeKv({
			"config:workers": JSON.stringify(["https://slow.test"]),
			/* The shortest timeout the policy accepts, so the test is quick. */
			"config:relay": JSON.stringify({ timeoutMs: 5_000 })
		}))
	};
	const attempted = [];
	/* A backup that accepts the connection and never answers: the only way out
	   is the relay's own deadline firing on the abort signal. */
	const hangingFetch = (url, init) => new Promise((resolve, reject) => {
		attempted.push(url);
		const signal = init && init.signal;
		const fail = () => reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
		if (!signal || typeof signal.addEventListener !== "function") return;
		if (signal.aborted) fail();
		else signal.addEventListener("abort", fail, { once: true });
	});
	const runtime = createRelayRuntime(env, requestFor("/api/script"), {
		fetchImpl: hangingFetch,
		selfOrigin: SELF
	});
	/* Local is cooling first, so the hanging backup is attempted first. */
	noteRelayFailure("local", new Error("429 Too Many Requests"), 30_000);

	const startedAt = Date.now();
	const value = await runtime.ai.run("@cf/meta/llama", { prompt: "x" });
	const elapsed = Date.now() - startedAt;

	assert.deepEqual(value, { response: "local-answer" }, "the UI Worker answered the timed-out call");
	assert.ok(attempted.some((url) => String(url).startsWith("https://slow.test")), "the hanging backup was tried");
	assert.ok(elapsed >= 4_000, "the call really waited for the deadline (" + elapsed + " ms)");
	assert.ok(elapsed < RELAY_CHAIN_MAX_MS, "and the chain budget bounded it (" + elapsed + " ms)");
	assert.ok(runtime.stats().failedOver >= 1, "the timeout counts as a fail-over");

	const health = relayHealthSnapshot();
	const backup = health["worker:https://slow.test"];
	assert.ok(backup, "the hanging member has health state");
	assert.ok(backup.openedUntil > Date.now(), "a timeout opens the circuit on that backup");
	assert.match(String(backup.lastError), /timed out|abort/i, "the recorded error says it timed out");
});

test("a timeout is transient but a cancelled request is not: only the timeout is replayed on another member", async () => {
	resetIsolate();
	const env = {
		AI: { run: async () => ({ response: "local-answer" }) },
		RELAY_SECRET: "cancel-secret",
		KV_BINDING: cloudflareOnly(makeKv({ "config:workers": JSON.stringify(["https://backup.test"]) }))
	};
	const controller = new AbortController();
	const cancelled = new Request(SELF + "/api/script", { signal: controller.signal });
	controller.abort();
	let remoteCalls = 0;
	const runtime = createRelayRuntime(env, cancelled, {
		fetchImpl: async () => {
			remoteCalls += 1;
			throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
		},
		selfOrigin: SELF
	});
	noteRelayFailure("local", new Error("429 Too Many Requests"), 30_000);

	await assert.rejects(() => runtime.ai.run("@cf/meta/llama", { prompt: "x" }), (error) => {
		assert.equal(error.name, "AbortError", "the cancellation surfaces as a cancellation");
		return true;
	});
	assert.equal(remoteCalls, 1, "a cancelled call is never retried on another member");
});

/* ==================================================================
 * 13. Browser failure reports actually cool the member they name
 * ================================================================== */

test("a browser failure report needs a signed ticket and can only cool a backup", async () => {
	resetIsolate();
	const env = {
		RELAY_SECRET: "report-secret",
		KV_BINDING: cloudflareOnly(makeKv({ "config:workers": JSON.stringify(["https://backup.test"]) }))
	};
	const options = {
		selfOrigin: SELF,
		identity: async () => ({ username: "bob", usertype: "paid_user" }),
		guest: () => false
	};
	const ask = (query = "", headers = {}) => handleRelayRoutes(
		requestFor(RELAY_ENDPOINT_PATH + "?path=%2Fapi%2Fscript" + query, { headers }),
		new URL(SELF + RELAY_ENDPOINT_PATH + "?path=%2Fapi%2Fscript" + query),
		env,
		options
	);

	/* The ring is [local, backup x3], so the second ask hands out the backup
	   together with the ticket that authorises its failure report. */
	const first = await (await ask()).json();
	const second = await (await ask()).json();
	assert.equal(first.local, true, "the UI Worker takes the first slot");
	assert.equal(second.local, false, "the backup takes the next one");
	const ticket = second.ticket;
	assert.ok(ticket, "the backup answer carries a ticket");
	assert.ok(await readRelayReportTicket(
		requestFor(RELAY_ENDPOINT_PATH, { headers: { [RELAY_TICKET_HEADER]: ticket } }),
		env
	), "the report ticket verifies even though the endpoint is not an AI path");

	const backupKey = "worker:https://backup.test";
	const cooled = () => (relayHealthSnapshot()[backupKey] || {}).openedUntil || 0;

	/* No ticket: ignored. */
	await ask("&failed=" + encodeURIComponent(backupKey));
	assert.equal(cooled(), 0, "an unauthenticated report cools nothing");

	/* A forged ticket: still ignored. */
	await ask("&failed=" + encodeURIComponent(backupKey), { [RELAY_TICKET_HEADER]: "not.a.ticket" });
	assert.equal(cooled(), 0, "a forged ticket cools nothing");

	/* The real ticket, but naming the UI Worker: ignored. */
	await ask("&failed=local", { [RELAY_TICKET_HEADER]: ticket });
	assert.equal(relayHealthSnapshot().local.openedUntil, 0, "the UI Worker can never be cooled by a report");

	/* The real ticket, naming the backup: cooled, and the next pick avoids it. */
	await ask("&failed=" + encodeURIComponent(backupKey), { [RELAY_TICKET_HEADER]: ticket });
	assert.ok(cooled() > Date.now(), "a signed report opens the circuit on that backup");
	assert.match(
		String(relayHealthSnapshot()[backupKey].lastError),
		/browser reported/i,
		"the reason is recorded"
	);
	for (let index = 0; index < 3; index++) {
		const answer = await (await ask()).json();
		assert.equal(answer.local, true, "a cooling backup is out of the hand-out");
		assert.equal(answer.ticket, null);
	}

	/* A ticket that is scoped to anything beyond the AI paths is refused outright. */
	const widened = await signRelayToken(env, {
		v: 1,
		k: "client",
		exp: Date.now() + 60_000,
		u: "bob",
		paths: ["/api/script", "/api/config/workers"]
	});
	assert.equal(
		await readRelayReportTicket(
			requestFor(RELAY_ENDPOINT_PATH, { headers: { [RELAY_TICKET_HEADER]: widened } }),
			env
		),
		null,
		"a ticket scoped past the AI paths cannot report"
	);
});

test("the UI Worker's share shrinks as backups are added: 1 slot in (1 + 3 x backups)", () => {
	const pool = [
		{ id: "local", url: SELF, local: true, label: "This Worker" },
		{ id: "worker:https://w1.test", url: "https://w1.test", local: false, label: "w1.test" },
		{ id: "worker:https://w2.test", url: "https://w2.test", local: false, label: "w2.test" },
		{ id: "worker:https://w3.test", url: "https://w3.test", local: false, label: "w3.test" },
		{ id: "worker:https://w4.test", url: "https://w4.test", local: false, label: "w4.test" },
		{ id: "worker:https://w5.test", url: "https://w5.test", local: false, label: "w5.test" }
	];

	/* Five backups: ring = 1 local slot + 5 x 3 backup slots = 16. */
	resetIsolate();
	const counts = {};
	for (let index = 0; index < 160; index++) {
		const picked = pickRelayEndpoint(pool, config(), Date.now());
		counts[picked.id] = (counts[picked.id] || 0) + 1;
	}
	assert.equal(counts.local, 10, "the UI Worker answers 10 of 160 calls (1 in 16)");
	for (const entry of pool.slice(1)) {
		assert.equal(counts[entry.id], 30, entry.label + " answers 30 of 160 (3 in 16)");
	}
	assert.equal(
		pool.slice(1).reduce((sum, entry) => sum + counts[entry.id], 0),
		150,
		"the backups carry the rest"
	);

	/* localWeight 0: the browser hand-out never picks the UI Worker while a
	   backup is healthy... */
	resetIsolate();
	const zeroLocal = [];
	for (let index = 0; index < 16; index++) {
		zeroLocal.push(pickRelayEndpoint(pool, config({ localWeight: 0 }), Date.now()).id);
	}
	assert.equal(zeroLocal.filter((id) => id === "local").length, 0, "weight 0 keeps the UI Worker out of the hand-out");
	assert.equal(new Set(zeroLocal).size, 5, "all five backups still take their turn");

	/* ...but a pool whose backups all cooled still falls back to it. */
	resetIsolate();
	for (const entry of pool.slice(1)) noteRelayFailure(entry.id, new Error("503"), 30_000);
	const fallback = pickRelayEndpoint(pool, config({ localWeight: 0 }), Date.now());
	assert.equal(fallback.id, "local", "a fully cooled pool still answers, on the UI Worker");
});
