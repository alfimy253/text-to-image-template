import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { PIXABAY_DIRECT_JS } from "../src/client/pixabay-direct.ts";
import { BROWSER_OFFLOAD_JS } from "../src/client/browser-offload.ts";

globalThis.crypto ||= webcrypto;

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const mp4 = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

function photo(id) {
	return {
		id,
		pageURL: `https://pixabay.com/photos/id-${id}/`,
		user: "Artist",
		tags: "garden flowers",
		largeImageURL: `https://cdn.pixabay.com/photo/${id}.png`,
		previewURL: `https://cdn.pixabay.com/photo/${id}_150.png`,
		imageWidth: 1280,
		imageHeight: 720
	};
}
function video(id) {
	return {
		id,
		pageURL: `https://pixabay.com/videos/id-${id}/`,
		user: "Artist",
		duration: 12,
		videos: { small: { url: `https://cdn.pixabay.com/video/${id}.mp4`, thumbnail: `https://cdn.pixabay.com/video/${id}.jpg`, width: 1280, height: 720, size: 1024 } }
	};
}
const configBody = (overrides = {}) => ({
	success: true,
	direct: true,
	apiOrigin: "https://pixabay.com",
	assetHosts: ["cdn.pixabay.com"],
	key: "browser-key",
	perPage: 3,
	imageResults: 2,
	videoResults: 3,
	maxImageBytes: 8 * 1024 * 1024,
	maxVideoBytes: 16 * 1024 * 1024,
	claimPath: "/api/media/claim",
	settlePath: "/api/media/settle",
	...overrides
});

function directRuntime(handler, overrides = {}) {
	const win = {
		navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
		document: { hidden: false },
		setTimeout,
		clearTimeout,
		Blob,
		URL,
		AbortController,
		Response,
		fetch: handler,
		console: { info() {}, warn() {}, error() {} },
		...overrides
	};
	const context = vm.createContext({
		window: win, URL, console, setTimeout, clearTimeout,
		Blob, AbortController, Response, Uint8Array
	});
	vm.runInContext(PIXABAY_DIRECT_JS + "\nthis.runtime = studioPixabayDirect;", context);
	return { runtime: context.runtime, win, context };
}

function routedFetch(calls, options = {}) {
	return async (input, init = {}) => {
		const url = new URL(typeof input === "string" ? input : input.url, "https://studio.test");
		const entry = { url, init, body: init.body ? JSON.parse(init.body) : null };
		calls.push(entry);
		if (url.pathname === "/api/media/config") return Response.json(configBody(options.config));
		if (url.pathname === "/api/media/claim") {
			if (options.claimStatus) return Response.json({ success: false, error: "Daily stock import allowance exhausted" }, { status: options.claimStatus });
			return Response.json({ success: true, claimId: "claim-1", granted: entry.body.count });
		}
		if (url.pathname === "/api/media/settle") {
			return Response.json({ success: true, settled: true, refunded: Math.max(0, 3 - Number(entry.body.delivered)) });
		}
		if (url.hostname === "pixabay.com" && url.pathname.startsWith("/api/")) {
			if (options.providerStatus) {
				return new Response("{}", { status: options.providerStatus, headers: options.retryAfter ? { "Retry-After": String(options.retryAfter) } : {} });
			}
			const hits = url.searchParams.get("image_type") === null
				? [video(21), video(22), video(23)]
				: [photo(11), photo(12), photo(13)];
			return Response.json({ totalHits: 100, hits });
		}
		if (url.hostname === "cdn.pixabay.com") {
			if (options.assetReject) throw new TypeError("Failed to fetch");
			if (options.assetInvalid) return new Response("not media", { status: 200, headers: { "Content-Type": "image/png" } });
			if (options.assetStatus) return new Response("nope", { status: options.assetStatus });
			return new Response(url.pathname.endsWith(".mp4") ? mp4 : png, {
				headers: { "Content-Type": url.pathname.endsWith(".mp4") ? "video/mp4" : "image/png" }
			});
		}
		return new Response("{}", { status: 404 });
	};
}

