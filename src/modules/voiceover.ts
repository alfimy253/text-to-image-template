/*
 * Server-side voiceover synthesis (`POST /api/voiceover`).
 *
 * Speaks plain narration scripts in bounded, phonemizer-safe sentence chunks:
 *   1. Sanitizes typography, markdown artefacts, emojis/pictographs, control
 *      and zero-width characters so `@cf/myshell-ai/melotts` never receives
 *      a 0-phoneme or lone-surrogate chunk (`AiError 3043`).
 *   2. Splits on sentence, clause and word boundaries (`<= 400` chars) and
 *      drops/merges punctuation-only fragments without speakable letters or
 *      numbers.
 *   3. Synthesizes each chunk with bounded timeouts, native Workers AI MP3
 *      fallbacks (`@cf/deepgram/aura-2-en`, `@cf/deepgram/aura-1` for English)
 *      when MeloTTS fails, and a validated, time-boxed external fallback.
 *   4. Decodes base64 / stream / typed-array responses without per-byte JS
 *      closures (avoiding Worker CPU-limit 1102 kills) and strips duplicate
 *      ID3v2 headers on chunks 2..N so WebAudio decodes the full duration.
 */

export const VOICEOVER_MODEL = "@cf/myshell-ai/melotts";

export const VOICEOVER_EN_FALLBACK_MODELS = [
	"@cf/deepgram/aura-2-en",
	"@cf/deepgram/aura-1"
] as const;

export const VOICEOVER_FALLBACK_TTS_URL = "https://tts-api.netlify.app/";

export const VOICEOVER_LANGS = [
	"en",
	"zh",
	"es",
	"fr",
	"hi",
	"it",
	"ja",
	"ko"
] as const;

export const VOICEOVER_MAX_CHARS = 8000;
export const VOICEOVER_MAX_CHUNK = 400;
export const VOICEOVER_AI_TIMEOUT_MS = 35_000;
export const VOICEOVER_EXTERNAL_TIMEOUT_MS = 15_000;

/*
 * SESSION 279 — THE WORKER OWNS THE VOICEOVER LADDER.
 *
 * The page used to split the script into <=400 char chunks, request them ONE
 * AT A TIME, assemble the container itself and restart the WHOLE chunk set up
 * to three times when a chunk failed (browser-offload.ts `voiceover()`). For a
 * two-chunk narration that is a 6 s floor per video, and a 25 %-failing TTS
 * model turned three restarts into a dead row - measured in
 * bench/pipeline-sim/results/baseline-scale025.json as 8/9 videos finished.
 *
 * Now the page sends ONE full-text request and this module does the splitting,
 * the retries, the fallbacks and the assembly, through a bounded pool:
 *   - `VOICEOVER_SERVER_CHUNKS` lanes, so a retry fleet cannot multiply load;
 *   - `VOICEOVER_CHUNK_ATTEMPTS` per chunk on the primary model, then the
 *     English fallback models, then the validated external TTS;
 *   - `VOICEOVER_TOTAL_BUDGET_MS` for the whole request: no attempt starts that
 *     the remaining budget cannot finish (the rule script-seo's `attemptSlot()`
 *     established), and every attempt's timeout is clamped to what is left;
 *   - `request.signal` checked at every lane and chunk boundary.
 * The browser chunk endpoint (`chunk: true`) stays exactly as it was, because a
 * cached pre-279 page still calls it.
 */
export const VOICEOVER_SERVER_CHUNKS = 3;
export const VOICEOVER_CHUNK_ATTEMPTS = 3;
export const VOICEOVER_TOTAL_BUDGET_MS = 90_000;
export const VOICEOVER_MIN_ATTEMPT_MS = 2_000;

export interface VoiceoverEnv {
	AI?: {
		run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
	};
}

export interface HandleVoiceoverOptions {
	voiceoverModel?: string;
	fallbackTtsUrl?: string | null;
	fetchImpl?: typeof fetch;
	retryDelayMs?: number;
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=UTF-8",
			"Cache-Control": "no-store"
		}
	});
}

function sliceSurrogateSafe(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	let cap = maxChars;
	if (cap > 0 && cap < text.length) {
		const prev = text.charCodeAt(cap - 1);
		const next = text.charCodeAt(cap);
		if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
			cap--;
		}
	}
	return text.slice(0, cap);
}

/**
 * Normalizes prose so TTS phonemizers never choke on markdown syntax, emojis,
 * lone surrogates, zero-width joiners or typographic punctuation.
 */
