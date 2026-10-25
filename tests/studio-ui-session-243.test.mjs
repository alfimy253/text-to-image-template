/*
 * Session #243 UI contract, guarded in jsdom:
 *
 *  1. the video accordion has NO Sticker section any more (and the hidden
 *     global sticker panel is gone too - the renderer never draws one);
 *  2. the ☁️ API button is gone and **Delete Video** sits in its place;
 *  3. deleting a video renumbers the stack (Video 1..N, no gaps) and keeps
 *     the surviving videos' titles/scripts/files;
 *  4. the theme CSS keeps the requested proportions: the generated-image
 *     delete icon is 40% smaller and the Add to Video / Fullscreen buttons
 *     30% smaller than the accordion standard (1rem -> 0.7rem,
 *     12px 24px -> 8px 17px) in EVERY theme;
 *  5. the old bulk-grid CSS is gone (no dangling .bulk-* selectors).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
import { APP_CSS } from "../src/client/styles.ts";

function makeApp() {
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	const w = dom.window;
	w.alert = () => { };
	w.confirm = () => true;
	w.scrollTo = () => { };
	w.URL.createObjectURL = () => "blob:ui-test";
	w.URL.revokeObjectURL = () => { };
	w.__PLAN_MODE = "freemium";
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	return { dom, w };
}

test("the accordion has no sticker section and no API button, and offers Delete Video", () => {
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());

	w.addVideoAccordion();

	const accordion = w.document.getElementById("video-1");
	assert.ok(accordion);
	const html = accordion.innerHTML;

	/* Sticker section + its select are gone from the accordion... */
	assert.equal(w.document.getElementById("va-sticker-1"), null);
	assert.doesNotMatch(html, /Sticker/);
	/* ...and so is the hidden engine panel that fed it. */
	assert.equal(w.document.getElementById("sticker-select"), null);

	/* The API button is gone; Delete Video replaces it in the header. */
	assert.equal(html.includes("va-api-btn"), false);
	assert.equal(html.includes(">\\u2601") || html.includes("☁️ API"), false);
	const del = w.document.getElementById("va-delete-1");
	assert.ok(del, "Delete Video button exists");
	assert.match(del.textContent, /Delete Video/);
	assert.match(del.getAttribute("title"), /Delete this video/);

	/* Quality is still there - only Sticker was removed. */
	assert.ok(w.document.getElementById("va-quality-1"));
});

test("delete video renumbers the stack and keeps the survivors' state", () => {
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());

	/* The editor may already hold a video (init adds one); work from there. */
	const base = w.__VIDEO_PROJECTS.length;
	w.addVideoAccordion();
	w.addVideoAccordion();
	w.addVideoAccordion();

	const first = base + 1;
	const doomed = base + 2;
	const last = base + 3;

	w.document.getElementById("va-title-" + first).value = "First kept";
	w.document.getElementById("va-title-" + doomed).value = "DOOMED";
	w.document.getElementById("va-title-" + last).value = "Third kept";
	w.document.getElementById("va-script-topic-" + last).value = "third topic";

	/* A generated file on the surviving video must survive the renumber. */
	const project = w.__VIDEO_PROJECTS[last - 1];
	project.assets.push({ kind: "image", file: new w.File(["x"], "shot.png", { type: "image/png" }), url: "blob:ui-test", card: null });

	w.deleteVideoAccordion(doomed);

	assert.equal(w.__VIDEO_PROJECTS.length, base + 2);
	assert.equal(w.document.querySelectorAll("#video-accordions > .video-accordion").length, base + 2);

	/* The video before the gap keeps its number, the one after moves up. */
	assert.equal(w.document.getElementById("va-title-" + first).value, "First kept");
	assert.equal(w.document.getElementById("va-title-" + doomed).value, "Third kept");
	assert.equal(w.document.getElementById("va-script-topic-" + doomed).value, "third topic");
	assert.equal(w.__VIDEO_PROJECTS[doomed - 1].n, doomed);
	assert.equal(w.__VIDEO_PROJECTS[doomed - 1].name, "Video " + doomed);
	assert.equal(w.__VIDEO_PROJECTS[doomed - 1].assets.length, 1);
	assert.equal(w.document.querySelectorAll("#va-gallery-" + doomed + " .va-card").length, 1);

	/* No gap: nothing is addressed by the old last number any more. */
	assert.equal(w.document.getElementById("video-" + last), null);
	assert.equal(w.document.getElementById("va-title-" + last), null);
});

test("the theme CSS keeps the requested control proportions in every theme", () => {
	/* Delete icon on a generated-image card: 40% smaller than 20x20 / 2px. */
	assert.match(APP_CSS, /\.va-card-remove\s*\{[^}]*width:\s*\n?\s*12px/);
	assert.match(APP_CSS, /\.va-card-remove\s*\{[^}]*height:\s*\n?\s*12px/);
	assert.match(APP_CSS, /\.va-card-remove\s*\{[^}]*padding:\s*\n?\s*0;/);

	/* Add to Video + Fullscreen: 30% smaller than the 1rem / 12px 24px rule. */
	assert.match(APP_CSS, /\.va-ai-actions \.upload-btn/);
	assert.match(APP_CSS, /\.va-body \.va-ai-actions \.upload-btn\.small\s*\{[^}]*padding:\s*\n?\s*8px 17px/);
	assert.match(APP_CSS, /\.va-body \.va-ai-actions \.upload-btn\.small\s*\{[^}]*font-size:\s*\n?\s*0\.7rem/);

	/* The old API button styling is gone; the delete button has its own. */
	assert.equal(APP_CSS.includes(".va-api-btn"), false);
	assert.match(APP_CSS, /\.va-delete-btn\s*\{/);
	assert.match(APP_CSS, /html\[data-theme\] \.va-delete-btn,/);

	/* No dangling bulk-grid selectors (session #240 leftovers). */
	for (const selector of [".bulk-panel", ".bulk-slot", ".bulk-status", ".bulk-summary", ".bulk-caption-wrap", ".bulk-arrow"]) {
		assert.equal(APP_CSS.includes(selector), false, selector + " is still styled");
	}
});
