/*
 * Browser-owned script-writing retry contract.
 *
 * The shipped client is the source of truth: one initial write plus at most
 * seven retries, a 40 s backoff before every retry, no failure/retry text in
 * either layout, and a continuous script textbox + loading animation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./studio-render-harness.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
	status,
	headers: { "Content-Type": "application/json" }
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scriptError() {
	return json({ success: false, error: "bad keyword set", retryable: false }, 400);
}

function scriptSuccess() {
	return json({
		success: true,
		script: "A forest has trees and flowers. Nature is peaceful.",
		durationMs: 60000,
		title: "A Forest Guide",
		headings: ["Forest basics"],
		keywords: { longTail: "forest trees", short: ["forest", "trees", "flowers", "nature"] },
		words: 9
	});
}

function fastRetries(w) {
	/* The production values are asserted separately; runtime tests shrink them. */
	w.__SCRIPT_RETRY_TIMING.maxRetries = 7;
	w.__SCRIPT_RETRY_TIMING.backoffMs = 1;
	w.__SCRIPT_RETRY_TIMING.uiCheckMs = 1;
}

test("the browser advertises seven retries, eight writes and a 40-second backoff", (t) => {
	const { w } = harness();
	t.after(() => w.close());
	assert.equal(w.__SCRIPT_RETRY_TIMING.maxRetries, 7);
	assert.equal(w.__SCRIPT_RETRY_TIMING.maxAttempts, 8);
	assert.equal(w.__SCRIPT_RETRY_TIMING.backoffMs, 40000);
	assert.equal(w.__SCRIPT_RETRY_TIMING.retryBackoffMs, 40000);
	assert.equal(w.__SCRIPT_RETRY_TIMING.owner, "browser");
});

test("an editor script error is silently retried seven times with the textbox and spinner intact", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	fastRetries(w);
	const original = w.fetch;
	let calls = 0;
	w.fetch = async (input, init = {}) => {
		const path = String(input);
		if (path === "/api/pipeline-capabilities") return json({ singleAttemptScript: false });
		if (path === "/api/script") {
			calls++;
			return scriptError();
		}
		return original(input, init);
	};

	w.addVideoAccordion();
	const box = w.document.getElementById("va-script-box-1");
	const run = w.runSeoScriptRequest(1, "garden", 1, "medium");
	await delay(0);
	const spinner = box.querySelector(".va-spinner");
	assert.ok(spinner, "the loading animation is painted before the first request");
	assert.equal(await run, false);

	assert.equal(calls, 8, "one initial write and exactly seven retries");
	assert.equal(w.__SCRIPT_RETRY_LOG.filter((entry) => entry.event === "backoff").length, 7,
		"one backoff before each retry");
	assert.ok(w.__SCRIPT_RETRY_LOG.filter((entry) => entry.event === "backoff").every((entry) => entry.delayMs === 1));

	assert.equal(w.document.getElementById("va-script-box-1"), box, "the textbox element is never replaced");
	assert.equal(spinner.parentNode, box, "the spinner element is never removed");
	assert.equal(box.classList.contains("va-script-loading"), true, "the loading animation stays on");
	assert.notEqual(box.style.display, "none", "the textbox stays visible");
	const status = w.document.getElementById("va-script-status-1").textContent;
	assert.match(status, /Writing your SEO script/);
	assert.doesNotMatch(status, /failed|error|retry|attempt/i, "no retry or failure wording reaches the UI");
	assert.equal(w.document.getElementById("va-script-btn-1").disabled, false);
});

