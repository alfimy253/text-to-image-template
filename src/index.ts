export { PixabayRateLimiter } from "./modules/pixabay";
import { handlePixabayApi } from "./modules/pixabay";
/*
 * YouTube Vibe Studio — Cloudflare Worker entry.
 *
 * The single-file version was split into modules:
 *
 *   ./prompts                    shared AI model + prompt list
 *   ./page                       createHTML() page assembly
 *   ./client/markup              HTML skeleton
 *   ./client/styles              page CSS
 *   ./client/app-js              main studio client script
 *   ./client/template-composer-js  "Add video from template" modal
 *   ./client/config-page-js      day-prefixed settings overlay
 *
 * Route, API and KV logic is implemented below.
 */

import { createHTML } from "./page";
import { CONFIG_PAGE_SCRIPT } from "./client/config-page-js";
import {
	applyCmsLinksToStudioHtml,
	handleCmsApiRoutes,
	handleCmsPublicPageRoute,
	readCmsPages
} from "./modules/cms";
import { handlePaymentRoutes } from "./modules/payments";
import {
	renderAccountPageResponse,
	renderUpgradePageResponse
} from "./modules/user-pages";
import { handleSeoScriptGeneration, handleSeoPlanGeneration } from "./modules/script-seo";
import {
	handleGenerateImagePrompts,
	handleRemovedImagePromptJobRoute
} from "./modules/image-prompts";
import {
	classifyImageFailure,
	handleImageBatch,
	handleImageBinary,
	IMAGE_ATTEMPT_TIMEOUT_MS,
	type ImageModelResult,
	runImageModel,
	sharedImageLoadGovernor,
	sharedImageTaskQueue
} from "./modules/image-batch";
import { handleVoiceover } from "./modules/voiceover";
import {
	applyRelayCors,
	handleRelayRoutes,
	invalidateRelayCache,
	relayPreflightResponse,
	relayRuntimeOf,
	relayTicketIdentity,
	RELAY_TICKET_HEADER,
	withRelayedAi
} from "./modules/api-relay";
import {
	handleLlmRoutes,
	promptFromAiInput,
	readLlmConfig,
	runOpenRouterCompletion
} from "./modules/llm-openrouter";

/*
 * =============================================================
 * THEME HELPERS
 * -------------------------------------------------------------
 * The studio ships seven skins: the built-in look (no
 * attribute) plus "strata" / "stellar" (the HTML5UP pair) and
 * "nightlab" / "paper" / "swiss" / "neo" (the four skins of
 * the uploaded bulk-video reference, Bug Fix Session #240).
 * The settings
 * page stores the choice in KV; the HTML routes read it and
 * write data-theme onto the <html> tag, so the skin is applied
 * during parse and no default-themed frame is ever painted.
 * =============================================================
 */

const CONFIG_THEME_KEY =
	"config:theme";

/*
 * The settings URL uses Asia/Taipei's day of month. Workers default
 * to UTC, so set the time zone explicitly for consistent rotation
 * across deployment locations.
 */
const CONFIG_DAY_FORMATTER =
	new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		timeZone: "Asia/Taipei"
	});

function getCurrentConfigPath() {
	return "/" + CONFIG_DAY_FORMATTER.format(new Date()) + "/config/uvxyz";
}

/*
 * The whitelist. "default" is the built-in studio look; the
 * other six names are the CSS themes in client/styles.ts and
 * are the ONLY values that ever reach the markup.
 *
 *   strata   Aerial (HTML5UP)          stellar  Stellar (HTML5UP)
 *   nightlab Night Lab                 paper    Warm Paper
 *   swiss    Swiss                     neo      Neo Brutalist
 */

const CONFIG_THEMES = [
	"default",
	"strata",
	"stellar",
	"nightlab",
	"paper",
	"swiss",
	"neo"
];

function normalizeTheme(value: any) {

	const theme =
		String(value || "")
			.trim()
			.toLowerCase();

	return CONFIG_THEMES.indexOf(theme) === -1
		? "default"
		: theme;

}

/*
 * Reads the stored theme. Never throws: a missing binding
 * (e2e/dev config), a KV error or a stale value all fall back
 * to the built-in look.
 */

async function readTheme(env: any) {

	if (!env || !env.KV_BINDING) {
		return "default";
	}

	try {

		return normalizeTheme(
			await env.KV_BINDING.get(
				CONFIG_THEME_KEY
			)
		);

	}
	catch (themeError) {

		return "default";

	}

}

/*
 * Writes data-theme into a copy of the cached page. Only the
 * three whitelisted names ever reach the markup.
 */

function applyTheme(html: string, theme: string) {

	if (!theme || theme === "default") {
		return html;
	}

	return html.replace(
		"<html lang=\"en\">",
		'<html lang="en" data-theme="' + theme + '">'
	);

}

export default {
	async fetch(request, env, ctx: any) {

		/*
		 * The relay layer wraps the whole router:
		 *
		 *   - a CORS preflight for an AI path is answered before routing,
		 *   - every other answer passes through `applyRelayCors`, which only
		 *     grants cross-origin reads to a caller holding a signed ticket,
		 *   - `handleRequest` below is the original single-file router, with
		 *     `env` upgraded so `env.AI` is the rotation runtime.
		 */
		const preflight =
			relayPreflightResponse(request);

		if (preflight) {
			return preflight;
		}

		const response =
			await handleRequest(
				request,
				env,
				ctx
			);

		return await applyRelayCors(request, response, env);

	}

};


/*
 * The original router. `env` is upgraded inside: `withRelayedAi()` replaces
 * only the AI binding, so every existing `env.AI.run()` call site (images,
 * prompt writing, script, seo-plan, voiceover, the demo route) participates in
 * the rotation pool without being rewritten.
 */
