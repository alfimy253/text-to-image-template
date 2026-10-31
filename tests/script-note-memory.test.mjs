/*
 * Browser note memory (src/client/script-notes-client.ts) and the client hand-off:
 *
 *  1. localStorage is the primary store: a note is a synchronous property read,
 *     keyed on the SAME canonical dynamic URL + minutes + speed the Worker uses;
 *  2. when localStorage is unavailable (private mode, disabled storage, quota)
 *     the cookie mirror still returns the note, and the in-page map always does;
 *  3. the cookie is compact (it never exceeds a cookie's 4 KB budget);
 *  4. entries expire after the note TTL and the store is capped;
 *  5. the studio seeds the note when the user picks a keyword set and sends it
 *     with the script request, so the FIRST run skips the planner entirely;
 *  6. the async script path polls the note URL and never holds one long request.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { SCRIPT_NOTES_CLIENT_JS } from "../src/client/script-notes-client.ts";
import { harness } from "./studio-render-harness.mjs";

function fakeCookieJar() {
	const jar = new Map();
	return {
		read() {
			return [...jar.entries()].map(([name, value]) => name + "=" + value).join("; ");
		},
		write(header) {
			const [pair, ...attrs] = String(header).split(";").map((part) => part.trim());
			const split = pair.indexOf("=");
			const name = pair.slice(0, split);
			const value = pair.slice(split + 1);
			const maxAge = attrs.find((attr) => /^max-age=/i.test(attr));
			if (maxAge && Number(maxAge.split("=")[1]) <= 0) jar.delete(name);
			else jar.set(name, value);
		}
	};
}

function memoryRuntime(options = {}) {
	const jar = options.jar || fakeCookieJar();
	const store = new Map(options.seed || []);
	const failLocal = Boolean(options.failLocal);
	const win = {
		URL,
		localStorage: {
			getItem(key) {
				if (failLocal) throw new Error("storage disabled");
				return store.has(key) ? store.get(key) : null;
			},
			setItem(key, value) {
				if (failLocal) throw new Error("storage disabled");
				store.set(key, String(value));
			},
			removeItem(key) {
				if (failLocal) throw new Error("storage disabled");
				store.delete(key);
			}
		},
		document: {
			get cookie() {
				return jar.read();
			},
			set cookie(value) {
				jar.write(value);
			}
		}
	};
	const context = vm.createContext({ window: win, URL, console, JSON, Date, Math, encodeURIComponent, decodeURIComponent });
	vm.runInContext(SCRIPT_NOTES_CLIENT_JS + "\nthis.createScriptNoteMemory = createScriptNoteMemory;", context);
	return { memory: context.createScriptNoteMemory(win), win, store, jar };
}

const note = {
	topic: "Morning yoga",
	sourceUrl: "https://blog.example.com/morning-yoga-routine/",
	minutes: 1,
	speed: "medium",
	keywordSet: {
		title: "Yoga for a Calmer Morning",
		headings: ["Start with Yoga", "Find Your Balance"],
		longTail: "morning yoga poses for beginners in a small home studio",
		short: ["yoga", "breathing", "stretching", "balance"]
	},
	outline: [
		{ heading: "Start with Yoga", beat: "Open here.", words: 70 },
		{ heading: "Find Your Balance", beat: "Close here.", words: 70 }
	]
};

test("browser notes are keyed on the same canonical dynamic URL as the worker", () => {
	const { memory } = memoryRuntime();
	const key = memory.keyFor(note);
	assert.equal(
		key,
		memory.keyFor({ ...note, sourceUrl: "https://www.blog.example.com/morning-yoga-routine/?utm_source=x#top" })
	);
	assert.notEqual(key, memory.keyFor({ ...note, minutes: 2 }));
	/* Same URL always wins over the topic label. */
	assert.equal(key, memory.keyFor({ ...note, topic: "Evening yoga" }));
	/* Without a URL the topic is the key. */
	assert.notEqual(memory.keyFor({ topic: "Morning yoga", minutes: 1, speed: "medium" }),
		memory.keyFor({ topic: "Evening yoga", minutes: 1, speed: "medium" }));
	assert.equal(memory.canonicalUrl("https://Example.com/a/?b=2&a=1&fbclid=z"), "https://example.com/a?a=1&b=2");
	assert.equal(memory.canonicalUrl("javascript:alert(1)"), "");
});

