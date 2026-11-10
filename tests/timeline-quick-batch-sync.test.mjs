import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
import { TIMELINE_EDITOR_JS } from "../src/client/timeline-editor.ts";

function makeMemoryStorage(seed) {
	const map = new Map(seed ? Object.entries(seed) : []);
	return {
		get length() { return map.size; },
		key(index) { return Array.from(map.keys())[index] ?? null; },
		getItem(key) { return map.has(String(key)) ? map.get(String(key)) : null; },
		setItem(key, value) { map.set(String(key), String(value)); },
		removeItem(key) { map.delete(String(key)); },
		clear() { map.clear(); }
	};
}

function makeCookieJar(initial = "") {
	const store = new Map();
	if (initial) {
		for (const part of String(initial).split(";")) {
			const eq = part.indexOf("=");
			if (eq < 0) continue;
			store.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
		}
	}
	return {
		get cookie() {
			return Array.from(store.entries()).map(([k, v]) => k + "=" + v).join("; ");
		},
		set cookie(raw) {
			const parts = String(raw || "").split(";");
			const first = parts[0] || "";
			const eq = first.indexOf("=");
			if (eq < 0) return;
			const name = first.slice(0, eq).trim();
			const val = first.slice(eq + 1).trim();
			const attrs = parts.slice(1).map((p) => p.trim().toLowerCase());
			const maxAge = attrs.find((a) => a.startsWith("max-age="));
			const expired = maxAge && Number(maxAge.slice(8)) <= 0;
			const hasPastExpires = attrs.some((a) => a.startsWith("expires=") && Date.parse(a.slice(8)) <= Date.now());
			if (expired || hasPastExpires || val === "") store.delete(name);
			else store.set(name, val);
		},
		names() { return Array.from(store.keys()); }
	};
}

function makeMemoryIndexedDB() {
	const records = new Map();
	let storeCreated = false;
	return {
		records,
		factory: {
			open() {
				const req = {};
				setTimeout(() => {
					const db = {
						objectStoreNames: { contains: (n) => n === "projects" && storeCreated },
						createObjectStore: () => { storeCreated = true; return {}; },
						transaction() {
							const tx = {
								objectStore() {
									return {
										get(key) {
											const r = {};
											setTimeout(() => {
												r.result = records.get(String(key)) || null;
												r.onsuccess?.({ target: r });
												tx.oncomplete?.();
											}, 0);
											return r;
										},
										put(record) {
											const r = {};
											setTimeout(() => {
												records.set(String(record.id), record);
												r.onsuccess?.({ target: r });
												tx.oncomplete?.();
											}, 0);
											return r;
										}
									};
								}
							};
							return tx;
						},
						close() {}
					};
					req.result = db;
					if (!storeCreated) req.onupgradeneeded?.({ target: req });
					req.onsuccess?.({ target: req });
				}, 0);
				return req;
			}
		}
	};
}

function bootWindow({ url, localStorage, sessionStorage, cookieJar, indexedDB, loadTimeline = false, prepare }) {
	const dom = new JSDOM(createHTML(), {
		url,
		runScripts: "outside-only",
		pretendToBeVisual: true
	});
	const w = dom.window;
	let uid = 0;
	w.alert = () => {};
	w.confirm = () => true;
	w.scrollTo = () => {};
	w.URL.createObjectURL = () => "blob:sync-test-" + (++uid);
	w.URL.revokeObjectURL = () => {};
	w.Audio = class MockAudio {
		constructor(src = "") { this.src = src; this.currentTime = 0; }
		addEventListener() {}
		play() { return Promise.resolve(); }
		pause() {}
	};
	w.__PLAN_MODE = "freemium";
	if (localStorage) Object.defineProperty(w, "localStorage", { configurable: true, value: localStorage });
	if (sessionStorage) Object.defineProperty(w, "sessionStorage", { configurable: true, value: sessionStorage });
	if (cookieJar) {
		Object.defineProperty(w.document, "cookie", {
			configurable: true,
			get() { return cookieJar.cookie; },
			set(val) { cookieJar.cookie = val; }
		});
	}
	if (indexedDB) Object.defineProperty(w, "indexedDB", { configurable: true, value: indexedDB });
	if (prepare) prepare(w);
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	if (loadTimeline) {
		w.eval(TIMELINE_EDITOR_JS);
	}
	const rawTimeout = w.setTimeout.bind(w);
	w.setTimeout = (cb, ms, ...a) => rawTimeout(cb, Number(ms) === 40000 ? 0 : ms, ...a);
	return { dom, w };
}

function finishRow(w, row) {
	const videoIndexes = [0, 3, 6, 9];
	row.images = Array.from({ length: 12 }, (_, index) => ({
		index,
		blob: new w.Blob([videoIndexes.includes(index) ? "mp4" : "jpg"], {
			type: videoIndexes.includes(index) ? "video/mp4" : "image/jpeg"
		}),
		stockFilename: "scene-" + (index + 1)
	}));
	row.images.forEach((img, idx) => { img.blob.stockFilename = "scene-" + (idx + 1); });
	const sceneSpan = 5;
	row.slides = row.images.map((image, idx) => ({
		id: "batch-" + row.id + "-img-" + idx,
		img: { naturalWidth: 1280, naturalHeight: 720 },
		type: image.blob.type === "video/mp4" ? "mp4" : "image",
		_partialSec: sceneSpan,
		duration: image.blob.type === "video/mp4" ? sceneSpan : 0
	}));
	row.mp3 = new w.Blob(["audio"], { type: "audio/mpeg" });
	row.mp3Url = "blob:voice-" + row.id;
	row.audio = { name: "Row" + row.id + "-voiceover.mp3", duration: 60, buffer: null, url: row.mp3Url };
	row.animated = true;
	row.stage = "done";
	w.renderBatchTable();
	return row;
}