async function handleRequest(request: any, env: any, ctx: any) {

		const url =
			new URL(request.url);

		/*
		 * API rotation (src/modules/api-relay.ts): a lazily-evaluated pool of
		 * this Worker plus the up-to-3 backup Worker URLs registered on the
		 * settings page. Nothing happens here until a route touches env.AI.
		 *
		 * `baseEnv` keeps the untouched bindings: the inbound
		 * `POST /api/relay/ai` endpoint MUST run on the raw binding, otherwise a
		 * relayed call would be relayed again (and a pool member that also
		 * received the request could bounce it back).
		 */
		const baseEnv = env;

		/*
		 * A request carrying a rotation ticket was deliberately sent here by
		 * the browser, so this member runs the inference instead of relaying
		 * it back to the Worker the studio just left.
		 */
		env = withRelayedAi(env, request, {
			preferLocal: !!request.headers.get(RELAY_TICKET_HEADER)
		});

		// Capability negotiation is non-billable. Old clients keep legacy routes.
		if (request.method === "GET" && url.pathname === "/api/pipeline-capabilities") {
			/*
			 * Additive fields only: `version` stays 261, so an older client
			 * ignores what it does not know and a newer client degrades to
			 * the documented 3-per-row behaviour when a field is missing.
			 *
			 * imageChunks = how many 3-scene prompt batches the browser may
			 * keep rendering at the same time. 2 means a single row no
			 * longer waits for its slowest three images before starting the
			 * next three.
			 *
			 * imageSlots = how many binary /api/image requests one tab may
			 * keep in flight (the documented adaptive default is 3). The
			 * per-row 3-per-3 s server pacing, the shared load governor and
			 * the 20-image ceiling are unchanged: this only stops the
			 * browser from being the narrowest pipe when three batch rows
			 * render at once.
			 */
			return new Response(JSON.stringify({ version: 261, binaryImages: true, chunkVoiceover: true,
				singleAttemptScript: true, compactPrompts: true, imageChunks: 2, imageSlots: 6,
				/* API rotation across backup Workers (src/modules/api-relay.ts). */
				apiRelay: 1, mediaProvider: "pixabay", per_page: 3 }), {
				headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
			});
		}

		// =====================================================
		// MAIN APPLICATION
		// =====================================================

		if (
			request.method === "GET" &&
			url.pathname === "/"
		) {

			const [landingTheme, landingCmsPages] =
				await Promise.all([
					readTheme(env),
					readCmsPages(env)
				]);

			return new Response(
				applyCmsLinksToStudioHtml(
					applyTheme(
						createHTML(),
						landingTheme
					),
					landingCmsPages
				),
				{
					status: 200,

					headers: {
						"Content-Type":
							"text/html; charset=UTF-8",
						"Cache-Control":
							"no-store"
					}
				}
			);
		}

		if (
			request.method === "GET" &&
			url.pathname === "/account"
		) {
			return renderAccountPageResponse(
				request,
				env,
				await readTheme(env),
				creditSessionUser
			);
		}

		if (
			request.method === "GET" &&
			url.pathname === "/upgrade"
		) {
			return renderUpgradePageResponse(
				request,
				env,
				await readTheme(env),
				creditSessionUser
			);
		}


		/*
		 * User-type based URL restrictions (RULE 21).
		 *
		 *   GET /free    freemium studio, every visitor; sets the
		 *                yvs_free cookie that unlocks the guest
		 *                image allowance (10/day per IP).
		 *   GET /studio  free_user / paid_user only.
		 *   GET /paid    paid_user only.
		 *
		 * Guests are redirected to /free, not to the landing
		 * page, because /free is the no-account entry point.
		 */
		if (
			request.method === "GET" &&
			PLAN_MODE_BY_ROUTE[
				url.pathname
			]
		) {

			const planMode =
				PLAN_MODE_BY_ROUTE[
					url.pathname
				];

			if (
				planMode !==
				"freemium"
			) {

				const routeUser =
					await creditSessionUser(
						request,
						env
					);

				if (!routeUser) {

					return redirectResponse(
						"/free"
					);

				}

				if (
					planMode ===
						"paid" &&
					routeUser.usertype !==
						"paid_user"
				) {

					return redirectResponse(
						"/studio"
					);

				}

			}

			return appPageResponse(
				env,
				planMode
			);

		}


		// =====================================================
		// AI IMAGE GENERATION
		// =====================================================

		if (request.method === "GET" && /^\/image\/\d+$/.test(url.pathname)) {
			return json({ success: false, error: "AI demo images were removed. Use Pixabay media search." }, 410);
		}
		if (request.method === "GET" && ["/api/media/search", "/api/media/asset"].includes(url.pathname)) {
			// Same primary-origin boundary as the existing stock import routes.
			const access = await imageCreditHooks(request, env);
			if (access.blocked) return access.blocked;
			if (url.pathname === "/api/media/search") return handlePixabayApi(request, env);
			const reservation = access.open ? null : await access.consume(1);
			if (reservation && !reservation.allowed) return json({ success: false, error: "Daily stock import allowance exhausted", credits: reservation.summary }, 429);
			try {
				const response = await handlePixabayApi(request, env);
				if (!response.ok && reservation) await access.refund(1);
				return response;
			} catch (error) {
				if (reservation) await access.refund(1);
				throw error;
			}
		}

		// =====================================================
		// AI IMAGE GENERATION - single image (accordion AI panel)
		// GET /image/gen?prompt=...&variant=1|2
		//
		// One HTTP response is one image, so one credit. The
		// counter is taken before the model runs and refunded if
		// the model fails, so a failed call never costs the user
		// an image. The batch route below shares the same gate.
		// =====================================================

		if (
			request.method === "GET" &&
			url.pathname === "/image/gen"
		) {

			const prompt =
				(url.searchParams.get("prompt") || "").trim();

			const variant =
				url.searchParams.get("variant") || "1";

			if (!prompt) {
				return json(
					{
						success: false,
						error:
							"Missing prompt"
					},
					400
				);
			}

			const credits =
				await imageCreditHooks(
					request,
					env
				);

			if (credits.blocked) {

				return credits.blocked;

			}

			const gate =
				credits.open
					? null
					: await credits.consume(1);

			if (
				gate &&
				!gate.allowed
			) {

				return json(
					{
						success: false,
						error:
							creditExhaustedMessage(
								credits.plan,
								credits.scope === "ip"
							),
						credits:
							gate.summary
					},
					429
				);

			}

			const imageHeaders: any = {

				"Cache-Control":
					"no-store",

				"X-Image-Variant":
					variant
			};

			if (gate && gate.allowed) {

				Object.assign(
					imageHeaders,
					creditResponseHeaders(
						gate.summary,
						credits
					)
				);

			}

			const imageStartedAt =
				Date.now();

			console.info("[image-gen] request", {
				variant,
				promptChars: prompt.length,
				plan: gate && gate.summary ? gate.summary.usertype : "open"
			});

			try {

				const singleGroupId =
					"image-gen:" +
					String(
						(credits && credits.subject) ||
							request.headers.get("CF-Connecting-IP") ||
							"guest"
					);

				const image =
					await sharedImageTaskQueue.enqueue({
						groupId: singleGroupId,
						signal: request.signal,
						execute: () =>
							new Promise<ImageModelResult>((resolve, reject) => {
								const timer = setTimeout(() => {
									reject(
										new Error(
											"Image generation timed out after " +
												Math.round(IMAGE_ATTEMPT_TIMEOUT_MS / 1000) +
												" s"
										)
									);
								}, IMAGE_ATTEMPT_TIMEOUT_MS);
							runImageModel(
								env,
								prompt,
								{
									/*
									 * Bug fix (image throughput): the
									 * browser's signal was never
									 * forwarded, so a cancelled or
									 * closed request kept its shared
									 * image-queue slot - and the paid
									 * inference - alive for up to
									 * IMAGE_ATTEMPT_TIMEOUT_MS while
									 * everyone else waited behind it.
									 * The batch route already did this.
									 */
									signal: request.signal
								}
							).then(
									(val) => {
										clearTimeout(timer);
										resolve(val);
									},
									(err) => {
										clearTimeout(timer);
										reject(err);
									}
								);
							})
					});

				console.info("[image-gen] success", {
					variant,
					promptChars: prompt.length,
					bytes: image.bytes.length,
					ms: Date.now() - imageStartedAt
				});

				return new Response(
					image.bytes,
					{
						status: 200,
						headers:
							Object.assign(
								{
									"Content-Type":
										image.mime
								},
								imageHeaders
							)
					}
				);

			}
			catch (error) {

				console.error("[image-gen] failed", {
					variant,
					promptChars: prompt.length,
					ms: Date.now() - imageStartedAt,
					error:
						error instanceof Error
							? error.message
							: String(error)
				});

				/*
				 * The model failed: give the credit back.
				 */
				if (gate && gate.allowed) {

					try {

						await credits.refund(1);

					}
					catch (refundError) {

						/* best effort */

					}

				}

				/*
				 * Server-load backoff: when the provider said it is
				 * shedding load, answer 503 + Retry-After (with the
				 * live concurrency ceiling) instead of a flat 500.
				 * The caller can then wait exactly as long as the
				 * fleet asked instead of guessing.
				 */
				const classification =
					classifyImageFailure(error);

				const overload =
					classification.kind === "overload";

				const loadHint =
					classification.retryAfterMs ||
					(overload
						? sharedImageLoadGovernor.cooldownRemainingMs
						: 0);

				const failureBody: any = {
					success: false,
					error:
						error instanceof Error
							? error.message
							: String(error),
					kind:
						classification.kind
				};

				if (loadHint > 0) {
					failureBody.retryAfterMs =
						loadHint;
				}

				if (overload) {
					failureBody.load =
						sharedImageLoadGovernor.snapshot();
				}

				const failureHeaders: any = {
					"Content-Type":
						"application/json",
					"Cache-Control":
						"no-store"
				};

				if (overload && loadHint > 0) {
					failureHeaders["Retry-After"] =
						String(
							Math.max(
								1,
								Math.ceil(
									loadHint / 1000
								)
							)
						);
				}

				return new Response(
					JSON.stringify(
						failureBody
					),
					{
						status:
							overload
								? 503
								: 500,
						headers:
							failureHeaders
					}
				);
			}
		}


		// =====================================================
		// USER AUTH API (KV-backed, unlimited users)
		// GET  /api/session
		// POST /api/login
		// POST /api/signup
		// POST /api/logout
		// (requires the KV_BINDING namespace binding)
		// =====================================================

		const authResponse =
			await handleAuthApi(
				request,
				url,
				env
			);

		if (authResponse) {
			return authResponse;
		}
		// =====================================================
		// RENDER API + BACKGROUND WORKERS
		// POST /api/render            all video elements -> job
		// GET  /api/render/<jobId>    status, or the MP4
		// GET  /api/worker/poll       worker claims a job
		// POST /api/worker/deliver    worker uploads the MP4
		// POST /api/worker/failed     worker reports failure
		// POST /api/script            SEO EXPLAINER script
		//                             (PLAIN narration text) via an
		//                             INSTRUCT model: plan
		//                             1 long-tail keyword (must be
		//                             said AT LEAST ONCE), exactly
		//                             4 short keywords (each must
		//                             be said AT LEAST TWICE; extra
		//                             uses allowed), a title
		//                             (<=70 chars) and >=1 heading,
		//                             then write the script around
		//                             them (minimum-only rule)
		// POST /api/voiceover         MeloTTS voice -> MP3
		// GET/POST /api/config/workers  up to 3 worker URLs
		// GET/POST /api/config/theme  studio theme (default /
		//                             strata / stellar)
		// GET  /{current-day}/config/uvxyz settings page (Asia/Taipei)
		// (password: CONFIG_PASSWORD; stale/bare paths return 404)
		// =====================================================

		const CONFIG_PASSWORD =
			"#123admin%";

		const BLOB_CHUNK_SIZE =
			20 * 1024 * 1024;

		const CONFIG_WORKERS_KEY =
			"config:workers";

		const MAX_RENDER_JOBS =
			10;

		/* =====================================================
		 * API ROTATION ROUTES (src/modules/api-relay.ts)
		 *
		 * GET  /api/relay/pool     pool + short-lived client ticket (studio)
		 * GET  /api/relay/status   pool, health and probe results (admin)
		 * GET/POST /api/relay/config  rotation policy (POST = password)
		 * POST /api/relay/test     force a fresh probe of every backup
		 * GET  /api/relay/ping     "I am a relay-capable deployment"
		 * POST /api/relay/ai       one model call, executed here (token)
		 *
		 * Dispatched with the RAW bindings (`baseEnv`): a relayed call must
		 * never be relayed again.
		 * ===================================================== */

		const relayResponse =
			await handleRelayRoutes(
				request,
				url,
				baseEnv,
				{
					selfOrigin: url.origin,
					configPassword: CONFIG_PASSWORD,
					identity: () => creditSessionUser(request, baseEnv),
					guest: () => hasFreemiumCookie(request),
					waitUntil: (promise) => {
						if (ctx && typeof ctx.waitUntil === "function") {
							ctx.waitUntil(promise);
						}
					}
				}
			);

		if (relayResponse) {
			return relayResponse;
		}

		/* =====================================================
		 * LLM PROVIDER ROTATION ADMIN ROUTES (bug fix #271)
		 *
		 * GET  /api/llm/status   providers, model, key source, health
		 * GET  /api/llm/config   rotation policy (the key is never echoed)
		 * POST /api/llm/config   save the policy (settings password)
		 * POST /api/llm/test     probe OpenRouter and/or Cloudflare now
		 *
		 * The user-facing raw call (`POST /api/llm/generate`) lives with the
		 * other AI routes below, because it is billed and authenticated.
		 * ===================================================== */

		const llmResponse =
			await handleLlmRoutes(
				request,
				url,
				baseEnv,
				{
					configPassword: CONFIG_PASSWORD,
					/* Runs through the rotation runtime, so the probe also
					   exercises the backup-worker pool. */
					cloudflareProbe: async (probePrompt: string) => {
						const result: any = await env.AI.run(
							SCRIPT_MODEL,
							{ prompt: probePrompt, max_tokens: 64, temperature: 0.2 }
						);
						return result && typeof result.response === "string"
							? result.response
							: JSON.stringify(result || "");
					}
				}
			);

		if (llmResponse) {
			return llmResponse;
		}

		// INSTRUCT model for the
		// narration script. The old
		// FREE llama-3.1-8b-instruct
		// was deprecated by
		// Cloudflare on 2026-05-30;
		// this fp8 build is the
		// cheapest instruct model
		// in the current catalog.
		const SCRIPT_MODEL =
			"@cf/meta/llama-3.1-8b-instruct-fp8";

		// MeloTTS (MyShell) -
		// the TTS model for
		// voiceover MP3s. One
		// fixed voice per
		// language (no
		// male/female
		// parameter).
		const VOICEOVER_MODEL =
			"@cf/myshell-ai/melotts";

		/*
			* Fallback TTS endpoint
			* (free), used when the
			* Workers AI melotts
			* engine keeps failing
			* a chunk (3043).
		*/
		const FALLBACK_TTS_URL =
			"https://tts-api.netlify.app/";

		async function putBlobStore(
			env,
			id,
			bytes,
			contentType
		) {

			const total =
				bytes.length;

			const parts =
				Math.max(
					1,
					Math.ceil(
						total /
						BLOB_CHUNK_SIZE
					)
				);

			for (
				let i = 0;
				i < parts;
				i++
			) {

			/*
			 * subarray() is a view over
			 * the same bytes, not a
			 * copy: slice() would
			 * duplicate up to 20 MB
			 * per chunk for nothing.
			 */

			await env.KV_BINDING.put(
				"blob:" + id + ":" + i,
				new Response(
					bytes.subarray(
						i * BLOB_CHUNK_SIZE,
						(i + 1) * BLOB_CHUNK_SIZE
					)
				).body,
				{
					expirationTtl:
						7200
				}
			);

			}

			await env.KV_BINDING.put(
				"blob:" + id + ":_idx",
				JSON.stringify(
					{
						parts:
						parts,
						total:
						total,
						contentType:
							contentType ||
							"application/octet-stream"
					}
				),
				{ expirationTtl: 7200 }
			);

		}

		async function getBlobStore(
			env,
			id
		) {

			const idxRaw =
				await env.KV_BINDING.get(
					"blob:" + id + ":_idx"
				);

			if (!idxRaw) {
				return null;
			}

			const idx =
				JSON.parse(idxRaw);

			/*
			 * All parts are fetched in
			 * parallel (the old loop
			 * awaited each get, so its
			 * Promise.all never ran
			 * concurrently) and every
			 * chunk is copied straight
			 * into one preallocated
			 * buffer. Collecting all
			 * chunks first and copying
			 * them again held roughly
			 * TWICE the file size in
			 * memory at peak.
			 */

			const out =
				new Uint8Array(
					idx.total
				);

			await Promise.all(
				Array.from(
					{ length: idx.parts },
					(_, i) =>
						(async () => {

							const body =
								await env.KV_BINDING.get(
									"blob:" + id + ":" + i,
									"stream"
								);

							if (!body) {
								return;
							}

							const chunk =
								await new Response(body).arrayBuffer();

							out.set(
								new Uint8Array(chunk),
								i * BLOB_CHUNK_SIZE
							);

						})()
				)
			);

			return {
				bytes:
				out,
				contentType:
					idx.contentType,
				total:
					idx.total
			};

		}

		async function listRenderJobs(env) {

			const list =
				await env.KV_BINDING.list(
					{ prefix: "job:" }
				);

			/*
			 * The gets run in parallel:
			 * this helper runs on every
			 * worker poll and every
			 * render submission, and
			 * sequential reads would
			 * stack one KV round-trip
			 * behind the other.
			 */

			const jobs: any[] =
				[];

			await Promise.all(
				list.keys.map(
					async (key: any) => {

						const raw =
							await env.KV_BINDING.get(
								key.name
							);

						if (raw) {
							jobs.push(
								JSON.parse(raw)
							);
						}

					}
				)
			);

			return jobs;

		}

		/*
			* No KV: the render API is
			* unavailable (503).
		*/
		const RENDER_API_PATH =
			(url.pathname === "/api/render" ||
			url.pathname.indexOf("/api/render/") === 0 ||
			url.pathname === "/api/worker/poll" ||
			url.pathname === "/api/worker/deliver" ||
			url.pathname === "/api/worker/failed");

		if (
			!env.KV_BINDING &&
			RENDER_API_PATH
		) {

			return json(
				{
					success: false,
					error:
						"Render storage not configured (bind the KV namespace)"
				},
				503
			);

		}

		/*
			* Settings page (password gated). The day is evaluated per
			* request in Asia/Taipei; the bare legacy path and any stale
			* day path fall through to the normal 404 response.
		*/
		if (
			request.method === "GET" &&
			url.pathname === getCurrentConfigPath()
		) {

			let cfgHtml =
				applyCmsLinksToStudioHtml(
					applyTheme(
						createHTML(),
						await readTheme(env)
					),
					[]
				);

			cfgHtml =
				cfgHtml.replace(
					"<script>",
					() =>
						"<script>window.__CONFIG_PAGE = true;</" +
						"script>\r\n<script>"
				);

			cfgHtml =
				cfgHtml.replace(
					"</body>",
					() =>
						CONFIG_PAGE_SCRIPT +
						"</body>"
				);

			return new Response(
				cfgHtml,
				{
					status: 200,
					headers: {
						"Content-Type":
							"text/html; charset=UTF-8"
					}
				}
			);

		}

		/*
			* SEO EXPLAINER script
			* generation - the browser is
			* handed PLAIN narration text,
			* never a subtitle format, because
			* the voiceover model would read
			* cue numbers out loud. INSTRUCT
			* model on Workers AI, in two
			* stages
			* (2026-10-24 minimum-frequency
			* rule set - every earlier
			* script rule was removed).
			*
			*  1. Keywords: exactly 1
			*     long-tail keyword (no length
			*     rule), exactly 4 short
			*     keywords (<=3 words each),
			*     a title (<=70 chars) that
			*     includes one short keyword
			*     and >=1 heading (<=12 words
			*     each) of which one includes
			*     a short keyword (its own 3
			*     attempts).
			*  2. Script: EXPLAINER narration
			*     built around that plan. The
			*     rules are REDUNDANT: stated in
			*     the prompt AND re-checked here.
			*     The output is VALIDATED
			*     server-side against timed cues
			*     under the selected minutes AND
			*     the
			*     long-tail keyword spoken AT
			*     LEAST 1 time AND every one of
			*     the 4 short keywords spoken
			*     AT LEAST 2 times. Frequency
			*     is minimum-only: extra uses
			*     are never rejected (invalid
			*     output is retried up to 3
			*     times with the problem
			*     spelled out).
			*     The cues + timestamps are the
			*     Worker's own proof of length
			*     and keyword counts: they are
			*     checked, then collapsed into
			*     plain paragraphs, so no
			*     subtitle format leaves this
			*     file.
		*/
		/*
		 * SEO PLAN (two selectable keyword sets) for the accordion
		 * walkthrough: POST /api/seo-plan {topic} plans TWO different
		 * validated sets (1 long-tail + exactly 4 shorts, title and
		 * headings each); the client shows both, the user selects one,
		 * and that set is then sent back as `keywordSet` to
		 * POST /api/script, which skips its own planner.
		 */
		if (
			request.method === "POST" &&
			url.pathname === "/api/seo-plan"
		) {

			return handleSeoPlanGeneration(
				request,
				env,
				SCRIPT_MODEL
			);

		}

		/*
		 * TEXT-LLM STOCK KEYWORDS + PIXABAY PHOTO/VIDEO DELIVERY (no polling):
		 *   POST /api/image-prompts  -> {prompts: [...]} in the body
		 *   POST /api/image-batch    -> application/x-ndjson stream of
		 *                               {type:"image"} events, one per
		 *                               rendered scene (see
		 *                               src/modules/image-batch.ts)
		 * The prompt count follows the script length (1 min -> 10,
		 * 2-3 min -> 14, 4-6 min -> 20), including exactly two video slots.
		 * The text model plans short stock-search keywords from the whole script inside
		 * the POST, so the browser never polls a background job; the old
		 * /api/image-prompts/<id> job URL now answers 410 Gone.
		 */
		if (
			request.method === "POST" &&
			url.pathname === "/api/image-prompts"
		) {

			const plannerAccess = await imageCreditHooks(request, env);
			if (plannerAccess.blocked) return plannerAccess.blocked;
			return handleGenerateImagePrompts(
				request,
				env,
				SCRIPT_MODEL
			);

		}

		if (
			request.method === "POST" &&
			(url.pathname === "/api/image-batch" || url.pathname === "/api/image")
		) {

			const imageCredits =
				await imageCreditHooks(
					request,
					env
				);

			if (imageCredits.blocked) {

				return imageCredits.blocked;

			}

			/*
			 * Without a KV binding the app runs unmetered (open
			 * access); otherwise every requested image costs one
			 * credit up front and failures are refunded.
			 */
			return (url.pathname === "/api/image" ? handleImageBinary : handleImageBatch)(
				request,
				env,
				imageCredits.open
					? {
						consume: async (amount: number) => ({
							allowed: true,
							granted: amount,
							summary: null
						}),
						refund: async () => null
					}
					: {
						consume: (amount: number) =>
							imageCredits.consume(amount),
						refund: (amount: number) =>
							imageCredits.refund(amount)
					}
			);

		}

		const imagePromptJobMatch =
			url.pathname.match(
				/^\/api\/image-prompts\/([A-Za-z0-9-]+)$/
			);

		if (
			imagePromptJobMatch &&
			(request.method === "GET" ||
				request.method === "DELETE")
		) {

			return handleRemovedImagePromptJobRoute(
				imagePromptJobMatch[1]
			);

		}

		/* =====================================================
		 * RAW INSTRUCT-MODEL API (bug fix #271)
		 *
		 * POST /api/llm/generate  {prompt, maxTokens?, temperature?,
		 *                          systemPrompt?, provider?}
		 *   -> {success, text, provider, model, ms}
		 *
		 * This is the second version of the AI API the studio's own text
		 * routes use: the SAME single model + prompt contract, answered by
		 * whichever provider the rotation picked (Cloudflare Workers AI or
		 * OpenRouter). `provider` may force one of them; without it the
		 * rotation decides, so an external caller gets the same spreading
		 * the studio does.
		 *
		 * Auth follows the studio: a signed-in account, or the `yvs_free`
		 * guest cookie when KV is bound (401 otherwise). Scripts are
		 * unlimited on every plan, so the call does not consume an image
		 * credit - it only records the same `scripts` usage counter.
		 * ===================================================== */
		if (
			request.method === "POST" &&
			url.pathname === "/api/llm/generate"
		) {

			const llmUser =
				env && env.KV_BINDING
					? await creditSessionUser(request, baseEnv)
					: null;
			const llmGuest =
				!llmUser && hasFreemiumCookie(request);

			if (
				env &&
				env.KV_BINDING &&
				!llmUser &&
				!llmGuest
			) {

				return json(
					{
						success: false,
						error:
							"Sign in or open /free to use the LLM API"
					},
					401
				);

			}

			const llmBody: any =
				await request.json().catch(() => null);

			if (!llmBody || typeof llmBody !== "object" || Array.isArray(llmBody)) {
				return json({ success: false, error: "Expected a JSON object" }, 400);
			}

			const llmSettings = await readLlmConfig(baseEnv);
			const llmPrompt = promptFromAiInput(llmBody).trim();

			if (!llmPrompt) {
				return json({ success: false, error: "Missing prompt" }, 400);
			}

			if (llmPrompt.length > llmSettings.maxPromptChars) {
				return json(
					{
						success: false,
						error:
							"Prompt too long (max " +
							llmSettings.maxPromptChars +
							" chars)"
					},
					413
				);
			}

			const forced = String(llmBody.provider || "").trim().toLowerCase();
			if (forced && forced !== "cloudflare" && forced !== "openrouter") {
				return json(
					{ success: false, error: "Provider must be cloudflare or openrouter" },
					400
				);
			}

			const startedAt = Date.now();

			try {

				if (forced === "openrouter") {
					/* One provider, explicitly. */
					const result = await runOpenRouterCompletion({
						env: baseEnv,
						config: llmSettings,
						prompt: llmPrompt,
						maxTokens: Number(llmBody.maxTokens ?? llmBody.max_tokens) || undefined,
						temperature: Number(llmBody.temperature) || undefined,
						systemPrompt:
							typeof llmBody.systemPrompt === "string"
								? llmBody.systemPrompt
								: undefined,
						signal: request.signal
					});
					return json({
						success: true,
						text: result.text,
						provider: "openrouter",
						model: result.model,
						ms: result.ms
					});
				}

				if (forced === "cloudflare") {
					/* Bypass the provider rotation but stay in the Worker pool. */
					const result: any = await env.AI.run(
						SCRIPT_MODEL,
						{
							prompt: llmPrompt,
							max_tokens:
								Math.min(
									Number(llmBody.maxTokens ?? llmBody.max_tokens) || 1024,
									8192
								),
							temperature:
								Number.isFinite(Number(llmBody.temperature))
									? Number(llmBody.temperature)
									: 0.7
						}
					);
					const text =
						result && typeof result.response === "string"
							? result.response
							: typeof result === "string"
								? result
								: "";
					return json({
						success: true,
						text,
						provider: "cloudflare",
						model: SCRIPT_MODEL,
						ms: Date.now() - startedAt
					});
				}

				/* No explicit provider: the same rotation the studio uses. */
				const result: any = await env.AI.run(
					SCRIPT_MODEL,
					{
						prompt: llmPrompt,
						max_tokens:
							Math.min(
								Number(llmBody.maxTokens ?? llmBody.max_tokens) || 1024,
								8192
							),
						temperature:
							Number.isFinite(Number(llmBody.temperature))
								? Number(llmBody.temperature)
								: 0.7
					}
				);
				const text =
					result && typeof result.response === "string"
						? result.response
						: typeof result === "string"
							? result
							: "";
				const runtime = relayRuntimeOf(env);
				return json({
					success: true,
					text,
					provider:
						result && result.provider
							? String(result.provider)
							: "cloudflare",
					model:
						result && result.model
							? String(result.model)
							: SCRIPT_MODEL,
					ms: Date.now() - startedAt,
					rotation: runtime ? runtime.stats() : undefined
				});

			}
			catch (error) {

				return json(
					{
						success: false,
						error:
							error instanceof Error
								? error.message
								: String(error)
					},
					502
				);

			}
			finally {

				/* Usage is informational and never blocks the call. */
				try {

					if (env && env.KV_BINDING) {

						if (llmUser) {
							await creditConsume(
								env,
								llmUser.username,
								llmUser.usertype,
								"scripts"
							);
						}
						else if (llmGuest) {
							await guestCreditConsume(
								env,
								await guestCreditIdentity(request),
								"scripts"
							);
						}

					}

				}
				catch (usageError) {
					/* best effort */
				}

			}

		}

		if (
			request.method === "POST" &&
			url.pathname === "/api/script"
		) {

			return handleSeoScriptGeneration(
				request,
				url,
				env,
				SCRIPT_MODEL,
				async () => {
					/*
					 * AI scripts are unlimited on both plans (free and
					 * paid_user). Record usage only after request inputs
					 * validate so 400/503 rejections do not inflate counters.
					 */
					if (env && env.KV_BINDING) {
						const scriptCreditUser = await creditSessionUser(
							request,
							env
						);
						if (scriptCreditUser) {
							await creditConsume(
								env,
								scriptCreditUser.username,
								scriptCreditUser.usertype,
								"scripts"
							);
						} else if (hasFreemiumCookie(request)) {
							await guestCreditConsume(
								env,
								await guestCreditIdentity(request),
								"scripts"
							);
						}
					}
				}
			);

		}		/*
			* Voiceover (MeloTTS):
			* speak the script text and
			* return the audio. Long
			* scripts are split into
			* sentence chunks (TTS
			* models reject overly long
			* text - that was the
			* "internal server error")
			* and the pieces are
			* concatenated. One fixed
			* voice per language
			* (MeloTTS has no
			* male/female parameter).
			*
			* MeloTTS has been failing
			* intermittently upstream
			* with "AiError 3043:
			* Internal server error"
			* (~70% of calls, reported
			* on the Cloudflare forum
			* since July 2026), so
			* each chunk gets up to 3
			* attempts with a short
			* backoff. It also
			* sometimes returns WAV
			* instead of the
			* documented MP3, so the
			* container is detected
			* from the bytes.
		*/
		if (
			request.method === "POST" &&
			url.pathname === "/api/voiceover"
		) {
		/*
		 * Voiceovers are unlimited on both plans; the counter
		 * is informational and never blocks generation.
		 */
		if (
			env &&
			env.KV_BINDING
		) {

			try {

				const voiceCreditUser =
					await creditSessionUser(
						request,
						env
					);

				if (voiceCreditUser) {

					await creditConsume(
						env,
						voiceCreditUser.username,
						voiceCreditUser.usertype,
						"voiceovers"
					);

				}
				else if (
					hasFreemiumCookie(
						request
					)
				) {

					/* Unlimited for guests; usage only. */
					await guestCreditConsume(
						env,
						await guestCreditIdentity(
							request
						),
						"voiceovers"
					);

				}

			}
			catch (creditError) {

				/* usage tracking is best-effort */

			}

		}

		return handleVoiceover(request, env, {
			voiceoverModel: VOICEOVER_MODEL,
			fallbackTtsUrl: FALLBACK_TTS_URL
		});

		}

		/*
			* Free TTS proxy: a
			* second TTS engine
			* (the fallback for the
			* flaky Workers AI
			* melotts). Proxied
			* server-side so the
			* browser never deals
			* with CORS.
			*
			* GET /tts?text=...&lang=en
			* -> audio/mpeg
		*/
		if (
			request.method === "GET" &&
			url.pathname === "/tts"
		) {
			
			const text =
				url.searchParams.get(
					"text"
				);
			
			const lang =
				url.searchParams.get(
					"lang"
				) ||
				"en";
			
			if (
				!text
			) {
				
				return json(
					{
						success: false,
						error:
							"Missing text"
					},
					400
				);
				
			}
			
			if (
				text.length >
					2000
			) {
				
				return json(
					{
						success: false,
						error:
							"Text too long (max 2000 chars)"
					},
					400
				);
				
			}
			
			try {
				
				const ttsUrl =
					FALLBACK_TTS_URL +
					"?text=" +
					encodeURIComponent(
						text
					) +
					"&lang=" +
					encodeURIComponent(
						lang
					);
				
				const response =
					await fetch(
						ttsUrl
					);
				
				if (
					!response.ok
				) {
					
					return json(
						{
							success: false,
							error:
								"TTS service error (" +
								response.status +
								")"
						},
						502
					);
					
				}
				
				const bytes =
					new Uint8Array(
						await response.arrayBuffer()
					);
				
				return new Response(
					bytes,
					{
						headers: {
							"Content-Type":
								"audio/mpeg",
							"Cache-Control":
								"no-cache"
						}
					}
				);
				
			} catch (proxyError) {
				
				return json(
					{
						success: false,
						error:
							"TTS proxy failed: " +
							String(proxyError)
					},
					502
				);
				
			}
			
		}

		/*
			* Submit a render job: ALL of
			* the video's elements.
		*/
		if (
			request.method === "POST" &&
			url.pathname === "/api/render"
		) {

			const body =
				await request.json().catch(
					() => ({})
				);

			const name =
				String(
					body.name ||
					"Video"
				).slice(0, 60);

			const assets =
				Array.isArray(
					body.assets
				)
					? body.assets
					: [];

			const payload =
				JSON.stringify(
					{
						name:
						name,
						project:
							body.project ||
							{},
						assets:
						assets,
						audio:
							body.audio ||
							null
					}
				);

			if (
				payload.length >
					60 * 1024 * 1024
			) {

				return json(
					{
						success: false,
						error:
							"Payload too large (max 60MB)"
					},
					413
				);

			}

			/*
				* Max 10 in-progress jobs.
				* When the cap is reached the
				* POST is rejected with a busy
				* status (not an error); the
				* web app then renders the
				* video itself in-browser.
			*/
			const jobsNow =
				await listRenderJobs(env);

			let inProgress =
				0;

			for (
				const j of jobsNow
			) {

				if (
					j.status === "queued" ||
					j.status === "running"
				) {

					inProgress++;

				}

			}

			if (
				inProgress >=
					MAX_RENDER_JOBS
			) {

				return json(
					{
						success: true,
						status:
							"busy",
						inProgress:
							inProgress,
						max:
							MAX_RENDER_JOBS
					}
				);

			}

			const jobId =
				"job-" +
				Date.now().toString(36) +
				"-" +
				Math.random().toString(36).slice(
					2,
					8
				);

			await putBlobStore(
				env,
				"payload-" +
				jobId,
				new TextEncoder().encode(
					payload
				),
				"application/json"
			);

			const job = {
				id:
				jobId,
				name:
				name,
				status:
				"queued",
				createdAt:
					Date.now(),
				payloadId:
					"payload-" +
					jobId
			};

			await env.KV_BINDING.put(
				"job:" + jobId,
				JSON.stringify(job),
				{ expirationTtl: 3600 }
			);

			return json(
				{
					success: true,
					jobId:
					jobId
				}
			);

		}

		/*
			* Job status, or the finished
			* MP4 once a worker delivered
			* it.
		*/
		const renderJobMatch =
			url.pathname.match(
				new RegExp("^/api/render/([A-Za-z0-9_-]+)$")
			);

		if (
			request.method === "GET" &&
			renderJobMatch
		) {

			const raw =
				await env.KV_BINDING.get(
					"job:" + renderJobMatch[1]
				);

			if (!raw) {

				return json(
					{
						success: false,
						error:
							"Job not found (expired?)"
					},
					404
				);

			}

			const job =
				JSON.parse(raw);

			if (
				job.status === "done" &&
				job.fileId
			) {

				const data =
					await getBlobStore(
						env,
						job.fileId
					);

				if (!data) {

					return json(
						{
							success: false,
							error:
								"Output file missing"
						},
						500
					);

				}

				const safeName =
					String(
						job.name ||
						"video"
					).replace(
						/[^A-Za-z0-9_-]/g,
						""
					);

				return new Response(
					data.bytes,
					{
						status: 200,
						headers: {
							"Content-Type":
								data.contentType ||
								"video/mp4",
							"Content-Length":
								String(
									data.total
								),
							"Content-Disposition":
								"attachment; filename=" + safeName + ".mp4"
						}
					}
				);

			}

			if (
				job.status ===
					"failed"
			) {

				return json(
					{
						success: false,
						status:
							"failed",
						error:
							job.error ||
							"render failed"
					},
					500
				);

			}

			return json(
				{
					success: true,
					status:
						job.status,
					name:
						job.name
				}
			);

		}

		/*
			* Background worker: claim the
			* next queued job.
		*/
		if (
			request.method === "GET" &&
			url.pathname === "/api/worker/poll"
		) {

			const jobs =
				await listRenderJobs(
					env
				);

			const now =
				Date.now();

			for (
				const job of jobs
			) {

				if (
					job.status ===
						"running" &&
					now -
						(job.claimedAt || 0) >
						10 * 60 * 1000
				) {

					job.status =
						"failed";

					job.error =
						"worker timed out";

					await env.KV_BINDING.put(
						"job:" + job.id,
						JSON.stringify(job),
						{
							expirationTtl:
								3600
						}
					);

				}

			}

			const queued =
				jobs.find(
					(j) =>
						j.status ===
						"queued"
				);

			if (!queued) {
				return json(
					{ job: null }
				);
			}

			queued.status =
				"running";

			queued.claimedAt =
				now;

			await env.KV_BINDING.put(
				"job:" + queued.id,
				JSON.stringify(queued),
				{ expirationTtl: 3600 }
			);

			const data =
				await getBlobStore(
					env,
					queued.payloadId
				);

			let payload =
				{};

			if (data) {

				try {

					payload =
						JSON.parse(
							new TextDecoder().decode(
								data.bytes
							)
						);

				}
				catch (parseError) {
					payload =
						{};
				}

			}

			return json(
				{
					job: {
						id:
							queued.id,
						name:
							payload.name ||
							queued.name,
						project:
							payload.project ||
							{},
						assets:
							payload.assets ||
							[],
						audio:
							payload.audio ||
							null
					}
				}
			);

		}

		/*
			* Worker uploads the finished
			* MP4 (raw body).
		*/
		if (
			request.method === "POST" &&
			url.pathname ===
				"/api/worker/deliver"
		) {

			const jobId =
				url.searchParams.get(
					"job"
				) ||
				"";

			const raw =
				await env.KV_BINDING.get(
					"job:" + jobId
				);

			if (!raw) {

				return json(
					{
						success: false,
						error:
							"Job not found"
					},
					404
				);

			}

			const bytes =
				new Uint8Array(
					await request.arrayBuffer()
				);

			if (!bytes.length) {

				return json(
					{
						success: false,
						error:
							"Empty file"
					},
					400
				);

			}

			const fileId =
				"file-" + jobId;

			await putBlobStore(
				env,
				fileId,
				bytes,
				"video/mp4"
			);

			const job =
				JSON.parse(raw);

			job.status =
				"done";

			job.fileId =
				fileId;

			job.size =
				bytes.length;

			job.finishedAt =
				Date.now();

			await env.KV_BINDING.put(
				"job:" + jobId,
				JSON.stringify(job),
				{ expirationTtl: 3600 }
			);

			return json(
				{
					success: true,
					size:
						bytes.length
				}
			);

		}

		/*
			* Worker reports a failed job.
		*/
		if (
			request.method === "POST" &&
			url.pathname ===
				"/api/worker/failed"
		) {

			const jobId =
				url.searchParams.get(
					"job"
				) ||
				"";

			const raw =
				await env.KV_BINDING.get(
					"job:" + jobId
				);

			if (!raw) {
				return json(
					{
						success: false,
						error:
							"Job not found"
					},
					404
				);
			}

			const body =
				await request.json().catch(
					() => ({})
				);

			const job =
				JSON.parse(raw);

			job.status =
				"failed";

			job.error =
				String(
					body.error ||
					"render failed"
				).slice(0, 300);

			await env.KV_BINDING.put(
				"job:" + jobId,
				JSON.stringify(job),
				{ expirationTtl: 3600 }
			);

			return json(
				{ success: true }
			);

		}

		/*
			* Studio theme: "default", "strata"
			* or "stellar". The GET is open
			* (the page itself already carries
			* the theme), the POST needs the
			* settings password.
		*/
		if (
			url.pathname ===
				"/api/config/theme"
		) {

			if (
				request.method ===
					"GET"
			) {

				return json(
					{
						success: true,
						theme:
							await readTheme(env),
						themes:
							CONFIG_THEMES
					}
				);

			}

			if (
				request.method ===
					"POST"
			) {

				const body =
					await request.json().catch(
						() => ({})
					);

				if (
					body.pw !==
						CONFIG_PASSWORD
				) {

					return json(
						{
							success: false,
							error:
								"Wrong password"
						},
						403
					);

				}

				const raw =
					String(
						body.theme || ""
					)
						.trim()
						.toLowerCase();

				if (
					CONFIG_THEMES.indexOf(
						raw
					) === -1
				) {

					return json(
						{
							success: false,
							error:
								"Unknown theme"
						},
						400
					);

				}

				if (!env.KV_BINDING) {

					return json(
						{
							success: false,
							error:
								"Theme storage not configured (bind the KV namespace)"
						},
						503
					);

				}

				/*
				 * A KV failure is reported as JSON so the
				 * settings page can show the real reason
				 * instead of a bare 500.
				 */
				try {

					await env.KV_BINDING.put(
						CONFIG_THEME_KEY,
						raw
					);

				}
				catch (themeSaveError) {

					return json(
						{
							success: false,
							error:
								"Theme storage unavailable"
						},
						503
					);

				}

				return json(
					{
						success: true,
						theme:
							raw
					}
				);

			}

		}


		/*
			* Registered background workers
			* (up to 3 URLs, optional).
		*/
		if (
			url.pathname ===
				"/api/config/workers"
		) {

			if (
				request.method ===
					"GET"
			) {

				/*
				 * Without KV there are no stored
				 * URLs. Returning an empty list
				 * keeps the settings page usable
				 * in the KV-less (e2e) mode instead
				 * of throwing on the missing binding.
				 */
				if (!env.KV_BINDING) {

					return json(
						{
							success: true,
							urls: []
						}
					);
				}

				const raw =
					await env.KV_BINDING.get(
						CONFIG_WORKERS_KEY
					);

				let urls =
					[];

				try {
					urls = raw
						? JSON.parse(raw)
						: [];
				}
				catch (parseError) {
					urls =
						[];
				}

				if (!Array.isArray(urls)) {
					urls =
						[];
				}

				return json(
					{
						success: true,
						urls:
							urls
					}
				);

			}

			if (
				request.method ===
					"POST"
			) {

				const body =
					await request.json().catch(
						() => ({})
					);

				if (
					body.pw !==
						CONFIG_PASSWORD
				) {

					return json(
						{
							success: false,
							error:
								"Wrong password"
						},
						403
					);

				}

				if (!env.KV_BINDING) {

					return json(
						{
							success: false,
							error:
								"User storage not configured (bind the KV namespace)"
						},
						503
					);

				}

				const urls =
					(
						Array.isArray(
							body.urls
						)
							? body.urls
							: []
					)
					.map(
						(u) =>
							String(u || "").trim()
					)
					.filter(
						(u) =>
							u.length > 0
					)
					.slice(0, 3);

				for (
					const u of urls
				) {

					if (
						u.length > 500 ||
						!new RegExp("^https?://").test(
							u
						)
					) {

						return json(
							{
								success: false,
								error:
									"Worker URLs must be http(s) links (max 500 chars)"
							},
							400
						);

					}

				}

				await env.KV_BINDING.put(
					CONFIG_WORKERS_KEY,
					JSON.stringify(
						urls
					)
				);

				/*
				 * The rotation pool is cached for ~20 s inside every isolate;
				 * drop it here so a newly registered backup starts receiving
				 * model calls on the next request instead of the next cache
				 * expiry.
				 */
				invalidateRelayCache();

				return json(
					{
						success: true,
						urls:
							urls
					}
				);

			}

		}


		/*
		 * Plans & credits (settings page).
		 *
		 * GET  /api/config/users?pw=...  list the newest accounts with
		 *                                their plan and today's usage
		 * POST /api/config/users         set a user's usertype and
		 *                                optionally reset today's counts
		 *
		 * This is the DB operation behind the paid plan: writing
		 * user:<name>.usertype = "paid_user" applies the paid
		 * (10,000 AI images/day) plan on its next request; "free"
		 * applies the same daily ceiling. Both values share the same
		 * daily reset record, so a plan change never loses today's
		 * usage.
		 */
		if (
			url.pathname ===
				"/api/config/users"
		) {

			const body =
				request.method === "POST"
					? await request.json().catch(
							() => ({})
						)
					: {};

			const suppliedPassword =
				request.method === "POST"
					? body.pw
					: url.searchParams.get("pw");

			if (
				suppliedPassword !==
					CONFIG_PASSWORD
			) {

				return json(
					{
						success: false,
						error:
							"Wrong password"
					},
					403
				);

			}

			if (!env.KV_BINDING) {

				return json(
					{
						success: false,
						error:
							"User storage not configured (bind the KV namespace)"
					},
					503
				);

			}

			if (
				request.method ===
					"GET"
			) {

				/*
				 * Limit 50 rows: each account costs one record
				 * read plus one credits read, so the whole
				 * listing stays well inside the per-invocation
				 * budget. The full key count (up to KV's
				 * 1,000-key page) rides along so the page can
				 * say when only part of the table is shown.
				 */
				const listed =
					await env.KV_BINDING.list(
						{
							prefix: AUTH_USER_PREFIX,
							limit: 1000
						}
					);

				const accountKeys =
					listed.keys.slice(
						0,
						50
					);

				/*
				 * Bounded repair pass (see authEmailIndexMap):
				 * one extra list plus at most
				 * AUTH_EMAIL_SCAN_MAX index reads heals legacy
				 * rows - a user record written before the
				 * credits system or the email index gets its
				 * email and plan filled in from the unique
				 * username, and a missing email:<address>
				 * pointer is recreated from the record.
				 */
				const indexMap =
					await authEmailIndexMap(
						env,
						true
					);

				const users =
					(
						await Promise.all(
							accountKeys.map(
								async (key: any) => {

									const raw =
										await env.KV_BINDING.get(
											key.name
										);

									if (!raw) {
										return null;
									}

									let record: any;

									try {

										record =
											JSON.parse(
												raw
											);

									}
									catch (parseError) {

										return null;

									}

									const keyUsername =
										key.name.substring(
											AUTH_USER_PREFIX.length
										);

									try {

										record =
											await authRepairUserRecord(
												env,
												keyUsername,
												record,
												indexMap
											);

									}
									catch (repairError) {
										/* display only; never fail the list */
									}

									const username =
										record.username ||
										keyUsername;

									const usertype =
										creditNormalizeUsertype(
											record.usertype
										);

									let state: any;

									try {

										state =
											await creditReadState(
												env,
												username
											);

									}
									catch (creditReadError) {

										state =
											creditFreshState(
												creditDay()
											);

									}

									const summary =
										creditSummary(
											usertype,
											state
										);

									return {
										username:
											username,
										email:
											record.email ||
											"",
										usertype:
											usertype,
										plan:
											summary.plan,
										/*
										 * Flattened for the table: the
										 * plan label and its daily
										 * image allowance, so a row
										 * reads "Free plan - 10,000 AI
										 * images / day" without the
										 * client re-deriving it.
										 */
										planLabel:
											summary.plan.label,
										planImages:
											summary.plan.limits
												.images,
										day:
											summary.day,
										used:
											summary.used,
										remaining:
											summary.remaining,
										createdAt:
											record.createdAt ||
											""
									};

								}
							)
						)
					)
						.filter(
							(user) =>
								user !== null
						)
						/*
						 * Newest accounts first: KV lists keys
						 * alphabetically, which is not the order
						 * the settings page wants to show.
						 */
						.sort(
							(a: any, b: any) =>
								String(b.createdAt)
									.localeCompare(
										String(a.createdAt)
									)
						);

				return json(
					{
						success: true,
						day:
							creditDay(),
						resetsAt:
							creditResetsAt(),
						users:
							users,
						shown:
							users.length,
						total:
							listed.keys.length,
						hasMore:
							listed.list_complete ===
							false,
						plans: [
							CREDIT_PLANS.free,
							CREDIT_PLANS.paid_user
						]
					}
				);

			}

			if (
				request.method ===
					"POST"
			) {

				const username =
					String(
						body.username ||
						""
					)
						.trim()
						.toLowerCase();

				const usertype =
					String(
						body.usertype ||
						""
					)
						.trim()
						.toLowerCase();

				if (
					!/^[a-zA-Z0-9_]{3,20}$/.test(
						username
					)
				) {

					return json(
						{
							success: false,
							error:
								"Enter a valid username"
						},
						400
					);

				}

				if (
					CREDIT_USERTYPES.indexOf(
						usertype
					) === -1
				) {

					return json(
						{
							success: false,
							error:
								"Unknown plan (use free or paid_user)"
						},
						400
					);

				}

				const key =
					authUserKey(username);

				const raw =
					await env.KV_BINDING.get(
						key
					);

				if (!raw) {

					return json(
						{
							success: false,
							error:
								"User not found"
						},
						404
					);

				}

				let record: any;

				try {

					record =
						JSON.parse(
							raw
						);

				}
				catch (parseError) {

					return json(
						{
							success: false,
							error:
								"User record is unreadable"
						},
						500
					);

				}

				/*
				 * The plan lives on the account row. It is
				 * written together with the email (a legacy
				 * row may not have one yet) so the row always
				 * describes the whole account.
				 */
				record.username =
					record.username ||
					username;

				record.usertype =
					usertype;

				record.updatedAt =
					new Date().toISOString();

				if (!record.email) {
					try {
						const indexMap =
							await authEmailIndexMap(
								env,
								true
							);

						record.email =
							indexMap.byUsername[
								username
							] ||
							"";
					}
					catch (indexError) {
						record.email =
							record.email || "";
					}
				}

				await env.KV_BINDING.put(
					key,
					JSON.stringify(
						record
					)
				);

				/*
				 * Keep the email pointer's value in step:
				 * email:<address> shows the same email and
				 * plan as user:<username>.
				 */
				if (record.email) {
					await authWriteEmailIndex(
						env,
						record.email,
						record
					);
				}

				/*
				 * Optional reset: a fresh account should not
				 * inherit yesterday's counters after a plan
				 * change.
				 */
				if (body.resetCredits) {

					await env.KV_BINDING.delete(
						CREDIT_KEY_PREFIX +
						username
					);

				}

				let state: any;

				try {

					state =
						await creditReadState(
							env,
							username
						);

				}
				catch (creditReadError) {

					state =
						creditFreshState(
							creditDay()
						);

				}

				const summary =
					creditSummary(
						usertype,
						state
					);

				return json(
					{
						success: true,
						username:
							record.username ||
							username,
						email:
							record.email ||
							"",
						usertype:
							usertype,
						plan:
							summary.plan,
						credits:
							summary
					}
				);

			}

		}


		/*
		 * Guest credits by IP address — the freemium table.
		 *
		 * GET  /api/config/ipcredits?pw=...  today's rows
		 *                                    (masked IP, usage,
		 *                                     remaining, last seen)
		 * POST /api/config/ipcredits         {pw, key} resets one
		 *                                    row (deletes the record)
		 *
		 * Rows live under ipcredits:<sha256(ip)> and share the
		 * account credit record shape and lazy daily reset, so a
		 * row from a previous day reads back as zeros.
		 */
		if (
			url.pathname ===
				"/api/config/ipcredits"
		) {

			const guestBody =
				request.method === "POST"
					? await request.json().catch(
							() => ({})
						)
					: {};

			const guestPassword =
				request.method === "POST"
					? guestBody.pw
					: url.searchParams.get("pw");

			if (
				guestPassword !==
				CONFIG_PASSWORD
			) {

				return json(
					{
						success: false,
						error:
							"Wrong password"
					},
					403
				);

			}

			if (!env.KV_BINDING) {

				return json(
					{
						success: false,
						error:
							"User storage not configured (bind the KV namespace)"
					},
					503
				);

			}

			if (
				request.method ===
					"GET"
			) {

				const guestRows =
					await env.KV_BINDING.list(
						{
							prefix:
								IPCREDIT_KEY_PREFIX,
							limit:
								IPCREDIT_MAX_ROWS
						}
					);

				const rows =
					(
						await Promise.all(
							guestRows.keys.map(
								async (key: any) => {

									let record: any =
										null;

									try {

										const raw =
											await env.KV_BINDING.get(
												key.name
											);

										record = raw
											? JSON.parse(
													raw
												)
											: null;

									}
									catch (rowError) {

										record = null;

									}

									if (!record) {
										return null;
									}

									const summary =
										creditSummaryFor(
											GUEST_PLAN,
											creditParseState(
												JSON.stringify(
													record
												),
												creditDay()
											)
										);

									return {
										key:
											key.name,
										ip:
											record.ip ||
											"unknown",
										hash:
											String(
												key.name
											).substring(
												IPCREDIT_KEY_PREFIX.length
											),
										day:
											summary.day,
										used:
											summary.used,
										remaining:
											summary.remaining,
										updatedAt:
											record.updatedAt ||
											""
									};

								}
							)
						)
					).filter(
						(row: any) =>
							row !== null
					);

				return json(
					{
						success: true,
						day:
							creditDay(),
						resetsAt:
							creditResetsAt(),
						plan:
							GUEST_PLAN,
						rows:
							rows
					}
				);

			}

			if (
				request.method ===
					"POST"
			) {

				const guestKey =
					String(
						guestBody.key ||
						""
					).trim();

				if (
					!/^ipcredits:[a-f0-9]{8,64}$/.test(
						guestKey
					)
				) {

					return json(
						{
							success: false,
							error:
								"Unknown guest row"
						},
						400
					);

				}

				await env.KV_BINDING.delete(
					guestKey
				);

				return json(
					{
						success: true,
						key:
							guestKey
					}
				);

			}

		}


		// =====================================================
		// MODULAR CONFIG VERIFY, PAYMENTS & BASIC CMS ROUTES
		// =====================================================

		if (
			url.pathname === "/api/config/verify" &&
			request.method === "POST"
		) {
			const verifyBody: any =
				await request.json().catch(() => ({}));
			if (verifyBody.pw !== CONFIG_PASSWORD) {
				return json(
					{
						success: false,
						valid: false,
						error: "Wrong password"
					},
					403
				);
			}
			return json({
				success: true,
				valid: true,
				theme: await readTheme(env)
			});
		}

		const paymentRouteResponse =
			await handlePaymentRoutes(
				request,
				url,
				env,
				CONFIG_PASSWORD,
				creditSessionUser
			);
		if (paymentRouteResponse) {
			return paymentRouteResponse;
		}

		const cmsApiResponse =
			await handleCmsApiRoutes(
				request,
				url,
				env,
				CONFIG_PASSWORD
			);
		if (cmsApiResponse) {
			return cmsApiResponse;
		}

		const cmsPublicResponse =
			await handleCmsPublicPageRoute(
				request,
				url,
				env,
				await readTheme(env)
			);
		if (cmsPublicResponse) {
			return cmsPublicResponse;
		}

		return new Response(
			"Not Found",
			{
				status: 404
			}
		);
}


