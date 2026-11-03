/** #261: feature-detected browser runtime. No local/session storage or provider secrets. */
export const BROWSER_OFFLOAD_JS = String.raw`
function createStudioOffloadRuntime(win) {
	var nav = win.navigator || {}, queue = [], active = 0, mediaActive = 0, controlActive = 0, epoch = 0;
	var capabilitiesPromise = null, capabilitiesRetryAt = 0, retainedBytes = 0, urls = new Map(), controllers = new Set();
	var channel = null, peers = new Map(), pumpTimer = null, sequence = 0;
	/* Server-load backoff (bug fix #262): no media fan-out until this timestamp. */
	var backoffUntil = 0, backoffMs = 0;
	var tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);
	var sleep = function (ms) { return new Promise(function (resolve) { win.setTimeout(resolve, ms); }); };
	function noteBackoff(ms) {
		var wait = Number(ms); if (!(wait > 0)) return 0;
		/* Cap at 20 s: a stale hint must never freeze the studio. */
		wait = Math.min(20000, Math.round(wait));
		backoffUntil = Math.max(backoffUntil, Date.now() + wait); backoffMs = wait;
		/* #263: wake at least every 250 ms so Stop can reject queued media. */
		if (queue.length && !pumpTimer) pumpTimer = win.setTimeout(pump, Math.min(wait, 250));
		return wait;
	}
	function backoffRemaining() { var left = backoffUntil - Date.now(); return left > 0 ? left : 0; }
	function abortError() { var e = new Error("Generation was cancelled"); e.name = "AbortError"; return e; }
	function check(options, startEpoch) {
		if ((startEpoch !== undefined && startEpoch !== epoch) ||
			(options && ((options.isCancelled && options.isCancelled()) || (options.signal && options.signal.aborted)))) throw abortError();
	}
	function limits() {
		var memory = Number(nav.deviceMemory) || 4, cores = Number(nav.hardwareConcurrency) || 4;
		var limit = memory <= 2 || cores <= 2 ? 1 : memory <= 4 || cores <= 4 ? 2 : 3;
		var doc = win.document;
		if ((doc && doc.hidden) || retainedBytes > Math.min(192, memory * 24) * 1024 * 1024) limit = 1;
		return limit;
	}
	/*
	 * How many concurrent jobs this particular job may run alongside.
	 *
	 * Default: limits(). A caller that negotiated a wider media ceiling
	 * (the studio asks the Worker how many image requests a tab may keep in
	 * flight) passes options.slots; it is clamped to 1..8 and can never go
	 * below the adaptive limit for a backgrounded tab or a loaded device.
	 */
	function jobCeiling(options) {
		var base = limits();
		var asked = Number(options && options.slots);
		if (!(asked > 0)) return base;
		if (base === 1) return 1;
		return Math.min(8, Math.max(base, Math.floor(asked)));
	}
	async function timedFetch(url, init, timeout, options, consume) {
		var controller = typeof win.AbortController === "function" ? new win.AbortController() : null;
		var timer, cancelTimer, expired = false, abortHandler;
		var started = epoch;
		check(options, started);
		if (controller) controllers.add(controller);
		try {
			var deadline = new Promise(function (_, reject) {
				timer = win.setTimeout(function () {
					expired = true;
					if (controller) controller.abort();
					var error = new Error("Generation request timed out"); error.name = "TimeoutError"; reject(error);
				}, timeout);
			});
			var cancellation = new Promise(function (_, reject) {
				abortHandler = function () { if (controller) controller.abort(); reject(abortError()); };
				if (options && options.signal && options.signal.addEventListener) options.signal.addEventListener("abort", abortHandler, { once: true });
				function watch() {
					try { check(options, started); } catch (error) { if (controller) controller.abort(); reject(error); return; }
					cancelTimer = win.setTimeout(watch, 100);
				}
				watch();
			});
			var work = (async function () {
				var response = await win.fetch(url, Object.assign({ credentials: "same-origin" }, init,
					controller ? { signal: controller.signal } : {}));
				var result = consume ? await consume(response) : response;
				check(options, started);
				return result;
			})();
			return await Promise.race([work, deadline, cancellation]);
		} catch (error) {
			check(options, started);
			if (expired || (error && /abort|signal/i.test(error.message || ""))) {
				var normalized = new Error(expired ? "Generation request timed out" : "Generation request was interrupted");
				normalized.name = "TimeoutError"; throw normalized;
			}
			throw error;
		} finally {
			win.clearTimeout(timer); win.clearTimeout(cancelTimer);
			if (controller) controllers.delete(controller);
			if (abortHandler && options && options.signal) options.signal.removeEventListener("abort", abortHandler);
		}
	}
	/*
	 * Capability negotiation (bug fix: one transport hiccup used to pin the
	 * whole tab to the slow legacy path).
	 *
	 * A definitive answer - an HTTP response that is not the 261 contract
	 * (old server, 404, wrong shape) - is cached for the session, exactly as
	 * before, so an old Worker is asked once and never again.
	 *
	 * A *failed probe* is not an answer. The first call happens while the
	 * page is still booting and was given 5 s; a cold start, a flaky mobile
	 * connection or a proxy hiccup made it reject, the empty object was
	 * cached forever, and every image/script/voiceover request in that tab
	 * silently fell back to the legacy base64 + NDJSON path - several times
	 * slower than the binary path it should have used. Now a failed probe is
	 * dropped (with a 3 s guard so a burst of callers cannot stampede the
	 * route) and the next call negotiates again.
	 */
	function capabilities() {
		if (capabilitiesPromise) return capabilitiesPromise;
		if (capabilitiesRetryAt > Date.now()) return Promise.resolve({});
		var request = timedFetch("/api/pipeline-capabilities", {}, 8000, null,
			async function (r) { return r.ok ? r.json() : {}; }).then(function (caps) {
				if (caps && caps.version === 261) return caps;
				/* Definitive: this Worker does not speak 261. Keep it. */
				return {};
			});
		capabilitiesPromise = request.then(null, function () {
			capabilitiesPromise = null;
			capabilitiesRetryAt = Date.now() + 3000;
			return {};
		});
		return capabilitiesPromise;
	}
	function getChannel() {
		if (channel || typeof win.BroadcastChannel !== "function") return channel;
		try {
			channel = new win.BroadcastChannel("yvs-generation-261");
			channel.onmessage = function (event) {
				var m = event.data, now = Date.now();
				if (!m || m.version !== 261) return;
				if (m.type === "hello") {
					peers.forEach(function (p) { if (p.id.indexOf(tabId + "-") === 0) { try { channel.postMessage(p); } catch (_) {} } });
					return;
				}
				if (typeof m.id !== "string" || m.id.length > 120) return;
				if (m.type === "release") { peers.delete(m.id); return; }
				if (m.type !== "claim" || ["control", "media"].indexOf(m.kind) < 0 || !Number.isFinite(m.created) || !Number.isFinite(m.expires) ||
					m.expires < now || m.expires > now + 12000 || (peers.size >= 100 && !peers.has(m.id))) return;
				peers.set(m.id, m);
			};
			channel.postMessage({ version: 261, type: "hello" });
		} catch (_) { channel = null; }
		return channel;
	}
	async function coordinated(work, options, started) {
		var kind = options.kind === "control" ? "control" : options.kind === "image" ? "image" : "media";
		/* Image requests get the wider image ceiling; everything else keeps limits(). */
		var slots = kind === "control" ? 1 : jobCeiling(options);
		check(options, started);
		// Web Locks are authoritative between cooperating same-origin tabs. No persistent state.
		if (nav.locks && typeof nav.locks.request === "function") {
			try {
				for (;;) {
					check(options, started);
					for (var slot = 0; slot < slots; slot++) {
						var acquired = await nav.locks.request("yvs-generation-261-" + kind + "-" + slot,
							{ ifAvailable: true }, async function (lock) {
								if (!lock) return null;
								check(options, started);
								// Wrap work errors: never mistake them for unavailable Web Locks and replay it.
								try { return { ok: true, value: await work() }; } catch (error) { return { ok: false, error: error }; }
							});
						if (acquired) {
							if (!acquired.ok) throw { workError: acquired.error };
							return acquired.value;
						}
					}
					await sleep(100);
				}
			} catch (error) {
				if (error && Object.prototype.hasOwnProperty.call(error, "workError")) throw error.workError;
				check(options, started);
				// SecurityError/unsupported implementation: use advisory leases below.
			}
		}
		var bc = getChannel();
		if (!bc) { check(options, started); return work(); }
		var id = tabId + "-" + (++sequence), created = Date.now(), renewal, finished = false;
		function renew() {
			if (finished) return;
			var claim = { version: 261, type: "claim", kind: kind, id: id, created: created, expires: Date.now() + 8000 };
			peers.set(id, claim);
			try { bc.postMessage(claim); } catch (_) {}
			renewal = win.setTimeout(renew, 2000);
		}
		renew();
		try {
			await sleep(80); // Allow simultaneous tabs to exchange their claims.
			for (;;) {
				check(options, started);
				var now = Date.now();
				peers.forEach(function (p, key) { if (p.expires <= now) peers.delete(key); });
				var ordered = Array.from(peers.values()).filter(function (p) { return p.kind === kind; }).sort(function (a, b) {
					return a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
				});
				if (!ordered.length || ordered[0].id === id) return await work();
				await sleep(100);
			}
		} finally {
			finished = true; win.clearTimeout(renewal); peers.delete(id);
			try { bc.postMessage({ version: 261, type: "release", id: id }); } catch (_) {}
		}
	}
	function pump() {
		if (pumpTimer) win.clearTimeout(pumpTimer);
		pumpTimer = null;
		for (var i = queue.length - 1; i >= 0; i--) {
			try { check(queue[i].options, queue[i].epoch); }
			catch (error) { queue.splice(i, 1)[0].reject(error); }
		}
		queue.sort(function (a, b) {
			var now = Date.now();
			return ((b.options.priority ? b.options.priority() : 0) + (now - b.created) / 5000) -
				((a.options.priority ? a.options.priority() : 0) + (now - a.created) / 5000);
		});
		while (queue.length) {
			// Reserve an independent text/control slot so three held images cannot block prompt lookahead.
			var held = backoffRemaining();
			var admitted = queue.findIndex(function (job) {
				if (job.options.kind === "control") return controlActive < 1;
				/* Server asked us to wait: keep media jobs queued, not in flight. */
				if (held > 0) return false;
				/*
				 * A job may ask for a wider ceiling than limits() when the
				 * Worker negotiated one (see images() below). Everything
				 * that does not ask keeps the documented 3 (or 1/2 on a
				 * smaller or backgrounded device).
				 */
				return mediaActive < jobCeiling(job.options);
			});
			if (admitted < 0) break;
			var item = queue.splice(admitted, 1)[0];
			try { check(item.options, item.epoch); } catch (error) { item.reject(error); continue; }
			active++;
			if (item.options.kind === "control") controlActive++; else mediaActive++;
			(function (job) {
				coordinated(job.work, job.options, job.epoch).then(job.resolve, job.reject).then(function () {
					active--;
					if (job.options.kind === "control") controlActive--; else mediaActive--;
					pump();
				});
			})(item);
		}
		if (queue.length && !pumpTimer) {
			var wait = backoffRemaining();
			/*
			 * #263: never sleep a whole Retry-After here. A 20 s hold with no
			 * re-check left a cancelled row looking "stuck generating"; polling
			 * every 250 ms only costs a timer while jobs are actually queued.
			 */
			pumpTimer = win.setTimeout(pump, wait > 0 ? Math.max(50, Math.min(wait, 250)) : 100);
		}
	}
	function schedule(work, options) {
		options = options || {};
		return new Promise(function (resolve, reject) {
			queue.push({ work: work, options: options, epoch: epoch, created: Date.now(), resolve: resolve, reject: reject });
			pump();
		});
	}
	function group(options) {
		options = options || {};
		var started = epoch, cancelled = false, controller = typeof win.AbortController === "function" ? new win.AbortController() : null;
		var owner = { abort: function () { cancelled = true; if (controller) controller.abort(); pump(); } };
		if (options.setController) options.setController(owner);
		return { owner: owner, options: Object.assign({}, options, { signal: controller && controller.signal,
			isCancelled: function () { return started !== epoch || cancelled || (options.isCancelled && options.isCancelled()); } }) };
	}
	async function responseError(response) {
		var data = await response.json().catch(function () { return {}; });
		var error = new Error(data.error || ("Generation failed (HTTP " + response.status + ")"));
		error.status = response.status;
		error.requestId = data && data.requestId ? String(data.requestId) : (response.headers && response.headers.get ? response.headers.get("X-Request-Id") : "");
		/* #262: server-declared load cooldown (header wins, JSON is the fallback). */
		var header = null;
		try { header = response.headers && response.headers.get ? response.headers.get("Retry-After") : null; } catch (_) { header = null; }
		var hint = Number(hintSeconds(header)) * 1000;
		if (!(hint > 0) && data && Number(data.retryAfterMs) > 0) hint = Number(data.retryAfterMs);
		error.retryAfterMs = hint > 0 ? hint : 0;
		error.kind = data && data.kind ? String(data.kind) : "";
		/*
		 * #274: 5xx and 429 are load answers and get bounded retries — unless
		 * the server explicitly declared the answer fatal (e.g. the Pixabay API
		 * key is not configured): retrying a permanent failure only delays the
		 * real error message the user needs to see.
		 */
		error.retryable = (response.status >= 500 || response.status === 429) && error.kind !== "fatal";
		/*
		 * SESSION 279: the verdict carries what the WORKER's ladder spent, so the
		 * page reports it ("failed after 4 attempts") instead of counting attempts
		 * of its own and re-asking. Additive: an older worker omits all three.
		 */
		error.attempts = Number(data && data.attempts) > 0 ? Number(data.attempts) : 0;
		error.retryOwner = data && data.retryOwner ? String(data.retryOwner) : "";
		error.budgetExhausted = Boolean(data && data.budgetExhausted);
		if (response.status === 503 && error.retryAfterMs > 0) noteBackoff(error.retryAfterMs);
		throw error;
	}
	function hintSeconds(value) { var n = Number(value); return n > 0 ? n : 0; }
	/*
	 * Browser-first media fetching (see src/client/pixabay-direct.ts).
	 *
	 * The page itself asks Pixabay for the scene and downloads the bytes; the
	 * Worker is only used for (a) the small config document, (b) one credit
	 * reservation per chunk and (c) the same-origin fallback for any scene the
	 * browser could not read (CORS refusal, provider error, blocked CDN).
	 *
	 * Accounting stays exact: the claim grants N units for this chunk, every
	 * browser-delivered scene keeps its unit, and the settle call refunds
	 * granted - delivered — including scenes that fell back to the Worker,
	 * which charges its own unit through the existing hooks.
	 */
	function directRuntime() {
		try { if (win.studioPixabayDirect && typeof win.studioPixabayDirect.scene === "function") return win.studioPixabayDirect; } catch (_) {}
		try { if (typeof studioPixabayDirect !== "undefined" && studioPixabayDirect && typeof studioPixabayDirect.scene === "function") return studioPixabayDirect; } catch (_) {}
		return null;
	}
	async function directBatchPlan(prompts, g) {
		var direct = directRuntime();
		if (!direct || !prompts.length) return null;
		var ready = false;
		try { ready = await direct.enabled(); } catch (_) { ready = false; }
		if (!ready) return null;
		check(g.options);
		var claim = null;
		try { claim = await direct.claim(prompts.length, { signal: g.options.signal }); }
		catch (error) {
			if (error && error.name === "AbortError") throw error;
			/* Quota/transport answers are enforced by the same-origin path too. */
			if (win.console && win.console.warn) win.console.warn("[studio-image] browser credit claim unavailable; using the same-origin path", { error: String(error && error.message || error).slice(0, 300) });
			return null;
		}
		if (!claim || Number(claim.granted) < prompts.length) {
			try { if (claim) await direct.settle(claim.claimId, 0); } catch (_) {}
			return null;
		}
		if (win.console && win.console.info) win.console.info("[studio-image] browser media claim granted", { requested: prompts.length, granted: claim.granted });
		return { runtime: direct, claim: claim, delivered: 0 };
	}
	async function images(prompts, frame, options) {
		options = options || {};
		/*
		 * options.slots: how many images this tab may keep in flight, as
		 * negotiated with the Worker (absent = the documented adaptive
		 * limit, 3 on a capable device). Each request is one small binary
		 * image, so a batch of ten no longer has to drain through a
		 * three-wide pipe while three batch rows are rendering at once.
		 */
		var slots = Number(options.slots) > 0 ? Number(options.slots) : 0;
		var g = group(options), results, directState = null;
		try {
			directState = await directBatchPlan(prompts, g);
			results = await Promise.all(prompts.map(function (prompt, index) {
				return schedule(async function () {
					var blob = null, directError = null, transport = "worker";
					if (directState) {
						try {
							var scene = await directState.runtime.scene(prompt, frame || {}, { signal: g.options.signal, isCancelled: g.options.isCancelled });
							check(g.options);
							if (!scene || !scene.blob || !scene.blob.size) throw new Error("Empty Pixabay scene");
							blob = scene.blob;
							blob.stockSource = scene.source || null;
							directState.delivered += 1;
							transport = "browser";
						} catch (error) {
							if (error && error.name === "AbortError") throw error;
							directError = error;
							/* One scene falls back; the rest of the batch keeps its transport. */
							if (win.console && win.console.warn) win.console.warn("[studio-image] browser Pixabay fetch fell back to the Worker", {
								sceneIndex: index, status: Number(error && error.status) || 0, kind: error && error.kind || "",
								retryable: Boolean(error && error.fallback !== false), error: String(error && error.message || error).slice(0, 300) });
						}
					}
					if (!blob) {
						try {
							blob = await timedFetch("/api/image", { method: "POST", headers: { "Content-Type": "application/json" },
								body: JSON.stringify(Object.assign({ prompt: prompt }, frame)) }, 165000, g.options, async function (response) {
									if (!response.ok) return responseError(response);
									var contentType = response.headers.get("Content-Type") || "";
									if (!/^(image\/(png|jpeg|webp)|video\/mp4)(;|$)/i.test(contentType)) throw new Error("Image response was not an image");
									var imageBlob = await response.blob();
									try { imageBlob.stockSource = JSON.parse(decodeURIComponent(response.headers.get("X-Pixabay-Source") || "%7B%7D")); } catch (_) {}
									return imageBlob;
								});
							check(g.options);
							if (!blob.size) throw new Error("Empty image response");
						} catch (error) {
							if (error && error.retryAfterMs > 0) noteBackoff(error.retryAfterMs);
							if (win.console && win.console.error) win.console.error("[studio-image] scene request failed", { sceneIndex: index, status: Number(error && error.status) || 0, kind: error && error.kind || "", retryable: error && error.retryable, retryAfterMs: Number(error && error.retryAfterMs) || 0, requestId: error && error.requestId || "", directError: directError ? String(directError.message || directError).slice(0, 200) : "", error: String(error && error.message || error).slice(0, 500) });
							if (options.onError) options.onError(error, index);
							return { ok: false, error: error, index: index, retryAfterMs: error && error.retryAfterMs || 0 };
						}
					}
					try {
						if (options.onImage) await options.onImage(blob, index);
					} catch (error) {
						if (options.onError) options.onError(error, index);
						return { ok: false, error: error, index: index };
					}
					if (win.console && win.console.info) win.console.info("[studio-image] scene delivered", { sceneIndex: index, bytes: blob.size, mediaType: blob.type, transport: transport, sourceId: blob.stockSource && blob.stockSource.id || null });
					return { ok: true, blob: blob, index: index, transport: transport };
				}, Object.assign({}, g.options, { kind: "image", slots: slots })).catch(function (error) { return { ok: false, error: error, index: index }; });
			}));
			check(g.options);
			return results;
		} finally {
			/* Refund whatever the browser did not deliver: failed scenes and
			 * scenes that were re-fetched through the Worker. */
			if (directState) {
				try { await directState.runtime.settle(directState.claim.claimId, directState.delivered); } catch (_) {}
			}
			if (options.clearController) options.clearController(g.owner);
		}
	}
	async function mediaResponse(url, init, options) {
		var g = group(options);
		try {
			return await schedule(function () { return timedFetch(url, init, 165000, g.options, async function (response) {
				if (response.ok) {
					var blob = await response.blob();
					return { ok: true, status: response.status, blob: async function () { return blob; } };
				}
				var data = await response.json().catch(function () { return {}; });
				return { ok: false, status: response.status, json: async function () { return data; } };
			}); }, g.options);
		} finally { if (options && options.clearController) options.clearController(g.owner); }
	}
	async function jsonRequest(url, init, timeout, options) {
		var g = group(Object.assign({}, options || {}, { kind: "control" }));
		try {
			return await schedule(function () { return timedFetch(url, init, timeout, g.options, async function (response) {
				var data = await response.json();
				return { ok: response.ok, status: response.status, json: async function () { return data; } };
			}); }, g.options);
		} finally { if (options && options.clearController) options.clearController(g.owner); }
	}
	/*
	 * #5: how long a script request may hold the tab is the CALLER's decision
	 * now (options.timeout). Async script jobs answer in milliseconds and the
	 * note keeps the work, so the studio asks for 20 s and retries instead of
	 * staring at one 105 s response. No option = the historical ceiling.
	 */
	function scriptRequest(init, options) {
		var timeout = Number(options && options.timeout);
		var path = (options && options.path) || "/api/script";
		return jsonRequest(path, init, timeout > 0 ? timeout : 105000, options);
	}

	function compactIdea(script, topic) {
		var text = String(script || "").slice(0, 40000).split(/\r?\n/).filter(function (line) {
			return line.trim() && !line.includes("-->") && !/^\s*(WEBVTT|\d+)\s*$/.test(line);
		}).join(" ").replace(/\s+/g, " ").trim();
		var sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) || [];
		var first = (sentences[0] || "").trim().slice(0, 220);
		var last = sentences.length > 1 ? sentences[sentences.length - 1].trim().slice(0, 220) : "";
		return first ? [first, last !== first ? last : ""].filter(Boolean).join(" ").slice(0, 480)
			: "The video explains " + String(topic || "my video").slice(0, 120) + ".";
	}
	/*
	 * SESSION 279 — THE BROWSER NO LONGER OWNS THE VOICEOVER LADDER.
	 *
	 * What lived here was the #261 offload: voiceChunks() split the script
	 * into <=400 char chunks, voiceover() fetched them ONE AT A TIME and
	 * restarted the WHOLE set up to three times (rotating voiceIndex), and
	 * assembleAudio() / assembleBlobs() joined the containers in a Web
	 * Worker. That is a second retry owner on top of the worker's own per-chunk
	 * ladder, it serialises chunks the worker can synthesise in parallel, and a
	 * restart re-buys chunks that already succeeded.
	 *
	 * The page now sends ONE full-text POST /api/voiceover; the worker splits,
	 * retries (3 attempts per chunk -> English fallback models -> validated
	 * external TTS), joins one homogeneous container and answers with the bytes
	 * inside a budget it owns (src/modules/voiceover.ts). The chunk: true
	 * endpoint itself is untouched, so a cached pre-279 page keeps working.
	 */
	function retainUrl(url, blob) { var size = Number(blob && blob.size) || 0; retainedBytes -= urls.get(url) || 0; urls.set(url, size); retainedBytes += size; return url; }
	function releaseUrl(url) { retainedBytes = Math.max(0, retainedBytes - (urls.get(url) || 0)); urls.delete(url); }
	function dispose() {
		epoch++; capabilitiesPromise = null; capabilitiesRetryAt = 0; backoffUntil = 0; backoffMs = 0;
		controllers.forEach(function (c) { c.abort(); }); controllers.clear();
		if (channel) { try { channel.close(); } catch (_) {} channel = null; }
		peers.clear(); pump();
	}
	if (win.addEventListener) win.addEventListener("pagehide", dispose);
	if (win.document && win.document.addEventListener) win.document.addEventListener("visibilitychange", pump);
	/*
	 * The surface this page uses: capabilities (negotiation), images
	 * (browser-first media + per-scene worker fallback), mediaResponse (one
	 * queued, timed, cancellable media request - what a worker-owned voiceover
	 * is), scriptRequest / jsonRequest (control lane) and the object-URL
	 * ledger. No retry ladder is exported, because none lives here any more.
	 */
	return { capabilities: capabilities, images: images, compactIdea: compactIdea,
		timedFetch: timedFetch, mediaResponse: mediaResponse, scriptRequest: scriptRequest, jsonRequest: jsonRequest, schedule: schedule, limits: limits, retainUrl: retainUrl, releaseUrl: releaseUrl, dispose: dispose,
		stats: function () { return { active: active, mediaActive: mediaActive, controlActive: controlActive, queued: queue.length, retainedBytes: retainedBytes, limit: limits(), backoffMs: backoffRemaining() }; },
		noteBackoff: noteBackoff, backoff: function () { return backoffRemaining(); } };
}
const studioOffload = createStudioOffloadRuntime(window);
function createStudioObjectUrl(blob) { return studioOffload.retainUrl(URL.createObjectURL(blob), blob); }
function releaseStudioObjectUrl(url) { studioOffload.releaseUrl(url); URL.revokeObjectURL(url); }
`;
