/*
 * AI image-prompt generation (`src/modules/image-prompts.ts`)
 *
 *   POST /api/image-prompts
 *     {topic, minutes, style, script|scriptIdea, keywordSet, batch?}
 *     -> 200 {success, prompts: string[], count, expectedCount, style, minutes}
 *
 * New editor/table callers pass batch:{offset,count<=3,attempt,previous}.
 * A batch performs ONE inference (45s budget); the browser owns retries,
 * fallback selection, lookahead and image sequencing. Without batch, the
 * legacy 10/14/20 prompt response and top-up behavior remain compatible.
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

/*
 * `@cf/meta/llama-3.1-8b-instruct-fp8` has an ~8K token context window, so
 * `max_tokens` must stay comfortably below `8192 - prompt_tokens`. If the
 * primary model throws transport/context errors and produces zero prompts,
 * fall back to the 70B fast instruct model (same fallback slug as `script-seo.ts`).
 */
export const IMAGE_PROMPT_MAX_TOKENS = 3584;
export const IMAGE_PROMPT_BATCH_TIMEOUT_MS = 45000;
export const IMAGE_PROMPT_FALLBACK_MODELS: readonly string[] = [
	"@cf/meta/llama-3.3-70b-instruct-fp8-fast"
];

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
	/** Stateless browser-managed batch. Omitted by legacy callers. */
	batch?: { offset: number; count: number; total: number; attempt: number; previous: string[] };
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
export const IMAGE_PROMPT_MAX_CHARS = 1800;

/*
 * Per-style discipline rules instructing the prompt-writer model how to adhere
 * carefully to the selected visual style without drifting into conflicting
 * mediums (for instance, slipping DSLR photo jargon into Pop Comic or Retro
 * Poster, or cartoon ink cues into Documentary or Cinematic Film).
 */
export const IMAGE_STYLE_DISCIPLINE: Record<ImageStyle, string> = {
	"Cinematic Film":
		"Stay strictly inside grounded cinema aesthetics with motivated practical and key light, natural optical depth, and tactile physical materials; never mix in cartoon, comic ink, vector, or plastic CGI styling",
	"Editorial Magazine":
		"Stay strictly inside polished editorial magazine art direction with intentional studio or location lighting, refined colour harmony, and crisp real-world textures; never drift into comic linework, neon cyberpunk clutter, or fantasy painting",
	"Kinetic Typography":
		"Stay strictly inside clean motion-design graphic geometry, bold colour blocks, and directional visual rhythm with zero rendered letters, numerals, or faux text glyphs; never drift into muddy snapshot realism",
	"Neon Night":
		"Stay strictly inside nocturnal cyan-and-magenta neon lighting, wet specular reflections, deep rich shadows, and urban night atmosphere; never drift into flat daylight, pastel storybook, or vintage paper poster looks",
	"Minimalist":
		"Stay strictly inside uncluttered minimalist design with one clear focal subject, generous calm negative space, a restrained palette, and soft clean lighting; never crowd the frame with busy backgrounds or visual noise",
	"Retro Poster":
		"Stay strictly inside vintage screenprint poster illustration with bold flat graphic silhouettes, a limited mid-century palette, and subtle paper and halftone grain with zero lettering; never mix in raw DSLR photo terms or glossy 3D renders",
	"Documentary":
		"Stay strictly inside authentic candid documentary observation with natural available light, believable everyday surroundings, and understated true-to-life colour; never drift into staged glamour, neon fantasy, or illustrated styles",
	"Split Composition":
		"Stay strictly inside a clean two-zone split frame (one crisp vertical, horizontal, or diagonal divider) pairing two balanced, coherent visual moments with zero labels; never collapse into a messy multi-panel collage",
	"Dream Glow":
		"Stay strictly inside luminous dreamlike atmosphere with soft bloom, gentle haze, and harmonious ethereal gradients while keeping every subject structurally solid; never drift into gritty harsh realism or sharp comic ink",
	"Pop Comic":
		"Stay strictly inside bold pop-comic illustration with crisp black ink outlines, vibrant halftone accents, and punchy flat colour fills with zero speech bubbles or sound-effect text; never mix in photorealistic camera-lens jargon"
};

