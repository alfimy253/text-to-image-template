
interface Env {
	AI: Ai;
}

const MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";

const prompts = [
	"Ghibli-inspired hand-painted anime scene of a young entrepreneur standing inside a tiny neighborhood shop before opening, warm morning sunlight entering through windows, shelves of products and simple checkout counter, gentle storytelling about what a business is, expressive character, hand-painted backgrounds, nostalgic cel animation texture, warm colors, no text, no logos, 16:9",

	"1990s nostalgic Studio Ghibli-inspired anime scene of a small business owner handing a product to a smiling customer across a wooden counter, another customer waiting behind, warm human interaction showing exchange and trust, detailed hand-painted shop interior, soft nostalgic lighting, expressive faces, no text, no logos, 16:9",
];

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// =========================================================
		// MAIN APPLICATION
		// =========================================================

		if (request.method === "GET" && url.pathname === "/") {
			return new Response(createHTML(), {
				status: 200,
				headers: {
					"Content-Type": "text/html; charset=UTF-8",
				},
			});
		}

		// =========================================================
		// AI IMAGE GENERATION
		// =========================================================

		const match = url.pathname.match(/^\/image\/(\d+)$/);

		if (request.method === "GET" && match) {
			const index = Number(match[1]);

			if (
				!Number.isInteger(index) ||
				index < 0 ||
				index >= prompts.length
			) {
				return json(
					{
						success: false,
						error: "Invalid image index",
					},
					400
				);
			}

			try {
				const result = await env.AI.run(MODEL, {
					prompt: prompts[index],
				});

				return new Response(result as ReadableStream, {
					status: 200,
					headers: {
						"Content-Type": "image/png",
						"Cache-Control": "no-store",
						"X-Image-Index": String(index),
					},
				});
			} catch (error) {
				return json(
					{
						success: false,
						error:
							error instanceof Error
								? error.message
								: String(error),
					},
					500
				);
			}
		}

		return new Response("Not Found", {
			status: 404,
		});
	},
} satisfies ExportedHandler<Env>;


// =============================================================
// JSON HELPER
// =============================================================

function json(
	data: unknown,
	status = 200
): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}


// =============================================================
// FRONTEND
// =============================================================

