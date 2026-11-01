/*
 * ---------------------------------------------------------------------------
 * SCRIPT NOTES — the cheap half of the scriptwriting pipeline.
 *
 * WHY THIS FILE EXISTS
 *
 * The script route used to be "plan from scratch, then write from scratch,
 * then regenerate the WHOLE SRT whenever any validation step complained"
 * (see current_code_latest.md for the measured breakdown). Everything the two
 * model calls discover — the SEO keyword set, the section headings, the facts
 * of a source URL, and the beat plan with per-section word budgets — was
 * thrown away when the response was sent, so the next request paid for all of
 * it again.
 *
 * A NOTE is that discarded work written down:
 *
 *   - keyed by a DYNAMIC URL (or by the topic when the user pasted no URL),
 *     so `GET /api/script/notes/<id>` is a real, poll-able resource;
 *   - created cheaply, without any model call, by reading the page behind the
 *     URL (title / description / headings / keywords) — a "note";
 *   - handed to the SRT writer as a REFERENCE NOTE, so the writer writes to a
 *     known beat plan instead of inventing one (fewer failed attempts);
 *   - written back after a run, so the next request for the same topic/URL
 *     skips the planner entirely (Stage 1) and starts writing immediately.
 *
 * A note also carries the deterministic keyword repair used by the writer
 * loop: when the SRT is valid but one keyword is one or two uses short, the
 * deficit is patched into existing cues instead of asking the 8B model for a
 * third full regeneration (the single biggest latency sink in the pipeline).
 * ---------------------------------------------------------------------------
 */

import {
	SEO_LONG_FREQ_MIN,
	SEO_SHORT_FREQ_MIN,
	keywordCount,
	keywordUsageAudit,
	type ParsedSrtCue,
	type PlannedKeywordSet
} from "./script-seo";

/* ------------------------------------------------------------------------- */
/* Types                                                                      */
/* ------------------------------------------------------------------------- */

export type ScriptNoteState =
	| "empty"
	| "researching"
	| "queued"
	| "planning"
	| "writing"
	| "repairing"
	| "done"
	| "error";

export interface ScriptNoteSource {
	url: string;
	status: "fetched" | "unreachable" | "not-a-url";
	title: string;
	description: string;
	headings: string[];
	keywords: string[];
	/* First sentences of the page, already trimmed for prompt use. */
	facts: string[];
	ms: number;
	error?: string;
}

export interface ScriptNoteBeat {
	heading: string;
	beat: string;
	words: number;
}

export interface ScriptNoteTimings {
	planMs: number;
	writeMs: number;
	totalMs: number;
	/* Model calls the note saved on this run (0 = cold note). */
	savedModelCalls: number;
	savedMs: number;
}

export interface ScriptNote {
	id: string;
	topic: string;
	sourceUrl: string;
	minutes: number;
	speed: string;
	state: ScriptNoteState;
	createdAt: number;
	updatedAt: number;
	hits: number;
	runs: number;
	source?: ScriptNoteSource;
	keywordSet?: PlannedKeywordSet;
	outline: ScriptNoteBeat[];
	script?: string;
	durationMs?: number;
	model?: string;
	timings?: ScriptNoteTimings;
	lastError?: string;
	/* Set once deterministic repair replaced a model regeneration. */
	repairedKeywords?: string[];
	/* When the CURRENT run was accepted/started (staleness watchdog). */
	runStartedAt?: number;
	/* The wall-clock budget that run promised (0/absent = the default). */
	deadlineMs?: number;
	/* Machine-readable failure reason, e.g. SCRIPT_NOTE_STALE. */
	errorCode?: string;
	/* Where the keyword set/beat plan last came from. */
	origin?: "server" | "browser";
	/* The exact success payload the sync route returns, so an async poller
	 * receives the same shape it would have received directly. */
	payload?: Record<string, unknown>;
}

/* Minimal KV surface we need; `env.KV_BINDING` satisfies it. */
export interface ScriptNoteKv {
	get(key: string): Promise<string | null>;
	put(
		key: string,
		value: string,
		options?: { expirationTtl?: number }
	): Promise<unknown>;
	delete?(key: string): Promise<unknown>;
}

export interface ScriptNoteStore {
	get(id: string): Promise<ScriptNote | null>;
	put(note: ScriptNote, ttlSeconds?: number): Promise<void>;
	delete?(id: string): Promise<void>;
}

export const SCRIPT_NOTE_PREFIX = "script-note:";
export const SCRIPT_NOTE_TTL_SECONDS = 60 * 60 * 24 * 7;
/* A note older than this is refreshed from the URL before it is trusted. */
export const SCRIPT_NOTE_RESEARCH_TTL_MS = 1000 * 60 * 60 * 12;

/*
 * A note is a PROMISE: once a ticket is handed to the browser the note must
 * eventually reach a terminal state, even if the isolate that accepted the job
 * dies before it can run it. Two budgets make that true without a background
 * daemon:
 *
 *   - QUEUE_GRACE_MS  a note may sit in `queued` this long (queue wait) before
 *                     the next reader declares it stale;
 *   - DEADLINE_MS     a run that has started gets this long in total
 *                     (planner 45 s + writer 90 s + one repair + research).
 *
 * The reader-side check (handleScriptNoteRead) is what saves us: it runs in a
 * FRESH isolate, so it works precisely when the runner is gone.
 */