function mockBatchGenerationRoutes(w) {
	let mediaCounter = 0;
	const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
	w.fetch = async (url, init = {}) => {
		if (url === "/api/session") {
			return { ok: true, status: 200, headers: new Map(), json: async () => ({ success: true, authenticated: true, user: { username: "T", usertype: "free" }, remaining: {} }) };
		}
		if (url === "/api/credits") {
			return { ok: true, status: 200, headers: new Map(), json: async () => ({ success: true, plan: { id: "free", label: "Free", limits: { images: 50 } }, remaining: { images: 20 } }) };
		}
		if (url === "/api/voiceover") {
			return {
				ok: true,
				status: 200,
				headers: { get: () => "audio/mpeg" },
				blob: async () => new w.Blob([new Uint8Array([255, 243, 1, 2, 3, 4])], { type: "audio/mpeg" })
			};
		}
		if (url === "/api/image-prompts") {
			const body = JSON.parse(init.body || "{}");
			const count = (body.batch && body.batch.count) || 12;
			const offset = (body.batch && body.batch.offset) || 0;
			const prompts = Array.from({ length: count }, (_, i) =>
				"Lead paragraph about scene " + (offset + i + 1) + ".\n\nMiddle paragraph about scene " + (offset + i + 1) + ".\n\nClosing paragraph about scene " + (offset + i + 1) + "."
			);
			return {
				ok: true,
				status: 200,
				headers: { get: () => "application/json" },
				json: async () => ({ success: true, prompts, count, expectedCount: count, style: body.style || "Neon Night" })
			};
		}
		if (url === "/api/image-batch") {
			const body = JSON.parse(init.body || "{}");
			const prompts = body.prompts || [];
			const scenes = Array.isArray(body.sceneIndexes) ? body.sceneIndexes.map(Number) : prompts.map((_, i) => i);
			const events = [{ type: "start", count: prompts.length, width: 1024, height: 576 }];
			prompts.forEach((_, i) => {
				const scene = Number.isInteger(scenes[i]) ? scenes[i] : i;
				const isVid = [0, 3, 6, 9].includes(scene);
				const id = ++mediaCounter;
				events.push({
					type: "image",
					index: i,
					ok: true,
					mime: isVid ? "video/mp4" : "image/png",
					data: pngBase64,
					stockFilename: "regen-" + id + (isVid ? ".mp4" : ".png"),
					source: { id: "media-" + id, provider: "pixabay", type: isVid ? "video" : "image" }
				});
			});
			events.push({ type: "done", generated: prompts.length, failed: 0 });
			return {
				ok: true,
				status: 200,
				headers: { get: () => "application/x-ndjson" },
				body: new ReadableStream({
					start(controller) {
						const encoder = new TextEncoder();
						for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
						controller.close();
					}
				})
			};
		}
		return { ok: true, status: 200, headers: new Map(), json: async () => ({}) };
	};
	w.AudioContext = class {
		decodeAudioData() { return Promise.resolve({ duration: 48 }); }
		close() {}
	};
	w.__CLIP_PROBE_TIMING = { timeoutMs: 50 };
	Object.defineProperty(w.HTMLMediaElement.prototype, "src", {
		configurable: true,
		get: function () { return this.getAttribute("src") || ""; },
		set: function (value) {
			this.setAttribute("src", value);
			w.setTimeout(() => this.dispatchEvent(new w.Event("loadedmetadata")), 0);
		}
	});
	w.HTMLMediaElement.prototype.load = function () {
		w.setTimeout(() => this.dispatchEvent(new w.Event("loadedmetadata")), 0);
	};
	w.HTMLMediaElement.prototype.pause = function () {};
	Object.defineProperty(w.HTMLMediaElement.prototype, "duration", { configurable: true, get: () => 4 });
	Object.defineProperty(w.HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 4 });
	Object.defineProperty(w.HTMLMediaElement.prototype, "videoWidth", { configurable: true, get: () => 1024 });
	Object.defineProperty(w.HTMLMediaElement.prototype, "videoHeight", { configurable: true, get: () => 576 });
	w.Image = class MockImage {
		set src(v) {
			this._src = v;
			this.naturalWidth = 1280;
			this.naturalHeight = 720;
			setTimeout(() => this.onload?.(), 0);
		}
		get src() { return this._src || ""; }
		decode() { return Promise.resolve(); }
	};
}

test("Req 1 & 2 & 3: editing a finished row in timeline updates projectDetail, composes slides/scenes via localStorage+cookies, keeps ▶/⚙/✎ enabled, and allows regeneration upon return to Quick Batch", async (t) => {
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();
	const idb = makeMemoryIndexedDB();

	/* 1. Start in Quick Batch table with a finished row. */
	let openedHref = "";
	const table1 = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=pg_sync_1",
		localStorage,
		sessionStorage,
		cookieJar,
		indexedDB: idb.factory,
		loadTimeline: true,
		prepare(w) {
			w.open = (href) => { openedHref = String(href); return null; };
		}
	});
	t.after(() => table1.dom.window.close());

	table1.w.setStudioLayout("table");
	const row = table1.w.__BATCH_ROWS[0];
	row.script = "Golden sunlight warms the greenhouse tomatoes every morning.";
	row.style = "Neon Night";
	finishRow(table1.w, row);

	/* Non-edited finished row cannot regenerate. */
	assert.equal(table1.w.batchRowFinished(row), true);
	assert.equal(table1.w.batchRowReadyForGeneration(row), false);
	assert.equal(table1.w.document.getElementById("batch-generate").disabled, true);

	/* Click Edit (✎) to hand off to timeline editor. */
	const editBtn = table1.w.document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-action="edit"]');
	assert.equal(editBtn.disabled, false);
	editBtn.click();
	await new Promise((r) => setTimeout(r, 30));
	assert.match(openedHref, /layout=timeline/);

	/* 2. Open the Timeline editor tab on that handoff URL. */
	const timelineUrl = "https://studio.test" + openedHref;
	const tl = bootWindow({
		url: timelineUrl,
		localStorage,
		sessionStorage,
		cookieJar,
		indexedDB: idb.factory,
		loadTimeline: true
	});
	t.after(() => tl.dom.window.close());
	await new Promise((r) => setTimeout(r, 30));

	const api = tl.w.__TIMELINE_EDITOR__;
	const tlState = tl.w.__TIMELINE_EDITOR_STATE__;
	const media = tlState.tracks.find((tr) => tr.id === "background-media");
	assert.equal(media.items.length, 12);

	/* Edit timing, add text + graphic, duplicate first clip, append a template clip. */
	api.setItemTiming(media.items[0].id, 0, 8.5);
	api.addTextElement("Morning Harvest");
	api.addGraphicElement();
	tlState.selectedTrackId = "background-media";
	tlState.selectedItemId = media.items[0].id;
	api.duplicateSelectedItem();
	assert.equal(
		api.appendTemplateClip({ name: "Extra B-Roll", durationSec: 4, kind: "video", source: "template", blob: new tl.w.Blob(["mp4"], { type: "video/mp4" }) }),
		1
	);
	assert.equal(api.save(), true);

	/* Req 2: timeline projectDetail is re-composed to match all edits. */
	const detail = api.getProjectDetail();
	assert.equal(detail.sceneCount, 14, "12 original + 1 duplicate + 1 appended clip");
	assert.equal(detail.slideCount, 14);
	assert.equal(detail.slides.length, 14);
	assert.equal(detail.durationSec, tlState.durationSec);
	assert.ok(detail.textCount >= 2, "dummy text + added text");
	assert.ok(detail.graphicCount >= 1, "added graphic");
	assert.match(tl.w.document.getElementById("timeline-project-subtitle").textContent, /14 scenes/);

	/* Req 3: timeline state was written to BOTH localStorage AND ytvs_timeline_editor_* cookies. */
	const tlKey = tl.w.__TIMELINE_EDITOR_SAVE__.key;
	assert.ok(localStorage.getItem(tlKey), "timeline state exists in localStorage");
	assert.ok(
		cookieJar.names().some((name) => name.startsWith("ytvs_timeline_editor_")),
		"timeline cookies were written"
	);

	/* Click Back (← Quick Batch) to publish hand-back into the table store. */
	tl.w.document.getElementById("timeline-back").click();
	assert.equal(tl.w.__TIMELINE_EDIT_PUBLISH__.ok, true);

	/* 3. Return to the Quick Batch table layout in a fresh window (simulating navigation back). */
	const table2 = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=pg_sync_1",
		localStorage,
		sessionStorage,
		cookieJar,
		indexedDB: idb.factory,
		loadTimeline: true
	});
	t.after(() => table2.dom.window.close());
	await new Promise((r) => setTimeout(r, 30));

	const returnedRow = table2.w.getBatchRow(row.id);
	assert.ok(returnedRow, "returned row restored");
	assert.equal(returnedRow.timelineEdited, true);
	assert.equal(returnedRow.slides.length, 14, "all 14 scenes/slides composed on return");
	assert.equal(returnedRow.projectDetail.sceneCount, 14, "row projectDetail carries recomposed scene count");
	assert.equal(returnedRow.projectDetail.durationSec, tlState.durationSec);
	assert.equal(returnedRow.projectDetail.style, "Neon Night");

	/* Req 1: ▶, ⚙, ✎ are ALL enabled AND Generate is enabled! */
	const tr = table2.w.document.querySelector('[data-batch-row="' + returnedRow.id + '"]');
	assert.equal(tr.querySelector('[data-batch-action="preview"]').disabled, false, "▶ Preview enabled");
	assert.equal(tr.querySelector('[data-batch-action="export"]').disabled, false, "⚙ Export enabled");
	assert.equal(tr.querySelector('[data-batch-action="edit"]').disabled, false, "✎ Edit enabled");
	assert.equal(table2.w.batchRowReadyForGeneration(returnedRow), true, "timeline-updated completed row is regenerable");
	assert.equal(table2.w.document.getElementById("batch-generate").disabled, false, "Generate button enabled");
	assert.equal(table2.w.document.getElementById("top-generate").disabled, false, "Top Generate button enabled");

	/* Opening Preview on the returned row must not throw even when video slides lack videoEl initially. */
	table2.w.openBatchPreview(returnedRow.id);
	table2.w.batchPreviewTick();
	table2.w.closeBatchPreview();

	/* Req 1: regenerating the row works cleanly, then locks Generate again until another timeline edit. */
	mockBatchGenerationRoutes(table2.w);
	await table2.w.generateBatchRows();
	assert.equal(table2.w.batchRowFinished(returnedRow), true);
	assert.equal(returnedRow.slides.length, 12);
	assert.equal(table2.w.batchRowReadyForGeneration(returnedRow), false, "after regenerating, row does not endlessly regenerate");
	assert.equal(table2.w.document.getElementById("batch-generate").disabled, true);
});

