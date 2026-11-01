/*
 * Script pipeline benchmark — "why is it slow" with numbers instead of guesses.
 *
 * The model itself is stubbed with a configurable latency so the harness can
 * isolate the PIPELINE: how many model calls a scenario needs, which calls can
 * run concurrently, and what the request actually waits for. Run it with the
 * real latencies you see in production to reproduce the wall-clock figures in
 * current_code_latest.md:
 *
 *   node bench/script-pipeline-bench.mjs
 *   node bench/script-pipeline-bench.mjs --planner-ms 7200 --writer-ms 21000
 *   node bench/script-pipeline-bench.mjs --json
 *
 * Every scenario runs against src/modules/script-seo.ts and the note layer in
 * src/modules/script-notes*.ts, i.e. the same code the Worker deploys.
 */
import { performance } from "node:perf_hooks";

import { handleSeoScriptGeneration } from "../src/modules/script-seo.ts";
import {
	clearScriptNoteMemory,
	canonicalSourceUrl,
	scriptNoteId
} from "../src/modules/script-notes.ts";
import {
	handleScriptNoteRead,
	submitAsyncScriptJob
} from "../src/modules/script-notes-api.ts";
import { ScriptEventLoop } from "../src/modules/script-event-loop.ts";

const args = process.argv.slice(2);
function flag(name, fallback) {
	const index = args.indexOf("--" + name);
	if (index === -1) return fallback;
	const value = args[index + 1];
	return value === undefined ? true : value;
}

const PLANNER_MS = Number(flag("planner-ms", 7200));
const WRITER_MS = Number(flag("writer-ms", 21000));
const FETCH_MS = Number(flag("fetch-ms", 1800));
const JSON_OUT = Boolean(flag("json", false));

const plan = {
	title: "Yoga for a Calmer Morning",
	headings: ["Start with Yoga", "Find Your Balance"],
	longTail: "morning yoga poses for beginners in a small home studio",
	short: ["yoga", "breathing", "stretching", "balance"]
};

const goodLines = [
	`Try ${plan.longTail} today.`,
	"Let breathing settle into a steady rhythm.",
	"Gentle stretching can release tension.",
	"Practice balance with a chair nearby.",
	"Keep your breathing relaxed and natural.",
	"Comfortable stretching should never hurt.",
	"Your balance improves with patient practice.",
	`Return to ${plan.longTail} tomorrow.`
];
/* One short keyword is one use below its minimum: the classic SEO rejection. */
const shortLines = goodLines.slice();
shortLines[1] = "Let calm settle into a steady rhythm.";

