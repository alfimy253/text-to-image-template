/*
 * Bug Fix Session 331 — per-page pipeline-management storage.
 *
 * Every browser tab gets its own localStorage page key. Four session cookies
 * carry the FULL management snapshot in chunks, so a cookie-only reload is no
 * longer lossy. There is no TTL: localStorage and the cookie chunks are only
 * trusted when their updatedAt timestamp and digest match exactly.
 */

export const PIPELINE_MANAGEMENT_STORE_JS = `
	/*
	 * Session 331 follow-up: an explicit page id lets another tab (the timeline
	 * editor) write into the Quick Batch table's own page store, so the row's
	 * hand-back lands in that page's localStorage entry AND its four cookies.
	 */
	function createPipelineManagementStore(win, pageIdOverride) {
		var LS_PREFIX = "ytvs.pipeline-management.v1.";
		var SESSION_KEY = "ytvs.pipeline-page.v1";
		var COOKIE_PREFIX = "ytvs_pipeline_management_";
		var VERSION = 1;
		var COOKIE_COUNT = 4;
		var MAX_COOKIE_VALUE = 3800;
		var MAX_ITEMS = 8;
		var MAX_SCRIPT_CHARS = 800;

		function num(value, fallback) {
			var n = Number(value);
			return Number.isFinite(n) ? n : fallback;
		}

		function safePageId(value) {
			var text = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
			return text || freshPageId();
		}

		function freshPageId() {
			return "p" + Date.now().toString(36) + "x" + Math.random().toString(36).slice(2, 10);
		}

		function pageIdFromUrl() {
			try {
				var params = new URLSearchParams((win.location && win.location.search) || "");
				var value = params.get("pipelinePage");
				return value ? safePageId(value) : "";
			} catch (error) { return ""; }
		}

		function resolvePageId() {
			var fromUrl = pageIdFromUrl();
			var id = fromUrl;
			if (!id) {
				try { id = String((win.sessionStorage && win.sessionStorage.getItem(SESSION_KEY)) || ""); } catch (error) { }
			}
			id = safePageId(id);
			try { if (win.sessionStorage) win.sessionStorage.setItem(SESSION_KEY, id); } catch (error) { }
			return id;
		}

		var overrideId = pageIdOverride ? safePageId(pageIdOverride) : "";
		var pageId = overrideId || resolvePageId();
		var localStorageKey = LS_PREFIX + pageId;
		var cookieNames = [];
		for (var c = 0; c < COOKIE_COUNT; c++) cookieNames.push(COOKIE_PREFIX + pageId + "_" + (c + 1));

		function localStore() {
			try { return win.localStorage || null; } catch (error) { return null; }
		}

		function digest(text) {
			var value = String(text || ""), hash = 2166136261;
			for (var i = 0; i < value.length; i++) {
				hash ^= value.charCodeAt(i);
				hash = Math.imul(hash, 16777619);
			}
			return (hash >>> 0).toString(36);
		}

		function safeParse(value) {
			try { return JSON.parse(value); } catch (error) { return null; }
		}

		function deepCopy(value) {
			try { return JSON.parse(JSON.stringify(value)); } catch (error) { return null; }
		}

		function secureSuffix() {
			return win.location && win.location.protocol === "https:" ? "; Secure" : "";
		}

		function cookieValues(text, updatedAt, hash) {
			var chars = Array.from(String(text));
			var size = Math.ceil(chars.length / COOKIE_COUNT) || 1;
			var values = [];
			for (var i = 0; i < COOKIE_COUNT; i++) {
				var meta = {
					v: VERSION, p: pageId, t: updatedAt, h: hash,
					n: COOKIE_COUNT, i: i + 1,
					d: chars.slice(i * size, (i + 1) * size).join("")
				};
				values.push(encodeURIComponent(JSON.stringify(meta)));
			}
			return values;
		}

		function fitsCookies(text, updatedAt) {
			var values = cookieValues(text, updatedAt, "0");
			for (var i = 0; i < values.length; i++) if (values[i].length > MAX_COOKIE_VALUE) return false;
			return true;
		}

		function normalizeRow(row, index) {
			var out = Object.assign({}, row || {});
			out.id = String(out.id || index + 1);
			out.vid = String(out.vid || pageId + "-row-" + out.id);
			out.script = String(out.script || "").slice(0, MAX_SCRIPT_CHARS);
			out.stage = String(out.stage || "ready");
			return out;
		}

		function normalizeProject(project, index) {
			var out = Object.assign({}, project || {});
			out.n = num(out.n, index + 1);
			out.vid = String(out.vid || pageId + "-editor-" + out.n);
			out.script = String(out.script || "").slice(0, MAX_SCRIPT_CHARS);
			out.stage = String(out.stage || "ready");
			return out;
		}

		function boundedSnapshot(snapshot) {
			var clone = deepCopy(snapshot) || {};
			clone.version = VERSION;
			clone.pageId = pageId;
			clone.updatedAt = num(clone.updatedAt, Date.now());
			clone.layout = String(clone.layout || "editor");
			var qb = clone.quickBatch || {};
			var ed = clone.editor || {};
			var rows = (Array.isArray(qb.rows) ? qb.rows : []).slice(0, MAX_ITEMS).map(normalizeRow);
			var projects = (Array.isArray(ed.projects) ? ed.projects : []).slice(0, MAX_ITEMS).map(normalizeProject);
			clone.quickBatch = {
				runBusy: Boolean(qb.runBusy),
				queued: (Array.isArray(qb.queued) ? qb.queued : []).slice(0, MAX_ITEMS).map(String),
				finishedCount: num(qb.finishedCount, 0),
				rows: rows
			};
			clone.editor = { projects: projects };
			clone.videoIds = rows.map(function (row) { return row.vid; }).concat(projects.map(function (project) { return project.vid; }));

			var text = JSON.stringify(clone);
			var scriptCap = MAX_SCRIPT_CHARS;
			while (!fitsCookies(text, clone.updatedAt) && scriptCap > 0) {
				scriptCap = Math.floor(scriptCap / 2);
				rows.forEach(function (row) { row.script = String(row.script || "").slice(0, scriptCap); });
				projects.forEach(function (project) { project.script = String(project.script || "").slice(0, scriptCap); });
				text = JSON.stringify(clone);
			}
			while (!fitsCookies(text, clone.updatedAt) && (rows.length || projects.length)) {
				if (rows.length) rows.pop(); else projects.pop();
				clone.videoIds = rows.map(function (row) { return row.vid; }).concat(projects.map(function (project) { return project.vid; }));
				text = JSON.stringify(clone);
			}
			if (!fitsCookies(text, clone.updatedAt)) {
				clone.quickBatch = { runBusy: false, queued: [], finishedCount: 0, rows: [] };
				clone.editor = { projects: [] };
				clone.videoIds = [];
				text = JSON.stringify(clone);
			}
			return clone;
		}

		function writeCookies(text, updatedAt, hash) {
			var values = cookieValues(text, updatedAt, hash);
			var written = 0;
			for (var i = 0; i < COOKIE_COUNT; i++) {
				try {
					if (!win.document) continue;
					win.document.cookie = cookieNames[i] + "=" + values[i] +
						"; Path=/; SameSite=Lax" + secureSuffix();
					written++;
				} catch (error) { }
			}
			return written;
		}

		function clearCookies() {
			try {
				if (!win.document) return;
				for (var i = 0; i < COOKIE_COUNT; i++) {
					win.document.cookie = cookieNames[i] + "=; Max-Age=0; Path=/; SameSite=Lax";
				}
			} catch (error) { }
		}

		function readLocal() {
			var store = localStore();
			if (!store) return null;
			var value = safeParse(store.getItem(localStorageKey));
			if (!value || value.version !== VERSION || value.pageId !== pageId) return null;
			return value;
		}

		function readCookieMeta(name) {
			try {
				var raw = String((win.document && win.document.cookie) || "").split(";");
				for (var i = 0; i < raw.length; i++) {
					var part = raw[i].trim(), equal = part.indexOf("=");
					if (equal < 0 || part.slice(0, equal) !== name) continue;
					return safeParse(decodeURIComponent(part.slice(equal + 1)));
				}
			} catch (error) { }
			return null;
		}

		function readCookieSnapshot() {
			var metas = [];
			for (var i = 0; i < COOKIE_COUNT; i++) {
				var meta = readCookieMeta(cookieNames[i]);
				if (!meta || meta.v !== VERSION || meta.p !== pageId || meta.n !== COOKIE_COUNT) return null;
				metas.push(meta);
			}
			metas.sort(function (a, b) { return num(a.i, 0) - num(b.i, 0); });
			var first = metas[0];
			for (var j = 1; j < metas.length; j++) {
				if (num(metas[j].t, -1) !== num(first.t, -2) || metas[j].h !== first.h) return null;
			}
			var text = metas.map(function (meta) { return String(meta.d || ""); }).join("");
			if (digest(text) !== first.h) return null;
			var snapshot = safeParse(text);
			if (!snapshot || snapshot.pageId !== pageId || num(snapshot.updatedAt, -1) !== num(first.t, -2)) return null;
			return { snapshot: snapshot, meta: { t: num(first.t, 0), h: first.h } };
		}

		function save(snapshot) {
			var store = localStore();
			if (!store || !snapshot) return { ok: false, reason: "localStorage unavailable" };
			var normalized = boundedSnapshot(snapshot);
			var text = JSON.stringify(normalized);
			var hash = digest(text);
			var localWritten = false;
			try { store.setItem(localStorageKey, text); localWritten = true; } catch (error) { }
			var cookiesWritten = writeCookies(text, normalized.updatedAt, hash);
			var backLocal = readLocal();
			var backCookie = readCookieSnapshot();
			var localMatch = Boolean(backLocal && num(backLocal.updatedAt, -1) === normalized.updatedAt && digest(JSON.stringify(backLocal)) === hash);
			var cookieMatch = Boolean(backCookie && num(backCookie.meta.t, -1) === normalized.updatedAt && backCookie.meta.h === hash);
			var timestampMatched = localMatch && cookieMatch;
			return {
				ok: Boolean(localWritten && cookiesWritten === COOKIE_COUNT && timestampMatched),
				localStorage: localWritten,
				cookies: cookiesWritten,
				cookieCount: COOKIE_COUNT,
				timestampMatched: timestampMatched,
				digest: hash,
				updatedAt: normalized.updatedAt,
				pageId: pageId,
				layout: normalized.layout,
				videoIds: (normalized.videoIds || []).length,
				cookieMaxValue: MAX_COOKIE_VALUE,
				ttl: 0
			};
		}

		function load() {
			var local = readLocal();
			var cookie = readCookieSnapshot();
			var localText = local ? JSON.stringify(local) : "";
			var localHash = local ? digest(localText) : "";
			var timestampMatched = Boolean(local && cookie &&
				num(local.updatedAt, -1) === num(cookie.meta.t, -2) && localHash === cookie.meta.h);
			if (local && !timestampMatched) {
				var repaired = writeCookies(localText, num(local.updatedAt, Date.now()), localHash);
				return {
					snapshot: local,
					source: "localStorage",
					repairedCookie: repaired === COOKIE_COUNT,
					debug: { localStorage: true, cookies: Boolean(cookie), timestampMatched: false, repaired: repaired === COOKIE_COUNT, ttl: 0 }
				};
			}
			if (local && timestampMatched) {
				return {
					snapshot: local,
					source: "localStorage+cookies",
					repairedCookie: false,
					debug: { localStorage: true, cookies: true, timestampMatched: true, repaired: false, ttl: 0 }
				};
			}
			if (cookie) {
				return {
					snapshot: cookie.snapshot,
					source: "cookies",
					repairedCookie: false,
					debug: { localStorage: false, cookies: true, timestampMatched: true, repaired: false, ttl: 0 }
				};
			}
			return {
				snapshot: null,
				source: "none",
				repairedCookie: false,
				debug: { localStorage: false, cookies: false, timestampMatched: false, repaired: false, ttl: 0 }
			};
		}

		function clear() {
			try { var store = localStore(); if (store) store.removeItem(localStorageKey); } catch (error) { }
			clearCookies();
		}

		return {
			pageId: pageId,
			localStorageKey: localStorageKey,
			cookieNames: cookieNames,
			cookieCount: COOKIE_COUNT,
			ttl: 0,
			freshPageId: freshPageId,
			digest: digest,
			boundedSnapshot: boundedSnapshot,
			save: save,
			load: load,
			clear: clear
		};
	}

	const pipelineManagementStore = createPipelineManagementStore(window);
`;
