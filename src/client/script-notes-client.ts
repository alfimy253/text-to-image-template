/*
 * SCRIPT NOTE MEMORY (browser) — the fastest place to keep a note.
 *
 * The Worker keeps notes in KV (authoritative, shared, survives every reload
 * and every device), but a KV read is still a network round trip: 30-200 ms
 * before a single token is written. The browser already knows the keyword set
 * the user just picked and the beats the worker planned, so it keeps its own
 * copy and hands it back with the next request:
 *
 *   localStorage  → full note (keyword set, beat plan, script, timings),
 *                   24 entries, 256 KB, 7-day TTL. A hit is a synchronous
 *                   property read (microseconds, no network).
 *   cookie        → compact mirror of the newest note (~3.4 KB) so the note
 *                   still survives when localStorage is unavailable (Safari
 *                   private mode, storage disabled, quota exhausted) and so
 *                   the server can be told "this browser already has a note".
 *   memory        → in-page map for the current session, used even when both
 *                   storage backends throw.
 *
 * The result: the FIRST script run can skip the planner (the browser carries
 * the validated set + beat plan), which is what removes the serial
 * planner→writer chain instead of merely hiding it.
 */
export const SCRIPT_NOTES_CLIENT_JS = String.raw`
function createScriptNoteMemory(win) {
	var LS_KEY = "ytvs.script-notes.v1";
	var COOKIE_NAME = "ytvs_note";
	var MAX_ENTRIES = 24;
	var MAX_BYTES = 262144;
	var TTL_MS = 7 * 24 * 60 * 60 * 1000;
	var COOKIE_MAX_CHARS = 3400;
	var WORDS_PER_MINUTE = { "super fast": 210, fast: 170, medium: 140, slow: 110 };
	var memory = {};
	var order = [];
	var cookieBroken = false, localBroken = false;
	var stats = { hits: 0, misses: 0, memoryHits: 0, localHits: 0, cookieHits: 0, writes: 0, errors: 0, bytes: 0 };

	var TRACKING = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
		"gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "igshid", "ref", "ref_src", "referrer",
		"session", "sessionid", "sid", "tracking", "timestamp", "_t"];

	/*
	 * Same canonicalization as the Worker (src/modules/script-notes.ts): the
	 * browser key and the KV note id must collapse the same dynamic-URL noise,
	 * or the two copies would drift apart.
	 */
	function canonicalUrl(raw) {
		var text = String(raw == null ? "" : raw).trim();
		if (!text) return "";
		if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
			if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\//i.test(text)) text = "https://" + text;
			else return "";
		}
		var parsed;
		try { parsed = new URL(text); } catch (_) { return ""; }
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
		var keep = [];
		parsed.searchParams.forEach(function (value, name) {
			if (TRACKING.indexOf(String(name).toLowerCase()) >= 0) return;
			keep.push([name, value]);
		});
		keep.sort(function (a, b) { return a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1; });
		var search = keep.length ? "?" + keep.map(function (pair) {
			return encodeURIComponent(pair[0]) + (pair[1] ? "=" + encodeURIComponent(pair[1]) : "");
		}).join("&") : "";
		var path = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "");
		var host = parsed.hostname.toLowerCase().replace(/^www\./, "");
		var port = parsed.port && parsed.port !== "80" && parsed.port !== "443" ? ":" + parsed.port : "";
		return parsed.protocol + "//" + host + port + (path || "/") + search;
	}

	function normalizeTopic(topic) {
		return String(topic == null ? "" : topic).replace(/\s+/g, " ").trim().toLowerCase().slice(0, 160);
	}

	function keyFor(input) {
		var source = input || {};
		var url = canonicalUrl(source.sourceUrl || source.url);
		var minutes = Number(source.minutes) > 0 ? Math.round(Number(source.minutes)) : 1;
		var speed = String(source.speed || "medium").toLowerCase().trim() || "medium";
		return (url ? "u:" + url : "t:" + normalizeTopic(source.topic)) + "|" + minutes + "|" + speed;
	}

	/* Beat plan from the headings the user just picked (no model, no network). */
	function outlineFor(keywordSet, minutes, speed) {
		var set = keywordSet || {};
		var headings = Array.isArray(set.headings) ? set.headings.filter(Boolean).slice(0, 6) : [];
		if (!headings.length) return [];
		var target = (WORDS_PER_MINUTE[String(speed || "medium")] || 140) * (Number(minutes) > 0 ? Number(minutes) : 1);
		var per = Math.max(18, Math.round(target / headings.length));
		return headings.map(function (heading, index) {
			return {
				heading: String(heading).slice(0, 110),
				words: per,
				beat: index === 0 ? "Open here and connect it to the viewer's situation."
					: index === headings.length - 1 ? "Close here and land the takeaway."
					: "Cover this section in order; keep it concrete."
			};
		});
	}

	function safeParse(raw) {
		if (!raw) return null;
		try { var parsed = JSON.parse(raw); return parsed && typeof parsed === "object" ? parsed : null; }
		catch (_) { return null; }
	}

	function readLocal() {
		if (localBroken) return {};
		try {
			var store = win.localStorage;
			if (!store) { localBroken = true; return {}; }
			var parsed = safeParse(store.getItem(LS_KEY));
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch (error) { localBroken = true; stats.errors++; return {}; }
	}

	function writeLocal(map, keys) {
		if (localBroken) return false;
		var payload = JSON.stringify(map);
		for (var attempt = 0; attempt < 2; attempt++) {
			try {
				win.localStorage.setItem(LS_KEY, payload);
				stats.bytes = payload.length;
				return true;
			} catch (error) {
				stats.errors++;
				/* Quota: drop the oldest half and try once more. */
				keys = keys.slice(0, Math.max(1, Math.floor(keys.length / 2)));
				map = {};
				for (var i = 0; i < keys.length; i++) map[keys[i]] = memory[keys[i]];
				payload = JSON.stringify(map);
				if (!keys.length) break;
			}
		}
		localBroken = true;
		return false;
	}

	function readCookie() {
		if (cookieBroken) return null;
		try {
			var doc = win.document;
			if (!doc || typeof doc.cookie !== "string") return null;
			var parts = doc.cookie ? doc.cookie.split(";") : [];
			for (var i = 0; i < parts.length; i++) {
				var piece = parts[i].trim();
				if (piece.indexOf(COOKIE_NAME + "=") !== 0) continue;
				var value = decodeURIComponent(piece.slice(COOKIE_NAME.length + 1));
				return safeParse(value);
			}
			return null;
		} catch (error) { cookieBroken = true; stats.errors++; return null; }
	}

	function cookiePayload(entry) {
		/* Compact form: no source facts, no script, at most four beats. */
		return {
			k: entry.key,
			i: entry.noteId || "",
			t: entry.topic || "",
			u: entry.sourceUrl || "",
			m: entry.minutes || 1,
			s: entry.speed || "medium",
			at: entry.updatedAt || Date.now(),
			kw: entry.keywordSet || null,
			o: (entry.outline || []).slice(0, 4).map(function (beat) {
				return { h: beat.heading || "", b: beat.beat || "", w: Number(beat.words) || 0 };
			})
		};
	}

	function writeCookie(entry) {
		if (cookieBroken) return false;
		try {
			var doc = win.document;
			if (!doc) { cookieBroken = true; return false; }
			var payload = cookiePayload(entry);
			var encoded = encodeURIComponent(JSON.stringify(payload));
			if (encoded.length > COOKIE_MAX_CHARS) {
				payload.o = payload.o.slice(0, 2);
				encoded = encodeURIComponent(JSON.stringify(payload));
			}
			if (encoded.length > COOKIE_MAX_CHARS) {
				payload.o = [];
				encoded = encodeURIComponent(JSON.stringify(payload));
			}
			if (encoded.length > COOKIE_MAX_CHARS) {
				payload.kw = null;
				encoded = encodeURIComponent(JSON.stringify(payload));
			}
			if (encoded.length > COOKIE_MAX_CHARS) return false;
			var maxAge = Math.floor(TTL_MS / 1000);
			doc.cookie = COOKIE_NAME + "=" + encoded + "; Max-Age=" + maxAge + "; Path=/; SameSite=Lax";
			return true;
		} catch (error) { cookieBroken = true; stats.errors++; return false; }
	}

	function decodeCookieEntry(packed) {
		if (!packed || !packed.k) return null;
		return {
			key: packed.k,
			noteId: packed.i || null,
			topic: packed.t || "",
			sourceUrl: packed.u || "",
			minutes: Number(packed.m) || 1,
			speed: packed.s || "medium",
			updatedAt: Number(packed.at) || 0,
			keywordSet: packed.kw || null,
			outline: (packed.o || []).map(function (beat) {
				return { heading: beat.h || "", beat: beat.b || "", words: Number(beat.w) || 0 };
			}),
			source: "cookie"
		};
	}

	function remember(key, entry) {
		memory[key] = entry;
		order = order.filter(function (existing) { return existing !== key; });
		order.push(key);
		while (order.length > MAX_ENTRIES) {
			var evicted = order.shift();
			delete memory[evicted];
		}
	}

	function get(input) {
		var key = typeof input === "string" ? input : keyFor(input);
		if (!key) { stats.misses++; return null; }
		var now = Date.now();
		var entry = memory[key] || null;
		var source = entry ? "memory" : "";
		if (!entry) {
			var stored = readLocal()[key];
			if (stored && typeof stored === "object") { entry = stored; source = "local"; }
		}
		if (!entry) {
			var packed = readCookie();
			var fromCookie = decodeCookieEntry(packed);
			if (fromCookie && fromCookie.key === key) { entry = fromCookie; source = "cookie"; }
		}
		var freshness = entry ? Number(entry.updatedAt) : 0;
		if (!entry || !freshness || now - freshness > TTL_MS) {
			stats.misses++;
			return null;
		}
		remember(key, entry);
		stats.hits++;
		if (source === "local") stats.localHits++;
		else if (source === "cookie") stats.cookieHits++;
		else stats.memoryHits++;
		var copy = JSON.parse(JSON.stringify(entry));
		copy.source = source;
		return copy;
	}

	function put(input) {
		var entry = input || {};
		var key = entry.key || keyFor(entry);
		if (!key) return null;
		var stored = {
			key: key,
			noteId: entry.noteId || null,
			topic: String(entry.topic || "").slice(0, 160),
			sourceUrl: canonicalUrl(entry.sourceUrl || entry.url),
			minutes: Number(entry.minutes) > 0 ? Math.round(Number(entry.minutes)) : 1,
			speed: String(entry.speed || "medium").toLowerCase(),
			keywordSet: entry.keywordSet || null,
			outline: Array.isArray(entry.outline) ? entry.outline.slice(0, 6) : [],
			script: typeof entry.script === "string" ? entry.script.slice(0, 20000) : null,
			durationMs: Number(entry.durationMs) || 0,
			updatedAt: Date.now()
		};
		remember(key, stored);
		var map = readLocal();
		map[key] = stored;
		var keys = Object.keys(map).sort(function (a, b) {
			return (Number(map[b].updatedAt) || 0) - (Number(map[a].updatedAt) || 0);
		}).slice(0, MAX_ENTRIES);
		var pruned = {};
		for (var i = 0; i < keys.length; i++) pruned[keys[i]] = map[keys[i]];
		writeLocal(pruned, keys);
		writeCookie(stored);
		stats.writes++;
		return JSON.parse(JSON.stringify(stored));
	}

	function remove(input) {
		var key = typeof input === "string" ? input : keyFor(input);
		if (!key) return false;
		delete memory[key];
		order = order.filter(function (existing) { return existing !== key; });
		var map = readLocal();
		if (map[key]) { delete map[key]; writeLocal(map, Object.keys(map)); }
		return true;
	}

	function clear() {
		memory = {};
		order = [];
		if (!localBroken) {
			try { win.localStorage.removeItem(LS_KEY); } catch (_) {}
		}
		if (!cookieBroken) {
			try { win.document.cookie = COOKIE_NAME + "=; Max-Age=0; Path=/; SameSite=Lax"; } catch (_) {}
		}
	}

	return {
		canonicalUrl: canonicalUrl,
		keyFor: keyFor,
		outlineFor: outlineFor,
		get: get,
		put: put,
		remove: remove,
		clear: clear,
		stats: function () {
			return {
				hits: stats.hits, misses: stats.misses, memoryHits: stats.memoryHits,
				localHits: stats.localHits, cookieHits: stats.cookieHits,
				writes: stats.writes, errors: stats.errors, bytes: stats.bytes,
				localStorage: !localBroken, cookie: !cookieBroken, entries: order.length
			};
		}
	};
}
`;
