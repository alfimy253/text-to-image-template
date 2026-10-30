/*
 * APP_JS — the main YouTube Vibe Studio client script
 * (MODULES 1-9: video projects, gallery, queue, AI panel,
 * quick-batch table, plain narration script, voiceover and the
 * client-side render engine. The AI script is plain spoken text
 * end to end: no subtitle format exists anywhere in this file.
 *
 * __PROMPTS_JSON__ is replaced by page.ts with
 * JSON.stringify(prompts) — the only server-side
 * interpolation in the whole page.
 *
 * Verbatim copy of the old inline script; the escapes
 * (\`, \${, \\u...) are intentional — do not reformat.
 */

import { BROWSER_OFFLOAD_JS } from "./browser-offload";
import { BROWSER_USAGE_JS } from "./usage-ledger";
import { PROGRESSIVE_IMAGE_PIPELINE_JS } from "./progressive-image-pipeline";

export const APP_JS = `
${BROWSER_OFFLOAD_JS}
${BROWSER_USAGE_JS}
${PROGRESSIVE_IMAGE_PIPELINE_JS}
	// =========================================================
	// DATA
	// =========================================================

	const prompts =
		__PROMPTS_JSON__;


	const gallery =
		document.getElementById(
			"gallery"
		);



	/*
	 * Images selected for the video.
	 */

	const activeSlides = [];


	// =========================================================
	// AUDIO TRACK STATE
	// =========================================================

	/*
	 * Holds the decoded MP3 that will be
	 * muxed into the final MP4.
	 *
	 * currentAudio = {
	 *   name     : string,
	 *   duration : number (seconds),
	 *   buffer   : AudioBuffer,
	 *   url      : blob URL for the preview player
	 * }
	 */

	let currentAudio = null;


	const MAX_GIF_UPLOADS =
		5;


	const MAX_IMAGE_UPLOADS =
		25;


	const MAX_MP4_UPLOADS =
		5;


	const MP4_MAX_DURATION_S =
		60;


	/*
	 * Created lazily because some browsers
	 * warn when an AudioContext is created
	 * before a user gesture.
	 */

	let audioContext = null;


	const audioUploadEl =
		document.getElementById(
			"audio-upload"
		);


	const audioDetailsEl =
		document.getElementById(
			"audio-details"
		);


	const audioEmptyEl =
		document.getElementById(
			"audio-empty"
		);


	const audioNameEl =
		document.getElementById(
			"audio-name"
		);


	const audioPreviewEl =
		document.getElementById(
			"audio-preview"
		);


	const estimateValueEl =
		document.getElementById(
			"estimate-value"
		);


	const estimateSourceEl =
		document.getElementById(
			"estimate-source"
		);


	const estimateSizeEl =
		document.getElementById(
			"estimate-size"
		);


	const qualitySelectEl =
		document.getElementById(
			"quality-select"
		);


	const titleInputEl =
		document.getElementById(
			"title-input"
		);


	const titleFontEl =
		document.getElementById(
			"title-font"
		);


	const titleColorEl =
		document.getElementById(
			"title-color"
		);


	/*
	 * Title overlay settings.
	 *
	 * The size is in canvas pixels, so 15
	 * is 15 real pixels of the exported
	 * video frame.
	 */

	const TITLE_FONT_SIZE =
		22;


	const TITLE_MARGIN =
		24;


	/*
	 * Font choices for the dropdown.
	 *
	 * loadName is used to ask the browser
	 * to fetch the web font.
	 *
	 * stack is what canvas draws with, and
	 * includes fallbacks in case the font
	 * is missing on the machine.
	 */

	const TITLE_FONTS = {

		oswald: {

			loadName:
				"Oswald",

			stack:
				"'Oswald', 'Arial Narrow', sans-serif"

		},

		bauhaus: {

			loadName:
				"Bauhaus 93",

			stack:
				"'Bauhaus 93', 'Bauhaus', 'Futura', 'Century Gothic', sans-serif"

		},

		bookman: {

			loadName:
				"Bookman Old Style",

			stack:
				"'Bookman Old Style', 'Bookman', 'URW Bookman L', Georgia, serif"

		}

	};


	function getTitleFont() {

		return (
			TITLE_FONTS[
				titleFontEl.value
			] ||
			TITLE_FONTS.oswald
		);

	}


	// =========================================================
	// TIMESTAMP CAPTIONS (MAX 10)
	// =========================================================

	/*
	 * Up to ten caption entries can be added with the plus
	 * button. Each one has a timestamp in hour:minute:second
	 * format plus a short text of max 40 characters.
	 */

	const MAX_CAPTIONS =
		10;


	const CAPTION_MAX_CHARS =
		40;


	/*
	 * The last caption does not stay
	 * on screen forever: it
	 * disappears after this many
	 * milliseconds.
	 */
	const CAPTION_MAX_VISIBLE_MS =
		10000;


	const CAPTION_FONT_SIZE =
		17;


	const CAPTION_FONT_STACK =
		"'Bookman Old Style', 'Bookman', 'URW Bookman L', Georgia, serif";


	/*
	 * Subtitles (the plain script) are
	 * drawn below the caption, at
	 * 1/3 of the height up from the
	 * bottom.
	 */

	const SUBTITLE_FONT_SIZE =
		22;


	const SUBTITLE_FONT_STACK =
		"'Bookman Old Style', 'Bookman', 'URW Bookman L', Georgia, serif";


	const captionRowsEl =
		document.getElementById(
			"caption-rows"
		);


	const captionCountEl =
		document.getElementById(
			"caption-count"
		);


	const addCaptionBtn =
		document.getElementById(
			"add-caption-btn"
		);


	/*
	 * Adds one caption row. The plus button is disabled once
	 * MAX_CAPTIONS rows exist.
	 */

	function addCaptionRow() {

		if (
			captionRowsEl.children.length >=
				MAX_CAPTIONS
		) {

			return;

		}


		const row =
			document.createElement(
				"div"
			);


		row.className =
			"caption-row";


		row.innerHTML =
			'<div class="caption-time">' +
			'<input type="number" min="0" max="99" step="1" value="0" class="caption-hh" aria-label="Hours">' +
			'<span>:</span>' +
			'<input type="number" min="0" max="59" step="1" value="0" class="caption-mm" aria-label="Minutes">' +
			'<span>:</span>' +
			'<input type="number" min="0" max="59" step="1" value="0" class="caption-ss" aria-label="Seconds">' +
			'</div>' +
			'<div class="caption-text-wrap">' +
			'<input type="text" class="caption-text" maxlength="' +
				CAPTION_MAX_CHARS +
			'" placeholder="Caption text (max ' +
				CAPTION_MAX_CHARS +
			' characters)">' +
			'<span class="caption-chars">0/' +
				CAPTION_MAX_CHARS +
			'</span>' +
			'</div>' +
			'<button type="button" class="caption-remove" title="Remove caption" onclick="removeCaptionRow(this)">&times;</button>';


		const textInput =
			row.querySelector(
				".caption-text"
			);


		textInput.addEventListener(
			"input",
			() => {

				row.querySelector(
					".caption-chars"
				).textContent =
					textInput.value.length +
					"/" +
					CAPTION_MAX_CHARS;

			}
		);


		captionRowsEl.appendChild(
			row
		);


		updateCaptionCount();

	}


	function removeCaptionRow(
		button
	) {

		const row =
			button.closest(
				".caption-row"
			);


		if (row) {
			row.remove();
		}


		updateCaptionCount();

	}


	function updateCaptionCount() {

		const count =
			captionRowsEl.children.length;


		captionCountEl.textContent =
			count +
			"/" +
			MAX_CAPTIONS;


		addCaptionBtn.disabled =
			count >=
				MAX_CAPTIONS;

	}


	function clampInt(
		value,
		min,
		max
	) {

		const n =
			parseInt(
				value,
				10
			);


		if (
			!Number.isFinite(
				n
			)
		) {

			return min;

		}


		return Math.min(
			max,
			Math.max(
				min,
				n
			)
		);

	}


	/*
	 * Reads the visible rows into sorted caption objects.
	 * Rows without text are ignored, and out of range hours,
	 * minutes and seconds are clamped.
	 */

	function getCaptions() {

		const captions =
			[];


		for (
			const row of
				captionRowsEl.children
		) {

			const text =
				row.querySelector(
					".caption-text"
				).value.trim();


			if (!text) {
				continue;
			}


			const hours =
				clampInt(
					row.querySelector(
						".caption-hh"
					).value,
					0,
					99
				);


			const minutes =
				clampInt(
					row.querySelector(
						".caption-mm"
					).value,
					0,
					59
				);


			const seconds =
				clampInt(
					row.querySelector(
						".caption-ss"
					).value,
					0,
					59
				);


			captions.push(
				{
					text:
						text.slice(
							0,
							CAPTION_MAX_CHARS
					),

					timeMs:
						((hours * 60 + minutes) * 60 + seconds) * 1000
				}
			);

		}


		captions.sort(
			(a, b) =>
				a.timeMs -
					b.timeMs
		);


		return captions;

	}


	/*
	 * Warms up the Bookman font before the first frame is
	 * drawn, so the canvas does not fall back to a default
	 * font.
	 */

	async function loadCaptionFont() {

		if (
			!document.fonts ||
			!document.fonts.load
		) {

			return;

		}


		try {

			await document.fonts.load(
				CAPTION_FONT_SIZE +
				'px "Bookman Old Style"'
			);

		}
		catch (error) {

			console.warn(
				"Caption font load failed:",
				error
			);

		}

	}


	/*
	 * Draws the active caption onto the current frame.
	 *
	 * Position: centred horizontally, at 4/7 of the frame
	 * height measured from the bottom.
	 *
	 * Style: 17px Bookman, black text on a white highlight
	 * box, max 40 characters.
	 *
	 * A caption is shown from its timestamp until the next
	 * caption appears (or until the video ends).
	 */

	function drawCaptions(
		context,
		captions,
		timestampMs,
		width,
		height
	) {

		if (
			!captions.length
		) {

			return;

		}


		let active =
			null;


		for (
			const caption of
				captions
		) {

			if (
				caption.timeMs <=
					timestampMs
			) {

				active =
					caption;

			}
			else {

				break;

			}

		}


		if (!active) {
			return;
		}


		/*
		 * The last caption is capped:
		 * after CAPTION_MAX_VISIBLE_MS
		 * it no longer shows.
		 */
		if (
			captions[captions.length - 1] ===
				active &&
			timestampMs -
				active.timeMs >
				CAPTION_MAX_VISIBLE_MS
		) {

			return;

		}


		context.save();


		context.font =
			CAPTION_FONT_SIZE +
			"px " +
			CAPTION_FONT_STACK;


		context.textAlign =
			"center";


		context.textBaseline =
			"middle";


		/*
		 * Centre of the text: middle of the frame
		 * horizontally, 4/7 of the height up from the
		 * bottom.
		 */

		const x =
			width / 2;


		const y =
			height -
			(height * 4) / 7;


		const textWidth =
			context.measureText(
				active.text
			).width;


		const padX =
			10;


		const padY =
			6;


		const boxWidth =
			textWidth +
			padX * 2;


		const boxHeight =
			CAPTION_FONT_SIZE +
			padY * 2 +
			4;


		const boxX =
			x - boxWidth / 2;


		const boxY =
			y - boxHeight / 2;


		/*
		 * White highlight behind the
		 * text, with square corners
		 * (no rounding).
		 */

		context.fillStyle =
			"#ffffff";


		context.beginPath();


		context.rect(
			boxX,
			boxY,
			boxWidth,
			boxHeight
		);


		context.fill();


		/*
		 * Black text on top.
		 */

		context.fillStyle =
			"#000000";


		context.fillText(
			active.text,
			x,
			y
		);


		context.restore();

	}


	/*
	 * Draws the active script subtitle
	 * onto the current frame.
	 *
	 * Position: centred horizontally,
	 * at 1/3 of the frame height measured
	 * from the bottom (below the 4/7
	 * caption).
	 *
	 * Style: white 22px text on a
	 * translucent black box.
	 */

	function drawSubtitles(
		context,
		subs,
		timestampMs,
		width,
		height
	) {

		if (!subs.length) {

			return;

		}


		let active =
			null;


		for (
			const sub of
				subs
		) {

			if (
				timestampMs >=
					sub.startMs &&
				timestampMs <
					sub.endMs
			) {

				active =
					sub;

				break;

			}

		}


		if (!active) {

			return;

		}


		context.save();


		context.font =
			SUBTITLE_FONT_SIZE +
			"px " +
			SUBTITLE_FONT_STACK;


		context.textAlign =
			"center";


		context.textBaseline =
			"middle";


		/*
		 * Centre of the text: middle of
		 * the frame horizontally, 1/3 of
		 * the height up from the bottom.
		 */

		const x =
			width / 2;


		const y =
			height -
			height / 3;


		const textWidth =
			context.measureText(
				active.text
			).width;


		const padX =
			10;


		const padY =
			6;


		const boxWidth =
			textWidth +
			padX * 2;


		const boxHeight =
			SUBTITLE_FONT_SIZE +
			padY * 2 +
			4;


		const boxX =
			x - boxWidth / 2;


		const boxY =
			y - boxHeight / 2;


		/*
		 * Translucent black box behind
		 * the white text.
		 */

		context.fillStyle =
			"rgba(0, 0, 0, 0.55)";


		context.beginPath();


		context.rect(
			boxX,
			boxY,
			boxWidth,
			boxHeight
		);


		context.fill();


		context.fillStyle =
			"#ffffff";


		context.fillText(
			active.text,
			x,
			y
		);


		context.restore();

	}


	/*
	 * Video quality presets.
	 *
	 * Bitrate drives the file size, and
	 * file size is exactly what crashes
	 * the tab during finalization.
	 *
	 * 2.5 Mbps is already very clean for
	 * slow panning stills at 720p.
	 */

	const QUALITY_PRESETS = {

		low: {
			width:
				854,
			height:
				480,
			videoBitrate:
				1_200_000,
			audioBitrate:
				128_000
		},

		balanced: {
			width:
				1280,
			height:
				720,
			videoBitrate:
				2_500_000,
			audioBitrate:
				160_000
		},

		high: {
			width:
				1280,
			height:
				720,
			videoBitrate:
				5_000_000,
			audioBitrate:
				192_000
		}

	};


	function getQuality() {

		return (
			QUALITY_PRESETS[
				qualitySelectEl.value
			] ||
			QUALITY_PRESETS.balanced
		);

	}


	/*
	 * Length of a single slide.
	 *
	 * Minimum and maximum are both 9, so
	 * every image is on screen for exactly
	 * 9 seconds.
	 *
	 * When the audio is longer than the
	 * slideshow, the images start over from
	 * the first one until the whole track
	 * is covered.
	 */

	const SLIDE_SECONDS_MIN =
		9;


	const SLIDE_SECONDS_MAX =
		9;


	// =========================================================
	// AUDIO HELPERS
	// =========================================================

	function formatSeconds(value) {

		const total =
			Math.max(
				0,
				Math.round(value)
			);


		const minutes =
			Math.floor(
				total / 60
			);


		const seconds =
			total % 60;


		return (
			minutes +
			":" +
			String(seconds)
				.padStart(2, "0")
		);

	}


	function formatBytes(bytes) {

		if (bytes < 1024) {
			return bytes + " B";
		}


		if (bytes < 1024 * 1024) {
			return (
				Math.round(bytes / 1024) +
				" KB"
			);
		}


		return (
			(bytes / 1024 / 1024).toFixed(
				1
			) + " MB"
		);

	}


	function getAudioContext() {

		if (!audioContext) {

			const Context =
				window.AudioContext ||
				window.webkitAudioContext;


			audioContext =
				new Context();

		}


		return audioContext;

	}


	/*
	 * How long each image stays on screen.
	 *
	 * Always 9 seconds, because the minimum
	 * and the maximum are both 9.
	 */

	function getSecondsPerSlide() {

		return Math.min(
			SLIDE_SECONDS_MAX,
			Math.max(
				SLIDE_SECONDS_MIN,
				currentAudio &&
					activeSlides.length >
						0
					? currentAudio.duration /
						activeSlides.length
					: SLIDE_SECONDS_MIN
			)
		);

	}


	/*
	 * The list of images that will actually
	 * be rendered.
	 *
	 * Without audio this is just the
	 * selected slides.
	 *
	 * With audio the selected slides are
	 * repeated from the beginning as many
	 * times as needed, until every second
	 * of the track has an image under it.
	 */

		/*
		 * Seconds a slide occupies in
		 * the video: stills and GIFs
		 * take SLIDE_SECONDS_MIN, MP4
		 * clips play their full length.
	 */
	
	
	/*
	 * Seconds one slide occupies.
	 *
	 * Hardened against the two values a media element can legitimately
	 * report and that used to break the exporter:
	 *
	 *   Infinity  - a fragmented / MediaRecorder MP4 (no duration in
	 *               moov, or a moov written at the end) reports
	 *               \`duration === Infinity\` until the whole file is
	 *               buffered. \`framesForSlide()\` then returned Infinity
	 *               and the per-frame \`for (f = 0; f < frames; f++)\`
	 *               loop never ended, so the video "never finished
	 *               rendering" while the tab stayed busy forever.
	 *   NaN / <=0 - an unreadable clip. Falls back to the still-image
	 *               length instead of producing 0 or NaN frames.
	 *
	 * Both are clamped to the same one-minute cap the upload path
	 * enforces (\`MP4_MAX_DURATION_S\`), so the render length is always a
	 * finite, bounded number of frames.
	 */

	function slideDurationSec(
		slide
	) {

		const raw =

			slide &&
			slide._partialSec !=
				null

				? Number(
					slide._partialSec
				)

				: slide &&
					slide.type ===
						"mp4" &&
					Number(
						slide.duration
					) > 0

					? Number(
						slide.duration
					)

					: SLIDE_SECONDS_MIN;


		if (
			!Number.isFinite(
				raw
			) ||
			raw <= 0
		) {

			return SLIDE_SECONDS_MIN;

		}


		return Math.min(
			raw,
			MP4_MAX_DURATION_S
		);

	}
	
	
	function framesForSlide(
		slide,
		fps
	) {
	
	
		return Math.max(
			1,
			Math.round(
				fps *
				slideDurationSec(
					slide
				)
			)
		);
	
	
	}
	
	
	/*
		 * Seeks a clip to a time in
		 * seconds.
	 */
	
	
	async function seekClipTo(
		video,
		timeSec
	) {
	
	
		if (
			video.readyState >=
				2 &&
			Math.abs(
				video.currentTime -
				timeSec
			) <
				0.02
		) {
	
	
			return;
	
	
		}
	
	
		try {
	
	
			video.currentTime =
				timeSec;
	
	
			await new Promise(
				(resolve) => {
					let done =
						false;
					const finish =
						() => {
							if (!done) {
								done =
									true;
								video.removeEventListener(
									"seeked",
									finish
								);
								resolve();
							}
						};
					video.addEventListener(
						"seeked",
						finish
					);
					setTimeout(
						finish,
						2000
					);
				}
			);
	
	
		}
	
	
		catch (seekError) {
	
	
			console.error(
				"Clip seek failed:",
				seekError
			);
	
	
		}
	
	
	}
	
	
	/*
	 * =========================================================
	 * MP4 CLIP FRAME CAPTURE (bug fix: the export used to hang
	 * forever on the first MP4 slide)
	 * =========================================================
	 *
	 * The renderer used to advance a clip by awaiting
	 * \`requestVideoFrameCallback\` once per output frame, i.e. it
	 * depended on the browser really PRESENTING frames of a
	 * playing <video>. A callback is only delivered for an element
	 * that is actually being composited:
	 *
	 *   - the editor layout's clip element (\`asset.videoEl\`) is
	 *     created with createElement and never attached (the card
	 *     shows its own <video>), and the legacy gallery lives in
	 *     a display:none panel;
	 *   - a background/throttled tab presents no frames at all;
	 *   - an autoplay rejection (\`prepareClip\` only logged it)
	 *     leaves the element paused.
	 *
	 * In all three cases the callback never fired, the \`await\`
	 * never settled, and the status line froze on the last
	 * "Completed image N of M" while \`project.status\` stayed
	 * "rendering" for good - the reported "it did not finish
	 * rendering the video". Nothing threw, so the bulk queue behind
	 * it never advanced either.
	 *
	 * Capture is now bounded and has two modes:
	 *
	 *   playback - real time, exactly as before, while frames
	 *              really arrive (the fast path for a visible,
	 *              attached element);
	 *   seek     - deterministic: the clip is paused and seeked to
	 *              the exact time of the output frame. Seeking and
	 *              drawing work on hidden/detached elements, so
	 *              capture no longer depends on the compositor, on
	 *              the tab being visible or on wall-clock speed.
	 */

	const CLIP_FRAME_TIMEOUT_MS =
		500;


	const CLIP_READY_TIMEOUT_MS =
		4000;


	/*
	 * True once the element has a decoded frame that drawImage()
	 * can copy. Drawing a video with readyState < 2 throws
	 * InvalidStateError, which used to end the whole export with
	 * "Video rendering failed".
	 */

	/*
	 * Reads a clip's real length.
	 *
	 * Two things used to go wrong at upload time:
	 *
	 *   1. The probe <video> was never attached to the document and had
	 *      no deadline. A clip the browser declined to load (unsupported
	 *      codec variant, a container that needs a range request) fired
	 *      neither \`loadedmetadata\` nor \`error\`, so the upload promise
	 *      never settled: the clip never appeared in the accordion, no
	 *      error was shown, and Generate looked like it did nothing.
	 *
	 *   2. Fragmented / MediaRecorder MP4s report \`duration === Infinity\`
	 *      until the whole file is buffered. That value passed the
	 *      "longer than a minute" check (Infinity is not <= 60 either)
	 *      and reached framesForSlide(), which turned it into Infinity
	 *      frames - a \`for\` loop that never ends, i.e. exactly the
	 *      "rendering never finishes" report.
	 *
	 * So: attach the probe off-screen (some browsers will not load a
	 * detached video at all), give the load a deadline, resolve the
	 * Infinity case the standard way (seek far past the end, read the
	 * duration the element settles on), and hand the caller one honest
	 * number or an error.
	 */

	async function probeMp4Duration(
		video,
		clipURL
	) {

		video.muted =
			true;

		video.playsInline =
			true;

		video.preload =
			"auto";

		video.src =
			clipURL;


		let host =
			ensureClipCaptureHost();

		let detach =
			false;


		if (
			video.parentNode !==
			host
		) {

			try {

				host.appendChild(
					video
				);

				detach =
					true;

			}

			catch (attachError) {

				/* decode-in-place is still worth trying */

			}

		}


		try {

			await new Promise(
				(resolve, reject) => {

					let settled =
						false;

					const finish =
						(error) => {

							if (settled) {

								return;

							}

							settled =
								true;


							clearTimeout(
								timer
							);


							for (
								const name of [
									"loadedmetadata",
									"error"
								]
							) {

								video.removeEventListener(
									name,
									onMeta
								);

								video.removeEventListener(
									name,
									onError
								);

							}


							error
								? reject(
									error
								)
								: resolve();

						};

					const onMeta =
						() => finish(
							null
						);

					const onError =
						() => finish(
							new Error(
								"The clip could not be decoded."
							)
						);

					const timer =
						setTimeout(
							() => finish(
								new Error(
									"The clip took too long to load."
								)
							),
							CLIP_PROBE_TIMEOUT_MS
						);


					video.addEventListener(
						"loadedmetadata",
						onMeta,
						{
							once:
								true
						}
					);

					video.addEventListener(
						"error",
						onError,
						{
							once:
								true
						}
					);

				}
			);


			let duration =
				Number(
					video.duration
				);


			if (!Number.isFinite(duration)) {

				/*
				 * Ask the element to load the real duration by
				 * seeking past the end; it then reports the
				 * media's actual length. Bounded, because a clip
				 * that never answers is exactly what we are
				 * trying to detect.
				 */

				await new Promise(
					(resolve) => {

						let settled =
							false;

						const finish =
							() => {

								if (settled) {

									return;

								}

								settled =
									true;


								clearTimeout(
									timer
								);


								video.removeEventListener(
									"durationchange",
									finish
								);

								video.removeEventListener(
									"timeupdate",
									finish
								);

								video.removeEventListener(
									"seeked",
									finish
								);


								resolve();

							};

						const timer =
							setTimeout(
								finish,
								3000
							);


						for (
							const name of [
								"durationchange",
								"timeupdate",
								"seeked"
							]
						) {

							video.addEventListener(
								name,
								finish
							);

						}


						try {

							video.currentTime =
								1e101;

						}

						catch (seekError) {

							finish();

						}

					}
				);


				duration =
					Number(
						video.duration
					);


				try {

					video.currentTime =
						0;

				}

				catch (resetError) {

					/* the first frame still lands on 0 */

				}

			}


			if (
				!Number.isFinite(
					duration
				) ||
				duration <=
					0
			) {

				throw new Error(
					"The clip reports no usable length."
				);

			}


			return duration;

		}

		finally {

			if (detach) {

				try {

					if (
						video.parentNode ===
						host
					) {

						host.removeChild(
							video
						);

					}

				}

				catch (detachError) {

					/* nothing else to do */

				}

			}

		}

	}


	function clipHasFrame(
		video
	) {

		return Boolean(
			video &&
			video.readyState >= 2 &&
			(
				typeof video.videoWidth !==
					"number" ||
				video.videoWidth > 0
			)
		);

	}


	/*
	 * Can this slide's source be copied by drawImage() right now?
	 *
	 * Stills, GIF scratch canvases and canvas sources always can.
	 * A <video> only can once it has a decoded frame; asking it before
	 * that throws InvalidStateError, which is not a rendering failure
	 * worth losing the entire export over.
	 */

	/*
	 * Off-screen host for clip capture.
	 *
	 * \`requestVideoFrameCallback\` only fires while the browser really
	 * composites the element, and a <video> that is detached from the
	 * document (which is exactly what the editor's upload probe builds)
	 * is never composited. Without a parent the capture fell back to
	 * seeking for every single frame - correct, but several times slower
	 * - and on some browsers never presented a frame at all.
	 *
	 * The host is deliberately NOT display:none (a display:none ancestor
	 * stops presentation too): it is parked outside the viewport at
	 * 2x2 px, which keeps decoding and frame presentation active while
	 * being invisible to the user.
	 */

	const CLIP_HOST_ID =
		"clip-capture-host";

	const CLIP_PROBE_TIMEOUT_MS =
		15000;


	function ensureClipCaptureHost() {

		let host =
			document.getElementById(
				CLIP_HOST_ID
			);


		if (host) {

			return host;

		}


		host =
			document.createElement(
				"div"
			);


		host.id =
			CLIP_HOST_ID;


		host.setAttribute(
			"aria-hidden",
			"true"
		);


		host.style.cssText =
			"position:fixed;left:-10000px;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1;";


		document.body.appendChild(
			host
		);


		return host;

	}


	/*
	 * Moves a clip into the off-screen host so it can present frames
	 * while it is being captured, and returns a function that puts it
	 * back where it came from.
	 *
	 * A clip that is already connected AND has a layout box (a real
	 * preview the user can see) is left alone - it is already being
	 * composited, and moving it would interrupt the preview.
	 */

	function mountClipForCapture(
		video
	) {

		if (
			!video ||
			typeof video.play !==
				"function"
		) {

			return null;

		}


		let boxed =
			false;


		try {

			boxed =
				video.isConnected ===
					true &&
				typeof video.getClientRects ===
					"function" &&
				video.getClientRects().length >
					0;

		}

		catch (boxError) {

			boxed =
				false;

		}


		if (boxed) {

			return null;

		}


		const parent =
			video.parentNode || null;

		const nextSibling =
			video.nextSibling || null;


		try {

			ensureClipCaptureHost().appendChild(
				video
			);

		}

		catch (mountError) {

			return null;

		}


		return function restoreClip() {

			try {

				const hostNode =
					document.getElementById(
						CLIP_HOST_ID
					);


				if (
					!hostNode ||
					video.parentNode !==
						hostNode
				) {

					return;

				}


				if (parent) {

					parent.insertBefore(
						video,
						nextSibling &&
						nextSibling.parentNode ===
							parent
							? nextSibling
							: null
					);

				}

				else {

					/* Detached before the export: detach it again. */
					hostNode.removeChild(
						video
					);

				}

			}

			catch (restoreError) {

				/* the clip still decodes where it is */

			}

		};

	}


	function drawableSlideSource(
		source
	) {

		if (!source) {

			return false;

		}


		if (
			typeof HTMLVideoElement !==
				"undefined" &&
			source instanceof
				HTMLVideoElement
		) {

			return clipHasFrame(
				source
			);

		}


		return true;

	}


	/*
	 * Waits (bounded) until the clip can be drawn, then returns
	 * that answer instead of throwing.
	 */

	async function waitForClipFrame(
		video
	) {

		if (
			!video ||
			clipHasFrame(
				video
			)
		) {

			return clipHasFrame(
				video
			);

		}

		return await new Promise(
			(resolve) => {

				let done =
					false;

				const finish =
					(ok) => {

						if (done) {

							return;

						}

						done =
							true;

						for (
							const name of [
								"loadeddata",
								"canplay",
								"seeked"
							]
						) {

							try {

								video.removeEventListener(
									name,
									onReady
								);

							}
							catch (listenerError) {
								/* detached element */
							}

						}

						resolve(
							ok ===
								true &&
								clipHasFrame(
									video
								)
						);

					};

				const onReady =
					() => finish(
						true
					);

				for (
					const name of [
						"loadeddata",
						"canplay",
						"seeked"
					]
				) {

					try {

						video.addEventListener(
							name,
							onReady
						);

					}
					catch (listenerError) {
						/* detached element */
					}

				}

				setTimeout(
					() => finish(
						clipHasFrame(
							video
						)
					),
					CLIP_READY_TIMEOUT_MS
				);

			}
		);

	}


	/*
	 * Waits for the next PRESENTED frame of a playing clip.
	 *
	 * Returns true when a frame really arrived, false when the
	 * deadline passed (hidden element / background tab / paused
	 * clip). It never waits indefinitely.
	 */

	async function nextClipFrame(
		video,
		timeoutMs
	) {

		const deadline =
			Math.max(
				50,
				Number(timeoutMs) ||
					CLIP_FRAME_TIMEOUT_MS
			);


		if (
			typeof video.requestVideoFrameCallback ===
				"function"
		) {

			return await new Promise(
				(resolve) => {

					let done =
						false;

					const finish =
						(ok) => {

							if (done) {

								return;

							}

							done =
								true;

							resolve(
								ok ===
									true
							);

						};

					const timer =
						setTimeout(
							() => finish(
								false
							),
							deadline
						);

					try {

						video.requestVideoFrameCallback(
							() => {

								clearTimeout(
									timer
								);

								finish(
									true
								);

							}
						);

					}
					catch (callbackError) {

						clearTimeout(
							timer
						);

						finish(
							false
						);

					}

				}
			);

		}


		/*
		 * Older browser: no presentation callback exists, so pace
		 * the capture ourselves and report "arrived" only while
		 * the element actually advances.
		 */

		const before =
			Number(
				video.currentTime
			) || 0;

		await new Promise(
			(resolve) =>
				setTimeout(
					resolve,
					34
				)
		);

		return (
			video.paused ===
				false ||
			(
				Number(
					video.currentTime
				) || 0
			) !==
				before
		);

	}


	/*
	 * Deterministic capture: park the clip on one exact time.
	 * Used for every frame once playback stops presenting frames,
	 * and as the fallback when play() itself was rejected.
	 */

	async function captureClipFrameAt(
		video,
		timeSec,
		durationSec
	) {

		const reported =
			Number(
				video.duration
			);

		const limit =
			Number.isFinite(
				reported
			) &&
			reported > 0

				? reported

				: Number.isFinite(
					durationSec
				) &&
					durationSec > 0

					? durationSec

					: 0;

		const requested =
			Number(
				timeSec
			);

		let target =
			Number.isFinite(
				requested
			) &&
			requested > 0

				? requested

				: 0;


		if (limit > 0) {

			target =
				Math.min(
					target,
					Math.max(
						0,
						limit -
							0.001
					)
				);

		}


		await seekClipTo(
			video,
			target
		);

	}


	/*
	 * Restarts a clip silently for frame capture.
	 *
	 * Returns true when the clip can be drawn afterwards. A
	 * rejected play() (autoplay policy, detached element) is not
	 * fatal any more: the caller switches that slide to seek-based
	 * capture instead of waiting for frames that never come.
	 */

	async function mediaDeadline(work, milliseconds, message) {
		let timer = null;
		try {
			return await Promise.race([work, new Promise(function (_, reject) {
				timer = setTimeout(function () { reject(new Error(message)); }, milliseconds);
			})]);
		} finally { if (timer) clearTimeout(timer); }
	}

	async function prepareClip(
		video
	) {


		try {


			video.pause();


			await seekClipTo(
				video,
				0
			);


			video.muted =
				true;


			await mediaDeadline(video.play(), 5000, "Clip playback did not start; switching to seek capture.");


			await waitForClipFrame(
				video
			);


			return clipHasFrame(
				video
			);


		}


		catch (playError) {
			video.pause();


			console.error(
				"Clip play failed:",
				playError
			);


			return await waitForClipFrame(
				video
			);


		}


	}
		function getSlideSequence() {
	
	
		if (
			!currentAudio ||
			activeSlides.length ===
				0
		) {
	
	
			return activeSlides.slice();
	
	
		}
	
	
		/*
			 * The silent video repeats until
			 * it covers the audio. The last
			 * slide is trimmed so the video
			 * ends with the audio.
		 */
	
	
		const sequence =
			[];
	
	
		let totalSeconds =
			0;
	
	
		let index =
			0;
	
	
		let guard =
			0;
	
	
		while (
			totalSeconds <
				currentAudio.duration -
					0.05
			&&
			guard <
				10000
		) {
	
	
			const base =
				activeSlides[
					index %
					activeSlides.length
				];
	
	
			const slideSeconds =
				slideDurationSec(
					base
				);
	
	
			const remaining =
				currentAudio.duration -
				totalSeconds;
	
	
			if (
				remaining <
				slideSeconds -
					0.05
			) {
	
	
				const trimmed =
					Object.assign(
						{},
						base
					);
	
	
				trimmed._partialSec =
					remaining;
	
	
				sequence.push(
					trimmed
				);
	
	
				totalSeconds =
					currentAudio.duration;
	
	
			}
	
	
			else {
	
	
				sequence.push(
					base
				);
	
	
				totalSeconds +=
					slideSeconds;
	
	
			}
	
	
			index++;
	
	
			guard++;
	
	
		}
	
	
		return sequence;
	
	}


	function updateDurationEstimate() {
	
	
		/*
			 * One pass of the silent video.
			 * With audio the video repeats to
			 * cover it, so the finished length
			 * is the audio length.
		 */
	
	
		const passSeconds =
			activeSlides.reduce(
				(sum, slide) =>
					sum +
					slideDurationSec(
						slide
					),
				0
			);
	
	
		const totalSeconds =
			currentAudio
			? currentAudio.duration
			: passSeconds;
	
	
		estimateValueEl.textContent =
			formatSeconds(
				totalSeconds
			) +
			" (" +
			totalSeconds.toFixed(1) +
			"s)";
	
	
		if (
			currentAudio &&
			activeSlides.length >
				0
		) {
	
	
			estimateSourceEl.textContent =
				"(video repeats to cover the " +
				formatSeconds(
					currentAudio.duration
				) +
				" audio)";
	
	
		}
		else {
	
	
			estimateSourceEl.textContent =
				"(9s per image or GIF \u00b7 MP4 clips play in full)";
	
	
		}


		/*
		 * Rough output size so the user can
		 * see the memory cost before hitting
		 * the render button.
		 */

		const quality =
			getQuality();


		const audioBitrate =
			currentAudio
				? quality.audioBitrate
				: 0;


		const bytes =
			(totalSeconds *
				(
					quality.videoBitrate +
					audioBitrate
				)) /
			8;


		estimateSizeEl.textContent =
			"\u00b7 approx. " +
			formatBytes(bytes) +
			" file";

	}


	// =========================================================
	// MP3 UPLOAD + DECODE
	// =========================================================

	audioUploadEl.addEventListener(
		"change",
		async (event) => {

			const file =
				event.target.files &&
				event.target.files[0];


			/*
			 * Allows the same file to be
			 * selected again later.
			 */

			event.target.value =
				"";


			if (!file) {
				return;
			}


			try {

				const arrayBuffer =
					await file.arrayBuffer();


				const context =
					getAudioContext();


				/*
				 * slice(0) is required because
				 * decodeAudioData detaches the
				 * ArrayBuffer it is given.
				 */

				const decoded =
					await context.decodeAudioData(
						arrayBuffer.slice(0)
					);


				/*
				 * Release the previous preview
				 * URL before replacing it.
				 */

				if (
					currentAudio &&
					currentAudio.url
				) {

					releaseStudioObjectUrl(
						currentAudio.url
					);

				}


				currentAudio = {

					name:
						file.name,

					duration:
						decoded.duration,

					buffer:
						decoded,

					url:
						createStudioObjectUrl(
							file
						)

				};


				audioNameEl.textContent =
					"";


				audioNameEl.appendChild(
					document.createTextNode(
						file.name + "  "
					)
				);


				const durationSpan =
					document.createElement(
						"span"
					);


				durationSpan.textContent =
					formatSeconds(
						decoded.duration
					);


				audioNameEl.appendChild(
					durationSpan
				);


				audioPreviewEl.src =
					currentAudio.url;


				audioDetailsEl.style.display =
					"flex";


				audioEmptyEl.style.display =
					"none";


				updateDurationEstimate();

			}
			catch (error) {

				console.error(
					"Audio decode failed:",
					error
				);


				alert(
					"Could not read that audio file. Please upload a valid MP3."
				);

			}

		}
	);


	// =========================================================
	// REMOVE AUDIO
	// =========================================================

	/*
	 * Changing quality changes the
	 * estimated file size.
	 */

	qualitySelectEl.addEventListener(
		"change",
		updateDurationEstimate
	);


	function removeAudio() {

		if (
			currentAudio &&
			currentAudio.url
		) {

			releaseStudioObjectUrl(
				currentAudio.url
			);

		}


		currentAudio =
			null;


		audioPreviewEl.pause();

		audioPreviewEl.removeAttribute(
			"src"
		);

		audioPreviewEl.load();


		audioDetailsEl.style.display =
			"none";


		audioEmptyEl.style.display =
			"block";


		updateDurationEstimate();

	}


	// =========================================================
	// CREATE AI CARDS
	// =========================================================

	prompts.forEach(
		(prompt, index) => {

			const card =
				document.createElement(
					"div"
				);


			card.className =
				"card";


			card.id =
				\`card-\${index}\`;


			card.innerHTML = \`

				<div
					class="image-container"
					id="container-\${index}"
				>

					<div class="loading">

						<div class="spinner"></div>

						Generating AI Scene
						\${index + 1}...

					</div>

				</div>


				<div
					class="prompt"
					title="\${escapeHTML(prompt)}"
				>

					\${index + 1}.
					\${escapeHTML(prompt)}

				</div>


				<div class="card-actions">

					<span
						style="
							font-size:0.75rem;
							color:#6b7280;
						"
					>
						Pixabay stock
					</span>


					<button
						class="toggle-btn"
						id="btn-\${index}"
						disabled
						onclick="toggleSlide(\${index})"
					>
						Loading...
					</button>

				</div>

			\`;


			gallery.appendChild(
				card
			);

		}
	);


	// =========================================================
	// FETCH AI IMAGE
	// =========================================================

	async function fetchAIImage(index) {

		const container =
			document.getElementById(
				\`container-\${index}\`
			);


		const btn =
			document.getElementById(
				\`btn-\${index}\`
			);


		const card =
			document.getElementById(
				\`card-\${index}\`
			);

		/*
		 * The legacy top-of-page
		 * image slots were removed,
		 * so there is nowhere to
		 * show these images: skip
		 * the generation (no wasted
		 * AI calls, no uncaught
		 * errors).
		 */
		if (
			!container ||
			!btn ||
			!card
		) {

			return;

		}

		try {

			const response =
				await fetch(
					\`/image/\${index}\`
				);


			if (!response.ok) {

				throw new Error(
					"Image generation failed"
				);

			}


			const blob =
				await response.blob();


			const imageURL =
				createStudioObjectUrl(
					blob
				);


			const img =
				new Image();


			img.src =
				imageURL;


			await img.decode();


			container.innerHTML =
				"";


			container.appendChild(
				img
			);


			activeSlides.push({

				id:
					\`ai-\${index}\`,

				img:
					img,

				cardId:
					\`card-\${index}\`

			});


			card.classList.add(
				"in-video"
			);


			btn.textContent =
				"Remove from Video";


			btn.disabled =
				false;


			updateQueueCount();

		}
		catch (error) {

			console.error(
				error
			);


			container.innerHTML = \`

				<div
					style="
						color:#ef4444;
						font-size:0.8rem;
					"
				>
					Generation Failed
				</div>

			\`;

		}

	}


	/* The legacy demo image routes were removed; do not request them on
	 * page load. The active studio uses Pixabay search instead. */


	// =========================================================
	// CUSTOM IMAGE UPLOAD
	// =========================================================

	document
		.getElementById(
			"file-upload"
		)
		.addEventListener(
			"change",
			async (event) => {

				const files =
					Array.from(
						event.target.files
					);


				/*
				 * Process uploads one at a time.
				 *
				 * This prevents multiple large images
				 * from being decoded simultaneously.
				 */

				for (
					const file of files
				) {

					/*
						 * Upload limits: at most
						 * MAX_GIF_UPLOADS GIFs and
						 * MAX_IMAGE_UPLOADS still
						 * images.
					 */


					const fileIsGif =
						file.type ===
							"image/gif" ||
							/\.gif$/i.test(
								file.name
							);


					const uploadedGifs =
						activeSlides.filter(
							(slide) =>
								slide.type ===
									"gif"
						).length;


					const uploadedImages =
						activeSlides.filter(
							(slide) =>
								slide.id &&
									!slide.type &&
									slide.id.startsWith(
										"custom"
								)
						).length;


					if (
						fileIsGif &&
						uploadedGifs >=
							MAX_GIF_UPLOADS
					) {


						alert(
							"You can add at most " +
								MAX_GIF_UPLOADS +
								" GIFs."
						);


						break;


					}


					const fileIsMp4 =
						file.type ===
							"video/mp4" ||
							/\\.(mp4|m4v)$/i.test(
								file.name
							);

					if (
						!fileIsGif &&
						!fileIsMp4 &&
						uploadedImages >=
							MAX_IMAGE_UPLOADS
					) {


						alert(
							"You can add at most " +
								MAX_IMAGE_UPLOADS +
								" images (jpg, png, jpeg)."
						);


						break;


					}
					const uploadedMp4s =
						activeSlides.filter(
							(slide) =>
								slide.type ===
									"mp4"
						).length;


					if (
						fileIsMp4 &&
						uploadedMp4s >=
							MAX_MP4_UPLOADS
					) {


						alert(
							"You can add at most " +
								MAX_MP4_UPLOADS +
								" MP4 clips."
						);


						break;


					}
					try {

						const imageURL =
							createStudioObjectUrl(
								file
							);


						const img =
							new Image();


						img.src =
							imageURL;


						/*
							 * MP4 clips are probed with a
							 * video element instead of
							 * being decoded as images.
						 */


						let clipVideo =
							null;


						let clipDuration =
							0;


						if (fileIsMp4) {


							const probed =
								document.createElement(
									"video"
								);


							probed.muted =
								true;


							probed.playsInline =
								true;


							probed.src =
								imageURL;


							await new Promise(
								(resolve, reject) => {
									probed.addEventListener(
										"loadedmetadata",
										resolve,
										{
											once:
												true
										}
									);


									probed.addEventListener(
										"error",
										reject,
										{
											once:
												true
										}
									);
								}
							);


							clipDuration =
								probed.duration;


							if (
								clipDuration >
									MP4_MAX_DURATION_S
							) {


								alert(
									"'" +
										file.name +
										"' is " +
										formatSeconds(
											clipDuration
										) +
										" long. Each MP4 clip must be at most " +
										formatSeconds(
											MP4_MAX_DURATION_S
										) +
										"."
								);


								releaseStudioObjectUrl(
									imageURL
								);


								continue;


							}


							clipVideo =
								probed;


						}
						else {


							await img.decode();


						}


						const customId =
							"custom-" +
							Date.now() +
							"-" +
							Math.random()
								.toString(36)
								.substring(2);


						const card =
							document.createElement(
								"div"
							);


						card.className =
							"card in-video";


						card.id =
							customId;


						card.innerHTML = \`

							<div class="badge">
								Custom Upload
							</div>


							<div
								class="image-container"
							>

								<img
									src="\${imageURL}"
								>

							</div>


							<div class="prompt">

								\${escapeHTML(
									file.name
								)}

							</div>


							<div class="card-actions">

								<span
									style="
										font-size:0.75rem;
										color:#10b981;
									"
								>
									Ready
								</span>


								<button
									class="toggle-btn"
									onclick="removeCustomSlide(
										'\${customId}'
									)"
								>
									Remove
								</button>

							</div>

						\`;


						gallery.prepend(
							card
						);


						/*
						 * Build the slide entry first so GIFs can
						 * attach their decoded animation frames
						 * to it.
						 */

						const slideEntry =
							{
								id:
									customId,

								img:
									img,

								cardId:
									customId

							};


						/*
						 * GIFs are decoded frame by frame, so the
						 * MP4 contains the full animation instead
						 * of only the first frame.
						 */

						/*
							 * MP4 clips get a video
							 * preview and play silently
							 * in the export.
						 */


						if (fileIsMp4) {


							const videoContainer =
								card.querySelector(
									".image-container"
								);


							videoContainer.innerHTML =
								"";


							clipVideo.loop =
								true;


							clipVideo.autoplay =
								true;


							videoContainer.appendChild(
								clipVideo
							);


							const videoBadge =
								card.querySelector(
									".badge"
								);


							if (videoBadge) {


								videoBadge.textContent =
									"MP4";


							}


							const videoPrompt =
								card.querySelector(
									".prompt"
								);


							if (videoPrompt) {


								videoPrompt.textContent =
									file.name +
									"  |  " +
									formatSeconds(
										clipDuration
									) +
									" clip";


							}


							slideEntry.type =
								"mp4";


							slideEntry.videoEl =
								clipVideo;


							slideEntry.duration =
								clipDuration;


							slideEntry.img =
								clipVideo;


						}

						if (
							file.type ===
								"image/gif" ||
							/\.gif$/i.test(
								file.name
							)
						) {

							try {

								const buffer =
									await file.arrayBuffer();


								slideEntry.type =
									"gif";


								slideEntry.gif =
									buildGifSlideFrames(
										parseGifBytes(
											new Uint8Array(
												buffer
											)
										)
									);


								const badgeEl =
									card.querySelector(
										".badge"
									);


								if (badgeEl) {

									badgeEl.textContent =
										"GIF";

								}


								const promptEl =
									card.querySelector(
										".prompt"
									);


								if (promptEl) {

									promptEl.textContent =
										file.name +
										"  |  " +
										slideEntry.gif.frameCount +
										" frames, " +
										(slideEntry.gif.loopMs / 1000).toFixed(
											1
										) +
										"s loop";

								}

							}
							catch (gifError) {

								console.error(
									"GIF decode failed:",
									gifError
								);


								alert(
									"Could not decode that GIF animation. It was added as a still image instead."
								);

							}

						}


						activeSlides.unshift(
							slideEntry
						);


						updateQueueCount();

					}
					catch (error) {

						console.error(
							"Upload error:",
							error
						);

					}

				}


				/*
				 * Allows the same file to be
				 * selected again later.
				 */

				event.target.value =
					"";

			}
		);


	// =========================================================
	// HTML ESCAPE
	// =========================================================

	function escapeHTML(value) {

		return String(value)

			.replaceAll(
				"&",
				"&amp;"
			)

			.replaceAll(
				"<",
				"&lt;"
			)

			.replaceAll(
				">",
				"&gt;"
			)

			.replaceAll(
				'"',
				"&quot;"
			)

			.replaceAll(
				"'",
				"&#039;"
			);

	}


	// =========================================================
	// TOGGLE AI SLIDE
	// =========================================================

	function toggleSlide(index) {

		const cardId =
			\`card-\${index}\`;


		const card =
			document.getElementById(
				cardId
			);


		const btn =
			document.getElementById(
				\`btn-\${index}\`
			);


		const existingIndex =
			activeSlides.findIndex(
				s =>
					s.cardId ===
					cardId
			);


		if (
			existingIndex > -1
		) {

			activeSlides.splice(
				existingIndex,
				1
			);


			card.classList.remove(
				"in-video"
			);


			btn.textContent =
				"Add to Video";

		}
		else {

			const img =
				card.querySelector(
					"img"
				);


			if (!img) {
				return;
			}


			activeSlides.push({

				id:
					\`ai-\${index}\`,

				img:
					img,

				cardId:
					cardId

			});


			card.classList.add(
				"in-video"
			);


			btn.textContent =
				"Remove from Video";

		}


		updateQueueCount();

	}


	// =========================================================
	// REMOVE CUSTOM SLIDE
	// =========================================================

	function removeCustomSlide(id) {

		const index =
			activeSlides.findIndex(
				s =>
					s.id === id
			);


		if (
			index > -1
		) {

			const slide =
				activeSlides[index];


			/*
			 * Release browser memory
			 * for uploaded image.
			 */

			if (
				slide.img &&
				slide.img.src.startsWith(
					"blob:"
				)
			) {

				releaseStudioObjectUrl(
					slide.img.src
				);

			}


			activeSlides.splice(
				index,
				1
			);

		}


		const element =
			document.getElementById(
				id
			);


		if (element) {
			element.remove();
		}


		updateQueueCount();

	}


	// =========================================================
	// UPDATE QUEUE COUNT
	// =========================================================

	function updateQueueCount() {

		/*
		 * Slide timing depends on the
		 * number of images when audio
		 * is present.
		 */

		updateDurationEstimate();

	}


	// =========================================================
	// FILL ONE BLOCK OF PCM
	// =========================================================

	/*
	 * Fills a single small block of
	 * interleaved 16-bit PCM, which is the
	 * format WebCodecs AudioData accepts
	 * as "s16".
	 *
	 * Audio longer than the video is cut.
	 *
	 * If the video runs longer than the
	 * track, the remainder is silence,
	 * because the images are the part that
	 * repeats, not the audio.
	 *
	 * Blocks are filled one at a time so a
	 * long soundtrack never has to exist
	 * in memory all at once.
	 */

	function fillPCMBlock(

		channels,

		sourceFrames,

		block,

		startFrame,

		frames,

		numberOfChannels

	) {

		for (
			let i = 0;
			i < frames;
			i++
		) {

			const frameIndex =
				startFrame +
				i;


			/*
			 * Once past the end of the track
			 * the block is filled with
			 * silence.
			 */

			const finished =
				frameIndex >=
				sourceFrames;


			for (
				let c = 0;
				c < numberOfChannels;
				c++
			) {

				let value =
					0;


				if (!finished) {

					const channel =
						Math.min(
							c,
							channels.length -
								1
						);


					value =
						channels[channel][
							frameIndex
						];


					/*
					 * Clamp before converting
					 * to integer samples.
					 */

					if (value > 1) {
						value = 1;
					}
					else if (
						value < -1
					) {
						value = -1;
					}

				}


				block[
					i * numberOfChannels + c
				] =
					value < 0
						? value * 0x8000
						: value * 0x7fff;

			}

		}

	}


	// =========================================================
	// ENCODE MP3 -> AAC
	// =========================================================

	/*
	 * Decodes are already done. This converts
	 * the AudioBuffer into AAC chunks that
	 * mp4-muxer can write into the MP4.
	 *
	 * Returns the chunk list plus the track
	 * settings needed by the muxer.
	 */

	async function encodeAudioTrack(
		audioBuffer,
		targetSeconds,
		bitrate,
		onProgress
	) {

		const sampleRate =
			audioBuffer.sampleRate;


		/*
		 * AAC supports up to 2 channels.
		 */

		const numberOfChannels =
			Math.min(
				2,
				audioBuffer.numberOfChannels
			);


		/*
		 * AAC works on 1024 sample blocks.
		 */

		const FRAMES_PER_CHUNK =
			1024;


		const sourceChannels =
			[];


		for (
			let c = 0;
			c < audioBuffer.numberOfChannels;
			c++
		) {

			sourceChannels.push(
				audioBuffer.getChannelData(
					c
				)
			);

		}


		const sourceFrames =
			audioBuffer.length;


		const totalFrames =
			Math.max(
				1,
				Math.round(
					targetSeconds *
						sampleRate
				)
			);


		/*
		 * One reused block.
		 *
		 * Only 1024 frames are alive at any
		 * moment instead of an entire
		 * multi-minute track.
		 */

		const block =
			new Int16Array(
				FRAMES_PER_CHUNK *
					numberOfChannels
			);


		const chunks = [];


		/*
		 * Timestamps of the chunks, in the
		 * order they were encoded, so each
		 * encoded chunk can be matched with
		 * the position it belongs to.
		 */

		const pendingTimestamps =
			[];


		let encoderError =
			null;


		const audioConfig = { codec: "mp4a.40.2", sampleRate: sampleRate, numberOfChannels: numberOfChannels, bitrate: bitrate };
		if (typeof AudioEncoder.isConfigSupported === "function") {
			const support = await mediaDeadline(AudioEncoder.isConfigSupported(audioConfig), 5000, "Audio codec check timed out.");
			if (!support.supported) throw new Error("This browser cannot encode AAC audio. Rendering a silent video instead.");
		}

		const audioEncoder =
			new AudioEncoder({

				output:
					(chunk, meta) => {

						const timestamp =
							pendingTimestamps
								.length
								? pendingTimestamps.shift()
								: 0;


						chunks.push({
							chunk:
								chunk,
							meta:
								meta,
							timestamp:
								timestamp
						});

					},


				error:
					(error) => {

						console.error(
							"AudioEncoder error:",
							error
						);


						encoderError =
							error;

					}

			});



		let offset =
			0;


		let timestamp =
			0;


		try {
			audioEncoder.configure(audioConfig);



			while (
				offset < totalFrames
			) {

				const frames =
					Math.min(
						FRAMES_PER_CHUNK,
						totalFrames -
							offset
					);


				/*
				 * Fill the reused block with
				 * the audio that belongs at
				 * this position of the track.
				 */

				fillPCMBlock(
					sourceChannels,
					sourceFrames,
					block,
					offset,
					frames,
					numberOfChannels
				);


				/*
				 * slice() hands WebCodecs its
				 * own copy, sized to the exact
				 * number of frames.
				 */

				const chunkData =
					block.slice(
						0,
						frames *
							numberOfChannels
					);


				const audioData =
					new AudioData({

						format:
							"s16",

						sampleRate:
							sampleRate,

						numberOfFrames:
							frames,

						numberOfChannels:
							numberOfChannels,

						timestamp:
							timestamp,

						data:
							chunkData

					});


				pendingTimestamps.push(
					timestamp
				);


				audioEncoder.encode(
					audioData
				);


				audioData.close();


				offset +=
					frames;


				timestamp +=
					Math.round(
						(frames *
							1_000_000) /
							sampleRate
					);


				/*
				 * Backpressure.
				 */

				const audioWaitStarted = Date.now();
				while (
					audioEncoder.encodeQueueSize >
					40
				) {
					if (encoderError) throw encoderError;
					if (audioEncoder.state === "closed" || Date.now() - audioWaitStarted > 15000) {
						throw new Error("The audio encoder stopped accepting samples. Rendering a silent video instead.");
					}

					await new Promise(
						resolve =>
							setTimeout(
								resolve,
								8
							)
					);

				}


				if (encoderError) {
					throw encoderError;
				}


				if (
					onProgress &&
					offset %
						(FRAMES_PER_CHUNK *
							25) ===
						0
				) {

					onProgress(
						offset /
							totalFrames
					);

				}


				/*
				 * Keep the page responsive.
				 */

				if (
					offset %
						(FRAMES_PER_CHUNK *
							25) ===
						0
				) {

					await new Promise(
						resolve =>
							setTimeout(
								resolve,
								0
							)
					);

				}

			}


			if (onProgress) {
				onProgress(1);
			}


			let audioFlushTimer = null;
			try {
				await Promise.race([
					audioEncoder.flush(),
					new Promise(function (_, reject) {
						audioFlushTimer = setTimeout(function () {
							reject(new Error("Finalizing audio took longer than 30 seconds. Rendering a silent video instead."));
						}, 30000);
					})
				]);
			} finally { if (audioFlushTimer) clearTimeout(audioFlushTimer); }


			if (encoderError) {
				throw encoderError;
			}

		}
		finally {

			if (
				audioEncoder.state !==
				"closed"
			) {

				try {

					audioEncoder.close();

				}
				catch (error) {

					console.warn(
						"Audio encoder cleanup error:",
						error
					);

				}

			}

		}


		return {

			chunks:
				chunks,

			sampleRate:
				sampleRate,

			numberOfChannels:
				numberOfChannels

		};

	}


	// =========================================================
	// TITLE OVERLAY
	// =========================================================

	/*
	 * A web font must be loaded before
	 * canvas can draw with it, otherwise
	 * the frame silently falls back to a
	 * default font.
	 */

	async function loadTitleFont() {

		const text =
			titleInputEl.value.trim();


		if (
			!text ||
			!document.fonts ||
			!document.fonts.load
		) {

			return;

		}


		const font =
			getTitleFont();


		try {

			await document.fonts.load(
				"bold " +
					TITLE_FONT_SIZE +
					'px "' +
					font.loadName +
					'"'
			);


			await document.fonts.ready;

		}
		catch (error) {

			console.warn(
				"Font load failed:",
				error
			);

		}

	}


	/*
	 * Draws the title onto the current
	 * frame, top left.
	 *
	 * Plain text only: no background box,
	 * no highlight, no shadow.
	 */

	function drawTitle(context) {

		const text =
			titleInputEl.value.trim();


		if (!text) {
			return;
		}


		context.save();


		context.font =
			"bold " +
			TITLE_FONT_SIZE +
			"px " +
			getTitleFont().stack;


		context.textAlign =
			"left";


		context.textBaseline =
			"top";


		/*
		 * White, black or green.
		 */

		const colour =
			titleColorEl.value;


		context.fillStyle =
			colour === "black"
				? "#000000"
				: colour === "green"
					? "#22c55e"
					: "#ffffff";


		context.fillText(
			text,
			TITLE_MARGIN,
			TITLE_MARGIN
		);


		context.restore();

	}


	// =========================================================
	// GIF DECODER + FRAME COMPOSITOR
	// =========================================================

	/*
	 * A small self-contained GIF87a/89a decoder.
	 *
	 * It parses the file, decodes the LZW image data and
	 * composes every frame (including disposal methods and
	 * interlacing) into ready-to-draw ImageData objects.
	 *
	 * The result is played back frame by frame while the MP4
	 * is rendered, so a playing GIF becomes part of the
	 * exported video exactly like the still images.
	 */

	/*
	 * GIF LZW decompression.
	 *
	 * data        : concatenated image data sub-block bytes
	 * minCodeSize : first byte after the (local) colour table
	 * totalPixels : frame width * frame height
	 *
	 * Returns a Uint8Array of palette indices.
	 */

	function gifLzwDecode(
		data,
		minCodeSize,
		totalPixels
	) {

		const clearCode =
			1 << minCodeSize;


		const endCode =
			clearCode + 1;


		let codeSize =
			minCodeSize + 1;


		let nextCode =
			endCode + 1;


		/*
		 * Base codes (below clearCode) are literal pixel
		 * indices, so the table only needs entries from
		 * clearCode up.
		 */

		const table =
			new Array(
				4096
			);


		const out =
			new Uint8Array(
				totalPixels
			);


		let outPos =
			0;


		let cache =
			0;


		let cacheBits =
			0;


		let bytePos =
			0;


		function resetTable() {

			nextCode =
				endCode + 1;


			codeSize =
				minCodeSize + 1;

		}


		function readCode() {

			while (
				cacheBits <
					codeSize
			) {

				if (
					bytePos >=
						data.length
				) {

					return -1;

				}


				cache |=
					data[bytePos] <<
						cacheBits;


				bytePos++;


				cacheBits +=
					8;

			}


			const code =
				cache &
				((1 << codeSize) - 1);


			cache >>>=
				codeSize;


			cacheBits -=
				codeSize;


			return code;

		}


		function emit(
			seq
		) {

			for (
				let i = 0;
				i < seq.length;
				i++
			) {

				if (
					outPos >=
						totalPixels
				) {

					return;

				}


				out[outPos++] =
					seq[i];

			}

		}


		let code =
			readCode();


		if (code < 0) {
			throw new Error(
				"Empty GIF image data"
			);
		}


		if (code === clearCode) {
			code = readCode();
		}


		if (
			code < 0 ||
			code === endCode
		) {

			return out;

		}


		if (code >= clearCode) {
			throw new Error(
				"Corrupt GIF LZW stream"
			);
		}


		resetTable();


		let prev =
			[code];


		emit(
			prev
		);


		while (
			outPos <
				totalPixels
		) {

			code =
				readCode();


			if (code < 0) {
				break;
			}


			if (
				code ===
					clearCode
			) {

				/*
				 * Mid-stream clear: reset, then skip
				 * any further consecutive clears.
				 */

				do {

					resetTable();


					code =
						readCode();

				}
				while (
					code ===
						clearCode
				);


				if (
					code < 0 ||
					code ===
						endCode
				) {

					break;

				}


				if (
					code >=
						clearCode
				) {

					throw new Error(
						"Corrupt GIF LZW stream"
					);

				}


				prev =
					[code];


				emit(
					prev
				);


				continue;

			}


			if (
				code ===
					endCode
			) {

				break;

			}


			let seq;


			if (
				code <
					clearCode
			) {

				seq =
					[code];

			}
			else if (
				code <
					nextCode
			) {

				seq =
					table[code];

			}
			else if (
				code ===
					nextCode
			) {

				/*
				 * The KwKwK case: the encoder
				 * references the very code that
				 * is about to be added.
				 */

				seq =
					prev.concat(
						prev[0]
					);

			}


			if (!seq) {
				throw new Error(
					"Corrupt GIF LZW stream"
				);
			}


			if (
				nextCode <
					4096
			) {

				table[nextCode] =
					prev.concat(
						seq[0]
					);


				nextCode++;


				if (
					nextCode ===
						(1 << codeSize) &&
					codeSize <
						12
				) {

					codeSize++;

				}

			}


			emit(
				seq
			);


			prev =
				seq;

		}


		return out;

	}


	/*
	 * Reorders the rows of an interlaced frame.
	 *
	 * Interlaced GIFs store their rows in four passes:
	 * rows 0,8,16... then 4,12,20... then 2,6,10... then
	 * 1,3,5...
	 */

	function gifDeinterlace(
		pixels,
		width,
		height
	) {

		const out =
			new Uint8Array(
				pixels.length
			);


		const starts =
			[0, 4, 2, 1];


		const steps =
			[8, 8, 4, 2];


		let passRow =
			0;


		for (
			let pass = 0;
			pass < 4;
			pass++
		) {

			for (
				let row =
					starts[pass];
				row < height;
				row += steps[pass]
			) {

				out.set(
					pixels.subarray(
						passRow * width,
						(passRow + 1) * width
					),
					row * width
				);


				passRow++;

			}

		}


		return out;

	}


	/*
	 * Parses a GIF file into its frames.
	 *
	 * Returns
	 *   {
	 *     width, height,   // logical screen size
	 *     frames: [
	 *       {
	 *         left, top, width, height,
	 *         delayMs,
	 *         disposal,          // 0-3
	 *         transparent,       // boolean
	 *         transparentIndex,  // -1 when none
	 *         palette,           // [ [r,g,b], ... ]
	 *         pixels              // Uint8Array of indices
	 *       },
	 *       ...
	 *     ]
	 *   }
	 */

	function parseGifBytes(
		bytes
	) {

		if (
			bytes.length <
				13
		) {

			throw new Error(
				"File is too small to be a GIF"
			);

		}


		if (
			bytes[0] !== 0x47 ||
			bytes[1] !== 0x49 ||
			bytes[2] !== 0x46
		) {

			throw new Error(
				"Not a GIF file"
			);

		}


		const width =
			bytes[6] |
			(bytes[7] << 8);


		const height =
			bytes[8] |
			(bytes[9] << 8);


		const screenPacked =
			bytes[10];


		const hasGct =
			(screenPacked & 0x80) !== 0;


		const gctEntries =
			2 << (screenPacked & 0x07);


		let offset =
			13;


		const globalPalette =
			[];


		if (hasGct) {

			for (
				let i = 0;
				i < gctEntries;
				i++
			) {

				globalPalette.push(
					[
						bytes[offset],
						bytes[offset + 1],
						bytes[offset + 2]
					]
				);


				offset +=
					3;

			}

		}


		const frames =
			[];


		let pending =
			null;


		while (
			offset <
				bytes.length
		) {

			const block =
				bytes[offset];


			offset++;


			/*
			 * Trailer.
			 */

			if (block === 0x3B) {
				break;
			}


			/*
			 * Extension block.
			 */

			if (block === 0x21) {

				const label =
					bytes[offset];


				offset++;


				if (
					label ===
						0xF9
				) {

					/*
					 * Graphic control extension.
					 */

					const subLength =
						bytes[offset];


					offset++;


					const gcePacked =
						bytes[offset];


					const delayCs =
						bytes[offset + 1] |
						(bytes[offset + 2] << 8);


					const transparentIndex =
						bytes[offset + 3];


					offset +=
						subLength;


					/*
					 * A delay of 0 is invalid;
					 * viewers use 10 cs (100ms).
					 */

					pending =
						{
							disposal:
							(gcePacked >> 2) & 0x07,

							delayMs:
							(delayCs || 10) * 10,

							transparent:
							(gcePacked & 0x01) !== 0,

							transparentIndex:
								transparentIndex
						};


					offset++;

				}
				else {

					/*
					 * Comment, application (loop) or
					 * plain text extension: skip all
					 * of its sub-blocks.
					 */

					let subLength;


					do {

						subLength =
							bytes[offset];


						offset +=
							1 + subLength;

					}
					while (
						subLength !== 0
					);

				}


				continue;

			}


			/*
			 * Image descriptor.
			 */

			if (block === 0x2C) {

				const left =
					bytes[offset] |
					(bytes[offset + 1] << 8);


				const top =
					bytes[offset + 2] |
					(bytes[offset + 3] << 8);


				const frameWidth =
					bytes[offset + 4] |
					(bytes[offset + 5] << 8);


				const frameHeight =
					bytes[offset + 6] |
					(bytes[offset + 7] << 8);


				const imagePacked =
					bytes[offset + 8];


				offset +=
					9;


				let palette =
					globalPalette;


				if (
					(imagePacked & 0x80) !== 0
				) {

					const lctEntries =
						2 <<
						(imagePacked & 0x07);


					palette =
						[];


					for (
						let i = 0;
						i < lctEntries;
						i++
					) {

						palette.push(
							[
								bytes[offset],
								bytes[offset + 1],
								bytes[offset + 2]
							]
						);


						offset +=
							3;

					}

				}


				const interlaced =
					(imagePacked & 0x40) !== 0;


				const minCodeSize =
					bytes[offset];


				offset++;


				const chunks =
					[];


				let chunkLength;


				do {

					chunkLength =
						bytes[offset];


					offset++;


					chunks.push(
						bytes.subarray(
							offset,
							offset + chunkLength
						)
					);


					offset +=
						chunkLength;

				}
				while (
					chunkLength !== 0
				);


				let dataLength =
					0;


				for (
					const chunk of
						chunks
				) {

					dataLength +=
						chunk.length;

				}


				const data =
					new Uint8Array(
						dataLength
					);


				let dataOffset =
					0;


				for (
					const chunk of
						chunks
				) {

					data.set(
						chunk,
						dataOffset
					);


					dataOffset +=
						chunk.length;

				}


				let indices =
					gifLzwDecode(
						data,
						minCodeSize,
						frameWidth *
							frameHeight
					);


				if (interlaced) {

					indices =
						gifDeinterlace(
							indices,
							frameWidth,
							frameHeight
						);

				}


				frames.push(
					{
						left:
							left,

						top:
							top,

						width:
							frameWidth,

						height:
							frameHeight,

						delayMs:
							pending
								? pending.delayMs
								: 100,

						disposal:
							pending
								? pending.disposal
								: 0,

						transparent:
							pending
								? pending.transparent
								: false,

						transparentIndex:
							pending
								? pending.transparentIndex
								: -1,

						palette:
							palette,

						pixels:
							indices
					}
				);


				pending =
					null;


				continue;

			}


			/*
			 * Unknown block: step one byte forward
			 * so we cannot get stuck in an infinite
			 * loop.
			 */

		}


		if (
			!frames.length
		) {

			throw new Error(
				"GIF contains no image frames"
			);

		}


		return {
			width:
				width,

			height:
				height,

			backgroundIndex:
				bytes[11],

			globalPalette:
				globalPalette,

			frames:
				frames
		};

	}


	/*
	 * Composes the parsed GIF into per-frame ImageData objects.
	 *
	 * Returns
	 *   {
	 *     width, height,     // (possibly downscaled) size
	 *     frames: [ { data: ImageData, durationMs } ],
	 *     startMs: [ ... ],  // frame start times within the loop
	 *     loopMs,
	 *     frameCount
	 *   }
	 */

	function buildGifSlideFrames(
		parsed
	) {

		const width =
			parsed.width;


		const height =
			parsed.height;


		const frames =
			parsed.frames;


		/*
		 * Memory guard: every stored frame costs
		 * width*height*4 bytes. Very large GIFs are
		 * downscaled to stay under the budget.
		 */

		const BUDGET_BYTES =
			120 * 1024 * 1024;


		let scale =
			1;


		const rawBytes =
			frames.length *
			width *
			height *
			4;


		if (rawBytes > BUDGET_BYTES) {

			scale =
				Math.sqrt(
					BUDGET_BYTES /
						rawBytes
				);


			scale =
				Math.max(
					0.15,
					Math.min(
						1,
						scale
					)
				);

		}


		const outWidth =
			Math.max(
				2,
				Math.round(
					width * scale
				)
			);


		const outHeight =
			Math.max(
				2,
				Math.round(
					height * scale
				)
			);


		const composite =
			document.createElement(
				"canvas"
			);


		composite.width =
			outWidth;


		composite.height =
			outHeight;


		const compositeCtx =
			composite.getContext(
				"2d",
				{
					willReadFrequently: true
				}
			);


		const patch =
			document.createElement(
				"canvas"
			);


		const patchCtx =
			patch.getContext(
				"2d"
			);


		let restoreBefore =
			null;


		const outFrames =
			[];


		const startMs =
			[];


		let loopMs =
			0;


		for (
			const frame of
				frames
		) {

			/*
			 * Disposal 3 on the previous frame means
			 * the canvas must be restored to the
			 * state before that frame was drawn.
			 */

			if (restoreBefore) {

				compositeCtx.putImageData(
					restoreBefore,
					0,
					0
				);


				restoreBefore =
					null;

			}


			/*
			 * When this frame has disposal 3, remember
			 * exactly this state (before the frame is
			 * drawn). The canvas is restored to it when
			 * the next frame arrives.
			 */

			if (
				frame.disposal === 3
			) {

				restoreBefore =
					compositeCtx.getImageData(
						0,
						0,
						outWidth,
						outHeight
					);

			}


			/*
			 * Map this frame's palette indices to
			 * RGBA pixels.
			 */

			patch.width =
				frame.width;


			patch.height =
				frame.height;


			const imageData =
				patchCtx.createImageData(
					frame.width,
					frame.height
				);


			const pixelsData =
				imageData.data;


			const indices =
				frame.pixels;


			for (
				let i = 0;
				i < indices.length;
				i++
			) {

				const index =
					indices[i];


				const colour =
					frame.palette[index] ||
					[0, 0, 0];


				const o =
					i * 4;


				pixelsData[o] =
					colour[0];


				pixelsData[o + 1] =
					colour[1];


				pixelsData[o + 2] =
					colour[2];


				pixelsData[o + 3] =
					frame.transparent &&
					index ===
						frame.transparentIndex
						? 0
						: 255;

			}


			patchCtx.putImageData(
				imageData,
				0,
				0
			);


			const dx =
				Math.round(
					frame.left * scale
				);


			const dy =
				Math.round(
					frame.top * scale
				);


			const dw =
				Math.round(
					frame.width * scale
				);


			const dh =
				Math.round(
					frame.height * scale
				);


			compositeCtx.drawImage(
				patch,
				0,
				0,
				frame.width,
				frame.height,
				dx,
				dy,
				dw,
				dh
			);


			/*
			 * Capture the canvas exactly as the
			 * frame is displayed.
			 */

			outFrames.push(
				{
					data:
						compositeCtx.getImageData(
							0,
							0,
							outWidth,
							outHeight
						),

					durationMs:
						frame.delayMs
				}
			);


			startMs.push(
				loopMs
			);


			loopMs +=
				frame.delayMs;


			/*
			 * Disposal 2 clears the frame's area back
			 * to the background: transparent when the
			 * frame has a transparent colour, otherwise
			 * the solid screen background colour.
			 */

			if (
				frame.disposal === 2
			) {

				if (
					frame.transparent
				) {

					compositeCtx.clearRect(
						dx,
						dy,
						dw,
						dh
					);

				}
				else {

					const bg =
						(parsed.globalPalette || [])[
							parsed.backgroundIndex
						] ||
						[0, 0, 0];

					compositeCtx.fillStyle =
						'rgb(' +
							bg[0] +
							',' +
							bg[1] +
							',' +
							bg[2] +
						')';

					compositeCtx.fillRect(
						dx,
						dy,
						dw,
						dh
					);

				}

			}


		}


		return {

			width:
				outWidth,

			height:
				outHeight,

			frames:
				outFrames,

			startMs:
				startMs,

			loopMs:
				loopMs,

			frameCount:
				outFrames.length

		};

	}


	/*
	 * Binary search for the frame that is visible
	 * at loopTimeMs.
	 */

	function gifFrameIndexAt(
		gif,
		loopTimeMs
	) {

		const starts =
			gif.startMs;


		let low =
			0;


		let high =
			starts.length - 1;


		let answer =
			0;


		while (
			low <= high
		) {

			const mid =
				(low + high) >> 1;


			if (
				starts[mid] <=
					loopTimeMs
			) {

				answer =
					mid;


				low =
					mid + 1;

			}
			else {

				high =
					mid - 1;

			}

		}


		return answer;

	}

	// =========================================================
	// MP4 VIDEO GENERATOR
	// =========================================================

	/*
	 * =========================================================
	 * VIDEO SECTIONS (the stacked "Video N" accordions)
	 * =========================================================
	 *
	 * This block is organised as four self-contained modules
	 * so it can later be cut into separate import files:
	 *
	 *   MODULE 1: video-projects  (state, + button, accordion UI)
	 *   MODULE 2: video-gallery   (upload, cards, drag & drop, tips)
	 *   MODULE 3: required-modal  (missing-fields warning)
	 *   MODULE 4: generation-queue (render everything, 2 at a time)
	 *   MODULE 5: ai-images       (40% panel: prompt -> 2 CF images,
	 *                              add-to-video + fullscreen)
	 *   MODULE 7: api-render      (POST /api/render with all of a
	 *                              video's elements; background-worker
	 *                              mode for the current-day settings route)
	 *   MODULE 8: script          (AI script generation -> plain
	 *                              narration text; INSTRUCT model;
	 *                              minutes 1-6 + speech speed; two
	 *                              client retries before the
	 *                              accordion reports an error
	 *   MODULE 8a: modal-stack    (one walkthrough / voiceover
	 *                              window per video, stacked, never
	 *                              swapped out of a pending choice)
	 *   MODULE 1c: batch-table    (the table layout: script + style +
	 *                              minutes per row, one Generate, then
	 *                              Preview / Export on every finished
	 *                              row)
	 *
	 * Each module only talks to the others through the
	 * videoProjects array and the small shared functions, so a
	 * module can be moved to its own file without touching the
	 * rest.
	 *
	 * The old single-video panels (title, MP3, captions,
	 * quality, main gallery) stay in the DOM but are
	 * hidden; they act as the engine's "working state". Before
	 * each video is rendered, that video's values are copied
	 * into the hidden panels, the engine renders, then the
	 * working state is restored.
	 */

	/*
	 * var (not let) so the save dialog and tests can see it
	 * on the window object.
	 */
	var renderContext =
		null;

	// =========================================================
	// MODULE 1: video-projects
	// =========================================================

	const VIDEO_MAX_VIDEOS =
		10;

	const VIDEO_BATCH_SIZE =
		2;

	let videoProjects =
		[];

	/*
	 * Exposed for tests / debugging: the live project list, same array
	 * (like window.__BATCH_ROWS for the quick-batch table).
	 */
	if (typeof window !== "undefined") {

		window.__VIDEO_PROJECTS =
			videoProjects;


		/* Session #264: clip duration probe (tests / debugging). */
		window.__PROBE_MP4_DURATION =
			probeMp4Duration;

	}

	let generating =
		false;

	const STATUS_COLORS = {
		empty:
			"#374151",
		queued:
			"#1d4ed8",
		rendering:
			"#b45309",
		done:
			"#15803d",
		error:
			"#b91c1c",
		skipped:
			"#4b5563",
	};

	function initVideoStudio() {

		/*
		 * Canvas-only start: hide the old
		 * single-video panels; they become
		 * the hidden engine working state.
		 */
		const mainPanels =
			document.querySelectorAll(
				".audio-panel"
			);

		for (const p of mainPanels) {
			p.style.display =
				"none";
		}

		const controls =
			document.querySelector(
				".controls"
			);

		if (controls) {
			controls.style.display =
				"none";
		}

		const gallery =
			document.getElementById(
				"gallery"
			);

		if (gallery) {
			gallery.style.display =
				"none";
		}

		/*
		 * Move the single generate button
		 * into the always-visible action
		 * bar next to the canvas.
		 */
		const renderBtn =
			document.getElementById(
				"render-btn"
			);

		const bar =
			document.getElementById(
				"action-bar"
			);

		if (renderBtn && bar) {

			renderBtn.parentNode.removeChild(
				renderBtn
			);

			bar.insertBefore(
				renderBtn,
				bar.firstChild
			);

			renderBtn.innerHTML =
				"\ud83c\udf9e\ufe0f Generate Videos";

		}

	}

	/*
	 * The red + button: adds one "Video N"
	 * accordion to the stack (max 10).
	 */
	function addVideoAccordion() {

		if (
			videoProjects.length >=
				VIDEO_MAX_VIDEOS
		) {

			alert(
				"You can add at most " +
					VIDEO_MAX_VIDEOS +
					" videos."
			);

			return;

		}

		const n =
			videoProjects.length + 1;

		const project = {
			n: n,
			name: "Video " + n,
			assets: [],
			audioFile: null,
			audio: null,
			status: "empty",
			el: null,
		};

		videoProjects.push(
			project
		);

		const acc =
			document.createElement(
				"div"
			);

		acc.className =
			"video-accordion";

		acc.id =
			"video-" + n;

		acc.innerHTML =
			videoAccordionHTML(
				n
			);

		document.getElementById(
			"video-accordions"
		).appendChild(
			acc
		);

		project.el =
			acc;

		document.getElementById(
			"va-file-" + n
		).addEventListener(
			"change",
			(event) =>
				onVideoFiles(
					n,
					event
				)
		);

		document.getElementById(
			"va-audio-" + n
		).addEventListener(
			"change",
			(event) =>
				onVideoAudio(
					n,
					event
				)
		);

		updateVideoStatus(
			n
		);

		syncVoiceoverButton(
			n
		);

	}

	function toggleVideoAccordion(
		n
	) {

		const body =
			document.getElementById(
				"va-body-" + n
			);

		const arrow =
			document.getElementById(
				"va-arrow-" + n
			);

		if (!body) {
			return;
		}

		body.style.display =
			body.style.display === "none"
			? ""
			: "none";

		if (arrow) {
			arrow.textContent =
				body.style.display ===
					"none"
				? "\u25b6"
				: "\u25bc";
		}

	}

	/*
	 * =========================================================
	 * DELETE VIDEO (the header button of every accordion)
	 * =========================================================
	 *
	 * Every lookup in this studio is positional -
	 * videoProjects[n - 1], #va-title-<n>, the batch counters -
	 * so a gap in the stack would silently point the wrong
	 * video's title, gallery or script at a row. Deleting
	 * therefore renumbers: the removed project's DOM node and
	 * object URLs go away, the other projects keep their files,
	 * audio, script and status, and every surviving accordion is
	 * rebuilt as Video 1..N with the state it already had.
	 *
	 * The per-video walkthrough / voiceover windows are transient
	 * UI, so they are closed instead of renumbered.
	 */

	/* Everything the accordion's inputs hold right now. */
	function captureVideoAccordionState(n) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return null;
		}

		const value = (id) => {

			const el =
				document.getElementById(id);

			return el ? el.value : "";

		};

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		const keywords =
			document.getElementById(
				"va-script-keywords-" + n
			);

		const status =
			document.getElementById(
				"va-script-status-" + n
			);

		const body =
			document.getElementById(
				"va-body-" + n
			);

		return {
			project: project,
			title: value("va-title-" + n),
			font: value("va-font-" + n),
			color: value("va-color-" + n),
			quality: value("va-quality-" + n),
			topic: value("va-script-topic-" + n),
			minutes: value("va-script-minutes-" + n),
			speed: value("va-script-speed-" + n),
			keywordsHTML: keywords ? keywords.innerHTML : "",
			keywordsHidden: !keywords || keywords.style.display === "none",
			scriptBoxOpen: !!box && box.style.display !== "none",
			statusText: status ? status.textContent : "",
			bodyOpen: !body || body.style.display !== "none"
		};

	}

	/* Rebuilds one accordion at its NEW position from a capture. */
	function restoreVideoAccordionState(n, state) {

		const project =
			state.project;

		if (!project) {
			return;
		}

		project.n =
			n;

		project.name =
			"Video " + n;

		const acc =
			document.createElement(
				"div"
			);

		acc.className =
			"video-accordion";

		acc.id =
			"video-" + n;

		acc.innerHTML =
			videoAccordionHTML(
				n
			);

		const stack =
			document.getElementById(
				"video-accordions"
			);

		if (!stack) {
			return;
		}

		stack.appendChild(
			acc
		);

		project.el =
			acc;

		const files =
			document.getElementById(
				"va-file-" + n
			);

		if (files) {
			files.addEventListener(
				"change",
				(event) =>
					onVideoFiles(
						n,
						event
					)
			);
		}

		const audioInput =
			document.getElementById(
				"va-audio-" + n
			);

		if (audioInput) {
			audioInput.addEventListener(
				"change",
				(event) =>
					onVideoAudio(
						n,
						event
					)
			);
		}

		const set = (id, value) => {

			const el =
				document.getElementById(id);

			if (el) {
				el.value = value;
			}

		};

		set("va-title-" + n, state.title);
		set("va-font-" + n, state.font || "oswald");
		set("va-color-" + n, state.color || "white");
		set("va-quality-" + n, state.quality || "balanced");
		set("va-script-topic-" + n, state.topic);
		set("va-script-minutes-" + n, state.minutes || "1");
		set("va-script-speed-" + n, state.speed || "medium");

		/* The gallery is rebuilt from the files the project kept. */
		for (const asset of project.assets) {

			asset.card =
				null;

			try {
				buildVaCard(
					n,
					asset
				);
			}
			catch (cardError) {
				console.warn(
					"Video " + n + ": could not restore an asset card.",
					cardError
				);
			}

		}

		if (project.audioFile) {

			const line =
				document.getElementById(
					"va-audio-line-" + n
				);

			if (line) {
				line.textContent =
					"\ud83c\udfb5 " + project.audioFile.name;
			}

		}

		const keywords =
			document.getElementById(
				"va-script-keywords-" + n
			);

		if (keywords && state.keywordsHTML) {
			keywords.innerHTML =
				state.keywordsHTML;
			keywords.style.display =
				state.keywordsHidden ? "none" : "";
		}

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		if (box && project.script) {
			box.textContent =
				project.script;
		}

		const status =
			document.getElementById(
				"va-script-status-" + n
			);

		if (status && state.statusText) {
			status.textContent =
				state.statusText;
		}

		setScriptBoxState(
			n,
			!!project.script && state.scriptBoxOpen
		);

		const body =
			document.getElementById(
				"va-body-" + n
			);

		if (body && !state.bodyOpen) {
			body.style.display =
				"none";

			const arrow =
				document.getElementById(
					"va-arrow-" + n
				);

			if (arrow) {
				arrow.textContent =
					"\u25b6";
			}
		}

		updateVideoStatus(
			n
		);

		syncVoiceoverButton(
			n
		);

		// A rebuilt accordion must preserve locks owned by an in-flight flow.
		setVaUploadEnabled(n, !(project._seoPlanBusy || project._imageFlowActive || project._seoChoicePending));
		const scriptButton = document.getElementById("va-script-btn-" + n);
		if (scriptButton) scriptButton.disabled = Boolean(project._seoPlanBusy || project._imageFlowActive);

	}

	/* Closes the transient per-video windows (they are not renumbered). */
	function closeVideoModals(n) {

		for (const id of ["seo-walkthrough-modal-", "voiceover-modal-"]) {

			const modal =
				document.getElementById(id + n);

			if (modal) {

				if (typeof closeModal === "function") {
					closeModal(modal);
				}
				else if (modal.parentNode) {
					modal.parentNode.removeChild(modal);
				}

			}

		}

	}

	/*
	 * Removes Video n, then renumbers everything after it so the
	 * stack is always Video 1..N.
	 */
	function deleteVideoAccordion(n) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		const assetCount =
			project.assets.length;

		const message =
			"Delete " + project.name + "?" +
			(assetCount
				? " Its " + assetCount + " image/GIF/MP4 file(s), MP3 and script will be removed."
				: " Its MP3 and script will be removed.");

		if (typeof confirm === "function" && !confirm(message)) {
			return;
		}

		const total =
			videoProjects.length;

		/* Snapshot the survivors before the array changes. */
		const survivors = [];

		for (let i = 1; i <= total; i++) {

			if (i !== n) {

				const state =
					captureVideoAccordionState(i);

				if (state) {
					survivors.push(state);
				}

			}

		}

		/*
		 * Detach every surviving accordion: the rebuild below creates the
		 * whole stack again with the new numbers, so the old nodes must
		 * not stay behind (that would leave two Video 1 nodes).
		 */
		for (const state of survivors) {

			if (state.project.el && state.project.el.parentNode) {
				state.project.el.parentNode.removeChild(state.project.el);
			}

		}

		/* Cancel any in-flight or queued AI flows for this deleted project first. */
		project._deleted = true;
		project._imageFlowActive = false;
		project._imageFlowSeq = (project._imageFlowSeq || 0) + 1;
		if (project._manualControllers) project._manualControllers.forEach(function (controller) { controller.abort(); });

		for (const ctrlKey of [
			"_stockSearchController",
			"_imageBatchController",
			"_imagePromptCreateController",
			"_seoPlanController",
			"_seoScriptController",
			"_voiceoverController"
		]) {
			if (project[ctrlKey]) {
				try {
					project[ctrlKey].abort();
				}
				catch (abortError) { }
				project[ctrlKey] = null;
			}
		}

		appImageStreamQueue.cancelMatching(function (meta) {
			return Boolean(
				meta &&
				meta.kind === "editor-video" &&
				(meta.project ? meta.project === project : meta.videoIndex === n)
			);
		}, "The video was deleted");

		manualImageTaskQueue.cancelMatching(function (meta) {
			return Boolean(
				meta &&
				meta.kind === "manual-ai" &&
				(meta.project ? meta.project === project : meta.videoIndex === n)
			);
		}, "The video was deleted");

		const aiResultsPanel =
			document.getElementById("va-ai-results-" + n);

		if (aiResultsPanel && aiResultsPanel.children) {
			Array.from(aiResultsPanel.children).forEach(function (card) {
				if (card && card._displayUrl) {
					try {
						releaseStudioObjectUrl(card._displayUrl);
					}
					catch (revokeErr) { }
				}
			});
		}

		if (project.audio && project.audio.url) {
			try {
				releaseStudioObjectUrl(project.audio.url);
			}
			catch (audioRevokeErr) { }
		}

		/* Free this video's object URLs - nothing else points at them. */
		for (const asset of project.assets) {

			try {
				releaseStudioObjectUrl(asset.url);
			}
			catch (revokeError) { }

		}

		for (let i = n; i <= total; i++) {
			closeVideoModals(i);
		}

		videoProjects.splice(
			n - 1,
			1
		);

		if (project.el && project.el.parentNode) {
			project.el.parentNode.removeChild(project.el);
		}

		/* Rebuild the stack as 1..N, in order. */
		for (let index = 0; index < survivors.length; index++) {
			restoreVideoAccordionState(
				index + 1,
				survivors[index]
			);
		}

		if (typeof renderBatchTable === "function") {
			renderBatchTable();
		}

	}

	function clickVaFiles(n) {

		const uploadBtn =
			document.getElementById(
				"va-upload-btn-" + n
			);

		if (uploadBtn && uploadBtn.disabled) {
			return;
		}

		const input =
			document.getElementById(
				"va-file-" + n
			);

		if (input) {
			input.click();
		}

	}

	function clickVaAudio(n) {

		const input =
			document.getElementById(
				"va-audio-" + n
			);

		if (input) {
			input.click();
		}

	}

	/*
	 * Static option lists, copied from
	 * the main panels.
	 */
	const QUALITY_OPTIONS =
		'<option value="low">480p \u00b7 Light (1.2 Mbps)</option>' +
		'<option value="balanced" selected>720p \u00b7 Balanced (2.5 Mbps)</option>' +
		'<option value="high">720p \u00b7 High (5 Mbps)</option>';

	const FONT_OPTIONS =
		'<option value="oswald">Oswald</option>' +
		'<option value="bauhaus">Bauhaus</option>' +
		'<option value="bookman">Bookman</option>';

	const COLOR_OPTIONS =
		'<option value="white">White text</option>' +
		'<option value="black">Black text</option>' +
		'<option value="green">Green text</option>';

	function videoAccordionHTML(
		n
	) {

		return (
			'<div class="va-header">' +
			'<span class="va-title">\ud83c\udfac Video ' + n + '</span>' +
			'<span class="va-status" id="va-status-' + n + '">empty</span>' +
			'<button type="button" class="va-delete-btn" id="va-delete-' + n + '" onclick="deleteVideoAccordion(' + n + ')" title="Delete this video with its images, MP4s, audio and script">\ud83d\uddd1\ufe0f Delete Video</button>' +
			'<span class="va-summary" id="va-summary-' + n + '"></span>' +
			'<button type="button" class="va-arrow" id="va-arrow-' + n + '" onclick="toggleVideoAccordion(' + n + ')" title="Collapse / expand">\u25bc</button>' +
			'</div>' +
			'<div class="va-body" id="va-body-' + n + '">' +
			'<div class="va-left">' +
				'<div class="va-section">' +
				'<div class="va-section-title">Generate SEO Script With AI</div>' +
				'<span class="va-note">SEO rule (explainer): 1 long-tail keyword said at least 1\u00d7 \u00b7 exactly 4 short keywords said at least 2\u00d7 each \u00b7 minimums only, extra uses are allowed \u00b7 one short keyword is in the title \u00b7 one is in a heading \u00b7 short/long-tail overlap is allowed and shared uses count for both \u00b7 no long-tail length rule</span>' +
				'<input type="text" id="va-script-topic-' + n + '" maxlength="120" placeholder="Topic (uses the video title if empty)">' +
				'<div class="va-row">' +
				'<label class="quality-select">Minutes <select id="va-script-minutes-' + n + '"><option value="1" selected>1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></label>' +
				'<label class="quality-select">Speech <select id="va-script-speed-' + n + '"><option value="super fast">Super fast</option><option value="fast">Fast</option><option value="medium" selected>Medium</option><option value="slow">Slow</option></select></label>' +
				'</div>' +
				'<button type="button" class="upload-btn small" id="va-script-btn-' + n + '" onclick="generateScript(' + n + ')" style="margin-top:4px" title="AI plans 1 long-tail keyword (said at least once), exactly 4 short keywords (each said at least twice) plus the explainer title and headings, then writes the plain narration script around them. Extra uses are allowed. Short keywords may overlap the long-tail (shared uses count for both); no long-tail length rule. The script is saved as spoken text \u2014 no subtitle formatting \u2014 so the voiceover can read it as it is.">\u2728 Generate SEO Script</button>' +
				'<span class="va-note" id="va-script-status-' + n + '"></span>' +
				'<div class="va-seo-keywords" id="va-script-keywords-' + n + '" style="display:none"></div>' +
				'<button type="button" class="va-scroll-toggle" id="va-script-toggle-' + n + '" onclick="toggleScriptBox(' + n + ')" style="display:none" title="Show / hide the narration script">\u25bc Script</button>' +
				'<div class="va-script-box" id="va-script-box-' + n + '" style="display:none"></div>' +
				'<div class="va-row va-script-actions">' +
				'<button type="button" class="upload-btn small" id="va-voice-btn-' + n + '" onclick="openVoiceoverModal(' + n + ')" disabled style="display:none" title="Speak the narration script to MP3 with MeloTTS (English) + apply it as subtitles">\ud83c\udf99 Generate Voiceover</button>' +
				'</div>' +
				'</div>' +
				'<div class="va-section">' +
				'<div class="va-section-title">Images / MP4s \u2014 drag cards to reorder</div><a href="https://pixabay.com/" target="_blank" rel="noopener noreferrer">Stock media from Pixabay</a>' +
				'<button type="button" class="upload-btn" id="va-upload-btn-' + n + '" onclick="clickVaFiles(' + n + ')">\ud83d\udcc1 Upload Image, GIF or MP4</button>' +
				'<span class="va-note">Max 5 GIF \u00b7 25 images \u00b7 5 MP4 (1:00 each, silent)</span>' +
				'<a href="#" class="va-template-link" onclick="openTemplateModal(' + n + '); return false;" title="Compose a portrait or landscape MP4 (max 25 seconds) from a design template and add it to this video">Add video from template</a>' +
				'<button type="button" class="va-scroll-toggle" id="va-gallery-toggle-' + n + '" onclick="toggleGalleryScroll(' + n + ')" title="Show / hide the image gallery">\u25b2 Images / MP4s</button>' +
				'<span class="va-note" id="va-ai-status-' + n + '">Automatic Pixabay scenes include two stock video clips.</span>' +
				'<div class="va-seo-keywords" id="va-image-keywords-' + n + '" style="display:none"></div>' +
				'<button type="button" class="upload-btn small" id="va-image-retry-' + n + '" onclick="retryImagePromptFlow(' + n + ')" style="display:none" title="Search Pixabay again using the keywords shown below and add the matching photos and clips to this gallery">Retry Pixabay search</button>' +
				'<div class="va-gallery" id="va-gallery-' + n + '"></div>' +
				'</div>' +
				'<div class="va-section">' +
				'<div class="va-section-title">Audio \u2014 one MP3 (the video is as long as the MP3)</div>' +
				'<button type="button" class="upload-btn audio" onclick="clickVaAudio(' + n + ')">\ud83c\udfb5 Upload MP3 Audio</button>' +
				'<span class="va-audio-line" id="va-audio-line-' + n + '"></span>' +
				'</div>' +
				'<div class="va-section">' +
				'<div class="va-section-title">Title (top left)</div>' +
				'<input type="text" id="va-title-' + n + '" maxlength="70" placeholder="Enter your video title...">' +
				'<div class="va-row">' +
				'<label class="quality-select">Font <select id="va-font-' + n + '">' + FONT_OPTIONS + '</select></label>' +
				'<label class="quality-select">Colour <select id="va-color-' + n + '">' + COLOR_OPTIONS + '</select></label>' +
				'</div>' +
				'</div>' +
				'<div class="va-section">' +
				'<div class="va-section-title">Quality</div>' +
				'<select id="va-quality-' + n + '" class="quality-select">' + QUALITY_OPTIONS + '</select>' +
				'</div>' +
			'</div>' +
			'</div>' +
			'<input type="file" id="va-file-' + n + '" multiple accept="image/*,image/gif,.gif,video/mp4,.mp4" style="display:none">' +
			'<input type="file" id="va-audio-' + n + '" accept="audio/mpeg,.mp3" style="display:none">'
		);

	}

	function videoCounts(
		project
	) {

		const gifs =
			project.assets.filter(
				(a) =>
					a.kind === "gif"
			).length;

		const stills =
			project.assets.filter(
				(a) =>
					a.kind === "image"
			).length;

		const clips =
			project.assets.filter(
				(a) =>
					a.kind === "mp4"
			).length;

		return {
			gifs: gifs,
			stills: stills,
			clips: clips,
		};

	}

	function updateVideoStatus(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		const statusEl =
			document.getElementById(
				"va-status-" + n
			);

		if (statusEl) {

			statusEl.textContent =
				project.status;

			statusEl.style.background =
				STATUS_COLORS[project.status] ||
				"#374151";

		}

		const summaryEl =
			document.getElementById(
				"va-summary-" + n
			);

		if (summaryEl) {

			const counts =
				videoCounts(
					project
				);

			const parts =
				[];

			if (
				counts.stills > 0
			) {

				parts.push(
					counts.stills +
						" image" +
						(counts.stills === 1
							? ""
							: "s")
				);

			}

			if (
				counts.gifs > 0
			) {

				parts.push(
					counts.gifs +
						" GIF" +
						(counts.gifs === 1
							? ""
							: "s")
				);

			}

			if (
				counts.clips > 0
			) {

				const total =
					project.assets.reduce(
						(sum, a) =>
							a.kind === "mp4"
							? sum + a.duration
							: sum,
						0
					);

				parts.push(
					counts.clips +
						" MP4 (" +
						formatSeconds(
							total
						) +
						")"
				);

			}

			if (
				project.audioFile
			) {

				parts.push(
					"MP3" +
					(project.audio
						? " " +
							formatSeconds(
								project.audio.duration
							)
						: "")
				);

			}

			const rows =
				document.getElementById(
					"va-captions-" + n
				);

			if (
				rows &&
				rows.children.length > 0
			) {

				parts.push(
					rows.children.length +
						" caption" +
						(rows.children.length === 1
							? ""
							: "s")
				);

			}

			summaryEl.textContent =
				parts.length
				? parts.join(" \u00b7 ")
				: "no images yet";
		}

		refreshVaTips(
			n
		);

		renderBatchTable();
	}

	// =========================================================
	// MODULE 1b: studio shell (Bug Fix Session #240, table view
	//             rewritten by Session #242)
	//
	// Two views over one shell, switched by [data-layout]:
	//   Bulk grid  #view-table - the quick batch table (its own
	//              rows, MODULE 1c; RULE 25)
	//   Editor     #view-editor - the Video N accordions beside
	//              the preview canvas
	//
	// The choice lives in memory only: RULE 15 forbids client
	// storage, so a reload always starts in the Editor.
	// =========================================================

	let studioLayout =
		"editor";

	function setStudioLayout(name) {

		studioLayout =
			name === "table"
				? "table"
				: "editor";

		const tableView =
			document.getElementById(
				"view-table"
			);

		const editorView =
			document.getElementById(
				"view-editor"
			);

		if (tableView) {

			tableView.classList.toggle(
				"active",
				studioLayout === "table"
			);

		}

		if (editorView) {

			editorView.classList.toggle(
				"active",
				studioLayout === "editor"
			);

		}

		const buttons =
			document.querySelectorAll(
				"[data-layout]"
			);

		for (const button of buttons) {

			const on =
				button.getAttribute(
					"data-layout"
				) ===
				studioLayout;

			button.classList.toggle(
				"active",
				on
			);

			button.setAttribute(
				"aria-selected",
				on
					? "true"
					: "false"
			);

		}

		if (studioLayout === "table") {

			renderBatchTable();

		}
		else {

			const topGen =
				document.getElementById(
					"top-generate"
				);

			if (topGen) {

				topGen.disabled =
					!!generating;

				topGen.textContent =
					"\u2726 Generate";

				topGen.title =
					"Render and download the MP4";

			}

		}

	}

	const SEO_IMAGE_STYLES = [
		"Cinematic Film",
		"Editorial Magazine",
		"Kinetic Typography",
		"Neon Night",
		"Minimalist",
		"Retro Poster",
		"Documentary",
		"Split Composition",
		"Dream Glow",
		"Pop Comic"
	];

	const DEFAULT_SEO_IMAGE_STYLE =
		"Cinematic Film";

	// =========================================================
	// MODULE 1c: quick-batch table (the studio's "table layout")
	//
	// One row = one video, produced entirely from the row itself:
	//
	//   column 1  the script (plain narration text, typed or pasted)
	//   column 2  the video image style - the SAME ten options the
	//             script modal offers, in the same order
	//   column 3  the minimum length in minutes
	//   column 4  the Pixabay image resolution: 480, 540, 720 or 1024 px
	//             (the LONG edge; passed to both image calls)
	//   column 5  the frame orientation: square 1:1, landscape 16:9
	//             or portrait 9:16 (passed to both image calls)
	//   column 6  "Preview Here" while the row works, then a live
	//             Preview button
	//   column 7  "Export Video" while the row works, then a live
	//             Export button
	//
	// The \u2726 Generate button at the TOP RIGHT of the table runs every
	// row that has a script and is NOT finished yet. A row without one
	// is skipped, and so is a row whose Preview / Export buttons are
	// already live (re-pressing Generate must never re-bill a finished
	// video). Missing inputs fall back to their defaults: 1 minute,
	// Cinematic Film, 1024 px and landscape 16:9.
	//
	// Rows run BATCH_RUN_CONCURRENCY (3) at a time: three rows speak,
	// draw and animate simultaneously, and the next queued row starts
	// as soon as one of them finishes.
	//
	// A row is finished when all four steps are through - the spoken
	// MP3, the Pixabay images, and the animation that stitches them - and
	// only then do Preview and Export enable, always together.
	//
	// Rows are deliberately independent of the "Video N" accordions:
	// nothing here reads or writes videoProjects, so the quick table
	// is a fast lane and the accordions stay the detailed editor.
	// =========================================================

	const BATCH_ROW_LIMIT =
		VIDEO_MAX_VIDEOS;

	const BATCH_MIN_MINUTES =
		1;

	const BATCH_MAX_MINUTES =
		6;

	/* The row stays usable if the LLM or the image batch is slow. */
	const BATCH_REQUEST_TIMEOUT_MS =
		240000;

	/* Never let a stalled image decode hold the row open. */
	const BATCH_SLIDE_DECODE_MS =
		10000;

	/*
	 * Session #211: the table used to run one row at a time, so a five-row
	 * table paid the full voiceover + prompt + image + animate cost five
	 * times in series. Three rows now render at the same time; the fourth
	 * starts as soon as one of the three finishes.
	 */
	const BATCH_RUN_CONCURRENCY =
		3;

	/*
	 * Session #244: a step that fails is retried INSIDE its row, silently.
	 * Nothing about a retry reaches the screen - the row keeps its normal
	 * stage label and its spinner spinning (the same .va-spinner the
	 * editor's script section shows), so a row that needed three attempts
	 * looks exactly like a row that needed one.
	 */
	const BATCH_STEP_ATTEMPTS =
		4;

	/* Backoff between the silent retries: 0.8s, 1.6s, 3.2s. */
	const BATCH_RETRY_BASE_MS =
		800;

	const BATCH_RETRY_MAX_MS =
		4000;

	/*
	 * A batch stream that stops sending lines is as dead as one that
	 * never answered: the NDJSON reader gets this idle budget per read
	 * instead of hanging the row open until the tab is closed.
	 */
	const BATCH_STREAM_IDLE_TIMEOUT_MS =
		90000;

	/*
	 * Never let a stalled WebAudio decode freeze a row on "Measuring the
	 * narration": fall back to the row's minutes setting after 15 seconds.
	 */
	const BATCH_AUDIO_DECODE_MS =
		15000;

	/*
	 * Node.js-style Event-Driven Non-Blocking Image Task Runtime:
	 *   1. Single-threaded event-loop task queues (appImageStreamQueue and
	 *      manualImageTaskQueue) dispatch async network I/O fairly in round-robin
	 *      across active videos/rows without blocking the UI thread.
	 *   2. Background Web Worker thread pool (decodeBase64ImageOffThread) offloads
	 *      multi-megabyte base64-to-binary image decoding off the main thread
	 *      with zero-copy Transferable ArrayBuffers, falling back to cooperative
	 *      64 KB event-loop slices when Web Workers are unavailable.
	 */
	const BATCH_IMAGE_STREAM_CONCURRENCY =
		3;

	const CLIENT_DECODE_THREAD_POOL_SIZE =
		3;

	const CLIENT_WORKER_DECODE_MIN_CHARS =
		16384;

	function yieldClientEventLoop() {

		return new Promise(function (resolve) {

			setTimeout(resolve, 0);

		});

	}

	function createEventDrivenTaskQueue(maxConcurrency) {

		const limit =
			Math.max(1, Number(maxConcurrency) || 3);

		const lanes =
			new Map();

		const ring =
			[];

		let cursor =
			0;

		let active =
			0;

		let queued =
			0;

		let pumpScheduled =
			false;

		function makeAbortErr(msg) {

			const err =
				new Error(msg || "Image task aborted");

			err.name =
				"AbortError";

			return err;

		}

		function cleanupLane(key) {

			const lane =
				lanes.get(key);

			if (lane && lane.items.length === 0 && lane.active === 0) {

				lanes.delete(key);

				const idx =
					ring.indexOf(key);

				if (idx !== -1) {

					ring.splice(idx, 1);

					if (cursor >= ring.length) {
						cursor = 0;
					}

				}

			}

		}

		function schedulePump() {

			if (pumpScheduled) {
				return;
			}

			pumpScheduled =
				true;

			Promise.resolve().then(function () {

				pumpScheduled =
					false;

				pump();

			});

		}

		function pump() {

			while (active < limit && queued > 0 && ring.length > 0) {

				let dispatched =
					false;

				const len =
					ring.length;

				for (let step = 0; step < len; step++) {

					const idx =
						(cursor + step) % len;

					const key =
						ring[idx];

					const lane =
						lanes.get(key);

					if (!lane || lane.items.length === 0) {
						continue;
					}

					let item =
						null;

					while (lane.items.length > 0) {

						const candidate =
							lane.items.shift();

						queued =
							Math.max(0, queued - 1);

						if (candidate.cleanupAbort) {
							candidate.cleanupAbort();
							candidate.cleanupAbort = null;
						}

						if (
							candidate.cancelled ||
							(candidate.isCancelled && candidate.isCancelled())
						) {
							candidate.cancelled = true;
							candidate.reject(makeAbortErr("The row was stopped"));
							continue;
						}

						item =
							candidate;

						break;

					}

					if (!item) {
						cleanupLane(key);
						break;
					}

					cursor =
						(idx + 1) % Math.max(1, ring.length);

					active += 1;
					lane.active += 1;
					dispatched = true;

					(function (pickedKey, pickedLane, pickedItem) {

						Promise.resolve()
							.then(function () {
								return pickedItem.run();
							})
							.then(
								function (val) {
									active = Math.max(0, active - 1);
									pickedLane.active = Math.max(0, pickedLane.active - 1);
									cleanupLane(pickedKey);
									schedulePump();
									pickedItem.resolve(val);
								},
								function (err) {
									active = Math.max(0, active - 1);
									pickedLane.active = Math.max(0, pickedLane.active - 1);
									cleanupLane(pickedKey);
									schedulePump();
									pickedItem.reject(err);
								}
							);

					})(key, lane, item);

					break;

				}

				if (!dispatched) {
					break;
				}

			}

		}

		function enqueue(groupKey, runFn, options) {

			const opts =
				options || {};

			const signal =
				opts.signal || null;

			const isCancelled =
				typeof opts.isCancelled === "function"
					? opts.isCancelled
					: function () {
						return Boolean(signal && signal.aborted);
					};

			if (isCancelled()) {
				return Promise.reject(makeAbortErr("The row was stopped"));
			}

			const key =
				String(groupKey || "default");

			return new Promise(function (resolve, reject) {

				let lane =
					lanes.get(key);

				if (!lane) {
					lane = { items: [], active: 0 };
					lanes.set(key, lane);
					ring.push(key);
				}

				const entry = {
					run: runFn,
					meta: opts.meta || null,
					isCancelled: isCancelled,
					cancelled: false,
					cleanupAbort: null,
					resolve: resolve,
					reject: reject
				};

				lane.items.push(entry);
				queued += 1;

				if (signal && typeof signal.addEventListener === "function") {

					const onAbort = function () {

						if (entry.cancelled) {
							return;
						}

						entry.cancelled =
							true;

						const pos =
							lane.items.indexOf(entry);

						if (pos !== -1) {
							lane.items.splice(pos, 1);
							queued = Math.max(0, queued - 1);
						}

						entry.cleanupAbort = null;
						cleanupLane(key);
						reject(makeAbortErr("The row was stopped"));
						schedulePump();

					};

					signal.addEventListener("abort", onAbort, { once: true });

					entry.cleanupAbort = function () {
						signal.removeEventListener("abort", onAbort);
					};

				}

				schedulePump();

			});

		}

		function cancelMatching(predicate, message) {

			for (const entryPair of Array.from(lanes.entries())) {

				const key =
					entryPair[0];

				const lane =
					entryPair[1];

				const kept =
					[];

				for (let i = 0; i < lane.items.length; i++) {

					const item =
						lane.items[i];

					if (predicate(item.meta, key)) {

						item.cancelled = true;
						queued = Math.max(0, queued - 1);
						if (item.cleanupAbort) {
							item.cleanupAbort();
							item.cleanupAbort = null;
						}
						item.reject(makeAbortErr(message || "The row was stopped"));

					}
					else {

						kept.push(item);

					}

				}

				lane.items =
					kept;

				cleanupLane(key);

			}

			schedulePump();

		}

		return {
			enqueue: enqueue,
			cancelMatching: cancelMatching,
			stats: function () {
				return {
					active: active,
					queued: queued,
					groups: lanes.size,
					concurrency: limit
				};
			}
		};

	}

	const appImageStreamQueue =
		createEventDrivenTaskQueue(BATCH_IMAGE_STREAM_CONCURRENCY);

	const manualImageTaskQueue =
		createEventDrivenTaskQueue(3);

	/*
	 * Background Web Worker Thread Pool for base64 -> ArrayBuffer decoding
	 * (mirrors Node's libuv thread pool offloading CPU-heavy buffer work off
	 * the single main JS thread). Falls back automatically to non-blocking
	 * 64 KB event-loop chunks when Worker is unavailable or CSP-restricted.
	 */
	const decodeWorkerPool = {
		workers: [],
		idle: [],
		pendingJobs: new Map(),
		waitQueue: [],
		nextJobId: 1,
		disabled: false
	};

	const DECODE_WORKER_SOURCE =
		"self.onmessage = function(e) { " +
		"var msg = e.data || {}; var id = msg.id; " +
		"try { " +
		"var cleaned = String(msg.base64 || '').replace(/^data:[^;]+;base64,/i, '').split(' ').join('').split(String.fromCharCode(10)).join('').split(String.fromCharCode(13)).join('').split(String.fromCharCode(9)).join(''); " +
		"var bytes; " +
		"if (typeof Uint8Array !== 'undefined' && typeof Uint8Array.fromBase64 === 'function') { " +
		"bytes = Uint8Array.fromBase64(cleaned); " +
		"} else { " +
		"var bin = atob(cleaned); bytes = new Uint8Array(bin.length); " +
		"for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); " +
		"} " +
		"var buf = bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer; " +
		"self.postMessage({ id: id, ok: true, buffer: buf }, [buf]); " +
		"} catch (err) { " +
		"self.postMessage({ id: id, ok: false, error: String((err && err.message) || err) }); " +
		"} };";

	function pumpDecodeWorkerQueue() {

		while (decodeWorkerPool.waitQueue.length > 0 && decodeWorkerPool.idle.length > 0) {

			const worker =
				decodeWorkerPool.idle.pop();

			const job =
				decodeWorkerPool.waitQueue.shift();

			if (!worker || !job) {
				continue;
			}

			decodeWorkerPool.pendingJobs.set(job.id, {
				job: job,
				worker: worker
			});

			try {
				worker.postMessage({ id: job.id, base64: job.base64 });
			}
			catch (postErr) {
				decodeWorkerPool.pendingJobs.delete(job.id);
				decodeWorkerPool.disabled = true;
				job.fallback();
			}

		}

	}

	function acquireDecodeWorker() {

		if (
			decodeWorkerPool.disabled ||
			typeof Worker !== "function" ||
			typeof Blob !== "function" ||
			typeof URL === "undefined" ||
			typeof URL.createObjectURL !== "function"
		) {
			return false;
		}

		if (decodeWorkerPool.idle.length > 0) {
			return true;
		}

		if (decodeWorkerPool.workers.length >= CLIENT_DECODE_THREAD_POOL_SIZE) {
			return true;
		}

		let scriptUrl =
			"";

		try {

			scriptUrl =
				createStudioObjectUrl(
					new Blob([DECODE_WORKER_SOURCE], { type: "application/javascript" })
				);

			const worker =
				new Worker(scriptUrl);

			if (typeof URL.revokeObjectURL === "function") {
				try { releaseStudioObjectUrl(scriptUrl); } catch (revokeErr) { }
			}

			worker.onmessage = function (ev) {

				const data =
					ev && ev.data ? ev.data : {};

				const record =
					decodeWorkerPool.pendingJobs.get(data.id);

				if (!record) {
					return;
				}

				decodeWorkerPool.pendingJobs.delete(data.id);
				decodeWorkerPool.idle.push(worker);
				pumpDecodeWorkerQueue();

				if (data.ok && data.buffer) {
					record.job.resolve(
						new Blob([data.buffer], { type: record.job.mime || "image/png" })
					);
				}
				else {
					record.job.reject(new Error(data.error || "Image decode failed"));
				}

			};

			worker.onerror = function () {

				decodeWorkerPool.disabled = true;

				for (const pair of Array.from(decodeWorkerPool.pendingJobs.entries())) {
					if (pair[1].worker === worker) {
						decodeWorkerPool.pendingJobs.delete(pair[0]);
						pair[1].job.fallback();
					}
				}

				while (decodeWorkerPool.waitQueue.length > 0) {
					const queuedJob = decodeWorkerPool.waitQueue.shift();
					if (queuedJob) queuedJob.fallback();
				}

			};

			decodeWorkerPool.workers.push(worker);
			decodeWorkerPool.idle.push(worker);
			return true;

		}
		catch (spawnErr) {

			if (scriptUrl && typeof URL.revokeObjectURL === "function") {
				try { releaseStudioObjectUrl(scriptUrl); } catch (revokeErr2) { }
			}

			decodeWorkerPool.disabled = true;
			return false;

		}

	}

	async function decodeBase64ChunkedOnEventLoop(cleaned, mime) {

		if (!cleaned) {
			return new Blob([new Uint8Array(0)], { type: mime || "image/png" });
		}

		if (
			typeof Uint8Array !== "undefined" &&
			typeof Uint8Array.fromBase64 === "function" &&
			cleaned.length <= 65536
		) {
			return new Blob(
				[Uint8Array.fromBase64(cleaned)],
				{ type: mime || "image/png" }
			);
		}

		/*
		 * Slice on a multiple of 4 base64 chars (65536 chars = 48 KB decoded)
		 * and yield back to the event loop between slices so the single JS
		 * main thread never stalls on multi-megabyte images.
		 */
		const sliceChars =
			65536;

		const chunks =
			[];

		for (let offset = 0; offset < cleaned.length; offset += sliceChars) {

			if (offset > 0) {
				await yieldClientEventLoop();
			}

			const part =
				cleaned.slice(offset, offset + sliceChars);

			if (
				typeof Uint8Array !== "undefined" &&
				typeof Uint8Array.fromBase64 === "function"
			) {
				chunks.push(Uint8Array.fromBase64(part));
			}
			else {
				const bin =
					atob(part);
				const arr =
					new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) {
					arr[i] = bin.charCodeAt(i);
				}
				chunks.push(arr);
			}

		}

		return new Blob(chunks, { type: mime || "image/png" });

	}

	function decodeBase64ImageOffThread(base64, mime) {

		const cleaned =
			String(base64 || "")
				.replace(/^data:[^;]+;base64,/i, "")
				.replace(/\\s+/g, "");

		if (
			cleaned.length >= CLIENT_WORKER_DECODE_MIN_CHARS &&
			acquireDecodeWorker()
		) {

			return new Promise(function (resolve, reject) {

				const id =
					decodeWorkerPool.nextJobId++;

				decodeWorkerPool.waitQueue.push({
					id: id,
					base64: cleaned,
					mime: mime || "image/png",
					resolve: resolve,
					reject: reject,
					fallback: function () {
						decodeBase64ChunkedOnEventLoop(cleaned, mime).then(resolve, reject);
					}
				});

				pumpDecodeWorkerQueue();

			});

		}

		return decodeBase64ChunkedOnEventLoop(cleaned, mime);

	}

	if (typeof window !== "undefined") {
		window.__IMAGE_TASK_RUNTIME = {
			streamQueue: appImageStreamQueue,
			manualQueue: manualImageTaskQueue,
			decodeBase64ImageOffThread: decodeBase64ImageOffThread,
			createEventDrivenTaskQueue: createEventDrivenTaskQueue
		};
	}

	/*
	 * The policy above, in one mutable object: batchRunStep reads it, and
	 * tests (or a future admin knob) can shorten the backoff without
	 * touching the retry logic itself.
	 */
	const batchRetryPolicy = {
		attempts: BATCH_STEP_ATTEMPTS,
		baseMs: BATCH_RETRY_BASE_MS,
		maxMs: BATCH_RETRY_MAX_MS
	};

	/*
	 * The two new per-row columns: the rendered size of the Pixabay images and
	 * the frame orientation. The resolution is the LONG edge in pixels; the
	 * short edge follows the orientation (16:9 for landscape / portrait,
	 * 1:1 for square) so 480 / 540 / 720 stay honest names.
	 * The values are sent to BOTH /api/image-prompts (so every scene prompt
	 * is written for that frame) and /api/image-batch (so SDXL really draws
	 * at that size).
	 */
	const BATCH_RESOLUTIONS = [480, 540, 720, 1024];

	const BATCH_DEFAULT_RESOLUTION = 1024;

	const BATCH_ORIENTATIONS = [
		{ value: "square", label: "Square 1:1", ratio: [1, 1] },
		{ value: "landscape", label: "Landscape 16:9", ratio: [16, 9] },
		{ value: "portrait", label: "Portrait 9:16", ratio: [9, 16] }
	];

	const BATCH_DEFAULT_ORIENTATION = "landscape";

	/* The orientation record for a row value (defaults to landscape). */
	function batchOrientation(value) {
		for (const entry of BATCH_ORIENTATIONS) {
			if (entry.value === value) {
				return entry;
			}
		}
		return BATCH_ORIENTATIONS[1];
	}

	/* A row's stored resolution, coerced to one of the four allowed sizes. */
	function batchResolution(value) {
		const size = Math.round(Number(value) || 0);
		return BATCH_RESOLUTIONS.indexOf(size) === -1
			? BATCH_DEFAULT_RESOLUTION
			: size;
	}

	/*
	 * Long edge = resolution, short edge = long edge × ratio, both rounded
	 * to a multiple of 8 (SDXL's requirement). Mirrors imageFrameFor() in
	 * src/modules/image-batch.ts - the client uses it for the preview
	 * canvas, the worker for the real render.
	 */
	function batchRowDimensions(row) {
		const resolution =
			batchResolution(row && row.resolution);
		const orientation =
			batchOrientation(row && row.orientation);
		const round8 = function (value) {
			return Math.max(256, Math.round(value / 8) * 8);
		};
		if (orientation.value === "square") {
			return { width: round8(resolution), height: round8(resolution), resolution: resolution, orientation: "square" };
		}
		const long = round8(resolution);
		const short = round8(resolution * 9 / 16);
		return orientation.value === "portrait"
			? { width: short, height: long, resolution: resolution, orientation: "portrait" }
			: { width: long, height: short, resolution: resolution, orientation: "landscape" };
	}

	const batchRows = [];

	let batchRowSeq =
		0;

	let batchRunBusy =
		false;

	let batchRenderBusy =
		false;

	let batchPreview =
		null;

	let batchTableBound =
		false;

	/* true once the first blank row has been offered. */
	let batchTableSeeded =
		false;

	/*
	 * Session #248: queue and in-flight tracking for staggered pipeline execution.
	 * When a row moves to image generation, an unprocessed row from batchQueue
	 * is started without waiting for earlier rows to reach 'done'.
	 */
	let batchQueue =
		[];

	const batchActivePromises =
		new Set();

	const batchAttemptedRows =
		new Set();

	let batchFinishedCount =
		0;

	const BATCH_STAGE_LABELS = {
		empty: "Waiting for a script",
		ready: "Ready \u2014 press \u2726 Generate",
		queued: "Queued",
		voice: "Speaking the script (MP3)",
		timing: "Measuring the narration",
		prompts: "Preparing Pixabay search terms",
		images: "Fetching Pixabay images",
		animate: "Animating the slides",
		done: "Finished",
		error: "Stopped"
	};

	function createBatchRow(seed) {

		batchRowSeq += 1;

		return Object.assign(
			{
				id: batchRowSeq,
				script: "",
				style:
					(typeof DEFAULT_SEO_IMAGE_STYLE === "string" && DEFAULT_SEO_IMAGE_STYLE) ||
					"Cinematic Film",
				minutes:
					BATCH_MIN_MINUTES,
				resolution:
					BATCH_DEFAULT_RESOLUTION,
				orientation:
					BATCH_DEFAULT_ORIENTATION,
				stage:
					(seed && seed.script && String(seed.script).trim())
						? "ready"
						: "empty",
				detail:
					"",
				error:
					"",
				mp3:
					null,
				mp3Url:
					"",
				audio:
					null,
				prompts:
					[],
				images:
					[],
				objectUrls:
					[],
				slides:
					[],
				subtitles:
					[],
				animated:
					false,
				running:
					false,
				startedAt:
					0,
				finishedAt:
					0
			},
			seed || {}
		);

	}

	function getBatchRow(id) {

		for (const row of batchRows) {

			if (String(row.id) === String(id)) {
				return row;
			}

		}

		return null;

	}

	function batchRowHasScript(row) {

		return !!(
			row &&
			String(row.script || "").trim()
		);

	}

	/* mp3 + Pixabay images + animation - the one definition of "finished". */
	function batchRowFinished(row) {

		return !!(
			row &&
			row.mp3 &&
			row.images.length &&
			row.animated &&
			row.slides.length
		);

	}

	function addBatchRow(seed) {

		if (
			batchRows.length >=
			BATCH_ROW_LIMIT
		) {

			showRequiredModal([
				"The quick batch table holds " +
				BATCH_ROW_LIMIT +
				" rows - finish or remove one first."
			]);

			return null;

		}

		const row =
			createBatchRow(seed);

		batchRows.push(row);

		renderBatchTable();

		return row;

	}

	function revokeBatchRow(row) {

		if (!row) {
			return;
		}

		for (const url of row.objectUrls || []) {

			try {
				releaseStudioObjectUrl(url);
			}
			catch (revokeError) { }

		}

		row.objectUrls = [];
		for (const slide of row.slides || []) {
			if (slide.videoEl) { try { slide.videoEl.pause(); slide.videoEl.removeAttribute("src"); slide.videoEl.load(); } catch (_) {} }
			if (slide.img && typeof slide.img.close === "function") { try { slide.img.close(); } catch (closeError) {} }
		}

	}

	function removeBatchRow(id) {

		let index =
			-1;

		for (let i = 0; i < batchRows.length; i++) {

			if (String(batchRows[i].id) === String(id)) {
				index = i;
				break;
			}

		}

		if (index < 0) {
			return;
		}

		revokeBatchRow(
			batchRows[index]
		);

		batchRows.splice(index, 1);

		batchQueue =
			batchQueue.filter(function (r) {
				return String(r.id) !== String(id);
			});

		batchAttemptedRows.delete(String(id));

		if (!batchRows.length) {
			closeBatchPreview();
		}

		renderBatchTable();

	}

	function batchStyleOptionsHTML(selected) {

		const styles =
			(typeof SEO_IMAGE_STYLES === "object" && Array.isArray(SEO_IMAGE_STYLES) && SEO_IMAGE_STYLES.length)
				? SEO_IMAGE_STYLES
				: ["Cinematic Film"];

		return styles
			.map(function (style) {

				const value =
					typeof style === "string"
						? style
						: (style && style.name) || "";

				if (!value) {
					return "";
				}

				return (
					'<option value="' +
					value +
					'"' +
					(value === selected ? " selected" : "") +
					">" +
					escapeHTML(value) +
					"</option>"
				);

			})
			.join("");

	}

	/* The resolution column's options, one per allowed long edge. */
	function batchResolutionOptionsHTML(selected) {

		const current =
			batchResolution(selected);

		return BATCH_RESOLUTIONS
			.map(function (size) {
				return (
					'<option value="' + size + '"' +
					(size === current ? " selected" : "") +
					">" + size + "px</option>"
				);
			})
			.join("");

	}

	/* The orientation column's options. */
	function batchOrientationOptionsHTML(selected) {

		const current =
			batchOrientation(selected).value;

		return BATCH_ORIENTATIONS
			.map(function (entry) {
				return (
					'<option value="' + entry.value + '"' +
					(entry.value === current ? " selected" : "") +
					">" + escapeHTML(entry.label) + "</option>"
				);
			})
			.join("");

	}

	function batchStatusText(row) {

		if (row.stage === "error") {

			return "\u26a0 " + (row.error || row.detail || "Generation failed");

		}

		const label =
			BATCH_STAGE_LABELS[row.stage] ||
			row.stage;

		return row.detail
			? label + " \u00b7 " + row.detail
			: label;

	}

	/*
	 * Session #244: the stages that mean "this row is working right now".
	 * They are the ONLY stages that paint the editor's script-section
	 * animation (.va-spinner + the va-loading-pulse), and the animation is
	 * painted for the whole step - first attempt and third retry alike -
	 * so a silent retry changes nothing on screen.
	 */
	const BATCH_ACTIVE_STAGES = [
		"voice",
		"timing",
		"prompts",
		"images",
		"animate"
	];

	function batchRowBusy(row) {

		return !!(
			row &&
			BATCH_ACTIVE_STAGES.indexOf(row.stage) !== -1
		);

	}

	/* The status cell's markup: spinner + label while the row works. */
	function batchStatusHTML(row) {

		const text =
			escapeHTML(batchStatusText(row));

		if (!batchRowBusy(row)) {

			return text;

		}

		return (
			'<span class="va-spinner" aria-hidden="true"></span>' +
			'<span class="batch-status-text">' + text + "</span>"
		);

	}

	/* Paint one row's status cell from its own state. */
	function paintBatchRowStatus(row) {

		const status =
			document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="status"]');

		if (!status) {

			return;

		}

		status.innerHTML =
			batchStatusHTML(row);

		status.setAttribute(
			"data-stage",
			row.stage
		);

		status.setAttribute(
			"data-loading",
			batchRowBusy(row) ? "1" : "0"
		);

	}

	/* An Error with a machine name, never with browser abort wording. */
	function batchError(message, name) {

		const error =
			new Error(message);

		error.name =
			name || "BatchStepError";

		return error;

	}

	function batchDelay(ms) {

		return new Promise(function (resolve) {

			setTimeout(resolve, ms);

		});

	}

	/*
	 * Aborts are plumbing, not content. The browser words them as
	 * "signal is aborted without reason" / "The user aborted a request",
	 * and that text must never reach a row's status line.
	 */
	function batchIsAbortError(error) {

		if (!error) {

			return false;

		}

		const name =
			String(error.name || "");

		if (
			name === "AbortError" ||
			name === "TimeoutError"
		) {

			return true;

		}

		return /abort|signal/i.test(
			String(error.message || error)
		);

	}

	/*
	 * A STOP is not a failure and is never retried (the user asked for it).
	 * A timeout is a failure and IS retried - which is why this is a
	 * narrower test than batchIsAbortError().
	 */
	function batchIsStopError(error) {

		if (!error) {

			return false;

		}

		const name =
			String(error.name || "");

		if (name === "AbortError") {

			return true;

		}

		if (name === "TimeoutError") {

			return false;

		}

		return /abort/i.test(
			String(error.message || error)
		);

	}

	/* One short line for the console - the table itself stays quiet. */
	function batchErrorBrief(error) {

		if (!error) {

			return "unknown";

		}

		const name =
			String(error.name || "Error");

		const message =
			String(error.message || error)
				.replace(/\\s+/g, " ")
				.trim();

		return message && message !== name
			? name + ": " + message
			: name;

	}

	/* Throw away every object URL a failed attempt allocated. */
	function revokeBatchUrlsSince(row, keepCount) {

		if (!row || !Array.isArray(row.objectUrls)) {

			return;

		}

		const keep =
			Math.max(0, Number(keepCount) || 0);

		const dropped =
			row.objectUrls.splice(keep);

		for (const url of dropped) {

			try {

				releaseStudioObjectUrl(url);

			}
			catch (revokeError) { }

		}

		if (
			row.mp3Url &&
			row.objectUrls.indexOf(row.mp3Url) === -1
		) {

			row.mp3 = null;
			row.mp3Url = "";

		}

		if (Array.isArray(row.images)) {

			row.images =
				row.images.filter(function (image) {

					return row.objectUrls.indexOf(image.url) !== -1;

				});

		}

	}

	/* One positive number out of the retry policy (or its constant). */
	function batchRetrySetting(name, fallback) {

		const value =
			Number(batchRetryPolicy[name]);

		return (
			typeof value === "number" &&
			isFinite(value) &&
			value > 0
		)
			? value
			: fallback;

	}

	/*
	 * Run ONE step with silent in-row retries.
	 *
	 *  - attempt 1 paints the step's normal label;
	 *  - a failed attempt is retried after a short backoff and the row's
	 *    label is NOT touched, so the user only ever sees the same
	 *    working animation the editor's script section shows;
	 *  - object URLs made by a failed attempt are revoked before the
	 *    retry, so a retried image step cannot leak or double-count.
	 *
	 * The attempt number is the only place a retry is visible at all -
	 * in the console.
	 */
	async function batchRunStep(
		row,
		stage,
		detail,
		step
	) {

		const attempts =
			Math.max(
				1,
				Math.round(batchRetrySetting("attempts", BATCH_STEP_ATTEMPTS))
			);

		let lastError =
			null;

		for (
			let attempt = 1;
			attempt <= attempts;
			attempt++
		) {

			if (row.stopRequested) {

				throw batchError("The row was stopped", "AbortError");

			}

			if (attempt === 1) {

				setBatchStage(
					row,
					stage,
					detail
				);

				/*
				 * Session #248: when a row moves to the next step of processing
				 * (ex. image generation), start unprocessed rows so later rows
				 * do not wait for earlier rows to reach 'done'.
				 */
				if (stage === "images") {

					startUnprocessedRows(row);

				}

			}
			else {

				/* Same stage, same label, same spinner: nothing moves. */
				row.retrying =
					true;

				paintBatchRowStatus(row);

			}

			const urlsBefore =
				(row.objectUrls || []).length;

			try {

				const result =
					await step(attempt);

				row.retrying =
					false;

				return result;

			}
			catch (error) {

				row.retrying =
					false;

				revokeBatchUrlsSince(
					row,
					urlsBefore
				);

				if (
					row.stopRequested ||
					batchIsStopError(error)
				) {

					/* A stop is not a failure - it is not retried. */

					throw error;

				}

				lastError =
					error;

				console.warn(
					"[batch-table] row " + row.id + " step " + stage + " attempt " + attempt + " of " + attempts + " did not finish - retrying quietly",
					batchErrorBrief(error)
				);

				if (attempt < attempts) {

					await batchDelay(
						Math.min(
							batchRetrySetting("maxMs", BATCH_RETRY_MAX_MS),
							batchRetrySetting("baseMs", BATCH_RETRY_BASE_MS) * Math.pow(2, attempt - 1)
						)
					);

				}

			}

		}

		throw (
			lastError ||
			batchError("The step did not finish", "BatchStepError")
		);

	}

	function batchActionCell(row, kind) {

		if (!batchRowFinished(row)) {

			/* Not finished: plain text, no button, nothing to press. */
			return (
				'<span class="batch-pending">' +
				(kind === "preview"
					? "Preview Here"
					: "Export Video") +
				"</span>"
			);

		}

		if (kind === "preview") {

			return (
				'<button type="button" class="upload-btn small batch-live" data-batch-action="preview" data-batch-row="' +
				row.id +
				'">\u25b6 Preview</button>'
			);

		}

		return (
			'<button type="button" class="upload-btn small batch-live" data-batch-action="export" data-batch-row="' +
			row.id +
			'">\u2b07 Export Video</button>'
		);

	}

	function batchRowHTML(row, index) {

		const minutes =
			Number(row.minutes) > 0
				? Number(row.minutes)
				: BATCH_MIN_MINUTES;

		const script =
			String(row.script || "").replace(/</g, "&lt;");

		/* The exact pixels this row's images will be rendered at. */
		const frame =
			batchRowDimensions(row);

		return (
			'<tr data-batch-row="' + row.id + '">' +
				'<td class="batch-cell batch-cell-script">' +
					'<div class="batch-row-head">' +
						'<span class="batch-row-no">' + String(index).padStart(2, "0") + "</span>" +
						'<button type="button" class="batch-row-del" data-batch-action="remove" data-batch-row="' + row.id + '" title="Remove this row">\u2715</button>' +
					"</div>" +
					'<textarea class="batch-script-input" data-batch-field="script" rows="5" spellcheck="false" aria-label="Script for row ' + index + '" placeholder="Paste or type the narration script for this row\u2026">' + script + "</textarea>" +
					'<div class="batch-row-status" data-batch-slot="status" data-stage="' + escapeHTML(row.stage) + '" data-loading="' + (batchRowBusy(row) ? "1" : "0") + '">' + batchStatusHTML(row) + "</div>" +
				"</td>" +
				'<td class="batch-cell batch-cell-style">' +
					'<select class="batch-style-select" data-batch-field="style" aria-label="Video image style for row ' + index + '" title="Same ten styles as the script modal">' +
						batchStyleOptionsHTML(row.style) +
					"</select>" +
					'<div class="batch-row-sub">render treatment; stock appearance varies</div>' +
				"</td>" +
				'<td class="batch-cell batch-cell-min">' +
					'<input type="number" class="batch-minutes-input" data-batch-field="minutes" min="' + BATCH_MIN_MINUTES + '" max="' + BATCH_MAX_MINUTES + '" step="1" value="' + minutes + '" aria-label="Minimum length in minutes for row ' + index + '">' +
					'<div class="batch-row-sub">min</div>' +
					"</td>" +
				'<td class="batch-cell batch-cell-resolution">' +
					'<select class="batch-resolution-select" data-batch-field="resolution" aria-label="Output frame resolution for row ' + index + '" title="Output frame long edge. Pixabay source dimensions vary.">' +
					batchResolutionOptionsHTML(row.resolution) +
					"</select>" +
					'<div class="batch-row-sub">' + frame.width + "\u00d7" + frame.height + "</div>" +
					"</td>" +
				'<td class="batch-cell batch-cell-orientation">' +
					'<select class="batch-orientation-select" data-batch-field="orientation" aria-label="Frame orientation for row ' + index + '" title="Output frame shape; guides stock search orientation">' +
					batchOrientationOptionsHTML(row.orientation) +
					"</select>" +
					'<div class="batch-row-sub">frame</div>' +
					"</td>" +
				'<td class="batch-cell batch-cell-action" data-batch-slot="preview">' +
					batchActionCell(row, "preview") +
				"</td>" +
				'<td class="batch-cell batch-cell-action" data-batch-slot="export">' +
					batchActionCell(row, "export") +
				"</td>" +
			"</tr>"
		);

	}

	function batchTableSignature() {

		return batchRows
			.map(function (row) {
				return row.id;
			})
			.join(",");

	}

	function refreshBatchRowCells() {

		for (const row of batchRows) {

			const status =
				document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="status"]');

			if (status) {

				status.innerHTML =
					batchStatusHTML(row);

				status.setAttribute(
					"data-stage",
					row.stage
				);

				status.setAttribute(
					"data-loading",
					batchRowBusy(row) ? "1" : "0"
				);

			}

			for (const kind of ["preview", "export"]) {

				const cell =
					document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="' + kind + '"]');

				if (cell) {

					/* Both cells are rewritten from the same flag, so they
					 * can only ever change - and enable - together. */
					cell.innerHTML =
						batchActionCell(row, kind);

				}

			}

		}

	}

	function renderBatchTable() {

		const body =
			document.getElementById(
				"batch-rows"
			);

		if (!body) {

			return;

		}

		/*
		 * The table starts with one blank row to type into - but only
		 * the first time. After that an empty table stays empty, so a
		 * user can remove every row without the table fighting back.
		 */
		if (
			!batchRows.length &&
			!batchTableSeeded
		) {

			batchTableSeeded =
				true;

			batchRows.push(
				createBatchRow()
			);

		}

		const signature =
			batchTableSignature();

		if (
			body.getAttribute("data-batch-signature") !==
			signature
		) {

			body.innerHTML =
				batchRows
					.map(function (row, index) {
						return batchRowHTML(row, index + 1);
					})
					.join("");

			body.setAttribute(
				"data-batch-signature",
				signature
			);

		}
		else {

			/* Rows already exist - never rebuild the DOM a user is typing in. */
			refreshBatchRowCells();

		}

		updateBatchToolbar();

		const empty =
			document.getElementById(
				"batch-empty"
			);

		if (empty) {

			empty.hidden =
				batchRows.length > 0;

		}

		const addRow =
			document.getElementById(
				"batch-add-row"
			);

		if (addRow) {

			addRow.disabled =
				batchRows.length >=
				BATCH_ROW_LIMIT;

		}

		/* The editor counters keep counting the accordions. */
		const conceptCount =
			document.getElementById(
				"concept-count"
			);

		if (conceptCount) {

			conceptCount.textContent =
				videoProjects.length +
				" of " +
				VIDEO_MAX_VIDEOS +
				" videos";

		}

		const previewState =
			document.getElementById(
				"preview-state"
			);

		if (previewState) {

			previewState.textContent =
				batchRunBusy
					? "table generating"
					: videoProjects.length
						? videoProjects.length + " in queue"
						: "idle";

		}

	}

	function setBatchStage(
		row,
		stage,
		detail
	) {

		row.stage =
			stage;

		row.detail =
			detail || "";

		if (stage === "error") {

			row.error =
				detail || row.error;

		}

		/* Spinner + label for the working stages, plain text otherwise. */
		paintBatchRowStatus(row);

		console.info("[batch-table] row " + row.id, {
			stage: row.stage,
			detail: row.detail,
			mp3: !!row.mp3,
			prompts: row.prompts.length,
			images: row.images.length,
			slides: row.slides.length
		});

	}

	/*
	 * fetch with a hard timeout + an abort handle per row.
	 * When consumeResponse is passed, row.controller and the timeout stay
	 * active while reading the response body (e.g. response.blob() or
	 * response.json()) so stopping a row or hitting a stalled body download
	 * aborts cleanly without a blind spot after HTTP headers arrive.
	 */
	async function batchFetch(
		row,
		url,
		init,
		timeoutMs,
		consumeResponse
	) {

		const controller =
			typeof AbortController !== "undefined"
				? new AbortController()
				: null;

		row.controller =
			controller;

		/*
		 * Session #244: an abort caused by THIS timeout is a retryable
		 * timeout, not a user stop - and it is reported as one, so the
		 * browser's abort wording never becomes a row's status text.
		 */
		let timedOut =
			false;

		let timer =
			controller && typeof setTimeout === "function"
				? setTimeout(function () {
					timedOut = true;
					try {
						controller.abort();
					}
					catch (abortError) { }
				}, timeoutMs || BATCH_REQUEST_TIMEOUT_MS)
				: null;

		const clearHeaderTimer = function () {
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		};

		try {

			const response =
				await fetch(
					url,
					Object.assign(
						{ credentials: "same-origin" },
						init,
						controller ? { signal: controller.signal } : {}
					)
				);

			if (typeof consumeResponse === "function") {
				return await consumeResponse(response, controller, clearHeaderTimer);
			}

			return response;

		}
		catch (fetchError) {

			if (timedOut) {

				throw batchError(
					"The request took too long",
					"TimeoutError"
				);

			}

			if (row.stopRequested) {

				throw batchError(
					"The row was stopped",
					"AbortError"
				);

			}

			/*
			 * Any other abort that is not a stop is still a dead request:
			 * name it as a timeout so the row can retry it quietly.
			 */
			if (batchIsAbortError(fetchError)) {

				throw batchError(
					"The request was interrupted",
					"TimeoutError"
				);

			}

			throw fetchError;

		}
		finally {

			clearHeaderTimer();

			if (row.controller === controller) {
				row.controller =
					null;
			}

		}

	}

	/*
	 * One NDJSON read with an idle budget. A stream that goes quiet is
	 * cancelled and reported as a retryable timeout, so the row can start
	 * the step again instead of waiting for a chunk that never comes.
	 */
	async function batchReadChunk(reader) {

		if (typeof setTimeout !== "function") {

			return reader.read();

		}

		let timer =
			null;

		try {

			return await Promise.race([

				reader.read(),

				new Promise(function (resolve, reject) {

					timer =
						setTimeout(function () {

							try {

								if (reader && typeof reader.cancel === "function") {

									reader.cancel().catch(function () { });

								}

							}
							catch (cancelError) { }

							reject(
								batchError(
									"The image stream stopped sending",
									"TimeoutError"
								)
							);

						}, BATCH_STREAM_IDLE_TIMEOUT_MS);

				})

			]);

		}
		finally {

			if (timer) {

				clearTimeout(timer);

			}

		}

	}

	async function batchRunVoiceStep(row, stage, detail, step) {
		if ((await studioOffload.capabilities()).chunkVoiceover) {
			setBatchStage(row, stage, detail);
			return step();
		}
		return batchRunStep(row, stage, detail, step);
	}

	/* Step 1: the script becomes the voiceover MP3 (worker-side chunked). */
	async function requestBatchVoiceover(row) {
		if ((await studioOffload.capabilities()).chunkVoiceover) {
			return studioOffload.voiceover(String(row.script || "").trim(), "en", {
				isCancelled: function () { return Boolean(row.stopRequested); },
				setController: function (controller) { row.controller = controller; },
				clearController: function (controller) { if (row.controller === controller) row.controller = null; }
			});
		}
		return await batchFetch(
			row,
			"/api/voiceover",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body:
					JSON.stringify({
						text: String(row.script || "").trim(),
						lang: "en"
					})
			},
			BATCH_REQUEST_TIMEOUT_MS,
			async function (response) {

				if (!response.ok) {

					const data =
						await response
							.json()
							.catch(function () { return {}; });

					throw new Error(
						(data && data.error) ||
						("Voiceover failed (HTTP " + response.status + ")")
					);

				}

				return await response.blob();

			}
		);

	}

	/* The MP3 gives the row its timing: length + subtitle spread. */
	async function decodeBatchAudio(row, blob) {

		let timer =
			null;

		try {

			const context =
				getAudioContext();

			if (
				context &&
				context.state === "suspended" &&
				typeof context.resume === "function"
			) {

				try {
					context.resume().catch(function () { });
				}
				catch (resumeError) { }

			}

			const audioBytes =
				(await blob.arrayBuffer()).slice(0);

			const decoded =
				await Promise.race([
					context.decodeAudioData(audioBytes),
					new Promise(function (resolve, reject) {
						timer =
							setTimeout(function () {
								reject(new Error("Audio decode timed out"));
							}, BATCH_AUDIO_DECODE_MS);
					})
				]);

			row.audio = {
				name:
					"Row" + row.id + "-voiceover.mp3",
				duration:
					decoded.duration,
				buffer:
					decoded,
				url:
					null
			};

			return Math.round(decoded.duration * 1000);

		}
		catch (decodeError) {

			console.warn(
				"[batch-table] the MP3 could not be decoded, timing falls back to the minutes setting",
				decodeError
			);

			return 0;

		}
		finally {

			if (timer) {
				clearTimeout(timer);
			}

		}

	}

	/* Step 2: the script + the row's style become the scene prompts. */
	async function requestBatchPrompts(row, batch) {

		const caps = await studioOffload.capabilities();
		const compact = null;
		if (caps.compactPrompts) {
			const owner = { controller: null }; row._promptOwner = owner;
			const response = await studioOffload.jsonRequest("/api/image-prompts", {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ topic: batchRowTopic(row), minutes: row.minutes, style: row.style, batch: batch,
					resolution: batchResolution(row.resolution), orientation: batchOrientation(row.orientation).value, script: String(row.script || "") })
			}, 60000, {
				isCancelled: function () { return Boolean(row.stopRequested); },
				setController: function (controller) { owner.controller = controller; },
				clearController: function (controller) { if (owner.controller === controller) owner.controller = null; }
			});
			const data = await response.json().catch(function () { return null; });
			if (!response.ok || !data || !data.success || !Array.isArray(data.prompts)) {
				const error = new Error((data && data.error) || ("Scene prompt request failed (HTTP " + response.status + ")"));
				error.retryable = response.status === 408 || response.status >= 500 || response.status === 429 || response.ok;
				/* #263: keep the server's load answer so the retry can wait it out. */
				error.status = response.status;
				error.kind = (data && data.kind) || "";
				error.retryAfterMs = data && Number(data.retryAfterMs) > 0 ? Number(data.retryAfterMs) : 0;
				throw error;
			}
			return data.prompts;
		}
		// Separate ownership: prompt lookahead must not overwrite the image stream's Stop handle.
		const owner = Object.create(row);
		row._promptOwner = owner;
		return await batchFetch(
			owner,
			"/api/image-prompts",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body:
					JSON.stringify({
						batch: batch,
						topic:
							batchRowTopic(row),
						minutes:
							row.minutes,
						style:
							row.style,
							/*
							 * Session #211: the frame the row asked for is
							 * written into the prompts themselves, so every
							 * scene is composed for that shape and size.
							 */
							resolution:
								batchResolution(row.resolution),
							orientation:
								batchOrientation(row.orientation).value,
						scriptIdea: compact || undefined,
						script: compact ? undefined : String(row.script || "").trim()
					})
			},
			60000,
			async function (response) {

				const data =
					await response
						.json()
						.catch(function () { return {}; });

				if (!response.ok || !data.success) {

					const error = new Error((data && data.error) || ("Stock search terms failed (HTTP " + response.status + ")"));
					error.retryable = response.status === 408 || response.status >= 500 || response.status === 429 || response.ok;
					throw error;

				}

				const prompts =
					Array.isArray(data.prompts)
						? data.prompts.filter(function (prompt) {
							return typeof prompt === "string" && prompt.trim().length > 0;
						})
						: [];

				if (!prompts.length) {

					throw new Error(
						"No Pixabay scene selections were prepared"
					);

				}

				return prompts;

			}
		);

	}

	function batchRowTopic(row) {

		const firstLine =
			String(row.script || "")
				.split(/\\n+/)
				.map(function (line) { return line.trim(); })
				.filter(Boolean)[0] || "";

		return (
			firstLine ||
			"quick batch row " + row.id
		).slice(0, 90);

	}

	/*
	 * #262: a load rejection is not the user's mistake. Turn the server's
	 * Retry-After hint into one short, actionable sentence instead of leaking a
	 * raw provider string (the browser already honours the wait itself).
	 *
	 * #274: ONLY a server-declared load answer (kind "overload", RULE 31) may
	 * use the reassuring "pause and continue" wording. A bare 503 with no kind
	 * is not load — it is a configuration/authorization failure (missing
	 * PIXABAY_API_KEY, KV outage) that will never "continue", so show its real
	 * message instead of promising a recovery the flow does not perform.
	 */
	function describeImageLoadFailure(error) {
		const retryMs = error && Number(error.retryAfterMs) > 0 ? Number(error.retryAfterMs) : 0;
		const overload = Boolean(
			error && error.kind === "overload"
		);
		if (overload) {
			const seconds = retryMs > 0 ? Math.max(1, Math.ceil(retryMs / 1000)) : 5;
			return "The image server is busy right now \u2014 images pause for about " + seconds + " s and then continue.";
		}
		return (error && error.message) || "Image generation failed";
	}

	/*
	 * #263: a retry wait that Stop can cut short. A plain setTimeout would keep
	 * the row "generating" for up to 15 s after the user pressed Stop, which is
	 * indistinguishable from a hung flow.
	 */
	function pauseWhileActive(ms, owner) {
		return new Promise(function (resolve) {
			const until = Date.now() + ms;
			(function step() {
				if (owner && owner.isCancelled && owner.isCancelled()) return resolve();
				const left = until - Date.now();
				if (left <= 0) return resolve();
				setTimeout(step, Math.min(250, left));
			})();
		});
	}

	/*
	 * #263: one chunk of binary images with bounded, load-aware retries.
	 *
	 * Before this, a chunk was requested exactly once. When every scene in the
	 * *second* chunk hit a transient 5xx/overload (a busy fleet), the chunk
	 * failed, the flow's stop reason was set and the pipeline threw — so a
	 * 10-scene video "finished" with the 3 images of the first chunk. Now:
	 *
	 *   - already-delivered scenes are never re-requested (no duplicates, no
	 *     double billing, no replay of an ambiguous paid image);
	 *   - only the failed scenes are asked again, up to a bounded number of rounds;
	 *   - the wait honours the server's Retry-After hint, then falls back to
	 *     exponential backoff, so a burst of rows does not retry in lockstep;
	 *   - permanent answers (400/401/403/404/422) are not retried at all; 429,
	 *     408 and every 5xx are load/transient answers and are retried.
	 *
	 * onImage(blob, index) still receives the ORIGINAL prompt index, even for
	 * a retried subset, because gallery slots and scene numbers depend on it.
	 */
	async function requestImageChunk(prompts, frame, options) {
		const owner = options || {};
		const rounds = Math.max(1, Number(owner.attempts) || 3);
		const results = new Array(prompts.length);
		let pending = prompts.map(function (_, index) { return index; });
		let hintMs = 0;
		/*
		 * Negotiated per-tab image ceiling (bug fix: image generation felt
		 * serial). Absent/unknown keeps the documented adaptive limit (3 on
		 * a capable device), so an older Worker behaves exactly as before.
		 */
		const caps = await studioOffload.capabilities();
		const imageSlots = Math.max(0, Math.min(8, Number(caps.imageSlots) || 0));

		for (let round = 1; round <= rounds && pending.length; round++) {
			if (owner.isCancelled && owner.isCancelled()) break;
			const batch = pending.slice();
			const perAttempt = {
				slots: imageSlots || undefined,
				isCancelled: owner.isCancelled,
				priority: owner.priority,
				setController: owner.setController,
				clearController: owner.clearController,
				onImage: function (blob, localIndex) {
					const index = batch[localIndex];
					if (typeof index !== "number") return;
					if (owner.onImage) return owner.onImage(blob, index);
				},
				onError: function (error, localIndex) {
					const index = batch[localIndex];
					if (typeof index !== "number") return;
					if (owner.onError) owner.onError(error, index);
				}
			};
			let batchResults;
			try {
				batchResults = await studioOffload.images(
					batch.map(function (index) { return prompts[index]; }),
					frame || {},
					perAttempt
				);
			} catch (roundError) {
				/*
				 * The media scheduler rejects (rather than resolving every scene)
				 * when the flow is cancelled mid-round. That is a Stop, not a
				 * transport failure: leave the round's scenes unset so they are
				 * reported as cancellations below.
				 */
				const cancelled =
					(roundError && roundError.name === "AbortError") ||
					(owner.isCancelled && owner.isCancelled());
				if (cancelled) break;
				throw roundError;
			}

			const retry = [];
			batchResults.forEach(function (result, slot) {
				const index = batch[slot];
				/* Report the scene index, not the slot inside this retry round. */
				if (result) result.index = index;
				if (result && result.ok) {
					results[index] = result;
					return;
				}
				const error = result && result.error;
				const hint = error && Number(error.retryAfterMs) > 0 ? Number(error.retryAfterMs) : 0;
				if (hint > hintMs) hintMs = hint;
				const status = error && Number(error.status);
				/*
				 * Credits/auth/validation will not change on a retry, but 429 and
				 * 408 are load answers ("come back in a moment") and must be
				 * retried, which is why they are excluded here.
				 */
				const permanent =
					(status >= 400 && status < 500 && status !== 429 && status !== 408) ||
					(error && error.retryable === false);
				if (permanent || round === rounds) {
					results[index] = result || { ok: false, index: index, error: error };
					return;
				}
				retry.push(index);
			});

			pending = retry;
			if (!pending.length) break;
			const backoff = Math.min(
				Math.max(hintMs, 800 * Math.pow(2, round - 1)),
				15000
			);
			await pauseWhileActive(backoff, owner);
		}

		/* Cancelled rounds leave holes: report them as failures, never as success. */
		return prompts.map(function (_, index) {
			if (results[index]) return results[index];
			const cancelled = new Error("Image generation was cancelled");
			cancelled.name = "AbortError";
			cancelled.retryable = false;
			return { ok: false, index: index, error: cancelled };
		});
	}

	/* Step 3: one bounded image chunk through the shared browser stream queue. */
	async function requestBatchImages(
		row,
		prompts
	) {
		if ((await studioOffload.capabilities()).binaryImages) {
			const images = [];
			const results = await requestImageChunk(prompts, {
				resolution: batchResolution(row.resolution), orientation: batchOrientation(row.orientation).value
			}, {
				isCancelled: function () { return Boolean(row.stopRequested); },
				priority: function () {
					const tr = document.querySelector('[data-batch-row="' + row.id + '"]');
					return tr && tr.contains(document.activeElement) ? 2 : 0;
				},
				setController: function (controller) { row.controller = controller; },
				clearController: function (controller) { if (row.controller === controller) row.controller = null; },
				onImage: function (blob, index) {
					if (row.stopRequested) return;
					const url = createStudioObjectUrl(blob); row.objectUrls.push(url);
					images.push({ blob: blob, url: url, index: index, stockSource: blob.stockSource || null });
				}
			});
			refreshCredits();
			images.sort(function (a, b) { return a.index - b.index; });
			if (!images.length) throw new Error("No image came out of the binary batch");
			const failedImages = results.filter(function (r) { return !r.ok; }).length;
			if (failedImages) recordStudioUsage("images", "error", failedImages);
			if (failedImages) console.warn("[batch-table] partial binary image batch; no automatic replay");
			return images;
		}
		return appImageStreamQueue.enqueue(
			"table-row-" + row.id,
			async function () {

				const images =
					[];

				let fetchControllerRef =
					null;

				const response =
					await batchFetch(
						row,
						"/api/image-batch",
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"Accept": "application/x-ndjson"
							},
							body:
								JSON.stringify({
									prompts: prompts,
									/* The same frame the prompts were written for. */
									resolution:
										batchResolution(row.resolution),
									orientation:
										batchOrientation(row.orientation).value
								})
						},
						BATCH_REQUEST_TIMEOUT_MS * 2,
						async function (resp, fetchController, clearHeaderTimer) {

							if (!resp.ok) {

								const data =
									await resp
										.json()
										.catch(function () { return {}; });

								if (data && data.credits) {

									applyCredits(data.credits);

								}

								const batchError =
									new Error(
										(data && data.error) ||
										("Image batch failed (HTTP " + resp.status + ")")
									);

								batchError.status =
									resp.status;

								batchError.kind =
									(data && data.kind) || "";

								batchError.retryAfterMs =
									Number(data && data.retryAfterMs) > 0
										? Number(data.retryAfterMs)
										: 0;

								throw batchError;

							}

							/* Headers arrived: per-chunk batchReadChunk now owns idle timeouts. */
							clearHeaderTimer();
							fetchControllerRef = fetchController;
							/* Preserve fetchController as row.controller across return until streamAbortHandle attaches. */
							row.controller = {
								abort: function () {
									if (fetchController) {
										try { fetchController.abort(); } catch (abortErr) { }
									}
								}
							};
							return resp;

						}
					);

				const reader =
					response.body && typeof response.body.getReader === "function"
						? response.body.getReader()
						: null;

				if (!reader) {

					row.controller = null;

					throw new Error("This browser cannot read the image batch stream");

				}

				/*
				 * Keep an abort handle attached while streaming the NDJSON body so
				 * pressing "■ Stop generating" cancels both fetch and stream immediately.
				 */
				const streamAbortHandle = {
					abort: function () {
						if (fetchControllerRef) {
							try {
								fetchControllerRef.abort();
							}
							catch (fetchAbortError) { }
						}
						try {
							if (reader && typeof reader.cancel === "function") {
								reader.cancel().catch(function () { });
							}
						}
						catch (cancelError) { }
					}
				};

				row.controller =
					streamAbortHandle;

				const decoder =
					new TextDecoder();

				let buffer =
					"";

				let failed =
					0;

				let streamFailure = null;
				let streamDone = false;

				let imageCommitChain =
					Promise.resolve();

				const handleEvent = function (event) {

					if (!event || typeof event !== "object") {
						return;
					}

					if (event.type === "done") streamDone = true;
					if (event.type === "error") streamFailure = new Error(event.error || "Image stream failed");
					if (event.credits) {
						applyCredits(event.credits);
					}

					if (
						event.type === "image" &&
						event.ok &&
						event.data
					) {

						/*
						 * Offload base64 decoding immediately onto the background
						 * worker thread pool (or non-blocking event-loop chunks)
						 * while network I/O continues reading the stream.
						 */
						const parsedIndex =
							Number(event.index);

						const decodeTask =
							decodeBase64ImageOffThread(event.data, event.mime);

						imageCommitChain = imageCommitChain.then(function () {

							return decodeTask.then(
								function (blob) {
									blob.stockSource = event.source || null;

									if (row.stopRequested) {
										return;
									}

									const url =
										createStudioObjectUrl(blob);

									row.objectUrls.push(url);

									images.push({
										blob: blob,
										url: url,
										index: Number.isFinite(parsedIndex)
											? parsedIndex
											: images.length
									});

									setBatchStage(
										row,
										"images",
										images.length + " of " + prompts.length + " done"
									);

								},
								function (imageError) {

									failed++;

									console.warn("[batch-table] one image was unusable", imageError);

								}
							);

						});

					}

					if (event.type === "image" && !event.ok) {

						failed++;

					}

				};

				try {

					for (;;) {

						if (row.stopRequested) {

							streamAbortHandle.abort();

							throw batchError(
								"The row was stopped",
								"AbortError"
							);

						}

						/*
						 * Session #244: a stream that stops sending lines must not
						 * hang the row open. Each read gets an idle budget; a stall
						 * is a retryable timeout, so the step is retried quietly
						 * instead of leaving the row "Fetching Pixabay images"
						 * forever (or surfacing an abort message).
						 */
						const chunk =
							await batchReadChunk(reader);

						if (row.stopRequested) {

							throw batchError(
								"The row was stopped",
								"AbortError"
							);

						}

						if (chunk.done) {
							break;
						}

						buffer +=
							decoder.decode(chunk.value, { stream: true });

						let newlineIndex =
							buffer.indexOf("\\n");

						while (newlineIndex >= 0) {

							const line =
								buffer
									.slice(0, newlineIndex)
									.trim();

							buffer =
								buffer.slice(newlineIndex + 1);

							if (line) {

								try {
									handleEvent(JSON.parse(line));
								}
								catch (parseError) { }

							}

							newlineIndex =
								buffer.indexOf("\\n");

						}

					}

					const tail =
						(buffer + decoder.decode()).trim();

					if (tail) {

						try {
							handleEvent(JSON.parse(tail));
						}
						catch (parseError) { }

					}

					await imageCommitChain;

				}
				catch (error) {
					streamFailure = error;
				}
				finally {
					if (streamFailure) streamAbortHandle.abort();
					await imageCommitChain;
					if (row.controller === streamAbortHandle) {

						row.controller =
							null;

					}

				}

				if (row.stopRequested) {
					throw batchError("The row was stopped", "AbortError");
				}

				if (!streamDone && !streamFailure) streamFailure = new Error("Image stream ended before completion");
				if (streamFailure) {
					if (!images.length) throw streamFailure;
					row._imagePipelineWarning = "Image stream was interrupted; delivered images were kept.";
				}
				if (!images.length) {

					throw new Error(
						"No image came out of the batch" +
						(failed ? " (" + failed + " prompt(s) failed)" : "")
					);

				}

				images.sort(function (a, b) {
					return a.index - b.index;
				});

				if (failed) {

					console.warn("[batch-table] row " + row.id + " skipped " + failed + " failed image(s)");

				}

				refreshCredits();

				return images;

			},
			{
				meta: { kind: "batch-row", rowId: row.id },
				isCancelled: function () {
					return Boolean(row && row.stopRequested);
				}
			}
		);

	}

	/* play() is allowed to reject (autoplay policy) - the canvas keeps going. */
	function batchPreviewPlay(audio) {

		if (!audio || typeof audio.play !== "function") {

			return;

		}

		try {

			const played =
				audio.play();

			if (played && typeof played.catch === "function") {

				played.catch(function () { });

			}

		}
		catch (playError) { }

	}

	/* Fit every planned scene inside narration so neither required clip is truncated away. */
	function fitStockSceneTimeline(slides, seconds) {
		if (!slides.length || !Number.isFinite(seconds) || seconds <= 0) return slides;
		const totalFrames = Math.max(slides.length, Math.round(seconds * 30));
		const windowFrames = Math.max(1, Math.floor(totalFrames / slides.length));
		let used = 0;
		const stills = slides.filter(function (slide) { return slide.type !== "mp4"; });
		slides.forEach(function (slide) {
			if (slide.type === "mp4") {
				const frames = Math.min(Math.max(1, Math.floor(slide.duration * 30)), windowFrames);
				slide._partialSec = frames / 30; used += frames;
			}
		});
		let remaining = totalFrames - used;
		stills.forEach(function (slide, index) {
			const frames = Math.floor(remaining / (stills.length - index));
			slide._partialSec = frames / 30; remaining -= frames;
		});
		return slides;
	}

	/* Step 4: the animation - decoded <img> slides in play order. */
	async function buildBatchSlides(row, images) {

		const slides =
			[];

		for (let index = 0; index < images.length; index++) {

			if (row && row.stopRequested) {

				throw batchError("The row was stopped", "AbortError");

			}

			if (images[index].blob.type === "video/mp4") {
				const video = document.createElement("video");
				try {
					const duration = await probeMp4Duration(video, images[index].url);
					if (row.stopRequested) throw batchError("The row was stopped", "AbortError");
					if (!Number.isFinite(duration) || duration <= 0 || duration > MP4_MAX_DURATION_S) throw new Error("Pixabay clip exceeds the supported duration");
					slides.push({ id: "batch-" + row.id + "-clip-" + index, cardId: "", type: "mp4", img: video, videoEl: video, duration: duration });
				} catch (error) {
					video.removeAttribute("src"); video.load();
					slides.forEach(function (slide) { if (slide.videoEl) { slide.videoEl.removeAttribute("src"); slide.videoEl.load(); } });
					throw error;
				}
				continue;
			}

			const img =
				new Image();

			img.src =
				images[index].url;

			let decodeTimer =
				null;

			try {

				/*
				 * decode() is what tells us the pixels are really there. A
				 * browser without it is not failed on: the slide is kept and
				 * the exporter's own draw call is where a broken image would
				 * show up.
				 */
				if (typeof img.decode === "function") {

					await Promise.race([
						img.decode(),
						new Promise(function (_, reject) {

							decodeTimer =
								setTimeout(
									function () { reject(new Error("Pixabay photo decoding timed out; retry this row.")); },
									BATCH_SLIDE_DECODE_MS
								);

						})
					]);

				}

			}
			catch (loadError) {

				img.src = "";
				slides.forEach(function (slide) { if (slide.videoEl) { slide.videoEl.removeAttribute("src"); slide.videoEl.load(); } });
				throw new Error("Pixabay photo " + (index + 1) + " could not be decoded: " + (loadError.message || "invalid image"));

			}
			finally {

				if (decodeTimer) {

					clearTimeout(decodeTimer);

				}

			}

			slides.push({
				id:
					"batch-" + row.id + "-img-" + index,
				cardId:
					"",
				img:
					img
			});

			/* Yield the main thread every 3 decoded slides so browser CPU stays responsive. */
			if (
				index + 1 < images.length &&
				(index + 1) % 3 === 0
			) {

				await batchDelay(0);

			}

		}

		if (!slides.length) {

			throw new Error("None of the row's images could be prepared");

		}

		fitStockSceneTimeline(slides, row.audio && row.audio.duration);
		return slides;

	}

	async function runBatchRow(row) {

		/* A re-run starts from a clean row. */
		revokeBatchRow(row);

		row.stopRequested = false;
		row._imagePipelineWarning = "";
		row.retrying = false;
		row.mp3 = null;
		row.mp3Url = "";
		row.audio = null;
		row.prompts = [];
		row.images = [];
		row.slides = [];
		row.subtitles = [];
		row.animated = false;
		row.error = "";
		row.startedAt = Date.now();

		try {

			/*
			 * Session #244: every step runs through batchRunStep, which
			 * retries a failed step inside this row - silently. The row
			 * never leaves its working animation and never prints an
			 * error, so the table looks the same whether a step needed
			 * one attempt or four.
			 */
			const spanMs =
				await batchRunVoiceStep(
					row,
					"voice",
					"Speaking " + String(row.script || "").trim().length + " characters",
					async function () {

						const blob =
							await requestBatchVoiceover(row);

						if (!blob || !blob.size) {

							throw new Error(
								"The voiceover model returned no audio"
							);

						}

						row.mp3 =
							blob;

						row.mp3Url =
							createStudioObjectUrl(blob);

						row.objectUrls.push(row.mp3Url);

						recordStudioUsage("voiceovers", "ok", 1);

						setBatchStage(row, "timing");

						const measuredMs =
							await decodeBatchAudio(row, blob);

						return (
							measuredMs ||
							Math.round(row.minutes * 60 * 1000)
						);

					}
				);

			/* Subtitles come from the same plain text the voice read. */
			row.subtitles =
				buildScriptCues(
					row.script,
					spanMs
				);

			row.prompts = [];
			row.images = [];
			const expectedImageCount = imageSceneTarget(row.script, row.minutes);
			setBatchStage(row, "prompts", "Preparing the first three Pixabay selections");
			/*
			 * Two chunks in flight when the Worker advertises it (bug fix:
			 * image generation felt serial). Each chunk is three images, so
			 * a ten-scene row keeps up to six requests busy instead of
			 * waiting for its slowest image four separate times. Ordering is
			 * preserved by sorting on the scene index below, which is what
			 * the row's slides and the finished gallery are built from.
			 */
			const rowImageCaps = await studioOffload.capabilities();
			try {
				await runProgressiveImagePipeline({
					total: expectedImageCount,
					isCancelled: function () { return Boolean(row.stopRequested); },
					parallelRenders: Math.max(1, Math.min(4, Number(rowImageCaps.imageChunks) || 1)),
					request: function (batch) { return requestBatchPrompts(row, batch); },
					onPrompts: function (prompts) { row.prompts = prompts; },
					cancelPrompts: function () {
						if (row._promptOwner && row._promptOwner.controller) row._promptOwner.controller.abort();
					},
					render: async function (prompts, offset) {
						setBatchStage(row, "images", row.images.length + " of " + imageSceneTarget(row.script, row.minutes));
						if (offset === 0) startUnprocessedRows(row);
						// Never retry a consumed image batch: it could charge for or duplicate delivered images.
						const images = await requestBatchImages(row, prompts);
						images.forEach(function (image) { image.index += offset; });
						row.images.push.apply(row.images, images);
						row.images.sort(function (a, b) { return a.index - b.index; });
						/* #261: local, best-effort record of usable images. */
						if (images.length) recordStudioUsage("images", "ok", images.length);
						if (row._imagePipelineWarning) throw new Error(row._imagePipelineWarning);
					}
				});
			} catch (pipelineError) {
				// Keep usable earlier batches on a later prompt failure; Stop still stops the row.
				if (row.stopRequested || !row.images.length) throw pipelineError;
				console.warn("[batch-table] using partial image pipeline", batchErrorBrief(pipelineError));
			} finally {
				if (row._promptOwner && row._promptOwner.controller) row._promptOwner.controller.abort();
				row._promptOwner = null;
			}

			/* A partial requestImageChunk result is useful progress, not a
			 * finished Quick Batch row. Otherwise the clip check below could
			 * accept two clips plus an incomplete set of photos and enable
			 * Preview/Export as if every planned scene had arrived. */
			const deliveredSceneIndexes = new Set(row.images.map(function (image) { return Number(image.index); })
				.filter(function (index) { return Number.isInteger(index) && index >= 0 && index < expectedImageCount; }));
			if (deliveredSceneIndexes.size !== expectedImageCount) {
				const missing = [];
				for (let scene = 0; scene < expectedImageCount; scene++) {
					if (!deliveredSceneIndexes.has(scene)) missing.push(scene + 1);
				}
				throw new Error("Pixabay image pipeline incomplete: " + missing.length + " of " + expectedImageCount +
					" planned scenes did not return usable media (scene " + missing.join(", ") + "). Press Generate to retry this row.");
			}

			const clips = row.images.filter(function (media) { return media.blob.type === "video/mp4"; });
			if (clips.length !== 2 || new Set(clips.map(function (media) { return (media.stockSource || media.blob.stockSource || {}).id; })).size !== 2) {
				throw new Error("The scene plan requires two distinct Pixabay video clips; retry with different scene keywords.");
			}

			row.slides =
				await batchRunStep(
					row,
					"animate",
					row.images.length + " slides",
					function () {

						return buildBatchSlides(
							row,
							row.images
						);

					}
				);

			row.animated =
				true;

			row.finishedAt =
				Date.now();

			setBatchStage(
				row,
				"done",
				row.slides.length + " slides \u00b7 " + formatSeconds(spanMs / 1000)
			);

			console.info("[batch-table] row " + row.id + " finished", {
				ms: row.finishedAt - row.startedAt,
				slides: row.slides.length,
				durationMs: spanMs,
				style: row.style
			});

		}
		catch (rowError) {

			/*
			 * Session #244: nothing here is shown to the user. The row goes
			 * back to looking like a row that has not started yet - no error
			 * text, no abort wording (a stop or an abort is not a failure at
			 * all), no warning colour. The next Generate press retries it.
			 */
			const stopped =
				!!row.stopRequested || batchIsStopError(rowError);

			console.warn(
				"[batch-table] row " + row.id + (stopped ? " stopped" : " could not finish after its quiet attempts") + " - no error is shown in the table",
				batchErrorBrief(rowError)
			);

			row.error = stopped ? "" : batchErrorBrief(rowError);
			setBatchStage(row, stopped ? "ready" : "error", row.error);

		}

		refreshBatchRowCells();

		return batchRowFinished(row);

	}

	/* Rows that still need work: a script, and no live Preview/Export yet. */
	function batchRowPending(row) {

		return !!(
			batchRowHasScript(row) &&
			!batchRowFinished(row) &&
			!row.running
		);

	}

	function syncBatchRowsFromDom() {

		for (const row of batchRows) {

			if (!row || row.running) {
				continue;
			}

			const tr =
				document.querySelector('[data-batch-row="' + row.id + '"]');

			if (!tr) {
				continue;
			}

			const scriptEl =
				tr.querySelector('[data-batch-field="script"]');

			if (
				scriptEl &&
				!batchRowHasScript(row) &&
				String(scriptEl.value || "").trim().length > 0
			) {

				row.script =
					String(scriptEl.value || "");

				if (row.stage === "empty") {
					row.stage = "ready";
					paintBatchRowStatus(row);
				}

			}

			const styleEl =
				tr.querySelector('[data-batch-field="style"]');

			if (styleEl && styleEl._batchTouched) {

				syncBatchRowInput(row, "style", styleEl, true);

			}

			const minutesEl =
				tr.querySelector('[data-batch-field="minutes"]');

			if (minutesEl && minutesEl._batchTouched) {

				syncBatchRowInput(row, "minutes", minutesEl, true);

			}

			const resEl =
				tr.querySelector('[data-batch-field="resolution"]');

			if (resEl && resEl._batchTouched) {

				syncBatchRowInput(row, "resolution", resEl, true);

			}

			const orientEl =
				tr.querySelector('[data-batch-field="orientation"]');

			if (orientEl && orientEl._batchTouched) {

				syncBatchRowInput(row, "orientation", orientEl, true);

			}

		}

	}

	async function generateBatchRows() {

		if (batchRunBusy) {

			return;

		}

		syncBatchRowsFromDom();

		const scripted =
			batchRows.filter(batchRowHasScript);

		if (!scripted.length) {

			showRequiredModal([
				"No row has a script yet - type or paste one in column 1 first."
			]);

			return;

		}

		/*
		 * Session #211: a finished row is NEVER generated again. Its two
		 * live buttons (Preview / Export) are the proof that its MP3, its
		 * images and its animation are already in memory, so re-running it
		 * would only re-bill the credits and throw the animation away.
		 */
		const targets =
			batchRows.filter(batchRowPending);

		if (!targets.length) {

			showRequiredModal([
				"Every row with a script is already finished - its Preview and Export buttons are live. Add a row, or clear a finished row's script, to generate again."
			]);

			return;

		}

		/*
		 * Session #248: Three rows process simultaneously in the early pipeline
		 * (BATCH_RUN_CONCURRENCY = 3). When a running row moves to the next step
		 * of processing (stage 'images' / image generation), startUnprocessedRows()
		 * starts the next unprocessed row from batchQueue immediately, so the
		 * 4th and subsequent rows start processing early steps without waiting
		 * for earlier rows to reach 'done'.
		 */
		batchRunBusy =
			true;

		batchQueue =
			targets.slice();

		batchAttemptedRows.clear();

		batchFinishedCount =
			0;

		batchActivePromises.clear();

		renderBatchTable();

		const initialConcurrency =
			Math.max(
				1,
				Math.min(BATCH_RUN_CONCURRENCY, targets.length)
			);

		/* Start the first wave of rows (up to 3) */
		startUnprocessedRows();

		/* Await all active row pipelines and their queued successors */
		while (batchActivePromises.size > 0) {

			await Promise.all(
				Array.from(batchActivePromises)
			);

		}

		batchRunBusy =
			false;

		renderBatchTable();

		console.info("[batch-table] generate pass done", {
			requested: targets.length,
			finished: batchFinishedCount,
			concurrency: initialConcurrency
		});

	}

	/*
	 * Session #248: start unprocessed rows when a row moves to the next step
	 * of processing (ex. image generation) or when early pipeline capacity opens.
	 *
	 * Rule: up to BATCH_RUN_CONCURRENCY (3) rows can process in the early pipeline
	 * steps (voice, timing, prompts) simultaneously. When a row moves to the next
	 * step of processing (stage 'images' / image generation, or beyond), it vacates
	 * its early-pipeline slot. startUnprocessedRows() pulls the next unprocessed
	 * row from the queue so 4th and subsequent rows start processing early steps
	 * instead of waiting for the first 3 rows to completely finish the entire
	 * pipeline (images + animate).
	 */
	function startUnprocessedRows(activeRow) {

		if (!batchRunBusy) {

			return;

		}

		/* If batchQueue is empty but a run is active, harvest any newly-added pending rows that have not run in this pass */
		if (!batchQueue.length) {

			const unqueued =
				batchRows.filter(function (r) {
					return batchRowPending(r) && !batchAttemptedRows.has(String(r.id));
				});

			if (unqueued.length) {
				batchQueue.push.apply(batchQueue, unqueued);
			}

		}

		/*
		 * How many rows are currently in early pipeline steps?
		 * A row is in early pipeline if it is running and has NOT moved to
		 * 'images', 'animate' or 'done'.
		 * If activeRow is passed (indicating it is currently transitioning to
		 * the next step of processing, e.g. image generation), it is excluded
		 * from earlyCount.
		 */
		const earlyCount =
			batchRows.filter(function (r) {

				if (!r || !r.running) {
					return false;
				}

				if (activeRow && String(r.id) === String(activeRow.id)) {
					return false;
				}

				return (
					r.stage !== "images" &&
					r.stage !== "animate" &&
					r.stage !== "done"
				);

			}).length;

		const availableSlots =
			Math.max(
				0,
				BATCH_RUN_CONCURRENCY - earlyCount
			);

		for (let i = 0; i < availableSlots; i++) {

			if (!batchQueue.length || !batchRunBusy) {
				break;
			}

			const row =
				batchQueue.shift();

			if (!row || row.running || batchRowFinished(row) || batchAttemptedRows.has(String(row.id))) {
				continue;
			}

			batchAttemptedRows.add(String(row.id));

			row.running =
				true;

			const promise = (async function (targetRow) {

				try {

					if (await runBatchRow(targetRow)) {

						batchFinishedCount += 1;

					}

				}
				finally {

					targetRow.running =
						false;

					batchActivePromises.delete(promise);

					/*
					 * When a row completes or exits, check if any remaining
					 * unprocessed rows can be started.
					 */
					startUnprocessedRows();

				}

			})(row);

			batchActivePromises.add(promise);

		}

	}

	const startUnprocessedBatchRows =
		startUnprocessedRows;

	function stopBatchRows() {

		batchRunBusy =
			false;

		batchQueue =
			[];

		batchAttemptedRows.clear();

		for (const row of batchRows) {

			/*
			 * Session #244: a stop is a decision, not an error. The row
			 * is marked FIRST, so the aborted fetch is reported as a
			 * stop and never retried or rendered as an abort message.
			 */
			row.stopRequested =
				true;

			row.retrying =
				false;

			if (row._promptOwner && row._promptOwner.controller) {
				row._promptOwner.controller.abort();
			}

			if (row.controller) {

				try {
					row.controller.abort();
				}
				catch (abortError) { }

			}

		}

		appImageStreamQueue.cancelMatching(function (meta) {
			return Boolean(meta && meta.kind === "batch-row");
		}, "The row was stopped");

		renderBatchTable();

	}

	/* ---------------- the row preview player ---------------- */

	function batchPreviewModalId() {
		return "batch-preview-modal";
	}

	function closeBatchPreview() {

		if (batchPreview) {

			if (batchPreview.raf && typeof cancelAnimationFrame === "function") {

				cancelAnimationFrame(
					batchPreview.raf
				);

			}

			if (batchPreview.audio) {

				try {
					batchPreview.audio.pause();
				}
				catch (pauseError) { }

			}

			batchPreview =
				null;

		}

		closeModal(
			document.getElementById(
				batchPreviewModalId()
			)
		);

	}

	function openBatchPreview(id) {

		const row =
			getBatchRow(id);

		if (!row) {
			return;
		}

		if (!batchRowFinished(row)) {

			setBatchStage(
				row,
				row.stage,
				"Preview unlocks when the row is finished"
			);

			return;

		}

		closeBatchPreview();

		/* The preview paints the row's own frame (resolution + orientation). */
		const frame =
			batchRowDimensions(row);

		const modal =
			document.createElement(
				"div"
			);

		modal.id =
			batchPreviewModalId();

		modal.className =
			"modal-overlay batch-preview-overlay";

		modal.setAttribute(
			"data-dismiss",
			"closeBatchPreview"
		);

		modal.innerHTML =
			'<div class="modal-box batch-preview-box">' +
				'<div class="modal-title">\u25b6 Preview \u2014 Row ' + escapeHTML(String(row.id)) + "</div>" +
				'<canvas id="batch-preview-canvas" class="batch-preview-canvas" width="' + frame.width + '" height="' + frame.height + '"></canvas>' +
				'<div class="batch-preview-bar">' +
					'<button type="button" class="upload-btn small" data-batch-preview="toggle">\u23f8 Pause</button>' +
					'<button type="button" class="upload-btn small" data-batch-preview="restart">\u21ba Restart</button>' +
					'<span class="va-note" id="batch-preview-time">0:00</span>' +
				"</div>" +
				'<div class="va-note batch-preview-note">The narration and the burned-in subtitles of this row, exactly as the export will paint them. Nothing is uploaded - the MP4 is only built when you press Export.</div>' +
				'<div class="seo-wt-actions">' +
					'<button type="button" class="upload-btn small" onclick="exportBatchRow(' + row.id + ')">\u2b07 Export Video</button>' +
					'<button type="button" class="upload-btn small" data-batch-preview="close">\u2715 Close</button>' +
				"</div>" +
			"</div>";

		openModal(
			modal
		);

		const canvas =
			modal.querySelector(
				"#batch-preview-canvas"
			);

		const context =
			canvas && typeof canvas.getContext === "function"
				? canvas.getContext("2d")
				: null;

		const audio =
			typeof Audio === "function"
				? new Audio(row.mp3Url)
				: null;

		if (audio) {

			audio.addEventListener(
				"ended",
				function () {

					if (batchPreview) {
						batchPreview.playing = false;
					}

				}
			);

		}

		batchPreview = {
			row: row,
			modal: modal,
			canvas: canvas,
			context: context,
			audio: audio,
			playing: !!audio,
			manualMs: 0,
			raf: 0
		};

		if (audio) {

			batchPreviewPlay(audio);

		}

		modal.addEventListener(
			"click",
			function (event) {

				const target =
					event.target && event.target.closest
						? event.target.closest("[data-batch-preview]")
						: null;

				if (!target) {

					/* A click on the dimmed backdrop puts the player away. */
					if (event.target === modal) {

						closeBatchPreview();

					}

					return;

				}

				const action =
					target.getAttribute(
						"data-batch-preview"
					);

				if (action === "toggle") {

					batchPreviewToggle();

					target.textContent =
						batchPreview && batchPreview.playing
							? "\u23f8 Pause"
							: "\u25b6 Play";

					return;

				}

				if (action === "restart") {

					batchPreviewRestart();

					return;

				}

				closeBatchPreview();

			}
		);

		batchPreviewTick();

	}

	function batchPreviewTimeMs() {

		if (
			batchPreview &&
			batchPreview.audio &&
			Number.isFinite(batchPreview.audio.currentTime)
		) {

			return batchPreview.audio.currentTime * 1000;

		}

		return batchPreview
			? batchPreview.manualMs
			: 0;

	}

	function batchPreviewTick() {

		if (!batchPreview) {
			return;
		}

		const row =
			batchPreview.row;

		const context =
			batchPreview.context;

		if (context && row && row.slides.length) {

			const width =
				batchPreview.canvas.width || 1024;

			const height =
				batchPreview.canvas.height || 576;

			const timestampMs =
				batchPreviewTimeMs();

			const durations = row.slides.map(function (slide) { return slideDurationSec(slide); });
			const totalSeconds = durations.reduce(function (sum, seconds) { return sum + seconds; }, 0);
			const localSeconds = totalSeconds > 0 ? timestampMs / 1000 % totalSeconds : 0;
			let index = 0, sceneStart = 0;
			while (index < row.slides.length - 1 && localSeconds >= sceneStart + durations[index]) { sceneStart += durations[index]; index++; }
			const slide = row.slides[index];
			const phase = (localSeconds - sceneStart) / durations[index];
			if (slide.type === "mp4" && !slide.videoEl.seeking) {
				const targetTime = Math.min(localSeconds - sceneStart, Math.max(0, slide.duration - 0.001));
				if (Math.abs(slide.videoEl.currentTime - targetTime) > 0.1) { try { slide.videoEl.currentTime = targetTime; } catch (_) {} }
			}

			const zoom =
				1 + 0.08 * phase;

			context.fillStyle =
				"#000000";

			context.fillRect(
				0,
				0,
				width,
				height
			);

			if (
				slide &&
				slide.img &&
				(slide.img.naturalWidth || slide.img.videoWidth) && (slide.type !== "mp4" || slide.videoEl.readyState >= 2)
			) {

				const sourceWidth =
					slide.img.naturalWidth || slide.img.videoWidth;

				const sourceHeight =
					slide.img.naturalHeight || slide.img.videoHeight;

				const cover =
					Math.max(
						(width * zoom) / sourceWidth,
						(height * zoom) / sourceHeight
					);

				const drawWidth =
					sourceWidth * cover;

				const drawHeight =
					sourceHeight * cover;

				context.drawImage(
					slide.img,
					(width - drawWidth) / 2,
					(height - drawHeight) / 2,
					drawWidth,
					drawHeight
				);

			}

			if (
				row.subtitles &&
				row.subtitles.length
			) {

				drawSubtitles(
					context,
					row.subtitles,
					timestampMs,
					width,
					height
				);

			}

			const timeEl =
				document.getElementById(
					"batch-preview-time"
				);

			if (timeEl) {

				timeEl.textContent =
					formatSeconds(timestampMs / 1000) +
					" \u00b7 slide " +
					(index + 1) +
					"/" +
					row.slides.length +
					" \u00b7 " +
					row.style;

			}

		}

		if (batchPreview) {

			batchPreview.raf =
				typeof requestAnimationFrame === "function"
					? requestAnimationFrame(batchPreviewTick)
					: 0;

			if (!batchPreview.playing) {

				batchPreview.manualMs +=
					33;

			}

		}

	}

	function batchPreviewToggle() {

		if (!batchPreview || !batchPreview.audio) {
			return;
		}

		if (batchPreview.playing) {

			batchPreview.audio.pause();
			batchPreview.playing = false;

		}
		else {

			batchPreviewPlay(
				batchPreview.audio
			);

			batchPreview.playing = true;

		}

	}

	function batchPreviewRestart() {

		if (!batchPreview) {
			return;
		}

		if (batchPreview.audio) {

			batchPreview.audio.currentTime = 0;

		}

		batchPreview.manualMs = 0;

	}

	/* ---------------- client-side export of one row ---------------- */

	async function exportBatchRow(id) {

		const row =
			getBatchRow(id);

		if (!row) {

			return;

		}

		if (!batchRowFinished(row)) {

			setBatchStage(
				row,
				row.stage,
				"Export unlocks when the row is finished"
			);

			return;

		}

		if (batchRenderBusy) {

			setBatchStage(
				row,
				"done",
				"Another row is still being rendered"
			);

			return;

		}

		/*
		 * The row borrows the shared renderer - the same hidden working
		 * state the bulk queue uses - and gives it back afterwards. The
		 * MP4 is written by this browser: nothing is uploaded and no
		 * second machine is needed.
		 */
		batchRenderBusy =
			true;

		const saved = {
			slides:
				activeSlides.slice(),
			audio:
				currentAudio,
			captions:
				[],
			title:
				titleInputEl ? titleInputEl.value : "",
			workerMode:
				!!window.__workerMode
		};

		if (captionRowsEl) {

			while (captionRowsEl.children.length) {

				saved.captions.push(
					captionRowsEl.children[0]
				);

				captionRowsEl.removeChild(
					captionRowsEl.children[0]
				);

			}

		}

		const minutes =
			Number(row.minutes) > 0
				? Number(row.minutes)
				: BATCH_MIN_MINUTES;

		const rowDims =
			batchRowDimensions(row);

		renderContext = {
			fileName:
				"YouTubeVibeStudio_Row" +
				row.id +
				"_" +
				batchRowTopic(row).replace(/[^A-Za-z0-9]+/g, "").slice(0, 28) +
				".mp4",
			subtitles:
				row.subtitles || [],
			frameWidth:
				rowDims.width,
			frameHeight:
				rowDims.height,
			batchRow:
				true
		};

		if (titleInputEl) {

			/* The table has no title column: no overlay text. */
			titleInputEl.value =
				"";

		}

		activeSlides.length =
			0;

		for (const slide of row.slides) {

			activeSlides.push(
				slide
			);

		}

		currentAudio =
			row.audio;

		/* __workerMode keeps generateMP4 from auto-clicking its own link. */
		window.__workerMode =
			true;

		setBatchStage(
			row,
			"animate",
			"Rendering the MP4 in this browser"
		);

		try {

			window.__lastRenderBlob =
				null;

			await generateMP4();

			const blob =
				window.__lastRenderBlob;

			if (!blob) {

				throw new Error(
					"The renderer did not produce a file"
				);

			}

			downloadBatchBlob(
				renderContext.fileName,
				blob
			);

			setBatchStage(
				row,
				"done",
				"Exported \u00b7 " + Math.round(blob.size / 1024) + " KB"
			);

		}
		catch (renderError) {

			const message =
				renderError && renderError.message
					? renderError.message
					: String(renderError);

			console.error("[batch-table] row " + row.id + " export failed", message);

			setBatchStage(
				row,
				"error",
				"Export failed: " + message
			);

		}
		finally {

			activeSlides.length =
				0;

			for (const slide of saved.slides) {

				activeSlides.push(
					slide
				);

			}

			currentAudio =
				saved.audio;

			if (titleInputEl) {

				titleInputEl.value =
					saved.title;

			}

			if (captionRowsEl) {

				for (const node of saved.captions) {

					captionRowsEl.appendChild(
						node
					);

				}

			}

			window.__workerMode =
				saved.workerMode;

			renderContext =
				null;

			batchRenderBusy =
				false;

			const statusEl =
				document.getElementById(
					"status-text"
				);

			if (statusEl) {

				statusEl.textContent =
					"Quick batch table is idle";

			}

		}

	}

	function downloadBatchBlob(
		fileName,
		blob
	) {

		const url =
			createStudioObjectUrl(
				blob
			);

		const a =
			document.createElement(
				"a"
			);

		a.href =
			url;

		a.download =
			fileName;

		document.body.appendChild(
			a
		);

		a.click();

		a.remove();

		setTimeout(
			function () {
				releaseStudioObjectUrl(url);
			},
			2000
		);

	}

	/*
	 * RULE 25: clearing a finished row's script makes it runnable anew.
	 * Revoke its finished MP3/image object URLs, lock Preview/Export back
	 * to pending placeholders, and return the row to "empty".
	 */
	function resetClearedBatchRow(row) {

		if (!row || row.running) {
			return;
		}

		revokeBatchRow(row);

		row.mp3 =
			null;

		row.mp3Url =
			"";

		row.audio =
			null;

		row.prompts =
			[];

		row.images =
			[];

		row.slides =
			[];

		row.subtitles =
			[];

		row.animated =
			false;

		row.retrying =
			false;

		row.error =
			"";

		row.stage =
			"empty";

		row.detail =
			"";

		paintBatchRowStatus(row);

		for (const kind of ["preview", "export"]) {

			const cell =
				document.querySelector('[data-batch-row="' + row.id + '"] [data-batch-slot="' + kind + '"]');

			if (cell) {

				cell.innerHTML =
					batchActionCell(row, kind);

			}

		}

	}

	function syncBatchScriptStatus(row) {

		if (!row || row.running) {
			return;
		}

		if (
			!batchRowHasScript(row) &&
			(batchRowFinished(row) || row.stage === "done" || row.stage === "error")
		) {

			resetClearedBatchRow(row);

			updateBatchToolbar();

			return;

		}

		if (row.stage === "empty" || row.stage === "ready") {

			row.stage =
				batchRowHasScript(row)
					? "ready"
					: "empty";

			row.detail =
				"";

			paintBatchRowStatus(row);

		}

		updateBatchToolbar();

	}

	/*
	 * Everything the table needs is delegated on the two containers, so
	 * rows added later are wired without re-binding: typing writes back
	 * to the row's state, and the action buttons in the last two cells
	 * are read from the row that owns them.
	 */
	function bindBatchTable() {

		if (batchTableBound) {

			return;

		}

		batchTableBound =
			true;

		const body =
			document.getElementById(
				"batch-rows"
			);

		if (body) {

			body.addEventListener(
				"input",
				function (event) {

					const target =
						event.target;

					if (!target || !target.getAttribute) {

						return;

					}

					const field =
						target.getAttribute(
							"data-batch-field"
						);

					if (!field) {

						return;

					}

					const tr =
						target.closest
							? target.closest("[data-batch-row]")
							: null;

					if (!tr) {

						return;

					}

					const row =
						getBatchRow(
							tr.getAttribute(
								"data-batch-row"
							)
						);

					if (!row) {

						return;

					}

					target._batchTouched =
						true;

					syncBatchRowInput(
						row,
						field,
						target,
						false
					);

					if (field === "script") {

						syncBatchScriptStatus(row);

					}

				}
			);

			/*
			 * Handle "change" across ALL row controls ('style', 'minutes',
			 * 'resolution', 'orientation', and 'script'), since <select>
			 * elements in Safari/WebKit and <input type="number"> blur/spin
			 * commits reliably fire "change".
			 */
			body.addEventListener(
				"change",
				function (event) {

					const target =
						event.target;

					if (!target || !target.getAttribute) {

						return;

					}

					const field =
						target.getAttribute(
							"data-batch-field"
						);

					if (!field) {

						return;

					}

					const tr =
						target.closest
							? target.closest("[data-batch-row]")
							: null;

					if (!tr) {

						return;

					}

					const row =
						getBatchRow(
							tr.getAttribute(
								"data-batch-row"
							)
						);

					if (row) {

						target._batchTouched =
							true;

						syncBatchRowInput(
							row,
							field,
							target,
							true
						);

						if (field === "script") {

							syncBatchScriptStatus(row);

						}

					}

				}
			);

			body.addEventListener(
				"click",
				function (event) {

					const target =
						event.target && event.target.closest
							? event.target.closest("[data-batch-action]")
							: null;

					if (!target) {

						return;

					}

					const action =
						target.getAttribute(
							"data-batch-action"
						);

					const row =
						getBatchRow(
							target.getAttribute(
								"data-batch-row"
							)
						);

					if (action === "remove") {

						removeBatchRow(
							row ? row.id : null
						);

						updateBatchToolbar();

						return;

					}

					if (!row) {

						return;

					}

					if (action === "preview") {

						openBatchPreview(
							row.id
						);

						return;

					}

					if (action === "export") {

						exportBatchRow(
							row.id
						);

					}

				}
			);

		}

		const generate =
			document.getElementById(
				"batch-generate"
			);

		if (generate) {

			generate.addEventListener(
				"click",
				function () {

					/*
					 * Pressing it a second time stops the rows that have not
					 * finished yet - the one control for a run that is taking
					 * too long.
					 */
					if (batchRunBusy) {

						stopBatchRows();

						return;

					}

					generateBatchRows();

				}
			);

		}

		const addRow =
			document.getElementById(
				"batch-add-row"
			);

		if (addRow) {

			addRow.addEventListener(
				"click",
				function () {

					const row =
						addBatchRow();

					if (row) {

						const input =
							document.querySelector(
								'[data-batch-row="' + row.id + '"] [data-batch-field="script"]'
							);

						if (input && input.focus) {

							input.focus();

						}

					}

				}
			);

		}

	}

	/* Exposed for tests / debugging: the live row list, same array. */
	if (typeof window !== "undefined") {

		window.__BATCH_ROWS =
			batchRows;

		/* Session #244: the silent-retry policy (attempts + backoff). */
		window.__BATCH_RETRY =
			batchRetryPolicy;

		/* Session #248: pipeline queue advancement hook */
		window.startUnprocessedRows =
			startUnprocessedRows;

		/* Session #263: the load-aware image chunk retrier (tests / debugging). */
		window.__REQUEST_IMAGE_CHUNK =
			requestImageChunk;

		window.startUnprocessedBatchRows =
			startUnprocessedBatchRows;

	}

	/* The toolbar mirrors the rows: how many can be generated, and busy? */
	function updateBatchToolbar() {

		const runnable =
			batchRows.filter(batchRowHasScript).length;

		const generate =
			document.getElementById(
				"batch-generate"
			);

		if (generate) {

			generate.disabled =
				batchRunBusy
					? false
					: runnable === 0;

			generate.textContent =
				batchRunBusy
					? "\u25a0 Stop generating"
					: "\u2726 Generate" +
						(runnable ? " (" + runnable + ")" : "");

		}

		const note =
			document.getElementById(
				"batch-note"
			);

		if (note) {

			note.textContent =
				batchRows.length +
				" row" +
				(batchRows.length === 1 ? "" : "s") +
				" \u00b7 " +
				runnable +
				" with a script";

		}

		if (studioLayout === "table") {

			const topGen =
				document.getElementById(
					"top-generate"
				);

			if (topGen) {

				topGen.disabled =
					false;

				topGen.textContent =
					batchRunBusy
						? "\u25a0 Stop generating"
						: "\u2726 Generate" +
							(runnable ? " (" + runnable + ")" : "");

				topGen.title =
					batchRunBusy
						? "Stop generating active batch rows"
						: "Generate every unfinished row that has a script (three rows at a time)";

			}

		}

	}

	/*
	 * Keeps the small hint under the resolution select honest: it shows the
	 * pixels the worker will really request for this row's frame.
	 */
	function refreshBatchRowFrame(row) {

		if (!row) {
			return;
		}

		const cell =
			document.querySelector('[data-batch-row="' + row.id + '"] .batch-cell-resolution .batch-row-sub');

		if (!cell) {
			return;
		}

		const frame =
			batchRowDimensions(row);

		cell.textContent =
			frame.width + "\u00d7" + frame.height;

	}

	/* Reads the live inputs back into the row state (never the reverse). */
	function syncBatchRowInput(
		row,
		field,
		element,
		commit
	) {

		if (!row || !element) {

			return;

		}

		if (field === "script") {

			row.script =
				String(element.value || "");

			return;

		}

		if (field === "style") {

			const chosen =
				String(element.value || "").trim();

			if (chosen && SEO_IMAGE_STYLES.indexOf(chosen) !== -1) {

				row.style =
					chosen;

			}

			return;

		}

		if (field === "resolution") {

			row.resolution =
				batchResolution(element.value);

			element.value =
				String(row.resolution);

			refreshBatchRowFrame(row);

			return;

		}

		if (field === "orientation") {

			row.orientation =
				batchOrientation(element.value).value;

			element.value =
				row.orientation;

			refreshBatchRowFrame(row);

			return;

		}

		if (field === "minutes") {

			const rawText =
				String(element.value || "").trim();

			if (!commit && rawText === "") {

				/* Let the user clear the digit while typing a replacement. */
				return;

			}

			const minutes =
				Math.round(
					Number(rawText) || 0
				);

			row.minutes =
				minutes < BATCH_MIN_MINUTES
					? BATCH_MIN_MINUTES
					: minutes > BATCH_MAX_MINUTES
						? BATCH_MAX_MINUTES
						: minutes;

			if (commit && String(element.value) !== String(row.minutes)) {

				element.value =
					String(row.minutes);

			}

			return;

		}

	}

	function bindStudioShell() {

		/* The quick-batch table is part of the shell: bound once, here. */
		bindBatchTable();

		const topGen =
			document.getElementById(
				"top-generate"
			);

		if (topGen) {

			topGen.removeAttribute(
				"onclick"
			);

			topGen.addEventListener(
				"click",
				onGenerateClick
			);

		}

		const buttons =
			document.querySelectorAll(
				"[data-layout]"
			);

		for (const button of buttons) {

			button.addEventListener(
				"click",
				() =>
					setStudioLayout(
						button.getAttribute(
							"data-layout"
						)
					)
			);

		}

		renderBatchTable();

	}


	// =========================================================
	// MODULE 2: video-gallery
	// =========================================================

	/*
	 * One upload per video: files are
	 * recorded by File reference (and
	 * MP4s probed for length) and shown
	 * as cards. Decoding happens only
	 * when the video is rendered.
	 */
	async function onVideoFiles(
		n,
		event
	) {

		const project =
			videoProjects[n - 1];

		const files =
			event.target.files
				? Array.from(
						event.target.files
				  )
				: [];

		/*
		 * Allows the same file to be
		 * selected again later.
		 */
		event.target.value =
			"";

		if (!files.length) {
			return;
		}

		for (
			const file of files
		) {

			const fileIsGif =
				file.type ===
					"image/gif" ||
				/\\.gif$/i.test(
					file.name
				);

			const fileIsMp4 =
				file.type ===
					"video/mp4" ||
				/\\.(mp4|m4v)$/i.test(
					file.name
				);

			const counts =
				videoCounts(
					project
				);

			if (
				fileIsGif &&
				counts.gifs >=
					MAX_GIF_UPLOADS
			) {

				alert(
					"Video " + n +
						": you can add at most " +
						MAX_GIF_UPLOADS +
						" GIFs."
				);

				break;

			}

			if (
				!fileIsGif &&
				!fileIsMp4 &&
				counts.stills >=
					MAX_IMAGE_UPLOADS
			) {

				alert(
					"Video " + n +
						": you can add at most " +
						MAX_IMAGE_UPLOADS +
						" images (jpg, png, jpeg)."
				);

				break;

			}

			if (
				fileIsMp4 &&
				counts.clips >=
					MAX_MP4_UPLOADS
			) {

				alert(
					"Video " + n +
						": you can add at most " +
						MAX_MP4_UPLOADS +
						" MP4 clips."
				);

				break;

			}

			if (fileIsMp4) {

				/*
				 * Probed now so the
				 * 1-minute cap is
				 * enforced at upload.
				 */
				const clipURL =
					createStudioObjectUrl(
						file
					);

				const probed =
					document.createElement(
						"video"
					);

				let clipDuration =
					0;

				try {

					clipDuration =
						await probeMp4Duration(
							probed,
							clipURL
						);

				}
				catch (probeError) {

					releaseStudioObjectUrl(
						clipURL
					);

					alert(
						"'" +
							file.name +
							"' could not be read as an MP4 clip. Try re-exporting it as a standard MP4 (H.264 + AAC)."
					);

					continue;

				}

				if (
					clipDuration >
						MP4_MAX_DURATION_S
				) {

					releaseStudioObjectUrl(
						clipURL
					);

					alert(
						"'" +
							file.name +
							"' is " +
							formatSeconds(
								clipDuration
							) +
							" long. Each MP4 clip must be at most " +
							formatSeconds(
								MP4_MAX_DURATION_S
							) +
							"."
					);

					continue;

				}

				probed.loop =
					true;

				const asset = {
					kind: "mp4",
					file: file,
					stockSource: file.stockSource || null,
					videoEl: probed,
					duration: clipDuration,
					url: clipURL,
					card: null,
				};

				project.assets.push(
					asset
				);

				buildVaCard(
					n,
					asset
				);

			}
			else {

				const asset = {
					kind:
						fileIsGif
							? "gif"
							: "image",
					file: file,
					stockSource: file.stockSource || null,
					url:
						createStudioObjectUrl(
							file
						),
					card: null,
				};

				project.assets.push(
					asset
				);

				buildVaCard(
					n,
					asset
				);

			}

		}

		updateVideoStatus(
			n
		);

	}

	function onVideoAudio(
		n,
		event
	) {

		const project =
			videoProjects[n - 1];

		const file =
			event.target.files &&
			event.target.files[0];

		/*
		 * Allows the same file to be
		 * selected again later.
		 */
		event.target.value =
			"";

		if (!file) {
			return;
		}

		/*
		 * Recorded only; decoded when
		 * the video is rendered. A new
		 * MP3 replaces the old one.
		 */
		project.audioFile =
			file;

		project.audio =
			null;

		const line =
			document.getElementById(
				"va-audio-line-" + n
			);

		if (line) {
			line.textContent =
				"\ud83c\udfb5 " + file.name;
		}

		updateVideoStatus(
			n
		);

	}

	function buildVaCard(
		n,
		asset
	) {

		const gallery =
			document.getElementById(
				"va-gallery-" + n
			);

		const card =
			document.createElement(
				"div"
			);

		card.className =
			"va-card";

		card.draggable =
			true;

		const media =
			document.createElement(
				asset.kind ===
					"mp4"
					? "video"
					: "img"
			);

		media.src =
			asset.url;

		/*
		 * Stop the browser's native
		 * img/video drag so only the
		 * card's reorder drag fires.
		 */
		media.draggable =
			false;

		if (
			asset.kind ===
				"mp4"
		) {

			media.muted =
				true;

			media.loop =
				true;

			media.playsInline =
				true;

		}

		const label =
			document.createElement(
				"div"
			);

		label.className =
			"va-card-label";

		label.textContent =
			asset.kind ===
				"mp4"
			? asset.file.name +
				"  |  " +
				formatSeconds(
					asset.duration
				)
			: asset.file.name;

		label.title =
			label.textContent;

		const removeBtn =
			document.createElement(
				"button"
			);

		removeBtn.type =
			"button";

		removeBtn.className =
			"va-card-remove";

		removeBtn.textContent =
			"\u00d7";

		removeBtn.title =
			"Remove";

		removeBtn.addEventListener(
			"click",
			() =>
				removeVaCard(
					n,
					asset
				)
		);

		/*
		 * Visible drag handle + hover
		 * tooltip (position + name).
		 */
		const handle =
			document.createElement(
				"div"
			);

		handle.className =
			"va-card-handle";

		handle.textContent =
			"\\u283F";

		handle.title =
			"Drag to reorder";

		const tip =
			document.createElement(
				"div"
			);

		tip.className =
			"va-card-tip";

		/*
		 * Drag & drop reordering inside
		 * this video's gallery.
		 */
		card.addEventListener(
			"dragstart",
			(e) => {

				dragCard =
					card;

				card.classList.add(
					"dragging"
				);

				e.dataTransfer.effectAllowed =
					"move";

			}
		);

		card.addEventListener(
			"dragend",
			() => {

				dragCard =
					null;

				card.classList.remove(
					"dragging"
				);

			}
		);

		card.addEventListener(
			"dragover",
			(e) => {

				e.preventDefault();

				card.classList.add(
					"drag-over"
				);

			}
		);

		card.addEventListener(
			"dragleave",
			() => {

				card.classList.remove(
					"drag-over"
				);

			}
		);

		card.addEventListener(
			"drop",
			(e) => {

				e.preventDefault();

				card.classList.remove(
					"drag-over"
				);

				if (!dragCard) {
					return;
				}

				const draggedTop =
					dragCard.getBoundingClientRect()
						.top;

				const targetTop =
					card.getBoundingClientRect()
						.top;

				if (
					draggedTop <
						targetTop
				) {

					gallery.insertBefore(
						dragCard,
						card
					);

				}
				else {

					gallery.insertBefore(
						dragCard,
						card.nextSibling
					);

				}

				syncVaOrder(
					n
				);

				updateVideoStatus(
					n
				);

			}
		);

		card.appendChild(
			media
		);

		card.appendChild(
			label
		);

		card.appendChild(
			removeBtn
		);

		card.appendChild(
			handle
		);

		card.appendChild(
			tip
		);

		asset.card =
			card;

		card._asset =
			asset;

		gallery.appendChild(
			card
		);

	}

	let dragCard =
		null;

	function removeVaCard(
		n,
		asset
	) {

		const project =
			videoProjects[n - 1];

		const idx =
			project.assets.indexOf(
				asset
			);

		if (idx >= 0) {
			project.assets.splice(
				idx,
				1
			);
		}

		if (
			asset.kind !==
				"mp4" &&
			asset.url
		) {

			releaseStudioObjectUrl(
				asset.url
			);

		}

		if (asset.card) {
			asset.card.remove();
		}

		updateVideoStatus(
			n
		);

	}

	/*
	 * Updates each card's tooltip with
	 * its current position and name.
	 */
	function refreshVaTips(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		const gallery =
			document.getElementById(
				"va-gallery-" + n
			);

		if (!gallery) {
			return;
		}

		const cards =
			Array.from(
				gallery.children
			);

		for (
			let i = 0;
			i < cards.length;
			i++
		) {

			const asset =
				cards[i]._asset;

			const tip =
				cards[i].querySelector(
					".va-card-tip"
				);

			if (!tip || !asset) {
				continue;
			}

			const bits =
				[
					"#" + (i + 1),
					asset.file.name,
				];

			if (
				asset.kind ===
					"mp4"
			) {

				bits.push(
					formatSeconds(
						asset.duration
					)
				);

			}

			bits.push(
				asset.kind === "mp4"
					? "MP4"
					: asset.kind === "gif"
						? "GIF"
						: "image"
			);

			tip.textContent =
				bits.join(" \u00b7 ") +
				" \u2014 drag to reorder";

			tip.title =
				tip.textContent;

		}

	}

	/*
	 * After a drop, the DOM order is the
	 * source of truth for the slide
	 * order.
	 */
	function syncVaOrder(
		n
	) {

		const project =
			videoProjects[n - 1];

		const gallery =
			document.getElementById(
				"va-gallery-" + n
			);

		const order =
			Array.from(
				gallery.children
			).map(
				(card) =>
					card._asset
			);

		project.assets.length =
			0;

		for (
			const a of order
		) {

			if (a) {
				project.assets.push(
					a
				);
			}

		}

	}

	function vaCaptionRowHTML() {

		return (
			'<div class="caption-time">' +
			'<input type="number" min="0" max="99" step="1" value="0" class="caption-hh" aria-label="Hours">' +
			'<span>:</span>' +
			'<input type="number" min="0" max="59" step="1" value="0" class="caption-mm" aria-label="Minutes">' +
			'<span>:</span>' +
			'<input type="number" min="0" max="59" step="1" value="0" class="caption-ss" aria-label="Seconds">' +
			'</div>' +
			'<div class="caption-text-wrap">' +
			'<input type="text" class="caption-text" maxlength="' +
			CAPTION_MAX_CHARS +
			'" placeholder="Caption text (max ' +
			CAPTION_MAX_CHARS +
			' characters)">' +
			'<span class="caption-chars">0/' +
			CAPTION_MAX_CHARS +
			'</span>' +
			'</div>' +
			'<button type="button" class="caption-remove" title="Remove caption" onclick="removeVaCaptionRow(this)">&times;</button>'
		);

	}

	function addVaCaptionRow(
		n
	) {

		const rows =
			document.getElementById(
				"va-captions-" + n
			);

		if (!rows) {
			return;
		}

		if (
			rows.children.length >=
				MAX_CAPTIONS
		) {

			return;

		}

		const row =
			document.createElement(
				"div"
			);

		row.className =
			"caption-row";

		row.innerHTML =
			vaCaptionRowHTML();

		const textInput =
			row.querySelector(
				".caption-text"
			);

		textInput.addEventListener(
			"input",
			() => {

				row.querySelector(
					".caption-chars"
				).textContent =
					textInput.value.length +
					"/" +
					CAPTION_MAX_CHARS;

			}
		);

		rows.appendChild(
			row
		);

		updateVideoStatus(
			n
		);

	}

	function removeVaCaptionRow(
		button
	) {

		const row =
			button.closest(
				".caption-row"
			);

		if (
			!row ||
			!row.parentElement
		) {

			return;

		}

		const rowsId =
			row.parentElement.id;

		row.remove();

		const n = Number(
			rowsId.substring(
				"va-captions-".length
			)
		);

		if (
			Number.isFinite(
				n
			)
		) {

			updateVideoStatus(
				n
			);

		}

	}

	// =========================================================
	// MODULE 3: required-modal
	// =========================================================

	function showRequiredModal(
		issues
	) {

		const modal =
			document.getElementById(
				"required-modal"
			);

		const list =
			document.getElementById(
				"required-modal-list"
			);

		if (!modal || !list) {
			return;
		}

		list.innerHTML =
			"";

		for (
			const issue of issues
		) {

			const li =
				document.createElement(
					"li"
				);

			li.textContent =
				issue;

			list.appendChild(
				li
			);

		}

		modal.style.display =
			"flex";

	}

	function closeRequiredModal() {

		const modal =
			document.getElementById(
				"required-modal"
			);

		if (modal) {
			modal.style.display =
				"none";
		}

	}

	// =========================================================
	// MODULE 4: generation-queue
	// =========================================================

	/*
	 * The single generate button:
	 * validates every video in the
	 * stack, warns about missing
	 * required fields, then renders
	 * them in order \u2014 VIDEO_BATCH_SIZE
	 * at a time, last batch may be one.
	 */
	function onGenerateClick() {

		if (studioLayout === "table") {

			if (batchRunBusy) {

				stopBatchRows();

				return;

			}

			generateBatchRows();

			return;

		}

		if (generating) {
			return;
		}

		if (
			!videoProjects.length
		) {

			showRequiredModal(
				[
					"Click the red + button to add a video first."
				]
			);

			return;

		}

		const issues =
			[];

		for (
			const project of videoProjects
		) {

			if (
				!project.assets.length
			) {

				issues.push(
					project.name +
						": add at least one image, GIF or MP4."
				);

			}

		}

		if (issues.length) {

			showRequiredModal(
				issues
			);

			return;

		}

		runGenerationQueue();

	}

	/*
	 * Reads this video's recorded assets
	 * from disk now that its turn has
	 * come: decodes the MP3, decodes
	 * the images and GIFs, and returns
	 * the slides in gallery order.
	 */
	async function prepareVideo(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (project._requiresStockClips) {
			const clips = project.assets.filter(function (a) { return a.imagePromptFlowId && a.kind === "mp4"; });
			if (clips.length !== 2 || new Set(clips.map(function (a) { return a.stockSource && a.stockSource.id; })).size !== 2) {
				throw new Error("This planned video requires two distinct Pixabay clips. Retry the scene flow before export.");
			}
		}

		const slides =
			[];

		if (
			project.audioFile
		) {

			const arrayBuffer =
				await project.audioFile.arrayBuffer();

			const context =
				getAudioContext();

			const decoded =
				await mediaDeadline(context.decodeAudioData(arrayBuffer.slice(0)), 20000, "Editor audio decoding timed out; retry this video.");

			project.audio = {
				name:
					project.audioFile.name,
				duration:
					decoded.duration,
				buffer:
					decoded,
				url:
					null,
			};

			const line =
				document.getElementById(
					"va-audio-line-" + n
				);

			if (line) {
				line.textContent =
					"\ud83c\udfb5 " +
					project.audioFile.name +
					" (" +
					formatSeconds(
						project.audio.duration
					) +
					")";
			}

		}

		for (
			let k = 0;
			k < project.assets.length;
			k++
		) {

			const asset =
				project.assets[k];

			if (
				asset.kind ===
					"mp4"
			) {

				/*
				 * Probed at upload
				 * time; plays in full
				 * length, silent.
				 */
				slides.push(
					{
						id:
							"video" + n +
								"-mp4-" + k,
						cardId:
							"",
						type:
							"mp4",
						videoEl:
							asset.videoEl,
						duration:
							asset.duration,
						img:
							asset.videoEl,
					}
				);

				continue;

			}

			const img =
				new Image();

			img.src =
				asset.url;

			if (
				asset.kind ===
					"gif"
			) {

				const buffer =
					await asset.file.arrayBuffer();

				const gif =
					buildGifSlideFrames(
						parseGifBytes(
							new Uint8Array(
								buffer
							)
						)
					);

				slides.push(
					{
						id:
							"video" + n +
								"-gif-" + k,
						cardId:
							"",
						type:
							"gif",
						gif:
							gif,
						img:
							img,
					}
				);

			}
			else {

				await mediaDeadline(img.decode(), 10000, "Editor photo decoding timed out; retry this video.");

				slides.push(
					{
						id:
							"video" + n +
								"-img-" + k,
						cardId:
							"",
						img:
							img,
					}
				);

			}

		}

		if (project.assets.filter(function (asset) { return asset.imagePromptFlowId && asset.kind === "mp4"; }).length === 2) {
			fitStockSceneTimeline(slides, project.audio && project.audio.duration);
		}
		return slides;

	}

	function swapVaCaptionsIn(
		n
	) {

		const slotRows =
			document.getElementById(
				"va-captions-" + n
			);

		/* The accordion no longer has a caption section: no rows to swap. */
		if (!slotRows) {
			return;
		}

		while (
			slotRows.children.length
		) {

			captionRowsEl.appendChild(
				slotRows.children[0]
			);

		}

	}

	function swapVaCaptionsOut(
		n
	) {

		const slotRows =
			document.getElementById(
				"va-captions-" + n
			);

		if (!slotRows) {
			return;
		}

		while (
			captionRowsEl.children.length
		) {

			slotRows.appendChild(
				captionRowsEl.children[0]
			);

		}

	}

	async function runGenerationQueue() {

		generating =
			true;

		const renderBtn =
			document.getElementById(
				"render-btn"
			);

		const banner =
			document.getElementById(
				"bulk-banner"
			);

		const statusText =
			document.getElementById(
				"status-text"
			);

		if (banner) {
			banner.style.display =
				"block";
		}

		if (renderBtn) {
			renderBtn.disabled =
				true;
		}

		/*
		 * Snapshot the engine's working
		 * state (the hidden main
		 * panels) so it can be restored
		 * afterwards.
		 */
		const saved = {
			slides:
				activeSlides.slice(),
			audio:
				currentAudio,
			captionRows:
				Array.from(
					captionRowsEl.children
				),
			title:
				document.getElementById(
					"title-input"
				).value,
			font:
				document.getElementById(
					"title-font"
				).value,
			color:
				document.getElementById(
					"title-color"
				).value,
			quality:
				document.getElementById(
					"quality-select"
				).value,
		};

		let done =
			0;

		let skipped =
			0;

		let errors =
			0;

		/*
		 * Batches of VIDEO_BATCH_SIZE:
		 * each video fully finishes
		 * before the next starts, so
		 * the first two are done before
		 * the next two begin, and the
		 * last batch may be a single
		 * video.
		 */
		for (
			let n = 1;
			n <= videoProjects.length;
			n++
		) {

			const project =
				videoProjects[n - 1];

			project.status =
				"rendering";

			updateVideoStatus(
				n
			);

			if (statusText) {
				statusText.textContent =
					"Bulk: rendering " +
						project.name +
						" ...";
			}

			let result =
				"error";

			try {

				const slides =
					await prepareVideo(
						n
					);

				swapVaCaptionsIn(
					n
				);

				/*
				 * Point the hidden
				 * engine working state
				 * at this video.
				 */
				document.getElementById(
					"title-input"
				).value =
					document.getElementById(
						"va-title-" + n
					).value;

				document.getElementById(
					"title-font"
				).value =
					document.getElementById(
						"va-font-" + n
					).value;

				document.getElementById(
					"title-color"
				).value =
					document.getElementById(
						"va-color-" + n
					).value;

				document.getElementById(
					"quality-select"
				).value =
					document.getElementById(
						"va-quality-" + n
					).value;

				activeSlides.length =
					0;

				for (
					const slide of slides
				) {

					activeSlides.push(
						slide
					);

				}

				currentAudio =
					project.audio;

				renderContext = {
					fileName:
						"YouTubeVibeStudio_" +
						project.name.replace(
							/\\s+/g,
							""
						) +
						".mp4",
					subtitles:
						project.subtitles ||
						[],
				};

				result =
					(await generateMP4()) ||
					"skipped";

			}
			catch (bulkError) {

				console.error(
					project.name +
						" failed:",
					bulkError
				);

			}
			finally {

				swapVaCaptionsOut(
					n
				);

				activeSlides.length =
					0;

				currentAudio =
					null;

				renderContext =
					null;

			}

			if (
				result ===
					"done"
			) {

				project.status =
					"done";

				done++;

			}
			else if (
				result ===
					"error"
			) {

				project.status =
					"error";

				errors++;

			}
			else {

				project.status =
					"skipped";

				skipped++;

			}

			updateVideoStatus(
				n
			);

		}

	/*
	 * Restore the engine's working
	 * state.
	 */
		activeSlides.length =
			0;

		for (
			const slide of saved.slides
		) {

			activeSlides.push(
				slide
			);

		}

		currentAudio =
			saved.audio;

		captionRowsEl.innerHTML =
			"";

		for (
			const row of saved.captionRows
		) {

			captionRowsEl.appendChild(
				row
			);

		}

		updateCaptionCount();

		document.getElementById(
			"title-input"
		).value =
			saved.title;

		document.getElementById(
			"title-font"
		).value =
			saved.font;

		document.getElementById(
			"title-color"
		).value =
			saved.color;

		document.getElementById(
			"quality-select"
		).value =
			saved.quality;

		generating =
			false;

		if (renderBtn) {
			renderBtn.disabled =
				false;
		}

		if (banner) {
			banner.style.display =
				"none";
		}

		if (statusText) {
			statusText.textContent =
				"Bulk complete: " +
					done +
					" saved, " +
					skipped +
					" skipped, " +
					errors +
					" failed.";
		}

	}

	// =========================================================
	// MODULE 5: ai-images
	// (the 40% right panel of each accordion)
	// =========================================================

	/* Automatic mixed stock scenes are inserted into the shared media gallery. */
	function addAiToVideo(
		n,
		file,
		blob,
		imagePromptFlowId,
		quiet
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return false;
		}

		const counts =
			videoCounts(
				project
			);

		if (
			counts.stills >=
				MAX_IMAGE_UPLOADS
		) {

			if (!quiet) {
				alert(
					"Video " + n +
						": you can add at most " +
						MAX_IMAGE_UPLOADS +
						" images (jpg, png, jpeg)."
				);
			}

			return false;
		}

		const url =
			createStudioObjectUrl(
				blob
			);

		const asset = {
			kind: "image",
			file: file,
			stockSource: blob.stockSource || file.stockSource || null,
			url: url,
			card: null,
			imagePromptFlowId: imagePromptFlowId ? String(imagePromptFlowId) : null,
		};

		project.assets.push(
			asset
		);

		try {
			buildVaCard(
				n,
				asset
			);
			if (imagePromptFlowId && asset.card && asset.card.dataset) {
				asset.card.dataset.imagePromptFlowId = String(imagePromptFlowId);
			}
			updateVideoStatus(
				n
			);
		}
		catch (insertionError) {
			const assetIndex = project.assets.indexOf(asset);
			if (assetIndex >= 0) project.assets.splice(assetIndex, 1);
			if (asset.card && asset.card.parentNode) asset.card.parentNode.removeChild(asset.card);
			try { releaseStudioObjectUrl(url); } catch (revokeError) { }
			throw insertionError;
		}
		return true;

	}

	/*
	 * Fullscreen preview overlay for
	 * a stock image.
	 */
	function showAiFullscreen(
		url
	) {

		let overlay =
			document.getElementById(
				"ai-fullscreen"
			);

		if (!overlay) {

			overlay =
				document.createElement(
					"div"
				);

			overlay.id =
				"ai-fullscreen";

			overlay.className =
				"ai-fullscreen-overlay";

			const img =
				new Image();

			img.className =
				"ai-fullscreen-img";

			img.alt =
				"fullscreen preview";

			const note =
				document.createElement(
					"div"
				);

			note.className =
				"ai-fullscreen-note";

			note.textContent =
				"Click anywhere to close";

			overlay.appendChild(
				img
			);

			overlay.appendChild(
				note
			);

			overlay.addEventListener(
				"click",
				closeAiFullscreen
			);

			document.body.appendChild(
				overlay
			);

		}

		overlay.querySelector(
			"img"
		).src =
			url;

		overlay.style.display =
			"flex";

	}

	function closeAiFullscreen() {

		const overlay =
			document.getElementById(
				"ai-fullscreen"
			);

		if (overlay) {
			overlay.style.display =
				"none";
		}

	}

	// =========================================================
	// MODULE 6: auth
	// (KV-backed login/signup, unlimited users)
	//
	// Flow on load:
	//   GET /api/session
	//     200 -> show the signed-in studio + account footer
	//     401 -> show the public landing; the studio stays gated
	//            until login/signup succeeds
	//     503/network -> keep the public landing; the studio is
	//                    available from its primary action
	//   POST /api/login    (username, password)
	//   POST /api/signup   (username, email,
	//                       password)
	//   POST /api/logout
	//
	// The overlay is built with DOM APIs (no HTML edit).
	// =========================================================

	const AUTH_CONTACT_EMAIL =
		"ytvibemotions.business@gmail.com";

	let authSubmitting =
		false;

	let authIsSignup =
		false;

	let authAccess =
		"checking";

	let pendingStudioEntry =
		false;

	/*
	 * Which URL served this shell (RULE 21):
	 *   ""          the landing page at /
	 *   "freemium"  /free  (no account, 10,000 images/day per IP)
	 *   "studio"    /studio (free_user or paid_user)
	 *   "paid"      /paid  (paid_user only)
	 * The worker injects window.__PLAN_MODE before this script.
	 */
	const PLAN_MODE =
		window.__PLAN_MODE ||
		"";

	/*
	 * Build (once) and show the sign-in
	 * overlay.
	 */
	function buildAuthOverlay() {

		let overlay =
			document.getElementById(
				"auth-overlay"
			);

		if (overlay) {
			return overlay;
		}

		overlay =
			document.createElement(
				"div"
			);

		overlay.id =
			"auth-overlay";

		overlay.className =
			"auth-overlay";

		overlay.style.display =
			"none";

		overlay.setAttribute(
			"aria-hidden",
			"true"
		);

		overlay.innerHTML =
			'<div class="auth-box" role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-describedby="auth-sub">' +
			'<button type="button" class="auth-close" id="auth-close" aria-label="Close">&times;</button>' +
			'<div class="auth-title" id="auth-title">\ud83c\udfac YouTube Vibe Studio</div>' +
			'<div class="auth-sub" id="auth-sub">Sign in to use the studio</div>' +
			'<div class="auth-plan-note">Every plan: 10,000 stock image imports/day (app fair use; Pixabay rate limits also apply) \u00b7 unlimited videos, AI scripts and voiceovers. Server load is balanced automatically, so bursts queue instead of failing.</div>' +
			'<div class="auth-guest-note">No account? <a href="/free">Open the free studio</a> \u2014 stock image search (Pixabay rate limits apply), counted per IP address.</div>' +
			'<div class="auth-error" id="auth-error" role="alert"></div>' +
			'<div class="auth-field" id="auth-email-wrap" style="display:none">' +
			'<label for="auth-email">Email</label>' +
			'<input type="email" id="auth-email" maxlength="64" autocomplete="email">' +
			'</div>' +
			'<div class="auth-field">' +
			'<label for="auth-username">Username</label>' +
			'<input type="text" id="auth-username" maxlength="20" autocomplete="username">' +
			'</div>' +
			'<div class="auth-field">' +
			'<label for="auth-password">Password</label>' +
			'<input type="password" id="auth-password" maxlength="64" autocomplete="current-password">' +
			'</div>' +
			'<div class="auth-field" id="auth-confirm-wrap" style="display:none">' +
			'<label for="auth-confirm">Confirm password</label>' +
			'<input type="password" id="auth-confirm" maxlength="64" autocomplete="new-password">' +
			'</div>' +
			'<button type="button" class="upload-btn auth-submit" id="auth-submit">Sign in</button>' +
			'<button type="button" class="auth-switch" id="auth-switch">New here? Create an account</button>' +
			'</div>';

		document.body.appendChild(
			overlay
		);

		const submitBtn =
			document.getElementById(
				"auth-submit"
			);

		const switchBtn =
			document.getElementById(
				"auth-switch"
			);

		const closeBtn =
			document.getElementById(
				"auth-close"
			);

		submitBtn.addEventListener(
			"click",
			submitAuth
		);

		switchBtn.addEventListener(
			"click",
			() => {

				setAuthMode(
					!authIsSignup
				);

				setAuthError(
					""
				);

			}
		);

		closeBtn.addEventListener(
			"click",
			hideAuthOverlay
		);

		overlay.addEventListener(
			"click",
			(event) => {
				if (event.target === overlay) {
					hideAuthOverlay();
				}
			}
		);

		document.addEventListener(
			"keydown",
			(event) => {
				if (
					event.key === "Escape" &&
					overlay.style.display === "flex"
				) {
					hideAuthOverlay();
				}
			}
		);

		["auth-password", "auth-confirm"].forEach(
			(fieldId) => {

				const field =
					document.getElementById(
						fieldId
					);

				if (field) {
					field.addEventListener(
						"keydown",
						(e) => {

							if (
								e.key ===
									"Enter"
							) {

								submitAuth();

							}

						}
					);
				}

			}
		);

		return overlay;

	}

	function setAuthError(
		message
	) {

		const el =
			document.getElementById(
				"auth-error"
			);

		if (el) {
			el.textContent =
				message ||
				"";
		}

	}

	function setAuthMode(isSignup) {

		authIsSignup =
			Boolean(isSignup);

		const submitBtn =
			document.getElementById(
				"auth-submit"
			);

		const switchBtn =
			document.getElementById(
				"auth-switch"
			);

		const subtitle =
			document.getElementById(
				"auth-sub"
			);

		const emailWrap =
			document.getElementById(
				"auth-email-wrap"
			);

		const confirmWrap =
			document.getElementById(
				"auth-confirm-wrap"
			);

		const password =
			document.getElementById(
				"auth-password"
			);

		if (submitBtn) {
			submitBtn.textContent =
				authIsSignup
					? "Create account"
					: "Sign in";
		}

		if (switchBtn) {
			switchBtn.textContent =
				authIsSignup
					? "Have an account? Sign in"
					: "New here? Create an account";
		}

		if (subtitle) {
			subtitle.textContent =
				authIsSignup
					? "Create an account to start making videos"
					: "Sign in to open your video studio";
		}

		if (emailWrap) {
			emailWrap.style.display =
				authIsSignup
					? "block"
					: "none";
		}

		if (confirmWrap) {
			confirmWrap.style.display =
				authIsSignup
					? "block"
					: "none";
		}

		if (password) {
			password.autocomplete =
				authIsSignup
					? "new-password"
					: "current-password";
		}

	}

	function showAuthOverlay(mode) {

		const overlay =
			buildAuthOverlay();

		if (mode === "signup") {
			setAuthMode(true);
		}
		else if (mode === "login") {
			setAuthMode(false);
		}

		setAuthError("");
		overlay.setAttribute(
			"aria-hidden",
			"false"
		);
		overlay.style.display =
			"flex";

		const firstField =
			document.getElementById(
				authIsSignup
					? "auth-email"
					: "auth-username"
			);

		if (firstField) {
			setTimeout(
				() => firstField.focus(),
				0
			);
		}

	}

	function hideAuthOverlay() {

		const overlay =
			document.getElementById(
				"auth-overlay"
			);

		if (overlay) {
			overlay.style.display =
				"none";
			overlay.setAttribute(
				"aria-hidden",
				"true"
			);
		}

	}

	function showLandingView() {

		const landing =
			document.getElementById(
				"landing-page"
			);

		const studio =
			document.getElementById(
				"studio-app"
			);

		if (landing) {
			landing.hidden = false;
		}

		if (studio) {
			studio.hidden = true;
		}

		hideCreditPill();

		window.scrollTo(0, 0);

	}

	function showStudioView() {

		const landing =
			document.getElementById(
				"landing-page"
			);

		const studio =
			document.getElementById(
				"studio-app"
			);

		if (landing) {
			landing.hidden = true;
		}

		if (studio) {
			studio.hidden = false;
		}

		if (creditState) {
			renderCreditPill();
		}

		window.scrollTo(0, 0);

	}

	function enterStudioFromLanding() {

		if (authAccess === "checking") {
			pendingStudioEntry = true;
			return;
		}

		if (authAccess === "required") {
			showAuthOverlay("signup");
			return;
		}

		showStudioView();

	}

	function bindLandingActions() {

		document.querySelectorAll(
			"[data-auth-open]"
		).forEach(
			(element) => {
				element.addEventListener(
					"click",
					(event) => {
						event.preventDefault();
						showAuthOverlay(
							element.getAttribute(
								"data-auth-open"
							)
						);
					}
				);
			}
		);

		document.querySelectorAll(
			"[data-studio-open]"
		).forEach(
			(element) => {
				element.addEventListener(
					"click",
					enterStudioFromLanding
				);
			}
		);

	}

	function resumeLandingEntry() {

		if (!pendingStudioEntry) {
			return;
		}

		pendingStudioEntry =
			false;

		if (authAccess === "required") {
			showAuthOverlay("signup");
		}
		else if (authAccess === "open") {
			hideAuthOverlay();
			showStudioView();
		}

	}

	/*
	 * Footer (end of the page): an hr
	 * line, then the username, the
	 * Account + Contact us links and
	 * the "Logout (username)" button.
	 */
	function showUserBadge(
		username,
		email
	) {

		let footer =
			document.getElementById(
				"auth-footer"
			);

		if (!footer) {

			footer =
				document.createElement(
					"div"
				);

			footer.id =
				"auth-footer";

			footer.className =
				"auth-footer";

			document.body.appendChild(
				footer
			);

		}

		footer.style.display =
			"block";

		footer.innerHTML =
			"";

		const hr =
			document.createElement(
				"hr"
			);

		hr.className =
			"auth-footer-hr";

		const row =
			document.createElement(
				"div"
			);

		row.className =
			"auth-footer-row";

		const span =
			document.createElement(
				"span"
			);

		span.className =
			"auth-footer-user";

		span.textContent =
			"\ud83d\udc64 " +
			username;

		const accountLink =
			document.createElement(
				"a"
			);

		accountLink.href =
			"/account";

		accountLink.className =
			"auth-footer-link";

		accountLink.id =
			"account-link";

		accountLink.textContent =
			"Account";

		const upgradeLink =
			document.createElement(
				"a"
			);

		upgradeLink.href =
			"/upgrade";

		upgradeLink.className =
			"auth-footer-link";

		upgradeLink.id =
			"upgrade-link";

		upgradeLink.textContent =
			"Upgrade";

		const contactLink =
			document.createElement(
				"a"
			);

		contactLink.href =
			"mailto:" +
				AUTH_CONTACT_EMAIL;

		contactLink.className =
			"auth-footer-link";

		contactLink.id =
			"contact-link";

		contactLink.textContent =
			"Contact us";

		const out =
			document.createElement(
				"button"
			);

		out.type =
			"button";

		out.className =
			"auth-logout";

		out.textContent =
			"Logout (" +
			username +
			")";

		out.addEventListener(
			"click",
			doLogout
		);

		row.appendChild(
			span
		);

		row.appendChild(
			accountLink
		);

		row.appendChild(
			upgradeLink
		);

		row.appendChild(
			contactLink
		);

		row.appendChild(
			out
		);

		footer.appendChild(
			hr
		);

		footer.appendChild(
			row
		);

	}

	/*
	 * The small account box toggled
	 * by the Account link: shows the
	 * signed-in username + email.
	 */
	function toggleAccountBox(
		username,
		email
	) {

		let box =
			document.getElementById(
				"auth-account-box"
			);

		if (!box) {

			box =
				document.createElement(
					"div"
				);

			box.id =
				"auth-account-box";

			box.className =
				"auth-account-box";

			box.style.display =
				"none";

			const footer =
				document.getElementById(
					"auth-footer"
				);

			if (footer) {
				footer.appendChild(
					box
				);
			}

		}

		if (
			box.style.display ===
				"none"
		) {

			box.innerHTML =
				"";

			const uLine =
				document.createElement(
					"div"
				);

			uLine.className =
				"auth-account-line";

			uLine.textContent =
				"Username: " +
				username;

			const eLine =
				document.createElement(
					"div"
				);

			eLine.className =
				"auth-account-line";

			eLine.textContent =
				"Email: " +
				email;

			/*
			 * Plan + today's image credits. The line is
			 * filled by updateAccountCreditLine() from the
			 * latest /api/credits payload (or left empty
			 * until the first load finishes).
			 */
			const cLine =
				document.createElement(
					"div"
				);

			cLine.className =
				"auth-account-line";

			cLine.id =
				"auth-account-credits";

			box.appendChild(
				uLine
			);

			box.appendChild(
				eLine
			);

			box.appendChild(
				cLine
			);

			updateAccountCreditLine();

			box.style.display =
				"block";

		}
		else {

			box.style.display =
				"none";

		}

	}

	/*
	 * Shared handler for the Sign in /
	 * Create account button.
	 */
	async function submitAuth() {

		if (authSubmitting) {
			return;
		}

		const usernameEl =
			document.getElementById(
				"auth-username"
			);

		const passwordEl =
			document.getElementById(
				"auth-password"
			);

		const confirmEl =
			document.getElementById(
				"auth-confirm"
			);

		const emailEl =
			document.getElementById(
				"auth-email"
			);

		if (
			!usernameEl ||
			!passwordEl
		) {
			return;
		}

		const username =
			usernameEl.value.trim();

		const password =
			passwordEl.value;

		const email =
			emailEl
				? emailEl.value.trim()
				: "";

		setAuthError(
			""
		);

		if (
			!/^[a-zA-Z0-9_]{3,20}$/.test(
				username
			)
		) {

			setAuthError(
				"Username: 3-20 letters, numbers or _ ."
			);

			return;

		}

		if (
			authIsSignup &&
			!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(
				email
			)
		) {

			setAuthError(
				"Enter a valid email address."
			);

			return;

		}

		if (
			password.length <
				6
		) {

			setAuthError(
				"Password must be at least 6 characters."
			);

			return;

		}

		if (
			authIsSignup &&
			confirmEl &&
			password !==
				confirmEl.value
		) {

			setAuthError(
				"Passwords do not match."
			);

			return;

		}

		authSubmitting =
			true;

		const submitBtn =
			document.getElementById(
				"auth-submit"
			);

		submitBtn.disabled =
			true;

		submitBtn.textContent =
			"Please wait...";

		try {

			const endpoint =
				authIsSignup
					? "/api/signup"
					: "/api/login";

			const response =
				await fetch(
					endpoint,
					{
						method: "POST",

						headers: {
							"Content-Type":
								"application/json",
						},

						body: JSON.stringify(
							{
								username:
									username,

								email:
									email,

								password:
									password,
							}
						),

						credentials:
							"same-origin",
					}
				);

			let data =
				{};

			try {

				data =
					await response.json();

			}
			catch (jsonError) {

				/* keep {} */

			}

				if (response.ok) {

					authAccess = "authenticated";
					hideAuthOverlay();
					showStudioView();

					showUserBadge(
						data.user &&
						data.user.username
							? data.user.username
							: username,
						data.user &&
						data.user.email
							? data.user.email
							: email
					);

					/*
					 * Signup/login return the plan and today's
					 * counters, so the pill paints instantly;
					 * otherwise fetch them.
					 */
					if (data.credits) {

						applyCredits(
							data.credits
						);

					}
					else {

						refreshCredits();

					}

				}
			else {

				setAuthError(
					data.error ||
					"Request failed (" +
					response.status +
					")"
				);

			}

		}
		catch (netError) {

			setAuthError(
				"Network error: " +
				(netError.message ||
					netError)
			);

		}
		finally {

			authSubmitting =
				false;

			submitBtn.disabled =
				false;

			submitBtn.textContent =
				authIsSignup
					? "Create account"
					: "Sign in";

		}

	}

	async function doLogout() {

		try {

			await fetch(
				"/api/logout",
				{
					method: "POST",

					credentials:
						"same-origin",
				}
			);

		}
		catch (e) {

			/* the UI still locks */

		}

		const footer =
			document.getElementById(
				"auth-footer"
			);

		if (footer) {
			footer.style.display =
				"none";
		}

		pendingStudioEntry = false;
		hideAuthOverlay();
		resetCredits();

		/*
		 * Signing out of /free drops back to guest mode
		 * instead of the landing page: the freemium studio
		 * stays usable without an account.
		 */
		if (PLAN_MODE === "freemium") {
			authAccess = "freemium";
			showStudioView();
			refreshCredits();
			return;
		}

		authAccess = "required";
		showLandingView();

	}

	// =========================================================
	// MODULE 6b: credits
	// (daily credits shown as a pill in the studio and in the
	//  account box. The worker is the source of truth:
	//  GET /api/credits returns the plan and today's counters,
	//  /image/gen returns 429 + the counters when the daily
	//  image allowance is spent.
	//
	//  every plan unlimited videos / AI scripts / voiceovers,
	//             10,000 Pixabay images per day (free, paid_user
	//             and the anonymous guest tier)
	//  Every counter renews at midnight Asia/Taipei (UTC+8).
	// =========================================================

	let creditState =
		null;

	/* 10000 -> "10,000" so a big allowance stays readable */
	function creditFormatNumber(
		value
	) {

		const number =
			Number(value);

		if (!isFinite(number)) {
			return String(
				value == null ? "" : value
			);
		}

		return number.toLocaleString(
			"en-US"
		);

	}

	function creditPlanLabel() {

		return creditState &&
			creditState.plan
			? creditState.plan.label
			: "Free";

	}

	function creditImagesLeft() {

		if (
			!creditState ||
			!creditState.remaining
		) {

			return null;

		}

		return creditState
			.remaining.images;

	}

	function creditImagesLimit() {

		return creditState &&
			creditState.plan &&
			creditState.plan.limits
			? creditState.plan.limits.images
			: 10000;

	}

	function creditImagesValue() {

		const left =
			creditImagesLeft();

		if (
			left === null
		) {

			return "Unlimited";

		}

		return (
			creditFormatNumber(left) +
			" / " +
			creditFormatNumber(
				creditImagesLimit()
			) +
			" left today"
		);

	}

	function creditResetText() {

		if (
			!creditState ||
			!creditState.resetsAt
		) {

			return "Renews daily at midnight (UTC+8)";

		}

		const left =
			new Date(
				creditState.resetsAt
			).getTime() -
			Date.now();

		if (
			!isFinite(left) ||
			left <= 0
		) {

			return "Renewing now (midnight UTC+8)";

		}

		const hours =
			Math.floor(
				left / 3600000
			);

		const minutes =
			Math.floor(
				(left % 3600000) / 60000
			);

		return (
			"Renews in " +
			hours +
			"h " +
			minutes +
			"m (midnight UTC+8)"
		);

	}

	function closeCreditPopover() {

		const popover =
			document.getElementById(
				"credit-popover"
			);

		const button =
			document.getElementById(
				"credit-pill-btn"
			);

		if (popover) {
			popover.hidden = true;
		}

		if (button) {
			button.setAttribute(
				"aria-expanded",
				"false"
			);
		}

	}

	function creditCountText(
		count,
		singular,
		plural
	) {

		const value =
			Number(count) || 0;

		return (
			creditFormatNumber(
				value
			) +
			" " +
			(value === 1
				? singular
				: plural)
		);

	}

	function creditRow(
		label,
		value
	) {

		const row =
			document.createElement(
				"div"
			);

		row.className =
			"credit-row";

		const name =
			document.createElement(
				"span"
			);

		name.textContent =
			label;

		const amount =
			document.createElement(
				"b"
			);

		amount.textContent =
			value;

		row.appendChild(
			name
		);

		row.appendChild(
			amount
		);

		return row;

	}

	function renderCreditPopover() {

		const popover =
			document.getElementById(
				"credit-popover"
			);

		if (!popover) {
			return;
		}

		popover.innerHTML =
			"";

		const head =
			document.createElement(
				"div"
			);

		head.className =
			"credit-popover-head";

		const title =
			document.createElement(
				"span"
			);

		title.textContent =
			"Daily credits";

		const plan =
			document.createElement(
				"span"
			);

		plan.className =
			"credit-plan-tag";

		plan.textContent =
			creditPlanLabel();

		head.appendChild(
			title
		);

		head.appendChild(
			plan
		);

		popover.appendChild(
			head
		);

		popover.appendChild(
			creditRow(
				"\\ud83c\\udfac Video projects",
				"Unlimited"
			)
		);

		popover.appendChild(
			creditRow(
				"\\ud83d\\uddbc Pixabay images",
				creditImagesValue()
			)
		);

		popover.appendChild(
			creditRow(
				"\\u2728 AI scripts",
				"Unlimited"
			)
		);

		popover.appendChild(
			creditRow(
				"\\ud83c\\udfa4 Voiceovers",
				"Unlimited"
			)
		);

		if (
			creditState &&
			creditState.used
		) {

			const used =
				document.createElement(
					"div"
				);

			used.className =
				"credit-used";

			used.textContent =
				"Used today: " +
				creditCountText(
					creditState.used.images,
					"image",
					"images"
				) +
				" \u00b7 " +
				creditCountText(
					creditState.used.scripts,
					"script",
					"scripts"
				) +
				" \u00b7 " +
				creditCountText(
					creditState.used.voiceovers,
					"voiceover",
					"voiceovers"
				);

			popover.appendChild(
				used
			);

		}

		const reset =
			document.createElement(
				"div"
			);

		reset.className =
			"credit-reset";

		reset.textContent =
			creditResetText();

		popover.appendChild(
			reset
		);

		/*
		 * #261 local record. Stored in this browser only; clearing it does
		 * not restore server credits and a full local record never grants
		 * extra ones.
		 */
		const localNote =
			document.createElement(
				"div"
			);

		localNote.className =
			"credit-reset credit-local";

		const localText =
			localUsageText();

		localNote.textContent =
			localText
				? "This device today: " +
					localText +
					". Local record only \\u2014 server credits are authoritative."
				: "This device: no local usage recorded yet.";

		popover.appendChild(
			localNote
		);

		const clearLocal =
			document.createElement(
				"button"
			);

		clearLocal.type =
			"button";
		clearLocal.className =
			"credit-local-clear";
		clearLocal.textContent =
			"Clear this device's usage record";

		clearLocal.addEventListener(
			"click",
			(event) => {

				event.stopPropagation();
				clearLocalUsage();

			}
		);

		popover.appendChild(
			clearLocal
		);

		/*
		 * A guest can turn the anonymous IP allowance into a
		 * named account at any time (same 10,000/day ceiling).
		 */
		if (
			creditState &&
			creditState.plan &&
			creditState.plan.id ===
				"guest"
		) {

			const cta =
				document.createElement(
					"button"
				);

			cta.type =
				"button";

			cta.className =
				"credit-signup";

			cta.textContent =
				"Create a free account \u2014 10,000 images/day";

			cta.addEventListener(
				"click",
				(event) => {

					event.stopPropagation();
					closeCreditPopover();
					showAuthOverlay("signup");

				}
			);

			popover.appendChild(
				cta
			);

		}

	}

	function toggleCreditPopover() {

		const popover =
			document.getElementById(
				"credit-popover"
			);

		const button =
			document.getElementById(
				"credit-pill-btn"
			);

		if (!popover) {
			return;
		}

		const open =
			popover.hidden;

		popover.hidden =
			!open;

		if (button) {
			button.setAttribute(
				"aria-expanded",
				open
					? "true"
					: "false"
			);
		}

		if (open) {

			renderCreditPopover();

			/*
			 * Opening the popover is a cheap moment to
			 * re-read the server counters.
			 */
			refreshCredits();

		}

	}

	function renderCreditPill() {

		if (!creditState) {

			hideCreditPill();

			return;

		}

		let pill =
			document.getElementById(
				"credit-pill"
			);

		if (!pill) {

			pill =
				document.createElement(
					"div"
				);

			pill.id =
				"credit-pill";

			pill.className =
				"credit-pill";

			const button =
				document.createElement(
					"button"
				);

			button.type =
				"button";

			button.id =
				"credit-pill-btn";

			button.className =
				"credit-pill-btn";

			button.setAttribute(
				"aria-haspopup",
				"true"
			);

			button.setAttribute(
				"aria-expanded",
				"false"
			);

			button.setAttribute(
				"aria-controls",
				"credit-popover"
			);

			const dot =
				document.createElement(
					"span"
				);

			dot.className =
				"credit-pill-dot";

			const plan =
				document.createElement(
					"span"
				);

			plan.className =
				"credit-pill-plan";

			plan.id =
				"credit-pill-plan";

			const separator =
				document.createElement(
					"span"
				);

			separator.className =
				"credit-pill-sep";

			const images =
				document.createElement(
					"span"
				);

			images.className =
				"credit-pill-images";

			images.id =
				"credit-pill-images";

			const caret =
				document.createElement(
					"span"
				);

			caret.className =
				"credit-pill-caret";

			caret.setAttribute(
				"aria-hidden",
				"true"
			);

			caret.textContent =
				"\\u25be";

			button.appendChild(
				dot
			);

			button.appendChild(
				plan
			);

			button.appendChild(
				separator
			);

			button.appendChild(
				images
			);

			button.appendChild(
				caret
			);

			button.addEventListener(
				"click",
				(event) => {

					event.stopPropagation();

					toggleCreditPopover();

				}
			);

			const popover =
				document.createElement(
					"div"
				);

			popover.id =
				"credit-popover";

			popover.className =
				"credit-popover";

			popover.hidden =
				true;

			pill.appendChild(
				button
			);

			pill.appendChild(
				popover
			);

			document.body.appendChild(
				pill
			);

		}

		const planEl =
			document.getElementById(
				"credit-pill-plan"
			);

		const imagesEl =
			document.getElementById(
				"credit-pill-images"
			);

		if (planEl) {

			planEl.textContent =
				creditPlanLabel();

		}

		if (imagesEl) {

			imagesEl.textContent =
				creditImagesValue();

		}

		renderCreditPopover();

		pill.hidden =
			false;

	}

	function hideCreditPill() {

		closeCreditPopover();

		const pill =
			document.getElementById(
				"credit-pill"
			);

		if (pill) {
			pill.hidden = true;
		}

	}

	function updateAccountCreditLine() {

		const line =
			document.getElementById(
				"auth-account-credits"
			);

		if (!line) {
			return;
		}

		const local =
			localUsageText();

		line.textContent =
			(creditState
				? "Plan: " +
					creditPlanLabel() +
					" \\u2014 " +
					creditImagesValue()
				: "") +
			(local
				? (creditState ? "  \\u00b7  " : "") +
					"This device: " +
					local
				: "");

		line.title =
			local
				? "Recorded by this browser only (" +
					local +
					" today). Server credits remain authoritative."
				: "";

	}

	/*
	 * #261: local usage record (localStorage + a two-day cookie).
	 *
	 * This is display/history only. It lives on the user's device, can be
	 * cleared, and is never read by the Worker to grant credits: the
	 * existing KV counters and authentication still authorize every paid
	 * request, and /api/credits stays authoritative.
	 */
	function localUsageText() {

		try {

			return studioUsage.describe();

		}
		catch (usageError) {

			return "";

		}

	}

	function refreshLocalUsageUi() {

		try {

			updateAccountCreditLine();

		}
		catch (lineError) {

			/* the account box may not be on screen */

		}

		const popover =
			document.getElementById(
				"credit-popover"
			);

		if (popover && !popover.hidden) {
			renderCreditPopover();
		}

	}

	function recordStudioUsage(
		kind,
		outcome,
		count
	) {

		try {

			studioUsage.record(
				kind,
				outcome,
				count
			);

		}
		catch (usageError) {

			return;

		}

		refreshLocalUsageUi();

	}

	function clearLocalUsage() {

		try {

			studioUsage.clear();

		}
		catch (usageError) {

			/* ignore */

		}

		refreshLocalUsageUi();

	}

	function applyCredits(
		data
	) {

		if (
			!data ||
			!data.plan ||
			!data.remaining
		) {

			return;

		}

		creditState =
			data;

		/* #261: mirror the authoritative summary into the local record. */
		try {
			studioUsage.observe(data);
		}
		catch (usageError) {
			/* a local record never blocks credits */
		}

		renderCreditPill();

		updateAccountCreditLine();

	}

	function resetCredits() {

		creditState =
			null;

		hideCreditPill();

		updateAccountCreditLine();

	}

	async function refreshCredits() {

		try {

			const response =
				await fetch(
					"/api/credits",
					{
						credentials:
							"same-origin",

						cache:
							"no-store",
					}
				);

			if (!response.ok) {

				resetCredits();

				return null;

			}

			let data =
				null;

			try {

				data =
					await response.json();

			}
			catch (jsonError) {

				data = null;

			}

			applyCredits(data);

			return data;

		}
		catch (netError) {

			return null;

		}

	}

	document.addEventListener(
		"click",
		(event) => {

			const pill =
				document.getElementById(
					"credit-pill"
				);

			if (
				pill &&
				!pill.contains(
					event.target
				)
			) {

				closeCreditPopover();

			}

		}
	);

	document.addEventListener(
		"keydown",
		(event) => {

			if (event.key === "Escape") {
				closeCreditPopover();
			}

		}
	);

	// =========================================================
	// MODULE 7: api-render + background worker
	// (POST /api/render takes ALL of a video's elements and
	//  outputs the finished MP4; the background-worker mode
	//  on the current-day settings route renders those jobs in this browser)
	// =========================================================

	function apiSleep(ms) {

		return new Promise(
			(resolve) => {
				setTimeout(resolve, ms);
			}
		);

	}

	function b64ToBytes(b64) {

		const bin = atob(b64);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) {
			bytes[i] = bin.charCodeAt(i);
		}
		return bytes;

	}

	function fileToB64(file) {

		return new Promise(
			(resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const result =
						String(reader.result || "");
					const comma =
						result.indexOf(",");
					resolve(
						comma >= 0
							? result.substring(comma + 1)
							: ""
					);
				};
				reader.onerror = () =>
					reject(reader.error);
				reader.readAsDataURL(file);
			}
		);

	}

	function downloadBlob(
		blob,
		fileName
	) {

		const url =
			createStudioObjectUrl(
				blob
			);

		const a =
			document.createElement(
				"a"
			);

		a.href =
			url;

		a.download =
			fileName;

		document.body.appendChild(
			a
		);

		a.click();

		a.remove();

		setTimeout(
			() => {
				releaseStudioObjectUrl(
					url
				);
			},
			2000
		);

	}

	/*
	 * Collects ALL of video n's elements
	 * (assets, MP3, title, font, colour,
	 * quality, captions) for the
	 * /api/render payload.
	 */
	function collectVideoPayload(
		n
	) {

		const project =
			videoProjects[n - 1];

		const rowsEl =
			document.getElementById(
				"va-captions-" + n
			);

		const captions =
			[];

		if (rowsEl) {

			rowsEl.querySelectorAll(
				".caption-row"
			).forEach(
				(row) => {

					const hh =
						Number(
							row.querySelector(
								".caption-hh"
							).value ||
							0
						);

					const mm =
						Number(
							row.querySelector(
								".caption-mm"
							).value ||
							0
						);

					const ss =
						Number(
							row.querySelector(
								".caption-ss"
							).value ||
							0
						);

					captions.push(
						{
							time:
								hh * 3600 +
								mm * 60 +
								ss,
							text:
								row.querySelector(
									".caption-text"
								).value
						}
					);

				}
			);

		}

		return {
			name:
				project.name,
			project: {
				title:
					document.getElementById(
						"va-title-" + n
					).value,
				font:
					document.getElementById(
						"va-font-" + n
					).value,
				color:
					document.getElementById(
						"va-color-" + n
					).value,
				quality:
					document.getElementById(
						"va-quality-" + n
					).value,
				captions:
					captions,
				subtitles:
					project.subtitles ||
					[]
			},
			assets:
				project.assets,
			audioFile:
				project.audioFile ||
				null
		};

	}

	/*
	 * The "\u2601\ufe0f API" button in each accordion:
	 * uploads all of this video's elements to
	 * POST /api/render, then polls
	 * /api/render/<jobId> until a (background)
	 * worker finishes and the MP4 is ready to
	 * download.
	 */
	async function apiRenderVideo(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		if (
			!project.assets.length
		) {

			alert(
				project.name +
					": add at least one image, GIF or MP4 first."
			);

			return;

		}

		const payload =
			collectVideoPayload(
				n
			);

		const assets =
			[];

		for (
			const a of payload.assets
		) {

			assets.push(
				{
					name:
						a.file.name,
					type:
						a.file.type ||
						"",
					data:
						await fileToB64(
							a.file
						)
				}
			);

		}

		let audio =
			null;

		if (payload.audioFile) {

			audio = {
				name:
					payload.audioFile.name,
				type:
					payload.audioFile.type ||
					"audio/mpeg",
				data:
					await fileToB64(
						payload.audioFile
					)
			};

		}

		const statusText =
			document.getElementById(
				"status-text"
			);

		if (statusText) {
			statusText.textContent =
				"API: uploading " +
				payload.name +
				" ...";
		}

		let response;

		try {

			response =
				await fetch(
					"/api/render",
					{
						method: "POST",
						headers: {
							"Content-Type":
								"application/json"
						},
						body: JSON.stringify(
							{
								name:
									payload.name,
								project:
									payload.project,
								assets:
									assets,
								audio:
									audio
							}
						),
						credentials:
							"same-origin"
					}
				);

		}
		catch (netError) {

			alert(
				"API error: " +
					(netError.message ||
						netError)
			);

			return;

		}

		const submitted =
			await response.json().catch(
				() => ({})
			);

		/*
		 * Busy (10/10 jobs in progress):
		 * not an error \u2014 this browser
		 * renders the video itself with
		 * its own video generation (the
		 * same engine the Generate
		 * Videos button uses).
		 */
		if (
			response.ok &&
			submitted.status ===
				"busy"
		) {

			if (statusText) {
				statusText.textContent =
					"API is busy (" +
					(submitted.inProgress ||
						10) +
					"/" +
					(submitted.max ||
						10) +
					" jobs) \u2014 rendering " +
					payload.name +
					" in this browser ...";
			}

			await renderVideoLocally(
				n
			);

			return;

		}

		if (
			!response.ok ||
			!submitted.jobId
		) {

			alert(
				"API: " +
					(submitted.error ||
						"request failed (" +
						response.status +
						")")
			);

			return;

		}

		const jobId =
			submitted.jobId;

		while (true) {

			await apiSleep(
				4000
			);

			if (statusText) {
				statusText.textContent =
					"API: " +
					payload.name +
					" \u2014 waiting for a worker to render ...";
			}

			let r;

			try {

				r =
					await fetch(
						"/api/render/" +
							jobId,
						{
							credentials:
								"same-origin"
						}
					);

			}
			catch (netError) {
				continue;
			}

			const contentType =
				r.headers.get(
					"Content-Type"
				) ||
				"";

			if (
				r.status === 200 &&
				contentType.indexOf(
					"video/"
				) ===
					0
			) {

				const blob =
					await r.blob();

				downloadBlob(
					blob,
					"API_" +
					payload.name.replace(
						/\\s+/g,
						""
					) +
					".mp4"
				);

				if (statusText) {
					statusText.textContent =
						"\u2713 API render complete: " +
						payload.name;
				}

				return;

			}

			if (r.status === 500) {

				const j =
					await r.json().catch(
						() => ({})
					);

				alert(
					"Render failed: " +
						(j.error ||
							"unknown error")
				);

				return;

			}

			if (r.status === 404) {

				alert(
					"API: job expired or not found."
				);

				return;

			}

		}

	}

	/*
	 * The web app's OWN video generation:
	 * the same internal engine the
	 * Generate Videos button runs, for
	 * just one video. Used as the
	 * fallback when the render API
	 * answers "busy".
	 */
	async function renderVideoLocally(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		if (generating) {

			alert(
				"A video is already being generated \u2014 please wait for it to finish."
			);

			return;

		}

		generating =
			true;

		const renderBtn =
			document.getElementById(
				"render-btn"
			);

		const statusText =
			document.getElementById(
				"status-text"
			);

		if (renderBtn) {
			renderBtn.disabled =
				true;
		}

		/*
		 * Snapshot the engine's working
		 * state so it can be restored.
		 */
		const saved = {
			slides:
				activeSlides.slice(),
			audio:
				currentAudio,
			captionRows:
				Array.from(
					captionRowsEl.children
				),
			title:
				document.getElementById(
					"title-input"
				).value,
			font:
				document.getElementById(
					"title-font"
				).value,
			color:
				document.getElementById(
					"title-color"
				).value,
			quality:
				document.getElementById(
					"quality-select"
				).value,
		};

		project.status =
			"rendering";

		updateVideoStatus(
			n
		);

		if (statusText) {
			statusText.textContent =
				"Rendering " +
				project.name +
				" in this browser ...";
		}

		let result =
			"error";

		try {

			const slides =
				await prepareVideo(
					n
				);

			swapVaCaptionsIn(
				n
			);

			document.getElementById(
				"title-input"
			).value =
				document.getElementById(
					"va-title-" + n
				).value;

			document.getElementById(
				"title-font"
			).value =
				document.getElementById(
					"va-font-" + n
				).value;

			document.getElementById(
				"title-color"
			).value =
				document.getElementById(
					"va-color-" + n
				).value;

			document.getElementById(
				"quality-select"
			).value =
				document.getElementById(
					"va-quality-" + n
				).value;

			activeSlides.length =
				0;

			for (
				const slide of slides
			) {

				activeSlides.push(
					slide
				);

			}

			currentAudio =
				project.audio;

			renderContext = {
				fileName:
					"YouTubeVibeStudio_" +
					project.name.replace(
						/\\s+/g,
						""
					) +
					".mp4",
				subtitles:
					project.subtitles ||
					[],
			};

			result =
				(await generateMP4()) ||
				"skipped";

		}
		catch (localError) {

			console.error(
				project.name +
					" local render failed:",
				localError
			);

		}
		finally {

			swapVaCaptionsOut(
				n
			);

			activeSlides.length =
				0;

			for (
				const slide of
					saved.slides
			) {

				activeSlides.push(
					slide
				);

			}

			currentAudio =
				saved.audio;

			captionRowsEl.innerHTML =
				"";

			for (
				const row of
					saved.captionRows
			) {

				captionRowsEl.appendChild(
					row
				);

			}

			if (
				typeof updateCaptionCount ===
					"function"
			) {

				updateCaptionCount();

			}

			document.getElementById(
				"title-input"
			).value =
				saved.title;

			document.getElementById(
				"title-font"
			).value =
				saved.font;

			document.getElementById(
				"title-color"
			).value =
				saved.color;

			document.getElementById(
				"quality-select"
			).value =
				saved.quality;

			renderContext =
				null;

			generating =
				false;

			if (renderBtn) {
				renderBtn.disabled =
					false;
			}

		}

		if (result === "done") {
			project.status =
				"done";
		}
		else if (
			result === "error"
		) {
			project.status =
				"error";
		}
		else {
			project.status =
				"skipped";
		}

		updateVideoStatus(
			n
		);

		if (statusText) {
			statusText.textContent =
				result ===
					"done"
					? "\u2713 " +
						project.name +
						" rendered in this browser (API was busy)"
					: project.name +
						" local render " +
						result;
		}

	}

	/*
	 * Background-worker side: runs one render
	 * job (from /api/worker/poll) through the
	 * hidden engine, then POSTs the finished
	 * MP4 to /api/worker/deliver. Used by the
	 * day-prefixed settings page in worker mode.
	 */
	async function workerRunJob(
		job
	) {

		window.__workerMode =
			true;

		window.__lastRenderBlob =
			null;

		const project = {
			n: 1,
			name:
				job.name ||
				"Video",
			assets: [],
			audioFile:
				null,
			audio:
				null,
			status:
				"rendering",
			el:
				null
		};

		try {

			for (
				const a of
					job.assets ||
					[]
			) {

				const file =
					new File(
						[
							b64ToBytes(
								a.data
							)
						],
						a.name ||
						"asset",
						{
							type:
								a.type ||
								"application/octet-stream"
						}
					);

				const looksGif =
					/\\.gif$/i.test(
						a.name ||
						""
					) ||
					(a.type ||
						"").indexOf(
						"image/gif"
					) ===
						0;

				const looksMp4 =
					/\\.mp4$/i.test(
						a.name ||
						""
					) ||
					/\\.m4v$/i.test(
						a.name ||
						""
					) ||
					(a.type ||
						"").indexOf(
						"video/mp4"
					) ===
						0;

				const asset = {
					kind:
						looksGif
							? "gif"
							: looksMp4
								? "mp4"
								: "image",
					file:
						file,
					url:
						null,
					card:
						null
				};

				if (
					asset.kind ===
						"mp4"
				) {

					const url =
						createStudioObjectUrl(
							file
						);

					const probed =
						document.createElement(
							"video"
						);

					/*
					 * Same probe as the editor's upload path: a
					 * deadline, a decodable container, and a
					 * finite duration. A skipped clip is better
					 * than a job that restores a NaN length and
					 * renders no frames at all.
					 */

					let clipDuration =
						0;

					try {

						clipDuration =
							await probeMp4Duration(
								probed,
								url
							);

					}
					catch (probeError) {

						console.error(
							"Saved clip could not be probed:",
							probeError
						);

						releaseStudioObjectUrl(
							url
						);

						continue;

					}

					probed.loop =
						true;

					asset.videoEl =
						probed;

					asset.duration =
						clipDuration;

					asset.url =
						url;

				}
				else {

					asset.url =
						createStudioObjectUrl(
							file
						);

				}

				project.assets.push(
					asset
				);

			}

			if (
				job.audio &&
				job.audio.data
			) {

				project.audioFile =
					new File(
						[
							b64ToBytes(
								job.audio.data
							)
						],
						job.audio.name ||
						"audio.mp3",
						{
							type:
								job.audio.type ||
								"audio/mpeg"
						}
					);

			}

			videoProjects.length =
				0;

			videoProjects.push(
				project
			);

			const p =
				job.project ||
				{};

			document.getElementById(
				"title-input"
			).value =
				p.title ||
				"";

			document.getElementById(
				"title-font"
			).value =
				p.font ||
				"oswald";

			document.getElementById(
				"title-color"
			).value =
				p.color ||
				"white";

			document.getElementById(
				"quality-select"
			).value =
				p.quality ||
				"balanced";

			captionRowsEl.innerHTML =
				"";

			(
				p.captions ||
				[]
			).forEach(
				(c) => {

					const t =
						Number(
							c.time ||
							0
						);

					const row =
						document.createElement(
							"div"
						);

					row.className =
						"caption-row";

					row.innerHTML =
						vaCaptionRowHTML();

					row.querySelector(
						".caption-hh"
					).value =
						Math.floor(
							t /
							3600
						);

					row.querySelector(
						".caption-mm"
					).value =
						Math.floor(
							(t % 3600) /
							60
						);

					row.querySelector(
						".caption-ss"
					).value =
						t %
						60;

					row.querySelector(
						".caption-text"
					).value =
						c.text ||
						"";

					captionRowsEl.appendChild(
						row
					);

				}
			);

			if (
				typeof updateCaptionCount ===
					"function"
			) {

				updateCaptionCount();

			}

			const slides =
				await prepareVideo(
					1
				);

			activeSlides.length =
				0;

			for (
				const s of slides
			) {

				activeSlides.push(
					s
				);

			}

			currentAudio =
				project.audio;

			renderContext = {
				fileName:
					"Worker_" +
					(job.name ||
						"video").replace(
						/\\s+/g,
						""
					) +
					".mp4",
				subtitles:
					(job.project &&
						job.project.subtitles) ||
					[]
			};

			const result =
				await generateMP4();

			const blob =
				window.__lastRenderBlob;

			if (
				result !==
					"done" ||
				!blob
			) {

				throw new Error(
					"render produced no output"
				);

			}

			const resp =
				await fetch(
					"/api/worker/deliver?job=" +
						job.id,
					{
						method: "POST",
						body:
							blob,
						credentials:
							"same-origin"
					}
				);

			const d =
				await resp.json().catch(
					() => ({})
				);

			if (!resp.ok) {

				throw new Error(
					d.error ||
					"deliver failed (" +
					resp.status +
					")"
				);

			}

		}
		finally {

			for (
				const a of
					project.assets
			) {

				if (a.url) {
					releaseStudioObjectUrl(
						a.url
					);
				}

			}

			videoProjects.length =
				0;

			activeSlides.length =
				0;

			currentAudio =
				null;

			renderContext =
				null;

			window.__workerMode =
				false;

		}

	}

	/*
	 * On load: ask the worker who we
	 * are. The current-day settings page skips the
	 * auth lock (it has its own password
	 * gate) and may run as a background
	 * worker.
	 */
	async function initAuth() {

		if (window.__CONFIG_PAGE) {
			authAccess = "open";
			showStudioView();
			return;
		}

		/* /free is usable without an account; do not wait for a slow or
		 * stalled session check before showing its studio. The server still
		 * enforces guest credits and detects any signed-in account. */
		if (PLAN_MODE === "freemium") {
			authAccess = "freemium";
			showStudioView();
		}

		try {

			const response =
				await fetch(
					"/api/session",
					{
						credentials:
							"same-origin",
					}
				);

			/* A successful sign-in may finish while the session check is in flight. */
			if (authAccess === "authenticated") {
				return;
			}

			if (response.status === 503) {

				/* No account storage: /free still opens the studio directly.
				 * The landing page keeps its existing open-access action. */
				if (PLAN_MODE === "freemium") {
					authAccess = "freemium";
					hideAuthOverlay();
					showStudioView();
					refreshCredits();
				}
				else {
					authAccess = "open";
					resumeLandingEntry();
				}
				return;

			}

			if (response.ok) {

				let data =
					{};

				try {

					data =
						await response.json();

				}
				catch (jsonError) {

					/* keep {} */

				}

				authAccess = "authenticated";
				hideAuthOverlay();
				showStudioView();

				showUserBadge(
					data.user &&
					data.user.username
						? data.user.username
						: "",
					data.user &&
					data.user.email
						? data.user.email
						: ""
				);

				/*
				 * GET /api/session carries the plan and the
				 * day's counters; fall back to /api/credits
				 * for an older worker response.
				 */
				if (data.credits) {

					applyCredits(
						data.credits
					);

				}
				else {

					refreshCredits();

				}

				return;

			}

			/*
			 * /free is the freemium entry: no account
			 * needed, boot the studio with the IP-keyed
			 * guest credits (10,000 images per day).
			 */
			if (PLAN_MODE === "freemium") {
				authAccess = "freemium";
				hideAuthOverlay();
				showStudioView();
				refreshCredits();
				return;
			}

			/* A missing/invalid session leaves the public landing open. */
			authAccess = "required";
			showLandingView();
			resumeLandingEntry();

		}
		catch (netError) {

			if (PLAN_MODE === "freemium") {
				authAccess = "freemium";
				showStudioView();
				refreshCredits();
				return;
			}

			/* A session endpoint outage must not lock out open access. */
			authAccess = "open";
			resumeLandingEntry();

		}

	}

	// =========================================================
	// =========================================================
	// MODULE 8: script (plain narration text)
	// (AI script generation. The server route /api/script uses
	//  an INSTRUCT model on Workers AI, set in the SCRIPT_MODEL
	//  constant - the old free llama-3.1-8b-instruct was
	//  deprecated by Cloudflare on 2026-05-30, so it is now the
	//  cheap llama-3.1-8b-instruct-fp8 instruct model. Minutes
	//  1-6 + speech speed: super fast / fast / medium / slow.)
	//
	// WHAT THE CLIENT HOLDS: plain spoken text only. The
	// worker uses cue timings internally to prove the script
	// fits the requested minutes, then sends the sentences.
	// There is deliberately no subtitle format anywhere in the
	// browser - the voiceover model would read cue numbers and
	// "-->" timestamps out loud, so no code here parses or
	// renders one either.
	// =========================================================

	function setScriptBoxState(
		n,
		open
	) {

		const project =
			videoProjects[n - 1];

		const hasScript =
			!!(project && project.script);

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		const toggle =
			document.getElementById(
				"va-script-toggle-" + n
			);

		const showBox =
			hasScript && !!open;

		if (box) {
			box.style.display =
				showBox ? "" : "none";
		}

		if (toggle) {
			toggle.style.display =
				hasScript ? "" : "none";

			toggle.textContent =
				(showBox
					? "\u25b2 "
					: "\u25bc ") +
				"Script";
		}

	}

	function toggleScriptBox(n) {

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		if (!box) {
			return;
		}

		setScriptBoxState(
			n,
			box.style.display === "none"
		);

	}

	function showScriptBox(n) {

		setScriptBoxState(n, true);

	}

	/*
	 * The voiceover speaks the generated
	 * narration script, so its button stays
	 * HIDDEN while the video has no script
	 * and is revealed + enabled as soon as
	 * one has been generated.
	 */

	function syncVoiceoverButton(n) {

		const project =
			videoProjects[n - 1];

		const btn =
			document.getElementById(
				"va-voice-btn-" + n
			);

		if (!btn) {
			return;
		}

		const hasScript =
			!!(project && project.script);

		btn.style.display =
			hasScript ? "" : "none";

		btn.disabled =
			!hasScript;

	}

	function toggleGalleryScroll(n) {

		const gallery =
			document.getElementById(
				"va-gallery-" + n
			);

		const toggle =
			document.getElementById(
				"va-gallery-toggle-" + n
			);

		if (!gallery || !toggle) {
			return;
		}

		const open =
			gallery.style.display === "none";

		gallery.style.display =
			open ? "" : "none";

		toggle.textContent =
			(open
				? "\u25b2 "
				: "\u25bc ") +
			"Images / MP4s";

	}

	/*
	 * Shows the full SEO plan the worker
	 * verified for this explainer script:
	 * the AI title (it carries at least
	 * one short keyword), the section
	 * headings (at least one carries a
	 * short keyword), the single long-tail
	 * keyword and the exactly 4 short
	 * keywords - each with how often it
	 * actually appears in the spoken
	 * script. Frequency is a MINIMUM
	 * only: the long-tail keyword must
	 * be said at least once and every
	 * short keyword at least twice, and
	 * extra uses are never rejected.
	 * The counts come from the worker,
	 * which counts them after stripping
	 * cue numbers and timestamps.
	 */

	function renderSeoKeywords(
		n,
		data
	) {

		const box =
			document.getElementById(
				"va-script-keywords-" + n
			);

		if (!box) {
			return;
		}

		const keywords =
			(data && data.keywords) || {};

		/* one long-tail object (not an array) */
		const longs =
			keywords.longTail &&
			keywords.longTail.keyword
				? [keywords.longTail]
				: [];

		const shorts =
			Array.isArray(keywords.short)
				? keywords.short
				: [];

		const title =
			(data && data.title) || "";

		const headings =
			data && Array.isArray(data.headings)
				? data.headings
				: [];

		if (
			!title &&
			!headings.length &&
			!longs.length &&
			!shorts.length
		) {

			box.style.display = "none";

			box.innerHTML = "";

			return;

		}

		let html =
			'<div class="va-seo-heading">SEO plan \u2014 counted in the script</div>';

		if (title) {

			html +=
				'<div class="va-seo-row">' +
				'<span class="va-seo-label">Title</span>' +
				'<span class="va-seo-chip" title="Explainer title \u2014 includes at least one short keyword">' +
				escapeHTML(title) +
				"</span></div>";

		}

		if (headings.length) {

			html +=
				'<div class="va-seo-row">' +
				'<span class="va-seo-label">Headings</span>';

			headings.forEach(
				(item) => {

					html +=
						'<span class="va-seo-chip" title="Section heading \u2014 at least one heading includes a short keyword">' +
						escapeHTML(item) +
						"</span>";

				}
			);

			html +=
				"</div>";

		}

		html +=
			'<div class="va-seo-row">' +
			'<span class="va-seo-label">Long-tail</span>';

		longs.forEach(
			(item) => {

				html +=
					'<span class="va-seo-chip long" title="Long-tail keyword \u2014 must be said at least ' +
					item.min +
					'\u00d7">' +
					escapeHTML(item.keyword) +
					" <b>" +
					item.count +
					"\u00d7</b></span>";

			}
		);

		html +=
			'</div><div class="va-seo-row">' +
			'<span class="va-seo-label">Short</span>';

		shorts.forEach(
			(item) => {

				html +=
					'<span class="va-seo-chip short" title="Short keyword \u2014 must be said at least ' +
					item.min +
					'\u00d7; shared occurrences inside the long-tail count too; one short keyword is in the title and one in a heading">' +
					escapeHTML(item.keyword) +
					" <b>" +
					item.count +
					"\u00d7</b></span>";

			}
		);

		html +=
			"</div>";

		box.innerHTML =
			html;

		box.style.display =
			"";

	}


	// =========================================================
	// MODULE 8b: seo-walkthrough + one-shot Pixabay image generation
	//
	// Generate SEO Script now runs a walkthrough:
	//   1. The "Upload Image, GIF or MP4" button is disabled and
	//      a modal asks the AI (POST /api/seo-plan) for TWO
	//      different SEO keyword sets for the topic. The modal
	//      can be closed while the plan is generated; the work
	//      keeps running in the background and the modal
	//      re-opens by itself when the two sets arrive.
	//   2. The user clicks Select on one set, then enters the
	//      video image style. With both chosen the walkthrough
	//      moves to its "writing" panel, the script section shows
	//      a loading animation and POST /api/script writes the
	//      plain narration script from the selected set (two
	//      automatic retries on failure before the accordion
	//      reports the error — see runSeoScriptRequest).
	//   3. The browser requests at most THREE scene prompts, starts their
	//      image stream, and requests the next prompt batch concurrently.
	//      One lookahead batch bounds memory; retries apply only to prompts.
	//   4. Every image stream is drained before the next starts. Finalization
	//      counts the whole flow and restores this video's controls. No KV,
	//      background jobs, server-side video management or polling is needed.
	// =========================================================

	/*
	 * ---------------------------------------------------------
	 * MODAL STACK (shared by the walkthrough + voiceover modals)
	 *
	 * More than one video can be mid-walkthrough at the same
	 * time, so a modal is never a single shared element any
	 * more: every modal is registered here, gets its own
	 * z-index above the one before it, and is closed only by its
	 * own video. A modal that still owes the user a choice (a
	 * keyword set or a video image style) refuses to be hidden by
	 * Escape, so a click in another accordion can never lose it.
	 * ---------------------------------------------------------
	 */

	const MODAL_BASE_Z_INDEX = 1200;

	const modalStack = [];

	function modalBringToFront(modal) {

		if (!modal) {
			return;
		}

		const position = modalStack.indexOf(modal);

		if (position !== -1) {
			modalStack.splice(position, 1);
		}

		modalStack.push(modal);

		modal.style.zIndex =
			String(MODAL_BASE_Z_INDEX + (modalStack.length - 1) * 10);

	}

	function openModal(modal) {

		if (!modal) {
			return;
		}

		if (modal.parentNode !== document.body) {
			document.body.appendChild(modal);
		}

		modalBringToFront(modal);

		modal.style.display = "flex";

	}

	function closeModal(modal) {

		if (!modal) {
			return;
		}

		const position = modalStack.indexOf(modal);

		if (position !== -1) {
			modalStack.splice(position, 1);
		}

		if (modal.parentNode) {
			modal.parentNode.removeChild(modal);
		}

	}

	function topModal() {
		return modalStack.length ? modalStack[modalStack.length - 1] : null;
	}

	/* The walkthrough keeps a choice pending until style + set are both in. */
	function modalBlocksEscape(modal) {
		return modal && modal.getAttribute("data-await-choice") === "1";
	}

	document.addEventListener(
		"keydown",
		(event) => {

			if (event.key !== "Escape") {
				return;
			}

			const modal = topModal();

			if (!modal || modalBlocksEscape(modal)) {
				return;
			}

			const dismiss = modal.getAttribute("data-dismiss");

			if (dismiss && typeof window[dismiss] === "function") {
				window[dismiss]();
			}

		}
	);

	/* The whole prompt LLM call happens inside this one request. */
	const IMAGE_PROMPT_REQUEST_TIMEOUT_MS =
		60000;

	/* A batch stream that sends nothing for this long is treated as dead. */
	const IMAGE_BATCH_IDLE_TIMEOUT_MS =
		120000;

	/* Exposed so tests / debugging can see the live timing. */
	if (typeof window !== "undefined") {
		window.__SEO_FLOW_TIMING = {
			imagePromptRequestTimeoutMs: IMAGE_PROMPT_REQUEST_TIMEOUT_MS,
			imageBatchIdleTimeoutMs: IMAGE_BATCH_IDLE_TIMEOUT_MS
		};
	}

	async function seoFetchWithTimeout(url, options, timeoutMs, project, controllerKey, consumeResponse) {
		if (typeof AbortController === "undefined") {
			const response = await fetch(url, options);
			return consumeResponse ? consumeResponse(response) : response;
		}
		const controller = new AbortController();
		if (project && controllerKey) project[controllerKey] = controller;
		let timedOut = false;
		const timer = setTimeout(function () { timedOut = true; controller.abort(); }, timeoutMs);
		try {
			const response = await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
			return consumeResponse ? await consumeResponse(response) : response;
		}
		catch (error) {
			if (timedOut || batchIsAbortError(error)) {
				throw batchError(timedOut ? "Scene prompt request timed out; please retry." : "Scene prompt request was interrupted.", "TimeoutError");
			}
			throw error;
		}
		finally {
			clearTimeout(timer);
			if (project && controllerKey && project[controllerKey] === controller) {
				project[controllerKey] = null;
			}
		}
	}

	async function seoResponseJson(response) {
		return response.json().catch(function () { return {}; });
	}

	function seoImageStyleOptionsHTML(selectedStyle) {
		const selected = SEO_IMAGE_STYLES.indexOf(selectedStyle) !== -1
			? selectedStyle
			: DEFAULT_SEO_IMAGE_STYLE;
		return SEO_IMAGE_STYLES.map(function (style) {
			return '<option value="' + escapeHTML(style) + '"' +
				(style === selected ? ' selected' : '') +
				'>' + escapeHTML(style) + '</option>';
		}).join("");
	}

	function setVaUploadEnabled(
		n,
		enabled
	) {

		const btn =
			document.getElementById(
				"va-upload-btn-" + n
			);

		if (btn) {
			btn.disabled =
				!enabled;
		}

	}

	function setScriptLoading(
		n,
		on
	) {

		const project =
			videoProjects[n - 1];

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		if (!box) {
			return;
		}

		if (on) {

			box.classList.add(
				"va-script-loading"
			);

			box.style.display =
				"";

			box.innerHTML =
				'<span class="va-spinner" aria-hidden="true"></span><span>Writing your SEO script\\u2026</span>';

		}
		else {

			box.classList.remove(
				"va-script-loading"
			);

			if (
				!(project && project.script)
			) {

				box.style.display =
					"none";

				box.textContent =
					"";

			}

		}

	}

	/*
	 * ONE walkthrough per video: 'seo-walkthrough-modal-<n>'.
	 * Every element inside it is suffixed the same way, so two
	 * videos can be mid-walkthrough together without either one
	 * stealing, replacing or closing the other's modal — the old
	 * shared '#seo-walkthrough-modal' could only ever hold the
	 * last video that pressed the button, which threw away a
	 * style choice that had not been confirmed yet.
	 */

	function seoWalkthroughModalId(n) {
		return "seo-walkthrough-modal-" + n;
	}

	function getSeoWalkthrough(n) {
		return document.getElementById(seoWalkthroughModalId(n));
	}

	/* One element inside this video's walkthrough. */
	function seoWtEl(n, name) {
		return document.getElementById(name + "-" + n);
	}

	function setSeoWalkthroughChoicePending(
		n,
		pending
	) {

		const modal =
			getSeoWalkthrough(n);

		if (modal) {
			modal.setAttribute(
				"data-await-choice",
				pending ? "1" : "0"
			);
		}

	}

	/* Writes (or clears) the red line at the bottom of one walkthrough. */
	function setSeoWalkthroughError(
		n,
		message
	) {

		const slot =
			seoWtEl(
				n,
				"seo-wt-error"
			);

		if (!slot) {
			return;
		}

		slot.textContent =
			message || "";

	}

	/* Mirrors the accordion status line into the open walkthrough. */
	function setSeoWalkthroughScriptStatus(
		n,
		message
	) {

		const slot =
			seoWtEl(
				n,
				"seo-wt-script-status"
			);

		if (slot) {
			slot.textContent =
				message || "";
		}

	}

	function ensureSeoWalkthrough(
		n
	) {

		/*
		 * Already open for THIS video: bring it to the front
		 * instead of rebuilding it, so an unconfirmed keyword
		 * set / style selection survives another press.
		 */
		const existing =
			getSeoWalkthrough(n);

		if (existing) {
			modalBringToFront(existing);
			existing.style.display = "flex";
			return existing;
		}

		const project = videoProjects[n - 1];

		const selectedStyle = project && SEO_IMAGE_STYLES.indexOf(project.videoImageStyle) !== -1
			? project.videoImageStyle
			: DEFAULT_SEO_IMAGE_STYLE;

		const modal =
			document.createElement(
				"div"
			);

		modal.id =
			seoWalkthroughModalId(n);

		modal.className =
			"modal-overlay";

		modal.setAttribute(
			"data-dismiss",
			"closeSeoWalkthroughTop"
		);

		modal.innerHTML =
			'<div class="modal-box seo-wt-box">' +
			'<div class="modal-title">\\u2728 Generate SEO Script \\u2014 Video ' + n + '</div>' +
			'<div class="seo-wt-steps">' +
			'<span class="seo-wt-step" data-step="plan">1 \\u00b7 SEO plan</span>' +
			'<span class="seo-wt-step" data-step="sets">2 \\u00b7 Choose a keyword set</span>' +
			'<span class="seo-wt-step" data-step="style">3 \\u00b7 Video image style</span>' +
			'<span class="seo-wt-step" data-step="script">4 \\u00b7 Script + images</span>' +
			'</div>' +
			'<div id="seo-wt-loading-' + n + '">' +
			'<div class="seo-wt-loading"><span class="va-spinner" aria-hidden="true"></span><span>AI is planning two SEO keyword sets for <b id="seo-wt-topic-' + n + '"></b>\\u2026</span></div>' +
			'<span class="va-note">You can close this window while you wait \\u2014 the SEO plan and the script keep generating in the background, the modal re-opens itself when there is something to choose, and the finished script lands in Video ' + n + ' \\u00b7 Script. The Upload Image, GIF or MP4 button stays disabled until the Pixabay images are in the gallery.</span>' +
			'</div>' +
			'<div id="seo-wt-sets-' + n + '" style="display:none">' +
			'<div class="va-note">Pick the keyword set that best targets your script topic. The script will say its long-tail keyword at least once and each short keyword at least twice. This window stays open for you \\u2014 other videos keep their own windows.</div>' +
			'<div class="seo-wt-sets" id="seo-wt-sets-list-' + n + '"></div>' +
			'</div>' +
			'<div id="seo-wt-style-' + n + '" style="display:none">' +
			'<div id="seo-wt-selected-' + n + '"></div>' +
			'<label class="seo-wt-style-label" for="seo-wt-style-select-' + n + '">Video treatment (Pixabay stock appearance varies)</label>' +
			'<select id="seo-wt-style-select-' + n + '" aria-describedby="seo-wt-style-note-' + n + '">' + seoImageStyleOptionsHTML(selectedStyle) + '</select>' +
			'<span class="va-note" id="seo-wt-style-note-' + n + '">Choose one visual style. The model will search Pixabay for broad scenes that fit the script, using the long-tail and short SEO keywords as search terms. Scene count follows the script word count: 6 scenes up to 130 words, 8 up to 240 words, 10 up to 500 words (10 beyond that); every plan includes two Pixabay video scenes and the rest are stock photos.</span>' +
			'<span class="va-note">Nothing is lost if you close this window after pressing Generate: the script and its images keep running in the background for Video ' + n + '.</span>' +
			'<div class="seo-wt-actions">' +
			'<button type="button" class="upload-btn" onclick="confirmSeoStyleAndGenerate(' + n + ')">\\u2728 Generate Script &amp; Images</button>' +
			'<button type="button" class="upload-btn" onclick="showSeoWalkthroughStep(' + n + ', &quot;sets&quot;)">\\u2190 Back to keyword sets</button>' +
			'</div>' +
			'</div>' +
			'<div id="seo-wt-script-' + n + '" style="display:none">' +
			'<div class="seo-wt-loading"><span class="va-spinner" aria-hidden="true"></span><span>Writing the Video ' + n + ' narration script from the selected keyword set\\u2026</span></div>' +
			'<span class="va-note"><b>You can close this window while you wait for the SEO script.</b> Closing only hides this window \\u2014 it does not cancel anything. The script keeps generating, the plain narration text appears in Video ' + n + ' \\u00b7 Script, and the Pixabay images start by themselves right after. Press \\u2728 Generate SEO Script again to bring this window back.</span>' +
			'<span class="va-note" id="seo-wt-script-status-' + n + '">Waiting for the script\\u2026</span>' +
			'</div>' +
			'<div class="seo-wt-error" id="seo-wt-error-' + n + '"></div>' +
			'<div class="seo-wt-actions">' +
			'<button type="button" class="upload-btn" onclick="closeSeoWalkthrough(' + n + ')">\\u2715 Close</button>' +
			'</div>' +
			'</div>';

		openModal(
			modal
		);

		const styleSelect = modal.querySelector("#seo-wt-style-select-" + n);

		if (styleSelect && project) {
			styleSelect.addEventListener("change", function () {
				project.videoImageStyle = styleSelect.value;
			});
		}

		return modal;

	}

	/* Removes ONLY this video's walkthrough. */
	function closeSeoWalkthrough(n) {

		const modal =
			typeof n === "number"
				? getSeoWalkthrough(n)
				: topModal();

		if (!modal) {
			return;
		}

		if (typeof n === "number") {
			const project = videoProjects[n - 1];
			/* A pending choice is a real loss: say so, keep the modal. */
			if (project && project._seoChoicePending) {
				setSeoWalkthroughChoicePending(
					n,
					false
				);
				if (project._seoPlanBusy || project._imageFlowActive) {
					project._seoChoicePending = false;
				}
			}
		}

		closeModal(
			modal
		);

	}

	/* Escape / the stack dismisses only the front window, never a video's
	 * walkthrough that is still waiting for the user's style choice. */
	function closeSeoWalkthroughTop() {

		const modal =
			topModal();

		if (!modal || modalBlocksEscape(modal)) {
			return;
		}

		closeModal(
			modal
		);

	}

	function showSeoWalkthrough(n) {

		const modal =
			getSeoWalkthrough(n);

		if (modal) {
			modalBringToFront(modal);
			modal.style.display =
				"flex";
		}

	}

	function showSeoWalkthroughStep(
		n,
		step
	) {

		const modal =
			getSeoWalkthrough(n);

		if (!modal) {
			return;
		}

		const panels = {
			plan: "seo-wt-loading",
			sets: "seo-wt-sets",
			style: "seo-wt-style",
			script: "seo-wt-script"
		};

		for (
			const key of Object.keys(panels)
		) {

			const panel =
				seoWtEl(
					n,
					panels[key]
				);

			if (panel) {
				panel.style.display =
					key === step
						? ""
						: "none";
			}

		}

		modal.querySelectorAll(
			".seo-wt-step"
		).forEach(
			(chip) => {

				chip.classList.toggle(
					"active",
					chip.getAttribute("data-step") === step
				);

			}
		);

		/* A style / set the user has not confirmed yet = unclosable by Escape. */
		const choicePending =
			step === "sets" || step === "style";

		const project =
			videoProjects[n - 1];

		if (project) {
			project._seoChoicePending = choicePending;
		}

		setSeoWalkthroughChoicePending(
			n,
			choicePending
		);

	}

	function seoSetChipsHTML(
		set
	) {

		let html =
			'<div class="va-seo-row"><span class="va-seo-label">Title</span><span class="va-seo-chip">' +
			escapeHTML(set.title || "") +
			"</span></div>";

		if (
			Array.isArray(set.headings) &&
			set.headings.length
		) {

			html +=
				'<div class="va-seo-row"><span class="va-seo-label">Headings</span>';

			set.headings.forEach(
				(heading) => {

					html +=
						'<span class="va-seo-chip">' +
						escapeHTML(heading) +
						"</span>";

				}
			);

			html +=
				"</div>";

		}

		html +=
			'<div class="va-seo-row"><span class="va-seo-label">Long-tail</span><span class="va-seo-chip long">' +
			escapeHTML(set.longTail || "") +
			'</span></div><div class="va-seo-row"><span class="va-seo-label">Short</span>';

		(Array.isArray(set.short) ? set.short : []).forEach(
			(shortKw) => {

				html +=
					'<span class="va-seo-chip short">' +
					escapeHTML(shortKw) +
					"</span>";

			}
		);

		html +=
			"</div>";

		return html;

	}

	function renderSeoPlanSets(
		n
	) {

		const project =
			videoProjects[n - 1];

		const list =
			seoWtEl(
				n,
				"seo-wt-sets-list"
			);

		if (!project || !list) {
			return;
		}

		list.innerHTML =
			"";

		(project.seoSets || []).forEach(
			(set, idx) => {

				const card =
					document.createElement(
						"div"
					);

				card.className =
					"seo-wt-card";

				card.innerHTML =
					'<div class="seo-wt-card-title">Keyword set ' + (idx + 1) + "</div>" +
					seoSetChipsHTML(set) +
					'<button type="button" class="upload-btn" onclick="selectSeoKeywordSet(' + n + ", " + idx + ')">Select this set</button>';

				list.appendChild(
					card
				);

			}
		);

	}

	async function generateScript(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		if (
			project._seoPlanBusy ||
			project._imageFlowActive
		) {
			/* Stack it on top of any other video's window. */
			ensureSeoWalkthrough(n);
			showSeoWalkthrough(n);
			return;
		}

		/* A set was already chosen: reopen at the style step. */
		if (project.selectedSeoSet) {

			ensureSeoWalkthrough(n);

			const selectedSlot =
				seoWtEl(
					n,
					"seo-wt-selected"
				);

			if (selectedSlot) {
				selectedSlot.innerHTML =
					'<div class="seo-wt-card-title">Selected keyword set</div>' +
					seoSetChipsHTML(
						project.selectedSeoSet
					);
			}

			showSeoWalkthroughStep(n, "style");
			showSeoWalkthrough(n);
			return;

		}

		/* Sets from an earlier click are still waiting for a choice. */
		if (
			Array.isArray(project.seoSets) &&
			project.seoSets.length >= 1 &&
			!project.selectedSeoSet
		) {

			ensureSeoWalkthrough(n);
			renderSeoPlanSets(n);
			showSeoWalkthroughStep(n, "sets");
			showSeoWalkthrough(n);
			return;

		}

		const topicEl =
			document.getElementById(
				"va-script-topic-" + n
			);

		const titleEl =
			document.getElementById(
				"va-title-" + n
			);

		const minutesEl =
			document.getElementById(
				"va-script-minutes-" + n
			);

		const speedEl =
			document.getElementById(
				"va-script-speed-" + n
			);

		let btn =
			document.getElementById(
				"va-script-btn-" + n
			);

		let statusEl =
			document.getElementById(
				"va-script-status-" + n
			);

		const topic =
			(topicEl && topicEl.value.trim()) ||
			(titleEl && titleEl.value.trim()) ||
			"my video";

		const minutes =
			Number(
				minutesEl
					? minutesEl.value
					: 1
			);

		const speed =
			speedEl
				? speedEl.value
				: "medium";

		project._seoTopic =
			topic;

		project._seoMinutes =
			Number.isInteger(minutes) && minutes >= 1 && minutes <= 6
				? minutes
				: 1;

		project._seoSpeed =
			speed;

		project.selectedSeoSet =
			null;

		project.seoSets =
			null;

		/* 1. Disable Upload Image, GIF or MP4 for the whole flow. */
		setVaUploadEnabled(
			n,
			false
		);

		if (btn) {
			btn.disabled = true;
		}

		project._seoPlanBusy =
			true;

		/* 2. Show the walkthrough while the SEO plan is fetched. */
		const modal =
			ensureSeoWalkthrough(n);

		const topicSlot =
			modal.querySelector(
				"#seo-wt-topic-" + n
			);

		if (topicSlot) {
			topicSlot.textContent =
				topic;
		}

		showSeoWalkthroughStep(n, "plan");

		if (statusEl) {
			statusEl.textContent =
				"Planning two SEO keyword sets (AI model)\\u2026";
		}

		try {

			const response =
				await fetch(
					"/api/seo-plan",
					{
						method: "POST",
						headers: {
							"Content-Type":
								"application/json"
						},
						body:
							JSON.stringify(
								{
									topic: topic
								}
							)
					}
				);

			const data =
				await response
					.json()
					.catch(
						() => ({})
					);

			// An accordion can be deleted/renumbered while the plan is in flight.
			const liveN = videoProjects.indexOf(project) + 1;
			if (project._deleted || liveN <= 0) return;
			n = liveN;
			btn = document.getElementById("va-script-btn-" + n);
			statusEl = document.getElementById("va-script-status-" + n);

			/*
			 * ONE set is enough to continue: the worker answers
			 * partial: true with a single validated set when the
			 * second planner run could not produce a different one.
			 * Only a reply with no set at all is a failure.
			 */
			if (
				!response.ok ||
				!data.success ||
				!Array.isArray(data.sets) ||
				data.sets.length < 1
			) {

				throw new Error(
					(data && data.error) ||
					("HTTP " + response.status)
				);

			}

			project.seoSets =
				data.sets;

			project._seoPlanWarning =
				data.partial && data.warning
					? String(data.warning)
					: "";

			/* 3. Sets arrived: (re-)open THIS video's modal even if
			 * the user closed it while generation was running. Other
			 * videos' windows are left exactly as they were. */
			ensureSeoWalkthrough(n);

			setSeoWalkthroughError(n, "");
			renderSeoPlanSets(n);
			showSeoWalkthroughStep(n, "sets");
			showSeoWalkthrough(n);
			/* The modal can be closed while waiting for a choice; keep the
			 * per-video trigger available so cached sets/style can reopen it. */
			if (btn) btn.disabled = false;

			if (statusEl) {
				statusEl.textContent =
					project.seoSets.length > 1
						? "Two SEO keyword sets are ready \\u2014 pick one in the walkthrough."
						: "One SEO keyword set is ready \\u2014 pick it in the walkthrough.";
			}

			if (project._seoPlanWarning) {
				setSeoWalkthroughError(
					n,
					project._seoPlanWarning
				);
			}

		}
		catch (planError) {

			const liveN = videoProjects.indexOf(project) + 1;
			if (project._deleted || liveN <= 0) return;
			n = liveN;
			btn = document.getElementById("va-script-btn-" + n);
			statusEl = document.getElementById("va-script-status-" + n);

			console.warn("[seo-plan] failed", {
				videoIndex: n,
				error:
					(planError && planError.message) ||
					String(planError)
			});

			project.seoSets =
				null;

			setVaUploadEnabled(
				n,
				true
			);

			if (btn) {
				btn.disabled = false;
			}

			const planMessage =
				"SEO plan failed: " +
				(planError.message || planError);

			if (statusEl) {
				statusEl.textContent =
					planMessage;
			}

			/* Keep the window, say what happened, offer the retry. */
			ensureSeoWalkthrough(n);
			showSeoWalkthroughStep(n, "plan");
			setSeoWalkthroughError(n, planMessage);

		}
		finally {

			project._seoPlanBusy =
				false;

		}

	}

	function selectSeoKeywordSet(
		n,
		idx
	) {

		const project =
			videoProjects[n - 1];

		if (
			!project ||
			!Array.isArray(project.seoSets) ||
			!project.seoSets[idx]
		) {
			return;
		}

		project.selectedSeoSet =
			project.seoSets[idx];

		const selected =
			seoWtEl(
				n,
				"seo-wt-selected"
			);

		if (selected) {

			selected.innerHTML =
				'<div class="seo-wt-card-title">Selected keyword set</div>' +
				seoSetChipsHTML(
					project.selectedSeoSet
				);

		}

		showSeoWalkthroughStep(n, "style");

		const styleSelect =
			seoWtEl(
				n,
				"seo-wt-style-select"
			);

		if (styleSelect) {
			styleSelect.focus();
		}

	}

	async function confirmSeoStyleAndGenerate(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project || !project.selectedSeoSet || project._imageFlowActive) {
			return;
		}

		const styleSelect =
			seoWtEl(
				n,
				"seo-wt-style-select"
			);

		project.videoImageStyle =
			(styleSelect && styleSelect.value) ||
			DEFAULT_SEO_IMAGE_STYLE;

		/*
		 * Both choices are in: the window is no longer waiting on
		 * the user, so Escape / Close may dismiss it. It is moved
		 * to the "writing" panel rather than removed, because that
		 * panel is where the user is told they can walk away while
		 * the SEO script is generated.
		 */
		setSeoWalkthroughError(n, "");
		showSeoWalkthroughStep(n, "script");
		setSeoWalkthroughScriptStatus(
			n,
			"Writing the script \u2014 you can close this window, nothing is cancelled."
		);

		/* The script section shows its loading animation while
		 * runSeoScriptRequest awaits the AI script. */
		project._imageFlowActive =
			true;

		const ok =
			await runSeoScriptRequest(
				n,
				project._seoTopic || "my video",
				project._seoMinutes || 1,
				project._seoSpeed || "medium"
			);

		// Continue with the original project, not the old accordion number.
		const liveN = videoProjects.indexOf(project) + 1;
		if (project._deleted || liveN <= 0) return;
		n = liveN;

		if (!ok) {

			project._imageFlowActive =
				false;

			setVaUploadEnabled(
				n,
				true
			);

			const btn =
				document.getElementById(
					"va-script-btn-" + n
				);

			if (btn) {
				btn.disabled = false;
			}

			return;

		}

		/*
		 * The script is on screen: this video's window is no longer
		 * needed, and closing it here only ever touches Video N —
		 * other videos keep their own walkthroughs open.
		 */
		closeSeoWalkthrough(n);

		/* The script is shown: start the image-prompt job. */
		startImagePromptFlow(n);

	}

	/* Base64 -> Blob for one streamed batch image (no data: URL round-trip). */
	function base64ImageBlob(
		base64,
		mime
	) {
		const cleaned =
			String(base64 || "")
				.replace(/^data:[^;]+;base64,/i, "")
				.replace(/\\s+/g, "");
		if (
			typeof Uint8Array !== "undefined" &&
			typeof Uint8Array.fromBase64 === "function"
		) {
			return new Blob(
				[Uint8Array.fromBase64(cleaned)],
				{ type: mime || "image/png" }
			);
		}
		const binary =
			atob(cleaned);
		const bytes =
			new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return new Blob(
			[bytes],
			{ type: mime || "image/png" }
		);
	}

	/*
	 * Step 3 + 4 of the walkthrough.
	 *
	 * The text LLM plans stock keywords; delivery routes import photos and two MP4 clips.
	 * No interval timers, no gallery watcher, no job URL to create or
	 * destroy: the batch stream is both the progress and the completion
	 * signal, so there is nothing to clean up afterwards.
	 */
	async function startImagePromptFlow(
		n
	) {

				const project =
			videoProjects[n - 1];
		if (!project) return;

		const statusEl =
			document.getElementById(
				"va-ai-status-" + n
			);
		// Replace only prior automatic scenes on rerun; preserve manual uploads.
		project._imageFlowSeq = (project._imageFlowSeq || 0) + 1;
		project._requiresStockClips = true;
		for (const asset of project.assets.filter(function (a) { return a.imagePromptFlowId; })) {
			if (asset.videoEl) { try { asset.videoEl.pause(); asset.videoEl.removeAttribute("src"); asset.videoEl.load(); } catch (_) {} }
			if (asset.card && asset.card.parentNode) asset.card.parentNode.removeChild(asset.card);
			if (asset.url) releaseStudioObjectUrl(asset.url);
		}
		project.assets = project.assets.filter(function (a) { return !a.imagePromptFlowId; });
		const availableImages =
			Math.max(
				0,
				MAX_IMAGE_UPLOADS -
					videoCounts(project).stills
			);
		const style =
			project.videoImageStyle ||
			DEFAULT_SEO_IMAGE_STYLE;

		/*
		 * The walkthrough's images are generating for THIS video: lock its
		 * manual "Generate 2 Images" button until finalizeImagePromptFlow()
		 * runs (every exit path of this flow ends there). Other videos are
		 * untouched and can still generate their own images at the same time.
		 */

		/* A second run for this video cancels the previous one's prompt/batch streams. */
		if (project._imagePromptCreateController) {
			try { project._imagePromptCreateController.abort(); } catch (abortPromptErr) { }
			project._imagePromptCreateController = null;
		}
		if (project._imageBatchController) {
			try { project._imageBatchController.abort(); } catch (abortError) { }
			project._imageBatchController = null;
		}

		const myFlowSeq = project._imageFlowSeq;

		project.imagePrompts = null;
		project.imagePromptStates = {};
		project.imagePromptTarget = 0;
		project.imagePromptFlowId = null;
		project.aiImagesDone = 0;
		project._aiImageFailures = 0;
		project._aiImageSkipped = 0;
		project._imageFlowStopReason = "";
		project._imageFlowStartedAt = Date.now();

		if (availableImages < 2 || videoCounts(project).clips > MAX_MP4_UPLOADS - 2) {
			await finalizeImagePromptFlow(
				n,
				"Make room for at least two photos and two Pixabay video clips in this gallery."
			);
			return;
		}

		if (statusEl) {
			statusEl.textContent =
				"Planning Pixabay scene keywords from the full script…";
		}

		const target = Math.min(imageSceneTarget(project.script || "", project._seoMinutes || 1), availableImages + 2);
\t\tproject.imagePrompts = [];
\t\tproject.imagePromptTarget = target;
/* Hide last time's search terms and retry button until this flow plans new ones. */
const flowKeywords = document.getElementById("va-image-keywords-" + n);
if (flowKeywords) { flowKeywords.style.display = "none"; flowKeywords.innerHTML = ""; }
const flowRetry = document.getElementById("va-image-retry-" + n);
if (flowRetry) flowRetry.style.display = "none";
		project.imagePromptFlowId = "imgflow-" + n + "-" + myFlowSeq + "-" + Date.now().toString(36);
		const isCancelled = function () {
			return Boolean(project._deleted || project._imageFlowSeq !== myFlowSeq || !project._imageFlowActive);
		};
		try {
			await runProgressiveImagePipeline({
				total: target,
				isCancelled: isCancelled,
				onPrompts: function (prompts) {
					project.imagePrompts = prompts;
					prompts.forEach(function (_, index) {
						if (!project.imagePromptStates[String(index)]) setImagePromptState(project, index, "planned", "");
					});
					renderImageKeywords(n);
				},
				cancelPrompts: function () {
					if (project._imagePromptCreateController) project._imagePromptCreateController.abort();
				},
				request: async function (batch) {
					const caps = await studioOffload.capabilities();
					const compact = null;
					const sendPrompt = caps.compactPrompts ? async function (url, init, timeout, owner, key, consume) {
						const response = await studioOffload.jsonRequest(url, init, timeout, {
							isCancelled: isCancelled,
							setController: function (controller) { owner[key] = controller; },
							clearController: function (controller) { if (owner[key] === controller) owner[key] = null; }
						});
						return consume(response);
					} : seoFetchWithTimeout;
					return sendPrompt("/api/image-prompts", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							topic: project._seoTopic || "my video", minutes: project._seoMinutes || 1,
							style: style, script: project.script || "", sceneTotal: target, keywordSet: project.selectedSeoSet || null,
							batch: batch
						})
					}, IMAGE_PROMPT_REQUEST_TIMEOUT_MS, project, "_imagePromptCreateController", async function (response) {
						const data = await seoResponseJson(response);
						if (!response.ok || !data.success) {
							const error = new Error((data && data.error) || ("Scene prompt request failed (HTTP " + response.status + ")"));
							error.retryable = response.status === 408 || response.status >= 500 || response.status === 429 || response.ok;
							error.status = response.status;
							/* #263: a load answer carries the wait the server wants. */
							error.kind = (data && data.kind) || "";
							error.retryAfterMs = Number(data && data.retryAfterMs) > 0 ? Number(data.retryAfterMs) : 0;
							throw error;
						}
						return data.prompts;
					});
				},
				render: async function (prompts, offset) {
					const liveN = videoProjects.indexOf(project) + 1;
					if (liveN <= 0 || isCancelled()) return;
					await runImageBatch(liveN, prompts, project.imagePromptFlowId, project, myFlowSeq, offset);
					if (project._imageFlowStopReason) throw new Error(project._imageFlowStopReason);
				}
			});
		} catch (error) {
			if (isCancelled()) return;
			project._imageFlowStopReason = project._imageFlowStopReason ||
				(batchIsAbortError(error) ? "Scene prompt request was interrupted after bounded retries." :
					"Stock search terms could not be generated or rendered: " + (error.message || String(error)));
		}
		if (isCancelled()) return;
		const finalN = videoProjects.indexOf(project) + 1;
		if (finalN > 0) await finalizeImagePromptFlow(finalN, project._imageFlowStopReason || "");
	}

	/*
	 * Renders one browser-scheduled chunk and consumes its NDJSON stream:
	 *   start / tick / image{ok,data} / image{ok:false,error} / done / error
	 * Each successful image is inserted into this video's gallery as soon as
	 * it arrives, so a 10-image batch is on screen in one pass instead of
	 * trickling in every 20 seconds.
	 */
	async function insertStockScene(n, blob, flowId, sceneIndex, stale) {
		const project = videoProjects[n - 1];
		if (!project || stale()) return false;
		if (project.assets.some(function (a) { return a.imagePromptFlowId === flowId && a.sceneIndex === sceneIndex; })) return true;
		const file = new File([blob], "pixabay-scene-" + sceneIndex + (blob.type === "video/mp4" ? ".mp4" : ".jpg"), { type: blob.type });
		file.stockSource = blob.stockSource || null;
		if (blob.type !== "video/mp4") {
			const inserted = addAiToVideo(n, file, blob, flowId, true);
			if (inserted) project.assets[project.assets.length - 1].sceneIndex = sceneIndex;
			return inserted;
		}
		if (videoCounts(project).clips >= MAX_MP4_UPLOADS) return false;
		const url = createStudioObjectUrl(blob), video = document.createElement("video");
		try {
			const duration = await probeMp4Duration(video, url);
			if (stale() || project._deleted || videoCounts(project).clips >= MAX_MP4_UPLOADS) { releaseStudioObjectUrl(url); video.removeAttribute("src"); video.load(); return false; }
			if (!Number.isFinite(duration) || duration <= 0 || duration > MP4_MAX_DURATION_S) throw new Error("Unsupported Pixabay clip duration");
			const asset = { kind: "mp4", file: file, stockSource: blob.stockSource, videoEl: video, duration: duration,
				url: url, card: null, imagePromptFlowId: flowId, sceneIndex: sceneIndex };
			project.assets.push(asset);
			const liveN = videoProjects.indexOf(project) + 1;
			buildVaCard(liveN, asset); updateVideoStatus(liveN);
			return true;
		} catch (error) {
			project.assets = project.assets.filter(function (a) { if (a.url !== url) return true; if (a.card && a.card.parentNode) a.card.parentNode.removeChild(a.card); return false; });
			releaseStudioObjectUrl(url); video.removeAttribute("src"); video.load(); throw error;
		}
	}

	async function runBinaryEditorImages(n, prompts, flowId, project, ownerFlowSeq, sceneOffset) {
		const seq = typeof ownerFlowSeq === "number" ? ownerFlowSeq : project._imageFlowSeq;
		const stale = function () { return Boolean(project._deleted || !project._imageFlowActive || project._imageFlowSeq !== seq); };
		try {
			const results = await requestImageChunk(prompts, {}, {
				isCancelled: stale,
				priority: function () { return project.el && project.el.contains(document.activeElement) ? 2 : 0; },
				setController: function (controller) { if (!stale()) project._imageBatchController = controller; else controller.abort(); },
				clearController: function (controller) { if (project._imageBatchController === controller) project._imageBatchController = null; },
				onImage: async function (blob, index) {
					if (stale()) return;
					const liveN = videoProjects.indexOf(project) + 1;
					if (liveN <= 0) return;
					const scene = (Number(sceneOffset) || 0) + index;
					if (!await insertStockScene(liveN, blob, flowId, scene, stale)) throw new Error("The media gallery is full or the flow was cancelled");
					project.aiImagesDone = (project.aiImagesDone || 0) + 1;
					recordStudioUsage("images", "ok", 1);
					setImagePromptState(project, scene, "imported", blob.type === "video/mp4" ? "clip added to gallery" : "photo added to gallery");
					const status = document.getElementById("va-ai-status-" + liveN);
					if (status) status.textContent = project.aiImagesDone + " Pixabay scenes imported…";
				},
				onError: function (error, index) {
					if (stale()) return;
					const scene = (Number(sceneOffset) || 0) + index;
					setImagePromptState(project, scene, "failed", error && error.message ? error.message : String(error || "Pixabay import failed"));
				}
			});
						if (!stale()) {
				project._aiImageFailures = (project._aiImageFailures || 0) + results.filter(function (r) { return !r.ok; }).length;
				if (results.every(function (r) { return !r.ok; }) || results.some(function (r) {
					return r.error && [401,403,429].indexOf(r.error.status) >= 0;
				})) {
					/* Prefer the load hint: "server busy, retry in N s" beats a raw AiError. */
					const firstFailure = results.find(function (r) { return !r.ok && r.error; });
					project._imageFlowStopReason = results.some(function (r) {
						return r.error && (r.error.kind === "overload" || r.error.status === 503);
					})
						? describeImageLoadFailure(firstFailure && firstFailure.error)
						: ((firstFailure && firstFailure.error && firstFailure.error.message) || "The image batch could not complete; delivered images were kept.") +
							(firstFailure && firstFailure.error && firstFailure.error.requestId ? " (request " + firstFailure.error.requestId + ")" : "");
				}
			}
		} catch (error) {
			console.error("[seo-image-flow] binary batch failed", { videoIndex: n, flowId: flowId, sceneOffset: Number(sceneOffset) || 0, error: String(error && error.message || error).slice(0, 500) });
			if (!stale()) project._imageFlowStopReason = "Image generation was interrupted; delivered images were kept.";
		} finally { refreshCredits(); }
	}

	async function runImageBatch(
		n,
		prompts,
		flowId,
		ownerProject,
		ownerFlowSeq,
		sceneOffset
	) {

		const project =
			ownerProject || videoProjects[n - 1];
		if (!project || project._deleted || !project._imageFlowActive || !prompts.length) return;
		if ((await studioOffload.capabilities()).binaryImages) {
			return runBinaryEditorImages(n, prompts, flowId, project, ownerFlowSeq, sceneOffset);
		}
		const expectedSeq =
			typeof ownerFlowSeq === "number" ? ownerFlowSeq : project._imageFlowSeq;

		const resolveStatusEl = function () {
			const liveIdx = videoProjects.indexOf(project) + 1;
			return liveIdx > 0 ? document.getElementById("va-ai-status-" + liveIdx) : null;
		};
		const statusEl = resolveStatusEl();
		const total = prompts.length;
		let added = 0;
		let failed = 0;
		let skipped = 0;
		let batchDone = false;

		if (statusEl) {
			statusEl.textContent =
				"Rendering all " + total + " Pixabay images at once…";
		}

		const controller =
			typeof AbortController !== "undefined"
				? new AbortController()
				: null;
		project._imageBatchController = controller;

		const isStaleFlow = function () {
			return Boolean(
				project._deleted ||
				!project._imageFlowActive ||
				(typeof expectedSeq === "number" && project._imageFlowSeq !== expectedSeq)
			);
		};

		let idleTimer = null;
		const armIdleTimer = function () {
			if (!controller) return;
			if (idleTimer) clearTimeout(idleTimer);
			idleTimer = setTimeout(function () {
				if (!isStaleFlow() && !project._imageFlowStopReason) {
					project._imageFlowStopReason = "The image batch stopped responding for " + Math.round(IMAGE_BATCH_IDLE_TIMEOUT_MS / 1000) + " seconds.";
				}
				try { controller.abort(); } catch (abortError) { }
			}, IMAGE_BATCH_IDLE_TIMEOUT_MS);
		};

		const progressText = function () {
			return "Rendering " + total + " Pixabay image" + (total === 1 ? "" : "s") + " in parallel — " +
				added + " added" +
				(failed ? ", " + failed + " failed" : "") +
				(skipped ? ", " + skipped + " skipped" : "") + "…";
		};

		let galleryCommitChain =
			Promise.resolve();

		const handleEvent = function (event) {
			if (!event || typeof event !== "object" || isStaleFlow()) return;
			if (event.credits) applyCredits(event.credits);
			const curStatusEl = resolveStatusEl();

			if (event.type === "start") {
				if (curStatusEl) {
					curStatusEl.textContent =
						"Rendering " + event.count + " Pixabay images in parallel" +
						(event.width && event.height ? " (" + event.width + "×" + event.height + ")" : "") + "…";
				}
				return;
			}

			if (event.type === "tick") {
				if (curStatusEl && !batchDone) curStatusEl.textContent = progressText();
				return;
			}

			if (event.type === "image") {
				if (!event.ok) {
					failed++;
					setImagePromptState(project, (Number(sceneOffset) || 0) + Number(event.index), "failed", event.error || "Pixabay import failed");
					console.warn("[seo-image-flow] image failed", {
						videoIndex: n,
						index: event.index,
						error: event.error || "unknown image error"
					});
					if (curStatusEl && !batchDone) curStatusEl.textContent = progressText();
				}
				else if (event.data && !isStaleFlow()) {
					const eventIndex = (Number(sceneOffset) || 0) + Number(event.index);
					const decodeJob = decodeBase64ImageOffThread(event.data, event.mime);
					galleryCommitChain = galleryCommitChain.then(function () {
						return decodeJob.then(
							async function (blob) {
								blob.stockSource = event.source || null;
								if (isStaleFlow()) return;
								const liveN = videoProjects.indexOf(project) + 1;
								if (liveN <= 0) return;
								try {
									const inserted = await insertStockScene(liveN, blob, flowId, eventIndex, isStaleFlow);
									if (inserted) {
										added++;
										setImagePromptState(project, eventIndex, "imported", blob.type === "video/mp4" ? "clip added to gallery" : "photo added to gallery");
										recordStudioUsage("images", "ok", 1);

									}
									else {
										skipped++;
										setImagePromptState(project, eventIndex, "failed", "gallery limit reached or scene skipped");
										project._imageFlowStopReason =
											"The video gallery reached its " + MAX_IMAGE_UPLOADS + "-image limit.";
										if (controller) {
											try { controller.abort(); } catch (abortError) { }
										}
									}
								}
								catch (insertError) {
									failed++;
									setImagePromptState(project, eventIndex, "failed", insertError && insertError.message ? insertError.message : String(insertError));
									console.error("[seo-image-flow] gallery insertion failed", {
										videoIndex: liveN,
										index: eventIndex,
										error: insertError && insertError.message ? insertError.message : String(insertError)
									});
								}
								const nextStatusEl = resolveStatusEl();
								if (nextStatusEl && !batchDone) nextStatusEl.textContent = progressText();
							},
							function (decodeError) {
								if (isStaleFlow()) return;
								failed++;
								setImagePromptState(project, eventIndex, "failed", decodeError && decodeError.message ? decodeError.message : String(decodeError));
								console.error("[seo-image-flow] image decode failed", {
									videoIndex: n,
									index: eventIndex,
									error: decodeError && decodeError.message ? decodeError.message : String(decodeError)
								});
								const nextStatusEl = resolveStatusEl();
								if (nextStatusEl && !batchDone) nextStatusEl.textContent = progressText();
							}
						);
					});
				}
				return;
			}

			if (event.type === "error") {
				project._imageFlowStopReason =
					"Image batch failed: " + (event.error || "unknown error");
				return;
			}

			if (event.type === "done") {
				batchDone = true;
			}
		};

		try {
			await appImageStreamQueue.enqueue(
				"editor-video-" + n,
				async function () {
					armIdleTimer();
					const response = await fetch(
						"/api/image-batch",
						Object.assign(
							{
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									"Accept": "application/x-ndjson"
								},
								body: JSON.stringify({ prompts: prompts })
							},
							controller ? { signal: controller.signal } : {}
						)
					);

					if (!response.ok) {
						const errJson = await seoResponseJson(response);
						if (errJson && errJson.credits) applyCredits(errJson.credits);
						throw new Error((errJson && errJson.error) || ("Image batch failed (HTTP " + response.status + ")"));
					}

					const reader = response.body && typeof response.body.getReader === "function"
						? response.body.getReader()
						: null;

					if (!reader) {
						throw new Error("This browser cannot read the image batch stream");
					}

					const decoder = new TextDecoder();
					let buffer = "";
					for (;;) {
						const chunk = await reader.read();
						if (chunk.done) break;
						armIdleTimer();
						buffer += decoder.decode(chunk.value, { stream: true });
						let newlineIndex = buffer.indexOf("\\n");
						while (newlineIndex >= 0) {
							const line = buffer.slice(0, newlineIndex).trim();
							buffer = buffer.slice(newlineIndex + 1);
							if (line) {
								try { handleEvent(JSON.parse(line)); } catch (parseError) { }
							}
							newlineIndex = buffer.indexOf("\\n");
						}
					}
					const tail = (buffer + decoder.decode()).trim();
					if (tail) {
						try { handleEvent(JSON.parse(tail)); } catch (parseError) { }
					}
					await galleryCommitChain;
					if (!batchDone) throw new Error("Image stream ended before completion; delivered images were kept.");
				},
				{
					signal: controller ? controller.signal : null,
					meta: { kind: "editor-video", videoIndex: n, project: project }
				}
			);
		}
		catch (batchError) {
			if (!isStaleFlow()) {
				const message = batchError && batchError.message ? batchError.message : String(batchError);
				const aborted = batchError && batchError.name === "AbortError";
				console.warn("[seo-image-flow] image batch interrupted", {
					videoIndex: n,
					added: added,
					failed: failed,
					aborted: aborted,
					error: message
				});
				if (aborted && !project._imageFlowStopReason) {
					project._imageFlowStopReason =
						"The image batch was interrupted after " + added + " of " + total + " images.";
				}
				else if (!aborted) {
					project._imageFlowStopReason =
						"Image generation failed: " + message;
				}
			}
		}
		finally {
			await galleryCommitChain;
			if (controller) { try { controller.abort(); } catch (cleanupError) { } }
			if (idleTimer) clearTimeout(idleTimer);
			if (project._imageBatchController === controller) {
				project._imageBatchController = null;
			}
			if (typeof expectedSeq !== "number" || project._imageFlowSeq === expectedSeq) {
				project.aiImagesDone = (project.aiImagesDone || 0) + added;
				project._aiImageFailures = (project._aiImageFailures || 0) + failed;
				project._aiImageSkipped = (project._aiImageSkipped || 0) + skipped;
			}
			refreshCredits();
			console.info("[seo-image-flow] image batch finished", {
				videoIndex: n,
				requested: total,
				added: added,
				failed: failed,
				skipped: skipped,
				ms: Date.now() - (project._imageFlowStartedAt || Date.now())
			});
		}
	}

	/*
	 * Ends the flow: aborts anything still in flight, restores the upload
	 * and script buttons and reports what landed in the gallery.
	 */
	async function finalizeImagePromptFlow(
		n,
		finalReason
	) {

		const project =
			videoProjects[n - 1];
		if (!project || project._imageFlowFinalizing) return;

		project._imageFlowFinalizing = true;
		project._imageFlowActive = false;

		if (project._imageBatchController) {
			try { project._imageBatchController.abort(); } catch (abortError) { }
			project._imageBatchController = null;
		}
		if (project._imagePromptCreateController) {
			try { project._imagePromptCreateController.abort(); } catch (abortError) { }
			project._imagePromptCreateController = null;
		}

		const gallery =
			document.getElementById(
				"va-gallery-" + n
			);
		const flowId =
			project.imagePromptFlowId;
		const plannedAssets = project.assets.filter(function (a) { return a.imagePromptFlowId === flowId; }).sort(function (a, b) { return a.sceneIndex - b.sceneIndex; });
		let orderedIndex = 0;
		project.assets = project.assets.map(function (a) { return a.imagePromptFlowId === flowId ? plannedAssets[orderedIndex++] : a; });
		if (gallery) project.assets.forEach(function (a) { if (a.card) gallery.appendChild(a.card); });
		const requiredClips = plannedAssets.filter(function (a) { return a.kind === "mp4"; });
		if (!finalReason && (requiredClips.length !== 2 || new Set(requiredClips.map(function (a) { return a.stockSource && a.stockSource.id; })).size !== 2)) {
			finalReason = "Both required Pixabay video clips could not be imported. Retry the scene flow; delivered media was kept.";
		}
		const actualCount =
			project.assets.filter(function (asset) {
				return flowId && asset && asset.imagePromptFlowId === flowId && asset.card && (!gallery || asset.card.parentNode === gallery);
			}).length;
		const promptCount =
			Array.isArray(project.imagePrompts)
				? project.imagePrompts.length
				: (Number(project.imagePromptTarget) || 0);
		const imageTarget =
			Number(project.imagePromptTarget) || 0;
		const failures =
			Number(project._aiImageFailures) || 0;

\t\tproject._imageFlowFinalizing = false;
\t\tsetVaUploadEnabled(n, true);
/* A finished or stopped flow may be re-run from this same script. */
const retryBtn =
	document.getElementById("va-image-retry-" + n);
if (retryBtn) retryBtn.style.display = (project.imagePromptFlowId && !project._imageFlowActive) ? "" : "none";
/* The walkthrough's images are done: the manual button unlocks. */
		const scriptButton =
			document.getElementById(
				"va-script-btn-" + n
			);
		if (scriptButton) scriptButton.disabled = false;

		let statusMessage;
		if (finalReason) {
			statusMessage = "Pixabay image flow stopped: " + finalReason + " " + actualCount + " image(s) added to the gallery.";
		}
		else if (imageTarget < promptCount) {
			statusMessage = "Pixabay image flow finished — " + actualCount + " of " + promptCount + " prompted image(s) added (the video gallery allows up to " + MAX_IMAGE_UPLOADS + " still images).";
		}
		else if (failures > 0) {
			statusMessage = "Pixabay image flow finished — " + actualCount + " image(s) added; " + failures + " prompt(s) failed.";
		}
		else {
			statusMessage = "Pixabay images done — " + actualCount + " image(s) in the gallery.";
		}
		statusMessage += " Upload Image, GIF or MP4 is enabled again.";
		const statusEl =
			document.getElementById(
				"va-ai-status-" + n
			);
		if (statusEl) statusEl.textContent = statusMessage;
		console.info("[seo-image-flow] flow finalized", {
			videoIndex: n,
			flowId: flowId,
			imagesInGallery: actualCount,
			promptsExpected: promptCount,
			imagesTarget: imageTarget,
			failures: failures,
\t\t\tms: Date.now() - (project._imageFlowStartedAt || Date.now())
\t\t});
\t}

/*
 * Decode one \`pixabay:{q,...}\` planning token. The order in the returned
 * prompt list is authoritative for gallery scene indices; token metadata is
 * used for the media type and Pixabay's selected result index.
 */
function parseImagePromptToken(token, fallbackScene) {
	const fallback = Math.max(0, Number(fallbackScene) || 0);
	const parsed = { q: "", type: "image", index: fallback, scene: fallback };
	if (typeof token === "string" && token.indexOf("pixabay:") === 0) {
		try {
			const value = JSON.parse(token.slice(8));
			if (value && typeof value === "object") {
				if (typeof value.q === "string") parsed.q = value.q.trim();
				if (value.type === "video" || value.type === "image") parsed.type = value.type;
				if (Number.isInteger(value.index) && value.index >= 0) parsed.index = value.index;
				if (Number.isInteger(value.scene) && value.scene >= 0) parsed.scene = value.scene;
			}
		} catch (_) { /* Invalid structured tokens must not become bogus search queries. */ }
	} else if (typeof token === "string") {
		parsed.q = token.trim();
	}
	return parsed;
}

/* Keep a per-scene status beside every keyword so planning, actual search,
 * asset download and gallery insertion failures are visible to the user. */
function setImagePromptState(project, scene, state, detail) {
	if (!project) return;
	if (!project.imagePromptStates || typeof project.imagePromptStates !== "object") project.imagePromptStates = {};
	project.imagePromptStates[String(scene)] = { state: String(state || "planned"), detail: String(detail || "") };
	const liveN = videoProjects.indexOf(project) + 1;
	if (liveN > 0) renderImageKeywords(liveN);
}

function renderImageKeywords(n) {
	const project = videoProjects[n - 1];
	if (!project) return;
	const box = document.getElementById("va-image-keywords-" + n);
	if (!box) return;
	const prompts = Array.isArray(project.imagePrompts) ? project.imagePrompts : [];
	if (!prompts.length) { box.style.display = "none"; box.innerHTML = ""; return; }
	const states = project.imagePromptStates || {};
	const rows = prompts.map(function (token, index) {
		const parsed = parseImagePromptToken(token, index);
		const state = states[String(index)] || { state: "planned", detail: "" };
		const typeLabel = parsed.type === "video" ? "VIDEO" : "PHOTO";
		const statusLabel = state.state === "imported" ? "in gallery" : state.state === "searching" ? "searching…" : state.state === "failed" ? "failed" : "planned";
		const detail = state.detail ? " — " + state.detail : "";
		return '<div class="va-seo-row va-pixabay-keyword-row"><span class="va-seo-label">Scene ' + (index + 1) + ' · ' + typeLabel + '</span>' +
			'<span class="va-seo-chip" title="Pixabay search keyword">' + escapeHTML(parsed.q || String(token || "")) + '</span>' +
			'<span class="va-pixabay-keyword-status" data-state="' + escapeHTML(state.state) + '">' + escapeHTML(statusLabel + detail) + '</span></div>';
	}).join("");
	box.innerHTML = '<div class="va-seo-heading">Pixabay search keywords (' + prompts.length + ' scenes)</div>' + rows;
	box.style.display = "";
}

/*
 * Retry means actually search Pixabay in the browser using the already-visible
 * scene keywords, download chosen assets through the same-origin Worker, and
 * add successful results to the gallery. Re-plan only if no usable keyword
 * list exists (for example, the planner itself failed).
 */
async function retryImagePromptFlow(n) {
	const project = videoProjects[n - 1];
	if (!project || project._imageFlowActive) return;
	if (!Array.isArray(project.imagePrompts) || !project.imagePrompts.length) {
		project._imageFlowActive = true;
		project._imageFlowStopReason = "";
		const status = document.getElementById("va-ai-status-" + n);
		if (status) status.textContent = "No planned search keywords are available; planning new Pixabay searches…";
		return startImagePromptFlow(n);
	}

	project._imageFlowActive = true;
	project._imageFlowSeq = (project._imageFlowSeq || 0) + 1;
	project._imageFlowStartedAt = Date.now();
	project._requiresStockClips = true;
	project._imageFlowStopReason = "";
	project._aiImageFailures = 0;
	project.imagePromptStates = {};
	const seq = project._imageFlowSeq;
	const stale = function () { return Boolean(project._deleted || project._imageFlowSeq !== seq || !project._imageFlowActive); };
	const liveIndex = function () { return videoProjects.indexOf(project) + 1; };
	const liveN = liveIndex();
	const flowId = project.imagePromptFlowId || ("imgretry-" + liveN + "-" + seq + "-" + Date.now().toString(36));
	const statusEl = document.getElementById("va-ai-status-" + liveN);
	const btn = document.getElementById("va-image-retry-" + liveN);
	project.imagePromptFlowId = flowId;
	project.aiImagesDone = project.assets.filter(function (asset) { return asset.imagePromptFlowId === flowId; }).length;
	if (btn) { btn.disabled = true; btn.style.display = ""; btn.textContent = "Searching Pixabay…"; }
	// Keep successful paid imports and retry only scenes that are absent from the gallery.
	for (let i = 0; i < project.imagePrompts.length; i++) {
		const alreadyImported = project.assets.some(function (asset) { return asset.imagePromptFlowId === flowId && Number(asset.sceneIndex) === i; });
		setImagePromptState(project, i, alreadyImported ? "imported" : "planned", alreadyImported ? "already in gallery" : "");
	}

	const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
	project._imageBatchController = controller;
	let imported = 0;
	let failed = 0;
	try {
		for (let i = 0; i < project.imagePrompts.length; i++) {
			if (stale()) break;
			const alreadyImported = project.assets.some(function (asset) { return asset.imagePromptFlowId === flowId && Number(asset.sceneIndex) === i; });
			if (alreadyImported) continue;
			const selection = parseImagePromptToken(project.imagePrompts[i], i);
			if (!selection.q) {
				failed++;
				setImagePromptState(project, i, "failed", "missing search keyword");
				continue;
			}
			setImagePromptState(project, i, "searching", "");
			if (statusEl) statusEl.textContent = "Pixabay search " + (i + 1) + " of " + project.imagePrompts.length + ": " + selection.q;
			console.info("[pixabay-retry] scene.search", { scene: i, type: selection.type, keyword: selection.q });
			try {
				const searchUrl = new URL("/api/media/search", window.location.href);
				searchUrl.searchParams.set("q", selection.q);
				searchUrl.searchParams.set("type", selection.type);
				searchUrl.searchParams.set("page", "1");
				searchUrl.searchParams.set("per_page", selection.type === "video" ? "3" : "2");
				searchUrl.searchParams.set("orientation", "landscape");
				const searchResponse = await fetch(searchUrl.pathname + searchUrl.search, controller ? { signal: controller.signal } : undefined);
				const searchData = await searchResponse.json().catch(function () { return null; });
				if (!searchResponse.ok || !searchData || !Array.isArray(searchData.hits)) throw new Error((searchData && searchData.error) || ("Pixabay search failed (HTTP " + searchResponse.status + ")"));
				console.info("[pixabay-retry] scene.search-result", { scene: i, status: searchResponse.status, hits: searchData.hits.length });
				const hit = searchData.hits[selection.index] || searchData.hits[0];
				if (!hit || !hit.id) throw new Error("No Pixabay " + selection.type + " results for this keyword");

				const assetUrl = new URL("/api/media/asset", window.location.href);
				assetUrl.searchParams.set("id", String(hit.id));
				assetUrl.searchParams.set("q", selection.q);
				assetUrl.searchParams.set("type", selection.type);
				assetUrl.searchParams.set("page", "1");
				assetUrl.searchParams.set("per_page", selection.type === "video" ? "3" : "2");
				assetUrl.searchParams.set("orientation", "landscape");
				const assetResponse = await fetch(assetUrl.pathname + assetUrl.search, controller ? { signal: controller.signal } : undefined);
				if (!assetResponse.ok) {
					const errorData = await assetResponse.json().catch(function () { return null; });
					throw new Error((errorData && errorData.error) || ("Pixabay asset download failed (HTTP " + assetResponse.status + ")"));
				}
				const mime = assetResponse.headers.get("content-type") || (selection.type === "video" ? "video/mp4" : "image/jpeg");
				let blob = await assetResponse.blob();
				if (mime.indexOf("video/") === 0 && blob.type !== "video/mp4") blob = new Blob([blob], { type: mime });
				if (selection.type === "video" && blob.type !== "video/mp4") throw new Error("Pixabay returned a non-MP4 asset for a video scene");
				if (selection.type === "image" && blob.type.indexOf("image/") !== 0) throw new Error("Pixabay returned a non-image asset for a photo scene");
				console.info("[pixabay-retry] scene.downloaded", { scene: i, id: hit.id, type: selection.type, mime: blob.type, bytes: blob.size });
				blob.stockSource = { provider: "pixabay", id: hit.id, pageURL: hit.pageURL || "", user: hit.user || "", type: selection.type, duration: hit.duration || 0 };
				if (stale()) break;
				const at = liveIndex();
				if (at <= 0 || !await insertStockScene(at, blob, flowId, i, stale)) throw new Error("Could not add the downloaded asset to the gallery");
				imported++;
				project.aiImagesDone = imported;
				recordStudioUsage("images", "ok", 1);
				setImagePromptState(project, i, "imported", selection.type === "video" ? "clip added to gallery" : "photo added to gallery");
				console.info("[pixabay-retry] scene.added-to-gallery", { scene: i, id: hit.id, type: selection.type, imported });
			} catch (error) {
				if (error && error.name === "AbortError") break;
				failed++;
				project._aiImageFailures++;
				setImagePromptState(project, i, "failed", error && error.message ? error.message : String(error));
				console.error("[pixabay-retry] scene failed", { scene: i, type: selection.type, keyword: selection.q, error: String(error && error.message || error).slice(0, 500) });
			}
		}
	} finally {
		refreshCredits();
		if (!stale()) {
			project._imageBatchController = null;
			project._imageFlowActive = false;
			if (liveIndex() > 0) await finalizeImagePromptFlow(liveIndex(), failed ? "Some Pixabay searches failed; successful assets were kept." : "");
			if (btn) { btn.disabled = false; btn.textContent = "Retry Pixabay search"; }
			if (statusEl && !failed) statusEl.textContent = imported
				? "Pixabay retry finished: " + imported + " missing scene(s) added to the gallery; existing scenes were kept."
				: "All planned Pixabay scenes are already in the gallery; no duplicate imports were billed.";
		}
	}
}

/*
 * A failed /api/script is retried TWICE more by the browser before
	 * the video accordion shows an error: three attempts in total
	 * (1 + SCRIPT_RETRY_LIMIT retries). Negotiated #261 calls make one server inference per request;
	 * only legacy calls retain server retries. These browser retries cover
	 * the transient part a user actually notices - a cold Workers AI
	 * container, a gateway 5xx, a dropped connection. The status line in
	 * the accordion reports each retry, and the error text only appears
	 * once the last attempt has failed, so a self-healing run never looks
	 * like a failure.
	 */
	const SCRIPT_RETRY_LIMIT =
		2;

	async function requestSeoScriptOnce(
		n,
		topic,
		minutes,
		speed,
		attempt,
		previousFailure
	) {

		const project =
			videoProjects[n - 1];
		const single = (await studioOffload.capabilities()).singleAttemptScript && project && project.selectedSeoSet;
		const send = single ? function (url, init) {
			return studioOffload.scriptRequest(init, {
				isCancelled: function () { return Boolean(project._deleted); },
				setController: function (controller) { project._seoScriptController = controller; },
				clearController: function (controller) { if (project._seoScriptController === controller) project._seoScriptController = null; }
			});
		} : fetch;
		const response =
			await send(
				"/api/script",
				{
					method: "POST",
					headers: {
						"Content-Type":
							"application/json"
					},
					body:
						JSON.stringify(
							{
								singleAttempt: Boolean(single), attempt: Number(attempt) || 0, previousFailure: String(previousFailure || "").slice(0, 800),
								topic: topic,
								minutes: minutes,
								speed: speed,
								keywordSet:
									project && project.selectedSeoSet
										? project.selectedSeoSet
										: undefined
							}
						)
				}
			);

		const data =
			await response
				.json()
				.catch(
					() => ({})
				);

		/*
		 * 'script' is plain narration text - the worker never sends
		 * subtitle formatting to the browser, so there is nothing to
		 * strip here.
		 */
		if (
			!response.ok ||
			!data.success ||
			!data.script
		) {

			const error = new Error((data && data.error) || ("HTTP " + response.status));
			error.retryable = response.status === 408 || response.status === 429 || response.status >= 500 || response.ok;
			throw error;

		}

		return data;

	}

	/*
	 * Puts one finished script on the video: the text in the Script box,
	 * the SEO plan under it, the AI title in the (empty) title input, and
	 * fresh timings for burned-in subtitles if that video is using them.
	 */
	function applySeoScript(
		n,
		data,
		options
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		const minutes =
			(options && options.minutes) || 1;

		const speed =
			(options && options.speed) || "medium";

		const script =
			String(data.script || "").trim();

		project.script =
			script;

		/* The worker verified the spoken span; keep it for subtitle timing. */
		project.scriptDurationMs =
			Number(data.durationMs) > 0
				? Number(data.durationMs)
				: Math.round(minutes * 60 * 1000);

		if (
			project.subtitles &&
			project.subtitles.length
		) {
			project.subtitles =
				buildScriptCues(
					script,
					project.audio && project.audio.duration
						? project.audio.duration * 1000
						: project.scriptDurationMs
				);
		}

		/*
		 * Keep the verified SEO plan on
		 * the project, and offer the AI
		 * title when the video title
		 * input is still empty - the
		 * title is <=70 chars (the
		 * input maxlength) and carries
		 * one of the short keywords.
		 */
		project.seoTitle =
			(data && data.title) || "";

		project.seoHeadings =
			data && Array.isArray(data.headings)
				? data.headings
				: [];

		const titleEl =
			document.getElementById(
				"va-title-" + n
			);

		if (
			titleEl &&
			!titleEl.value.trim() &&
			project.seoTitle
		) {

			titleEl.value =
				project.seoTitle.slice(0, 70);

		}

		renderSeoKeywords(
			n,
			data
		);

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		if (box) {
			box.textContent = script;
		}

		/*
		 * The script now exists:
		 * reveal + enable the
		 * voiceover button (hidden
		 * until a script exists).
		 */
		syncVoiceoverButton(n);

		showScriptBox(n);

		const lineCount =
			script
				.split(/\\n+/)
				.filter(
					(line) =>
						line.trim() !== ""
				)
				.length;

		const wordCount =
			script
				.split(/\\s+/)
				.filter(Boolean)
				.length;

		/*
		 * The SEO counts are minimums
		 * (1 long-tail at least 1x,
		 * exactly 4 short keywords at
		 * least 2x each) - show what
		 * the worker verified, plus the
		 * title/headings the AI planned.
		 */
		const shortCount =
			data.keywords &&
			Array.isArray(data.keywords.short)
				? data.keywords.short.length
				: 0;

		const headingCount =
			Array.isArray(data.headings)
				? data.headings.length
				: 0;

		const statusEl =
			document.getElementById(
				"va-script-status-" + n
			);

		const readyLine =
			"Script ready \u2014 " +
			wordCount +
			" words in " +
			lineCount +
			" paragraph" +
			(lineCount === 1 ? "" : "s") +
			" (" +
			speed +
			" speech, " +
			minutes +
			" min) \u00b7 SEO: 1 long-tail (\u22651\u00d7) + " +
			shortCount +
			" short keywords (\u22652\u00d7 each) \u00b7 title + " +
			headingCount +
			" heading" +
			(headingCount === 1 ? "" : "s");

		if (statusEl) {
			statusEl.textContent =
				readyLine;
		}

		setSeoWalkthroughScriptStatus(
			n,
			readyLine
		);

		console.info("[script-seo] ok", {
			videoIndex: n,
			model: data.model || null,
			title: project.seoTitle,
			headings: project.seoHeadings,
			keywords: data.keywords || null,
			words: wordCount,
			paragraphs: lineCount
		});

	}

	async function runSeoScriptRequest(
		n,
		topic,
		minutes,
		speed
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return false;
		}

		const btn =
			document.getElementById(
				"va-script-btn-" + n
			);

		const statusEl =
			document.getElementById(
				"va-script-status-" + n
			);

		if (!btn) {
			return false;
		}

		let scriptSucceeded =
			false;

		let lastError =
			null;
		let attemptsMade = 0;

		btn.disabled = true;

		setScriptLoading(
			n,
			true
		);

		if (statusEl) {
			statusEl.textContent =
				"Writing your script from the selected SEO keyword set (AI model)...";
		}

		const scriptStartedAt = Date.now();

		console.info("[script-seo] request", {
			videoIndex: n,
			topic: topic,
			minutes: minutes,
			speed: speed,
			attempts: SCRIPT_RETRY_LIMIT + 1
		});

		try {

			for (
				let attempt = 1;
				attempt <= SCRIPT_RETRY_LIMIT + 1;
				attempt++
			) {

				try {
					if (project._deleted || videoProjects.indexOf(project) < 0) return false;

					attemptsMade = attempt;
					const data =
						await requestSeoScriptOnce(
							videoProjects.indexOf(project) + 1,
							topic,
							minutes,
							speed,
							attempt - 1,
							lastError && lastError.message
						);

					if (project._deleted) return false;
					const liveN = videoProjects.indexOf(project) + 1;
					if (liveN <= 0) return false;
					applySeoScript(
						liveN,
						data,
						{
							minutes: minutes,
							speed: speed
						}
					);

					scriptSucceeded =
						true;

					recordStudioUsage("scripts", "ok", 1);

					lastError =
						null;

					break;

				}
				catch (err) {

					lastError =
						err;

					console.warn("[script-seo] attempt failed", {
						videoIndex: n,
						attempt: attempt,
						ms: Date.now() - scriptStartedAt,
						error: (err && err.message) || String(err)
					});

					if (project._deleted) return false;
					if (err && err.retryable === false) break;
					if (attempt <= SCRIPT_RETRY_LIMIT) {
						/* Not an error yet - the browser is retrying. */
						const retryLine =
							"Script generation failed \u2014 retrying (" +
							attempt +
							" of " +
							SCRIPT_RETRY_LIMIT +
							")\u2026";

						const liveStatus = document.getElementById("va-script-status-" + (videoProjects.indexOf(project) + 1));
						if (liveStatus) liveStatus.textContent = retryLine;

						setSeoWalkthroughScriptStatus(
							videoProjects.indexOf(project) + 1,
							retryLine
						);
						if ((await studioOffload.capabilities()).singleAttemptScript) await batchDelay(500 * attempt);
					}

				}

			}

			if (lastError) {

				/* Every attempt failed: now the UI may show the error. */
				const failureLine =
					"Script failed after " +
					attemptsMade +
					(attemptsMade === 1 ? " attempt: " : " attempts: ") +
					(lastError.message || lastError);

				const liveStatus = document.getElementById("va-script-status-" + (videoProjects.indexOf(project) + 1));
				if (liveStatus) liveStatus.textContent = failureLine;

				setSeoWalkthroughError(
					videoProjects.indexOf(project) + 1,
					failureLine
				);

				recordStudioUsage("scripts", "error", 1);

				console.error("[script-seo] failed", {
					videoIndex: n,
					ms: Date.now() - scriptStartedAt,
					attempts: attemptsMade,
					error: (lastError && lastError.message) || String(lastError)
				});

			}

		}
		finally {

			const liveN = videoProjects.indexOf(project) + 1;
			if (!project._deleted && liveN > 0) setScriptLoading(liveN, false);

			if (!project._deleted && liveN > 0 && !project._imageFlowActive) {
				const liveBtn = document.getElementById("va-script-btn-" + liveN);
				if (liveBtn) liveBtn.disabled = false;
			}

		}

		return scriptSucceeded;

	}

	// =========================================================
	// MODULE 9: voiceover + subtitles
	// (voice: MeloTTS via /api/voiceover -> MP3. The script is
	//  spoken EXACTLY as written: plain narration sentences, so
	//  there is no subtitle parsing anywhere in this module —
	//  a TTS model reads cue numbers and "-->" arrows out loud.
	//  Burned-in subtitles are built from the same sentences and
	//  drawn BELOW the caption, at 1/3 of the height up from the
	//  bottom.)
	// =========================================================

	/*
	 * One sentence per subtitle. The script arrives as plain text, so
	 * cues are made here: sentences are collected, split to caption
	 * width, and spread over the known span (the MP3 length once the
	 * voiceover exists, otherwise the length the worker verified).
	 * Timing is proportional to character count, so a long sentence
	 * stays on screen longer than "Yes." does.
	 */
	const SUBTITLE_MAX_CHARS =
		84;

	const SUBTITLE_MIN_MS =
		1200;

	function splitScriptSentences(script) {

		return String(script || "")
			.replace(/\\s+/g, " ")
			.split(/(?<=[.!?])\\s+/)
			.map((sentence) => sentence.trim())
			.filter(Boolean);

	}

	function wrapSubtitle(text, maxChars) {

		const words =
			String(text || "").split(/\\s+/).filter(Boolean);

		const lines = [];

		let line = "";

		for (const word of words) {

			if (!line) {
				line = word;
				continue;
			}

			if ((line + " " + word).length <= maxChars) {
				line += " " + word;
				continue;
			}

			lines.push(line);
			line = word;

		}

		if (line) {
			lines.push(line);
		}

		return lines.join("\\n");

	}

	/* Length of a generated voiceover blob, when the browser can decode it. */
	async function measureBlobMs(blob) {

		try {

			const context =
				getAudioContext();

			const decoded =
				await mediaDeadline(context.decodeAudioData(await blob.arrayBuffer()), 20000, "Narration duration decoding timed out.");

			return Math.round(
				decoded.duration * 1000
			);

		}
		catch (measureError) {

			console.warn(
				"[voiceover] could not measure the MP3",
				measureError
			);

			return 0;

		}

	}

	function buildScriptCues(
		script,
		totalMs
	) {

		const span =
			Number.isFinite(Number(totalMs)) && Number(totalMs) > 0
				? Number(totalMs)
				: 0;

		const sentences =
			splitScriptSentences(script)
				.map((sentence) => wrapSubtitle(sentence, SUBTITLE_MAX_CHARS))
				.filter(Boolean);

		if (!sentences.length || !span) {
			return [];
		}

		const weights =
			sentences.map((text) => Math.max(8, text.replace(/\\s+/g, " ").trim().length));

		const weightTotal =
			weights.reduce((sum, weight) => sum + weight, 0);

		/* Every cue keeps a readable floor; longer lines keep their share. */
		const minimum =
			SUBTITLE_MIN_MS * sentences.length;

		const scaled =
			span <= minimum
				? weights.map(() => span / sentences.length)
				: weights.map(
					(weight) =>
						SUBTITLE_MIN_MS +
						(span - minimum) * (weight / weightTotal)
				);

		const cues = [];

		let cursor = 0;

		for (let index = 0; index < sentences.length; index++) {

			const startMs =
				Math.round(cursor);

			cursor +=
				scaled[index];

			const endMs =
				index === sentences.length - 1
					? Math.max(startMs + SUBTITLE_MIN_MS, Math.round(span))
					: Math.round(cursor);

			cues.push({
				startMs: startMs,
				endMs: endMs,
				text: sentences[index]
			});

		}

		return cues;

	}

	/*
	 * One voiceover window per video, registered in the same stack as the
	 * walkthrough, so voicing Video 2 can never evict Video 1's window (and
	 * a walkthrough that still waits for a style choice stays put).
	 */
	function voiceoverModalId(n) {
		return "voiceover-modal-" + n;
	}

	function getVoiceoverModal(n) {
		return document.getElementById(voiceoverModalId(n));
	}

	function closeVoiceoverModal(n) {

		const modal =
			typeof n === "number"
				? getVoiceoverModal(n)
				: topModal();

		closeModal(
			modal
		);

	}

	function closeVoiceoverModalTop() {

		const modal =
			topModal();

		if (modal && !modalBlocksEscape(modal)) {
			closeModal(modal);
		}

	}

	function openVoiceoverModal(n) {

		const project =
			videoProjects[n - 1];

		if (!project) {

			return;

		}

		/*
		 * The accordion button only
		 * enables once the script box
		 * has text, so the modal always
		 * has a script to speak.
		 */

		if (!project.script) {

			return;

		}

		const existing =
			getVoiceoverModal(n);

		if (existing) {
			modalBringToFront(existing);
			existing.style.display = "flex";
			return existing;
		}

		const modal =
			document.createElement(
				"div"
			);

		modal.id =
			voiceoverModalId(n);

		modal.className =
			"modal-overlay";

		modal.setAttribute(
			"data-dismiss",
			"closeVoiceoverModalTop"
		);

		modal.innerHTML =
			'<div class="modal-box">' +
			'<div class="modal-title">\ud83c\udf99 Voiceover (MP3) \u2014 Video ' + n + '</div>' +
			'<div class="va-note" style="margin-bottom:8px">MeloTTS (Cloudflare AI) speaks this video\\'s script exactly as written \\u2014 plain narration sentences, never a subtitle format \\u2014 into an English MP3 (one fixed voice). The MP3 can be uploaded as this video\\'s audio track.</div>' +
			'<label class="quality-select voiceover-voice-label">Voice <select id="voiceover-voice-' + n + '" disabled title="Always English">' +
			'<option value="en" selected>English (en)</option>' +
			'</select></label>' +
			'<div class="voiceover-label">Script (spoken into the MP3)</div>' +
			'<textarea id="voiceover-text-' + n + '" class="voiceover-textarea" rows="8" readonly disabled></textarea>' +
			'<div class="voiceover-actions">' +
			'<button type="button" class="upload-btn small" id="voiceover-gen-' + n + '" onclick="generateVoiceover(' + n + ')">\ud83c\udfa7 Generate Voiceover (MP3)</button>' +
			'<button type="button" class="upload-btn small" id="voiceover-subtitles-' + n + '" onclick="toggleSubtitles(' + n + ')">' +
			(project.subtitles && project.subtitles.length
				? "\u2705 Subtitles ON \u2014 click to turn off"
				: "\ud83d\udcdd Apply Subtitles to Video") +
			'</button>' +
			'</div>' +
			'<span class="va-note" id="voiceover-status-' + n + '"></span>' +
			'<button type="button" class="upload-btn small" onclick="closeVoiceoverModal(' + n + ')">\u2715 Close</button>' +
			'</div>';

		openModal(
			modal
		);

		const area =
			modal.querySelector(
				"#voiceover-text-" + n
			);

		if (area) {

			/*
			 * The script IS the spoken text: it is handed to the
			 * voice as-is, with nothing parsed out of it.
			 */
			area.value =
				project.script;

		}

		return modal;

	}

	async function requestEditorVoiceover(project, text, lang) {
		if ((await studioOffload.capabilities()).chunkVoiceover) {
			const blob = await studioOffload.voiceover(text, lang, {
				isCancelled: function () { return Boolean(project._deleted); },
				setController: function (controller) { project._voiceoverController = controller; },
				clearController: function (controller) { if (project._voiceoverController === controller) project._voiceoverController = null; }
			});
			return { ok: true, blob: async function () { return blob; } };
		}
		return fetch("/api/voiceover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text, lang: lang }) });
	}

	async function generateVoiceover(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {

			return;

		}

		const genBtn =
			document.getElementById(
				"voiceover-gen-" + n
			);

		const statusEl =
			document.getElementById(
				"voiceover-status-" + n
			);

		const voiceSel =
			document.getElementById(
				"voiceover-voice-" + n
			);

		if (!genBtn) {
			return;
		}

		genBtn.disabled = true;

		if (statusEl) {
			statusEl.textContent =
				"Preparing...";
		}

		try {

			/*
			 * What the voice gets is the script box contents verbatim:
			 * the AI script is plain narration text, so there is no
			 * subtitle format to strip and nothing to misread.
			 */
			const text =
				String(project.script || "").trim();

			if (!text) {

				throw new Error(
					"No script text to speak"
				);

			}

			if (statusEl) {
				statusEl.textContent =
					"Speaking your script (MeloTTS)...";
			}

			const response = await requestEditorVoiceover(project, text, voiceSel ? voiceSel.value : "en");
			if (project._deleted) return;

			if (
				!response.ok
			) {

				const data =
					await response
						.json()
						.catch(
							() => ({})
						);

				throw new Error(
					(data && data.error) ||
					("HTTP " +
						response.status)
				);

			}

			const blob =
				await response.blob();

			recordStudioUsage("voiceovers", "ok", 1);

			const titleEl =
				document.getElementById(
					"va-title-" + n
				);

			const title =
				titleEl
					? titleEl.value.trim()
					: "";

			const isWav =
				String(
					blob.type
				) ===
				"audio/wav";

			const fileName =
				"YouTubeVibeStudio_" +
				(title ||
					"Video" + n).replace(
						/[^A-Za-z0-9]+/g,
						""
					) +
				"_voiceover." +
				(isWav
					? "wav"
					: "mp3");

			const url =
				createStudioObjectUrl(
					blob
				);

			const a =
				document.createElement(
					"a"
				);

			a.href = url;
			a.download = fileName;

			document.body.appendChild(
				a
			);

			a.click();

			document.body.removeChild(
				a
			);

			setTimeout(
				function () {
					releaseStudioObjectUrl(url);
				},
				2000
			);

			project.voiceoverFile =
				blob;

			/*
			 * The MP3 is now the truth about how long this video is, so
			 * any subtitle track already applied is re-timed against it
			 * instead of the worker's estimate. Same sentences, real
			 * durations.
			 */
			if (
				project.subtitles &&
				project.subtitles.length
			) {
				project.subtitles =
					buildScriptCues(
						text,
						(await measureBlobMs(blob)) ||
						project.scriptDurationMs
					);
			}

			if (statusEl) {
				statusEl.textContent =
					"Voiceover MP3 saved \u2014 upload it as the audio track" +
					(project.subtitles && project.subtitles.length
						? " (subtitles re-timed to the MP3)"
						: "");
			}

		}
		catch (err) {

			if (statusEl) {
				statusEl.textContent =
					"Voiceover failed: " +
					(err.message || err);
			}

		}
		finally {

			genBtn.disabled = false;

		}

	}

	/*
	 * Toggle the narration script as
	 * burned-in subtitles for this
	 * video: one sentence per cue,
	 * drawn below the caption, at 1/3
	 * of the height up from the bottom,
	 * for every export. Click again to
	 * turn them off. The modal stays
	 * open. Nothing here parses a
	 * subtitle file - the cues are made
	 * from the plain script and spread
	 * over the real audio length.
	 */
	function toggleSubtitles(n) {

		const project =
			videoProjects[n - 1];

		if (
			!project ||
			!project.script
		) {

			return;

		}

		const statusEl =
			document.getElementById(
				"voiceover-status-" + n
			);

		const subBtn =
			document.getElementById(
				"voiceover-subtitles-" + n
			);

		const scriptStatus =
			document.getElementById(
				"va-script-status-" + n
			);

		if (
			project.subtitles &&
			project.subtitles.length
		) {

			/*
			 * Subtitles are ON ->
			 * turn them off.
			 */

			project.subtitles =
				null;

			if (statusEl) {

				statusEl.textContent =
					"Subtitles turned off";

			}

			if (scriptStatus) {

				scriptStatus.textContent =
					"Subtitles off";

			}

			if (subBtn) {

				subBtn.textContent =
					"\ud83d\udcdd Apply Subtitles to Video";

			}

			return;

		}

		const cues =
			buildScriptCues(
				project.script,
				project.audio && project.audio.duration
					? project.audio.duration * 1000
					: project.scriptDurationMs
			);

		if (!cues.length) {

			if (statusEl) {

				statusEl.textContent =
					"No sentences found in the script";

			}

			return;

		}

		project.subtitles =
			cues;

		if (statusEl) {

			statusEl.textContent =
				"Subtitles applied (" +
				cues.length +
				" cues) \u2014 shown below the caption";

		}

		if (scriptStatus) {

			scriptStatus.textContent =
				"Subtitles applied to this video";

		}

		if (subBtn) {

			subBtn.textContent =
				"\u2705 Subtitles ON \u2014 click to turn off";

		}

	}

	initVideoStudio();
	bindStudioShell();
	bindLandingActions();
	initAuth();

	async function generateMP4() {

		if (
			activeSlides.length === 0
		) {

			alert(
				"Please wait for images to generate or upload your own!"
			);

			return "skipped";

		}


		if (
			typeof VideoEncoder ===
			"undefined"
		) {

			alert(
				"Your browser does not support WebCodecs. Please use modern Chrome, Edge, or Safari."
			);

			return "error";

		}

		if (typeof Mp4Muxer === "undefined") {
			alert("The MP4 export library is still loading or unavailable. Check your connection and try again.");
			return "error";
		}

		// =====================================================
		// CHOOSE WHERE THE MP4 IS WRITTEN
		// =====================================================

		/*
		 * This is the fix for the crash.
		 *
		 * Building the whole MP4 in memory
		 * and then copying it again into a
		 * Blob is what killed the tab on
		 * long videos.
		 *
		 * Chrome and Edge can stream the
		 * file straight to disk instead, so
		 * memory stays flat no matter how
		 * long the video is.
		 *
		 * The save dialog is opened first,
		 * while the click still counts as a
		 * user gesture.
		 */

		const fileName =
			renderContext &&
				renderContext.fileName
				? renderContext.fileName
				: "YouTubeVibeStudio_" +
					Date.now() +
					".mp4";



		let fileStream =
			null;

		window.__lastRenderBlob =
			null;

		if (
			typeof window.showSaveFilePicker ===
			"function" &&
			!window.__workerMode
		) {

			try {

				const handle =
					await window.showSaveFilePicker(
						{

							suggestedName:
								fileName,

							types: [
								{
									description:
										"MP4 video",

									accept: {
										"video/mp4": [
											".mp4"
										]
									}
								}
							]

						}
					);


				fileStream =
					await handle.createWritable();

			}
			catch (error) {

				/*
				 * The user closed the dialog.
				 */

				if (
					error &&
					error.name ===
						"AbortError"
				) {

					return "skipped";

				}


				/*
				 * Anything else falls back to
				 * building the file in memory.
				 */

				console.warn(
					"Save-to-disk unavailable:",
					error
				);


				fileStream =
					null;

			}

		}


		/*
		 * True when the file is streamed to
		 * disk instead of held in RAM.
		 */

		const streamingToFile =
			fileStream !== null;


		const renderBtn =
			document.getElementById(
				"render-btn"
			);


		const progressContainer =
			document.getElementById(
				"progress-container"
			);


		const progressBar =
			document.getElementById(
				"progress-bar"
			);


		const statusText =
			document.getElementById(
				"status-text"
			);


		const placeholder =
			document.getElementById(
				"canvas-placeholder"
			);


		const canvas =
			document.getElementById(
				"video-canvas"
			);


		const ctx =
			canvas.getContext(
				"2d",
				{
					alpha: false
				}
			);


		/*
		 * Scratch canvas used to blit the current
		 * frame of a GIF slide before it is drawn
		 * into the video.
		 */

		const gifCanvas =
			document.createElement(
				"canvas"
			);


		const gifCtx =
			gifCanvas.getContext(
				"2d"
			);


		/*
		 * Captions are parsed once here so the
		 * per-frame loop stays cheap.
		 */

		const captions =
			getCaptions();

		/*
		 * Subtitles (the applied plain
		 * script) come from the render
		 * context, if any.
		 */

		const subtitles =
			renderContext &&
			renderContext.subtitles
				? renderContext.subtitles
				: [];



		renderBtn.disabled =
			true;


		placeholder.style.display =
			"none";


		progressContainer.style.display =
			"block";


		statusText.style.display =
			"block";


		progressBar.style.width =
			"0%";


		// =====================================================
		// VIDEO SETTINGS
		// =====================================================

		const quality =
			getQuality();


		const WIDTH =
			renderContext && renderContext.frameWidth
				? renderContext.frameWidth
				: quality.width;


		const HEIGHT =
			renderContext && renderContext.frameHeight
				? renderContext.frameHeight
				: quality.height;


		const FPS =
			30;


		/*
		 * The canvas must match the encoder
		 * size or VideoFrame and
		 * VideoEncoder will disagree.
		 */

		canvas.width =
			WIDTH;


		canvas.height =
			HEIGHT;


		/*
		 * The title font has to be ready
		 * before the first frame is drawn.
		 */

		await loadTitleFont();


		await loadCaptionFont();


		/*
		 * Every image lasts 9 seconds.
		 *
		 * When the track is longer than the
		 * selected slides, the slide list is
		 * repeated from the start until the
		 * whole track is covered.
		 */

		const slides =
			getSlideSequence();


		const SECONDS_PER_SLIDE =
			getSecondsPerSlide();


		const TOTAL_FRAMES =
			slides.reduce(
				(sum, slide) =>
					sum +
					framesForSlide(
						slide,
						FPS
					),
				0
			);


		/*
		 * Keyframes are deliberately
		 * more than 7 seconds apart.
		 *
		 * This does NOT create visual
		 * transitions.
		 */

		const KEYFRAME_INTERVAL =
			FPS *
			10;


		/*
		 * Exact length of the finished
		 * video, used to size the audio.
		 */

		const VIDEO_SECONDS =
			TOTAL_FRAMES /
			FPS;


		// =====================================================
		// MEMORY SAFETY NET
		// =====================================================

		/*
		 * Only needed when the browser has
		 * to build the file in memory.
		 *
		 * Streaming to disk has no such
		 * limit, so this is skipped there.
		 */

		if (!streamingToFile) {

			const audioBitrate =
				currentAudio
					? quality.audioBitrate
					: 0;


			const estimatedBytes =
				(VIDEO_SECONDS *
					(
						quality.videoBitrate +
						audioBitrate
					)) /
				8;


			if (
				estimatedBytes >
				250 *
					1024 *
					1024
			) {

				const proceed =
					confirm(
						"This video will be about " +
							formatBytes(
								estimatedBytes
							) +
							" and has to be built in memory, because this browser cannot save straight to disk.\\n\\nThat may crash the tab. Continue anyway?"
					);


				if (!proceed) {

					renderBtn.disabled =
						false;

					progressContainer.style.display =
						"none";

					statusText.style.display =
						"none";

					return "skipped";

				}

			}

		}


		// =====================================================
		// ENCODE THE AUDIO TRACK FIRST
		// =====================================================

		/*
		 * The audio is encoded before the
		 * muxer is created so that the
		 * muxer only declares an audio
		 * track when there is real AAC
		 * data to write.
		 */

		let audioChunks =
			[];


		let audioTrack =
			null;


		if (currentAudio) {

			if (
				typeof AudioEncoder ===
				"undefined"
			) {

				alert(
					"Your browser cannot encode audio (WebCodecs AudioEncoder missing). Rendering a silent video."
				);

			}
			else {

				try {

					statusText.textContent =
						"Encoding audio track...";


					const encoded =
						await encodeAudioTrack(
							currentAudio.buffer,
							VIDEO_SECONDS,
							quality.audioBitrate,
							(fraction) => {

								/*
								 * Audio owns the first
								 * 25% of the bar.
								 */

								progressBar.style.width =
									Math.round(
										fraction *
											25
									) +
									"%";

							}
						);


					audioChunks =
						encoded.chunks;


					audioTrack = {

						codec:
							"aac",

						sampleRate:
							encoded.sampleRate,

						numberOfChannels:
							encoded.numberOfChannels

					};

				}
				catch (error) {

					console.error(
						"Audio encoding failed:",
						error
					);


					alert(
						"Audio could not be encoded. Rendering a silent video."
					);


					audioChunks =
						[];


					audioTrack =
						null;

				}

			}

		}


		// =====================================================
		// MP4 MUXER
		// =====================================================

		/*
		 * fastStart is false on purpose.
		 *
		 * "in-memory" makes the muxer hold
		 * every media chunk until finalize,
		 * which is what pushed the tab over
		 * the memory limit. Writing the
		 * metadata at the end uses the least
		 * memory and the file still plays
		 * normally once downloaded.
		 */

		const muxerConfig = {

			target:
				streamingToFile
					? new Mp4Muxer.FileSystemWritableFileStreamTarget(
							fileStream,
							{
								chunkSize:
									8 *
										1024 *
										1024
							}
						)
					: new Mp4Muxer.ArrayBufferTarget(),

			video: {

				codec:
					"avc",

				width:
					WIDTH,

				height:
					HEIGHT

			},

			fastStart:
				false

		};


		/*
		 * Only add the audio track when
		 * AAC chunks exist.
		 */

		if (audioTrack) {

			muxerConfig.audio =
				audioTrack;

		}


		const muxer =
			new Mp4Muxer.Muxer(
				muxerConfig
			);


		// =====================================================
		// AUDIO / VIDEO INTERLEAVING
		// =====================================================

		/*
		 * Audio chunks are written together
		 * with the video frames that share
		 * their timestamp, which keeps the
		 * MP4 properly interleaved.
		 */

		let audioIndex =
			0;


		function flushAudioUpTo(
			timestampMicroseconds
		) {

			while (
				audioIndex <
					audioChunks.length &&
				audioChunks[audioIndex]
					.timestamp <=
					timestampMicroseconds
			) {

				const item =
					audioChunks[
						audioIndex
					];


				muxer.addAudioChunk(
					item.chunk,
					item.meta
				);


				audioIndex++;

			}

		}


		// =====================================================
		// VIDEO ENCODER
		// =====================================================

		let encoderError =
			null;


		const videoEncoder =
			new VideoEncoder({

				output:
					(chunk, meta) => {

						muxer.addVideoChunk(
							chunk,
							meta
						);

					},


				error:
					(error) => {

						console.error(
							"VideoEncoder error:",
							error
						);


						encoderError =
							error;

					}

			});


		videoEncoder.configure({

			codec:
				"avc1.4d002a",

			width:
				WIDTH,

			height:
				HEIGHT,

			bitrate:
				quality.videoBitrate,

			framerate:
				FPS

		});


		// =====================================================
		// ENCODER BACKPRESSURE
		// =====================================================

		/*
		 * Prevents crashes when rendering
		 * many images.
		 */

		const MAX_ENCODE_QUEUE =
			12;


		/*
		 * A dead encoder (or a browser that silently stops draining
		 * the queue) used to make this loop spin forever: the
		 * progress bar froze at the same percentage and the export
		 * never returned. It now fails fast with a clear message, so
		 * the queue can mark the video "error" and move on to the
		 * next one.
		 */

		const ENCODER_STALL_TIMEOUT_MS =
			15000;


		const ENCODER_FLUSH_TIMEOUT_MS =
			180000;


		async function waitForEncoder() {

			const startedAt =
				Date.now();


			while (
				videoEncoder.encodeQueueSize >
				MAX_ENCODE_QUEUE
			) {

				if (encoderError) {

					throw encoderError;

				}


				if (
					videoEncoder.state ===
						"closed"
				) {

					throw new Error(
						"The video encoder closed before the export finished."
					);

				}


				if (
					Date.now() -
						startedAt >
					ENCODER_STALL_TIMEOUT_MS
				) {

					throw new Error(
						"The video encoder stopped accepting frames. Try a lower quality or fewer MP4 clips."
					);

				}


				await new Promise(
					resolve =>
						setTimeout(
							resolve,
							8
						)
				);

			}


			if (encoderError) {

				throw encoderError;

			}

		}


		// =====================================================
		// ANIMATION TYPES
		// =====================================================

		const effects = [

			"slide-left",

			"slide-right",

			"slide-down",

			"zoom-in"

		];


		/*
		 * Pause every clip preview; the
		 * active clip is played while
		 * its frames are captured.
		 */


		for (
			const pauseSlide of slides
		) {


			if (
				pauseSlide.type ===
					"mp4" &&
				pauseSlide.videoEl
			) {


				pauseSlide.videoEl.pause();


			}


		}


		/*
		 * Clip capture needs a composited element.
		 *
		 * The editor's clips (\`asset.videoEl\`) are built with
		 * createElement() while the file is probed and are never
		 * attached to the document, so the browser has no reason to
		 * present their frames: requestVideoFrameCallback never
		 * fires and the export used to wait forever on the very
		 * first clip frame. Moving each such clip into the
		 * invisible off-viewport host for the duration of the
		 * export brings the playback path back; clips that are
		 * already visible in a preview are left alone, and every
		 * move is undone in the finally block below.
		 */

		const clipRestores =
			[];


		for (
			const captureSlide of slides
		) {

			if (
				captureSlide &&
				captureSlide.type ===
					"mp4" &&
				captureSlide.videoEl
			) {

				const restore =
					mountClipForCapture(
						captureSlide.videoEl
					);


				if (restore) {

					clipRestores.push(
						restore
					);

				}

			}

		}



		let currentFrame =
			0;


		try {

			// =================================================
			// PROCESS EACH IMAGE
			// =================================================

			for (
				let i = 0;
				i < slides.length;
				i++
			) {

				const slide =
					slides[i];


				/*
				 * GIF slides are drawn from their decoded
				 * animation frames. The scratch canvas holds
				 * the current frame; it is refreshed for
				 * every video frame of the slide, below.
				 */

				let img =
					slide.img;


				const gif =
					slide.type ===
						"gif"
						? slide.gif
						: null;


				if (gif) {

					/*
					 * Size the scratch canvas once per
					 * slide.
					 */

					if (
						gifCanvas.width !==
							gif.width ||
						gifCanvas.height !==
							gif.height
					) {

						gifCanvas.width =
							gif.width;


						gifCanvas.height =
							gif.height;

					}

				}


				const frames =
					framesForSlide(
						slide,
						FPS
					);


				let clipVideo =
					slide.type ===
						"mp4"
					? slide.videoEl
					: null;


				/*
				 * Two capture modes for this clip. Playback is the
				 * fast path; once the browser stops presenting
				 * frames (detached element, hidden tab, rejected
				 * play()) the slide finishes in seek mode instead
				 * of waiting forever.
				 */

				let clipSeekMode =
					false;


				const clipSeconds =
					slideDurationSec(
						slide
					);


				if (clipVideo) {


					const clipDrawable =
						await prepareClip(
							clipVideo
						);


					clipSeekMode =
						Boolean(
							clipVideo.paused
						);


					if (!clipDrawable) {

						console.warn(
							"[render] A clip has no decodable frame yet; its frames are captured by seeking."
						);

					}

				}


				const effect =
					effects[
						i %
						effects.length
					];


				// =============================================
				// ANIMATED DURATION PER IMAGE
				// =============================================

				for (
					let f = 0;
					f < frames;
					f++
				) {


					/*
					 * Keep the clip in real time while the browser
					 * really presents frames; otherwise park it on
					 * the exact time of this output frame.
					 *
					 * Both paths are bounded, so a clip can never
					 * stall the export again (bug fix: the old
					 * unbounded await on requestVideoFrameCallback
					 * is what left the studio "rendering" forever).
					 */


					if (
						clipVideo &&
						f >
							0
					) {


						if (clipSeekMode) {


							await captureClipFrameAt(
								clipVideo,
								f /
									FPS,
								clipSeconds
							);


						}

						else {


							const presented =
								await nextClipFrame(
									clipVideo,
									CLIP_FRAME_TIMEOUT_MS
								);


							if (!presented) {

								/*
								 * Hidden element / background tab:
								 * stop relying on the compositor for
								 * the rest of this clip.
								 */

								clipSeekMode =
									true;


								console.warn(
									"[render] The clip stopped presenting frames (hidden element or background tab); switching to seek-based frame capture."
								);


								try {

									clipVideo.pause();

								}
								catch (pauseError) {

									/* already paused */

								}


								await captureClipFrameAt(
									clipVideo,
									f /
										FPS,
									clipSeconds
								);

							}

						}

					}


					/*
					 * Pick the current frame of the GIF
					 * animation for this video frame.
					 */

					if (gif) {

						const timeInSlideMs =
							(f / FPS) *
								1000;


						const loopMs =
							gif.loopMs > 0
								? gif.loopMs
								: 1;


						const loopTimeMs =
							timeInSlideMs %
								loopMs;


						const frameIndex =
							gifFrameIndexAt(
								gif,
								loopTimeMs
							);


						gifCtx.putImageData(
							gif.frames[
								frameIndex
							].data,
							0,
							0
						);


						img =
							gifCanvas;

					}


					/*
					 * Progress from 0 to 1.
					 *
					 * A one-frame slide used to divide by zero
					 * here, which turned every coordinate into
					 * NaN and made drawImage() a no-op.
					 */

					const p =
						f /
						Math.max(
							1,
							frames -
								1
						);


					/*
					 * Smooth camera movement.
					 */

					const ease =
						p *
						p *
						(
							3 -
							2 * p
						);


					// =========================================
					// CLEAR PREVIOUS FRAME
					// =========================================

					/*
					 * Clear the previous image.
					 *
					 * This is NOT a transition.
					 *
					 * The next image is drawn immediately
					 * over the cleared frame.
					 */

					ctx.clearRect(
						0,
						0,
						WIDTH,
						HEIGHT
					);


					// =========================================
					// CAMERA SCALE
					// =========================================

					/*
					 * 1.15x gives enough room
					 * for panning without
					 * showing empty edges.
					 */

					const zoomScale =
						1.15;


					const drawWidth =
						WIDTH *
						zoomScale;


					const drawHeight =
						HEIGHT *
						zoomScale;


					const overflowX =
						drawWidth -
						WIDTH;


					const overflowY =
						drawHeight -
						HEIGHT;


					/*
					 * Only use part of the available
					 * movement so the camera remains
					 * extremely slow and cinematic.
					 */

					const movementX =
						overflowX *
						0.55;


					const movementY =
						overflowY *
						0.55;


					let dx =
						0;


					let dy =
						0;


					let dw =
						drawWidth;


					let dh =
						drawHeight;


					// =========================================
					// PAN LEFT
					// =========================================

					if (
						effect ===
						"slide-left"
					) {

						/*
						 * Start slightly toward
						 * the right and slowly
						 * travel left.
						 */

						dx =
							0 -
							movementX *
							ease;


						dy =
							-overflowY /
							2;

					}


					// =========================================
					// PAN RIGHT
					// =========================================

					else if (
						effect ===
						"slide-right"
					) {

						dx =
							-movementX +
							(
								movementX *
								ease
							);


						dy =
							-overflowY /
							2;

					}


					// =========================================
					// PAN DOWN
					// =========================================

					else if (
						effect ===
						"slide-down"
					) {

						dx =
							-overflowX /
							2;


						dy =
							-movementY *
							ease;

					}


					// =========================================
					// VERY SLOW ZOOM
					// =========================================

					else if (
						effect ===
						"zoom-in"
					) {

						/*
						 * Only 4% additional zoom
						 * over the entire slide.
						 *
						 * This is deliberately subtle.
						 */

						const currentScale =
							1.04 +
							(
								ease *
								0.04
							);


						dw =
							WIDTH *
							currentScale;


						dh =
							HEIGHT *
							currentScale;


						dx =
							(
								WIDTH -
								dw
							) /
							2;


						dy =
							(
								HEIGHT -
								dh
							) /
							2;

					}


					// =========================================
					// DRAW IMAGE
					// =========================================

					/*
					 * IMPORTANT:
					 *
					 * No fade.
					 * No opacity.
					 * No black overlay.
					 * No transition.
					 *
					 * The image is fully opaque.
					 */

					ctx.globalAlpha =
						1;


					/*
					 * A video source can be drawable-checks
					 * dependent: drawImage() throws
					 * InvalidStateError when a clip has no
					 * decoded frame, and that used to fail the
					 * whole export. Skip that one draw and keep
					 * rendering (the overlays still go on).
					 */

					if (
						drawableSlideSource(
							img
						)
					) {

						ctx.drawImage(
							img,
							dx,
							dy,
							dw,
							dh
						);

					}


					// =========================================
					// TITLE OVERLAY
					// =========================================

					drawTitle(
						ctx
					);


					// =========================================

					// TIMESTAMP CAPTION OVERLAY

					// =========================================


					const frameTimeMs =
						(currentFrame * 1000) /
							FPS;


					drawCaptions(

						ctx,

						captions,

						frameTimeMs,

						WIDTH,

						HEIGHT

					);


					/*
					 * Script subtitles: below the
					 * caption, 1/3 up from the
					 * bottom.
					 */

					drawSubtitles(

						ctx,

						subtitles,

						frameTimeMs,

						WIDTH,

						HEIGHT

					);


					// =========================================
					// CREATE VIDEO FRAME
					// =========================================

					const timestamp =
						(
							currentFrame *
							1_000_000
						) /
						FPS;


					const frame =
						new VideoFrame(
							canvas,
							{
								timestamp: timestamp,
								// Preserve the final frame's duration in the real MP4 muxer.
								duration: Math.round(1_000_000 / FPS)
							}
						);


					// =========================================
					// ENCODE
					// =========================================

					videoEncoder.encode(
						frame,
						{

							/*
							 * Keyframes occur every
							 * 10 seconds.
							 *
							 * The visual image change
							 * still occurs at the end
							 * of each slide.
							 */

							keyFrame:
								currentFrame %
								KEYFRAME_INTERVAL ===
								0

						}
					);


					/*
					 * Immediately release
					 * the VideoFrame.
					 */

					frame.close();


					// =========================================
					// WRITE MATCHING AUDIO
					// =========================================

					flushAudioUpTo(
						timestamp
					);


					currentFrame++;


					// =========================================
					// BACKPRESSURE
					// =========================================

					await waitForEncoder();


					// =========================================
					// PROGRESS
					// =========================================

					if (
						currentFrame %
						15 ===
						0
					) {

						const fraction =
							currentFrame /
							TOTAL_FRAMES;


						/*
						 * Audio used the first 25%
						 * of the bar when present.
						 */

						const percent =
							Math.round(
								audioTrack
									? 25 +
										fraction *
											75
									: fraction *
											100
							);


						progressBar.style.width =
							percent +
							"%";


						statusText.textContent =
							\`Rendering image \${i + 1}/\${slides.length} \u2014 \${percent}%\`;


						/*
						 * Give the browser time
						 * to update the UI.
						 */

						await new Promise(
							resolve =>
								setTimeout(
									resolve,
									0
								)
						);

					}

				}


				if (
					clipVideo
				) {


					clipVideo.pause();


				}


				/*
				 * Make sure the encoder catches up
				 * before processing another image.
				 */

				await waitForEncoder();


				statusText.textContent =
					\`Completed image \${i + 1} of \${slides.length}\`;

			}


			/*
			 * Resume the clip previews.
			 */


			for (
				const resumeSlide of slides
			) {


				if (
					resumeSlide.type ===
						"mp4" &&
					resumeSlide.videoEl
				) {


					try {


						/*
						 * play() rejects through its promise, which a
						 * try/catch cannot see. Swallow it so a blocked
						 * autoplay never surfaces as an unhandled
						 * rejection (the export itself does not need
						 * the preview to play).
						 */

						const resumed =
							resumeSlide.videoEl.play();


						if (
							resumed &&
							typeof resumed.catch ===
								"function"
						) {

							resumed.catch(
								() => {}
							);

						}


					}


					catch (resumeError) {


						console.error(
							"Clip resume failed:",
							resumeError
						);


					}


				}


			}


			// =================================================
			// FLUSH ENCODER
			// =================================================

			statusText.textContent =
				"Finalizing MP4 file...";


			/*
			 * Bounded, for the same reason as waitForEncoder(): a
			 * flush that never settles would leave the studio on
			 * "Finalizing MP4 file..." forever. The promise is not
			 * cancelled (WebCodecs has no cancel), but the export
			 * now reports the failure instead of hanging.
			 */

			let flushTimer =
				null;


			try {

				await Promise.race([
					videoEncoder.flush(),
					new Promise(
						(resolve, reject) => {

							flushTimer =
								setTimeout(
									() => reject(
										new Error(
											"Finalizing the MP4 file took longer than " +
												Math.round(
													ENCODER_FLUSH_TIMEOUT_MS /
														1000
												) +
												" seconds. The file was not saved."
										)
									),
									ENCODER_FLUSH_TIMEOUT_MS
								);

						}
					)
				]);

			}

			finally {

				/*
				 * Never leave the watchdog timer behind: a pending
				 * 3-minute timer keeps the tab (and any test runner)
				 * alive long after the export finished.
				 */

				if (flushTimer) {

					clearTimeout(
						flushTimer
					);

				}

			}


			if (encoderError) {

				throw encoderError;

			}


			// =================================================
			// WRITE ANY REMAINING AUDIO
			// =================================================

			flushAudioUpTo(
				Number.POSITIVE_INFINITY
			);


			// =================================================
			// FINALIZE MP4
			// =================================================

			muxer.finalize();


			// =================================================
			// SAVE OR DOWNLOAD
			// =================================================

			if (streamingToFile) {

				/*
				 * Closing the stream is what
				 * flushes the finished file to
				 * disk.
				 */

				await fileStream.close();


				fileStream =
					null;

			}
			else {

				const buffer =
					muxer.target.buffer;


				const blob =
					new Blob(
						[buffer],
						{
							type:
								"video/mp4"
						}
					);

			window.__lastRenderBlob =
				blob;

				const downloadURL =
					createStudioObjectUrl(
						blob
					);


				const a =
					document.createElement(
						"a"
					);


				a.href =
					downloadURL;


				a.download =
					fileName;


				document.body.appendChild(
					a
				);


				if (!window.__workerMode) {
					a.click();
				}


				a.remove();


				setTimeout(
					() => {

						releaseStudioObjectUrl(
							downloadURL
						);

					},
					2000
				);

			}


			progressBar.style.width =
				"100%";


			statusText.textContent =
				streamingToFile
					? audioTrack
						? "\u2713 MP4 saved to disk with audio!"
						: "\u2713 MP4 saved to disk!"
					: audioTrack
						? "\u2713 MP4 Downloaded with audio!"
						: "\u2713 MP4 Downloaded!";

			recordStudioUsage("videos", "ok", 1);

			return "done";

		}
		catch (error) {

			console.error(
				"MP4 rendering failed:",
				error
			);


			statusText.textContent =
				"\u26a0 Video rendering failed.";


			alert(
				"Video rendering failed: " +
					(error.message || String(error)) +
					"\\n\\nTry reducing the number of images or closing other browser tabs."
			);

			return "error";

		}
		finally {

			/*
			 * Always clean up the encoder.
			 */

			if (
				videoEncoder.state !==
				"closed"
			) {

				try {

					videoEncoder.close();

				}
				catch (error) {

					console.warn(
						"Encoder cleanup error:",
						error
					);

				}

			}


			/*
			 * A failed render must release the
			 * file handle, otherwise the
			 * partial file stays locked.
			 */

			if (fileStream) {

				try {

					await fileStream.abort();

				}
				catch (error) {

					console.warn(
						"File stream cleanup error:",
						error
					);

				}

			}


			for (
				const restoreClip of clipRestores
			) {

				try {

					restoreClip();

				}

				catch (restoreError) {

					console.warn(
						"Clip restore error:",
						restoreError
					);

				}

			}


			renderBtn.disabled =
				false;

		}

	}


`;
