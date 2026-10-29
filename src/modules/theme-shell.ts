/*
 * Modular Theme & Page Shell (`src/modules/theme-shell.ts`)
 *
 * Shared, self-contained HTML shell for standalone pages (`/account`,
 * `/upgrade`, and CMS public pages `/<slug>`). Supports all 7 global themes
 * (`default`, `strata` / Aerial, `stellar`, `nightlab`, `paper`, `swiss`, `neo`),
 * renders Top Menu and Footer CMS links, and ships a reusable click-to-fullscreen
 * image viewer.
 */

export interface CmsNavLinkItem {
	slug: string;
	url: string;
	title: string;
	pageLink: "Link Placed On Top Menu" | "Link Placed On Footer";
}

export interface ShellPageOptions {
	title: string;
	description?: string;
	theme: string;
	activePath?: string;
	cmsLinks?: CmsNavLinkItem[];
	bodyHtml: string;
	extraCss?: string;
	extraScriptsHtml?: string;
}

export function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export const SHARED_FULLSCREEN_VIEWER_JS = `
(function() {
	"use strict";
	var viewer = null;
	var viewerImg = null;
	var viewerCaption = null;

	function ensureViewer() {
		if (viewer) return viewer;
		viewer = document.createElement("div");
		viewer.id = "modular-img-fullscreen";
		viewer.className = "mod-fs-overlay";
		viewer.setAttribute("role", "dialog");
		viewer.setAttribute("aria-modal", "true");
		viewer.setAttribute("aria-label", "Fullscreen image preview");
		viewer.hidden = true;
		viewer.innerHTML =
			'<div class="mod-fs-toolbar">' +
				'<span class="mod-fs-caption" id="mod-fs-caption"></span>' +
				'<div class="mod-fs-actions">' +
					'<button type="button" class="mod-fs-btn" id="mod-fs-native">\\u26f6 Browser Fullscreen</button>' +
					'<button type="button" class="mod-fs-btn mod-fs-close" id="mod-fs-close" aria-label="Close fullscreen">\\u2715 Close</button>' +
				'</div>' +
			'</div>' +
			'<div class="mod-fs-stage" id="mod-fs-stage">' +
				'<img class="mod-fs-img" id="mod-fs-img" alt="Fullscreen preview" />' +
			'</div>';
		document.body.appendChild(viewer);
		viewerImg = document.getElementById("mod-fs-img");
		viewerCaption = document.getElementById("mod-fs-caption");

		var closeBtn = document.getElementById("mod-fs-close");
		var nativeBtn = document.getElementById("mod-fs-native");
		var stage = document.getElementById("mod-fs-stage");

		if (closeBtn) {
			closeBtn.addEventListener("click", closeFullscreenImage);
		}
		if (stage) {
			stage.addEventListener("click", function(e) {
				if (e.target === stage) closeFullscreenImage();
			});
		}
		if (nativeBtn) {
			nativeBtn.addEventListener("click", function() {
				if (!viewer) return;
				if (document.fullscreenElement) {
					if (document.exitFullscreen) document.exitFullscreen().catch(function() {});
				} else if (viewer.requestFullscreen) {
					viewer.requestFullscreen().catch(function() {});
				}
			});
		}
		document.addEventListener("keydown", function(e) {
			if (e.key === "Escape" && viewer && !viewer.hidden) {
				closeFullscreenImage();
			}
		});
		return viewer;
	}

	function openFullscreenImage(src, caption) {
		if (!src) return;
		var v = ensureViewer();
		if (viewerImg) viewerImg.src = src;
		if (viewerCaption) viewerCaption.textContent = caption || "";
		v.hidden = false;
		document.body.classList.add("mod-fs-lock");
	}

	function closeFullscreenImage() {
		if (!viewer) return;
		viewer.hidden = true;
		if (viewerImg) viewerImg.removeAttribute("src");
		document.body.classList.remove("mod-fs-lock");
		if (document.fullscreenElement && document.exitFullscreen) {
			document.exitFullscreen().catch(function() {});
		}
	}

	document.addEventListener("click", function(e) {
		var target = e.target;
		if (!target || !target.closest) return;
		var trigger = target.closest("[data-fullscreen-src]");
		if (trigger) {
			e.preventDefault();
			openFullscreenImage(
				trigger.getAttribute("data-fullscreen-src") || trigger.getAttribute("src"),
				trigger.getAttribute("data-fullscreen-caption") || trigger.getAttribute("alt") || ""
			);
		}
	});

	window.openModularFullscreenImage = openFullscreenImage;
	window.closeModularFullscreenImage = closeFullscreenImage;
})();
`;

