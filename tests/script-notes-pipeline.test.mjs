/*
 * The scriptwriting pipeline's note layer and event loop, guarded directly:
 *
 *  1. a DYNAMIC URL is canonicalized so campaign/session noise cannot fork
 *     the same article into a new note on every click;
 *  2. notes are written from the page WITHOUT a model call, and read back from
 *     `GET /api/script/notes/<id>`;
 *  3. a warm note removes the planner call from the pipeline (the 6-20 s the
 *     repeat run used to pay again) and the writer receives the note brief;
 *  4. a valid SRT that is one keyword use short is repaired deterministically
 *     instead of triggering another 90 s writer call — but only for note
 *     clients, so the legacy contract (coach the model and retry) is intact;
 *  5. `POST /api/script?async=1` answers 202 with a note id, the event loop
 *     finishes the job, and polling the note URL returns the script;
 *  6. the event loop keeps Node's phase order and its concurrency bound.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	canonicalSourceUrl,
	clearScriptNoteMemory,
	extractResearchNotes,
	researchSourceUrl,
	repairKeywordShortfall,
	scriptNoteId,
	buildNoteWriterBrief,
	emptyScriptNote,
	noteRunDone
} from "../src/modules/script-notes.ts";
import {
	handleScriptNoteWrite,
	handleScriptNoteRead,
	submitAsyncScriptJob
} from "../src/modules/script-notes-api.ts";
import { ScriptEventLoop } from "../src/modules/script-event-loop.ts";
import { handleSeoScriptGeneration, validateSrt } from "../src/modules/script-seo.ts";

const plan = {
	title: "Yoga for a Calmer Morning",
	headings: ["Start with Yoga", "Find Your Balance"],
	longTail: "morning yoga poses for beginners in a small home studio",
	short: ["yoga", "breathing", "stretching", "balance"]
};

const sentences = [
	`Try ${plan.longTail} today.`,
	"Let breathing settle into a steady rhythm.",
	"Gentle stretching can release tension.",
	"Practice balance with a chair nearby.",
	"Keep your breathing relaxed and natural.",
	"Comfortable stretching should never hurt.",
	"Your balance improves with patient practice.",
	`Return to ${plan.longTail} tomorrow.`
];

function makeSrt(lines = sentences) {
	return lines
		.map((line, index) => {
			const stamp = (seconds) => `00:00:${String(seconds).padStart(2, "0")},000`;
			return `${index + 1}\n${stamp(index * 4)} --> ${stamp((index + 1) * 4)}\n${line}`;
		})
		.join("\n\n");
}

const html = `<!doctype html><html><head>
<title>Morning Yoga for Beginners | Still Studio</title>
<meta name="description" content="A short morning yoga routine that fits a busy day.">
<meta name="keywords" content="morning yoga, beginners, home practice">
</head><body>
<nav><a href="/">Home</a></nav>
<h1>Morning Yoga for Beginners</h1>
<h2>Start with breathing</h2>
<h2>Move into gentle stretches</h2>
<h3>Finish with balance</h3>
<p>Most beginners rush the warm-up and pay for it later in the day.</p>
<p>A five minute routine beats a perfect routine you never start.</p>
</body></html>`;

function envWith(responses, calls = []) {
	let next = 0;
	return {
		calls,
		env: {
			AI: {
				run: async (model, input) => {
					calls.push({ model, prompt: input.prompt });
					const reply = responses[Math.min(next++, responses.length - 1)];
					if (reply instanceof Error) throw reply;
					return { response: reply };
				}
			}
		}
	};
}

function scriptRequest(body, path = "/api/script") {
	return new Request("https://studio.test" + path, {
		method: "POST",
		body: JSON.stringify(body)
	});
}

test("dynamic URLs are canonicalized so one article is one note", () => {
	const base = "https://www.example.com/posts/morning-yoga/";
	const variants = [
		"https://www.example.com/posts/morning-yoga/?utm_source=newsletter&utm_medium=email#start",
		"https://EXAMPLE.com/posts/morning-yoga?fbclid=abc",
		"example.com/posts/morning-yoga/?session=1234",
		"https://example.com/posts/morning-yoga"
	];
	const canonical = canonicalSourceUrl(base);
	assert.equal(canonical, "https://example.com/posts/morning-yoga");
	for (const variant of variants) assert.equal(canonicalSourceUrl(variant), canonical, variant);
	assert.equal(canonicalSourceUrl("javascript:alert(1)"), "");
	assert.equal(canonicalSourceUrl("not a url at all"), "");
	/* Kept parameters survive, in a stable order. */
	assert.equal(
		canonicalSourceUrl("https://example.com/a?b=2&a=1&utm_campaign=x"),
		"https://example.com/a?a=1&b=2"
	);
	const id = scriptNoteId({ topic: "yoga", sourceUrl: base, minutes: 1, speed: "medium" });
	assert.equal(
		id,
		scriptNoteId({ topic: "something else", sourceUrl: variants[0], minutes: 1, speed: "medium" })
	);
	assert.notEqual(id, scriptNoteId({ topic: "yoga", sourceUrl: base, minutes: 2, speed: "medium" }));
});

