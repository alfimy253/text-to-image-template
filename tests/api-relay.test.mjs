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
	RELAY_AI_PATH,
	RELAY_AI_PATHS,
	RELAY_DEFAULT_CONFIG,
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
	probeRelayEndpoint,
	readRelayConfig,
	relayPreflightResponse,
	relayTicketIdentity,
	resetRelayHealth,
	resolveRelayPool,
	signRelayToken,
	verifyRelayToken,
	withRelayedAi,
	writeRelayConfig
} from "../src/modules/api-relay.ts";
import { JSDOM } from "jsdom";

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

test("round-robin rotates the starting member, least-pending prefers idle members", () => {
	resetIsolate();
	const pool = [
		{ id: "local", url: SELF, local: true, label: "local" },
		{ id: "a", url: "https://a.test", local: false, label: "a" },
		{ id: "b", url: "https://b.test", local: false, label: "b" }
	];
	const rotation = config({ strategy: "round-robin" });
	const seen = new Set();
	for (let i = 0; i < 6; i++) {
		seen.add(orderRelayCandidates(pool, rotation)[0].id);
	}
	assert.deepEqual(Array.from(seen).sort(), ["a", "b", "local"]);

	noteRelaySuccess("local", 2_000);
	noteRelaySuccess("a", 10);
	noteRelaySuccess("b", 900);
	noteRelaySuccess("b", 900);
	const least = orderRelayCandidates(pool, config({ strategy: "least-pending" }));
	assert.equal(least[0].id, "a", "the member with the lowest moving latency goes first");

	/* A weighted candidate list still contains every member exactly once. */
	const weighted = orderRelayCandidates(pool, config({ strategy: "weighted", localWeight: 3 }));
	assert.deepEqual(weighted.map((entry) => entry.id).sort(), ["a", "b", "local"]);
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
		KV_BINDING: makeKv({ "config:workers": JSON.stringify(["https://backup.test"]) })
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
	const value = await runtime.ai.run("@cf/stabilityai/stable-diffusion-xl-base-1.0", { prompt: "x" });
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
		KV_BINDING: makeKv({
			"config:workers": JSON.stringify(["https://dead.test", "https://alive.test"])
		}),
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
		KV_BINDING: makeKv({ "config:workers": JSON.stringify(["https://dead.test"]) })
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
	const body = JSON.stringify({ model: "@cf/stabilityai/stable-diffusion-xl-base-1.0", input: { prompt: "x" } });
	const token = await signRelayToken(env, { v: 1, k: "ai", exp: Date.now() + 60_000, m: "@cf/stabilityai/stable-diffusion-xl-base-1.0" });
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
	const body = JSON.stringify({ model: "@cf/retired/model", input: {} });
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
			body: JSON.stringify({ pw: "wrong", strategy: "least-pending" })
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
	assert.equal(savedBody.config.strategy, "least-pending");
	assert.equal(savedBody.config.localWeight, 2);
	assert.equal(savedBody.config.clientRotation, false);
	assert.ok(env.KV_BINDING.store.has("config:relay"));

	const readBack = await readRelayConfig(env);
	assert.equal(readBack.strategy, "least-pending");

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

test("the studio can rotate /api/image to a backup with only a ticket (no cookie)", async () => {
	resetIsolate();
	const { env } = imageWorkerEnv();
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
		new Request(SELF + "/api/image", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"CF-Connecting-IP": "203.0.113.9",
				[RELAY_TICKET_HEADER]: ticket
			},
			body: JSON.stringify({ prompt: "a rotated scene", resolution: 1024, orientation: "landscape" })
		}),
		env,
		{}
	);
	assert.equal(response.status, 200, await response.clone().text());
	assert.equal(response.headers.get("Content-Type"), "image/png");
	assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from(PNG));
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

function browserRuntime(handler, poolBody) {
	const calls = [];
	const poolCalls = [];
	const responses = { pool: poolBody };
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
			if (url === "/api/relay/pool") {
				poolCalls.push({ url, init });
				return json(responses.pool);
			}
			calls.push({ url, init });
			return handler(url, init);
		}
	};
	win.fetch = win.fetch.bind(win);
	const context = vm.createContext({ window: win, URL, Headers, AbortController, console, setTimeout, clearTimeout, Promise });
	vm.runInContext(API_ROTATION_JS, context);
	return { win, calls, poolCalls };
}

