import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./studio-render-harness.mjs";
import { TIMELINE_EDITOR_JS } from "../src/client/timeline-editor.ts";
import { handleGenerateImagePrompts } from "../src/modules/image-prompts.ts";

const script = "Garden flowers bring neighbors together in spring. Plant wildflowers along a quiet path and watch the bees collect pollen.";
const clipSlots = [1, 4, 7, 10];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, message) {
	const deadline = Date.now() + 4000;
	while (!predicate() && Date.now() < deadline) await delay(10);
	assert.ok(predicate(), message);
}

function setup(t, options = {}) {
	const { w } = harness();
	t.after(() => w.close());

	const held = new Set();
	Object.defineProperty(w.navigator, "locks", { value: {
		async request(name, options, callback) {
			if (typeof options === "function") callback = options;
			if (held.has(name)) return callback(null);
			held.add(name);
			try { return await callback({ name }); }
			finally { held.delete(name); }
		},
		async query() { return { held: Array.from(held, (name) => ({ name })), pending: [] }; }
	} });
	w.eval(TIMELINE_EDITOR_JS);
	w.Blob = Blob;
	w.AudioContext = class {
		decodeAudioData() { return Promise.resolve({ duration: 4 }); }
	};
	const src = Object.getOwnPropertyDescriptor(w.HTMLMediaElement.prototype, "src");
	Object.defineProperty(w.HTMLMediaElement.prototype, "src", {
		...src,
		set(value) {
			src.set.call(this, value);
			queueMicrotask(() => this.dispatchEvent(new w.Event("loadedmetadata")));
		}
	});
	w.scrollTo = () => {};

	const voices = [], selections = [], dbOpens = [], stored = [];
	const pendingWrites = [], locksAtAbort = [];
	Object.defineProperty(w, "indexedDB", { value: {
		open() {
			const open = {};
			dbOpens.push(open);
			if (options.stallSave === "open") return open;
			open.result = {
				close() {},
				transaction() {
					let aborted = false;
					const tx = {
						abort() {
							aborted = true;
							locksAtAbort.push(Array.from(held));
							queueMicrotask(() => tx.onabort());
						},
						objectStore: () => ({
							get() {
								const read = {};
								queueMicrotask(() => read.onsuccess());
								return read;
							},
							put(record) {
								const commit = () => {
									if (aborted) return;
									stored.push(record);
									tx.oncomplete();
								};
								if (options.stallSave === "write") pendingWrites.push(commit);
								else queueMicrotask(commit);
							}
						})
					};
					return tx;
				}
			};
			queueMicrotask(() => open.onsuccess());
			return open;
		}
	} });

	const fetchDefault = w.fetch;
	w.fetch = async (input, init) => {
		switch (input) {
			case "/api/pipeline-capabilities":
				return Response.json({ version: 261, binaryImages: true, compactPrompts: true, imageChunks: 2, imageSlots: 6 });
			case "/api/media/config":
				return Response.json({ success: true, direct: false });
			case "/api/voiceover":
				voices.push(JSON.parse(init.body).text);
				return new Response("mp3", { headers: { "Content-Type": "audio/mpeg" } });
			case "/api/image-prompts":
				return handleGenerateImagePrompts(new Request("https://studio.test/api/image-prompts", { method: "POST", body: init.body }), {}, "unused-model");
			case "/api/image": {
				const { scene, page, index } = JSON.parse(JSON.parse(init.body).prompt.slice(8));
				selections.push({ scene, page, index });
				let id = scene + 100;
				if (options.duplicateLastPhoto && scene === 11) {
					if (page === 2) return Response.json({ error: "No suitable Pixabay media for this scene" }, { status: 404 });
					if (index !== 1) id = 100; // Already taken by scene 0; page 1 still has an unused result.
				}
				const type = clipSlots.includes(scene) ? "video/mp4" : "image/jpeg";
				return new Response("stock media", { headers: {
					"Content-Type": type,
					"X-Pixabay-Source": encodeURIComponent(JSON.stringify({ id }))
				} });
			}
			default: return fetchDefault(input, init);
		}
	};

	w.setStudioLayout("table");
	const generate = w.document.getElementById("batch-generate");
	const idle = () => !generate.textContent.includes("Stop generating");
	const actions = (row) => Array.from(w.document.querySelectorAll('tr[data-batch-row="' + row.id + '"] [data-batch-slot="actions"] button'));
	const addScript = (text = script) => w.addBatchRow({ script: text });
	return { w, held, generate, idle, actions, addScript, voices, selections, dbOpens, stored, pendingWrites, locksAtAbort };
}

