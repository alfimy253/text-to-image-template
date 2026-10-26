/*
 * Batched AI image generation (`src/modules/image-batch.ts`)
 *
 * One request renders EVERY prompted image for a video, instead of the old
 * "one image per GET /image/gen, spaced 20 s apart" queue.
 *
 *   POST /api/image-batch   { prompts: string[] }  ->  application/x-ndjson
 *
 * The response is a stream of newline-delimited JSON events, written as each
 * image finishes (the images are generated in parallel, IMAGE_BATCH_CONCURRENCY
 * at a time, so the user sees the gallery fill up "all at once"):
 *
 *   {"type":"start","requested":10,"count":10,"credits":{...},"model":"..."}
 *   {"type":"tick","at":1699...}                                  keep-alive
 *   {"type":"image","index":0,"ok":true,"mime":"image/png","data":"<base64>"}
 *   {"type":"image","index":3,"ok":false,"error":"..."}           failed scene
 *   {"type":"done","requested":10,"count":10,"generated":9,"failed":1,"credits":{...}}
 *
 * Why a stream instead of one JSON body: a 1024x576 PNG is ~1 MB, so ten of
 * them base64-encoded would be a >13 MB document the worker has to buffer.
 * Streaming releases each image as soon as it exists and keeps the invocation
 * alive for as long as the batch runs (a plain awaited request would hit the
 * worker response limits long before the 20th image).
 *
 * Credits are consumed once per requested image *before* the batch starts
 * (caller-supplied hooks, so account vs guest stays in `src/index.ts`) and
 * refunded for every image that fails.
 */

import {
	EventLoopCpuSerializer,
	ImageTaskQueue,
	sharedImageTaskQueue,
	DEFAULT_GLOBAL_IMAGE_CONCURRENCY
} from "./image-queue";

export { ImageTaskQueue, sharedImageTaskQueue, DEFAULT_GLOBAL_IMAGE_CONCURRENCY };

export const IMAGE_MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";

/* A video gallery holds 25 stills; no batch may exceed the 20-prompt maximum. */
export const IMAGE_BATCH_MAX_PROMPTS = 20;

/*
 * Paced wave generation per video/row: render at most 3 images per 3-second
 * window (`IMAGE_BATCH_CONCURRENCY = 3` every `IMAGE_BATCH_WAVE_INTERVAL_MS = 3000` ms,
 * with at least `IMAGE_BATCH_MIN_COOLDOWN_MS` of breathing room between waves)
 * so neither the Worker isolate nor the browser decoder suffers CPU spikes.
 */
export const IMAGE_BATCH_CONCURRENCY = 3;
export const IMAGE_BATCH_WAVE_INTERVAL_MS = 3000;
export const IMAGE_BATCH_MIN_COOLDOWN_MS = 250;

/* Classifier-free guidance scale for 20-step SDXL base style & anatomy adherence. */
export const IMAGE_GUIDANCE_SCALE = 7.5;

/* Attempts per image (1 try + 1 retry) before the scene is reported failed. */
export const IMAGE_BATCH_ATTEMPTS = 2;

/* Per-attempt ceiling. SDXL usually answers in 3-12 s. */
export const IMAGE_ATTEMPT_TIMEOUT_MS = 75000;

/* 16:9 - the studio's gallery cards, preview and export are all landscape. */
export const IMAGE_WIDTH = 1024;
export const IMAGE_HEIGHT = 576;

/*
 * Session #211 — the quick-batch table's Resolution and Orientation columns.
 *
 * The studio used to render every AI image at one fixed 1024x576 frame. A row
 * can now ask for its own frame, and the choice travels with the prompt list:
 *
 *   resolution  = the LONG edge in pixels (480 / 540 / 720 / 1024)
 *   orientation = "square" (1:1) | "landscape" (16:9) | "portrait" (9:16)
 *
 * SDXL only accepts multiples of 8, so the short edge is rounded to one. The
 * long edge is echoed back unchanged (480, 720 and 1024 already are), which
 * keeps the column labels honest: 480px really renders a 480px long edge.
 */
export const IMAGE_RESOLUTIONS = [480, 540, 720, 1024] as const;
export const IMAGE_ORIENTATIONS = ["square", "landscape", "portrait"] as const;
export const IMAGE_DEFAULT_RESOLUTION = 1024;
export const IMAGE_DEFAULT_ORIENTATION = "landscape";

export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export type ImageOrientation = (typeof IMAGE_ORIENTATIONS)[number];

