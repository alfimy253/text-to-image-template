/*
 * SCRIPT NOTE MEMORY (browser) — RULE 35 (2026-11-03): THE ONLY DURABLE
 * STORE FOR SCRIPT DETAILS.
 *
 * Script details (narration text, SEO keyword set, beat plan, note id and
 * timings) are NEVER written to Cloudflare KV by the Worker. The Worker keeps
 * only an ephemeral, per-isolate job ledger and throws it away on restart.
 * This module is the durable owner of the note:
 *
 *   localStorage  → full note (`ytvs.script-notes.v1`), 24 entries, 7-day TTL.
 *   cookie        → compact mirror of the newest note (`ytvs_note`, <=3.4 KB)
 *                   with a digest of the FULL note, the script length and a
 *                   short script preview, so a note survives private mode,
 *                   disabled storage or a quota error.
 *   memory        → in-page map for the current session.
 *
 * CONSISTENCY CONTRACT (the "checks" the requirement asks for):
 *   1. every note carries `h`, an FNV-1a digest over its canonical content
 *      (including the full script text), and `v`, a schema version;
 *   2. `put()` writes memory, localStorage AND the cookie, then READS BOTH
 *      back and compares key / digest / timestamp / script length — a failed
 *      or partial write is repaired immediately;
 *   3. `get()` cross-checks localStorage against the cookie on every read and
 *      reconciles them: the newest non-corrupt copy wins, the lagging store is
 *      rewritten, and a cookie-only note is restored into localStorage;
 *   4. a digest that does not match its own entry means corruption — that
 *      entry is ignored and rebuilt from the other store;
 *   5. `check()` is a public verification/repair pass and `stats()` exposes
 *      checks / mismatches / repairs / digestFailures / scriptChecks;
 *   6. a `storage` event from another tab invalidates the in-page map so the
 *      next read re-verifies both persistent stores.
 *
 * The result: the FIRST script run can skip the planner (the browser carries
 * the validated set + beat plan), which is what removes the serial
 * planner→writer chain instead of merely hiding it.
 */