export const SCRIPT_NOTE_QUEUE_GRACE_MS = 90000;
export const SCRIPT_NOTE_DEADLINE_MS = 240000;

/*
 * The browser's half of the same contract, advertised through
 * /api/capabilities so the page never has to hard-code a guess:
 *
 *   CLIENT_WAIT_MS  wall-clock ceiling for one script (185 s < the 240 s note
 *                   deadline, so the note's watchdog always outlives the page);
 *   CLIENT_STALL_MS no state change for this long means the note stopped
 *                   advancing; the page re-reads once and then gives up.
 */
export const SCRIPT_NOTE_CLIENT_WAIT_MS = 185000;
export const SCRIPT_NOTE_CLIENT_STALL_MS = 15000;
/* Hard cap on how long one note costs the request that warms it. */
export const SCRIPT_NOTE_FETCH_TIMEOUT_MS = 4000;
export const SCRIPT_NOTE_MAX_HTML_BYTES = 400 * 1024;

/* ------------------------------------------------------------------------- */
/* Dynamic URL keying                                                         */
/* ------------------------------------------------------------------------- */

const TRACKING_PARAMS = [
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_term",
	"utm_content",
	"utm_id",
	"gclid",
	"fbclid",
	"msclkid",
	"mc_cid",
	"mc_eid",
	"igshid",
	"ref",
	"ref_src",
	"referrer",
	"session",
	"sessionid",
	"sid",
	"tracking",
	"timestamp",
	"_t"
];

/*
 * Canonicalizes a "dynamic" URL: campaign/session parameters, fragments,
 * duplicate slashes, default ports, trailing slashes and URL case differences
 * must all land on the SAME note, otherwise the same article would be
 * re-researched on every click and the note would never be warm.
 */
