import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
import { APP_CSS } from "../src/client/styles.ts";
import { handleSeoPlanGeneration, handleSeoScriptGeneration } from "../src/modules/script-seo.ts";
import e2eWorker from "../e2e/index.ts";
import {
	imagePromptCountForMinutes,
	IMAGE_STYLES,
	IMAGE_STYLE_GUIDANCE,
	DEFAULT_IMAGE_STYLE,
	buildImagePromptInstruction,
	parseImagePrompts,
	summarizeScriptIdea,
	handleGenerateImagePrompts,
	handleRemovedImagePromptJobRoute
} from "../src/modules/image-prompts.ts";
import {
	handleImageBatch,
	IMAGE_BATCH_MAX_PROMPTS,
	IMAGE_WIDTH,
	IMAGE_HEIGHT
} from "../src/modules/image-batch.ts";

const setA = {
	title: "Yoga for a Calmer Morning",
	headings: ["Start with Yoga", "Find Your Balance"],
	longTail: "morning yoga poses for beginners in a small home studio",
	short: ["yoga", "breathing", "stretching", "balance"]
};
const setB = {
	title: "Morning Yoga Balance Guide",
	headings: ["Morning Yoga for Stiff Beginners", "Build a Home Practice"],
	longTail: "gentle morning yoga routine for stiff beginners at home",
	short: ["morning yoga", "gentle stretch", "home practice", "yoga routine"]
};
const sentences = [
	`Try ${setA.longTail} today.`,
	"Let breathing settle into a steady rhythm.",
	"Gentle stretching can release tension.",
	"Practice balance with a chair nearby.",
	"Keep your breathing relaxed and natural.",
	"Comfortable stretching should never hurt.",
	"Your balance improves with patient practice.",
	`Return to ${setA.longTail} tomorrow.`
];
function makeSrt(lines = sentences) {
	return lines.map((line, index) => {
		const stamp = (seconds) => `00:00:${String(seconds).padStart(2, "0")},000`;
		return `${index + 1}\n${stamp(index * 4)} --> ${stamp((index + 1) * 4)}\n${line}`;
	}).join("\n\n");
}
function jsonRequest(url, body) {
	return new Request(url, { method: "POST", body: JSON.stringify(body) });
}

test("seo-plan returns two different validated keyword sets for the topic", async () => {
	const prompts = [];
	const env = {
		AI: {
			run: async (_model, input) => {
				prompts.push(input.prompt);
				return { response: JSON.stringify(input.prompt.includes("DIFFERENT") ? setB : setA) };
			}
		}
	};
	const response = await handleSeoPlanGeneration(
		jsonRequest("https://studio.test/api/seo-plan", { topic: "Morning yoga" }),
		env,
		"mock-instruct"
	);
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(data.success, true);
	assert.equal(data.sets.length, 2);
	assert.notDeepEqual(data.sets[0], data.sets[1]);
	assert.notEqual(data.sets[0].longTail, data.sets[1].longTail);
	assert.deepEqual(data.sets[0].short, setA.short);
	assert.deepEqual(data.sets[1].short, setB.short);
	assert.equal(prompts.length, 2);
	assert.match(prompts[1], /DIFFERENT keyword set/);
});

test("script generation with a selected keyword set skips the planner", async () => {
	const prompts = [];
	const env = {
		AI: {
			run: async (_model, input) => {
				prompts.push(input.prompt);
				return { response: makeSrt() };
			}
		}
	};
	const request = jsonRequest("https://studio.test/api/script", {
		topic: "Morning yoga",
		minutes: 1,
		speed: "medium",
		keywordSet: setA
	});
	const response = await handleSeoScriptGeneration(request, new URL(request.url), env, "mock-instruct");
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(data.success, true);
	// Only the writer ran: no planner prompt was sent.
	assert.equal(prompts.length, 1);
	assert.doesNotMatch(prompts[0], /SEO strategist/);
	assert.match(prompts[0], /morning yoga poses for beginners/);
});

