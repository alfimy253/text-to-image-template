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
	w.__PIPELINE_RETRY_SPEED = 20000;
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


function lockManager() {
 const queues = new Map(), busy = new Map();
 return { query() { return Promise.resolve({held:Array.from(busy.keys(),name=>({name})),pending:[]}); }, request(name, options, cb) {
   if (typeof options === 'function') { cb=options; options={}; }
   if (options && options.ifAvailable && busy.get(name)) return Promise.resolve().then(()=>cb(null));
   busy.set(name,(busy.get(name)||0)+1);
   const result=(queues.get(name)||Promise.resolve()).catch(()=>{}).then(()=>cb({name}));
   const tail=result.finally(()=>{const n=busy.get(name)-1;if(n)busy.set(name,n);else busy.delete(name);}).catch(()=>{});
   queues.set(name,tail);return result;
 }};
}
function sharedStorageWithEvents() {
 const base=makeMemoryStorage(), windows=new Set();
 const set=base.setItem, remove=base.removeItem;
 function broadcast(key) { for (const w of windows) setTimeout(()=>{ try { w.dispatchEvent(new w.StorageEvent('storage',{key})); } catch {} },0); }
 base.setItem=(key,value)=>{set(key,value);broadcast(String(key));};
 base.removeItem=key=>{remove(key);broadcast(String(key));};
 return {storage:base, windows};
}
async function until(predicate, message) {
 for (let i=0;i<150;i++) { const value=predicate(); if (value) return value; await new Promise(r=>setTimeout(r,20)); }
 throw new Error(message || 'condition timed out');
}


async function setupReviewCase(t, id) {
 const shared=sharedStorageWithEvents(),cookies=makeCookieJar(),locks=lockManager(),idb=makeMemoryIndexedDB(); let hrefs=[],failNavigation=false;
 const prepare=w=>{shared.windows.add(w);Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});};
 const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage='+id,localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){prepare(w);w.open=()=>({location:{replace(x){if(failNavigation)throw Error('navigation failure');hrefs.push(x);}},close(){}});}});
 t.after(()=>{shared.windows.delete(table.w);table.dom.window.close();});table.w.setStudioLayout('table');const row=table.w.__BATCH_ROWS[0];row.script='This is enough words for a test of safe editor handoff and media.';finishRow(table.w,row);
 const click=()=>table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();click();await until(()=>hrefs.length===1);
 const old=bootWindow({url:'https://studio.test'+hrefs[0],localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});t.after(()=>{shared.windows.delete(old.w);old.dom.window.close();});await until(()=>old.w.__TIMELINE_EDITOR_STATE__);
 return {shared,cookies,locks,idb,table,row,click,old,hrefs,prepare,failNav(){failNavigation=true;},page:'timeline-'+id+'-row-'+row.id};
}

test('failed popup navigation does not take control away from the existing editor',async t=>{
 const x=await setupReviewCase(t,'navfail');x.failNav();x.click();await until(()=>/could not be opened/.test(x.table.w.document.getElementById('required-modal-list').textContent));
 assert.equal(x.old.w.__TIMELINE_EDITOR__.save(),true);
 const record=JSON.parse(x.shared.storage.getItem('ytvs.timeline-edit-session.v1.'+x.page));assert.equal(record.candidate,'');assert.ok(record.owner);
});

test('a popup not yet ready does not make the existing editor read-only',async t=>{
 const x=await setupReviewCase(t,'notready');x.click();await until(()=>x.hrefs.length===2);
 await new Promise(r=>setTimeout(r,100));assert.equal(x.old.w.__TIMELINE_EDITOR__.save(),true);
 assert.equal(JSON.parse(x.shared.storage.getItem('ytvs.timeline-edit-session.v1.'+x.page)).candidateCount,2);
});