export function canonicalSourceUrl(raw: unknown): string {
	const text = String(raw ?? "").trim();
	if (!text) return "";
	/* Bare domains ("example.com/post") are accepted as dynamic URLs too. */
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
		? text
		: /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\//i.test(text)
			? "https://" + text
			: "";
	if (!withScheme) return "";
	let parsed: URL;
	try {
		parsed = new URL(withScheme);
	} catch {
		return "";
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
	parsed.hash = "";
	parsed.username = "";
	parsed.password = "";

	const keep: Array<[string, string]> = [];
	parsed.searchParams.forEach((value, name) => {
		if (TRACKING_PARAMS.indexOf(name.toLowerCase()) !== -1) return;
		keep.push([name, value]);
	});
	keep.sort((a, b) =>
		a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1
	);
	const search = keep.length
		? "?" +
			keep
				.map(
					([name, value]) =>
						encodeURIComponent(name) +
						(value ? "=" + encodeURIComponent(value) : "")
				)
				.join("&")
		: "";
	const path = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
	const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
	const port =
		parsed.port && parsed.port !== "80" && parsed.port !== "443"
			? ":" + parsed.port
			: "";
	return parsed.protocol + "//" + host + port + (path || "/") + search;
}

/*
 * A human topic derived from a dynamic URL, for the prompts. Pasting
 * "https://blog.example.com/morning-yoga-routine/" must not make the planner
 * write a script about a URL, and waiting for the researched page title would
 * serialize the planner behind the fetch — so the slug is used instead
 * ("morning yoga routine"), and the writer upgrades it to the real title once
 * the research lands.
 */
export function topicFromUrl(raw: unknown): string {
	const url = canonicalSourceUrl(raw);
	if (!url) return "";
	let pathname = "/";
	let host = "";
	try {
		const parsed = new URL(url);
		pathname = parsed.pathname;
		host = parsed.hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
	const segments = pathname.split("/").filter(Boolean);
	const last = segments.length ? segments[segments.length - 1] : "";
	const readable = decodeURIComponent(last)
		.replace(/\.[a-z0-9]{1,5}$/i, "")
		.replace(/[-_+]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (readable && readable.length >= 3 && !/^\d+$/.test(readable)) return readable.slice(0, 120);
	const hostWords = host.split(".").slice(0, -1).join(" ").replace(/[-_+]+/g, " ").trim();
	return hostWords.slice(0, 120);
}

/* Stable, short, URL-safe ids: same input ⇒ same note forever. */
export function noteHash(input: string): string {
	let hash = 0x811c9dc5;
	const text = String(input || "");
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	const second = (hash ^ (text.length * 2654435761)) >>> 0;
	return (
		hash.toString(16).padStart(8, "0").slice(0, 6) +
		second.toString(16).padStart(8, "0").slice(0, 4)
	);
}

/*
 * The note id is the dynamic URL when there is one, plus the script shape.
 * A different minute count or speed is a different beat plan, so it is a
 * different note; the keyword set is shared through the URL alone.
 */
export function scriptNoteId(input: {
	topic?: unknown;
	sourceUrl?: unknown;
	minutes?: unknown;
	speed?: unknown;
}): string {
	const url = canonicalSourceUrl(input.sourceUrl);
	const topic = String(input.topic ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
		.slice(0, 160);
	const minutes = Number(input.minutes) > 0 ? Number(input.minutes) : 1;
	const speed = String(input.speed || "medium").toLowerCase().trim();
	return (
		"nt-" +
		noteHash(
			"v1|" + (url || "topic:" + topic) + "|" + minutes + "|" + speed
		)
	);
}

export function isScriptNoteId(value: unknown): boolean {
	return /^nt-[a-z0-9]{8,16}$/.test(String(value ?? ""));
}

/* ------------------------------------------------------------------------- */
/* Stores (KV first, in-memory fallback)                                      */
/* ------------------------------------------------------------------------- */

const memoryNotes = new Map<string, { note: ScriptNote; expiresAt: number }>();
export const SCRIPT_NOTE_MEMORY_LIMIT = 200;

export function noteMemoryStore(): ScriptNoteStore {
	return {
		async get(id) {
			const hit = memoryNotes.get(id);
			if (!hit) return null;
			if (hit.expiresAt <= Date.now()) {
				memoryNotes.delete(id);
				return null;
			}
			/* Callers mutate the note; never hand out the live object. */
			return cloneNote(hit.note);
		},
		async put(note, ttlSeconds = SCRIPT_NOTE_TTL_SECONDS) {
			memoryNotes.delete(note.id);
			memoryNotes.set(note.id, {
				note: cloneNote(note),
				expiresAt: Date.now() + ttlSeconds * 1000
			});
			while (memoryNotes.size > SCRIPT_NOTE_MEMORY_LIMIT) {
				const oldest = memoryNotes.keys().next().value;
				if (oldest === undefined) break;
				memoryNotes.delete(oldest);
			}
		},
		async delete(id) {
			memoryNotes.delete(id);
		}
	};
}

export function clearScriptNoteMemory(): void {
	memoryNotes.clear();
}

export function kvNoteStore(kv: ScriptNoteKv): ScriptNoteStore {
	return {
		async get(id) {
			try {
				const raw = await kv.get(SCRIPT_NOTE_PREFIX + id);
				if (!raw) return null;
				const parsed = JSON.parse(String(raw)) as ScriptNote;
				return parsed && parsed.id ? parsed : null;
			} catch {
				return null;
			}
		},
		async put(note, ttlSeconds = SCRIPT_NOTE_TTL_SECONDS) {
			try {
				await kv.put(SCRIPT_NOTE_PREFIX + note.id, JSON.stringify(note), {
					expirationTtl: ttlSeconds
				});
			} catch {
				/* A note is an optimisation: never fail a script over it. */
			}
		},
		async delete(id) {
			try {
				if (kv.delete) await kv.delete(SCRIPT_NOTE_PREFIX + id);
			} catch {
				/* best effort */
			}
		}
	};
}

/*
 * Reads from KV, but also mirrors into the in-process cache so two requests
 * inside the same Worker isolate (and every test without a KV binding) still
 * hit a warm note.
 */
export function scriptNoteStore(env: { KV_BINDING?: ScriptNoteKv } | undefined): ScriptNoteStore {
	const memory = noteMemoryStore();
	const kv =
		env && env.KV_BINDING && typeof env.KV_BINDING.get === "function"
			? kvNoteStore(env.KV_BINDING)
			: null;
	if (!kv) return memory;
	return {
		async get(id) {
			const cached = await memory.get(id);
			if (cached) return cached;
			const stored = await kv.get(id);
			if (stored) await memory.put(stored);
			return stored;
		},
		async put(note, ttlSeconds) {
			await Promise.all([memory.put(note, ttlSeconds), kv.put(note, ttlSeconds)]);
		},
		async delete(id) {
			await Promise.all([
				memory.delete ? memory.delete(id) : Promise.resolve(),
				kv.delete ? kv.delete(id) : Promise.resolve()
			]);
		}
	};
}

function cloneNote(note: ScriptNote): ScriptNote {
	return JSON.parse(JSON.stringify(note)) as ScriptNote;
}

export function emptyScriptNote(input: {
	id: string;
	topic: string;
	sourceUrl?: string;
	minutes?: number;
	speed?: string;
}): ScriptNote {
	const now = Date.now();
	return {
		id: input.id,
		topic: input.topic,
		sourceUrl: canonicalSourceUrl(input.sourceUrl),
		minutes: Number(input.minutes) > 0 ? Number(input.minutes) : 1,
		speed: String(input.speed || "medium"),
		state: "empty",
		createdAt: now,
		updatedAt: now,
		hits: 0,
		runs: 0,
		outline: []
	};
}

export async function readScriptNote(
	env: { KV_BINDING?: ScriptNoteKv } | undefined,
	id: string
): Promise<ScriptNote | null> {
	if (!isScriptNoteId(id)) return null;
	return scriptNoteStore(env).get(id);
}

export async function writeScriptNote(
	env: { KV_BINDING?: ScriptNoteKv } | undefined,
	note: ScriptNote,
	ttlSeconds: number = SCRIPT_NOTE_TTL_SECONDS
): Promise<ScriptNote> {
	note.updatedAt = Date.now();
	await scriptNoteStore(env).put(note, ttlSeconds);
	return note;
}

/* ------------------------------------------------------------------------- */
/* Research: write the note down from a live page (no model call)             */
/* ------------------------------------------------------------------------- */

function decodeEntities(text: string): string {
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		rsquo: "'",
		lsquo: "'",
		rdquo: '"',
		ldquo: '"',
		ndash: "-",
		mdash: "-",
		hellip: "..."
	};
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
			const code = parseInt(hex, 16);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
		})
		.replace(/&#(\d+);/g, (_m, dec) => {
			const code = parseInt(dec, 10);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
		})
		.replace(/&([a-z]+);/gi, (m, name) => named[String(name).toLowerCase()] ?? m);
}

