/*
 * Client-only Quick Batch timeline editor.
 * The inspector reuses the Reel scene editor's control builders and class
 * vocabulary; this module owns only timeline timing, local persistence and
 * browser media previews. It has no Worker or pipeline-generation calls.
 */
export const TIMELINE_EDITOR_JS = `
	(function () {
		"use strict";

		var DB_NAME = "ytvs-timeline-editor-assets-v1";
		var DB_VERSION = 1;
		var DB_STORE = "projects";
		var STATE_PREFIX = "ytvs.timeline-editor.v1.";
		var MAX_DURATION_SEC = 3600;
		var MIN_CLIP_SEC = 0.25;
		var MAX_VISUAL_TRACKS = 4;
		var MAX_MEDIA_FILES = 100;
		/*
		 * The Pixabay stocks (and any local upload) always live in ONE track. That
		 * track IS the background layer of the composition: the canvas paints it
		 * first and every text/graphic clip is drawn above it. Nothing else can be
		 * placed below it, so the media track never needs a z-order of its own.
		 */
		var MEDIA_TRACK_ID = "background-media";
		var MEDIA_TRACK_LABEL = "Pixabay & uploaded media · background";
		var MEDIA_TRACK_NAME = "BACKGROUND";

		function openAssetDb() {
			return new Promise(function (resolve, reject) {
				if (!window.indexedDB) {
					reject(new Error("IndexedDB is not available in this browser"));
					return;
				}
				var request;
				try { request = window.indexedDB.open(DB_NAME, DB_VERSION); }
				catch (error) { reject(error); return; }
				request.onupgradeneeded = function () {
					var db = request.result;
					if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: "id" });
				};
				request.onsuccess = function () { resolve(request.result); };
				request.onerror = function () { reject(request.error || new Error("Could not open local media storage")); };
				request.onblocked = function () { reject(new Error("Local media storage is blocked by another tab")); };
			});
		}

		function readAssetRecord(projectId) {
			return openAssetDb().then(function (db) {
				return new Promise(function (resolve, reject) {
					var transaction = db.transaction(DB_STORE, "readonly");
					var request = transaction.objectStore(DB_STORE).get(String(projectId));
					request.onsuccess = function () { resolve(request.result || null); };
					request.onerror = function () { reject(request.error || new Error("Could not read local media")); };
					transaction.oncomplete = function () { db.close(); };
					transaction.onerror = function () { db.close(); reject(transaction.error || new Error("Could not read local media")); };
				});
			});
		}

		function writeAssetRecord(record) {
			return openAssetDb().then(function (db) {
				return new Promise(function (resolve, reject) {
					var transaction = db.transaction(DB_STORE, "readwrite");
					transaction.objectStore(DB_STORE).put(record);
					transaction.oncomplete = function () { db.close(); resolve({ ok: true, id: record.id, assets: Object.keys(record.assets || {}).length, updatedAt: record.updatedAt }); };
					transaction.onerror = function () { db.close(); reject(transaction.error || new Error("Could not save local media")); };
					transaction.onabort = function () { db.close(); reject(transaction.error || new Error("Local media save was aborted")); };
				});
			});
		}

		function storeProjectAssets(projectId, transfer) {
			var id = String(projectId || "");
			if (!id) return Promise.resolve({ ok: false, reason: "missing timeline project id" });
			var incoming = transfer || {};
			return readAssetRecord(id).catch(function () { return null; }).then(function (existing) {
				var assets = Object.assign({}, existing && existing.assets || {});
				(Array.isArray(incoming.assets) ? incoming.assets : []).forEach(function (asset) {
					if (!asset || !asset.blob || !asset.id) return;
					assets[String(asset.id)] = {
						id: String(asset.id),
						blob: asset.blob,
						name: String(asset.name || asset.blob.name || ""),
						type: String(asset.type || asset.blob.type || ""),
						source: asset.source || null
					};
				});
				var voiceover = incoming.voiceover || (existing && existing.voiceover) || null;
				var record = { id: id, assets: assets, voiceover: voiceover, updatedAt: Date.now() };
				return writeAssetRecord(record).catch(function (error) {
					return { ok: false, id: id, reason: String(error && error.message || error) };
				});
			}).catch(function (error) {
				return { ok: false, id: id, reason: String(error && error.message || error) };
			});
		}

		function storeOneAsset(projectId, assetId, blob, metadata) {
			if (!blob) return Promise.resolve({ ok: false, reason: "no browser file was supplied" });
			var info = metadata || {};
			var key = String(assetId || "asset-" + Date.now().toString(36));
			return storeProjectAssets(projectId, {
				assets: [{ id: key, blob: blob, name: info.name || blob.name || "", type: info.type || blob.type || "", source: info.source || null }]
			});
		}

		var api = {
			storeProjectAssets: storeProjectAssets,
			readProjectAssets: readAssetRecord,
			storeAsset: storeOneAsset,
			getState: function () { return window.__TIMELINE_EDITOR_STATE__ || null; }
		};
		window.__TIMELINE_EDITOR__ = api;

		function routeRequested() {
			try { return new URLSearchParams(window.location.search || "").get("layout") === "timeline"; }
			catch (error) { return false; }
		}
		if (!routeRequested()) return;

		var params = new URLSearchParams(window.location.search || "");
		var transition = window.__TIMELINE_PROJECT__ || window.__TRANSITION_PROJECT__ || window.__BATCH_EDIT_PROJECT__ || null;
		var pageId = String(params.get("pipelinePage") || transition && transition.targetPageId || "").replace(/[^a-zA-Z0-9_-]/g, "");
		if (!pageId) pageId = "t" + Date.now().toString(36) + "x" + Math.random().toString(36).slice(2, 9);
		var storageKey = STATE_PREFIX + pageId;
		var controlUI = window.__REEL_SCENE_CONTROL_UI__ || null;
		var state = null;
		var assetMap = Object.create(null);
		var audioMap = Object.create(null);
		var objectUrls = [];
		var isPlaying = false;
		var previewFrame = 0;
		var previousFrameAt = 0;
		var saveTimer = 0;
		var activeDrag = null;
		var suppressClick = false;
		var pendingAudioTrackId = "";
		var selectedSceneId = "";
		var playButton = document.querySelector('[data-timeline-action="play"]');
		var canvas = document.getElementById("timeline-preview-canvas");
		var canvasContext = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;

		function number(value, fallback) {
			var n = Number(value);
			return Number.isFinite(n) ? n : fallback;
		}
		function clamp(value, min, max) { return Math.max(min, Math.min(max, number(value, min))); }
		function esc(value) {
			return String(value == null ? "" : value)
				.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
				.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
		}
		function formatTime(value) {
			var seconds = Math.max(0, Math.floor(number(value, 0)));
			var hours = Math.floor(seconds / 3600);
			var minutes = Math.floor((seconds % 3600) / 60);
			var rest = seconds % 60;
			return hours ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0") : minutes + ":" + String(rest).padStart(2, "0");
		}
		function deepCopy(value) {
			try { return JSON.parse(JSON.stringify(value)); } catch (error) { return null; }
		}
		function makeId(prefix) {
			return String(prefix || "item") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
		}
		function setStatus(text, isError) {
			var el = document.getElementById("timeline-status");
			if (el) {
				el.textContent = String(text || "");
				el.setAttribute("data-state", isError ? "error" : "ok");
			}
		}
		function setSaveStatus(text, isError) {
			var el = document.getElementById("timeline-save-status");
			if (el) {
				el.textContent = String(text || "");
				el.setAttribute("data-state", isError ? "error" : "ok");
			}
		}
		function rangeValue(value, min, max, fallback) {
			return clamp(value, min, max) || fallback;
		}

		function defaultTimeline() {
			var duration = number(transition && transition.timelineState && transition.timelineState.durationSec, 60);
			var scenes = [];
			var mediaItems = [];
			var span = Math.max(0.25, duration / 12);
			for (var i = 0; i < 12; i++) {
				var sceneId = "scene-" + (i + 1);
				var start = i * span;
				scenes.push({ id: sceneId, index: i, name: "Scene " + (i + 1), startSec: start, durationSec: span, mediaType: "image", mediaAssetId: "", mediaName: "", mediaSource: "pending", prompt: "", elements: [] });
				mediaItems.push({ id: "media-" + (i + 1), kind: "media", sceneId: sceneId, assetId: "", label: "Scene " + (i + 1) + " · media pending", mediaType: "image", startSec: start, durationSec: span, trimStartSec: 0, fit: "cover", visible: true });
			}
			return {
				version: 3,
				projectId: pageId,
				updatedAt: Date.now(),
				durationSec: duration,
				playheadSec: 0,
				soundExpanded: false,
				zoom: 1,
				scenes: scenes,
				tracks: [
					{ id: "voiceover", kind: "audio", label: "Voiceover", expanded: true, items: [] },
					{ id: "sound-fx", kind: "audio", label: "Sound effects", expanded: true, items: [] },
					{ id: "background-music", kind: "audio", label: "Background music", expanded: true, items: [] },
					{ id: MEDIA_TRACK_ID, kind: "media", label: MEDIA_TRACK_LABEL, expanded: true, items: mediaItems, layer: 0 },
					{ id: "visual-1", kind: "visual", label: "Text & graphics 1", expanded: true, items: [] }
				],
				selectedTrackId: MEDIA_TRACK_ID,
				selectedItemId: "media-1"
			};
		}

		function normalizeItem(item, track) {
			var out = Object.assign({}, item || {});
			out.id = String(out.id || makeId(track && track.kind || "clip"));
			out.kind = track && track.kind === "media" ? "media" : track && track.kind === "audio" ? "audio" : (out.kind === "graphic" ? "graphic" : "text");
			out.startSec = clamp(out.startSec, 0, MAX_DURATION_SEC);
			out.durationSec = clamp(out.durationSec, MIN_CLIP_SEC, MAX_DURATION_SEC);
			out.assetId = String(out.assetId || "");
			out.label = String(out.label || out.name || (out.kind === "text" ? "Text" : out.kind === "graphic" ? "Graphic" : out.kind === "audio" ? "Audio" : "Media"));
			out.visible = out.visible !== false;
			if (out.kind === "text") {
				out.text = String(out.text || "");
				out.x = clamp(out.x, 0, 100);
				out.y = clamp(out.y, 0, 100);
				out.fontSize = clamp(out.fontSize, 10, 140);
				out.color = String(out.color || "#ffffff");
				out.font = String(out.font || "sans");
				out.align = String(out.align || "center");
			}
			if (out.kind === "graphic") {
				out.graphic = String(out.graphic || "circle");
				out.size = clamp(out.size, 12, 500);
				out.x = clamp(out.x, 0, 100);
				out.y = clamp(out.y, 0, 100);
				out.color = String(out.color || "#7aac2b");
			}
			if (out.kind === "audio") {
				out.volume = clamp(out.volume, 0, 1);
				out.muted = Boolean(out.muted);
			}
			return out;
		}

		function normalizeState(raw) {
			var base = deepCopy(raw) || defaultTimeline();
			var originalTracks = Array.isArray(base.tracks) ? base.tracks : [];
			var byId = Object.create(null);
			originalTracks.forEach(function (track) { if (track && track.id) byId[String(track.id)] = track; });
			var legacyVisualTracks = originalTracks.filter(function (track) { return track && (track.kind === "visual" || track.kind === "overlay"); }).slice(0, MAX_VISUAL_TRACKS);
			var legacyTextTracks = originalTracks.filter(function (track) { return track && track.kind === "text"; });
			var fixed = [
				{ id: "voiceover", kind: "audio", label: "Voiceover" },
				{ id: "sound-fx", kind: "audio", label: "Sound effects" },
				{ id: "background-music", kind: "audio", label: "Background music" },
				{ id: MEDIA_TRACK_ID, kind: "media", label: MEDIA_TRACK_LABEL, layer: 0 }
			];
			/*
			 * A saved project may still carry extra media lanes from an older model
			 * (a second Pixabay lane, an "overlay" lane, an imported-clip lane). Every
			 * media item is folded into the single background layer so a saved project
			 * can never paint two competing backgrounds.
			 */
			var strayMediaTracks = originalTracks.filter(function (track) {
				return track && track.kind === "media" && String(track.id) !== MEDIA_TRACK_ID;
			});
			var tracks = fixed.map(function (spec) {
				var old = byId[spec.id] || {};
				return {
					id: spec.id, kind: spec.kind, label: spec.kind === "media" ? String(spec.label) : String(old.label || spec.label),
					expanded: old.expanded !== false,
					items: (Array.isArray(old.items) ? old.items : []).map(function (item) { return normalizeItem(item, spec); })
				};
			});
			var backgroundTrack = tracks.filter(function (track) { return track.kind === "media"; })[0] || null;
			if (backgroundTrack) {
				backgroundTrack.layer = 0;
				strayMediaTracks.forEach(function (stray) {
					(Array.isArray(stray.items) ? stray.items : []).forEach(function (item) {
						var migrated = normalizeItem(item, { kind: "media" });
						if (backgroundTrack.items.some(function (existing) { return String(existing.id) === String(migrated.id); })) return;
						backgroundTrack.items.push(migrated);
					});
				});
			}
			var visualLayers = legacyVisualTracks.map(function (old, index) {
				var layerNumber = index + 1;
				var id = String(old.id || "visual-" + layerNumber);
				var label = String(old.label || "");
				var generatedLabel = "Text & graphics " + layerNumber;
				if (!label || label.indexOf("Overlay") === 0 || label.indexOf("Text & graphics ") === 0) label = generatedLabel;
				return {
					id: id, kind: "visual", label: label, expanded: old.expanded !== false,
					items: (Array.isArray(old.items) ? old.items : []).map(function (item) { return normalizeItem(item, { kind: "visual" }); })
				};
			});
			function ensureVisualLayer(layerNumber) {
				var wanted = Math.max(1, Math.min(MAX_VISUAL_TRACKS, layerNumber));
				while (visualLayers.length < wanted) {
					var number = visualLayers.length + 1;
					var old = legacyVisualTracks[number - 1] || {};
					var id = String(old.id || "visual-" + number);
					var duplicate = visualLayers.some(function (candidate) { return String(candidate.id) === id; });
					if (duplicate) id = "visual-" + number + "-migrated";
					visualLayers.push({ id: id, kind: "visual", label: "Text & graphics " + number, expanded: true, items: [] });
				}
				return visualLayers[wanted - 1] || null;
			}
			legacyTextTracks.forEach(function (old) {
				var items = Array.isArray(old.items) ? old.items : [];
				if (!items.length) return;
				var target = visualLayers[0] || ensureVisualLayer(1);
				if (!target) return;
				items.forEach(function (item) { target.items.push(normalizeItem(item, { kind: "visual" })); });
			});
			if (!visualLayers.length) visualLayers.push({ id: "visual-1", kind: "visual", label: "Text & graphics 1", expanded: true, items: [] });
			tracks = tracks.concat(visualLayers);
			var sceneSource = Array.isArray(base.scenes) ? base.scenes : [];
			var scenes = sceneSource.slice(0, 100).map(function (scene, index) {
				var copy = Object.assign({}, scene || {});
				copy.id = String(copy.id || "scene-" + (index + 1));
				copy.index = Number.isInteger(Number(copy.index)) ? Number(copy.index) : index;
				copy.name = String(copy.name || "Scene " + (index + 1));
				copy.startSec = clamp(copy.startSec, 0, MAX_DURATION_SEC);
				copy.durationSec = clamp(copy.durationSec, MIN_CLIP_SEC, MAX_DURATION_SEC);
				copy.mediaType = String(copy.mediaType || "image");
				copy.mediaAssetId = String(copy.mediaAssetId || "");
				copy.elements = Array.isArray(copy.elements) ? copy.elements.map(function (item) { return normalizeItem(item, { kind: "visual" }); }) : [];
				return copy;
			});
			if (!scenes.length) scenes = defaultTimeline().scenes;
			var duration = clamp(base.durationSec, 1, MAX_DURATION_SEC);
			var result = {
				version: 3,
				projectId: pageId,
				updatedAt: number(base.updatedAt, Date.now()),
				sourcePageId: String(base.sourcePageId || transition && transition.sourcePageId || ""),
				sourceRowId: String(base.sourceRowId || transition && transition.basicSettings && transition.basicSettings.id || ""),
				durationSec: duration,
				playheadSec: clamp(base.playheadSec, 0, duration),
				soundExpanded: number(base.version, 1) >= 2 && base.soundExpanded === true,
				zoom: clamp(base.zoom, 0.5, 2),
				scenes: scenes,
				tracks: tracks,
				selectedTrackId: String(base.selectedTrackId || MEDIA_TRACK_ID),
				selectedItemId: String(base.selectedItemId || "")
			};
			if (!tracks.some(function (track) { return String(track.id) === result.selectedTrackId; }) && result.selectedTrackId.indexOf("text-") === 0) {
				var selectedLayer = visualLayers[0];
				if (selectedLayer) result.selectedTrackId = selectedLayer.id;
			}
			return result;
		}

		function findTrack(id) {
			return state && state.tracks.find(function (track) { return String(track.id) === String(id); }) || null;
		}
		function findItem(id) {
			if (!state || !id) return null;
			for (var i = 0; i < state.tracks.length; i++) {
				var track = state.tracks[i];
				var item = track.items.find(function (candidate) { return String(candidate.id) === String(id); });
				if (item) return { track: track, item: item };
			}
			return null;
		}
		function sceneById(id) {
			return state && state.scenes.find(function (scene) { return String(scene.id) === String(id); }) || null;
		}
		/*
		 * One accessor for the background layer. Timing, uploads, preview drawing
		 * and the scene ripple all resolve the media lane through this function, so
		 * "which lane are the Pixabay images in?" has exactly one answer.
		 */
		function mediaTrack() { return findTrack(MEDIA_TRACK_ID); }
		function visualTracks() { return state.tracks.filter(function (track) { return track.kind === "visual"; }); }
		function sceneElementTracks() { return visualTracks(); }
		function sceneElementEntries(sceneId) {
			var list = [];
			sceneElementTracks().forEach(function (track) {
				track.items.forEach(function (item) { if (String(item.sceneId || "") === String(sceneId)) list.push({ track: track, item: item }); });
			});
			return list;
		}
		function syncScenesFromTracks() {
			if (!state) return;
			var media = mediaTrack();
			state.scenes.forEach(function (scene) {
				var mediaItem = media && media.items.find(function (item) { return String(item.sceneId || "") === String(scene.id); });
				if (mediaItem) {
					scene.startSec = mediaItem.startSec;
					scene.durationSec = mediaItem.durationSec;
					scene.mediaAssetId = mediaItem.assetId;
					scene.mediaType = mediaItem.mediaType || scene.mediaType || "image";
					scene.mediaName = mediaItem.label || scene.mediaName || "";
				}
				scene.elements = sceneElementEntries(scene.id).map(function (entry) { return Object.assign({}, entry.item); });
			});
		}
		function maxTimelineEnd() {
			var end = number(state && state.durationSec, 60);
			(state && state.tracks || []).forEach(function (track) {
				(track.items || []).forEach(function (item) { end = Math.max(end, item.startSec + item.durationSec); });
			});
			return Math.min(MAX_DURATION_SEC, end);
		}
		function ensureTimelineEnd(end) {
			if (!state) return;
			var clamped = clamp(end, 1, MAX_DURATION_SEC);
			if (clamped > state.durationSec) state.durationSec = Math.min(MAX_DURATION_SEC, Math.ceil(clamped / 5) * 5);
		}

		function persistNow() {
			if (!state) return false;
			syncScenesFromTracks();
			state.durationSec = Math.max(state.durationSec, maxTimelineEnd());
			state.updatedAt = Date.now();
			try {
				window.localStorage.setItem(storageKey, JSON.stringify(state));
				setSaveStatus("Timing saved in this browser", false);
				window.__TIMELINE_EDITOR_SAVE__ = { ok: true, key: storageKey, updatedAt: state.updatedAt, scenes: state.scenes.length, tracks: state.tracks.length };
				return true;
			} catch (error) {
				setSaveStatus("Timing could not be saved", true);
				window.__TIMELINE_EDITOR_SAVE__ = { ok: false, key: storageKey, reason: String(error && error.message || error) };
				return false;
			}
		}
		function scheduleSave() {
			if (saveTimer) clearTimeout(saveTimer);
			setSaveStatus("Saving timing locally…", false);
			saveTimer = setTimeout(function () { saveTimer = 0; persistNow(); }, 180);
		}

		function activeMediaAt(seconds) {
			var track = mediaTrack();
			if (!track || !track.items.length) return null;
			var active = track.items.find(function (item) { return seconds >= item.startSec && seconds < item.startSec + item.durationSec; });
			if (active) return active;
			return track.items.find(function (item) { return String(item.id) === String(state.selectedItemId); }) || track.items[0];
		}
		function activeSceneAt(seconds) {
			var media = activeMediaAt(seconds);
			if (media && media.sceneId) return sceneById(media.sceneId);
			return state.scenes[0] || null;
		}
		function selectedEntry() { return findItem(state && state.selectedItemId); }
		function shouldAnimatePreview() {
			var active = state && activeMediaAt(state.playheadSec);
			var asset = active && active.assetId ? assetMap[active.assetId] : null;
			return Boolean(asset && asset.type === "image/gif");
		}
		function schedulePreviewFrame() {
			if (!previewFrame && window.requestAnimationFrame) previewFrame = window.requestAnimationFrame(previewTick);
		}
		function selectedTrack() {
			var entry = selectedEntry();
			return entry ? entry.track : findTrack(state && state.selectedTrackId);
		}
		function chooseItem(track, item) {
			if (!track || !item) return;
			state.selectedTrackId = track.id;
			state.selectedItemId = item.id;
			if (item.sceneId) selectedSceneId = String(item.sceneId);
			renderTimeline();
			renderInspector();
			drawPreview();
			updateReadout();
			scheduleSave();
		}
		function chooseTrack(track) {
			if (!track) return;
			state.selectedTrackId = track.id;
			state.selectedItemId = "";
			renderTimeline();
			renderInspector();
			scheduleSave();
		}

		function htmlTrackItem(track, item, pixelsPerSecond) {
			var left = Math.max(0, item.startSec * pixelsPerSecond);
			var width = Math.max(12, item.durationSec * pixelsPerSecond);
			var selected = String(item.id) === String(state.selectedItemId) ? " selected" : "";
			var empty = item.kind === "media" && !item.assetId ? " placeholder" : "";
			var name = String(item.label || item.name || item.kind);
			var short = name.length > 38 ? name.slice(0, 35) + "…" : name;
			return '<button type="button" class="te-clip ' + esc(item.kind) + selected + empty + '" data-clip-id="' + esc(item.id) + '" data-track-id="' + esc(track.id) + '" style="left:' + left.toFixed(1) + 'px;width:' + width.toFixed(1) + 'px" title="' + esc(name + " · " + formatTime(item.startSec) + " · " + formatTime(item.durationSec)) + '">' +
				'<span class="te-clip-label">' + esc(short) + '</span><span class="te-clip-time">' + esc(formatTime(item.durationSec)) + '</span><span class="te-clip-resize" data-resize-id="' + esc(item.id) + '" title="Drag to extend or shorten"></span></button>';
		}
		function renderTimeline() {
			if (!state) return;
			syncScenesFromTracks();
			var grid = document.getElementById("timeline-track-grid");
			if (!grid) return;
			var zoom = clamp(state.zoom, 0.5, 2);
			var pps = Math.max(14, Math.min(48, 1080 / Math.max(20, state.durationSec))) * zoom;
			var width = Math.max(720, Math.ceil(state.durationSec * pps));
				grid.style.setProperty("--te-content-width", width + "px");
				grid.style.gridTemplateColumns = "156px var(--te-content-width)";
			var interval = state.durationSec <= 30 ? 2 : state.durationSec <= 120 ? 5 : state.durationSec <= 360 ? 10 : state.durationSec <= 900 ? 30 : 60;
			var html = '<div class="te-grid-corner">TRACKS</div><div class="te-ruler" style="width:' + width + 'px">';
			for (var tick = 0; tick <= state.durationSec; tick += interval) {
				html += '<span class="te-ruler-tick" style="left:' + (tick * pps).toFixed(1) + 'px"><i></i>' + esc(formatTime(tick)) + '</span>';
			}
			html += '<span class="te-playhead" data-playhead style="left:' + (state.playheadSec * pps).toFixed(1) + 'px"></span></div>';
			/*
			 * The dock mirrors the paint stack top-down: text and graphics lanes come
			 * first, and the single background layer sits pinned UNDER them. The dock is
			 * flipped visually (column-reverse in CSS below the first child) - the lane
			 * order here is the reading order, the background lane is always last in the
			 * DOM and always the lowest layer on the canvas.
			 */
			var visuals = visualTracks();
			html += '<div class="te-group-title te-group-visuals"><span class="te-group-label">TEXT &amp; GRAPHICS <small>' + visuals.length + ' / ' + MAX_VISUAL_TRACKS + ' lanes · above the background</small></span></div>';
			html += '<div class="te-group-fill te-visual-actions"><button type="button" class="te-add-inline" data-timeline-action="add-text">＋ Text</button><button type="button" class="te-add-inline" data-timeline-action="add-graphic">＋ Graphic</button></div>';
			visuals.forEach(function (track) {
				html += '<div class="te-track-label' + (String(state.selectedTrackId) === String(track.id) ? ' selected' : '') + '"><button type="button" class="te-track-select" data-track-select="' + esc(track.id) + '">' + esc(track.label) + '<small>' + (track.items.length ? track.items.length + (track.items.length === 1 ? " clip" : " clips") : "empty") + '</small></button></div>';
				html += '<div class="te-lane te-visual-lane" data-lane-track="' + esc(track.id) + '" style="width:' + width + 'px">';
				if (!track.items.length) html += '<span class="te-lane-empty-static">Use + Text or + Graphic to add an element</span>';
				track.items.forEach(function (item) { html += htmlTrackItem(track, item, pps); });
				html += '<span class="te-playhead" data-playhead style="left:' + (state.playheadSec * pps).toFixed(1) + 'px"></span></div>';
			});
			html += '<div class="te-group-title te-group-background"><span class="te-group-label">' + esc(MEDIA_TRACK_NAME) + ' LAYER <small>pinned lowest · Pixabay, GIF, image or MP4</small></span><button type="button" class="te-add-inline" data-timeline-action="add-media">＋ Add media</button></div><div class="te-group-fill te-group-fill-background"></div>';
			var backgroundTrack = mediaTrack();
			html += '<div class="te-track-label te-track-background' + (String(state.selectedTrackId) === MEDIA_TRACK_ID ? ' selected' : '') + '"><button type="button" class="te-track-select" data-track-select="' + esc(MEDIA_TRACK_ID) + '">' + esc(backgroundTrack && backgroundTrack.label || MEDIA_TRACK_LABEL) + '<small><span class="te-track-badge">BG</span> ' + (backgroundTrack ? backgroundTrack.items.length + " scenes" : "empty") + '</small></button></div>';
			html += '<div class="te-lane te-media-lane te-background-lane" data-lane-track="' + esc(MEDIA_TRACK_ID) + '" style="width:' + width + 'px">';
			if (backgroundTrack) backgroundTrack.items.forEach(function (item) { html += htmlTrackItem(backgroundTrack, item, pps); });
			html += '<span class="te-playhead" data-playhead style="left:' + (state.playheadSec * pps).toFixed(1) + 'px"></span></div>';
			html += '<div class="te-group-title"><button type="button" class="te-group-toggle" data-timeline-action="toggle-sound" aria-expanded="' + (state.soundExpanded ? "true" : "false") + '"><span class="te-chevron">' + (state.soundExpanded ? "▾" : "▸") + '</span> Soundtrack <small>3 tracks</small></button></div><div class="te-group-fill"></div>';
			var soundTracks = state.tracks.filter(function (track) { return track.kind === "audio"; });
			if (state.soundExpanded) {
				soundTracks.forEach(function (track) {
					var collapsed = track.expanded === false;
					html += '<div class="te-track-label' + (String(state.selectedTrackId) === String(track.id) ? ' selected' : '') + '"><button type="button" class="te-track-select" data-track-select="' + esc(track.id) + '">' + esc(track.label) + '<small>' + (track.items.length ? track.items.length + (track.items.length === 1 ? " clip" : " clips") : "empty") + '</small></button><button type="button" class="te-track-toggle" data-track-toggle="' + esc(track.id) + '" aria-expanded="' + (!collapsed ? "true" : "false") + '" title="Expand or collapse ' + esc(track.label) + '">' + (collapsed ? "▸" : "▾") + '</button></div>';
					html += '<div class="te-lane te-audio-lane' + (collapsed ? ' collapsed' : '') + '" data-lane-track="' + esc(track.id) + '" style="width:' + width + 'px">';
					if (!collapsed) {
						if (!track.items.length) html += '<button type="button" class="te-lane-empty" data-track-select="' + esc(track.id) + '">＋ Add ' + esc(track.label.toLowerCase()) + '</button>';
						track.items.forEach(function (item) { html += htmlTrackItem(track, item, pps); });
						html += '<span class="te-playhead" data-playhead style="left:' + (state.playheadSec * pps).toFixed(1) + 'px"></span>';
					}
					html += '</div>';
				});
			}
			grid.innerHTML = html;
			var duration = document.getElementById("timeline-duration-label");
			if (duration) duration.textContent = formatTime(state.durationSec);
			var layerCount = document.getElementById("timeline-layer-count");
			if (layerCount) layerCount.textContent = visuals.length + " / " + MAX_VISUAL_TRACKS;
			var zoomInput = document.getElementById("timeline-zoom");
			var zoomValue = document.getElementById("timeline-zoom-value");
			if (zoomInput) zoomInput.value = String(zoom);
			if (zoomValue) zoomValue.textContent = zoom.toFixed(1).replace(/\\.0$/, "") + "×";
			updateReadout();
		}

		function updateReadout() {
			if (!state) return;
			var readout = document.getElementById("timeline-time-readout");
			if (readout) readout.textContent = formatTime(state.playheadSec) + " / " + formatTime(state.durationSec);
			var active = activeMediaAt(state.playheadSec);
			var scene = active && active.sceneId ? sceneById(active.sceneId) : null;
			var sceneLabel = document.getElementById("timeline-current-scene");
			if (sceneLabel) sceneLabel.textContent = scene ? scene.name : "No scene selected";
			var placeholder = document.getElementById("timeline-preview-placeholder");
			if (placeholder) placeholder.hidden = Boolean(active && active.assetId && assetMap[active.assetId]);
		}
		function updatePlayhead() {
			if (!state) return;
			var grid = document.getElementById("timeline-track-grid");
			if (!grid) return;
			var zoom = clamp(state.zoom, 0.5, 2);
			var pps = Math.max(14, Math.min(48, 1080 / Math.max(20, state.durationSec))) * zoom;
			grid.querySelectorAll("[data-playhead]").forEach(function (line) { line.style.left = (state.playheadSec * pps).toFixed(1) + "px"; });
			updateReadout();
		}
		function setPlayhead(value, save) {
			state.playheadSec = clamp(value, 0, state.durationSec);
			updatePlayhead();
			drawPreview();
			if (save) scheduleSave();
		}

		function itemTimingChanged(found, newStart, newDuration, rippleDuration, quietInspector) {
			if (!found) return;
			var track = found.track;
			var item = found.item;
			var oldStart = item.startSec;
			var oldDuration = item.durationSec;
			var nextStart = clamp(newStart, 0, MAX_DURATION_SEC);
			var nextDuration = clamp(newDuration, MIN_CLIP_SEC, MAX_DURATION_SEC);
			var startDelta = nextStart - oldStart;
			var durationDelta = nextDuration - oldDuration;
			item.startSec = nextStart;
			item.durationSec = nextDuration;
			if (track.kind === "media" && item.sceneId) {
				if (Math.abs(startDelta) > 0.0001) {
					var related = sceneElementTracks().reduce(function (all, elementTrack) { return all.concat(elementTrack.items.filter(function (candidate) { return String(candidate.sceneId || "") === String(item.sceneId); })); }, []);
					related.forEach(function (candidate) { candidate.startSec = clamp(candidate.startSec + startDelta, 0, MAX_DURATION_SEC); });
				}
				if (rippleDuration && Math.abs(durationDelta) > 0.0001) {
					track.items.forEach(function (other) {
						if (other === item || other.startSec < oldStart + oldDuration - 0.02) return;
						other.startSec = clamp(other.startSec + durationDelta, 0, MAX_DURATION_SEC);
						var relatedScene = other.sceneId;
						var otherElements = sceneElementTracks().reduce(function (all, elementTrack) { return all.concat(elementTrack.items.filter(function (candidate) { return String(candidate.sceneId || "") === String(relatedScene); })); }, []);
						otherElements.forEach(function (candidate) { candidate.startSec = clamp(candidate.startSec + durationDelta, 0, MAX_DURATION_SEC); });
					});
				}
			}
			ensureTimelineEnd(item.startSec + item.durationSec);
			state.playheadSec = clamp(state.playheadSec, 0, state.durationSec);
			renderTimeline();
			if (!quietInspector) renderInspector();
			drawPreview();
			scheduleSave();
		}
		function setItemTiming(itemId, start, duration) {
			itemTimingChanged(findItem(itemId), start, duration, true);
		}

		function addNumberControl(parent, label, value, min, max, step, onChange) {
			var field = document.createElement("label");
			field.className = "tm-scene-field";
			var caption = document.createElement("span");
			caption.className = "tm-scene-field-label";
			caption.textContent = label;
			field.appendChild(caption);
			var input = document.createElement("input");
			input.type = "number";
			input.min = String(min);
			input.max = String(max);
			input.step = String(step);
			input.value = String(value);
			input.addEventListener("change", function () { onChange(number(input.value, value)); });
			input.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); input.blur(); } });
			field.appendChild(input);
			parent.appendChild(field);
			return input;
		}
		function addSectionTitle(parent, text) {
			var title = document.createElement("div");
			title.className = "tm-scene-subtitle";
			title.textContent = text;
			parent.appendChild(title);
		}
		function addText(parent, label, value, maxLength, callback) {
			if (controlUI && typeof controlUI.addTextInput === "function") return controlUI.addTextInput(parent, label, value, maxLength, callback);
			return addNumberControl(parent, label, value, 0, 100, 1, callback);
		}
		function addSelect(parent, label, options, value, callback) {
			if (controlUI && typeof controlUI.addSelect === "function") return controlUI.addSelect(parent, label, options, value, callback);
			return null;
		}
		function addRange(parent, label, value, min, max, step, callback, suffix) {
			if (controlUI && typeof controlUI.addRange === "function") return controlUI.addRange(parent, label, value, min, max, step, callback, suffix);
			return addNumberControl(parent, label, value, min, max, step, callback);
		}
		function addCheckbox(parent, label, checked, callback) {
			if (controlUI && typeof controlUI.addCheckbox === "function") return controlUI.addCheckbox(parent, label, checked, callback);
			return null;
		}
		function addColor(parent, label, value, callback) {
			if (controlUI && typeof controlUI.addSceneColor === "function") return controlUI.addSceneColor(parent, label, value, callback);
			return addNumberControl(parent, label, 0, 0, 1, 1, function () { callback(value); });
		}
		function addUpload(parent, label, accept, multiple, callback) {
			var wrapper = document.createElement("label");
			wrapper.className = "tm-scene-upload";
			wrapper.textContent = label;
			var input = document.createElement("input");
			input.type = "file";
			input.accept = accept;
			input.multiple = Boolean(multiple);
			input.addEventListener("change", function (event) {
				var files = event.target.files ? Array.from(event.target.files) : [];
				input.value = "";
				if (files.length) callback(files);
			});
			wrapper.appendChild(input);
			parent.appendChild(wrapper);
		}

		function renderTrackControls(inspector, track) {
			addSectionTitle(inspector, "Track controls");
			if (track.kind === "media") {
				var mediaActions = document.createElement("div");
				mediaActions.className = "tm-scene-photo-controls";
				addUpload(mediaActions, "＋ Add images, GIFs or MP4s", "image/*,image/gif,video/mp4,.mp4,.gif", true, addMediaFiles);
				inspector.appendChild(mediaActions);
				var note = document.createElement("div");
				note.className = "te-inspector-note";
				note.textContent = "Pixabay scenes and your uploads share the one background layer. It is pinned below every text and graphic clip.";
				inspector.appendChild(note);
				return;
			}
			if (track.kind === "audio") {
				var audioActions = document.createElement("div");
				audioActions.className = "tm-scene-photo-controls";
				addUpload(audioActions, track.items.length ? "Replace audio" : "＋ Add audio", "audio/*,.mp3,.wav,.m4a,.aac,.ogg", false, function (files) { addAudioFile(track.id, files[0]); });
				inspector.appendChild(audioActions);
				var audioNote = document.createElement("div");
				audioNote.className = "te-inspector-note";
				audioNote.textContent = track.id === "voiceover" ? "Generated narration appears here when this row has a voiceover; imported audio stays local to this project." : "Add optional sound effects or background music. No server upload is used.";
				inspector.appendChild(audioNote);
				return;
			}
			var elementActions = document.createElement("div");
			elementActions.className = "tm-scene-photo-controls";
			if (track.kind === "visual") {
				var textButton = document.createElement("button");
				textButton.type = "button"; textButton.className = "tm-scene-add"; textButton.textContent = "＋ Text";
				textButton.addEventListener("click", function () { addVisualElement("text", track); });
				elementActions.appendChild(textButton);
				var graphicButton = document.createElement("button");
				graphicButton.type = "button"; graphicButton.className = "tm-scene-add"; graphicButton.textContent = "＋ Graphic";
				graphicButton.addEventListener("click", function () { addVisualElement("graphic", track); });
				elementActions.appendChild(graphicButton);
				var note = document.createElement("div");
				note.className = "te-inspector-note";
				note.textContent = "Text and graphics share this lane. Each clip has independent start and duration controls and can span multiple background scenes.";
				inspector.appendChild(elementActions); inspector.appendChild(note);
				return;
			}
		}

		function renderItemControls(inspector, track, item) {
			var cap = Math.min(MAX_DURATION_SEC, Math.max(60, state.durationSec * 2, item.startSec + item.durationSec));
			addSectionTitle(inspector, "Timing");
				addRange(inspector, "Start (seconds)", item.startSec, 0, cap, 0.25, function (value) { itemTimingChanged(findItem(item.id), value, item.durationSec, false, true); }, "s");
				addRange(inspector, "Duration (seconds)", item.durationSec, MIN_CLIP_SEC, cap, 0.25, function (value) { itemTimingChanged(findItem(item.id), item.startSec, value, track.kind === "media", true); }, "s");

			if (item.kind === "media") {
				addSectionTitle(inspector, "Background media");
				var info = document.createElement("div");
				info.className = "te-inspector-note";
				info.textContent = item.assetId ? (item.label + (item.mediaSource ? " · " + item.mediaSource : "") + " · background layer") : "No media file is attached to this scene yet. Add a local image, GIF or MP4 to the single background layer.";
				inspector.appendChild(info);
				addSelect(inspector, "Fit", [["Fill frame", "cover"], ["Fit inside", "contain"]], item.fit || "cover", function (value) { item.fit = value; drawPreview(); scheduleSave(); });
				addRange(inspector, "Trim in (seconds)", item.trimStartSec || 0, 0, 600, 0.25, function (value) { item.trimStartSec = value; drawPreview(); scheduleSave(); }, "s");
				addCheckbox(inspector, "Visible", item.visible !== false, function (value) { item.visible = value; drawPreview(); scheduleSave(); });
				return;
			}
			if (item.kind === "audio") {
				addSectionTitle(inspector, "Sound");
				addRange(inspector, "Volume", item.volume == null ? 1 : item.volume, 0, 1, 0.05, function (value) { item.volume = value; syncAudioPlayback(); scheduleSave(); }, "×");
				addCheckbox(inspector, "Mute", item.muted, function (value) { item.muted = value; syncAudioPlayback(); scheduleSave(); });
				var audioInfo = document.createElement("div");
				audioInfo.className = "te-inspector-note";
				audioInfo.textContent = item.assetId && assetMap[item.assetId] ? (item.label + " · local audio") : "This sound clip has no local audio file attached.";
				inspector.appendChild(audioInfo);
				return;
			}
			if (item.kind === "text") {
				addSectionTitle(inspector, "Text element");
				addText(inspector, "Text", item.text || "", 500, function (value) { item.text = value; item.label = item.name || "Text"; renderTimeline(); drawPreview(); scheduleSave(); });
				addRange(inspector, "Font size", item.fontSize || 28, 10, 140, 1, function (value) { item.fontSize = value; drawPreview(); scheduleSave(); }, "px");
				addColor(inspector, "Color", item.color || "#ffffff", function (value) { item.color = value; drawPreview(); scheduleSave(); });
				addSelect(inspector, "Font", [["Sans", "sans"], ["Serif", "serif"], ["Mono", "mono"]], item.font || "sans", function (value) { item.font = value; drawPreview(); scheduleSave(); });
				addSelect(inspector, "Alignment", [["Left", "left"], ["Center", "center"], ["Right", "right"]], item.align || "center", function (value) { item.align = value; drawPreview(); scheduleSave(); });
				addRange(inspector, "X position", item.x == null ? 50 : item.x, 0, 100, 1, function (value) { item.x = value; drawPreview(); scheduleSave(); }, "%");
				addRange(inspector, "Y position", item.y == null ? 78 : item.y, 0, 100, 1, function (value) { item.y = value; drawPreview(); scheduleSave(); }, "%");
				addCheckbox(inspector, "Visible", item.visible !== false, function (value) { item.visible = value; drawPreview(); scheduleSave(); });
				return;
			}
			if (item.kind === "graphic") {
				addSectionTitle(inspector, "Graphic element");
				addSelect(inspector, "Graphic", [["Circle", "circle"], ["Square", "square"], ["Triangle", "triangle"], ["Star", "star"], ["Heart", "heart"], ["Arrow", "arrow"]], item.graphic || "circle", function (value) { item.graphic = value; drawPreview(); scheduleSave(); });
				addRange(inspector, "Size", item.size || 72, 12, 500, 1, function (value) { item.size = value; drawPreview(); scheduleSave(); }, "px");
				addColor(inspector, "Color", item.color || "#7aac2b", function (value) { item.color = value; drawPreview(); scheduleSave(); });
				addRange(inspector, "X position", item.x == null ? 50 : item.x, 0, 100, 1, function (value) { item.x = value; drawPreview(); scheduleSave(); }, "%");
				addRange(inspector, "Y position", item.y == null ? 50 : item.y, 0, 100, 1, function (value) { item.y = value; drawPreview(); scheduleSave(); }, "%");
				addCheckbox(inspector, "Visible", item.visible !== false, function (value) { item.visible = value; drawPreview(); scheduleSave(); });
			}
		}

		function renderInspector() {
			if (!state) return;
			var inspector = document.getElementById("timeline-inspector");
			var selector = document.getElementById("timeline-element-selector");
			var empty = document.getElementById("timeline-inspector-empty");
			var deleteButton = document.getElementById("timeline-delete-element");
			if (!inspector || !selector) return;
			inspector.innerHTML = "";
			selector.innerHTML = "";
			var entry = selectedEntry();
			var track = entry ? entry.track : selectedTrack();
			var item = entry && entry.item;
			var selectedScene = item && item.sceneId ? sceneById(item.sceneId) : activeSceneAt(state.playheadSec);
			selectedSceneId = selectedScene && selectedScene.id || selectedSceneId;
			var selectedLabel = document.createElement("div");
			selectedLabel.className = "tm-scene-inspector-title";
			selectedLabel.textContent = item ? String(item.label || item.name || (item.kind === "text" ? "Text" : item.kind)) : track ? track.label : "Nothing selected";
			selector.appendChild(selectedLabel);
			if (selectedScene) {
				sceneElementEntries(selectedScene.id).forEach(function (candidate) {
					var button = document.createElement("button");
					button.type = "button";
					button.className = "tm-scene-object" + (item && String(item.id) === String(candidate.item.id) ? " selected" : "");
					button.textContent = candidate.item.kind === "text" ? "Text · " + String(candidate.item.text || "").slice(0, 20) : "Graphic · " + String(candidate.item.graphic || "shape");
					button.setAttribute("aria-pressed", item && String(item.id) === String(candidate.item.id) ? "true" : "false");
					button.addEventListener("click", function () { chooseItem(candidate.track, candidate.item); });
					selector.appendChild(button);
				});
			}
			if (empty) empty.hidden = Boolean(item || track);
			if (deleteButton) {
				var canDelete = Boolean(item && !(item.kind === "audio" && item.assetId === "voiceover" && track.id === "voiceover"));
				deleteButton.hidden = !canDelete;
				deleteButton.disabled = !canDelete;
			}
			if (item && track) renderItemControls(inspector, track, item);
			else if (track) renderTrackControls(inspector, track);
		}

		function addVisualTrack() {
			if (visualTracks().length >= MAX_VISUAL_TRACKS) {
				setStatus("Text and graphics are limited to four lanes.", true);
				return null;
			}
			var next = visualTracks().length + 1;
			var track = { id: "visual-" + next + "-" + Date.now().toString(36), kind: "visual", label: "Text & graphics " + next, expanded: true, items: [] };
			state.tracks.push(track);
			state.selectedTrackId = track.id;
			state.selectedItemId = "";
			renderTimeline(); renderInspector(); scheduleSave();
			setStatus("Added " + track.label + " lane.", false);
			return track;
		}
		function addVisualElement(kind, targetTrack) {
			var track = targetTrack && targetTrack.kind === "visual" ? targetTrack : findTrack(state.selectedTrackId);
			if (!track || track.kind !== "visual") track = visualTracks()[0] || addVisualTrack();
			if (!track) return null;
			var scene = activeSceneAt(state.playheadSec) || state.scenes[0];
			var start = clamp(state.playheadSec, 0, MAX_DURATION_SEC);
			var id = makeId(kind);
			var item = kind === "graphic" ? {
				id: id, kind: "graphic", graphic: "circle", label: "Graphic", sceneId: scene && scene.id || "",
				startSec: start, durationSec: 4, x: 50, y: 50, size: 72, color: "#7aac2b", visible: true
			} : {
				id: id, kind: "text", label: "Text", text: "Add your text", sceneId: scene && scene.id || "",
				startSec: start, durationSec: 4, x: 50, y: 78, fontSize: 28, color: "#ffffff", font: "sans", align: "center", visible: true
			};
			track.items.push(item);
			state.selectedTrackId = track.id;
			state.selectedItemId = id;
			if (scene) selectedSceneId = scene.id;
			ensureTimelineEnd(start + item.durationSec);
			renderTimeline(); renderInspector(); drawPreview(); scheduleSave();
			return item;
		}
		function deleteSelectedItem() {
			var found = selectedEntry();
			if (!found) return;
			if (found.item.kind === "audio" && found.item.assetId === "voiceover" && found.track.id === "voiceover") {
				setStatus("The generated voiceover lane stays available; mute it or replace it from its controls.", true);
				return;
			}
			var removed = found.item;
			found.track.items = found.track.items.filter(function (item) { return item !== removed; });
			if (removed.kind === "media" && removed.sceneId) {
				state.scenes = state.scenes.filter(function (scene) { return String(scene.id) !== String(removed.sceneId); });
				sceneElementTracks().forEach(function (track) { track.items = track.items.filter(function (item) { return String(item.sceneId || "") !== String(removed.sceneId); }); });
			}
			if (audioMap[removed.id]) { try { audioMap[removed.id].pause(); } catch (error) {} delete audioMap[removed.id]; }
			if (removed.assetId && assetMap[removed.assetId]) {
				var stillUsed = state.tracks.some(function (candidateTrack) { return candidateTrack.items.some(function (candidate) { return candidate.assetId === removed.assetId; }); });
				if (!stillUsed) {
					var old = assetMap[removed.assetId];
					if (old.url) { try { URL.revokeObjectURL(old.url); } catch (error) {} }
					delete assetMap[removed.assetId];
				}
			}
			state.selectedItemId = "";
			renderTimeline(); renderInspector(); drawPreview(); scheduleSave();
		}

		function fileIsMedia(file) {
			var type = String(file && file.type || "").toLowerCase();
			var name = String(file && file.name || "").toLowerCase();
			return type.indexOf("image/") === 0 || type === "video/mp4" || /\\.(gif|mp4|png|jpe?g|webp|bmp)$/.test(name);
		}
		function fileIsAudio(file) {
			var type = String(file && file.type || "").toLowerCase();
			var name = String(file && file.name || "").toLowerCase();
			return type.indexOf("audio/") === 0 || /\\.(mp3|wav|m4a|aac|ogg|flac)$/.test(name);
		}
		function fileType(file) {
			var type = String(file && file.type || "").toLowerCase();
			var name = String(file && file.name || "").toLowerCase();
			if (type === "video/mp4" || name.slice(-4) === ".mp4") return "video";
			if (type === "image/gif" || name.slice(-4) === ".gif") return "gif";
			return "image";
		}
		function probeDuration(file, mediaKind) {
			return new Promise(function (resolve) {
				var tag = mediaKind === "audio" ? "audio" : "video";
				var node = document.createElement(tag);
				var url = "";
				var settled = false;
				var timer = setTimeout(function () { finish(5); }, 5000);
				function finish(value) {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					try { node.pause(); node.removeAttribute("src"); node.load(); } catch (error) {}
					if (url) { try { URL.revokeObjectURL(url); } catch (error) {} }
					resolve(Number.isFinite(value) && value > 0 ? Math.min(MAX_DURATION_SEC, value) : 5);
				}
				try {
					url = URL.createObjectURL(file);
					node.preload = "metadata";
					node.onloadedmetadata = function () { finish(number(node.duration, 5)); };
					node.onerror = function () { finish(5); };
					node.src = url;
				} catch (error) { finish(5); }
			});
		}
		function registerAsset(id, blob, metadata) {
			if (!id || !blob) return null;
			var previous = assetMap[id];
			if (previous && previous.url) { try { URL.revokeObjectURL(previous.url); } catch (error) {} }
			Object.keys(audioMap).forEach(function (itemId) {
				var entry = findItem(itemId);
				if (!entry || entry.item.assetId !== String(id)) return;
				try { audioMap[itemId].pause(); } catch (error) {}
				delete audioMap[itemId];
			});
			var url = "";
			try { url = URL.createObjectURL(blob); } catch (error) {}
			var info = metadata || {};
			var type = String(info.type || blob.type || "");
			var record = { id: String(id), blob: blob, url: url, name: String(info.name || blob.name || ""), type: type, source: info.source || null, image: null, video: null };
			if (type.indexOf("image/") === 0 && url) {
				var image = new Image();
				image.onload = function () { drawPreview(); };
				image.onerror = function () { setStatus("A local image could not be decoded for preview.", true); };
				image.src = url;
				record.image = image;
			}
			else if (type === "video/mp4" && url) {
				var video = document.createElement("video");
				video.muted = true; video.loop = true; video.playsInline = true; video.preload = "auto"; video.src = url;
				video.addEventListener("loadeddata", function () { drawPreview(); });
				record.video = video;
			}
			assetMap[String(id)] = record;
			objectUrls.push(url);
			return record;
		}
		async function addMediaFiles(files) {
			var valid = (Array.isArray(files) ? files : []).filter(fileIsMedia).slice(0, MAX_MEDIA_FILES);
			var track = mediaTrack();
			if (!track) return;
			if (!valid.length) { setStatus("Choose an image, GIF or MP4 file.", true); return; }
			var nextStart = track.items.reduce(function (end, item) { return Math.max(end, item.startSec + item.durationSec); }, 0);
			for (var i = 0; i < valid.length; i++) {
				var file = valid[i];
				var kind = fileType(file);
				var placeholder = track.items.find(function (item) { return !item.assetId; }) || null;
				var duration = kind === "video" ? await probeDuration(file, "video") : placeholder ? placeholder.durationSec : 5;
				var assetId = makeId("upload");
				var sceneId;
				var item;
				var scene;
				if (placeholder) {
					item = placeholder;
					sceneId = String(item.sceneId || makeId("scene"));
					scene = sceneById(sceneId);
					if (!scene) {
						scene = { id: sceneId, index: state.scenes.length, name: "Uploaded scene " + (state.scenes.length + 1), startSec: item.startSec, durationSec: item.durationSec, elements: [] };
						state.scenes.push(scene);
						item.sceneId = sceneId;
					}
					var timing = findItem(item.id);
					if (Math.abs(duration - item.durationSec) > 0.01) itemTimingChanged(timing, item.startSec, duration, true, true);
					item.assetId = assetId;
					item.label = String(file.name || "Uploaded media");
					item.mediaType = kind;
					item.mediaSource = "user upload";
					scene.name = "Scene " + (scene.index + 1) + " · " + String(file.name || "Uploaded media");
					scene.mediaType = kind; scene.mediaAssetId = assetId; scene.mediaName = String(file.name || "Uploaded media"); scene.mediaSource = "user upload";
					nextStart = track.items.reduce(function (end, candidate) { return Math.max(end, candidate.startSec + candidate.durationSec); }, 0);
				} else {
					sceneId = makeId("scene");
					var itemId = makeId("media");
					scene = { id: sceneId, index: state.scenes.length, name: "Uploaded scene " + (state.scenes.length + 1), startSec: nextStart, durationSec: duration, mediaType: kind, mediaAssetId: assetId, mediaName: String(file.name || "Uploaded media"), mediaSource: "user upload", prompt: "", elements: [] };
					item = { id: itemId, kind: "media", sceneId: sceneId, assetId: assetId, label: String(file.name || "Uploaded media"), mediaType: kind, mediaSource: "user upload", startSec: nextStart, durationSec: duration, trimStartSec: 0, fit: "cover", visible: true };
					state.scenes.push(scene); track.items.push(item);
					nextStart += duration;
				}
				registerAsset(assetId, file, { name: file.name, type: file.type || (kind === "video" ? "video/mp4" : kind === "gif" ? "image/gif" : "image/jpeg"), source: "user upload" });
				api.storeAsset(pageId, assetId, file, { name: file.name, type: file.type, source: "user upload" }).then(function (result) { if (!result || !result.ok) setStatus("Media is usable now but could not be kept for reloads in this browser.", true); });
				state.selectedTrackId = track.id; state.selectedItemId = item.id; selectedSceneId = sceneId;
			}
			ensureTimelineEnd(nextStart);
			renderTimeline(); renderInspector(); drawPreview(); scheduleSave();
			setStatus(valid.length + (valid.length === 1 ? " media file added" : " media files added") + " to the background layer.", false);
		}
		async function addAudioFile(trackId, file) {
			if (!file || !fileIsAudio(file)) { setStatus("Choose an audio file such as MP3, WAV or M4A.", true); return; }
			var track = findTrack(trackId);
			if (!track || track.kind !== "audio") return;
			var duration = await probeDuration(file, "audio");
			var assetId = track.id === "voiceover" ? "voiceover" : makeId("audio");
			var itemId = track.id === "voiceover" ? "audio-voiceover" : makeId("audio");
			var start = track.id === "voiceover" ? 0 : state.playheadSec;
			track.items = track.items.filter(function (item) { return !(track.id === "voiceover" && item.assetId === "voiceover"); });
			var item = { id: itemId, kind: "audio", assetId: assetId, label: String(file.name || track.label), startSec: start, durationSec: duration, volume: 1, muted: false, mediaSource: "user upload" };
			track.items.push(item);
			registerAsset(assetId, file, { name: file.name, type: file.type, source: "user upload" });
			var metadata = track.id === "voiceover" ? { voiceover: file, assets: [] } : { assets: [{ id: assetId, blob: file, name: file.name, type: file.type, source: "user upload" }] };
			api.storeProjectAssets(pageId, metadata).then(function (result) { if (!result || !result.ok) setStatus("Audio is usable now but could not be kept for reloads in this browser.", true); });
			state.selectedTrackId = track.id; state.selectedItemId = itemId;
			ensureTimelineEnd(start + duration);
			renderTimeline(); renderInspector(); drawPreview(); scheduleSave();
			setStatus("Added " + (file.name || track.label) + " to " + track.label + ".", false);
		}

		function addVisualElementFromAction(kind) {
			return addVisualElement(kind, selectedTrack());
		}
		function getSelectedMediaScene() {
			var item = activeMediaAt(state.playheadSec);
			if (!item && selectedSceneId) return sceneById(selectedSceneId);
			return item && item.sceneId ? sceneById(item.sceneId) : null;
		}

		function drawPlaceholder(context, width, height, scene) {
			context.fillStyle = "#111217"; context.fillRect(0, 0, width, height);
			var gradient = context.createLinearGradient(0, 0, width, height);
			gradient.addColorStop(0, "rgba(122,172,43,0.28)"); gradient.addColorStop(1, "rgba(37,99,235,0.16)");
			context.fillStyle = gradient; context.fillRect(0, 0, width, height);
			context.fillStyle = "rgba(255,255,255,0.88)"; context.textAlign = "center"; context.textBaseline = "middle";
			context.font = "700 " + Math.max(16, Math.round(width * 0.045)) + "px system-ui, sans-serif";
			context.fillText(scene ? scene.name : "Timeline preview", width / 2, height * 0.47, width * 0.82);
			context.font = Math.max(10, Math.round(width * 0.022)) + "px system-ui, sans-serif";
			context.fillText(scene && scene.mediaSource === "pending" ? "Upload or attach a background scene" : "Preview frame", width / 2, height * 0.54, width * 0.82);
			context.font = Math.max(9, Math.round(width * 0.018)) + "px system-ui, sans-serif";
			context.fillText("Background layer · text and graphics paint above it", width / 2, height * 0.6, width * 0.82);
		}
		function drawImageCover(context, image, width, height, fit) {
			if (!image) return false;
			var iw = Number(image.videoWidth || image.naturalWidth || 0);
			var ih = Number(image.videoHeight || image.naturalHeight || 0);
			if (!iw || !ih) return false;
			var scale = fit === "contain" ? Math.min(width / iw, height / ih) : Math.max(width / iw, height / ih);
			var dw = iw * scale, dh = ih * scale;
			context.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
			return true;
		}
		function drawGraphic(context, item, width, height) {
			var x = width * (number(item.x, 50) / 100);
			var y = height * (number(item.y, 50) / 100);
			var size = Math.max(8, number(item.size, 72) * Math.max(1, height / 720));
			context.save(); context.translate(x, y); context.rotate(number(item.rotation, 0) * Math.PI / 180); context.fillStyle = item.color || "#7aac2b";
			if (item.graphic === "square") context.fillRect(-size / 2, -size / 2, size, size);
			else if (item.graphic === "triangle") { context.beginPath(); context.moveTo(0, -size / 2); context.lineTo(size / 2, size / 2); context.lineTo(-size / 2, size / 2); context.closePath(); context.fill(); }
			else if (item.graphic === "star") { context.beginPath(); for (var n = 0; n < 10; n++) { var radius = n % 2 ? size * 0.22 : size * 0.5; var angle = -Math.PI / 2 + n * Math.PI / 5; if (!n) context.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius); else context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius); } context.closePath(); context.fill(); }
			else if (item.graphic === "heart") { context.font = size + "px serif"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText("♥", 0, 0); }
			else if (item.graphic === "arrow") { context.beginPath(); context.moveTo(-size / 2, -size / 6); context.lineTo(size / 6, -size / 6); context.lineTo(size / 6, -size / 3); context.lineTo(size / 2, 0); context.lineTo(size / 6, size / 3); context.lineTo(size / 6, size / 6); context.lineTo(-size / 2, size / 6); context.closePath(); context.fill(); }
			else { context.beginPath(); context.arc(0, 0, size / 2, 0, Math.PI * 2); context.fill(); }
			context.restore();
		}
		function drawText(context, item, width, height, selected) {
			if (!item.visible || !item.text) return;
			var fontSize = Math.max(10, number(item.fontSize, 28) * Math.max(1, height / 720));
			var family = item.font === "serif" ? "Georgia, serif" : item.font === "mono" ? "monospace" : "system-ui, sans-serif";
			context.save(); context.fillStyle = item.color || "#ffffff"; context.textAlign = item.align || "center"; context.textBaseline = "middle";
			context.font = "700 " + Math.round(fontSize) + "px " + family;
			var x = width * (number(item.x, 50) / 100); var y = height * (number(item.y, 78) / 100);
			var lines = String(item.text || "").split("\\n").slice(0, 8);
			var lineHeight = fontSize * 1.2;
			lines.forEach(function (line, index) { context.fillText(line, x, y + (index - (lines.length - 1) / 2) * lineHeight, width * 0.88); });
			if (selected) { context.strokeStyle = "#c8f36f"; context.lineWidth = Math.max(1, width / 720); context.strokeRect(Math.max(4, x - width * 0.44), y - lineHeight * Math.max(1, lines.length) / 2, width * 0.88, lineHeight * Math.max(1, lines.length)); }
			context.restore();
		}
		function syncVideoPreview(active, asset, seconds) {
			Object.keys(assetMap).forEach(function (key) {
				var candidate = assetMap[key];
				if (!candidate.video) return;
				if (!isPlaying || !active || !asset || candidate !== asset) {
					try { candidate.video.pause(); } catch (error) {}
					return;
				}
				var offset = Math.max(0, seconds - active.startSec + number(active.trimStartSec, 0));
				if (Number.isFinite(candidate.video.duration) && candidate.video.duration > 0) offset = offset % candidate.video.duration;
				if (Math.abs(number(candidate.video.currentTime, 0) - offset) > 0.3 && !candidate.video.seeking) { try { candidate.video.currentTime = offset; } catch (error) {} }
				if (candidate.video.paused) { var played = candidate.video.play(); if (played && typeof played.catch === "function") played.catch(function () {}); }
			});
		}
		function syncAudioPlayback() {
			if (!state) return;
			state.tracks.filter(function (track) { return track.kind === "audio"; }).forEach(function (track) {
				track.items.forEach(function (item) {
					var asset = assetMap[item.assetId];
					if (!asset || !asset.url || !item.assetId) return;
					var audio = audioMap[item.id];
					if (!audio) { audio = new Audio(asset.url); audioMap[item.id] = audio; }
					var inRange = state.playheadSec >= item.startSec && state.playheadSec < item.startSec + item.durationSec;
					audio.volume = item.muted ? 0 : clamp(item.volume == null ? 1 : item.volume, 0, 1);
					if (isPlaying && inRange) {
						var target = Math.max(0, state.playheadSec - item.startSec);
						if (Number.isFinite(audio.duration) && audio.duration > 0) target = target % audio.duration;
						if (Math.abs(number(audio.currentTime, 0) - target) > 0.35) { try { audio.currentTime = target; } catch (error) {} }
						if (audio.paused) { var result = audio.play(); if (result && typeof result.catch === "function") result.catch(function () {}); }
					}
					else { try { audio.pause(); } catch (error) {} }
				});
			});
		}
		function drawPreview() {
			if (!canvas || !canvasContext || !state) return;
			var width = canvas.width || 720; var height = canvas.height || 1280;
			var context = canvasContext;
			context.clearRect(0, 0, width, height);
			var active = activeMediaAt(state.playheadSec);
			var scene = active && active.sceneId ? sceneById(active.sceneId) : getSelectedMediaScene();
			var asset = active && active.assetId ? assetMap[active.assetId] : null;
			context.fillStyle = "#08090c"; context.fillRect(0, 0, width, height);
			var drawn = false;
			/* Layer 0 — the background layer. Pixabay stock and uploads land here. */
			if (active && active.visible !== false && asset) {
				if (asset.video) {
					syncVideoPreview(active, asset, state.playheadSec);
					drawn = asset.video.readyState >= 2 && drawImageCover(context, asset.video, width, height, active.fit || "cover");
				}
				else if (asset.image && asset.image.complete) drawn = drawImageCover(context, asset.image, width, height, active.fit || "cover");
			}
			if (!drawn) drawPlaceholder(context, width, height, scene);
			/* Layers 1..4 — every text and graphic clip paints above the background. */
			visualTracks().forEach(function (track) {
				track.items.forEach(function (item) {
					var live = state.playheadSec >= item.startSec && state.playheadSec < item.startSec + item.durationSec;
					if (!live) return;
					if (item.kind === "graphic" && item.visible !== false) drawGraphic(context, item, width, height);
					if (item.kind === "text") drawText(context, item, width, height, String(item.id) === String(state.selectedItemId));
				});
			});
			var placeholder = document.getElementById("timeline-preview-placeholder");
			if (placeholder) placeholder.hidden = drawn;
			var note = document.getElementById("timeline-preview-note");
			if (note) note.textContent = asset ? (asset.name || "Local media preview") + " · background layer · timing edits are saved in this browser" : "No media file is attached to the selected scene yet. Use + Add media to upload an image, GIF or MP4 to the background layer.";
			syncAudioPlayback();
			updateReadout();
			if (isPlaying || shouldAnimatePreview()) schedulePreviewFrame();
		}

		function previewTick(now) {
			previewFrame = 0;
			if (!state) return;
			if (isPlaying) {
				var elapsed = Math.max(0, Math.min(0.25, (now - previousFrameAt) / 1000));
				state.playheadSec += elapsed;
				if (state.playheadSec >= state.durationSec) {
					state.playheadSec = state.durationSec;
					setPlaying(false);
				}
				updatePlayhead();
				if (state.playheadSec > 0 && Math.floor(state.playheadSec) !== Math.floor(state.playheadSec - elapsed)) scheduleSave();
			}
			previousFrameAt = now;
			drawPreview();
			if (isPlaying || shouldAnimatePreview()) schedulePreviewFrame();
		}
		function setPlaying(value) {
			isPlaying = Boolean(value);
			if (playButton) playButton.textContent = isPlaying ? "Ⅱ Pause" : "▶ Play";
			if (isPlaying) previousFrameAt = performance.now();
			syncAudioPlayback();
			drawPreview();
		}
		function moveScene(direction) {
			var active = activeMediaAt(state.playheadSec);
			var index = active ? activeTrackIndex(active) : 0;
			var track = mediaTrack();
			if (!track || !track.items.length) { setPlayhead(state.playheadSec + (direction * 5), true); return; }
			var next = clamp(index + direction, 0, track.items.length - 1);
			var item = track.items[next];
			setPlayhead(item.startSec, true);
			chooseItem(track, item);
		}
		function activeTrackIndex(item) {
			var track = mediaTrack();
			return track ? Math.max(0, track.items.indexOf(item)) : 0;
		}

		function handleAction(action, target) {
			if (action === "play") { setPlaying(!isPlaying); return; }
			if (action === "restart") { setPlaying(false); setPlayhead(0, true); return; }
			if (action === "step-back") { moveScene(-1); return; }
			if (action === "step-forward") { moveScene(1); return; }
			if (action === "add-layer") { addVisualTrack(); return; }
			if (action === "add-text") { addVisualElementFromAction("text"); return; }
			if (action === "add-graphic") { addVisualElementFromAction("graphic"); return; }
			if (action === "delete") { deleteSelectedItem(); return; }
			if (action === "toggle-sound") { state.soundExpanded = !state.soundExpanded; renderTimeline(); scheduleSave(); return; }
			if (action === "add-media") { var mediaInput = document.getElementById("timeline-media-upload"); if (mediaInput) mediaInput.click(); return; }
			if (action === "toggle-track") {
				var track = findTrack(target.getAttribute("data-track-toggle"));
				if (track) { track.expanded = track.expanded === false; renderTimeline(); scheduleSave(); }
			}
		}
		function bindEvents() {
			var root = document.getElementById("timeline-editor");
			var grid = document.getElementById("timeline-track-grid");
			if (!root || !grid) return;
			root.addEventListener("click", function (event) {
				var actionNode = event.target && event.target.closest ? event.target.closest("[data-timeline-action]") : null;
				if (actionNode) { handleAction(actionNode.getAttribute("data-timeline-action"), actionNode); return; }
				var trackToggle = event.target && event.target.closest ? event.target.closest("[data-track-toggle]") : null;
				if (trackToggle) { handleAction("toggle-track", trackToggle); return; }
				var trackNode = event.target && event.target.closest ? event.target.closest("[data-track-select]") : null;
				if (trackNode) { chooseTrack(findTrack(trackNode.getAttribute("data-track-select"))); return; }
				var clip = event.target && event.target.closest ? event.target.closest("[data-clip-id]") : null;
				if (clip) {
					if (suppressClick) { suppressClick = false; return; }
					var found = findItem(clip.getAttribute("data-clip-id"));
					if (found) chooseItem(found.track, found.item);
				}
			});
			grid.addEventListener("click", function (event) {
				var lane = event.target && event.target.closest ? event.target.closest("[data-lane-track]") : null;
				if (!lane || (event.target.closest && (event.target.closest("[data-clip-id]") || event.target.closest("[data-track-select]")))) return;
				var rect = lane.getBoundingClientRect();
				var pps = Math.max(14, Math.min(48, 1080 / Math.max(20, state.durationSec))) * clamp(state.zoom, 0.5, 2);
				setPlayhead((event.clientX - rect.left) / pps, true);
			});
			grid.addEventListener("pointerdown", function (event) {
				var clip = event.target && event.target.closest ? event.target.closest("[data-clip-id]") : null;
				if (!clip) return;
				var itemId = clip.getAttribute("data-clip-id");
				var found = findItem(itemId);
				if (!found) return;
				var resize = event.target.closest && event.target.closest("[data-resize-id]");
				activeDrag = { id: itemId, mode: resize ? "resize" : "move", startX: event.clientX, startSec: found.item.startSec, durationSec: found.item.durationSec, moved: false };
				try { clip.setPointerCapture(event.pointerId); } catch (error) {}
			});
			document.addEventListener("pointermove", function (event) {
				if (!activeDrag) return;
				var found = findItem(activeDrag.id);
				if (!found) return;
				var pps = Math.max(14, Math.min(48, 1080 / Math.max(20, state.durationSec))) * clamp(state.zoom, 0.5, 2);
				var delta = (event.clientX - activeDrag.startX) / pps;
				if (Math.abs(delta) > 0.03) activeDrag.moved = true;
				if (!activeDrag.moved) return;
				suppressClick = true;
				if (activeDrag.mode === "resize") itemTimingChanged(found, found.item.startSec, Math.max(MIN_CLIP_SEC, activeDrag.durationSec + delta), found.track.kind === "media", true);
				else itemTimingChanged(found, Math.max(0, activeDrag.startSec + delta), found.item.durationSec, false, true);
				event.preventDefault();
			});
			document.addEventListener("pointerup", function () {
				if (!activeDrag) return;
				if (activeDrag.moved) { persistNow(); setTimeout(function () { suppressClick = false; }, 0); }
				activeDrag = null;
			});
			var zoom = document.getElementById("timeline-zoom");
			if (zoom) zoom.addEventListener("input", function () { state.zoom = clamp(zoom.value, 0.5, 2); renderTimeline(); scheduleSave(); });
			var mediaInput = document.getElementById("timeline-media-upload");
			if (mediaInput) mediaInput.addEventListener("change", function () { var files = mediaInput.files ? Array.from(mediaInput.files) : []; mediaInput.value = ""; addMediaFiles(files); });
			var audioInput = document.getElementById("timeline-audio-upload");
			if (audioInput) audioInput.addEventListener("change", function () { var file = audioInput.files && audioInput.files[0]; audioInput.value = ""; if (file) addAudioFile(pendingAudioTrackId || "sound-fx", file); });
			var back = document.getElementById("timeline-back");
			if (back) back.addEventListener("click", function () {
				persistNow();
				try { window.close(); } catch (error) {}
				if (!window.closed) {
					var url = new URL(window.location.href);
					url.searchParams.delete("projectEdit");
					url.searchParams.delete("pipelinePage");
					url.searchParams.set("layout", "table");
					window.location.href = url.pathname + url.search + url.hash;
				}
			});
			window.addEventListener("beforeunload", function () {
				persistNow();
				if (previewFrame && window.cancelAnimationFrame) window.cancelAnimationFrame(previewFrame);
				objectUrls.forEach(function (url) { try { URL.revokeObjectURL(url); } catch (error) {} });
				Object.keys(audioMap).forEach(function (key) { try { audioMap[key].pause(); } catch (error) {} });
			});
		}

		function registerStoredAssets(record) {
			if (!record) return 0;
			var count = 0;
			var stored = record.assets || {};
			Object.keys(stored).forEach(function (id) {
				var asset = stored[id];
				if (!asset || !asset.blob) return;
				registerAsset(id, asset.blob, asset); count++;
			});
			if (record.voiceover && record.voiceover instanceof Blob) {
				registerAsset("voiceover", record.voiceover, { name: "Generated voiceover", type: record.voiceover.type || "audio/mpeg", source: "voiceover" }); count++;
			}
			return count;
		}
		async function waitForStoredAssets() {
			var count = 0;
				for (var attempt = 0; attempt < 80; attempt++) {
				try {
					var record = await readAssetRecord(pageId);
					if (record) { count = registerStoredAssets(record); break; }
				} catch (error) { break; }
				await new Promise(function (resolve) { setTimeout(resolve, 150); });
			}
			if (count) setStatus(count + (count === 1 ? " local media asset loaded." : " local media assets loaded."), false);
			else setStatus("No transferred media file was available. Timing still works; use + Add media or upload audio.", false);
			drawPreview();
		}

		function updateProjectHeading() {
			var title = document.getElementById("timeline-project-title");
			var subtitle = document.getElementById("timeline-project-subtitle");
			var settings = transition && transition.basicSettings || {};
			if (title) title.textContent = settings.title ? String(settings.title) : "Timeline editor";
			if (subtitle) subtitle.textContent = "Quick Batch row " + String(settings.id || "") + " · " + state.scenes.length + " scenes · browser-only timing";
		}

		function boot() {
			var app = document.getElementById("studio-app");
			if (app) app.classList.add("timeline-mode");
			if (document.body) document.body.classList.add("timeline-editor-page");
			var saved = null;
			try { saved = JSON.parse(window.localStorage.getItem(storageKey) || "null"); } catch (error) {}
			var initial = saved && saved.projectId === pageId ? saved : transition && transition.timelineState || null;
			state = normalizeState(initial || defaultTimeline());
			if (transition) {
				state.sourcePageId = String(transition.sourcePageId || state.sourcePageId || "");
				state.sourceRowId = String(transition.basicSettings && transition.basicSettings.id || state.sourceRowId || "");
			}
			if (transition && transition.basicSettings && transition.basicSettings.script && !state.scenes.some(function (scene) { return scene.prompt; })) {
				/* The scene list remains a timing scaffold; no pipeline or prompt request is run here. */
				state.scenes.forEach(function (scene, index) { if (index === 0) scene.note = "Script is available in the Quick Batch row"; });
			}
			window.__TIMELINE_EDITOR_STATE__ = state;
			var firstTrack = findTrack(state.selectedTrackId) || mediaTrack();
			var firstItem = findItem(state.selectedItemId);
			if (firstItem) state.selectedTrackId = firstItem.track.id;
			else if (firstTrack && firstTrack.items.length) {
				state.selectedTrackId = firstTrack.id; state.selectedItemId = firstTrack.items[0].id;
			}
			bindEvents();
			updateProjectHeading();
			renderTimeline();
			renderInspector();
			drawPreview();
			persistNow();
			if (isPlaying || shouldAnimatePreview()) schedulePreviewFrame();
			waitForStoredAssets();
		}

		api.addVisualTrack = function () { return state ? addVisualTrack() : null; };
		api.addTextElement = function (text) {
			if (!state) return null;
			var item = addVisualElementFromAction("text");
			if (item && text != null) { item.text = String(text); renderInspector(); drawPreview(); scheduleSave(); }
			return item;
		};
		api.addGraphicElement = function () { return state ? addVisualElementFromAction("graphic") : null; };
		api.setItemTiming = setItemTiming;
		api.save = persistNow;
		api.addMediaFiles = addMediaFiles;
		api.addAudioFile = addAudioFile;
		api.booted = true;

		boot();
	})();
`;
