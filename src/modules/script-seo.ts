/*
 * Modular SEO Explainer Script Engine (`src/modules/script-seo.ts`)
 *
 * Implements `POST /api/script` (RULE 7 — explainer SEO rule set) with full
 * mathematical consistency checks, Unicode/symbol-safe keyword boundary
 * matching, non-corrupting SRT cue parsing, stateful cue-level retry feedback,
 * and comprehensive `[script]` structured observability logs.
 *
 * OUTPUT FORMAT — PLAIN NARRATION TEXT, NEVER SUBTITLES.
 * The writer model still answers with timestamped cues because that is what
 * makes the "stay under N minutes" rule machine-checkable, but the cue numbers
 * and `-->` timestamps are an INTERNAL working format only: `validateSrt`
 * checks them, `plainScriptFromCues()` immediately turns the verified cues into
 * the spoken sentences, and only that plain text leaves the worker as
 * `{ success, script, … }`. The studio displays it in the Script box, the
 * voiceover model speaks it verbatim (MeloTTS understands plain sentences and
 * nothing else — subtitle formatting used to be read out as words), and no
 * client code parses a timestamp any more.
 *
 * KEYWORD FREQUENCY RULE (2026-10-24, canonical): the long-tail keyword must
 * appear AT LEAST ONCE in the spoken SRT and each of the four short keywords
 * must appear AT LEAST TWICE. There is no maximum — extra uses are valid and
 * are never a retry reason. See `system-rules.md` RULE 7.
 */

import {
	buildNoteOutline,
	buildNoteWriterBrief,
	canonicalSourceUrl,
	clientNoteIsFresh,
	sanitizeClientNote,
	emptyScriptNote,
	isScriptNoteId,
	noteHit,
	noteRunDone,
	noteRunHeartbeat,
	noteRunFailed,
	noteRunStart,
	readScriptNote,
	repairKeywordShortfall,
	researchSourceUrl,
	scriptNoteId,
	topicFromUrl,
	SCRIPT_NOTE_RESEARCH_TTL_MS,
	writeScriptNote,
	type ClientScriptNote,
	type NoteFetch,
	type ScriptNote,
	type ScriptNoteKv,
	type ScriptNoteSource,
	type ScriptNoteState
} from "./script-notes";
import { scriptEventLoop, type ScriptEventLoop } from "./script-event-loop";

export const SEO_LONG_TAIL = 1;
export const SEO_SHORT_TOTAL = 4;
export const SEO_SHORT_WORDS_MAX = 3;
/*
 * KEYWORD FREQUENCY RULE (2026-10-24, canonical — see `system-rules.md` RULE 7):
 * a minimum, never an exact count and never a maximum.
 *   - The single long-tail keyword must be said AT LEAST ONCE.
 *   - Each of the four short keywords must be said AT LEAST TWICE.
 * Saying a keyword more often than its minimum is always valid: over-use is
 * never a rejection reason, so there is deliberately no `*_FREQ_MAX` constant.
 * Every count is measured on the spoken SRT dialogue only (cue numbers,
 * timestamps, title and headings are excluded).
 */
export const SEO_LONG_FREQ_MIN = 1;
export const SEO_SHORT_FREQ_MIN = 2;
export const SEO_HEADINGS_MIN = 1;
export const SEO_HEADINGS_MAX = 12;
export const SEO_HEADING_WORDS_MAX = 12;
export const SEO_TITLE_MAX = 70;

export const SPEED_WORDS: Record<string, number> = {
	"super fast": 210,
	fast: 170,
	medium: 140,
	slow: 110
};

export interface ParsedSrtCue {
	index: number;
	rawStampLine: string;
	startStamp: string;
	endStamp: string;
	startMs: number;
	endMs: number;
	lines: string[];
	text: string;
}

export interface SrtValidationResult {
	ok: boolean;
	error?: string;
	srt?: string;
	endMs?: number;
	cues?: ParsedSrtCue[];
	strippedLeadingLines?: number;
	strippedTrailingLines?: number;
}

export interface PlannedKeywordSet {
	title: string;
	headings: string[];
	longTail: string;
	shorts: string[];
	titleMatchedShorts: string[];
	headingMatchedShorts: string[];
}

export interface KeywordAuditEntry {
	role: "longTail" | "short";
	keyword: string;
	count: number;
	min: number;
	/* `null` = no upper bound: extra uses are always allowed. */
	max: number | null;
	delta: number;
	cueIndices: number[];
	ok: boolean;
}

function scriptJson(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

function makeReqId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(3));
	return (
		"scr-" +
		Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")
	);
}

/*
 * Reads text out of whichever shape Workers AI or OpenAI-compatible adapters
 * return: chat array, `{ response }`, `{ result: { response } }`,
 * `{ choices: [...] }`, or a bare string.
 */
export function aiText(result: unknown): string {
	if (typeof result === "string") {
		return result.trim();
	}
	if (!result || typeof result !== "object") {
		return "";
	}
	if (Array.isArray(result)) {
		const first: unknown = result[0];
		if (typeof first === "string") {
			return first.trim();
		}
		if (first && typeof first === "object") {
			const rec = first as Record<string, unknown>;
			if (rec.message && typeof rec.message === "object") {
				const msg = rec.message as Record<string, unknown>;
				return String(msg.content ?? "").trim();
			}
		}
	}
	const obj = result as Record<string, unknown>;
	if (typeof obj.response === "string") {
		return obj.response.trim();
	}
	if (obj.response && typeof obj.response === "object") {
		return JSON.stringify(obj.response);
	}
	if (obj.result && typeof obj.result === "object") {
		const inner = obj.result as Record<string, unknown>;
		if (typeof inner.response === "string") {
			return inner.response.trim();
		}
		if (inner.response && typeof inner.response === "object") {
			return JSON.stringify(inner.response);
		}
	}
	if (Array.isArray(obj.choices) && obj.choices.length > 0) {
		const choice = obj.choices[0] as Record<string, unknown>;
		if (choice && choice.message && typeof choice.message === "object") {
			return String(
				(choice.message as Record<string, unknown>).content ?? ""
			).trim();
		}
		if (choice && typeof choice.text === "string") {
			return choice.text.trim();
		}
	}
	return "";
}

/*
 * Normalizes typography (curly apostrophes/quotes, en/em dashes, NBSP) so
 * spoken equivalences like "real-time" vs "real time" or "beginner’s" vs
 * "beginner's" never cause false mismatches.
 */
