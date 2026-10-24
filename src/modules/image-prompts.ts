/*
 * AI image-prompt jobs (`src/modules/image-prompts.ts`)
 *
 * Implements the dynamic image-prompt URL used by the video accordion's
 * SEO walkthrough:
 *
 *   POST   /api/image-prompts        create a job -> {id, url, prompts: []}
 *   GET    /api/image-prompts/<id>   poll -> {status, prompts: []} while the
 *                                    LLM is still working, then the full set
 *   DELETE /api/image-prompts/<id>   destroy the URL once every generated
 *                                    image has landed in the gallery
 *
 * Creation returns immediately with an empty prompt list. The actual LLM
 * call runs in the background (`ctx.waitUntil` when the worker runtime
 * provides it, otherwise a fire-and-forget promise inside the isolate) and
 * writes the finished prompts back to the same job record, so a poll that
 * arrives early simply sees `prompts: []` / `status: "pending"`.
 *
 * Job records live in KV (`image-prompts:<id>`, 1 h TTL) when the
 * KV_BINDING namespace is bound, matching every other job/blob store in
 * this worker. Without KV (local tests / e2e fixture, which call
 * `worker.fetch(request, env)` with no binding) an in-isolate Map is used
 * so the same routes keep working; records there live only as long as the
 * isolate does, which is all a single polling browser session needs.
 *
 * Prompt counts by script length (the script length is chosen by the
 * client before the topic is submitted; it defaults to 1 minute):
 *   1 minute -> 10 prompts, 2-3 minutes -> 14 prompts,
 *   4-5 minutes -> 20 prompts (6 minutes, the UI maximum, also uses 20).
 */

import { aiText } from "./script-seo";

export const IMAGE_PROMPTS_KV_PREFIX = "image-prompts:";
export const IMAGE_PROMPT_JOB_TTL_SECONDS = 3600;

export interface ImagePromptJobInput {
	topic: string;
	minutes: number;
	style: string;
	script?: string;
	keywordSet?: { longTail?: string; short?: string[]; title?: string } | null;
}

export interface ImagePromptJob {
	id: string;
	status: "pending" | "ready" | "error";
	prompts: string[];
	expectedCount: number;
	topic: string;
	minutes: number;
	style: string;
	createdAt: number;
	error?: string;
}

type AiEnv = {
	AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
	KV_BINDING?: {
		get: (key: string) => Promise<string | null>;
		put: (key: string, value: string, options?: Record<string, unknown>) => Promise<void>;
		delete: (key: string) => Promise<void>;
	};
};

export function imagePromptCountForMinutes(minutes: number): number {
	const m = Number(minutes);
	if (!Number.isFinite(m) || m <= 1) return 10;
	if (m <= 3) return 14;
	return 20;
}

/*
 * The LLM instruction for the image-prompt set. The count comes from the
 * script length, every prompt must carry the user's video image style, and
 * every prompt must stay text-free because /image/gen also forces a
 * text-free negative prompt.
 */
