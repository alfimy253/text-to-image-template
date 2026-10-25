/*
 * The zipped render app (requirement #7): a script of up to 20,000
 * characters + ONE male or ONE female voice, spoken by a free no-login
 * online TTS site driven through Playwright, with a hardcoded API key.
 *
 * Playwright and its browser are not installed in this sandbox, so the
 * checks here run the parts that do not need them: the contract, the
 * chunking, the offline provider, the MP3 join and the HTTP routes.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../render-app/", import.meta.url);
const engineUrl = new URL("lib/tts-engine.mjs", ROOT).href;
const serverUrl = new URL("server.mjs", ROOT).href;

const engine = await import(engineUrl);

function tempDir() {
	return mkdtempSync(join(tmpdir(), "render-app-test-"));
}

test("the render app speaks a script through its hardcoded key and two voices", async () => {
	const {
		API_KEY,
		MAX_SCRIPT_CHARS,
		VOICE_IDS,
		VOICES,
		acceptsScript,
		normalizeVoice,
		splitScript
	} = engine;

	assert.equal(API_KEY, "1290890909&aPiky2026");
	assert.equal(MAX_SCRIPT_CHARS, 20000);
	assert.deepEqual(VOICE_IDS, ["male", "female"]);
	assert.equal(Object.keys(VOICES).length, 2);
	assert.equal(normalizeVoice("male"), "male");
	assert.equal(normalizeVoice("female"), "female");
	assert.equal(normalizeVoice("clone-of-morgan"), null);
	assert.equal(acceptsScript("x".repeat(MAX_SCRIPT_CHARS)).ok, true);
	assert.match(acceptsScript("x".repeat(MAX_SCRIPT_CHARS + 1)).error, /limit is 20000/);
	assert.equal(acceptsScript("  ").ok, false);

	const sentences = Array.from({ length: 60 }, (_, i) => "Sentence " + (i + 1) + " carries the narration onward.");
	const chunks = splitScript(sentences.join(" "));

	assert.ok(chunks.length > 1);
	assert.ok(chunks.every((chunk) => chunk.length <= 280));
	assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), sentences.join(" ").replace(/\s+/g, " ").trim());
});

test("the offline provider produces a real MP3 and chunks join into one file", async () => {
	const dir = tempDir();

	try {

		const { concatMp3, looksLikeMp3, synthesize } = engine;

		const first = await synthesize({
			text: "First sentence about the topic. Second sentence that keeps going.",
			voice: "male",
			provider: "mock",
			outputDir: dir
		});

		assert.equal(first.chunks, 1);
		assert.equal(first.voice, "male");

		const bytes = readFileSync(first.file);
		assert.ok(looksLikeMp3(bytes), "the mock answer is a playable MP3");
		assert.ok(bytes.length > 1000);

		const second = await synthesize({
			text: Array.from({ length: 40 }, (_, i) => "Packed sentence number " + (i + 1) + " with some detail.").join(" "),
			voice: "female",
			provider: "mock",
			outputDir: dir
		});

		assert.ok(second.chunks > 1, "a long script is spoken in pieces");

		const joined = concatMp3([first.file, second.file], join(dir, "joined.mp3"));

		assert.equal(joined.chunks, 2);
		assert.ok(looksLikeMp3(readFileSync(joined.file)));
		assert.ok(joined.bytes > bytes.length);

	}
	finally {
		rmSync(dir, { recursive: true, force: true });
	}

});

test("the render app refuses without the key and answers 400 on a bad request", async () => {
	const dir = tempDir();

	process.env.TTS_OUTPUT_DIR = dir;
	process.env.TTS_PROVIDER = "mock";

	const { createApp } = await import(serverUrl);
	const { API_KEY, MAX_SCRIPT_CHARS } = engine;

	const server = createApp();
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

	const base = "http://127.0.0.1:" + server.address().port;

	try {

		const post = (body) => fetch(base + "/api/tts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body)
		});

		assert.equal((await post({ apiKey: "wrong", script: "hi", voice: "male" })).status, 401);
		assert.equal((await post({ script: "hi", voice: "male" })).status, 401);
		assert.equal((await post({ apiKey: API_KEY, script: "x".repeat(MAX_SCRIPT_CHARS + 1), voice: "male" })).status, 400);
		assert.equal((await post({ apiKey: API_KEY, script: "hi", voice: "third" })).status, 400);
		assert.equal((await post({ apiKey: API_KEY, script: "hi", voice: "male", provider: "nope" })).status, 400);

		const accepted = await post({
			apiKey: API_KEY,
			script: "Morning yoga opens the shoulders. Long tails follow the breath and the day starts level.",
			voice: "female",
			provider: "mock"
		});

		assert.equal(accepted.status, 202);

		const started = await accepted.json();
		assert.ok(started.jobId);
		assert.equal(started.voice, "female");

		let view = null;

		for (let attempt = 0; attempt < 200; attempt++) {
			view = await (await fetch(base + started.statusUrl)).json();
			if (view.stage === "done" || view.stage === "error") {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}

		assert.equal(view.stage, "done", view.error || "the job never finished");
		assert.equal(view.percent, 100);
		assert.ok(view.url.endsWith(".mp3"));

		const audio = await fetch(base + view.url);
		assert.ok(audio.ok);
		assert.match(audio.headers.get("Content-Type"), /audio\/mpeg/);
		assert.ok((await audio.arrayBuffer()).byteLength > 1000);

		/* the page and the health route exist */
		const page = await (await fetch(base + "/")).text();
		assert.match(page, /<textarea[\s\S]*id="script"[\s\S]*maxlength="20000"/);
		assert.match(page, /value="male"/);
		assert.match(page, /value="female"/);
		const health = await (await fetch(base + "/api/health")).json();
		assert.deepEqual(health.voices.map((voice) => voice.id), ["male", "female"]);

	}
	finally {

		await new Promise((resolve) => server.close(resolve));
		rmSync(dir, { recursive: true, force: true });
		delete process.env.TTS_OUTPUT_DIR;
		delete process.env.TTS_PROVIDER;

	}

});

