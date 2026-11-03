/*
 * HOW FAST CAN THREE USERS FINISH THREE VIDEOS EACH?
 *
 *   node bench/three-users-three-videos.mjs                 # one measured run
 *   node bench/three-users-three-videos.mjs --runs 3        # median of 3
 *   node bench/three-users-three-videos.mjs --scale 0.25    # provider time /4
 *   node bench/three-users-three-videos.mjs --json-out /tmp/before.json
 *   node bench/pipeline-sim/compare.mjs /tmp/before.json /tmp/after.json
 *
 * What is real and what is simulated
 * ----------------------------------
 * REAL (the shipped source, unmodified): src/index.ts routing + capability
 * negotiation, the script note layer and its event loop, script-seo's
 * planner/writer ladders, image-prompts' scene planner, image-batch/pixabay
 * media handling, voiceover, and the entire browser: src/page.ts + APP_JS +
 * browser-offload + pixabay-direct + the progressive image pipeline, running
 * in jsdom with only the device edges stubbed.
 *
 * SIMULATED (bench/pipeline-sim/model.mjs): the AI binding, the Pixabay
 * API/CDN, the external TTS endpoint, network round-trip time, and the local
 * WebCodecs encode (a fixed per-video cost that no retry strategy changes).
 *
 * So every number below is the pipeline's own behaviour under three concurrent
 * tabs and nine videos: retries, backoffs, poll cadence, queue admission, note
 * writes and lane contention are all the code's, not the harness's.
 */
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

import {
	AI_FAILURE_RATE,
	AI_LATENCY_MS,
	PROVIDER_FAILURE_RATE,
	PROVIDER_LATENCY_MS,
	createAiSim,
	createProviderSim,
	shortKeywordSrt,
	topicKit,
	unitRandom
} from "./pipeline-sim/model.mjs";
import { createWorkerSim } from "./pipeline-sim/worker.mjs";
import { createUser } from "./pipeline-sim/user.mjs";

/* ----------------------------------------------------------------- cli ---- */

const argv = process.argv.slice(2);
function flag(name, fallback) {
	const index = argv.indexOf("--" + name);
	if (index === -1) return fallback;
	const value = argv[index + 1];
	return value === undefined || String(value).startsWith("--") ? true : value;
}
function rateMap(value, fallback) {
	const out = Object.assign({}, fallback);
	if (!value || value === true) return out;
	for (const part of String(value).split(",")) {
		const [key, raw] = part.split("=");
		if (key && raw !== undefined && Number.isFinite(Number(raw))) out[key.trim()] = Number(raw);
	}
	return out;
}

const USERS = Math.max(1, Number(flag("users", 3)));
const VIDEOS = Math.max(1, Number(flag("videos", 3)));
const RUNS = Math.max(1, Number(flag("runs", 1)));
const SCALE = Number(flag("scale", 1)) > 0 ? Number(flag("scale", 1)) : 1;
const NET_MS = Number(flag("net-ms", 60));
const SEED = String(flag("seed", "three-users"));
const MINUTES = Math.min(6, Math.max(1, Number(flag("minutes", 1))));
const RENDER_MS = Number(flag("render-ms", 9000));
const DIRECT_MEDIA = String(flag("media", "direct")) !== "worker";
/* Lane count: the shipped worker default (SCRIPT_LOOP_DEFAULT_CONCURRENCY).
 * The flag exists to test a different number, so it must not pin one - a
 * pinned 2 silently measures a deployment the source no longer ships. */
const LOOP_CONCURRENCY = Number(flag("loop-concurrency", 0)) || 0;
const SCRIPT_TIMEOUT_MS = Number(flag("script-timeout", 600000)) || 600000;
const MEDIA_TIMEOUT_MS = Number(flag("media-timeout", 600000)) || 600000;
const JSON_OUT = String(flag("json-out", "") || "");
const QUIET = Boolean(flag("quiet", false));
const FAIL = rateMap(flag("fail", ""), AI_FAILURE_RATE);
const PROVIDER_FAIL = rateMap(flag("provider-fail", ""), PROVIDER_FAILURE_RATE);
/* Invalid-but-successful model replies: the SEO audit rejection and the
 * unparseable scene plan. These are the failures that exercise the retry
 * ladders without a transport error. */
const INVALID = rateMap(flag("invalid", ""), { writer: 0.12, scenePlanner: 0.08 });

const TOPICS = [
	"morning yoga", "home coffee", "night running",
	"small garden", "desk stretches", "sourdough bread",
	"city cycling", "deep sleep", "phone photos"
];

/* ------------------------------------------------------------ ai answers -- */

