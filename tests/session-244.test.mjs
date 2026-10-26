/*
 * Session #244 contract, guarded in jsdom:
 *
 *  1. a failed step is retried INSIDE its row - silently: the row keeps
 *     the editor's script-section loading animation (.va-spinner +
 *     va-loading-pulse) and never prints an error;
 *  2. an abort ("signal is aborted without reason", "The user aborted a
 *     request") never becomes a row's status text;
 *  3. a step that never succeeds still shows no error, no warning colour
 *     and no toast - the row simply goes back to Ready;
 *  4. the quick batch table keeps its layout during processing:
 *     table-layout: fixed, and the status line wraps inside its column;
 *  5. Site Admin splits the credits into THREE pages - Guest Credits by
 *     IP, Plans and Accounts Credits - instead of two cards in tab 1;
 *  6. a CMS page (and its Top Menu / Footer link) can be deleted both
 *     from the saved-page pill and from the editor itself.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHTML } from "../src/page.ts";
import { APP_JS } from "../src/client/app-js.ts";
import { APP_CSS } from "../src/client/styles.ts";
import { CONFIG_PAGE_SCRIPT } from "../src/client/config-page-js.ts";

const script = "Morning yoga opens the shoulders. Long tails follow the breath.";
const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

/* ------------------------------------------------------------------ */
/* studio harness (the quick batch table lives inside the studio)      */
/* ------------------------------------------------------------------ */

function makeApp() {
	const dom = new JSDOM(createHTML(), { runScripts: "outside-only", url: "https://studio.test/free" });
	const w = dom.window;
	let objectUrlId = 0;
	w.alert = () => { };
	w.confirm = () => true;
	w.scrollTo = () => { };
	w.URL.createObjectURL = () => "blob:session-244-" + (++objectUrlId);
	w.URL.revokeObjectURL = () => { };
	w.__PLAN_MODE = "freemium";
	w.eval(APP_JS.replace("__PROMPTS_JSON__", "[]"));
	/* keep the silent retries instant in the tests */
	w.__BATCH_RETRY.attempts = 3;
	w.__BATCH_RETRY.baseMs = 1;
	w.__BATCH_RETRY.maxMs = 2;
	return { dom, w };
}

async function waitFor(predicate, timeoutMs = 8000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		let value = false;
		try {
			value = !!predicate();
		}
		catch (waitError) {
			value = false;
		}
		if (value) return true;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	return false;
}

function jsonResponse(data, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => "application/json" },
		json: async () => data,
		blob: async () => new Blob([JSON.stringify(data)]),
		body: null
	};
}

/*
 * options.voiceoverFails: how many of the first voiceover calls fail.
 * options.voiceoverAlwaysFails: every voiceover call fails.
 * options.voiceoverThrowsAbort: the voiceover call rejects like an abort.
 */