test("notes are written down from a live page with no model call", async () => {
	const notes = extractResearchNotes(html, "https://example.com/yoga");
	assert.match(notes.title, /Morning Yoga for Beginners/);
	assert.match(notes.description, /short morning yoga routine/);
	assert.deepEqual(notes.headings.slice(0, 3), [
		"Morning Yoga for Beginners",
		"Start with breathing",
		"Move into gentle stretches"
	]);
	assert.ok(notes.facts.some((fact) => /rush the warm-up/.test(fact)));
	assert.ok(!notes.facts.some((fact) => /<p>/.test(fact)), "markup never leaks into a note");

	let fetched = 0;
	const source = await researchSourceUrl("https://example.com/yoga", async () => {
		fetched++;
		return {
			ok: true,
			status: 200,
			headers: { get: () => "text/html; charset=utf-8" },
			text: async () => html
		};
	});
	assert.equal(fetched, 1);
	assert.equal(source.status, "fetched");
	assert.match(source.title, /Morning Yoga/);

	/* SSRF guard + graceful degradation: no request is made for private hosts. */
	let privateHits = 0;
	const privateSource = await researchSourceUrl("http://127.0.0.1:8787/admin", async () => {
		privateHits++;
		return { ok: true, headers: { get: () => "text/html" }, text: async () => "<h1>x</h1>" };
	});
	assert.equal(privateHits, 0);
	assert.equal(privateSource.status, "unreachable");

	const hanging = await researchSourceUrl(
		"https://example.com/slow",
		async () => new Promise(() => {}),
		25
	);
	assert.equal(hanging.status, "unreachable");
	assert.match(String(hanging.error), /timed out/);
});

test("POST /api/script/notes writes a note and GET returns it on its dynamic URL", async () => {
	clearScriptNoteMemory();
	const env = { AI: { run: async () => ({ response: "unused" }) } };
	const write = await handleScriptNoteWrite(
		scriptRequest(
			{
				url: "https://www.example.com/posts/morning-yoga/?utm_source=x",
				minutes: 1,
				speed: "medium"
			},
			"/api/script/notes"
		),
		env,
		{
			fetchImpl: async () => ({
				ok: true,
				status: 200,
				headers: { get: () => "text/html" },
				text: async () => html
			})
		}
	);
	assert.equal(write.status, 200);
	const written = await write.json();
	assert.equal(written.success, true);
	assert.match(written.noteId, /^nt-[a-z0-9]+$/);
	assert.equal(written.noteUrl, "/api/script/notes/" + written.noteId);
	assert.equal(written.note.source.status, "fetched");
	assert.ok(written.note.outline.length >= 2, "the beat plan comes from the page headings");

	const read = await handleScriptNoteRead(
		written.noteId,
		env,
		new URL("https://studio.test/api/script/notes/" + written.noteId)
	);
	assert.equal(read.status, 200);
	const readBack = await read.json();
	assert.equal(readBack.state, "empty");
	assert.equal(readBack.noteId, written.noteId);
	assert.match(String(readBack.noteUrl), new RegExp(written.noteId));

	const missing = await handleScriptNoteRead(
		"nt-deadbeef99",
		env,
		new URL("https://studio.test/api/script/notes/nt-deadbeef99")
	);
	assert.equal(missing.status, 404);
});

