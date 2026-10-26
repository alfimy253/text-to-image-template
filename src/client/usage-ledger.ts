/**
 * #261: browser-only usage record.
 *
 * Bug fix #261 records what THIS browser generated today in localStorage and a
 * short-lived cookie. It is a convenience/history record, not an accounting or
 * authorization authority: records live on the user's device, can be cleared,
 * and are never sent to the Worker to grant credits. The Worker still checks
 * the existing KV counters and authentication on every metered request, and
 * `/api/credits` remains the server-side source of truth.
 *
 * Stored data is deliberately minimal: per-kind success counts, a random
 * in-memory tab id, a date, and the last few kind/outcome timestamps. No
 * prompts, scripts, audio, images, usernames, emails or cookies are stored.
 * Storage failures (private mode, disabled storage, quota, cookie blocking)
 * degrade to memory-only and never block generation.
 */
export const BROWSER_USAGE_JS = String.raw`
function createStudioUsage(win) {
	var VERSION = 261, PREFIX = "yvs-usage-261", COOKIE = "yvs_usage_261";
	var KINDS = ["images", "scripts", "voiceovers", "videos"];
	var MAX_EVENTS = 40, MAX_TABS = 24, DAY_MS = 86400000;
	var tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);
	var memory = null, server = null;
	function emptyCounts() {
		var counts = {};
		for (var i = 0; i < KINDS.length; i++) counts[KINDS[i]] = 0;
		return counts;
	}
	/* Counters roll over at Asia/Taipei midnight, matching the Worker's day. */
	function taipeiDay(now) {
		return new Date((now || Date.now()) + 8 * 3600000).toISOString().slice(0, 10);
	}
	function blank() {
		return { v: VERSION, day: taipeiDay(), tab: tabId, counts: emptyCounts(), events: [] };
	}
	var storage = (function () {
		try {
			var candidate = win.localStorage;
			if (!candidate) return null;
			var probe = PREFIX + ":probe";
			candidate.setItem(probe, "1");
			candidate.removeItem(probe);
			return candidate;
		} catch (error) {
			return null;
		}
	})();
	function keyFor(id) {
		return PREFIX + ":tab:" + id;
	}
	function count(value) {
		var number = Math.floor(Number(value) || 0);
		return number < 0 ? 0 : number > 100000 ? 100000 : number;
	}
	function parse(raw) {
		try {
			var value = typeof raw === "string" ? JSON.parse(raw) : raw;
			if (!value || value.v !== VERSION || typeof value.tab !== "string" || !value.counts) return null;
			var counts = emptyCounts();
			for (var i = 0; i < KINDS.length; i++) counts[KINDS[i]] = count(value.counts[KINDS[i]]);
			var events = [];
			if (Array.isArray(value.events)) {
				value.events.slice(-MAX_EVENTS).forEach(function (event) {
					if (!event || typeof event !== "object" || KINDS.indexOf(event.k) < 0) return;
					events.push({ t: count(event.t), k: event.k, o: event.o === "error" ? "error" : "ok", n: Math.max(1, Math.min(100, count(event.n) || 1)) });
				});
			}
			return {
				v: VERSION,
				day: typeof value.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.day) ? value.day : taipeiDay(),
				tab: value.tab, counts: counts, events: events
			};
		} catch (error) {
			return null;
		}
	}
	function readTabKey(key) {
		if (!storage) return null;
		try {
			return parse(storage.getItem(key));
		} catch (error) {
			return null;
		}
	}
	function own() {
		var state = storage ? readTabKey(keyFor(tabId)) : memory;
		if (!state) state = blank();
		if (state.day !== taipeiDay()) state = blank();
		memory = state;
		return state;
	}
	function save(state) {
		memory = state;
		if (!storage) return;
		try {
			var copy = {
				v: VERSION, day: state.day, tab: tabId,
				counts: state.counts, events: state.events.slice(-MAX_EVENTS)
			};
			var text = JSON.stringify(copy);
			/* Keep the record small: cookies and storage have tight quotas. */
			while (text.length > 3500 && copy.events.length) {
				copy.events.shift();
				text = JSON.stringify(copy);
			}
			storage.setItem(keyFor(tabId), text);
		} catch (error) {
			/* Quota or storage revoked mid-session: keep this tab's counts in memory. */
		}
	}
	function cleanup() {
		if (!storage) return;
		try {
			var keys = [];
			for (var i = 0; i < storage.length; i++) {
				var key = storage.key(i);
				if (key && key.indexOf(PREFIX + ":tab:") === 0) keys.push(key);
			}
			var fresh = taipeiDay(), previous = taipeiDay(Date.now() - DAY_MS);
			for (var j = 0; j < keys.length; j++) {
				if (keys[j] === keyFor(tabId)) continue;
				var value = readTabKey(keys[j]);
				if (!value || (value.day !== fresh && value.day !== previous) || keys.length - j > MAX_TABS) {
					storage.removeItem(keys[j]);
				}
			}
		} catch (error) {
			/* cleanup is best effort */
		}
	}
	/* Every tab owns one key, so simultaneous tabs append instead of overwriting. */
	function totals() {
		var local = own(), sum = emptyCounts(), i, j;
		for (i = 0; i < KINDS.length; i++) sum[KINDS[i]] = local.counts[KINDS[i]];
		if (!storage) return sum;
		try {
			for (j = 0; j < storage.length; j++) {
				var key = storage.key(j);
				if (!key || key.indexOf(PREFIX + ":tab:") !== 0 || key === keyFor(tabId)) continue;
				var value = readTabKey(key);
				if (!value || value.day !== local.day) continue;
				for (i = 0; i < KINDS.length; i++) sum[KINDS[i]] = count(sum[KINDS[i]] + value.counts[KINDS[i]]);
			}
		} catch (error) {
			/* ignore enumeration failures */
		}
		return sum;
	}
	function writeCookie(counts) {
		try {
			if (!win.document) return;
			var value = ["v=" + VERSION, "d=" + taipeiDay(), "i=" + counts.images,
				"s=" + counts.scripts, "o=" + counts.voiceovers, "m=" + counts.videos].join(";");
			var secure = win.location && win.location.protocol === "https:" ? "; Secure" : "";
			/* Counts only: no identity, no content; expires with the two-day record. */
			win.document.cookie = COOKIE + "=" + encodeURIComponent(value) +
				"; Max-Age=172800; Path=/; SameSite=Lax" + secure;
		} catch (error) {
			/* cookie blocking is fine: this is a display record */
		}
	}
	function snapshot() {
		var local = own(), counts = totals(), saved = readServer();
		return {
			version: VERSION,
			day: local.day,
			local: counts,
			persisted: Boolean(storage),
			events: local.events.length,
			server: saved ? {
				day: saved.day, plan: saved.plan, used: saved.used,
				remaining: saved.remaining, at: saved.at
			} : null
		};
	}
	function record(kind, outcome, amount) {
		if (KINDS.indexOf(kind) < 0) return snapshot();
		var ok = outcome !== "error" && outcome !== "cancelled";
		var n = Math.max(1, Math.min(100, Math.floor(Number(amount) || 1)));
		var state = own();
		if (ok) state.counts[kind] = count(state.counts[kind] + n);
		state.events.push({ t: Math.floor(Date.now() / 1000), k: kind, o: ok ? "ok" : "error", n: n });
		state.events = state.events.slice(-MAX_EVENTS);
		save(state);
		cleanup();
		writeCookie(totals());
		return snapshot();
	}
	function readServer() {
		if (server) return server;
		if (!storage) return null;
		try {
			var raw = storage.getItem(PREFIX + ":server");
			var value = raw ? JSON.parse(raw) : null;
			if (value && value.v === VERSION) server = value;
		} catch (error) {
			/* ignore */
		}
		return server;
	}
	/* Mirrors the Worker's /api/credits summary locally; stores no identity. */
	function observe(data) {
		if (!data || !data.plan || !data.remaining) return null;
		var summary = { v: VERSION, at: Date.now(), day: typeof data.day === "string" ? data.day : taipeiDay(),
			plan: { id: String(data.plan.id || ""), label: String(data.plan.label || "").slice(0, 40) },
			used: {}, remaining: {} };
		for (var i = 0; i < KINDS.length; i++) {
			summary.used[KINDS[i]] = count(data.used && data.used[KINDS[i]]);
			var left = data.remaining[KINDS[i]];
			summary.remaining[KINDS[i]] = left === null || left === undefined ? null : count(left);
		}
		server = summary;
		if (storage) {
			try {
				storage.setItem(PREFIX + ":server", JSON.stringify(summary));
			} catch (error) {
				/* display only */
			}
		}
		return summary;
	}
	async function sync() {
		var controller = typeof win.AbortController === "function" ? new win.AbortController() : null;
		var timer = null;
		try {
			var options = { credentials: "same-origin", cache: "no-store" };
			if (controller) options.signal = controller.signal;
			var deadline = new Promise(function (_, reject) {
				timer = win.setTimeout(function () {
					if (controller) {
						try { controller.abort(); } catch (abortError) {}
					}
					reject(new Error("Credit refresh timed out"));
				}, 10000);
			});
			var response = await Promise.race([win.fetch("/api/credits", options), deadline]);
			if (!response || !response.ok) return null;
			return observe(await response.json());
		} catch (error) {
			return null;
		} finally {
			win.clearTimeout(timer);
		}
	}
	function clear() {
		memory = blank();
		server = null;
		if (storage) {
			try {
				storage.removeItem(keyFor(tabId));
				storage.removeItem(PREFIX + ":server");
			} catch (error) {
				/* ignore */
			}
		}
		try {
			if (win.document) win.document.cookie = COOKIE + "=; Max-Age=0; Path=/";
		} catch (error) {
			/* ignore */
		}
		return snapshot();
	}
	function describe() {
		var counts = snapshot().local, parts = [];
		var labels = { images: ["image", "images"], scripts: ["script", "scripts"],
			voiceovers: ["voiceover", "voiceovers"], videos: ["MP4", "MP4s"] };
		for (var i = 0; i < KINDS.length; i++) {
			var kind = KINDS[i], n = counts[kind];
			if (n) parts.push(n + " " + (n === 1 ? labels[kind][0] : labels[kind][1]));
		}
		return parts.join(", ");
	}
	cleanup();
	readServer();
	return {
		version: VERSION, cookieName: COOKIE, storagePrefix: PREFIX,
		record: record, observe: observe, sync: sync, clear: clear,
		snapshot: snapshot, describe: describe
	};
}
const studioUsage = createStudioUsage(window);
/* Console/debug handle; testable without exposing any server authority. */
window.__STUDIO_USAGE = studioUsage;
`;
