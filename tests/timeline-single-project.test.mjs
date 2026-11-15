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
							let pending=0, aborted=false;
							const tx = {
								abort() { aborted=true; setTimeout(()=>tx.onabort?.(),0); },
								objectStore() {
									function request(run) {
										const r={}; pending++;
										setTimeout(()=>{ if (!aborted) { run(r); r.onsuccess?.({target:r}); } pending--; if (!pending && !aborted) tx.oncomplete?.(); },0);
										return r;
									}
									return {
										get(key) { return request(r=>{r.result=records.get(String(key))||null;}); },
										put(record) { return request(()=>records.set(String(record.id),record)); },
										delete(key) { return request(()=>records.delete(String(key))); }
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


function testLocks() {
 const queues=new Map(), busy=new Map();
 return {query(){return Promise.resolve({held:Array.from(busy.keys(),name=>({name})),pending:[]});},request(name,options,fn){if(typeof options==='function'){fn=options;options={};} if(options && options.ifAvailable && busy.get(name))return Promise.resolve().then(()=>fn(null)); busy.set(name,(busy.get(name)||0)+1);const result=(queues.get(name)||Promise.resolve()).catch(()=>{}).then(()=>fn({name}));queues.set(name,result.finally(()=>{const n=busy.get(name)-1;if(n)busy.set(name,n);else busy.delete(name);}).catch(()=>{}));return result;}};
}
async function waitUntil(fn) {
	for (let i=0;i<150;i++) { if (fn()) return; await new Promise(r=>setTimeout(r,20)); }
	throw new Error('timed out waiting for editor');
}

test('single project is created once and the newest editor takes over after autosave', async t => {
	const storage = makeMemoryStorage(), cookies=makeCookieJar(), idb=makeMemoryIndexedDB(), locks=testLocks();
	const peers=[]; const oldSet=storage.setItem;
	storage.setItem=(key,value)=>{oldSet(key,value); for (const w of peers) setTimeout(()=>w.dispatchEvent(new w.StorageEvent('storage',{key:String(key)})),0);};
	let hrefs=[]; const prepare=w=>Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});
	const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=single',localStorage:storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){prepare(w);w.open=()=>({location:{replace(href){hrefs.push(href);}},close(){}});}});
	t.after(()=>table.dom.window.close()); table.w.setStudioLayout('table');
	const row=table.w.__BATCH_ROWS[0]; row.script='This project has enough words for a reliable single project test.';finishRow(table.w,row);
	const click=()=>table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();
	click(); await waitUntil(()=>hrefs.length===1);
	const key=row.timelineKey; assert.ok(storage.getItem(key));
	const a=bootWindow({url:'https://studio.test'+hrefs[0],localStorage:storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare}); peers.push(a.w);
	t.after(()=>{peers.splice(peers.indexOf(a.w),1);a.dom.window.close();});
	await waitUntil(()=>a.w.__TIMELINE_EDITOR_STATE__);
	a.w.__TIMELINE_EDITOR__.addTextElement('first tab unique text');
	click(); await waitUntil(()=>hrefs.length===2);
	const b=bootWindow({url:'https://studio.test'+hrefs[1],localStorage:storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare}); peers.push(b.w);
	t.after(()=>{peers.splice(peers.indexOf(b.w),1);b.dom.window.close();});
	await waitUntil(()=>b.w.__TIMELINE_EDITOR_STATE__);
	assert.ok(JSON.stringify(b.w.__TIMELINE_EDITOR_STATE__).includes('first tab unique text'));
	const saved=storage.getItem(key);
	a.w.__TIMELINE_EDITOR__.addTextElement('stale tab text');
	assert.equal(a.w.__TIMELINE_EDITOR__.save(),false);
	assert.equal(storage.getItem(key),saved);
	assert.match(a.w.__TIMELINE_EDITOR_SAVE__.reason,/stale editor/);
	b.w.__TIMELINE_EDITOR__.addTextElement('latest tab text');
	assert.equal(b.w.__TIMELINE_EDITOR__.save(),true);
	assert.ok(storage.getItem(key).includes('latest tab text'));
});

test('saved empty lanes stay empty and a newer lossy cookie does not replace local state', t => {
	const storage = makeMemoryStorage(); const cookies = makeCookieJar(); const idb = makeMemoryIndexedDB();
	const page = 'timeline-source-row-9', key = 'ytvs.timeline-editor.v1.'+page;
	const full = {version:3,projectId:page,updatedAt:10,frame:{width:1280,height:720},scenes:[],subtitles:[],tracks:[{id:'background-media',kind:'media',items:[]},{id:'visual-1',kind:'visual',items:[]}]};
	storage.setItem(key, JSON.stringify(full));
	const cookieState = {...full,updatedAt:1000,subtitles:[{startMs:0,endMs:1000,text:'stale cue'}]};
	const text = JSON.stringify(cookieState); let hash=2166136261;
	for (let i=0;i<text.length;i++) { hash^=text.charCodeAt(i); hash=(hash*16777619)>>>0; }
	cookies.cookie = 'ytvs_timeline_editor_'+page+'_1='+encodeURIComponent(JSON.stringify({v:1,p:page,n:1,i:1,t:1000,h:hash.toString(36),d:text}));
	const tl=bootWindow({url:'https://studio.test/free?layout=timeline&pipelinePage='+page,localStorage:storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true});
	t.after(()=>tl.dom.window.close());
	const state=tl.w.__TIMELINE_EDITOR_STATE__;
	assert.equal(state.scenes.length,0);
	assert.equal(state.subtitles.length,0);
	assert.equal(state.tracks.find(track=>track.kind==='visual').items.length,0);
	assert.equal(JSON.parse(storage.getItem(key)).updatedAt,10, 'opening does not persist normalization');
});

test('eight-part cookie snapshots round trip and reject a damaged part', async t => {
	const storage = makeMemoryStorage(); const cookies = makeCookieJar();
	const page='cookieparts', locks=testLocks();
	const tl=bootWindow({url:'https://studio.test/free?layout=timeline&pipelinePage='+page,localStorage:storage,cookieJar:cookies,loadTimeline:true,prepare(w){Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});}});
	t.after(()=>tl.dom.window.close());
	await waitUntil(()=>tl.w.__TIMELINE_EDITOR_STATE__);
	tl.w.__TIMELINE_EDITOR_STATE__.extraMetadata = 'abcdefghij'.repeat(750);
	tl.w.__TIMELINE_EDITOR__.addTextElement('long backup');
	assert.equal(tl.w.__TIMELINE_EDITOR__.save(),true);
	const names=cookies.names().filter(name=>name.startsWith('ytvs_timeline_editor_'+page+'_'));
	assert.ok(names.length===8, `got ${names.length} parts: ${cookies.names()} save=${JSON.stringify(tl.w.__TIMELINE_EDITOR_SAVE__)}`);
	const persisted=storage.getItem('ytvs.timeline-editor.v1.'+page);
	storage.removeItem('ytvs.timeline-editor.v1.'+page);
	assert.ok(tl.w.__TIMELINE_EDITOR__.loadPersistedState());
	const first=names[0];
	const entry=cookies.cookie.split('; ').find(value=>value.startsWith(first+'='));
	const meta=JSON.parse(decodeURIComponent(entry.slice(first.length+1))); meta.d += 'x';
	cookies.cookie=first+'='+encodeURIComponent(JSON.stringify(meta));
	assert.equal(tl.w.__TIMELINE_EDITOR__.loadPersistedState(),null);
	storage.setItem('ytvs.timeline-editor.v1.'+page, persisted);
	tl.w.__TIMELINE_EDITOR_STATE__.extraMetadata = 'z'.repeat(100000);
	assert.equal(tl.w.__TIMELINE_EDITOR__.save(), true, 'full project remains saved despite cookie overflow');
	assert.equal(tl.w.__TIMELINE_EDITOR_SAVE__.cookies,0);
	assert.equal(cookies.names().filter(name=>name.startsWith('ytvs_timeline_editor_'+page+'_')).length,0, 'old incomplete mirror is cleared');
});