test("a dynamic URL used as the topic is researched, and the note is keyed on that URL", async () => {
	clearScriptNoteMemory();
	const { env, calls } = envWith([JSON.stringify(plan), makeSrt()]);
	const fetchImpl = async () => ({
		ok: true,
		status: 200,
		headers: { get: () => "text/html" },
		text: async () => html
	});
	const options = { fetchImpl };
	const response = await handleSeoScriptGeneration(
		scriptRequest({
			topic: "https://www.example.com/posts/morning-yoga/?utm_source=newsletter",
			minutes: 1,
			speed: "medium",
			useNotes: true
		}),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct",
		async () => {},
		options
	);
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(
		data.noteId,
		scriptNoteId({
			sourceUrl: "https://www.example.com/posts/morning-yoga/?utm_source=newsletter",
			minutes: 1,
			speed: "medium"
		}),
		"the note id is derived from the canonical URL"
	);
	/* The planner is told the slug, never the raw URL or its tracking params. */
	assert.match(calls[0].prompt, /morning yoga/);
	assert.doesNotMatch(calls[0].prompt, /utm_source/);
	/* The writer gets the researched page title instead of the slug. */
	assert.match(calls[1].prompt, /Morning Yoga for Beginners/);
	assert.match(calls[1].prompt, /REFERENCE NOTE/);

	/* Same article, campaign noise stripped: still the warm note, no planner. */
	calls.length = 0;
	const again = await handleSeoScriptGeneration(
		scriptRequest({
			topic: "https://example.com/posts/morning-yoga#start",
			minutes: 1,
			speed: "medium",
			useNotes: true
		}),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct",
		async () => {},
		options
	);
	const againData = await again.json();
	assert.equal(againData.noteId, data.noteId);
	assert.equal(againData.notePlannerSkipped, true);
	assert.equal(calls.length, 1, "writer only");
});

test("a warm note removes the planner call and the writer follows the note brief", async () => {
	clearScriptNoteMemory();
	const { env, calls } = envWith([JSON.stringify(plan), makeSrt()]);

	const first = await handleSeoScriptGeneration(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium", useNotes: true }),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct"
	);
	assert.equal(first.status, 200);
	const firstData = await first.json();
	assert.equal(firstData.success, true);
	assert.equal(calls.length, 2, "cold note: planner + writer");
	assert.match(firstData.noteId, /^nt-/);

	calls.length = 0;
	const second = await handleSeoScriptGeneration(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium", useNotes: true }),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct"
	);
	assert.equal(second.status, 200);
	const secondData = await second.json();
	assert.equal(secondData.notePlannerSkipped, true);
	assert.equal(calls.length, 1, "warm note: writer only");
	assert.doesNotMatch(calls[0].prompt, /SEO strategist/);
	assert.match(calls[0].prompt, /REFERENCE NOTE/);
	assert.match(calls[0].prompt, /beat plan/);
	assert.equal(secondData.script, firstData.script);

	/* Explicit reuse: the note hands back the stored script with no model call. */
	calls.length = 0;
	const cached = await handleSeoScriptGeneration(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium", useNotes: true, reuseScript: true }),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct"
	);
	assert.equal(cached.status, 200);
	const cachedData = await cached.json();
	assert.equal(cachedData.cachedNote, true);
	assert.equal(cachedData.script, firstData.script);
	assert.equal(calls.length, 0, "no model call when reusing a stored script");
});

