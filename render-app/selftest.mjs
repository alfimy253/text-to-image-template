/*
 * npm run check  ->  this file.
 *
 * It exercises the parts of the app that do NOT need a browser: the API key
 * gate, the 20,000 character limit, the two-voice rule, the chunking, the
 * MP3 concatenation, and the whole HTTP round trip against the offline
 * `mock` provider. Run `npm start` (or set TTS_PROVIDER to a real host) to
 * put Playwright in front of a live text-to-speech site.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	API_KEY,
	MAX_SCRIPT_CHARS,
	VOICES,
	VOICE_IDS,
	acceptsScript,
	concatMp3,
	looksLikeMp3,
	normalizeVoice,
	splitScript,
	synthesize
} from "./lib/tts-engine.mjs";

import { createApp } from "./server.mjs";

let failures = 0;

function check(label, condition, extra) {
	if (condition) {
		console.log("  ok   " + label);
		return;
	}
	failures += 1;
	console.error("  FAIL " + label + (extra ? " — " + extra : ""));
}

const dir = mkdtempSync(join(tmpdir(), "render-app-selftest-"));

process.env.TTS_OUTPUT_DIR = dir;
process.env.TTS_PROVIDER = "mock";

console.log("\nengine contract");
check("hardcoded key is the one the studio sends", API_KEY === "1290890909&aPiky2026");
check("script cap is 20,000 characters", MAX_SCRIPT_CHARS === 20000);
check("exactly two voices: male + female", VOICE_IDS.join(",") === "male,female");
check("unknown voice is rejected", normalizeVoice("dog") === null);
check("case does not matter", normalizeVoice(" Female ") === "female");
check("over-long script is refused", !acceptsScript("a".repeat(MAX_SCRIPT_CHARS + 1)).ok);
check("empty script is refused", !acceptsScript("   ").ok);
check("a 20,000 character script is accepted", acceptsScript("a".repeat(MAX_SCRIPT_CHARS)).ok);

console.log("\nchunking");
{
	const sentences = Array.from({ length: 40 }, (_, i) => "Sentence number " + (i + 1) + " talks about the weather.");
	const chunks = splitScript(sentences.join(" "));
	check("long scripts are split", chunks.length > 1, chunks.length + " chunks");
	check("every chunk fits the host box", chunks.every((chunk) => chunk.length <= 280));
	check("nothing is lost", chunks.join(" ").replace(/\s+/g, " ").trim() === sentences.join(" ").replace(/\s+/g, " ").trim());
	check("no punctuation is still handled", splitScript("word ".repeat(600).trim()).every((chunk) => chunk.length <= 280));
	check("short text is one chunk", splitScript("Hello.").length === 1);
}

console.log("\noffline render");
{
	const result = await synthesize({
		text: "Morning yoga opens the shoulders. Long tails follow the breath.",
		voice: "female",
		provider: "mock",
		outputDir: dir
	});

	const bytes = readFileSync(result.file);

	check("an MP3 came out", result.chunks === 1 && bytes.length > 1000);
	check("it is a real MP3 stream", looksLikeMp3(bytes));
	check("the voice is reported back", result.voice === "female" && VOICES[result.voice].label === "Female voice");

	const joined = concatMp3([result.file, result.file], join(dir, "joined.mp3"));
	const joinedBytes = readFileSync(joined.file);

	check("concatenation keeps a valid MP3", looksLikeMp3(joinedBytes));
	check("concatenation grows the file", joinedBytes.length > bytes.length, joinedBytes.length + " vs " + bytes.length);
	check("no ID3 tag is duplicated", (joinedBytes[0] === 0x49 ? 1 : 0) === 0);
}

console.log("\nhttp round trip");
{
	const server = createApp();

	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

	const base = "http://127.0.0.1:" + server.address().port;

	const health = await (await fetch(base + "/api/health")).json();
	check("health lists both voices", health.voices.map((v) => v.id).join(",") === "male,female");
	check("health publishes the cap", health.maxScriptChars === MAX_SCRIPT_CHARS);
	check("the page is served", (await fetch(base + "/")).ok);

	const wrongKey = await fetch(base + "/api/tts", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ apiKey: "nope", script: "hello", voice: "male" })
	});
	check("a wrong key gets 401", wrongKey.status === 401);

	const tooLong = await fetch(base + "/api/tts", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ apiKey: API_KEY, script: "a".repeat(MAX_SCRIPT_CHARS + 5), voice: "male" })
	});
	check("an over-long script gets 400", tooLong.status === 400);

	const badVoice = await fetch(base + "/api/tts", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ apiKey: API_KEY, script: "hello", voice: "robot" })
	});
	check("a third voice does not exist", badVoice.status === 400);

	const started = await fetch(base + "/api/tts", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			apiKey: API_KEY,
			provider: "mock",
			voice: "male",
			script: "One sentence about the topic. Another that explains it further. And a closing line."
		})
	});
	const startedData = await started.json();

	check("the job is accepted", started.status === 202 && !!startedData.jobId);

	let view = null;
	for (let attempt = 0; attempt < 200; attempt++) {
		view = await (await fetch(base + startedData.statusUrl)).json();
		if (view.stage === "done" || view.stage === "error") {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}

	check("the job finishes", view && view.stage === "done", view && view.error);
	check("progress reached 100%", view && view.percent === 100);
	check("an MP3 url is published", view && typeof view.url === "string" && view.url.endsWith(".mp3"));

	const audio = await fetch(base + view.url);
	const audioBytes = Buffer.from(await audio.arrayBuffer());
	check("the MP3 downloads", audio.ok && looksLikeMp3(audioBytes), audioBytes.length + " bytes");

	const missing = await fetch(base + "/api/job/does-not-exist");
	check("an unknown job is 404", missing.status === 404);

	await new Promise((resolve) => server.close(resolve));
}

rmSync(dir, { recursive: true, force: true });

if (failures) {
	console.error("\n" + failures + " self-test check(s) failed\n");
	process.exit(1);
}

console.log("\nall render-app checks passed\n");