test("script generation rejects an invalid selected keyword set before calling AI", async () => {
	let calls = 0;
	const env = { AI: { run: async () => { calls++; return { response: makeSrt() }; } } };
	const request = jsonRequest("https://studio.test/api/script", {
		topic: "Morning yoga",
		keywordSet: { ...setA, short: ["only one"] }
	});
	const response = await handleSeoScriptGeneration(request, new URL(request.url), env, "mock-instruct");
	assert.equal(response.status, 400);
	assert.equal(calls, 0);
});

test("image prompt counts, fixed style catalog, and compact general-idea instructions are consistent", () => {
	assert.equal(imagePromptCountForMinutes(1), 10);
	assert.equal(imagePromptCountForMinutes(2), 14);
	assert.equal(imagePromptCountForMinutes(3), 14);
	assert.equal(imagePromptCountForMinutes(4), 20);
	assert.equal(imagePromptCountForMinutes(5), 20);
	assert.deepEqual(IMAGE_STYLES, [
		"Cinematic Film", "Editorial Magazine", "Kinetic Typography", "Neon Night", "Minimalist",
		"Retro Poster", "Documentary", "Split Composition", "Dream Glow", "Pop Comic"
	]);
	assert.equal(DEFAULT_IMAGE_STYLE, "Cinematic Film");
	const script = "The first sentence introduces a home garden. The middle sentence contains implementation detail that is not needed by the image model. The final sentence shows the garden feeding a healthier neighborhood.";
	const idea = summarizeScriptIdea(script, "Home gardening");
	const instruction = buildImagePromptInstruction({ topic: "Home gardening", minutes: 3, style: "Kinetic Typography", script });
	assert.match(instruction, /exactly 14 image prompts/);
	assert.match(instruction, /video image style: Kinetic Typography/);
	assert.match(instruction, /motion-design-inspired composition/);
	assert.match(instruction, /general meaning of the whole video/);
	assert.match(instruction, /broad, representative scenes that portray its central idea/);
	assert.match(instruction, /Two-sentence script idea:/);
	assert.match(instruction, /The first sentence introduces a home garden/);
	assert.match(instruction, /The final sentence shows the garden feeding a healthier neighborhood/);
	assert.doesNotMatch(instruction, /The middle sentence contains implementation detail/);
	assert.ok(idea.length < 500);
	assert.ok(Object.values(IMAGE_STYLE_GUIDANCE).every(Boolean));
	assert.deepEqual(parseImagePrompts('{"prompts":["a", "b"]}', 10), ["a", "b"]);
	assert.deepEqual(parseImagePrompts("1. first scene\n2. second scene", 10), ["first scene", "second scene"]);
});

test("image-prompt API rejects an unsupported style before calling the LLM", async () => {
	let calls = 0;
	const env = { AI: { run: async () => { calls++; return { response: "{}" }; } } };
	const response = await handleGenerateImagePrompts(
		jsonRequest("https://studio.test/api/image-prompts", { topic: "Yoga", style: "neon noir" }),
		env,
		"mock-instruct"
	);
	assert.equal(response.status, 400);
	assert.match((await response.json()).error, /supported style options/);
	assert.equal(calls, 0);
});

