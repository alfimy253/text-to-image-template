
const MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";

const prompts = [
	"Ghibli-inspired hand-painted anime scene of a young entrepreneur standing inside a tiny neighborhood shop before opening, warm morning sunlight entering through windows, shelves of products and simple checkout counter, gentle storytelling about what a business is, expressive character, hand-painted backgrounds, nostalgic cel animation texture, warm colors, no text, no logos, 16:9",

	"1990s nostalgic Studio Ghibli-inspired anime scene of a small business owner handing a product to a smiling customer across a wooden counter, another customer waiting behind, warm human interaction showing exchange and trust, detailed hand-painted shop interior, soft nostalgic lighting, expressive faces, no text, no logos, 16:9",
];

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

function json(data, status = 200) {

	return new Response(
		JSON.stringify(data),
		{
			status,

			headers: {
				"Content-Type":
					"application/json"
			}
		}
	);
}


// =============================================================
// FRONTEND
// =============================================================

function createHTML() {

	return `
<!DOCTYPE html>

<html lang="en">

<head>

	<meta charset="UTF-8">

	<meta
		name="viewport"
		content="width=device-width, initial-scale=1.0"
	>

	<title>
		AI Ghibli Video & MP4 Studio
	</title>


	<!-- Oswald comes from Google Fonts.
	     Bauhaus 93 and Bookman Old Style
	     are common system fonts. -->

	<link
		rel="preconnect"
		href="https://fonts.googleapis.com"
	>

	<link
		rel="preconnect"
		href="https://fonts.gstatic.com"
		crossorigin
	>

	<link
		href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&display=swap"
		rel="stylesheet"
	>


	<script src="https://unpkg.com/mp4-muxer@5.1.3/build/mp4-muxer.js"></script>


	<style>

		:root {
			--bg: #0f1115;
			--card: #181b20;
			--accent: #f59e0b;
			--text: #f3f4f6;
		}


		* {
			box-sizing: border-box;
			margin: 0;
			padding: 0;
		}


		body {

			background:
				var(--bg);

			color:
				var(--text);

			font-family:
				system-ui,
				-apple-system,
				sans-serif;

			padding:
				20px;
		}


		.header {

			text-align:
				center;

			margin-bottom:
				25px;
		}


		.header h1 {

			font-size:
				2rem;

			color:
				var(--accent);

			margin-bottom:
				8px;
		}


		.header p {

			color:
				#9ca3af;

			font-size:
				0.95rem;
		}


		.studio {

			max-width:
				900px;

			margin:
				0 auto 40px auto;

			background:
				var(--card);

			border:
				1px solid #2e3440;

			border-radius:
				12px;

			padding:
				20px;

			display:
				flex;

			flex-direction:
				column;

			align-items:
				center;
		}


		.canvas-container {

			width:
				100%;

			aspect-ratio:
				16 / 9;

			background:
				#000;

			border-radius:
				8px;

			overflow:
				hidden;

			position:
				relative;

			display:
				flex;

			align-items:
				center;

			justify-content:
				center;

			box-shadow:
				0 10px 30px
				rgba(0,0,0,0.5);
		}


		canvas {

			width:
				100%;

			height:
				100%;

			object-fit:
				contain;
		}


		.overlay-text {

			position:
				absolute;

			color:
				#6b7280;

			font-size:
				1.2rem;

			pointer-events:
				none;
		}


		/* =================================================
		   AUDIO PANEL
		   ================================================= */

		.audio-panel {

			width:
				100%;

			margin-top:
				18px;

			background:
				#14171c;

			border:
				1px solid #2e3440;

			border-radius:
				10px;

			padding:
				16px;

			display:
				flex;

			flex-direction:
				column;

			gap:
				12px;
		}


		.audio-title {

			font-size:
				0.78rem;

			letter-spacing:
				0.08em;

			text-transform:
				uppercase;

			color:
				#9ca3af;
		}


		.audio-row {

			display:
				flex;

			align-items:
				center;

			gap:
				12px;

			flex-wrap:
				wrap;
		}


		.audio-empty {

			font-size:
				0.85rem;

			color:
				#6b7280;
		}


		.audio-details {

			display:
				flex;

			flex-direction:
				column;

			gap:
				10px;
		}


		.audio-name {

			font-size:
				0.9rem;

			color:
				var(--text);

			word-break:
				break-all;
		}


		.audio-name span {

			color:
				#10b981;

			font-weight:
				bold;
		}


		.audio-panel audio {

			width:
				100%;

			height:
				38px;
		}


		.audio-actions {

			display:
				flex;

			justify-content:
				space-between;

			align-items:
				center;

			gap:
				12px;

			flex-wrap:
				wrap;
		}


		.audio-note {

			font-size:
				0.78rem;

			color:
				#6b7280;
		}


		.remove-audio-btn {

			background:
				#ef4444;

			color:
				#fff;

			border:
				none;

			padding:
				8px 14px;

			font-size:
				0.8rem;

			font-weight:
				bold;

			border-radius:
				8px;

			cursor:
				pointer;
		}


		.remove-audio-btn:hover {

			opacity:
				0.9;
		}


		.estimate {

			font-size:
				0.82rem;

			color:
				#9ca3af;

			border-top:
				1px dashed #2e3440;

			padding-top:
				10px;
		}


		.estimate b {

			color:
				var(--accent);
		}


		.quality-select {

			display:
				inline-flex;

			align-items:
				center;

			gap:
				8px;

			font-size:
				0.85rem;

			color:
				#9ca3af;
		}


		.quality-select select {

			background:
				#0f1115;

			color:
				var(--text);

			border:
				1px solid #374151;

			border-radius:
				8px;

			padding:
				10px 12px;

			font-size:
				0.85rem;

			cursor:
				pointer;
		}


		.title-row {

			display:
				flex;

			gap:
				10px;

			flex-wrap:
				wrap;
		}


		.title-row input[type="text"] {

			flex:
				1 1 260px;

			background:
				#0f1115;

			color:
				var(--text);

			border:
				1px solid #374151;

			border-radius:
				8px;

			padding:
				10px 12px;

			font-size:
				0.9rem;

			outline:
				none;
		}


		.title-row input[type="text"]:focus {

			border-color:
				var(--accent);
		}


		.controls {

			display:
				flex;

			gap:
				15px;

			margin-top:
				20px;

			width:
				100%;

			justify-content:
				center;

			flex-wrap:
				wrap;
		}


		button,
		.upload-btn {

			background:
				var(--accent);

			color:
				#000;

			border:
				none;

			padding:
				12px 24px;

			font-size:
				1rem;

			font-weight:
				bold;

			border-radius:
				8px;

			cursor:
				pointer;

			transition:
				transform 0.1s,
				opacity 0.2s;

			display:
				inline-flex;

			align-items:
				center;

			gap:
				8px;
		}


		button:hover,
		.upload-btn:hover {

			opacity:
				0.9;

			transform:
				translateY(-1px);
		}


		button:disabled {

			background:
				#374151;

			color:
				#9ca3af;

			cursor:
				not-allowed;

			transform:
				none;
		}


		.upload-btn {

			background:
				#2563eb;

			color:
				white;
		}


		.upload-btn.audio {

			background:
				#7c3aed;
		}


		input[type="file"] {
			display: none;
		}


		.progress-bar-container {

			width:
				100%;

			background:
				#2e3440;

			height:
				10px;

			border-radius:
				5px;

			margin-top:
				15px;

			overflow:
				hidden;

			display:
				none;
		}


		.progress-bar {

			width:
				0%;

			height:
				100%;

			background:
				#10b981;

			transition:
				width 0.1s;
		}


		.status-text {

			margin-top:
				8px;

			font-size:
				0.85rem;

			color:
				#10b981;

			display:
				none;
		}


		h2 {

			margin-bottom:
				15px;

			border-bottom:
				1px solid #2e3440;

			padding-bottom:
				10px;
		}


		.gallery {

			display:
				grid;

			grid-template-columns:
				repeat(
					auto-fill,
					minmax(280px, 1fr)
				);

			gap:
				16px;
		}


		.card {

			background:
				var(--card);

			border:
				2px solid transparent;

			border-radius:
				10px;

			padding:
				10px;

			transition:
				border-color 0.2s;

			position:
				relative;
		}


		.card.in-video {

			border-color:
				var(--accent);
		}


		.badge {

			position:
				absolute;

			top:
				18px;

			right:
				18px;

			background:
				var(--accent);

			color:
				#000;

			font-size:
				0.75rem;

			font-weight:
				bold;

			padding:
				3px 8px;

			border-radius:
				12px;

			z-index:
				10;
		}


		.image-container {

			width:
				100%;

			aspect-ratio:
				16 / 9;

			background:
				#0f1115;

			border-radius:
				6px;

			display:
				flex;

			align-items:
				center;

			justify-content:
				center;

			overflow:
				hidden;
		}


		.image-container img {

			width:
				100%;

			height:
				100%;

			object-fit:
				cover;
		}


		.loading {

			color:
				#6b7280;

			font-size:
				0.85rem;

			display:
				flex;

			flex-direction:
				column;

			align-items:
				center;

			gap:
				8px;
		}


		.spinner {

			width:
				20px;

			height:
				20px;

			border:
				2px solid #374151;

			border-top-color:
				var(--accent);

			border-radius:
				50%;

			animation:
				spin 1s linear infinite;
		}


		@keyframes spin {

			to {
				transform:
					rotate(360deg);
			}

		}


		.prompt {

			margin-top:
				8px;

			font-size:
				0.8rem;

			color:
				#9ca3af;

			line-height:
				1.4;

			display:
				-webkit-box;

			-webkit-line-clamp:
				2;

			-webkit-box-orient:
				vertical;

			overflow:
				hidden;
		}


		.card-actions {

			margin-top:
				10px;

			display:
				flex;

			justify-content:
				space-between;

			align-items:
				center;
		}


		.toggle-btn {

			background:
				#374151;

			color:
				white;

			padding:
				6px 12px;

			font-size:
				0.8rem;
		}


		.card.in-video
		.toggle-btn {

			background:
				#ef4444;
		}

	
		/* =================================================
		   TIMESTAMP CAPTIONS (MAX 10)
		   ================================================= */

		.caption-head {

			display:
				flex;

			align-items:
				center;

			gap:
				12px;

			flex-wrap:
				wrap;
		}


		.add-caption-btn {

			background:
				var(--accent);

			color:
				#000;

			border:
				none;

			padding:
				9px 16px;

			font-size:
				0.85rem;

			font-weight:
				bold;

			border-radius:
				8px;

			cursor:
				pointer;

			display:
				inline-flex;

			align-items:
				center;

			gap:
				6px;
		}


		.add-caption-btn:hover {

			opacity:
				0.9;
		}


		.add-caption-btn:disabled {

			background:
				#374151;

			color:
				#9ca3af;

			cursor:
				not-allowed;
		}


		.add-caption-btn .plus {

			font-size:
				1.1rem;

			line-height:
				1;
		}


		.caption-count {

			font-size:
				0.78rem;

			color:
				#6b7280;
		}


		#caption-rows {

			display:
				flex;

			flex-direction:
				column;

			gap:
				8px;
		}


		.caption-row {

			display:
				flex;

			align-items:
				center;

			gap:
				10px;

			background:
				#0f1115;

			border:
				1px solid #2e3440;

			border-radius:
				8px;

			padding:
				10px 12px;

			flex-wrap:
				wrap;
		}


		.caption-time {

			display:
				flex;

			align-items:
				center;

			gap:
				4px;

			color:
				#9ca3af;

			font-weight:
				bold;
		}


		.caption-time input {

			width:
				46px;

			background:
				#14171c;

			color:
				var(--text);

			border:
				1px solid #374151;

			border-radius:
				6px;

			padding:
				8px 6px;

			font-size:
				0.85rem;

			text-align:
				center;

			outline:
				none;
		}


		.caption-time input:focus {

			border-color:
				var(--accent);
		}


		.caption-text-wrap {

			flex:
				1 1 240px;

			display:
				flex;

			align-items:
				center;

			gap:
				8px;
		}


		.caption-text {

			flex:
				1;

			background:
				#14171c;

			color:
				var(--text);

			border:
				1px solid #374151;

			border-radius:
				6px;

			padding:
				9px 12px;

			font-size:
				0.88rem;

			outline:
				none;
		}


		.caption-text:focus {

			border-color:
				var(--accent);
		}


		.caption-chars {

			font-size:
				0.72rem;

			color:
				#6b7280;

			min-width:
				34px;

			text-align:
				right;
		}


		.caption-remove {

			background:
				#ef4444;

			color:
				#fff;

			border:
				none;

			width:
				30px;

			height:
				30px;

			border-radius:
				8px;

			font-size:
				1rem;

			font-weight:
				bold;

			cursor:
				pointer;

			line-height:
				1;
		}


		.caption-remove:hover {

			opacity:
				0.9;
		}


		.caption-sample {

			display:
				inline-block;

			background:
				#ffffff;

			color:
				#000000;

			font-family:
				'Bookman Old Style',
				'Bookman',
				'URW Bookman L',
				Georgia,
				serif;

			font-size:
				17px;

			padding:
				5px 12px;

			border-radius:
				6px;
		}

</style>

</head>


<body>


	<div class="header">

		<h1>
			馃幀 Cloudflare AI Video Studio
		</h1>

		<p>
			Generates AI scenes, adds your MP3
			soundtrack, and exports a cinematic MP4.
		</p>

	</div>


	<!-- ======================================================
	     VIDEO STUDIO
	     ====================================================== -->

	<div class="studio">

		<div class="canvas-container">

			<span
				class="overlay-text"
				id="canvas-placeholder"
			>
				Preview will render here
				during MP4 compilation...
			</span>


			<canvas
				id="video-canvas"
				width="1280"
				height="720"
			></canvas>

		</div>


		<!-- ======================================================
		     AUDIO TRACK (MP3)
		     ====================================================== -->

		<div class="audio-panel">

			<div class="audio-title">
				Audio Track 鈥� upload an MP3
				before rendering
			</div>


			<div class="audio-row">

				<label class="upload-btn audio">

					馃幍 Upload MP3 Audio

					<input
						type="file"
						id="audio-upload"
						accept=".mp3,audio/mpeg,audio/mp3,audio/*"
					>

				</label>


				<div
					class="audio-empty"
					id="audio-empty"
				>
					No audio added 鈥�
					the MP4 will be silent.
				</div>

			</div>


			<div
				class="audio-details"
				id="audio-details"
				style="display:none;"
			>

				<div
					class="audio-name"
					id="audio-name"
				></div>


				<audio
					id="audio-preview"
					controls
				></audio>


				<div class="audio-actions">

					<span class="audio-note">
						Slideshow timing will stretch
						to match this track.
					</span>


					<button
						type="button"
						class="remove-audio-btn"
						onclick="removeAudio()"
					>
						馃棏 Remove Audio
					</button>

				</div>

			</div>


			<div class="estimate">
				Estimated video length:
				<b id="estimate-value">
					0s
				</b>
				<span
					id="estimate-source"
					style="color:#6b7280;"
				>
					(8s per image)
				</span>

				<span
					id="estimate-size"
					style="color:#6b7280;"
				></span>
			</div>

		</div>


		<!-- ======================================================
		     TITLE OVERLAY
		     ====================================================== -->

		<div class="audio-panel">

			<div class="audio-title">
				Video Title (top left)
			</div>


			<div class="title-row">

				<input
					type="text"
					id="title-input"
					placeholder="Enter your video title..."
					maxlength="70"
				>

			</div>


			<div class="audio-row">

				<label class="quality-select">

					Font

					<select id="title-font">

						<option value="oswald">
							Oswald
						</option>

						<option value="bauhaus">
							Bauhaus
						</option>

						<option value="bookman">
							Bookman
						</option>

					</select>

				</label>


				<label class="quality-select">

					Colour

					<select id="title-color">

						<option value="white">
							White text
						</option>

						<option value="black">
							Black text
						</option>

						<option value="green">
							Green text
						</option>

					</select>

				</label>

			</div>


			<div class="audio-note">
				Drawn straight onto every
				frame 鈥� no background box
				and no highlight.
			</div>

		</div>




		<!-- ======================================================
		     STICKER OVERLAY
		     ====================================================== -->

		<div class="audio-panel">

			<div class="audio-title">
				Sticker (bottom right)
			</div>


			<div class="audio-row">

				<label class="quality-select">

					Sticker

					<select id="sticker-select">

						<option
							value="none"
							selected
						>
							None
						</option>

						<option value="like">
							馃憤 Like
						</option>

						<option value="love">
							鉂わ笍 Love it
						</option>

						<option value="subscribe">
							馃敂 Subscribe
						</option>

						<option
							value="like-subscribe"
						>
							馃憤馃敂 Like &amp; Subscribe
						</option>

						<option value="watch">
							馃幀 Watch Video
						</option>

						<option
							value="watch-like-subscribe"
						>
							馃幀馃憤馃敂 Watch, Like
							&amp; Subscribe
						</option>

					</select>

				</label>

			</div>


			<div class="audio-note">
				White 200 脳 80 rectangle, square
				corners, flush with the bottom
				right corner and hanging 40px
				past the right edge. Drawn on
				every frame to cover a
				watermark.
			</div>

		</div>



		<!-- ======================================================
		     TIMESTAMP CAPTIONS (MAX 10)
		     ====================================================== -->

		<div class="audio-panel">

			<div class="caption-head">

				<div class="audio-title" style="margin-bottom:0;">
					Timestamp Captions
				</div>

				<button
					type="button"
					class="add-caption-btn"
					id="add-caption-btn"
					onclick="addCaptionRow()"
				>
					<span class="plus">+</span> Add Caption
				</button>

				<span
					class="caption-count"
					id="caption-count"
				>
					0/10
				</span>

			</div>

			<div
				id="caption-rows"
			>
			</div>

			<div class="audio-note">
				Each caption appears centred horizontally at 4/7 of the
				height from the bottom, in 17px Bookman with black text on a
				white highlight (max 40 characters). It stays on screen until
				the next caption appears, or until the video ends.
			</div>

			<div
				class="audio-note"
				style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"
			>
				Preview:
				<span class="caption-sample">
					Sample caption text
				</span>
			</div>

		</div>

		<div
			class="progress-bar-container"
			id="progress-container"
		>

			<div
				class="progress-bar"
				id="progress-bar"
			></div>

		</div>


		<div
			class="status-text"
			id="status-text"
		>
			Compiling video...
		</div>


		<div class="controls">

			<label class="upload-btn">

				馃搧 Upload Image or GIF

				<input
					type="file"
					id="file-upload"
					accept="image/*,image/gif,.gif"
					multiple
				>

			</label>


			<label class="quality-select">

				Quality

				<select id="quality-select">

					<option value="low">
						480p 路 Light (1.2 Mbps)
					</option>

					<option
						value="balanced"
						selected
					>
						720p 路 Balanced (2.5 Mbps)
					</option>

					<option value="high">
						720p 路 High (5 Mbps)
					</option>

				</select>

			</label>


			<button
				id="render-btn"
				onclick="generateMP4()"
			>

				馃帪锔� Render & Download MP4 Video

			</button>

		</div>

	</div>


	<!-- ======================================================
	     STORYBOARD
	     ====================================================== -->

	<h2>

		Storyboard Queue
		(
		<span id="queue-count">
			0
		</span>
		images ready
		)

	</h2>


	<div
		id="gallery"
		class="gallery"
	></div>


<script>

	// =========================================================
	// DATA
	// =========================================================

	const prompts =
		${JSON.stringify(prompts)};


	const gallery =
		document.getElementById(
			"gallery"
		);


	const queueCountEl =
		document.getElementById(
			"queue-count"
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
		125;


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


	const STICKER_EMOJI_SIZE =
		33;


	const STICKER_TEXT_SIZE =
		18;


	/*
	 * Colour emoji need their own font
	 * stack, otherwise they can render as
	 * empty boxes.
	 */

	const STICKER_EMOJI_FONT =
		"'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Segoe UI Symbol', sans-serif";


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
				"\u{1F3AC}",
			text:
				"Watch Video"
		},

		"watch-like-subscribe": {
			emoji:
				"\u{1F3AC}\u{1F44D}\u{1F514}",
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


	const CAPTION_FONT_SIZE =
		17;


	const CAPTION_FONT_STACK =
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


		const radius =
			6;


		/*
		 * White highlight behind the text.
		 */

		context.fillStyle =
			"#ffffff";


		context.beginPath();


		if (context.roundRect) {

			context.roundRect(
				boxX,
				boxY,
				boxWidth,
				boxHeight,
				radius
			);

		}
		else {

			context.rect(
				boxX,
				boxY,
				boxWidth,
				boxHeight
			);

		}


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

	function getSlideSequence() {

		const secondsPerSlide =
			getSecondsPerSlide();


		if (
			!currentAudio ||
			activeSlides.length ===
				0
		) {

			return activeSlides.slice();

		}


		const slidesNeeded =
			Math.ceil(
				currentAudio.duration /
					secondsPerSlide
			);


		const sequence =
			activeSlides.slice();


		while (
			sequence.length <
			slidesNeeded
		) {

			for (
				const slide of activeSlides
			) {

				/*
				 * Added one slide at a time so
				 * the video only runs as long
				 * as it needs to, instead of
				 * always adding a whole extra
				 * round of images.
				 */

				if (
					sequence.length >=
					slidesNeeded
				) {

					break;

				}


				sequence.push(
					slide
				);

			}

		}


		return sequence;

	}


	function updateDurationEstimate() {

		const secondsPerSlide =
			getSecondsPerSlide();


		const totalSeconds =
			secondsPerSlide *
			getSlideSequence()
				.length;


		estimateValueEl.textContent =
			formatSeconds(
				totalSeconds
			) +
			" (" +
			totalSeconds.toFixed(1) +
			"s)";


		const sequence =
			getSlideSequence();


		if (
			currentAudio &&
			activeSlides.length > 0
		) {

			estimateSourceEl.textContent =
				"(" +
				secondsPerSlide +
				"s per image 鈥� images repeat " +
				sequence.length +
				"脳 to cover the audio)";

		}
		else {

			estimateSourceEl.textContent =
				"(" +
				secondsPerSlide +
				"s per image)";

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
			"路 approx. " +
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

					try {

						const imageURL =
							URL.createObjectURL(
								file
							);


						const img =
							new Image();


						img.src =
							imageURL;


						await img.decode();


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

		queueCountEl.textContent =
			activeSlides.length;


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
				sticker.emoji
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
								"https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/72x72/" +
									point +
									".png",
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

		if (stickerEmojiImages) {

			return (
				emojiSize *
				stickerEmojiImages.length
			);

		}


		context.font =
			emojiSize +
			"px " +
			STICKER_EMOJI_FONT;


		return context.measureText(
			sticker.emoji
		).width;

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


		const boxHeight =
			STICKER_HEIGHT;


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
		 * The emoji never take more than 45%
		 * of the room, otherwise a long
		 * label gets squeezed to nothing.
		 */

		const emojiBudget =
			maxContent *
			0.45;


		if (
			emojiWidth >
				emojiBudget &&
			emojiBudget > 0
		) {

			emojiSize *=
				emojiBudget /
				emojiWidth;


			emojiWidth =
				measureEmoji(
					context,
					emojiSize,
					sticker
				);

		}


		/*
		 * Everything left over is for the
		 * text.
		 */

		const textBudget =
			Math.max(
				0,
				maxContent -
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
					emojiSize;

			}

		}
		else {

			context.font =
				emojiSize +
				"px " +
				STICKER_EMOJI_FONT;


			context.fillStyle =
				"#111111";


			context.fillText(
				sticker.emoji,
				cursor,
				middleY
			);


			cursor +=
				emojiWidth;

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
		 * Lines are centred as a block
		 * around the middle of the box.
		 */

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
					cursor,
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

	async function generateMP4() {

		if (
			activeSlides.length === 0
		) {

			alert(
				"Please wait for images to generate or upload your own!"
			);

			return;

		}


		if (
			typeof VideoEncoder ===
			"undefined"
		) {

			alert(
				"Your browser does not support WebCodecs. Please use modern Chrome, Edge, or Safari."
			);

			return;

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
			\`Ghibli_Story_\${Date.now()}.mp4\`;


		let fileStream =
			null;


		if (
			typeof window.showSaveFilePicker ===
			"function"
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

					return;

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


		const FRAMES_PER_SLIDE =
			Math.max(
				1,
				Math.round(
					FPS *
						SECONDS_PER_SLIDE
				)
			);


		const TOTAL_FRAMES =
			slides.length *
			FRAMES_PER_SLIDE;


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

					return;

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
					f < FRAMES_PER_SLIDE;
					f++
				) {


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
							FRAMES_PER_SLIDE -
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
							\`Rendering image \${i + 1}/\${slides.length} 鈥� \${percent}%\`;


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


				/*
				 * Make sure the encoder catches up
				 * before processing another image.
				 */

				await waitForEncoder();


				statusText.textContent =
					\`Completed image \${i + 1} of \${slides.length}\`;

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


				a.click();


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
						? "鉁� MP4 saved to disk with audio!"
						: "鉁� MP4 saved to disk!"
					: audioTrack
						? "鉁� MP4 Downloaded with audio!"
						: "鉁� MP4 Downloaded!";

		}
		catch (error) {

			console.error(
				"MP4 rendering failed:",
				error
			);


			statusText.textContent =
				"鈿� Video rendering failed.";


			alert(
				"Video rendering failed: " +
					(error.message || String(error)) +
					"\n\nTry reducing the number of images or closing other browser tabs."
			);

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

</script>

</body>

</html>
`;
							}
