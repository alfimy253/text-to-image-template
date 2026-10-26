/*
 * End-to-end & unit regression suite for the Quick Batch Table (`#view-table`)
 * 3-stage pipeline:
 *   Stage 1: `POST /api/voiceover` (`src/modules/voiceover.ts`) + `decodeBatchAudio`
 *   Stage 2: `POST /api/image-prompts` (`src/modules/image-prompts.ts`)
 *   Stage 3: `POST /api/image-batch` (`src/modules/image-batch.ts`) + `requestBatchImages`
 *   Plus Quick Batch Table UI / `#top-generate` / `<select>` change / clear-to-reset.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";

import worker from "../src/index.ts";
import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
import {
	ImageTaskQueue,
	EventLoopCpuSerializer
} from "../src/modules/image-queue.ts";
import {
	handleVoiceover,
	sanitizeVoiceoverText,
	splitVoiceoverChunks,
	stripMp3Id3Tag,
	joinVoiceoverPieces
} from "../src/modules/voiceover.ts";
import {
	handleGenerateImagePrompts,
	parseImagePrompts,
	applyImageStyleToPrompts,
	buildImagePromptInstruction,
	countPromptParagraphs,
	IMAGE_STYLES,
	IMAGE_STYLE_DISCIPLINE,
	IMAGE_PROMPT_MAX_TOKENS,
	IMAGE_PROMPT_MAX_CHARS as PROMPTS_MAX_CHARS
} from "../src/modules/image-prompts.ts";
import {
	handleImageBatch,
	runImageModel,
	condensePromptForModel,
	sdxlSafeDimensions,
	bytesToBase64,
	base64ToBytes,
	IMAGE_PROMPT_MAX_CHARS,
	IMAGE_MODEL_PROMPT_MAX_CHARS,
	IMAGE_NEGATIVE_PROMPT,
	IMAGE_BATCH_CONCURRENCY,
	IMAGE_BATCH_WAVE_INTERVAL_MS
} from "../src/modules/image-batch.ts";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function buildMp3WithId3(payloadBytes) {
	/* 10-byte ID3v2 header with 4-byte tag body (size = 4) + MPEG frame bytes */
	const header = new Uint8Array([
		0x49, 0x44, 0x33, 0x03, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x04,
		0x54, 0x45, 0x53, 0x54
	]);
	const out = new Uint8Array(header.length + payloadBytes.length);
	out.set(header, 0);
	out.set(payloadBytes, header.length);
	return out;
}

async function waitFor(predicate, timeoutMs = 4000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await new Promise((r) => setTimeout(r, 10));
	}
	return false;
}

/* ------------------------------------------------------------------ */
/* Stage 1: Voiceover sanitization, chunking, fallbacks & ID3 join     */
/* ------------------------------------------------------------------ */

test("Stage 1: sanitizeVoiceoverText & splitVoiceoverChunks strip emojis/markdown and never emit 0-phoneme chunks", () => {
	const dirty =
		"## Intro ✨🎬\n\n**Welcome** to [Vibe Studio](https://example.com)! ... --- \u2014 ‘ Breathe ’ deeply… 🌟 ...";
	const clean = sanitizeVoiceoverText(dirty);
	assert.doesNotMatch(clean, /✨|🎬|🌟|\*\*|##|https?:\/\//);
	assert.match(clean, /Welcome to Vibe Studio/);

	const chunks = splitVoiceoverChunks("... --- !!! First real sentence. ... --- Second real sentence! ...", 120);
	assert.equal(chunks.length, 1);
	for (const chunk of chunks) {
		assert.match(chunk, /[A-Za-z0-9]/, "every chunk must contain speakable characters");
	}

	/* Long unpunctuated sentence splits cleanly on word boundaries <= maxChunk */
	const longRun = Array.from({ length: 80 }, (_, i) => "word" + i).join(" ");
	const longChunks = splitVoiceoverChunks(longRun, 120);
	assert.ok(longChunks.length >= 4);
	for (const c of longChunks) {
		assert.ok(c.length <= 120, "chunk exceeds limit: " + c.length);
		assert.match(c, /^word\d+/);
	}
});

test("Stage 1: joinVoiceoverPieces strips duplicate ID3v2 headers on MP3 chunks 2..N", () => {
	const frame1 = new Uint8Array([0xff, 0xfb, 0x90, 0x01]);
	const frame2 = new Uint8Array([0xff, 0xfb, 0x90, 0x02]);
	const c1 = buildMp3WithId3(frame1);
	const c2 = buildMp3WithId3(frame2);

	assert.deepEqual([...stripMp3Id3Tag(c2)], [...frame2]);

	const joined = joinVoiceoverPieces([c1, c2]);
	assert.equal(joined.audioType, "audio/mpeg");
	/* Chunk 1 keeps its 14-byte ID3 header + 4-byte frame; chunk 2 contributes only its 4-byte frame */
	assert.equal(joined.bytes.byteLength, c1.byteLength + frame2.byteLength);
});

test("Stage 1: handleVoiceover falls back to native Workers AI Deepgram MP3 when MeloTTS throws 3043 and rejects HTML fallback pages", async () => {
	const calls = [];
	const mp3Chunk = buildMp3WithId3(new Uint8Array([0xff, 0xfb, 0x90, 0x44]));
	const env = {
		AI: {
			run: async (model, input) => {
				calls.push({ model, input });
				if (model === "@cf/myshell-ai/melotts") {
					throw new Error("AiError: 3043 Internal server error");
				}
				if (model === "@cf/deepgram/aura-2-en") {
					/* Return cross-realm { getReader } stream to verify stream extraction */
					let sent = false;
					return {
						getReader: () => ({
							read: async () => {
								if (sent) return { done: true };
								sent = true;
								return { done: false, value: mp3Chunk };
							}
						})
					};
				}
				throw new Error("Unexpected model: " + model);
			}
		}
	};

	const text =
		"First paragraph sentence that fills out a realistic chunk of spoken narration for testing. ".repeat(6);
	const req = new Request("https://studio.test/api/voiceover", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text, lang: "en" })
	});

	const resp = await handleVoiceover(req, env, {
		retryDelayMs: 0,
		fetchImpl: async () =>
			new Response("<!DOCTYPE html><html><body>502 Bad Gateway</body></html>", {
				status: 200,
				headers: { "Content-Type": "text/html" }
			})
	});

	assert.equal(resp.status, 200);
	assert.equal(resp.headers.get("Content-Type"), "audio/mpeg");
	const audioBytes = new Uint8Array(await resp.arrayBuffer());
	assert.ok(audioBytes.byteLength > 14);

	/* MeloTTS failed on chunk 1 (3 attempts), Aura-2 succeeded and became sticky for chunk 2! */
	const meloCalls = calls.filter((c) => c.model === "@cf/myshell-ai/melotts");
	const auraCalls = calls.filter((c) => c.model === "@cf/deepgram/aura-2-en");
	assert.equal(meloCalls.length, 3, "MeloTTS was not re-retried on chunk 2 once Aura became sticky");
	assert.ok(auraCalls.length >= 2, "Aura handled all chunks as MP3");
	assert.equal(auraCalls[0].input.encoding, "mp3");
});