test("e2e worker carries a selected plan through script, prompts and one batched image request", async () => {
	const e2eFetch = e2eWorker.default.fetch;
	const call = (path, init) => e2eFetch(new Request("https://studio.test" + path, init));
	const planned = await call("/api/seo-plan", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ topic: "Key light setup" })
	});
	assert.equal(planned.status, 200);
	const plan = await planned.json();
	assert.equal(plan.success, true);
	assert.equal(plan.sets.length, 2);

	const scripted = await call("/api/script", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			topic: "Key light setup",
			minutes: 1,
			speed: "medium",
			keywordSet: plan.sets[0]
		})
	});
	assert.equal(scripted.status, 200);
	const script = await scripted.json();
	assert.equal(script.success, true);
	/* The client gets plain narration text only: the voiceover model
	 * reads a subtitle file out loud, so nothing but the SRT may ship. */
	assert.ok(script.script);
	assert.equal(script.format, "plain");
	assert.equal(script.srt, undefined);
	assert.doesNotMatch(script.script, /-->|\b\d{2}:\d{2}:\d{2}/);
	assert.match(script.script, /Key light setup|key light/i);

	/* One synchronous POST now carries the prompts in its body. */
	const prompted = await call("/api/image-prompts", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			topic: "Key light setup",
			minutes: 1,
			style: "Pop Comic",
			script: script.script,
			keywordSet: plan.sets[0]
		})
	});
	assert.equal(prompted.status, 200);
	const promptData = await prompted.json();
	assert.equal(promptData.success, true);
	assert.equal(promptData.expectedCount, 10);
	assert.equal(promptData.prompts.length, 10);
	assert.match(promptData.prompts[0], /Visual style: Pop Comic/);
	assert.equal(promptData.url, undefined);

	/* The old dynamic job URL is gone for good. */
	const retired = await call("/api/image-prompts/0123abcd-0000-4000-8000-000000000000");
	assert.equal(retired.status, 410);
	assert.match((await retired.json()).error, /poll URL has been removed/);

	/* One POST renders the whole batch and streams one line per image. */
	const batched = await call("/api/image-batch", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ prompts: promptData.prompts.slice(0, 4) })
	});
	assert.equal(batched.status, 200);
	assert.match(batched.headers.get("Content-Type"), /application\/x-ndjson/);
	const events = (await batched.text())
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	assert.equal(events[0].type, "start");
	assert.equal(events[0].count, 4);
	assert.equal(events[0].width, 1024);
	const images = events.filter((event) => event.type === "image");
	assert.equal(images.length, 4);
	assert.ok(images.every((event) => event.ok === true && event.mime === "image/png" && event.data));
	assert.equal(Buffer.from(images[0].data, "base64").subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	const done = events[events.length - 1];
	assert.equal(done.type, "done");
	assert.equal(done.generated, 4);
	assert.equal(done.failed, 0);

	/* The single-image route still works for the manual AI panel. */
	const image = await call("/image/gen?prompt=" + encodeURIComponent(promptData.prompts[0]) + "&variant=1");
	assert.equal(image.status, 200);
	assert.match(image.headers.get("Content-Type"), /image\/png/);
	assert.deepEqual([...new Uint8Array(await image.arrayBuffer())].slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
});

function makeBatchHarness(w, calls, options = {}) {
	const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
	const jsonResponse = (data, status = 200) => ({
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "application/json" : null) },
		json: async () => data,
		body: null
	});
	const ndjsonResponse = (events) => ({
		ok: true,
		status: 200,
		headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "application/x-ndjson" : null) },
		body: new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
				controller.close();
			}
		})
	});

	w.fetch = async (url, opts = {}) => {
		const path = String(url);
		const method = String(opts.method || "GET").toUpperCase();
		calls.push({ path, method, body: opts.body || null });
		if (path === "/api/session") return jsonResponse({ success: true, authenticated: true, user: { username: "Test", usertype: "free" } });
		if (path === "/api/credits") return jsonResponse({ success: true, plan: { id: "free", label: "Free", limits: { images: 50 } }, remaining: { images: 10 } });
		if (path === "/api/seo-plan") return jsonResponse({ success: true, sets: [setA, setB] });
		if (path === "/api/script") return jsonResponse({ success: true, script: sentences.join(" "), format: "plain", title: setA.title, headings: setA.headings, keywords: { longTail: setA.longTail, short: setA.short }, words: sentences.join(" ").split(/\s+/).length, durationMs: sentences.length * 4000, minutes: 1 });
		if (path === "/api/image-prompts" && method === "POST") {
			const batch = JSON.parse(opts.body).batch || { offset: 0, count: 10 };
			const count = Math.min(batch.count, options.promptCount === undefined ? 10 : options.promptCount);
			return jsonResponse({
				success: true,
				prompts: Array.from({ length: count }, (_, i) => "Scene " + (batch.offset + i + 1) + ", a calm home yoga practice. Visual style: Pop Comic"),
				count,
				expectedCount: 10,
				style: "Pop Comic",
				minutes: 1
			});
		}
		if (path === "/api/image-batch" && method === "POST") {
			const body = JSON.parse(opts.body);
			const events = [{ type: "start", requested: body.prompts.length, count: body.prompts.length, width: 1024, height: 576 }];
			body.prompts.forEach((_, index) => {
				if (options.failIndex === index) events.push({ type: "image", index, ok: false, error: "AiError: 3043 Internal server error" });
				else events.push({ type: "image", index, ok: true, mime: "image/png", data: pngBase64 });
			});
			events.push({ type: "done", requested: body.prompts.length, count: body.prompts.length, generated: body.prompts.length - (options.failIndex === undefined ? 0 : 1), failed: options.failIndex === undefined ? 0 : 1 });
			return ndjsonResponse(events);
		}
		return jsonResponse({ success: false, error: "Unexpected mock request: " + method + " " + path }, 404);
	};
}