export interface ImageFrame {
	resolution: ImageResolution;
	orientation: ImageOrientation;
	width: number;
	height: number;
}

/* The smallest edge SDXL renders predictably. */
const IMAGE_MIN_EDGE = 256;

function roundTo8(value: number): number {
	return Math.max(IMAGE_MIN_EDGE, Math.round(value / 8) * 8);
}

/* "720", 720 or "720px" -> 720; anything outside the list -> null. */
export function normalizeImageResolution(value: unknown): ImageResolution | null {
	const raw = String(value ?? "").trim().toLowerCase().replace(/px$/, "");
	if (!raw) return null;
	const size = Number(raw);
	if (!Number.isFinite(size)) return null;
	const rounded = Math.round(size);
	return (IMAGE_RESOLUTIONS as readonly number[]).indexOf(rounded) === -1
		? null
		: (rounded as ImageResolution);
}

export function normalizeImageOrientation(value: unknown): ImageOrientation | null {
	const raw = String(value ?? "").trim().toLowerCase();
	return IMAGE_ORIENTATIONS.find((entry) => entry === raw) || null;
}

/* resolution + orientation -> the exact pixels to ask SDXL for. */
export function imageFrameFor(
	resolutionValue: unknown,
	orientationValue: unknown
): ImageFrame {
	const resolution = normalizeImageResolution(resolutionValue) || IMAGE_DEFAULT_RESOLUTION;
	const orientation = normalizeImageOrientation(orientationValue) || IMAGE_DEFAULT_ORIENTATION;
	const long = roundTo8(resolution);
	if (orientation === "square") {
		return { resolution, orientation, width: long, height: long };
	}
	const short = roundTo8((resolution * 9) / 16);
	return orientation === "portrait"
		? { resolution, orientation, width: short, height: long }
		: { resolution, orientation, width: long, height: short };
}

/*
 * Validates the optional body fields of POST /api/image-batch. Absent fields
 * keep the historical 1024x576 landscape frame; a field that is present but
 * invalid is a 400, so a typo can never silently render the wrong size.
 */
export function sanitizeImageFrame(body: Record<string, unknown>): ImageFrame | { error: string } {
	const rawResolution = body ? body.resolution : undefined;
	const rawOrientation = body ? body.orientation : undefined;
	const hasResolution = rawResolution !== undefined && rawResolution !== null && rawResolution !== "";
	const hasOrientation = rawOrientation !== undefined && rawOrientation !== null && rawOrientation !== "";
	if (hasResolution && !normalizeImageResolution(rawResolution)) {
		return { error: "Resolution must be one of " + IMAGE_RESOLUTIONS.join(", ") + " (pixels, long edge)" };
	}
	if (hasOrientation && !normalizeImageOrientation(rawOrientation)) {
		return { error: "Orientation must be one of " + IMAGE_ORIENTATIONS.join(", ") };
	}
	return imageFrameFor(rawResolution, rawOrientation);
}

/*
 * The model is text-free by design and guarded against anatomical, perspective,
 * and structural distortion; the negative prompt reinforces both constraints.
 */
export const IMAGE_NEGATIVE_PROMPT =
	"text, words, letters, writing, script, kanji, Chinese characters, Japanese characters, hiragana, katakana, CJK characters, subtitles, captions, signs, billboards, logos, watermarks, typography, numbers, " +
	"distorted, deformed, disfigured, bad anatomy, bad proportions, malformed limbs, extra limbs, missing limbs, fused limbs, floating limbs, extra fingers, fused fingers, too many fingers, mutated hands, poorly drawn hands, poorly drawn face, asymmetrical eyes, cross-eyed, duplicate faces, cloned body, twisted torso, warped perspective, bent architecture, melted objects, blurry, out of focus, jpeg artifacts, lowres, cropped, worst quality";

/*
 * How long one prompt LLM call may take before the batch gives up. The writer
 * now produces three rich paragraphs per scene, so this is roughly double the
 * one-sentence budget and stays under the browser's own request timeout.
 */
export const IMAGE_PROMPT_TIMEOUT_MS = 150000;

type AiEnv = {
	AI?: {
		run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
	};
};

export interface ImageModelResult {
	bytes: Uint8Array;
	mime: string;
}

export interface ImageCreditHooks {
	/*
	 * Reserves up to `amount` image credits. `granted` may be smaller than
	 * `amount` when the daily allowance runs out mid-batch (the batch then
	 * renders only what was granted); `allowed: false` means none at all.
	 */
	consume: (amount: number) => Promise<{
		allowed: boolean;
		granted: number;
		summary?: any;
		error?: string;
	}>;
	/* Returns unused credits for images that failed to render. */
	refund: (amount: number) => Promise<any>;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
	});
}

