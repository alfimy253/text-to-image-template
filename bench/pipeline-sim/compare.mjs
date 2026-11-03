/*
 * BEFORE / AFTER FOR THE THREE-USERS-THREE-VIDEOS BENCH.
 *
 *   node bench/pipeline-sim/compare.mjs results/baseline-scale1.json results/after-scale1.json
 *
 * Both files are `--json-out` documents from bench/three-users-three-videos.mjs,
 * so they carry every run of that measurement (`runs`) plus the representative
 * one (`median`). With `--runs N` the honest comparison is the median of the
 * runs, which is what this prints; a single-run file is its own median.
 *
 * Nothing here re-measures anything: it only reads the two documents, so the
 * numbers are exactly what the bench reported, including the split between
 * pipeline time (worker + browser) and the local encode (a fixed per-video cost
 * that no retry strategy can change, and which `stageTotalsMs.animate` carries).
 */
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (argv.length < 2) {
	console.error("usage: node bench/pipeline-sim/compare.mjs <before.json> <after.json> [--label-a NAME] [--label-b NAME]");
	process.exit(2);
}

function flag(name, fallback) {
	const index = argv.indexOf("--" + name);
	if (index === -1) return fallback;
	const value = argv[index + 1];
	return value === undefined || String(value).startsWith("--") ? true : value;
}

function load(path) {
	const doc = JSON.parse(readFileSync(path, "utf8"));
	const runs = Array.isArray(doc.runs) && doc.runs.length ? doc.runs : [doc];
	return { path, doc, runs };
}

const before = load(argv[0]);
const after = load(argv[1]);
const LABEL_A = String(flag("label-a", "before"));
const LABEL_B = String(flag("label-b", "after"));

/* ----------------------------------------------------------------- stats -- */