function makeAnswerResolver(kits, seed) {
	const invalidCount = { writer: 0, scenePlanner: 0 };
	return function answer(stage, call) {
		const prompt = String(call.prompt || "");
		const kit =
			kits.find((candidate) => prompt.includes(candidate.plan.longTail)) ||
			kits.find((candidate) => prompt.includes("The video topic is: " + candidate.topic)) ||
			kits.find((candidate) => prompt.includes("TOPIC: " + candidate.topic)) ||
			kits.find((candidate) => candidate.plan.short.some((word) => prompt.includes(word))) ||
			kits[0];

		if (stage === "planner") return { response: JSON.stringify(kit.plan) };

		if (stage === "writer") {
			const ordinal = invalidCount.writer++;
			const rate = Number(INVALID.writer) || 0;
			if (rate > 0 && unitRandom(seed, "invalid-writer", ordinal) < rate) {
				/* A reply that drops one short keyword below its minimum: the
				 * writer stage rejects it and the ladder retries. */
				return { response: shortKeywordSrt(kit) };
			}
			return { response: kit.srt };
		}

		if (stage === "scenePlanner") {
			const ordinal = invalidCount.scenePlanner++;
			const rate = Number(INVALID.scenePlanner) || 0;
			if (rate > 0 && unitRandom(seed, "invalid-scene", ordinal) < rate) {
				return { response: "Sure! Here are some lovely stock search ideas for your video, described in prose." };
			}
			const match = /Requested slots of (\d+) total: (\[[^\n]*\])/.exec(prompt);
			const slots = match ? JSON.parse(match[2]) : [];
			const words = kit.plan.short;
			return {
				response: JSON.stringify({
					scenes: slots.map((slot, index) => ({
						scene: slot.scene,
						type: slot.type,
						keywords: (words[index % words.length] + " " + kit.topic.split(" ")[0]).trim().split(/\s+/).slice(0, 4).join(" ")
					}))
				})
			};
		}

		return null; /* tts is answered by the sim itself */
	};
}

/* ------------------------------------------------------------- diagnostics -- */

/*
 * BENCH_TRACE_LAG=1: one line every two seconds with the event loop's own
 * drift plus the script loop's lane occupancy. A starved timer phase shows up
 * here long before a stage timeout does, and it separates "the model call is
 * slow" from "the job never resumed".
 */
function startLagMonitor(workerSim) {
	if (!process.env.BENCH_TRACE_LAG) return () => {};
	const startedAt = Date.now();
	let expected = startedAt + 2000;
	const timer = setInterval(() => {
		const now = Date.now();
		let loop = null;
		try {
			loop = workerSim.loopStats();
		} catch {
			loop = "unavailable";
		}
		console.error("[lag] " + JSON.stringify({
			t: Math.round((now - startedAt) / 1000),
			driftMs: now - expected,
			loop
		}));
		expected = now + 2000;
	}, 2000);
	if (typeof timer.unref === "function") timer.unref();
	return () => clearInterval(timer);
}

/* ---------------------------------------------------------------- one run -- */

async function runOnce(runIndex) {
	const kits = [];
	for (let user = 0; user < USERS; user++) {
		for (let video = 0; video < VIDEOS; video++) {
			const topic = TOPICS[(user * VIDEOS + video) % TOPICS.length];
			kits.push(topicKit(topic, user * VIDEOS + video));
		}
	}

	const seed = SEED + ":" + runIndex;
	const provider = createProviderSim({ seed, scale: SCALE, fail: PROVIDER_FAIL });
	const ai = createAiSim({
		seed,
		scale: SCALE,
		fail: FAIL,
		answer: makeAnswerResolver(kits, seed)
	});
	const workerSim = createWorkerSim({
		ai,
		provider,
		netMs: NET_MS,
		directMedia: DIRECT_MEDIA,
		loopConcurrency: LOOP_CONCURRENCY
	});

	const users = [];
	const stopLag = startLagMonitor(workerSim);
	const startedAt = performance.now();
	try {
		for (let index = 0; index < USERS; index++) {
			const topics = kits.slice(index * VIDEOS, index * VIDEOS + VIDEOS).map((kit) => kit.topic);
			users.push(await createUser({
				id: "u" + (index + 1),
				workerSim,
				provider,
				topics,
				minutes: MINUTES,
				renderMs: RENDER_MS,
				scriptTimeoutMs: SCRIPT_TIMEOUT_MS,
				mediaTimeoutMs: MEDIA_TIMEOUT_MS
			}));
		}

		/* Three tabs, three sets, all at once: the makespan is what a shared
		 * Worker isolate actually experiences. */
		const results = await Promise.all(users.map((user) => user.runSet()));
		const makespanMs = Math.round(performance.now() - startedAt);
		await workerSim.drain();

		return summarize(runIndex, results, { workerSim, ai, provider, makespanMs, kits });
	} finally {
		stopLag();
		for (const user of users) user.close();
		workerSim.close();
	}
}