/* --- byte <-> base64 (no Buffer / atob dependency assumptions) ---------- */

export function bytesToBase64(bytes: Uint8Array): string {
	const native = bytes as unknown as { toBase64?: () => string };
	if (typeof native.toBase64 === "function") {
		return native.toBase64();
	}
	const globalBuf = (globalThis as unknown as {
		Buffer?: {
			from: (buf: ArrayBufferLike, offset: number, length: number) => {
				toString: (enc: string) => string;
			};
		};
	}).Buffer;
	if (globalBuf && typeof globalBuf.from === "function") {
		return globalBuf
			.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			.toString("base64");
	}
	const parts: string[] = [];
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		parts.push(
			String.fromCharCode.apply(
				null,
				bytes.subarray(i, i + chunk) as unknown as number[]
			)
		);
	}
	return btoa(parts.join(""));
}

export function base64ToBytes(value: string): Uint8Array {
	const cleaned = String(value || "")
		.replace(/^data:[^;]+;base64,/i, "")
		.replace(/\s+/g, "");
	if (!cleaned) return new Uint8Array(0);
	const u8Ctor = Uint8Array as unknown as {
		fromBase64?: (input: string) => Uint8Array;
	};
	if (typeof u8Ctor.fromBase64 === "function") {
		return u8Ctor.fromBase64(cleaned);
	}
	const globalBuf = (globalThis as unknown as {
		Buffer?: { from: (input: string, enc: string) => Uint8Array };
	}).Buffer;
	if (globalBuf && typeof globalBuf.from === "function") {
		const buf = globalBuf.from(cleaned, "base64");
		return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
	}
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function readStreamToBytes(stream: {
	getReader: () => {
		read: () => Promise<{ done: boolean; value?: Uint8Array }>;
	};
}): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value && value.byteLength) {
			const view =
				value instanceof Uint8Array
					? value
					: new Uint8Array(
							(value as ArrayBufferView).buffer,
							(value as ArrayBufferView).byteOffset,
							(value as ArrayBufferView).byteLength
						);
			chunks.push(view);
			total += view.byteLength;
		}
	}
	if (chunks.length === 1) return chunks[0];
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		merged.set(c, offset);
		offset += c.byteLength;
	}
	return merged;
}

/*
 * `env.AI.run()` answers a text-to-image model with a ReadableStream of image
 * bytes; some models (and older runtime versions) answer an ArrayBuffer, a
 * base64 string or `{ image: "<base64>" }` instead. Accept all of them so a
 * runtime change can never turn into "the image route is broken".
 */
async function toImageBytes(result: unknown): Promise<Uint8Array | null> {
	if (!result) return null;
	if (result instanceof Uint8Array) return result;
	if (typeof result === "string") {
		try {
			return base64ToBytes(result);
		} catch {
			return null;
		}
	}
	if (result instanceof ArrayBuffer) return new Uint8Array(result);
	if (ArrayBuffer.isView(result)) {
		const view = result as ArrayBufferView;
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}
	if (typeof Response !== "undefined" && result instanceof Response) {
		return new Uint8Array(await result.arrayBuffer());
	}
	if (typeof ReadableStream !== "undefined" && result instanceof ReadableStream) {
		const merged = await new Response(result).arrayBuffer();
		return new Uint8Array(merged);
	}
	if (
		typeof result === "object" &&
		typeof (result as { getReader?: unknown }).getReader === "function"
	) {
		return readStreamToBytes(
			result as {
				getReader: () => {
					read: () => Promise<{ done: boolean; value?: Uint8Array }>;
				};
			}
		);
	}
	if (
		typeof result === "object" &&
		typeof (result as { arrayBuffer?: unknown }).arrayBuffer === "function"
	) {
		return new Uint8Array(
			await (result as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer()
		);
	}
	const maybe = result as {
		image?: unknown;
		data?: unknown;
		result?: { image?: unknown };
	};
	if (maybe && typeof maybe.image === "string") {
		try {
			return base64ToBytes(maybe.image);
		} catch {
			return null;
		}
	}
	if (maybe && maybe.image && typeof maybe.image === "object") {
		return toImageBytes(maybe.image);
	}
	if (maybe && typeof maybe.data === "string") {
		try {
			return base64ToBytes(maybe.data);
		} catch {
			return null;
		}
	}
	if (maybe && maybe.result && typeof maybe.result === "object") {
		return toImageBytes(maybe.result);
	}
	return null;
}

function detectImageMime(bytes: Uint8Array): string | null {
	if (!bytes || bytes.byteLength < 4) return null;
	/* PNG: 89 50 4E 47 */
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return "image/png";
	}
	/* JPEG: FF D8 FF */
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	/* WebP: RIFF....WEBP */
	if (
		bytes.byteLength >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "image/webp";
	}
	/* GIF: GIF87a / GIF89a */
	if (
		bytes.byteLength >= 6 &&
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38
	) {
		return "image/gif";
	}
	/* Reject obvious text/HTML/JSON error bodies */
	if (bytes[0] === 0x3c || bytes[0] === 0x7b || bytes[0] === 0x5b) {
		return null;
	}
	return "image/png";
}

