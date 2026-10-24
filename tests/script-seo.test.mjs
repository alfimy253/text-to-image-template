import assert from "node:assert/strict";
import test from "node:test";
import {
	parseKeywordSet,
	keywordCount,
	keywordUsageError,
	keywordUsageAudit,
	keywordOverlapInstructions,
	srtSpokenText,
	validateSrt,
	handleSeoScriptGeneration
} from "../src/modules/script-seo.ts";

const plan = {
	title: "Yoga for a Calmer Morning",
	headings: ["Start with Yoga", "Find Your Balance"],
	longTail: "morning yoga poses for beginners in a small home studio",
	short: ["yoga", "breathing", "stretching", "balance"]
};
const keywordSet = { longTail: plan.longTail, shorts: plan.short };
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
	return lines.map((line, index) => {
		const stamp = (seconds) => `00:00:${String(seconds).padStart(2, "0")},000`;
		return `${index + 1}\n${stamp(index * 4)} --> ${stamp((index + 1) * 4)}\n${line}`;
	}).join("\n\n");
}

function generate(responses, body = {}) {
	const prompts = [];
	let next = 0;
	const env = {
		AI: {
			run: async (_model, input) => {
				prompts.push(input);
				return { response: responses[Math.min(next++, responses.length - 1)] };
			}
		}
	};
	const request = new Request("https://studio.test/api/script?debug=1", {
		method: "POST",
		body: JSON.stringify({ topic: "Morning yoga", minutes: 1, speed: "medium", ...body })
	});
	return {
		prompts,
		response: handleSeoScriptGeneration(request, new URL(request.url), env, "mock-instruct")
	};
}

test("short keyword may be contained in the long-tail keyword", () => {
	const result = parseKeywordSet(JSON.stringify(plan));
	assert.equal(result.ok, true);
	assert.equal(result.data.longTail, plan.longTail);
	assert.deepEqual(result.data.shorts, plan.short);
});

test("long-tail keyword has no minimum/maximum word or character length", () => {
	for (const longTail of [
		"yoga",
		"morning yoga",
		plan.longTail,
		`yoga ${Array.from({ length: 100 }, (_, i) => `specific${i}`).join(" ")}`,
		"a".repeat(500)
	]) {
		assert.equal(parseKeywordSet(JSON.stringify({ ...plan, longTail })).ok, true, longTail);
	}
	assert.equal(parseKeywordSet(JSON.stringify({ ...plan, longTail: "   " })).ok, false);
});

test("same phrase can serve as both a short and long-tail keyword", () => {
	const result = parseKeywordSet(JSON.stringify({ ...plan, longTail: "yoga" }));
	assert.equal(result.ok, true);
	assert.equal(keywordUsageError("yoga breathing stretching balance yoga breathing stretching balance", {
		longTail: "yoga", shorts: plan.short
	}), "");
});

test("one-word long-tail can overlap a longer short phrase without extra standalone uses", () => {
	const shorts = ["yoga poses", "breathing", "stretching", "balance"];
	const parsed = parseKeywordSet(JSON.stringify({ ...plan, longTail: "yoga", short: shorts, title: "Yoga Poses Explained", headings: ["Try Yoga Poses"] }));
	assert.equal(parsed.ok, true);
	const set = { longTail: "yoga", shorts };
	assert.equal(keywordUsageError("yoga poses breathing stretching balance yoga poses breathing stretching balance", set), "");
	assert.match(keywordOverlapInstructions(set), /Do not add extra standalone long-tail uses/);
});

test("existing short keyword, title and heading rules stay enforced", () => {
	for (const change of [
		{ short: ["yoga", "breathing", "stretching"] },
		{ short: ["yoga", "yoga", "stretching", "balance"] },
		{ short: ["yoga", "a four word phrase", "stretching", "balance"] },
		{ title: "No Matching Search Term" },
		{ title: "Yoga " + "x".repeat(70) },
		{ headings: [] },
		{ headings: ["No matching search term"] }
	]) {
		assert.equal(parseKeywordSet(JSON.stringify({ ...plan, ...change })).ok, false);
	}
	// This request relaxes cross-role overlap, not nesting among the four shorts.
	assert.equal(parseKeywordSet(JSON.stringify({ ...plan, short: ["yoga", "yoga poses", "breathing", "balance"] })).ok, false);
});