export const SCRIPT_NOTES_CLIENT_JS = String.raw`
function createScriptNoteMemory(win) {
	var LS_KEY = "ytvs.script-notes.v1";
	var COOKIE_NAME = "ytvs_note";
	var NOTE_VERSION = 2;
	var MAX_ENTRIES = 24;
	var MAX_BYTES = 262144;
	var TTL_MS = 7 * 24 * 60 * 60 * 1000;
	var COOKIE_MAX_CHARS = 3400;
	var SCRIPT_PREVIEW_CHARS = 480;
	var WORDS_PER_MINUTE = { "super fast": 210, fast: 170, medium: 140, slow: 110 };
	var memory = {};
	var order = [];
	var cookieBroken = false, localBroken = false;
	var stats = {
		hits: 0, misses: 0, memoryHits: 0, localHits: 0, cookieHits: 0,
		writes: 0, errors: 0, bytes: 0,
		checks: 0, mismatches: 0, repairs: 0, digestFailures: 0, scriptChecks: 0
	};

	var TRACKING = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
		"gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "igshid", "ref", "ref_src", "referrer",
		"session", "sessionid", "sid", "tracking", "timestamp", "_t"];

	/*
	 * Same canonicalization as the Worker (src/modules/script-notes.ts): the
	 * browser key and the note id must collapse the same dynamic-URL noise,
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

	/* --------------------------------------------------------------------- */
	/* CONSISTENCY: canonical form, digest and integrity                      */
	/* --------------------------------------------------------------------- */

	/* Deterministic stringify: object key order must not change the digest. */
	function stable(value) {
		if (value === null || value === undefined) return "";
		if (typeof value !== "object") return String(value);
		if (Array.isArray(value)) {
			var items = [];
			for (var i = 0; i < value.length; i++) items.push(stable(value[i]));
			return "[" + items.join(",") + "]";
		}
		var keys = Object.keys(value).sort();
		var parts = [];
		for (var k = 0; k < keys.length; k++) parts.push(keys[k] + ":" + stable(value[keys[k]]));
		return "{" + parts.join(",") + "}";
	}

	function digestPayload(entry) {
		return {
			key: String(entry.key || ""),
			noteId: String(entry.noteId || ""),
			topic: String(entry.topic || ""),
			sourceUrl: String(entry.sourceUrl || ""),
			minutes: Number(entry.minutes) || 1,
			speed: String(entry.speed || "medium"),
			keywordSet: entry.keywordSet || null,
			outline: entry.outline || [],
			script: typeof entry.script === "string" ? entry.script : "",
			durationMs: Number(entry.durationMs) || 0,
			updatedAt: Number(entry.updatedAt) || 0
		};
	}

	/* FNV-1a over the FULL note (script text included). */
	function digestOf(entry) {
		var text = "v" + NOTE_VERSION + "|" + stable(digestPayload(entry));
		var hash = 0x811c9dc5;
		for (var i = 0; i < text.length; i++) {
			hash ^= text.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return ("00000000" + hash.toString(16)).slice(-8) + "-" + text.length.toString(16);
	}

	/* One canonical stored shape, whatever store the raw value came from. */
	function normalizeEntry(raw, key) {
		if (!raw || typeof raw !== "object") return null;
		var entry = {
			key: String(raw.key || key || ""),
			noteId: raw.noteId || null,
			topic: String(raw.topic || "").slice(0, 160),
			sourceUrl: canonicalUrl(raw.sourceUrl || raw.u || ""),
			minutes: Number(raw.minutes || raw.m) > 0 ? Math.round(Number(raw.minutes || raw.m)) : 1,
			speed: String(raw.speed || raw.s || "medium").toLowerCase(),
			keywordSet: raw.keywordSet || raw.kw || null,
			outline: Array.isArray(raw.outline) ? raw.outline.slice(0, 6) : (Array.isArray(raw.o) ? raw.o : []),
			script: typeof raw.script === "string" ? raw.script.slice(0, 20000) : (typeof raw.sp === "string" ? raw.sp : null),
			durationMs: Number(raw.durationMs) || 0,
			updatedAt: Number(raw.updatedAt || raw.at) || Date.now(),
			v: NOTE_VERSION,
			partial: Boolean(raw.partial)
		};
		if (!entry.key) return null;
		/* A cookie mirror carries the digest of the FULL localStorage note;
		 * keep it instead of re-hashing the compact payload. */
		entry.h = String(raw.h || "") || digestOf(entry);
		return entry;
	}

	/* localStorage is the FULL note; the cookie is a compact mirror. */
	function readLocal() {
		if (localBroken) return {};
		try {
			var store = win.localStorage;
			if (!store) { localBroken = true; return {}; }
			var parsed = safeParse(store.getItem(LS_KEY));
			return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
		} catch (error) { localBroken = true; stats.errors++; return {}; }
	}

	function writeLocal(map, keys) {
		if (localBroken) return false;
		var payload = JSON.stringify(map);
		if (payload.length > MAX_BYTES) {
			/* Enforce the 256 KB ceiling by dropping the oldest entries. */
			keys = keys.slice(0, Math.max(1, Math.floor(keys.length / 2)));
			var pruned = {};
			for (var j = 0; j < keys.length; j++) pruned[keys[j]] = map[keys[j]];
			map = pruned;
			payload = JSON.stringify(map);
		}
		for (var attempt = 0; attempt < 2; attempt++) {
			try {
				win.localStorage.setItem(LS_KEY, payload);
				stats.bytes = payload.length;
				return true;
			} catch (error) {
				stats.errors++;
				/* Quota: drop the oldest half and try once more. */
				keys = keys.slice(0, Math.max(1, Math.floor(keys.length / 2)));
				var reduced = {};
				for (var i = 0; i < keys.length; i++) reduced[keys[i]] = map[keys[i]];
				map = reduced;
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
		/* Compact mirror: no source facts, no full script, at most four beats.
		 * 'h' is the digest of the FULL localStorage note, 'sl' its script
		 * length and 'sp' a short preview - that is what makes the two stores
		 * comparable without putting 20 KB of narration into a cookie. */
		return {
			v: NOTE_VERSION,
			k: entry.key,
			i: entry.noteId || "",
			t: entry.topic || "",
			u: entry.sourceUrl || "",
			m: entry.minutes || 1,
			s: entry.speed || "medium",
			at: entry.updatedAt || Date.now(),
			h: entry.h || digestOf(entry),
			kw: entry.keywordSet || null,
			o: (entry.outline || []).slice(0, 4).map(function (beat) {
				return { h: beat.heading || "", b: beat.beat || "", w: Number(beat.words) || 0 };
			}),
			sp: typeof entry.script === "string" ? entry.script.slice(0, SCRIPT_PREVIEW_CHARS) : "",
			sl: typeof entry.script === "string" ? entry.script.length : 0
		};
	}

	function writeCookie(entry) {
		if (cookieBroken) return false;
		try {
			var doc = win.document;
			if (!doc) { cookieBroken = true; return false; }
			var payload = cookiePayload(entry);
			var encoded = encodeURIComponent(JSON.stringify(payload));
			/* Trim in order, but NEVER drop v/k/at/h/sl: those are the checks. */
			var trim = [
				function () { payload.sp = String(payload.sp || "").slice(0, 120); },
				function () { payload.o = payload.o.slice(0, 2); },
				function () { payload.o = []; },
				function () { payload.kw = null; },
				function () { payload.sp = ""; }
			];
			for (var t = 0; t < trim.length && encoded.length > COOKIE_MAX_CHARS; t++) {
				trim[t]();
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
			key: String(packed.k),
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
			script: typeof packed.sp === "string" ? packed.sp : "",
			scriptLength: Number(packed.sl) || 0,
			h: String(packed.h || ""),
			v: Number(packed.v) || 1,
			partial: true,
			source: "cookie"
		};
	}

	/* Compare one localStorage entry with the cookie mirror. */
	function consistencyReport(key, localEntry, cookieEntry) {
		var report = {
			key: key, checked: true, consistent: true, reason: "",
			localStorage: !localBroken, cookie: !cookieBroken,
			digest: "", scriptLength: 0, repaired: false
		};
		stats.checks++;
		if (!localEntry || !cookieEntry) {
			if (localEntry || cookieEntry) {
				report.consistent = false;
				report.reason = localEntry ? "cookie mirror missing" : "localStorage note missing";
			}
			return report;
		}
		var expected = localEntry.h || digestOf(localEntry);
		report.digest = expected;
		report.scriptLength = typeof localEntry.script === "string" ? localEntry.script.length : 0;
		var cookieAt = Number(cookieEntry.updatedAt) || 0;
		var localAt = Number(localEntry.updatedAt) || 0;
		var cookieSl = Number(cookieEntry.scriptLength) || 0;
		stats.scriptChecks++;
		if (String(cookieEntry.h || "") !== String(expected)) {
			report.consistent = false; report.reason = "digest mismatch";
		} else if (Number(cookieEntry.v || 1) !== NOTE_VERSION) {
			report.consistent = false; report.reason = "cookie schema version mismatch";
		} else if (cookieAt !== localAt) {
			report.consistent = false; report.reason = "timestamp mismatch";
		} else if (cookieSl > 0 && cookieSl !== report.scriptLength) {
			report.consistent = false; report.reason = "script length mismatch";
		} else if (cookieSl === 0 && report.scriptLength > 0) {
			report.consistent = false; report.reason = "script length missing from cookie";
		}
		return report;
	}

	/* Verify an entry's OWN digest (corruption / hand-edited storage). */
	function entryIsSound(entry) {
		if (!entry || typeof entry !== "object") return false;
		/* A compact cookie-only copy cannot be re-hashed: its digest belongs
		 * to the full note it mirrors, so it is trusted, not recomputed. */
		if (entry.partial) return true;
		if (!entry.h) return true; /* legacy v1 entry: no digest to verify */
		try {
			var ok = digestOf(entry) === String(entry.h);
			if (!ok) stats.digestFailures++;
			return ok;
		} catch (_) { stats.digestFailures++; return false; }
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

	/*
	 * THE RECONCILIATION PASS. Picks the newest sound copy, rewrites BOTH
	 * stores from it and returns the entry that should be served. No store is
	 * ever trusted without comparing its key, digest, timestamp and script
	 * length against the other one.
	 */
	function reconcile(key) {
		var map = readLocal();
		var rawLocal = map[key] || null;
		var cookieMatch = decodeCookieEntry(readCookie());
		if (cookieMatch && cookieMatch.key !== key) cookieMatch = null;
		var memoryEntry = memory[key] || null;
		var report = consistencyReport(key, rawLocal, cookieMatch);
		if (!report.consistent) stats.mismatches++;

		var candidates = [];
		if (memoryEntry && entryIsSound(memoryEntry)) candidates.push({ entry: memoryEntry, weight: 3 });
		if (rawLocal && entryIsSound(rawLocal)) candidates.push({ entry: rawLocal, weight: 2 });
		if (cookieMatch && (String(cookieMatch.h || "") || Number(cookieMatch.v || 1) === 1)) {
			candidates.push({ entry: cookieMatch, weight: 1 });
		}
		candidates.sort(function (a, b) {
			var delta = (Number(b.entry.updatedAt) || 0) - (Number(a.entry.updatedAt) || 0);
			return delta !== 0 ? delta : b.weight - a.weight;
		});
		var winner = candidates.length ? candidates[0].entry : null;
		if (!winner) return { entry: null, report: report };
		var canonical = normalizeEntry(winner, key);
		if (!canonical) return { entry: null, report: report };
		canonical.partial = Boolean(winner.partial);

		var localOk = rawLocal && entryIsSound(rawLocal) &&
			!canonical.partial &&
			String(rawLocal.h || "") === String(canonical.h) &&
			Number(rawLocal.updatedAt || 0) === Number(canonical.updatedAt);
		/* A compact cookie-only restore keeps the FULL script length in sl
		 * even though its script field is only a preview. */
		var expectedLength = canonical.partial
			? Number(cookieMatch ? cookieMatch.scriptLength : 0)
			: (typeof canonical.script === "string" ? canonical.script.length : 0);
		var cookieOk = cookieMatch &&
			String(cookieMatch.h || "") === String(canonical.h) &&
			Number(cookieMatch.updatedAt || 0) === Number(canonical.updatedAt) &&
			Number(cookieMatch.scriptLength || 0) === expectedLength;

		if (!localOk) {
			map[key] = canonical;
			var keys = Object.keys(map).sort(function (a, b) {
				return (Number(map[b].updatedAt) || 0) - (Number(map[a].updatedAt) || 0);
			}).slice(0, MAX_ENTRIES);
			var pruned = {};
			for (var i = 0; i < keys.length; i++) pruned[keys[i]] = map[keys[i]];
			if (writeLocal(pruned, keys)) stats.repairs++;
		}
		if (!cookieOk) {
			if (writeCookie(canonical)) stats.repairs++;
		}
		if (!localOk || !cookieOk) report.repaired = true;
		return { entry: canonical, report: report };
	}

	function get(input) {
		var key = typeof input === "string" ? input : keyFor(input);
		if (!key) { stats.misses++; return null; }
		var now = Date.now();
		/* Snapshot where each copy came from BEFORE the check can repair one. */
		var preMemory = memory[key] || null;
		var preLocal = readLocal()[key] || null;
		var preCookie = decodeCookieEntry(readCookie());
		if (preCookie && preCookie.key !== key) preCookie = null;

		/* CHECK 1: localStorage <-> cookie consistency, with repair. */
		var settled = reconcile(key);
		var entry = settled.entry;
		if (!entry) { stats.misses++; return null; }

		var source;
		if (preCookie && !preLocal && String(preCookie.h || "") === String(entry.h || "")) source = "cookie";
		else if (preMemory && entryIsSound(preMemory) && String(preMemory.h || "") === String(entry.h || "")) source = "memory";
		else if (preLocal && entryIsSound(preLocal) && String(preLocal.h || "") === String(entry.h || "")) source = "local";
		else source = entry.partial ? "cookie" : "local";

		var freshness = Number(entry.updatedAt) || 0;
		if (!freshness || now - freshness > TTL_MS) {
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
		var source = input || {};
		var key = source.key || keyFor(source);
		if (!key) return null;
		var stored = normalizeEntry({
			key: key,
			noteId: source.noteId || null,
			topic: source.topic,
			sourceUrl: source.sourceUrl || source.url,
			minutes: source.minutes,
			speed: source.speed,
			keywordSet: source.keywordSet || null,
			outline: Array.isArray(source.outline) ? source.outline.slice(0, 6) : [],
			script: typeof source.script === "string" ? source.script.slice(0, 20000) : null,
			durationMs: source.durationMs,
			updatedAt: Date.now()
		}, key);
		if (!stored) return null;
		remember(key, stored);
		var map = readLocal();
		map[key] = stored;
		var keys = Object.keys(map).sort(function (a, b) {
			return (Number(map[b].updatedAt) || 0) - (Number(map[a].updatedAt) || 0);
		}).slice(0, MAX_ENTRIES);
		var pruned = {};
		for (var i = 0; i < keys.length; i++) pruned[keys[i]] = map[keys[i]];
		var localWritten = writeLocal(pruned, keys);
		var cookieWritten = writeCookie(stored);
		stats.writes++;

		/* CHECK 2: read BOTH stores back. The FULL localStorage note is the
		 * authority: key, digest, timestamp and script length must all agree
		 * with the cookie mirror, or the lagging store is rewritten. */
		stats.checks++;
		stats.scriptChecks++;
		var backLocal = readLocal()[key] || null;
		var backCookie = decodeCookieEntry(readCookie());
		if (backCookie && backCookie.key !== key) backCookie = null;
		var scriptLength = typeof stored.script === "string" ? stored.script.length : 0;
		var agreed = Boolean(
			localWritten && cookieWritten && backLocal && backCookie &&
			String(backLocal.h || "") === String(stored.h) &&
			String(backCookie.h || "") === String(stored.h) &&
			Number(backLocal.updatedAt || 0) === Number(stored.updatedAt) &&
			Number(backCookie.updatedAt || 0) === Number(stored.updatedAt) &&
			Number(backCookie.scriptLength || 0) === scriptLength
		);
		if (!agreed) {
			stats.mismatches++;
			map[key] = stored;
			if (writeLocal(map, Object.keys(map))) stats.repairs++;
			if (writeCookie(stored)) stats.repairs++;
		}
		return JSON.parse(JSON.stringify(stored));
	}

	/* Public verification pass: run it after any external storage change. */
	function check(input) {
		var key = typeof input === "string" ? input : (input && input.key) || keyFor(input || {});
		var settled = reconcile(key);
		return {
			key: key,
			consistent: settled.report.consistent && !settled.report.repaired,
			reason: settled.report.reason,
			digest: settled.report.digest,
			scriptLength: settled.report.scriptLength,
			localStorage: settled.report.localStorage,
			cookie: settled.report.cookie,
			repaired: settled.report.repaired,
			found: Boolean(settled.entry),
			stats: {
				checks: stats.checks, mismatches: stats.mismatches, repairs: stats.repairs,
				digestFailures: stats.digestFailures, scriptChecks: stats.scriptChecks
			}
		};
	}

	function remove(input) {
		var key = typeof input === "string" ? input : keyFor(input);
		if (!key) return false;
		delete memory[key];
		order = order.filter(function (existing) { return existing !== key; });
		var map = readLocal();
		if (map[key]) { delete map[key]; writeLocal(map, Object.keys(map)); }
		/* Keep the two stores consistent: drop the mirror if it points here. */
		var packed = decodeCookieEntry(readCookie());
		if (packed && packed.key === key && !cookieBroken) {
			try { win.document.cookie = COOKIE_NAME + "=; Max-Age=0; Path=/; SameSite=Lax"; } catch (_) {}
		}
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

	/* Another tab changed localStorage: the in-page map is no longer trusted. */
	try {
		if (win.addEventListener) {
			win.addEventListener("storage", function (event) {
				if (event && event.key && event.key !== LS_KEY) return;
				memory = {};
				order = [];
			});
		}
	} catch (_) {}

	return {
		canonicalUrl: canonicalUrl,
		keyFor: keyFor,
		outlineFor: outlineFor,
		digestOf: digestOf,
		check: check,
		get: get,
		put: put,
		remove: remove,
		clear: clear,
		stats: function () {
			return {
				hits: stats.hits, misses: stats.misses, memoryHits: stats.memoryHits,
				localHits: stats.localHits, cookieHits: stats.cookieHits,
				writes: stats.writes, errors: stats.errors, bytes: stats.bytes,
				checks: stats.checks, mismatches: stats.mismatches, repairs: stats.repairs,
				digestFailures: stats.digestFailures, scriptChecks: stats.scriptChecks,
				version: NOTE_VERSION,
				localStorage: !localBroken, cookie: !cookieBroken, entries: order.length
			};
		}
	};
}
`;
