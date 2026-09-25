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
 *   ./client/config-page-js      /config/uvxyz settings overlay
 *
 * All routes, APIs and KV logic below are unchanged.
 */

import { MODEL, prompts } from "./prompts";
import { createHTML } from "./page";
import { CONFIG_PAGE_SCRIPT } from "./client/config-page-js";

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
				createHTML(),
				{
					status: 200,

					headers: {
						"Content-Type":
							"text/html; charset=UTF-8"
					}
				}
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
						headers: {
							"Content-Type":
								"image/png",
							"Cache-Control":
								"no-store",
							"X-Image-Variant":
								variant
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
		// USER AUTH API (KV-backed, max 7 users)
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
		// POST /api/script            AI script (SRT) via an
		//                             INSTRUCT model
		// POST /api/voiceover         MeloTTS voice -> MP3
		// GET/POST /api/config/workers  up to 3 worker URLs
		// GET  /config/uvxyz          settings page
		// (password: CONFIG_PASSWORD)
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
			* Settings page (password gated).
		*/
		if (
			request.method === "GET" &&
			url.pathname === "/config/uvxyz"
		) {

			let cfgHtml =
				createHTML();

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
			* AI script (SRT) generation.
			* INSTRUCT model on Workers
			* AI. POST the topic
			* + minutes (1-6) + speech
			* speed; returns the timed
			* SRT text. The output is
			* VALIDATED server-side: it
			* must parse as clean SRT
			* and its total duration
			* must stay under the
			* selected minutes (invalid
			* output is retried up to 3
			* times with the problem
			* spelled out).
		*/
		if (
			request.method === "POST" &&
			url.pathname === "/api/script"
		) {

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

			const userPrompt =
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

					let srt =
						"";

					/*
						* Accept every
						* response
						* shape: chat
						* array,
						* { response }
						* object,
						* or a plain
						* string.
						*/
					if (
						result &&
						result[0] &&
						result[0].message
					) {

						srt =
							String(
								result[0]
									.message
									.content ||
									""
							).trim();

					}

					if (
						srt === "" &&
						result &&
						typeof result
							.response ===
							"string"
					) {

						srt =
							result
								.response
								.trim();

					}

					if (
						srt === "" &&
						typeof result ===
							"string"
					) {

						srt =
							result
								.trim();

					}

					const check =
						validateSrt(
							srt,
							minutes
						);

					if (
						check.ok
					) {

						console.log(
							"[script] ok",
							{
								attempt:
									attempt,
								srtChars:
									check
									.srt.length
							}
						);

						return json(
							{
								success:
									true,
								srt:
									check
										.srt,
								model:
									SCRIPT_MODEL
							}
						);

					}

					lastError =
						check
							.error;

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
// USER AUTH HELPERS (KV-backed, max 7 users)
// =============================================================

const AUTH_MAX_USERS =
	7;


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


async function handleAuthApi(
	request,
	url,
	env
) {

	const path =
		url.pathname;

	if (
		path !== "/api/session" &&
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

			return json(
				{
					authenticated: true,
					user: {
						username:
							session.username,
						email:
							session.email
					}
				}
			);

		}

		/*
		 * Create an account (max 7).
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

			const list =
				await env.KV_BINDING.list(
					{ prefix: "user:" }
				);

			if (
				list.keys.length >=
					AUTH_MAX_USERS
			) {
				return json(
					{
						success: false,
						error:
							"Full: max " +
							AUTH_MAX_USERS +
							" users"
					},
					403
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

			for (
				const key of list.keys
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

			return json(
				{
					success: true,
					user: {
						username:
							username,
						email:
							email
					}
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

			return json(
				{
					success: true,
					user: {
						username:
							user.username,
						email:
							user.email
					}
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