/* ---------------------------------------------------------------- report -- */

function pathCounts(results) {
	const counts = {};
	for (const result of results) {
		for (const request of result.requests) {
			const key = request.method + " " + request.path.split("?")[0] + (request.path.includes("async=1") ? "?async=1" : "");
			counts[key] = (counts[key] || 0) + 1;
		}
	}
	return counts;
}

function summarize(runIndex, results, context) {
	const { workerSim, ai, provider, makespanMs } = context;
	const counts = pathCounts(results);
	const videos = results.flatMap((result) => result.videos.map((video) => Object.assign({ user: result.user }, video)));
	const finished = videos.filter((video) => video.finished);

	const stageTotals = {};
	for (const video of videos) {
		for (const [stage, ms] of Object.entries(video.stageMs || {})) {
			stageTotals[stage] = (stageTotals[stage] || 0) + ms;
		}
	}

	const median = (values) => {
		const sorted = values.slice().sort((a, b) => a - b);
		if (!sorted.length) return 0;
		const middle = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
	};

	return {
		run: runIndex,
		config: {
			users: USERS, videos: VIDEOS, scale: SCALE, netMs: NET_MS, seed: SEED,
			minutes: MINUTES, renderMs: RENDER_MS, media: DIRECT_MEDIA ? "direct" : "worker",
			loopConcurrency: workerSim.loopConcurrency, aiLatencyMs: AI_LATENCY_MS, aiFailureRate: FAIL,
			invalidRate: INVALID, providerLatencyMs: PROVIDER_LATENCY_MS, providerFailureRate: PROVIDER_FAIL
		},
		makespanMs,
		pipelineMakespanMs: median(results.map((result) => result.mediaReadyAt)),
		perUser: results.map((result) => ({
			user: result.user,
			scriptsMs: result.scriptsMs,
			mediaMs: result.mediaMs,
			exportMs: result.exportMs,
			totalMs: result.totalMs,
			finished: result.videos.filter((video) => video.finished).length,
			requests: result.requests.length,
			providerRequests: result.providerRequests.length
		})),
		videos: videos.map((video) => ({
			user: video.user, row: video.rowId, topic: video.topic, finished: video.finished,
			stage: video.stage, error: video.error, scenes: video.scenes, slides: video.slides,
			scriptChars: video.scriptChars, rowMs: video.rowMs, stageMs: video.stageMs
		})),
		stageTotalsMs: stageTotals,
		requests: counts,
		requestTotal: Object.values(counts).reduce((sum, value) => sum + value, 0),
		ai: ai.stats,
		provider: provider.stats,
		loop: workerSim.loopStats(),
		directMedia: results.map((result) => ({ user: result.user, debug: result.directMedia })),
		logs: results.flatMap((result) => (result.logs || []).map((entry) => result.user + " " + entry.level + " " + entry.text)).slice(-40),
		warnings: results.flatMap((result) => result.warnings).slice(0, 20)
	};
}

