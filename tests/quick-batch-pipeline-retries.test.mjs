/*
 * FINAL RULE - QUICK BATCH TABLE LAYOUT.
 *
 * The editor's script textbox is pinned while browser-owned retries run.
 * Every failed Quick Batch pipeline stage is retried by client JavaScript:
 * one initial attempt plus seven retries, a 40-second backoff before each
 * retry, only the failed stage's partial output reset, and no error/retry
 * wording in the table UI.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./studio-render-harness.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
	status,
	headers: { "Content-Type": "application/json" }
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

function fastScriptRetries(w) {
	w.__SCRIPT_RETRY_TIMING.maxRetries = 7;
	w.__SCRIPT_RETRY_TIMING.backoffMs = 1;
	w.__SCRIPT_RETRY_TIMING.uiCheckMs = 1;
}

function fastPipelineRetries(w) {
	w.__BATCH_PIPELINE_RETRY_TIMING.maxRetries = 7;
	w.__BATCH_PIPELINE_RETRY_TIMING.backoffMs = 0;
	w.__BATCH_PIPELINE_RETRY_TIMING.uiCheckMs = 0;
}

function scriptError() {
	return json({ success: false, error: "bad keyword set", retryable: false }, 400);
}

function capabilities() {
	return json({
		version: 261,
		binaryImages: false,
		compactPrompts: false,
		singleAttemptScript: false,
		imageChunks: 1,
		imageSlots: 3
	});
}

function ndjson(events) {
	const text = events.map((event) => JSON.stringify(event) + "\n").join("");
	return new Response(text, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

function imageBatchResponse(body, callIndex) {
	const events = [{ type: "start", count: body.prompts.length, width: 1024, height: 576 }];
	/* The fixed plan needs four distinct clips and eight distinct photos. */
	const clipSlots = [1, 4, 7, 10];
	body.prompts.forEach((_, index) => {
		const scene = Array.isArray(body.sceneIndexes) ? Number(body.sceneIndexes[index]) : callIndex * 3 + index;
		const clip = clipSlots.indexOf(scene) !== -1;
		events.push({
			type: "image",
			index,
			ok: true,
			mime: clip ? "video/mp4" : "image/png",
			data: pngBase64,
			source: { id: "media-" + scene, type: clip ? "video" : "image" }
		});
	});
	events.push({ type: "done", generated: body.prompts.length, failed: 0 });
	return ndjson(events);
}

test("the final Quick Batch rule advertises browser-owned 7-retry / 40 s stage ladder", async () => {
	const { w } = harness();
	w.close();
	const workerModule = await import("../src/index.ts");
	const worker = workerModule.default || workerModule;
	const caps = await (await worker.fetch(
		new Request("https://studio.test/api/pipeline-capabilities"), {}, {}
	)).json();
	assert.equal(caps.quickBatchPipelineRetryOwner, "browser");
	assert.equal(caps.batchPipelineRetryOwner, "browser");
	assert.equal(caps.quickBatchPipelineRetries, 7);
	assert.equal(caps.batchPipelineRetries, 7);
	assert.equal(caps.quickBatchPipelineRetryBackoffMs, 40000);
	assert.equal(caps.batchPipelineRetryBackoffMs, 40000);
	assert.equal(caps.scriptRetryOwner, "browser");
	assert.equal(caps.browserScriptRetries, 7);
	assert.equal(caps.scriptRetryBackoffMs, 40000);
});

test("the editor script textbox stays visible across delayed state paints and renumbering", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	fastScriptRetries(w);
	const original = w.fetch;
	w.fetch = async (input, init = {}) => {
		const path = new URL(String(input), "https://studio.test").pathname;
		if (path === "/api/pipeline-capabilities") return capabilities();
		if (path === "/api/script") return scriptError();
		return original(input, init);
	};

	w.addVideoAccordion();
	const run = w.runSeoScriptRequest(1, "garden", 1, "medium");
	await delay(3);
	let box = w.document.getElementById("va-script-box-1");
	const spinner = box.querySelector(".va-spinner");
	assert.ok(spinner, "the writing animation is on screen");

	for (let i = 0; i < 5; i++) {
		w.setScriptBoxState(1, false);
		w.setScriptLoading(1, false);
		w.toggleScriptBox(1);
		await delay(2);
		assert.notEqual(box.style.display, "none", "the textbox does not disappear over time");
		assert.equal(box.querySelector(".va-spinner"), spinner, "the same spinner stays in the DOM");
	}

	/* Rebuilding the accordion at its same number must also keep the box. */
	const state = w.captureVideoAccordionState(1);
	const acc = w.document.getElementById("video-1");
	if (acc && acc.parentNode) acc.parentNode.removeChild(acc);
	w.restoreVideoAccordionState(1, state);
	box = w.document.getElementById("va-script-box-1");
	assert.ok(box, "renumbering recreates the script textbox");
	assert.notEqual(box.style.display, "none", "renumbering never hides the textbox");
	assert.ok(box.querySelector(".va-spinner"), "renumbering keeps the loading animation");

	assert.equal(await run, false);
	assert.equal(box.style.display, "");
	assert.equal(box.classList.contains("va-script-loading"), true);
	assert.doesNotMatch(w.document.getElementById("va-script-status-1").textContent, /failed|error|retry|attempt/i);
});