function makeClient(timeoutMs) {
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	const w = dom.window;
	w.alert = () => { };
	w.confirm = () => true;
	w.scrollTo = () => { };
	let objectUrlId = 0;
	w.URL.createObjectURL = () => "blob:seo-test-" + (++objectUrlId);
	w.URL.revokeObjectURL = () => { };
	w.__PLAN_MODE = "freemium";
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	return { dom, w };
}

async function drainFlow(w, timeoutMs = 1000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const status = w.document.getElementById("va-ai-status-1").textContent;
		if (status.includes("Upload Image, GIF or MP4 is enabled again")) return status;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	return w.document.getElementById("va-ai-status-1").textContent;
}

test("client flow renders progressive batches of three and never polls", async (t) => {
	const calls = [];
	const { dom, w } = makeClient();
	t.after(() => dom.window.close());
	makeBatchHarness(w, calls);
	await new Promise((resolve) => setTimeout(resolve, 0));

	w.addVideoAccordion();
	w.addVideoAccordion();

	w.document.getElementById("va-script-topic-1").value = "Morning yoga";
	await w.generateScript(1);
	w.selectSeoKeywordSet(1, 0);
	const style = w.document.getElementById("seo-wt-style-select-1");
	assert.equal(style.options.length, 10);
	style.value = "Pop Comic";
	style.dispatchEvent(new w.Event("change", { bubbles: true }));
	await w.confirmSeoStyleAndGenerate(1);

	const status = await drainFlow(w);
	const gallery1 = w.document.querySelectorAll("#va-gallery-1 > .va-card");
	assert.equal(gallery1.length, 10);
	assert.equal(w.document.querySelectorAll("#va-gallery-2 > .va-card").length, 0);

	/* Four bounded batches: no job URL, no polling. */
	assert.equal(calls.filter((call) => call.path === "/api/image-prompts").length, 4);
	const batchCalls = calls.filter((call) => call.path === "/api/image-batch");
	assert.equal(batchCalls.length, 4);
	assert.deepEqual(batchCalls.map((call) => JSON.parse(call.body).prompts.length), [3, 3, 3, 1]);
	assert.equal(calls.filter((call) => call.method === "GET" && call.path.startsWith("/api/image-prompts/")).length, 0);
	assert.equal(calls.filter((call) => call.method === "DELETE").length, 0);
	assert.equal(calls.filter((call) => call.path.startsWith("/image/gen?")).length, 0);

	const flowId = gallery1[0].dataset.imagePromptFlowId;
	assert.match(flowId, /^imgflow-1-/);
	assert.ok([...gallery1].every((card) => card.dataset.imagePromptFlowId === flowId));
	assert.match(gallery1[0]._asset.file.name, /ai-video1-seo-1/);
	assert.deepEqual([...new Uint8Array(await gallery1[0]._asset.file.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);
	assert.equal(w.document.getElementById("va-upload-btn-1").disabled, false);
	assert.equal(w.document.getElementById("va-script-btn-1").disabled, false);
	assert.match(status, /10 image\(s\) in the gallery/);

	const promptBody = JSON.parse(calls.find((call) => call.path === "/api/image-prompts").body);
	assert.equal(promptBody.style, "Pop Comic");
	assert.match(promptBody.script, /morning yoga/);
});

test("client flow respects the 25-still cap, reports partial success and re-enables uploads", async (t) => {
	const calls = [];
	const { dom, w } = makeClient();
	t.after(() => dom.window.close());
	makeBatchHarness(w, calls);
	await new Promise((resolve) => setTimeout(resolve, 0));

	w.addVideoAccordion();
	w.addVideoAccordion();
	const seedBlob = new w.Blob(["seed"], { type: "image/png" });
	const seedFile = new w.File([seedBlob], "existing.png", { type: "image/png" });
	for (let i = 0; i < 24; i++) w.addAiToVideo(1, seedFile, seedBlob);
	assert.equal(w.document.querySelectorAll("#va-gallery-1 > .va-card").length, 24);

	w.document.getElementById("va-script-topic-1").value = "Morning yoga";
	await w.generateScript(1);
	w.selectSeoKeywordSet(1, 0);
	await w.confirmSeoStyleAndGenerate(1);

	const status = await drainFlow(w);
	assert.equal(w.document.querySelectorAll("#va-gallery-1 > .va-card").length, 25);
	assert.equal(w.document.querySelectorAll("#va-gallery-2 > .va-card").length, 0);

	/* Only the one free slot was requested — not all ten prompts. */
	const batchCall = calls.find((call) => call.path === "/api/image-batch");
	assert.equal(JSON.parse(batchCall.body).prompts.length, 1);

	assert.equal(w.document.getElementById("va-upload-btn-1").disabled, false);
	assert.equal(w.document.getElementById("va-script-btn-1").disabled, false);
	assert.match(status, /1 image\(s\) in the gallery/);
});

test("client flow reports a prompt-generation failure and never starts a batch", async (t) => {
	const calls = [];
	const { dom, w } = makeClient();
	t.after(() => dom.window.close());
	makeBatchHarness(w, calls, { promptCount: 0 });
	await new Promise((resolve) => setTimeout(resolve, 0));

	w.addVideoAccordion();
	w.document.getElementById("va-script-topic-1").value = "Morning yoga";
	await w.generateScript(1);
	w.selectSeoKeywordSet(1, 0);
	await w.confirmSeoStyleAndGenerate(1);

	const status = await drainFlow(w, 4000);
	assert.equal(calls.filter((call) => call.path === "/api/image-batch").length, 0);
	assert.match(status, /Image prompts could not be generated/);
	assert.equal(w.document.getElementById("va-upload-btn-1").disabled, false);
});

test("image prompts are returned synchronously and short answers are topped up", async () => {
	const calls = [];
	const env = {
		AI: {
			run: async (_model, input) => {
				calls.push(String(input.prompt));
				const count = Number(String(input.prompt).match(/exactly (\d+) image prompts/)[1]);
				/* First answer is deliberately short: 6 of the 10 requested. */
				const returned = calls.length === 1 ? 6 : count;
				return { response: JSON.stringify({ prompts: Array.from({ length: returned }, (_, i) => `Scene ${calls.length}-${i + 1} about a calm yoga practice`) }) };
			}
		}
	};
	const response = await handleGenerateImagePrompts(
		jsonRequest("https://studio.test/api/image-prompts", { topic: "Yoga", minutes: 1, style: "Neon Night", script: makeSrt() }),
		env,
		"mock-instruct"
	);
	assert.equal(response.status, 200);
	const data = await response.json();
	assert.equal(data.success, true);
	assert.equal(data.count, 10);
	assert.equal(data.prompts.length, 10);
	assert.match(data.prompts[0], /Visual style: Neon Night/);
	assert.match(data.prompts[0], /vivid cyan and magenta neon/);
	/* The retry only asked for the 4 missing scenes. */
	assert.equal(calls.length, 2);
	assert.match(calls[1], /exactly 4 image prompts/);

	/* A model that never answers enough still returns what it produced. */
	const stubborn = await handleGenerateImagePrompts(
		jsonRequest("https://studio.test/api/image-prompts", { topic: "Yoga", minutes: 4, style: "Documentary", script: makeSrt() }),
		{ AI: { run: async () => ({ response: JSON.stringify({ prompts: ["Only one usable scene"] }) }) } },
		"mock-instruct"
	);
	assert.equal(stubborn.status, 200);
	const partial = await stubborn.json();
	assert.equal(partial.count, 1);
	assert.match(partial.prompts[0], /Visual style: Documentary/);
});

test("the retired image-prompt job URL answers 410 with a migration hint", async () => {
	const response = handleRemovedImagePromptJobRoute("abc-123");
	assert.equal(response.status, 410);
	const data = await response.json();
	assert.match(data.error, /POST \/api\/image-prompts/);
	assert.deepEqual(data.prompts, []);
});

test("image batch renders every prompt in one response and reports per-image failures", async () => {
	const env = {
		AI: {
			run: async (_model, input) => {
				/* This scene fails on both attempts, so it must be refunded. */
				if (String(input.prompt).includes("two")) throw new Error("AiError: 3043 Internal server error");
				return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])).body;
			}
		}
	};
	const consumed = [];
	const refunded = [];
	const response = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			body: JSON.stringify({ prompts: ["one", "two", "three"] }),
			headers: { "Content-Type": "application/json" }
		}),
		env,
		{
			consume: async (amount) => {
				consumed.push(amount);
				return { allowed: true, granted: amount, summary: { remaining: { images: 7 } } };
			},
			refund: async (amount) => {
				refunded.push(amount);
				return { remaining: { images: 9 } };
			}
		}
	);
	assert.equal(response.status, 200);
	assert.match(response.headers.get("Content-Type"), /application\/x-ndjson/);
	const events = (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
	assert.deepEqual(consumed, [3]);
	assert.deepEqual(refunded, [1]);
	const images = events.filter((event) => event.type === "image");
	assert.equal(images.length, 3);
	assert.equal(images.filter((event) => event.ok).length, 2);
	assert.equal(images.filter((event) => !event.ok).length, 1);
	assert.match(images.find((event) => !event.ok).error, /3043/);
	const done = events[events.length - 1];
	assert.equal(done.type, "done");
	assert.equal(done.generated, 2);
	assert.equal(done.failed, 1);
	assert.deepEqual(done.credits, { remaining: { images: 9 } });
});

