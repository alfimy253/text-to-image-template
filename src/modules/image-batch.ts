import { pixabaySceneImage, type PixabayEnv } from "./pixabay";
/*
 * Pixabay image import through the existing streamed/binary scene protocol.
 * No inference or image-model fallback is executed. Historical transport notes:
 * Batched image delivery (`src/modules/image-batch.ts`)
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
	DEFAULT_GLOBAL_IMAGE_CONCURRENCY,
	DEFAULT_GROUP_IMAGE_CONCURRENCY,
	DEFAULT_GROUP_WINDOW_MS
} from "./image-queue";

import {
	ImageLoadGovernor,
	ImageLoadFailureKind,
	IMAGE_LOAD_MAX_ATTEMPTS,
	classifyImageFailure,
	sharedImageLoadGovernor
} from "./image-load";

export { ImageTaskQueue, sharedImageTaskQueue, DEFAULT_GLOBAL_IMAGE_CONCURRENCY };
export {
	ImageLoadGovernor,
	sharedImageLoadGovernor,
	classifyImageFailure,
	IMAGE_LOAD_MAX_ATTEMPTS
};

export const IMAGE_MODEL = "pixabay";

/* A video gallery holds 25 stills; no batch may exceed the 20-prompt maximum. */
export const IMAGE_BATCH_MAX_PROMPTS = 20;

/*
 * ONE shared daily image ceiling for every actor (free, paid_user, guest):
 * 10,000 images/day is a fair-use ceiling, not a throttle (RULE 20/31).
 *
 * This constant lives HERE, not in `src/index.ts`: the Worker's main module
 * export map is validated by workerd whenever Durable Object bindings are
 * configured, and only functions/ExportedHandlers are accepted there. The
 * old `export const IMAGE_DAILY_LIMIT = 10000` in `index.ts` made every
 * boot fail with:
 *   TypeError: Incorrect type for map entry 'IMAGE_DAILY_LIMIT':
 *   the provided value is not of type 'function or ExportedHandler'.
 * Sub-module exports are internal after bundling, so they are unaffected.
 */
export const IMAGE_DAILY_LIMIT = 10000;

/*
 * Paced wave generation per video/row: render at most 3 images per 3-second
 * window (`IMAGE_BATCH_CONCURRENCY = 3` every `IMAGE_BATCH_WAVE_INTERVAL_MS = 3000` ms,
 * with at least `IMAGE_BATCH_MIN_COOLDOWN_MS` of breathing room between waves)
 * so neither the Worker isolate nor the browser decoder suffers CPU spikes.
 * Server load (as opposed to per-row fairness) is handled by the adaptive
 * governor in `image-load.ts`, never by widening or removing this wave.
 */
/*
 * Session #263: the per-row wave is now *derived* from the queue's own group
 * budget instead of being a second, independently editable 3. The two used to
 * be able to drift apart (server pacing 3/3 s, `IMAGE_BATCH_*` saying something
 * else), which is exactly the class of bug where a row "finishes" early.
 */
export const IMAGE_BATCH_CONCURRENCY = DEFAULT_GROUP_IMAGE_CONCURRENCY;
export const IMAGE_BATCH_WAVE_INTERVAL_MS = DEFAULT_GROUP_WINDOW_MS;
export const IMAGE_BATCH_MIN_COOLDOWN_MS = 250;

/* Classifier-free guidance scale for 20-step SDXL base style & anatomy adherence. */
export const IMAGE_GUIDANCE_SCALE = 7.5;

/*
 * Attempts per image for ordinary (non-load) failures: one try + one retry,
 * matching the historical "two bounded attempts" contract so a genuine model
 * error never multiplies paid provider calls.
 */
export const IMAGE_BATCH_ATTEMPTS = 2;

/*
 * Attempts allowed when the provider explicitly signals load (429 / 503 /
 * "capacity" / "overloaded"). Those calls usually produced no image at all, so
 * a longer, backed-off ladder is both safe and the only way a burst survives a
 * busy fleet. Fatal errors (bad model slug, rejected prompt) still stop after
 * the first attempt.
 */
export const IMAGE_OVERLOAD_ATTEMPTS = IMAGE_LOAD_MAX_ATTEMPTS;

/*
 * Total wall time one scene may spend retrying (backoff sleeps included).
 * Keeps a scene inside the browser's 165 s image deadline even when the fleet
 * is shedding load, instead of pinning a queue slot until the client gives up.
 */
export const IMAGE_RETRY_BUDGET_MS = 45000;

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

type AiEnv = PixabayEnv & {
	AI?: {
		run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
	};
};