test("Req 3: all timeline slides, scenes, and projectDetail compose cleanly from cookies alone when localStorage is cleared", async (t) => {
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();

	/* Run timeline editor and write edits to localStorage + cookies. */
	const tl1 = bootWindow({
		url: "https://studio.test/free?layout=timeline&pipelinePage=timeline-pg_cookie_only-row-3",
		localStorage,
		sessionStorage,
		cookieJar,
		loadTimeline: true
	});
	t.after(() => tl1.dom.window.close());
	const api = tl1.w.__TIMELINE_EDITOR__;
	const media = tl1.w.__TIMELINE_EDITOR_STATE__.tracks.find((tr) => tr.id === "background-media");
	api.setItemTiming(media.items[1].id, 5, 9.25);
	assert.equal(
		api.appendTemplateClip({ name: "Cookie Added Clip", durationSec: 3.5, kind: "video", source: "template", blob: new tl1.w.Blob(["mp4"], { type: "video/mp4" }) }),
		1
	);
	assert.equal(api.save(), true);

	/* Also seed table pipeline store with row 3, then publish edit so pipeline cookies hold it too. */
	const tableStore = tl1.w.__PIPELINE_MANAGEMENT_STORE_FACTORY__(tl1.w, "pg_cookie_only");
	assert.equal(tableStore.save({
		version: 1, pageId: "pg_cookie_only", updatedAt: Date.now(), layout: "table",
		quickBatch: {
			runBusy: false, queued: [], finishedCount: 0,
			rows: [{ id: "3", vid: "pg_cookie_only-row-3", script: "Cookie composition test script", stage: "done", mp3: true, animated: true, finished: true, images: 12, slides: 12 }]
		},
		editor: { projects: [] }
	}).ok, true);
	tl1.w.__TIMELINE_EDITOR_STATE__.sourcePageId = "pg_cookie_only";
	tl1.w.__TIMELINE_EDITOR_STATE__.sourceRowId = "3";
	tl1.w.document.getElementById("timeline-back").click();

	/* Wipe localStorage completely — ONLY cookies remain! */
	localStorage.clear();
	assert.equal(localStorage.length, 0);

	/* Reopen timeline editor from cookies alone: all 13 scenes & slides compose. */
	const tl2 = bootWindow({
		url: "https://studio.test/free?layout=timeline&pipelinePage=timeline-pg_cookie_only-row-3",
		localStorage,
		sessionStorage,
		cookieJar,
		loadTimeline: true
	});
	t.after(() => tl2.dom.window.close());
	assert.equal(tl2.w.__TIMELINE_EDITOR_STATE__.scenes.length, 13, "timeline editor restored all 13 scenes from cookies");
	assert.equal(tl2.w.__TIMELINE_EDITOR__.getSlides().length, 13, "timeline editor composed all 13 slides from cookies");
	assert.equal(tl2.w.__TIMELINE_EDITOR__.getProjectDetail().sceneCount, 13);

	/* Reopen Quick Batch table from cookies alone: all 13 slides, scenes, projectDetail, and enabled buttons restore! */
	const tableCookie = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=pg_cookie_only",
		localStorage,
		sessionStorage,
		cookieJar
	});
	t.after(() => tableCookie.dom.window.close());
	const row3 = tableCookie.w.getBatchRow("3");
	assert.ok(row3);
	assert.equal(row3.slides.length, 13, "Quick Batch composed all 13 slides from cookies alone");
	assert.equal(row3.projectDetail.sceneCount, 13);
	assert.equal(tableCookie.w.batchRowFinished(row3), true, "buttons stay enabled from cookie restore");
	/* Session 331 (regenerate fix): a restored row waits for its media recovery to settle before Generate can start on it. */
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(tableCookie.w.batchRowReadyForGeneration(row3), true, "timeline edit remains regenerable from cookie restore");
});