export function normalizeForKeywordMatch(input: string): string {
	return String(input || "")
		.toLowerCase()
		.replace(/[\u2018\u2019\u02BC`]/g, "'")
		.replace(/[\u201C\u201D]/g, '"')
		.replace(/[\u2013\u2014]/g, "-")
		.replace(/\u00A0/g, " ");
}

function escapeRegexLiteral(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 * Counts how often `keyword` appears in `text`.
 *
 * Fixes over naive `\b...\b`:
 *   1. Uses Unicode-aware `[\p{L}\p{N}_]` lookaround boundaries so symbols and
 *      accented words (`c++`, `c#`, `.net`, `café`) match accurately while
 *      still preventing substring false positives (`ai` inside `said`,
 *      `budget gear` inside `budgetgear`, `café` inside `cafés`).
 *   2. Treats spaces and hyphens between tokens equivalently (`[\s-]+`) so
 *      "real time" and "real-time" count identically when spoken aloud.
 */
export function keywordCount(text: string, keyword: string): number {
	const normKw = normalizeForKeywordMatch(keyword)
		.trim()
		.replace(/\s+/g, " ");
	if (!normKw) return 0;

	const tokens = normKw
		.split(/[\s-]+/)
		.map((t) => t.trim())
		.filter(Boolean);
	if (!tokens.length) return 0;

	const pattern = tokens.map(escapeRegexLiteral).join("[\\s-]+");
	const normText = normalizeForKeywordMatch(text);
	const re = new RegExp(
		"(?<![\\p{L}\\p{N}_])" + pattern + "(?![\\p{L}\\p{N}_])",
		"gu"
	);
	const hits = normText.match(re);
	return hits ? hits.length : 0;
}

function nextNonEmptyLine(lines: string[], fromIndex: number): string {
	for (let i = fromIndex; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed) return trimmed;
	}
	return "";
}

function hasRemainingTimestampLine(lines: string[], fromIndex: number): boolean {
	for (let i = fromIndex; i < lines.length; i++) {
		if (lines[i].indexOf("-->") !== -1) return true;
	}
	return false;
}

/*
 * Extracts clean SRT body from potential markdown fences before cue parsing.
 */
function unwrapCodeFenceForSrt(input: string): string {
	if (input.indexOf("```") === -1) return input;
	const parts = input.split("```");
	// Prefer a fenced block that actually contains SRT timestamps (`-->`)
	for (let i = 1; i < parts.length; i += 2) {
		if (parts[i] && parts[i].indexOf("-->") !== -1) {
			return parts[i].replace(/^[a-zA-Z0-9_-]+\s*\r?\n/, "").trim();
		}
	}
	return (parts[1] || input).replace(/^[a-zA-Z0-9_-]+\s*\r?\n/, "").trim();
}

/*
 * Server-side SRT validation & canonicalization:
 *   - Strips control chars, code fences, leading prose before cue 1, AND
 *     trailing LLM commentary after a blank line following the final cue.
 *   - Treats a digits-only line (`2026`, `100`) as a cue header ONLY when the
 *     next non-empty line is a timestamp (`-->`), preventing numbers inside
 *     dialogue from corrupting cues or bypassing overlap checks.
 *   - Validates `H{1,2}:MM:SS,mmm` format, `MM < 60`, `SS < 60`,
 *     `startMs < endMs`, non-overlapping `prevEndMs <= startMs`, and total
 *     duration in `[10_000 ms, minutes * 60_000 + 1_500 ms]`.
 */
export function validateSrt(text: string, minutes: number): SrtValidationResult {
	let srt = String(text || "")
		.replace(/[\u0000-\u0008\u000B\u000E-\u001F]/g, "")
		.trim();

	srt = unwrapCodeFenceForSrt(srt);
	const rawLines = srt.split(/\r?\n/);

	// Locate the first real cue header (numeric index followed by `-->`)
	let firstCue = -1;
	let firstArrow = -1;
	for (let li = 0; li < rawLines.length; li++) {
		const trimmed = rawLines[li].trim();
		if (firstArrow === -1 && trimmed.indexOf("-->") !== -1) {
			firstArrow = li;
		}
		if (
			/^[0-9]+$/.test(trimmed) &&
			nextNonEmptyLine(rawLines, li + 1).indexOf("-->") !== -1
		) {
			firstCue = li;
			break;
		}
	}

	// If a timestamp `-->` appeared before any cue number, start there so it reports "timestamp without a cue number"
	if (firstArrow !== -1 && (firstCue === -1 || firstArrow < firstCue)) {
		firstCue = firstArrow;
	}

	// Fallback if model wrote a numeric line whose next line was malformed timestamp
	if (firstCue === -1) {
		for (let li = 0; li < rawLines.length; li++) {
			if (/^[0-9]+$/.test(rawLines[li].trim())) {
				firstCue = li;
				break;
			}
		}
	}

	if (firstCue === -1) {
		return {
			ok: false,
			error: "no SRT cues found in the model output"
		};
	}

	const strippedLeadingLines = firstCue;
	const cueLines = rawLines.slice(firstCue);

	const STAMP = /^\s*([0-9]{1,2}):([0-9]{2}):([0-9]{2}),([0-9]{3})\s*$/;
	const toMs = (h: string, m: string, s: string, ms: string) =>
		((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);

	const cues: ParsedSrtCue[] = [];
	let current: ParsedSrtCue | null = null;
	let hasTimestampOnCurrent = false;
	let prevValidEndMs = -1;
	let strippedTrailingLines = 0;
	let bad = "";

	for (let li = 0; li < cueLines.length; li++) {
		const line = cueLines[li].trim();

		if (!line) {
			// A blank line after a cue with timestamp + text closes that cue
			if (current && hasTimestampOnCurrent && current.lines.length > 0) {
				current = null;
				hasTimestampOnCurrent = false;
			}
			continue;
		}

		const isCueNumberHeader =
			/^[0-9]+$/.test(line) &&
			(!current ||
				!hasTimestampOnCurrent ||
				nextNonEmptyLine(cueLines, li + 1).indexOf("-->") !== -1);

		if (isCueNumberHeader) {
			// Guard against trailing numbered prose after the final cue when no `-->` remains
			if (!hasRemainingTimestampLine(cueLines, li + 1)) {
				strippedTrailingLines += cueLines.length - li;
				break;
			}
			current = {
				index: cues.length + 1,
				rawStampLine: "",
				startStamp: "",
				endStamp: "",
				startMs: 0,
				endMs: 0,
				lines: [],
				text: ""
			};
			hasTimestampOnCurrent = false;
			cues.push(current);
			continue;
		}

		if (line.indexOf("-->") !== -1) {
			if (!current) {
				bad = "timestamp without a cue number";
				break;
			}
			const sides = line.split("-->");
			if (sides.length !== 2) {
				bad = "broken timestamp: " + line.slice(0, 60);
				break;
			}
			const a = STAMP.exec(String(sides[0]));
			const b = STAMP.exec(String(sides[1] || ""));
			if (!a || !b) {
				bad = "broken timestamp: " + line.slice(0, 60);
				break;
			}
			if (
				Number(a[2]) >= 60 ||
				Number(a[3]) >= 60 ||
				Number(b[2]) >= 60 ||
				Number(b[3]) >= 60
			) {
				bad = "broken timestamp (minutes/seconds >= 60): " + line.slice(0, 60);
				break;
			}

			current.startStamp = `${a[1].padStart(2, "0")}:${a[2]}:${a[3]},${a[4]}`;
			current.endStamp = `${b[1].padStart(2, "0")}:${b[2]}:${b[3]},${b[4]}`;
			current.rawStampLine = `${current.startStamp} --> ${current.endStamp}`;
			current.startMs = toMs(a[1], a[2], a[3], a[4]);
			current.endMs = toMs(b[1], b[2], b[3], b[4]);

			if (current.startMs >= current.endMs) {
				bad = "cue starts at or after its end: " + line.slice(0, 60);
				break;
			}
			if (prevValidEndMs > current.startMs) {
				bad = "overlapping cues at: " + line.slice(0, 60);
				break;
			}

			prevValidEndMs = current.endMs;
			hasTimestampOnCurrent = true;
			continue;
		}

		if (current && hasTimestampOnCurrent) {
			current.lines.push(line);
			current.text = current.text ? current.text + " " + line : line;
		} else if (!current && cues.length > 0 && !hasRemainingTimestampLine(cueLines, li)) {
			// Trailing LLM note after a blank line at the end of the SRT
			strippedTrailingLines++;
		}
	}

	if (bad) {
		return { ok: false, error: bad };
	}

	const realCues = cues
		.filter((c) => c.text && c.endMs > c.startMs)
		.map((c, idx) => ({ ...c, index: idx + 1 }));

	if (!realCues.length) {
		return {
			ok: false,
			error: "no valid SRT cues in the model output"
		};
	}

	const endMs = realCues[realCues.length - 1].endMs;

	if (endMs < 10000) {
		return {
			ok: false,
			error:
				"script too short (" +
				Math.round(endMs / 1000) +
				"s) for " +
				minutes +
				" minute(s)",
			endMs,
			cues: realCues
		};
	}

	if (endMs > minutes * 60 * 1000 + 1500) {
		return {
			ok: false,
			error:
				"script is " +
				Math.round(endMs / 1000) +
				"s long - it must stay under " +
				minutes +
				" minute(s)",
			endMs,
			cues: realCues
		};
	}

	const canonicalSrt = realCues
		.map(
			(c) =>
				`${c.index}\n${c.rawStampLine}\n${c.lines.join("\n")}`
		)
		.join("\n\n");

	return {
		ok: true,
		srt: canonicalSrt,
		endMs,
		cues: realCues,
		strippedLeadingLines,
		strippedTrailingLines
	};
}

/*
 * The plain narration script the studio shows and the voiceover speaks.
 *
 * `validateSrt` has already done its job by the time this runs — it used the
 * cue timings to prove the script fits the requested minutes — so the numbers
 * and timestamps are dropped here rather than shipped to the browser. Cues are
 * joined into sentences and grouped into readable paragraphs (4 cues each);
 * nothing else is rewritten, so the keyword counts the worker verified are
 * exactly the words the user sees.
 */
export function plainScriptFromCues(cues: ParsedSrtCue[] | undefined, cuesPerParagraph = 4): string {
	const cueList = Array.isArray(cues) ? cues : [];
	const sentences = cueList
		.map((cue) => String(cue.text || "").replace(/\s+/g, " ").trim())
		.filter(Boolean);
	if (!sentences.length) return "";

	/* One sentence per cue keeps the paragraphs speaking-length sized. */
	const perBlock = Math.max(1, Math.floor(cuesPerParagraph));
	const paragraphs: string[] = [];
	for (let index = 0; index < sentences.length; index += perBlock) {
		paragraphs.push(sentences.slice(index, index + perBlock).join(" "));
	}
	return paragraphs.join("\n\n").trim();
}

/* Same conversion, starting from already-validated SRT text (used by callers
 * that only hold the string, e.g. tests and the retry coach). */
export function plainScriptFromSrt(srt: string): string {
	const parsed = validateSrt(String(srt || ""), 0);
	const cues = parsed.cues || [];
	if (cues.length) return plainScriptFromCues(cues);
	return srtSpokenText(String(srt || "")).replace(/\s+/g, " ").trim();
}

/*
 * Extracts spoken words from an SRT string. Matches cue-index lines ONLY when
 * followed by a `-->` timestamp line so standalone numbers in dialogue (`2026`)
 * are preserved as spoken words.
 */
export function srtSpokenText(srt: string): string {
	const words: string[] = [];
	const lines = String(srt || "").split(/\r?\n/);

	for (let li = 0; li < lines.length; li++) {
		const line = lines[li].trim();
		if (!line) continue;
		if (
			/^[0-9]+$/.test(line) &&
			nextNonEmptyLine(lines, li + 1).indexOf("-->") !== -1
		) {
			continue;
		}
		if (line.indexOf("-->") !== -1) {
			continue;
		}
		words.push(line);
	}

	return words.join(" ");
}


/*
 * Lenient field lookup + list coercion for the planner reply.
 *
 * The 8B instruct model regularly answers with one of several equally
 * reasonable shapes - `long_tail`, `longtail`, `keyword`, `shorts`,
 * `shortKeywords`, a comma-separated string instead of an array, objects
 * like `{"keyword": "..."}` - and the strict `{"title","headings","longTail",
 * "short"}` reading used to reject every one of them, which is one of the
 * reasons plan generation failed over and over. Accepting these shapes does
 * NOT relax RULE 7: the extracted values still go through every existing
 * check (exactly 4 unique 1-3 word shorts, no nesting, short keyword in the
 * title and in at least one heading, title <= 70 characters).
 */
function pickField(
	data: Record<string, unknown>,
	keys: string[]
): unknown {
	for (const key of keys) {
		const value = data[key];
		if (value !== undefined && value !== null && value !== "") {
			return value;
		}
	}
	return undefined;
}

/* Strips wrapping quotes, bullets and a trailing full stop from a phrase. */
function cleanPhrase(value: unknown): string {
	let text = String(value === undefined || value === null ? "" : value)
		.replace(/[\u0000-\u0008\u000B\u000E-\u001F]/g, " ")
		.trim();
	text = text.replace(/^[\s"'`*•\-–—]+/, "").replace(/[\s"'`*•]+$/, "");
	text = text.replace(/[.;,]+$/, "");
	return text.trim();
}

/*
 * A list field may arrive as an array (strings or `{keyword}`-ish objects),
 * or as one delimited string. `null` means "field absent".
 */
function coerceStringList(value: unknown): unknown[] | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (Array.isArray(value)) {
		return value;
	}
	if (typeof value === "object") {
		const inner = value as Record<string, unknown>;
		const keyword = pickField(inner, ["keyword", "term", "name", "text", "value"]);
		return keyword === undefined ? null : [keyword];
	}
	const parts = String(value)
		.split(/[\n|;,]+/)
		.map((part) => part.trim())
		.filter(Boolean);
	return parts.length ? parts : null;
}

/* One list entry (string or object) as a phrase. */
function listEntryPhrase(entry: unknown): string {
	if (entry && typeof entry === "object" && !Array.isArray(entry)) {
		return cleanPhrase(
			pickField(entry as Record<string, unknown>, [
				"keyword",
				"term",
				"name",
				"text",
				"value",
				"phrase"
			])
		);
	}
	return cleanPhrase(entry);
}

/*
 * Parses and validates the Stage-1 SEO keyword JSON plan.
 * Allows short keywords inside the long-tail phrase: a spoken occurrence can
 * satisfy both roles. Long-tail keywords have no word- or character-length rule.
 */
export function parseKeywordSet(
	text: string
): { ok: true; data: PlannedKeywordSet } | { ok: false; error: string } {
	let raw = String(text || "")
		.replace(/[\u0000-\u0008\u000B\u000E-\u001F]/g, "")
		.trim();

	if (raw.indexOf("```") !== -1) {
		const parts = raw.split("```");
		for (let i = 1; i < parts.length; i += 2) {
			if (parts[i] && parts[i].indexOf("{") !== -1) {
				raw = parts[i].trim();
				break;
			}
		}
	}

	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start === -1 || end <= start) {
		return {
			ok: false,
			error: "no JSON object in the keyword output"
		};
	}

	const slice = raw.slice(start, end + 1);
	let data: Record<string, unknown> | null = null;
	try {
		data = JSON.parse(slice) as Record<string, unknown>;
	} catch {
		try {
			// Rescue trailing commas before } or ]
			data = JSON.parse(
				slice.replace(/,\s*([}\]])/g, "$1")
			) as Record<string, unknown>;
		} catch {
			return {
				ok: false,
				error: "the keyword reply was not valid JSON"
			};
		}
	}

	// 1. Exactly 1 long-tail keyword (lenient input shapes)
	let longRaw: unknown = data
		? pickField(data, [
				"longTail",
				"long_tail",
				"longtail",
				"longTailKeyword",
				"long",
				"keyword",
				"primaryKeyword"
			])
		: null;
	if (Array.isArray(longRaw)) {
		longRaw = longRaw[0];
	}
	longRaw = listEntryPhrase(longRaw) || cleanPhrase(longRaw);

	const longTail = String(longRaw || "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");

	if (!longTail || !/[\p{L}\p{N}]/u.test(longTail)) {
		return {
			ok: false,
			error: 'the JSON needs a "longTail" keyword'
		};
	}

	// 2. Exactly 4 unique short-tail keywords
	const shortList =
		data
			? coerceStringList(
					pickField(data, [
						"short",
						"shorts",
						"shortKeywords",
						"short_keywords",
						"shortTail",
						"short_tail",
						"shorttails"
					])
				)
			: null;

	if (!shortList) {
		return {
			ok: false,
			error: 'the JSON needs a "short" array'
		};
	}

	const shorts: string[] = [];
	for (const shortEntry of shortList) {
		const shortKeyword = listEntryPhrase(shortEntry)
			.toLowerCase()
			.replace(/\s+/g, " ");
		if (!shortKeyword || !/[\p{L}\p{N}]/u.test(shortKeyword)) {
			return {
				ok: false,
				error: "a short keyword is empty"
			};
		}
		if (shortKeyword.split(" ").length > SEO_SHORT_WORDS_MAX) {
			return {
				ok: false,
				error:
					'the short keyword "' +
					shortKeyword +
					'" is longer than ' +
					SEO_SHORT_WORDS_MAX +
					" words"
			};
		}
		if (shorts.indexOf(shortKeyword) === -1) {
			shorts.push(shortKeyword);
		}
	}

	/*
	 * Extra shorts are trimmed to the first four instead of failing the
	 * whole plan: the model overshooting on count is a formatting slip, and
	 * the four that remain still pass every RULE 7 check below. Too FEW
	 * shorts stays an error, because the validator must never invent a
	 * keyword the model never wrote.
	 */
	if (shorts.length > SEO_SHORT_TOTAL) {
		shorts.length = SEO_SHORT_TOTAL;
	}

	if (shorts.length !== SEO_SHORT_TOTAL) {
		return {
			ok: false,
			error:
				"there must be exactly " +
				SEO_SHORT_TOTAL +
				" short keywords, not " +
				shorts.length
		};
	}

	// 3. Short/long-tail overlap is explicitly allowed, including an identical
	// phrase in both roles. Count each spoken occurrence for BOTH roles; do
	// not demand two additional standalone uses of a nested short keyword.
	// The four short keywords still remain distinct from one another.
	for (let i = 0; i < shorts.length; i++) {
		for (let j = 0; j < shorts.length; j++) {
			if (i !== j && keywordCount(shorts[i], shorts[j]) > 0) {
				return {
					ok: false,
					error:
						'the short keyword "' +
						shorts[j] +
						'" is contained inside "' +
						shorts[i] +
						'" - choose 4 distinct short keywords without nesting them inside one another'
				};
			}
		}
	}

	// 4. Explainer video TITLE (<= 70 chars, includes >= 1 short keyword)
	const title = cleanPhrase(
		data
			? pickField(data, [
					"title",
					"videoTitle",
					"video_title",
					"explainerTitle",
					"youtubeTitle"
				])
			: ""
	)
		.replace(/\s+/g, " ");
	if (!title) {
		return {
			ok: false,
			error: 'the JSON needs a "title" string'
		};
	}
	if (title.length > SEO_TITLE_MAX) {
		return {
			ok: false,
			error:
				"the title is longer than " + SEO_TITLE_MAX + " characters"
		};
	}

	const titleMatchedShorts = shorts.filter(
		(kw) => keywordCount(title, kw) > 0
	);
	if (!titleMatchedShorts.length) {
		return {
			ok: false,
			error: "the title must include at least one of the short keywords"
		};
	}

	// 5. Section HEADINGS (>= 1 heading, <= 12 words each, >= 1 includes a short keyword)
	const headingList =
		data
			? coerceStringList(
					pickField(data, [
						"headings",
						"heading",
						"sections",
						"sectionHeadings",
						"section_headings"
					])
				)
			: null;

	if (!headingList || headingList.length < SEO_HEADINGS_MIN) {
		return {
			ok: false,
			error:
				'the JSON needs a "headings" array with at least ' +
				SEO_HEADINGS_MIN +
				" heading"
		};
	}
	if (headingList.length > SEO_HEADINGS_MAX) {
		return {
			ok: false,
			error: "too many headings (max " + SEO_HEADINGS_MAX + ")"
		};
	}

	const headings: string[] = [];
	for (const headingEntry of headingList) {
		const heading = listEntryPhrase(headingEntry).replace(/\s+/g, " ");
		if (!heading) {
			return {
				ok: false,
				error: "a heading is empty"
			};
		}
		if (heading.split(" ").length > SEO_HEADING_WORDS_MAX) {
			return {
				ok: false,
				error:
					'the heading "' +
					heading +
					'" is longer than ' +
					SEO_HEADING_WORDS_MAX +
					" words"
			};
		}
		headings.push(heading);
	}

	const headingMatchedSet = new Set<string>();
	for (const heading of headings) {
		for (const kw of shorts) {
			if (keywordCount(heading, kw) > 0) {
				headingMatchedSet.add(kw);
			}
		}
	}
	if (headingMatchedSet.size === 0) {
		return {
			ok: false,
			error: "at least one heading must include a short keyword"
		};
	}

	return {
		ok: true,
		data: {
			title,
			headings,
			longTail,
			shorts,
			titleMatchedShorts,
			headingMatchedShorts: Array.from(headingMatchedSet)
		}
	};
}

/*
 * Canonical first-violation error string matching RULE 7 contract verbatim.
 *
 * Keyword frequency is a MINIMUM-ONLY rule: the long-tail keyword must be
 * said at least once and each short keyword at least twice. A keyword that is
 * said more often than its minimum is never an error, so this function only
 * ever reports deficits.
 */
export function keywordUsageError(
	spokenText: string,
	keywordSet: { longTail: string; shorts: string[] }
): string {
	const longCount = keywordCount(spokenText, keywordSet.longTail);
	if (longCount < SEO_LONG_FREQ_MIN) {
		return (
			'the long-tail keyword "' +
			keywordSet.longTail +
			'" appears ' +
			longCount +
			" time(s); it must appear at least " +
			SEO_LONG_FREQ_MIN +
			" time(s)"
		);
	}
	for (const shortKeyword of keywordSet.shorts) {
		const count = keywordCount(spokenText, shortKeyword);
		if (count < SEO_SHORT_FREQ_MIN) {
			return (
				'the short keyword "' +
				shortKeyword +
				'" appears ' +
				count +
				" time(s); it must appear at least " +
				SEO_SHORT_FREQ_MIN +
				" time(s)"
			);
		}
	}
	return "";
}

/*
 * Full per-keyword & per-cue diagnostic audit used for structured `[script]`
 * logs AND pinpoint retry coaching so Stage-2 retries know every keyword's
 * count and which exact cues contain it.
 */
export function keywordUsageAudit(
	spokenText: string,
	cues: ParsedSrtCue[] | undefined,
	keywordSet: { longTail: string; shorts: string[] }
): KeywordAuditEntry[] {
	const cueList = Array.isArray(cues) ? cues : [];

	function buildEntry(
		role: "longTail" | "short",
		kw: string,
		min: number,
		max: number | null
	): KeywordAuditEntry {
		const count = keywordCount(spokenText, kw);
		const cueIndices: number[] = [];
		for (const cue of cueList) {
			if (keywordCount(cue.text, kw) > 0) {
				cueIndices.push(cue.index);
			}
		}
		const delta =
			count < min ? count - min : max !== null && count > max ? count - max : 0;
		return {
			role,
			keyword: kw,
			count,
			min,
			max,
			delta,
			cueIndices,
			ok: delta === 0
		};
	}

	const entries: KeywordAuditEntry[] = [
		buildEntry("longTail", keywordSet.longTail, SEO_LONG_FREQ_MIN, null)
	];
	for (const sk of keywordSet.shorts) {
		entries.push(buildEntry("short", sk, SEO_SHORT_FREQ_MIN, null));
	}
	return entries;
}

/*
 * Spell out the minimum-frequency and shared-count rules for the writer AND
 * its retries. For example, "yoga" inside "morning yoga poses" needs no extra
 * standalone insertion once the long-tail has been said. Matching uses the
 * same Unicode/hyphen rules as final SRT enforcement.
 */
export function keywordOverlapInstructions(
	keywordSet: { longTail: string; shorts: string[] }
): string {
	const nested = keywordSet.shorts.filter(
		(short) => keywordCount(keywordSet.longTail, short) > 0
	);
	let instructions =
		"- MINIMUM FREQUENCY: the long-tail keyword must be said at least " +
		SEO_LONG_FREQ_MIN +
		" time(s) and each short keyword at least " +
		SEO_SHORT_FREQ_MIN +
		" times. Extra uses are allowed; only falling below a minimum is rejected.\n" +
		"- OVERLAP COUNTING: a short keyword inside the spoken long-tail counts toward BOTH totals, including across subtitle line/cue breaks. Do not add extra standalone uses when that short already totals its minimum.\n";
	for (const short of nested) {
		const shared = keywordCount(keywordSet.longTail, short) * SEO_LONG_FREQ_MIN;
		instructions +=
			'- "' +
			short +
			'" is inside "' +
			keywordSet.longTail +
			'": saying the long-tail its minimum number of times already contributes ' +
			shared +
			" short-keyword use(s). It needs " +
			Math.max(0, SEO_SHORT_FREQ_MIN - shared) +
			" additional standalone use(s).\n";
	}
	for (const short of keywordSet.shorts) {
		if (keywordCount(short, keywordSet.longTail) > 0 && nested.indexOf(short) === -1) {
			instructions +=
				'- The long-tail "' +
				keywordSet.longTail +
				'" is inside the short keyword "' +
				short +
				'": its short-keyword uses already count toward the long-tail minimum. Do not add extra standalone long-tail uses.\n';
		}
	}
	return instructions;
}

/*
 * ---------------------------------------------------------------------------
 * SEO PLAN (two selectable keyword sets) — used by the video accordion's
 * "Generate SEO Script" walkthrough.
 *
 * The walkthrough first asks the planner for TWO DIFFERENT keyword sets for
 * the same topic (one long-tail + exactly four short keywords, a title and
 * headings each), the user selects one of them, and only then is the SRT
 * writer called with that selected set. `handleSeoScriptGeneration` below
 * therefore accepts an optional, previously-planned `keywordSet` in its
 * request body and, when one is supplied (and re-validated with the exact
 * same `parseKeywordSet` rules), skips its own Stage-1 planner.
 * ---------------------------------------------------------------------------
 */

export interface SeoPlanSetClient {
	title: string;
	headings: string[];
	longTail: string;
	/* Planner JSON shape: the four short-tail keywords. */
	short: string[];
}

export function plannedSetToClient(set: PlannedKeywordSet): SeoPlanSetClient {
	return {
		title: set.title,
		headings: set.headings.slice(),
		longTail: set.longTail,
		short: set.shorts.slice()
	};
}

export function keywordSetsEqual(
	a: PlannedKeywordSet,
	b: PlannedKeywordSet
): boolean {
	return (
		a.longTail === b.longTail &&
		a.shorts.join("\n") === b.shorts.join("\n")
	);
}

export function buildSeoPlannerPrompt(
	topic: string,
	avoid?: PlannedKeywordSet | null
): string {
	let prompt =
		"You are an SEO strategist for YouTube explainer videos. Answer with ONLY one JSON object, no prose and no code fences. " +
		"The video topic is: " +
		topic +
		". Plan:\n" +
		"1) Exactly " +
		SEO_LONG_TAIL +
		" long-tail keyword (lower case, a specific search phrase about the topic; NO minimum or maximum word count or character length).\n" +
		"2) Exactly " +
		SEO_SHORT_TOTAL +
		" unique short-tail keywords (1-" +
		SEO_SHORT_WORDS_MAX +
		" words each, lower case, closely related to the topic).\n" +
		"KEYWORD FREQUENCY IS A MINIMUM, NOT AN EXACT COUNT: the long-tail keyword must be said at least " +
		SEO_LONG_FREQ_MIN +
		" time and every short keyword at least " +
		SEO_SHORT_FREQ_MIN +
		" times; the script may say them more often than that.\n" +
		"SHORT/LONG-TAIL OVERLAP IS ALLOWED: A short keyword may occur inside the long-tail keyword, or even be the same phrase. Each spoken occurrence counts toward BOTH roles, so a short that appears inside the long-tail needs fewer standalone uses (for example, a one-word short nested once in the long-tail needs one more use to reach " +
		SEO_SHORT_FREQ_MIN +
		"). Choose four distinct short keywords that do not contain one another.\n" +
		"3) The explainer video TITLE (at most " +
		SEO_TITLE_MAX +
		" characters): it MUST include at least one of the " +
		SEO_SHORT_TOTAL +
		" short-tail keywords verbatim.\n" +
		"4) At least " +
		SEO_HEADINGS_MIN +
		" section HEADING(S) (2-4 headings recommended, at most " +
		SEO_HEADING_WORDS_MAX +
		" words each) for this explainer video; at least one heading MUST include one of the short-tail keywords verbatim (using the same short keyword as the title is allowed).\n" +
		'Reply with ONLY this exact JSON shape: {"title":"the video title","headings":["first section heading","second section heading"],"longTail":"the one long tail keyword","short":["short one","short two","short three","short four"]}';
	if (avoid) {
		prompt +=
			"\nIMPORTANT: produce a DIFFERENT keyword set from this already-planned set — do NOT reuse its long-tail keyword \"" +
			avoid.longTail +
			'" and do NOT reuse its short keywords (' +
			avoid.shorts.map((s) => '"' + s + '"').join(", ") +
			"). Choose a fresh long-tail keyword and fresh short keywords that still target the same topic.";
	}
	return prompt;
}

/*
 * ---------------------------------------------------------------------------
 * PLANNER TRANSPORT RESILIENCE (2026-10-25)
 *
 * The keyword planner used to treat a *model* failure the same as a
 * *validation* failure only in the validation case: a Workers AI transport
 * error (AiError, rate limit, a retired model slug, a hung call) was thrown
 * straight out of `planOneSeoKeywordSet`, so `/api/seo-plan` answered 500
 * after a single failed call and the walkthrough dead-ended on
 * "SEO plan failed: ...". Nothing was retried and no other model was tried.
 *
 * Two fixes live here:
 *   1. `runPlannerModelCall()` retries the SAME model once on a transport
 *      error (short backoff) and bounds every call with a timeout, so a hung
 *      model cannot hold the request forever.
 *   2. `planOneSeoKeywordSet()` keeps its 3 validation attempts per model and
 *      then falls back to the next model in `SEO_PLAN_FALLBACK_MODELS`,
 *      which is what keeps planning alive when the cheapest 8B instruct
 *      model is overloaded, deprecated or answers garbage.
 * ---------------------------------------------------------------------------
 */

/* Tried in order after the configured script model. */
export const SEO_PLAN_FALLBACK_MODELS: string[] =
	["@cf/meta/llama-3.3-70b-instruct-fp8-fast"];

/* A hung Workers AI call must not hold a plan or script forever. */
export const SEO_PLAN_AI_TIMEOUT_MS = 45000;
export const SEO_SCRIPT_AI_TIMEOUT_MS = 90000;

/*
 * HOW LONG A HEALTHY RUN MAY GO WITHOUT ADVANCING THE NOTE.
 *
 * The pipeline heartbeats the note before every model call, so the longest
 * silence a healthy run can produce is ONE attempt - the writer's, at 90 s.
 * This is the number the browser's "stopped advancing" guard has to be
 * measured against. It used to be measured against `waitMs`, which is the
 * remaining share of the whole 240 s RUN budget and therefore always larger,
 * so the stall guard could never fire: a wedged note surfaced as a 185 s
 * SCRIPT_TIMEOUT instead of as a stall.
 */
export const SEO_PROGRESS_BUDGET_MS = SEO_SCRIPT_AI_TIMEOUT_MS + 15000;

/* Transport attempts per model (validation attempts are separate). */
export const SEO_PLAN_TRANSPORT_ATTEMPTS = 2;

function plannerSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function runAiCallWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error("model call timed out after " + timeoutMs + " ms"));
		}, timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			}
		);
	});
}

