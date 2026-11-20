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

test('newest click waits for autosave, preserves detail cookies, and makes older tab read only', async t => {
 const shared=sharedStorageWithEvents(), cookies=makeCookieJar(), locks=lockManager(), idb=makeMemoryIndexedDB();
 let opened=[];
 function prepare(w) { shared.windows.add(w); Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks}); }
 const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=authority',localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w) {
   prepare(w); w.open=()=>({location:{replace(href){opened.push(href);}},close(){}});
 }});
 t.after(()=>{shared.windows.delete(table.w);table.dom.window.close();});
 table.w.setStudioLayout('table'); const row=table.w.__BATCH_ROWS[0];
 row.script='This is a sufficiently long script to safely exercise editor ownership.'; finishRow(table.w,row);
 const edit=()=>table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();
 edit(); await until(()=>opened.length===1,'first edit did not open');
 const page='timeline-authority-row-'+row.id;
 const one=bootWindow({url:'https://studio.test'+opened[0],localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});
 t.after(()=>{shared.windows.delete(one.w);one.dom.window.close();});
 await until(()=>one.w.__TIMELINE_EDITOR_STATE__,'first editor did not start');
 one.w.__TIMELINE_EDITOR__.addTextElement('pending autosaved text');
 // Click before the 180 ms debounce fires: the handoff must flush it.
 edit(); await until(()=>opened.length===2,'second edit did not open');
 const two=bootWindow({url:'https://studio.test'+opened[1],localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});
 t.after(()=>{shared.windows.delete(two.w);two.dom.window.close();});
 await until(()=>two.w.__TIMELINE_EDITOR_STATE__,'second editor did not receive control');
 assert.ok(JSON.stringify(two.w.__TIMELINE_EDITOR_STATE__).includes('pending autosaved text'));
 assert.match(one.w.document.getElementById('timeline-session-warning').textContent,/read-only/);
 const key='ytvs.timeline-editor.v1.'+page, saved=shared.storage.getItem(key);
 one.w.__TIMELINE_EDITOR__.addTextElement('stale attempt');
 assert.equal(one.w.__TIMELINE_EDITOR__.save(),false);
 assert.equal(shared.storage.getItem(key),saved);
 two.w.__TIMELINE_EDITOR__.addTextElement('newest edit');
 assert.equal(two.w.__TIMELINE_EDITOR__.save(),true);
 assert.ok(shared.storage.getItem(key).includes('newest edit'));
 const counterName='ytvs_timeline_edit_counter_'+page;
 const counter=cookies.cookie.split('; ').find(x=>x.startsWith(counterName+'='));
 assert.equal(JSON.parse(decodeURIComponent(counter.slice(counterName.length+1))).count,2);
 const prefix='ytvs_timeline_editor_'+page+'_';
 const parts=cookies.cookie.split('; ').filter(x=>x.startsWith(prefix)).map(x=>JSON.parse(decodeURIComponent(x.slice(x.indexOf('=')+1)))).sort((a,b)=>a.i-b.i);
 assert.ok(parts.length>=1 && parts.length<=8, 'project-detail cookies remain in their existing format');
 const backup=JSON.parse(parts.map(part=>part.d).join(''));
 assert.ok(backup.projectDetail && Array.isArray(backup.tracks), 'cookie still saves project details and tracks');
 assert.ok(JSON.stringify(backup).includes('newest edit'), 'cookie backup includes the latest saved edit');
 assert.equal((await one.w.__TIMELINE_EDITOR__.storeProjectAssets(page,{voiceover:new one.w.Blob(['stale'])})).ok,false, 'stale media writes are blocked');
});

test('blocked pop-up increments counter without revoking the current editor', async t => {
 const shared=sharedStorageWithEvents(), cookies=makeCookieJar(), locks=lockManager(), idb=makeMemoryIndexedDB(); let href='';
 function prepare(w){shared.windows.add(w);Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});}
 const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=blocked',localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){prepare(w);w.open=()=>({location:{replace(x){href=x;}},close(){}});}});
 t.after(()=>{shared.windows.delete(table.w);table.dom.window.close();}); table.w.setStudioLayout('table');
 const row=table.w.__BATCH_ROWS[0]; row.script='This completed row has enough words for the counter click test.';finishRow(table.w,row);
 const edit=()=>table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();
 edit(); await until(()=>href);
 const old=bootWindow({url:'https://studio.test'+href,localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});
 t.after(()=>{shared.windows.delete(old.w);old.dom.window.close();}); await until(()=>old.w.__TIMELINE_EDITOR_STATE__);
 table.w.open=()=>null; edit();
 const page='timeline-blocked-row-'+row.id, key='ytvs.timeline-edit-session.v1.'+page;
 await until(()=>JSON.parse(shared.storage.getItem(key)).count===2);
 assert.equal(old.w.__TIMELINE_EDITOR__.save(),true,'blocked click must not revoke owner');
 assert.match(table.w.document.getElementById('required-modal-list').textContent,/blocked/);
 assert.equal(JSON.parse(decodeURIComponent(cookies.cookie.split('; ').find(p=>p.startsWith('ytvs_timeline_edit_counter_'+page+'=')).split('=')[1])).count,2);
});