test("the UI checker erases an injected error and the last retry can still succeed", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	fastRetries(w);
	const original = w.fetch;
	let calls = 0;
	let gate;
	const first = new Promise((resolve) => { gate = resolve; });
	w.fetch = async (input, init = {}) => {
		const path = String(input);
		if (path === "/api/pipeline-capabilities") return json({ singleAttemptScript: false });
		if (path === "/api/script") {
			calls++;
			if (calls === 1) await first;
			return calls < 8 ? scriptError() : scriptSuccess();
		}
		return original(input, init);
	};

	w.addVideoAccordion();
	const box = w.document.getElementById("va-script-box-1");
	const status = w.document.getElementById("va-script-status-1");
	const run = w.runSeoScriptRequest(1, "garden", 1, "medium");
	await delay(2);
	const spinner = box.querySelector(".va-spinner");
	assert.ok(spinner);
	status.textContent = "Script failed: retrying in 40s";
	await delay(10);
	assert.equal(status.textContent, "Writing your SEO script...", "the UI checker restores writing mode");
	assert.equal(box.querySelector(".va-spinner"), spinner, "the checker does not rebuild the animation");
	gate();
	assert.equal(await run, true, "the eighth write succeeds");
	assert.equal(calls, 8);
	assert.equal(w.__SCRIPT_RETRY_LOG.filter((entry) => entry.event === "backoff").length, 7);
	assert.match(w.__VIDEO_PROJECTS[0].script, /A forest has trees/);
	assert.equal(box.classList.contains("va-script-loading"), false, "success ends the loading state");
	assert.doesNotMatch(w.document.getElementById("va-script-status-1").textContent, /failed|retry/i);
});

test("Quick Batch retries silently without removing its script textarea or spinner", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	fastRetries(w);
	const original = w.fetch;
	let calls = 0;
	w.fetch = async (input, init = {}) => {
		const path = String(input);
		if (path === "/api/pipeline-capabilities") return json({ singleAttemptScript: false });
		if (path === "/api/script") {
			calls++;
			return scriptError();
		}
		return original(input, init);
	};

	const row = w.addBatchRow({ script: "forest topic", minutes: 1 });
	const scope = w.document.querySelector('[data-batch-row="' + row.id + '"]');
	const textarea = scope.querySelector('[data-batch-field="script"]');
	const run = w.generateBatchRowScript(row.id);
	await delay(0);
	const spinner = scope.querySelector(".va-spinner");
	assert.ok(spinner, "the row paints the editor's loading animation");
	assert.equal(await run, false);

	assert.equal(calls, 8, "the table layout uses the same seven-retry ladder");
	assert.equal(w.__SCRIPT_RETRY_LOG.filter((entry) => entry.event === "backoff").length, 7);
	assert.equal(scope.querySelector('[data-batch-field="script"]'), textarea, "the textarea is never replaced");
	assert.equal(textarea.value, "forest topic", "the typed topic remains in the textbox");
	assert.equal(scope.querySelector(".va-spinner"), spinner, "the spinner remains continuously");
	assert.equal(row.error, "", "no error is recorded on the row");
	assert.equal(scope.querySelector('[data-batch-slot="status"]').getAttribute("data-stage"), "writing");
	const status = scope.querySelector('[data-batch-slot="status"]').textContent;
	assert.match(status, /Writing the script \(AI\)|Writing your SEO script/);
	assert.doesNotMatch(status, /failed|error|retry|attempt|⚠/i);
});

test("the Worker advertises the browser script ladder and accepts attempt seven", async () => {
	const workerModule = await import("../src/index.ts");
	const worker = workerModule.default || workerModule;
	const caps = await (await worker.fetch(
		new Request("https://studio.test/api/pipeline-capabilities"), {}, {}
	)).json();
	assert.equal(caps.scriptRetryOwner, "browser");
	assert.equal(caps.browserScriptRetries, 7);
	assert.equal(caps.scriptRetryBackoffMs, 40000);

	const { SCRIPT_BROWSER_RETRY_LIMIT, handleSeoScriptGeneration } = await import("../src/modules/script-seo.ts");
	assert.equal(SCRIPT_BROWSER_RETRY_LIMIT, 7);
	const keywordSet = {
		title: "Yoga Morning Balance",
		headings: ["Yoga for Calm", "Morning Stretch"],
		longTail: "morning yoga poses for beginners in a small home studio",
		short: ["yoga", "breathing", "stretching", "balance"]
	};
	const request = new Request("https://studio.test/api/script", {
		method: "POST",
		body: JSON.stringify({ singleAttempt: true, browserRetries: true, attempt: 7, topic: "Yoga", minutes: 1, speed: "medium", keywordSet })
	});
	let inferences = 0;
	const env = { AI: { run: async () => { inferences++; throw new Error("upstream failed"); } } };
	const response = await handleSeoScriptGeneration(request, new URL(request.url), env, "primary", async () => {}, {});
	assert.equal(response.status, 500, "attempt seven reaches one writer inference instead of a 400 validation error");
	assert.equal(inferences, 1, "the Worker spends one inference for this browser-owned attempt");
});