export function buildImagePromptInstruction(input: ImagePromptJobInput): string {
	const count = imagePromptCountForMinutes(input.minutes);
	const style = String(input.style || "").trim() || "cinematic photorealistic";
	const keywords = input.keywordSet
		? [input.keywordSet.longTail || "", ...((input.keywordSet.short as string[]) || [])]
				.filter(Boolean)
				.join(", ")
		: "";
	const scriptExcerpt = String(input.script || "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 4000);
	return (
		"You are an art director writing AI IMAGE PROMPTS for a YouTube explainer video. " +
		"Answer with ONLY one JSON object, no prose and no code fences. " +
		"The video topic is: " + input.topic + ". " +
		"The video script is " + input.minutes + " minute(s) long, so write exactly " + count + " image prompts. " +
		"Every image must use this video image style: " + style + ". " +
		"Write the prompts in script order so the images follow the narration from the opening scene to the closing scene, one distinct scene per prompt, with varied subjects, settings and camera angles (wide, medium and close-up). " +
		"Each prompt is one self-contained sentence describing a single text-free visual scene: subject, setting, action, lighting and mood, ending with the image style above. " +
		"No text, words, letters, captions, logos, watermarks or numbers inside any image. " +
		(keywords ? "Weave these SEO keywords' subjects into the scenes where natural: " + keywords + ". " : "") +
		(scriptExcerpt ? "The script (SRT, in order) is: " + scriptExcerpt + " " : "") +
		'Reply with ONLY this exact JSON shape: {"prompts":["first image prompt","second image prompt"]}'
	);
}

/*
 * Parses the model's reply into a clean prompt list. Accepts a JSON object
 * ({"prompts":[...]}), a bare JSON array, or — as a rescue — a numbered /
 * bulleted plain-text list. Prompts are trimmed, de-numbered and capped.
 */
export function parseImagePrompts(text: string, expectedCount: number): string[] {
	const raw = String(text || "").trim();
	let list: unknown[] = [];
	if (raw) {
		let jsonText = raw;
		if (jsonText.indexOf("```") !== -1) {
			const parts = jsonText.split("```");
			for (let i = 1; i < parts.length; i += 2) {
				if (parts[i] && (parts[i].indexOf("[") !== -1 || parts[i].indexOf("{") !== -1)) {
					jsonText = parts[i].replace(/^[a-zA-Z0-9_-]+\s*\r?\n/, "").trim();
					break;
				}
			}
		}
		const objStart = jsonText.indexOf("{");
		const arrStart = jsonText.indexOf("[");
		try {
			if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
				const parsed = JSON.parse(jsonText.slice(arrStart, jsonText.lastIndexOf("]") + 1));
				if (Array.isArray(parsed)) list = parsed;
			} else if (objStart !== -1) {
				const parsed = JSON.parse(jsonText.slice(objStart, jsonText.lastIndexOf("}") + 1)) as Record<string, unknown>;
				if (Array.isArray(parsed.prompts)) list = parsed.prompts;
				else if (Array.isArray(parsed.images)) list = parsed.images;
			}
		} catch {
			list = [];
		}
		if (!list.length) {
			list = raw
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line.length > 3 && line.indexOf("-->") === -1);
		}
	}
	const prompts: string[] = [];
	for (const entry of list) {
		const cleaned = String(entry || "")
			.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
			.replace(/^["']|["'],?$/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 500);
		if (cleaned && prompts.indexOf(cleaned) === -1) prompts.push(cleaned);
		if (prompts.length >= expectedCount) break;
	}
	return prompts;
}

/*
 * Runs the instruct model until it returns exactly `expectedCount` usable
 * prompts (max 3 attempts; a short reply is retried with the deficit
 * spelled out, an over-long reply is truncated by parseImagePrompts).
 */
export async function generateImagePrompts(
	env: AiEnv,
	model: string,
	input: ImagePromptJobInput
): Promise<string[]> {
	const expectedCount = imagePromptCountForMinutes(input.minutes);
	const basePrompt = buildImagePromptInstruction(input);
	let lastCount = 0;
	for (let attempt = 1; attempt <= 3; attempt++) {
		const prompt =
			basePrompt +
			(attempt > 1
				? " Your previous attempt returned " + lastCount + " usable image prompt(s); return exactly " + expectedCount + " prompts this time."
				: "");
		const result = await env.AI!.run(model, {
			prompt,
			max_tokens: Math.min(4096, Math.max(1024, expectedCount * 120)),
			temperature: attempt === 1 ? 0.7 : 0.45
		});
		const prompts = parseImagePrompts(aiText(result), expectedCount);
		lastCount = prompts.length;
		if (prompts.length >= expectedCount) return prompts.slice(0, expectedCount);
		if (attempt === 3 && prompts.length > 0) {
			throw new Error(
				"Image prompts incomplete (" + prompts.length + " of " + expectedCount + ") - try again"
			);
		}
	}
	throw new Error("Image prompts could not be generated - try again");
}

/* --- job store (KV when bound, in-isolate Map otherwise) ---------------- */

const memoryJobs = new Map<string, ImagePromptJob>();

async function putJob(env: AiEnv, job: ImagePromptJob): Promise<void> {
	if (env && env.KV_BINDING) {
		await env.KV_BINDING.put(IMAGE_PROMPTS_KV_PREFIX + job.id, JSON.stringify(job), {
			expirationTtl: IMAGE_PROMPT_JOB_TTL_SECONDS
		});
		return;
	}
	memoryJobs.set(job.id, job);
}

async function readJob(env: AiEnv, id: string): Promise<ImagePromptJob | null> {
	if (env && env.KV_BINDING) {
		const raw = await env.KV_BINDING.get(IMAGE_PROMPTS_KV_PREFIX + id);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as ImagePromptJob;
		} catch {
			return null;
		}
	}
	return memoryJobs.get(id) || null;
}