test('removing a row does not remove another page with the same row id', t => {
	const storage=makeMemoryStorage(); const cookies=makeCookieJar();
	const w1=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=pageA',localStorage:storage,cookieJar:cookies});
	t.after(()=>w1.dom.window.close()); w1.w.setStudioLayout('table');
	const row=w1.w.__BATCH_ROWS[0]; row.script='This is enough script for the row that should be removed.';
	const other='ytvs.timeline-editor.v1.timeline-pageB-row-'+row.id;
	storage.setItem(other,JSON.stringify({projectId:'timeline-pageB-row-'+row.id,sourcePageId:'pageB',sourceRowId:String(row.id),sourceScript:'other script',tracks:[]}));
	w1.w.removeBatchRow(row.id);
	assert.ok(storage.getItem(other), 'another page remains untouched');
});

test('short ready scripts retain the ten-word validation message', t => {
	const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=words'});
	t.after(()=>table.dom.window.close()); table.w.setStudioLayout('table');
	const row=table.w.__BATCH_ROWS[0]; row.script='only three words'; row.stage='ready'; table.w.renderBatchTable();
	table.w.document.getElementById('batch-generate').click();
	const message=table.w.document.getElementById('required-modal-list').textContent;
	assert.match(message,/less than 10 words/);
	assert.match(message,/currently 3 words/);
});

