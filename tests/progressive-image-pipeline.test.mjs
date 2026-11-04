import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { PROGRESSIVE_IMAGE_PIPELINE_JS } from "../src/client/progressive-image-pipeline.ts";
import { handleGenerateImagePrompts, IMAGE_PROMPT_ATTEMPTS, IMAGE_PROMPT_FALLBACK_MODELS,
	IMAGE_PROMPT_MAX_CHARS, countScriptWords, sceneCountForScript } from "../src/modules/image-prompts.ts";

function pipeline() {
	const context = vm.createContext({ setTimeout: (fn) => queueMicrotask(fn) });
	vm.runInContext(PROGRESSIVE_IMAGE_PIPELINE_JS, context);
	return context.runProgressiveImagePipeline;
}
test("the browser's scene target matches the Worker's fixed 12-scene rule exactly", () => {
	const context = vm.createContext({});
	vm.runInContext(PROGRESSIVE_IMAGE_PIPELINE_JS, context);
	const script = (words) => Array.from({ length: words }, (_, i) => "word" + i).join(" ") + ".";
	for (const words of [0, 1, 40, 129, 130, 131, 200, 239, 240, 241, 400, 500, 501, 900]) {
		const text = script(words);
		assert.equal(context.imageScriptWordCount(text), countScriptWords(text), "word count parity for " + words);
		assert.equal(context.imageSceneTarget(text, 1), sceneCountForScript(text), "1-minute parity for " + words);
		assert.equal(context.imageSceneTarget(text, 3), sceneCountForScript(text), "3-minute parity for " + words);
		assert.equal(context.imageSceneTarget(text, 6), sceneCountForScript(text), "6-minute parity for " + words);
	}
	/* FINAL MEDIA CAP: no word-count brackets; every length plans 12 scenes. */
	for (const [words, scenes] of [[130, 12], [131, 12], [240, 12], [241, 12], [500, 12], [501, 12]]) {
		assert.equal(context.imageSceneTarget(script(words), 1), scenes, words + " words -> " + scenes + " scenes");
	}
	/* An empty script still plans the fixed 12, and SRT cue numbers/timestamps never count. */
	assert.equal(context.imageSceneTarget("", 1), 12);
	assert.equal(context.imageScriptWordCount("1\n00:00:01,000 --> 00:00:03,000\nHello there friend\n\n2\n00:00:04,000 --> 00:00:06,000\nGood bye"), 5);
});