test("the app drives a free no-login site and never asks for an account", () => {
	const { PROVIDERS, listProviders } = engine;

	const ids = listProviders().map((provider) => provider.id);

	assert.ok(ids.includes("ttsmp3"), "a free online TTS host is configured");
	assert.ok(ids.includes("text-to-speech"), "a second free host is configured as a fallback");

	for (const id of ["ttsmp3", "text-to-speech"]) {
		const provider = PROVIDERS[id];
		assert.match(provider.url, /^https:\/\//);
		assert.ok(provider.textarea.length, "the script box is found by selector");
		assert.ok(provider.voiceSelect.length, "the voice is read from the host's own list");
		assert.ok(provider.submit.length, "the convert button is located");
		/* no login: nothing to authenticate against */
		for (const key of ["username", "password", "token", "apiKey", "login"]) {
			assert.ok(!(key in provider), id + " must not carry a " + key);
		}
	}

	/* exactly one voice per gender, picked from the host's option labels */
	assert.equal(engine.VOICES.male.pick.source.includes("|"), true);
	assert.ok(engine.VOICES.male.pick.test("English (male)"));
	assert.ok(engine.VOICES.female.pick.test("English (female)"));
	assert.ok(!engine.VOICES.male.pick.test("German (female)"));
});

test("playwright is a declared dependency and the page keeps the 20k cap", () => {
	const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));

	assert.equal(pkg.type, "module");
	assert.ok(pkg.dependencies.playwright, "Playwright drives the free TTS site");
	assert.equal(pkg.scripts.start, "node server.mjs");
	assert.match(pkg.scripts.check, /selftest/);

	/* the app.js client enforces the same limit as the server */
	const client = readFileSync(new URL("public/app.js", ROOT), "utf8");
	assert.match(client, /MAX_CHARS = 20000/);
	assert.match(client, /apiKey: "1290890909&aPiky2026"/);
	assert.match(client, /input\[name='voice'\]:checked/);
	assert.ok(!client.includes("localStorage"), "the helper stores nothing in the browser");
});
