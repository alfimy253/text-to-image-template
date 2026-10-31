/**
 * Browser-first Pixabay media fetching.
 *
 * The browser performs the provider search (`pixabay.com/api/`) and the asset
 * download (`cdn.pixabay.com`) itself. The Worker is only asked for the
 * non-media essentials: a short-lived configuration document (API origin and
 * key), one credit reservation per chunk, and the refund of scenes that were
 * not delivered from the browser.
 *
 * Why this module exists
 * ----------------------
 * Before this, every scene's metadata request and every media byte travelled
 * through the Worker (`POST /api/image` -> `handleImageBinary` ->
 * `pixabaySceneImage` -> `searchPixabay` + `downloadPixabay`). That made the
 * Cloudflare isolate the bottleneck for provider bandwidth, memory and
 * serialized downloads, and put the provider's latency inside the Worker's
 * request budget. The fetch now starts in the page.
 *
 * Safety rules kept from `src/modules/pixabay.ts` (code is the source of truth):
 *   - upstream `per_page=3`, page 1 only, `safesearch=true`, photos are
 *     `image_type=photo` + orientation, videos send no orientation;
 *   - at most two photos / three videos are exposed;
 *   - media URLs must be HTTPS on `pixabay.com` or `cdn.pixabay.com`, with no
 *     credentials, port or `key` parameter;
 *   - JPEG/PNG/WebP photos (8 MiB) and MP4 clips <= 60 s (16 MiB) only, with
 *     magic-byte validation before anything reaches the gallery;
 *   - provider 429 answers are never retried in a tight loop: they carry
 *     `retryAfterMs`, which the existing browser retry ladder honours.
 *
 * Every failure that the Worker path could have solved is marked
 * `fallback: true`, so `browser-offload.images()` can retry that one scene
 * through the same-origin route without losing the rest of the batch.
 */
export const PIXABAY_DIRECT_VERSION = 1;

