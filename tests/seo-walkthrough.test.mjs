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
	handleCreateImagePromptJob,
	handleGetImagePromptJob,
	handleDestroyImagePromptJob
} from "../src/modules/image-prompts.ts";

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
	const response = await handleCreateImagePromptJob(
		jsonRequest("https://studio.test/api/image-prompts", { topic: "Yoga", style: "neon noir" }),
		env,
		undefined,
		"mock-instruct"
	);
	assert.equal(response.status, 400);
	assert.match((await response.json()).error, /supported style options/);
	assert.equal(calls, 0);
});

test("e2e worker carries a selected plan through script, prompt polling, image generation and cleanup", async () => {
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
	assert.ok(script.srt);

	const created = await call("/api/image-prompts", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			topic: "Key light setup",
			minutes: 1,
			style: "Pop Comic",
			script: script.srt,
			keywordSet: plan.sets[0]
		})
	});
	assert.equal(created.status, 202);
	const job = await created.json();
	assert.match(job.url, /^\/api\/image-prompts\/[A-Za-z0-9-]+$/);
	assert.equal(job.expectedCount, 10);

	let ready;
	for (let i = 0; i < 50; i++) {
		const response = await call(job.url, { headers: { "Accept": "application/json" } });
		assert.equal(response.status, 200);
		ready = await response.json();
		if (ready.status === "ready") break;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.equal(ready.status, "ready");
	assert.equal(ready.prompts.length, 10);
	assert.match(ready.prompts[0], /Visual style: Pop Comic/);

	const image = await call("/image/gen?prompt=" + encodeURIComponent(ready.prompts[0]) + "&variant=1");
	assert.equal(image.status, 200);
	assert.match(image.headers.get("Content-Type"), /image\/png/);
	assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);

	const deleted = await call(job.url, { method: "DELETE" });
	assert.equal(deleted.status, 200);
	const missing = await call(job.url);
	assert.equal(missing.status, 404);
});

test("client flow adds a tagged image to the correct gallery, respects the cap, and finalizes partially", async (t) => {
	const calls = [];
	const promptUrl = "/api/image-prompts/job-client-123";
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	t.after(() => dom.window.close());
	const w = dom.window;
	w.alert = () => {};
	w.confirm = () => true;
	w.scrollTo = () => {};
	let objectUrlId = 0;
	w.URL.createObjectURL = () => "blob:seo-test-" + (++objectUrlId);
	w.URL.revokeObjectURL = () => {};

	const jsonResponse = (data, status = 200) => ({
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => "application/json" },
		json: async () => data
	});
	w.fetch = async (url, options = {}) => {
		const path = String(url);
		const method = String(options.method || "GET").toUpperCase();
		calls.push({ path, method, body: options.body || null });
		if (path === "/api/session") return jsonResponse({ success: true, authenticated: true, user: { username: "Test", usertype: "free" } });
		if (path === "/api/credits") return jsonResponse({ success: true, plan: { id: "free" }, remaining: { images: 10 } });
		if (path === "/api/seo-plan") return jsonResponse({ success: true, sets: [setA, setB] });
		if (path === "/api/script") return jsonResponse({ success: true, srt: makeSrt(), title: setA.title, headings: setA.headings, keywords: { longTail: setA.longTail, short: setA.short } });
		if (path === "/api/image-prompts" && method === "POST") return jsonResponse({ success: true, id: "job-client-123", url: promptUrl, expectedCount: 10 }, 202);
		if (path === promptUrl && method === "GET") return jsonResponse({ success: true, status: "ready", prompts: Array.from({ length: 10 }, (_, i) => "Scene " + (i + 1) + ", a calm home yoga practice. Visual style: Pop Comic") });
		if (path === promptUrl && method === "DELETE") return jsonResponse({ success: true, destroyed: true });
		if (path.startsWith("/image/gen?")) {
			return {
				ok: true,
				status: 200,
				headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "image/png" : null },
				blob: async () => new w.Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" })
			};
		}
		return jsonResponse({ success: false, error: "Unexpected mock request: " + method + " " + path }, 404);
	};
	w.__PLAN_MODE = "freemium";
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	await new Promise((resolve) => setTimeout(resolve, 0));

	w.addVideoAccordion();
	w.addVideoAccordion();
	const seedBlob = new w.Blob(["seed"], { type: "image/png" });
	const seedFile = new w.File([seedBlob], "existing.png", { type: "image/png" });
	for (let i = 0; i < 24; i++) w.addAiToVideo(1, seedFile, seedBlob);
	assert.equal(w.document.querySelectorAll("#va-gallery-1 > .va-card").length, 24);

	w.document.getElementById("va-script-topic-1").value = "Morning yoga";
	await w.generateScript(1);
	assert.equal(w.document.querySelectorAll("#seo-wt-sets-list .seo-wt-card").length, 2);
	w.selectSeoKeywordSet(1, 0);
	const style = w.document.getElementById("seo-wt-style-select");
	assert.equal(style.options.length, 10);
	style.value = "Pop Comic";
	style.dispatchEvent(new w.Event("change", { bubbles: true }));
	w.closeSeoWalkthrough();
	await w.generateScript(1);
	assert.equal(w.document.getElementById("seo-wt-style-select").value, "Pop Comic");
	await w.confirmSeoStyleAndGenerate(1);

	for (let i = 0; i < 100; i++) {
		const status = w.document.getElementById("va-ai-status-1").textContent;
		if (calls.some((call) => call.method === "DELETE" && call.path === promptUrl) && status.includes("Upload Image, GIF or MP4 is enabled again")) break;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}

	const gallery1 = w.document.querySelectorAll("#va-gallery-1 > .va-card");
	const gallery2 = w.document.querySelectorAll("#va-gallery-2 > .va-card");
	assert.equal(gallery1.length, 25);
	assert.equal(gallery2.length, 0);
	const generatedCard = gallery1[gallery1.length - 1];
	assert.equal(generatedCard.dataset.imagePromptFlowId, "job-client-123");
	assert.equal(generatedCard._asset.imagePromptFlowId, "job-client-123");
	assert.match(generatedCard._asset.file.name, /ai-video1-seo-1/);
	assert.equal(w.document.getElementById("va-upload-btn-1").disabled, false);
	assert.equal(w.document.getElementById("va-script-btn-1").disabled, false);
	assert.match(w.document.getElementById("va-ai-status-1").textContent, /1 of 10 prompted image\(s\) added/);
	assert.equal(calls.filter((call) => call.path.startsWith("/image/gen?")).length, 1);
	assert.equal(calls.filter((call) => call.method === "DELETE" && call.path === promptUrl).length, 1);
	const imageRequest = new URL(calls.find((call) => call.path.startsWith("/image/gen?")).path, "https://studio.test");
	assert.equal(imageRequest.searchParams.get("variant"), "1");
	assert.match(imageRequest.searchParams.get("prompt"), /Visual style: Pop Comic/);
	const promptJobBody = JSON.parse(calls.find((call) => call.path === "/api/image-prompts" && call.method === "POST").body);
	assert.equal(promptJobBody.style, "Pop Comic");
	assert.match(promptJobBody.script, /morning yoga/);
});

