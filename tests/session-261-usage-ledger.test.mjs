import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import worker from "../src/index.ts";
import { APP_JS } from "../src/client/app-js.ts";
import { createHTML } from "../src/page.ts";
import { BROWSER_USAGE_JS } from "../src/client/usage-ledger.ts";

const tick = () => new Promise((r) => setTimeout(r, 5));
const day = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

function fakeWindow(overrides = {}) {
	const store = new Map(), cookieWrites = [], fetches = [];
	let cookieJar = [];
	const localStorage = {
		get length() { return store.size; },
		key: (i) => Array.from(store.keys())[i] ?? null,
		getItem: (k) => (store.has(k) ? store.get(k) : null),
		setItem: (k, v) => store.set(k, String(v)),
		removeItem: (k) => store.delete(k)
	};
	const win = {
		localStorage, setTimeout, clearTimeout, AbortController, document: {},
		location: { protocol: "https:" },
		fetch: async (url, init) => { fetches.push({ url, init }); throw new Error("no fetch"); },
		...overrides
	};
	Object.defineProperty(win.document, "cookie", {
		get: () => cookieJar.join("; "),
		set: (value) => {
			cookieWrites.push(value);
			cookieJar.length = 0;
			if (/Max-Age=0/.test(value)) return;
			cookieJar.push(value.split(";")[0]);
		}
	});
	const context = vm.createContext({ window: win, URL, console, setTimeout, clearTimeout, AbortController, fetch: win.fetch, Response, JSON });
	vm.runInContext(BROWSER_USAGE_JS + "\nthis.usage = studioUsage;", context);
	return { usage: context.usage, win, store, cookies: cookieJar, cookieWrites, fetches, context };
}

test("#261 usage record counts each kind, ignores unknown kinds and writes a compact cookie", () => {
	const { usage, store, cookies, cookieWrites, fetches } = fakeWindow();
	usage.record("images", "ok", 3);
	usage.record("scripts", "ok", 1);
	usage.record("voiceovers", "ok");
	usage.record("videos", "ok");
	usage.record("videos", "error");
	usage.record("secrets", "ok", 99);
	const snap = usage.snapshot();
	assert.equal(snap.version, 261);
	assert.equal(snap.day, day());
	assert.deepEqual({ ...snap.local }, { images: 3, scripts: 1, voiceovers: 1, videos: 1 });
	assert.equal(snap.persisted, true);
	assert.equal(snap.server, null);
	assert.equal(usage.describe(), "3 images, 1 script, 1 voiceover, 1 MP4");
	const keys = [...store.keys()];
	assert.equal(keys.length, 1);
	assert.match(keys[0], /^yvs-usage-261:tab:/);
	const stored = store.get(keys[0]);
	assert.ok(!/prompt|audio|username|email|cookie/i.test(stored));
	assert.ok(stored.length <= 3500);
	const cookie = cookies.at(-1);
	assert.match(cookie, /^yvs_usage_261=v%3D261%3Bd%3D/);
	assert.match(cookieWrites[0], /Max-Age=172800/);
	assert.match(cookieWrites[0], /SameSite=Lax/);
	assert.match(cookieWrites[0], /Secure/);
	assert.ok(!/prompt|audio|email|username/i.test(cookie));
	assert.equal(fetches.length, 0, "recording never calls the network");
});

test("#261 usage record caps stored events, merges same-day tabs and prunes stale keys", () => {
	const { usage, store } = fakeWindow();
	for (let i = 0; i < 45; i++) usage.record("images", "ok", 1);
	const ownKey = [...store.keys()].find((k) => k.startsWith("yvs-usage-261:tab:"));
	assert.equal(JSON.parse(store.get(ownKey)).events.length, 40);
	// A second tab appends to its own key; totals merge instead of overwriting.
	store.set("yvs-usage-261:tab:second", JSON.stringify({ v: 261, day: day(), tab: "second",
		counts: { images: 2, scripts: 0, voiceovers: 0, videos: 0 }, events: [] }));
	assert.equal(usage.snapshot().local.images, 47);
	// An old key is neither counted nor kept.
	store.set("yvs-usage-261:tab:old", JSON.stringify({ v: 261, day: "2000-01-01", tab: "old",
		counts: { images: 50, scripts: 0, voiceovers: 0, videos: 0 }, events: [] }));
	usage.record("images", "ok", 1);
	assert.equal(usage.snapshot().local.images, 48);
	assert.equal(store.has("yvs-usage-261:tab:old"), false);
	// Only yesterday's key survives cleanup, and a fresh day starts from zero.
	store.set("yvs-usage-261:tab:yesterday", JSON.stringify({ v: 261,
		day: new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10),
		tab: "yesterday", counts: { images: 9, scripts: 0, voiceovers: 0, videos: 0 }, events: [] }));
	usage.record("scripts", "ok");
	assert.equal(store.has("yvs-usage-261:tab:yesterday"), true);
	store.set(ownKey, JSON.stringify({ v: 261, day: "2000-01-02", tab: "own",
		counts: { images: 99, scripts: 0, voiceovers: 0, videos: 0 }, events: [] }));
	assert.equal(usage.snapshot().local.images, 2, "a stale tab record contributes nothing; the same-day tab still does");
	// Storage disabled: memory-only recording still works and never throws.
	const blocked = fakeWindow({ localStorage: { get length() { throw new Error("blocked"); },
		key() { throw new Error("blocked"); }, getItem() { throw new Error("blocked"); },
		setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } } });
	assert.equal(blocked.usage.record("images", "ok", 2).persisted, false);
	assert.equal(blocked.usage.snapshot().local.images, 2);
	assert.equal(blocked.usage.cookieName, "yvs_usage_261");
});

