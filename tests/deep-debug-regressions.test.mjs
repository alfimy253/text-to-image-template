/*
 * Deep-debug regression test suite (`tests/deep-debug-regressions.test.mjs`).
 *
 * Covers server and client defects identified during the full-codebase audit:
 *   1. `ImageTaskQueue` caller-isolated timers (`workerd` IoContext safety),
 *      read-only `DOMException` abort reasons, and `EventLoopCpuSerializer.pendingCount`.
 *   2. `handleImageBatch` exact credit refunds when `reader.cancel()` closes the
 *      stream mid-write + stuck-write backpressure watchdog on abrupt abort.
 *   3. `handleVoiceover` bare URL sanitization, empty-output failover to Deepgram
 *      Aura, WAV->MP3 homogeneous container healing, and `request.signal` abort.
 *   4. `generateImagePrompts` non-throwing empty primary -> 70B fallback +
 *      `parseImagePrompts` bracket-preamble JSON recovery & paragraph-safe budget.
 *   5. `POST /api/image-batch` plan-aware 429 message + `POST /api/payments/upload`
 *      OOM pre-check & corrupted KV JSON safety.
 *   6. Client `exportBatchRow` Portrait/Square MP4 dimensions, `deleteVideoAccordion`
 *      in-flight stream isolation (never leaking into shifted Video N), and
 *      `batchFetch` body-download abort coverage.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { JSDOM } from "jsdom";

import workerModule from "../src/index.ts";
import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
import {
	EventLoopCpuSerializer,
	ImageTaskQueue
} from "../src/modules/image-queue.ts";
import {
	handleVoiceover,
	isWavBytes,
	sanitizeVoiceoverText
} from "../src/modules/voiceover.ts";
import {
	generateImagePrompts,
	IMAGE_PROMPT_MAX_CHARS,
	parseImagePrompts
} from "../src/modules/image-prompts.ts";
import { handleImageBatch } from "../src/modules/image-batch.ts";
import { MAX_PAYMENT_IMAGE_BYTES } from "../src/modules/payments.ts";

const worker = workerModule.default || workerModule;

const PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01
]);

function makeMp3Chunk(fillByte = 0x55) {
	return new Uint8Array([0xff, 0xf3, 0x84, 0xc4, fillByte, fillByte, fillByte, fillByte]);
}

function makeTinyWav(sampleByte = 0x10) {
	const buf = new ArrayBuffer(48);
	const view = new DataView(buf);
	const u8 = new Uint8Array(buf);
	const writeStr = (off, s) => {
		for (let i = 0; i < s.length; i++) u8[off + i] = s.charCodeAt(i);
	};
	writeStr(0, "RIFF");
	view.setUint32(4, 40, true);
	writeStr(8, "WAVE");
	writeStr(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 24000, true);
	view.setUint32(28, 48000, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeStr(36, "data");
	view.setUint32(40, 4, true);
	u8[44] = sampleByte;
	u8[45] = sampleByte;
	u8[46] = sampleByte;
	u8[47] = sampleByte;
	return u8;
}

function makeMemoryKv() {
	const map = new Map();
	return {
		async get(key) {
			return map.has(key) ? map.get(key) : null;
		},
		async put(key, value) {
			map.set(key, String(value));
		},
		async delete(key) {
			map.delete(key);
		},
		async list({ prefix = "", limit = 1000 } = {}) {
			const keys = [];
			for (const name of Array.from(map.keys()).sort()) {
				if (name.startsWith(prefix)) {
					keys.push({ name });
					if (keys.length >= limit) break;
				}
			}
			return { keys, list_complete: true };
		},
		_map: map
	};
}

test("ImageTaskQueue executes every task inside its caller's own async context, handles DOMException AbortError, and zeroes EventLoopCpuSerializer.pendingCount", async () => {
	const requestContext = new AsyncLocalStorage();
	const q = new ImageTaskQueue({
		maxGlobalConcurrency: 2,
		maxGroupConcurrency: 1,
		groupWindowLimit: 1,
		groupWindowMs: 60
	});

	const observedContexts = [];
	const abortA = new AbortController();

	const runInRequest = (reqId, fn) => requestContext.run(reqId, fn);

	const pA1 = runInRequest("req-A", () =>
		q.enqueue({
			groupId: "group-A",
			signal: abortA.signal,
			execute: async () => {
				observedContexts.push(["A1", requestContext.getStore()]);
				await new Promise((r) => setTimeout(r, 15));
				return "A1";
			}
		})
	);

	/* Second task in group-A enters rate-window sleep, then aborts with native DOMException */
	const pA2 = runInRequest("req-A", () =>
		q.enqueue({
			groupId: "group-A",
			signal: abortA.signal,
			execute: async () => {
				observedContexts.push(["A2", requestContext.getStore()]);
				return "A2";
			}
		})
	);

	const pB1 = runInRequest("req-B", () =>
		q.enqueue({
			groupId: "group-B",
			execute: async () => {
				observedContexts.push(["B1", requestContext.getStore()]);
				await new Promise((r) => setTimeout(r, 25));
				return "B1";
			}
		})
	);

	const pB2 = runInRequest("req-B", () =>
		q.enqueue({
			groupId: "group-B",
			execute: async () => {
				observedContexts.push(["B2", requestContext.getStore()]);
				return "B2";
			}
		})
	);

	assert.equal(await pA1, "A1");
	/* Native AbortController.abort() sets signal.reason to a read-only DOMException */
	abortA.abort();
	await assert.rejects(pA2, (err) => err && err.name === "AbortError");
	assert.equal(await pB1, "B1");
	assert.equal(await pB2, "B2");

	assert.deepEqual(observedContexts, [
		["A1", "req-A"],
		["B1", "req-B"],
		["B2", "req-B"]
	]);
	/* Wait past the 60ms sliding rate window so idle group history expires cleanly */
	await new Promise((r) => setTimeout(r, 70));
	assert.deepEqual(q.stats(), {
		active: 0,
		queued: 0,
		groups: 0,
		maxGlobalConcurrency: 2,
		maxGroupConcurrency: 1,
		groupWindowLimit: 1,
		groupWindowMs: 60
	});

	const cpu = new EventLoopCpuSerializer();
	const out = await cpu.run(() => "encoded");
	assert.equal(out, "encoded");
	assert.equal(cpu.pendingCount, 0, "pendingCount must be 0 immediately after await cpu.run()");
});