test("client walkthrough exposes the fixed style dropdown and guarded image-generation flow", () => {
	assert.doesNotThrow(() => new vm.Script(APP_JS));
	assert.ok(APP_JS.includes('id="seo-wt-style-select"'));
	assert.ok(!APP_JS.includes("seo-wt-style-input"));
	for (const style of IMAGE_STYLES) assert.ok(APP_JS.includes('"' + style + '"'), style);
	assert.ok(APP_JS.includes("pollImagePromptOnce(n);"));
	assert.ok(APP_JS.includes("IMAGE_PROMPT_POLL_MAX_FAILURES"));
	assert.ok(APP_JS.includes("response.status === 401 || response.status === 429"));
	assert.ok(APP_JS.includes("The image-prompt job was not found or expired"));
	assert.ok(APP_JS.includes("addAiToVideo(n, file, blob, project.imagePromptJobId, true)"));
	assert.ok(APP_JS.includes('method: "DELETE"'));
	assert.ok(APP_CSS.includes("background: #ffffff"));
	assert.ok(APP_CSS.includes("#seo-wt-style-select"));
});

test("image-prompt job: created empty, polled until ready, then destroyed", async () => {
	const env = {
		AI: {
			run: async (_model, input) => {
				const count = Number(String(input.prompt).match(/exactly (\d+) image prompts/)[1]);
				return { response: JSON.stringify({ prompts: Array.from({ length: count }, (_, i) => `Scene ${i + 1} about a calm yoga practice`) }) };
			}
		}
	};
	const created = await handleCreateImagePromptJob(
		jsonRequest("https://studio.test/api/image-prompts", { topic: "Yoga", minutes: 1, style: "Neon Night", script: makeSrt() }),
		env,
		undefined,
		"mock-instruct"
	);
	assert.equal(created.status, 202);
	const job = await created.json();
	assert.equal(job.success, true);
	assert.deepEqual(job.prompts, []);
	assert.equal(job.expectedCount, 10);
	assert.match(job.url, /^\/api\/image-prompts\//);

	// The background LLM work finishes without an execution context in
	// tests; poll (like the browser does) until the prompts land.
	let polled = null;
	for (let i = 0; i < 50; i++) {
		const res = await handleGetImagePromptJob(env, job.id);
		assert.equal(res.status, 200);
		polled = await res.json();
		if (polled.status === "ready") break;
		assert.deepEqual(polled.prompts, []);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	assert.equal(polled.status, "ready");
	assert.equal(polled.prompts.length, 10);
	assert.match(polled.prompts[0], /Visual style: Neon Night/);
	assert.match(polled.prompts[0], /vivid cyan and magenta neon/);

	const destroyed = await handleDestroyImagePromptJob(env, job.id);
	assert.equal(destroyed.status, 200);
	const after = await handleGetImagePromptJob(env, job.id);
	assert.equal(after.status, 404);
	assert.deepEqual((await after.json()).prompts, []);
});
