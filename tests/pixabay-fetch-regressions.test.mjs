import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { searchPixabay, reservePixabayBudget } from "../src/modules/pixabay.ts";

globalThis.crypto ||= webcrypto;

function photo(id) {
	return {
		id,
		pageURL: `https://pixabay.com/photos/id-${id}/`,
		user: "Artist",
		tags: "gardening",
		largeImageURL: `https://cdn.pixabay.com/photo/${id}.png`,
		previewURL: `https://cdn.pixabay.com/photo/${id}_150.png`,
		imageWidth: 1280,
		imageHeight: 720
	};
}

test("an empty provider answer is not cached for 24 hours, so the next retry can recover", async (t) => {
	const native = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		assert.ok(url.pathname.startsWith("/api/"));
		calls += 1;
		return calls === 1
			? Response.json({ totalHits: 0, hits: [] })
			: Response.json({ totalHits: 1, hits: [photo(101)] });
	};
	t.after(() => { globalThis.fetch = native; });

	const env = { PIXABAY_API_KEY: "empty-cache-fixture-" + Date.now() };
	const first = await searchPixabay(env, { q: "recovering keyword" });
	assert.equal(first.hits.length, 0);
	const second = await searchPixabay(env, { q: "recovering keyword" });
	assert.equal(second.hits.length, 1, "the second attempt reaches the provider again");
	assert.equal(calls, 2);
});

test("the shared provider budget helper is a no-op without a Durable Object binding", async () => {
	assert.deepEqual(await reservePixabayBudget({ PIXABAY_API_KEY: "no-do" }, 3), { ok: true });
	assert.deepEqual(await reservePixabayBudget({}, 3), { ok: true });
});

test("the shared provider budget helper surfaces a provider cooldown", async () => {
	const limiter = {
		idFromName: (name) => name,
		get: () => ({ fetch: async () => new Response("Wait", { status: 429, headers: { "Retry-After": "9" } }) })
	};
	const result = await reservePixabayBudget({ PIXABAY_API_KEY: "do-key", PIXABAY_RATE_LIMITER: limiter }, 2);
	assert.equal(result.ok, false);
	assert.equal(result.retryAfter, 9);
});

test("the shared provider budget helper grants a normal reservation", async () => {
	const limiter = {
		idFromName: (name) => name,
		get: () => ({ fetch: async () => new Response("OK", { status: 200 }) })
	};
	assert.deepEqual(await reservePixabayBudget({ PIXABAY_API_KEY: "do-key-ok", PIXABAY_RATE_LIMITER: limiter }, 2), { ok: true });
});

test("a scene token without page/index defaults instead of failing as an invalid selection", async (t) => {
	const { pixabaySceneImage } = await import("../src/modules/pixabay.ts");
	const native = globalThis.fetch;
	const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
	globalThis.fetch = async (input) => {
		const url = new URL(String(input));
		if (url.pathname.startsWith("/api/")) return Response.json({ totalHits: 3, hits: [photo(201), photo(202)] });
		return new Response(png, { headers: { "Content-Type": "image/png" } });
	};
	t.after(() => { globalThis.fetch = native; });
	const scene = await pixabaySceneImage({ PIXABAY_API_KEY: "token-defaults-" + Date.now() }, 'pixabay:{"q":"garden","type":"image"}');
	assert.equal(scene.mime, "image/png");
	assert.equal(scene.source.id, 201, "the first hit fills the missing index");
});
