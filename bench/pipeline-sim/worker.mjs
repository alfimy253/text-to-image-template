/*
 * THE SIMULATED WORKER: the REAL src/index.ts router, wrapped.
 *
 * Everything the browser talks to is the shipped Worker code — routing,
 * capability negotiation, the note layer, the script event loop, the scene
 * planner, the media routes, the voiceover route. This file only supplies the
 * bindings a real deployment would have (an AI binding, a Pixabay key, a
 * provider network) and measures the traffic that crosses the boundary.
 *
 * Deliberately absent: KV. With no KV binding the credit gates open
 * (`PIXABAY_ALLOW_UNMETERED`) and the script notes use the isolate's in-process
 * mirror, which session 277 made authoritative for memory-only runtimes. That
 * keeps the measurement on pipeline structure (retries, round trips, queues)
 * instead of on KV latency, and it is the same in every build being compared.
 */
import workerModule from "../../src/index.ts";
import { resetScriptEventLoop, SCRIPT_LOOP_DEFAULT_CONCURRENCY, scriptEventLoop } from "../../src/modules/script-event-loop.ts";

const worker = workerModule.default || workerModule;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms > 0 ? ms : 0));

export function createWorkerSim(options = {}) {
	const ai = options.ai;
	const provider = options.provider;
	const netMs = Number(options.netMs) >= 0 ? Number(options.netMs) : 60;
	const directMedia = options.directMedia !== false;
	/*
	 * The worker's own default (SCRIPT_LOOP_DEFAULT_CONCURRENCY, three lanes
	 * since session 279) is what a real deployment runs, so the simulation must
	 * not quietly pin a different number: --loop-concurrency still overrides it.
	 */
	const concurrency = Number(options.loopConcurrency) > 0 ? Number(options.loopConcurrency) : SCRIPT_LOOP_DEFAULT_CONCURRENCY;
	const maxQueue = Number(options.loopMaxQueue) > 0 ? Number(options.loopMaxQueue) : 24;

	/* One isolate = one event loop, shared by every simulated user. */
	resetScriptEventLoop();
	const loop = scriptEventLoop({ concurrency, maxQueue });

	const env = {
		AI: ai.env.AI,
		PIXABAY_API_KEY: options.pixabayKey || "sim-pixabay-key",
		/* RULE 35: no KV binding, script notes live in browser localStorage + cookie
		   and this Worker keeps only an ephemeral isolate-memory copy. */
		PIXABAY_ALLOW_UNMETERED: "true"
	};
	if (!directMedia) env.PIXABAY_BROWSER_FETCH = "off";

	const background = [];
	const requests = [];
	const nativeFetch = globalThis.fetch;

	/* The Worker's own outbound fetch is the provider simulation. */
	globalThis.fetch = provider.fetch;

	async function fetchSim(request, meta = {}) {
		const startedAt = Date.now();
		const url = new URL(String(request.url), "https://studio.test");
		const entry = {
			at: startedAt,
			user: meta.user || "?",
			video: meta.video === undefined ? null : meta.video,
			method: request.method,
			path: url.pathname + (url.search || ""),
			status: 0,
			ms: 0
		};
		requests.push(entry);
		/* Half the round trip each way: the browser pays this too. */
		await sleep(netMs / 2);
		let response;
		try {
			response = await worker.fetch(request, env, {
				waitUntil: (task) => { background.push(Promise.resolve(task).catch(() => {})); },
				passThroughOnException: () => {}
			});
		} catch (error) {
			entry.status = 0;
			entry.ms = Date.now() - startedAt;
			entry.error = String((error && error.message) || error).slice(0, 200);
			throw error;
		}
		await sleep(netMs / 2);
		entry.status = response.status;
		entry.ms = Date.now() - startedAt;
		return response;
	}

	return {
		env,
		loop,
		loopConcurrency: concurrency,
		requests,
		fetch: fetchSim,
		/* Provider-side counters (searches, downloads, failures). */
		providerStats: () => provider.stats,
		aiStats: () => ai.stats,
		loopStats: () => (typeof loop.stats === "function" ? loop.stats() : {}),
		async drain() {
			await Promise.allSettled(background.splice(0, background.length));
		},
		close() {
			globalThis.fetch = nativeFetch;
			try { loop.close(); } catch { /* already closed */ }
			resetScriptEventLoop();
		},
		countPath(match) {
			const test = typeof match === "function" ? match : (entry) => entry.path.startsWith(match);
			return requests.filter(test).length;
		}
	};
}
