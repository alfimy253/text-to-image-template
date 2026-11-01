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
	async function readBlob(blob) {
		if (blob && typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
		return new Promise(function (resolve, reject) {
			if (!win.FileReader) return reject(new Error("This browser cannot read generated media"));
			var reader = new win.FileReader();
			reader.onload = function () { resolve(reader.result); };
			reader.onerror = function () { reject(new Error("Media could not be read")); };
			reader.readAsArrayBuffer(blob);
		});
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
	function voiceChunks(raw) {
		var text = String(raw || "");
		if (text.length > 8000) throw new Error("Voiceover text exceeds 8000 characters");
		// No Unicode property escapes or lookbehind: parse-compatible with older browsers.
		text = text.replace(/[☀-⟿]/g, " ").replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]+\)/g, "$1").replace(/https?:\/\/\S+/gi, " ")
			.replace(/[\x60*_~#]+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\ufe0e\ufe0f\ufeff]/g, " ")
			.replace(/[\u2013\u2014]/g, ", ").replace(/\u2026/g, "...").replace(/[\u2018\u2019]/g, "'")
			.replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim();
		var clean = "";
		for (var i = 0; i < text.length; i++) {
			var c = text.charCodeAt(i);
			if (c >= 0xd800 && c <= 0xdbff) {
				var low = text.charCodeAt(i + 1);
				if (low >= 0xdc00 && low <= 0xdfff) {
					var cp = (c - 0xd800) * 1024 + low - 0xdc00 + 0x10000;
					if (cp < 0x1f000 || cp > 0x1faff) clean += text.slice(i, i + 2);
					i++;
				}
			} else if (c < 0xdc00 || c > 0xdfff) clean += text[i];
		}
		var speakable;
		try { speakable = new RegExp("[" + "\\p{L}\\p{N}" + "]", "u"); }
		catch (_) { speakable = /[A-Za-z0-9\u00c0-\u02ff\u0370-\u052f\u0590-\u1fff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/; }
		var chunks = [], remaining = clean.trim();
		while (remaining) {
			var end = Math.min(400, remaining.length);
			if (end < remaining.length) {
				// Prefer complete sentences, then words; never split a UTF-16 pair.
				var prefix = remaining.slice(0, end), sentence = /[.!?;]\s+(?![\s\S]*[.!?;]\s+)/.exec(prefix);
				var boundary = sentence ? sentence.index + 1 : prefix.lastIndexOf(" ");
				if (boundary > 100) end = boundary;
				var last = remaining.charCodeAt(end - 1);
				if (last >= 0xd800 && last <= 0xdbff) end--;
			}
			var chunk = remaining.slice(0, end).trim();
			if (speakable.test(chunk)) chunks.push(chunk);
			remaining = remaining.slice(end).trim();
		}
		return chunks;
	}
	async function assembleAudio(buffers, yieldWork) {
		var pieces = buffers.map(function (b) { return new Uint8Array(b); });
		function mismatch(message) { var e = new Error(message); e.code = "AUDIO_FORMAT_MISMATCH"; throw e; }
		function wav(p) { return p.length > 12 && p[0] === 82 && p[1] === 73 && p[2] === 70 && p[3] === 70 && p[8] === 87 && p[9] === 65 && p[10] === 86 && p[11] === 69; }
		function wavPart(p, id) {
			var view = new DataView(p.buffer, p.byteOffset, p.byteLength), off = 12;
			while (off + 8 <= p.length) {
				var size = view.getUint32(off + 4, true);
				if (off + 8 + size > p.length) mismatch("Truncated WAV chunk");
				if (String.fromCharCode.apply(null, p.subarray(off, off + 4)) === id) return p.subarray(off + 8, off + 8 + size);
				off += 8 + size + size % 2;
			}
			mismatch("Missing WAV " + id);
		}
		if (!pieces.length) mismatch("No audio chunks");
		var type = wav(pieces[0]), parts = [], mime, total = 0;
		if (pieces.some(function (p) { return wav(p) !== type; })) mismatch("Mixed WAV and MP3 chunks");
		if (type) {
			var fmt = wavPart(pieces[0], "fmt ");
			if (fmt.length < 16 || new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength).getUint16(0, true) !== 1) mismatch("Unsupported non-PCM WAV");
			pieces.forEach(function (p) {
				var f = wavPart(p, "fmt ");
				if (f.length !== fmt.length || f.some(function (v, i) { return v !== fmt[i]; })) mismatch("WAV sample formats differ");
				var data = wavPart(p, "data"), align = new DataView(fmt.buffer, fmt.byteOffset, fmt.byteLength).getUint16(12, true);
				if (!align || data.length % align) mismatch("WAV block alignment differs");
				parts.push(data); total += data.length;
			});
			var header = new Uint8Array(28 + fmt.length + fmt.length % 2), dv = new DataView(header.buffer);
			header.set([82,73,70,70], 0); header.set([87,65,86,69,102,109,116,32], 8);
			dv.setUint32(4, header.length + total + total % 2 - 8, true); dv.setUint32(16, fmt.length, true); header.set(fmt, 20);
			var d = 20 + fmt.length + fmt.length % 2; header.set([100,97,116,97], d); dv.setUint32(d + 4, total, true);
			parts.unshift(header); if (total % 2) parts.push(new Uint8Array(1)); mime = "audio/wav";
		} else {
			var reference = null;
			pieces.forEach(function (p, index) {
				var start = 0;
				if (p.length >= 10 && p[0] === 73 && p[1] === 68 && p[2] === 51) {
					start = 10 + ((p[6] & 127) * 2097152 + (p[7] & 127) * 16384 + (p[8] & 127) * 128 + (p[9] & 127)) + ((p[5] & 16) ? 10 : 0);
				}
				if (start + 4 > p.length || p[start] !== 255 || (p[start + 1] & 224) !== 224) mismatch("Invalid MP3 frame");
				if (((p[start + 1] >> 3) & 3) === 1 || ((p[start + 1] >> 1) & 3) === 0 || ((p[start + 2] >> 2) & 3) === 3) mismatch("Invalid MP3 sample format");
				var signature = [p[start + 1] & 30, p[start + 2] & 12, p[start + 3] >> 6 === 3 ? 1 : 2].join(":");
				if (reference !== null && signature !== reference) mismatch("MP3 sample formats differ");
				reference = signature; parts.push(index ? p.subarray(start) : p);
			});
			mime = "audio/mpeg";
		}
		var length = parts.reduce(function (n, p) { return n + p.length; }, 0);
		if (length > 64 * 1024 * 1024) throw new Error("Voiceover exceeds browser assembly memory limit");
		var output = new Uint8Array(length), offset = 0;
		for (var i = 0; i < parts.length; i++) {
			for (var j = 0; j < parts[i].length; j += 65536) {
				var part = parts[i].subarray(j, j + 65536); output.set(part, offset); offset += part.length;
				if (yieldWork) await yieldWork();
			}
		}
		return { buffer: output.buffer, mime: mime };
	}
	async function assembleBlobs(blobs, options) {
		if (blobs.reduce(function (size, blob) { return size + (blob.size || 0); }, 0) > 64 * 1024 * 1024) throw new Error("Voiceover exceeds browser assembly memory limit");
		var buffers = await Promise.all(blobs.map(readBlob)), worker, url, timer, cancelTimer, abortListener;
		check(options);
		if (typeof win.Worker === "function" && win.URL && win.URL.createObjectURL) {
			try {
				url = win.URL.createObjectURL(new win.Blob(["var assembleAudio = " + assembleAudio.toString() + ";onmessage=function(e){assembleAudio(e.data).then(function(r){postMessage(r,[r.buffer]);},function(e){postMessage({error:e.message,code:e.code});});};"], { type: "text/javascript" }));
				worker = new win.Worker(url);
				var assembled = await new Promise(function (resolve, reject) {
					worker.onmessage = function (event) {
						if (event.data.error) { var e = new Error(event.data.error); e.code = event.data.code; reject(e); }
						else resolve(event.data);
					};
					worker.onerror = function () { reject(new Error("Audio worker unavailable")); };
					timer = win.setTimeout(function () { reject(new Error("Audio assembly worker timed out")); }, 30000);
					if (options.signal && options.signal.addEventListener) {
						abortListener = function () { reject(abortError()); };
						options.signal.addEventListener("abort", abortListener, { once: true });
					}
					function watch() {
						try { check(options); } catch (error) { reject(error); return; }
						cancelTimer = win.setTimeout(watch, 100);
					}
					watch();
					worker.postMessage(buffers, buffers);
				});
				check(options);
				return new win.Blob([assembled.buffer], { type: assembled.mime });
			} catch (error) {
				check(options);
				if (error.code === "AUDIO_FORMAT_MISMATCH") throw error;
				// Original Blobs survive transferred buffers; reread only if transfer detached them.
				if (buffers.some(function (b) { return !b.byteLength; })) buffers = await Promise.all(blobs.map(readBlob));
			} finally {
				win.clearTimeout(timer); win.clearTimeout(cancelTimer); if (worker) worker.terminate(); if (url) win.URL.revokeObjectURL(url);
				if (abortListener) options.signal.removeEventListener("abort", abortListener);
			}
		}
		var result = await assembleAudio(buffers, async function () { check(options); await sleep(0); });
		check(options); return new win.Blob([result.buffer], { type: result.mime });
	}
	async function voiceover(text, lang, options) {
		options = options || {};
		lang = String(lang || "en").toLowerCase().trim();
		var chunks = voiceChunks(text), g = group(options);
		if (!chunks.length) throw new Error("No script text to speak");
		try {
			for (var attempt = 0; attempt < 3; attempt++) {
				var blobs = [], voiceIndex = lang === "en" ? attempt : 0;
				try {
					for (var i = 0; i < chunks.length; i++) {
						check(g.options);
						blobs.push(await schedule(function (chunk) { return function () {
							return timedFetch("/api/voiceover", { method: "POST", headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ chunk: true, text: chunk, lang: lang, voiceIndex: voiceIndex }) }, 45000, g.options,
								async function (response) { if (!response.ok) return responseError(response); return response.blob(); });
						}; }(chunks[i]), g.options));
					}
					return await assembleBlobs(blobs, g.options);
				} catch (error) {
					check(g.options);
					if (error.retryable === false || attempt === 2) throw error;
					await sleep(error.retryAfterMs > 0 ? error.retryAfterMs : 500 * (attempt + 1));
					// Restart all chunks on one fallback voice; never concatenate mixed containers/voices.
				}
			}
		} finally { if (options.clearController) options.clearController(g.owner); }
	}
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
	return { capabilities: capabilities, images: images, voiceover: voiceover, compactIdea: compactIdea,
		voiceChunks: voiceChunks, assembleAudio: assembleAudio, assembleBlobs: assembleBlobs, readBlob: readBlob,
		timedFetch: timedFetch, mediaResponse: mediaResponse, scriptRequest: scriptRequest, jsonRequest: jsonRequest, schedule: schedule, limits: limits, retainUrl: retainUrl, releaseUrl: releaseUrl, dispose: dispose,
		stats: function () { return { active: active, mediaActive: mediaActive, controlActive: controlActive, queued: queue.length, retainedBytes: retainedBytes, limit: limits(), backoffMs: backoffRemaining() }; },
		noteBackoff: noteBackoff, backoff: function () { return backoffRemaining(); } };
}
const studioOffload = createStudioOffloadRuntime(window);
function createStudioObjectUrl(blob) { return studioOffload.retainUrl(URL.createObjectURL(blob), blob); }
function releaseStudioObjectUrl(url) { studioOffload.releaseUrl(url); URL.revokeObjectURL(url); }
`;