test("image batch validates input, caps the batch, honours a partial allowance and refunds nothing it cannot use", async () => {
	const env = { AI: { run: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])).body } };
	const hooks = {
		consume: async (amount) => ({ allowed: true, granted: Math.min(amount, 2), summary: null }),
		refund: async () => null
	};
	const empty = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			body: JSON.stringify({ prompts: [] }),
			headers: { "Content-Type": "application/json" }
		}),
		env,
		hooks
	);
	assert.equal(empty.status, 400);

	const tooMany = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			body: JSON.stringify({ prompts: Array.from({ length: IMAGE_BATCH_MAX_PROMPTS + 1 }, (_, i) => "scene " + i) }),
			headers: { "Content-Type": "application/json" }
		}),
		env,
		hooks
	);
	assert.equal(tooMany.status, 400);
	assert.match((await tooMany.json()).error, /at most 20/);

	const partial = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			body: JSON.stringify({ prompts: ["a", "b", "c", "d"] }),
			headers: { "Content-Type": "application/json" }
		}),
		env,
		hooks
	);
	const events = (await partial.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
	assert.equal(events[0].count, 2);
	assert.equal(events[events.length - 1].skipped, 2);

	const blocked = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			body: JSON.stringify({ prompts: ["a"] }),
			headers: { "Content-Type": "application/json" }
		}),
		env,
		{
			consume: async () => ({ allowed: false, granted: 0, summary: { remaining: { images: 0 } }, error: "Daily image credits are exhausted." }),
			refund: async () => null
		}
	);
	assert.equal(blocked.status, 429);
	assert.match((await blocked.json()).error, /exhausted/);
});