function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	if (err && typeof err === "object" && "message" in err) {
		return String((err as { message: unknown }).message);
	}
	return String(err || "model call failed");
}

export interface PlannerModelResult {
	ok: boolean;
	text: string;
	error: string;
	attempts: number;
	ms: number;
}

/*
 * One model, up to `SEO_PLAN_TRANSPORT_ATTEMPTS` calls, each bounded by
 * `SEO_PLAN_AI_TIMEOUT_MS`. Returns `{ok:false, error}` instead of throwing,
 * so the caller can decide between "retry the same prompt" and "next model".
 */
export async function runPlannerModelCall(
	env: { AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> } },
	model: string,
	prompt: string,
	maxTokens: number,
	temperature: number,
	timeoutMs: number = SEO_PLAN_AI_TIMEOUT_MS
): Promise<PlannerModelResult> {
	const startedAt = Date.now();
	let lastError = "";
	let attempts = 0;

	for (let attempt = 1; attempt <= SEO_PLAN_TRANSPORT_ATTEMPTS; attempt++) {
		attempts = attempt;
		if (!env || !env.AI) {
			return {
				ok: false,
				text: "",
				error: "AI binding not configured",
				attempts,
				ms: Date.now() - startedAt
			};
		}

		try {
			const result = await runAiCallWithTimeout(
				env.AI.run(model, {
					prompt,
					max_tokens: maxTokens,
					temperature
				}),
				timeoutMs
			);
			const text = aiText(result);

			if (!text) {
				lastError = "the model returned an empty reply";
			} else {
				return {
					ok: true,
					text,
					error: "",
					attempts,
					ms: Date.now() - startedAt
				};
			}
		} catch (err: unknown) {
			lastError = errorMessage(err);
		}

		console.warn("[seo-plan] model call failed", {
			model,
			attempt,
			error: lastError
		});

		if (attempt < SEO_PLAN_TRANSPORT_ATTEMPTS) {
			await plannerSleep(400 * attempt);
		}
	}

	return {
		ok: false,
		text: "",
		error: lastError,
		attempts,
		ms: Date.now() - startedAt
	};
}