function mockBatchRoutes(w, calls, options = {}) {
	let voiceCalls = 0;
	let promptCalls = 0;
	w.fetch = async (url, opts = {}) => {
		const path = String(url);
		const method = String(opts.method || "GET").toUpperCase();
		calls.push({ path, method, body: opts.body || null });

		if (path === "/api/session") return jsonResponse({ success: true, authenticated: true, user: { username: "T", usertype: "free" }, remaining: {} });
		if (path === "/api/credits") return jsonResponse({ success: true, plan: { id: "free", label: "Free", limits: { images: 50 } }, remaining: { images: 20 } });
		if (path === "/api/voiceover") {
			voiceCalls += 1;
			if (options.voiceoverThrowsAbort) {
				const error = new Error("signal is aborted without reason");
				error.name = "AbortError";
				throw error;
			}
			if (options.voiceoverAlwaysFails || voiceCalls <= (options.voiceoverFails || 0)) {
				return jsonResponse({ success: false, error: "MeloTTS is busy" }, 503);
			}
			return {
				ok: true,
				status: 200,
				headers: { get: () => "audio/mpeg" },
				blob: async () => new w.Blob([new Uint8Array([255, 243, 1, 2, 3, 4])], { type: "audio/mpeg" })
			};
		}
		if (path === "/api/image-prompts" && method === "POST") {
			promptCalls += 1;
			if (promptCalls <= (options.promptTimeouts || 0)) {
				const timeout = new Error("The request took too long");
				timeout.name = "TimeoutError";
				throw timeout;
			}
			const batch = JSON.parse(opts.body).batch || { count: 2, offset: 0 };
			return jsonResponse({ success: true, prompts: Array.from({ length: batch.count },
				(_, i) => "Scene " + (batch.offset + i) + " detailed art direction"), style: "Neon Night" });
		}
		if (path === "/api/image-batch" && method === "POST") {
			const body = JSON.parse(opts.body);
			const events = [{ type: "start", count: body.prompts.length, width: 1024, height: 576 }];
			body.prompts.forEach((_, index) => events.push({ type: "image", index, ok: true, mime: "image/png", data: pngBase64 }));
			events.push({ type: "done", generated: body.prompts.length, failed: 0 });
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
		return jsonResponse({ success: false, error: "Unexpected mock request: " + method + " " + path }, 404);
	};
}

function blankTable(w) {
	while (w.__BATCH_ROWS.length) {
		w.removeBatchRow(w.__BATCH_ROWS[0].id);
	}
}

function statusCell(w, row) {
	return w.document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="status"]');
}

/* ------------------------------------------------------------------ */
/* 1 - a retried step finishes the row and never shows a failure       */
/* ------------------------------------------------------------------ */

test("a failing step is retried inside the row, and the row finishes", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockBatchRoutes(w, calls, { voiceoverFails: 2 });
	await new Promise((resolve) => setTimeout(resolve, 0));

	blankTable(w);
	const row = w.addBatchRow({ script: script, minutes: 1 });

	await w.runBatchRow(row);

	assert.equal(calls.filter((call) => call.path === "/api/voiceover").length, 3, "two silent retries, then success");
	assert.ok(w.batchRowFinished(row), "the row still finishes");
	assert.equal(row.error, "", "no error is recorded on the row");
	assert.equal(statusCell(w, row).getAttribute("data-stage"), "done");
	assert.doesNotMatch(statusCell(w, row).textContent, /MeloTTS|busy|failed|error|abort|signal/i);
	assert.equal(statusCell(w, row).querySelector(".va-spinner"), null, "the spinner stops once the row is done");
});

/* ------------------------------------------------------------------ */
/* 2 - the working row shows the editor's script-section animation     */
/* ------------------------------------------------------------------ */

test("the working row paints the same loading animation as the editor's script box", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockBatchRoutes(w, calls, { voiceoverFails: 1 });
	await new Promise((resolve) => setTimeout(resolve, 0));

	blankTable(w);
	const row = w.addBatchRow({ script: script });
	w.setBatchStage(row, "voice", "Speaking 60 characters");

	const cell = statusCell(w, row);
	assert.equal(cell.getAttribute("data-loading"), "1");
	const spinner = cell.querySelector(".va-spinner");
	assert.ok(spinner, "the editor's .va-spinner is reused, not a new animation");
	assert.match(cell.textContent, /Speaking the script \(MP3\)/);
	assert.doesNotMatch(cell.textContent, /retry|retrying|attempt|failed/i, "a retry is not announced");
	assert.match(APP_CSS, /\.va-spinner\s*\{/);
	assert.match(APP_CSS, /\.batch-row-status\[data-loading="1"\][\s\S]{0,160}va-loading-pulse/);
});

/* ------------------------------------------------------------------ */
/* 3 - an abort never becomes a row's status text                      */
/* ------------------------------------------------------------------ */

