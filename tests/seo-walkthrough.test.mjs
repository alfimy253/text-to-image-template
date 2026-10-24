import assert from "node:assert/strict";
import test from "node:test";
import { handleSeoPlanGeneration, handleSeoScriptGeneration } from "../src/modules/script-seo.ts";
import {
	imagePromptCountForMinutes,
	buildImagePromptInstruction,
	parseImagePrompts,
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

test("image prompt counts follow script length: 10 / 14 / 20", () => {
	assert.equal(imagePromptCountForMinutes(1), 10);
	assert.equal(imagePromptCountForMinutes(2), 14);
	assert.equal(imagePromptCountForMinutes(3), 14);
	assert.equal(imagePromptCountForMinutes(4), 20);
	assert.equal(imagePromptCountForMinutes(5), 20);
	const instruction = buildImagePromptInstruction({ topic: "Yoga", minutes: 3, style: "watercolor storybook" });
	assert.match(instruction, /exactly 14 image prompts/);
	assert.match(instruction, /watercolor storybook/);
	assert.deepEqual(parseImagePrompts('{"prompts":["a", "b"]}', 10), ["a", "b"]);
	assert.deepEqual(parseImagePrompts("1. first scene\n2. second scene", 10), ["first scene", "second scene"]);
});

test("image-prompt job: created empty, polled until ready, then destroyed", async () => {
	const env = {
		AI: {
			run: async (_model, input) => {
				const count = Number(String(input.prompt).match(/exactly (\d+) image prompts/)[1]);
				return { response: JSON.stringify({ prompts: Array.from({ length: count }, (_, i) => `Scene ${i + 1} in neon noir style`) }) };
			}
		}
	};
	const created = await handleCreateImagePromptJob(
		jsonRequest("https://studio.test/api/image-prompts", { topic: "Yoga", minutes: 1, style: "neon noir", script: makeSrt() }),
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
	assert.match(polled.prompts[0], /neon noir/);

	const destroyed = await handleDestroyImagePromptJob(env, job.id);
	assert.equal(destroyed.status, 200);
	const after = await handleGetImagePromptJob(env, job.id);
	assert.equal(after.status, 404);
	assert.deepEqual((await after.json()).prompts, []);
});