/*
 * Aligned with `IMAGE_PROMPT_MAX_CHARS = 1800` (comfortably below SDXL's
 * 2048-char schema cap). Condense multi-paragraph prompts onto single-spaced
 * prose <= 1800 chars while preserving the closing `Visual style:` directive
 * when trimming is needed.
 */
export const IMAGE_MODEL_PROMPT_MAX_CHARS = 1800;

export function condensePromptForModel(
	prompt: string,
	maxChars = IMAGE_MODEL_PROMPT_MAX_CHARS
): string {
	const flat = String(prompt || "")
		.replace(/\s+/g, " ")
		.trim();
	if (flat.length <= maxChars) return flat;

	const styleIdx = flat.lastIndexOf("Visual style:");
	if (styleIdx > 0) {
		const styleTail = flat.slice(styleIdx).trim();
		if (styleTail.length < maxChars - 120) {
			const headBudget = maxChars - styleTail.length - 2;
			return flat.slice(0, headBudget).trimEnd() + ". " + styleTail;
		}
	}
	return flat.slice(0, maxChars).trimEnd();
}

/*
 * SDXL's VAE (8x) + 3 UNet downsample blocks require dimensions divisible by 64
 * (and >= 512) to avoid odd-latent skip-connection tensor mismatches (3043) on
 * sub-1024 frames such as 720x408, 544x304 or 480x272.
 */
export function sdxlSafeDimensions(
	width: number,
	height: number
): { width: number; height: number } {
	if (
		width >= 512 &&
		height >= 512 &&
		width % 64 === 0 &&
		height % 64 === 0
	) {
		return { width, height };
	}
	if (width > height) return { width: 1024, height: 576 };
	if (height > width) return { width: 576, height: 1024 };
	return { width: 1024, height: 1024 };
}

export const IMAGE_FALLBACK_MODELS: readonly string[] = [
	"@cf/bytedance/stable-diffusion-xl-lightning",
	"@cf/black-forest-labs/flux-1-schnell"
];

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(label + " timed out after " + Math.round(ms / 1000) + " s"));
		}, ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return String(error || "Image generation failed");
}

/*
 * One model call. Shared by the batch route and the single-image
 * `/image/gen` route so both always use the same 16:9 size and guard rails.
 */
