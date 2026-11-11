/*
 * APP_JS — the main YouTube Vibe Studio client script
 * (MODULES 1-9: video projects, gallery, queue, AI panel,
 * quick-batch table, plain narration script, voiceover and the
 * client-side render engine. The AI script is plain spoken text
 * end to end: no subtitle format exists anywhere in this file.
 *
 * __PROMPTS_JSON__ is replaced by page.ts with
 * JSON.stringify(prompts) — the only server-side
 * interpolation in the whole page.
 *
 * Verbatim copy of the old inline script; the escapes
 * (\`, \${, \\u...) are intentional — do not reformat.
 */

import { PIXABAY_DIRECT_JS } from "./pixabay-direct";
import { BROWSER_OFFLOAD_JS } from "./browser-offload";
import { BROWSER_USAGE_JS } from "./usage-ledger";
import { PROGRESSIVE_IMAGE_PIPELINE_JS } from "./progressive-image-pipeline";
import { SCRIPT_NOTES_CLIENT_JS } from "./script-notes-client";
import { PIPELINE_MANAGEMENT_STORE_JS } from "./pipeline-management-store";

export const APP_JS = `
${PIXABAY_DIRECT_JS}
${BROWSER_OFFLOAD_JS}
${BROWSER_USAGE_JS}
${PROGRESSIVE_IMAGE_PIPELINE_JS}
${SCRIPT_NOTES_CLIENT_JS}
${PIPELINE_MANAGEMENT_STORE_JS}
	/*
	 * Browser-side note memory (localStorage → cookie → in-page map).
	 * See src/client/script-notes-client.ts and current_code_latest.md.
	 */
	const scriptNoteMemory =
		createScriptNoteMemory(window);

	/*
	 * Both layouts now manage their pipeline bookkeeping in the browser:
	 * localStorage is the full management snapshot and the cookie is its
	 * compact digest-verified mirror. Media bytes and object URLs stay in
	 * memory only.
	 */
	/*
	 * Bug Fix Session 331: every tab owns one localStorage page. Four cookie
	 * chunks carry the full snapshot; no TTL, only timestamp+digest matching.
	 */
	let pipelineManagementSaving =
		false;

	let pipelineManagementRestoring =
		false;

	function pipelineManagementLayout() {
		let name = "editor";
		try {
			if (studioLayout === "table" || studioLayout === "editor") name = studioLayout;
		} catch (layoutError) { }
		return name;
	}

	function pipelineManagementNumber(value, fallback) {
		const n = Number(value);
		return Number.isFinite(n) ? n : fallback;
	}

	function ensurePipelineVideoIds() {
		const pageId = pipelineManagementStore.pageId;
		try {
			for (const row of batchRows) {
				if (!row.vid) row.vid = pageId + "-row-" + String(row.id);
			}
		} catch (batchError) { }
		try {
			videoProjects.forEach(function (project, index) {
				if (!project._pipelineVid) project._pipelineVid = pageId + "-editor-" + String(index + 1);
			});
		} catch (editorError) { }
	}

	const BATCH_TIMELINE_STATE_PREFIX =
		"ytvs.timeline-editor.v1.";

	const BATCH_TIMELINE_COOKIE_PREFIX =
		"ytvs_timeline_editor_";

	const BATCH_TIMELINE_COOKIE_CHUNKS =
		8;

	function batchTimelineSafeId(value) {
		return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
	}

	function deleteBatchCookie(name) {
		if (!name || typeof window === "undefined" || !window.document) return;
		try {
			window.document.cookie = name + "=; Max-Age=0; Path=/; SameSite=Lax";
			window.document.cookie = name + "=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax";
		} catch (error) { }
	}

	function batchTimelinePageIdForRow(rowOrId, explicitKey) {
		const rawKey = String(
			explicitKey ||
			(rowOrId && typeof rowOrId === "object" ? (rowOrId.timelineKey || (rowOrId.timeline && rowOrId.timeline.key) || (rowOrId.timeline && rowOrId.timeline.pageId) || (rowOrId.projectDetail && rowOrId.projectDetail.targetPageId)) : "") ||
			""
		);
		if (rawKey.indexOf(BATCH_TIMELINE_STATE_PREFIX) === 0) {
			return rawKey.slice(BATCH_TIMELINE_STATE_PREFIX.length);
		}
		if (rawKey && rawKey.indexOf(".") === -1) return rawKey;
		const id = rowOrId && typeof rowOrId === "object" ? rowOrId.id : rowOrId;
		if (id == null || String(id).trim() === "") return "";
		return ("timeline-" + String(pipelineManagementStore.pageId || "local") + "-row-" + String(id)).replace(/[^a-zA-Z0-9_-]/g, "");
	}

	function readTimelineCookiesForPageId(targetPageId) {
		try {
			if (!targetPageId || typeof window === "undefined" || !window.document) return null;
			const safePage = batchTimelineSafeId(targetPageId);
			const prefix = BATCH_TIMELINE_COOKIE_PREFIX + safePage + "_";
			const parts = String(window.document.cookie || "").split(";");
			const metas = [];
			let total = 0;
			for (const part of parts) {
				const entry = part.trim();
				const equal = entry.indexOf("=");
				if (equal < 0) continue;
				const name = entry.slice(0, equal);
				if (name.indexOf(prefix) !== 0) continue;
				const meta = JSON.parse(decodeURIComponent(entry.slice(equal + 1)));
				if (!meta || meta.v !== 1 || meta.p !== safePage) return null;
				if (!total) total = Number(meta.n) || 0;
				if (Number(meta.n) !== total) return null;
				metas.push(meta);
			}
			if (!total || metas.length !== total) return null;
			metas.sort(function (a, b) { return a.i - b.i; });
			const ts = metas[0].t;
			const hash = metas[0].h;
			let joined = "";
			for (let i = 0; i < metas.length; i++) {
				if (metas[i].i !== i + 1 || metas[i].t !== ts || metas[i].h !== hash) return null;
				joined += String(metas[i].d || "");
			}
			const parsed = JSON.parse(joined);
			return parsed && parsed.projectId === targetPageId ? parsed : null;
		} catch (error) {
			return null;
		}
	}

	function readTimelineEditorStateForRow(row) {
		if (!row) return null;
		const targetPageId = batchTimelinePageIdForRow(row);
		if (!targetPageId) return null;
		let localState = null;
		try {
			localState = JSON.parse(window.localStorage.getItem(BATCH_TIMELINE_STATE_PREFIX + targetPageId) || "null");
			if (!localState || localState.projectId !== targetPageId) localState = null;
		} catch (error) { localState = null; }
		const cookieState = readTimelineCookiesForPageId(targetPageId);
		if (localState && cookieState) {
			return Number(cookieState.updatedAt || 0) > Number(localState.updatedAt || 0) ? cookieState : localState;
		}
		return localState || cookieState || null;
	}

	function composeTimelineSummaryFromState(timelineState, row) {
		if (!timelineState || typeof timelineState !== "object") return null;
		const tracks = Array.isArray(timelineState.tracks) ? timelineState.tracks : [];
		const mediaTrack = tracks.find(function (track) { return track && (track.id === "background-media" || track.kind === "media"); }) || null;
		const mediaItems = (mediaTrack && Array.isArray(mediaTrack.items) ? mediaTrack.items : [])
			.slice()
			.sort(function (a, b) { return pipelineManagementNumber(a && a.startSec, 0) - pipelineManagementNumber(b && b.startSec, 0); });
		const scenesList = Array.isArray(timelineState.scenes) ? timelineState.scenes : [];
		const entries = [];
		const sceneItems = [];
		mediaItems.forEach(function (item, idx) {
			if (!item) return;
			let mediaIndex = trailingDigits(item.sceneId);
			if (mediaIndex < 0) mediaIndex = trailingDigits(item.assetId);
			if (mediaIndex > 0) mediaIndex -= 1;
			else if (mediaIndex === 0) mediaIndex = -1;
			const scene = scenesList.find(function (candidate) { return String(candidate && candidate.id || "") === String(item.sceneId || ""); }) || scenesList[idx] || null;
			const mediaType = String(item.mediaType || (scene && scene.mediaType) || "image");
			const typeCode = mediaType === "video" ? 1 : mediaType === "gif" ? 2 : 0;
			const startSec = Math.round(Math.max(0, pipelineManagementNumber(item.startSec, 0)) * 1000) / 1000;
			const durationSec = Math.round(Math.max(0.1, pipelineManagementNumber(item.durationSec, 1)) * 1000) / 1000;
			entries.push([mediaIndex, durationSec, typeCode]);
			const sceneRec = {
				id: String(item.sceneId || (scene && scene.id) || ("scene-" + (idx + 1))),
				slideId: String(item.id || ("slide-" + (idx + 1))),
				i: mediaIndex,
				a: String(item.assetId || (scene && scene.mediaAssetId) || ""),
				n: String((scene && scene.name) || item.label || ("Scene " + (idx + 1))).slice(0, 60),
				m: String(item.label || (scene && scene.mediaName) || "").slice(0, 60),
				src: String(item.mediaSource || (scene && scene.mediaSource) || "").slice(0, 24),
				t: typeCode,
				s: startSec,
				d: durationSec,
				tr: Math.round(Math.max(0, pipelineManagementNumber(item.trimStartSec, 0)) * 1000) / 1000,
				f: item.fit === "contain" ? 1 : 0,
				v: item.visible === false ? 0 : 1
			};
			const isTplScene = Boolean(item.isTemplateScene || item.templateScene || (scene && scene.isTemplateScene) || sceneRec.src === "template composer");
			if (isTplScene) {
				sceneRec.tpl = 1;
				const sStyle = String(item.videoStyle || (scene && scene.videoStyle) || "");
				const sCode = String(item.style || (scene && scene.style) || "");
				if (sStyle) sceneRec.st = sStyle.slice(0, 40);
				if (sCode) sceneRec.sc = sCode.slice(0, 24);
				const sEff = Array.isArray(item.effects) ? item.effects : (scene && Array.isArray(scene.effects) ? scene.effects : null);
				if (Array.isArray(sEff)) sceneRec.ef = sEff.slice(0, 4);
				const sTrn = item.transition || (scene && scene.transition) || null;
				if (sTrn && typeof sTrn === "object") {
					sceneRec.trn = {
						type: String(sTrn.type || "none").slice(0, 20),
						speed: pipelineManagementNumber(sTrn.speed, 1),
						effect: String(sTrn.effect || "none").slice(0, 20),
						motionSpeed: pipelineManagementNumber(sTrn.motionSpeed, 1)
					};
				}
			}
			sceneItems.push(sceneRec);
		});
		const visuals = [];
		const audios = [];
		tracks.forEach(function (track) {
			if (!track || !Array.isArray(track.items)) return;
			if (track.kind === "visual") {
				track.items.forEach(function (item) {
					if (!item) return;
					const visRec = {
						id: String(item.id || ""),
						k: item.kind === "graphic" ? "g" : "t",
						lb: String(item.label || "").slice(0, 40),
						trId: String(track.id || ""),
						scId: String(item.sceneId || ""),
						pId: String(item.parentId || ""),
						s: Math.round(Math.max(0, pipelineManagementNumber(item.startSec, 0)) * 1000) / 1000,
						d: Math.round(Math.max(0.1, pipelineManagementNumber(item.durationSec, 1)) * 1000) / 1000,
						x: pipelineManagementNumber(item.x, 50),
						y: pipelineManagementNumber(item.y, item.kind === "graphic" ? 50 : 78),
						sz: item.kind === "graphic" ? pipelineManagementNumber(item.size, 72) : pipelineManagementNumber(item.fontSize, 28),
						c: String(item.color || ""),
						v: item.visible === false ? 0 : 1,
						tx: item.kind === "text" ? String(item.text || "").slice(0, 120) : undefined,
						fn: item.kind === "text" && item.font ? String(item.font) : undefined,
						al: item.kind === "text" && item.align ? String(item.align) : undefined,
						gr: item.kind === "graphic" ? String(item.graphic || "circle") : undefined
					};
					if (item.transition && item.transition !== "none") visRec.trn = String(item.transition).slice(0, 20);
					if (item.transitionSpeed != null && pipelineManagementNumber(item.transitionSpeed, 1) !== 1) visRec.ts = pipelineManagementNumber(item.transitionSpeed, 1);
					if (item.anim && item.anim !== "none") visRec.an = String(item.anim).slice(0, 24);
					if (item.speed != null && pipelineManagementNumber(item.speed, 1) !== 1) visRec.sp = pipelineManagementNumber(item.speed, 1);
					if (item.style) visRec.st = String(item.style).slice(0, 24);
					if (item.rotation) visRec.rot = pipelineManagementNumber(item.rotation, 0);
					if (item.layerOrder != null) visRec.lo = pipelineManagementNumber(item.layerOrder, 0);
					if (item.dummy) visRec.dm = 1;
					if (item.bakedInTemplateClip) visRec.bk = 1;
					visuals.push(visRec);
				});
			} else if (track.kind === "audio") {
				track.items.forEach(function (item) {
					if (!item) return;
					audios.push({
						id: String(item.id || ""),
						trId: String(track.id || ""),
						a: String(item.assetId || ""),
						n: String(item.label || "").slice(0, 50),
						s: Math.round(Math.max(0, pipelineManagementNumber(item.startSec, 0)) * 1000) / 1000,
						d: Math.round(Math.max(0.1, pipelineManagementNumber(item.durationSec, 1)) * 1000) / 1000,
						vol: pipelineManagementNumber(item.volume, 1),
						m: item.muted ? 1 : 0
					});
				});
			}
		});
		const pageId = String(timelineState.projectId || batchTimelinePageIdForRow(row) || "");
		const totalDuration = Math.round(Math.max(0, pipelineManagementNumber(timelineState.durationSec, 0)) * 1000) / 1000;
		return {
			v: 1,
			updatedAt: pipelineManagementNumber(timelineState.updatedAt, Date.now()),
			key: pageId ? BATCH_TIMELINE_STATE_PREFIX + pageId : String(row && row.timelineKey || ""),
			pageId: pageId,
			sourcePageId: String(timelineState.sourcePageId || pipelineManagementStore.pageId || ""),
			rowId: String(timelineState.sourceRowId || (row && row.id) || ""),
			vid: String(timelineState.sourceVid || (row && row.vid) || ""),
			durationSec: totalDuration,
			sceneCount: entries.length,
			clipCount: entries.filter(function (entry) { return entry[2] === 1; }).length,
			textCount: visuals.length,
			videoStyle: String(timelineState.videoStyle || (row && row.style) || ""),
			frame: timelineState.frame || { width: 0, height: 0 },
			scenes: entries,
			sceneItems: sceneItems,
			visuals: visuals,
			audios: audios,
			projectDetail: timelineState.projectDetail && typeof timelineState.projectDetail === "object"
				? Object.assign({}, timelineState.projectDetail)
				: undefined
		};
	}

	function batchRowHasCompletedImages(row) {
		if (!row) return false;
		const images = Array.isArray(row.images) ? row.images : [];
		if (images.length >= AUTO_MEDIA_TOTAL) return true;
		if (row.timelineEdited && images.length > 0) return true;
		if (Number(row._storedImagesCount) >= AUTO_MEDIA_TOTAL) return true;
		if (row.projectDetail && row.projectDetail.hasCompletedMedia) return true;
		if (row._storedFinished && Number(row._storedImagesCount) > 0) return true;
		return false;
	}

	function batchRowTimelineUpdatedAt(row) {
		if (!row) return 0;
		return Math.max(
			0,
			Number(row.timelineUpdatedAt) || 0,
			Number(row.timeline && row.timeline.updatedAt) || 0
		);
	}

	function batchRowTimelinePendingRegen(row) {
		if (!row || !row.timelineEdited) return false;
		const updatedAt = batchRowTimelineUpdatedAt(row);
		if (!updatedAt) return false;
		const regeneratedAt = Number(row._timelineRegeneratedAt) || 0;
		return updatedAt > regeneratedAt;
	}

	function composeBatchSlideItems(row) {
		if (!row) return [];
		const slides = Array.isArray(row.slides) ? row.slides : [];
		if (slides.length) {
			let cursor = 0;
			return slides.map(function (slide, idx) {
				const dur = Math.round(Math.max(0.1, slideDurationSec(slide)) * 1000) / 1000;
				const startSec = slide && slide.startSec != null ? Math.round(Math.max(0, Number(slide.startSec) || 0) * 1000) / 1000 : Math.round(cursor * 1000) / 1000;
				cursor = startSec + dur;
				const namedIdx = Number.isInteger(slide && slide.imageIndex)
					? Number(slide.imageIndex)
					: (Number.isInteger(slide && slide.mediaIndex) ? Number(slide.mediaIndex) : trailingDigits(slide && slide.id));
				const typeCode = slide && slide.type === "mp4" ? 1 : (slide && slide.type === "gif" ? 2 : 0);
				const out = {
					id: String(slide && slide.sceneId || ("scene-" + (idx + 1))),
					slideId: String(slide && slide.id || ("slide-" + (idx + 1))),
					i: namedIdx,
					a: String(slide && slide.assetId || (namedIdx >= 0 ? "scene-" + (namedIdx + 1) : "")),
					n: String(slide && slide.name || ("Scene " + (idx + 1))).slice(0, 60),
					t: typeCode,
					s: startSec,
					d: dur,
					tr: Math.round(Math.max(0, Number(slide && slide.trimStartSec) || 0) * 1000) / 1000,
					f: slide && slide.fit === "contain" ? 1 : 0,
					v: slide && slide.visible === false ? 0 : 1
				};
				if (slide && slide.mediaName) out.m = String(slide.mediaName).slice(0, 60);
				if (slide && slide.mediaSource) out.src = String(slide.mediaSource).slice(0, 32);
				const isTplSlide = Boolean(slide && (slide.isTemplateScene || String(slide.mediaSource || "") === "template composer"));
				if (isTplSlide) {
					out.tpl = 1;
					if (slide.videoStyle) out.st = String(slide.videoStyle).slice(0, 40);
					if (slide.style) out.sc = String(slide.style).slice(0, 24);
					if (Array.isArray(slide.effects) && slide.effects.length) out.ef = slide.effects.slice(0, 6);
				}
				if (slide && slide.transition && typeof slide.transition === "object" && (isTplSlide || (slide.transition.type && slide.transition.type !== "none"))) {
					out.trn = {
						type: String(slide.transition.type || "none").slice(0, 20),
						speed: pipelineManagementNumber(slide.transition.speed, 1),
						effect: String(slide.transition.effect || "none").slice(0, 20),
						motionSpeed: pipelineManagementNumber(slide.transition.motionSpeed, 1)
					};
				}
				return out;
			});
		}
		if (row.timeline && Array.isArray(row.timeline.sceneItems) && row.timeline.sceneItems.length) {
			return row.timeline.sceneItems.slice();
		}
		if (Array.isArray(row.slideItems) && row.slideItems.length) {
			return row.slideItems.slice();
		}
		return [];
	}

	function composeBatchProjectDetail(row, timelineStateOverride) {
		if (!row) return null;
		const regenAt = Number(row._timelineRegeneratedAt) || 0;
		const rawEdit = row.timeline && typeof row.timeline === "object" ? row.timeline : null;
		const edit = rawEdit && (!regenAt || Number(rawEdit.updatedAt || 0) > regenAt) ? rawEdit : null;
		const editDetail = edit && edit.projectDetail && typeof edit.projectDetail === "object" ? edit.projectDetail : null;
		const existing = row.projectDetail && typeof row.projectDetail === "object" ? row.projectDetail : null;
		let resolvedTimeline = timelineStateOverride || null;
		if (!resolvedTimeline && (edit || row.timelineEdited || row.timelineKey)) {
			const storedTl = readTimelineEditorStateForRow(row);
			if (storedTl && (!regenAt || Number(storedTl.updatedAt || 0) > regenAt)) {
				resolvedTimeline = storedTl;
			}
		}
		const hasActiveTimeline = Boolean(resolvedTimeline || edit);
		const style = String(
			(hasActiveTimeline && ((resolvedTimeline && resolvedTimeline.videoStyle) || (edit && edit.videoStyle))) ||
			row.style ||
			(editDetail && editDetail.style) ||
			(existing && existing.style) ||
			"Cinematic Film"
		);
		const effects = typeof window.__videoStyleEffects === "function" ? window.__videoStyleEffects(style) : [];
		const effectLabelText = typeof window.__videoStyleEffectLabel === "function" ? window.__videoStyleEffectLabel(effects) : "";
		const frame = (resolvedTimeline && resolvedTimeline.frame && Number(resolvedTimeline.frame.width) > 0 && Number(resolvedTimeline.frame.height) > 0 ? resolvedTimeline.frame : null) ||
			(edit && edit.frame && Number(edit.frame.width) > 0 && Number(edit.frame.height) > 0 ? edit.frame : null) ||
			(typeof batchRowDimensions === "function" ? batchRowDimensions(row) : { width: 1024, height: 576 });
		let detailScenes = [];
		let slides = [];
		let elements = [];
		if (resolvedTimeline && Array.isArray(resolvedTimeline.scenes) && resolvedTimeline.scenes.length) {
			detailScenes = resolvedTimeline.scenes.map(function (scene, idx) {
				const sceneElements = Array.isArray(scene && scene.elements) ? scene.elements.slice() : [];
				const isTplScene = Boolean(scene && (scene.isTemplateScene || scene.templateScene || String(scene.mediaSource || "") === "template composer"));
				const sceneVideoStyle = isTplScene && scene && scene.videoStyle ? String(scene.videoStyle) : style;
				const sceneStyleCode = String((scene && scene.style) || sceneVideoStyle);
				const sceneTransition = scene && scene.transition && typeof scene.transition === "object"
					? Object.assign({}, scene.transition)
					: { type: "none", speed: 1, effect: "none", motionSpeed: 1 };
				return {
					id: String(scene && scene.id || ("scene-" + (idx + 1))),
					index: Number(scene && scene.index != null ? scene.index : idx),
					name: String(scene && scene.name || ("Scene " + (idx + 1))),
					mediaType: String(scene && scene.mediaType || "image"),
					mediaAssetId: String(scene && scene.mediaAssetId || ""),
					mediaName: String(scene && scene.mediaName || ""),
					mediaSource: String(scene && scene.mediaSource || ""),
					startSec: Math.round(Math.max(0, pipelineManagementNumber(scene && scene.startSec, 0)) * 1000) / 1000,
					durationSec: Math.round(Math.max(0, pipelineManagementNumber(scene && scene.durationSec, 0)) * 1000) / 1000,
					fit: String(scene && scene.fit || "cover"),
					trimStartSec: Math.round(Math.max(0, pipelineManagementNumber(scene && scene.trimStartSec, 0)) * 1000) / 1000,
					visible: scene ? scene.visible !== false : true,
					style: sceneStyleCode,
					videoStyle: sceneVideoStyle,
					effects: Array.isArray(scene && scene.effects) ? scene.effects.slice() : effects.slice(),
					transition: sceneTransition,
					isTemplateScene: isTplScene,
					elements: sceneElements
				};
			});
			const visualTracks = (Array.isArray(resolvedTimeline.tracks) ? resolvedTimeline.tracks : [])
				.filter(function (track) { return track && track.kind === "visual"; });
			visualTracks.forEach(function (track) {
				(track.items || []).forEach(function (item) {
					if (!item) return;
					elements.push({
						id: String(item.id || ""),
						kind: String(item.kind || "text"),
						label: String(item.label || ""),
						trackId: String(track.id || ""),
						sceneId: String(item.sceneId || ""),
						parentId: String(item.parentId || ""),
						startSec: pipelineManagementNumber(item.startSec, 0),
						durationSec: pipelineManagementNumber(item.durationSec, 0),
						text: item.kind === "text" ? String(item.text || "").slice(0, 120) : "",
						graphic: item.kind === "graphic" ? String(item.graphic || "circle") : "",
						size: item.kind === "graphic" ? pipelineManagementNumber(item.size, 72) : pipelineManagementNumber(item.fontSize, 28),
						fontSize: item.kind === "text" ? pipelineManagementNumber(item.fontSize, 28) : 0,
						rotation: pipelineManagementNumber(item.rotation, 0),
						color: String(item.color || ""),
						font: item.kind === "text" ? String(item.font || "sans") : "",
						align: item.kind === "text" ? String(item.align || "center") : "",
						transition: String(item.transition || "none"),
						transitionSpeed: pipelineManagementNumber(item.transitionSpeed, 1),
						anim: String(item.anim || "none"),
						speed: pipelineManagementNumber(item.speed, 1),
						style: String(item.style || ""),
						layerOrder: pipelineManagementNumber(item.layerOrder, 0),
						x: pipelineManagementNumber(item.x, 50),
						y: pipelineManagementNumber(item.y, item.kind === "graphic" ? 50 : 78),
						visible: item.visible !== false,
						dummy: Boolean(item.dummy),
						bakedInTemplateClip: Boolean(item.bakedInTemplateClip)
					});
				});
			});
		} else {
			const sceneItems = edit && Array.isArray(edit.sceneItems) && edit.sceneItems.length
				? edit.sceneItems
				: composeBatchSlideItems(row);
			if (edit && Array.isArray(edit.visuals)) {
				elements = edit.visuals.map(function (vis) {
					const isGraphic = Boolean(vis && vis.k === "g");
					const sz = pipelineManagementNumber(vis && vis.sz, isGraphic ? 72 : 28);
					return {
						id: String(vis && vis.id || ""),
						kind: isGraphic ? "graphic" : "text",
						label: String(vis && vis.lb || ""),
						trackId: String(vis && vis.trId || "visual-1"),
						sceneId: String(vis && vis.scId || ""),
						parentId: String(vis && vis.pId || ""),
						startSec: pipelineManagementNumber(vis && vis.s, 0),
						durationSec: pipelineManagementNumber(vis && vis.d, 0),
						text: isGraphic ? "" : String(vis && vis.tx || ""),
						graphic: isGraphic ? String(vis && vis.gr || "circle") : "",
						size: sz,
						fontSize: isGraphic ? 0 : sz,
						rotation: pipelineManagementNumber(vis && vis.rot, 0),
						color: String(vis && vis.c || ""),
						font: isGraphic ? "" : String(vis && vis.fn || "sans"),
						align: isGraphic ? "" : String(vis && vis.al || "center"),
						transition: String(vis && vis.trn || "none"),
						transitionSpeed: pipelineManagementNumber(vis && vis.ts, 1),
						anim: String(vis && vis.an || "none"),
						speed: pipelineManagementNumber(vis && vis.sp, 1),
						style: String(vis && vis.st || ""),
						layerOrder: pipelineManagementNumber(vis && vis.lo, 0),
						x: pipelineManagementNumber(vis && vis.x, 50),
						y: pipelineManagementNumber(vis && vis.y, isGraphic ? 50 : 78),
						visible: vis ? Number(vis.v) !== 0 : true,
						dummy: Boolean(vis && vis.dm),
						bakedInTemplateClip: Boolean(vis && vis.bk)
					};
				});
			} else if (editDetail && Array.isArray(editDetail.elements)) {
				elements = editDetail.elements.slice();
			} else if (existing && Array.isArray(existing.elements)) {
				elements = existing.elements.slice();
			}
			if (sceneItems.length) {
				let cursor = 0;
				detailScenes = sceneItems.map(function (item, idx) {
					const dur = Math.round(Math.max(0.1, pipelineManagementNumber(item && item.d, 1)) * 1000) / 1000;
					const startSec = item && item.s != null ? Math.round(Math.max(0, pipelineManagementNumber(item.s, 0)) * 1000) / 1000 : Math.round(cursor * 1000) / 1000;
					cursor = startSec + dur;
					const sceneId = String(item && item.id || ("scene-" + (idx + 1)));
					const slideId = String(item && item.slideId || "");
					const mediaType = Number(item && item.t) === 1 ? "video" : Number(item && item.t) === 2 ? "gif" : "image";
					const sceneElements = elements.filter(function (el) {
						if (String(el.sceneId || "") === sceneId) return true;
						if (slideId && el.parentId && String(el.parentId) === slideId) return true;
						return false;
					});
					const isTpl = Boolean(item && (item.tpl || String(item.src || "") === "template composer"));
					const itemVideoStyle = isTpl && item && item.st ? String(item.st) : style;
					const itemStyleCode = String((item && item.sc) || itemVideoStyle);
					const itemEffects = isTpl && item && Array.isArray(item.ef) ? item.ef.slice() : effects.slice();
					const itemTransition = item && item.trn && typeof item.trn === "object"
						? Object.assign({}, item.trn)
						: { type: "none", speed: 1, effect: "none", motionSpeed: 1 };
					return {
						id: sceneId,
						index: idx,
						name: String(item && item.n || ("Scene " + (idx + 1))),
						mediaType: mediaType,
						mediaAssetId: String(item && item.a || ""),
						mediaName: String(item && item.m || ""),
						mediaSource: String(item && item.src || ""),
						startSec: startSec,
						durationSec: dur,
						fit: Number(item && item.f) === 1 ? "contain" : "cover",
						trimStartSec: Math.round(Math.max(0, pipelineManagementNumber(item && item.tr, 0)) * 1000) / 1000,
						visible: Number(item && item.v) !== 0,
						style: itemStyleCode,
						videoStyle: itemVideoStyle,
						effects: itemEffects,
						transition: itemTransition,
						isTemplateScene: isTpl,
						elements: sceneElements
					};
				});
			} else if (edit && Array.isArray(edit.scenes) && edit.scenes.length) {
				let cursor = 0;
				detailScenes = edit.scenes.map(function (entry, idx) {
					const dur = Math.round(Math.max(0.1, pipelineManagementNumber(entry && entry[1], 1)) * 1000) / 1000;
					const startSec = Math.round(cursor * 1000) / 1000;
					cursor += dur;
					const typeCode = Number(entry && entry[2]);
					const mediaIndex = Number(entry && entry[0]);
					return {
						id: mediaIndex >= 0 ? "scene-" + (mediaIndex + 1) : "scene-" + (idx + 1),
						index: idx,
						name: "Scene " + (idx + 1),
						mediaType: typeCode === 1 ? "video" : typeCode === 2 ? "gif" : "image",
						mediaAssetId: mediaIndex >= 0 ? "scene-" + (mediaIndex + 1) : "",
						startSec: startSec,
						durationSec: dur,
						videoStyle: style,
						effects: effects.slice(),
						elements: []
					};
				});
			} else if (editDetail && Array.isArray(editDetail.scenes) && editDetail.scenes.length) {
				detailScenes = editDetail.scenes.map(function (scene) {
					return Object.assign({}, scene, { videoStyle: style, effects: effects.slice() });
				});
			} else if (existing && Array.isArray(existing.scenes) && existing.scenes.length) {
				detailScenes = existing.scenes.map(function (scene) {
					return Object.assign({}, scene, { videoStyle: style, effects: effects.slice() });
				});
			}
		}
		slides = detailScenes.map(function (scene, idx) {
			return {
				id: "slide-" + (idx + 1),
				index: idx,
				sceneId: scene.id,
				assetId: scene.mediaAssetId || "",
				name: scene.name || ("Scene " + (idx + 1)),
				mediaType: scene.mediaType || "image",
				startSec: scene.startSec || 0,
				durationSec: scene.durationSec || 0
			};
		});
		const durationFromScenes = detailScenes.reduce(function (maxEnd, scene) {
			return Math.max(maxEnd, pipelineManagementNumber(scene.startSec, 0) + pipelineManagementNumber(scene.durationSec, 0));
		}, 0);
		const durationSec = Math.round(Math.max(
			0,
			pipelineManagementNumber(
				edit && edit.durationSec != null
					? edit.durationSec
					: (resolvedTimeline && resolvedTimeline.durationSec != null ? resolvedTimeline.durationSec : durationFromScenes),
				durationFromScenes
			)
		) * 1000) / 1000;
		const script = String(row.script || "");
		const firstLine = script.split(/\\r?\\n/).find(function (line) { return line.trim(); }) || "";
		const textCount = elements.filter(function (el) { return el.kind !== "graphic"; }).length;
		const graphicCount = elements.filter(function (el) { return el.kind === "graphic"; }).length;
		const resolvedAudioTracks = resolvedTimeline && Array.isArray(resolvedTimeline.tracks)
			? resolvedTimeline.tracks.filter(function (tr) { return tr && tr.kind === "audio"; })
			: [];
		const resolvedAudioCount = resolvedAudioTracks.reduce(function (sum, tr) {
			return sum + (Array.isArray(tr.items) ? tr.items.length : 0);
		}, 0);
		const audioCount = resolvedAudioTracks.length
			? resolvedAudioCount
			: (edit && Array.isArray(edit.audios)
				? edit.audios.length
				: (editDetail && Number(editDetail.audioCount)) || (existing && Number(existing.audioCount)) || (row.mp3 ? 1 : 0));
		const resolvedVid = String(
			row.vid ||
			(edit && edit.vid) ||
			(resolvedTimeline && resolvedTimeline.sourceVid) ||
			(editDetail && editDetail.vid) ||
			(existing && existing.vid) ||
			(pipelineManagementStore.pageId + "-row-" + String(row.id != null ? row.id : ""))
		);
		return {
			id: String(row.id != null ? row.id : ""),
			rowId: String(row.id != null ? row.id : ""),
			vid: resolvedVid,
			title: String(row.title || firstLine || (editDetail && editDetail.title) || (existing && existing.title) || "").slice(0, 70),
			topic: String(row.topic || firstLine || (editDetail && editDetail.topic) || (existing && existing.topic) || "").slice(0, 160),
			sourcePageId: String(pipelineManagementStore.pageId || (editDetail && editDetail.sourcePageId) || (existing && existing.sourcePageId) || ""),
			targetPageId: String(batchTimelinePageIdForRow(row) || (editDetail && editDetail.targetPageId) || (existing && existing.targetPageId) || ""),
			style: style,
			effects: effects.slice(),
			effectLabel: effectLabelText,
			resolution: String((frame && frame.resolution) || row.resolution || (editDetail && editDetail.resolution) || ""),
			orientation: String((frame && frame.orientation) || row.orientation || (editDetail && editDetail.orientation) || ""),
			quality: String(row.quality || (editDetail && editDetail.quality) || "balanced"),
			frame: frame,
			durationSec: durationSec,
			hasCompletedMedia: Boolean(
				batchRowHasCompletedImages(row) ||
				(editDetail && editDetail.hasCompletedMedia) ||
				(existing && existing.hasCompletedMedia)
			),
			sceneCount: detailScenes.length || (edit && Number(edit.sceneCount)) || (editDetail && Number(editDetail.sceneCount)) || AUTO_MEDIA_TOTAL,
			slideCount: slides.length || (edit && Number(edit.sceneCount)) || 0,
			clipCount: detailScenes.filter(function (scene) { return scene.mediaType === "video"; }).length,
			textCount: textCount || (edit && Number(edit.textCount)) || 0,
			graphicCount: graphicCount,
			elementCount: elements.length || (edit && Number(edit.textCount)) || 0,
			audioCount: audioCount,
			updatedAt: Math.max(
				batchRowTimelineUpdatedAt(row),
				Number(resolvedTimeline && resolvedTimeline.updatedAt) || 0,
				Number(editDetail && editDetail.updatedAt) || 0,
				Number(existing && existing.updatedAt) || 0
			) || Date.now(),
			scenes: detailScenes,
			slides: slides,
			elements: elements
		};
	}

	function composeEditorProjectDetail(project, nOverride) {
		if (!project) return null;
		const n = Math.max(1, Number(nOverride) || Number(project.n) || (Array.isArray(videoProjects) ? videoProjects.indexOf(project) + 1 : 1) || 1);
		const existing = project.projectDetail && typeof project.projectDetail === "object" ? project.projectDetail : null;
		const style = String(project.videoImageStyle || (existing && existing.style) || "Cinematic Film");
		const effects = typeof window.__videoStyleEffects === "function" ? window.__videoStyleEffects(style) : [];
		const effectLabelText = typeof window.__videoStyleEffectLabel === "function" ? window.__videoStyleEffectLabel(effects) : "";
		const orientation = String(project.orientation || (existing && existing.orientation) || "landscape");
		const frame = orientation === "portrait"
			? { width: 720, height: 1280, orientation: "portrait" }
			: { width: 1280, height: 720, orientation: "landscape" };
		const assets = Array.isArray(project.assets) ? project.assets : [];
		const defaultTransitions = ["slide-left", "slide-right", "slide-down", "zoom-in"];
		const allElements = [];
		let cursor = 0;
		const detailScenes = assets.map(function (asset, idx) {
			const isMp4 = Boolean(asset && asset.kind === "mp4");
			const isGif = Boolean(asset && asset.kind === "gif");
			const mediaType = isMp4 ? "video" : (isGif ? "gif" : "image");
			const rawDur = isMp4 ? Number(asset && asset.duration) : 5;
			const durationSec = Number.isFinite(rawDur) && rawDur > 0
				? Math.round(rawDur * 1000) / 1000
				: 5;
			const startSec = Math.round(cursor * 1000) / 1000;
			cursor = startSec + durationSec;
			const sceneId = "editor-" + n + "-scene-" + (idx + 1);
			const parentId = "editor-" + n + "-media-" + (idx + 1);
			const tpl = asset && asset.templateScene && typeof asset.templateScene === "object" ? asset.templateScene : null;
			const fileName = String((asset && asset.file && asset.file.name) || (asset && asset.stockFilename) || ("asset-" + (idx + 1)));
			const isTpl = Boolean(tpl || String(asset && asset.source || "") === "template composer");
			const sceneStyle = isTpl && tpl && (tpl.videoStyle || tpl.style)
				? String(tpl.videoStyle || tpl.style)
				: style;
			const sceneStyleCode = String((tpl && tpl.style) || sceneStyle);
			const sceneEffects = isTpl && tpl && Array.isArray(tpl.effects)
				? tpl.effects.slice()
				: effects.slice();
			const sceneTransition = isTpl && tpl && tpl.transition && typeof tpl.transition === "object"
				? Object.assign({}, tpl.transition)
				: { type: defaultTransitions[idx % defaultTransitions.length], speed: 1, effect: "none", motionSpeed: 1 };
			const sceneElements = [];
			if (tpl && Array.isArray(tpl.elements)) {
				tpl.elements.forEach(function (tplEl, elIdx) {
					if (!tplEl) return;
					const elKind = tplEl.kind === "graphic" ? "graphic" : "text";
					const elRecord = {
						id: sceneId + "-" + String(tplEl.key || ("el-" + (elIdx + 1))),
						kind: elKind,
						label: String(tplEl.label || tplEl.key || elKind),
						trackId: "visual-" + Math.min(4, elIdx + 1),
						sceneId: sceneId,
						parentId: parentId,
						key: String(tplEl.key || ("el-" + (elIdx + 1))),
						templateKey: String(tplEl.key || ("el-" + (elIdx + 1))),
						startSec: startSec,
						durationSec: durationSec,
						text: elKind === "text" ? String(tplEl.text || "").slice(0, 120) : "",
						graphic: elKind === "graphic" ? String(tplEl.graphic || "circle") : "",
						graphicName: elKind === "graphic" ? String(tplEl.graphicName || tplEl.graphic || "circle") : "",
						size: pipelineManagementNumber(tplEl.size, elKind === "graphic" ? 64 : 28),
						fontSize: elKind === "text" ? pipelineManagementNumber(tplEl.fontSize || tplEl.size, 28) : 0,
						rotation: pipelineManagementNumber(tplEl.rotation, 0),
						color: String(tplEl.color || (elKind === "graphic" ? "#7aac2b" : "#ffffff")),
						accent: String(tplEl.accent || ""),
						font: elKind === "text" ? String(tplEl.font || "sans") : "",
						align: elKind === "text" ? String(tplEl.align || "center") : "",
						transition: String(tplEl.transition || "none"),
						transitionSpeed: pipelineManagementNumber(tplEl.transitionSpeed, 1),
						anim: String(tplEl.anim || "none"),
						speed: pipelineManagementNumber(tplEl.speed, 1),
						style: String(tplEl.style || sceneStyleCode || ""),
						layerOrder: pipelineManagementNumber(tplEl.layerOrder, elIdx),
						x: pipelineManagementNumber(tplEl.x, 50),
						y: pipelineManagementNumber(tplEl.y, elKind === "graphic" ? 50 : 78),
						visible: tplEl.visible !== false
					};
					sceneElements.push(elRecord);
					allElements.push(elRecord);
				});
			}
			const mediaSource = isTpl
				? "template composer"
				: (asset && asset.stockSource ? "pixabay" : (asset && asset.imagePromptFlowId ? "ai" : "user upload"));
			const outScene = {
				id: sceneId,
				index: idx,
				name: "Scene " + (idx + 1) + " \u00b7 " + String((tpl && tpl.name) || fileName),
				mediaType: mediaType,
				mediaAssetId: parentId,
				mediaName: fileName,
				mediaSource: mediaSource,
				startSec: startSec,
				durationSec: durationSec,
				fit: "cover",
				trimStartSec: 0,
				visible: true,
				style: sceneStyleCode,
				videoStyle: sceneStyle,
				effects: sceneEffects,
				transition: sceneTransition,
				isTemplateScene: isTpl,
				elements: sceneElements
			};
			if (tpl && tpl.templateId) outScene.templateId = String(tpl.templateId);
			if (tpl && tpl.orientation) outScene.orientation = String(tpl.orientation);
			return outScene;
		});
		const slides = detailScenes.map(function (scene, idx) {
			return {
				id: "editor-" + n + "-slide-" + (idx + 1),
				index: idx,
				sceneId: scene.id,
				assetId: scene.mediaAssetId || "",
				name: scene.name,
				mediaType: scene.mediaType,
				startSec: scene.startSec,
				durationSec: scene.durationSec
			};
		});
		const titleEl = typeof document !== "undefined" ? document.getElementById("va-title-" + n) : null;
		const topicEl = typeof document !== "undefined" ? document.getElementById("va-script-topic-" + n) : null;
		const qualityEl = typeof document !== "undefined" ? document.getElementById("va-quality-" + n) : null;
		const script = String(project.script || "");
		const firstLine = script.split(/\\r?\\n/).find(function (line) { return line.trim(); }) || "";
		const title = String((titleEl && titleEl.value) || project.name || firstLine || "").slice(0, 70);
		const topic = String((topicEl && topicEl.value) || project._seoTopic || firstLine || "").slice(0, 160);
		const quality = String((qualityEl && qualityEl.value) || project.quality || "balanced");
		const durationSec = Math.round(cursor * 1000) / 1000;
		const textCount = allElements.filter(function (el) { return el.kind !== "graphic"; }).length;
		const graphicCount = allElements.filter(function (el) { return el.kind === "graphic"; }).length;
		const detail = {
			id: String(n),
			vid: String(project._pipelineVid || (pipelineManagementStore.pageId + "-editor-" + n)),
			title: title,
			topic: topic,
			sourcePageId: String(pipelineManagementStore.pageId || ""),
			style: style,
			effects: effects.slice(),
			effectLabel: effectLabelText,
			resolution: String(project.resolution || ""),
			orientation: orientation,
			quality: quality,
			frame: frame,
			durationSec: durationSec,
			hasCompletedMedia: Boolean(detailScenes.length > 0),
			sceneCount: detailScenes.length,
			slideCount: slides.length,
			clipCount: detailScenes.filter(function (sc) { return sc.mediaType === "video"; }).length,
			templateSceneCount: detailScenes.filter(function (sc) { return Boolean(sc.isTemplateScene); }).length,
			textCount: textCount,
			graphicCount: graphicCount,
			elementCount: allElements.length,
			audioCount: project.audioFile ? 1 : 0,
			updatedAt: Date.now(),
			scenes: detailScenes,
			slides: slides,
			elements: allElements
		};
		project.projectDetail = detail;
		return detail;
	}

	function syncEditorProjectDetail(n, reason) {
		const idx = Math.max(1, Number(n) || 1) - 1;
		const project = Array.isArray(videoProjects) ? (videoProjects[idx] || null) : null;
		if (!project) return null;
		const detail = composeEditorProjectDetail(project, idx + 1);
		if (String(project.script || "").trim()) {
			try { persistPipelineManagementState(reason || "editor-project-detail"); } catch (persistErr) { }
		}
		return detail;
	}
	window.syncEditorProjectDetail = syncEditorProjectDetail;
	window.getEditorProjectDetail = function (n) {
		const idx = Math.max(1, Number(n) || 1) - 1;
		const project = Array.isArray(videoProjects) ? (videoProjects[idx] || null) : null;
		if (!project) return null;
		return composeEditorProjectDetail(project, idx + 1);
	};

	function purgeRowLocalAndCookieEntries(rowOrId, extra) {
		const opts = extra && typeof extra === "object" ? extra : {};
		const row = rowOrId && typeof rowOrId === "object" ? rowOrId : null;
		const rowId = String(opts.rowId || (row ? row.id : rowOrId) || "").trim();
		const vid = String(opts.vid || (row && row.vid) || "").trim();
		const targetPageId = batchTimelinePageIdForRow(row || rowId, opts.key || opts.timelineKey);
		const pageIds = new Set();
		if (targetPageId) pageIds.add(targetPageId);
		if (opts.pageId) pageIds.add(String(opts.pageId));
		if (row && row.timeline && row.timeline.pageId) pageIds.add(String(row.timeline.pageId));
		if (row && row.projectDetail && row.projectDetail.targetPageId) pageIds.add(String(row.projectDetail.targetPageId));
		if (opts.key && String(opts.key).indexOf(BATCH_TIMELINE_STATE_PREFIX) === 0) {
			pageIds.add(String(opts.key).slice(BATCH_TIMELINE_STATE_PREFIX.length));
		}
		try {
			if (window.localStorage) {
				const keys = [];
				for (let i = 0; i < window.localStorage.length; i++) keys.push(window.localStorage.key(i));
				for (const storageKey of keys) {
					if (!storageKey) continue;
					if (storageKey.indexOf(BATCH_TIMELINE_STATE_PREFIX) === 0) {
						const candPageId = storageKey.slice(BATCH_TIMELINE_STATE_PREFIX.length);
						let match = pageIds.has(candPageId) || Boolean(rowId && candPageId.endsWith("-row-" + rowId));
						if (!match) {
							try {
								const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null");
								if (parsed && ((rowId && String(parsed.sourceRowId || "") === rowId) || (vid && String(parsed.sourceVid || "") === vid))) {
									match = true;
								}
							} catch (parseError) { }
						}
						if (match) {
							pageIds.add(candPageId);
							try { window.localStorage.removeItem(storageKey); } catch (rmError) { }
						}
					} else if (storageKey.indexOf(MEDIA_TRANSITION_STORAGE_PREFIX) === 0) {
						let matchTrans = false;
						try {
							const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null");
							if (parsed) {
								const b = parsed.basicSettings || {};
								const pd = parsed.projectDetail || {};
								if ((rowId && (String(b.id || "") === rowId || String(pd.rowId || "") === rowId)) ||
									(vid && (String(b.vid || "") === vid || String(pd.vid || "") === vid)) ||
									(parsed.targetPageId && pageIds.has(String(parsed.targetPageId)))) {
									matchTrans = true;
								}
							}
						} catch (parseError) { }
						if (matchTrans) {
							try { window.localStorage.removeItem(storageKey); } catch (rmError) { }
							const transKey = storageKey.slice(MEDIA_TRANSITION_STORAGE_PREFIX.length);
							deleteBatchCookie("ytvs_transition_project_" + transKey.replace(/[^a-zA-Z0-9_-]/g, "_"));
						}
					}
				}
			}
		} catch (storageScanError) { }
		pageIds.forEach(function (pid) {
			try { if (window.localStorage) window.localStorage.removeItem(BATCH_TIMELINE_STATE_PREFIX + pid); } catch (e) { }
			const safe = batchTimelineSafeId(pid);
			for (let c = 1; c <= BATCH_TIMELINE_COOKIE_CHUNKS; c++) {
				deleteBatchCookie(BATCH_TIMELINE_COOKIE_PREFIX + safe + "_" + c);
			}
			try {
				if (window.__TIMELINE_EDITOR__ && typeof window.__TIMELINE_EDITOR__.deleteProjectAssets === "function") {
					window.__TIMELINE_EDITOR__.deleteProjectAssets(pid);
				}
			} catch (idbError) { }
		});
		try {
			if (window.document && window.document.cookie) {
				for (const part of String(window.document.cookie || "").split(";")) {
					const entry = part.trim();
					const eq = entry.indexOf("=");
					if (eq < 0) continue;
					const name = entry.slice(0, eq);
					if (name.indexOf(BATCH_TIMELINE_COOKIE_PREFIX) === 0) {
						if (rowId && name.indexOf("-row-" + batchTimelineSafeId(rowId) + "_") >= 0) {
							deleteBatchCookie(name);
						}
					} else if (name.indexOf("ytvs_transition_project_") === 0) {
						try {
							const meta = JSON.parse(decodeURIComponent(entry.slice(eq + 1)));
							if (meta && ((vid && String(meta.vid || "") === vid) || (meta.targetPageId && pageIds.has(String(meta.targetPageId))))) {
								deleteBatchCookie(name);
							}
						} catch (cookieParseError) { }
					}
				}
			}
		} catch (cookieScanError) { }
		if (rowId) {
			try { if (typeof forgetCompletedBatchRow === "function") forgetCompletedBatchRow(rowId, vid); } catch (forgetError) { }
		}
	}

	function purgeBlankRowArtifactsInStorage(snapshot) {
		let purged = 0;
		const blankRowIds = new Set();
		const scriptedSnapshotRowIds = new Set();
		const hasSnapshotRows = Boolean(snapshot && snapshot.quickBatch && Array.isArray(snapshot.quickBatch.rows));
		const qbRows = hasSnapshotRows ? snapshot.quickBatch.rows : [];
		qbRows.forEach(function (stored) {
			if (!stored || typeof stored !== "object") return;
			if (String(stored.script || "").trim()) {
				scriptedSnapshotRowIds.add(String(stored.id || ""));
				return;
			}
			blankRowIds.add(String(stored.id || ""));
			purgeRowLocalAndCookieEntries(stored);
			purged += 1;
		});
		const edProjects = snapshot && snapshot.editor && Array.isArray(snapshot.editor.projects) ? snapshot.editor.projects : [];
		edProjects.forEach(function (project) {
			if (!project || typeof project !== "object") return;
			if (!String(project.script || "").trim()) purged += 1;
		});
		try {
			if (window.localStorage) {
				const currentPageId = String(pipelineManagementStore && pipelineManagementStore.pageId || "");
				const isTimelineTab = requestedStudioLayout() === "timeline" || currentPageId.indexOf("timeline-") === 0;
				const keys = [];
				for (let i = 0; i < window.localStorage.length; i++) keys.push(window.localStorage.key(i));
				for (const storageKey of keys) {
					if (!storageKey) continue;
					if (storageKey.indexOf(BATCH_TIMELINE_STATE_PREFIX) === 0) {
						try {
							const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null");
							if (!parsed) continue;
							const rowId = String(parsed.sourceRowId || "");
							const splitPid = parsed.projectId && typeof splitTimelinePageId === "function" ? splitTimelinePageId(parsed.projectId) : null;
							const parsedSourcePageId = String(
								parsed.sourcePageId ||
								(parsed.projectDetail && parsed.projectDetail.sourcePageId) ||
								(splitPid && splitPid.pageId) ||
								""
							);
							const belongsToCurrentTable = !isTimelineTab && (!parsedSourcePageId || parsedSourcePageId === currentPageId);
							const hasBlankRowMatch = Boolean(belongsToCurrentTable && rowId && blankRowIds.has(rowId));
							/*
							 * When restoring or reconciling from snapshot, batchRows may still
							 * hold the uninitialized blank starter rows (1..3); never treat a row
							 * that has script text in snapshot as blank!
							 */
							const liveRow = (belongsToCurrentTable && rowId && !scriptedSnapshotRowIds.has(rowId) && !hasSnapshotRows)
								? batchRows.find(function (r) { return String(r.id) === rowId; })
								: null;
							const blankInLive = Boolean(liveRow && !String(liveRow.script || "").trim());
							const explicitBlankSource = parsed.sourceScript != null && !String(parsed.sourceScript).trim();
							if (hasBlankRowMatch || blankInLive || explicitBlankSource) {
								purgeRowLocalAndCookieEntries(rowId || parsed.projectId, {
									key: storageKey,
									pageId: parsed.projectId,
									vid: parsed.sourceVid
								});
								purged += 1;
							}
						} catch (parseError) { }
					} else if (storageKey.indexOf("ytvs.pipeline-management.v1.") === 0 && storageKey !== pipelineManagementStore.localStorageKey) {
						try {
							const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null");
							if (parsed && parsed.quickBatch && Array.isArray(parsed.quickBatch.rows)) {
								const hadBlankRow = parsed.quickBatch.rows.some(function (r) { return r && !String(r.script || "").trim(); });
								const hadBlankProj = Boolean(parsed.editor && Array.isArray(parsed.editor.projects) && parsed.editor.projects.some(function (p) { return p && !String(p.script || "").trim(); }));
								if (hadBlankRow || hadBlankProj) {
									parsed.quickBatch.rows.forEach(function (r) {
										if (r && !String(r.script || "").trim()) purgeRowLocalAndCookieEntries(r);
									});
									const keptRows = parsed.quickBatch.rows.filter(function (r) { return Boolean(r && String(r.script || "").trim()); });
									const keptProjs = parsed.editor && Array.isArray(parsed.editor.projects)
										? parsed.editor.projects.filter(function (p) { return Boolean(p && String(p.script || "").trim()); })
										: [];
									const otherPid = String(parsed.pageId || storageKey.slice("ytvs.pipeline-management.v1.".length));
									if (!keptRows.length && !keptProjs.length) {
										window.localStorage.removeItem(storageKey);
										const safeOther = otherPid.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
										for (let c = 1; c <= 4; c++) deleteBatchCookie("ytvs_pipeline_management_" + safeOther + "_" + c);
									} else if (typeof createPipelineManagementStore === "function") {
										parsed.quickBatch.rows = keptRows;
										if (parsed.editor) parsed.editor.projects = keptProjs;
										createPipelineManagementStore(window, otherPid).save(parsed);
									}
									purged += 1;
								}
							}
						} catch (pmErr) { }
					} else if (storageKey.indexOf(MEDIA_TRANSITION_STORAGE_PREFIX) === 0) {
						try {
							const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null");
							const script = parsed && parsed.basicSettings ? String(parsed.basicSettings.script || "").trim() : "";
							if (parsed && !script && parsed.projectDetail) {
								const transKey = storageKey.slice(MEDIA_TRANSITION_STORAGE_PREFIX.length);
								window.localStorage.removeItem(storageKey);
								deleteBatchCookie("ytvs_transition_project_" + transKey.replace(/[^a-zA-Z0-9_-]/g, "_"));
								purged += 1;
							}
						} catch (parseError) { }
					}
				}
			}
		} catch (scanError) { }
		try {
			if (window.document && window.document.cookie) {
				const seenPages = new Set();
				const seenPmPages = new Set();
				for (const part of String(window.document.cookie || "").split(";")) {
					const entry = part.trim();
					const eq = entry.indexOf("=");
					if (eq < 0) continue;
					const name = entry.slice(0, eq);
					if (name.indexOf("ytvs_pipeline_management_") === 0 && typeof createPipelineManagementStore === "function") {
						try {
							const meta = JSON.parse(decodeURIComponent(entry.slice(eq + 1)));
							const otherPid = meta && meta.p ? String(meta.p) : "";
							if (!otherPid || otherPid === pipelineManagementStore.pageId || seenPmPages.has(otherPid)) continue;
							seenPmPages.add(otherPid);
							const otherStore = createPipelineManagementStore(window, otherPid);
							const otherLoaded = otherStore.load();
							const otherSnap = otherLoaded && otherLoaded.snapshot;
							if (otherSnap && otherSnap.quickBatch && Array.isArray(otherSnap.quickBatch.rows)) {
								const hadBlank = otherSnap.quickBatch.rows.some(function (r) { return r && !String(r.script || "").trim(); });
								const hadBlankProj = Boolean(otherSnap.editor && Array.isArray(otherSnap.editor.projects) && otherSnap.editor.projects.some(function (p) { return p && !String(p.script || "").trim(); }));
								if (hadBlank || hadBlankProj) {
									otherSnap.quickBatch.rows.forEach(function (r) {
										if (r && !String(r.script || "").trim()) purgeRowLocalAndCookieEntries(r);
									});
									const keptRows = otherSnap.quickBatch.rows.filter(function (r) { return Boolean(r && String(r.script || "").trim()); });
									const keptProjs = otherSnap.editor && Array.isArray(otherSnap.editor.projects)
										? otherSnap.editor.projects.filter(function (p) { return Boolean(p && String(p.script || "").trim()); })
										: [];
									if (!keptRows.length && !keptProjs.length) {
										otherStore.clear();
									} else {
										otherSnap.quickBatch.rows = keptRows;
										if (otherSnap.editor) otherSnap.editor.projects = keptProjs;
										otherStore.save(otherSnap);
									}
									purged += 1;
								}
							}
						} catch (pmCookieErr) { }
						continue;
					}
					if (name.indexOf(BATCH_TIMELINE_COOKIE_PREFIX) !== 0) continue;
					try {
						const meta = JSON.parse(decodeURIComponent(entry.slice(eq + 1)));
						if (!meta || !meta.p || seenPages.has(meta.p)) continue;
						seenPages.add(meta.p);
						const cookieState = readTimelineCookiesForPageId(meta.p);
						if (!cookieState) continue;
						const rowId = String(cookieState.sourceRowId || "");
						const currentPageId = String(pipelineManagementStore && pipelineManagementStore.pageId || "");
						const isTimelineTab = requestedStudioLayout() === "timeline" || currentPageId.indexOf("timeline-") === 0;
						const splitPid = cookieState.projectId && typeof splitTimelinePageId === "function" ? splitTimelinePageId(cookieState.projectId) : null;
						const parsedSourcePageId = String(
							cookieState.sourcePageId ||
							(cookieState.projectDetail && cookieState.projectDetail.sourcePageId) ||
							(splitPid && splitPid.pageId) ||
							""
						);
						const belongsToCurrentTable = !isTimelineTab && (!parsedSourcePageId || parsedSourcePageId === currentPageId);
						const liveRow = (belongsToCurrentTable && rowId && !scriptedSnapshotRowIds.has(rowId) && !hasSnapshotRows)
							? batchRows.find(function (r) { return String(r.id) === rowId; })
							: null;
						if ((belongsToCurrentTable && rowId && blankRowIds.has(rowId)) || (liveRow && !String(liveRow.script || "").trim()) ||
							(cookieState.sourceScript != null && !String(cookieState.sourceScript).trim())) {
							purgeRowLocalAndCookieEntries(rowId || cookieState.projectId, {
								pageId: cookieState.projectId,
								vid: cookieState.sourceVid
							});
							purged += 1;
						}
					} catch (cookieParseError) { }
				}
			}
		} catch (cookieScanError) { }
		return purged;
	}

	function batchRowNeedsTimelineAssetHydration(row) {
		if (!row) return false;
		if (!row.mp3Url && (row.mp3 || row._storedMp3 || row.timelineEdited)) return true;
		const slides = Array.isArray(row.slides) ? row.slides : [];
		if (row.timelineEdited && !slides.length && Array.isArray(row.slideItems) && row.slideItems.length) return true;
		for (let i = 0; i < slides.length; i++) {
			const s = slides[i];
			if (!s || s.visible === false) continue;
			const assetKey = String(s.assetId || (Number.isInteger(Number(s.imageIndex)) && Number(s.imageIndex) >= 0 ? "scene-" + (Number(s.imageIndex) + 1) : ""));
			if (!s.img) return true;
			if (s.type === "mp4" && !s.videoEl) return true;
			if (s._hydratedAssetId && assetKey && s._hydratedAssetId !== assetKey) return true;
		}
		if (row.timeline && Array.isArray(row.timeline.audios)) {
			const urlMap = row._timelineAudioUrls || {};
			for (let i = 0; i < row.timeline.audios.length; i++) {
				const aud = row.timeline.audios[i];
				if (aud && aud.a && aud.a !== "voiceover" && !urlMap[aud.a]) return true;
			}
		}
		return false;
	}

	async function hydrateBatchRowAssetsFromTimeline(row) {
		if (!row) return false;
		if (row._hydratingPromise) return row._hydratingPromise;
		if (!window.__TIMELINE_EDITOR__ || typeof window.__TIMELINE_EDITOR__.readProjectAssets !== "function") return false;
		const targetPageId = batchRowMediaPageId(row) || batchTimelinePageIdForRow(row);
		if (!targetPageId) return false;
		row._hydratingAssets = true;
		const startEpoch = Number(row._runEpoch) || 0;
		row._hydratingPromise = (async function () {
			try {
				const record = await window.__TIMELINE_EDITOR__.readProjectAssets(targetPageId);
				if (!record || row.running || (Number(row._runEpoch) || 0) !== startEpoch) return false;
				const recordUpdatedAt = Number(record.updatedAt) || 0;
				const shouldReplaceVoiceover = Boolean(
					row.timelineEdited &&
					record.voiceover &&
					record.voiceover !== row.mp3 &&
					recordUpdatedAt > (Number(row._mediaPersistedAt) || 0)
				);
				if ((!row.mp3 || shouldReplaceVoiceover) && record.voiceover && record.voiceover instanceof Blob) {
					row.mp3 = record.voiceover;
					row.mp3Url = typeof createStudioObjectUrl === "function" ? createStudioObjectUrl(record.voiceover) : "";
					if (row.mp3Url) row.objectUrls.push(row.mp3Url);
					if (typeof decodeBatchAudio === "function") {
						try { await decodeBatchAudio(row, record.voiceover); } catch (decodeErr) { }
					}
					if (row.running || (Number(row._runEpoch) || 0) !== startEpoch) return false;
				}
				if (!row._timelineAudioUrls) row._timelineAudioUrls = Object.create(null);
				if (!row._timelineAssetUrls) row._timelineAssetUrls = Object.create(null);
				if (row.mp3Url) row._timelineAudioUrls.voiceover = row.mp3Url;
				const storedAssets = record.assets && typeof record.assets === "object" ? record.assets : {};
				const byAssetId = Object.create(null);
				const nextImages = [];
				let extraSlot = AUTO_MEDIA_TOTAL;
				if (Array.isArray(row.images)) {
					row.images.forEach(function (existingMedia) {
						if (!existingMedia) return;
						const eIdx = Number(existingMedia.index);
						if (Number.isInteger(eIdx) && eIdx >= extraSlot) extraSlot = eIdx + 1;
						const eKey = String(existingMedia.assetId || (Number.isInteger(eIdx) && eIdx >= 0 ? "scene-" + (eIdx + 1) : ""));
						if (eKey && existingMedia.url && !byAssetId[eKey]) byAssetId[eKey] = existingMedia;
					});
				}
				Object.keys(storedAssets).forEach(function (assetId) {
					const asset = storedAssets[assetId];
					if (!asset || !asset.blob) return;
					const blobType = String(asset.type || (asset.blob && asset.blob.type) || "").toLowerCase();
					let url = row._timelineAssetUrls[assetId] || "";
					if (!url || row._timelineAssetBlobs && row._timelineAssetBlobs[assetId] !== asset.blob) {
						url = typeof createStudioObjectUrl === "function" ? createStudioObjectUrl(asset.blob) : "";
						if (url) row.objectUrls.push(url);
						if (!row._timelineAssetBlobs) row._timelineAssetBlobs = Object.create(null);
						row._timelineAssetBlobs[assetId] = asset.blob;
						row._timelineAssetUrls[assetId] = url;
					}
					if (blobType.indexOf("audio/") === 0 || assetId.indexOf("audio-") === 0) {
						if (url) row._timelineAudioUrls[assetId] = url;
						return;
					}
					const isSceneKey = assetId.indexOf("scene-") === 0;
					const num = isSceneKey ? trailingDigits(assetId) : 0;
					const idx = isSceneKey && num > 0 ? num - 1 : extraSlot++;
					const mediaObj = {
						index: idx,
						assetId: assetId,
						blob: asset.blob,
						url: url,
						stockFilename: asset.name || (asset.blob && asset.blob.name) || "",
						stockSource: asset.source || null
					};
					byAssetId[assetId] = mediaObj;
					nextImages.push(mediaObj);
				});
				nextImages.sort(function (a, b) { return Number(a.index) - Number(b.index); });
				if (nextImages.length) {
					if (!Array.isArray(row.images) || !row.images.length) {
						row.images = nextImages;
					} else {
						nextImages.forEach(function (mediaObj) {
							const exists = row.images.some(function (existing) {
								if (!existing) return false;
								if (existing.assetId && existing.assetId === mediaObj.assetId) return true;
								return mediaObj.assetId.indexOf("scene-") === 0 && Number(existing.index) === Number(mediaObj.index);
							});
							if (!exists) row.images.push(mediaObj);
						});
					}
				}
				for (const slide of (Array.isArray(row.slides) ? row.slides : [])) {
					if (!slide) continue;
					const assetKey = String(slide.assetId || (Number.isInteger(Number(slide.imageIndex)) && Number(slide.imageIndex) >= 0 ? "scene-" + (Number(slide.imageIndex) + 1) : ""));
					const mediaObj = assetKey ? byAssetId[assetKey] : null;
					if (!mediaObj || !mediaObj.url) continue;
					const assetSwapped = Boolean(slide._hydratedAssetId && slide._hydratedAssetId !== assetKey);
					if (slide.type === "mp4" && (!slide.videoEl || assetSwapped) && typeof document !== "undefined") {
						const video = document.createElement("video");
						video.muted = true;
						video.playsInline = true;
						video.preload = "auto";
						video.src = mediaObj.url;
						if (!(Number(slide.duration) > 0)) slide.duration = slideDurationSec(slide);
						if (typeof video.addEventListener === "function") {
							const onMeta = function () {
								if (Number.isFinite(video.duration) && video.duration > 0) slide.duration = video.duration;
								if (batchPreview && batchPreview.row === row) {
									try { batchPreviewTick(); } catch (tickErr) { }
								}
							};
							video.addEventListener("loadedmetadata", onMeta, { once: true });
							video.addEventListener("loadeddata", onMeta, { once: true });
						}
						slide.videoEl = video;
						slide.img = video;
						slide._hydratedAssetId = assetKey;
					} else if (slide.type !== "mp4" && (!slide.img || assetSwapped) && typeof Image === "function") {
						const img = new Image();
						img.onload = function () {
							if (batchPreview && batchPreview.row === row) {
								try { batchPreviewTick(); } catch (tickErr) { }
							}
						};
						img.src = mediaObj.url;
						slide.img = img;
						slide._hydratedAssetId = assetKey;
						if (slide.type === "gif" && !slide.gif && mediaObj.blob && typeof decodeGifFrames === "function") {
							try { slide.gif = await decodeGifFrames(mediaObj.blob); } catch (gifErr) { }
						}
					}
				}
				if (row.mp3 && ((row.images && row.images.length) || (row.slides && row.slides.length))) {
					row.animated = true;
				}
				if (batchPreview && batchPreview.row === row) {
					if (batchPreview.audio && row.mp3Url && batchPreview.audio.src !== row.mp3Url) {
						batchPreview.audio.src = row.mp3Url;
					}
					try { batchPreviewTick(); } catch (previewErr) { }
				}
				return true;
			} catch (error) {
				return false;
			} finally {
				row._hydratingAssets = false;
				row._hydratingPromise = null;
			}
		})();
		return row._hydratingPromise;
	}

	/*
	 * Session 331 (regenerate fix): rebuild a restored row's slides from the
	 * timing the row stored (slideItems). Synchronous: it reuses the media that
	 * hydration has already put back, so nothing is decoded or probed again.
	 */
	function rebuildBatchSlidesFromItems(row) {
		const items = Array.isArray(row && row.slideItems) ? row.slideItems : [];
		if (!items.length || (Array.isArray(row.slides) && row.slides.length)) return false;
		const medias = Array.isArray(row.images) ? row.images : [];
		const style = String(row.style || "Cinematic Film");
		const effects = typeof window.__videoStyleEffects === "function" ? window.__videoStyleEffects(style) : [];
		const built = [];
		items.forEach(function (item, idx) {
			if (!item || typeof item !== "object") return;
			const slide = cloneOrReuseBatchSlide(null, item, idx, style, effects);
			const media = medias.find(function (candidate) { return candidate.assetId === slide.assetId; }) ||
				medias.find(function (candidate) { return Number(candidate.index) === Number(slide.mediaIndex); }) || null;
			if (media && media.url && typeof document !== "undefined") {
				if (slide.type === "mp4") {
					const video = document.createElement("video");
					video.src = media.url;
					slide.videoEl = video;
					slide.img = video;
				} else if (typeof Image === "function") {
					const img = new Image();
					img.src = media.url;
					slide.img = img;
				}
			}
			built.push(slide);
		});
		if (!built.length) return false;
		row.slides = built;
		return true;
	}

	/*
	 * Session 331 (regenerate fix): a finished row whose media could not be put
	 * back becomes a plain record. It keeps its script, timing and status, loses
	 * its "finished" flags, so its action buttons stay locked and Generate can
	 * build it again. Nothing is shown as an error.
	 */
	function demoteBatchRowToRecord(row) {
		if (!row) return;
		row._storedFinished = false;
		row._storedMp3 = false;
		row._storedAnimated = false;
		row._storedImagesCount = 0;
		row._storedSlidesCount = 0;
		row.stage = "done";
		row.detail = "Media not kept - Generate builds it again";
	}

	/*
	 * Session 331 (regenerate fix): put a restored row's media back. It waits
	 * for any hydration already running, reads the media from IndexedDB,
	 * rebuilds the slides, then repaints the row. The row is marked
	 * _recoveringMedia meanwhile, so Generate does not start on it.
	 */
	async function recoverBatchRowMedia(row) {
		if (!row) return false;
		row._recoveringMedia = true;
		try {
			/*
			 * The restore runs while the page's own script is still loading, so the
			 * timeline editor (which reads the media) is not on the page yet. One
			 * tick lets that script finish before the media is read.
			 */
			await batchDelay(0);
			let waited = 0;
			while (row._hydratingAssets && waited < 10000) {
				await batchDelay(100);
				waited += 100;
			}
			const restored = await hydrateBatchRowAssetsFromTimeline(row);
			if (restored) rebuildBatchSlidesFromItems(row);
		} catch (recoverError) { }
		row._recoveringMedia = false;
		if (row.stage === "done" && !batchRowFinished(row)) demoteBatchRowToRecord(row);
		try { paintBatchRowStatus(row); } catch (paintError) { }
		try { renderBatchTable(); } catch (renderError) { }
		if (row.stage === "done" && batchRowFinished(row)) persistPipelineManagementState("batch-row-media-restored");
		return batchRowFinished(row);
	}

	function pipelineManagementSnapshot() {
		ensurePipelineVideoIds();
		let rows = [];
		let projects = [];
		let quickBatch = { runBusy: false, queued: [], finishedCount: 0, rows: rows };
		try {
			const scriptedIds = new Set();
			rows = batchRows
				.filter(function (row) { return Boolean(row && String(row.script || "").trim()); })
				.map(function (row) {
					scriptedIds.add(String(row.id));
					const slideItems = composeBatchSlideItems(row);
					const projectDetail = composeBatchProjectDetail(row);
					row.projectDetail = projectDetail;
					const timelineUpdatedAt = batchRowTimelineUpdatedAt(row);
					return {
						id: String(row.id),
						vid: String(row.vid || ""),
						title: String(row.title || "").slice(0, 120),
						topic: String(row.topic || "").slice(0, 160),
						script: String(row.script || ""),
						scriptLength: String(row.script || "").length,
						style: String(row.style || ""),
						minutes: pipelineManagementNumber(row.minutes, 1),
						resolution: String(row.resolution || ""),
						orientation: String(row.orientation || ""),
						quality: String(row.quality || ""),
						stage: String(row.stage || "ready"),
						detail: String(row.detail || "").slice(0, 200),
						attempt: pipelineManagementNumber(row.attempt, 0),
						retrying: Boolean(row.retrying),
						running: Boolean(row.running),
						prompts: (row.prompts || []).length,
						images: Math.max((row.images || []).length, Number(row._storedImagesCount) || 0),
						slides: (row.slides || []).length || Number(row._storedSlidesCount) || slideItems.length,
						slideItems: slideItems.length ? slideItems : undefined,
						mediaFilenames: (row.mediaFilenames || []).length,
						/*
						 * Session 331 follow-up: the timeline hand-back travels with
						 * the row, alongside composable slides/scenes and projectDetail,
						 * so localStorage and cookies carry the full edited structure.
						 */
						timeline: row.timeline && typeof row.timeline === "object" ? row.timeline : undefined,
						timelineKey: row.timeline ? String(row.timeline.key || row.timelineKey || "") : String(row.timelineKey || ""),
						timelineUpdatedAt: timelineUpdatedAt || undefined,
						timelineRegeneratedAt: Number(row._timelineRegeneratedAt) || undefined,
						projectDetail: projectDetail || undefined,
						mp3: Boolean(row.mp3 || row._storedMp3),
						animated: Boolean(row.animated || row._storedAnimated),
						finished: Boolean(batchRowFinished(row) || (row._storedFinished && !row._archived))
					};
				});
			quickBatch = {
				runBusy: Boolean(batchRunBusy),
				queued: batchQueue.map(function (row) { return String(row.id); }).filter(function (id) { return scriptedIds.has(id); }),
				finishedCount: pipelineManagementNumber(batchFinishedCount, 0),
				rows: rows
			};
		} catch (batchError) { }
		try {
			projects = videoProjects
				.map(function (project, index) { return { project: project, index: index }; })
				.filter(function (entry) { return Boolean(entry.project && String(entry.project.script || "").trim()); })
				.map(function (entry) {
					const project = entry.project;
					const index = entry.index;
					const editorDetail = composeEditorProjectDetail(project, index + 1);
					return {
						n: index + 1,
						vid: String(project._pipelineVid || ""),
						name: String(project.name || "").slice(0, 120),
						stage: project._scriptWriting ? "script" : project._imageFlowActive ? "media" : "ready",
						script: String(project.script || ""),
						scriptLength: String(project.script || "").length,
						topic: String(project._seoTopic || "").slice(0, 160),
						minutes: pipelineManagementNumber(project._seoMinutes, 1),
						style: String(project.videoImageStyle || ""),
						resolution: String(project.resolution || ""),
						orientation: String(project.orientation || ""),
						quality: String(project.quality || ""),
						imageFlowActive: Boolean(project._imageFlowActive),
						prompts: (project.imagePrompts || []).length,
						images: (project.images || []).length,
						slides: (project.slides || []).length,
						mediaFilenames: (project.mediaFilenames || []).length,
						projectDetail: editorDetail || undefined
					};
				});
		} catch (editorError) { }
		return {
			version: 1,
			pageId: pipelineManagementStore.pageId,
			updatedAt: Date.now(),
			layout: pipelineManagementLayout(),
			quickBatch: quickBatch,
			editor: { projects: projects }
		};
	}

	function pipelineStorageFailureText(saved, error) {
		if (error) return String(error && error.message || error).slice(0, 180);
		if (!saved) return "unknown storage failure";
		if (saved.reason) return String(saved.reason).slice(0, 180);
		if (saved.localStorage === false) return "localStorage write failed";
		if (saved.cookieCount && saved.cookies !== saved.cookieCount) return "pipeline cookie chunks were rejected";
		if (saved.timestampMatched === false) return "localStorage and cookie timestamps did not match";
		return "storage verification failed";
	}

	function showPipelineStorageWarning(detail) {
		const text = "Pipeline management storage could not be saved or verified (" + String(detail || "unknown error") +
			"). Use Reset pipeline state to clear this tab's saved management data.";
		window.__PIPELINE_MANAGEMENT_WARNING__ = { visible: true, detail: String(detail || "unknown error") };
		const box = document.getElementById("pipeline-storage-alert");
		const message = document.getElementById("pipeline-storage-message");
		if (!box || !message) {
			console.warn("[pipeline-storage]", text);
			try { showRequiredModal([text]); } catch (modalError) { }
			return;
		}
		message.textContent = text;
		box.hidden = false;
		box.setAttribute("data-state", "error");
	}

	function hidePipelineStorageWarning() {
		window.__PIPELINE_MANAGEMENT_WARNING__ = { visible: false, detail: "" };
		const box = document.getElementById("pipeline-storage-alert");
		if (box) {
			box.hidden = true;
			box.removeAttribute("data-state");
		}
	}

	function resetPipelineManagementState() {
		const result = { cleared: false, saved: false, detail: "" };
		try {
			pipelineManagementStore.clear();
			result.cleared = true;
		} catch (clearError) {
			result.detail = String(clearError && clearError.message || clearError);
		}
		window.__PIPELINE_MANAGEMENT_STATE__ = null;
		window.__PIPELINE_MANAGEMENT_SAVE__ = null;
		window.__PIPELINE_MANAGEMENT_LOAD__ = null;
		pipelineManagementSaving = false;
		pipelineManagementRestoring = false;
		try {
			batchRows.splice(0, batchRows.length);
			batchTableSeeded = false;
			batchQueue = [];
			batchRunBusy = false;
			batchFinishedCount = 0;
			batchAttemptedRows.clear();
			batchActivePromises.clear();
		} catch (batchError) { }
		try {
			videoProjects.forEach(function (project, index) {
				project._pipelineVid = pipelineManagementStore.pageId + "-editor-" + String(index + 1);
				project._imageFlowActive = false;
				project._imageFlowFinalizing = false;
				project._scriptWriting = false;
			});
		} catch (editorError) { }
		hidePipelineStorageWarning();
		try { renderBatchTable(); } catch (renderError) { }
		const saved = persistPipelineManagementState("storage-reset");
		result.saved = Boolean(saved && saved.ok);
		if (!result.saved && !result.detail) result.detail = "a fresh snapshot could not be written";
		window.__PIPELINE_MANAGEMENT_RESET__ = result;
		return result;
	}
	window.resetPipelineManagementState = resetPipelineManagementState;
	window.restorePipelineManagementState = restorePipelineManagementState;
	window.__PIPELINE_MANAGEMENT_STORE__ = pipelineManagementStore;
	/* Session 331 follow-up: the timeline tab writes through this factory. */
	window.__PIPELINE_MANAGEMENT_STORE_FACTORY__ = createPipelineManagementStore;

	function persistPipelineManagementState(reason) {
		if (pipelineManagementSaving || pipelineManagementRestoring) return null;
		pipelineManagementSaving = true;
		try {
			const saved = pipelineManagementStore.save(pipelineManagementSnapshot());
			if (saved && saved.ok) {
				hidePipelineStorageWarning();
			} else {
				const detail = pipelineStorageFailureText(saved, null);
				showPipelineStorageWarning(detail);
				console.warn("[pipeline-storage] save was not verified", saved);
			}
			saved.reason = String(reason || "state-change");
			window.__PIPELINE_MANAGEMENT_SAVE__ = saved;
			return saved;
		} catch (saveError) {
			const detail = pipelineStorageFailureText(null, saveError);
			showPipelineStorageWarning(detail);
			console.warn("[pipeline-storage] save threw", saveError);
			window.__PIPELINE_MANAGEMENT_SAVE__ = { ok: false, reason: String(reason || "state-change"), error: detail };
			return null;
		} finally {
			pipelineManagementSaving = false;
		}
	}

	function restorePipelineManagementState() {
		const loaded = pipelineManagementStore.load();
		window.__PIPELINE_MANAGEMENT_LOAD__ = {
			source: loaded.source,
			repairedCookie: loaded.repairedCookie,
			pageId: pipelineManagementStore.pageId,
			debug: loaded.debug
		};
		const rawSnapshot = loaded.snapshot;
		let purgedBlankCount = 0;
		try {
			purgedBlankCount = purgeBlankRowArtifactsInStorage(rawSnapshot);
		} catch (purgeError) { }
		if (!rawSnapshot) {
			return null;
		}
		const snapshot = rawSnapshot;
		window.__PIPELINE_MANAGEMENT_STATE__ = snapshot;
		pipelineManagementRestoring = true;
		try {
			try { setStudioLayout(snapshot.layout === "table" ? "table" : "editor"); } catch (layoutError) { }
			try {
				batchRunBusy = false;
				batchQueue = [];
				batchFinishedCount = pipelineManagementNumber(snapshot.quickBatch && snapshot.quickBatch.finishedCount, 0);
				batchAttemptedRows.clear();
				batchActivePromises.clear();
			} catch (queueError) { }
			const storedRows = ((snapshot.quickBatch && snapshot.quickBatch.rows) || [])
				.filter(function (stored) { return Boolean(stored && String(stored.script || "").trim()); })
				.slice(0, 8);
			const storedRowIds = new Set(storedRows.map(function (stored) { return String(stored.id || ""); }));
			const onTimelineTab = requestedStudioLayout() === "timeline" || String(pipelineManagementStore.pageId || "").indexOf("timeline-") === 0;
			/* Blank-script rows in memory that are NOT being restored from storedRows are purged. */
			if (!onTimelineTab) {
				for (let idx = batchRows.length - 1; idx >= 0; idx--) {
					const existingRow = batchRows[idx];
					if (!existingRow || String(existingRow.script || "").trim()) continue;
					if (storedRowIds.has(String(existingRow.id || ""))) continue;
					if (existingRow.timeline || existingRow.timelineEdited || existingRow.timelineKey || existingRow.projectDetail) {
						try { resetClearedBatchRow(existingRow); } catch (resetErr) { }
					} else {
						try { purgeRowLocalAndCookieEntries(existingRow); } catch (purgeRowErr) { }
					}
				}
			}
			if (
				storedRows.length &&
				batchRows.length === 1 &&
				!String(batchRows[0].script || "").trim() &&
				!batchRows[0].timeline &&
				!batchRows[0].projectDetail
			) {
				batchRows.splice(0, batchRows.length);
			}
			for (const stored of storedRows) {
				let row = null;
				try {
					row = batchRows.find(function (candidate) { return String(candidate.id) === String(stored.id); }) || null;
				} catch (findError) { }
				if (!row) {
					try {
						row = createBatchRow({
							title: stored.title || "",
							topic: stored.topic || "",
							script: stored.script || "",
							style: stored.style || "",
							minutes: stored.minutes || 1,
							resolution: stored.resolution || "",
							orientation: stored.orientation || "",
							quality: stored.quality || ""
						});
						if (stored.id && Number(stored.id) > 0) {
							row.id = Number(stored.id);
							batchRowSeq = Math.max(batchRowSeq, row.id);
						}
						batchRows.push(row);
					} catch (createError) { continue; }
				}
				if (!row) continue;
				row.vid = stored.vid || pipelineManagementStore.pageId + "-row-" + String(row.id);
				row.title = stored.title || row.title || "";
				row.topic = stored.topic || row.topic || "";
				row.script = String(stored.script || "");
				row.style = stored.style || row.style || "";
				row.minutes = pipelineManagementNumber(stored.minutes, row.minutes || 1);
				row.resolution = stored.resolution || row.resolution || "";
				row.orientation = stored.orientation || row.orientation || "";
				row.quality = stored.quality || row.quality || "";
				const storedHasLiveMedia = Boolean(
					stored.finished ||
					(stored.mp3 && stored.animated && (Number(stored.images) > 0 || (stored.projectDetail && stored.projectDetail.hasCompletedMedia)))
				);
				const liveHasMedia = Boolean(row.mp3 && row.animated && batchRowHasCompletedImages(row));
				row._storedFinished = Boolean(row._storedFinished || storedHasLiveMedia);
				row._storedImagesCount = Math.max(Number(row._storedImagesCount) || 0, Number(stored.images) || (stored.projectDetail && Number(stored.projectDetail.sceneCount)) || 0);
				row._storedSlidesCount = Math.max(Number(row._storedSlidesCount) || 0, Number(stored.slides) || (Array.isArray(stored.slideItems) ? stored.slideItems.length : 0));
				row._storedMp3 = Boolean(row._storedMp3 || stored.mp3);
				row._storedAnimated = Boolean(row._storedAnimated || stored.animated || stored.finished);
				if (stored.timelineRegeneratedAt != null) {
					row._timelineRegeneratedAt = Math.max(Number(row._timelineRegeneratedAt) || 0, Number(stored.timelineRegeneratedAt) || 0);
				}
				if (liveHasMedia || storedHasLiveMedia) {
					row.stage = "done";
					row.detail = String(stored.detail || row.detail || (row._storedSlidesCount ? row._storedSlidesCount + " slides" : "Finished"));
				} else {
					row.stage = ["empty", "writing", "ready", "queued"].indexOf(stored.stage || "") >= 0 ? stored.stage : "ready";
					row.detail = "";
				}
				row.error = "";
				row.attempt = pipelineManagementNumber(stored.attempt, 0);
				row.retrying = false;
				row.running = false;
				row.stopRequested = false;
				if (Array.isArray(stored.slideItems) && stored.slideItems.length) {
					row.slideItems = stored.slideItems.slice();
				}
				if (stored.projectDetail && typeof stored.projectDetail === "object") {
					row.projectDetail = Object.assign({}, stored.projectDetail);
				}
				/*
				 * Session 331 follow-up: the row's own timeline edit comes back with
				 * it - the scene order and timing the user saved in the editor are
				 * applied to this row's slides, so Preview and Export paint the edit.
				 */
				row.timeline = stored.timeline && typeof stored.timeline === "object" ? stored.timeline : null;
				row.timelineKey = String(stored.timelineKey || (row.timeline && row.timeline.key) || "");
				row.timelineUpdatedAt = Math.max(
					Number(stored.timelineUpdatedAt) || 0,
					Number(row.timeline && row.timeline.updatedAt) || 0
				);
				applyTimelineEditToBatchRow(row);
				if (liveHasMedia || storedHasLiveMedia || row.timelineEdited) {
					recoverBatchRowMedia(row);
				}
			}
			const storedProjects = ((snapshot.editor && snapshot.editor.projects) || [])
				.filter(function (stored) { return Boolean(stored && String(stored.script || "").trim()); })
				.slice(0, 8);
			for (const stored of storedProjects) {
				const index = pipelineManagementNumber(stored.n, 1) - 1;
				let project = null;
				try { project = videoProjects[index] || null; } catch (projectError) { }
				if (!project && typeof addVideoAccordion === "function") {
					try { addVideoAccordion(); project = videoProjects[index] || null; } catch (addError) { }
				}
				if (!project) continue;
				project._pipelineVid = stored.vid || pipelineManagementStore.pageId + "-editor-" + String(index + 1);
				project.name = stored.name || project.name || "";
				project.script = String(stored.script || "");
				project.videoImageStyle = stored.style || project.videoImageStyle || "";
				project._seoTopic = stored.topic || project._seoTopic || "my video";
				project._seoMinutes = pipelineManagementNumber(stored.minutes, project._seoMinutes || 1);
				project.resolution = stored.resolution || project.resolution || "";
				project.orientation = stored.orientation || project.orientation || "";
				project.quality = stored.quality || project.quality || "";
				if (stored.projectDetail && typeof stored.projectDetail === "object") {
					project.projectDetail = stored.projectDetail;
				}
				project._scriptWriting = false;
				project._imageFlowActive = false;
				project._imageFlowFinalizing = false;
			}
			try { renderBatchTable(); } catch (renderError) { }
			return snapshot;
		} finally {
			pipelineManagementRestoring = false;
			if (purgedBlankCount > 0) {
				try { persistPipelineManagementState("purge-blank-rows"); } catch (persistErr) { }
			}
		}
	}

	/*
	 * Session 331 follow-up — the timeline edit hand-back
	 * ---------------------------------------------------
	 * The timeline editor runs in its own tab and its own page store, but the
	 * Quick Batch table that opened it keeps its rows in a DIFFERENT page store
	 * (the tab's own page id). Pressing "← Quick Batch" now publishes a compact
	 * summary of the edit into that table page's store, which is the same
	 * verified write the table itself performs: ONE localStorage entry plus the
	 * FOUR cookie chunks. The table tab picks it up from its storage event (or
	 * its next restore) and applies it to the row.
	 */
	function timelineEditStoreFor(sourcePageId) {
		const id = String(sourcePageId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
		if (!id) return null;
		if (id === pipelineManagementStore.pageId) return pipelineManagementStore;
		const factory = window.__PIPELINE_MANAGEMENT_STORE_FACTORY__;
		if (typeof factory !== "function") return null;
		try { return factory(window, id); } catch (error) { return null; }
	}

	/*
	 * Apply a saved edit to the row in memory: scene order first, then the
	 * per-scene length (through the slide's own duration override), so both the
	 * table Preview and the Export paint the timeline exactly as it was saved.
	 */
	/* The digits a slide id ends with ("batch-7-img-3" -> 3), parsed by hand. */
	function trailingDigits(value) {
		const text = String(value || "");
		let digits = "";
		for (let index = text.length - 1; index >= 0; index--) {
			const code = text.charCodeAt(index);
			if (code < 48 || code > 57) break;
			digits = text.charAt(index) + digits;
		}
		return digits ? Number(digits) : -1;
	}

	function cloneOrReuseBatchSlide(source, item, idx, style, effects, forceFreshMedia) {
		const durationSec = Math.min(MP4_MAX_DURATION_S, Math.max(0.1, Number(item.d) || Number(item.durationSec) || 1));
		const mediaType = Number(item.t) === 1 || item.mediaType === "video"
			? "mp4"
			: (Number(item.t) === 2 || item.mediaType === "gif" ? "gif" : "image");
		const assetId = String(item.a || item.assetId || (Number(item.i) >= 0 ? "scene-" + (Number(item.i) + 1) : ""));
		const sceneId = String(item.id || item.sceneId || ("scene-" + (idx + 1)));
		const mediaIndex = Number.isInteger(Number(item.i)) ? Number(item.i) : (Number.isInteger(Number(item.mediaIndex)) ? Number(item.mediaIndex) : -1);
		const isTemplateScene = Boolean(item.tpl || item.isTemplateScene || String(item.src || item.mediaSource || "") === "template composer");
		const slideVideoStyle = isTemplateScene && (item.st || item.videoStyle) ? String(item.st || item.videoStyle) : style;
		const slideStyleCode = String(item.sc || item.style || slideVideoStyle);
		const slideEffects = isTemplateScene && Array.isArray(item.ef || item.effects) ? (item.ef || item.effects).slice() : effects.slice();
		const rawTrn = item.trn || item.transition;
		const slideTransition = rawTrn && typeof rawTrn === "object"
			? Object.assign({}, rawTrn)
			: { type: "none", speed: 1, effect: "none", motionSpeed: 1 };
		if (source) {
			const sourceAssetId = String(source.assetId || (Number.isInteger(Number(source.imageIndex)) && Number(source.imageIndex) >= 0 ? "scene-" + (Number(source.imageIndex) + 1) : ""));
			const assetChanged = Boolean((assetId && sourceAssetId && assetId !== sourceAssetId) || (source.type && source.type !== mediaType));
			const target = Object.assign({}, source);
			target.id = String(item.slideId || (idx === 0 ? source.id : (source.id + "-copy-" + idx)));
			target.sceneId = sceneId;
			target.assetId = assetId || source.assetId || "";
			target.name = String(item.n || source.name || ("Scene " + (idx + 1)));
			if (item.m || item.mediaName) target.mediaName = String(item.m || item.mediaName);
			if (item.src || item.mediaSource) target.mediaSource = String(item.src || item.mediaSource);
			target.type = mediaType;
			target.mediaType = mediaType === "mp4" ? "video" : mediaType;
			target.mediaIndex = mediaIndex >= 0 ? mediaIndex : (source.imageIndex != null ? source.imageIndex : source.mediaIndex);
			if (mediaIndex >= 0) target.imageIndex = mediaIndex;
			else if (assetChanged) target.imageIndex = undefined;
			target.startSec = Math.max(0, Number(item.s) || 0);
			target.durationSec = durationSec;
			target._partialSec = durationSec;
			if (!(Number(target.duration) > 0) || assetChanged) target.duration = durationSec;
			target.trimStartSec = Math.max(0, Number(item.tr) || 0);
			target.fit = Number(item.f) === 1 ? "contain" : "cover";
			target.visible = Number(item.v) !== 0;
			target.isTemplateScene = isTemplateScene;
			target.style = slideStyleCode;
			target.videoStyle = slideVideoStyle;
			target.effects = slideEffects;
			target.transition = slideTransition;
			if (assetChanged) {
				target.img = null;
				target.videoEl = null;
				target.gif = null;
				target._hydratedAssetId = "";
			} else if (forceFreshMedia && mediaType === "mp4") {
				if (source.videoEl && source.videoEl.src && typeof document !== "undefined") {
					const video = document.createElement("video");
					video.muted = true;
					video.playsInline = true;
					video.preload = "auto";
					video.src = source.videoEl.src;
					target.videoEl = video;
					target.img = video;
				} else {
					target.videoEl = null;
					target.img = null;
				}
			}
			return target;
		}
		return {
			id: String(item.slideId || ("batch-scene-" + (idx + 1))),
			cardId: "",
			sceneId: sceneId,
			assetId: assetId,
			imageIndex: mediaIndex >= 0 ? mediaIndex : undefined,
			mediaIndex: mediaIndex,
			name: String(item.n || ("Scene " + (idx + 1))),
			mediaName: String(item.m || item.mediaName || ""),
			mediaSource: String(item.src || item.mediaSource || ""),
			type: mediaType,
			mediaType: mediaType === "mp4" ? "video" : mediaType,
			startSec: Math.max(0, Number(item.s) || 0),
			durationSec: durationSec,
			duration: durationSec,
			_partialSec: durationSec,
			trimStartSec: Math.max(0, Number(item.tr) || 0),
			fit: Number(item.f) === 1 ? "contain" : "cover",
			visible: Number(item.v) !== 0,
			isTemplateScene: isTemplateScene,
			style: slideStyleCode,
			videoStyle: slideVideoStyle,
			effects: slideEffects,
			transition: slideTransition,
			img: null
		};
	}

	function applyTimelineEditToBatchRow(row) {
		if (!row) return false;
		const regenAt = Number(row._timelineRegeneratedAt) || 0;
		let edit = row.timeline && typeof row.timeline === "object" ? row.timeline : null;
		if (edit && regenAt > 0 && Number(edit.updatedAt || 0) <= regenAt) {
			edit = null;
		}
		const rawPersistedFull = readTimelineEditorStateForRow(row);
		const persistedFull = rawPersistedFull && (!regenAt || Number(rawPersistedFull.updatedAt || 0) > regenAt)
			? rawPersistedFull
			: null;
		if (persistedFull) {
			const persistedAt = Number(persistedFull.updatedAt) || 0;
			const editAt = Number(edit && edit.updatedAt) || 0;
			if (!edit || !Array.isArray(edit.sceneItems) || persistedAt >= editAt) {
				const composedSummary = composeTimelineSummaryFromState(persistedFull, row);
				if (composedSummary) {
					edit = Object.assign({}, edit || {}, composedSummary);
					row.timeline = edit;
					if (composedSummary.key && !row.timelineKey) row.timelineKey = composedSummary.key;
				}
			}
		}
		row.timelineEdited = Boolean(edit);
		if (!edit) {
			row.timelineDurationSec = 0;
			row.timelineSceneCount = 0;
			return false;
		}
		row.timelineDurationSec = Math.max(0, Number(edit.durationSec) || 0);
		row.timelineUpdatedAt = Math.max(Number(row.timelineUpdatedAt) || 0, Number(edit.updatedAt) || 0);
		if (edit.vid && !row.vid) row.vid = String(edit.vid);
		if (edit.videoStyle && typeof SEO_IMAGE_STYLES !== "undefined" && SEO_IMAGE_STYLES.indexOf(String(edit.videoStyle)) !== -1) {
			row.style = String(edit.videoStyle);
		}
		if (edit.frame && typeof edit.frame === "object") {
			if (edit.frame.resolution && typeof batchResolution === "function") {
				row.resolution = batchResolution(edit.frame.resolution);
			}
			if (edit.frame.orientation && typeof batchOrientation === "function") {
				row.orientation = batchOrientation(edit.frame.orientation).value;
			}
		}
		const style = String(row.style || edit.videoStyle || "Cinematic Film");
		const effects = typeof window.__videoStyleEffects === "function" ? window.__videoStyleEffects(style) : [];
		const entries = Array.isArray(edit.scenes) ? edit.scenes : [];
		const sceneItems = Array.isArray(edit.sceneItems) && edit.sceneItems.length
			? edit.sceneItems
			: (Array.isArray(row.slideItems) && row.slideItems.length ? row.slideItems : []);
		row.timelineSceneCount = sceneItems.length || entries.length;
		const slides = Array.isArray(row.slides) ? row.slides.slice() : [];
		const byMedia = new Map();
		const bySceneId = new Map();
		const byAssetId = new Map();
		slides.forEach(function (slide, position) {
			if (!slide) return;
			const id = String(slide.id || "");
			const named = id.indexOf("-img-") >= 0 || id.indexOf("-clip-") >= 0 || id.indexOf("-gif-") >= 0;
			const mediaIndex = slide.imageIndex != null
				? Number(slide.imageIndex)
				: (named ? trailingDigits(id) : (slide.mediaIndex != null && Number(slide.mediaIndex) >= 0 ? Number(slide.mediaIndex) : position));
			if (mediaIndex >= 0 && !byMedia.has(mediaIndex)) byMedia.set(mediaIndex, slide);
			if (slide.sceneId && !bySceneId.has(String(slide.sceneId))) bySceneId.set(String(slide.sceneId), slide);
			if (slide.assetId && !byAssetId.has(String(slide.assetId))) byAssetId.set(String(slide.assetId), slide);
		});

		if (sceneItems.length) {
			const usedSources = new Set();
			const composedSlides = [];
			sceneItems.forEach(function (item, idx) {
				if (!item || typeof item !== "object") return;
				const mediaIndex = item.i != null ? Number(item.i) : -1;
				const candidate = (item.a && byAssetId.get(String(item.a))) ||
					(item.id && bySceneId.get(String(item.id))) ||
					(mediaIndex >= 0 ? byMedia.get(mediaIndex) : null) ||
					null;
				const isDuplicate = Boolean(candidate && usedSources.has(candidate));
				if (candidate) usedSources.add(candidate);
				if (candidate && !isDuplicate && slides.length) {
					const updated = cloneOrReuseBatchSlide(candidate, item, idx, style, effects, false);
					/* Keep direct object identity for non-duplicated slides when matched by mediaIndex. */
					Object.assign(candidate, updated);
					composedSlides.push(candidate);
				} else {
					composedSlides.push(cloneOrReuseBatchSlide(candidate, item, idx, style, effects, isDuplicate));
				}
			});
			row.slides = composedSlides;
			row.slideItems = composeBatchSlideItems(row);
			row.projectDetail = composeBatchProjectDetail(row, persistedFull);
			if (row.stage === "done" && row.timelineSceneCount > 0 && typeof formatSeconds === "function") {
				row.detail = "Edited in timeline \u00b7 " + row.timelineSceneCount +
					(row.timelineSceneCount === 1 ? " scene" : " scenes") +
					(row.timelineDurationSec > 0 ? " \u00b7 " + formatSeconds(row.timelineDurationSec) : "");
			}
			try { if (typeof syncCompletedBatchRowFromTimeline === "function") syncCompletedBatchRowFromTimeline(row); } catch (syncErr) { }
			return true;
		}

		if (slides.length && entries.length) {
			const ordered = [];
			entries.forEach(function (entry) {
				if (!Array.isArray(entry)) return;
				const mediaIndex = Number(entry[0]);
				const seconds = Number(entry[1]);
				const slide = byMedia.get(mediaIndex);
				if (!slide || ordered.indexOf(slide) !== -1) return;
				if (Number.isFinite(seconds) && seconds > 0) {
					slide._partialSec = Math.min(MP4_MAX_DURATION_S, Math.max(0.1, seconds));
				}
				ordered.push(slide);
			});
			if (ordered.length) {
				row.slides = ordered.concat(slides.filter(function (slide) { return ordered.indexOf(slide) === -1; }));
			}
		} else if (!slides.length && entries.length) {
			row.slides = entries.map(function (entry, idx) {
				const mediaIndex = Number(entry[0]);
				const seconds = Number(entry[1]);
				const typeCode = Number(entry[2]);
				return cloneOrReuseBatchSlide(null, {
					id: mediaIndex >= 0 ? "scene-" + (mediaIndex + 1) : "scene-" + (idx + 1),
					i: mediaIndex,
					a: mediaIndex >= 0 ? "scene-" + (mediaIndex + 1) : "",
					d: seconds,
					t: typeCode
				}, idx, style, effects, false);
			});
		}
		row.slideItems = composeBatchSlideItems(row);
		row.projectDetail = composeBatchProjectDetail(row, persistedFull);
		if (row.stage === "done" && row.timelineSceneCount > 0 && typeof formatSeconds === "function") {
			row.detail = "Edited in timeline \u00b7 " + row.timelineSceneCount +
				(row.timelineSceneCount === 1 ? " scene" : " scenes") +
				(row.timelineDurationSec > 0 ? " \u00b7 " + formatSeconds(row.timelineDurationSec) : "");
		}
		try { if (typeof syncCompletedBatchRowFromTimeline === "function") syncCompletedBatchRowFromTimeline(row); } catch (syncErr) { }
		return true;
	}

	/*
	 * "timeline-<tablePageId>-row-<rowId>" -> { pageId, rowId }
	 *
	 * The timeline page id is BUILT from the table page id (batchRowMediaPageId),
	 * so the way back to the table's store can always be recovered from it — even
	 * when the transition payload was consumed and the saved project is gone,
	 * which is exactly when a publish used to fail with "no table page store" and
	 * the Back link used to drop pipelinePage and land on an empty page.
	 */
	function splitTimelinePageId(value) {
		const text = String(value || "");
		if (text.indexOf("timeline-") !== 0) return null;
		const marker = "-row-";
		const at = text.lastIndexOf(marker);
		if (at <= "timeline-".length) return null;
		const pageId = text.slice("timeline-".length, at);
		const rowId = text.slice(at + marker.length);
		if (!pageId || !rowId) return null;
		return { pageId: pageId, rowId: rowId };
	}

	/*
	 * The hand-back the pipeline store keeps.
	 *
	 * This is a SUMMARY, not the project: the timeline editor already persists
	 * the whole thing under ytvs.timeline-editor.v1.<projectId> (localStorage)
	 * and its own eight cookie chunks, and readTimelineEditorStateForRow() +
	 * composeTimelineSummaryFromState() rebuild the text, graphics and audio
	 * from there on the table side. Publishing the project a second time into
	 * the table's four-cookie store is what blew its budget and made the store
	 * shred the row's script to fit. What stays here is what only this store
	 * knows: which row, which scene order, which length per scene.
	 */
	function compactTimelineEditForStorage(edit) {
		if (!edit || typeof edit !== "object") return null;
		const compact = {
			v: Number(edit.v) || 1,
			updatedAt: Number(edit.updatedAt) || Date.now(),
			key: String(edit.key || ""),
			pageId: String(edit.pageId || ""),
			sourcePageId: String(edit.sourcePageId || ""),
			rowId: String(edit.rowId || ""),
			vid: String(edit.vid || ""),
			durationSec: Number(edit.durationSec) || 0,
			sceneCount: Number(edit.sceneCount) || 0,
			clipCount: Number(edit.clipCount) || 0,
			textCount: Number(edit.textCount) || 0,
			videoStyle: String(edit.videoStyle || ""),
			frame: {
				width: Number(edit.frame && edit.frame.width) || 0,
				height: Number(edit.frame && edit.frame.height) || 0,
				resolution: String(edit.frame && edit.frame.resolution || ""),
				orientation: String(edit.frame && edit.frame.orientation || "")
			},
			scenes: (Array.isArray(edit.scenes) ? edit.scenes : []).map(function (entry) {
				return Array.isArray(entry) ? entry.slice(0, 3) : entry;
			})
		};
		if (Array.isArray(edit.sceneItems) && edit.sceneItems.length) {
			compact.sceneItems = edit.sceneItems.map(function (item) {
				if (!item || typeof item !== "object") return null;
				const out = {
					id: String(item.id || ""),
					slideId: String(item.slideId || ""),
					i: Number(item.i),
					a: String(item.a || ""),
					t: Number(item.t) || 0,
					s: Number(item.s) || 0,
					d: Number(item.d) || 0,
					tr: Number(item.tr) || 0,
					f: Number(item.f) || 0,
					v: Number(item.v) === 0 ? 0 : 1
				};
				if (item.n) out.n = String(item.n).slice(0, 32);
				if (item.m) out.m = String(item.m).slice(0, 40);
				if (item.src) out.src = String(item.src).slice(0, 28);
				if (item.tpl || String(item.src || "") === "template composer") {
					out.tpl = 1;
					if (item.st) out.st = String(item.st).slice(0, 32);
					if (item.sc) out.sc = String(item.sc).slice(0, 24);
					if (Array.isArray(item.ef) && item.ef.length) out.ef = item.ef.slice(0, 6);
				}
				if (item.trn && typeof item.trn === "object" && (out.tpl || (item.trn.type && item.trn.type !== "none"))) {
					out.trn = {
						type: String(item.trn.type || "none").slice(0, 20),
						speed: pipelineManagementNumber(item.trn.speed, 1),
						effect: String(item.trn.effect || "none").slice(0, 20),
						motionSpeed: pipelineManagementNumber(item.trn.motionSpeed, 1)
					};
				}
				return out;
			}).filter(function (item) { return Boolean(item); });
		}
		return compact;
	}

	/*
	 * Write the edit into the table page's store (localStorage + four cookies).
	 * Called from the timeline tab; harmless on the table tab itself.
	 */
	function publishTimelineEdit(payload) {
		const result = { ok: false, reason: "", source: "none", pageId: "", rows: 0, cookies: 0, timestampMatched: false, updatedAt: 0 };
		const edit = payload && payload.summary && typeof payload.summary === "object" ? payload.summary : null;
		if (!edit) {
			result.reason = "no timeline summary";
			window.__TIMELINE_EDIT_PUBLISH__ = result;
			return result;
		}
		/* The table page is found by the hand-off's own page id, then by the timeline page id it was built from. */
		const derived = splitTimelinePageId(edit.pageId) || splitTimelinePageId(payload && payload.key);
		const sourcePageId = String(
			(payload && payload.sourcePageId) ||
			edit.sourcePageId ||
			(derived && derived.pageId) ||
			""
		);
		const store = timelineEditStoreFor(sourcePageId);
		if (!store) {
			result.reason = "the table page store is unavailable";
			window.__TIMELINE_EDIT_PUBLISH__ = result;
			return result;
		}
		const loaded = store.load();
		const snapshot = loaded && loaded.snapshot ? loaded.snapshot : {
			version: 1, pageId: store.pageId, updatedAt: Date.now(), layout: "table",
			quickBatch: { runBusy: false, queued: [], finishedCount: 0, rows: [] },
			editor: { projects: [] }, videoIds: []
		};
		const quickBatch = snapshot.quickBatch && typeof snapshot.quickBatch === "object" ? snapshot.quickBatch : null;
		if (!quickBatch) {
			result.reason = "the table page snapshot is not shape-compatible";
			window.__TIMELINE_EDIT_PUBLISH__ = result;
			return result;
		}
		if (!Array.isArray(quickBatch.rows)) quickBatch.rows = [];
		if (!snapshot.editor || typeof snapshot.editor !== "object") snapshot.editor = { projects: [] };
		const rowId = String(
			(payload && payload.rowId) ||
			edit.rowId ||
			(derived && derived.rowId) ||
			""
		).trim();
		const vid = String((payload && payload.vid) || edit.vid || "").trim();
		let row = quickBatch.rows.find(function (candidate) {
			if (!candidate || typeof candidate !== "object") return false;
			if (rowId && String(candidate.id) === rowId) return true;
			return Boolean(vid && String(candidate.vid) === vid);
		}) || null;
		const effectiveScript = String(
			(row && row.script) ||
			(payload && payload.script) ||
			""
		).trim();
		if (!effectiveScript) {
			/* Blank-script rows must never persist timeline/project details; purge them. */
			quickBatch.rows = quickBatch.rows.filter(function (candidate) {
				if (!candidate || typeof candidate !== "object") return false;
				if (!String(candidate.script || "").trim()) return false;
				if (rowId && String(candidate.id) === rowId) return false;
				if (vid && String(candidate.vid) === vid) return false;
				return true;
			});
			purgeRowLocalAndCookieEntries(rowId, {
				vid: vid,
				key: String(edit.key || payload.key || ""),
				pageId: String(edit.pageId || "")
			});
			snapshot.updatedAt = Date.now();
			store.save(snapshot);
			result.reason = "blank script rows are not stored";
			result.pageId = store.pageId;
			result.rows = quickBatch.rows.length;
			window.__TIMELINE_EDIT_PUBLISH__ = result;
			return result;
		}
		if (!row) {
			if (!rowId) {
				result.reason = "the hand-off carries no row id";
				window.__TIMELINE_EDIT_PUBLISH__ = result;
				return result;
			}
			row = { id: rowId, vid: vid || store.pageId + "-row-" + rowId, script: String(payload.script || ""), stage: "ready" };
			quickBatch.rows.push(row);
		}
		if (vid && !row.vid) row.vid = vid;
		if (!row.vid && rowId) row.vid = store.pageId + "-row-" + rowId;
		/*
		 * Keep the edited timeline summary AND full projectDetail in localStorage;
		 * pipeline-management-store's cookieMirror() sheds large arrays ONLY in the
		 * 4-cookie mirror when needed, so scripts are never shredded and the row's
		 * vid projectDetail stays 100% updated in browser storage.
		 */
		const storedEdit = compactTimelineEditForStorage(edit) || edit;
		let effectiveUpdatedAt = Number(edit.updatedAt) || Date.now();
		if (Number(row.timelineRegeneratedAt) > 0 && effectiveUpdatedAt <= Number(row.timelineRegeneratedAt)) {
			effectiveUpdatedAt = Number(row.timelineRegeneratedAt) + 1;
		}
		storedEdit.updatedAt = effectiveUpdatedAt;
		row.timeline = storedEdit;
		row.timelineKey = String(storedEdit.key || edit.key || payload.key || "");
		row.timelineUpdatedAt = effectiveUpdatedAt;
		if (edit.videoStyle) row.style = String(edit.videoStyle);
		if (edit.frame && typeof edit.frame === "object") {
			if (edit.frame.resolution) row.resolution = String(edit.frame.resolution);
			if (edit.frame.orientation) row.orientation = String(edit.frame.orientation);
		}
		if (Array.isArray(storedEdit.sceneItems) && storedEdit.sceneItems.length) {
			row.slides = storedEdit.sceneItems.length;
		}
		if (edit.projectDetail && typeof edit.projectDetail === "object") {
			const detail = Object.assign({}, edit.projectDetail);
			/* Arrays live in ytvs.timeline-editor.v1.<targetPageId> and are recomposed onto row.projectDetail on read/reconcile. */
			delete detail.scenes;
			delete detail.slides;
			delete detail.elements;
			detail.id = String(row.id || detail.id || "");
			detail.rowId = String(row.id || detail.rowId || "");
			detail.vid = String(row.vid || detail.vid || "");
			detail.sourcePageId = String(store.pageId || detail.sourcePageId || "");
			detail.targetPageId = String(edit.pageId || detail.targetPageId || "");
			detail.updatedAt = Math.max(Number(detail.updatedAt) || 0, effectiveUpdatedAt) || Date.now();
			row.projectDetail = detail;
			if (edit.projectDetail.hasCompletedMedia) {
				row.images = Math.max(Number(row.images) || 0, Number(edit.projectDetail.sceneCount) || 0);
				if (Number(edit.projectDetail.audioCount) > 0 || (Array.isArray(edit.audios) && edit.audios.length > 0)) {
					row.mp3 = true;
				}
				if (row.mp3 && (Number(row.images) >= 12 || Boolean(row.finished))) {
					row.stage = "done";
					row.animated = true;
					row.finished = true;
				}
			}
		} else {
			row.projectDetail = composeBatchProjectDetail(Object.assign({}, row, { timeline: edit }));
		}
		if (row.stage === "done") {
			const scCount = Number(row.projectDetail && row.projectDetail.sceneCount) || Number(storedEdit.sceneCount) || 0;
			const durSec = Number(row.projectDetail && row.projectDetail.durationSec) || Number(storedEdit.durationSec) || 0;
			if (scCount > 0 && typeof formatSeconds === "function") {
				row.detail = "Edited in timeline \u00b7 " + scCount + (scCount === 1 ? " scene" : " scenes") +
					(durSec > 0 ? " \u00b7 " + formatSeconds(durSec) : "");
			}
		}
		snapshot.updatedAt = Date.now();
		const saved = store.save(snapshot);
		try { if (typeof syncCompletedBatchRowFromTimeline === "function") syncCompletedBatchRowFromTimeline(row); } catch (syncArchiveErr) { }
		result.ok = Boolean(saved && saved.ok);
		result.reason = result.ok ? "saved" : String(saved && (saved.reason || "the store did not verify the write"));
		result.source = String(loaded && loaded.source || "none");
		result.pageId = store.pageId;
		result.rows = quickBatch.rows.length;
		result.cookies = Number(saved && saved.cookies) || 0;
		result.timestampMatched = Boolean(saved && saved.timestampMatched);
		result.updatedAt = snapshot.updatedAt;
		window.__TIMELINE_EDIT_PUBLISH__ = result;
		/*
		 * A table tab publishing (the editor was opened in the same page) also
		 * updates the row it can see, so the table never shows the old timing.
		 */
		if (store === pipelineManagementStore) {
			const live = batchRows.find(function (candidate) { return String(candidate.id) === String(row.id); });
			if (live) {
				live.timeline = row.timeline;
				live.timelineKey = row.timelineKey;
				live.timelineUpdatedAt = row.timelineUpdatedAt;
				if (row.projectDetail) live.projectDetail = Object.assign({}, row.projectDetail);
				applyTimelineEditToBatchRow(live);
				if (batchRowNeedsTimelineAssetHydration(live)) {
					hydrateBatchRowAssetsFromTimeline(live).catch(function () { });
				}
				try { paintBatchRowStatus(live); } catch (paintError) { }
				try { renderBatchTable(); } catch (renderError) { }
			}
		}
		return result;
	}

	/*
	 * Pick up an edit published by another tab (either via the pipeline store or
	 * directly via the timeline project store) without re-reading the whole
	 * table: only rows whose stored timeline is newer than the one in memory are
	 * touched, so typing in a row is never reverted.
	 */
	function reconcileTimelineEdits() {
		let changed = 0;
		let needsStoreSync = false;
		let loaded = null;
		try { loaded = pipelineManagementStore.load(); } catch (loadError) { return 0; }
		const snapshot = loaded && loaded.snapshot;
		try { purgeBlankRowArtifactsInStorage(snapshot); } catch (purgeError) { }
		const storedRows = snapshot && snapshot.quickBatch && Array.isArray(snapshot.quickBatch.rows) ? snapshot.quickBatch.rows : [];
		const storedById = new Map();
		storedRows.forEach(function (stored) {
			if (stored && typeof stored === "object" && stored.id != null) {
				storedById.set(String(stored.id), stored);
			}
		});
		batchRows.forEach(function (row) {
			if (!row || !String(row.script || "").trim()) return;
			const regenAt = Number(row._timelineRegeneratedAt) || 0;
			const stored = storedById.get(String(row.id)) || null;
			let incoming = stored && stored.timeline && typeof stored.timeline === "object" ? stored.timeline : null;
			const storedAt = Math.max(Number(stored && stored.timelineUpdatedAt) || 0, Number(incoming && incoming.updatedAt) || 0);
			const fullEditorState = readTimelineEditorStateForRow(Object.assign({}, row, {
				timelineKey: (stored && stored.timelineKey) || row.timelineKey
			}));
			const fullAt = Number(fullEditorState && fullEditorState.updatedAt) || 0;
			if (fullEditorState && (!regenAt || fullAt > regenAt) && (!incoming || fullAt >= storedAt)) {
				const composed = composeTimelineSummaryFromState(fullEditorState, row);
				if (composed) {
					incoming = composed;
					if (fullAt > storedAt) needsStoreSync = true;
				}
			}
			const incomingAt = Math.max(storedAt, Number(incoming && incoming.updatedAt) || 0);
			const currentAt = batchRowTimelineUpdatedAt(row);
			if (!incoming || incomingAt <= currentAt) return;
			if (regenAt > 0 && incomingAt <= regenAt) return;
			row.timeline = incoming;
			row.timelineKey = String((stored && stored.timelineKey) || incoming.key || row.timelineKey || "");
			row.timelineUpdatedAt = incomingAt;
			if (stored && stored.projectDetail && typeof stored.projectDetail === "object" && (!fullEditorState || storedAt >= fullAt)) {
				row.projectDetail = Object.assign({}, stored.projectDetail);
			}
			if (stored && (stored.finished || (stored.mp3 && stored.animated && Number(stored.images) > 0))) {
				row._storedFinished = true;
				row._storedMp3 = Boolean(stored.mp3);
				row._storedAnimated = Boolean(stored.animated || stored.finished);
				row._storedImagesCount = Math.max(Number(row._storedImagesCount) || 0, Number(stored.images) || 0);
			}
			applyTimelineEditToBatchRow(row);
			if (batchRowNeedsTimelineAssetHydration(row)) {
				hydrateBatchRowAssetsFromTimeline(row).then(function () {
					try { paintBatchRowStatus(row); } catch (e) { }
					try { renderBatchTable(); } catch (e) { }
				}).catch(function () { });
			}
			try { paintBatchRowStatus(row); } catch (paintError) { }
			changed += 1;
		});
		if (changed) {
			if (needsStoreSync) {
				try { persistPipelineManagementState("timeline-reconcile"); } catch (persistErr) { }
			}
			try { renderBatchTable(); } catch (renderError) { }
		}
		window.__TIMELINE_EDIT_RECONCILE__ = { changed: changed, source: String(loaded && loaded.source || "none"), at: Date.now() };
		return changed;
	}

	window.publishTimelineEdit = publishTimelineEdit;
	/* The name the timeline editor calls; it runs before this file's body ends. */
	window.__PUBLISH_TIMELINE_EDIT__ = publishTimelineEdit;
	window.compactTimelineEditForStorage = compactTimelineEditForStorage;
	window.splitTimelinePageId = splitTimelinePageId;
	window.requestedStudioLayout = requestedStudioLayout;
	window.applyTimelineEditToBatchRow = applyTimelineEditToBatchRow;
	window.reconcileTimelineEdits = reconcileTimelineEdits;
	window.composeBatchProjectDetail = composeBatchProjectDetail;
	window.composeBatchSlidesFromTimeline = function (row) {
		applyTimelineEditToBatchRow(row);
		return Array.isArray(row && row.slides) ? row.slides : [];
	};
	window.purgeBlankRowStorage = purgeBlankRowArtifactsInStorage;
	window.hydrateBatchRowAssetsFromTimeline = hydrateBatchRowAssetsFromTimeline;

	// =========================================================
	// DATA
	// =========================================================

	const prompts =
		__PROMPTS_JSON__;


	const gallery =
		document.getElementById(
			"gallery"
		);



	/*
	 * Images selected for the video.
	 */

	const activeSlides = [];


	// =========================================================
	// AUDIO TRACK STATE
	// =========================================================

	/*
	 * Holds the decoded MP3 that will be
	 * muxed into the final MP4.
	 *
	 * currentAudio = {
	 *   name     : string,
	 *   duration : number (seconds),
	 *   buffer   : AudioBuffer,
	 *   url      : blob URL for the preview player
	 * }
	 */

	let currentAudio = null;


	const MAX_GIF_UPLOADS =
		5;


	const MAX_IMAGE_UPLOADS =
		25;


	const MAX_MP4_UPLOADS =
		5;

	/* FINAL MEDIA CAP: both layouts plan the same 12 automatic scenes. */
	const AUTO_MEDIA_TOTAL = 12;
	const AUTO_VIDEO_SCENES = 4;
	const AUTO_IMAGE_SCENES = 8;
	const MEDIA_ITEM_MAX_RETRIES = 7;
	const MEDIA_ITEM_TOTAL_ATTEMPTS = MEDIA_ITEM_MAX_RETRIES + 1;
	const MEDIA_ITEM_RETRY_BACKOFF_MS = 40000;
	const MEDIA_ITEM_UI_CHECK_MS = 250;
	const MEDIA_MAX_PIXABAY_PAGES = 2;
	const MEDIA_TRANSITION_STORAGE_PREFIX = "ytvs.transition-project.v1.";


	const MP4_MAX_DURATION_S =
		60;


	/*
	 * Created lazily because some browsers
	 * warn when an AudioContext is created
	 * before a user gesture.
	 */

	let audioContext = null;


	const audioUploadEl =
		document.getElementById(
			"audio-upload"
		);


	const audioDetailsEl =
		document.getElementById(
			"audio-details"
		);


	const audioEmptyEl =
		document.getElementById(
			"audio-empty"
		);


	const audioNameEl =
		document.getElementById(
			"audio-name"
		);


	const audioPreviewEl =
		document.getElementById(
			"audio-preview"
		);


	const estimateValueEl =
		document.getElementById(
			"estimate-value"
		);


	const estimateSourceEl =
		document.getElementById(
			"estimate-source"
		);


	const estimateSizeEl =
		document.getElementById(
			"estimate-size"
		);


	const qualitySelectEl =
		document.getElementById(
			"quality-select"
		);


	const titleInputEl =
		document.getElementById(
			"title-input"
		);


	const titleFontEl =
		document.getElementById(
			"title-font"
		);


	const titleColorEl =
		document.getElementById(
			"title-color"
		);


	/*
	 * Title overlay settings.
	 *
	 * The size is in canvas pixels, so 15
	 * is 15 real pixels of the exported
	 * video frame.
	 */

	const TITLE_FONT_SIZE =
		22;


	const TITLE_MARGIN =
		24;


	/*
	 * Font choices for the dropdown.
	 *
	 * loadName is used to ask the browser
	 * to fetch the web font.
	 *
	 * stack is what canvas draws with, and
	 * includes fallbacks in case the font
	 * is missing on the machine.
	 */

	const TITLE_FONTS = {

		oswald: {

			loadName:
				"Oswald",

			stack:
				"'Oswald', 'Arial Narrow', sans-serif"

		},

		bauhaus: {

			loadName:
				"Bauhaus 93",

			stack:
				"'Bauhaus 93', 'Bauhaus', 'Futura', 'Century Gothic', sans-serif"

		},

		bookman: {

			loadName:
				"Bookman Old Style",

			stack:
				"'Bookman Old Style', 'Bookman', 'URW Bookman L', Georgia, serif"

		}

	};


	function getTitleFont() {

		return (
			TITLE_FONTS[
				titleFontEl.value
			] ||
			TITLE_FONTS.oswald
		);

	}


	// =========================================================
	// TIMESTAMP CAPTIONS (MAX 10)
	// =========================================================

	/*
	 * Up to ten caption entries can be added with the plus
	 * button. Each one has a timestamp in hour:minute:second
	 * format plus a short text of max 40 characters.
	 */

	const MAX_CAPTIONS =
		10;


	const CAPTION_MAX_CHARS =
		40;


	/*
	 * The last caption does not stay
	 * on screen forever: it
	 * disappears after this many
	 * milliseconds.
	 */
	const CAPTION_MAX_VISIBLE_MS =
		10000;


	const CAPTION_FONT_SIZE =
		17;


	const CAPTION_FONT_STACK =
		"'Bookman Old Style', 'Bookman', 'URW Bookman L', Georgia, serif";


	/*
	 * Subtitles (the plain script) are
	 * drawn below the caption, at
	 * 1/3 of the height up from the
	 * bottom.
	 */

	const SUBTITLE_FONT_SIZE =
		22;


	const SUBTITLE_FONT_STACK =
		"'Bookman Old Style', 'Bookman', 'URW Bookman L', Georgia, serif";


	const captionRowsEl =
		document.getElementById(
			"caption-rows"
		);


	const captionCountEl =
		document.getElementById(
			"caption-count"
		);


	const addCaptionBtn =
		document.getElementById(
			"add-caption-btn"
		);


	/*
	 * Adds one caption row. The plus button is disabled once
	 * MAX_CAPTIONS rows exist.
	 */

	function addCaptionRow() {

		if (
			captionRowsEl.children.length >=
				MAX_CAPTIONS
		) {

			return;

		}


		const row =
			document.createElement(
				"div"
			);


		row.className =
			"caption-row";


		row.innerHTML =
			'<div class="caption-time">' +
			'<input type="number" min="0" max="99" step="1" value="0" class="caption-hh" aria-label="Hours">' +
			'<span>:</span>' +
			'<input type="number" min="0" max="59" step="1" value="0" class="caption-mm" aria-label="Minutes">' +
			'<span>:</span>' +
			'<input type="number" min="0" max="59" step="1" value="0" class="caption-ss" aria-label="Seconds">' +
			'</div>' +
			'<div class="caption-text-wrap">' +
			'<input type="text" class="caption-text" maxlength="' +
				CAPTION_MAX_CHARS +
			'" placeholder="Caption text (max ' +
				CAPTION_MAX_CHARS +
			' characters)">' +
			'<span class="caption-chars">0/' +
				CAPTION_MAX_CHARS +
			'</span>' +
			'</div>' +
			'<button type="button" class="caption-remove" title="Remove caption" onclick="removeCaptionRow(this)">&times;</button>';


		const textInput =
			row.querySelector(
				".caption-text"
			);


		textInput.addEventListener(
			"input",
			() => {

				row.querySelector(
					".caption-chars"
				).textContent =
					textInput.value.length +
					"/" +
					CAPTION_MAX_CHARS;

			}
		);


		captionRowsEl.appendChild(
			row
		);


		updateCaptionCount();

	}


	function removeCaptionRow(
		button
	) {

		const row =
			button.closest(
				".caption-row"
			);


		if (row) {
			row.remove();
		}


		updateCaptionCount();

	}


	function updateCaptionCount() {

		const count =
			captionRowsEl.children.length;


		captionCountEl.textContent =
			count +
			"/" +
			MAX_CAPTIONS;


		addCaptionBtn.disabled =
			count >=
				MAX_CAPTIONS;

	}


	function clampInt(
		value,
		min,
		max
	) {

		const n =
			parseInt(
				value,
				10
			);


		if (
			!Number.isFinite(
				n
			)
		) {

			return min;

		}


		return Math.min(
			max,
			Math.max(
				min,
				n
			)
		);

	}


	/*
	 * Reads the visible rows into sorted caption objects.
	 * Rows without text are ignored, and out of range hours,
	 * minutes and seconds are clamped.
	 */

	function getCaptions() {

		const captions =
			[];


		for (
			const row of
				captionRowsEl.children
		) {

			const text =
				row.querySelector(
					".caption-text"
				).value.trim();


			if (!text) {
				continue;
			}


			const hours =
				clampInt(
					row.querySelector(
						".caption-hh"
					).value,
					0,
					99
				);


			const minutes =
				clampInt(
					row.querySelector(
						".caption-mm"
					).value,
					0,
					59
				);


			const seconds =
				clampInt(
					row.querySelector(
						".caption-ss"
					).value,
					0,
					59
				);


			captions.push(
				{
					text:
						text.slice(
							0,
							CAPTION_MAX_CHARS
					),

					timeMs:
						((hours * 60 + minutes) * 60 + seconds) * 1000
				}
			);

		}


		captions.sort(
			(a, b) =>
				a.timeMs -
					b.timeMs
		);


		return captions;

	}


	/*
	 * Warms up the Bookman font before the first frame is
	 * drawn, so the canvas does not fall back to a default
	 * font.
	 */

	async function loadCaptionFont() {

		if (
			!document.fonts ||
			!document.fonts.load
		) {

			return;

		}


		try {

			// Font loading is optional: an offline font service must not hold
			// the renderer (and the rest of the queue) indefinitely.
			await mediaDeadline(document.fonts.load(
				CAPTION_FONT_SIZE +
				'px "Bookman Old Style"'
			), 8000, "Caption font loading timed out; using a fallback font.");

		}
		catch (error) {

			console.warn(
				"Caption font load failed:",
				error
			);

		}

	}


	/*
	 * Draws the active caption onto the current frame.
	 *
	 * Position: centred horizontally, at 4/7 of the frame
	 * height measured from the bottom.
	 *
	 * Style: 17px Bookman, black text on a white highlight
	 * box, max 40 characters.
	 *
	 * A caption is shown from its timestamp until the next
	 * caption appears (or until the video ends).
	 */

	function drawCaptions(
		context,
		captions,
		timestampMs,
		width,
		height
	) {

		if (
			!captions.length
		) {

			return;

		}


		let active =
			null;


		for (
			const caption of
				captions
		) {

			if (
				caption.timeMs <=
					timestampMs
			) {

				active =
					caption;

			}
			else {

				break;

			}

		}


		if (!active) {
			return;
		}


		/*
		 * The last caption is capped:
		 * after CAPTION_MAX_VISIBLE_MS
		 * it no longer shows.
		 */
		if (
			captions[captions.length - 1] ===
				active &&
			timestampMs -
				active.timeMs >
				CAPTION_MAX_VISIBLE_MS
		) {

			return;

		}


		context.save();


		context.font =
			CAPTION_FONT_SIZE +
			"px " +
			CAPTION_FONT_STACK;


		context.textAlign =
			"center";


		context.textBaseline =
			"middle";


		/*
		 * Centre of the text: middle of the frame
		 * horizontally, 4/7 of the height up from the
		 * bottom.
		 */

		const x =
			width / 2;


		const y =
			height -
			(height * 4) / 7;


		const textWidth =
			context.measureText(
				active.text
			).width;


		const padX =
			10;


		const padY =
			6;


		const boxWidth =
			textWidth +
			padX * 2;


		const boxHeight =
			CAPTION_FONT_SIZE +
			padY * 2 +
			4;


		const boxX =
			x - boxWidth / 2;


		const boxY =
			y - boxHeight / 2;


		/*
		 * White highlight behind the
		 * text, with square corners
		 * (no rounding).
		 */

		context.fillStyle =
			"#ffffff";


		context.beginPath();


		context.rect(
			boxX,
			boxY,
			boxWidth,
			boxHeight
		);


		context.fill();


		/*
		 * Black text on top.
		 */

		context.fillStyle =
			"#000000";


		context.fillText(
			active.text,
			x,
			y
		);


		context.restore();

	}


	/*
	 * Draws the active script subtitle
	 * onto the current frame.
	 *
	 * Position: centred horizontally,
	 * at 1/3 of the frame height measured
	 * from the bottom (below the 4/7
	 * caption).
	 *
	 * Style: white 22px text on a
	 * translucent black box.
	 */

	function drawSubtitles(
		context,
		subs,
		timestampMs,
		width,
		height
	) {

		if (!subs.length) {

			return;

		}


		let active =
			null;


		for (
			const sub of
				subs
		) {

			if (
				timestampMs >=
					sub.startMs &&
				timestampMs <
					sub.endMs
			) {

				active =
					sub;

				break;

			}

		}


		if (!active) {

			return;

		}


		context.save();


		context.font =
			SUBTITLE_FONT_SIZE +
			"px " +
			SUBTITLE_FONT_STACK;


		context.textAlign =
			"center";


		context.textBaseline =
			"middle";


		/*
		 * Centre of the text: middle of
		 * the frame horizontally, 1/3 of
		 * the height up from the bottom.
		 */

		const x =
			width / 2;


		const y =
			height -
			height / 3;


		// Canvas fillText does not lay out newline-separated lines. The
		// shared cue builder wraps long sentences with newlines, so draw
		// each line separately in both editor and quick-batch exports.
		const lines = String(active.text || "").split("\\n");
		const padX = 10;
		const padY = 6;
		const lineHeight = SUBTITLE_FONT_SIZE + 4;
		const maxLineWidth = Math.max(1, width - padX * 2);
		const textWidth = Math.min(maxLineWidth, Math.max.apply(null, lines.map(function (line) {
			return context.measureText(line).width;
		})));
		const boxWidth = textWidth + padX * 2;
		const boxHeight = lines.length * lineHeight + padY * 2;


		const boxX =
			x - boxWidth / 2;


		const boxY =
			y - boxHeight / 2;


		/*
		 * Translucent black box behind
		 * the white text.
		 */

		context.fillStyle =
			"rgba(0, 0, 0, 0.55)";


		context.beginPath();


		context.rect(
			boxX,
			boxY,
			boxWidth,
			boxHeight
		);


		context.fill();


		context.fillStyle =
			"#ffffff";


		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			context.fillText(lines[lineIndex], x,
				y + (lineIndex - (lines.length - 1) / 2) * lineHeight, maxLineWidth);
		}


		context.restore();

	}


	/*
	 * Video quality presets.
	 *
	 * Bitrate drives the file size, and
	 * file size is exactly what crashes
	 * the tab during finalization.
	 *
	 * 2.5 Mbps is already very clean for
	 * slow panning stills at 720p.
	 */

	const QUALITY_PRESETS = {

		low: {
			width:
				854,
			height:
				480,
			videoBitrate:
				1_200_000,
			audioBitrate:
				128_000
		},

		balanced: {
			width:
				1280,
			height:
				720,
			videoBitrate:
				2_500_000,
			audioBitrate:
				160_000
		},

		high: {
			width:
				1280,
			height:
				720,
			videoBitrate:
				5_000_000,
			audioBitrate:
				192_000
		}

	};


	function getQuality() {

		return (
			QUALITY_PRESETS[
				qualitySelectEl.value
			] ||
			QUALITY_PRESETS.balanced
		);

	}


	/*
	 * Length of a single slide.
	 *
	 * Minimum and maximum are both 9, so
	 * every image is on screen for exactly
	 * 9 seconds.
	 *
	 * When the audio is longer than the
	 * slideshow, the images start over from
	 * the first one until the whole track
	 * is covered.
	 */

	const SLIDE_SECONDS_MIN =
		9;


	const SLIDE_SECONDS_MAX =
		9;


	// =========================================================
	// AUDIO HELPERS
	// =========================================================

	function formatSeconds(value) {

		const numeric =
			Number(value);

		const total =
			Number.isFinite(numeric) &&
			numeric > 0
				? Math.max(
					0,
					Math.round(numeric)
				)
				: 0;


		const minutes =
			Math.floor(
				total / 60
			);


		const seconds =
			total % 60;


		return (
			minutes +
			":" +
			String(seconds)
				.padStart(2, "0")
		);

	}


	function formatBytes(bytes) {

		if (bytes < 1024) {
			return bytes + " B";
		}


		if (bytes < 1024 * 1024) {
			return (
				Math.round(bytes / 1024) +
				" KB"
			);
		}


		return (
			(bytes / 1024 / 1024).toFixed(
				1
			) + " MB"
		);

	}


	function getAudioContext() {

		if (!audioContext) {

			const Context =
				window.AudioContext ||
				window.webkitAudioContext;


			audioContext =
				new Context();

		}


		return audioContext;

	}


	/*
	 * How long each image stays on screen.
	 *
	 * Always 9 seconds, because the minimum
	 * and the maximum are both 9.
	 */

	function getSecondsPerSlide() {

		return Math.min(
			SLIDE_SECONDS_MAX,
			Math.max(
				SLIDE_SECONDS_MIN,
				currentAudio &&
					activeSlides.length >
						0
					? currentAudio.duration /
						activeSlides.length
					: SLIDE_SECONDS_MIN
			)
		);

	}


	/*
	 * The list of images that will actually
	 * be rendered.
	 *
	 * Without audio this is just the
	 * selected slides.
	 *
	 * With audio the selected slides are
	 * repeated from the beginning as many
	 * times as needed, until every second
	 * of the track has an image under it.
	 */

		/*
		 * Seconds a slide occupies in
		 * the video: stills and GIFs
		 * take SLIDE_SECONDS_MIN, MP4
		 * clips play their full length.
	 */
	
	
	/*
	 * Seconds one slide occupies.
	 *
	 * Hardened against the two values a media element can legitimately
	 * report and that used to break the exporter:
	 *
	 *   Infinity  - a fragmented / MediaRecorder MP4 (no duration in
	 *               moov, or a moov written at the end) reports
	 *               \`duration === Infinity\` until the whole file is
	 *               buffered. \`framesForSlide()\` then returned Infinity
	 *               and the per-frame \`for (f = 0; f < frames; f++)\`
	 *               loop never ended, so the video "never finished
	 *               rendering" while the tab stayed busy forever.
	 *   NaN / <=0 - an unreadable clip. Falls back to the still-image
	 *               length instead of producing 0 or NaN frames.
	 *
	 * Both are clamped to the same one-minute cap the upload path
	 * enforces (\`MP4_MAX_DURATION_S\`), so the render length is always a
	 * finite, bounded number of frames.
	 */

	function slideDurationSec(
		slide
	) {

		const raw =

			slide &&
			slide._partialSec !=
				null

				? Number(
					slide._partialSec
				)

				: slide &&
					slide.type ===
						"mp4" &&
					Number(
						slide.duration
					) > 0

					? Number(
						slide.duration
					)

					: SLIDE_SECONDS_MIN;


		if (
			!Number.isFinite(
				raw
			) ||
			raw <= 0
		) {

			return SLIDE_SECONDS_MIN;

		}


		return Math.min(
			raw,
			MP4_MAX_DURATION_S
		);

	}
	
	
	function framesForSlide(
		slide,
		fps
	) {
	
	
		return Math.max(
			1,
			Math.round(
				fps *
				slideDurationSec(
					slide
				)
			)
		);
	
	
	}
	
	
	/*
		 * Seeks a clip to a time in
		 * seconds.
	 */
	
	
	async function seekClipTo(
		video,
		timeSec
	) {
	
	
		if (
			video.readyState >=
				2 &&
			Math.abs(
				video.currentTime -
				timeSec
			) <
				0.02
		) {
	
	
			return;
	
	
		}
	
	
		try {
	
	
			video.currentTime =
				timeSec;
	
	
			await new Promise(
				(resolve) => {
					let done =
						false;
					const finish =
						() => {
							if (!done) {
								done =
									true;
								video.removeEventListener(
									"seeked",
									finish
								);
								resolve();
							}
						};
					video.addEventListener(
						"seeked",
						finish
					);
					setTimeout(
						finish,
						2000
					);
				}
			);
	
	
		}
	
	
		catch (seekError) {
	
	
			console.error(
				"Clip seek failed:",
				seekError
			);
	
	
		}
	
	
	}
	
	
	/*
	 * =========================================================
	 * MP4 CLIP FRAME CAPTURE (bug fix: the export used to hang
	 * forever on the first MP4 slide)
	 * =========================================================
	 *
	 * The renderer used to advance a clip by awaiting
	 * \`requestVideoFrameCallback\` once per output frame, i.e. it
	 * depended on the browser really PRESENTING frames of a
	 * playing <video>. A callback is only delivered for an element
	 * that is actually being composited:
	 *
	 *   - the editor layout's clip element (\`asset.videoEl\`) is
	 *     created with createElement and never attached (the card
	 *     shows its own <video>), and the legacy gallery lives in
	 *     a display:none panel;
	 *   - a background/throttled tab presents no frames at all;
	 *   - an autoplay rejection (\`prepareClip\` only logged it)
	 *     leaves the element paused.
	 *
	 * In all three cases the callback never fired, the \`await\`
	 * never settled, and the status line froze on the last
	 * "Completed image N of M" while \`project.status\` stayed
	 * "rendering" for good - the reported "it did not finish
	 * rendering the video". Nothing threw, so the bulk queue behind
	 * it never advanced either.
	 *
	 * Capture is now bounded and has two modes:
	 *
	 *   playback - real time, exactly as before, while frames
	 *              really arrive (the fast path for a visible,
	 *              attached element);
	 *   seek     - deterministic: the clip is paused and seeked to
	 *              the exact time of the output frame. Seeking and
	 *              drawing work on hidden/detached elements, so
	 *              capture no longer depends on the compositor, on
	 *              the tab being visible or on wall-clock speed.
	 */

	const CLIP_FRAME_TIMEOUT_MS =
		500;


	const CLIP_READY_TIMEOUT_MS =
		4000;


	/*
	 * True once the element has a decoded frame that drawImage()
	 * can copy. Drawing a video with readyState < 2 throws
	 * InvalidStateError, which used to end the whole export with
	 * "Video rendering failed".
	 */

	/*
	 * Reads a clip's real length.
	 *
	 * Two things used to go wrong at upload time:
	 *
	 *   1. The probe <video> was never attached to the document and had
	 *      no deadline. A clip the browser declined to load (unsupported
	 *      codec variant, a container that needs a range request) fired
	 *      neither \`loadedmetadata\` nor \`error\`, so the upload promise
	 *      never settled: the clip never appeared in the accordion, no
	 *      error was shown, and Generate looked like it did nothing.
	 *
	 *   2. Fragmented / MediaRecorder MP4s report \`duration === Infinity\`
	 *      until the whole file is buffered. That value passed the
	 *      "longer than a minute" check (Infinity is not <= 60 either)
	 *      and reached framesForSlide(), which turned it into Infinity
	 *      frames - a \`for\` loop that never ends, i.e. exactly the
	 *      "rendering never finishes" report.
	 *
	 * So: attach the probe off-screen (some browsers will not load a
	 * detached video at all), give the load a deadline, resolve the
	 * Infinity case the standard way (seek far past the end, read the
	 * duration the element settles on), and hand the caller one honest
	 * number or an error.
	 */

	async function probeMp4Duration(
		video,
		clipURL
	) {

		video.muted =
			true;

		video.playsInline =
			true;

		video.preload =
			"auto";

		video.src =
			clipURL;


		let host =
			ensureClipCaptureHost();

		let detach =
			false;


		if (
			video.parentNode !==
			host
		) {

			try {

				host.appendChild(
					video
				);

				detach =
					true;

			}

			catch (attachError) {

				/* decode-in-place is still worth trying */

			}

		}


		try {

			await new Promise(
				(resolve, reject) => {

					let settled =
						false;

					const finish =
						(error) => {

							if (settled) {

								return;

							}

							settled =
								true;


							clearTimeout(
								timer
							);


							for (
								const name of [
									"loadedmetadata",
									"error"
								]
							) {

								video.removeEventListener(
									name,
									onMeta
								);

								video.removeEventListener(
									name,
									onError
								);

							}


							error
								? reject(
									error
								)
								: resolve();

						};

					const onMeta =
						() => finish(
							null
						);

					const onError =
						() => finish(
							new Error(
								"The clip could not be decoded."
							)
						);

					const timer =
						setTimeout(
							() => finish(
								new Error(
									"The clip took too long to load."
								)
							),
							clipProbeTimeoutMs()
						);


					video.addEventListener(
						"loadedmetadata",
						onMeta,
						{
							once:
								true
						}
					);

					video.addEventListener(
						"error",
						onError,
						{
							once:
								true
						}
					);

				}
			);


			let duration =
				Number(
					video.duration
				);


			if (!Number.isFinite(duration)) {

				/*
				 * Ask the element to load the real duration by
				 * seeking past the end; it then reports the
				 * media's actual length. Bounded, because a clip
				 * that never answers is exactly what we are
				 * trying to detect.
				 */

				await new Promise(
					(resolve) => {

						let settled =
							false;

						const finish =
							() => {

								if (settled) {

									return;

								}

								settled =
									true;


								clearTimeout(
									timer
								);


								video.removeEventListener(
									"durationchange",
									finish
								);

								video.removeEventListener(
									"timeupdate",
									finish
								);

								video.removeEventListener(
									"seeked",
									finish
								);


								resolve();

							};

						const timer =
							setTimeout(
								finish,
								3000
							);


						for (
							const name of [
								"durationchange",
								"timeupdate",
								"seeked"
							]
						) {

							video.addEventListener(
								name,
								finish
							);

						}


						try {

							video.currentTime =
								1e101;

						}

						catch (seekError) {

							finish();

						}

					}
				);


				duration =
					Number(
						video.duration
					);


				try {

					video.currentTime =
						0;

				}

				catch (resetError) {

					/* the first frame still lands on 0 */

				}

			}


			if (
				!Number.isFinite(
					duration
				) ||
				duration <=
					0
			) {

				throw new Error(
					"The clip reports no usable length."
				);

			}


			return duration;

		}

		finally {

			if (detach) {

				try {

					if (
						video.parentNode ===
						host
					) {

						host.removeChild(
							video
						);

					}

				}

				catch (detachError) {

					/* nothing else to do */

				}

			}

		}

	}


	/*
	 * Probe a clip with a second (and third) chance.
	 *
	 * firstVideo is reused for attempt 1 so a caller that already built an
	 * element keeps using the one that succeeded; a retry always starts from a
	 * fresh element, because a video element whose load already failed is not
	 * a reliable source for the next attempt.
	 */
	async function probeMp4DurationWithRetry(clipURL, attempts, firstVideo) {

		const tries =
			Math.max(1, Number(attempts) || CLIP_PROBE_ATTEMPTS);
		let lastError =
			null;

		for (let attempt = 1; attempt <= tries; attempt++) {

			const video =
				attempt === 1 && firstVideo
					? firstVideo
					: document.createElement("video");

			try {

				const duration =
					await probeMp4Duration(video, clipURL);
				return duration;

			} catch (error) {

				lastError =
					error;

				console.warn("[clip] probe attempt " + attempt + " of " + tries + " failed", {
					error: String(error && error.message || error).slice(0, 200)
				});

				try {
					video.pause();
					video.removeAttribute("src");
					video.load();
				} catch (resetError) {
					/* a detached element has nothing to clean up */
				}

				if (attempt < tries) {
					await new Promise(function (resolve) {
						setTimeout(resolve, CLIP_PROBE_RETRY_DELAY_MS * attempt);
					});
				}

			}

		}

		console.error("[clip] probe gave up", {
			attempts: tries,
			error: String(lastError && lastError.message || lastError).slice(0, 200)
		});
		throw lastError || new Error("The clip took too long to load.");

	}

	function clipHasFrame(
		video
	) {

		return Boolean(
			video &&
			video.readyState >= 2 &&
			(
				typeof video.videoWidth !==
					"number" ||
				video.videoWidth > 0
			)
		);

	}


	/*
	 * Can this slide's source be copied by drawImage() right now?
	 *
	 * Stills, GIF scratch canvases and canvas sources always can.
	 * A <video> only can once it has a decoded frame; asking it before
	 * that throws InvalidStateError, which is not a rendering failure
	 * worth losing the entire export over.
	 */

	/*
	 * Off-screen host for clip capture.
	 *
	 * \`requestVideoFrameCallback\` only fires while the browser really
	 * composites the element, and a <video> that is detached from the
	 * document (which is exactly what the editor's upload probe builds)
	 * is never composited. Without a parent the capture fell back to
	 * seeking for every single frame - correct, but several times slower
	 * - and on some browsers never presented a frame at all.
	 *
	 * The host is deliberately NOT display:none (a display:none ancestor
	 * stops presentation too): it is parked outside the viewport at
	 * 2x2 px, which keeps decoding and frame presentation active while
	 * being invisible to the user.
	 */

	const CLIP_HOST_ID =
		"clip-capture-host";

	const CLIP_PROBE_TIMEOUT_MS =
		15000;

	/*
	 * A clip probe is a load, and loads fail transiently (a busy disk right
	 * after an export, a container the browser needs a second attempt at).
	 * One failure used to drop the file with "The clip took too long to
	 * load." and give it no second chance - the same file was only probed
	 * again when the user re-uploaded it. It is retried instead.
	 */
	const CLIP_PROBE_ATTEMPTS =
		3;

	const CLIP_PROBE_RETRY_DELAY_MS =
		400;

	/* Tests/debugging may shrink the deadline; production keeps 15 s. */
	function clipProbeTimeoutMs() {
		const override = typeof window !== "undefined" ? window.__CLIP_PROBE_TIMING : null;
		const value = override && Number(override.timeoutMs);
		return value > 0 ? value : CLIP_PROBE_TIMEOUT_MS;
	}


	function ensureClipCaptureHost() {

		let host =
			document.getElementById(
				CLIP_HOST_ID
			);


		if (host) {

			return host;

		}


		host =
			document.createElement(
				"div"
			);


		host.id =
			CLIP_HOST_ID;


		host.setAttribute(
			"aria-hidden",
			"true"
		);


		host.style.cssText =
			"position:fixed;left:-10000px;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1;";


		document.body.appendChild(
			host
		);


		return host;

	}


	/*
	 * Moves a clip into the off-screen host so it can present frames
	 * while it is being captured, and returns a function that puts it
	 * back where it came from.
	 *
	 * A clip that is already connected AND has a layout box (a real
	 * preview the user can see) is left alone - it is already being
	 * composited, and moving it would interrupt the preview.
	 */

	function mountClipForCapture(
		video
	) {

		if (
			!video ||
			typeof video.play !==
				"function"
		) {

			return null;

		}


		let boxed =
			false;


		try {

			boxed =
				video.isConnected ===
					true &&
				typeof video.getClientRects ===
					"function" &&
				video.getClientRects().length >
					0;

		}

		catch (boxError) {

			boxed =
				false;

		}


		if (boxed) {

			return null;

		}


		const parent =
			video.parentNode || null;

		const nextSibling =
			video.nextSibling || null;


		try {

			ensureClipCaptureHost().appendChild(
				video
			);

		}

		catch (mountError) {

			return null;

		}


		return function restoreClip() {

			try {

				const hostNode =
					document.getElementById(
						CLIP_HOST_ID
					);


				if (
					!hostNode ||
					video.parentNode !==
						hostNode
				) {

					return;

				}


				if (parent) {

					parent.insertBefore(
						video,
						nextSibling &&
						nextSibling.parentNode ===
							parent
							? nextSibling
							: null
					);

				}

				else {

					/* Detached before the export: detach it again. */
					hostNode.removeChild(
						video
					);

				}

			}

			catch (restoreError) {

				/* the clip still decodes where it is */

			}

		};

	}


	function drawableSlideSource(
		source
	) {

		if (!source) {

			return false;

		}


		if (
			typeof HTMLVideoElement !==
				"undefined" &&
			source instanceof
				HTMLVideoElement
		) {

			return clipHasFrame(
				source
			);

		}


		return true;

	}


	/*
	 * Waits (bounded) until the clip can be drawn, then returns
	 * that answer instead of throwing.
	 */

	async function waitForClipFrame(
		video
	) {

		if (
			!video ||
			clipHasFrame(
				video
			)
		) {

			return clipHasFrame(
				video
			);

		}

		return await new Promise(
			(resolve) => {

				let done =
					false;

				const finish =
					(ok) => {

						if (done) {

							return;

						}

						done =
							true;

						for (
							const name of [
								"loadeddata",
								"canplay",
								"seeked"
							]
						) {

							try {

								video.removeEventListener(
									name,
									onReady
								);

							}
							catch (listenerError) {
								/* detached element */
							}

						}

						resolve(
							ok ===
								true &&
								clipHasFrame(
									video
								)
						);

					};

				const onReady =
					() => finish(
						true
					);

				for (
					const name of [
						"loadeddata",
						"canplay",
						"seeked"
					]
				) {

					try {

						video.addEventListener(
							name,
							onReady
						);

					}
					catch (listenerError) {
						/* detached element */
					}

				}

				setTimeout(
					() => finish(
						clipHasFrame(
							video
						)
					),
					CLIP_READY_TIMEOUT_MS
				);

			}
		);

	}


	/*
	 * Waits for the next PRESENTED frame of a playing clip.
	 *
	 * Returns true when a frame really arrived, false when the
	 * deadline passed (hidden element / background tab / paused
	 * clip). It never waits indefinitely.
	 */

	async function nextClipFrame(
		video,
		timeoutMs
	) {

		const deadline =
			Math.max(
				50,
				Number(timeoutMs) ||
					CLIP_FRAME_TIMEOUT_MS
			);


		if (
			typeof video.requestVideoFrameCallback ===
				"function"
		) {

			return await new Promise(
				(resolve) => {

					let done =
						false;

					const finish =
						(ok) => {

							if (done) {

								return;

							}

							done =
								true;

							resolve(
								ok ===
									true
							);

						};

					const timer =
						setTimeout(
							() => finish(
								false
							),
							deadline
						);

					try {

						video.requestVideoFrameCallback(
							() => {

								clearTimeout(
									timer
								);

								finish(
									true
								);

							}
						);

					}
					catch (callbackError) {

						clearTimeout(
							timer
						);

						finish(
							false
						);

					}

				}
			);

		}


		/*
		 * Older browser: no presentation callback exists, so pace
		 * the capture ourselves and report "arrived" only while
		 * the element actually advances.
		 */

		const before =
			Number(
				video.currentTime
			) || 0;

		await new Promise(
			(resolve) =>
				setTimeout(
					resolve,
					34
				)
		);

		return (
			video.paused ===
				false ||
			(
				Number(
					video.currentTime
				) || 0
			) !==
				before
		);

	}


	/*
	 * Deterministic capture: park the clip on one exact time.
	 * Used for every frame once playback stops presenting frames,
	 * and as the fallback when play() itself was rejected.
	 */

	async function captureClipFrameAt(
		video,
		timeSec,
		durationSec
	) {

		const reported =
			Number(
				video.duration
			);

		const limit =
			Number.isFinite(
				reported
			) &&
			reported > 0

				? reported

				: Number.isFinite(
					durationSec
				) &&
					durationSec > 0

					? durationSec

					: 0;

		const requested =
			Number(
				timeSec
			);

		let target =
			Number.isFinite(
				requested
			) &&
			requested > 0

				? requested

				: 0;


		if (limit > 0) {

			target =
				Math.min(
					target,
					Math.max(
						0,
						limit -
							0.001
					)
				);

		}


		await seekClipTo(
			video,
			target
		);

	}


	/*
	 * Restarts a clip silently for frame capture.
	 *
	 * Returns true when the clip can be drawn afterwards. A
	 * rejected play() (autoplay policy, detached element) is not
	 * fatal any more: the caller switches that slide to seek-based
	 * capture instead of waiting for frames that never come.
	 */

	async function mediaDeadline(work, milliseconds, message) {
		let timer = null;
		try {
			return await Promise.race([work, new Promise(function (_, reject) {
				timer = setTimeout(function () { reject(new Error(message)); }, milliseconds);
			})]);
		} finally { if (timer) clearTimeout(timer); }
	}

	async function prepareClip(
		video
	) {


		try {


			video.pause();


			await seekClipTo(
				video,
				0
			);


			video.muted =
				true;


			await mediaDeadline(video.play(), 5000, "Clip playback did not start; switching to seek capture.");


			await waitForClipFrame(
				video
			);


			return clipHasFrame(
				video
			);


		}


		catch (playError) {
			video.pause();


			console.error(
				"Clip play failed:",
				playError
			);


			return await waitForClipFrame(
				video
			);


		}


	}
		function getSlideSequence() {
	
	
		if (
			(renderContext && renderContext.timelineEdited) ||
			!currentAudio ||
			activeSlides.length ===
				0
		) {
	
	
			return activeSlides.slice();
	
	
		}
	
	
		/*
			 * The silent video repeats until
			 * it covers the audio. The last
			 * slide is trimmed so the video
			 * ends with the audio.
		 */
	
	
		const sequence =
			[];
	
	
		let totalSeconds =
			0;
	
	
		let index =
			0;
	
	
		let guard =
			0;
	
	
		while (
			totalSeconds <
				currentAudio.duration -
					0.05
			&&
			guard <
				10000
		) {
	
	
			const base =
				activeSlides[
					index %
					activeSlides.length
				];
	
	
			const slideSeconds =
				slideDurationSec(
					base
				);
	
	
			const remaining =
				currentAudio.duration -
				totalSeconds;
	
	
			if (
				remaining <
				slideSeconds -
					0.05
			) {
	
	
				const trimmed =
					Object.assign(
						{},
						base
					);
	
	
				trimmed._partialSec =
					remaining;
	
	
				sequence.push(
					trimmed
				);
	
	
				totalSeconds =
					currentAudio.duration;
	
	
			}
	
	
			else {
	
	
				sequence.push(
					base
				);
	
	
				totalSeconds +=
					slideSeconds;
	
	
			}
	
	
			index++;
	
	
			guard++;
	
	
		}
	
	
		return sequence;
	
	}


	function updateDurationEstimate() {
	
	
		/*
			 * One pass of the silent video.
			 * With audio the video repeats to
			 * cover it, so the finished length
			 * is the audio length.
		 */
	
	
		const passSeconds =
			activeSlides.reduce(
				(sum, slide) =>
					sum +
					slideDurationSec(
						slide
					),
				0
			);
	
	
		const totalSeconds =
			currentAudio
			? currentAudio.duration
			: passSeconds;
	
	
		estimateValueEl.textContent =
			formatSeconds(
				totalSeconds
			) +
			" (" +
			totalSeconds.toFixed(1) +
			"s)";
	
	
		if (
			currentAudio &&
			activeSlides.length >
				0
		) {
	
	
			estimateSourceEl.textContent =
				"(video repeats to cover the " +
				formatSeconds(
					currentAudio.duration
				) +
				" audio)";
	
	
		}
		else {
	
	
			estimateSourceEl.textContent =
				"(9s per image or GIF \u00b7 MP4 clips play in full)";
	
	
		}


		/*
		 * Rough output size so the user can
		 * see the memory cost before hitting
		 * the render button.
		 */

		const quality =
			getQuality();


		const audioBitrate =
			currentAudio
				? quality.audioBitrate
				: 0;


		const bytes =
			(totalSeconds *
				(
					quality.videoBitrate +
					audioBitrate
				)) /
			8;


		estimateSizeEl.textContent =
			"\u00b7 approx. " +
			formatBytes(bytes) +
			" file";

	}


	// =========================================================
	// MP3 UPLOAD + DECODE
	// =========================================================

	audioUploadEl.addEventListener(
		"change",
		async (event) => {

			const file =
				event.target.files &&
				event.target.files[0];


			/*
			 * Allows the same file to be
			 * selected again later.
			 */

			event.target.value =
				"";


			if (!file) {
				return;
			}


			try {

				const arrayBuffer =
					await file.arrayBuffer();


				const context =
					getAudioContext();


				/*
				 * slice(0) is required because
				 * decodeAudioData detaches the
				 * ArrayBuffer it is given.
				 */

				const decoded =
					await context.decodeAudioData(
						arrayBuffer.slice(0)
					);


				/*
				 * Release the previous preview
				 * URL before replacing it.
				 */

				if (
					currentAudio &&
					currentAudio.url
				) {

					releaseStudioObjectUrl(
						currentAudio.url
					);

				}


				currentAudio = {

					name:
						file.name,

					duration:
						decoded.duration,

					buffer:
						decoded,

					url:
						createStudioObjectUrl(
							file
						)

				};


				audioNameEl.textContent =
					"";


				audioNameEl.appendChild(
					document.createTextNode(
						file.name + "  "
					)
				);


				const durationSpan =
					document.createElement(
						"span"
					);


				durationSpan.textContent =
					formatSeconds(
						decoded.duration
					);


				audioNameEl.appendChild(
					durationSpan
				);


				audioPreviewEl.src =
					currentAudio.url;


				audioDetailsEl.style.display =
					"flex";


				audioEmptyEl.style.display =
					"none";


				updateDurationEstimate();

			}
			catch (error) {

				console.error(
					"Audio decode failed:",
					error
				);


				alert(
					"Could not read that audio file. Please upload a valid MP3."
				);

			}

		}
	);


	// =========================================================
	// REMOVE AUDIO
	// =========================================================

	/*
	 * Changing quality changes the
	 * estimated file size.
	 */

	qualitySelectEl.addEventListener(
		"change",
		updateDurationEstimate
	);


	function removeAudio() {

		if (
			currentAudio &&
			currentAudio.url
		) {

			releaseStudioObjectUrl(
				currentAudio.url
			);

		}


		currentAudio =
			null;


		audioPreviewEl.pause();

		audioPreviewEl.removeAttribute(
			"src"
		);

		audioPreviewEl.load();


		audioDetailsEl.style.display =
			"none";


		audioEmptyEl.style.display =
			"block";


		updateDurationEstimate();

	}


	// =========================================================
	// CREATE AI CARDS
	// =========================================================

	const isInitialTimelineRoute = (() => {
		try {
			return new URLSearchParams(window.location.search || "").get("layout") === "timeline";
		} catch (error) {
			return false;
		}
	})();

	if (isInitialTimelineRoute) {
		if (gallery) {
			gallery.hidden = true;
			gallery.style.display = "none";
		}
	} else if (gallery) {
		prompts.forEach(
			(prompt, index) => {

				const card =
					document.createElement(
						"div"
					);


				card.className =
					"card";


				card.id =
					\`card-\${index}\`;


				card.innerHTML = \`

					<div
						class="image-container"
						id="container-\${index}"
					>

						<div class="loading">

							<div class="spinner"></div>

							Generating AI Scene
							\${index + 1}...

						</div>

					</div>


					<div
						class="prompt"
						title="\${escapeHTML(prompt)}"
					>

						\${index + 1}.
						\${escapeHTML(prompt)}

					</div>


					<div class="card-actions">

						<span
							style="
								font-size:0.75rem;
								color:#6b7280;
							"
						>
							Pixabay stock
						</span>


						<button
							class="toggle-btn"
							id="btn-\${index}"
							disabled
							onclick="toggleSlide(\${index})"
						>
							Loading...
						</button>

					</div>

				\`;


				gallery.appendChild(
					card
				);

			}
		);
	}


	// =========================================================
	// FETCH AI IMAGE
	// =========================================================

	async function fetchAIImage(index) {

		const container =
			document.getElementById(
				\`container-\${index}\`
			);


		const btn =
			document.getElementById(
				\`btn-\${index}\`
			);


		const card =
			document.getElementById(
				\`card-\${index}\`
			);

		/*
		 * The legacy top-of-page
		 * image slots were removed,
		 * so there is nowhere to
		 * show these images: skip
		 * the generation (no wasted
		 * AI calls, no uncaught
		 * errors).
		 */
		if (
			!container ||
			!btn ||
			!card
		) {

			return;

		}

		try {

			const response =
				await fetch(
					\`/image/\${index}\`
				);


			if (!response.ok) {

				throw new Error(
					"Image generation failed"
				);

			}


			const blob =
				await response.blob();


			const imageURL =
				createStudioObjectUrl(
					blob
				);


			const img =
				new Image();


			img.src =
				imageURL;


			await img.decode();


			container.innerHTML =
				"";


			container.appendChild(
				img
			);


			activeSlides.push({

				id:
					\`ai-\${index}\`,

				img:
					img,

				cardId:
					\`card-\${index}\`

			});


			card.classList.add(
				"in-video"
			);


			btn.textContent =
				"Remove from Video";


			btn.disabled =
				false;


			updateQueueCount();

		}
		catch (error) {

			console.error(
				error
			);


			container.innerHTML = \`

				<div
					style="
						color:#ef4444;
						font-size:0.8rem;
					"
				>
					Generation Failed
				</div>

			\`;

		}

	}


	/* The legacy demo image routes were removed; do not request them on
	 * page load. The active studio uses Pixabay search instead. */


	// =========================================================
	// CUSTOM IMAGE UPLOAD
	// =========================================================

	document
		.getElementById(
			"file-upload"
		)
		.addEventListener(
			"change",
			async (event) => {

				const files =
					Array.from(
						event.target.files
					);


				/*
				 * Process uploads one at a time.
				 *
				 * This prevents multiple large images
				 * from being decoded simultaneously.
				 */

				for (
					const file of files
				) {

					/*
						 * Upload limits: at most
						 * MAX_GIF_UPLOADS GIFs and
						 * MAX_IMAGE_UPLOADS still
						 * images.
					 */


					const fileIsGif =
						file.type ===
							"image/gif" ||
							/\.gif$/i.test(
								file.name
							);


					const uploadedGifs =
						activeSlides.filter(
							(slide) =>
								slide.type ===
									"gif"
						).length;


					const uploadedImages =
						activeSlides.filter(
							(slide) =>
								slide.id &&
									!slide.type &&
									slide.id.startsWith(
										"custom"
								)
						).length;


					if (
						fileIsGif &&
						uploadedGifs >=
							MAX_GIF_UPLOADS
					) {


						alert(
							"You can add at most " +
								MAX_GIF_UPLOADS +
								" GIFs."
						);


						break;


					}


					const fileIsMp4 =
						file.type ===
							"video/mp4" ||
							/\\.(mp4|m4v)$/i.test(
								file.name
							);

					if (
						!fileIsGif &&
						!fileIsMp4 &&
						uploadedImages >=
							MAX_IMAGE_UPLOADS
					) {


						alert(
							"You can add at most " +
								MAX_IMAGE_UPLOADS +
								" images (jpg, png, jpeg)."
						);


						break;


					}
					const uploadedMp4s =
						activeSlides.filter(
							(slide) =>
								slide.type ===
									"mp4"
						).length;


					if (
						fileIsMp4 &&
						uploadedMp4s >=
							MAX_MP4_UPLOADS
					) {


						alert(
							"You can add at most " +
								MAX_MP4_UPLOADS +
								" MP4 clips."
						);


						break;


					}
					try {

						const imageURL =
							createStudioObjectUrl(
								file
							);


						const img =
							new Image();


						img.src =
							imageURL;


						/*
							 * MP4 clips are probed with a
							 * video element instead of
							 * being decoded as images.
						 */


						let clipVideo =
							null;


						let clipDuration =
							0;


						if (fileIsMp4) {


							const probed =
								document.createElement(
									"video"
								);


							probed.muted =
								true;


							probed.playsInline =
								true;


							probed.src =
								imageURL;


							await new Promise(
								(resolve, reject) => {
									probed.addEventListener(
										"loadedmetadata",
										resolve,
										{
											once:
												true
										}
									);


									probed.addEventListener(
										"error",
										reject,
										{
											once:
												true
										}
									);
								}
							);


							clipDuration =
								probed.duration;


							if (
								clipDuration >
									MP4_MAX_DURATION_S
							) {


								alert(
									"'" +
										file.name +
										"' is " +
										formatSeconds(
											clipDuration
										) +
										" long. Each MP4 clip must be at most " +
										formatSeconds(
											MP4_MAX_DURATION_S
										) +
										"."
								);


								releaseStudioObjectUrl(
									imageURL
								);


								continue;


							}


							clipVideo =
								probed;


						}
						else {


							await img.decode();


						}


						const customId =
							"custom-" +
							Date.now() +
							"-" +
							Math.random()
								.toString(36)
								.substring(2);


						const card =
							document.createElement(
								"div"
							);


						card.className =
							"card in-video";


						card.id =
							customId;


						card.innerHTML = \`

							<div class="badge">
								Custom Upload
							</div>


							<div
								class="image-container"
							>

								<img
									src="\${imageURL}"
								>

							</div>


							<div class="prompt">

								\${escapeHTML(
									file.name
								)}

							</div>


							<div class="card-actions">

								<span
									style="
										font-size:0.75rem;
										color:#10b981;
									"
								>
									Ready
								</span>


								<button
									class="toggle-btn"
									onclick="removeCustomSlide(
										'\${customId}'
									)"
								>
									Remove
								</button>

							</div>

						\`;


						gallery.prepend(
							card
						);


						/*
						 * Build the slide entry first so GIFs can
						 * attach their decoded animation frames
						 * to it.
						 */

						const slideEntry =
							{
								id:
									customId,

								img:
									img,

								cardId:
									customId

							};


						/*
						 * GIFs are decoded frame by frame, so the
						 * MP4 contains the full animation instead
						 * of only the first frame.
						 */

						/*
							 * MP4 clips get a video
							 * preview and play silently
							 * in the export.
						 */


						if (fileIsMp4) {


							const videoContainer =
								card.querySelector(
									".image-container"
								);


							videoContainer.innerHTML =
								"";


							clipVideo.loop =
								true;


							clipVideo.autoplay =
								true;


							videoContainer.appendChild(
								clipVideo
							);


							const videoBadge =
								card.querySelector(
									".badge"
								);


							if (videoBadge) {


								videoBadge.textContent =
									"MP4";


							}


							const videoPrompt =
								card.querySelector(
									".prompt"
								);


							if (videoPrompt) {


								videoPrompt.textContent =
									file.name +
									"  |  " +
									formatSeconds(
										clipDuration
									) +
									" clip";


							}


							slideEntry.type =
								"mp4";


							slideEntry.videoEl =
								clipVideo;


							slideEntry.duration =
								clipDuration;


							slideEntry.img =
								clipVideo;


						}

						if (
							file.type ===
								"image/gif" ||
							/\.gif$/i.test(
								file.name
							)
						) {

							try {

								const buffer =
									await file.arrayBuffer();


								slideEntry.type =
									"gif";


								slideEntry.gif =
									buildGifSlideFrames(
										parseGifBytes(
											new Uint8Array(
												buffer
											)
										)
									);


								const badgeEl =
									card.querySelector(
										".badge"
									);


								if (badgeEl) {

									badgeEl.textContent =
										"GIF";

								}


								const promptEl =
									card.querySelector(
										".prompt"
									);


								if (promptEl) {

									promptEl.textContent =
										file.name +
										"  |  " +
										slideEntry.gif.frameCount +
										" frames, " +
										(slideEntry.gif.loopMs / 1000).toFixed(
											1
										) +
										"s loop";

								}

							}
							catch (gifError) {

								console.error(
									"GIF decode failed:",
									gifError
								);


								alert(
									"Could not decode that GIF animation. It was added as a still image instead."
								);

							}

						}


						activeSlides.unshift(
							slideEntry
						);


						updateQueueCount();

					}
					catch (error) {

						console.error(
							"Upload error:",
							error
						);

					}

				}


				/*
				 * Allows the same file to be
				 * selected again later.
				 */

				event.target.value =
					"";

			}
		);


	// =========================================================
	// HTML ESCAPE
	// =========================================================

	function escapeHTML(value) {

		return String(value)

			.replaceAll(
				"&",
				"&amp;"
			)

			.replaceAll(
				"<",
				"&lt;"
			)

			.replaceAll(
				">",
				"&gt;"
			)

			.replaceAll(
				'"',
				"&quot;"
			)

			.replaceAll(
				"'",
				"&#039;"
			);

	}


	// =========================================================
	// TOGGLE AI SLIDE
	// =========================================================

	function toggleSlide(index) {

		const cardId =
			\`card-\${index}\`;


		const card =
			document.getElementById(
				cardId
			);


		const btn =
			document.getElementById(
				\`btn-\${index}\`
			);


		const existingIndex =
			activeSlides.findIndex(
				s =>
					s.cardId ===
					cardId
			);


		if (
			existingIndex > -1
		) {

			activeSlides.splice(
				existingIndex,
				1
			);


			card.classList.remove(
				"in-video"
			);


			btn.textContent =
				"Add to Video";

		}
		else {

			const img =
				card.querySelector(
					"img"
				);


			if (!img) {
				return;
			}


			activeSlides.push({

				id:
					\`ai-\${index}\`,

				img:
					img,

				cardId:
					cardId

			});


			card.classList.add(
				"in-video"
			);


			btn.textContent =
				"Remove from Video";

		}


		updateQueueCount();

	}


	// =========================================================
	// REMOVE CUSTOM SLIDE
	// =========================================================

	function removeCustomSlide(id) {

		const index =
			activeSlides.findIndex(
				s =>
					s.id === id
			);


		if (
			index > -1
		) {

			const slide =
				activeSlides[index];


			/*
			 * Release browser memory
			 * for uploaded image.
			 */

			if (
				slide.img &&
				slide.img.src.startsWith(
					"blob:"
				)
			) {

				releaseStudioObjectUrl(
					slide.img.src
				);

			}


			activeSlides.splice(
				index,
				1
			);

		}


		const element =
			document.getElementById(
				id
			);


		if (element) {
			element.remove();
		}


		updateQueueCount();

	}


	// =========================================================
	// UPDATE QUEUE COUNT
	// =========================================================

	function updateQueueCount() {

		/*
		 * Slide timing depends on the
		 * number of images when audio
		 * is present.
		 */

		updateDurationEstimate();

	}


	// =========================================================
	// FILL ONE BLOCK OF PCM
	// =========================================================

	/*
	 * Fills a single small block of
	 * interleaved 16-bit PCM, which is the
	 * format WebCodecs AudioData accepts
	 * as "s16".
	 *
	 * Audio longer than the video is cut.
	 *
	 * If the video runs longer than the
	 * track, the remainder is silence,
	 * because the images are the part that
	 * repeats, not the audio.
	 *
	 * Blocks are filled one at a time so a
	 * long soundtrack never has to exist
	 * in memory all at once.
	 */

	function fillPCMBlock(

		channels,

		sourceFrames,

		block,

		startFrame,

		frames,

		numberOfChannels

	) {

		for (
			let i = 0;
			i < frames;
			i++
		) {

			const frameIndex =
				startFrame +
				i;


			/*
			 * Once past the end of the track
			 * the block is filled with
			 * silence.
			 */

			const finished =
				frameIndex >=
				sourceFrames;


			for (
				let c = 0;
				c < numberOfChannels;
				c++
			) {

				let value =
					0;


				if (!finished) {

					const channel =
						Math.min(
							c,
							channels.length -
								1
						);


					value =
						channels[channel][
							frameIndex
						];


					/*
					 * Clamp before converting
					 * to integer samples.
					 */

					if (value > 1) {
						value = 1;
					}
					else if (
						value < -1
					) {
						value = -1;
					}

				}


				block[
					i * numberOfChannels + c
				] =
					value < 0
						? value * 0x8000
						: value * 0x7fff;

			}

		}

	}


	// =========================================================
	// ENCODE MP3 -> AAC
	// =========================================================

	/*
	 * Decodes are already done. This converts
	 * the AudioBuffer into AAC chunks that
	 * mp4-muxer can write into the MP4.
	 *
	 * Returns the chunk list plus the track
	 * settings needed by the muxer.
	 */

	async function encodeAudioTrack(
		audioBuffer,
		targetSeconds,
		bitrate,
		onProgress
	) {

		const sampleRate =
			audioBuffer.sampleRate;


		/*
		 * AAC supports up to 2 channels.
		 */

		const numberOfChannels =
			Math.min(
				2,
				audioBuffer.numberOfChannels
			);


		/*
		 * AAC works on 1024 sample blocks.
		 */

		const FRAMES_PER_CHUNK =
			1024;


		const sourceChannels =
			[];


		for (
			let c = 0;
			c < audioBuffer.numberOfChannels;
			c++
		) {

			sourceChannels.push(
				audioBuffer.getChannelData(
					c
				)
			);

		}


		const sourceFrames =
			audioBuffer.length;


		const totalFrames =
			Math.max(
				1,
				Math.round(
					targetSeconds *
						sampleRate
				)
			);


		/*
		 * One reused block.
		 *
		 * Only 1024 frames are alive at any
		 * moment instead of an entire
		 * multi-minute track.
		 */

		const block =
			new Int16Array(
				FRAMES_PER_CHUNK *
					numberOfChannels
			);


		const chunks = [];


		/*
		 * Timestamps of the chunks, in the
		 * order they were encoded, so each
		 * encoded chunk can be matched with
		 * the position it belongs to.
		 */

		const pendingTimestamps =
			[];


		let encoderError =
			null;


		const audioConfig = { codec: "mp4a.40.2", sampleRate: sampleRate, numberOfChannels: numberOfChannels, bitrate: bitrate };
		if (typeof AudioEncoder.isConfigSupported === "function") {
			const support = await mediaDeadline(AudioEncoder.isConfigSupported(audioConfig), 5000, "Audio codec check timed out.");
			if (!support.supported) throw new Error("This browser cannot encode AAC audio. Rendering a silent video instead.");
		}

		const audioEncoder =
			new AudioEncoder({

				output:
					(chunk, meta) => {

						const timestamp =
							pendingTimestamps
								.length
								? pendingTimestamps.shift()
								: 0;


						chunks.push({
							chunk:
								chunk,
							meta:
								meta,
							timestamp:
								timestamp
						});

					},


				error:
					(error) => {

						console.error(
							"AudioEncoder error:",
							error
						);


						encoderError =
							error;

					}

			});



		let offset =
			0;


		let timestamp =
			0;


		try {
			audioEncoder.configure(audioConfig);



			while (
				offset < totalFrames
			) {

				const frames =
					Math.min(
						FRAMES_PER_CHUNK,
						totalFrames -
							offset
					);


				/*
				 * Fill the reused block with
				 * the audio that belongs at
				 * this position of the track.
				 */

				fillPCMBlock(
					sourceChannels,
					sourceFrames,
					block,
					offset,
					frames,
					numberOfChannels
				);


				/*
				 * slice() hands WebCodecs its
				 * own copy, sized to the exact
				 * number of frames.
				 */

				const chunkData =
					block.slice(
						0,
						frames *
							numberOfChannels
					);


				const audioData =
					new AudioData({

						format:
							"s16",

						sampleRate:
							sampleRate,

						numberOfFrames:
							frames,

						numberOfChannels:
							numberOfChannels,

						timestamp:
							timestamp,

						data:
							chunkData

					});


				pendingTimestamps.push(
					timestamp
				);


				audioEncoder.encode(
					audioData
				);


				audioData.close();


				offset +=
					frames;


				timestamp +=
					Math.round(
						(frames *
							1_000_000) /
							sampleRate
					);


				/*
				 * Backpressure.
				 */

				const audioWaitStarted = Date.now();
				while (
					audioEncoder.encodeQueueSize >
					40
				) {
					if (encoderError) throw encoderError;
					if (audioEncoder.state === "closed" || Date.now() - audioWaitStarted > 15000) {
						throw new Error("The audio encoder stopped accepting samples. Rendering a silent video instead.");
					}

					await new Promise(
						resolve =>
							setTimeout(
								resolve,
								8
							)
					);

				}


				if (encoderError) {
					throw encoderError;
				}


				if (
					onProgress &&
					offset %
						(FRAMES_PER_CHUNK *
							25) ===
						0
				) {

					onProgress(
						offset /
							totalFrames
					);

				}


				/*
				 * Keep the page responsive.
				 */

				if (
					offset %
						(FRAMES_PER_CHUNK *
							25) ===
						0
				) {

					await new Promise(
						resolve =>
							setTimeout(
								resolve,
								0
							)
					);

				}

			}


			if (onProgress) {
				onProgress(1);
			}


			let audioFlushTimer = null;
			try {
				await Promise.race([
					audioEncoder.flush(),
					new Promise(function (_, reject) {
						audioFlushTimer = setTimeout(function () {
							reject(new Error("Finalizing audio took longer than 30 seconds. Rendering a silent video instead."));
						}, 30000);
					})
				]);
			} finally { if (audioFlushTimer) clearTimeout(audioFlushTimer); }


			if (encoderError) {
				throw encoderError;
			}

		}
		finally {

			if (
				audioEncoder.state !==
				"closed"
			) {

				try {

					audioEncoder.close();

				}
				catch (error) {

					console.warn(
						"Audio encoder cleanup error:",
						error
					);

				}

			}

		}


		return {

			chunks:
				chunks,

			sampleRate:
				sampleRate,

			numberOfChannels:
				numberOfChannels

		};

	}


	// =========================================================
	// TITLE OVERLAY
	// =========================================================

	/*
	 * A web font must be loaded before
	 * canvas can draw with it, otherwise
	 * the frame silently falls back to a
	 * default font.
	 */

	async function loadTitleFont() {

		const text =
			titleInputEl.value.trim();


		if (
			!text ||
			!document.fonts ||
			!document.fonts.load
		) {

			return;

		}


		const font =
			getTitleFont();


		try {

			await mediaDeadline(document.fonts.load(
				"bold " +
					TITLE_FONT_SIZE +
					'px "' +
					font.loadName +
					'"'
			), 8000, "Title font loading timed out; using a fallback font.");

			// Do not wait for document.fonts.ready: it waits for unrelated
			// page fonts too, and can remain pending after this font loaded.

		}
		catch (error) {

			console.warn(
				"Font load failed:",
				error
			);

		}

	}


	/*
	 * Draws the title onto the current
	 * frame, top left.
	 *
	 * Plain text only: no background box,
	 * no highlight, no shadow.
	 */

	function drawTitle(context) {

		const text =
			titleInputEl.value.trim();


		if (!text) {
			return;
		}


		context.save();


		context.font =
			"bold " +
			TITLE_FONT_SIZE +
			"px " +
			getTitleFont().stack;


		context.textAlign =
			"left";


		context.textBaseline =
			"top";


		/*
		 * White, black or green.
		 */

		const colour =
			titleColorEl.value;


		context.fillStyle =
			colour === "black"
				? "#000000"
				: colour === "green"
					? "#22c55e"
					: "#ffffff";


		context.fillText(
			text,
			TITLE_MARGIN,
			TITLE_MARGIN
		);


		context.restore();

	}


	// =========================================================
	// GIF DECODER + FRAME COMPOSITOR
	// =========================================================

	/*
	 * A small self-contained GIF87a/89a decoder.
	 *
	 * It parses the file, decodes the LZW image data and
	 * composes every frame (including disposal methods and
	 * interlacing) into ready-to-draw ImageData objects.
	 *
	 * The result is played back frame by frame while the MP4
	 * is rendered, so a playing GIF becomes part of the
	 * exported video exactly like the still images.
	 */

	/*
	 * GIF LZW decompression.
	 *
	 * data        : concatenated image data sub-block bytes
	 * minCodeSize : first byte after the (local) colour table
	 * totalPixels : frame width * frame height
	 *
	 * Returns a Uint8Array of palette indices.
	 */

	function gifLzwDecode(
		data,
		minCodeSize,
		totalPixels
	) {

		const clearCode =
			1 << minCodeSize;


		const endCode =
			clearCode + 1;


		let codeSize =
			minCodeSize + 1;


		let nextCode =
			endCode + 1;


		/*
		 * Base codes (below clearCode) are literal pixel
		 * indices, so the table only needs entries from
		 * clearCode up.
		 */

		const table =
			new Array(
				4096
			);


		const out =
			new Uint8Array(
				totalPixels
			);


		let outPos =
			0;


		let cache =
			0;


		let cacheBits =
			0;


		let bytePos =
			0;


		function resetTable() {

			nextCode =
				endCode + 1;


			codeSize =
				minCodeSize + 1;

		}


		function readCode() {

			while (
				cacheBits <
					codeSize
			) {

				if (
					bytePos >=
						data.length
				) {

					return -1;

				}


				cache |=
					data[bytePos] <<
						cacheBits;


				bytePos++;


				cacheBits +=
					8;

			}


			const code =
				cache &
				((1 << codeSize) - 1);


			cache >>>=
				codeSize;


			cacheBits -=
				codeSize;


			return code;

		}


		function emit(
			seq
		) {

			for (
				let i = 0;
				i < seq.length;
				i++
			) {

				if (
					outPos >=
						totalPixels
				) {

					return;

				}


				out[outPos++] =
					seq[i];

			}

		}


		let code =
			readCode();


		if (code < 0) {
			throw new Error(
				"Empty GIF image data"
			);
		}


		if (code === clearCode) {
			code = readCode();
		}


		if (
			code < 0 ||
			code === endCode
		) {

			return out;

		}


		if (code >= clearCode) {
			throw new Error(
				"Corrupt GIF LZW stream"
			);
		}


		resetTable();


		let prev =
			[code];


		emit(
			prev
		);


		while (
			outPos <
				totalPixels
		) {

			code =
				readCode();


			if (code < 0) {
				break;
			}


			if (
				code ===
					clearCode
			) {

				/*
				 * Mid-stream clear: reset, then skip
				 * any further consecutive clears.
				 */

				do {

					resetTable();


					code =
						readCode();

				}
				while (
					code ===
						clearCode
				);


				if (
					code < 0 ||
					code ===
						endCode
				) {

					break;

				}


				if (
					code >=
						clearCode
				) {

					throw new Error(
						"Corrupt GIF LZW stream"
					);

				}


				prev =
					[code];


				emit(
					prev
				);


				continue;

			}


			if (
				code ===
					endCode
			) {

				break;

			}


			let seq;


			if (
				code <
					clearCode
			) {

				seq =
					[code];

			}
			else if (
				code <
					nextCode
			) {

				seq =
					table[code];

			}
			else if (
				code ===
					nextCode
			) {

				/*
				 * The KwKwK case: the encoder
				 * references the very code that
				 * is about to be added.
				 */

				seq =
					prev.concat(
						prev[0]
					);

			}


			if (!seq) {
				throw new Error(
					"Corrupt GIF LZW stream"
				);
			}


			if (
				nextCode <
					4096
			) {

				table[nextCode] =
					prev.concat(
						seq[0]
					);


				nextCode++;


				if (
					nextCode ===
						(1 << codeSize) &&
					codeSize <
						12
				) {

					codeSize++;

				}

			}


			emit(
				seq
			);


			prev =
				seq;

		}


		return out;

	}


	/*
	 * Reorders the rows of an interlaced frame.
	 *
	 * Interlaced GIFs store their rows in four passes:
	 * rows 0,8,16... then 4,12,20... then 2,6,10... then
	 * 1,3,5...
	 */

	function gifDeinterlace(
		pixels,
		width,
		height
	) {

		const out =
			new Uint8Array(
				pixels.length
			);


		const starts =
			[0, 4, 2, 1];


		const steps =
			[8, 8, 4, 2];


		let passRow =
			0;


		for (
			let pass = 0;
			pass < 4;
			pass++
		) {

			for (
				let row =
					starts[pass];
				row < height;
				row += steps[pass]
			) {

				out.set(
					pixels.subarray(
						passRow * width,
						(passRow + 1) * width
					),
					row * width
				);


				passRow++;

			}

		}


		return out;

	}


	/*
	 * Parses a GIF file into its frames.
	 *
	 * Returns
	 *   {
	 *     width, height,   // logical screen size
	 *     frames: [
	 *       {
	 *         left, top, width, height,
	 *         delayMs,
	 *         disposal,          // 0-3
	 *         transparent,       // boolean
	 *         transparentIndex,  // -1 when none
	 *         palette,           // [ [r,g,b], ... ]
	 *         pixels              // Uint8Array of indices
	 *       },
	 *       ...
	 *     ]
	 *   }
	 */

	function parseGifBytes(
		bytes
	) {

		if (
			bytes.length <
				13
		) {

			throw new Error(
				"File is too small to be a GIF"
			);

		}


		if (
			bytes[0] !== 0x47 ||
			bytes[1] !== 0x49 ||
			bytes[2] !== 0x46
		) {

			throw new Error(
				"Not a GIF file"
			);

		}


		const width =
			bytes[6] |
			(bytes[7] << 8);


		const height =
			bytes[8] |
			(bytes[9] << 8);


		const screenPacked =
			bytes[10];


		const hasGct =
			(screenPacked & 0x80) !== 0;


		const gctEntries =
			2 << (screenPacked & 0x07);


		let offset =
			13;


		const globalPalette =
			[];


		if (hasGct) {

			for (
				let i = 0;
				i < gctEntries;
				i++
			) {

				globalPalette.push(
					[
						bytes[offset],
						bytes[offset + 1],
						bytes[offset + 2]
					]
				);


				offset +=
					3;

			}

		}


		const frames =
			[];


		let pending =
			null;


		while (
			offset <
				bytes.length
		) {

			const block =
				bytes[offset];


			offset++;


			/*
			 * Trailer.
			 */

			if (block === 0x3B) {
				break;
			}


			/*
			 * Extension block.
			 */

			if (block === 0x21) {

				const label =
					bytes[offset];


				offset++;


				if (
					label ===
						0xF9
				) {

					/*
					 * Graphic control extension.
					 */

					const subLength =
						bytes[offset];


					offset++;


					const gcePacked =
						bytes[offset];


					const delayCs =
						bytes[offset + 1] |
						(bytes[offset + 2] << 8);


					const transparentIndex =
						bytes[offset + 3];


					offset +=
						subLength;


					/*
					 * A delay of 0 is invalid;
					 * viewers use 10 cs (100ms).
					 */

					pending =
						{
							disposal:
							(gcePacked >> 2) & 0x07,

							delayMs:
							(delayCs || 10) * 10,

							transparent:
							(gcePacked & 0x01) !== 0,

							transparentIndex:
								transparentIndex
						};


					offset++;

				}
				else {

					/*
					 * Comment, application (loop) or
					 * plain text extension: skip all
					 * of its sub-blocks.
					 */

					let subLength;


					do {

						subLength =
							bytes[offset];


						offset +=
							1 + subLength;

					}
					while (
						subLength !== 0
					);

				}


				continue;

			}


			/*
			 * Image descriptor.
			 */

			if (block === 0x2C) {

				const left =
					bytes[offset] |
					(bytes[offset + 1] << 8);


				const top =
					bytes[offset + 2] |
					(bytes[offset + 3] << 8);


				const frameWidth =
					bytes[offset + 4] |
					(bytes[offset + 5] << 8);


				const frameHeight =
					bytes[offset + 6] |
					(bytes[offset + 7] << 8);


				const imagePacked =
					bytes[offset + 8];


				offset +=
					9;


				let palette =
					globalPalette;


				if (
					(imagePacked & 0x80) !== 0
				) {

					const lctEntries =
						2 <<
						(imagePacked & 0x07);


					palette =
						[];


					for (
						let i = 0;
						i < lctEntries;
						i++
					) {

						palette.push(
							[
								bytes[offset],
								bytes[offset + 1],
								bytes[offset + 2]
							]
						);


						offset +=
							3;

					}

				}


				const interlaced =
					(imagePacked & 0x40) !== 0;


				const minCodeSize =
					bytes[offset];


				offset++;


				const chunks =
					[];


				let chunkLength;


				do {

					chunkLength =
						bytes[offset];


					offset++;


					chunks.push(
						bytes.subarray(
							offset,
							offset + chunkLength
						)
					);


					offset +=
						chunkLength;

				}
				while (
					chunkLength !== 0
				);


				let dataLength =
					0;


				for (
					const chunk of
						chunks
				) {

					dataLength +=
						chunk.length;

				}


				const data =
					new Uint8Array(
						dataLength
					);


				let dataOffset =
					0;


				for (
					const chunk of
						chunks
				) {

					data.set(
						chunk,
						dataOffset
					);


					dataOffset +=
						chunk.length;

				}


				let indices =
					gifLzwDecode(
						data,
						minCodeSize,
						frameWidth *
							frameHeight
					);


				if (interlaced) {

					indices =
						gifDeinterlace(
							indices,
							frameWidth,
							frameHeight
						);

				}


				frames.push(
					{
						left:
							left,

						top:
							top,

						width:
							frameWidth,

						height:
							frameHeight,

						delayMs:
							pending
								? pending.delayMs
								: 100,

						disposal:
							pending
								? pending.disposal
								: 0,

						transparent:
							pending
								? pending.transparent
								: false,

						transparentIndex:
							pending
								? pending.transparentIndex
								: -1,

						palette:
							palette,

						pixels:
							indices
					}
				);


				pending =
					null;


				continue;

			}


			/*
			 * Unknown block: step one byte forward
			 * so we cannot get stuck in an infinite
			 * loop.
			 */

		}


		if (
			!frames.length
		) {

			throw new Error(
				"GIF contains no image frames"
			);

		}


		return {
			width:
				width,

			height:
				height,

			backgroundIndex:
				bytes[11],

			globalPalette:
				globalPalette,

			frames:
				frames
		};

	}


	/*
	 * Composes the parsed GIF into per-frame ImageData objects.
	 *
	 * Returns
	 *   {
	 *     width, height,     // (possibly downscaled) size
	 *     frames: [ { data: ImageData, durationMs } ],
	 *     startMs: [ ... ],  // frame start times within the loop
	 *     loopMs,
	 *     frameCount
	 *   }
	 */

	function buildGifSlideFrames(
		parsed
	) {

		const width =
			parsed.width;


		const height =
			parsed.height;


		const frames =
			parsed.frames;


		/*
		 * Memory guard: every stored frame costs
		 * width*height*4 bytes. Very large GIFs are
		 * downscaled to stay under the budget.
		 */

		const BUDGET_BYTES =
			120 * 1024 * 1024;


		let scale =
			1;


		const rawBytes =
			frames.length *
			width *
			height *
			4;


		if (rawBytes > BUDGET_BYTES) {

			scale =
				Math.sqrt(
					BUDGET_BYTES /
						rawBytes
				);


			scale =
				Math.max(
					0.15,
					Math.min(
						1,
						scale
					)
				);

		}


		const outWidth =
			Math.max(
				2,
				Math.round(
					width * scale
				)
			);


		const outHeight =
			Math.max(
				2,
				Math.round(
					height * scale
				)
			);


		const composite =
			document.createElement(
				"canvas"
			);


		composite.width =
			outWidth;


		composite.height =
			outHeight;


		const compositeCtx =
			composite.getContext(
				"2d",
				{
					willReadFrequently: true
				}
			);


		const patch =
			document.createElement(
				"canvas"
			);


		const patchCtx =
			patch.getContext(
				"2d"
			);


		let restoreBefore =
			null;


		const outFrames =
			[];


		const startMs =
			[];


		let loopMs =
			0;


		for (
			const frame of
				frames
		) {

			/*
			 * Disposal 3 on the previous frame means
			 * the canvas must be restored to the
			 * state before that frame was drawn.
			 */

			if (restoreBefore) {

				compositeCtx.putImageData(
					restoreBefore,
					0,
					0
				);


				restoreBefore =
					null;

			}


			/*
			 * When this frame has disposal 3, remember
			 * exactly this state (before the frame is
			 * drawn). The canvas is restored to it when
			 * the next frame arrives.
			 */

			if (
				frame.disposal === 3
			) {

				restoreBefore =
					compositeCtx.getImageData(
						0,
						0,
						outWidth,
						outHeight
					);

			}


			/*
			 * Map this frame's palette indices to
			 * RGBA pixels.
			 */

			patch.width =
				frame.width;


			patch.height =
				frame.height;


			const imageData =
				patchCtx.createImageData(
					frame.width,
					frame.height
				);


			const pixelsData =
				imageData.data;


			const indices =
				frame.pixels;


			for (
				let i = 0;
				i < indices.length;
				i++
			) {

				const index =
					indices[i];


				const colour =
					frame.palette[index] ||
					[0, 0, 0];


				const o =
					i * 4;


				pixelsData[o] =
					colour[0];


				pixelsData[o + 1] =
					colour[1];


				pixelsData[o + 2] =
					colour[2];


				pixelsData[o + 3] =
					frame.transparent &&
					index ===
						frame.transparentIndex
						? 0
						: 255;

			}


			patchCtx.putImageData(
				imageData,
				0,
				0
			);


			const dx =
				Math.round(
					frame.left * scale
				);


			const dy =
				Math.round(
					frame.top * scale
				);


			const dw =
				Math.round(
					frame.width * scale
				);


			const dh =
				Math.round(
					frame.height * scale
				);


			compositeCtx.drawImage(
				patch,
				0,
				0,
				frame.width,
				frame.height,
				dx,
				dy,
				dw,
				dh
			);


			/*
			 * Capture the canvas exactly as the
			 * frame is displayed.
			 */

			outFrames.push(
				{
					data:
						compositeCtx.getImageData(
							0,
							0,
							outWidth,
							outHeight
						),

					durationMs:
						frame.delayMs
				}
			);


			startMs.push(
				loopMs
			);


			loopMs +=
				frame.delayMs;


			/*
			 * Disposal 2 clears the frame's area back
			 * to the background: transparent when the
			 * frame has a transparent colour, otherwise
			 * the solid screen background colour.
			 */

			if (
				frame.disposal === 2
			) {

				if (
					frame.transparent
				) {

					compositeCtx.clearRect(
						dx,
						dy,
						dw,
						dh
					);

				}
				else {

					const bg =
						(parsed.globalPalette || [])[
							parsed.backgroundIndex
						] ||
						[0, 0, 0];

					compositeCtx.fillStyle =
						'rgb(' +
							bg[0] +
							',' +
							bg[1] +
							',' +
							bg[2] +
						')';

					compositeCtx.fillRect(
						dx,
						dy,
						dw,
						dh
					);

				}

			}


		}


		return {

			width:
				outWidth,

			height:
				outHeight,

			frames:
				outFrames,

			startMs:
				startMs,

			loopMs:
				loopMs,

			frameCount:
				outFrames.length

		};

	}


	/*
	 * Binary search for the frame that is visible
	 * at loopTimeMs.
	 */

	function gifFrameIndexAt(
		gif,
		loopTimeMs
	) {

		const starts =
			gif.startMs;


		let low =
			0;


		let high =
			starts.length - 1;


		let answer =
			0;


		while (
			low <= high
		) {

			const mid =
				(low + high) >> 1;


			if (
				starts[mid] <=
					loopTimeMs
			) {

				answer =
					mid;


				low =
					mid + 1;

			}
			else {

				high =
					mid - 1;

			}

		}


		return answer;

	}

	// =========================================================
	// MP4 VIDEO GENERATOR
	// =========================================================

	/*
	 * =========================================================
	 * VIDEO SECTIONS (the stacked "Video N" accordions)
	 * =========================================================
	 *
	 * This block is organised as four self-contained modules
	 * so it can later be cut into separate import files:
	 *
	 *   MODULE 1: video-projects  (state, + button, accordion UI)
	 *   MODULE 2: video-gallery   (upload, cards, drag & drop, tips)
	 *   MODULE 3: required-modal  (missing-fields warning)
	 *   MODULE 4: generation-queue (render everything, 2 at a time)
	 *   MODULE 5: ai-images       (40% panel: prompt -> 2 CF images,
	 *                              add-to-video + fullscreen)
	 *   MODULE 7: api-render      (POST /api/render with all of a
	 *                              video's elements; background-worker
	 *                              mode for the current-day settings route)
	 *   MODULE 8: script          (AI script generation -> plain
	 *                              narration text; INSTRUCT model;
	 *                              minutes 1-6 + speech speed; two
	 *                              client retries before the
	 *                              accordion reports an error
	 *   MODULE 8a: modal-stack    (one walkthrough / voiceover
	 *                              window per video, stacked, never
	 *                              swapped out of a pending choice)
	 *   MODULE 1c: batch-table    (the table layout: script + style +
	 *                              minutes per row, one Generate, then
	 *                              Preview / Export on every finished
	 *                              row)
	 *
	 * Each module only talks to the others through the
	 * videoProjects array and the small shared functions, so a
	 * module can be moved to its own file without touching the
	 * rest.
	 *
	 * The old single-video panels (title, MP3, captions,
	 * quality, main gallery) stay in the DOM but are
	 * hidden; they act as the engine's "working state". Before
	 * each video is rendered, that video's values are copied
	 * into the hidden panels, the engine renders, then the
	 * working state is restored.
	 */

	/*
	 * var (not let) so the save dialog and tests can see it
	 * on the window object.
	 */
	var renderContext =
		null;

	// =========================================================
	// MODULE 1: video-projects
	// =========================================================

	const VIDEO_MAX_VIDEOS =
		10;

	const VIDEO_BATCH_SIZE =
		2;

	let videoProjects =
		[];

	/*
	 * Exposed for tests / debugging: the live project list, same array
	 * (like window.__BATCH_ROWS for the quick-batch table).
	 */
	if (typeof window !== "undefined") {

		window.__VIDEO_PROJECTS =
			videoProjects;


		/* Session #264: clip duration probe (tests / debugging). */
		window.__PROBE_MP4_DURATION =
			probeMp4Duration;

	}

	let generating =
		false;

	const STATUS_COLORS = {
		empty:
			"#374151",
		queued:
			"#1d4ed8",
		rendering:
			"#b45309",
		done:
			"#15803d",
		error:
			"#b91c1c",
		skipped:
			"#4b5563",
	};

	function initVideoStudio() {

		/*
		 * Canvas-only start: hide the old
		 * single-video panels; they become
		 * the hidden engine working state.
		 */
		const mainPanels =
			document.querySelectorAll(
				".audio-panel"
			);

		for (const p of mainPanels) {
			p.style.display =
				"none";
		}

		const controls =
			document.querySelector(
				".controls"
			);

		if (controls) {
			controls.style.display =
				"none";
		}

		const gallery =
			document.getElementById(
				"gallery"
			);

		if (gallery) {
			gallery.style.display =
				"none";
		}

		/*
		 * Move the single generate button
		 * into the always-visible action
		 * bar next to the canvas.
		 */
		const renderBtn =
			document.getElementById(
				"render-btn"
			);

		const bar =
			document.getElementById(
				"action-bar"
			);

		if (renderBtn && bar) {

			renderBtn.parentNode.removeChild(
				renderBtn
			);

			bar.insertBefore(
				renderBtn,
				bar.firstChild
			);

			renderBtn.innerHTML =
				"\ud83c\udf9e\ufe0f Generate Videos";

		}

	}

	/*
	 * The red + button: adds one "Video N"
	 * accordion to the stack (max 10).
	 */
	function addVideoAccordion() {

		if (
			videoProjects.length >=
				VIDEO_MAX_VIDEOS
		) {

			alert(
				"You can add at most " +
					VIDEO_MAX_VIDEOS +
					" videos."
			);

			return;

		}

		const n =
			videoProjects.length + 1;

		const project = {
			n: n,
			name: "Video " + n,
			assets: [],
			audioFile: null,
			audio: null,
			status: "empty",
			el: null,
		};

		videoProjects.push(
			project
		);

		const acc =
			document.createElement(
				"div"
			);

		acc.className =
			"video-accordion";

		acc.id =
			"video-" + n;

		acc.innerHTML =
			videoAccordionHTML(
				n
			);

		document.getElementById(
			"video-accordions"
		).appendChild(
			acc
		);

		project.el =
			acc;

		document.getElementById(
			"va-file-" + n
		).addEventListener(
			"change",
			(event) =>
				onVideoFiles(
					n,
					event
				)
		);

		document.getElementById(
			"va-audio-" + n
		).addEventListener(
			"change",
			(event) =>
				onVideoAudio(
					n,
					event
				)
		);

		const tplLink =
			document.getElementById(
				"va-template-link-" + n
			);

		if (tplLink) {
			tplLink.removeAttribute("onclick");
			tplLink.addEventListener(
				"click",
				(event) => {
					event.preventDefault();
					if (typeof window.openTemplateModal === "function") {
						window.openTemplateModal(n);
					}
				}
			);
		}

		updateVideoStatus(
			n
		);

		syncVoiceoverButton(
			n
		);

	}

	function toggleVideoAccordion(
		n
	) {

		const body =
			document.getElementById(
				"va-body-" + n
			);

		const arrow =
			document.getElementById(
				"va-arrow-" + n
			);

		if (!body) {
			return;
		}

		body.style.display =
			body.style.display === "none"
			? ""
			: "none";

		if (arrow) {
			arrow.textContent =
				body.style.display ===
					"none"
					? "\u25b6"
					: "\u25bc";
		}

	}

	/*
	 * =========================================================
	 * Session 332 — TWO small editor-shell guarantees
	 * =========================================================
	 *
	 * 1. The editor layout always STARTS with one OPEN accordion, so the
	 *    first thing on the page is a usable Video 1 instead of an empty
	 *    card and a button to press. The ＋ Add Video button keeps its
	 *    normal (unpressed) look: nothing about the accordion's presence is
	 *    reflected on the button, no .active / aria-expanded / pressed
	 *    class is ever added to it, and APP_CSS drops the hard offset
	 *    shadow that used to make it look clicked down.
	 *
	 * 2. The timeline editor's ＋ Add Clips opens the SAME modal as this
	 *    layout's "Add video from template" link. videoProjects and
	 *    addVideoAccordion() live in this file's scope, so this file hands
	 *    the timeline a usable Video N and opens the composer for it; the
	 *    accordion it may have to create sits inside #view-editor, which is
	 *    not the active view on the timeline page.
	 */

	function ensureEditorAccordionOnLoad() {

		if (studioLayout !== "editor") {
			return false;
		}

		if (!videoProjects.length) {
			addVideoAccordion();
		}

		const first = videoProjects[0];

		if (!first) {
			return false;
		}

		const n = videoProjects.indexOf(first) + 1;

		const body =
			document.getElementById(
				"va-body-" + n
			);

		/* Open, never toggled shut: an accordion the state restored collapsed
		 * is re-opened on load, which is what "an opened accordion when the
		 * page first loads" asks for. */
		if (body && body.style.display === "none") {
			toggleVideoAccordion(n);
		}

		const button =
			document.getElementById("bulk-toggle");

		if (button) {
			button.classList.remove("active", "pressed", "is-down");
			button.setAttribute("aria-expanded", "false");
			button.setAttribute("aria-pressed", "false");
		}

		return true;

	}

	function openTemplateModalForTimeline() {

		if (typeof window.openTemplateModal !== "function") {
			return false;
		}

		if (!videoProjects.length) {
			addVideoAccordion();
		}

		const n = videoProjects.length;

		if (!n) {
			return false;
		}

		window.openTemplateModal(n);

		return true;

	}

	if (typeof window !== "undefined") {
		window.__ensureEditorAccordionOnLoad = ensureEditorAccordionOnLoad;
		window.openTemplateModalForTimeline = openTemplateModalForTimeline;
	}

	/*
	 * =========================================================
	 * DELETE VIDEO (the header button of every accordion)
	 * =========================================================
	 *
	 * Every lookup in this studio is positional -
	 * videoProjects[n - 1], #va-title-<n>, the batch counters -
	 * so a gap in the stack would silently point the wrong
	 * video's title, gallery or script at a row. Deleting
	 * therefore renumbers: the removed project's DOM node and
	 * object URLs go away, the other projects keep their files,
	 * audio, script and status, and every surviving accordion is
	 * rebuilt as Video 1..N with the state it already had.
	 *
	 * The per-video walkthrough / voiceover windows are transient
	 * UI, so they are closed instead of renumbered.
	 */

	/* Everything the accordion's inputs hold right now. */
	function captureVideoAccordionState(n) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return null;
		}

		const value = (id) => {

			const el =
				document.getElementById(id);

			return el ? el.value : "";

		};

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		const keywords =
			document.getElementById(
				"va-script-keywords-" + n
			);

		const status =
			document.getElementById(
				"va-script-status-" + n
			);

		const body =
			document.getElementById(
				"va-body-" + n
			);

		return {
			project: project,
			title: value("va-title-" + n),
			font: value("va-font-" + n),
			color: value("va-color-" + n),
			quality: value("va-quality-" + n),
			topic: value("va-script-topic-" + n),
			minutes: value("va-script-minutes-" + n),
			speed: value("va-script-speed-" + n),
			keywordsHTML: keywords ? keywords.innerHTML : "",
			keywordsHidden: !keywords || keywords.style.display === "none",
			scriptBoxOpen: !!box && box.style.display !== "none",
			scriptBoxLoading: !!box && box.classList.contains("va-script-loading"),
			scriptKeepWritingUi: !!project._scriptKeepWritingUi,
			statusText: status ? status.textContent : "",
			bodyOpen: !body || body.style.display !== "none"
		};

	}

	/* Rebuilds one accordion at its NEW position from a capture. */
	function restoreVideoAccordionState(n, state) {

		const project =
			state.project;

		if (!project) {
			return;
		}

		project.n =
			n;

		project.name =
			"Video " + n;

		const acc =
			document.createElement(
				"div"
			);

		acc.className =
			"video-accordion";

		acc.id =
			"video-" + n;

		acc.innerHTML =
			videoAccordionHTML(
				n
			);

		const stack =
			document.getElementById(
				"video-accordions"
			);

		if (!stack) {
			return;
		}

		stack.appendChild(
			acc
		);

		project.el =
			acc;

		const files =
			document.getElementById(
				"va-file-" + n
			);

		if (files) {
			files.addEventListener(
				"change",
				(event) =>
					onVideoFiles(
						n,
						event
					)
			);
		}

		const audioInput =
			document.getElementById(
				"va-audio-" + n
			);

		if (audioInput) {
			audioInput.addEventListener(
				"change",
				(event) =>
					onVideoAudio(
						n,
						event
					)
			);
		}

		const restoredTplLink =
			document.getElementById(
				"va-template-link-" + n
			);

		if (restoredTplLink) {
			restoredTplLink.removeAttribute("onclick");
			restoredTplLink.addEventListener(
				"click",
				(event) => {
					event.preventDefault();
					if (typeof window.openTemplateModal === "function") {
						window.openTemplateModal(n);
					}
				}
			);
		}

		const set = (id, value) => {

			const el =
				document.getElementById(id);

			if (el) {
				el.value = value;
			}

		};

		set("va-title-" + n, state.title);
		set("va-font-" + n, state.font || "oswald");
		set("va-color-" + n, state.color || "white");
		set("va-quality-" + n, state.quality || "balanced");
		set("va-script-topic-" + n, state.topic);
		set("va-script-minutes-" + n, state.minutes || "1");
		set("va-script-speed-" + n, state.speed || "medium");

		/* The gallery is rebuilt from the files the project kept. */
		for (const asset of project.assets) {

			asset.card =
				null;

			try {
				buildVaCard(
					n,
					asset
				);
			}
			catch (cardError) {
				console.warn(
					"Video " + n + ": could not restore an asset card.",
					cardError
				);
			}

		}

		if (project.audioFile) {

			const line =
				document.getElementById(
					"va-audio-line-" + n
				);

			if (line) {
				line.textContent =
					"\ud83c\udfb5 " + project.audioFile.name;
			}

		}

		const keywords =
			document.getElementById(
				"va-script-keywords-" + n
			);

		if (keywords && state.keywordsHTML) {
			keywords.innerHTML =
				state.keywordsHTML;
			keywords.style.display =
				state.keywordsHidden ? "none" : "";
		}

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		if (box && project.script) {
			box.textContent =
				project.script;
		}

		const status =
			document.getElementById(
				"va-script-status-" + n
			);

		if (status && state.statusText) {
			status.textContent =
				state.statusText;
		}

			if (state.scriptKeepWritingUi || state.scriptBoxLoading) {
				/* Renumbering must not remove the editor's writing textbox. */
				setScriptLoading(n, true);
				const restoredStatus = document.getElementById("va-script-status-" + n);
				if (restoredStatus && (!state.statusText || scriptWriteUiLooksLikeError(state.statusText))) {
					restoredStatus.textContent = SCRIPT_WRITE_UI_TEXT;
				}
			}
			else {
				setScriptBoxState(
					n,
					!!project.script && state.scriptBoxOpen
				);
			}

		const body =
			document.getElementById(
				"va-body-" + n
			);

		if (body && !state.bodyOpen) {
			body.style.display =
				"none";

			const arrow =
				document.getElementById(
					"va-arrow-" + n
				);

			if (arrow) {
				arrow.textContent =
					"\u25b6";
			}
		}

		updateVideoStatus(
			n
		);

		syncVoiceoverButton(
			n
		);

		// A rebuilt accordion must preserve locks owned by an in-flight flow.
		setVaUploadEnabled(n, !(project._seoPlanBusy || project._imageFlowActive || project._seoChoicePending));
		const scriptButton = document.getElementById("va-script-btn-" + n);
		if (scriptButton) scriptButton.disabled = Boolean(project._seoPlanBusy || project._imageFlowActive);

	}

	/* Closes the transient per-video windows (they are not renumbered). */
	function closeVideoModals(n) {

		for (const id of ["seo-walkthrough-modal-", "voiceover-modal-"]) {

			const modal =
				document.getElementById(id + n);

			if (modal) {

				if (typeof closeModal === "function") {
					closeModal(modal);
				}
				else if (modal.parentNode) {
					modal.parentNode.removeChild(modal);
				}

			}

		}

	}

	/*
	 * Removes Video n, then renumbers everything after it so the
	 * stack is always Video 1..N.
	 */
	function deleteVideoAccordion(n) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		const assetCount =
			project.assets.length;

		const message =
			"Delete " + project.name + "?" +
			(assetCount
				? " Its " + assetCount + " image/GIF/MP4 file(s), MP3 and script will be removed."
				: " Its MP3 and script will be removed.");

		if (typeof confirm === "function" && !confirm(message)) {
			return;
		}

		const total =
			videoProjects.length;

		/* Snapshot the survivors before the array changes. */
		const survivors = [];

		for (let i = 1; i <= total; i++) {

			if (i !== n) {

				const state =
					captureVideoAccordionState(i);

				if (state) {
					survivors.push(state);
				}

			}

		}

		/*
		 * Detach every surviving accordion: the rebuild below creates the
		 * whole stack again with the new numbers, so the old nodes must
		 * not stay behind (that would leave two Video 1 nodes).
		 */
		for (const state of survivors) {

			if (state.project.el && state.project.el.parentNode) {
				state.project.el.parentNode.removeChild(state.project.el);
			}

		}

		/* Cancel any in-flight or queued AI flows for this deleted project first. */
		project._deleted = true;
		cancelScriptWriteRetryWait(project);
		project._imageFlowActive = false;
		project._imageFlowSeq = (project._imageFlowSeq || 0) + 1;
		cancelImageAutoRetry(project, { quiet: true });
		if (project._manualControllers) project._manualControllers.forEach(function (controller) { controller.abort(); });

		for (const ctrlKey of [
			"_stockSearchController",
			"_imageBatchController",
			"_imagePromptCreateController",
			"_seoPlanController",
			"_seoScriptController",
			"_voiceoverController"
		]) {
			if (project[ctrlKey]) {
				try {
					project[ctrlKey].abort();
				}
				catch (abortError) { }
				project[ctrlKey] = null;
			}
		}

		appImageStreamQueue.cancelMatching(function (meta) {
			return Boolean(
				meta &&
				meta.kind === "editor-video" &&
				(meta.project ? meta.project === project : meta.videoIndex === n)
			);
		}, "The video was deleted");

		manualImageTaskQueue.cancelMatching(function (meta) {
			return Boolean(
				meta &&
				meta.kind === "manual-ai" &&
				(meta.project ? meta.project === project : meta.videoIndex === n)
			);
		}, "The video was deleted");

		const aiResultsPanel =
			document.getElementById("va-ai-results-" + n);

		if (aiResultsPanel && aiResultsPanel.children) {
			Array.from(aiResultsPanel.children).forEach(function (card) {
				if (card && card._displayUrl) {
					try {
						releaseStudioObjectUrl(card._displayUrl);
					}
					catch (revokeErr) { }
				}
			});
		}

		if (project.audio && project.audio.url) {
			try {
				releaseStudioObjectUrl(project.audio.url);
			}
			catch (audioRevokeErr) { }
		}

		/* Free this video's object URLs - nothing else points at them. */
		for (const asset of project.assets) {

			try {
				releaseStudioObjectUrl(asset.url);
			}
			catch (revokeError) { }

		}

		for (let i = n; i <= total; i++) {
			closeVideoModals(i);
		}

		videoProjects.splice(
			n - 1,
			1
		);

		if (project.el && project.el.parentNode) {
			project.el.parentNode.removeChild(project.el);
		}

		/* Rebuild the stack as 1..N, in order. */
		for (let index = 0; index < survivors.length; index++) {
			restoreVideoAccordionState(
				index + 1,
				survivors[index]
			);
		}

		if (typeof renderBatchTable === "function") {
			renderBatchTable();
		}

	}

	function clickVaFiles(n) {

		const uploadBtn =
			document.getElementById(
				"va-upload-btn-" + n
			);

		if (uploadBtn && uploadBtn.disabled) {
			return;
		}

		const input =
			document.getElementById(
				"va-file-" + n
			);

		if (input) {
			input.click();
		}

	}

	function clickVaAudio(n) {

		const input =
			document.getElementById(
				"va-audio-" + n
			);

		if (input) {
			input.click();
		}

	}

	/*
	 * Static option lists, copied from
	 * the main panels.
	 */
	const QUALITY_OPTIONS =
		'<option value="low">480p \u00b7 Light (1.2 Mbps)</option>' +
		'<option value="balanced" selected>720p \u00b7 Balanced (2.5 Mbps)</option>' +
		'<option value="high">720p \u00b7 High (5 Mbps)</option>';

	const FONT_OPTIONS =
		'<option value="oswald">Oswald</option>' +
		'<option value="bauhaus">Bauhaus</option>' +
		'<option value="bookman">Bookman</option>';

	const COLOR_OPTIONS =
		'<option value="white">White text</option>' +
		'<option value="black">Black text</option>' +
		'<option value="green">Green text</option>';

	function videoAccordionHTML(
		n
	) {

		return (
			'<div class="va-header">' +
			'<span class="va-title">\ud83c\udfac Video ' + n + '</span>' +
			'<span class="va-status" id="va-status-' + n + '">empty</span>' +
			'<span class="va-summary" id="va-summary-' + n + '"></span>' +
			'<button type="button" class="va-arrow" id="va-arrow-' + n + '" onclick="toggleVideoAccordion(' + n + ')" title="Collapse / expand">\u25bc</button>' +
			'</div>' +
			'<div class="va-body" id="va-body-' + n + '">' +
			'<div class="va-left">' +
				'<div class="va-section">' +
				'<div class="va-section-title">Generate SEO Script With AI</div>' +
				'<span class="va-note">SEO rule (explainer): 1 long-tail keyword said at least 1\u00d7 \u00b7 exactly 4 short keywords said at least 2\u00d7 each \u00b7 minimums only, extra uses are allowed \u00b7 one short keyword is in the title \u00b7 one is in a heading \u00b7 short/long-tail overlap is allowed and shared uses count for both \u00b7 no long-tail length rule</span>' +
				'<input type="text" id="va-script-topic-' + n + '" maxlength="120" placeholder="Topic (uses the video title if empty)">' +
				'<div class="va-row">' +
				'<label class="quality-select">Minutes <select id="va-script-minutes-' + n + '"><option value="1" selected>1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></label>' +
				'<label class="quality-select">Speech <select id="va-script-speed-' + n + '"><option value="super fast">Super fast</option><option value="fast">Fast</option><option value="medium" selected>Medium</option><option value="slow">Slow</option></select></label>' +
				'</div>' +
				'<button type="button" class="upload-btn small" id="va-script-btn-' + n + '" onclick="generateScript(' + n + ')" style="margin-top:4px" title="AI plans 1 long-tail keyword (said at least once), exactly 4 short keywords (each said at least twice) plus the explainer title and headings, then writes the plain narration script around them. Extra uses are allowed. Short keywords may overlap the long-tail (shared uses count for both); no long-tail length rule. The script is saved as spoken text \u2014 no subtitle formatting \u2014 so the voiceover can read it as it is.">\u2728 Generate SEO Script</button>' +
				'<span class="va-note" id="va-script-status-' + n + '"></span>' +
				'<div class="va-seo-keywords" id="va-script-keywords-' + n + '" style="display:none"></div>' +
				'<button type="button" class="va-scroll-toggle" id="va-script-toggle-' + n + '" onclick="toggleScriptBox(' + n + ')" style="display:none" title="Show / hide the narration script">\u25bc Script</button>' +
				'<div class="va-script-box" id="va-script-box-' + n + '" style="display:none"></div>' +
				'<div class="va-row va-script-actions">' +
				'<button type="button" class="upload-btn small" id="va-voice-btn-' + n + '" onclick="openVoiceoverModal(' + n + ')" disabled style="display:none" title="Speak the narration script to MP3 with MeloTTS (English) + apply it as subtitles">\ud83c\udf99 Generate Voiceover</button>' +
				'</div>' +
				'</div>' +
				'<div class="va-section">' +
				'<div class="va-section-title">Images / MP4s \u2014 drag cards to reorder</div>' +
				'<button type="button" class="upload-btn" id="va-upload-btn-' + n + '" onclick="clickVaFiles(' + n + ')">\ud83d\udcc1 Upload Image, GIF or MP4</button>' +
				'<span class="va-note">Max 5 GIF \u00b7 25 images \u00b7 5 MP4 (1:00 each, silent)</span>' +
				'<a href="#" class="va-template-link" id="va-template-link-' + n + '" data-video-index="' + n + '" onclick="if (!event.defaultPrevented && window.openTemplateModal) window.openTemplateModal(' + n + '); return false;" title="Compose a portrait or landscape MP4 (max 25 seconds) from a design template and add it to this video">Add video from template</a>' +
				'<button type="button" class="va-scroll-toggle" id="va-gallery-toggle-' + n + '" onclick="toggleGalleryScroll(' + n + ')" title="Show / hide the image gallery">\u25b2 Images / MP4s</button>' +
				'<span class="va-note" id="va-ai-status-' + n + '">Automatic Pixabay scenes include 4 stock video clips and 8 distinct photos.</span>' +
				'<div class="va-seo-keywords" id="va-image-keywords-' + n + '" style="display:none"></div>' +
				'<button type="button" class="upload-btn small" id="va-image-retry-' + n + '" onclick="retryImagePromptFlow(' + n + ')" style="display:none" title="Search Pixabay again using the keywords shown below and add the matching photos and clips to this gallery">Retry Pixabay search</button>' +
				'<div class="va-gallery" id="va-gallery-' + n + '"></div>' +
				'</div>' +
				'<div class="va-section">' +
				'<div class="va-section-title">Audio \u2014 one MP3 (the video is as long as the MP3)</div>' +
				'<button type="button" class="upload-btn audio" onclick="clickVaAudio(' + n + ')">\ud83c\udfb5 Upload MP3 Audio</button>' +
				'<span class="va-audio-line" id="va-audio-line-' + n + '"></span>' +
				'</div>' +
				'<div class="va-section">' +
				'<div class="va-section-title">Title (top left)</div>' +
				'<input type="text" id="va-title-' + n + '" maxlength="70" placeholder="Enter your video title...">' +
				'<div class="va-row">' +
				'<label class="quality-select">Font <select id="va-font-' + n + '">' + FONT_OPTIONS + '</select></label>' +
				'<label class="quality-select">Colour <select id="va-color-' + n + '">' + COLOR_OPTIONS + '</select></label>' +
				'</div>' +
				'</div>' +
				'<div class="va-section">' +
				'<div class="va-section-title">Quality</div>' +
				'<select id="va-quality-' + n + '" class="quality-select">' + QUALITY_OPTIONS + '</select>' +
				'</div>' +
			'</div>' +
			/* Session 331 (layout): Delete Video sits at the bottom of the body, full width. */
			'<button type="button" class="va-delete-btn" id="va-delete-' + n + '" onclick="deleteVideoAccordion(' + n + ')" title="Delete this video with its images, MP4s, audio and script">\ud83d\uddd1\ufe0f Delete Video</button>' +
			'</div>' +
			'<input type="file" id="va-file-' + n + '" multiple accept="image/*,image/gif,.gif,video/mp4,.mp4" style="display:none">' +
			'<input type="file" id="va-audio-' + n + '" accept="audio/mpeg,.mp3" style="display:none">'
		);

	}

	function videoCounts(
		project
	) {

		const gifs =
			project.assets.filter(
				(a) =>
					a.kind === "gif"
			).length;

		const stills =
			project.assets.filter(
				(a) =>
					a.kind === "image"
			).length;

		const clips =
			project.assets.filter(
				(a) =>
					a.kind === "mp4"
			).length;

		return {
			gifs: gifs,
			stills: stills,
			clips: clips,
		};

	}

	function updateVideoStatus(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		const statusEl =
			document.getElementById(
				"va-status-" + n
			);

		if (statusEl) {

			statusEl.textContent =
				project.status;

			statusEl.style.background =
				STATUS_COLORS[project.status] ||
				"#374151";

		}

		const summaryEl =
			document.getElementById(
				"va-summary-" + n
			);

		if (summaryEl) {

			const counts =
				videoCounts(
					project
				);

			const parts =
				[];

			if (
				counts.stills > 0
			) {

				parts.push(
					counts.stills +
						" image" +
						(counts.stills === 1
							? ""
							: "s")
				);

			}

			if (
				counts.gifs > 0
			) {

				parts.push(
					counts.gifs +
						" GIF" +
						(counts.gifs === 1
							? ""
							: "s")
				);

			}

			if (
				counts.clips > 0
			) {

				const total =
					project.assets.reduce(
						(sum, a) =>
							a.kind === "mp4" &&
							Number.isFinite(Number(a.duration)) &&
							Number(a.duration) > 0
							? sum + Number(a.duration)
							: sum,
						0
					);

				parts.push(
					counts.clips +
						" MP4 (" +
						formatSeconds(
							total
						) +
						")"
				);

			}

			if (
				project.audioFile
			) {

				parts.push(
					"MP3" +
					(project.audio
						? " " +
							formatSeconds(
								project.audio.duration
							)
						: "")
				);

			}

			const rows =
				document.getElementById(
					"va-captions-" + n
				);

			if (
				rows &&
				rows.children.length > 0
			) {

				parts.push(
					rows.children.length +
						" caption" +
						(rows.children.length === 1
							? ""
							: "s")
				);

			}

			summaryEl.textContent =
				parts.length
				? parts.join(" \u00b7 ")
				: "no images yet";
		}

		refreshVaTips(
			n
		);

		try {
			composeEditorProjectDetail(project, n);
		} catch (editorDetailError) { }

		renderBatchTable();
	}

	// =========================================================
	// MODULE 1b: studio shell (Bug Fix Session #240, table view
	//             rewritten by Session #242)
	//
	// Two views over one shell, switched by [data-layout]:
	//   Bulk grid  #view-table - the quick batch table (its own
	//              rows, MODULE 1c; RULE 25)
	//   Editor     #view-editor - the Video N accordions beside
	//              the preview canvas
	//
	// Pipeline management state is mirrored in localStorage + cookie.
	// The live layout starts in the Editor unless that snapshot says table.
	// =========================================================

	let studioLayout =
		"editor";

	function timelineEditorRouteRequested() {
		try {
			return new URLSearchParams(window.location.search || "").get("layout") === "timeline";
		} catch (error) { return false; }
	}

	/*
	 * Session 333: an explicit ?layout= in the address bar is a request, and it
	 * wins over the layout the page's store happens to remember.
	 *
	 * The timeline editor's "← Quick Batch" link navigates to
	 * ?layout=table&pipelinePage=<the table's page>. Until now nothing read that
	 * parameter: restorePipelineManagementState() put the page back into whatever
	 * layout the snapshot was last saved with ("editor" for any page that had
	 * ever been in the editor), so the same click sometimes landed on the Quick
	 * Batch table and sometimes on the editor accordion. The timeline route is
	 * handled by timelineEditorRouteRequested() and is not this function's business.
	 */
	function requestedStudioLayout() {
		try {
			const name = new URLSearchParams(window.location.search || "").get("layout");
			return name === "table" || name === "editor" ? name : "";
		} catch (error) { return ""; }
	}

	function activateTimelineEditorLayout() {
		const studioApp = document.getElementById("studio-app");
		const tableView = document.getElementById("view-table");
		const editorView = document.getElementById("view-editor");
		const timelineView = document.getElementById("view-timeline");
		const landingPage = document.getElementById("landing-page");
		if (landingPage) landingPage.hidden = true;
		if (studioApp) {
			studioApp.hidden = false;
			studioApp.classList.add("timeline-mode");
		}
		if (document.body) document.body.classList.add("timeline-editor-page");
		if (tableView) tableView.classList.remove("active");
		if (editorView) editorView.classList.remove("active");
		if (timelineView) timelineView.classList.add("active");
		const viewSwitch = document.getElementById("view-switch");
		const topGenerate = document.getElementById("top-generate");
		const storageAlert = document.getElementById("pipeline-storage-alert");
		const galleryEl = document.getElementById("gallery");
		/* The ＋ Add Video heading is an editor-layout control: not on this page. */
		const studioHeading = document.getElementById("studio-heading");
		if (studioHeading) studioHeading.hidden = true;
		if (viewSwitch) viewSwitch.hidden = true;
		if (topGenerate) topGenerate.hidden = true;
		if (storageAlert) storageAlert.hidden = true;
		if (galleryEl) {
			galleryEl.hidden = true;
			galleryEl.style.display = "none";
			galleryEl.innerHTML = "";
		}
	}

	function setStudioLayout(name) {

		studioLayout =
			name === "table"
				? "table"
				: "editor";

		const studioApp = document.getElementById("studio-app");
		if (studioApp) studioApp.classList.remove("timeline-mode");
		if (document.body) document.body.classList.remove("timeline-editor-page");

		const timelineView = document.getElementById("view-timeline");
		if (timelineView) timelineView.classList.remove("active");

		/*
		 * Session 332: all that is left of the page heading is the ＋ Add Video
		 * button (the VIDEO WORKSPACE kicker, the "\ud83c\udfac YouTube Vibe Studio"
		 * title and the "Generates AI scenes\u2026" line are removed from every
		 * layout), and that button belongs to the EDITOR layout only — it no
		 * longer sits on top of the Quick Batch table.
		 */
		const studioHeading = document.getElementById("studio-heading");
		if (studioHeading) studioHeading.hidden = studioLayout !== "editor";

		const tableView =
			document.getElementById(
				"view-table"
			);

		const editorView =
			document.getElementById(
				"view-editor"
			);

		if (tableView) {

			tableView.classList.toggle(
				"active",
				studioLayout === "table"
			);

		}

		if (editorView) {

			editorView.classList.toggle(
				"active",
				studioLayout === "editor"
			);

		}

		const buttons =
			document.querySelectorAll(
				"[data-layout]"
			);

		for (const button of buttons) {

			const on =
				button.getAttribute(
					"data-layout"
				) ===
				studioLayout;

			button.classList.toggle(
				"active",
				on
			);

			button.setAttribute(
				"aria-selected",
				on
					? "true"
					: "false"
			);

		}

		if (studioLayout === "table") {

			if (!pipelineManagementRestoring && typeof reconcileTimelineEdits === "function") {
				try { reconcileTimelineEdits(); } catch (reconcileError) { }
			}

			renderBatchTable();

		}
		else {

			const topGen =
				document.getElementById(
					"top-generate"
				);

			if (topGen) {

				topGen.disabled =
					!!generating;

				topGen.textContent =
					"\u2726 Generate";

				topGen.title =
					"Render and download the MP4";

			}

		}

		persistPipelineManagementState("layout");

	}

	// Consistent stock-media treatments for Quick Batch and the timeline.
	window.__videoStyleFilter = function (style) {
		return ({ "Cinematic Film": "contrast(1.12) saturate(0.9)", "Editorial Magazine": "contrast(1.08) saturate(0.85)", "Kinetic Typography": "contrast(1.1)", "Neon Night": "contrast(1.15) saturate(1.4) hue-rotate(12deg)", "Minimalist": "saturate(0.65) contrast(1.05)", "Retro Poster": "sepia(0.32) saturate(1.25) contrast(1.12)", "Documentary": "saturate(0.8) contrast(1.05)", "Split Composition": "contrast(1.1)", "Dream Glow": "brightness(1.1) saturate(1.15)", "Pop Comic": "contrast(1.25) saturate(1.5)" })[style] || "none";
	};

	const SEO_IMAGE_STYLES = [
		"Cinematic Film",
		"Editorial Magazine",
		"Kinetic Typography",
		"Neon Night",
		"Minimalist",
		"Retro Poster",
		"Documentary",
		"Split Composition",
		"Dream Glow",
		"Pop Comic"
	];

	const DEFAULT_SEO_IMAGE_STYLE =
		"Cinematic Film";

	/*
	 * Template-modal image effects for a Quick Batch row style.
	 *
	 * The "Add video from template" modal in the editor layout paints its
	 * image treatments on the canvas (template-scene-editor.ts
	 * reelDrawBackground), so there is no CSS gradient to reuse - the
	 * treatments themselves are the existing code:
	 *
	 *   duotone  the template modal's "Duotone gradient" style: a moving
	 *            two-colour gradient (#ff6b35 -> #2ec4b6), i.e. the double
	 *            gradient painted over the image or video frame
	 *   neon     the "neon" style's pink radial glow (createRadialGradient)
	 *   vhs      the "glitch" style / "Scanlines" effect: rolling black bars
	 *
	 * Requested mapping (session 331, section 15):
	 *
	 *   Cinematic Film  -> duotone (double gradient on video and image)
	 *   Neon Night      -> neon + vhs (neon image effect together with VHS)
	 *   Retro Poster    -> vhs
	 *   anything else   -> the CSS filter only (window.__videoStyleFilter)
	 *
	 * The same list is stamped onto every scene of the timeline handoff so
	 * the treatment is not a preview-only trick: every scene, every table
	 * preview frame and every exported frame resolves the same names.
	 */
	const VIDEO_STYLE_EFFECT_LABELS = {
		duotone: "double gradient",
		neon: "neon glow",
		vhs: "VHS scanlines"
	};

	function videoStyleEffects(style) {
		const name =
			String(style || "");
		const effects = [];
		if (
			/duotone|cinematic/i.test(name) ||
			name === DEFAULT_SEO_IMAGE_STYLE
		) {
			effects.push("duotone");
		}
		if (/neon/i.test(name)) effects.push("neon");
		if (/neon|retro|vhs|glitch/i.test(name)) effects.push("vhs");
		return effects;
	}

	window.__videoStyleEffects = videoStyleEffects;

	window.__VIDEO_STYLE_EFFECT_LABELS = VIDEO_STYLE_EFFECT_LABELS;

	function videoStyleEffectLabel(effects) {
		return (Array.isArray(effects) ? effects : [])
			.map(function (effect) {
				return VIDEO_STYLE_EFFECT_LABELS[effect] || String(effect || "");
			})
			.filter(function (label) { return Boolean(label); })
			.join(" + ");
	}

	window.__videoStyleEffectLabel = videoStyleEffectLabel;

	/*
	 * One painter for the three template-modal treatments above, copied from
	 * reelDrawBackground() so every surface (Quick Batch table preview,
	 * timeline preview, timeline MP4 export and the shared MP4 renderer)
	 * paints the identical bytes. Guards keep bare canvas test doubles safe.
	 *
	 * Order matters and matches the modal: duotone gradient, then the neon
	 * glow, then the rolling VHS bars.
	 */
	window.__paintVideoStyleEffects = function (context, width, height, seconds, style, effects) {
		if (!context) return [];
		const list =
			Array.isArray(effects) && effects.length
				? effects
				: videoStyleEffects(style);
		if (!list.length) return [];
		const scale =
			Math.max(0.5, Number(height || 0) / 720);
		const time =
			Math.max(0, Number(seconds) || 0);
		if (
			list.indexOf("duotone") !== -1 &&
			typeof context.createLinearGradient === "function"
		) {
			const shift =
				((time * 14) % 100) / 100;
			const duo =
				context.createLinearGradient(width * (shift - 0.5), 0, width * (shift + 1), 0);
			duo.addColorStop(0, "rgba(255,107,53,0.42)");
			duo.addColorStop(0.5, "rgba(255,107,53,0.12)");
			duo.addColorStop(1, "rgba(46,196,182,0.44)");
			context.save();
			context.fillStyle = duo;
			context.fillRect(0, 0, width, height);
			context.restore();
		}
		if (
			list.indexOf("neon") !== -1 &&
			typeof context.createRadialGradient === "function"
		) {
			const glow =
				context.createRadialGradient(width * 0.5, height * 0.5, width * 0.03, width * 0.5, height * 0.5, width * 0.72);
			glow.addColorStop(0, "rgba(255,45,149,0.08)");
			glow.addColorStop(1, "rgba(0,0,0,0.52)");
			context.save();
			context.fillStyle = glow;
			context.fillRect(0, 0, width, height);
			context.restore();
		}
		if (list.indexOf("vhs") !== -1) {
			const effectLine =
				Math.max(2, Math.round(2 * scale));
			const gap =
				Math.max(5, Math.round(7 * scale));
			const scroll =
				Math.floor((time * 24) % gap);
			context.save();
			context.globalAlpha = 0.3;
			context.fillStyle = "rgba(0,0,0,0.72)";
			for (let y = -gap; y < height + gap; y += gap) {
				context.fillRect(0, y + scroll, width, effectLine);
			}
			context.restore();
		}
		return list;
	};

	// =========================================================
	// MODULE 1c: quick-batch table (the studio's "table layout")
	//
	// One row = one video, produced entirely from the row itself:
	//
	//   column 1  the script (plain narration text, typed or pasted)
	//   column 2  the video image style - the SAME ten options the
	//             script modal offers, in the same order
	//   column 3  the Pixabay image resolution: 480, 540, 720 or 1024 px
	//             (the LONG edge; passed to both image calls)
	//   column 4  the frame orientation: square 1:1, landscape 16:9
	//             or portrait 9:16 (passed to both image calls)
	//   column 5  Actions: Preview, Process Export and Edit icons. Preview
	//             and Process Export stay pending until the row finishes;
	//             Edit opens the client-only Timeline Editor with row timing.
	//
	// The old "Min" column (column 3, 1-6 typed minutes) is removed. The
	// row's length is the measured narration: the voiceover pass decodes
	// the MP3 and that duration drives the slides and the timeline
	// handoff. row.minutes is still stored (default 1) as the silent
	// fallback used when a decode reports nothing.
	//
	// The \u2726 Generate button at the TOP RIGHT of the table runs every
	// row that has a script and is NOT finished yet. A row without one
	// is skipped, and so is a row whose Preview / Export buttons are
	// already live (re-pressing Generate must never re-bill a finished
	// video). Missing inputs fall back to their defaults: 1 minute,
	// Cinematic Film, 1024 px and landscape 16:9.
	//
	// Rows run BATCH_RUN_CONCURRENCY (3) at a time: three rows speak,
	// draw and animate simultaneously, and the next queued row starts
	// as soon as one of them finishes.
	//
	// A row is finished when all four steps are through - the spoken
	// MP3, the Pixabay images, and the animation that stitches them - and
	// only then do Preview and Export enable, always together.
	//
	// Rows are deliberately independent of the "Video N" accordions:
	// nothing here reads or writes videoProjects, so the quick table
	// is a fast lane and the accordions stay the detailed editor.
	// =========================================================

	const BATCH_ROW_LIMIT =
		VIDEO_MAX_VIDEOS;

	const BATCH_MIN_MINUTES =
		1;

	const BATCH_MAX_MINUTES =
		6;

	/* The row stays usable if the LLM or the image batch is slow. */
	const BATCH_REQUEST_TIMEOUT_MS =
		240000;

	/* Never let a stalled image decode hold the row open. */
	const BATCH_SLIDE_DECODE_MS =
		10000;

	/*
	 * Session #211: the table used to run one row at a time, so a five-row
	 * table paid the full voiceover + prompt + image + animate cost five
	 * times in series. Three rows now render at the same time; the fourth
	 * starts as soon as one of the three finishes.
	 */
	const BATCH_RUN_CONCURRENCY =
		3;

	/*
	 * FINAL RULE - QUICK BATCH TABLE LAYOUT: a failed stage is retried by
	 * client JavaScript up to seven times, each after a 40-second backoff.
	 * Nothing about a retry reaches the screen: the row keeps its normal
	 * stage label, script textarea and spinner for all eight attempts.
	 */
	const BATCH_STEP_ATTEMPTS =
		4;

	/* Backoff between the silent retries: 0.8s, 1.6s, 3.2s. */
	const BATCH_RETRY_BASE_MS =
		800;

	const BATCH_RETRY_MAX_MS =
		4000;

	/*
	 * FINAL RULE - QUICK BATCH TABLE LAYOUT (client-side pipeline retries).
	 *
	 * JavaScript in the browser owns every failed pipeline stage in this
	 * layout. One initial attempt is followed by at most SEVEN retries, and
	 * every retry waits 40 seconds first. Only the failed stage is reset and
	 * repeated; successful earlier stages are kept. A missing scene plan,
	 * a partial image set, a missing clip pair or a local animation failure
	 * all remain silent: the same row cells, status spinner and script
	 * textarea stay on screen and no error/retry wording is painted.
	 */
	const BATCH_PIPELINE_MAX_RETRIES = 7;
	const BATCH_PIPELINE_RETRY_BACKOFF_MS = 40000;
	const BATCH_PIPELINE_UI_CHECK_MS = 250;
	const BATCH_PIPELINE_TOTAL_ATTEMPTS = BATCH_PIPELINE_MAX_RETRIES + 1;

	/* Exposed so tests / debugging can see (and shrink) the live budgets. */
	if (typeof window !== "undefined") {
		const suppliedPipelineTiming =
			window.__BATCH_PIPELINE_RETRY_TIMING && typeof window.__BATCH_PIPELINE_RETRY_TIMING === "object"
				? window.__BATCH_PIPELINE_RETRY_TIMING
				: window.__BATCH_PIPELINE_RETRY_POLICY && typeof window.__BATCH_PIPELINE_RETRY_POLICY === "object"
					? window.__BATCH_PIPELINE_RETRY_POLICY
					: window.__QUICK_BATCH_RETRY_TIMING && typeof window.__QUICK_BATCH_RETRY_TIMING === "object"
						? window.__QUICK_BATCH_RETRY_TIMING
						: null;
		const pipelineTiming = suppliedPipelineTiming || {};
		const pipelineDefaults = {
			maxRetries: BATCH_PIPELINE_MAX_RETRIES,
			maxAttempts: BATCH_PIPELINE_TOTAL_ATTEMPTS,
			backoffMs: BATCH_PIPELINE_RETRY_BACKOFF_MS,
			retryBackoffMs: BATCH_PIPELINE_RETRY_BACKOFF_MS,
			delayMs: BATCH_PIPELINE_RETRY_BACKOFF_MS,
			pipelineRetryBackoffMs: BATCH_PIPELINE_RETRY_BACKOFF_MS,
			uiCheckMs: BATCH_PIPELINE_UI_CHECK_MS,
			owner: "browser",
			layout: "quick-batch-table",
			scope: "per-failed-stage"
		};
		for (const key in pipelineDefaults) {
			if (!(key in pipelineTiming)) pipelineTiming[key] = pipelineDefaults[key];
		}
		window.__BATCH_PIPELINE_RETRY_TIMING = pipelineTiming;
		window.__BATCH_PIPELINE_RETRY_POLICY = pipelineTiming;
		window.__BATCH_PIPELINE_RETRY = pipelineTiming;
		window.__QUICK_BATCH_RETRY_TIMING = pipelineTiming;
		window.__BATCH_PIPELINE_RETRY_LOG = [];
	}

	function batchPipelineRetrySources() {
		if (typeof window === "undefined") return [];
		return [
			window.__BATCH_PIPELINE_RETRY_TIMING,
			window.__BATCH_PIPELINE_RETRY_POLICY,
			window.__BATCH_PIPELINE_RETRY,
			window.__QUICK_BATCH_RETRY_TIMING,
			window.__SCRIPT_RETRY_TIMING,
			window.__SCRIPT_RETRY_POLICY,
			window.__BATCH_RETRY
		];
	}

	/*
	 * A non-default value in ANY exposed policy is an override. The legacy
	 * __BATCH_RETRY object keeps its own defaults, so a test that sets only
	 * attempts/baseMs/maxMs can still shorten every Quick Batch pipeline.
	 */
	function batchPipelineRetryPolicy() {
		const retryKeys = ["maxRetries", "maxPipelineRetries", "retries", "retryLimit", "pipelineRetries", "clientRetries", "limit"];
		const attemptKeys = ["maxAttempts", "maxPipelineAttempts", "attempts", "pipelineAttempts", "totalAttempts"];
		const backoffKeys = ["backoffMs", "retryBackoffMs", "delayMs", "retryDelayMs", "retryMs", "backoff", "pipelineRetryBackoffMs", "baseMs", "maxMs"];
		const uiKeys = ["uiCheckMs", "pipelineUiCheckMs", "tickMs"];
		let retryOverride = null;
		let attemptOverride = null;
		let backoffOverride = null;
		let uiOverride = null;
		const legacy = typeof window !== "undefined" ? window.__BATCH_RETRY : null;
		for (const source of batchPipelineRetrySources()) {
			if (!source || typeof source !== "object") continue;
			const isLegacy = source === legacy;
			for (const key of retryKeys.concat(attemptKeys, backoffKeys, uiKeys)) {
				const value = Number(source[key]);
				if (!isFinite(value) || value < 0) continue;
				let fallback;
				if (retryKeys.indexOf(key) !== -1) fallback = isLegacy ? BATCH_STEP_ATTEMPTS : BATCH_PIPELINE_MAX_RETRIES;
				else if (attemptKeys.indexOf(key) !== -1) fallback = isLegacy ? BATCH_STEP_ATTEMPTS : BATCH_PIPELINE_TOTAL_ATTEMPTS;
				else if (backoffKeys.indexOf(key) !== -1) fallback = isLegacy ? (key === "maxMs" ? BATCH_RETRY_MAX_MS : BATCH_RETRY_BASE_MS) : BATCH_PIPELINE_RETRY_BACKOFF_MS;
				else fallback = BATCH_PIPELINE_UI_CHECK_MS;
				if (value === fallback) continue;
				if (retryKeys.indexOf(key) !== -1 && retryOverride === null) retryOverride = value;
				if (attemptKeys.indexOf(key) !== -1 && attemptOverride === null) attemptOverride = value;
				if (backoffKeys.indexOf(key) !== -1 && backoffOverride === null) backoffOverride = value;
				if (uiKeys.indexOf(key) !== -1 && uiOverride === null) uiOverride = value;
			}
		}
		let maxRetries = BATCH_PIPELINE_MAX_RETRIES;
		if (retryOverride !== null) maxRetries = retryOverride;
		else if (attemptOverride !== null) maxRetries = Math.max(0, attemptOverride - 1);
		return {
			owner: "browser",
			layout: "quick-batch-table",
			scope: "per-failed-stage",
			maxRetries: Math.max(0, Math.floor(maxRetries)),
			maxAttempts: Math.max(1, Math.floor(maxRetries) + 1),
			backoffMs: Math.max(0, Math.floor(backoffOverride !== null ? backoffOverride : BATCH_PIPELINE_RETRY_BACKOFF_MS)),
			uiCheckMs: Math.max(0, Math.floor(uiOverride !== null ? uiOverride : BATCH_PIPELINE_UI_CHECK_MS))
		};
	}

	function batchPipelineRetryLog(entry) {
		if (typeof window === "undefined") return;
		const log = Array.isArray(window.__BATCH_PIPELINE_RETRY_LOG) ? window.__BATCH_PIPELINE_RETRY_LOG : [];
		log.push(Object.assign({ at: Date.now(), owner: "browser", layout: "quick-batch-table" }, entry || {}));
		while (log.length > 80) log.shift();
		window.__BATCH_PIPELINE_RETRY_LOG = log;
	}

	function batchPipelineUiLooksLikeError(text) {
		return /failed|failure|error|retry|retrying|timed out|timeout|cancelled|canceled|stopped|unavailable|invalid|abort|missing|⚠/i.test(String(text || ""));
	}

	function cancelBatchPipelineRetryWait(target) {
		const wait = target && target._batchPipelineRetryWait;
		if (wait && typeof wait.cancel === "function") {
			try { wait.cancel(); } catch (cancelError) { }
		}
		if (target) target._batchPipelineRetryWait = null;
	}

	/* Keep the row's working stage, spinner and script textarea continuously. */
	function keepBatchPipelineStageUi(row, stage, detail, force) {
		if (!row) return;
		const activeStage = BATCH_ACTIVE_STAGES.indexOf(stage) !== -1 ? stage : "prompts";
		const label = detail || BATCH_STAGE_LABELS[activeStage] || "Working";
		row.error = "";
		row.retrying = false;
		row.stage = activeStage;
		if (force || !row.detail || batchPipelineUiLooksLikeError(row.detail)) row.detail = label;
		const scope = document.querySelector('[data-batch-row="' + row.id + '"]');
		if (!scope || !scope.querySelector('[data-batch-field="script"]')) renderBatchTable();
		const status = document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="status"]');
		if (!status || status.getAttribute("data-stage") !== activeStage || !status.querySelector(".va-spinner") || batchPipelineUiLooksLikeError(status.textContent)) {
			paintBatchRowStatus(row);
		}
	}

	/* One cancellable 40-second timer per retry, with a quiet UI watchdog. */
	function batchPipelineRetryDelay(ms, row, stage) {
		return new Promise(function (resolve) {
			const policy = batchPipelineRetryPolicy();
			let settled = false;
			let timer = null;
			let uiTimer = null;
			const handle = {
				stage: stage,
				delayMs: ms,
				cancel: function () { finish(true); }
			};
			const cancelled = function () {
				return Boolean(row && (row.stopRequested || !getBatchRow(row.id)));
			};
			const finish = function (wasCancelled) {
				if (settled) return;
				settled = true;
				if (timer !== null) clearTimeout(timer);
				if (uiTimer !== null) clearTimeout(uiTimer);
				if (row && row._batchPipelineRetryWait === handle) row._batchPipelineRetryWait = null;
				resolve(!wasCancelled);
			};
			if (row) row._batchPipelineRetryWait = handle;
			if (cancelled()) { finish(true); return; }
			const tick = function () {
				if (settled) return;
				if (cancelled()) { finish(true); return; }
				keepBatchPipelineStageUi(row, stage, null, true);
				uiTimer = setTimeout(tick, Math.max(1, policy.uiCheckMs));
			};
			if (policy.uiCheckMs > 0) uiTimer = setTimeout(tick, Math.max(1, policy.uiCheckMs));
			timer = setTimeout(function () { finish(cancelled()); }, Math.max(0, ms));
		});
	}

	/*
	 * THE FINAL TABLE-LAYOUT RULE: retry only the failed stage, silently.
	 * The snapshot records the successful work before the stage; reset throws
	 * away only that stage's partial output before the next client attempt.
	 */
	async function batchRunPipelineStage(row, stage, detail, step, options) {
		const policy = batchPipelineRetryPolicy();
		const opts = options || {};
		const label = detail || BATCH_STAGE_LABELS[stage] || "Working";
		let lastError = null;
		for (let retry = 0; retry <= policy.maxRetries; retry++) {
			if (row.stopRequested || !getBatchRow(row.id)) throw batchError("The row was stopped", "AbortError");
			keepBatchPipelineStageUi(row, stage, label, retry === 0);
			const checkpoint = typeof opts.snapshot === "function" ? opts.snapshot() : null;
			batchPipelineRetryLog({ event: "attempt", rowId: row.id, stage: stage, retry: retry, attempt: retry + 1, maxRetries: policy.maxRetries });
			try {
				const result = await step(retry);
				batchPipelineRetryLog({ event: "success", rowId: row.id, stage: stage, retry: retry, attempt: retry + 1 });
				return result;
			} catch (error) {
				if (row.stopRequested || batchIsStopError(error) || !getBatchRow(row.id)) {
					batchPipelineRetryLog({ event: "cancelled", rowId: row.id, stage: stage, retry: retry });
					throw error;
				}
				/* Media items own their own 7-retry ladder; never restart a whole stage for them. */
				if (error && error.name === "MediaItemRetryExhausted") {
					batchPipelineRetryLog({ event: "media-item-exhausted", rowId: row.id, stage: stage, retry: retry });
					throw error;
				}
				lastError = error;
				if (typeof opts.reset === "function") opts.reset(checkpoint, error);
				keepBatchPipelineStageUi(row, stage, label, true);
				batchPipelineRetryLog({
					event: "attempt-failed", rowId: row.id, stage: stage, retry: retry, attempt: retry + 1,
					reason: String(error && (error.message || error) || "unknown").slice(0, 160)
				});
				if (retry >= policy.maxRetries) {
					try { error.clientRetries = retry; error.clientAttempts = retry + 1; } catch (decorateError) { }
					batchPipelineRetryLog({ event: "budget-exhausted", rowId: row.id, stage: stage, attempts: retry + 1, maxRetries: policy.maxRetries });
					throw error;
				}
				batchPipelineRetryLog({ event: "backoff", rowId: row.id, stage: stage, delayMs: policy.backoffMs, nextRetry: retry + 1 });
				const proceed = await batchPipelineRetryDelay(policy.backoffMs, row, stage);
				if (!proceed || row.stopRequested || !getBatchRow(row.id)) throw batchError("The row was stopped", "AbortError");
			}
		}
		throw lastError || batchError("The Quick Batch pipeline stage did not finish", "BatchStepError");
	}


	/*
	 * A batch stream that stops sending lines is as dead as one that
	 * never answered: the NDJSON reader gets this idle budget per read
	 * instead of hanging the row open until the tab is closed.
	 */
	const BATCH_STREAM_IDLE_TIMEOUT_MS =
		90000;

	/*
	 * Never let a stalled WebAudio decode freeze a row on "Measuring the
	 * narration": fall back to the row's minutes setting after 15 seconds.
	 */
	const BATCH_AUDIO_DECODE_MS =
		15000;

	/*
	 * Node.js-style Event-Driven Non-Blocking Image Task Runtime:
	 *   1. Single-threaded event-loop task queues (appImageStreamQueue and
	 *      manualImageTaskQueue) dispatch async network I/O fairly in round-robin
	 *      across active videos/rows without blocking the UI thread.
	 *   2. Background Web Worker thread pool (decodeBase64ImageOffThread) offloads
	 *      multi-megabyte base64-to-binary image decoding off the main thread
	 *      with zero-copy Transferable ArrayBuffers, falling back to cooperative
	 *      64 KB event-loop slices when Web Workers are unavailable.
	 */
	const BATCH_IMAGE_STREAM_CONCURRENCY =
		3;

	const CLIENT_DECODE_THREAD_POOL_SIZE =
		3;

	const CLIENT_WORKER_DECODE_MIN_CHARS =
		16384;

	function yieldClientEventLoop() {

		return new Promise(function (resolve) {

			setTimeout(resolve, 0);

		});

	}

	function createEventDrivenTaskQueue(maxConcurrency) {

		const limit =
			Math.max(1, Number(maxConcurrency) || 3);

		const lanes =
			new Map();

		const ring =
			[];

		let cursor =
			0;

		let active =
			0;

		let queued =
			0;

		let pumpScheduled =
			false;

		function makeAbortErr(msg) {

			const err =
				new Error(msg || "Image task aborted");

			err.name =
				"AbortError";

			return err;

		}

		function cleanupLane(key) {

			const lane =
				lanes.get(key);

			if (lane && lane.items.length === 0 && lane.active === 0) {

				lanes.delete(key);

				const idx =
					ring.indexOf(key);

				if (idx !== -1) {

					ring.splice(idx, 1);

					if (cursor >= ring.length) {
						cursor = 0;
					}

				}

			}

		}

		function schedulePump() {

			if (pumpScheduled) {
				return;
			}

			pumpScheduled =
				true;

			Promise.resolve().then(function () {

				pumpScheduled =
					false;

				pump();

			});

		}

		function pump() {

			while (active < limit && queued > 0 && ring.length > 0) {

				let dispatched =
					false;

				const len =
					ring.length;

				for (let step = 0; step < len; step++) {

					const idx =
						(cursor + step) % len;

					const key =
						ring[idx];

					const lane =
						lanes.get(key);

					if (!lane || lane.items.length === 0) {
						continue;
					}

					let item =
						null;

					while (lane.items.length > 0) {

						const candidate =
							lane.items.shift();

						queued =
							Math.max(0, queued - 1);

						if (candidate.cleanupAbort) {
							candidate.cleanupAbort();
							candidate.cleanupAbort = null;
						}

						if (
							candidate.cancelled ||
							(candidate.isCancelled && candidate.isCancelled())
						) {
							candidate.cancelled = true;
							candidate.reject(makeAbortErr("The row was stopped"));
							continue;
						}

						item =
							candidate;

						break;

					}

					if (!item) {
						cleanupLane(key);
						break;
					}

					cursor =
						(idx + 1) % Math.max(1, ring.length);

					active += 1;
					lane.active += 1;
					dispatched = true;

					(function (pickedKey, pickedLane, pickedItem) {

						Promise.resolve()
							.then(function () {
								return pickedItem.run();
							})
							.then(
								function (val) {
									active = Math.max(0, active - 1);
									pickedLane.active = Math.max(0, pickedLane.active - 1);
									cleanupLane(pickedKey);
									schedulePump();
									pickedItem.resolve(val);
								},
								function (err) {
									active = Math.max(0, active - 1);
									pickedLane.active = Math.max(0, pickedLane.active - 1);
									cleanupLane(pickedKey);
									schedulePump();
									pickedItem.reject(err);
								}
							);

					})(key, lane, item);

					break;

				}

				if (!dispatched) {
					break;
				}

			}

		}

		function enqueue(groupKey, runFn, options) {

			const opts =
				options || {};

			const signal =
				opts.signal || null;

			const isCancelled =
				typeof opts.isCancelled === "function"
					? opts.isCancelled
					: function () {
						return Boolean(signal && signal.aborted);
					};

			if (isCancelled()) {
				return Promise.reject(makeAbortErr("The row was stopped"));
			}

			const key =
				String(groupKey || "default");

			return new Promise(function (resolve, reject) {

				let lane =
					lanes.get(key);

				if (!lane) {
					lane = { items: [], active: 0 };
					lanes.set(key, lane);
					ring.push(key);
				}

				const entry = {
					run: runFn,
					meta: opts.meta || null,
					isCancelled: isCancelled,
					cancelled: false,
					cleanupAbort: null,
					resolve: resolve,
					reject: reject
				};

				lane.items.push(entry);
				queued += 1;

				if (signal && typeof signal.addEventListener === "function") {

					const onAbort = function () {

						if (entry.cancelled) {
							return;
						}

						entry.cancelled =
							true;

						const pos =
							lane.items.indexOf(entry);

						if (pos !== -1) {
							lane.items.splice(pos, 1);
							queued = Math.max(0, queued - 1);
						}

						entry.cleanupAbort = null;
						cleanupLane(key);
						reject(makeAbortErr("The row was stopped"));
						schedulePump();

					};

					signal.addEventListener("abort", onAbort, { once: true });

					entry.cleanupAbort = function () {
						signal.removeEventListener("abort", onAbort);
					};

				}

				schedulePump();

			});

		}

		function cancelMatching(predicate, message) {

			for (const entryPair of Array.from(lanes.entries())) {

				const key =
					entryPair[0];

				const lane =
					entryPair[1];

				const kept =
					[];

				for (let i = 0; i < lane.items.length; i++) {

					const item =
						lane.items[i];

					if (predicate(item.meta, key)) {

						item.cancelled = true;
						queued = Math.max(0, queued - 1);
						if (item.cleanupAbort) {
							item.cleanupAbort();
							item.cleanupAbort = null;
						}
						item.reject(makeAbortErr(message || "The row was stopped"));

					}
					else {

						kept.push(item);

					}

				}

				lane.items =
					kept;

				cleanupLane(key);

			}

			schedulePump();

		}

		return {
			enqueue: enqueue,
			cancelMatching: cancelMatching,
			stats: function () {
				return {
					active: active,
					queued: queued,
					groups: lanes.size,
					concurrency: limit
				};
			}
		};

	}

	const appImageStreamQueue =
		createEventDrivenTaskQueue(BATCH_IMAGE_STREAM_CONCURRENCY);

	const manualImageTaskQueue =
		createEventDrivenTaskQueue(3);

	/*
	 * Background Web Worker Thread Pool for base64 -> ArrayBuffer decoding
	 * (mirrors Node's libuv thread pool offloading CPU-heavy buffer work off
	 * the single main JS thread). Falls back automatically to non-blocking
	 * 64 KB event-loop chunks when Worker is unavailable or CSP-restricted.
	 */
	const decodeWorkerPool = {
		workers: [],
		idle: [],
		pendingJobs: new Map(),
		waitQueue: [],
		nextJobId: 1,
		disabled: false
	};

	const DECODE_WORKER_SOURCE =
		"self.onmessage = function(e) { " +
		"var msg = e.data || {}; var id = msg.id; " +
		"try { " +
		"var cleaned = String(msg.base64 || '').replace(/^data:[^;]+;base64,/i, '').split(' ').join('').split(String.fromCharCode(10)).join('').split(String.fromCharCode(13)).join('').split(String.fromCharCode(9)).join(''); " +
		"var bytes; " +
		"if (typeof Uint8Array !== 'undefined' && typeof Uint8Array.fromBase64 === 'function') { " +
		"bytes = Uint8Array.fromBase64(cleaned); " +
		"} else { " +
		"var bin = atob(cleaned); bytes = new Uint8Array(bin.length); " +
		"for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); " +
		"} " +
		"var buf = bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer; " +
		"self.postMessage({ id: id, ok: true, buffer: buf }, [buf]); " +
		"} catch (err) { " +
		"self.postMessage({ id: id, ok: false, error: String((err && err.message) || err) }); " +
		"} };";

	function pumpDecodeWorkerQueue() {

		while (decodeWorkerPool.waitQueue.length > 0 && decodeWorkerPool.idle.length > 0) {

			const worker =
				decodeWorkerPool.idle.pop();

			const job =
				decodeWorkerPool.waitQueue.shift();

			if (!worker || !job) {
				continue;
			}

			decodeWorkerPool.pendingJobs.set(job.id, {
				job: job,
				worker: worker
			});

			try {
				worker.postMessage({ id: job.id, base64: job.base64 });
			}
			catch (postErr) {
				decodeWorkerPool.pendingJobs.delete(job.id);
				decodeWorkerPool.disabled = true;
				job.fallback();
			}

		}

	}

	function acquireDecodeWorker() {

		if (
			decodeWorkerPool.disabled ||
			typeof Worker !== "function" ||
			typeof Blob !== "function" ||
			typeof URL === "undefined" ||
			typeof URL.createObjectURL !== "function"
		) {
			return false;
		}

		if (decodeWorkerPool.idle.length > 0) {
			return true;
		}

		if (decodeWorkerPool.workers.length >= CLIENT_DECODE_THREAD_POOL_SIZE) {
			return true;
		}

		let scriptUrl =
			"";

		try {

			scriptUrl =
				createStudioObjectUrl(
					new Blob([DECODE_WORKER_SOURCE], { type: "application/javascript" })
				);

			const worker =
				new Worker(scriptUrl);

			if (typeof URL.revokeObjectURL === "function") {
				try { releaseStudioObjectUrl(scriptUrl); } catch (revokeErr) { }
			}

			worker.onmessage = function (ev) {

				const data =
					ev && ev.data ? ev.data : {};

				const record =
					decodeWorkerPool.pendingJobs.get(data.id);

				if (!record) {
					return;
				}

				decodeWorkerPool.pendingJobs.delete(data.id);
				decodeWorkerPool.idle.push(worker);
				pumpDecodeWorkerQueue();

				if (data.ok && data.buffer) {
					record.job.resolve(
						new Blob([data.buffer], { type: record.job.mime || "image/png" })
					);
				}
				else {
					record.job.reject(new Error(data.error || "Image decode failed"));
				}

			};

			worker.onerror = function () {

				decodeWorkerPool.disabled = true;

				for (const pair of Array.from(decodeWorkerPool.pendingJobs.entries())) {
					if (pair[1].worker === worker) {
						decodeWorkerPool.pendingJobs.delete(pair[0]);
						pair[1].job.fallback();
					}
				}

				while (decodeWorkerPool.waitQueue.length > 0) {
					const queuedJob = decodeWorkerPool.waitQueue.shift();
					if (queuedJob) queuedJob.fallback();
				}

			};

			decodeWorkerPool.workers.push(worker);
			decodeWorkerPool.idle.push(worker);
			return true;

		}
		catch (spawnErr) {

			if (scriptUrl && typeof URL.revokeObjectURL === "function") {
				try { releaseStudioObjectUrl(scriptUrl); } catch (revokeErr2) { }
			}

			decodeWorkerPool.disabled = true;
			return false;

		}

	}

	async function decodeBase64ChunkedOnEventLoop(cleaned, mime) {

		if (!cleaned) {
			return new Blob([new Uint8Array(0)], { type: mime || "image/png" });
		}

		if (
			typeof Uint8Array !== "undefined" &&
			typeof Uint8Array.fromBase64 === "function" &&
			cleaned.length <= 65536
		) {
			return new Blob(
				[Uint8Array.fromBase64(cleaned)],
				{ type: mime || "image/png" }
			);
		}

		/*
		 * Slice on a multiple of 4 base64 chars (65536 chars = 48 KB decoded)
		 * and yield back to the event loop between slices so the single JS
		 * main thread never stalls on multi-megabyte images.
		 */
		const sliceChars =
			65536;

		const chunks =
			[];

		for (let offset = 0; offset < cleaned.length; offset += sliceChars) {

			if (offset > 0) {
				await yieldClientEventLoop();
			}

			const part =
				cleaned.slice(offset, offset + sliceChars);

			if (
				typeof Uint8Array !== "undefined" &&
				typeof Uint8Array.fromBase64 === "function"
			) {
				chunks.push(Uint8Array.fromBase64(part));
			}
			else {
				const bin =
					atob(part);
				const arr =
					new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) {
					arr[i] = bin.charCodeAt(i);
				}
				chunks.push(arr);
			}

		}

		return new Blob(chunks, { type: mime || "image/png" });

	}

	function decodeBase64ImageOffThread(base64, mime) {

		const cleaned =
			String(base64 || "")
				.replace(/^data:[^;]+;base64,/i, "")
				.replace(/\\s+/g, "");

		if (
			cleaned.length >= CLIENT_WORKER_DECODE_MIN_CHARS &&
			acquireDecodeWorker()
		) {

			return new Promise(function (resolve, reject) {

				const id =
					decodeWorkerPool.nextJobId++;

				decodeWorkerPool.waitQueue.push({
					id: id,
					base64: cleaned,
					mime: mime || "image/png",
					resolve: resolve,
					reject: reject,
					fallback: function () {
						decodeBase64ChunkedOnEventLoop(cleaned, mime).then(resolve, reject);
					}
				});

				pumpDecodeWorkerQueue();

			});

		}

		return decodeBase64ChunkedOnEventLoop(cleaned, mime);

	}

	if (typeof window !== "undefined") {
		window.__IMAGE_TASK_RUNTIME = {
			streamQueue: appImageStreamQueue,
			manualQueue: manualImageTaskQueue,
			decodeBase64ImageOffThread: decodeBase64ImageOffThread,
			createEventDrivenTaskQueue: createEventDrivenTaskQueue
		};
	}

	/*
	 * The policy above, in one mutable object: batchRunStep reads it, and
	 * tests (or a future admin knob) can shorten the backoff without
	 * touching the retry logic itself.
	 */
	const batchRetryPolicy = {
		attempts: BATCH_STEP_ATTEMPTS,
		baseMs: BATCH_RETRY_BASE_MS,
		maxMs: BATCH_RETRY_MAX_MS
	};

	/*
	 * The two new per-row columns: the rendered size of the Pixabay images and
	 * the frame orientation. The resolution is the LONG edge in pixels; the
	 * short edge follows the orientation (16:9 for landscape / portrait,
	 * 1:1 for square) so 480 / 540 / 720 stay honest names.
	 * The values are sent to BOTH /api/image-prompts (so every scene prompt
	 * is written for that frame) and /api/image-batch (so SDXL really draws
	 * at that size).
	 */
	const BATCH_RESOLUTIONS = [480, 540, 720, 1024];

	const BATCH_DEFAULT_RESOLUTION = 1024;

	const BATCH_ORIENTATIONS = [
		{ value: "square", label: "Square 1:1", ratio: [1, 1] },
		{ value: "landscape", label: "Landscape 16:9", ratio: [16, 9] },
		{ value: "portrait", label: "Portrait 9:16", ratio: [9, 16] }
	];

	const BATCH_DEFAULT_ORIENTATION = "landscape";

	/* The orientation record for a row value (defaults to landscape). */
	function batchOrientation(value) {
		for (const entry of BATCH_ORIENTATIONS) {
			if (entry.value === value) {
				return entry;
			}
		}
		return BATCH_ORIENTATIONS[1];
	}

	/* A row's stored resolution, coerced to one of the four allowed sizes. */
	function batchResolution(value) {
		const size = Math.round(Number(value) || 0);
		return BATCH_RESOLUTIONS.indexOf(size) === -1
			? BATCH_DEFAULT_RESOLUTION
			: size;
	}

	/*
	 * Long edge = resolution, short edge = long edge × ratio, both rounded
	 * to a multiple of 8 (SDXL's requirement). Mirrors imageFrameFor() in
	 * src/modules/image-batch.ts - the client uses it for the preview
	 * canvas, the worker for the real render.
	 */
	function batchRowDimensions(row) {
		const resolution =
			batchResolution(row && row.resolution);
		const orientation =
			batchOrientation(row && row.orientation);
		const round8 = function (value) {
			return Math.max(256, Math.round(value / 8) * 8);
		};
		if (orientation.value === "square") {
			return { width: round8(resolution), height: round8(resolution), resolution: resolution, orientation: "square" };
		}
		const long = round8(resolution);
		const short = round8(resolution * 9 / 16);
		return orientation.value === "portrait"
			? { width: short, height: long, resolution: resolution, orientation: "portrait" }
			: { width: long, height: short, resolution: resolution, orientation: "landscape" };
	}

	const batchRows = [];

	let batchRowSeq =
		0;

	let batchRunBusy =
		false;

	let batchRenderBusy =
		false;

	let batchPreview =
		null;

	let batchTableBound =
		false;

	/* true once the first blank row has been offered. */
	let batchTableSeeded =
		false;

	/*
	 * Session 331 - completed rows survive a refresh, five per page.
	 *
	 * A row whose render or export succeeded is copied into its own
	 * localStorage archive (scripts and settings only: the MP4/slides live in
	 * browser memory and are never persisted). On the next load those rows are
	 * put back on the page as completed rows, the table is paginated five rows
	 * per page, and the browser deletes every archived row 24 hours after it
	 * finished - nothing on the server is involved.
	 */
	const BATCH_PAGE_SIZE =
		5;

	const BATCH_COMPLETED_KEY =
		"ytvs.quick-batch-completed.v1";

	const BATCH_COMPLETED_TTL_MS =
		24 * 60 * 60 * 1000;

	const BATCH_COMPLETED_LIMIT =
		40;

	/* The purge re-runs hourly; the 24 h cut-off is what actually deletes. */
	const BATCH_PURGE_INTERVAL_MS =
		60 * 60 * 1000;

	let batchPage =
		0;

	let batchCompletedTimer =
		null;

	/*
	 * Session #248: queue and in-flight tracking for staggered pipeline execution.
	 * When a row moves to image generation, an unprocessed row from batchQueue
	 * is started without waiting for earlier rows to reach 'done'.
	 */
	let batchQueue =
		[];

	/* Prevent a row's synchronous stage hook from re-entering the initial wave. */
	let batchStartingRows =
		false;

	const batchActivePromises =
		new Set();

	const batchAttemptedRows =
		new Set();

	let batchFinishedCount =
		0;

	const BATCH_STAGE_LABELS = {
		empty: "Waiting for a script",
		writing: "Writing the script (AI)",
		ready: "Ready \u2014 press \u2726 Generate",
		queued: "Queued",
		voice: "Speaking the script (MP3)",
		timing: "Measuring the narration",
		prompts: "Preparing Pixabay search terms",
		images: "Fetching Pixabay images",
		animate: "Animating the slides",
		done: "Finished",
		error: "Stopped"
	};

	function createBatchRow(seed) {

		batchRowSeq += 1;

		return Object.assign(
			{
				id: batchRowSeq,
				script: "",
				style:
					(typeof DEFAULT_SEO_IMAGE_STYLE === "string" && DEFAULT_SEO_IMAGE_STYLE) ||
					"Cinematic Film",
				minutes:
					BATCH_MIN_MINUTES,
				resolution:
					BATCH_DEFAULT_RESOLUTION,
				orientation:
					BATCH_DEFAULT_ORIENTATION,
				stage:
					(seed && seed.script && String(seed.script).trim())
						? "ready"
						: "empty",
				detail:
					"",
				error:
					"",
				mp3:
					null,
				mp3Url:
					"",
				audio:
					null,
				prompts:
					[],
				images:
					[],
				mediaFilenames:
					[],
				_missingMediaScenes:
					[],
				objectUrls:
					[],
				slides:
					[],
				subtitles:
					[],
				animated:
					false,
				running:
					false,
				startedAt:
					0,
				finishedAt:
					0
			},
			seed || {}
		);

	}

	function batchCompletedStore() {
		try { return window.localStorage || null; } catch (error) { return null; }
	}

	/* Reads the archive and drops every entry the browser must delete (24 h). */
	function readCompletedBatchRows() {
		const store = batchCompletedStore();
		const out = [];
		if (!store) return out;
		let parsed = null;
		try { parsed = JSON.parse(store.getItem(BATCH_COMPLETED_KEY) || "null"); } catch (error) { parsed = null; }
		const list = parsed && Array.isArray(parsed.rows) ? parsed.rows : [];
		const cutoff = Date.now() - BATCH_COMPLETED_TTL_MS;
		for (const entry of list) {
			if (!entry) continue;
			const at = Number(entry.completedAt) || 0;
			/* Older than 24 h (or never stamped): the client deletes it. */
			if (!at || at <= cutoff) continue;
			if (!String(entry.script || "").trim()) continue;
			out.push(entry);
		}
		return out;
	}

	function writeCompletedBatchRows(list) {
		const store = batchCompletedStore();
		if (!store) return false;
		try {
			store.setItem(BATCH_COMPLETED_KEY, JSON.stringify({
				version: 1,
				updatedAt: Date.now(),
				rows: (list || []).slice(0, BATCH_COMPLETED_LIMIT)
			}));
			return true;
		} catch (error) {
			return false;
		}
	}

	function completedBatchProjectDetailSummary(detail) {
		if (!detail || typeof detail !== "object") return undefined;
		return {
			id: String(detail.id || ""),
			rowId: String(detail.rowId || ""),
			vid: String(detail.vid || ""),
			style: String(detail.style || ""),
			effects: Array.isArray(detail.effects) ? detail.effects.slice() : [],
			effectLabel: String(detail.effectLabel || ""),
			durationSec: pipelineManagementNumber(detail.durationSec, 0),
			sceneCount: pipelineManagementNumber(detail.sceneCount, 0),
			slideCount: pipelineManagementNumber(detail.slideCount, 0),
			clipCount: pipelineManagementNumber(detail.clipCount, 0),
			textCount: pipelineManagementNumber(detail.textCount, 0),
			graphicCount: pipelineManagementNumber(detail.graphicCount, 0),
			elementCount: pipelineManagementNumber(detail.elementCount, 0),
			audioCount: pipelineManagementNumber(detail.audioCount, 0),
			updatedAt: pipelineManagementNumber(detail.updatedAt, Date.now())
		};
	}

	function completedBatchEntry(row, kind) {
		const slideLen = Array.isArray(row.slides) ? row.slides.length : (Number(row.slides) || Number(row.timelineSceneCount) || 0);
		return {
			id: String(row.id),
			vid: String(row.vid || ""),
			title: String(row.title || "").slice(0, 120),
			topic: String(row.topic || "").slice(0, 160),
			script: String(row.script || ""),
			style: String(row.style || ""),
			minutes: pipelineManagementNumber(row.minutes, 1),
			resolution: String(row.resolution || ""),
			orientation: String(row.orientation || ""),
			quality: String(row.quality || ""),
			kind: kind === "export" ? "export" : "render",
			detail: String(row.detail || "").slice(0, 200),
			slides: slideLen,
			timelineEdited: Boolean(row.timelineEdited || row.timeline),
			timelineUpdatedAt: Number(row.timelineUpdatedAt) || Number(row.timeline && row.timeline.updatedAt) || 0,
			projectDetail: completedBatchProjectDetailSummary(row.projectDetail),
			completedAt: Date.now()
		};
	}

	function syncCompletedBatchRowFromTimeline(row) {
		if (!row) return false;
		const list = readCompletedBatchRows();
		if (!list.length) return false;
		const targetId = String(row.id || "");
		const targetVid = String(row.vid || "");
		let updated = false;
		const next = list.map(function (entry) {
			if (!entry) return entry;
			const matchVid = Boolean(targetVid && entry.vid && String(entry.vid) === targetVid);
			const matchId = Boolean(!entry.vid && targetId && String(entry.id) === targetId);
			if (!matchVid && !matchId) return entry;
			updated = true;
			const slideLen = Array.isArray(row.slides)
				? row.slides.length
				: (Number(row.slides) || Number(row.timelineSceneCount) || Number(row.projectDetail && row.projectDetail.sceneCount) || Number(entry.slides) || 0);
			return Object.assign({}, entry, {
				vid: targetVid || entry.vid || "",
				style: String(row.style || entry.style || ""),
				resolution: String(row.resolution || entry.resolution || ""),
				orientation: String(row.orientation || entry.orientation || ""),
				detail: String(row.detail || entry.detail || "").slice(0, 200),
				slides: slideLen,
				timelineEdited: true,
				timelineUpdatedAt: Number(row.timelineUpdatedAt) || Number(row.timeline && row.timeline.updatedAt) || Date.now(),
				projectDetail: completedBatchProjectDetailSummary(row.projectDetail) || entry.projectDetail
			});
		});
		if (updated) writeCompletedBatchRows(next);
		return updated;
	}

	/* One successful render or export -> one archived row (refreshed in place). */
	function recordCompletedBatchRow(row, kind) {
		if (!row) return null;
		const entry = completedBatchEntry(row, kind);
		const list = readCompletedBatchRows().filter(function (candidate) {
			return String(candidate.id) !== String(entry.id);
		});
		list.unshift(entry);
		writeCompletedBatchRows(list);
		return entry;
	}

	function forgetCompletedBatchRow(id, vid) {
		const targetVid = String(vid || "").trim();
		const targetId = String(id || "").trim();
		const list = readCompletedBatchRows().filter(function (candidate) {
			if (!candidate) return false;
			if (targetVid && candidate.vid) return String(candidate.vid) !== targetVid;
			return String(candidate.id) !== targetId;
		});
		writeCompletedBatchRows(list);
	}

	function completedBatchDetail(entry) {
		const what = entry.kind === "export" ? "Exported" : "Rendered";
		let when = "";
		try { when = new Date(Number(entry.completedAt) || Date.now()).toLocaleString(); } catch (error) { when = ""; }
		return what + (when ? " " + when : "") + " \u00b7 kept 24 h";
	}

	/*
	 * A restored completed row is a record, not a re-renderable row: the media
	 * blobs only ever lived in browser memory, so Preview/Export stay locked
	 * while the row itself (script, style, time, status) stays on the page.
	 */
	function archivedBatchRow(entry) {
		const row = createBatchRow({
			script: entry.script || "",
			title: entry.title || "",
			topic: entry.topic || "",
			style: entry.style || "",
			minutes: pipelineManagementNumber(entry.minutes, 1),
			resolution: entry.resolution || "",
			orientation: entry.orientation || "",
			quality: entry.quality || ""
		});
		row.vid = entry.vid || pipelineManagementStore.pageId + "-row-" + String(row.id);
		if (entry.projectDetail && typeof entry.projectDetail === "object") {
			row.projectDetail = Object.assign({}, entry.projectDetail);
		}
		row.stage = "done";
		row.detail = completedBatchDetail(entry);
		row.running = false;
		row.retrying = false;
		row._archived = true;
		row._archivedSourceId = String(entry.id || "");
		row._completedAt = Number(entry.completedAt) || Date.now();
		row._completedKind = entry.kind === "export" ? "export" : "render";
		return row;
	}

	function markBatchRowCompleted(row, entry) {
		if (!row || !entry) return;
		row.stage = "done";
		row._completedAt = Number(entry.completedAt) || Date.now();
		row._completedKind = entry.kind === "export" ? "export" : "render";
		const hasRestoredOrLiveMedia = Boolean(
			row.timelineEdited ||
			row._storedFinished ||
			(row.mp3 && row.animated)
		);
		if (!hasRestoredOrLiveMedia) {
			row.detail = completedBatchDetail(entry);
			row._archived = true;
		}
	}

	/* Called once per load, AFTER the pipeline store has restored its rows. */
	function restoreCompletedBatchRows() {
		const kept = readCompletedBatchRows();
		writeCompletedBatchRows(kept);
		if (!kept.length) return 0;
		/* A load starts on page 1, exactly like a fresh page view. */
		batchPage = 0;
		let added = 0;
		for (const entry of kept) {
			const id = String(entry.id || "");
			const existing = batchRows.find(function (candidate) {
				return String(candidate.id) === id || String(candidate._archivedSourceId || "") === id;
			});
			if (existing) {
				markBatchRowCompleted(existing, entry);
				continue;
			}
			batchRows.push(archivedBatchRow(entry));
			added += 1;
		}
		try { renderBatchTable(); } catch (renderError) { }
		return added;
	}

	/* The 24 h deletion, run at load and every hour afterwards. */
	function purgeCompletedBatchRows() {
		/* readCompletedBatchRows() has already dropped every 24 h old entry. */
		const list = readCompletedBatchRows();
		const cutoff = Date.now() - BATCH_COMPLETED_TTL_MS;
		const fresh = {};
		list.forEach(function (entry) { fresh[String(entry.id || "")] = true; });
		let changed = false;
		for (let index = batchRows.length - 1; index >= 0; index--) {
			const row = batchRows[index];
			if (!row || !row._archived) continue;
			/*
			 * A restored row lives exactly as long as its archive entry: once the
			 * entry is 24 h old (or was removed) the row goes too.
			 */
			const sourceId = String(row._archivedSourceId || row.id);
			const stillArchived = fresh[sourceId] === true;
			const recent = (Number(row._completedAt) || 0) > cutoff;
			if (stillArchived && recent) continue;
			batchRows.splice(index, 1);
			changed = true;
		}
		/* writeCompletedBatchRows() also drops anything past the cut-off. */
		writeCompletedBatchRows(list);
		if (changed) {
			try { renderBatchTable(); } catch (renderError) { }
			persistPipelineManagementState("completed-rows-purged");
		}
		return changed;
	}

	function scheduleCompletedBatchPurge() {
		if (batchCompletedTimer) return;
		if (!window || typeof window.setInterval !== "function") return;
		batchCompletedTimer = window.setInterval(function () {
			try { purgeCompletedBatchRows(); } catch (purgeError) { }
		}, BATCH_PURGE_INTERVAL_MS);
	}

	function batchPageCount() {
		return Math.max(1, Math.ceil(batchRows.length / BATCH_PAGE_SIZE));
	}

	function visibleBatchRows() {
		const pages = batchPageCount();
		if (batchPage > pages - 1) batchPage = pages - 1;
		if (batchPage < 0) batchPage = 0;
		const start = batchPage * BATCH_PAGE_SIZE;
		return batchRows.slice(start, start + BATCH_PAGE_SIZE);
	}

	function setBatchPage(page) {
		const next = Math.min(batchPageCount() - 1, Math.max(0, Math.round(Number(page) || 0)));
		if (next === batchPage) { updateBatchPager(); return; }
		batchPage = next;
		renderBatchTable();
	}

	function bindBatchPager() {
		const prev = document.getElementById("batch-page-prev");
		const next = document.getElementById("batch-page-next");
		if (prev && !prev._batchBound) {
			prev._batchBound = true;
			prev.addEventListener("click", function () { setBatchPage(batchPage - 1); });
		}
		if (next && !next._batchBound) {
			next._batchBound = true;
			next.addEventListener("click", function () { setBatchPage(batchPage + 1); });
		}
		updateBatchPager();
	}

	function updateBatchPager() {
		const pager = document.getElementById("batch-pager");
		if (!pager) return;
		const pages = batchPageCount();
		pager.hidden = pages <= 1;
		/* The element carries an inline display:flex, so hide it explicitly. */
		try { pager.style.display = pages <= 1 ? "none" : "flex"; } catch (styleError) { }
		const label = document.getElementById("batch-page-label");
		if (label) label.textContent = "Page " + (batchPage + 1) + " of " + pages;
		const prev = document.getElementById("batch-page-prev");
		const next = document.getElementById("batch-page-next");
		if (prev) prev.disabled = batchPage <= 0;
		if (next) next.disabled = batchPage >= pages - 1;
	}

	function getBatchRow(id) {

		for (const row of batchRows) {

			if (String(row.id) === String(id)) {
				return row;
			}

		}

		return null;

	}

	function batchRowHasScript(row) {

		return !!(
			row &&
			String(row.script || "").trim()
		);

	}

	function batchRowHasMinWords(row, min = WORD_COUNT_MIN) {
		return batchRowWordCount(row) >= min;
	}

	/* mp3 + Pixabay images + animation - or a timeline-edited row with completed media. */
	function batchRowFinished(row) {

		if (!row) return false;
		const slides = Array.isArray(row.slides) ? row.slides : [];
		if (row.timelineEdited && slides.length > 0 && batchRowHasCompletedImages(row)) {
			if (row.mp3 && row.animated) return true;
			if (!row._archived && row._storedFinished && row._storedMp3 && row._storedAnimated) return true;
		}
		if (!row.mp3 || !row.animated) return false;
		const images = Array.isArray(row.images) ? row.images : [];
		if (images.length !== AUTO_MEDIA_TOTAL || slides.length !== AUTO_MEDIA_TOTAL) return false;
		const clips = images.filter(function (media) { return media && media.blob && media.blob.type === "video/mp4"; });
		const filenames = new Set(images.map(function (media) { return media && (media.stockFilename || (media.blob && media.blob.stockFilename)); }));
		return clips.length === AUTO_VIDEO_SCENES && filenames.size === AUTO_MEDIA_TOTAL;

	}

	function addBatchRow(seed) {

		if (
			batchRows.length >=
			BATCH_ROW_LIMIT
		) {

			showRequiredModal([
				"The quick batch table holds " +
				BATCH_ROW_LIMIT +
				" rows - finish or remove one first."
			]);

			return null;

		}

		const row =
			createBatchRow(seed);

		batchRows.push(row);

		/* The new row's page opens, so the row that was just added is visible. */
		batchPage =
			Math.floor((batchRows.length - 1) / BATCH_PAGE_SIZE);

		renderBatchTable();

		return row;

	}

	function revokeBatchRow(row) {

		if (!row) {
			return;
		}

		for (const url of row.objectUrls || []) {

			try {
				releaseStudioObjectUrl(url);
			}
			catch (revokeError) { }

		}

		row.objectUrls = [];
		for (const slide of row.slides || []) {
			if (slide.videoEl) { try { slide.videoEl.pause(); slide.videoEl.removeAttribute("src"); slide.videoEl.load(); } catch (_) {} }
			if (slide.img && typeof slide.img.close === "function") { try { slide.img.close(); } catch (closeError) {} }
		}

	}

	function removeBatchRow(id) {

		let index =
			-1;

		for (let i = 0; i < batchRows.length; i++) {

			if (String(batchRows[i].id) === String(id)) {
				index = i;
				break;
			}

		}

		if (index < 0) {
			return;
		}

		const removedRow = batchRows[index];

		cancelScriptWriteRetryWait(
			removedRow
		);

		revokeBatchRow(
			removedRow
		);

		batchRows.splice(index, 1);

		batchQueue =
			batchQueue.filter(function (r) {
				return String(r.id) !== String(id);
			});

		batchAttemptedRows.delete(String(id));

		/* A row the user removes is gone for good: drop its 24 h archive copy and timeline/cookie storage. */
		try { purgeRowLocalAndCookieEntries(removedRow); } catch (purgeError) { }
		try { forgetCompletedBatchRow(id); } catch (forgetError) { }

		if (!batchRows.length) {
			closeBatchPreview();
		}

		if (batchPage > batchPageCount() - 1) batchPage = batchPageCount() - 1;
		if (batchPage < 0) batchPage = 0;

		renderBatchTable();

	}

	function batchStyleOptionsHTML(selected) {

		const styles =
			(typeof SEO_IMAGE_STYLES === "object" && Array.isArray(SEO_IMAGE_STYLES) && SEO_IMAGE_STYLES.length)
				? SEO_IMAGE_STYLES
				: ["Cinematic Film"];

		return styles
			.map(function (style) {

				const value =
					typeof style === "string"
						? style
						: (style && style.name) || "";

				if (!value) {
					return "";
				}

				return (
					'<option value="' +
					value +
					'"' +
					(value === selected ? " selected" : "") +
					">" +
					escapeHTML(value) +
					"</option>"
				);

			})
			.join("");

	}

	/* The resolution column's options, one per allowed long edge. */
	function batchResolutionOptionsHTML(selected) {

		const current =
			batchResolution(selected);

		return BATCH_RESOLUTIONS
			.map(function (size) {
				return (
					'<option value="' + size + '"' +
					(size === current ? " selected" : "") +
					">" + size + "px</option>"
				);
			})
			.join("");

	}

	/* The orientation column's options. */
	function batchOrientationOptionsHTML(selected) {

		const current =
			batchOrientation(selected).value;

		return BATCH_ORIENTATIONS
			.map(function (entry) {
				return (
					'<option value="' + entry.value + '"' +
					(entry.value === current ? " selected" : "") +
					">" + escapeHTML(entry.label) + "</option>"
				);
			})
			.join("");

	}

	function batchStatusText(row) {

		if (row.stage === "error") {

			return "\u26a0 " + (row.error || row.detail || "Generation failed");

		}

		const label =
			BATCH_STAGE_LABELS[row.stage] ||
			row.stage;

		/*
		 * Session 331 follow-up: a row that was edited in the timeline says so,
		 * with the edited length, so the table shows the change it will preview
		 * and export.
		 */
		const timelineNote =
			row.timelineEdited
				? " \u00b7 timeline edit" +
					(Number(row.timelineDurationSec) > 0
						? " " + Math.round(Number(row.timelineDurationSec)) + "s"
						: "")
				: "";

		return (row.detail
			? label + " \u00b7 " + row.detail
			: label) + timelineNote;

	}

	/*
	 * FINAL RULE - QUICK BATCH TABLE LAYOUT: these working stages paint the
	 * editor's script-section animation (.va-spinner + va-loading-pulse).
	 * The animation stays for the whole stage, from the first attempt through
	 * the seventh silent retry, so a retry changes nothing on screen.
	 */
	const BATCH_ACTIVE_STAGES = [
		"writing",
		"voice",
		"timing",
		"prompts",
		"images",
		"animate"
	];

	function batchRowBusy(row) {

		return !!(
			row &&
			BATCH_ACTIVE_STAGES.indexOf(row.stage) !== -1
		);

	}

	/* The status cell's markup: spinner + label while the row works. */
	function batchStatusHTML(row) {

		const text =
			escapeHTML(batchStatusText(row));

		if (!batchRowBusy(row)) {

			return text;

		}

		return (
			'<span class="va-spinner" aria-hidden="true"></span>' +
			'<span class="batch-status-text">' + text + "</span>"
		);

	}

	/* Paint one row's status cell from its own state. */
	function paintBatchRowStatus(row) {

		const status =
			document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="status"]');

		if (!status) {

			return;

		}

		status.innerHTML =
			batchStatusHTML(row);

		status.setAttribute(
			"data-stage",
			row.stage
		);

		status.setAttribute(
			"data-loading",
			batchRowBusy(row) ? "1" : "0"
		);

	}

	/* An Error with a machine name, never with browser abort wording. */
	function batchError(message, name) {

		const error =
			new Error(message);

		error.name =
			name || "BatchStepError";

		return error;

	}

	function batchDelay(ms) {

		return new Promise(function (resolve) {

			setTimeout(resolve, ms);

		});

	}

	/*
	 * Aborts are plumbing, not content. The browser words them as
	 * "signal is aborted without reason" / "The user aborted a request",
	 * and that text must never reach a row's status line.
	 */
	function batchIsAbortError(error) {

		if (!error) {

			return false;

		}

		const name =
			String(error.name || "");

		if (
			name === "AbortError" ||
			name === "TimeoutError"
		) {

			return true;

		}

		return /abort|signal/i.test(
			String(error.message || error)
		);

	}

	/*
	 * A STOP is not a failure and is never retried (the user asked for it).
	 * A timeout is a failure and IS retried - which is why this is a
	 * narrower test than batchIsAbortError().
	 */
	function batchIsStopError(error) {

		if (!error) {

			return false;

		}

		const name =
			String(error.name || "");

		if (name === "AbortError") {

			return true;

		}

		if (name === "TimeoutError") {

			return false;

		}

		return /abort/i.test(
			String(error.message || error)
		);

	}

	/* One short line for the console - the table itself stays quiet. */
	function batchErrorBrief(error) {

		if (!error) {

			return "unknown";

		}

		const name =
			String(error.name || "Error");

		const message =
			String(error.message || error)
				.replace(/\\s+/g, " ")
				.trim();

		return message && message !== name
			? name + ": " + message
			: name;

	}

	/* Throw away every object URL a failed attempt allocated. */
	function revokeBatchUrlsSince(row, keepCount) {

		if (!row || !Array.isArray(row.objectUrls)) {

			return;

		}

		const keep =
			Math.max(0, Number(keepCount) || 0);

		const dropped =
			row.objectUrls.splice(keep);

		for (const url of dropped) {

			try {

				releaseStudioObjectUrl(url);

			}
			catch (revokeError) { }

		}

		if (
			row.mp3Url &&
			row.objectUrls.indexOf(row.mp3Url) === -1
		) {

			row.mp3 = null;
			row.mp3Url = "";

		}

		if (Array.isArray(row.images)) {

			row.images =
				row.images.filter(function (image) {

					return row.objectUrls.indexOf(image.url) !== -1;

				});

		}

	}

	/* One positive number out of the retry policy (or its constant). */
	function batchRetrySetting(name, fallback) {

		const value =
			Number(batchRetryPolicy[name]);

		return (
			typeof value === "number" &&
			isFinite(value) &&
			value > 0
		)
			? value
			: fallback;

	}

	/*
	 * FINAL RULE - QUICK BATCH TABLE LAYOUT: non-media failed stages use one
	 * shared, silent client retry ladder. Image/video failures are retried
	 * individually by the media pipeline, never as a whole stage.
	 */
	async function batchRunStep(
		row,
		stage,
		detail,
		step
	) {

		return batchRunPipelineStage(row, stage, detail, async function (retry) {
			if (retry === 0 && stage === "images") startUnprocessedRows(row);
			const urlsBefore = (row.objectUrls || []).length;
			try {
				return await step(retry + 1);
			} catch (error) {
				revokeBatchUrlsSince(row, urlsBefore);
				throw error;
			}
		}, {
			snapshot: function () { return (row.objectUrls || []).length; },
			reset: function (keepCount) { revokeBatchUrlsSince(row, keepCount); }
		});

	}

	function batchTimelineState(row) {
		const images = Array.isArray(row && row.images) ? row.images : [];
		const slides = Array.isArray(row && row.slides) ? row.slides : [];
		const prompts = Array.isArray(row && row.prompts) ? row.prompts : [];
		/*
		 * The row's video style is the project's visual treatment. It travels in
		 * the project detail AND on the timeline state, and its template-modal
		 * effect names are stamped onto EVERY scene, so the treatment is not a
		 * first-scene or preview-only accident: cinematic rows carry the double
		 * gradient on each video and image scene, neon rows carry the neon glow
		 * plus the VHS bars on each scene.
		 */
		const videoStyle = row.style || "Cinematic Film";
		const styleEffects = window.__videoStyleEffects(videoStyle);
		const subtitles = (Array.isArray(row && row.subtitles) ? row.subtitles : [])
			.map(function (cue) {
				if (!cue) return null;
				return {
					startMs: Math.max(0, Number(cue.startMs) || 0),
					endMs: Math.max(0, Number(cue.endMs) || 0),
					text: String(cue.text || "")
				};
			})
			.filter(function (cue) { return Boolean(cue && cue.text && cue.endMs > cue.startMs); })
			.slice(0, 400);

		const regenAt = Number(row && row._timelineRegeneratedAt) || 0;
		const rawSavedTimeline = readTimelineEditorStateForRow(row);
		const savedTimeline = rawSavedTimeline && (!regenAt || Number(rawSavedTimeline.updatedAt || 0) > regenAt)
			? rawSavedTimeline
			: null;
		if (savedTimeline && Array.isArray(savedTimeline.tracks) && savedTimeline.tracks.length &&
			Array.isArray(savedTimeline.scenes) && savedTimeline.scenes.length) {
			const cloned = JSON.parse(JSON.stringify(savedTimeline));
			cloned.videoStyle = videoStyle;
			cloned.videoStyleEffects = styleEffects.slice();
			cloned.scenes = cloned.scenes.map(function (scene) {
				const isTplScene = Boolean(scene && (scene.isTemplateScene || scene.templateScene || String(scene.mediaSource || "") === "template composer"));
				if (isTplScene) {
					return Object.assign({}, scene, {
						videoStyle: String(scene.videoStyle || videoStyle),
						effects: Array.isArray(scene.effects) ? scene.effects.slice() : styleEffects.slice()
					});
				}
				return Object.assign({}, scene, {
					videoStyle: videoStyle,
					effects: styleEffects.slice()
				});
			});
			if ((!Array.isArray(cloned.subtitles) || !cloned.subtitles.length) && subtitles.length) {
				cloned.subtitles = subtitles;
			}
			return cloned;
		}

		const requestedMinutes = Number(row && row.minutes) > 0 ? Number(row.minutes) : 1;
		const slideSpan = slides.reduce(function (sum, slide) {
			return sum + slideDurationSec(slide);
		}, 0);
		const voiceSpan = Number(row && row.audio && row.audio.duration) || 0;
		let durationSec = voiceSpan || slideSpan || requestedMinutes * 60;
		durationSec = Math.max(1, Math.min(3600, Number(durationSec) || 60));
		const defaultSceneSpan = durationSec / AUTO_MEDIA_TOTAL;
		const scenes = [];
		const mediaItems = [];
		const visualItems = [];
		let cursor = 0;

		const edit = row && row.timeline && typeof row.timeline === "object" ? row.timeline : null;
		if (edit && Array.isArray(edit.sceneItems) && edit.sceneItems.length) {
			edit.sceneItems.forEach(function (item, index) {
				const dur = Math.max(0.25, pipelineManagementNumber(item && item.d, defaultSceneSpan));
				const startSec = item && item.s != null ? Math.max(0, pipelineManagementNumber(item.s, cursor)) : cursor;
				const endSec = startSec + dur;
				const sceneId = String(item && item.id || ("scene-" + (index + 1)));
				const assetId = String(item && item.a || (Number(item && item.i) >= 0 ? "scene-" + (Number(item.i) + 1) : ""));
				const mediaType = Number(item && item.t) === 1 ? "video" : Number(item && item.t) === 2 ? "gif" : "image";
				const mediaIdx = item && item.i != null ? Number(item.i) : index;
				const media = mediaIdx >= 0
					? images.find(function (candidate) { return Number(candidate && candidate.index) === mediaIdx; }) || null
					: null;
				const sceneName = String(item && item.n || ("Scene " + (index + 1)));
				const mediaName = String(item && item.m || (media && (media.stockFilename || media.blob && media.blob.stockFilename)) || "");
				const mediaSource = String(item && item.src || (media && media.stockSource && media.stockSource.provider ? media.stockSource.provider : (media ? "Pixabay" : "pending")));
				const isTplScene = Boolean(item && (item.tpl || item.isTemplateScene || mediaSource === "template composer"));
				const itemVideoStyle = isTplScene && item && (item.st || item.videoStyle)
					? String(item.st || item.videoStyle)
					: videoStyle;
				const itemStyleCode = item && (item.sc || item.style)
					? String(item.sc || item.style)
					: itemVideoStyle;
				const itemEffects = isTplScene && item && Array.isArray(item.ef || item.effects)
					? (item.ef || item.effects).slice()
					: styleEffects.slice();
				const itemTransition = item && (item.trn || item.transition) && typeof (item.trn || item.transition) === "object"
					? Object.assign({}, item.trn || item.transition)
					: { type: "none", speed: 1, effect: "none", motionSpeed: 1 };
				const scene = {
					id: sceneId,
					index: index,
					name: sceneName,
					startSec: startSec,
					durationSec: dur,
					mediaType: mediaType,
					mediaAssetId: assetId,
					mediaName: mediaName,
					mediaSource: mediaSource,
					prompt: mediaIdx >= 0 ? String(prompts[mediaIdx] || "") : "",
					isTemplateScene: isTplScene,
					style: itemStyleCode,
					effects: itemEffects,
					videoStyle: itemVideoStyle,
					transition: itemTransition,
					elements: []
				};
				mediaItems.push({
					id: String(item && item.slideId || ("media-" + (index + 1))),
					kind: "media",
					sceneId: sceneId,
					assetId: assetId,
					label: mediaName || (sceneName + " · " + (assetId ? mediaType : "media pending")),
					mediaType: mediaType,
					mediaSource: mediaSource,
					startSec: startSec,
					durationSec: dur,
					trimStartSec: Math.max(0, pipelineManagementNumber(item && item.tr, 0)),
					fit: Number(item && item.f) === 1 ? "contain" : "cover",
					visible: Number(item && item.v) !== 0,
					isTemplateScene: isTplScene,
					style: itemStyleCode,
					videoStyle: itemVideoStyle,
					effects: itemEffects.slice(),
					transition: Object.assign({}, itemTransition)
				});
				scenes.push(scene);
				cursor = Math.max(cursor, endSec);
			});
			if (Array.isArray(edit.visuals)) {
				edit.visuals.forEach(function (vis) {
					if (!vis) return;
					const el = {
						id: String(vis.id || ("vis-" + (visualItems.length + 1))),
						kind: vis.k === "g" ? "graphic" : "text",
						type: vis.k === "g" ? "graphic" : "text",
						name: vis.k === "g" ? String(vis.gr || "Circle") : "Text",
						label: vis.k === "g" ? String(vis.gr || "Circle") : String(vis.tx || "Text"),
						text: vis.k === "g" ? "" : String(vis.tx || ""),
						graphic: vis.k === "g" ? String(vis.gr || "circle") : undefined,
						sceneId: String(vis.scId || ""),
						parentId: String(vis.pId || ""),
						startSec: Math.max(0, pipelineManagementNumber(vis.s, 0)),
						durationSec: Math.max(0.25, pipelineManagementNumber(vis.d, 3)),
						x: pipelineManagementNumber(vis.x, 50),
						y: pipelineManagementNumber(vis.y, vis.k === "g" ? 50 : 78),
						fontSize: vis.k === "g" ? undefined : pipelineManagementNumber(vis.sz, 28),
						size: vis.k === "g" ? pipelineManagementNumber(vis.sz, 72) : undefined,
						color: String(vis.c || "#ffffff"),
						font: String(vis.fn || "sans"),
						align: String(vis.al || "center"),
						visible: Number(vis.v) !== 0,
						dummy: Boolean(vis.dm)
					};
					visualItems.push(el);
					const targetScene = scenes.find(function (s) { return s.id === el.sceneId; });
					if (targetScene) targetScene.elements.push(Object.assign({}, el));
				});
			}
		} else {
			for (let index = 0; index < AUTO_MEDIA_TOTAL; index++) {
				const slide = slides[index] || null;
				const media = images.find(function (candidate) { return Number(candidate && candidate.index) === index; }) || null;
				const sceneSpan = slide ? slideDurationSec(slide) : defaultSceneSpan;
				const startSec = cursor;
				const endSec = startSec + Math.max(0.25, sceneSpan);
				const sceneId = "scene-" + (index + 1);
				const blobType = String(media && media.blob && media.blob.type || "");
				const mediaType = blobType === "video/mp4" || (slide && slide.type === "mp4")
					? "video"
					: blobType === "image/gif" ? "gif" : "image";
				const assetId = media ? "scene-" + (index + 1) : "";
				const scene = {
					id: sceneId,
					index: index,
					name: "Scene " + (index + 1),
					startSec: startSec,
					durationSec: Math.max(0.25, sceneSpan),
					mediaType: mediaType,
					mediaAssetId: assetId,
					mediaName: String(media && (media.stockFilename || media.blob && media.blob.stockFilename) || ""),
					mediaSource: media && media.stockSource && media.stockSource.provider ? String(media.stockSource.provider) : (media ? "Pixabay" : "pending"),
					prompt: String(prompts[index] || ""),
					/* Every scene carries the row style's template-modal effects. */
					effects: styleEffects.slice(),
					videoStyle: videoStyle,
					elements: []
				};
				mediaItems.push({
					id: "media-" + (index + 1),
					kind: "media",
					sceneId: sceneId,
					assetId: assetId,
					label: scene.mediaName || (scene.name + " · " + (media ? mediaType : "media pending")),
					mediaType: mediaType,
					mediaSource: scene.mediaSource,
					startSec: startSec,
					durationSec: Math.max(0.25, sceneSpan),
					trimStartSec: 0,
					fit: "cover",
					visible: true
				});

				scenes.push(scene);
				cursor = endSec;
			}
		}

		/*
		 * Dummy text on 0:00. Every video opened on the timeline page that has no
		 * text or graphic of its own gets exactly this one text clip, so the text
		 * lane is populated and immediately editable instead of empty. If the row
		 * ever carries its own text/graphic elements, the dummy is skipped.
		 */
		if (!visualItems.some(function (item) { return item.kind === "text" || item.kind === "graphic"; })) {
			const firstScene = scenes[0] || null;
			const dummyText = {
				id: "dummy-text-1",
				kind: "text",
				type: "text",
				name: "Text",
				label: "Text",
				text: "Your text here",
				sceneId: firstScene ? firstScene.id : "",
				startSec: 0,
				durationSec: Math.min(6, Math.max(0.25, Number(firstScene && firstScene.durationSec) || 6)),
				x: 50,
				y: 78,
				fontSize: 28,
				color: "#ffffff",
				font: "sans",
				align: "center",
				visible: true,
				dummy: true
			};
			if (firstScene) firstScene.elements.push(Object.assign({}, dummyText));
			visualItems.push(dummyText);
		}

		durationSec = cursor > 0 ? cursor : Math.max(durationSec, cursor);
		return {
			version: 3,
			frame: batchRowDimensions(row),
			videoStyle: videoStyle,
			videoStyleEffects: styleEffects.slice(),
			subtitles: subtitles,
			durationSec: Math.min(3600, durationSec),
			playheadSec: 0,
			soundExpanded: false,
			visualsExpanded: true,
			scenes: scenes,
			tracks: [
				{
					id: "voiceover", kind: "audio", label: "Voiceover", expanded: true,
					items: row && row.mp3 ? [{ id: "audio-voiceover", kind: "audio", assetId: "voiceover", label: "Generated voiceover", startSec: 0, durationSec: durationSec, volume: 1, muted: false }] : []
				},
				{ id: "sound-fx", kind: "audio", label: "Sound effects", expanded: true, items: [] },
				{ id: "background-music", kind: "audio", label: "Background music", expanded: true, items: [] },
				{ id: "background-media", kind: "media", label: "Scene Media", expanded: true, items: mediaItems },
				{ id: "visual-1", kind: "visual", label: "Text & graphics 1", expanded: true, items: visualItems }
			],
			selectedTrackId: "background-media",
			selectedItemId: mediaItems.length ? mediaItems[0].id : ""
		};
	}

	/*
	 * The project detail of the Edit handoff: composed directly from the row's
	 * current timeline scenes, elements, video style, and template-modal effects.
	 */
	function batchProjectDetail(row, timelineState) {
		return composeBatchProjectDetail(row, timelineState);
	}

	function batchProjectJson(row) {
		if (!row) return null;
		const script = String(row.script || "");
		const firstLine = script.split(/\\r?\\n/).find(function (line) { return line.trim(); }) || "";
		const timelineState = batchTimelineState(row);
		const detail = batchProjectDetail(row, timelineState);
		row.projectDetail = detail;
		return {
			version: 1,
			transitionOnly: true,
			source: "quick-batch-table-edit",
			createdAt: Date.now(),
			basicSettings: {
				id: row.id,
				title: String(row.title || firstLine || "").slice(0, 70),
				topic: String(row.topic || firstLine || "my video").slice(0, 160),
				script: script,
				style: timelineState.videoStyle,
				minutes: Number(row.minutes) > 0 ? Number(row.minutes) : 1,
				resolution: row.resolution || "",
				orientation: row.orientation || "",
				quality: row.quality || "balanced"
			},
			projectDetail: detail,
			timelineState: timelineState
		};
	}

	/*
	 * Session 331 (regenerate fix): the IndexedDB key a row's voiceover and
	 * media are kept under. The timeline hand-off and the restore both use it.
	 */
	function batchRowMediaPageId(row) {
		const id = row && row.id != null ? String(row.id) : "";
		if (!id) return "";
		return ("timeline-" + String(pipelineManagementStore.pageId || "local") + "-row-" + id).replace(/[^a-zA-Z0-9_-]/g, "");
	}

	/*
	 * Session 331 (regenerate fix): one transfer for a row's voiceover and its
	 * Pixabay media into browser IndexedDB. It runs when a row finishes (so a
	 * reload can put the bytes back) and when the row is opened in the timeline.
	 */
	function persistBatchRowMedia(row) {
		const targetPageId = batchRowMediaPageId(row);
		if (!row || !targetPageId) return null;
		try {
			/*
			 * Session 331 follow-up: the timeline keeps ONE background layer keyed by
			 * scene id. Two row images that report the same index would otherwise
			 * collapse onto the same background key and one of them would be lost, so
			 * the second and later duplicates move to the next free scene slot.
			 */
			const usedBackgroundKeys = new Set();
			row._mediaPersistedAt = Date.now();
			const assetTransfer = {
				voiceover: row.mp3 || null,
				assets: (Array.isArray(row.images) ? row.images : []).map(function (media) {
					const explicitId = media && media.assetId ? String(media.assetId) : "";
					let keyId = explicitId;
					if (!keyId || keyId.indexOf("scene-") === 0) {
						const sceneIndex = Number(media && media.index);
						let slot = Number.isInteger(sceneIndex) && sceneIndex >= 0 ? sceneIndex + 1 : 1;
						while (usedBackgroundKeys.has(slot)) slot += 1;
						usedBackgroundKeys.add(slot);
						keyId = "scene-" + slot;
					}
					return {
						id: keyId,
						blob: media && media.blob || null,
						name: String(media && (media.stockFilename || media.blob && media.blob.stockFilename) || ""),
						type: String(media && media.blob && media.blob.type || ""),
						source: media && media.stockSource || null
					};
				}).filter(function (asset) { return Boolean(asset.blob); })
			};
			if (window.__TIMELINE_EDITOR__ && typeof window.__TIMELINE_EDITOR__.storeProjectAssets === "function") {
				const savingAssets = window.__TIMELINE_EDITOR__.storeProjectAssets(targetPageId, assetTransfer);
				if (savingAssets && typeof savingAssets.then === "function") {
					return savingAssets.then(function (result) { window.__TIMELINE_ASSET_SAVE__ = result; return result; })
						.catch(function (error) { window.__TIMELINE_ASSET_SAVE__ = { ok: false, reason: String(error && error.message || error) }; });
				}
			}
		} catch (assetError) { window.__TIMELINE_ASSET_SAVE__ = { ok: false, reason: String(assetError && assetError.message || assetError) }; }
		return null;
	}

	function openBatchEditPage(row) {
		if (!row || !batchRowHasScript(row)) {
			if (row) try { purgeRowLocalAndCookieEntries(row); } catch (purgeError) { }
			return null;
		}
		try { reconcileTimelineEdits(); } catch (reconcileErr) { }
		const payload = batchProjectJson(row);
		if (!payload) return null;
		const key = "edit-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
		/* Keep the timeline project id stable for this Quick Batch row so its local timing survives reopen/reload. */
		const targetPageId = batchRowMediaPageId(row);
		payload.sourcePageId = pipelineManagementStore.pageId;
		payload.targetPageId = targetPageId;
		payload.basicSettings.vid = row.vid || pipelineManagementStore.pageId + "-row-" + String(row.id);
		/* The project detail carries the same identity, so the timeline can show it. */
		if (payload.projectDetail) {
			payload.projectDetail.vid = payload.basicSettings.vid;
			payload.projectDetail.sourcePageId = payload.sourcePageId;
			payload.projectDetail.targetPageId = targetPageId;
		}
		/* Large media blobs travel browser-to-browser through IndexedDB, never through localStorage or a URL. */
		/* Session 331 (regenerate fix): the transfer is the same one a finished row uses to keep its media. */
		persistBatchRowMedia(row);
		try {
			window.localStorage.setItem(MEDIA_TRANSITION_STORAGE_PREFIX + key, JSON.stringify(payload));
			window.document.cookie = "ytvs_transition_project_" + key.replace(/[^a-zA-Z0-9_-]/g, "_") +
				"=" + encodeURIComponent(JSON.stringify({
					v: 1, key: key, createdAt: payload.createdAt,
					sourcePageId: payload.sourcePageId, targetPageId: payload.targetPageId,
					vid: payload.basicSettings.vid,
					/* The mirror names the style too, so a handoff can be audited from the cookie alone. */
					style: payload.projectDetail && payload.projectDetail.style || payload.basicSettings.style,
					effects: payload.projectDetail && payload.projectDetail.effects || []
				})) + "; Path=/; SameSite=Lax" +
				(window.location && window.location.protocol === "https:" ? "; Secure" : "");
		} catch (storageError) { }
		window.__BATCH_EDIT_PROJECT__ = payload;
		window.__BATCH_EDIT_URL__ = "";
		persistPipelineManagementState("quick-batch-edit-handoff");
		/*
		 * Session 331: the URL is short and carries only the timeline layout,
		 * target page id and handoff key. Timing metadata lives in localStorage;
		 * large media blobs use browser IndexedDB, never a query string.
		 */
		let href = "";
		try {
			const url = new URL(window.location.href);
			url.searchParams.delete("projectJson");
			url.searchParams.set("layout", "timeline");
			url.searchParams.set("pipelinePage", targetPageId);
			url.searchParams.set("projectEdit", key);
			href = url.pathname + url.search + url.hash;
		} catch (urlError) {
			href = window.location.pathname + "?layout=timeline&pipelinePage=" + encodeURIComponent(targetPageId) +
				"&projectEdit=" + encodeURIComponent(key);
		}
		window.__BATCH_EDIT_URL__ = href;
		try {
			if (typeof window.open === "function") window.open(href, "_blank", "noopener");
		} catch (openError) { }
		return payload;
	}

	/*
	 * The Actions cell (Session 332)
	 * ------------------------------
	 * All THREE icons are rendered for EVERY row, ready or not: ▶ Preview,
	 * ⚙ Process export and ✎ Edit. A row that is not finished yet keeps them
	 * disabled — \`disabled\` + \`aria-disabled="true"\`, so the browser never
	 * fires their click and the delegated [data-batch-action] handler is
	 * never reached — and the cell carries NO text at all: the old
	 * "Preview Here · Export Video" placeholder sentence is gone, which is
	 * why .batch-pending no longer exists in APP_CSS either.
	 *
	 * batchRowFinished() stays the single flag behind all three, so they
	 * still unlock together, at the same moment, exactly as before.
	 */
	function batchActionCell(row, kind) {
		const id = escapeHTML(row.id);
		const ready = batchRowFinished(row);
		const locked = ready ? "" : ' disabled aria-disabled="true"';
		const classes = "upload-btn small batch-action-btn" + (ready ? " batch-live" : "");
		const suffix = " unlocks when this row is generated";
		if (kind === "edit") {
			return '<button type="button" class="' + classes + '" data-batch-action="edit" data-batch-row="' +
				id + '"' + locked + ' title="' + (ready ? "Edit timing in the new timeline editor" : "Edit" + suffix) + '" aria-label="Open timeline editor">✎</button>';
		}
		if (kind === "preview") {
			return '<button type="button" class="' + classes + '" data-batch-action="preview" data-batch-row="' +
				id + '"' + locked + ' title="' + (ready ? "Preview" : "Preview" + suffix) + '" aria-label="Preview">▶</button>';
		}
		return '<button type="button" class="' + classes + '" data-batch-action="export" data-batch-row="' +
			id + '"' + locked + ' title="' + (ready ? "Process export" : "Process export" + suffix) + '" aria-label="Process export">⚙</button>';
	}

	function batchActionsHTML(row) {
		return '<div class="batch-action-icons">' +
			batchActionCell(row, "preview") +
			batchActionCell(row, "export") +
			batchActionCell(row, "edit") +
			'</div>';
	}

	function batchRowHTML(row, index) {

		/*
		 * The Min column is gone from the table (Session 331 follow-up): a row's
		 * length now comes from the finished narration, not from a typed minute
		 * count. The row.minutes value survives as a silent fallback so older saved rows and
		 * the voiceover/length guards keep working; it is never rendered.
		 */

		const script =
			String(row.script || "").replace(/</g, "&lt;");

		/* The exact pixels this row's images will be rendered at. */
		const frame =
			batchRowDimensions(row);

		return (
			'<tr data-batch-row="' + row.id + '">' +
				'<td class="batch-cell batch-cell-script">' +
					'<div class="batch-row-head">' +
						'<span class="batch-row-no">' + String(index).padStart(2, "0") + "</span>" +
						'<button type="button" class="batch-row-del" data-batch-action="remove" data-batch-row="' + row.id + '" title="Remove this row">\u2715</button>' +
					"</div>" +
					'<textarea class="batch-script-input" data-batch-field="script" rows="5" spellcheck="false" aria-label="Script for row ' + index + '" placeholder="Paste or type the narration script for this row\u2026">' + script + "</textarea>" +
					'<div class="batch-row-status" data-batch-slot="status" data-stage="' + escapeHTML(row.stage) + '" data-loading="' + (batchRowBusy(row) ? "1" : "0") + '">' + batchStatusHTML(row) + "</div>" +
				"</td>" +
				'<td class="batch-cell batch-cell-style">' +
					'<select class="batch-style-select" data-batch-field="style" aria-label="Video image style for row ' + index + '" title="Same ten styles as the script modal">' +
						batchStyleOptionsHTML(row.style) +
					"</select>" +
					'<div class="batch-row-sub">render treatment; stock appearance varies</div>' +
				"</td>" +
				'<td class="batch-cell batch-cell-resolution">' +
					'<select class="batch-resolution-select" data-batch-field="resolution" aria-label="Output frame resolution for row ' + index + '" title="Output frame long edge. Pixabay source dimensions vary.">' +
					batchResolutionOptionsHTML(row.resolution) +
					"</select>" +
					'<div class="batch-row-sub">' + frame.width + "\u00d7" + frame.height + "</div>" +
					"</td>" +
				'<td class="batch-cell batch-cell-orientation">' +
					'<select class="batch-orientation-select" data-batch-field="orientation" aria-label="Frame orientation for row ' + index + '" title="Output frame shape; guides stock search orientation">' +
					batchOrientationOptionsHTML(row.orientation) +
					"</select>" +
					'<div class="batch-row-sub">frame</div>' +
					"</td>" +
				'<td class="batch-cell batch-cell-action" data-batch-slot="actions">' +
					batchActionsHTML(row) +
				"</td>" +
			"</tr>"
		);

	}

	function batchTableSignature() {

		/* The page is part of the signature: a page change rebuilds the tbody. */
		return batchPage + "|" + batchRows
			.map(function (row) {
				return row.id;
			})
			.join(",");

	}

	function refreshBatchRowCells() {

		for (const row of batchRows) {

			const tr =
				document.querySelector('[data-batch-row="' + row.id + '"]');

			if (tr) {
				const scriptEl =
					tr.querySelector('[data-batch-field="script"]');
				if (
					scriptEl &&
					document.activeElement !== scriptEl &&
					(pipelineManagementRestoring || (String(row.script || "") && scriptEl.value === ""))
				) {
					scriptEl.value = String(row.script || "");
				}
				const styleEl =
					tr.querySelector('[data-batch-field="style"]');
				if (styleEl && row.style && document.activeElement !== styleEl) {
					const prevSynced = styleEl._syncedStyle != null
						? styleEl._syncedStyle
						: (styleEl.options && styleEl.options[0] ? styleEl.options[0].value : "");
					if (pipelineManagementRestoring || (!styleEl._batchTouched && styleEl.value === prevSynced)) {
						styleEl.value = row.style;
						styleEl._syncedStyle = row.style;
					}
				}
			}

			const status =
				document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="status"]');

			if (status) {

				status.innerHTML =
					batchStatusHTML(row);

				status.setAttribute(
					"data-stage",
					row.stage
				);

				status.setAttribute(
					"data-loading",
					batchRowBusy(row) ? "1" : "0"
				);

			}

			const actions =
				document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="actions"]');

			if (actions) {

				/*
				 * All three icons are always in the cell; batchRowFinished()
				 * is the one flag that decides whether they are enabled
				 * (Session 332 — Edit is no longer "always live").
				 */
				actions.innerHTML =
					batchActionsHTML(row);

			}

		}

	}

	function renderBatchTable() {

		const body =
			document.getElementById(
				"batch-rows"
			);

		if (!body) {

			return;

		}

		/*
		 * The table starts with one blank row to type into - but only
		 * the first time. After that an empty table stays empty, so a
		 * user can remove every row without the table fighting back.
		 */
		if (
			!batchRows.length &&
			!batchTableSeeded
		) {

			batchTableSeeded =
				true;

			batchRows.push(
				createBatchRow()
			);

		}

		const signature =
			batchTableSignature();

		if (
			body.getAttribute("data-batch-signature") !==
			signature
		) {

			/*
			 * Session 331: five rows per page. The row number printed in the
			 * first cell stays GLOBAL (row 6 is 06 even when it opens page 2).
			 */
			body.innerHTML =
				visibleBatchRows()
					.map(function (row) {
						return batchRowHTML(row, batchRows.indexOf(row) + 1);
					})
					.join("");

			body.setAttribute(
				"data-batch-signature",
				signature
			);

		}
		else {

			/* Rows already exist - never rebuild the DOM a user is typing in. */
			refreshBatchRowCells();

		}

		bindBatchPager();

		updateBatchToolbar();

		const empty =
			document.getElementById(
				"batch-empty"
			);

		if (empty) {

			empty.hidden =
				batchRows.length > 0;

		}

		const addRow =
			document.getElementById(
				"batch-add-row"
			);

		if (addRow) {

			addRow.disabled =
				batchRows.length >=
				BATCH_ROW_LIMIT;

		}

		/* The editor counters keep counting the accordions. */
		const conceptCount =
			document.getElementById(
				"concept-count"
			);

		if (conceptCount) {

			conceptCount.textContent =
				videoProjects.length +
				" of " +
				VIDEO_MAX_VIDEOS +
				" videos";

		}

		const previewState =
			document.getElementById(
				"preview-state"
			);

		if (previewState) {

			previewState.textContent =
				batchRunBusy
					? "table generating"
					: videoProjects.length
						? videoProjects.length + " in queue"
						: "idle";

		}

		persistPipelineManagementState("render-batch-table");

	}

	function setBatchStage(
		row,
		stage,
		detail
	) {

		row.stage =
			stage;

		row.detail =
			detail || "";

		if (stage === "error") {

			row.error =
				detail || row.error;

		}

		/* Spinner + label for the working stages, plain text otherwise. */
		paintBatchRowStatus(row);
		persistPipelineManagementState("batch-stage");

		console.info("[batch-table] row " + row.id, {
			stage: row.stage,
			detail: row.detail,
			mp3: !!row.mp3,
			prompts: row.prompts.length,
			images: row.images.length,
			slides: row.slides.length
		});

	}

	/*
	 * fetch with a hard timeout + an abort handle per row.
	 * When consumeResponse is passed, row.controller and the timeout stay
	 * active while reading the response body (e.g. response.blob() or
	 * response.json()) so stopping a row or hitting a stalled body download
	 * aborts cleanly without a blind spot after HTTP headers arrive.
	 */
	async function batchFetch(
		row,
		url,
		init,
		timeoutMs,
		consumeResponse
	) {

		const controller =
			typeof AbortController !== "undefined"
				? new AbortController()
				: null;

		row.controller =
			controller;

		/*
		 * Session #244: an abort caused by THIS timeout is a retryable
		 * timeout, not a user stop - and it is reported as one, so the
		 * browser's abort wording never becomes a row's status text.
		 */
		let timedOut =
			false;

		let timer =
			controller && typeof setTimeout === "function"
				? setTimeout(function () {
					timedOut = true;
					try {
						controller.abort();
					}
					catch (abortError) { }
				}, timeoutMs || BATCH_REQUEST_TIMEOUT_MS)
				: null;

		const clearHeaderTimer = function () {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		};

		try {

			const response =
				await fetch(
					url,
					Object.assign(
						{ credentials: "same-origin" },
						init,
						controller ? { signal: controller.signal } : {}
					)
				);

			if (typeof consumeResponse === "function") {
				return await consumeResponse(response, controller, clearHeaderTimer);
			}

			return response;

		}
		catch (fetchError) {

			if (timedOut) {

				throw batchError(
					"The request took too long",
					"TimeoutError"
				);

			}

			if (row.stopRequested) {

				throw batchError(
					"The row was stopped",
					"AbortError"
				);

			}

			/*
			 * Any other abort that is not a stop is still a dead request:
			 * name it as a timeout so the row can retry it quietly.
			 */
			if (batchIsAbortError(fetchError)) {

				throw batchError(
					"The request was interrupted",
					"TimeoutError"
				);

			}

			throw fetchError;

		}
		finally {

			clearHeaderTimer();

			if (row.controller === controller) {
				row.controller =
					null;
			}

		}

	}

	/*
	 * One NDJSON read with an idle budget. A stream that goes quiet is
	 * cancelled and reported as a retryable timeout, so the row can start
	 * the step again instead of waiting for a chunk that never comes.
	 */
	async function batchReadChunk(reader) {

		if (typeof setTimeout !== "function") {

			return reader.read();

		}

		let timer =
			null;

		try {

			return await Promise.race([

				reader.read(),

				new Promise(function (resolve, reject) {

					timer =
						setTimeout(function () {

							try {

								if (reader && typeof reader.cancel === "function") {

									reader.cancel().catch(function () { });

								}

							}
							catch (cancelError) { }

							reject(
								batchError(
									"The image stream stopped sending",
									"TimeoutError"
								)
							);

						}, BATCH_STREAM_IDLE_TIMEOUT_MS);

				})

			]);

		}
		finally {

			if (timer) {

				clearTimeout(timer);

			}

		}

	}

	/*
	 * FINAL RULE - QUICK BATCH TABLE LAYOUT: the voice stage is also owned
	 * by client JavaScript. A failed voice pipeline is reset and retried
	 * silently up to seven times, each retry after a 40-second backoff.
	 */
	async function batchRunVoiceStep(row, stage, detail, step, options) {
		return batchRunPipelineStage(row, stage, detail, async function (retry) {
			if (row.stopRequested) throw batchError("The row was stopped", "AbortError");
			/* Start the other lanes as soon as this row claims a voice slot. */
			if (retry === 0 && typeof startUnprocessedRows === "function") startUnprocessedRows(row);
			setBatchStage(row, stage, detail);
			refreshBatchRowCells();
			return step(retry + 1);
		}, options);
	}

	async function requestBatchVoiceover(row) {
		const response = await studioOffload.mediaResponse(
			"/api/voiceover",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body:
					JSON.stringify({
						text: String(row.script || "").trim(),
						lang: "en"
					})
			},
			{
				/* Three Quick Batch rows may speak at once on a capable device. */
				slots: BATCH_RUN_CONCURRENCY,
				isCancelled: function () { return Boolean(row.stopRequested); },
				setController: function (controller) { row.controller = controller; },
				clearController: function (controller) { if (row.controller === controller) row.controller = null; }
			}
		);

		if (!response.ok) {
			const data = await response.json().catch(function () { return {}; });
			const error = new Error(voiceFailureText(data, response.status));
			error.status = response.status;
			error.stage = (data && data.stage) || "voiceover";
			error.attempts = Number(data && data.attempts) || 0;
			error.retryable = data ? data.retryable !== false : true;
			throw error;
		}

		console.info("[voiceover] worker in-request ladder; browser stage ladder owns failures", {
			rowId: row.id,
			requests: 1,
			attempts: Number(response.headers && response.headers.get ? response.headers.get("X-Voiceover-Attempts") : 0) || 0
		});

		return await response.blob();
	}

	/* The MP3 gives the row its timing: length + subtitle spread. */
	async function decodeBatchAudio(row, blob) {

		let timer =
			null;

		try {

			const context =
				getAudioContext();

			if (
				context &&
				context.state === "suspended" &&
				typeof context.resume === "function"
			) {

				try {
					context.resume().catch(function () { });
				}
				catch (resumeError) { }

			}

			const audioBytes =
				(await mediaDeadline(blob.arrayBuffer(), 30000, "Reading batch narration timed out.")).slice(0);

			const decoded =
				await Promise.race([
					context.decodeAudioData(audioBytes),
					new Promise(function (resolve, reject) {
						timer =
							setTimeout(function () {
								reject(new Error("Audio decode timed out"));
							}, BATCH_AUDIO_DECODE_MS);
					})
				]);

			row.audio = {
				name:
					"Row" + row.id + "-voiceover.mp3",
				duration:
					decoded.duration,
				buffer:
					decoded,
				url:
					null
			};

			return Math.round(decoded.duration * 1000);

		}
		catch (decodeError) {

			console.warn(
				"[batch-table] the MP3 could not be decoded, timing falls back to the minutes setting",
				decodeError
			);

			return 0;

		}
		finally {

			if (timer) {
				clearTimeout(timer);
			}

		}

	}

	/*
	 * Session 331: the length the scene windows are cut from. The verified
	 * voiceover wins, then the worker's measured script span, then the minutes
	 * the project was created with.
	 */
	function editorScenePlanDuration(project) {
		const audio = Number(project && project.audio && project.audio.duration);
		if (Number.isFinite(audio) && audio > 0) return audio;
		const voice = Number(project && project._voiceoverDurationMs);
		if (Number.isFinite(voice) && voice > 0) return voice / 1000;
		const measured = Number(project && project.scriptDurationMs);
		if (Number.isFinite(measured) && measured > 0) return measured / 1000;
		return Math.max(1, Number(project && project._seoMinutes) || 1) * 60;
	}

	/* Step 2: the script + the row's style become the scene prompts. */
	async function requestBatchPrompts(row, batch) {

		const caps = await studioOffload.capabilities();
		const compact = null;
		if (caps.compactPrompts) {
			const owner = { controller: null }; row._promptOwner = owner;
			const response = await studioOffload.jsonRequest("/api/image-prompts", {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ topic: batchRowTopic(row), minutes: row.minutes, style: row.style, batch: batch,
					sceneTotal: AUTO_MEDIA_TOTAL, resolution: batchResolution(row.resolution), orientation: batchOrientation(row.orientation).value, script: String(row.script || ""),
					keywordSource: "script", durationSec: batchScenePlanDuration(row) })
			}, 60000, {
				isCancelled: function () { return Boolean(row.stopRequested); },
				setController: function (controller) { owner.controller = controller; },
				clearController: function (controller) { if (owner.controller === controller) owner.controller = null; }
			});
			const data = await response.json().catch(function () { return null; });
			if (!response.ok || !data || !data.success || !Array.isArray(data.prompts)) {
				const error = new Error((data && data.error) || ("Scene prompt request failed (HTTP " + response.status + ")"));
				error.retryable = response.status === 408 || response.status >= 500 || response.status === 429 || response.ok;
				/* #263: keep the server's load answer so the retry can wait it out. */
				error.status = response.status;
				error.kind = (data && data.kind) || "";
				error.retryAfterMs = data && Number(data.retryAfterMs) > 0 ? Number(data.retryAfterMs) : 0;
				/* Session 279: the worker ran the ladder; this is what it spent. */
				error.attempts = Number(data && data.attempts) || 0;
				error.retryOwner = (data && data.retryOwner) || "";
				throw error;
			}
			return data.prompts;
		}
		// Separate ownership: prompt lookahead must not overwrite the image stream's Stop handle.
		const owner = Object.create(row);
		row._promptOwner = owner;
		return await batchFetch(
			owner,
			"/api/image-prompts",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body:
					JSON.stringify({
						batch: batch,
						sceneTotal: AUTO_MEDIA_TOTAL,
						topic:
							batchRowTopic(row),
						minutes:
							row.minutes,
						style:
							row.style,
							/*
							 * Session #211: the frame the row asked for is
							 * written into the prompts themselves, so every
							 * scene is composed for that shape and size.
							 */
							resolution:
								batchResolution(row.resolution),
							orientation:
								batchOrientation(row.orientation).value,
						scriptIdea: compact || undefined,
						script: compact ? undefined : String(row.script || "").trim(),
						/* Session 331: script-anchored scene keywords (no model). */
						keywordSource: "script",
						durationSec: batchScenePlanDuration(row)
					})
			},
			60000,
			async function (response) {

				const data =
					await response
						.json()
						.catch(function () { return {}; });

				if (!response.ok || !data.success) {

					const error = new Error((data && data.error) || ("Stock search terms failed (HTTP " + response.status + ")"));
					error.retryable = response.status === 408 || response.status >= 500 || response.status === 429 || response.ok;
					throw error;

				}

				const prompts =
					Array.isArray(data.prompts)
						? data.prompts.filter(function (prompt) {
							return typeof prompt === "string" && prompt.trim().length > 0;
						})
						: [];

				if (!prompts.length) {

					throw new Error(
						"No Pixabay scene selections were prepared"
					);

				}

				return prompts;

			}
		);

	}

	/*
	 * Session 331: a quick-batch row's verified voiceover length, else the
	 * minutes it was planned for. The scene windows follow this.
	 */
	function batchScenePlanDuration(row) {
		const audio = Number(row && row.audio && row.audio.duration);
		if (Number.isFinite(audio) && audio > 0) return audio;
		return Math.max(1, Number(row && row.minutes) || 1) * 60;
	}

	function batchRowTopic(row) {

		const firstLine =
			String(row.script || "")
				.split(/\\n+/)
				.map(function (line) { return line.trim(); })
				.filter(Boolean)[0] || "";

		return (
			firstLine ||
			"quick batch row " + row.id
		).slice(0, 90);

	}

	/*
	 * #262: a load rejection is not the user's mistake. Turn the server's
	 * Retry-After hint into one short, actionable sentence instead of leaking a
	 * raw provider string (the browser already honours the wait itself).
	 *
	 * #274: ONLY a server-declared load answer (kind "overload", RULE 31) may
	 * use the reassuring "pause and continue" wording. A bare 503 with no kind
	 * is not load — it is a configuration/authorization failure (missing
	 * PIXABAY_API_KEY, KV outage) that will never "continue", so show its real
	 * message instead of promising a recovery the flow does not perform.
	 */
	function describeImageLoadFailure(error) {
		const retryMs = error && Number(error.retryAfterMs) > 0 ? Number(error.retryAfterMs) : 0;
		const overload = Boolean(
			error && error.kind === "overload"
		);
		if (overload) {
			const seconds = retryMs > 0 ? Math.max(1, Math.ceil(retryMs / 1000)) : 5;
			return "The image server is busy right now \u2014 images pause for about " + seconds + " s and then continue.";
		}
		return (error && error.message) || "Image generation failed";
	}

	/*
	 * #263 kept, #263's rounds moved to the worker (session 279).
	 *
	 * #263's complaint was real: a chunk was requested exactly once, so when the
	 * *second* chunk hit a transient 5xx the flow's stop reason was set and a
	 * 10-scene video "finished" with 3 images. Its fix was a browser-side round
	 * ladder. The fix that stays is the part only the browser can do:
	 *
	 *   - already-delivered scenes are never re-requested (no duplicates, no
	 *     double billing, no replay of an ambiguous paid image);
	 *   - a chunk that comes back incomplete is a VERDICT, reported per scene,
	 *     and the row keeps the images it has;
	 *   - onImage(blob, index) receives the ORIGINAL prompt index, because
	 *     gallery slots and scene numbers depend on it.
	 *
	 * The retrying itself belongs to the worker (generateOneWithRetry: up to 4
	 * attempts inside a 45 s budget, Retry-After honoured, fatal verdicts stop
	 * immediately) - see requestImageChunk below.
	 */
	/*
	 * ONE PASS OVER THE SCENES (session 279).
	 *
	 * This used to run up to three rounds over the scenes that came back
	 * missing, with min(max(hint, 800x2^round), 15000) between them. Each
	 * round re-reserved credits, re-queued behind the browser's media scheduler
	 * and re-asked a worker that had ALREADY retried: generateOneWithRetry
	 * (src/modules/image-batch.ts) spends up to 4 attempts inside a 45 s budget,
	 * honours Retry-After and stops on a fatal verdict. Three rounds on top of
	 * that is up to twelve provider attempts for one scene, and the second
	 * owner is the one that decides when the row gives up.
	 *
	 * So a scene that comes back failed is a VERDICT now. What this function
	 * still owns is not a retry: the negotiated per-tab slot count, the
	 * cancellation checks, the scene-index mapping for onImage/onError, and
	 * reporting a hole left by a cancelled pass as a failure - never as success.
	 */
	/*
	 * FINAL MEDIA RULE — individual retries, unique filenames and a fixed
	 * 12-scene plan. These helpers are shared by the Quick Batch table and the
	 * Editor. A failed image or video is requested again by client JS; a
	 * successful asset is never reset, revoked or re-requested.
	 */
	function mediaItemRetryPolicy() {
		var policy = {
			maxRetries: MEDIA_ITEM_MAX_RETRIES,
			backoffMs: MEDIA_ITEM_RETRY_BACKOFF_MS,
			uiCheckMs: MEDIA_ITEM_UI_CHECK_MS
		};
		var overrides = [
			window.__MEDIA_ITEM_RETRY_TIMING,
			window.__MEDIA_ITEM_RETRY_POLICY,
			window.__MEDIA_ITEM_RETRY,
			window.__MEDIA_RETRY_TIMING,
			window.__QUICK_BATCH_MEDIA_RETRY_TIMING,
			window.__BATCH_PIPELINE_RETRY_TIMING,
			window.__SCRIPT_RETRY_TIMING,
			window.__BATCH_RETRY
		];
		for (var i = 0; i < overrides.length; i++) {
			var value = overrides[i];
			if (!value || typeof value !== "object") continue;
			if (Number.isFinite(Number(value.maxRetries))) policy.maxRetries = Math.max(0, Math.floor(Number(value.maxRetries)));
			if (Number.isFinite(Number(value.retries))) policy.maxRetries = Math.max(0, Math.floor(Number(value.retries)));
			if (Number.isFinite(Number(value.backoffMs))) policy.backoffMs = Math.max(0, Math.floor(Number(value.backoffMs)));
			if (Number.isFinite(Number(value.retryBackoffMs))) policy.backoffMs = Math.max(0, Math.floor(Number(value.retryBackoffMs)));
			if (Number.isFinite(Number(value.uiCheckMs))) policy.uiCheckMs = Math.max(0, Math.floor(Number(value.uiCheckMs)));
		}
		policy.totalAttempts = policy.maxRetries + 1;
		return policy;
	}

	function mediaItemRetryLog(entry) {
		if (!Array.isArray(window.__MEDIA_ITEM_RETRY_LOG)) window.__MEDIA_ITEM_RETRY_LOG = [];
		window.__MEDIA_ITEM_RETRY_LOG.push(Object.assign({ at: Date.now() }, entry || {}));
		if (window.__MEDIA_ITEM_RETRY_LOG.length > 300) window.__MEDIA_ITEM_RETRY_LOG.shift();
	}

	function recordedMediaFilenames(owner) {
		if (!owner) return [];
		if (!Array.isArray(owner.mediaFilenames)) owner.mediaFilenames = [];
		return owner.mediaFilenames;
	}

	function mediaFilenameFromBlob(blob, scene) {
		var source = (blob && blob.stockSource) || {};
		var raw = String(source.filename || source.id || source.pageURL || source.url || source.assetId || "");
		var mime = String((blob && blob.type) || "");
		var ext = mime === "video/mp4" ? ".mp4"
			: mime === "image/png" ? ".png"
			: mime === "image/webp" ? ".webp"
			: mime === "image/gif" ? ".gif"
			: ".jpg";
		if (!raw) return "local-scene-" + scene + "-" + String((blob && blob.size) || 0) + ext;
		var safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
		if (!safe) return "local-scene-" + scene + "-" + String((blob && blob.size) || 0) + ext;
		if (safe.slice(-ext.length).toLowerCase() === ext) return safe;
		return "pixabay-" + safe + ext;
	}

	function reserveMediaFilename(owner, filename) {
		var names = recordedMediaFilenames(owner);
		if (!filename || names.indexOf(filename) !== -1) return false;
		names.push(filename);
		if (!Array.isArray(window.__MEDIA_FILENAME_LOG)) window.__MEDIA_FILENAME_LOG = [];
		window.__MEDIA_FILENAME_LOG.push({
			at: Date.now(),
			ownerId: owner && owner.id ? owner.id : "",
			filename: filename,
			count: names.length
		});
		return true;
	}

	/*
	 * Session 331: how many duplicate filenames this scene has already been
	 * handed back. Each duplicate is one Pixabay result page the next retry
	 * must skip, so the counter - not the retry attempt number - decides how
	 * far the search moves.
	 */
	function mediaDuplicatePages(owner, scene) {
		if (!owner) return 0;
		var map = owner._mediaDuplicatePages;
		if (!map || typeof map !== "object") return 0;
		return Math.max(0, Number(map["scene-" + String(scene == null ? 0 : scene)]) || 0);
	}

	function noteMediaDuplicate(owner, scene) {
		if (!owner) return 0;
		if (!owner._mediaDuplicatePages || typeof owner._mediaDuplicatePages !== "object") owner._mediaDuplicatePages = {};
		var key = "scene-" + String(scene == null ? 0 : scene);
		var next = (Number(owner._mediaDuplicatePages[key]) || 0) + 1;
		owner._mediaDuplicatePages[key] = next;
		return next;
	}

	function acceptMediaBlob(owner, blob, scene) {
		if (!blob) return false;
		var filename = mediaFilenameFromBlob(blob, scene);
		if (!reserveMediaFilename(owner, filename)) {
			noteMediaDuplicate(owner, scene);
			mediaItemRetryLog({ event: "duplicate-filename", stage: "media", scene: scene, filename: filename, pageSteps: mediaDuplicatePages(owner, scene) });
			return false;
		}
		blob.stockFilename = filename;
		if (!blob.stockSource || typeof blob.stockSource !== "object") blob.stockSource = {};
		blob.stockSource.filename = filename;
		return true;
	}

	function alternateMediaPrompt(prompt, attempt, scene, owner) {
		if (typeof prompt !== "string" || prompt.indexOf("pixabay:") !== 0) return prompt;
		var token = null;
		try { token = JSON.parse(prompt.slice(8)); } catch (error) { return prompt; }
		if (!token || typeof token !== "object") return prompt;
		var type = token.type === "video" ? "video" : "image";
		var limit = type === "video" ? AUTO_VIDEO_SCENES : AUTO_IMAGE_SCENES;
		var base = Number.isInteger(token.index) ? token.index : (Number(token.scene) || scene) % limit;
		var step = Math.max(0, Number(attempt) || 0);
		var ordinal = (base + step) % limit;
		var page = 1 + (Math.floor((base + step) / limit) % MEDIA_MAX_PIXABAY_PAGES);
		/*
		 * Session 331: a rejected duplicate filename is answered by moving the
		 * Pixabay result page forward one page per duplicate and taking the
		 * first hit of that page. Before this, the page only changed after a
		 * full limit (8 images / 4 videos) index rotation, so a duplicate at
		 * index 0 re-read the very page that had just refused the asset.
		 */
		var duplicates = mediaDuplicatePages(owner, scene);
		if (duplicates > 0) {
			var startPage = Math.max(1, Math.floor(Number(token.page) || 1));
			page = 1 + ((startPage - 1 + duplicates) % MEDIA_MAX_PIXABAY_PAGES);
			/*
			 * First hit of the moved page. A second duplicate walks the next
			 * index instead of landing back on the page/asset that just failed,
			 * so the pair (page, index) is never repeated.
			 */
			ordinal = Math.floor(duplicates / MEDIA_MAX_PIXABAY_PAGES) % limit;
		}
		var next = Object.assign({}, token, {
			type: type,
			index: ordinal,
			page: page,
			scene: scene,
			retry: step,
			duplicatePages: duplicates,
			uniqueFilename: "required"
		});
		return "pixabay:" + JSON.stringify(next);
	}

	function mediaItemCancelled(owner) {
		if (!owner) return false;
		if (owner.stopRequested || owner._deleted || owner._imageFlowActive === false) return true;
		/* Only Quick Batch row objects have an id that maps into batchRows. */
		if (owner.id && typeof getBatchRow === "function" &&
			(Array.isArray(owner.objectUrls) || typeof owner.stage === "string")) {
			var live = getBatchRow(owner.id);
			if (!live || live.stopRequested) return true;
		}
		return false;
	}

	function keepMediaItemUi(owner, stage) {
		if (!owner || typeof keepBatchPipelineStageUi !== "function") return;
		try { keepBatchPipelineStageUi(owner, stage || "images"); } catch (error) { }
	}

	function mediaItemRetryDelay(ms, owner, stage) {
		var policy = mediaItemRetryPolicy();
		return new Promise(function (resolve) {
			var settled = false;
			var uiTimer = null;
			function finish(proceed) {
				if (settled) return;
				settled = true;
				if (uiTimer) clearTimeout(uiTimer);
				resolve(Boolean(proceed));
			}
			function tick() {
				if (!settled && mediaItemCancelled(owner)) return finish(false);
				keepMediaItemUi(owner, stage);
				if (policy.uiCheckMs > 0) uiTimer = window.setTimeout(tick, policy.uiCheckMs);
			}
			if (policy.uiCheckMs > 0) window.setTimeout(tick, 0);
			else keepMediaItemUi(owner, stage);
			window.setTimeout(function () {
				finish(!mediaItemCancelled(owner));
			}, ms);
		});
	}

	async function retryFailedMediaOnly(owner, prompts, sceneIndexes, fetchOnce, stage) {
		var policy = mediaItemRetryPolicy();
		var indexes = Array.isArray(sceneIndexes) && sceneIndexes.length === prompts.length
			? sceneIndexes.slice()
			: prompts.map(function (_, index) { return index; });
		var pending = prompts.map(function (prompt, index) {
			return { prompt: prompt, scene: indexes[index], attempt: 0 };
		});
		var collected = [];
		var exhausted = [];
		var round = 0;
		while (pending.length && round < policy.totalAttempts && !mediaItemCancelled(owner)) {
			if (round > 0) {
				mediaItemRetryLog({
					event: "backoff",
					stage: stage || "media",
					retry: round,
					backoffMs: policy.backoffMs,
					failed: pending.map(function (item) { return item.scene; })
				});
				var proceed = await mediaItemRetryDelay(policy.backoffMs, owner, stage);
				if (!proceed) break;
			}
			var pendingPrompts = [];
			var pendingScenes = [];
			for (var i = 0; i < pending.length; i++) {
				pendingPrompts.push(alternateMediaPrompt(pending[i].prompt, pending[i].attempt, pending[i].scene, owner));
				pendingScenes.push(pending[i].scene);
			}
			var result = null;
			try {
				result = await fetchOnce(pendingPrompts, pendingScenes, round);
			} catch (error) {
				if (mediaItemCancelled(owner)) throw error;
				result = { failed: pendingScenes.slice(), images: [] };
			}
			if (result && Array.isArray(result.images)) collected.push.apply(collected, result.images);
			var failedSet = new Set((result && result.failed) || []);
			var next = [];
			for (var j = 0; j < pending.length; j++) {
				var item = pending[j];
				if (!failedSet.has(item.scene)) continue;
				if (item.attempt < policy.maxRetries) {
					next.push({ prompt: item.prompt, scene: item.scene, attempt: item.attempt + 1 });
				}
				else {
					exhausted.push(item.scene);
				}
			}
			mediaItemRetryLog({
				event: "round",
				stage: stage || "media",
				attempt: round + 1,
				requested: pendingScenes,
				failed: Array.from(failedSet),
				delivered: pendingScenes.filter(function (scene) { return !failedSet.has(scene); })
			});
			pending = next;
			round++;
		}
		return {
			images: collected,
			failed: pending.map(function (item) { return item.scene; }).concat(exhausted),
			attempts: round
		};
	}

	async function requestImageChunk(prompts, frame, options) {
		const owner = options || {};
		const results = new Array(prompts.length);
		const batch = prompts.map(function (_, index) { return index; });
		/*
		 * Negotiated per-tab image ceiling (bug fix: image generation felt
		 * serial). Absent/unknown keeps the documented adaptive limit (3 on
		 * a capable device), so an older Worker behaves exactly as before.
		 */
		const caps = await studioOffload.capabilities();
		const imageSlots = Math.max(0, Math.min(8, Number(caps.imageSlots) || 0));

		if (owner.isCancelled && owner.isCancelled()) return cancelledResults(prompts, results);

		const perAttempt = {
			slots: imageSlots || undefined,
			isCancelled: owner.isCancelled,
			priority: owner.priority,
			setController: owner.setController,
			clearController: owner.clearController,
			onImage: function (blob, localIndex) {
				const index = batch[localIndex];
				if (typeof index !== "number") return;
				if (owner.onImage) return owner.onImage(blob, index);
			},
			onError: function (error, localIndex) {
				const index = batch[localIndex];
				if (typeof index !== "number") return;
				if (owner.onError) owner.onError(error, index);
			}
		};

		let batchResults;
		try {
			batchResults = await studioOffload.images(
				prompts.slice(),
				frame || {},
				perAttempt
			);
		} catch (passError) {
			/*
			 * The media scheduler rejects (rather than resolving every scene)
			 * when the flow is cancelled mid-pass. That is a Stop, not a
			 * transport failure: leave the scenes unset so they are reported as
			 * cancellations below.
			 */
			const cancelled =
				(passError && passError.name === "AbortError") ||
				(owner.isCancelled && owner.isCancelled());
			if (cancelled) return cancelledResults(prompts, results);
			throw passError;
		}

		batchResults.forEach(function (result, slot) {
			const index = batch[slot];
			/* Report the scene index, not the slot inside this pass. */
			if (result) result.index = index;
			results[index] = result || { ok: false, index: index, error: null };
			if (result && !result.ok) {
				const error = result.error;
				console.warn("[image-chunk] scene verdict", {
					scene: index,
					status: Number(error && error.status) || 0,
					retryable: error ? error.retryable !== false : true,
					attempts: Number(error && error.attempts) || 0,
					error: String((error && error.message) || error || "").slice(0, 200)
				});
			}
		});

		return cancelledResults(prompts, results);
	}

	/* Holes left by a cancelled pass are failures, never successes. */
	function cancelledResults(prompts, results) {
		return prompts.map(function (_, index) {
			if (results[index]) return results[index];
			const cancelled = new Error("Image generation was cancelled");
			cancelled.name = "AbortError";
			cancelled.retryable = false;
			return { ok: false, index: index, error: cancelled };
		});
	}

	/* Step 3: one bounded image chunk through the shared browser stream queue. */
	async function requestBatchImages(
		row,
		prompts,
		sceneIndexes
	) {
		const sceneMap = Array.isArray(sceneIndexes) && sceneIndexes.length === prompts.length
			? sceneIndexes.slice()
			: prompts.map(function (_, index) { return index; });
		const sceneForIndex = function (index) {
			const local = Number(index);
			return Number.isInteger(local) && local >= 0 && local < sceneMap.length ? Number(sceneMap[local]) : local;
		};
		if ((await studioOffload.capabilities()).binaryImages) {
			const images = [];
			const results = await requestImageChunk(prompts, {
				resolution: batchResolution(row.resolution), orientation: batchOrientation(row.orientation).value
			}, {
				isCancelled: function () { return Boolean(row.stopRequested); },
				priority: function () {
					const tr = document.querySelector('[data-batch-row="' + row.id + '"]');
					return tr && tr.contains(document.activeElement) ? 2 : 0;
				},
				setController: function (controller) { row.controller = controller; },
				clearController: function (controller) { if (row.controller === controller) row.controller = null; },
				onImage: function (blob, index) {
					if (row.stopRequested) return;
					const scene = sceneForIndex(index);
					if (!acceptMediaBlob(row, blob, scene)) {
						throw new Error("Duplicate Pixabay filename rejected for scene " + scene + "; an individual retry will search a different result");
					}
					const url = createStudioObjectUrl(blob); row.objectUrls.push(url);
					images.push({ blob: blob, url: url, index: scene, stockFilename: blob.stockFilename, stockSource: blob.stockSource || null });
				},
				onError: function (error, index) {
					if (!row.stopRequested) mediaItemRetryLog({ event: "item-failed", stage: "quick-batch-media", scene: sceneForIndex(index), message: String(error && error.message || error).slice(0, 160) });
				}
			});
			refreshCredits();
			images.sort(function (a, b) { return a.index - b.index; });
			if (!images.length) throw new Error("No image came out of the binary batch");
			const failedImages = results.filter(function (r) { return !r.ok; }).length;
			if (failedImages) recordStudioUsage("images", "error", failedImages);
			return images;
		}
		return appImageStreamQueue.enqueue(
			"table-row-" + row.id,
			async function () {

				const images =
					[];

				let fetchControllerRef =
					null;

				const response =
					await batchFetch(
						row,
						"/api/image-batch",
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"Accept": "application/x-ndjson"
							},
							body:
								JSON.stringify({
									prompts: prompts,
									sceneIndexes: sceneMap,
									/* The same frame the prompts were written for. */
									resolution:
										batchResolution(row.resolution),
									orientation:
										batchOrientation(row.orientation).value
								})
						},
						BATCH_REQUEST_TIMEOUT_MS * 2,
						async function (resp, fetchController, clearHeaderTimer) {

							if (!resp.ok) {

								const data =
									await resp
										.json()
										.catch(function () { return {}; });

								if (data && data.credits) {

									applyCredits(data.credits);

								}

								const batchError =
									new Error(
										(data && data.error) ||
										("Image batch failed (HTTP " + resp.status + ")")
									);

								batchError.status =
									resp.status;

								batchError.kind =
									(data && data.kind) || "";

								batchError.retryAfterMs =
									Number(data && data.retryAfterMs) > 0
										? Number(data.retryAfterMs)
										: 0;

								throw batchError;

							}

							/* Headers arrived: per-chunk batchReadChunk now owns idle timeouts. */
							clearHeaderTimer();
							fetchControllerRef = fetchController;
							/* Preserve fetchController as row.controller across return until streamAbortHandle attaches. */
							row.controller = {
								abort: function () {
									if (fetchController) {
										try { fetchController.abort(); } catch (abortErr) { }
									}
								}
							};
							return resp;

						}
					);

				const reader =
					response.body && typeof response.body.getReader === "function"
						? response.body.getReader()
						: null;

				if (!reader) {

					row.controller = null;

					throw new Error("This browser cannot read the image batch stream");

				}

				/*
				 * Keep an abort handle attached while streaming the NDJSON body so
				 * pressing "■ Stop generating" cancels both fetch and stream immediately.
				 */
				const streamAbortHandle = {
					abort: function () {
						if (fetchControllerRef) {
							try {
								fetchControllerRef.abort();
							}
							catch (fetchAbortError) { }
						}
						try {
							if (reader && typeof reader.cancel === "function") {
								reader.cancel().catch(function () { });
							}
						}
						catch (cancelError) { }
					}
				};

				row.controller =
					streamAbortHandle;

				const decoder =
					new TextDecoder();

				let buffer =
					"";

				let failed =
					0;

				let streamFailure = null;
				let streamDone = false;

				let imageCommitChain =
					Promise.resolve();

				const handleEvent = function (event) {

					if (!event || typeof event !== "object") {
						return;
					}

					if (event.type === "done") streamDone = true;
					if (event.type === "error") streamFailure = new Error(event.error || "Image stream failed");
					if (event.credits) {
						applyCredits(event.credits);
					}

					if (
						event.type === "image" &&
						event.ok &&
						event.data
					) {

						/*
						 * Offload base64 decoding immediately onto the background
						 * worker thread pool (or non-blocking event-loop chunks)
						 * while network I/O continues reading the stream.
						 */
						const parsedIndex =
							Number(event.index);
						const sceneIndex = sceneForIndex(parsedIndex);

						const decodeTask =
							decodeBase64ImageOffThread(event.data, event.mime);

						imageCommitChain = imageCommitChain.then(function () {

							return decodeTask.then(
								function (blob) {
									blob.stockSource = event.source || null;

									if (row.stopRequested) {
										return;
									}

									if (!acceptMediaBlob(row, blob, sceneIndex)) {
										failed++;
										return;
									}

									const url =
										createStudioObjectUrl(blob);

									row.objectUrls.push(url);

									images.push({
										blob: blob,
										url: url,
										index: sceneIndex,
										stockFilename: blob.stockFilename
									});

									setBatchStage(
										row,
										"images",
										images.length + " of " + prompts.length + " done"
									);

								},
								function (imageError) {

									failed++;

									console.warn("[batch-table] one image was unusable", imageError);

								}
							);

						});

					}

					if (event.type === "image" && !event.ok) {

						failed++;
						mediaItemRetryLog({ event: "item-failed", stage: "quick-batch-media", scene: sceneForIndex(event.index), message: String(event.error || "Pixabay media failed").slice(0, 160) });

					}

				};

				try {

					for (;;) {

						if (row.stopRequested) {

							streamAbortHandle.abort();

							throw batchError(
								"The row was stopped",
								"AbortError"
							);

						}

						/*
						 * Session #244: a stream that stops sending lines must not
						 * hang the row open. Each read gets an idle budget; a stall
						 * is a retryable timeout, so the step is retried quietly
						 * instead of leaving the row "Fetching Pixabay images"
						 * forever (or surfacing an abort message).
						 */
						const chunk =
							await batchReadChunk(reader);

						if (row.stopRequested) {

							throw batchError(
								"The row was stopped",
								"AbortError"
							);

						}

						if (chunk.done) {
							break;
						}

						buffer +=
							decoder.decode(chunk.value, { stream: true });

						let newlineIndex =
							buffer.indexOf("\\n");

						while (newlineIndex >= 0) {

							const line =
								buffer
									.slice(0, newlineIndex)
									.trim();

							buffer =
								buffer.slice(newlineIndex + 1);

							if (line) {

								try {
									handleEvent(JSON.parse(line));
								}
								catch (parseError) { }

							}

							newlineIndex =
								buffer.indexOf("\\n");

						}

					}

					const tail =
						(buffer + decoder.decode()).trim();

					if (tail) {

						try {
							handleEvent(JSON.parse(tail));
						}
						catch (parseError) { }

					}

					await imageCommitChain;

				}
				catch (error) {
					streamFailure = error;
				}
				finally {
					if (streamFailure) streamAbortHandle.abort();
					await imageCommitChain;
					if (row.controller === streamAbortHandle) {

						row.controller =
							null;

					}

				}

				if (row.stopRequested) {
					throw batchError("The row was stopped", "AbortError");
				}

				if (!streamDone && !streamFailure) streamFailure = new Error("Image stream ended before completion");
				if (streamFailure) {
					if (!images.length) throw streamFailure;
					row._imagePipelineWarning = "Image stream was interrupted; delivered media and filenames are kept for individual retries.";
				}
				if (!images.length) {

					throw new Error(
						"No image came out of the batch" +
						(failed ? " (" + failed + " prompt(s) failed)" : "")
					);

				}

				images.sort(function (a, b) {
					return a.index - b.index;
				});

				if (failed) {

					mediaItemRetryLog({ event: "partial-batch", stage: "quick-batch-media", rowId: row.id, failed: failed, delivered: images.length });

				}

				refreshCredits();

				return images;

			},
			{
				meta: { kind: "batch-row", rowId: row.id },
				isCancelled: function () {
					return Boolean(row && row.stopRequested);
				}
			}
		);

	}

	/*
	 * Quick Batch table: media retries are INDIVIDUAL. Only the missing
	 * Pixabay photo or video is requested again; delivered rows, object URLs
	 * and recorded filenames are never reset. The same 7-retry / 40 s ladder
	 * applies editor and table media, but the table's non-media stage ladder
	 * is not allowed to restart a whole image batch.
	 */
	async function requestBatchImagesWithIndividualRetries(row, prompts, sceneIndexes) {
		const indexes = Array.isArray(sceneIndexes) && sceneIndexes.length === prompts.length
			? sceneIndexes.slice()
			: prompts.map(function (_, index) { return index; });
		const alreadyDelivered = new Set((row.images || []).map(function (image) { return Number(image.index); }));
		const pending = [];
		const pendingScenes = [];
		for (let i = 0; i < prompts.length; i++) {
			if (alreadyDelivered.has(Number(indexes[i]))) continue;
			pending.push(prompts[i]);
			pendingScenes.push(Number(indexes[i]));
		}
		if (!pending.length) return [];
		setBatchStage(row, "images", "Selecting " + AUTO_MEDIA_TOTAL + " distinct Pixabay scenes");
		if (typeof startUnprocessedRows === "function" && !(row.images || []).length) startUnprocessedRows(row);
		const result = await retryFailedMediaOnly(row, pending, pendingScenes, async function (pendingPrompts, pendingScenes) {
			try {
				const delivered = await requestBatchImages(row, pendingPrompts, pendingScenes);
				const deliveredScenes = new Set(delivered.map(function (image) { return Number(image.index); }));
				return {
					images: delivered,
					failed: pendingScenes.filter(function (scene) { return !deliveredScenes.has(Number(scene)); })
				};
			} catch (error) {
				if (mediaItemCancelled(row)) throw error;
				mediaItemRetryLog({ event: "batch-item-error", stage: "quick-batch-media", rowId: row.id, message: String(error && error.message || error).slice(0, 200) });
				return { images: [], failed: pendingScenes.slice() };
			}
		}, "quick-batch-media");
		row.images.push.apply(row.images, result.images);
		row.images.sort(function (a, b) { return Number(a.index) - Number(b.index); });
		row._missingMediaScenes = Array.from(new Set((row._missingMediaScenes || []).concat(result.failed)));
		row._imagePipelineWarning = "";
		if (result.images.length) recordStudioUsage("images", "ok", result.images.length);
		mediaItemRetryLog({
			event: "quick-batch-media-complete",
			stage: "quick-batch-media",
			rowId: row.id,
			attempts: result.attempts,
			delivered: result.images.length,
			missing: result.failed,
			recordedFilenames: recordedMediaFilenames(row).slice()
		});
		setBatchStage(row, "images", result.images.length + " of " + AUTO_MEDIA_TOTAL + " scenes selected");
		return result.images;
	}

	/* play() is allowed to reject (autoplay policy) - the canvas keeps going. */
	function batchPreviewPlay(audio) {

		if (!audio || typeof audio.play !== "function") {

			return;

		}

		try {

			const played =
				audio.play();

			if (played && typeof played.catch === "function") {

				played.catch(function () { });

			}

		}
		catch (playError) { }

	}

	/* Fit every planned scene inside narration so neither required clip is truncated away. */
	function fitStockSceneTimeline(slides, seconds) {
		if (!slides.length || !Number.isFinite(seconds) || seconds <= 0) return slides;
		const totalFrames = Math.max(slides.length, Math.round(seconds * 30));
		const windowFrames = Math.max(1, Math.floor(totalFrames / slides.length));
		let used = 0;
		const stills = slides.filter(function (slide) { return slide.type !== "mp4"; });
		slides.forEach(function (slide) {
			if (slide.type === "mp4") {
				const frames = Math.min(Math.max(1, Math.floor(slide.duration * 30)), windowFrames);
				slide._partialSec = frames / 30; used += frames;
			}
		});
		let remaining = totalFrames - used;
		stills.forEach(function (slide, index) {
			const frames = Math.floor(remaining / (stills.length - index));
			slide._partialSec = frames / 30; remaining -= frames;
		});
		return slides;
	}

	/* Step 4: the animation - decoded <img> slides in play order. */
	async function buildBatchSlides(row, images) {

		const slides =
			[];

		for (let index = 0; index < images.length; index++) {

			if (row && row.stopRequested) {

				throw batchError("The row was stopped", "AbortError");

			}

			if (images[index].blob.type === "video/mp4") {
				const video = document.createElement("video");
				try {
					const duration = await probeMp4DurationWithRetry(images[index].url, 2, video);
					if (row.stopRequested) throw batchError("The row was stopped", "AbortError");
					if (!Number.isFinite(duration) || duration <= 0 || duration > MP4_MAX_DURATION_S) throw new Error("Pixabay clip exceeds the supported duration");
					slides.push({ id: "batch-" + row.id + "-clip-" + index, cardId: "", type: "mp4", img: video, videoEl: video, duration: duration });
				} catch (error) {
					video.removeAttribute("src"); video.load();
					slides.forEach(function (slide) { if (slide.videoEl) { slide.videoEl.removeAttribute("src"); slide.videoEl.load(); } });
					throw error;
				}
				continue;
			}

			const img =
				new Image();

			img.src =
				images[index].url;

			let decodeTimer =
				null;

			try {

				/*
				 * decode() is what tells us the pixels are really there. A
				 * browser without it is not failed on: the slide is kept and
				 * the exporter's own draw call is where a broken image would
				 * show up.
				 */
				if (typeof img.decode === "function") {

					await Promise.race([
						img.decode(),
						new Promise(function (_, reject) {

							decodeTimer =
								setTimeout(
									function () { reject(new Error("Pixabay photo decoding timed out; retry this row.")); },
									BATCH_SLIDE_DECODE_MS
								);

						})
					]);

				}

			}
			catch (loadError) {

				img.src = "";
				slides.forEach(function (slide) { if (slide.videoEl) { slide.videoEl.removeAttribute("src"); slide.videoEl.load(); } });
				throw new Error("Pixabay photo " + (index + 1) + " could not be decoded: " + (loadError.message || "invalid image"));

			}
			finally {

				if (decodeTimer) {

					clearTimeout(decodeTimer);

				}

			}

			slides.push({
				id:
					"batch-" + row.id + "-img-" + index,
				cardId:
					"",
				img:
					img
			});

			/* Yield the main thread every 3 decoded slides so browser CPU stays responsive. */
			if (
				index + 1 < images.length &&
				(index + 1) % 3 === 0
			) {

				await batchDelay(0);

			}

		}

		if (!slides.length) {

			throw new Error("None of the row's images could be prepared");

		}

		fitStockSceneTimeline(slides, row.audio && row.audio.duration);
		return slides;

	}

	async function runBatchRow(row) {

		/* A re-run starts from a clean row. */
		row._runEpoch = (Number(row._runEpoch) || 0) + 1;
		row._hydratingAssets = false;
		row._hydratingPromise = null;
		row._timelineAssetUrls = null;
		row._timelineAssetBlobs = null;
		row._timelineAudioUrls = null;
		revokeBatchRow(row);

		row.stopRequested = false;
		cancelBatchPipelineRetryWait(row);
		row._imagePipelineWarning = "";
		row.retrying = false;
		row.mp3 = null;
		row.mp3Url = "";
		row.audio = null;
		row.prompts = [];
		row.images = [];
		row.mediaFilenames = [];
		row._missingMediaScenes = [];
		row.slides = [];
		row.subtitles = [];
		row.animated = false;
		row.error = "";
		row.startedAt = Date.now();

		try {

			/*
			 * FINAL RULE - QUICK BATCH TABLE LAYOUT: every failed
			 * pipeline stage runs through the browser's silent 7-retry
			 * ladder. The row never leaves its working animation and never
			 * prints an error, whether a stage needed one or eight attempts.
			 */
			const spanMs =
				await batchRunVoiceStep(
					row,
					"voice",
					"Speaking " + String(row.script || "").trim().length + " characters",
					async function () {

						const blob =
							await requestBatchVoiceover(row);

						if (!blob || !blob.size) {

							throw new Error(
								"The voiceover model returned no audio"
							);

						}

						row.mp3 =
							blob;

						row.mp3Url =
							createStudioObjectUrl(blob);

						row.objectUrls.push(row.mp3Url);

						recordStudioUsage("voiceovers", "ok", 1);

						setBatchStage(row, "timing");

						const measuredMs =
							await decodeBatchAudio(row, blob);

						return (
							measuredMs ||
							Math.round(row.minutes * 60 * 1000)
						);

					},
					{
						snapshot: function () {
							return {
								urls: (row.objectUrls || []).length,
								mp3: row.mp3,
								mp3Url: row.mp3Url,
								audio: row.audio,
								subtitles: row.subtitles
							};
						},
						reset: function (saved) {
							revokeBatchUrlsSince(row, saved ? saved.urls : 0);
							row.mp3 = saved ? saved.mp3 : null;
							row.mp3Url = saved ? saved.mp3Url : "";
							row.audio = saved ? saved.audio : null;
							row.subtitles = saved ? saved.subtitles : [];
						}
					}
				);

	/* Subtitles come from the same plain text the voice read. */
	row.subtitles =
		buildScriptCues(
			row.script,
			spanMs
		);

	/*
	 * FINAL RULE - QUICK BATCH TABLE LAYOUT: prompt planning keeps the
	 * browser's silent stage ladder. Inside each render chunk, failed
	 * photos/clips are retried INDIVIDUALLY; a stage retry never resets
	 * media that already arrived.
	 */
	await batchRunPipelineStage(
		row,
		"prompts",
		"Planning and selecting 12 distinct Pixabay scenes for every script length",
		async function (retry) {
			/*
			 * Requirement 3 (Session 331): Preserve timeline edits.
			 * If timelineEdited is true, skip Pixabay search (prompts/images stages)
			 * and preserve existing scenes/graphics from timeline.
			 */
			if (row.timelineEdited && batchRowTimelinePendingRegen(row)) {
				/* Skip prompts/images generation, preserve existing projectDetail/timeline scenes */
				row.error = "";
				row.retrying = false;
				return row.prompts || (row.timeline && row.timeline.sceneItems) || [];
			}

			row.prompts = [];
			row.slides = [];
			row.error = "";
			row.retrying = false;
			row._imagePipelineWarning = "";
			row._missingMediaScenes = [];
			row._promptOwner = null;
			row.controller = null;
			const expectedImageCount = AUTO_MEDIA_TOTAL;
			const rowImageCaps = await studioOffload.capabilities();
			try {
						await runProgressiveImagePipeline({
							total: expectedImageCount,
							isCancelled: function () { return Boolean(row.stopRequested); },
							parallelRenders: Math.max(1, Math.min(4, Number(rowImageCaps.imageChunks) || 1)),
							/* The client stage ladder owns every failed prompt batch. */
							promptContinuations: 0,
							request: function (batch) {
								/* The client stage ladder owns retries; the worker sees one attempt. */
								batch.attempt = 0;
								return requestBatchPrompts(row, batch);
							},
							onPrompts: function (prompts) { row.prompts = prompts; },
							cancelPrompts: function () {
								if (row._promptOwner && row._promptOwner.controller) row._promptOwner.controller.abort();
							},
							render: async function (prompts, offset) {
								if (offset === 0 && retry === 0) startUnprocessedRows(row);
								await requestBatchImagesWithIndividualRetries(
									row,
									prompts,
									prompts.map(function (_, index) { return offset + index; })
								);
							}
						});
					} catch (pipelineError) {
						if (row.stopRequested) throw pipelineError;
						batchPipelineRetryLog({ event: "scene-plan-failed", rowId: row.id, retry: retry, reason: batchErrorBrief(pipelineError) });
						throw pipelineError;
					} finally {
						if (row._promptOwner && row._promptOwner.controller) row._promptOwner.controller.abort();
						row._promptOwner = null;
					}
					if (!Array.isArray(row.prompts) || row.prompts.length !== expectedImageCount) {
						throw new Error("The fixed 12-scene plan is incomplete; client JS will retry the scene plan.");
					}
					const deliveredSceneIndexes = new Set(row.images.map(function (image) { return Number(image.index); })
						.filter(function (index) { return Number.isInteger(index) && index >= 0 && index < AUTO_MEDIA_TOTAL; }));
					const mediaError = function (message) {
						const error = new Error(message);
						error.name = "MediaItemRetryExhausted";
						return error;
					};
					if (deliveredSceneIndexes.size !== expectedImageCount) {
						throw mediaError("The fixed 12-scene plan did not receive every distinct Pixabay scene after individual retries.");
					}
					const clips = row.images.filter(function (media) { return media.blob && media.blob.type === "video/mp4"; });
					const uniqueFilenames = new Set(row.images.map(function (media) {
						return media.stockFilename || (media.blob && media.blob.stockFilename);
					}));
					if (clips.length !== AUTO_VIDEO_SCENES || uniqueFilenames.size !== AUTO_MEDIA_TOTAL) {
						throw mediaError("The fixed plan requires four clips and eight photos, each with a unique filename.");
					}
					return row.prompts;
				},
				{
					snapshot: function () {
						return {
							prompts: (row.prompts || []).slice(),
							slides: (row.slides || []).slice(),
							subtitles: (row.subtitles || []).slice(),
							mp3: row.mp3,
							mp3Url: row.mp3Url,
							audio: row.audio
						};
					},
					reset: function (saved) {
						/* Only the failed plan is reset. Delivered media and filenames stay put. */
						row.prompts = saved ? saved.prompts.slice() : [];
						row.slides = saved ? saved.slides.slice() : [];
						row.subtitles = saved ? saved.subtitles.slice() : [];
						row.mp3 = saved ? saved.mp3 : row.mp3;
						row.mp3Url = saved ? saved.mp3Url : row.mp3Url;
						row.audio = saved ? saved.audio : row.audio;
						row._imagePipelineWarning = "";
						row._promptOwner = null;
						row.controller = null;
						row.error = "";
						row.retrying = false;
					}
				}
			);

			row.slides =
				await batchRunStep(
					row,
					"animate",
					row.images.length + " slides",
					function () {

						return buildBatchSlides(
							row,
							row.images
						);

					}
				);

			row.animated =
				true;

			row.finishedAt =
				Date.now();

			row._timelineRegeneratedAt =
				Math.max(batchRowTimelineUpdatedAt(row), row.finishedAt);

			row.timeline = null;
			row.timelineEdited = false;
			row.timelineDurationSec = 0;
			row.timelineSceneCount = 0;
			row._storedFinished = false;
			row._storedImagesCount = 0;
			row._storedSlidesCount = 0;
			row._storedMp3 = false;
			row._storedAnimated = false;
			row.projectDetail = composeBatchProjectDetail(row);

			setBatchStage(
				row,
				"done",
				row.slides.length + " slides \u00b7 " + formatSeconds(spanMs / 1000)
			);

			/* Session 331: a successful render is archived for 24 h. */
			try { recordCompletedBatchRow(row, "render"); } catch (archiveError) { }
			/* Session 331 (regenerate fix): a finished row keeps its media so a reload can restore it. */
			try { persistBatchRowMedia(row); } catch (persistError) { }

			console.info("[batch-table] row " + row.id + " finished", {
				ms: row.finishedAt - row.startedAt,
				slides: row.slides.length,
				durationMs: spanMs,
				style: row.style
			});

		}
		catch (rowError) {

			/*
			 * FINAL RULE - QUICK BATCH TABLE LAYOUT: after the client stage
			 * ladder is exhausted, nothing is shown to the user. The row goes
			 * back to looking like a row that has not started yet - no error
			 * text, no abort wording, no warning colour. Generate can retry it.
			 */
				console.warn("[batch-table] row " + row.id + " client ladder exhausted - no error is shown in the table", batchErrorBrief(rowError));
				/* FINAL RULE: even an exhausted client ladder paints no failure. */
				row.error = "";
				setBatchStage(row, "ready", "");

		}

		refreshBatchRowCells();

		return batchRowFinished(row);

	}

	/* Generate only starts rows that are prepared and idle. Staged rows never enter the queue. */
	const BATCH_GENERATABLE_STAGES = [
		"ready",
		"queued"
	];

	const WORD_COUNT_MIN = 50;

	function batchRowWordCount(row) {
		const text = String(row.script || "").trim();
		if (!text) return 0;
		return text.split(/\s+/).filter(Boolean).length;
	}

	function batchRowReadyForGeneration(row) {

		if (
			!row ||
			!batchRowHasScript(row) ||
			batchRowWordCount(row) < WORD_COUNT_MIN ||
			row.running ||
			row.retrying ||
			row.stopRequested ||
			row._recoveringMedia ||
			batchRowBusy(row)
		) {
			return false;
		}
		if (batchRowTimelinePendingRegen(row)) {
			return (
				BATCH_GENERATABLE_STAGES.indexOf(row.stage) !== -1 ||
				row.stage === "done"
			);
		}
		/*
		 * Session 331 (regenerate fix): a row whose action buttons are NOT live
		 * can always be generated again. A row that finished in this browser
		 * is live and stays out of the queue; a row that is "done" but has no
		 * media in memory (a finished row restored after a reload) is not, and
		 * it must not be left stuck with disabled buttons and a blocked Generate.
		 */
		return (
			!batchRowFinished(row) &&
			(
				BATCH_GENERATABLE_STAGES.indexOf(row.stage) !== -1 ||
				row.stage === "done"
			)
		);

	}

	function batchRowPending(row) {
		return batchRowReadyForGeneration(row);
	}

	function syncBatchRowsFromDom() {

		for (const row of batchRows) {

			if (!row || row.running) {
				continue;
			}

			const tr =
				document.querySelector('[data-batch-row="' + row.id + '"]');

			if (!tr) {
				continue;
			}

			const scriptEl =
				tr.querySelector('[data-batch-field="script"]');

			if (
				scriptEl &&
				!batchRowHasScript(row) &&
				String(scriptEl.value || "").trim().length > 0
			) {

				row.script =
					String(scriptEl.value || "");

				if (row.stage === "empty") {
					row.stage = "ready";
					paintBatchRowStatus(row);
				}

			}

			const styleEl =
				tr.querySelector('[data-batch-field="style"]');

			if (styleEl && styleEl._batchTouched) {

				syncBatchRowInput(row, "style", styleEl, true);

			}

			/*
			 * Session 331 follow-up: the Min column is not rendered, so this lookup
			 * normally finds nothing. It is kept so a page that still has an older
			 * table markup (a cached client bundle) cannot lose a typed value.
			 */
			const minutesEl =
				tr.querySelector('[data-batch-field="minutes"]');

			if (minutesEl && minutesEl._batchTouched) {

				syncBatchRowInput(row, "minutes", minutesEl, true);

			}

			const resEl =
				tr.querySelector('[data-batch-field="resolution"]');

			if (resEl && resEl._batchTouched) {

				syncBatchRowInput(row, "resolution", resEl, true);

			}

			const orientEl =
				tr.querySelector('[data-batch-field="orientation"]');

			if (orientEl && orientEl._batchTouched) {

				syncBatchRowInput(row, "orientation", orientEl, true);

			}

		}

	}

	/*
	 * Session 331, section 15: the Edit handoff carries the LIVE row values.
	 *
	 * syncBatchRowsFromDom() above only copies a control that was flagged
	 * touched, and the Edit button itself fires no change event. Pressing the
	 * edit icon therefore reads that row's current controls first, so the
	 * video style the user sees in the row is the style that lands in the
	 * project detail and in the timeline editor's project state.
	 */
	function syncBatchRowFromDom(row) {

		if (!row) {

			return null;

		}

		const tr =
			document.querySelector('[data-batch-row="' + row.id + '"]');

		if (!tr) {

			return row;

		}

		/*
		 * Only the script and the video style are re-read here. Those two are the
		 * handoff's text and visual treatment; the frame controls already commit
		 * on "change", and re-reading them would normalise a value the table
		 * never displayed (for example a model value of "720p" that the select
		 * renders as 1024 px).
		 */
		for (const field of ["script", "style"]) {

			const element =
				tr.querySelector('[data-batch-field="' + field + '"]');

			if (!element) {

				continue;

			}

			element._batchTouched =
				true;

			syncBatchRowInput(row, field, element, true);

		}

		return row;

	}

	async function generateBatchRows() {

		if (batchRunBusy) {

			return;

		}

		syncBatchRowsFromDom();

		const scripted =
			batchRows.filter(batchRowHasScript);

		if (!scripted.length) {

			showRequiredModal([
				"No row has a script yet - type or paste one in column 1 first."
			]);

			return;

		}

		/*
		 * Check for rows with script but < 50 words
		 */
		const insufficientWords = scripted.filter(function (row) {
			return batchRowWordCount(row) > 0 && batchRowWordCount(row) < WORD_COUNT_MIN;
		});

		if (insufficientWords.length > 0) {
			const rowIds = insufficientWords.map(function (r) { return r.id; }).join(", ");
			const counts = insufficientWords.map(function (r) { return batchRowWordCount(r); });
			showRequiredModal([
				"Generate skipped: Row(s) " + rowIds + " script is less than " + WORD_COUNT_MIN + " words (currently " + counts.join(", ") + " words). Please expand the script to at least " + WORD_COUNT_MIN + " words.",
				"Rows with sufficient words and Ready stage will still proceed if any exist."
			]);
			// Filter out insufficient words from targets later, but we can also just let the filter handle it
			// and show this warning if targets are empty or if we want to block specific rows.
			// The requirement says "skip generating it" and "make error message".
		}

		/*
		 * Session #211: a finished row is NEVER generated again. Its two
		 * live buttons (Preview / Export) are the proof that its MP3, its
		 * images and its animation are already in memory, so re-running it
		 * would only re-bill the credits and throw the animation away.
		 */
		const targets =
			batchRows.filter(batchRowReadyForGeneration);

		if (!targets.length) {

			const unfinished =
				scripted.filter(function (row) { return !batchRowFinished(row); });

			if (!unfinished.length) {
				showRequiredModal([
					"Every row with a script is already finished - its Preview and Export buttons are live. Add a row, or clear a finished row's script, to generate again."
				]);
			} else {
				showRequiredModal([
					"Generate starts only rows marked Ready. Staged, running, retrying, stopped or unfinished rows are left unchanged.",
					"Wait for staged rows to settle or reset their stage before generating."
				]);
			}

			return;

		}

		/*
		 * Session #248: Three rows process simultaneously in the early pipeline
		 * (BATCH_RUN_CONCURRENCY = 3). When a running row moves to the next step
		 * of processing (stage 'images' / image generation), startUnprocessedRows()
		 * starts the next unprocessed row from batchQueue immediately, so the
		 * 4th and subsequent rows start processing early steps without waiting
		 * for earlier rows to reach 'done'.
		 */
		batchRunBusy =
			true;

		batchQueue =
			targets.slice();

		batchAttemptedRows.clear();

		batchFinishedCount =
			0;

		batchActivePromises.clear();

		renderBatchTable();

		const initialConcurrency =
			Math.max(
				1,
				Math.min(BATCH_RUN_CONCURRENCY, targets.length)
			);

		/* Start the first wave of rows (up to 3) */
		startUnprocessedRows();

		/* Await all active row pipelines and their queued successors */
		while (batchActivePromises.size > 0) {

			await Promise.all(
				Array.from(batchActivePromises)
			);

		}

		batchRunBusy =
			false;

		renderBatchTable();

		console.info("[batch-table] generate pass done", {
			requested: targets.length,
			finished: batchFinishedCount,
			concurrency: initialConcurrency
		});

	}

	/*
	 * Session #248: start unprocessed rows when a row moves to the next step
	 * of processing (ex. image generation) or when early pipeline capacity opens.
	 *
	 * Rule: up to BATCH_RUN_CONCURRENCY (3) rows can process in the early pipeline
	 * steps (voice, timing, prompts) simultaneously. When a row moves to the next
	 * step of processing (stage 'images' / image generation, or beyond), it vacates
	 * its early-pipeline slot. startUnprocessedRows() pulls the next unprocessed
	 * row from the queue so 4th and subsequent rows start processing early steps
	 * instead of waiting for the first 3 rows to completely finish the entire
	 * pipeline (images + animate).
	 */
	function startUnprocessedRows(activeRow) {

		if (batchStartingRows) {

			return;

		}

		batchStartingRows =
			true;

		try {

			return startUnprocessedRowsBody(activeRow);

		} finally {

			batchStartingRows =
				false;

		}

	}

	function startUnprocessedRowsBody(activeRow) {

		if (!batchRunBusy) {

			return;

		}

		/* If batchQueue is empty but a run is active, harvest any newly-added pending rows that have not run in this pass */
		if (!batchQueue.length) {

			const unqueued =
				batchRows.filter(function (r) {
					return batchRowPending(r) && !batchAttemptedRows.has(String(r.id));
				});

			if (unqueued.length) {
				batchQueue.push.apply(batchQueue, unqueued);
			}

		}

		/*
		 * How many rows are currently in early pipeline steps?
		 * A row is in early pipeline if it is running and has NOT moved to
		 * 'images', 'animate' or 'done'.
		 * If activeRow is passed (indicating it is currently transitioning to
		 * the next step of processing, e.g. image generation), it is excluded
		 * from earlyCount.
		 */
		const earlyCount =
			batchRows.filter(function (r) {

				if (!r || !r.running) {
					return false;
				}

				if (activeRow && String(r.id) === String(activeRow.id)) {
					return false;
				}

				return (
					r.stage !== "images" &&
					r.stage !== "animate" &&
					r.stage !== "done"
				);

			}).length;

		const availableSlots =
			Math.max(
				0,
				BATCH_RUN_CONCURRENCY - earlyCount
			);

		for (let i = 0; i < availableSlots; i++) {

			if (!batchQueue.length || !batchRunBusy) {
				break;
			}

			const row =
				batchQueue.shift();

			if (!row || row.running || (!batchRowTimelinePendingRegen(row) && batchRowFinished(row)) || batchAttemptedRows.has(String(row.id))) {
				continue;
			}

			batchAttemptedRows.add(String(row.id));

			row.running =
				true;

			const promise = (async function (targetRow) {

				try {

					if (await runBatchRow(targetRow)) {

						batchFinishedCount += 1;

					}

				}
				finally {

					targetRow.running =
						false;

					batchActivePromises.delete(promise);

					/*
					 * When a row completes or exits, check if any remaining
					 * unprocessed rows can be started.
					 */
					startUnprocessedRows();

				}

			})(row);

			batchActivePromises.add(promise);

		}

	}

	const startUnprocessedBatchRows =
		startUnprocessedRows;

	function stopBatchRows() {

		batchRunBusy =
			false;

		batchQueue =
			[];

		batchAttemptedRows.clear();

		for (const row of batchRows) {

			/*
			 * Session #244: a stop is a decision, not an error. The row
			 * is marked FIRST, so the aborted fetch is reported as a
			 * stop and never retried or rendered as an abort message.
			 */
			row.stopRequested =
				true;

			cancelScriptWriteRetryWait(row);

			row.retrying =
				false;

			if (row._promptOwner && row._promptOwner.controller) {
				row._promptOwner.controller.abort();
			}

			if (row.controller) {

				try {
					row.controller.abort();
				}
				catch (abortError) { }

			}

		}

		appImageStreamQueue.cancelMatching(function (meta) {
			return Boolean(meta && meta.kind === "batch-row");
		}, "The row was stopped");

		renderBatchTable();

	}

	/* ---------------- the row preview player ---------------- */

	function batchPreviewModalId() {
		return "batch-preview-modal";
	}

	function paintTimelineVisualElements(context, elements, seconds, width, height, activeSlide, isRenderedTemplateVideo) {
		if (!context || !Array.isArray(elements) || !elements.length) return 0;
		let painted = 0;
		const scale = Math.max(1, height / 720);
		for (let i = 0; i < elements.length; i++) {
			const item = elements[i];
			if (!item || item.visible === false) continue;
			const startSec = pipelineManagementNumber(item.startSec != null ? item.startSec : item.s, 0);
			const durSec = pipelineManagementNumber(item.durationSec != null ? item.durationSec : item.d, 0);
			if (!(seconds >= startSec && seconds < startSec + durSec)) continue;
			const parentId = String(item.parentId != null ? item.parentId : (item.pId || ""));
			const baked = Boolean(item.bakedInTemplateClip || item.bk);
			if (isRenderedTemplateVideo && baked && activeSlide && String(activeSlide.id || "") === parentId) continue;
			const isGraphic = item.kind === "graphic" || item.k === "g";
			if (isGraphic) {
				const x = width * (pipelineManagementNumber(item.x, 50) / 100);
				const y = height * (pipelineManagementNumber(item.y, 50) / 100);
				const rawSize = item.size != null ? item.size : item.sz;
				const size = Math.max(8, pipelineManagementNumber(rawSize, 72) * scale);
				const shape = String(item.graphic || item.gr || "circle");
				const rot = pipelineManagementNumber(item.rotation != null ? item.rotation : item.rot, 0);
				context.save();
				if (typeof context.translate === "function") context.translate(x, y);
				if (rot && typeof context.rotate === "function") context.rotate(rot * Math.PI / 180);
				context.fillStyle = String(item.color || item.c || "#7aac2b");
				if (shape === "square" && typeof context.fillRect === "function") {
					context.fillRect(-size / 2, -size / 2, size, size);
				} else if (shape === "triangle" && typeof context.beginPath === "function") {
					context.beginPath();
					context.moveTo(0, -size / 2);
					context.lineTo(size / 2, size / 2);
					context.lineTo(-size / 2, size / 2);
					context.closePath();
					context.fill();
				} else if (shape === "star" && typeof context.beginPath === "function") {
					context.beginPath();
					for (let n = 0; n < 10; n++) {
						const radius = n % 2 ? size * 0.22 : size * 0.5;
						const angle = -Math.PI / 2 + n * Math.PI / 5;
						if (!n) context.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
						else context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
					}
					context.closePath();
					context.fill();
				} else if (shape === "heart" && typeof context.fillText === "function") {
					context.font = size + "px serif";
					context.textAlign = "center";
					context.textBaseline = "middle";
					context.fillText("\u2665", 0, 0);
				} else if (shape === "arrow" && typeof context.beginPath === "function") {
					context.beginPath();
					context.moveTo(-size / 2, -size / 6);
					context.lineTo(size / 6, -size / 6);
					context.lineTo(size / 6, -size / 3);
					context.lineTo(size / 2, 0);
					context.lineTo(size / 6, size / 3);
					context.lineTo(size / 6, size / 6);
					context.lineTo(-size / 2, size / 6);
					context.closePath();
					context.fill();
				} else if (typeof context.beginPath === "function" && typeof context.arc === "function") {
					context.beginPath();
					context.arc(0, 0, size / 2, 0, Math.PI * 2);
					context.fill();
				}
				context.restore();
				painted += 1;
			} else {
				const text = String(item.text != null ? item.text : (item.tx || ""));
				if (!text) continue;
				const rawFont = item.fontSize != null && Number(item.fontSize) > 0 ? item.fontSize : (item.size != null ? item.size : item.sz);
				const fontSize = Math.max(10, pipelineManagementNumber(rawFont, 28) * scale);
				const fontKey = String(item.font || item.fn || "sans");
				const family = fontKey === "serif" ? "Georgia, serif" : fontKey === "mono" ? "monospace" : "system-ui, sans-serif";
				context.save();
				context.fillStyle = String(item.color || item.c || "#ffffff");
				context.textAlign = String(item.align || item.al || "center");
				context.textBaseline = "middle";
				context.font = "700 " + Math.round(fontSize) + "px " + family;
				const x = width * (pipelineManagementNumber(item.x, 50) / 100);
				const y = height * (pipelineManagementNumber(item.y, 78) / 100);
				const lines = text.split("\\n").slice(0, 8);
				const lineHeight = fontSize * 1.2;
				for (let li = 0; li < lines.length; li++) {
					if (typeof context.fillText === "function") {
						context.fillText(lines[li], x, y + (li - (lines.length - 1) / 2) * lineHeight, width * 0.88);
					}
				}
				context.restore();
				painted += 1;
			}
		}
		return painted;
	}

	function resolveBatchRowTimelineElements(row) {
		if (!row || !row.timelineEdited) return [];
		if (row.projectDetail && Array.isArray(row.projectDetail.elements) && row.projectDetail.elements.length) {
			return row.projectDetail.elements;
		}
		const detail = composeBatchProjectDetail(row);
		if (detail) {
			row.projectDetail = detail;
			if (Array.isArray(detail.elements)) return detail.elements;
		}
		return row.timeline && Array.isArray(row.timeline.visuals) ? row.timeline.visuals : [];
	}

	function resolveBatchRowTimelineAudios(row) {
		if (!row || !row.timelineEdited) return null;
		const regenAt = Number(row._timelineRegeneratedAt) || 0;
		const fullState = readTimelineEditorStateForRow(row);
		if (fullState && (!regenAt || Number(fullState.updatedAt || 0) > regenAt) && Array.isArray(fullState.tracks)) {
			const list = [];
			fullState.tracks.forEach(function (track) {
				if (!track || track.kind !== "audio" || !Array.isArray(track.items)) return;
				track.items.forEach(function (item) {
					if (!item) return;
					list.push({
						id: String(item.id || ""),
						trId: String(track.id || ""),
						a: String(item.assetId || ""),
						s: pipelineManagementNumber(item.startSec, 0),
						d: pipelineManagementNumber(item.durationSec, 0),
						vol: pipelineManagementNumber(item.volume, 1),
						m: item.muted ? 1 : 0
					});
				});
			});
			return list;
		}
		if (row.timeline && Array.isArray(row.timeline.audios)) {
			return row.timeline.audios;
		}
		return null;
	}

	function closeBatchPreview() {

		if (batchPreview) {

			if (batchPreview.raf && typeof cancelAnimationFrame === "function") {

				cancelAnimationFrame(
					batchPreview.raf
				);

			}

			if (batchPreview.audio) {

				try {
					batchPreview.audio.pause();
				}
				catch (pauseError) { }

			}

			if (batchPreview.extraAudios) {
				Object.keys(batchPreview.extraAudios).forEach(function (key) {
					try { batchPreview.extraAudios[key].pause(); } catch (pauseErr) { }
				});
			}

			if (batchPreview.row && Array.isArray(batchPreview.row.slides)) {
				batchPreview.row.slides.forEach(function (s) {
					if (s && s.videoEl) {
						try { s.videoEl.pause(); } catch (vidErr) { }
					}
				});
			}

			batchPreview =
				null;

		}

		closeModal(
			document.getElementById(
				batchPreviewModalId()
			)
		);

	}

	function openBatchPreview(id) {

			try { reconcileTimelineEdits(); } catch (reconcileErr) { }

			const row =
				getBatchRow(id);

			if (!row) {

				return;

			}

			/* Requirement 1 (Session 331): Sync preview/export to timeline editor state */
			if (row.timelineEdited) {
				applyTimelineEditToBatchRow(row);
				/* Ensure projectDetail and slideItems are fully reconciled from timeline */
				if (row.timeline && Array.isArray(row.timeline.sceneItems)) {
					row.projectDetail = row.projectDetail || {};
					row.projectDetail.scenes = row.timeline.sceneItems;
					row.slideItems = row.timeline.sceneItems;
				}
			} else if (!row.projectDetail) {
				row.projectDetail = composeBatchProjectDetail(row);
			}

			if (!batchRowFinished(row)) {

				setBatchStage(
					row,
					row.stage,
					"Preview unlocks when the row is finished"
				);

				return;

			}

		closeBatchPreview();

		/* The preview paints the row's own frame (edited timeline frame or resolution + orientation). */
		const pdFrame = row.timelineEdited && row.projectDetail && row.projectDetail.frame &&
			Number(row.projectDetail.frame.width) > 0 && Number(row.projectDetail.frame.height) > 0
			? row.projectDetail.frame
			: null;
		const frame = pdFrame
			? { width: Number(pdFrame.width), height: Number(pdFrame.height) }
			: batchRowDimensions(row);

		const modal =
			document.createElement(
				"div"
			);

		modal.id =
			batchPreviewModalId();

		modal.className =
			"modal-overlay batch-preview-overlay";

		modal.setAttribute(
			"data-dismiss",
			"closeBatchPreview"
		);

		modal.innerHTML =
			'<div class="modal-box batch-preview-box">' +
				'<div class="modal-title">\u25b6 Preview \u2014 Row ' + escapeHTML(String(row.id)) + "</div>" +
				'<canvas id="batch-preview-canvas" class="batch-preview-canvas" width="' + frame.width + '" height="' + frame.height + '"></canvas>' +
				'<div class="batch-preview-bar">' +
					'<button type="button" class="upload-btn small" data-batch-preview="toggle">\u23f8 Pause</button>' +
					'<button type="button" class="upload-btn small" data-batch-preview="restart">\u21ba Restart</button>' +
					'<span class="va-note" id="batch-preview-time">0:00</span>' +
				"</div>" +
				'<div class="va-note batch-preview-note">The narration and the burned-in subtitles of this row, exactly as the export will paint them. Nothing is uploaded - the MP4 is only built when you press Export.</div>' +
				'<div class="seo-wt-actions">' +
					'<button type="button" class="upload-btn small" onclick="exportBatchRow(' + row.id + ')">\u2b07 Export Video</button>' +
					'<button type="button" class="upload-btn small" data-batch-preview="close">\u2715 Close</button>' +
				"</div>" +
			"</div>";

		openModal(
			modal
		);

		const canvas =
			modal.querySelector(
				"#batch-preview-canvas"
			);

		const context =
			canvas && typeof canvas.getContext === "function"
				? canvas.getContext("2d")
				: null;

		const audio =
			typeof Audio === "function"
				? (row.mp3Url ? new Audio(row.mp3Url) : new Audio())
				: null;

		if (audio) {

			audio.addEventListener(
				"ended",
				function () {

					if (batchPreview && !row.timelineEdited) {
						batchPreview.playing = false;
					}

				}
			);

		}

		const timelineAudios = resolveBatchRowTimelineAudios(row);
		const voiceoverClip = timelineAudios
			? timelineAudios.find(function (item) { return item && (item.a === "voiceover" || item.trId === "voiceover"); }) || null
			: null;
		const voiceoverDisabled = Boolean(timelineAudios && (!voiceoverClip || Number(voiceoverClip.m) === 1));

		batchPreview = {
			row: row,
			modal: modal,
			canvas: canvas,
			context: context,
			audio: audio,
			extraAudios: Object.create(null),
			timelineAudios: timelineAudios,
			voiceoverClip: voiceoverClip,
			playing: Boolean(row.timelineEdited || (audio && row.mp3Url)),
			startedAt: Date.now(),
			pausedAtMs: 0,
			manualMs: 0,
			raf: 0
		};

		if (audio && row.mp3Url && !voiceoverDisabled && (!voiceoverClip || !(Number(voiceoverClip.s) > 0))) {
			if (voiceoverClip) {
				audio.volume = Math.max(0, Math.min(1, pipelineManagementNumber(voiceoverClip.vol, 1)));
			}
			batchPreviewPlay(audio);
		}

		if (
			batchRowNeedsTimelineAssetHydration(row) &&
			typeof hydrateBatchRowAssetsFromTimeline === "function"
		) {
			hydrateBatchRowAssetsFromTimeline(row).then(function (ok) {
				if (ok && batchPreview && batchPreview.row === row) {
					if (batchPreview.audio && row.mp3Url && !batchPreview.audio.src) {
						batchPreview.audio.src = row.mp3Url;
						if (!voiceoverDisabled && batchPreview.playing) batchPreviewPlay(batchPreview.audio);
					}
					try { batchPreviewTick(); } catch (tickErr) { }
				}
			});
		}

		modal.addEventListener(
			"click",
			function (event) {

				const target =
					event.target && event.target.closest
						? event.target.closest("[data-batch-preview]")
						: null;

				if (!target) {

					/* A click on the dimmed backdrop puts the player away. */
					if (event.target === modal) {

						closeBatchPreview();

					}

					return;

				}

				const action =
					target.getAttribute(
						"data-batch-preview"
					);

				if (action === "toggle") {

					batchPreviewToggle();

					target.textContent =
						batchPreview && batchPreview.playing
							? "\u23f8 Pause"
							: "\u25b6 Play";

					return;

				}

				if (action === "restart") {

					batchPreviewRestart();

					return;

				}

				closeBatchPreview();

			}
		);

		batchPreviewTick();

	}

	function batchPreviewTimeMs() {

		if (!batchPreview) return 0;

		if (batchPreview.row && batchPreview.row.timelineEdited) {
			if (!batchPreview.playing) {
				return batchPreview.manualMs;
			}
			const vo = batchPreview.voiceoverClip;
			const useAudioClock = Boolean(
				batchPreview.audio &&
				!batchPreview.audio.paused &&
				Number.isFinite(batchPreview.audio.currentTime) &&
				batchPreview.audio.currentTime > 0 &&
				(!batchPreview.timelineAudios || (vo && !Number(vo.m) && !(Number(vo.s) > 0)))
			);
			if (useAudioClock) {
				return batchPreview.audio.currentTime * 1000;
			}
			if (batchPreview.manualMs > 0 && !(batchPreview.startedAt > 0)) {
				return batchPreview.manualMs;
			}
			return Math.max(0, (batchPreview.pausedAtMs || 0) + Math.max(0, Date.now() - (batchPreview.startedAt || Date.now())));
		}

		if (
			batchPreview.audio &&
			Number.isFinite(batchPreview.audio.currentTime)
		) {

			return batchPreview.audio.currentTime * 1000;

		}

		return batchPreview.manualMs;

	}

	function syncBatchPreviewTimelineAudios(localSeconds) {
		if (!batchPreview || !batchPreview.row || !batchPreview.row.timelineEdited) return;
		const audios = batchPreview.timelineAudios;
		if (!Array.isArray(audios)) return;
		const row = batchPreview.row;
		const urlMap = row._timelineAudioUrls || {};
		audios.forEach(function (clip) {
			if (!clip) return;
			const startSec = pipelineManagementNumber(clip.s, 0);
			const durSec = pipelineManagementNumber(clip.d, 0);
			const inRange = localSeconds >= startSec && localSeconds < startSec + durSec;
			const isVo = clip.a === "voiceover" || clip.trId === "voiceover";
			const audioEl = isVo ? batchPreview.audio : (batchPreview.extraAudios[clip.id] || null);
			let targetAudio = audioEl;
			if (!targetAudio && !isVo && clip.a && urlMap[clip.a] && typeof Audio === "function") {
				targetAudio = new Audio(urlMap[clip.a]);
				batchPreview.extraAudios[clip.id] = targetAudio;
			}
			if (!targetAudio) return;
			targetAudio.volume = Number(clip.m) === 1 ? 0 : Math.max(0, Math.min(1, pipelineManagementNumber(clip.vol, 1)));
			if (batchPreview.playing && inRange && Number(clip.m) !== 1) {
				const offset = Math.max(0, localSeconds - startSec);
				if (Math.abs(pipelineManagementNumber(targetAudio.currentTime, 0) - offset) > 0.35) {
					try { targetAudio.currentTime = offset; } catch (seekErr) { }
				}
				if (targetAudio.paused) batchPreviewPlay(targetAudio);
			} else {
				try { targetAudio.pause(); } catch (pauseErr) { }
			}
		});
	}

	function batchPreviewTick() {

		if (!batchPreview) {
			return;
		}

		const row =
			batchPreview.row;

		const context =
			batchPreview.context;

		if (context && row && row.slides.length) {

			const width =
				batchPreview.canvas.width || 1024;

			const height =
				batchPreview.canvas.height || 576;

			const timestampMs =
				batchPreviewTimeMs();

			const durations = row.slides.map(function (slide) { return slideDurationSec(slide); });
			const slidesSum = durations.reduce(function (sum, seconds) { return sum + seconds; }, 0);
			const editedTotal = row.timelineEdited
				? (Number(row.timelineDurationSec) || Number(row.projectDetail && row.projectDetail.durationSec) || slidesSum)
				: slidesSum;
			const totalSeconds = editedTotal > 0 ? editedTotal : slidesSum;
			let localSeconds = 0;
			if (row.timelineEdited) {
				const rawSec = Math.max(0, timestampMs / 1000);
				if (totalSeconds > 0 && rawSec >= totalSeconds && batchPreview.playing) {
					localSeconds = Math.max(0, totalSeconds - 0.001);
					batchPreview.playing = false;
					batchPreview.manualMs = totalSeconds * 1000;
					if (batchPreview.audio) { try { batchPreview.audio.pause(); } catch (e) { } }
				} else {
					localSeconds = totalSeconds > 0 ? Math.min(rawSec, Math.max(0, totalSeconds - 0.001)) : rawSec;
				}
				syncBatchPreviewTimelineAudios(localSeconds);
			} else {
				localSeconds = totalSeconds > 0 ? timestampMs / 1000 % totalSeconds : 0;
			}

			let index = 0, sceneStart = 0, slide = null, slideDur = 1;
			if (row.timelineEdited && row.slides.some(function (s) { return s && s.startSec != null; })) {
				let cursor = 0;
				for (let si = 0; si < row.slides.length; si++) {
					const candidate = row.slides[si];
					const cDur = durations[si] || 1;
					const cStart = candidate && candidate.startSec != null ? Math.max(0, Number(candidate.startSec) || 0) : cursor;
					cursor = cStart + cDur;
					if (localSeconds >= cStart && localSeconds < cStart + cDur) {
						index = si;
						sceneStart = cStart;
						slide = candidate;
						slideDur = cDur;
						break;
					}
				}
			} else {
				while (index < row.slides.length - 1 && localSeconds >= sceneStart + durations[index]) {
					sceneStart += durations[index];
					index++;
				}
				slide = row.slides[index];
				slideDur = durations[index] || 1;
			}

			const phase = slide ? Math.max(0, Math.min(1, (localSeconds - sceneStart) / Math.max(0.001, slideDur))) : 0;
			const slideVisible = Boolean(slide && slide.visible !== false);
			if (slideVisible && slide.type === "mp4" && slide.videoEl && !slide.videoEl.seeking) {
				const trimOffset = row.timelineEdited ? Math.max(0, Number(slide.trimStartSec) || 0) : 0;
				const rawTarget = Math.max(0, localSeconds - sceneStart) + trimOffset;
				const mediaDur = Number.isFinite(slide.videoEl.duration) && slide.videoEl.duration > 0
					? slide.videoEl.duration
					: (Number(slide.duration) > 0 ? Number(slide.duration) : slideDur);
				const targetTime = mediaDur > 0
					? Math.min(rawTarget % mediaDur, Math.max(0, mediaDur - 0.001))
					: rawTarget;
				if (Math.abs(slide.videoEl.currentTime - targetTime) > 0.1) { try { slide.videoEl.currentTime = targetTime; } catch (_) {} }
			}

			const isTplSlide = Boolean(row.timelineEdited && slide && slide.isTemplateScene);
			const fitMode = row.timelineEdited && slide && slide.fit === "contain" ? "contain" : "cover";
			const zoom = (isTplSlide || fitMode === "contain") ? 1 : (1 + 0.08 * phase);
			const activeStyle = String((row.timelineEdited && slide && slide.videoStyle) || row.style || "Cinematic Film");

			context.fillStyle = row.timelineEdited ? "#08090c" : "#000000";

			context.fillRect(
				0,
				0,
				width,
				height
			);

			let drawnMedia = false;
			if (
				slideVisible &&
				slide.img &&
				(slide.img.naturalWidth || slide.img.videoWidth) && (slide.type !== "mp4" || (slide.videoEl && slide.videoEl.readyState >= 2))
			) {

				const sourceWidth =
					slide.img.naturalWidth || slide.img.videoWidth;

				const sourceHeight =
					slide.img.naturalHeight || slide.img.videoHeight;

				const scaleFactor = fitMode === "contain"
					? Math.min(width / sourceWidth, height / sourceHeight)
					: Math.max((width * zoom) / sourceWidth, (height * zoom) / sourceHeight);

				const drawWidth =
					sourceWidth * scaleFactor;

				const drawHeight =
					sourceHeight * scaleFactor;

				context.save();
				const isRenderedTplVideo = Boolean(isTplSlide && slide.type === "mp4");
				if (!isRenderedTplVideo && "filter" in context) {
					context.filter = window.__videoStyleFilter(activeStyle);
				}
				context.drawImage(
					slide.img,
					(width - drawWidth) / 2,
					(height - drawHeight) / 2,
					drawWidth,
					drawHeight
				);
				context.restore();
				drawnMedia = true;

			}

			/*
			 * Template-modal treatments for the row/scene style, skipping rendered
			 * template video clips whose effects were already baked at render time.
			 */
			const skipStyleEffects = Boolean(drawnMedia && isTplSlide && slide && slide.type === "mp4");
			if (!skipStyleEffects && window.__paintVideoStyleEffects) {

				window.__paintVideoStyleEffects(
					context,
					width,
					height,
					localSeconds,
					activeStyle
				);

			}

			if (row.timelineEdited) {
				const elements = resolveBatchRowTimelineElements(row);
				if (elements.length) {
					paintTimelineVisualElements(
						context,
						elements,
						localSeconds,
						width,
						height,
						slide,
						Boolean(drawnMedia && isTplSlide && slide && slide.type === "mp4")
					);
				}
			}

			if (
				row.subtitles &&
				row.subtitles.length
			) {

				drawSubtitles(
					context,
					row.subtitles,
					row.timelineEdited ? localSeconds * 1000 : timestampMs,
					width,
					height
				);

			}

			const timeEl =
				document.getElementById(
					"batch-preview-time"
				);

			if (timeEl) {

				timeEl.textContent =
					formatSeconds((row.timelineEdited ? localSeconds : timestampMs / 1000)) +
					" \u00b7 slide " +
					(index + 1) +
					"/" +
					row.slides.length +
					" \u00b7 " +
					activeStyle;

			}

		}

		if (batchPreview) {

			batchPreview.raf =
				typeof requestAnimationFrame === "function"
					? requestAnimationFrame(batchPreviewTick)
					: 0;

			if (!batchPreview.playing && !row.timelineEdited) {

				batchPreview.manualMs +=
					33;

			}

		}

	}

	function batchPreviewToggle() {

		if (!batchPreview) {
			return;
		}

		if (batchPreview.playing) {

			const nowMs = batchPreviewTimeMs();
			batchPreview.pausedAtMs = nowMs;
			batchPreview.manualMs = nowMs;
			if (batchPreview.audio) batchPreview.audio.pause();
			if (batchPreview.extraAudios) {
				Object.keys(batchPreview.extraAudios).forEach(function (k) {
					try { batchPreview.extraAudios[k].pause(); } catch (e) { }
				});
			}
			batchPreview.playing = false;

		}
		else {

			batchPreview.startedAt = Date.now();
			batchPreview.pausedAtMs = batchPreview.manualMs || 0;
			if (batchPreview.audio && (!batchPreview.row || !batchPreview.row.timelineEdited)) {
				batchPreviewPlay(batchPreview.audio);
			}
			batchPreview.playing = true;

		}

	}

	function batchPreviewRestart() {

		if (!batchPreview) {
			return;
		}

		if (batchPreview.audio) {

			batchPreview.audio.currentTime = 0;
			if (batchPreview.playing && (!batchPreview.row || !batchPreview.row.timelineEdited)) {
				batchPreviewPlay(batchPreview.audio);
			}

		}

		if (batchPreview.extraAudios) {
			Object.keys(batchPreview.extraAudios).forEach(function (k) {
				try { batchPreview.extraAudios[k].currentTime = 0; } catch (e) { }
			});
		}

		batchPreview.startedAt = Date.now();
		batchPreview.pausedAtMs = 0;
		batchPreview.manualMs = 0;
		batchPreview.playing = true;

	}

	function batchPreviewSeek(seconds) {
		if (!batchPreview) return;
		const ms = Math.max(0, (Number(seconds) || 0) * 1000);
		batchPreview.startedAt = Date.now();
		batchPreview.pausedAtMs = ms;
		batchPreview.manualMs = ms;
		if (batchPreview.audio) {
			try { batchPreview.audio.currentTime = ms / 1000; } catch (e) { }
		}
	}

	/* ---------------- client-side export of one row ---------------- */

	async function exportBatchRow(id) {

		const row =
			getBatchRow(id);

		if (!row) {

			return;

		}

		/* Requirement 1 (Session 331): Sync preview/export to timeline editor state */
		if (row.timelineEdited) {
			applyTimelineEditToBatchRow(row);
			/* Ensure projectDetail and slideItems are fully reconciled from timeline */
			if (row.timeline && Array.isArray(row.timeline.sceneItems)) {
				row.projectDetail = row.projectDetail || {};
				row.projectDetail.scenes = row.timeline.sceneItems;
				row.slideItems = row.timeline.sceneItems;
			}
		} else if (!row.projectDetail) {
			row.projectDetail = composeBatchProjectDetail(row);
		}

		if (!batchRowFinished(row)) {

			setBatchStage(
				row,
				row.stage,
				"Export unlocks when the row is finished"
			);

			return;

		}

		if (batchRenderBusy || generating || window.__workerMode) {

			setBatchStage(
				row,
				"done",
				"Another video is still being rendered"
			);

			return;

		}

		/*
		 * The row borrows the shared renderer - the same hidden working
		 * state the bulk queue uses - and gives it back afterwards. The
		 * MP4 is written by this browser: nothing is uploaded and no
		 * second machine is needed.
		 */
		batchRenderBusy =
			true;

		const saved = {
			slides:
				activeSlides.slice(),
			audio:
				currentAudio,
			captions:
				[],
			title:
				titleInputEl ? titleInputEl.value : "",
			workerMode:
				!!window.__workerMode
		};

		if (captionRowsEl) {

			while (captionRowsEl.children.length) {

				saved.captions.push(
					captionRowsEl.children[0]
				);

				captionRowsEl.removeChild(
					captionRowsEl.children[0]
				);

			}

		}

		const minutes =
			Number(row.minutes) > 0
				? Number(row.minutes)
				: BATCH_MIN_MINUTES;

		try { reconcileTimelineEdits(); } catch (reconcileErr) { }
		if (row.timelineEdited) {
			applyTimelineEditToBatchRow(row);
		} else if (!row.projectDetail) {
			row.projectDetail = composeBatchProjectDetail(row);
		}

		if (
			(!row.audio || batchRowNeedsTimelineAssetHydration(row)) &&
			typeof hydrateBatchRowAssetsFromTimeline === "function"
		) {
			try {
				await hydrateBatchRowAssetsFromTimeline(row);
				if (row.timelineEdited && (!Array.isArray(row.slides) || !row.slides.length)) {
					rebuildBatchSlidesFromItems(row);
				}
			} catch (hydrateErr) { }
		}

		const pdFrame = row.timelineEdited && row.projectDetail && row.projectDetail.frame &&
			Number(row.projectDetail.frame.width) > 0 && Number(row.projectDetail.frame.height) > 0
			? row.projectDetail.frame
			: null;
		const rowDims = pdFrame
			? { width: Number(pdFrame.width), height: Number(pdFrame.height) }
			: batchRowDimensions(row);
		const timelineAudios = resolveBatchRowTimelineAudios(row);
		const voClip = timelineAudios
			? timelineAudios.find(function (item) { return item && (item.a === "voiceover" || item.trId === "voiceover"); }) || null
			: null;
		const muteExportVoiceover = Boolean(row.timelineEdited && timelineAudios && (!voClip || Number(voClip.m) === 1));

		renderContext = {
			fileName:
				"YouTubeVibeStudio_Row" +
				row.id +
				"_" +
				batchRowTopic(row).replace(/[^A-Za-z0-9]+/g, "").slice(0, 28) +
				".mp4",
			subtitles:
				row.subtitles || [],
			frameWidth:
				rowDims.width,
			frameHeight:
				rowDims.height,
			videoStyle: row.style,
			timelineEdited: Boolean(row.timelineEdited),
			timelineDurationSec: Number(row.timelineDurationSec) || Number(row.projectDetail && row.projectDetail.durationSec) || 0,
			timelineElements: resolveBatchRowTimelineElements(row),
			batchRow:
				true
		};

		if (titleInputEl) {

			/* The table has no title column: no overlay text. */
			titleInputEl.value =
				"";

		}

		activeSlides.length =
			0;

		for (const slide of row.slides) {

			activeSlides.push(
				slide
			);

		}

		currentAudio = muteExportVoiceover ? null : row.audio;

		/* __workerMode keeps generateMP4 from auto-clicking its own link. */
		window.__workerMode =
			true;

		setBatchStage(
			row,
			"animate",
			"Rendering the MP4 in this browser"
		);

		try {

			window.__lastRenderBlob =
				null;

			await generateMP4();

			const blob =
				window.__lastRenderBlob;

			if (!blob) {

				throw new Error(
					"The renderer did not produce a file"
				);

			}

			downloadBatchBlob(
				renderContext.fileName,
				blob
			);

			setBatchStage(
				row,
				"done",
				"Exported \u00b7 " + Math.round(blob.size / 1024) + " KB"
			);

			/* Session 331: a successful export is archived for 24 h. */
			try { recordCompletedBatchRow(row, "export"); } catch (archiveError) { }

		}
		catch (renderError) {

			const message =
				renderError && renderError.message
					? renderError.message
					: String(renderError);

			console.error("[batch-table] row " + row.id + " export failed", message);

			setBatchStage(
				row,
				"error",
				"Export failed: " + message
			);

		}
		finally {

			activeSlides.length =
				0;

			for (const slide of saved.slides) {

				activeSlides.push(
					slide
				);

			}

			currentAudio =
				saved.audio;

			if (titleInputEl) {

				titleInputEl.value =
					saved.title;

			}

			if (captionRowsEl) {

				for (const node of saved.captions) {

					captionRowsEl.appendChild(
						node
					);

				}

			}

			window.__workerMode =
				saved.workerMode;

			renderContext =
				null;

			batchRenderBusy =
				false;

			const statusEl =
				document.getElementById(
					"status-text"
				);

			if (statusEl) {

				statusEl.textContent =
					"Quick batch table is idle";

			}

		}

	}

	function downloadBatchBlob(
		fileName,
		blob
	) {

		const url =
			createStudioObjectUrl(
				blob
			);

		const a =
			document.createElement(
				"a"
			);

		a.href =
			url;

		a.download =
			fileName;

		document.body.appendChild(
			a
		);

		a.click();

		a.remove();

		setTimeout(
			function () {
				releaseStudioObjectUrl(url);
			},
			2000
		);

	}

	/*
	 * RULE 25: clearing a finished row's script makes it runnable anew.
	 * Revoke its finished MP3/image object URLs, lock Preview/Export back
	 * to pending placeholders, and return the row to "empty".
	 */
	function resetClearedBatchRow(row) {

		if (!row || row.running) {
			return;
		}

		revokeBatchRow(row);
		try { purgeRowLocalAndCookieEntries(row); } catch (purgeError) { }

		row.mp3 =
			null;

		row.mp3Url =
			"";

		row.audio =
			null;

		row.prompts =
			[];

		row.images =
			[];

		row.slides =
			[];

		row.slideItems =
			[];

		row.subtitles =
			[];

		row.animated =
			false;

		row.timeline =
			null;

		row.timelineKey =
			"";

		row.timelineUpdatedAt =
			0;

		row.timelineEdited =
			false;

		row.timelineDurationSec =
			0;

		row.timelineSceneCount =
			0;

		row.projectDetail =
			null;

		row._storedFinished =
			false;

		row._storedImagesCount =
			0;

		row._storedSlidesCount =
			0;

		row._storedMp3 =
			false;

		row._storedAnimated =
			false;

		row._timelineRegeneratedAt =
			0;

		row.retrying =
			false;

		row.error =
			"";

		row.stage =
			"empty";

		row.detail =
			"";

		paintBatchRowStatus(row);

		const actions =
			document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="actions"]');

		if (actions) {

			actions.innerHTML =
				batchActionsHTML(row);

		}

		for (const kind of ["preview", "export"]) {

			const cell =
				document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="' + kind + '"]');

			if (cell) {

				cell.innerHTML =
					batchActionCell(row, kind);

			}

		}

		persistPipelineManagementState("row-cleared");

	}

	function syncBatchScriptStatus(row) {

		if (!row || row.running) {
			return;
		}

		if (
			!batchRowHasScript(row) &&
			(
				batchRowFinished(row) ||
				row.stage === "done" ||
				row.stage === "error" ||
				row.timeline ||
				row.timelineEdited ||
				row.timelineKey ||
				row.projectDetail ||
				row._storedFinished ||
				row._storedImagesCount
			)
		) {

			resetClearedBatchRow(row);

			updateBatchToolbar();

			return;

		}

		if (!batchRowHasScript(row)) {

			try { purgeRowLocalAndCookieEntries(row); } catch (purgeError) { }
			persistPipelineManagementState("blank-script");

		}

		if (row.stage === "empty" || row.stage === "ready") {

			row.stage =
				batchRowHasScript(row)
					? "ready"
					: "empty";

			row.detail =
				"";

			paintBatchRowStatus(row);

		}

		updateBatchToolbar();

	}

	/*
	 * Everything the table needs is delegated on the two containers, so
	 * rows added later are wired without re-binding: typing writes back
	 * to the row's state, and the action buttons in the last two cells
	 * are read from the row that owns them.
	 */
	function bindBatchTable() {

		if (batchTableBound) {

			return;

		}

		batchTableBound =
			true;

		const body =
			document.getElementById(
				"batch-rows"
			);

		if (body) {

			body.addEventListener(
				"input",
				function (event) {

					const target =
						event.target;

					if (!target || !target.getAttribute) {

						return;

					}

					const field =
						target.getAttribute(
							"data-batch-field"
						);

					if (!field) {

						return;

					}

					const tr =
						target.closest
							? target.closest("[data-batch-row]")
							: null;

					if (!tr) {

						return;

					}

					const row =
						getBatchRow(
							tr.getAttribute(
								"data-batch-row"
							)
						);

					if (!row) {

						return;

					}

					target._batchTouched =
						true;

					syncBatchRowInput(
						row,
						field,
						target,
						false
					);

					if (field === "script") {

						syncBatchScriptStatus(row);

					}

				}
			);

			/*
			 * Handle "change" across ALL row controls ('style', 'minutes',
			 * 'resolution', 'orientation', and 'script'), since <select>
			 * elements in Safari/WebKit and <input type="number"> blur/spin
			 * commits reliably fire "change".
			 */
			body.addEventListener(
				"change",
				function (event) {

					const target =
						event.target;

					if (!target || !target.getAttribute) {

						return;

					}

					const field =
						target.getAttribute(
							"data-batch-field"
						);

					if (!field) {

						return;

					}

					const tr =
						target.closest
							? target.closest("[data-batch-row]")
							: null;

					if (!tr) {

						return;

					}

					const row =
						getBatchRow(
							tr.getAttribute(
								"data-batch-row"
							)
						);

					if (row) {

						target._batchTouched =
							true;

						syncBatchRowInput(
							row,
							field,
							target,
							true
						);

						if (field === "script") {

							syncBatchScriptStatus(row);

						}

					}

				}
			);

			body.addEventListener(
				"click",
				function (event) {

					const target =
						event.target && event.target.closest
							? event.target.closest("[data-batch-action]")
							: null;

					if (!target) {

						return;

					}

					/*
					 * Session 332: a row that is not finished yet still renders
					 * all three icons, but disabled. A disabled button never
					 * fires a click in a browser; this guard keeps a synthetic
					 * dispatch (or an aria-disabled-only node) out too, so the
					 * cell is present and never clickable until the row is ready.
					 */
					if (
						target.disabled ||
						target.getAttribute(
							"aria-disabled"
						) === "true"
					) {

						return;

					}

					const action =
						target.getAttribute(
							"data-batch-action"
						);

					const row =
						getBatchRow(
							target.getAttribute(
								"data-batch-row"
							)
						);

					if (action === "remove") {

						removeBatchRow(
							row ? row.id : null
						);

						updateBatchToolbar();

						return;

					}

					if (!row) {

						return;

					}

					if (action === "preview") {

						openBatchPreview(
							row.id
						);

						return;

					}

					if (action === "export") {

						exportBatchRow(
							row.id
						);

						return;

					}

					if (action === "edit") {

						/* Read the row's live controls first: style, frame and script travel with the handoff. */
						openBatchEditPage(syncBatchRowFromDom(row) || row);

						return;

					}

				}
			);

		}

		const generate =
			document.getElementById(
				"batch-generate"
			);

		if (generate) {

			generate.addEventListener(
				"click",
				function () {

					/*
					 * Pressing it a second time stops the rows that have not
					 * finished yet - the one control for a run that is taking
					 * too long.
					 */
					if (batchRunBusy) {

						stopBatchRows();

						return;

					}

					generateBatchRows();

				}
			);

		}

		const addRow =
			document.getElementById(
				"batch-add-row"
			);

		if (addRow) {

			addRow.addEventListener(
				"click",
				function () {

					const row =
						addBatchRow();

					if (row) {

						const input =
							document.querySelector(
								'[data-batch-row="' + row.id + '"] [data-batch-field="script"]'
							);

						if (input && input.focus) {

							input.focus();

						}

					}

				}
			);

		}


	}

	/* Exposed for tests / debugging: the live row list, same array. */
	if (typeof window !== "undefined") {

		window.__BATCH_ROWS =
			batchRows;

		/* Session #244: the silent-retry policy (attempts + backoff). */
		window.__BATCH_RETRY =
			batchRetryPolicy;

		/* Session #248: pipeline queue advancement hook */
		window.startUnprocessedRows =
			startUnprocessedRows;

		/* Session #263: the load-aware image chunk retrier (tests / debugging). */
		window.__REQUEST_IMAGE_CHUNK =
			requestImageChunk;

		window.startUnprocessedBatchRows =
			startUnprocessedBatchRows;

		window.mediaItemRetryPolicy = mediaItemRetryPolicy;
		window.retryFailedMediaOnly = retryFailedMediaOnly;
		window.alternateMediaPrompt = alternateMediaPrompt;
		window.acceptMediaBlob = acceptMediaBlob;
		window.mediaFilenameFromBlob = mediaFilenameFromBlob;
		window.recordedMediaFilenames = recordedMediaFilenames;
		window.runEditorMediaWithIndividualRetries = runEditorMediaWithIndividualRetries;
		window.requestBatchImagesWithIndividualRetries = requestBatchImagesWithIndividualRetries;
		window.batchProjectJson = batchProjectJson;
		window.openBatchEditPage = openBatchEditPage;
		window.applyTransitionProject = applyTransitionProject;
		window.__MEDIA_ITEM_RETRY_LOG = window.__MEDIA_ITEM_RETRY_LOG || [];
		window.__MEDIA_FILENAME_LOG = window.__MEDIA_FILENAME_LOG || [];

	}

	/* The toolbar mirrors the rows: how many can be generated, and busy? */
	function updateBatchToolbar() {

		const scripted =
			batchRows.filter(batchRowHasScript).length;

		const runnable =
			batchRows.filter(batchRowReadyForGeneration).length;

		const generate =
			document.getElementById(
				"batch-generate"
			);

		if (generate) {

			generate.disabled =
				batchRunBusy
					? false
					: runnable === 0;

			generate.textContent =
				batchRunBusy
					? "\u25a0 Stop generating"
					: "\u2726 Generate" +
						(runnable ? " (" + runnable + ")" : "");

		}

		const note =
			document.getElementById(
				"batch-note"
			);

		if (note) {

			note.textContent =
				batchRows.length +
				" row" +
				(batchRows.length === 1 ? "" : "s") +
				" \u00b7 " +
				scripted +
				" with a script \u00b7 " +
				runnable +
				" ready";

		}

		if (studioLayout === "table") {

			const topGen =
				document.getElementById(
					"top-generate"
				);

			if (topGen) {

				topGen.disabled =
					batchRunBusy
						? false
						: runnable === 0;

				topGen.textContent =
					batchRunBusy
						? "\u25a0 Stop generating"
						: "\u2726 Generate" +
							(runnable ? " (" + runnable + ")" : "");

				topGen.title =
					batchRunBusy
						? "Stop generating active batch rows"
						: "Generate ready batch rows only (up to three at a time)";

			}

		}

	}

	/*
	 * Keeps the small hint under the resolution select honest: it shows the
	 * pixels the worker will really request for this row's frame.
	 */
	function refreshBatchRowFrame(row) {

		if (!row) {
			return;
		}

		const cell =
			document.querySelector('[data-batch-row="' + row.id + '"] .batch-cell-resolution .batch-row-sub');

		if (!cell) {
			return;
		}

		const frame =
			batchRowDimensions(row);

		cell.textContent =
			frame.width + "\u00d7" + frame.height;

	}

	/* Reads the live inputs back into the row state (never the reverse). */
	function syncBatchRowInput(
		row,
		field,
		element,
		commit
	) {

		if (!row || !element) {

			return;

		}

		if (field === "script") {

			row.script =
				String(element.value || "");

			return;

		}

		if (field === "style") {

			const chosen =
				String(element.value || "").trim();

			if (chosen && SEO_IMAGE_STYLES.indexOf(chosen) !== -1) {

				row.style =
					chosen;

			}

			return;

		}

		if (field === "resolution") {

			row.resolution =
				batchResolution(element.value);

			element.value =
				String(row.resolution);

			refreshBatchRowFrame(row);

			return;

		}

		if (field === "orientation") {

			row.orientation =
				batchOrientation(element.value).value;

			element.value =
				row.orientation;

			refreshBatchRowFrame(row);

			return;

		}

		if (field === "minutes") {

			const rawText =
				String(element.value || "").trim();

			if (!commit && rawText === "") {

				/* Let the user clear the digit while typing a replacement. */
				return;

			}

			const minutes =
				Math.round(
					Number(rawText) || 0
				);

			row.minutes =
				minutes < BATCH_MIN_MINUTES
					? BATCH_MIN_MINUTES
					: minutes > BATCH_MAX_MINUTES
						? BATCH_MAX_MINUTES
						: minutes;

			if (commit && String(element.value) !== String(row.minutes)) {

				element.value =
					String(row.minutes);

			}

			return;

		}

	}

	function bindStudioShell() {

		/* The quick-batch table is part of the shell: bound once, here. */
		bindBatchTable();

		const topGen =
			document.getElementById(
				"top-generate"
			);

		if (topGen) {

			topGen.removeAttribute(
				"onclick"
			);

			topGen.addEventListener(
				"click",
				onGenerateClick
			);

		}

		const buttons =
			document.querySelectorAll(
				"[data-layout]"
			);

		for (const button of buttons) {

			button.addEventListener(
				"click",
				() =>
					setStudioLayout(
						button.getAttribute(
							"data-layout"
						)
					)
			);

		}

		const storageReset =
			document.getElementById(
				"pipeline-storage-reset"
			);

		if (storageReset) {

			storageReset.addEventListener(
				"click",
				resetPipelineManagementState
			);

		}

		renderBatchTable();

	}


	// =========================================================
	// MODULE 2: video-gallery
	// =========================================================

	/*
	 * One upload per video: files are
	 * recorded by File reference (and
	 * MP4s probed for length) and shown
	 * as cards. Decoding happens only
	 * when the video is rendered.
	 */
	async function onVideoFiles(
		n,
		event
	) {

		const project =
			videoProjects[n - 1];

		const files =
			event.target.files
				? Array.from(
						event.target.files
				  )
				: [];

		/*
		 * Allows the same file to be
		 * selected again later.
		 */
		event.target.value =
			"";

		if (!files.length) {
			return;
		}

		for (
			const file of files
		) {

			const fileIsGif =
				file.type ===
					"image/gif" ||
				/\\.gif$/i.test(
					file.name
				);

			const fileIsMp4 =
				file.type ===
					"video/mp4" ||
				/\\.(mp4|m4v)$/i.test(
					file.name
				);

			const counts =
				videoCounts(
					project
				);

			if (
				fileIsGif &&
				counts.gifs >=
					MAX_GIF_UPLOADS
			) {

				alert(
					"Video " + n +
						": you can add at most " +
						MAX_GIF_UPLOADS +
						" GIFs."
				);

				break;

			}

			if (
				!fileIsGif &&
				!fileIsMp4 &&
				counts.stills >=
					MAX_IMAGE_UPLOADS
			) {

				alert(
					"Video " + n +
						": you can add at most " +
						MAX_IMAGE_UPLOADS +
						" images (jpg, png, jpeg)."
				);

				break;

			}

			if (
				fileIsMp4 &&
				counts.clips >=
					MAX_MP4_UPLOADS
			) {

				alert(
					"Video " + n +
						": you can add at most " +
						MAX_MP4_UPLOADS +
						" MP4 clips."
				);

				break;

			}

			if (fileIsMp4) {

				/*
				 * Probed now so the
				 * 1-minute cap is
				 * enforced at upload.
				 */
				const clipURL =
					createStudioObjectUrl(
						file
					);

				const probed =
					document.createElement(
						"video"
					);

				let clipDuration =
					0;

				try {

					clipDuration =
						await probeMp4DurationWithRetry(
							clipURL,
							CLIP_PROBE_ATTEMPTS,
							probed
						);

				}
				catch (probeError) {

					releaseStudioObjectUrl(
						clipURL
					);

					alert(
						"'" +
							file.name +
							"' could not be read as an MP4 clip after " + CLIP_PROBE_ATTEMPTS + " attempts. Try re-exporting it as a standard MP4 (H.264 + AAC)."
					);

					continue;

				}

				if (
					clipDuration >
						MP4_MAX_DURATION_S
				) {

					releaseStudioObjectUrl(
						clipURL
					);

					alert(
						"'" +
							file.name +
							"' is " +
							formatSeconds(
								clipDuration
							) +
							" long. Each MP4 clip must be at most " +
							formatSeconds(
								MP4_MAX_DURATION_S
							) +
							"."
					);

					continue;

				}

				probed.loop =
					true;

				const asset = {
					kind: "mp4",
					file: file,
					stockSource: file.stockSource || null,
					videoEl: probed,
					duration: clipDuration,
					url: clipURL,
					card: null,
				};

				project.assets.push(
					asset
				);

				buildVaCard(
					n,
					asset
				);

			}
			else {

				const asset = {
					kind:
						fileIsGif
							? "gif"
							: "image",
					file: file,
					stockSource: file.stockSource || null,
					url:
						createStudioObjectUrl(
							file
						),
					card: null,
				};

				project.assets.push(
					asset
				);

				buildVaCard(
					n,
					asset
				);

			}

		}

		updateVideoStatus(
			n
		);

	}

	function onVideoAudio(
		n,
		event
	) {

		const project =
			videoProjects[n - 1];

		const file =
			event.target.files &&
			event.target.files[0];

		/*
		 * Allows the same file to be
		 * selected again later.
		 */
		event.target.value =
			"";

		if (!file) {
			return;
		}

		/*
		 * Recorded only; decoded when
		 * the video is rendered. A new
		 * MP3 replaces the old one.
		 */
		project.audioFile =
			file;

		project.audio =
			null;
		project._voiceoverDurationMs = 0;

		const line =
			document.getElementById(
				"va-audio-line-" + n
			);

		if (line) {
			line.textContent =
				"\ud83c\udfb5 " + file.name;
		}

		updateVideoStatus(
			n
		);

	}

	function buildVaCard(
		n,
		asset
	) {

		const gallery =
			document.getElementById(
				"va-gallery-" + n
			);

		const card =
			document.createElement(
				"div"
			);

		card.className =
			"va-card";

		card.draggable =
			true;

		const media =
			document.createElement(
				asset.kind ===
					"mp4"
					? "video"
					: "img"
			);

		media.src =
			asset.url;

		/*
		 * Stop the browser's native
		 * img/video drag so only the
		 * card's reorder drag fires.
		 */
		media.draggable =
			false;

		if (
			asset.kind ===
				"mp4"
		) {

			media.muted =
				true;

			media.loop =
				true;

			media.playsInline =
				true;

		}

		const label =
			document.createElement(
				"div"
			);

		label.className =
			"va-card-label";

		label.textContent =
			asset.kind ===
				"mp4"
			? asset.file.name +
				"  |  " +
				formatSeconds(
					asset.duration
				)
			: asset.file.name;

		label.title =
			label.textContent;

		const removeBtn =
			document.createElement(
				"button"
			);

		removeBtn.type =
			"button";

		removeBtn.className =
			"va-card-remove";

		removeBtn.textContent =
			"\u00d7";

		removeBtn.title =
			"Remove";

		removeBtn.addEventListener(
			"click",
			() =>
				removeVaCard(
					n,
					asset
				)
		);

		/*
		 * Visible drag handle + hover
		 * tooltip (position + name).
		 */
		const handle =
			document.createElement(
				"div"
			);

		handle.className =
			"va-card-handle";

		handle.textContent =
			"\\u283F";

		handle.title =
			"Drag to reorder";

		const tip =
			document.createElement(
				"div"
			);

		tip.className =
			"va-card-tip";

		/*
		 * Drag & drop reordering inside
		 * this video's gallery.
		 */
		card.addEventListener(
			"dragstart",
			(e) => {

				dragCard =
					card;

				card.classList.add(
					"dragging"
				);

				e.dataTransfer.effectAllowed =
					"move";

			}
		);

		card.addEventListener(
			"dragend",
			() => {

				dragCard =
					null;

				card.classList.remove(
					"dragging"
				);

			}
		);

		card.addEventListener(
			"dragover",
			(e) => {

				e.preventDefault();

				card.classList.add(
					"drag-over"
				);

			}
		);

		card.addEventListener(
			"dragleave",
			() => {

				card.classList.remove(
					"drag-over"
				);

			}
		);

		card.addEventListener(
			"drop",
			(e) => {

				e.preventDefault();

				card.classList.remove(
					"drag-over"
				);

				if (!dragCard) {
					return;
				}

				const draggedTop =
					dragCard.getBoundingClientRect()
						.top;

				const targetTop =
					card.getBoundingClientRect()
						.top;

				if (
					draggedTop <
						targetTop
				) {

					gallery.insertBefore(
						dragCard,
						card
					);

				}
				else {

					gallery.insertBefore(
						dragCard,
						card.nextSibling
					);

				}

				syncVaOrder(
					n
				);

				updateVideoStatus(
					n
				);

			}
		);

		card.appendChild(
			media
		);

		card.appendChild(
			label
		);

		card.appendChild(
			removeBtn
		);

		card.appendChild(
			handle
		);

		card.appendChild(
			tip
		);

		asset.card =
			card;

		card._asset =
			asset;

		gallery.appendChild(
			card
		);

	}

	let dragCard =
		null;

	function removeVaCard(
		n,
		asset
	) {

		const project =
			videoProjects[n - 1];

		const idx =
			project.assets.indexOf(
				asset
			);

		if (idx >= 0) {
			project.assets.splice(
				idx,
				1
			);
		}

		if (
			asset.kind !==
				"mp4" &&
			asset.url
		) {

			releaseStudioObjectUrl(
				asset.url
			);

		}

		if (asset.card) {
			asset.card.remove();
		}

		updateVideoStatus(
			n
		);

	}

	/*
	 * Updates each card's tooltip with
	 * its current position and name.
	 */
	function refreshVaTips(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		const gallery =
			document.getElementById(
				"va-gallery-" + n
			);

		if (!gallery) {
			return;
		}

		const cards =
			Array.from(
				gallery.children
			);

		for (
			let i = 0;
			i < cards.length;
			i++
		) {

			const asset =
				cards[i]._asset;

			const tip =
				cards[i].querySelector(
					".va-card-tip"
				);

			if (!tip || !asset) {
				continue;
			}

			const bits =
				[
					"#" + (i + 1),
					asset.file.name,
				];

			if (
				asset.kind ===
					"mp4"
			) {

				bits.push(
					formatSeconds(
						asset.duration
					)
				);

			}

			bits.push(
				asset.kind === "mp4"
					? "MP4"
					: asset.kind === "gif"
						? "GIF"
						: "image"
			);

			tip.textContent =
				bits.join(" \u00b7 ") +
				" \u2014 drag to reorder";

			tip.title =
				tip.textContent;

		}

	}

	/*
	 * After a drop, the DOM order is the
	 * source of truth for the slide
	 * order.
	 */
	function syncVaOrder(
		n
	) {

		const project =
			videoProjects[n - 1];

		const gallery =
			document.getElementById(
				"va-gallery-" + n
			);

		const order =
			Array.from(
				gallery.children
			).map(
				(card) =>
					card._asset
			);

		project.assets.length =
			0;

		for (
			const a of order
		) {

			if (a) {
				project.assets.push(
					a
				);
			}

		}

		try {
			syncEditorProjectDetail(n, "gallery-reordered");
		} catch (reorderDetailErr) { }

	}

	function vaCaptionRowHTML() {

		return (
			'<div class="caption-time">' +
			'<input type="number" min="0" max="99" step="1" value="0" class="caption-hh" aria-label="Hours">' +
			'<span>:</span>' +
			'<input type="number" min="0" max="59" step="1" value="0" class="caption-mm" aria-label="Minutes">' +
			'<span>:</span>' +
			'<input type="number" min="0" max="59" step="1" value="0" class="caption-ss" aria-label="Seconds">' +
			'</div>' +
			'<div class="caption-text-wrap">' +
			'<input type="text" class="caption-text" maxlength="' +
			CAPTION_MAX_CHARS +
			'" placeholder="Caption text (max ' +
			CAPTION_MAX_CHARS +
			' characters)">' +
			'<span class="caption-chars">0/' +
			CAPTION_MAX_CHARS +
			'</span>' +
			'</div>' +
			'<button type="button" class="caption-remove" title="Remove caption" onclick="removeVaCaptionRow(this)">&times;</button>'
		);

	}

	function addVaCaptionRow(
		n
	) {

		const rows =
			document.getElementById(
				"va-captions-" + n
			);

		if (!rows) {
			return;
		}

		if (
			rows.children.length >=
				MAX_CAPTIONS
		) {

			return;

		}

		const row =
			document.createElement(
				"div"
			);

		row.className =
			"caption-row";

		row.innerHTML =
			vaCaptionRowHTML();

		const textInput =
			row.querySelector(
				".caption-text"
			);

		textInput.addEventListener(
			"input",
			() => {

				row.querySelector(
					".caption-chars"
				).textContent =
					textInput.value.length +
					"/" +
					CAPTION_MAX_CHARS;

			}
		);

		rows.appendChild(
			row
		);

		updateVideoStatus(
			n
		);

	}

	function removeVaCaptionRow(
		button
	) {

		const row =
			button.closest(
				".caption-row"
			);

		if (
			!row ||
			!row.parentElement
		) {

			return;

		}

		const rowsId =
			row.parentElement.id;

		row.remove();

		const n = Number(
			rowsId.substring(
				"va-captions-".length
			)
		);

		if (
			Number.isFinite(
				n
			)
		) {

			updateVideoStatus(
				n
			);

		}

	}

	// =========================================================
	// MODULE 3: required-modal
	// =========================================================

	function showRequiredModal(
		issues
	) {

		const modal =
			document.getElementById(
				"required-modal"
			);

		const list =
			document.getElementById(
				"required-modal-list"
			);

		if (!modal || !list) {
			return;
		}

		list.innerHTML =
			"";

		for (
			const issue of issues
		) {

			const li =
				document.createElement(
					"li"
				);

			li.textContent =
				issue;

			list.appendChild(
				li
			);

		}

		modal.style.display =
			"flex";

	}

	function closeRequiredModal() {

		const modal =
			document.getElementById(
				"required-modal"
			);

		if (modal) {
			modal.style.display =
				"none";
		}

	}

	// =========================================================
	// MODULE 4: generation-queue
	// =========================================================

	/*
	 * The single generate button:
	 * validates every video in the
	 * stack, warns about missing
	 * required fields, then renders
	 * them in order \u2014 VIDEO_BATCH_SIZE
	 * at a time, last batch may be one.
	 */
	function onGenerateClick() {

		if (studioLayout === "table") {

			if (batchRunBusy) {

				stopBatchRows();

				return;

			}

			generateBatchRows();

			return;

		}

		if (generating || batchRenderBusy || window.__workerMode) {
			alert("A video is already being rendered in this browser. Please wait for it to finish.");
			return;
		}

		if (
			!videoProjects.length
		) {

			showRequiredModal(
				[
					"Click the red + button to add a video first."
				]
			);

			return;

		}

		const issues =
			[];

		for (
			const project of videoProjects
		) {

			if (
				!project.assets.length
			) {

				issues.push(
					project.name +
						": add at least one image, GIF or MP4."
				);

			}

		}

		if (issues.length) {

			showRequiredModal(
				issues
			);

			return;

		}

		runGenerationQueue();

	}

	/*
	 * Reads this video's recorded assets
	 * from disk now that its turn has
	 * come: decodes the MP3, decodes
	 * the images and GIFs, and returns
	 * the slides in gallery order.
	 */
	async function prepareVideo(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (project._requiresStockClips) {
			const clips = project.assets.filter(function (a) { return a.imagePromptFlowId && a.kind === "mp4"; });
			if (clips.length !== AUTO_VIDEO_SCENES || new Set(clips.map(function (a) { return a.stockSource && a.stockSource.id; })).size !== AUTO_VIDEO_SCENES) {
				throw new Error("This planned video requires four distinct Pixabay clips. Retry only the missing scenes before export.");
			}
		}

		const slides =
			[];

		if (
			project.audioFile
		) {

			const arrayBuffer =
				await mediaDeadline(project.audioFile.arrayBuffer(), 30000,
					"Reading the audio file timed out; retry this video.");

			const context =
				getAudioContext();

			const decoded =
				await mediaDeadline(context.decodeAudioData(arrayBuffer.slice(0)), 20000, "Editor audio decoding timed out; retry this video.");

			project.audio = {
				name:
					project.audioFile.name,
				duration:
					decoded.duration,
				buffer:
					decoded,
				url:
					null,
			};

			// Match quick batch: the actual selected audio is the timing
			// source, including when a different MP3 was uploaded later.
			if (project.subtitles && project.subtitles.length && project.script && decoded.duration > 0) {
				project.subtitles = buildScriptCues(project.script, decoded.duration * 1000);
			}

			const line =
				document.getElementById(
					"va-audio-line-" + n
				);

			if (line) {
				line.textContent =
					"\ud83c\udfb5 " +
					project.audioFile.name +
					" (" +
					formatSeconds(
						project.audio.duration
					) +
					")";
			}

		}

		for (
			let k = 0;
			k < project.assets.length;
			k++
		) {

			const asset =
				project.assets[k];

			if (
				asset.kind ===
					"mp4"
			) {

				/*
				 * Probed at upload
				 * time; plays in full
				 * length, silent.
				 */
				slides.push(
					{
						id:
							"video" + n +
								"-mp4-" + k,
						cardId:
							"",
						type:
							"mp4",
						videoEl:
							asset.videoEl,
						duration:
							asset.duration,
						img:
							asset.videoEl,
					}
				);

				continue;

			}

			const img =
				new Image();

			img.src =
				asset.url;

			if (
				asset.kind ===
					"gif"
			) {

				const buffer =
					await mediaDeadline(asset.file.arrayBuffer(), 30000,
						"Reading the GIF file timed out; retry this video.");

				const gif =
					buildGifSlideFrames(
						parseGifBytes(
							new Uint8Array(
								buffer
							)
						)
					);

				slides.push(
					{
						id:
							"video" + n +
								"-gif-" + k,
						cardId:
							"",
						type:
							"gif",
						gif:
							gif,
						img:
							img,
					}
				);

			}
			else {

				await mediaDeadline(img.decode(), 10000, "Editor photo decoding timed out; retry this video.");

				slides.push(
					{
						id:
							"video" + n +
								"-img-" + k,
						cardId:
							"",
						img:
							img,
					}
				);

			}

		}

		if (project.assets.filter(function (asset) { return asset.imagePromptFlowId && asset.kind === "mp4"; }).length === AUTO_VIDEO_SCENES) {
			fitStockSceneTimeline(slides, project.audio && project.audio.duration);
		}
		return slides;

	}

	function swapVaCaptionsIn(
		n
	) {

		const slotRows =
			document.getElementById(
				"va-captions-" + n
			);

		/* The accordion no longer has a caption section: no rows to swap. */
		if (!slotRows) {
			return;
		}

		while (
			slotRows.children.length
		) {

			captionRowsEl.appendChild(
				slotRows.children[0]
			);

		}

	}

	function swapVaCaptionsOut(
		n
	) {

		const slotRows =
			document.getElementById(
				"va-captions-" + n
			);

		if (!slotRows) {
			return;
		}

		while (
			captionRowsEl.children.length
		) {

			slotRows.appendChild(
				captionRowsEl.children[0]
			);

		}

	}

	async function runGenerationQueue() {

		generating =
			true;

		const renderBtn =
			document.getElementById(
				"render-btn"
			);

		const banner =
			document.getElementById(
				"bulk-banner"
			);

		const statusText =
			document.getElementById(
				"status-text"
			);

		if (banner) {
			banner.style.display =
				"block";
		}

		if (renderBtn) {
			renderBtn.disabled =
				true;
		}

		/*
		 * Snapshot the engine's working
		 * state (the hidden main
		 * panels) so it can be restored
		 * afterwards.
		 */
		const saved = {
			slides:
				activeSlides.slice(),
			audio:
				currentAudio,
			captionRows:
				Array.from(
					captionRowsEl.children
				),
			title:
				document.getElementById(
					"title-input"
				).value,
			font:
				document.getElementById(
					"title-font"
				).value,
			color:
				document.getElementById(
					"title-color"
				).value,
			quality:
				document.getElementById(
					"quality-select"
				).value,
		};

		let done =
			0;

		let skipped =
			0;

		let errors =
			0;

		/*
		 * Batches of VIDEO_BATCH_SIZE:
		 * each video fully finishes
		 * before the next starts, so
		 * the first two are done before
		 * the next two begin, and the
		 * last batch may be a single
		 * video.
		 */
		for (
			let n = 1;
			n <= videoProjects.length;
			n++
		) {

			const project =
				videoProjects[n - 1];

			project.status =
				"rendering";

			updateVideoStatus(
				n
			);

			if (statusText) {
				statusText.textContent =
					"Bulk: rendering " +
						project.name +
						" ...";
			}

			let result =
				"error";

			try {

				const slides =
					await prepareVideo(
						n
					);

				swapVaCaptionsIn(
					n
				);

				/*
				 * Point the hidden
				 * engine working state
				 * at this video.
				 */
				document.getElementById(
					"title-input"
				).value =
					document.getElementById(
						"va-title-" + n
					).value;

				document.getElementById(
					"title-font"
				).value =
					document.getElementById(
						"va-font-" + n
					).value;

				document.getElementById(
					"title-color"
				).value =
					document.getElementById(
						"va-color-" + n
					).value;

				document.getElementById(
					"quality-select"
				).value =
					document.getElementById(
						"va-quality-" + n
					).value;

				activeSlides.length =
					0;

				for (
					const slide of slides
				) {

					activeSlides.push(
						slide
					);

				}

				currentAudio =
					project.audio;

				renderContext = {
					fileName:
						"YouTubeVibeStudio_" +
						project.name.replace(
							/\\s+/g,
							""
						) +
						".mp4",
					subtitles:
						project.subtitles ||
						[],
				};

				result =
					(await generateMP4()) ||
					"skipped";

			}
			catch (bulkError) {

				console.error(
					project.name +
						" failed:",
					bulkError
				);

			}
			finally {

				swapVaCaptionsOut(
					n
				);

				activeSlides.length =
					0;

				currentAudio =
					null;

				renderContext =
					null;

			}

			if (
				result ===
					"done"
			) {

				project.status =
					"done";

				done++;

			}
			else if (
				result ===
					"error"
			) {

				project.status =
					"error";

				errors++;

			}
			else {

				project.status =
					"skipped";

				skipped++;

			}

			updateVideoStatus(
				n
			);

		}

	/*
	 * Restore the engine's working
	 * state.
	 */
		activeSlides.length =
			0;

		for (
			const slide of saved.slides
		) {

			activeSlides.push(
				slide
			);

		}

		currentAudio =
			saved.audio;

		captionRowsEl.innerHTML =
			"";

		for (
			const row of saved.captionRows
		) {

			captionRowsEl.appendChild(
				row
			);

		}

		updateCaptionCount();

		document.getElementById(
			"title-input"
		).value =
			saved.title;

		document.getElementById(
			"title-font"
		).value =
			saved.font;

		document.getElementById(
			"title-color"
		).value =
			saved.color;

		document.getElementById(
			"quality-select"
		).value =
			saved.quality;

		generating =
			false;

		if (renderBtn) {
			renderBtn.disabled =
				false;
		}

		if (banner) {
			banner.style.display =
				"none";
		}

		if (statusText) {
			statusText.textContent =
				"Bulk complete: " +
					done +
					" saved, " +
					skipped +
					" skipped, " +
					errors +
					" failed.";
		}

	}

	// =========================================================
	// MODULE 5: ai-images
	// (the 40% right panel of each accordion)
	// =========================================================

	/* Automatic mixed stock scenes are inserted into the shared media gallery. */
	function addAiToVideo(
		n,
		file,
		blob,
		imagePromptFlowId,
		quiet
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return false;
		}

		const counts =
			videoCounts(
				project
			);

		if (
			counts.stills >=
				MAX_IMAGE_UPLOADS
		) {

			if (!quiet) {
				alert(
					"Video " + n +
						": you can add at most " +
						MAX_IMAGE_UPLOADS +
						" images (jpg, png, jpeg)."
				);
			}

			return false;
		}

		const url =
			createStudioObjectUrl(
				blob
			);

		const asset = {
			kind: "image",
			file: file,
			stockSource: blob.stockSource || file.stockSource || null,
			url: url,
			card: null,
			imagePromptFlowId: imagePromptFlowId ? String(imagePromptFlowId) : null,
		};

		project.assets.push(
			asset
		);

		try {
			buildVaCard(
				n,
				asset
			);
			if (imagePromptFlowId && asset.card && asset.card.dataset) {
				asset.card.dataset.imagePromptFlowId = String(imagePromptFlowId);
			}
			updateVideoStatus(
				n
			);
		}
		catch (insertionError) {
			const assetIndex = project.assets.indexOf(asset);
			if (assetIndex >= 0) project.assets.splice(assetIndex, 1);
			if (asset.card && asset.card.parentNode) asset.card.parentNode.removeChild(asset.card);
			try { releaseStudioObjectUrl(url); } catch (revokeError) { }
			throw insertionError;
		}
		return true;

	}

	/*
	 * Fullscreen preview overlay for
	 * a stock image.
	 */
	function showAiFullscreen(
		url
	) {

		let overlay =
			document.getElementById(
				"ai-fullscreen"
			);

		if (!overlay) {

			overlay =
				document.createElement(
					"div"
				);

			overlay.id =
				"ai-fullscreen";

			overlay.className =
				"ai-fullscreen-overlay";

			const img =
				new Image();

			img.className =
				"ai-fullscreen-img";

			img.alt =
				"fullscreen preview";

			const note =
				document.createElement(
					"div"
				);

			note.className =
				"ai-fullscreen-note";

			note.textContent =
				"Click anywhere to close";

			overlay.appendChild(
				img
			);

			overlay.appendChild(
				note
			);

			overlay.addEventListener(
				"click",
				closeAiFullscreen
			);

			document.body.appendChild(
				overlay
			);

		}

		overlay.querySelector(
			"img"
		).src =
			url;

		overlay.style.display =
			"flex";

	}

	function closeAiFullscreen() {

		const overlay =
			document.getElementById(
				"ai-fullscreen"
			);

		if (overlay) {
			overlay.style.display =
				"none";
		}

	}

	// =========================================================
	// MODULE 6: auth
	// (KV-backed login/signup, unlimited users)
	//
	// Flow on load:
	//   GET /api/session
	//     200 -> show the signed-in studio + account footer
	//     401 -> show the public landing; the studio stays gated
	//            until login/signup succeeds
	//     503/network -> keep the public landing; the studio is
	//                    available from its primary action
	//   POST /api/login    (username, password)
	//   POST /api/signup   (username, email,
	//                       password)
	//   POST /api/logout
	//
	// The overlay is built with DOM APIs (no HTML edit).
	// =========================================================

	const AUTH_CONTACT_EMAIL =
		"ytvibemotions.business@gmail.com";

	let authSubmitting =
		false;

	let authIsSignup =
		false;

	let authAccess =
		"checking";

	let pendingStudioEntry =
		false;

	/*
	 * Which URL served this shell (RULE 21):
	 *   ""          the landing page at /
	 *   "freemium"  /free  (no account, 10,000 images/day per IP)
	 *   "studio"    /studio (free_user or paid_user)
	 *   "paid"      /paid  (paid_user only)
	 * The worker injects window.__PLAN_MODE before this script.
	 */
	const PLAN_MODE =
		window.__PLAN_MODE ||
		"";

	/*
	 * Build (once) and show the sign-in
	 * overlay.
	 */
	function buildAuthOverlay() {

		let overlay =
			document.getElementById(
				"auth-overlay"
			);

		if (overlay) {
			return overlay;
		}

		overlay =
			document.createElement(
				"div"
			);

		overlay.id =
			"auth-overlay";

		overlay.className =
			"auth-overlay";

		overlay.style.display =
			"none";

		overlay.setAttribute(
			"aria-hidden",
			"true"
		);

		overlay.innerHTML =
			'<div class="auth-box" role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-describedby="auth-sub">' +
			'<button type="button" class="auth-close" id="auth-close" aria-label="Close">&times;</button>' +
			'<div class="auth-title" id="auth-title">\ud83c\udfac YouTube Vibe Studio</div>' +
			'<div class="auth-sub" id="auth-sub">Sign in to use the studio</div>' +
			'<div class="auth-plan-note">Every plan: 10,000 stock image imports/day (app fair use; Pixabay rate limits also apply) \u00b7 unlimited videos, AI scripts and voiceovers. Server load is balanced automatically, so bursts queue instead of failing.</div>' +
			'<div class="auth-guest-note">No account? <a href="/free">Open the free studio</a> \u2014 stock image search (Pixabay rate limits apply), counted per IP address.</div>' +
			'<div class="auth-error" id="auth-error" role="alert"></div>' +
			'<div class="auth-field" id="auth-email-wrap" style="display:none">' +
			'<label for="auth-email">Email</label>' +
			'<input type="email" id="auth-email" maxlength="64" autocomplete="email">' +
			'</div>' +
			'<div class="auth-field">' +
			'<label for="auth-username">Username</label>' +
			'<input type="text" id="auth-username" maxlength="20" autocomplete="username">' +
			'</div>' +
			'<div class="auth-field">' +
			'<label for="auth-password">Password</label>' +
			'<input type="password" id="auth-password" maxlength="64" autocomplete="current-password">' +
			'</div>' +
			'<div class="auth-field" id="auth-confirm-wrap" style="display:none">' +
			'<label for="auth-confirm">Confirm password</label>' +
			'<input type="password" id="auth-confirm" maxlength="64" autocomplete="new-password">' +
			'</div>' +
			'<button type="button" class="upload-btn auth-submit" id="auth-submit">Sign in</button>' +
			'<button type="button" class="auth-switch" id="auth-switch">New here? Create an account</button>' +
			'</div>';

		document.body.appendChild(
			overlay
		);

		const submitBtn =
			document.getElementById(
				"auth-submit"
			);

		const switchBtn =
			document.getElementById(
				"auth-switch"
			);

		const closeBtn =
			document.getElementById(
				"auth-close"
			);

		submitBtn.addEventListener(
			"click",
			submitAuth
		);

		switchBtn.addEventListener(
			"click",
			() => {

				setAuthMode(
					!authIsSignup
				);

				setAuthError(
					""
				);

			}
		);

		closeBtn.addEventListener(
			"click",
			hideAuthOverlay
		);

		overlay.addEventListener(
			"click",
			(event) => {
				if (event.target === overlay) {
					hideAuthOverlay();
				}
			}
		);

		document.addEventListener(
			"keydown",
			(event) => {
				if (
					event.key === "Escape" &&
					overlay.style.display === "flex"
				) {
					hideAuthOverlay();
				}
			}
		);

		["auth-password", "auth-confirm"].forEach(
			(fieldId) => {

				const field =
					document.getElementById(
						fieldId
					);

				if (field) {
					field.addEventListener(
						"keydown",
						(e) => {

							if (
								e.key ===
									"Enter"
							) {

								submitAuth();

							}

						}
					);
				}

			}
		);

		return overlay;

	}

	function setAuthError(
		message
	) {

		const el =
			document.getElementById(
				"auth-error"
			);

		if (el) {
			el.textContent =
				message ||
				"";
		}

	}

	function setAuthMode(isSignup) {

		authIsSignup =
			Boolean(isSignup);

		const submitBtn =
			document.getElementById(
				"auth-submit"
			);

		const switchBtn =
			document.getElementById(
				"auth-switch"
			);

		const subtitle =
			document.getElementById(
				"auth-sub"
			);

		const emailWrap =
			document.getElementById(
				"auth-email-wrap"
			);

		const confirmWrap =
			document.getElementById(
				"auth-confirm-wrap"
			);

		const password =
			document.getElementById(
				"auth-password"
			);

		if (submitBtn) {
			submitBtn.textContent =
				authIsSignup
					? "Create account"
					: "Sign in";
		}

		if (switchBtn) {
			switchBtn.textContent =
				authIsSignup
					? "Have an account? Sign in"
					: "New here? Create an account";
		}

		if (subtitle) {
			subtitle.textContent =
				authIsSignup
					? "Create an account to start making videos"
					: "Sign in to open your video studio";
		}

		if (emailWrap) {
			emailWrap.style.display =
				authIsSignup
					? "block"
					: "none";
		}

		if (confirmWrap) {
			confirmWrap.style.display =
				authIsSignup
					? "block"
					: "none";
		}

		if (password) {
			password.autocomplete =
				authIsSignup
					? "new-password"
					: "current-password";
		}

	}

	function showAuthOverlay(mode) {

		const overlay =
			buildAuthOverlay();

		if (mode === "signup") {
			setAuthMode(true);
		}
		else if (mode === "login") {
			setAuthMode(false);
		}

		setAuthError("");
		overlay.setAttribute(
			"aria-hidden",
			"false"
		);
		overlay.style.display =
			"flex";

		const firstField =
			document.getElementById(
				authIsSignup
					? "auth-email"
					: "auth-username"
			);

		if (firstField) {
			setTimeout(
				() => firstField.focus(),
				0
			);
		}

	}

	function hideAuthOverlay() {

		const overlay =
			document.getElementById(
				"auth-overlay"
			);

		if (overlay) {
			overlay.style.display =
				"none";
			overlay.setAttribute(
				"aria-hidden",
				"true"
			);
		}

	}

	function showLandingView() {

		const landing =
			document.getElementById(
				"landing-page"
			);

		const studio =
			document.getElementById(
				"studio-app"
			);

		if (landing) {
			landing.hidden = false;
		}

		if (studio) {
			studio.hidden = true;
		}

		hideCreditPill();

		window.scrollTo(0, 0);

	}

	function showStudioView() {

		const landing =
			document.getElementById(
				"landing-page"
			);

		const studio =
			document.getElementById(
				"studio-app"
			);

		if (landing) {
			landing.hidden = true;
		}

		if (studio) {
			studio.hidden = false;
		}

		if (creditState) {
			renderCreditPill();
		}

		window.scrollTo(0, 0);

	}

	function enterStudioFromLanding() {

		if (authAccess === "checking") {
			pendingStudioEntry = true;
			return;
		}

		if (authAccess === "required") {
			showAuthOverlay("signup");
			return;
		}

		showStudioView();

	}

	function bindLandingActions() {

		document.querySelectorAll(
			"[data-auth-open]"
		).forEach(
			(element) => {
				element.addEventListener(
					"click",
					(event) => {
						event.preventDefault();
						showAuthOverlay(
							element.getAttribute(
								"data-auth-open"
							)
						);
					}
				);
			}
		);

		document.querySelectorAll(
			"[data-studio-open]"
		).forEach(
			(element) => {
				element.addEventListener(
					"click",
					enterStudioFromLanding
				);
			}
		);

	}

	function resumeLandingEntry() {

		if (!pendingStudioEntry) {
			return;
		}

		pendingStudioEntry =
			false;

		if (authAccess === "required") {
			showAuthOverlay("signup");
		}
		else if (authAccess === "open") {
			hideAuthOverlay();
			showStudioView();
		}

	}

	/*
	 * Footer (end of the page): an hr
	 * line, then the username, the
	 * Account + Contact us links and
	 * the "Logout (username)" button.
	 */
	function showUserBadge(
		username,
		email
	) {

		let footer =
			document.getElementById(
				"auth-footer"
			);

		if (!footer) {

			footer =
				document.createElement(
					"div"
				);

			footer.id =
				"auth-footer";

			footer.className =
				"auth-footer";

			document.body.appendChild(
				footer
			);

		}

		footer.style.display =
			"block";

		footer.innerHTML =
			"";

		const hr =
			document.createElement(
				"hr"
			);

		hr.className =
			"auth-footer-hr";

		const row =
			document.createElement(
				"div"
			);

		row.className =
			"auth-footer-row";

		const span =
			document.createElement(
				"span"
			);

		span.className =
			"auth-footer-user";

		span.textContent =
			"\ud83d\udc64 " +
			username;

		const accountLink =
			document.createElement(
				"a"
			);

		accountLink.href =
			"/account";

		accountLink.className =
			"auth-footer-link";

		accountLink.id =
			"account-link";

		accountLink.textContent =
			"Account";

		const upgradeLink =
			document.createElement(
				"a"
			);

		upgradeLink.href =
			"/upgrade";

		upgradeLink.className =
			"auth-footer-link";

		upgradeLink.id =
			"upgrade-link";

		upgradeLink.textContent =
			"Upgrade";

		const contactLink =
			document.createElement(
				"a"
			);

		contactLink.href =
			"mailto:" +
				AUTH_CONTACT_EMAIL;

		contactLink.className =
			"auth-footer-link";

		contactLink.id =
			"contact-link";

		contactLink.textContent =
			"Contact us";

		const out =
			document.createElement(
				"button"
			);

		out.type =
			"button";

		out.className =
			"auth-logout";

		out.textContent =
			"Logout (" +
			username +
			")";

		out.addEventListener(
			"click",
			doLogout
		);

		row.appendChild(
			span
		);

		row.appendChild(
			accountLink
		);

		row.appendChild(
			upgradeLink
		);

		row.appendChild(
			contactLink
		);

		row.appendChild(
			out
		);

		footer.appendChild(
			hr
		);

		footer.appendChild(
			row
		);

	}

	/*
	 * The small account box toggled
	 * by the Account link: shows the
	 * signed-in username + email.
	 */
	function toggleAccountBox(
		username,
		email
	) {

		let box =
			document.getElementById(
				"auth-account-box"
			);

		if (!box) {

			box =
				document.createElement(
					"div"
				);

			box.id =
				"auth-account-box";

			box.className =
				"auth-account-box";

			box.style.display =
				"none";

			const footer =
				document.getElementById(
					"auth-footer"
				);

			if (footer) {
				footer.appendChild(
					box
				);
			}

		}

		if (
			box.style.display ===
				"none"
		) {

			box.innerHTML =
				"";

			const uLine =
				document.createElement(
					"div"
				);

			uLine.className =
				"auth-account-line";

			uLine.textContent =
				"Username: " +
				username;

			const eLine =
				document.createElement(
					"div"
				);

			eLine.className =
				"auth-account-line";

			eLine.textContent =
				"Email: " +
				email;

			/*
			 * Plan + today's image credits. The line is
			 * filled by updateAccountCreditLine() from the
			 * latest /api/credits payload (or left empty
			 * until the first load finishes).
			 */
			const cLine =
				document.createElement(
					"div"
				);

			cLine.className =
				"auth-account-line";

			cLine.id =
				"auth-account-credits";

			box.appendChild(
				uLine
			);

			box.appendChild(
				eLine
			);

			box.appendChild(
				cLine
			);

			updateAccountCreditLine();

			box.style.display =
				"block";

		}
		else {

			box.style.display =
				"none";

		}

	}

	/*
	 * Shared handler for the Sign in /
	 * Create account button.
	 */
	async function submitAuth() {

		if (authSubmitting) {
			return;
		}

		const usernameEl =
			document.getElementById(
				"auth-username"
			);

		const passwordEl =
			document.getElementById(
				"auth-password"
			);

		const confirmEl =
			document.getElementById(
				"auth-confirm"
			);

		const emailEl =
			document.getElementById(
				"auth-email"
			);

		if (
			!usernameEl ||
			!passwordEl
		) {
			return;
		}

		const username =
			usernameEl.value.trim();

		const password =
			passwordEl.value;

		const email =
			emailEl
				? emailEl.value.trim()
				: "";

		setAuthError(
			""
		);

		if (
			!/^[a-zA-Z0-9_]{3,20}$/.test(
				username
			)
		) {

			setAuthError(
				"Username: 3-20 letters, numbers or _ ."
			);

			return;

		}

		if (
			authIsSignup &&
			!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(
				email
			)
		) {

			setAuthError(
				"Enter a valid email address."
			);

			return;

		}

		if (
			password.length <
				6
		) {

			setAuthError(
				"Password must be at least 6 characters."
			);

			return;

		}

		if (
			authIsSignup &&
			confirmEl &&
			password !==
				confirmEl.value
		) {

			setAuthError(
				"Passwords do not match."
			);

			return;

		}

		authSubmitting =
			true;

		const submitBtn =
			document.getElementById(
				"auth-submit"
			);

		submitBtn.disabled =
			true;

		submitBtn.textContent =
			"Please wait...";

		try {

			const endpoint =
				authIsSignup
					? "/api/signup"
					: "/api/login";

			const response =
				await fetch(
					endpoint,
					{
						method: "POST",

						headers: {
							"Content-Type":
								"application/json",
						},

						body: JSON.stringify(
							{
								username:
									username,

								email:
									email,

								password:
									password,
							}
						),

						credentials:
							"same-origin",
					}
				);

			let data =
				{};

			try {

				data =
					await response.json();

			}
			catch (jsonError) {

				/* keep {} */

			}

				if (response.ok) {

					authAccess = "authenticated";
					hideAuthOverlay();
					showStudioView();

					showUserBadge(
						data.user &&
						data.user.username
							? data.user.username
							: username,
						data.user &&
						data.user.email
							? data.user.email
							: email
					);

					/*
					 * Signup/login return the plan and today's
					 * counters, so the pill paints instantly;
					 * otherwise fetch them.
					 */
					if (data.credits) {

						applyCredits(
							data.credits
						);

					}
					else {

						refreshCredits();

					}

				}
			else {

				setAuthError(
					data.error ||
					"Request failed (" +
					response.status +
					")"
				);

			}

		}
		catch (netError) {

			setAuthError(
				"Network error: " +
				(netError.message ||
					netError)
			);

		}
		finally {

			authSubmitting =
				false;

			submitBtn.disabled =
				false;

			submitBtn.textContent =
				authIsSignup
					? "Create account"
					: "Sign in";

		}

	}

	async function doLogout() {

		try {

			await fetch(
				"/api/logout",
				{
					method: "POST",

					credentials:
						"same-origin",
				}
			);

		}
		catch (e) {

			/* the UI still locks */

		}

		const footer =
			document.getElementById(
				"auth-footer"
			);

		if (footer) {
			footer.style.display =
				"none";
		}

		pendingStudioEntry = false;
		hideAuthOverlay();
		resetCredits();

		/*
		 * Signing out of /free drops back to guest mode
		 * instead of the landing page: the freemium studio
		 * stays usable without an account.
		 */
		if (PLAN_MODE === "freemium") {
			authAccess = "freemium";
			showStudioView();
			refreshCredits();
			return;
		}

		authAccess = "required";
		showLandingView();

	}

	// =========================================================
	// MODULE 6b: credits
	// (daily credits shown as a pill in the studio and in the
	//  account box. The worker is the source of truth:
	//  GET /api/credits returns the plan and today's counters,
	//  /image/gen returns 429 + the counters when the daily
	//  image allowance is spent.
	//
	//  every plan unlimited videos / AI scripts / voiceovers,
	//             10,000 Pixabay images per day (free, paid_user
	//             and the anonymous guest tier)
	//  Every counter renews at midnight Asia/Taipei (UTC+8).
	// =========================================================

	let creditState =
		null;

	/* 10000 -> "10,000" so a big allowance stays readable */
	function creditFormatNumber(
		value
	) {

		const number =
			Number(value);

		if (!isFinite(number)) {
			return String(
				value == null ? "" : value
			);
		}

		return number.toLocaleString(
			"en-US"
		);

	}

	function creditPlanLabel() {

		return creditState &&
			creditState.plan
			? creditState.plan.label
			: "Free";

	}

	function creditImagesLeft() {

		if (
			!creditState ||
			!creditState.remaining
		) {

			return null;

		}

		return creditState
			.remaining.images;

	}

	function creditImagesLimit() {

		return creditState &&
			creditState.plan &&
			creditState.plan.limits
			? creditState.plan.limits.images
			: 10000;

	}

	function creditImagesValue() {

		const left =
			creditImagesLeft();

		if (
			left === null
		) {

			return "Unlimited";

		}

		return (
			creditFormatNumber(left) +
			" / " +
			creditFormatNumber(
				creditImagesLimit()
			) +
			" left today"
		);

	}

	function creditResetText() {

		if (
			!creditState ||
			!creditState.resetsAt
		) {

			return "Renews daily at midnight (UTC+8)";

		}

		const left =
			new Date(
				creditState.resetsAt
			).getTime() -
			Date.now();

		if (
			!isFinite(left) ||
			left <= 0
		) {

			return "Renewing now (midnight UTC+8)";

		}

		const hours =
			Math.floor(
				left / 3600000
			);

		const minutes =
			Math.floor(
				(left % 3600000) / 60000
			);

		return (
			"Renews in " +
			hours +
			"h " +
			minutes +
			"m (midnight UTC+8)"
		);

	}

	function closeCreditPopover() {

		const popover =
			document.getElementById(
				"credit-popover"
			);

		const button =
			document.getElementById(
				"credit-pill-btn"
			);

		if (popover) {
			popover.hidden = true;
		}

		if (button) {
			button.setAttribute(
				"aria-expanded",
				"false"
			);
		}

	}

	function creditCountText(
		count,
		singular,
		plural
	) {

		const value =
			Number(count) || 0;

		return (
			creditFormatNumber(
				value
			) +
			" " +
			(value === 1
				? singular
				: plural)
		);

	}

	function creditRow(
		label,
		value
	) {

		const row =
			document.createElement(
				"div"
			);

		row.className =
			"credit-row";

		const name =
			document.createElement(
				"span"
			);

		name.textContent =
			label;

		const amount =
			document.createElement(
				"b"
			);

		amount.textContent =
			value;

		row.appendChild(
			name
		);

		row.appendChild(
			amount
		);

		return row;

	}

	function renderCreditPopover() {

		const popover =
			document.getElementById(
				"credit-popover"
			);

		if (!popover) {
			return;
		}

		popover.innerHTML =
			"";

		const head =
			document.createElement(
				"div"
			);

		head.className =
			"credit-popover-head";

		const title =
			document.createElement(
				"span"
			);

		title.textContent =
			"Daily credits";

		const plan =
			document.createElement(
				"span"
			);

		plan.className =
			"credit-plan-tag";

		plan.textContent =
			creditPlanLabel();

		head.appendChild(
			title
		);

		head.appendChild(
			plan
		);

		popover.appendChild(
			head
		);

		popover.appendChild(
			creditRow(
				"\\ud83c\\udfac Video projects",
				"Unlimited"
			)
		);

		popover.appendChild(
			creditRow(
				"\\ud83d\\uddbc Pixabay images",
				creditImagesValue()
			)
		);

		popover.appendChild(
			creditRow(
				"\\u2728 AI scripts",
				"Unlimited"
			)
		);

		popover.appendChild(
			creditRow(
				"\\ud83c\\udfa4 Voiceovers",
				"Unlimited"
			)
		);

		if (
			creditState &&
			creditState.used
		) {

			const used =
				document.createElement(
					"div"
				);

			used.className =
				"credit-used";

			used.textContent =
				"Used today: " +
				creditCountText(
					creditState.used.images,
					"image",
					"images"
				) +
				" \u00b7 " +
				creditCountText(
					creditState.used.scripts,
					"script",
					"scripts"
				) +
				" \u00b7 " +
				creditCountText(
					creditState.used.voiceovers,
					"voiceover",
					"voiceovers"
				);

			popover.appendChild(
				used
			);

		}

		const reset =
			document.createElement(
				"div"
			);

		reset.className =
			"credit-reset";

		reset.textContent =
			creditResetText();

		popover.appendChild(
			reset
		);

		/*
		 * #261 local record. Stored in this browser only; clearing it does
		 * not restore server credits and a full local record never grants
		 * extra ones.
		 */
		const localNote =
			document.createElement(
				"div"
			);

		localNote.className =
			"credit-reset credit-local";

		const localText =
			localUsageText();

		localNote.textContent =
			localText
				? "This device today: " +
					localText +
					". Local record only \\u2014 server credits are authoritative."
				: "This device: no local usage recorded yet.";

		popover.appendChild(
			localNote
		);

		const clearLocal =
			document.createElement(
				"button"
			);

		clearLocal.type =
			"button";
		clearLocal.className =
			"credit-local-clear";
		clearLocal.textContent =
			"Clear this device's usage record";

		clearLocal.addEventListener(
			"click",
			(event) => {

				event.stopPropagation();
				clearLocalUsage();

			}
		);

		popover.appendChild(
			clearLocal
		);

		/*
		 * A guest can turn the anonymous IP allowance into a
		 * named account at any time (same 10,000/day ceiling).
		 */
		if (
			creditState &&
			creditState.plan &&
			creditState.plan.id ===
				"guest"
		) {

			const cta =
				document.createElement(
					"button"
				);

			cta.type =
				"button";

			cta.className =
				"credit-signup";

			cta.textContent =
				"Create a free account \u2014 10,000 images/day";

			cta.addEventListener(
				"click",
				(event) => {

					event.stopPropagation();
					closeCreditPopover();
					showAuthOverlay("signup");

				}
			);

			popover.appendChild(
				cta
			);

		}

	}

	function toggleCreditPopover() {

		const popover =
			document.getElementById(
				"credit-popover"
			);

		const button =
			document.getElementById(
				"credit-pill-btn"
			);

		if (!popover) {
			return;
		}

		const open =
			popover.hidden;

		popover.hidden =
			!open;

		if (button) {
			button.setAttribute(
				"aria-expanded",
				open
					? "true"
					: "false"
			);
		}

		if (open) {

			renderCreditPopover();

			/*
			 * Opening the popover is a cheap moment to
			 * re-read the server counters.
			 */
			refreshCredits();

		}

	}

	function renderCreditPill() {

		if (!creditState) {

			hideCreditPill();

			return;

		}

		let pill =
			document.getElementById(
				"credit-pill"
			);

		if (!pill) {

			pill =
				document.createElement(
					"div"
				);

			pill.id =
				"credit-pill";

			pill.className =
				"credit-pill";

			const button =
				document.createElement(
					"button"
				);

			button.type =
				"button";

			button.id =
				"credit-pill-btn";

			button.className =
				"credit-pill-btn";

			button.setAttribute(
				"aria-haspopup",
				"true"
			);

			button.setAttribute(
				"aria-expanded",
				"false"
			);

			button.setAttribute(
				"aria-controls",
				"credit-popover"
			);

			const dot =
				document.createElement(
					"span"
				);

			dot.className =
				"credit-pill-dot";

			const plan =
				document.createElement(
					"span"
				);

			plan.className =
				"credit-pill-plan";

			plan.id =
				"credit-pill-plan";

			const separator =
				document.createElement(
					"span"
				);

			separator.className =
				"credit-pill-sep";

			const images =
				document.createElement(
					"span"
				);

			images.className =
				"credit-pill-images";

			images.id =
				"credit-pill-images";

			const caret =
				document.createElement(
					"span"
				);

			caret.className =
				"credit-pill-caret";

			caret.setAttribute(
				"aria-hidden",
				"true"
			);

			caret.textContent =
				"\\u25be";

			button.appendChild(
				dot
			);

			button.appendChild(
				plan
			);

			button.appendChild(
				separator
			);

			button.appendChild(
				images
			);

			button.appendChild(
				caret
			);

			button.addEventListener(
				"click",
				(event) => {

					event.stopPropagation();

					toggleCreditPopover();

				}
			);

			const popover =
				document.createElement(
					"div"
				);

			popover.id =
				"credit-popover";

			popover.className =
				"credit-popover";

			popover.hidden =
				true;

			pill.appendChild(
				button
			);

			pill.appendChild(
				popover
			);

			document.body.appendChild(
				pill
			);

		}

		const planEl =
			document.getElementById(
				"credit-pill-plan"
			);

		const imagesEl =
			document.getElementById(
				"credit-pill-images"
			);

		if (planEl) {

			planEl.textContent =
				creditPlanLabel();

		}

		if (imagesEl) {

			imagesEl.textContent =
				creditImagesValue();

		}

		renderCreditPopover();

		pill.hidden =
			false;

	}

	function hideCreditPill() {

		closeCreditPopover();

		const pill =
			document.getElementById(
				"credit-pill"
			);

		if (pill) {
			pill.hidden = true;
		}

	}

	function updateAccountCreditLine() {

		const line =
			document.getElementById(
				"auth-account-credits"
			);

		if (!line) {
			return;
		}

		const local =
			localUsageText();

		line.textContent =
			(creditState
				? "Plan: " +
					creditPlanLabel() +
					" \\u2014 " +
					creditImagesValue()
				: "") +
			(local
				? (creditState ? "  \\u00b7  " : "") +
					"This device: " +
					local
				: "");

		line.title =
			local
				? "Recorded by this browser only (" +
					local +
					" today). Server credits remain authoritative."
				: "";

	}

	/*
	 * #261: local usage record (localStorage + a two-day cookie).
	 *
	 * This is display/history only. It lives on the user's device, can be
	 * cleared, and is never read by the Worker to grant credits: the
	 * existing KV counters and authentication still authorize every paid
	 * request, and /api/credits stays authoritative.
	 */
	function localUsageText() {

		try {

			return studioUsage.describe();

		}
		catch (usageError) {

			return "";

		}

	}

	function refreshLocalUsageUi() {

		try {

			updateAccountCreditLine();

		}
		catch (lineError) {

			/* the account box may not be on screen */

		}

		const popover =
			document.getElementById(
				"credit-popover"
			);

		if (popover && !popover.hidden) {
			renderCreditPopover();
		}

	}

	function recordStudioUsage(
		kind,
		outcome,
		count
	) {

		try {

			studioUsage.record(
				kind,
				outcome,
				count
			);

		}
		catch (usageError) {

			return;

		}

		refreshLocalUsageUi();

	}

	function clearLocalUsage() {

		try {

			studioUsage.clear();

		}
		catch (usageError) {

			/* ignore */

		}

		refreshLocalUsageUi();

	}

	function applyCredits(
		data
	) {

		if (
			!data ||
			!data.plan ||
			!data.remaining
		) {

			return;

		}

		creditState =
			data;

		/* #261: mirror the authoritative summary into the local record. */
		try {
			studioUsage.observe(data);
		}
		catch (usageError) {
			/* a local record never blocks credits */
		}

		renderCreditPill();

		updateAccountCreditLine();

	}

	function resetCredits() {

		creditState =
			null;

		hideCreditPill();

		updateAccountCreditLine();

	}

	async function refreshCredits() {

		try {

			const response =
				await fetch(
					"/api/credits",
					{
						credentials:
							"same-origin",

						cache:
							"no-store",
					}
				);

			if (!response.ok) {

				resetCredits();

				return null;

			}

			let data =
				null;

			try {

				data =
					await response.json();

			}
			catch (jsonError) {

				data = null;

			}

			applyCredits(data);

			return data;

		}
		catch (netError) {

			return null;

		}

	}

	document.addEventListener(
		"click",
		(event) => {

			const pill =
				document.getElementById(
					"credit-pill"
				);

			if (
				pill &&
				!pill.contains(
					event.target
				)
			) {

				closeCreditPopover();

			}

		}
	);

	document.addEventListener(
		"keydown",
		(event) => {

			if (event.key === "Escape") {
				closeCreditPopover();
			}

		}
	);

	// =========================================================
	// MODULE 7: api-render + background worker
	// (POST /api/render takes ALL of a video's elements and
	//  outputs the finished MP4; the background-worker mode
	//  on the current-day settings route renders those jobs in this browser)
	// =========================================================

	function apiSleep(ms) {

		return new Promise(
			(resolve) => {
				setTimeout(resolve, ms);
			}
		);

	}

	function b64ToBytes(b64) {

		const bin = atob(b64);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) {
			bytes[i] = bin.charCodeAt(i);
		}
		return bytes;

	}

	function fileToB64(file) {

		return new Promise(
			(resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const result =
						String(reader.result || "");
					const comma =
						result.indexOf(",");
					resolve(
						comma >= 0
							? result.substring(comma + 1)
							: ""
					);
				};
				reader.onerror = () =>
					reject(reader.error);
				reader.readAsDataURL(file);
			}
		);

	}

	function downloadBlob(
		blob,
		fileName
	) {

		const url =
			createStudioObjectUrl(
				blob
			);

		const a =
			document.createElement(
				"a"
			);

		a.href =
			url;

		a.download =
			fileName;

		document.body.appendChild(
			a
		);

		a.click();

		a.remove();

		setTimeout(
			() => {
				releaseStudioObjectUrl(
					url
				);
			},
			2000
		);

	}

	/*
	 * Collects ALL of video n's elements
	 * (assets, MP3, title, font, colour,
	 * quality, captions) for the
	 * /api/render payload.
	 */
	function collectVideoPayload(
		n
	) {

		const project =
			videoProjects[n - 1];

		const rowsEl =
			document.getElementById(
				"va-captions-" + n
			);

		const captions =
			[];

		if (rowsEl) {

			rowsEl.querySelectorAll(
				".caption-row"
			).forEach(
				(row) => {

					const hh =
						Number(
							row.querySelector(
								".caption-hh"
							).value ||
							0
						);

					const mm =
						Number(
							row.querySelector(
								".caption-mm"
							).value ||
							0
						);

					const ss =
						Number(
							row.querySelector(
								".caption-ss"
							).value ||
							0
						);

					captions.push(
						{
							time:
								hh * 3600 +
								mm * 60 +
								ss,
							text:
								row.querySelector(
									".caption-text"
								).value
						}
					);

				}
			);

		}

		const detail =
			composeEditorProjectDetail(
				project,
				n
			);

		return {
			name:
				project.name,
			projectDetail:
				detail,
			project: {
				title:
					document.getElementById(
						"va-title-" + n
					).value,
				font:
					document.getElementById(
						"va-font-" + n
					).value,
				color:
					document.getElementById(
						"va-color-" + n
					).value,
				quality:
					document.getElementById(
						"va-quality-" + n
					).value,
				captions:
					captions,
				subtitles:
					project.subtitles ||
					[],
				projectDetail:
					detail
			},
			assets:
				project.assets,
			audioFile:
				project.audioFile ||
				null
		};

	}

	/*
	 * Prefer the user's browser for studio exports. The legacy remote path
	 * remains available to explicit callers passing { remote: true }; external
	 * users of /api/render and the background worker protocol are unchanged.
	 */
	async function apiRenderVideo(
		n, options
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		if (
			!project.assets.length
		) {

			alert(
				project.name +
					": add at least one image, GIF or MP4 first."
			);

			return;

		}

		// Do not serialize media or create a queue job for normal studio exports.
		if (!options || options.remote !== true) {
			await renderVideoLocally(n);
			return;
		}

		const payload =
			collectVideoPayload(
				n
			);

		const assets =
			[];

		for (
			const a of payload.assets
		) {

			assets.push(
				{
					name:
						a.file.name,
					type:
						a.file.type ||
						"",
					data:
						await fileToB64(
							a.file
						)
				}
			);

		}

		let audio =
			null;

		if (payload.audioFile) {

			audio = {
				name:
					payload.audioFile.name,
				type:
					payload.audioFile.type ||
					"audio/mpeg",
				data:
					await fileToB64(
						payload.audioFile
					)
			};

		}

		const statusText =
			document.getElementById(
				"status-text"
			);

		if (statusText) {
			statusText.textContent =
				"API: uploading " +
				payload.name +
				" ...";
		}

		let response;

		try {

			response =
				await fetch(
					"/api/render",
					{
						method: "POST",
						headers: {
							"Content-Type":
								"application/json"
						},
						body: JSON.stringify(
							{
								name:
									payload.name,
								project:
									payload.project,
								assets:
									assets,
								audio:
									audio
							}
						),
						credentials:
							"same-origin"
					}
				);

		}
		catch (netError) {

			alert(
				"API error: " +
					(netError.message ||
						netError)
			);

			return;

		}

		const submitted =
			await response.json().catch(
				() => ({})
			);

		/*
		 * Busy (10/10 jobs in progress):
		 * not an error \u2014 this browser
		 * renders the video itself with
		 * its own video generation (the
		 * same engine the Generate
		 * Videos button uses).
		 */
		if (
			response.ok &&
			submitted.status ===
				"busy"
		) {

			if (statusText) {
				statusText.textContent =
					"API is busy (" +
					(submitted.inProgress ||
						10) +
					"/" +
					(submitted.max ||
						10) +
					" jobs) \u2014 rendering " +
					payload.name +
					" in this browser ...";
			}

			await renderVideoLocally(
				n
			);

			return;

		}

		if (
			!response.ok ||
			!submitted.jobId
		) {

			alert(
				"API: " +
					(submitted.error ||
						"request failed (" +
						response.status +
						")")
			);

			return;

		}

		const jobId =
			submitted.jobId;

		while (true) {

			await apiSleep(
				4000
			);

			if (statusText) {
				statusText.textContent =
					"API: " +
					payload.name +
					" \u2014 waiting for a worker to render ...";
			}

			let r;

			try {

				r =
					await fetch(
						"/api/render/" +
							jobId,
						{
							credentials:
								"same-origin"
						}
					);

			}
			catch (netError) {
				continue;
			}

			const contentType =
				r.headers.get(
					"Content-Type"
				) ||
				"";

			if (
				r.status === 200 &&
				contentType.indexOf(
					"video/"
				) ===
					0
			) {

				const blob =
					await r.blob();

				downloadBlob(
					blob,
					"API_" +
					payload.name.replace(
						/\\s+/g,
						""
					) +
					".mp4"
				);

				if (statusText) {
					statusText.textContent =
						"\u2713 API render complete: " +
						payload.name;
				}

				return;

			}

			if (r.status === 500) {

				const j =
					await r.json().catch(
						() => ({})
					);

				alert(
					"Render failed: " +
						(j.error ||
							"unknown error")
				);

				return;

			}

			if (r.status === 404) {

				alert(
					"API: job expired or not found."
				);

				return;

			}

		}

	}

	/*
	 * The web app's OWN video generation:
	 * the same internal engine the
	 * Generate Videos button runs, for
	 * just one video. Used as the
	 * fallback when the render API
	 * answers "busy".
	 */
	async function renderVideoLocally(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		if (generating || batchRenderBusy || window.__workerMode) {

			alert(
				"A video is already being generated \u2014 please wait for it to finish."
			);

			return;

		}

		generating =
			true;

		const renderBtn =
			document.getElementById(
				"render-btn"
			);

		const statusText =
			document.getElementById(
				"status-text"
			);

		if (renderBtn) {
			renderBtn.disabled =
				true;
		}

		/*
		 * Snapshot the engine's working
		 * state so it can be restored.
		 */
		const saved = {
			slides:
				activeSlides.slice(),
			audio:
				currentAudio,
			captionRows:
				Array.from(
					captionRowsEl.children
				),
			title:
				document.getElementById(
					"title-input"
				).value,
			font:
				document.getElementById(
					"title-font"
				).value,
			color:
				document.getElementById(
					"title-color"
				).value,
			quality:
				document.getElementById(
					"quality-select"
				).value,
		};

		project.status =
			"rendering";

		updateVideoStatus(
			n
		);

		if (statusText) {
			statusText.textContent =
				"Rendering " +
				project.name +
				" in this browser ...";
		}

		let result =
			"error";

		try {

			const slides =
				await prepareVideo(
					n
				);

			swapVaCaptionsIn(
				n
			);

			document.getElementById(
				"title-input"
			).value =
				document.getElementById(
					"va-title-" + n
				).value;

			document.getElementById(
				"title-font"
			).value =
				document.getElementById(
					"va-font-" + n
				).value;

			document.getElementById(
				"title-color"
			).value =
				document.getElementById(
					"va-color-" + n
				).value;

			document.getElementById(
				"quality-select"
			).value =
				document.getElementById(
					"va-quality-" + n
				).value;

			activeSlides.length =
				0;

			for (
				const slide of slides
			) {

				activeSlides.push(
					slide
				);

			}

			currentAudio =
				project.audio;

			renderContext = {
				videoStyle: project.videoImageStyle,
				fileName:
					"YouTubeVibeStudio_" +
					project.name.replace(
						/\\s+/g,
						""
					) +
					".mp4",
				subtitles:
					project.subtitles ||
					[],
			};

			result =
				(await generateMP4()) ||
				"skipped";

		}
		catch (localError) {

			console.error(
				project.name +
					" local render failed:",
				localError
			);

		}
		finally {

			swapVaCaptionsOut(
				n
			);

			activeSlides.length =
				0;

			for (
				const slide of
					saved.slides
			) {

				activeSlides.push(
					slide
				);

			}

			currentAudio =
				saved.audio;

			captionRowsEl.innerHTML =
				"";

			for (
				const row of
					saved.captionRows
			) {

				captionRowsEl.appendChild(
					row
				);

			}

			if (
				typeof updateCaptionCount ===
					"function"
			) {

				updateCaptionCount();

			}

			document.getElementById(
				"title-input"
			).value =
				saved.title;

			document.getElementById(
				"title-font"
			).value =
				saved.font;

			document.getElementById(
				"title-color"
			).value =
				saved.color;

			document.getElementById(
				"quality-select"
			).value =
				saved.quality;

			renderContext =
				null;

			generating =
				false;

			if (renderBtn) {
				renderBtn.disabled =
					false;
			}

		}

		if (result === "done") {
			project.status =
				"done";
		}
		else if (
			result === "error"
		) {
			project.status =
				"error";
		}
		else {
			project.status =
				"skipped";
		}

		updateVideoStatus(
			n
		);

		if (statusText) {
			statusText.textContent =
				result ===
					"done"
					? "\u2713 " +
						project.name +
						" rendered in this browser"
					: project.name +
						" local render " +
						result;
		}

	}

	/*
	 * Background-worker side: runs one render
	 * job (from /api/worker/poll) through the
	 * hidden engine, then POSTs the finished
	 * MP4 to /api/worker/deliver. Used by the
	 * day-prefixed settings page in worker mode.
	 */
	async function workerRunJob(
		job
	) {

		// All three export paths share the same renderer and mutable state.
		if (generating || batchRenderBusy || window.__workerMode) {
			throw new Error("Another video is already being rendered in this browser");
		}

		window.__workerMode =
			true;

		window.__lastRenderBlob =
			null;

		const project = {
			n: 1,
			name:
				job.name ||
				"Video",
			assets: [],
			audioFile:
				null,
			audio:
				null,
			status:
				"rendering",
			el:
				null
		};

		try {

			for (
				const a of
					job.assets ||
					[]
			) {

				const file =
					new File(
						[
							b64ToBytes(
								a.data
							)
						],
						a.name ||
						"asset",
						{
							type:
								a.type ||
								"application/octet-stream"
						}
					);

				const looksGif =
					/\\.gif$/i.test(
						a.name ||
						""
					) ||
					(a.type ||
						"").indexOf(
						"image/gif"
					) ===
						0;

				const looksMp4 =
					/\\.mp4$/i.test(
						a.name ||
						""
					) ||
					/\\.m4v$/i.test(
						a.name ||
						""
					) ||
					(a.type ||
						"").indexOf(
						"video/mp4"
					) ===
						0;

				const asset = {
					kind:
						looksGif
							? "gif"
							: looksMp4
								? "mp4"
								: "image",
					file:
						file,
					url:
						null,
					card:
						null
				};

				if (
					asset.kind ===
						"mp4"
				) {

					const url =
						createStudioObjectUrl(
							file
						);

					const probed =
						document.createElement(
							"video"
						);

					/*
					 * Same probe as the editor's upload path: a
					 * deadline, a decodable container, and a
					 * finite duration. A skipped clip is better
					 * than a job that restores a NaN length and
					 * renders no frames at all.
					 */

					let clipDuration =
						0;

					try {

						clipDuration =
							await probeMp4DurationWithRetry(
								url,
								2,
								probed
							);

					}
					catch (probeError) {

						console.error(
							"Saved clip could not be probed:",
							probeError
						);

						releaseStudioObjectUrl(
							url
						);

						continue;

					}

					probed.loop =
						true;

					asset.videoEl =
						probed;

					asset.duration =
						clipDuration;

					asset.url =
						url;

				}
				else {

					asset.url =
						createStudioObjectUrl(
							file
						);

				}

				project.assets.push(
					asset
				);

			}

			if (
				job.audio &&
				job.audio.data
			) {

				project.audioFile =
					new File(
						[
							b64ToBytes(
								job.audio.data
							)
						],
						job.audio.name ||
						"audio.mp3",
						{
							type:
								job.audio.type ||
								"audio/mpeg"
						}
					);

			}

			videoProjects.length =
				0;

			videoProjects.push(
				project
			);

			const p =
				job.project ||
				{};

			document.getElementById(
				"title-input"
			).value =
				p.title ||
				"";

			document.getElementById(
				"title-font"
			).value =
				p.font ||
				"oswald";

			document.getElementById(
				"title-color"
			).value =
				p.color ||
				"white";

			document.getElementById(
				"quality-select"
			).value =
				p.quality ||
				"balanced";

			captionRowsEl.innerHTML =
				"";

			(
				p.captions ||
				[]
			).forEach(
				(c) => {

					const t =
						Number(
							c.time ||
							0
						);

					const row =
						document.createElement(
							"div"
						);

					row.className =
						"caption-row";

					row.innerHTML =
						vaCaptionRowHTML();

					row.querySelector(
						".caption-hh"
					).value =
						Math.floor(
							t /
							3600
						);

					row.querySelector(
						".caption-mm"
					).value =
						Math.floor(
							(t % 3600) /
							60
						);

					row.querySelector(
						".caption-ss"
					).value =
						t %
						60;

					row.querySelector(
						".caption-text"
					).value =
						c.text ||
						"";

					captionRowsEl.appendChild(
						row
					);

				}
			);

			if (
				typeof updateCaptionCount ===
					"function"
			) {

				updateCaptionCount();

			}

			const slides =
				await prepareVideo(
					1
				);

			activeSlides.length =
				0;

			for (
				const s of slides
			) {

				activeSlides.push(
					s
				);

			}

			currentAudio =
				project.audio;

			renderContext = {
				fileName:
					"Worker_" +
					(job.name ||
						"video").replace(
						/\\s+/g,
						""
					) +
					".mp4",
				subtitles:
					(job.project &&
						job.project.subtitles) ||
					[]
			};

			const result =
				await generateMP4();

			const blob =
				window.__lastRenderBlob;

			if (
				result !==
					"done" ||
				!blob
			) {

				throw new Error(
					"render produced no output"
				);

			}

			// A timed-out browser worker may still finish its underlying render.
			// Never deliver that stale result after its operator reported failure.
			if (job._workerTimedOut) {
				throw new Error("Worker render timed out; output was not delivered.");
			}

			const resp =
				await fetch(
					"/api/worker/deliver?job=" +
						job.id,
					{
						method: "POST",
						body:
							blob,
						credentials:
							"same-origin"
					}
				);

			const d =
				await resp.json().catch(
					() => ({})
				);

			if (!resp.ok) {

				throw new Error(
					d.error ||
					"deliver failed (" +
					resp.status +
					")"
				);

			}

		}
		finally {

			for (
				const a of
					project.assets
			) {

				if (a.url) {
					releaseStudioObjectUrl(
						a.url
					);
				}

			}

			videoProjects.length =
				0;

			activeSlides.length =
				0;

			currentAudio =
				null;

			renderContext =
				null;

			window.__workerMode =
				false;

		}

	}

	/*
	 * On load: ask the worker who we
	 * are. The current-day settings page skips the
	 * auth lock (it has its own password
	 * gate) and may run as a background
	 * worker.
	 */
	async function initAuth() {

		if (window.__CONFIG_PAGE) {
			authAccess = "open";
			showStudioView();
			return;
		}

		/* /free is usable without an account; do not wait for a slow or
		 * stalled session check before showing its studio. The server still
		 * enforces guest credits and detects any signed-in account. */
		if (PLAN_MODE === "freemium") {
			authAccess = "freemium";
			showStudioView();
		}

		try {

			const response =
				await fetch(
					"/api/session",
					{
						credentials:
							"same-origin",
					}
				);

			/* A successful sign-in may finish while the session check is in flight. */
			if (authAccess === "authenticated") {
				return;
			}

			if (response.status === 503) {

				/* No account storage: /free still opens the studio directly.
				 * The landing page keeps its existing open-access action. */
				if (PLAN_MODE === "freemium") {
					authAccess = "freemium";
					hideAuthOverlay();
					showStudioView();
					refreshCredits();
				}
				else {
					authAccess = "open";
					resumeLandingEntry();
				}
				return;

			}

			if (response.ok) {

				let data =
					{};

				try {

					data =
						await response.json();

				}
				catch (jsonError) {

					/* keep {} */

				}

				authAccess = "authenticated";
				hideAuthOverlay();
				showStudioView();

				showUserBadge(
					data.user &&
					data.user.username
						? data.user.username
						: "",
					data.user &&
					data.user.email
						? data.user.email
						: ""
				);

				/*
				 * GET /api/session carries the plan and the
				 * day's counters; fall back to /api/credits
				 * for an older worker response.
				 */
				if (data.credits) {

					applyCredits(
						data.credits
					);

				}
				else {

					refreshCredits();

				}

				return;

			}

			/*
			 * /free is the freemium entry: no account
			 * needed, boot the studio with the IP-keyed
			 * guest credits (10,000 images per day).
			 */
			if (PLAN_MODE === "freemium") {
				authAccess = "freemium";
				hideAuthOverlay();
				showStudioView();
				refreshCredits();
				return;
			}

			/* A missing/invalid session leaves the public landing open. */
			authAccess = "required";
			showLandingView();
			resumeLandingEntry();

		}
		catch (netError) {

			if (PLAN_MODE === "freemium") {
				authAccess = "freemium";
				showStudioView();
				refreshCredits();
				return;
			}

			/* A session endpoint outage must not lock out open access. */
			authAccess = "open";
			resumeLandingEntry();

		}

	}

	// =========================================================
	// =========================================================
	// MODULE 8: script (plain narration text)
	// (AI script generation. The server route /api/script uses
	//  an INSTRUCT model on Workers AI, set in the SCRIPT_MODEL
	//  constant - the old free llama-3.1-8b-instruct was
	//  deprecated by Cloudflare on 2026-05-30, so it is now the
	//  cheap llama-3.1-8b-instruct-fp8 instruct model. Minutes
	//  1-6 + speech speed: super fast / fast / medium / slow.)
	//
	// WHAT THE CLIENT HOLDS: plain spoken text only. The
	// worker uses cue timings internally to prove the script
	// fits the requested minutes, then sends the sentences.
	// There is deliberately no subtitle format anywhere in the
	// browser - the voiceover model would read cue numbers and
	// "-->" timestamps out loud, so no code here parses or
	// renders one either.
	// =========================================================

	/*
	 * The editor's script textbox is pinned while a browser-owned write is
	 * in flight (and while its silent retry ladder is still waiting). No later
	 * state paint, toggle or accordion renumber may hide it over time.
	 */
	function scriptBoxLockedVisible(project, box) {
		return Boolean(
			(project && (project._scriptWriting || project._scriptKeepWritingUi)) ||
			(box && box.classList.contains("va-script-loading"))
		);
	}

	function setScriptBoxState(
		n,
		open
	) {

		const project =
			videoProjects[n - 1];

		const hasScript =
			!!(project && project.script);

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		const toggle =
			document.getElementById(
				"va-script-toggle-" + n
			);

		const keepVisible =
			scriptBoxLockedVisible(project, box);
		const showBox =
			keepVisible || (hasScript && !!open);

		if (box) {
			box.style.display =
				showBox ? "" : "none";
			if (keepVisible && !box.classList.contains("va-script-loading")) setScriptLoading(n, true);
		}

		if (toggle) {
			toggle.style.display =
				hasScript || keepVisible ? "" : "none";

			toggle.textContent =
				(showBox
					? "\u25b2 "
					: "\u25bc ") +
				"Script";
		}

	}

	function toggleScriptBox(n) {

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		if (!box) {
			return;
		}

		setScriptBoxState(
			n,
			box.style.display === "none"
		);

	}

	function showScriptBox(n) {

		setScriptBoxState(n, true);

	}

	/*
	 * The voiceover speaks the generated
	 * narration script, so its button stays
	 * HIDDEN while the video has no script
	 * and is revealed + enabled as soon as
	 * one has been generated.
	 */

	function syncVoiceoverButton(n) {

		const project =
			videoProjects[n - 1];

		const btn =
			document.getElementById(
				"va-voice-btn-" + n
			);

		if (!btn) {
			return;
		}

		const hasScript =
			!!(project && project.script);

		btn.style.display =
			hasScript ? "" : "none";

		btn.disabled =
			!hasScript;

	}

	function toggleGalleryScroll(n) {

		const gallery =
			document.getElementById(
				"va-gallery-" + n
			);

		const toggle =
			document.getElementById(
				"va-gallery-toggle-" + n
			);

		if (!gallery || !toggle) {
			return;
		}

		const open =
			gallery.style.display === "none";

		gallery.style.display =
			open ? "" : "none";

		toggle.textContent =
			(open
				? "\u25b2 "
				: "\u25bc ") +
			"Images / MP4s";

	}

	/*
	 * Shows the full SEO plan the worker
	 * verified for this explainer script:
	 * the AI title (it carries at least
	 * one short keyword), the section
	 * headings (at least one carries a
	 * short keyword), the single long-tail
	 * keyword and the exactly 4 short
	 * keywords - each with how often it
	 * actually appears in the spoken
	 * script. Frequency is a MINIMUM
	 * only: the long-tail keyword must
	 * be said at least once and every
	 * short keyword at least twice, and
	 * extra uses are never rejected.
	 * The counts come from the worker,
	 * which counts them after stripping
	 * cue numbers and timestamps.
	 */

	function renderSeoKeywords(
		n,
		data
	) {

		const box =
			document.getElementById(
				"va-script-keywords-" + n
			);

		if (!box) {
			return;
		}

		const keywords =
			(data && data.keywords) || {};

		/* one long-tail object (not an array) */
		const longs =
			keywords.longTail &&
			keywords.longTail.keyword
				? [keywords.longTail]
				: [];

		const shorts =
			Array.isArray(keywords.short)
				? keywords.short
				: [];

		const title =
			(data && data.title) || "";

		const headings =
			data && Array.isArray(data.headings)
				? data.headings
				: [];

		if (
			!title &&
			!headings.length &&
			!longs.length &&
			!shorts.length
		) {

			box.style.display = "none";

			box.innerHTML = "";

			return;

		}

		let html =
			'<div class="va-seo-heading">SEO plan \u2014 counted in the script</div>';

		if (title) {

			html +=
				'<div class="va-seo-row">' +
				'<span class="va-seo-label">Title</span>' +
				'<span class="va-seo-chip" title="Explainer title \u2014 includes at least one short keyword">' +
				escapeHTML(title) +
				"</span></div>";

		}

		if (headings.length) {

			html +=
				'<div class="va-seo-row">' +
				'<span class="va-seo-label">Headings</span>';

			headings.forEach(
				(item) => {

					html +=
						'<span class="va-seo-chip" title="Section heading \u2014 at least one heading includes a short keyword">' +
						escapeHTML(item) +
						"</span>";

				}
			);

			html +=
				"</div>";

		}

		html +=
			'<div class="va-seo-row">' +
			'<span class="va-seo-label">Long-tail</span>';

		longs.forEach(
			(item) => {

				html +=
					'<span class="va-seo-chip long" title="Long-tail keyword \u2014 must be said at least ' +
					item.min +
					'\u00d7">' +
					escapeHTML(item.keyword) +
					" <b>" +
					item.count +
					"\u00d7</b></span>";

			}
		);

		html +=
			'</div><div class="va-seo-row">' +
			'<span class="va-seo-label">Short</span>';

		shorts.forEach(
			(item) => {

				html +=
					'<span class="va-seo-chip short" title="Short keyword \u2014 must be said at least ' +
					item.min +
					'\u00d7; shared occurrences inside the long-tail count too; one short keyword is in the title and one in a heading">' +
					escapeHTML(item.keyword) +
					" <b>" +
					item.count +
					"\u00d7</b></span>";

			}
		);

		html +=
			"</div>";

		box.innerHTML =
			html;

		box.style.display =
			"";

	}


	// =========================================================
	// MODULE 8b: seo-walkthrough + one-shot Pixabay image generation
	//
	// Generate SEO Script now runs a walkthrough:
	//   1. The "Upload Image, GIF or MP4" button is disabled and
	//      a modal asks the AI (POST /api/seo-plan) for TWO
	//      different SEO keyword sets for the topic. The modal
	//      can be closed while the plan is generated; the work
	//      keeps running in the background and the modal
	//      re-opens by itself when the two sets arrive.
	//   2. The user clicks Select on one set, then enters the
	//      video image style. With both chosen the walkthrough
	//      moves to its "writing" panel, the script section shows
	//      a loading animation and POST /api/script writes the
	//      plain narration script from the selected set. The
	//      browser retries any writing error seven times, waits
	//      40 seconds before each retry, and keeps the textbox,
	//      spinner and writing state continuously visible.
	//   3. The browser requests at most THREE scene prompts, starts their
	//      image stream, and requests the next prompt batch concurrently.
	//      One lookahead batch bounds memory; retries apply only to prompts.
	//   4. Every image stream is drained before the next starts. Finalization
	//      counts the whole flow and restores this video's controls. No KV,
	//      background jobs, server-side video management or polling is needed.
	// =========================================================

	/*
	 * ---------------------------------------------------------
	 * MODAL STACK (shared by the walkthrough + voiceover modals)
	 *
	 * More than one video can be mid-walkthrough at the same
	 * time, so a modal is never a single shared element any
	 * more: every modal is registered here, gets its own
	 * z-index above the one before it, and is closed only by its
	 * own video. A modal that still owes the user a choice (a
	 * keyword set or a video image style) refuses to be hidden by
	 * Escape, so a click in another accordion can never lose it.
	 * ---------------------------------------------------------
	 */

	const MODAL_BASE_Z_INDEX = 1200;

	const modalStack = [];

	function modalBringToFront(modal) {

		if (!modal) {
			return;
		}

		const position = modalStack.indexOf(modal);

		if (position !== -1) {
			modalStack.splice(position, 1);
		}

		modalStack.push(modal);

		modal.style.zIndex =
			String(MODAL_BASE_Z_INDEX + (modalStack.length - 1) * 10);

	}

	function openModal(modal) {

		if (!modal) {
			return;
		}

		if (modal.parentNode !== document.body) {
			document.body.appendChild(modal);
		}

		modalBringToFront(modal);

		modal.style.display = "flex";

	}

	function closeModal(modal) {

		if (!modal) {
			return;
		}

		const position = modalStack.indexOf(modal);

		if (position !== -1) {
			modalStack.splice(position, 1);
		}

		if (modal.parentNode) {
			modal.parentNode.removeChild(modal);
		}

	}

	function topModal() {
		return modalStack.length ? modalStack[modalStack.length - 1] : null;
	}

	/* The walkthrough keeps a choice pending until style + set are both in. */
	function modalBlocksEscape(modal) {
		return modal && modal.getAttribute("data-await-choice") === "1";
	}

	document.addEventListener(
		"keydown",
		(event) => {

			if (event.key !== "Escape") {
				return;
			}

			const modal = topModal();

			if (!modal || modalBlocksEscape(modal)) {
				return;
			}

			const dismiss = modal.getAttribute("data-dismiss");

			if (dismiss && typeof window[dismiss] === "function") {
				window[dismiss]();
			}

		}
	);

	/* The whole prompt LLM call happens inside this one request. */
	const IMAGE_PROMPT_REQUEST_TIMEOUT_MS =
		60000;

	/* A batch stream that sends nothing for this long is treated as dead. */
	const IMAGE_BATCH_IDLE_TIMEOUT_MS =
		120000;

	/* Exposed so tests / debugging can see (and shrink) the live timing. */
	if (typeof window !== "undefined") {
		window.__SEO_FLOW_TIMING = {
			imagePromptRequestTimeoutMs: IMAGE_PROMPT_REQUEST_TIMEOUT_MS,
			imageBatchIdleTimeoutMs: IMAGE_BATCH_IDLE_TIMEOUT_MS
		};
	}

	function imageBatchIdleTimeoutMs() {
		const override = typeof window !== "undefined" ? window.__SEO_FLOW_TIMING : null;
		const value = override && Number(override.imageBatchIdleTimeoutMs);
		return value > 0 ? value : IMAGE_BATCH_IDLE_TIMEOUT_MS;
	}

	async function seoFetchWithTimeout(url, options, timeoutMs, project, controllerKey, consumeResponse) {
		if (typeof AbortController === "undefined") {
			const response = await fetch(url, options);
			return consumeResponse ? consumeResponse(response) : response;
		}
		const controller = new AbortController();
		if (project && controllerKey) project[controllerKey] = controller;
		let timedOut = false;
		const timer = setTimeout(function () { timedOut = true; controller.abort(); }, timeoutMs);
		try {
			const response = await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
			return consumeResponse ? await consumeResponse(response) : response;
		}
		catch (error) {
			if (timedOut || batchIsAbortError(error)) {
				throw batchError(timedOut ? "Scene prompt request timed out; please retry." : "Scene prompt request was interrupted.", "TimeoutError");
			}
			throw error;
		}
		finally {
			clearTimeout(timer);
			if (project && controllerKey && project[controllerKey] === controller) {
				project[controllerKey] = null;
			}
		}
	}

	async function seoResponseJson(response) {
		return response.json().catch(function () { return {}; });
	}

	function seoImageStyleOptionsHTML(selectedStyle) {
		const selected = SEO_IMAGE_STYLES.indexOf(selectedStyle) !== -1
			? selectedStyle
			: DEFAULT_SEO_IMAGE_STYLE;
		return SEO_IMAGE_STYLES.map(function (style) {
			return '<option value="' + escapeHTML(style) + '"' +
				(style === selected ? ' selected' : '') +
				'>' + escapeHTML(style) + '</option>';
		}).join("");
	}

	function setVaUploadEnabled(
		n,
		enabled
	) {

		const btn =
			document.getElementById(
				"va-upload-btn-" + n
			);

		if (btn) {
			btn.disabled =
				!enabled;
		}

	}

	function setScriptLoading(
		n,
		on
	) {

		const project =
			videoProjects[n - 1];

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		if (!box) {
			return;
		}

		if (on) {
			/* Pin the textbox for the whole browser-owned retry ladder. */
			if (project) project._scriptKeepWritingUi = true;


			/*
			 * The script box is the user's textbox. A silent retry must not
			 * rebuild (or hide) it: when it is already painting the spinner,
			 * leave exactly the same DOM nodes in place.
			 */
			const alreadyLoading =
				box.classList.contains("va-script-loading") &&
				box.style.display !== "none" &&
				!!box.querySelector(".va-spinner");

			box.classList.add(
				"va-script-loading"
			);

			box.style.display =
				"";

			if (!alreadyLoading) {

				box.innerHTML =
					'<span class="va-spinner" aria-hidden="true"></span><span>Writing your SEO script\\u2026</span>';

			}

		}
		else {

			const keepVisible =
				Boolean(project && project._scriptKeepWritingUi) ||
				box.classList.contains("va-script-loading");

			box.classList.remove(
				"va-script-loading"
			);

			if (
				!(project && project.script)
			) {

				if (keepVisible) {
					/* A later state paint must not make the textbox disappear. */
					box.classList.add("va-script-loading");
					box.style.display = "";
					if (!box.querySelector(".va-spinner")) {
						box.innerHTML =
							'<span class="va-spinner" aria-hidden="true"></span><span>Writing your SEO script\\u2026</span>';
					}
				}
				else {
					box.style.display =
						"none";

					box.textContent =
						"";
				}

			}
			else if (project) {
				project._scriptKeepWritingUi = false;
			}

		}

	}

	/*
	 * ONE walkthrough per video: 'seo-walkthrough-modal-<n>'.
	 * Every element inside it is suffixed the same way, so two
	 * videos can be mid-walkthrough together without either one
	 * stealing, replacing or closing the other's modal — the old
	 * shared '#seo-walkthrough-modal' could only ever hold the
	 * last video that pressed the button, which threw away a
	 * style choice that had not been confirmed yet.
	 */

	function seoWalkthroughModalId(n) {
		return "seo-walkthrough-modal-" + n;
	}

	function getSeoWalkthrough(n) {
		return document.getElementById(seoWalkthroughModalId(n));
	}

	/* One element inside this video's walkthrough. */
	function seoWtEl(n, name) {
		return document.getElementById(name + "-" + n);
	}

	function setSeoWalkthroughChoicePending(
		n,
		pending
	) {

		const modal =
			getSeoWalkthrough(n);

		if (modal) {
			modal.setAttribute(
				"data-await-choice",
				pending ? "1" : "0"
			);
		}

	}

	/* Writes (or clears) the red line at the bottom of one walkthrough. */
	function setSeoWalkthroughError(
		n,
		message
	) {

		const slot =
			seoWtEl(
				n,
				"seo-wt-error"
			);

		if (!slot) {
			return;
		}

		slot.textContent =
			message || "";

	}

	/* Mirrors the accordion status line into the open walkthrough. */
	function setSeoWalkthroughScriptStatus(
		n,
		message
	) {

		const slot =
			seoWtEl(
				n,
				"seo-wt-script-status"
			);

		if (slot) {
			slot.textContent =
				message || "";
		}

	}

	function ensureSeoWalkthrough(
		n
	) {

		/*
		 * Already open for THIS video: bring it to the front
		 * instead of rebuilding it, so an unconfirmed keyword
		 * set / style selection survives another press.
		 */
		const existing =
			getSeoWalkthrough(n);

		if (existing) {
			modalBringToFront(existing);
			existing.style.display = "flex";
			return existing;
		}

		const project = videoProjects[n - 1];

		const selectedStyle = project && SEO_IMAGE_STYLES.indexOf(project.videoImageStyle) !== -1
			? project.videoImageStyle
			: DEFAULT_SEO_IMAGE_STYLE;

		const modal =
			document.createElement(
				"div"
			);

		modal.id =
			seoWalkthroughModalId(n);

		modal.className =
			"modal-overlay";

		modal.setAttribute(
			"data-dismiss",
			"closeSeoWalkthroughTop"
		);

		modal.innerHTML =
			'<div class="modal-box seo-wt-box">' +
			'<div class="modal-title">\\u2728 Generate SEO Script \\u2014 Video ' + n + '</div>' +
			'<div class="seo-wt-steps">' +
			'<span class="seo-wt-step" data-step="plan">1 \\u00b7 SEO plan</span>' +
			'<span class="seo-wt-step" data-step="sets">2 \\u00b7 Choose a keyword set</span>' +
			'<span class="seo-wt-step" data-step="style">3 \\u00b7 Video image style</span>' +
			'<span class="seo-wt-step" data-step="script">4 \\u00b7 Script + images</span>' +
			'</div>' +
			'<div id="seo-wt-loading-' + n + '">' +
			'<div class="seo-wt-loading"><span class="va-spinner" aria-hidden="true"></span><span>AI is planning two SEO keyword sets for <b id="seo-wt-topic-' + n + '"></b>\\u2026</span></div>' +
			'<span class="va-note">You can close this window while you wait \\u2014 the SEO plan and the script keep generating in the background, the modal re-opens itself when there is something to choose, and the finished script lands in Video ' + n + ' \\u00b7 Script. The Upload Image, GIF or MP4 button stays disabled until the Pixabay images are in the gallery.</span>' +
			'</div>' +
			'<div id="seo-wt-sets-' + n + '" style="display:none">' +
			'<div class="va-note">Pick the keyword set that best targets your script topic. The script will say its long-tail keyword at least once and each short keyword at least twice. This window stays open for you \\u2014 other videos keep their own windows.</div>' +
			'<div class="seo-wt-sets" id="seo-wt-sets-list-' + n + '"></div>' +
			'</div>' +
			'<div id="seo-wt-style-' + n + '" style="display:none">' +
			'<div id="seo-wt-selected-' + n + '"></div>' +
			'<label class="seo-wt-style-label" for="seo-wt-style-select-' + n + '">Video treatment (Pixabay stock appearance varies)</label>' +
			'<select id="seo-wt-style-select-' + n + '" aria-describedby="seo-wt-style-note-' + n + '">' + seoImageStyleOptionsHTML(selectedStyle) + '</select>' +
			'<span class="va-note" id="seo-wt-style-note-' + n + '">Choose one visual style. Every scene search is read from your script inside that scene\u2019s own time window, and words from the selected SEO keyword set win over the rest; articles, adjectives and other short words are skipped. Every video plans 12 scenes: 4 silent Pixabay clips and 8 stock photos.</span>' +
			'<span class="va-note">Nothing is lost if you close this window after pressing Generate: the script and its images keep running in the background for Video ' + n + '.</span>' +
			'<div class="seo-wt-actions">' +
			'<button type="button" class="upload-btn" onclick="confirmSeoStyleAndGenerate(' + n + ')">\\u2728 Generate Script &amp; Images</button>' +
			'<button type="button" class="upload-btn" onclick="showSeoWalkthroughStep(' + n + ', &quot;sets&quot;)">\\u2190 Back to keyword sets</button>' +
			'</div>' +
			'</div>' +
			'<div id="seo-wt-script-' + n + '" style="display:none">' +
			'<div class="seo-wt-loading"><span class="va-spinner" aria-hidden="true"></span><span>Writing the Video ' + n + ' narration script from the selected keyword set\\u2026</span></div>' +
			'<span class="va-note"><b>You can close this window while you wait for the SEO script.</b> Closing only hides this window \\u2014 it does not cancel anything. The script keeps generating, the plain narration text appears in Video ' + n + ' \\u00b7 Script, and the Pixabay images start by themselves right after. Press \\u2728 Generate SEO Script again to bring this window back.</span>' +
			'<span class="va-note" id="seo-wt-script-status-' + n + '">Waiting for the script\\u2026</span>' +
			'</div>' +
			'<div class="seo-wt-error" id="seo-wt-error-' + n + '"></div>' +
			'<div class="seo-wt-actions">' +
			'<button type="button" class="upload-btn" onclick="closeSeoWalkthrough(' + n + ')">\\u2715 Close</button>' +
			'</div>' +
			'</div>';

		openModal(
			modal
		);

		const styleSelect = modal.querySelector("#seo-wt-style-select-" + n);

		if (styleSelect && project) {
			styleSelect.addEventListener("change", function () {
				project.videoImageStyle = styleSelect.value;
			});
		}

		return modal;

	}

	/* Removes ONLY this video's walkthrough. */
	function closeSeoWalkthrough(n) {

		const modal =
			typeof n === "number"
				? getSeoWalkthrough(n)
				: topModal();

		if (!modal) {
			return;
		}

		if (typeof n === "number") {
			const project = videoProjects[n - 1];
			/* A pending choice is a real loss: say so, keep the modal. */
			if (project && project._seoChoicePending) {
				setSeoWalkthroughChoicePending(
					n,
					false
				);
				if (project._seoPlanBusy || project._imageFlowActive) {
					project._seoChoicePending = false;
				}
			}
		}

		closeModal(
			modal
		);

	}

	/* Escape / the stack dismisses only the front window, never a video's
	 * walkthrough that is still waiting for the user's style choice. */
	function closeSeoWalkthroughTop() {

		const modal =
			topModal();

		if (!modal || modalBlocksEscape(modal)) {
			return;
		}

		closeModal(
			modal
		);

	}

	function showSeoWalkthrough(n) {

		const modal =
			getSeoWalkthrough(n);

		if (modal) {
			modalBringToFront(modal);
			modal.style.display =
				"flex";
		}

	}

	function showSeoWalkthroughStep(
		n,
		step
	) {

		const modal =
			getSeoWalkthrough(n);

		if (!modal) {
			return;
		}

		const panels = {
			plan: "seo-wt-loading",
			sets: "seo-wt-sets",
			style: "seo-wt-style",
			script: "seo-wt-script"
		};

		for (
			const key of Object.keys(panels)
		) {

			const panel =
				seoWtEl(
					n,
					panels[key]
				);

			if (panel) {
				panel.style.display =
					key === step
						? ""
						: "none";
			}

		}

		/* Session 331: steps behind the open one read as done pills. */
		const stepOrder = [
			"plan",
			"sets",
			"style",
			"script"
		];

		const stepIndex =
			stepOrder.indexOf(step);

		modal.querySelectorAll(
			".seo-wt-step"
		).forEach(
			(chip) => {

				const chipIndex =
					stepOrder.indexOf(
						String(
							chip.getAttribute("data-step") || ""
						)
					);

				chip.classList.toggle(
					"active",
					chip.getAttribute("data-step") === step
				);

				chip.classList.toggle(
					"done",
					chipIndex > -1 &&
						stepIndex > -1 &&
						chipIndex < stepIndex
				);

			}
		);

		/* A style / set the user has not confirmed yet = unclosable by Escape. */
		const choicePending =
			step === "sets" || step === "style";

		const project =
			videoProjects[n - 1];

		if (project) {
			project._seoChoicePending = choicePending;
		}

		setSeoWalkthroughChoicePending(
			n,
			choicePending
		);

	}

	function seoSetChipsHTML(
		set
	) {

		let html =
			'<div class="va-seo-row"><span class="va-seo-label">Title</span><span class="va-seo-chip">' +
			escapeHTML(set.title || "") +
			"</span></div>";

		if (
			Array.isArray(set.headings) &&
			set.headings.length
		) {

			html +=
				'<div class="va-seo-row"><span class="va-seo-label">Headings</span>';

			set.headings.forEach(
				(heading) => {

					html +=
						'<span class="va-seo-chip">' +
						escapeHTML(heading) +
						"</span>";

				}
			);

			html +=
				"</div>";

		}

		html +=
			'<div class="va-seo-row"><span class="va-seo-label">Long-tail</span><span class="va-seo-chip long">' +
			escapeHTML(set.longTail || "") +
			'</span></div><div class="va-seo-row"><span class="va-seo-label">Short</span>';

		(Array.isArray(set.short) ? set.short : []).forEach(
			(shortKw) => {

				html +=
					'<span class="va-seo-chip short">' +
					escapeHTML(shortKw) +
					"</span>";

			}
		);

		html +=
			"</div>";

		return html;

	}

	function renderSeoPlanSets(
		n
	) {

		const project =
			videoProjects[n - 1];

		const list =
			seoWtEl(
				n,
				"seo-wt-sets-list"
			);

		if (!project || !list) {
			return;
		}

		list.innerHTML =
			"";

		(project.seoSets || []).forEach(
			(set, idx) => {

				const card =
					document.createElement(
						"div"
					);

				card.className =
					"seo-wt-card";

				card.innerHTML =
					'<div class="seo-wt-card-title">Keyword set ' + (idx + 1) + "</div>" +
					seoSetChipsHTML(set) +
					'<button type="button" class="upload-btn" onclick="selectSeoKeywordSet(' + n + ", " + idx + ')">Select this set</button>';

				list.appendChild(
					card
				);

			}
		);

	}

	async function generateScript(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		if (
			project._seoPlanBusy ||
			project._imageFlowActive
		) {
			/* Stack it on top of any other video's window. */
			ensureSeoWalkthrough(n);
			showSeoWalkthrough(n);
			return;
		}

		/* A set was already chosen: reopen at the style step. */
		if (project.selectedSeoSet) {

			ensureSeoWalkthrough(n);

			const selectedSlot =
				seoWtEl(
					n,
					"seo-wt-selected"
				);

			if (selectedSlot) {
				selectedSlot.innerHTML =
					'<div class="seo-wt-card-title">Selected keyword set</div>' +
					seoSetChipsHTML(
						project.selectedSeoSet
					);
			}

			showSeoWalkthroughStep(n, "style");
			showSeoWalkthrough(n);
			return;

		}

		/* Sets from an earlier click are still waiting for a choice. */
		if (
			Array.isArray(project.seoSets) &&
			project.seoSets.length >= 1 &&
			!project.selectedSeoSet
		) {

			ensureSeoWalkthrough(n);
			renderSeoPlanSets(n);
			showSeoWalkthroughStep(n, "sets");
			showSeoWalkthrough(n);
			return;

		}

		const topicEl =
			document.getElementById(
				"va-script-topic-" + n
			);

		const titleEl =
			document.getElementById(
				"va-title-" + n
			);

		const minutesEl =
			document.getElementById(
				"va-script-minutes-" + n
			);

		const speedEl =
			document.getElementById(
				"va-script-speed-" + n
			);

		let btn =
			document.getElementById(
				"va-script-btn-" + n
			);

		let statusEl =
			document.getElementById(
				"va-script-status-" + n
			);

		const topic =
			(topicEl && topicEl.value.trim()) ||
			(titleEl && titleEl.value.trim()) ||
			"my video";

		const minutes =
			Number(
				minutesEl
					? minutesEl.value
					: 1
			);

		const speed =
			speedEl
				? speedEl.value
				: "medium";

		project._seoTopic =
			topic;

		project._seoMinutes =
			Number.isInteger(minutes) && minutes >= 1 && minutes <= 6
				? minutes
				: 1;

		project._seoSpeed =
			speed;

		project.selectedSeoSet =
			null;

		project.seoSets =
			null;

		/* 1. Disable Upload Image, GIF or MP4 for the whole flow. */
		setVaUploadEnabled(
			n,
			false
		);

		if (btn) {
			btn.disabled = true;
		}

		project._seoPlanBusy =
			true;

		/* 2. Show the walkthrough while the SEO plan is fetched. */
		const modal =
			ensureSeoWalkthrough(n);

		const topicSlot =
			modal.querySelector(
				"#seo-wt-topic-" + n
			);

		if (topicSlot) {
			topicSlot.textContent =
				topic;
		}

		showSeoWalkthroughStep(n, "plan");

		if (statusEl) {
			statusEl.textContent =
				"Planning two SEO keyword sets (AI model)\\u2026";
		}

		try {

			const response =
				await fetch(
					"/api/seo-plan",
					{
						method: "POST",
						headers: {
							"Content-Type":
								"application/json"
						},
						body:
							JSON.stringify(
								{
									topic: topic
								}
							)
					}
				);

			const data =
				await response
					.json()
					.catch(
						() => ({})
					);

			// An accordion can be deleted/renumbered while the plan is in flight.
			const liveN = videoProjects.indexOf(project) + 1;
			if (project._deleted || liveN <= 0) return;
			n = liveN;
			btn = document.getElementById("va-script-btn-" + n);
			statusEl = document.getElementById("va-script-status-" + n);

			/*
			 * ONE set is enough to continue: the worker answers
			 * partial: true with a single validated set when the
			 * second planner run could not produce a different one.
			 * Only a reply with no set at all is a failure.
			 */
			if (
				!response.ok ||
				!data.success ||
				!Array.isArray(data.sets) ||
				data.sets.length < 1
			) {

				throw new Error(
					(data && data.error) ||
					("HTTP " + response.status)
				);

			}

			project.seoSets =
				data.sets;

			project._seoPlanWarning =
				data.partial && data.warning
					? String(data.warning)
					: "";

			/* 3. Sets arrived: (re-)open THIS video's modal even if
			 * the user closed it while generation was running. Other
			 * videos' windows are left exactly as they were. */
			ensureSeoWalkthrough(n);

			setSeoWalkthroughError(n, "");
			renderSeoPlanSets(n);
			showSeoWalkthroughStep(n, "sets");
			showSeoWalkthrough(n);
			/* The modal can be closed while waiting for a choice; keep the
			 * per-video trigger available so cached sets/style can reopen it. */
			if (btn) btn.disabled = false;

			if (statusEl) {
				statusEl.textContent =
					project.seoSets.length > 1
						? "Two SEO keyword sets are ready \\u2014 pick one in the walkthrough."
						: "One SEO keyword set is ready \\u2014 pick it in the walkthrough.";
			}

			if (project._seoPlanWarning) {
				setSeoWalkthroughError(
					n,
					project._seoPlanWarning
				);
			}

		}
		catch (planError) {

			const liveN = videoProjects.indexOf(project) + 1;
			if (project._deleted || liveN <= 0) return;
			n = liveN;
			btn = document.getElementById("va-script-btn-" + n);
			statusEl = document.getElementById("va-script-status-" + n);

			console.warn("[seo-plan] failed", {
				videoIndex: n,
				error:
					(planError && planError.message) ||
					String(planError)
			});

			project.seoSets =
				null;

			setVaUploadEnabled(
				n,
				true
			);

			if (btn) {
				btn.disabled = false;
			}

			const planMessage =
				"SEO plan failed: " +
				(planError.message || planError);

			if (statusEl) {
				statusEl.textContent =
					planMessage;
			}

			/* Keep the window, say what happened, offer the retry. */
			ensureSeoWalkthrough(n);
			showSeoWalkthroughStep(n, "plan");
			setSeoWalkthroughError(n, planMessage);

		}
		finally {

			project._seoPlanBusy =
				false;

		}

	}

	function selectSeoKeywordSet(
		n,
		idx
	) {

		const project =
			videoProjects[n - 1];

		if (
			!project ||
			!Array.isArray(project.seoSets) ||
			!project.seoSets[idx]
		) {
			return;
		}

		project.selectedSeoSet =
			project.seoSets[idx];

		/*
		 * Fix for the serial planner→writer chain (#1): the pick the user just
		 * made is written down in the browser immediately, so the script
		 * request can carry the keyword set and the beat plan and the worker
		 * never has to run the planner at all. The full note (with facts and
		 * script) is refreshed after each successful generation.
		 */
		if (project.selectedSeoSet) {
			try {
				scriptNoteMemory.put({
					topic: project._seoTopic || "",
					sourceUrl: project.scriptSourceUrl || "",
					minutes: project._seoMinutes || 1,
					speed: project._seoSpeed || "medium",
					keywordSet: project.selectedSeoSet,
					outline: scriptNoteMemory.outlineFor(
						project.selectedSeoSet,
						project._seoMinutes || 1,
						project._seoSpeed || "medium"
					)
				});
			} catch (noteError) {
				console.warn("[script-notes] browser note write failed", String(noteError && noteError.message || noteError).slice(0, 200));
			}
		}

		const selected =
			seoWtEl(
				n,
				"seo-wt-selected"
			);

		if (selected) {

			selected.innerHTML =
				'<div class="seo-wt-card-title">Selected keyword set</div>' +
				seoSetChipsHTML(
					project.selectedSeoSet
				);

		}

		showSeoWalkthroughStep(n, "style");

		const styleSelect =
			seoWtEl(
				n,
				"seo-wt-style-select"
			);

		if (styleSelect) {
			styleSelect.focus();
		}

	}

	async function confirmSeoStyleAndGenerate(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project || !project.selectedSeoSet || project._imageFlowActive) {
			return;
		}

		const styleSelect =
			seoWtEl(
				n,
				"seo-wt-style-select"
			);

		project.videoImageStyle =
			(styleSelect && styleSelect.value) ||
			DEFAULT_SEO_IMAGE_STYLE;

		/*
		 * Both choices are in: the window is no longer waiting on
		 * the user, so Escape / Close may dismiss it. It is moved
		 * to the "writing" panel rather than removed, because that
		 * panel is where the user is told they can walk away while
		 * the SEO script is generated.
		 */
		setSeoWalkthroughError(n, "");
		showSeoWalkthroughStep(n, "script");
		setSeoWalkthroughScriptStatus(
			n,
			"Writing the script \u2014 you can close this window, nothing is cancelled."
		);

		/* The script section shows its loading animation while
		 * runSeoScriptRequest awaits the AI script. */
		project._imageFlowActive =
			true;

		const ok =
			await runSeoScriptRequest(
				n,
				project._seoTopic || "my video",
				project._seoMinutes || 1,
				project._seoSpeed || "medium"
			);

		// Continue with the original project, not the old accordion number.
		const liveN = videoProjects.indexOf(project) + 1;
		if (project._deleted || liveN <= 0) return;
		n = liveN;

		if (!ok) {

			project._imageFlowActive =
				false;

			setVaUploadEnabled(
				n,
				true
			);

			const btn =
				document.getElementById(
					"va-script-btn-" + n
				);

			if (btn) {
				btn.disabled = false;
			}

			return;

		}

		/*
		 * The script is on screen: this video's window is no longer
		 * needed, and closing it here only ever touches Video N —
		 * other videos keep their own walkthroughs open.
		 */
		closeSeoWalkthrough(n);

		/* The script is shown: start the image-prompt job. */
		startImagePromptFlow(n);

	}

	/* Base64 -> Blob for one streamed batch image (no data: URL round-trip). */
	function base64ImageBlob(
		base64,
		mime
	) {
		const cleaned =
			String(base64 || "")
				.replace(/^data:[^;]+;base64,/i, "")
				.replace(/\\s+/g, "");
		if (
			typeof Uint8Array !== "undefined" &&
			typeof Uint8Array.fromBase64 === "function"
		) {
			return new Blob(
				[Uint8Array.fromBase64(cleaned)],
				{ type: mime || "image/png" }
			);
		}
		const binary =
			atob(cleaned);
		const bytes =
			new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new Blob(
			[bytes],
			{ type: mime || "image/png" }
		);
	}

	/*
	 * =========================================================
	 * AUTO-RETRY: a pipeline that ran out of patience tries again
	 * =========================================================
	 *
	 * Every guard in this file used to end the same way: stop the flow and
	 * print why. That is honest, but it makes the user the retry mechanism -
	 * the 2-minute silence alarm (IMAGE_BATCH_IDLE_TIMEOUT_MS) aborted the
	 * batch, a Pixabay 429 said "please wait before searching again" and then
	 * waited for a click, and a clip that timed out once was dropped.
	 *
	 * Now a RETRYABLE stop reason schedules one visible retry instead:
	 *
	 *   - it re-runs ONLY the scenes that are still missing (the delivered
	 *     ones are never re-requested, so no double billing and no duplicates);
	 *   - it waits the wait the server asked for (retryAfterMs), clamped to
	 *     [IMAGE_AUTO_RETRY_MIN_MS, IMAGE_AUTO_RETRY_MAX_MS] so a 1-hour
	 *     Pixabay window cannot freeze the tab;
	 *   - it shows a live countdown in the video's status line, so the wait is
	 *     visible instead of looking like a hang;
	 *   - it is cancellable (Stop / a new flow / deleting the video) and
	 *     bounded (IMAGE_AUTO_RETRY_LIMIT attempts per flow), after which the
	 *     old "press Retry" behaviour is the fallback.
	 */
	const IMAGE_AUTO_RETRY_LIMIT =
		2;
	const IMAGE_AUTO_RETRY_MIN_MS =
		2000;
	const IMAGE_AUTO_RETRY_MAX_MS =
		120000;
	const IMAGE_AUTO_RETRY_FALLBACK_MS =
		15000;
	const IMAGE_AUTO_RETRY_TICK_MS =
		500;

	/*
	 * Reasons that must NOT be retried even though they may arrive with a
	 * 5xx status: a missing API key, a rejected credential, a full gallery or
	 * a spent allowance will answer exactly the same way on the next attempt.
	 * Retrying them would hide the real cause behind a countdown.
	 */
	const IMAGE_VERDICT_REASON =
		/not configured|misconfigur|configuration|api key|unauthori[sz]ed|forbidden|invalid key|permission|gallery is full|allowance|not enough|credit|quota/i;

	/* Reasons that deserve another attempt rather than a verdict. */
	const IMAGE_RETRYABLE_REASON =
		/stopped responding|stopped for \d+ seconds|timed out|time out|rate limit|429|too many requests|busy|overload|temporar|network|failed to fetch|interrupted|disconnected/i;

	/* Exposed so tests / debugging can see and shrink the budgets. */
	if (typeof window !== "undefined") {
		window.__IMAGE_AUTO_RETRY_TIMING = {
			limit: IMAGE_AUTO_RETRY_LIMIT,
			minDelayMs: IMAGE_AUTO_RETRY_MIN_MS,
			maxDelayMs: IMAGE_AUTO_RETRY_MAX_MS,
			fallbackDelayMs: IMAGE_AUTO_RETRY_FALLBACK_MS,
			tickMs: IMAGE_AUTO_RETRY_TICK_MS
		};
		window.__IMAGE_AUTO_RETRY_LOG = [];
	}

	function imageAutoRetryLimits() {

		const override =
			typeof window !== "undefined" ? window.__IMAGE_AUTO_RETRY_TIMING : null;
		const pick = function (key, fallback) {
			const value = override ? Number(override[key]) : NaN;
			return isFinite(value) && value >= 0 ? value : fallback;
		};
		const min =
			pick("minDelayMs", IMAGE_AUTO_RETRY_MIN_MS);
		const max =
			pick("maxDelayMs", IMAGE_AUTO_RETRY_MAX_MS);
		const limit =
			pick("limit", IMAGE_AUTO_RETRY_LIMIT);

		return {
			limit: Math.max(1, Math.floor(limit)),
			min: Math.max(0, Math.floor(min)),
			max: Math.max(Math.max(0, Math.floor(min)), Math.floor(max)),
			fallback: Math.max(1, Math.floor(pick("fallbackDelayMs", IMAGE_AUTO_RETRY_FALLBACK_MS))),
			tick: Math.max(0, Math.floor(pick("tickMs", IMAGE_AUTO_RETRY_TICK_MS)))
		};

	}

	function imageAutoRetryLog(entry) {

		if (typeof window === "undefined") return;
		const log = Array.isArray(window.__IMAGE_AUTO_RETRY_LOG) ? window.__IMAGE_AUTO_RETRY_LOG : [];
		log.push(entry);
		while (log.length > 12) log.shift();
		window.__IMAGE_AUTO_RETRY_LOG = log;

	}

	/* How many planned scenes this flow has not delivered yet. */
	function imageSceneGapCount(project) {

		if (!project || !Array.isArray(project.imagePrompts) || !project.imagePrompts.length) return 0;
		const flowId =
			project.imagePromptFlowId;
		let missing = 0;

		project.imagePrompts.forEach(function (_, index) {
			const delivered =
				project.assets.some(function (asset) {
					return asset && asset.imagePromptFlowId === flowId && Number(asset.sceneIndex) === index;
				});
			if (!delivered) missing++;
		});

		return missing;

	}

	/*
	 * A stop reason becomes a retry plan, or nothing at all. null means
	 * "this really is a verdict" (a full gallery, a rejected credential, the
	 * retry budget spent).
	 */
	function imageAutoRetryPlan(project, reason) {

		if (!project || project._deleted) return null;
		if (project._imageFlowActive) return null;

		const marker =
			project._imageFlowRetry || null;
		const text =
			String(reason || (marker && marker.reason) || "");
		if (IMAGE_VERDICT_REASON.test(text)) return null;

		const retryable =
			marker && marker.retryable === false
				? false
				: Boolean((marker && marker.retryable) || IMAGE_RETRYABLE_REASON.test(text));

		if (!retryable) return null;
		/*
		 * SESSION 279 (hang audit): a failure on the FIRST prompt chunk leaves
		 * imagePrompts empty, and "nothing was planned" used to read as
		 * "no scene is missing" - which turned a transient 408 on the first
		 * request into a dead end the moment the page stopped re-asking inside
		 * the request. The scene target this flow was asked for is the honest
		 * gap while nothing has been planned yet.
		 */
		const missingScenes =
			imageSceneGapCount(project) || (Number(project.imagePromptTarget) || 0);
		if (!missingScenes) return null;

		const limits =
			imageAutoRetryLimits();
		const used =
			Number(project._imageAutoRetries) || 0;
		if (used >= limits.limit) return null;

		const hint =
			marker && Number(marker.hintMs) > 0 ? Number(marker.hintMs) : 0;
		const raw =
			hint > 0 ? hint : limits.fallback * (used + 1);
		const delayMs =
			Math.round(Math.max(limits.min, Math.min(limits.max, raw)));

		return {
			reason: text,
			kind: (marker && marker.kind) || "retry",
			attempt: used + 1,
			limit: limits.limit,
			delayMs: delayMs,
			missing: missingScenes
		};

	}

	function cancelImageAutoRetry(project, options) {

		if (!project || !project._imageAutoRetry) return false;

		const state =
			project._imageAutoRetry;
		project._imageAutoRetry = null;

		if (state.timer) clearTimeout(state.timer);
		if (state.ticker) clearTimeout(state.ticker);

		imageAutoRetryLog({ event: "cancelled", kind: state.kind, attempt: state.attempt });

		if (!options || options.quiet !== true) {
			const liveN = videoProjects.indexOf(project) + 1;
			const statusEl = liveN > 0 ? document.getElementById("va-ai-status-" + liveN) : null;
			if (statusEl) statusEl.textContent = "Automatic retry cancelled.";
		}

		return true;

	}

	function scheduleImageAutoRetry(project, plan) {

		if (!project || !plan) return false;

		cancelImageAutoRetry(project, { quiet: true });

		const limits =
			imageAutoRetryLimits();
		const until =
			Date.now() + plan.delayMs;
		const state = {
			reason: plan.reason,
			kind: plan.kind,
			attempt: plan.attempt,
			delayMs: plan.delayMs,
			until: until,
			timer: null,
			ticker: null,
			message: ""
		};

		project._imageAutoRetry = state;

		const paint = function () {

			const liveN =
				videoProjects.indexOf(project) + 1;

			if (liveN <= 0 || project._deleted) {
				cancelImageAutoRetry(project, { quiet: true });
				return;
			}

			const secondsLeft =
				Math.max(0, Math.ceil((until - Date.now()) / 1000));
			const label =
				(plan.kind === "rate-limit" || plan.kind === "overload"
					? "Pixabay is busy"
					: "Pixabay needs a moment") +
				" \u2014 retrying the missing scenes automatically in " +
				secondsLeft +
				"s (attempt " +
				plan.attempt +
				" of " +
				plan.limit +
				")\u2026";

			state.message = label;

			const statusEl =
				document.getElementById("va-ai-status-" + liveN);
			if (statusEl) statusEl.textContent = label;

		};

		const tick = function () {
			if (project._imageAutoRetry !== state) return;
			paint();
			if (limits.tick > 0) {
				state.ticker = setTimeout(tick, Math.max(limits.tick, Math.min(limits.tick, state.until - Date.now())));
			}
		};
		paint();
		if (limits.tick > 0) state.ticker = setTimeout(tick, limits.tick);

		state.timer = setTimeout(function () {

			if (project._imageAutoRetry !== state) return;

			project._imageAutoRetry = null;
			if (state.ticker) clearTimeout(state.ticker);

			const liveN =
				videoProjects.indexOf(project) + 1;
			if (project._deleted || liveN <= 0 || project._imageFlowActive) {
				imageAutoRetryLog({ event: "skipped", kind: plan.kind, attempt: plan.attempt });
				return;
			}

			project._imageAutoRetries = (Number(project._imageAutoRetries) || 0) + 1;

			imageAutoRetryLog({
				event: "running",
				kind: plan.kind,
				attempt: plan.attempt,
				waitedMs: plan.delayMs,
				missing: imageSceneGapCount(project),
				reason: String(plan.reason || "").slice(0, 160)
			});
			console.info("[seo-image-flow] auto retry", {
				videoIndex: liveN,
				attempt: plan.attempt,
				kind: plan.kind,
				waitedMs: plan.delayMs,
				reason: String(plan.reason || "").slice(0, 160)
			});

			const statusEl =
				document.getElementById("va-ai-status-" + liveN);
			if (statusEl) statusEl.textContent = "Retrying the missing Pixabay scenes automatically (attempt " + plan.attempt + " of " + plan.limit + ")\u2026";

			Promise.resolve()
				.then(function () { return retryImagePromptFlow(liveN); })
				.catch(function (error) {
					console.error("[seo-image-flow] auto retry failed", String(error && error.message || error).slice(0, 300));
				});

		}, plan.delayMs);

		imageAutoRetryLog({
			event: "scheduled",
			kind: plan.kind,
			attempt: plan.attempt,
			delayMs: plan.delayMs,
			missing: Number(plan.missing) || imageSceneGapCount(project),
			reason: String(plan.reason || "").slice(0, 160)
		});
		console.info("[seo-image-flow] auto retry scheduled", {
			kind: plan.kind,
			delayMs: plan.delayMs,
			attempt: plan.attempt
		});

		return true;

	}

	/*
	 * The single call the end of a flow makes. Returns true when a retry was
	 * armed - the caller then leaves its "stopped" message alone, because the
	 * countdown is the message now.
	 */
	function maybeScheduleImageAutoRetry(project, reason) {

		const plan =
			imageAutoRetryPlan(project, reason);

		if (!plan) {
			/* A verdict (or a spent budget): the manual Retry button is next. */
			project._imageFlowRetry = null;
			return false;
		}

		project._imageFlowRetry = null;

		return scheduleImageAutoRetry(project, plan);

	}

	/*
	 * Step 3 + 4 of the walkthrough.
	 *
	 * The text LLM plans stock keywords; delivery routes import photos and two MP4 clips.
	 * No interval timers, no gallery watcher, no job URL to create or
	 * destroy: the batch stream is both the progress and the completion
	 * signal, so there is nothing to clean up afterwards.
	 */
	/*
	 * Editor layout: retry ONLY the missing scene. A successful photo/clip,
	 * its object URL and its recorded filename stay in the gallery. Each
	 * retry varies the Pixabay result index/page so a duplicate filename is
	 * replaced with a different asset instead of ending the whole flow.
	 */
	async function editorSceneDelivered(project, flowId, scene) {
		return Boolean(project && Array.isArray(project.assets) && project.assets.some(function (asset) {
			return asset && asset.imagePromptFlowId === flowId && Number(asset.sceneIndex) === Number(scene);
		}));
	}

	async function runEditorMediaWithIndividualRetries(n, prompts, flowId, project, seq, sceneOffset) {
		const baseOffset = Number(sceneOffset) || 0;
		const scenes = prompts.map(function (_, index) { return baseOffset + index; });
		let lastMediaFailure = "";
		const result = await retryFailedMediaOnly(project, prompts, scenes, async function (pendingPrompts, pendingScenes) {
			const failed = [];
			for (let i = 0; i < pendingPrompts.length; i++) {
				const scene = pendingScenes[i];
				if (await editorSceneDelivered(project, flowId, scene)) continue;
				if (project._deleted || !project._imageFlowActive || project._imageFlowSeq !== seq) {
					failed.push(scene);
					continue;
				}
				project._lastMediaError = "";
				project._imageFlowStopReason = "";
				project._imageFlowRetry = null;
				if (Array.isArray(project.imagePrompts)) project.imagePrompts[scene] = pendingPrompts[i];
				setImagePromptState(project, scene, "searching", "");
				try {
					await runImageBatch(n, [pendingPrompts[i]], flowId, project, seq, scene);
				} catch (error) {
					lastMediaFailure = String(error && error.message || error);
					mediaItemRetryLog({ event: "item-error", stage: "editor-media", scene: scene, message: lastMediaFailure.slice(0, 200) });
				}
				if (project._imageFlowStopReason) lastMediaFailure = project._imageFlowStopReason;
				if (!(await editorSceneDelivered(project, flowId, scene))) failed.push(scene);
			}
			return { images: [], failed: failed };
		}, "editor-media");
		project._imageFlowStopReason = result.failed.length
			? (lastMediaFailure || "The fixed 12-scene plan needs four distinct Pixabay clips and eight distinct photos.")
			: "";
		project._missingMediaScenes = result.failed.slice();
		mediaItemRetryLog({
			event: "editor-media-complete",
			stage: "editor-media",
			attempts: result.attempts,
			missing: result.failed,
			recordedFilenames: recordedMediaFilenames(project).slice()
		});
		return result;
	}

	async function startImagePromptFlow(
		n
	) {

				const project =
			videoProjects[n - 1];
		if (!project) return;

		const statusEl =
			document.getElementById(
				"va-ai-status-" + n
			);
		// Replace only prior automatic scenes on rerun; preserve manual uploads.
		project._imageFlowSeq = (project._imageFlowSeq || 0) + 1;
		project._requiresStockClips = true;
		/* Lock this accordion's own script/upload controls while its flow renders. */
		setVaUploadEnabled(n, false);
		const ownScriptButton = document.getElementById("va-script-btn-" + n);
		if (ownScriptButton) ownScriptButton.disabled = true;
		persistPipelineManagementState("editor-flow-start");
		for (const asset of project.assets.filter(function (a) { return a.imagePromptFlowId; })) {
			if (asset.videoEl) { try { asset.videoEl.pause(); asset.videoEl.removeAttribute("src"); asset.videoEl.load(); } catch (_) {} }
			if (asset.card && asset.card.parentNode) asset.card.parentNode.removeChild(asset.card);
			if (asset.url) releaseStudioObjectUrl(asset.url);
		}
		project.assets = project.assets.filter(function (a) { return !a.imagePromptFlowId; });
		const availableImages =
			Math.max(
				0,
				MAX_IMAGE_UPLOADS -
					videoCounts(project).stills
			);
		const style =
			project.videoImageStyle ||
			DEFAULT_SEO_IMAGE_STYLE;

		/*
		 * The walkthrough's images are generating for THIS video: lock its
		 * manual "Generate 2 Images" button until finalizeImagePromptFlow()
		 * runs (every exit path of this flow ends there). Other videos are
		 * untouched and can still generate their own images at the same time.
		 */

		/* A second run for this video cancels the previous one's prompt/batch streams. */
		if (project._imagePromptCreateController) {
			try { project._imagePromptCreateController.abort(); } catch (abortPromptErr) { }
			project._imagePromptCreateController = null;
		}
		if (project._imageBatchController) {
			try { project._imageBatchController.abort(); } catch (abortError) { }
			project._imageBatchController = null;
		}

		const myFlowSeq = project._imageFlowSeq;

		project.imagePrompts = null;
		project.imagePromptStates = {};
		project.imagePromptTarget = 0;
		project.imagePromptFlowId = null;
		project.aiImagesDone = 0;
		project._aiImageFailures = 0;
		project._aiImageSkipped = 0;
		project.mediaFilenames = [];
		project._missingMediaScenes = [];
		project._lastMediaError = "";
		project._imageFlowStopReason = "";
		project._imageFlowStartedAt = Date.now();
		/* A fresh run starts a fresh retry budget. */
		cancelImageAutoRetry(project, { quiet: true });
		project._imageAutoRetries = 0;
		project._imageFlowRetry = null;

		if (availableImages < AUTO_IMAGE_SCENES || videoCounts(project).clips > MAX_MP4_UPLOADS - AUTO_VIDEO_SCENES) {
			await finalizeImagePromptFlow(
				n,
				"Make room for eight distinct Pixabay photos and four Pixabay video clips in this gallery."
			);
			return;
		}

		if (statusEl) {
			statusEl.textContent =
				"Planning Pixabay scene keywords from the full script…";
		}

		/* Fixed for every script length: 4 Pixabay clips + 8 distinct photos. */
		const target = AUTO_MEDIA_TOTAL;
\t\tproject.imagePrompts = [];
\t\tproject.imagePromptTarget = target;
/* Hide last time's search terms and retry button until this flow plans new ones. */
const flowKeywords = document.getElementById("va-image-keywords-" + n);
if (flowKeywords) { flowKeywords.style.display = "none"; flowKeywords.innerHTML = ""; }
const flowRetry = document.getElementById("va-image-retry-" + n);
if (flowRetry) flowRetry.style.display = "none";
		project.imagePromptFlowId = "imgflow-" + n + "-" + myFlowSeq + "-" + Date.now().toString(36);
		const isCancelled = function () {
			return Boolean(project._deleted || project._imageFlowSeq !== myFlowSeq || !project._imageFlowActive);
		};
		try {
			await runProgressiveImagePipeline({
				total: target,
				isCancelled: isCancelled,
				/* The scheduled client flow owns prompt-load retries, not the in-request pipeline. */
				promptContinuations: 0,
				onPrompts: function (prompts) {
					project.imagePrompts = prompts;
					prompts.forEach(function (_, index) {
						if (!project.imagePromptStates[String(index)]) setImagePromptState(project, index, "planned", "");
					});
					renderImageKeywords(n);
				},
				cancelPrompts: function () {
					if (project._imagePromptCreateController) project._imagePromptCreateController.abort();
				},
				request: async function (batch) {
					const caps = await studioOffload.capabilities();
					const compact = null;
					const sendPrompt = caps.compactPrompts ? async function (url, init, timeout, owner, key, consume) {
						const response = await studioOffload.jsonRequest(url, init, timeout, {
							isCancelled: isCancelled,
							setController: function (controller) { owner[key] = controller; },
							clearController: function (controller) { if (owner[key] === controller) owner[key] = null; }
						});
						return consume(response);
					} : seoFetchWithTimeout;
					return sendPrompt("/api/image-prompts", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							topic: project._seoTopic || "my video", minutes: project._seoMinutes || 1,
							style: style, script: project.script || "", sceneTotal: target, keywordSet: project.selectedSeoSet || null,
							/* Session 331: no model plans the searches; the script and
							 * the SEO set are read inside each scene's time window. */
							keywordSource: "script",
							durationSec: editorScenePlanDuration(project),
							batch: batch
						})
					}, IMAGE_PROMPT_REQUEST_TIMEOUT_MS, project, "_imagePromptCreateController", async function (response) {
						const data = await seoResponseJson(response);
						if (!response.ok || !data.success) {
							const error = new Error((data && data.error) || ("Scene prompt request failed (HTTP " + response.status + ")"));
							error.retryable = response.status === 408 || response.status >= 500 || response.status === 429 || response.ok;
							error.status = response.status;
							/* #263: a load answer carries the wait the server wants. */
							error.kind = (data && data.kind) || "";
							error.retryAfterMs = Number(data && data.retryAfterMs) > 0 ? Number(data.retryAfterMs) : 0;
							throw error;
						}
						return data.prompts;
					});
				},
				render: async function (prompts, offset) {
					const liveN = videoProjects.indexOf(project) + 1;
					if (liveN <= 0 || isCancelled()) return;
					await runEditorMediaWithIndividualRetries(
						liveN, prompts, project.imagePromptFlowId, project, myFlowSeq, offset
					);
				}
			});
		} catch (error) {
			if (isCancelled()) return;
			project._imageFlowStopReason = project._imageFlowStopReason ||
				(batchIsAbortError(error) ? "Scene prompt request was interrupted after bounded retries." :
					"Stock search terms could not be generated or rendered: " + (error.message || String(error)));
		}
		if (isCancelled()) return;
		const finalN = videoProjects.indexOf(project) + 1;
		if (finalN > 0) await finalizeImagePromptFlow(finalN, project._imageFlowStopReason || "");
	}

	/*
	 * Renders one browser-scheduled chunk and consumes its NDJSON stream:
	 *   start / tick / image{ok,data} / image{ok:false,error} / done / error
	 * Each successful image is inserted into this video's gallery as soon as
	 * it arrives, so a 10-image batch is on screen in one pass instead of
	 * trickling in every 20 seconds.
	 */
	async function insertStockScene(n, blob, flowId, sceneIndex, stale) {
		const project = videoProjects[n - 1];
		if (!project || stale()) return false;
		if (project.assets.some(function (a) { return a.imagePromptFlowId === flowId && a.sceneIndex === sceneIndex; })) return true;
		if (!acceptMediaBlob(project, blob, sceneIndex)) {
			project._lastMediaError = "Duplicate Pixabay filename rejected for scene " + sceneIndex + "; searching a different result.";
			return false;
		}
		const file = new File([blob], blob.stockFilename || mediaFilenameFromBlob(blob, sceneIndex), { type: blob.type });
		file.stockSource = blob.stockSource || null;
		file.stockFilename = blob.stockFilename;
		if (blob.type !== "video/mp4") {
			const inserted = addAiToVideo(n, file, blob, flowId, true);
			if (inserted) project.assets[project.assets.length - 1].sceneIndex = sceneIndex;
			return inserted;
		}
		if (videoCounts(project).clips >= MAX_MP4_UPLOADS) return false;
		const url = createStudioObjectUrl(blob), video = document.createElement("video");
		try {
			const duration = await probeMp4DurationWithRetry(url, 2, video);
			if (stale() || project._deleted || videoCounts(project).clips >= MAX_MP4_UPLOADS) { releaseStudioObjectUrl(url); video.removeAttribute("src"); video.load(); return false; }
			if (!Number.isFinite(duration) || duration <= 0 || duration > MP4_MAX_DURATION_S) throw new Error("Unsupported Pixabay clip duration");
			const asset = { kind: "mp4", file: file, stockSource: blob.stockSource, stockFilename: blob.stockFilename,
				videoEl: video, duration: duration, url: url, card: null, imagePromptFlowId: flowId, sceneIndex: sceneIndex };
			project.assets.push(asset);
			const liveN = videoProjects.indexOf(project) + 1;
			buildVaCard(liveN, asset); updateVideoStatus(liveN);
			return true;
		} catch (error) {
			project.assets = project.assets.filter(function (a) { if (a.url !== url) return true; if (a.card && a.card.parentNode) a.card.parentNode.removeChild(a.card); return false; });
			releaseStudioObjectUrl(url); video.removeAttribute("src"); video.load(); throw error;
		}
	}

	async function runBinaryEditorImages(n, prompts, flowId, project, ownerFlowSeq, sceneOffset) {
		const seq = typeof ownerFlowSeq === "number" ? ownerFlowSeq : project._imageFlowSeq;
		const stale = function () { return Boolean(project._deleted || !project._imageFlowActive || project._imageFlowSeq !== seq); };
		try {
			const results = await requestImageChunk(prompts, {}, {
				isCancelled: stale,
				priority: function () { return project.el && project.el.contains(document.activeElement) ? 2 : 0; },
				setController: function (controller) { if (!stale()) project._imageBatchController = controller; else controller.abort(); },
				clearController: function (controller) { if (project._imageBatchController === controller) project._imageBatchController = null; },
				onImage: async function (blob, index) {
					if (stale()) return;
					const liveN = videoProjects.indexOf(project) + 1;
					if (liveN <= 0) return;
					const scene = (Number(sceneOffset) || 0) + index;
					if (!await insertStockScene(liveN, blob, flowId, scene, stale)) throw new Error(project._lastMediaError || "The media gallery is full or the flow was cancelled");
					project.aiImagesDone = (project.aiImagesDone || 0) + 1;
					recordStudioUsage("images", "ok", 1);
					setImagePromptState(project, scene, "imported", blob.type === "video/mp4" ? "clip added to gallery" : "photo added to gallery");
					const status = document.getElementById("va-ai-status-" + liveN);
					if (status) status.textContent = project.aiImagesDone + " Pixabay scenes imported…";
				},
				onError: function (error, index) {
					if (stale()) return;
					const scene = (Number(sceneOffset) || 0) + index;
					const message = error && error.message ? error.message : String(error || "Pixabay import failed");
					project._lastMediaError = message;
					project._imageFlowStopReason = message;
					setImagePromptState(project, scene, "failed", message);
				}
			});
						if (!stale()) {
				project._aiImageFailures = (project._aiImageFailures || 0) + results.filter(function (r) { return !r.ok; }).length;
				if (results.every(function (r) { return !r.ok; }) || results.some(function (r) {
					return r.error && [401,403,429].indexOf(r.error.status) >= 0;
				})) {
					/* Prefer the load hint: "server busy, retry in N s" beats a raw AiError. */
					const firstFailure = results.find(function (r) { return !r.ok && r.error; });
					project._imageFlowStopReason = results.some(function (r) {
						return r.error && (r.error.kind === "overload" || r.error.status === 503);
					})
						? describeImageLoadFailure(firstFailure && firstFailure.error)
						: ((firstFailure && firstFailure.error && firstFailure.error.message) || "The image batch could not complete; delivered images were kept.") +
							(firstFailure && firstFailure.error && firstFailure.error.requestId ? " (request " + firstFailure.error.requestId + ")" : "");
					/*
					 * 429 means "wait", not "no". The provider's own reset hint
					 * becomes the wait the retry scheduler honours (clamped by
					 * IMAGE_AUTO_RETRY_MAX_MS). 401/403 is a bad credential and
					 * is never retried - it is marked as a verdict instead.
					 */
					const failureStatus = Number(firstFailure && firstFailure.error && firstFailure.error.status) || 0;
					const failureHint = Number(firstFailure && firstFailure.error && firstFailure.error.retryAfterMs) || 0;
					if (failureStatus === 401 || failureStatus === 403) {
						project._imageFlowRetry = { kind: "auth", retryable: false, hintMs: 0, reason: project._imageFlowStopReason };
					} else if (failureStatus === 429 || failureStatus === 503 || (firstFailure && firstFailure.error && firstFailure.error.kind === "overload")) {
						project._imageFlowRetry = {
							kind: failureStatus === 429 ? "rate-limit" : "overload",
							retryable: true,
							hintMs: failureHint,
							reason: project._imageFlowStopReason
						};
					}
				}
			}
		} catch (error) {
			const message = String(error && error.message || error);
			console.error("[seo-image-flow] binary batch failed", { videoIndex: n, flowId: flowId, sceneOffset: Number(sceneOffset) || 0, error: message.slice(0, 500) });
			if (!stale()) {
				project._lastMediaError = message;
				project._imageFlowStopReason = "Image generation was interrupted; delivered images were kept.";
			}
		} finally { refreshCredits(); }
	}

	async function runImageBatch(
		n,
		prompts,
		flowId,
		ownerProject,
		ownerFlowSeq,
		sceneOffset
	) {

		const project =
			ownerProject || videoProjects[n - 1];
		if (!project || project._deleted || !project._imageFlowActive || !prompts.length) return;
		if ((await studioOffload.capabilities()).binaryImages) {
			return runBinaryEditorImages(n, prompts, flowId, project, ownerFlowSeq, sceneOffset);
		}
		const expectedSeq =
			typeof ownerFlowSeq === "number" ? ownerFlowSeq : project._imageFlowSeq;

		const resolveStatusEl = function () {
			const liveIdx = videoProjects.indexOf(project) + 1;
			return liveIdx > 0 ? document.getElementById("va-ai-status-" + liveIdx) : null;
		};
		const statusEl = resolveStatusEl();
		const total = prompts.length;
		let added = 0;
		let failed = 0;
		let skipped = 0;
		let batchDone = false;

		if (statusEl) {
			statusEl.textContent =
				"Rendering all " + total + " Pixabay images at once…";
		}

		const controller =
			typeof AbortController !== "undefined"
				? new AbortController()
				: null;
		project._imageBatchController = controller;

		const isStaleFlow = function () {
			return Boolean(
				project._deleted ||
				!project._imageFlowActive ||
				(typeof expectedSeq === "number" && project._imageFlowSeq !== expectedSeq)
			);
		};

		let idleTimer = null;
		const armIdleTimer = function () {
			if (!controller) return;
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(function () {
				if (!isStaleFlow()) {
					if (!project._imageFlowStopReason) {
						project._imageFlowStopReason = "The image batch stopped responding for " + Math.round(imageBatchIdleTimeoutMs() / 1000) + " seconds.";
					}
					/*
					 * Silence is not a verdict: record it as retryable so the
					 * finalizer re-arms the flow for whatever is still missing
					 * instead of ending with "stopped".
					 */
					project._imageFlowRetry = {
						kind: "idle",
						retryable: true,
						hintMs: 5000,
						reason: project._imageFlowStopReason
					};
				}
				try { controller.abort(); } catch (abortError) { }
			}, imageBatchIdleTimeoutMs());
		};

		const progressText = function () {
			return "Rendering " + total + " Pixabay image" + (total === 1 ? "" : "s") + " in parallel — " +
				added + " added" +
				(failed ? ", " + failed + " failed" : "") +
				(skipped ? ", " + skipped + " skipped" : "") + "…";
		};

		let galleryCommitChain =
			Promise.resolve();

		const handleEvent = function (event) {
			if (!event || typeof event !== "object" || isStaleFlow()) return;
			if (event.credits) applyCredits(event.credits);
			const curStatusEl = resolveStatusEl();

			if (event.type === "start") {
				if (curStatusEl) {
					curStatusEl.textContent =
						"Rendering " + event.count + " Pixabay images in parallel" +
						(event.width && event.height ? " (" + event.width + "×" + event.height + ")" : "") + "…";
				}
				return;
			}

			if (event.type === "tick") {
				if (curStatusEl && !batchDone) curStatusEl.textContent = progressText();
				return;
			}

			if (event.type === "image") {
				if (!event.ok) {
					failed++;
					setImagePromptState(project, (Number(sceneOffset) || 0) + Number(event.index), "failed", event.error || "Pixabay import failed");
					console.warn("[seo-image-flow] image failed", {
						videoIndex: n,
						index: event.index,
						error: event.error || "unknown image error"
					});
					if (curStatusEl && !batchDone) curStatusEl.textContent = progressText();
				}
				else if (event.data && !isStaleFlow()) {
					const eventIndex = (Number(sceneOffset) || 0) + Number(event.index);
					const decodeJob = decodeBase64ImageOffThread(event.data, event.mime);
					galleryCommitChain = galleryCommitChain.then(function () {
						return decodeJob.then(
							async function (blob) {
								blob.stockSource = event.source || null;
								if (isStaleFlow()) return;
								const liveN = videoProjects.indexOf(project) + 1;
								if (liveN <= 0) return;
								try {
									const inserted = await insertStockScene(liveN, blob, flowId, eventIndex, isStaleFlow);
									if (inserted) {
										added++;
										setImagePromptState(project, eventIndex, "imported", blob.type === "video/mp4" ? "clip added to gallery" : "photo added to gallery");
										recordStudioUsage("images", "ok", 1);

									}
									else {
										skipped++;
										setImagePromptState(project, eventIndex, "failed", project._lastMediaError || "gallery limit reached or scene skipped");
										project._imageFlowStopReason =
											"The video gallery reached its " + MAX_IMAGE_UPLOADS + "-image limit.";
										if (controller) {
											try { controller.abort(); } catch (abortError) { }
										}
									}
								}
								catch (insertError) {
									failed++;
									setImagePromptState(project, eventIndex, "failed", insertError && insertError.message ? insertError.message : String(insertError));
									console.error("[seo-image-flow] gallery insertion failed", {
										videoIndex: liveN,
										index: eventIndex,
										error: insertError && insertError.message ? insertError.message : String(insertError)
									});
								}
								const nextStatusEl = resolveStatusEl();
								if (nextStatusEl && !batchDone) nextStatusEl.textContent = progressText();
							},
							function (decodeError) {
								if (isStaleFlow()) return;
								failed++;
								setImagePromptState(project, eventIndex, "failed", decodeError && decodeError.message ? decodeError.message : String(decodeError));
								console.error("[seo-image-flow] image decode failed", {
									videoIndex: n,
									index: eventIndex,
									error: decodeError && decodeError.message ? decodeError.message : String(decodeError)
								});
								const nextStatusEl = resolveStatusEl();
								if (nextStatusEl && !batchDone) nextStatusEl.textContent = progressText();
							}
						);
					});
				}
				return;
			}

			if (event.type === "error") {
				project._imageFlowStopReason =
					"Image batch failed: " + (event.error || "unknown error");
				return;
			}

			if (event.type === "done") {
				batchDone = true;
			}
		};

		try {
			await appImageStreamQueue.enqueue(
				"editor-video-" + n,
				async function () {
					armIdleTimer();
					const response = await fetch(
						"/api/image-batch",
						Object.assign(
							{
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									"Accept": "application/x-ndjson"
								},
								body: JSON.stringify({ prompts: prompts })
							},
							controller ? { signal: controller.signal } : {}
						)
					);

					if (!response.ok) {
						const errJson = await seoResponseJson(response);
						if (errJson && errJson.credits) applyCredits(errJson.credits);
						throw new Error((errJson && errJson.error) || ("Image batch failed (HTTP " + response.status + ")"));
					}

					const reader = response.body && typeof response.body.getReader === "function"
						? response.body.getReader()
						: null;

					if (!reader) {
						throw new Error("This browser cannot read the image batch stream");
					}

					const decoder = new TextDecoder();
					let buffer = "";
					for (;;) {
						const chunk = await reader.read();
						if (chunk.done) break;
						armIdleTimer();
						buffer += decoder.decode(chunk.value, { stream: true });
						let newlineIndex = buffer.indexOf("\\n");
						while (newlineIndex >= 0) {
							const line = buffer.slice(0, newlineIndex).trim();
							buffer = buffer.slice(newlineIndex + 1);
							if (line) {
								try { handleEvent(JSON.parse(line)); } catch (parseError) { }
							}
							newlineIndex = buffer.indexOf("\\n");
						}
					}
					const tail = (buffer + decoder.decode()).trim();
					if (tail) {
						try { handleEvent(JSON.parse(tail)); } catch (parseError) { }
					}
					await galleryCommitChain;
					if (!batchDone) throw new Error("Image stream ended before completion; delivered images were kept.");
				},
				{
					signal: controller ? controller.signal : null,
					meta: { kind: "editor-video", videoIndex: n, project: project }
				}
			);
		}
		catch (batchError) {
			if (!isStaleFlow()) {
				const message = batchError && batchError.message ? batchError.message : String(batchError);
				const aborted = batchError && batchError.name === "AbortError";
				console.warn("[seo-image-flow] image batch interrupted", {
					videoIndex: n,
					added: added,
					failed: failed,
					aborted: aborted,
					error: message
				});
				if (aborted && !project._imageFlowStopReason) {
					project._imageFlowStopReason =
						"The image batch was interrupted after " + added + " of " + total + " images.";
				}
				else if (!aborted) {
					project._lastMediaError = message;
					project._imageFlowStopReason =
						"Image generation failed: " + message;
				}
			}
		}
		finally {
			await galleryCommitChain;
			if (controller) { try { controller.abort(); } catch (cleanupError) { } }
			if (idleTimer) clearTimeout(idleTimer);
			if (project._imageBatchController === controller) {
				project._imageBatchController = null;
			}
			if (typeof expectedSeq !== "number" || project._imageFlowSeq === expectedSeq) {
				project.aiImagesDone = (project.aiImagesDone || 0) + added;
				project._aiImageFailures = (project._aiImageFailures || 0) + failed;
				project._aiImageSkipped = (project._aiImageSkipped || 0) + skipped;
			}
			refreshCredits();
			console.info("[seo-image-flow] image batch finished", {
				videoIndex: n,
				requested: total,
				added: added,
				failed: failed,
				skipped: skipped,
				ms: Date.now() - (project._imageFlowStartedAt || Date.now())
			});
		}
	}

	/*
	 * Ends the flow: aborts anything still in flight, restores the upload
	 * and script buttons and reports what landed in the gallery.
	 */
	async function finalizeImagePromptFlow(
		n,
		finalReason
	) {

		const project =
			videoProjects[n - 1];
		if (!project || project._imageFlowFinalizing) return;

		project._imageFlowFinalizing = true;
		project._imageFlowActive = false;
		persistPipelineManagementState("editor-flow-finalize");

		if (project._imageBatchController) {
			try { project._imageBatchController.abort(); } catch (abortError) { }
			project._imageBatchController = null;
		}
		if (project._imagePromptCreateController) {
			try { project._imagePromptCreateController.abort(); } catch (abortError) { }
			project._imagePromptCreateController = null;
		}

		const gallery =
			document.getElementById(
				"va-gallery-" + n
			);
		const flowId =
			project.imagePromptFlowId;
		const plannedAssets = project.assets.filter(function (a) { return a.imagePromptFlowId === flowId; }).sort(function (a, b) { return a.sceneIndex - b.sceneIndex; });
		let orderedIndex = 0;
		project.assets = project.assets.map(function (a) { return a.imagePromptFlowId === flowId ? plannedAssets[orderedIndex++] : a; });
		if (gallery) project.assets.forEach(function (a) { if (a.card) gallery.appendChild(a.card); });
		/* A strict fixed-plan summary must never hide a concrete provider error. */
		if (finalReason && /fixed 12-scene plan/.test(finalReason) && project._lastMediaError) {
			finalReason = project._lastMediaError;
		}
		const requiredClips = plannedAssets.filter(function (a) { return a.kind === "mp4"; });
		const requiredPhotoCount = plannedAssets.filter(function (a) { return a.kind !== "mp4"; }).length;
		const uniqueClipIds = new Set(requiredClips.map(function (a) { return a.stockSource && a.stockSource.id; }));
		if (!finalReason && (requiredClips.length !== AUTO_VIDEO_SCENES || uniqueClipIds.size !== AUTO_VIDEO_SCENES || requiredPhotoCount !== AUTO_IMAGE_SCENES)) {
			finalReason = project._lastMediaError ||
				"The fixed 12-scene plan needs four distinct Pixabay clips and eight distinct photos. Delivered media was kept.";
		}
		const actualCount =
			project.assets.filter(function (asset) {
				return flowId && asset && asset.imagePromptFlowId === flowId && asset.card && (!gallery || asset.card.parentNode === gallery);
			}).length;
		const promptCount =
			Array.isArray(project.imagePrompts)
				? project.imagePrompts.length
				: (Number(project.imagePromptTarget) || 0);
		const imageTarget =
			Number(project.imagePromptTarget) || 0;
		const failures =
			Number(project._aiImageFailures) || 0;

\t\tproject._imageFlowFinalizing = false;
\t\tsetVaUploadEnabled(n, true);
/* A finished or stopped flow may be re-run from this same script. */
const retryBtn =
	document.getElementById("va-image-retry-" + n);
if (retryBtn) retryBtn.style.display = (project.imagePromptFlowId && !project._imageFlowActive) ? "" : "none";
/* The walkthrough's images are done: the manual button unlocks. */
		const scriptButton =
			document.getElementById(
				"va-script-btn-" + n
			);
		if (scriptButton) scriptButton.disabled = false;

		/*
		 * Before saying "stopped", check whether the reason is one a re-run
		 * could fix (a 429 wait, an idle abort, a transient network error).
		 * The countdown then owns the status line, and the scenes already in
		 * the gallery are never searched or billed twice.
		 */
		if (!finalReason) project._imageFlowRetry = null;
		const autoRetryArmed =
			finalReason ? maybeScheduleImageAutoRetry(project, finalReason) : false;

		let statusMessage;
		if (autoRetryArmed) {
			statusMessage = (project._imageAutoRetry && project._imageAutoRetry.message) ||
				"Pixabay needs a moment; retrying the missing scenes automatically.";
		}
		else if (finalReason) {
			statusMessage = "Pixabay image flow stopped: " + finalReason + " " + actualCount + " image(s) added to the gallery.";
		}
		else if (imageTarget < promptCount) {
			statusMessage = "Pixabay image flow finished — " + actualCount + " of " + promptCount + " prompted image(s) added (the video gallery allows up to " + MAX_IMAGE_UPLOADS + " still images).";
		}
		else if (failures > 0) {
			statusMessage = "Pixabay image flow finished — " + actualCount + " image(s) added; " + failures + " prompt(s) failed.";
		}
		else {
			statusMessage = "Pixabay images done — " + actualCount + " image(s) in the gallery.";
		}
		statusMessage += " Upload Image, GIF or MP4 is enabled again.";
		const statusEl =
			document.getElementById(
				"va-ai-status-" + n
			);
		if (statusEl) statusEl.textContent = statusMessage;
		console.info("[seo-image-flow] flow finalized", {
			videoIndex: n,
			flowId: flowId,
			imagesInGallery: actualCount,
			promptsExpected: promptCount,
			imagesTarget: imageTarget,
			failures: failures,
\t\t\tms: Date.now() - (project._imageFlowStartedAt || Date.now())
\t\t});
\t}

/*
 * Decode one \`pixabay:{q,...}\` planning token. The order in the returned
 * prompt list is authoritative for gallery scene indices; token metadata is
 * used for the media type and Pixabay's selected result index.
 */
function parseImagePromptToken(token, fallbackScene) {
	const fallback = Math.max(0, Number(fallbackScene) || 0);
	const parsed = { q: "", type: "image", index: fallback, scene: fallback };
	if (typeof token === "string" && token.indexOf("pixabay:") === 0) {
		try {
			const value = JSON.parse(token.slice(8));
			if (value && typeof value === "object") {
				if (typeof value.q === "string") parsed.q = value.q.trim();
				if (value.type === "video" || value.type === "image") parsed.type = value.type;
				if (Number.isInteger(value.index) && value.index >= 0) parsed.index = value.index;
				if (Number.isInteger(value.scene) && value.scene >= 0) parsed.scene = value.scene;
			}
		} catch (_) { /* Invalid structured tokens must not become bogus search queries. */ }
	} else if (typeof token === "string") {
		parsed.q = token.trim();
	}
	return parsed;
}

/* Keep a per-scene status beside every keyword so planning, actual search,
 * asset download and gallery insertion failures are visible to the user. */
function setImagePromptState(project, scene, state, detail) {
	if (!project) return;
	if (!project.imagePromptStates || typeof project.imagePromptStates !== "object") project.imagePromptStates = {};
	project.imagePromptStates[String(scene)] = { state: String(state || "planned"), detail: String(detail || "") };
	const liveN = videoProjects.indexOf(project) + 1;
	if (liveN > 0) renderImageKeywords(liveN);
}

function renderImageKeywords(n) {
	const project = videoProjects[n - 1];
	if (!project) return;
	const box = document.getElementById("va-image-keywords-" + n);
	if (!box) return;
	const prompts = Array.isArray(project.imagePrompts) ? project.imagePrompts : [];
	if (!prompts.length) { box.style.display = "none"; box.innerHTML = ""; return; }
	const states = project.imagePromptStates || {};
	const rows = prompts.map(function (token, index) {
		const parsed = parseImagePromptToken(token, index);
		const state = states[String(index)] || { state: "planned", detail: "" };
		const typeLabel = parsed.type === "video" ? "VIDEO" : "PHOTO";
		const statusLabel = state.state === "imported" ? "in gallery" : state.state === "searching" ? "searching…" : state.state === "failed" ? "failed" : "planned";
		const detail = state.detail ? " — " + state.detail : "";
		return '<div class="va-seo-row va-pixabay-keyword-row"><span class="va-seo-label">Scene ' + (index + 1) + ' · ' + typeLabel + '</span>' +
			'<span class="va-seo-chip" title="Pixabay search keyword">' + escapeHTML(parsed.q || String(token || "")) + '</span>' +
			'<span class="va-pixabay-keyword-status" data-state="' + escapeHTML(state.state) + '">' + escapeHTML(statusLabel + detail) + '</span></div>';
	}).join("");
	box.innerHTML = '<div class="va-seo-heading">Pixabay search keywords (' + prompts.length + ' scenes)</div>' + rows;
	box.style.display = "";
}

/*
 * Retry means actually search Pixabay in the browser using the already-visible
 * scene keywords, download chosen assets through the same-origin Worker, and
 * add successful results to the gallery. Re-plan only if no usable keyword
 * list exists (for example, the planner itself failed).
 */
async function retryImagePromptFlow(n) {
	const project = videoProjects[n - 1];
	if (!project || project._imageFlowActive) return;
	if (!Array.isArray(project.imagePrompts) || !project.imagePrompts.length) {
		project._imageFlowActive = true;
		project._imageFlowStopReason = "";
		const status = document.getElementById("va-ai-status-" + n);
		if (status) status.textContent = "No planned search keywords are available; planning new Pixabay searches…";
		return startImagePromptFlow(n);
	}

	project._imageFlowActive = true;
	project._imageFlowSeq = (project._imageFlowSeq || 0) + 1;
	project._imageFlowStartedAt = Date.now();
	project._requiresStockClips = true;
	project._imageFlowStopReason = "";
	project._aiImageFailures = 0;
	project.imagePromptStates = {};
	cancelImageAutoRetry(project, { quiet: true });
	project._imageFlowRetry = null;
	const seq = project._imageFlowSeq;
	const stale = function () { return Boolean(project._deleted || project._imageFlowSeq !== seq || !project._imageFlowActive); };
	const liveIndex = function () { return videoProjects.indexOf(project) + 1; };
	const liveN = liveIndex();
	const flowId = project.imagePromptFlowId || ("imgretry-" + liveN + "-" + seq + "-" + Date.now().toString(36));
	const statusEl = document.getElementById("va-ai-status-" + liveN);
	const btn = document.getElementById("va-image-retry-" + liveN);
	project.imagePromptFlowId = flowId;
	project.aiImagesDone = project.assets.filter(function (asset) { return asset.imagePromptFlowId === flowId; }).length;
	if (btn) { btn.disabled = true; btn.style.display = ""; btn.textContent = "Searching Pixabay…"; }
	// Keep successful paid imports and retry only scenes that are absent from the gallery.
	const stillVisibleFilenames = new Set(project.assets.map(function (asset) { return asset && asset.stockFilename; }).filter(Boolean));
	project.mediaFilenames = recordedMediaFilenames(project).filter(function (filename) { return stillVisibleFilenames.has(filename); });
	for (let i = 0; i < project.imagePrompts.length; i++) {
		const alreadyImported = project.assets.some(function (asset) { return asset.imagePromptFlowId === flowId && Number(asset.sceneIndex) === i; });
		setImagePromptState(project, i, alreadyImported ? "imported" : "planned", alreadyImported ? "already in gallery" : "");
	}

	let controller = typeof AbortController !== "undefined" ? new AbortController() : null;
	project._imageBatchController = controller;
	/*
	 * SESSION 279: ONE PROVIDER ATTEMPT PER SCENE, PLUS ONE STALL RE-ARM.
	 *
	 * The complaint this ladder answered is still real - a 429 ("please wait
	 * before searching again") on scene 3 of 7 used to drop scene 3 for good -
	 * but three tries per scene made the page a SECOND retry owner: every
	 * attempt below already includes the browser-first search AND the
	 * same-origin Worker fallback for that scene, and the worker side of that
	 * fallback (generateOneWithRetry) spends up to 4 attempts inside a 45 s
	 * budget, honours Retry-After and stops on a fatal verdict.
	 *
	 * What a scene keeps is not a provider ladder:
	 *   - the stall watchdog below, which is a HANG guard: a scene that stops
	 *     responding for SCENE_IDLE_TIMEOUT_MS is aborted and re-armed once on a
	 *     fresh controller;
	 *   - the provider's Retry-After hint, recorded on the flow marker so the
	 *     SCHEDULED automatic retry waits the right amount - that scheduler is
	 *     the only thing that can sit out a minutes-long rate-limit window, and
	 *     no in-request ladder (browser or worker) can;
	 *   - the visible per-scene verdict.
	 */
	const sceneRetryTiming =
		(typeof window !== "undefined" && window.__PIXABAY_SCENE_RETRY) || {};
	const SCENE_STALL_REARMS = Math.max(0, Math.floor(Number(sceneRetryTiming.stallRearms) || 1));
	const SCENE_ATTEMPTS = SCENE_STALL_REARMS + 1;
	/*
	 * The stall guard for a single scene. It aborts only THIS attempt and
	 * then re-arms on a fresh controller; previously an abort of the shared
	 * controller ended the whole retry run.
	 */
	const SCENE_IDLE_TIMEOUT_MS = Math.max(1, Math.floor(Number(sceneRetryTiming.idleMs) || 90000));
	let sceneWatchdog = null;
	const clearSceneWatchdog = function () {
		if (sceneWatchdog) { clearTimeout(sceneWatchdog); sceneWatchdog = null; }
	};
	const armSceneWatchdog = function () {
		clearSceneWatchdog();
		if (!controller) return;
		sceneWatchdog = setTimeout(function () {
			sceneWatchdog = null;
			project._imageFlowRetry = {
				kind: "timeout",
				retryable: true,
				hintMs: 5000,
				reason: "The Pixabay search stopped responding for " + Math.round(SCENE_IDLE_TIMEOUT_MS / 1000) + " seconds."
			};
			console.warn("[pixabay-retry] scene stalled; aborting this attempt so it can be retried", { timeoutMs: SCENE_IDLE_TIMEOUT_MS });
			try { controller.abort(); } catch (abortError) { }
		}, SCENE_IDLE_TIMEOUT_MS);
	};
	/* Retry-After is seconds on the wire; the client works in milliseconds. */
	const mediaRetryHintMs = function (response, body) {
		const fromBody = Number(body && body.retryAfterMs) > 0 ? Number(body.retryAfterMs) : 0;
		if (fromBody) return fromBody;
		const headerSeconds = Number(response && response.headers && response.headers.get ? response.headers.get("Retry-After") : 0);
		return headerSeconds > 0 ? Math.round(headerSeconds * 1000) : 0;
	};
	/* "No results for this keyword" is an answer, not a transmission error. */
	const SCENE_RETRYABLE = /rate limit|429|too many requests|busy|overload|temporar|timeout|timed out|network|failed to fetch|interrupted/i;
	let imported = 0;
	let failed = 0;
	try {
		sceneLoop:
		for (let i = 0; i < project.imagePrompts.length; i++) {
			if (stale()) break;
			const alreadyImported = project.assets.some(function (asset) { return asset.imagePromptFlowId === flowId && Number(asset.sceneIndex) === i; });
			if (alreadyImported) continue;
			const selection = parseImagePromptToken(project.imagePrompts[i], i);
			if (!selection.q) {
				failed++;
				setImagePromptState(project, i, "failed", "missing search keyword");
				continue;
			}
			setImagePromptState(project, i, "searching", "");
			if (statusEl) statusEl.textContent = "Pixabay search " + (i + 1) + " of " + project.imagePrompts.length + ": " + selection.q;
			console.info("[pixabay-retry] scene.search", { scene: i, type: selection.type, keyword: selection.q });
			let sceneOk = false;
			let sceneError = null;
			let sceneHintMs = 0;
			/* Session 279: the verdict the attempt produced, kept for the marker. */
			let sceneRetryable = false;
			for (let attempt = 1; attempt <= SCENE_ATTEMPTS; attempt++) {
			armSceneWatchdog();
			try {
				/*
				 * Browser-first: search and download the asset in this tab,
				 * with one claimed import unit. Any failure (CORS, provider,
				 * CDN) refunds that unit and falls back to the same-origin
				 * Worker route for this scene only.
				 */
				let blob = null;
				let hit = null;
				const direct = typeof studioPixabayDirect !== "undefined" ? studioPixabayDirect : null;
				if (direct && await direct.enabled()) {
					let claim = null;
					try { claim = await direct.claim(1, controller ? { signal: controller.signal } : null); }
					catch (claimError) {
						if (claimError && claimError.name === "AbortError") throw claimError;
						console.warn("[pixabay-retry] browser credit claim unavailable; using the same-origin path", { scene: i, error: String(claimError && claimError.message || claimError).slice(0, 300) });
					}
					if (claim) {
						try {
							const scene = await direct.scene(project.imagePrompts[i], {}, controller ? { signal: controller.signal } : null);
							if (!scene || !scene.blob || !scene.blob.size) throw new Error("Empty Pixabay scene");
							blob = scene.blob;
							hit = scene.hit || null;
							blob.stockSource = scene.source || { provider: "pixabay", id: hit && hit.id, pageURL: hit && hit.pageURL || "", user: hit && hit.user || "", type: selection.type, duration: hit && hit.duration || 0 };
							console.info("[pixabay-retry] scene.direct", { scene: i, id: hit && hit.id, type: selection.type, bytes: blob.size });
						} catch (directError) {
							if (directError && directError.name === "AbortError") throw directError;
							console.warn("[pixabay-retry] browser Pixabay fetch fell back", { scene: i, status: Number(directError && directError.status) || 0, kind: directError && directError.kind || "", error: String(directError && directError.message || directError).slice(0, 300) });
						} finally {
							try { await direct.settle(claim.claimId, blob ? 1 : 0); } catch (_) {}
						}
					}
				}
				if (!blob) {
					const searchUrl = new URL("/api/media/search", window.location.href);
					searchUrl.searchParams.set("q", selection.q);
					searchUrl.searchParams.set("type", selection.type);
					searchUrl.searchParams.set("page", "1");
					searchUrl.searchParams.set("per_page", String(AUTO_MEDIA_TOTAL));
					searchUrl.searchParams.set("orientation", "landscape");
					const searchResponse = await fetch(searchUrl.pathname + searchUrl.search, controller ? { signal: controller.signal } : undefined);
					const searchData = await searchResponse.json().catch(function () { return null; });
					if (!searchResponse.ok || !searchData || !Array.isArray(searchData.hits)) {
						/*
						 * The server answers a 429 with "Pixabay rate limit
						 * (429). Please wait before searching again." plus a
						 * Retry-After header. Both are kept: the status makes
						 * the failure retryable, the header says how long to
						 * wait. Without them the scene was simply dropped.
						 */
						const searchError = new Error((searchData && searchData.error) || ("Pixabay search failed (HTTP " + searchResponse.status + ")"));
						searchError.status = searchResponse.status;
						searchError.kind = (searchData && searchData.kind) || (searchResponse.status === 429 ? "rate-limit" : "");
						searchError.retryAfterMs = mediaRetryHintMs(searchResponse, searchData);
						throw searchError;
					}
					console.info("[pixabay-retry] scene.search-result", { scene: i, status: searchResponse.status, hits: searchData.hits.length });
					hit = searchData.hits[selection.index] || searchData.hits[0];
					if (!hit || !hit.id) throw new Error("No Pixabay " + selection.type + " results for this keyword");

					const assetUrl = new URL("/api/media/asset", window.location.href);
					assetUrl.searchParams.set("id", String(hit.id));
					assetUrl.searchParams.set("q", selection.q);
					assetUrl.searchParams.set("type", selection.type);
					assetUrl.searchParams.set("page", "1");
					assetUrl.searchParams.set("per_page", String(AUTO_MEDIA_TOTAL));
					assetUrl.searchParams.set("orientation", "landscape");
					const assetResponse = await fetch(assetUrl.pathname + assetUrl.search, controller ? { signal: controller.signal } : undefined);
					if (!assetResponse.ok) {
						const errorData = await assetResponse.json().catch(function () { return null; });
						const assetError = new Error((errorData && errorData.error) || ("Pixabay asset download failed (HTTP " + assetResponse.status + ")"));
						assetError.status = assetResponse.status;
						assetError.kind = (errorData && errorData.kind) || (assetResponse.status === 429 ? "rate-limit" : "");
						assetError.retryAfterMs = mediaRetryHintMs(assetResponse, errorData);
						throw assetError;
					}
					const mime = assetResponse.headers.get("content-type") || (selection.type === "video" ? "video/mp4" : "image/jpeg");
					blob = await assetResponse.blob();
					if (mime.indexOf("video/") === 0 && blob.type !== "video/mp4") blob = new Blob([blob], { type: mime });
					if (selection.type === "video" && blob.type !== "video/mp4") throw new Error("Pixabay returned a non-MP4 asset for a video scene");
					if (selection.type === "image" && blob.type.indexOf("image/") !== 0) throw new Error("Pixabay returned a non-image asset for a photo scene");
					console.info("[pixabay-retry] scene.downloaded", { scene: i, id: hit.id, type: selection.type, mime: blob.type, bytes: blob.size });
					blob.stockSource = { provider: "pixabay", id: hit.id, pageURL: hit.pageURL || "", user: hit.user || "", type: selection.type, duration: hit.duration || 0 };
				}
				if (stale()) break sceneLoop;
				const at = liveIndex();
				if (at <= 0 || !await insertStockScene(at, blob, flowId, i, stale)) throw new Error("Could not add the downloaded asset to the gallery");
				imported++;
				/* Add to the scenes already in the gallery, never reset the count. */
				project.aiImagesDone = (project.aiImagesDone || 0) + 1;
				recordStudioUsage("images", "ok", 1);
				setImagePromptState(project, i, "imported", selection.type === "video" ? "clip added to gallery" : "photo added to gallery");
				console.info("[pixabay-retry] scene.added-to-gallery", { scene: i, id: hit.id, type: selection.type, imported });
				sceneOk = true;
				/*
				 * A scene that eventually landed is not a reason to retry
				 * later - but a scene that failed earlier in this same pass
				 * still is, so the marker survives while any failure stands.
				 */
				if (!failed) project._imageFlowRetry = null;
			} catch (error) {
				if (error && error.name === "AbortError") {
					const stalled = Boolean(project._imageFlowRetry && project._imageFlowRetry.kind === "timeout");
					if (stalled && attempt < SCENE_ATTEMPTS && !stale()) {
						/* The guard tripped, not the user: re-arm and try again. */
						project._imageFlowRetry = null;
						controller = typeof AbortController !== "undefined" ? new AbortController() : null;
						project._imageBatchController = controller;
						sceneError = error;
						console.warn("[pixabay-retry] scene attempt stalled, re-arming", { scene: i, attempt: attempt, of: SCENE_ATTEMPTS });
						setImagePromptState(project, i, "searching", "stalled; retrying");
						await new Promise(function (resolve) { setTimeout(resolve, 1500); });
						continue;
					}
					break sceneLoop;
				}
				sceneError = error;
				sceneHintMs = Number(error && error.retryAfterMs) > 0 ? Number(error.retryAfterMs) : 0;
				const retryable =
					SCENE_RETRYABLE.test(String(error && error.message || error)) ||
					[408, 429, 500, 502, 503, 504].indexOf(Number(error && error.status)) >= 0;
				sceneRetryable = retryable;
				/*
				 * SESSION 279: no second provider attempt from this page. The
				 * worker fallback inside this attempt already spent its ladder,
				 * so what is left is the verdict - recorded below on the flow
				 * marker, where the scheduled automatic retry picks up the
				 * Retry-After hint and waits it out.
				 */
				console.warn("[pixabay-retry] scene attempt failed; the worker ladder is spent", {
					scene: i,
					retryable: retryable,
					hintMs: sceneHintMs,
					error: String(error && error.message || error).slice(0, 300)
				});
				setImagePromptState(project, i, "searching", "attempt failed; the worker already retried");
				break;
			}
			clearSceneWatchdog();
			if (sceneOk) break;
			}
			if (!sceneOk && !stale()) {
				failed++;
				project._aiImageFailures++;
				const message = sceneError && sceneError.message ? sceneError.message : String(sceneError || "Pixabay scene failed");
				setImagePromptState(project, i, "failed", message);
				console.error("[pixabay-retry] scene failed", { scene: i, type: selection.type, keyword: selection.q, attempts: SCENE_ATTEMPTS, error: message.slice(0, 500) });
				/*
				 * Leave a retry marker only for reasons a re-run could fix. A
				 * non-retryable marker stops the finalizer from looping on a
				 * scene that will never succeed.
				 *
				 * SESSION 279 (hang audit): the marker must use the SAME verdict
				 * the attempt computed - wording OR status. Testing the message
				 * alone dropped a plain 502 ("Simulated ... redirect failure")
				 * into the non-retryable branch, and with the in-click ladder
				 * gone that left the user a failed scene and no scheduled
				 * retry: a dead end the previous code had papered over.
				 */
				if (sceneRetryable) {
					project._imageFlowRetry = { kind: sceneHintMs ? "rate-limit" : "scene", retryable: true, hintMs: sceneHintMs, reason: message };
				} else {
					project._imageFlowRetry = { kind: "scene", retryable: false, hintMs: 0, reason: message };
				}
			}
		}
	} finally {
		if (typeof clearSceneWatchdog === "function") clearSceneWatchdog();
		refreshCredits();
		if (!stale()) {
			project._imageBatchController = null;
			project._imageFlowActive = false;
			/* Only scenes that are still missing may trigger an automatic retry. */
			if (!failed) project._imageFlowRetry = null;
			if (liveIndex() > 0) await finalizeImagePromptFlow(liveIndex(), failed ? "Some Pixabay searches failed; successful assets were kept." : "");
			if (btn) { btn.disabled = false; btn.textContent = "Retry Pixabay search"; }
			if (statusEl && !failed) statusEl.textContent = imported
				? "Pixabay retry finished: " + imported + " missing scene(s) added to the gallery; existing scenes were kept."
				: "All planned Pixabay scenes are already in the gallery; no duplicate imports were billed.";
		}
	}
}

/*
 * CLIENT-OWNED SCRIPT RETRIES.
 *
 * Script writing is deliberately owned by the browser. A failed write
 * is retried up to seven times, with a 40-second backoff before every
 * retry. The shared requester keeps the initial textbox and loading
 * animation alive for the entire ladder and a UI checker removes any
 * failure or retry wording before it can reach either layout. The
 * Worker performs one inference per request so the browser remains the
 * only retry owner for this stage. Outside the Quick Batch table pipeline,
 * media and voiceover keep their worker-owned in-request ladders.
 */

	/*
	 * RULE 35 (2026-11-03) — SCRIPT NOTES ARE CLIENT-SIDE ONLY.
	 *
	 * The Worker advertises "scriptNoteStorage: client:localStorage+cookie",
	 * "asyncScript: 0", "scriptNoteKvWrites: 0" and a consistency mode. The
	 * studio therefore makes ONE synchronous /api/script request, keeps the
	 * finished narration in localStorage + cookie (checked against each other
	 * by digest, timestamp and script length), and never depends on a
	 * server-side KV note. The async poll below survives only as a
	 * compatibility path for an OLD Worker that still advertises
	 * "asyncScript" without the RULE 35 fields.
	 */
	/*
	 * SCRIPT NOTES (dynamic URL) + ASYNC SCRIPT JOBS
	 *
	 * When the worker advertises "scriptNotes", every script request carries
	 * "useNotes", so the worker reuses the note for this topic/source URL:
	 * the note holds the validated keyword set and the beat plan, which takes
	 * the planner call (and a lot of retry risk) out of the path. When the
	 * worker also advertises "asyncScript", the request is submitted as a job
	 * ("/api/script?async=1"), the worker answers 202 with a note id, and this
	 * client returns to the request by polling GET /api/script/notes/<id> until
	 * the note is done or failed. Both paths end in the same "data" shape, so
	 * nothing downstream knows which one ran.
	 */
	const SCRIPT_NOTE_POLL_MS =
		900;
	const SCRIPT_NOTE_MAX_WAIT_MS =
		185000;
	/*
	 * Hang guards (see current_code_latest.md §2b). A note that stops
	 * advancing must end the flow: 15 s without a state change, three
	 * consecutive failed polls and the wall-clock ceiling are the only
	 * reasons this client stops waiting. The server advertises the same
	 * numbers in /api/capabilities, so the page follows the worker instead
	 * of guessing.
	 */
	const SCRIPT_NOTE_STALL_MS =
		15000;
	const SCRIPT_NOTE_POLL_ATTEMPTS =
		3;
	/*
	 * #5: a client request that has not answered in 20 s is retried instead of
	 * holding the tab for 105 s. That is safe because the negotiated async path
	 * answers in milliseconds and the job lives in its note - the 105 s ceiling
	 * is kept only for a Worker that has no note/async support and therefore has
	 * to hold one long response.
	 */
	const SCRIPT_REQUEST_TIMEOUT_MS =
		20000;
	const SCRIPT_LEGACY_TIMEOUT_MS =
		105000;

	/*
	 * CLIENT-OWNED, SILENT SCRIPT-WRITING RETRIES.
	 *
	 * A script-writing error is handled here, in the browser, before either
	 * layout can paint a failure. The initial write is followed by at most
	 * SEVEN retries; every retry waits 40 seconds first. Throughout the whole
	 * ladder the UI checker keeps the script textbox and its spinner on screen
	 * and replaces any accidental failure/retry wording with the normal
	 * "Writing your SEO script..." state. Console/global diagnostics never
	 * become UI text.
	 */
	const SCRIPT_WRITE_MAX_RETRIES = 7;
	const SCRIPT_WRITE_RETRY_BACKOFF_MS = 40000;
	const SCRIPT_WRITE_UI_TEXT = "Writing your SEO script...";
	const SCRIPT_WRITE_UI_CHECK_MS = 250;
	const SCRIPT_WRITE_TOTAL_ATTEMPTS = SCRIPT_WRITE_MAX_RETRIES + 1;

	/* Exposed so tests / debugging can see (and shrink) the live budgets. */
	if (typeof window !== "undefined") {
		const existingPipelineTiming =
			window.__SCRIPT_PIPELINE_TIMING && typeof window.__SCRIPT_PIPELINE_TIMING === "object"
				? window.__SCRIPT_PIPELINE_TIMING
				: null;
		const suppliedRetryTiming =
			window.__SCRIPT_RETRY_TIMING && typeof window.__SCRIPT_RETRY_TIMING === "object"
				? window.__SCRIPT_RETRY_TIMING
				: window.__SCRIPT_RETRY_POLICY && typeof window.__SCRIPT_RETRY_POLICY === "object"
					? window.__SCRIPT_RETRY_POLICY
					: window.__SCRIPT_RETRY && typeof window.__SCRIPT_RETRY === "object"
						? window.__SCRIPT_RETRY
						: null;
		const retryTiming = suppliedRetryTiming || {};
		const retryDefaults = {
			maxRetries: SCRIPT_WRITE_MAX_RETRIES,
			maxAttempts: SCRIPT_WRITE_TOTAL_ATTEMPTS,
			backoffMs: SCRIPT_WRITE_RETRY_BACKOFF_MS,
			retryBackoffMs: SCRIPT_WRITE_RETRY_BACKOFF_MS,
			delayMs: SCRIPT_WRITE_RETRY_BACKOFF_MS,
			scriptRetryBackoffMs: SCRIPT_WRITE_RETRY_BACKOFF_MS,
			uiCheckMs: SCRIPT_WRITE_UI_CHECK_MS,
			owner: "browser"
		};
		for (const key in existingPipelineTiming) {
			if (!(key in retryTiming)) retryTiming[key] = existingPipelineTiming[key];
		}
		for (const key in retryDefaults) {
			if (!(key in retryTiming)) retryTiming[key] = retryDefaults[key];
		}
		window.__SCRIPT_RETRY_TIMING = retryTiming;
		window.__SCRIPT_RETRY_POLICY = retryTiming;
		window.__SCRIPT_RETRY = retryTiming;
		window.__SCRIPT_PIPELINE_TIMING = Object.assign({}, existingPipelineTiming || {}, {
			requestTimeoutMs: SCRIPT_REQUEST_TIMEOUT_MS,
			legacyTimeoutMs: SCRIPT_LEGACY_TIMEOUT_MS,
			notePollMs: SCRIPT_NOTE_POLL_MS,
			noteWaitMs: SCRIPT_NOTE_MAX_WAIT_MS,
			noteStallMs: SCRIPT_NOTE_STALL_MS,
			notePollAttempts: SCRIPT_NOTE_POLL_ATTEMPTS,
			maxRetries: SCRIPT_WRITE_MAX_RETRIES,
			maxAttempts: SCRIPT_WRITE_TOTAL_ATTEMPTS,
			backoffMs: SCRIPT_WRITE_RETRY_BACKOFF_MS,
			retryBackoffMs: SCRIPT_WRITE_RETRY_BACKOFF_MS,
			delayMs: SCRIPT_WRITE_RETRY_BACKOFF_MS,
			scriptRetryBackoffMs: SCRIPT_WRITE_RETRY_BACKOFF_MS,
			uiCheckMs: SCRIPT_WRITE_UI_CHECK_MS
		});
		window.__SCRIPT_RETRY_LOG = [];
	}

	function scriptWriteRetrySources() {
		if (typeof window === "undefined") return [];
		return [
			window.__SCRIPT_RETRY_TIMING,
			window.__SCRIPT_RETRY_POLICY,
			window.__SCRIPT_RETRY,
			window.__SCRIPT_PIPELINE_TIMING,
			window.__SEO_FLOW_TIMING
		];
	}

	/*
	 * A non-default value in ANY exposed timing object is an override. This
	 * keeps one mutable object for normal use while still honouring a test
	 * that replaces just one alias before or after the page script runs.
	 */
	function scriptWriteRetryPolicy() {
		const retryKeys = ["maxRetries", "maxScriptRetries", "retries", "retryLimit", "scriptRetries", "scriptWriteRetries", "clientRetries", "limit"];
		const attemptKeys = ["maxAttempts", "maxScriptAttempts", "attempts", "scriptAttempts", "totalAttempts"];
		const backoffKeys = ["backoffMs", "retryBackoffMs", "delayMs", "retryDelayMs", "retryMs", "backoff", "scriptRetryBackoffMs", "scriptWriteBackoffMs"];
		const uiKeys = ["uiCheckMs", "scriptUiCheckMs", "tickMs"];
		let retryOverride = null;
		let attemptOverride = null;
		let backoffOverride = null;
		let uiOverride = null;
		for (const source of scriptWriteRetrySources()) {
			if (!source || typeof source !== "object") continue;
			for (const key of retryKeys.concat(attemptKeys, backoffKeys, uiKeys)) {
				const value = Number(source[key]);
				if (!isFinite(value) || value < 0) continue;
				if (retryKeys.indexOf(key) !== -1 && value !== SCRIPT_WRITE_MAX_RETRIES && retryOverride === null) retryOverride = value;
				if (attemptKeys.indexOf(key) !== -1 && value !== SCRIPT_WRITE_TOTAL_ATTEMPTS && attemptOverride === null) attemptOverride = value;
				if (backoffKeys.indexOf(key) !== -1 && value !== SCRIPT_WRITE_RETRY_BACKOFF_MS && backoffOverride === null) backoffOverride = value;
				if (uiKeys.indexOf(key) !== -1 && value !== SCRIPT_WRITE_UI_CHECK_MS && uiOverride === null) uiOverride = value;
			}
		}
		let maxRetries = SCRIPT_WRITE_MAX_RETRIES;
		if (retryOverride !== null) maxRetries = retryOverride;
		else if (attemptOverride !== null) maxRetries = Math.max(0, attemptOverride - 1);
		const backoffMs = backoffOverride !== null ? backoffOverride : SCRIPT_WRITE_RETRY_BACKOFF_MS;
		const uiCheckMs = uiOverride !== null ? uiOverride : SCRIPT_WRITE_UI_CHECK_MS;
		return {
			maxRetries: Math.max(0, Math.floor(maxRetries)),
			backoffMs: Math.max(0, Math.floor(backoffMs)),
			uiCheckMs: Math.max(0, Math.floor(uiCheckMs))
		};
	}

	function scriptWriteRetryLog(entry) {
		if (typeof window === "undefined") return;
		const log = Array.isArray(window.__SCRIPT_RETRY_LOG) ? window.__SCRIPT_RETRY_LOG : [];
		log.push(Object.assign({ at: Date.now() }, entry || {}));
		while (log.length > 40) log.shift();
		window.__SCRIPT_RETRY_LOG = log;
	}

	function scriptWriteUiLooksLikeError(text) {
		return /failed|failure|error|retry|retrying|timed out|timeout|cancelled|canceled|stopped|unavailable|invalid|abort|⚠/i.test(String(text || ""));
	}

	function keepScriptWriteUi(context, force) {
		if (context && typeof context.keepWritingUi === "function") {
			context.keepWritingUi(Boolean(force));
		}
	}

	function scriptWriteUiHasError(context) {
		if (!context) return false;
		if (typeof context.uiHasError === "function") return Boolean(context.uiHasError());
		const nodes = typeof context.uiNodes === "function" ? context.uiNodes() : [];
		for (const node of nodes || []) {
			if (node && scriptWriteUiLooksLikeError(node.textContent)) return true;
		}
		return false;
	}

	function cancelScriptWriteRetryWait(target) {
		const wait = target && target._scriptRetryWait;
		if (wait && typeof wait.cancel === "function") {
			try { wait.cancel(); } catch (cancelError) { }
		}
		if (target) target._scriptRetryWait = null;
		cancelBatchPipelineRetryWait(target);
	}

	/*
	 * One full 40-second timer per retry. A deletion / Stop can cancel the
	 * pending wait immediately instead of leaving a timer behind.
	 */
	function scriptWriteRetryDelay(ms, context) {
		return new Promise(function (resolve) {
			let timer = null;
			let settled = false;
			const finish = function (cancelled) {
				if (settled) return;
				settled = true;
				if (timer !== null) clearTimeout(timer);
				if (context && typeof context.clearRetryWait === "function") context.clearRetryWait();
				resolve(!cancelled);
			};
			const handle = {
				delayMs: ms,
				cancel: function () { finish(true); }
			};
			if (context && typeof context.setRetryWait === "function") context.setRetryWait(handle);
			if (context && typeof context.isCancelled === "function" && context.isCancelled()) {
				finish(true);
				return;
			}
			timer = setTimeout(function () {
				finish(Boolean(context && typeof context.isCancelled === "function" && context.isCancelled()));
			}, ms);
		});
	}

	/* A DOM watcher: any error text that appears is put back into writing mode. */
	function startScriptWriteUiCheck(context, policy) {
		let observer = null;
		let ticker = null;
		const observed = [];
		if (typeof window !== "undefined" && typeof window.MutationObserver === "function" && context && typeof context.uiNodes === "function") {
			observer = new window.MutationObserver(function () {
				if (observer && typeof context.uiNodes === "function") {
					for (const node of context.uiNodes() || []) {
						if (node && observed.indexOf(node) === -1) {
							observed.push(node);
							try { observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true }); } catch (observeError) { }
						}
					}
				}
				if (scriptWriteUiHasError(context)) keepScriptWriteUi(context, true);
			});
			for (const node of context.uiNodes() || []) {
				if (node && observed.indexOf(node) === -1) {
					observed.push(node);
					try { observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true }); } catch (observeError) { }
				}
			}
			if (document.body) {
				try { observer.observe(document.body, { childList: true, subtree: true }); } catch (observeError) { }
			}
		}
		let stopped = false;
		if (typeof window !== "undefined" && typeof window.setTimeout === "function" && policy.uiCheckMs > 0) {
			const tick = function () {
				if (stopped) return;
				if (scriptWriteUiHasError(context)) keepScriptWriteUi(context, true);
				ticker = window.setTimeout(tick, policy.uiCheckMs);
			};
			ticker = window.setTimeout(tick, policy.uiCheckMs);
		}
		return {
			stop: function () {
				stopped = true;
				if (observer) { try { observer.disconnect(); } catch (disconnectError) { } }
				if (ticker !== null && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
					try { window.clearTimeout(ticker); } catch (clearError) { }
				}
			}
		};
	}

	/*
	 * ONE requester for both layouts. Every error - including a 4xx or a
	 * worker verdict marked non-retryable - is a script-writing error here and
	 * is retried silently. Only an explicit cancellation stops the ladder.
	 */
	async function requestScriptWritingWithClientRetries(context, options) {
		const policy = scriptWriteRetryPolicy();
		const isCancelled = context && typeof context.isCancelled === "function"
			? context.isCancelled
			: function () { return false; };
		let lastError = null;
		keepScriptWriteUi(context, false);
		const uiCheck = startScriptWriteUiCheck(context, policy);
		try {
			for (let retry = 0; retry <= policy.maxRetries; retry++) {
				if (isCancelled()) {
					const cancelled = new Error("Script generation was cancelled");
					cancelled.name = "AbortError";
					cancelled.code = "SCRIPT_CANCELLED";
					throw cancelled;
				}
				keepScriptWriteUi(context, false);
				scriptWriteRetryLog({ event: "attempt", retry: retry, attempt: retry + 1, maxRetries: policy.maxRetries });
				try {
					const attemptOptions = Object.assign({}, options || {}, {
						clientRetry: retry,
						previousFailure: lastError ? String(lastError.message || lastError).slice(0, 800) : ""
					});
					const data = await requestScriptWithNotes(context, attemptOptions);
					const script = String(data && data.script || "").trim();
					if (!script) {
						const empty = new Error("The script came back empty");
						empty.code = "SCRIPT_EMPTY";
						throw empty;
					}
					scriptWriteRetryLog({ event: "success", retry: retry, attempt: retry + 1 });
					return Object.assign({}, data, { script: script });
				} catch (error) {
					lastError = error;
					const cancelled = isCancelled() || Boolean(error && error.code === "SCRIPT_CANCELLED");
					if (cancelled) {
						scriptWriteRetryLog({ event: "cancelled", retry: retry, attempt: retry + 1 });
						throw error;
					}
					scriptWriteRetryLog({
						event: "attempt-failed",
						retry: retry,
						attempt: retry + 1,
						reason: String(error && (error.message || error) || "unknown").slice(0, 160)
					});
					keepScriptWriteUi(context, true);
					if (retry >= policy.maxRetries) {
						if (error) {
							try {
								error.clientRetries = retry;
								error.clientAttempts = retry + 1;
							} catch (decorateError) { }
						}
						scriptWriteRetryLog({ event: "budget-exhausted", attempts: retry + 1, maxRetries: policy.maxRetries });
						throw error;
					}
					scriptWriteRetryLog({
						event: "backoff",
						delayMs: policy.backoffMs,
						nextRetry: retry + 1,
						maxRetries: policy.maxRetries
					});
					const proceed = await scriptWriteRetryDelay(policy.backoffMs, context);
					if (!proceed || isCancelled()) {
						const cancelledDuringBackoff = new Error("Script generation was cancelled");
						cancelledDuringBackoff.name = "AbortError";
						cancelledDuringBackoff.code = "SCRIPT_CANCELLED";
						throw cancelledDuringBackoff;
					}
				}
			}
		} finally {
			uiCheck.stop();
			if (context && typeof context.clearRetryWait === "function") context.clearRetryWait();
		}
		const exhausted = new Error("Script writing retry budget exhausted");
		exhausted.code = "SCRIPT_RETRY_BUDGET_EXHAUSTED";
		throw exhausted;
	}

	function fetchWithTimeout(
		url,
		init,
		ms
	) {

		if (typeof AbortController !== "function") {
			return fetch(url, init);
		}

		const controller =
			new AbortController();
		const timer =
			setTimeout(function () {
				try {
					controller.abort();
				} catch (abortError) {
					/* already settled */
				}
			}, ms);

		return fetch(
			url,
			Object.assign({}, init || {}, { signal: controller.signal })
		).then(
			function (response) {
				clearTimeout(timer);
				return response;
			},
			function (error) {
				clearTimeout(timer);
				if (error && error.name === "AbortError") {
					const timeout = new Error("Request timed out after " + Math.round(ms / 1000) + "s");
					timeout.name = "TimeoutError";
					timeout.retryable = true;
					throw timeout;
				}
				throw error;
			}
		);
	}

	/* The note this browser already holds for exactly this script, if any. */
	function browserScriptNote(
		project,
		topic,
		minutes,
		speed
	) {

		try {
			const hint = scriptNoteMemory.get({
				topic: topic,
				sourceUrl: project && project.scriptSourceUrl ? project.scriptSourceUrl : "",
				minutes: minutes,
				speed: speed
			});
			/* RULE 35: verify localStorage <-> cookie before trusting a hint. */
			const audit = scriptNoteMemory.check({
				topic: topic,
				sourceUrl: project && project.scriptSourceUrl ? project.scriptSourceUrl : "",
				minutes: minutes,
				speed: speed
			});
			if (typeof window !== "undefined") window.__SCRIPT_NOTE_CONSISTENCY = audit;
			if (!audit.consistent && !audit.repaired) {
				console.warn("[script-notes] storage inconsistency", audit.reason);
			}
			return hint;
		} catch (noteError) {
			console.warn("[script-notes] browser note read failed", String(noteError && noteError.message || noteError).slice(0, 200));
			return null;
		}
	}

	/* Writes the finished script back so the next run starts warm. */
	function rememberBrowserScriptNote(
		project,
		topic,
		minutes,
		speed,
		data,
		seed
	) {

		if (!data || !data.script) return;

		try {
			scriptNoteMemory.put({
				noteId: data.noteId || (seed && seed.noteId) || null,
				topic: topic,
				sourceUrl: project && project.scriptSourceUrl ? project.scriptSourceUrl : "",
				minutes: minutes,
				speed: speed,
				keywordSet:
					seed && seed.keywordSet
						? seed.keywordSet
						: project && project.selectedSeoSet
							? project.selectedSeoSet
							: undefined,
				outline:
					Array.isArray(data.outline) && data.outline.length
						? data.outline
						: (seed && seed.outline) || [],
				script: data.script,
				durationMs: data.durationMs
			});
			/* RULE 35: the two client stores must agree after every write. */
			const audit = scriptNoteMemory.check({
				topic: topic,
				sourceUrl: project && project.scriptSourceUrl ? project.scriptSourceUrl : "",
				minutes: minutes,
				speed: speed
			});
			if (typeof window !== "undefined") window.__SCRIPT_NOTE_CONSISTENCY = audit;
			if (!audit.consistent && !audit.repaired) {
				console.warn("[script-notes] storage inconsistency after write", audit.reason);
			}
			if (project && data.noteId) project.scriptNoteId = data.noteId;
		} catch (noteError) {
			console.warn("[script-notes] browser note write failed", String(noteError && noteError.message || noteError).slice(0, 200));
		}
	}

	/*
	 * HANG GUARD (H3 + H4). One poll loop, shared by every layout.
	 *
	 * A note is the durable half of the pipeline, so the loop must be able to
	 * end for a reason that is NOT "the model finally answered":
	 *   - a terminal note (any state, not just done/error) ends it;
	 *   - three consecutive failed reads end it (a note that cannot be read is
	 *     not a note that is still working);
	 *   - no state change for the stall window ends it, where the server's own
	 *     waitMs promise extends the window while the run is honest;
	 *   - the wall-clock ceiling ends it.
	 */
	function scriptNoteResult(note) {
		return note.result && note.result.script
			? note.result
			: {
				success: true,
				script: note.script || "",
				durationMs: Number(note.durationMs) || 0,
				title: note.keywords && note.keywords.title ? note.keywords.title : "",
				headings: note.keywords && Array.isArray(note.keywords.headings) ? note.keywords.headings : [],
				model: note.model || ""
			};
	}

	async function requestScriptNoteOnce(
		context,
		noteUrl,
		pollAfterMs,
		limits
	) {

		const budget =
			limits || {};
		const maxWaitMs =
			Number(budget.maxWaitMs) > 0 ? Number(budget.maxWaitMs) : SCRIPT_NOTE_MAX_WAIT_MS;
		const stallMs =
			Number(budget.stallMs) > 0 ? Number(budget.stallMs) : SCRIPT_NOTE_STALL_MS;
		const defaultPollMs =
			Number(budget.pollMs) > 0 ? Number(budget.pollMs) : SCRIPT_NOTE_POLL_MS;
		const wait =
			Number(pollAfterMs) > 0
				? Math.min(5000, Number(pollAfterMs))
				: defaultPollMs;
		const startedAt =
			Date.now();
		let polls = 0;
		let failedPolls = 0;
		let lastSignature = "";
		let progressDeadline = startedAt + stallMs;

		while (Date.now() - startedAt < maxWaitMs) {

			if (context.isCancelled()) {
				const cancelled = new Error("Generation was cancelled");
				cancelled.name = "AbortError";
				throw cancelled;
			}

			/* The first read is immediate: a short job answers at once. */
			if (polls > 0) {
				await batchDelay(wait);
			}
			polls++;

			let note = null;
			let pollStatus = 0;
			try {
				const polled = await fetchWithTimeout(
					noteUrl,
					{ headers: { Accept: "application/json" } },
					SCRIPT_REQUEST_TIMEOUT_MS
				);
				pollStatus = Number(polled.status) || 0;
				note = await polled.json().catch(() => null);
			} catch (pollError) {
				/*
				 * A dropped poll is not a dropped job, but a note that cannot
				 * be read three times running is a note this tab cannot use.
				 */
				failedPolls++;
				console.warn("[script-notes] poll failed", {
					poll: polls,
					failedPolls: failedPolls,
					error: String(pollError && pollError.message || pollError).slice(0, 200)
				});
				if (failedPolls >= SCRIPT_NOTE_POLL_ATTEMPTS) {
					const unreadable = new Error(
						"The script note could not be read after " + failedPolls +
						" attempts - the job may still finish, so try again in a moment"
					);
					unreadable.retryable = true;
					unreadable.code = "SCRIPT_NOTE_UNREADABLE";
					throw unreadable;
				}
				continue;
			}
			/*
			 * A BUSY NOTE STORE IS A FAILED POLL, NOT A NOTE STATE.
			 *
			 * The worker answers 503 { code: "SCRIPT_NOTE_STORE_BUSY",
			 * terminal: false } when its KV binding did not answer inside its
			 * budget. That is a poll this tab could not read - the job is untouched -
			 * so it must be counted like a dropped connection (three in a row ends
			 * the flow with the RETRYABLE SCRIPT_NOTE_UNREADABLE), never treated as
			 * the note's state or as proof of life.
			 */
			if (pollStatus === 503 && note && note.terminal === false) {
				failedPolls++;
				console.warn("[script-notes] note store busy", {
					poll: polls,
					failedPolls: failedPolls,
					code: note.code || "",
					retryAfterMs: Number(note.retryAfterMs) || 0
				});
				if (failedPolls >= SCRIPT_NOTE_POLL_ATTEMPTS) {
					const unreadable = new Error(
						"The script note could not be read after " + failedPolls +
						" attempts - the job may still finish, so try again in a moment"
					);
					unreadable.retryable = true;
					unreadable.code = "SCRIPT_NOTE_UNREADABLE";
					throw unreadable;
				}
				continue;
			}
			if (!note || typeof note !== "object") {
				failedPolls++;
				if (failedPolls >= SCRIPT_NOTE_POLL_ATTEMPTS) {
					const unreadable = new Error(
						"The script note returned no state after " + failedPolls + " attempts - try again"
					);
					unreadable.retryable = true;
					unreadable.code = "SCRIPT_NOTE_UNREADABLE";
					throw unreadable;
				}
				continue;
			}
			failedPolls = 0;

			const state =
				String(note.state || "");
			/*
			 * H3: the worker's terminal flag is the contract, and "done" is
			 * the only success among terminal states. "empty" (and anything
			 * else terminal) used to fall through here and poll forever.
			 */
			/* The server's terminal flag is authoritative; keeping another list
			 * of terminal state names here let client and API drift apart. */
			const terminal = note.terminal === true;

			if (terminal && state === "done") {
				const result = scriptNoteResult(note);
				if (result.script) {
					return result;
				}
				const emptyScript = new Error("Script job finished without text");
				emptyScript.retryable = true;
				emptyScript.code = "SCRIPT_NOTE_NO_TEXT";
				throw emptyScript;
			}

			if (terminal) {
				const failure = new Error(
					note.error ||
					("The script job ended in state '" + (state || "unknown") + "'")
				);
				/*
				 * A note that reached a terminal error is a FAILED ATTEMPT, not a
				 * verdict about the whole click: this page decides whether to
				 * spend another one. The note's keyword plan is the resume point,
				 * so the retry does not pay for the planner again.
				 */
				failure.retryable = true;
				failure.state = state;
				failure.noteState = state;
				failure.code = note.errorCode || "";
				failure.stage = note.failureStage || "";
				failure.retryAfterMs = Number(note.retryAfterMs) > 0 ? Number(note.retryAfterMs) : 0;
				failure.keywordSet = note.keywords || null;
				throw failure;
			}

			/* Proof of life: a new state/updatedAt/outline extends the window. */
			const signature = [
				state,
				note.updatedAt || 0,
				note.runs || 0,
				Array.isArray(note.outline) ? note.outline.length : 0
			].join("|");

			if (signature !== lastSignature) {
				lastSignature = signature;
				/*
				 * The worker advertises TWO different numbers and only one of
				 * them belongs here: "stallMs" is the PROGRESS budget (one
				 * model attempt - the pipeline heartbeats the note before every
				 * call), while "waitMs" is the remaining share of the whole run
				 * budget. This guard used to read "waitMs", which is always the
				 * larger of the two, so the deadline kept extending itself and
				 * the "stopped advancing" check never fired: a note whose runner
				 * had died ran out the 185 s ceiling and reported SCRIPT_TIMEOUT
				 * instead of a stall.
				 */
				const advertised = Number(note.stallMs) > 0 ? Number(note.stallMs) : 0;
				progressDeadline =
					Date.now() + (advertised > 0 ? Math.max(stallMs, advertised) : stallMs);
			}

			if (Date.now() > progressDeadline) {
				const stalled = new Error(
					"The script note stopped advancing (" + (state || "unknown") +
					" for " + Math.round(stallMs / 1000) + "s) - try again"
				);
				stalled.retryable = true;
				stalled.code = "SCRIPT_NOTE_STALLED";
				throw stalled;
			}

			if (context.onStatus) {
				const beats = Array.isArray(note.outline) ? note.outline.length : 0;
				context.onStatus(
					"Writing your script from the saved note" +
					(beats > 0 ? " (" + beats + " planned sections)" : "") +
					", " + Math.round((Date.now() - startedAt) / 1000) + "s..."
				);
			}
		}

		const timeout = new Error("Script job timed out");
		timeout.retryable = true;
		timeout.code = "SCRIPT_TIMEOUT";
		throw timeout;
	}

	/*
	 * Legacy verdict formatter. Script-writing failures no longer use it in
	 * either UI: the browser's silent ladder is the source of truth and keeps
	 * the writing state on screen.
	 */
	function scriptFailureText(error) {
		const message = (error && error.message) || "Script generation failed";
		const attempts = Number(error && error.attempts) || 0;
		if (attempts <= 0) return message;
		return message + " (after " + attempts + (attempts === 1 ? " attempt)" : " attempts)");
	}

	/*
	 * The verdict text for audio the worker could not deliver. Same rule as
	 * \`scriptFailureText\`: the worker reports how many attempts ITS ladder
	 * spent, so the user still learns that this was tried, and tried hard.
	 */
	function voiceFailureText(data, status) {
		const message = (data && data.error) || ("Voiceover failed (HTTP " + status + ")");
		const attempts = Number(data && data.attempts) || 0;
		if (attempts <= 1) return message;
		return message + " (the worker tried " + attempts + " attempts)";
	}

	/*
	 * ONE REQUESTER FOR EVERY LAYOUT (H5).
	 *
	 * The editor accordion and the quick-batch table are different UIs, but a
	 * script request is the same five things: a topic, the note this browser
	 * already holds, the note/async negotiation, the 20 s-per-request budget,
	 * and the ability to be cancelled. context carries the layout-specific
	 * parts so neither layout can drift back to the 105 s legacy path:
	 *
	 *   context = {
	 *     project:       the video project (or null for a table row),
	 *     keywordSet:    optional preselected SEO set,
	 *     sourceUrl:     optional dynamic URL the note is keyed on,
	 *     isCancelled:   () => boolean,
	 *     setController / clearController: abort plumbing for this layout,
	 *     onStatus:      (text) => void  - where "Writing... 12s" is shown
	 *   }
	 */
	async function requestScriptWithNotes(
		context,
		options
	) {

		const project =
			(context && context.project) || null;
		const topic =
			String(options && options.topic || "my video");
		const minutes =
			Number(options && options.minutes) > 0 ? Number(options.minutes) : 1;
		const speed =
			String(options && options.speed || "medium");

		const caps =
			await studioOffload.capabilities();
		const single = Boolean(caps.singleAttemptScript && project && project.selectedSeoSet);
		const notesEnabled = Boolean(caps.scriptNotes);
		/*
		 * WHO OWNS SCRIPT RETRIES: THIS PAGE.
		 *
		 * requestScriptWritingWithClientRetries owns the seven silent retries.
		 * browserRetries tells the Worker to spend exactly one inference per
		 * stage for each request, so a browser retry is a real new script write
		 * rather than a second ladder nested inside the Worker's own ladder.
		 * The attempt number rotates the model and previousFailure coaches the
		 * next write; neither is ever printed in the UI.
		 */
		/* RULE 35: a Worker that keeps notes in the browser must NEVER be
		 * polled - there is no server-side note to poll. Old deployments that
		 * do not advertise the new field keep their legacy async path. */
		const clientSideNotes =
			String(caps.scriptNoteStorage || "") === "client" ||
			Number(caps.scriptNoteKvWrites) === 0 && Boolean(caps.scriptNoteConsistency);
		const asyncEnabled = !clientSideNotes && notesEnabled && Boolean(caps.asyncScript);
		/* 20 s per request only for the legacy async path; the client-side
		 * notes path holds one synchronous request for the full run budget. */
		const requestTimeout = asyncEnabled
			? SCRIPT_REQUEST_TIMEOUT_MS
			: clientSideNotes ? SCRIPT_NOTE_MAX_WAIT_MS : SCRIPT_LEGACY_TIMEOUT_MS;
		const noteSeed = notesEnabled ? browserScriptNote(project, topic, minutes, speed) : null;
		const scriptPath = asyncEnabled ? "/api/script?async=1" : "/api/script";
		if (clientSideNotes) {
			console.info("[script-notes] client-side storage (RULE 35)", {
				storage: "localStorage+cookie",
				kvWrites: 0,
				requestTimeoutMs: requestTimeout
			});
		}
		const isCancelled =
			context && context.isCancelled
				? context.isCancelled
				: function () { return Boolean(project && project._deleted); };
		const send = single ? function (url, init) {
			return studioOffload.scriptRequest(init, {
				path: url,
				timeout: requestTimeout,
				isCancelled: isCancelled,
				setController: context && context.setController,
				clearController: context && context.clearController
			});
		} : function (url, init) {
			return fetchWithTimeout(url, init, requestTimeout);
		};

		/*
		 * The keyword set the user picked in the walkthrough (or the one this
		 * project already holds). Every browser-owned attempt carries the same
		 * validated plan, so the Worker performs one writer inference per
		 * request and never runs a nested retry ladder.
		 */
		const keywordSet =
			context && context.keywordSet !== undefined && context.keywordSet !== null
				? context.keywordSet
				: project && project.selectedSeoSet
					? project.selectedSeoSet
					: null;
		const sourceUrl =
			context && context.sourceUrl !== undefined && context.sourceUrl !== null
				? context.sourceUrl
				: project && project.scriptSourceUrl
					? project.scriptSourceUrl
					: "";

		const clientRetry =
			Math.max(0, Math.floor(Number(options && options.clientRetry) || 0));

		const requestBody = {
			browserRetries: true,
			clientRetry: clientRetry,
			singleAttempt: Boolean(single),
			/*
			 * The browser ladder is the source of truth for attempt count.
			 * The Worker uses these fields to rotate its model and coach the
			 * next write; the UI never shows either field.
			 */
			attempt: clientRetry,
			previousFailure: String((options && options.previousFailure) || "").slice(0, 800),
			topic: topic,
			minutes: minutes,
			speed: speed,
			keywordSet:
				keywordSet
					? keywordSet
					: undefined,
			/*
			 * The note this browser already holds: its validated keyword set and
			 * its beat plan. Sending them is what removes the planner from the
			 * request (fix #1) - the first run is a single writer call.
			 */
			note:
				notesEnabled && noteSeed
					? {
						keywordSet: noteSeed.keywordSet || undefined,
						outline:
							Array.isArray(noteSeed.outline) && noteSeed.outline.length
								? noteSeed.outline
								: undefined,
						updatedAt: noteSeed.updatedAt || undefined
					}
					: undefined,
			/* Worker-derived note id: same topic + minutes + speed + URL. */
			useNotes: notesEnabled || undefined,
			sourceUrl: notesEnabled && sourceUrl ? sourceUrl : undefined
		};

		const response =
			await send(
				scriptPath,
				{
					method: "POST",
					headers: {
						"Content-Type":
							"application/json"
					},
					body:
						JSON.stringify(requestBody)
				}
			);

		if (response.status === 202) {
			const ticket =
				await response
					.json()
					.catch(
						() => ({})
					);
			if (!ticket || !ticket.noteUrl) {
				const queueError = new Error("The script job was not queued");
				queueError.retryable = true;
				throw queueError;
			}
			if (project && ticket.noteId) project.scriptNoteId = ticket.noteId;
			console.info("[script-notes] queued", {
				noteId: ticket.noteId,
				noteUrl: ticket.noteUrl,
				mode: ticket.mode || "loop"
			});
			const finished = await requestScriptNoteOnce(
				{
					isCancelled: isCancelled,
					onStatus: context && context.onStatus
				},
				ticket.noteUrl,
				ticket.pollAfterMs,
				{
					maxWaitMs: Number(caps.scriptNoteWaitMs) > 0 ? Number(caps.scriptNoteWaitMs) : SCRIPT_NOTE_MAX_WAIT_MS,
					stallMs: Number(caps.scriptNoteStallMs) > 0 ? Number(caps.scriptNoteStallMs) : SCRIPT_NOTE_STALL_MS,
					pollMs: Number(caps.scriptNotePollMs) > 0 ? Number(caps.scriptNotePollMs) : SCRIPT_NOTE_POLL_MS
				}
			);
			rememberBrowserScriptNote(project, topic, minutes, speed, finished, noteSeed);
			return finished;
		}

		const data =
			await response
				.json()
				.catch(
					() => ({})
				);

		rememberBrowserScriptNote(project, topic, minutes, speed, data, noteSeed);

		/*
		 * 'script' is plain narration text - the worker never sends
		 * subtitle formatting to the browser, so there is nothing to
		 * strip here.
		 */
		if (
			!response.ok ||
			!data.success ||
			!data.script
		) {

			const error = new Error((data && data.error) || ("HTTP " + response.status));
			error.status = response.status;
			error.kind = (data && data.kind) || "";
			error.retryAfterMs = data && Number(data.retryAfterMs) > 0 ? Number(data.retryAfterMs) : 0;
			/*
			 * The worker's own verdict wins over the status-code guess: it knows
			 * whether the failure came from the planner, the writer or the SRT
			 * validator, and whether another attempt can help at all.
			 */
			error.retryable = data && data.retryable === false
				? false
				: response.status === 408 || response.status === 429 || response.status >= 500 || response.ok;
			error.stage = (data && data.failure && data.failure.stage) || "";
			error.failureReason = (data && data.failure && data.failure.reason) || "";
			/*
			 * A verdict with no \`failure\` block (a validation 400, an older
			 * worker) is still ONE attempt: the page never re-asks, so the
			 * honest count is 1 rather than "unknown".
			 */
			error.attempts = (data && data.failure && Number(data.failure.attempts)) || 1;
			error.retryOwner =
				(data && data.retryOwner) ||
				(data && data.failure && data.failure.retryOwner) ||
				"";
			throw error;

		}

		return data;

	}

	/* The editor layout: the video project owns everything. */
	function scriptContextForProject(project) {
		const liveIndex = function () {
			return project ? videoProjects.indexOf(project) + 1 : 0;
		};
		const uiNodes = function () {
			const live = liveIndex();
			if (live <= 0) return [];
			return [
				document.getElementById("va-script-status-" + live),
				document.getElementById("va-script-box-" + live),
				seoWtEl(live, "seo-wt-script-status"),
				seoWtEl(live, "seo-wt-error")
			];
		};
		return {
			layout: "editor",
			project: project,
			isCancelled: function () {
				return Boolean(!project || project._deleted || liveIndex() <= 0);
			},
			setController: function (controller) {
				if (project) project._seoScriptController = controller;
			},
			clearController: function (controller) {
				if (project && project._seoScriptController === controller) project._seoScriptController = null;
			},
			setRetryWait: function (handle) {
				if (project) project._scriptRetryWait = handle;
			},
			clearRetryWait: function () {
				if (project) project._scriptRetryWait = null;
			},
			uiNodes: uiNodes,
			uiHasError: function () {
				const nodes = uiNodes();
				for (const node of nodes) {
					if (node && scriptWriteUiLooksLikeError(node.textContent)) return true;
				}
				const live = liveIndex();
				const box = live > 0 ? document.getElementById("va-script-box-" + live) : null;
				return Boolean(box && (box.style.display === "none" || !box.classList.contains("va-script-loading") || !box.querySelector(".va-spinner")));
			},
			keepWritingUi: function (force) {
				const live = liveIndex();
				if (live <= 0 || project._deleted) return;
				project._scriptKeepWritingUi = true;
				const box = document.getElementById("va-script-box-" + live);
				if (!box || box.style.display === "none" || !box.classList.contains("va-script-loading") || !box.querySelector(".va-spinner")) {
					setScriptLoading(live, true);
				}
				else {
					box.classList.add("va-script-loading");
					box.style.display = "";
				}
				const statusEl = document.getElementById("va-script-status-" + live);
				if (statusEl && (force || !statusEl.textContent || scriptWriteUiLooksLikeError(statusEl.textContent))) {
					statusEl.textContent = SCRIPT_WRITE_UI_TEXT;
				}
				const wtStatus = seoWtEl(live, "seo-wt-script-status");
				if (wtStatus && (force || scriptWriteUiLooksLikeError(wtStatus.textContent))) {
					wtStatus.textContent = SCRIPT_WRITE_UI_TEXT;
				}
				const wtError = seoWtEl(live, "seo-wt-error");
				if (wtError) wtError.textContent = "";
			},
			onStatus: function (text) {
				const live = liveIndex();
				if (live <= 0 || !text || scriptWriteUiLooksLikeError(text)) return;
				const statusEl = document.getElementById("va-script-status-" + live);
				if (statusEl) statusEl.textContent = text;
			}
		};
	}

	/*
	 * The table layout's half of the same pipeline (H5).
	 *
	 * A quick-batch row has no video project, so it builds its own context and
	 * calls the SAME requester: notes, the async ticket, the 20 s request
	 * budget, the 15 s stall guard and the wall-clock ceiling all apply here
	 * exactly as they do in the editor accordion. The first line of the row's
	 * script cell is the topic; the finished narration replaces it.
	 */
	function batchRowScriptContext(row) {
		const uiNodes = function () {
			const scope = document.querySelector('[data-batch-row="' + row.id + '"]');
			return scope ? [
				scope.querySelector('[data-batch-slot="status"]'),
				scope.querySelector('[data-batch-field="script"]')
			] : [];
		};
		return {
			layout: "row",
			project: null,
			row: row,
			keywordSet: null,
			sourceUrl: String(row.sourceUrl || ""),
			isCancelled: function () {
				return Boolean(row.stopRequested || !getBatchRow(row.id));
			},
			setController: function (controller) {
				row.controller = controller;
			},
			clearController: function (controller) {
				if (row.controller === controller) row.controller = null;
			},
			setRetryWait: function (handle) {
				row._scriptRetryWait = handle;
			},
			clearRetryWait: function () {
				row._scriptRetryWait = null;
			},
			uiNodes: uiNodes,
			uiHasError: function () {
				if (row.stage !== "writing" || row.error || scriptWriteUiLooksLikeError(row.detail)) return true;
				const nodes = uiNodes();
				const status = nodes[0];
				const textarea = nodes[1];
				if (!textarea) return true;
				if (!status || status.getAttribute("data-stage") !== "writing" || !status.querySelector(".va-spinner")) return true;
				return scriptWriteUiLooksLikeError(status.textContent);
			},
			keepWritingUi: function (force) {
				row.error = "";
				row.stage = "writing";
				if (force || !row.detail || scriptWriteUiLooksLikeError(row.detail)) row.detail = SCRIPT_WRITE_UI_TEXT;
				const nodes = uiNodes();
				const status = nodes[0];
				const textarea = nodes[1];
				if (!textarea) renderBatchTable();
				/*
				 * Do not rebuild a healthy spinner on every failed attempt:
				 * the same textarea and spinner stay on screen continuously.
				 */
				if (!status || status.getAttribute("data-stage") !== "writing" || !status.querySelector(".va-spinner") || scriptWriteUiLooksLikeError(status.textContent)) {
					paintBatchRowStatus(row);
				}
			},
			onStatus: function (text) {
				if (!text || scriptWriteUiLooksLikeError(text)) return;
				row.stage = "writing";
				row.error = "";
				row.detail = String(text);
				paintBatchRowStatus(row);
			}
		};
	}

	async function generateBatchRowScript(rowId) {

		const row = getBatchRow(rowId);
		if (!row || row._scriptWriting) return false;

		const typed = String(row.script || "").trim();
		if (!typed) {
			setBatchStage(row, "error", "Type a topic in the script cell first, then press the magic wand");
			refreshBatchRowCells();
			return false;
		}
		if (batchRowBusy(row)) {
			setBatchStage(row, "error", "This row is already generating");
			refreshBatchRowCells();
			return false;
		}

		const minutes = Math.min(6, Math.max(1, Number(row.minutes) || BATCH_MIN_MINUTES));
		const topic = batchRowTopic(row) || "my video";

			row._scriptWriting = true;
			setBatchStage(row, "writing", SCRIPT_WRITE_UI_TEXT);
			refreshBatchRowCells();

			try {
				/*
				 * The shared browser ladder owns every script-writing error.
				 * The row never paints a retry or a failure: its textarea and
				 * spinner remain in their normal writing state.
				 */
				if (row.stopRequested || !getBatchRow(rowId)) {
					const cancelled = new Error("Script generation was cancelled");
					cancelled.name = "AbortError";
					throw cancelled;
				}
				const data = await requestScriptWritingWithClientRetries(batchRowScriptContext(row), {
					topic: topic,
					minutes: minutes,
					speed: "medium"
				});
				const script = String((data && data.script) || "").trim();
				if (!script) throw new Error("The script came back empty");
				const live = getBatchRow(rowId);
				if (!live) return false;
				live.script = script;
				const cell = document.querySelector('[data-batch-row="' + rowId + '"] [data-batch-field="script"]');
				if (cell) cell.value = script;
				setBatchStage(live, "empty", "Script ready \u2014 review it, then press \u2726 Generate");
				refreshBatchRowCells();
				updateBatchToolbar();
				return true;
			} catch (error) {
				const live = getBatchRow(rowId);
				if (!live) return false;
				/* No verdict, no warning colour and no retry wording on the row. */
				batchRowScriptContext(live).keepWritingUi(true);
				return false;
		} finally {
			const live = getBatchRow(rowId);
			if (live) live._scriptWriting = false;
		}

	}

	async function requestSeoScriptOnce(
		n,
		topic,
		minutes,
		speed
	) {

		const project =
			videoProjects[n - 1];

		return requestScriptWritingWithClientRetries(
			scriptContextForProject(project),
			{
				topic: topic,
				minutes: minutes,
				speed: speed
			}
		);

	}

	/*
	 * Puts one finished script on the video: the text in the Script box,
	 * the SEO plan under it, the AI title in the (empty) title input, and
	 * fresh timings for burned-in subtitles if that video is using them.
	 */
	function applySeoScript(
		n,
		data,
		options
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		const minutes =
			(options && options.minutes) || 1;

		const speed =
			(options && options.speed) || "medium";

		const script =
			String(data.script || "").trim();

		project.script =
			script;

		/* The worker verified the spoken span; keep it for subtitle timing. */
		project.scriptDurationMs =
			Number(data.durationMs) > 0
				? Number(data.durationMs)
				: Math.round(minutes * 60 * 1000);

		if (
			project.subtitles &&
			project.subtitles.length
		) {
			project.subtitles =
				buildScriptCues(
					script,
					project.audio && project.audio.duration
						? project.audio.duration * 1000
						: project.scriptDurationMs
				);
		}

		/*
		 * Keep the verified SEO plan on
		 * the project, and offer the AI
		 * title when the video title
		 * input is still empty - the
		 * title is <=70 chars (the
		 * input maxlength) and carries
		 * one of the short keywords.
		 */
		project.seoTitle =
			(data && data.title) || "";

		project.seoHeadings =
			data && Array.isArray(data.headings)
				? data.headings
				: [];

		const titleEl =
			document.getElementById(
				"va-title-" + n
			);

		if (
			titleEl &&
			!titleEl.value.trim() &&
			project.seoTitle
		) {

			titleEl.value =
				project.seoTitle.slice(0, 70);

		}

		renderSeoKeywords(
			n,
			data
		);

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		if (box) {
			box.textContent = script;
		}

		/*
		 * The script now exists:
		 * reveal + enable the
		 * voiceover button (hidden
		 * until a script exists).
		 */
		syncVoiceoverButton(n);

		showScriptBox(n);

		const lineCount =
			script
				.split(/\\n+/)
				.filter(
					(line) =>
						line.trim() !== ""
				)
				.length;

		const wordCount =
			script
				.split(/\\s+/)
				.filter(Boolean)
				.length;

		/*
		 * The SEO counts are minimums
		 * (1 long-tail at least 1x,
		 * exactly 4 short keywords at
		 * least 2x each) - show what
		 * the worker verified, plus the
		 * title/headings the AI planned.
		 */
		const shortCount =
			data.keywords &&
			Array.isArray(data.keywords.short)
				? data.keywords.short.length
				: 0;

		const headingCount =
			Array.isArray(data.headings)
				? data.headings.length
				: 0;

		const statusEl =
			document.getElementById(
				"va-script-status-" + n
			);

		const readyLine =
			"Script ready \u2014 " +
			wordCount +
			" words in " +
			lineCount +
			" paragraph" +
			(lineCount === 1 ? "" : "s") +
			" (" +
			speed +
			" speech, " +
			minutes +
			" min) \u00b7 SEO: 1 long-tail (\u22651\u00d7) + " +
			shortCount +
			" short keywords (\u22652\u00d7 each) \u00b7 title + " +
			headingCount +
			" heading" +
			(headingCount === 1 ? "" : "s");

		if (statusEl) {
			statusEl.textContent =
				readyLine;
		}

		setSeoWalkthroughScriptStatus(
			n,
			readyLine
		);

		console.info("[script-seo] ok", {
			videoIndex: n,
			model: data.model || null,
			title: project.seoTitle,
			headings: project.seoHeadings,
			keywords: data.keywords || null,
			words: wordCount,
			paragraphs: lineCount
		});

	}

	async function runSeoScriptRequest(
		n,
		topic,
		minutes,
		speed
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return false;
		}

		const btn =
			document.getElementById(
				"va-script-btn-" + n
			);

		if (!btn) {
			return false;
		}

		const context =
			scriptContextForProject(project);

		let scriptSucceeded =
			false;

			project._scriptWriting = true;

		let lastError =
			null;

		btn.disabled = true;

		setScriptLoading(
			n,
			true
		);

		context.keepWritingUi(true);

		const scriptStartedAt = Date.now();

		console.info("[script-seo] request", {
			videoIndex: n,
			topic: topic,
			minutes: minutes,
			speed: speed,
			/* Seven silent browser retries, each preceded by 40 seconds. */
			maxRetries: SCRIPT_WRITE_MAX_RETRIES,
			maxRequests: SCRIPT_WRITE_TOTAL_ATTEMPTS,
			retryBackoffMs: SCRIPT_WRITE_RETRY_BACKOFF_MS,
			retryOwner: "browser"
		});

		try {

			try {
				if (project._deleted || videoProjects.indexOf(project) < 0) return false;

				const data =
					await requestSeoScriptOnce(
						videoProjects.indexOf(project) + 1,
						topic,
						minutes,
						speed
					);

				if (project._deleted) return false;
				const liveN = videoProjects.indexOf(project) + 1;
				if (liveN <= 0) return false;
				applySeoScript(
					liveN,
					data,
					{
						minutes: minutes,
						speed: speed
					}
				);

				scriptSucceeded =
					true;

				recordStudioUsage("scripts", "ok", 1);

			}
			catch (err) {

				lastError =
					err;

				/* Diagnostics stay in the console; the UI remains in writing mode. */
				console.info("[script-seo] client ladder finished without text", {
					videoIndex: n,
					ms: Date.now() - scriptStartedAt,
					clientAttempts: Number(err && err.clientAttempts) || SCRIPT_WRITE_TOTAL_ATTEMPTS
				});

				if (project._deleted) return false;

			}

			if (lastError) {

				/* No failure line, no retry line and no red walkthrough slot. */
				context.keepWritingUi(true);
				recordStudioUsage("scripts", "error", 1);

			}

		}
		finally {
			project._scriptWriting = false;

			const liveN = videoProjects.indexOf(project) + 1;
			if (!project._deleted && liveN > 0) {
				if (scriptSucceeded) {
					setScriptLoading(liveN, false);
				}
				else {
					/* Keep both the script textbox and its spinner continuously. */
					context.keepWritingUi(true);
				}
			}

			if (!project._deleted && liveN > 0 && !project._imageFlowActive) {
				const liveBtn = document.getElementById("va-script-btn-" + liveN);
				if (liveBtn) liveBtn.disabled = false;
			}

		}

		return scriptSucceeded;

	}

	// =========================================================
	// MODULE 9: voiceover + subtitles
	// (voice: MeloTTS via /api/voiceover -> MP3. The script is
	//  spoken EXACTLY as written: plain narration sentences, so
	//  there is no subtitle parsing anywhere in this module —
	//  a TTS model reads cue numbers and "-->" arrows out loud.
	//  Burned-in subtitles are built from the same sentences and
	//  drawn BELOW the caption, at 1/3 of the height up from the
	//  bottom.)
	// =========================================================

	/*
	 * One sentence per subtitle. The script arrives as plain text, so
	 * cues are made here: sentences are collected, split to caption
	 * width, and spread over the known span (the MP3 length once the
	 * voiceover exists, otherwise the length the worker verified).
	 * Timing is proportional to character count, so a long sentence
	 * stays on screen longer than "Yes." does.
	 */
	const SUBTITLE_MAX_CHARS =
		84;

	const SUBTITLE_MIN_MS =
		1200;

	function splitScriptSentences(script) {

		return String(script || "")
			.replace(/\\s+/g, " ")
			.split(/(?<=[.!?])\\s+/)
			.map((sentence) => sentence.trim())
			.filter(Boolean);

	}

	function wrapSubtitle(text, maxChars) {

		const words =
			String(text || "").split(/\\s+/).filter(Boolean);

		const lines = [];

		let line = "";

		for (const word of words) {

			if (!line) {
				line = word;
				continue;
			}

			if ((line + " " + word).length <= maxChars) {
				line += " " + word;
				continue;
			}

			lines.push(line);
			line = word;

		}

		if (line) {
			lines.push(line);
		}

		return lines.join("\\n");

	}

	/* Length of a generated voiceover blob, when the browser can decode it. */
	async function measureBlobMs(blob) {

		try {

			const context =
				getAudioContext();

			const bytes = await mediaDeadline(blob.arrayBuffer(), 30000, "Reading narration audio timed out.");
			const decoded =
				await mediaDeadline(context.decodeAudioData(bytes), 20000, "Narration duration decoding timed out.");

			return Math.round(
				decoded.duration * 1000
			);

		}
		catch (measureError) {

			console.warn(
				"[voiceover] could not measure the MP3",
				measureError
			);

			return 0;

		}

	}

	function buildScriptCues(
		script,
		totalMs
	) {

		const span =
			Number.isFinite(Number(totalMs)) && Number(totalMs) > 0
				? Number(totalMs)
				: 0;

		const sentences =
			splitScriptSentences(script)
				.map((sentence) => wrapSubtitle(sentence, SUBTITLE_MAX_CHARS))
				.filter(Boolean);

		if (!sentences.length || !span) {
			return [];
		}

		const weights =
			sentences.map((text) => Math.max(8, text.replace(/\\s+/g, " ").trim().length));

		const weightTotal =
			weights.reduce((sum, weight) => sum + weight, 0);

		/* Every cue keeps a readable floor; longer lines keep their share. */
		const minimum =
			SUBTITLE_MIN_MS * sentences.length;

		const scaled =
			span <= minimum
				? weights.map(() => span / sentences.length)
				: weights.map(
					(weight) =>
						SUBTITLE_MIN_MS +
						(span - minimum) * (weight / weightTotal)
				);

		const cues = [];

		let cursor = 0;

		for (let index = 0; index < sentences.length; index++) {

			const startMs =
				Math.round(cursor);

			cursor +=
				scaled[index];

			const endMs =
				index === sentences.length - 1
					? Math.max(startMs + SUBTITLE_MIN_MS, Math.round(span))
					: Math.round(cursor);

			cues.push({
				startMs: startMs,
				endMs: endMs,
				text: sentences[index]
			});

		}

		return cues;

	}

	/*
	 * One voiceover window per video, registered in the same stack as the
	 * walkthrough, so voicing Video 2 can never evict Video 1's window (and
	 * a walkthrough that still waits for a style choice stays put).
	 */
	function voiceoverModalId(n) {
		return "voiceover-modal-" + n;
	}

	function getVoiceoverModal(n) {
		return document.getElementById(voiceoverModalId(n));
	}

	function closeVoiceoverModal(n) {

		const modal =
			typeof n === "number"
				? getVoiceoverModal(n)
				: topModal();

		closeModal(
			modal
		);

	}

	function closeVoiceoverModalTop() {

		const modal =
			topModal();

		if (modal && !modalBlocksEscape(modal)) {
			closeModal(modal);
		}

	}

	function openVoiceoverModal(n) {

		const project =
			videoProjects[n - 1];

		if (!project) {

			return;

		}

		/*
		 * The accordion button only
		 * enables once the script box
		 * has text, so the modal always
		 * has a script to speak.
		 */

		if (!project.script) {

			return;

		}

		const existing =
			getVoiceoverModal(n);

		if (existing) {
			modalBringToFront(existing);
			existing.style.display = "flex";
			return existing;
		}

		const modal =
			document.createElement(
				"div"
			);

		modal.id =
			voiceoverModalId(n);

		modal.className =
			"modal-overlay";

		modal.setAttribute(
			"data-dismiss",
			"closeVoiceoverModalTop"
		);

		modal.innerHTML =
			'<div class="modal-box">' +
			'<div class="modal-title">\ud83c\udf99 Voiceover (MP3) \u2014 Video ' + n + '</div>' +
			'<div class="va-note" style="margin-bottom:8px">MeloTTS speaks the plain narration into an English MP3. The voiceover is downloaded and added to this video if no audio is selected. Existing audio is kept. Subtitles use estimated sentence timing and can be turned off.</div>' +
			'<label class="quality-select voiceover-voice-label">Voice <select id="voiceover-voice-' + n + '" disabled title="Always English">' +
			'<option value="en" selected>English (en)</option>' +
			'</select></label>' +
			'<div class="voiceover-label">Script (spoken into the MP3)</div>' +
			'<textarea id="voiceover-text-' + n + '" class="voiceover-textarea" rows="8" readonly disabled></textarea>' +
			'<div class="voiceover-actions">' +
			'<button type="button" class="upload-btn small" id="voiceover-gen-' + n + '" onclick="generateVoiceover(' + n + ')">\ud83c\udfa7 Generate Voiceover (MP3)</button>' +
			'<button type="button" class="upload-btn small" id="voiceover-subtitles-' + n + '" onclick="toggleSubtitles(' + n + ')">' +
			(project.subtitles && project.subtitles.length
				? "\u2705 Subtitles ON \u2014 click to turn off"
				: "\ud83d\udcdd Apply Subtitles to Video") +
			'</button>' +
			'</div>' +
			'<span class="va-note" id="voiceover-status-' + n + '"></span>' +
			'<button type="button" class="upload-btn small" onclick="closeVoiceoverModal(' + n + ')">\u2715 Close</button>' +
			'</div>';

		openModal(
			modal
		);

		const area =
			modal.querySelector(
				"#voiceover-text-" + n
			);

		if (area) {

			/*
			 * The script IS the spoken text: it is handed to the
			 * voice as-is, with nothing parsed out of it.
			 */
			area.value =
				project.script;

		}

		return modal;

	}

	/*
	 * SESSION 279: the editor asks the same one question the table row asks.
	 *
	 * It used to branch on \`chunkVoiceover\`: either split the script, fetch
	 * every chunk, retry the whole set three times and assemble the container in
	 * a Web Worker - or, on the legacy branch, a bare \`fetch\` with NO timeout
	 * and no cancellation. Both are gone. One request through the offload
	 * scheduler keeps the timeout (165 s), the abort plumbing and the queue slot,
	 * and the worker's in-request ladder does the rest. Quick Batch table rows add the final client-side pipeline ladder.
	 */
	async function requestEditorVoiceover(project, text, lang) {
		return studioOffload.mediaResponse(
			"/api/voiceover",
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text, lang: lang }) },
			{
				isCancelled: function () { return Boolean(project._deleted); },
				setController: function (controller) { project._voiceoverController = controller; },
				clearController: function (controller) { if (project._voiceoverController === controller) project._voiceoverController = null; }
			}
		);
	}

	async function generateVoiceover(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {

			return;

		}

		const genBtn =
			document.getElementById(
				"voiceover-gen-" + n
			);

		const statusEl =
			document.getElementById(
				"voiceover-status-" + n
			);

		const voiceSel =
			document.getElementById(
				"voiceover-voice-" + n
			);

		if (!genBtn) {
			return;
		}

		genBtn.disabled = true;

		if (statusEl) {
			statusEl.textContent =
				"Preparing...";
		}

		try {

			/*
			 * What the voice gets is the script box contents verbatim:
			 * the AI script is plain narration text, so there is no
			 * subtitle format to strip and nothing to misread.
			 */
			const text =
				String(project.script || "").trim();

			if (!text) {

				throw new Error(
					"No script text to speak"
				);

			}

			if (statusEl) {
				statusEl.textContent =
					"Speaking your script (MeloTTS)...";
			}

			const response = await requestEditorVoiceover(project, text, voiceSel ? voiceSel.value : "en");
			if (project._deleted) return;

			if (
				!response.ok
			) {

				const data =
					await response
						.json()
						.catch(
							() => ({})
						);

				throw new Error(voiceFailureText(data, response.status));

			}

			const blob =
				await response.blob();
			if (!blob || !blob.size) throw new Error("The voiceover model returned no audio");
			if (project._deleted || videoProjects.indexOf(project) < 0) return;

			recordStudioUsage("voiceovers", "ok", 1);

			const titleEl =
				document.getElementById(
					"va-title-" + n
				);

			const title =
				titleEl
					? titleEl.value.trim()
					: "";

			const isWav =
				String(
					blob.type
				) ===
				"audio/wav";

			const fileName =
				"YouTubeVibeStudio_" +
				(title ||
					"Video" + n).replace(
						/[^A-Za-z0-9]+/g,
						""
					) +
				"_voiceover." +
				(isWav
					? "wav"
					: "mp3");

			const url =
				createStudioObjectUrl(
					blob
				);

			const a =
				document.createElement(
					"a"
				);

			a.href = url;
			a.download = fileName;

			document.body.appendChild(
				a
			);

			a.click();

			document.body.removeChild(
				a
			);

			setTimeout(
				function () {
					releaseStudioObjectUrl(url);
				},
				2000
			);

			project.voiceoverFile = blob;

			// Like quick batch, time the plain narration against its audio.
			// Never overwrite an audio file the user has already selected.
			const measuredMs = await measureBlobMs(blob);
			if (project._deleted || videoProjects.indexOf(project) < 0) return;
			const sameScript = String(project.script || "").trim() === text;
			let attached = false;
			if (sameScript && !project.audioFile) {
				project.audioFile = new File([blob], fileName, { type: blob.type || "audio/mpeg" });
				project.audio = null;
				project._voiceoverDurationMs = measuredMs || 0;
				attached = true;
				const liveN = videoProjects.indexOf(project) + 1;
				const audioLine = document.getElementById("va-audio-line-" + liveN);
				if (audioLine) audioLine.textContent = "\ud83c\udfb5 " + fileName;
				updateVideoStatus(liveN);
			}
			if (sameScript && !project._subtitlesDisabled) {
				const spanMs = project.audio && project.audio.duration
					? project.audio.duration * 1000
					: attached ? measuredMs || project.scriptDurationMs : project.scriptDurationMs;
				const cues = buildScriptCues(text, spanMs);
				if (cues.length) project.subtitles = cues;
			}
			const subBtn = document.getElementById("voiceover-subtitles-" + n);
			if (subBtn && project.subtitles && project.subtitles.length) {
				subBtn.textContent = "\u2705 Subtitles ON \u2014 click to turn off";
			}

			if (statusEl) {
				statusEl.textContent = sameScript
					? (attached ? "Voiceover saved and added to this video" : "Voiceover saved; existing audio was kept") +
						(project.subtitles && project.subtitles.length ? " (subtitles enabled)" : "")
					: "Voiceover saved; the script changed, so the video was not updated";
			}

		}
		catch (err) {

			if (statusEl) {
				statusEl.textContent =
					"Voiceover failed: " +
					(err.message || err);
			}

		}
		finally {

			genBtn.disabled = false;

		}

	}

	/*
	 * Toggle the narration script as
	 * burned-in subtitles for this
	 * video: one sentence per cue,
	 * drawn below the caption, at 1/3
	 * of the height up from the bottom,
	 * for every export. Click again to
	 * turn them off. The modal stays
	 * open. Nothing here parses a
	 * subtitle file - the cues are made
	 * from the plain script and spread
	 * over the real audio length.
	 */
	function toggleSubtitles(n) {

		const project =
			videoProjects[n - 1];

		if (
			!project ||
			!project.script
		) {

			return;

		}

		const statusEl =
			document.getElementById(
				"voiceover-status-" + n
			);

		const subBtn =
			document.getElementById(
				"voiceover-subtitles-" + n
			);

		const scriptStatus =
			document.getElementById(
				"va-script-status-" + n
			);

		if (
			project.subtitles &&
			project.subtitles.length
		) {

			/*
			 * Subtitles are ON ->
			 * turn them off.
			 */

			project.subtitles =
				null;
			project._subtitlesDisabled = true;

			if (statusEl) {

				statusEl.textContent =
					"Subtitles turned off";

			}

			if (scriptStatus) {

				scriptStatus.textContent =
					"Subtitles off";

			}

			if (subBtn) {

				subBtn.textContent =
					"\ud83d\udcdd Apply Subtitles to Video";

			}

			return;

		}

		const cues =
			buildScriptCues(
				project.script,
				project.audio && project.audio.duration
					? project.audio.duration * 1000
					: project._voiceoverDurationMs || project.scriptDurationMs
			);

		if (!cues.length) {

			if (statusEl) {

				statusEl.textContent =
					"No sentences found in the script";

			}

			return;

		}

		project.subtitles =
			cues;
		project._subtitlesDisabled = false;

		if (statusEl) {

			statusEl.textContent =
				"Subtitles applied (" +
				cues.length +
				" cues) \u2014 shown below the caption";

		}

		if (scriptStatus) {

			scriptStatus.textContent =
				"Subtitles applied to this video";

		}

		if (subBtn) {

			subBtn.textContent =
				"\u2705 Subtitles ON \u2014 click to turn off";

		}

	}


	function readTransitionProjectPayload() {
		let params = null;
		try { params = new URLSearchParams(window.location.search || ""); } catch (error) { return null; }
		const key = params.get("projectEdit");
		if (!key) return null;
		const cookieName = "ytvs_transition_project_" + key.replace(/[^a-zA-Z0-9_-]/g, "_");
		let mirror = null;
		try {
			for (const part of String(window.document.cookie || "").split(";")) {
				const entry = part.trim();
				const equal = entry.indexOf("=");
				if (equal < 0 || entry.slice(0, equal) !== cookieName) continue;
				mirror = JSON.parse(decodeURIComponent(entry.slice(equal + 1)));
				break;
			}
		} catch (cookieError) { }
		let payload = null;
		try {
			payload = JSON.parse(window.localStorage.getItem(MEDIA_TRANSITION_STORAGE_PREFIX + key) || "null");
		} catch (storageError) { }
		/* No TTL: the localStorage payload and cookie mirror must share createdAt. */
		const matched = Boolean(payload && mirror && mirror.v === 1 && mirror.key === key &&
			Number(mirror.createdAt) === Number(payload.createdAt));
		try { window.localStorage.removeItem(MEDIA_TRANSITION_STORAGE_PREFIX + key); } catch (removeError) { }
		try {
			window.document.cookie = cookieName + "=; Max-Age=0; Path=/; SameSite=Lax";
		} catch (removeCookieError) { }
		return matched && payload.transitionOnly === true ? payload : null;
	}

	function applyTransitionProject() {
		const timelineMode = timelineEditorRouteRequested();
		if (timelineMode) activateTimelineEditorLayout();
		const payload = readTransitionProjectPayload();
		if (!payload) return null;
		window.__TRANSITION_PROJECT__ = payload;
		window.__BATCH_EDIT_PROJECT__ = payload;
		if (timelineMode) {
			window.__TIMELINE_PROJECT__ = payload;
			return payload;
		}
		try { setStudioLayout("editor"); } catch (layoutError) { }
		if (!videoProjects.length && typeof addVideoAccordion === "function") addVideoAccordion();
		const project = videoProjects[0];
		if (project) {
			const settings = payload.basicSettings || {};
			project.script = String(settings.script || "");
			project.name = String(settings.title || project.name || "");
			project.videoImageStyle = settings.style || project.videoImageStyle || DEFAULT_SEO_IMAGE_STYLE;
			project._seoTopic = String(settings.topic || settings.title || "my video");
			project._seoMinutes = Number(settings.minutes) > 0 ? Number(settings.minutes) : 1;
			project.resolution = settings.resolution || project.resolution || "";
			project.orientation = settings.orientation || project.orientation || "";
			project.mediaFilenames = [];
			project._pipelineVid = settings.vid || payload.targetPageId + "-editor-1";
			const n = videoProjects.indexOf(project) + 1;
			const setField = function (id, value) {
				const el = document.getElementById(id + n);
				if (el && "value" in el) el.value = String(value || "");
			};
			setField("va-title-", settings.title || project.name || "");
			setField("va-script-topic-", settings.topic || settings.title || "");
			setField("va-script-minutes-", project._seoMinutes);
			setField("va-quality-", settings.quality || "balanced");
			try { setScriptLoading(n, false); } catch (loadingError) { }
			try { setScriptBoxState(n, true); } catch (boxError) { }
			try { syncVoiceoverButton(n); } catch (voiceError) { }
			try { setVaUploadEnabled(n, true); } catch (uploadError) { }
			const status = document.getElementById("va-script-status-" + n);
			if (status) status.textContent = "Project settings loaded from Quick Batch.";
			if (!timelineMode) persistPipelineManagementState("transition-project-applied");
		}
		return payload;
	}

	const timelinePage = timelineEditorRouteRequested();
	if (timelinePage) {
		/* The timeline is a standalone client layout: do not bind or restore the pipeline/video-studio shell. */
		applyTransitionProject();
	} else {
		pipelineManagementRestoring = true;
		try {
			initVideoStudio();
			bindStudioShell();
		} finally {
			pipelineManagementRestoring = false;
		}
		restorePipelineManagementState();
		/*
		 * Session 333: the URL's own layout request is applied AFTER the restore,
		 * so it wins over the stored layout exactly once — on the navigation that
		 * carried it. Afterwards the [data-layout] switch and the stored layout
		 * rule again, so a later storage-event restore never yanks the user back
		 * to a layout they have already clicked away from.
		 */
		const requestedLayout = requestedStudioLayout();
		if (requestedLayout) {
			try { setStudioLayout(requestedLayout); } catch (layoutError) { }
		}
		/*
		 * Session 331: rows that finished a render or export in the last 24 h
		 * are put back on the page (five per page); anything older is deleted
		 * by this browser, not by the server.
		 */
		try {
			purgeCompletedBatchRows();
			restoreCompletedBatchRows();
			scheduleCompletedBatchPurge();
		} catch (completedError) { }
		applyTransitionProject();
		/*
		 * Session 332: the editor layout opens with one OPEN accordion already
		 * on the page (Video 1), so nobody has to press ＋ Add Video first — and
		 * that button stays in its normal, unpressed state.
		 */
		ensureEditorAccordionOnLoad();
		bindLandingActions();
		initAuth();
		persistPipelineManagementState("startup");
		window.addEventListener("storage", function (event) {
			if (!event) return;
			const key = String(event.key || "");
			const isPipelineKey = key === pipelineManagementStore.localStorageKey;
			const isTimelineProjectKey = key.indexOf(BATCH_TIMELINE_STATE_PREFIX) === 0;
			if (key && !isPipelineKey && !isTimelineProjectKey) return;
			/*
			 * Reconcile directly from the pipeline + timeline project stores so
			 * newly published timeline edits are not masked by restorePipelineManagementState()
			 * pre-stamping timelineUpdatedAt on live rows.
			 */
			try { reconcileTimelineEdits(); } catch (reconcileError) { }
		});
		/* A tab that regains focus or visibility also checks, in case the storage event was missed. */
		window.addEventListener("focus", function () {
			try { reconcileTimelineEdits(); } catch (focusError) { }
		});
		if (typeof document !== "undefined" && document.addEventListener) {
			document.addEventListener("visibilitychange", function () {
				if (document.visibilityState === "visible") {
					try { reconcileTimelineEdits(); } catch (visError) { }
				}
			});
		}
		window.addEventListener("beforeunload", function () { persistPipelineManagementState("beforeunload"); });
	}

	async function generateMP4() {

		if (
			activeSlides.length === 0
		) {

			alert(
				"Please wait for images to generate or upload your own!"
			);

			return "skipped";

		}


		if (
			typeof VideoEncoder ===
			"undefined"
		) {

			alert(
				"Your browser does not support WebCodecs. Please use modern Chrome, Edge, or Safari."
			);

			return "error";

		}

		if (typeof Mp4Muxer === "undefined") {
			alert("The MP4 export library is still loading or unavailable. Check your connection and try again.");
			return "error";
		}

		// =====================================================
		// CHOOSE WHERE THE MP4 IS WRITTEN
		// =====================================================

		/*
		 * This is the fix for the crash.
		 *
		 * Building the whole MP4 in memory
		 * and then copying it again into a
		 * Blob is what killed the tab on
		 * long videos.
		 *
		 * Chrome and Edge can stream the
		 * file straight to disk instead, so
		 * memory stays flat no matter how
		 * long the video is.
		 *
		 * The save dialog is opened first,
		 * while the click still counts as a
		 * user gesture.
		 */

		const fileName =
			renderContext &&
				renderContext.fileName
				? renderContext.fileName
				: "YouTubeVibeStudio_" +
					Date.now() +
					".mp4";



		let fileStream =
			null;

		window.__lastRenderBlob =
			null;

		if (
			typeof window.showSaveFilePicker ===
			"function" &&
			!window.__workerMode
		) {

			try {

				const handle =
					await window.showSaveFilePicker(
						{

							suggestedName:
								fileName,

							types: [
								{
									description:
										"MP4 video",

									accept: {
										"video/mp4": [
											".mp4"
										]
									}
								}
							]

						}
					);


				fileStream =
					await handle.createWritable();

			}
			catch (error) {

				/*
				 * The user closed the dialog.
				 */

				if (
					error &&
					error.name ===
						"AbortError"
				) {

					return "skipped";

				}


				/*
				 * Anything else falls back to
				 * building the file in memory.
				 */

				console.warn(
					"Save-to-disk unavailable:",
					error
				);


				fileStream =
					null;

			}

		}


		/*
		 * True when the file is streamed to
		 * disk instead of held in RAM.
		 */

		const streamingToFile =
			fileStream !== null;


		const renderBtn =
			document.getElementById(
				"render-btn"
			);


		const progressContainer =
			document.getElementById(
				"progress-container"
			);


		const progressBar =
			document.getElementById(
				"progress-bar"
			);


		const statusText =
			document.getElementById(
				"status-text"
			);


		const placeholder =
			document.getElementById(
				"canvas-placeholder"
			);


		const canvas =
			document.getElementById(
				"video-canvas"
			);


		const ctx =
			canvas.getContext(
				"2d",
				{
					alpha: false
				}
			);


		/*
		 * Scratch canvas used to blit the current
		 * frame of a GIF slide before it is drawn
		 * into the video.
		 */

		const gifCanvas =
			document.createElement(
				"canvas"
			);


		const gifCtx =
			gifCanvas.getContext(
				"2d"
			);


		/*
		 * Captions are parsed once here so the
		 * per-frame loop stays cheap.
		 */

		const captions =
			getCaptions();

		/*
		 * Subtitles (the applied plain
		 * script) come from the render
		 * context, if any.
		 */

		const subtitles =
			renderContext &&
			renderContext.subtitles
				? renderContext.subtitles
				: [];



		renderBtn.disabled =
			true;


		placeholder.style.display =
			"none";


		progressContainer.style.display =
			"block";


		statusText.style.display =
			"block";


		progressBar.style.width =
			"0%";


		// =====================================================
		// VIDEO SETTINGS
		// =====================================================

		const quality =
			getQuality();


		const WIDTH =
			renderContext && renderContext.frameWidth
				? renderContext.frameWidth
				: quality.width;


		const HEIGHT =
			renderContext && renderContext.frameHeight
				? renderContext.frameHeight
				: quality.height;


		const FPS =
			30;


		/*
		 * The canvas must match the encoder
		 * size or VideoFrame and
		 * VideoEncoder will disagree.
		 */

		canvas.width =
			WIDTH;


		canvas.height =
			HEIGHT;


		/*
		 * The title font has to be ready
		 * before the first frame is drawn.
		 */

		await loadTitleFont();


		await loadCaptionFont();


		/*
		 * Every image lasts 9 seconds.
		 *
		 * When the track is longer than the
		 * selected slides, the slide list is
		 * repeated from the start until the
		 * whole track is covered.
		 */

		const slides =
			getSlideSequence();


		const SECONDS_PER_SLIDE =
			getSecondsPerSlide();


		const TOTAL_FRAMES =
			slides.reduce(
				(sum, slide) =>
					sum +
					framesForSlide(
						slide,
						FPS
					),
				0
			);


		/*
		 * Keyframes are deliberately
		 * more than 7 seconds apart.
		 *
		 * This does NOT create visual
		 * transitions.
		 */

		const KEYFRAME_INTERVAL =
			FPS *
			10;


		/*
		 * Exact length of the finished
		 * video, used to size the audio.
		 */

		const VIDEO_SECONDS =
			TOTAL_FRAMES /
			FPS;


		// =====================================================
		// MEMORY SAFETY NET
		// =====================================================

		/*
		 * Only needed when the browser has
		 * to build the file in memory.
		 *
		 * Streaming to disk has no such
		 * limit, so this is skipped there.
		 */

		if (!streamingToFile) {

			const audioBitrate =
				currentAudio
					? quality.audioBitrate
					: 0;


			const estimatedBytes =
				(VIDEO_SECONDS *
					(
						quality.videoBitrate +
						audioBitrate
					)) /
				8;


			if (
				estimatedBytes >
				250 *
					1024 *
					1024
			) {

				const proceed =
					confirm(
						"This video will be about " +
							formatBytes(
								estimatedBytes
							) +
							" and has to be built in memory, because this browser cannot save straight to disk.\\n\\nThat may crash the tab. Continue anyway?"
					);


				if (!proceed) {

					renderBtn.disabled =
						false;

					progressContainer.style.display =
						"none";

					statusText.style.display =
						"none";

					return "skipped";

				}

			}

		}


		// =====================================================
		// ENCODE THE AUDIO TRACK FIRST
		// =====================================================

		/*
		 * The audio is encoded before the
		 * muxer is created so that the
		 * muxer only declares an audio
		 * track when there is real AAC
		 * data to write.
		 */

		let audioChunks =
			[];


		let audioTrack =
			null;


		if (currentAudio) {

			if (
				typeof AudioEncoder ===
				"undefined"
			) {

				alert(
					"Your browser cannot encode audio (WebCodecs AudioEncoder missing). Rendering a silent video."
				);

			}
			else {

				try {

					statusText.textContent =
						"Encoding audio track...";


					const encoded =
						await encodeAudioTrack(
							currentAudio.buffer,
							VIDEO_SECONDS,
							quality.audioBitrate,
							(fraction) => {

								/*
								 * Audio owns the first
								 * 25% of the bar.
								 */

								progressBar.style.width =
									Math.round(
										fraction *
											25
									) +
									"%";

							}
						);


					audioChunks =
						encoded.chunks;


					audioTrack = {

						codec:
							"aac",

						sampleRate:
							encoded.sampleRate,

						numberOfChannels:
							encoded.numberOfChannels

					};

				}
				catch (error) {

					console.error(
						"Audio encoding failed:",
						error
					);


					alert(
						"Audio could not be encoded. Rendering a silent video."
					);


					audioChunks =
						[];


					audioTrack =
						null;

				}

			}

		}


		// =====================================================
		// MP4 MUXER
		// =====================================================

		/*
		 * fastStart is false on purpose.
		 *
		 * "in-memory" makes the muxer hold
		 * every media chunk until finalize,
		 * which is what pushed the tab over
		 * the memory limit. Writing the
		 * metadata at the end uses the least
		 * memory and the file still plays
		 * normally once downloaded.
		 */

		const muxerConfig = {

			target:
				streamingToFile
					? new Mp4Muxer.FileSystemWritableFileStreamTarget(
							fileStream,
							{
								chunkSize:
									8 *
										1024 *
										1024
							}
						)
					: new Mp4Muxer.ArrayBufferTarget(),

			video: {

				codec:
					"avc",

				width:
					WIDTH,

				height:
					HEIGHT

			},

			fastStart:
				false

		};


		/*
		 * Only add the audio track when
		 * AAC chunks exist.
		 */

		if (audioTrack) {

			muxerConfig.audio =
				audioTrack;

		}


		const muxer =
			new Mp4Muxer.Muxer(
				muxerConfig
			);


		// =====================================================
		// AUDIO / VIDEO INTERLEAVING
		// =====================================================

		/*
		 * Audio chunks are written together
		 * with the video frames that share
		 * their timestamp, which keeps the
		 * MP4 properly interleaved.
		 */

		let audioIndex =
			0;


		function flushAudioUpTo(
			timestampMicroseconds
		) {

			while (
				audioIndex <
					audioChunks.length &&
				audioChunks[audioIndex]
					.timestamp <=
					timestampMicroseconds
			) {

				const item =
					audioChunks[
						audioIndex
					];


				muxer.addAudioChunk(
					item.chunk,
					item.meta
				);


				audioIndex++;

			}

		}


		// =====================================================
		// VIDEO ENCODER
		// =====================================================

		let encoderError =
			null;


		const videoEncoder =
			new VideoEncoder({

				output:
					(chunk, meta) => {

						muxer.addVideoChunk(
							chunk,
							meta
						);

					},


				error:
					(error) => {

						console.error(
							"VideoEncoder error:",
							error
						);


						encoderError =
							error;

					}

			});


		videoEncoder.configure({

			codec:
				"avc1.4d002a",

			width:
				WIDTH,

			height:
				HEIGHT,

			bitrate:
				quality.videoBitrate,

			framerate:
				FPS

		});


		// =====================================================
		// ENCODER BACKPRESSURE
		// =====================================================

		/*
		 * Prevents crashes when rendering
		 * many images.
		 */

		const MAX_ENCODE_QUEUE =
			12;


		/*
		 * A dead encoder (or a browser that silently stops draining
		 * the queue) used to make this loop spin forever: the
		 * progress bar froze at the same percentage and the export
		 * never returned. It now fails fast with a clear message, so
		 * the queue can mark the video "error" and move on to the
		 * next one.
		 */

		const ENCODER_STALL_TIMEOUT_MS =
			15000;


		const ENCODER_FLUSH_TIMEOUT_MS =
			180000;


		async function waitForEncoder() {

			const startedAt =
				Date.now();


			while (
				videoEncoder.encodeQueueSize >
				MAX_ENCODE_QUEUE
			) {

				if (encoderError) {

					throw encoderError;

				}


				if (
					videoEncoder.state ===
						"closed"
				) {

					throw new Error(
						"The video encoder closed before the export finished."
					);

				}


				if (
					Date.now() -
						startedAt >
					ENCODER_STALL_TIMEOUT_MS
				) {

					throw new Error(
						"The video encoder stopped accepting frames. Try a lower quality or fewer MP4 clips."
					);

				}


				await new Promise(
					resolve =>
						setTimeout(
							resolve,
							8
						)
				);

			}


			if (encoderError) {

				throw encoderError;

			}

		}


		// =====================================================
		// ANIMATION TYPES
		// =====================================================

		const effects = [

			"slide-left",

			"slide-right",

			"slide-down",

			"zoom-in"

		];


		/*
		 * Pause every clip preview; the
		 * active clip is played while
		 * its frames are captured.
		 */


		for (
			const pauseSlide of slides
		) {


			if (
				pauseSlide.type ===
					"mp4" &&
				pauseSlide.videoEl
			) {


				pauseSlide.videoEl.pause();


			}


		}


		/*
		 * Clip capture needs a composited element.
		 *
		 * The editor's clips (\`asset.videoEl\`) are built with
		 * createElement() while the file is probed and are never
		 * attached to the document, so the browser has no reason to
		 * present their frames: requestVideoFrameCallback never
		 * fires and the export used to wait forever on the very
		 * first clip frame. Moving each such clip into the
		 * invisible off-viewport host for the duration of the
		 * export brings the playback path back; clips that are
		 * already visible in a preview are left alone, and every
		 * move is undone in the finally block below.
		 */

		const clipRestores =
			[];


		for (
			const captureSlide of slides
		) {

			if (
				captureSlide &&
				captureSlide.type ===
					"mp4" &&
				captureSlide.videoEl
			) {

				const restore =
					mountClipForCapture(
						captureSlide.videoEl
					);


				if (restore) {

					clipRestores.push(
						restore
					);

				}

			}

		}



		let currentFrame =
			0;


		try {

			// =================================================
			// PROCESS EACH IMAGE
			// =================================================

			for (
				let i = 0;
				i < slides.length;
				i++
			) {

				const slide =
					slides[i];


				/*
				 * GIF slides are drawn from their decoded
				 * animation frames. The scratch canvas holds
				 * the current frame; it is refreshed for
				 * every video frame of the slide, below.
				 */

				let img =
					slide.img;


				const gif =
					slide.type ===
						"gif"
						? slide.gif
						: null;


				if (gif) {

					/*
					 * Size the scratch canvas once per
					 * slide.
					 */

					if (
						gifCanvas.width !==
							gif.width ||
						gifCanvas.height !==
							gif.height
					) {

						gifCanvas.width =
							gif.width;


						gifCanvas.height =
							gif.height;

					}

				}


				const frames =
					framesForSlide(
						slide,
						FPS
					);


				let clipVideo =
					slide.type ===
						"mp4"
					? slide.videoEl
					: null;


				/*
				 * Two capture modes for this clip. Playback is the
				 * fast path; once the browser stops presenting
				 * frames (detached element, hidden tab, rejected
				 * play()) the slide finishes in seek mode instead
				 * of waiting forever.
				 */

				let clipSeekMode =
					false;


				const clipSeconds =
					slideDurationSec(
						slide
					);


				const clipTrimSec =
					renderContext && renderContext.timelineEdited
						? Math.max(0, Number(slide.trimStartSec) || 0)
						: 0;


				if (clipVideo) {


					if (clipTrimSec > 0) {
						try { clipVideo.currentTime = clipTrimSec; } catch (trimErr) { }
					}


					const clipDrawable =
						await prepareClip(
							clipVideo
						);


					clipSeekMode =
						Boolean(
							clipVideo.paused
						);


					if (!clipDrawable) {

						console.warn(
							"[render] A clip has no decodable frame yet; its frames are captured by seeking."
						);

					}

				}


				const effect =
					effects[
						i %
						effects.length
					];


				// =============================================
				// ANIMATED DURATION PER IMAGE
				// =============================================

				for (
					let f = 0;
					f < frames;
					f++
				) {


					/*
					 * Keep the clip in real time while the browser
					 * really presents frames; otherwise park it on
					 * the exact time of this output frame.
					 *
					 * Both paths are bounded, so a clip can never
					 * stall the export again (bug fix: the old
					 * unbounded await on requestVideoFrameCallback
					 * is what left the studio "rendering" forever).
					 */


					if (
						clipVideo &&
						f >
							0
					) {


						if (clipSeekMode) {


							await captureClipFrameAt(
								clipVideo,
								clipTrimSec + (f / FPS),
								clipSeconds + clipTrimSec
							);


						}

						else {


							const presented =
								await nextClipFrame(
									clipVideo,
									CLIP_FRAME_TIMEOUT_MS
								);


							if (!presented) {

								/*
								 * Hidden element / background tab:
								 * stop relying on the compositor for
								 * the rest of this clip.
								 */

								clipSeekMode =
									true;


								console.warn(
									"[render] The clip stopped presenting frames (hidden element or background tab); switching to seek-based frame capture."
								);


								try {

									clipVideo.pause();

								}
								catch (pauseError) {

									/* already paused */

								}


								await captureClipFrameAt(
									clipVideo,
									clipTrimSec + (f / FPS),
									clipSeconds + clipTrimSec
								);

							}

						}

					}


					/*
					 * Pick the current frame of the GIF
					 * animation for this video frame.
					 */

					if (gif) {

						const timeInSlideMs =
							(f / FPS) *
								1000;


						const loopMs =
							gif.loopMs > 0
								? gif.loopMs
								: 1;


						const loopTimeMs =
							timeInSlideMs %
								loopMs;


						const frameIndex =
							gifFrameIndexAt(
								gif,
								loopTimeMs
							);


						gifCtx.putImageData(
							gif.frames[
								frameIndex
							].data,
							0,
							0
						);


						img =
							gifCanvas;

					}


					/*
					 * Progress from 0 to 1.
					 *
					 * A one-frame slide used to divide by zero
					 * here, which turned every coordinate into
					 * NaN and made drawImage() a no-op.
					 */

					const p =
						f /
						Math.max(
							1,
							frames -
								1
						);


					/*
					 * Smooth camera movement.
					 */

					const ease =
						p *
						p *
						(
							3 -
							2 * p
						);


					// =========================================
					// CLEAR PREVIOUS FRAME
					// =========================================

					/*
					 * Clear the previous image.
					 *
					 * This is NOT a transition.
					 *
					 * The next image is drawn immediately
					 * over the cleared frame.
					 */

					ctx.clearRect(
						0,
						0,
						WIDTH,
						HEIGHT
					);


					// =========================================
					// CAMERA SCALE
					// =========================================

					/*
					 * 1.15x gives enough room
					 * for panning without
					 * showing empty edges.
					 */

					const zoomScale =
						1.15;


					const drawWidth =
						WIDTH *
						zoomScale;


					const drawHeight =
						HEIGHT *
						zoomScale;


					const overflowX =
						drawWidth -
						WIDTH;


					const overflowY =
						drawHeight -
						HEIGHT;


					/*
					 * Only use part of the available
					 * movement so the camera remains
					 * extremely slow and cinematic.
					 */

					const movementX =
						overflowX *
						0.55;


					const movementY =
						overflowY *
						0.55;


					let dx =
						0;


					let dy =
						0;


					let dw =
						drawWidth;


					let dh =
						drawHeight;


					// =========================================
					// PAN LEFT
					// =========================================

					if (
						effect ===
						"slide-left"
					) {

						/*
						 * Start slightly toward
						 * the right and slowly
						 * travel left.
						 */

						dx =
							0 -
							movementX *
							ease;


						dy =
							-overflowY /
							2;

					}


					// =========================================
					// PAN RIGHT
					// =========================================

					else if (
						effect ===
						"slide-right"
					) {

						dx =
							-movementX +
							(
								movementX *
								ease
							);


						dy =
							-overflowY /
							2;

					}


					// =========================================
					// PAN DOWN
					// =========================================

					else if (
						effect ===
						"slide-down"
					) {

						dx =
							-overflowX /
							2;


						dy =
							-movementY *
							ease;

					}


					// =========================================
					// VERY SLOW ZOOM
					// =========================================

					else if (
						effect ===
						"zoom-in"
					) {

						/*
						 * Only 4% additional zoom
						 * over the entire slide.
						 *
						 * This is deliberately subtle.
						 */

						const currentScale =
							1.04 +
							(
								ease *
								0.04
							);


						dw =
							WIDTH *
							currentScale;


						dh =
							HEIGHT *
							currentScale;


						dx =
							(
								WIDTH -
								dw
							) /
							2;


						dy =
							(
								HEIGHT -
								dh
							) /
							2;

					}


					// =========================================
					// DRAW IMAGE
					// =========================================

					/*
					 * IMPORTANT:
					 *
					 * No fade.
					 * No opacity.
					 * No black overlay.
					 * No transition.
					 *
					 * The image is fully opaque.
					 */

					ctx.globalAlpha =
						1;


					/*
					 * A video source can be drawable-checks
					 * dependent: drawImage() throws
					 * InvalidStateError when a clip has no
					 * decoded frame, and that used to fail the
					 * whole export. Skip that one draw and keep
					 * rendering (the overlays still go on).
					 */

					const slideVisible = slide.visible !== false;
					const isTplSlide = Boolean(renderContext && renderContext.timelineEdited && slide.isTemplateScene);
					const slideFit = renderContext && renderContext.timelineEdited && slide.fit === "contain" ? "contain" : "cover";
					const slideStyle = String(
						(renderContext && renderContext.timelineEdited && slide.videoStyle) ||
						(renderContext && renderContext.videoStyle) ||
						""
					);
					const isRenderedTplVideo = Boolean(isTplSlide && slide.type === "mp4");

					if (isTplSlide || slideFit === "contain") {
						const sw = Number((img && (img.videoWidth || img.naturalWidth || img.width)) || WIDTH);
						const sh = Number((img && (img.videoHeight || img.naturalHeight || img.height)) || HEIGHT);
						const fitScale = slideFit === "contain"
							? Math.min(WIDTH / Math.max(1, sw), HEIGHT / Math.max(1, sh))
							: Math.max(WIDTH / Math.max(1, sw), HEIGHT / Math.max(1, sh));
						dw = sw * fitScale;
						dh = sh * fitScale;
						dx = (WIDTH - dw) / 2;
						dy = (HEIGHT - dh) / 2;
					}

					if (
						slideVisible &&
						drawableSlideSource(
							img
						)
					) {

						ctx.save();
						if (!isRenderedTplVideo && "filter" in ctx) ctx.filter = window.__videoStyleFilter(slideStyle);
						ctx.drawImage(
							img,
							dx,
							dy,
							dw,
							dh
						);
						ctx.restore();

					}


					// =========================================
					// TEMPLATE-MODAL STYLE TREATMENTS
					//
					// The same duotone double gradient / neon glow / VHS bars
					// the table preview paints, so an exported MP4 matches the
					// preview for every scene. They sit on the media and below
					// the title and captions, exactly like the template modal.
					// =========================================

					if (!isRenderedTplVideo && window.__paintVideoStyleEffects) {

						window.__paintVideoStyleEffects(
							ctx,
							WIDTH,
							HEIGHT,
							currentFrame / FPS,
							slideStyle
						);

					}

					if (renderContext && renderContext.timelineEdited && Array.isArray(renderContext.timelineElements) && renderContext.timelineElements.length) {
						paintTimelineVisualElements(
							ctx,
							renderContext.timelineElements,
							currentFrame / FPS,
							WIDTH,
							HEIGHT,
							slide,
							isRenderedTplVideo
						);
					}


					// =========================================
					// TITLE OVERLAY
					// =========================================

					drawTitle(
						ctx
					);


					// =========================================

					// TIMESTAMP CAPTION OVERLAY

					// =========================================


					const frameTimeMs =
						(currentFrame * 1000) /
							FPS;


					drawCaptions(

						ctx,

						captions,

						frameTimeMs,

						WIDTH,

						HEIGHT

					);


					/*
					 * Script subtitles: below the
					 * caption, 1/3 up from the
					 * bottom.
					 */

					drawSubtitles(

						ctx,

						subtitles,

						frameTimeMs,

						WIDTH,

						HEIGHT

					);


					// =========================================
					// CREATE VIDEO FRAME
					// =========================================

					const timestamp =
						(
							currentFrame *
							1_000_000
						) /
						FPS;


					const frame =
						new VideoFrame(
							canvas,
							{
								timestamp: timestamp,
								// Preserve the final frame's duration in the real MP4 muxer.
								duration: Math.round(1_000_000 / FPS)
							}
						);


					// =========================================
					// ENCODE
					// =========================================

					videoEncoder.encode(
						frame,
						{

							/*
							 * Keyframes occur every
							 * 10 seconds.
							 *
							 * The visual image change
							 * still occurs at the end
							 * of each slide.
							 */

							keyFrame:
								currentFrame %
								KEYFRAME_INTERVAL ===
								0

						}
					);


					/*
					 * Immediately release
					 * the VideoFrame.
					 */

					frame.close();


					// =========================================
					// WRITE MATCHING AUDIO
					// =========================================

					flushAudioUpTo(
						timestamp
					);


					currentFrame++;


					// =========================================
					// BACKPRESSURE
					// =========================================

					await waitForEncoder();


					// =========================================
					// PROGRESS
					// =========================================

					if (
						currentFrame %
						15 ===
						0
					) {

						const fraction =
							currentFrame /
							TOTAL_FRAMES;


						/*
						 * Audio used the first 25%
						 * of the bar when present.
						 */

						const percent =
							Math.round(
								audioTrack
									? 25 +
										fraction *
											75
									: fraction *
											100
							);


						progressBar.style.width =
							percent +
							"%";


						statusText.textContent =
							\`Rendering image \${i + 1}/\${slides.length} \u2014 \${percent}%\`;


						/*
						 * Give the browser time
						 * to update the UI.
						 */

						await new Promise(
							resolve =>
								setTimeout(
									resolve,
									0
								)
						);

					}

				}


				if (
					clipVideo
				) {


					clipVideo.pause();


				}


				/*
				 * Make sure the encoder catches up
				 * before processing another image.
				 */

				await waitForEncoder();


				statusText.textContent =
					\`Completed image \${i + 1} of \${slides.length}\`;

			}


			/*
			 * Resume the clip previews.
			 */


			for (
				const resumeSlide of slides
			) {


				if (
					resumeSlide.type ===
						"mp4" &&
					resumeSlide.videoEl
				) {


					try {


						/*
						 * play() rejects through its promise, which a
						 * try/catch cannot see. Swallow it so a blocked
						 * autoplay never surfaces as an unhandled
						 * rejection (the export itself does not need
						 * the preview to play).
						 */

						const resumed =
							resumeSlide.videoEl.play();


						if (
							resumed &&
							typeof resumed.catch ===
								"function"
						) {

							resumed.catch(
								() => {}
							);

						}


					}


					catch (resumeError) {


						console.error(
							"Clip resume failed:",
							resumeError
						);


					}


				}


			}


			// =================================================
			// FLUSH ENCODER
			// =================================================

			statusText.textContent =
				"Finalizing MP4 file...";


			/*
			 * Bounded, for the same reason as waitForEncoder(): a
			 * flush that never settles would leave the studio on
			 * "Finalizing MP4 file..." forever. The promise is not
			 * cancelled (WebCodecs has no cancel), but the export
			 * now reports the failure instead of hanging.
			 */

			let flushTimer =
				null;


			try {

				await Promise.race([
					videoEncoder.flush(),
					new Promise(
						(resolve, reject) => {

							flushTimer =
								setTimeout(
									() => reject(
										new Error(
											"Finalizing the MP4 file took longer than " +
												Math.round(
													ENCODER_FLUSH_TIMEOUT_MS /
														1000
												) +
												" seconds. The file was not saved."
										)
									),
									ENCODER_FLUSH_TIMEOUT_MS
								);

						}
					)
				]);

			}

			finally {

				/*
				 * Never leave the watchdog timer behind: a pending
				 * 3-minute timer keeps the tab (and any test runner)
				 * alive long after the export finished.
				 */

				if (flushTimer) {

					clearTimeout(
						flushTimer
					);

				}

			}


			if (encoderError) {

				throw encoderError;

			}


			// =================================================
			// WRITE ANY REMAINING AUDIO
			// =================================================

			flushAudioUpTo(
				Number.POSITIVE_INFINITY
			);


			// =================================================
			// FINALIZE MP4
			// =================================================

			muxer.finalize();


			// =================================================
			// SAVE OR DOWNLOAD
			// =================================================

			if (streamingToFile) {

				/*
				 * Closing the stream is what
				 * flushes the finished file to
				 * disk.
				 */

				await fileStream.close();


				fileStream =
					null;

			}
			else {

				const buffer =
					muxer.target.buffer;


				const blob =
					new Blob(
						[buffer],
						{
							type:
								"video/mp4"
						}
					);

			window.__lastRenderBlob =
				blob;

				const downloadURL =
					createStudioObjectUrl(
						blob
					);


				const a =
					document.createElement(
						"a"
					);


				a.href =
					downloadURL;


				a.download =
					fileName;


				document.body.appendChild(
					a
				);


				if (!window.__workerMode) {
					a.click();
				}


				a.remove();


				setTimeout(
					() => {

						releaseStudioObjectUrl(
							downloadURL
						);

					},
					2000
				);

			}


			progressBar.style.width =
				"100%";


			statusText.textContent =
				streamingToFile
					? audioTrack
						? "\u2713 MP4 saved to disk with audio!"
						: "\u2713 MP4 saved to disk!"
					: audioTrack
						? "\u2713 MP4 Downloaded with audio!"
						: "\u2713 MP4 Downloaded!";

			recordStudioUsage("videos", "ok", 1);

			return "done";

		}
		catch (error) {

			console.error(
				"MP4 rendering failed:",
				error
			);


			statusText.textContent =
				"\u26a0 Video rendering failed.";


			alert(
				"Video rendering failed: " +
					(error.message || String(error)) +
					"\\n\\nTry reducing the number of images or closing other browser tabs."
			);

			return "error";

		}
		finally {

			/*
			 * Always clean up the encoder.
			 */

			if (
				videoEncoder.state !==
				"closed"
			) {

				try {

					videoEncoder.close();

				}
				catch (error) {

					console.warn(
						"Encoder cleanup error:",
						error
					);

				}

			}


			/*
			 * A failed render must release the
			 * file handle, otherwise the
			 * partial file stays locked.
			 */

			if (fileStream) {

				try {

					await fileStream.abort();

				}
				catch (error) {

					console.warn(
						"File stream cleanup error:",
						error
					);

				}

			}


			for (
				const restoreClip of clipRestores
			) {

				try {

					restoreClip();

				}

				catch (restoreError) {

					console.warn(
						"Clip restore error:",
						restoreError
					);

				}

			}


			renderBtn.disabled =
				false;

		}

	}


`;