test("browser search mirrors the Worker query contract and picks the scene index", async () => {
	const calls = [];
	const { runtime } = directRuntime(routedFetch(calls));
	assert.equal(await runtime.enabled(), true);
	const result = await runtime.search({ q: "garden flowers & sun", type: "image", orientation: "portrait" }, {});
	assert.equal(result.provider, "pixabay");
	assert.equal(result.per_page, 2);
	assert.deepEqual(Array.from(result.hits, (hit) => hit.id), [11, 12]);
	const searchCall = calls.find((entry) => entry.url.pathname === "/api/");
	assert.equal(searchCall.url.origin, "https://pixabay.com");
	assert.equal(searchCall.url.searchParams.get("key"), "browser-key");
	assert.equal(searchCall.url.searchParams.get("q"), "garden flowers & sun");
	assert.equal(searchCall.url.searchParams.get("per_page"), "3");
	assert.equal(searchCall.url.searchParams.get("page"), "1");
	assert.equal(searchCall.url.searchParams.get("safesearch"), "true");
	assert.equal(searchCall.url.searchParams.get("image_type"), "photo");
	assert.equal(searchCall.url.searchParams.get("orientation"), "vertical");
	assert.equal(searchCall.init.credentials, "omit");
});

test("videos send no image-only parameters and expose three clips", async () => {
	const calls = [];
	const { runtime } = directRuntime(routedFetch(calls));
	const result = await runtime.search({ q: "garden", type: "video" }, {});
	assert.equal(result.per_page, 3);
	assert.deepEqual(Array.from(result.hits, (hit) => hit.id), [21, 22, 23]);
	assert.equal(result.hits[0].duration, 12);
	const search = calls.find((entry) => entry.url.pathname === "/api/");
	assert.equal(search.url.searchParams.get("image_type"), null);
	assert.equal(search.url.searchParams.get("orientation"), null);
});

test("a scene token downloads the selected hit in the browser and keeps provenance", async () => {
	const calls = [];
	const { runtime } = directRuntime(routedFetch(calls));
	const scene = await runtime.scene('pixabay:{"q":"garden flowers","type":"image","index":1,"scene":3}', { width: 600, height: 900 }, {});
	assert.equal(scene.transport, "browser");
	assert.equal(scene.blob.type, "image/png");
	assert.equal(scene.blob.size, png.length);
	assert.equal(scene.source.provider, "pixabay");
	assert.equal(scene.source.id, 12, "index 1 selects the second photo");
	assert.equal(scene.source.pageURL, "https://pixabay.com/photos/id-12/");
	const search = calls.find((entry) => entry.url.pathname === "/api/");
	assert.equal(search.url.searchParams.get("orientation"), "vertical");
});

test("a CDN CORS refusal is a fallback error and holds further browser reads", async () => {
	const calls = [];
	const { runtime } = directRuntime(routedFetch(calls, { assetReject: true }));
	await assert.rejects(runtime.scene('pixabay:{"q":"garden","type":"image","index":0,"scene":0}', {}, {}), (error) => {
		assert.equal(error.kind, "cors");
		assert.equal(error.fallback, true);
		return true;
	});
	const snapshot = runtime.debug();
	assert.ok(snapshot.assetCorsBlockedForMs > 0, "the CDN block is remembered so later scenes do not repeat it");
	const before = calls.filter((entry) => entry.url.hostname === "cdn.pixabay.com").length;
	await assert.rejects(runtime.scene('pixabay:{"q":"roses","type":"image","index":0,"scene":1}', {}, {}), (error) => error.kind === "cors");
	assert.equal(calls.filter((entry) => entry.url.hostname === "cdn.pixabay.com").length, before, "no second CDN request while the hold is active");
});

test("invalid media bytes are rejected before they can reach the gallery", async () => {
	const { runtime } = directRuntime(routedFetch([], { assetInvalid: true }));
	await assert.rejects(runtime.scene('pixabay:{"q":"garden","type":"image","index":0,"scene":0}', {}, {}), /Invalid Pixabay media bytes/);
});