/* ------------------------------------------------------------------ */
/* Stage 2: Image prompts context ceiling, JSON repair & salvage       */
/* ------------------------------------------------------------------ */

test("Stage 2: parseImagePrompts repairs literal newlines inside JSON strings and salvages truncated JSON arrays", () => {
	const rawWithLiteralNewlines =
		'```json\n{\n  "prompts": [\n    "Paragraph one with literal newline.\n\nParagraph two with lighting.\n\nParagraph three with lens.",\n    "Second scene paragraph one.\n\nSecond scene paragraph two.\n\nSecond scene paragraph three.",\n  ]\n}\n```';
	const parsed = parseImagePrompts(rawWithLiteralNewlines, 5);
	assert.equal(parsed.length, 2);
	assert.match(parsed[0], /Paragraph one[\s\S]*\n\nParagraph two[\s\S]*\n\nParagraph three/);

	/* Simulate max_tokens cutting off mid-way through prompt #3 */
	const truncated =
		'{"prompts":["Complete scene alpha.\\n\\nAtmosphere alpha.\\n\\nCamera alpha.","Complete scene beta.\\n\\nAtmosphere beta.\\n\\nCamera beta.","Truncated scene gamma without closing quote';
	const salvaged = parseImagePrompts(truncated, 10);
	assert.equal(salvaged.length, 2, "must salvage the 2 complete scenes and drop only the unfinished tail");
	assert.match(salvaged[0], /Complete scene alpha/);
	assert.match(salvaged[1], /Complete scene beta/);
});

test("Stage 2: handleGenerateImagePrompts stays under 4096 max_tokens, accepts pre-parsed object responses, and falls back to 70B on primary failure", async () => {
	/* 1. Verify max_tokens <= 4096 even for 6-minute (20-prompt) batches + object response shape */
	const seenInputs = [];
	const envStrict8k = {
		AI: {
			run: async (_model, input) => {
				seenInputs.push(input);
				assert.ok(
					input.max_tokens <= IMAGE_PROMPT_MAX_TOKENS && input.max_tokens <= 4096,
					"max_tokens " + input.max_tokens + " would overflow Llama 3.1 8B 8K context"
				);
				/* Simulate Workers AI returning an auto-parsed JSON object in `response` */
				return {
					response: {
						prompts: Array.from({ length: 20 }, (_, idx) =>
							"Scene " + (idx + 1) + " subject moving in frame.\n\nWarm directional atmosphere.\n\nWide 35mm cinema composition."
						)
					}
				};
			}
		}
	};

	const okRes = await handleGenerateImagePrompts(
		new Request("https://studio.test/api/image-prompts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				topic: "Deep ocean exploration",
				minutes: 6,
				style: "Cinematic Film",
				script: "Submersibles descend into the midnight zone."
			})
		}),
		envStrict8k,
		"@cf/meta/llama-3.1-8b-instruct-fp8"
	);
	assert.equal(okRes.status, 200);
	const okData = await okRes.json();
	assert.equal(okData.count, 20);
	assert.equal(seenInputs.length, 1);

	/* 2. Verify fallback to @cf/meta/llama-3.3-70b-instruct-fp8-fast when primary throws */
	const modelsTried = [];
	const envFallback = {
		AI: {
			run: async (model) => {
				modelsTried.push(model);
				if (model === "@cf/meta/llama-3.1-8b-instruct-fp8") {
					throw new Error("AiError: context window / upstream 3043");
				}
				return {
					response: JSON.stringify({
						prompts: ["Recovered scene one", "Recovered scene two"]
					})
				};
			}
		}
	};

	const fbRes = await handleGenerateImagePrompts(
		new Request("https://studio.test/api/image-prompts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				topic: "Solar storm",
				minutes: 1,
				style: "Neon Night",
				script: "Charged particles light the polar sky."
			})
		}),
		envFallback,
		"@cf/meta/llama-3.1-8b-instruct-fp8"
	);
	assert.equal(fbRes.status, 200);
	const fbData = await fbRes.json();
	assert.equal(fbData.count, 2);
	assert.ok(modelsTried.includes("@cf/meta/llama-3.3-70b-instruct-fp8-fast"));
});

