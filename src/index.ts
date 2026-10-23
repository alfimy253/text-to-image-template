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

import { MODEL, prompts } from "./prompts";
import { createHTML } from "./page";
import { CONFIG_PAGE_SCRIPT } from "./client/config-page-js";

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
	async fetch(request, env) {

		const url =
			new URL(request.url);


		// =====================================================
		// MAIN APPLICATION
		// =====================================================

		if (
			request.method === "GET" &&
			url.pathname === "/"
		) {

			return new Response(
				applyTheme(
					createHTML(),
					await readTheme(env)
				),
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

		const match =
			url.pathname.match(
				/^\/image\/(\d+)$/
			);


		if (
			request.method === "GET" &&
			match
		) {

			const index =
				Number(match[1]);


			if (
				!Number.isInteger(index) ||
				index < 0 ||
				index >= prompts.length
			) {

				return json(
					{
						success: false,
						error:
							"Invalid image index"
					},
					400
				);
			}


			try {

				const result =
					await env.AI.run(
						MODEL,
						{
							prompt:
								prompts[index]
						}
					);


				return new Response(
					result,
					{
						status: 200,

						headers: {
							"Content-Type":
								"image/png",

							"Cache-Control":
								"no-store",

							"X-Image-Index":
								String(index)
						}
					}
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


		// =====================================================
		// AI IMAGE GENERATION - custom prompt
		// (per-accordion AI panel, right 40%)
		// GET /image/gen?prompt=...&variant=1|2
		// (displayed as 480px landscape on the client)
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

			/*
			 * Daily image credits. This is the only metered
			 * generation route: the two fixed demo prompts on
			 * /image/:i are samples and stay unmetered.
			 *
			 * One HTTP response is one image, so one credit.
			 * The counter is taken before the model runs and
			 * refunded if the model fails, so a failed call
			 * never costs the user an image.
			 *
			 * When the KV binding is missing the app runs in
			 * its open-access mode and generation stays free.
			 */
			let creditUser: any =
				null;

			let creditGuest: any =
				null;

			let creditGate: any =
				null;

			if (
				env &&
				env.KV_BINDING
			) {

				try {

					creditUser =
						await creditSessionUser(
							request,
							env
						);

					if (creditUser) {

						creditGate =
							await creditConsume(
								env,
								creditUser.username,
								creditUser.usertype,
								"images"
							);

					}
					else if (
						hasFreemiumCookie(
							request
						)
					) {

						/*
						 * No account, but this browser
						 * came through /free: spend from
						 * the IP-keyed guest allowance.
						 */
						creditGuest =
							await guestCreditIdentity(
								request
							);

						creditGate =
							await guestCreditConsume(
								env,
								creditGuest,
								"images"
							);

					}
					else {

						return json(
							{
								success: false,
								authenticated: false,
								error:
									"Sign in to generate AI images \u2014 every free account gets 50 images per day. No account? Open /free for 10 images per day."
							},
							401
						);

					}

				}
				catch (creditError) {

					/*
					 * A credits outage must not take image
					 * generation down with it.
					 */
					creditUser = null;
					creditGuest = null;
					creditGate = null;

				}

			}

			if (
				creditGate &&
				!creditGate.allowed
			) {

				return json(
					{
						success: false,
						error:
							"Daily image credits used up (" +
							creditGate.plan.limits.images +
							" images/day on the " +
							creditGate.plan.label +
							" plan). Credits renew at midnight (UTC+8)." +
							(creditGuest
								? " Create a free account for 50 images per day."
								: ""),
						credits:
							creditGate.summary
					},
					429
				);

			}

			/*
			 * The X-Credit-* response headers let the studio
			 * update its credits pill without a second fetch.
			 */
			const imageHeaders: any = {
				"Content-Type":
					"image/png",
				"Cache-Control":
					"no-store",
				"X-Image-Variant":
					variant
			};

			if (
				creditGate &&
				creditGate.allowed
			) {

				imageHeaders["X-Credit-Plan"] =
					creditGate.plan.id;

				imageHeaders["X-Credit-Images-Limit"] =
					String(
						creditGate.plan.limits.images
					);

				imageHeaders["X-Credit-Images-Remaining"] =
					String(
						creditGate.summary.remaining.images
					);

				imageHeaders["X-Credit-Day"] =
					creditGate.summary.day;

				imageHeaders["X-Credit-Reset"] =
					creditGate.summary.resetsAt;

				imageHeaders["X-Credit-Scope"] =
					creditGuest
						? "ip"
						: "account";

			}

			try {

				const result =
					await env.AI.run(
						MODEL,
						{
							prompt:
								prompt +
								", 16:9 landscape, a completely text-free image"
							,
							negative_prompt:
								"text, words, letters, writing, script, kanji, Chinese characters, Japanese characters, hiragana, katakana, CJK characters, subtitles, captions, signs, billboards, logos, watermarks, typography, numbers"
						}
					);

				return new Response(
					result,
					{
						status: 200,
						headers:
							imageHeaders
					}
				);

			}
			catch (error) {

				/*
				 * The model failed: give the credit back.
				 */
				if (
					creditGate &&
					creditGate.allowed &&
					creditUser
				) {

					try {

						await creditRefund(
							env,
							creditUser.username,
							"images"
						);

					}
					catch (refundError) {

						/* best effort */

					}

				}
				else if (
					creditGate &&
					creditGate.allowed &&
					creditGuest
				) {

					try {

						await creditRefundKey(
							env,
							creditGuest.key,
							"images",
							1,
							guestCreditMeta(
								creditGuest
							)
						);

					}
					catch (refundError) {

						/* best effort */

					}

				}

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
		// POST /api/script            SEO script (SRT) via an
		//                             INSTRUCT model: 2 long-tail
		//                             keywords (1-3 short each) are
		//                             planned first, then the
		//                             script must use them
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

		// INSTRUCT model for SRT
		// script generation. The old
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
				applyTheme(
					createHTML(),
					await readTheme(env)
				);

			cfgHtml =
				cfgHtml.replace(
					"<script>",
					"<script>window.__CONFIG_PAGE = true;</" +
						"script>\r\n<script>"
				);

			cfgHtml =
				cfgHtml.replace(
					"</body>",
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
			* SEO script (SRT) generation.
			* INSTRUCT model on Workers
			* AI, in two stages.
			*
			*  1. Keywords: 2 long-tail
			*     keywords, each with 1-3
			*     short keywords, 2-5 short
			*     keywords in total (its own
			*     3 attempts).
			*  2. Script: SRT built around
			*     that set. The output is
			*     VALIDATED server-side -
			*     clean SRT under the
			*     selected minutes AND every
			*     short keyword spoken 2-5
			*     times, every long-tail
			*     keyword at least once
			*     (invalid output is retried
			*     up to 3 times with the
			*     problem spelled out).
		*/
		if (
			request.method === "POST" &&
			url.pathname === "/api/script"
		) {

			/*
			 * AI scripts are unlimited on both plans (free and
			 * paid_user). The counter is informational, so a
			 * credits read/write failure must never fail the
			 * script itself.
			 */
			if (
				env &&
				env.KV_BINDING
			) {

				try {

					const scriptCreditUser =
						await creditSessionUser(
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

					}
					else if (
						hasFreemiumCookie(
							request
						)
					) {

						/*
						 * Guest scripts are unlimited; the
						 * IP row records usage only.
						 */
						await guestCreditConsume(
							env,
							await guestCreditIdentity(
								request
							),
							"scripts"
						);

					}

				}
				catch (creditError) {

					/* usage tracking is best-effort */

				}

			}

			const body =
				await request.json().catch(
					() => ({})
				);

			const topic =
				String(
					body.topic ||
						"my video"
				).trim().slice(0, 160);

			const minutes =
				Number(
					(body.minutes === undefined ||
						body.minutes === null ||
						body.minutes === "")
						? 1
						: body.minutes
				);

			const speed =
				String(
					body.speed ||
						"medium"
				).toLowerCase().trim();

			/*
				* Words per minute for
				* each speech speed.
			*/
			const SPEED_WORDS =
				{
					"super fast":
						210,
					"fast":
						170,
					"medium":
						140,
					"slow":
						110
				};

			if (
				!env.AI
			) {

				return json(
					{
						success: false,
						error:
							"AI binding not configured"
					},
					503
				);

			}

			if (
				!Number.isInteger(minutes) ||
				minutes < 1 ||
				minutes > 6
			) {

				return json(
					{
						success: false,
						error:
							"Minutes must be 1-6"
					},
					400
				);

			}

			if (
				!SPEED_WORDS[speed]
			) {

				return json(
					{
						success: false,
						error:
							"Speech must be super fast, fast, medium or slow"
					},
					400
				);

			}

			console.log(
				"[script] start",
				{
					topic:
						topic.slice(
						0,
						80),
					minutes:
						minutes,
					speed:
						speed,
					model:
						SCRIPT_MODEL
				}
			);

			const endStamp =
				"00:" +
					String(minutes).padStart(2, "0") +
					":00,000";

			const wordTarget =
				SPEED_WORDS[speed] * minutes;

			/*
				* Server-side SRT
				* validation: strips
				* fences/prose, parses
				* the cues, checks the
				* timestamps and the
				* total duration (must
				* stay UNDER the
				* selected minutes).
				* Returns { ok, error,
				* srt, endMs }.
				*/
			function validateSrt(
				text,
				minutes
			) {

				let srt =
					String(
						text ||
							""
					).replace(
						/[\u0000-\u0008\u000B\u000E-\u001F]/g,
						""
					).trim();

				if (
					srt.indexOf(
						"```"
					) !== -1
				) {

					const parts =
						srt.split(
							"```"
						);

					srt =
						(parts[1] ||
							srt).trim();

				}

				const lines =
					srt.split(
						/\r?\n/
					);

				/*
					* Drop any prose the
					* model puts before
					* the first cue
					* number.
					*/
				let firstCue =
					-1;

				for (
					let li = 0;
					li < lines.length;
					li++
				) {

					if (
						/^[0-9]+$/.test(
							lines[li].trim()
						)
					) {

						firstCue =
							li;

						break;

					}

				}

				if (
					firstCue === -1
				) {

					return {
						ok: false,
						error:
							"no SRT cues found in the model output"
					};

				}

				srt =
					lines
						.slice(firstCue)
						.join("\n");

				const cueLines =
					srt.split(
						/\r?\n/
					);

				const STAMP =
					/([0-9]{1,2}):([0-9]{2}):([0-9]{2}),([0-9]{3})/;

				const cues =
					[];

				let bad =
					"";

				let current =
					null;

				const toMs =
					(h, m, s, ms) =>
						((Number(h) * 60 +
							Number(m)) * 60 +
							Number(s)) *
						1000 +
						Number(ms);

				for (
					let li = 0;
					li < cueLines.length;
					li++
				) {

					const line =
						cueLines[li]
							.trim();

					if (
						!line
					) {
						continue;
					}

					if (
						/^[0-9]+$/.test(
							line
						)
					) {

						current =
							{
								startMs:
									0,
								endMs:
									0,
								text:
									""
							};

						cues.push(
							current
						);

						continue;

					}

					if (
						line.indexOf(
							"-->"
						) !== -1
					) {

						if (
							!current
						) {

							bad =
								"timestamp without a cue number";

							break;

						}

						const sides =
							line.split(
								"-->"
							);

						const a =
							STAMP.exec(
								String(
									sides[0]
								)
							);

						const b =
							STAMP.exec(
								String(
									sides[1] ||
										""
								)
							);

						if (
							!a ||
							!b
						) {

							bad =
								"broken timestamp: " +
								line.slice(
									0,
									60
								);

							break;

						}

						current.startMs =
							toMs(
								a[1],
								a[2],
								a[3],
								a[4]
							);

						current.endMs =
							toMs(
								b[1],
								b[2],
								b[3],
								b[4]
							);

						if (
							current.startMs >=
								current.endMs
						) {

							bad =
								"cue starts at or after its end: " +
								line.slice(
									0,
									60
								);

							break;

						}

						if (
							cues.length >
								1 &&
							cues[cues.length -
								2].endMs >
								current.startMs
						) {

							bad =
								"overlapping cues at: " +
								line.slice(
									0,
									60
								);

							break;

						}

						continue;

					}

					if (
						current
					) {

						current.text =
							current.text
								? current.text +
									" " +
									line
								: line;

					}

				}

				if (
					bad
				) {

					return {
						ok: false,
						error:
							bad
					};

				}

				const realCues =
					cues.filter(
						(c) =>
							c.text &&
							c.endMs >
							c.startMs
					);

				if (
					!realCues.length
				) {

					return {
						ok: false,
						error:
							"no valid SRT cues in the model output"
					};

				}

				const endMs =
					realCues[
						realCues.length -
							1
					].endMs;

				if (
					endMs < 10000
				) {

					return {
						ok: false,
						error:
							"script too short (" +
							Math.round(
								endMs / 1000
							) +
							"s) for " +
							minutes +
							" minute(s)"
					};

				}

				if (
					endMs >
						minutes * 60 *
						1000 + 1500
				) {

					return {
						ok: false,
						error:
							"script is " +
							Math.round(
								endMs / 1000
							) +
							"s long - it must stay under " +
							minutes +
							" minute(s)"
					};

				}

				return {
					ok: true,
					srt:
						srt,
					endMs:
						endMs
				};

			}

			/*
			 * SEO layer. The script is written around a
			 * keyword set that is planned first and
			 * verified afterwards:
			 *
			 *   - SEO_LONG_TAIL long-tail keywords,
			 *     each with 1..SEO_SHORT_PER_LONG_MAX
			 *     short keywords;
			 *   - SEO_SHORT_TOTAL_MIN..
			 *     SEO_SHORT_TOTAL_MAX short keywords in
			 *     total;
			 *   - every short keyword must be spoken
			 *     SEO_SHORT_FREQ_MIN..
			 *     SEO_SHORT_FREQ_MAX times;
			 *   - every long-tail keyword must be
			 *     spoken at least
			 *     SEO_LONG_FREQ_MIN time.
			 *
			 * The model is only asked for the script; the
			 * frequency rules are counted here and a
			 * violation is sent back to the model as the
			 * retry reason (same 3-attempt loop as the
			 * SRT validation).
			 */
			const SEO_LONG_TAIL =
				2;

			const SEO_SHORT_TOTAL_MIN =
				2;

			const SEO_SHORT_TOTAL_MAX =
				5;

			const SEO_SHORT_PER_LONG_MIN =
				1;

			const SEO_SHORT_PER_LONG_MAX =
				3;

			const SEO_SHORT_WORDS_MAX =
				3;

			const SEO_LONG_WORDS_MAX =
				6;

			const SEO_SHORT_FREQ_MIN =
				2;

			const SEO_SHORT_FREQ_MAX =
				5;

			const SEO_LONG_FREQ_MIN =
				1;

			/*
			 * Reads the text out of whichever shape the
			 * model returns: chat array, { response }
			 * object, or a plain string.
			 */
			function aiText(result: any) {

				if (
					result &&
					result[0] &&
					result[0].message
				) {
					return String(
						result[0].message.content ||
							""
					).trim();
				}

				if (
					result &&
					typeof result.response ===
						"string"
				) {
					return result.response.trim();
				}

				if (
					typeof result === "string"
				) {
					return result.trim();
				}

				return "";

			}

			/*
			 * Counts how often a keyword is spoken. Matching is
			 * case-insensitive, tolerates any whitespace between
			 * the words and uses word boundaries so "ai" is not
			 * counted inside "said".
			 */
			function keywordCount(
				text: string,
				keyword: string
			) {

				const escaped =
					String(keyword || "")
						.toLowerCase()
						.trim()
						.replace(
							/[.*+?^${}()|[\]\\]/g,
							"\\$&"
						)
						.replace(
							/\s+/g,
							"\\s+"
						);

				if (!escaped) {
					return 0;
				}

				const hits =
					String(text || "")
						.toLowerCase()
						.match(
							new RegExp(
								"\\b" +
									escaped +
									"\\b",
								"g"
							)
						);

				return hits
					? hits.length
					: 0;

			}

			/*
			 * The spoken words of an SRT block: cue numbers and
			 * timestamp lines removed. This is what the keyword
			 * frequencies are counted against, because it is what
			 * the narrator actually says.
			 */
			function srtSpokenText(srt: string) {

				const words =
					[];

				const lines =
					String(srt || "").split(
						/\r?\n/
					);

				for (
					let li = 0;
					li < lines.length;
					li++
				) {

					const line =
						lines[li].trim();

					if (!line) {
						continue;
					}

					if (
						/^[0-9]+$/.test(line)
					) {
						continue;
					}

					if (
						line.indexOf("-->") !==
						-1
					) {
						continue;
					}

					words.push(line);

				}

				return words.join(" ");

			}

			/*
			 * Parses + validates the keyword JSON. Returns
			 * { ok, error, data }. data = { longTail: [{ keyword,
			 * short: [...] }], shorts: [...] } with every keyword
			 * lower-cased and whitespace-collapsed.
			 */
			function parseKeywordSet(text: string) {

				let raw =
					String(text || "")
						.replace(
							/[\u0000-\u0008\u000B\u000E-\u001F]/g,
							""
						)
						.trim();

				if (
					raw.indexOf("```") !== -1
				) {

					const parts =
						raw.split("```");

					raw =
						(parts[1] || raw).trim();

				}

				const start =
					raw.indexOf("{");

				const end =
					raw.lastIndexOf("}");

				if (
					start === -1 ||
					end <= start
				) {
					return {
						ok: false,
						error:
							"no JSON object in the keyword output"
					};
				}

				let data =
					null;

				try {

					data =
						JSON.parse(
							raw.slice(
								start,
								end + 1
							)
						);

				}
				catch (jsonError) {

					return {
						ok: false,
						error:
							"the keyword reply was not valid JSON"
					};

				}

				const longTail =
					data &&
					Array.isArray(
						data.longTail
					)
						? data.longTail
						: null;

				if (!longTail) {

					return {
						ok: false,
						error:
							'the JSON needs a "longTail" array'
					};

				}

				if (
					longTail.length !==
					SEO_LONG_TAIL
				) {

					return {
						ok: false,
						error:
							"there must be exactly " +
							SEO_LONG_TAIL +
							" long-tail keywords, not " +
							longTail.length
					};

				}

				const shortKeywords =
					[];

				const clean =
					[];

				for (
					const entry of longTail
				) {

					const keyword =
						String(
							(entry && entry.keyword) ||
								""
						)
							.trim()
							.toLowerCase()
							.replace(
								/\s+/g,
								" "
							);

					if (!keyword) {

						return {
							ok: false,
							error:
								"a long-tail entry has no keyword"
						};

					}

					if (
						keyword.split(" ")
							.length >
						SEO_LONG_WORDS_MAX
					) {

						return {
							ok: false,
							error:
								'the long-tail keyword "' +
								keyword +
								'" is longer than ' +
								SEO_LONG_WORDS_MAX +
								" words"
						};

					}

					const shortList =
						Array.isArray(
							entry.short
						)
							? entry.short
							: [];

					if (
						shortList.length <
							SEO_SHORT_PER_LONG_MIN ||
						shortList.length >
							SEO_SHORT_PER_LONG_MAX
					) {

						return {
							ok: false,
							error:
								'"' +
								keyword +
								'" needs ' +
								SEO_SHORT_PER_LONG_MIN +
								"-" +
								SEO_SHORT_PER_LONG_MAX +
								" short keywords, not " +
								shortList.length
						};

					}

					const scrubbed =
						[];

					for (
						const shortEntry of shortList
					) {

						const shortKeyword =
							String(shortEntry || "")
								.trim()
								.toLowerCase()
								.replace(
									/\s+/g,
									" "
								);

						if (!shortKeyword) {

							return {
								ok: false,
								error:
									'a short keyword under "' +
									keyword +
									'" is empty'
							};

						}

						if (
							shortKeyword.split(" ")
								.length >
							SEO_SHORT_WORDS_MAX
						) {

							return {
								ok: false,
								error:
									'the short keyword "' +
									shortKeyword +
									'" is longer than ' +
									SEO_SHORT_WORDS_MAX +
									" words"
							};

						}

						scrubbed.push(
							shortKeyword
						);

						if (
							shortKeywords.indexOf(
								shortKeyword
							) === -1
						) {
							shortKeywords.push(
								shortKeyword
							);
						}

					}

					clean.push({
						keyword:
							keyword,
						short:
							scrubbed
					});

				}

				if (
					clean[0].keyword ===
					clean[1].keyword
				) {

					return {
						ok: false,
						error:
							"the two long-tail keywords must be different"
					};

				}

				if (
					shortKeywords.length <
						SEO_SHORT_TOTAL_MIN ||
					shortKeywords.length >
						SEO_SHORT_TOTAL_MAX
				) {

					return {
						ok: false,
						error:
							"there must be " +
							SEO_SHORT_TOTAL_MIN +
							"-" +
							SEO_SHORT_TOTAL_MAX +
							" short keywords in total, not " +
							shortKeywords.length
					};

				}

				return {
					ok: true,
					data: {
						longTail:
							clean,
						shorts:
							shortKeywords
					}
				};

			}

			/*
			 * Returns "" when the spoken script honours the
			 * keyword rules, otherwise the exact problem (used
			 * as the retry hint).
			 */
			function keywordUsageError(
				spokenText: string,
				keywordSet: any
			) {

				for (
					const long of keywordSet.longTail
				) {

					const count =
						keywordCount(
							spokenText,
							long.keyword
						);

					if (
						count <
						SEO_LONG_FREQ_MIN
					) {

						return (
							'the long-tail keyword "' +
							long.keyword +
							'" never appears; say it at least ' +
							SEO_LONG_FREQ_MIN +
							" time"
						);

					}

				}

				for (
					const shortKeyword of keywordSet.shorts
				) {

					const count =
						keywordCount(
							spokenText,
							shortKeyword
						);

					if (
						count <
						SEO_SHORT_FREQ_MIN
					) {

						return (
							'the short keyword "' +
							shortKeyword +
							'" appears ' +
							count +
							" time(s); it must appear " +
							SEO_SHORT_FREQ_MIN +
							"-" +
							SEO_SHORT_FREQ_MAX +
							" times"
						);

					}

					if (
						count >
						SEO_SHORT_FREQ_MAX
					) {

						return (
							'the short keyword "' +
							shortKeyword +
							'" appears ' +
							count +
							" times; use it at most " +
							SEO_SHORT_FREQ_MAX +
							" times"
						);

					}

				}

				return "";

			}

			const basePrompt =
				"You are a professional video script writer. Answer with ONLY valid SRT subtitle text, nothing else. " +
				"Write a YouTube narration script as SRT subtitles about: " +
					topic +
					". The video is " +
					minutes +
					" minute(s) long and the TOTAL duration of your SRT must stay UNDER " +
					minutes +
					" minute(s): the final timestamp must end at or before " +
					endStamp +
					" and must never exceed it. The speaker talks " +
					speed +
					" (about " +
					wordTarget +
					" words total). Output ONLY valid SRT: each cue is a number, a line like 00:00:00,000 --> 00:00:04,000, then the subtitle text, with a blank line between cues. Keep each subtitle line under 42 characters. Timestamps start at 00:00:00,000, never overlap, and use the whole duration. Plain spoken English only - no headings, no markdown, no code fences, nothing outside the SRT.";

			/*
				* Generate + validate,
				* retrying with the
				* specific problem added
				* to the prompt (max 3
				* attempts).
				*/
			try {

				/*
				 * Stage 1: plan the SEO keyword set. The
				 * planner gets its own 3 attempts, and an
				 * invalid set never reaches the writer.
				 */
				const keywordPrompt =
					"You are an SEO strategist for YouTube. Answer with ONLY one JSON object, no prose and no code fences. " +
					"The video topic is: " +
					topic +
					". Give exactly " +
					SEO_LONG_TAIL +
					" long-tail keywords (2-" +
					SEO_LONG_WORDS_MAX +
					" words each, a specific search phrase that expands the topic) and under each one " +
					SEO_SHORT_PER_LONG_MIN +
					"-" +
					SEO_SHORT_PER_LONG_MAX +
					" short SEO keywords (1-" +
					SEO_SHORT_WORDS_MAX +
					" words each) that it covers; the short keywords together must be " +
					SEO_SHORT_TOTAL_MIN +
					"-" +
					SEO_SHORT_TOTAL_MAX +
					" in total and every keyword must be lower case, unique and closely related to the topic. " +
					'Reply with exactly this JSON shape: {"longTail":[{"keyword":"first long tail","short":["short one","short two"]},{"keyword":"second long tail","short":["short three"]}]}';

				let keywordSet =
					null;

				let keywordError =
					"";

				for (
					let attempt = 1;
					attempt <= 3;
					attempt++
				) {

					const prompt =
						keywordPrompt +
						(attempt > 1
							?
								" Your previous attempt was rejected: " +
								keywordError +
								" Try again and fix that exact problem."
							: "");

					console.log(
						"[script] keywords attempt",
						{
							attempt:
								attempt,
							promptChars:
								prompt.length
						}
					);

					const result =
						await env.AI.run(
							SCRIPT_MODEL,
							{
								prompt:
									prompt,
								max_tokens:
									512,
								temperature:
									0.6
							}
						);

					const check =
						parseKeywordSet(
							aiText(result)
						);

					if (check.ok) {

						keywordSet =
							check.data;

						break;

					}

					keywordError =
						check.error;

					console.log(
						"[script] keywords invalid",
						{
							attempt:
								attempt,
							reason:
								keywordError
						}
					);

				}

				if (!keywordSet) {

					return json(
						{
							success: false,
							error:
								"SEO keywords invalid (" +
								keywordError +
								") - try again"
						},
						500
					);

				}

				console.log(
					"[script] keywords ok",
					{
						longTail:
							keywordSet.longTail.map(
								(l) => l.keyword
							),
						shorts:
							keywordSet.shorts
					}
				);

				/*
				 * Stage 2: the writer gets the keyword set and
				 * its frequency rules spelled out. The rules are
				 * also enforced after generation (see below), so
				 * a script that ignores them is rejected and
				 * rewritten with the exact problem attached.
				 */
				const userPrompt =
					basePrompt +
					"SEO keyword requirements, all mandatory: the narration must say each of these long-tail keywords at least once: " +
					keywordSet.longTail
						.map((l) => l.keyword)
						.join("; ") +
					". It must also say each of these short keywords between " +
					SEO_SHORT_FREQ_MIN +
					" and " +
					SEO_SHORT_FREQ_MAX +
					" times: " +
					keywordSet.shorts.join("; ") +
					". Work every keyword into natural spoken sentences - never read them out as a list - and never use a short keyword more than " +
					SEO_SHORT_FREQ_MAX +
					" times. ";

				let lastError =
					"";

				for (
					let attempt = 1;
					attempt <= 3;
					attempt++
				) {

					const prompt =
						userPrompt +
						(attempt > 1
							?
							" Your previous attempt was rejected: " +
								lastError +
								" Try again and fix that exact problem."
							: "");

					console.log(
						"[script] attempt",
						{
							attempt:
								attempt,
							promptChars:
								prompt.length
						}
					);

					const result =
						await env.AI.run(
							SCRIPT_MODEL,
							{
								prompt:
									prompt,
								max_tokens:
									2048,
								temperature:
									0.7
							}
						);

					/*
					 * Same response shapes as the
					 * keyword stage: chat array,
					 * { response } object or a plain
					 * string.
					 */
					const srt =
						aiText(result);

					const check =
						validateSrt(
							srt,
							minutes
						);

					/*
					 * A script only passes when the SRT
					 * is valid AND the spoken words hit
					 * the keyword frequencies. The rule
					 * that failed becomes the retry
					 * reason handed back to the model.
					 */
					const spokenText =
						check.ok && check.srt
							? srtSpokenText(
									check.srt
								)
							: "";

					const problem =
						check.ok
							? keywordUsageError(
									spokenText,
									keywordSet
								)
							: check.error;

					if (!problem) {

						/*
						 * The counts are measured on
						 * the final script, so the web
						 * app can show what was really
						 * written.
						 */
						const keywords = {
							longTail:
								keywordSet.longTail.map(
									(l) => ({
										keyword:
											l.keyword,
										count:
											keywordCount(
												spokenText,
												l.keyword
											),
										short:
											l.short
									})
								),
							short:
								keywordSet.shorts.map(
									(kw) => ({
										keyword:
											kw,
										count:
											keywordCount(
												spokenText,
												kw
											),
										min:
											SEO_SHORT_FREQ_MIN,
										max:
											SEO_SHORT_FREQ_MAX
									})
								)
						};

						console.log(
							"[script] ok",
							{
								attempt:
									attempt,
								srtChars:
									check
										.srt.length,
								keywords:
									keywords.short.map(
										(x) =>
											x.keyword +
											" x" +
											x.count
									)
							}
						);

						return json(
							{
								success:
									true,
								srt:
									check
										.srt,
								keywords:
									keywords,
								model:
									SCRIPT_MODEL
							}
						);

					}

					lastError =
						problem;

					console.log(
						"[script] invalid",
						{
							attempt:
								attempt,
							reason:
								lastError
						}
					);


				}

				return json(
					{
						success: false,
						error:
							"Script output invalid (" +
								lastError +
								") - try again"
					},
					500
				);

			}

			catch (error) {

				console.log(
					"[script] error",
					{
						error:
							error.message ||
							String(error)
					}
				);

				return json(
					{
						success: false,
						error:
							error.message ||
							"Script generation failed"
					},
					500
				);

			}

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

		try {
			const body =
				await request.json().catch(
					() => ({})
				);

			let text =
				String(
					body.text ||
						""
				).replace(
					/[\u0000-\u001F]/g,
					""
				).replace(
					/\s+/g,
					" "
				).trim();

			/*
				* 8000-char cap -
				* but never in the
				* middle of an emoji
				* (surrogate pair):
				* a lone surrogate in
				* the prompt makes the
				* upstream TTS crash
				* with 3043.
				*/
			if (
				text.length >
					8000
			) {

				let cap =
					8000;

				if (
					cap <
						text.length
				) {

					const prev =
						text.charCodeAt(
							cap - 1
						);

					const next =
						text.charCodeAt(
							cap
						);

					if (
						prev >=
							0xD800 &&
						prev <=
							0xDBFF &&
						next >=
							0xDC00 &&
						next <=
							0xDFFF
					) {

						cap--;

					}

				}

				text =
					text.slice(
						0,
						cap
					);

			}

			/*
				* Normalize tricky
				* typography before
				* speaking: the
				* upstream TTS has
				* been reported to
				* fail (3043) on
				* unusual characters,
				* and model output
				* loves em dashes,
				* ellipses and
				* curly quotes.
				*/
			text =
				text.replace(
					/\u2014|\u2013/g,
					"-"
				).replace(
					/\u2026/g,
					"..."
				).replace(
					/[\u2018\u2019]/g,
					"'"
				).replace(
					/[\u201C\u201D]/g,
					'"'
				).replace(
					/\u00A0/g,
					" "
				).replace(
					/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g,
					""
				).replace(
					/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
					""
				).replace(
					/\s+/g,
					" "
				).trim();

			const lang =
				String(
					body.lang ||
						"en"
				).toLowerCase().trim();

			const VOICE_LANGS =
				["en", "zh", "es", "fr", "hi", "it", "ja", "ko"];

			if (
				!env.AI
			) {

				console.log(
					"[voiceover] rejected: no AI binding (503)"
				);

				return json(
					{
						success: false,
						error:
							"AI binding not configured"
					},
					503
				);

			}

			if (
				!text
			) {

				console.log(
					"[voiceover] rejected: empty text (400)"
				);

				return json(
					{
						success: false,
						error:
							"No script text to speak"
					},
					400
				);

			}

			if (
				VOICE_LANGS.indexOf(
					lang
				) === -1
			) {

				console.log(
					"[voiceover] rejected: unknown lang (400)",
					{
						lang:
							lang
					}
				);

				return json(
					{
						success: false,
						error:
							"Unknown voice language"
					},
					400
				);

			}

			/*
				* TTS models reject
				* overly long text (the
				* old "internal server
				* error"): split the
				* script into small
				* sentence chunks
				* (500 chars or less -
				* the upstream TTS is
				* flaky on long input).
				*/
			console.log(
				"[voiceover] start",
				{
					chars:
						text.length,
					lang:
						lang
				}
			);

			const MAX_CHUNK =
				500;

			const sentences =
				text.match(
					/[^.!?\u2026]+[.!?\u2026]*\s*/g
				) || [text];

			const chunks =
				[];

			let current =
				"";

			for (
				let ci = 0;
				ci < sentences.length;
				ci++
			) {

				const s =
					sentences[ci];

				if (
					current &&
					current.length +
						s.length >
						MAX_CHUNK
				) {

					chunks.push(
						current.trim()
					);

					current =
						"";

				}

				if (
					s.length >
						MAX_CHUNK
				) {

					/*
						* One sentence
						* longer than a
						* whole chunk:
						* hard-split it.
						*/
					if (
						current
					) {

						chunks.push(
							current.trim()
						);

						current =
							"";

					}

					let off =
						0;

					while (
						off < s.length
					) {

						let end =
							off +
							MAX_CHUNK;

						if (
							end >
								s.length
						) {

							end =
								s.length;

						}

						/*
							* Never cut an
							* emoji
							* (surrogate
							* pair) in
							* half: a
							* lone
							* surrogate
							* crashes
							* the
							* upstream
							* TTS
							* (3043).
							*/
						if (
							end <
								s.length
						) {

							const prev =
								s.charCodeAt(
									end - 1
								);

							const next =
								s.charCodeAt(
									end
								);

							if (
								prev >=
									0xD800 &&
								prev <=
									0xDBFF &&
								next >=
									0xDC00 &&
								next <=
									0xDFFF
							) {

								end--;

							}

						}

						const part =
							s.slice(
								off,
								end
							).trim();

						if (part) {

							chunks.push(
								part
							);

						}

						off =
							end;

					}

					continue;

				}

				current +=
					s;

			}

			if (
				current.trim()
			) {

				chunks.push(
					current.trim()
				);

			}

			console.log(
				"[voiceover] chunks",
				{
					count:
						chunks.length,
					sizes:
						chunks.map(
						(c) =>
						c.length
						)
				}
			);

			/*
				* One TTS request per
				* chunk (with retries
				* for the flaky
				* upstream), then the
				* pieces are joined
				* into one file.
				*/
			const pieces =
				[];

			for (
				let ci = 0;
				ci < chunks.length;
				ci++
			) {

				/*
					* Upstream flakiness
					* (AiError 3043):
					* up to 3 attempts
					* per chunk, short
					* backoff between
					* tries.
					*/
				let result =
					null;

				let lastTtsError =
					"";

				for (
					let attempt = 1;
					attempt <= 3;
					attempt++
				) {

					try {

						/*
							* Exactly
							* the
							* documented
							* sample
							* call:
							* { prompt,
							* lang }
							* (lang
							* always
							* sent,
							* default
							* "en").
							*/
						console.log(
							"[voiceover] tts call",
							{
								chunk:
									ci + 1,
								of:
									chunks.length,
								attempt:
									attempt,
								chars:
									chunks[ci].length,
								preview:
									chunks[ci].slice(
									0,
									60)
							}
						);

						result =
							await env.AI.run(
								VOICEOVER_MODEL,
								{
									prompt:
										chunks[ci],
									lang:
										lang
								}
							);

						lastTtsError =
							"";

						break;

					} catch (ttsError) {

						lastTtsError =
							(ttsError &&
								ttsError.message) ||
							String(ttsError);

						result =
							null;

						console.log(
							"[voiceover] tts error",
							{
								chunk:
									ci + 1,
								of:
									chunks.length,
								attempt:
									attempt,
								err:
									lastTtsError
							}
						);

						if (
							attempt <
								3
						) {

							await new Promise(
								(resume) =>
									setTimeout(
										resume,
										400 *
										attempt
									)
							);

						}

					}

				}

				/*
					* Fallback engine:
					* if the Workers AI
					* TTS kept failing
					* (3043), ask the
					* free Netlify TTS
					* for this chunk
					* instead. Raw bytes
					* fit the shape
					* handler below
					* as-is.
				*/
				if (
					!result
				) {
					
					try {
						
						const fbUrl =
							FALLBACK_TTS_URL +
							"?text=" +
							encodeURIComponent(
								chunks[ci]
							) +
							"&lang=" +
							encodeURIComponent(
								lang
							);
						
						const fbResp =
							await fetch(
								fbUrl
							);
						
						if (
							fbResp.ok
						) {
							
							const fbBytes =
								new Uint8Array(
									await fbResp.arrayBuffer()
								);
							
							if (
								fbBytes.length >
									0
							) {
								
								result =
									fbBytes;
								
							}
							
							console.log(
								"[voiceover] fallback TTS",
								{
									chunk:
										ci + 1,
									of:
										chunks.length,
									bytes:
										fbBytes.length
								}
							);
							
						} else {
							
							console.log(
								"[voiceover] fallback TTS rejected",
								{
									chunk:
										ci + 1,
									of:
										chunks.length,
									status:
										fbResp.status
								}
							);
							
						}
						
					} catch (fbError) {
						
						console.log(
							"[voiceover] fallback TTS error",
							{
								chunk:
									ci + 1,
								of:
									chunks.length,
								err:
									String(fbError)
							}
						);
						
					}
					
				}

				if (
					!result
				) {

					console.log(
						"[voiceover] FAILED: TTS retries exhausted",
						{
							chunk:
								ci + 1,
							of:
								chunks.length,
							err:
								lastTtsError
						}
					);

					return json(
						{
							success: false,
							error:
								"TTS failed (chunk " +
								(ci + 1) +
								" of " +
								chunks.length +
								"): " +
								lastTtsError
						},
						500
					);

				}

				/*
					* Accept every
					* output shape: an
					* audio
					* ReadableStream
					* (the normal
					* Workers AI TTS
					* case), raw bytes,
					* a base64 string,
					* or { audio:
					* base64 }.
					*/
				let piece =
					null;

				if (
					result instanceof
						ArrayBuffer
				) {

					piece =
						new Uint8Array(
							result
						);

				} else if (
					typeof ReadableStream !==
						"undefined" &&
					result instanceof
						ReadableStream
				) {

					/*
						* ReadableStream
						* has no
						* .arrayBuffer():
						* wrap it in a
						* Response to
						* collect the
						* bytes.
						*/
					piece =
						new Uint8Array(
							await new Response(
								result
							).arrayBuffer()
						);

				} else if (
					result &&
					typeof result
						.byteLength ===
						"number"
				) {

					piece =
						new Uint8Array(
							result
						);

				} else if (
					result &&
					typeof result
						.arrayBuffer ===
						"function"
				) {

					piece =
						new Uint8Array(
							await result
								.arrayBuffer()
						);

				} else if (
					typeof result ===
						"string" &&
					result.length > 0
				) {

					piece =
						Uint8Array.from(
							atob(result),
							(c) =>
								c.charCodeAt(
									0
								)
						);

				} else if (
					result &&
					typeof result.audio ===
						"string"
				) {

					piece =
						Uint8Array.from(
							atob(result
								.audio),
							(c) =>
								c.charCodeAt(
									0
								)
						);

				}

				if (
					!piece ||
					piece.length === 0
				) {

					console.log(
						"[voiceover] FAILED: no audio in TTS output",
						{
							chunk:
								ci + 1,
							of:
								chunks.length
						}
					);

					return json(
						{
							success: false,
							error:
								"Unexpected TTS output (chunk " +
								(ci + 1) +
								" of " +
								chunks.length +
								")"
						},
						500
					);

				}

				pieces.push(
					piece
				);

			}

			/*
				* Container detection:
				* documented as MP3,
				* but Cloudflare has
				* reported that
				* MeloTTS sometimes
				* returns WAV. Join
				* the pieces into one
				* valid file either
				* way.
				*/
			const isWav =
				(p) =>
					p.length > 12 &&
					p[0] === 0x52 &&
					p[1] === 0x49 &&
					p[2] === 0x46 &&
					p[3] === 0x46;

			const findWavChunk =
				(p, id) => {
					const dv =
						new DataView(
							p.buffer,
							p.byteOffset,
							p.length
						);

					let off =
						12;

					while (
						off + 8 <=
							p.length
					) {

						const tag =
							String.fromCharCode(
								p[off],
								p[off + 1],
								p[off + 2],
								p[off + 3]
							);

						const sz =
							dv.getUint32(
								off + 4,
								true
							);

						if (
							tag === id
						) {

							return {
								off:
									off + 8,
								sz: sz
							};

						}

						off +=
							8 + sz +
							(sz % 2);

					}

					return
						null;

				};

			let outBytes =
				null;

			let audioType =
				"audio/mpeg";

			let audioName =
				"voiceover.mp3";

			if (
				pieces.every(
					isWav
				)
			) {

				/*
					* All pieces are
					* WAV: take the
					* fmt chunk of the
					* first piece and
					* the data chunks
					* of all pieces
					* into one valid
					* WAV.
					*/
				const fmtRef =
					findWavChunk(
						pieces[0],
						"fmt "
					);

				const fmtBytes =
					fmtRef
						? pieces[0].slice(
								fmtRef.off,
								fmtRef.off +
									fmtRef.sz
							)
						: new Uint8Array(
								16
							);

				const dataParts =
					[];

				for (
					let pi = 0;
					pi < pieces.length;
					pi++
				) {

					const dRef =
						findWavChunk(
							pieces[pi],
							"data"
						);

					if (dRef) {

						dataParts.push(
							pieces[pi].slice(
								dRef.off,
								dRef.off +
									dRef.sz
							)
						);

					}

				}

				const totalData =
					dataParts.reduce(
						(sum, d) =>
							sum + d.length,
						0
					);

				outBytes =
					new Uint8Array(
						28 +
						fmtBytes.length +
						totalData
					);

				/*
					* RIFF....WAVE
					*/
				outBytes[0] =
					0x52;
				outBytes[1] =
					0x49;
				outBytes[2] =
					0x46;
				outBytes[3] =
					0x46;
				outBytes[8] =
					0x57;
				outBytes[9] =
					0x41;
				outBytes[10] =
					0x56;
				outBytes[11] =
					0x45;

				const outDv =
					new DataView(
						outBytes.buffer
					);

				outDv.setUint32(
					4,
					outBytes.length -
						8,
					true
				);

				/*
					* fmt chunk
					*/
				outBytes[12] =
					0x66;
				outBytes[13] =
					0x6d;
				outBytes[14] =
					0x74;
				outBytes[15] =
					0x20;

				outDv.setUint32(
					16,
					fmtBytes.length,
					true
				);

				outBytes.set(
					fmtBytes,
					20
				);

				/*
					* data chunk
					*/
				const dataOff =
					20 +
					fmtBytes.length;

				outBytes[dataOff] =
					0x64;
				outBytes[dataOff +
						1] =
					0x61;
				outBytes[dataOff +
						2] =
					0x74;
				outBytes[dataOff +
						3] =
					0x61;

				outDv.setUint32(
					dataOff + 4,
					totalData,
					true
				);

				let dOff =
					dataOff + 8;

				for (
					let di = 0;
					di < dataParts.length;
					di++
				) {

					outBytes.set(
						dataParts[di],
						dOff
					);

					dOff +=
						dataParts[di]
							.length;

				}

				audioType =
					"audio/wav";

				audioName =
					"voiceover.wav";

			} else {

				/*
					* MP3 (or mixed
					* containers -
					* rare): join the
					* raw bytes.
					*/
				const total =
					pieces.reduce(
						(sum, p) =>
							sum + p.length,
						0
					);

				outBytes =
					new Uint8Array(
						total
					);

				let off =
					0;

				for (
					let pi = 0;
					pi < pieces.length;
					pi++
				) {

					outBytes.set(
						pieces[pi],
						off
					);

					off +=
						pieces[pi]
							.length;

				}

			}

			console.log(
				"[voiceover] done",
				{
					chunks:
						chunks.length,
					format:
						audioType,
					bytes:
						outBytes.length
				}
			);

			return new Response(
				outBytes,
				{
					status: 200,
					headers: {
						"Content-Type":
							audioType,
						"Content-Disposition":
							"attachment; filename=" +
							audioName
					}
				}
			);
		}
		catch (error) {

			console.log(
				"[voiceover] error",
				{
					error:
						(error &&
						error.message) ||
						String(error)
				}
			);

			return json(
				{
					success: false,
					error:
						(error &&
							error.message) ||
						String(error)
				},
				500
			);
		}

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
		 * user:<name>.usertype = "paid_user" gives that account
		 * 1,200 AI images per day on its next request; "free" puts it
		 * back on 50. Both values share the same daily reset record,
		 * so a plan change never loses today's usage.
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
				 * Limit 50: each account costs one record read
				 * plus one credits read, so the whole listing
				 * stays well inside the per-invocation budget.
				 */
				const listed =
					await env.KV_BINDING.list(
						{
							prefix: "user:",
							limit: 50
						}
					);

				const users =
					(
						await Promise.all(
							listed.keys.map(
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

									const username =
										record.username ||
										key.name.substring(
											"user:".length
										);

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
					).filter(
						(user) =>
							user !== null
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
					"user:" + username;

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

				record.usertype =
					usertype;

				await env.KV_BINDING.put(
					key,
					JSON.stringify(
						record
					)
				);

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


		return new Response(
			"Not Found",
			{
				status: 404
			}
		);
	}

};


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

const AUTH_LEGACY_SCAN_MAX =
	200;


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
 * Plans:
 *   free       unlimited videos, AI scripts and voiceovers,
 *              50 AI images per day
 *   paid_user  unlimited videos, AI scripts and voiceovers,
 *              1,200 AI images per day
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

const CREDIT_PLANS = {
	free: {
		id: "free",
		label: "Free",
		limits: {
			videos: null,
			images: 50,
			scripts: null,
			voiceovers: null
		}
	},
	paid_user: {
		id: "paid_user",
		label: "Paid",
		limits: {
			videos: null,
			images: 1200,
			scripts: null,
			voiceovers: null
		}
	}
};


/*
 * The freemium (no-account) plan used by GET /free.
 *
 * A visitor who has not signed in gets one metered slice of the
 * studio: 10 AI images per day, unlimited video projects, AI
 * scripts and voiceovers. Its counters use the same daily state
 * record as accounts, but are keyed by a hash of the visitor's
 * IP address (ipcredits:<hash>) instead of a username, so the
 * limit cannot be reset by clearing cookies.
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
		images: 10,
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
	 * 10-image plan instead of silently inheriting free's 50.
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
 * atomically enough for KV (read, check, write); returning
 * allowed:false never increments.
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

	let html =
		applyTheme(
			createHTML(),
			await readTheme(env)
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
					"user:" +
						username.toLowerCase()
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
				 * voiceovers plus 50 AI images per day.
				 * The settings page can promote it to
				 * paid_user (1,200 images/day).
				 */
				usertype:
					"free",
				createdAt:
					new Date().toISOString()
			};

			await env.KV_BINDING.put(
				"user:" +
					username.toLowerCase(),
				JSON.stringify(
					user
				)
			);

			/*
			 * The email index is what makes the
			 * uniqueness check a single read; it
			 * is written for every new account.
			 */
			await env.KV_BINDING.put(
				AUTH_EMAIL_PREFIX +
					email,
				JSON.stringify(
					{
						username:
							username
					}
				)
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
							username,
						email:
							email,
						usertype:
							"free"
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