function srt(lines) {
	const stamp = (seconds) => `00:00:${String(seconds).padStart(2, "0")},000`;
	return lines
		.map((line, index) => `${index + 1}\n${stamp(index * 4)} --> ${stamp((index + 1) * 4)}\n${line}`)
		.join("\n\n");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stubEnv(options = {}) {
	const calls = { planner: 0, writer: 0, total: 0 };
	const writerLines = options.writerLines || [goodLines];
	let writerIndex = 0;
	return {
		calls,
		env: {
			AI: {
				run: async (_model, input) => {
					calls.total++;
					const prompt = String(input.prompt || "");
					if (prompt.includes("SEO strategist")) {
						calls.planner++;
						await sleep(PLANNER_MS);
						return { response: JSON.stringify(plan) };
					}
					calls.writer++;
					await sleep(WRITER_MS);
					const lines = writerLines[Math.min(writerIndex++, writerLines.length - 1)];
					return { response: srt(lines) };
				}
			}
		}
	};
}

function stubFetch(html, ms = FETCH_MS) {
	return async () => {
		await sleep(ms);
		return {
			ok: true,
			status: 200,
			headers: { get: () => "text/html; charset=utf-8" },
			text: async () => html
		};
	};
}

const article = `<!doctype html><html><head><title>Morning Yoga for Beginners</title>
<meta name="description" content="A five minute morning yoga routine for stiff beginners.">
</head><body><h1>Morning Yoga for Beginners</h1>
<h2>Start with breathing</h2><h2>Move into gentle stretches</h2><h2>Finish with balance</h2>
<p>Most beginners rush the warm-up and feel stiff all day.</p>
<p>A short routine you actually do beats a perfect one you skip.</p></body></html>`;

function body(extra = {}) {
	return {
		topic: "Morning yoga",
		minutes: 1,
		speed: "medium",
		...extra
	};
}

async function runScenario(name, options) {
	clearScriptNoteMemory();
	const loop = new ScriptEventLoop({ concurrency: 4 });
	const stub = stubEnv(options.ai || {});
	const notes = options.notes || {};
	const request = () =>
		new Request("https://bench.test/api/script", {
			method: "POST",
			body: JSON.stringify(body(options.body))
		});

	const results = [];
	for (let run = 1; run <= (options.runs || 1); run++) {
		stub.calls.planner = 0;
		stub.calls.writer = 0;
		stub.calls.total = 0;
		const startedAt = performance.now();
		const response = await handleSeoScriptGeneration(
			request(),
			new URL("https://bench.test/api/script"),
			stub.env,
			"bench-model",
			async () => {},
			{
				loop,
				fetchImpl: stubFetch(article),
				waitUntil: () => {}
			}
		);
		const wallMs = performance.now() - startedAt;
		const payload = await response.json();
		results.push({
			run,
			status: response.status,
			wallMs: Math.round(wallMs),
			plannerCalls: stub.calls.planner,
			writerCalls: stub.calls.writer,
			noteId: payload.noteId || null,
			plannerSkipped: Boolean(payload.notePlannerSkipped),
			repaired: Boolean(payload.repaired)
		});
	}
	loop.close();
	return {
		name,
		notes: Boolean(notes.enabled),
		results: results,
		typicalMs: results[results.length - 1].wallMs,
		last: results[results.length - 1]
	};
}

async function runAsyncScenario() {
	clearScriptNoteMemory();
	const loop = new ScriptEventLoop({ concurrency: 4 });
	const stub = stubEnv();
	const startedAt = performance.now();
	const response = await submitAsyncScriptJob(
		new Request("https://bench.test/api/script?async=1", {
			method: "POST",
			body: JSON.stringify(body({ useNotes: true }))
		}),
		stub.env,
		"bench-model",
		{ loop, fetchImpl: stubFetch(article) }
	);
	const ticketMs = Math.round(performance.now() - startedAt);
	const ticket = await response.json();
	let polls = 0;
	let note = null;
	const pollStartedAt = performance.now();
	while (performance.now() - pollStartedAt < 120000) {
		polls++;
		const polled = await handleScriptNoteRead(
			ticket.noteId,
			stub.env,
			new URL("https://bench.test" + ticket.noteUrl)
		);
		note = await polled.json();
		if (note.terminal) break;
		await sleep(Number(ticket.pollAfterMs) || 900);
	}
	const scriptMs = Math.round(performance.now() - startedAt);
	loop.close();
	return {
		name: "async (submit + poll note)",
		status: response.status,
		ticketMs,
		scriptMs,
		polls,
		plannerCalls: stub.calls.planner,
		writerCalls: stub.calls.writer,
		state: note && note.state,
		noteId: ticket.noteId,
		noteUrl: ticket.noteUrl
	};
}

async function main() {
	const scenarios = [];

	scenarios.push(
		await runScenario("legacy, first writer reply misses a keyword", {
			body: {},
			ai: { writerLines: [shortLines, goodLines] }
		})
	);
	scenarios.push(
		await runScenario("legacy, clean first reply", { body: {}, ai: {} })
	);
	scenarios.push(
		await runScenario("note client, cold note + source URL", {
			body: { useNotes: true, sourceUrl: "https://example.com/yoga?utm_source=x" },
			ai: { writerLines: [shortLines, goodLines] }
		})
	);
	scenarios.push(
		await runScenario("note client, warm note (same topic)", {
			body: { useNotes: true, sourceUrl: "https://example.com/yoga?utm_source=x" },
			ai: { writerLines: [shortLines, goodLines] },
			runs: 2
		})
	);
	scenarios.push(
		await runScenario("note client + browser note (first run, misses a keyword)", {
			body: {
				useNotes: true,
				note: {
					updatedAt: Date.now(),
					keywordSet: plan,
					outline: [
						{ heading: "Start with Yoga", beat: "Open here.", words: 70 },
						{ heading: "Find Your Balance", beat: "Close here.", words: 70 }
					]
				}
			},
			ai: { writerLines: [shortLines, goodLines] }
		})
	);
	scenarios.push(
		await runScenario("note client + browser note (first run, clean reply)", {
			body: {
				useNotes: true,
				note: {
					updatedAt: Date.now(),
					keywordSet: plan,
					outline: [
						{ heading: "Start with Yoga", beat: "Open here.", words: 70 },
						{ heading: "Find Your Balance", beat: "Close here.", words: 70 }
					]
				}
			},
			ai: {}
		})
	);
	const asyncResult = await runAsyncScenario();

	/* Pipeline overhead only: the same note path with a 0 ms model. */
	const overheadStartedAt = performance.now();
	clearScriptNoteMemory();
	const overheadLoop = new ScriptEventLoop({ concurrency: 4 });
	const overheadStub = {
		env: {
			AI: {
				run: async (_model, input) => ({
					response: String(input.prompt || "").includes("SEO strategist")
						? JSON.stringify(plan)
						: srt(goodLines)
				})
			}
		}
	};
	const overheadResponse = await handleSeoScriptGeneration(
		new Request("https://bench.test/api/script", {
			method: "POST",
			body: JSON.stringify(body({ useNotes: true, sourceUrl: "https://example.com/yoga" }))
		}),
		new URL("https://bench.test/api/script"),
		overheadStub.env,
		"bench-model",
		async () => {},
		{ loop: overheadLoop, fetchImpl: stubFetch(article, 0) }
	);
	const overheadMs = Math.round(performance.now() - overheadStartedAt);
	await overheadResponse.json();
	overheadLoop.close();

	const id = scriptNoteId({ topic: "Morning yoga", minutes: 1, speed: "medium" });
	const url = canonicalSourceUrl("https://www.example.com/yoga/?utm_campaign=launch");

	if (JSON_OUT) {
		console.log(JSON.stringify({ plannerMs: PLANNER_MS, writerMs: WRITER_MS, fetchMs: FETCH_MS, overheadMs, scenarios, asyncResult, sampleNoteId: id, sampleUrl: url }, null, 2));
		return;
	}

	console.log("");
	console.log(`Model latency model: planner ${PLANNER_MS} ms, writer ${WRITER_MS} ms, page fetch ${FETCH_MS} ms`);
	console.log("");
	console.log(`Pipeline overhead with a 0 ms model and a 0 ms page fetch (note read, beat plan, keyword repair, note write-back): ${overheadMs} ms`);
	console.log("");
	console.log("| scenario | model calls (planner/writer) | response | waits for |");
	console.log("| --- | --- | --- | --- |");
	for (const scenario of scenarios) {
		for (const result of scenario.results) {
			console.log(
				`| ${scenario.name}${scenario.results.length > 1 ? " (run " + result.run + ")" : ""} | ` +
					`${result.plannerCalls}/${result.writerCalls} | ${result.status} | ${result.wallMs} ms |`
			);
		}
	}
	console.log(
		`| async submit (ticket returned immediately) | ${asyncResult.plannerCalls}/${asyncResult.writerCalls} | ` +
			`${asyncResult.status} | ${asyncResult.ticketMs} ms |`
	);
	console.log(
		`| async job finished (note polled ${asyncResult.polls}x) | ${asyncResult.plannerCalls}/${asyncResult.writerCalls} | ` +
			`200 | ${asyncResult.scriptMs} ms |`
	);
	console.log("");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
