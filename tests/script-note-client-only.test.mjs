/*
 * RULE 35 (2026-11-03) — SCRIPT NOTES ARE CLIENT-SIDE ONLY.
 *
 * Contract under test:
 *   1. no script-note read/write/delete ever reaches Cloudflare KV;
 *   2. the Worker's note ledger is ephemeral in-isolate memory;
 *   3. the note API advertises client ownership and never persists;
 *   4. capabilities disable async note polling (?async=1 degrades to sync);
 *   5. the browser stores the FULL note in localStorage and a digest mirror
 *      in the cookie, with checks that keep the two consistent;
 *   6. the studio makes ONE synchronous /api/script request and stores the
 *      finished script locally.
 *
 * Status: FIXED IN CODE. See SCRIPT_NOTES_CLIENT_SIDE_REQUIREMENT.md.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";

import { SCRIPT_NOTES_CLIENT_JS } from "../src/client/script-notes-client.ts";
import {
	clearScriptNoteMemory,
	emptyScriptNote,
	readScriptNote,
	readScriptNoteChecked,
	readScriptNoteFresh,
	scriptNotePersistencePolicy,
	scriptNoteStore,
	SCRIPT_NOTE_KV_READS,
	SCRIPT_NOTE_KV_WRITES,
	writeScriptNote
} from "../src/modules/script-notes.ts";
import {
	handleScriptNoteRead,
	handleScriptNoteWrite
} from "../src/modules/script-notes-api.ts";

const root = path.resolve(import.meta.dirname, "..");

function countingKv() {
	const store = new Map();
	const ops = { get: 0, put: 0, delete: 0 };
	return {
		store,
		ops,
		async get(key) { ops.get++; return store.has(key) ? store.get(key) : null; },
		async put(key, value) { ops.put++; store.set(key, String(value)); },
		async delete(key) { ops.delete++; store.delete(key); }
	};
}

const plan = {
	title: "Yoga for a Calmer Morning",
	headings: ["Start with Yoga", "Find Your Balance"],
	longTail: "morning yoga poses for beginners in a small home studio",
	short: ["yoga", "breathing", "stretching", "balance"]
};

/* ------------------------------------------------------------------------- */
/* 1. The Worker's note store never touches KV                                */
/* ------------------------------------------------------------------------- */

test("RULE 35: the script note store performs zero KV reads, writes or deletes", async () => {
	clearScriptNoteMemory();
	const kv = countingKv();
	const env = { KV_BINDING: kv };
	const store = scriptNoteStore(env);
	const note = emptyScriptNote({ id: "nt-rule35test", topic: "yoga", minutes: 1, speed: "medium" });

	assert.equal(await store.get(note.id), null);
	await store.put(note);
	assert.equal((await store.get(note.id)).id, note.id);
	if (store.delete) await store.delete(note.id);

	assert.deepEqual(kv.ops, { get: 0, put: 0, delete: 0 });
	assert.equal(kv.store.size, 0, "no script-note key exists in KV");
	assert.equal(SCRIPT_NOTE_KV_READS, 0);
	assert.equal(SCRIPT_NOTE_KV_WRITES, 0);
	assert.equal(scriptNotePersistencePolicy().storage, "client:localStorage+cookie");
});

test("RULE 35: writeScriptNote / readScriptNote / fresh / checked ignore KV", async () => {
	clearScriptNoteMemory();
	const kv = countingKv();
	const env = { KV_BINDING: kv };
	const note = emptyScriptNote({ id: "nt-ignoreskv", topic: "yoga", minutes: 1, speed: "medium" });
	note.script = "A finished narration that must never be persisted server-side.";

	await writeScriptNote(env, note);
	assert.equal((await readScriptNote(env, note.id)).script, note.script);
	assert.equal((await readScriptNoteFresh(env, note.id)).state, "empty");
	assert.equal((await readScriptNoteChecked(env, note.id)).unavailable, false);
	assert.deepEqual(kv.ops, { get: 0, put: 0, delete: 0 });
});