export async function runImageModel(
	env: AiEnv,
	prompt: string,
	options: {
		width?: number;
		height?: number;
		seed?: number;
		fallbackModels?: readonly string[];
		signal?: AbortSignal;
	} = {}
): Promise<ImageModelResult> {
	if (!env || !env.AI) throw new Error("AI binding not configured");
	const reqWidth = options.width || IMAGE_WIDTH;
	const reqHeight = options.height || IMAGE_HEIGHT;
	const modelPrompt = condensePromptForModel(prompt, IMAGE_MODEL_PROMPT_MAX_CHARS);

	const decodeValidated = async (raw: unknown): Promise<ImageModelResult> => {
		const bytes = await toImageBytes(raw);
		if (!bytes || !bytes.length) {
			throw new Error("The image model returned an empty image");
		}
		const mime = detectImageMime(bytes);
		if (!mime) {
			throw new Error("The image model returned non-image bytes (" + bytes.byteLength + " B)");
		}
		return { bytes, mime };
	};

	const buildSdxlInput = (
		w: number,
		h: number,
		steps: number,
		guidance?: number
	): Record<string, unknown> => {
		const input: Record<string, unknown> = {
			prompt: modelPrompt,
			negative_prompt: IMAGE_NEGATIVE_PROMPT,
			width: w,
			height: h,
			num_steps: steps
		};
		if (typeof guidance === "number") input.guidance = guidance;
		if (typeof options.seed === "number") input.seed = options.seed;
		return input;
	};

	const checkAbort = () => { if (options.signal?.aborted) throw createBatchAbortError(); };
	checkAbort();
	let primaryError: unknown = null;
	try {
		const raw = await env.AI.run(
			IMAGE_MODEL,
			buildSdxlInput(reqWidth, reqHeight, 20, IMAGE_GUIDANCE_SCALE)
		);
		return await decodeValidated(raw);
	} catch (err) {
		primaryError = err;
	}

	checkAbort();
	const safeDims = sdxlSafeDimensions(reqWidth, reqHeight);
	if (safeDims.width !== reqWidth || safeDims.height !== reqHeight) {
		try {
			const raw = await env.AI.run(
				IMAGE_MODEL,
				buildSdxlInput(safeDims.width, safeDims.height, 20, IMAGE_GUIDANCE_SCALE)
			);
			return await decodeValidated(raw);
		} catch (alignedErr) {
			primaryError = primaryError || alignedErr;
		}
	}

	const fallbacks =
		options.fallbackModels === undefined
			? IMAGE_FALLBACK_MODELS
			: options.fallbackModels;

	for (const fbSlug of fallbacks) {
		checkAbort();
		if (!fbSlug || fbSlug === IMAGE_MODEL) continue;
		try {
			const fbInput: Record<string, unknown> =
				fbSlug === "@cf/black-forest-labs/flux-1-schnell"
					? {
							prompt: condensePromptForModel(
								modelPrompt +
									" Strictly follow the specified visual style with coherent perspective, natural proportions, intact anatomy, crisp undistorted forms, and no text, words, letters, or watermarks.",
								IMAGE_MODEL_PROMPT_MAX_CHARS
							),
							steps: 4
						}
					: buildSdxlInput(safeDims.width, safeDims.height, 4);
			const raw = await env.AI.run(fbSlug, fbInput);
			return await decodeValidated(raw);
		} catch {
			/* Keep primaryError as the authoritative error if all fallbacks fail. */
		}
	}

	throw primaryError instanceof Error
		? primaryError
		: new Error(errorMessage(primaryError));
}

/*
 * One batch prompt sent to SDXL. The studio's scene prompts are three-paragraph
 * descriptions, so paragraph breaks are kept (the image model reads them as
 * sentence boundaries) while everything else is normalised to single spaces.
 */
export const IMAGE_PROMPT_MAX_CHARS = 1800;

export function normalizeBatchPrompt(value: unknown): string {
	return String(value ?? "")
		.replace(/\r\n/g, "\n")
		.replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]+/g, " ")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
		.slice(0, IMAGE_PROMPT_MAX_CHARS);
}

function sanitizePrompts(raw: unknown): string[] | { error: string } {
	if (!Array.isArray(raw)) return { error: "prompts must be an array of strings" };
	const prompts: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== "string") return { error: "prompts must be an array of strings" };
		const prompt = normalizeBatchPrompt(entry);
		if (prompt && prompts.indexOf(prompt) === -1) prompts.push(prompt);
	}
	if (!prompts.length) return { error: "prompts must contain at least one prompt" };
	if (prompts.length > IMAGE_BATCH_MAX_PROMPTS) {
		return { error: "A batch may contain at most " + IMAGE_BATCH_MAX_PROMPTS + " prompts" };
	}
	return prompts;
}

function createBatchAbortError(): Error {
	const err = new Error("Image batch aborted");
	err.name = "AbortError";
	return err;
}

function abortableRetryDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal && signal.aborted) {
		return Promise.reject(createBatchAbortError());
	}
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		let cleanup: (() => void) | null = null;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			if (cleanup) cleanup();
			resolve();
		}, ms);
		if (signal && typeof signal.addEventListener === "function") {
			const onAbort = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				cleanup = null;
				reject(createBatchAbortError());
			};
			signal.addEventListener("abort", onAbort, { once: true });
			cleanup = () => {
				signal.removeEventListener("abort", onAbort);
			};
		}
	});
}