test("provider 429 keeps the browser retry hint and is not double-fetched through the Worker", async () => {
	const { runtime } = directRuntime(routedFetch([], { providerStatus: 429, retryAfter: 7 }));
	await assert.rejects(runtime.search({ q: "garden" }, {}), (error) => {
		assert.equal(error.status, 429);
		assert.equal(error.kind, "rate-limit");
		assert.equal(error.retryAfterMs, 7000);
		assert.equal(error.fallback, false);
		return true;
	});
});

test("CORS-blocked search falls back to Pixabay JSONP so the scene list still works", async () => {
	const calls = [];
	const handler = routedFetch(calls);
	const jsonpDocument = {
		head: {
			removeChild(script) { script.parentNode = null; return script; },
			appendChild(script) {
				script.parentNode = this;
				setTimeout(() => {
					const name = /callback=([^&]+)/.exec(script.src)[1];
					const callback = jsonpWindow[name];
					if (callback) callback({ totalHits: 3, hits: [photo(31), photo(32)] });
				}, 0);
				return script;
			}
		},
		createElement() { return { src: "", onerror: null, parentNode: null }; }
	};
	let jsonpWindow;
	const wrapped = async (input, init) => {
		const url = new URL(typeof input === "string" ? input : input.url, "https://studio.test");
		if (url.hostname === "pixabay.com") throw new TypeError("Failed to fetch");
		return handler(input, init);
	};
	const built = directRuntime(wrapped, { document: jsonpDocument });
	jsonpWindow = built.win;
	const result = await built.runtime.search({ q: "garden" }, {});
	assert.deepEqual(Array.from(result.hits, (hit) => hit.id), [31, 32]);
});

test("credit claim and settle carry the browser's accounting to the Worker", async () => {
	const calls = [];
	const { runtime } = directRuntime(routedFetch(calls));
	const claim = await runtime.claim(3, {});
	assert.equal(claim.claimId, "claim-1");
	assert.equal(claim.granted, 3);
	assert.equal(claim.credits, null);
	const settled = await runtime.settle(claim.claimId, 1, {});
	assert.equal(settled.refunded, 2);
	const settleCall = calls.find((entry) => entry.url.pathname === "/api/media/settle");
	assert.equal(settleCall.body.claimId, "claim-1");
	assert.equal(settleCall.body.delivered, 1);
});

test("a denied claim is a credit answer, never a silent bypass", async () => {
	const { runtime } = directRuntime(routedFetch([], { claimStatus: 429 }));
	await assert.rejects(runtime.claim(2, {}), (error) => {
		assert.equal(error.status, 429);
		assert.equal(error.fallback, false);
		return true;
	});
});

test("browser-offload fetches the whole chunk from the browser and never calls /api/image", async () => {
	const calls = [];
	const win = {
		navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
		document: { hidden: false },
		setTimeout, clearTimeout, Blob, URL, AbortController, Response,
		fetch: routedFetch(calls),
		console: { info() {}, warn() {}, error() {} }
	};
	const context = vm.createContext({
		window: win, URL, console, setTimeout, clearTimeout,
		Blob, AbortController, Response, Uint8Array
	});
	vm.runInContext(PIXABAY_DIRECT_JS + "\nthis.direct = studioPixabayDirect;", context);
	vm.runInContext(BROWSER_OFFLOAD_JS + "\nthis.offload = studioOffload;", context);
	const tokens = [0, 1].map((index) => 'pixabay:' + JSON.stringify({ q: "garden", type: "image", index, scene: index }));
	const delivered = [];
	const results = await context.offload.images(tokens, {}, {
		onImage(blob, index) { delivered.push({ index, size: blob.size, source: blob.stockSource && blob.stockSource.id }); }
	});
	assert.equal(results.filter((result) => result.ok).length, 2);
	assert.deepEqual(delivered.map((entry) => entry.index).sort(), [0, 1]);
	assert.equal(delivered[0].source, 11);
	assert.equal(delivered[1].source, 12);
	assert.equal(calls.filter((entry) => entry.url.pathname === "/api/image").length, 0, "media bytes never traverse the Worker");
	assert.equal(calls.filter((entry) => entry.url.hostname === "cdn.pixabay.com").length, 2);
	const settle = calls.find((entry) => entry.url.pathname === "/api/media/settle");
	assert.equal(settle.body.claimId, "claim-1");
	assert.equal(settle.body.delivered, 2);
});

