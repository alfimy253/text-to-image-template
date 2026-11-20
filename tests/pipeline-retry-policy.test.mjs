/*
 * PIPELINE RETRY POLICY — CODE IS THE ONLY SOURCE OF TRUTH.
 *
 * The editor and the Quick Batch table run the same six pipeline steps:
 * SEO planning, script writing, scene prompts, photos/clips, voiceover and
 * the render. Every one of them is retried by the browser 30 times, 20 s
 * apart, and every number lives in `src/modules/retry-policy.ts`:
 *
 *   - the page script is BUILT with the same object (APP_JS contains it),
 *   - /api/pipeline-capabilities ADVERTISES the same object,
 *   - nothing else in the codebase hardcodes a retry limit or backoff.
 */
import assert from "node:assert/strict";
import test from "node:test";
import workerd from "../src/index.ts";
import { APP_JS } from "../src/client/app-js.ts";
import {
	PIPELINE_RETRY_MAX,
	PIPELINE_RETRY_BACKOFF_MS,
	PIPELINE_RETRY_TOTAL_ATTEMPTS,
	PIPELINE_RETRY_STAGES,
	pipelineRetryPolicyFor
} from "../src/modules/retry-policy.ts";
import { SCRIPT_BROWSER_RETRY_LIMIT, SCRIPT_BROWSER_RETRY_BACKOFF_MS } from "../src/modules/script-seo.ts";

const worker = workerd.default || workerd;
const STEPS = ["seoPlan", "scriptWrite", "media", "voiceover", "batchPipeline", "imageFlow"];

test("every pipeline step is 30 retries / 20 s in one code table", () => {
	assert.equal(PIPELINE_RETRY_MAX, 30);
	assert.equal(PIPELINE_RETRY_BACKOFF_MS, 20000);
	assert.equal(PIPELINE_RETRY_TOTAL_ATTEMPTS, 31);
	for (const step of STEPS) {
		const policy = pipelineRetryPolicyFor(step);
		assert.equal(policy.maxRetries, 30, step + " retries");
		assert.equal(policy.maxAttempts, 31, step + " attempts");
		assert.equal(policy.backoffMs, 20000, step + " backoff");
		assert.equal(policy.owner, "browser", step + " owner");
	}
	assert.equal(PIPELINE_RETRY_STAGES.batchPipeline.maxRetries, 30);
	assert.equal(PIPELINE_RETRY_STAGES.imageFlow.maxRetries, 30);
});

test("the page script is built from the code table, not from prose", () => {
	/* The injected object carries the live numbers. */
	assert.match(APP_JS, /const PIPELINE_RETRY = \{/);
	assert.match(APP_JS, /"maxRetries":30/);
	assert.match(APP_JS, /"backoffMs":20000/);
	assert.match(APP_JS, /"seoPlan":\{"maxRetries":30/);

	/* The ladders read their numbers from it. */
	assert.match(APP_JS, /const SEO_PLAN_MAX_RETRIES = PIPELINE_RETRY\.stages\.seoPlan\.maxRetries/);
	assert.match(APP_JS, /const SEO_PLAN_RETRY_BACKOFF_MS = PIPELINE_RETRY\.stages\.seoPlan\.backoffMs/);
	assert.match(APP_JS, /const SCRIPT_WRITE_MAX_RETRIES = PIPELINE_RETRY\.stages\.scriptWrite\.maxRetries/);
	assert.match(APP_JS, /const BATCH_PIPELINE_MAX_RETRIES = PIPELINE_RETRY\.stages\.batchPipeline\.maxRetries/);
	assert.match(APP_JS, /const MEDIA_ITEM_MAX_RETRIES = PIPELINE_RETRY\.stages\.media\.maxRetries/);
	assert.match(APP_JS, /const VOICE_MAX_RETRIES = PIPELINE_RETRY\.stages\.voiceover\.maxRetries/);

	/* No step ladder may fall back to a hand-written limit again. */
	assert.doesNotMatch(APP_JS, /MEDIA_ITEM_MAX_RETRIES = 7/);
	assert.doesNotMatch(APP_JS, /BATCH_PIPELINE_MAX_RETRIES = 7/);
	assert.doesNotMatch(APP_JS, /SCRIPT_WRITE_MAX_RETRIES = 7/);
	assert.doesNotMatch(APP_JS, /RETRY_BACKOFF_MS = 40000/);
});

test("/api/pipeline-capabilities advertises the same code table", async () => {
	const response = await worker.fetch(
		new Request("https://studio.test/api/pipeline-capabilities"),
		{},
		{}
	);
	const caps = await response.json();

	assert.equal(caps.browserScriptRetries, PIPELINE_RETRY_STAGES.scriptWrite.maxRetries);
	assert.equal(caps.scriptRetryBackoffMs, PIPELINE_RETRY_STAGES.scriptWrite.backoffMs);
	assert.equal(caps.seoPlanRetries, PIPELINE_RETRY_STAGES.seoPlan.maxRetries);
	assert.equal(caps.seoPlanRetryBackoffMs, PIPELINE_RETRY_STAGES.seoPlan.backoffMs);
	assert.equal(caps.batchPipelineRetries, PIPELINE_RETRY_STAGES.batchPipeline.maxRetries);
	assert.equal(caps.batchPipelineRetryBackoffMs, PIPELINE_RETRY_STAGES.batchPipeline.backoffMs);
	assert.equal(caps.quickBatchPipelineRetries, PIPELINE_RETRY_STAGES.batchPipeline.maxRetries);
	assert.equal(caps.mediaItemRetries, PIPELINE_RETRY_STAGES.media.maxRetries);
	assert.equal(caps.mediaItemRetryBackoffMs, PIPELINE_RETRY_STAGES.media.backoffMs);
	assert.equal(caps.editorVoiceRetries, PIPELINE_RETRY_STAGES.voiceover.maxRetries);
	assert.equal(caps.editorVoiceRetryBackoffMs, PIPELINE_RETRY_STAGES.voiceover.backoffMs);
	assert.equal(caps.pipelineRetryPolicy.maxRetries, 30);
	assert.equal(caps.pipelineRetryPolicy.backoffMs, 20000);
	assert.equal(caps.pipelineRetryPolicy.stages.media.maxRetries, 30);

	/* The worker-side script constant reads the same table. */
	assert.equal(SCRIPT_BROWSER_RETRY_LIMIT, PIPELINE_RETRY_MAX);
	assert.equal(SCRIPT_BROWSER_RETRY_BACKOFF_MS, PIPELINE_RETRY_BACKOFF_MS);
});