/*
 * One validated keyword set from the planner (max 3 validation attempts per
 * model, same retry contract as the script route's Stage 1). When `avoid` is
 * given the prompt instructs the model to produce a different set, and a
 * reply that is still identical to `avoid` is rejected and retried.
 *
 * A transport error retries the same model once and then moves to the next
 * model in `fallbackModels`, so a single failed call no longer kills the
 * whole plan.
 */
export async function planOneSeoKeywordSet(
	env: { AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> } },
	scriptModel: string,
	topic: string,
	avoid?: PlannedKeywordSet | null,
	fallbackModels: string[] = SEO_PLAN_FALLBACK_MODELS
): Promise<PlannedKeywordSet> {
	const basePrompt = buildSeoPlannerPrompt(topic, avoid);

	/* Primary first, then each fallback once (no duplicates). */
	const models: string[] = [];
	for (const model of [scriptModel, ...fallbackModels]) {
		if (model && models.indexOf(model) === -1) {
			models.push(model);
		}
	}

	let keywordError = "";
	let transportError = "";

	for (const model of models) {
		let prevRaw = "";

		for (let attempt = 1; attempt <= 3; attempt++) {
			const prompt =
				basePrompt +
				(attempt > 1
					? " Your previous attempt was rejected: " +
						keywordError +
						(prevRaw
							? " Your previous JSON was: " + prevRaw.slice(0, 420) + "."
							: "") +
						" Try again and fix that exact problem."
					: "");

			const call = await runPlannerModelCall(
				env,
				model,
				prompt,
				1024,
				attempt === 1 ? 0.55 : 0.4
			);

			/*
			 * The model itself failed (transport, timeout, empty reply):
			 * stop spending attempts on this slug and try the next one.
			 */
			if (!call.ok) {
				transportError = model + ": " + call.error;
				break;
			}

			const check = parseKeywordSet(call.text);

			if (check.ok && avoid && keywordSetsEqual(check.data, avoid)) {
				keywordError =
					"the keyword set is identical to the other set - choose a different long-tail keyword and different short keywords";
				prevRaw = call.text.replace(/\s+/g, " ").trim();
				continue;
			}
			if (check.ok) {
				return check.data;
			}
			keywordError = check.error;
			prevRaw = call.text.replace(/\s+/g, " ").trim();
		}
	}

	if (!keywordError && transportError) {
		throw new Error("SEO planner model failed (" + transportError + ") - try again");
	}

	throw new Error(
		"SEO keywords invalid (" +
			(keywordError || "no usable reply") +
			(transportError ? "; model error: " + transportError : "") +
			") - try again"
	);
}

/*
 * POST /api/seo-plan {topic} -> {success, topic, sets:[setA, setB], model}
 * Each set is {title, headings, longTail, short:[4 shorts]} and has passed
 * the same `parseKeywordSet` validation the script route enforces. When two
 * sets are returned they are guaranteed different (different long-tail or
 * different short keywords - `keywordSetsEqual`).
 *
 * DEGRADED SUCCESS (2026-10-25): only the FIRST set is mandatory. If the
 * second planner run cannot produce a distinct, valid set - the usual
 * production failure, because the 8B model tends to repeat itself when told
 * to "be different" - the route answers 200 with ONE set plus
 * `partial: true` and a `warning`, instead of failing the whole plan and
 * dead-ending the walkthrough. The client renders whatever it receives
 * (one card or two), so a topic is never left without a usable keyword set.
 */
export async function handleSeoPlanGeneration(
	request: Request,
	env: { AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> } },
	scriptModel: string
): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const rawTopic = String(body.topic ?? "")
		.replace(/[\u0000-\u001F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 160);
	const topic = rawTopic || "my video";
	if (!env || !env.AI) {
		return scriptJson({ success: false, error: "AI binding not configured" }, 503);
	}
	const startedAt = Date.now();

	let first: PlannedKeywordSet;

	try {
		first = await planOneSeoKeywordSet(env, scriptModel, topic);
	} catch (err: unknown) {
		const message = errorMessage(err) || "SEO plan failed";
		console.error("[seo-plan] failed", {
			topic: topic.slice(0, 80),
			stage: "first-set",
			ms: Date.now() - startedAt,
			error: message
		});
		return scriptJson({ success: false, error: message }, 500);
	}

	let second: PlannedKeywordSet | null = null;
	let secondError = "";

	try {
		second = await planOneSeoKeywordSet(env, scriptModel, topic, first);
	} catch (err: unknown) {
		secondError = errorMessage(err) || "second set failed";
		console.warn("[seo-plan] second set unavailable, returning one set", {
			topic: topic.slice(0, 80),
			stage: "second-set",
			ms: Date.now() - startedAt,
			error: secondError
		});
	}

	if (!second) {
		return scriptJson({
			success: true,
			partial: true,
			topic,
			sets: [plannedSetToClient(first)],
			model: scriptModel,
			warning:
				"Only one keyword set could be planned this time; pick it to continue. (" +
				secondError +
				")"
		});
	}

	console.log("[seo-plan] ok", {
		topic: topic.slice(0, 80),
		first: first.longTail,
		second: second.longTail,
		ms: Date.now() - startedAt,
		model: scriptModel
	});

	return scriptJson({
		success: true,
		topic,
		sets: [plannedSetToClient(first), plannedSetToClient(second)],
		model: scriptModel
	});
}

