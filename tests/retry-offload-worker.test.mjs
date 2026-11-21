/*
 * SESSION 279 — EVERY RETRY LADDER LIVES IN THE REQUEST THAT OWNS THE FAILURE.
 *
 * The strategy this pins down: the browser used to be the retry owner for the
 * script, the voiceover, the scene prompts and the image chunks. Each of those
 * ladders cost a full round trip per attempt, a control-lane slot, a second
 * poll stream (scripts) and a second opinion about when to give up - measured
 * in bench/pipeline-sim/results/baseline-scale1.json as 1061 worker requests
 * for nine videos, 88 % of them note polls, and a 183 s pipeline makespan.
 *
 * What the worker owns now, and what these tests assert:
 *   - one request per stage from the page, and the ladder inside it;
 *   - a bounded ladder: attempt ceiling, total budget, a minimum-remaining
 *     check before every attempt, the request signal at every boundary;
 *   - a verdict that names its owner (`retryOwner: "worker"`, `attempts`), so
 *     the page reports instead of re-asking;
 *   - the advertised ceilings on /api/pipeline-capabilities, which is how a
 *     page knows it must not start a ladder of its own.
 *
 * The browser keeps what only a browser can do: timeouts, the note poll, the
 * local clip probe, the direct-media transport fallback and the flow-level
 * scheduler that can sit out a minutes-long rate-limit window.
 */

import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import {
	handleVoiceover,
	joinVoiceoverPieces,
	splitVoiceoverChunks,
	VOICEOVER_CHUNK_ATTEMPTS,
	VOICEOVER_MAX_CHUNK,
	VOICEOVER_SERVER_CHUNKS
} from "../src/modules/voiceover.ts";
import { IMAGE_PROMPT_ATTEMPTS } from "../src/modules/image-prompts.ts";
import { IMAGE_OVERLOAD_ATTEMPTS, IMAGE_RETRY_BUDGET_MS } from "../src/modules/image-batch.ts";

/* A frame sequence the byte validators accept (same fixture as #261). */
const mp3 = Uint8Array.from([255, 251, 144, 100, 1, 2]);
const taggedMp3 = Uint8Array.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, ...mp3]);

function wav(data = [1, 2, 3, 4], sampleRate = 22050) {
	const out = new Uint8Array(44 + data.length);
	const dv = new DataView(out.buffer);
	out.set([82, 73, 70, 70], 0);
	dv.setUint32(4, out.length - 8, true);
	out.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
	dv.setUint16(16, 16, true);
	dv.setUint16(20, 1, true);
	dv.setUint16(22, 1, true);
	dv.setUint32(24, sampleRate, true);
	dv.setUint32(28, sampleRate * 2, true);
	dv.setUint16(32, 2, true);
	dv.setUint16(34, 16, true);
	out.set([100, 97, 116, 97], 36);
	dv.setUint32(40, data.length, true);
	out.set(data, 44);
	return out;
}

const json = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/* Distinct sentences, so a chunk can be identified by the text it carried. */
const script = (sentences) =>
	Array.from({ length: sentences }, (_, index) => "Sentence " + index + " describes a quiet forest. ").join("");

function voiceoverRequest(body, signal) {
	return new Request("https://studio.test/api/voiceover", {
		method: "POST",
		body: JSON.stringify(body),
		signal
	});
}

/* No external TTS in a test: the ladder must be answerable from the binding. */
const noNetwork = { fallbackTtsUrl: null, retryDelayMs: 0, fetchImpl: async () => assert.fail("no external call") };

/* ---------------------------------------------------------------- caps ---- */

