/*
 * THE PROVIDER + MODEL SIMULATION behind bench/three-users-three-videos.mjs.
 *
 * Nothing here decides anything about the pipeline: it only answers the calls
 * the REAL code makes (src/modules/script-seo.ts, image-prompts.ts,
 * voiceover.ts, pixabay.ts) with realistic latency, realistic payloads and
 * realistic transient failures. Every retry, timeout, budget and queue in the
 * measurement therefore comes from the shipped source, not from this file.
 *
 * Latency defaults are the production figures the repository already measures
 * with (bench/script-pipeline-bench.mjs: planner 7.2 s, writer 21 s) plus the
 * provider timings named in pixabay-media-migration.md. `--scale` multiplies
 * PROVIDER time only: the browser's own constants (900 ms note poll, 250 ms
 * retry backoff, 800 ms image-chunk backoff, 100 ms scheduler ticks) are part
 * of the pipeline under test and are never scaled.
 *
 * Failure injection is deterministic per (stage, call ordinal): the Nth call of
 * a stage fails or succeeds identically in every build, so a before/after
 * comparison never measures luck.
 */

/* ---------------------------------------------------------------- rng ---- */

function hashSeed(text) {
	let hash = 2166136261;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

/* Deterministic uniform in [0,1) for a (stage, ordinal) pair. */
export function unitRandom(seed, stage, ordinal) {
	let value = hashSeed(seed + "|" + stage + "|" + ordinal) >>> 0;
	value ^= value >>> 15;
	value = Math.imul(value, 2246822507) >>> 0;
	value ^= value >>> 13;
	value = Math.imul(value, 3266489909) >>> 0;
	value ^= value >>> 16;
	return (value >>> 0) / 4294967296;
}

export function jitter(seed, stage, ordinal, spread = 0.2) {
	/* ±spread around 1.0, deterministic. */
	return 1 + (unitRandom(seed, stage + ":jitter", ordinal) * 2 - 1) * spread;
}

/* --------------------------------------------------------------- topics --- */

const TOPIC_WORDS = [
	["morning yoga", "yoga", "breathing", "stretching", "balance"],
	["home coffee", "coffee", "grinding", "water", "aroma"],
	["night running", "running", "pace", "streets", "recovery"],
	["small garden", "garden", "soil", "watering", "harvest"],
	["desk stretches", "stretches", "posture", "shoulders", "breaks"],
	["sourdough bread", "sourdough", "starter", "folding", "crust"],
	["city cycling", "cycling", "lanes", "gears", "commute"],
	["deep sleep", "sleep", "darkness", "routine", "rest"],
	["phone photos", "photos", "light", "framing", "editing"]
];

/*
 * One topic = one validated keyword set + one narration that satisfies the
 * server-side SEO audit (long-tail >= 1 use, every short keyword >= 2 uses,
 * title <= 70 chars carrying a short keyword, headings carrying one too).
 * The lines are the same shape the repository's own benches use, so the
 * writer's answer passes validateSrt() and keywordUsageAudit() unchanged.
 */
export function topicKit(topic, index = 0) {
	const entry = TOPIC_WORDS[index % TOPIC_WORDS.length];
	const [subject, shortA, shortB, shortC, shortD] = entry;
	const longTail = `${subject} for beginners in a small home space`;
	const plan = {
		title: `${capitalize(subject)}: ${capitalize(shortA)} Basics`.slice(0, 70),
		headings: [`Start with ${capitalize(shortA)}`, `Find Your ${capitalize(shortB)}`],
		longTail,
		short: [shortA, shortB, shortC, shortD]
	};
	const lines = [
		`Try ${longTail} today.`,
		`Let ${shortB} settle into a steady rhythm.`,
		`Gentle ${shortC} can release tension.`,
		`Practice ${shortD} with a chair nearby.`,
		`Keep your ${shortB} relaxed and natural.`,
		`Comfortable ${shortC} should never hurt.`,
		`Your ${shortD} improves with patient ${shortA}.`,
		`Small daily ${shortA} beats one perfect weekend.`,
		`Return to ${longTail} tomorrow.`
	];
	return { topic, plan, lines, srt: toSrt(lines), script: lines.join(" ") };
}

function capitalize(value) {
	const text = String(value || "");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function toSrt(lines, secondsPerCue = 4) {
	const stamp = (seconds) => `00:00:${String(seconds).padStart(2, "0")},000`;
	return lines
		.map((line, index) => `${index + 1}\n${stamp(index * secondsPerCue)} --> ${stamp((index + 1) * secondsPerCue)}\n${line}`)
		.join("\n\n");
}

/* A reply that drops one short keyword below its minimum: the classic SEO
 * rejection that makes the writer stage retry. */
export function shortKeywordSrt(kit) {
	const lines = kit.lines.slice();
	const shortB = kit.plan.short[1];
	for (let index = 0; index < lines.length; index++) {
		if (lines[index].includes(shortB)) {
			lines[index] = lines[index].split(shortB).join("calm");
			break;
		}
	}
	return toSrt(lines);
}

/* ---------------------------------------------------------------- bytes --- */

const PNG_BYTES = Uint8Array.from([
	137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
	0, 0, 4, 0, 0, 0, 2, 64, 8, 6, 0, 0, 0, 1, 2, 3
]);

const MP4_BYTES = Uint8Array.from([
	0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109,
	0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50
]);

/* One MPEG-1 Layer III frame header the browser's audio assembler accepts. */
const MP3_FRAME = Uint8Array.from([0xff, 0xfb, 0x90, 0x44]);

export function mp3Bytes(frames = 8) {
	const out = new Uint8Array(MP3_FRAME.length * frames);
	for (let index = 0; index < frames; index++) out.set(MP3_FRAME, index * MP3_FRAME.length);
	return out;
}

export function photoBytes(sizeHint = 0) {
	if (sizeHint > 0 && sizeHint > PNG_BYTES.length) {
		const out = new Uint8Array(sizeHint);
		out.set(PNG_BYTES, 0);
		return out;
	}
	return PNG_BYTES;
}

export function clipBytes(sizeHint = 0) {
	if (sizeHint > 0 && sizeHint > MP4_BYTES.length) {
		const out = new Uint8Array(sizeHint);
		out.set(MP4_BYTES, 0);
		return out;
	}
	return MP4_BYTES;
}

/* ------------------------------------------------------------------ ai ---- */

export const AI_LATENCY_MS = {
	planner: 7200,
	writer: 21000,
	scenePlanner: 4000,
	tts: 3000
};

export const AI_FAILURE_RATE = {
	planner: 0.1,
	writer: 0.12,
	scenePlanner: 0.08,
	tts: 0.25
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms > 0 ? ms : 0));

export function classifyAiCall(model, prompt) {
	const text = String(prompt || "");
	if (text.includes("SEO strategist")) return "planner";
	if (text.includes("You plan Pixabay stock searches")) return "scenePlanner";
	if (String(model || "").includes("melotts") || String(model || "").includes("aura") ||
		String(model || "").includes("deepgram") || String(model || "").includes("tts")) return "tts";
	return "writer";
}

/*
 * The AI binding. `answer(stage, call)` supplies the payload for a stage so
 * the same sim can serve nine different topics: the caller passes a resolver
 * that maps a prompt to the topic kit it belongs to.
 */
export function createAiSim(options = {}) {
	const seed = String(options.seed || "sim");
	const scale = Number(options.scale) > 0 ? Number(options.scale) : 1;
	const latency = Object.assign({}, AI_LATENCY_MS, options.latency || {});
	const failureRate = Object.assign({}, AI_FAILURE_RATE, options.fail || {});
	const stats = {
		calls: { planner: 0, writer: 0, scenePlanner: 0, tts: 0, other: 0 },
		failures: { planner: 0, writer: 0, scenePlanner: 0, tts: 0, other: 0 },
		busyMs: { planner: 0, writer: 0, scenePlanner: 0, tts: 0, other: 0 },
		models: {}
	};
	const answer = typeof options.answer === "function" ? options.answer : null;
	/* Diagnostics only: BENCH_TRACE_AI prints every model call with the wall
	 * time its simulated latency actually took, which is how a starved timer
	 * phase is told apart from a stalled pipeline. */
	const trace = process.env.BENCH_TRACE_AI
		? (tag, payload) => console.error("[ai] " + tag, payload)
		: null;

	async function run(model, input) {
		const prompt = String((input && input.prompt) || "");
		const stage = classifyAiCall(model, prompt);
		const ordinal = stats.calls[stage]++;
		stats.models[model] = (stats.models[model] || 0) + 1;

		const wait = latency[stage] === undefined ? 1000 : latency[stage];
		const callT0 = Date.now();
		if (trace) trace("call", { stage, ordinal, planMs: Math.round(wait * scale), at: callT0 });
		await sleep(wait * scale * jitter(seed, stage, ordinal, 0.15));
		if (trace) trace("slept", { stage, ordinal, ms: Date.now() - callT0 });
		stats.busyMs[stage] += wait * scale;

		const rate = Number(failureRate[stage]) || 0;
		if (rate > 0 && unitRandom(seed, stage, ordinal) < rate) {
			stats.failures[stage]++;
			/* The failure the code comments name: a transient Workers AI 3043. */
			const error = new Error("AiError 3043: Internal server error");
			error.name = "AiError";
			throw error;
		}

		if (answer) {
			const replied = await answer(stage, { model, prompt, input, ordinal });
			if (replied !== undefined && replied !== null) return replied;
		}
		if (trace) trace("answered", { stage, ordinal, ms: Date.now() - callT0 });
		if (stage === "tts") return { audio: Buffer.from(mp3Bytes(12)).toString("base64") };
		throw new Error("pipeline-sim: no answer configured for stage " + stage);
	}

	return { env: { AI: { run } }, stats };
}

/* -------------------------------------------------------------- provider -- */

export const PROVIDER_LATENCY_MS = {
	search: 450,
	photo: 700,
	clip: 1400,
	externalTts: 2500
};

export const PROVIDER_FAILURE_RATE = {
	search: 0.05,
	photo: 0.05,
	clip: 0.05,
	externalTts: 0.2
};

let assetSeq = 0;

function photoHit(id, tags) {
	return {
		id,
		pageURL: `https://pixabay.com/photos/id-${id}/`,
		type: "photo",
		user: "Sim Artist",
		tags,
		largeImageURL: `https://cdn.pixabay.com/photo/${id}.png`,
		previewURL: `https://cdn.pixabay.com/photo/${id}_150.png`,
		imageWidth: 1280,
		imageHeight: 720
	};
}

function videoHit(id, tags, duration = 12) {
	return {
		id,
		pageURL: `https://pixabay.com/videos/id-${id}/`,
		type: "film",
		user: "Sim Artist",
		tags,
		duration,
		videos: {
			small: {
				url: `https://cdn.pixabay.com/video/${id}.mp4`,
				thumbnail: `https://cdn.pixabay.com/video/${id}.jpg`,
				width: 1280,
				height: 720,
				size: 2400
			}
		}
	};
}

/*
 * The provider: Pixabay search + CDN, and the external fallback TTS endpoint.
 * Used for BOTH transports: the Worker's own `fetch` (src/modules/pixabay.ts)
 * and the browser-first path (src/client/pixabay-direct.ts) through the jsdom
 * window's fetch.
 */
export function createProviderSim(options = {}) {
	const seed = String(options.seed || "sim");
	const scale = Number(options.scale) > 0 ? Number(options.scale) : 1;
	const latency = Object.assign({}, PROVIDER_LATENCY_MS, options.latency || {});
	const failureRate = Object.assign({}, PROVIDER_FAILURE_RATE, options.fail || {});
	const stats = { searches: 0, photos: 0, clips: 0, externalTts: 0, failures: 0, bytes: 0 };

	async function respond(input, init = {}) {
		const url = new URL(String(typeof input === "string" ? input : input.url));
		const host = url.hostname;

		if (host === "tts-api.netlify.app") {
			const ordinal = stats.externalTts++;
			await sleep(latency.externalTts * scale * jitter(seed, "externalTts", ordinal));
			const rate = Number(failureRate.externalTts) || 0;
			if (rate > 0 && unitRandom(seed, "externalTts", ordinal) < rate) {
				stats.failures++;
				return new Response("upstream tts busy", { status: 503 });
			}
			return new Response(mp3Bytes(12), { headers: { "Content-Type": "audio/mpeg" } });
		}

		if (host === "pixabay.com" && url.pathname.startsWith("/api/")) {
			const ordinal = stats.searches++;
			const isVideo = url.pathname.includes("/videos");
			await sleep(latency.search * scale * jitter(seed, "search", ordinal));
			const rate = Number(failureRate.search) || 0;
			if (rate > 0 && unitRandom(seed, "search", ordinal) < rate) {
				stats.failures++;
				return new Response("provider busy", {
					status: 503,
					headers: { "X-RateLimit-Reset": "5" }
				});
			}
			const query = String(url.searchParams.get("q") || "stock").slice(0, 40);
			const hits = isVideo
				? [101, 102, 103].map((id) => videoHit(id + ordinal, query))
				: [1, 2, 3].map((id) => photoHit(id + ordinal * 10, query));
			return new Response(JSON.stringify({ totalHits: 500, hits }), {
				headers: { "Content-Type": "application/json" }
			});
		}

		if (host === "cdn.pixabay.com") {
			const isClip = url.pathname.endsWith(".mp4");
			const stage = isClip ? "clip" : "photo";
			const ordinal = (isClip ? stats.clips++ : stats.photos++);
			await sleep(latency[stage] * scale * jitter(seed, stage, ordinal));
			const rate = Number(failureRate[stage]) || 0;
			if (rate > 0 && unitRandom(seed, stage, ordinal) < rate) {
				stats.failures++;
				return new Response("cdn timeout", { status: 504 });
			}
			const bytes = isClip ? clipBytes(2400) : photoBytes(1200);
			stats.bytes += bytes.length;
			return new Response(bytes, {
				headers: {
					"Content-Type": isClip ? "video/mp4" : "image/png",
					"Access-Control-Allow-Origin": "*"
				}
			});
		}

		return new Response("pipeline-sim: unmodelled provider host " + host, { status: 502 });
	}

	return { fetch: respond, stats, nextAssetId: () => ++assetSeq };
}
