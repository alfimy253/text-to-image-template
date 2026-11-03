/*
 * ONE SIMULATED USER: a real jsdom window running the real page + APP_JS.
 *
 * The browser half of the measurement is not a model of the studio, it IS the
 * studio: `tests/studio-render-harness.mjs` boots src/page.ts + src/client/*
 * (including browser-offload, pixabay-direct and the progressive image
 * pipeline) with only the device edges stubbed (canvas, WebCodecs, media
 * elements). What this file adds is:
 *
 *   - a fetch that routes same-origin calls to the simulated Worker and
 *     provider hosts to the simulated provider (the browser-first media path
 *     talks to pixabay.com straight from the page, exactly as in production);
 *   - a stage sampler that records when each row moves writing -> voice ->
 *     prompts -> images -> animate -> done, which is where the per-stage
 *     numbers in the report come from;
 *   - the clicks a real user makes: type three topics, press the ✨ on each
 *     row, press ✦ Generate, then Export each finished row.
 */
import { harness } from "../../tests/studio-render-harness.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createUser(options) {
	const id = options.id;
	const workerSim = options.workerSim;
	const provider = options.provider;
	const topics = options.topics;
	const minutes = Number(options.minutes) || 1;
	const style = options.style || "Cinematic Film";
	const renderMs = Number(options.renderMs) || 0;
	const audioDecodeMs = Number(options.audioDecodeMs) || 40;
	const exportVideo = options.exportVideo !== false;

	const { w, warnings, stats } = harness({ clipDuration: 12 });
	const window_ = w;

	/* The harness joins console arguments with String(), which turns the
	 * pipeline's structured diagnostics into "[object Object]". Keep a second,
	 * serialised copy: the fallback and retry reasons in the report come from
	 * here. */
	const logs = [];
	function capture(level, args) {
		try {
			logs.push({
				level,
				text: args.map((value) => {
					if (value instanceof Error) return value.message;
					if (value && typeof value === "object") {
						try { return JSON.stringify(value); } catch { return String(value); }
					}
					return String(value);
				}).join(" ")
			});
		} catch { /* diagnostics are best effort */ }
	}
	for (const level of ["warn", "error", "info"]) {
		const original = w.console[level];
		w.console[level] = function (...args) { capture(level, args); return original.apply(w.console, args); };
	}

	/*
	 * Media elements: jsdom never loads anything, so a clip's metadata probe
	 * would always time out ("The clip took too long to load"). A real browser
	 * answers `loadedmetadata` once the blob URL is attached; that is all the
	 * probe waits for, and the harness already reports a fixed `duration`.
	 */
	const mediaProto = w.HTMLMediaElement.prototype;
	Object.defineProperty(mediaProto, "src", {
		configurable: true,
		get() { return this._src || ""; },
		set(value) {
			this._src = String(value || "");
			if (!this._src) return;
			setTimeout(() => {
				try {
					this.dispatchEvent(new w.Event("loadedmetadata"));
					this.dispatchEvent(new w.Event("loadeddata"));
					this.dispatchEvent(new w.Event("canplay"));
				} catch { /* detached element */ }
			}, 2);
		}
	});
	mediaProto.load = function () {
		if (!this._src) return;
		setTimeout(() => {
			try { this.dispatchEvent(new w.Event("loadedmetadata")); } catch { /* detached */ }
		}, 2);
	};

	/* A capable device: 8 cores / 8 GB keeps browser-offload's adaptive
	 * ceiling at 3 concurrent media jobs (the negotiated imageSlots still
	 * widen the image lane), and the tab stays visible. */
	Object.defineProperty(w.navigator, "hardwareConcurrency", { configurable: true, value: 8 });
	Object.defineProperty(w.navigator, "deviceMemory", { configurable: true, value: 8 });

	/* Real browsers decode the MP3 to measure it; jsdom has no AudioContext. */
	w.AudioContext = class {
		constructor() { this.state = "running"; this.sampleRate = 44100; }
		resume() { return Promise.resolve(); }
		close() { return Promise.resolve(); }
		decodeAudioData(bytes) {
			return new Promise((resolve) => {
				setTimeout(() => {
					const seconds = Math.max(1, (bytes && bytes.byteLength ? bytes.byteLength : 4000) / 4000);
					const length = Math.round(44100 * seconds);
					resolve({
						duration: seconds,
						length,
						sampleRate: 44100,
						numberOfChannels: 1,
						/* The exporter reads the PCM to build AudioData frames. */
						getChannelData: () => new Float32Array(length)
					});
				}, audioDecodeMs);
			});
		}
	};
	w.webkitAudioContext = w.AudioContext;

	const requests = [];
	/* The browser realm's AbortSignal is not Node's; keep the request usable
	 * either way (the simulation never presses Stop). */
	function buildRequest(url, method, init) {
		const base = {
			method,
			headers: (init && init.headers) || {},
			body: init && init.body ? init.body : undefined
		};
		try {
			return new Request(url, Object.assign({}, base, { signal: init && init.signal }));
		} catch {
			return new Request(url, base);
		}
	}
	w.fetch = async (input, init = {}) => {
		const raw = typeof input === "string" ? input : (input && input.url) || String(input);
		const url = new URL(raw, "https://studio.test");
		const isProvider = url.hostname === "pixabay.com" || url.hostname === "cdn.pixabay.com" ||
			url.hostname === "tts-api.netlify.app";
		const startedAt = Date.now();
		if (isProvider) {
			const response = await provider.fetch(url.toString(), init);
			requests.push({
				at: startedAt, ms: Date.now() - startedAt, user: id,
				method: (init && init.method) || "GET",
				path: url.hostname + url.pathname, status: response.status, transport: "provider"
			});
			return response;
		}
		const method = (init && init.method) || "GET";
		const request = buildRequest(url.toString(), method, init);
		const response = await workerSim.fetch(request, { user: id });
		requests.push({
			at: startedAt, ms: Date.now() - startedAt, user: id, method,
			path: url.pathname + url.search, status: response.status, transport: "worker"
		});
		return response;
	};

	await sleep(0);

	/* ------------------------------------------------------------- rows --- */

	/* The page seeds one blank row: start from a known table. */
	while (w.__BATCH_ROWS.length) w.removeBatchRow(w.__BATCH_ROWS[0].id);

	const rows = topics.map((topic) => w.addBatchRow({ script: topic, minutes, style }));
	const rowIds = rows.map((row) => row.id);

	const timeline = rowIds.map((rowId) => ({ rowId, samples: [], transitions: [] }));
	let sampling = false;
	let samplerTimer = null;

	function sample() {
		const now = Date.now();
		rowIds.forEach((rowId, index) => {
			const row = w.getBatchRow(rowId);
			if (!row) return;
			const entry = timeline[index];
			const state = {
				t: now,
				stage: row.stage,
				detail: String(row.detail || "").slice(0, 80),
				scriptChars: String(row.script || "").length,
				images: (row.images || []).length,
				prompts: (row.prompts || []).length,
				slides: (row.slides || []).length,
				error: String(row.error || "").slice(0, 120)
			};
			entry.samples.push(state);
			const last = entry.transitions[entry.transitions.length - 1];
			if (!last || last.stage !== state.stage || last.scriptChars === 0 && state.scriptChars > 0) {
				entry.transitions.push({ t: now, stage: state.stage, detail: state.detail, images: state.images });
			}
		});
	}

	function startSampling() {
		if (sampling) return;
		sampling = true;
		sample();
		samplerTimer = setInterval(sample, 10);
	}

	function stopSampling() {
		sampling = false;
		if (samplerTimer) clearInterval(samplerTimer);
		samplerTimer = null;
		sample();
	}

	async function waitFor(predicate, timeoutMs, label) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			let value = false;
			try { value = Boolean(predicate()); } catch { value = false; }
			if (value) return true;
			await sleep(10);
		}
		throw new Error("user " + id + " timed out waiting for " + (label || "condition") + " after " + timeoutMs + " ms");
	}

	const scriptTimeoutMs = Number(options.scriptTimeoutMs) || 600000;
	const mediaTimeoutMs = Number(options.mediaTimeoutMs) || 600000;

	async function writeScripts() {
		const startedAt = Date.now();
		/* A user presses the ✨ on each row in turn; the rows are independent,
		 * so all three script jobs are in flight together. */
		for (const rowId of rowIds) {
			const button = w.document.querySelector('[data-batch-generate="' + rowId + '"]');
			if (!button) throw new Error("user " + id + ": row " + rowId + " has no script button");
			button.click();
			await sleep(20);
		}
		/*
		 * A row that already has a VERDICT is not something to wait for: either
		 * the script landed, or the pipeline said why it did not. Waiting on a
		 * failed row is how this harness turned a `SCRIPT_NOTE_STALE` verdict
		 * into a 600 s timeout instead of a reported failure - the same mistake
		 * the page must not make, in the same place.
		 */
		await waitFor(
			() => rowIds.every((rowId) => {
				const row = w.getBatchRow(rowId);
				if (!row) return false;
				if (row.stage === "error") return true;
				return !row._scriptWriting && String(row.script || "").length > 60;
			}),
			scriptTimeoutMs,
			"three scripts"
		);
		return Date.now() - startedAt;
	}

	async function generateVideos() {
		const startedAt = Date.now();
		w.document.getElementById("batch-generate").click();
		await waitFor(
			() => rowIds.every((rowId) => {
				const row = w.getBatchRow(rowId);
				return row && (w.batchRowFinished(row) || row.stage === "error");
			}),
			mediaTimeoutMs,
			"three finished videos"
		);
		return Date.now() - startedAt;
	}

	/*
	 * The local encode is device-bound and identical in every build, so it is
	 * NOT part of the pipeline measurement: sampling stops before it, and the
	 * export is reported separately (jsdom orchestration + a modelled encode).
	 * Clicking Export still runs the real exporter, which is what caught the
	 * audio-buffer and clip-metadata gaps this harness had to fill.
	 */
	async function exportVideos() {
		if (!exportVideo) return 0;
		const startedAt = Date.now();
		for (const rowId of rowIds) {
			const button = w.document.querySelector('[data-batch-row="' + rowId + '"] [data-batch-slot="export"] button');
			if (button) button.click();
		}
		/* The device encodes locally: WebCodecs is stubbed, so the encode is
		 * modelled as a fixed per-video cost that no retry strategy changes. */
		await sleep(renderMs * rowIds.length);
		await sleep(50);
		return Date.now() - startedAt;
	}

	async function runSet() {
		startSampling();
		const setStartedAt = Date.now();
		const scriptsMs = await writeScripts();
		const scriptsReadyAt = Date.now();
		const mediaMs = await generateVideos();
		const mediaReadyAt = Date.now();
		stopSampling();
		const exportMs = await exportVideos();
		const finishedAt = Date.now();

		const videos = rowIds.map((rowId, index) => {
			const row = w.getBatchRow(rowId) || {};
			const entry = timeline[index];
			const stageMs = {};
			for (let step = 0; step < entry.transitions.length; step++) {
				const from = entry.transitions[step];
				const to = entry.transitions[step + 1];
				const key = from.stage;
				stageMs[key] = (stageMs[key] || 0) + ((to ? to.t : mediaReadyAt) - from.t);
			}
			return {
				rowId,
				topic: topics[index],
				finished: Boolean(w.batchRowFinished(row)),
				stage: row.stage,
				error: String(row.error || ""),
				scriptChars: String(row.script || "").length,
				scenes: (row.images || []).length,
				slides: (row.slides || []).length,
				rowMs: row.startedAt && row.finishedAt ? row.finishedAt - row.startedAt : null,
				stageMs,
				transitions: entry.transitions.map((transition) => ({
					at: transition.t - setStartedAt,
					stage: transition.stage,
					detail: transition.detail
				}))
			};
		});

		return {
			user: id,
			setStartedAt,
			scriptsMs,
			scriptsReadyAt: scriptsReadyAt - setStartedAt,
			mediaMs,
			mediaReadyAt: mediaReadyAt - setStartedAt,
			exportMs,
			totalMs: finishedAt - setStartedAt,
			videos,
			requests: requests.filter((entry) => entry.transport === "worker"),
			providerRequests: requests.filter((entry) => entry.transport === "provider"),
			warnings: warnings.slice(0, 40),
			logs: logs.filter((entry) => entry.level !== "info").slice(-60),
			directMedia: directDebug(),
			renderStats: stats()
		};
	}

	function directDebug() {
		try {
			const debug = w.studioPixabayDebug ? w.studioPixabayDebug() : null;
			if (!debug) return null;
			return { counters: debug.counters || null, events: (debug.events || []).slice(-25) };
		} catch { return null; }
	}

	return {
		id,
		window: window_,
		rowIds,
		runSet,
		close() {
			stopSampling();
			try { w.close(); } catch { /* already closed */ }
		}
	};
}