test("handleImageBatch refunds undelivered images when reader.cancel() closes the stream and unblocks wedged backpressure on abort", async () => {
	/* Case 1: reader cancels right after scene 0 arrives -> scenes 1 & 2 must be refunded */
	let refunded = 0;
	let modelCalls = 0;
	const env = {
		AI: {
			run: async () => {
				const idx = modelCalls++;
				await new Promise((r) => setTimeout(r, idx === 0 ? 5 : 40));
				return PNG_BYTES;
			}
		}
	};

	const res = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompts: ["scene one", "scene two", "scene three"] })
		}),
		env,
		{
			consume: async (n) => ({ allowed: true, granted: n, summary: { remaining: { images: 10 } } }),
			refund: async (n) => {
				refunded += n;
				return { remaining: { images: 10 + n } };
			}
		},
		{ waveIntervalMs: 0 }
	);

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	let deliveredImages = 0;
	while (deliveredImages < 1) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const lines = buf.split("\n");
		buf = lines.pop() || "";
		for (const line of lines) {
			if (!line.trim()) continue;
			const evt = JSON.parse(line);
			if (evt.type === "image" && evt.ok) {
				deliveredImages++;
			}
		}
	}
	await reader.cancel();
	/* Wait until background work's finally completes credit refund */
	const deadline = Date.now() + 800;
	while (refunded < 2 && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 20));
	}
	assert.equal(deliveredImages, 1);
	assert.equal(refunded, 2, "both undelivered scenes must be refunded when stream closes");

	/* Case 2: backpressured TransformStream (nobody calls reader.read()) + request.signal abort */
	let backpressureRefunded = 0;
	const bigPng = new Uint8Array(256 * 1024);
	bigPng.set(PNG_BYTES, 0);
	const abortCtl = new AbortController();
	await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompts: ["big one", "big two", "big three"] }),
			signal: abortCtl.signal
		}),
		{
			AI: {
				run: async () => bigPng
			}
		},
		{
			consume: async (n) => ({ allowed: true, granted: n, summary: {} }),
			refund: async (n) => {
				backpressureRefunded += n;
				return {};
			}
		},
		{ waveIntervalMs: 0 }
	);
	setTimeout(() => abortCtl.abort(), 30);
	await new Promise((r) => setTimeout(r, 450));
	assert.ok(
		backpressureRefunded >= 1,
		"stuck-write watchdog unblocks TransformStream backpressure and refunds undelivered scenes"
	);
});