// =============================================================
// JSON HELPER
// =============================================================

function json(data, status = 200, setCookie = null) {

	const headers = {
		"Content-Type":
			"application/json"
	};

	if (setCookie) {
		headers["Set-Cookie"] =
			setCookie;
	}

	return new Response(
		JSON.stringify(data),
		{
			status,

			headers:
				headers
		}
	);
}


// =============================================================
// USER AUTH HELPERS (KV-backed, unlimited users)
// =============================================================

/*
 * Email uniqueness used to be checked by
 * listing every user: record and reading
 * each one. That breaks down twice as the
 * namespace grows - KV list() only returns
 * 1000 keys per page (1000 is the default
 * AND the maximum), and one get per user
 * trips the 1000-operations-per-invocation
 * limit at ~1000 accounts. So the check is
 * now a single keyed read of
 * email:<address>; accounts created before
 * this index existed are still covered by
 * a bounded scan that only runs while the
 * namespace is small.
 */
const AUTH_EMAIL_PREFIX =
	"email:";

const AUTH_USER_PREFIX =
	"user:";

const AUTH_LEGACY_SCAN_MAX =
	200;


/*
 * ---- The user row is the single source of truth ----------------
 *
 * KV layout (one row per account, keyed by the UNIQUE username):
 *
 *   user:<username>   { username, email, usertype, createdAt, ... }
 *                     ^ the account row: credentials, email and
 *                       the plan ("free" / "paid_user") all live
 *                       in this one value.
 *   email:<address>   { username, email, usertype }
 *                     ^ a pointer index for the O(1) uniqueness
 *                       check. Its value mirrors the user row, so
 *                       either key shows the same email + plan.
 *
 * Accounts written by older builds can be missing `email` or
 * `usertype` (and accounts created before the index have no
 * email:<address> row at all). authRepairUserRecord() heals both
 * directions using only the username, which is unique: the email
 * index fills in a missing email on the user row, and the user
 * row recreates a missing index row. Nothing is ever overwritten
 * with a different username, so a stale pointer cannot reassign
 * an account.
 */

