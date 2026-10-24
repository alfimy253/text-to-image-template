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

export const IMAGE_MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";

/* A video gallery holds 25 stills; no batch may exceed the 20-prompt maximum. */
export const IMAGE_BATCH_MAX_PROMPTS = 20;

/* Images rendered in parallel inside one request. */
export const IMAGE_BATCH_CONCURRENCY = 4;

/* Attempts per image (1 try + 1 retry) before the scene is reported failed. */
export const IMAGE_BATCH_ATTEMPTS = 2;

/* Per-attempt ceiling. SDXL usually answers in 3-12 s. */
export const IMAGE_ATTEMPT_TIMEOUT_MS = 75000;

/* 16:9 - the studio's gallery cards, preview and export are all landscape. */
export const IMAGE_WIDTH = 1024;
export const IMAGE_HEIGHT = 576;

/* The model is text-free by design; the negative prompt keeps it that way. */
export const IMAGE_NEGATIVE_PROMPT =
	"text, words, letters, writing, script, kanji, Chinese characters, Japanese characters, hiragana, katakana, CJK characters, subtitles, captions, signs, billboards, logos, watermarks, typography, numbers";

/* How long one prompt LLM call may take before the batch gives up. */
export const IMAGE_PROMPT_TIMEOUT_MS = 90000;

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
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode.apply(
			null,
			Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]
		);
	}
	return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/*
 * `env.AI.run()` answers a text-to-image model with a ReadableStream of image
 * bytes; some models (and older runtime versions) answer an ArrayBuffer, a
 * base64 string or `{ image: "<base64>" }` instead. Accept all of them so a
 * runtime change can never turn into "the image route is broken".
 */
async function toImageBytes(result: unknown): Promise<Uint8Array | null> {
	if (!result) return null;
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
	const maybe = result as { image?: unknown };
	if (maybe && typeof maybe.image === "string") {
		try {
			return base64ToBytes(maybe.image);
		} catch {
			return null;
		}
	}
	return null;
}

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
	options: { width?: number; height?: number; seed?: number } = {}
): Promise<ImageModelResult> {
	if (!env || !env.AI) throw new Error("AI binding not configured");
	const input: Record<string, unknown> = {
		prompt,
		negative_prompt: IMAGE_NEGATIVE_PROMPT,
		width: options.width || IMAGE_WIDTH,
		height: options.height || IMAGE_HEIGHT,
		num_steps: 20
	};
	if (typeof options.seed === "number") input.seed = options.seed;
	const raw = await env.AI.run(IMAGE_MODEL, input);
	const bytes = await toImageBytes(raw);
	if (!bytes || !bytes.length) throw new Error("The image model returned an empty image");
	/* A PNG starts with the 8-byte signature; anything else is not usable. */
	const isPng =
		bytes.length > 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47;
	return { bytes, mime: isPng ? "image/png" : "image/jpeg" };
}

/* Sanitises one prompt the same way for every entry point. */
export function normalizeBatchPrompt(value: unknown): string {
	return String(value ?? "")
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 600);
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

async function generateOneWithRetry(
	env: AiEnv,
	prompt: string
): Promise<{ ok: true; result: ImageModelResult } | { ok: false; error: string }> {
	let lastError = "Image generation failed";
	for (let attempt = 1; attempt <= IMAGE_BATCH_ATTEMPTS; attempt++) {
		try {
			const result = await withTimeout(
				runImageModel(env, prompt, { seed: Math.floor(Math.random() * 2147483647) }),
				IMAGE_ATTEMPT_TIMEOUT_MS,
				"Image generation"
			);
			return { ok: true, result };
		} catch (error) {
			lastError = errorMessage(error);
			if (attempt < IMAGE_BATCH_ATTEMPTS) {
				await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
			}
		}
	}
	return { ok: false, error: lastError };
}

/*
 * POST /api/image-batch
 *
 * Validates the prompt list, reserves credits, then streams the images as
 * they finish. Every failure is reported per scene and refunded, so a partial
 * batch still produces a clear result for the browser.
 */
export async function handleImageBatch(
	request: Request,
	env: AiEnv,
	credits: ImageCreditHooks
): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	if (!env || !env.AI) {
		return json({ success: false, error: "AI binding not configured", prompts: [] }, 503);
	}
	const sanitized = sanitizePrompts(body.prompts);
	if ("error" in sanitized) {
		return json({ success: false, error: sanitized.error }, 400);
	}

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
	let writeChain: Promise<void> = Promise.resolve();

	/* One serialised writer for every event, so parallel renders can't interleave. */
	const emit = (event: unknown): Promise<void> => {
		writeChain = writeChain.then(async () => {
			if (closed) return;
			try {
				await writer.write(encoder.encode(JSON.stringify(event) + "\n"));
			} catch {
				closed = true;
			}
		});
		return writeChain;
	};

	const startedAt = Date.now();
	console.info("[image-batch] started", {
		requested,
		count,
		available: reservation.granted,
		concurrency: IMAGE_BATCH_CONCURRENCY,
		promptChars: prompts.reduce((total, prompt) => total + prompt.length, 0)
	});

	const work = (async () => {
		let generated = 0;
		let failed = 0;
		let summary = reservation.summary;
		let nextIndex = 0;

		await emit({
			type: "start",
			requested,
			count,
			concurrency: Math.min(IMAGE_BATCH_CONCURRENCY, count),
			width: IMAGE_WIDTH,
			height: IMAGE_HEIGHT,
			model: IMAGE_MODEL,
			credits: summary
		});

		/* Keep the connection from looking idle while the first renders run. */
		const heartbeat = setInterval(() => {
			void emit({ type: "tick", at: Date.now() });
		}, 10000);

		const stopped = () => closed || Boolean(request.signal && request.signal.aborted);

		const workerLoop = async () => {
			while (!stopped()) {
				const index = nextIndex++;
				if (index >= count) return;
				const outcome = await generateOneWithRetry(env, prompts[index]);
				if (stopped()) return;
				if (outcome.ok) {
					generated++;
					await emit({
						type: "image",
						index,
						ok: true,
						mime: outcome.result.mime,
						data: bytesToBase64(outcome.result.bytes),
						bytes: outcome.result.bytes.length
					});
				} else {
					failed++;
					await emit({ type: "image", index, ok: false, error: outcome.error });
				}
			}
		};

		try {
			const lanes = Math.max(1, Math.min(IMAGE_BATCH_CONCURRENCY, count));
			const lanesDone: Promise<void>[] = [];
			for (let lane = 0; lane < lanes; lane++) lanesDone.push(workerLoop());
			await Promise.all(lanesDone);
		} catch (error) {
			const message = errorMessage(error);
			failed = Math.max(failed, count - generated - failed);
			await emit({ type: "error", error: message });
			console.error("[image-batch] failed", { requested, count, generated, failed, error: message });
		} finally {
			clearInterval(heartbeat);
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
			try {
				await writer.close();
			} catch {
				/* already closed by the client */
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