function buildPinpointRetryInstructions(
	lastError: string,
	previousCheck: SrtValidationResult | null,
	audit: KeywordAuditEntry[] | null
): string {
	let feedback =
		" Your previous attempt was rejected: " +
		lastError +
		" Try again and fix that exact problem.";

	if (previousCheck && previousCheck.ok && previousCheck.srt && audit) {
		const lines = audit.map((item) => {
			const cueHint = item.cueIndices.length
				? " (currently in cue #" + item.cueIndices.join(", #") + ")"
				: " (currently in 0 cues)";
			/* Minimum-only rule: a count above `min` is always acceptable. */
			if (item.ok) {
				return (
					'- KEEP "' +
					item.keyword +
					'" at ' +
					item.count +
					" use(s) (minimum " +
					item.min +
					")" +
					cueHint +
					" — it already meets its minimum, do NOT remove it."
				);
			}
			const need = Math.abs(item.delta);
			return (
				'- ADD "' +
				item.keyword +
				'" ' +
				need +
				" more time(s) so its total reaches at least " +
				item.min +
				" (it currently has " +
				item.count +
				" use(s), minimum " +
				item.min +
				")" +
				cueHint +
				"."
			);
		});

		feedback +=
			"\n\nExact keyword audit of your previous SRT:\n" +
			lines.join("\n") +
			"\nEach keyword has a MINIMUM only (long-tail at least " +
			SEO_LONG_FREQ_MIN +
			", short at least " +
			SEO_SHORT_FREQ_MIN +
			"); saying one more often is allowed. Shared occurrences count for both short and long-tail roles. Preserve correct long-tail uses; when a short is below its minimum, add it without deleting the required long-tail phrases.\n" +
			"\nRevise your previous SRT below so EVERY keyword reaches its minimum while keeping valid SRT timestamps and outputting ONLY the corrected SRT:\n" +
			previousCheck.srt;
	}

	return feedback;
}

/* ------------------------------------------------------------------------- */
/* Note-aware generation (notes + event loop)                                 */
/* ------------------------------------------------------------------------- */

export interface ScriptGenerationOptions {
	/* Note id decided by the caller (async route / pre-warmed note). */
	noteId?: string;
	/* Dynamic URL to take notes on, when it is not in the request body. */
	sourceUrl?: string;
	/* Turn the note layer on even when the body does not ask for it. */
	useNotes?: boolean;
	/* Injected for tests: the page fetcher used to write the note down. */
	fetchImpl?: NoteFetch;
	/* Injected for tests: the event loop that schedules the pipeline. */
	loop?: ScriptEventLoop;
	/* ctx.waitUntil, so note bookkeeping can outlive the response. */
	waitUntil?: (task: Promise<unknown>) => void;
	/*
	 * The caller already counted this run against the note (`runs`). Set by the
	 * async route, which increments when it issues the ticket; without it the
	 * sync route would never record a run at all.
	 */
	runCounted?: boolean;
	/* Aborts the run when the caller's deadline expires (see the event loop). */
	signal?: AbortSignal;
}

export interface ScriptNoteContext {
	requested: boolean;
	noteId: string;
	sourceUrl: string;
	topic: string;
	/* The note the browser already holds (localStorage / cookie mirror). */
	clientNote: ClientScriptNote | null;
}

const SCRIPT_URL_TOPIC = /^(?:https?:\/\/|www\.)[^\s]+$/i;

/*
 * What a skipped model call is worth. Used only for the `timings.savedMs`
 * report written into the note; the real numbers come from current_code_latest.md
 * (planner p50 7.2 s, writer p50 21 s on the 8B instruct model).
 */
export const PLANNER_CALL_SAVED_MS = 7200;
export const WRITER_CALL_SAVED_MS = 21000;

/*
 * Decides whether a request uses the note layer and which note it is.
 *
 * Notes are OPT-IN (body `useNotes`/`notes`, a `noteId`, or a URL in
 * `sourceUrl`/`url`/`topic`) so that an old client keeps the exact legacy
 * pipeline and an old deployment cannot silently serve another topic's cache.
 * A topic that IS a URL is researched, and the note is keyed on that dynamic
 * URL, which is the "take down notes on a dynamic url" contract.
 */
export function scriptNoteContext(
	body: Record<string, unknown>,
	topic: string,
	minutes: number,
	speed: string,
	options: ScriptGenerationOptions = {}
): ScriptNoteContext {
	const rawUrl = String(body.sourceUrl ?? body.url ?? "");
	const topicIsUrl = SCRIPT_URL_TOPIC.test(topic.trim());
	const givenUrl = rawUrl || (topicIsUrl ? topic.trim() : "");
	const sourceUrl = canonicalSourceUrl(givenUrl || options.sourceUrl);
	const bodyNoteId = String(body.noteId ?? "");
	const requested =
		options.useNotes === true ||
		body.useNotes === true ||
		body.notes === true ||
		Boolean(options.noteId) ||
		isScriptNoteId(bodyNoteId) ||
		Boolean(sourceUrl);
	const noteId = isScriptNoteId(options.noteId)
		? String(options.noteId)
		: isScriptNoteId(bodyNoteId)
			? bodyNoteId
			: scriptNoteId({ topic, sourceUrl, minutes, speed });
	return {
		requested,
		noteId,
		sourceUrl,
		topic: topicIsUrl ? topicFromUrl(sourceUrl) || sourceUrl || topic : topic,
		clientNote: sanitizeClientNote(body.note)
	};
}

/*
 * WHY THERE IS NO `onScriptLoop` HELPER ANY MORE
 *
 * The note research used to be parked on the shared script loop "in the poll
 * phase together with the planner call". That is a self-deadlock: an async
 * script job already OCCUPIES one of the loop's two concurrency slots, and it
 * then queued its own `:research` sub-job behind itself. Two concurrent
 * note-backed scripts therefore held both slots while both research tasks sat
 * in the queue that only those two jobs could free — the isolate made zero
 * progress until the 240 s job deadline fired (measured: active=2 queued=2
 * completed=0 after 5 s, terminal only at 240.3 s).
 *
 * Routing the page read through the job queue bought nothing: the overlap that
 * hides a 4 s fetch behind a 6-20 s planner call comes from STARTING the
 * promise early and awaiting it after Stage 1, which works identically inline.
 * `researchSourceUrl` is already self-bounding (4 s timeout, 400 KB cap,
 * SSRF-guarded, and it never throws), so it needs no queue protection at all.
 *
 * Rule this file now follows: a job on the script loop must never wait on
 * another job on the same loop.
 */

