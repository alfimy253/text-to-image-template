/*
 * AI image-prompt generation (`src/modules/image-prompts.ts`)
 *
 *   POST /api/image-prompts
 *     {topic, minutes, style, script|scriptIdea, keywordSet}
 *     -> 200 {success, prompts: string[], count, expectedCount, style, minutes}
 *
 * The route is SYNCHRONOUS: the instruct model runs inside the request and the
 * finished, styled prompt list is the response body. There is no job id, no
 * background `waitUntil` work, no KV job record and no poll URL, so the
 * browser can never be left waiting on a job that was already destroyed by
 * the runtime.
 *
 * Prompt counts by script length (chosen by the client before the walkthrough,
 * defaults to 1 minute):
 *   1 minute -> 10 prompts, 2-3 minutes -> 14 prompts, 4-6 minutes -> 20 prompts
 *
 * The model is asked for exactly that many broad, representative scenes. The
 * count is a target, not a contract: if the model answers short, the missing
 * scenes are requested again; if it still answers short, the prompts it did
 * produce are used (a 12-of-14 batch is far better than "not working").
 */

import { IMAGE_PROMPT_TIMEOUT_MS } from "./image-batch";

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

export interface ImagePromptInput {
	topic: string;
	minutes: number;
	style: string;
	script?: string;
	scriptIdea?: string;
	keywordSet?: { longTail?: string; short?: string[]; title?: string } | null;
}

type AiEnv = {
	AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
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
export function buildImagePromptInstruction(
	input: ImagePromptInput,
	count = imagePromptCountForMinutes(input.minutes)
): string {
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

/* `env.AI.run()` text models answer `{response}`; tolerate a plain string. */
function aiText(result: unknown): string {
	if (!result) return "";
	if (typeof result === "string") return result;
	const value = result as { response?: unknown };
	if (typeof value.response === "string") return value.response;
	return "";
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
	return String(error || "Image prompt generation failed");
}

/*
 * Runs the instruct model until the target count is reached or the model has
 * nothing more to add. Each retry only asks for the scenes that are still
 * missing, so a short first answer does not restart the whole batch.
 */
export async function generateImagePrompts(
	env: AiEnv,
	model: string,
	input: ImagePromptInput
): Promise<string[]> {
	const expectedCount = imagePromptCountForMinutes(input.minutes);
	const collected: string[] = [];
	let lastError = "";

	for (let attempt = 1; attempt <= 3 && collected.length < expectedCount; attempt++) {
		const missing = expectedCount - collected.length;
		let prompt = buildImagePromptInstruction(input, missing);
		if (collected.length) {
			prompt +=
				" The sequence already has these prompts, do not repeat them: " +
				collected.slice(-4).join(" | ") +
				" Continue the sequence with exactly " + missing + " new prompts.";
		}
		try {
			const result = await withTimeout(
				env.AI!.run(model, {
					prompt,
					max_tokens: Math.min(3072, Math.max(512, missing * 90)),
					temperature: attempt === 1 ? 0.65 : 0.45
				}),
				IMAGE_PROMPT_TIMEOUT_MS,
				"Image prompt generation"
			);
			const parsed = parseImagePrompts(aiText(result), missing);
			for (const entry of parsed) {
				if (collected.indexOf(entry) === -1) collected.push(entry);
			}
		} catch (error) {
			lastError = errorMessage(error);
		}
	}

	if (!collected.length) {
		throw new Error(
			"Image prompts could not be generated" + (lastError ? " (" + lastError + ")" : "")
		);
	}
	return applyImageStyleToPrompts(collected.slice(0, expectedCount), input.style);
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
	});
}

function sanitizeInput(body: Record<string, unknown>): ImagePromptInput | { error: string } {
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
			? (body.keywordSet as ImagePromptInput["keywordSet"])
			: null;
	return { topic, minutes, style, scriptIdea, keywordSet };
}

/*
 * POST /api/image-prompts — validates, asks the instruct model for the scene
 * prompts and answers with the finished list. One request, one response.
 */
export async function handleGenerateImagePrompts(
	request: Request,
	env: AiEnv,
	model: string
): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	if (!env || !env.AI) {
		return json({ success: false, error: "AI binding not configured", prompts: [] }, 503);
	}
	const input = sanitizeInput(body);
	if ("error" in input) {
		return json({ success: false, error: input.error, prompts: [] }, 400);
	}

	const startedAt = Date.now();
	const expectedCount = imagePromptCountForMinutes(input.minutes);
	console.info("[image-prompts] started", {
		model,
		minutes: input.minutes,
		expectedCount,
		style: input.style,
		topicChars: input.topic.length,
		scriptIdeaChars: (input.scriptIdea || "").length
	});

	try {
		const prompts = await generateImagePrompts(env, model, input);
		console.info("[image-prompts] ready", {
			count: prompts.length,
			expectedCount,
			ms: Date.now() - startedAt
		});
		return json({
			success: true,
			prompts,
			count: prompts.length,
			expectedCount,
			style: input.style,
			minutes: input.minutes,
			model,
			ms: Date.now() - startedAt
		});
	} catch (error) {
		const message = errorMessage(error);
		console.error("[image-prompts] failed", {
			ms: Date.now() - startedAt,
			error: message
		});
		return json({ success: false, error: message, prompts: [] }, 502);
	}
}

/*
 * The dynamic poll URL is gone. Any stale browser tab that still holds one
 * gets a clear answer instead of a confusing 405.
 */
export function handleRemovedImagePromptJobRoute(id: string): Response {
	return json(
		{
			success: false,
			error:
				"The image-prompt poll URL has been removed. POST /api/image-prompts now returns the prompts directly.",
			prompts: [],
			id
		},
		410
	);
}
