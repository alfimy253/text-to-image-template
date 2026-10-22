/*
 * PAGE_MARKUP — the HTML skeleton (head + body) for the
 * public landing page and studio, adapted from the original
 * single-file template literal. The placeholders are substituted in page.ts:
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

<!-- index.ts writes data-theme="strata" / "stellar" into the
     html element above when the settings page has picked a theme. -->

<head>

	<meta charset="UTF-8">

	<meta
		name="viewport"
		content="width=device-width, initial-scale=1.0"
	>

	<title>YouTube Vibe Studio — Create videos from your ideas</title>
	<meta
		name="description"
		content="Turn images, music and ideas into polished videos with YouTube Vibe Studio. Create scenes, scripts, captions and MP4s in one browser-based workspace."
	>
	<meta name="theme-color" content="#0f1115">


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
		href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&family=Source+Sans+Pro:wght@300;400;600;900&display=swap"
		rel="stylesheet"
	>


	<script src="https://unpkg.com/mp4-muxer@5.1.3/build/mp4-muxer.js"></script>


	<style>__APP_CSS__</style>

</head>


<body>

	<div class="landing-page" id="landing-page">

		<header class="landing-nav">
			<a class="landing-brand" href="#landing-home" aria-label="YouTube Vibe Studio home">
				<span class="landing-brand-mark" aria-hidden="true">V</span>
				<span class="landing-brand-name">VIBE <b>STUDIO</b></span>
			</a>

			<nav class="landing-nav-links" aria-label="Main navigation">
				<a href="#landing-process">How it works</a>
				<a href="#landing-features">Features</a>
				<a href="#landing-plans">Plans</a>
				<a href="/free">Free studio</a>
			</nav>

			<a class="landing-signup" href="#signup" data-auth-open="signup">
				Sign up <span aria-hidden="true">↗</span>
			</a>
		</header>

		<main class="landing-main">
			<section class="landing-hero" id="landing-home">
				<div class="landing-hero-copy">
					<p class="landing-eyebrow"><span aria-hidden="true"></span> YOUR NEXT VIDEO STARTS HERE</p>
					<h1>Your ideas,<br><span>in motion.</span></h1>
					<p class="landing-lead">Turn images, music and a spark of imagination into a video worth sharing — all in one creative studio.</p>
					<div class="landing-actions">
						<button class="landing-primary" type="button" data-studio-open>
							Start creating <span aria-hidden="true">↗</span>
						</button>
						<a class="landing-secondary" href="#landing-process">
							<span class="landing-secondary-play" aria-hidden="true">▶</span> See how it works
						</a>
					</div>
					<div class="landing-microcopy">
						<span>Made for creators</span><i aria-hidden="true"></i><span>50 free AI images daily</span><i aria-hidden="true"></i><span>Rendered in your browser</span>
					</div>
				</div>

				<div class="landing-hero-art" aria-hidden="true">
					<div class="landing-orbit landing-orbit-one"></div>
					<div class="landing-orbit landing-orbit-two"></div>
					<div class="landing-preview-card">
						<div class="landing-preview-topbar">
							<div class="preview-window-dots"><i></i><i></i><i></i></div>
							<span class="preview-project-name">PROJECT PREVIEW</span>
							<span class="preview-ready"><i></i> READY</span>
						</div>
						<div class="landing-preview-canvas">
							<div class="preview-scene">
								<span class="preview-sun"></span>
								<span class="preview-cloud preview-cloud-one"></span>
								<span class="preview-cloud preview-cloud-two"></span>
								<span class="preview-mountain preview-mountain-back"></span>
								<span class="preview-mountain preview-mountain-front"></span>
								<span class="preview-scene-caption">YOUR STORY, <b>IN MOTION.</b></span>
								<span class="preview-scene-play">▶</span>
							</div>
						</div>
						<div class="preview-control-row">
							<span class="preview-play-mini">▶</span>
							<span class="preview-time">00:18 <i>/</i> 00:42</span>
							<span class="preview-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
							<span class="preview-export">MP4</span>
						</div>
						<div class="preview-timeline">
							<div class="preview-timeline-label">SCENES</div>
							<div class="preview-timeline-clips"><span></span><span></span><span></span><span></span></div>
							<div class="preview-audio-track"><span>♪ AUDIO TRACK</span><i></i></div>
						</div>
					</div>
					<div class="preview-float preview-float-top"><span>✦</span> AI scenes</div>
					<div class="preview-float preview-float-bottom"><span>♫</span> Your soundtrack</div>
				</div>
			</section>

			<section class="landing-proof" aria-label="Studio highlights">
				<div class="landing-proof-item"><span class="proof-icon">✦</span><div><b>AI when you want it</b><span>Images, scripts and voiceover on demand</span></div></div>
				<div class="landing-proof-item"><span class="proof-icon">◉</span><div><b>Made for your workflow</b><span>Bring your own images, clips and music</span></div></div>
				<div class="landing-proof-item"><span class="proof-icon">↗</span><div><b>Ready to share</b><span>Build and export your video in one place</span></div></div>
			</section>

			<section class="landing-section landing-process" id="landing-process">
				<div class="landing-section-heading">
					<p class="landing-eyebrow"><span aria-hidden="true"></span> A SIMPLE CREATIVE FLOW</p>
					<h2>Less setup.<br><span>More story.</span></h2>
					<p>Bring the pieces together, then focus on the moments you want people to remember.</p>
				</div>
				<div class="landing-steps">
					<article class="landing-step">
						<div class="landing-step-top"><span>01 / START</span><span class="step-glyph">▧</span></div>
						<h3>Gather your moments</h3>
						<p>Add your images, clips and soundtrack — or create fresh visuals with AI.</p>
					</article>
					<article class="landing-step">
						<div class="landing-step-top"><span>02 / SHAPE</span><span class="step-glyph">✳</span></div>
						<h3>Make it feel like you</h3>
						<p>Set the pace, add titles and captions, and build a story with sound.</p>
					</article>
					<article class="landing-step">
						<div class="landing-step-top"><span>03 / SHARE</span><span class="step-glyph">↗</span></div>
						<h3>Render and take it with you</h3>
						<p>Preview your project and export a finished MP4 from your browser.</p>
					</article>
				</div>
			</section>

			<section class="landing-feature-band" id="landing-features">
				<div class="landing-feature-heading">
					<p class="landing-eyebrow"><span aria-hidden="true"></span> YOUR CREATOR TOOLKIT</p>
					<h2>Everything you need<br>to <span>tell it your way.</span></h2>
				</div>
				<div class="landing-feature-grid">
					<article class="landing-feature-card"><span class="feature-index">01</span><h3>Visuals with a point of view</h3><p>Generate AI scenes from a prompt or bring in the images and video you already love.</p><span class="feature-arrow" aria-hidden="true">↗</span></article>
					<article class="landing-feature-card"><span class="feature-index">02</span><h3>A little help with the words</h3><p>Build a script, voiceover and captions around the message you want to share.</p><span class="feature-arrow" aria-hidden="true">↗</span></article>
					<article class="landing-feature-card"><span class="feature-index">03</span><h3>Your video, ready to go</h3><p>Arrange scenes, add a soundtrack and render your project locally in the browser.</p><span class="feature-arrow" aria-hidden="true">↗</span></article>
				</div>
			</section>


			<section class="landing-plans" id="landing-plans">
				<div class="landing-plans-heading">
					<p class="landing-eyebrow"><span aria-hidden="true"></span> DAILY CREDITS, NO SURPRISES</p>
					<h2>Start free.<br><span>Go bigger when you're ready.</span></h2>
					<p>Unlimited video projects, AI scripts and voiceovers on every plan. Image credits renew every day, so tomorrow is always a fresh canvas.</p>
				</div>
				<div class="landing-plan-grid">
					<article class="landing-plan-card">
						<div class="landing-plan-top">
							<span class="landing-plan-badge">FREE PLAN</span>
							<span class="landing-plan-price">$0</span>
						</div>
						<h3>Free</h3>
						<p>For creators trying ideas and shipping their first videos.</p>
						<ul class="landing-plan-list">
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> video projects</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>50</b> AI images every day</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> AI script generation</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> voiceovers</span></li>
						</ul>
						<button class="landing-primary" type="button" data-auth-open="signup">Create a free account <span aria-hidden="true">↗</span></button>
						<p class="landing-plan-note">No card required. Every new account starts on the free plan.</p>
					</article>
					<article class="landing-plan-card landing-plan-featured">
						<div class="landing-plan-top">
							<span class="landing-plan-badge">PAID PLAN</span>
							<span class="landing-plan-price">1,200<span>images / day</span></span>
						</div>
						<h3>Paid</h3>
						<p>For channel builders who generate every single day.</p>
						<ul class="landing-plan-list">
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> video projects</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>1,200</b> AI images every day</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> AI script generation</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> voiceovers</span></li>
						</ul>
						<button class="landing-primary" type="button" data-auth-open="signup">Request paid access <span aria-hidden="true">↗</span></button>
						<p class="landing-plan-note">Paid accounts are activated by the studio team after signup.</p>
					</article>
				</div>
				<p class="landing-plans-reset">All credits renew every day at midnight (UTC+8).</p>
			<p class="landing-plans-guest">No account yet? <a href="/free">Open the free studio <span aria-hidden="true">↗</span></a> — 10 AI images a day, counted per IP address.</p>
			</section>

			<section class="landing-cta">
				<div><p class="landing-eyebrow"><span aria-hidden="true"></span> YOUR NEXT IDEA IS WAITING</p><h2>Let’s make something<br><span>worth watching.</span></h2></div>
				<button class="landing-primary landing-cta-button" type="button" data-studio-open>Open the studio <span aria-hidden="true">↗</span></button>
			</section>
		</main>

		<footer class="landing-footer">
			<div class="landing-footer-brand"><span class="landing-brand-mark" aria-hidden="true">V</span><div><b>VIBE STUDIO</b><span>Make your next idea move.</span></div></div>
			<nav class="landing-footer-menu" aria-label="Account menu"><a href="/free">Try the free studio <span aria-hidden="true">↗</span></a><span>Already have an account?</span><a href="#login" data-auth-open="login">Log in <span aria-hidden="true">↗</span></a></nav>
			<div class="landing-footer-bottom"><span>© 2026 YouTube Vibe Studio</span><span>Built for the stories you want to tell.</span></div>
		</footer>
	</div>

	<div id="studio-app" class="studio-app" hidden>

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

	<div class="aerial-credit">Theme adapted from <a href="https://html5up.net/aerial" target="_blank" rel="noopener noreferrer">Aerial by HTML5 UP</a> / @ajlkn · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">CC BY 3.0</a></div>

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
						The slideshow repeats to cover
						the whole track.
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
					(9s per image)
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
				White 435 \u00d7 150 rectangle, square
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
				Click the round Add Video button (top
				left), then press Generate.
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


	</div><!-- #studio-app -->

<script>
__APP_JS____TEMPLATE_COMPOSER_JS__
</script>

</body>

</html>
`;