/* Session 331 (regenerate fix): a finished row's media is kept in IndexedDB and comes back after a reload. */
test("Regenerate fix: a finished row restored after reload gets its media back from IndexedDB, rebuilds its slides and stays live", async (t) => {
	const pageId = "pg_idb_restore";
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();
	const indexedDB = makeMemoryIndexedDB();
	const seed = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=" + pageId,
		localStorage, sessionStorage, cookieJar, indexedDB: indexedDB.factory, loadTimeline: true
	});
	t.after(() => seed.dom.window.close());
	const w0 = seed.w;
	const videoIndexes = [0, 3, 6, 9];
	const slideItems = Array.from({ length: 12 }, (_, index) => ({
		id: "batch-1-img-" + index, slideId: "batch-1-img-" + index, i: index, a: "scene-" + (index + 1),
		n: "Scene " + (index + 1), t: videoIndexes.includes(index) ? 1 : 0, s: index * 5, d: 5, tr: 0, f: 0, v: 1
	}));
	const tableStore = w0.__PIPELINE_MANAGEMENT_STORE_FACTORY__(w0, pageId);
	assert.equal(tableStore.save({
		version: 1, pageId, updatedAt: Date.now(), layout: "table",
		quickBatch: {
			runBusy: false, queued: [], finishedCount: 1,
			rows: [{
				id: "1", vid: pageId + "-row-1", script: "A finished script that the reload must keep.", stage: "done",
				mp3: true, animated: true, finished: true, images: 12, slides: 12, slideItems
			}]
		},
		editor: { projects: [] }
	}).ok, true);

	const reloaded = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=" + pageId,
		localStorage, sessionStorage, cookieJar, indexedDB: indexedDB.factory, loadTimeline: true
	});
	t.after(() => reloaded.dom.window.close());
	const w = reloaded.w;
	/* The voiceover and the twelve Pixabay media are in IndexedDB under the row's timeline page id. */
	const assets = {};
	for (let index = 0; index < 12; index++) {
		const id = "scene-" + (index + 1);
		const type = videoIndexes.includes(index) ? "video/mp4" : "image/jpeg";
		assets[id] = { id, blob: new w.Blob(["m"], { type }), name: id + ".jpg", type, source: null };
	}
	indexedDB.records.set("timeline-" + pageId + "-row-1", {
		id: "timeline-" + pageId + "-row-1",
		voiceover: new w.Blob([new Uint8Array([255, 243, 1, 2])], { type: "audio/mpeg" }),
		assets,
		updatedAt: Date.now()
	});
	await new Promise((resolve) => setTimeout(resolve, 50));
	const row = w.getBatchRow("1");
	assert.ok(row, "the finished row is back on the table");
	assert.equal(row.stage, "done");
	assert.equal(row.images.length, 12, "the twelve media came back from IndexedDB");
	assert.ok(row.mp3, "the voiceover came back from IndexedDB");
	assert.equal(row.slides.length, 12, "the slides were rebuilt from the stored timing");
	assert.ok(row.slides.every((slide) => slide.img), "every rebuilt slide has its media");
	assert.equal(w.batchRowFinished(row), true, "the action buttons stay live after the reload");
	assert.equal(w.batchRowReadyForGeneration(row), false, "a finished row is not queued for generation again");
});

test("Regenerate fix: a finished row whose media cannot be found is demoted to a record that Generate can build again", async (t) => {
	const pageId = "pg_idb_missing";
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();
	const indexedDB = makeMemoryIndexedDB();
	const seed = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=" + pageId,
		localStorage, sessionStorage, cookieJar, indexedDB: indexedDB.factory, loadTimeline: true
	});
	t.after(() => seed.dom.window.close());
	const tableStore = seed.w.__PIPELINE_MANAGEMENT_STORE_FACTORY__(seed.w, pageId);
	assert.equal(tableStore.save({
		version: 1, pageId, updatedAt: Date.now(), layout: "table",
		quickBatch: {
			runBusy: false, queued: [], finishedCount: 1,
			rows: [{ id: "2", vid: pageId + "-row-2", script: "Media that was never stored.", stage: "done", mp3: true, animated: true, finished: true, images: 12, slides: 12 }]
		},
		editor: { projects: [] }
	}).ok, true);

	const reloaded = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=" + pageId,
		localStorage, sessionStorage, cookieJar, indexedDB: indexedDB.factory, loadTimeline: true
	});
	t.after(() => reloaded.dom.window.close());
	const w = reloaded.w;
	await new Promise((resolve) => setTimeout(resolve, 50));
	const row = w.getBatchRow("2");
	assert.ok(row, "the row is still on the table as a record");
	assert.equal(row.stage, "done");
	assert.equal(w.batchRowFinished(row), false, "no media came back, so the row is not finished");
	assert.equal(row._storedFinished, false, "the stored finished flag is cleared");
	assert.equal(w.batchRowReadyForGeneration(row), true, "Generate can build the row again");
});

