/*
 * Bug Fix Session 331 — short logical simulation, not a test suite.
 * One browser cookie jar + one shared localStorage, but separate sessionStorage
 * pages. Four cookie chunks, no TTL, timestamp+digest matching, and a new tab
 * that starts empty because it gets a different localStorage page id.
 */

import vm from "node:vm";
import { PIPELINE_MANAGEMENT_STORE_JS } from "../src/client/pipeline-management-store.ts";

function sharedStores() {
	return { local: new Map(), jar: new Map() };
}

function fakeBrowser(shared, search = "") {
	const session = new Map();
	const win = {
		location: { protocol: "https:", search },
		sessionStorage: {
			getItem: (key) => (session.has(key) ? session.get(key) : null),
			setItem: (key, value) => session.set(key, String(value)),
			removeItem: (key) => session.delete(key)
		},
		localStorage: {
			getItem: (key) => (shared.local.has(key) ? shared.local.get(key) : null),
			setItem: (key, value) => shared.local.set(key, String(value)),
			removeItem: (key) => shared.local.delete(key)
		},
		document: {}
	};
	Object.defineProperty(win.document, "cookie", {
		get() {
			return Array.from(shared.jar, ([name, value]) => name + "=" + value).join("; ");
		},
		set(line) {
			const head = String(line).split(";")[0];
			const equal = head.indexOf("=");
			const name = head.slice(0, equal);
			const value = head.slice(equal + 1);
			if (/Max-Age=0/i.test(line) || !value) shared.jar.delete(name);
			else shared.jar.set(name, value);
		}
	});
	return win;
}

function evaluate(win) {
	const context = vm.createContext({
		window: win,
		document: win.document,
		URLSearchParams,
		Math, JSON, Number, Date, String, Boolean, Object, Array,
		encodeURIComponent, decodeURIComponent, console
	});
	vm.runInContext(PIPELINE_MANAGEMENT_STORE_JS + "\nthis.store = pipelineManagementStore;", context);
	return context.store;
}

function briefLoad(loaded) {
	return {
		source: loaded.source,
		repairedCookie: loaded.repairedCookie,
		debug: loaded.debug,
		rows: loaded.snapshot ? (loaded.snapshot.quickBatch.rows || []).length : 0,
		projects: loaded.snapshot ? (loaded.snapshot.editor.projects || []).length : 0,
		firstScript: loaded.snapshot && loaded.snapshot.quickBatch.rows[0]
			? loaded.snapshot.quickBatch.rows[0].script
			: "",
		firstTitle: loaded.snapshot && loaded.snapshot.quickBatch.rows[0]
			? loaded.snapshot.quickBatch.rows[0].title
			: "",
		runBusy: loaded.snapshot ? loaded.snapshot.quickBatch.runBusy : false,
		queued: loaded.snapshot ? loaded.snapshot.quickBatch.queued : [],
		videoIds: loaded.snapshot ? (loaded.snapshot.videoIds || []).length : 0
	};
}

const shared = sharedStores();
const pageA = fakeBrowser(shared, "?pipelinePage=p_pagea_1");
const storeA = evaluate(pageA);

const snapshot = {
	version: 1,
	pageId: storeA.pageId,
	updatedAt: 1730000000000,
	layout: "table",
	quickBatch: {
		runBusy: true,
		queued: ["4", "5"],
		finishedCount: 1,
		rows: [
			{ id: "1", title: "Garden draft", topic: "Home gardening", script: "Morning garden narration.", style: "Cinematic Film", minutes: 3, resolution: "720", orientation: "landscape", stage: "done", attempt: 0, prompts: 12, images: 12, slides: 12, mp3: true, animated: true, finished: true },
			{ id: "2", title: "Yoga draft", topic: "Morning yoga", script: "Slow breath and shoulders.", style: "Neon Night", minutes: 1, resolution: "540", orientation: "portrait", stage: "images", attempt: 2, prompts: 12, images: 7, slides: 7, mp3: true, animated: false, finished: false },
			{ id: "3", title: "Blank draft", topic: "", script: "", style: "", minutes: 1, resolution: "", orientation: "", stage: "voice", attempt: 0, prompts: 0, images: 0, slides: 0, mp3: false, animated: false, finished: false }
		]
	},
	editor: {
		projects: [
			{ n: 1, name: "Editor draft", script: "Editor narration saved too.", stage: "media", topic: "Home gardening", minutes: 3, style: "Kinetic Typography", prompts: 12, images: 4, slides: 4, mediaFilenames: 4 },
			{ n: 2, name: "", script: "", stage: "ready", topic: "", minutes: 1, style: "", prompts: 0, images: 0, slides: 0, mediaFilenames: 0 }
		]
	}
};

console.log("[debug] page A", { pageId: storeA.pageId, localStorageKey: storeA.localStorageKey, cookieNames: storeA.cookieNames, ttl: storeA.ttl });
console.log("[debug] save", storeA.save(snapshot));
console.log("[debug] normal load", briefLoad(storeA.load()));

const maxCookieValue = Math.max(...Array.from(shared.jar.values(), (value) => value.length));
console.log("[debug] cookie chunks", { count: storeA.cookieNames.length, maxValueLength: maxCookieValue, limit: 3800 });

shared.local.delete(storeA.localStorageKey);
console.log("[debug] cookie-only full restore", briefLoad(storeA.load()));

/* Put the same snapshot back, then make localStorage disagree with the cookies. */
storeA.save(snapshot);
const localText = shared.local.get(storeA.localStorageKey);
const localObject = JSON.parse(localText);
localObject.updatedAt = 1730000000001;
shared.local.set(storeA.localStorageKey, JSON.stringify(localObject));
console.log("[debug] timestamp mismatch", briefLoad(storeA.load()));

/* New tab: fresh sessionStorage + explicit pipelinePage id; same shared browser stores. */
const pageB = fakeBrowser(shared, "?pipelinePage=p_pageb_1");
const storeB = evaluate(pageB);
console.log("[debug] new tab", { pageId: storeB.pageId, localStorageKey: storeB.localStorageKey, cookieNames: storeB.cookieNames, load: briefLoad(storeB.load()) });