function controlSaveDeadline(w) {
	const setTimeout = w.setTimeout.bind(w);
	let expire;
	w.setTimeout = (run, ms, ...args) => {
		if (ms !== 15000) return setTimeout(run, ms, ...args);
		expire = () => run(...args);
		return 0;
	};
	return () => {
		assert.equal(typeof expire, "function", "the save has a finite deadline");
		expire();
	};
}

function assertFinished({ w, actions }, row) {
	assert.equal(row.stage, "done");
	assert.equal(row.running, false);
	assert.equal(row.images.length, 12);
	assert.equal(row.slides.filter(({ type }) => type === "mp4").length, 4);
	assert.equal(row.slides.length, 12);
	assert.deepEqual(actions(row).map((button) => button.dataset.batchAction), ["preview", "export", "edit"]);
	assert.ok(actions(row).every((button) => !button.disabled && !button.hasAttribute("aria-disabled")));
	assert.equal(w.batchRowReadyForGeneration(row), false, "finished rows are not queued again");
}

test("Quick Batch tries an unused result after an empty retry page, then unlocks all three actions", async (t) => {
	const app = setup(t, { duplicateLastPhoto: true });
	const { generate, actions, idle, addScript, selections, voices, stored } = app;
	const row = addScript();
	assert.ok(actions(row).every((button) => button.disabled));
	generate.click();
	await until(idle, "the Generate click finishes");
	assert.deepEqual(selections.filter(({ scene }) => scene === 11).map(({ page, index }) => [page, index]), [[1, 7], [2, 0], [1, 0], [1, 1]]);
	assert.equal(selections.filter(({ scene }) => scene !== 11).length, 11, "successful scenes are not fetched again");
	assert.deepEqual(voices, [script]);
	assertFinished(app, row);
	assert.equal(Object.keys(stored[0].assets).length, 12, "the completed assets are saved for reload");
	assert.equal(generate.disabled, true);

	const nextScript = "A second row starts here. It has its own narration and its own stock media.";
	const next = addScript(nextScript);
	generate.click();
	await until(idle, "the second Generate click finishes");
	assertFinished(app, row);
	assertFinished(app, next);
	assert.deepEqual(voices, [script, nextScript], "only the new row ran on the second click");
});

test("a stalled Quick Batch media save releases the row and keeps its in-memory actions available", async (t) => {
	const app = setup(t, { stallSave: "open" });
	const { w, held, generate, idle, actions, addScript, dbOpens } = app;
	const expire = controlSaveDeadline(w);
	const row = addScript();
	generate.click();
	await until(() => dbOpens.length === 1, "the media save starts");
	assert.equal(row.running, true);
	assert.notEqual(row.stage, "done", "the row does not report Finished while the save holds the lock");
	assert.ok(actions(row).every((button) => button.disabled));

	expire();
	await until(idle, "storage cannot keep the entire Generate pass running");
	assertFinished(app, row);
	assert.match(row.detail, /could not be saved for reload/i);
	assert.equal(held.size, 0, "the table releases its timeline media lock");

	let closed = false;
	let transactions = 0;
	dbOpens[0].result = {
		close() { closed = true; },
		transaction() { transactions++; throw new Error("Unexpected transaction after timeout"); }
	};
	dbOpens[0].onsuccess();
	await until(() => closed, "a late IndexedDB connection is closed");
	assert.equal(transactions, 0, "a late open cannot start a write after lock release");
});

test("Quick Batch aborts a pending media write before releasing the project lock", async (t) => {
	const app = setup(t, { stallSave: "write" });
	const { w, held, generate, idle, addScript, pendingWrites, locksAtAbort, stored } = app;
	const expire = controlSaveDeadline(w);
	const row = addScript();
	generate.click();
	await until(() => pendingWrites.length === 1, "the transaction starts writing");
	const lockName = "ytvs-edit-owner:" + w.batchRowMediaPageId(row);
	assert.ok(held.has(lockName));

	expire();
	await until(idle, "the row finishes after aborting the write");
	assertFinished(app, row);
	assert.deepEqual(locksAtAbort, [[lockName]]);
	assert.equal(held.size, 0);
	pendingWrites[0]();
	assert.equal(stored.length, 0, "the expired save cannot change the project");
});