test("RULE 35: the note API writes no KV key and advertises client ownership", async () => {
	clearScriptNoteMemory();
	const kv = countingKv();
	const env = { KV_BINDING: kv, fetchImpl: async () => { throw new Error("no network expected"); } };
	const request = new Request("https://studio.test/api/script/notes", {
		method: "POST",
		body: JSON.stringify({ topic: "Morning yoga", minutes: 1, speed: "medium", keywordSet: plan })
	});
	const written = await handleScriptNoteWrite(request, env);
	const ticket = await written.json();
	assert.equal(written.status, 200);
	assert.equal(ticket.clientSideOnly, true);
	assert.equal(ticket.persisted, false);
	assert.deepEqual(ticket.storage, [
		"localStorage:ytvs.script-notes.v1", "cookie:ytvs_note"
	]);

	const read = await handleScriptNoteRead(
		ticket.noteId,
		env,
		new URL("https://studio.test/api/script/notes/" + ticket.noteId),
		{ queueGraceMs: 90000, deadlineMs: 240000 }
	);
	const body = await read.json();
	assert.equal(body.clientSideOnly, true);
	assert.equal(body.persisted, false);
	assert.deepEqual(kv.ops, { get: 0, put: 0, delete: 0 });
	assert.equal(kv.store.size, 0);
});

/* ------------------------------------------------------------------------- */
/* 2. Source-level guard: no script subsystem code writes note data to KV     */
/* ------------------------------------------------------------------------- */

