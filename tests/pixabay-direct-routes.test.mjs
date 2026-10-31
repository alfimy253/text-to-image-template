import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import workerModule from "../src/index.ts";

const worker = workerModule.default || workerModule;
globalThis.crypto ||= webcrypto;

const SESSION = "abcdef1234";
const COOKIE = "yvs_session=" + SESSION;

function memoryKV(seed = {}) {
	const store = new Map(Object.entries(seed));
	return {
		store,
		async get(key) { return store.has(key) ? store.get(key) : null; },
		async put(key, value) { store.set(key, String(value)); },
		async delete(key) { store.delete(key); }
	};
}
function authedKV() {
	return memoryKV({
		["session:" + SESSION]: JSON.stringify({ username: "tester", email: "tester@studio.test" }),
		"user:tester": JSON.stringify({ username: "tester", email: "tester@studio.test", usertype: "free" })
	});
}
function envWith(kv, extra = {}) {
	return { KV_BINDING: kv, PIXABAY_API_KEY: "worker-key", ...extra };
}
function request(path, body, options = {}) {
	const headers = {};
	if (options.cookie !== false) headers.Cookie = COOKIE;
	if (body !== undefined) headers["Content-Type"] = "application/json";
	return new Request("https://studio.test" + path, {
		method: options.method || (body === undefined ? "GET" : "POST"),
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}
const fetchWorker = (path, body, env, options = {}) => worker.fetch(request(path, body, options), env, {});

test("capabilities advertise browser-first media fetching", async () => {
	const response = await fetchWorker("/api/pipeline-capabilities", undefined, {});
	assert.equal(response.status, 200);
	const caps = await response.json();
	assert.equal(caps.version, 261);
	assert.equal(caps.directMedia, 1);
	assert.equal(caps.mediaProvider, "pixabay");
});

test("media config hands the browser the provider key, origins and limits", async () => {
	const response = await fetchWorker("/api/media/config", undefined, envWith(authedKV()));
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	const config = await response.json();
	assert.equal(config.success, true);
	assert.equal(config.direct, true);
	assert.equal(config.key, "worker-key");
	assert.equal(config.apiOrigin, "https://pixabay.com");
	assert.deepEqual(config.assetHosts, ["cdn.pixabay.com"]);
	assert.equal(config.perPage, 3);
	assert.equal(config.imageResults, 2);
	assert.equal(config.videoResults, 3);
	assert.equal(config.claimPath, "/api/media/claim");
	assert.equal(config.settlePath, "/api/media/settle");
});

test("an operator flag disables browser fetching without breaking the fallback routes", async () => {
	const response = await fetchWorker("/api/media/config", undefined, envWith(authedKV(), { PIXABAY_BROWSER_FETCH: "0" }));
	const config = await response.json();
	assert.equal(config.success, false);
	assert.equal(config.direct, false);
	assert.equal(config.key, "", "the key is never handed to a page when the direct path is off");
	assert.match(config.error, /disabled/i);
});

test("media config is not readable without a session or the free-entry cookie", async () => {
	const response = await fetchWorker("/api/media/config", undefined, envWith(authedKV()), { cookie: false });
	assert.equal(response.status, 401);
	const config = await response.json();
	assert.equal(config.success, false);
	assert.equal(config.authenticated, false);
	assert.ok(!JSON.stringify(config).includes("worker-key"));
});

test("a claim reserves browser import units in KV and settle refunds the undelivered rest", async () => {
	const kv = authedKV();
	const env = envWith(kv);
	const claimed = await fetchWorker("/api/media/claim", { count: 3 }, env);
	assert.equal(claimed.status, 200);
	const claim = await claimed.json();
	assert.equal(claim.success, true);
	assert.equal(claim.granted, 3);
	assert.equal(typeof claim.claimId, "string");

	const record = JSON.parse(kv.store.get("media-claim:" + claim.claimId));
	assert.equal(record.subject, "credits:tester");
	assert.equal(record.granted, 3);

	const before = JSON.parse(kv.store.get("credits:tester"));
	assert.equal(before.images, 3);

	const settledResponse = await fetchWorker("/api/media/settle", { claimId: claim.claimId, delivered: 1 }, env);
	assert.equal(settledResponse.status, 200);
	const settled = await settledResponse.json();
	assert.equal(settled.settled, true);
	assert.equal(settled.refunded, 2);
	const after = JSON.parse(kv.store.get("credits:tester"));
	assert.equal(after.images, 1, "only the browser-delivered scene is billed");
	assert.equal(kv.store.has("media-claim:" + claim.claimId), false, "the claim is consumed");

	const replay = await (await fetchWorker("/api/media/settle", { claimId: claim.claimId, delivered: 0 }, env)).json();
	assert.equal(replay.refunded, 0, "a replayed settle never refunds twice");
});

test("a claim that exceeds the remaining allowance is a 429 and reserves nothing", async () => {
	const kv = authedKV();
	const env = envWith(kv);
	const first = await (await fetchWorker("/api/media/claim", { count: 1 }, env)).json();
	assert.equal(first.success, true);
	/* Simulate the daily ceiling being reached. */
	const state = JSON.parse(kv.store.get("credits:tester"));
	state.images = 10000;
	kv.store.set("credits:tester", JSON.stringify(state));

	const denied = await fetchWorker("/api/media/claim", { count: 2 }, env);
	assert.equal(denied.status, 429);
	const body = await denied.json();
	assert.equal(body.success, false);
	assert.match(body.error, /allowance|exhaust|used up/i);
});

test("a claim cannot be settled by a different session", async () => {
	const kv = authedKV();
	kv.store.set("media-claim:foreign", JSON.stringify({ subject: "credits:someone-else", granted: 2, at: Date.now() }));
	const response = await fetchWorker("/api/media/settle", { claimId: "foreign", delivered: 0 }, envWith(kv));
	assert.equal(response.status, 403);
	const body = await response.json();
	assert.equal(body.success, false);
	assert.equal(kv.store.has("media-claim:foreign"), false);
});

test("the explicit local unmetered mode keeps browser fetching usable without KV", async () => {
	const env = { PIXABAY_API_KEY: "worker-key", PIXABAY_ALLOW_UNMETERED: "true" };
	const config = await (await fetchWorker("/api/media/config", undefined, env, { cookie: false })).json();
	assert.equal(config.direct, true);
	assert.equal(config.key, "worker-key");

	const claim = await (await fetchWorker("/api/media/claim", { count: 4 }, env, { cookie: false })).json();
	assert.equal(claim.success, true);
	assert.equal(claim.claimId, "open");
	assert.equal(claim.granted, 4);

	const settled = await (await fetchWorker("/api/media/settle", { claimId: "open", delivered: 1 }, env, { cookie: false })).json();
	assert.equal(settled.success, true);
	assert.equal(settled.refunded, 0);
});

test("the credit claim draws on the shared Pixabay provider budget", async () => {
	const kv = authedKV();
	const limiter = {
		idFromName: (name) => name,
		get: () => ({ fetch: async () => new Response("Wait", { status: 429, headers: { "Retry-After": "12" } }) })
	};
	const env = envWith(kv, { PIXABAY_RATE_LIMITER: limiter });
	const response = await fetchWorker("/api/media/claim", { count: 2 }, env);
	assert.equal(response.status, 429);
	const body = await response.json();
	assert.equal(body.success, false);
	assert.equal(body.kind, "overload");
	assert.equal(body.retryAfterMs, 12000);
	const state = JSON.parse(kv.store.get("credits:tester"));
	assert.equal(state.images, 0, "a refused provider budget refunds the reservation");
});

test("a claim that cannot be deleted is not refunded twice", async () => {
	const kv = authedKV();
	const env = envWith(kv);
	const claim = await (await fetchWorker("/api/media/claim", { count: 2 }, env)).json();
	const stateBefore = JSON.parse(kv.store.get("credits:tester")).images;
	kv.delete = async () => { throw new Error("KV delete failed"); };
	const response = await fetchWorker("/api/media/settle", { claimId: claim.claimId, delivered: 0 }, env);
	assert.equal(response.status, 503);
	const stateAfter = JSON.parse(kv.store.get("credits:tester")).images;
	assert.equal(stateAfter, stateBefore, "no refund happens while the claim is still live");
});