function cleanInline(text: string): string {
	return decodeEntities(String(text || ""))
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function uniqueStrings(values: string[], max: number, maxChars = 120): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const text = String(value || "").replace(/\s+/g, " ").trim();
		if (!text) continue;
		const key = text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(text.slice(0, maxChars));
		if (out.length >= max) break;
	}
	return out;
}

/*
 * Deterministic HTML → notes extraction. Deliberately model-free: this runs
 * in a few milliseconds and can therefore happen INSIDE the request that
 * starts a script, before (and in parallel with) the planner.
 */
export function extractResearchNotes(
	html: string,
	url: string
): Pick<ScriptNoteSource, "title" | "description" | "headings" | "keywords" | "facts"> {
	const raw = String(html || "");
	const head = raw.slice(0, 200 * 1024);

	const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
	const h1 = [...head.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
		.map((m) => cleanInline(m[1]))
		.filter(Boolean);
	const title = cleanInline(titleTag ? titleTag[1] : h1[0] || "").slice(0, 140);

	const meta = (name: string): string => {
		const patterns = [
			new RegExp(
				'<meta[^>]+(?:name|property)\\s*=\\s*["\']' + name + '["\'][^>]*content\\s*=\\s*["\']([^"\']*)["\']',
				"i"
			),
			new RegExp(
				'<meta[^>]+content\\s*=\\s*["\']([^"\']*)["\'][^>]*(?:name|property)\\s*=\\s*["\']' +
					name +
					'["\']',
				"i"
			)
		];
		for (const pattern of patterns) {
			const hit = pattern.exec(head);
			if (hit && hit[1]) return cleanInline(hit[1]);
		}
		return "";
	};

	const description = (
		meta("description") ||
		meta("og:description") ||
		meta("twitter:description")
	).slice(0, 320);

	const headings = uniqueStrings(
		[
			...h1,
			...[...head.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => cleanInline(m[1])),
			...[...head.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => cleanInline(m[1]))
		].filter((text) => text.length >= 3 && text.length <= 110),
		8
	);

	const keywords = uniqueStrings(
		[
			...(meta("keywords") || "").split(","),
			...[...head.matchAll(/<a\b[^>]*>([\s\S]{3,60}?)<\/a>/gi)]
				.map((m) => cleanInline(m[1]))
				.filter((text) => text.split(/\s+/).length <= 3)
		],
		10,
		48
	);

	/* Body sentences: the note's facts. Ordered paragraphs, first sentences. */
	const body = head
		.replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<(nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|li|div|h[1-6])>/gi, "\n");
	const facts = uniqueStrings(
		body
			.split(/[\n]+/)
			.map((line) => cleanInline(line))
			.filter((line) => line.split(/\s+/).length >= 6)
			.map((line) => line.split(/(?<=[.!?])\s+/)[0])
			.filter(Boolean),
		8,
		220
	);

	return { title, description, headings, keywords, facts };
}

function isPrivateHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (
		host === "localhost" ||
		host === "0.0.0.0" ||
		host === "[::1]" ||
		host === "::1" ||
		host.endsWith(".localhost") ||
		host.endsWith(".internal") ||
		host.endsWith(".local")
	) {
		return true;
	}
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!v4) return false;
	const a = Number(v4[1]);
	const b = Number(v4[2]);
	return (
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		a === 0
	);
}

/*
 * The shape we need from a page fetch, and nothing more. `init` is intentionally
 * permissive so both the Worker's global `fetch` and a test stub satisfy it.
 */
export interface NoteFetchResponse {
	ok?: boolean;
	status?: number;
	headers?: { get(name: string): string | null };
	text(): Promise<string>;
}

export type NoteFetch = (input: string, init?: any) => Promise<NoteFetchResponse>;

/*
 * Writes the note down from the live page. Bounded (4 s, 400 KB, text only),
 * HTTPS/HTTP only, and private network targets are refused, so this can never
 * turn a script request into an SSRF probe or a hang.
 */