test("a browser note removes the planner from the very first run", async () => {
	clearScriptNoteMemory();
	const { env, calls } = envWith([makeSrt()]); /* only the writer is reachable */
	const response = await handleSeoScriptGeneration(
		scriptRequest({
			topic: "Morning yoga",
			minutes: 1,
			speed: "medium",
			useNotes: true,
			note: {
				updatedAt: Date.now(),
				keywordSet: plan,
				outline: [
					{ heading: "Start with Yoga", beat: "Open here.", words: 70 },
					{ heading: "Find Your Balance", beat: "Close here.", words: 70 }
				]
			}
		}),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct"
	);
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(calls.length, 1, "writer only: the browser carried the plan");
	assert.equal(data.notePlannerSkipped, true);
	assert.equal(data.noteOrigin, "browser");
	assert.equal(data.keywords.longTail.keyword, plan.longTail);
	assert.ok(Array.isArray(data.outline) && data.outline.length === 2, "the beat plan is returned for the browser mirror");
	assert.match(calls[0].prompt, /REFERENCE NOTE/);
	assert.match(calls[0].prompt, /Start with Yoga/);
	assert.doesNotMatch(calls[0].prompt, /SEO strategist/);
});

test("a corrupted or stale browser note is ignored instead of breaking the script", async () => {
	const corrupted = envWith([JSON.stringify(plan), makeSrt()]);
	const corruptedResponse = await handleSeoScriptGeneration(
		scriptRequest({
			topic: "Morning yoga",
			minutes: 1,
			speed: "medium",
			useNotes: true,
			note: {
				updatedAt: Date.now(),
				keywordSet: { longTail: "", short: ["only one"] },
				outline: [{ heading: "", beat: 42 }, { nope: true }]
			}
		}),
		new URL("https://studio.test/api/script"),
		corrupted.env,
		"mock-instruct"
	);
	assert.equal(corruptedResponse.status, 200);
	assert.equal(corrupted.calls.length, 2, "planner + writer still ran");

	clearScriptNoteMemory();
	const stale = envWith([JSON.stringify(plan), makeSrt()]);
	const staleResponse = await handleSeoScriptGeneration(
		scriptRequest({
			topic: "Morning yoga",
			minutes: 1,
			speed: "medium",
			useNotes: true,
			note: {
				updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
				keywordSet: plan,
				outline: [{ heading: "Start with Yoga", beat: "Open", words: 70 }]
			}
		}),
		new URL("https://studio.test/api/script"),
		stale.env,
		"mock-instruct"
	);
	assert.equal(staleResponse.status, 200);
	assert.equal(stale.calls.length, 2, "a note older than the TTL is not trusted");
});

test("a server note outranks the browser copy, so a stale tab cannot rewrite a plan", async () => {
	clearScriptNoteMemory();
	const { env, calls } = envWith([JSON.stringify(plan), makeSrt()]);
	const other = {
		title: "Evening Wind Down",
		headings: ["Settle Down", "Sleep Better"],
		longTail: "evening wind down routine for better sleep",
		short: ["evening", "wind down", "sleep", "calm"]
	};
	/* Cold run with a browser note: the browser's plan is used. */
	await handleSeoScriptGeneration(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium", useNotes: true, note: { updatedAt: Date.now(), keywordSet: plan } }),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct"
	);
	calls.length = 0;
	const second = await handleSeoScriptGeneration(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium", useNotes: true, note: { updatedAt: Date.now(), keywordSet: other } }),
		new URL("https://studio.test/api/script"),
		env,
		"mock-instruct"
	);
	assert.equal(second.status, 200);
	const data = await second.json();
	assert.equal(calls.length, 1);
	assert.equal(data.keywords.longTail.keyword, plan.longTail, "the KV note kept its validated set");
});