test("#261 usage record mirrors only the server plan/counters and can be cleared", async () => {
	const payload = { success: true, day: day(), plan: { id: "guest", label: "Guest" },
		used: { images: 4, scripts: 2, voiceovers: 1, videos: 0 }, remaining: { images: 6, scripts: null, voiceovers: null, videos: null },
		username: "alice@example.com", email: "alice@example.com", cookie: "yvs_session=secret", prompts: ["a forest"] };
	const h = fakeWindow({ fetch: async (url, init) => {
		h.fetches.push({ url, init });
		return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
	} });
	const synced = await h.usage.sync();
	assert.equal(h.fetches[0].url, "/api/credits");
	assert.equal(h.fetches[0].init.cache, "no-store");
	assert.equal(h.fetches[0].init.credentials, "same-origin");
	assert.equal(synced.plan.id, "guest");
	assert.equal(h.usage.snapshot().server.remaining.images, 6);
	const stored = [...h.store.values()].join(" ");
	assert.ok(!/alice|yvs_session|a forest|example\.com/.test(stored), "no identity, cookie or content is stored locally");
	assert.ok(!/alice|yvs_session|a forest/.test(h.cookies.join(" ")));
	h.usage.record("images", "ok", 1);
	h.usage.clear();
	assert.equal(h.usage.snapshot().local.images, 0);
	assert.equal(h.usage.snapshot().server, null);
	assert.equal([...h.store.keys()].filter((k) => k.startsWith("yvs-usage-261")).length, 0);
	assert.match(h.cookieWrites.at(-1), /^yvs_usage_261=; Max-Age=0/);
	// A failing /api/credits request must not break local recording.
	const offline = fakeWindow({ fetch: async () => { throw new Error("offline"); } });
	assert.equal(await offline.usage.sync(), null);
	assert.equal(offline.usage.record("scripts", "ok").local.scripts, 1);
});

test("#261 capability negotiation still offers binary/chunk routes without any durable object", async () => {
	const entry = worker.fetch ? worker : worker.default;
	const response = await entry.fetch(new Request("https://studio.test/api/pipeline-capabilities"), {}, {});
	const caps = await response.json();
	assert.equal(caps.version, 261);
	assert.equal(caps.binaryImages, true);
	assert.equal(caps.chunkVoiceover, true);
	assert.equal(caps.singleAttemptScript, true);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("#261 editor records generated media locally and shows a clearable notice", async (t) => {
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	const w = dom.window; t.after(() => w.close());
	w.__PLAN_MODE = "freemium"; w.alert = () => {}; w.confirm = () => true; w.scrollTo = () => {};
	w.URL.createObjectURL = () => "blob:test/local"; w.URL.revokeObjectURL = () => {};
	w.fetch = async () => new Response(JSON.stringify({ success: true, remaining: {} }), { headers: { "Content-Type": "application/json" } });
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]")); await tick();
	w.eval(`applyCredits({ plan: { id: "guest", label: "Guest", limits: { images: 10 } }, remaining: { images: 6 } });
		recordStudioUsage("images", "ok", 3); recordStudioUsage("scripts", "ok");
		const popover = document.getElementById("credit-popover");
		popover.hidden = false; renderCreditPopover();`);
	assert.match(w.document.getElementById("credit-popover").textContent, /This device today: 3 images, 1 script/);
	assert.match(w.document.getElementById("credit-popover").textContent, /server credits are authoritative/i);
	const pillText = w.document.getElementById("credit-pill-btn").textContent;
	const stored = new Map();
	for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); stored.set(k, w.localStorage.getItem(k)); }
	const tabKey = [...stored.keys()].find((k) => k.startsWith("yvs-usage-261:tab:"));
	assert.ok(tabKey);
	assert.ok(!/A forest|request body|prompt/i.test(stored.get(tabKey)));
	const clear = w.document.querySelector(".credit-local-clear");
	assert.ok(clear);
	clear.click();
	assert.match(w.document.getElementById("credit-popover").textContent, /no local usage recorded yet/i);
	assert.equal(w.__STUDIO_USAGE.snapshot().local.images, 0);
	assert.equal(w.document.getElementById("credit-pill-btn").textContent, pillText, "clearing the local record does not touch server credits");
});