export const IMAGE_ANTI_DISTORTION_GUARD =
	"ANTI-DISTORTION & STRUCTURAL GUARD: design clean, physically coherent compositions that prevent AI image distortion — " +
	"feature 1 to 2 clearly separated focal subjects in natural, grounded poses rather than tangled crowds or overlapping bodies; " +
	"whenever people or hands appear, specify natural human proportions, symmetrical facial features with aligned eyes, and relaxed five-fingered hands in clear, unobstructed positions (avoiding contorted wrists, extra or fused fingers, or duplicate limbs); " +
	"keep architectural lines straight, perspective coherent from a single viewpoint, object boundaries solid without melting or floating parts, and foreground-to-background scale realistic.";

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

function clipAtWordBoundary(value: string, maxChars: number): string {
	const clean = value.replace(/\s+/g, " ").trim();
	if (clean.length <= maxChars) return clean;
	if (maxChars <= 1) return clean.slice(0, Math.max(0, maxChars));
	const sliced = clean.slice(0, maxChars);
	const boundary = sliced.replace(/\s+\S*$/, "").trim();
	const chosen = boundary.length >= Math.floor(maxChars * 0.6) ? boundary : sliced.trim();
	return chosen.replace(/[\s,;:.!?]+$/g, "");
}

/*
 * Trims a multi-paragraph prompt proportionally across paragraphs when it
 * exceeds `maxChars`, so no closing paragraph is sliced off and words are not
 * chopped mid-token. Short prompts (`<= maxChars`) are returned untouched.
 */
function fitParagraphsToBudget(prompt: string, maxChars: number): string {
	const trimmed = prompt.replace(/[\s,;:.!?]+$/g, "");
	if (trimmed.length <= maxChars) return trimmed;
	const paragraphs = splitPromptParagraphs(prompt);
	if (paragraphs.length <= 1) {
		return clipAtWordBoundary(trimmed, maxChars);
	}
	const separatorCost = (paragraphs.length - 1) * 2;
	const textBudget = Math.max(paragraphs.length * 24, maxChars - separatorCost);
	const totalChars = paragraphs.reduce((sum, p) => sum + p.length, 0) || 1;
	const floorPerParagraph = Math.min(80, Math.floor(textBudget / paragraphs.length));
	const rawBudgets = paragraphs.map((p) =>
		Math.max(floorPerParagraph, Math.floor((p.length / totalChars) * textBudget))
	);
	let allocated = rawBudgets.reduce((sum, b) => sum + b, 0);
	while (allocated > textBudget) {
		let maxIdx = 0;
		for (let i = 1; i < rawBudgets.length; i++) {
			if (rawBudgets[i] > rawBudgets[maxIdx]) maxIdx = i;
		}
		if (rawBudgets[maxIdx] <= 24) break;
		rawBudgets[maxIdx]--;
		allocated--;
	}
	const fitted = paragraphs
		.map((p, idx) => clipAtWordBoundary(p, rawBudgets[idx]))
		.filter(Boolean)
		.join("\n\n");
	return fitted.length <= maxChars
		? fitted
		: clipAtWordBoundary(fitted, maxChars);
}