async function generateOneWithRetry(
	env: AiEnv,
	prompt: string,
	frame?: ImageFrame,
	signal?: AbortSignal
): Promise<{ ok: true; result: ImageModelResult } | { ok: false; error: string }> {
	let lastError = "Image generation failed";
	for (let attempt = 1; attempt <= IMAGE_BATCH_ATTEMPTS; attempt++) {
		if (signal && signal.aborted) {
			throw createBatchAbortError();
		}
		try {
			const result = await withTimeout(
				runImageModel(env, prompt, {
					signal,
					seed: Math.floor(Math.random() * 2147483647),
					/* The row's own Resolution + Orientation columns. */
					width: frame ? frame.width : IMAGE_WIDTH,
					height: frame ? frame.height : IMAGE_HEIGHT
				}),
				IMAGE_ATTEMPT_TIMEOUT_MS,
				"Image generation"
			);
			return { ok: true, result };
		} catch (error) {
			if (
				(signal && signal.aborted) ||
				(error && (error as Error).name === "AbortError")
			) {
				throw createBatchAbortError();
			}
			lastError = errorMessage(error);
			if (attempt < IMAGE_BATCH_ATTEMPTS) {
				await abortableRetryDelay(500 * attempt, signal);
			}
		}
	}
	return { ok: false, error: lastError };
}

let batchGroupSequence = 0;

export interface ImageBatchPacingOptions {
	waveIntervalMs?: number;
	minCooldownMs?: number;
	groupId?: string;
	queue?: ImageTaskQueue;
}

/*
 * Validates the prompt list, reserves credits, then schedules every scene onto
 * the Node.js-style event-driven non-blocking `ImageTaskQueue`:
 *   - All scene tasks are enqueued immediately in O(1) without blocking the JS
 *     thread or waiting on sibling stragglers.
 *   - Slow model inference (`env.AI.run`) runs off-thread in the bounded
 *     background I/O pool (`IMAGE_BATCH_CONCURRENCY = 3` per video/row at a
 *     rate of 3 images per 3 seconds, round-robin across concurrent rows).
 *   - Synchronous base64 encoding + JSON framing runs one image per event-loop
 *     turn via `taskQueue.cpu.run(...)` before streaming out.
 */