/* ------------------------------------------------------------------ */
/* Stage 2 & 3: 1800-char cap, strict style fidelity & anti-distortion */
/* ------------------------------------------------------------------ */

test("Stage 2 & 3: IMAGE_PROMPT_MAX_CHARS = 1800, strict style-fidelity lock across all styles, and stronger anti-distortion guardrails", () => {
	assert.equal(PROMPTS_MAX_CHARS, 1800);
	assert.equal(IMAGE_PROMPT_MAX_CHARS, 1800);
	assert.equal(IMAGE_MODEL_PROMPT_MAX_CHARS, 1800);

	/* Every supported style gets its own medium-discipline lock + anti-distortion guard */
	for (const style of IMAGE_STYLES) {
		assert.ok(IMAGE_STYLE_DISCIPLINE[style] && IMAGE_STYLE_DISCIPLINE[style].length > 40, style);
		const instruction = buildImagePromptInstruction({
			topic: "urban vertical farming",
			minutes: 1,
			style,
			scriptIdea: "Engineers grow leafy greens inside compact glass towers."
		});
		assert.match(instruction, /STRICT STYLE FIDELITY/i);
		assert.ok(instruction.includes(IMAGE_STYLE_DISCIPLINE[style]), "includes style discipline for " + style);
		assert.match(instruction, /ANTI-DISTORTION & STRUCTURAL GUARD/i);
		assert.match(instruction, /five-fingered hands/i);
		assert.match(instruction, /1800/);
	}

	/* Negative prompt reinforces both text-free and anti-distortion constraints */
	assert.match(IMAGE_NEGATIVE_PROMPT, /text, words, letters/);
	assert.match(IMAGE_NEGATIVE_PROMPT, /distorted, deformed, disfigured/);
	assert.match(IMAGE_NEGATIVE_PROMPT, /bad anatomy, bad proportions/);
	assert.match(IMAGE_NEGATIVE_PROMPT, /extra fingers, fused fingers/);
	assert.match(IMAGE_NEGATIVE_PROMPT, /warped perspective, bent architecture/);
});

test("Stage 3: runImageModel enforces 1800-char styled prompt cap while preserving all 4 paragraphs, heals odd sub-1024 dimensions, and falls back to Flux/Lightning", async () => {
	const hugeParagraph = ("Detailed architectural sunlight streaming across limestone arches with atmospheric dust motes. ").repeat(12);
	const styled = applyImageStyleToPrompts(
		[hugeParagraph + "\n\n" + hugeParagraph + "\n\n" + hugeParagraph],
		"Cinematic Film"
	)[0];
	assert.ok(
		styled.length <= 1800 && styled.length > 1400,
		"expected styled prompt within 1800 chars, got " + styled.length
	);
	assert.equal(
		countPromptParagraphs(styled),
		4,
		"all 3 scene paragraphs + closing Visual style paragraph remain intact"
	);
	assert.match(styled, /zero style drift/i);
	assert.match(styled, /undistorted geometry/i);

	const condensed = condensePromptForModel(styled);
	assert.ok(condensed.length <= 1800, "condensed prompt must fit within 1800-char cap");
	assert.match(condensed, /Visual style:/, "must preserve the closing Visual style directive");

	assert.deepEqual(sdxlSafeDimensions(408, 720), { width: 576, height: 1024 });
	assert.deepEqual(sdxlSafeDimensions(720, 408), { width: 1024, height: 576 });
	assert.deepEqual(sdxlSafeDimensions(480, 480), { width: 1024, height: 1024 });
	assert.deepEqual(sdxlSafeDimensions(1024, 576), { width: 1024, height: 576 });

	/* Strict SDXL mock that rejects prompts > 1800 chars and dimensions not divisible by 64 */
	const sdxlCalls = [];
	const envStrictSdxl = {
		AI: {
			run: async (model, input) => {
				sdxlCalls.push({
					model,
					width: input.width,
					height: input.height,
					len: input.prompt.length,
					guidance: input.guidance
				});
				if (input.prompt.length > 1800) {
					throw new Error("AiError: prompt exceeds 1800 characters");
				}
				if (input.width % 64 !== 0 || input.height % 64 !== 0) {
					throw new Error("AiError: 3043 UNet odd latent tensor mismatch");
				}
				return PNG_BYTES;
			}
		}
	};

	const alignedResult = await runImageModel(envStrictSdxl, styled, { width: 408, height: 720 });
	assert.equal(alignedResult.mime, "image/png");
	assert.equal(sdxlCalls.length, 2, "retried immediately at 64-aligned 576x1024");
	assert.equal(sdxlCalls[1].guidance, 7.5);
	assert.deepEqual({ w: sdxlCalls[1].width, h: sdxlCalls[1].height }, { w: 576, h: 1024 });

	/* Fallback to Flux (JPEG base64 with data: prefix) includes style & anti-distortion guardrail */
	let fluxPromptSeen = "";
	const envFluxFallback = {
		AI: {
			run: async (model, input) => {
				if (model !== "@cf/black-forest-labs/flux-1-schnell") {
					throw new Error("AiError: 3043 SDXL unavailable");
				}
				fluxPromptSeen = String(input.prompt || "");
				return { image: "data:image/jpeg;base64," + bytesToBase64(JPEG_BYTES) };
			}
		}
	};
	const fluxImg = await runImageModel(envFluxFallback, "Mountain sunrise", { width: 1024, height: 576 });
	assert.equal(fluxImg.mime, "image/jpeg");
	assert.match(fluxPromptSeen, /coherent perspective, natural proportions, intact anatomy/i);
	assert.deepEqual([...fluxImg.bytes], [...JPEG_BYTES]);
	assert.deepEqual([...base64ToBytes("data:image/png;base64, " + bytesToBase64(PNG_BYTES))], [...PNG_BYTES]);
});