test("handleVoiceover strips bare URLs, fails over when MeloTTS returns empty output, heals WAV->MP3 container switches, and honors AbortSignal", async () => {
	/* 1. Bare URL stripping */
	const sanitized = sanitizeVoiceoverText(
		"Visit https://example.com/path?a=1&b=2 right now for tips!"
	);
	assert.ok(!sanitized.includes("https://"), "bare URL stripped from TTS text");
	assert.match(sanitized, /Visit right now for tips!/);

	/* 2. Empty `{}` primary output retries & falls back to Deepgram Aura-2 instead of 500 */
	const emptyPrimaryCalls = [];
	const fallbackRes = await handleVoiceover(
		new Request("https://studio.test/api/voiceover", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "Calm breathing restores focus.", lang: "en" })
		}),
		{
			AI: {
				run: async (model) => {
					emptyPrimaryCalls.push(model);
					if (model === "@cf/myshell-ai/melotts") {
						return {};
					}
					return makeMp3Chunk(0x44);
				}
			}
		},
		{ retryBaseMs: 1, fallbackTtsUrl: "" }
	);
	assert.equal(fallbackRes.status, 200);
	assert.equal(fallbackRes.headers.get("Content-Type"), "audio/mpeg");
	assert.deepEqual(emptyPrimaryCalls, [
		"@cf/myshell-ai/melotts",
		"@cf/myshell-ai/melotts",
		"@cf/myshell-ai/melotts",
		"@cf/deepgram/aura-2-en"
	]);

	/* 3. Chunk 1 WAV (MeloTTS) + Chunk 2 MP3 failover (Aura-2) -> re-synthesizes Chunk 1 as MP3 */
	const longTwoChunkText =
		"First chunk of spoken narration that comfortably exceeds three hundred and eighty characters so the sentence chunker places the second paragraph into chunk number two cleanly without truncation or overlap in our test, while keeping natural sentence boundaries and clear pacing throughout the opening narration passage of this video script. " +
		"Second chunk of spoken narration that exceeds the chunk threshold and triggers failover from WAV to MP3 cleanly so the final audio container stays completely homogeneous across the whole file without mixing RIFF headers and MPEG frames.";
	let meloCalls = 0;
	const mixedRes = await handleVoiceover(
		new Request("https://studio.test/api/voiceover", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: longTwoChunkText, lang: "en" })
		}),
		{
			AI: {
				run: async (model) => {
					if (model === "@cf/myshell-ai/melotts") {
						meloCalls++;
						if (meloCalls === 1) return makeTinyWav(0x22);
						throw new Error("AiError 3043");
					}
					return makeMp3Chunk(0x66);
				}
			}
		},
		{ retryBaseMs: 1, fallbackTtsUrl: "" }
	);
	assert.equal(mixedRes.status, 200);
	assert.equal(mixedRes.headers.get("Content-Type"), "audio/mpeg");
	const mixedBytes = new Uint8Array(await mixedRes.arrayBuffer());
	assert.equal(isWavBytes(mixedBytes), false, "final MP3 must not start with a RIFF/WAV header");
	assert.equal(mixedBytes[0], 0xff, "final MP3 starts with valid MPEG sync byte");

	/* 4. Pre-aborted signal stops immediately without calling AI */
	const preAborted = new AbortController();
	preAborted.abort();
	let abortedAiCalls = 0;
	const abortVoRes = await handleVoiceover(
		new Request("https://studio.test/api/voiceover", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "Should not synthesize.", lang: "en" }),
			signal: preAborted.signal
		}),
		{
			AI: {
				run: async () => {
					abortedAiCalls++;
					return makeMp3Chunk();
				}
			}
		}
	);
	assert.equal(abortVoRes.status, 499);
	assert.equal(abortedAiCalls, 0);
});

