import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import workerModule, {
	AUTH_USERNAME_MAX_CHARS,
	AUTH_EMAIL_MAX_CHARS,
	AUTH_SESSION_TTL_SECONDS
} from "../src/index.ts";
import { MAX_PAYMENT_IMAGE_BYTES } from "../src/modules/payments.ts";
import { APP_JS } from "../src/client/app-js.ts";
import { PAYMENT_UPLOAD_JS } from "../src/client/payment-upload-js.ts";
import { TIMELINE_EDITOR_JS } from "../src/client/timeline-editor.ts";
import { CONFIG_PAGE_SCRIPT } from "../src/client/config-page-js.ts";
import { renderAccountPageResponse } from "../src/modules/user-pages.ts";
import { createHTML } from "../src/page.ts";
import { harness } from "./studio-render-harness.mjs";

const worker = workerModule.default || workerModule;

const MB = 1024 * 1024;
const PNG_MAGIC = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
]);
const GIF_MAGIC = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

/** Minimal valid 2x2 2-frame animated GIF89a (each frame 100 ms). */
function makeTinyAnimatedGifBytes() {
	return new Uint8Array([
		// Header GIF89a
		0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
		// Logical screen 2x2, GCT 2 colors (packed = 0x80)
		0x02, 0x00, 0x02, 0x00, 0x80, 0x00, 0x00,
		// GCT: color 0 red, color 1 blue
		0xff, 0x00, 0x00, 0x00, 0x00, 0xff,
		// Frame 1 GCE: delay 10cs (100ms)
		0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00,
		// Frame 1 Image Descriptor (0,0 2x2)
		0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00,
		// LZW min code size 2, 4 pixels of index 0: clear(4),0,0,0,0,eoi(5)
		0x02, 0x02, 0x44, 0x01, 0x00,
		// Frame 2 GCE: delay 15cs (150ms)
		0x21, 0xf9, 0x04, 0x00, 0x0f, 0x00, 0x00, 0x00,
		// Frame 2 Image Descriptor (0,0 2x2)
		0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00,
		// LZW min code size 2, 4 pixels of index 1
		0x02, 0x02, 0x4c, 0x01, 0x00,
		// Trailer
		0x3b
	]);
}

/**
 * Creates a lightweight File-like object reporting an arbitrary byte `size`
 * and serving `headerBytes` from `.slice(0, 6)` without allocating 35 MB in RAM.
 */
function makeSizedFile(WinFile, name, type, size, headerBytes) {
	const head = headerBytes || new Uint8Array(8);
	const file = new WinFile([head], name, { type });
	Object.defineProperty(file, "size", { value: size, configurable: true });
	file.slice = (start = 0, end = head.length) => {
		const sub = head.slice(start, Math.min(end, head.length));
		return {
			size: sub.byteLength,
			arrayBuffer: async () =>
				sub.buffer.slice(sub.byteOffset, sub.byteOffset + sub.byteLength)
		};
	};
	return file;
}

function makeTrackingKv(seed = {}) {
	const map = new Map(Object.entries(seed));
	const puts = [];
	const deletes = [];
	return {
		map,
		puts,
		deletes,
		async get(key) {
			return map.has(key) ? map.get(key) : null;
		},
		async put(key, value, options) {
			const str = String(value);
			map.set(key, str);
			puts.push({ key, value: str, options: options || null });
		},
		async delete(key) {
			map.delete(key);
			deletes.push(key);
		},
		async list({ prefix = "", limit = 1000, cursor } = {}) {
			const all = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
			const start = cursor ? Number(cursor) || 0 : 0;
			const slice = all.slice(start, start + limit);
			const next = start + slice.length;
			return {
				keys: slice.map((name) => ({ name })),
				list_complete: next >= all.length,
				cursor: next >= all.length ? undefined : String(next)
			};
		}
	};
}