function authUserKey(
	username: any
): string {

	return (
		AUTH_USER_PREFIX +
		String(username || "")
			.trim()
			.toLowerCase()
	);

}


function authEmailAddress(
	value: any
): string {

	return String(value || "")
		.trim()
		.toLowerCase();

}


/* The value written at email:<address> — mirrors the user row. */
function authEmailIndexValue(
	record: any,
	email: any
): any {

	return {
		username:
			record &&
			record.username
				? record.username
				: "",
		email:
			authEmailAddress(email),
		usertype:
			creditNormalizeUsertype(
				record &&
				record.usertype
			)
	};

}


async function authWriteEmailIndex(
	env: any,
	email: any,
	record: any
): Promise<void> {

	const address =
		authEmailAddress(email);

	if (!address || !env.KV_BINDING) {
		return;
	}

	await env.KV_BINDING.put(
		AUTH_EMAIL_PREFIX + address,
		JSON.stringify(
			authEmailIndexValue(
				record,
				address
			)
		)
	);

}


/*
 * Read the email index, bounded.
 *
 * The list() itself is one operation and tells us which addresses
 * exist (that is all the uniqueness check and the "is the pointer
 * missing?" test need). The reverse map — address -> username — is
 * only needed to fill in the email of an account row written before
 * the index existed, so it reads at most AUTH_EMAIL_SCAN_MAX values,
 * and only when reverseScan is requested.
 *
 * Worst case for one settings-page load: 1 list (users) + 1 list
 * (emails) + 50 user reads + 50 email reads + 50 credits reads,
 * i.e. ~152 operations — comfortably inside the 1,000-operation
 * per-invocation limit, and the same shape as before this change.
 */