test('voiceover regeneration keeps the main composition and does not rerun scene search', async t => {
	const storage=makeMemoryStorage(), cookies=makeCookieJar(), idb=makeMemoryIndexedDB(), locks=testLocks(); let href='';
	const prepare=w=>Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});
	const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=regenone',localStorage:storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w) {prepare(w);w.open = () => ({location:{replace(x){href=String(x);}},close(){}});}});
	t.after(()=>table.dom.window.close()); table.w.setStudioLayout('table');
	const row=table.w.__BATCH_ROWS[0]; row.script='This longer narration has enough words for regenerating the voiceover safely.';
	finishRow(table.w,row);
	table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();
	await waitUntil(()=>href);
	const tl=bootWindow({url:'https://studio.test'+href,localStorage:storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});
	t.after(()=>tl.dom.window.close());
	await waitUntil(()=>tl.w.__TIMELINE_EDITOR_STATE__);
	tl.w.__TIMELINE_EDITOR__.addTextElement('keep this edited graphic text');
	tl.w.__TIMELINE_EDITOR__.save();
	const key=row.timelineKey, before=storage.getItem(key);
	mockBatchGenerationRoutes(table.w);
	const fetch=table.w.fetch; let imageRequests=0;
	table.w.fetch=async (...args)=>{if (String(args[0]).includes('/api/image')) imageRequests++; return fetch(...args);};
	// jsdom does not emit pagehide when its window.close() is called.
	tl.w.dispatchEvent(new tl.w.Event('pagehide'));
	// Publish the saved project into the live table before regenerating.
	tl.w.document.getElementById('timeline-back').click();
	await waitUntil(()=>!JSON.parse(storage.getItem('ytvs.timeline-edit-session.v1.timeline-regenone-row-'+row.id)).owner);
	table.w.reconcileTimelineEdits();
	assert.equal(table.w.batchRowReadyForGeneration(row),true);
	await table.w.generateBatchRows();
	assert.equal(imageRequests,0);
	assert.equal(storage.getItem(key),before);
	assert.ok(JSON.stringify(row.timeline).includes('keep this edited graphic text'));
	assert.equal(row.slides.length,12);
	assert.equal(table.w.batchRowReadyForGeneration(row),false);
});

test('invalid stored timeline cannot be overwritten by opening or saving', t => {
	const storage=makeMemoryStorage(); const page='broken-project', key='ytvs.timeline-editor.v1.'+page;
	storage.setItem(key,'{not-json');
	const tl=bootWindow({url:'https://studio.test/free?layout=timeline&pipelinePage='+page,localStorage:storage,loadTimeline:true});
	t.after(()=>tl.dom.window.close());
	assert.equal(storage.getItem(key),'{not-json');
	tl.w.__TIMELINE_EDITOR__.addTextElement('do not replace the original');
	assert.equal(tl.w.__TIMELINE_EDITOR__.save(),false);
	assert.equal(storage.getItem(key),'{not-json');
});

