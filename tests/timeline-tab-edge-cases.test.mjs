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

test('direct editor participates in the ownership handoff without counting an Edit click',async t=>{
 const shared=sharedStorageWithEvents(),cookies=makeCookieJar(),locks=lockManager(),idb=makeMemoryIndexedDB();let href='';
 const prepare=w=>{shared.windows.add(w);Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});};
 const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=direct',localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){prepare(w);w.open=()=>({location:{replace(x){href=x;}},close(){}});}});t.after(()=>{shared.windows.delete(table.w);table.dom.window.close();});table.w.setStudioLayout('table');
 const row=table.w.__BATCH_ROWS[0];row.script='These are enough words to test a direct timeline editor handoff.';finishRow(table.w,row);const page='timeline-direct-row-'+row.id;
 const direct=bootWindow({url:'https://studio.test/free?layout=timeline&pipelinePage='+page,localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});t.after(()=>{shared.windows.delete(direct.w);direct.dom.window.close();});await until(()=>direct.w.__TIMELINE_EDITOR_STATE__);
 direct.w.__TIMELINE_EDITOR__.addTextElement('direct pending work');table.w.openBatchEditPage(row);await until(()=>href);
 const next=bootWindow({url:'https://studio.test'+href,localStorage:shared.storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare});t.after(()=>{shared.windows.delete(next.w);next.dom.window.close();});await until(()=>next.w.__TIMELINE_EDITOR_STATE__);
 assert.ok(JSON.stringify(next.w.__TIMELINE_EDITOR_STATE__).includes('direct pending work'));assert.equal(JSON.parse(shared.storage.getItem('ytvs.timeline-edit-session.v1.'+page)).count,1);
});

test('long project ids use distinct multipart cookie backups',async t=>{
 const cookies=makeCookieJar(),storage=makeMemoryStorage(),locks=lockManager(),prefix='a'.repeat(64),a=prefix+'-one',b=prefix+'-two';
 const prepare=w=>Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});
 const first=bootWindow({url:'https://studio.test/free?layout=timeline&pipelinePage='+a,localStorage:storage,cookieJar:cookies,loadTimeline:true,prepare});t.after(()=>first.dom.window.close());await until(()=>first.w.__TIMELINE_EDITOR_STATE__);
 first.w.__TIMELINE_EDITOR__.addTextElement('first');assert.equal(first.w.__TIMELINE_EDITOR__.save(),true);
 const second=bootWindow({url:'https://studio.test/free?layout=timeline&pipelinePage='+b,localStorage:storage,cookieJar:cookies,loadTimeline:true,prepare});t.after(()=>second.dom.window.close());await until(()=>second.w.__TIMELINE_EDITOR_STATE__);second.w.__TIMELINE_EDITOR__.addTextElement('second');assert.equal(second.w.__TIMELINE_EDITOR__.save(),true);
 const parts=cookies.cookie.split('; ').filter(x=>x.startsWith('ytvs_timeline_editor_')).map(x=>JSON.parse(decodeURIComponent(x.slice(x.indexOf('=')+1))));
 assert.ok(parts.some(p=>p.pid===a));assert.ok(parts.some(p=>p.pid===b));assert.notEqual(parts.find(p=>p.pid===a).p,parts.find(p=>p.pid===b).p);
});

test('legacy long-id cookie is recovered without blocking a different colliding project',async t=>{
 const cookies=makeCookieJar(),storage=makeMemoryStorage(),locks=lockManager(),prefix='q'.repeat(64),a=prefix+'-first',b=prefix+'-second';
 const saved={projectId:a,version:3,updatedAt:17,sourceScript:'original backup',tracks:[{id:'background-media',kind:'media',items:[]}],scenes:[]};
 const text=JSON.stringify(saved);let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=(h*16777619)>>>0;}
 const legacy='ytvs_timeline_editor_'+prefix+'_1';cookies.cookie=legacy+'='+encodeURIComponent(JSON.stringify({v:1,p:prefix,n:1,i:1,t:17,h:h.toString(36),d:text}));
 const prepare=w=>Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});
 const one=bootWindow({url:'https://studio.test/free?layout=timeline&pipelinePage='+a,localStorage:storage,cookieJar:cookies,loadTimeline:true,prepare});t.after(()=>one.dom.window.close());await until(()=>one.w.__TIMELINE_EDITOR_STATE__);
 assert.equal(one.w.__TIMELINE_EDITOR_STATE__.sourceScript,'original backup');assert.ok(cookies.names().includes(legacy));
 const two=bootWindow({url:'https://studio.test/free?layout=timeline&pipelinePage='+b,localStorage:storage,cookieJar:cookies,loadTimeline:true,prepare});t.after(()=>two.dom.window.close());await until(()=>two.w.__TIMELINE_EDITOR_STATE__);
 two.w.__TIMELINE_EDITOR__.addTextElement('different project');assert.equal(two.w.__TIMELINE_EDITOR__.save(),true);assert.ok(cookies.names().includes(legacy));
});