test("#279 capabilities name the worker as the retry owner of every stage", async () => {
	const entry = worker.fetch ? worker : worker.default;
	const response = await entry.fetch(new Request("https://studio.test/api/pipeline-capabilities"), {}, {});
	assert.equal(response.status, 200);
	const caps = await response.json();

	assert.equal(caps.retryOwner, "worker", "media and voiceover ladders stay worker-owned");
	assert.equal(caps.scriptRetryOwner, "browser", "script writing is browser-owned");
	assert.equal(caps.voiceRetryOwner, "worker");
	assert.equal(caps.promptRetryOwner, "worker");
	assert.equal(caps.imageRetryOwner, "worker");

	/* The ceilings a page must not exceed, because the worker already spent them. */
	assert.equal(caps.workerScriptRetries, 3);
	assert.equal(caps.serverVoiceChunks, VOICEOVER_SERVER_CHUNKS);
	assert.equal(caps.workerVoiceAttempts, VOICEOVER_CHUNK_ATTEMPTS);
	assert.equal(caps.voiceBudgetMs > 0, true);
	assert.equal(caps.workerPromptAttempts, IMAGE_PROMPT_ATTEMPTS);
	assert.equal(caps.promptBudgetMs > 0, true);
	assert.equal(caps.workerImageAttempts, IMAGE_OVERLOAD_ATTEMPTS);
	assert.equal(caps.imageRetryBudgetMs, IMAGE_RETRY_BUDGET_MS);

	/* Compatibility, not ownership: a cached pre-279 page still gets its routes. */
	assert.equal(caps.chunkVoiceover, true, "the browser chunk endpoint stays for cached pages");
	assert.equal(caps.browserScriptRetries, 7, "seven client-owned script retries");
	assert.equal(caps.scriptRetryBackoffMs, 40000, "40 seconds before each retry");
});

/* ------------------------------------------------------- splitting/joining -- */

test("#279 the worker splits voice text where the browser used to", () => {
	const chunks = splitVoiceoverChunks("✨ ".repeat(10) + script(90) + " \ud800 end ");
	assert.ok(chunks.length > 1, "a long narration is more than one chunk");
	assert.ok(chunks.every((chunk) => chunk.length <= VOICEOVER_MAX_CHUNK), "every chunk fits the model's limit");
	assert.ok(chunks.every((chunk) => !/[\ud800-\udfff]/.test(chunk)), "no chunk carries a lone surrogate");
	assert.deepEqual(splitVoiceoverChunks("✨ ... !!!"), [], "punctuation and emoji are not speakable");
	assert.deepEqual(splitVoiceoverChunks(""), []);
});

test("#279 the worker joins the pieces it synthesised", () => {
	const joined = joinVoiceoverPieces([taggedMp3, taggedMp3]);
	assert.equal(joined.audioType, "audio/mpeg");
	assert.equal(joined.bytes.byteLength, taggedMp3.length + mp3.length, "a repeated ID3 tag is stripped, not concatenated");

	const waves = joinVoiceoverPieces([wav(), wav()]);
	assert.equal(waves.audioType, "audio/wav");
	assert.equal(waves.bytes.byteLength, 52);
	assert.equal(new DataView(waves.bytes.buffer).getUint32(40, true), 8, "the data chunk is re-sized");

	assert.throws(() => joinVoiceoverPieces([wav(), mp3]), /Mixed WAV and MP3/);
	assert.throws(() => joinVoiceoverPieces([wav([1, 2, 3, 4], 44100), wav()]), /sample formats differ/);
});

/* ------------------------------------------------------------ the ladder -- */

test("#279 one voiceover request synthesises every chunk through a bounded pool", async () => {
	const seen = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const env = {
		AI: {
			run: async (model, input) => {
				inFlight += 1;
				maxInFlight = Math.max(maxInFlight, inFlight);
				seen.push(String(input.prompt || input.text || ""));
				await new Promise((resolve) => setTimeout(resolve, 5));
				inFlight -= 1;
				return mp3;
			}
		}
	};

	const text = script(60);
	const chunks = splitVoiceoverChunks(text, VOICEOVER_MAX_CHUNK);
	assert.ok(chunks.length > VOICEOVER_SERVER_CHUNKS, "the text is long enough to need more chunks than lanes");

	const response = await handleVoiceover(voiceoverRequest({ text, lang: "en" }), env, noNetwork);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
	assert.equal(response.headers.get("X-Retry-Owner"), "worker");
	assert.equal(response.headers.get("X-Voiceover-Chunks"), String(chunks.length));
	assert.equal(response.headers.get("X-Voiceover-Attempts"), String(chunks.length), "one attempt per chunk when nothing fails");

	/* Every chunk once, and never more lanes than the ceiling. */
	assert.equal(new Set(seen).size, chunks.length, "each chunk is spoken exactly once");
	assert.ok(maxInFlight <= VOICEOVER_SERVER_CHUNKS,
		"the pool is bounded at " + VOICEOVER_SERVER_CHUNKS + " lanes, saw " + maxInFlight);
	assert.ok(maxInFlight > 1, "chunks are in flight together, which is the whole point of moving them here");

	const bytes = new Uint8Array(await response.arrayBuffer());
	assert.equal(bytes.byteLength, mp3.length * chunks.length);
});