/*
 * Quality / style-enhancer guard applied to the writer's own answer. A scene
 * the model returned shorter than three paragraphs is topped up with
 * style-derived depth paragraphs (light, camera, colour grade, anti-distortion
 * geometry) so the image model always receives a full, three-paragraph prompt
 * faithful to the chosen style. Scenes are never dropped — the flow is
 * deliberately best-effort.
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
			", with a readable foreground, midground and background so the scene has real depth, coherent perspective, and light that clearly comes from a motivated source inside the frame in strict " +
			style + " aesthetics.",
		"Camera and finish: " + (beats[2] || beats[0] || styleGuide) +
			", framed as one decisive moment with a deliberate composition, balanced negative space, realistic scale, intact natural proportions, crisp undistorted geometry, and a consistent " +
			style + " colour grade across the sequence."
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
			: paragraph +
				" Rendered carefully in " +
				style +
				" (" +
				styleGuide +
				") with natural proportions and clean undistorted forms."
	);
	return fitParagraphsToBudget(guarded.join("\n\n").replace(/\s+$/g, ""), IMAGE_PROMPT_MAX_CHARS);
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
	const styleDiscipline = IMAGE_STYLE_DISCIPLINE[style];
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
		"STRICT STYLE FIDELITY — BE EXTRA CAREFUL FOLLOWING THE SELECTED STYLE: Every prompt must consistently follow the same selected video image style: " + style + ". " +
		"Style direction: " + styleGuide + ". " + styleDiscipline + ". " +
		"Check every paragraph before emitting it to ensure its lighting, textures, palette, and medium vocabulary stay 100% faithful to " + style + " without drifting into another visual style or mixing incompatible art mediums. " +
		frameRule + " " +
		IMAGE_ANTI_DISTORTION_GUARD + " " +
		"QUALITY / STYLE GUARD - LENGTH: every prompt must be at least " + IMAGE_PROMPT_MIN_PARAGRAPHS + " paragraphs long, separated by a blank line, and at most " + IMAGE_PROMPT_MAX_CHARS + " characters total, written inside one JSON string with \\n\\n between the paragraphs. " +
		"Paragraph 1 = the subject and its action in this scene, with clear, grounded posture and natural proportions. " +
		"Paragraph 2 = the setting, atmosphere, weather, time of day and light, with coherent perspective and solid spatial depth in " + style + ". " +
		"Paragraph 3 = camera and lens (shot size, angle, height, depth of field or medium-appropriate framing), colour grade and the finishing " + style + " style and anti-distortion clarity notes. " +
		"Each paragraph needs at least " + IMAGE_PROMPT_PARAGRAPH_MIN_WORDS + " words of concrete, filmable visual detail (aim for roughly 700 to 1,350 characters per three-paragraph scene so it fits cleanly within the " + IMAGE_PROMPT_MAX_CHARS + "-character limit); a prompt of one or two short sentences is rejected and re-asked. Do not pad with filler, repeat a sentence, or describe the narration - add real visual information instead. " +
		"Vary scene scale and angle while keeping the sequence coherent and relevant to the basic script idea. " +
		"No rendered text, words, letters, captions, logos, watermarks or numbers inside any image. " +
		(keywords ? "SEO keywords are context only; use their subjects when natural, never render the words: " + keywords + ". " : "") +
		"Two-sentence script idea: " + scriptIdea + " " +
		'Reply with ONLY this exact JSON shape, one three-paragraph string per scene: {"prompts":["paragraph one of scene 1\\n\\nparagraph two of scene 1\\n\\nparagraph three of scene 1","paragraph one of scene 2\\n\\nparagraph two of scene 2\\n\\nparagraph three of scene 2"]}'
	);
}

/*
 * Final pass over every scene prompt: the paragraph guard first, then the
 * selected video style + anti-distortion lock appended as its own closing
 * paragraph so neither can ever be truncated away by a long scene description.
 */
