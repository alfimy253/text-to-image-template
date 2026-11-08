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
		/*
		 * Every seconds slider in the selected-element sections stops at 80 s.
		 * Shorter values are still allowed (the project duration caps the whole
		 * timeline), this is only the upper bound of the range control.
		 */
		var MAX_TIMING_SEC = 80;
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
		/*
		 * Session 331: the layer used to be announced as "Scene's media" in the
		 * track header. The copy is now the plain "Scene Media" — the same words
		 * the dock and the ＋ Add Clips status line use for this lane.
		 */
		var MEDIA_TRACK_LABEL = "Scene Media";
		var MEDIA_TRACK_NAME = "BACKGROUND";
		/*
		 * Every timeline that has no text and no graphic of its own starts with
		 * one dummy text clip at 0:00 so the text lane is never an empty promise.
		 * The clip is a normal editable text clip: typing over it, moving it or
		 * deleting it is allowed, and it is never re-created once the project
		 * already has any text/graphic clip.
		 */
		var DUMMY_TEXT = "Your text here";
		var DUMMY_TEXT_MAX_SEC = 6;
		/*
		 * Burned-in script subtitles. The cue list comes from the Quick Batch
		 * row (state.subtitles) and is painted with the same typography the
		 * Quick Batch preview/export uses: white Bookman on a translucent
		 * black box, one third of the frame up from the bottom.
		 */
		var SUBTITLE_FONT_SIZE = 22;
		var SUBTITLE_FONT_STACK = "'Bookman Old Style', 'Bookman', 'URW Bookman L', Georgia, serif";
		/*
		 * Template-modal image effects for the Quick Batch row style that the
		 * Edit handoff passes in as project data.
		 *
		 * The "Add video from template" modal paints these on the canvas
		 * (template-scene-editor.ts reelDrawBackground), so the timeline copies
		 * those painter blocks instead of inventing CSS:
		 *
		 *   duotone  "Duotone gradient": the moving two-colour double gradient
		 *            (#ff6b35 -> #2ec4b6) laid over the image or video frame
		 *   neon     the "neon" style's pink radial glow
		 *   vhs      the "glitch" style / "Scanlines" effect: rolling black bars
		 *
		 * Row styles resolve to:
		 *   Cinematic Film -> duotone (double gradient on video and image)
		 *   Neon Night     -> neon + vhs
		 *   Retro Poster   -> vhs
		 *   everything else -> the shared CSS filter only
		 *
		 * window.__videoStyleEffects() from app-js.ts is the shared authority;
		 * the local map keeps this bundle standalone if it is ever loaded on
		 * its own (the same guard style window.__videoStyleFilter uses).
		 */
		var STYLE_EFFECT_NAMES = ["duotone", "neon", "vhs"];
		var STYLE_EFFECT_LABELS = { duotone: "double gradient", neon: "neon glow", vhs: "VHS scanlines" };
		var STYLE_EFFECT_FALLBACK = {
			"Cinematic Film": ["duotone"],
			"Neon Night": ["neon", "vhs"],
			"Retro Poster": ["vhs"]
		};

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
		var canvasDrag = null;
		var suppressClick = false;
		var pendingAudioTrackId = "";
		var selectedSceneId = "";
		var recorder = null;
		var isExporting = false;
		var exportAudioContext = null;
		var audioSources = Object.create(null);
		/*
		 * Undo / redo history
		 * -------------------
		 * Two stacks of JSON snapshots of the editable project data only
		 * (durationSec + scenes + tracks). Selection, playhead and zoom are
		 * deliberately excluded, so merely clicking a clip never creates a
		 * history entry. A snapshot is recorded inside persistNow(), which is
		 * the single funnel every mutation already ends in (directly, or via
		 * the debounced scheduleSave), so one drag or one slider sweep is one
		 * undo step instead of dozens.
		 */
		var historyUndo = [];
		var historyRedo = [];
		var HISTORY_LIMIT = 80;
		var lastSnapshot = "";
		var suppressHistory = false;
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
			var msg = String(text || "");
			if (el) {
				el.textContent = msg;
				el.setAttribute("data-state", isError ? "error" : "ok");
				if (el.parentElement && el.parentElement.classList && el.parentElement.classList.contains("te-dock-footer")) {
					el.parentElement.hidden = !msg;
				}
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

		/*
		 * Effect resolution: window.__videoStyleEffects() (app-js.ts) is the
		 * shared mapping; STYLE_EFFECT_FALLBACK keeps this bundle working when
		 * it is loaded without it. A scene's own effect list always wins, so a
		 * caller can hand over per-scene treatments explicitly.
		 */
		function styleEffectsFor(style) {
			if (typeof window.__videoStyleEffects === "function") {
				try {
					var shared = window.__videoStyleEffects(style);
					if (Array.isArray(shared)) return shared.filter(function (name) { return STYLE_EFFECT_NAMES.indexOf(name) !== -1; });
				} catch (error) {}
			}
			var direct = STYLE_EFFECT_FALLBACK[String(style || "")];
			if (direct) return direct.slice();
			var text = String(style || "");
			var list = [];
			if (/duotone|cinematic/i.test(text)) list.push("duotone");
			if (/neon/i.test(text)) list.push("neon");
			if (/neon|retro|vhs|glitch/i.test(text)) list.push("vhs");
			return list;
		}
		function normalizeEffects(list, style) {
			if (!Array.isArray(list) || !list.length) return styleEffectsFor(style);
			var names = list.map(function (name) { return String(name || "").toLowerCase(); }).filter(function (name) { return STYLE_EFFECT_NAMES.indexOf(name) !== -1; });
			return names.length ? Array.from(new Set(names)) : styleEffectsFor(style);
		}
		function effectLabel(effects) {
			return (Array.isArray(effects) ? effects : [])
				.map(function (name) { return STYLE_EFFECT_LABELS[name] || String(name || ""); })
				.filter(Boolean)
				.join(" + ");
		}

		/*
		 * The project detail is the row's identity plus its visual treatment.
		 * The Quick Batch Edit handoff now sends one (payload.projectDetail), and
		 * the timeline keeps it in state so the heading can name the style and
		 * the effects instead of guessing them from the canvas.
		 */
		function normalizeProjectDetail(raw, fallback, scenes) {
			var source = raw && typeof raw === "object" ? raw : {};
			var style = String(source.style || fallback.style || "Cinematic Film");
			var effects = normalizeEffects(source.effects, style);
			var detailScenes = scenes.map(function (scene) {
				return {
					id: String(scene && scene.id || ""),
					index: Number(scene && scene.index) || 0,
					mediaType: String(scene && scene.mediaType || "image"),
					startSec: number(scene && scene.startSec, 0),
					durationSec: number(scene && scene.durationSec, 0),
					effects: normalizeEffects(scene && scene.effects, style)
				};
			});
			return {
				id: String(source.id || fallback.id || ""),
				rowId: String(source.rowId || source.id || fallback.rowId || ""),
				vid: String(source.vid || fallback.vid || ""),
				title: String(source.title || fallback.title || "").slice(0, 70),
				topic: String(source.topic || fallback.topic || "").slice(0, 160),
				sourcePageId: String(source.sourcePageId || fallback.sourcePageId || ""),
				targetPageId: String(source.targetPageId || fallback.targetPageId || ""),
				style: style,
				effects: effects,
				effectLabel: effectLabel(effects),
				resolution: String(source.resolution || ""),
				orientation: String(source.orientation || ""),
				quality: String(source.quality || ""),
				frame: source.frame || fallback.frame || { width: 1280, height: 720, orientation: "landscape" },
				sceneCount: detailScenes.length,
				scenes: detailScenes
			};
		}

		/*
		 * The dummy text clip lives in the first text/graphics lane at exactly
		 * 0:00. Its duration is short on purpose: a sentence long enough to read
		 * is the user's job, an empty lane is not.
		 */
		function dummyTextItem(scenes) {
			var firstScene = scenes && scenes[0] ? scenes[0] : null;
			var duration = Math.min(DUMMY_TEXT_MAX_SEC, Math.max(MIN_CLIP_SEC, number(firstScene && firstScene.durationSec, DUMMY_TEXT_MAX_SEC)));
			return {
				id: "dummy-text-1",
				kind: "text",
				type: "text",
				name: "Text",
				label: "Text",
				text: DUMMY_TEXT,
				sceneId: firstScene ? String(firstScene.id || "") : "",
				startSec: 0,
				durationSec: duration,
				x: 50,
				y: 78,
				fontSize: 28,
				color: "#ffffff",
				font: "sans",
				align: "center",
				visible: true,
				dummy: true
			};
		}

		function defaultTimeline() {
			var duration = number(transition && transition.timelineState && transition.timelineState.durationSec, 60);
			var scenes = [];
			var mediaItems = [];
			var span = Math.max(0.25, duration / 12);
			var videoStyle = "Cinematic Film";
			var styleEffects = styleEffectsFor(videoStyle);
			for (var i = 0; i < 12; i++) {
				var sceneId = "scene-" + (i + 1);
				var start = i * span;
				scenes.push({ id: sceneId, index: i, name: "Scene " + (i + 1), startSec: start, durationSec: span, mediaType: "image", mediaAssetId: "", mediaName: "", mediaSource: "pending", prompt: "", effects: styleEffects.slice(), videoStyle: videoStyle, elements: [] });
				mediaItems.push({ id: "media-" + (i + 1), kind: "media", sceneId: sceneId, assetId: "", label: "Scene " + (i + 1) + " · media pending", mediaType: "image", startSec: start, durationSec: span, trimStartSec: 0, fit: "cover", visible: true });
			}
			return {
				version: 3,
				projectId: pageId,
				updatedAt: Date.now(),
				durationSec: duration,
				frame: { width: 1280, height: 720, orientation: "landscape" },
				videoStyle: videoStyle,
				videoStyleEffects: styleEffects.slice(),
				projectDetail: null,
				subtitles: [],
				playheadSec: 0,
				soundExpanded: false,
				/*
				 * Session 331: the TEXT & GRAPHICS group collapses like the
				 * Soundtrack group does. It opens expanded so a fresh timeline
				 * still shows every visual lane.
				 */
				visualsExpanded: true,
				zoom: 1,
				scenes: scenes,
				tracks: [
					{ id: "voiceover", kind: "audio", label: "Voiceover", expanded: true, items: [] },
					{ id: "sound-fx", kind: "audio", label: "Sound effects", expanded: true, items: [] },
					{ id: "background-music", kind: "audio", label: "Background music", expanded: true, items: [] },
					{ id: MEDIA_TRACK_ID, kind: "media", label: MEDIA_TRACK_LABEL, expanded: true, items: mediaItems, layer: 0 },
					{ id: "visual-1", kind: "visual", label: "Text & graphics 1", expanded: true, items: [dummyTextItem(scenes)] }
				],
				selectedTrackId: MEDIA_TRACK_ID,
				selectedItemId: "media-1"
			};
		}

		function isCaptionItem(item) {
			if (!item) return false;
			var id = String(item.id || "");
			var name = String(item.name || item.label || "");
			return /-caption-\\d+$/.test(id) || /^Caption\\b/.test(name);
		}

		/*
		 * Subtitle cues are plain {text, startMs, endMs} records — the same
		 * shape Quick Batch's drawSubtitles() consumes. They are normalized on
		 * load but are NEVER turned into editable timeline clips: the dock
		 * shows them on a hidden read-only layer because their timing comes
		 * from the music, not from the user.
		 */
		function normalizeSubtitles(list) {
			if (!Array.isArray(list)) return [];
			return list.slice(0, 400).map(function (cue) {
				if (!cue) return null;
				var startMs = Math.max(0, number(cue.startMs, 0));
				var endMs = Math.max(startMs + 1, number(cue.endMs, startMs + 1));
				var text = String(cue.text || "").slice(0, 600);
				return text ? { text: text, startMs: startMs, endMs: endMs } : null;
			}).filter(Boolean);
		}
		function subtitleClipFor(cue, index) {
			var startSec = Math.max(0, number(cue.startMs, 0) / 1000);
			var durationSec = Math.max(MIN_CLIP_SEC, (number(cue.endMs, 0) - number(cue.startMs, 0)) / 1000);
			var text = String(cue.text || "");
			return {
				id: "subtitle-" + (index + 1),
				kind: "text",
				type: "text",
				name: text || ("Subtitle " + (index + 1)),
				label: text || ("Subtitle " + (index + 1)),
				text: text,
				startSec: startSec,
				durationSec: durationSec,
				readOnly: true
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
			/*
			 * A text or graphic added FROM a background clip stores that clip's
			 * id here. The timing of a child is bound to the background clip
			 * only (see bindChildTimings / clampChildToParent), which is what
			 * the left child panel and the duplicate rule both rely on.
			 */
			out.parentId = String(out.parentId || "");
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
			/*
			 * Captions are no longer timeline clips. Subtitle cues that were
			 * carried in by an older handoff (id "<scene>-caption-<n>" or a
			 * "Caption <n>" label) are dropped here so the text lane only ever
			 * holds text and graphics the user asked for.
			 */
			visualLayers.forEach(function (layer) {
				layer.items = layer.items.filter(function (item) { return !isCaptionItem(item); });
			});
			tracks = tracks.concat(visualLayers);
			/*
			 * Saved child elements are re-bound to their background clip on
			 * every load: a missing parent drops the link, a valid one clamps
			 * the child back inside the clip's own window.
			 */
			bindChildTimings(tracks);
			/*
			 * The row's video style arrives as project data: the handoff puts it
			 * in basicSettings.style, in projectDetail.style and in
			 * timelineState.videoStyle. Any of the three is enough, and a legacy
			 * project without one falls back to the studio default.
			 */
			var videoStyle = String(
				base.videoStyle ||
				transition && transition.projectDetail && transition.projectDetail.style ||
				transition && transition.basicSettings && transition.basicSettings.style ||
				"Cinematic Film"
			);
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
				/* Every scene keeps the resolved template-modal effects of the row style. */
				copy.videoStyle = String(copy.videoStyle || videoStyle);
				copy.effects = normalizeEffects(copy.effects, copy.videoStyle);
				copy.elements = Array.isArray(copy.elements) ? copy.elements.map(function (item) { return normalizeItem(item, { kind: "visual" }); }) : [];
				return copy;
			});
			if (!scenes.length) scenes = defaultTimeline().scenes;
			/*
			 * A timeline with no text and no graphic of its own opens with the
			 * dummy text at 0:00 in the first text/graphics lane.
			 */
			var hasVisualClip = visualLayers.some(function (layer) {
				return (layer.items || []).some(function (item) { return item.kind === "text" || item.kind === "graphic"; });
			});
			if (!hasVisualClip) {
				var firstVisualLayer = visualLayers[0];
				if (firstVisualLayer) firstVisualLayer.items.push(dummyTextItem(scenes));
			}
			var duration = clamp(base.durationSec, 1, MAX_DURATION_SEC);
			var frame = base.frame || transition && transition.timelineState && transition.timelineState.frame || { width: 1280, height: 720, orientation: "landscape" };
			var result = {
				version: 3,
				projectId: pageId,
				updatedAt: number(base.updatedAt, Date.now()),
				sourcePageId: String(base.sourcePageId || transition && transition.sourcePageId || ""),
				sourceRowId: String(base.sourceRowId || transition && transition.basicSettings && transition.basicSettings.id || ""),
				frame: frame,
				videoStyle: videoStyle,
				videoStyleEffects: normalizeEffects(base.videoStyleEffects, videoStyle),
				projectDetail: normalizeProjectDetail(
					base.projectDetail || transition && transition.projectDetail,
					{
						style: videoStyle,
						frame: frame,
						id: base.sourceRowId || transition && transition.basicSettings && transition.basicSettings.id,
						rowId: base.sourceRowId || transition && transition.basicSettings && transition.basicSettings.id,
						vid: transition && transition.basicSettings && transition.basicSettings.vid,
						title: transition && transition.basicSettings && transition.basicSettings.title,
						topic: transition && transition.basicSettings && transition.basicSettings.topic,
						sourcePageId: base.sourcePageId || transition && transition.sourcePageId,
						targetPageId: transition && transition.targetPageId
					},
					scenes
				),
				subtitles: normalizeSubtitles(base.subtitles && base.subtitles.length
					? base.subtitles
					: transition && transition.timelineState && transition.timelineState.subtitles),
				durationSec: duration,
				playheadSec: clamp(base.playheadSec, 0, duration),
				soundExpanded: number(base.version, 1) >= 2 && base.soundExpanded === true,
				/*
				 * The visual group is expanded unless a saved project explicitly
				 * collapsed it — unlike Soundtrack, which starts folded so the
				 * lanes do not crowd a fresh timeline.
				 */
				visualsExpanded: base.visualsExpanded !== false,
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
		/*
		 * Child text/graphics
		 * -------------------
		 * A text or graphic that was added FROM a background clip carries the
		 * clip id in parentId. Its timing depends on that background clip
		 * alone: the child can only live inside the background's own
		 * [start, end] window, and when the background clip moves or is
		 * resized the child is clamped back inside it. Nothing else owns the
		 * relation, so the dock, the inspector, the left child panel and the
		 * duplicate rule all read the same two helpers below.
		 */
		function childWindow(parentItem) {
			var start = number(parentItem && parentItem.startSec, 0);
			var end = start + Math.max(MIN_CLIP_SEC, number(parentItem && parentItem.durationSec, MIN_CLIP_SEC));
			return { start: start, end: end };
		}
		function childItemsFor(parentItem) {
			var list = [];
			if (!parentItem) return list;
			visualTracks().forEach(function (track) {
				track.items.forEach(function (item) {
					if (item && item.parentId && String(item.parentId) === String(parentItem.id)) list.push({ track: track, item: item });
				});
			});
			return list.sort(function (a, b) { return a.item.startSec - b.item.startSec; });
		}
		/*
		 * The background clip the selection belongs to: the selected background
		 * itself, or the background of the selected child. Null for every other
		 * selection, and that is what gives the preview its 100 % width back.
		 */
		function backgroundContext() {
			var entry = selectedEntry();
			var item = entry && entry.item;
			if (!item) return null;
			if (item.kind === "media") return item;
			if (item.parentId) {
				var parent = findItem(item.parentId);
				if (parent && parent.item && parent.item.kind === "media") return parent.item;
			}
			return null;
		}
		function clampChildToParent(item) {
			if (!item || !item.parentId) return;
			var found = findItem(item.parentId);
			var parent = found && found.item;
			if (!parent || parent.kind !== "media") { item.parentId = ""; return; }
			var limits = childWindow(parent);
			item.startSec = clamp(item.startSec, limits.start, Math.max(limits.start, limits.end - MIN_CLIP_SEC));
			item.durationSec = clamp(item.durationSec, MIN_CLIP_SEC, Math.max(MIN_CLIP_SEC, limits.end - item.startSec));
			item.sceneId = String(parent.sceneId || item.sceneId || "");
		}
		function syncChildrenToParent(parentItem) {
			if (!parentItem || parentItem.kind !== "media") return;
			visualTracks().forEach(function (track) {
				track.items.forEach(function (item) {
					if (item && item.parentId && String(item.parentId) === String(parentItem.id)) clampChildToParent(item);
				});
			});
		}
		function bindChildTimings(tracks) {
			var media = (tracks || []).filter(function (track) { return track && track.kind === "media"; })[0] || null;
			if (!media) return;
			var parents = Object.create(null);
			(media.items || []).forEach(function (item) { parents[String(item.id)] = item; });
			(tracks || []).forEach(function (track) {
				if (!track || track.kind !== "visual") return;
				(track.items || []).forEach(function (item) {
					if (!item || !item.parentId) return;
					var parent = parents[String(item.parentId)];
					if (!parent) { item.parentId = ""; return; }
					var end = parent.startSec + parent.durationSec;
					item.sceneId = String(parent.sceneId || item.sceneId || "");
					item.startSec = clamp(item.startSec, parent.startSec, Math.max(parent.startSec, end - MIN_CLIP_SEC));
					item.durationSec = clamp(item.durationSec, MIN_CLIP_SEC, Math.max(MIN_CLIP_SEC, end - item.startSec));
				});
			});
		}
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

		/*
		 * History helpers
		 * ---------------
		 * snapshotProject() serialises only what the user edits. trackExpanded
		 * and the audio mix are part of tracks, so they are covered too.
		 */
		function snapshotProject() {
			if (!state) return "";
			try {
				return JSON.stringify({ durationSec: state.durationSec, scenes: state.scenes, tracks: state.tracks });
			} catch (error) { return ""; }
		}
		function updateHistoryButtons() {
			var undo = document.getElementById("timeline-undo");
			var redo = document.getElementById("timeline-redo");
			if (undo) {
				undo.disabled = !historyUndo.length;
				undo.setAttribute("aria-disabled", historyUndo.length ? "false" : "true");
				undo.title = historyUndo.length ? "Undo the last timeline edit (Ctrl+Z)" : "Nothing to undo";
			}
			if (redo) {
				redo.disabled = !historyRedo.length;
				redo.setAttribute("aria-disabled", historyRedo.length ? "false" : "true");
				redo.title = historyRedo.length ? "Redo the last undone edit (Ctrl+Shift+Z)" : "Nothing to redo";
			}
			window.__TIMELINE_EDITOR_HISTORY__ = { undo: historyUndo.length, redo: historyRedo.length };
		}
		function resetHistory() {
			historyUndo = [];
			historyRedo = [];
			lastSnapshot = snapshotProject();
			updateHistoryButtons();
		}
		/* Called from persistNow(): pushes the snapshot BEFORE the last edit. */
		function recordHistoryEntry() {
			var next = snapshotProject();
			if (!next) return;
			if (!lastSnapshot) { lastSnapshot = next; return; }
			if (next === lastSnapshot) return;
			historyUndo.push(lastSnapshot);
			if (historyUndo.length > HISTORY_LIMIT) historyUndo.shift();
			historyRedo = [];
			lastSnapshot = next;
			updateHistoryButtons();
		}
		function restoreSnapshot(json) {
			var parsed = null;
			try { parsed = JSON.parse(json || "null"); } catch (error) { parsed = null; }
			if (!parsed || !Array.isArray(parsed.tracks)) return false;
			var selectedTrack = String(state && state.selectedTrackId || "");
			var selectedItem = String(state && state.selectedItemId || "");
			var playhead = number(state && state.playheadSec, 0);
			state.durationSec = clamp(parsed.durationSec, 1, MAX_DURATION_SEC);
			state.scenes = parsed.scenes || state.scenes;
			state.tracks = parsed.tracks;
			state.playheadSec = clamp(playhead, 0, state.durationSec);
			state.selectedTrackId = findTrack(selectedTrack) ? selectedTrack : (mediaTrack() ? mediaTrack().id : selectedTrack);
			state.selectedItemId = findItem(selectedItem) ? selectedItem : "";
			renderTimeline();
			renderInspector();
			drawPreview();
			updateReadout();
			return true;
		}
		function applyHistorySnapshot(json) {
			suppressHistory = true;
			try {
				if (!restoreSnapshot(json)) return false;
				/* Persist immediately so the restored project is what a reload finds. */
				persistNow();
				lastSnapshot = snapshotProject();
				return true;
			} finally { suppressHistory = false; }
		}
		function undo() {
			if (!historyUndo.length) { setStatus("Nothing to undo yet.", true); return false; }
			var current = snapshotProject();
			var previous = historyUndo.pop();
			historyRedo.push(current);
			applyHistorySnapshot(previous);
			updateHistoryButtons();
			setSaveStatus("Undo · " + historyUndo.length + " step" + (historyUndo.length === 1 ? "" : "s") + " left", false);
			return true;
		}
		function redo() {
			if (!historyRedo.length) { setStatus("Nothing to redo yet.", true); return false; }
			var current = snapshotProject();
			var next = historyRedo.pop();
			historyUndo.push(current);
			applyHistorySnapshot(next);
			updateHistoryButtons();
			setSaveStatus("Redo · " + historyRedo.length + " step" + (historyRedo.length === 1 ? "" : "s") + " left", false);
			return true;
		}

		function persistNow() {
			if (!state) return false;
			syncScenesFromTracks();
			state.durationSec = Math.max(state.durationSec, maxTimelineEnd());
			state.updatedAt = Date.now();
			if (!suppressHistory) recordHistoryEntry();
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
			return null;
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

		/*
		 * Neighbour-safe box.
		 * -------------------
		 * Clips inside one track must never paint over each other. A background
		 * scene box is drawn from its own start for its own duration, but a
		 * saved or dragged clip can still run past the next clip's start (the
		 * scene ripple only moves the clips that follow, never the dragged one).
		 * clampClipBox() therefore shortens the DRAWN box to the gap that is
		 * really left before the next clip, so the lane shows butt-joined scene
		 * boxes instead of overlapping ones. The model is untouched: timing is
		 * still edited through the inspector / dock drag, which clamps for real.
		 */
		function clampClipBox(track, item) {
			var start = Math.max(0, number(item.startSec, 0));
			var duration = Math.max(MIN_CLIP_SEC, number(item.durationSec, MIN_CLIP_SEC));
			var items = track && track.items ? track.items : [];
			items.forEach(function (other) {
				if (!other || other === item) return;
				var otherStart = number(other.startSec, 0);
				if (otherStart <= start + 0.001) return;
				if (otherStart - start < duration) duration = Math.max(0, otherStart - start);
			});
			return { startSec: start, durationSec: duration };
		}
		function htmlTrackItem(track, item, pixelsPerSecond) {
			var box = clampClipBox(track, item);
			var left = Math.max(0, box.startSec * pixelsPerSecond);
			var width = Math.max(12, box.durationSec * pixelsPerSecond);
			var selected = String(item.id) === String(state.selectedItemId) ? " selected" : "";
			var empty = item.kind === "media" && !item.assetId ? " placeholder" : "";
			var name = String(item.label || item.name || item.kind);
			var short = name.length > 38 ? name.slice(0, 35) + "…" : name;
			return '<button type="button" class="te-clip ' + esc(item.kind) + selected + empty + '" data-clip-id="' + esc(item.id) + '" data-track-id="' + esc(track.id) + '" style="left:' + left.toFixed(1) + 'px;width:' + width.toFixed(1) + 'px" title="' + esc(name + " · " + formatTime(item.startSec) + " · " + formatTime(item.durationSec)) + '">' +
				'<span class="te-clip-label">' + esc(short) + '</span><span class="te-clip-time">' + esc(formatTime(item.durationSec)) + '</span><span class="te-clip-resize" data-resize-id="' + esc(item.id) + '" title="Drag to extend or shorten"></span></button>';
		}
		function playheadHtml(leftPx, withHandle) {
			if (withHandle) {
				return '<span class="te-playhead te-ruler-playhead" data-playhead style="left:' + leftPx + 'px"><span class="te-playhead-handle" data-playhead-handle title="Drag seeker handle"></span></span>';
			}
			return '<span class="te-playhead" data-playhead style="left:' + leftPx + 'px"></span>';
		}
		function renderTimeline() {
			if (!state) return;
			syncScenesFromTracks();
			var grid = document.getElementById("timeline-track-grid");
			if (!grid) return;
			var scrollNode = document.getElementById("timeline-scroll");
			grid.setAttribute("data-scrolled", scrollNode && scrollNode.scrollLeft > 2 ? "1" : "0");
			var zoom = clamp(state.zoom, 0.5, 2);
			var pps = Math.max(14, Math.min(48, 1080 / Math.max(20, state.durationSec))) * zoom;
			var width = Math.max(720, Math.ceil(state.durationSec * pps));
			var playheadLeft = (state.playheadSec * pps).toFixed(1);
				grid.style.setProperty("--te-content-width", width + "px");
				grid.style.gridTemplateColumns = "156px var(--te-content-width)";
			var interval = state.durationSec <= 30 ? 2 : state.durationSec <= 120 ? 5 : state.durationSec <= 360 ? 10 : state.durationSec <= 900 ? 30 : 60;
			/*
			 * The corner above the scroll handle is intentionally empty: the lane
			 * below it is a drag-to-pan handle, and the word "SCROLL" was removed
			 * from the UI on request.
			 */
			var html = '<div class="te-grid-corner te-grid-corner-scroll" aria-hidden="true"></div><div class="te-scroll-lane" data-scroll-lane style="width:' + width + 'px"></div><div class="te-grid-corner">TRACKS</div><div class="te-ruler" style="width:' + width + 'px">';
			for (var tick = 0; tick <= state.durationSec; tick += interval) {
				html += '<span class="te-ruler-tick" style="left:' + (tick * pps).toFixed(1) + 'px"><i></i>' + esc(formatTime(tick)) + '</span>';
			}
			html += playheadHtml(playheadLeft, true) + '</div>';
			/*
			 * The dock mirrors the paint stack top-down: text and graphics lanes come
			 * first, and the single background layer sits pinned UNDER them. The dock is
			 * flipped visually (column-reverse in CSS below the first child) - the lane
			 * order here is the reading order, the background lane is always last in the
			 * DOM and always the lowest layer on the canvas.
			 */
			var visuals = visualTracks();
			/*
			 * The dock reads top-down like the canvas: the LAST text/graphics
			 * track in state order is the HIGHEST layer (it paints last in
			 * drawPreview), so it is listed first here. A new ＋ Text or
			 * ＋ Graphic click appends a lane, and that lane therefore lands on
			 * top of the existing ones.
			 */
			var dockVisuals = visuals.slice().reverse();
			/*
			 * The lane count readout ("n / 4 lanes · above the background") was
			 * removed on request; the count was also duplicated by the dock's
			 * lane button that has since been dropped.
			 */
			/*
			 * The header is a real collapse toggle now - the same
			 * .te-group-toggle button (chevron + label + <small> count) the
			 * Soundtrack group uses, so the two group heads share one font,
			 * size and behaviour. Clicking it folds every visual lane away;
			 * the ＋ Text / ＋ Graphic buttons stay in the filler cell so a
			 * folded group can still receive a new element.
			 */
			html += '<div class="te-group-title te-group-visuals"><button type="button" class="te-group-toggle" data-timeline-action="toggle-visuals" aria-expanded="' + (state.visualsExpanded ? "true" : "false") + '"><span class="te-chevron">' + (state.visualsExpanded ? "▾" : "▸") + '</span> TEXT &amp; GRAPHICS <small>' + visuals.length + (visuals.length === 1 ? " track" : " tracks") + '</small></button></div>';
			/*
			 * The two add buttons live in this filler cell but are pinned with
			 * position: sticky at the left edge of the tracks area, on the
			 * front-most layer of the dock (z-index: 30), so they keep their place
			 * next to the lane labels instead of scrolling away with the tracks -
			 * and they are never painted under a lane, a clip or the playhead.
			 */
			html += '<div class="te-group-fill te-visual-actions"><span class="te-visual-actions-sticky"><button type="button" class="te-add-inline" data-timeline-action="add-text">＋ Text</button><button type="button" class="te-add-inline" data-timeline-action="add-graphic">＋ Graphic</button></span>' + playheadHtml(playheadLeft, false) + '</div>';
			if (state.visualsExpanded) {
				dockVisuals.forEach(function (track) {
					/*
					 * Every visual lane also carries the per-lane chevron the
					 * audio lanes use, so a single "Text & graphics 2" lane can
					 * be folded without touching its siblings.
					 */
					var laneCollapsed = track.expanded === false;
					html += '<div class="te-track-label' + (String(state.selectedTrackId) === String(track.id) ? ' selected' : '') + '"><button type="button" class="te-track-select" data-track-select="' + esc(track.id) + '">' + esc(track.label) + '<small>' + (track.items.length ? track.items.length + (track.items.length === 1 ? " clip" : " clips") : "empty") + '</small></button><button type="button" class="te-track-toggle" data-track-toggle="' + esc(track.id) + '" aria-expanded="' + (!laneCollapsed ? "true" : "false") + '" title="Expand or collapse ' + esc(track.label) + '">' + (laneCollapsed ? "▸" : "▾") + '</button></div>';
					html += '<div class="te-lane te-visual-lane' + (laneCollapsed ? ' collapsed' : '') + '" data-lane-track="' + esc(track.id) + '" style="width:' + width + 'px">';
					if (!laneCollapsed) {
						if (!track.items.length) html += '<span class="te-lane-empty-static">Use + Text or + Graphic to add an element</span>';
						track.items.forEach(function (item) { html += htmlTrackItem(track, item, pps); });
					}
					html += playheadHtml(playheadLeft, false) + '</div>';
				});
			}
			/*
			 * Subtitle layer. The row's cues are present in the tracks area so
			 * the layer exists as a real row, but every row ships with a
			 * .te-subtitle-* class that CSS hides (display:none) and carries
			 * aria-hidden. The cues follow the music, so they are read-only:
			 * these clips are generated here and never stored in state.tracks,
			 * which means they can never be selected, dragged, resized or
			 * deleted from the dock.
			 */
			var subtitleCues = Array.isArray(state.subtitles) ? state.subtitles : [];
			if (subtitleCues.length) {
				html += '<div class="te-group-title te-subtitle-group" aria-hidden="true"><span class="te-group-label">SUBTITLES <small>locked to the music · hidden, not editable</small></span></div>';
				html += '<div class="te-group-fill te-subtitle-fill" aria-hidden="true">' + playheadHtml(playheadLeft, false) + '</div>';
				html += '<div class="te-track-label te-subtitle-label" aria-hidden="true"><span class="te-track-select">Voiceover subtitles<small>' + subtitleCues.length + (subtitleCues.length === 1 ? " cue" : " cues") + ' · read-only</small></span></div>';
				html += '<div class="te-subtitle-lane" data-lane-track="subtitles" aria-hidden="true" style="width:' + width + 'px">';
				subtitleCues.forEach(function (cue, index) {
					html += htmlTrackItem({ id: "subtitles", kind: "text" }, subtitleClipFor(cue, index), pps);
				});
				html += playheadHtml(playheadLeft, false) + '</div>';
			}
			/*
			 * The background header used to carry a "pinned lowest · Pixabay,
			 * GIF, image or MP4" caption, and Session 331 §21 parked the two add
			 * buttons in that same 156 px label cell (which forced them onto a
			 * second line under the BACKGROUND LAYER words). Session 332 moves
			 * them OUT of the label cell and into the layer row on the right of
			 * the BACKGROUND LAYER text, copying the ＋ Text / ＋ Graphic
			 * positioning exactly: one .te-background-actions-sticky wrapper,
			 * position: sticky at the left edge of the tracks area (156 px, 132 px
			 * under 560 px), z-index 30, and both buttons on ONE line that never
			 * wraps and never scrolls away with the pan.
			 * ＋ Add media keeps the hidden file input; ＋ Add Clips opens the
			 * studio's "Add video from template" composer modal.
			 */
			html += '<div class="te-group-title te-group-background"><span class="te-group-label">' + esc(MEDIA_TRACK_NAME) + ' LAYER</span></div>';
			html += '<div class="te-group-fill te-group-fill-background te-background-actions"><span class="te-background-actions-sticky"><button type="button" class="te-add-inline" data-timeline-action="add-media">＋ Add media</button><button type="button" class="te-add-inline" data-timeline-action="add-clips">＋ Add Clips</button></span>' + playheadHtml(playheadLeft, false) + '</div>';
			var backgroundTrack = mediaTrack();
			html += '<div class="te-track-label te-track-background' + (String(state.selectedTrackId) === MEDIA_TRACK_ID ? ' selected' : '') + '"><button type="button" class="te-track-select" data-track-select="' + esc(MEDIA_TRACK_ID) + '">' + esc(backgroundTrack && backgroundTrack.label || MEDIA_TRACK_LABEL) + '<small><span class="te-track-badge">BG</span> ' + (backgroundTrack ? backgroundTrack.items.length + " scenes" : "empty") + '</small></button></div>';
			html += '<div class="te-lane te-media-lane te-background-lane" data-lane-track="' + esc(MEDIA_TRACK_ID) + '" style="width:' + width + 'px">';
			if (backgroundTrack) backgroundTrack.items.forEach(function (item) { html += htmlTrackItem(backgroundTrack, item, pps); });
			html += playheadHtml(playheadLeft, false) + '</div>';
			html += '<div class="te-group-title"><button type="button" class="te-group-toggle" data-timeline-action="toggle-sound" aria-expanded="' + (state.soundExpanded ? "true" : "false") + '"><span class="te-chevron">' + (state.soundExpanded ? "▾" : "▸") + '</span> Soundtrack <small>3 tracks</small></button></div><div class="te-group-fill">' + playheadHtml(playheadLeft, false) + '</div>';
			var soundTracks = state.tracks.filter(function (track) { return track.kind === "audio"; });
			if (state.soundExpanded) {
				soundTracks.forEach(function (track) {
					var collapsed = track.expanded === false;
					html += '<div class="te-track-label' + (String(state.selectedTrackId) === String(track.id) ? ' selected' : '') + '"><button type="button" class="te-track-select" data-track-select="' + esc(track.id) + '">' + esc(track.label) + '<small>' + (track.items.length ? track.items.length + (track.items.length === 1 ? " clip" : " clips") : "empty") + '</small></button><button type="button" class="te-track-toggle" data-track-toggle="' + esc(track.id) + '" aria-expanded="' + (!collapsed ? "true" : "false") + '" title="Expand or collapse ' + esc(track.label) + '">' + (collapsed ? "▸" : "▾") + '</button></div>';
					html += '<div class="te-lane te-audio-lane' + (collapsed ? ' collapsed' : '') + '" data-lane-track="' + esc(track.id) + '" style="width:' + width + 'px">';
					if (!collapsed) {
						if (!track.items.length) html += '<button type="button" class="te-lane-empty" data-track-select="' + esc(track.id) + '">＋ Add ' + esc(track.label.toLowerCase()) + '</button>';
						track.items.forEach(function (item) { html += htmlTrackItem(track, item, pps); });
					}
					html += playheadHtml(playheadLeft, false);
					html += '</div>';
				});
			}
			/*
			 * Bottom-most row of the tracks: an EMPTY layer that works as the
			 * dock's horizontal scroll handle. It looks like any other lane
			 * (same label column, same lane grid) but it holds no clips and no
			 * playhead, and dragging it pans #timeline-scroll exactly like the
			 * SCROLL lane pinned at the top. It is deliberately NOT a .te-lane
			 * and carries no data-lane-track, so it can never be selected,
			 * seeked on, or confused with a real track.
			 */
			html += '<div class="te-track-label te-track-scroll" aria-label="Scroll layer"></div>';
			html += '<div class="te-scroll-layer" data-scroll-lane data-scroll-layer="bottom" style="width:' + width + 'px" title="Empty layer: drag left or right to scroll the tracks"><span class="te-scroll-hint">Empty scroll layer · drag horizontally to pan the tracks</span></div>';
			grid.innerHTML = html;
			var duration = document.getElementById("timeline-duration-label");
			if (duration) duration.textContent = formatTime(state.durationSec);
			var zoomInput = document.getElementById("timeline-zoom");
			var zoomValue = document.getElementById("timeline-zoom-value");
			if (zoomInput) zoomInput.value = String(zoom);
			if (zoomValue) zoomValue.textContent = zoom.toFixed(1).replace(/\\.0$/, "") + "×";
			updateReadout();
			/*
			 * The dock no longer repaints a clip picker of its own: ＋ Add Clips
			 * opens the studio's "Add video from template" composer (#tpl-modal),
			 * which TEMPLATE_COMPOSER_JS owns and re-renders itself. Nothing here
			 * has to follow the modal's state any more.
			 */
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
			var playheadPx = state.playheadSec * pps;
			var leftCss = playheadPx.toFixed(1) + "px";
			grid.querySelectorAll("[data-playhead]").forEach(function (line) { line.style.left = leftCss; });
			var scrollNode = document.getElementById("timeline-scroll");
			if (isPlaying && scrollNode && scrollNode.clientWidth > 200) {
				var labelWidth = 156;
				var visibleWidth = Math.max(120, scrollNode.clientWidth - labelWidth);
				if (playheadPx > scrollNode.scrollLeft + visibleWidth - 24) {
					scrollNode.scrollLeft = Math.max(0, playheadPx - 48);
				} else if (playheadPx < scrollNode.scrollLeft) {
					scrollNode.scrollLeft = Math.max(0, playheadPx - 16);
				}
				grid.setAttribute("data-scrolled", scrollNode.scrollLeft > 2 ? "1" : "0");
			}
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
			/*
			 * A child text/graphic never leaves its background clip: any
			 * timing edit (inspector, dock drag or resize) is clamped back
			 * into the background's own window.
			 */
			if (track.kind === "visual" && item.parentId) clampChildToParent(item);
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
			/*
			 * Child elements follow their background clip. The scene ripple
			 * above already carried the child along when the background moved;
			 * this clamp is what keeps it inside the background's new window
			 * when the clip was shortened or lengthened.
			 */
			if (track.kind === "media") syncChildrenToParent(item);
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

		/* Marks an X/Y control so a canvas drag can move the same slider. */
		function tagPositionControl(input, axis) {
			if (!input || !input.setAttribute) return input;
			input.setAttribute("data-te-position", axis);
			return input;
		}

		function renderItemControls(inspector, track, item) {
			/*
			 * The seconds sliders of every selected-element section (Start,
			 * Duration, and the background's Trim in) are capped at
			 * MAX_TIMING_SEC (80 s) instead of the old 60 s / 600 s bounds, so a
			 * scene or a clip can always be authored up to 80 s.
			 */
			var cap = MAX_TIMING_SEC;
			var parentEntry = item.parentId ? findItem(item.parentId) : null;
			var parentItem = parentEntry && parentEntry.item && parentEntry.item.kind === "media" ? parentEntry.item : null;
			addSectionTitle(inspector, "Timing");
			if (parentItem) {
				/*
				 * A child of a background clip has no free timing: both ranges
				 * are capped by the background's own window, so the child can
				 * never be moved outside the clip that owns it.
				 */
				var parentLimits = childWindow(parentItem);
				addRange(inspector, "Start inside background (seconds)", item.startSec, parentLimits.start, Math.max(parentLimits.start, parentLimits.end - MIN_CLIP_SEC), 0.25, function (value) { itemTimingChanged(findItem(item.id), value, item.durationSec, false, true); }, "s");
				addRange(inspector, "Duration inside background (seconds)", item.durationSec, MIN_CLIP_SEC, Math.max(MIN_CLIP_SEC, parentLimits.end - item.startSec), 0.25, function (value) { itemTimingChanged(findItem(item.id), item.startSec, value, false, true); }, "s");
			} else {
				addRange(inspector, "Start (seconds)", item.startSec, 0, cap, 0.25, function (value) { itemTimingChanged(findItem(item.id), value, item.durationSec, false, true); }, "s");
				addRange(inspector, "Duration (seconds)", item.durationSec, MIN_CLIP_SEC, cap, 0.25, function (value) { itemTimingChanged(findItem(item.id), item.startSec, value, track.kind === "media", true); }, "s");
			}

			if (item.kind === "media") {
				addSectionTitle(inspector, "Background media");
				var info = document.createElement("div");
				info.className = "te-inspector-note";
				/*
				 * The clip name alone. The provider/provider-dot suffixes and the
				 * "background layer" tail were noise: the section already is the
				 * background media, so the label never repeats it.
				 */
				info.textContent = item.assetId ? String(item.label || item.name || "Media") : "No media file is attached to this scene yet. Add a local image, GIF or MP4 to the single background layer.";
				inspector.appendChild(info);
				addSelect(inspector, "Fit", [["Fill frame", "cover"], ["Fit inside", "contain"]], item.fit || "cover", function (value) { item.fit = value; drawPreview(); scheduleSave(); });
				/*
				 * "Trim in" is the last seconds-based slider of the section, so it
				 * follows the same 80 s ceiling instead of the old 600 s one.
				 */
				addRange(inspector, "Trim in (seconds)", clamp(item.trimStartSec || 0, 0, MAX_TIMING_SEC), 0, MAX_TIMING_SEC, 0.25, function (value) { item.trimStartSec = value; drawPreview(); scheduleSave(); }, "s");
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
				tagPositionControl(addRange(inspector, "X position", item.x == null ? 50 : item.x, 0, 100, 1, function (value) { item.x = value; drawPreview(); scheduleSave(); }, "%"), "x");
				tagPositionControl(addRange(inspector, "Y position", item.y == null ? 78 : item.y, 0, 100, 1, function (value) { item.y = value; drawPreview(); scheduleSave(); }, "%"), "y");
				addCheckbox(inspector, "Visible", item.visible !== false, function (value) { item.visible = value; drawPreview(); scheduleSave(); });
				return;
			}
			if (item.kind === "graphic") {
				addSectionTitle(inspector, "Graphic element");
				addSelect(inspector, "Graphic", [["Circle", "circle"], ["Square", "square"], ["Triangle", "triangle"], ["Star", "star"], ["Heart", "heart"], ["Arrow", "arrow"]], item.graphic || "circle", function (value) { item.graphic = value; drawPreview(); scheduleSave(); });
				addRange(inspector, "Size", item.size || 72, 12, 500, 1, function (value) { item.size = value; drawPreview(); scheduleSave(); }, "px");
				addColor(inspector, "Color", item.color || "#7aac2b", function (value) { item.color = value; drawPreview(); scheduleSave(); });
				tagPositionControl(addRange(inspector, "X position", item.x == null ? 50 : item.x, 0, 100, 1, function (value) { item.x = value; drawPreview(); scheduleSave(); }, "%"), "x");
				tagPositionControl(addRange(inspector, "Y position", item.y == null ? 50 : item.y, 0, 100, 1, function (value) { item.y = value; drawPreview(); scheduleSave(); }, "%"), "y");
				addCheckbox(inspector, "Visible", item.visible !== false, function (value) { item.visible = value; drawPreview(); scheduleSave(); });
			}
		}

		function renderInspector() {
			if (!state) return;
			var inspector = document.getElementById("timeline-inspector");
			var selector = document.getElementById("timeline-element-selector");
			var empty = document.getElementById("timeline-inspector-empty");
			var deleteButton = document.getElementById("timeline-delete-element");
			var duplicateButton = document.getElementById("timeline-duplicate-element");
			if (!inspector || !selector) return;
			inspector.innerHTML = "";
			selector.innerHTML = "";
			var entry = selectedEntry();
			var track = entry ? entry.track : selectedTrack();
			var item = entry && entry.item;
			var bgParent = backgroundContext();
			var inspectorTrack = bgParent ? mediaTrack() : track;
			var inspectorItem = bgParent || item;
			var selectedScene = inspectorItem && inspectorItem.sceneId ? sceneById(inspectorItem.sceneId) : activeSceneAt(state.playheadSec);
			selectedSceneId = selectedScene && selectedScene.id || selectedSceneId;
			/*
			 * The selected clip's name is painted INLINE next to "Selected Scene"
			 * (one line, no newline between the clip label and the section title)
			 * instead of as a separate title row above the element pills.
			 */
			var selectedName = document.getElementById("timeline-selected-name");
			if (selectedName) {
				selectedName.textContent = inspectorItem ? String(inspectorItem.label || inspectorItem.name || (inspectorItem.kind === "text" ? "Text" : inspectorItem.kind)) : inspectorTrack ? inspectorTrack.label : "";
			}
			/*
			 * The section above the tracks is only a "scene" while it edits a
			 * box of the Scene Media layer — a scene IS that box. Anything else
			 * (a text clip, a graphic, an audio clip, a bare track) is an
			 * element, so the heading reads "Selected Element" — both words
			 * capitalised, Session 332, matching the "Selected Scene" wording it
			 * replaces. A child text or graphic re-resolves to its parent
			 * background box, which keeps the scene wording the background
			 * section is known for.
			 */
			var selectedTitle = document.getElementById("timeline-selected-title");
			if (selectedTitle) {
				var onMediaLayer = Boolean(inspectorItem) && String(inspectorItem.kind) === "media";
				var mediaTrackOnly = !inspectorItem && Boolean(inspectorTrack) && String(inspectorTrack.kind) === "media";
				selectedTitle.textContent = onMediaLayer || mediaTrackOnly ? "Selected Scene" : "Selected Element";
				var inspectorPanel = selectedTitle.closest ? selectedTitle.closest(".te-inspector-panel") : null;
				if (inspectorPanel) inspectorPanel.setAttribute("aria-label", onMediaLayer || mediaTrackOnly ? "Selected scene controls" : "Selected Element controls");
			}
			if (selectedScene && (!inspectorItem || inspectorItem.kind !== "media")) {
				sceneElementEntries(selectedScene.id).forEach(function (candidate) {
					if (candidate.item && candidate.item.parentId) return;
					var button = document.createElement("button");
					button.type = "button";
					button.className = "tm-scene-object" + (inspectorItem && String(inspectorItem.id) === String(candidate.item.id) ? " selected" : "");
					button.textContent = candidate.item.kind === "text" ? "Text · " + String(candidate.item.text || "").slice(0, 20) : "Graphic · " + String(candidate.item.graphic || "shape");
					button.setAttribute("aria-pressed", inspectorItem && String(inspectorItem.id) === String(candidate.item.id) ? "true" : "false");
					button.addEventListener("click", function () { chooseItem(candidate.track, candidate.item); });
					selector.appendChild(button);
				});
			}
			if (empty) empty.hidden = Boolean(inspectorItem || inspectorTrack);
			if (deleteButton) {
				var canDelete = Boolean(item && !(item.kind === "audio" && item.assetId === "voiceover" && track.id === "voiceover"));
				deleteButton.hidden = !canDelete;
				deleteButton.disabled = !canDelete;
			}
			if (duplicateButton) {
				duplicateButton.hidden = !item;
				duplicateButton.disabled = !item;
			}
			if (inspectorItem && inspectorTrack) renderItemControls(inspector, inspectorTrack, inspectorItem);
			else if (inspectorTrack) renderTrackControls(inspector, inspectorTrack);
			/* The left child panel is driven by the same selection. */
			renderChildPanel();
		}

		/*
		 * The left child panel
		 * --------------------
		 * While a background clip (Pixabay image, GIF or MP4) - or one of its
		 * own children - is selected, the stage row splits 70 / 30: the preview
		 * keeps 70 % and this panel owns the other 30 %. It offers the
		 * ＋ Child text / ＋ Child graphic buttons, the list of the background's
		 * child clips and the editor of the selected child. Selecting any other
		 * element hides the panel and gives the preview its 100 % width back.
		 */
		function renderChildPanel() {
			var row = document.getElementById("timeline-stage-row");
			var panel = document.getElementById("timeline-child-panel");
			var listRoot = document.getElementById("timeline-child-list");
			var editorRoot = document.getElementById("timeline-child-editor");
			if (!row || !panel || !listRoot || !editorRoot) return;
			var parentItem = backgroundContext();
			var entry = selectedEntry();
			listRoot.innerHTML = "";
			editorRoot.innerHTML = "";
			if (row.classList) {
				if (parentItem) row.classList.add("te-child-open");
				else row.classList.remove("te-child-open");
			}
			panel.hidden = !parentItem;
			if (!parentItem) return;
			var limits = childWindow(parentItem);
			var children = childItemsFor(parentItem);
			var title = document.getElementById("timeline-child-title");
			if (title) title.textContent = String(parentItem.label || parentItem.name || "Background clip");
			var windowLabel = document.getElementById("timeline-child-window");
			if (windowLabel) windowLabel.textContent = "Pinned window " + formatTime(limits.start) + " – " + formatTime(limits.end) + " · " + children.length + (children.length === 1 ? " child element" : " child elements");
			if (!children.length) {
				var empty = document.createElement("p");
				empty.className = "te-child-empty";
				empty.textContent = "No child text or graphic yet. Use ＋ Child text or ＋ Child graphic above.";
				listRoot.appendChild(empty);
			}
			children.forEach(function (child) {
				var isSelected = Boolean(entry && entry.item && String(entry.item.id) === String(child.item.id));
				var rowNode = document.createElement("div");
				rowNode.className = "te-child-row" + (isSelected ? " selected" : "");
				rowNode.setAttribute("data-child-id", String(child.item.id));
				rowNode.setAttribute("role", "button");
				rowNode.setAttribute("tabindex", "0");
				rowNode.title = "Select this child element";
				var label = document.createElement("span");
				label.className = "te-child-row-label";
				label.textContent = child.item.kind === "text"
					? "Text · " + (String(child.item.text || "").slice(0, 26) || "empty")
					: "Graphic · " + String(child.item.graphic || "shape");
				var time = document.createElement("span");
				time.className = "te-child-row-time";
				time.textContent = formatTime(child.item.startSec) + " · " + formatTime(child.item.durationSec);
				var remove = document.createElement("button");
				remove.type = "button";
				remove.className = "te-child-row-delete";
				remove.setAttribute("data-child-delete-id", String(child.item.id));
				remove.title = "Delete this child element";
				remove.textContent = "✕";
				rowNode.appendChild(label);
				rowNode.appendChild(time);
				rowNode.appendChild(remove);
				listRoot.appendChild(rowNode);
			});
			if (entry && entry.item && entry.item.parentId && String(entry.item.parentId) === String(parentItem.id)) {
				var editorTitle = document.createElement("div");
				editorTitle.className = "te-child-editor-title";
				editorTitle.textContent = entry.item.kind === "text" ? "Editing child text" : "Editing child graphic";
				editorRoot.appendChild(editorTitle);
				renderItemControls(editorRoot, entry.track, entry.item);
			} else {
				var hint = document.createElement("p");
				hint.className = "te-child-empty";
				hint.textContent = "Select a child element in the list to edit it here, or drag it on the preview canvas to place it. Child timing follows this background clip only.";
				editorRoot.appendChild(hint);
			}
		}

		/*
		 * Session 332 — a new text/graphic never shares timed space
		 * ---------------------------------------------------------
		 * ＋ Text / ＋ Graphic used to drop the element at the playhead with a
		 * fixed 4 s length, which happily landed on top of a clip that was
		 * already there. The placement is now computed in JS from the timeline
		 * itself:
		 *
		 *   · the taken windows are EVERY clip of EVERY TEXT & GRAPHICS lane
		 *     plus EVERY clip of the Scene Media layer — the two layer families
		 *     the request names. Audio lanes are deliberately outside the
		 *     search: a soundtrack is supposed to run under a caption.
		 *   · the element keeps its 4 s length and takes the FIRST gap that
		 *     fits it. The playhead's own window is tried first (so an empty
		 *     timeline still behaves the way it always did), then the gaps are
		 *     scanned from 0 s upward.
		 *   · when the timeline is wall to wall — a Quick Batch row hands over
		 *     12 back-to-back scenes, so this is the common case — the element
		 *     is appended after the right-most clip and ensureTimelineEnd()
		 *     grows the project to hold it.
		 *   · the playhead follows the element into its new window, so the
		 *     thing that was just added is the thing on screen (and draggable
		 *     on the canvas) instead of sitting one scroll-width away.
		 *
		 * A CHILD text/graphic is exempt: living inside its background clip's
		 * window is its whole contract (§19), so it is placed by
		 * childWindow() and never by this search.
		 */
		var TIMING_EPSILON_SEC = 0.001;
		function occupiedVisualWindows() {
			var lanes = visualTracks();
			var media = mediaTrack();
			if (media) lanes = lanes.concat([media]);
			var windows = [];
			lanes.forEach(function (track) {
				(track.items || []).forEach(function (item) {
					/*
					 * The seeded dummy text clip counts: it is a real, editable
					 * clip of a text lane, so its window is taken space like any
					 * other. Subtitle cues are not in state.tracks at all, so
					 * they never enter this list.
					 */
					if (!item) return;
					var start = clamp(number(item.startSec, 0), 0, MAX_DURATION_SEC);
					var end = start + clamp(number(item.durationSec, MIN_CLIP_SEC), MIN_CLIP_SEC, MAX_DURATION_SEC);
					windows.push({ start: start, end: end });
				});
			});
			return windows.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
		}
		function visualWindowIsFree(start, duration) {
			var end = start + duration;
			return !occupiedVisualWindows().some(function (window) {
				return start < window.end - TIMING_EPSILON_SEC && window.start < end - TIMING_EPSILON_SEC;
			});
		}
		function freeVisualWindow(duration) {
			var wanted = clamp(duration, MIN_CLIP_SEC, MAX_DURATION_SEC);
			var busy = occupiedVisualWindows();
			/* 1. the playhead's own window, when nothing is in the way there */
			var atPlayhead = clamp(number(state && state.playheadSec, 0), 0, MAX_DURATION_SEC);
			if (visualWindowIsFree(atPlayhead, wanted)) return { start: atPlayhead, durationSec: wanted, appended: false, atPlayhead: true };
			/* 2. the first gap, scanning the merged busy intervals from 0 s */
			var cursor = 0;
			for (var index = 0; index < busy.length; index++) {
				var entry = busy[index];
				if (entry.start - cursor >= wanted - TIMING_EPSILON_SEC) return { start: cursor, durationSec: wanted, appended: false, atPlayhead: false };
				if (entry.end > cursor) cursor = entry.end;
			}
			/* 3. wall to wall: append after the right-most clip of any layer */
			return { start: clamp(cursor, 0, MAX_DURATION_SEC), durationSec: wanted, appended: true, atPlayhead: false };
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
		/*
		 * parentItem is optional: when it is a background clip the new text
		 * or graphic is created as that clip's CHILD. Its timing is the
		 * background clip's own window (never the playhead) and it stores the
		 * clip id in parentId, which is what binds the two together.
		 *
		 * A FREE element (no parentItem — the ＋ Text / ＋ Graphic buttons)
		 * takes the first timed window that no other text, graphic or Scene
		 * Media clip occupies: see freeVisualWindow() above.
		 */
		function addVisualElement(kind, targetTrack, parentItem) {
			var track = targetTrack && targetTrack.kind === "visual" ? targetTrack : findTrack(state.selectedTrackId);
			if (!track || track.kind !== "visual") track = visualTracks()[0] || addVisualTrack();
			if (!track) return null;
			var parent = parentItem && parentItem.kind === "media" ? parentItem : null;
			var placement = parent ? null : freeVisualWindow(4);
			var start = parent ? clamp(parent.startSec, 0, MAX_DURATION_SEC) : placement.start;
			var duration = parent ? clamp(parent.durationSec, MIN_CLIP_SEC, MAX_DURATION_SEC) : placement.durationSec;
			/*
			 * The scene the element belongs to is resolved from where it
			 * actually landed, then from the playhead it was added at, then
			 * from the first scene — a window appended past the last scene has
			 * no scene of its own.
			 */
			var scene = parent ? sceneById(parent.sceneId) : activeSceneAt(start) || activeSceneAt(state.playheadSec) || state.scenes[0];
			var sceneId = parent && parent.sceneId ? String(parent.sceneId) : (scene && scene.id || "");
			var id = makeId(kind);
			var item = kind === "graphic" ? {
				id: id, kind: "graphic", graphic: "circle", label: "Graphic", sceneId: sceneId,
				startSec: start, durationSec: duration, x: 50, y: 50, size: 72, color: "#7aac2b", visible: true, parentId: parent ? String(parent.id) : ""
			} : {
				id: id, kind: "text", label: "Text", text: "Add your text", sceneId: sceneId,
				startSec: start, durationSec: duration, x: 50, y: 78, fontSize: 28, color: "#ffffff", font: "sans", align: "center", visible: true, parentId: parent ? String(parent.id) : ""
			};
			track.items.push(item);
			state.selectedTrackId = track.id;
			state.selectedItemId = id;
			if (scene) selectedSceneId = scene.id;
			/*
			 * A child has to be on screen to be dragged into place, so a
			 * playhead that sits outside the background window is parked at
			 * the window start. The child can then be dragged on the canvas.
			 */
			if (parent) {
				var parentLimits = childWindow(parent);
				if (state.playheadSec < parentLimits.start || state.playheadSec >= parentLimits.end) state.playheadSec = parentLimits.start;
			}
			/*
			 * A free element can land far from where the playhead was (a wall
			 * to wall timeline sends it to the right-most end), so the playhead
			 * follows it: the element that was just added is the element on
			 * screen, ready to be dragged into place on the canvas.
			 */
			else if (state.playheadSec < start || state.playheadSec >= start + item.durationSec) {
				state.playheadSec = clamp(start, 0, MAX_DURATION_SEC);
			}
			ensureTimelineEnd(start + item.durationSec);
			renderTimeline(); renderInspector(); drawPreview(); scheduleSave();
			return item;
		}
		/*
		 * ＋ Child text / ＋ Child graphic: the buttons that live on a background
		 * clip (in its inspector, in the selected-element header of the left
		 * child panel and on the panel itself). A child always opens its own
		 * lane on top like every other ＋ Text / ＋ Graphic click, and its
		 * timing is the background clip's window.
		 */
		function addChildVisualElement(kind, parentItem) {
			var parent = parentItem && parentItem.kind === "media" ? parentItem : backgroundContext();
			if (!parent) {
				setStatus("Select a background clip (Pixabay image, GIF or MP4) before adding a child text or graphic.", true);
				return null;
			}
			/* The child lives on a visual lane, so a folded group is reopened. */
			if (state.visualsExpanded === false) state.visualsExpanded = true;
			var lanes = visualTracks();
			var track = null;
			var capped = false;
			if (lanes.length >= MAX_VISUAL_TRACKS) {
				track = lanes[lanes.length - 1] || null;
				capped = true;
			} else {
				track = addVisualTrack();
			}
			if (!track) return null;
			var item = addVisualElement(kind, track, parent);
			if (item) {
				var limits = childWindow(parent);
				setStatus("Added a child " + kind + " inside " + String(parent.label || "the background clip") + " (" + formatTime(limits.start) + " – " + formatTime(limits.end) + "). Drag it on the preview canvas to place it." + (capped ? " Four lanes are already open, so it was added to the top layer." : ""), false);
			}
			return item;
		}
		/*
		 * Duplicate
		 * ---------
		 * The copy is always placed immediately AFTER the original: its start
		 * is the original's end (start + duration). That is the "next time
		 * unit" for a background clip (one clip = one unit of the timeline)
		 * and the "after the original timing ends" slot for a text, graphic or
		 * audio clip. A duplicated background clip also duplicates its own
		 * child text/graphics, so the copy is never an empty scene.
		 */
		function duplicateLabelFor(source) {
			var base = String(source && (source.label || source.name) || (source && source.kind) || "Clip").replace(/ copy( \d+)?$/, "").slice(0, 60);
			var labels = [];
			state.tracks.forEach(function (track) {
				track.items.forEach(function (item) { labels.push(String(item.label || item.name || "")); });
			});
			var candidate = base + " copy";
			var counter = 1;
			while (labels.indexOf(candidate) !== -1 && counter < 50) {
				counter += 1;
				candidate = base + " copy " + counter;
			}
			return candidate.slice(0, 80);
		}
		function duplicateSelectedItem() {
			var found = selectedEntry();
			if (!found) { setStatus("Select a clip in the timeline before duplicating it.", true); return null; }
			var source = found.item;
			var track = found.track;
			var copy = deepCopy(source);
			if (!copy) { setStatus("This clip could not be duplicated.", true); return null; }
			var start = clamp(source.startSec + source.durationSec, 0, MAX_DURATION_SEC);
			copy.id = makeId(source.kind);
			copy.label = duplicateLabelFor(source);
			copy.startSec = start;
			copy.durationSec = clamp(source.durationSec, MIN_CLIP_SEC, MAX_DURATION_SEC);
			delete copy.dummy;
			var detachedChild = false;
			if (source.kind === "media") {
				/*
				 * A duplicated background clip gets its own scene record, so
				 * the dock, the scene list and the saved project all describe
				 * the copy as a real unit next to the original.
				 */
				var sourceScene = source.sceneId ? sceneById(source.sceneId) : null;
				var sceneCopy = sourceScene ? deepCopy(sourceScene) : { elements: [] };
				sceneCopy = sceneCopy || { elements: [] };
				sceneCopy.id = makeId("scene");
				sceneCopy.name = String(sourceScene && sourceScene.name || "Scene") + " copy";
				sceneCopy.startSec = start;
				sceneCopy.durationSec = copy.durationSec;
				sceneCopy.mediaType = source.mediaType || sceneCopy.mediaType || "image";
				sceneCopy.mediaAssetId = source.assetId || "";
				sceneCopy.mediaName = source.label || sceneCopy.mediaName || "";
				sceneCopy.mediaSource = source.mediaSource || sceneCopy.mediaSource || "";
				sceneCopy.elements = [];
				var sceneIndex = state.scenes.indexOf(sourceScene);
				if (sceneIndex === -1) state.scenes.push(sceneCopy);
				else state.scenes.splice(sceneIndex + 1, 0, sceneCopy);
				state.scenes.forEach(function (scene, position) { scene.index = position; });
				copy.sceneId = sceneCopy.id;
				var sourceIndex = track.items.indexOf(source);
				track.items.splice(sourceIndex === -1 ? track.items.length : sourceIndex + 1, 0, copy);
				/*
				 * The background clip owns its children, so its duplicate owns
				 * copies of them (same lane, same offset inside the window).
				 */
				childItemsFor(source).forEach(function (entry) {
					var offset = entry.item.startSec - source.startSec;
					var childCopy = deepCopy(entry.item);
					if (!childCopy) return;
					childCopy.id = makeId(entry.item.kind);
					childCopy.parentId = copy.id;
					childCopy.sceneId = sceneCopy.id;
					childCopy.startSec = clamp(start + offset, start, start + copy.durationSec - MIN_CLIP_SEC);
					childCopy.durationSec = clamp(entry.item.durationSec, MIN_CLIP_SEC, Math.max(MIN_CLIP_SEC, start + copy.durationSec - childCopy.startSec));
					entry.track.items.push(childCopy);
				});
			} else {
				var ownIndex = track.items.indexOf(source);
				track.items.splice(ownIndex === -1 ? track.items.length : ownIndex + 1, 0, copy);
				if (source.parentId) {
					/*
					 * A child copy only stays a child when the whole copy fits
					 * inside the background window; otherwise it becomes a free
					 * clip at the same "after the original" position.
					 */
					var parentEntry = findItem(source.parentId);
					var parentItem = parentEntry && parentEntry.item;
					var fits = parentItem && copy.startSec + copy.durationSec <= (parentItem.startSec + parentItem.durationSec) + 0.001;
					if (fits) {
						copy.parentId = String(parentItem.id);
						copy.sceneId = String(parentItem.sceneId || copy.sceneId || "");
					} else {
						copy.parentId = "";
						detachedChild = true;
						var landing = activeSceneAt(copy.startSec);
						if (landing) copy.sceneId = landing.id;
					}
				}
			}
			state.selectedTrackId = track.id;
			state.selectedItemId = copy.id;
			if (copy.sceneId) selectedSceneId = copy.sceneId;
			ensureTimelineEnd(copy.startSec + copy.durationSec);
			renderTimeline(); renderInspector(); drawPreview(); scheduleSave();
			var message = 'Duplicated "' + String(source.label || source.name || source.kind) + '" at ' + formatTime(copy.startSec) + ' - right after the original ends.';
			if (detachedChild) message += " The copy falls outside the background window, so it is now a free clip.";
			setStatus(message, false);
			return copy;
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
			if (removed.kind === "media") {
				/*
				 * A child cannot outlive the background clip that owns it.
				 * The scene cascade below covers the scene-linked elements;
				 * this line covers a child that lost its scene link meanwhile.
				 */
				sceneElementTracks().forEach(function (track) { track.items = track.items.filter(function (item) { return String(item.parentId || "") !== String(removed.id); }); });
			}
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
			var record = { id: String(id), blob: blob, url: url, name: String(info.name || blob.name || ""), type: type, source: info.source || null, durationSec: number(info.durationSec, 0), image: null, video: null };
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
				video.addEventListener("seeked", function () { if (!isPlaying) drawPreview(); });
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
		/*
		 * ＋ Add Clips — the studio's "Add video from template" composer
		 * -------------------------------------------------------------
		 * Session 332 replaced the timeline's own look-alike picker (the
		 * .te-clips-* modal of §21) with the REAL thing: this button opens
		 * #tpl-modal, the very modal the editor layout's "Add video from
		 * template" link opens, built and driven by TEMPLATE_COMPOSER_JS.
		 *
		 * APP_JS owns videoProjects and addVideoAccordion(), so it is APP_JS
		 * that makes sure a Video N exists for the composer to target and then
		 * calls window.openTemplateModal(n): window.openTemplateModalForTimeline().
		 * On this page that accordion lives inside #view-editor, which is not
		 * the active view, so the composer is the only thing on screen.
		 *
		 * The composer hands the MP4 it renders back through
		 * window.__TIMELINE_TEMPLATE_CLIP__ — registered below, and only here:
		 * this bundle returns early when layout != timeline, so the editor
		 * layout's "add to the gallery" behaviour is untouched. The clip is
		 * appended after the right-most clip of the Scene Media layer, one
		 * scene per clip, which is the §21 landing rule unchanged.
		 *
		 * clipsQueue stays as the pending list appendQueuedClips() drains, so
		 * "append at the right-most end" still has exactly one implementation.
		 * Uploads keep their own button: ＋ Add media fills the first pending
		 * scene placeholder and, once every placeholder is filled, appends at
		 * the right-most end too.
		 */
		var clipsQueue = [];
		function clipsQueued(assetId) { return clipsQueue.indexOf(String(assetId)) !== -1; }
		function openTemplateClipsModal() {
			if (!state) return false;
			if (isExporting || recorder) { setStatus("Wait for the export to finish before adding a clip.", true); return false; }
			var opener = window.openTemplateModalForTimeline;
			if (typeof opener !== "function") opener = window.openTemplateModal;
			if (typeof opener !== "function") {
				setStatus("The Add video from template composer is not available on this page.", true);
				return false;
			}
			var opened = false;
			try { opened = opener() !== false; } catch (error) { opened = false; }
			if (!opened) { setStatus("The Add video from template modal could not be opened.", true); return false; }
			setStatus("Compose the clip in the Add video from template modal \u2014 its \u2795 Add button appends the MP4 to the right-most end of Scene Media.", false);
			return true;
		}
		/*
		 * The composer's callback. It is deliberately synchronous: the composer
		 * already probed the MP4, so the length needs no second probe, and the
		 * composer reads the return value as "how many clips landed".
		 */
		function appendTemplateClip(clip) {
			if (!state || !clip) return 0;
			var blob = clip.blob || clip.file || null;
			if (!blob) { setStatus("The composed clip arrived without any media bytes.", true); return 0; }
			if (isExporting || recorder) { setStatus("Wait for the export to finish before adding a clip.", true); return 0; }
			if (!mediaTrack()) { setStatus("The Scene Media layer is missing from this project.", true); return 0; }
			if (clipsQueue.length >= MAX_MEDIA_FILES) { setStatus("A single timeline holds at most " + MAX_MEDIA_FILES + " clips.", true); return 0; }
			var name = String(clip.name || "Template clip").slice(0, 80);
			var file = clip.file && typeof clip.file === "object" && clip.file.name ? clip.file : new File([blob], name, { type: "video/mp4" });
			var duration = clamp(number(clip.durationSec, 0) || 5, MIN_CLIP_SEC, MAX_DURATION_SEC);
			var assetId = makeId("template");
			registerAsset(assetId, file, { name: name, type: "video/mp4", source: "template composer", durationSec: duration });
			api.storeAsset(pageId, assetId, file, { name: name, type: "video/mp4", source: "template composer" }).then(function (result) { if (!result || !result.ok) setStatus("The composed clip works now but could not be kept for reloads in this browser.", true); });
			if (!clipsQueued(assetId)) clipsQueue.push(assetId);
			return appendQueuedClips();
		}
		function appendQueuedClips() {
			var track = mediaTrack();
			if (!track) { setStatus("The Scene Media layer is missing from this project.", true); return 0; }
			if (!clipsQueue.length) { setStatus("Queue at least one clip first.", true); return 0; }
			/* The right-most end of the lane is the only landing spot. */
			var nextStart = track.items.reduce(function (end, item) { return Math.max(end, item.startSec + item.durationSec); }, 0);
			var startAt = nextStart;
			var added = 0;
			var lastItem = null;
			var lastSceneId = "";
			clipsQueue.forEach(function (assetId) {
				var asset = assetMap[assetId];
				if (!asset || !asset.blob) return;
				var type = String(asset.type || (asset.blob && asset.blob.type) || "");
				var kind = type === "video/mp4" ? "video" : type === "image/gif" ? "gif" : "image";
				var name = String(asset.name || "Clip").slice(0, 80);
				/*
				 * The probed length wins, then the duration the media element
				 * already knows (a hand-off MP4 is decoded by boot()), then the
				 * five-second default every other clip gets.
				 */
				var probed = number(asset.video && asset.video.duration, 0);
				var duration = clamp(number(asset.durationSec, 0) || probed || 5, MIN_CLIP_SEC, MAX_DURATION_SEC);
				var sceneId = makeId("scene");
				var itemId = makeId("media");
				var source = String(asset.source || "template composer");
				var scene = { id: sceneId, index: state.scenes.length, name: "Scene " + (state.scenes.length + 1) + " · " + name, startSec: nextStart, durationSec: duration, mediaType: kind, mediaAssetId: String(assetId), mediaName: name, mediaSource: source, prompt: "", effects: (state.videoStyleEffects || []).slice(), videoStyle: state.videoStyle, elements: [] };
				var item = { id: itemId, kind: "media", sceneId: sceneId, assetId: String(assetId), label: name, mediaType: kind, mediaSource: source, startSec: nextStart, durationSec: duration, trimStartSec: 0, fit: "cover", visible: true };
				state.scenes.push(scene);
				track.items.push(item);
				nextStart += duration;
				added += 1;
				lastItem = item;
				lastSceneId = sceneId;
			});
			if (!added) { setStatus("None of the queued clips could be read.", true); return 0; }
			clipsQueue = [];
			ensureTimelineEnd(nextStart);
			state.selectedTrackId = MEDIA_TRACK_ID;
			state.selectedItemId = lastItem ? lastItem.id : "";
			if (lastSceneId) selectedSceneId = lastSceneId;
			renderTimeline(); renderInspector(); drawPreview(); scheduleSave();
			setStatus("Queued " + added + (added === 1 ? " clip" : " clips") + " at the right-most end of Scene Media (from " + formatTime(startAt) + " to " + formatTime(nextStart) + ").", false);
			return added;
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

		/*
		 * ＋ Text / ＋ Graphic in the tracks (and the same actions in the
		 * selected-element header) add a NEW layer on top of the existing
		 * ones and drop the element into it. addVisualTrack() appends to the
		 * visual group, which is the highest paint layer and the first lane
		 * listed in the dock. At the four-lane cap the element goes into the
		 * current top layer instead, and the status line says so.
		 */
		function addVisualElementFromAction(kind) {
			/* ＋ Text / ＋ Graphic stay reachable on a folded group, so the group
			 * opens itself again rather than adding a lane nobody can see. */
			if (state.visualsExpanded === false) state.visualsExpanded = true;
			var lanes = visualTracks();
			var capped = lanes.length >= MAX_VISUAL_TRACKS;
			var track = capped ? (lanes[lanes.length - 1] || null) : addVisualTrack();
			if (!track) return null;
			var item = addVisualElement(kind, track);
			/*
			 * The status line names the window the element took, so a placement
			 * at the right-most end (the usual answer on a wall-to-wall Quick
			 * Batch timeline) is never a silent surprise.
			 */
			if (item) {
				var window = formatTime(item.startSec) + " \u2013 " + formatTime(item.startSec + item.durationSec);
				var reason = "the first timed space no other text, graphic or Scene Media clip occupies";
				setStatus((capped
					? "Four text and graphics lanes are already open - the element is added to the top layer at "
					: (kind === "graphic" ? "Graphic" : "Text") + " added in its own lane at ") + window + " \u2014 " + reason + ".", capped);
			}
			return item;
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
				if (!active || !asset || candidate !== asset) {
					try { candidate.video.pause(); } catch (error) {}
					return;
				}
				var offset = Math.max(0, seconds - active.startSec + number(active.trimStartSec, 0));
				if (Number.isFinite(candidate.video.duration) && candidate.video.duration > 0) offset = offset % candidate.video.duration;
				if (Math.abs(number(candidate.video.currentTime, 0) - offset) > 0.3 && !candidate.video.seeking) { try { candidate.video.currentTime = offset; } catch (error) {} }
				if (!isPlaying) { try { candidate.video.pause(); } catch (error) {} return; }
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
		/*
		 * Burned-in subtitle painter for the timeline preview. It matches the
		 * Quick Batch painter (app-js drawSubtitles): white Bookman text on a
		 * translucent black box, centred one third of the frame up from the
		 * bottom, one fillText per wrapped line. measureText/fillRect are
		 * guarded so a bare canvas test double still works.
		 */
		function drawTimelineSubtitles(context, cues, timestampMs, width, height) {
			if (!context || !Array.isArray(cues) || !cues.length) return;
			var active = null;
			for (var i = 0; i < cues.length; i++) {
				var cue = cues[i];
				if (!cue) continue;
				if (timestampMs >= number(cue.startMs, 0) && timestampMs < number(cue.endMs, 0)) { active = cue; break; }
			}
			if (!active) return;
			context.save();
			context.font = SUBTITLE_FONT_SIZE + "px " + SUBTITLE_FONT_STACK;
			context.textAlign = "center";
			context.textBaseline = "middle";
			var x = width / 2;
			var y = height - height / 3;
			var lines = String(active.text || "").split("\\n").slice(0, 6);
			var padX = 10;
			var padY = 6;
			var lineHeight = SUBTITLE_FONT_SIZE + 4;
			var maxLineWidth = Math.max(1, width - padX * 2);
			var widths = lines.map(function (line) {
				return context.measureText ? context.measureText(line).width : line.length * SUBTITLE_FONT_SIZE * 0.5;
			});
			var textWidth = Math.min(maxLineWidth, Math.max.apply(null, widths));
			var boxWidth = textWidth + padX * 2;
			var boxHeight = lines.length * lineHeight + padY * 2;
			var boxX = x - boxWidth / 2;
			var boxY = y - boxHeight / 2;
			context.fillStyle = "rgba(0, 0, 0, 0.55)";
			if (typeof context.fillRect === "function") context.fillRect(boxX, boxY, boxWidth, boxHeight);
			else { context.beginPath(); context.rect(boxX, boxY, boxWidth, boxHeight); context.fill(); }
			context.fillStyle = "#ffffff";
			for (var lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				context.fillText(lines[lineIndex], x, y + (lineIndex - (lines.length - 1) / 2) * lineHeight, maxLineWidth);
			}
			context.restore();
		}

		/*
		 * Image/video effect overlays copied from the editor layout's video
		 * template modal (template-scene-editor.ts reelDrawBackground):
		 *   - the "Duotone gradient" double gradient (duotone effect)
		 *   - the neon scene's pink radial glow  ("neon effect")
		 *   - the VHS/glitch scene's rolling scanlines ("vhs effect")
		 * The effects are resolved from the Quick Batch row's video style, which
		 * the Edit handoff passes in as project data (state.videoStyle and
		 * state.projectDetail.style) and stamps onto every scene (scene.effects),
		 * on top of the shared window.__videoStyleFilter() CSS filter. They sit
		 * above the background media and below the text/graphics layers, exactly
		 * like the template modal paints them. Guards keep bare canvas test
		 * doubles safe.
		 */
		function drawStyleEffects(context, width, height, seconds, scene) {
			if (!context || !state) return [];
			var style = String(scene && scene.videoStyle || state.videoStyle || "");
			/*
			 * Every scene carries its own resolved effect list, so the treatment
			 * is applied to ALL scenes: a cinematic row paints the double
			 * gradient on each video and image scene, a neon row paints the neon
			 * glow plus the VHS bars on each one. state.videoStyleEffects is the
			 * fallback for a scene saved before this field existed.
			 */
			var effects = scene && Array.isArray(scene.effects)
				? normalizeEffects(scene.effects, style)
				: normalizeEffects(state.videoStyleEffects, style);
			if (!effects.length) return [];
			var scale = Math.max(0.5, height / 720);
			if (effects.indexOf("duotone") !== -1 && typeof context.createLinearGradient === "function") {
				/*
				 * "Duotone gradient" from the template modal: two colours
				 * (#ff6b35 and #2ec4b6) in one moving gradient, i.e. the double
				 * gradient laid over the image or video frame. The modal's
				 * bg.speed factor is modal-only, so it is omitted here.
				 */
				var shift = ((seconds * 14) % 100) / 100;
				var duo = context.createLinearGradient(width * (shift - 0.5), 0, width * (shift + 1), 0);
				duo.addColorStop(0, "rgba(255,107,53,0.42)");
				duo.addColorStop(0.5, "rgba(255,107,53,0.12)");
				duo.addColorStop(1, "rgba(46,196,182,0.44)");
				context.save();
				context.fillStyle = duo;
				context.fillRect(0, 0, width, height);
				context.restore();
			}
			if (effects.indexOf("neon") !== -1 && typeof context.createRadialGradient === "function") {
				context.save();
				var glow = context.createRadialGradient(width * 0.5, height * 0.5, width * 0.03, width * 0.5, height * 0.5, width * 0.72);
				glow.addColorStop(0, "rgba(255,45,149,0.08)");
				glow.addColorStop(1, "rgba(0,0,0,0.52)");
				context.fillStyle = glow;
				context.fillRect(0, 0, width, height);
				context.restore();
			}
			if (effects.indexOf("vhs") !== -1) {
				context.save();
				context.globalAlpha = 0.3;
				context.fillStyle = "rgba(0,0,0,0.72)";
				var effectLine = Math.max(2, Math.round(2 * scale));
				var gap = Math.max(5, Math.round(7 * scale));
				var scroll = Math.floor((seconds * 24) % gap);
				for (var y = -gap; y < height + gap; y += gap) context.fillRect(0, y + scroll, width, effectLine);
				context.restore();
			}
			return effects;
		}

		function drawPreview() {
			if (!canvas || !canvasContext || !state) return;
			var width = canvas.width || 720; var height = canvas.height || 1280;
			var context = canvasContext;
			context.clearRect(0, 0, width, height);
			var active = activeMediaAt(state.playheadSec);
			var scene = active && active.sceneId ? sceneById(active.sceneId) : null;
			var asset = active && active.assetId ? assetMap[active.assetId] : null;
			context.fillStyle = "#08090c"; context.fillRect(0, 0, width, height);
			var drawn = false;
		syncVideoPreview(active, active && active.visible !== false ? asset : null, state.playheadSec);
			/* Layer 0 — the background layer. Pixabay stock and uploads land here. */
			if (active && active.visible !== false && asset) {
				context.save();
				if (window.__videoStyleFilter && "filter" in context) context.filter = window.__videoStyleFilter(state.videoStyle);
				if (asset.video) {
					drawn = asset.video.readyState >= 2 && drawImageCover(context, asset.video, width, height, active.fit || "cover");
				}
				else if (asset.image && asset.image.complete) drawn = drawImageCover(context, asset.image, width, height, active.fit || "cover");
				context.restore();
			}
			if (!drawn && active) drawPlaceholder(context, width, height, scene);
			/*
			 * Template-modal image effects (double gradient / neon / VHS) ride on
			 * the background layer of EVERY scene, resolved from the scene itself.
			 */
			drawStyleEffects(context, width, height, state.playheadSec, scene);
			/* Layers 1..4 — every text and graphic clip paints above the background. */
			visualTracks().forEach(function (track) {
				track.items.forEach(function (item) {
					var live = state.playheadSec >= item.startSec && state.playheadSec < item.startSec + item.durationSec;
					if (!live) return;
					if (item.kind === "graphic" && item.visible !== false) {
						drawGraphic(context, item, width, height);
						/* The dashed box is the drag affordance; exports never carry it. */
						if (!recorder && !isExporting && String(item.id) === String(state.selectedItemId)) drawSelectionBox(context, item, width, height);
					}
					if (item.kind === "text") drawText(context, item, width, height, !recorder && !isExporting && String(item.id) === String(state.selectedItemId));
				});
			});
			/*
			 * Burned-in script subtitles paint last, above the user's own text
			 * and graphics, exactly where the voiceover says them. They are
			 * cue data from the Quick Batch row, never timeline clips.
			 */
			drawTimelineSubtitles(context, state.subtitles, state.playheadSec * 1000, width, height);
			var placeholder = document.getElementById("timeline-preview-placeholder");
			if (placeholder) placeholder.hidden = drawn;
			var note = document.getElementById("timeline-preview-note");
			if (note) note.textContent = asset ? (asset.name || "Local media preview") + " · background layer · timing edits are saved in this browser" : "No media file is attached to the selected scene yet. Use + Add media to upload an image, GIF or MP4 to the background layer.";
			syncAudioPlayback();
			updateReadout();
			if (isPlaying || shouldAnimatePreview()) schedulePreviewFrame();
		}

		/*
		 * Drag-to-position on the preview canvas.
		 *
		 * A text or graphic clip can be dragged with the pointer: the pointer
		 * position is converted back to the item's 0-100 % x/y anchors, which
		 * is the same scale the inspector sliders use. Dragging therefore
		 * updates the model, the inspector X/Y readouts and the stored
		 * project metadata. Media and audio clips are never draggable.
		 *
		 * The geometry mirrors drawText() / drawGraphic() so the grab area is
		 * where the element actually is on screen.
		 */
		function canvasFrameSize() {
			return {
				width: Math.max(1, Number(canvas && canvas.width) || 1280),
				height: Math.max(1, Number(canvas && canvas.height) || 720)
			};
		}
		function canvasPointerPoint(event) {
			var frame = canvasFrameSize();
			var rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
			if (!rect) rect = { left: 0, top: 0, width: frame.width, height: frame.height };
			var cssWidth = Math.max(1, Number(rect.width) || frame.width);
			var cssHeight = Math.max(1, Number(rect.height) || frame.height);
			return {
				x: (Number(event && event.clientX) - Number(rect.left || 0)) * (frame.width / cssWidth),
				y: (Number(event && event.clientY) - Number(rect.top || 0)) * (frame.height / cssHeight),
				width: frame.width,
				height: frame.height
			};
		}
		function textLines(item) {
			return String(item && item.text || "").split("\\n").slice(0, 8);
		}
		function itemBounds(item, width, height) {
			var scale = Math.max(1, height / 720);
			var anchorX = width * (number(item && item.x, 50) / 100);
			var anchorY = height * (number(item && item.y, item && item.kind === "graphic" ? 50 : 78) / 100);
			if (item && item.kind === "graphic") {
				var size = Math.max(8, number(item.size, 72) * scale);
				return { left: anchorX - size / 2, top: anchorY - size / 2, width: size, height: size };
			}
			var fontSize = Math.max(10, number(item && item.fontSize, 28) * scale);
			var lines = textLines(item);
			var lineHeight = fontSize * 1.2;
			/* Rough advance width: wide enough to grab a caption, tight enough to miss empty pixels. */
			var longest = 1;
			lines.forEach(function (line) { longest = Math.max(longest, String(line).length); });
			var boxWidth = clamp(longest * fontSize * 0.6, fontSize * 1.6, width);
			var boxHeight = lineHeight * Math.max(1, lines.length);
			var align = item && item.align || "center";
			var left = align === "left" ? anchorX : align === "right" ? anchorX - boxWidth : anchorX - boxWidth / 2;
			var pad = Math.max(6, fontSize * 0.35);
			return { left: left - pad, top: anchorY - boxHeight / 2 - pad, width: boxWidth + pad * 2, height: boxHeight + pad * 2 };
		}
		function canvasDraggableEntries(seconds) {
			var list = [];
			/* Highest layer first: the last visual track paints last, so it wins a hit test. */
			visualTracks().slice().reverse().forEach(function (track) {
				track.items.forEach(function (item) {
					if (!item || (item.kind !== "text" && item.kind !== "graphic")) return;
					if (item.visible === false) return;
					if (!(seconds >= item.startSec && seconds < item.startSec + item.durationSec)) return;
					list.push({ track: track, item: item });
				});
			});
			return list;
		}
		function canvasHitTest(point, seconds) {
			var entries = canvasDraggableEntries(seconds);
			for (var index = 0; index < entries.length; index++) {
				var box = itemBounds(entries[index].item, point.width, point.height);
				if (point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height) return entries[index];
			}
			/*
			 * Nothing under the pointer: the SELECTED clip stays draggable so a
			 * small element never needs pixel-perfect aiming.
			 */
			var selected = selectedEntry();
			if (selected && selected.item && (selected.item.kind === "text" || selected.item.kind === "graphic") &&
				selected.item.visible !== false &&
				seconds >= selected.item.startSec && seconds < selected.item.startSec + selected.item.durationSec) return selected;
			return null;
		}
		function beginCanvasDrag(event) {
			if (!canvas || !state || isExporting || recorder) return;
			if (event && Number(event.button) > 0) return;
			var point = canvasPointerPoint(event);
			var hit = canvasHitTest(point, state.playheadSec);
			if (!hit) {
				/*
				 * A clip can only be dragged while the playhead is inside its
				 * range, because that is when it is painted. Say so instead of
				 * silently ignoring the pointer.
				 */
				var pending = selectedEntry();
				var pendingItem = pending && pending.item;
				if (pendingItem && (pendingItem.kind === "text" || pendingItem.kind === "graphic") && pendingItem.visible !== false &&
					!(state.playheadSec >= pendingItem.startSec && state.playheadSec < pendingItem.startSec + pendingItem.durationSec)) {
					setStatus("Move the playhead into this clip's time range before dragging it on the canvas.", true);
				}
				return;
			}
			if (String(state.selectedItemId) !== String(hit.item.id)) chooseItem(hit.track, hit.item);
			canvasDrag = {
				id: String(hit.item.id),
				startX: point.x,
				startY: point.y,
				originX: number(hit.item.x, 50),
				originY: number(hit.item.y, hit.item.kind === "graphic" ? 50 : 78),
				width: point.width,
				height: point.height,
				moved: false
			};
			canvas.style.cursor = "grabbing";
			if (event && event.pointerId != null && canvas.setPointerCapture) {
				try { canvas.setPointerCapture(event.pointerId); } catch (error) {}
			}
			if (event && event.preventDefault) event.preventDefault();
		}
		function moveCanvasDrag(event) {
			if (!canvasDrag || !state) return;
			var point = canvasPointerPoint(event);
			var deltaX = ((point.x - canvasDrag.startX) / Math.max(1, canvasDrag.width)) * 100;
			var deltaY = ((point.y - canvasDrag.startY) / Math.max(1, canvasDrag.height)) * 100;
			if (!canvasDrag.moved && Math.abs(deltaX) < 0.15 && Math.abs(deltaY) < 0.15) return;
			var found = findItem(canvasDrag.id);
			if (!found) { canvasDrag = null; return; }
			canvasDrag.moved = true;
			found.item.x = Math.round(clamp(canvasDrag.originX + deltaX, 0, 100) * 10) / 10;
			found.item.y = Math.round(clamp(canvasDrag.originY + deltaY, 0, 100) * 10) / 10;
			state.selectedTrackId = found.track.id;
			state.selectedItemId = found.item.id;
			drawPreview();
			syncPositionControls(found.item);
			if (event && event.preventDefault) event.preventDefault();
		}
		function endCanvasDrag() {
			if (!canvasDrag) return;
			var moved = canvasDrag.moved;
			canvasDrag = null;
			if (canvas) canvas.style.cursor = "";
			if (!moved) return;
			renderInspector();
			persistNow();
		}
		/*
		 * While the pointer moves, the inspector's X and Y controls show the
		 * new percentages. Firing "input" lets the shared range control update
		 * its own readout as well as the model.
		 */
		function syncPositionControls(item) {
			/* The same X/Y control can live in the inspector and in the left child panel. */
			var hosts = [document.getElementById("timeline-inspector"), document.getElementById("timeline-child-editor")];
			if (!item) return;
			hosts.forEach(function (host) {
				if (!host) return;
				["x", "y"].forEach(function (axis) {
					var input = host.querySelector('[data-te-position="' + axis + '"]');
					if (!input) return;
					var value = axis === "x" ? number(item.x, 50) : number(item.y, 78);
					var text = String(Math.round(value * 10) / 10);
					if (String(input.value) === text) return;
					input.value = text;
					try {
						var event = document.createEvent ? document.createEvent("Event") : null;
						if (event) { event.initEvent("input", true, false); input.dispatchEvent(event); }
					} catch (error) {}
				});
			});
		}
		/* A dashed box marks the selected graphic so it reads as draggable. */
		function drawSelectionBox(context, item, width, height) {
			var box = itemBounds(item, width, height);
			if (typeof context.setLineDash === "function") context.setLineDash([6, 4]);
			context.save();
			context.strokeStyle = "#c8f36f";
			context.lineWidth = Math.max(1, width / 720);
			context.strokeRect(box.left, box.top, box.width, box.height);
			context.restore();
			if (typeof context.setLineDash === "function") context.setLineDash([]);
		}

		function previewTick(now) {
			previewFrame = 0;
			if (!state) return;
			if (isPlaying) {
				var elapsed = Math.max(0, Math.min(0.25, (now - previousFrameAt) / 1000));
				state.playheadSec += elapsed;
				if (recorder && recorder.state === "recording") {
					var recPct = state.durationSec > 0 ? clamp((state.playheadSec / state.durationSec) * 100, 0, 99) : 0;
					setExportUi(true, "Exporting " + Math.round(recPct) + "%…", recPct);
				}
				if (state.playheadSec >= state.durationSec) {
					state.playheadSec = state.durationSec;
					setPlaying(false);
					if (recorder && recorder.state !== "inactive") recorder.stop();
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
			document.querySelectorAll('[data-timeline-action="play"]').forEach(function (button) { button.textContent = isPlaying ? "Ⅱ Pause" : "▶ Play"; });
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
			if (action === "undo") { undo(); return; }
			if (action === "redo") { redo(); return; }
			if (action === "export") { exportTimeline(); return; }
			if (action === "play") { if (recorder || isExporting) return; if (!isPlaying && state.playheadSec >= state.durationSec) setPlayhead(0, false); setPlaying(!isPlaying); return; }
			if (action === "restart") { if (recorder || isExporting) return; setPlaying(false); setPlayhead(0, true); return; }
			if (action === "step-back") { if (recorder || isExporting) return; moveScene(-1); return; }
			if (action === "step-forward") { if (recorder || isExporting) return; moveScene(1); return; }
			/*
			 * No toolbar "＋ Lane" button any more: the lane is opened implicitly by
			 * ＋ Text / ＋ Graphic. The action stays wired for older bookmarks and for
			 * window.__TIMELINE_EDITOR__.addVisualTrack().
			 */
			if (action === "add-layer") { addVisualTrack(); return; }
			if (action === "add-text") { addVisualElementFromAction("text"); return; }
			if (action === "add-graphic") { addVisualElementFromAction("graphic"); return; }
			if (action === "add-child-text") { addChildVisualElement("text"); return; }
			if (action === "add-child-graphic") { addChildVisualElement("graphic"); return; }
			if (action === "duplicate") { duplicateSelectedItem(); return; }
			if (action === "delete") { deleteSelectedItem(); return; }
			if (action === "toggle-sound") { state.soundExpanded = !state.soundExpanded; renderTimeline(); scheduleSave(); return; }
			/* TEXT & GRAPHICS folds its lanes exactly like the Soundtrack group does. */
			if (action === "toggle-visuals") { state.visualsExpanded = state.visualsExpanded === false; renderTimeline(); scheduleSave(); return; }
			if (action === "add-media") { var mediaInput = document.getElementById("timeline-media-upload"); if (mediaInput) mediaInput.click(); return; }
			/*
			 * ＋ Add Clips opens the SAME modal as the editor layout's "Add video
			 * from template" link. The picker's own clips-close / clips-clear /
			 * clips-add actions went away with it: #tpl-modal is closed and driven
			 * by TEMPLATE_COMPOSER_JS, and its \u2795 Add button is what appends a
			 * clip here (through window.__TIMELINE_TEMPLATE_CLIP__).
			 */
			if (action === "add-clips") { openTemplateClipsModal(); return; }
			if (action === "toggle-track") {
				var track = findTrack(target.getAttribute("data-track-toggle"));
				if (track) { track.expanded = track.expanded === false; renderTimeline(); scheduleSave(); }
			}
		}
		function seekAt(x, ruler) {
			var pps = Math.max(14, Math.min(48, 1080 / Math.max(20, state.durationSec))) * clamp(state.zoom, 0.5, 2);
			setPlayhead((x - ruler.getBoundingClientRect().left) / pps, true);
		}
		function exportFileSlug() {
			var settings = transition && transition.basicSettings || {};
			var raw = String(settings.title || (state && state.projectId) || "timeline");
			var cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
			return "YouTubeVibeStudio_" + (cleaned || "timeline");
		}
		function setExportUi(active, label, percent) {
			document.querySelectorAll('[data-timeline-action="export"]').forEach(function (button) {
				button.disabled = Boolean(active);
				button.setAttribute("aria-busy", active ? "true" : "false");
				button.textContent = active ? String(label || "Exporting…") : "⬇ Export MP4";
			});
			document.querySelectorAll('[data-timeline-action="play"]').forEach(function (button) {
				button.disabled = Boolean(active);
			});
			var wrap = document.getElementById("timeline-export-progress");
			var bar = document.getElementById("timeline-export-progress-bar");
			if (wrap) {
				wrap.hidden = !active;
				wrap.setAttribute("aria-hidden", active ? "false" : "true");
			}
			if (bar) {
				bar.style.width = (active ? clamp(percent == null ? 0 : percent, 0, 100) : 0).toFixed(1) + "%";
			}
		}
		function downloadExportBlob(blob, fileName, format, mode) {
			var url = URL.createObjectURL(blob);
			var link = document.createElement("a");
			link.href = url;
			link.download = fileName;
			link.style.display = "none";
			if (document.body) document.body.appendChild(link);
			link.click();
			if (link.parentNode) link.parentNode.removeChild(link);
			setTimeout(function () { try { URL.revokeObjectURL(url); } catch (error) {} }, 10000);
			var summary = { fileName: fileName, type: String(blob.type || ""), size: Number(blob.size || 0), format: format, mode: mode, createdAt: Date.now() };
			window.__TIMELINE_LAST_EXPORT__ = summary;
			return summary;
		}
		function seekVideoForExport(video, targetSec, timeoutMs) {
			return new Promise(function (resolve) {
				if (!video) { resolve(); return; }
				var desired = Math.max(0, number(targetSec, 0));
				if (Number.isFinite(video.duration) && video.duration > 0) desired = desired % video.duration;
				if (Math.abs(number(video.currentTime, 0) - desired) <= 0.015 && !video.seeking) { resolve(); return; }
				var done = false;
				var timer = setTimeout(finish, timeoutMs || 900);
				function finish() {
					if (done) return;
					done = true;
					clearTimeout(timer);
					try {
						video.removeEventListener("seeked", finish);
						video.removeEventListener("loadeddata", finish);
						video.removeEventListener("error", finish);
					} catch (error) {}
					resolve();
				}
				try {
					video.addEventListener("seeked", finish);
					video.addEventListener("loadeddata", finish);
					video.addEventListener("error", finish);
					video.currentTime = desired;
				} catch (error) { finish(); }
			});
		}
		function paintTimelineFrameAt(targetCtx, width, height, seconds) {
			targetCtx.clearRect(0, 0, width, height);
			targetCtx.fillStyle = "#08090c";
			targetCtx.fillRect(0, 0, width, height);
			var active = activeMediaAt(seconds);
			var scene = active && active.sceneId ? sceneById(active.sceneId) : null;
			var asset = active && active.assetId ? assetMap[active.assetId] : null;
			var drawn = false;
			if (active && active.visible !== false && asset) {
				targetCtx.save();
				if (window.__videoStyleFilter && "filter" in targetCtx) targetCtx.filter = window.__videoStyleFilter(state.videoStyle);
				if (asset.video) {
					drawn = (asset.video.readyState >= 2 || Number(asset.video.videoWidth || 0) > 0) && drawImageCover(targetCtx, asset.video, width, height, active.fit || "cover");
				} else if (asset.image && (asset.image.complete || Number(asset.image.naturalWidth || 0) > 0)) {
					drawn = drawImageCover(targetCtx, asset.image, width, height, active.fit || "cover");
				}
				targetCtx.restore();
			}
			if (!drawn && active) drawPlaceholder(targetCtx, width, height, scene);
			/* Exported frames carry the same per-scene treatments as the preview. */
			drawStyleEffects(targetCtx, width, height, seconds, scene);
			visualTracks().forEach(function (track) {
				track.items.forEach(function (item) {
					var live = seconds >= item.startSec && seconds < item.startSec + item.durationSec;
					if (!live) return;
					if (item.kind === "graphic" && item.visible !== false) drawGraphic(targetCtx, item, width, height);
					if (item.kind === "text") drawText(targetCtx, item, width, height, false);
				});
			});
			/* The exported frame carries the same burned-in subtitles as the preview. */
			drawTimelineSubtitles(targetCtx, state.subtitles, seconds * 1000, width, height);
		}
		async function mixTimelineAudioForExport(durationSec) {
			var AudioCtx = window.AudioContext || window.webkitAudioContext;
			if (!AudioCtx) return null;
			var clips = [];
			state.tracks.filter(function (track) { return track.kind === "audio"; }).forEach(function (track) {
				track.items.forEach(function (item) {
					if (!item || item.muted || number(item.volume, 1) <= 0) return;
					var asset = item.assetId ? assetMap[item.assetId] : null;
					if (!asset || !asset.blob) return;
					clips.push({ item: item, blob: asset.blob, assetId: String(item.assetId) });
				});
			});
			if (!clips.length) return null;
			var decodeCtx = new AudioCtx();
			var decodedByAsset = Object.create(null);
			try {
				for (var i = 0; i < clips.length; i++) {
					var entry = clips[i];
					if (decodedByAsset[entry.assetId]) continue;
					var rawBuf = await entry.blob.arrayBuffer();
					var decoded = await Promise.race([
						decodeCtx.decodeAudioData(rawBuf.slice(0)),
						new Promise(function (_, reject) { setTimeout(function () { reject(new Error("Audio decode timeout")); }, 15000); })
					]);
					if (decoded) decodedByAsset[entry.assetId] = decoded;
				}
			} finally {
				try { if (typeof decodeCtx.close === "function") await decodeCtx.close(); } catch (error) {}
			}
			var sampleRate = 48000;
			var firstKey = Object.keys(decodedByAsset)[0];
			if (!firstKey) return null;
			sampleRate = clamp(decodedByAsset[firstKey].sampleRate || 48000, 8000, 96000);
			var totalFrames = Math.max(1, Math.ceil(durationSec * sampleRate));
			var OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
			if (typeof OfflineCtx === "function") {
				try {
					var offline = new OfflineCtx(2, totalFrames, sampleRate);
					clips.forEach(function (entry) {
						var buffer = decodedByAsset[entry.assetId];
						if (!buffer || !(buffer.duration > 0)) return;
						var clipStart = clamp(entry.item.startSec, 0, durationSec);
						var clipDur = Math.max(0, Math.min(entry.item.durationSec, durationSec - clipStart));
						if (!(clipDur > 0)) return;
						var src = offline.createBufferSource();
						src.buffer = buffer;
						src.loop = clipDur > buffer.duration + 0.02;
						var gain = offline.createGain();
						gain.gain.value = clamp(entry.item.volume == null ? 1 : entry.item.volume, 0, 1);
						src.connect(gain);
						gain.connect(offline.destination);
						src.start(clipStart, 0, clipDur);
					});
					return await Promise.race([
						offline.startRendering(),
						new Promise(function (_, reject) { setTimeout(function () { reject(new Error("Audio mix timeout")); }, 30000); })
					]);
				} catch (error) {}
			}
			var leftOut = new Float32Array(totalFrames);
			var rightOut = new Float32Array(totalFrames);
			clips.forEach(function (entry) {
				var buffer = decodedByAsset[entry.assetId];
				if (!buffer || !buffer.length) return;
				var vol = clamp(entry.item.volume == null ? 1 : entry.item.volume, 0, 1);
				var startSample = Math.max(0, Math.floor(entry.item.startSec * sampleRate));
				var endSample = Math.min(totalFrames, Math.ceil((entry.item.startSec + entry.item.durationSec) * sampleRate));
				var srcL = buffer.getChannelData(0);
				var srcR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : srcL;
				var ratio = (buffer.sampleRate || sampleRate) / sampleRate;
				for (var dst = startSample; dst < endSample; dst++) {
					var srcIdx = Math.floor((dst - startSample) * ratio) % srcL.length;
					leftOut[dst] = clamp(leftOut[dst] + srcL[srcIdx] * vol, -1, 1);
					rightOut[dst] = clamp(rightOut[dst] + srcR[srcIdx] * vol, -1, 1);
				}
			});
			return {
				sampleRate: sampleRate,
				numberOfChannels: 2,
				length: totalFrames,
				duration: totalFrames / sampleRate,
				getChannelData: function (ch) { return ch === 1 ? rightOut : leftOut; }
			};
		}
		async function encodeTimelineAudioAac(audioBuffer, durationSec, onProgress) {
			var AudioEnc = window.AudioEncoder;
			var AudioFrame = window.AudioData;
			if (!audioBuffer || typeof AudioEnc !== "function" || typeof AudioFrame !== "function") return null;
			var sampleRate = audioBuffer.sampleRate || 48000;
			var channels = Math.min(audioBuffer.numberOfChannels || 1, 2);
			var totalSamples = Math.min(audioBuffer.length, Math.ceil(durationSec * sampleRate));
			if (!(totalSamples > 0)) return null;
			var left = audioBuffer.getChannelData(0);
			var right = channels > 1 ? audioBuffer.getChannelData(1) : left;
			var chunks = [];
			var encodeErr = null;
			var encoder = new AudioEnc({
				output: function (chunk, meta) {
					var bytes = new Uint8Array(chunk.byteLength);
					chunk.copyTo(bytes);
					chunks.push({ bytes: bytes, timestamp: chunk.timestamp, duration: chunk.duration || 0, type: chunk.type, meta: meta });
				},
				error: function (err) { encodeErr = err; }
			});
			try {
				encoder.configure({ codec: "mp4a.40.2", sampleRate: sampleRate, numberOfChannels: channels, bitrate: 160000 });
				var blockSize = 1024;
				for (var offset = 0; offset < totalSamples; offset += blockSize) {
					if (encodeErr) throw encodeErr;
					var count = Math.min(blockSize, totalSamples - offset);
					var pcm = new Int16Array(count * channels);
					for (var s = 0; s < count; s++) {
						var lVal = clamp(left[offset + s], -1, 1);
						pcm[s * channels] = lVal < 0 ? Math.round(lVal * 32768) : Math.round(lVal * 32767);
						if (channels > 1) {
							var rVal = clamp(right[offset + s], -1, 1);
							pcm[s * channels + 1] = rVal < 0 ? Math.round(rVal * 32768) : Math.round(rVal * 32767);
						}
					}
					var audioData = new AudioFrame({
						format: "s16",
						sampleRate: sampleRate,
						numberOfFrames: count,
						numberOfChannels: channels,
						timestamp: Math.round((offset / sampleRate) * 1000000),
						data: pcm
					});
					encoder.encode(audioData);
					audioData.close();
					if (encoder.encodeQueueSize > 24) {
						var waitStart = Date.now();
						while (encoder.encodeQueueSize > 8 && !encodeErr) {
							if (Date.now() - waitStart > 15000) throw new Error("Audio encoder backpressure timeout");
							await new Promise(function (resolve) { setTimeout(resolve, 4); });
						}
					}
					if (onProgress && ((offset / blockSize) % 32 === 0)) onProgress(offset / totalSamples);
				}
				await Promise.race([
					encoder.flush(),
					new Promise(function (_, reject) { setTimeout(function () { reject(new Error("Audio encoder flush timeout")); }, 30000); })
				]);
				if (encodeErr) throw encodeErr;
				return chunks.length ? { chunks: chunks, sampleRate: sampleRate, channels: channels } : null;
			} finally {
				try { if (encoder.state !== "closed") encoder.close(); } catch (error) {}
			}
		}
		function hasWebCodecsMp4Support() {
			var muxerLib = window.Mp4Muxer;
			return typeof window.VideoEncoder === "function" &&
				typeof window.VideoFrame === "function" &&
				Boolean(muxerLib) &&
				typeof muxerLib.Muxer === "function" &&
				typeof muxerLib.ArrayBufferTarget === "function";
		}
		async function exportTimelineMp4() {
			var VideoEnc = window.VideoEncoder;
			var VideoFrm = window.VideoFrame;
			var EncAudioChunk = window.EncodedAudioChunk;
			var muxerLib = window.Mp4Muxer;
			var savedPlayhead = state.playheadSec;
			var fps = 30;
			var durationSec = Math.max(MIN_CLIP_SEC, Math.min(MAX_DURATION_SEC, number(state.durationSec, 5)));
			var exportWidth = Math.max(256, Math.floor(clamp(state.frame && state.frame.width || 1280, 256, 3840) / 2) * 2);
			var exportHeight = Math.max(256, Math.floor(clamp(state.frame && state.frame.height || 720, 256, 3840) / 2) * 2);
			var renderCanvas = document.createElement("canvas");
			renderCanvas.width = exportWidth;
			renderCanvas.height = exportHeight;
			var renderCtx = typeof renderCanvas.getContext === "function" ? renderCanvas.getContext("2d") : null;
			if (!renderCtx && canvas && canvasContext) {
				renderCanvas = canvas;
				renderCtx = canvasContext;
				exportWidth = Math.max(256, Math.floor((canvas.width || 1280) / 2) * 2);
				exportHeight = Math.max(256, Math.floor((canvas.height || 720) / 2) * 2);
			}
			if (!renderCtx) throw new Error("2D canvas context is unavailable for MP4 export.");
			isExporting = true;
			setPlaying(false);
			setExportUi(true, "Preparing MP4…", 2);
			setSaveStatus("Rendering MP4…", false);
			setStatus("Preparing timeline MP4 export…", false);
			var videoEncoder = null;
			try {
				var audioTrack = null;
				try {
					var mixedAudio = await mixTimelineAudioForExport(durationSec);
					if (mixedAudio) {
						setExportUi(true, "Encoding audio…", 6);
						setStatus("Encoding timeline soundtrack (AAC)…", false);
						audioTrack = await encodeTimelineAudioAac(mixedAudio, durationSec, function (fraction) {
							var pct = 6 + fraction * 12;
							setExportUi(true, "Exporting " + Math.round(pct) + "%…", pct);
						});
					}
				} catch (audioError) {
					audioTrack = null;
				}
				var muxerOptions = {
					target: new muxerLib.ArrayBufferTarget(),
					video: { codec: "avc", width: exportWidth, height: exportHeight },
					fastStart: durationSec <= 120 ? "in-memory" : false
				};
				if (audioTrack) {
					muxerOptions.audio = { codec: "aac", sampleRate: audioTrack.sampleRate, numberOfChannels: audioTrack.channels };
				}
				var muxer = new muxerLib.Muxer(muxerOptions);
				var videoEncodeError = null;
				videoEncoder = new VideoEnc({
					output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); },
					error: function (err) { videoEncodeError = err; }
				});
				var bitrate = exportWidth * exportHeight > 921600 ? 5000000 : 2500000;
				var videoConfig = { codec: "avc1.4d002a", width: exportWidth, height: exportHeight, bitrate: bitrate, framerate: fps };
				if (typeof VideoEnc.isConfigSupported === "function") {
					try {
						var check = await VideoEnc.isConfigSupported(videoConfig);
						if (!check || !check.supported) videoConfig.codec = "avc1.42001f";
					} catch (error) {}
				}
				videoEncoder.configure(videoConfig);
				var totalFrames = Math.max(1, Math.ceil(durationSec * fps));
				var frameDurationUs = Math.round(1000000 / fps);
				var audioCursor = 0;
				function drainAudioUpTo(timestampUs) {
					if (!audioTrack || typeof EncAudioChunk !== "function") return;
					while (audioCursor < audioTrack.chunks.length && audioTrack.chunks[audioCursor].timestamp <= timestampUs) {
						var packet = audioTrack.chunks[audioCursor++];
						var encoded = new EncAudioChunk({
							type: packet.type,
							timestamp: packet.timestamp,
							duration: packet.duration,
							data: packet.bytes
						});
						muxer.addAudioChunk(encoded, packet.meta);
					}
				}
				for (var frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
					if (videoEncodeError) throw videoEncodeError;
					var timeSec = Math.min(durationSec - 0.0001, frameIndex / fps);
					var timestampUs = Math.round((frameIndex * 1000000) / fps);
					var activeBg = activeMediaAt(timeSec);
					var bgAsset = activeBg && activeBg.visible !== false && activeBg.assetId ? assetMap[activeBg.assetId] : null;
					if (bgAsset && bgAsset.video) {
						var videoOffset = Math.max(0, timeSec - activeBg.startSec + number(activeBg.trimStartSec, 0));
						await seekVideoForExport(bgAsset.video, videoOffset, 900);
					}
					paintTimelineFrameAt(renderCtx, exportWidth, exportHeight, timeSec);
					var frame = new VideoFrm(renderCanvas, { timestamp: timestampUs, duration: frameDurationUs });
					try {
						videoEncoder.encode(frame, { keyFrame: frameIndex % (fps * 5) === 0 });
					} finally {
						frame.close();
					}
					drainAudioUpTo(timestampUs);
					if (videoEncoder.encodeQueueSize > 12) {
						var bpStart = Date.now();
						while (videoEncoder.encodeQueueSize > 4 && !videoEncodeError) {
							if (Date.now() - bpStart > 15000) throw new Error("Video encoder backpressure timeout");
							await new Promise(function (resolve) { setTimeout(resolve, 4); });
						}
					}
					if (frameIndex % 15 === 0 || frameIndex === totalFrames - 1) {
						var pct = 18 + ((frameIndex + 1) / totalFrames) * 78;
						setExportUi(true, "Exporting " + Math.round(pct) + "%…", pct);
						setSaveStatus("Rendering MP4 · " + Math.round(pct) + "%", false);
						setStatus("Rendering MP4 frame " + (frameIndex + 1) + " / " + totalFrames + "…", false);
						await new Promise(function (resolve) { setTimeout(resolve, 0); });
					}
				}
				setExportUi(true, "Finalizing MP4…", 98);
				await Promise.race([
					videoEncoder.flush(),
					new Promise(function (_, reject) { setTimeout(function () { reject(new Error("Video encoder flush timeout")); }, 180000); })
				]);
				if (videoEncodeError) throw videoEncodeError;
				drainAudioUpTo(Number.MAX_SAFE_INTEGER);
				muxer.finalize();
				var mp4Buffer = muxer.target.buffer;
				if (!mp4Buffer || !mp4Buffer.byteLength) throw new Error("Muxer produced an empty MP4 buffer.");
				var mp4Blob = new Blob([mp4Buffer], { type: "video/mp4" });
				var fileName = exportFileSlug() + ".mp4";
				downloadExportBlob(mp4Blob, fileName, "mp4", "webcodecs");
				setSaveStatus("MP4 exported", false);
				setStatus("Export complete · downloaded " + fileName + ".", false);
				return { ok: true, format: "mp4", mode: "webcodecs", fileName: fileName, size: mp4Blob.size };
			} finally {
				try { if (videoEncoder && videoEncoder.state !== "closed") videoEncoder.close(); } catch (error) {}
				isExporting = false;
				setExportUi(false, "", 0);
				state.playheadSec = clamp(savedPlayhead, 0, state.durationSec);
				updatePlayhead();
				drawPreview();
			}
		}
		function exportTimelineMediaRecorder() {
			return new Promise(function (resolve) {
				var RecorderCtor = window.MediaRecorder;
				if (!canvas || !canvas.captureStream || typeof RecorderCtor !== "undefined" && typeof RecorderCtor !== "function" || typeof RecorderCtor === "undefined") {
					setSaveStatus("Export unavailable", true);
					setStatus("Video export is not supported by this browser.", true);
					resolve({ ok: false, reason: "unsupported" });
					return;
				}
				var destination = null;
				var stream = null;
				try {
					setPlaying(false);
					setPlayhead(0, false);
					stream = canvas.captureStream(30);
					var AudioCtx = window.AudioContext || window.webkitAudioContext;
					if (AudioCtx) {
						if (!exportAudioContext) exportAudioContext = new AudioCtx();
						destination = exportAudioContext.createMediaStreamDestination();
						state.tracks.filter(function (track) { return track.kind === "audio"; }).forEach(function (track) {
							track.items.forEach(function (item) {
								var asset = assetMap[item.assetId];
								if (!asset || !asset.url) return;
								var audio = audioMap[item.id] || (audioMap[item.id] = new Audio(asset.url));
								var source = audioSources[item.id];
								if (!source) {
									source = exportAudioContext.createMediaElementSource(audio);
									source.connect(exportAudioContext.destination);
									audioSources[item.id] = source;
								}
								source.connect(destination);
							});
						});
						destination.stream.getAudioTracks().forEach(function (track) { stream.addTrack(track); });
						if (typeof exportAudioContext.resume === "function") exportAudioContext.resume();
					}
					var preferredType = "";
					if (typeof RecorderCtor.isTypeSupported === "function") {
						["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].some(function (candidate) {
							if (RecorderCtor.isTypeSupported(candidate)) { preferredType = candidate; return true; }
							return false;
						});
					}
					var chunks = [];
					recorder = preferredType ? new RecorderCtor(stream, { mimeType: preferredType }) : new RecorderCtor(stream);
					recorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
					recorder.onerror = function (event) {
						if (stream) stream.getTracks().forEach(function (track) { try { track.stop(); } catch (error) {} });
						if (destination) Object.keys(audioSources).forEach(function (id) { try { audioSources[id].disconnect(destination); } catch (error) {} });
						recorder = null;
						setExportUi(false, "", 0);
						var message = String(event && event.error && event.error.message || "Recording error");
						setSaveStatus("Export failed", true);
						setStatus("Export failed: " + message, true);
						resolve({ ok: false, reason: message });
					};
					recorder.onstop = function () {
						var activeRecorder = recorder;
						var type = (activeRecorder && activeRecorder.mimeType) || preferredType || "video/webm";
						var ext = type.indexOf("mp4") >= 0 ? "mp4" : "webm";
						var outBlob = new Blob(chunks, { type: type });
						var fileName = exportFileSlug() + "." + ext;
						downloadExportBlob(outBlob, fileName, ext, "mediarecorder");
						if (stream) stream.getTracks().forEach(function (track) { try { track.stop(); } catch (error) {} });
						if (destination) Object.keys(audioSources).forEach(function (id) { try { audioSources[id].disconnect(destination); } catch (error) {} });
						recorder = null;
						setExportUi(false, "", 0);
						setSaveStatus("Export complete", false);
						setStatus("Export complete · downloaded " + fileName + ".", false);
						resolve({ ok: true, format: ext, mode: "mediarecorder", fileName: fileName, size: outBlob.size });
					};
					setExportUi(true, "Exporting 0%…", 0);
					setSaveStatus("Recording export…", false);
					setStatus("Exporting in real time; keep this tab open.", false);
					recorder.start();
					setPlaying(true);
				} catch (error) {
					if (stream) stream.getTracks().forEach(function (track) { try { track.stop(); } catch (err) {} });
					recorder = null;
					setExportUi(false, "", 0);
					var reason = String(error && error.message || error);
					setSaveStatus("Export failed", true);
					setStatus("Export failed: " + reason, true);
					resolve({ ok: false, reason: reason });
				}
			});
		}
		async function exportTimeline() {
			if (!state || recorder || isExporting) return { ok: false, reason: "busy" };
			if (hasWebCodecsMp4Support()) {
				try {
					return await exportTimelineMp4();
				} catch (error) {
					var reason = String(error && error.message || error);
					setSaveStatus("Export failed", true);
					setStatus("Export failed: " + reason, true);
					return { ok: false, reason: reason };
				}
			}
			return await exportTimelineMediaRecorder();
		}
		function bindEvents() {
			var root = document.getElementById("timeline-editor");
			var grid = document.getElementById("timeline-track-grid");
			if (!root || !grid) return;
			root.addEventListener("click", function (event) {
				var actionNode = event.target && event.target.closest ? event.target.closest("[data-timeline-action]") : null;
				if (actionNode) { handleAction(actionNode.getAttribute("data-timeline-action"), actionNode); return; }
				/*
				 * The clip picker's own card / backdrop dismissal is gone with the
				 * picker: #tpl-modal handles its cards, its backdrop click and its
				 * Escape key inside TEMPLATE_COMPOSER_JS.
				 */
				var trackToggle = event.target && event.target.closest ? event.target.closest("[data-track-toggle]") : null;
				if (trackToggle) { handleAction("toggle-track", trackToggle); return; }
				var trackNode = event.target && event.target.closest ? event.target.closest("[data-track-select]") : null;
				if (trackNode) { chooseTrack(findTrack(trackNode.getAttribute("data-track-select"))); return; }
				/*
				 * The left child panel: a row selects one of the background's
				 * children, its ✕ deletes that child.
				 */
				var childDelete = event.target && event.target.closest ? event.target.closest("[data-child-delete-id]") : null;
				if (childDelete) {
					var doomed = findItem(childDelete.getAttribute("data-child-delete-id"));
					if (doomed) { chooseItem(doomed.track, doomed.item); deleteSelectedItem(); }
					return;
				}
				var childRow = event.target && event.target.closest ? event.target.closest("[data-child-id]") : null;
				if (childRow) {
					var childFound = findItem(childRow.getAttribute("data-child-id"));
					if (childFound) chooseItem(childFound.track, childFound.item);
					return;
				}
				var clip = event.target && event.target.closest ? event.target.closest("[data-clip-id]") : null;
				if (clip) {
					if (suppressClick) { suppressClick = false; return; }
					var found = findItem(clip.getAttribute("data-clip-id"));
					if (found) chooseItem(found.track, found.item);
				}
			});
			/*
			 * The child rows in the left panel are keyboard reachable: Enter or
			 * Space selects the child, exactly like a click.
			 */
			root.addEventListener("keydown", function (event) {
				if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
				var rowNode = event.target && event.target.closest ? event.target.closest("[data-child-id]") : null;
				if (!rowNode) return;
				var foundChild = findItem(rowNode.getAttribute("data-child-id"));
				if (!foundChild) return;
				if (event.preventDefault) event.preventDefault();
				chooseItem(foundChild.track, foundChild.item);
			});
			/*
			 * Undo / redo keyboard shortcuts. Ctrl/Cmd+Z steps back,
			 * Ctrl/Cmd+Shift+Z (and Ctrl+Y) steps forward. A shortcut typed
			 * inside a text field keeps the browser's native text undo.
			 */
			document.addEventListener("keydown", function (event) {
				if (!state || isExporting || recorder) return;
				var key = String(event.key || "").toLowerCase();
				if (key !== "z" && key !== "y") return;
				if (!(event.ctrlKey || event.metaKey)) return;
				var target = event.target;
				var tag = String(target && target.tagName || "").toLowerCase();
				if (tag === "input" || tag === "textarea" || tag === "select" || target && target.isContentEditable) return;
				if (event.preventDefault) event.preventDefault();
				if (key === "y") redo();
				else if (event.shiftKey) redo();
				else undo();
			});
			var scrollEl = document.getElementById("timeline-scroll");
			if (scrollEl) {
				scrollEl.addEventListener("scroll", function () {
					grid.setAttribute("data-scrolled", scrollEl.scrollLeft > 2 ? "1" : "0");
				}, { passive: true });
			}
			grid.addEventListener("click", function (event) {
				if (isExporting || recorder) return;
				var lane = event.target && event.target.closest ? event.target.closest("[data-lane-track]") : null;
				if (!lane || (event.target.closest && (event.target.closest("[data-clip-id]") || event.target.closest("[data-track-select]")))) return;
				var rect = lane.getBoundingClientRect();
				var pps = Math.max(14, Math.min(48, 1080 / Math.max(20, state.durationSec))) * clamp(state.zoom, 0.5, 2);
				setPlayhead((event.clientX - rect.left) / pps, true);
			});
			grid.addEventListener("pointerdown", function (event) {
				if (isExporting || recorder) return;
				var seekerHandle = event.target && event.target.closest && event.target.closest("[data-playhead-handle]");
				var ruler = (seekerHandle && grid.querySelector(".te-ruler")) || (event.target && event.target.closest && event.target.closest(".te-ruler"));
				var scrollLane = event.target && event.target.closest && event.target.closest("[data-scroll-lane]");
				if (ruler) {
					activeDrag = { mode: "seek" };
					seekAt(event.clientX, ruler);
					if (event.pointerId != null && ruler.setPointerCapture) {
						try { ruler.setPointerCapture(event.pointerId); } catch (error) {}
					}
					event.preventDefault();
					return;
				}
				if (scrollLane) { activeDrag = { mode: "scroll", startX: event.clientX, scrollLeft: document.getElementById("timeline-scroll").scrollLeft }; event.preventDefault(); return; }
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
				/* A canvas drag outlives the pointer leaving the canvas element. */
				if (canvasDrag) { moveCanvasDrag(event); return; }
				if (!activeDrag) return;
				if (activeDrag.mode === "seek") { var ruler = grid.querySelector(".te-ruler"); if (ruler) seekAt(event.clientX, ruler); return; }
				if (activeDrag.mode === "scroll") { document.getElementById("timeline-scroll").scrollLeft = activeDrag.scrollLeft - (event.clientX - activeDrag.startX); return; }
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
			/*
			 * Preview canvas: click to select a text or graphic clip, then drag
			 * it to set its X/Y percentages. Pointer capture keeps the drag
			 * alive when the cursor leaves the canvas; the document-level
			 * pointerup below is the safety net.
			 */
			if (canvas) {
				canvas.addEventListener("pointerdown", function (event) { beginCanvasDrag(event); });
				canvas.addEventListener("pointermove", function (event) {
					if (canvasDrag) { moveCanvasDrag(event); return; }
					if (!state || isExporting || recorder || !canvas.getBoundingClientRect) return;
					var hover = canvasHitTest(canvasPointerPoint(event), state.playheadSec);
					canvas.style.cursor = hover ? "grab" : "";
				});
				canvas.addEventListener("pointerup", function () { endCanvasDrag(); });
				canvas.addEventListener("pointercancel", function () { endCanvasDrag(); });
			}
			document.addEventListener("pointerup", function () {
				if (canvasDrag) endCanvasDrag();
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
			/*
			 * Session 332: the picker's own upload control and Escape handler
			 * went away with the picker. In their place this page registers the
			 * sink the "Add video from template" composer calls when its
			 * \u2795 Add button renders an MP4, so the composed clip lands at the
			 * right-most end of the Scene Media layer. The registration happens
			 * inside bindEvents(), which only runs on layout=timeline, so the
			 * editor layout's composer keeps adding to its Video N gallery.
			 */
			window.__TIMELINE_TEMPLATE_CLIP__ = function (clip) { return appendTemplateClip(clip); };
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
			var detail = state && state.projectDetail || {};
			var effects = effectLabel(detail.effects || state && state.videoStyleEffects || []);
			if (title) title.textContent = settings.title ? String(settings.title) : "Timeline editor";
			if (subtitle) {
				/*
				 * The project detail line names the row style that came in with
				 * the Edit handoff and the template-modal effects resolved from
				 * it, so the style is visible project data, not hidden state.
				 */
				subtitle.textContent = "Quick Batch row " + String(settings.id || detail.rowId || "") +
					" · " + state.scenes.length + " scenes · " +
					String(state.videoStyle || "Cinematic Film") + " style" +
					(effects ? " · " + effects : "") +
					" · browser-only timing";
			}
		}

		function boot() {
			var app = document.getElementById("studio-app");
			if (app) app.classList.add("timeline-mode");
			if (document.body) document.body.classList.add("timeline-editor-page");
			var galleryEl = document.getElementById("gallery");
			if (galleryEl) {
				galleryEl.hidden = true;
				galleryEl.style.display = "none";
				galleryEl.innerHTML = "";
			}
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
			if (canvas) {
				canvas.width = clamp(state.frame.width, 256, 3840);
				canvas.height = clamp(state.frame.height, 256, 3840);
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
			/*
			 * The loaded (and just normalised) project is the first history
			 * state, so opening a project never offers an undo of its own
			 * normalisation.
			 */
			resetHistory();
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
		/* Duplicate the selected clip into the slot right after the original. */
		api.duplicateSelectedItem = function () { return state ? duplicateSelectedItem() : null; };
		/* Add a child text/graphic bound to a background clip (or the selected one). */
		api.addChildElement = function (kind) { return state ? addChildVisualElement(kind === "graphic" ? "graphic" : "text") : null; };
		api.getBackgroundContext = function () { return state ? backgroundContext() : null; };
		api.getChildElements = function (parentId) {
			if (!state) return [];
			var parent = parentId ? findItem(parentId) : null;
			var parentItem = parent && parent.item ? parent.item : backgroundContext();
			return parentItem ? childItemsFor(parentItem).map(function (entry) { return entry.item; }) : [];
		};
		api.setItemTiming = setItemTiming;
		/* Undo / redo of the editable project data, exposed for tests and tooling. */
		api.undo = function () { return state ? undo() : false; };
		api.redo = function () { return state ? redo() : false; };
		api.getHistory = function () { return { undo: historyUndo.length, redo: historyRedo.length }; };
		/* The row's project detail (style + template-modal effects) is inspectable. */
		api.getProjectDetail = function () { return state ? state.projectDetail : null; };
		api.getStyleEffects = function (style) { return styleEffectsFor(style); };
		api.save = persistNow;
		api.addMediaFiles = addMediaFiles;
		api.addAudioFile = addAudioFile;
		/*
		 * ＋ Add Clips — the "Add video from template" composer. The queue lives
		 * outside state (it is a pending hand-off, not an edit), so every entry
		 * below is a plain helper the composer — and a test — can drive.
		 */
		api.openClipsModal = function () { return openTemplateClipsModal(); };
		api.appendTemplateClip = function (clip) { return appendTemplateClip(clip); };
		api.getClipsQueue = function () { return clipsQueue.slice(); };
		api.appendQueuedClips = function () { return state ? appendQueuedClips() : 0; };
		/* Placement of a new text/graphic: the first window nothing else occupies. */
		api.freeVisualWindow = function (duration) { return state ? freeVisualWindow(duration == null ? 4 : duration) : null; };
		api.occupiedVisualWindows = function () { return state ? occupiedVisualWindows() : []; };
		api.exportTimeline = exportTimeline;
		api.booted = true;

		boot();
	})();
`;
