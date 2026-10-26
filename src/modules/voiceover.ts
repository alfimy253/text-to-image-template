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
	const clean = String(text || "").replace(/\s+/g, " ").trim();
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
		const body = (await request.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;

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

		const pieces: Uint8Array[] = [];
		let stickyModel: string | null = null;
		let stickyExternal = false;

		for (let ci = 0; ci < chunks.length; ci++) {
			if (request.signal && request.signal.aborted) {
				return jsonResponse(
					{ success: false, error: "Voiceover request aborted" },
					499
				);
			}

			const chunk = chunks[ci];
			let piece: Uint8Array | null = null;
			let pieceSource: "primary" | "sticky-ai" | "external" = "primary";
			let lastTtsError = "";
			let hadNullResult = false;

			/*
			 * If an earlier chunk already switched onto a healthy native Workers AI
			 * MP3 fallback (Deepgram Aura), try that model first so long scripts do
			 * not burn 3 failing MeloTTS calls per chunk.
			 */
			if (stickyModel && stickyModel !== primaryModel) {
				try {
					const stickyRaw = await withTimeout(
						env.AI.run(stickyModel, buildModelPayload(stickyModel, chunk, lang)),
						VOICEOVER_AI_TIMEOUT_MS,
						"TTS model"
					);
					const bytes = await extractTtsAudioBytes(stickyRaw);
					if (bytes && looksLikeAudioBytes(bytes)) {
						piece = bytes;
						pieceSource = "sticky-ai";
					}
				} catch (stickyErr) {
					lastTtsError =
						stickyErr instanceof Error ? stickyErr.message : String(stickyErr);
					stickyModel = null;
				}
			} else if (stickyExternal && fallbackUrl) {
				const extBytes = await fetchExternalChunk(chunk);
				if (extBytes) {
					piece = extBytes;
					pieceSource = "external";
				} else {
					stickyExternal = false;
				}
			}

			/* Primary model (`@cf/myshell-ai/melotts`) — up to 3 attempts. */
			if (!piece) {
				for (let attempt = 1; attempt <= 3; attempt++) {
					if (request.signal && request.signal.aborted) {
						return jsonResponse(
							{ success: false, error: "Voiceover request aborted" },
							499
						);
					}
					try {
						console.log("[voiceover] tts call", {
							model: primaryModel,
							chunk: ci + 1,
							of: chunks.length,
							attempt,
							chars: chunk.length,
							preview: chunk.slice(0, 60)
						});
						const raw = await withTimeout(
							env.AI.run(
								primaryModel,
								buildModelPayload(primaryModel, chunk, lang)
							),
							VOICEOVER_AI_TIMEOUT_MS,
							"TTS model"
						);
						const bytes = await extractTtsAudioBytes(raw);
						if (bytes && looksLikeAudioBytes(bytes)) {
							piece = bytes;
							pieceSource = "primary";
							lastTtsError = "";
							break;
						}
						hadNullResult = true;
						if (attempt < 3) {
							await sleep(retryBaseMs * attempt);
						}
					} catch (ttsError) {
						lastTtsError =
							ttsError instanceof Error ? ttsError.message : String(ttsError);
						console.log("[voiceover] tts error", {
							chunk: ci + 1,
							of: chunks.length,
							attempt,
							err: lastTtsError
						});
						if (attempt < 3) {
							await sleep(retryBaseMs * attempt);
						}
					}
				}
			}

			/* Native Workers AI MP3 fallbacks for English when MeloTTS fails or returns empty bytes. */
			if (!piece && lang === "en") {
				for (const fbModel of VOICEOVER_EN_FALLBACK_MODELS) {
					if (fbModel === primaryModel) continue;
					try {
						const fbRaw = await withTimeout(
							env.AI.run(fbModel, buildModelPayload(fbModel, chunk, lang)),
							VOICEOVER_AI_TIMEOUT_MS,
							"Fallback TTS model"
						);
						const bytes = await extractTtsAudioBytes(fbRaw);
						if (bytes && looksLikeAudioBytes(bytes)) {
							piece = bytes;
							pieceSource = "sticky-ai";
							stickyModel = fbModel;
							lastTtsError = "";
							console.log("[voiceover] workers-ai fallback TTS", {
								model: fbModel,
								chunk: ci + 1,
								of: chunks.length,
								bytes: bytes.byteLength
							});
							break;
						}
					} catch (fbModelErr) {
						console.log("[voiceover] workers-ai fallback TTS error", {
							model: fbModel,
							chunk: ci + 1,
							of: chunks.length,
							err:
								fbModelErr instanceof Error
									? fbModelErr.message
									: String(fbModelErr)
						});
					}
				}
			}

			/* External HTTP fallback (time-boxed + content-validated). */
			if (!piece && fallbackUrl) {
				const fbBytes = await fetchExternalChunk(chunk);
				if (fbBytes) {
					piece = fbBytes;
					pieceSource = "external";
					stickyExternal = true;
					lastTtsError = "";
				}
			}

			if (!piece || piece.byteLength === 0) {
				if (hadNullResult && !lastTtsError) {
					return jsonResponse(
						{
							success: false,
							error:
								"Unexpected TTS output (chunk " +
								(ci + 1) +
								" of " +
								chunks.length +
								")"
						},
						500
					);
				}
				return jsonResponse(
					{
						success: false,
						error:
							"TTS failed (chunk " +
							(ci + 1) +
							" of " +
							chunks.length +
							"): " +
							(lastTtsError || "empty audio")
					},
					500
				);
			}

			/*
			 * Guard against WAV + MP3 hybrid corruption: if chunk 0..ci-1 were WAV
			 * (e.g. MeloTTS returned RIFF/WAVE) and chunk ci failed over to an MP3
			 * fallback (or vice versa), re-synthesize earlier chunks on the working
			 * fallback so `joinVoiceoverPieces` always receives a 100% homogeneous
			 * container and consistent voice.
			 */
			if (pieces.length > 0 && isWavBytes(piece) !== isWavBytes(pieces[0])) {
				const replacementPrefix: Uint8Array[] = [];
				let prefixOk = true;
				for (let prevIdx = 0; prevIdx < ci; prevIdx++) {
					let reBytes: Uint8Array | null = null;
					if (pieceSource === "sticky-ai" && stickyModel) {
						try {
							const reRaw = await withTimeout(
								env.AI.run(
									stickyModel,
									buildModelPayload(stickyModel, chunks[prevIdx], lang)
								),
								VOICEOVER_AI_TIMEOUT_MS,
								"Fallback TTS model"
							);
							const candidate = await extractTtsAudioBytes(reRaw);
							if (
								candidate &&
								looksLikeAudioBytes(candidate) &&
								isWavBytes(candidate) === isWavBytes(piece)
							) {
								reBytes = candidate;
							}
						} catch {
							reBytes = null;
						}
					} else if (pieceSource === "external" && fallbackUrl) {
						const candidate = await fetchExternalChunk(chunks[prevIdx]);
						if (candidate && isWavBytes(candidate) === isWavBytes(piece)) {
							reBytes = candidate;
						}
					}
					if (!reBytes) {
						prefixOk = false;
						break;
					}
					replacementPrefix.push(reBytes);
				}
				if (prefixOk && replacementPrefix.length === pieces.length) {
					for (let prevIdx = 0; prevIdx < replacementPrefix.length; prevIdx++) {
						pieces[prevIdx] = replacementPrefix[prevIdx];
					}
				}
			}

			pieces.push(piece);
		}

		const joined = joinVoiceoverPieces(pieces);
		console.log("[voiceover] done", {
			chunks: chunks.length,
			format: joined.audioType,
			bytes: joined.bytes.byteLength
		});

		const payload = new ArrayBuffer(joined.bytes.byteLength);
		new Uint8Array(payload).set(joined.bytes);

		return new Response(payload, {
			status: 200,
			headers: {
				"Content-Type": joined.audioType,
				"Content-Disposition": "attachment; filename=" + joined.audioName
			}
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.log("[voiceover] error", { error: msg });
		return jsonResponse({ success: false, error: msg }, 500);
	}
}
