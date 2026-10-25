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
	if (obj.result && typeof obj.result === "object") {
		const inner = obj.result as Record<string, unknown>;
		if (typeof inner.response === "string") {
			return inner.response.trim();
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
	let longRaw: unknown = data ? (data.longTail ?? data.long_tail) : null;
	if (Array.isArray(longRaw)) {
		const first = longRaw[0];
		longRaw =
			first && typeof first === "object"
				? (first as Record<string, unknown>).keyword
				: first;
	}
	if (longRaw && typeof longRaw === "object") {
		longRaw = (longRaw as Record<string, unknown>).keyword;
	}

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
		data && Array.isArray(data.short)
			? data.short
			: data && Array.isArray(data.shorts)
				? data.shorts
				: null;

	if (!shortList) {
		return {
			ok: false,
			error: 'the JSON needs a "short" array'
		};
	}

	const shorts: string[] = [];
	for (const shortEntry of shortList) {
		const shortKeyword = String(shortEntry || "")
			.trim()
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
	const title = String((data && data.title) || "")
		.trim()
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
		data && Array.isArray(data.headings)
			? data.headings
			: data && typeof data.heading === "string"
				? [data.heading]
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
		const heading = String(headingEntry || "")
			.trim()
			.replace(/\s+/g, " ");
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
 * One validated keyword set from the planner (max 3 attempts, same retry
 * contract as the script route's Stage 1). When `avoid` is given the prompt
 * instructs the model to produce a different set, and a reply that is still
 * identical to `avoid` is rejected and retried.
 */
export async function planOneSeoKeywordSet(
	env: { AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> } },
	scriptModel: string,
	topic: string,
	avoid?: PlannedKeywordSet | null
): Promise<PlannedKeywordSet> {
	const basePrompt = buildSeoPlannerPrompt(topic, avoid);
	let keywordError = "";
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
		const result = await env.AI!.run(scriptModel, {
			prompt,
			max_tokens: 1024,
			temperature: attempt === 1 ? 0.55 : 0.4
		});
		const rawText = aiText(result);
		const check = parseKeywordSet(rawText);
		if (check.ok && avoid && keywordSetsEqual(check.data, avoid)) {
			keywordError =
				"the keyword set is identical to the other set - choose a different long-tail keyword and different short keywords";
			prevRaw = rawText.replace(/\s+/g, " ").trim();
			continue;
		}
		if (check.ok) {
			return check.data;
		}
		keywordError = check.error;
		prevRaw = rawText.replace(/\s+/g, " ").trim();
	}
	throw new Error("SEO keywords invalid (" + keywordError + ") - try again");
}

/*
 * POST /api/seo-plan {topic} -> {success, topic, sets:[setA, setB], model}
 * Each set is {title, headings, longTail, short:[4 shorts]} and has passed
 * the same `parseKeywordSet` validation the script route enforces. The two
 * sets are guaranteed different (different long-tail and short keywords).
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
	try {
		const first = await planOneSeoKeywordSet(env, scriptModel, topic);
		const second = await planOneSeoKeywordSet(env, scriptModel, topic, first);
		console.log("[seo-plan] ok", {
			topic: topic.slice(0, 80),
			first: first.longTail,
			second: second.longTail
		});
		return scriptJson({
			success: true,
			topic,
			sets: [plannedSetToClient(first), plannedSetToClient(second)],
			model: scriptModel
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err || "SEO plan failed");
		console.error("[seo-plan] failed", { topic: topic.slice(0, 80), error: message });
		return scriptJson({ success: false, error: message || "SEO plan failed" }, 500);
	}
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

export async function handleSeoScriptGeneration(
	request: Request,
	url: URL,
	env: { AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> } },
	scriptModel: string,
	onValidated?: () => Promise<void>
): Promise<Response> {
	const reqId = makeReqId();
	const startedAt = Date.now();

	const body = (await request.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
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

	if (onValidated) {
		try {
			await onValidated();
		} catch {
			/* informational usage tracking is best-effort */
		}
	}

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
		model: scriptModel
	});

	const plannerTrace: Array<Record<string, unknown>> = [];
	const writerTrace: Array<Record<string, unknown>> = [];

	try {
		/*
		 * Stage 1: SEO Keyword, Title & Section Heading Planner (max 3 attempts)
		 */
		const keywordPrompt = buildSeoPlannerPrompt(topic);
		let keywordSet: PlannedKeywordSet | null = suppliedKeywordSet;
		let keywordError = "";
		if (keywordSet) {
			plannerTrace.push({ attempt: 0, ok: true, ms: 0, source: "client-selected" });
			console.log("[script] keywords supplied", { reqId, title: keywordSet.title, longTail: keywordSet.longTail, shorts: keywordSet.shorts });
		}
		let prevPlannerRaw = "";

		for (let attempt = 1; !keywordSet && attempt <= 3; attempt++) {
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

			const result = await env.AI.run(scriptModel, {
				prompt,
				max_tokens: 1024,
				temperature: plannerTemp
			});

			const rawText = aiText(result);
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

		if (!keywordSet) {
			const totalMs = Date.now() - startedAt;
			console.error("[script] keywords exhausted", {
				reqId,
				attempts: 3,
				lastReason: keywordError,
				totalMs
			});
			const errPayload: Record<string, unknown> = {
				success: false,
				error: "SEO keywords invalid (" + keywordError + ") - try again"
			};
			if (debugRequested) {
				errPayload.debug = {
					reqId,
					totalMs,
					plannerAttempts: plannerTrace,
					writerAttempts: writerTrace
				};
			}
			return scriptJson(errPayload, 500);
		}

		/*
		 * Stage 2: Explainer SRT Writer + Redundant Server Enforcement (max 3 attempts)
		 */
		const basePrompt =
			"You are a professional video script writer for EXPLAINER videos - every default script explains its topic section by section, in natural spoken English. Answer with ONLY valid SRT subtitle text, nothing else. " +
			"Write a YouTube narration script as SRT subtitles about: " +
			topic +
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
			"- Follow this explainer section flow in order (for topic structure ONLY — do NOT speak or print the title/headings verbatim; they are not spoken SRT and their words do not count as keyword uses): " +
			keywordSet.headings
				.map((h, idx) => "Section " + (idx + 1) + ": " + h)
				.join(" -> ") +
			".";

		let lastError = "";
		let prevCheck: SrtValidationResult | null = null;
		let prevAudit: KeywordAuditEntry[] | null = null;

		for (let attempt = 1; attempt <= 3; attempt++) {
			const attemptT0 = Date.now();
			const writerTemp = attempt === 1 ? 0.65 : 0.4;
			const prompt =
				userPrompt +
				(attempt > 1
					? buildPinpointRetryInstructions(lastError, prevCheck, prevAudit)
					: "");

			console.log("[script] attempt", {
				reqId,
				attempt,
				temperature: writerTemp,
				maxTokens: writerMaxTokens,
				promptChars: prompt.length,
				hasPreviousValidSrt: Boolean(prevCheck && prevCheck.ok)
			});

			const result = await env.AI.run(scriptModel, {
				prompt,
				max_tokens: writerMaxTokens,
				temperature: writerTemp
			});

			const rawSrt = aiText(result);
			const check = validateSrt(rawSrt, minutes);
			const spokenText =
				check.ok && check.srt ? srtSpokenText(check.srt) : "";
			/* What the browser is actually given: the spoken sentences only. */
			const plainScript =
				check.ok && check.cues ? plainScriptFromCues(check.cues) : "";
			const spokenWordCount = spokenText
				? spokenText.split(/\s+/).filter(Boolean).length
				: 0;
			const audit =
				check.ok && spokenText
					? keywordUsageAudit(spokenText, check.cues, keywordSet)
					: null;

			const problem = check.ok
				? keywordUsageError(spokenText, keywordSet)
				: check.error || "invalid SRT";
			const attemptMs = Date.now() - attemptT0;

			if (!problem && check.srt && plainScript) {
				const keywords = {
					longTail: {
						keyword: keywordSet.longTail,
						count: keywordCount(spokenText, keywordSet.longTail),
						min: SEO_LONG_FREQ_MIN,
						max: null
					},
					short: keywordSet.shorts.map((kw) => ({
						keyword: kw,
						count: keywordCount(spokenText, kw),
						min: SEO_SHORT_FREQ_MIN,
						max: null
					}))
				};

				const totalMs = Date.now() - startedAt;
				writerTrace.push({
					attempt,
					ok: true,
					ms: attemptMs,
					cueCount: check.cues ? check.cues.length : 0,
					endMs: check.endMs,
					spokenWords: spokenWordCount
				});

				console.log("[script] ok", {
					reqId,
					attempt,
					ms: attemptMs,
					totalMs,
					scriptChars: plainScript.length,
					cueCount: check.cues ? check.cues.length : 0,
					endMs: check.endMs,
					spokenWords: spokenWordCount,
					wordTarget,
					strippedTrailingLines: check.strippedTrailingLines || 0,
					title: keywordSet.title,
					headingsCount: keywordSet.headings.length,
					longTail:
						keywords.longTail.keyword + " x" + keywords.longTail.count,
					shorts: keywords.short.map(
						(x) => x.keyword + " x" + x.count
					)
				});

				/*
				 * The client receives PLAIN narration text only (see the
				 * OUTPUT FORMAT note at the top of this file): the Script box
				 * shows it, the voiceover speaks it verbatim, and no subtitle
				 * formatting crosses the wire. `durationMs` is the verified
				 * cue span, kept so the UI can state the script length
				 * without parsing anything.
				 */
				const okPayload: Record<string, unknown> = {
					success: true,
					script: plainScript,
					format: "plain",
					title: keywordSet.title,
					headings: keywordSet.headings,
					keywords,
					lines: check.cues ? check.cues.length : 0,
					words: spokenWordCount,
					durationMs: check.endMs || 0,
					minutes: minutes,
					model: scriptModel
				};
				if (debugRequested) {
					okPayload.debug = {
						reqId,
						totalMs,
						plannerAttempts: plannerTrace,
						writerAttempts: writerTrace
					};
				}
				return scriptJson(okPayload, 200);
			}

			lastError = problem;
			prevCheck = check;
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
				failureStage: check.ok ? "seo" : "srt",
				reason: lastError,
				cueCount: check.cues ? check.cues.length : 0,
				endMs: check.endMs ?? null,
				spokenWords: spokenWordCount,
				keywordAudit: auditSummary
			});

			console.warn("[script] invalid", {
				reqId,
				attempt,
				ms: attemptMs,
				failureStage: check.ok ? "seo" : "srt",
				reason: lastError,
				srtValid: check.ok,
				cueCount: check.cues ? check.cues.length : 0,
				endMs: check.endMs ?? null,
				maxAllowedMs,
				spokenWords: spokenWordCount,
				wordTarget,
				strippedTrailingLines: check.strippedTrailingLines || 0,
				keywordAudit: auditSummary,
				rawChars: rawSrt.length,
				rawPreview: check.ok
					? undefined
					: rawSrt.replace(/\s+/g, " ").slice(0, 260)
			});
		}

		const totalMs = Date.now() - startedAt;
		console.error("[script] exhausted", {
			reqId,
			attempts: 3,
			lastReason: lastError,
			totalMs
		});

		const failPayload: Record<string, unknown> = {
			success: false,
			error: "Script output invalid (" + lastError + ") - try again"
		};
		if (debugRequested) {
			failPayload.debug = {
				reqId,
				totalMs,
				plannerAttempts: plannerTrace,
				writerAttempts: writerTrace
			};
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
			stack: err instanceof Error ? err.stack : undefined
		});

		return scriptJson(
			{
				success: false,
				error: message || "Script generation failed"
			},
			500
		);
	}
}
