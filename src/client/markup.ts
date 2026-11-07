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

<!-- index.ts writes data-theme="strata" / "stellar" / "nightlab" /
     "paper" / "swiss" / "neo" into the html element above when the
     settings page has picked a theme (Bug Fix Session #240). -->

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

	<!-- Optional fonts must not block the studio or account controls. -->
	<link
		href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800;900&family=JetBrains+Mono:wght@400;700&family=Oswald:wght@400;700&family=Source+Sans+Pro:wght@300;400;600;900&display=swap"
		rel="stylesheet" media="print" onload="this.media='all'"
	>
	<noscript><link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800;900&family=JetBrains+Mono:wght@400;700&family=Oswald:wght@400;700&family=Source+Sans+Pro:wght@300;400;600;900&display=swap" rel="stylesheet"></noscript>


	<!-- The export library is not needed for navigation or sign-in. -->
	<script defer src="https://unpkg.com/mp4-muxer@5.1.3/build/mp4-muxer.js"></script>


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
				<a href="/account">Account</a><!--__CMS_TOP_LINKS__-->
			</nav>

			<a class="landing-signup" href="/signup" data-auth-open="signup">
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
						<span>Made for creators</span><i aria-hidden="true"></i><span>Pixabay stock images and videos</span><i aria-hidden="true"></i><span>Rendered in your browser</span>
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
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span>Pixabay stock photos and video search</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> AI script generation</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> voiceovers</span></li>
						</ul>
						<button class="landing-primary" type="button" data-auth-open="signup">Create a free account <span aria-hidden="true">↗</span></button>
						<p class="landing-plan-note">No card required. Every new account starts on the free plan.</p>
					</article>
					<article class="landing-plan-card landing-plan-featured">
						<div class="landing-plan-top">
							<span class="landing-plan-badge">PAID PLAN</span>
							<span class="landing-plan-price">10,000<span>images / day</span></span>
						</div>
						<h3>Paid</h3>
						<p>For channel builders who generate every single day.</p>
						<ul class="landing-plan-list">
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> video projects</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span>Pixabay stock photos and video search</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> AI script generation</span></li>
							<li><span class="landing-plan-check" aria-hidden="true">✓</span><span><b>Unlimited</b> voiceovers</span></li>
						</ul>
						<button class="landing-primary" type="button" data-auth-open="signup">Request paid access <span aria-hidden="true">↗</span></button>
						<p class="landing-plan-note">Paid accounts are activated by the studio team after signup.</p>
					</article>
				</div>
				<p class="landing-plans-reset">All credits renew every day at midnight (UTC+8).</p>
			<p class="landing-plans-guest">No account yet? <a href="/free">Open the free studio <span aria-hidden="true">↗</span></a> — up to 10,000 Pixabay image imports a day, counted per IP address. Pixabay rate limits also apply.</p>
			</section>

			<section class="landing-cta">
				<div><p class="landing-eyebrow"><span aria-hidden="true"></span> YOUR NEXT IDEA IS WAITING</p><h2>Let’s make something<br><span>worth watching.</span></h2></div>
				<button class="landing-primary landing-cta-button" type="button" data-studio-open>Open the studio <span aria-hidden="true">↗</span></button>
			</section>
		</main>

		<footer class="landing-footer">
			<div class="landing-footer-brand"><span class="landing-brand-mark" aria-hidden="true">V</span><div><b>VIBE STUDIO</b><span>Make your next idea move.</span></div></div>
			<nav class="landing-footer-menu" aria-label="Account menu"><a href="/free">Try the free studio <span aria-hidden="true">↗</span></a><a href="/upgrade">Upgrade</a><!--__CMS_FOOTER_LINKS__--><span>Already have an account?</span><a href="/login" data-auth-open="login">Log in <span aria-hidden="true">↗</span></a></nav>
			<div class="landing-footer-bottom"><span>© 2026 YouTube Vibe Studio</span><span>Built for the stories you want to tell.</span></div>
		</footer>
	</div>

	<div id="studio-app" class="studio-app" hidden>

	<!-- ======================================================
	     TOP BAR (BUG FIX SESSION #240)
	     Sticky chrome: brand, the Bulk grid / Editor switch
	     and the generate action. The reference mockup's theme
	     picker is a settings-page control here, so it is not
	     duplicated in the bar.
	     ====================================================== -->

	<header class="app-top">

		<div class="app-brand">
			<span class="app-mark" aria-hidden="true">V</span>
			<span class="app-name">VIBE <b>STUDIO</b></span>
		</div>

		<div class="grow"></div>

		<div
			class="view-switch"
			id="view-switch"
			role="tablist"
			aria-label="Studio layout"
		>
			<button
				type="button"
				class="view-switch-btn"
				id="layout-table"
				data-layout="table"
				role="tab"
				aria-selected="false"
			>\u25a6 Bulk grid</button>
			<button
				type="button"
				class="view-switch-btn active"
				id="layout-editor"
				data-layout="editor"
				role="tab"
				aria-selected="true"
			>\u25eb Editor</button>
		</div>

		<button
			type="button"
			class="app-generate"
			id="top-generate"
			onclick="onGenerateClick()"
			title="Render and download the MP4"
		>\u2726 Generate</button>

	</header>
	<div
		id="pipeline-storage-alert"
		role="alert"
		aria-live="assertive"
		hidden
		style="margin: 12px 16px 0; padding: 10px 12px; border: 1px solid #b45309; background: #fff7ed; color: #7c2d12; border-radius: 8px; font-size: 14px;"
	>
		<span id="pipeline-storage-message">Pipeline management storage is unavailable.</span>
		<button type="button" id="pipeline-storage-reset" style="margin-left: 12px;">Reset pipeline state</button>
	</div>
	<!--__CMS_STUDIO_TOP_LINKS__-->


	<main class="app-main">

	<div class="header heading">

		<div class="heading-copy">

			<div class="kicker">VIDEO WORKSPACE</div>

			<h1>
				\ud83c\udfac YouTube Vibe Studio
			</h1>

			<p>
				Generates AI scenes, adds your MP3
				soundtrack, and exports a cinematic MP4.
			</p>

		</div>

		<div class="heading-actions">

			<button
			type="button"
			id="bulk-toggle"
			class="bulk-toggle"
			onclick="addVideoAccordion()"
			title="Add a video (up to 10)">\uff0b Add Video
			</button>

		</div>

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
	     QUICK BATCH TABLE (view 1)
	     An editable table: one row is one video. Column 1 is the
	     script, column 2 the video image style (the same ten
	     options as the script modal), column 3 the stock image
	     resolution (480 / 540 / 720 / 1024 px long edge), column 4
	     the frame orientation (square / landscape / portrait),
	     column 5 Actions (Preview + Export + Edit). The old "Min"
	     column is gone: a row's length is driven by its finished
	     narration, not by a typed minute count. Rows are
	     independent of the "Video N" accordions below.
	     ====================================================== -->

	<section id="view-table" class="view">

		<div class="studio-card table-card">

			<div class="card-head">

				<strong>Quick batch table</strong>
				<span class="card-note" id="batch-note">One row \u2014 one video</span>
				<button type="button" class="upload-btn small batch-add-row" id="batch-add-row" title="Add another row (10 rows at most)">\uff0b Add Row</button>
				<button type="button" class="app-generate batch-generate" id="batch-generate" title="Generate every row that has a script and is not finished yet: voiceover, Pixabay images and the animation, three rows at a time">\u2726 Generate</button>

			</div>

			<p class="va-note batch-hint">
				Type or paste a script in the first box, pick the video image
				style, the stock image resolution and the frame
				orientation, then press
				<strong>\u2726 Generate</strong> at the top right of the table.
				Every row that has a script is spoken (MP3), illustrated with
				Pixabay images and animated; a row that is empty is skipped, and so is
				a row that is already finished (its Preview and Export buttons are
				live \u2014 it is never generated or billed twice). Three rows render at the same time.
				The last <strong>Actions</strong> cell has Preview, Process Export and
				Edit icons. Until a row is finished it reads <strong>Preview Here</strong>
				and <strong>Export Video</strong>; the first two icons unlock at the same
				moment, Edit opens the timeline editor in a new page, and the export is built in this browser.
			</p>

			<p class="va-note">Stock photos and clips from <a href="https://pixabay.com/" target="_blank" rel="noopener noreferrer">Pixabay</a> · 12 results per search: 8 distinct photos and 4 clips for every script. Source dimensions vary; resolution controls the output frame.</p>
			<div class="table-scroll">

				<table class="batch-table batch-table-edit">

					<thead>
						<tr>
							<th class="batch-col-script">Script</th>
							<th class="batch-col-style">Video style</th>
							<th class="batch-col-resolution">Resolution</th>
							<th class="batch-col-orientation">Orientation</th>
					<th class="batch-col-actions">Actions</th>
						</tr>
					</thead>

					<tbody id="batch-rows"></tbody>

				</table>

			</div>

			<div class="table-empty" id="batch-empty">
				No rows yet \u2014 press \uff0b Add Row, paste a script,
				pick a style and press \u2726 Generate.
			</div>

		</div>

	</section>


	<!-- ======================================================
	     VIDEO STUDIO (view 2) \u2014 the editor
	     ====================================================== -->

	<section id="view-editor" class="view active">

	<div class="studio">

		<div class="studio-card editor-build">

			<div class="card-head">
				<strong>Build your video</strong>
				<span class="card-note" id="concept-count">0 videos</span>
			</div>

			<div id="video-accordions"></div>

		</div>


		<div class="studio-card preview-card">

			<div class="card-head">
				<i class="preview-dot" aria-hidden="true"></i>
				<strong>Preview monitor</strong>
				<span class="card-note" id="preview-state">idle</span>
			</div>

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
				Click \uff0b Add Video above, then
				press Generate.
			</span>
		</div>



		</div><!-- .preview-card -->


		<div class="engine-panels">

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

		</div><!-- .engine-panels -->

	</div><!-- .studio -->

	</section>

	<!-- ======================================================
	     TIMELINE EDITOR (opened from a Quick Batch row)
	     Browser-only visual timing editor. It does not run the
	     video-generation pipeline or call a server route.

	     Reading order (Session 331, latest request):
	     1. stage row: the sticky preview canvas (320 px stage) is
	        100 % wide on its own, and 70 % wide with the left
	        child panel taking the other 30 % while a background
	        clip (Pixabay image, GIF or MP4) is selected;
	     2. selected-element panel: full width, follows the stage;
	     3. timeline dock: full width, follows the element panel.
	     The dock is in normal flow, so a tall screen leaves empty
	     space under the tracks instead of stretching them.
	     ====================================================== -->
	<section id="view-timeline" class="view" aria-label="Timeline editor">
		<div class="timeline-editor-shell" id="timeline-editor">
			<div class="te-topbar">
				<button type="button" class="te-back" id="timeline-back" title="Close the timeline editor and return to Quick Batch">\u2190 Quick Batch</button>
				<div class="te-project-heading">
					<strong id="timeline-project-title">Timeline editor</strong>
					<span id="timeline-project-subtitle">Adjust scene and element timing</span>
				</div>
				<span id="timeline-save-status" class="te-save-status" role="status" aria-live="polite">Local timing edits</span>
				<button type="button" class="te-play" data-timeline-action="play">\u25b6 Play</button>
				<button type="button" class="te-export te-primary" id="timeline-export-btn" data-timeline-action="export" title="Render and download this timeline as an MP4 video">\u2b07 Export MP4</button>
			</div>

			<!-- 1/3 — the preview stage row: 100 % wide, or 70 % + 30 % child panel -->
			<div class="te-stage-row" id="timeline-stage-row">
				<section class="te-preview-panel" aria-label="Video preview">
						<div class="te-panel-heading"><strong>Preview</strong><span id="timeline-current-scene">Scene 1</span></div>
						<div class="te-preview-stage">
							<canvas id="timeline-preview-canvas" width="1280" height="720" aria-label="Timeline preview canvas: drag a selected text or graphic to move it" title="Drag a selected text or graphic to change its X and Y"></canvas>
							<div id="timeline-preview-placeholder" class="te-preview-placeholder">Select or upload media to preview this scene</div>
						</div>
						<div class="te-export-progress" id="timeline-export-progress" hidden aria-hidden="true"><div class="te-export-progress-bar" id="timeline-export-progress-bar"></div></div>
						<div class="te-preview-controls">
							<button type="button" data-timeline-action="restart" title="Return to the start">\u21ba</button>
							<button type="button" data-timeline-action="step-back" title="Previous scene">\u2039</button>
							<button type="button" class="te-play" data-timeline-action="play">\u25b6 Play</button>
							<button type="button" class="te-export" data-timeline-action="export" title="Render and download this timeline as an MP4 video">\u2b07 Export MP4</button>
							<button type="button" data-timeline-action="step-forward" title="Next scene">\u203a</button>
							<output id="timeline-time-readout">0:00 / 1:00</output>
						</div>
						<p class="te-preview-note" id="timeline-preview-note">Preview and timing changes stay in this browser. Drag a selected text or graphic on the canvas to move it.</p>
				</section>

				<!-- The 30 % child section: shown only while a background clip (or one of its children) is selected -->
				<aside class="te-child-panel" id="timeline-child-panel" aria-label="Child text and graphics of the selected background clip" hidden>
					<div class="te-child-head">
						<div class="tm-scene-kicker">BACKGROUND ELEMENT</div>
						<strong id="timeline-child-title">Select a background clip</strong>
						<small id="timeline-child-window">No background clip is selected</small>
					</div>
					<div class="te-child-actions">
						<button type="button" class="tm-scene-add" data-timeline-action="add-child-text" title="Add a text that lives inside this background clip's window">\uff0b Child text</button>
						<button type="button" class="tm-scene-add" data-timeline-action="add-child-graphic" title="Add a graphic that lives inside this background clip's window">\uff0b Child graphic</button>
					</div>
					<div id="timeline-child-list" class="te-child-list" aria-label="Child elements of this background clip"></div>
					<div id="timeline-child-editor" class="te-child-editor"></div>
				</aside>
			</div>

			<!-- 2/3 — the selected-scene section always follows the preview -->
			<div class="te-workspace">
				<aside class="te-inspector-panel" aria-label="Selected scene controls">
					<div class="tm-scene-panel">
						<div class="tm-scene-panel-head">
							<div><div class="tm-scene-kicker">TIMELINE EDITOR</div><div class="tm-sec-title">Selected Scene</div></div>
							<div class="tm-scene-panel-actions">
								<button type="button" id="timeline-add-text" class="tm-scene-add" data-timeline-action="add-text">\uff0b Text</button>
								<button type="button" id="timeline-add-graphic" class="tm-scene-add" data-timeline-action="add-graphic">\uff0b Graphic</button>
								<button type="button" id="timeline-duplicate-element" class="tm-scene-add" data-timeline-action="duplicate" title="Duplicate the selected clip into the slot right after the original" hidden disabled>\u29c9 Duplicate</button>
								<button type="button" id="timeline-delete-element" class="tm-scene-delete" data-timeline-action="delete" hidden disabled>Delete</button>
							</div>
						</div>
						<div id="timeline-element-selector" class="tm-scene-objects" aria-label="Scene elements"></div>
						<div id="timeline-inspector" class="tm-scene-inspector"></div>
						<div id="timeline-inspector-empty" class="te-inspector-empty">Choose a track or element to see its controls.</div>
					</div>
				</aside>
			</div>

			<!-- 3/3 — the timeline dock always follows the selected-scene section -->
			<section class="te-dock" aria-label="Timeline tracks">
				<div class="te-dock-toolbar">
					<div><strong>Timeline</strong><span id="timeline-duration-label">1:00</span></div>
					<div class="te-dock-actions">
							<button type="button" class="te-secondary" data-timeline-action="add-layer" title="Add a text and graphics lane, up to four">\uff0b Lane <span id="timeline-layer-count">1 / 4</span></button>
						<label class="te-zoom">Zoom <input id="timeline-zoom" type="range" min="0.5" max="2" step="0.1" value="1"><output id="timeline-zoom-value">1\u00d7</output></label>
						<button type="button" class="te-export" data-timeline-action="export" title="Render and download this timeline as an MP4 video">\u2b07 Export MP4</button>
					</div>
				</div>
				<div class="te-timeline-scroll" id="timeline-scroll">
					<div class="te-track-grid" id="timeline-track-grid"></div>
				</div>
				<div class="te-dock-footer" hidden><span id="timeline-status" role="status" aria-live="polite"></span></div>
				<!-- Short tail: keeps the sticky preview pinned until the dock itself ends. -->
				<div class="te-dock-tail" aria-hidden="true"></div>
			</section>
			<input type="file" id="timeline-media-upload" accept="image/*,image/gif,video/mp4,.mp4,.gif" multiple hidden>
			<input type="file" id="timeline-audio-upload" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg" hidden>
		</div>
	</section>

	</main>
	<!--__CMS_STUDIO_FOOTER__-->


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
__API_ROTATION_JS__
__APP_JS____TEMPLATE_COMPOSER_JS____TIMELINE_EDITOR_JS__
</script>

</body>

</html>
`;