const AUTH_EMAIL_SCAN_MAX =
	50;

async function authEmailIndexMap(
	env: any,
	reverseScan: boolean = false
): Promise<any> {

	const byUsername: any =
		{};

	const emails: any =
		{};

	const known: any =
		{};

	if (!env.KV_BINDING) {
		return { byUsername, emails, known };
	}

	let listed: any;

	try {
		listed =
			await env.KV_BINDING.list(
				{
					prefix: AUTH_EMAIL_PREFIX,
					limit: 1000
				}
			);
	}
	catch (listError) {
		return { byUsername, emails, known };
	}

	for (const key of listed.keys) {
		emails[
			authEmailAddress(
				String(key.name)
					.slice(
						AUTH_EMAIL_PREFIX.length
					)
			)
		] = true;
	}

	if (!reverseScan) {
		return { byUsername, emails, known };
	}

	const rows =
		await Promise.all(
			listed.keys
				.slice(
					0,
					AUTH_EMAIL_SCAN_MAX
				)
				.map(
					async (key: any) => {

						const address =
							authEmailAddress(
								String(key.name)
									.slice(
										AUTH_EMAIL_PREFIX.length
									)
							);

						try {
							const raw =
								await env.KV_BINDING.get(
									key.name
								);

							if (!raw) {
								return {
									address,
									username: "",
									complete: false
								};
							}

							const indexRecord =
								JSON.parse(raw);

							return {
								address,
								username:
									String(
										(indexRecord &&
											indexRecord.username) ||
										""
									)
										.trim()
										.toLowerCase(),
								/*
								 * Older pointers stored only
								 * { username }. Those are
								 * refreshed to the full
								 * { username, email, usertype }
								 * value on the next read.
								 */
								complete:
									Boolean(
										indexRecord &&
										indexRecord.email &&
										indexRecord.usertype
									)
							};
						}
						catch (parseError) {
							return {
								address,
								username: "",
								complete: false
							};
						}
					}
				)
		);

	for (const row of rows) {

		if (!row.address) {
			continue;
		}

		known[row.address] =
			row.complete === true;

		if (row.username) {
			byUsername[row.username] =
				row.address;
		}
	}

	return { byUsername, emails, known };

}


