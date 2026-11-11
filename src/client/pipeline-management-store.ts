/*
 * Bug Fix Session 331 — per-page pipeline-management storage.
 *
 * Every browser tab gets its own localStorage page key. Four session cookies
 * carry the management snapshot in chunks, so a cookie-only reload still finds
 * the page's rows. There is no TTL: each channel is trusted only when its own
 * digest verifies, and the two are only said to agree when their updatedAt
 * timestamps are identical.
 *
 * Session 333 — TWO TIERS, because one text can no longer serve both:
 *
 *   localStorage  the authoritative copy. It keeps the user's script intact
 *                 (MAX_SCRIPT_CHARS) and every row, because it has megabytes.
 *   cookies       a mirror of the same snapshot for the reload that has no
 *                 localStorage. Four 3800-char chunks are a hard budget, so
 *                 when the snapshot is bigger than that the mirror sheds
 *                 RECOMPOSABLE weight first (labels, duplicated slide caches,
 *                 the projectDetail arrays) and then whole rows.
 *
 * What the mirror never does is what the old single-tier ladder did: halve a
 * script down to one character and drop whole fields off a row that is still
 * listed. That is how a Quick Batch row came back from the timeline editor
 * with its script deleted and a few characters left. A row is now either in
 * the mirror whole, or not in it at all, and a script is never cut below
 * COOKIE_SCRIPT_FLOOR.
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
		/* localStorage keeps the user's script; this is a runaway guard, not a budget. */
		var MAX_SCRIPT_CHARS = 8000;
		/* The cookie mirror starts trimming here and stops at the floor. */
		var COOKIE_SCRIPT_START = 800;
		var COOKIE_SCRIPT_FLOOR = 120;

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

		function cookieValues(text, updatedAt, hash, reduced) {
			var chars = Array.from(String(text));
			var size = Math.ceil(chars.length / COOKIE_COUNT) || 1;
			var values = [];
			for (var i = 0; i < COOKIE_COUNT; i++) {
				var meta = {
					v: VERSION, p: pageId, t: updatedAt, h: hash,
					n: COOKIE_COUNT, i: i + 1,
					/* r marks a mirror that had to shed weight to fit the chunks. */
					r: reduced ? 1 : 0,
					d: chars.slice(i * size, (i + 1) * size).join("")
				};
				values.push(encodeURIComponent(JSON.stringify(meta)));
			}
			return values;
		}

		function fitsCookies(text, updatedAt) {
			/* Measured with the reduced flag set, so the mark itself is budgeted for. */
			var values = cookieValues(text, updatedAt, "00000000", true);
			for (var i = 0; i < values.length; i++) if (values[i].length > MAX_COOKIE_VALUE) return false;
			return true;
		}

		function hasNonBlankText(value) {
			return Boolean(String(value || "").trim());
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

		function compactTimelineFields(rows, stripLabels) {
			rows.forEach(function (row) {
				if (!row || typeof row !== "object") return;
				if (row.projectDetail && typeof row.projectDetail === "object") {
					/* Re-composed cleanly from slides/slideItems/timeline on restore. */
					delete row.projectDetail.scenes;
					delete row.projectDetail.slides;
					delete row.projectDetail.elements;
					if (stripLabels) {
						row.projectDetail.title = String(row.projectDetail.title || "").slice(0, 40);
						row.projectDetail.topic = String(row.projectDetail.topic || "").slice(0, 40);
					}
				}
				if (stripLabels && Array.isArray(row.slideItems)) {
					row.slideItems.forEach(function (item) {
						if (!item || typeof item !== "object") return;
						delete item.n;
						delete item.m;
						delete item.src;
					});
				}
				if (row.timeline && typeof row.timeline === "object") {
					if (row.timeline.projectDetail && typeof row.timeline.projectDetail === "object") {
						delete row.timeline.projectDetail.scenes;
						delete row.timeline.projectDetail.slides;
						delete row.timeline.projectDetail.elements;
					}
					if (Array.isArray(row.timeline.sceneItems)) {
						delete row.slideItems;
					}
					if (stripLabels && Array.isArray(row.timeline.sceneItems)) {
						row.timeline.sceneItems.forEach(function (item) {
							if (!item || typeof item !== "object") return;
							delete item.n;
							delete item.m;
							delete item.src;
						});
					}
					if (stripLabels && Array.isArray(row.timeline.visuals)) {
						row.timeline.visuals.forEach(function (vis) {
							if (!vis || typeof vis !== "object") return;
							if (typeof vis.tx === "string" && vis.tx.length > 24) vis.tx = vis.tx.slice(0, 24);
						});
					}
				}
				if (stripLabels) {
					row.detail = "";
					row.title = String(row.title || "").slice(0, 40);
					row.topic = String(row.topic || "").slice(0, 40);
				}
			});
		}

		/*
		 * The localStorage tier: rows and projects bounded to MAX_ITEMS, blank
		 * scripts dropped, ids normalised — and nothing else. In particular the
		 * script is NOT cut to fit a cookie: this text is the one the page reads
		 * back, so it has to hold what the user typed.
		 */
		function boundedSnapshot(snapshot) {
			var clone = deepCopy(snapshot) || {};
			clone.version = VERSION;
			clone.pageId = pageId;
			clone.updatedAt = num(clone.updatedAt, Date.now());
			clone.layout = String(clone.layout || "editor");
			var qb = clone.quickBatch || {};
			var ed = clone.editor || {};
			/* Blank-script rows never belong in pipeline localStorage or cookies. */
			var rows = (Array.isArray(qb.rows) ? qb.rows : [])
				.filter(function (row) { return Boolean(row && hasNonBlankText(row.script)); })
				.slice(0, MAX_ITEMS)
				.map(normalizeRow);
			var projects = (Array.isArray(ed.projects) ? ed.projects : [])
				.filter(function (project) { return Boolean(project && hasNonBlankText(project.script)); })
				.slice(0, MAX_ITEMS)
				.map(normalizeProject);
			clone.quickBatch = {
				runBusy: Boolean(qb.runBusy),
				queued: queuedIds(qb.queued, rows),
				finishedCount: num(qb.finishedCount, 0),
				rows: rows
			};
			clone.editor = { projects: projects };
			clone.videoIds = videoIdsOf(rows, projects);
			return clone;
		}

		function keptIdsOf(rows) {
			var keptIds = Object.create(null);
			(Array.isArray(rows) ? rows : []).forEach(function (row) {
				if (row) keptIds[String(row.id)] = true;
			});
			return keptIds;
		}

		function queuedIds(queued, rows) {
			var keptIds = keptIdsOf(rows);
			return (Array.isArray(queued) ? queued : [])
				.map(String)
				.filter(function (id) { return keptIds[id] === true; })
				.slice(0, MAX_ITEMS);
		}

		function videoIdsOf(rows, projects) {
			return (rows || []).map(function (row) { return row.vid; })
				.concat((projects || []).map(function (project) { return project.vid; }));
		}

		function trimScripts(rows, projects, cap) {
			(rows || []).forEach(function (row) {
				if (!row) return;
				var text = String(row.script || "").trim();
				row.script = text ? text.slice(0, cap) : "";
			});
			(projects || []).forEach(function (project) {
				if (!project) return;
				var text = String(project.script || "").trim();
				project.script = text ? text.slice(0, cap) : "";
			});
		}

		/*
		 * The cookie tier: the same snapshot, reduced until its four chunks fit.
		 *
		 * Order matters. Everything shed here is rebuilt on restore — the
		 * projectDetail arrays come back from the row's slides, the slide labels
		 * from the timeline project's own store, the timeline edit's visuals and
		 * audio from the timeline project itself. The script and the row's
		 * identity are shed last, and a script is never cut below
		 * COOKIE_SCRIPT_FLOOR: below that a "restored" row is a lie, so the row
		 * is dropped from the mirror instead and localStorage stays the truth.
		 */
		function cookieMirror(source) {
			var clone = deepCopy(source) || {};
			var rows = Array.isArray(clone.quickBatch && clone.quickBatch.rows) ? clone.quickBatch.rows : [];
			var projects = Array.isArray(clone.editor && clone.editor.projects) ? clone.editor.projects : [];
			var updatedAt = num(clone.updatedAt, Date.now());
			var rowTotal = rows.length;
			var projectTotal = projects.length;
			var scriptChars = MAX_SCRIPT_CHARS;
			var text = JSON.stringify(clone);
			var reduced = false;

			function settle() {
				return {
					snapshot: clone,
					text: text,
					info: {
						reduced: reduced,
						scriptChars: scriptChars,
						rows: rows.length,
						projects: projects.length,
						rowsDropped: Math.max(0, rowTotal - rows.length),
						projectsDropped: Math.max(0, projectTotal - projects.length)
					}
				};
			}

			if (fitsCookies(text, updatedAt)) return settle();
			reduced = true;

			compactTimelineFields(rows, false);
			projects.forEach(function (proj) {
				if (!proj || !proj.projectDetail || typeof proj.projectDetail !== "object") return;
				delete proj.projectDetail.scenes;
				delete proj.projectDetail.slides;
				delete proj.projectDetail.elements;
			});
			text = JSON.stringify(clone);
			if (fitsCookies(text, updatedAt)) return settle();

			compactTimelineFields(rows, true);
			text = JSON.stringify(clone);
			if (fitsCookies(text, updatedAt)) return settle();

			rows.forEach(function (row) {
				if (!row || !row.timeline || typeof row.timeline !== "object") return;
				delete row.timeline.visuals;
				delete row.timeline.audios;
				delete row.timeline.projectDetail;
			});
			text = JSON.stringify(clone);
			if (fitsCookies(text, updatedAt)) return settle();

			rows.forEach(function (row) {
				if (!row || typeof row !== "object") return;
				delete row.projectDetail;
				delete row.slideItems;
			});
			projects.forEach(function (proj) {
				if (!proj || typeof proj !== "object") return;
				delete proj.projectDetail;
			});
			text = JSON.stringify(clone);
			if (fitsCookies(text, updatedAt)) return settle();

			/*
			 * The edit's per-scene records go next, but its compact
			 * [mediaIndex, seconds, kind] triples stay: those triples ARE the
			 * scene order and the edited lengths, and applyTimelineEditToBatchRow
			 * rebuilds the row's slides from them alone. Only the labels are lost,
			 * and the timeline project's own store still has them.
			 */
			rows.forEach(function (row) {
				if (!row || !row.timeline || typeof row.timeline !== "object") return;
				if (!Array.isArray(row.timeline.scenes) || !row.timeline.scenes.length) return;
				delete row.timeline.sceneItems;
			});
			text = JSON.stringify(clone);
			if (fitsCookies(text, updatedAt)) return settle();

			scriptChars = Math.min(COOKIE_SCRIPT_START, MAX_SCRIPT_CHARS);
			while (!fitsCookies(text, updatedAt) && scriptChars > COOKIE_SCRIPT_FLOOR) {
				scriptChars = Math.max(COOKIE_SCRIPT_FLOOR, Math.floor(scriptChars / 2));
				trimScripts(rows, projects, scriptChars);
				text = JSON.stringify(clone);
			}
			if (fitsCookies(text, updatedAt)) return settle();

			/* Whole rows go before a kept row is mutilated. The first row is kept. */
			while (!fitsCookies(text, updatedAt) && (rows.length > 1 || projects.length)) {
				if (projects.length) projects.pop(); else rows.pop();
				clone.quickBatch.queued = queuedIds(clone.quickBatch.queued, rows);
				clone.videoIds = videoIdsOf(rows, projects);
				text = JSON.stringify(clone);
			}
			if (fitsCookies(text, updatedAt)) return settle();

			clone.quickBatch = { runBusy: false, queued: [], finishedCount: 0, rows: [] };
			clone.editor = { projects: [] };
			clone.videoIds = [];
			rows = clone.quickBatch.rows;
			projects = clone.editor.projects;
			text = JSON.stringify(clone);
			return settle();
		}

		function writeCookies(text, updatedAt, hash, reduced) {
			var values = cookieValues(text, updatedAt, hash, reduced);
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
			return { snapshot: snapshot, meta: { t: num(first.t, 0), h: first.h, reduced: num(first.r, 0) === 1 } };
		}

		/*
		 * One save, two tiers: the full snapshot goes to localStorage, its
		 * (possibly reduced) mirror goes to the four cookie chunks. Each tier is
		 * read back and verified against its OWN digest; the two tiers are said
		 * to agree when they carry the same updatedAt, which is what a reload
		 * needs to trust localStorage over the mirror.
		 */
		function save(snapshot) {
			var store = localStore();
			if (!store || !snapshot) return { ok: false, reason: "localStorage unavailable" };
			var normalized = boundedSnapshot(snapshot);
			var text = JSON.stringify(normalized);
			var hash = digest(text);
			var updatedAt = normalized.updatedAt;
			var mirror = cookieMirror(normalized);
			var mirrorHash = digest(mirror.text);
			var localWritten = false;
			try { store.setItem(localStorageKey, text); localWritten = true; } catch (error) { }
			var cookiesWritten = writeCookies(mirror.text, updatedAt, mirrorHash, mirror.info.reduced);
			var backLocal = readLocal();
			var backCookie = readCookieSnapshot();
			var localMatch = Boolean(backLocal && num(backLocal.updatedAt, -1) === updatedAt && digest(JSON.stringify(backLocal)) === hash);
			var cookieMatch = Boolean(backCookie && num(backCookie.meta.t, -1) === updatedAt && backCookie.meta.h === mirrorHash);
			var timestampMatched = localMatch && cookieMatch;
			return {
				ok: Boolean(localWritten && cookiesWritten === COOKIE_COUNT && timestampMatched),
				localStorage: localWritten,
				localStorageChars: text.length,
				cookies: cookiesWritten,
				cookieCount: COOKIE_COUNT,
				cookieChars: mirror.text.length,
				timestampMatched: timestampMatched,
				digest: hash,
				cookieDigest: mirrorHash,
				mirrorReduced: mirror.info.reduced,
				mirrorScriptChars: mirror.info.scriptChars,
				mirrorRows: mirror.info.rows,
				mirrorProjects: mirror.info.projects,
				mirrorRowsDropped: mirror.info.rowsDropped,
				mirrorProjectsDropped: mirror.info.projectsDropped,
				updatedAt: updatedAt,
				pageId: pageId,
				layout: normalized.layout,
				videoIds: (normalized.videoIds || []).length,
				cookieMaxValue: MAX_COOKIE_VALUE,
				ttl: 0
			};
		}

		/* Re-derive this snapshot's mirror and put it in the four chunks. */
		function writeMirrorCookies(snapshot) {
			var mirror = cookieMirror(snapshot || {});
			return writeCookies(mirror.text, num(snapshot && snapshot.updatedAt, Date.now()), digest(mirror.text), mirror.info.reduced);
		}

		function load() {
			var local = readLocal();
			var cookie = readCookieSnapshot();
			/*
			 * The two tiers can legitimately hold different text (the mirror is
			 * reduced when the snapshot outgrows four cookies), so agreement is
			 * about the timestamp, not the digest. Each tier's own digest was
			 * already verified on the way in.
			 */
			var timestampMatched = Boolean(local && cookie &&
				num(local.updatedAt, -1) === num(cookie.meta.t, -2));
			if (local && !timestampMatched) {
				var repaired = writeMirrorCookies(local);
				return {
					snapshot: local,
					source: "localStorage",
					repairedCookie: repaired === COOKIE_COUNT,
					debug: { localStorage: true, cookies: Boolean(cookie), timestampMatched: false, repaired: repaired === COOKIE_COUNT, partial: false, ttl: 0 }
				};
			}
			if (local && timestampMatched) {
				return {
					snapshot: local,
					source: "localStorage+cookies",
					repairedCookie: false,
					debug: { localStorage: true, cookies: true, timestampMatched: true, repaired: false, partial: false, ttl: 0 }
				};
			}
			if (cookie) {
				return {
					snapshot: cookie.snapshot,
					source: "cookies",
					repairedCookie: false,
					debug: {
						localStorage: false,
						cookies: true,
						timestampMatched: true,
						repaired: false,
						partial: Boolean(cookie.meta.reduced),
						ttl: 0
					}
				};
			}
			return {
				snapshot: null,
				source: "none",
				repairedCookie: false,
				debug: { localStorage: false, cookies: false, timestampMatched: false, repaired: false, partial: false, ttl: 0 }
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
			cookieMirror: cookieMirror,
			maxScriptChars: MAX_SCRIPT_CHARS,
			cookieScriptFloor: COOKIE_SCRIPT_FLOOR,
			save: save,
			load: load,
			clear: clear
		};
	}

	const pipelineManagementStore = createPipelineManagementStore(window);
`;