test('Quick Batch rejects damaged per-project cookies instead of promoting them', t => {
	const storage=makeMemoryStorage(), cookies=makeCookieJar(); let href='';
	const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=damaged',localStorage:storage,cookieJar:cookies,loadTimeline:true,prepare(w) {w.open=x=>{href=String(x);};}});
	t.after(()=>table.dom.window.close()); table.w.setStudioLayout('table');
	const row=table.w.__BATCH_ROWS[0]; row.script='This script contains enough words to edit a completed row safely.'; finishRow(table.w,row);
	const page='timeline-damaged-row-'+row.id;
	const payload=JSON.stringify({projectId:page,updatedAt:999,tracks:[{id:'fake',kind:'visual',items:[]}],scenes:[]});
	cookies.cookie='ytvs_timeline_editor_'+page+'_1='+encodeURIComponent(JSON.stringify({v:1,p:page,n:1,i:1,t:999,h:'bad-digest',d:payload}));
	table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();
	assert.equal(href,'', 'damaged backup must not be silently replaced');
	assert.equal(storage.getItem('ytvs.timeline-editor.v1.'+page),null);
	assert.match(table.w.document.getElementById('required-modal-list').textContent,/could not be saved or read/);
});

test('asset handoff fills missing media without replacing editor-owned asset ids', async t => {
	const idb=makeMemoryIndexedDB();
	const locks=testLocks();
	const tab=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=assets',indexedDB:idb.factory,loadTimeline:true,prepare(w){Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});}});
	t.after(()=>tab.dom.window.close());
	const api=tab.w.__TIMELINE_EDITOR__, original=new tab.w.Blob(['editor']), stale=new tab.w.Blob(['row']);
	await api.storeProjectAssets('asset-project',{voiceover:original,assets:[{id:'scene-1',blob:original}]});
	await new Promise(r=>setTimeout(r,20));
	await api.storeProjectAssets('asset-project',{preserveExisting:true,voiceover:stale,assets:[{id:'scene-1',blob:stale},{id:'scene-2',blob:stale}]});
	await new Promise(r=>setTimeout(r,20));
	const record=idb.records.get('asset-project');
	assert.equal(record.assets['scene-1'].blob,original);
	assert.equal(record.voiceover,original);
	assert.equal(record.assets['scene-2'].blob,stale);
});

test('a failed main project write blocks the handoff instead of opening a disposable project', t => {
	const storage=makeMemoryStorage(); const set=storage.setItem;
	storage.setItem=(key,value)=>{ if (String(key).startsWith('ytvs.timeline-editor.v1.')) throw new Error('quota exceeded'); set(key,value); };
	let opened=false;
	const tab=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=quota',localStorage:storage,loadTimeline:true,prepare(w){w.open=()=>{opened=true;};}});
	t.after(()=>tab.dom.window.close()); tab.w.setStudioLayout('table');
	const row=tab.w.__BATCH_ROWS[0]; row.script='This script has enough words for a saved timeline project test.'; finishRow(tab.w,row);
	tab.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();
	assert.equal(opened,false);
	assert.match(tab.w.document.getElementById('required-modal-list').textContent,/could not be saved or read/);
});

test('direct editor route does not replace an incomplete cookie-only backup', t => {
	const storage=makeMemoryStorage(), cookies=makeCookieJar(), page='incomplete';
	cookies.cookie='ytvs_timeline_editor_'+page+'_1='+encodeURIComponent(JSON.stringify({v:1,p:page,n:2,i:1,t:10,h:'x',d:'partial'}));
	const tl=bootWindow({url:'https://studio.test/free?layout=timeline&pipelinePage='+page,localStorage:storage,cookieJar:cookies,loadTimeline:true});
	t.after(()=>tl.dom.window.close());
	assert.equal(storage.getItem('ytvs.timeline-editor.v1.'+page),null);
	assert.equal(tl.w.__TIMELINE_EDITOR__.save(),false);
	assert.ok(cookies.names().includes('ytvs_timeline_editor_'+page+'_1'));
});