/*
 * Heal one account row in place.
 *
 * Guarantees after the call: the user row carries `username`,
 * `email` and `usertype`, and the email index row exists with the
 * same email + plan. Writes happen only when something was
 * actually missing, so the common case costs zero writes.
 */
async function authRepairUserRecord(
	env: any,
	username: any,
	record: any,
	indexMap: any = null
): Promise<any> {

	if (!record || typeof record !== "object") {
		return record;
	}

	const cleanUsername =
		String(
			record.username ||
			username ||
			""
		).trim();

	const emailFromIndex =
		indexMap &&
		indexMap.byUsername
			? indexMap.byUsername[
				cleanUsername.toLowerCase()
			]
			: "";

	let userDirty = false;

	if (!record.username && cleanUsername) {
		record.username = cleanUsername;
		userDirty = true;
	}

	let address =
		authEmailAddress(record.email);

	if (!address && emailFromIndex) {
		address = authEmailAddress(emailFromIndex);
		record.email = address;
		userDirty = true;
	}

	const usertype =
		creditNormalizeUsertype(
			record.usertype
		);

	if (record.usertype !== usertype) {
		record.usertype = usertype;
		userDirty = true;
	}

	if (
		userDirty &&
		env.KV_BINDING &&
		cleanUsername
	) {
		record.updatedAt =
			new Date().toISOString();

		await env.KV_BINDING.put(
			authUserKey(cleanUsername),
			JSON.stringify(record)
		);
	}

	/*
	 * Keep the pointer index in step with the row: it is written
	 * for legacy accounts (no email:<address> key yet) and for
	 * every plan change.
	 */
	const pointerKnown =
		Boolean(
			indexMap &&
			indexMap.known &&
			Object.prototype.hasOwnProperty.call(
				indexMap.known,
				address
			)
		);

	if (
		address &&
		(
			!indexMap ||
			!indexMap.emails ||
			!indexMap.emails[address] ||
			(pointerKnown &&
				indexMap.known[address] ===
					false)
		)
	) {
		await authWriteEmailIndex(
			env,
			address,
			record
		);
	}

	return record;

}


function authToHex(bytes) {

	return Array.from(
		bytes
	).map(
		(b) =>
			b.toString(16).padStart(2, "0")
	).join(
		""
	);

}


function authFromHex(hex) {

	const out = new Uint8Array(
		hex.length / 2
	);

	for (let i = 0; i < out.length; i++) {
		out[i] =
			parseInt(
				hex.substr(i * 2, 2),
				16
			);
	}

	return out;

}


async function authHashPassword(
	password,
	salt
) {

	const keyMaterial =
		await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(
				password
			),
			"PBKDF2",
			false,
			["deriveBits"]
		);

	const bits =
		await crypto.subtle.deriveBits(
			{
				name: "PBKDF2",

				salt:
					salt,

				iterations:
					100000, // Workers runtime caps PBKDF2 at 100,000

				hash: "SHA-256"
			},
			keyMaterial,
			256
		);

	return authToHex(
		new Uint8Array(
			bits
		)
	);

}


function authSessionCookie(
	token,
	maxAge
) {

	return (
		"yvs_session=" +
		token +
		"; HttpOnly; Path=/; SameSite=Strict; Max-Age=" +
		maxAge
	);

}


/* =============================================================
 * DAILY CREDITS (KV-backed)
 * -------------------------------------------------------------
 * Plans (every plan shares IMAGE_DAILY_LIMIT = 10,000 AI
 * images per day; the paid plan no longer has the *smaller*
 * allowance it used to have, which read like a downgrade):
 *   free       unlimited videos, AI scripts and voiceovers,
 *              10,000 AI images per day
 *   paid_user  unlimited videos, AI scripts and voiceovers,
 *              10,000 AI images per day
 *
 * Usage lives in credits:<username> and rolls over at midnight
 * Asia/Taipei (UTC+8, no DST, so a fixed offset is exact).
 * The day stamp inside the record is the source of truth: a
 * record from an earlier day reads back as zero usage and is
 * rewritten by the next consume. Records expire after two days
 * so dormant accounts do not accumulate keys forever.
 *
 * The plan itself is an attribute of the user record
 * (user:<username>.usertype). Accounts created before the
 * credits system, and any unknown value, read as "free".
 * ============================================================= */

const CREDIT_KEY_PREFIX =
	"credits:";

const CREDIT_DAY_OFFSET_MS =
	8 * 60 * 60 * 1000;

const CREDIT_RECORD_TTL =
	2 * 24 * 60 * 60;

const CREDIT_KINDS = [
	"videos",
	"images",
	"scripts",
	"voiceovers"
];

const CREDIT_USERTYPES = [
	"free",
	"paid_user"
];

/*
 * ONE daily AI-image allowance for every actor (free, paid_user,
 * guest). Server load is handled by concurrency + backoff in
 * `modules/image-load.ts`, not by a per-window or per-plan quota,
 * so the day limit is a fair-use ceiling and not a throttle:
 * 10,000 images/day is far more than a person can click, and it
 * stops a runaway loop from spending a whole month's budget.
 */
export const IMAGE_DAILY_LIMIT =
	10000;

const CREDIT_PLANS = {
	free: {
		id: "free",
		label: "Free",
		limits: {
			videos: null,
			images: IMAGE_DAILY_LIMIT,
			scripts: null,
			voiceovers: null
		}
	},
	paid_user: {
		id: "paid_user",
		label: "Paid",
		limits: {
			videos: null,
			images: IMAGE_DAILY_LIMIT,
			scripts: null,
			voiceovers: null
		}
	}
};


/*
 * The freemium (no-account) plan used by GET /free.
 *
 * A visitor who has not signed in gets the same daily ceiling as
 * an account (IMAGE_DAILY_LIMIT = 10,000 AI images per day) plus
 * unlimited video projects, AI scripts and voiceovers. Its
 * counters use the same daily state record as accounts, but are
 * keyed by a hash of the visitor's IP address
 * (ipcredits:<hash>) instead of a username, so the counter cannot
 * be reset by clearing cookies. (It used to be 10/day, which made
 * the freemium studio stop working after ten images.)
 *
 * GUEST_PLAN is deliberately NOT in CREDIT_USERTYPES: it is an
 * actor type, not something the settings page can assign to an
 * account.
 */
const GUEST_PLAN = {
	id: "guest",
	label: "Guest",
	limits: {
		videos: null,
		images: IMAGE_DAILY_LIMIT,
		scripts: null,
		voiceovers: null
	}
};

/*
 * User-type based URL restrictions (RULE 21). Each of these
 * routes serves the studio shell in a different plan mode:
 *
 *   /free    everyone (freemium, sets the yvs_free cookie)
 *   /studio  signed-in free_user / paid_user; guests -> /free
 *   /paid    paid_user only; guests -> /free, free -> /studio
 *
 * The shell is client-side, so these gates are navigation
 * boundaries. The data boundary is the credits gate on
 * /image/gen, which enforces the plan for the API itself.
 */
const PLAN_MODE_BY_ROUTE: any = {
	"/free": "freemium",
	"/studio": "studio",
	"/paid": "paid"
};

/* Marks a browser as a freemium visitor (set by GET /free). */
const FREEMIUM_COOKIE =
	"yvs_free=1; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400";

const IPCREDIT_KEY_PREFIX =
	"ipcredits:";

const IPCREDIT_MAX_ROWS =
	50;


function creditNormalizeUsertype(
	value: any
): any {

	return (
		String(value || "")
			.trim()
			.toLowerCase() ===
		"paid_user"
			? "paid_user"
			: "free"
	);

}


function creditPlanFor(
	usertype: any
): any {

	/*
	 * `guest` is an actor type, never a stored account plan, but
	 * resolving it here keeps every helper safe: a guest call site
	 * that forgets to pass GUEST_PLAN explicitly still gets the
	 * 10-image plan instead of silently inheriting free's allowance.
	 */
	if (
		String(usertype || "")
			.trim()
			.toLowerCase() ===
		"guest"
	) {

		return GUEST_PLAN;

	}

	return (CREDIT_PLANS as any)[
		creditNormalizeUsertype(usertype)
	];

}


/* YYYY-MM-DD in Asia/Taipei. */
function creditDay(
	now: any = Date.now()
): string {

	const shifted =
		new Date(
			Number(now) +
			CREDIT_DAY_OFFSET_MS
		);

	const month =
		shifted.getUTCMonth() + 1;

	const day =
		shifted.getUTCDate();

	return (
		shifted.getUTCFullYear() +
		"-" +
		(month < 10 ? "0" : "") +
		month +
		"-" +
		(day < 10 ? "0" : "") +
		day
	);

}


/* ISO timestamp of the next midnight Asia/Taipei. */
function creditResetsAt(
	now: any = Date.now()
): string {

	const shifted =
		new Date(
			Number(now) +
			CREDIT_DAY_OFFSET_MS
		);

	const nextMidnight =
		Date.UTC(
			shifted.getUTCFullYear(),
			shifted.getUTCMonth(),
			shifted.getUTCDate() + 1
		) -
		CREDIT_DAY_OFFSET_MS;

	return new Date(
		nextMidnight
	).toISOString();

}


function creditFreshState(
	day: any
): any {

	return {
		day: day,
		videos: 0,
		images: 0,
		scripts: 0,
		voiceovers: 0,
		updatedAt:
			new Date().toISOString()
	};

}


/*
 * A record is trusted only for the day it was written on.
 * Anything unreadable, partial or stale becomes a fresh
 * counter for today.
 */
function creditParseState(
	raw: any,
	day: any
): any {

	let parsed: any =
		null;

	try {

		parsed = raw
			? JSON.parse(raw)
			: null;

	}
	catch (parseError) {

		parsed = null;

	}

	const state =
		creditFreshState(day);

	if (
		!parsed ||
		typeof parsed !== "object" ||
		parsed.day !== day
	) {

		return state;

	}

	for (
		const kind of CREDIT_KINDS
	) {

		const value =
			Number(parsed[kind]);

		state[kind] =
			Number.isFinite(value) &&
			value > 0
				? Math.floor(value)
				: 0;

	}

	return state;

}


/*
 * Key-level primitives. Accounts are keyed credits:<username>;
 * freemium visitors are keyed ipcredits:<sha256(ip)>. Both
 * share the same record shape, TTL and lazy daily reset.
 */
async function creditReadKey(
	env: any,
	key: any
): Promise<any> {

	const raw =
		await env.KV_BINDING.get(
			key
		);

	return creditParseState(
		raw,
		creditDay()
	);

}


async function creditWriteKey(
	env: any,
	key: any,
	state: any
): Promise<void> {

	await env.KV_BINDING.put(
		key,
		JSON.stringify(state),
		{
			expirationTtl:
				CREDIT_RECORD_TTL
		}
	);

}


async function creditReadState(
	env: any,
	username: any
): Promise<any> {

	return creditReadKey(
		env,
		CREDIT_KEY_PREFIX +
			String(username || "")
				.toLowerCase()
	);

}


async function creditWriteState(
	env: any,
	username: any,
	state: any
): Promise<void> {

	await creditWriteKey(
		env,
		CREDIT_KEY_PREFIX +
			String(username || "")
				.toLowerCase(),
		state
	);

}


/*
 * The JSON shape every credits-aware route returns.
 * `null` inside limits/remaining means "unlimited".
 */
function creditSummary(
	usertype: any,
	state: any
): any {

	return creditSummaryFor(
		creditPlanFor(usertype),
		state
	);

}


