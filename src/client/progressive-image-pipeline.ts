/** Shared browser-only orchestration. No Worker timers, jobs, KV or video state. */
export const PROGRESSIVE_IMAGE_PIPELINE_JS = `
function imageSceneTarget(minutes) {
	return Number(minutes) <= 1 ? 10 : Number(minutes) <= 3 ? 14 : 20;
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
	async function requestNext(offset) {
		for (let attempt = 0; attempt < 3; attempt++) {
			check();
			try {
				const count = Math.min(3, total - offset);
				const result = await options.request({ offset, count, attempt,
					previous: prompts.slice(-4).map(function (p) { return p.slice(0, 160); }) });
				check();
				const seen = new Set(prompts);
				const batch = (Array.isArray(result) ? result : []).filter(function (p) {
					if (typeof p !== "string" || !p.trim() || seen.has(p)) return false;
					seen.add(p);
					return true;
				}).slice(0, count);
				if (!batch.length) throw new Error("The image-prompt model returned no new scene prompts");
				return batch;
			} catch (error) {
				check();
				if ((error && error.retryable === false) || attempt === 2) throw error;
				await new Promise(function (resolve) { setTimeout(resolve, 500 * (attempt + 1)); });
			}
		}
	}
	// Attach rejection handlers immediately to both concurrent operations.
	function settle(promise) {
		return Promise.resolve(promise).then(function (value) { return { value }; },
			function (error) { return { error }; });
	}
	if (!total) return prompts;
	let batch = await requestNext(0);
	while (batch && batch.length) {
		check();
		const offset = prompts.length;
		prompts.push.apply(prompts, batch);
		if (options.onPrompts) options.onPrompts(prompts.slice());
		// Only one render and one lookahead prompt request per video/row.
		const rendering = settle(options.render(batch, offset));
		const next = prompts.length < total ? settle(requestNext(prompts.length)) : Promise.resolve({ value: null });
		const rendered = await rendering;
		if (rendered.error) {
			renderFailure = rendered.error;
			if (options.cancelPrompts) options.cancelPrompts();
		}
		const requested = await next;
		check();
		if (rendered.error) throw rendered.error;
		// Already-started images are fully drained before a later prompt error surfaces.
		if (requested.error) throw requested.error;
		batch = requested.value;
	}
	return prompts;
}
`;
