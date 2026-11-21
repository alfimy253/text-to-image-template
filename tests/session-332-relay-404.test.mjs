/*
 * Session 332 — "SEO plan failed: SEO planner model failed
 * (@cf/meta/llama-3.3-70b-instruct-fp8-fast: Relay endpoint answered 404)".
 *
 * Root cause (see `bug-fix-session-332.md`): a relayed member's HTTP answer was
 * classified with `classifyImageFailure()`, whose FATAL_PATTERNS match
 * `/\b404\b/`. A backup that does not serve `POST /api/relay/ai` (an older
 * deployment, a typo, a paused Worker, a different app) therefore looked like a
 * FATAL MODEL error: the fail-over chain aborted on that member, the local
 * Worker never ran the inference, the member was never circuit-broken, and the
 * studio showed the transport text as if the 70B model had rejected the prompt.
 *
 * This suite pins the corrected contract:
 *
 *   1. `RelayError` (the member's envelope/HTTP answer) is ALWAYS transient:
 *      the call fails over, finally to local, and the member is cooled.
 *   2. `ModelError` (the endpoint's own `kind:"model"` answer) stays fatal.
 *   3. A 404 that can only mean "no relay route here" names the member URL.
 *   4. The planner reports EVERY candidate model's transport failure instead of
 *      only the last slug.
 *   5. The browser rotation treats 404/405/501 from a handed-out backup like
 *      502/503/504: it asks the server once more and calls the new URL.
 */

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
	RELAY_AI_PATH,
	RELAY_RESULT_HEADER,
	createRelayRuntime,
	invalidateRelayCache,
	noteRelayFailure,
	relayHealthSnapshot,
	resetRelayHealth
} from "../src/modules/api-relay.ts";
import { planOneSeoKeywordSet } from "../src/modules/script-seo.ts";
import { API_ROTATION_JS } from "../src/client/api-rotation.ts";

const SELF = "https://primary.test";
const BACKUP = "https://old-backup.test";

function makeKv(seed = {}) {
	const store = new Map(Object.entries(seed));
	/* Pool tests are about the Worker pool, not the provider rotation. */
	store.set("config:llm", JSON.stringify({ provider: "cloudflare" }));
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

function envWith(localRun, workers = [BACKUP]) {
	return {
		AI: { run: localRun },
		KV_BINDING: makeKv({ "config:workers": JSON.stringify(workers) }),
		RELAY_SECRET: "session-332-secret"
	};
}

function resetIsolate() {
	invalidateRelayCache();
	resetRelayHealth();
}

/** Forces the backup to be the first candidate (local is cooling). */
function coolLocal() {
	noteRelayFailure("local", new Error("429 Too Many Requests"), 30_000);
}

/* ------------------------------------------------------------------ */
/* 1. A 404 from a backup is a pool problem, not a model problem       */
/* ------------------------------------------------------------------ */

test("a backup that answers 404 without a JSON body fails over to the local Worker", async () => {
	resetIsolate();
	const local = { calls: 0 };
	const runtime = createRelayRuntime(
		envWith(async () => {
			local.calls += 1;
			return { response: "local-answer" };
		}),
		new Request(SELF + "/api/seo-plan", { method: "POST" }),
		{
			selfOrigin: SELF,
			/* Exactly what an old deployment / a wrong URL answers: a plain 404. */
			fetchImpl: async () => new Response("<html><body>404 Not Found</body></html>", { status: 404 })
		}
	);
	coolLocal();

	const result = await runtime.ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { prompt: "plan" });

	assert.deepEqual(result, { response: "local-answer" }, "the model ran on the UI Worker");
	assert.equal(local.calls, 1, "the local AI binding answered the call");
	assert.ok(runtime.stats().failedOver >= 1, "the 404 counted as a fail-over");

	const health = relayHealthSnapshot()["worker:" + BACKUP];
	assert.ok(health, "the member has health state");
	assert.ok(health.failures >= 1, "the 404 is recorded as a member failure");
	assert.ok(health.openedUntil > Date.now(), "the member is circuit-broken, not retried forever");
	assert.match(String(health.lastError), /\b404\b/);
	assert.match(String(health.lastError), /does not serve \/api\/relay\/ai/i, "the recorded error names the missing route");
});

test("an empty-bodied 404 fails over too (no JSON error field to soften it)", async () => {
	resetIsolate();
	const runtime = createRelayRuntime(
		envWith(async () => ({ response: "local-answer" })),
		new Request(SELF + "/api/script", { method: "POST" }),
		{ selfOrigin: SELF, fetchImpl: async () => new Response("", { status: 404 }) }
	);
	coolLocal();

	const result = await runtime.ai.run("@cf/meta/llama-3.1-8b-instruct-fp8", { prompt: "write" });
	assert.deepEqual(result, { response: "local-answer" });
});