function deferred() {
	let resolve;
	const promise = new Promise((r) => { resolve = r; });
	return { promise, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const scenes = (batch) => Array.from({ length: batch.count }, (_, i) => `Scene ${batch.offset + i}`);

for (const total of [12]) {
	test(`browser pipeline covers ${total} scenes in chunks of at most three`, async () => {
		const requests = [], rendered = [];
		const result = await pipeline()({ total, isCancelled: () => false,
			request: async (batch) => { requests.push(batch); return scenes(batch); },
			render: async (batch, offset) => { rendered.push({ batch, offset }); }
		});
		assert.equal(result.length, total);
		assert.equal(requests.length, Math.ceil(total / 3));
		assert.deepEqual(rendered.map((r) => r.offset), requests.map((b) => b.offset));
		assert.ok(requests.every((b) => b.count <= 3 && b.previous.length <= 4));
	});
}

test("first three images start before remaining prompts resolve; only one lookahead is buffered", async () => {
	const heldRender = deferred(), heldPrompts = deferred();
	const requests = [], renders = [];
	const run = pipeline()({ total: 10, isCancelled: () => false,
		request: async (b) => {
			requests.push(b.offset);
			if (b.offset === 3) await heldPrompts.promise;
			return scenes(b);
		},
		render: async (p, offset) => { renders.push(offset); if (offset === 0) await heldRender.promise; }
	});
	await tick();
	assert.deepEqual(requests, [0, 3]);
	assert.deepEqual(renders, [0]);
	heldPrompts.resolve();
	await tick();
	assert.deepEqual(requests, [0, 3], "cannot run ahead while current render is blocked");
	heldRender.resolve();
	await run;
	assert.deepEqual(renders, [0, 3, 6, 9]);
});

/*
 * SESSION 279: a failed batch is a VERDICT, not a browser retry. The ladder
 * lives in handleGenerateImagePrompts, so the pipeline asks once per offset and
 * still drains (never re-renders) the chunk it already started.
 */
test("short answers advance by accepted count and a failed batch is one verdict", async () => {
	const requests = [], renders = [];
	let failed = false;
	const run = pipeline()({ total: 7, isCancelled: () => false,
		request: async (b) => {
			requests.push([b.offset, b.attempt]);
			if (b.offset === 2 && !failed) { failed = true; throw new Error("AiError 3043: Internal server error"); }
			return scenes(b).slice(0, 2);
		}, render: async (p, offset) => { renders.push(offset); }
	});
	await assert.rejects(run, /3043/);
	assert.deepEqual(requests, [[0, 0], [2, 0]], "one request per batch, always attempt 0");
	assert.deepEqual(renders, [0], "the delivered chunk is rendered, the failed one is not paid for twice");
});

test("late prompt failure drains delivered images before rejecting and never replays a paid batch", async () => {
	const drain = deferred();
	let rendered = false, finished = false;
	const requests = [];
	const run = pipeline()({ total: 10, isCancelled: () => false,
		request: async (b) => { requests.push(b.offset); if (b.offset) throw new Error("model down"); return scenes(b); },
		render: async () => { rendered = true; await drain.promise; finished = true; }
	});
	const rejection = assert.rejects(run, /model down/);
	await tick();
	assert.equal(rendered, true);
	assert.equal(finished, false);
	assert.deepEqual(requests, [0, 3], "the failed offset is asked once: the worker owns the ladder");
	drain.resolve();
	await rejection;
	assert.equal(finished, true);
});

test("permanent HTTP failures are not retried", async () => {
	let count = 0;
	await assert.rejects(pipeline()({ total: 10, isCancelled: () => false,
		request: async () => { count++; throw Object.assign(new Error("invalid style"), { retryable: false }); },
		render: async () => assert.fail("must not render")
	}), /invalid style/);
	assert.equal(count, 1);
});

/*
 * Session 279: there is no prompt retry left in the browser to cancel, so
 * "Stop" is pinned where it actually lands - before a pass (nothing is asked
 * at all), during a request (the request's own abort surfaces), and on an
 * answer that arrives after Stop (the cancellation check cuts it short before
 * anything is rendered or billed).
 */
test("Stop cancels a prompt pass and prevents later renders", async () => {
	let count = 0;
	await assert.rejects(pipeline()({ total: 10, isCancelled: () => true,
		request: async (batch) => { count++; return scenes(batch); },
		render: async () => assert.fail("must not render")
	}), { name: "AbortError" });
	assert.equal(count, 0, "a cancelled flow never asks for prompts");

	let stopped = false, requests = 0, renders = 0;
	await assert.rejects(pipeline()({ total: 10, isCancelled: () => stopped,
		request: async () => {
			requests++; stopped = true;
			throw Object.assign(new Error("aborted"), { name: "AbortError" });
		},
		render: async () => { renders++; }
	}), { name: "AbortError" });
	assert.equal(requests, 1, "the pass in flight is not repeated");
	assert.equal(renders, 0, "no chunk renders after Stop");

	stopped = false; requests = 0; renders = 0;
	await assert.rejects(pipeline()({ total: 10, isCancelled: () => stopped,
		request: async (batch) => { requests++; stopped = true; return scenes(batch); },
		render: async () => { renders++; }
	}), { name: "AbortError" });
	assert.equal(requests, 1);
	assert.equal(renders, 0, "an answer that lands after Stop is dropped, not rendered");
});

/*
 * The one continuation the page still owns: a LOAD verdict on the whole
 * request, which the worker's ladder cannot retry because it already ran
 * inside the request that was refused.
 */
const loadError = (message) => Object.assign(new Error(message),
	{ status: 503, kind: "overload", retryAfterMs: 400 });

test("#263 a load verdict on a prompt chunk waits the hint and continues exactly once", async () => {
	const stamps = [];
	let renders = 0;
	const result = await pipeline()({ total: 6, isCancelled: () => false,
		request: async (batch) => {
			stamps.push(batch.offset);
			if (batch.offset === 3 && stamps.length === 2) throw loadError("capacity exceeded");
			return scenes(batch);
		},
		render: async () => { renders++; }
	});
	assert.equal(result.length, 6, "the video still gets every scene");
	assert.deepEqual(stamps, [0, 3, 3], "the refused chunk is asked once more, and only once");
	assert.equal(renders, 2, "both chunks are rendered");
});

test("#263 a second load verdict on the same chunk is a verdict, not an open retry", async () => {
	const stamps = [];
	await assert.rejects(pipeline()({ total: 6, isCancelled: () => false,
		request: async (batch) => { stamps.push(batch.offset); if (batch.offset === 3) throw loadError("capacity exceeded"); return scenes(batch); },
		render: async () => {}
	}), /capacity exceeded/);
	assert.deepEqual(stamps, [0, 3, 3], "bounded: one continuation per chunk");
});

test("#263 Stop during the load wait ends the flow instead of asking again", async () => {
	let stopped = false;
	const stamps = [];
	await assert.rejects(pipeline()({ total: 6, isCancelled: () => stopped,
		request: async (batch) => {
			stamps.push(batch.offset);
			if (batch.offset === 3) { stopped = true; throw loadError("capacity exceeded"); }
			return scenes(batch);
		},
		/* Chunk 0 is already rendering when the verdict lands; what must not
		 * happen is a SECOND request for the refused chunk. */
		render: async () => {}
	}), { name: "AbortError" });
	assert.deepEqual(stamps, [0, 3], "the wait is cancellable: no second request after Stop");
});

test("#263 a non-load failure is never continued (the worker owns that ladder)", async () => {
	const stamps = [];
	await assert.rejects(pipeline()({ total: 6, isCancelled: () => false,
		request: async (batch) => {
			stamps.push(batch.offset);
			if (batch.offset === 3) throw Object.assign(new Error("Script output invalid"), { status: 502, retryable: false });
			return scenes(batch);
		},
		render: async () => {}
	}), /Script output invalid/);
	assert.deepEqual(stamps, [0, 3], "a permanent verdict ends the flow at once");
});

test("render failure aborts lookahead without retrying it", async () => {
	let count = 0, abort;
	const pending = new Promise((_, reject) => { abort = () => reject(new Error("abort")); });
	await assert.rejects(pipeline()({ total: 10, isCancelled: () => false,
		request: async (b) => { count++; return b.offset ? pending : scenes(b); },
		render: async () => { throw new Error("credits exhausted"); },
		cancelPrompts: abort
	}), /credits exhausted/);
	assert.equal(count, 2);
});

test("repeated prompts cannot loop forever or consume image credits again", async () => {
	let renders = 0;
	await assert.rejects(pipeline()({ total: 10, isCancelled: () => false,
		request: async () => ["same scene", "same scene"], render: async () => { renders++; }
	}), /no new scene prompts/);
	assert.equal(renders, 1);
});

function req(batch, extra = {}) {
	return new Request("https://studio.test/api/image-prompts", { method: "POST",
		body: JSON.stringify({ topic: "forest", minutes: 1, style: "Documentary", batch, ...extra }) });
}

test("Worker batch is stateless, plans three of the fixed 12 stock scenes and preserves the frame guard", async () => {
	const calls = [];
	const env = { AI: { run: async (model, input) => {
		calls.push({ model, input });
		const slots = JSON.parse(input.prompt.match(/Requested slots of \d+ total: ([^\n]+)/)[1]);
		return { response: { scenes: slots.map((slot) => ({ type: slot.type, keywords: "forest stream " + slot.scene })) } };
	} } };
	const response = await handleGenerateImagePrompts(req({ offset: 3, count: 3, previous: ["opening forest view"] },
		{ resolution: 720, orientation: "portrait" }), env, "primary");
	const data = await response.json();
	assert.equal(response.status, 200);
	assert.equal(calls.length, 1, "one stateless planner call for the requested chunk");
	assert.equal(data.count, 3);
	assert.equal(data.expectedCount, 12);
	assert.deepEqual(data.batch, { offset: 3, requested: 3, nextOffset: 6 });
	assert.match(calls[0].input.prompt, /Requested slots of 12 total/);
	assert.match(calls[0].input.prompt, /opening forest view/);
	assert.equal(calls[0].input.max_tokens, 2048);
	assert.ok(data.prompts.every((p) => p.startsWith("pixabay:") && p.length <= IMAGE_PROMPT_MAX_CHARS));
});

/*
 * The old contract was "the worker answers once, the browser asks again with
 * attempt: 1 and gets an allowlisted fallback model". Session 279 moved the
 * ladder inside the request: the coaching, the temperature shift and the
 * governor accounting all happen where the failed reply is still in scope, and
 * the verdict names its owner so a page cannot start a second ladder.
 */
test("#279 a transient planner failure is retried inside the same request", async () => {
	const calls = [];
	const env = { AI: { run: async (model, input) => {
		calls.push({ model, input });
		if (calls.length === 1) throw new Error("AiError 3043: Internal server error");
		/* The current planner contract: answer the requested slots. */
		const slots = JSON.parse(input.prompt.match(/Requested slots of \d+ total: ([^\n]+)/)[1]);
		return { response: { scenes: slots.map((slot) => ({ type: slot.type, keywords: "forest stream " + slot.scene })) } };
	} } };
	const response = await handleGenerateImagePrompts(
		req({ offset: 0, count: 3 }, { script: "A forest stream opens the video. Mist settles over the hillside trees while the town below wakes up slowly." }),
		env, "primary");
	assert.equal(response.status, 200);
	assert.equal(calls.length, 2, "the second planner call happened without a second round trip");
	assert.deepEqual(calls.map((entry) => entry.model), ["primary", "primary"],
		"IMAGE_PROMPT_FALLBACK_MODELS is empty, so a retry is coaching, not a model swap: " +
		JSON.stringify(IMAGE_PROMPT_FALLBACK_MODELS));
	assert.match(calls[1].input.prompt, /3043|previous|again/i, "the retry carries the failure it is correcting");
	const data = await response.json();
	assert.equal(data.retryOwner, "worker");
	assert.equal(data.attempts, 2);
	assert.equal(data.count, 3, "the retried call answered the whole batch");
	assert.equal(data.prompts.length, 3);
	assert.ok(data.prompts.every((prompt) => prompt.startsWith("pixabay:")), "planner slots become search tokens");
});

test("#279 an exhausted prompt ladder is one bounded verdict, not an open retry", async () => {
	const calls = [];
	const env = { AI: { run: async () => {
		calls.push(Date.now());
		throw new Error("AiError 3043: Internal server error");
	} } };
	const response = await handleGenerateImagePrompts(req({ offset: 0, count: 3 }), env, "primary");
	assert.equal(response.status, 502);
	assert.equal(calls.length, IMAGE_PROMPT_ATTEMPTS, "the ladder stops at its attempt ceiling");
	const data = await response.json();
	assert.equal(data.success, false);
	assert.equal(data.code, "IMAGE_PROMPT_MODEL_FAILED");
	assert.equal(data.retryOwner, "worker");
	assert.equal(data.attempts, IMAGE_PROMPT_ATTEMPTS);
	assert.equal(data.budgetExhausted, false, "the attempts ran out before the budget did");
	assert.deepEqual(data.prompts, []);
});

test("#279 a cancellation is never retried by the worker ladder", async () => {
	const calls = [];
	const env = { AI: { run: async () => {
		calls.push(1);
		throw new Error("signal is aborted without reason");
	} } };
	const response = await handleGenerateImagePrompts(req({ offset: 0, count: 3 }), env, "primary");
	assert.equal(calls.length, 1, "an aborted request is a stop, not a transient failure");
	assert.equal(response.status, 502);
	assert.match((await response.json()).error, /interrupted/i);
});

test("Worker rejects malformed or unbounded batch inputs before any inference", async () => {
	const env = { AI: { run: async () => assert.fail("must not call AI") } };
	for (const batch of [null, [], {}, { count: 4, offset: 0 }, { count: 0, offset: 0 },
		{ count: 3, offset: 10 }, { count: 1, offset: -1 }, { count: 1, offset: 12 },
		{ count: 3, offset: 0, attempt: 3 }, { count: "3", offset: 0 }]) {
		assert.equal((await handleGenerateImagePrompts(req(batch), env, "primary")).status, 400);
	}
});