test("Req 4: blank-script rows with stored project details have their localStorage and cookie entries deleted on restore, publish, script clear, and remove", (t) => {
	const pageId = "pg_blank_purge";
	const timelinePid = "timeline-" + pageId + "-row-5";
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();

	/* Seed pre-existing stale blank-script row with stored projectDetail in BOTH pipeline store & timeline/transition storage/cookies. */
	const staleUpdatedAt = Date.now() - 5000;
	const staleSnapshot = {
		version: 1,
		pageId,
		updatedAt: staleUpdatedAt,
		layout: "table",
		quickBatch: {
			runBusy: false,
			queued: ["5"],
			finishedCount: 1,
			rows: [
				{
					id: "5",
					vid: pageId + "-row-5",
					script: "   ",
					stage: "ready",
					projectDetail: { id: "5", rowId: "5", style: "Neon Night", sceneCount: 12 },
					timelineKey: "ytvs.timeline-editor.v1." + timelinePid,
					timeline: { v: 1, updatedAt: staleUpdatedAt, key: "ytvs.timeline-editor.v1." + timelinePid, scenes: [[0, 3, 0]] }
				},
				{
					id: "6",
					vid: pageId + "-row-6",
					script: "Keep this scripted row intact.",
					stage: "ready",
					projectDetail: { id: "6", rowId: "6", style: "Cinematic Film", sceneCount: 12 }
				}
			]
		},
		editor: { projects: [{ n: 1, vid: pageId + "-editor-1", script: "" }] }
	};
	localStorage.setItem("ytvs.pipeline-management.v1." + pageId, JSON.stringify(staleSnapshot));
	/* Also seed matching pipeline cookies manually so boot sees stale cookies too. */
	const staleText = JSON.stringify(staleSnapshot);
	const chunkSize = Math.ceil(staleText.length / 4);
	for (let i = 0; i < 4; i++) {
		const meta = {
			v: 1, p: pageId, t: staleUpdatedAt, h: "0", n: 4, i: i + 1,
			d: staleText.slice(i * chunkSize, (i + 1) * chunkSize)
		};
		cookieJar.cookie = "ytvs_pipeline_management_" + pageId + "_" + (i + 1) + "=" + encodeURIComponent(JSON.stringify(meta)) + "; Path=/; SameSite=Lax";
	}
	/* Seed per-row timeline & transition localStorage + cookies for blank-script row 5. */
	localStorage.setItem("ytvs.timeline-editor.v1." + timelinePid, JSON.stringify({
		version: 3, projectId: timelinePid, sourcePageId: pageId, sourceRowId: "5", sourceScript: "",
		updatedAt: staleUpdatedAt, projectDetail: { id: "5", style: "Neon Night" }, scenes: [], tracks: []
	}));
	cookieJar.cookie = "ytvs_timeline_editor_" + timelinePid + "_1=" + encodeURIComponent(JSON.stringify({
		v: 1, p: timelinePid, n: 1, i: 1, t: staleUpdatedAt, h: "abc", d: "{}"
	})) + "; Path=/; SameSite=Lax";
	localStorage.setItem("ytvs.transition-project.v1.edit-blank-5", JSON.stringify({
		version: 1, transitionOnly: true, sourcePageId: pageId, targetPageId: timelinePid,
		basicSettings: { id: 5, vid: pageId + "-row-5", script: "" },
		projectDetail: { id: "5", style: "Neon Night" }
	}));
	cookieJar.cookie = "ytvs_transition_project_edit-blank-5=" + encodeURIComponent(JSON.stringify({
		v: 1, key: "edit-blank-5", createdAt: staleUpdatedAt, targetPageId: timelinePid, vid: pageId + "-row-5"
	})) + "; Path=/; SameSite=Lax";
	localStorage.setItem("ytvs.quick-batch-completed.v1", JSON.stringify({
		version: 1, updatedAt: staleUpdatedAt,
		rows: [{ id: "5", script: "", completedAt: staleUpdatedAt }]
	}));

	const { dom, w } = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=" + pageId,
		localStorage,
		sessionStorage,
		cookieJar
	});
	t.after(() => dom.window.close());

	/* Stale blank-script row 5 and its localStorage + cookie entries are gone; row 6 remains! */
	assert.equal(w.getBatchRow("5"), null, "blank-script row 5 was purged");
	assert.ok(w.getBatchRow("6"), "scripted row 6 was preserved");
	assert.equal(localStorage.getItem("ytvs.timeline-editor.v1." + timelinePid), null, "blank row timeline localStorage deleted");
	assert.equal(localStorage.getItem("ytvs.transition-project.v1.edit-blank-5"), null, "blank row transition localStorage deleted");
	assert.equal(cookieJar.names().some((n) => n.includes(timelinePid)), false, "blank row timeline cookie deleted");
	assert.equal(cookieJar.names().some((n) => n.includes("edit-blank-5")), false, "blank row transition cookie deleted");

	const storedAfterBoot = JSON.parse(localStorage.getItem("ytvs.pipeline-management.v1." + pageId));
	assert.equal(storedAfterBoot.quickBatch.rows.some((r) => String(r.id) === "5"), false, "pipeline localStorage omits blank row");
	assert.equal(storedAfterBoot.quickBatch.queued.includes("5"), false, "queued omits blank row");
	assert.equal(storedAfterBoot.editor.projects.length, 0, "blank editor project omitted");

	const pmCookieChunks = [];
	for (let i = 1; i <= 4; i++) {
		const raw = w.document.cookie.split(";").map((s) => s.trim()).find((s) => s.startsWith("ytvs_pipeline_management_" + pageId + "_" + i + "="));
		assert.ok(raw);
		pmCookieChunks.push(JSON.parse(decodeURIComponent(raw.split("=")[1])));
	}
	pmCookieChunks.sort((a, b) => a.i - b.i);
	const pmCookieSnap = JSON.parse(pmCookieChunks.map((m) => m.d).join(""));
	assert.equal(pmCookieSnap.quickBatch.rows.some((r) => String(r.id) === "5"), false, "pipeline cookies omit blank row");

	/* Now clear scripted row 6's script in the UI after it had stored timeline + projectDetail + cookies! */
	const row6 = w.getBatchRow("6");
	const tl6Pid = "timeline-" + pageId + "-row-6";
	row6.timeline = { v: 1, updatedAt: Date.now(), key: "ytvs.timeline-editor.v1." + tl6Pid, scenes: [[0, 4, 0]] };
	row6.timelineKey = "ytvs.timeline-editor.v1." + tl6Pid;
	row6.timelineEdited = true;
	row6.projectDetail = { id: "6", rowId: "6", style: "Cinematic Film", sceneCount: 12 };
	localStorage.setItem("ytvs.timeline-editor.v1." + tl6Pid, JSON.stringify({
		version: 3, projectId: tl6Pid, sourcePageId: pageId, sourceRowId: "6", sourceScript: "Keep this scripted row intact.",
		updatedAt: Date.now(), scenes: [], tracks: []
	}));
	cookieJar.cookie = "ytvs_timeline_editor_" + tl6Pid + "_1=" + encodeURIComponent(JSON.stringify({
		v: 1, p: tl6Pid, n: 1, i: 1, t: Date.now(), h: "xyz", d: "{}"
	})) + "; Path=/; SameSite=Lax";

	const scriptInput = w.document.querySelector('[data-batch-row="6"] [data-batch-field="script"]');
	scriptInput.value = "";
	scriptInput.dispatchEvent(new w.Event("input", { bubbles: true }));

	assert.equal(row6.projectDetail, null, "cleared row dropped projectDetail");
	assert.equal(row6.timeline, null, "cleared row dropped timeline");
	assert.equal(row6.stage, "empty", "cleared row returned to empty");
	assert.equal(localStorage.getItem("ytvs.timeline-editor.v1." + tl6Pid), null, "cleared row timeline localStorage deleted");
	assert.equal(cookieJar.names().some((n) => n.includes(tl6Pid)), false, "cleared row timeline cookies deleted");
	const storedAfterClear = JSON.parse(localStorage.getItem("ytvs.pipeline-management.v1." + pageId));
	assert.equal(storedAfterClear.quickBatch.rows.length, 0, "cleared blank row deleted from pipeline localStorage");

	/* Attempting to publish a blank-script timeline edit is rejected and cleans storage. */
	const pubBlank = w.publishTimelineEdit({
		sourcePageId: pageId,
		rowId: "6",
		script: "   ",
		summary: { v: 1, updatedAt: Date.now(), key: "ytvs.timeline-editor.v1." + tl6Pid, pageId: tl6Pid, scenes: [] }
	});
	assert.equal(pubBlank.ok, false);
	assert.match(pubBlank.reason, /blank script/i);

	/* Seed another row with stored projectDetail + timeline cookies and remove it via ✕ removeBatchRow. */
	const row7 = w.addBatchRow({ script: "Row seven will be deleted completely." });
	const tl7Pid = "timeline-" + pageId + "-row-" + row7.id;
	row7.projectDetail = { id: String(row7.id), rowId: String(row7.id), style: "Retro Poster", sceneCount: 12 };
	row7.timelineKey = "ytvs.timeline-editor.v1." + tl7Pid;
	localStorage.setItem("ytvs.timeline-editor.v1." + tl7Pid, JSON.stringify({
		version: 3, projectId: tl7Pid, sourcePageId: pageId, sourceRowId: String(row7.id), sourceScript: row7.script,
		updatedAt: Date.now(), scenes: [], tracks: []
	}));
	cookieJar.cookie = "ytvs_timeline_editor_" + tl7Pid + "_1=" + encodeURIComponent(JSON.stringify({
		v: 1, p: tl7Pid, n: 1, i: 1, t: Date.now(), h: "rm7", d: "{}"
	})) + "; Path=/; SameSite=Lax";
	w.document.querySelector('[data-batch-row="' + row7.id + '"] [data-batch-action="remove"]').click();
	assert.equal(localStorage.getItem("ytvs.timeline-editor.v1." + tl7Pid), null, "removed row timeline localStorage deleted");
	assert.equal(cookieJar.names().some((n) => n.includes(tl7Pid)), false, "removed row timeline cookie deleted");
});