const SHELL_BASE_CSS = `
:root {
	--sh-bg: #0f1115;
	--sh-panel: #171a21;
	--sh-panel-2: #1e222b;
	--sh-ink: #f3f4f6;
	--sh-heading: #ffffff;
	--sh-muted: #9ca3af;
	--sh-line: #2a303c;
	--sh-accent: #f59e0b;
	--sh-on-accent: #111111;
	--sh-input: #12151b;
	--sh-radius: 12px;
	--sh-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
	--sh-border-w: 1px;
}

html[data-theme="strata"] {
	--sh-bg: #1e5799;
	--sh-panel: rgba(16, 42, 76, 0.82);
	--sh-panel-2: rgba(22, 56, 98, 0.88);
	--sh-ink: #f0f6ff;
	--sh-heading: #ffffff;
	--sh-muted: #c7dcf5;
	--sh-line: rgba(255, 255, 255, 0.24);
	--sh-accent: #ffffff;
	--sh-on-accent: #102a4c;
	--sh-input: rgba(10, 28, 52, 0.78);
}

html[data-theme="stellar"] {
	--sh-bg: #4b2d73;
	--sh-panel: rgba(38, 24, 68, 0.84);
	--sh-panel-2: rgba(52, 34, 90, 0.88);
	--sh-ink: #f6f1ff;
	--sh-heading: #ffffff;
	--sh-muted: #d8c8f0;
	--sh-line: rgba(255, 255, 255, 0.22);
	--sh-accent: #f2a6ff;
	--sh-on-accent: #23113b;
	--sh-input: rgba(25, 14, 48, 0.8);
}

html[data-theme="nightlab"] {
	--sh-bg: #0b0d12;
	--sh-panel: #141923;
	--sh-panel-2: #1b2230;
	--sh-ink: #f5f6fa;
	--sh-heading: #ffffff;
	--sh-muted: #9aa3b5;
	--sh-line: #263042;
	--sh-accent: #baff61;
	--sh-on-accent: #0b0d12;
	--sh-input: #0f131c;
	--sh-radius: 15px;
}

html[data-theme="paper"] {
	--sh-bg: #f0ece3;
	--sh-panel: #fffdf7;
	--sh-panel-2: #f7f3e8;
	--sh-ink: #272720;
	--sh-heading: #161612;
	--sh-muted: #656358;
	--sh-line: #dcd5c5;
	--sh-accent: #e85f42;
	--sh-on-accent: #ffffff;
	--sh-input: #ffffff;
	--sh-shadow: 0 8px 24px rgba(39, 39, 32, 0.08);
}

html[data-theme="swiss"] {
	--sh-bg: #f4f5f7;
	--sh-panel: #ffffff;
	--sh-panel-2: #eef1f5;
	--sh-ink: #15171b;
	--sh-heading: #0b0d10;
	--sh-muted: #5a6270;
	--sh-line: #d8dde6;
	--sh-accent: #2364f5;
	--sh-on-accent: #ffffff;
	--sh-input: #ffffff;
	--sh-radius: 6px;
	--sh-shadow: none;
}

html[data-theme="neo"] {
	--sh-bg: #f6f3e9;
	--sh-panel: #fffdf5;
	--sh-panel-2: #f0ecde;
	--sh-ink: #111111;
	--sh-heading: #000000;
	--sh-muted: #3f3f3a;
	--sh-line: #111111;
	--sh-accent: #d8ff00;
	--sh-on-accent: #111111;
	--sh-input: #ffffff;
	--sh-radius: 4px;
	--sh-border-w: 2px;
	--sh-shadow: 4px 4px 0 #111111;
}

*, *::before, *::after {
	box-sizing: border-box;
}

body {
	margin: 0;
	min-height: 100vh;
	display: flex;
	flex-direction: column;
	font-family: "Source Sans Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	background: var(--sh-bg);
	color: var(--sh-ink);
	line-height: 1.6;
}

html[data-theme="stellar"] body {
	background: linear-gradient(45deg, #935d8c 15%, #5f4d93 85%);
	background-attachment: fixed;
}

html[data-theme="strata"] body {
	background: linear-gradient(180deg, #1b4f8c 0%, #2d73b8 55%, #183a66 100%);
	background-attachment: fixed;
}

a {
	color: var(--sh-accent);
	text-decoration: none;
}

a:hover {
	text-decoration: underline;
}

.site-header {
	position: sticky;
	top: 0;
	z-index: 50;
	background: var(--sh-panel);
	border-bottom: var(--sh-border-w) solid var(--sh-line);
	padding: 14px clamp(16px, 4vw, 48px);
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	flex-wrap: wrap;
}

.site-brand {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	color: var(--sh-heading);
	font-weight: 700;
	letter-spacing: 0.06em;
	text-decoration: none;
}

.site-brand:hover {
	text-decoration: none;
}

.site-brand-mark {
	width: 30px;
	height: 30px;
	border-radius: 8px;
	background: var(--sh-accent);
	color: var(--sh-on-accent);
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font-weight: 900;
	font-size: 0.95rem;
}

.site-top-menu {
	display: flex;
	align-items: center;
	gap: 16px;
	flex-wrap: wrap;
}

.site-top-menu a {
	color: var(--sh-muted);
	font-size: 0.92rem;
	font-weight: 600;
	padding: 6px 10px;
	border-radius: 6px;
	text-decoration: none;
	transition: background 0.15s ease, color 0.15s ease;
}

.site-top-menu a:hover,
.site-top-menu a.active {
	color: var(--sh-heading);
	background: var(--sh-panel-2);
}

.site-main {
	flex: 1;
	width: 100%;
	max-width: 1080px;
	margin: 0 auto;
	padding: clamp(24px, 4vw, 48px) clamp(16px, 4vw, 32px);
}

.site-card {
	background: var(--sh-panel);
	border: var(--sh-border-w) solid var(--sh-line);
	border-radius: var(--sh-radius);
	box-shadow: var(--sh-shadow);
	padding: clamp(20px, 3vw, 32px);
	margin-bottom: 24px;
}

.site-card h1,
.site-card h2,
.site-card h3 {
	color: var(--sh-heading);
	margin-top: 0;
}

.site-eyebrow {
	display: inline-block;
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--sh-accent);
	margin-bottom: 8px;
}

.site-muted {
	color: var(--sh-muted);
}

.site-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 11px 20px;
	border-radius: 8px;
	border: var(--sh-border-w) solid var(--sh-line);
	background: var(--sh-panel-2);
	color: var(--sh-ink);
	font-size: 0.94rem;
	font-weight: 700;
	cursor: pointer;
	text-decoration: none;
	transition: opacity 0.15s ease, transform 0.1s ease;
}

.site-btn:hover {
	text-decoration: none;
	opacity: 0.92;
}

.site-btn-primary {
	background: var(--sh-accent);
	color: var(--sh-on-accent);
	border-color: var(--sh-accent);
}

.site-input,
.site-textarea,
.site-select {
	width: 100%;
	background: var(--sh-input);
	color: var(--sh-ink);
	border: var(--sh-border-w) solid var(--sh-line);
	border-radius: 8px;
	padding: 10px 12px;
	font-size: 0.94rem;
	font-family: inherit;
	outline: none;
}

.site-input:focus,
.site-textarea:focus,
.site-select:focus {
	border-color: var(--sh-accent);
}

.site-footer {
	background: var(--sh-panel);
	border-top: var(--sh-border-w) solid var(--sh-line);
	padding: 24px clamp(16px, 4vw, 48px);
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	flex-wrap: wrap;
	font-size: 0.88rem;
	color: var(--sh-muted);
}

.site-footer-menu {
	display: flex;
	align-items: center;
	gap: 16px;
	flex-wrap: wrap;
}

.site-footer-menu a {
	color: var(--sh-muted);
	font-weight: 600;
}

.site-footer-menu a:hover {
	color: var(--sh-heading);
}

/* Fullscreen Image Viewer */
body.mod-fs-lock {
	overflow: hidden;
}

.mod-fs-overlay {
	position: fixed;
	inset: 0;
	z-index: 10000;
	background: rgba(6, 8, 13, 0.95);
	display: flex;
	flex-direction: column;
}

.mod-fs-overlay[hidden] {
	display: none !important;
}

.mod-fs-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 20px;
	background: rgba(15, 18, 25, 0.9);
	border-bottom: 1px solid rgba(255, 255, 255, 0.12);
	color: #f3f4f6;
}

.mod-fs-caption {
	font-size: 0.9rem;
	color: #d1d5db;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.mod-fs-actions {
	display: flex;
	align-items: center;
	gap: 10px;
}

.mod-fs-btn {
	background: #262c3a;
	color: #ffffff;
	border: 1px solid #3b4459;
	border-radius: 6px;
	padding: 7px 14px;
	font-size: 0.84rem;
	font-weight: 600;
	cursor: pointer;
}

.mod-fs-btn:hover {
	background: #343c4f;
}

.mod-fs-close {
	background: #991b1b;
	border-color: #b91c1c;
}

.mod-fs-close:hover {
	background: #b91c1c;
}

.mod-fs-stage {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 20px;
	overflow: auto;
	cursor: zoom-out;
}

.mod-fs-img {
	max-width: 95vw;
	max-height: 86vh;
	object-fit: contain;
	border-radius: 6px;
	box-shadow: 0 20px 60px rgba(0, 0, 0, 0.65);
	cursor: default;
}
`;