test("generateImagePrompts falls back to 70B when primary returns empty 200 replies, and parseImagePrompts handles bracket preambles + 3-paragraph budget", async () => {
	const modelsCalled = [];
	const prompts = await generateImagePrompts(
		{
			AI: {
				run: async (model) => {
					modelsCalled.push(model);
					if (model === "@cf/meta/llama-3.1-8b-instruct-fp8") {
						/* Non-throwing empty/unparseable response */
						return { response: "" };
					}
					return {
						response: JSON.stringify({
							prompts: [
								"Subject moves through morning mist with steady natural posture and clear foreground presence.\n\nWarm sunlit valley with layered pine ridges and coherent depth.\n\nWide 35mm lens at eye level with natural film grain and clean geometry."
							]
						})
					};
				}
			}
		},
		"@cf/meta/llama-3.1-8b-instruct-fp8",
		{ topic: "Alpine trail", minutes: 1, style: "Cinematic Film" }
	);
	assert.equal(prompts.length, 1);
	assert.ok(modelsCalled.includes("@cf/meta/llama-3.3-70b-instruct-fp8-fast"));

	/* Bracket preamble before JSON object + oversized 3-paragraph entry */
	const p1 = ("Detailed foreground action with grounded posture and crisp hands. ").repeat(12);
	const p2 = ("Atmospheric valley lighting with deep perspective and layered mist. ").repeat(12);
	const p3 = ("Medium 50mm lens framing at eye height with balanced color grade. ").repeat(12);
	const rawReply =
		'Note [10 scenes]: {"prompts":[' + JSON.stringify(p1 + "\n\n" + p2 + "\n\n" + p3) + "]}";
	const parsed = parseImagePrompts(rawReply, 10);
	assert.equal(parsed.length, 1);
	assert.ok(parsed[0].length <= IMAGE_PROMPT_MAX_CHARS);
	assert.equal(
		parsed[0].split(/\n{2,}/).length,
		3,
		"all 3 model paragraphs preserved when fitting to IMAGE_PROMPT_MAX_CHARS"
	);
});

test("Worker credit exhaustion message on POST /api/image-batch and payment upload OOM / corrupted KV guards", async () => {
	const kv = makeMemoryKv();
	/* Exhaust the 10-image daily guest allowance on /free */
	const exhaustRes = await worker.fetch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: "yvs_free=1",
				"CF-Connecting-IP": "203.0.113.42"
			},
			body: JSON.stringify({
				prompts: Array.from({ length: 10 }, (_, i) => "guest scene " + i)
			})
		}),
		{
			KV_BINDING: kv,
			AI: { run: async () => PNG_BYTES }
		},
		{}
	);
	await exhaustRes.text();

	const blockedRes = await worker.fetch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: "yvs_free=1",
				"CF-Connecting-IP": "203.0.113.42"
			},
			body: JSON.stringify({ prompts: ["one more scene"] })
		}),
		{
			KV_BINDING: kv,
			AI: { run: async () => PNG_BYTES }
		},
		{}
	);
	assert.equal(blockedRes.status, 429);
	const blockedJson = await blockedRes.json();
	assert.match(blockedJson.error, /Create a free account/);

	/* Sign up a test user to exercise authenticated payment routes */
	const signupRes = await worker.fetch(
		new Request("https://studio.test/api/signup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				username: "paytester",
				email: "paytester@example.com",
				password: "password123"
			})
		}),
		{ KV_BINDING: kv },
		{}
	);
	assert.equal(signupRes.status, 200);
	const setCookie = signupRes.headers.get("Set-Cookie") || "";
	const sessionCookie = setCookie.split(";")[0];

	/* Oversized base64 string (> 5 MB equivalent) rejected with 413 before atob() */
	const hugeFakeBase64 = "A".repeat(Math.ceil((MAX_PAYMENT_IMAGE_BYTES * 4) / 3) + 8192);
	const uploadHugeRes = await worker.fetch(
		new Request("https://studio.test/api/payments/upload", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: sessionCookie
			},
			body: JSON.stringify({ data: hugeFakeBase64, fileName: "huge.png" })
		}),
		{ KV_BINDING: kv },
		{}
	);
	assert.equal(uploadHugeRes.status, 413);

	/* Corrupted KV payment metadata returns clean 500 JSON instead of uncaught SyntaxError */
	await kv.put("payment:pay-0000000000001-deadbeef", "{not-valid-json");
	const badMetaRes = await worker.fetch(
		new Request("https://studio.test/api/payments/image/pay-0000000000001-deadbeef", {
			method: "GET",
			headers: { Cookie: sessionCookie }
		}),
		{ KV_BINDING: kv },
		{}
	);
	assert.equal(badMetaRes.status, 500);
	const badMetaJson = await badMetaRes.json();
	assert.equal(badMetaJson.success, false);
});