test("Req 1 & 2 & 4: cross-page blank rows purge on startup and live storage reconcile keeps ▶/⚙/✎ and Generate enabled", (t) => {
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();

	/* Pre-seed cross-page pipeline snapshots (both localStorage-backed and cookie-only) with blank-script rows. */
	localStorage.setItem("ytvs.pipeline-management.v1.other_tab", JSON.stringify({
		version: 1, pageId: "other_tab", updatedAt: Date.now() - 2000, layout: "table",
		quickBatch: {
			runBusy: false, queued: [], finishedCount: 0,
			rows: [{ id: "9", vid: "other_tab-row-9", script: "", stage: "ready", projectDetail: { id: "9", style: "Neon Night" } }]
		},
		editor: { projects: [] }
	}));
	const cookieTabSnap = {
		version: 1, pageId: "cookie_tab", updatedAt: Date.now() - 1000, layout: "table",
		quickBatch: {
			runBusy: false, queued: [], finishedCount: 0,
			rows: [{ id: "10", vid: "cookie_tab-row-10", script: "  ", stage: "ready", projectDetail: { id: "10", style: "Cinematic Film" } }]
		},
		editor: { projects: [] }
	};
	/* Write valid digest chunks for cookie_tab using a temporary store instance after boot, or pre-seed localStorage-less cookie via hash helper. */
	const { dom, w } = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=live_pg",
		localStorage,
		sessionStorage,
		cookieJar
	});
	t.after(() => dom.window.close());

	/* Cross-page other_tab had only a blank-script row + projectDetail -> completely deleted! */
	assert.equal(localStorage.getItem("ytvs.pipeline-management.v1.other_tab"), null, "cross-page blank-only snapshot removed");

	/* Now test cookie-only cross-page blank-row cleanup via pipeline store factory. */
	const cookieTabStore = w.__PIPELINE_MANAGEMENT_STORE_FACTORY__(w, "cookie_tab");
	/* Bypass boundedSnapshot blank filter temporarily by writing raw cookie chunks matching store digest. */
	cookieTabStore.save({
		version: 1, pageId: "cookie_tab", updatedAt: Date.now(), layout: "table",
		quickBatch: { runBusy: false, queued: [], finishedCount: 0, rows: [{ id: "10", script: "temp" }] },
		editor: { projects: [] }
	});
	/* Replace raw cookie_tab localStorage with blank-script row and restore live_pg. */
	localStorage.setItem("ytvs.pipeline-management.v1.cookie_tab", JSON.stringify(cookieTabSnap));
	w.restorePipelineManagementState();
	assert.equal(localStorage.getItem("ytvs.pipeline-management.v1.cookie_tab"), null, "cookie_tab blank-only snapshot removed");

	/* Live storage reconcile in an already-open Quick Batch table tab. */
	const row = w.__BATCH_ROWS[0];
	row.script = "Live tab receives a timeline edit.";
	finishRow(w, row);
	assert.equal(w.document.getElementById("batch-generate").disabled, true);

	const pubSummary = {
		v: 1,
		updatedAt: Date.now() + 100,
		key: "ytvs.timeline-editor.v1.timeline-live_pg-row-" + row.id,
		pageId: "timeline-live_pg-row-" + row.id,
		sourcePageId: "live_pg",
		rowId: String(row.id),
		vid: "live_pg-row-" + row.id,
		durationSec: 65,
		sceneCount: 13,
		clipCount: 5,
		textCount: 2,
		videoStyle: "Retro Poster",
		scenes: Array.from({ length: 13 }, (_, idx) => [idx < 12 ? idx : 0, 5, [0, 3, 6, 9].includes(idx) ? 1 : 0]),
		sceneItems: Array.from({ length: 13 }, (_, idx) => ({
			id: "scene-" + (idx + 1), slideId: "media-" + (idx + 1), i: idx < 12 ? idx : 0,
			a: "scene-" + ((idx < 12 ? idx : 0) + 1), n: "Scene " + (idx + 1),
			t: [0, 3, 6, 9].includes(idx) ? 1 : 0, s: idx * 5, d: 5, tr: 0, f: 0, v: 1
		})),
		projectDetail: {
			id: String(row.id), rowId: String(row.id), style: "Retro Poster", effects: ["vhs"],
			effectLabel: "VHS scanlines", durationSec: 65, hasCompletedMedia: true,
			sceneCount: 13, slideCount: 13, clipCount: 5, textCount: 2, graphicCount: 0, elementCount: 2, audioCount: 1
		}
	};
	w.publishTimelineEdit({
		sourcePageId: "live_pg",
		rowId: String(row.id),
		vid: "live_pg-row-" + row.id,
		script: row.script,
		summary: pubSummary
	});
	w.reconcileTimelineEdits();
	assert.equal(row.slides.length, 13);
	assert.equal(row.projectDetail.sceneCount, 13);
	assert.equal(row.projectDetail.style, "Retro Poster");
	const tr = w.document.querySelector('[data-batch-row="' + row.id + '"]');
	assert.equal(tr.querySelector('[data-batch-action="preview"]').disabled, false);
	assert.equal(tr.querySelector('[data-batch-action="export"]').disabled, false);
	assert.equal(tr.querySelector('[data-batch-action="edit"]').disabled, false);
	assert.equal(w.document.getElementById("batch-generate").disabled, false);
});

/*
 * Session 333 — the two faults behind "the link to the quick batch table is not
 * redirected to the layout always" and "the rows are malformed (script was
 * deleted and few chars were only left)".
 */

function activeLayoutOf(w) {
	if (w.document.getElementById("view-table").classList.contains("active")) return "table";
	if (w.document.getElementById("view-editor").classList.contains("active")) return "editor";
	return "none";
}

function narration(w, topic, chars) {
	const beat = "Beat for " + topic + ": the narrator walks the market at dawn and describes the light. ";
	let text = "";
	while (text.length < chars) text += beat;
	return text.slice(0, chars);
}

