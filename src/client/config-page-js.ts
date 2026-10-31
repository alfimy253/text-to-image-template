/*
 * Dynamic Site Configuration — Real Full Page (`src/client/config-page-js.ts`)
 *
 * Rendered ONLY when the Worker serves `/{Asia-Taipei-day}/config/uvxyz`.
 *
 * Key architectural guarantees:
 *   1. Real full page (`#cfg-page` on `body.cfg-real-page`), NEVER a modal
 *      overlay (`position: fixed` backdrop).
 *   2. Hidden `#studio-app` + `#video-canvas` remain in the DOM so Background
 *      Worker mode (`window.workerRunJob`) continues to render WebCodecs MP4s.
 *   3. All 4 admin sections live under the SAME dynamic config URL:
 *        - General & Themes (7 themes, workers, worker mode, plans, guest IPs)
 *        - Local Payment Gateway (gateway details + upload instructions for /upgrade)
 *        - Payment Transactions (paginated screenshots, click-to-fullscreen,
 *          transaction-number verification -> sets `usertype = "paid_user"`)
 *        - CMS Pages (max 8 flat pages, required Page URL, `Page Link` dropdown,
 *          `+ Add Paragraph` with `min-height: 200px`, URL-only images max 2 per
 *          line with click-to-fullscreen, and right-hand Live Preview)
 */

