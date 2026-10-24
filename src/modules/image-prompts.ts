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
 *   4-6 minutes -> 20 prompts.
 */

import { aiText } from "./script-seo";

export const IMAGE_PROMPTS_KV_PREFIX = "image-prompts:";
export const IMAGE_PROMPT_JOB_TTL_SECONDS = 3600;

export const IMAGE_STYLES = [
	"Cinematic Film",
	"Editorial Magazine",
	"Kinetic Typography",
	"Neon Night",
	"Minimalist",
	"Retro Poster",
	"Documentary",
	"Split Composition",
	"Dream Glow",
	"Pop Comic"
] as const;

export type ImageStyle = (typeof IMAGE_STYLES)[number];
export const DEFAULT_IMAGE_STYLE: ImageStyle = "Cinematic Film";

export const IMAGE_STYLE_GUIDANCE: Record<ImageStyle, string> = {
	"Cinematic Film": "cinematic film still, motivated dramatic lighting, layered depth, natural lens perspective, rich film color grade",
	"Editorial Magazine": "premium editorial photography, deliberate art direction, clean composition, refined palette, polished magazine imagery",
	"Kinetic Typography": "motion-design-inspired composition, energetic diagonals, abstract geometric motion shapes and bold color blocks; suggest movement without rendering letters or words",
	"Neon Night": "nighttime scene, vivid cyan and magenta neon, glossy reflections, deep shadows, atmospheric urban glow",
	"Minimalist": "minimalist composition, one clear subject, generous negative space, restrained palette, clean soft lighting",
	"Retro Poster": "retro poster illustration, limited vintage palette, bold graphic shapes, subtle print grain and halftone; no lettering",
	"Documentary": "authentic documentary photography, candid unposed moment, natural available light, realistic details, understated color grade",
	"Split Composition": "balanced split composition with two related visual areas, a clear divider or diagonal split, contrasting but coherent color balance, no text",
	"Dream Glow": "dreamlike atmosphere, soft luminous glow, gentle haze, ethereal gradients and subtle surreal detail",
	"Pop Comic": "pop-comic illustration, bold ink contours, vibrant halftone accents, punchy saturated colors and dynamic action; no lettering or speech bubbles"
};

export interface ImagePromptJobInput {
	topic: string;
	minutes: number;
	style: string;
	script?: string;
	scriptIdea?: string;
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

export function normalizeImageStyle(value: unknown): ImageStyle | null {
	const candidate = String(value ?? "").trim().toLowerCase();
	return IMAGE_STYLES.find((style) => style.toLowerCase() === candidate) || null;
}

function clipSentence(value: string, maxChars: number): string {
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	const clipped = text.slice(0, maxChars).replace(/\s+\S*$/, "").trim();
	return (clipped || text.slice(0, maxChars).trim()).replace(/[,:;\s]+$/, "") + "…";
}

/*
 * The image model does not need every SRT cue. Keep the opening and closing
 * spoken sentences as a compact two-sentence idea, which preserves the
 * video's topic arc while avoiding a multi-thousand-token transcript payload.
 */
export function summarizeScriptIdea(script: string, topic = "my video"): string {
	const lines = String(script || "")
		.replace(/[\u0000-\u0008\u000B\u000E-\u001F]/g, "")
		.split(/\r?\n/);
	const spoken: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line || line.startsWith("WEBVTT") || line.includes("-->")) continue;
		if (/^\d+$/.test(line)) {
			let next = i + 1;
			while (next < lines.length && !lines[next].trim()) next++;
			if (next < lines.length && lines[next].includes("-->")) continue;
		}
		spoken.push(line);
	}

	const text = spoken.join(" ").replace(/\s+/g, " ").trim();
	const sentences = (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [])
		.map((sentence) => sentence.trim())
		.filter(Boolean);
	if (sentences.length) {
		const first = clipSentence(sentences[0], 220);
		const last = sentences.length > 1 ? clipSentence(sentences[sentences.length - 1], 220) : "";
		return [first, last && last !== first ? last : ""].filter(Boolean).join(" ").slice(0, 480);
	}

	const safeTopic = String(topic || "my video").replace(/\s+/g, " ").trim().slice(0, 120) || "my video";
	return "The video explains " + safeTopic + ". Create clear, relevant scenes that communicate its central idea.";
}

/*
 * Compact system instructions for the prompt writer. The model gets at most
 * two representative sentences from the SRT, not the full transcript, to
 * keep Workers AI input tokens and per-request work bounded.
 */