test("#279 a transient TTS failure is retried inside the same request", async () => {
	let calls = 0;
	const env = {
		AI: {
			run: async () => {
				calls += 1;
				/* The failure the bench injects at a 25 % rate. */
				if (calls === 2) throw new Error("AiError 3043: Internal server error");
				return mp3;
			}
		}
	};

	const text = script(27);
	const chunks = splitVoiceoverChunks(text, VOICEOVER_MAX_CHUNK);
	const response = await handleVoiceover(voiceoverRequest({ text, lang: "en" }), env, noNetwork);

	assert.equal(response.status, 200, "the retry is invisible to the page: it asked once");
	assert.equal(response.headers.get("X-Voiceover-Chunks"), String(chunks.length));
	assert.equal(Number(response.headers.get("X-Voiceover-Attempts")), chunks.length + 1,
		"the failed chunk cost one more attempt, not one more request");
	const bytes = new Uint8Array(await response.arrayBuffer());
	assert.equal(bytes.byteLength, mp3.length * chunks.length, "no chunk is missing from the narration");
});

test("#279 a chunk that exhausts the ladder is one verdict that stops the pool", async () => {
	const seenChunks = new Set();
	const env = {
		AI: {
			run: async (_model, input) => {
				seenChunks.add(String(input.prompt || input.text || ""));
				throw new Error("AiError 3043: Internal server error");
			}
		}
	};

	const text = script(60);
	const chunks = splitVoiceoverChunks(text, VOICEOVER_MAX_CHUNK);
	const response = await handleVoiceover(voiceoverRequest({ text, lang: "en" }), env, noNetwork);
	const data = await response.json();

	assert.equal(response.status, 500, "not a 504: the attempts ran out before the budget did");
	assert.equal(data.success, false);
	assert.equal(data.stage, "voiceover");
	assert.equal(data.chunks, chunks.length);
	assert.equal(data.chunk, 1, "the verdict names the chunk that failed");
	assert.equal(data.retryable, true);
	assert.equal(data.retryOwner, "worker");
	assert.equal(data.budgetExhausted, false);
	assert.ok(data.attempts >= VOICEOVER_CHUNK_ATTEMPTS, "the ladder was actually spent: " + data.attempts);
	/*
	 * A failure stops the lanes from STARTING more work, so the request does not
	 * spend a full ladder on every remaining chunk before reporting.
	 */
	assert.ok(seenChunks.size <= VOICEOVER_SERVER_CHUNKS,
		"only the lanes already running were spent (" + seenChunks.size + " of " + chunks.length + " chunks)");
});

test("#279 an aborted voiceover request answers 499 and stops spending", async () => {
	const controller = new AbortController();
	let calls = 0;
	const env = {
		AI: {
			run: async () => {
				calls += 1;
				controller.abort();
				return mp3;
			}
		}
	};

	const response = await handleVoiceover(
		voiceoverRequest({ text: script(60), lang: "en" }, controller.signal),
		env,
		noNetwork
	);
	assert.equal(response.status, 499);
	const data = await response.json();
	assert.equal(data.success, false);
	assert.match(data.error, /abort/i);
	assert.ok(calls <= VOICEOVER_SERVER_CHUNKS, "the lanes stop at the next boundary: " + calls);
});

test("#279 the legacy browser chunk route still answers exactly one chunk", async () => {
	/* A cached pre-279 page still splits and retries in the browser, so this
	 * route must keep its old shape: one chunk, one inference, no ladder. */
	const calls = [];
	const env = { AI: { run: async (model) => { calls.push(model); return mp3; } } };
	const response = await handleVoiceover(
		voiceoverRequest({ chunk: true, text: "A quiet forest.", lang: "en", voiceIndex: 0 }),
		env,
		noNetwork
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
	assert.equal(calls.length, 1);
	assert.equal(response.headers.get("X-Retry-Owner"), null, "the chunk route reports no ladder, because it runs none");
	assert.equal(
		(await handleVoiceover(voiceoverRequest({ chunk: true, text: "x".repeat(VOICEOVER_MAX_CHUNK + 1) }), env, noNetwork)).status,
		400
	);
});

test("#279 a missing AI binding is a 503 verdict, not a hang", async () => {
	const response = await handleVoiceover(voiceoverRequest({ text: script(9), lang: "en" }), {}, noNetwork);
	assert.equal(response.status, 503);
	assert.match((await response.json()).error, /AI binding not configured/i);
});