export const CONFIG_PAGE_SCRIPT = `
<style id="cfg-page-styles">
	body.cfg-real-page {
		margin: 0 !important;
		padding: 0 !important;
		overflow-x: hidden !important;
		overflow-y: auto !important;
		height: auto !important;
		min-height: 100vh !important;
		background: #0b0e14 !important;
		color: #e5e7eb !important;
		font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
	}

	/* Hide landing/studio visual chrome while keeping #video-canvas alive in DOM for Worker Mode */
	body.cfg-real-page #landing-page,
	body.cfg-real-page #auth-footer,
	body.cfg-real-page #auth-modal {
		display: none !important;
	}

	body.cfg-real-page #studio-app {
		position: absolute !important;
		left: -99999px !important;
		top: 0 !important;
		width: 1px !important;
		height: 1px !important;
		overflow: hidden !important;
		opacity: 0 !important;
		pointer-events: none !important;
	}

	.cfg-page {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		background: #0b0e14;
		color: #e5e7eb;
	}

	.cfg-topbar {
		border-bottom: 1px solid #1f2633;
		background: #11151f;
		padding: 16px 28px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}

	.cfg-brand {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.cfg-brand-badge {
		background: #f59e0b;
		color: #111827;
		font-weight: 800;
		font-size: 0.76rem;
		padding: 4px 9px;
		border-radius: 6px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.cfg-brand h1 {
		margin: 0;
		font-size: 1.2rem;
		color: #ffffff;
	}

	.cfg-brand-path {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.8rem;
		color: #9ca3af;
	}

	.cfg-toplinks {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.cfg-toplinks a {
		color: #cbd5e1;
		text-decoration: none;
		font-size: 0.86rem;
		font-weight: 600;
		padding: 7px 12px;
		border-radius: 8px;
		border: 1px solid #262f40;
		background: #171c28;
	}

	.cfg-toplinks a:hover {
		border-color: #f59e0b;
		color: #ffffff;
	}

	.cfg-container {
		width: 100%;
		max-width: 1280px;
		margin: 0 auto;
		padding: 28px 24px 64px;
		box-sizing: border-box;
		flex: 1;
	}

	.cfg-unlock-card {
		max-width: 480px;
		margin: 48px auto;
		background: #141923;
		border: 1px solid #262f40;
		border-radius: 14px;
		padding: 28px;
		box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
	}

	.cfg-unlock-card h2 {
		margin: 0 0 8px;
		font-size: 1.35rem;
		color: #ffffff;
	}

	.cfg-sub {
		margin: 0 0 18px;
		font-size: 0.9rem;
		color: #9ca3af;
		line-height: 1.55;
	}

	.cfg-tabs {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 24px;
		padding-bottom: 14px;
		border-bottom: 1px solid #1f2633;
	}

	.cfg-tab-btn {
		padding: 10px 18px;
		border-radius: 9px;
		border: 1px solid #283244;
		background: #151a25;
		color: #cbd5e1;
		font-size: 0.9rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.cfg-tab-btn:hover {
		border-color: #475569;
		color: #ffffff;
	}

	.cfg-tab-btn.active {
		background: #f59e0b;
		border-color: #f59e0b;
		color: #111827;
	}

	.cfg-panel {
		display: none;
	}

	.cfg-panel.active {
		display: block;
	}

	.cfg-card {
		background: #141923;
		border: 1px solid #252e3f;
		border-radius: 14px;
		padding: 24px;
		margin-bottom: 22px;
	}

	.cfg-card h2 {
		margin: 0 0 6px;
		font-size: 1.2rem;
		color: #ffffff;
	}

	.cfg-card h3 {
		margin: 0 0 8px;
		font-size: 1.02rem;
		color: #f3f4f6;
	}

	.cfg-input,
	.cfg-select,
	.cfg-textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 10px 13px;
		border-radius: 9px;
		border: 1px solid #2e3a4f;
		background: #0d1118;
		color: #f9fafb;
		font-size: 0.93rem;
		font-family: inherit;
	}

	.cfg-input:focus,
	.cfg-select:focus,
	.cfg-textarea:focus {
		outline: none;
		border-color: #f59e0b;
	}

	.cfg-label {
		display: block;
		font-size: 0.84rem;
		font-weight: 700;
		color: #cbd5e1;
		margin-bottom: 6px;
	}

	.cfg-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 10px 18px;
		border-radius: 9px;
		border: 1px solid #334155;
		background: #1e2636;
		color: #f8fafc;
		font-weight: 700;
		font-size: 0.88rem;
		cursor: pointer;
		transition: opacity 0.15s ease, border-color 0.15s ease;
	}

	.cfg-btn:hover {
		border-color: #64748b;
	}

	.cfg-btn-primary {
		background: #f59e0b;
		border-color: #f59e0b;
		color: #111827;
	}

	.cfg-btn-success {
		background: #10b981;
		border-color: #10b981;
		color: #052e16;
	}

	.cfg-btn-danger {
		background: rgba(239, 68, 68, 0.15);
		border-color: rgba(239, 68, 68, 0.45);
		color: #fca5a5;
	}

	.cfg-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.cfg-err {
		color: #f87171;
		font-size: 0.85rem;
		min-height: 1.2em;
		margin-top: 8px;
	}

	.cfg-msg {
		font-size: 0.86rem;
		margin-top: 10px;
		min-height: 1.25em;
	}

	.cfg-msg.ok { color: #34d399; }
	.cfg-msg.err { color: #f87171; }

	/* Theme Cards */
	.cfg-themes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 12px;
		margin: 14px 0 18px;
	}

	.cfg-theme {
		border: 2px solid #263042;
		border-radius: 11px;
		padding: 13px;
		cursor: pointer;
		background: #0f141d;
		transition: border-color 0.15s, background 0.15s;
	}

	.cfg-theme:hover { border-color: #475569; }
	.cfg-theme.selected { border-color: #f59e0b; background: #1a1f2c; }
	.cfg-theme-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
	.cfg-theme-name { font-weight: 700; font-size: 0.94rem; color: #ffffff; }
	.cfg-swatches { display: flex; gap: 4px; }
	.cfg-swatches span { width: 15px; height: 15px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); }
	.cfg-theme-desc { font-size: 0.78rem; color: #9ca3af; line-height: 1.4; }

	/* Workers & Credits */
	.cfg-two-col {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
		gap: 20px;
	}

	.cfg-worker-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 11px;
		border: 1px solid #252f42;
		border-radius: 8px;
		background: #0d1118;
		margin-bottom: 6px;
		font-size: 0.82rem;
	}

	.cfg-worker-row code {
		flex: 1;
		color: #e5e7eb;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* API rotation (backup worker pool) */
	.cfg-relay-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 12px;
		margin-top: 12px;
	}
	.cfg-relay-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.84rem;
		color: #e5e7eb;
	}
	.cfg-relay-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: #3b82f6; }
	.cfg-relay-table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 12px;
		font-size: 0.8rem;
	}
	.cfg-relay-table th,
	.cfg-relay-table td {
		text-align: left;
		padding: 7px 9px;
		border-bottom: 1px solid #252f42;
		vertical-align: top;
	}
	.cfg-relay-table th { color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; font-size: 0.72rem; }
	.cfg-relay-table code { color: #e5e7eb; word-break: break-all; }
	.cfg-relay-state {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.cfg-relay-state.ready { background: rgba(34,197,94,0.16); color: #4ade80; }
	.cfg-relay-state.busy { background: rgba(59,130,246,0.16); color: #60a5fa; }
	.cfg-relay-state.cooling { background: rgba(245,158,11,0.16); color: #fbbf24; }
	.cfg-relay-state.offline { background: rgba(239,68,68,0.16); color: #f87171; }
	.cfg-relay-hint { margin-top: 10px; font-size: 0.78rem; color: #9ca3af; line-height: 1.5; }

	/* LLM provider rotation (bug fix #271) */
	.cfg-llm-card textarea.cfg-input {
		min-height: 84px;
		resize: vertical;
		font-family: inherit;
		line-height: 1.45;
	}
	.cfg-llm-providers { display: grid; gap: 8px; margin-top: 12px; }
	.cfg-llm-provider {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		padding: 9px 11px;
		border: 1px solid #252f42;
		border-radius: 8px;
		background: #0d1118;
		font-size: 0.82rem;
	}
	.cfg-llm-provider code { color: #e5e7eb; }
	.cfg-llm-provider .cfg-llm-meta { color: #9ca3af; font-size: 0.76rem; }

	/* Accounts Credits: one row per account, email + plan detail */
	.cfg-user-row {
		align-items: flex-start;
		flex-wrap: wrap;
	}

	.cfg-user-id {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 160px;
		flex: 1;
	}

	.cfg-user-row .cfg-user-id code {
		font-size: 0.86rem;
		font-weight: 700;
	}

	.cfg-user-email {
		font-size: 0.76rem;
		color: #9ca3af;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cfg-user-plan {
		display: flex;
		flex-direction: column;
		gap: 3px;
		align-items: flex-end;
		text-align: right;
	}

	.cfg-plan-badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid #2c3a52;
		background: #111827;
		color: #cbd5e1;
		font-size: 0.74rem;
		white-space: nowrap;
	}

	.cfg-plan-badge.paid {
		border-color: #b45309;
		background: #2a1c08;
		color: #fbbf24;
	}

	.cfg-user-usage {
		font-size: 0.74rem;
		color: #9ca3af;
		white-space: nowrap;
	}

	.cfg-worker-status {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 13px;
		border-radius: 9px;
		background: #0d1118;
		border: 1px solid #252f42;
		margin: 10px 0;
		font-size: 0.84rem;
	}

	.cfg-dot { width: 10px; height: 10px; border-radius: 50%; background: #6b7280; flex-shrink: 0; }
	.cfg-dot.idle { background: #10b981; box-shadow: 0 0 8px #10b981; }
	.cfg-dot.busy { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }

	.cfg-log {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.76rem;
		background: #090c11;
		border: 1px solid #1e2636;
		border-radius: 8px;
		padding: 9px 11px;
		max-height: 130px;
		overflow-y: auto;
		color: #9ca3af;
		line-height: 1.5;
	}

	/* Uploaded Payment Transactions Tab */
	.cfg-pay-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 18px;
	}

	.cfg-pay-list {
		display: grid;
		gap: 16px;
	}

	.cfg-pay-item {
		display: grid;
		grid-template-columns: 260px 1fr;
		gap: 20px;
		padding: 18px;
		border-radius: 12px;
		border: 1px solid #283244;
		background: #0f131c;
		align-items: start;
	}

	.cfg-pay-thumb-wrap {
		position: relative;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid #2e3a4f;
		background: #090c11;
	}

	.cfg-pay-img {
		width: 100%;
		height: 190px;
		object-fit: cover;
		display: block;
		cursor: zoom-in;
	}

	.cfg-pay-fs-btn {
		width: 100%;
		border: 0;
		border-top: 1px solid #283244;
		background: #171d29;
		color: #e5e7eb;
		padding: 8px 10px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
	}

	.cfg-pay-fs-btn:hover {
		background: #222b3d;
		color: #ffffff;
	}

	.cfg-badge {
		display: inline-flex;
		align-items: center;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.cfg-badge.pending {
		background: rgba(245, 158, 11, 0.16);
		color: #fbbf24;
		border: 1px solid rgba(245, 158, 11, 0.45);
	}

	.cfg-badge.approved {
		background: rgba(16, 185, 129, 0.16);
		color: #34d399;
		border: 1px solid rgba(16, 185, 129, 0.45);
	}

	.cfg-pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid #232c3d;
		flex-wrap: wrap;
	}

	/* CMS Split Layout (Left Editor + Right Live Preview) */
	.cms-saved-bar {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin: 14px 0 20px;
	}

	.cms-saved-pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 10px;
		border: 1px solid #2b364a;
		background: #0f131c;
		font-size: 0.84rem;
	}

	.cms-saved-pill.editing {
		border-color: #f59e0b;
		background: #1b202e;
	}

	.cms-split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 24px;
		align-items: start;
	}

	.cms-blocks-list {
		display: grid;
		gap: 14px;
		margin: 14px 0;
	}

	.cms-block-editor {
		border: 1px solid #2b364a;
		border-radius: 10px;
		padding: 14px;
		background: #0d1118;
	}

	.cms-block-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
		font-size: 0.82rem;
		font-weight: 700;
		color: #cbd5e1;
	}

	/* Explicit requirement: Add Paragraph button shows a textbox with min-height: 200px */
	.cms-paragraph-textbox {
		min-height: 200px !important;
		resize: vertical;
		line-height: 1.65;
	}

	.cms-preview-pane {
		position: sticky;
		top: 20px;
		border: 1px solid #2b364a;
		border-radius: 14px;
		background: #0f131c;
		padding: 22px;
		min-height: 420px;
	}

	.cms-preview-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		padding-bottom: 12px;
		margin-bottom: 16px;
		border-bottom: 1px solid #232c3d;
		font-size: 0.8rem;
		color: #9ca3af;
	}

	.cms-preview-title {
		font-size: 1.6rem;
		font-weight: 800;
		color: #ffffff;
		margin: 0 0 16px;
	}

	.cms-preview-p {
		font-size: 0.98rem;
		line-height: 1.75;
		color: #e2e8f0;
		margin: 0 0 16px;
		white-space: pre-wrap;
		word-break: break-word;
	}

	/* Strictly max 2 images per line */
	.cms-preview-img-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
		margin: 16px 0;
	}

	.cms-preview-img-card {
		border: 1px solid #2b364a;
		border-radius: 10px;
		overflow: hidden;
		background: #090c11;
		aspect-ratio: 16 / 10;
		position: relative;
	}

	.cms-preview-img-card img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		cursor: zoom-in;
	}

	/* Fullscreen Image Lightbox (for payment receipts & CMS images) */
	.cfg-fs-viewer {
		position: fixed;
		inset: 0;
		z-index: 99999;
		background: rgba(5, 7, 11, 0.94);
		display: none;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 24px;
	}

	.cfg-fs-viewer.open {
		display: flex;
	}

	.cfg-fs-viewer img {
		max-width: 95vw;
		max-height: 85vh;
		object-fit: contain;
		border-radius: 8px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.75);
	}

	.cfg-fs-close {
		position: fixed;
		top: 18px;
		right: 22px;
		background: rgba(255, 255, 255, 0.14);
		color: #ffffff;
		border: 1px solid rgba(255, 255, 255, 0.3);
		border-radius: 999px;
		padding: 8px 16px;
		font-weight: 700;
		cursor: pointer;
	}

	@media (max-width: 960px) {
		.cms-split {
			grid-template-columns: 1fr;
		}
		.cms-preview-pane {
			position: static;
		}
		.cfg-pay-item {
			grid-template-columns: 1fr;
		}
	}
</style>
<main id="cfg-page" class="cfg-page"></main>
<script>
(function() {
	"use strict";

	var THEMES = [
		{ id: "default", name: "Classic Dark", desc: "Obsidian studio with amber accents — the original look.", swatches: ["#0e0f12", "#16181d", "#f59e0b", "#e5e7eb"] },
		{ id: "strata", name: "Strata Editorial", desc: "Warm espresso & terracotta layers with refined serif display.", swatches: ["#171412", "#221d1a", "#e07a5f", "#f2eae1"] },
		{ id: "stellar", name: "Stellar Signal", desc: "Midnight navy with electric cyan & violet — crisp tech workspace.", swatches: ["#090d16", "#111827", "#38bdf8", "#a78bfa"] },
		{ id: "nightlab", name: "Night Lab", desc: "True-black OLED canvas with neon matrix green & monospace accents.", swatches: ["#050505", "#0d0f0e", "#22c55e", "#ecfdf5"] },
		{ id: "paper", name: "Editorial Paper", desc: "Warm ivory daylight theme with ink typography and vermilion highlights.", swatches: ["#f6f3ec", "#ffffff", "#c2410c", "#1c1917"] },
		{ id: "swiss", name: "Swiss Grid", desc: "Crisp white modernist grid with international orange and hairline rules.", swatches: ["#fafafa", "#ffffff", "#ff3b00", "#111111"] },
		{ id: "neo", name: "Neo Brutalist", desc: "Warm cream, bold 2px ink borders, hard offset shadows and punchy violet.", swatches: ["#fef9ef", "#ffffff", "#7c3aed", "#0f0f0f"] }
	];

	function esc(s) {
		return String(s == null ? "" : s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function applyThemeClientSide(id) {
		if (!id || id === "default") {
			document.documentElement.removeAttribute("data-theme");
		} else {
			document.documentElement.setAttribute("data-theme", id);
		}
		var meta = document.querySelector('meta[name="theme-color"]');
		if (meta) {
			var light = id === "paper" || id === "swiss" || id === "neo";
			meta.setAttribute("content", light ? "#f6f3ec" : "#0e0f12");
		}
	}

	// Switch document into Real Full Page mode (never a modal)
	document.body.classList.add("cfg-real-page");

	var pageRoot = document.getElementById("cfg-page");
	if (!pageRoot) {
		pageRoot = document.createElement("main");
		pageRoot.id = "cfg-page";
		pageRoot.className = "cfg-page";
		document.body.appendChild(pageRoot);
	}
	pageRoot.innerHTML =
		'<header class="cfg-topbar">' +
			'<div class="cfg-brand">' +
				'<span class="cfg-brand-badge">Site Admin</span>' +
				'<div>' +
					'<h1>Dynamic Site Configuration</h1>' +
					'<div class="cfg-brand-path">' + esc(window.location.pathname) + '</div>' +
				'</div>' +
			'</div>' +
			'<nav class="cfg-toplinks" aria-label="Quick navigation">' +
				'<a href="/">Landing Page</a>' +
				'<a href="/free">Free Studio</a>' +
				'<a href="/paid">Paid Studio</a>' +
				'<a href="/account">Account</a>' +
				'<a href="/upgrade">Upgrade Page</a>' +
			'</nav>' +
		'</header>' +
		'<div class="cfg-container">' +
			'<section id="cfg-pw-view" class="cfg-unlock-card">' +
				'<h2>Unlock Site Configuration</h2>' +
				'<p class="cfg-sub">This dynamic configuration page rotates daily at midnight (Asia/Taipei). Enter the administrator password to manage themes, workers, payment gateway details, payment approvals, and CMS pages.</p>' +
				'<form id="cfg-pw-form" autocomplete="off">' +
					'<label class="cfg-label" for="cfg-pw-input">Administrator Password</label>' +
					'<input id="cfg-pw-input" class="cfg-input" type="password" placeholder="Enter config password" autofocus />' +
					'<div class="cfg-err" id="cfg-pw-err"></div>' +
					'<div style="margin-top:14px;">' +
						'<button type="submit" class="cfg-btn cfg-btn-primary" style="width:100%;">Unlock Configuration Page</button>' +
					'</div>' +
				'</form>' +
			'</section>' +

			'<div id="cfg-unlocked-view" style="display:none;">' +
				'<nav class="cfg-tabs" role="tablist" aria-label="Configuration sections">' +
					'<button type="button" class="cfg-tab-btn active" data-cfg-tab="general">1. General &amp; Themes</button>' +
					'<button type="button" class="cfg-tab-btn" data-cfg-tab="guests">2. Guest Credits by IP</button>' +
					'<button type="button" class="cfg-tab-btn" data-cfg-tab="plans">3. Plans</button>' +
					'<button type="button" class="cfg-tab-btn" data-cfg-tab="accounts">4. Accounts Credits</button>' +
					'<button type="button" class="cfg-tab-btn" data-cfg-tab="payment-gateway">5. Local Payment Gateway</button>' +
					'<button type="button" class="cfg-tab-btn" data-cfg-tab="payments">6. Payment Transactions</button>' +
					'<button type="button" class="cfg-tab-btn" data-cfg-tab="cms">7. CMS Pages (Max 8)</button>' +
				'</nav>' +

				/* TAB 1: GENERAL & THEMES */
				'<section class="cfg-panel active" id="cfg-panel-general">' +
					'<div class="cfg-card">' +
						'<h2>Appearance Theme</h2>' +
						'<p class="cfg-sub">Choose a visual skin applied globally across the landing page, studio, account, upgrade, and CMS pages.</p>' +
						'<div class="cfg-themes" id="cfg-themes"></div>' +
						'<button type="button" class="cfg-btn cfg-btn-primary" id="cfg-save">Save Theme</button>' +
						'<div class="cfg-msg" id="cfg-status"></div>' +
					'</div>' +

					'<div class="cfg-two-col">' +
						'<div class="cfg-card">' +
							'<h2>Registered Background Workers</h2>' +
							'<p class="cfg-sub">Up to 3 extra deployments of this same app. They join the API rotation pool below: inference is spread across them, while accounts, sessions, credits, payments and CMS stay on this Worker.</p>' +
							'<div style="display:grid;gap:8px;">' +
								'<input id="cfg-worker-url-1" class="cfg-input" type="url" placeholder="Worker 1 URL (https://your-worker.workers.dev)" />' +
								'<input id="cfg-worker-url-2" class="cfg-input" type="url" placeholder="Worker 2 URL (optional)" />' +
								'<input id="cfg-worker-url-3" class="cfg-input" type="url" placeholder="Worker 3 URL (optional)" />' +
							'</div>' +
							'<div id="cfg-workers-list" style="margin-top:10px;"></div>' +
							'<div style="margin-top:12px;">' +
								'<button type="button" class="cfg-btn cfg-btn-primary" id="cfg-worker-save">Save Workers</button>' +
							'</div>' +
							'<div class="cfg-msg" id="cfg-worker-msg"></div>' +
						'</div>' +

						'<div class="cfg-card">' +
							'<h2>Background Worker Mode</h2>' +
							'<p class="cfg-sub">Keep this page open to render queued video jobs in the background via WebCodecs.</p>' +
							'<div class="cfg-worker-status">' +
								'<span class="cfg-dot" id="cfg-worker-dot"></span>' +
								'<span id="cfg-worker-state" style="flex:1;">Stopped</span>' +
								'<button type="button" class="cfg-btn cfg-btn-primary" id="cfg-worker-toggle">Start Worker</button>' +
							'</div>' +
							'<div class="cfg-log" id="cfg-worker-log">Worker idle. Click "Start Worker" to begin polling /api/worker/poll.</div>' +
						'</div>' +
					'</div>' +

					/* API ROTATION: the pool built from the URLs above */
					'<div class="cfg-card" style="margin-top:20px;" id="cfg-relay-card">' +
						'<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
							'<div>' +
								'<h2>API Rotation &amp; Backup Worker Pool</h2>' +
								'<p class="cfg-sub" style="margin-bottom:0;">Every AI route (<code>/api/image</code>, <code>/api/image-batch</code>, <code>/api/image-prompts</code>, <code>/api/script</code>, <code>/api/seo-plan</code>, <code>/api/voiceover</code>, <code>/image/gen</code>, <code>/tts</code>) can run on this Worker or on one of the registered backups above. Rotation spreads the Workers AI neuron bill and the inference load; accounts, credits, payments and CMS always stay on this Worker.</p>' +
							'</div>' +
							'<button type="button" class="cfg-btn" id="cfg-relay-refresh">Refresh Status</button>' +
						'</div>' +
						'<div class="cfg-relay-grid">' +
							'<label class="cfg-relay-row"><input type="checkbox" id="cfg-relay-enabled" /> Rotate inference across the pool</label>' +
							'<label class="cfg-relay-row"><input type="checkbox" id="cfg-relay-client" /> Rotate whole AI requests in the browser</label>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-relay-strategy">Rotation strategy</label>' +
								'<select class="cfg-input" id="cfg-relay-strategy">' +
									'<option value="round-robin">Round robin (even spread)</option>' +
									'<option value="least-pending">Least pending (busiest Worker skipped)</option>' +
									'<option value="weighted">Weighted (favour this Worker)</option>' +
								'</select>' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-relay-weight">This Worker\u2019s weight</label>' +
								'<input class="cfg-input" id="cfg-relay-weight" type="number" min="0" max="10" step="1" value="1" />' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-relay-attempts">Max endpoints tried per call</label>' +
								'<input class="cfg-input" id="cfg-relay-attempts" type="number" min="1" max="5" step="1" value="3" />' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-relay-timeout">Relay timeout (seconds)</label>' +
								'<input class="cfg-input" id="cfg-relay-timeout" type="number" min="5" max="240" step="5" value="100" />' +
							'</div>' +
						'</div>' +
						'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">' +
							'<button type="button" class="cfg-btn cfg-btn-primary" id="cfg-relay-save">Save Rotation</button>' +
							'<button type="button" class="cfg-btn" id="cfg-relay-test">Test Endpoints Now</button>' +
						'</div>' +
						'<div class="cfg-msg" id="cfg-relay-msg"></div>' +
						'<div id="cfg-relay-status"></div>' +
						'<p class="cfg-relay-hint">Set the same <code>RELAY_SECRET</code> environment variable on every Worker in the pool so relay tokens cannot be forged. Without it the built-in fallback secret is used (reported below).</p>' +
					'</div>' +

					/* LLM PROVIDER ROTATION (bug fix #271) */
					'<div class="cfg-card cfg-llm-card" style="margin-top:20px;" id="cfg-llm-card">' +
						'<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
							'<div>' +
								'<h2>LLM Providers &amp; OpenRouter</h2>' +
								'<p class="cfg-sub" style="margin-bottom:0;">The instruct model behind the SEO plan, the script writer, the scene-prompt writer and <code>POST /api/llm/generate</code> can run on <strong>Cloudflare Workers AI</strong> or on <strong>OpenRouter</strong>. This rotation sits above the Worker pool above: choosing Cloudflare still spreads the call across every backup Worker, while OpenRouter spends no Workers AI neurons at all. Image and voiceover models always stay on Workers AI.</p>' +
							'</div>' +
							'<button type="button" class="cfg-btn" id="cfg-llm-refresh">Refresh</button>' +
						'</div>' +
						'<div class="cfg-relay-grid">' +
							'<div>' +
								'<label class="cfg-label" for="cfg-llm-provider">Provider rotation</label>' +
								'<select class="cfg-input" id="cfg-llm-provider">' +
									'<option value="rotate">Rotate Cloudflare ⟷ OpenRouter</option>' +
									'<option value="cloudflare">Cloudflare Workers AI only</option>' +
									'<option value="openrouter">OpenRouter only (falls back to Cloudflare)</option>' +
								'</select>' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-llm-model">OpenRouter model</label>' +
								'<input class="cfg-input" id="cfg-llm-model" type="text" placeholder="meta-llama/llama-3.3-8b-instruct:free" />' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-llm-cf-weight">Cloudflare weight</label>' +
								'<input class="cfg-input" id="cfg-llm-cf-weight" type="number" min="0" max="10" step="1" value="1" />' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-llm-or-weight">OpenRouter weight</label>' +
								'<input class="cfg-input" id="cfg-llm-or-weight" type="number" min="0" max="10" step="1" value="1" />' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-llm-timeout">OpenRouter timeout (seconds)</label>' +
								'<input class="cfg-input" id="cfg-llm-timeout" type="number" min="5" max="240" step="5" value="90" />' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-llm-max-tokens">Max tokens</label>' +
								'<input class="cfg-input" id="cfg-llm-max-tokens" type="number" min="128" max="32768" step="128" value="4096" />' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-llm-key">OpenRouter API key</label>' +
								'<input class="cfg-input" id="cfg-llm-key" type="password" autocomplete="off" placeholder="leave empty to keep the stored key / use OPENROUTER_API_KEY" />' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-llm-system">System prompt</label>' +
								'<textarea class="cfg-input" id="cfg-llm-system" placeholder="You are a helpful AI assistant. Follow the user&#39;s instructions."></textarea>' +
							'</div>' +
						'</div>' +
						'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">' +
							'<button type="button" class="cfg-btn cfg-btn-primary" id="cfg-llm-save">Save LLM Settings</button>' +
							'<button type="button" class="cfg-btn" id="cfg-llm-test">Test Providers</button>' +
						'</div>' +
						'<div class="cfg-msg" id="cfg-llm-msg"></div>' +
						'<div class="cfg-llm-providers" id="cfg-llm-providers"></div>' +
						'<p class="cfg-relay-hint">The key is stored in KV <code>config:llm</code> and is never echoed back (only its last six characters). Set <code>OPENROUTER_API_KEY</code> on the Worker instead to keep the key out of KV entirely — the environment key wins over a stored one.</p>' +
					'</div>' +

				'</section>' +

				/* TAB 2: GUEST CREDITS BY IP (its own page, session #244) */
				'<section class="cfg-panel" id="cfg-panel-guests">' +
					'<div class="cfg-card">' +
						'<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
							'<div>' +
								'<h2>Guest Credits by IP (Today UTC+8)</h2>' +
								'<p class="cfg-sub" style="margin-bottom:0;">Visitors on GET /free receive 10,000 AI images/day per masked IP. Reset clears today\u2019s counter for that IP.</p>' +
							'</div>' +
							'<button type="button" class="cfg-btn" id="cfg-guests-refresh">Refresh Guest IPs</button>' +
						'</div>' +
						'<div id="cfg-guests-list" style="margin-top:12px;max-height:420px;overflow-y:auto;"></div>' +
						'<div class="cfg-msg" id="cfg-guests-msg"></div>' +
					'</div>' +
				'</section>' +

				/* TAB 3: PLANS (its own page, session #244) */
				'<section class="cfg-panel" id="cfg-panel-plans">' +
					'<div class="cfg-card">' +
						'<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
							'<div>' +
								'<h2>Plans &amp; Daily Limits</h2>' +
								'<p class="cfg-sub" style="margin-bottom:0;">The plan definitions the credit meter enforces. Assign a plan to an account on the <strong>Accounts Credits</strong> page; guest IPs use the guest plan on the <strong>Guest Credits by IP</strong> page.</p>' +
							'</div>' +
							'<button type="button" class="cfg-btn" id="cfg-plans-refresh">Refresh Plans</button>' +
						'</div>' +
						'<div id="cfg-plans-list" style="margin-top:12px;display:grid;gap:10px;"></div>' +
						'<div class="cfg-msg" id="cfg-plans-msg"></div>' +
					'</div>' +
				'</section>' +

				/* TAB 4: ACCOUNTS CREDITS (its own page, session #244) */
				'<section class="cfg-panel" id="cfg-panel-accounts">' +
					'<div class="cfg-card">' +
						'<h2>Accounts Credits</h2>' +
						'<p class="cfg-sub">Each row shows the account\u2019s email and the plan stored on its <code>user:&lt;username&gt;</code> record \u2014 every plan (Free, Paid <code>paid_user</code>, Guest): 10,000 AI images/day. Click any row to load it into the form.</p>' +
						'<div style="display:grid;gap:10px;">' +
							'<div>' +
								'<label class="cfg-label" for="cfg-credit-user">Username</label>' +
								'<input id="cfg-credit-user" class="cfg-input" type="text" placeholder="username" />' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-credit-plan">Plan</label>' +
								'<select id="cfg-credit-plan" class="cfg-select">' +
									'<option value="free">Free \u2014 10,000 AI images / day</option>' +
									'<option value="paid_user">Paid (paid_user) \u2014 10,000 AI images / day</option>' +
								'</select>' +
							'</div>' +
							'<label style="display:flex;align-items:center;gap:8px;font-size:0.84rem;color:#cbd5e1;cursor:pointer;">' +
								'<input id="cfg-credit-reset" type="checkbox" /> Reset today counters' +
							'</label>' +
							'<div>' +
								'<button type="button" class="cfg-btn cfg-btn-primary" id="cfg-plan-save">Save Plan</button>' +
							'</div>' +
						'</div>' +
						'<div class="cfg-msg" id="cfg-plan-msg"></div>' +
						'<div id="cfg-users-list" style="margin-top:12px;max-height:420px;overflow-y:auto;"></div>' +
					'</div>' +
				'</section>' +

				/* TAB 5: LOCAL PAYMENT GATEWAY */
				'<section class="cfg-panel" id="cfg-panel-payment-gateway">' +
					'<div class="cfg-card">' +
						'<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
							'<div>' +
								'<h2>Local Payment Gateway Details</h2>' +
								'<p class="cfg-sub">Write the payment gateway details and screenshot upload instructions shown to users on <a href="/upgrade" target="_blank" style="color:#f59e0b;">/upgrade</a>.</p>' +
							'</div>' +
							'<a href="/upgrade" target="_blank" class="cfg-btn">Preview /upgrade ↗</a>' +
						'</div>' +
						'<div style="display:grid;gap:16px;margin-top:10px;">' +
							'<div>' +
								'<label class="cfg-label" for="cfg-gw-name">Payment Gateway Title</label>' +
								'<input id="cfg-gw-name" class="cfg-input" type="text" maxlength="120" placeholder="e.g. GCash / Maya / Local Bank Transfer" />' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-gw-details">Local Payment Gateway Details (Account Name, Number, Price, QR / Bank Info)</label>' +
								'<textarea id="cfg-gw-details" class="cfg-textarea" rows="7" placeholder="Enter bank/e-wallet name, account holder, account number, and plan price..."></textarea>' +
							'</div>' +
							'<div>' +
								'<label class="cfg-label" for="cfg-gw-instructions">User Screenshot Upload Instructions</label>' +
								'<textarea id="cfg-gw-instructions" class="cfg-textarea" rows="5" placeholder="Instructions telling the user how to upload their payment transaction screenshot..."></textarea>' +
							'</div>' +
							'<div>' +
								'<button type="button" class="cfg-btn cfg-btn-primary" id="cfg-gw-save">Save Payment Gateway Details</button>' +
								'<div class="cfg-msg" id="cfg-gw-msg"></div>' +
							'</div>' +
						'</div>' +
					'</div>' +
				'</section>' +

				/* TAB 6: UPLOADED PAYMENT TRANSACTIONS */
				'<section class="cfg-panel" id="cfg-panel-payments">' +
					'<div class="cfg-card">' +
						'<div class="cfg-pay-toolbar">' +
							'<div>' +
								'<h2>Uploaded Payment Transaction Screenshots</h2>' +
								'<p class="cfg-sub" style="margin-bottom:0;">Click any screenshot to inspect it fullscreen, verify the transaction number, and approve to upgrade the user account to <code>paid_user</code>.</p>' +
							'</div>' +
							'<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
								'<select id="cfg-pay-filter" class="cfg-select" style="width:auto;">' +
									'<option value="all">All Submissions</option>' +
									'<option value="pending">Pending Only</option>' +
									'<option value="approved">Approved Only</option>' +
								'</select>' +
								'<button type="button" class="cfg-btn" id="cfg-pay-refresh">Refresh</button>' +
							'</div>' +
						'</div>' +
						'<div class="cfg-msg" id="cfg-pay-msg"></div>' +
						'<div class="cfg-pay-list" id="cfg-pay-list"></div>' +
						'<div class="cfg-pagination" id="cfg-pay-pagination">' +
							'<button type="button" class="cfg-btn" id="cfg-pay-prev" disabled>← Previous Page</button>' +
							'<span id="cfg-pay-page-info" style="font-size:0.88rem;color:#9ca3af;">Page 1 of 1</span>' +
							'<button type="button" class="cfg-btn" id="cfg-pay-next" disabled>Next Page →</button>' +
						'</div>' +
					'</div>' +
				'</section>' +

				/* TAB 7: BASIC CMS (MAX 8 PAGES) */
				'<section class="cfg-panel" id="cfg-panel-cms">' +
					'<div class="cfg-card">' +
						'<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">' +
							'<div>' +
								'<h2>Basic CMS — Static &amp; Marketing Pages (<span id="cms-count-label">0 / 8</span>)</h2>' +
								'<p class="cfg-sub" style="margin-bottom:0;">Create up to 8 flat pages (no nested URLs). Links appear automatically in the Top Menu or Footer.</p>' +
							'</div>' +
							'<button type="button" class="cfg-btn cfg-btn-primary" id="cms-new-page-btn">+ New Page</button>' +
						'</div>' +

						'<div class="cms-saved-bar" id="cms-saved-bar"></div>' +

						'<div class="cms-split">' +
							/* Left column: Editor */
							'<form id="cms-editor-form" autocomplete="off">' +
								'<input type="hidden" id="cms-edit-id" value="" />' +
								'<div style="display:grid;gap:14px;">' +
									'<div>' +
										'<label class="cfg-label" for="cms-page-url">Page URL <span style="color:#f59e0b;">*</span> (Required — single-level, e.g. /about)</label>' +
										'<input id="cms-page-url" class="cfg-input" type="text" required placeholder="/about" />' +
									'</div>' +
									'<div>' +
										'<label class="cfg-label" for="cms-page-title">Page Title / Menu Link Text</label>' +
										'<input id="cms-page-title" class="cfg-input" type="text" maxlength="120" placeholder="About Us" />' +
									'</div>' +
									'<div>' +
										'<label class="cfg-label" for="cms-page-link">Page Link</label>' +
										'<select id="cms-page-link" class="cfg-select">' +
											'<option value="Link Placed On Top Menu">Link Placed On Top Menu</option>' +
											'<option value="Link Placed On Footer">Link Placed On Footer</option>' +
										'</select>' +
									'</div>' +
								'</div>' +

								'<div style="margin-top:18px;">' +
									'<div class="cfg-label">Page Content Blocks (URL-only images, max 2 images per line)</div>' +
									'<div class="cms-blocks-list" id="cms-blocks-list"></div>' +
									'<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">' +
										'<button type="button" class="cfg-btn" id="cms-add-paragraph-btn">+ Add Paragraph</button>' +
										'<button type="button" class="cfg-btn" id="cms-add-image-btn">+ Add Image (URL)</button>' +
										'<button type="button" class="cfg-btn" id="cms-add-image-pair-btn">+ Add 2-Image Row (URLs)</button>' +
									'</div>' +
								'</div>' +

								'<div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
									'<button type="submit" class="cfg-btn cfg-btn-primary" id="cms-save-btn">Save CMS Page</button>' +
									'<button type="button" class="cfg-btn" id="cms-reset-btn">Clear Form</button>' +
									/* Session #244: delete the page that is open in the editor. */
									'<button type="button" class="cfg-btn cfg-btn-danger" id="cms-delete-btn" style="display:none;">Delete This Page</button>' +
								'</div>' +
								'<div class="cfg-msg" id="cms-msg"></div>' +
							'</form>' +

							/* Right column: Live Preview */
							'<aside class="cms-preview-pane" aria-label="CMS Live Preview">' +
								'<div class="cms-preview-meta">' +
									'<strong>Live Preview</strong>' +
									'<span id="cms-preview-placement">Link Placed On Top Menu</span>' +
									'<code id="cms-preview-url">/your-page</code>' +
								'</div>' +
								'<div id="cms-live-preview"></div>' +
							'</aside>' +
						'</div>' +
					'</div>' +
				'</section>' +
			'</div>' +
		'</div>' +

		/* Fullscreen Lightbox */
		'<div class="cfg-fs-viewer" id="cfg-fs-viewer" role="dialog" aria-modal="true" aria-label="Fullscreen image viewer">' +
			'<button type="button" class="cfg-fs-close" id="cfg-fs-close">✕ Close Fullscreen (Esc)</button>' +
			'<img id="cfg-fs-img" src="" alt="Fullscreen preview" />' +
			'<div id="cfg-fs-caption" style="margin-top:12px;color:#cbd5e1;font-size:0.9rem;"></div>' +
		'</div>';

	// Fullscreen image viewer helpers
	var fsViewer = document.getElementById("cfg-fs-viewer");
	var fsImg = document.getElementById("cfg-fs-img");
	var fsCaption = document.getElementById("cfg-fs-caption");
	var fsClose = document.getElementById("cfg-fs-close");

	function openFs(src, caption) {
		if (!src || !fsViewer || !fsImg) return;
		fsImg.src = src;
		if (fsCaption) fsCaption.textContent = caption || "";
		fsViewer.classList.add("open");
	}

	function closeFs() {
		if (!fsViewer || !fsImg) return;
		fsViewer.classList.remove("open");
		fsImg.src = "";
	}

	if (fsClose) fsClose.addEventListener("click", closeFs);
	if (fsViewer) {
		fsViewer.addEventListener("click", function(e) {
			if (e.target === fsViewer) closeFs();
		});
	}
	document.addEventListener("keydown", function(e) {
		if (e.key === "Escape" && fsViewer && fsViewer.classList.contains("open")) {
			closeFs();
		}
	});
	document.addEventListener("click", function(e) {
		var trigger = e.target && e.target.closest ? e.target.closest("[data-cfg-fs-src]") : null;
		if (trigger) {
			e.preventDefault();
			openFs(trigger.getAttribute("data-cfg-fs-src"), trigger.getAttribute("data-cfg-fs-caption") || "");
		}
	});

	var unlockedPw = "";
	var selectedTheme = document.documentElement.getAttribute("data-theme") || "default";

	// Tab switching on the same dynamic URL
	var tabBtns = pageRoot.querySelectorAll("[data-cfg-tab]");
	function activateTab(tabName) {
		tabBtns.forEach(function(btn) {
			var match = btn.getAttribute("data-cfg-tab") === tabName;
			btn.classList.toggle("active", match);
		});
		["general", "guests", "plans", "accounts", "payment-gateway", "payments", "cms"].forEach(function(id) {
			var panel = document.getElementById("cfg-panel-" + id);
			if (panel) panel.classList.toggle("active", id === tabName);
		});
		if (unlockedPw) {
			if (tabName === "general") { loadRelayConfig(); loadRelayStatus(false); loadLlmConfig(); loadLlmStatus(); }
			if (tabName === "guests") loadGuests();
			if (tabName === "plans") loadCreditUsers();
			if (tabName === "accounts") loadCreditUsers();
			if (tabName === "payments") loadPaymentsPage(currentPayPage);
			if (tabName === "payment-gateway") loadGatewayConfig();
			if (tabName === "cms") loadCmsPages();
		}
	}

	tabBtns.forEach(function(btn) {
		btn.addEventListener("click", function() {
			var tabName = btn.getAttribute("data-cfg-tab");
			activateTab(tabName);
		});
	});

	// --- TAB 1: Themes & Workers (credits moved to tabs 2-4, session #244) ---
	function renderThemeGrid() {
		var wrap = document.getElementById("cfg-themes");
		if (!wrap) return;
		wrap.innerHTML = "";
		THEMES.forEach(function(t) {
			var card = document.createElement("div");
			card.className = "cfg-theme" + (t.id === selectedTheme ? " selected" : "");
			var sw = t.swatches.map(function(c) { return '<span style="background:' + c + '"></span>'; }).join("");
			card.innerHTML =
				'<div class="cfg-theme-head">' +
					'<span class="cfg-theme-name">' + esc(t.name) + '</span>' +
					'<span class="cfg-swatches">' + sw + '</span>' +
				'</div>' +
				'<div class="cfg-theme-desc">' + esc(t.desc) + '</div>';
			card.addEventListener("click", function() {
				selectedTheme = t.id;
				applyThemeClientSide(t.id);
				renderThemeGrid();
				var st = document.getElementById("cfg-status");
				if (st) { st.className = "cfg-msg"; st.textContent = "Previewing " + t.name + " — click Save Theme to persist."; }
			});
			wrap.appendChild(card);
		});
	}

	document.getElementById("cfg-save").addEventListener("click", function() {
		var btn = document.getElementById("cfg-save");
		var st = document.getElementById("cfg-status");
		btn.disabled = true;
		st.className = "cfg-msg";
		st.textContent = "Saving theme...";
		fetch("/api/config/theme", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: unlockedPw, theme: selectedTheme })
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				btn.disabled = false;
				if (res.ok && res.body && res.body.success) {
					st.className = "cfg-msg ok";
					st.textContent = "Saved! All visitors now see this theme.";
				} else {
					st.className = "cfg-msg err";
					st.textContent = (res.body && res.body.error) || "Failed to save theme.";
				}
			})
			.catch(function() {
				btn.disabled = false;
				st.className = "cfg-msg err";
				st.textContent = "Network error.";
			});
	});

	function renderWorkersList(urls) {
		var box = document.getElementById("cfg-workers-list");
		if (!box) return;
		for (var idx = 0; idx < 3; idx++) {
			var inp = document.getElementById("cfg-worker-url-" + (idx + 1));
			if (inp) inp.value = (urls && urls[idx]) || "";
		}
		box.innerHTML = "";
		if (!urls || !urls.length) {
			box.innerHTML = '<div style="font-size:0.82rem;color:#6b7280;padding:4px 0;">No extra workers registered.</div>';
			return;
		}
		urls.forEach(function(u) {
			var row = document.createElement("div");
			row.className = "cfg-worker-row";
			row.innerHTML = '<code>' + esc(u) + '</code>';
			box.appendChild(row);
		});
	}

	function loadWorkersList() {
		fetch("/api/config/workers", { credentials: "same-origin" })
			.then(function(r) { return r.ok ? r.json() : null; })
			.then(function(d) { if (d && Array.isArray(d.urls)) renderWorkersList(d.urls); })
			.catch(function() {});
	}

	document.getElementById("cfg-worker-save").addEventListener("click", function() {
		var msg = document.getElementById("cfg-worker-msg");
		var urls = [];
		for (var idx = 1; idx <= 3; idx++) {
			var val = document.getElementById("cfg-worker-url-" + idx).value.trim();
			if (val) urls.push(val);
		}
		msg.className = "cfg-msg";
		msg.textContent = "Saving workers...";
		fetch("/api/config/workers", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: unlockedPw, urls: urls })
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				if (res.ok && res.body && res.body.success) {
					renderWorkersList(res.body.urls || []);
					msg.className = "cfg-msg ok";
					msg.textContent = "Saved background worker URLs.";
				} else {
					msg.className = "cfg-msg err";
					msg.textContent = (res.body && res.body.error) || "Failed to save workers.";
				}
			})
			.catch(function() {
				msg.className = "cfg-msg err";
				msg.textContent = "Network error.";
			});
	});

	// --- API ROTATION (src/modules/api-relay.ts) ---
	/*
	 * The pool is this Worker + the URLs saved in the card above. The panel
	 * shows the live health of every member (a failing backup is circuit
	 * broken for 30 s -> 5 min and skipped, never retried on every request)
	 * and writes the rotation policy to the config:relay KV key with the same admin
	 * password the other mutations use.
	 */
	function relayMsg(text, kind) {
		var el = document.getElementById("cfg-relay-msg");
		if (!el) return;
		el.className = "cfg-msg" + (kind ? " " + kind : "");
		el.textContent = text || "";
	}

	function relayStateBadge(row) {
		var state = row.state || "ready";
		if (row.reachable === false) state = "offline";
		return '<span class="cfg-relay-state ' + esc(state) + '">' + esc(state) + '</span>';
	}

	function renderRelayStatus(data) {
		var box = document.getElementById("cfg-relay-status");
		if (!box) return;
		var rows = (data && data.endpoints) || [];
		if (!rows.length) {
			box.innerHTML = '<div class="cfg-relay-hint">No pool members yet \u2014 save a worker URL above.</div>';
			return;
		}
		var html = '<table class="cfg-relay-table"><thead><tr>' +
			'<th>Endpoint</th><th>State</th><th>Served</th><th>Avg ms</th><th>Probe</th><th>Last error</th>' +
			'</tr></thead><tbody>';
		rows.forEach(function(row) {
			var served = (row.successes || 0) + "/" + (row.failures || 0);
			var avg = row.ewmaMs ? String(Math.round(row.ewmaMs)) : (row.latencyMs ? String(row.latencyMs) : "\u2014");
			var probe = row.local ? "local" : (row.reachable === true ? "OK " + (row.probeMs || 0) + " ms"
				: row.reachable === false ? "unreachable" : "not probed");
			html += '<tr>' +
				'<td><code>' + esc(row.local ? "This Worker" : row.url) + '</code>' +
					(row.coolingUntil && row.coolingUntil > Date.now() ? '<div class="cfg-relay-hint">cooling until ' + esc(new Date(row.coolingUntil).toLocaleTimeString()) + '</div>' : '') +
				'</td>' +
				'<td>' + relayStateBadge(row) + '</td>' +
				'<td>' + esc(served) + '</td>' +
				'<td>' + esc(avg) + '</td>' +
				'<td>' + esc(probe) + (row.probeError && row.reachable === false ? ' <span class="cfg-relay-hint">' + esc(row.probeError) + '</span>' : '') + '</td>' +
				'<td>' + esc(row.lastError || "\u2014") + '</td>' +
			'</tr>';
		});
		html += '</tbody></table>';
		if (data && data.usingDefaultSecret) {
			html += '<div class="cfg-relay-hint" style="color:#fbbf24;">RELAY_SECRET is not set \u2014 the built-in fallback signs relay tokens. Set the same RELAY_SECRET on every Worker to make them unforgeable.</div>';
		}
		box.innerHTML = html;
	}

	function loadRelayConfig() {
		fetch("/api/relay/config", { credentials: "same-origin" })
			.then(function(r) { return r.ok ? r.json() : null; })
			.then(function(d) {
				if (!d || !d.config) return;
				var enabled = document.getElementById("cfg-relay-enabled");
				var client = document.getElementById("cfg-relay-client");
				var strategy = document.getElementById("cfg-relay-strategy");
				var weight = document.getElementById("cfg-relay-weight");
				var attempts = document.getElementById("cfg-relay-attempts");
				var timeout = document.getElementById("cfg-relay-timeout");
				if (enabled) enabled.checked = d.config.enabled !== false;
				if (client) client.checked = d.config.clientRotation !== false;
				if (strategy) strategy.value = d.config.strategy || "round-robin";
				if (weight) weight.value = String(d.config.localWeight == null ? 1 : d.config.localWeight);
				if (attempts) attempts.value = String(d.config.maxAttempts || 3);
				if (timeout) timeout.value = String(Math.round((d.config.timeoutMs || 100000) / 1000));
			})
			.catch(function() {});
	}

	function loadRelayStatus(probe) {
		var box = document.getElementById("cfg-relay-status");
		if (box && !box.innerHTML) box.innerHTML = '<div class="cfg-relay-hint">Loading pool status\u2026</div>';
		fetch("/api/relay/status" + (probe ? "?probe=1" : ""), { credentials: "same-origin" })
			.then(function(r) { return r.ok ? r.json() : null; })
			.then(function(d) {
				if (!d) { relayMsg("Could not read the relay status.", "err"); return; }
				renderRelayStatus(d);
			})
			.catch(function() { relayMsg("Network error while reading relay status.", "err"); });
	}

	document.getElementById("cfg-relay-refresh").addEventListener("click", function() {
		loadRelayConfig();
		loadRelayStatus(true);
	});

	document.getElementById("cfg-relay-test").addEventListener("click", function() {
		var btn = document.getElementById("cfg-relay-test");
		btn.disabled = true;
		relayMsg("Probing every registered worker\u2026");
		fetch("/api/relay/test", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: unlockedPw })
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				btn.disabled = false;
				if (res.ok && res.body && res.body.success) {
					renderRelayStatus(res.body);
					var up = (res.body.endpoints || []).filter(function(e) { return e.reachable !== false; }).length;
					var total = (res.body.endpoints || []).length;
					relayMsg(up + " of " + total + " endpoints answered. Rotation uses the healthy ones.", "ok");
				} else {
					relayMsg((res.body && res.body.error) || "Probe failed.", "err");
				}
			})
			.catch(function() {
				btn.disabled = false;
				relayMsg("Network error while probing.", "err");
			});
	});

	document.getElementById("cfg-relay-save").addEventListener("click", function() {
		var btn = document.getElementById("cfg-relay-save");
		btn.disabled = true;
		relayMsg("Saving rotation policy\u2026");
		var payload = {
			pw: unlockedPw,
			enabled: !!document.getElementById("cfg-relay-enabled").checked,
			clientRotation: !!document.getElementById("cfg-relay-client").checked,
			strategy: document.getElementById("cfg-relay-strategy").value,
			localWeight: Number(document.getElementById("cfg-relay-weight").value),
			maxAttempts: Number(document.getElementById("cfg-relay-attempts").value),
			timeoutMs: Number(document.getElementById("cfg-relay-timeout").value) * 1000
		};
		fetch("/api/relay/config", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			credentials: "same-origin"
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				btn.disabled = false;
				if (res.ok && res.body && res.body.success) {
					relayMsg("Saved. New model calls use this policy immediately.", "ok");
					loadRelayStatus(true);
				} else {
					relayMsg((res.body && res.body.error) || "Failed to save rotation policy.", "err");
				}
			})
			.catch(function() {
				btn.disabled = false;
				relayMsg("Network error.", "err");
			});
	});

	// --- LLM PROVIDER ROTATION (bug fix #271, src/modules/llm-openrouter.ts) ---
	/*
	 * Cloudflare <-> OpenRouter for the instruct model. The policy lives in the
	 * config:llm KV key; the API key is write-only here (the server reports its
	 * source and last six characters only).
	 */
	function llmMsg(text, kind) {
		var el = document.getElementById("cfg-llm-msg");
		if (!el) return;
		el.className = "cfg-msg" + (kind ? " " + kind : "");
		el.textContent = text || "";
	}

	function renderLlmProviders(data) {
		var box = document.getElementById("cfg-llm-providers");
		if (!box) return;
		var providers = (data && data.providers) || [];
		box.innerHTML = "";
		providers.forEach(function(p) {
			var row = document.createElement("div");
			row.className = "cfg-llm-provider";
			var state = p.state || "ready";
			var meta = [];
			if (p.model) meta.push("model: " + p.model);
			if (p.successes !== undefined) meta.push("served " + p.successes + "/" + p.failures);
			if (p.ewmaMs) meta.push("avg " + Math.round(p.ewmaMs) + " ms");
			if (p.keySource) meta.push("key: " + p.keySource + " \u2026" + (p.keyTail || ""));
			if (p.lastError) meta.push("last error: " + p.lastError);
			row.innerHTML =
				'<span class="cfg-relay-state ' + esc(state) + '">' + esc(state) + '</span>' +
				'<code>' + esc(p.label || p.id) + '</code>' +
				'<span class="cfg-llm-meta">' + esc(meta.join(" \u00b7 ")) + '</span>';
			box.appendChild(row);
		});
		if (data && data.openRouter && data.openRouter.keyConfigured === false) {
			var warn = document.createElement("div");
			warn.className = "cfg-relay-hint";
			warn.style.color = "#fbbf24";
			warn.textContent = "No OpenRouter key configured: every instruct call runs on Workers AI for now. Save a key below, or run: wrangler secret put OPENROUTER_API_KEY";
			box.appendChild(warn);
		}
	}

	function loadLlmConfig() {
		fetch("/api/llm/config", { credentials: "same-origin" })
			.then(function(r) { return r.ok ? r.json() : null; })
			.then(function(d) {
				if (!d || !d.config) return;
				var set = function(id, value) { var el = document.getElementById(id); if (el) el.value = value; };
				set("cfg-llm-provider", d.config.provider || "rotate");
				set("cfg-llm-model", d.config.model || "");
				set("cfg-llm-cf-weight", String(d.config.cloudflareWeight == null ? 1 : d.config.cloudflareWeight));
				set("cfg-llm-or-weight", String(d.config.openrouterWeight == null ? 1 : d.config.openrouterWeight));
				set("cfg-llm-timeout", String(Math.round((d.config.timeoutMs || 90000) / 1000)));
				set("cfg-llm-max-tokens", String(d.config.maxTokensCap || 4096));
				set("cfg-llm-system", d.config.systemPrompt || "");
				var key = document.getElementById("cfg-llm-key");
				if (key) {
					key.value = "";
					key.placeholder = d.hasStoredKey
						? "A key is stored (\u2026" + (d.keyTail || "") + "). Leave empty to keep it."
						: "sk-or-... (empty = environment key or built-in fallback)";
				}
			})
			.catch(function() {});
	}

	function loadLlmStatus() {
		fetch("/api/llm/status", { credentials: "same-origin" })
			.then(function(r) { return r.ok ? r.json() : null; })
			.then(function(d) {
				if (!d) { llmMsg("Could not read the LLM provider status.", "err"); return; }
				renderLlmProviders(d);
			})
			.catch(function() { llmMsg("Network error while reading LLM status.", "err"); });
	}

	document.getElementById("cfg-llm-refresh").addEventListener("click", function() {
		loadLlmConfig();
		loadLlmStatus();
	});

	document.getElementById("cfg-llm-test").addEventListener("click", function() {
		var btn = document.getElementById("cfg-llm-test");
		btn.disabled = true;
		llmMsg("Asking both providers for one sentence\u2026");
		fetch("/api/llm/test", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: unlockedPw }),
			credentials: "same-origin"
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				btn.disabled = false;
				if (!res.ok || !res.body || !res.body.success) {
					llmMsg((res.body && res.body.error) || "Provider test failed.", "err");
					return;
				}
				var lines = (res.body.results || []).map(function(r) {
					if (r.ok) return (r.provider || "?") + ": OK in " + r.ms + " ms [" + (r.preview || "") + "]";
					return (r.provider || "?") + ": FAILED " + (r.error || "");
				});
				llmMsg(lines.join("  |  "), (res.body.results || []).every(function(r) { return r.ok; }) ? "ok" : "err");
				loadLlmStatus();
			})
			.catch(function() {
				btn.disabled = false;
				llmMsg("Network error while testing providers.", "err");
			});
	});

	document.getElementById("cfg-llm-save").addEventListener("click", function() {
		var btn = document.getElementById("cfg-llm-save");
		btn.disabled = true;
		llmMsg("Saving LLM settings\u2026");
		var payload = {
			pw: unlockedPw,
			enabled: true,
			provider: document.getElementById("cfg-llm-provider").value,
			model: document.getElementById("cfg-llm-model").value.trim(),
			cloudflareWeight: Number(document.getElementById("cfg-llm-cf-weight").value),
			openrouterWeight: Number(document.getElementById("cfg-llm-or-weight").value),
			timeoutMs: Number(document.getElementById("cfg-llm-timeout").value) * 1000,
			maxTokensCap: Number(document.getElementById("cfg-llm-max-tokens").value),
			systemPrompt: document.getElementById("cfg-llm-system").value
		};
		var key = document.getElementById("cfg-llm-key").value.trim();
		if (key) payload.apiKey = key;
		fetch("/api/llm/config", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			credentials: "same-origin"
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				btn.disabled = false;
				if (res.ok && res.body && res.body.success) {
					llmMsg("Saved. New instruct-model calls use this rotation immediately.", "ok");
					loadLlmConfig();
					loadLlmStatus();
				} else {
					llmMsg((res.body && res.body.error) || "Failed to save LLM settings.", "err");
				}
			})
			.catch(function() {
				btn.disabled = false;
				llmMsg("Network error.", "err");
			});
	});

	// Background Worker polling loop (/api/worker/poll + window.workerRunJob + /api/worker/failed)
	var workerActive = false;
	var workerBusy = false;
	var workerTimer = null;
	/* A job must not own this tab forever (bug fix #271). */
	var WORKER_JOB_TIMEOUT_MS = 15 * 60 * 1000;

	function withWorkerDeadline(promise, ms, job) {
		return new Promise(function(resolve, reject) {
			var settled = false;
			var timer = setTimeout(function() {
				if (settled) return;
				settled = true;
				if (job) job._workerTimedOut = true;
				var error = new Error("Render of " + ((job && (job.name || job.id)) || "job") +
					" did not finish within " + Math.round(ms / 60000) + " min");
				error.name = "WorkerRenderTimeout";
				reject(error);
			}, ms);
			Promise.resolve(promise).then(function(value) {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(value);
			}, function(error) {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(error);
			});
		});
	}

	async function reportWorkerFailure(job, message) {
		var controller = typeof AbortController === "function" ? new AbortController() : null;
		var timer;
		try {
			var response = await Promise.race([
				fetch("/api/worker/failed?job=" + encodeURIComponent(job.id), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ error: message }),
					credentials: "same-origin",
					...(controller ? { signal: controller.signal } : {})
				}),
				new Promise(function (_, reject) {
					timer = setTimeout(function () {
						if (controller) controller.abort();
						reject(new Error("Failure report timed out"));
					}, 10000);
				})
			]);
			if (!response.ok) throw new Error("Failure report HTTP " + response.status);
		} finally { if (timer) clearTimeout(timer); }
	}

	function wlog(line) {
		var el = document.getElementById("cfg-worker-log");
		if (!el) return;
		var ts = new Date().toTimeString().slice(0, 8);
		el.textContent = "[" + ts + "] " + line + "\\n" + el.textContent.slice(0, 4000);
	}

	function setWorkerDot(state, label) {
		var dot = document.getElementById("cfg-worker-dot");
		var st = document.getElementById("cfg-worker-state");
		if (dot) dot.className = "cfg-dot" + (state ? " " + state : "");
		if (st) st.textContent = label;
	}

	async function pollOnce() {
		if (!workerActive || workerBusy) return;
		try {
			var res = await fetch("/api/worker/poll", { credentials: "same-origin" });
			if (!res.ok) {
				wlog("Poll HTTP " + res.status);
			} else {
				var data = await res.json();
				if (data && data.job) {
					workerBusy = true;
					setWorkerDot("busy", "Rendering " + (data.job.name || data.job.id) + "...");
					wlog("Claimed job " + data.job.id);
					var renderPromise = null;
					var renderTimedOut = false;
					try {
						if (typeof window.workerRunJob !== "function") {
							throw new Error("Studio renderer not ready yet");
						}
						/*
						 * #271: a renderer that never settles used to leave the tab
						 * "busy" forever. Report the failure on a deadline, but do not
						 * reuse shared renderer state until the original work settles.
						 */
						renderPromise = Promise.resolve(window.workerRunJob(data.job));
						await withWorkerDeadline(renderPromise, WORKER_JOB_TIMEOUT_MS, data.job);
						wlog("Delivered job " + data.job.id);
					} catch (jobErr) {
						renderTimedOut = !!(jobErr && jobErr.name === "WorkerRenderTimeout");
						if (renderTimedOut) {
							// A deadline does not cancel WebCodecs or restore shared state.
							// Stop claiming jobs until this render actually settles.
							setWorkerActive(false);
							setWorkerDot("busy", "Render timed out; reload this tab if it does not stop.");
						}
						var emsg = (jobErr && jobErr.message) ? jobErr.message : String(jobErr);
						wlog("Job failed: " + emsg);
						try {
							await reportWorkerFailure(data.job, emsg);
						} catch (reportError) {
							wlog("Could not report job failure: " + ((reportError && reportError.message) || reportError));
						}
					}
					if (renderTimedOut && renderPromise) {
						// Keep the lock even if the operator presses Start again.
						renderPromise.then(function () { workerBusy = false; }, function () { workerBusy = false; });
					} else {
						workerBusy = false;
					}
					if (workerActive && !workerBusy) setWorkerDot("idle", "Listening for jobs...");
				}
			}
		} catch (e) {
			wlog("Poll error: " + ((e && e.message) || e));
		}
		if (workerActive) {
			workerTimer = setTimeout(pollOnce, 3000);
		}
	}

	function setWorkerActive(on) {
		if (on && workerBusy) {
			wlog("A previous render is still stopping. Wait or reload this tab before starting the worker.");
			return;
		}
		workerActive = on;
		clearTimeout(workerTimer);
		var btn = document.getElementById("cfg-worker-toggle");
		if (on) {
			btn.textContent = "Stop Worker";
			setWorkerDot("idle", "Listening for jobs...");
			wlog("Worker started.");
			pollOnce();
		} else {
			btn.textContent = "Start Worker";
			setWorkerDot("", "Stopped");
			wlog("Worker stopped.");
		}
	}

	document.getElementById("cfg-worker-toggle").addEventListener("click", function() {
		setWorkerActive(!workerActive);
	});

	/* 10000 -> "10,000" (plain-text safe; esc() still applied on output) */
	function fmtNum(n) {
		var value = Number(n);
		if (!isFinite(value)) return String(n == null ? "" : n);
		return value.toLocaleString("en-US");
	}

	/*
	 * A plan's human detail: "Free plan - 10,000 AI images / day".
	 * Built from the API payload only, so the numbers on this page
	 * always match what the credit meter enforces.
	 */
	function planDetail(plan, usertype) {
		var id = (plan && plan.id) || usertype || "free";
		var label = (plan && plan.label) || (id === "paid_user" ? "Paid" : id === "guest" ? "Guest" : "Free");
		var limit = plan && plan.limits ? plan.limits.images : undefined;
		var detail = label + " plan";
		if (limit === null) {
			detail += " · unlimited AI images";
		} else if (typeof limit === "number") {
			detail += " · " + fmtNum(limit) + " AI images / day";
		}
		return detail;
	}

	/*
	 * TAB 3 (Plans, session #244): the plan definitions the credit meter
	 * enforces, read from the same GET /api/config/users payload the
	 * accounts list uses - no extra endpoint, no duplicated limits.
	 */
	function renderPlansPanel(d) {
		var box = document.getElementById("cfg-plans-list");
		var msg = document.getElementById("cfg-plans-msg");
		if (!box) return;
		box.innerHTML = "";
		if (!d || !d.success) {
			box.innerHTML = '<div style="font-size:0.82rem;color:#6b7280;">' + esc((d && d.error) || "Could not load the plans.") + '</div>';
			return;
		}
		var users = d.users || [];
		var plans = Array.isArray(d.plans) ? d.plans.slice() : [];
		/* The guest plan is an actor type, not assignable - show it too. */
		plans.push({ id: "guest", label: "Guest (per masked IP)", limits: { images: 10 } });
		plans.forEach(function(plan) {
			var hasLimit = plan && plan.limits && plan.limits.images !== null && plan.limits.images !== undefined;
			var limit = hasLimit ? plan.limits.images : null;
			var onPlan = users.filter(function(u) { return (u.usertype || "free") === plan.id; });
			var usedToday = onPlan.reduce(function(sum, u) {
				return sum + Number((u.used && u.used.images) || 0);
			}, 0);
			var card = document.createElement("div");
			card.className = "cfg-worker-row";
			card.setAttribute("data-cfg-plan-row", plan.id || "");
			card.innerHTML =
				'<strong>' + esc(plan.label || plan.id || "Plan") + '</strong>' +
				'<span style="font-size:0.78rem;color:#9ca3af;">' +
					'<code>' + esc(plan.id || "") + '</code> · ' +
					(limit === null ? "unlimited AI images" : esc(fmtNum(limit)) + " AI images / day") +
					(plan.id === "guest" ? "" : " · " + onPlan.length + " account" + (onPlan.length === 1 ? "" : "s") + " · " + esc(fmtNum(usedToday)) + " used today") +
				'</span>';
			box.appendChild(card);
		});
		if (msg) {
			msg.className = "cfg-msg";
			msg.textContent = d.day
				? "Counters reset daily at midnight Asia/Taipei (today " + d.day + ")."
				: "";
		}
	}

	/*
	 * Keep the plan picker's labels equal to the plans the worker
	 * actually enforces (the payload is the only source of numbers).
	 */
	function syncPlanOptions(d) {
		var select = document.getElementById("cfg-credit-plan");
		if (!select || !d || !Array.isArray(d.plans)) return;
		d.plans.forEach(function(plan) {
			var option = select.querySelector('option[value="' + plan.id + '"]');
			if (!option) return;
			var limit = plan.limits ? plan.limits.images : null;
			option.textContent = (plan.label || plan.id) +
				(limit === null || limit === undefined
					? " \u2014 unlimited AI images"
					: " \u2014 " + fmtNum(limit) + " AI images / day");
		});
		if (d.plans.length && !select.value) {
			select.value = d.plans[0].id;
		}
	}

	function loadCreditUsers() {
		var box = document.getElementById("cfg-users-list");
		fetch("/api/config/users?pw=" + encodeURIComponent(unlockedPw), { credentials: "same-origin" })
			.then(function(r) { return r.json().catch(function() { return {}; }); })
			.then(function(d) {
				renderPlansPanel(d);
				if (d && d.success) syncPlanOptions(d);
				if (!box) return;
				box.innerHTML = "";
				if (!d || !d.success) {
					box.innerHTML = '<div style="font-size:0.82rem;color:#6b7280;">' + esc((d && d.error) || "Could not load accounts.") + '</div>';
					return;
				}
				var users = d.users || [];
				if (!users.length) {
					box.innerHTML = '<div style="font-size:0.82rem;color:#6b7280;">No accounts created yet.</div>';
					return;
				}
				users.forEach(function(u) {
					var row = document.createElement("div");
					row.className = "cfg-worker-row cfg-user-row";
					row.style.cursor = "pointer";
					row.setAttribute("data-cfg-user", u.username || "");
					row.setAttribute("data-cfg-user-plan", u.usertype || "free");
					var planImages = u.plan && u.plan.limits ? u.plan.limits.images : null;
					var remaining = u.remaining ? u.remaining.images : null;
					var usedImages = u.used ? Number(u.used.images || 0) : 0;
					var usage = (planImages === null || planImages === undefined)
						? "unlimited images"
						: (remaining === null || remaining === undefined
							? "—"
							: fmtNum(remaining) + " of " + fmtNum(planImages) + " images left today")
							+ " · " + fmtNum(usedImages) + " used";
					row.innerHTML =
						'<span class="cfg-user-id">' +
							'<code>' + esc(u.username) + '</code>' +
							'<span class="cfg-user-email">' + esc(u.email || "no email on record") + '</span>' +
						'</span>' +
						'<span class="cfg-user-plan">' +
							'<span class="cfg-plan-badge' + (u.usertype === "paid_user" ? " paid" : "") + '">' +
								esc(planDetail(u.plan, u.usertype)) +
							'</span>' +
							'<span class="cfg-user-usage">' + esc(usage) + '</span>' +
						'</span>';
					row.addEventListener("click", function() {
						document.getElementById("cfg-credit-user").value = u.username;
						document.getElementById("cfg-credit-plan").value = u.usertype === "paid_user" ? "paid_user" : "free";
					});
					box.appendChild(row);
				});
				if (typeof d.total === "number" && d.total > users.length) {
					var more = document.createElement("div");
					more.style.fontSize = "0.78rem";
					more.style.color = "#6b7280";
					more.style.marginTop = "8px";
					more.textContent = "Showing " + users.length + " of " + d.total + (d.hasMore ? "+" : "") + " accounts (the newest first).";
					box.appendChild(more);
				}
			})
			.catch(function() {});
	}

	document.getElementById("cfg-plan-save").addEventListener("click", function() {
		var msg = document.getElementById("cfg-plan-msg");
		var username = document.getElementById("cfg-credit-user").value.trim();
		var usertype = document.getElementById("cfg-credit-plan").value || "free";
		var resetCredits = !!document.getElementById("cfg-credit-reset").checked;
		if (!username) {
			msg.className = "cfg-msg err";
			msg.textContent = "Enter a username.";
			return;
		}
		msg.className = "cfg-msg";
		msg.textContent = "Saving account plan...";
		fetch("/api/config/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: unlockedPw, username: username, usertype: usertype, resetCredits: resetCredits }),
			credentials: "same-origin"
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				if (res.ok && res.body && res.body.success) {
					msg.className = "cfg-msg ok";
					msg.textContent = "Saved: " + res.body.username + " is now on " + res.body.usertype + ".";
					document.getElementById("cfg-credit-reset").checked = false;
					loadCreditUsers();
				} else {
					msg.className = "cfg-msg err";
					msg.textContent = (res.body && res.body.error) || "Failed.";
				}
			})
			.catch(function() {
				msg.className = "cfg-msg err";
				msg.textContent = "Network error.";
			});
	});

	function renderGuestsList(data) {
		var box = document.getElementById("cfg-guests-list");
		if (!box) return;
		box.innerHTML = "";
		var list = (data && data.rows) || [];
		var limit = (data && data.plan && data.plan.limits && data.plan.limits.images) || 10;
		if (!list.length) {
			box.innerHTML = '<div style="font-size:0.82rem;color:#6b7280;padding:6px 0;">No guest IP activity yet today.</div>';
			return;
		}
		list.forEach(function(g) {
			var row = document.createElement("div");
			row.className = "cfg-worker-row";
			var left = g.remaining && g.remaining.images !== null ? (g.remaining.images + "/" + limit) : "unlimited";
			row.innerHTML =
				'<code>' + esc(g.ip) + '</code>' +
				'<span style="color:#9ca3af;font-size:0.78rem;">img ' + esc(g.used && g.used.images) + ' · left <strong>' + esc(left) + '</strong></span>' +
				'<button type="button" class="cfg-btn" style="padding:4px 8px;font-size:0.74rem;">Reset</button>';
			row.querySelector("button").addEventListener("click", function() { resetGuestRow(g.key); });
			box.appendChild(row);
		});
	}

	function loadGuests() {
		var msg = document.getElementById("cfg-guests-msg");
		msg.className = "cfg-msg";
		msg.textContent = "Loading...";
		fetch("/api/config/ipcredits?pw=" + encodeURIComponent(unlockedPw), { credentials: "same-origin" })
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				if (res.ok && res.body && res.body.success) {
					renderGuestsList(res.body);
					msg.textContent = "";
				} else {
					msg.className = "cfg-msg err";
					msg.textContent = (res.body && res.body.error) || "Could not load guest rows.";
				}
			})
			.catch(function() {
				msg.className = "cfg-msg err";
				msg.textContent = "Network error.";
			});
	}

	function resetGuestRow(key) {
		var msg = document.getElementById("cfg-guests-msg");
		fetch("/api/config/ipcredits", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: unlockedPw, key: key }),
			credentials: "same-origin"
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				if (res.ok && res.body && res.body.success) {
					msg.className = "cfg-msg ok";
					msg.textContent = "Reset guest row.";
					loadGuests();
				} else {
					msg.className = "cfg-msg err";
					msg.textContent = (res.body && res.body.error) || "Reset failed.";
				}
			})
			.catch(function() {
				msg.className = "cfg-msg err";
				msg.textContent = "Network error.";
			});
	}

	document.getElementById("cfg-guests-refresh").addEventListener("click", loadGuests);

	document.getElementById("cfg-plans-refresh").addEventListener("click", loadCreditUsers);

	// --- TAB 5: Local Payment Gateway Config ---
	function loadGatewayConfig() {
		fetch("/api/config/payment-gateway")
			.then(function(r) { return r.ok ? r.json() : null; })
			.then(function(d) {
				if (!d || !d.gateway) return;
				document.getElementById("cfg-gw-name").value = d.gateway.gatewayName || "";
				document.getElementById("cfg-gw-details").value = d.gateway.gatewayDetails || "";
				document.getElementById("cfg-gw-instructions").value = d.gateway.uploadInstructions || "";
			})
			.catch(function() {});
	}

	document.getElementById("cfg-gw-save").addEventListener("click", function() {
		var btn = document.getElementById("cfg-gw-save");
		var msg = document.getElementById("cfg-gw-msg");
		btn.disabled = true;
		msg.className = "cfg-msg";
		msg.textContent = "Saving payment gateway details...";
		fetch("/api/config/payment-gateway", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				pw: unlockedPw,
				gatewayName: document.getElementById("cfg-gw-name").value.trim(),
				gatewayDetails: document.getElementById("cfg-gw-details").value.trim(),
				uploadInstructions: document.getElementById("cfg-gw-instructions").value.trim()
			})
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				btn.disabled = false;
				if (res.ok && res.body && res.body.success) {
					msg.className = "cfg-msg ok";
					msg.textContent = "Saved! Your local payment gateway details are now live on /upgrade.";
				} else {
					msg.className = "cfg-msg err";
					msg.textContent = (res.body && res.body.error) || "Failed to save payment gateway details.";
				}
			})
			.catch(function() {
				btn.disabled = false;
				msg.className = "cfg-msg err";
				msg.textContent = "Network error.";
			});
	});

	// --- TAB 3: Uploaded Payment Transactions (Paginated + Fullscreen + Verify/Approve) ---
	var currentPayPage = 1;
	var PAY_PAGE_LIMIT = 5;

	function loadPaymentsPage(pageNum) {
		currentPayPage = Math.max(1, pageNum || 1);
		var statusFilter = document.getElementById("cfg-pay-filter").value || "all";
		var listBox = document.getElementById("cfg-pay-list");
		var msg = document.getElementById("cfg-pay-msg");
		var pageInfo = document.getElementById("cfg-pay-page-info");
		var prevBtn = document.getElementById("cfg-pay-prev");
		var nextBtn = document.getElementById("cfg-pay-next");

		msg.className = "cfg-msg";
		msg.textContent = "Loading payment transactions...";

		fetch(
			"/api/config/payments?pw=" + encodeURIComponent(unlockedPw) +
			"&page=" + currentPayPage +
			"&limit=" + PAY_PAGE_LIMIT +
			"&status=" + encodeURIComponent(statusFilter)
		)
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				listBox.innerHTML = "";
				if (!res.ok || !res.body || !res.body.success) {
					msg.className = "cfg-msg err";
					msg.textContent = (res.body && res.body.error) || "Could not load payment transactions.";
					return;
				}
				msg.textContent = "";
				var items = res.body.items || [];
				var pg = res.body.pagination || { page: 1, totalPages: 1, total: 0, hasPrev: false, hasNext: false };
				currentPayPage = pg.page;

				pageInfo.textContent = "Page " + pg.page + " of " + pg.totalPages + " (" + pg.total + " total submissions)";
				prevBtn.disabled = !pg.hasPrev;
				nextBtn.disabled = !pg.hasNext;

				if (!items.length) {
					listBox.innerHTML = '<div style="padding:24px;text-align:center;color:#9ca3af;border:1px dashed #283244;border-radius:10px;">No payment transaction screenshots found for this filter.</div>';
					return;
				}

				items.forEach(function(item) {
					var row = document.createElement("div");
					row.className = "cfg-pay-item";
					var isApproved = item.status === "approved";
					var caption = "User: " + item.username + " · File: " + (item.fileName || item.id);
					row.innerHTML =
						'<div class="cfg-pay-thumb-wrap">' +
							'<img class="cfg-pay-img" src="' + esc(item.imageUrl) + '" data-cfg-fs-src="' + esc(item.imageUrl) + '" data-cfg-fs-caption="' + esc(caption) + '" alt="Payment screenshot from ' + esc(item.username) + '" />' +
							'<button type="button" class="cfg-pay-fs-btn" data-cfg-fs-src="' + esc(item.imageUrl) + '" data-cfg-fs-caption="' + esc(caption) + '">⛶ Fullscreen Screenshot</button>' +
						'</div>' +
						'<div>' +
							'<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
								'<div>' +
									'<strong style="font-size:1.05rem;color:#ffffff;">' + esc(item.username) + '</strong> ' +
									'<span style="color:#9ca3af;font-size:0.86rem;">(' + esc(item.email || "no email") + ')</span>' +
								'</div>' +
								'<span class="cfg-badge ' + (isApproved ? "approved" : "pending") + '" data-role="badge">' +
									(isApproved ? "✓ Approved · paid_user" : "⏳ Pending Verification") +
								'</span>' +
							'</div>' +
							'<div style="font-size:0.84rem;color:#9ca3af;display:grid;gap:4px;margin-bottom:12px;">' +
								'<div><strong>Submitted:</strong> ' + esc((item.createdAt || "").replace("T", " ").slice(0, 19)) + ' UTC</div>' +
								'<div><strong>Account DB Usertype:</strong> <code data-role="usertype">' + esc(item.accountUsertype || "free") + '</code></div>' +
								(item.userNote ? '<div><strong>User Note:</strong> ' + esc(item.userNote) + '</div>' : '') +
							'</div>' +
							'<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">' +
								'<input type="text" class="cfg-input cfg-pay-txn-input" style="max-width:280px;" placeholder="Enter verified transaction #" value="' + esc(item.transactionNumber || "") + '" />' +
								'<button type="button" class="cfg-btn cfg-btn-success cfg-pay-approve-btn">' +
									(isApproved ? "Update Verified Txn #" : "✓ Verify & Approve (Set paid_user)") +
								'</button>' +
							'</div>' +
							'<div class="cfg-msg" data-role="row-msg"></div>' +
						'</div>';

					var txnInput = row.querySelector(".cfg-pay-txn-input");
					var approveBtn = row.querySelector(".cfg-pay-approve-btn");
					var rowMsg = row.querySelector('[data-role="row-msg"]');
					var badgeEl = row.querySelector('[data-role="badge"]');
					var utEl = row.querySelector('[data-role="usertype"]');

					approveBtn.addEventListener("click", function() {
						var txn = txnInput.value.trim();
						if (!txn) {
							rowMsg.className = "cfg-msg err";
							rowMsg.textContent = "Enter the transaction number shown on the payment screenshot first.";
							txnInput.focus();
							return;
						}
						approveBtn.disabled = true;
						rowMsg.className = "cfg-msg";
						rowMsg.textContent = "Verifying & updating user account to paid_user...";
						fetch("/api/config/payments/approve", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								pw: unlockedPw,
								id: item.id,
								transactionNumber: txn
							})
						})
							.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
							.then(function(ans) {
								approveBtn.disabled = false;
								if (ans.ok && ans.body && ans.body.success) {
									badgeEl.className = "cfg-badge approved";
									badgeEl.textContent = "✓ Approved · paid_user";
									utEl.textContent = "paid_user";
									approveBtn.textContent = "Update Verified Txn #";
									rowMsg.className = "cfg-msg ok";
									rowMsg.textContent = 'Approved! User "' + item.username + '" is now paid_user in the database.';
									loadCreditUsers();
								} else {
									rowMsg.className = "cfg-msg err";
									rowMsg.textContent = (ans.body && ans.body.error) || "Approval failed.";
								}
							})
							.catch(function() {
								approveBtn.disabled = false;
								rowMsg.className = "cfg-msg err";
								rowMsg.textContent = "Network error.";
							});
					});

					listBox.appendChild(row);
				});
			})
			.catch(function() {
				msg.className = "cfg-msg err";
				msg.textContent = "Network error loading payments.";
			});
	}

	document.getElementById("cfg-pay-prev").addEventListener("click", function() {
		if (currentPayPage > 1) loadPaymentsPage(currentPayPage - 1);
	});
	document.getElementById("cfg-pay-next").addEventListener("click", function() {
		loadPaymentsPage(currentPayPage + 1);
	});
	document.getElementById("cfg-pay-refresh").addEventListener("click", function() {
		loadPaymentsPage(currentPayPage);
	});
	document.getElementById("cfg-pay-filter").addEventListener("change", function() {
		loadPaymentsPage(1);
	});

	// --- TAB 7: Basic CMS (Max 8 Pages, Live Preview, 200px Paragraph Textbox, 2-per-line URL Images) ---
	var cmsSavedPages = [];
	var cmsDraftBlocks = [];

	function slugTitleFallback(rawUrl) {
		var clean = String(rawUrl || "").trim().replace(/^\\/+/, "");
		if (!clean) return "Untitled Page";
		return clean
			.split(/[-_]+/)
			.filter(Boolean)
			.map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); })
			.join(" ");
	}

	function renderCmsLivePreview() {
		var rawUrl = document.getElementById("cms-page-url").value.trim();
		var rawTitle = document.getElementById("cms-page-title").value.trim();
		var placement = document.getElementById("cms-page-link").value;
		var title = rawTitle || slugTitleFallback(rawUrl);
		var displayUrl = rawUrl ? (rawUrl.charAt(0) === "/" ? rawUrl : "/" + rawUrl) : "/your-page";

		document.getElementById("cms-preview-placement").textContent = placement;
		document.getElementById("cms-preview-url").textContent = displayUrl;

		var previewBox = document.getElementById("cms-live-preview");
		var htmlParts = ['<h3 class="cms-preview-title">' + esc(title) + '</h3>'];

		var pendingImgs = [];
		function flushImgs() {
			if (!pendingImgs.length) return;
			var cards = pendingImgs.map(function(u, idx) {
				return (
					'<div class="cms-preview-img-card">' +
						'<img src="' + esc(u) + '" data-cfg-fs-src="' + esc(u) + '" data-cfg-fs-caption="' + esc(title + " — Image " + (idx + 1)) + '" alt="CMS preview image" />' +
					'</div>'
				);
			}).join("");
			htmlParts.push('<div class="cms-preview-img-grid">' + cards + '</div>');
			pendingImgs = [];
		}

		cmsDraftBlocks.forEach(function(b) {
			if (b.type === "image") {
				var u = (b.url || "").trim();
				if (u) pendingImgs.push(u);
			} else if (b.type === "paragraph") {
				flushImgs();
				if ((b.text || "").trim()) {
					htmlParts.push('<p class="cms-preview-p">' + esc(b.text) + '</p>');
				}
			}
		});
		flushImgs();

		if (htmlParts.length === 1) {
			htmlParts.push('<p style="color:#6b7280;font-size:0.9rem;">Click "+ Add Paragraph" or "+ Add Image (URL)" to build your page and preview it live here.</p>');
		}

		previewBox.innerHTML = htmlParts.join("");
	}

	function renderCmsBlockEditors() {
		var listEl = document.getElementById("cms-blocks-list");
		listEl.innerHTML = "";

		cmsDraftBlocks.forEach(function(block, index) {
			var wrap = document.createElement("div");
			wrap.className = "cms-block-editor";

			var labelTxt = block.type === "paragraph"
				? "Paragraph Block #" + (index + 1)
				: "Image URL Block #" + (index + 1) + " (Max 2 images per line)";

			wrap.innerHTML =
				'<div class="cms-block-head">' +
					'<span>' + esc(labelTxt) + '</span>' +
					'<div style="display:flex;gap:6px;">' +
						'<button type="button" class="cfg-btn" data-act="up" style="padding:3px 8px;font-size:0.75rem;">↑</button>' +
						'<button type="button" class="cfg-btn" data-act="down" style="padding:3px 8px;font-size:0.75rem;">↓</button>' +
						'<button type="button" class="cfg-btn cfg-btn-danger" data-act="del" style="padding:3px 8px;font-size:0.75rem;">Remove</button>' +
					'</div>' +
				'</div>';

			if (block.type === "paragraph") {
				var ta = document.createElement("textarea");
				ta.className = "cfg-textarea cms-paragraph-textbox";
				ta.style.minHeight = "200px";
				ta.placeholder = "Write paragraph text here...";
				ta.value = block.text || "";
				ta.addEventListener("input", function() {
					block.text = ta.value;
					renderCmsLivePreview();
				});
				wrap.appendChild(ta);
			} else {
				var inp = document.createElement("input");
				inp.type = "url";
				inp.className = "cfg-input cms-image-url-input";
				inp.placeholder = "https://example.com/image.jpg (URL only — no file upload)";
				inp.value = block.url || "";
				inp.addEventListener("input", function() {
					block.url = inp.value;
					renderCmsLivePreview();
				});
				wrap.appendChild(inp);
			}

			wrap.querySelector('[data-act="up"]').addEventListener("click", function() {
				if (index === 0) return;
				var tmp = cmsDraftBlocks[index - 1];
				cmsDraftBlocks[index - 1] = cmsDraftBlocks[index];
				cmsDraftBlocks[index] = tmp;
				renderCmsBlockEditors();
				renderCmsLivePreview();
			});
			wrap.querySelector('[data-act="down"]').addEventListener("click", function() {
				if (index >= cmsDraftBlocks.length - 1) return;
				var tmp = cmsDraftBlocks[index + 1];
				cmsDraftBlocks[index + 1] = cmsDraftBlocks[index];
				cmsDraftBlocks[index] = tmp;
				renderCmsBlockEditors();
				renderCmsLivePreview();
			});
			wrap.querySelector('[data-act="del"]').addEventListener("click", function() {
				cmsDraftBlocks.splice(index, 1);
				renderCmsBlockEditors();
				renderCmsLivePreview();
			});

			listEl.appendChild(wrap);
		});
	}

	function setCmsDeleteEnabled(on) {
		var btn = document.getElementById("cms-delete-btn");
		if (!btn) return;
		btn.style.display = on ? "" : "none";
		btn.disabled = !on;
	}

	function resetCmsEditor() {
		setCmsDeleteEnabled(false);
		document.getElementById("cms-edit-id").value = "";
		document.getElementById("cms-page-url").value = "";
		document.getElementById("cms-page-title").value = "";
		document.getElementById("cms-page-link").value = "Link Placed On Top Menu";
		cmsDraftBlocks = [];
		renderCmsBlockEditors();
		renderCmsLivePreview();
		renderCmsSavedBar();
	}

	function editCmsPage(page) {
		setCmsDeleteEnabled(true);
		document.getElementById("cms-edit-id").value = page.id;
		document.getElementById("cms-page-url").value = page.url;
		document.getElementById("cms-page-title").value = page.title;
		document.getElementById("cms-page-link").value = page.pageLink;
		cmsDraftBlocks = (page.blocks || []).map(function(b) {
			return b.type === "image"
				? { type: "image", url: b.url || "" }
				: { type: "paragraph", text: b.text || "" };
		});
		renderCmsBlockEditors();
		renderCmsLivePreview();
		renderCmsSavedBar();
	}

	/*
	 * Session #244: ONE delete path for a CMS page, whether the admin
	 * clicks Delete on the saved-page pill or Delete This Page inside the
	 * editor. Both send the page's id (and slug as a fallback) to
	 * /api/config/cms/delete, then re-render from the server's own list,
	 * so the pill, the counter and the editor can never disagree with the
	 * stored pages - and the Top Menu / Footer link is gone immediately
	 * because the worker renders the menu from that same list.
	 */
	function deleteCmsPage(page) {
		if (!page) return;
		var label = page.url || page.title || "this page";
		if (typeof window.confirm === "function" &&
			!window.confirm("Delete " + label + "?\\n\\nThe Top Menu / Footer link disappears immediately and the URL stops resolving.")) {
			return;
		}
		var msg = document.getElementById("cms-msg");
		if (msg) {
			msg.className = "cfg-msg";
			msg.textContent = "Deleting " + label + "...";
		}
		fetch("/api/config/cms/delete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: unlockedPw, id: page.id, slug: page.slug })
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				if (res.ok && res.body && res.body.success) {
					cmsSavedPages = res.body.pages || [];
					if (document.getElementById("cms-edit-id").value === page.id) {
						resetCmsEditor();
					} else {
						renderCmsSavedBar();
					}
					if (msg) {
						msg.className = "cfg-msg ok";
						msg.textContent = "Deleted " + label + ". Its menu link is gone.";
					}
				} else if (msg) {
					msg.className = "cfg-msg err";
					msg.textContent = (res.body && res.body.error) || "Delete failed.";
				}
			})
			.catch(function() {
				if (msg) {
					msg.className = "cfg-msg err";
					msg.textContent = "Network error - the page was not deleted.";
				}
			});
	}

	function renderCmsSavedBar() {
		var bar = document.getElementById("cms-saved-bar");
		var countLabel = document.getElementById("cms-count-label");
		var activeId = document.getElementById("cms-edit-id").value;
		countLabel.textContent = cmsSavedPages.length + " / 8";
		bar.innerHTML = "";

		if (!cmsSavedPages.length) {
			bar.innerHTML = '<div style="font-size:0.84rem;color:#6b7280;">No CMS pages created yet. Fill out the form below to publish your first page.</div>';
			return;
		}

		cmsSavedPages.forEach(function(p) {
			var pill = document.createElement("div");
			pill.className = "cms-saved-pill" + (p.id === activeId ? " editing" : "");
			pill.innerHTML =
				'<strong>' + esc(p.title) + '</strong>' +
				'<code style="color:#f59e0b;">' + esc(p.url) + '</code>' +
				'<span style="font-size:0.75rem;color:#9ca3af;">(' + esc(p.pageLink === "Link Placed On Footer" ? "Footer" : "Top Menu") + ')</span>' +
				'<button type="button" class="cfg-btn" data-act="edit" style="padding:4px 9px;font-size:0.75rem;">Edit</button>' +
				'<a href="' + esc(p.url) + '" target="_blank" class="cfg-btn" style="padding:4px 9px;font-size:0.75rem;text-decoration:none;">Open ↗</a>' +
				'<button type="button" class="cfg-btn cfg-btn-danger" data-act="del" style="padding:4px 9px;font-size:0.75rem;">Delete</button>';

			pill.querySelector('[data-act="edit"]').addEventListener("click", function() {
				editCmsPage(p);
			});
			pill.querySelector('[data-act="del"]').addEventListener("click", function() {
				deleteCmsPage(p);
			});
			bar.appendChild(pill);
		});
	}

	function loadCmsPages() {
		fetch("/api/config/cms?pw=" + encodeURIComponent(unlockedPw))
			.then(function(r) { return r.ok ? r.json() : null; })
			.then(function(d) {
				if (!d || !Array.isArray(d.pages)) return;
				cmsSavedPages = d.pages;
				renderCmsSavedBar();
			})
			.catch(function() {});
	}

	document.getElementById("cms-page-url").addEventListener("input", renderCmsLivePreview);
	document.getElementById("cms-page-title").addEventListener("input", renderCmsLivePreview);
	document.getElementById("cms-page-link").addEventListener("change", renderCmsLivePreview);

	document.getElementById("cms-add-paragraph-btn").addEventListener("click", function() {
		cmsDraftBlocks.push({ type: "paragraph", text: "" });
		renderCmsBlockEditors();
		renderCmsLivePreview();
		var textareas = document.querySelectorAll("#cms-blocks-list .cms-paragraph-textbox");
		if (textareas.length) textareas[textareas.length - 1].focus();
	});

	document.getElementById("cms-add-image-btn").addEventListener("click", function() {
		cmsDraftBlocks.push({ type: "image", url: "" });
		renderCmsBlockEditors();
		renderCmsLivePreview();
	});

	document.getElementById("cms-add-image-pair-btn").addEventListener("click", function() {
		cmsDraftBlocks.push({ type: "image", url: "" });
		cmsDraftBlocks.push({ type: "image", url: "" });
		renderCmsBlockEditors();
		renderCmsLivePreview();
	});

	document.getElementById("cms-new-page-btn").addEventListener("click", function() {
		resetCmsEditor();
		document.getElementById("cms-msg").textContent = "";
	});

	document.getElementById("cms-reset-btn").addEventListener("click", function() {
		resetCmsEditor();
		document.getElementById("cms-msg").textContent = "";
	});

	document.getElementById("cms-delete-btn").addEventListener("click", function() {
		var editId = document.getElementById("cms-edit-id").value.trim();
		if (!editId) return;
		for (var i = 0; i < cmsSavedPages.length; i++) {
			if (cmsSavedPages[i].id === editId) {
				deleteCmsPage(cmsSavedPages[i]);
				return;
			}
		}
	});

	document.getElementById("cms-editor-form").addEventListener("submit", function(e) {
		e.preventDefault();
		var msg = document.getElementById("cms-msg");
		var editId = document.getElementById("cms-edit-id").value.trim();
		var pageUrl = document.getElementById("cms-page-url").value.trim();
		var pageTitle = document.getElementById("cms-page-title").value.trim();
		var pageLink = document.getElementById("cms-page-link").value;

		if (!pageUrl) {
			msg.className = "cfg-msg err";
			msg.textContent = "Page URL is required.";
			document.getElementById("cms-page-url").focus();
			return;
		}

		if (!editId && cmsSavedPages.length >= 8) {
			msg.className = "cfg-msg err";
			msg.textContent = "Maximum of 8 CMS pages reached. Edit or delete an existing page first.";
			return;
		}

		var saveBtn = document.getElementById("cms-save-btn");
		saveBtn.disabled = true;
		msg.className = "cfg-msg";
		msg.textContent = "Saving CMS page...";

		fetch("/api/config/cms", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				pw: unlockedPw,
				id: editId || undefined,
				url: pageUrl,
				title: pageTitle,
				pageLink: pageLink,
				blocks: cmsDraftBlocks
			})
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				saveBtn.disabled = false;
				if (res.ok && res.body && res.body.success) {
					cmsSavedPages = res.body.pages || [];
					if (res.body.page) {
						editCmsPage(res.body.page);
					} else {
						renderCmsSavedBar();
					}
					msg.className = "cfg-msg ok";
					msg.textContent = "Saved! Page is now live at " + res.body.page.url + " (" + res.body.page.pageLink + ").";
				} else {
					msg.className = "cfg-msg err";
					msg.textContent = (res.body && res.body.error) || "Failed to save CMS page.";
				}
			})
			.catch(function() {
				saveBtn.disabled = false;
				msg.className = "cfg-msg err";
				msg.textContent = "Network error.";
			});
	});

	renderCmsLivePreview();

	// --- Password Unlock Flow ---
	document.getElementById("cfg-pw-form").addEventListener("submit", function(e) {
		e.preventDefault();
		var pw = document.getElementById("cfg-pw-input").value;
		var err = document.getElementById("cfg-pw-err");
		err.textContent = "Checking password...";
		fetch("/api/config/verify", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pw: pw })
		})
			.then(function(r) { return r.json().then(function(b) { return { ok: r.ok, body: b }; }); })
			.then(function(res) {
				if (res.ok && res.body && res.body.valid) {
					unlockedPw = pw;
					if (res.body.theme) {
						selectedTheme = res.body.theme;
						applyThemeClientSide(selectedTheme);
					}
					document.getElementById("cfg-pw-view").style.display = "none";
					document.getElementById("cfg-unlocked-view").style.display = "block";
					renderThemeGrid();
					loadWorkersList();
					loadRelayConfig();
					loadRelayStatus(false);
					loadLlmConfig();
					loadLlmStatus();
					loadCreditUsers();
					loadGuests();
					loadGatewayConfig();
					loadPaymentsPage(1);
					loadCmsPages();
				} else {
					err.textContent = (res.body && res.body.error) || "Incorrect password.";
				}
			})
			.catch(function() {
				err.textContent = "Could not verify password — try again.";
			});
	});
})();
</script>
`;