test("a note round-trips through localStorage with a synchronous hit", () => {
	const { memory, store } = memoryRuntime();
	assert.equal(memory.get(note), null);
	memory.put(note);
	assert.ok(store.has("ytvs.script-notes.v1"));

	/* A reload: the page map is gone, localStorage still has the note. */
	const reloaded = memoryRuntime({ seed: [...store.entries()] });
	const hit = reloaded.memory.get(note);
	assert.equal(hit.keywordSet.longTail, note.keywordSet.longTail);
	assert.equal(hit.outline.length, 2);
	assert.equal(hit.source, "local", "the read comes from localStorage");
	const stats = reloaded.memory.stats();
	assert.equal(stats.hits, 1);
	assert.equal(stats.localHits, 1);
	assert.equal(stats.localStorage, true);
	assert.equal(stats.cookie, true);
});

test("the cookie mirror serves the note when localStorage is unavailable", () => {
	const jar = fakeCookieJar();
	const first = memoryRuntime({ jar });
	first.memory.put(note);

	/* Private mode: every localStorage call throws, the cookie survives. */
	const second = memoryRuntime({ jar, failLocal: true });
	const hit = second.memory.get(note);
	assert.ok(hit, "cookie fallback returned the note");
	assert.equal(hit.source, "cookie");
	assert.equal(hit.keywordSet.longTail, note.keywordSet.longTail);
	assert.equal(hit.noteId, null);
	const stats = second.memory.stats();
	assert.equal(stats.localStorage, false);
	assert.equal(stats.cookieHits, 1);
	assert.ok(second.jar.read().length > 0);
});

test("the cookie stays inside a cookie's budget and notes expire and cap", () => {
	const { memory, jar, store } = memoryRuntime();
	memory.put({
		...note,
		script: "words ".repeat(4000),
		outline: Array.from({ length: 8 }, (_, i) => ({ heading: "Section " + i, beat: "long beat ".repeat(10), words: 60 }))
	});
	const cookieValue = jar.read();
	assert.ok(cookieValue.length <= 4096, "cookie header stayed under 4 KB: " + cookieValue.length);
	const hit = memory.get(note);
	assert.equal(hit.script.length > 1000, true, "localStorage kept the full script");

	/* Expiry: an entry older than the 7 day TTL is a miss. */
	const key = memory.keyFor(note);
	const parsed = JSON.parse(store.get("ytvs.script-notes.v1"));
	parsed[key].updatedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
	store.set("ytvs.script-notes.v1", JSON.stringify(parsed));
	const fresh = memoryRuntime({ seed: [...store.entries()], jar: fakeCookieJar() });
	assert.equal(fresh.memory.get(note), null);

	/* Cap: the store never keeps more than 24 notes. */
	const capped = memoryRuntime();
	for (let i = 0; i < 40; i++) {
		capped.memory.put({ topic: "topic " + i, minutes: 1, speed: "medium" });
	}
	const map = JSON.parse(capped.store.get("ytvs.script-notes.v1"));
	assert.equal(Object.keys(map).length, 24);
});

test("a keyword pick is turned into a beat plan without any network call", () => {
	const { memory } = memoryRuntime();
	const outline = memory.outlineFor(note.keywordSet, 2, "medium");
	assert.equal(outline.length, 2);
	assert.ok(outline[0].words >= 60, "word budget follows speed x minutes");
	assert.match(outline[0].beat, /Open here/);
	assert.match(outline[1].beat, /Close here/);
	assert.equal(memory.outlineFor({ headings: [] }, 1, "medium").length, 0);
});

/* ------------------------------------------------------------------------- */
/* Studio integration: seed on pick, send with the request, poll the note     */
/* ------------------------------------------------------------------------- */

