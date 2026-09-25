/*
 * PAGE_MARKUP — the HTML skeleton (head + body) of the studio
 * page, copied verbatim out of the old single-file template
 * literal. The four placeholders are substituted in page.ts:
 *
 *   __APP_CSS__                -> client/styles.ts
 *   __APP_JS__                 -> client/app-js.ts
 *   __TEMPLATE_COMPOSER_JS__   -> client/template-composer-js.ts
 *   __PROMPTS_JSON__           -> JSON.stringify(prompts)
 *
 * Escapes inside this string are intentional — do not reformat.
 */

export const PAGE_MARKUP = `
<!DOCTYPE html>

<html lang="en">

<head>

	<meta charset="UTF-8">

	<meta
		name="viewport"
		content="width=device-width, initial-scale=1.0"
	>

	<title>
		YouTube Vibe Studio
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


	<style>__APP_CSS__</style>

</head>


<body>


	<div class="header">

				<button
			type="button"
			id="bulk-toggle"
			class="bulk-toggle"
			onclick="addVideoAccordion()"
			title="Add a video (up to 10)">+ Add Video
		</button>


		<h1>
			\ud83c\udfac YouTube Vibe Studio
		</h1>

		<p>
			Generates AI scenes, adds your MP3
			soundtrack, and exports a cinematic MP4.
		</p>

	</div>

	<div
		id="bulk-banner"
		class="bulk-banner"
		style="display:none"
	>
		\u26a0\ufe0f Bulk generation is in progress \u2014 do not
		move or delete your image or MP4 files until
		it finishes.
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
				Audio Track \u2014 upload an MP3
				before rendering
			</div>


			<div class="audio-row">

				<label class="upload-btn audio">

					\ud83c\udfb5 Upload MP3 Audio

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
					No audio added \u2014
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
						\ud83d\uddd1 Remove Audio
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
				frame \u2014 no background box
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
							\ud83d\udc4d Like
						</option>

						<option value="love">
							\u2764\ufe0f Love it
						</option>

						<option value="subscribe">
							\ud83d\udd14 Subscribe
						</option>

						<option
							value="like-subscribe"
						>
							\ud83d\udc4d\ud83d\udd14 Like &amp; Subscribe
						</option>

						<option value="watch">
							\ud83c\udfac Watch Video
						</option>

						<option
							value="watch-like-subscribe"
						>
							\ud83c\udfac\ud83d\udc4d\ud83d\udd14 Watch, Like
							&amp; Subscribe
						</option>

					</select>

				</label>

			</div>


			<div class="audio-note">
				White 200 \u00d7 80 rectangle, square
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
				the next caption appears. The last caption is capped
				at 10 seconds on screen.
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


		<div
			class="action-bar"
			id="action-bar"
		>
			<span
				class="action-hint"
				id="action-hint"
			>
				Click the red Add Video button (top left),
				then press Generate.
			</span>
		</div>

		<div
			id="video-accordions"
		>
		</div>


		<div class="controls">

			<label class="upload-btn">

				\ud83d\udcc1 Upload Image, GIF or MP4 (25 images \u00b7 5 GIF \u00b7 5 MP4)

				<input
					type="file"
					id="file-upload"
					accept="image/*,image/gif,.gif,video/mp4,.mp4"
					multiple
				>

			</label>


			<label class="quality-select">

				Quality

				<select id="quality-select">

					<option value="low">
						480p \u00b7 Light (1.2 Mbps)
					</option>

					<option
						value="balanced"
						selected
					>
						720p \u00b7 Balanced (2.5 Mbps)
					</option>

					<option value="high">
						720p \u00b7 High (5 Mbps)
					</option>

				</select>

			</label>


			<button
				id="render-btn"
				onclick="onGenerateClick()"
			>

				\ud83c\udf9e\ufe0f Render & Download MP4 Video

			</button>

		</div>

	</div>



	<div
		id="gallery"
		class="gallery"
	></div>


	<div
		id="required-modal"
		class="modal-overlay"
		style="display:none"
	>
		<div class="modal-box">
			<div class="modal-title">
				\u26a0\ufe0f Missing required fields
			</div>
			<ul
				id="required-modal-list"
			>
			</ul>
			<button
				type="button"
				class="upload-btn"
				onclick="closeRequiredModal()"
			>
				OK
			</button>
		</div>
	</div>


<script>
__APP_JS____TEMPLATE_COMPOSER_JS__
</script>

</body>

</html>
`;