/*
 * Plan-object variant used by the IP-keyed guest counters, which
 * have no usertype of their own.
 */
function creditSummaryFor(
	plan: any,
	state: any
): any {

	const used: any =
		{};

	const remaining: any =
		{};

	for (
		const kind of CREDIT_KINDS
	) {

		const limit =
			plan.limits[kind];

		used[kind] =
			Number(state[kind]) ||
			0;

		remaining[kind] =
			limit === null
				? null
				: Math.max(
						0,
						limit -
							used[kind]
					);

	}

	return {
		success: true,
		usertype: plan.id,
		plan: {
			id: plan.id,
			label: plan.label,
			limits: plan.limits
		},
		day: state.day,
		resetsAt: creditResetsAt(),
		used: used,
		remaining: remaining
	};

}


/*
 * Counts one use of `kind`. A finite limit is enforced
 * using existing KV read/check/write. This is NOT distributed-atomic;
 * browser records are advisory only. Returning allowed:false never increments.
 */
async function creditConsume(
	env: any,
	username: any,
	usertype: any,
	kind: any,
	amount: any = 1
): Promise<any> {

	return creditConsumeKey(
		env,
		CREDIT_KEY_PREFIX +
			String(username || "")
				.toLowerCase(),
		creditPlanFor(usertype),
		kind,
		amount
	);

}


/*
 * Key + plan variant. `meta` (masked IP, hash, scope) is merged
 * into the stored record so the settings page can show a table
 * of guest rows without storing the raw address.
 */
async function creditConsumeKey(
	env: any,
	key: any,
	plan: any,
	kind: any,
	amount: any = 1,
	meta: any = null
): Promise<any> {

	const limit =
		plan.limits[kind];

	const state =
		await creditReadKey(
			env,
			key
		);

	const used =
		Number(state[kind]) ||
		0;

	if (
		limit !== null &&
		used + amount > limit
	) {

		return {
			allowed: false,
			plan: plan,
			state: state,
			summary:
				creditSummaryFor(
					plan,
					state
				)
		};

	}

	state[kind] =
		used + amount;

	state.updatedAt =
		new Date().toISOString();

	if (meta) {

		Object.assign(
			state,
			meta
		);

	}

	await creditWriteKey(
		env,
		key,
		state
	);

	return {
		allowed: true,
		plan: plan,
		state: state,
		summary:
			creditSummaryFor(
				plan,
				state
			)
	};

}


/* Used when an AI call fails after its credit was taken. */
async function creditRefund(
	env: any,
	username: any,
	kind: any,
	amount: any = 1
): Promise<void> {

	await creditRefundKey(
		env,
		CREDIT_KEY_PREFIX +
			String(username || "")
				.toLowerCase(),
		kind,
		amount
	);

}


async function creditRefundKey(
	env: any,
	key: any,
	kind: any,
	amount: any = 1,
	meta: any = null
): Promise<void> {

	const state =
		await creditReadKey(
			env,
			key
		);

	state[kind] =
		Math.max(
			0,
			(Number(state[kind]) || 0) -
				amount
		);

	state.updatedAt =
		new Date().toISOString();

	/*
	 * `creditReadKey()` rebuilds the state without the guest
	 * metadata, so the IP row must be merged back or a refund
	 * would erase the masked address the table shows.
	 */
	if (meta) {

		Object.assign(
			state,
			meta
		);

	}

	await creditWriteKey(
		env,
		key,
		state
	);

}


async function authSessionFromRequest(
	request: any,
	env: any
): Promise<any> {

	/*
	 * Browser rotation ticket (src/modules/api-relay.ts).
	 *
	 * A request the studio rotated to a backup Worker carries no session
	 * cookie for that origin, so the signed ticket is its credential. Tickets
	 * are scoped to the AI paths (`RELAY_AI_PATHS`): `readRelayTicket()`
	 * returns null for every other route, so a ticket can never authorize an
	 * account, settings, payment, CMS or render route.
	 */
	const relayed =
		await relayTicketIdentity(
			request,
			env
		);

	if (relayed) {
		return relayed;
	}

	if (!env || !env.KV_BINDING) {
		return null;
	}

	const cookie =
		request.headers.get(
			"Cookie"
		) ||
		"";

	const match =
		cookie.match(
			/yvs_session=([a-f0-9]+)/
		);

	if (!match) {
		return null;
	}

	const raw =
		await env.KV_BINDING.get(
			"session:" + match[1]
		);

	if (!raw) {
		return null;
	}

	try {

		return JSON.parse(raw);

	}
	catch (parseError) {

		return null;

	}

}


/*
 * Session -> fresh user record. The record is read (not the
 * session snapshot) so a plan change made in the settings page
 * applies on the very next generation.
 */
async function creditSessionUser(
	request: any,
	env: any
): Promise<any> {

	const session =
		await authSessionFromRequest(
			request,
			env
		);

	if (
		!session ||
		!session.username
	) {

		return null;

	}

	let record: any =
		null;

	const raw =
		await env.KV_BINDING.get(
			"user:" +
			String(session.username)
				.toLowerCase()
		);

	if (raw) {

		try {

			record =
				JSON.parse(raw);

		}
		catch (parseError) {

			record = null;

		}

	}

	return {
		username:
			record &&
			record.username
				? record.username
				: session.username,
		email:
			record &&
			record.email
				? record.email
				: session.email || "",
		usertype:
			creditNormalizeUsertype(
				record &&
				record.usertype
			)
	};

}


/*
 * ---- Freemium (no-account) identity ----------------------------
 *
 * GET /free sets `yvs_free=1`; after that, an anonymous request
 * may spend from the guest plan. The counter key is a SHA-256 of
 * the visitor's address with a fixed app salt, so the KV table
 * never holds a raw IP. Requests with no address at all (local
 * dev, some e2e harnesses) share one "unknown" bucket.
 */

function hasFreemiumCookie(
	request: any
): boolean {

	const cookie =
		request.headers.get(
			"Cookie"
		) ||
		"";

	return (
		/(?:^|;\s*)yvs_free=1(?:;|$)/.test(
			cookie
		)
	);

}


function guestRequestIp(
	request: any
): string {

	const cfIp =
		request.headers.get(
			"CF-Connecting-IP"
		);

	if (
		cfIp &&
		cfIp.trim()
	) {

		return cfIp.trim();

	}

	const forwarded =
		request.headers.get(
			"X-Forwarded-For"
		);

	if (forwarded) {

		const first =
			forwarded.split(",")[0];

		if (
			first &&
			first.trim()
		) {

			return first.trim();

		}

	}

	return "";

}


/*
 * Only the network part is persisted (203.0.113.0 / 2001:db8:
 * 1:2:3::), which is what the settings table shows.
 */
function guestMaskedIp(
	ip: any
): string {

	const value =
		String(ip || "")
			.trim();

	if (!value) {

		return "unknown";

	}

	if (
		value.indexOf(".") !== -1
	) {

		const parts =
			value.split(".");

		if (parts.length === 4) {

			return (
				parts[0] +
				"." +
				parts[1] +
				"." +
				parts[2] +
				".0"
			);

		}

		return value;

	}

	if (
		value.indexOf(":") !== -1
	) {

		const groups =
			value
				.split(":")
				.filter(
					(group: any) =>
						group.length > 0
				);

		return (
			groups
				.slice(0, 4)
				.join(":") +
			"::"
		);

	}

	return value;

}


async function guestCreditIdentity(
	request: any
): Promise<any> {

	const rawIp =
		guestRequestIp(
			request
		) ||
		"unknown";

	const digest =
		await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(
				"yvs-guest:" +
					rawIp
			)
		);

	const hash =
		authToHex(
			new Uint8Array(
				digest
			)
		).slice(0, 40);

	const masked =
		guestMaskedIp(
			rawIp
		);

	return {
		ip:
			masked,
		masked:
			masked,
		hash:
			hash,
		key:
			IPCREDIT_KEY_PREFIX +
			hash,
		scope:
			"ip"
	};

}


function guestCreditMeta(
	identity: any
): any {

	return {
		ip:
			identity.ip,
		maskedIp:
			identity.masked,
		hash:
			identity.hash,
		scope:
			"ip"
	};

}


/*
 * One guest use. Unlimited kinds (scripts, voiceovers, videos)
 * still record usage for the table but never return allowed:false.
 */
async function guestCreditConsume(
	env: any,
	identity: any,
	kind: any,
	amount: any = 1
): Promise<any> {

	return creditConsumeKey(
		env,
		identity.key,
		GUEST_PLAN,
		kind,
		amount,
		guestCreditMeta(
			identity
		)
	);

}


/*
 * 10000 -> "10,000". Every user-facing limit in this file goes
 * through here so a plan change updates the copy with it.
 */
function creditFormatNumber(
	value: any
): string {

	const number =
		Number(value);

	if (!Number.isFinite(number)) {
		return String(
			value == null ? "" : value
		);
	}

	return number.toLocaleString(
		"en-US"
	);

}


/* ---- Image credit gate ---------------------------------------- *
 *
 * Shared by GET /image/gen (one image) and POST /api/image-batch
 * (many images) so the two routes can never drift:
 *
 *   no KV binding   -> open access, unmetered (local/e2e mode)
 *   signed in       -> the account's daily image allowance
 *   yvs_free=1      -> the IP-keyed guest allowance (10/day)
 *   anything else   -> 401 naming /free
 *
 * consume(amount) reserves up to `amount` images and reports how
 * many were actually granted (a batch can start with fewer when the
 * allowance runs out mid-way); refund(amount) returns credits for
 * images that never rendered.
 */

function creditExhaustedMessage(
	plan: any,
	guest: boolean
): string {

	const limit =
		plan && plan.limits
			? plan.limits.images
			: 0;

	const label =
		plan && plan.label
			? plan.label
			: "free";

	return (
		"Daily image credits used up (" +
		creditFormatNumber(limit) +
		" images/day on the " +
		label +
		" plan). Credits renew at midnight (UTC+8)." +
		(guest
			? " Create a free account for " +
				creditFormatNumber(
					CREDIT_PLANS.free.limits
						.images
				) +
				" images per day."
			: "")
	);

}


/*
 * X-Credit-* headers let the studio refresh its credits pill
 * without a second fetch.
 */
function creditResponseHeaders(
	summary: any,
	credits: any
): any {

	const headers: any =
		{};

	if (summary) {

		if (summary.plan) {

			headers["X-Credit-Plan"] =
				summary.plan.id;

			headers["X-Credit-Images-Limit"] =
				String(
					summary.plan.limits.images
				);

		}

		if (summary.remaining) {

			headers["X-Credit-Images-Remaining"] =
				String(
					summary.remaining.images
				);

		}

		if (summary.day) {

			headers["X-Credit-Day"] =
				summary.day;

		}

		if (summary.resetsAt) {

			headers["X-Credit-Reset"] =
				summary.resetsAt;

		}

	}

	if (credits && credits.scope) {

		headers["X-Credit-Scope"] =
			credits.scope;

	}

	return headers;

}


async function imageCreditHooks(
	request: any,
	env: any
): Promise<any> {

	if (
		!env ||
		!env.KV_BINDING
	) {

		return env?.PIXABAY_ALLOW_UNMETERED === "true"
			? { open: true }
			: { blocked: json({ success: false, error: "Media authorization storage is unavailable" }, 503) };

	}

	let user: any =
		null;

	let guest: any =
		null;

	try {

		user =
			await creditSessionUser(
				request,
				env
			);

		if (!user) {

			if (
				!hasFreemiumCookie(
					request
				)
			) {

				return {
					blocked:
						json(
							{
								success: false,
								authenticated: false,
								error:
									"Sign in to import Pixabay media \u2014 every free account gets " +
									creditFormatNumber(
										CREDIT_PLANS.free
											.limits.images
									) +
									" stock image imports per day. No account? Open /free. Pixabay API rate limits also apply."
							},
							401
						)
				};

			}

			guest =
				await guestCreditIdentity(
					request
				);

		}

	}
	catch (creditError) {

		/*
		 * A credits outage must not take image generation down
		 * with it (same fail-open rule as before). Browser records
		 * never authorize or deny a paid request.
		 */
		return { blocked: json({ success: false, error: "Media authorization unavailable. Please retry later." }, 503) };

	}

	const plan =
		user
			? creditPlanFor(user.usertype)
			: GUEST_PLAN;

	const key =
		user
			? CREDIT_KEY_PREFIX +
				String(user.username || "")
					.toLowerCase()
			: guest.key;

	const meta =
		user
			? null
			: guestCreditMeta(guest);

	const scope =
		user
			? "account"
			: "ip";

	const consume = async (
		amount: number
	): Promise<any> => {

		const wanted =
			Math.max(1, Math.floor(Number(amount) || 1));

		const first =
			await creditConsumeKey(
				env,
				key,
				plan,
				"images",
				wanted,
				meta
			);

		if (first.allowed) {

			return {
				allowed: true,
				granted: wanted,
				summary: first.summary
			};

		}

		/* Partially affordable: spend whatever is left. */
		const remaining =
			first.summary &&
			first.summary.remaining &&
			first.summary.remaining.images !== null
				? Number(
						first.summary.remaining.images
					)
				: 0;

		if (remaining > 0) {

			const second =
				await creditConsumeKey(
					env,
					key,
					plan,
					"images",
					remaining,
					meta
				);

			if (second.allowed) {

				return {
					allowed: true,
					granted: remaining,
					summary: second.summary
				};

			}

			return {
				allowed: false,
				granted: 0,
				summary: second.summary,
				error: creditExhaustedMessage(plan, scope === "ip")
			};

		}

		return {
			allowed: false,
			granted: 0,
			summary: first.summary,
			error: creditExhaustedMessage(plan, scope === "ip")
		};

	};

	const refund = async (
		amount: number
	): Promise<any> => {

		const count =
			Math.max(0, Math.floor(Number(amount) || 0));

		if (count <= 0) {

			return null;

		}

		await creditRefundKey(
			env,
			key,
			"images",
			count,
			meta
		);

		return creditSummaryFor(
			plan,
			await creditReadKey(
				env,
				key
			)
		);

	};

	return {
		open: false,
		subject: key,
		scope,
		plan,
		consume,
		refund
	};

}


