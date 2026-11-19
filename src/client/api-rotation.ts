/*
 * Server-driven pipeline rotation (`src/client/api-rotation.ts`).
 *
 * Session 331 moved EVERY rotation decision to the Cloudflare Worker that
 * serves this page (`src/modules/api-relay.ts`). The admin page can register
 * up to five backup Worker URLs; for each AI request the studio now:
 *
 *   1. asks the UI Worker  — `GET /api/relay/endpoint?path=/api/script` —
 *      which URL should run this one pipeline call, and WAITS for the answer;
 *   2. calls exactly that URL. When the answer is this Worker's own origin the
 *      request is the original, unmodified same-origin request (cookies and
 *      all); when it is a backup the studio calls `<backup><path>` with the
 *      short-lived ticket the answer carried and `credentials: "omit"`.
 *
 * The browser therefore never picks, ranks, keeps a cursor for, or remembers a
 * cooldown for an endpoint. The server owns the pool, the round-robin ring and
 * the health state; the local (UI) Worker is entered into that ring once while
 * every backup is entered three times, so it receives the smaller share of the
 * API work.
 *
 * The only thing this script decides on its own is the *recovery* step: if the
 * URL it was given does not answer (network error, 502, 503, 504) it asks once
 * more, tells the server which endpoint failed (`&failed=<id>`, carrying the
 * ticket that proves it was really given that URL), and calls the new answer.
 * That is a report, not a rotation.
 *
 * Nothing here is privileged: no provider secret, no cookie, no storage. Every
 * non-AI path (`/api/config/*`, `/api/payments/*`, CMS, auth, render jobs, the
 * page HTML) is sent exactly where the caller asked.
 */