test("abort wording ('signal is aborted without reason') never reaches the table", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockBatchRoutes(w, calls, { voiceoverThrowsAbort: true });
	await new Promise((resolve) => setTimeout(resolve, 0));

	blankTable(w);
	const row = w.addBatchRow({ script: script });

	await w.runBatchRow(row);

	const text = statusCell(w, row).textContent;
	assert.doesNotMatch(text, /abort|signal|DOMException/i);
	assert.doesNotMatch(text, /\u26a0/, "no warning glyph");
	assert.equal(row.error, "");
	assert.equal(w.batchRowFinished(row), false);
	assert.equal(w.document.querySelectorAll('[data-batch-slot="preview"] button').length, 0, "no dead buttons");
	/* and the row is simply pending again */
	assert.equal(row.stage, "ready");
});

/* ------------------------------------------------------------------ */
/* 3b - a Stop aborts the row: no error text, no retry                 */
/* ------------------------------------------------------------------ */

test("Stop aborts an in-flight step without retrying or printing anything", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	w.fetch = async (url, opts = {}) => {
		const path = String(url);
		calls.push({ path, method: String(opts.method || "GET").toUpperCase(), body: opts.body || null });
		if (path === "/api/voiceover") {
			/* a real fetch rejects with AbortError when the row's controller aborts */
			return new Promise((resolve, reject) => {
				const signal = opts.signal;
				const fail = () => {
					const error = new Error("The user aborted a request.");
					error.name = "AbortError";
					reject(error);
				};
				if (signal) {
					if (signal.aborted) fail();
					else signal.addEventListener("abort", fail);
				}
			});
		}
		return jsonResponse({ success: true });
	};
	await new Promise((resolve) => setTimeout(resolve, 0));

	blankTable(w);
	const row = w.addBatchRow({ script: script });

	const running = w.runBatchRow(row);
	await waitFor(() => !!row.controller);
	w.stopBatchRows();
	await running;

	assert.equal(calls.filter((call) => call.path === "/api/voiceover").length, 1, "a stop is never retried");
	assert.equal(row.stage, "ready");
	assert.equal(row.error, "");
	assert.doesNotMatch(statusCell(w, row).textContent, /abort|signal|error|\u26a0/i);
});

/* ------------------------------------------------------------------ */
/* 4 - a step that never succeeds is still silent                      */
/* ------------------------------------------------------------------ */

test("a step that keeps failing shows no error UI at all", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockBatchRoutes(w, calls, { voiceoverAlwaysFails: true });
	await new Promise((resolve) => setTimeout(resolve, 0));

	blankTable(w);
	const row = w.addBatchRow({ script: script });

	await w.runBatchRow(row);

	assert.equal(calls.filter((call) => call.path === "/api/voiceover").length, 3, "every attempt was a quiet retry");
	assert.equal(row.stage, "ready", "the row is simply ready to try again");
	assert.equal(row.error, "");
	const cell = statusCell(w, row);
	assert.equal(cell.getAttribute("data-stage"), "ready");
	assert.equal(cell.getAttribute("data-loading"), "0");
	assert.doesNotMatch(cell.textContent, /MeloTTS|busy|failed|error|\u26a0|abort|signal/i);
	assert.match(cell.textContent, /Ready/);
	/* the row stays runnable: the next Generate picks it up again */
	assert.equal(w.batchRowPending(row), true);
});

/* ------------------------------------------------------------------ */
/* 5 - the table's layout is fixed while rows process                  */
/* ------------------------------------------------------------------ */