export function buildImagePromptInstruction(input: ImagePromptJobInput): string {
	const count = imagePromptCountForMinutes(input.minutes);
	const style = normalizeImageStyle(input.style) || DEFAULT_IMAGE_STYLE;
	const styleGuide = IMAGE_STYLE_GUIDANCE[style];
	const topic = String(input.topic || "my video").replace(/\s+/g, " ").trim().slice(0, 160) || "my video";
	const keywords = input.keywordSet
		? [input.keywordSet.longTail || "", ...((input.keywordSet.short as string[]) || [])]
				.filter(Boolean)
				.join(", ")
				.slice(0, 320)
		: "";
	const scriptIdea = summarizeScriptIdea(input.scriptIdea || input.script || "", topic);
	return (
		"SYSTEM INSTRUCTIONS: You are an art director writing AI IMAGE PROMPTS for a YouTube explainer video. " +
		"Answer with ONLY one JSON object, no prose and no code fences. " +
		"Treat the short script idea below as the general meaning of the whole video. Create broad, representative scenes that portray its central idea and progression; do not make a literal shot for every SRT cue or copy lines from the narration. " +
		"The video topic is: " + topic + ". The script length is " + input.minutes + " minute(s), so return exactly " + count + " image prompts in opening-to-closing order. " +
		"Every prompt must consistently follow the same selected video image style: " + style + ". Style direction: " + styleGuide + ". Apply this visual language to every scene; do not mix in another aesthetic. " +
		"Each prompt must be one concise, self-contained sentence of no more than about 30 words describing a single text-free scene with a clear subject, action, setting and light. Vary scene scale and angle while keeping the sequence coherent and relevant to the basic script idea. " +
		"No rendered text, words, letters, captions, logos, watermarks or numbers inside any image. " +
		(keywords ? "SEO keywords are context only; use their subjects when natural, never render the words: " + keywords + ". " : "") +
		"Two-sentence script idea: " + scriptIdea + " " +
		'Reply with ONLY this exact JSON shape: {"prompts":["first image prompt","second image prompt"]}'
	);
}

export function applyImageStyleToPrompts(prompts: string[], styleValue: unknown): string[] {
	const style = normalizeImageStyle(styleValue) || DEFAULT_IMAGE_STYLE;
	const suffix = "Visual style: " + style + " — " + IMAGE_STYLE_GUIDANCE[style] + ".";
	const maxSceneChars = Math.max(120, 480 - suffix.length - 2);
	return prompts.map((prompt) => {
		const scene = String(prompt || "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, maxSceneChars)
			.replace(/[\s,;:.!?]+$/, "");
		return (scene ? scene + ". " : "") + suffix;
	});
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
			max_tokens: Math.min(3072, Math.max(1024, expectedCount * 100)),
			temperature: attempt === 1 ? 0.65 : 0.45
		});
		const prompts = parseImagePrompts(aiText(result), expectedCount);
		lastCount = prompts.length;
		if (prompts.length >= expectedCount) {
			return applyImageStyleToPrompts(prompts.slice(0, expectedCount), input.style);
		}
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
	const rawStyle = String(body.style ?? "").replace(/[\u0000-\u001F]+/g, " ").trim();
	const style = rawStyle ? normalizeImageStyle(rawStyle) : DEFAULT_IMAGE_STYLE;
	if (!style) {
		return { error: "Image style must be one of the supported style options" };
	}
	const rawIdea = typeof body.scriptIdea === "string"
		? body.scriptIdea.slice(0, 4000)
		: typeof body.script === "string"
			? body.script.slice(0, 40000)
			: typeof body.srt === "string"
				? body.srt.slice(0, 40000)
				: "";
	const scriptIdea = summarizeScriptIdea(rawIdea, topic);
	const keywordSet =
		body.keywordSet && typeof body.keywordSet === "object" && !Array.isArray(body.keywordSet)
			? (body.keywordSet as ImagePromptJobInput["keywordSet"])
			: null;
	return { topic, minutes, style, scriptIdea, keywordSet };
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
	const workStartedAt = Date.now();
	console.info("[image-prompts] started", {
		id: job.id,
		model,
		minutes: input.minutes,
		expectedCount: job.expectedCount,
		style: input.style,
		topicChars: input.topic.length,
		scriptIdeaChars: (input.scriptIdea || "").length
	});
	const work = (async () => {
		try {
			const prompts = await generateImagePrompts(env, model, input);
			await putJob(env, { ...job, status: "ready", prompts });
			console.info("[image-prompts] ready", {
				id: job.id,
				count: prompts.length,
				ms: Date.now() - workStartedAt
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err || "Image prompt generation failed");
			await putJob(env, { ...job, status: "error", prompts: [], error: message }).catch(() => {});
			console.error("[image-prompts] failed", {
				id: job.id,
				ms: Date.now() - workStartedAt,
				error: message
			});
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