test("Client deep-debug fixes: exportBatchRow uses row's Portrait/Square dimensions and deleteVideoAccordion isolates surviving videos", async () => {
	const html = createHTML();
	const dom = new JSDOM(html, {
		url: "https://studio.test/studio",
		runScripts: "outside-only",
		pretendToBeVisual: true
	});
	const w = dom.window;

	w.HTMLMediaElement.prototype.play = () => Promise.resolve();
	w.HTMLMediaElement.prototype.pause = () => {};
	w.HTMLMediaElement.prototype.load = () => {};

	let blobSeq = 0;
	w.URL.createObjectURL = () => "blob:studio/" + ++blobSeq;
	w.URL.revokeObjectURL = () => {};
	w.confirm = () => true;
	w.alert = () => {};

	const canvasCtxStub = {
		fillStyle: "#000",
		strokeStyle: "#000",
		font: "16px sans-serif",
		textAlign: "center",
		textBaseline: "middle",
		globalAlpha: 1,
		fillRect() {},
		clearRect() {},
		drawImage() {},
		save() {},
		restore() {},
		beginPath() {},
		closePath() {},
		rect() {},
		clip() {},
		arc() {},
		fill() {},
		stroke() {},
		fillText() {},
		strokeText() {},
		measureText: (t) => ({ width: String(t || "").length * 8 }),
		createLinearGradient: () => ({ addColorStop() {} }),
		setTransform() {}
	};
	w.HTMLCanvasElement.prototype.getContext = () => canvasCtxStub;
	if (w.Image && w.Image.prototype) {
		w.Image.prototype.decode = () => Promise.resolve();
	}

	/* Stub WebCodecs + Mp4Muxer to capture configured export dimensions */
	let configuredEncoderDims = null;
	let configuredMuxerDims = null;
	w.VideoFrame = class MockVideoFrame {
		constructor(_source, init) {
			this.timestamp = init ? init.timestamp : 0;
		}
		close() {}
	};
	w.VideoEncoder = class MockVideoEncoder {
		constructor(init) {
			this._output = init.output;
			this.encodeQueueSize = 0;
			this.state = "unconfigured";
		}
		configure(cfg) {
			configuredEncoderDims = { width: cfg.width, height: cfg.height };
			this.state = "configured";
		}
		encode() {
			this._output({ byteLength: 16 }, {});
		}
		async flush() {}
		close() {
			this.state = "closed";
		}
	};
	w.Mp4Muxer = {
		ArrayBufferTarget: class {
			constructor() {
				this.buffer = new ArrayBuffer(32);
			}
		},
		Muxer: class {
			constructor(cfg) {
				configuredMuxerDims = { width: cfg.video.width, height: cfg.video.height };
				this.target = cfg.target;
			}
			addVideoChunk() {}
			addAudioChunk() {}
			finalize() {}
		}
	};

	/* Controllable /api/image-batch gate to test deleting Video 1 mid-stream */
	let releaseVideo1Stream = null;
	let video1Aborted = false;

	w.fetch = async (input, init = {}) => {
		const url = typeof input === "string" ? input : input.url;
		const path = new URL(url, "https://studio.test").pathname;
		if (path === "/api/session") {
			return new Response(
				JSON.stringify({
					authenticated: true,
					user: { username: "tester", usertype: "free" }
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } }
			);
		}
		if (path === "/api/credits") {
			return new Response(
				JSON.stringify({
					plan: { id: "free", label: "Free", limits: { images: 50 } },
					remaining: { images: 50 }
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } }
			);
		}
		if (path === "/api/voiceover") {
			return new Response(makeMp3Chunk(0x33), {
				status: 200,
				headers: { "Content-Type": "audio/mpeg" }
			});
		}
		if (path === "/api/image-prompts") {
			return new Response(
				JSON.stringify({
					success: true,
					prompts: ["Scene 1 lead.\n\nScene 1 atmosphere.\n\nScene 1 lens."]
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } }
			);
		}
		if (path === "/api/image-batch") {
			const body = JSON.parse(String(init.body || "{}"));
			if (body.prompts && body.prompts[0] && body.prompts[0].includes("Video1DeleteTest")) {
				if (init.signal) {
					init.signal.addEventListener("abort", () => {
						video1Aborted = true;
						if (releaseVideo1Stream) releaseVideo1Stream();
					});
				}
				const stream = new ReadableStream({
					async start(controller) {
						const enc = new TextEncoder();
						controller.enqueue(
							enc.encode(JSON.stringify({ type: "start", count: 1 }) + "\n")
						);
						await new Promise((r) => {
							releaseVideo1Stream = r;
						});
						/* Emit an image AFTER Video 1 was deleted to verify it never lands in Video 2 */
						const b64 = Buffer.from(PNG_BYTES).toString("base64");
						controller.enqueue(
							enc.encode(
								JSON.stringify({
									type: "image",
									index: 0,
									ok: true,
									mime: "image/png",
									data: b64
								}) + "\n"
							)
						);
						controller.close();
					}
				});
				return new Response(stream, {
					status: 200,
					headers: { "Content-Type": "application/x-ndjson" }
				});
			}

			const b64 = Buffer.from(PNG_BYTES).toString("base64");
			const ndjson =
				JSON.stringify({ type: "start", count: 1 }) +
				"\n" +
				JSON.stringify({ type: "image", index: 0, ok: true, mime: "image/png", data: b64 }) +
				"\n" +
				JSON.stringify({ type: "done", count: 1, generated: 1, failed: 0 }) +
				"\n";
			return new Response(ndjson, {
				status: 200,
				headers: { "Content-Type": "application/x-ndjson" }
			});
		}
		return new Response("{}", { status: 404 });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	await new Promise((r) => setTimeout(r, 40));

	/* 1. Quick Batch Table row with 720px Portrait 9:16 exports at 408x720 (NOT 1280x720) */
	w.setStudioLayout("table");
	const rowEl = w.document.querySelector("[data-batch-row]");
	const rowId = rowEl.getAttribute("data-batch-row");
	const textarea = rowEl.querySelector('[data-batch-field="script"]');
	textarea.value = "Vertical portrait short script.";
	textarea.dispatchEvent(new w.Event("input", { bubbles: true }));

	const resSel = rowEl.querySelector('[data-batch-field="resolution"]');
	resSel.value = "720";
	resSel.dispatchEvent(new w.Event("change", { bubbles: true }));

	const orientSel = rowEl.querySelector('[data-batch-field="orientation"]');
	orientSel.value = "portrait";
	orientSel.dispatchEvent(new w.Event("change", { bubbles: true }));

	await w.generateBatchRows();
	await w.exportBatchRow(Number(rowId));

	assert.deepEqual(
		configuredEncoderDims,
		{ width: 408, height: 720 },
		"VideoEncoder must use the row's Portrait 9:16 (408x720) dimensions"
	);
	assert.deepEqual(
		configuredMuxerDims,
		{ width: 408, height: 720 },
		"Mp4Muxer must use the row's Portrait 9:16 (408x720) dimensions"
	);

	/* 2. Deleting a video mid-stream aborts its stream and never injects images into the surviving video */
	w.setStudioLayout("editor");
	while (w.__VIDEO_PROJECTS.length < 2) {
		w.addVideoAccordion();
	}
	const doomedIdx = 1;
	const survivorIdx = 2;
	w.document.getElementById("va-title-" + doomedIdx).value = "Doomed Video";
	w.document.getElementById("va-title-" + survivorIdx).value = "Survivor Video";
	assert.equal(w.document.getElementById("va-gallery-" + survivorIdx).children.length, 0);

	/* Start an in-flight batch on Video 1, then delete Video 1 while streaming */
	w.__VIDEO_PROJECTS[0]._imageFlowActive = true;
	w.__VIDEO_PROJECTS[0]._imageFlowSeq = 1;
	const batchPromise = w.runImageBatch(1, ["Video1DeleteTest prompt"], "flow-del-1");
	await new Promise((r) => setTimeout(r, 30));
	w.deleteVideoAccordion(1);
	if (releaseVideo1Stream) releaseVideo1Stream();
	await batchPromise;
	await new Promise((r) => setTimeout(r, 30));

	assert.equal(video1Aborted, true, "deleting Video 1 aborted its in-flight /api/image-batch fetch");
	assert.equal(w.document.getElementById("va-title-1").value, "Survivor Video");
	const survivingGallery = w.document.getElementById("va-gallery-1");
	assert.equal(
		survivingGallery.children.length,
		0,
		"deleted Video 1's images never leaked into surviving Video 2 (renumbered to Video 1)"
	);

	dom.window.close();
});