export async function handleSeoScriptGeneration(
	request: Request,
	url: URL,
	env: {
		AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
		KV_BINDING?: ScriptNoteKv;
	},
	scriptModel: string,
	onValidated?: () => Promise<void>,
	options: ScriptGenerationOptions = {}
): Promise<Response> {
	const reqId = makeReqId();
	const startedAt = Date.now();

	const rawBody = await request.json().catch(() => null);
	if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) return scriptJson({ error: "Expected a JSON object" }, 400);
	const body = rawBody as Record<string, unknown>;
	const debugRequested = Boolean(
		body.debug === true || url.searchParams.get("debug") === "1"
	);

	// Sanitize topic — whitespace-only strings fall back to "my video"
	const rawTopic = String(body.topic ?? "")
		.replace(/[\u0000-\u001F]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 160);
	const topic = rawTopic || "my video";

	const rawMinutes = body.minutes;
	const minutes =
		typeof rawMinutes === "boolean" || Array.isArray(rawMinutes)
			? NaN
			: Number(
					rawMinutes === undefined ||
						rawMinutes === null ||
						rawMinutes === ""
						? 1
						: rawMinutes
				);

	const speed = String(body.speed || "medium")
		.toLowerCase()
		.trim();

	if (!env || !env.AI) {
		console.warn("[script] rejected", {
			reqId,
			status: 503,
			reason: "AI binding not configured"
		});
		return scriptJson(
			{ success: false, error: "AI binding not configured" },
			503
		);
	}

	if (!Number.isInteger(minutes) || minutes < 1 || minutes > 6) {
		console.warn("[script] rejected", {
			reqId,
			status: 400,
			reason: "Minutes must be 1-6",
			rawMinutes
		});
		return scriptJson({ success: false, error: "Minutes must be 1-6" }, 400);
	}

	if (!SPEED_WORDS[speed]) {
		console.warn("[script] rejected", {
			reqId,
			status: 400,
			reason: "Invalid speed",
			speed
		});
		return scriptJson(
			{
				success: false,
				error: "Speech must be super fast, fast, medium or slow"
			},
			400
		);
	}

	/*
	 * Optional user-selected keyword set (from POST /api/seo-plan, chosen in
	 * the walkthrough). When supplied it is re-validated with the exact same
	 * rules as a freshly planned set and Stage 1 is skipped; an invalid
	 * supplied set is a 400 and never reaches the writer or usage tracking.
	 */
	let suppliedKeywordSet: PlannedKeywordSet | null = null;
	if (body.keywordSet !== undefined && body.keywordSet !== null) {
		if (typeof body.keywordSet !== "object" || Array.isArray(body.keywordSet)) {
			return scriptJson(
				{ success: false, error: "Selected SEO keyword set invalid (keywordSet must be an object)" },
				400
			);
		}
		const suppliedCheck = parseKeywordSet(JSON.stringify(body.keywordSet));
		if (!suppliedCheck.ok) {
			return scriptJson(
				{ success: false, error: "Selected SEO keyword set invalid (" + suppliedCheck.error + ")" },
				400
			);
		}
		suppliedKeywordSet = suppliedCheck.data;
	}

	// #261: single-attempt requests require the validated walkthrough keyword set.
	const singleAttempt = body.singleAttempt === true;
	if (singleAttempt && (!suppliedKeywordSet || (body.attempt !== undefined &&
		(!Number.isInteger(body.attempt) || Number(body.attempt) < 0 || Number(body.attempt) > 2)))) {
		return scriptJson({ error: "Single-attempt scripts require a valid keyword set and attempt 0-2" }, 400);
	}
	const previousFailure = typeof body.previousFailure === "string" ? body.previousFailure.slice(0, 800) : "";
	const writerModel = singleAttempt && Number(body.attempt) > 0
		? (SEO_PLAN_FALLBACK_MODELS.find((slug) => slug !== scriptModel) || scriptModel) : scriptModel;

	/*
	 * Usage tracking is informational and independent of the note work, so it
	 * now runs CONCURRENTLY with the note read and the page fetch instead of
	 * blocking in front of them (it is two KV round trips that the caller used
	 * to wait for before the pipeline even started). It is still awaited before
	 * the first model call, so a counter is never charged for a request that was
	 * rejected by the validation above, and the promise is never left floating.
	 */
	const usageTask: Promise<void> | null = onValidated
		? Promise.resolve()
				.then(() => onValidated())
				.then(
					() => undefined,
					() => undefined
				)
		: null;

	const endStamp = "00:" + String(minutes).padStart(2, "0") + ":00,000";
	const maxAllowedMs = minutes * 60 * 1000 + 1500;
	const wordTarget = SPEED_WORDS[speed] * minutes;
	// Realistic cue count & per-cue seconds so `wordTarget` at <=42 chars/cue (~7 words) stays safely under `endStamp`
	const approxCueCount = Math.max(6, Math.round(wordTarget / 7));
	const approxSecPerCue = Math.max(
		1.8,
		Math.min(4.5, Number(((minutes * 56) / approxCueCount).toFixed(1)))
	);
	// Scale token limit with video length so 4-6 min SRTs are never cut off mid-timestamp
	const writerMaxTokens = Math.min(4096, Math.max(2048, minutes * 800));

	/*
	 * THE NOTE LAYER (opt-in).
	 *
	 * A note is the durable half of the pipeline: research taken from a dynamic
	 * URL, the validated keyword set, and the beat plan. Reusing it removes the
	 * planner call from every repeat run; handing it to the writer removes the
	 * guesswork that used to produce rejected SRTs. See current_code_latest.md.
	 */
	const noteContext = scriptNoteContext(body, topic, minutes, speed, options);
	const noteEnabled = noteContext.requested;
	/* What the prompts are ABOUT. A URL topic becomes its slug here and its
	 * researched page title once the note has been written down. */
	const subject = noteEnabled ? noteContext.topic : topic;
	const repairEnabled = noteEnabled || body.repairKeywords === true;
	const loop = options.loop || scriptEventLoop();

	/*
	 * ORDERED, NON-BLOCKING NOTE PERSISTENCE.
	 *
	 * A note write is bookkeeping, not part of the answer, so it must never sit
	 * in front of a model call - but two writes must also never land out of
	 * order, or a late heartbeat could overwrite the terminal state. Chaining
	 * them gives both: each write runs CONCURRENTLY with the next model call
	 * while the chain preserves the order. Only terminal writes are awaited
	 * (await persistNote()), which drains everything queued before them.
	 *
	 * This replaces the old `defer()` helper. Its fallback branch was a bare
	 * `void task`, i.e. an untracked floating promise: whenever ctx.waitUntil
	 * was absent or threw, the write was dropped on the floor with nothing
	 * holding a reference to it. Every write is now reachable from `noteWrites`,
	 * and `flushNote()` is what ctx.waitUntil is given, so nothing is orphaned.
	 */
	let noteWrites: Promise<unknown> = Promise.resolve();
	const persistNote = (): Promise<void> => {
		if (!note) return Promise.resolve();
		/* Freeze the record now: the pipeline keeps mutating `note` while the
		 * write is still in flight. */
		const snapshot = JSON.parse(JSON.stringify(note)) as ScriptNote;
		noteWrites = noteWrites
			.then(() => writeScriptNote(env, snapshot))
			.catch(() => undefined);
		return flushNote();
	};
	/* Resolves once every queued write has settled; never rejects. */
	const flushNote = (): Promise<void> =>
		noteWrites.then(
			() => undefined,
			() => undefined
		);

	let note: ScriptNote | null = null;
	let noteMs = 0;
	let noteResearchMs = 0;
	let notePlannerSkipped = false;
	let noteError = "";

	/*
	 * CANCELLATION. A caller's deadline (the event loop's `withDeadline`) used
	 * to reject the job's promise while this function kept running: the orphan
	 * resumed as soon as a slot freed, finished the writer call and wrote
	 * `state:"done"` OVER the terminal `error` the loop had just recorded
	 * (measured: onError at +502 ms, `state=done` written at +509 ms). A note
	 * that flips error -> done after the runner was declared dead makes the
	 * terminal state a lie, which is the one thing the H2 watchdog exists to
	 * prevent. So the signal is checked at every stage boundary, and an aborted
	 * run never writes a success.
	 */
	const signal = options.signal;
	const aborted = (): boolean => Boolean(signal && signal.aborted);
	const abortError = (): Error => {
		const err = new Error("script run cancelled (deadline exceeded)");
		(err as { code?: string }).code = "SCRIPT_RUN_ABORTED";
		return err;
	};

	/*
	 * Proof of life for the poller. Only the async route hands out a note URL
	 * to poll, so only that route pays for the writes; a sync request has no
	 * watcher and gets no heartbeat. Called before every model call, which
	 * bounds the silence a healthy run can produce to ONE attempt - the number
	 * the browser's stall guard is measured against.
	 *
	 * Deliberately NOT awaited: the write overlaps the model call it announces,
	 * so the heartbeat costs the run nothing. Order is still guaranteed by the
	 * write chain, and the terminal write drains it.
	 */
	const heartbeat = (state: ScriptNoteState): void => {
		if (!note || !(options.runCounted === true)) return;
		/* `noteRunHeartbeat`, never `noteRunActive`: the beat must not restart
		 * the run clock the staleness watchdog is counting down. */
		noteRunHeartbeat(note, state);
		void persistNote();
	};

	if (noteEnabled) {
		const noteStartedAt = Date.now();
		try {
			note = await readScriptNote(env, noteContext.noteId);
			if (note) {
				noteHit(note);
			} else {
				note = emptyScriptNote({
					id: noteContext.noteId,
					topic: noteContext.topic,
					sourceUrl: noteContext.sourceUrl,
					minutes,
					speed
				});
			}
			note.minutes = minutes;
			note.speed = speed;
			if (noteContext.sourceUrl) note.sourceUrl = noteContext.sourceUrl;

			/*
			 * Browser memory: the client sends the note it kept in localStorage
			 * (cookie mirror compacts it). Everything is re-validated here, and
			 * it only ever FILLS GAPS - a server note that already has a plan
			 * wins, so a stale browser copy cannot rewrite this topic's plan.
			 */
			const clientNote = noteContext.clientNote;
			if (clientNote && clientNoteIsFresh(clientNote)) {
				if (!note.outline.length && clientNote.outline.length) {
					note.outline = clientNote.outline;
					note.origin = "browser";
				}
				if (!note.keywordSet && clientNote.keywordSetRaw) {
					const clientCheck = parseKeywordSet(JSON.stringify(clientNote.keywordSetRaw));
					if (clientCheck.ok) {
						note.keywordSet = clientCheck.data;
						note.origin = "browser";
					} else {
						console.warn("[script] browser note keyword set ignored", {
							reqId,
							noteId: note.id,
							reason: clientCheck.error
						});
					}
				}
			} else if (clientNote) {
				console.warn("[script] stale browser note ignored", {
					reqId,
					noteId: note.id,
					updatedAt: clientNote.updatedAt
				});
			}
		} catch (err: unknown) {
			noteError = errorMessage(err);
			note = null;
		}
		noteMs = Date.now() - noteStartedAt;
	}

	/*
	 * `reuseScript: true` is the explicit "give me the note's script" switch
	 * (a re-render, a re-open, the second half of a retry). It is never implied:
	 * a normal request still re-writes the script from the note's keyword set
	 * and beat plan, so the text is fresh.
	 */
	if (note && body.reuseScript === true && note.payload && note.script) {
		noteHit(note);
		await persistNote();
		/* This return is before the pipeline's join point, so the usage write
		 * started above has to be settled here or it would float. */
		if (usageTask) await usageTask;
		const cachedPayload: Record<string, unknown> = {
			...note.payload,
			noteId: note.id,
			noteUrl: "/api/script/notes/" + note.id,
			noteHits: note.hits,
			cachedNote: true,
			cachedAt: note.updatedAt
		};
		console.log("[script] served from note", {
			reqId,
			noteId: note.id,
			hits: note.hits,
			scriptChars: String(note.script).length
		});
		return scriptJson(cachedPayload, 200);
	}

	/*
	 * THE RUN IS STARTING - and the note has to say so.
	 *
	 * Two things were wrong here before:
	 *
	 *  1. `noteRunStart` (the only thing that increments `runs`) ran solely in
	 *     `submitAsyncScriptJob`, so every SYNC run left `runs` at 0 no matter
	 *     how many times the pipeline executed (measured: 3 successful sync
	 *     runs -> runs=0,0,0). `runs` is part of `clientNote()`, i.e. part of
	 *     the browser's progress signature, so the note under-reported itself.
	 *     The async caller has already counted this run, hence `runCounted`.
	 *
	 *  2. Nothing was written to the store until the run FINISHED, so a poller
	 *     saw no state change at all for the whole run. That is what made the
	 *     client's "stopped advancing" stall guard useless: with no heartbeat
	 *     the only way to avoid a false stall was to ignore the guard, which is
	 *     exactly what `Math.max(stallMs, advertisedWaitMs)` did. Writing the
	 *     transition here gives the poller a real proof of life to key on.
	 */
	if (note && !(options.runCounted === true)) {
		noteRunStart(note, "planning");
		/* Overlaps the research fetch and the planner call. */
		void persistNote();
	}

	/*
	 * Research and planning are independent, so the page read is STARTED here
	 * and awaited after Stage 1: a 4 s fetch is hidden behind a 6-20 s planner
	 * call instead of being added to it. It is deliberately NOT scheduled on
	 * the script event loop - see the note above `handleSeoScriptGeneration`.
	 */
	const researchUrl = note ? noteContext.sourceUrl || note.sourceUrl : "";
	const needsResearch = Boolean(
		note &&
			researchUrl &&
			(!note.source || Date.now() - (note.updatedAt || 0) > SCRIPT_NOTE_RESEARCH_TTL_MS)
	);
	const researchTask: Promise<ScriptNoteSource> | null =
		note && needsResearch
			? /* `researchSourceUrl` reports failure as `status:"unreachable"`
				 * rather than throwing, so this promise can never reject. */
				researchSourceUrl(researchUrl, options.fetchImpl)
			: null;

	/*
	 * Every exit path owes the note the research it paid for. Before this, the
	 * planner-exhausted return left `researchTask` un-awaited: the page had
	 * already been fetched, the result was dropped, and `note.source` stayed
	 * empty - so the NEXT attempt re-fetched the same URL (`needsResearch` keys
	 * off `!note.source`). Settling it into the note here makes the fetch
	 * count exactly once per research TTL, whichever way the run ends.
	 */
	const settleResearch = async (): Promise<void> => {
		if (!activeNote || !researchTask) return;
		try {
			const source = await researchTask;
			/* Never overwrite research a later stage already stored. */
			if (!activeNote.source) activeNote.source = source;
		} catch {
			/* unreachable: researchSourceUrl does not throw */
		}
	};

	console.log("[script] start", {
		reqId,
		topic: topic.slice(0, 80),
		minutes,
		speed,
		wordTarget,
		approxCueCount,
		approxSecPerCue,
		maxAllowedMs,
		writerMaxTokens,
		model: scriptModel,
		noteId: note ? note.id : undefined,
		noteSource: noteContext.sourceUrl || undefined,
		noteHits: note ? note.hits : undefined
	});

	const plannerTrace: Array<Record<string, unknown>> = [];
	const writerTrace: Array<Record<string, unknown>> = [];
	const stages: Record<string, number> = {
		noteMs: 0,
		researchMs: 0,
		planMs: 0,
		writeMs: 0,
		totalMs: 0
	};
	let repairedKeywords: string[] = [];
	let activeNote = note;

	/* The payload every success path shares, so the note can mirror it. */
	const buildSuccess = (
		check: SrtValidationResult,
		repair: { repairedKeywords: string[]; repairMs: number } | null
	): Record<string, unknown> => {
		const set = keywordSet as PlannedKeywordSet;
		const cues = check.cues || [];
		const spokenText = check.srt ? srtSpokenText(check.srt) : "";
		const plainScript = plainScriptFromCues(cues);
		const spokenWordCount = spokenText.split(/\s+/).filter(Boolean).length;
		const keywords = {
			longTail: {
				keyword: set.longTail,
				count: keywordCount(spokenText, set.longTail),
				min: SEO_LONG_FREQ_MIN,
				max: null
			},
			short: set.shorts.map((kw) => ({
				keyword: kw,
				count: keywordCount(spokenText, kw),
				min: SEO_SHORT_FREQ_MIN,
				max: null
			}))
		};
		const payload: Record<string, unknown> = {
			success: true,
			script: plainScript,
			format: "plain",
			title: set.title,
			headings: set.headings,
			keywords,
			lines: cues.length,
			words: spokenWordCount,
			durationMs: check.endMs || 0,
			minutes: minutes,
			model: writerModel
		};
		if (repair) {
			payload.repaired = true;
			payload.repairedKeywords = repair.repairedKeywords;
			payload.repairMs = repair.repairMs;
		}
		if (activeNote) {
			payload.noteId = activeNote.id;
			payload.noteUrl = "/api/script/notes/" + activeNote.id;
			payload.noteHits = activeNote.hits;
			payload.notePlannerSkipped = notePlannerSkipped;
			payload.noteOrigin = activeNote.origin || "server";
			/* The browser stores this so its next request needs no planner. */
			payload.outline = activeNote.outline;
		}
		if (debugRequested) {
			payload.timings = stages;
		}
		return payload;
	};

	let keywordSet: PlannedKeywordSet | null = suppliedKeywordSet;

	const noteResearchStartedAt = Date.now();

	try {
		/*
		 * Single join point for the usage write started above. Everything
		 * independent has already been kicked off by now (note read, page
		 * fetch), so this await costs nothing that was not already overlapping.
		 */
		if (usageTask) await usageTask;

		/*
		 * Stage 1: SEO Keyword, Title & Section Heading Planner (max 3 attempts)
		 *
		 * Skipped entirely when the note already holds a validated set: that is
		 * the 6-20 s the note layer removes from every repeat run.
		 */
		const noteKeywordSet = activeNote ? activeNote.keywordSet : null;
		if (!keywordSet && noteKeywordSet) {
			const stored = parseKeywordSet(
				JSON.stringify({
					title: noteKeywordSet.title,
					headings: noteKeywordSet.headings,
					longTail: noteKeywordSet.longTail,
					short: noteKeywordSet.shorts
				})
			);
			if (stored.ok) {
				keywordSet = stored.data;
				notePlannerSkipped = true;
				plannerTrace.push({
					attempt: 0,
					ok: true,
					ms: 0,
					source: activeNote && activeNote.origin === "browser" ? "browser-note" : "note"
				});
				console.log("[script] keywords from note", {
					reqId,
					noteId: activeNote?.id,
					title: keywordSet.title,
					longTail: keywordSet.longTail,
					shorts: keywordSet.shorts
				});
			} else {
				console.warn("[script] note keyword set unusable", {
					reqId,
					noteId: activeNote?.id,
					reason: stored.error
				});
			}
		}

		const keywordPrompt = buildSeoPlannerPrompt(subject);
		let keywordError = "";
		let prevPlannerRaw = "";
		const planStartedAt = Date.now();

		if (!keywordSet) {
			for (let attempt = 1; attempt <= 3; attempt++) {
				/* Stage boundary: an expired deadline stops the run here. */
				if (aborted()) throw abortError();
				heartbeat("planning");
				const attemptT0 = Date.now();
				const plannerTemp = attempt === 1 ? 0.55 : 0.4;
				const prompt =
					keywordPrompt +
					(attempt > 1
						? " Your previous attempt was rejected: " +
							keywordError +
							(prevPlannerRaw
								? " Your previous JSON was: " +
									prevPlannerRaw.slice(0, 420) +
									"."
								: "") +
							" Try again and fix that exact problem."
						: "");

				console.log("[script] keywords attempt", {
					reqId,
					attempt,
					temperature: plannerTemp,
					maxTokens: 1024,
					promptChars: prompt.length
				});

				/*
				 * A transport failure (AiError, rate limit, timeout, a retired
				 * model slug) is a RETRY reason, not a reason to abandon the
				 * request: it consumes one of the three planner attempts and the
				 * next prompt repeats the original ask.
				 */
				let rawText = "";

				try {
					const result = await runAiCallWithTimeout(
						env.AI.run(scriptModel, {
							prompt,
							max_tokens: 1024,
							temperature: plannerTemp
						}),
						SEO_PLAN_AI_TIMEOUT_MS
					);

					rawText = aiText(result);

					if (!rawText && result) {
						console.warn("[script] unrecognized AI output shape (keywords)", {
							reqId,
							attempt,
							resultType: typeof result,
							keys:
								typeof result === "object" && result !== null
									? Object.keys(result as Record<string, unknown>)
									: []
						});
					}
				} catch (modelError: unknown) {
					keywordError =
						"the planner model call failed (" +
						errorMessage(modelError) +
						")";
					prevPlannerRaw = "";
					plannerTrace.push({
						attempt,
						ok: false,
						ms: Date.now() - attemptT0,
						transport: true,
						reason: keywordError
					});
					console.warn("[script] keywords model error", {
						reqId,
						attempt,
						ms: Date.now() - attemptT0,
						error: keywordError
					});
					continue;
				}

				if (!rawText) {
					keywordError = "the planner returned an empty reply";
					prevPlannerRaw = "";
					plannerTrace.push({
						attempt,
						ok: false,
						ms: Date.now() - attemptT0,
						empty: true,
						reason: keywordError
					});
					continue;
				}

				const check = parseKeywordSet(rawText);
				const attemptMs = Date.now() - attemptT0;

				if (check.ok) {
					keywordSet = check.data;
					plannerTrace.push({
						attempt,
						ok: true,
						ms: attemptMs
					});
					console.log("[script] keywords ok", {
						reqId,
						attempt,
						ms: attemptMs,
						title: keywordSet.title,
						titleMatchedShorts: keywordSet.titleMatchedShorts,
						headings: keywordSet.headings,
						headingMatchedShorts: keywordSet.headingMatchedShorts,
						longTail: keywordSet.longTail,
						shorts: keywordSet.shorts
					});
					break;
				}

				keywordError = check.error;
				prevPlannerRaw = rawText.replace(/\s+/g, " ").trim();
				plannerTrace.push({
					attempt,
					ok: false,
					ms: attemptMs,
					reason: keywordError,
					rawPreview: prevPlannerRaw.slice(0, 260)
				});

				console.warn("[script] keywords invalid", {
					reqId,
					attempt,
					ms: attemptMs,
					reason: keywordError,
					rawChars: rawText.length,
					rawPreview: prevPlannerRaw.slice(0, 260)
				});
			}
		}
		stages.planMs = Date.now() - planStartedAt;

		if (!keywordSet) {
			const totalMs = Date.now() - startedAt;
			console.error("[script] keywords exhausted", {
				reqId,
				attempts: 3,
				lastReason: keywordError,
				totalMs
			});
			if (activeNote) {
				/*
				 * The page read this run paid for must not be thrown away:
				 * storing it here means the retry reuses the research instead
				 * of re-fetching the same URL (`needsResearch` keys off
				 * `!note.source`).
				 */
				await settleResearch();
				noteRunFailed(activeNote, "SEO keywords invalid (" + keywordError + ")");
				await persistNote();
			}
			const errPayload: Record<string, unknown> = {
				success: false,
				error: "SEO keywords invalid (" + keywordError + ") - try again"
			};
			/*
			 * Same contract as the writer-exhausted 500 below: a note client is
			 * told which note holds the failure. Omitting it here left the
			 * browser with no way to read back the research it had just paid
			 * for, and made this failure indistinguishable from a note-less run.
			 */
			if (activeNote) {
				errPayload.noteId = activeNote.id;
				errPayload.noteUrl = "/api/script/notes/" + activeNote.id;
			}
			if (debugRequested) {
				errPayload.debug = {
					reqId,
					totalMs,
					plannerAttempts: plannerTrace,
					writerAttempts: writerTrace,
					eventLoop: loop.stats()
				};
				errPayload.timings = stages;
			}
			return scriptJson(errPayload, 500);
		}

		/* The note now holds the validated set for every later run. */
		if (activeNote) {
			activeNote.keywordSet = keywordSet;
			if (!activeNote.outline.length) {
				activeNote.outline = buildNoteOutline(activeNote.source, keywordSet, wordTarget);
			}
		}
		/*
		 * Stage 0b: collect the research that was started in parallel with the
		 * planner. Awaiting it HERE (not before planning) is what makes the page
		 * read free on a cold note: the note fetch runs while the model plans.
		 */
		if (activeNote && researchTask) {
			const source = await researchTask;
			noteResearchMs = Date.now() - noteResearchStartedAt;
			activeNote.source = source;
			stages.researchMs = noteResearchMs;
			if (source.status === "fetched") {
				console.log("[script] notes written", {
					reqId,
					noteId: activeNote.id,
					url: source.url,
					ms: source.ms,
					headings: source.headings.length,
					facts: source.facts.length
				});
			} else {
				console.warn("[script] notes unavailable", {
					reqId,
					noteId: activeNote.id,
					url: source.url,
					status: source.status,
					error: source.error
				});
			}
		}

		const noteBrief = activeNote ? buildNoteWriterBrief(activeNote) : "";

		/*
		 * Stage 2: Explainer SRT Writer + Redundant Server Enforcement (max 3 attempts)
		 */
		/*
		 * When the topic was a URL, the researched page title is the honest
		 * subject; the slug derived at request time is only the fallback for a
		 * page that could not be read.
		 */
		const researchTitle =
			activeNote && activeNote.source && activeNote.source.status === "fetched"
				? activeNote.source.title
				: "";
		const writerSubject =
			SCRIPT_URL_TOPIC.test(topic) && researchTitle ? researchTitle : subject;
		const basePrompt =
			"You are a professional video script writer for EXPLAINER videos - every default script explains its topic section by section, in natural spoken English. Answer with ONLY valid SRT subtitle text, nothing else. " +
			"Write a YouTube narration script as SRT subtitles about: " +
			writerSubject +
			". The video is " +
			minutes +
			" minute(s) long and the TOTAL duration of your SRT must stay UNDER " +
			minutes +
			" minute(s): the final timestamp must end at or before " +
			endStamp +
			" (at least 10 seconds long, and never exceeding " +
			endStamp +
			"). The speaker talks " +
			speed +
			" (aim for roughly " +
			wordTarget +
			" words across ~" +
			approxCueCount +
			" cues of ~" +
			approxSecPerCue +
			" seconds each). Output ONLY valid SRT: each cue is a sequential number, a timestamp line in exact HH:MM:SS,mmm --> HH:MM:SS,mmm format (always use commas before milliseconds like 00:00:00,000 --> 00:00:03,000, never dots, and seconds/minutes must stay 00-59), then 1-2 short subtitle lines (under 42 characters per line), with a blank line between cues. Timestamps start at 00:00:00,000 and never overlap. Plain spoken English dialogue only - do NOT output the video title, do NOT output section heading labels, no markdown, no code fences, and no commentary before or after the SRT. ";

		const userPrompt =
			basePrompt +
			"SEO rules - mandatory and REDUNDANTLY re-checked by the server on your SRT dialogue words. Each keyword has a MINIMUM only; saying one more often than its minimum is never rejected:\n" +
			'- Say the long-tail keyword "' +
			keywordSet.longTail +
			'" AT LEAST ' +
			SEO_LONG_FREQ_MIN +
			" time (" +
			SEO_LONG_FREQ_MIN +
			" or more).\n" +
			"- Say EACH of these " +
			SEO_SHORT_TOTAL +
			" short-tail keywords AT LEAST " +
			SEO_SHORT_FREQ_MIN +
			" times each (" +
			SEO_SHORT_FREQ_MIN +
			" or more): " +
			keywordSet.shorts.map((s) => '"' + s + '"').join(", ") +
			".\n" +
			keywordOverlapInstructions(keywordSet) +
			"- Weave every keyword naturally into spoken sentences (never read them as a list).\n" +
			(noteBrief
				? "- Write to the REFERENCE NOTE below instead of inventing your own structure. It carries the researched facts and a beat plan with a word budget per beat; every beat must be covered once, in order, and the spoken words must still fit the " +
					minutes +
					" minute(s) above.\n" +
					noteBrief +
					"\n"
				: "- Follow this explainer section flow in order (for topic structure ONLY — do NOT speak or print the title/headings verbatim; they are not spoken SRT and their words do not count as keyword uses): " +
					keywordSet.headings
						.map((h, idx) => "Section " + (idx + 1) + ": " + h)
						.join(" -> ") +
					".");

		let lastError = "";
		let prevCheck: SrtValidationResult | null = null;
		let prevAudit: KeywordAuditEntry[] | null = null;
		const writeStartedAt = Date.now();

		for (let attempt = 1; attempt <= (singleAttempt ? 1 : 3); attempt++) {
			/* Stage boundary: an expired deadline stops the run here. */
			if (aborted()) throw abortError();
			heartbeat("writing");
			const attemptT0 = Date.now();
			const writerTemp = attempt === 1 ? 0.65 : 0.4;
			const prompt =
				userPrompt +
				(singleAttempt && previousFailure ? " Previous validation failure to correct: " + previousFailure : "") +
				(attempt > 1
					? buildPinpointRetryInstructions(lastError, prevCheck, prevAudit)
					: "");

			console.log("[script] attempt", {
				reqId,
				attempt,
				temperature: writerTemp,
				maxTokens: writerMaxTokens,
				promptChars: prompt.length,
				hasPreviousValidSrt: Boolean(prevCheck && prevCheck.ok),
				noteId: activeNote ? activeNote.id : undefined
			});

			/* Same rule as the planner: a thrown model error retries. */
			let rawSrt = "";

			try {
				const result = await runAiCallWithTimeout(
					env.AI.run(writerModel, {
						prompt,
						max_tokens: writerMaxTokens,
						temperature: writerTemp
					}),
					SEO_SCRIPT_AI_TIMEOUT_MS
				);

				rawSrt = aiText(result);
			} catch (modelError: unknown) {
				lastError =
					"the script model call failed (" +
					errorMessage(modelError) +
					")";
				prevCheck = null;
				prevAudit = null;
				writerTrace.push({
					attempt,
					ok: false,
					ms: Date.now() - attemptT0,
					transport: true,
					reason: lastError
				});
				console.warn("[script] model error", {
					reqId,
					attempt,
					ms: Date.now() - attemptT0,
					error: lastError
				});
				continue;
			}

			const check = validateSrt(rawSrt, minutes);
			const spokenBeforeRepair =
				check.ok && check.srt ? srtSpokenText(check.srt) : "";

			/*
			 * DETERMINISTIC REPAIR (note layer): a valid SRT that only misses a
			 * keyword minimum is patched in place. Before this, that case cost
			 * another full writer call (up to 90 s per attempt, twice).
			 */
			let finalCheck: SrtValidationResult = check;
			let repair: { repairedKeywords: string[]; repairMs: number } | null = null;
			if (
				repairEnabled &&
				check.ok &&
				check.cues &&
				spokenBeforeRepair &&
				keywordUsageError(spokenBeforeRepair, keywordSet)
			) {
				const repairStartedAt = Date.now();
				const fixed = repairKeywordShortfall(check.cues, keywordSet);
				if (fixed) {
					const recheck = validateSrt(fixed.srt, minutes);
					const repairedProblem =
						recheck.ok && recheck.srt
							? keywordUsageError(srtSpokenText(recheck.srt), keywordSet)
							: recheck.error || "invalid SRT after repair";
					if (recheck.ok && recheck.srt && !repairedProblem) {
						finalCheck = recheck;
						repair = {
							repairedKeywords: fixed.patched.map((entry) => entry.keyword),
							repairMs: Date.now() - repairStartedAt
						};
						repairedKeywords = repair.repairedKeywords;
						writerTrace.push({
							attempt,
							ok: true,
							repaired: repair.repairedKeywords,
							ms: Date.now() - attemptT0,
							repairMs: repair.repairMs,
							cueCount: recheck.cues ? recheck.cues.length : 0,
							endMs: recheck.endMs
						});
						console.log("[script] keywords repaired locally", {
							reqId,
							attempt,
							repairMs: repair.repairMs,
							keywords: repair.repairedKeywords,
							savedModelCall: true
						});
					} else {
						console.warn("[script] local repair insufficient", {
							reqId,
							attempt,
							reason: repairedProblem
						});
					}
				}
			}

			const spokenText =
				finalCheck.ok && finalCheck.srt ? srtSpokenText(finalCheck.srt) : "";
			/* What the browser is actually given: the spoken sentences only. */
			const plainScript =
				finalCheck.ok && finalCheck.cues ? plainScriptFromCues(finalCheck.cues) : "";
			const spokenWordCount = spokenText
				? spokenText.split(/\s+/).filter(Boolean).length
				: 0;
			const audit =
				finalCheck.ok && spokenText
					? keywordUsageAudit(spokenText, finalCheck.cues, keywordSet)
					: null;

			const problem = finalCheck.ok
				? keywordUsageError(spokenText, keywordSet)
				: finalCheck.error || "invalid SRT";
			const attemptMs = Date.now() - attemptT0;

			if (!problem && finalCheck.srt && plainScript) {
				/*
				 * The deadline may have expired while the writer was running.
				 * The loop has already closed the note as a terminal `error`;
				 * writing `done` over it is what made the terminal state a lie,
				 * so an aborted run reports its cancellation instead.
				 */
				if (aborted()) throw abortError();
				const totalMs = Date.now() - startedAt;
				stages.writeMs = Date.now() - writeStartedAt;
				stages.totalMs = totalMs;
				stages.noteMs = noteMs;
				const payload = buildSuccess(finalCheck, repair);

				if (!repair) {
					writerTrace.push({
						attempt,
						ok: true,
						ms: attemptMs,
						cueCount: finalCheck.cues ? finalCheck.cues.length : 0,
						endMs: finalCheck.endMs,
						spokenWords: spokenWordCount
					});
				}

				console.log("[script] ok", {
					reqId,
					attempt,
					ms: attemptMs,
					totalMs,
					scriptChars: plainScript.length,
					cueCount: finalCheck.cues ? finalCheck.cues.length : 0,
					endMs: finalCheck.endMs,
					spokenWords: spokenWordCount,
					wordTarget,
					strippedTrailingLines: finalCheck.strippedTrailingLines || 0,
					title: keywordSet.title,
					headingsCount: keywordSet.headings.length,
					repairedKeywords: repairedKeywords.length ? repairedKeywords : undefined,
					noteId: activeNote ? activeNote.id : undefined,
					notePlannerSkipped,
					phaseStats: loop.stats().phases
				});

				if (activeNote) {
					noteRunDone(activeNote, {
						script: plainScript,
						durationMs: finalCheck.endMs || 0,
						model: writerModel,
						keywordSet,
						outline: buildNoteOutline(activeNote.source, keywordSet, wordTarget),
						repairedKeywords,
						payload,
						timings: {
							planMs: stages.planMs,
							writeMs: stages.writeMs,
							totalMs,
							savedModelCalls: (notePlannerSkipped ? 1 : 0) + (repair ? 1 : 0),
							savedMs:
								(notePlannerSkipped ? PLANNER_CALL_SAVED_MS : 0) +
								(repair ? WRITER_CALL_SAVED_MS : 0)
						}
					});
					/*
					 * Awaited, and it drains the chain: an async poller is about
					 * to read this note, so `done` has to be durable before the
					 * response goes out or the poller would keep waiting on a
					 * state that is already decided.
					 */
					await persistNote();
				}

				if (debugRequested) {
					(payload as Record<string, unknown>).debug = {
						reqId,
						totalMs,
						plannerAttempts: plannerTrace,
						writerAttempts: writerTrace,
						eventLoop: loop.stats()
					};
				}
				return scriptJson(payload, 200);
			}

			lastError = problem;
			prevCheck = finalCheck;
			prevAudit = audit;

			const auditSummary = audit
				? audit.map((a) => ({
						kw: a.keyword,
						count: a.count,
						cues: a.cueIndices,
						ok: a.ok
					}))
				: null;

			writerTrace.push({
				attempt,
				ok: false,
				ms: attemptMs,
				failureStage: finalCheck.ok ? "seo" : "srt",
				reason: lastError,
				cueCount: finalCheck.cues ? finalCheck.cues.length : 0,
				endMs: finalCheck.endMs ?? null,
				spokenWords: spokenWordCount,
				keywordAudit: auditSummary
			});

			console.warn("[script] invalid", {
				reqId,
				attempt,
				ms: attemptMs,
				failureStage: finalCheck.ok ? "seo" : "srt",
				reason: lastError,
				srtValid: finalCheck.ok,
				cueCount: finalCheck.cues ? finalCheck.cues.length : 0,
				endMs: finalCheck.endMs ?? null,
				maxAllowedMs,
				spokenWords: spokenWordCount,
				wordTarget,
				strippedTrailingLines: finalCheck.strippedTrailingLines || 0,
				keywordAudit: auditSummary,
				rawChars: rawSrt.length,
				rawPreview: finalCheck.ok
					? undefined
					: rawSrt.replace(/\s+/g, " ").slice(0, 260)
			});
		}

		const totalMs = Date.now() - startedAt;
		stages.writeMs = Date.now() - writeStartedAt;
		stages.totalMs = totalMs;
		console.error("[script] exhausted", {
			reqId,
			attempts: 3,
			reason: lastError,
			totalMs
		});

		if (activeNote) {
			noteRunFailed(activeNote, lastError);
			await persistNote();
		}

		const failPayload: Record<string, unknown> = {
			success: false,
			error: "Script output invalid (" + lastError + ") - try again"
		};
		if (debugRequested) {
			failPayload.debug = {
				reqId,
				totalMs,
				plannerAttempts: plannerTrace,
				writerAttempts: writerTrace,
				eventLoop: loop.stats()
			};
			failPayload.timings = stages;
		}
		if (activeNote) {
			failPayload.noteId = activeNote.id;
			failPayload.noteUrl = "/api/script/notes/" + activeNote.id;
		}
		return scriptJson(failPayload, 500);
	} catch (err: unknown) {
		const totalMs = Date.now() - startedAt;
		const message =
			err instanceof Error
				? err.message
				: err && typeof err === "object" && "message" in err
					? String((err as { message: unknown }).message)
					: String(err || "Script generation failed");

		console.error("[script] error", {
			reqId,
			totalMs,
			error: message,
			noteId: activeNote ? activeNote.id : undefined,
			noteError: noteError || undefined,
			stack: err instanceof Error ? err.stack : undefined
		});

		/*
		 * An aborted run does not write the note: the caller's deadline has
		 * already closed it as terminal, and a second write from this orphaned
		 * continuation is what used to overwrite that verdict.
		 */
		const isAbort = (err as { code?: string })?.code === "SCRIPT_RUN_ABORTED";
		if (activeNote && !isAbort) {
			noteRunFailed(activeNote, message);
			/* Awaited, not deferred: this is the note's terminal verdict and an
			 * untracked write could be dropped before the isolate unwound. */
			await persistNote();
		}

		return scriptJson(
			{
				success: false,
				error: message || "Script generation failed"
			},
			500
		);
	}
}