test('handoff waits rather than losing unsaved changes if autosave fails', async t => {
 const shared=sharedStorageWithEvents(), cookies=makeCookieJar(), locks=lockManager(), idb=makeMemoryIndexedDB(); let opened=[], fail=false;
 const orig=shared.storage.setItem;
 shared.storage.setItem=(key,value)=>{ if (fail && String(key).startsWith('ytvs.timeline-editor.v1.')) throw Error('quota exceeded'); orig(key,value); };
 function prepare(w){shared.windows.add(w);Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});}
 const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=failhandoff',localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){prepare(w);w.open=()=>({location:{replace(x){opened.push(x);}},close(){}});}});
 t.after(()=>{shared.windows.delete(table.w);table.dom.window.close();}); table.w.setStudioLayout('table');
 const row=table.w.__BATCH_ROWS[0];row.script='This completed row contains enough words for a safe handoff test.';finishRow(table.w,row);
 const edit=()=>table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();
 edit(); await until(()=>opened.length===1);
 const old=bootWindow({url:'https://studio.test'+opened[0],localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});
 t.after(()=>{shared.windows.delete(old.w);old.dom.window.close();});await until(()=>old.w.__TIMELINE_EDITOR_STATE__);
 fail=true; old.w.__TIMELINE_EDITOR__.addTextElement('must not vanish');edit();await until(()=>opened.length===2);
 const next=bootWindow({url:'https://studio.test'+opened[1],localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});
 t.after(()=>{shared.windows.delete(next.w);next.dom.window.close();});
 await until(()=>/could not be saved/.test(old.w.document.getElementById('timeline-session-warning').textContent));
 assert.equal(next.w.__TIMELINE_EDITOR_STATE__,undefined,'new editor stays blocked');
 assert.ok(JSON.stringify(old.w.__TIMELINE_EDITOR_STATE__).includes('must not vanish'));
});

test('simultaneous reservations serialize the click counter per project', async t => {
 const shared=sharedStorageWithEvents(), cookies=makeCookieJar(), locks=lockManager();
 function prepare(w){shared.windows.add(w);Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});}
 const a=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=counta',localStorage:shared.storage,cookieJar:cookies,loadTimeline:true,prepare});
 const b=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=countb',localStorage:shared.storage,cookieJar:cookies,loadTimeline:true,prepare});
 t.after(()=>{shared.windows.delete(a.w);shared.windows.delete(b.w);a.dom.window.close();b.dom.window.close();});
 const [first,second,other]=await Promise.all([
  a.w.__TIMELINE_EDITOR__.reserveEditSession('same-project','first'),
  b.w.__TIMELINE_EDITOR__.reserveEditSession('same-project','second'),
  a.w.__TIMELINE_EDITOR__.reserveEditSession('other-project','other')
 ]);
 assert.deepEqual([first,second,other],[1,2,1]);
 assert.equal(JSON.parse(shared.storage.getItem('ytvs.timeline-edit-session.v1.same-project')).request,'second');
 assert.ok(cookies.names().includes('ytvs_timeline_edit_counter_same-project'));
 assert.ok(cookies.names().includes('ytvs_timeline_edit_counter_other-project'));
});

test('deleting a row revokes its editor so it cannot recreate the project', async t => {
 const shared=sharedStorageWithEvents(), cookies=makeCookieJar(), locks=lockManager(), idb=makeMemoryIndexedDB(); let href='';
 function prepare(w){shared.windows.add(w);Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});}
 const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=deleted',localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){prepare(w);w.open=()=>({location:{replace(x){href=x;}},close(){}});}});
 t.after(()=>{shared.windows.delete(table.w);table.dom.window.close();}); table.w.setStudioLayout('table');
 const row=table.w.__BATCH_ROWS[0];row.script='This completed test row has enough words to enter the timeline editor.';finishRow(table.w,row);
 table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click(); await until(()=>href);
 const old=bootWindow({url:'https://studio.test'+href,localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});
 t.after(()=>{shared.windows.delete(old.w);old.dom.window.close();});await until(()=>old.w.__TIMELINE_EDITOR_STATE__);
 const page='timeline-deleted-row-'+row.id, key='ytvs.timeline-editor.v1.'+page;
 table.w.removeBatchRow(row.id);
 await until(()=>/lost project control/.test(old.w.document.getElementById('timeline-session-warning').textContent));
 assert.equal(old.w.__TIMELINE_EDITOR__.save(),false);
 assert.equal(shared.storage.getItem(key),null);
});