function makeFakeIndexedDb() {
	const stores = new Map();
	return {
		stores,
		open(name) {
			const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
			queueMicrotask(() => {
				if (!stores.has(name)) stores.set(name, new Map());
				const data = stores.get(name);
				const db = {
					objectStoreNames: { contains: () => true },
					createObjectStore: () => ({}),
					close() {},
					transaction(_store, mode) {
						const tx = {
							error: null,
							oncomplete: null,
							onerror: null,
							onabort: null,
							abort() {
								if (tx.onabort) tx.onabort();
							},
							objectStore() {
								return {
									get(key) {
										const r = { result: data.get(key) || undefined, onsuccess: null, onerror: null };
										queueMicrotask(() => {
											r.result = data.get(key) || undefined;
											if (r.onsuccess) r.onsuccess({ target: r });
											if (mode !== "readwrite") {
												queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
											}
										});
										return r;
									},
									put(record) {
										const r = { onsuccess: null, onerror: null };
										data.set(record.id, record);
										queueMicrotask(() => {
											if (r.onsuccess) r.onsuccess({ target: r });
											if (tx.oncomplete) tx.oncomplete();
										});
										return r;
									},
									delete(key) {
										data.delete(key);
										queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
										return {};
									}
								};
							}
						};
						return tx;
					}
				};
				req.result = db;
				if (req.onsuccess) req.onsuccess();
			});
			return req;
		}
	};
}

test("Auth signup caps username at 3-40 chars, email at 40 chars, and sets 30-day session TTL on signup & login", async () => {
	assert.equal(AUTH_USERNAME_MAX_CHARS, 40);
	assert.equal(AUTH_EMAIL_MAX_CHARS, 40);
	assert.equal(AUTH_SESSION_TTL_SECONDS, 30 * 24 * 3600);

	const kv = makeTrackingKv();
	const env = { KV_BINDING: kv };

	// Exact 40-char username and exact 40-char email succeed
	const user40 = "user_" + "a".repeat(35); // 40 chars
	const email40 = "e".repeat(31) + "@test.com"; // 31 + 9 = 40 chars
	assert.equal(user40.length, 40);
	assert.equal(email40.length, 40);

	const okSignup = await worker.fetch(
		new Request("https://studio.test/api/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: user40, email: email40, password: "password123" })
		}),
		env,
		{}
	);
	assert.equal(okSignup.status, 200);
	const signupBody = await okSignup.json();
	assert.equal(signupBody.success, true);
	assert.equal(signupBody.user.username, user40);
	assert.equal(signupBody.user.email, email40);

	// Signup session KV entry has 30-day expirationTtl and cookie has matching Max-Age
	const signupCookie = okSignup.headers.get("Set-Cookie") || "";
	assert.match(signupCookie, /Max-Age=2592000\b/);
	const signupSessionPut = kv.puts.find((p) => p.key.startsWith("session:"));
	assert.ok(signupSessionPut, "signup wrote session:<token>");
	assert.deepEqual(signupSessionPut.options, { expirationTtl: 2592000 });

	// 41-char username is rejected with 400
	const user41 = "u".repeat(41);
	const badUser = await worker.fetch(
		new Request("https://studio.test/api/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: user41, email: "ok@test.com", password: "password123" })
		}),
		env,
		{}
	);
	assert.equal(badUser.status, 400);
	assert.match((await badUser.json()).error, /3-40/);

	// 2-char username is still rejected with 400
	const shortUser = await worker.fetch(
		new Request("https://studio.test/api/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "ab", email: "ok2@test.com", password: "password123" })
		}),
		env,
		{}
	);
	assert.equal(shortUser.status, 400);

	// 41-char email is rejected with 400
	const email41 = "e".repeat(32) + "@test.com"; // 41 chars
	assert.equal(email41.length, 41);
	const badEmail = await worker.fetch(
		new Request("https://studio.test/api/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "valid_user_2", email: email41, password: "password123" })
		}),
		env,
		{}
	);
	assert.equal(badEmail.status, 400);
	assert.match((await badEmail.json()).error, /40 characters/);

	// Login with the 40-char username sets 30-day expirationTtl on the new session too
	kv.puts.length = 0;
	const okLogin = await worker.fetch(
		new Request("https://studio.test/api/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: user40, password: "password123" })
		}),
		env,
		{}
	);
	assert.equal(okLogin.status, 200);
	assert.match(okLogin.headers.get("Set-Cookie") || "", /Max-Age=2592000\b/);
	const loginSessionPut = kv.puts.find((p) => p.key.startsWith("session:"));
	assert.ok(loginSessionPut, "login wrote session:<token>");
	assert.deepEqual(loginSessionPut.options, { expirationTtl: 2592000 });

	// Legacy session older than 30 days is rejected and purged; fresh session works
	const freshToken = "aa".repeat(32);
	const staleToken = "bb".repeat(32);
	await kv.put(
		"session:" + freshToken,
		JSON.stringify({
			username: user40,
			email: email40,
			createdAt: new Date(Date.now() - 29 * 24 * 3600 * 1000).toISOString()
		})
	);
	await kv.put(
		"session:" + staleToken,
		JSON.stringify({
			username: user40,
			email: email40,
			createdAt: new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString()
		})
	);

	const freshCheck = await worker.fetch(
		new Request("https://studio.test/api/session", {
			headers: { Cookie: "yvs_session=" + freshToken }
		}),
		env,
		{}
	);
	assert.equal(freshCheck.status, 200);

	const staleCheck = await worker.fetch(
		new Request("https://studio.test/api/session", {
			headers: { Cookie: "yvs_session=" + staleToken }
		}),
		env,
		{}
	);
	assert.equal(staleCheck.status, 401);
	assert.equal(kv.map.has("session:" + staleToken), false, "expired legacy session removed from KV");
});

