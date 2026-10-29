/** Pixabay stock media. No AI calls or provider fallback. */
export interface PixabayEnv {
	PIXABAY_API_KEY?: string;
	PIXABAY_RATE_LIMITER?: DurableObjectNamespace;
}
export const PIXABAY_PER_PAGE = 3;
export const PIXABAY_CACHE_SECONDS = 86400;
export const PIXABAY_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const PIXABAY_MAX_VIDEO_BYTES = 16 * 1024 * 1024;
export type MediaType = "image" | "video";
export interface StockHit {
	id: number; type: MediaType; pageURL: string; user: string; tags: string;
	url: string; previewURL: string; width: number; height: number; duration?: number;
}
export class PixabayError extends Error {
	constructor(message: string, public status = 502, public retryAfter = 0) { super(message); }
}
/** One primary-deployment budget per hashed provider key, across Worker isolates. */
export class PixabayRateLimiter {
	constructor(private state: DurableObjectState) {}
	async fetch(request: Request): Promise<Response> {
		const action = new URL(request.url).pathname;
		// Read once outside the transaction: its callback may be retried by storage.
		const seconds = action === "/cooldown" ? Math.max(1, Math.min(3600, Number(await request.text()) || 60)) : 0;
		return this.state.storage.transaction(async storage => {
			const now = Date.now();
			const budget = await storage.get<{ events: number[]; until: number }>("budget") || { events: [], until: 0 };
			budget.events = (budget.events || []).filter(at => now - at < 60000);
			if (action === "/cooldown") {
				budget.until = Math.max(budget.until, now + seconds * 1000);
			} else {
				if (budget.until > now || budget.events.length >= 90) {
					const next = budget.events.length >= 90 ? budget.events[0] + 60000 : now;
					return new Response("Wait", { status: 429, headers: {
						"Retry-After": String(Math.max(1, Math.ceil((Math.max(budget.until, next) - now) / 1000)))
					} });
				}
				budget.events.push(now);
			}
			await storage.put("budget", budget);
			return new Response("OK");
		});
	}
}
// Bound every I/O wait, not only fetch headers. Cache failure is best-effort;
// the shared rate limiter still fails closed. Caller cancellation never cancels
// another subscriber's coalesced metadata search.
const CACHE_IO_MS = 2000;
function waitForIO<T>(work: PromiseLike<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout>;
		const finish = (error: unknown, value?: T) => {
			clearTimeout(timer); signal?.removeEventListener("abort", abort);
			if (error) reject(error); else resolve(value as T);
		};
		const abort = () => finish(new DOMException("Cancelled", "AbortError"));
		timer = setTimeout(() => finish(new PixabayError("Pixabay operation timed out. Please retry.", 504)), milliseconds);
		// Observe the work even when the caller is already cancelled.
		Promise.resolve(work).then(value => finish(null, value), error => finish(error));
		if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
	});
}
function cancelBody(body: ReadableStream<Uint8Array> | null): void {
	if (body) void body.cancel().catch(() => {});
}
async function cacheMatch(cache: Cache | undefined, key: string, signal?: AbortSignal): Promise<Response | undefined> {
	try { return cache ? await waitForIO(cache.match(key), CACHE_IO_MS, signal) : undefined; }
	catch (error) { if (signal?.aborted) throw error; return undefined; }
}
async function cachePut(cache: Cache | undefined, key: string, response: Response): Promise<void> {
	if (cache) { try { await waitForIO(cache.put(key, response), CACHE_IO_MS); } catch { /* Cache is not the provider. */ } }
}
async function sharedBudget(env: PixabayEnv, fingerprint: string, cooldown = 0): Promise<void> {
	if (!env.PIXABAY_RATE_LIMITER) return; // Local unit tests use the bounded isolate fallback.
	const stub = env.PIXABAY_RATE_LIMITER.get(env.PIXABAY_RATE_LIMITER.idFromName(fingerprint));
	const r = await waitForIO(stub.fetch("https://budget.internal/" + (cooldown ? "cooldown" : "take"), {
		method: "POST", ...(cooldown ? { body: String(cooldown) } : {})
	}), 5000);
	if (!r.ok) throw new PixabayError("Pixabay rate limit (429). Please wait.", 429, Number(r.headers.get("Retry-After")) || 60);
}
function keyFor(env: PixabayEnv): string {
	const key = env?.PIXABAY_API_KEY?.trim();
	if (!key) throw new PixabayError("Pixabay API key is not configured", 503);
	return key;
}
export function normalizeSearchQuery(value: unknown): string {
	return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
function providerURL(value: unknown): string {
	try {
		const u = new URL(String(value));
		if (u.protocol === "https:" && ["pixabay.com", "cdn.pixabay.com"].includes(u.hostname)
			&& !u.username && !u.password && !u.port && !u.searchParams.has("key")) {
			return u.href;
		}
	} catch { /* Invalid provider metadata is discarded. */ }
	return "";
}
async function digest(value: string): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
function edgeCache(): Cache | undefined {
	return typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
}
// Bounded metadata fallback for local tests/runtimes without the Cloudflare Cache API.
const localSearch = new Map<string, { until: number; data: SearchResult }>();
const inFlight = new Map<string, Promise<SearchResult>>();
const budgets = new Map<string, { start: number; calls: number; until: number }>();
export interface SearchResult { provider: "pixabay"; per_page: 3; page: number; totalHits: number; hits: StockHit[] }
export interface SearchInput { q?: string; type?: MediaType; page?: number; per_page?: number; orientation?: string; id?: number }

/** per_page is an explicit input, but the studio's contract permits only 3. */
export async function searchPixabay(env: PixabayEnv, input: SearchInput, signal?: AbortSignal): Promise<SearchResult> {
	if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
	const key = keyFor(env);
	if (input.per_page !== undefined && input.per_page !== PIXABAY_PER_PAGE) throw new PixabayError("per_page must be 3", 400);
	const q = normalizeSearchQuery(input.q);
	const type = input.type || "image";
	if (type !== "image" && type !== "video") throw new PixabayError("type must be image or video", 400);
	const page = input.page ?? 1;
	if (!Number.isInteger(page) || page < 1 || page > 167) throw new PixabayError("page must be 1-167", 400);
	if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) throw new PixabayError("Invalid Pixabay ID", 400);
	if (!q && !input.id) throw new PixabayError("Enter Pixabay search terms", 400);
	const orientation = input.orientation === "portrait" ? "vertical" : input.orientation === "landscape" ? "horizontal" : "all";
	const params = new URLSearchParams({ q, per_page: "3", page: String(page), safesearch: "true" });
	if (input.id) params.set("id", String(input.id));
	if (type === "image") { params.set("image_type", "photo"); params.set("orientation", orientation); }
	const fingerprint = await digest(key);
	const cacheKey = `https://pixabay-cache.invalid/search/${fingerprint}/${type}?${params}`;
	const cache = edgeCache();
	const cached = await cacheMatch(cache, cacheKey, signal);
	if (cached) {
		try { return JSON.parse(new TextDecoder().decode(await readBounded(cached, 1024 * 1024, signal, CACHE_IO_MS))) as SearchResult; }
		catch (error) { if (signal?.aborted) throw error; /* Treat unreadable cache entries as misses. */ }
	}
	const local = localSearch.get(cacheKey);
	if (local && local.until > Date.now()) return local.data;
	const pending = inFlight.get(cacheKey);
	if (pending) return waitForIO(pending, 35000, signal);
	const work = (async (): Promise<SearchResult> => {
		const now = Date.now();
		let budget = budgets.get(fingerprint);
		if (!budget || now - budget.start >= 60000 && budget.until <= now) {
			if (budgets.size >= 32) budgets.delete(budgets.keys().next().value!);
			budgets.set(fingerprint, budget = { start: now, calls: 0, until: 0 });
		}
		if (budget.until > now || budget.calls >= 90) {
			throw new PixabayError("Pixabay rate limit (429). Please wait before searching again.", 429,
				Math.max(1, Math.ceil((Math.max(budget.until, budget.start + 60000) - now) / 1000)));
		}
		await sharedBudget(env, fingerprint);
		budget.calls++;
		params.set("key", key);
		let response: Response;
		const metadataSignal = AbortSignal.timeout(20000);
		try {
			response = await waitForIO(fetch(`https://pixabay.com/api/${type === "video" ? "videos/" : ""}?${params}`, {
				signal: metadataSignal, redirect: "error"
			}), 20000, metadataSignal);
		} catch { throw new PixabayError("Pixabay search is unavailable. Please retry later."); }
		if (response.headers.get("X-RateLimit-Remaining") === "0" || response.status === 429) {
			const reset = Math.max(1, Math.min(3600, Number(response.headers.get("X-RateLimit-Reset")) || 60));
			budget.until = Date.now() + reset * 1000;
			await sharedBudget(env, fingerprint, reset);
		}
		if (!response.ok) {
			cancelBody(response.body);
			throw new PixabayError(response.status === 429 ? "Pixabay rate limit (429). Please wait." : "Pixabay rejected the search. Check server configuration.",
				response.status === 429 ? 429 : 502, response.status === 429 ? Math.max(1, Math.ceil((budget.until - Date.now()) / 1000)) : 0);
		}
		let raw: any;
		try { raw = JSON.parse(new TextDecoder().decode(await readBounded(response, 1024 * 1024, metadataSignal))); }
		catch { throw new PixabayError("Pixabay returned an invalid search response"); }
		if (!Array.isArray(raw.hits)) throw new PixabayError("Pixabay returned an invalid search response");
		const hits: StockHit[] = [];
		for (const h of raw.hits.slice(0, 3)) {
			if (!Number.isSafeInteger(h.id) || h.id < 1) continue;
			const variant = type === "video" ? (h.videos?.small?.url ? h.videos.small : h.videos?.tiny) : null;
			const url = providerURL(type === "image" ? h.largeImageURL || h.webformatURL : variant?.url);
			const pageURL = providerURL(h.pageURL);
			if (!url || !pageURL) continue;
			const duration = Number(h.duration);
			if (type === "video" && (!Number.isFinite(duration) || duration <= 0 || duration > 60 || Number(variant?.size) > PIXABAY_MAX_VIDEO_BYTES)) continue;
			hits.push({ id: h.id, type, pageURL, user: String(h.user || "").slice(0, 120), tags: String(h.tags || "").slice(0, 300), url,
				previewURL: providerURL(type === "video" ? variant?.thumbnail : h.previewURL),
				width: Number(type === "image" ? h.imageWidth : variant?.width) || 0,
				height: Number(type === "image" ? h.imageHeight : variant?.height) || 0,
				...(type === "video" ? { duration } : {}) });
		}
		const data: SearchResult = { provider: "pixabay", per_page: 3, page, totalHits: Number(raw.totalHits) || 0, hits };
		await cachePut(cache, cacheKey, new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" } }));
		if (localSearch.size >= 128) localSearch.delete(localSearch.keys().next().value!);
		localSearch.set(cacheKey, { until: Date.now() + PIXABAY_CACHE_SECONDS * 1000, data });
		return data;
	})();
	inFlight.set(cacheKey, work);
	// The shared work owns its lifetime; an aborted subscriber must not delete
	// the in-flight entry and cause duplicate paid searches.
	void work.finally(() => { if (inFlight.get(cacheKey) === work) inFlight.delete(cacheKey); }).catch(() => {});
	return waitForIO(work, 35000, signal);
}
async function readBounded(response: Response, max: number, signal?: AbortSignal, timeoutMs = 30000): Promise<Uint8Array> {
	if (Number(response.headers.get("Content-Length")) > max) { cancelBody(response.body); throw new PixabayError("Pixabay asset exceeds size limit", 413); }
	const reader = response.body?.getReader();
	if (!reader) throw new PixabayError("Empty Pixabay response");
	const chunks: Uint8Array[] = []; let size = 0;
	const deadline = Date.now() + timeoutMs;
	try {
		while (true) {
			const part = await waitForIO(reader.read(), Math.max(1, deadline - Date.now()), signal); if (part.done) break;
			size += part.value.length;
			if (size > max) { void reader.cancel().catch(() => {}); throw new PixabayError("Pixabay asset exceeds size limit", 413); }
			chunks.push(part.value);
		}
	} catch (error) {
		void reader.cancel().catch(() => {}); throw error;
	} finally { reader.releaseLock(); }
	const result = new Uint8Array(size); let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
	return result;
}
// Bound simultaneous materialization: a Worker has limited memory, especially for MP4.
let downloadTail: Promise<void> = Promise.resolve();
export async function downloadPixabay(hit: StockHit, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> {
	if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
	const previous = downloadTail;
	let release!: () => void;
	downloadTail = new Promise<void>(resolve => { release = resolve; });
	let acquired = false;
	try {
		await waitForIO(previous, 300000, signal); acquired = true;
		return await downloadPixabayUnqueued(hit, signal);
	} finally {
		// A cancelled waiter must not let successors overtake the active download.
		if (acquired) release(); else void previous.then(release, release);
	}
}
async function downloadPixabayUnqueued(hit: StockHit, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> {
	if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
	const cache = edgeCache();
	const cacheKey = `https://pixabay-cache.invalid/asset/${hit.type}/${hit.id}`;
	const stored = await cacheMatch(cache, cacheKey, signal);
	if (stored) {
		try { return { bytes: await readBounded(stored, hit.type === "image" ? PIXABAY_MAX_IMAGE_BYTES : PIXABAY_MAX_VIDEO_BYTES, signal, CACHE_IO_MS), mime: stored.headers.get("Content-Type")! }; }
		catch (error) { if (signal?.aborted) throw error; }
	}
	let url = providerURL(hit.url); if (!url) throw new PixabayError("Invalid Pixabay asset URL", 400);
	const timeout = AbortSignal.timeout(30000);
	const fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
	let response: Response | undefined;
	for (let redirects = 0; redirects < 4; redirects++) {
		response = await waitForIO(fetch(url, { redirect: "manual", signal: fetchSignal }), 30000, fetchSignal);
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("Location"); cancelBody(response.body);
			url = location ? providerURL(new URL(location, url).href) : "";
			if (!url) throw new PixabayError("Unsafe Pixabay redirect");
			response = undefined; continue;
		}
		break;
	}
	if (!response?.ok) throw new PixabayError("Pixabay download failed");
	const mime = (response.headers.get("Content-Type") || "").split(";")[0];
	if (!(hit.type === "image" ? ["image/jpeg", "image/png", "image/webp"].includes(mime) : mime === "video/mp4")) {
		cancelBody(response.body); throw new PixabayError("Unsupported Pixabay media format");
	}
	const bytes = await readBounded(response, hit.type === "image" ? PIXABAY_MAX_IMAGE_BYTES : PIXABAY_MAX_VIDEO_BYTES, fetchSignal);
	const valid = mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
		: mime === "image/png" ? [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)
		: mime === "image/webp" ? new TextDecoder().decode(bytes.slice(0,4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8,12)) === "WEBP"
		: new TextDecoder().decode(bytes.slice(4,8)) === "ftyp";
	if (!valid) throw new PixabayError("Invalid Pixabay media bytes");
	// Download on the server first; the browser receives our bytes, never a permanent image hotlink.
	await cachePut(cache, cacheKey, new Response(bytes, { headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" } }));
	return { bytes, mime };
}
export function sceneSearchToken(q: string, scene: number): string {
	return "pixabay:" + JSON.stringify({ q: normalizeSearchQuery(q), page: Math.floor(scene / 3) + 1, index: scene % 3 });
}
export async function pixabaySceneImage(env: PixabayEnv, token: string, options: { signal?: AbortSignal; width?: number; height?: number } = {}) {
	let q = token, page = 1, index = 0, type: MediaType = "image";
	if (token.startsWith("pixabay:")) {
		try { const t = JSON.parse(token.slice(8)); q = t.q; page = t.page; index = t.index; type = t.type || "image"; }
		catch { throw new PixabayError("Invalid stock scene selection", 400); }
	}
	if (!["image", "video"].includes(type) || typeof q !== "string" || !Number.isInteger(index) || index < 0 || index > 2) throw new PixabayError("Invalid stock scene selection", 400);
	const results = await searchPixabay(env, { q, page, type, per_page: 3,
		orientation: (options.height || 0) > (options.width || 0) ? "portrait" : "landscape" }, options.signal);
	const hit = results.hits[index] || results.hits[0];
	if (!hit) throw new PixabayError("No suitable Pixabay media for this scene. Try different search terms or upload media.", 404);
	const image = await downloadPixabay(hit, options.signal);
	return { ...image, source: { provider: "pixabay", id: hit.id, pageURL: hit.pageURL, user: hit.user, type, duration: hit.duration } };
}
export async function handlePixabayApi(request: Request, env: PixabayEnv): Promise<Response> {
	const u = new URL(request.url);
	try {
		const type = (u.searchParams.get("type") || "image") as MediaType;
		const id = u.searchParams.has("id") ? Number(u.searchParams.get("id")) : undefined;
		const result = await searchPixabay(env, { q: u.searchParams.get("q") || "", type, id,
			page: Number(u.searchParams.get("page") || 1), per_page: Number(u.searchParams.get("per_page") || 3),
			orientation: u.searchParams.get("orientation") || "landscape" }, request.signal);
		if (u.pathname === "/api/media/asset") {
			if (!id) throw new PixabayError("A Pixabay asset ID is required", 400);
			const hit = result.hits.find(h => h.id === id);
			if (!hit) throw new PixabayError("Pixabay asset not found or exceeds clip limits", 404);
			const asset = await downloadPixabay(hit, request.signal);
			return new Response(asset.bytes, { headers: { "Content-Type": asset.mime, "Cache-Control": "no-store", "X-Media-Provider": "pixabay", "X-Content-Type-Options": "nosniff" } });
		}
		return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
	} catch (e) {
		const error = e instanceof PixabayError ? e : new PixabayError("Pixabay media request failed");
		return Response.json({ success: false, error: error.message }, { status: error.status,
			headers: { "Cache-Control": "no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
	}
}