export function sanitizeVoiceoverText(raw: unknown, maxChars = VOICEOVER_MAX_CHARS): string {
	let text = String(raw || "");
	if (!text) return "";

	text = text
		/* Markdown links `[label](https://...)` -> `label` */
		.replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]+\)/g, "$1")
		/* Bare HTTP(S) URLs -> space so TTS never phonemizes raw URL punctuation */
		.replace(/https?:\/\/\S+/gi, " ")
		/* Strip fenced/inline backticks and heading/emphasis markers */
		.replace(/`+/g, " ")
		.replace(/(?:^|\s)#{1,6}\s+/g, " ")
		.replace(/[*_~]{2,}/g, " ")
		/* Control & zero-width / variation-selector characters */
		.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\uFE0E\uFE0F\uFEFF]/g, " ")
		/* Emojis & pictographs crash MeloTTS G2P with AiError 3043 */
		.replace(/\p{Extended_Pictographic}/gu, " ")
		/* Typography normalization */
		.replace(/\u2014|\u2013/g, ", ")
		.replace(/\u2026/g, "...")
		.replace(/[\u2018\u2019\u2032]/g, "'")
		.replace(/[\u201C\u201D\u2033]/g, '"')
		.replace(/\u00A0/g, " ")
		/* Drop lone UTF-16 surrogates */
		.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
		.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
		.replace(/\s+/g, " ")
		.trim();

	if (text.length > maxChars) {
		text = sliceSurrogateSafe(text, maxChars).trim();
		/* Remove lone surrogates again just in case slicing exposed one */
		text = text
			.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
			.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
			.trim();
	}

	return text;
}

/** True iff the fragment contains at least one speakable letter or digit. */
export function hasSpeakableContent(text: string): boolean {
	return /[\p{L}\p{N}]/u.test(String(text || ""));
}

function splitLongPiece(piece: string, maxChunk: number): string[] {
	const trimmed = piece.trim();
	if (!trimmed) return [];
	if (trimmed.length <= maxChunk) return [trimmed];

	/* 1. Try splitting on clause punctuation (including CJK clause marks). */
	const clauses = trimmed
		.split(/(?<=[,;:，；、])\s*/)
		.map((part) => part.trim())
		.filter(Boolean);

	if (clauses.length > 1) {
		const packedClauses: string[] = [];
		let cur = "";
		for (const clause of clauses) {
			if (clause.length > maxChunk) {
				if (cur) {
					packedClauses.push(cur);
					cur = "";
				}
				for (const sub of splitByWordsOrSlice(clause, maxChunk)) {
					packedClauses.push(sub);
				}
				continue;
			}
			const next = cur ? cur + " " + clause : clause;
			if (next.length <= maxChunk) {
				cur = next;
			} else {
				if (cur) packedClauses.push(cur);
				cur = clause;
			}
		}
		if (cur) packedClauses.push(cur);
		return packedClauses;
	}

	return splitByWordsOrSlice(trimmed, maxChunk);
}

function splitByWordsOrSlice(text: string, maxChunk: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const out: string[] = [];
	let cur = "";

	for (const word of words) {
		if (word.length > maxChunk) {
			if (cur) {
				out.push(cur);
				cur = "";
			}
			let rest = word;
			while (rest.length > 0) {
				const head = sliceSurrogateSafe(rest, maxChunk);
				if (!head) break;
				out.push(head);
				rest = rest.slice(head.length);
			}
			continue;
		}
		const candidate = cur ? cur + " " + word : word;
		if (candidate.length <= maxChunk) {
			cur = candidate;
		} else {
			if (cur) out.push(cur);
			cur = word;
		}
	}
	if (cur) out.push(cur);
	return out;
}

/**
 * Splits a sanitized script into phonemizer-safe chunks `<= maxChunk` chars,
 * guaranteeing every returned chunk contains speakable letters or numbers.
 */
export function splitVoiceoverChunks(text: string, maxChunk = VOICEOVER_MAX_CHUNK): string[] {
	/*
	 * A lone surrogate is not speakable and is not valid UTF-8: MeloTTS answers
	 * it with AiError 3043 and JSON.stringify of the chunk emits U+FFFD.
	 * `sanitizeVoiceoverText` already drops them on the way into the route; this
	 * keeps the guarantee for EVERY caller of the splitter (the legacy chunk
	 * route included). It is the same rule the browser's `voiceChunks()` applied
	 * while the page owned the splitting.
	 */
	const clean = String(text || "")
		.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
		.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!clean || !hasSpeakableContent(clean)) return [];

	const limit = Math.max(80, Math.min(Number(maxChunk) || VOICEOVER_MAX_CHUNK, 500));

	/* Match Western & CJK sentence endings so non-English scripts split cleanly too. */
	const rawSentences =
		clean.match(/[^.!?。！？\u2026]+(?:[.!?。！？\u2026]+|$)/g) || [clean];

	const units: string[] = [];
	for (const raw of rawSentences) {
		const trimmed = raw.trim();
		if (!trimmed || !hasSpeakableContent(trimmed)) continue;
		if (trimmed.length <= limit) {
			units.push(trimmed);
		} else {
			for (const piece of splitLongPiece(trimmed, limit)) {
				if (hasSpeakableContent(piece)) {
					units.push(piece);
				}
			}
		}
	}

	const chunks: string[] = [];
	let current = "";
	for (const unit of units) {
		if (!current) {
			current = unit;
			continue;
		}
		const joined = current + " " + unit;
		if (joined.length <= limit) {
			current = joined;
		} else {
			if (hasSpeakableContent(current)) chunks.push(current);
			current = unit;
		}
	}
	if (current && hasSpeakableContent(current)) {
		chunks.push(current);
	}

	return chunks;
}

/**
 * Fast base64 decoder with zero per-byte JS callback allocations so multi-MB
 * voiceover payloads never trip Cloudflare Workers' CPU limit (`Error 1102`).
 */
export function decodeBase64Audio(b64: string): Uint8Array {
	const cleaned = String(b64 || "")
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
		Buffer?: { from: (input: string, encoding: string) => Uint8Array };
	}).Buffer;
	if (globalBuf && typeof globalBuf.from === "function") {
		const buf = globalBuf.from(cleaned, "base64");
		return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
	}

	const binary = atob(cleaned);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

async function readStreamBytes(stream: {
	getReader: () => {
		read: () => Promise<{ done: boolean; value?: Uint8Array }>;
	};
}): Promise<Uint8Array> {
	const reader = stream.getReader();
	const parts: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value && value.byteLength) {
			const chunk =
				value instanceof Uint8Array
					? value
					: new Uint8Array(
							(value as ArrayBufferView).buffer,
							(value as ArrayBufferView).byteOffset,
							(value as ArrayBufferView).byteLength
						);
			parts.push(chunk);
			total += chunk.byteLength;
		}
	}
	if (parts.length === 1) return parts[0];
	const joined = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		joined.set(part, offset);
		offset += part.byteLength;
	}
	return joined;
}

/** Normalizes every Workers AI TTS return shape into a `Uint8Array`. */
export async function extractTtsAudioBytes(result: unknown): Promise<Uint8Array | null> {
	if (!result) return null;
	if (result instanceof Uint8Array) return result;
	if (result instanceof ArrayBuffer) return new Uint8Array(result);
	if (ArrayBuffer.isView(result)) {
		return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
	}
	if (typeof Response !== "undefined" && result instanceof Response) {
		return new Uint8Array(await result.arrayBuffer());
	}
	if (
		typeof ReadableStream !== "undefined" &&
		result instanceof ReadableStream
	) {
		return new Uint8Array(await new Response(result).arrayBuffer());
	}
	if (
		typeof result === "object" &&
		typeof (result as { getReader?: unknown }).getReader === "function"
	) {
		return readStreamBytes(
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
	if (typeof result === "string" && result.trim().length > 0) {
		try {
			return decodeBase64Audio(result);
		} catch {
			return null;
		}
	}
	if (typeof result === "object") {
		const rec = result as Record<string, unknown>;
		if (typeof rec.audio === "string" && rec.audio.trim().length > 0) {
			try {
				return decodeBase64Audio(rec.audio);
			} catch {
				return null;
			}
		}
		if (rec.audio && typeof rec.audio === "object") {
			return extractTtsAudioBytes(rec.audio);
		}
		if (Array.isArray(rec.audio)) {
			return Uint8Array.from(rec.audio as number[]);
		}
	}
	return null;
}

/** Rejects HTML / JSON error payloads masquerading as HTTP 200 audio bytes. */
export function looksLikeAudioBytes(
	bytes: Uint8Array | null | undefined,
	contentType = ""
): boolean {
	if (!bytes || bytes.byteLength === 0) return false;
	const ct = String(contentType || "").toLowerCase();
	if (
		ct.startsWith("text/html") ||
		ct.startsWith("text/plain") ||
		ct.startsWith("application/json")
	) {
		return false;
	}
	/* Skip leading ASCII whitespace to check for HTML or JSON text payloads. */
	let idx = 0;
	while (
		idx < bytes.byteLength &&
		idx < 32 &&
		(bytes[idx] === 0x20 ||
			bytes[idx] === 0x09 ||
			bytes[idx] === 0x0a ||
			bytes[idx] === 0x0d)
	) {
		idx++;
	}
	if (idx + 4 <= bytes.byteLength) {
		const head = String.fromCharCode(
			bytes[idx],
			bytes[idx + 1],
			bytes[idx + 2],
			bytes[idx + 3]
		).toLowerCase();
		if (
			head === "<!do" ||
			head === "<htm" ||
			head === "<hea" ||
			head === "<bod" ||
			head.startsWith("{\"") ||
			head.startsWith("[{")
		) {
			return false;
		}
	}
	return true;
}

/**
 * Strips a leading ID3v2 tag (10-byte header + synchsafe 28-bit size) so
 * chunks 2..N append clean MPEG frames without restarting metadata headers.
 */
export function stripMp3Id3Tag(bytes: Uint8Array): Uint8Array {
	if (
		bytes.byteLength < 10 ||
		bytes[0] !== 0x49 || /* I */
		bytes[1] !== 0x44 || /* D */
		bytes[2] !== 0x33 /* 3 */
	) {
		return bytes;
	}
	const flags = bytes[5];
	const size =
		((bytes[6] & 0x7f) << 21) |
		((bytes[7] & 0x7f) << 14) |
		((bytes[8] & 0x7f) << 7) |
		(bytes[9] & 0x7f);
	let start = 10 + size;
	if (flags & 0x10) {
		/* ID3v2.4 footer present (10 bytes) */
		start += 10;
	}
	return start < bytes.byteLength ? bytes.subarray(start) : bytes;
}

export function isWavBytes(p: Uint8Array): boolean {
	return (
		p.byteLength > 12 &&
		p[0] === 0x52 &&
		p[1] === 0x49 &&
		p[2] === 0x46 &&
		p[3] === 0x46
	);
}

function findWavChunk(
	p: Uint8Array,
	id: string
): { off: number; sz: number } | null {
	const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
	let off = 12;
	while (off + 8 <= p.byteLength) {
		const tag = String.fromCharCode(p[off], p[off + 1], p[off + 2], p[off + 3]);
		const sz = dv.getUint32(off + 4, true);
		if (tag === id) {
			return { off: off + 8, sz: Math.min(sz, p.byteLength - (off + 8)) };
		}
		off += 8 + sz + (sz % 2);
	}
	return null;
}

export function joinVoiceoverPieces(pieces: Uint8Array[]): {
	bytes: Uint8Array;
	audioType: string;
	audioName: string;
} {
	if (pieces.length > 0 && pieces.every(isWavBytes)) {
		const fmtRef = findWavChunk(pieces[0], "fmt ");
		const fmtBytes = fmtRef
			? pieces[0].subarray(fmtRef.off, fmtRef.off + fmtRef.sz)
			: new Uint8Array(16);

		/*
		 * The joined file carries ONE fmt chunk, so every piece has to be the
		 * same PCM format and its data has to be a whole number of frames.
		 * Concatenating anything else is not a join, it is noise - and the
		 * browser assembly this replaced refused it for the same reason.
		 */
		const fmtDv = fmtBytes.byteLength >= 14
			? new DataView(fmtBytes.buffer, fmtBytes.byteOffset, fmtBytes.byteLength)
			: null;
		const blockAlign = fmtDv ? fmtDv.getUint16(12, true) : 0;
		for (const piece of pieces) {
			const ref = findWavChunk(piece, "fmt ");
			const fmt = ref ? piece.subarray(ref.off, ref.off + ref.sz) : null;
			if (
				!fmt ||
				fmt.byteLength !== fmtBytes.byteLength ||
				fmt.some((value, index) => value !== fmtBytes[index])
			) {
				throw new Error("WAV sample formats differ across voiceover chunks");
			}
			const data = findWavChunk(piece, "data");
			if (!data || data.sz === 0 || (blockAlign > 0 && data.sz % blockAlign !== 0)) {
				throw new Error("WAV block alignment does not match the data chunk");
			}
		}

		const dataParts: Uint8Array[] = [];
		for (const piece of pieces) {
			const dRef = findWavChunk(piece, "data");
			if (dRef) {
				dataParts.push(piece.subarray(dRef.off, dRef.off + dRef.sz));
			}
		}

		const totalData = dataParts.reduce((sum, d) => sum + d.byteLength, 0);
		const outBytes = new Uint8Array(28 + fmtBytes.byteLength + totalData);
		outBytes[0] = 0x52;
		outBytes[1] = 0x49;
		outBytes[2] = 0x46;
		outBytes[3] = 0x46;
		outBytes[8] = 0x57;
		outBytes[9] = 0x41;
		outBytes[10] = 0x56;
		outBytes[11] = 0x45;

		const outDv = new DataView(outBytes.buffer);
		outDv.setUint32(4, outBytes.byteLength - 8, true);

		outBytes[12] = 0x66;
		outBytes[13] = 0x6d;
		outBytes[14] = 0x74;
		outBytes[15] = 0x20;
		outDv.setUint32(16, fmtBytes.byteLength, true);
		outBytes.set(fmtBytes, 20);

		const dataOff = 20 + fmtBytes.byteLength;
		outBytes[dataOff] = 0x64;
		outBytes[dataOff + 1] = 0x61;
		outBytes[dataOff + 2] = 0x74;
		outBytes[dataOff + 3] = 0x61;
		outDv.setUint32(dataOff + 4, totalData, true);

		let dOff = dataOff + 8;
		for (const part of dataParts) {
			outBytes.set(part, dOff);
			dOff += part.byteLength;
		}

		return {
			bytes: outBytes,
			audioType: "audio/wav",
			audioName: "voiceover.wav"
		};
	}

	/*
	 * Not every piece is WAV (that branch returned), so at least one is a frame
	 * stream: splicing RIFF headers into it produces a file no decoder plays.
	 * The container repair above is what prevents reaching this line; when a
	 * repair could not be afforded, an honest failure the page can report beats
	 * shipping corrupt audio.
	 */
	if (pieces.some(isWavBytes)) {
		throw new Error("Mixed WAV and MP3 voiceover pieces cannot be joined");
	}

	if (pieces.length === 1) {
		return {
			bytes: pieces[0],
			audioType: "audio/mpeg",
			audioName: "voiceover.mp3"
		};
	}

	const normalized = pieces.map((piece, index) =>
		index === 0 ? piece : stripMp3Id3Tag(piece)
	);
	const total = normalized.reduce((sum, p) => sum + p.byteLength, 0);
	const outBytes = new Uint8Array(total);
	let offset = 0;
	for (const part of normalized) {
		outBytes.set(part, offset);
		offset += part.byteLength;
	}
	return {
		bytes: outBytes,
		audioType: "audio/mpeg",
		audioName: "voiceover.mp3"
	};
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(label + " timed out after " + Math.round(ms / 1000) + "s"));
		}, ms);
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

function sleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildModelPayload(
	model: string,
	chunk: string,
	lang: string
): Record<string, unknown> {
	if (model === "@cf/deepgram/aura-2-en") {
		return {
			text: chunk,
			speaker: "luna",
			encoding: "mp3"
		};
	}
	if (model === "@cf/deepgram/aura-1") {
		return {
			text: chunk,
			speaker: "angus",
			encoding: "mp3"
		};
	}
	return {
		prompt: chunk,
		lang
	};
}

export async function handleVoiceover(
	request: Request,
	env: VoiceoverEnv,
	options: HandleVoiceoverOptions = {}
): Promise<Response> {
	try {
		const rawBody = await request.json().catch(() => null);
		if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) return jsonResponse({ error: "Expected a JSON object" }, 400);
		const body = rawBody as Record<string, unknown>;

		const text = sanitizeVoiceoverText(body.text, VOICEOVER_MAX_CHARS);
		const lang = String(body.lang || "en")
			.toLowerCase()
			.trim();

		if (!env || !env.AI || typeof env.AI.run !== "function") {
			console.log("[voiceover] rejected: no AI binding (503)");
			return jsonResponse(
				{ success: false, error: "AI binding not configured" },
				503
			);
		}

		if (!text || !hasSpeakableContent(text)) {
			console.log("[voiceover] rejected: empty text (400)");
			return jsonResponse(
				{ success: false, error: "No script text to speak" },
				400
			);
		}

		if ((VOICEOVER_LANGS as readonly string[]).indexOf(lang) === -1) {
			console.log("[voiceover] rejected: unknown lang (400)", { lang });
			return jsonResponse(
				{ success: false, error: "Unknown voice language" },
				400
			);
		}

		/*
		 * #261 LEGACY CHUNK ROUTE (kept, not owned).
		 *
		 * A page cached before session 279 still splits the script itself, asks
		 * for one chunk at a time and runs its own retry/fallback ladder, so this
		 * route must keep answering exactly one chunk with one inference. Nothing
		 * new may use it: the current page sends the full text and gets the
		 * worker's bounded pool below.
		 */
		if (body.chunk === true) {
			const voiceIndex = body.voiceIndex ?? 0;
			if (typeof body.text !== "string" || body.text.length > VOICEOVER_MAX_CHUNK ||
				!Number.isInteger(voiceIndex) || Number(voiceIndex) < 0 || Number(voiceIndex) > (lang === "en" ? 2 : 0)) {
				return jsonResponse({ error: "Chunk must be at most 400 characters; invalid voice index" }, 400);
			}
			if (request.signal.aborted) return jsonResponse({ error: "Voiceover cancelled" }, 499);
			const model = Number(voiceIndex) === 0 ? (options.voiceoverModel || VOICEOVER_MODEL)
				: VOICEOVER_EN_FALLBACK_MODELS[Number(voiceIndex) - 1];
			try {
				const bytes = await withTimeout((async () => {
					const raw = await env.AI!.run(model, buildModelPayload(model, text, lang));
					return extractTtsAudioBytes(raw);
				})(), VOICEOVER_AI_TIMEOUT_MS, "TTS chunk");
				if (request.signal.aborted) return jsonResponse({ error: "Voiceover cancelled" }, 499);
				if (!bytes || !looksLikeAudioBytes(bytes) ||
					!(isWavBytes(bytes) || (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
						(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) {
					throw new Error("TTS chunk did not contain WAV or MPEG audio");
				}
				return new Response(bytes as BodyInit, { headers: {
					"Content-Type": isWavBytes(bytes) ? "audio/wav" : "audio/mpeg",
					"Cache-Control": "no-store", "X-Voice-Index": String(voiceIndex), "X-Pipeline-Version": "261"
				} });
			} catch {
				return jsonResponse({ error: "TTS chunk failed", retryable: true }, 502);
			}
		}
		const chunks = splitVoiceoverChunks(text, VOICEOVER_MAX_CHUNK);
		if (!chunks.length) {
			return jsonResponse(
				{ success: false, error: "No script text to speak" },
				400
			);
		}

		const primaryModel = options.voiceoverModel || VOICEOVER_MODEL;
		const fallbackUrl =
			options.fallbackTtsUrl === undefined
				? VOICEOVER_FALLBACK_TTS_URL
				: options.fallbackTtsUrl;
		const fetchFn = options.fetchImpl || fetch;
		const retryBaseMs =
			typeof options.retryDelayMs === "number" ? options.retryDelayMs : 400;

		console.log("[voiceover] start", {
			chars: text.length,
			lang,
			chunks: chunks.length,
			sizes: chunks.map((c) => c.length)
		});

		const fetchExternalChunk = async (chunkText: string): Promise<Uint8Array | null> => {
			if (!fallbackUrl) return null;
			const abort =
				typeof AbortController !== "undefined" ? new AbortController() : null;
			const timer = abort
				? setTimeout(() => abort.abort(), VOICEOVER_EXTERNAL_TIMEOUT_MS)
				: null;
			try {
				const fbUrl =
					fallbackUrl +
					"?text=" +
					encodeURIComponent(chunkText) +
					"&lang=" +
					encodeURIComponent(lang);
				const fbResp = await fetchFn(
					fbUrl,
					abort ? { signal: abort.signal } : undefined
				);
				if (fbResp.ok) {
					const fbBytes = new Uint8Array(await fbResp.arrayBuffer());
					const ct = fbResp.headers.get("content-type") || "";
					if (looksLikeAudioBytes(fbBytes, ct)) {
						return fbBytes;
					}
				}
			} catch (fbError) {
				console.log("[voiceover] external fallback TTS error", {
					err: String(fbError)
				});
			} finally {
				if (timer) clearTimeout(timer);
			}
			return null;
		};

		/*
		 * ONE request, N chunks, `VOICEOVER_SERVER_CHUNKS` lanes.
		 *
		 * Everything below is the same ladder the sequential loop ran - sticky
		 * healthy source first, primary model up to VOICEOVER_CHUNK_ATTEMPTS,
		 * English Workers AI fallbacks, validated external TTS - but the chunks
		 * are in flight together instead of one after another, and the whole
		 * request has a deadline no attempt may overrun.
		 */
		const ai = env.AI;
		const startedAt = Date.now();
		const deadlineAt = startedAt + VOICEOVER_TOTAL_BUDGET_MS;
		const remainingMs = (): number => Math.max(0, deadlineAt - Date.now());
		const budgetReason = (): string =>
			"the voiceover budget expired (" +
			VOICEOVER_TOTAL_BUDGET_MS +
			" ms for " +
			chunks.length +
			" chunk(s))";

		/*
		 * The hang guard this strategy has to keep: an attempt only starts when
		 * the remaining budget can still cover it, and its timeout is clamped to
		 * what is left. `null` means "stop the ladder and say why" - never
		 * "start a call whose answer we will throw away".
		 */
		const attemptSlot = (timeoutMs: number): { timeoutMs: number } | null => {
			const left = remainingMs();
			if (left <= 0) return null;
			const slot = Math.min(timeoutMs, left);
			return slot < VOICEOVER_MIN_ATTEMPT_MS ? null : { timeoutMs: slot };
		};

		type ChunkPiece = {
			bytes: Uint8Array;
			source: "primary" | "sticky-ai" | "external";
			model: string;
		};
		type ChunkError = { index: number; message: string; unexpected: boolean };

		const pieces: (ChunkPiece | null)[] = new Array(chunks.length).fill(null);
		/* A source an earlier chunk proved healthy is tried first by later ones. */
		const sticky = { model: null as string | null, external: false };
		const chunkErrors: ChunkError[] = [];
		/*
		 * Ladder state lives in an object on purpose: the lanes mutate it from
		 * inside awaited closures, and a plain `let` is still narrowed to its
		 * initial value by the time the pool settles.
		 */
		const ladder = {
			attempts: 0,
			budgetExhausted: false,
			firstFailure: null as ChunkError | null,
			aborted: false
		};

		const abortedNow = (): boolean => Boolean(request.signal && request.signal.aborted);

		/* Synthesize ONE chunk. Returns null and records why on failure. */
		const synthesizeChunk = async (ci: number): Promise<ChunkPiece | null> => {
			const chunk = chunks[ci];
			let lastError = "";
			let hadNullResult = false;

			const callModel = async (
				model: string,
				label: string,
				wantContainer?: boolean
			): Promise<Uint8Array | null> => {
				if (abortedNow()) return null;
				const slot = attemptSlot(VOICEOVER_AI_TIMEOUT_MS);
				if (!slot) {
					ladder.budgetExhausted = true;
					lastError = budgetReason();
					return null;
				}
				ladder.attempts += 1;
				try {
					const raw = await withTimeout(
						ai.run(model, buildModelPayload(model, chunk, lang)),
						slot.timeoutMs,
						label
					);
					const bytes = await extractTtsAudioBytes(raw);
					if (bytes && looksLikeAudioBytes(bytes)) {
						if (wantContainer === undefined || isWavBytes(bytes) === wantContainer) return bytes;
						lastError = "TTS returned the wrong audio container";
						return null;
					}
					hadNullResult = true;
					return null;
				} catch (modelError) {
					lastError = modelError instanceof Error ? modelError.message : String(modelError);
					console.log("[voiceover] tts error", {
						chunk: ci + 1,
						of: chunks.length,
						model,
						err: lastError
					});
					return null;
				}
			};

			const callExternal = async (wantContainer?: boolean): Promise<Uint8Array | null> => {
				if (!fallbackUrl) return null;
				const slot = attemptSlot(VOICEOVER_EXTERNAL_TIMEOUT_MS);
				if (!slot) {
					ladder.budgetExhausted = true;
					lastError = budgetReason();
					return null;
				}
				ladder.attempts += 1;
				const bytes = await fetchExternalChunk(chunk);
				if (!bytes) return null;
				if (wantContainer !== undefined && isWavBytes(bytes) !== wantContainer) {
					lastError = "external TTS returned the wrong audio container";
					return null;
				}
				return bytes;
			};

			/*
			 * A model or endpoint an earlier chunk already proved healthy goes
			 * first, so a long script does not burn three failing primary calls
			 * per chunk. Under concurrency only chunks that START later see it,
			 * which is why the container repair below still exists.
			 */
			if (sticky.model && sticky.model !== primaryModel) {
				const bytes = await callModel(sticky.model, "TTS model");
				if (bytes) return { bytes, source: "sticky-ai", model: sticky.model };
			} else if (sticky.external) {
				const bytes = await callExternal();
				if (bytes) return { bytes, source: "external", model: "external" };
				sticky.external = false;
			}

			for (let attempt = 1; attempt <= VOICEOVER_CHUNK_ATTEMPTS; attempt++) {
				if (abortedNow()) return null;
				console.log("[voiceover] tts call", {
					model: primaryModel,
					chunk: ci + 1,
					of: chunks.length,
					attempt,
					chars: chunk.length
				});
				const bytes = await callModel(primaryModel, "TTS model");
				if (bytes) return { bytes, source: "primary", model: primaryModel };
				if (ladder.budgetExhausted) break;
				if (attempt < VOICEOVER_CHUNK_ATTEMPTS) {
					/*
					 * Only an exhausted budget ends the ladder. `retryDelayMs: 0`
					 * is a zero WAIT, not a zero budget: reading it as one quietly
					 * shortened the ladder to two attempts (measured by
					 * tests/session-250-batch-pipeline.test.mjs, which counts the
					 * three primary calls before the English fallback).
					 */
					if (remainingMs() <= 0) {
						ladder.budgetExhausted = true;
						lastError = budgetReason();
						break;
					}
					await sleep(Math.min(retryBaseMs * attempt, remainingMs()));
				}
			}

			/* Native Workers AI MP3 fallbacks for English. */
			if (lang === "en") {
				for (const fbModel of VOICEOVER_EN_FALLBACK_MODELS) {
					if (fbModel === primaryModel) continue;
					if (abortedNow() || ladder.budgetExhausted) break;
					const bytes = await callModel(fbModel, "Fallback TTS model");
					if (bytes) {
						sticky.model = fbModel;
						console.log("[voiceover] workers-ai fallback TTS", {
							model: fbModel,
							chunk: ci + 1,
							of: chunks.length,
							bytes: bytes.byteLength
						});
						return { bytes, source: "sticky-ai", model: fbModel };
					}
				}
			}

			if (!ladder.budgetExhausted && !abortedNow()) {
				const bytes = await callExternal();
				if (bytes) {
					sticky.external = true;
					return { bytes, source: "external", model: "external" };
				}
			}

			const failure: ChunkError = {
				index: ci,
				message: hadNullResult && !lastError ? "Unexpected TTS output" : lastError || "empty audio",
				unexpected: hadNullResult && !lastError
			};
			chunkErrors.push(failure);
			if (!ladder.firstFailure) ladder.firstFailure = failure;
			return null;
		};

		/*
		 * The pool. Lanes pull the next chunk index; a failure stops the lanes
		 * from STARTING more work (in-flight chunks are awaited, so nothing is
		 * left floating) and the request reports the first chunk that failed,
		 * exactly as the sequential loop did.
		 */
		const lanes = Math.max(1, Math.min(VOICEOVER_SERVER_CHUNKS, chunks.length));
		let nextIndex = 0;
		const runLane = async (): Promise<void> => {
			for (;;) {
				if (ladder.firstFailure || abortedNow() || remainingMs() <= 0) return;
				const ci = nextIndex++;
				if (ci >= chunks.length) return;
				const piece = await synthesizeChunk(ci);
				if (abortedNow()) {
					ladder.aborted = true;
					return;
				}
				if (!piece) return;
				pieces[ci] = piece;
			}
		};
		await Promise.all(Array.from({ length: lanes }, () => runLane()));

		if (abortedNow() || ladder.aborted) {
			return jsonResponse(
				{ success: false, error: "Voiceover request aborted", attempts: ladder.attempts },
				499
			);
		}
		if (ladder.firstFailure) {
			const failure = ladder.firstFailure;
			return jsonResponse(
				{
					success: false,
					error:
						(failure.unexpected ? "Unexpected TTS output" : "TTS failed") +
						" (chunk " +
						(failure.index + 1) +
						" of " +
						chunks.length +
						"): " +
						failure.message,
					stage: "voiceover",
					chunk: failure.index + 1,
					chunks: chunks.length,
					attempts: ladder.attempts,
					budgetExhausted: ladder.budgetExhausted,
					/* The worker spent its ladder: another identical request
					 * would spend it again. Retryable, but only after a wait. */
					retryable: true,
					retryOwner: "worker"
				},
				ladder.budgetExhausted ? 504 : 500
			);
		}

		/*
		 * Container homogeneity: `joinVoiceoverPieces` concatenates, so WAV and
		 * MP3 must never be mixed. The majority container wins (cheaper than the
		 * old "redo the whole prefix" rule) and only the mismatching chunks are
		 * re-synthesized, through the same bounded slots. If a repair cannot be
		 * afforded or fails, the original bytes are kept - the same fallback the
		 * sequential loop had when its prefix repair did not complete.
		 */
		const finished = pieces.filter((piece): piece is ChunkPiece => Boolean(piece));
		/*
		 * WHICH CONTAINER THE NARRATION ENDS UP IN.
		 *
		 * The source that is healthy RIGHT NOW decides, because it is also the
		 * source that performs the repair below. A two-chunk narration whose
		 * first chunk came back WAV from the primary and whose second came back
		 * MP3 from the English fallback must heal toward MP3: a plain majority
		 * vote ties 1:1 and, with `>=`, healed toward the FAILING container -
		 * it re-synthesized the healthy chunk and shipped a RIFF header. With
		 * nothing sticky the majority still decides, and a tie goes to MP3
		 * (smaller, and what every fallback model produces).
		 */
		const stickyPiece = sticky.model
			? finished.filter((piece) => piece.model === sticky.model).pop()
			: sticky.external
				? finished.filter((piece) => piece.source === "external").pop()
				: undefined;
		const wavVotes = finished.filter((piece) => isWavBytes(piece.bytes)).length;
		const wantWav = stickyPiece
			? isWavBytes(stickyPiece.bytes)
			: wavVotes * 2 > finished.length;
		const mismatched = finished.filter((piece) => isWavBytes(piece.bytes) !== wantWav);
		if (mismatched.length && !abortedNow()) {
			const preferred =
				stickyPiece && isWavBytes(stickyPiece.bytes) === wantWav
					? stickyPiece
					: finished.find(
						(piece) => isWavBytes(piece.bytes) === wantWav && piece.source !== "external"
					);
			for (const piece of mismatched) {
				/* `finished` keeps chunk order, so its index IS the chunk index. */
				const index = finished.indexOf(piece);
				const slot = attemptSlot(VOICEOVER_AI_TIMEOUT_MS);
				if (!slot) {
					ladder.budgetExhausted = true;
					break;
				}
				let repaired: Uint8Array | null = null;
				if (preferred && preferred.model !== primaryModel) {
					ladder.attempts += 1;
					try {
						const raw = await withTimeout(
							ai.run(preferred.model, buildModelPayload(preferred.model, chunks[index], lang)),
							slot.timeoutMs,
							"Fallback TTS model"
						);
						const candidate = await extractTtsAudioBytes(raw);
						if (candidate && looksLikeAudioBytes(candidate) && isWavBytes(candidate) === wantWav) repaired = candidate;
					} catch {
						repaired = null;
					}
				}
				if (!repaired && fallbackUrl) {
					const extSlot = attemptSlot(VOICEOVER_EXTERNAL_TIMEOUT_MS);
					if (extSlot) {
						ladder.attempts += 1;
						const candidate = await fetchExternalChunk(chunks[index]);
						if (candidate && isWavBytes(candidate) === wantWav) repaired = candidate;
					}
				}
				if (repaired) {
					piece.bytes = repaired;
					piece.source = preferred ? "sticky-ai" : "external";
				}
			}
			console.log("[voiceover] container repair", {
				wantWav,
				mismatched: mismatched.length,
				budgetExhausted: ladder.budgetExhausted
			});
		}

		const joinedPieces = finished.map((piece) => piece.bytes);

		const joined = joinVoiceoverPieces(joinedPieces);
		console.log("[voiceover] done", {
			chunks: chunks.length,
			format: joined.audioType,
			bytes: joined.bytes.byteLength,
			attempts: ladder.attempts,
			lanes: Math.max(1, Math.min(VOICEOVER_SERVER_CHUNKS, chunks.length)),
			ms: Date.now() - startedAt,
			budgetMs: VOICEOVER_TOTAL_BUDGET_MS
		});

		const payload = new ArrayBuffer(joined.bytes.byteLength);
		new Uint8Array(payload).set(joined.bytes);

		return new Response(payload, {
			status: 200,
			headers: {
				"Content-Type": joined.audioType,
				"Content-Disposition": "attachment; filename=" + joined.audioName,
				/* What the worker's ladder spent, for the page's status line. */
				"X-Voiceover-Attempts": String(ladder.attempts),
				"X-Voiceover-Chunks": String(chunks.length),
				"X-Retry-Owner": "worker"
			}
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.log("[voiceover] error", { error: msg });
		return jsonResponse({ success: false, error: msg }, 500);
	}
}