test("the browser rotates an AI path to a verified backup with the ticket header", async () => {
	const ticket = "ticket-value";
	const { win, calls } = browserRuntime(
		(url) => json({ ok: true, servedBy: url }),
		{
			success: true,
			enabled: true,
			clientRotation: true,
			endpoints: [
				{ id: "local", url: "", local: true, verified: true },
				{ id: "w1", url: "https://backup.test", local: false, verified: true }
			],
			ticket,
			expiresAt: Date.now() + 60_000
		}
	);
	await win.__yvsApiRotation.refresh();

	const seen = [];
	for (let i = 0; i < 4; i++) {
		await win.fetch("/api/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
	}
	const targets = calls.map((call) => call.url);
	assert.ok(targets.includes("/api/image"), "some requests stay on this Worker");
	assert.ok(targets.includes("https://backup.test/api/image"), "some requests rotate to the backup");
	const remote = calls.find((call) => call.url.startsWith("https://backup.test"));
	assert.equal(remote.init.headers[RELAY_TICKET_HEADER], ticket);
	assert.equal(remote.init.credentials, "omit");
	const local = calls.find((call) => call.url === "/api/image");
	assert.equal(local.init.credentials, undefined, "local requests keep their cookies");
	assert.equal(win.__yvsApiRotation.stats().rotated, 2);
});

test("a failing backup falls back to the local Worker inside the wrapped fetch", async () => {
	const { win, calls } = browserRuntime(
		(url) => {
			if (url.startsWith("https://backup.test")) return json({ error: "no" }, 503);
			return json({ ok: true });
		},
		{
			success: true,
			enabled: true,
			clientRotation: true,
			endpoints: [
				{ id: "w1", url: "https://backup.test", local: false, verified: true }
			],
			ticket: "t",
			expiresAt: Date.now() + 60_000
		}
	);
	await win.__yvsApiRotation.refresh();
	/* Round-robin starts at local, so the second request is the backup's turn. */
	const first = await win.fetch("/api/voiceover", { method: "POST", body: "{}" });
	assert.equal(first.status, 200);
	const second = await win.fetch("/api/voiceover", { method: "POST", body: "{}" });
	assert.equal(second.status, 200);
	assert.ok(calls.some((call) => call.url.startsWith("https://backup.test")), "the backup was tried");
	assert.ok(calls.some((call) => call.url === "/api/voiceover"), "the local Worker answered");
	assert.equal(win.__yvsApiRotation.stats().failovers, 1);
});

test("non-AI paths and pool routes are never rewritten", async () => {
	const { win, calls } = browserRuntime(
		() => json({ ok: true }),
		{
			success: true,
			enabled: true,
			clientRotation: true,
			endpoints: [{ id: "w1", url: "https://backup.test", local: false, verified: true }],
			ticket: "t",
			expiresAt: Date.now() + 60_000
		}
	);
	await win.__yvsApiRotation.refresh();
	const before = calls.length;
	await win.fetch("/api/config/workers");
	await win.fetch("/api/payments/my");
	await win.fetch("/account");
	assert.deepEqual(
		calls.slice(before).map((call) => call.url),
		["/api/config/workers", "/api/payments/my", "/account"]
	);
});

test("without a ticket the browser never leaves the primary origin", async () => {
	const { win, calls } = browserRuntime(
		() => json({ ok: true }),
		{
			success: true,
			enabled: true,
			clientRotation: false,
			endpoints: [{ id: "w1", url: "https://backup.test", local: false, verified: true }],
			ticket: null,
			expiresAt: 0
		}
	);
	await win.__yvsApiRotation.refresh();
	await win.fetch("/api/image", { method: "POST", body: "{}" });
	assert.deepEqual(calls.map((call) => call.url), ["/api/image"]);
});

/* ------------------------------------------------------------------ */
/* 10. Two real Worker deployments talking to each other              */
/* ------------------------------------------------------------------ */

test("worker A relays a real /api/image model call to worker B and returns B's bytes", async () => {
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
				return PNG;
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
			new Request(SELF + "/api/image", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"CF-Connecting-IP": "203.0.113.20",
					[RELAY_TICKET_HEADER]: ticket
				},
				body: JSON.stringify({ prompt: "a relayed scene", resolution: 1024, orientation: "landscape" })
			}),
			envA,
			{}
		);
		assert.equal(response.status, 200, await response.clone().text());
		assert.deepEqual(Array.from(new Uint8Array(await response.arrayBuffer())), Array.from(PNG));
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
		KV_BINDING: makeKv({
			"config:workers": JSON.stringify(["https://backup.test"])
		})
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
					strategy: "least-pending",
					localWeight: 2,
					clientRotation: true,
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
		assert.equal(w.document.getElementById("cfg-relay-strategy").value, "least-pending");
		assert.equal(w.document.getElementById("cfg-relay-weight").value, "2");
		const statusHtml = w.document.getElementById("cfg-relay-status").innerHTML;
		assert.match(statusHtml, /backup\.test/);
		assert.match(statusHtml, /cooling/);
		assert.match(statusHtml, /RELAY_SECRET is not set/, "the default-secret warning is shown");

		/* Save posts the password with the policy. */
		w.document.getElementById("cfg-relay-strategy").value = "weighted";
		w.document.getElementById("cfg-relay-weight").value = "3";
		w.document.getElementById("cfg-relay-save").click();
		await new Promise((resolve) => setTimeout(resolve, 50));
		const saveCall = calls.find((call) => call.method === "POST" && call.url === "/api/relay/config");
		assert.ok(saveCall, "Save Rotation posts to /api/relay/config");
		const saved = JSON.parse(saveCall.body);
		assert.equal(saved.pw, "#123admin%");
		assert.equal(saved.strategy, "weighted");
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
		KV_BINDING: makeKv({
			"config:workers": JSON.stringify(["https://peer.test"]),
			/* Weight 0 would send the call to the peer without preferLocal. */
			"config:relay": JSON.stringify({ strategy: "weighted", localWeight: 0 })
		})
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

test("a rotated GET keeps its query string", async () => {
	const { win, calls } = browserRuntime(
		() => json({ ok: true }),
		{
			success: true,
			enabled: true,
			clientRotation: true,
			endpoints: [{ id: "w1", url: "https://backup.test", local: false, verified: true }],
			ticket: "t",
			expiresAt: Date.now() + 60_000
		}
	);
	await win.__yvsApiRotation.refresh();
	/* First request goes local, second rotates: both must keep the query. */
	await win.fetch("/image/gen?prompt=a%20cat&variant=2", { method: "GET" });
	await win.fetch("/image/gen?prompt=a%20cat&variant=2", { method: "GET" });
	assert.deepEqual(calls.map((call) => call.url).sort(), [
		"/image/gen?prompt=a%20cat&variant=2",
		"https://backup.test/image/gen?prompt=a%20cat&variant=2"
	]);
});