export function applyImageStyleToPrompts(prompts: string[], styleValue: unknown): string[] {
	const style = normalizeImageStyle(styleValue) || DEFAULT_IMAGE_STYLE;
	const suffix =
		"Visual style: " +
		style +
		" — " +
		IMAGE_STYLE_GUIDANCE[style] +
		". Strictly maintain pure " +
		style +
		" aesthetics with zero style drift, natural proportions, coherent perspective, intact anatomy, and crisp undistorted geometry.";
	const maxSceneChars = Math.max(240, IMAGE_PROMPT_MAX_CHARS - suffix.length - 2);
	return prompts.map((prompt) => {
		const guarded = fitParagraphsToBudget(enforceParagraphGuard(prompt, style), maxSceneChars)
			.replace(/[\s,;:.!?]+$/g, "");
		return ((guarded ? guarded + "\n\n" : "") + suffix).slice(0, IMAGE_PROMPT_MAX_CHARS);
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

/*
 * Instruct models asked for `\n\n` paragraph breaks frequently emit literal
 * 0x0A newlines or 0x09 tabs inside `"..."` JSON strings (plus trailing commas
 * before `]` / `}`), which causes `JSON.parse()` to throw. Escape control
 * characters strictly inside JSON string literals while leaving structural
 * whitespace untouched.
 */
export function repairJsonControlChars(source: string): string {
	let out = "";
	let inString = false;
	let escaped = false;

	for (let i = 0; i < source.length; i++) {
		const ch = source[i];
		const code = source.charCodeAt(i);

		if (inString) {
			if (escaped) {
				out += ch;
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				out += ch;
				escaped = true;
				continue;
			}
			if (ch === '"') {
				out += ch;
				inString = false;
				continue;
			}
			if (ch === "\n") {
				out += "\\n";
				continue;
			}
			if (ch === "\r") {
				out += "\\r";
				continue;
			}
			if (ch === "\t") {
				out += "\\t";
				continue;
			}
			if (code < 0x20) {
				out += " ";
				continue;
			}
			out += ch;
			continue;
		}

		if (ch === '"') {
			inString = true;
			out += ch;
			continue;
		}
		out += ch;
	}

	/* Remove trailing commas outside string literals (`["a",]` -> `["a"]`). */
	let cleaned = "";
	inString = false;
	escaped = false;
	for (let i = 0; i < out.length; i++) {
		const ch = out[i];
		if (inString) {
			cleaned += ch;
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
			cleaned += ch;
			continue;
		}
		if (ch === ",") {
			let j = i + 1;
			while (j < out.length && /\s/.test(out[j])) j++;
			if (j < out.length && (out[j] === "]" || out[j] === "}")) {
				continue;
			}
		}
		cleaned += ch;
	}

	return cleaned;
}

/*
 * When a large prompt batch hits `max_tokens` mid-array
 * (`{"prompts":["scene 1...","scene 2...","truncated...`), extract every
 * COMPLETE JSON string element inside the array and drop only the unfinished
 * tail item so the next top-up attempt only requests the remaining scenes.
 */
function salvageJsonPromptArray(repairedJson: string): string[] {
	const keyMatch = /"(?:prompts|images|scenes|items)"\s*:\s*\[/i.exec(repairedJson);
	const startIdx = keyMatch
		? keyMatch.index + keyMatch[0].length
		: repairedJson.indexOf("[") !== -1
			? repairedJson.indexOf("[") + 1
			: -1;
	if (startIdx === -1) return [];

	const items: string[] = [];
	let i = startIdx;
	while (i < repairedJson.length) {
		const ch = repairedJson[i];
		if (/\s|,/.test(ch)) {
			i++;
			continue;
		}
		if (ch === "]") break;
		if (ch === '"') {
			let end = i + 1;
			let escaped = false;
			let closed = false;
			while (end < repairedJson.length) {
				const c = repairedJson[end];
				if (escaped) {
					escaped = false;
				} else if (c === "\\") {
					escaped = true;
				} else if (c === '"') {
					closed = true;
					break;
				}
				end++;
			}
			if (!closed) {
				/* Truncated final string literal — stop cleanly. */
				break;
			}
			const literal = repairedJson.slice(i, end + 1);
			try {
				const parsed = JSON.parse(literal);
				if (typeof parsed === "string" && parsed.trim()) {
					items.push(parsed);
				}
			} catch {
				/* Skip malformed string literal */
			}
			i = end + 1;
			continue;
		}
		/* Handle array of objects `[{"prompt": "..."}, ...]` */
		if (ch === "{") {
			let depth = 0;
			let end = i;
			let inStr = false;
			let esc = false;
			while (end < repairedJson.length) {
				const c = repairedJson[end];
				if (inStr) {
					if (esc) esc = false;
					else if (c === "\\") esc = true;
					else if (c === '"') inStr = false;
				} else {
					if (c === '"') inStr = true;
					else if (c === "{") depth++;
					else if (c === "}") {
						depth--;
						if (depth === 0) break;
					}
				}
				end++;
			}
			if (depth !== 0) break;
			try {
				const obj = JSON.parse(repairedJson.slice(i, end + 1)) as Record<string, unknown>;
				const text = coerceEntryString(obj);
				if (text) items.push(text);
			} catch {
				/* Skip malformed object */
			}
			i = end + 1;
			continue;
		}
		i++;
	}
	return items;
}

function coerceEntryString(entry: unknown): string {
	if (typeof entry === "string") return entry;
	if (entry && typeof entry === "object" && !Array.isArray(entry)) {
		const rec = entry as Record<string, unknown>;
		for (const key of ["prompt", "description", "scene", "text", "visual", "content"]) {
			if (typeof rec[key] === "string" && (rec[key] as string).trim()) {
				return rec[key] as string;
			}
		}
	}
	return "";
}

function extractPromptArrayFromParsed(parsed: unknown): unknown[] {
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === "object") {
		const rec = parsed as Record<string, unknown>;
		for (const key of ["prompts", "images", "scenes", "items"]) {
			if (Array.isArray(rec[key])) return rec[key] as unknown[];
		}
	}
	return [];
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
		const repaired = repairJsonControlChars(jsonText);
		const objStart = repaired.indexOf("{");
		const arrStart = repaired.indexOf("[");
		if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
			try {
				const arrEnd = repaired.lastIndexOf("]");
				if (arrEnd > arrStart) {
					list = extractPromptArrayFromParsed(JSON.parse(repaired.slice(arrStart, arrEnd + 1)));
				}
			} catch {
				list = [];
			}
		}
		if (!list.length && objStart !== -1) {
			try {
				const objEnd = repaired.lastIndexOf("}");
				if (objEnd > objStart) {
					list = extractPromptArrayFromParsed(JSON.parse(repaired.slice(objStart, objEnd + 1)));
				}
			} catch {
				list = [];
			}
		}
		if (!list.length && (objStart !== -1 || arrStart !== -1)) {
			list = salvageJsonPromptArray(repaired);
		}
		if (!list.length) {
			list = rescuePromptList(raw);
		}
	}
	const prompts: string[] = [];
	for (const entry of list) {
		const rawEntry = coerceEntryString(entry);
		if (!rawEntry) continue;
		const normalized = normalizePromptEntry(rawEntry)
			.split(/\n{2,}/)
			.map((paragraph) => paragraph.trim())
			.filter((paragraph) => paragraph && paragraph.indexOf("-->") === -1)
			.join("\n\n");
		const cleaned = fitParagraphsToBudget(normalized, IMAGE_PROMPT_MAX_CHARS);
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
		/* Ignore markdown code fences and bare JSON wrapper tokens */
		if (/^```/.test(trimmed)) continue;
		if (/^(?:\{|\}|\[|\]|,|"(?:prompts|images|scenes|items)"\s*:\s*\[?)$/i.test(trimmed)) {
			continue;
		}
		const sceneHeading = /^(?:scene|prompt|image)\s+\d+\s*[:.)-]?\s*(.*)$/i.exec(trimmed);
		if (sceneHeading) {
			flush();
			if (sceneHeading[1]) current.push(sceneHeading[1]);
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

/*
 * `env.AI.run()` text models usually answer `{response: "..."}`, but newer
 * Llama post-processors on Workers AI can auto-parse valid JSON into
 * `{response: {prompts: [...]}}` (an object) or chat-completion `{choices}`.
 */
function aiText(result: unknown): string {
	if (!result) return "";
	if (typeof result === "string") return result;
	if (Array.isArray(result)) return JSON.stringify(result);
	const obj = result as Record<string, unknown>;
	if (typeof obj.response === "string") return obj.response;
	if (obj.response && typeof obj.response === "object") {
		return JSON.stringify(obj.response);
	}
	if (typeof obj.output_text === "string") return obj.output_text;
	if (obj.result && typeof obj.result === "object") {
		const inner = obj.result as Record<string, unknown>;
		if (typeof inner.response === "string") return inner.response;
		if (inner.response && typeof inner.response === "object") {
			return JSON.stringify(inner.response);
		}
	}
	if (Array.isArray(obj.choices) && obj.choices.length > 0) {
		const first = obj.choices[0] as Record<string, unknown>;
		if (first && first.message && typeof first.message === "object") {
			const content = (first.message as Record<string, unknown>).content;
			if (typeof content === "string") return content;
		}
		if (first && typeof first.text === "string") return first.text;
	}
	if (Array.isArray(obj.prompts) || Array.isArray(obj.images)) {
		return JSON.stringify(obj);
	}
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
	input: ImagePromptInput,
	fallbackModels: readonly string[] = IMAGE_PROMPT_FALLBACK_MODELS
): Promise<string[]> {
	const expectedCount = input.batch?.count ?? imagePromptCountForMinutes(input.minutes);
	const collected: string[] = [];
	let lastError = "";

	const runModelPass = async (
		slug: string,
		maxAttempts: number,
		tokenCeiling: number
	): Promise<boolean> => {
		let threw = false;
		for (let attempt = 1; attempt <= maxAttempts && collected.length < expectedCount; attempt++) {
			const missing = expectedCount - collected.length;
			let prompt = buildImagePromptInstruction(input, missing);
			if (input.batch) {
				prompt += " SEQUENCE: write scenes " + (input.batch.offset + 1) + " through " +
					(input.batch.offset + expectedCount) + " of " + input.batch.total +
					" total scenes. Cover only this part of the opening-to-closing story, not the whole arc again." +
					" Avoid repeating these preceding scenes: " + input.batch.previous.join(" | ");
			}
			if (collected.length) {
				prompt +=
					" The sequence already has these prompts, do not repeat them: " +
					collected.slice(-4).map((entry) => entry.slice(0, 160)).join(" | ") +
					" Continue the sequence with exactly " + missing + " new prompts, each one as long as the rule above requires.";
			}
			try {
				const result = await withTimeout(
					env.AI!.run(slug, {
						prompt,
						/*
						 * Keep `max_tokens` safely inside `@cf/meta/llama-3.1-8b-instruct-fp8`'s
						 * ~8K context window (`prompt_tokens + max_tokens <= 8192`). If a large
						 * batch truncates mid-array, `salvageJsonPromptArray()` keeps every
						 * complete scene and the next iteration tops up the remainder.
						 */
						max_tokens: Math.min(tokenCeiling, Math.max(1024, missing * (input.batch ? 600 : 240))),
						temperature: attempt === 1 ? 0.65 : 0.45
					}),
					input.batch ? IMAGE_PROMPT_BATCH_TIMEOUT_MS : IMAGE_PROMPT_TIMEOUT_MS,
					"Image prompt generation"
				);
				const parsed = parseImagePrompts(aiText(result), missing);
				for (const entry of parsed) {
					if (collected.indexOf(entry) === -1) collected.push(entry);
				}
			} catch (error) {
				threw = true;
				lastError = errorMessage(error);
			}
		}
		return threw;
	};

	// New callers own retries in the browser: exactly ONE inference per request.
	// A retry may select the server-approved fallback; never accept arbitrary model slugs.
	const selectedModel = input.batch && input.batch.attempt > 0
		? (fallbackModels.find((slug) => slug && slug !== model) || model) : model;
	await runModelPass(selectedModel, input.batch ? 1 : 3, IMAGE_PROMPT_MAX_TOKENS);

	if (!collected.length && !input.batch) {
		for (const fbSlug of fallbackModels) {
			if (!fbSlug || fbSlug === model) continue;
			await runModelPass(fbSlug, 2, 4096);
			if (collected.length) break;
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
	let batch: ImagePromptInput["batch"];
	if (body.batch !== undefined) {
		if (!body.batch || typeof body.batch !== "object" || Array.isArray(body.batch)) {
			return { error: "Batch must be an object" };
		}
		const b = body.batch as Record<string, unknown>;
		const total = imagePromptCountForMinutes(minutes);
		if (!Number.isInteger(b.offset) || Number(b.offset) < 0 || Number(b.offset) >= total ||
			!Number.isInteger(b.count) || Number(b.count) < 1 || Number(b.count) > 3 ||
			Number(b.offset) + Number(b.count) > total ||
			(b.attempt !== undefined && (!Number.isInteger(b.attempt) || Number(b.attempt) < 0 || Number(b.attempt) > 2))) {
			return { error: "Batch requires offset within the scene total, count 1-3, and attempt 0-2" };
		}
		batch = { offset: Number(b.offset), count: Number(b.count), total,
			attempt: Number(b.attempt) || 0,
			previous: Array.isArray(b.previous) ? b.previous.slice(-4).filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 160)) : [] };
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
		orientation: frame.orientation,
		batch
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
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return json({ success: false, error: "Expected a JSON object", prompts: [] }, 400);
	}
	if (!env || !env.AI) {
		return json({ success: false, error: "AI binding not configured", prompts: [] }, 503);
	}
	const input = sanitizeInput(body as Record<string, unknown>);
	if ("error" in input) {
		return json({ success: false, error: input.error, prompts: [] }, 400);
	}

	const usedModel = input.batch && input.batch.attempt > 0
		? (IMAGE_PROMPT_FALLBACK_MODELS.find((slug) => slug && slug !== model) || model) : model;
	const startedAt = Date.now();
	const expectedCount = imagePromptCountForMinutes(input.minutes);
	const frame = imageFrameFor(input.resolution, input.orientation);
	console.info("[image-prompts] started", {
		model: usedModel,
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
			batch: input.batch ? { offset: input.batch.offset, requested: input.batch.count, nextOffset: input.batch.offset + prompts.length } : undefined,
			expectedCount,
			ms: Date.now() - startedAt
		});
		return json({
			success: true,
			prompts,
			count: prompts.length,
			batch: input.batch ? { offset: input.batch.offset, requested: input.batch.count, nextOffset: input.batch.offset + prompts.length } : undefined,
			expectedCount,
			style: input.style,
			minutes: input.minutes,
			resolution: frame.resolution,
			orientation: frame.orientation,
			width: frame.width,
			height: frame.height,
			model: usedModel,
			ms: Date.now() - startedAt
		});
	} catch (error) {
		const rawMessage = errorMessage(error);
		const message = /abort|signal/i.test(rawMessage)
			? "The scene prompt model request was interrupted. Please retry." : rawMessage;
		console.error("[image-prompts] failed", {
			ms: Date.now() - startedAt,
			error: message
		});
		return json({ success: false, error: message, code: "IMAGE_PROMPT_MODEL_FAILED", prompts: [] }, 502);
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
