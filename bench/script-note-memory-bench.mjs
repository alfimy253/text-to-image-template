/*
 * Browser note memory benchmark — is localStorage/cookie actually faster than
 * asking the Worker for the note?
 *
 *   node --import tsx bench/script-note-memory-bench.mjs
 *   node --import tsx bench/script-note-memory-bench.mjs --ops 50000
 *
 * It runs the real `createScriptNoteMemory()` from
 * src/client/script-notes-client.ts inside a vm with a localStorage and a
 * cookie jar, so the numbers are the ones the studio pays per script request.
 * A KV read is not measured here: it is a network round trip, and the point of
 * the browser copy is that it removes that hop entirely.
 */
import vm from "node:vm";
import { performance } from "node:perf_hooks";

import { SCRIPT_NOTES_CLIENT_JS } from "../src/client/script-notes-client.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const index = args.indexOf("--" + name);
	return index === -1 ? fallback : Number(args[index + 1]) || fallback;
};
const OPS = Math.max(100, flag("ops", 20000));

function cookieJar() {
	const jar = new Map();
	return {
		read: () => [...jar.entries()].map(([name, value]) => name + "=" + value).join("; "),
		write(header) {
			const [pair] = String(header).split(";");
			const split = pair.indexOf("=");
			jar.set(pair.slice(0, split), pair.slice(split + 1));
		},
		size: () => [...jar.values()].reduce((sum, value) => sum + value.length, 0)
	};
}

function runtime(options = {}) {
	const jar = options.jar || cookieJar();
	const store = new Map(options.seed || []);
	const failLocal = Boolean(options.failLocal);
	const win = {
		URL,
		localStorage: {
			getItem: (key) => {
				if (failLocal) throw new Error("storage disabled");
				return store.has(key) ? store.get(key) : null;
			},
			setItem: (key, value) => {
				if (failLocal) throw new Error("storage disabled");
				store.set(key, String(value));
			},
			removeItem: (key) => {
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
	const context = vm.createContext({ window: win, URL, JSON, Date, Math, encodeURIComponent, decodeURIComponent });
	vm.runInContext(SCRIPT_NOTES_CLIENT_JS + "\nthis.createScriptNoteMemory = createScriptNoteMemory;", context);
	return { memory: context.createScriptNoteMemory(win), store, jar };
}

const note = {
	topic: "Morning yoga",
	sourceUrl: "https://blog.example.com/morning-yoga-routine/?utm_source=newsletter",
	minutes: 1,
	speed: "medium",
	keywordSet: {
		title: "Yoga for a Calmer Morning",
		headings: ["Start with Yoga", "Find Your Balance", "Breath and Timing", "Close the Practice"],
		longTail: "morning yoga poses for beginners in a small home studio",
		short: ["yoga", "breathing", "stretching", "balance"]
	},
	outline: [
		{ heading: "Start with Yoga", beat: "Open here.", words: 60 },
		{ heading: "Find Your Balance", beat: "Middle.", words: 60 },
		{ heading: "Breath and Timing", beat: "Middle.", words: 60 },
		{ heading: "Close the Practice", beat: "Close here.", words: 60 }
	],
	script: "Try morning yoga poses for beginners today. ".repeat(60)
};

function measure(label, ops, fn) {
	const started = performance.now();
	for (let i = 0; i < ops; i++) fn(i);
	const total = performance.now() - started;
	return { label, ops, totalMs: total, usPerOp: (total * 1000) / ops };
}

function main() {
	const writer = runtime();
	const put = measure("put (localStorage + cookie mirror)", Math.max(200, Math.floor(OPS / 10)), () => writer.memory.put(note));
	const storedBytes = (writer.store.get("ytvs.script-notes.v1") || "").length;

	/* A reload: page map empty, localStorage warm (the normal repeat case). */
	const seeded = runtime({ seed: [...writer.store.entries()] });
	const localHit = measure("get from localStorage", OPS, () => seeded.memory.get(note));

	/* Private mode: localStorage throws, the cookie mirror answers. */
	const privateMode = runtime({ jar: writer.jar, failLocal: true });
	const cookieHit = measure("get from cookie mirror", Math.max(200, Math.floor(OPS / 10)), () => privateMode.memory.get(note));

	const keying = measure("canonicalUrl + keyFor", OPS, () => writer.memory.keyFor(note));

	const coldMiss = runtime({ failLocal: true, jar: cookieJar() });
	const miss = measure("miss (empty storage)", Math.max(200, Math.floor(OPS / 10)), () => coldMiss.memory.get(note));

	const rows = [localHit, cookieHit, keying, miss, put];
	console.log("");
	console.log(`ops: ${OPS} (mutations: ${put.ops})`);
	console.log("");
	console.log("| operation | µs/op | notes |");
	console.log("| --- | --- | --- |");
	const describe = {
		"get from localStorage": "repeat script for the same topic/URL",
		"get from cookie mirror": "localStorage blocked (private mode / quota)",
		"canonicalUrl + keyFor": "URL + topic + minutes + speed → key",
		"miss (empty storage)": "first visit: falls through to the network",
		"put (localStorage + cookie mirror)": "after a finished script"
	};
	for (const row of rows) {
		console.log(`| ${row.label} | ${row.usPerOp.toFixed(2)} | ${describe[row.label] || ""} |`);
	}
	console.log("");
	console.log(`Stored note size: ${(storedBytes / 1024).toFixed(1)} KB in localStorage, ${(writer.jar.size() / 1024).toFixed(2)} KB in the cookie mirror.`);
	console.log("A KV read is one network round trip (tens to hundreds of ms) — the browser copy removes that hop from the script request path.");
	console.log("");
}

main();