test("a scene the browser cannot read falls back to the Worker and its claimed unit is refunded", async () => {
	const pngResponse = () => new Response(png, { headers: { "Content-Type": "image/png" } });
	const calls = [];
	const handler = routedFetch(calls, { assetReject: true });
	const win = {
		navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
		document: { hidden: false },
		setTimeout, clearTimeout, Blob, URL, AbortController, Response,
		fetch: async (input, init = {}) => {
			const url = new URL(typeof input === "string" ? input : input.url, "https://studio.test");
			if (url.pathname === "/api/image") {
				calls.push({ url, init, body: JSON.parse(init.body) });
				const response = pngResponse();
				response.stockSource = { id: 77 };
				return response;
			}
			return handler(input, init);
		},
		console: { info() {}, warn() {}, error() {} }
	};
	const context = vm.createContext({
		window: win, URL, console, setTimeout, clearTimeout,
		Blob, AbortController, Response, Uint8Array
	});
	vm.runInContext(PIXABAY_DIRECT_JS + "\nthis.direct = studioPixabayDirect;", context);
	vm.runInContext(BROWSER_OFFLOAD_JS + "\nthis.offload = studioOffload;", context);
	const tokens = [0, 1].map((index) => 'pixabay:' + JSON.stringify({ q: "garden", type: "image", index, scene: index }));
	const delivered = [];
	const results = await context.offload.images(tokens, {}, {
		onImage(blob, index) { delivered.push(index); }
	});
	assert.equal(results.filter((result) => result.ok).length, 2);
	assert.equal(calls.filter((entry) => entry.url.pathname === "/api/image").length, 2, "each blocked scene is retried through the Worker");
	assert.deepEqual(delivered.sort(), [0, 1]);
	const settle = calls.find((entry) => entry.url.pathname === "/api/media/settle");
	assert.equal(settle.body.claimId, "claim-1");
	assert.equal(settle.body.delivered, 0, "no browser delivery keeps no unit");
});

test("editor Retry Pixabay search fetches missing scenes in the browser, not through the Worker", async (t) => {
	const { harness } = await import("./studio-render-harness.mjs");
	const { w } = harness();
	t.after(() => w.close());
	const calls = [];
	const handler = routedFetch(calls);
	w.fetch = async (input, init = {}) => {
		const url = new URL(typeof input === "string" ? input : input.url, "https://studio.test");
		if (url.pathname === "/api/credits") return Response.json({ plan: { id: "free", label: "Free", limits: { images: 10000 } }, remaining: { images: 10000 } });
		if (url.pathname === "/api/media/config") {
			return handler("https://studio.test/api/media/config", init);
		}
		if (url.pathname === "/api/media/claim") {
			return handler("https://studio.test/api/media/claim", init);
		}
		if (url.pathname === "/api/media/settle") {
			return handler("https://studio.test/api/media/settle", init);
		}
		if (url.hostname === "pixabay.com" || url.hostname === "cdn.pixabay.com") return handler(url.href, init);
		return new Response("{}", { status: 404 });
	};
	w.addVideoAccordion();
	const project = w.__VIDEO_PROJECTS[0];
	project.script = "Garden flowers bring neighbors together in spring.";
	project._seoTopic = "garden flowers";
	project._seoMinutes = 1;
	project._imageFlowActive = false;
	project.imagePromptFlowId = "direct-retry-flow";
	project.imagePrompts = [0, 1].map((scene) => "pixabay:" + JSON.stringify({ q: "garden flowers", type: "image", index: scene, scene }));
	project.assets = [];

	await w.retryImagePromptFlow(1);

	assert.equal(project.assets.length, 2, "both missing scenes were imported");
	assert.equal(calls.filter((entry) => entry.url.pathname === "/api/media/search").length, 0, "no Worker search route was used");
	assert.equal(calls.filter((entry) => entry.url.pathname === "/api/media/asset").length, 0, "media bytes did not traverse the Worker");
	assert.equal(calls.filter((entry) => entry.url.hostname === "cdn.pixabay.com").length, 2);
	assert.equal(calls.filter((entry) => entry.url.pathname === "/api/media/claim").length, 2);
});