test("image batch uses the 16:9 model size and the batch image limits are wired to the gallery cap", async () => {
	const inputs = [];
	const env = {
		AI: {
			run: async (_model, input) => {
				inputs.push(input);
				return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])).body;
			}
		}
	};
	const responded = await handleImageBatch(
		new Request("https://studio.test/api/image-batch", {
			method: "POST",
			body: JSON.stringify({ prompts: ["a calm studio"] }),
			headers: { "Content-Type": "application/json" }
		}),
		env,
		{ consume: async (n) => ({ allowed: true, granted: n }), refund: async () => null }
	);
	/* Draining the stream is what completes the batch work. */
	await responded.text();
	assert.equal(inputs.length, 1);
	assert.equal(inputs[0].width, IMAGE_WIDTH);
	assert.equal(inputs[0].height, IMAGE_HEIGHT);
	assert.equal(IMAGE_WIDTH, 1024);
	assert.equal(IMAGE_HEIGHT, 576);
	assert.match(String(inputs[0].negative_prompt), /text, words, letters/);
	assert.equal(inputs[0].num_steps, 20);
});


test("client walkthrough exposes the fixed style dropdown and the polling-free batch flow", () => {
	assert.doesNotThrow(() => new vm.Script(APP_JS));
	/* One dropdown per video: the id carries the video number. */
	assert.ok(APP_JS.includes('id="seo-wt-style-select-'));
	assert.ok(!APP_JS.includes("seo-wt-style-input"));
	for (const style of IMAGE_STYLES) assert.ok(APP_JS.includes('"' + style + '"'), style);

	/* One prompt request + one batch request, no timers or job URLs. */
	assert.ok(APP_JS.includes('"/api/image-prompts"'));
	assert.ok(APP_JS.includes('"/api/image-batch"'));
	assert.ok(!APP_JS.includes("setInterval"));
	assert.ok(!APP_JS.includes("pollImagePromptOnce"));
	assert.ok(!APP_JS.includes("watchGalleryCompletion"));
	assert.ok(!APP_JS.includes("imagePromptJobId"));
	assert.ok(!APP_JS.includes("__SEO_FLOW_TIMING = {\n\t\t\timagePromptPollMs"));
	assert.ok(APP_JS.includes("IMAGE_BATCH_IDLE_TIMEOUT_MS"));
	assert.ok(APP_JS.includes("getReader()"));
	assert.ok(APP_JS.includes("addAiToVideo(n, file, blob, flowId, true)"));

	assert.ok(APP_CSS.includes("background: #ffffff"));
	assert.ok(APP_CSS.includes('[id^="seo-wt-style-select"]'));
});

