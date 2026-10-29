/* Public navigation regressions must exercise the HTML as a browser parses it,
 * not just eval(APP_JS): the HTML parser replaces literal NUL characters. */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { CookieJar, JSDOM, requestInterceptor, VirtualConsole } from "jsdom";
import workerModule from "../src/index.ts";

const worker = workerModule.default || workerModule;
const ORIGIN = "https://studio.test";

function makeKv(seed = {}) {
	const store = new Map(Object.entries(seed));
	return {
		store,
		async get(key) { return store.has(key) ? store.get(key) : null; },
		async put(key, value) { store.set(key, value); },
		async delete(key) { store.delete(key); },
		async list({ prefix = "", limit = 1000 } = {}) {
			const keys = [...store.keys()].filter(key => key.startsWith(prefix)).sort();
			return { keys: keys.slice(0, limit).map(name => ({ name })), list_complete: keys.length <= limit };
		}
	};
}

function browserFor(env) {
	const jar = new CookieJar();
	const requests = [];
	const documents = [];

	async function request(input, init = {}) {
		const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
		assert.equal(url.origin, ORIGIN, "browser requests stay on the app origin");
		const headers = new Headers(init.headers);
		const cookie = jar.getCookieStringSync(url.href, { http: true });
		if (cookie) headers.set("Cookie", cookie);
		const response = await worker.fetch(new Request(url, { ...init, headers }), env, {});
		for (const value of response.headers.getSetCookie()) jar.setCookieSync(value, url.href);
		requests.push({ path: url.pathname, method: init.method || "GET", status: response.status });
		return response;
	}

	async function open(path, options = {}) {
		const response = await request(path);
		assert.equal(response.status, 200, path + " should return a page");
		const html = await response.text();
		const errors = [];
		const virtualConsole = new VirtualConsole();
		virtualConsole.on("jsdomError", error => errors.push(error));
		const dom = new JSDOM(html, {
			url: new URL(path, ORIGIN).href,
			cookieJar: jar,
			runScripts: "dangerously",
			pretendToBeVisual: true,
			virtualConsole,
			resources: options.resources,
			beforeParse(window) {
				window.fetch = options.fetch || request;
				window.scrollTo = () => {};
				window.alert = () => {};
				window.confirm = () => true;
				window.URL.createObjectURL = () => "blob:fixture";
				window.URL.revokeObjectURL = () => {};
			}
		});
		documents.push(dom);
		return { window: dom.window, html, errors };
	}

	return { jar, requests, request, open, close() { documents.forEach(dom => dom.window.close()); } };
}

