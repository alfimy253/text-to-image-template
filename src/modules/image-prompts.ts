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
 *
 * Every prompt is a THREE-PARAGRAPH description (subject & action · setting,
 * atmosphere & light · camera, lens & style finish). That length rule is the
 * image quality / style-enhancer guard of this module: it is stated in the
 * system instruction, retried when the model answers thin, and finally
 * enforced by `enforceParagraphGuard()` so no short prompt reaches SDXL.
 */

import { IMAGE_PROMPT_TIMEOUT_MS, imageFrameFor } from "./image-batch";

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
	/* Session #211: the quick-batch table's Resolution + Orientation columns. */
	resolution?: number;
	orientation?: string;
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
 * The image model does not need the whole narration. Keep the opening and
 * closing spoken sentences as a compact two-sentence idea, which preserves the
 * video's topic arc while avoiding a multi-thousand-token transcript payload.
 * The studio's script is plain narration text (no subtitle formatting), so
 * only stray legacy lines — a lone cue number or a `-->` timestamp — are
 * skipped while the sentences are collected.
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
 * Every scene prompt the writer produces must be at least this many
 * paragraphs long, and each paragraph must carry real visual detail. This is
 * the image quality / style-enhancer guard: a one-line prompt gives SDXL
 * nothing to work with, so the writer is told — and re-checked below — that a
 * short prompt is a rejected prompt.
 */
export const IMAGE_PROMPT_MIN_PARAGRAPHS = 3;
export const IMAGE_PROMPT_PARAGRAPH_MIN_WORDS = 30;
export const IMAGE_PROMPT_MAX_CHARS = 2600;

/*
 * Splits one model-written prompt into its paragraphs. Blank-line separated
 * blocks, and nothing else, are paragraphs; whitespace inside a paragraph is
 * collapsed so the JSON payload stays tidy.
 */
export function splitPromptParagraphs(prompt: string): string[] {
	return String(prompt || "")
		.replace(/\r\n/g, "\n")
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
		.filter(Boolean);
}

function countWords(text: string): number {
	return String(text || "").split(/\s+/).filter(Boolean).length;
}

/* How many paragraphs one prompt currently carries. */
export function countPromptParagraphs(prompt: string): number {
	return splitPromptParagraphs(prompt).length;
}

/* True when the writer answered with a thin, single-sentence prompt. */
export function isThinPrompt(prompt: string): boolean {
	const paragraphs = splitPromptParagraphs(prompt);
	return (
		paragraphs.length < IMAGE_PROMPT_MIN_PARAGRAPHS ||
		paragraphs.some((paragraph) => countWords(paragraph) < IMAGE_PROMPT_PARAGRAPH_MIN_WORDS)
	);
}

/*
 * Quality / style-enhancer guard applied to the writer's own answer. A scene
 * the model returned shorter than three paragraphs is topped up with
 * style-derived depth paragraphs (light, camera, colour grade) so the image
 * model always receives a full, three-paragraph prompt. Scenes are never
 * dropped — the flow is deliberately best-effort.
 */
export function enforceParagraphGuard(prompt: string, styleValue: unknown): string {
	const style = normalizeImageStyle(styleValue) || DEFAULT_IMAGE_STYLE;
	const styleGuide = IMAGE_STYLE_GUIDANCE[style];
	const beats = styleGuide
		.split(/,\s*/)
		.map((beat) => beat.trim())
		.filter(Boolean);
	const fillers = [
		"Atmosphere and light: " + (beats[1] || beats[0] || styleGuide) +
			", with a readable foreground, midground and background so the scene has real depth, and light that clearly comes from a motivated source inside the frame.",
		"Camera and finish: " + (beats[2] || beats[0] || styleGuide) +
			", framed as one decisive moment with a deliberate composition, balanced negative space, realistic scale and a consistent colour grade across the sequence."
	];

	const paragraphs = splitPromptParagraphs(prompt);
	if (!paragraphs.length) return "";
	let fillerIndex = 0;
	while (paragraphs.length < IMAGE_PROMPT_MIN_PARAGRAPHS) {
		paragraphs.push(fillers[fillerIndex % fillers.length]);
		fillerIndex++;
	}
	const guarded = paragraphs.map((paragraph, index) =>
		index === 0 || countWords(paragraph) >= IMAGE_PROMPT_PARAGRAPH_MIN_WORDS
			? paragraph
			: paragraph + " " + styleGuide + "."
	);
	return guarded.join("\n\n").replace(/\s+$/g, "").slice(0, IMAGE_PROMPT_MAX_CHARS);
}

/*
 * Compact system instructions for the prompt writer. The model gets at most
 * two representative sentences of the narration script, not the full text, to
 * keep Workers AI input tokens and per-request work bounded.
 */