export async function handleImageBatch(
	request: Request,
	env: AiEnv,
	credits: ImageCreditHooks,
	pacing: ImageBatchPacingOptions = {}
): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	if (!env || !env.AI) {
		return json({ success: false, error: "AI binding not configured", prompts: [] }, 503);
	}
	const sanitized = sanitizePrompts(body.prompts);
	if ("error" in sanitized) {
		return json({ success: false, error: sanitized.error }, 400);
	}

	/*
	 * The optional frame fields (Session #211). Absent = the historical
	 * 1024x576 landscape frame, so every existing caller keeps working.
	 */
	const frameInput = sanitizeImageFrame(body);
	if ("error" in frameInput) {
		return json({ success: false, error: frameInput.error }, 400);
	}
	const frame = frameInput;

	const requested = sanitized.length;
	const reservation = await credits.consume(requested);
	if (!reservation.allowed || reservation.granted <= 0) {
		return json(
			{
				success: false,
				error:
					reservation.error ||
					"Daily image credits are exhausted. Credits renew at midnight (UTC+8).",
				credits: reservation.summary,
				prompts: []
			},
			429
		);
	}

	const prompts = sanitized.slice(0, reservation.granted);
	const count = prompts.length;
	const encoder = new TextEncoder();
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();
	let closed = false;
	let writeBusy = false;
	let writeChain: Promise<void> = Promise.resolve();

	const stopController = new AbortController();
	let abortListenerAttached = false;
	const forwardAbort = () => {
		try {
			stopController.abort();
		} catch {
			/* ignore */
		}
	};
	if (request.signal && typeof request.signal.addEventListener === "function") {
		if (request.signal.aborted) {
			forwardAbort();
		} else {
			request.signal.addEventListener("abort", forwardAbort, { once: true });
			abortListenerAttached = true;
		}
	}

	const hasCustomTiming =
		typeof pacing.waveIntervalMs === "number" || typeof pacing.minCooldownMs === "number";
	const waveIntervalMs =
		typeof pacing.waveIntervalMs === "number" && Number.isFinite(pacing.waveIntervalMs)
			? Math.max(0, Math.floor(pacing.waveIntervalMs))
			: IMAGE_BATCH_WAVE_INTERVAL_MS;
	const minCooldownMs =
		typeof pacing.minCooldownMs === "number" && Number.isFinite(pacing.minCooldownMs)
			? Math.max(0, Math.floor(pacing.minCooldownMs))
			: IMAGE_BATCH_MIN_COOLDOWN_MS;

	const taskQueue =
		pacing.queue ||
		(hasCustomTiming
			? new ImageTaskQueue({
					maxGlobalConcurrency: DEFAULT_GLOBAL_IMAGE_CONCURRENCY,
					maxGroupConcurrency: IMAGE_BATCH_CONCURRENCY,
					groupWindowLimit: IMAGE_BATCH_CONCURRENCY,
					groupWindowMs: waveIntervalMs,
					minCooldownMs
				})
			: sharedImageTaskQueue);

	/* Per-request CPU serializer so `setTimeout(..., 0)` yields stay in this request's IoContext. */
	const cpuSerializer = new EventLoopCpuSerializer();

	/*
	 * One serialised writer for every event, so parallel renders can't interleave.
	 * Resolves `true` ONLY when `writer.write` succeeded so undelivered images are
	 * never billed if the stream closes mid-write.
	 */
	const emitRawLine = (line: string): Promise<boolean> => {
		const op = writeChain.then(async () => {
			if (closed) return false;
			writeBusy = true;
			let drainTimer: ReturnType<typeof setTimeout> | null = null;
			let abortWatchHandler: (() => void) | null = null;
			try {
				const writePromise = writer.write(encoder.encode(line));
				writePromise.catch(() => {});

				const stallGuard = new Promise<"stalled">((resolve) => {
					const armDrainWatchdog = () => {
						if (drainTimer) return;
						drainTimer = setTimeout(() => {
							drainTimer = null;
							resolve("stalled");
						}, 200);
					};
					if (stopController.signal.aborted) {
						armDrainWatchdog();
					} else {
						abortWatchHandler = armDrainWatchdog;
						stopController.signal.addEventListener("abort", armDrainWatchdog, {
							once: true
						});
					}
				});

				const outcome = await Promise.race([
					writePromise.then(() => "written" as const),
					stallGuard
				]);
				if (outcome === "stalled") {
					closed = true;
					try {
						void writer.abort(new Error("Client stream stalled after abort")).catch(() => {});
					} catch {
						/* ignore */
					}
					return false;
				}
				return true;
			} catch {
				closed = true;
				forwardAbort();
				return false;
			} finally {
				if (drainTimer) clearTimeout(drainTimer);
				if (abortWatchHandler) {
					stopController.signal.removeEventListener("abort", abortWatchHandler);
				}
				writeBusy = false;
			}
		});
		writeChain = op.then(
			() => undefined,
			() => undefined
		);
		return op;
	};
	const emit = (event: unknown): Promise<boolean> =>
		emitRawLine(JSON.stringify(event) + "\n");

	const startedAt = Date.now();
	const groupId = pacing.groupId || "batch-" + startedAt + "-" + ++batchGroupSequence;

	console.info("[image-batch] started", {
		groupId,
		requested,
		count,
		available: reservation.granted,
		concurrency: IMAGE_BATCH_CONCURRENCY,
		waveIntervalMs,
		resolution: frame.resolution,
		orientation: frame.orientation,
		width: frame.width,
		height: frame.height,
		promptChars: prompts.reduce((total, prompt) => total + prompt.length, 0)
	});

	const work = (async () => {
		let generated = 0;
		let failed = 0;
		let summary = reservation.summary;

		await emit({
			type: "start",
			requested,
			count,
			concurrency: Math.min(IMAGE_BATCH_CONCURRENCY, count),
			waveIntervalMs,
			width: frame.width,
			height: frame.height,
			resolution: frame.resolution,
			orientation: frame.orientation,
			model: IMAGE_MODEL,
			credits: summary
		});

		const stopped = () => closed || stopController.signal.aborted;

		/* Keep the connection from looking idle while queued tasks or rate windows run. */
		const heartbeat = setInterval(() => {
			if (stopped()) {
				clearInterval(heartbeat);
				return;
			}
			if (!writeBusy) {
				void emit({ type: "tick", at: Date.now() });
			}
		}, 10000);

		try {
			/*
			 * Non-blocking submission: register all `count` scene tasks on the
			 * event-driven queue immediately; each settles independently as its
			 * background I/O slot completes.
			 */
			const sceneJobs: Promise<void>[] = [];
			for (let sceneIndex = 0; sceneIndex < count; sceneIndex++) {
				const job = taskQueue
					.enqueue({
						groupId,
						signal: stopController.signal,
						execute: () =>
							generateOneWithRetry(
								env,
								prompts[sceneIndex],
								frame,
								stopController.signal
							)
					})
					.then(
						async (outcome) => {
							if (stopped()) return;
							if (outcome.ok) {
								const result = outcome.result;
								const line = await cpuSerializer.run(
									() =>
										JSON.stringify({
											type: "image",
											index: sceneIndex,
											ok: true,
											mime: result.mime,
											data: bytesToBase64(result.bytes),
											bytes: result.bytes.length
										}) + "\n"
								);
								if (await emitRawLine(line)) {
									generated++;
								}
							} else {
								failed++;
								await emit({
									type: "image",
									index: sceneIndex,
									ok: false,
									error: outcome.error
								});
							}
						},
						(err) => {
							/* Queued tasks evicted by AbortSignal are unrendered (not failed) and refunded below. */
							if (stopped() || (err && (err as Error).name === "AbortError")) {
								return;
							}
							failed++;
							return emit({
								type: "image",
								index: sceneIndex,
								ok: false,
								error: errorMessage(err)
							}).then(() => undefined);
						}
					);
				sceneJobs.push(job);
			}

			await Promise.all(sceneJobs);
			await writeChain;
		} catch (error) {
			const message = errorMessage(error);
			failed = Math.max(failed, count - generated - failed);
			await emit({ type: "error", error: message });
			console.error("[image-batch] failed", { requested, count, generated, failed, error: message });
		} finally {
			clearInterval(heartbeat);
			if (
				abortListenerAttached &&
				request.signal &&
				typeof request.signal.removeEventListener === "function"
			) {
				try {
					request.signal.removeEventListener("abort", forwardAbort);
				} catch {
					/* ignore */
				}
			}
			/*
			 * Every granted scene that did not reach the browser (failed or
			 * never started because the client went away) is refunded in one
			 * KV write, so an interrupted batch never costs the user images.
			 */
			const unrendered = Math.max(0, count - generated - failed);
			const refundable = failed + unrendered;
			if (refundable > 0) {
				try {
					const refunded = await credits.refund(refundable);
					if (refunded) summary = refunded;
				} catch (refundError) {
					console.warn("[image-batch] refund failed", {
						refundable,
						error: errorMessage(refundError)
					});
				}
			}
			await emit({
				type: "done",
				requested,
				count,
				generated,
				failed,
				skipped: Math.max(0, requested - count),
				ms: Date.now() - startedAt,
				credits: summary
			});
			console.info("[image-batch] done", {
				requested,
				count,
				generated,
				failed,
				ms: Date.now() - startedAt
			});
			await writeChain;
			if (!closed) {
				try {
					await writer.close();
				} catch {
					/* already closed by the client */
				}
			}
		}
	})();

	/* The stream — not waitUntil — keeps the invocation alive. */
	work.catch(() => {});

	return new Response(readable, {
		status: 200,
		headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"X-Image-Batch-Count": String(count),
			"X-Image-Batch-Requested": String(requested)
		}
	});
}