test("Client auth inputs enforce maxlength=40 for username and email on both studio modal and /account", async () => {
	assert.match(APP_JS, /id="auth-username"\s+maxlength="40"/);
	assert.match(APP_JS, /id="auth-email"\s+maxlength="40"/);
	assert.match(APP_JS, /Username: 3-40 letters, numbers or _ \./);
	assert.match(APP_JS, /Email must be 40 characters or fewer\./);

	const accResp = await renderAccountPageResponse(
		new Request("https://studio.test/account?mode=signup"),
		{},
		"default",
		async () => null
	);
	const html = await accResp.text();
	assert.match(html, /id="ia-username"[^>]*maxlength="40"/);
	assert.match(html, /id="ia-email"[^>]*maxlength="40"/);
});

test("Payment screenshot upload caps at 4 MiB (4 MB) on both server and client", async () => {
	assert.equal(MAX_PAYMENT_IMAGE_BYTES, 4 * MB);

	const kv = makeTrackingKv();
	const env = { KV_BINDING: kv };

	const signup = await worker.fetch(
		new Request("https://studio.test/api/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ username: "payer1", email: "payer1@test.com", password: "password123" })
		}),
		env,
		{}
	);
	assert.equal(signup.status, 200);
	const cookie = (signup.headers.get("Set-Cookie") || "").split(";")[0];

	// Exact 4 MiB valid PNG passes multipart upload
	const exact4Mb = new Uint8Array(4 * MB);
	exact4Mb.set(PNG_MAGIC, 0);
	const okForm = new FormData();
	okForm.append("screenshot", new File([exact4Mb], "receipt-4mb.png", { type: "image/png" }));
	const okUpload = await worker.fetch(
		new Request("https://studio.test/api/payments/upload", {
			method: "POST",
			headers: { Cookie: cookie },
			body: okForm
		}),
		env,
		{}
	);
	assert.equal(okUpload.status, 200);

	// 4 MiB + 1 byte PNG rejected with 413 and "maximum 4 MB" (previously allowed under 5 MB cap)
	const over4Mb = new Uint8Array(4 * MB + 1);
	over4Mb.set(PNG_MAGIC, 0);
	const badForm = new FormData();
	badForm.append("screenshot", new File([over4Mb], "receipt-over.png", { type: "image/png" }));
	const badUpload = await worker.fetch(
		new Request("https://studio.test/api/payments/upload", {
			method: "POST",
			headers: { Cookie: cookie },
			body: badForm
		}),
		env,
		{}
	);
	assert.equal(badUpload.status, 413);
	assert.match((await badUpload.json()).error, /maximum 4 MB/);

	// 4 MiB + 1 byte JSON base64 payload also rejected with 413 and "maximum 4 MB"
	const over4MbB64 = Buffer.from(over4Mb).toString("base64");
	const badJsonUpload = await worker.fetch(
		new Request("https://studio.test/api/payments/upload", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: cookie },
			body: JSON.stringify({ data: over4MbB64, fileName: "phone-shot.png" })
		}),
		env,
		{}
	);
	assert.equal(badJsonUpload.status, 413);
	assert.match((await badJsonUpload.json()).error, /maximum 4 MB/);

	// Client payment uploader enforces 4 MiB and renders "Max 4 MB"
	const dom = new JSDOM("<!doctype html><html><body><div id='pay'></div></body></html>", {
		url: "https://studio.test/upgrade",
		runScripts: "dangerously"
	});
	try {
		dom.window.fetch = async () =>
			new Response(JSON.stringify({ success: true, payments: [] }), {
				status: 200,
				headers: { "Content-Type": "application/json" }
			});
		dom.window.URL.createObjectURL = () => "blob:pay-preview";
		dom.window.URL.revokeObjectURL = () => {};
		dom.window.eval(PAYMENT_UPLOAD_JS);
		dom.window.PaymentScreenshotUploader.mount("#pay");

		const sub = dom.window.document.querySelector(".pay-dropzone-sub");
		assert.match(sub.textContent, /Max 4 MB/);

		const input = dom.window.document.getElementById("payment-screenshot-file");
		const bigPhoneShot = makeSizedFile(dom.window.File, "phone.png", "image/png", 4 * MB + 1, PNG_MAGIC);
		Object.defineProperty(input, "files", { value: [bigPhoneShot], configurable: true });
		input.dispatchEvent(new dom.window.Event("change"));
		const status = dom.window.document.getElementById("payment-upload-status");
		assert.match(status.textContent, /larger than 4 MB/);

		const okPhoneShot = makeSizedFile(dom.window.File, "ok-phone.png", "image/png", 4 * MB, PNG_MAGIC);
		Object.defineProperty(input, "files", { value: [okPhoneShot], configurable: true });
		input.dispatchEvent(new dom.window.Event("change"));
		assert.equal(status.textContent, "");
		assert.equal(dom.window.document.getElementById("pay-preview-name").textContent, "ok-phone.png");
	} finally {
		dom.window.close();
	}
});

