/** Shared browser-only orchestration. No Worker timers, jobs, KV or video state. */
export const PROGRESSIVE_IMAGE_PIPELINE_JS = `
/*
 * FINAL MEDIA CAP — every automatic video in either layout has exactly
 * 12 Pixabay scenes: FOUR video clips and EIGHT distinct photo images.
 * Script word count and duration never change this total. The browser-side
 * target matches sceneCountForScript() in src/modules/image-prompts.ts.
 */
var IMAGE_SCENE_MEDIA_TOTAL = 12;
var IMAGE_SCENE_VIDEO_COUNT = 4;
var IMAGE_SCENE_IMAGE_COUNT = 8;
var IMAGE_SCENE_COUNT_MIN = 12;
var IMAGE_SCENE_COUNT_MAX = 12;
/* Match the Worker's Unicode letter/number tokenization exactly, including
 * punctuation-separated words and ignoring emoji. Escapes survive the template. */
var IMAGE_WORD_PATTERN = /[\\p{L}\\p{N}][\\p{L}\\p{N}'’_-]*/gu;
function imageScriptWordCount(script) {
	var lines = String(script || "").split(String.fromCharCode(65279)).join("").split(String.fromCharCode(10));
	var kept = [];
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line || line.slice(0, 6).toUpperCase() === "WEBVTT") continue;
		if (line.indexOf("--" + ">") !== -1 || /^[0-9]+$/.test(line)) continue;
		kept.push(line);
	}
	var words = kept.join(" ").match(IMAGE_WORD_PATTERN);
	return words ? words.length : 0;
}
function imageSceneTarget(script, minutes) {
	/* Fixed for every script length and every duration: 4 videos + 8 images. */
	return IMAGE_SCENE_MEDIA_TOTAL;
}
async function runProgressiveImagePipeline(options) {
	const prompts = [];
	let renderFailure = null;
	const total = Math.max(0, Math.min(IMAGE_SCENE_MEDIA_TOTAL, Number(options.total) || IMAGE_SCENE_MEDIA_TOTAL));
	function check() {
		if (renderFailure) throw renderFailure;
		if (options.isCancelled()) {
			const error = new Error("Image generation was cancelled");
			error.name = "AbortError";
			throw error;
		}
	}
	/*
	 * SESSION 279: ONE REQUEST PER PROMPT BATCH.
	 *
	 * This function used to make three attempts (the batch.attempt 0-2
	 * contract) with 800·2^n jittered backoff, because a failed planner call
	 * answered with a single inference and #263 needed patience against a busy
	 * fleet. The ladder now lives where the failed reply is still in scope -
	 * handleGenerateImagePrompts runs up to IMAGE_PROMPT_ATTEMPTS planner
	 * calls inside IMAGE_PROMPT_TOTAL_BUDGET_MS, coaching each one with the
	 * previous error and shifting the temperature - so a retry no longer costs
	 * a round trip, a control-lane slot and up to 15 s of browser backoff.
	 *
	 * What is left here is not a retry ladder: the cancellation check, the two
	 * verdicts that decide whether the pipeline continues, and ONE load
	 * continuation (below).
	 *
	 * THE ONE EXCEPTION, AND WHY IT IS NOT A LADDER. A load verdict on the
	 * whole request (429/503/504 + Retry-After, or kind "overload") is the only
	 * failure nobody below can own: the worker's ladder already ran inside the
	 * request it just refused, and waiting it out in the worker would mean
	 * holding a request open - the exact thing 503 + Retry-After exists to
	 * prevent. So the page waits the wait the SERVER asked for, once per chunk,
	 * and asks that chunk again. It re-buys nothing (the chunk failed before any
	 * of its images was requested), Stop still lands inside the wait, and a
	 * second refusal is a verdict that ends the flow, where the flow-level
	 * scheduler - not this pipeline - decides what happens next. That is what
	 * keeps #263 fixed ("the video finished with 3 images") in BOTH layouts:
	 * Quick Batch has no flow scheduler, so without this a busy text fleet still
	 * ended a ten-scene row after its first chunk.
	 */
	const PROMPT_LOAD_CONTINUATIONS = Math.max(0, Math.floor(
		Number(options.promptContinuations === undefined ? 1 : options.promptContinuations)));
	const PROMPT_WAIT_MIN_MS = 400;
	const PROMPT_WAIT_MAX_MS = 30000;
	const PROMPT_WAIT_DEFAULT_MS = 800;
	const PROMPT_WAIT_SLICE_MS = 100;
	function isLoadVerdict(error) {
		if (!error || error.retryable === false) return false;
		if (Number(error.retryAfterMs) > 0) return true;
		if (String(error.kind || "") === "overload") return true;
		return [408, 429, 500, 502, 503, 504].indexOf(Number(error.status) || 0) >= 0;
	}
	function loadWaitMs(error) {
		const hint = Number(error && error.retryAfterMs) > 0 ? Number(error.retryAfterMs) : 0;
		return Math.round(Math.max(PROMPT_WAIT_MIN_MS,
			Math.min(PROMPT_WAIT_MAX_MS, hint || PROMPT_WAIT_DEFAULT_MS)));
	}
	/* Sliced so a Stop during the wait lands during the wait. */
	async function waitCancellable(ms) {
		let left = Math.max(0, Number(ms) || 0);
		while (left > 0) {
			check();
			const slice = Math.min(PROMPT_WAIT_SLICE_MS, left);
			await new Promise(function (resolve) { setTimeout(resolve, slice); });
			left -= slice;
		}
		check();
	}
	async function requestNext(offset) {
		check();
		/* Prompt batches stay small (3 scenes) so the LLM stays inside its token budget. */
		const count = Math.min(3, total - offset);
		const reqBatch = { offset, count, attempt: 0,
			previous: prompts.slice(-4).map(function (p) { return p.slice(0, 160); }) };
		let result = null;
		let continuations = PROMPT_LOAD_CONTINUATIONS;
		for (;;) {
			try {
				result = await options.request(reqBatch);
				break;
			} catch (error) {
				if (!continuations || !isLoadVerdict(error)) throw error;
				continuations -= 1;
				const wait = loadWaitMs(error);
				if (typeof console !== "undefined" && console.info) console.info("[prompts] load verdict; waiting the server hint", {
					offset: offset, waitMs: wait, remaining: continuations,
					status: Number(error && error.status) || 0, kind: String(error && error.kind || ""),
					error: String(error && error.message || error).slice(0, 200)
				});
				await waitCancellable(wait);
			}
		}
		check();
		const seen = new Set(prompts);
		const batch = (Array.isArray(result) ? result : []).filter(function (p) {
			if (typeof p !== "string" || !p.trim() || seen.has(p)) return false;
			seen.add(p);
			return true;
		}).slice(0, count);
		if (!batch.length) {
			/*
			 * Duplicates/no-new-scenes is a model answer, not a load failure:
			 * retrying the same request would only return the same batch again.
			 * Mark it permanent so the pipeline keeps the images it already
			 * rendered and finishes immediately.
			 */
			const empty = new Error("The image-prompt model returned no new scene prompts");
			empty.retryable = false;
			throw empty;
		}
		return batch;
	}
	// Attach rejection handlers immediately to both concurrent operations.
	function settle(promise) {
		return Promise.resolve(promise).then(function (value) { return { value }; },
			function (error) { return { error }; });
	}
	if (!total) return prompts;
	/*
	 * How many 3-scene chunks may be rendering at the same time.
	 *
	 * The default (1) is the historical, fully serialized contract: one
	 * chunk renders, the next prompt batch is requested while it does, and
	 * the next chunk only starts once the previous one is done. With three
	 * images per chunk that made a ten-scene row wait for its slowest image
	 * four times over, because the browser never had more than three
	 * image requests in flight.
	 *
	 * The studio opts into 2 when the Worker advertises \`imageChunks\`, so a
	 * row keeps up to six images in flight and no longer idles between
	 * chunks. Prompt batches still stay at three scenes (the server's
	 * \`batch.count <= 3\` contract), offsets still advance by the accepted
	 * count, retries still never re-render a paid batch, and every
	 * already-started image is still drained before an error surfaces.
	 */
	const parallel = Math.max(1, Math.min(4, Math.floor(Number(options.parallelRenders) || 1)));
	const rendering = [];
	async function drainRenders() {
		while (rendering.length) {
			const done = await rendering.shift();
			if (done.error && !renderFailure) {
				renderFailure = done.error;
				if (options.cancelPrompts) options.cancelPrompts();
			}
		}
	}
	let batch = await requestNext(0);
	while (batch && batch.length) {
		check();
		const offset = prompts.length;
		prompts.push.apply(prompts, batch);
		if (options.onPrompts) options.onPrompts(prompts.slice());
		rendering.push(settle(options.render(batch, offset)));
		const next = prompts.length < total ? settle(requestNext(prompts.length)) : Promise.resolve({ value: null });
		if (rendering.length >= parallel) {
			const finished = await rendering.shift();
			if (finished.error && !renderFailure) {
				renderFailure = finished.error;
				if (options.cancelPrompts) options.cancelPrompts();
			}
		}
		const requested = await next;
		if (renderFailure) {
			await drainRenders();
			throw renderFailure;
		}
		check();
		// Already-started images are fully drained before a later prompt error surfaces.
		if (requested.error) {
			await drainRenders();
			throw requested.error;
		}
		batch = requested.value;
	}
	await drainRenders();
	if (renderFailure) throw renderFailure;
	return prompts;
}
`;
