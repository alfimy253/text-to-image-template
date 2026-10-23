/*
 * Modular Basic CMS (`src/modules/cms.ts`)
 *
 * Implements Requirement #5 safely and independently of the studio engine:
 *   - Up to 8 pages maximum (`CMS_MAX_PAGES = 8`)
 *   - Single-level URLs only (no nested pages such as `/a/b`)
 *   - Reserved route guard so CMS pages can never shadow app/API routes
 *   - Paragraph blocks + URL-only image blocks (rendered max 2 per line,
 *     fullscreenable via click)
 *   - `Page Link` placement: `"Link Placed On Top Menu"` or `"Link Placed On Footer"`
 */

import { CmsNavLinkItem, escapeHtml, renderShellPage } from "./theme-shell";

export const CONFIG_CMS_KEY = "config:cms_pages";
export const CMS_MAX_PAGES = 8;

export const CMS_LINK_TOP = "Link Placed On Top Menu" as const;
export const CMS_LINK_FOOTER = "Link Placed On Footer" as const;

export type CmsPageLinkPlacement =
	| typeof CMS_LINK_TOP
	| typeof CMS_LINK_FOOTER;

export type CmsBlock =
	| { type: "paragraph"; text: string }
	| { type: "image"; url: string };

export interface CmsPageRecord {
	id: string;
	slug: string;
	url: string;
	title: string;
	pageLink: CmsPageLinkPlacement;
	blocks: CmsBlock[];
	createdAt: string;
	updatedAt: string;
}

const RESERVED_CMS_SLUGS = new Set([
	"free",
	"studio",
	"paid",
	"account",
	"upgrade",
	"tts",
	"image",
	"api",
	"config",
	"login",
	"signup",
	"logout",
	"admin",
	"favicon.ico",
	"robots.txt"
]);

