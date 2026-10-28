/*
 * Browser-side API rotation (`src/client/api-rotation.ts`).
 *
 * The settings page can register up to three backup Worker URLs. The Worker
 * itself rotates its *inference* hop through the pool (src/modules/api-relay.ts);
 * this script optionally rotates the *whole request* the studio makes, so a
 * backup Worker serves `/api/image`, `/api/image-batch`, `/api/image-prompts`,
 * `/api/script`, `/api/seo-plan`, `/api/voiceover` and `/tts` directly.
 *
 * How it works
 * ------------
 *   1. `GET /api/relay/pool` (same-origin) answers the pool, a rotating
 *      cursor seed and — for a signed-in user or allowed guest — a signed,
 *      three-minute ticket scoped to those AI paths.
 *   2. `window.fetch` is wrapped. For an allow-listed AI path the wrapper
 *      picks the next verified endpoint (round-robin, local included) and, if
 *      it is a backup, calls `<backup><path>` with the ticket header and
 *      `credentials: "omit"` (cookies never leave the primary origin).
 *   3. A transport failure, 502, 503 or 504 falls through to the next
 *      endpoint (ending at local), so a paused, rate-limited or older backup
 *      costs one failed request instead of a broken studio.
 *   4. An endpoint that just failed is skipped for 30 s.
 *
 * Nothing here is privileged: no provider secret, no cookie, no storage.
 * Every non-AI path (`/api/config/*`, `/api/payments/*`, CMS, auth, render
 * jobs, page HTML) is always sent exactly where the caller asked.
 */