test("Stage 3: handleImageBatch paces generation at 3 images per 3 seconds per video/row and aborts cleanly mid-wave", async () => {
	assert.equal(IMAGE_BATCH_CONCURRENCY, 3);
	assert.equal(IMAGE_BATCH_WAVE_INTERVAL_MS, 3000);

	/* 1. Default production pacing (3000 ms wave window) across 7 scenes = 3 waves (3 + 3 + 1) */
	const startedOffsets = [];
	let active = 0;
	let maxActive = 0;
	const t0 = Date.now();
	const envPaced = {
		AI: {
			run: async () => {
				const offset = Date.now() - t0;
				startedOffsets.push(offset);
				active++;
				if (active > maxActive) maxActive = active;
				await new Promise((r) => setTimeout(r, 20));
				active--;
				return PNG_BYTES;
			}
		}
	};

	const sevenPrompts = Array.from({ length: 7 }, (_, i) => "Scene " + (i + 1) + " mountain trail");
	const res = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompts: sevenPrompts })
		}),
		envPaced,
		{
			consume: async (n) => ({ allowed: true, granted: n, summary: { remaining: { images: 20 - n } } }),
			refund: async () => null
		}
	);
	const events = (await res.text())
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));

	assert.equal(maxActive <= 3, true, "never exceeds 3 concurrent image renders per row");
	assert.equal(startedOffsets.length, 7);
	/* Wave 1 (0, 1, 2) starts immediately at ~0 ms */
	assert.ok(startedOffsets[2] < 1000, "Wave 1 started immediately: " + startedOffsets[2] + "ms");
	/* Wave 2 (3, 4, 5) starts ~3000 ms after Wave 1 */
	assert.ok(startedOffsets[3] >= 2850, "Wave 2 waited ~3s window: " + startedOffsets[3] + "ms");
	/* Wave 3 (6) starts ~6000 ms after Wave 1, with zero trailing wait after Wave 3 */
	assert.ok(startedOffsets[6] >= 5750, "Wave 3 waited second ~3s window: " + startedOffsets[6] + "ms");
	const totalElapsed = Date.now() - t0;
	assert.ok(totalElapsed < 7500, "no trailing 3s sleep after final wave: " + totalElapsed + "ms");

	const doneEvt = events[events.length - 1];
	assert.equal(doneEvt.type, "done");
	assert.equal(doneEvt.generated, 7);
	assert.equal(doneEvt.failed, 0);

	/* 2. Aborting during the 3-second cooldown wakes immediately and refunds unrendered scenes */
	const abortCtl = new AbortController();
	let refundedCount = 0;
	let waveCalls = 0;
	const envAbort = {
		AI: {
			run: async () => {
				waveCalls++;
				return PNG_BYTES;
			}
		}
	};
	const abortStart = Date.now();
	const abortRes = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompts: sevenPrompts }),
			signal: abortCtl.signal
		}),
		envAbort,
		{
			consume: async (n) => ({ allowed: true, granted: n, summary: { remaining: { images: 13 } } }),
			refund: async (n) => {
				refundedCount += n;
				return { remaining: { images: 13 + n } };
			}
		}
	);
	/* Let Wave 1 finish (3 images), then abort 120ms into the 3-second cooldown */
	setTimeout(() => abortCtl.abort(), 120);
	await abortRes.text();
	const abortElapsed = Date.now() - abortStart;
	assert.ok(abortElapsed < 1000, "abort woke cooldown immediately without waiting 3s: " + abortElapsed + "ms");
	assert.equal(waveCalls, 3, "Wave 2 never started after abort");
	assert.equal(refundedCount, 4, "all 4 unrendered scenes refunded");
});

