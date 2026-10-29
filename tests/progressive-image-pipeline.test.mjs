import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { PROGRESSIVE_IMAGE_PIPELINE_JS } from "../src/client/progressive-image-pipeline.ts";
import { handleGenerateImagePrompts, IMAGE_PROMPT_FALLBACK_MODELS, IMAGE_PROMPT_MAX_CHARS,
	countScriptWords, sceneCountForScript } from "../src/modules/image-prompts.ts";

function pipeline() {
	const context = vm.createContext({ setTimeout: (fn) => queueMicrotask(fn) });
	vm.runInContext(PROGRESSIVE_IMAGE_PIPELINE_JS, context);
	return context.runProgressiveImagePipeline;
}
test("#275 the browser's scene target matches the Worker's word-count rule exactly", () => {
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
	/* The documented brackets: <=130 -> 6, <=240 -> 8, <=500 -> 10, longer -> 10. */
	for (const [words, scenes] of [[130, 6], [131, 8], [240, 8], [241, 10], [500, 10], [501, 10]]) {
		assert.equal(context.imageSceneTarget(script(words), 1), scenes, words + " words -> " + scenes + " scenes");
	}
	/* An empty script still plans the smallest bracket, and SRT cue numbers/timestamps never count. */
	assert.equal(context.imageSceneTarget("", 1), 6);
	assert.equal(context.imageScriptWordCount("1\n00:00:01,000 --> 00:00:03,000\nHello there friend\n\n2\n00:00:04,000 --> 00:00:06,000\nGood bye"), 5);
});

function deferred() {
	let resolve;
	const promise = new Promise((r) => { resolve = r; });
	return { promise, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const scenes = (batch) => Array.from({ length: batch.count }, (_, i) => `Scene ${batch.offset + i}`);

for (const total of [10, 14, 20]) {
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

test("short answers advance by accepted count, retries keep offset and don't rerender images", async () => {
	const requests = [], renders = [];
	let failed = false;
	const result = await pipeline()({ total: 7, isCancelled: () => false,
		request: async (b) => {
			requests.push([b.offset, b.attempt]);
			if (b.offset === 2 && !failed) { failed = true; throw new Error("signal is aborted without reason"); }
			return scenes(b).slice(0, 2);
		}, render: async (p, offset) => { renders.push(offset); }
	});
	assert.equal(result.length, 7);
	assert.deepEqual(requests, [[0, 0], [2, 0], [2, 1], [4, 0], [6, 0]]);
	assert.deepEqual(renders, [0, 2, 4, 6]);
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
	assert.deepEqual(requests, [0, 3, 3, 3]);
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

test("Stop cancels prompt retry and prevents later renders", async () => {
	let stopped = false, count = 0;
	await assert.rejects(pipeline()({ total: 10, isCancelled: () => stopped,
		request: async () => { count++; stopped = true; throw new Error("aborted"); },
		render: async () => assert.fail("must not render")
	}), { name: "AbortError" });
	assert.equal(count, 1);
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

test("Worker batch is stateless, calls AI once, includes scene range and preserves style/frame guard", async () => {
	const calls = [];
	const env = { AI: { run: async (model, input) => {
		calls.push({ model, input });
		return { response: { prompts: ["A forest stream in morning light", "A hillside tree in mist"] } };
	} } };
	const response = await handleGenerateImagePrompts(req({ offset: 3, count: 3, previous: ["opening forest view"] },
		{ resolution: 720, orientation: "portrait" }), env, "primary");
	const data = await response.json();
	assert.equal(response.status, 200);
	assert.equal(calls.length, 1, "no server top-up even when response is short");
	assert.equal(data.count, 2);
	assert.equal(data.expectedCount, 10);
	assert.deepEqual(data.batch, { offset: 3, requested: 3, nextOffset: 5 });
	assert.match(calls[0].input.prompt, /scenes 4 through 6 of 10/);
	assert.match(calls[0].input.prompt, /opening forest view/);
	assert.match(calls[0].input.prompt, /PORTRAIT/);
	assert.equal(calls[0].input.max_tokens, 1800);
	assert.ok(data.prompts.every((p) => p.length <= IMAGE_PROMPT_MAX_CHARS && p.includes("Visual style: Documentary")));
});

test("Worker failures don't run nested retries; browser retry selects an allowlisted fallback", async () => {
	const calls = [];
	const env = { AI: { run: async (model) => {
		calls.push(model);
		if (model === "primary") throw new Error("signal is aborted without reason");
		return { response: { prompts: ["A forest scene"] } };
	} } };
	const first = await handleGenerateImagePrompts(req({ offset: 0, count: 3 }), env, "primary");
	assert.equal(first.status, 502);
	assert.deepEqual(calls, ["primary"]);
	assert.doesNotMatch((await first.json()).error, /signal|abort/i);
	const retry = await handleGenerateImagePrompts(req({ offset: 0, count: 3, attempt: 1 }), env, "primary");
	assert.equal(retry.status, 200);
	assert.deepEqual(calls, ["primary", IMAGE_PROMPT_FALLBACK_MODELS[0]]);
});

test("Worker rejects malformed or unbounded batch inputs before any inference", async () => {
	const env = { AI: { run: async () => assert.fail("must not call AI") } };
	for (const batch of [null, [], {}, { count: 4, offset: 0 }, { count: 0, offset: 0 },
		{ count: 3, offset: 9 }, { count: 1, offset: -1 }, { count: 1, offset: 10 },
		{ count: 3, offset: 0, attempt: 3 }, { count: "3", offset: 0 }]) {
		assert.equal((await handleGenerateImagePrompts(req(batch), env, "primary")).status, 400);
	}
});
