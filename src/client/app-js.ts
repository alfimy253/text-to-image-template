/*
 * APP_JS — the main YouTube Vibe Studio client script
 * (MODULES 1-8: video projects, gallery, queue, AI panel,
 * SRT script, voiceover, render engine).
 *
 * __PROMPTS_JSON__ is replaced by page.ts with
 * JSON.stringify(prompts) — the only server-side
 * interpolation in the whole page.
 *
 * Verbatim copy of the old inline script; the escapes
 * (\`, \${, \\u...) are intentional — do not reformat.
 */

export const APP_JS = `
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


	const stickerSelectEl =
		document.getElementById(
			"sticker-select"
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


	/*
	 * Sticker geometry, in canvas pixels.
	 *
	 * The rectangle is a fixed size and
	 * sits flush in the bottom right
	 * corner (RIGHT_GAP 0, BOTTOM_GAP 0).
	 *
	 * EXCEED_RIGHT pushes it past the
	 * right edge so the corner is fully
	 * covered.
	 *
	 * The sticker is square cornered, so
	 * RADIUS stays 0.
	 *
	 * The emoji and text inside are scaled
	 * down automatically to fit the part of
	 * the rectangle that is on screen.
	 */

	const STICKER_HEIGHT =
		150;

	/*
	 * The sticker box must never be
	 * taller than this, so it does not
	 * look stretched when the video is
	 * viewed in fullscreen.
	 */
	const STICKER_MAX_HEIGHT =
		150;


	const STICKER_WIDTH =
		435;


	const STICKER_RIGHT_GAP =
		0;


	const STICKER_BOTTOM_GAP =
		0;


	const STICKER_EXCEED_RIGHT =
		40;


	const STICKER_RADIUS =
		0;


	const STICKER_PADDING =
		17;


	const STICKER_GAP =
		20;


	const STICKER_ICON_GAP =
		4;


	const STICKER_EMOJI_SIZE =
		33;


	const STICKER_TEXT_SIZE =
		16;


	const STICKER_TEXT_MIN =
		14;


	const STICKER_TEXT_MAX =
		16;


	/*
	 * Colour emoji need their own font
	 * stack, otherwise they can render as
	 * empty boxes.
	 */

	const STICKER_EMOJI_FONT =
		"'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Segoe UI Symbol', sans-serif";

	/*
	 * The sticker icon artwork,
	 * embedded as data URIs
	 * (offline-safe): the icons
	 * are identical on every
	 * machine, no network
	 * needed.
	 */
	const STICKER_EMOJI_DATA =
		{
			"1f525": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAMAAABiM0N1AAAAh1BMVEVHcEz0kAz0kAz0kAz0kAz0kAz0kAz0kAz0kAz0kAz0kAz0kAz0kAz0kAz0kAz0kAz/zE3/zE3/zE3/zE3/zE3/zE3/zE3/zE39wkL/zE3/zE3/zE3/zE30kAz/zE36ri33nxz+yEn+xUX5qij8vT32mxj9wUH3oyD1mBT6sjH1lBD7tjX8uTmQeifTAAAAHXRSTlMAMEBQv++PEM+A359gryBwzxDvv4CPUK9gIN9gMOUtXcUAAAKrSURBVHjarZfZkoIwEEWDLEkAcXfWDpu78//fN4OMqdAkJFCeJy3LI919OwJxJAtm5DUkENGXiGYAof8SUwwAERkPxV+K4I+AjvawoFdbAxtrYpAQBDiacB1c06SG+RiPBxpRAC2cuDMHgMQkgszZkz2a0W/bP4GzaAENuKsg8dwra0hJBx8kiXuIG2K8bJLQVaQbjwcKM3cRLo7KVlsTEGX9ti56Hnso/Vg3H5bSRsNDkFgCkIUJEklXwAATm0UBcPWNDaMn7UwimiyicUfkTxZxtIoxaLEnMkQ/YqstMHUIb6I/UcRw7Gegw7q1nkyxq2jR/b7X6UjiXBpeWj9SK4OQujcbzZz9h6i30jSEQRg+B2mnjtBzXZE5Pgd9mcbW1JbuMbDA8aw4/n3GOceao21oi2euLBdwqvLb4NDiZ9NgmFqIMscinDkX0VH8cToaSwtcRVA2pvJs2JCFDFYGFg7iQXtNOLteKEUULNxbUXlBlyQ9rqXlouWgFkcf18ABJohEAQoB5/MQpokOYEQfSJS/H/HkMrzFAW5uAR0qKaqHj14OHa7ijAIp+RneYh9UzkLkaPqSExjwSS9IlxI19SgUwMB/QBnu7E1p/Ela0Aeo1+iELkRDjj2aJBXK6+iZc+NeFYoHieqD5i6XqRfUUNa3pu93gcjV4Rb9/4JUM6GqFH2uarrumlvNUB49w1Sdc1Nza8JlZRZqNRRF/z+FxnI9nUy10rGYEoVUzsxGlefXSj0NUs0zVCVGUelulbKm32IkTaczgvCniXzSI5oiioiG+XjR3PCoP1ZkenSny3GeJSUGVm9jPG8rYmbn7tmRQfZrN816Tyx8bFw8mw9i5/3Tpvl8J06stuvBqraUOPO1NM78i4zje7fUWHbfZAKr/XazlI7Ndj8UnF+YwEpCshNBaAAAAABJRU5ErkJggg==",
			"2764": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAMAAABiM0N1AAAAM1BMVEVHcEzdLkTdLkTdLkTdLkTdLkTdLkTdLkTdLkTdLkTdLkTdLkTdLkTdLkTdLkTdLkTdLkQVM82yAAAAEHRSTlMAIN+fzzBAEO+/j3Bgr1CAS8Xz9AAAAV5JREFUeF7l2M2OgzAMhdGbEOK4/N33f9rRMMISamgF9m7O1tKnNgmtAv6Vsdbx4dykSRt3bZlSb74cc7X5u7nwRFecrMqTMqOnZr7RClOVb7LNjbzY9To6V3PBiRReKPJ9bjA2Xipina42wkjmB0Ws05UFh8KPloUflaOz0WnDLtEt4ZfSTQFgZIARwMAAA4DGAA2oDFGxMcSGhSEWKEMoCkMUMAgaQ7SwNQoLxZ2jlSFWJIZIUQ9t5M/IzAAzAGEAAYCFbgt+rXRbsct0yvgzByz1ThpdGg4TXSaY7Fwhs3q3zKjzf9+kxodawsnkXWmj7i/mOkxN8KbygYqOjbdt6Bp404A+KbylCC5Idne+XyX6Vwd/yTrXJXfHSu6OlZwdI8WxXyei/Eh7nQdnfMANc+OFNuOWsbCrjLhJXhe38/tqvnpf4P1QL8FTSWk0waOqvSXxqgM5VEQQwb/2A80o0l7lU88FAAAAAElFTkSuQmCC",
			"1f44d": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAMAAABiM0N1AAAAk1BMVEVHcEz/217/217/217/217/217/217/217/217/217/217/217ulUf/217/217ulUfulUf/217ulUf/217ulUf3uFP4v1X7zFnwnEnzqU78zVnulUfvm0nwn0rulUfulUf/217ulUf7ylj3uFP0r1Dzq07+1138zlr5wVXwnkrvmUjxokvyp036xVf1tFH4vFT90lstgPVGAAAAIHRSTlMAcGDfIBCfQL+Az6/v7zAQMFDfj4CAUN+fcO9Qv99gcEnxpdkAAAIGSURBVHherZbZkpswEEUFFiC8zTj7nsu6eJ3//7oA5VQUpLbVJZ1HHk5JfbtbCIokzlUaSeFLssNM7iuKcCf1FCn8JQ8lggwl2oQSQYYSRaFEKpQIwUSJh2gNjcxDBJ29x6ghUI0yaOz8Z9Y//hQa7z1EK4TpbIlA6cehQttAYxWqi1Sg8LEJlBnWXm2to/I7cTYj+SuERqk8etYWBzijIvnwjeWQSsqzBo9dbC/0ChRlPRQ6V9yxmGQKkrpYUhLDmMRrcDxFpw2RcRiKyyw461TW/RDjMadR07RkdEYzk4yeY0snZzxjFOUoqkFj7A2KbroZVb6qhPPNMKdEHvYzISLSP/alSXUcRR/dRW/Hgmb74i5C/8DzKoKITt8kQ9TOV2sqkwugGKLbqBneQCDdRc0ouoAidhedRxFIcp7IfrOuqdvIXVRNpaZSaPaMhpzXkdnatynNn5w+uhY03zkinEjPb0GIeMM2fBWUiF7+dbXk1kGxRO3k6WFFEiL2rj1wRRXd1/4n6s9Nd+DXyP4oSP/U5o8/RJg+2r7yROjspu0vwRS1VlH9Sejs4Vika/k/7fJ3Hs+ZDlRa+1pnA/7rb/4b8VubFonIZUUO5gI+dguRyNIVHjKYQ9JP102ESZY+Wf/FcNaYd+YXYWW/Zu7a7Yuwk9D5tRbTO30+3IvVnxaaD//O8wc9hoFwgKeolwAAAABJRU5ErkJggg==",
			"1f514": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAMAAABiM0N1AAAAM1BMVEVHcEz/rDP/rDP/rDP/rDP/rDP/rDP/rDP/rDP/rDP/rDP/rDP/rDP/rDP/rDP/rDP/rDPIzIGKAAAAEXRSTlMAIJ/v/zAQQK+/j89ggHDfUC2EKUAAAAEoSURBVHgB7dgFcugwDARQJ1qzA/e/7IcyryyV23cAGUbaZByYZRVA1iU4RcEFicFlEVwR355W3FiDh+CGBIeEO1xXjTvsl5QL7inZVqbikTpfKjU8qaXJOh3P6MnSz/fN93gSvECS/VzG0zUQLahkULouqKCqfUOGLRUolEAtILQTPKAy1JlI8LzsUOmBgdLnK5TUKU1EdV8T+ecWGiC0M7JBaaOjprTq4tEfklBTNba/tXeo7ZrAdsd2woTE29HfkgcmHGxD/i2lA1OOxOfMNW8R0yI5mO9wFQaVX5D1miKMMv/km34CTpidPGEtmSswE5Kwep+80AGzgyeRKZV2gYns4VX8wgMfX6iSXFUb5IOo13FH97+Mwf82tvSb/ZA61KgAUOn9/AVW2in/wdtp3QAAAABJRU5ErkJggg==",
			"1f3ac": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAMAAABiM0N1AAAArlBMVEVHcEw/cSM/cSM/cSM/cSMpLzMpLzMpLzPM1t3M1t0/cSM/cSPM1t0/cSMpLzPM1t3M1t0/cSM/cSM/cSMpLzMpLzMpLzPM1t3M1t0pLzPM1t3M1t0/cSNES08/cSMpLzMpLzPM1t3M1t0/cSM9REhSWV7M1t0pLzNfZ2xqcnc/cSMpLzPM1t0zOT6tt73CzNKPl51mbnM9REh7g4hSWV6ZoqijrLO4wchITlOFjZPVvWfCAAAAKnRSTlMAgEBQv0C/gL+AEI/P748Q75+vcM8QUEAw769w379gr3BQjyCAgJ8wMJ/qDCaiAAABkElEQVR42u3UW0/CQBQE4AUFWgQKKqKgYuvdXVquXv7/H5Mim9mUbs7S0xeTzutpvpAZWsHL9WTcj0QJiNqmw0EavtdXOkFRpNWUcq6QsCiSxpSioogpHVvSyPe+YWSlwBlJn05mVil0Q3TiA2njVlLjCUi+NIt1SUSxC+UoBdQ6P45SaEPQp5sUZYtNLBsjc5knvWgjCPfrFJDu/DDYI1EHzyXLY6RmqyF03g9boCUgSM95Y0hAjFzJIyXPH4m8DKVc0ZIdQS6d/i12BCXl9PmZgZrPdgQlERujWCJDy8bOCErKl9wRlLRLTE1Ml4RlCIQsSUv98YRC6JJupg9vgpneFnkVJaQl02Q/0WuJ0DfPgGaJ9QNG3wDh3T38wNE3E1oqMyuJULcMtFFGvvD+u90ArZWZhUScboBi22eEvgFiTg+IOT0g5vSAmNMDYk4PiDk9IN70gGof/JxWUAVVUAVV0P+C6iVA5ynULgG6EGkGfKi9gx67XKcm/nLPdAZC54T1m84E0q7dFlS6g3oK/AJJbHdxh9vlLAAAAABJRU5ErkJggg=="
		};


	/*
	 * Every sticker carries a fire as
	 * its first icon and a heart as
	 * its last icon.
	 */
	const STICKER_FIRE =
		"\u{1F525}";


	const STICKER_HEART =
		"\u2764\uFE0F";


	/*
	 * The sticker's icon string: fire
	 * first, the preset's own emoji in
	 * the middle, heart at the end.
	 * Presets that already start with
	 * a fire or end with a heart are
	 * not doubled.
	 */
	function stickerEmojiString(
		sticker
	) {

		let mid =
			sticker.emoji;


		if (
			mid.indexOf(
				STICKER_FIRE
			) === 0
		) {

			mid =
				mid.slice(
					STICKER_FIRE.length
				);

		}


		let icons =
			STICKER_FIRE +
				mid;


		if (
			sticker.emoji.indexOf(
				STICKER_HEART
			) !==
				sticker.emoji.length -
					STICKER_HEART.length
		) {

			icons =
				icons +
				STICKER_HEART;

		}


		return icons;

	}


	/*
	 * The five sticker presets.
	 *
	 * Each one is an emoji plus a short
	 * label drawn on a white sticker.
	 */

	const STICKER_PRESETS = {

		none:
			null,

		like: {
			emoji:
				"\u{1F44D}",
			text:
				"Like"
		},

		love: {
			emoji:
				"\u{2764}\u{FE0F}",
			text:
				"Love it"
		},

		subscribe: {
			emoji:
				"\u{1F514}",
			text:
				"Subscribe"
		},

		"like-subscribe": {
			emoji:
				"\u{1F44D}\u{1F514}",
			text:
				"Like & Subscribe"
		},

		watch: {
			emoji:
				"\u{1F525}",
			text:
				"Watch Video"
		},

		"watch-like-subscribe": {
			emoji:
				"\u{1F525}\u{1F44D}\u{1F514}",
			text:
				"Watch, Like & Subscribe"
		}

	};


	function getSticker() {

		return (
			STICKER_PRESETS[
				stickerSelectEl.value
			] ||
			null
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
	 * Subtitles (SRT script) are
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
	 * Draws the active SRT subtitle
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
	
	
	function slideDurationSec(
		slide
	) {
	
	
		if (
			slide._partialSec !=
				null
		) {
	
	
			return slide._partialSec;
	
	
		}
	
	
		return slide.type ===
			"mp4"
		&& slide.duration >
			0
		? slide.duration
		: SLIDE_SECONDS_MIN;
	
	
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
		 * Waits for the next presented
		 * frame of a playing clip so
		 * the export stays in real time.
	 */
	
	
	async function nextClipFrame(
		video
	) {
	
	
		if (
			typeof video.requestVideoFrameCallback ===
				"function"
		) {
	
	
			await new Promise(
				(resolve) => {
					video.requestVideoFrameCallback(
						resolve
					);
				}
			);
	
	
			return;
	
	
		}
	
	
			await new Promise(
				(resolve) =>
				setTimeout(
					resolve,
					34
				)
			);
	
	
	}
	
	
	/*
		 * Restarts a clip silently for
		 * frame capture.
	 */
	
	
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
	
	
			await video.play();
	
	
		}
	
	
		catch (playError) {
	
	
			console.error(
				"Clip play failed:",
				playError
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

					URL.revokeObjectURL(
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
						URL.createObjectURL(
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

			URL.revokeObjectURL(
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
						AI Generated
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
				URL.createObjectURL(
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


	/*
	 * Start AI image generation.
	 */

	prompts.forEach(
		(_, index) => {

			fetchAIImage(index);

		}
	);


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
							URL.createObjectURL(
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


								URL.revokeObjectURL(
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

				URL.revokeObjectURL(
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


		audioEncoder.configure({

			codec:
				"mp4a.40.2",

			sampleRate:
				sampleRate,

			numberOfChannels:
				numberOfChannels,

			bitrate:
				bitrate

		});


		let offset =
			0;


		let timestamp =
			0;


		try {

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

				while (
					audioEncoder.encodeQueueSize >
					40
				) {

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


			await audioEncoder.flush();


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
	// STICKER OVERLAY
	// =========================================================

	/*
	 * Emoji artwork.
	 *
	 * Some systems have no colour emoji
	 * font that canvas can use, which is
	 * why the emoji showed in the page but
	 * not in the video.
	 *
	 * The artwork is fetched as PNGs when
	 * possible. If that fails the code
	 * falls back to the system emoji font.
	 */

	let stickerEmojiImages =
		null;


	/*
	 * Turns the emoji into the code points
	 * used by the image file names.
	 *
	 * FE0F is the variation selector and
	 * is not part of the file name.
	 */

	function emojiCodePoints(emoji) {

		const points =
			[];


		for (
			const character of emoji
		) {

			const point =
				character.codePointAt(
					0
				);


			if (
				point !== 0xfe0f
			) {

				points.push(
					point.toString(
						16
					)
				);

			}

		}


		return points;

	}


	function loadImage(src, timeoutMs) {

		return new Promise(
			(resolve, reject) => {

				const image =
					new Image();


				/*
				 * crossOrigin is required so the
				 * canvas is not tainted, which
				 * would make VideoFrame refuse
				 * the frame.
				 */

				image.crossOrigin =
					"anonymous";


				const timer =
					setTimeout(
						() => {

							reject(
								new Error(
									"Image timed out"
								)
							);

						},
						timeoutMs
					);


				image.onload =
					() => {

						clearTimeout(
							timer
						);

						resolve(
							image
						);

					};


				image.onerror =
					() => {

						clearTimeout(
							timer
						);

						reject(
							new Error(
								"Image failed"
							)
						);

					};


				image.src =
					src;

			}
		);

	}


	async function loadStickerAssets() {

		stickerEmojiImages =
			null;


		const sticker =
			getSticker();


		if (!sticker) {
			return;
		}


		const points =
			emojiCodePoints(
				stickerEmojiString(
					sticker
				)
			);


		if (!points.length) {
			return;
		}


		try {

			const images =
				await Promise.all(
					points.map(
						(point) =>
							loadImage(
								STICKER_EMOJI_DATA[point] ||
								("https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/72x72/" +
									point +
									".png"),
								8000
							)
					)
				);


			/*
			 * Drawing a cross-origin image
			 * that did not send CORS headers
			 * taints the canvas and
			 * VideoFrame would then throw.
			 *
			 * This test fails loudly so the
			 * fallback is used instead.
			 */

			for (
				const image of images
			) {

				const probe =
					document.createElement(
						"canvas"
					);


				probe.width =
					1;

				probe.height =
					1;


				const probeCtx =
					probe.getContext(
						"2d"
					);


				probeCtx.drawImage(
					image,
					0,
					0,
					1,
					1
				);


				probeCtx.getImageData(
					0,
					0,
					1,
					1
				);

			}


			stickerEmojiImages =
				images;

		}
		catch (error) {

			console.warn(
				"Emoji images unavailable, using the system emoji font.",
				error
			);


			stickerEmojiImages =
				null;

		}

	}


	/*
	 * Width the emoji takes up, either as
	 * images or as text.
	 */

	function measureEmoji(
		context,
		emojiSize,
		sticker
	) {


		const iconString =
			stickerEmojiString(
				sticker
			);



		const pointCount =
			emojiCodePoints(
				iconString
			).length;



		if (!pointCount) {



			return 0;


		}



		if (stickerEmojiImages) {



			return (
				emojiSize * pointCount
			) +
			STICKER_ICON_GAP *
				(pointCount - 1);


		}



		context.font =
			emojiSize +
			"px " +
			STICKER_EMOJI_FONT;



		let width =
			0;



		for (
			const point of
				emojiCodePoints(
					iconString
				)
			) {


			width +=
				context.measureText(
					String.fromCodePoint(
						Number(
							"0x" + point
						)
					)
				).width +
				STICKER_ICON_GAP;


		}



		return width - STICKER_ICON_GAP;


	}


	/*
	 * Rectangle path.
	 *
	 * roundRect() is used when available,
	 * with a manual fallback for older
	 * browsers. Radius is 0 for the
	 * sticker, so this is a plain
	 * rectangle.
	 */

	function stickerPath(
		context,
		x,
		y,
		width,
		height,
		radius
	) {

		context.beginPath();


		if (
			context.roundRect &&
			radius > 0
		) {

			context.roundRect(
				x,
				y,
				width,
				height,
				radius
			);


			return;

		}


		context.rect(
			x,
			y,
			width,
			height
		);


		context.closePath();

	}


	/*
	 * Draws the white rectangle in the
	 * bottom right corner to cover a
	 * watermark.
	 *
	 * Fixed size, square corners, flush
	 * with the bottom and hanging past
	 * the right edge.
	 */

	/*
	 * Works out how to draw the sticker
	 * label.
	 *
	 * One line when it fits, otherwise two
	 * evenly balanced lines, so the text
	 * stays readable inside a small box.
	 */

	function layoutLabel(

		context,

		text,

		stack,

		maxWidth,

		maxHeight,

		startSize

	) {

		context.font =
			"bold " +
			startSize +
			"px " +
			stack;


		const singleWidth =
			context.measureText(
				text
			).width;


		if (
			singleWidth <=
				maxWidth ||
			maxWidth <= 0
		) {

			return {

				lines:
					[text],

				size:
					startSize,

				lineHeight:
					startSize *
					1.2

			};

		}


		const words =
			text.split(
				" "
			);


		let best =
			null;


		for (
			let i = 1;
			i < words.length;
			i++
		) {

			const first =
				words
					.slice(0, i)
					.join(" ");


			const second =
				words
					.slice(i)
					.join(" ");


			const difference =
				Math.abs(
					first.length -
						second.length
				);


			if (
				!best ||
				difference <
					best.difference
			) {

				best = {

					lines:
						[
							first,
							second
						],

					difference:
						difference

				};

			}

		}


		/*
		 * A single word cannot be split, so
		 * it is simply scaled down.
		 */

		if (!best) {

			const size =
				startSize *
				(maxWidth /
					singleWidth);


			return {

				lines:
					[text],

				size:
					size,

				lineHeight:
					size *
					1.2

			};

		}


		context.font =
			"bold " +
			startSize +
			"px " +
			stack;


		const widest =
			Math.max(
				context.measureText(
					best.lines[0]
				).width,
				context.measureText(
					best.lines[1]
				).width
			);


		/*
		 * Fit the width first, then make
		 * sure both lines still fit the
		 * height of the box.
		 */

		let size =
			startSize *
			(maxWidth /
				widest);


		size =
			Math.min(
				size,
				maxHeight /
					2 /
					1.2
			);


		return {

			lines:
				best.lines,

			size:
				size,

			lineHeight:
				size *
				1.2

		};

	}


	function drawSticker(
		context,
		width,
		height
	) {

		const sticker =
			getSticker();


		if (!sticker) {
			return;
		}


		context.save();


		const boxWidth =
			STICKER_WIDTH;


		/*
		 * The box is always exactly one
		 * fifth of the video height (min
		 * and max are the same), so it
		 * keeps the same share of the
		 * frame at every quality.
		 */
		const boxHeight =
			Math.round(
				height / 5
			);


		/*
		 * Flush to the bottom, and pushed
		 * STICKER_EXCEED_RIGHT pixels past
		 * the right edge so the corner is
		 * fully covered.
		 */

		const x =
			width -
			boxWidth +
			STICKER_EXCEED_RIGHT;


		const y =
			height -
			STICKER_BOTTOM_GAP -
			boxHeight;


		// =================================================
		// WHITE RECTANGLE
		// =================================================

		context.fillStyle =
			"#ffffff";


		stickerPath(
			context,
			x,
			y,
			boxWidth,
			boxHeight,
			STICKER_RADIUS
		);


		context.fill();


		// =================================================
		// FIT THE CONTENT INSIDE
		// =================================================

		/*
		 * Only the part of the rectangle
		 * that is on screen can hold the
		 * emoji and the text.
		 */

		const visibleWidth =
			boxWidth -
			STICKER_EXCEED_RIGHT;


		let padding =
			STICKER_PADDING;


		let gap =
			STICKER_GAP;


		let emojiSize =
			STICKER_EMOJI_SIZE;


		let textSize =
			STICKER_TEXT_SIZE;


		context.font =
			"bold " +
			textSize +
			"px " +
			getTitleFont().stack;


		let textWidth =
			context.measureText(
				sticker.text
			).width;


		let emojiWidth =
			measureEmoji(
				context,
				emojiSize,
				sticker
			);


		const maxContent =
			visibleWidth -
			padding *
				2;


		/*
		 * The icons keep their fixed size;
		 * the label wraps or shrinks instead
		 * of squeezing the icons.
		 */


		/*
		 * Everything left over is for the
		 * text.
		 */

		const textBudget =
			Math.max(
				0,
				maxContent -
					STICKER_EXCEED_RIGHT -
					emojiWidth -
					gap
			);


		const label =
			layoutLabel(
				context,
				sticker.text,
				getTitleFont().stack,
				textBudget,
				boxHeight -
					padding *
						2,
				textSize
			);



		/*
		 * The label font is clamped:
		 * never below 14px, never above
		 * 16px.
		 */


		label.size =
			Math.max(
				STICKER_TEXT_MIN,
				Math.min(
					STICKER_TEXT_MAX,
					label.size
				)
			);


		// =================================================
		// EMOJI AND TEXT
		// =================================================

		context.textAlign =
			"left";


		context.textBaseline =
			"middle";


		const middleY =
			y +
			boxHeight /
				2;


		let cursor =
			x +
			padding;


		if (stickerEmojiImages) {

			for (
				const image of stickerEmojiImages
			) {

				context.drawImage(
					image,
					cursor,
					middleY -
						emojiSize /
							2,
					emojiSize,
					emojiSize
				);


				cursor +=
					emojiSize +
						STICKER_ICON_GAP;

			}

		}
		else {

			context.font =
				emojiSize +
				"px " +
				STICKER_EMOJI_FONT;


			context.fillStyle =
				"#111111";



			let iconCursor =
				cursor;



			for (
				const point of
					emojiCodePoints(
						stickerEmojiString(
							sticker
						)
					)
			) {


				const icon =
					String.fromCodePoint(
						Number(
							"0x" + point
						)
					);



				context.fillText(
					icon,
					iconCursor,
					middleY
				);



				iconCursor +=
					context.measureText(
						icon
					).width +
					STICKER_ICON_GAP;


			}



			cursor =
				iconCursor;

		}


		cursor +=
			gap;


		context.fillStyle =
			"#111111";


		context.font =
			"bold " +
			label.size +
			"px " +
			getTitleFont().stack;


		/*
		 * The text lines are centred inside
		 * the room left by the icons: from
		 * just after the icons to the visible
		 * right edge of the box.
		 */
		context.textAlign =
			"center";

		const textLeft =
			cursor;

		const textRight =
			x +
			boxWidth -
				STICKER_EXCEED_RIGHT -
				padding;

		const textCenter =
			(textLeft +
				textRight) /
				2;

		const startY =
			middleY -
			(label.lines.length -
				1) *
				label.lineHeight /
				2;


		label.lines.forEach(
			(line, index) => {

				context.fillText(
					line,
					textCenter,
					startY +
						index *
							label.lineHeight
				);

			}
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
	 *                              mode for /config/uvxyz)
	 *   MODULE 8: script-srt      (AI script generation -> SRT with
	 *                              timestamps; INSTRUCT model;
	 *                              minutes 1-6 + speech speed; the
	 *                              gallery + SRT box are scroll areas
	 *                              with wide arrow toggle buttons)
	 *
	 * Each module only talks to the others through the
	 * videoProjects array and the small shared functions, so a
	 * module can be moved to its own file without touching the
	 * rest.
	 *
	 * The old single-video panels (title, MP3, captions,
	 * sticker, quality, main gallery) stay in the DOM but are
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
	 * accordion to the stack (max 7).
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
			? "block"
			: "none";

		if (arrow) {
			arrow.textContent =
				body.style.display ===
					"none"
				? "\u25b6"
				: "\u25bc";
		}

	}

	function clickVaFiles(n) {

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
	const STICKER_OPTIONS =
		'<option value="none" selected>None</option>' +
		'<option value="like">\ud83d\udc4d Like</option>' +
		'<option value="love">\u2764\ufe0f Love it</option>' +
		'<option value="subscribe">\ud83d\udd14 Subscribe</option>' +
		'<option value="like-subscribe">\ud83d\udc4d\ud83d\udd14 Like &amp; Subscribe</option>' +
		'<option value="watch">\ud83c\udfac Watch Video</option>' +
		'<option value="watch-like-subscribe">\ud83c\udfac\ud83d\udc4d\ud83d\udd14 Watch, Like &amp; Subscribe</option>';

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
			'<button type="button" class="va-api-btn" onclick="apiRenderVideo(' + n + ')" title="Send all of this video\\'s elements to the render API">\u2601\ufe0f API</button>' +
			'<span class="va-summary" id="va-summary-' + n + '"></span>' +
			'<button type="button" class="va-arrow" id="va-arrow-' + n + '" onclick="toggleVideoAccordion(' + n + ')" title="Collapse / expand">\u25bc</button>' +
			'</div>' +
			'<div class="va-body" id="va-body-' + n + '">' +
			'<div class="va-left">' +
			'<div class="va-section">' +
		'<div class="va-section-title">Images / MP4s \u2014 drag cards to reorder</div>' +
		'<button type="button" class="upload-btn" onclick="clickVaFiles(' + n + ')">\ud83d\udcc1 Upload Image, GIF or MP4</button>' +
		'<span class="va-note">Max 5 GIF \u00b7 25 images \u00b7 5 MP4 (1:00 each, silent)</span>' +
		'<a href="#" class="va-template-link" onclick="openTemplateModal(' + n + '); return false;" title="Compose a portrait or landscape MP4 (max 25 seconds) from a design template and add it to this video">Add video from template</a>' +
		'<button type="button" class="va-scroll-toggle" id="va-gallery-toggle-' + n + '" onclick="toggleGalleryScroll(' + n + ')" title="Show / hide the image gallery">\u25b2 Images / MP4s</button>' +
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
			'<div class="va-section-title">Captions (bottom)</div>' +
			'<div id="va-captions-' + n + '"></div>' +
			'<button type="button" class="upload-btn" onclick="addVaCaptionRow(' + n + ')">+ Add Caption</button>' +
			'</div>' +
			'<div class="va-section">' +
			'<div class="va-section-title">Sticker (bottom right)</div>' +
			'<select id="va-sticker-' + n + '" class="quality-select">' + STICKER_OPTIONS + '</select>' +
			'</div>' +
		'<div class="va-section">' +
		'<div class="va-section-title">Quality</div>' +
		'<select id="va-quality-' + n + '" class="quality-select">' + QUALITY_OPTIONS + '</select>' +
		'</div>' +
		'<div class="va-section">' +
		'<div class="va-section-title">Script (SRT) \u2014 AI model</div>' +
		'<input type="text" id="va-script-topic-' + n + '" maxlength="120" placeholder="Topic (uses the video title if empty)">' +
		'<div class="va-row">' +
		'<label class="quality-select">Minutes <select id="va-script-minutes-' + n + '"><option value="1" selected>1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></label>' +
		'<label class="quality-select">Speech <select id="va-script-speed-' + n + '"><option value="super fast">Super fast</option><option value="fast">Fast</option><option value="medium" selected>Medium</option><option value="slow">Slow</option></select></label>' +
		'</div>' +
		'<button type="button" class="upload-btn small" id="va-script-btn-' + n + '" onclick="generateScript(' + n + ')" style="margin-top:4px">\u2728 Generate Script</button>' +
		'<span class="va-note" id="va-script-status-' + n + '"></span>' +
		'<button type="button" class="va-scroll-toggle" id="va-script-toggle-' + n + '" onclick="toggleScriptBox(' + n + ')" style="display:none" title="Show / hide the script (SRT)">\u25bc Script (SRT)</button>' +
		'<div class="va-script-box" id="va-script-box-' + n + '" style="display:none"></div>' +
		'<div class="va-row va-script-actions">' +
		'<button type="button" class="upload-btn small" id="va-script-dl-' + n + '" onclick="downloadSrt(' + n + ')" style="display:none">\u2b07 Download .srt</button>' +
		'<button type="button" class="upload-btn small" id="va-voice-btn-' + n + '" onclick="openVoiceoverModal(' + n + ')" disabled title="Speak the script (SRT) to MP3 with MeloTTS (English) + apply it as subtitles">\ud83c\udf99 Generate Voiceover</button>' +
		'</div>' +
		'</div>' +
		'</div>' +
		'<div class="va-right">' +
			'<div class="va-section">' +
			'<div class="va-section-title">AI Images \u2014 Cloudflare</div>' +
			'<textarea class="va-ai-prompt" id="va-ai-prompt-' + n + '" rows="3" placeholder="Describe the image (always 480px landscape)"></textarea>' +
			'<button type="button" class="upload-btn small" id="va-ai-btn-' + n + '" onclick="submitAiImages(' + n + ')">\u2728 Generate 2 Images</button>' +
			'<span class="va-note" id="va-ai-status-' + n + '">2 images per submit \u00b7 480px landscape</span>' +
			'<div class="va-ai-results" id="va-ai-results-' + n + '"></div>' +
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
					URL.createObjectURL(
						file
					);

				const probed =
					document.createElement(
						"video"
					);

				probed.muted =
					true;

				probed.playsInline =
					true;

				probed.src =
					clipURL;

				try {

					await new Promise(
						(resolve, reject) => {

							probed.addEventListener(
								"loadedmetadata",
								resolve,
								{
									once: true
								}
							);

							probed.addEventListener(
								"error",
								reject,
								{
									once: true
								}
							);

						}
					);

				}
				catch (probeError) {

					URL.revokeObjectURL(
						clipURL
					);

					alert(
						"'" +
							file.name +
							"' could not be read as an MP4 clip."
					);

					continue;

				}

				const clipDuration =
					probed.duration;

				if (
					clipDuration >
						MP4_MAX_DURATION_S
				) {

					URL.revokeObjectURL(
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
					url:
						URL.createObjectURL(
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

			URL.revokeObjectURL(
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
				await context.decodeAudioData(
					arrayBuffer.slice(0)
				);

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

				await img.decode();

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

		return slides;

	}

	function swapVaCaptionsIn(
		n
	) {

		const slotRows =
			document.getElementById(
				"va-captions-" + n
			);

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
			sticker:
				document.getElementById(
					"sticker-select"
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
					"sticker-select"
				).value =
					document.getElementById(
						"va-sticker-" + n
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
			"sticker-select"
		).value =
			saved.sticker;

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

	const AI_IMAGES_PER_PROMPT =
		2;

	/*
	 * DISPLAY size of the generated
	 * images (card crop): 480px
	 * landscape, 16:9. The CF SDXL
	 * model itself generates at its
	 * default size because the API
	 * rejects custom width/height
	 * parameters.
	 */
	const AI_IMAGE_WIDTH =
		854;

	const AI_IMAGE_HEIGHT =
		480;

	/*
	 * The Cloudflare worker's
	 * /image/gen route (see the
	 * worker's fetch handler): same
	 * env.AI.run(MODEL, {prompt}) as
	 * the existing fetchAIImage(),
	 * but with the prompt taken from
	 * this accordion's form. Each
	 * submit = AI_IMAGES_PER_PROMPT
	 * requests (variant 1, 2) = 2
	 * images. Images are always 480px
	 * landscape (832x480, 16:9).
	 */
	const AI_ENDPOINT =
		(prompt, variant) =>
			"/image/gen?prompt=" +
				encodeURIComponent(
					prompt
				) +
				"&variant=" +
				variant;

	/*
	 * Submits the prompt from this
	 * accordion's right panel and
	 * accumulates the returned images
	 * in its results list.
	 */
	async function submitAiImages(
		n
	) {

		const promptEl =
			document.getElementById(
				"va-ai-prompt-" + n
			);

		const btn =
			document.getElementById(
				"va-ai-btn-" + n
			);

		const statusEl =
			document.getElementById(
				"va-ai-status-" + n
			);

		const resultsEl =
			document.getElementById(
				"va-ai-results-" + n
			);

		if (
			!promptEl ||
			!resultsEl
		) {
			return;
		}

		const prompt =
			promptEl.value.trim();

		if (!prompt) {
			alert(
				"Enter an image prompt first."
			);
			return;
		}

		/*
		 * Max 4 images in the results
		 * panel. If it already holds 4
		 * and the user generates again,
		 * clear it first, then show the
		 * new pair.
		 */
		if (resultsEl.children.length >= 4) {

			Array.from(
				resultsEl.children
			).forEach(
				(card) => {
					if (card._displayUrl) {
						URL.revokeObjectURL(
							card._displayUrl
						);
					}
				}
			);

			resultsEl.innerHTML =
				"";

		}

		if (btn) {
			btn.disabled =
				true;
		}

		if (statusEl) {
			statusEl.textContent =
				"Generating...";
		}

		let failures =
			0;

		let lastError =
			"";

		for (
			let variant = 1;
			variant <=
				AI_IMAGES_PER_PROMPT;
			variant++
		) {

			try {

				const response =
					await fetch(
						AI_ENDPOINT(
							prompt,
							variant
						)
					);

				if (
					!response.ok
				) {

					/*
					 * The worker returns
					 * {success:false,
					 * error:"..."} \u2014 show
					 * the real reason.
					 */
					let message =
						"Image generation failed";

					try {

						const errJson =
							await response.json();

						if (
							errJson &&
							errJson.error
						) {

							message =
								errJson.error;

						}

					}
					catch (jsonError) {

						/* keep default */

					}

					throw new Error(
						message
					);

				}

				const blob =
					await response.blob();

				addAiResultCard(
					n,
					prompt,
					variant,
					blob
				);

			}
			catch (aiError) {
				failures++;
				lastError =
					aiError instanceof Error
						? aiError.message
						: String(aiError);
				console.error(
					aiError
				);
			}

		}

		if (btn) {
			btn.disabled =
				false;
		}

		if (statusEl) {
			statusEl.textContent =
				failures
					? failures +
						" of " +
						AI_IMAGES_PER_PROMPT +
						" failed: " +
						lastError
					: "Done \u2014 480px landscape";
		}

		if (failures === AI_IMAGES_PER_PROMPT) {
			alert(
				"Image generation failed: " +
					lastError
			);
		}

	}

	/*
	 * One generated image card:
	 * 480px landscape preview, an
	 * "Add to Video" button (adds it
	 * to this accordion's gallery)
	 * and a fullscreen button.
	 */
	function addAiResultCard(
		n,
		prompt,
		variant,
		blob
	) {

		const resultsEl =
			document.getElementById(
				"va-ai-results-" + n
			);

		if (!resultsEl) {
			return;
		}

		const url =
			URL.createObjectURL(
				blob
			);

		const card =
			document.createElement(
				"div"
			);

		card.className =
			"va-ai-card";

		/*
		 * Remember the object URL so the
		 * results panel can revoke it
		 * when it clears itself.
		 */
		card._displayUrl =
			url;

		const img =
			new Image();

		img.className =
			"va-ai-img";

		img.src =
			url;

		img.alt =
			prompt;

		const name =
			"ai-video" +
			n +
			"-v" +
			variant +
			"-" +
			Date.now() +
			".png";

		const file =
			new File(
				[blob],
				name,
				{
					type:
						blob.type ||
						"image/png",
				}
			);

		const label =
			document.createElement(
				"div"
			);

		label.className =
			"va-ai-label";

		label.textContent =
			"Image " +
			variant +
			" of " +
			AI_IMAGES_PER_PROMPT;

		label.title =
			prompt;

		const row =
			document.createElement(
				"div"
			);

		row.className =
			"va-ai-actions";

		const addBtn =
			document.createElement(
				"button"
			);

		addBtn.type =
			"button";

		addBtn.className =
			"upload-btn small";

		addBtn.textContent =
			"+ Add to Video";

		addBtn.addEventListener(
			"click",
			() =>
				addAiToVideo(
					n,
					file,
					blob
				)
		);

		const fsBtn =
			document.createElement(
				"button"
			);

		fsBtn.type =
			"button";

		fsBtn.className =
			"upload-btn small";

		fsBtn.textContent =
			"Fullscreen";

		fsBtn.addEventListener(
			"click",
			() =>
				showAiFullscreen(
					url
				)
		);

		row.appendChild(
			addBtn
		);

		row.appendChild(
			fsBtn
		);

		card.appendChild(
			img
		);

		card.appendChild(
			label
		);

		card.appendChild(
			row
		);

		resultsEl.appendChild(
			card
		);

	}

	/*
	 * Adds a generated image to this
	 * accordion's own gallery (counts
	 * against the image cap).
	 */
	function addAiToVideo(
		n,
		file,
		blob
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		const counts =
			videoCounts(
				project
			);

		if (
			counts.stills >=
				MAX_IMAGE_UPLOADS
		) {

			alert(
				"Video " + n +
					": you can add at most " +
					MAX_IMAGE_UPLOADS +
					" images (jpg, png, jpeg)."
			);

			return;
		}

		const url =
			URL.createObjectURL(
				blob
			);

		const asset = {
			kind: "image",
			file: file,
			url: url,
			card: null,
		};

		project.assets.push(
			asset
		);

		buildVaCard(
			n,
			asset
		);

		updateVideoStatus(
			n
		);

	}

	/*
	 * Fullscreen preview overlay for
	 * a generated image.
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
	// (KV-backed login/signup, max 7 users)
	//
	// Flow on load:
	//   GET /api/session
	//     200 -> already signed in: show the
	//            footer (username + links +
	//            Logout (username))
	//     401 -> show the sign-in overlay
	//     503 -> KV not configured: open access
	//   POST /api/login    (username, password)
	//   POST /api/signup   (username, email,
	//                       password)
	//   POST /api/logout
	//
	// The overlay is built with DOM APIs (no HTML edit).
	// =========================================================

	const AUTH_MAX_USERS =
		7;

	const AUTH_CONTACT_EMAIL =
		"ytvibemotions.business@gmail.com";

	let authSubmitting =
		false;

	let authIsSignup =
		false;

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

		overlay.innerHTML =
			'<div class="auth-box">' +
			'<div class="auth-title">\ud83c\udfac YouTube Vibe Studio</div>' +
			'<div class="auth-sub">Sign in to use the studio (max ' + AUTH_MAX_USERS + ' user accounts)</div>' +
			'<div class="auth-error" id="auth-error"></div>' +
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

		submitBtn.addEventListener(
			"click",
			submitAuth
		);

		switchBtn.addEventListener(
			"click",
			() => {

				authIsSignup =
					!authIsSignup;

				document.getElementById(
					"auth-confirm-wrap"
				).style.display =
					authIsSignup
						? "block"
						: "none";

				document.getElementById(
					"auth-email-wrap"
				).style.display =
					authIsSignup
						? "block"
						: "none";

				submitBtn.textContent =
					authIsSignup
						? "Create account"
						: "Sign in";

				switchBtn.textContent =
					authIsSignup
						? "Have an account? Sign in"
						: "New here? Create an account";

				setAuthError(
					""
				);

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

	function showAuthOverlay() {

		const overlay =
			buildAuthOverlay();

		overlay.style.display =
			"flex";

	}

	function hideAuthOverlay() {

		const overlay =
			document.getElementById(
				"auth-overlay"
			);

		if (overlay) {
			overlay.style.display =
				"none";
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
			"#";

		accountLink.className =
			"auth-footer-link";

		accountLink.id =
			"account-link";

		accountLink.textContent =
			"Account";

		accountLink.addEventListener(
			"click",
			(e) => {

				e.preventDefault();

				toggleAccountBox(
					username,
					email ||
						""
				);

			}
		);

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

			box.appendChild(
				uLine
			);

			box.appendChild(
				eLine
			);

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

					hideAuthOverlay();

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

		showAuthOverlay();

	}

	// =========================================================
	// MODULE 7: api-render + background worker
	// (POST /api/render takes ALL of a video's elements and
	//  outputs the finished MP4; the background-worker mode
	//  at /config/uvxyz renders those jobs in this browser)
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
			URL.createObjectURL(
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
				URL.revokeObjectURL(
					url
				);
			},
			2000
		);

	}

	/*
	 * Collects ALL of video n's elements
	 * (assets, MP3, title, font, colour,
	 * sticker, quality, captions) for the
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
				sticker:
					document.getElementById(
						"va-sticker-" + n
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
			sticker:
				document.getElementById(
					"sticker-select"
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
				"sticker-select"
			).value =
				document.getElementById(
					"va-sticker-" + n
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
				"sticker-select"
			).value =
				saved.sticker;

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
	 * /config/uvxyz page in worker mode.
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
						URL.createObjectURL(
							file
						);

					const probed =
						document.createElement(
							"video"
						);

					probed.muted =
						true;

					probed.playsInline =
						true;

					probed.src =
						url;

					await new Promise(
						(resolve, reject) =>
						{
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

					probed.loop =
						true;

					asset.videoEl =
						probed;

					asset.duration =
						probed.duration;

					asset.url =
						url;

				}
				else {

					asset.url =
						URL.createObjectURL(
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
				"sticker-select"
			).value =
				p.sticker ||
				"none";

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
					URL.revokeObjectURL(
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
	 * are. The /config/uvxyz page skips the
	 * auth lock (it has its own password
	 * gate) and may run as a background
	 * worker.
	 */
	async function initAuth() {

		if (window.__CONFIG_PAGE) {
			return;
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

			if (
				response.status ===
					503
			) {

				/*
				 * KV not configured yet:
				 * open access (no lock).
				 */
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

				return;

			}

			/* 401: show sign-in */
			showAuthOverlay();

		}
		catch (netError) {

			/*
			 * Network error: do not lock
			 * the user out.
			 */

		}

	}

	// =========================================================
	// MODULE 8: script-srt
	// (AI script generation -> SRT with timestamps. The server
	//  route /api/script uses an INSTRUCT model on Workers AI,
	//  set in the SCRIPT_MODEL constant - the old free
	//  llama-3.1-8b-instruct was deprecated by Cloudflare on
	//  2026-05-30, so it is now the cheap llama-3.1-8b-instruct-
	//  fp8 instruct model. Minutes 1-6 + speech speed:
	//  super fast / fast / medium / slow.)
	// =========================================================

	function setScriptBoxState(
		n,
		open
	) {

		const box =
			document.getElementById(
				"va-script-box-" + n
			);

		const toggle =
			document.getElementById(
				"va-script-toggle-" + n
			);

		const dl =
			document.getElementById(
				"va-script-dl-" + n
			);

		if (box) {
			box.style.display =
				open ? "" : "none";
		}

		if (dl) {
			dl.style.display =
				open ? "" : "none";
		}

		if (toggle) {
			toggle.style.display =
				open ? "" : "none";

			toggle.textContent =
				(open
					? "\u25b2 "
					: "\u25bc ") +
				"Script (SRT)";
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

	async function generateScript(
		n
	) {

		const project =
			videoProjects[n - 1];

		if (!project) {
			return;
		}

		const btn =
			document.getElementById(
				"va-script-btn-" + n
			);

		const statusEl =
			document.getElementById(
				"va-script-status-" + n
			);

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

		if (!btn) {
			return;
		}

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

		btn.disabled = true;

		statusEl.textContent =
			"Writing your script (AI model)...";

		try {

			const response =
				await fetch(
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
									topic: topic,
									minutes: minutes,
									speed: speed
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

			if (
				!response.ok ||
				!data.success ||
				!data.srt
			) {

				throw new Error(
					(data && data.error) ||
					("HTTP " +
						response.status)
				);

			}

			project.srt = data.srt;

			const box =
				document.getElementById(
					"va-script-box-" + n
				);

			box.textContent = data.srt;

			const voiceBtn =
				document.getElementById(
					"va-voice-btn-" + n
				);

			if (voiceBtn) {
				voiceBtn.disabled = false;
			}

			showScriptBox(n);

			const lineCount =
				data.srt
					.split("\\n")
					.filter(
						(line) =>
							line.trim() !== ""
					)
					.length;

			statusEl.textContent =
				"Script ready \u2014 " +
				lineCount +
				" lines (" +
				speed +
				" speech, " +
				minutes +
				")";

		}
		catch (err) {

			statusEl.textContent =
				"Script failed: " +
				(err.message || err);

		}
		finally {

			btn.disabled = false;

		}

	}

	function downloadSrt(n) {

		const project =
			videoProjects[n - 1];

		if (
			!project ||
			!project.srt
		) {

			return;

		}

		const titleEl =
			document.getElementById(
				"va-title-" + n
			);

		const title =
			titleEl
				? titleEl.value.trim()
				: "";

		const fileName =
			"YouTubeVibeStudio_" +
			(title ||
				"Video" + n).replace(
					/[^A-Za-z0-9]+/g,
					""
				) +
			".srt";

		const blob =
			new Blob(
				[project.srt],
				{ type: "text/plain" }
			);

		const url =
			URL.createObjectURL(blob);

		const a =
			document.createElement("a");

		a.href = url;
		a.download = fileName;

		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);

		URL.revokeObjectURL(url);

	}

	// =========================================================
	// MODULE 9: voiceover + subtitles
	// (voice: MeloTTS via /api/voiceover -> MP3; the SRT
	//  script becomes spoken audio + burned-in subtitles
	//  drawn BELOW the caption, at 1/3 of the height up
	//  from the bottom)
	// =========================================================

	function srtTimeToMs(str) {

		const parts =
			String(str).trim().split(":");

		if (parts.length !== 3) {
			return 0;
		}

		const hours =
			Number(parts[0]) || 0;

		const minutes =
			Number(parts[1]) || 0;

		const secParts =
			parts[2].split(",");

		const seconds =
			Number(secParts[0]) || 0;

		const millis =
			Number(secParts[1] || 0) || 0;

		return (
			((hours * 60 + minutes) * 60 + seconds) *
			1000 +
			millis
		);

	}

	/*
	 * Parses SRT text into cues:
	 * [{startMs, endMs, text}]
	 */
	function parseSrtCues(srt) {

		const cues =
			[];

		const lines =
			String(srt).split(
				/\\r?\\n/
			);

		let current =
			null;

		for (
			let i = 0;
			i < lines.length;
			i++
		) {

			const line =
				lines[i].trim();

			if (!line) {
				continue;
			}

			if (/^\\d+$/.test(line)) {

				current = {
					startMs: 0,
					endMs: 0,
					text: ""
				};

				cues.push(current);

				continue;

			}

			if (
				line.indexOf(
					"-->"
				) !== -1
			) {

				if (!current) {

					current = {
						startMs: 0,
						endMs: 0,
						text: ""
					};

					cues.push(current);

				}

				const parts =
					line.split(
						"-->"
					);

				current.startMs =
					srtTimeToMs(
						parts[0]
					);

				current.endMs =
					srtTimeToMs(
						parts[1]
					);

				continue;

			}

			if (current) {

				current.text =
					current.text
						? current.text +
							" " +
							line
						: line;

			}

		}

		return cues.filter(
			(cue) =>
				cue.text &&
				cue.endMs >
					cue.startMs
		);

	}

	/*
	 * The spoken script: the SRT with cue
	 * numbers + timestamps removed (only
	 * the words are spoken).
	 */
	function spokenScriptFromSrt(srt) {

		const words =
			[];

		const lines =
			String(srt).split(
				/\\r?\\n/
			);

		for (
			let i = 0;
			i < lines.length;
			i++
		) {

			const line =
				lines[i].trim();

			if (!line) {
				continue;
			}

			if (/^\\d+$/.test(line)) {
				continue;
			}

			if (
				line.indexOf(
					"-->"
				) !== -1
			) {

				continue;

			}

			words.push(line);

		}

		return words.join(" ");

	}

							function closeVoiceoverModal() {

		const modal =
			document.getElementById(
				"voiceover-modal"
			);

		if (modal) {
			modal.remove();
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
			* enables once the script
			* (SRT) box has text, so the
			* modal always has a script
			* to speak.
			*/

		if (!project.srt) {

			return;

		}

		closeVoiceoverModal();

		const modal =
			document.createElement(
				"div"
			);

		modal.id =
			"voiceover-modal";

		modal.className =
			"modal-overlay";

		modal.innerHTML =
			'<div class="modal-box">' +
			'<div class="modal-title">\ud83c\udf99 Voiceover (MP3) \u2014 Video ' + n + '</div>' +
			'<div class="va-note" style="margin-bottom:8px">MeloTTS (Cloudflare AI) speaks the script as an English MP3 (one fixed voice). The MP3 can be uploaded as this video\\'s audio track.</div>' +
			'<label class="quality-select voiceover-voice-label">Voice <select id="voiceover-voice" disabled title="Always English">' +
			'<option value="en" selected>English (en)</option>' +
			'</select></label>' +
			'<div class="voiceover-label">Script (spoken into the MP3)</div>' +
			'<textarea id="voiceover-text" class="voiceover-textarea" rows="8" readonly disabled></textarea>' +
			'<div class="voiceover-actions">' +
			'<button type="button" class="upload-btn small" id="voiceover-gen" onclick="generateVoiceover(' + n + ')">\ud83c\udfa7 Generate Voiceover (MP3)</button>' +
			'<button type="button" class="upload-btn small" id="voiceover-subtitles" onclick="toggleSubtitles(' + n + ')">' +
			(project.subtitles && project.subtitles.length
				? "\u2705 Subtitles ON \u2014 click to turn off"
				: "\ud83d\udcdd Apply Subtitles to Video") +
			'</button>' +
			'</div>' +
			'<span class="va-note" id="voiceover-status"></span>' +
			'<button type="button" class="upload-btn small" onclick="closeVoiceoverModal()">\u2715 Close</button>' +
			'</div>';

		document.body.appendChild(
			modal
		);

		const area =
			modal.querySelector(
				"#voiceover-text"
			);

		area.value =
			spokenScriptFromSrt(
				project.srt
			);

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
				"voiceover-gen"
			);

		const statusEl =
			document.getElementById(
				"voiceover-status"
			);

		const voiceSel =
			document.getElementById(
				"voiceover-voice"
			);

		genBtn.disabled = true;

		statusEl.textContent =
			"Preparing...";

		try {

			const text =
				spokenScriptFromSrt(
					project.srt
				);

			if (!text) {

				throw new Error(
					"No script text to speak"
				);

			}

			statusEl.textContent =
				"Speaking your script (MeloTTS)...";

			const response =
				await fetch(
					"/api/voiceover",
					{
						method: "POST",
						headers: {
							"Content-Type":
								"application/json"
						},
						body:
							JSON.stringify(
								{
									text: text,
									lang:
										voiceSel
											? voiceSel.value
											: "en"
								}
							)
					}
				);

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
				URL.createObjectURL(
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

			URL.revokeObjectURL(
				url
			);

			project.voiceoverFile =
				blob;

			statusEl.textContent =
				"Voiceover MP3 saved \u2014 upload it as the audio track";

		}
		catch (err) {

			statusEl.textContent =
				"Voiceover failed: " +
				(err.message || err);

		}
		finally {

			genBtn.disabled = false;

		}

	}

	/*
	 * Toggle the SRT script as
	 * burned-in subtitles for this
	 * video: drawn below the
	 * caption, at 1/3 of the
	 * height up from the bottom,
	 * for every export. Click
	 * again to turn them off.
	 * The modal stays open.
	 */
	function toggleSubtitles(n) {

		const project =
			videoProjects[n - 1];

		if (
			!project ||
			!project.srt
		) {

			return;

		}

		const statusEl =
			document.getElementById(
				"voiceover-status"
			);

		const subBtn =
			document.getElementById(
				"voiceover-subtitles"
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
			parseSrtCues(
				project.srt
			);

		if (!cues.length) {

			if (statusEl) {

				statusEl.textContent =
					"No subtitle cues found in the script";

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
		 * Subtitles (the applied SRT
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
			quality.width;


		const HEIGHT =
			quality.height;


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
		 * The title font and the sticker
		 * artwork have to be ready before
		 * the first frame is drawn.
		 */

		await loadTitleFont();


		await loadCaptionFont();


		await loadStickerAssets();


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


		async function waitForEncoder() {

			while (
				videoEncoder.encodeQueueSize >
				MAX_ENCODE_QUEUE
			) {

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


				if (clipVideo) {


					await prepareClip(
						clipVideo
					);


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
					 * Keep the clip in real time.
					 */


					if (
						clipVideo &&
						f >
							0
					) {


						await nextClipFrame(
							clipVideo
						);


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
					 */

					const p =
						f /
						(
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


					ctx.drawImage(
						img,
						dx,
						dy,
						dw,
						dh
					);


					// =========================================
					// TITLE OVERLAY
					// =========================================

					drawTitle(
						ctx
					);


					// =========================================
					// STICKER OVERLAY
					// =========================================

					drawSticker(
						ctx,
						WIDTH,
						HEIGHT
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
					 * SRT subtitles: below the
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
								timestamp:
									timestamp
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


						resumeSlide.videoEl.play();


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


			await videoEncoder.flush();


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
					URL.createObjectURL(
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

						URL.revokeObjectURL(
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


			renderBtn.disabled =
				false;

		}

	}


`;