export function buildImagePromptInstruction(
	input: ImagePromptInput,
	count = imagePromptCountForMinutes(input.minutes)
): string {
	const style = normalizeImageStyle(input.style) || DEFAULT_IMAGE_STYLE;
	const styleGuide = IMAGE_STYLE_GUIDANCE[style];
	const topic = String(input.topic || "my video").replace(/\s+/g, " ").trim().slice(0, 160) || "my video";
	const frame = imageFrameFor(input.resolution, input.orientation);
	const frameRule =
		"FRAME: every image is rendered as a " +
		frame.orientation.toUpperCase() +
		" frame at " +
		frame.width +
		"x" +
		frame.height +
		" px (" +
		frame.resolution +
		" px long edge). " +
		(frame.orientation === "portrait"
			? "Compose vertically: a tall subject or vertical leading lines, the focal point in the lower or middle third, nothing important near the top or bottom edge, and no wide panoramic detail."
			: frame.orientation === "square"
				? "Compose for a square crop: one centred focal point, generous negative space on all four sides, nothing important in the extreme corners."
				: "Compose wide: keep the subject laterally balanced with headroom, natural depth from foreground to background, and nothing important at the extreme left or right edge.") +
		" Describe the scene so it works at exactly that shape and size.";
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
		"Treat the short script idea below as the general meaning of the whole video. Create broad, representative scenes that portray its central idea and progression; do not make a literal shot for every line of narration or copy lines from the script. " +
		"The video topic is: " + topic + ". The script length is " + input.minutes + " minute(s), so return exactly " + count + " image prompts in opening-to-closing order. " +
		"Every prompt must consistently follow the same selected video image style: " + style + ". Style direction: " + styleGuide + ". Apply this visual language to every scene; do not mix in another aesthetic. " +
		frameRule + " " +
		"QUALITY / STYLE GUARD - LENGTH: every prompt must be at least " + IMAGE_PROMPT_MIN_PARAGRAPHS + " paragraphs long, separated by a blank line, written inside one JSON string with \\n\\n between the paragraphs. " +
		"Paragraph 1 = the subject and its action in this scene. Paragraph 2 = the setting, atmosphere, weather, time of day and light. Paragraph 3 = camera and lens (shot size, angle, height, depth of field), colour grade and the finishing style notes. " +
		"Each paragraph needs at least " + IMAGE_PROMPT_PARAGRAPH_MIN_WORDS + " words of concrete, filmable visual detail; a prompt of one or two short sentences is rejected and re-asked. Do not pad with filler, repeat a sentence, or describe the narration - add real visual information instead. " +
		"Vary scene scale and angle while keeping the sequence coherent and relevant to the basic script idea. " +
		"No rendered text, words, letters, captions, logos, watermarks or numbers inside any image. " +
		(keywords ? "SEO keywords are context only; use their subjects when natural, never render the words: " + keywords + ". " : "") +
		"Two-sentence script idea: " + scriptIdea + " " +
		'Reply with ONLY this exact JSON shape, one three-paragraph string per scene: {"prompts":["paragraph one of scene 1\\n\\nparagraph two of scene 1\\n\\nparagraph three of scene 1","paragraph one of scene 2\\n\\nparagraph two of scene 2\\n\\nparagraph three of scene 2"]}'
	);
}

/*
 * Final pass over every scene prompt: the paragraph guard first, then the
 * selected video style appended as its own closing paragraph so the style can
 * never be truncated away by a long scene description.
 */
export function applyImageStyleToPrompts(prompts: string[], styleValue: unknown): string[] {
	const style = normalizeImageStyle(styleValue) || DEFAULT_IMAGE_STYLE;
	const suffix = "Visual style: " + style + " — " + IMAGE_STYLE_GUIDANCE[style] + ".";
	const maxSceneChars = Math.max(240, IMAGE_PROMPT_MAX_CHARS - suffix.length - 2);
	return prompts.map((prompt) => {
		const guarded = enforceParagraphGuard(prompt, style).slice(0, maxSceneChars)
			.replace(/[\s,;:.!?]+$/g, "");
		return (guarded ? guarded + "\n\n" : "") + suffix;
	});
}

/*
 * Parses the model's reply into a clean prompt list. Accepts a JSON object
 * ({"prompts":[...]}), a bare JSON array, or — as a rescue — a numbered /
 * bulleted plain-text list. Paragraph breaks inside a prompt are preserved
 * (that is what the three-paragraph guard is measured on); only leading
 * list markers, quotes and the outer length cap are normalised.
 */