/* ------------------------------------------------------------------ */
/* Full Client <-> Real Worker End-to-End Integration                  */
/* ------------------------------------------------------------------ */

function bootRealWorkerStudio(env, customAudioDecode) {
	const dom = new JSDOM(createHTML(), {
		runScripts: "outside-only",
		url: "https://studio.test/free"
	});
	const w = dom.window;
	w.__PLAN_MODE = "freemium";
	w.scrollTo = () => {};
	w.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
	w.cancelAnimationFrame = (id) => clearTimeout(id);
	w.URL.createObjectURL = () => "blob:studio-test/" + Math.random().toString(36).slice(2);
	w.URL.revokeObjectURL = () => {};
	w.HTMLCanvasElement.prototype.getContext = () => ({
		fillStyle: "",
		strokeStyle: "",
		font: "",
		textAlign: "",
		textBaseline: "",
		globalAlpha: 1,
		fillRect() {},
		clearRect() {},
		drawImage() {},
		fillText() {},
		strokeText() {},
		measureText: (t) => ({ width: String(t || "").length * 7 }),
		save() {},
		restore() {},
		beginPath() {},
		arc() {},
		fill() {},
		stroke() {},
		translate() {},
		rotate() {},
		scale() {}
	});
	w.Image = class FakeImage {
		constructor() {
			this.naturalWidth = 1024;
			this.naturalHeight = 576;
		}
		decode() {
			return Promise.resolve();
		}
	};
	if (customAudioDecode) {
		w.AudioContext = customAudioDecode;
	}

	/* Wire browser fetch directly into the real Cloudflare Worker entry! */
	w.fetch = async (input, init = {}) => {
		const rawUrl = typeof input === "string" ? input : input.url;
		const fullUrl = new URL(rawUrl, "https://studio.test").toString();
		const headers = new Headers(init.headers || {});
		headers.set("Cookie", "yvs_free=1");
		const req = new Request(fullUrl, {
			method: init.method || "GET",
			headers,
			body: init.body,
			signal: init.signal
		});
		const entry = worker && typeof worker.fetch === "function" ? worker : worker.default;
		return entry.fetch(req, env, { waitUntil() {} });
	};

	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	return { dom, w };
}

test("End-to-end: Quick Batch Table moves row through real Worker MP3 -> Prompts -> Images -> Done via #top-generate, sorts out-of-order scenes, and resets on script clear", async () => {
	const mp3Bytes = buildMp3WithId3(new Uint8Array([0xff, 0xfb, 0x90, 0x64]));
	/* Distinct PNG payloads so we can verify scene 0 comes before scene 1 even when scene 1 finishes first */
	const pngScene0 = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 10, 10]);
	const pngScene1 = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 20, 20]);

	const workerAiCalls = [];
	const env = {
		AI: {
			run: async (model, input) => {
				workerAiCalls.push({ model, input });
				if (model === "@cf/myshell-ai/melotts") {
					return { audio: bytesToBase64(mp3Bytes) };
				}
				if (model.includes("llama")) {
					return {
						response: {
							prompts: [
								"Scene ZERO opening aerial over misty pine valley.\n\nGolden sunrise rays.\n\nWide 24mm film frame.",
								"Scene ONE close-up of mountain stream over mossy stones.\n\nCool morning light.\n\n50mm cinema lens."
							]
						}
					};
				}
				if (model.includes("stable-diffusion")) {
					const isZero = String(input.prompt).includes("Scene ZERO");
					if (isZero) {
						/* Delay scene 0 so scene 1 streams FIRST over NDJSON! */
						await new Promise((r) => setTimeout(r, 35));
						return pngScene0;
					}
					return pngScene1;
				}
				throw new Error("Unexpected AI model: " + model);
			}
		}
	};

	const { dom, w } = bootRealWorkerStudio(env);
	test.after(() => dom.window.close());
	await new Promise((r) => setTimeout(r, 15));

	/* Switch to Quick Batch Table layout */
	w.setStudioLayout("table");
	const row = w.__BATCH_ROWS[0];
	assert.ok(row, "initial row exists");

	const tr = w.document.querySelector('[data-batch-row="' + row.id + '"]');
	const scriptEl = tr.querySelector('[data-batch-field="script"]');
	const styleEl = tr.querySelector('[data-batch-field="style"]');
	const resEl = tr.querySelector('[data-batch-field="resolution"]');
	const orientEl = tr.querySelector('[data-batch-field="orientation"]');

	/* Populate via DOM events including "change" on style <select> */
	scriptEl.value = "✨ Morning pine valley awakens! Cool streams rush over stones.";
	scriptEl.dispatchEvent(new w.Event("input", { bubbles: true }));

	styleEl.value = "Neon Night";
	styleEl.dispatchEvent(new w.Event("change", { bubbles: true }));
	assert.equal(row.style, "Neon Night", "style <select> change event updated row.style");

	resEl.value = "720";
	resEl.dispatchEvent(new w.Event("change", { bubbles: true }));
	orientEl.value = "portrait";
	orientEl.dispatchEvent(new w.Event("change", { bubbles: true }));

	assert.match(w.document.getElementById("top-generate").textContent, /Generate \(1\)/);

	/* Trigger generation from the top-bar #top-generate button while in Table layout! */
	w.document.getElementById("top-generate").click();

	const finished = await waitFor(() => w.batchRowFinished(row), 5000);
	assert.equal(finished, true, "row completed MP3 -> Prompts -> Images -> Animate -> Done");
	assert.equal(row.stage, "done");
	assert.ok(row.mp3 && row.mp3.size > 0, "MP3 blob created");
	assert.equal(row.prompts.length, 2, "2 prompts generated");
	assert.equal(row.images.length, 2, "2 images generated");

	/* Verify Scene 0 was NOT overwritten to index 2 by `Number(0) || images.length` and sorted first! */
	assert.equal(row.images[0].index, 0);
	assert.equal(row.images[1].index, 1);
	const firstBytes = new Uint8Array(await row.images[0].blob.arrayBuffer());
	assert.deepEqual([...firstBytes], [...pngScene0], "Scene 0 must play before Scene 1");

	/* Both Preview and Export buttons are live in the row */
	assert.ok(tr.querySelector('[data-batch-action="preview"]'));
	assert.ok(tr.querySelector('[data-batch-action="export"]'));

	/* RULE 25: Clearing a finished row's script resets it so a new script is runnable anew! */
	scriptEl.value = "";
	scriptEl.dispatchEvent(new w.Event("input", { bubbles: true }));
	assert.equal(row.stage, "empty");
	assert.equal(w.batchRowFinished(row), false);
	assert.equal(tr.querySelector('[data-batch-action="preview"]'), null, "Preview resets to pending text");

	scriptEl.value = "A brand new script ready for another run.";
	scriptEl.dispatchEvent(new w.Event("input", { bubbles: true }));
	assert.equal(row.stage, "ready");
	assert.equal(w.batchRowPending(row), true);
});