test("RULE 35: no source file writes a script-note KV key", () => {
	const files = fs.readdirSync(path.join(root, "src/modules"))
		.filter((name) => name.endsWith(".ts"))
		.map((name) => path.join(root, "src/modules", name));
	files.push(path.join(root, "src/index.ts"));
	/* Strip comments first: the RULE 35 rationale quotes the old KV call. */
	const codeOnly = (text) => text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");
	for (const file of files) {
		const source = codeOnly(fs.readFileSync(file, "utf8"));
		assert.doesNotMatch(source, /kv\.put\(\s*SCRIPT_NOTE_PREFIX/,
			`${path.basename(file)} must not put a script note into KV`);
		assert.doesNotMatch(source, /KV_BINDING\.put\([^)]*script-note/,
			`${path.basename(file)} must not write a script-note KV key`);
	}
	const notesSource = fs.readFileSync(path.join(root, "src/modules/script-notes.ts"), "utf8");
	assert.match(notesSource, /RULE 35/);
	assert.match(notesSource, /return noteMemoryStore\(\);/);
});

test("RULE 35: the script route has no KV credit writes and ?async=1 degrades to sync", () => {
	const source = fs.readFileSync(path.join(root, "src/index.ts"), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/[^\n]*/g, "");
	const route = source.slice(source.indexOf('url.pathname === "/api/script"'), source.indexOf('url.pathname === "/api/voiceover"'));
	assert.doesNotMatch(route, /creditConsume\(/);
	assert.doesNotMatch(route, /guestCreditConsume\(/);
	assert.doesNotMatch(route, /submitAsyncScriptJob\(/);
	assert.match(source, /asyncScript: 0/, "capabilities disable async note polling");
	assert.match(source, /scriptNoteStorage: "client:localStorage\+cookie"/);
	assert.match(route, /handleSeoScriptGeneration\(/);
});

/* ------------------------------------------------------------------------- */
/* 3. Browser localStorage <-> cookie consistency                            */
/* ------------------------------------------------------------------------- */

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
		},
		value() { return jar.get("ytvs_note") || ""; }
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
			get cookie() { return jar.read(); },
			set cookie(value) { jar.write(value); }
		}
	};
	const context = vm.createContext({
		window: win, URL, console, JSON, Date, Math,
		encodeURIComponent, decodeURIComponent
	});
	vm.runInContext(
		SCRIPT_NOTES_CLIENT_JS + "\nthis.createScriptNoteMemory = createScriptNoteMemory;",
		context
	);
	return { memory: context.createScriptNoteMemory(win), win, store, jar };
}

const note = {
	topic: "Morning yoga",
	sourceUrl: "https://blog.example.com/morning-yoga-routine/",
	minutes: 1,
	speed: "medium",
	keywordSet: plan,
	outline: [
		{ heading: "Start with Yoga", beat: "Open here.", words: 70 },
		{ heading: "Find Your Balance", beat: "Close here.", words: 70 }
	],
	script: "Try morning yoga poses for beginners today. Breathe. Stretch. Balance. ".repeat(20)
};

test("RULE 35: put() writes the full note to localStorage and a digest mirror to the cookie", () => {
	const { memory, store, jar } = memoryRuntime();
	memory.put(note);
	const local = JSON.parse(store.get("ytvs.script-notes.v1"));
	const key = Object.keys(local)[0];
	assert.equal(local[key].script, note.script, "the FULL narration is in localStorage");
	assert.ok(local[key].h, "the localStorage entry carries a digest");
	assert.equal(local[key].v, 2, "schema version is stamped");

	const packed = JSON.parse(decodeURIComponent(jar.value()));
	assert.equal(packed.k, key);
	assert.equal(packed.h, local[key].h, "the cookie mirrors the full-note digest");
	assert.equal(packed.sl, note.script.length, "the cookie records the script length");
	assert.equal(packed.sp, note.script.slice(0, 480), "the cookie holds a short preview");
	assert.ok(String(jar.read()).length <= 4096, "the mirror fits a cookie");

	const audit = memory.check(note);
	assert.equal(audit.consistent, true, "localStorage and cookie agree");
	assert.equal(audit.scriptLength, note.script.length);
	assert.ok(memory.stats().checks >= 1);
	assert.equal(memory.stats().mismatches, 0);
});

test("RULE 35: a tampered localStorage note is detected and repaired from the sound copy", () => {
	const { memory, store } = memoryRuntime();
	memory.put(note);
	const key = Object.keys(JSON.parse(store.get("ytvs.script-notes.v1")))[0];
	const parsed = JSON.parse(store.get("ytvs.script-notes.v1"));
	parsed[key].script = "corrupted narration";
	store.set("ytvs.script-notes.v1", JSON.stringify(parsed));

	const hit = memory.get(note);
	assert.equal(hit.script, note.script, "the sound copy wins");
	const audit = memory.check(note);
	assert.equal(audit.found, true);
	assert.ok(memory.stats().digestFailures >= 1, "the corrupt digest was detected");
	assert.ok(memory.stats().repairs >= 1, "the lagging store was rewritten");
	assert.equal(JSON.parse(store.get("ytvs.script-notes.v1"))[key].script, note.script);
});

test("RULE 35: a stale cookie digest is rewritten from the localStorage note", () => {
	const { memory, store, jar } = memoryRuntime();
	memory.put(note);
	const packed = JSON.parse(decodeURIComponent(jar.value()));
	packed.h = "deadbeef-1";
	jar.write("ytvs_note=" + encodeURIComponent(JSON.stringify(packed)) + "; Max-Age=604800; Path=/; SameSite=Lax");

	const hit = memory.get(note);
	assert.equal(hit.script, note.script);
	assert.ok(memory.stats().mismatches >= 1);
	assert.ok(memory.stats().repairs >= 1);
	const healed = JSON.parse(decodeURIComponent(jar.value()));
	const local = JSON.parse(store.get("ytvs.script-notes.v1"));
	assert.equal(healed.h, local[Object.keys(local)[0]].h, "the cookie digest is restored");
	assert.equal(memory.check(note).consistent, true);
});

test("RULE 35: a missing localStorage note is restored from the cookie mirror", () => {
	const { memory, store } = memoryRuntime();
	memory.put(note);
	store.delete("ytvs.script-notes.v1");
	const hit = memory.get(note);
	assert.ok(hit, "the cookie-only note still resolves");
	assert.equal(hit.keywordSet.longTail, plan.longTail);
	assert.ok(JSON.parse(store.get("ytvs.script-notes.v1")), "localStorage was restored");
	assert.equal(memory.check(note).found, true);
});

test("RULE 35: remove() clears BOTH stores so they cannot drift", () => {
	const { memory, store, jar } = memoryRuntime();
	memory.put(note);
	memory.remove(note);
	assert.equal(store.has("ytvs.script-notes.v1") && Object.keys(JSON.parse(store.get("ytvs.script-notes.v1"))).length > 0, false);
	assert.ok(!jar.value() || jar.value().length < 10, "the cookie mirror was cleared");
});

test("RULE 35: a script-length mismatch between the two stores is detected", () => {
	const { memory, jar } = memoryRuntime();
	memory.put(note);
	const packed = JSON.parse(decodeURIComponent(jar.value()));
	packed.sl = 1;
	jar.write("ytvs_note=" + encodeURIComponent(JSON.stringify(packed)) + "; Max-Age=604800; Path=/; SameSite=Lax");
	const hit = memory.get(note);
	assert.equal(hit.script.length, note.script.length);
	assert.ok(memory.stats().scriptChecks >= 1);
	assert.ok(memory.stats().mismatches >= 1);
	assert.equal(JSON.parse(decodeURIComponent(jar.value())).sl, note.script.length);
});

/* ------------------------------------------------------------------------- */
/* 4. Studio integration: one sync request, note kept in the browser          */
/* ------------------------------------------------------------------------- */

import { harness } from "./studio-render-harness.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
	status,
	headers: { "Content-Type": "application/json" }
});

