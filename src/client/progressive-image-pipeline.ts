/** Shared browser-only orchestration. No Worker timers, jobs, KV or video state. */
export const PROGRESSIVE_IMAGE_PIPELINE_JS = `
/*
 * #275 — scene count from the SCRIPT WORD COUNT, identical to
 * sceneCountForScript() in src/modules/image-prompts.ts:
 *   <=130 words -> 6 scenes, <=240 -> 8, <=500 -> 10, longer -> 10.
 * The duration tier (10/14/20) is only a legacy ceiling; it never raises the
 * word-count total. Keeping one rule on both sides is what stops the browser
 * and the planner from planning different scene counts.
 */
var IMAGE_SCENE_WORD_BRACKETS = [[130, 6], [240, 8], [500, 10]];
var IMAGE_SCENE_COUNT_MIN = 4;
var IMAGE_SCENE_COUNT_MAX = 10;
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
	var words = imageScriptWordCount(script);
	var fromScript = IMAGE_SCENE_COUNT_MAX;
	for (var i = 0; i < IMAGE_SCENE_WORD_BRACKETS.length; i++) {
		if (words <= IMAGE_SCENE_WORD_BRACKETS[i][0]) { fromScript = IMAGE_SCENE_WORD_BRACKETS[i][1]; break; }
	}
	var m = Number(minutes);
	var fromMinutes = !isFinite(m) || m <= 1 ? 10 : m <= 3 ? 14 : 20;
	return Math.max(IMAGE_SCENE_COUNT_MIN, Math.min(fromScript, fromMinutes, IMAGE_SCENE_COUNT_MAX));
}
async function runProgressiveImagePipeline(options) {
	const prompts = [];
	let renderFailure = null;
	const total = Math.max(0, Math.min(20, options.total));
	function check() {
		if (renderFailure) throw renderFailure;
		if (options.isCancelled()) {
			const error = new Error("Image generation was cancelled");
			error.name = "AbortError";
			throw error;
		}
	}
	/* #263: a retry wait Stop can cut short, so a cancelled row never sleeps 15 s. */
	async function pause(ms) {
		const until = Date.now() + ms;
		for (;;) {
			check();
			const left = until - Date.now();
			if (left <= 0) return;
			await new Promise(function (resolve) { setTimeout(resolve, Math.min(250, left)); });
		}
	}
	async function requestNext(offset) {
		let lastError = null;
		/*
		 * #263: a prompt batch used to die after three ~500 ms retries (1.5 s of
		 * patience against a fleet that asks for seconds). Because the lookahead
		 * request runs while the previous 3 images render, one busy-fleet answer
		 * ended the whole video with exactly those 3 images.
		 * The retry count is unchanged (3 attempts, the batch.attempt 0-2 contract),
		 * but each wait is now the server's own Retry-After hint or exponential
		 * backoff with jitter (not 500 ms, 1000 ms), and a permanent answer
		 * (4xx that is not 429) is never retried.
		 */
		for (let attempt = 0; attempt < 3; attempt++) {
			check();
			try {
				/* Prompt batches stay small (3 scenes) so the LLM stays inside its token budget. */
				const count = Math.min(3, total - offset);
				const reqBatch = { offset, count, attempt,
					previous: prompts.slice(-4).map(function (p) { return p.slice(0, 160); }) };
				if (attempt > 0 && lastError && lastError.message) {
					reqBatch.previousError = String(lastError.message).slice(0, 200);
				}
				const result = await options.request(reqBatch);
				check();
				const seen = new Set(prompts);
				const batch = (Array.isArray(result) ? result : []).filter(function (p) {
					if (typeof p !== "string" || !p.trim() || seen.has(p)) return false;
					seen.add(p);
					return true;
				}).slice(0, count);
				if (!batch.length) {
					/*
					 * Duplicates/no-new-scenes is a model answer, not a load
					 * failure: retrying the same request would only return the
					 * same batch again. Mark it permanent so the pipeline keeps
					 * the images it already rendered and finishes immediately.
					 */
					const empty = new Error("The image-prompt model returned no new scene prompts");
					empty.retryable = false;
					throw empty;
				}
				return batch;
			} catch (error) {
				lastError = error;
				check();
				const status = error && Number(error.status);
				/* 429/408 are load answers: retry them, but never 400/401/403. */
				const permanent =
					(error && error.retryable === false) ||
					(status >= 400 && status < 500 && status !== 429 && status !== 408);
				if (permanent || attempt === 2) throw error;
				const hint = error && Number(error.retryAfterMs) > 0 ? Number(error.retryAfterMs) : 0;
				const backoff = Math.min(
					Math.max(hint, Math.round(800 * Math.pow(2, attempt) * (0.75 + Math.random() * 0.5))),
					15000
				);
				await pause(backoff);
			}
		}
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