/** #261: single binary image; browser owns fan-out. Never replay on transport ambiguity. */
export async function handleImageBinary(
	request: Request, env: AiEnv, credits: ImageCreditHooks
): Promise<Response> {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Expected a JSON object" }, 400);
	if (!env?.AI) return json({ error: "AI binding not configured" }, 503);
	const input = body as Record<string, unknown>;
	const prompts = sanitizePrompts([input.prompt]);
	const frame = sanitizeImageFrame(input);
	if ("error" in prompts) return json({ error: prompts.error }, 400);
	if ("error" in frame) return json({ error: frame.error }, 400);
	if (request.signal.aborted) return json({ error: "Image request cancelled" }, 499);
	let reservation;
	try { reservation = await credits.consume(1); }
	catch { return json({ error: "Credit authorization unavailable. Please retry later." }, 503); }
	if (!reservation.allowed || reservation.granted < 1) {
		return json({ error: reservation.error || "Daily image credits are exhausted", credits: reservation.summary }, 429);
	}
	try {
		const outcome = await sharedImageTaskQueue.enqueue({
			groupId: "binary-" + ++batchGroupSequence,
			signal: request.signal,
			execute: () => generateOneWithRetry(env, prompts[0], frame, request.signal)
		});
		if (!outcome.ok) throw new Error(outcome.error);
		if (request.signal.aborted) throw createBatchAbortError();
		return new Response(outcome.result.bytes as BodyInit, {
			headers: { "Content-Type": outcome.result.mime, "Cache-Control": "no-store",
				"X-Pipeline-Version": "261", "X-Image-Width": String(frame.width), "X-Image-Height": String(frame.height) }
		});
	} catch (error) {
		const summary = await credits.refund(1);
		return json({ error: request.signal.aborted ? "Image request cancelled" : errorMessage(error), credits: summary }, request.signal.aborted ? 499 : 502);
	}
}