test("Session 333: the Back link's ?layout=table wins over the layout the page store remembers", async (t) => {
	const pageId = "pg_layout_333";
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();

	/* The table page was last saved in the EDITOR layout. */
	const seed = bootWindow({
		url: "https://studio.test/free?pipelinePage=" + pageId,
		localStorage, sessionStorage, cookieJar
	});
	t.after(() => seed.dom.window.close());
	seed.w.setStudioLayout("editor");
	const row = seed.w.__BATCH_ROWS[0];
	row.script = "A script for the row the timeline was opened from.";
	seed.w.persistPipelineManagementState("seed-editor-layout");
	assert.equal(JSON.parse(localStorage.getItem("ytvs.pipeline-management.v1." + pageId)).layout, "editor");

	/* ← Quick Batch navigates to ?layout=table&pipelinePage=<the table page>. */
	const back = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=" + pageId,
		localStorage, sessionStorage, cookieJar
	});
	t.after(() => back.dom.window.close());
	assert.equal(back.w.requestedStudioLayout(), "table", "the URL's layout request is read");
	assert.equal(activeLayoutOf(back.w), "table", "the page opens on the Quick Batch table, not the stored editor layout");
	assert.ok(back.w.getBatchRow(row.id), "and it is the SAME page's rows, not a fresh page id");

	/* The request is spent on that navigation: it must not fight the user afterwards. */
	back.w.setStudioLayout("editor");
	assert.equal(activeLayoutOf(back.w), "editor", "the layout switch still works");
	back.w.dispatchEvent(new back.w.StorageEvent("storage", { key: "ytvs.pipeline-management.v1." + pageId }));
	assert.equal(activeLayoutOf(back.w), "editor", "a later restore does not yank the user back to the URL's layout");
});

test("Session 333: a long script survives the timeline hand-back and the reload whole", async (t) => {
	const pageId = "pg_script_333";
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();
	const idb = makeMemoryIndexedDB();
	let openedHref = "";

	const table = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=" + pageId,
		localStorage, sessionStorage, cookieJar, indexedDB: idb.factory, loadTimeline: true,
		prepare(w) { w.open = (href) => { openedHref = String(href); return null; }; }
	});
	t.after(() => table.dom.window.close());
	table.w.setStudioLayout("table");
	const row = table.w.__BATCH_ROWS[0];
	row.script = narration(table.w, "market dawn", 1400);
	row.style = "Neon Night";
	finishRow(table.w, row);
	table.w.addBatchRow({ script: narration(table.w, "harbour lights", 1400), style: "Neon Night" });
	table.w.renderBatchTable();
	table.w.persistPipelineManagementState("seed-long-scripts");

	const seeded = JSON.parse(localStorage.getItem("ytvs.pipeline-management.v1." + pageId));
	assert.deepEqual(
		seeded.quickBatch.rows.map((stored) => stored.script.length),
		[1400, 1400],
		"localStorage keeps the whole script before any edit"
	);

	table.w.document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-action="edit"]').click();
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.match(openedHref, /layout=timeline/);

	const tl = bootWindow({
		url: "https://studio.test" + openedHref,
		localStorage, sessionStorage, cookieJar, indexedDB: idb.factory, loadTimeline: true
	});
	t.after(() => tl.dom.window.close());
	await new Promise((resolve) => setTimeout(resolve, 30));
	const api = tl.w.__TIMELINE_EDITOR__;
	const media = tl.w.__TIMELINE_EDITOR_STATE__.tracks.find((track) => track.id === "background-media");
	api.setItemTiming(media.items[0].id, 0, 8.5);
	api.addTextElement("Morning Harvest");
	assert.equal(api.save(), true);
	tl.w.document.getElementById("timeline-back").click();
	assert.equal(tl.w.__TIMELINE_EDIT_PUBLISH__.ok, true, JSON.stringify(tl.w.__TIMELINE_EDIT_PUBLISH__));

	/* The hand-back is a summary: it must not carry the project a second time. */
	const published = JSON.parse(localStorage.getItem("ytvs.pipeline-management.v1." + pageId));
	const publishedRow = published.quickBatch.rows.find((stored) => String(stored.id) === String(row.id));
	assert.equal(publishedRow.timeline.visuals, undefined, "the mirror keeps no text/graphic list");
	assert.equal(publishedRow.timeline.audios, undefined, "the mirror keeps no audio list");
	assert.equal(publishedRow.timeline.projectDetail, undefined, "the mirror keeps no project detail");
	assert.equal(publishedRow.timeline.scenes.length, 12, "but it keeps the scene order and lengths");
	assert.deepEqual(
		published.quickBatch.rows.map((stored) => stored.script.length),
		[1400, 1400],
		"the edit did not cost either row its script"
	);
	for (let index = 1; index <= 4; index++) {
		const name = "ytvs_pipeline_management_" + pageId + "_" + index;
		const part = cookieJar.cookie.split("; ").find((entry) => entry.startsWith(name + "="));
		assert.ok(part, "cookie chunk " + index + " was written");
		assert.ok(part.length <= 3800, "cookie chunk " + index + " is inside the browser limit");
	}

	/* The reload the Back link performs. */
	const returned = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=" + pageId,
		localStorage, sessionStorage, cookieJar, indexedDB: idb.factory, loadTimeline: true
	});
	t.after(() => returned.dom.window.close());
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(activeLayoutOf(returned.w), "table", "the reload lands on the Quick Batch table");
	const returnedRow = returned.w.getBatchRow(row.id);
	assert.ok(returnedRow, "the edited row is back");
	assert.equal(returnedRow.script.length, 1400, "the script came back whole, not a few characters");
	assert.equal(returnedRow.script, row.script, "and it is the same text");
	assert.equal(returnedRow.timelineEdited, true, "the timeline edit came back with it");
	assert.equal(returnedRow.slides.length, 12, "its slides were composed from the edit");
	const scriptCell = returned.w.document.querySelector('[data-batch-row="' + returnedRow.id + '"] [data-batch-field="script"]');
	assert.equal(scriptCell.value.length, 1400, "the row's script box shows the whole script");
});

