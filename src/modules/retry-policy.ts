/*
 * PIPELINE RETRY POLICY — THE ONE SOURCE OF TRUTH.
 *
 * Every retry number the studio shows or uses for a PIPELINE STEP lives in
 * this file. The browser ladder (`src/client/app-js.ts` injects
 * `PIPELINE_RETRY_POLICY` into the page script) and the Worker
 * (`/api/capabilities` advertises the same object) both read it, so the page,
 * the API and the documentation can no longer drift apart.
 *
 * WHAT A "PIPELINE STEP" IS
 *   One paid/awaited unit of work the user watches: planning the SEO keyword
 *   sets, writing the script, planning the scene prompts, importing photos and
 *   clips, speaking the voiceover, animating/rendering the video.
 *
 * RETRY CONTRACT (RULE, 2026-11-20)
 *   - maxRetries:  30   (one initial attempt + thirty retries = 31 attempts)
 *   - backoffMs:   20 s (the wait BEFORE every retry, not exponential)
 *   - owner:       the browser. The page owns the step ladder in BOTH layouts,
 *                  so a step can survive a slow, overloaded or wedged Worker.
 *
 * The Worker keeps its OWN, SMALLER, IN-REQUEST ladders. They are a fast first
 * line of defence inside one HTTP request, not a second pipeline ladder: a
 * single request cannot survive 30 x 20 s (600 s) of waiting, so the big
 * ladder has to live in the browser. Their current numbers are in their own
 * modules and are listed here for reference only:
 *
 *   - SEO plan          `script-seo.ts`   SEO_PLAN_TRANSPORT_ATTEMPTS = 2 per
 *                      model, 400 ms x attempt; 3 validation attempts per
 *                      model; one fallback model (worst case 12 model calls).
 *   - Script writing    `script-seo.ts`   one inference per request in the
 *                      browser-owned path (planner/writer limits = 1); the
 *                      legacy path keeps 3 planner + 3 writer attempts.
 *   - Scene prompts     `image-prompts.ts` IMAGE_PROMPT_ATTEMPTS = 3,
 *   exponential 400 ms, inside IMAGE_PROMPT_TOTAL_BUDGET_MS.
 *   - Photos/clips      `image-batch.ts`  IMAGE_OVERLOAD_ATTEMPTS = 4 on
 *                      load shedding / 2 otherwise, exponential
 *                      800 ms .. 20 s inside IMAGE_RETRY_BUDGET_MS (45 s).
 *   - Voiceover         `voiceover.ts`    VOICEOVER_CHUNK_ATTEMPTS = 3 per
 *                      chunk, 400 ms x attempt, then fallback models.
 *   - Relay failover    `api-relay.ts`    maxAttempts = 3 endpoints, no wait,
 *                      180 s chain budget.
 */

/** Retries after the initial attempt, for every pipeline step. */
export const PIPELINE_RETRY_MAX = 30;

/** Wait before every retry, in milliseconds (flat, not exponential). */
export const PIPELINE_RETRY_BACKOFF_MS = 20_000;

/** Attempts in total: the first try plus every retry. */
export const PIPELINE_RETRY_TOTAL_ATTEMPTS = PIPELINE_RETRY_MAX + 1;

export type PipelineRetryOwner = "browser" | "worker";

export interface PipelineRetryStagePolicy {
	/** Retries after the initial attempt. */
	maxRetries: number;
	/** Total attempts (`maxRetries + 1`). */
	maxAttempts: number;
	/** Flat wait before every retry. */
	backoffMs: number;
	/** Which side runs the ladder for this step. */
	owner: PipelineRetryOwner;
	/** Where the step runs, for the capabilities payload. */
	layout: string;
}

function stage(layout: string, owner: PipelineRetryOwner = "browser"): PipelineRetryStagePolicy {
	return {
		maxRetries: PIPELINE_RETRY_MAX,
		maxAttempts: PIPELINE_RETRY_TOTAL_ATTEMPTS,
		backoffMs: PIPELINE_RETRY_BACKOFF_MS,
		owner,
		layout
	};
}

/*
 * Per-step entries. They all carry the same numbers today; keeping one entry
 * per step means a future change to one step is a one-line edit here, and the
 * browser and the Worker see it immediately.
 */
export const PIPELINE_RETRY_STAGES = {
	/** Step 1 — POST /api/seo-plan (editor walkthrough). */
	seoPlan: stage("editor-walkthrough"),
	/** Step 2 — POST /api/script (editor + quick batch). */
	scriptWrite: stage("editor+quick-batch"),
	/** Step 3 — photos and clips (Pixabay import, per item). */
	media: stage("editor+quick-batch"),
	/** Step 4 — POST /api/voiceover. */
	voiceover: stage("editor+quick-batch"),
	/** Quick Batch table: one failed non-media stage (prompts, voice, animate). */
	batchPipeline: stage("quick-batch-table"),
	/**
	 * Editor: re-run the image flow (scene plan + failed scenes) after a
	 * retryable stop. This is the ladder that owns scene-plan failures in the
	 * editor, because a plan and its images are one visible step there.
	 */
	imageFlow: stage("editor")
} as const;

export type PipelineRetryStageName = keyof typeof PIPELINE_RETRY_STAGES;

export const PIPELINE_RETRY_POLICY = {
	maxRetries: PIPELINE_RETRY_MAX,
	maxAttempts: PIPELINE_RETRY_TOTAL_ATTEMPTS,
	backoffMs: PIPELINE_RETRY_BACKOFF_MS,
	owner: "browser" as PipelineRetryOwner,
	stages: PIPELINE_RETRY_STAGES
};

/** The policy for one step; defaults to the pipeline-wide numbers. */
export function pipelineRetryPolicyFor(step: PipelineRetryStageName): PipelineRetryStagePolicy {
	return PIPELINE_RETRY_STAGES[step] || stage("pipeline");
}