/* ---- User-type based URL routes ------------------------------ */

function redirectResponse(
	location: string,
	status: any = 302
): Response {

	return new Response(
		"",
		{
			status:
				status,
			headers: {
				Location:
					location,
				"Cache-Control":
					"no-store"
			}
		}
	);

}


function applyPlanMode(
	html: string,
	mode: string
): string {

	return html.replace(
		"<script>",
		"<script>window.__PLAN_MODE = \"" +
			mode +
			"\";</" +
			"script>\r\n<script>"
	);

}


/*
 * The studio shell served by /free, /studio and /paid. The mode
 * is read by the client (window.__PLAN_MODE) so the same cached
 * page can boot as a guest or an account session.
 */
async function appPageResponse(
	env: any,
	mode: string
): Promise<Response> {

	const [studioTheme, studioCmsPages] =
		await Promise.all([
			readTheme(env),
			readCmsPages(env)
		]);

	let html =
		applyCmsLinksToStudioHtml(
			applyTheme(
				createHTML(),
				studioTheme
			),
			studioCmsPages
		);

	html =
		applyPlanMode(
			html,
			mode
		);

	const headers: any = {
		"Content-Type":
			"text/html; charset=UTF-8",
		"Cache-Control":
			"no-store"
	};

	if (mode === "freemium") {

		headers["Set-Cookie"] =
			FREEMIUM_COOKIE;

	}

	return new Response(
		html,
		{
			status: 200,
			headers:
				headers
		}
	);

}


async function handleAuthApi(
	request,
	url,
	env
) {

	const path =
		url.pathname;

	if (
		path !== "/api/session" &&
		path !== "/api/credits" &&
		path !== "/api/login" &&
		path !== "/api/signup" &&
		path !== "/api/logout"
	) {
		return null;
	}

	/*
	 * KV not bound: the client detects
	 * the 503 and keeps the app open
	 * (no lock).
	 */
	if (!env.KV_BINDING) {
		return json(
			{
				success: false,
				error:
					"User storage not configured (bind the KV namespace)"
			},
			503
		);
	}

	try {

		/*
		 * Who am I?
		 */
		if (
			path === "/api/session" &&
			request.method === "GET"
		) {

			const cookie =
				request.headers.get(
					"Cookie"
				) ||
				"";

			const match =
				cookie.match(
					/yvs_session=([a-f0-9]+)/
				);

			if (!match) {
				return json(
					{ authenticated: false },
					401
				);
			}

			const raw =
				await env.KV_BINDING.get(
					"session:" + match[1]
				);

			if (!raw) {
				return json(
					{ authenticated: false },
					401
				);
			}

			const session =
				JSON.parse(
					raw
				);

			/*
			 * Plan and today's credit counters ride along with
			 * the session so the studio can paint the credits
			 * chip without a second round-trip. A KV hiccup must
			 * never turn a valid session into a 500, so both
			 * reads fall back to the free plan / empty counters.
			 */
			let userRecord: any =
				null;

			try {

				const userRaw =
					await env.KV_BINDING.get(
						"user:" +
						String(session.username)
							.toLowerCase()
					);

				if (userRaw) {

					userRecord =
						JSON.parse(
							userRaw
						);

				}

			}
			catch (userReadError) {

				userRecord = null;

			}

			const usertype =
				creditNormalizeUsertype(
					userRecord &&
					userRecord.usertype
				);

			let creditState: any;

			try {

				creditState =
					await creditReadState(
						env,
						session.username
					);

			}
			catch (creditReadError) {

				creditState =
					creditFreshState(
						creditDay()
					);

			}

			const summary =
				creditSummary(
					usertype,
					creditState
				);

			return json(
				{
					authenticated: true,
					user: {
						username:
							session.username,
						email:
							(userRecord &&
							userRecord.email)
								? userRecord.email
								: session.email,
						usertype:
							usertype
					},
					plan:
						summary.plan,
					credits:
						summary
				}
			);

		}

		/*
		 * Today's credits for the signed-in user.
		 * GET /api/credits
		 */
		if (
			path === "/api/credits" &&
			request.method === "GET"
		) {

			const creditUser =
				await creditSessionUser(
					request,
					env
				);

			if (!creditUser) {

				/*
				 * A freemium browser is not signed in, but it
				 * still has a plan and IP-keyed counters, so
				 * it gets the same summary shape as an
				 * account instead of a 401.
				 */
				if (
					hasFreemiumCookie(
						request
					)
				) {

					const guestIdentity =
						await guestCreditIdentity(
							request
						);

					const guestState =
						await creditReadKey(
							env,
							guestIdentity.key
						);

					return json(
						Object.assign(
							creditSummaryFor(
								GUEST_PLAN,
								guestState
							),
							{
								authenticated: false,
								guest: true,
								scope: "ip",
								ip: guestIdentity.ip,
								user: null
							}
						)
					);

				}

				return json(
					{
						success: false,
						authenticated: false,
						error:
							"Not signed in"
					},
					401
				);

			}

			const state =
				await creditReadState(
					env,
					creditUser.username
				);

			const summary =
				creditSummary(
					creditUser.usertype,
					state
				);

			return json(
				Object.assign(
					summary,
					{
						authenticated: true,
						user: {
							username:
								creditUser.username,
							email:
								creditUser.email,
							usertype:
								creditUser.usertype
						}
					}
				)
			);

		}

		/*
		 * Create an account (no cap).
		 */
		if (
			path === "/api/signup" &&
			request.method === "POST"
		) {

			const body =
				await request.json().catch(
					() => ({})
				);

			const username =
				String(
					body.username ||
						""
				).trim();

			const password =
				String(
					body.password ||
						""
				);

			const email =
				String(
					body.email ||
						""
				).trim().toLowerCase();

			if (
				!/^[a-zA-Z0-9_]{3,20}$/.test(
					username
				)
			) {
				return json(
					{
						success: false,
						error:
							"Username: 3-20 letters, numbers or _"
					},
					400
				);
			}

			if (
				password.length <
					6
			) {
				return json(
					{
						success: false,
						error:
							"Password must be at least 6 characters"
					},
					400
				);
			}

			if (
				!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
					email
				)
			) {
				return json(
					{
						success: false,
						error:
							"Enter a valid email address"
					},
					400
				);
			}

			/*
			 * Unlimited accounts: there is no user
			 * cap any more. Email uniqueness is a
			 * single keyed read of the index that
			 * signup writes below.
			 */
			if (
				await env.KV_BINDING.get(
					AUTH_EMAIL_PREFIX +
					email
				)
			) {
				return json(
					{
						success: false,
						error:
							"Email already in use"
					},
					409
				);
			}

			if (
				await env.KV_BINDING.get(
					authUserKey(username)
				)
			) {
				return json(
					{
						success: false,
						error:
							"Username already taken"
					},
					409
				);
			}

			/*
			 * Accounts created before the email
			 * index existed have no email: key.
			 * While the namespace is small enough
			 * to scan inside the per-invocation
			 * operation budget, look for their
			 * email the old way. A namespace with
			 * more than AUTH_LEGACY_SCAN_MAX
			 * users can only have been created
			 * after the index landed, so every
			 * account in it is already indexed
			 * and the scan is skipped.
			 */
			const legacyUsers =
				await env.KV_BINDING.list(
					{
						prefix: "user:",
						limit:
							AUTH_LEGACY_SCAN_MAX +
							1
					}
				);

			if (
				legacyUsers.keys.length <=
				AUTH_LEGACY_SCAN_MAX
			) {
				for (
					const key of legacyUsers.keys
				) {
					const existingRaw =
						await env.KV_BINDING.get(
							key.name
						);

					if (existingRaw) {
						const existing =
							JSON.parse(
								existingRaw
							);

						if (
							existing &&
							existing.email === email
						) {
							return json(
								{
									success: false,
									error:
										"Email already in use"
								},
								409
							);
						}
					}
				}
			}

			const salt =
				crypto.getRandomValues(
					new Uint8Array(16)
				);

			const hash =
				await authHashPassword(
					password,
					salt
				);

			const user = {
				username:
					username,
				email:
					email,
				salt:
					authToHex(
						salt
					),
				hash:
					hash,
				/*
				 * Every new account starts on the free
				 * plan: unlimited videos, AI scripts and
				 * voiceovers plus 10,000 AI images per day.
				 * The settings page can promote it to
				 * paid_user (the same 10,000 images/day).
				 */
				usertype:
					"free",
				createdAt:
					new Date().toISOString()
			};

			/*
			 * One row owns everything about the
			 * account - username (unique), email and
			 * plan - so any single read of
			 * user:<username> is enough to label it.
			 */
			await env.KV_BINDING.put(
				authUserKey(username),
				JSON.stringify(
					user
				)
			);

			/*
			 * The email index is what makes the
			 * uniqueness check a single read. Its value
			 * mirrors the user row (email + plan), so the
			 * two keys always describe the same account.
			 */
			await authWriteEmailIndex(
				env,
				email,
				user
			);

			const token =
				authToHex(
					crypto.getRandomValues(
						new Uint8Array(32)
					)
				);

			await env.KV_BINDING.put(
				"session:" + token,
				JSON.stringify(
					{
						username:
							username,
						email:
							email,
						createdAt:
							new Date().toISOString()
					}
				)
			);

			const signupCredits =
				creditSummary(
					"free",
					creditFreshState(
						creditDay()
					)
				);

			return json(
				{
					success: true,
					user: {
						username:
							user.username,
						email:
							user.email,
						usertype:
							user.usertype
					},
					plan:
						signupCredits.plan,
					credits:
						signupCredits
				},
				200,
				authSessionCookie(
					token,
					30 * 24 * 3600
				)
			);

		}

		/*
		 * Sign in.
		 */
		if (
			path === "/api/login" &&
			request.method === "POST"
		) {

			const body =
				await request.json().catch(
					() => ({})
				);

			const username =
				String(
					body.username ||
						""
				).trim().toLowerCase();

			const password =
				String(
					body.password ||
						""
				);

			const raw =
				await env.KV_BINDING.get(
					"user:" + username
				);

			if (!raw) {
				return json(
					{
						success: false,
						error:
							"Invalid username or password"
					},
					401
				);
			}

			const user =
				JSON.parse(
					raw
				);

			const hash =
				await authHashPassword(
					password,
					authFromHex(
						user.salt
					)
				);

			if (hash !== user.hash) {
				return json(
					{
						success: false,
						error:
							"Invalid username or password"
					},
					401
				);
			}

			const token =
				authToHex(
					crypto.getRandomValues(
						new Uint8Array(32)
					)
				);

			await env.KV_BINDING.put(
				"session:" + token,
				JSON.stringify(
					{
						username:
							user.username,
						email:
							user.email,
						createdAt:
							new Date().toISOString()
					}
				)
			);

			const loginUsertype =
				creditNormalizeUsertype(
					user.usertype
				);

			let loginCreditState: any;

			try {

				loginCreditState =
					await creditReadState(
						env,
						user.username
					);

			}
			catch (creditReadError) {

				loginCreditState =
					creditFreshState(
						creditDay()
					);

			}

			const loginCredits =
				creditSummary(
					loginUsertype,
					loginCreditState
				);

			return json(
				{
					success: true,
					user: {
						username:
							user.username,
						email:
							user.email,
						usertype:
							loginUsertype
					},
					plan:
						loginCredits.plan,
					credits:
						loginCredits
				},
				200,
				authSessionCookie(
					token,
					30 * 24 * 3600
				)
			);

		}

		/*
		 * Sign out.
		 */
		if (
			path === "/api/logout" &&
			request.method === "POST"
		) {

			const cookie =
				request.headers.get(
					"Cookie"
				) ||
				"";

			const match =
				cookie.match(
					/yvs_session=([a-f0-9]+)/
				);

			if (match) {
				await env.KV_BINDING.delete(
					"session:" + match[1]
				);
			}

			return json(
				{ success: true },
				200,
				authSessionCookie(
					"",
					0
				)
			);

		}

		return json(
			{
				success: false,
				error:
					"Method not allowed"
			},
			405
		);

	}
	catch (error) {
		return json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: String(error)
			},
			500
		);
	}

}