async function waitFor(predicate, description, timeout = 5000) {
	const until = Date.now() + timeout;
	while (Date.now() < until) {
		if (predicate()) return;
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	assert.fail("Timed out waiting for " + description);
}

function assertNoScriptErrors(errors) {
	assert.deepEqual(errors.map(error => error.message), []);
}

function assertParsedScriptsCompile(html, path) {
	assert.equal(html.includes("\0"), false, path + " contains a literal NUL");
	const dom = new JSDOM(html, { url: new URL(path, ORIGIN).href });
	try {
		for (const [index, script] of [...dom.window.document.scripts].entries()) {
			if (script.textContent.trim()) {
				assert.doesNotThrow(() => new vm.Script(script.textContent, { filename: path + ":script-" + index }));
			}
		}
	} finally {
		dom.window.close();
	}
}

test("served landing page supports signup, logout and login through the real account API", async t => {
	const browser = browserFor({ KV_BINDING: makeKv() });
	t.after(() => browser.close());
	const { window: w, html, errors } = await browser.open("/");
	assertParsedScriptsCompile(html, "/");
	await waitFor(() => browser.requests.some(r => r.path === "/api/session"), "initial session check");

	assert.equal(w.document.getElementById("landing-page").hidden, false);
	assert.equal(w.document.getElementById("studio-app").hidden, true);
	assert.equal(w.document.querySelector("[data-auth-open=signup]").getAttribute("href"), "/signup");
	assert.equal(w.document.querySelector("[data-auth-open=login]").getAttribute("href"), "/login");
	// Verify the repaired regex after HTML parsing, including non-ASCII words.
	assert.equal(w.imageScriptWordCount("One café 東京 123 !"), 4);
	assert.equal(w.imageScriptWordCount("one \u0000 two"), 2);
	assert.ok(!browser.requests.some(r => /^\/image\/\d+$/.test(r.path)), "retired demo URLs are not requested at startup");

	w.document.querySelector("[data-auth-open=signup]").click();
	assert.equal(w.document.getElementById("auth-overlay").style.display, "flex");
	assert.equal(w.document.getElementById("auth-email-wrap").style.display, "block");
	w.document.getElementById("auth-email").value = "creator@example.test";
	w.document.getElementById("auth-username").value = "Creator_1";
	w.document.getElementById("auth-password").value = "secret123";
	w.document.getElementById("auth-confirm").value = "different";
	w.document.getElementById("auth-submit").click();
	assert.match(w.document.getElementById("auth-error").textContent, /passwords do not match/i);
	assert.ok(!browser.requests.some(r => r.path === "/api/signup"));

	w.document.getElementById("auth-confirm").value = "secret123";
	w.document.getElementById("auth-submit").click();
	await waitFor(() => w.document.getElementById("auth-footer")?.style.display === "block", "signup");
	assert.equal(w.document.getElementById("studio-app").hidden, false);
	assert.equal(w.document.getElementById("auth-overlay").style.display, "none");
	assert.match(browser.jar.getCookieStringSync(ORIGIN, { http: true }), /yvs_session=/);
	const session = await (await browser.request("/api/session")).json();
	assert.equal(session.authenticated, true);
	assert.equal(session.user.username, "Creator_1");

	const studio = await browser.request("/studio");
	assert.equal(studio.status, 200);
	assertParsedScriptsCompile(await studio.text(), "/studio");
	const paid = await browser.request("/paid");
	assert.equal(paid.status, 302);
	assert.equal(paid.headers.get("Location"), "/studio");
	const account = await browser.request("/account");
	assert.match(await account.text(), /Creator_1/);

	w.document.querySelector(".auth-logout").click();
	await waitFor(() => w.document.getElementById("landing-page").hidden === false, "logout");
	assert.doesNotMatch(browser.jar.getCookieStringSync(ORIGIN, { http: true }), /yvs_session=/);
	w.document.querySelector("[data-auth-open=login]").click();
	assert.equal(w.document.getElementById("auth-email-wrap").style.display, "none");
	w.document.getElementById("auth-password").value = "incorrect";
	w.document.getElementById("auth-submit").click();
	await waitFor(() => /Invalid username or password/.test(w.document.getElementById("auth-error").textContent), "invalid login message");
	w.document.getElementById("auth-password").value = "secret123";
	w.document.getElementById("auth-submit").click();
	await waitFor(() => w.document.getElementById("auth-footer").style.display === "block", "login");
	assert.equal(w.document.getElementById("studio-app").hidden, false);
	assert.equal((await (await browser.request("/api/session")).json()).authenticated, true);
	assertNoScriptErrors(errors);
});

test("slow font and export-library CDNs cannot block landing-page signup", async t => {
	const releases = [];
	const resources = { interceptors: [requestInterceptor(request => {
		if (!request.url.startsWith("https://unpkg.com/") && !request.url.startsWith("https://fonts.googleapis.com/")) return new Response("");
		return new Promise(resolve => { releases.push(() => resolve(new Response(""))); });
	})] };
	const browser = browserFor({ KV_BINDING: makeKv() });
	t.after(() => { releases.forEach(release => release()); browser.close(); });
	const { window: w, errors } = await browser.open("/", { resources });
	await waitFor(() => releases.length === 2, "pending font and MP4 library requests");
	await waitFor(() => w.document.querySelector("[data-auth-open=signup]"), "landing actions");
	w.document.querySelector("[data-auth-open=signup]").click();
	assert.equal(w.document.getElementById("auth-overlay")?.style.display, "flex");
	assertNoScriptErrors(errors);
});

test("account and upgrade auth controls work while optional fonts are still loading", async t => {
	const releases = [];
	const resources = { interceptors: [requestInterceptor(request => {
		if (!request.url.startsWith("https://fonts.googleapis.com/")) return new Response("");
		return new Promise(resolve => { releases.push(() => resolve(new Response(""))); });
	})] };
	const browser = browserFor({ KV_BINDING: makeKv() });
	t.after(() => { releases.forEach(release => release()); browser.close(); });
	for (const path of ["/account?mode=signup", "/upgrade"]) {
		const { window: w, errors } = await browser.open(path, { resources });
		await waitFor(() => w.document.getElementById("ia-tab-signup"), path + " account controls");
		w.document.getElementById("ia-tab-signup").click();
		assert.equal(w.document.getElementById("ia-email-wrap").style.display, "block");
		assertNoScriptErrors(errors);
	}
	await waitFor(() => releases.length === 2, "pending account font requests");
});

test("guest /free opens the studio and authorizes Pixabay search", async t => {
	const nativeFetch = globalThis.fetch;
	globalThis.fetch = async input => {
		const url = new URL(typeof input === "string" ? input : input.url);
		assert.equal(url.origin, "https://pixabay.com");
		return Response.json({ totalHits: 1, hits: [{
			id: 831, pageURL: "https://pixabay.com/photos/831/", user: "Artist", tags: "flowers",
			largeImageURL: "https://cdn.pixabay.com/photo/831.jpg", previewURL: "https://cdn.pixabay.com/photo/831-preview.jpg",
			imageWidth: 1280, imageHeight: 720
		}] });
	};
	t.after(() => { globalThis.fetch = nativeFetch; });

	const browser = browserFor({ KV_BINDING: makeKv(), PIXABAY_API_KEY: "public-flow-fixture" });
	t.after(() => browser.close());
	const coldSearch = await browser.request("/api/media/search?q=flowers&per_page=3");
	assert.equal(coldSearch.status, 401);

	const { window: w, html, errors } = await browser.open("/free");
	assertParsedScriptsCompile(html, "/free");
	await waitFor(() => w.document.getElementById("studio-app").hidden === false, "guest studio");
	assert.equal(w.__PLAN_MODE, "freemium");
	assert.equal(w.document.getElementById("landing-page").hidden, true);
	assert.match(browser.jar.getCookieStringSync(ORIGIN, { http: true }), /yvs_free=1/);
	await waitFor(() => browser.requests.some(r => r.path === "/api/credits" && r.status === 200), "guest credits");
	const credits = await (await browser.request("/api/credits")).json();
	assert.equal(credits.guest, true);
	assert.equal(credits.remaining.images, 10000);

	w.document.getElementById("bulk-toggle").click();
	assert.ok(w.document.getElementById("video-1"), "studio controls are interactive");
	const search = await browser.request("/api/media/search?q=flowers&per_page=3");
	assert.equal(search.status, 200);
	assert.equal((await search.json()).hits[0].id, 831);
	assertNoScriptErrors(errors);
});

test("/free still opens directly when the session API returns 503 without KV", async t => {
	const browser = browserFor({});
	t.after(() => browser.close());
	const { window: w, errors } = await browser.open("/free");
	await waitFor(() => w.document.getElementById("studio-app").hidden === false, "open-access guest studio");
	await waitFor(() => browser.requests.some(r => r.path === "/api/session" && r.status === 503), "unavailable account storage");
	assert.equal(w.document.getElementById("landing-page").hidden, true);
	assertNoScriptErrors(errors);
});

test("/free opens immediately even if the session check never responds", async t => {
	const browser = browserFor({ KV_BINDING: makeKv() });
	t.after(() => browser.close());
	let sessionRequested = false;
	const fetch = (input, init) => {
		if (new URL(typeof input === "string" ? input : input.url, ORIGIN).pathname === "/api/session") {
			sessionRequested = true;
			return new Promise(() => {});
		}
		return browser.request(input, init);
	};
	const { window: w, errors } = await browser.open("/free", { fetch });
	assert.equal(sessionRequested, true);
	assert.equal(w.document.getElementById("studio-app").hidden, false);
	assert.equal(w.document.getElementById("landing-page").hidden, true);
	w.document.getElementById("bulk-toggle").click();
	assert.ok(w.document.getElementById("video-1"));
	assertNoScriptErrors(errors);
});

test("starting an export without the deferred MP4 library fails clearly", async t => {
	const browser = browserFor({ KV_BINDING: makeKv() });
	t.after(() => browser.close());
	const { window: w, errors } = await browser.open("/free");
	await waitFor(() => w.document.getElementById("studio-app").hidden === false, "guest studio");
	const alerts = [];
	w.alert = message => alerts.push(message);
	w.VideoEncoder = class {};
	w.Image.prototype.decode = async () => {};
	w.addVideoAccordion();
	const project = w.__VIDEO_PROJECTS[0];
	project.assets.push({ kind: "image", url: "blob:fixture" });
	await w.runGenerationQueue();
	assert.equal(project.status, "error");
	assert.ok(alerts.some(message => /MP4 export library.*loading or unavailable/i.test(message)));
	assertNoScriptErrors(errors);
});

test("direct auth links open the right account form and can create an account", async t => {
	const browser = browserFor({ KV_BINDING: makeKv() });
	t.after(() => browser.close());
	const signup = await browser.request("/signup");
	assert.equal(signup.status, 302);
	assert.equal(signup.headers.get("Location"), "/account?mode=signup");
	const login = await browser.request("/login");
	assert.equal(login.status, 302);
	assert.equal(login.headers.get("Location"), "/account");

	const { window: w, errors } = await browser.open(signup.headers.get("Location"));
	assert.equal(w.document.getElementById("ia-email-wrap").style.display, "block");
	assert.equal(w.document.getElementById("ia-submit-btn").textContent, "Create Account");
	w.document.getElementById("ia-tab-login").click();
	assert.equal(w.document.getElementById("ia-email-wrap").style.display, "none");
	w.document.getElementById("ia-tab-signup").click();
	w.document.getElementById("ia-username").value = "DirectUser";
	w.document.getElementById("ia-email").value = "direct@example.test";
	w.document.getElementById("ia-password").value = "secret123";
	w.document.getElementById("ia-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
	await waitFor(() => browser.requests.some(r => r.path === "/api/signup" && r.status === 200), "inline signup");
	assert.equal((await (await browser.request("/api/session")).json()).user.username, "DirectUser");
	// jsdom cannot reload; a real browser reloads the account page after success.
	assert.ok(errors.every(error => /not implemented.*navigation/i.test(error.message)), errors.map(e => e.message).join("; "));
});

test("built-in URLs, plan redirects, CMS pages and their parsed scripts remain valid", async t => {
	const kv = makeKv({
		"config:cms_pages": JSON.stringify([{ id: "about", slug: "about", url: "/about", title: "About",
			pageLink: "Link Placed On Top Menu", blocks: [{ type: "paragraph", text: "About the studio." }] }]),
		"user:paiduser": JSON.stringify({ username: "PaidUser", email: "paid@example.test", usertype: "paid_user" }),
		"session:abcd": JSON.stringify({ username: "PaidUser", email: "paid@example.test" })
	});
	const browser = browserFor({ KV_BINDING: kv });
	t.after(() => browser.close());
	for (const path of ["/free/", "/studio/", "/paid/", "/account/", "/upgrade/", "/signup/", "/login/"]) {
		const response = await browser.request(path + "?from=nav");
		assert.equal(response.status, 308, path);
		assert.equal(response.headers.get("Location"), path.slice(0, -1) + "?from=nav");
	}
	assert.equal((await browser.request("/not-a-page/")).status, 404);
	for (const path of ["/studio", "/paid"]) {
		const response = await browser.request(path);
		assert.equal(response.status, 302);
		assert.equal(response.headers.get("Location"), "/free");
	}
	const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "Asia/Taipei" }).format(new Date());
	for (const path of ["/", "/free", "/account", "/upgrade", "/about", `/${day}/config/uvxyz`]) {
		const response = await browser.request(path);
		assert.equal(response.status, 200, path);
		assertParsedScriptsCompile(await response.text(), path);
	}
	browser.jar.setCookieSync("yvs_session=abcd; Path=/", ORIGIN);
	for (const path of ["/studio", "/paid", "/account", "/upgrade"]) {
		const response = await browser.request(path);
		assert.equal(response.status, 200, path);
		assertParsedScriptsCompile(await response.text(), path);
	}
});