function cmsJson(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

function titleFromSlug(slug: string): string {
	return slug
		.split(/[-_]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ") || slug;
}

export function normalizeCmsUrlInput(
	rawInput: unknown
): { ok: true; slug: string; url: string } | { ok: false; error: string } {
	const trimmed = String(rawInput ?? "").trim();
	if (!trimmed) {
		return { ok: false, error: "Page URL is required." };
	}
	if (/[\s?#\\]/.test(trimmed)) {
		return {
			ok: false,
			error: "Page URL must not contain spaces, query strings or # fragments."
		};
	}

	const withoutLeadingSlash = trimmed.startsWith("/")
		? trimmed.slice(1)
		: trimmed;

	if (!withoutLeadingSlash) {
		return {
			ok: false,
			error: "Page URL cannot be the root path /. Enter a page slug like /about."
		};
	}

	if (withoutLeadingSlash.includes("/")) {
		return {
			ok: false,
			error: "Nested pages are not allowed. Enter a single-level URL such as /about."
		};
	}

	const slug = withoutLeadingSlash.toLowerCase();
	if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(slug)) {
		return {
			ok: false,
			error: "Page URL may only contain letters, numbers, hyphens (-) and underscores (_) (max 64 chars)."
		};
	}

	if (RESERVED_CMS_SLUGS.has(slug)) {
		return {
			ok: false,
			error: `The URL /${slug} is reserved by a built-in application route.`
		};
	}

	return { ok: true, slug, url: "/" + slug };
}

export function normalizeCmsPageLink(
	rawLink: unknown
): CmsPageLinkPlacement | null {
	const val = String(rawLink ?? "").trim();
	if (
		val === CMS_LINK_TOP ||
		val.toLowerCase() === "link placed on top menu" ||
		val.toLowerCase() === "top_menu" ||
		val.toLowerCase() === "top"
	) {
		return CMS_LINK_TOP;
	}
	if (
		val === CMS_LINK_FOOTER ||
		val.toLowerCase() === "link placed on footer" ||
		val.toLowerCase() === "footer"
	) {
		return CMS_LINK_FOOTER;
	}
	return null;
}

export function validateAndNormalizeBlocks(
	rawBlocks: unknown
): { ok: true; blocks: CmsBlock[] } | { ok: false; error: string } {
	if (!Array.isArray(rawBlocks)) {
		return { ok: true, blocks: [] };
	}
	if (rawBlocks.length > 100) {
		return { ok: false, error: "Too many content blocks (max 100)." };
	}

	const normalized: CmsBlock[] = [];
	for (const raw of rawBlocks) {
		if (!raw || typeof raw !== "object") continue;
		const item = raw as Record<string, unknown>;
		const type = String(item.type || "").trim().toLowerCase();

		if (type === "paragraph") {
			const text = String(item.text ?? "").slice(0, 20000);
			if (text.trim().length > 0) {
				normalized.push({ type: "paragraph", text });
			}
		} else if (type === "image") {
			const imgUrl = String(item.url ?? "").trim();
			if (!imgUrl) continue;
			if (imgUrl.length > 1000 || !/^https?:\/\/[^\s<>"']+$/i.test(imgUrl)) {
				return {
					ok: false,
					error: "Every image must be a valid http:// or https:// URL (no file uploads or data URIs)."
				};
			}
			normalized.push({ type: "image", url: imgUrl });
		} else if (type === "images" && Array.isArray(item.urls)) {
			for (const u of item.urls) {
				const imgUrl = String(u ?? "").trim();
				if (!imgUrl) continue;
				if (imgUrl.length > 1000 || !/^https?:\/\/[^\s<>"']+$/i.test(imgUrl)) {
					return {
						ok: false,
						error: "Every image must be a valid http:// or https:// URL (no file uploads or data URIs)."
					};
				}
				normalized.push({ type: "image", url: imgUrl });
			}
		}
	}

	if (normalized.length > 100) {
		return { ok: false, error: "Too many content blocks (max 100)." };
	}

	return { ok: true, blocks: normalized };
}

export async function readCmsPages(env: {
	KV_BINDING?: KVNamespace;
}): Promise<CmsPageRecord[]> {
	if (!env || !env.KV_BINDING) {
		return [];
	}
	try {
		const raw = await env.KV_BINDING.get(CONFIG_CMS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const valid: CmsPageRecord[] = [];
		for (const entry of parsed) {
			if (!entry || typeof entry !== "object") continue;
			const urlRes = normalizeCmsUrlInput(entry.url || entry.slug);
			const linkRes = normalizeCmsPageLink(entry.pageLink);
			const blockRes = validateAndNormalizeBlocks(entry.blocks);
			if (!urlRes.ok || !linkRes || !blockRes.ok) continue;
			valid.push({
				id: String(entry.id || "cms-" + urlRes.slug),
				slug: urlRes.slug,
				url: urlRes.url,
				title:
					String(entry.title || "").trim().slice(0, 120) ||
					titleFromSlug(urlRes.slug),
				pageLink: linkRes,
				blocks: blockRes.blocks,
				createdAt: String(entry.createdAt || ""),
				updatedAt: String(entry.updatedAt || "")
			});
			if (valid.length >= CMS_MAX_PAGES) break;
		}
		return valid;
	} catch {
		return [];
	}
}

export function cmsPagesToNavItems(pages: CmsPageRecord[]): CmsNavLinkItem[] {
	return pages.map((p) => ({
		slug: p.slug,
		url: p.url,
		title: p.title,
		pageLink: p.pageLink
	}));
}

/*
 * Injects CMS Top Menu and Footer links into a copy of `createHTML()`
 * without mutating the cached template or interfering with existing DOM order
 * when 0 CMS pages exist.
 */
export function applyCmsLinksToStudioHtml(
	html: string,
	pages: CmsPageRecord[]
): string {
	const topLinks = pages.filter((p) => p.pageLink === CMS_LINK_TOP);
	const footerLinks = pages.filter((p) => p.pageLink === CMS_LINK_FOOTER);

	const landingTopHtml = topLinks
		.map(
			(p) =>
				`<a href="${escapeHtml(p.url)}" class="cms-top-menu-link">${escapeHtml(
					p.title
				)}</a>`
		)
		.join("");

	const landingFooterHtml = footerLinks
		.map(
			(p) =>
				`<a href="${escapeHtml(
					p.url
				)}" class="cms-footer-menu-link">${escapeHtml(p.title)}</a>`
		)
		.join("");

	const studioTopHtml = topLinks.length
		? `<nav class="app-top-cms-links" aria-label="Site pages">${landingTopHtml}</nav>`
		: "";

	const studioFooterHtml = footerLinks.length
		? `<footer class="studio-cms-footer" id="studio-cms-footer"><nav class="studio-cms-footer-links" aria-label="Footer pages">${landingFooterHtml}</nav></footer>`
		: "";

	return html
		.replace("<!--__CMS_TOP_LINKS__-->", () => landingTopHtml)
		.replace("<!--__CMS_FOOTER_LINKS__-->", () => landingFooterHtml)
		.replace("<!--__CMS_STUDIO_TOP_LINKS__-->", () => studioTopHtml)
		.replace("<!--__CMS_STUDIO_FOOTER__-->", () => studioFooterHtml);
}

const CMS_PUBLIC_PAGE_CSS = `
.cms-article {
	max-width: 920px;
	margin: 0 auto;
}

.cms-article-header {
	margin-bottom: 24px;
	padding-bottom: 16px;
	border-bottom: var(--sh-border-w) solid var(--sh-line);
}

.cms-article-title {
	font-size: clamp(1.75rem, 3.2vw, 2.4rem);
	line-height: 1.2;
	margin: 0;
}

.cms-paragraph {
	font-size: 1.05rem;
	line-height: 1.8;
	margin: 0 0 20px;
	white-space: pre-wrap;
	word-break: break-word;
}

/* Strictly 2 images per line */
.cms-image-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 16px;
	margin: 22px 0;
}

.cms-image-card {
	position: relative;
	border: var(--sh-border-w) solid var(--sh-line);
	border-radius: var(--sh-radius);
	overflow: hidden;
	background: var(--sh-panel-2);
	aspect-ratio: 16 / 10;
	display: flex;
	align-items: center;
	justify-content: center;
}

.cms-image-card img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
	cursor: zoom-in;
	transition: transform 0.2s ease;
}

.cms-image-card img:hover {
	transform: scale(1.02);
}

.cms-image-fs-hint {
	position: absolute;
	right: 10px;
	bottom: 10px;
	background: rgba(0, 0, 0, 0.72);
	color: #ffffff;
	font-size: 0.74rem;
	font-weight: 600;
	padding: 4px 9px;
	border-radius: 6px;
	pointer-events: none;
}

@media (max-width: 560px) {
	.cms-image-grid {
		gap: 10px;
	}
}
`;

export function renderCmsBlocksHtml(
	blocks: CmsBlock[],
	pageTitle: string
): string {
	if (!blocks.length) {
		return `<p class="site-muted">This page has no content blocks yet.</p>`;
	}

	const chunks: string[] = [];
	let pendingImages: string[] = [];

	const flushImages = () => {
		if (!pendingImages.length) return;
		const cards = pendingImages
			.map(
				(imgUrl, idx) =>
					`<div class="cms-image-card">` +
					`<img src="${escapeHtml(imgUrl)}" data-fullscreen-src="${escapeHtml(
						imgUrl
					)}" data-fullscreen-caption="${escapeHtml(
						pageTitle + " — Image " + (idx + 1)
					)}" alt="${escapeHtml(
						pageTitle + " image " + (idx + 1)
					)}" loading="lazy" />` +
					`<span class="cms-image-fs-hint">⛶ Click to fullscreen</span>` +
					`</div>`
			)
			.join("");
		chunks.push(`<div class="cms-image-grid">${cards}</div>`);
		pendingImages = [];
	};

	for (const block of blocks) {
		if (block.type === "image") {
			pendingImages.push(block.url);
		} else {
			flushImages();
			chunks.push(
				`<p class="cms-paragraph">${escapeHtml(block.text)}</p>`
			);
		}
	}
	flushImages();

	return chunks.join("\n");
}

export function renderCmsPublicPage(
	page: CmsPageRecord,
	allPages: CmsPageRecord[],
	theme: string
): string {
	const bodyHtml = `
		<article class="site-card cms-article">
			<header class="cms-article-header">
				<h1 class="cms-article-title">${escapeHtml(page.title)}</h1>
			</header>
			<div class="cms-article-body">
				${renderCmsBlocksHtml(page.blocks, page.title)}
			</div>
		</article>
	`;

	return renderShellPage({
		title: page.title,
		description: page.title,
		theme,
		activePath: page.url,
		cmsLinks: cmsPagesToNavItems(allPages),
		bodyHtml,
		extraCss: CMS_PUBLIC_PAGE_CSS
	});
}

/*
 * Handles `/api/cms/pages`, `/api/config/cms`, and `/api/config/cms/delete`.
 * Returns `null` if the pathname is not a CMS API route.
 */
export async function handleCmsApiRoutes(
	request: Request,
	url: URL,
	env: { KV_BINDING?: KVNamespace },
	configPassword: string
): Promise<Response | null> {
	if (url.pathname === "/api/cms/pages" && request.method === "GET") {
		const pages = await readCmsPages(env);
		return cmsJson({
			success: true,
			maxPages: CMS_MAX_PAGES,
			pages
		});
	}

	if (
		url.pathname !== "/api/config/cms" &&
		url.pathname !== "/api/config/cms/delete"
	) {
		return null;
	}

	const body: Record<string, unknown> =
		request.method === "POST" || request.method === "DELETE"
			? ((await request.json().catch(() => ({}))) as Record<
					string,
					unknown
				>)
			: {};

	const suppliedPw =
		request.method === "GET"
			? url.searchParams.get("pw")
			: String(body.pw ?? "");

	if (suppliedPw !== configPassword) {
		return cmsJson({ success: false, error: "Wrong password" }, 403);
	}

	if (!env || !env.KV_BINDING) {
		return cmsJson(
			{
				success: false,
				error: "CMS storage not configured (bind the KV namespace)"
			},
			503
		);
	}

	if (url.pathname === "/api/config/cms" && request.method === "GET") {
		const pages = await readCmsPages(env);
		return cmsJson({
			success: true,
			maxPages: CMS_MAX_PAGES,
			pages
		});
	}

	if (
		(url.pathname === "/api/config/cms/delete" &&
			request.method === "POST") ||
		(url.pathname === "/api/config/cms" && request.method === "DELETE")
	) {
		const targetId = String(body.id ?? "").trim();
		const targetSlug = String(body.slug ?? "").trim().toLowerCase();
		if (!targetId && !targetSlug) {
			return cmsJson(
				{ success: false, error: "Missing page id or slug" },
				400
			);
		}
		const pages = await readCmsPages(env);
		// An id identifies one record. If a caller supplies both fields, do not
		// interpret a second, unrelated slug as another deletion target.
		const filtered = pages.filter((p) =>
			targetId ? p.id !== targetId : p.slug !== targetSlug
		);
		if (filtered.length === pages.length) {
			return cmsJson({ success: false, error: "Page not found" }, 404);
		}
		await env.KV_BINDING.put(CONFIG_CMS_KEY, JSON.stringify(filtered));
		return cmsJson({
			success: true,
			maxPages: CMS_MAX_PAGES,
			pages: filtered
		});
	}

	if (url.pathname === "/api/config/cms" && request.method === "POST") {
		const urlCheck = normalizeCmsUrlInput(body.url ?? body.pageUrl);
		if (!urlCheck.ok) {
			return cmsJson({ success: false, error: urlCheck.error }, 400);
		}

		const pageLink = normalizeCmsPageLink(body.pageLink);
		if (!pageLink) {
			return cmsJson(
				{
					success: false,
					error:
						'Invalid Page Link placement. Choose "Link Placed On Top Menu" or "Link Placed On Footer".'
				},
				400
			);
		}

		const blocksCheck = validateAndNormalizeBlocks(body.blocks);
		if (!blocksCheck.ok) {
			return cmsJson({ success: false, error: blocksCheck.error }, 400);
		}

		const rawTitle = String(body.title ?? "").trim().slice(0, 120);
		const finalTitle = rawTitle || titleFromSlug(urlCheck.slug);
		const editId = String(body.id ?? "").trim();

		const existingPages = await readCmsPages(env);
		const existingIdx = editId
			? existingPages.findIndex((p) => p.id === editId)
			: -1;

		const slugConflict = existingPages.some(
			(p, idx) => p.slug === urlCheck.slug && idx !== existingIdx
		);
		if (slugConflict) {
			return cmsJson(
				{
					success: false,
					error: `A page at ${urlCheck.url} already exists.`
				},
				409
			);
		}

		if (existingIdx === -1 && existingPages.length >= CMS_MAX_PAGES) {
			return cmsJson(
				{
					success: false,
					error: `Maximum of ${CMS_MAX_PAGES} pages may be added.`
				},
				400
			);
		}

		const nowIso = new Date().toISOString();
		const record: CmsPageRecord =
			existingIdx >= 0
				? {
						...existingPages[existingIdx],
						slug: urlCheck.slug,
						url: urlCheck.url,
						title: finalTitle,
						pageLink,
						blocks: blocksCheck.blocks,
						updatedAt: nowIso
					}
				: {
						id:
							"cms-" +
							Date.now().toString(36) +
							"-" +
							Math.random().toString(36).slice(2, 7),
						slug: urlCheck.slug,
						url: urlCheck.url,
						title: finalTitle,
						pageLink,
						blocks: blocksCheck.blocks,
						createdAt: nowIso,
						updatedAt: nowIso
					};

		const updatedPages = [...existingPages];
		if (existingIdx >= 0) {
			updatedPages[existingIdx] = record;
		} else {
			updatedPages.push(record);
		}

		await env.KV_BINDING.put(CONFIG_CMS_KEY, JSON.stringify(updatedPages));

		return cmsJson({
			success: true,
			maxPages: CMS_MAX_PAGES,
			page: record,
			pages: updatedPages
		});
	}

	return cmsJson({ success: false, error: "Method not allowed" }, 405);
}

/*
 * Matches single-level GET `/<slug>` public CMS pages after all built-in routes.
 * Returns `null` if not a CMS page so the caller falls through to 404.
 */
export async function handleCmsPublicPageRoute(
	request: Request,
	url: URL,
	env: { KV_BINDING?: KVNamespace },
	theme: string
): Promise<Response | null> {
	if (request.method !== "GET") return null;
	const match = url.pathname.match(/^\/([a-zA-Z0-9][a-zA-Z0-9-_]{0,63})$/);
	if (!match) return null;

	const slug = match[1].toLowerCase();
	if (RESERVED_CMS_SLUGS.has(slug)) return null;

	const pages = await readCmsPages(env);
	const found = pages.find((p) => p.slug === slug);
	if (!found) return null;

	return new Response(renderCmsPublicPage(found, pages, theme), {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=UTF-8",
			"Cache-Control": "no-store"
		}
	});
}