test("the batch table keeps a fixed layout and wraps its status line", () => {
	assert.match(APP_CSS, /\.batch-table-edit\s*\{[\s\S]{0,900}table-layout:\s*fixed/);
	assert.match(APP_CSS, /\.batch-table-edit\s*\{[\s\S]{0,900}min-width:\s*\d+px/);
	assert.match(APP_CSS, /\.batch-row-status\s*\{[\s\S]{0,400}overflow-wrap:\s*anywhere/);
	/* seven columns, still declared, still percentaged */
	for (const column of ["script", "style", "min", "resolution", "orientation", "preview", "export"]) {
		assert.match(APP_CSS, new RegExp("\\.batch-col-" + column + "\\b"));
	}
	assert.equal(
		(APP_CSS.match(/\.batch-col-[a-z]+\s*\{\s*width:/g) || []).length >= 6,
		true,
		"the column widths are still declared"
	);
});

/* ------------------------------------------------------------------ */
/* 4b - a timeout is retried (unlike a stop) and still stays silent    */
/* ------------------------------------------------------------------ */

test("a timed-out request is retried quietly, unlike a stop", async () => {
	const calls = [];
	const { dom, w } = makeApp();
	test.after(() => dom.window.close());
	mockBatchRoutes(w, calls, { promptTimeouts: 1 });
	await new Promise((resolve) => setTimeout(resolve, 0));

	blankTable(w);
	const row = w.addBatchRow({ script: script });

	await w.runBatchRow(row);

	assert.equal(calls.filter((call) => call.path === "/api/image-prompts").length, 5, "four scene batches plus one timeout retry");
	assert.ok(w.batchRowFinished(row), "and the row finished");
	assert.doesNotMatch(statusCell(w, row).textContent, /timeout|too long|abort|signal/i);

});

/* ------------------------------------------------------------------ */
/* 6 - Site Admin: three separate credit pages                         */
/* ------------------------------------------------------------------ */

function makeAdmin() {
	const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
		runScripts: "outside-only",
		url: "https://studio.test/2026-10-26/config/uvxyz"
	});
	const w = dom.window;
	w.confirm = () => true;
	w.alert = () => { };
	let pages = [
		{ id: "cms-1", slug: "about-us", url: "/about-us", title: "About Us", pageLink: "Link Placed On Top Menu", blocks: [{ type: "paragraph", text: "hi" }] },
		{ id: "cms-2", slug: "terms", url: "/terms", title: "Terms", pageLink: "Link Placed On Footer", blocks: [] }
	];
	const calls = [];
	w.fetch = async (url, opts = {}) => {
		const path = String(url);
		const method = String(opts.method || "GET").toUpperCase();
		const body = opts.body ? JSON.parse(opts.body) : null;
		calls.push({ path, method, body });
		const ok = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });

		if (path.startsWith("/api/config/verify")) return ok({ valid: true, theme: "default" });
		if (path.startsWith("/api/config/cms/delete")) {
			pages = pages.filter((page) => page.id !== body.id);
			return ok({ success: true, maxPages: 8, pages });
		}
		if (path.startsWith("/api/config/cms")) return ok({ success: true, maxPages: 8, pages });
		if (path.startsWith("/api/config/users")) {
			return ok({
				success: true,
				day: "2026-10-26",
				resetsAt: "2026-10-26T16:00:00.000Z",
				plans: [
					{ id: "free", label: "Free", limits: { images: 70000 } },
					{ id: "paid_user", label: "Paid", limits: { images: 1200 } }
				],
				users: [
					{ username: "ana", email: "ana@studio.test", usertype: "paid_user", plan: { id: "paid_user", label: "Paid", limits: { images: 1200 } }, planLabel: "Paid", planImages: 1200, used: { images: 12 }, remaining: { images: 1188 } },
					{ username: "ben", email: "ben@studio.test", usertype: "free", plan: { id: "free", label: "Free", limits: { images: 70000 } }, planLabel: "Free", planImages: 70000, used: { images: 3 }, remaining: { images: 69997 } }
				]
			});
		}
		if (path.startsWith("/api/config/ipcredits")) return ok({ success: true, plan: { limits: { images: 10 } }, rows: [] });
		if (path.startsWith("/api/config/workers")) return ok({ success: true, workers: [] });
		if (path.startsWith("/api/config/theme")) return ok({ success: true, theme: "default" });
		if (path.startsWith("/api/config/payment-gateway")) return ok({ success: true, gateway: {} });
		if (path.startsWith("/api/config/payments")) return ok({ success: true, items: [], total: 0, page: 1, totalPages: 1 });
		return ok({ success: true });
	};

	const html = CONFIG_PAGE_SCRIPT;
	const start = html.lastIndexOf("<script>");
	const end = html.lastIndexOf("</script>");
	w.eval(html.slice(start + 8, end));

	return { dom, w, calls, pages: () => pages };
}