test("nested uses count for both roles, not as extra standalone requirements", () => {
	const check = validateSrt(makeSrt(), 1);
	assert.equal(check.ok, true);
	const spoken = srtSpokenText(check.srt);
	assert.equal(keywordUsageError(spoken, keywordSet), "");
	assert.equal(keywordCount(spoken, "yoga"), 2);
	assert.ok(keywordUsageAudit(spoken, check.cues, keywordSet).every((item) => item.ok && item.count === 2));
});

test("keyword frequency is minimum-only: extra uses are never rejected", () => {
	const check = validateSrt(makeSrt(), 1);
	assert.equal(check.ok, true);
	const spoken = srtSpokenText(check.srt);
	// Third and fourth uses of a short keyword stay valid.
	assert.equal(keywordUsageError(spoken + " Yoga. Yoga again.", keywordSet), "");
	assert.equal(keywordCount(spoken + " Yoga. Yoga again.", "yoga"), 4);
	// A third long-tail use is valid too.
	assert.equal(keywordUsageError(spoken + " " + keywordSet.longTail + ".", keywordSet), "");
	const audit = keywordUsageAudit(spoken + " Yoga.", check.cues, keywordSet);
	const yoga = audit.find((item) => item.keyword === "yoga");
	assert.equal(yoga.count, 3);
	assert.equal(yoga.min, 2);
	assert.equal(yoga.max, null);
	assert.equal(yoga.ok, true);
});

test("long-tail keyword needs at least one use, each short at least two", () => {
	const check = validateSrt(makeSrt(), 1);
	assert.equal(check.ok, true);
	const spoken = srtSpokenText(check.srt);

	// Exactly one long-tail use already satisfies the rule.
	const once = spoken.replaceAll(keywordSet.longTail, "morning routine");
	assert.equal(keywordCount(once, keywordSet.longTail), 0);
	assert.match(
		keywordUsageError(once, keywordSet),
		/the long-tail keyword "morning yoga poses for beginners in a small home studio" appears 0 time\(s\); it must appear at least 1 time/
	);

	// One short use below its minimum is the reported first violation.
	const missingShort = spoken.replace("Let breathing settle into a steady rhythm.", "Let calm settle into a steady rhythm.");
	assert.equal(keywordCount(missingShort, "breathing"), 1);
	assert.match(
		keywordUsageError(missingShort, keywordSet),
		/the short keyword "breathing" appears 1 time\(s\); it must appear at least 2 time/
	);
});

test("long phrases and overlapping shorts match across subtitle line/cue breaks", () => {
	const splitLines = sentences.slice();
	splitLines[0] = "Try morning yoga poses for beginners\nin a small home studio today.";
	splitLines[7] = "Return to morning yoga poses for beginners\nin a small home studio tomorrow.";
	const check = validateSrt(makeSrt(splitLines), 1);
	assert.equal(check.ok, true);
	assert.equal(keywordUsageError(srtSpokenText(check.srt), keywordSet), "");
	assert.equal(keywordCount("morning\nyoga poses\nfor beginners", "morning yoga poses for beginners"), 1);
});

test("keyword matching retains Unicode, hyphen and symbol boundaries", () => {
	assert.equal(keywordCount("Real-time café lessons in C++ and C#; .NET too.", "real time"), 1);
	assert.equal(keywordCount("café cafés", "café"), 1);
	assert.equal(keywordCount("C++ C++17", "c++"), 1);
	assert.equal(keywordCount("C# C#tag", "c#"), 1);
	assert.equal(keywordCount(".NET .NETwork", ".net"), 1);
	assert.equal(keywordCount("said ai", "ai"), 1);
});