test("Stage 1 client: a hung AudioContext.decodeAudioData times out instead of stalling the row at 'timing'", async () => {
	class HungAudioContext {
		constructor() {
			this.state = "suspended";
		}
		resume() {
			return new Promise(() => {});
		}
		decodeAudioData() {
			/* Never settles */
			return new Promise(() => {});
		}
	}

	const env = {
		AI: {
			run: async (model) => {
				if (model === "@cf/myshell-ai/melotts") {
					return { audio: bytesToBase64(buildMp3WithId3(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))) };
				}
				return PNG_BYTES;
			}
		}
	};

	/* Patch BATCH_AUDIO_DECODE_MS down to 40ms in the evaluated bundle so the test runs fast */
	const fastJs = APP_JS.replace("__PROMPTS_JSON__", "[]").replace(
		/const BATCH_AUDIO_DECODE_MS =\s*15000;/,
		"const BATCH_AUDIO_DECODE_MS = 40;"
	);
	const dom = new JSDOM(createHTML(), {
		runScripts: "outside-only",
		url: "https://studio.test/free"
	});
	const w = dom.window;
	w.AudioContext = HungAudioContext;
	w.scrollTo = () => {};
	w.URL.createObjectURL = () => "blob:test/1";
	w.URL.revokeObjectURL = () => {};
	w.Image = class {
		decode() {
			return Promise.resolve();
		}
	};
	w.fetch = async (url) => {
		const path = String(url);
		if (path.endsWith("/api/voiceover")) {
			return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
				status: 200,
				headers: { "Content-Type": "audio/mpeg" }
			});
		}
		if (path.endsWith("/api/image-prompts")) {
			return new Response(JSON.stringify({ success: true, prompts: ["Scene A"] }), {
				status: 200,
				headers: { "Content-Type": "application/json" }
			});
		}
		const line =
			JSON.stringify({ type: "image", index: 0, ok: true, mime: "image/png", data: bytesToBase64(PNG_BYTES) }) +
			"\n" +
			JSON.stringify({ type: "done", generated: 1, failed: 0 }) +
			"\n";
		return new Response(line, {
			status: 200,
			headers: { "Content-Type": "application/x-ndjson" }
		});
	};
	w.eval(fastJs);
	test.after(() => dom.window.close());

	const row = w.__BATCH_ROWS[0];
	row.script = "Test narration with hung WebAudio.";
	row.stage = "ready";

	await w.runBatchRow(row);
	assert.equal(w.batchRowFinished(row), true, "row advanced past hung AudioContext.decodeAudioData");
	assert.equal(row.stage, "done");
});