async function unlockAdmin(w) {
	w.document.getElementById("cfg-pw-input").value = "#123admin%";
	w.document.getElementById("cfg-pw-form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
	await waitFor(() => w.document.getElementById("cfg-unlocked-view").style.display === "block");
	await new Promise((resolve) => setTimeout(resolve, 20));
}

test("Site Admin shows Guest Credits by IP, Plans and Accounts Credits as separate pages", async () => {
	const { dom, w } = makeAdmin();
	test.after(() => dom.window.close());

	const tabs = [...w.document.querySelectorAll("[data-cfg-tab]")].map((btn) => ({
		id: btn.getAttribute("data-cfg-tab"),
		label: btn.textContent.trim()
	}));
	assert.deepEqual(tabs.map((tab) => tab.id), [
		"general",
		"guests",
		"plans",
		"accounts",
		"payment-gateway",
		"payments",
		"cms"
	]);
	assert.match(tabs[1].label, /Guest Credits by IP/);
	assert.match(tabs[2].label, /Plans/);
	assert.match(tabs[3].label, /Accounts Credits/);

	for (const panel of ["general", "guests", "plans", "accounts", "payment-gateway", "payments", "cms"]) {
		assert.ok(w.document.getElementById("cfg-panel-" + panel), "panel " + panel + " exists");
	}

	/* each credit surface lives in its own panel */
	const guests = w.document.getElementById("cfg-panel-guests");
	const plans = w.document.getElementById("cfg-panel-plans");
	const accounts = w.document.getElementById("cfg-panel-accounts");
	const general = w.document.getElementById("cfg-panel-general");

	assert.ok(guests.querySelector("#cfg-guests-list"));
	assert.ok(guests.querySelector("#cfg-guests-refresh"));
	assert.equal(general.querySelector("#cfg-guests-list"), null, "guest IPs are not in tab 1 any more");

	assert.ok(plans.querySelector("#cfg-plans-list"));
	assert.equal(plans.querySelector("#cfg-users-list"), null);

	assert.ok(accounts.querySelector("#cfg-users-list"));
	assert.ok(accounts.querySelector("#cfg-credit-user"));
	assert.ok(accounts.querySelector("#cfg-credit-plan"));
	assert.equal(general.querySelector("#cfg-users-list"), null, "accounts are not in tab 1 any more");

	/* the Plans page renders the plan definitions from the API payload */
	await unlockAdmin(w);
	w.document.querySelector('[data-cfg-tab="plans"]').click();
	await waitFor(() => plans.querySelectorAll("[data-cfg-plan-row]").length >= 3);

	const rows = [...plans.querySelectorAll("[data-cfg-plan-row]")].map((row) => row.textContent);
	assert.equal(rows.length, 3, "free, paid and the guest plan");
	assert.match(rows[0], /Free/);
	assert.match(rows[0], /70,000 AI images \/ day/);
	assert.match(rows[0], /1 account/);
	assert.match(rows[1], /Paid/);
	assert.match(rows[1], /1,200 AI images \/ day/);
	assert.match(rows[2], /Guest/);
	assert.match(rows[2], /10 AI images \/ day/);

	/*
	 * The Accounts page labels every row with the email stored on the
	 * account and the plan detail (label + daily image allowance), so a
	 * username is never shown without its plan.
	 */
	w.document.querySelector('[data-cfg-tab="accounts"]').click();
	await waitFor(() => w.document.querySelectorAll("[data-cfg-user]").length === 2);

	const accountRows = [...w.document.querySelectorAll("[data-cfg-user]")].map((row) => ({
		username: row.getAttribute("data-cfg-user"),
		plan: row.getAttribute("data-cfg-user-plan"),
		text: row.textContent
	}));

	assert.equal(accountRows.length, 2);
	accountRows.forEach((row) => {
		assert.match(row.text, /@studio\.test/, "the account email is shown");
		assert.match(row.text, /(Free|Paid) plan · [\d,]+ AI images \/ day/, "the plan detail is shown");
	});

	const paidRow = accountRows.find((row) => row.username === "ana");
	const freeRow = accountRows.find((row) => row.username === "ben");
	assert.equal(paidRow.plan, "paid_user");
	assert.match(paidRow.text, /Paid plan · 1,200 AI images \/ day/);
	assert.match(paidRow.text, /1,188 of 1,200 images left today/);
	assert.equal(freeRow.plan, "free");
	assert.match(freeRow.text, /Free plan · 70,000 AI images \/ day/);
	assert.match(freeRow.text, /69,997 of 70,000 images left today/);

	/* the plan picker's labels come from the payload, not hard-coded copy */
	const freeOption = w.document.querySelector('#cfg-credit-plan option[value="free"]');
	assert.match(freeOption.textContent, /70,000 AI images \/ day/);
});

/* ------------------------------------------------------------------ */
/* 7 - CMS pages (menu URLs) can be deleted from both places           */
/* ------------------------------------------------------------------ */

test("a CMS page can be deleted from its saved-page pill", async () => {
	const { dom, w, calls, pages } = makeAdmin();
	test.after(() => dom.window.close());

	await unlockAdmin(w);
	w.document.querySelector('[data-cfg-tab="cms"]').click();
	await waitFor(() => w.document.querySelectorAll(".cms-saved-pill").length === 2);

	const pill = w.document.querySelector(".cms-saved-pill");
	const del = pill.querySelector('[data-act="del"]');
	assert.ok(del, "the pill carries a Delete button");
	del.click();
	await waitFor(() => w.document.querySelectorAll(".cms-saved-pill").length === 1);

	const deletion = calls.find((call) => call.path === "/api/config/cms/delete");
	assert.ok(deletion, "the delete endpoint was called");
	assert.equal(deletion.method, "POST");
	assert.equal(deletion.body.id, "cms-1");
	assert.equal(deletion.body.slug, "about-us");
	assert.equal(deletion.body.pw, "#123admin%", "the unlocked password travels with the request");

	assert.match(w.document.getElementById("cms-msg").textContent, /Deleted \/about-us/);
	assert.match(w.document.getElementById("cms-msg").className, /ok/);
	assert.equal(pages().length, 1);
	assert.match(w.document.getElementById("cms-count-label").textContent, /1 \/ 8/);
});

test("a CMS page can be deleted from the editor it is open in", async () => {
	const { dom, w, calls, pages } = makeAdmin();
	test.after(() => dom.window.close());

	await unlockAdmin(w);
	w.document.querySelector('[data-cfg-tab="cms"]').click();
	await waitFor(() => w.document.querySelectorAll(".cms-saved-pill").length === 2);

	const button = w.document.getElementById("cms-delete-btn");
	assert.ok(button, "the editor has a Delete This Page button");
	assert.equal(button.style.display, "none", "hidden while a new page is being written");

	/* open the second page in the editor */
	w.document.querySelectorAll('.cms-saved-pill [data-act="edit"]')[1].click();
	assert.equal(button.style.display, "", "shown while an existing page is open");
	assert.equal(w.document.getElementById("cms-edit-id").value, "cms-2");

	button.click();
	await waitFor(() => w.document.querySelectorAll(".cms-saved-pill").length === 1);

	const deletion = calls.find((call) => call.path === "/api/config/cms/delete");
	assert.equal(deletion.body.id, "cms-2");
	assert.equal(pages().length, 1);
	assert.equal(w.document.getElementById("cms-edit-id").value, "", "the editor is cleared with the page");
	assert.equal(button.style.display, "none", "and the delete button goes away with it");
	assert.match(w.document.getElementById("cms-msg").textContent, /Deleted \/terms/);
});