export interface ImageModelResult {
	bytes: Uint8Array;
	mime: string;
	source?: { provider: string; id: number; pageURL: string; user: string; type?: string; duration?: number };
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

export const IMAGE_FALLBACK_MODELS: readonly string[] = [];

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
 * Compatibility entrypoint shared by binary, batch and `/image/gen`.
 * Fetches Pixabay stock bytes; requested dimensions guide orientation only.
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
		/**
		 * Load governor fed by every provider call (success widens the pool
		 * after a healthy streak, overload narrows it and starts a cooldown).
		 * Defaults to the shared isolate governor; `null` opts out.
		 */
		governor?: ImageLoadGovernor | null;
	} = {}
): Promise<ImageModelResult> {
	return pixabaySceneImage(env, prompt, options);
}

/*
 * Compatibility transport strings: either concise search terms or a validated
 * Pixabay page/index selection token. No text is sent to an image model.
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

/*
 * Retry delay when no governor is attached (opt-out / unit tests): the same
 * exponential shape without the adaptive state, honouring a provider hint.
 */
function delayFromHint(retryAfterMs: number | null, attempt: number): number {
	if (typeof retryAfterMs === "number" && retryAfterMs > 0) return retryAfterMs;
	return Math.min(8000, 500 * Math.pow(2, Math.max(0, attempt - 1)));
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

/** A scene that finally failed, with the load hint used for client backoff. */
export interface ImageSceneFailure {
	ok: false;
	error: string;
	/** `"overload"`, `"transient"` or `"fatal"`. */
	kind: ImageLoadFailureKind;
	/** How long the caller should wait before asking again (ms), or null. */
	retryAfterMs: number | null;
}

/*
 * One scene, with server-load aware retries.
 *
 * The old policy was "two attempts, 500 ms apart". That is the worst possible
 * answer to a provider shedding load: every scene in every request retries at
 * almost the same moment. Now:
 *
 *   - fatal errors (retired model slug, rejected prompt) stop immediately and
 *     never cost a second inference;
 *   - load/transient errors retry with exponential backoff + jitter
 *     (`governor.retryDelayMs`), honouring a provider `Retry-After` when given;
 *   - retries, backoff sleeps included, must fit in `IMAGE_RETRY_BUDGET_MS`,
 *     so a scene cannot pin a queue slot past the browser's own deadline;
 *   - the failure result carries `kind` + `retryAfterMs` so the HTTP layer can
 *     answer `503` + `Retry-After` (binary route) or stream the hint to the
 *     browser (batch route), which then backs off instead of hammering.
 */
async function generateOneWithRetry(
	env: AiEnv,
	prompt: string,
	frame?: ImageFrame,
	signal?: AbortSignal,
	options: { governor?: ImageLoadGovernor | null } = {}
): Promise<{ ok: true; result: ImageModelResult } | ImageSceneFailure> {
	const governor =
		options.governor === undefined ? sharedImageLoadGovernor : options.governor;
	const retryDeadline = Date.now() + IMAGE_RETRY_BUDGET_MS;
	let lastError = "Image generation failed";
	let lastKind: ImageLoadFailureKind = "transient";
	let lastRetryAfterMs: number | null = null;

	for (let attempt = 1; attempt <= IMAGE_OVERLOAD_ATTEMPTS; attempt++) {
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
					height: frame ? frame.height : IMAGE_HEIGHT,
					governor
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
			const classification = classifyImageFailure(error);
			lastError = errorMessage(error);
			lastKind = classification.kind;
			lastRetryAfterMs = classification.retryAfterMs;

			/* A prompt/model problem cannot be fixed by spending another call. */
			if (!classification.retryable) break;
			/*
			 * Load failures get the long ladder; everything else keeps the
			 * historical two-attempt budget.
			 */
			const attemptsAllowed =
				classification.kind === "overload"
					? IMAGE_OVERLOAD_ATTEMPTS
					: IMAGE_BATCH_ATTEMPTS;
			if (attempt >= attemptsAllowed) break;

			const remaining = retryDeadline - Date.now();
			if (remaining <= 0) break;

			const backoff = governor
				? governor.retryDelayMs(attempt, classification.retryAfterMs)
				: delayFromHint(classification.retryAfterMs, attempt);
			const delay = Math.min(backoff, remaining);
			if (!(delay > 0)) break;
			await abortableRetryDelay(delay, signal);
		}
	}

	if (lastKind === "overload" && !lastRetryAfterMs && governor) {
		const cooldown = governor.cooldownRemainingMs;
		if (cooldown > 0) lastRetryAfterMs = cooldown;
	}
	return {
		ok: false,
		error: lastError,
		kind: lastKind,
		retryAfterMs: lastRetryAfterMs
	};
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
	if (!env?.PIXABAY_API_KEY) {
		/*
		 * Not load: waiting cannot conjure a key. `kind: "fatal"` tells the
		 * browser this 503 must not be retried and must not be re-labelled
		 * "the image server is busy — pause and continue" (RULE 31 distinguishes
		 * declared load `kind:"overload"` + Retry-After from everything else).
		 */
		return json({ success: false, error: "Pixabay API key is not configured", kind: "fatal", prompts: [] }, 503);
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
					minCooldownMs,
					/*
					 * A per-request pacing queue still reads the shared load
					 * governor, so its own `DEFAULT_GLOBAL_IMAGE_CONCURRENCY`
					 * cannot multiply the fleet-wide ceiling.
					 */
					governor: sharedImageLoadGovernor
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
		/* Load-shedding counters, reported to the browser in `done`. */
		let overloadFailures = 0;
		let loadHintMs: number | null = null;
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
			/* Live server-load ceiling + cooldown, so the UI can explain a slow start. */
			load: sharedImageLoadGovernor.snapshot(),
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
											source: result.source,
											data: bytesToBase64(result.bytes),
											bytes: result.bytes.length
										}) + "\n"
								);
								if (await emitRawLine(line)) {
									generated++;
								}
							} else {
								failed++;
								const failure = outcome as ImageSceneFailure;
								if (failure.kind === "overload") overloadFailures++;
								const hint =
									typeof failure.retryAfterMs === "number" && failure.retryAfterMs > 0
										? failure.retryAfterMs
										: null;
								if (hint && (!loadHintMs || hint > loadHintMs)) loadHintMs = hint;
								await emit({
									type: "image",
									index: sceneIndex,
									ok: false,
									error: failure.error,
									/*
									 * The browser uses these to back off (and to show
									 * "server busy, retrying in Ns") instead of firing
									 * the next scene into an overloaded fleet.
									 */
									kind: failure.kind,
									retryAfterMs: hint
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
				overloadFailures,
				retryAfterMs: loadHintMs,
				load: sharedImageLoadGovernor.snapshot(),
				credits: summary
			});
			console.info("[image-batch] done", {
				requested,
				count,
				generated,
				failed,
				overloadFailures,
				loadLimit: sharedImageLoadGovernor.limit,
				loadCooldownMs: sharedImageLoadGovernor.cooldownRemainingMs,
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
/*
 * Failure response for one binary image.
 *
 * Load failures answer `503 Service Unavailable` with a `Retry-After` header
 * (rounded up to whole seconds) so the browser's scheduler, any proxy and the
 * user all get one honest signal: come back in N seconds. Everything else
 * stays a plain `502` with the provider message.
 */
function imageFailureResponse(
	error: string,
	kind: ImageLoadFailureKind,
	retryAfterMs: number | null,
	credits: unknown,
	governor: ImageLoadGovernor | null = sharedImageLoadGovernor
): Response {
	const overload = kind === "overload";
	const load = governor ? governor.snapshot() : null;
	const hintMs =
		typeof retryAfterMs === "number" && retryAfterMs > 0
			? retryAfterMs
			: load
				? load.cooldownRemainingMs
				: 0;
	const headers: Record<string, string> = { "Cache-Control": "no-store" };
	if (overload && hintMs > 0) {
		headers["Retry-After"] = String(Math.max(1, Math.ceil(hintMs / 1000)));
	}
	const body: Record<string, unknown> = { error, kind };
	if (overload) body.load = load;
	if (hintMs > 0) body.retryAfterMs = hintMs;
	body.credits = credits;
	return new Response(JSON.stringify(body), {
		status: overload ? 503 : kind === "fatal" ? 422 : 502,
		headers: { "Content-Type": "application/json", ...headers }
	});
}

export async function handleImageBinary(
	request: Request, env: AiEnv, credits: ImageCreditHooks
): Promise<Response> {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Expected a JSON object" }, 400);
	/*
	 * A missing provider key is a deployment problem, not fleet load: answer
	 * with `kind: "fatal"` so the browser fails fast and surfaces this exact
	 * message instead of burning three retry rounds on a 503 it mistakes for
	 * "server busy, retry in ~5 s".
	 */
	if (!env?.PIXABAY_API_KEY) return json({ error: "Pixabay API key is not configured", kind: "fatal" }, 503);
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
		if (!outcome.ok) {
			/* Refund before answering: a scene that never rendered is never billed. */
			const summary = await credits.refund(1);
			const failure = outcome as ImageSceneFailure;
			return imageFailureResponse(
				failure.error,
				failure.kind,
				failure.retryAfterMs,
				summary
			);
		}
		if (request.signal.aborted) throw createBatchAbortError();
		return new Response(outcome.result.bytes as BodyInit, {
			headers: { "Content-Type": outcome.result.mime, "Cache-Control": "no-store",
				"X-Pipeline-Version": "261", "X-Media-Provider": "pixabay", "X-Pixabay-Source": encodeURIComponent(JSON.stringify(outcome.result.source || {})), "X-Requested-Width": String(frame.width), "X-Requested-Height": String(frame.height) }
		});
	} catch (error) {
		const summary = await credits.refund(1);
		if (request.signal.aborted || (error as Error)?.name === "AbortError") {
			return json({ error: "Image request cancelled", credits: summary }, 499);
		}
		const classification = classifyImageFailure(error);
		return imageFailureResponse(
			errorMessage(error),
			classification.kind,
			classification.retryAfterMs,
			summary
		);
	}
}