async function deleteJob(env: AiEnv, id: string): Promise<void> {
	if (env && env.KV_BINDING) {
		await env.KV_BINDING.delete(IMAGE_PROMPTS_KV_PREFIX + id);
		return;
	}
	memoryJobs.delete(id);
}

function jobJson(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
	});
}

function makeJobId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sanitizeJobInput(body: Record<string, unknown>): ImagePromptJobInput | { error: string } {
	const topic = String(body.topic ?? "")
		.replace(/[\u0000-\u001F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 160) || "my video";
	const rawMinutes = body.minutes;
	const minutes =
		typeof rawMinutes === "boolean" || Array.isArray(rawMinutes)
			? NaN
			: Number(rawMinutes === undefined || rawMinutes === null || rawMinutes === "" ? 1 : rawMinutes);
	if (!Number.isInteger(minutes) || minutes < 1 || minutes > 6) {
		return { error: "Minutes must be 1-6" };
	}
	const style = String(body.style ?? "")
		.replace(/[\u0000-\u001F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300) || "cinematic photorealistic, rich detail";
	const script = typeof body.script === "string" ? body.script : typeof body.srt === "string" ? body.srt : "";
	const keywordSet =
		body.keywordSet && typeof body.keywordSet === "object" && !Array.isArray(body.keywordSet)
			? (body.keywordSet as ImagePromptJobInput["keywordSet"])
			: null;
	return { topic, minutes, style, script, keywordSet };
}

/*
 * POST /api/image-prompts — validates, stores a `pending` job with an
 * empty prompt array, schedules the LLM work in the background and
 * answers 202 with the dynamic poll URL right away.
 */
export async function handleCreateImagePromptJob(
	request: Request,
	env: AiEnv,
	ctx: { waitUntil?: (promise: Promise<unknown>) => void } | undefined,
	model: string
): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	if (!env || !env.AI) {
		return jobJson({ success: false, error: "AI binding not configured", prompts: [] }, 503);
	}
	const input = sanitizeJobInput(body);
	if ("error" in input) {
		return jobJson({ success: false, error: input.error, prompts: [] }, 400);
	}
	const job: ImagePromptJob = {
		id: makeJobId(),
		status: "pending",
		prompts: [],
		expectedCount: imagePromptCountForMinutes(input.minutes),
		topic: input.topic,
		minutes: input.minutes,
		style: input.style,
		createdAt: Date.now()
	};
	await putJob(env, job);
	const work = (async () => {
		try {
			const prompts = await generateImagePrompts(env, model, input);
			await putJob(env, { ...job, status: "ready", prompts });
			console.log("[image-prompts] ready", { id: job.id, count: prompts.length });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err || "Image prompt generation failed");
			await putJob(env, { ...job, status: "error", prompts: [], error: message }).catch(() => {});
			console.error("[image-prompts] failed", { id: job.id, error: message });
		}
	})();
	if (ctx && typeof ctx.waitUntil === "function") {
		ctx.waitUntil(work);
	}
	/* No execution context (tests, e2e): the promise keeps running in the
	 * isolate and the client's 30 s poll sees the finished record. */
	return jobJson(
		{
			success: true,
			id: job.id,
			url: "/api/image-prompts/" + job.id,
			status: job.status,
			prompts: [] as string[],
			expectedCount: job.expectedCount,
			style: job.style,
			minutes: job.minutes
		},
		202
	);
}

/* GET /api/image-prompts/<id> — the poll target. Pending jobs answer an
 * empty prompt array; destroyed/unknown ids answer 404. */
export async function handleGetImagePromptJob(env: AiEnv, id: string): Promise<Response> {
	const job = await readJob(env, id);
	if (!job) {
		return jobJson({ success: false, error: "Image prompt URL not found or already destroyed", prompts: [] }, 404);
	}
	return jobJson({
		success: true,
		id: job.id,
		status: job.status,
		prompts: job.status === "ready" ? job.prompts : [],
		expectedCount: job.expectedCount,
		style: job.style,
		minutes: job.minutes,
		...(job.status === "error" ? { error: job.error || "Image prompt generation failed" } : {})
	});
}

/* DELETE /api/image-prompts/<id> — destroys the dynamic URL. Idempotent:
 * deleting an already-destroyed URL still succeeds. */
export async function handleDestroyImagePromptJob(env: AiEnv, id: string): Promise<Response> {
	await deleteJob(env, id);
	return jobJson({ success: true, id, destroyed: true, prompts: [] });
}