test("a 401/405/410 from a member is transient as well, but a model rejection is not", async () => {
	resetIsolate();
	const runtime = createRelayRuntime(
		envWith(async () => ({ response: "local-answer" })),
		new Request(SELF + "/api/script", { method: "POST" }),
		{
			selfOrigin: SELF,
			fetchImpl: async () => json({ success: false, error: "Invalid or expired relay token" }, 401)
		}
	);
	coolLocal();
	assert.deepEqual(await runtime.ai.run("@cf/meta/llama", { prompt: "x" }), { response: "local-answer" });

	resetIsolate();
	const strict = createRelayRuntime(
		envWith(async () => ({ response: "must not run" })),
		new Request(SELF + "/api/script", { method: "POST" }),
		{
			selfOrigin: SELF,
			/* The endpoint executed the model and the model rejected the prompt. */
			fetchImpl: async () =>
				json({ success: false, ok: false, error: "invalid prompt", kind: "model" }, 502, {
					"x-yvs-relay-error-kind": "model"
				})
		}
	);
	coolLocal();
	await assert.rejects(
		() => strict.ai.run("@cf/meta/llama", { prompt: "x" }),
		/invalid prompt/,
		"a kind:\"model\" answer stays authoritative and stops the chain"
	);
});

/* ------------------------------------------------------------------ */
/* 2. The planner names every candidate model that failed              */
/* ------------------------------------------------------------------ */

test("planOneSeoKeywordSet reports every model that failed, not just the last slug", async () => {
	const models = [];
	const env = {
		AI: {
			run: async (model) => {
				models.push(model);
				throw new Error("Relay endpoint answered 404 (" + BACKUP + " does not serve /api/relay/ai)");
			}
		}
	};

	await assert.rejects(
		() => planOneSeoKeywordSet(env, "primary-model", "Morning yoga", null, ["fallback-model"]),
		(err) => {
			assert.match(err.message, /SEO planner model failed/);
			assert.match(err.message, /primary-model/);
			assert.match(err.message, /fallback-model/);
			assert.match(err.message, /404/);
			return true;
		}
	);
	/* Two transport attempts per model (`SEO_PLAN_TRANSPORT_ATTEMPTS`), in order. */
	assert.deepEqual(models, ["primary-model", "primary-model", "fallback-model", "fallback-model"]);
});

test("a single failing model still produces the familiar planner failure text", async () => {
	const env = {
		AI: {
			run: async () => {
				throw new Error("Relay endpoint answered 404");
			}
		}
	};
	await assert.rejects(
		() => planOneSeoKeywordSet(env, "only-model", "Morning yoga", null, []),
		/planner model failed \(only-model: Relay endpoint answered 404\) - try again/
	);
});

/* ------------------------------------------------------------------ */
/* 3. Browser rotation: a 404 from the handed-out backup is recovered  */
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
				asks.push({ url, path, failed, init });
				const body = typeof answer === "function" ? answer(path, failed) : answer;
				return json(body || { success: false });
			}
			calls.push({ url, init });
			return handler(url, init);
		}
	};
	win.fetch = win.fetch.bind(win);
	const context = vm.createContext({
		window: win,
		URL,
		Headers,
		AbortController,
		console,
		setTimeout,
		clearTimeout,
		Promise,
		Blob,
		FormData,
		URLSearchParams
	});
	vm.runInContext(API_ROTATION_JS, context);
	return { win, calls, asks };
}

test("a 404 from a handed-out backup makes the studio ask again, then call this Worker", async () => {
	const { win, calls, asks } = browserRuntime(
		(url) => (url.indexOf(BACKUP) === 0 ? json({ error: "not found" }, 404) : json({ ok: true })),
		(path, failed) =>
			failed
				? { success: true, path, url: path, local: true, endpointId: "local" }
				: {
						success: true,
						path,
						url: BACKUP + path,
						local: false,
						endpointId: "worker:" + BACKUP,
						ticket: "t",
						expiresAt: Date.now() + 60_000
					}
	);

	const response = await win.fetch("/api/seo-plan", { method: "POST", body: "{}" });

	assert.equal(response.status, 200);
	assert.equal(asks.length, 2, "the studio reports the failure and asks for the next URL");
	assert.equal(asks[1].failed, "worker:" + BACKUP);
	assert.ok(calls.some((call) => call.url === "/api/seo-plan"), "the UI Worker ran the retry");
	assert.equal(win.__yvsApiRotation.stats().failovers, 1);
});

test("the relay result header is still how a healthy relayed answer is recognised", async () => {
	resetIsolate();
	const runtime = createRelayRuntime(
		envWith(async () => ({ response: "must not run" })),
		new Request(SELF + "/api/script", { method: "POST" }),
		{
			selfOrigin: SELF,
			fetchImpl: async () =>
				json({ ok: true, result: { response: "relayed-answer" } }, 200, { [RELAY_RESULT_HEADER]: "json" })
		}
	);
	coolLocal();
	const result = await runtime.ai.run("@cf/meta/llama", { prompt: "x" });
	assert.deepEqual(result, { response: "relayed-answer" });
	assert.equal(RELAY_AI_PATH, "/api/relay/ai");
});