test("Session 333: when the snapshot outgrows four cookies the mirror sheds weight, never a script", (t) => {
	const pageId = "pg_mirror_333";
	const localStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();
	const { dom, w } = bootWindow({
		url: "https://studio.test/free?layout=table&pipelinePage=" + pageId,
		localStorage, cookieJar
	});
	t.after(() => dom.window.close());

	const store = w.__PIPELINE_MANAGEMENT_STORE_FACTORY__(w, pageId);
	const rows = Array.from({ length: 8 }, (_, index) => {
		const id = String(index + 1);
		const slideItems = Array.from({ length: 12 }, (_, scene) => ({
			id: "batch-" + id + "-img-" + scene, slideId: "batch-" + id + "-img-" + scene, i: scene,
			a: "scene-" + (scene + 1), n: "Scene " + (scene + 1) + " of a finished video",
			m: "pixabay-media-file-" + scene + ".jpg", src: "pixabay",
			t: scene % 3 === 0 ? 1 : 0, s: scene * 5, d: 5, tr: 0, f: 0, v: 1
		}));
		return {
			id, vid: pageId + "-row-" + id, script: narration(w, "row " + id, 2550), stage: "done",
			style: "Neon Night", mp3: true, animated: true, finished: true, images: 12, slides: 12,
			slideItems,
			projectDetail: {
				id, rowId: id, style: "Neon Night", sceneCount: 12, slideCount: 12, hasCompletedMedia: true,
				scenes: Array.from({ length: 12 }, (_, scene) => ({ id: "scene-" + (scene + 1), index: scene, name: "Scene " + (scene + 1), durationSec: 5, effects: ["grain", "vignette"] }))
			},
			timeline: {
				v: 1, updatedAt: Date.now(), key: "ytvs.timeline-editor.v1.timeline-" + pageId + "-row-" + id,
				pageId: "timeline-" + pageId + "-row-" + id, sourcePageId: pageId, rowId: id,
				durationSec: 60, sceneCount: 12, clipCount: 4, textCount: 1, videoStyle: "Neon Night",
				scenes: Array.from({ length: 12 }, (_, scene) => [scene, 5, scene % 3 === 0 ? 1 : 0]),
				sceneItems: slideItems,
				visuals: [{ id: "text-1", k: "t", trId: "text-1", scId: "scene-1", s: 0, d: 4, tx: "Morning Harvest", v: 1 }],
				audios: [{ id: "audio-1", trId: "soundtrack", a: "voiceover", n: "Row voiceover", s: 0, d: 60, vol: 1, m: 0 }],
				projectDetail: { id, rowId: id, style: "Neon Night", sceneCount: 12 }
			}
		};
	});

	const saved = store.save({
		version: 1, pageId, updatedAt: Date.now(), layout: "table",
		quickBatch: { runBusy: false, queued: [], finishedCount: 8, rows },
		editor: { projects: [] }
	});
	assert.equal(saved.ok, true, JSON.stringify(saved));
	assert.equal(saved.cookies, 4, "all four chunks were written");
	assert.equal(saved.timestampMatched, true, "both tiers verified");
	assert.equal(saved.mirrorReduced, true, "the snapshot was bigger than the cookie budget");

	const local = JSON.parse(localStorage.getItem(store.localStorageKey));
	assert.deepEqual(
		local.quickBatch.rows.map((stored) => stored.script.length),
		rows.map((row) => row.script.length),
		"localStorage kept all eight scripts in full"
	);

	const chunks = [];
	for (let index = 1; index <= 4; index++) {
		const name = store.cookieNames[index - 1];
		const part = cookieJar.cookie.split("; ").find((entry) => entry.startsWith(name + "="));
		assert.ok(part, "chunk " + index + " exists");
		assert.ok(part.length <= 3800, "chunk " + index + " is inside the browser limit");
		chunks.push(JSON.parse(decodeURIComponent(part.slice(name.length + 1))));
	}
	chunks.sort((a, b) => a.i - b.i);
	const mirror = JSON.parse(chunks.map((chunk) => chunk.d).join(""));
	assert.equal(mirror.quickBatch.rows.length, 8, "the mirror still lists every row");
	const mirrorScripts = mirror.quickBatch.rows.map((stored) => stored.script.length);
	assert.ok(
		mirrorScripts.every((length) => length >= store.cookieScriptFloor),
		"no script was cut below the floor: " + JSON.stringify(mirrorScripts)
	);
	assert.ok(
		mirror.quickBatch.rows.every((stored) => Array.isArray(stored.timeline.scenes) && stored.timeline.scenes.length === 12),
		"every row kept its edited scene order and lengths"
	);

	/* A reload with no localStorage at all still finds eight whole rows. */
	localStorage.removeItem(store.localStorageKey);
	const loaded = store.load();
	assert.equal(loaded.source, "cookies");
	assert.equal(loaded.debug.partial, true, "and it says the mirror had to shed weight");
	assert.equal(loaded.snapshot.quickBatch.rows.length, 8);
	assert.ok(
		loaded.snapshot.quickBatch.rows.every((stored) => String(stored.script || "").length >= store.cookieScriptFloor),
		"a cookie-only reload never shows a row with a shredded script"
	);
});

test("Session 333: the hand-back finds its table page from the timeline page id alone", async (t) => {
	const pageId = "pg_derived_333";
	const localStorage = makeMemoryStorage();
	const sessionStorage = makeMemoryStorage();
	const cookieJar = makeCookieJar();

	/*
	 * A timeline tab that lost both the handoff payload and its saved project:
	 * state.sourcePageId is empty, and only the page id still knows the way back.
	 */
	const tl = bootWindow({
		url: "https://studio.test/free?layout=timeline&pipelinePage=timeline-" + pageId + "-row-2",
		localStorage, sessionStorage, cookieJar, loadTimeline: true
	});
	t.after(() => tl.dom.window.close());
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(tl.w.__TIMELINE_EDITOR_STATE__.sourcePageId, "", "the saved project carries no source page");

	const tableStore = tl.w.__PIPELINE_MANAGEMENT_STORE_FACTORY__(tl.w, pageId);
	const seedSave = tableStore.save({
		version: 1, pageId, updatedAt: Date.now(), layout: "table",
		quickBatch: {
			runBusy: false, queued: [], finishedCount: 0,
			rows: [{ id: "2", vid: pageId + "-row-2", script: "The row this timeline was opened from.", stage: "ready" }]
		},
		editor: { projects: [] }
	});
	assert.equal(seedSave.ok, true, JSON.stringify(seedSave));

	tl.w.document.getElementById("timeline-back").click();
	const publish = tl.w.__TIMELINE_EDIT_PUBLISH__;
	assert.ok(publish, "the Back button published");
	assert.equal(publish.ok, true, JSON.stringify(publish));
	assert.equal(publish.pageId, pageId, "the edit landed in the TABLE page's store");
	assert.equal(publish.rows, 1, "into the row that was already there, not a new one");

	const stored = JSON.parse(localStorage.getItem("ytvs.pipeline-management.v1." + pageId));
	assert.equal(stored.quickBatch.rows.length, 1);
	assert.ok(stored.quickBatch.rows[0].timeline, "the row carries the edit");
	assert.equal(stored.quickBatch.rows[0].script, "The row this timeline was opened from.", "and keeps its script");
	/* Realm note: an object built inside the JSDOM window has that realm's prototype. */
	const derived = tl.w.splitTimelinePageId("timeline-" + pageId + "-row-2");
	assert.equal(derived.pageId, pageId, "the table page id is read back out of the timeline page id");
	assert.equal(derived.rowId, "2", "and so is the row id");
});