export const API_ROTATION_JS = String.raw`
(function () {
	if (window.__yvsApiRotationInstalled) return;
	if (typeof window.fetch !== "function") return;
	window.__yvsApiRotationInstalled = true;

	var ENDPOINT_PATH = "/api/relay/endpoint";
	var TICKET_HEADER = "x-yvs-relay-ticket";
	var ASK_TIMEOUT_MS = 8000;
	var MAX_ASK_ATTEMPTS = 2;

	/*
	 * The same allow-list as RELAY_AI_PATHS on the server. Anything else is
	 * never asked about, so account, settings, payment and CMS traffic can
	 * never be moved (or leak) to another origin.
	 */
	var AI_PATHS = [
		"/api/script",
		"/api/seo-plan",
		"/api/voiceover",
		"/tts",
		"/api/image",
		"/api/image-batch",
		"/api/image-prompts",
		"/image/gen"
	];

	var nativeFetch = window.fetch.bind(window);
	var state = {
		asked: 0,
		rotated: 0,
		local: 0,
		failovers: 0,
		ticket: "",
		ticketExp: 0,
		lastEndpoint: "",
		lastUrl: "",
		lastError: ""
	};

	function pathOf(input) {
		var raw = typeof input === "string" ? input : (input && input.url) || "";
		if (!raw) return "";
		var path = raw;
		try {
			var parsed = new URL(raw, window.location.href);
			/* Same-origin absolute URLs are asked about too; foreign URLs never. */
			if (parsed.origin !== window.location.origin) return "";
			path = parsed.pathname;
		} catch (_) { return ""; }
		for (var i = 0; i < AI_PATHS.length; i++) {
			if (path === AI_PATHS[i]) return path;
		}
		return "";
	}

	/* The same-origin path AND query: a rotated GET keeps its query string. */
	function targetOf(input) {
		var raw = typeof input === "string" ? input : (input && input.url) || "";
		if (!raw) return "";
		try {
			var parsed = new URL(raw, window.location.href);
			if (parsed.origin !== window.location.origin) return "";
			return parsed.pathname + parsed.search;
		} catch (_) { return ""; }
	}

	function isRelayPath(path) {
		return path === ENDPOINT_PATH || path.indexOf("/api/relay/") === 0;
	}

	function headersToObject(headers) {
		var out = {};
		if (!headers) return out;
		if (typeof Headers !== "undefined" && headers instanceof Headers) {
			headers.forEach(function (value, key) { out[key] = value; });
		} else if (Array.isArray(headers)) {
			headers.forEach(function (pair) { if (pair && pair.length === 2) out[pair[0]] = pair[1]; });
		} else if (typeof headers === "object") {
			for (var key in headers) {
				if (Object.prototype.hasOwnProperty.call(headers, key)) out[key] = headers[key];
			}
		}
		return out;
	}

	function copyInit(init) {
		var out = {};
		if (init) {
			for (var prop in init) {
				if (Object.prototype.hasOwnProperty.call(init, prop) && prop !== "headers") out[prop] = init[prop];
			}
		}
		return out;
	}

	/* A streamed body cannot be replayed: such a request is tried exactly once. */
	function bodyCanRetry(init) {
		var body = init && init.body;
		if (!body) return true;
		if (typeof body === "string") return true;
		if (typeof Blob === "function" && body instanceof Blob) return true;
		if (typeof FormData === "function" && body instanceof FormData) return true;
		if (typeof URLSearchParams === "function" && body instanceof URLSearchParams) return true;
		return false;
	}

	function shouldFailover(response) {
		return !response || response.status === 502 || response.status === 503 || response.status === 504;
	}

	function fullUrl(given, search) {
		var url = String(given && given.url || "");
		if (!url) return "";
		if (search && url.indexOf("?") === -1) return url + search;
		return url;
	}

	/*
	 * Ask the UI Worker which URL runs this pipeline call. The answer is the
	 * rotation: this function never chooses anything, it only waits.
	 */
	function askForUrl(path, failedId) {
		var query = ENDPOINT_PATH + "?path=" + encodeURIComponent(path);
		if (failedId) query += "&failed=" + encodeURIComponent(failedId);
		var controller = typeof AbortController === "function" ? new AbortController() : null;
		var timer = setTimeout(function () { if (controller) controller.abort(); }, ASK_TIMEOUT_MS);
		var headers = { "Accept": "application/json" };
		/*
		 * A failure report is only trusted by the server when it carries the
		 * ticket of the answer that handed out the URL, so send it (and only
		 * it) while reporting.
		 */
		if (failedId && state.ticket) headers[TICKET_HEADER] = state.ticket;
		state.asked += 1;
		return nativeFetch(query, {
			method: "GET",
			credentials: "same-origin",
			cache: "no-store",
			headers: headers,
			signal: controller ? controller.signal : undefined
		}).then(function (response) {
			clearTimeout(timer);
			if (!response || !response.ok) return null;
			return response.json();
		}).then(function (data) {
			if (!data || data.success === false || !data.url) return null;
			if (typeof data.ticket === "string" && data.ticket) {
				state.ticket = data.ticket;
				state.ticketExp = Number(data.expiresAt) || 0;
			}
			state.lastEndpoint = String(data.endpointId || "");
			state.lastUrl = String(data.url || "");
			return data;
		}).catch(function (error) {
			clearTimeout(timer);
			state.lastError = (error && error.message) || "endpoint lookup failed";
			return null;
		});
	}

	/* Call exactly the URL the server gave. */
	function callGiven(given, input, init, search) {
		if (given.local) {
			state.local += 1;
			/* This Worker's own origin: the original request, cookies included. */
			return nativeFetch(input, init);
		}
		var target = fullUrl(given, search);
		if (!target) {
			state.local += 1;
			return nativeFetch(input, init);
		}
		var options = copyInit(init);
		var headers = headersToObject(init && init.headers);
		if (given.ticket || state.ticket) headers[TICKET_HEADER] = given.ticket || state.ticket;
		options.headers = headers;
		/* A backup has no cookie for this origin; never pretend otherwise. */
		options.credentials = "omit";
		options.mode = "cors";
		state.rotated += 1;
		return nativeFetch(target, options);
	}

	window.fetch = function (input, init) {
		var path = pathOf(input);
		if (!path || isRelayPath(path)) return nativeFetch(input, init);
		if (window.navigator && window.navigator.onLine === false) return nativeFetch(input, init);

		var search = "";
		try {
			var parsed = new URL(targetOf(input) || path, window.location.href);
			search = parsed.search || "";
		} catch (_) { search = ""; }

		function attempt(given, depth) {
			return callGiven(given, input, init, search).then(function (response) {
				if (given.local || !shouldFailover(response) || depth >= MAX_ASK_ATTEMPTS || !bodyCanRetry(init)) {
					return response;
				}
				state.failovers += 1;
				state.lastError = "HTTP " + response.status + " from " + (given.endpointId || given.url);
				return askForUrl(path, given.endpointId).then(function (next) {
					return next ? attempt(next, depth + 1) : nativeFetch(input, init);
				});
			}, function (error) {
				if (given.local || depth >= MAX_ASK_ATTEMPTS || !bodyCanRetry(init)) throw error;
				state.failovers += 1;
				state.lastError = (error && error.message) || "relay call failed";
				return askForUrl(path, given.endpointId).then(function (next) {
					return next ? attempt(next, depth + 1) : nativeFetch(input, init);
				});
			});
		}

		/* Ask first, wait, then call whatever URL came back. */
		return askForUrl(path).then(function (given) {
			if (!given) {
				state.local += 1;
				return nativeFetch(input, init);
			}
			return attempt(given, 1);
		});
	};

	/* Public, read-only handle used by diagnostics and tests. */
	window.__yvsApiRotation = {
		ask: function (path, failedId) { return askForUrl(String(path || ""), failedId || ""); },
		stats: function () {
			return {
				asked: state.asked,
				rotated: state.rotated,
				local: state.local,
				failovers: state.failovers,
				endpoint: state.lastEndpoint,
				url: state.lastUrl,
				lastError: state.lastError
			};
		}
	};
})();
`;