test("writer receives the explicit minimum-frequency and shared-count budget", () => {
	const brief = keywordOverlapInstructions(keywordSet);
	assert.match(brief, /MINIMUM FREQUENCY/);
	assert.match(brief, /at least 2 times/);
	assert.match(brief, /counts toward BOTH totals/);
	assert.match(brief, /already contributes 1 short-keyword use/);
	assert.match(brief, /needs 1 additional standalone use/);
	// The long-tail is said at least once, so an identical phrase needs no extra use.
	const same = keywordOverlapInstructions({ longTail: "yoga", shorts: ["yoga", "breathing", "stretching", "balance"] });
	assert.match(same, /already contributes 1 short-keyword use/);
	assert.match(same, /needs 1 additional standalone use/);
});

test("API accepts the formerly rejected overlapping, >6-word plan on the first attempt", async () => {
	const run = generate([JSON.stringify(plan), makeSrt()]);
	const response = await run.response;
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(data.success, true);
	assert.equal(run.prompts.length, 2);
	assert.ok(data.keywords.short.every((item) => item.count === 2));
	assert.equal(data.keywords.longTail.count, 2);
	assert.equal(data.keywords.longTail.min, 1);
	assert.ok(data.keywords.short.every((item) => item.min === 2));
	assert.match(run.prompts[0].prompt, /NO minimum or maximum word count or character length/);
	assert.match(run.prompts[0].prompt, /SHORT\/LONG-TAIL OVERLAP IS ALLOWED/);
	assert.doesNotMatch(run.prompts[0].prompt, /CRITICAL NON-OVERLAP|2-6 words/);
	assert.match(run.prompts[1].prompt, /needs 1 additional standalone use/);
	assert.equal(data.debug.plannerAttempts.length, 1);
	assert.equal(data.debug.writerAttempts.length, 1);
});

test("writer retry adds a short keyword that is below its minimum", async () => {
	const badLines = sentences.slice();
	badLines[1] = "Let calm settle into a steady rhythm.";
	const run = generate([JSON.stringify(plan), makeSrt(badLines), makeSrt()]);
	const response = await run.response;
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(run.prompts.length, 3);
	assert.match(run.prompts[2].prompt, /ADD "breathing" 1 more time/);
	assert.match(run.prompts[2].prompt, /reaches at least 2/);
	assert.match(run.prompts[2].prompt, /Preserve correct long-tail uses/);
	assert.equal(data.debug.writerAttempts[0].failureStage, "seo");
	assert.equal(data.debug.writerAttempts[1].ok, true);
});

test("writer accepts a script that repeats keywords above their minimums", async () => {
	const extraLines = sentences.slice();
	extraLines[1] += " Yoga. Breathing.";
	const run = generate([JSON.stringify(plan), makeSrt(extraLines)]);
	const response = await run.response;
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(run.prompts.length, 2);
	assert.ok(data.keywords.short.every((item) => item.count >= 2));
	assert.ok(data.keywords.longTail.count >= 1);
	assert.ok(data.keywords.short.every((item) => item.max === null));
	assert.equal(data.keywords.longTail.max, null);
});

test("API still rejects bad request inputs before calling AI", async () => {
	for (const body of [{ minutes: 0 }, { minutes: 7 }, { minutes: 1.5 }, { minutes: true }, { speed: "unknown" }]) {
		const run = generate([JSON.stringify(plan)], body);
		assert.equal((await run.response).status, 400);
		assert.equal(run.prompts.length, 0);
	}
});

test("API bounds retries and never accepts unverified keyword counts", async () => {
	const run = generate([JSON.stringify(plan), makeSrt(sentences.map((line) => line.replaceAll("yoga", "exercise")))]);
	const response = await run.response;
	assert.equal(response.status, 500);
	const data = await response.json();
	assert.equal(data.success, false);
	assert.equal(data.debug.writerAttempts.length, 3);
	assert.equal(run.prompts.length, 4);
});

test("SRT duration and cue-overlap checks have not been relaxed", () => {
	assert.equal(validateSrt("1\n00:00:00,000 --> 00:00:03,000\nToo short.", 1).ok, false);
	assert.equal(validateSrt("1\n00:00:00,000 --> 00:02:00,000\nToo long.", 1).ok, false);
	assert.equal(validateSrt("1\n00:00:00,000 --> 00:00:10,000\nFirst.\n\n2\n00:00:09,000 --> 00:00:14,000\nOverlap.", 1).ok, false);
});