export async function researchSourceUrl(
	rawUrl: unknown,
	fetchImpl: NoteFetch | undefined,
	timeoutMs: number = SCRIPT_NOTE_FETCH_TIMEOUT_MS
): Promise<ScriptNoteSource> {
	const startedAt = Date.now();
	const url = canonicalSourceUrl(rawUrl);
	const base: ScriptNoteSource = {
		url,
		status: "not-a-url",
		title: "",
		description: "",
		headings: [],
		keywords: [],
		facts: [],
		ms: 0
	};
	if (!url) return { ...base, ms: Date.now() - startedAt };
	const fetcher = fetchImpl || (typeof fetch === "function" ? (fetch as unknown as NoteFetch) : null);
	if (!fetcher) return { ...base, status: "unreachable", error: "fetch unavailable", ms: Date.now() - startedAt };
	let host = "";
	try {
		host = new URL(url).hostname;
	} catch {
		return { ...base, status: "unreachable", error: "invalid url", ms: Date.now() - startedAt };
	}
	if (isPrivateHost(host)) {
		return { ...base, status: "unreachable", error: "private host refused", ms: Date.now() - startedAt };
	}

	const controller = typeof AbortController === "function" ? new AbortController() : null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let timedOut = false;
	try {
		const deadline = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => {
				timedOut = true;
				try {
					controller?.abort();
				} catch {
					/* ignore */
				}
				reject(new Error("note fetch timed out after " + timeoutMs + " ms"));
			}, timeoutMs);
		});
		const response = await Promise.race([
			fetcher(url, {
				redirect: "follow",
				headers: { Accept: "text/html,application/xhtml+xml,text/plain" },
				signal: controller ? controller.signal : undefined
			} as any),
			deadline
		]);
		if (response && response.ok === false) {
			return {
				...base,
				status: "unreachable",
				error: "HTTP " + String(response.status ?? ""),
				ms: Date.now() - startedAt
			};
		}
		const contentType = String(response?.headers?.get?.("content-type") || "");
		if (contentType && !/text\/|html|xml|json/i.test(contentType)) {
			return {
				...base,
				status: "unreachable",
				error: "not a text page (" + contentType.slice(0, 60) + ")",
				ms: Date.now() - startedAt
			};
		}
		const html = await Promise.race([response.text(), deadline]);
		const capped =
			html.length > SCRIPT_NOTE_MAX_HTML_BYTES
				? html.slice(0, SCRIPT_NOTE_MAX_HTML_BYTES)
				: html;
		const extracted = extractResearchNotes(capped, url);
		return {
			...base,
			...extracted,
			status: "fetched",
			ms: Date.now() - startedAt
		};
	} catch (err: unknown) {
		return {
			...base,
			status: "unreachable",
			error: (timedOut
				? "note fetch timed out"
				: (err as { message?: string })?.message || String(err)
			).slice(0, 160),
			ms: Date.now() - startedAt
		};
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/* ------------------------------------------------------------------------- */
/* Beat plan (the part of the note the writer follows)                        */
/* ------------------------------------------------------------------------- */

const FALLBACK_BEATS: ScriptNoteBeat[] = [
	{ heading: "Hook", beat: "Name the viewer's problem in one concrete sentence.", words: 0 },
	{ heading: "Why it matters", beat: "Say what changes if the problem is solved.", words: 0 },
	{ heading: "How it works", beat: "Explain the core idea in plain spoken steps.", words: 0 },
	{ heading: "What to try", beat: "Give one practical action the viewer can take today.", words: 0 },
	{ heading: "Common mistake", beat: "Warn about the mistake beginners make.", words: 0 },
	{ heading: "Closing", beat: "Summarise the promise and close cleanly.", words: 0 }
];

/*
 * Distributes the requested word target over the note's sections. When the
 * page gave us headings they win, then the planner's sections, then the
 * generic explainer skeleton. Beat word budgets are advisory (they appear in
 * the prompt) but they keep the writer from spending a third of a 1-minute
 * script on the introduction, which used to reject the SRT for being short.
 */
export function buildNoteOutline(
	source: ScriptNoteSource | undefined,
	keywordSet: PlannedKeywordSet | null | undefined,
	wordTarget: number,
	maxBeats = 6
): ScriptNoteBeat[] {
	const target = Math.max(60, Math.round(Number(wordTarget) || 140));
	const fromSource = (source?.headings || []).filter(Boolean).slice(0, maxBeats);
	const fromPlan = (keywordSet?.headings || []).filter(Boolean).slice(0, maxBeats);
	const headings = fromSource.length >= 2 ? fromSource : fromPlan.length >= 2 ? fromPlan : [];
	const bases = headings.length
		? headings.map((heading, index) => ({
				heading,
				beat:
					index === 0
						? "Open here and connect it to the viewer's own situation."
						: index === headings.length - 1
							? "Close here and land the takeaway."
							: "Cover this section in order; keep it concrete.",
				words: 0
			}))
		: FALLBACK_BEATS.slice(0, Math.max(3, Math.min(maxBeats, 3 + Math.ceil(target / 220))));
	const per = Math.max(18, Math.round(target / bases.length));
	return bases.map((beat) => ({ ...beat, words: per }));
}

export function outlineToBrief(note: ScriptNote): string {
	const beats = note.outline.length
		? note.outline
		: buildNoteOutline(note.source, note.keywordSet, note.minutes * 140);
	return beats
		.map(
			(beat, index) =>
				"  " + (index + 1) + ". " + beat.heading + " (~" + beat.words + " words) - " + beat.beat
		)
		.join("\n");
}

/*
 * The prompt block the writer receives instead of a blank page. Kept short
 * (facts are capped) because every extra token on an 8B model costs latency
 * and invites the model to paraphrase instead of write subtitles.
 */
export function buildNoteWriterBrief(note: ScriptNote): string {
	const parts: string[] = [];
	const source = note.source;
	const heading = source?.title || note.topic;
	const sourceUrl = note.sourceUrl || source?.url || "";
	parts.push(
		"REFERENCE NOTE (note " +
			note.id +
			(sourceUrl ? ", source " + sourceUrl : "") +
			"): " +
			heading +
			"."
	);
	const facts: string[] = [];
	if (source?.description) facts.push(source.description);
	for (const fact of source?.facts || []) {
		if (facts.length >= 5) break;
		if (facts.some((existing) => existing.toLowerCase() === fact.toLowerCase())) continue;
		facts.push(fact);
	}
	if (facts.length) {
		parts.push(
			"Verified notes from the source (use these facts, do not invent new ones):\n" +
				facts.map((fact) => "  - " + fact).join("\n")
		);
	}
	if (source?.keywords?.length) {
		parts.push("Source themes: " + source.keywords.slice(0, 8).join(", ") + ".");
	}
	parts.push(
		"Follow this beat plan in order, spending the stated words on each beat:\n" +
			outlineToBrief(note) +
			"\nDo not add sections that are not in the beat plan."
	);
	if (note.keywordSet) {
		parts.push(
			"The SEO keyword set of this note is already fixed: long-tail \"" +
				note.keywordSet.longTail +
				"\", short keywords " +
				note.keywordSet.shorts.map((s) => '"' + s + '"').join(", ") +
				"."
		);
	}
	return parts.join("\n");
}

/* ------------------------------------------------------------------------- */
/* Deterministic keyword repair (replaces a whole model regeneration)         */
/* ------------------------------------------------------------------------- */

/* Three wrapped lines is the ceiling for a patched cue; the writer's 42-char
 * line rule is respected by wrapping, never by dropping words. */
const MAX_CUE_CHARS = 126;

function sentenceCase(keyword: string): string {
	const text = String(keyword || "").trim();
	if (!text) return text;
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function repairPhrases(keyword: string, role: "longTail" | "short"): string[] {
	const kw = sentenceCase(keyword);
	return role === "longTail"
		? [kw + " is where we start.", "Everything here comes back to " + keyword + "."]
		: ["That is where " + keyword + " matters.", "Think " + keyword + " first.", kw + " makes this practical."];
}

export interface KeywordRepairResult {
	srt: string;
	cues: ParsedSrtCue[];
	patched: Array<{ keyword: string; added: number; cues: number[] }>;
}

/*
 * Patches a VALID SRT that only fails the SEO minimum-frequency rule.
 *
 * Before this, a single short keyword one use below its minimum cost a full
 * 90-second writer regeneration (three times over in the worst case). The
 * repair appends a short natural clause carrying the keyword to an existing
 * cue that has room, rebuilds the canonical SRT with the ORIGINAL timings, and
 * lets the caller re-validate. If it cannot reach every minimum without
 * distorting the script, it returns null and the caller keeps its retry path.
 */
export function repairKeywordShortfall(
	cues: ParsedSrtCue[] | undefined,
	keywordSet: { longTail: string; shorts: string[] },
	options: { maxAddedWords?: number } = {}
): KeywordRepairResult | null {
	const list = Array.isArray(cues) ? cues.map((cue) => ({ ...cue, lines: [...cue.lines] })) : [];
	if (!list.length) return null;

	const spokenWords = list.reduce((sum, cue) => sum + cue.text.split(/\s+/).filter(Boolean).length, 0);
	const budget =
		Number(options.maxAddedWords) > 0
			? Number(options.maxAddedWords)
			: Math.max(24, Math.round(spokenWords * 0.2));
	let addedWords = 0;

	const targets: Array<{ keyword: string; role: "longTail" | "short"; need: number }> = [];
	const longCount = keywordCount(list.map((c) => c.text).join(" "), keywordSet.longTail);
	if (longCount < SEO_LONG_FREQ_MIN) {
		targets.push({
			keyword: keywordSet.longTail,
			role: "longTail",
			need: SEO_LONG_FREQ_MIN - longCount
		});
	}
	for (const short of keywordSet.shorts) {
		const count = keywordCount(list.map((c) => c.text).join(" "), short);
		if (count < SEO_SHORT_FREQ_MIN) {
			targets.push({ keyword: short, role: "short", need: SEO_SHORT_FREQ_MIN - count });
		}
	}
	if (!targets.length) return null;

	/* Spread the additions: the cue with the most room wins each round. */
	const patched: KeywordRepairResult["patched"] = [];
	for (const target of targets) {
		let added = 0;
		const usedCues: number[] = [];
		for (let round = 0; round < target.need; round++) {
			const phrases = repairPhrases(target.keyword, target.role);
			let placed = false;
			for (const phrase of phrases) {
				const words = phrase.split(/\s+/).filter(Boolean).length;
				if (addedWords + words > budget) break;
				const candidates = [...list]
					.filter((cue) => cue.text.length + phrase.length + 1 <= MAX_CUE_CHARS)
					.sort((a, b) => a.text.length - b.text.length);
				const cue = candidates.find((c) => !usedCues.includes(c.index)) || candidates[0];
				if (!cue) continue;
				cue.text = (cue.text + " " + phrase).replace(/\s+/g, " ").trim();
				const lines: string[] = [];
				let current = "";
				for (const word of cue.text.split(/\s+/)) {
					const next = current ? current + " " + word : word;
					if (next.length > 42 && current) {
						lines.push(current);
						current = word;
					} else {
						current = next;
					}
				}
				if (current) lines.push(current);
				/* Never drop a word: overflow is merged into the last line. */
				if (lines.length > 3) {
					const head = lines.slice(0, 2);
					head.push(lines.slice(2).join(" "));
					cue.lines = head;
				} else {
					cue.lines = lines;
				}
				cue.text = cue.lines.join(" ");
				usedCues.push(cue.index);
				addedWords += words;
				added++;
				placed = true;
				break;
			}
			if (!placed) break;
		}
		if (added) patched.push({ keyword: target.keyword, added, cues: usedCues });
	}

	if (!patched.length) return null;

	const srt = list
		.map((cue) => cue.index + "\n" + cue.rawStampLine + "\n" + cue.lines.join("\n"))
		.join("\n\n");
	const check = keywordUsageAudit(
		list.map((c) => c.text).join(" "),
		list,
		keywordSet as { longTail: string; shorts: string[] }
	);
	if (check.some((entry) => !entry.ok)) return null;
	return { srt, cues: list, patched };
}

/* ------------------------------------------------------------------------- */
/* Browser-supplied notes (localStorage / cookie mirror)                      */
/* ------------------------------------------------------------------------- */

export interface ClientScriptNote {
	keywordSetRaw: Record<string, unknown> | null;
	outline: ScriptNoteBeat[];
	updatedAt: number;
}

function cleanClientText(value: unknown, max: number): string {
	return String(value ?? "")
		.replace(/[\u0000-\u001F\u007F]+/g, " ")
		.replace(/[<>]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);
}

/*
 * The browser keeps its own copy of the note (localStorage, mirrored into a
 * cookie) and sends it back with the next request. That hint is treated as
 * untrusted input: every field is re-validated here, the keyword set goes
 * through the same `parseKeywordSet` rules, the beat plan is clamped, and a
 * corrupted localStorage can never break a script — it is simply ignored.
 */
export function sanitizeClientNote(raw: unknown): ClientScriptNote | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const data = raw as Record<string, unknown>;
	const keywordSetRaw =
		data.keywordSet && typeof data.keywordSet === "object" && !Array.isArray(data.keywordSet)
			? (data.keywordSet as Record<string, unknown>)
			: null;
	const rawOutline = Array.isArray(data.outline)
		? data.outline
		: Array.isArray(data.beats)
			? (data.beats as unknown[])
			: [];
	const outline: ScriptNoteBeat[] = [];
	for (const entry of rawOutline.slice(0, 8)) {
		if (!entry || typeof entry !== "object") continue;
		const beat = entry as Record<string, unknown>;
		const heading = cleanClientText(beat.heading ?? beat.name ?? beat.section, 110);
		if (heading.length < 2) continue;
		const detail = cleanClientText(beat.beat ?? beat.detail ?? beat.summary, 200);
		const words = Number(beat.words);
		outline.push({
			heading,
			beat: detail || "Cover this section in order; keep it concrete.",
			words: Number.isFinite(words) ? Math.max(0, Math.min(600, Math.round(words))) : 0
		});
	}
	const updatedAt = Number(data.updatedAt);
	if (!outline.length && !keywordSetRaw) return null;
	return {
		keywordSetRaw,
		outline,
		updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0
	};
}

export function clientNoteIsFresh(note: ClientScriptNote, now: number = Date.now()): boolean {
	return !note.updatedAt || now - note.updatedAt <= SCRIPT_NOTE_TTL_SECONDS * 1000;
}

/* ------------------------------------------------------------------------- */
/* Note records: usage accounting                                             */
/* ------------------------------------------------------------------------- */

export function noteHit(note: ScriptNote): ScriptNote {
	note.hits = (note.hits || 0) + 1;
	return note;
}

export function noteRunStart(note: ScriptNote, state: ScriptNoteState): ScriptNote {
	note.state = state;
	note.runs = (note.runs || 0) + 1;
	note.updatedAt = Date.now();
	note.runStartedAt = note.updatedAt;
	note.deadlineMs = Number(note.deadlineMs) > 0 ? note.deadlineMs : SCRIPT_NOTE_DEADLINE_MS;
	note.errorCode = undefined;
	note.lastError = undefined;
	return note;
}

/* A run that has actually begun (queue wait is over). */
export function noteRunActive(note: ScriptNote, state: ScriptNoteState = "planning"): ScriptNote {
	note.state = state;
	note.updatedAt = Date.now();
	note.runStartedAt = note.updatedAt;
	return note;
}

/*
 * PROOF OF LIFE, NOT A NEW RUN.
 *
 * The pipeline beats before every model call so a poller can tell "still
 * working" from "the runner is gone". It must NOT use `noteRunActive` for that:
 * `runStartedAt` is what `noteStaleReason` measures the run budget from, so
 * beating through it would silently redefine "240 s for the whole run" as
 * "240 s since the last beat". With up to three 45 s planner attempts and three
 * 90 s writer attempts (405 s) the watchdog would never expire - and on the
 * degraded INLINE path there is no job deadline at all, so that watchdog is the
 * only thing standing between a caller and an eternal "pending".
 *
 * Only `state` and `updatedAt` move here; the run clock stays where it was.
 */
export function noteRunHeartbeat(note: ScriptNote, state: ScriptNoteState): ScriptNote {
	note.state = state;
	note.updatedAt = Date.now();
	return note;
}

export function noteStateIsTerminal(state: unknown): boolean {
	return state === "done" || state === "error" || state === "empty";
}

/*
 * The single staleness rule, shared by the read handler and any watchdog:
 * a note that is not terminal, whose current run started longer ago than its
 * budget, can never become terminal by itself (the runner is gone), so a
 * reader is allowed to close it. Returns the reason or null.
 */
export function noteStaleReason(
	note: ScriptNote,
	now: number = Date.now(),
	budgets: { queueGraceMs?: number; deadlineMs?: number } = {}
): string | null {
	if (noteStateIsTerminal(note.state)) return null;
	const queueGrace =
		Number(budgets.queueGraceMs) > 0 ? Number(budgets.queueGraceMs) : SCRIPT_NOTE_QUEUE_GRACE_MS;
	const deadline =
		Number(budgets.deadlineMs) > 0
			? Number(budgets.deadlineMs)
			: Number(note.deadlineMs) > 0
				? Number(note.deadlineMs)
				: SCRIPT_NOTE_DEADLINE_MS;
	const startedAt = Number(note.runStartedAt) > 0 ? Number(note.runStartedAt) : 0;
	if (!startedAt) {
		/*
		 * A non-terminal note with no run timestamps comes from an older
		 * build; use the last write instead, so it cannot live forever.
		 */
		const writtenAt = Number(note.updatedAt) > 0 ? Number(note.updatedAt) : 0;
		if (!writtenAt) return null;
		const age = now - writtenAt;
		return age > deadline ? "SCRIPT_NOTE_STALE:untimed:" + Math.round(age / 1000) + "s" : null;
	}
	const age = now - startedAt;
	const budget = note.state === "queued" ? queueGrace : deadline;
	if (age <= budget) return null;
	return (
		"SCRIPT_NOTE_STALE:" +
		note.state +
		":" +
		Math.round(age / 1000) +
		"s>" +
		Math.round(budget / 1000) +
		"s"
	);
}

/* Closes a note that no runner will ever finish. */
export function noteRunExpire(
	note: ScriptNote,
	reason: string,
	code: string = "SCRIPT_NOTE_STALE"
): ScriptNote {
	note.state = "error";
	note.errorCode = code;
	note.lastError = String(reason || code).slice(0, 300);
	note.updatedAt = Date.now();
	return note;
}

export function noteRunDone(
	note: ScriptNote,
	input: {
		script: string;
		durationMs: number;
		model: string;
		keywordSet?: PlannedKeywordSet | null;
		outline?: ScriptNoteBeat[];
		repairedKeywords?: string[];
		payload?: Record<string, unknown>;
		timings: ScriptNoteTimings;
	}
): ScriptNote {
	note.state = "done";
	note.script = input.script;
	note.durationMs = input.durationMs;
	note.model = input.model;
	if (input.keywordSet) note.keywordSet = input.keywordSet;
	if (input.outline && input.outline.length) note.outline = input.outline;
	if (input.repairedKeywords?.length) note.repairedKeywords = input.repairedKeywords;
	if (input.payload) note.payload = input.payload;
	note.timings = input.timings;
	note.lastError = undefined;
	note.updatedAt = Date.now();
	return note;
}

export function noteRunFailed(note: ScriptNote, error: string): ScriptNote {
	note.state = "error";
	note.lastError = String(error || "script failed").slice(0, 300);
	note.updatedAt = Date.now();
	return note;
}

/* The client contract for a note: never expose the whole stored record. */
export function clientNote(note: ScriptNote, includeScript = true): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		noteId: note.id,
		noteUrl: "/api/script/notes/" + note.id,
		state: note.state,
		topic: note.topic,
		sourceUrl: note.sourceUrl,
		source: note.source
			? {
					status: note.source.status,
					title: note.source.title,
					description: note.source.description,
					headings: note.source.headings,
					keywords: note.source.keywords,
					ms: note.source.ms,
					error: note.source.error
				}
			: null,
		keywords: note.keywordSet
			? { title: note.keywordSet.title, headings: note.keywordSet.headings, longTail: note.keywordSet.longTail, short: note.keywordSet.shorts }
			: null,
		outline: note.outline,
		hits: note.hits,
		runs: note.runs,
		updatedAt: note.updatedAt,
		ring: note.timings || null,
		error: note.lastError || null,
		errorCode: note.errorCode || null,
		runStartedAt: note.runStartedAt || null,
		deadlineMs: note.deadlineMs || null,
		repairedKeywords: note.repairedKeywords || null
	};
	if (includeScript) {
		payload.script = note.script || null;
		payload.durationMs = note.durationMs || 0;
		payload.result = note.payload || null;
	}
	return payload;
}