test("a Quick Batch row with no scene plan is retried by JS and then proceeds to the next pipeline", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	fastPipelineRetries(w);
	fastScriptRetries(w);
	w.__CLIP_PROBE_TIMING = { timeoutMs: 1 };
	Object.defineProperty(w.HTMLMediaElement.prototype, "src", {
		configurable: true,
		get: function () { return this.getAttribute("src") || ""; },
		set: function (value) {
			this.setAttribute("src", value);
			setTimeout(() => this.dispatchEvent(new w.Event("loadedmetadata")), 0);
		}
	});
	w.HTMLMediaElement.prototype.load = function () {
		setTimeout(() => this.dispatchEvent(new w.Event("loadedmetadata")), 0);
	};
	let promptCalls = 0;
	let imageBatchCalls = 0;
	const original = w.fetch;
	w.fetch = async (input, init = {}) => {
		const path = new URL(String(input), "https://studio.test").pathname;
		if (path === "/api/pipeline-capabilities") return capabilities();
		if (path === "/api/session") return json({ success: true, authenticated: true, user: { username: "T", usertype: "free" }, remaining: {} });
		if (path === "/api/credits") return json({ success: true, plan: { id: "free", label: "Free", limits: { images: 50 } }, remaining: { images: 20 } });
		if (path === "/api/voiceover") {
			return new Response(new Uint8Array([255, 243, 1, 2, 3, 4]), {
				status: 200,
				headers: { "Content-Type": "audio/mpeg" }
			});
		}
		if (path === "/api/image-prompts") {
			promptCalls++;
			const body = JSON.parse(init.body || "{}");
			const batch = body.batch || { offset: 0, count: 3 };
			/* Seven failed stage attempts: the model returns no scene plan. */
			if (promptCalls <= 7) return json({ success: true, prompts: [], count: 0, expectedCount: batch.count });
			const prompts = Array.from({ length: batch.count }, (_, i) =>
				"Scene " + (batch.offset + i + 1) + " attempt " + promptCalls + " opening. " +
				"Scene " + (batch.offset + i + 1) + " middle detail. " +
				"Scene " + (batch.offset + i + 1) + " closing detail."
			);
			return json({ success: true, prompts, count: prompts.length, expectedCount: prompts.length, style: "Neon Night" });
		}
		if (path === "/api/image-batch") return imageBatchResponse(JSON.parse(init.body || "{}"), imageBatchCalls++);
		return original(input, init);
	};

	const row = w.addBatchRow({ script: "A short forest guide with calm morning light.", minutes: 1 });
	const scope = w.document.querySelector('[data-batch-row="' + row.id + '"]');
	const textarea = scope.querySelector('[data-batch-field="script"]');
	const finished = await w.runBatchRow(row);

	assert.equal(finished, true, "the eighth stage attempt proceeds through images and animation");
	assert.equal(w.batchRowFinished(row), true);
	assert.equal(row.stage, "done");
	assert.equal(row.error, "");
	assert.equal(scope.querySelector('[data-batch-field="script"]'), textarea, "the script textarea is never replaced");
	const status = scope.querySelector('[data-batch-slot="status"]').textContent;
	assert.doesNotMatch(status, /failed|failure|error|retry|attempt|⚠/i);

	const stageLog = (w.__BATCH_PIPELINE_RETRY_LOG || []).filter((entry) => entry.stage === "prompts");
	assert.equal(stageLog.filter((entry) => entry.event === "attempt").length, 8, "one initial attempt plus seven client retries");
	assert.equal(stageLog.filter((entry) => entry.event === "backoff").length, 7, "one backoff before each retry");
	assert.ok(stageLog.filter((entry) => entry.event === "backoff").every((entry) => entry.delayMs === 0));
	assert.equal(stageLog.filter((entry) => entry.event === "success").length, 1);
	assert.equal(stageLog[0].owner, "browser");
	assert.equal(stageLog[0].layout, "quick-batch-table");
	assert.ok(promptCalls >= 9, "the successful stage requested the 12-scene plan");
	assert.equal((row.images || []).length, 12, "the row proceeded into the fixed 12-scene image pipeline");
	assert.equal((row.slides || []).length, 12, "the row proceeded into animation");
});

test("an exhausted Quick Batch stage ladder stays silent and keeps the row runnable", async (t) => {
	const { w } = harness();
	t.after(() => w.close());
	fastPipelineRetries(w);
	let promptCalls = 0;
	const original = w.fetch;
	w.fetch = async (input, init = {}) => {
		const path = new URL(String(input), "https://studio.test").pathname;
		if (path === "/api/pipeline-capabilities") return capabilities();
		if (path === "/api/session") return json({ success: true, authenticated: true, user: { username: "T", usertype: "free" }, remaining: {} });
		if (path === "/api/credits") return json({ success: true, plan: { id: "free", label: "Free", limits: { images: 50 } }, remaining: { images: 20 } });
		if (path === "/api/voiceover") return new Response(new Uint8Array([255, 243, 1, 2]), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
		if (path === "/api/image-prompts") {
			promptCalls++;
			return json({ success: true, prompts: [], count: 0, expectedCount: 3 });
		}
		return original(input, init);
	};

	const row = w.addBatchRow({ script: "A short forest guide with calm morning light.", minutes: 1 });
	await w.runBatchRow(row);
	const scope = w.document.querySelector('[data-batch-row="' + row.id + '"]');
	assert.equal(promptCalls, 8, "one initial attempt plus seven retries");
	assert.equal(row.error, "");
	assert.equal(row.stage, "ready");
	assert.equal(w.batchRowPending(row), true);
	assert.doesNotMatch(scope.querySelector('[data-batch-slot="status"]').textContent, /failed|failure|error|retry|attempt|⚠/i);
	assert.equal(scope.querySelector('[data-batch-field="script"]').value, row.script);
});