export function renderShellPage(opts: ShellPageOptions): string {
	const themeAttr =
		opts.theme && opts.theme !== "default"
			? ` data-theme="${escapeHtml(opts.theme)}"`
			: "";

	const cmsLinks = Array.isArray(opts.cmsLinks) ? opts.cmsLinks : [];
	const topCmsLinks = cmsLinks
		.filter((item) => item.pageLink === "Link Placed On Top Menu")
		.map(
			(item) =>
				`<a href="${escapeHtml(item.url)}" class="cms-top-link${
					opts.activePath === item.url ? " active" : ""
				}">${escapeHtml(item.title)}</a>`
		)
		.join("");

	const footerCmsLinks = cmsLinks
		.filter((item) => item.pageLink === "Link Placed On Footer")
		.map(
			(item) =>
				`<a href="${escapeHtml(item.url)}" class="cms-footer-link">${escapeHtml(
					item.title
				)}</a>`
		)
		.join("");

	const active = opts.activePath || "";

	return `<!DOCTYPE html>
<html lang="en"${themeAttr}>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(opts.title)} — YouTube Vibe Studio</title>
	<meta name="description" content="${escapeHtml(
		opts.description || "YouTube Vibe Studio"
	)}">
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&family=Source+Sans+Pro:wght@300;400;600;700;900&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
	<noscript><link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&family=Source+Sans+Pro:wght@300;400;600;700;900&display=swap" rel="stylesheet"></noscript>
	<style>${SHELL_BASE_CSS}${opts.extraCss || ""}</style>
</head>
<body>
	<header class="site-header">
		<a class="site-brand" href="/">
			<span class="site-brand-mark" aria-hidden="true">V</span>
			<span>VIBE <b>STUDIO</b></span>
		</a>
		<nav class="site-top-menu" aria-label="Top Menu">
			<a href="/">Home</a>
			<a href="/studio"${active === "/studio" ? ' class="active"' : ""}>Studio</a>
			<a href="/free"${active === "/free" ? ' class="active"' : ""}>Free Studio</a>
			<a href="/account"${active === "/account" ? ' class="active"' : ""}>Account</a>
			<a href="/upgrade"${active === "/upgrade" ? ' class="active"' : ""}>Upgrade</a>
			${topCmsLinks}
		</nav>
	</header>

	<main class="site-main">
		${opts.bodyHtml}
	</main>

	<footer class="site-footer">
		<div>© 2026 YouTube Vibe Studio</div>
		<nav class="site-footer-menu" aria-label="Footer Menu">
			<a href="/">Home</a>
			<a href="/free">Free Studio</a>
			<a href="/account">Account</a>
			<a href="/upgrade">Upgrade</a>
			${footerCmsLinks}
		</nav>
	</footer>

	<script>${SHARED_FULLSCREEN_VIEWER_JS}</script>
	${opts.extraScriptsHtml || ""}
</body>
</html>`;
}