test("Editor caps GIF file size at 30 MiB (including renamed GIFs) while leaving regular photos uncapped", async () => {
	const { w } = harness();
	const alerts = [];
	w.alert = (msg) => alerts.push(String(msg));
	try {
		assert.equal(w.__MAX_GIF_FILE_BYTES, 30 * MB);
		assert.equal(w.__GIF_FRAME_BUDGET_BYTES, 30 * MB);

		w.addVideoAccordion();
		const project = w.__VIDEO_PROJECTS[0];
		const input = w.document.getElementById("va-file-1");

		const gif30MbExact = makeSizedFile(w.File, "ok.gif", "image/gif", 30 * MB, GIF_MAGIC);
		const gifOver30Mb = makeSizedFile(w.File, "too-big.gif", "image/gif", 30 * MB + 1, GIF_MAGIC);
		const spoofedGif = makeSizedFile(w.File, "disguised.png", "image/png", 32 * MB, GIF_MAGIC);
		const photo10Mb = makeSizedFile(w.File, "dslr-10mb.png", "image/png", 10 * MB, PNG_MAGIC);
		const photo35Mb = makeSizedFile(w.File, "raw-35mb.png", "image/png", 35 * MB, PNG_MAGIC);

		Object.defineProperty(input, "files", {
			value: [gifOver30Mb, gif30MbExact, spoofedGif, photo10Mb, photo35Mb],
			configurable: true
		});
		input.dispatchEvent(new w.Event("change"));
		await new Promise((r) => setTimeout(r, 30));

		const names = Array.from(project.assets, (a) => `${a.kind}:${a.file.name}`);
		assert.deepEqual(names, [
			"gif:ok.gif",
			"image:dslr-10mb.png",
			"image:raw-35mb.png"
		]);
		assert.equal(alerts.length, 2, "rejected both oversized .gif and disguised GIF");
		assert.match(alerts[0], /too-big\.gif.*30 MB/);
		assert.match(alerts[1], /disguised\.png.*30 MB/);
	} finally {
		w.close();
	}
});