test("a one-use keyword deficit is repaired locally for note clients only", async () => {
	clearScriptNoteMemory();
	const shortOne = sentences.slice();
	shortOne[1] = "Let calm settle into a steady rhythm.";

	/* Legacy request: unchanged contract, the model is coached and retried. */
	const legacy = envWith([JSON.stringify(plan), makeSrt(shortOne), makeSrt()]);
	const legacyResponse = await handleSeoScriptGeneration(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium" }),
		new URL("https://studio.test/api/script"),
		legacy.env,
		"mock-instruct"
	);
	assert.equal(legacyResponse.status, 200);
	assert.equal(legacy.calls.length, 3);
	const legacyData = await legacyResponse.json();
	assert.equal(legacyData.repaired, undefined);

	/* Note client: same failure, no third model call. */
	const noted = envWith([JSON.stringify(plan), makeSrt(shortOne)]);
	const notedResponse = await handleSeoScriptGeneration(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium", useNotes: true }),
		new URL("https://studio.test/api/script"),
		noted.env,
		"mock-instruct"
	);
	assert.equal(notedResponse.status, 200);
	const notedData = await notedResponse.json();
	assert.equal(noted.calls.length, 2, "planner + one writer call");
	assert.equal(notedData.repaired, true);
	assert.ok(notedData.repairedKeywords.includes("breathing"));
	assert.ok(notedData.keywords.short.every((item) => item.count >= 2));
	assert.equal(notedData.keywords.short.find((item) => item.keyword === "breathing").count >= 2, true);
});

test("repair never corrupts a valid SRT and gives up when it cannot help", () => {
	const check = validateSrt(makeSrt(), 1);
	assert.equal(check.ok, true);
	const impossible = repairKeywordShortfall(check.cues, {
		longTail: plan.longTail,
		shorts: ["yoga", "breathing", "stretching", "balance"]
	});
	assert.equal(impossible, null, "nothing to repair when every minimum is met");

	const deficit = validateSrt(
		makeSrt(sentences.map((line) => line.replace("breathing", "calm"))),
		1
	);
	assert.equal(deficit.ok, true);
	const repaired = repairKeywordShortfall(deficit.cues, {
		longTail: plan.longTail,
		shorts: ["yoga", "breathing", "stretching", "balance"]
	});
	assert.ok(repaired);
	const revalidated = validateSrt(repaired.srt, 1);
	assert.equal(revalidated.ok, true);
	assert.equal(revalidated.endMs, deficit.endMs, "timings are untouched");
	const words = (text) => String(text).split(/\s+/).filter(Boolean).length;
	repaired.cues.forEach((cue, index) => {
		assert.ok(words(cue.text) >= words(deficit.cues[index].text), "no cue loses words");
	});
	const touched = new Set(repaired.patched.flatMap((entry) => entry.cues));
	for (const cue of repaired.cues.filter((item) => touched.has(item.index))) {
		assert.ok(cue.lines.length <= 3);
		assert.ok(cue.lines.every((line) => line.length <= 42));
	}
});

test("async mode parks the job on the loop and the note URL returns the script", async () => {
	clearScriptNoteMemory();
	const loop = new ScriptEventLoop({ concurrency: 2 });
	const { env, calls } = envWith([JSON.stringify(plan), makeSrt()]);
	const response = await submitAsyncScriptJob(
		scriptRequest({ topic: "Morning yoga", minutes: 1, speed: "medium" }, "/api/script?async=1"),
		env,
		"mock-instruct",
		{ loop }
	);
	assert.equal(response.status, 202);
	const ticket = await response.json();
	assert.equal(ticket.pending, true);
	assert.equal(ticket.state, "queued");
	assert.equal(ticket.noteUrl, "/api/script/notes/" + ticket.noteId);
	assert.ok(Number(ticket.pollAfterMs) > 0);

	await loop.drain();
	assert.equal(calls.length, 2);

	const poll = await handleScriptNoteRead(
		ticket.noteId,
		env,
		new URL("https://studio.test" + ticket.noteUrl)
	);
	const note = await poll.json();
	assert.equal(note.state, "done");
	assert.equal(note.terminal, true);
	assert.ok(note.script && note.script.length > 40);
	assert.equal(note.keywords.longTail, plan.longTail);
	assert.ok(note.outline.length >= 2);
	assert.ok(note.ring.totalMs >= 0);
	assert.ok(loop.stats().completed >= 1);
	loop.close();
});