test('successful retry of failed media permits safe handoff',async t=>{
 const x=await setupReviewCase(t,'retryasset');Object.defineProperty(x.old.w,'indexedDB',{configurable:true,value:null});
 assert.equal((await x.old.w.__TIMELINE_EDITOR__.storeProjectAssets(x.page,{voiceover:new x.old.w.Blob(['replacement'])})).ok,false);
 Object.defineProperty(x.old.w,'indexedDB',{configurable:true,value:x.idb.factory});
 x.click();await until(()=>x.hrefs.length===2);
 const next=bootWindow({url:'https://studio.test'+x.hrefs[1],localStorage:x.shared.storage,cookieJar:x.cookies,indexedDB:x.idb.factory,loadTimeline:true,prepare:x.prepare});t.after(()=>{x.shared.windows.delete(next.w);next.dom.window.close();});
 await until(()=>next.w.__TIMELINE_EDITOR_STATE__,'failed media retry prevented takeover');
 assert.ok(x.idb.records.get(x.page).voiceover);
});

test('a queued editor cannot open after its project is deleted',async t=>{
 const x=await setupReviewCase(t,'queueddelete');const modal=x.old.w.document.createElement('div');modal.id='tpl-modal';modal.style.display='flex';x.old.w.document.body.appendChild(modal);
 x.click();await until(()=>x.hrefs.length===2);
 const next=bootWindow({url:'https://studio.test'+x.hrefs[1],localStorage:x.shared.storage,cookieJar:x.cookies,indexedDB:x.idb.factory,loadTimeline:true,prepare:x.prepare});t.after(()=>{x.shared.windows.delete(next.w);next.dom.window.close();});
 await until(()=>/Finish or close/.test(x.old.w.document.getElementById('timeline-session-warning').textContent));x.table.w.removeBatchRow(x.row.id);
 await until(()=>/deleted/.test(next.w.document.getElementById('timeline-session-warning').textContent));assert.equal(next.w.__TIMELINE_EDITOR_STATE__,undefined);
});

test('Quick Batch cannot change project media while an editor owns it',async t=>{
 const x=await setupReviewCase(t,'medialock');const ownerBlob=new x.old.w.Blob(['owner']);
 assert.equal((await x.old.w.__TIMELINE_EDITOR__.storeProjectAssets(x.page,{voiceover:ownerBlob})).ok,true);
 const tableBlob=new x.table.w.Blob(['table']);const result=await x.table.w.__TIMELINE_EDITOR__.storeProjectAssets(x.page,{voiceover:tableBlob});
 assert.equal(result.ok,false);assert.match(result.reason,/Close the timeline editor/);assert.equal((await x.table.w.__TIMELINE_EDITOR__.readProjectAssets(x.page)).voiceover,ownerBlob);
 assert.equal(x.table.w.batchRowReadyForGeneration(x.row),false);
 x.old.w.dispatchEvent(new x.old.w.Event('pagehide'));
 x.old.w.document.getElementById('timeline-back').click();await until(()=>!JSON.parse(x.shared.storage.getItem('ytvs.timeline-edit-session.v1.'+x.page)).owner);
 await new Promise(r=>setTimeout(r,20));const after=await x.table.w.__TIMELINE_EDITOR__.storeProjectAssets(x.page,{voiceover:tableBlob});assert.equal(after.ok,true);
});

test('Quick Batch media remains blocked while a stale editor tab is still open',async t=>{
 const x=await setupReviewCase(t,'staleopen');x.click();await until(()=>x.hrefs.length===2);
 const next=bootWindow({url:'https://studio.test'+x.hrefs[1],localStorage:x.shared.storage,cookieJar:x.cookies,indexedDB:x.idb.factory,loadTimeline:true,prepare:x.prepare});t.after(()=>{x.shared.windows.delete(next.w);next.dom.window.close();});await until(()=>next.w.__TIMELINE_EDITOR_STATE__);
 assert.match(x.old.w.document.getElementById('timeline-session-warning').textContent,/read-only/);
 next.w.dispatchEvent(new next.w.Event('pagehide'));next.w.document.getElementById('timeline-back').click();
 await until(()=>!JSON.parse(x.shared.storage.getItem('ytvs.timeline-edit-session.v1.'+x.page)).owner);
 const transfer={voiceover:new x.table.w.Blob(['table'])};let result=await x.table.w.__TIMELINE_EDITOR__.storeProjectAssets(x.page,transfer);assert.equal(result.ok,false);assert.match(result.reason,/Close all timeline/);
 x.old.w.dispatchEvent(new x.old.w.Event('pagehide'));await new Promise(r=>setTimeout(r,20));result=await x.table.w.__TIMELINE_EDITOR__.storeProjectAssets(x.page,transfer);assert.equal(result.ok,true);
});