test("RULE 35: the studio never polls a KV note and stores the script client-side", async (t) => {
	const { w } = harness();
	t.after(() => w.close());

	const requests = [];
	let polls = 0;
	const scriptText = "Try morning yoga poses for beginners today. Breathe. Stretch. Balance.";
	w.fetch = async (input, init = {}) => {
		const url = String(input);
		const body = init.body ? JSON.parse(init.body) : null;
		if (url === "/api/pipeline-capabilities") {
			return json({
				version: 261, scriptNotes: 1, asyncScript: 1, noteRepair: 1,
				scriptNoteStorage: "client:localStorage+cookie",
				scriptNoteKvWrites: 0,
				scriptNoteConsistency: "digest+timestamp+scriptLength"
			});
		}
		if (url === "/api/seo-plan") return json({ success: true, sets: [plan] });
		if (url.indexOf("/api/script/notes/") === 0) {
			polls++;
			return json({ state: "empty", terminal: true }, 404);
		}
		if (url === "/api/script") {
			requests.push({ url, body });
			return json({
				success: true,
				script: scriptText,
				durationMs: 60000,
				title: plan.title,
				headings: plan.headings,
				keywords: { longTail: plan.longTail, short: plan.short },
				outline: [{ heading: "Start with Yoga", beat: "Open", words: 70 }],
				noteId: "nt-clientside"
			});
		}
		if (url === "/api/image-prompts") return json({ success: false, error: "test stop" }, 400);
		return json({ success: false, error: "unexpected " + url }, 404);
	};

	w.addVideoAccordion();
	w.document.getElementById("va-script-topic-1").value = "morning yoga";
	w.document.getElementById("va-script-minutes-1").value = "1";
	await w.generateScript(1);
	w.selectSeoKeywordSet(1, 0);
	await w.confirmSeoStyleAndGenerate(1);

	assert.equal(requests.length, 1, "exactly one script request");
	assert.equal(requests[0].url, "/api/script", "no ?async=1 ticket is requested");
	assert.equal(requests[0].body.useNotes, true);
	assert.equal(requests[0].body.note.keywordSet.longTail, plan.longTail,
		"the localStorage/cookie note is sent as the browser hint");
	assert.equal(polls, 0, "no server-side note is polled");
	assert.equal(w.__VIDEO_PROJECTS[0].script, scriptText);

	const stored = JSON.parse(w.localStorage.getItem("ytvs.script-notes.v1"));
	const key = Object.keys(stored)[0];
	assert.equal(stored[key].script, scriptText, "the full script is in localStorage");
	assert.ok(stored[key].h, "the note carries a digest");
	assert.match(w.document.cookie, /ytvs_note=/, "the cookie mirror exists");
	assert.equal(w.__SCRIPT_NOTE_CONSISTENCY.consistent, true,
		"localStorage and cookie passed the consistency check");
	assert.ok(w.__SCRIPT_NOTE_CONSISTENCY.stats.checks >= 1);

	/* Settle the deliberately failed media flow before the window closes. */
	for (let i = 0; i < 100 && w.__VIDEO_PROJECTS[0]._imageFlowActive; i++) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
});