test("the event loop keeps Node's phase order, its concurrency bound and its queue cap", async () => {
	const loop = new ScriptEventLoop({ concurrency: 2, maxQueue: 2 });

	/*
	 * Node's order inside one turn: pending (nextTick) → poll → check
	 * (setImmediate) → timers. A job that queues one of each must therefore
	 * observe them in exactly that order.
	 */
	const order = [];
	await loop.schedule(async () => {
		loop.nextTick(() => order.push("pending"));
		loop.immediate(() => order.push("check"));
		loop.defer(30, () => order.push("timers"));
		return "phases";
	}, { id: "phases" });
	await loop.drain();
	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.deepEqual(order, ["pending", "check", "timers"]);

	let active = 0;
	let max = 0;
	const slow = () =>
		new Promise((resolve) => {
			active++;
			max = Math.max(max, active);
			setTimeout(() => {
				active--;
				resolve("done");
			}, 15);
		});
	const before = loop.stats();
	const results = await Promise.all([
		loop.schedule(slow, { id: "a" }),
		loop.schedule(slow, { id: "b" }),
		loop.schedule(slow, { id: "c" })
	]);
	assert.deepEqual(results, ["done", "done", "done"]);
	assert.equal(max, 2, "concurrency bound holds");
	const stats = loop.stats();
	assert.equal(stats.started, before.started + 3);
	assert.equal(stats.completed, before.completed + 3);
	assert.ok(stats.phases.poll >= 3);
	assert.equal(stats.active, 0);

	const gated = new ScriptEventLoop({ concurrency: 1, maxQueue: 1 });
	const blocker = gated.schedule(() => new Promise((resolve) => setTimeout(resolve, 20)), { id: "block" });
	const waiting = gated.schedule(() => Promise.resolve(1), { id: "waiting" });
	await assert.rejects(
		gated.schedule(() => Promise.resolve(2), { id: "overflow" }),
		/queue is full/
	);
	await Promise.all([blocker, waiting]);
	await gated.drain();
	assert.equal(gated.stats().failed, 0);

	/* A failing job is isolated: the loop keeps running and reports it. */
	const results2 = await Promise.allSettled([
		gated.schedule(async () => {
			throw new Error("model exploded");
		}, { id: "boom" }),
		gated.schedule(async () => "still here", { id: "after" })
	]);
	assert.equal(results2[0].status, "rejected");
	assert.equal(results2[1].status, "fulfilled");
	assert.equal(gated.stats().failed, 1);
	loop.close();
	gated.close();
});

test("note briefs carry the research and the beat budget without the raw page", () => {
	const note = emptyScriptNote({
		id: scriptNoteId({ topic: "Morning yoga", minutes: 1, speed: "medium" }),
		topic: "Morning yoga",
		minutes: 1,
		speed: "medium"
	});
	note.source = {
		url: "https://example.com/yoga",
		status: "fetched",
		title: "Morning Yoga for Beginners",
		description: "A short routine for busy mornings.",
		headings: ["Start with breathing", "Gentle stretches"],
		keywords: ["morning yoga", "beginners"],
		facts: ["Most beginners rush the warm-up."],
		ms: 30
	};
	note.keywordSet = {
		title: plan.title,
		headings: plan.headings,
		longTail: plan.longTail,
		shorts: plan.short,
		titleMatchedShorts: ["yoga"],
		headingMatchedShorts: ["yoga"]
	};
	noteRunDone(note, {
		script: "hello",
		durationMs: 1000,
		model: "mock",
		timings: { planMs: 1, writeMs: 2, totalMs: 3, savedModelCalls: 1, savedMs: 7200 }
	});
	const brief = buildNoteWriterBrief(note);
	assert.match(brief, /REFERENCE NOTE/);
	assert.match(brief, /https:\/\/example\.com\/yoga/);
	assert.match(brief, /Most beginners rush the warm-up/);
	assert.match(brief, /Start with breathing/);
	assert.match(brief, /Do not add sections that are not in the beat plan/);
	assert.ok(brief.length < 2000, "the brief stays small; every token costs latency");
});