export const API_ROTATION_JS = String.raw`
(function () {
	if (window.__yvsApiRotationInstalled) return;
	if (typeof window.fetch !== "function") return;
	window.__yvsApiRotationInstalled = true;

	var POOL_PATH = "/api/relay/pool";
	var TICKET_HEADER = "x-yvs-relay-ticket";
	var POOL_TTL_MS = 45000;
	var FAILURE_COOLDOWN_MS = 30000;
	var POOL_TIMEOUT_MS = 8000;

	/*
	 * The same allow-list as RELAY_AI_PATHS on the server. Anything else is
	 * never rewritten, so account, settings, payment and CMS traffic can
	 * never be rotated (or leak) to another origin.
	 */
	var AI_PATHS = ["/api/script", "/api/seo-plan", "/api/voiceover", "/tts"];

	var nativeFetch = window.fetch.bind(window);
	var state = {
		at: 0,
		loading: null,
		enabled: false,
		clientRotation: false,
		endpoints: [],
		ticket: "",
		ticketExp: 0,
		cursor: 0,
		failUntil: {},
		rotated: 0,
		local: 0,
		failovers: 0,
		lastError: ""
	};

	function now() { return Date.now(); }

	function pathOf(input) {
		var raw = typeof input === "string" ? input : (input && input.url) || "";
		if (!raw) return "";
		var path = raw;
		try {
			var parsed = new URL(raw, window.location.href);
			/* Same-origin absolute URLs rotate too; foreign URLs never do. */
			if (parsed.origin !== window.location.origin) return "";
			path = parsed.pathname;
		} catch (_) { return ""; }
		for (var i = 0; i < AI_PATHS.length; i++) {
			if (path === AI_PATHS[i]) return path;
		}
		return "";
	}

	/*
	 * The same-origin path AND query. A rotated GET (/image/gen?prompt=...,
	 * /tts?text=...) must keep its query string, so the rewrite uses this
	 * value while matching still uses the bare pathname.
	 */
	function targetOf(input) {
		var raw = typeof input === "string" ? input : (input && input.url) || "";
		if (!raw) return "";
		try {
			var parsed = new URL(raw, window.location.href);
			if (parsed.origin !== window.location.origin) return "";
			return parsed.pathname + parsed.search;
		} catch (_) { return ""; }
	}

	function isPoolRequest(path) {
		return path === POOL_PATH || path.indexOf("/api/relay/") === 0;
	}

	/*
	 * Learn the pool without delaying the first generation. The request that
	 * arrives before the pool is known simply goes to the local Worker.
	 */
	function refreshPool(force) {
		if (state.loading) return state.loading;
		if (!force && now() - state.at < POOL_TTL_MS) return Promise.resolve(state);
		if (window.navigator && window.navigator.onLine === false) return Promise.resolve(state);

		var controller = typeof AbortController === "function" ? new AbortController() : null;
		var timer = setTimeout(function () { if (controller) controller.abort(); }, POOL_TIMEOUT_MS);
		state.loading = nativeFetch(POOL_PATH, {
			method: "GET",
			credentials: "same-origin",
			cache: "no-store",
			headers: { "Accept": "application/json" },
			signal: controller ? controller.signal : undefined
		}).then(function (response) {
			if (!response.ok) return null;
			return response.json();
		}).then(function (data) {
			state.at = now();
			if (!data || data.success === false) return state;
			state.enabled = data.enabled !== false;
			state.clientRotation = !!data.clientRotation;
			state.endpoints = Array.isArray(data.endpoints) ? data.endpoints.filter(function (entry) {
				return entry && (entry.local === true || (entry.verified === true && typeof entry.url === "string"));
			}) : [];
			state.ticket = typeof data.ticket === "string" ? data.ticket : "";
			state.ticketExp = Number(data.expiresAt) || 0;
			if (!state.ticket) state.clientRotation = false;
			return state;
		}).catch(function (error) {
			state.at = now();
			state.lastError = (error && error.message) || "pool unavailable";
			return state;
		}).then(function (value) {
			clearTimeout(timer);
			state.loading = null;
			return value;
		});
		return state.loading;
	}

	function usable() {
		if (!state.enabled || !state.clientRotation || !state.ticket) return null;
		if (state.ticketExp && state.ticketExp <= now()) return null;
		var endpoints = state.endpoints.filter(function (entry) { return entry && entry.local !== true; });
		if (!endpoints.length) return null;
		return endpoints;
	}

	/* Round-robin over local + every healthy backup. */
	function orderEndpoints() {
		var all = [{ id: "local", url: "", local: true }].concat(usable() || []);
		var healthy = all.filter(function (entry) {
			return !state.failUntil[entry.id] || state.failUntil[entry.id] <= now();
		});
		if (!healthy.length) healthy = [{ id: "local", url: "", local: true }];
		var start = state.cursor % healthy.length;
		state.cursor = (state.cursor + 1) % 1000003;
		return healthy.slice(start).concat(healthy.slice(0, start));
	}

	function absoluteUrl(endpoint, path) {
		if (endpoint.local || !endpoint.url) return path;
		return String(endpoint.url).replace(/\/+$/, "") + path;
	}

	function withTicket(init, endpoint) {
		var base = {};
		if (init && init.headers) {
			if (typeof Headers !== "undefined" && init.headers instanceof Headers) {
				init.headers.forEach(function (value, key) { base[key] = value; });
			} else if (Array.isArray(init.headers)) {
				init.headers.forEach(function (pair) { if (pair && pair.length === 2) base[pair[0]] = pair[1]; });
			} else if (typeof init.headers === "object") {
				for (var key in init.headers) {
					if (Object.prototype.hasOwnProperty.call(init.headers, key)) base[key] = init.headers[key];
				}
			}
		}
		if (!endpoint.local) base[TICKET_HEADER] = state.ticket;
		var out = {};
		if (init) {
			for (var prop in init) {
				if (Object.prototype.hasOwnProperty.call(init, prop) && prop !== "headers") out[prop] = init[prop];
			}
		}
		out.headers = base;
		if (!endpoint.local) {
			/* A backup has no cookie for this origin; never pretend otherwise. */
			out.credentials = "omit";
			out.mode = "cors";
		}
		return out;
	}

	function shouldFailover(response) {
		return response.status === 502 || response.status === 503 || response.status === 504;
	}

	function noteFailure(endpoint, error) {
		state.failUntil[endpoint.id] = now() + FAILURE_COOLDOWN_MS;
		state.lastError = (error && error.message) || "request failed";
	}

	/*
	 * One rotated request. The first attempt uses the round-robin choice; each
	 * retry moves to the next endpoint and finally to local, so the studio
	 * keeps working even when the whole pool is misconfigured.
	 */
	function rotatedFetch(path, targetPath, input, init) {
		var order = orderEndpoints();
		var index = 0;

		function attempt() {
			if (index >= order.length) {
				/* Last resort: the original, unmodified same-origin request. */
				return nativeFetch(input, init);
			}
			var endpoint = order[index++];
			var target = absoluteUrl(endpoint, targetPath || path);
			var options = endpoint.local ? init : withTicket(init, endpoint);
			if (init && init.signal && init.signal.aborted) return nativeFetch(input, init);

			return nativeFetch(target, options).then(function (response) {
				if (endpoint.local) {
					state.local += 1;
					/* Local is authoritative: no failover away from it. */
					return response;
				}
				if (shouldFailover(response)) {
					noteFailure(endpoint, new Error("HTTP " + response.status));
					state.failovers += 1;
					return attempt();
				}
				state.rotated += 1;
				return response;
			}, function (error) {
				noteFailure(endpoint, error);
				if (endpoint.local) throw error;
				state.failovers += 1;
				return attempt();
			});
		}

		return attempt();
	}

	window.fetch = function (input, init) {
		var path = pathOf(input);
		if (!path || isPoolRequest(path)) return nativeFetch(input, init);
		if (window.navigator && window.navigator.onLine === false) return nativeFetch(input, init);
		/* Old pool data is refreshed in the background; this request is not delayed. */
		refreshPool(false);
		if (!usable()) return nativeFetch(input, init);
		return rotatedFetch(path, targetOf(input), input, init);
	};

	/* Public, read-only handle used by diagnostics and tests. */
	window.__yvsApiRotation = {
		refresh: function () { return refreshPool(true); },
		stats: function () {
			return {
				enabled: state.enabled,
				clientRotation: state.clientRotation,
				endpoints: state.endpoints.length,
				rotated: state.rotated,
				local: state.local,
				failovers: state.failovers,
				lastError: state.lastError
			};
		}
	};

	/* Warm the pool during idle time so the first AI request can rotate. */
	if (typeof window.requestIdleCallback === "function") {
		window.requestIdleCallback(function () { refreshPool(false); }, { timeout: 4000 });
	} else {
		setTimeout(function () { refreshPool(false); }, 1500);
	}
})();
`;