test("Stage 3 client: stopBatchRows() cancels an in-flight NDJSON /api/image-batch stream immediately", async () => {
	let streamCancelled = false;
	const dom = new JSDOM(createHTML(), {
		runScripts: "outside-only",
		url: "https://studio.test/free"
	});
	const w = dom.window;
	w.scrollTo = () => {};
	w.URL.createObjectURL = () => "blob:test/stop";
	w.URL.revokeObjectURL = () => {};
	w.Image = class {
		decode() {
			return Promise.resolve();
		}
	};
	w.fetch = async (url) => {
		const path = String(url);
		if (path.endsWith("/api/voiceover")) {
			return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
				status: 200,
				headers: { "Content-Type": "audio/mpeg" }
			});
		}
		if (path.endsWith("/api/image-prompts")) {
			return new Response(JSON.stringify({ success: true, prompts: ["Scene 1", "Scene 2"] }), {
				status: 200,
				headers: { "Content-Type": "application/json" }
			});
		}
		/* Open NDJSON stream that sends `start` and then waits until cancelled */
		let sentStart = false;
		let unblockRead = null;
		return {
			ok: true,
			status: 200,
			headers: { get: () => "application/x-ndjson" },
			body: {
				getReader: () => ({
					read: async () => {
						if (!sentStart) {
							sentStart = true;
							return {
								done: false,
								value: new TextEncoder().encode(JSON.stringify({ type: "start", count: 2 }) + "\n")
							};
						}
						return new Promise((resolve) => {
							unblockRead = () => resolve({ done: true });
						});
					},
					cancel: async () => {
						streamCancelled = true;
						if (unblockRead) unblockRead();
					}
				})
			}
		};
	};
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	test.after(() => dom.window.close());

	const row = w.__BATCH_ROWS[0];
	row.script = "Stream stop test narration.";
	row.stage = "ready";

	const runPromise = w.generateBatchRows();
	const enteredImages = await waitFor(() => row.stage === "images", 3000);
	assert.equal(enteredImages, true, "row entered images stage");

	w.stopBatchRows();
	await runPromise;

	assert.equal(streamCancelled, true, "NDJSON stream reader.cancel() was called immediately on Stop");
	assert.equal(row.stage, "ready");
	assert.equal(row.error, "");
});

/* ------------------------------------------------------------------ */
/* Node.js-Style Event-Driven Non-Blocking Image Task Queue & Pool    */
/* ------------------------------------------------------------------ */

test("Server ImageTaskQueue: non-blocking burst scheduling, fair round-robin across rows, zero head-of-line blocking, and cooperative CPU yielding", async () => {
	const queue = new ImageTaskQueue({
		maxGlobalConcurrency: 6,
		maxGroupConcurrency: 3,
		groupWindowLimit: 3,
		groupWindowMs: 120,
		minCooldownMs: 20
	});

	let activeGlobal = 0;
	let peakGlobal = 0;
	const activeByGroup = { A: 0, B: 0, C: 0, D: 0 };
	const peakByGroup = { A: 0, B: 0, C: 0, D: 0 };
	const dispatchOrder = [];

	/* Submit 24 image tasks across 4 groups in one tight synchronous burst */
	const enqueueStarted = Date.now();
	const promises = [];
	for (const groupId of ["A", "B", "C", "D"]) {
		for (let i = 0; i < 6; i++) {
			promises.push(
				queue.enqueue({
					groupId,
					execute: async () => {
						dispatchOrder.push(groupId + ":" + i);
						activeGlobal++;
						activeByGroup[groupId]++;
						if (activeGlobal > peakGlobal) peakGlobal = activeGlobal;
						if (activeByGroup[groupId] > peakByGroup[groupId]) {
							peakByGroup[groupId] = activeByGroup[groupId];
						}
						/* Make A:0 slow (220ms) to verify zero head-of-line blocking for A:3 & A:4! */
						const ioMs = groupId === "A" && i === 0 ? 220 : 15;
						await new Promise((r) => setTimeout(r, ioMs));
						activeByGroup[groupId]--;
						activeGlobal--;
						return groupId + "-" + i;
					}
				})
			);
		}
	}
	const syncEnqueueMs = Date.now() - enqueueStarted;
	assert.ok(syncEnqueueMs < 25, "enqueueing 24 tasks is non-blocking on main thread: " + syncEnqueueMs + "ms");

	/* Fair round-robin: the very first 4 dispatched tasks serve A, B, C, D in turn */
	const results = await Promise.all(promises);
	assert.equal(results.length, 24);
	assert.deepEqual(
		dispatchOrder.slice(0, 4).map((x) => x.split(":")[0]),
		["A", "B", "C", "D"],
		"round-robin serves every active video/row without starvation"
	);
	assert.ok(peakGlobal <= 6, "respects maxGlobalConcurrency = 6 (got " + peakGlobal + ")");
	for (const g of ["A", "B", "C", "D"]) {
		assert.ok(peakByGroup[g] <= 3, "respects maxGroupConcurrency = 3 for " + g);
	}

	/* Verify EventLoopCpuSerializer yields to timers/I/O between consecutive CPU tasks */
	const cpu = new EventLoopCpuSerializer();
	const timeline = [];
	setTimeout(() => timeline.push("timer-interleaved"), 0);
	await Promise.all([
		cpu.run(() => timeline.push("cpu-1")),
		cpu.run(() => timeline.push("cpu-2")),
		cpu.run(() => timeline.push("cpu-3"))
	]);
	assert.equal(timeline[0], "cpu-1");
	assert.ok(
		timeline.indexOf("timer-interleaved") > timeline.indexOf("cpu-1") &&
			timeline.indexOf("timer-interleaved") < timeline.indexOf("cpu-3"),
		"event-loop timer interleaved cleanly between serialized CPU steps: " + timeline.join(" -> ")
	);
});