function printReport(summary) {
	const config = summary.config;
	console.log("");
	console.log(`Pipeline simulation — ${config.users} users × ${config.videos} videos each (Quick Batch table, real APP_JS + real Worker)`);
	console.log(`  provider latency × ${config.scale} · planner ${config.aiLatencyMs.planner} ms · writer ${config.aiLatencyMs.writer} ms · scene planner ${config.aiLatencyMs.scenePlanner} ms · TTS ${config.aiLatencyMs.tts} ms`);
	console.log(`  pixabay search ${config.providerLatencyMs.search} ms · photo ${config.providerLatencyMs.photo} ms · clip ${config.providerLatencyMs.clip} ms · network ${config.netMs} ms RTT · local encode ${config.renderMs} ms/video`);
	console.log(`  transient failures ${JSON.stringify(config.aiFailureRate)} · invalid replies ${JSON.stringify(config.invalidRate)} · provider ${JSON.stringify(config.providerFailureRate)}`);
	console.log(`  media transport: ${config.media} · script loop: ${config.loopConcurrency} lanes`);
	console.log("");
	console.log(`MAKESPAN — all ${config.users * config.videos} videos exported: ${(summary.makespanMs / 1000).toFixed(1)} s`);
	console.log(`PIPELINE MAKESPAN — all rows finished (median user, before local encode): ${(summary.pipelineMakespanMs / 1000).toFixed(1)} s`);
	console.log("");
	console.log("| user | scripts | media pipeline | local encode | total | finished | worker reqs | provider reqs |");
	console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
	for (const user of summary.perUser) {
		console.log(`| ${user.user} | ${(user.scriptsMs / 1000).toFixed(1)} s | ${(user.mediaMs / 1000).toFixed(1)} s | ${(user.exportMs / 1000).toFixed(1)} s | ${(user.totalMs / 1000).toFixed(1)} s | ${user.finished}/${config.videos} | ${user.requests} | ${user.providerRequests} |`);
	}
	console.log("");
	console.log("| video | finished | script (writing) | voice (synth + timing) | prompts | images | animate | scenes | slides |");
	console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
	for (const video of summary.videos) {
		const stage = video.stageMs || {};
		const seconds = (value) => (value ? (value / 1000).toFixed(1) + " s" : "—");
		console.log(`| ${video.user}/row ${video.row} (${video.topic}) | ${video.finished ? "yes" : "NO — " + (video.error || video.stage)} | ${seconds(stage.writing)} | ${seconds((stage.voice || 0) + (stage.timing || 0))} | ${seconds(stage.prompts)} | ${seconds(stage.images)} | ${seconds(stage.animate)} | ${video.scenes} | ${video.slides} |`);
	}
	console.log("");
	console.log("Traffic and retries:");
	const keys = Object.keys(summary.requests).sort();
	for (const key of keys) console.log(`  ${String(summary.requests[key]).padStart(4)}  ${key}`);
	console.log(`  ----  total worker requests: ${summary.requestTotal}`);
	const ai = summary.ai;
	console.log("");
	console.log("Model calls (a retry is another call):");
	for (const stage of ["planner", "writer", "scenePlanner", "tts"]) {
		console.log(`  ${stage.padEnd(13)} ${String(ai.calls[stage]).padStart(4)} calls · ${String(ai.failures[stage]).padStart(3)} transient failures · ${(ai.busyMs[stage] / 1000).toFixed(1)} s of model time`);
	}
	const provider = summary.provider;
	console.log("");
	console.log(`Provider: ${provider.searches} searches · ${provider.photos} photos · ${provider.clips} clips · ${provider.externalTts} external TTS · ${provider.failures} failures`);
	console.log(`Script loop: ${JSON.stringify(summary.loop)}`);
	const direct = (summary.directMedia || []).filter((entry) => entry.debug && entry.debug.counters);
	if (direct.length) {
		console.log("");
		console.log("Browser-first media (pixabay-direct):");
		for (const entry of direct) console.log(`  ${entry.user}: ${JSON.stringify(entry.debug.counters)}`);
	}
	const noisy = (summary.logs || []).filter((line) => /fallback|failed|fell back|retry|refused|incomplete|gave up|error/i.test(line));
	if (noisy.length) {
		console.log("");
		console.log("Pipeline diagnostics (" + noisy.length + " of " + (summary.logs || []).length + "):");
		for (const line of noisy.slice(0, 14)) console.log("  · " + line.slice(0, 220));
	}
	console.log("");
}

async function main() {
	const summaries = [];
	for (let run = 1; run <= RUNS; run++) {
		if (!QUIET) console.error(`[bench] run ${run}/${RUNS} …`);
		summaries.push(await runOnce(run));
	}

	const byMakespan = summaries.slice().sort((a, b) => a.makespanMs - b.makespanMs);
	const representative = byMakespan[Math.floor(byMakespan.length / 2)];

	if (JSON_OUT) {
		writeFileSync(JSON_OUT, JSON.stringify({
			generatedAt: new Date().toISOString(),
			runs: summaries,
			median: {
				makespanMs: representative.makespanMs,
				pipelineMakespanMs: representative.pipelineMakespanMs,
				requestTotal: representative.requestTotal,
				aiCalls: representative.ai.calls,
				aiFailures: representative.ai.failures,
				aiBusyMs: representative.ai.busyMs,
				provider: representative.provider,
				requests: representative.requests,
				config: representative.config
			}
		}, null, 2));
		if (!QUIET) console.error(`[bench] wrote ${JSON_OUT}`);
	}

	if (!QUIET) {
		printReport(representative);
		if (summaries.length > 1) {
			console.log("All runs:");
			for (const summary of summaries) {
				console.log(`  run ${summary.run}: makespan ${(summary.makespanMs / 1000).toFixed(1)} s · pipeline ${(summary.pipelineMakespanMs / 1000).toFixed(1)} s · ${summary.requestTotal} worker requests · ${Object.values(summary.ai.calls).reduce((a, b) => a + b, 0)} model calls`);
			}
			console.log("");
		}
	} else {
		console.log(JSON.stringify({ makespanMs: representative.makespanMs, pipelineMakespanMs: representative.pipelineMakespanMs }));
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