export function normalizePromptEntry(value: string): string {
	return String(value || "")
		.replace(/\\r\\n|\\n/g, "\n")
		.replace(/^[\s"']*(?:[-*•]|\d+[.)])\s*/i, "")
		.replace(/^["'“]+|["'”]+,?$/g, "")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

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
			list = rescuePromptList(raw);
		}
	}
	const prompts: string[] = [];
	for (const entry of list) {
		const cleaned = normalizePromptEntry(typeof entry === "string" ? entry : JSON.stringify(entry ?? ""))
			.split(/\n{2,}/)
			.map((paragraph) => paragraph.trim())
			.filter((paragraph) => paragraph && paragraph.indexOf("-->") === -1)
			.join("\n\n")
			.slice(0, IMAGE_PROMPT_MAX_CHARS);
		if (cleaned && prompts.indexOf(cleaned) === -1) prompts.push(cleaned);
		if (prompts.length >= expectedCount) break;
	}
	return prompts;
}

/*
 * Rescue parser for a model that answered plain text instead of JSON: a new
 * entry starts at a list marker (`1.`, `2)`, `-`, `*`) and every other line —
 * including the blank line that separates two paragraphs — belongs to it.
 */
function rescuePromptList(raw: string): string[] {
	const entries: string[] = [];
	let current: string[] = [];
	const flush = () => {
		const text = current.join("\n").trim();
		if (text) entries.push(text);
		current = [];
	};
	for (const line of String(raw).split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			if (current.length) current.push("");
			continue;
		}
		const marker = /^(?:[-*•]|\d+[.)])\s+/.exec(trimmed);
		if (marker) {
			flush();
			current.push(trimmed.slice(marker[0].length));
			continue;
		}
		if (trimmed.indexOf("-->") !== -1 || /^\d+$/.test(trimmed)) continue;
		current.push(trimmed);
	}
	flush();
	return entries;
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
 * missing, so a short first answer does not restart the whole batch. Thin
 * answers are not re-asked (that would double the latency of every run):
 * `enforceParagraphGuard()` brings them up to the three-paragraph minimum on
 * the way out instead.
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
				collected.slice(-4).map((entry) => entry.slice(0, 160)).join(" | ") +
				" Continue the sequence with exactly " + missing + " new prompts, each one as long as the rule above requires.";
		}
		try {
			const result = await withTimeout(
				env.AI!.run(model, {
					prompt,
					/* Three rich paragraphs per scene cost far more tokens than a
					 * one-liner did: budget ~800 tokens per prompt. */
					max_tokens: Math.min(16384, Math.max(1024, missing * 800)),
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
/*
 * The studio always sends the plain narration script. `scriptIdea` (the short
 * form typed into a table row) wins over `script` (the full AI script); there
 * is no subtitle-format input any more.
 */
const rawIdea = typeof body.scriptIdea === "string"
	? body.scriptIdea.slice(0, 4000)
	: typeof body.script === "string"
		? body.script.slice(0, 40000)
		: "";
	/*
	 * Session #211: the frame is optional. Absent = the historical landscape
	 * 1024 px frame; present-but-invalid is a 400 so a typo never silently
	 * produces prompts for the wrong shape.
	 */
	const frame = imageFrameFor(body.resolution, body.orientation);
	if (body.resolution !== undefined && body.resolution !== null && body.resolution !== "") {
		const raw = String(body.resolution).trim().toLowerCase().replace(/px$/, "");
		if (!/^\d+$/.test(raw) || imageFrameFor(raw, body.orientation).resolution !== Number(raw)) {
			return { error: "Resolution must be one of 480, 540, 720 or 1024 (pixels, long edge)" };
		}
	}
	if (body.orientation !== undefined && body.orientation !== null && body.orientation !== "") {
		const raw = String(body.orientation).trim().toLowerCase();
		if (["square", "landscape", "portrait"].indexOf(raw) === -1) {
			return { error: "Orientation must be one of square, landscape, portrait" };
		}
	}
	const scriptIdea = summarizeScriptIdea(rawIdea, topic);
	const keywordSet =
		body.keywordSet && typeof body.keywordSet === "object" && !Array.isArray(body.keywordSet)
			? (body.keywordSet as ImagePromptInput["keywordSet"])
			: null;
	return {
		topic,
		minutes,
		style,
		scriptIdea,
		keywordSet,
		resolution: frame.resolution,
		orientation: frame.orientation
	};
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
	const frame = imageFrameFor(input.resolution, input.orientation);
	console.info("[image-prompts] started", {
		model,
		minutes: input.minutes,
		expectedCount,
		style: input.style,
		resolution: frame.resolution,
		orientation: frame.orientation,
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
			resolution: frame.resolution,
			orientation: frame.orientation,
			width: frame.width,
			height: frame.height,
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