const setA = {
	title: "Yoga for a Calmer Morning",
	headings: ["Start with Yoga", "Find Your Balance"],
	longTail: "morning yoga poses for beginners",
	short: ["yoga", "breathing", "stretching", "balance"]
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
	status,
	headers: { "Content-Type": "application/json" }
});

test("the studio sends the browser note with the script request and polls the note in async mode", async (t) => {
	const { w } = harness();
	t.after(() => w.close());

	const requests = [];
	const noteId = "nt-browsernote";
	let noteState = { state: "writing", pending: true, terminal: false, outline: [{ heading: "Start with Yoga", beat: "x", words: 70 }] };
	const scriptText = "Try morning yoga poses for beginners today. Breathe. Stretch. Balance.";
	const result = {
		success: true,
		script: scriptText,
		durationMs: 60000,
		title: setA.title,
		headings: setA.headings,
		keywords: { longTail: { keyword: setA.longTail, count: 1, min: 1, max: null }, short: setA.short.map((kw) => ({ keyword: kw, count: 2, min: 2, max: null })) },
		noteId,
		outline: [{ heading: "Start with Yoga", beat: "Open", words: 70 }],
		noteOrigin: "browser",
		notePlannerSkipped: true
	};

	const original = w.fetch;
	w.fetch = async (input, init = {}) => {
		const url = String(input);
		const body = init.body ? JSON.parse(init.body) : null;
		if (url === "/api/pipeline-capabilities") {
			return json({ version: 261, singleAttemptScript: true, scriptNotes: 1, asyncScript: 1, noteRepair: 1 });
		}
		if (url === "/api/seo-plan") return json({ success: true, sets: [setA] });
		/* The note URL is a sub-path of /api/script, so match it first. */
		if (url === "/api/script/notes/" + noteId) {
			noteState = {
				...noteState,
				state: "done",
				pending: false,
				terminal: true,
				result,
				script: scriptText,
				keywords: { title: setA.title, headings: setA.headings, longTail: setA.longTail, short: setA.short }
			};
			return json(noteState);
		}
		if (url.indexOf("/api/script") === 0) {
			requests.push({ url, body });
			return json({ success: true, pending: true, noteId, noteUrl: "/api/script/notes/" + noteId, pollAfterMs: 20, state: "queued" }, 202);
		}
		if (url === "/api/image-prompts") return json({ success: false, error: "test stop" }, 400);
		return original(input, init);
	};

	w.addVideoAccordion();
	w.document.getElementById("va-script-topic-1").value = "morning yoga";
	w.document.getElementById("va-script-minutes-1").value = "1";
	await w.generateScript(1);
	w.selectSeoKeywordSet(1, 0);

	await w.confirmSeoStyleAndGenerate(1);

	assert.equal(requests.length >= 1, true, "a script request was made");
	const first = requests[0];
	assert.match(first.url, /\/api\/script\?async=1$/, "async mode is used when the worker advertises it");
	assert.equal(first.body.useNotes, true);
	assert.equal(first.body.keywordSet.longTail, setA.longTail);
	assert.ok(first.body.note, "the browser note travels with the request");
	assert.equal(first.body.note.keywordSet.longTail, setA.longTail);
	assert.ok(Array.isArray(first.body.note.outline) && first.body.note.outline.length === 2);
	assert.equal(w.__VIDEO_PROJECTS[0].script, scriptText, "the polled note delivered the script");

	/* The note is now stored in the browser for the next run of this topic. */
	const stored = JSON.parse(w.localStorage.getItem("ytvs.script-notes.v1"));
	const key = Object.keys(stored)[0];
	assert.match(key, /^t:morning yoga\|1\|medium$/);
	assert.equal(stored[key].script, scriptText);
	assert.equal(stored[key].noteId, noteId);

	/* Settle the deliberately failed media flow before the window closes. */
	for (let i = 0; i < 100 && w.__VIDEO_PROJECTS[0]._imageFlowActive; i++) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
});