function createHTML(): string {
	return `
<!DOCTYPE html>

<html lang="en">

<head>

	<meta charset="UTF-8">

	<meta
		name="viewport"
		content="width=device-width, initial-scale=1.0"
	>

	<title>AI Ghibli Video & MP4 Studio</title>


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
			background: var(--bg);
			color: var(--text);
			font-family:
				system-ui,
				-apple-system,
				sans-serif;
			padding: 20px;
		}

		.header {
			text-align: center;
			margin-bottom: 25px;
		}

		.header h1 {
			font-size: 2rem;
			color: var(--accent);
			margin-bottom: 8px;
		}

		.header p {
			color: #9ca3af;
			font-size: 0.95rem;
		}

		.studio {
			max-width: 900px;
			margin: 0 auto 40px auto;
			background: var(--card);
			border: 1px solid #2e3440;
			border-radius: 12px;
			padding: 20px;
			display: flex;
			flex-direction: column;
			align-items: center;
		}

		.canvas-container {
			width: 100%;
			aspect-ratio: 16 / 9;
			background: #000;
			border-radius: 8px;
			overflow: hidden;
			position: relative;
			display: flex;
			align-items: center;
			justify-content: center;
			box-shadow:
				0 10px 30px
				rgba(0, 0, 0, 0.5);
		}

		canvas {
			width: 100%;
			height: 100%;
			object-fit: contain;
		}

		.overlay-text {
			position: absolute;
			color: #6b7280;
			font-size: 1.2rem;
			pointer-events: none;
		}

		.controls {
			display: flex;
			gap: 15px;
			margin-top: 20px;
			width: 100%;
			justify-content: center;
			flex-wrap: wrap;
		}

		button,
		.upload-btn {
			background: var(--accent);
			color: #000;
			border: none;
			padding: 12px 24px;
			font-size: 1rem;
			font-weight: bold;
			border-radius: 8px;
			cursor: pointer;
			transition:
				transform 0.1s,
				opacity 0.2s;
			display: inline-flex;
			align-items: center;
			gap: 8px;
		}

		button:hover,
		.upload-btn:hover {
			opacity: 0.9;
			transform: translateY(-1px);
		}

		button:disabled {
			background: #374151;
			color: #9ca3af;
			cursor: not-allowed;
			transform: none;
		}

		.upload-btn {
			background: #2563eb;
			color: white;
		}

		input[type="file"] {
			display: none;
		}

		.progress-bar-container {
			width: 100%;
			background: #2e3440;
			height: 10px;
			border-radius: 5px;
			margin-top: 15px;
			overflow: hidden;
			display: none;
		}

		.progress-bar {
			width: 0%;
			height: 100%;
			background: #10b981;
			transition: width 0.1s;
		}

		.status-text {
			margin-top: 8px;
			font-size: 0.85rem;
			color: #10b981;
			display: none;
		}

		h2 {
			margin-bottom: 15px;
			border-bottom: 1px solid #2e3440;
			padding-bottom: 10px;
		}

		.gallery {
			display: grid;
			grid-template-columns:
				repeat(
					auto-fill,
					minmax(280px, 1fr)
				);
			gap: 16px;
		}

		.card {
			background: var(--card);
			border: 2px solid transparent;
			border-radius: 10px;
			padding: 10px;
			transition: border-color 0.2s;
			position: relative;
		}

		.card.in-video {
			border-color: var(--accent);
		}

		.badge {
			position: absolute;
			top: 18px;
			right: 18px;
			background: var(--accent);
			color: #000;
			font-size: 0.75rem;
			font-weight: bold;
			padding: 3px 8px;
			border-radius: 12px;
			z-index: 10;
		}

		.image-container {
			width: 100%;
			aspect-ratio: 16 / 9;
			background: #0f1115;
			border-radius: 6px;
			display: flex;
			align-items: center;
			justify-content: center;
			overflow: hidden;
		}

		.image-container img {
			width: 100%;
			height: 100%;
			object-fit: cover;
		}

		.loading {
			color: #6b7280;
			font-size: 0.85rem;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 8px;
		}

		.spinner {
			width: 20px;
			height: 20px;
			border: 2px solid #374151;
			border-top-color: var(--accent);
			border-radius: 50%;
			animation: spin 1s linear infinite;
		}

		@keyframes spin {
			to {
				transform: rotate(360deg);
			}
		}

		.prompt {
			margin-top: 8px;
			font-size: 0.8rem;
			color: #9ca3af;
			line-height: 1.4;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
		}

		.card-actions {
			margin-top: 10px;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}

		.toggle-btn {
			background: #374151;
			color: white;
			padding: 6px 12px;
			font-size: 0.8rem;
		}

		.card.in-video .toggle-btn {
			background: #ef4444;
		}

	</style>

</head>


<body>


	<div class="header">

		<h1>
			🎬 Cloudflare AI Video Studio
		</h1>

		<p>
			Generates AI scenes and creates
			slow cinematic MP4 videos.
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

				📁 Upload Custom Image

				<input
					type="file"
					id="file-upload"
					accept="image/*"
					multiple
				>

			</label>


			<button
				id="render-btn"
				onclick="generateMP4()"
			>

				🎞️ Render & Download MP4 Video

			</button>

		</div>

	</div>


	<h2>

		Storyboard Queue
		(
		<span id="queue-count">0</span>
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
		document.getElementById("gallery");

	const queueCountEl =
		document.getElementById("queue-count");

	const activeSlides = [];


	// =========================================================
	// CREATE AI CARDS
	// =========================================================

	prompts.forEach((prompt, index) => {

		const card =
			document.createElement("div");

		card.className = "card";

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
				title="\${prompt}"
			>

				\${index + 1}.
				\${prompt}

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

		gallery.appendChild(card);
	});


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

			const url =
				URL.createObjectURL(blob);

			const img =
				new Image();

			img.src = url;

			await img.decode();

			container.innerHTML = "";

			container.appendChild(img);


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
	 * Generate AI images.
	 */

	prompts.forEach(
		(_, index) =>
			fetchAIImage(index)
	);


	// =========================================================
	// CUSTOM IMAGE UPLOAD
	// =========================================================

	document
		.getElementById("file-upload")
		.addEventListener(
			"change",
			async (event) => {

				const files =
					Array.from(
						event.target.files
					);


				for (
					const file of files
				) {

					try {

						const url =
							URL.createObjectURL(
								file
							);

						const img =
							new Image();

						img.src =
							url;

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


							<div class="image-container">

								<img src="\${url}">

							</div>


							<div class="prompt">
								\${escapeHTML(file.name)}
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


						gallery.prepend(card);


						activeSlides.unshift({

							id:
								customId,

							img:
								img,

							cardId:
								customId

						});


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
				 * Reset input so the same
				 * files can be selected again.
				 */

				event.target.value = "";

			}
		);


	// =========================================================
	// HTML ESCAPE
	// =========================================================

	function escapeHTML(value) {

		return value
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#039;");

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
	// REMOVE CUSTOM IMAGE
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
			 * Release uploaded image
			 * object URL.
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
			document.getElementById(id);


		if (element) {
			element.remove();
		}


		updateQueueCount();
	}


	// =========================================================
	// QUEUE COUNT
	// =========================================================

	function updateQueueCount() {

		queueCountEl.textContent =
			activeSlides.length;

	}


	// =========================================================
	// MP4 GENERATOR
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
				"Your browser does not support WebCodecs API. Please use modern Chrome, Edge, or Safari."
			);

			return;
		}


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

		const WIDTH = 1280;

		const HEIGHT = 720;

		const FPS = 30;

		/*
		 * EXACTLY 5 SECONDS PER IMAGE.
		 */

		const SECONDS_PER_SLIDE = 5;

		const FRAMES_PER_SLIDE =
			FPS *
			SECONDS_PER_SLIDE;

		const TOTAL_FRAMES =
			activeSlides.length *
			FRAMES_PER_SLIDE;


		// =====================================================
		// MP4 MUXER
		// =====================================================

		const muxer =
			new Mp4Muxer.Muxer({

				target:
					new Mp4Muxer.ArrayBufferTarget(),

				video: {

					codec:
						"avc",

					width:
						WIDTH,

					height:
						HEIGHT
				},

				fastStart:
					"in-memory"
			});


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
				5_000_000,

			framerate:
				FPS

		});


		// =====================================================
		// ENCODER BACKPRESSURE
		// =====================================================

		/*
		 * Never allow the browser to accumulate
		 * hundreds of unprocessed VideoFrames.
		 */

		const MAX_ENCODE_QUEUE = 12;


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
		// CAMERA EFFECTS
		// =====================================================

		const effects = [

			"slide-left",

			"slide-right",

			"slide-down",

			"zoom-in"

		];


		let currentFrame = 0;


		try {

			// =================================================
			// PROCESS EVERY IMAGE
			// =================================================

			for (
				let i = 0;
				i < activeSlides.length;
				i++
			) {

				const img =
					activeSlides[i].img;


				const effect =
					effects[
						i %
						effects.length
					];


				// =============================================
				// PROCESS 150 FRAMES = 5 SECONDS
				// =============================================

				for (
					let f = 0;
					f < FRAMES_PER_SLIDE;
					f++
				) {

					/*
					 * Animation progress.
					 */

					const p =
						f /
						(
							FRAMES_PER_SLIDE -
							1
						);


					/*
					 * Smoothstep.
					 *
					 * Makes the camera movement
					 * start gently and finish gently.
					 */

					const ease =
						p *
						p *
						(
							3 -
							2 * p
						);


					// =========================================
					// CANVAS
					// =========================================

					ctx.fillStyle =
						"#000";

					ctx.fillRect(
						0,
						0,
						WIDTH,
						HEIGHT
					);


					// =========================================
					// CAMERA
					// =========================================

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
					 * Use 65% of the available
					 * camera movement.
					 *
					 * This makes the pan clearly
					 * visible over 5 seconds.
					 */

					const movementX =
						overflowX *
						0.65;


					const movementY =
						overflowY *
						0.65;


					let dx = 0;

					let dy = 0;

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

						dx =
							-movementX *
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
					// SLOW ZOOM
					// =========================================

					else if (
						effect ===
						"zoom-in"
					) {

						const currentScale =
							1.03 +
							(
								ease *
								0.07
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
							) / 2;


						dy =
							(
								HEIGHT -
								dh
							) / 2;

					}


					// =========================================
					// OPACITY FADE
					// =========================================

					const FADE_SECONDS = 1;

					const FADE_FRAMES =
						Math.round(
							FPS *
							FADE_SECONDS
						);


					let opacity = 1;


					/*
					 * FADE IN
					 *
					 * The image starts transparent
					 * and gradually becomes visible.
					 */

					if (
						f <
						FADE_FRAMES
					) {

						const fadeP =
							f /
							FADE_FRAMES;


						const fadeEase =
							fadeP *
							fadeP *
							(
								3 -
								2 * fadeP
							);


						opacity =
							fadeEase;

					}


					/*
					 * FADE OUT
					 *
					 * The image gradually becomes
					 * transparent.
					 */

					else if (
						f >=
						FRAMES_PER_SLIDE -
						FADE_FRAMES
					) {

						const fadeP =
							(
								f -
								(
									FRAMES_PER_SLIDE -
									FADE_FRAMES
								)
							) /
							FADE_FRAMES;


						const fadeEase =
							fadeP *
							fadeP *
							(
								3 -
								2 * fadeP
							);


						opacity =
							1 -
							fadeEase;

					}


					// =========================================
					// DRAW IMAGE WITH OPACITY
					// =========================================

					ctx.save();

					ctx.globalAlpha =
						opacity;


					ctx.drawImage(
						img,
						dx,
						dy,
						dw,
						dh
					);


					ctx.restore();


					// =========================================
					// VIDEO FRAME
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
								timestamp
							}
						);


					// =========================================
					// ENCODE
					// =========================================

					videoEncoder.encode(
						frame,
						{
							keyFrame:
								currentFrame %
								(FPS * 2) ===
								0
						}
					);


					/*
					 * Release frame immediately.
					 */

					frame.close();


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

						const percent =
							Math.round(
								(
									currentFrame /
									TOTAL_FRAMES
								) *
								100
							);


						progressBar.style.width =
							percent +
							"%";


						statusText.textContent =
							\`Rendering image \${i + 1}/\${activeSlides.length} — \${percent}%\`;


						/*
						 * Give the browser a chance
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
				 * Let encoder catch up
				 * before starting next image.
				 */

				await waitForEncoder();


				statusText.textContent =
					\`Completed image \${i + 1} of \${activeSlides.length}\`;

			}


			// =================================================
			// FINALIZE ENCODER
			// =================================================

			statusText.textContent =
				"Finalizing MP4 file...";


			await videoEncoder.flush();


			if (encoderError) {
				throw encoderError;
			}


			// =================================================
			// FINALIZE MP4
			// =================================================

			muxer.finalize();


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


			// =================================================
			// DOWNLOAD
			// =================================================

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
				\`Ghibli_Story_\${Date.now()}.mp4\`;


			document.body.appendChild(a);

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


			progressBar.style.width =
				"100%";


			statusText.textContent =
				"✅ MP4 Downloaded!";

		}
		catch (error) {

			console.error(
				"MP4 rendering failed:",
				error
			);


			statusText.textContent =
				"❌ Video rendering failed.";


			alert(
				"Video rendering failed. Try reducing the number of images or closing other browser tabs."
			);

		}
		finally {

			/*
			 * Always clean up encoder.
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


			renderBtn.disabled =
				false;

		}

	}

</script>

</body>

</html>
`;
}