test('closing an activated waiting editor lets the current editor retain control',async t=>{
 const x=await setupReviewCase(t,'cancelwaiting');const modal=x.old.w.document.createElement('div');modal.id='tpl-modal';modal.style.display='flex';x.old.w.document.body.appendChild(modal);
 x.click();await until(()=>x.hrefs.length===2);
 const next=bootWindow({url:'https://studio.test'+x.hrefs[1],localStorage:x.shared.storage,cookieJar:x.cookies,indexedDB:x.idb.factory,loadTimeline:true,prepare:x.prepare});t.after(()=>{x.shared.windows.delete(next.w);next.dom.window.close();});
 await until(()=>/Finish or close/.test(x.old.w.document.getElementById('timeline-session-warning').textContent));
 next.w.dispatchEvent(new next.w.Event('pagehide'));await until(()=>!JSON.parse(x.shared.storage.getItem('ytvs.timeline-edit-session.v1.'+x.page)).requestActive);
 modal.style.display='none';x.old.w.dispatchEvent(new x.old.w.Event('timeline-template-closed'));await new Promise(r=>setTimeout(r,50));assert.equal(x.old.w.__TIMELINE_EDITOR__.save(),true);
});

test('missing media is reported and retry loads it when available',async t=>{
 const storage=makeMemoryStorage(),cookies=makeCookieJar(),locks=lockManager(),idb=makeMemoryIndexedDB(),page='missing-assets';
 storage.setItem('ytvs.timeline-editor.v1.'+page,JSON.stringify({projectId:page,version:3,updatedAt:1,scenes:[],tracks:[{id:'background-media',kind:'media',items:[{id:'m1',kind:'media',assetId:'missing1',startSec:0,durationSec:2}]}]}));
 const editor=bootWindow({url:'https://studio.test/free?layout=timeline&pipelinePage='+page,localStorage:storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});const set=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>set(fn,ms===150?1:ms,...args);}});t.after(()=>editor.dom.window.close());
 await until(()=>!editor.w.document.getElementById('timeline-retry-media').hidden,'missing media warning not shown');
 assert.match(editor.w.document.getElementById('timeline-status').textContent,/Missing 1 media asset/);
 const blob=new editor.w.Blob(['media'],{type:'image/jpeg'});idb.records.set(page,{id:page,assets:{missing1:{id:'missing1',blob,type:'image/jpeg'}}});
 editor.w.document.getElementById('timeline-retry-media').click();await until(()=>editor.w.document.getElementById('timeline-retry-media').hidden && /asset loaded/.test(editor.w.document.getElementById('timeline-status').textContent));
});

test('an expired unready popup does not indefinitely lock Quick Batch media',async t=>{
 const storage=makeMemoryStorage(),cookies=makeCookieJar(),locks=lockManager(),idb=makeMemoryIndexedDB(),page='expired-candidate';
 const table=bootWindow({url:'https://studio.test/free?layout=table&pipelinePage=expiry',localStorage:storage,cookieJar:cookies,indexedDB:idb.factory,loadTimeline:true,prepare(w){Object.defineProperty(w.navigator,'locks',{configurable:true,value:locks});}});t.after(()=>table.dom.window.close());
 const api=table.w.__TIMELINE_EDITOR__,count=await api.reserveEditSession(page,'expired',false);assert.equal(await api.prepareEditSession(page,'expired',count),true);
 const key='ytvs.timeline-edit-session.v1.'+page,record=JSON.parse(storage.getItem(key));record.candidateAt=Date.now()-61000;storage.setItem(key,JSON.stringify(record));
 const result=await api.storeProjectAssets(page,{voiceover:new table.w.Blob(['new'])});assert.equal(result.ok,true);assert.equal(JSON.parse(storage.getItem(key)).candidate,'');
 assert.equal(await api.activateEditSession(page,'expired',count),false);
});