test("GIF decoder caps decoded frame memory strictly at 30 MiB and rejects GIF bombs", async () => {
	const { w } = harness();
	try {
		// Patch 2D canvas mock so getImageData returns realistically sized RGBA byte arrays
		const origCreate = w.document.createElement.bind(w.document);
		w.document.createElement = function (tag) {
			const el = origCreate(tag);
			if (String(tag).toLowerCase() === "canvas") {
				el.getContext = () => ({
					fillStyle: "#000",
					clearRect() {},
					fillRect() {},
					drawImage() {},
					putImageData() {},
					createImageData: (cw, ch) => ({
						width: cw,
						height: ch,
						data: new Uint8ClampedArray(cw * ch * 4)
					}),
					getImageData: (_x, _y, cw, ch) => ({
						width: cw,
						height: ch,
						data: new Uint8ClampedArray(cw * ch * 4)
					})
				});
			}
			return el;
		};

		// 1. Small valid 2-frame GIF decodes cleanly via __decodeGifFrames
		const tinyBytes = makeTinyAnimatedGifBytes();
		const decodedTiny = await w.__decodeGifFrames(
			new w.Blob([tinyBytes], { type: "image/gif" })
		);
		assert.equal(decodedTiny.width, 2);
		assert.equal(decodedTiny.height, 2);
		assert.equal(decodedTiny.frameCount, 2);
		assert.equal(decodedTiny.loopMs, 250);

		// 2. GIF with ~86.4 MiB raw RGBA (under old 120 MiB cap, over new 30 MiB cap) downscales <= 30 MiB
		const makeSyntheticParsed = (width, height, frameCount, delayMs) => ({
			width,
			height,
			backgroundIndex: 0,
			globalPalette: [[0, 0, 0], [255, 255, 255]],
			frames: Array.from({ length: frameCount }, () => ({
				left: 0,
				top: 0,
				width: 1,
				height: 1,
				delayMs,
				disposal: 0,
				transparent: false,
				transparentIndex: -1,
				palette: [[0, 0, 0], [255, 255, 255]],
				pixels: new Uint8Array([1])
			}))
		});

		const medium = w.__buildGifSlideFrames(makeSyntheticParsed(600, 600, 60, 80));
		const mediumBytes = medium.frames.reduce((sum, f) => sum + f.data.data.byteLength, 0);
		assert.ok(medium.width < 600 && medium.height < 600, "downscaled below 600x600");
		assert.equal(medium.frameCount, 60, "all 60 frames preserved");
		assert.equal(medium.loopMs, 60 * 80);
		assert.ok(
			mediumBytes <= 30 * MB,
			`decoded RGBA ${mediumBytes} must be <= ${30 * MB}`
		);

		// 3. Extreme frame-count GIF (600 frames @ 1280x720 -> 0.15 floor alone would be ~49.8 MiB)
		const extreme = w.__buildGifSlideFrames(makeSyntheticParsed(1280, 720, 600, 50));
		const extremeBytes = extreme.frames.reduce((sum, f) => sum + f.data.data.byteLength, 0);
		assert.ok(
			extremeBytes <= 30 * MB,
			`extreme decoded RGBA ${extremeBytes} must be <= ${30 * MB}`
		);
		assert.ok(extreme.frameCount < 600 && extreme.frameCount > 300, "subsampled frames to fit 30 MiB");
		assert.equal(extreme.loopMs, 600 * 50, "exact total loop duration preserved");
		const summedDur = extreme.frames.reduce((sum, f) => sum + f.durationMs, 0);
		assert.equal(summedDur, extreme.loopMs, "folded frame durations match loopMs");

		// 4. Malicious 65535x65535 single-frame GIF bomb header rejected before LZW allocation
		const bomb = new Uint8Array([
			0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
			0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00,
			0x2c, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0x00,
			0x02, 0x00, 0x3b
		]);
		assert.throws(() => w.__parseGifBytes(bomb), /memory limit/);
	} finally {
		w.close();
	}
});