test('without cross-tab locks the edit click fails closed rather than opening an uncontrolled editor', async t => {
 const storage=makeMemoryStorage(), cookies=makeCookieJar(); let navigated=false, closed=false;
 const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=nolocks',localStorage:storage,cookieJar:cookies,loadTimeline:true,prepare(w){w.open=()=>({location:{replace(){navigated=true;}},close(){closed=true;}});}});
 t.after(()=>table.dom.window.close()); table.w.setStudioLayout('table');
 const row=table.w.__BATCH_ROWS[0];row.script='There are sufficient words here to create an edit session safely.';finishRow(table.w,row);
 table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();
 await until(()=>closed);
 assert.equal(navigated,false);
 assert.match(table.w.document.getElementById('required-modal-list').textContent,/locking is unavailable/);
});

test('an abandoned ownership record warns before recovering the last autosave', async t => {
 const shared=sharedStorageWithEvents(), cookies=makeCookieJar(), locks=lockManager(), idb=makeMemoryIndexedDB(); let href='', confirmed=0;
 function prepare(w){shared.windows.add(w);Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});}
 const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=crash',localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){prepare(w);w.open=()=>({location:{replace(x){href=x;}},close(){}});}});
 t.after(()=>{shared.windows.delete(table.w);table.dom.window.close();});table.w.setStudioLayout('table');
 const row=table.w.__BATCH_ROWS[0];row.script='This script has enough words to test recovery from an interrupted editor.';finishRow(table.w,row);
 const page='timeline-crash-row-'+row.id;
 shared.storage.setItem('ytvs.timeline-edit-session.v1.'+page,JSON.stringify({projectId:page,count:3,owner:'crashed',ownerCount:3,request:'crashed',requestCount:3}));
 table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();await until(()=>href);
 const editor=bootWindow({url:'https://studio.test'+href,localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){prepare(w);w.confirm=()=>{confirmed++;return false;};}});
 t.after(()=>{shared.windows.delete(editor.w);editor.dom.window.close();});
 await until(()=>confirmed);
 assert.equal(editor.w.__TIMELINE_EDITOR_STATE__,undefined);
 assert.match(editor.w.document.getElementById('timeline-session-warning').textContent,/Unsaved changes may be missing/);
});

test('an open template composer delays takeover until it is closed', async t => {
 const shared=sharedStorageWithEvents(), cookies=makeCookieJar(), locks=lockManager(), idb=makeMemoryIndexedDB(), hrefs=[];
 function prepare(w){shared.windows.add(w);Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});}
 const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=composer',localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){prepare(w);w.open=()=>({location:{replace(x){hrefs.push(x);}},close(){}});}});
 t.after(()=>{shared.windows.delete(table.w);table.dom.window.close();});table.w.setStudioLayout('table');
 const row=table.w.__BATCH_ROWS[0];row.script='This completed row contains enough words to test the editor composer handoff.';finishRow(table.w,row);
 const edit=table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`);edit.click();await until(()=>hrefs.length===1);
 const one=bootWindow({url:'https://studio.test'+hrefs[0],localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});
 t.after(()=>{shared.windows.delete(one.w);one.dom.window.close();});await until(()=>one.w.__TIMELINE_EDITOR_STATE__);
 const modal=one.w.document.createElement('div');modal.id='tpl-modal';modal.style.display='flex';one.w.document.body.appendChild(modal);
 table.w.document.querySelector(`[data-batch-row="${row.id}"] [data-batch-action="edit"]`).click();await until(()=>hrefs.length===2);
 const two=bootWindow({url:'https://studio.test'+hrefs[1],localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});
 t.after(()=>{shared.windows.delete(two.w);two.dom.window.close();});
 await until(()=>/Finish or close the template composer/.test(one.w.document.getElementById('timeline-session-warning').textContent));
 assert.equal(two.w.__TIMELINE_EDITOR_STATE__,undefined);
 modal.style.display='none';one.w.dispatchEvent(new one.w.Event('timeline-template-closed'));
 await until(()=>two.w.__TIMELINE_EDITOR_STATE__);
});