test("editor gallery receives first three images while next prompt request is still pending", async (t) => {
	const calls = [];
	const { dom, w } = makeClient();
	t.after(() => dom.window.close());
	makeBatchHarness(w, calls);
	const baseFetch = w.fetch;
	let release;
	const gate = new Promise((resolve) => { release = resolve; });
	let lookahead = false;
	w.fetch = async (url, init = {}) => {
		if (url === "/api/image-prompts" && JSON.parse(init.body).batch.offset === 3) {
			lookahead = true;
			await gate;
		}
		return baseFetch(url, init);
	};
	await new Promise((resolve) => setTimeout(resolve, 0));
	w.addVideoAccordion();
	w.document.getElementById("va-script-topic-1").value = "Morning yoga";
	await w.generateScript(1);
	w.selectSeoKeywordSet(1, 0);
	await w.confirmSeoStyleAndGenerate(1);
	for (let i = 0; i < 100 && w.document.querySelectorAll("#va-gallery-1 > .va-card").length < 3; i++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.equal(lookahead, true);
	assert.equal(w.document.querySelectorAll("#va-gallery-1 > .va-card").length, 3);
	assert.equal(w.document.getElementById("va-upload-btn-1").disabled, true);
	release();
	assert.match(await drainFlow(w), /10 image\(s\) in the gallery/);
});

test("editor prompt timeout remains armed through JSON body consumption and normalizes raw abort wording", async (t) => {
	const { dom, w } = makeClient();
	t.after(() => dom.window.close());
	const owner = {};
	w.fetch = async (url, init) => ({ ok: true, json: () => new Promise((_, reject) => {
		init.signal.addEventListener("abort", () => reject(Object.assign(new Error("signal is aborted without reason"),
			{ name: "AbortError" })), { once: true });
	}) });
	await assert.rejects(w.seoFetchWithTimeout("/api/image-prompts", {}, 10, owner, "controller", (response) => response.json()),
		(error) => error.name === "TimeoutError" && /timed out/.test(error.message) && !/signal|abort/.test(error.message));
	assert.equal(owner.controller, null);
});