test("Timeline editor caps GIF uploads and storeAsset at 30 MiB while leaving regular photos uncapped", async () => {
	const fakeIdb = makeFakeIndexedDb();
	const shell = createHTML().replace(/<script[\s\S]*?<\/script>/g, "");
	const dom = new JSDOM(shell, {
		url: "https://studio.test/free?layout=timeline&pipelinePage=gif-cap-test&projectEdit=gif-cap-edit",
		runScripts: "dangerously"
	});
	const w = dom.window;
	w.indexedDB = fakeIdb;
	w.URL.createObjectURL = () => "blob:tl-test";
	w.URL.revokeObjectURL = () => {};
	w.scrollTo = () => {};
	Object.defineProperty(w.navigator, "locks", {
		configurable: true,
		value: {
			query: () => Promise.resolve({ held: [], pending: [] }),
			request(name, options, fn) {
				if (typeof options === "function") fn = options;
				return Promise.resolve().then(() => fn({ name }));
			}
		}
	});
	const key = "gif-cap-edit";
	const payload = {
		version: 1,
		transitionOnly: true,
		source: "quick-batch-table-edit",
		createdAt: Date.now(),
		sourcePageId: "p_src",
		targetPageId: "gif-cap-test",
		basicSettings: { id: 1, title: "GIF cap", script: "A short test script", minutes: 1 }
	};
	w.localStorage.setItem("ytvs.transition-project.v1." + key, JSON.stringify(payload));
	w.document.cookie =
		"ytvs_transition_project_" +
		key +
		"=" +
		encodeURIComponent(
			JSON.stringify({
				v: 1,
				key,
				createdAt: payload.createdAt,
				sourcePageId: payload.sourcePageId,
				targetPageId: payload.targetPageId,
				vid: "p_src-row-1"
			})
		) +
		"; Path=/; SameSite=Lax";
	w.HTMLCanvasElement.prototype.getContext = () => ({
		save() {}, restore() {}, clearRect() {}, fillRect() {}, strokeRect() {},
		beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {},
		translate() {}, rotate() {}, scale() {}, drawImage() {}, fillText() {}, strokeText() {},
		setTransform() {}, clip() {}, rect() {}, quadraticCurveTo() {},
		measureText: (txt) => ({ width: String(txt || "").length * 8 }),
		createLinearGradient: () => ({ addColorStop() {} }),
		createRadialGradient: () => ({ addColorStop() {} })
	});
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	w.eval(TIMELINE_EDITOR_JS);
	try {
		for (let i = 0; i < 60 && !w.__TIMELINE_EDITOR_STATE__; i++) {
			await new Promise((r) => setTimeout(r, 10));
		}
		const api = w.__TIMELINE_EDITOR__;
		assert.ok(api, "timeline editor mounted");
		assert.equal(api.maxGifBytes, 30 * MB);

		const statusEl = w.document.getElementById("timeline-status");

		// 1. Single oversized GIF (30 MiB + 1 B) is rejected and not added
		const bigGif = makeSizedFile(w.File, "over30.gif", "image/gif", 30 * MB + 1, GIF_MAGIC);
		await api.addMediaFiles([bigGif]);
		assert.match(statusEl.textContent, /30 MB/);
		let mediaTrack = w.__TIMELINE_EDITOR_STATE__.tracks.find((tr) => tr.kind === "media");
		assert.equal(
			mediaTrack.items.filter((it) => Boolean(it.assetId)).length,
			0,
			"oversized GIF did not attach to placeholder scene"
		);

		// 2. Spoofed GIF (GIF89a header with .jpg name) > 30 MiB is rejected
		const spoofGif = makeSizedFile(w.File, "fake.jpg", "image/jpeg", 31 * MB, GIF_MAGIC);
		await api.addMediaFiles([spoofGif]);
		assert.match(statusEl.textContent, /30 MB/);
		mediaTrack = w.__TIMELINE_EDITOR_STATE__.tracks.find((tr) => tr.kind === "media");
		assert.equal(mediaTrack.items.filter((it) => Boolean(it.assetId)).length, 0);

		// 3. Valid GIF with empty file.type (<= 30 MiB) + 12 MiB PNG + 40 MiB PNG all succeed!
		const okGifNoMime = makeSizedFile(w.File, "anim.gif", "", 30 * MB, GIF_MAGIC);
		const bigPng12Mb = makeSizedFile(w.File, "photo-12mb.png", "image/png", 12 * MB, PNG_MAGIC);
		const hugePng40Mb = makeSizedFile(w.File, "photo-40mb.png", "image/png", 40 * MB, PNG_MAGIC);
		await api.addMediaFiles([okGifNoMime, bigPng12Mb, hugePng40Mb]);
		await new Promise((r) => setTimeout(r, 30));

		mediaTrack = w.__TIMELINE_EDITOR_STATE__.tracks.find((tr) => tr.kind === "media");
		const attached = Array.from(
			mediaTrack.items.filter((it) => Boolean(it.assetId)),
			(it) => `${it.mediaType}:${it.label}`
		);
		assert.deepEqual(attached, [
			"gif:anim.gif",
			"image:photo-12mb.png",
			"image:photo-40mb.png"
		]);

		// Verify IndexedDB stored normalized image/gif type for extension-only .gif
		const projectRecord = fakeIdb.stores.get("ytvs-timeline-editor-assets-v1").get("gif-cap-test");
		assert.ok(projectRecord && projectRecord.assets);
		const savedGif = Object.values(projectRecord.assets).find((a) => a.name === "anim.gif");
		assert.equal(savedGif.type, "image/gif");

		// 4. Direct storeAsset defense-in-depth blocks > 30 MiB GIF but allows > 30 MiB PNG
		const blockedStore = await api.storeAsset("gif-cap-test", "bad-gif", bigGif, {
			name: "over30.gif",
			type: "image/gif"
		});
		assert.equal(blockedStore.ok, false);
		assert.match(blockedStore.reason, /30 MB/);

		const allowedPngStore = await api.storeAsset("gif-cap-test", "ok-big-png", hugePng40Mb, {
			name: "photo-40mb.png",
			type: "image/png"
		});
		assert.equal(allowedPngStore.ok, true);
	} finally {
		w.close();
	}
});

test("Background worker / render queue endpoints and config controls remain intact", async () => {
	const kv = makeTrackingKv();
	const pollRes = await worker.fetch(
		new Request("https://studio.test/api/worker/poll"),
		{ KV_BINDING: kv },
		{}
	);
	assert.equal(pollRes.status, 200);
	assert.equal((await pollRes.json()).job, null);
	assert.ok(APP_JS.includes("workerRunJob"));
	assert.ok(CONFIG_PAGE_SCRIPT.includes("cfg-worker-toggle"));
});