function median(values) {
	const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
	if (!sorted.length) return 0;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sum(values) {
	return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

const seconds = (ms) => (Number.isFinite(ms) ? ms / 1000 : 0).toFixed(1) + " s";

function delta(a, b, unit) {
	const diff = b - a;
	const pct = a ? (diff / a) * 100 : 0;
	const sign = diff > 0 ? "+" : "";
	const scaled = unit === "s" ? sign + (diff / 1000).toFixed(1) + " s" : sign + Math.round(diff);
	return scaled + (a || b ? " (" + sign + pct.toFixed(1) + "%)" : "");
}

/* One row per measured quantity: [name, valueOf(side), unit]. */
function perSide(pick) {
	return { a: median(before.runs.map(pick)), b: median(after.runs.map(pick)) };
}

function stageMedian(side, stages) {
	/*
	 * Median across that side's videos of one report column. A column can be
	 * several stage clocks: the table's "voice" is synthesis plus the timing
	 * pass that follows it.
	 */
	const keys = Array.isArray(stages) ? stages : [stages];
	const values = side.runs.flatMap((run) => (run.videos || [])
		.map((video) => keys.reduce((total, key) => total + (Number((video.stageMs || {})[key]) || 0), 0))
		.filter((ms) => Number.isFinite(ms)));
	return median(values);
}

function finishedCount(side) {
	return median(side.runs.map((run) => (run.videos || []).filter((video) => video.finished).length));
}

function videoCount(side) {
	return median(side.runs.map((run) => (run.videos || []).length));
}

function requestsByPath(side, matcher) {
	return median(side.runs.map((run) => sum(Object.entries(run.requests || {})
		.filter(([path]) => matcher(path))
		.map(([, count]) => count))));
}

function aiStat(side, group, stage) {
	return median(side.runs.map((run) => Number((((run.ai || {})[group] || {})[stage]) || 0)));
}

function aiCallsTotal(side) {
	return median(side.runs.map((run) => sum(Object.values((run.ai || {}).calls || {}))));
}

function directCounter(side, key) {
	return median(side.runs.map((run) => sum((run.directMedia || [])
		.map((entry) => ((entry.debug || {}).counters || {})[key] || 0))));
}

function loopStat(side, key) {
	return median(side.runs.map((run) => Number((run.loop || {})[key] || 0)));
}

function configOf(side) {
	const run = side.runs[Math.floor(side.runs.length / 2)] || {};
	/* Older result files carry the config on the median only. */
	return run.config || (side.doc.median || {}).config || {};
}

/* ---------------------------------------------------------------- report -- */

const lines = [];
function row(name, a, b, unit) {
	lines.push({ name, a, b, unit });
}

const cfgA = configOf(before);
const cfgB = configOf(after);

console.log("");
console.log("BEFORE / AFTER — three users × three videos (bench/three-users-three-videos.mjs)");
console.log(`  ${LABEL_A}: ${before.path} (${before.runs.length} run${before.runs.length === 1 ? "" : "s"})`);
console.log(`  ${LABEL_B}: ${after.path} (${after.runs.length} run${after.runs.length === 1 ? "" : "s"})`);
console.log("");
console.log("Config (must match for the delta to mean anything):");
for (const key of ["users", "videos", "scale", "netMs", "minutes", "renderMs", "media", "loopConcurrency", "seed"]) {
	const mark = String(cfgA[key]) === String(cfgB[key]) ? "  " : "≠ ";
	console.log(`${mark}${key.padEnd(16)} ${String(cfgA[key]).padEnd(14)} ${String(cfgB[key])}`);
}

/* Headline. */
let side = perSide((run) => run.makespanMs);
row("MAKESPAN (all videos exported)", side.a, side.b, "s");
side = perSide((run) => run.pipelineMakespanMs);
row("PIPELINE MAKESPAN (median user, pre-encode)", side.a, side.b, "s");
row("videos finished", finishedCount(before) + " / " + videoCount(before), finishedCount(after) + " / " + videoCount(after), "");
side = perSide((run) => run.requestTotal);
row("worker requests (all users)", side.a, side.b, "n");

console.log("");
console.log("Headline");
printBlock();

/* Per user. */
lines.length = 0;
for (const key of ["scriptsMs", "mediaMs", "exportMs", "totalMs", "requests"]) {
	const pick = (run) => median((run.perUser || []).map((user) => Number(user[key]) || 0));
	side = perSide(pick);
	row("per user · " + key.replace("Ms", ""), side.a, side.b, key === "requests" ? "n" : "s");
}
console.log("");
console.log("Per user (median across users, then across runs)");
printBlock();

/* Per video stage. */
lines.length = 0;
for (const [label, stages] of [
	["script (writing)", ["writing"]],
	["voice (synth + timing)", ["voice", "timing"]],
	["prompts", ["prompts"]],
	["images", ["images"]],
	["row finish", ["done"]]
]) {
	row("stage median · " + label, stageMedian(before, stages), stageMedian(after, stages), "s");
}
console.log("");
console.log("Per video stage (median wall time of one stage)");
printBlock();

/* Traffic. */
lines.length = 0;
const pathGroups = [
	["note polls (GET /api/script/notes)", (path) => path.startsWith("GET /api/script/notes")],
	["script submits (POST /api/script)", (path) => path.startsWith("POST /api/script")],
	["voiceover (POST /api/voiceover)", (path) => path.startsWith("POST /api/voiceover")],
	["image prompts (POST /api/image-prompts)", (path) => path.startsWith("POST /api/image-prompts")],
	["image fetch (POST /api/image)", (path) => path.startsWith("POST /api/image") && !path.startsWith("POST /api/image-prompts")],
	["media claims (POST /api/media/claim)", (path) => path.includes("media/claim")],
	["credits (POST /api/credits)", (path) => path.includes("credits")]
];
for (const [name, matcher] of pathGroups) {
	row(name, requestsByPath(before, matcher), requestsByPath(after, matcher), "n");
}
console.log("");
console.log("Worker traffic");
printBlock();

/* Model + provider. */
lines.length = 0;
row("model calls (all stages)", aiCallsTotal(before), aiCallsTotal(after), "n");
for (const stage of ["planner", "writer", "scenePlanner", "tts"]) {
	row("  " + stage + " calls", aiStat(before, "calls", stage), aiStat(after, "calls", stage), "n");
	row("  " + stage + " transient failures", aiStat(before, "failures", stage), aiStat(after, "failures", stage), "n");
	row("  " + stage + " model time", aiStat(before, "busyMs", stage), aiStat(after, "busyMs", stage), "s");
}
row("browser-first scenes", directCounter(before, "scenes"), directCounter(after, "scenes"), "n");
row("  resolved in the browser", directCounter(before, "direct"), directCounter(after, "direct"), "n");
row("  fell back to the worker", directCounter(before, "fallback"), directCounter(after, "fallback"), "n");
row("  failed", directCounter(before, "failed"), directCounter(after, "failed"), "n");
console.log("");
console.log("Model, provider and media transport");
printBlock();

/* Queue health. */
lines.length = 0;
row("loop lanes", perSide((run) => Number((run.config || {}).loopConcurrency) || 0).a, perSide((run) => Number((run.config || {}).loopConcurrency) || 0).b, "n");
row("jobs started", loopStat(before, "started"), loopStat(after, "started"), "n");
row("jobs completed", loopStat(before, "completed"), loopStat(after, "completed"), "n");
row("jobs failed", loopStat(before, "failed"), loopStat(after, "failed"), "n");
row("avg job run", loopStat(before, "avgRunMs"), loopStat(after, "avgRunMs"), "s");
const worstWait = (sideRuns) => median(sideRuns.map((run) => {
	const jobs = (run.loop || {}).jobs || [];
	return jobs.length ? Math.max(...jobs.map((job) => Number(job.waitMs) || 0)) : 0;
}));
row("worst queue wait", worstWait(before.runs), worstWait(after.runs), "s");
console.log("");
console.log("Script event loop");
printBlock();
console.log("");

function printBlock() {
	const width = Math.max(...lines.map((entry) => entry.name.length), 34);
	console.log("  " + "measurement".padEnd(width) + LABEL_A.padStart(14) + LABEL_B.padStart(14) + "   change");
	console.log("  " + "-".repeat(width + 14 + 14 + 16));
	for (const entry of lines) {
		const a = typeof entry.a === "number" ? (entry.unit === "s" ? seconds(entry.a) : String(Math.round(entry.a))) : String(entry.a);
		const b = typeof entry.b === "number" ? (entry.unit === "s" ? seconds(entry.b) : String(Math.round(entry.b))) : String(entry.b);
		const change = typeof entry.a === "number" && typeof entry.b === "number" ? delta(entry.a, entry.b, entry.unit) : "";
		console.log("  " + entry.name.padEnd(width) + a.padStart(14) + b.padStart(14) + "   " + change);
	}
}