test("Client __IMAGE_TASK_RUNTIME: offloads large base64 decodes to Web Worker thread pool and falls back to non-blocking event-loop chunks", async () => {
	/* Build a 24 KB binary image (> 16 KB base64 Worker threshold) */
	const bigBytes = new Uint8Array(24576);
	bigBytes.set(PNG_BYTES, 0);
	for (let i = PNG_BYTES.length; i < bigBytes.length; i++) {
		bigBytes[i] = (i * 31) & 0xff;
	}
	const bigBase64 = "data:image/png;base64,\n" + bytesToBase64(bigBytes);

	/* 1. With Web Worker thread pool available: executes real inline worker script in vm */
	let workerMessagesHandled = 0;
	const workerBlobs = new Map();
	let blobSeq = 0;

	const domWithWorker = new JSDOM(createHTML(), {
		runScripts: "outside-only",
		url: "https://studio.test/free"
	});
	const w1 = domWithWorker.window;
	w1.scrollTo = () => {};
	w1.fetch = async () => new Response("{}", { status: 200 });
	w1.URL.createObjectURL = (blob) => {
		const url = "blob:worker-script-" + ++blobSeq;
		workerBlobs.set(url, blob);
		return url;
	};
	w1.URL.revokeObjectURL = () => {};
	w1.Worker = class MockThreadWorker {
		constructor(scriptUrl) {
			this.onmessage = null;
			this.onerror = null;
			this._blob = workerBlobs.get(scriptUrl);
		}
		postMessage(msg) {
			Promise.resolve().then(async () => {
				try {
					const code = await this._blob.text();
					const workerSelf = {
						onmessage: null,
						atob: (s) => Buffer.from(s, "base64").toString("binary"),
						Uint8Array,
						String,
						postMessage: (reply) => {
							workerMessagesHandled++;
							if (this.onmessage) this.onmessage({ data: reply });
						}
					};
					vm.runInNewContext(code, {
						self: workerSelf,
						atob: workerSelf.atob,
						Uint8Array,
						String
					});
					workerSelf.onmessage({ data: msg });
				} catch (err) {
					if (this.onerror) this.onerror(err);
				}
			});
		}
	};
	w1.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	test.after(() => domWithWorker.window.close());

	const decodedPoolBlobs = await Promise.all([
		w1.__IMAGE_TASK_RUNTIME.decodeBase64ImageOffThread(bigBase64, "image/png"),
		w1.__IMAGE_TASK_RUNTIME.decodeBase64ImageOffThread(bigBase64, "image/png"),
		w1.__IMAGE_TASK_RUNTIME.decodeBase64ImageOffThread(bigBase64, "image/png"),
		w1.__IMAGE_TASK_RUNTIME.decodeBase64ImageOffThread(bigBase64, "image/png")
	]);
	assert.equal(workerMessagesHandled, 4, "all 4 large images decoded on background Worker pool");
	const firstDecoded = new Uint8Array(await decodedPoolBlobs[0].arrayBuffer());
	assert.equal(firstDecoded.byteLength, bigBytes.byteLength);
	assert.deepEqual([...firstDecoded.subarray(0, 32)], [...bigBytes.subarray(0, 32)]);

	/* 2. Without Worker (chunked 64 KB non-blocking event-loop fallback on >64KB payload) */
	const domNoWorker = new JSDOM(createHTML(), {
		runScripts: "outside-only",
		url: "https://studio.test/free"
	});
	const w2 = domNoWorker.window;
	w2.scrollTo = () => {};
	w2.fetch = async () => new Response("{}", { status: 200 });
	w2.URL.createObjectURL = () => "blob:no-worker";
	w2.URL.revokeObjectURL = () => {};
	w2.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	test.after(() => domNoWorker.window.close());

	const hugeBytes = new Uint8Array(70000);
	hugeBytes.set(PNG_BYTES, 0);
	for (let i = PNG_BYTES.length; i < hugeBytes.length; i++) hugeBytes[i] = (i * 17) & 0xff;
	const fallbackBlob = await w2.__IMAGE_TASK_RUNTIME.decodeBase64ImageOffThread(
		bytesToBase64(hugeBytes),
		"image/png"
	);
	const fallbackDecoded = new Uint8Array(await fallbackBlob.arrayBuffer());
	assert.equal(fallbackDecoded.byteLength, hugeBytes.byteLength);
	assert.deepEqual([...fallbackDecoded.subarray(0, 32)], [...hugeBytes.subarray(0, 32)]);

	/* 3. Client createEventDrivenTaskQueue round-robin + cancelMatching */
	const cq = w2.__IMAGE_TASK_RUNTIME.createEventDrivenTaskQueue(2);
	const seen = [];
	const p1 = cq.enqueue("v1", async () => {
		seen.push("v1-a");
		await new Promise((r) => setTimeout(r, 25));
	});
	const p2 = cq.enqueue("v2", async () => {
		seen.push("v2-a");
		await new Promise((r) => setTimeout(r, 25));
	});
	const pCancelled = cq.enqueue(
		"v1",
		async () => {
			seen.push("v1-cancelled-should-not-run");
		},
		{ meta: { kind: "drop" } }
	);
	await new Promise((r) => setTimeout(r, 5));
	cq.cancelMatching((m) => m && m.kind === "drop");
	await assert.rejects(pCancelled, /stopped|aborted/i);
	await Promise.all([p1, p2]);
	assert.deepEqual(seen, ["v1-a", "v2-a"]);
});