export const PIXABAY_DIRECT_JS = String.raw`
function createPixabayDirectRuntime(win) {
	var CONFIG_PATH = "/api/media/config";
	var DEFAULT_CLAIM_PATH = "/api/media/claim";
	var DEFAULT_SETTLE_PATH = "/api/media/settle";
	var PER_PAGE = 3, IMAGE_RESULTS = 2, VIDEO_RESULTS = 3;
	var MAX_IMAGE_BYTES = 8 * 1024 * 1024, MAX_VIDEO_BYTES = 16 * 1024 * 1024;
	var CONFIG_TTL = 10 * 60 * 1000, CONFIG_DISABLED_TTL = 60 * 1000;
	var ASSET_CORS_HOLD_MS = 5 * 60 * 1000;
	var EVENTS_MAX = 200;
	var PROVIDER_HOSTS = ["pixabay.com", "cdn.pixabay.com"];
	var cache = new Map(), cacheBytes = 0, CACHE_MAX_BYTES = 48 * 1024 * 1024, CACHE_MAX_ITEMS = 8;
	var configState = null, configUntil = 0, configPromise = null, configRetryAt = 0;
	var assetCorsUntil = 0;
	var events = [];
	var counters = { scenes: 0, direct: 0, fallback: 0, failed: 0, searches: 0, downloads: 0, claims: 0, refunded: 0 };

	function now() { return Date.now(); }
	function textOf(error) { return String((error && (error.message || error)) || "unknown error").slice(0, 400); }
	function debugEnabled() { try { return Boolean(win.__PIXABAY_DIRECT_DEBUG); } catch (_) { return false; } }
	function record(level, stage, fields) {
		var entry = { at: new Date().toISOString(), level: level, stage: stage };
		if (fields) for (var key in fields) if (Object.prototype.hasOwnProperty.call(fields, key)) entry[key] = fields[key];
		events.push(entry);
		if (events.length > EVENTS_MAX) events.splice(0, events.length - EVENTS_MAX);
		var consoleRef = win.console || (typeof console !== "undefined" ? console : null);
		if (!consoleRef) return;
		/* Successes stay quiet unless the debug flag is on; problems are visible. */
		if (level === "error" && consoleRef.error) consoleRef.error("[pixabay-direct] " + stage, fields || {});
		else if (level === "warn" && consoleRef.warn) consoleRef.warn("[pixabay-direct] " + stage, fields || {});
		else if (debugEnabled() && consoleRef.info) consoleRef.info("[pixabay-direct] " + stage, fields || {});
	}
	function fail(message, fields) {
		var error = new Error(message);
		error.name = "PixabayDirectError";
		fields = fields || {};
		error.status = Number(fields.status) || 0;
		error.kind = fields.kind || "provider";
		error.retryAfterMs = Number(fields.retryAfterMs) || 0;
		/* Default: the Worker can still answer this scene. */
		error.fallback = fields.fallback === undefined ? true : Boolean(fields.fallback);
		error.detail = fields.detail || "";
		error.credits = fields.credits || null;
		error.providerStatus = Number(fields.providerStatus) || 0;
		return error;
	}
	function abortError() { var error = new Error("Generation was cancelled"); error.name = "AbortError"; return error; }
	function check(options) {
		if (!options) return;
		if (options.signal && options.signal.aborted) throw abortError();
		if (options.isCancelled && options.isCancelled()) throw abortError();
	}

	/* ---------------------------------------------------------------- config */

	function normalizeConfig(data) {
		var enabled = Boolean(data && data.success !== false && data.direct === true && typeof data.key === "string" && data.key.length > 0);
		var apiOrigin = "https://pixabay.com";
		try {
			var parsed = new URL(String((data && data.apiOrigin) || "https://pixabay.com"));
			if (parsed.protocol === "https:" && PROVIDER_HOSTS.indexOf(parsed.hostname) >= 0) apiOrigin = parsed.origin;
		} catch (_) { /* keep the fixed provider origin */ }
		function size(value, fallback) {
			var number = Number(value);
			return number > 0 && number <= fallback ? Math.floor(number) : fallback;
		}
		return {
			enabled: enabled,
			reason: enabled ? "" : String((data && (data.error || data.reason)) || "Browser media fetching is disabled"),
			apiOrigin: apiOrigin,
			assetHosts: PROVIDER_HOSTS,
			key: enabled ? String(data.key).trim() : "",
			perPage: PER_PAGE,
			imageResults: IMAGE_RESULTS,
			videoResults: VIDEO_RESULTS,
			maxImageBytes: size(data && data.maxImageBytes, MAX_IMAGE_BYTES),
			maxVideoBytes: size(data && data.maxVideoBytes, MAX_VIDEO_BYTES),
			claimPath: String((data && data.claimPath) || DEFAULT_CLAIM_PATH),
			settlePath: String((data && data.settlePath) || DEFAULT_SETTLE_PATH)
		};
	}
	function disabledConfig(reason) {
		return normalizeConfig({ success: false, direct: false, reason: reason || "Browser media fetching is disabled" });
	}
	function config() {
		if (configState && configUntil > now()) return Promise.resolve(configState);
		if (configPromise) return configPromise;
		if (configRetryAt > now()) return Promise.resolve(configState || disabledConfig("Browser media fetching is unavailable"));
		var promise = requestJson(CONFIG_PATH, null, 6000, null).then(function (data) {
			var next = normalizeConfig(data);
			configState = next;
			configUntil = now() + (next.enabled ? CONFIG_TTL : CONFIG_DISABLED_TTL);
			record(next.enabled ? "info" : "warn", "config.loaded", { direct: next.enabled, apiOrigin: next.apiOrigin, reason: next.reason });
			return next;
		}, function (error) {
			configState = disabledConfig("Browser media configuration is unavailable");
			configRetryAt = now() + CONFIG_DISABLED_TTL;
			configUntil = configRetryAt;
			record("warn", "config.unavailable", { error: textOf(error) });
			return configState;
		});
		configPromise = promise;
		/* A failed/late probe must not stay stuck as the cached answer. */
		promise.then(function () { if (configPromise === promise) configPromise = null; });
		return promise;
	}
	function enabled() { return config().then(function (state) { return Boolean(state.enabled); }); }

	/* --------------------------------------------------------------- helpers */

	function encodeQuery(value) {
		return String(value == null ? "" : value)
			.replace(/[\u0000-\u001f\u007f]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 100);
	}
	function orientationValue(value) {
		return value === "portrait" ? "vertical" : value === "landscape" ? "horizontal" : "all";
	}
	function providerURL(value, state) {
		try {
			var url = new URL(String(value));
			var hosts = state && state.assetHosts ? state.assetHosts : PROVIDER_HOSTS;
			if (url.protocol === "https:" && hosts.indexOf(url.hostname) >= 0 && !url.username && !url.password && !url.port && !url.searchParams.has("key")) return url.href;
		} catch (_) { /* invalid provider metadata is discarded */ }
		return "";
	}
	function hintFrom(response, status) {
		try {
			var header = response && response.headers && response.headers.get ? response.headers.get("Retry-After") : null;
			var seconds = Number(header);
			if (seconds > 0) return Math.min(3600 * 1000, Math.ceil(seconds * 1000));
			var reset = Number(response.headers.get("X-RateLimit-Reset"));
			if (reset > 0) return Math.min(3600 * 1000, Math.ceil(reset * 1000));
		} catch (_) { /* headers are optional */ }
		return status === 429 ? 60000 : 0;
	}
	function responseText(response) {
		try {
			return response && typeof response.text === "function"
				? response.text().then(function (text) { return String(text || "").slice(0, 400); }, function () { return ""; })
				: Promise.resolve("");
		} catch (_) { return Promise.resolve(""); }
	}
	/*
	 * One fetch with both the caller's cancellation and a hard deadline.
	 * AbortSignal.any is not available everywhere, so the combined signal is
	 * built explicitly and always cleaned up.
	 */
	async function fetchBounded(url, init, options, timeoutMs) {
		check(options);
		var Controller = win.AbortController || (typeof AbortController !== "undefined" ? AbortController : null);
		if (!Controller) return win.fetch(url, init);
		var controller = new Controller();
		var timer = null, external = options && options.signal, onAbort = null, expired = false;
		if (external) {
			onAbort = function () { try { controller.abort(); } catch (_) {} };
			if (external.aborted) onAbort(); else external.addEventListener("abort", onAbort, { once: true });
		}
		timer = win.setTimeout(function () { expired = true; try { controller.abort(); } catch (_) {} }, timeoutMs);
		try {
			var requestInit = Object.assign({}, init, { signal: controller.signal });
			return await win.fetch(url, requestInit);
		} catch (error) {
			check(options);
			if (expired) throw fail("The Pixabay request timed out in the browser", { kind: "timeout", fallback: true, detail: textOf(error) });
			throw error;
		} finally {
			win.clearTimeout(timer);
			if (onAbort && external && external.removeEventListener) external.removeEventListener("abort", onAbort);
		}
	}
	async function requestJson(url, body, timeoutMs, options) {
		var init = { method: body ? "POST" : "GET", credentials: "same-origin", headers: {} };
		if (body) { init.headers["Content-Type"] = "application/json"; init.body = body; }
		var response;
		try { response = await fetchBounded(url, init, options, timeoutMs || 8000); }
		catch (error) {
			if (error && error.name === "AbortError") throw error;
			throw fail("The studio could not be reached (" + textOf(error) + ")", { kind: "unavailable", fallback: false, detail: textOf(error) });
		}
		var data = null;
		try { data = await response.json(); } catch (_) { data = null; }
		if (!response.ok || (data && data.success === false)) {
			throw fail((data && (data.error || data.message)) || ("Studio request failed (HTTP " + response.status + ")"),
				{ status: response.status, kind: (data && data.kind) || (response.status === 429 ? "credits" : "unavailable"),
					fallback: false, credits: data && data.credits || null,
					retryAfterMs: hintFrom(response, response.status) });
		}
		return data || {};
	}

	/* ---------------------------------------------------------------- search */

	/*
	 * JSONP fallback. Pixabay's API has answered browsers with and without a
	 * readable CORS header over the years; when fetch() is rejected by CORS the
	 * search can still be read through the documented callback parameter.
	 * Assets cannot use JSONP, which is why the Worker fallback stays.
	 */
	function jsonpSearch(url, options) {
		var doc = win.document;
		if (!doc || typeof doc.createElement !== "function" || typeof win.setTimeout !== "function") return Promise.resolve(null);
		return new Promise(function (resolve, reject) {
			var name = "__pixabayDirectJsonp" + Math.random().toString(36).slice(2);
			var script = doc.createElement("script");
			var timer = null, done = false, onAbort = null;
			function cleanup() {
				done = true;
				win.clearTimeout(timer);
				try { delete win[name]; } catch (_) { win[name] = undefined; }
				script.onerror = null;
				script.onload = null;
				if (script.parentNode) script.parentNode.removeChild(script);
				if (onAbort && options && options.signal && options.signal.removeEventListener) options.signal.removeEventListener("abort", onAbort);
			}
			function finish(error, value) { if (done) return; cleanup(); if (error) reject(error); else resolve(value); }
			win[name] = function (payload) { finish(null, payload); };
			script.onerror = function () { finish(fail("Pixabay search is blocked by the browser (JSONP failed)", { kind: "cors", fallback: true })); };
			script.src = url + "&callback=" + encodeURIComponent(name);
			timer = win.setTimeout(function () { finish(fail("Pixabay search JSONP timed out", { kind: "cors", fallback: true })); }, 12000);
			if (options && options.signal && options.signal.addEventListener) {
				onAbort = function () { finish(abortError()); };
				if (options.signal.aborted) return onAbort();
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
			(doc.head || doc.documentElement).appendChild(script);
		});
	}
	function normalizeHits(payload, type, state) {
		if (!payload || !Array.isArray(payload.hits)) {
			throw fail("Pixabay returned an invalid search response", { kind: "invalid", fallback: true });
		}
		var limit = type === "image" ? state.imageResults : state.videoResults;
		var hits = [];
		for (var index = 0; index < payload.hits.length && index < PER_PAGE; index++) {
			var hit = payload.hits[index];
			if (!hit || !Number.isSafeInteger(hit.id) || hit.id < 1) continue;
			var variant = type === "video" ? (hit.videos && hit.videos.small && hit.videos.small.url ? hit.videos.small : hit.videos && hit.videos.tiny) : null;
			var url = providerURL(type === "image" ? (hit.largeImageURL || hit.webformatURL) : (variant && variant.url), state);
			var pageURL = providerURL(hit.pageURL, state);
			if (!url || !pageURL) continue;
			var duration = Number(hit.duration);
			if (type === "video" && (!isFinite(duration) || duration <= 0 || duration > 60 || Number(variant && variant.size) > state.maxVideoBytes)) continue;
			hits.push({
				id: hit.id, type: type, pageURL: pageURL,
				user: String(hit.user || "").slice(0, 120),
				tags: String(hit.tags || "").slice(0, 300),
				url: url,
				previewURL: providerURL(type === "video" ? (variant && variant.thumbnail) : hit.previewURL, state),
				width: Number(type === "image" ? hit.imageWidth : (variant && variant.width)) || 0,
				height: Number(type === "image" ? hit.imageHeight : (variant && variant.height)) || 0
			});
			if (type === "video") hits[hits.length - 1].duration = duration;
			if (hits.length >= limit) break;
		}
		return { provider: "pixabay", per_page: limit, page: 1, totalHits: Number(payload.totalHits) || 0, hits: hits };
	}
	async function search(input, options) {
		var state = await config();
		if (!state.enabled) throw fail("Browser Pixabay search is not enabled (" + state.reason + ")", { kind: "unavailable", fallback: true });
		var query = encodeQuery(input && input.q);
		var type = input && input.type === "video" ? "video" : "image";
		if (!query) throw fail("Enter Pixabay search terms", { status: 400, kind: "invalid", fallback: false });
		var params = "key=" + encodeURIComponent(state.key) +
			"&q=" + encodeURIComponent(query) +
			"&per_page=" + PER_PAGE + "&page=1&safesearch=true";
		if (type === "image") params += "&image_type=photo&orientation=" + orientationValue(input && input.orientation);
		var url = state.apiOrigin + "/api/?" + params;
		counters.searches += 1;
		record("info", "search.started", { type: type, queryLength: query.length, orientation: input && input.orientation || "" });
		var payload = null, transportError = null;
		try {
			var response = await fetchBounded(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" }, options, 20000);
			if (response.ok) {
				payload = await response.json().catch(function () { return null; });
				if (!payload) throw fail("Pixabay returned an invalid search response", { kind: "invalid", fallback: true });
			} else {
				var retryAfterMs = hintFrom(response, response.status);
				var detail = await responseText(response);
				record("warn", "search.rejected", { type: type, status: response.status, retryAfterMs: retryAfterMs, detail: detail });
				throw fail(response.status === 429 ? "Pixabay rate limit (429). Please wait." : ("Pixabay search failed (HTTP " + response.status + ")"),
					{ status: response.status, providerStatus: response.status, retryAfterMs: retryAfterMs,
						kind: response.status === 429 ? "rate-limit" : "provider",
						fallback: response.status !== 429, detail: detail });
			}
		} catch (error) {
			if (error && (error.status || error.name === "AbortError")) throw error;
			transportError = error;
			check(options);
			record("warn", "search.cors-blocked", { error: textOf(error) });
			var jsonp = await jsonpSearch(url, options);
			if (jsonp) payload = jsonp;
			else throw fail("Pixabay search could not be read by the browser (" + textOf(transportError) + ")", { kind: "cors", fallback: true, detail: textOf(transportError) });
		}
		var result = normalizeHits(payload, type, state);
		record("info", "search.completed", { type: type, hits: result.hits.length, totalHits: result.totalHits });
		return result;
	}

	/* -------------------------------------------------------------- download */

	function cached(key) {
		var entry = cache.get(key);
		if (!entry) return null;
		cache.delete(key);
		cache.set(key, entry);
		return entry;
	}
	function remember(key, entry) {
		if (cache.has(key)) cacheBytes -= cache.get(key).bytes || 0;
		cache.set(key, entry);
		cacheBytes += entry.bytes || 0;
		while (cache.size > CACHE_MAX_ITEMS || cacheBytes > CACHE_MAX_BYTES) {
			var oldest = cache.keys().next();
			if (oldest.done) break;
			cacheBytes -= cache.get(oldest.value).bytes || 0;
			cache.delete(oldest.value);
		}
	}
	function validBytes(bytes, mime) {
		if (!bytes || !bytes.length) return false;
		if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
		if (mime === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every(function (value, index) { return bytes[index] === value; });
		if (mime === "image/webp") {
			var text = "";
			for (var index = 0; index < 12 && index < bytes.length; index++) text += String.fromCharCode(bytes[index]);
			return text.slice(0, 4) === "RIFF" && text.slice(8, 12) === "WEBP";
		}
		if (mime === "video/mp4") {
			var header = "";
			for (var part = 4; part < 8 && part < bytes.length; part++) header += String.fromCharCode(bytes[part]);
			return header === "ftyp";
		}
		return false;
	}
	function sniffMime(bytes) {
		if (!bytes || bytes.length < 12) return "";
		if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
		if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
		var head = "";
		for (var index = 0; index < 12; index++) head += String.fromCharCode(bytes[index]);
		if (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP") return "image/webp";
		if (head.slice(4, 8) === "ftyp") return "video/mp4";
		return "";
	}
	async function download(hit, options) {
		var state = await config();
		if (!state.enabled) throw fail("Browser Pixabay downloads are not enabled (" + state.reason + ")", { kind: "unavailable", fallback: true });
		var type = hit && hit.type === "video" ? "video" : "image";
		var cacheKey = type + ":" + (hit && hit.id);
		var hitCache = cached(cacheKey);
		if (hitCache) {
			record("info", "download.memory-hit", { mediaType: type, assetId: hit.id });
			return { blob: hitCache.blob, mime: hitCache.mime, source: sourceFor(hit, type) };
		}
		if (assetCorsUntil > now()) {
			throw fail("The Pixabay CDN is not readable from this browser yet", { kind: "cors", fallback: true });
		}
		var url = providerURL(hit && hit.url, state);
		if (!url) throw fail("Invalid Pixabay asset URL", { status: 400, kind: "invalid", fallback: false });
		var maxBytes = type === "image" ? state.maxImageBytes : state.maxVideoBytes;
		counters.downloads += 1;
		record("info", "download.started", { mediaType: type, assetId: hit.id, host: new URL(url).hostname });
		var response;
		try {
			response = await fetchBounded(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", redirect: "follow" }, options, 45000);
		} catch (error) {
			if (error && (error.name === "AbortError" || error.status)) throw error;
			/* A transport rejection on a public CDN URL is a CORS/network refusal. */
			assetCorsUntil = now() + ASSET_CORS_HOLD_MS;
			record("warn", "download.cors-blocked", { mediaType: type, assetId: hit.id, holdMs: ASSET_CORS_HOLD_MS, error: textOf(error) });
			throw fail("Pixabay media could not be read by this browser (" + textOf(error) + ")", { kind: "cors", fallback: true, detail: textOf(error) });
		}
		if (!response.ok) {
			var retryAfterMs = hintFrom(response, response.status);
			record("warn", "download.rejected", { mediaType: type, assetId: hit.id, status: response.status, retryAfterMs: retryAfterMs });
			throw fail(response.status === 429 ? "Pixabay rate limit (429). Please wait." : "Pixabay download failed",
				{ status: response.status, providerStatus: response.status, retryAfterMs: retryAfterMs,
					kind: response.status === 429 ? "rate-limit" : "provider", fallback: response.status !== 429 });
		}
		/* redirect:"follow" hides the hop; re-check the URL the browser ended on. */
		if (response.url && providerURL(response.url, state) === "") {
			throw fail("Unsafe Pixabay redirect", { kind: "invalid", fallback: true, detail: String(response.url).slice(0, 200) });
		}
		var declared = Number(response.headers && response.headers.get ? response.headers.get("Content-Length") : 0);
		if (declared > maxBytes) throw fail("Pixabay asset exceeds size limit", { status: 413, kind: "invalid", fallback: false });
		var mime = String((response.headers && response.headers.get ? response.headers.get("Content-Type") : "") || "").split(";")[0].trim().toLowerCase();
		var buffer;
		try { buffer = await response.arrayBuffer(); }
		catch (error) {
			if (error && error.name === "AbortError") throw error;
			throw fail("Pixabay media download was interrupted", { kind: "network", fallback: true, detail: textOf(error) });
		}
		var bytes = new Uint8Array(buffer);
		if (bytes.length > maxBytes) throw fail("Pixabay asset exceeds size limit", { status: 413, kind: "invalid", fallback: false });
		/* Some CDN edges answer application/octet-stream; trust the signature then. */
		if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") mime = sniffMime(bytes);
		var allowed = type === "image" ? ["image/jpeg", "image/png", "image/webp"].indexOf(mime) >= 0 : mime === "video/mp4";
		if (!allowed || !validBytes(bytes, mime)) {
			record("error", "download.invalid-bytes", { mediaType: type, assetId: hit.id, mime: mime, bytes: bytes.length, signature: Array.prototype.slice.call(bytes.slice(0, 12)) });
			throw fail("Invalid Pixabay media bytes", { kind: "invalid", fallback: true });
		}
		var BlobRef = win.Blob || (typeof Blob !== "undefined" ? Blob : null);
		if (!BlobRef) throw fail("This browser cannot store downloaded media", { kind: "unavailable", fallback: false });
		var blob = new BlobRef([bytes], { type: mime });
		remember(cacheKey, { blob: blob, bytes: bytes.length, mime: mime });
		record("info", "download.completed", { mediaType: type, assetId: hit.id, mime: mime, bytes: bytes.length, transport: "browser" });
		return { blob: blob, mime: mime, source: sourceFor(hit, type) };
	}
	function sourceFor(hit, type) {
		return { provider: "pixabay", id: hit && hit.id, pageURL: (hit && hit.pageURL) || "", user: (hit && hit.user) || "",
			type: type, duration: type === "video" ? Number(hit && hit.duration) || 0 : 0 };
	}

	/* ------------------------------------------------------------ scenes/batch */

	function parseToken(token, fallbackScene) {
		var fallback = Math.max(0, Number(fallbackScene) || 0);
		var parsed = { q: "", type: "image", index: fallback, scene: fallback };
		if (typeof token === "string" && token.indexOf("pixabay:") === 0) {
			try {
				var value = JSON.parse(token.slice(8));
				if (value && typeof value === "object") {
					if (typeof value.q === "string") parsed.q = value.q.trim();
					if (value.type === "video" || value.type === "image") parsed.type = value.type;
					if (Number.isInteger(value.index) && value.index >= 0) parsed.index = value.index;
					if (Number.isInteger(value.scene) && value.scene >= 0) parsed.scene = value.scene;
				}
			} catch (_) { /* invalid structured tokens never become bogus queries */ }
		} else if (typeof token === "string") {
			parsed.q = token.trim();
		}
		return parsed;
	}
	async function scene(token, frame, options) {
		counters.scenes += 1;
		var parsed = parseToken(token, 0);
		if (!parsed.q) throw fail("Missing Pixabay search terms", { status: 400, kind: "invalid", fallback: false });
		var index = parsed.index;
		if (parsed.type === "image") index = index % IMAGE_RESULTS;
		var portrait = Number(frame && frame.height) > Number(frame && frame.width);
		try {
			var result = await search({ q: parsed.q, type: parsed.type, orientation: portrait ? "portrait" : "landscape" }, options);
			var hit = result.hits[index] || result.hits[0];
			if (!hit) throw fail("No suitable Pixabay media for this scene. Try different search terms or upload media.", { status: 404, kind: "no-hit", fallback: true });
			var media = await download(hit, options);
			counters.direct += 1;
			record("info", "scene.completed", { mediaType: parsed.type, scene: parsed.scene, assetId: hit.id, transport: "browser", bytes: media.blob.size });
			return { blob: media.blob, source: media.source, hit: hit, transport: "browser" };
		} catch (error) {
			counters.failed += 1;
			record("warn", "scene.failed", { mediaType: parsed.type, scene: parsed.scene, status: Number(error && error.status) || 0,
				kind: (error && error.kind) || "", fallback: Boolean(error && error.fallback), error: textOf(error) });
			throw error;
		}
	}

	/* --------------------------------------------------------------- credits */

	async function claim(count, options) {
		var state = await config();
		if (!state.enabled) throw fail("Browser media credits are unavailable", { kind: "unavailable", fallback: false });
		var wanted = Math.max(1, Math.min(20, Math.floor(Number(count) || 1)));
		var data = await requestJson(state.claimPath, JSON.stringify({ count: wanted }), 8000, options);
		var granted = Math.floor(Number(data && data.granted) || 0);
		if (!data || data.success === false || !data.claimId || granted <= 0) {
			throw fail((data && data.error) || "No stock import credit was granted", { status: 429, kind: "credits", fallback: false, credits: data && data.credits });
		}
		counters.claims += 1;
		record("info", "claim.granted", { requested: wanted, granted: granted, claimId: String(data.claimId) });
		return { claimId: String(data.claimId), granted: granted, credits: data.credits || null };
	}
	async function settle(claimId, delivered, options) {
		/* Use the config that issued the claim: a later probe must not strand
		 * a reservation without its refund. */
		var state = configState || await config();
		if (!state || !claimId || claimId === "open") return null;
		var body = JSON.stringify({ claimId: String(claimId).slice(0, 100), delivered: Math.max(0, Math.min(20, Math.floor(Number(delivered) || 0))) });
		try {
			var data = await requestJson(state.settlePath, body, 6000, options && options.signal ? { signal: options.signal } : null);
			var refunded = Math.floor(Number(data && data.refunded) || 0);
			counters.refunded += refunded;
			record("info", "claim.settled", { claimId: String(claimId), delivered: Number(delivered) || 0, refunded: refunded });
			return { refunded: refunded, credits: data && data.credits || null };
		} catch (error) {
			record("warn", "claim.settle-failed", { claimId: String(claimId), error: textOf(error) });
			return null;
		}
	}

	/* ---------------------------------------------------------------- debug */

	function debugState() {
		var state = configState;
		return {
			version: 1,
			enabled: Boolean(state && state.enabled),
			config: state ? { enabled: state.enabled, apiOrigin: state.apiOrigin, hasKey: Boolean(state.key), reason: state.reason } : null,
			assetCorsBlockedForMs: Math.max(0, assetCorsUntil - now()),
			counters: Object.assign({}, counters),
			events: events.slice(-80)
		};
	}
	function printDebug() {
		var snapshot = debugState();
		var consoleRef = win.console || (typeof console !== "undefined" ? console : null);
		if (consoleRef && typeof consoleRef.table === "function") {
			consoleRef.table(snapshot.events.map(function (entry) { return { at: entry.at, level: entry.level, stage: entry.stage, detail: entry.error || entry.status || entry.assetId || "" }; }));
		}
		if (consoleRef && consoleRef.info) consoleRef.info("[pixabay-direct] snapshot", { enabled: snapshot.enabled, config: snapshot.config, counters: snapshot.counters, corsHoldMs: snapshot.assetCorsBlockedForMs });
		return snapshot;
	}

	return {
		version: 1,
		config: config,
		enabled: enabled,
		search: search,
		download: download,
		scene: scene,
		claim: claim,
		settle: settle,
		parseToken: parseToken,
		debug: debugState,
		printDebug: printDebug
	};
}
var studioPixabayDirect = createPixabayDirectRuntime(window);
window.studioPixabayDirect = studioPixabayDirect;
window.studioPixabayDebug = function () { return studioPixabayDirect.printDebug(); };
`;
