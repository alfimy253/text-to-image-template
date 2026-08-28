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

		// 1. Serve the Main Web Application
		if (request.method === "GET" && url.pathname === "/") {
			return new Response(createHTML(), {
				status: 200,
				headers: { "Content-Type": "text/html; charset=UTF-8" }
			});
		}

		// 2. AI Image Generation API Route
		const match = url.pathname.match(/^\/image\/(\d+)$/);
		if (request.method === "GET" && match) {
			const index = Number(match[1]);

			if (!Number.isInteger(index) || index < 0 || index >= prompts.length) {
				return json({ success: false, error: "Invalid image index" }, 400);
			}

			const prompt = prompts[index];

			try {
				const result = await env.AI.run(MODEL, { prompt });

				return new Response(result as ReadableStream, {
					status: 200,
					headers: {
						"Content-Type": "image/png",
						"Cache-Control": "no-store",
						"X-Image-Index": String(index)
					}
				});
			} catch (error) {
				return json({
					success: false,
					error: error instanceof Error ? error.message : String(error)
				}, 500);
			}
		}

		return new Response("Not Found", { status: 404 });
	}
} satisfies ExportedHandler<Env>;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

/*
 * FRONTEND HTML + MP4 COMPILER ENGINE
 */
function createHTML(): string {
	return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>AI Ghibli Video & MP4 Studio</title>
	<!-- MP4 Muxer library to package Canvas frames into a real .mp4 file -->
	<script src="https://unpkg.com/mp4-muxer@5.1.3/build/mp4-muxer.js"></script>
	<style>
		:root { --bg: #0f1115; --card: #181b20; --accent: #f59e0b; --text: #f3f4f6; }
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; padding: 20px; }
		
		.header { text-align: center; margin-bottom: 25px; }
		.header h1 { font-size: 2rem; color: var(--accent); margin-bottom: 8px; }
		.header p { color: #9ca3af; font-size: 0.95rem; }

		/* Video Studio Section */
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
			aspect-ratio: 16/9;
			background: #000;
			border-radius: 8px;
			overflow: hidden;
			position: relative;
			display: flex;
			align-items: center;
			justify-content: center;
			box-shadow: 0 10px 30px rgba(0,0,0,0.5);
		}

		canvas { width: 100%; height: 100%; object-fit: contain; }
		
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

		button, .upload-btn {
			background: var(--accent);
			color: #000;
			border: none;
			padding: 12px 24px;
			font-size: 1rem;
			font-weight: bold;
			border-radius: 8px;
			cursor: pointer;
			transition: transform 0.1s, opacity 0.2s;
			display: inline-flex;
			align-items: center;
			gap: 8px;
		}
		button:hover, .upload-btn:hover { opacity: 0.9; transform: translateY(-1px); }
		button:disabled { background: #374151; color: #9ca3af; cursor: not-allowed; transform: none; }
		
		.upload-btn { background: #2563eb; color: white; }
		input[type="file"] { display: none; }

		.progress-bar-container {
			width: 100%;
			background: #2e3440;
			height: 10px;
			border-radius: 5px;
			margin-top: 15px;
			overflow: hidden;
			display: none;
		}
		.progress-bar { width: 0%; height: 100%; background: #10b981; transition: width 0.1s; }
		.status-text { margin-top: 8px; font-size: 0.85rem; color: #10b981; display: none; }

		/* Gallery Section */
		h2 { margin-bottom: 15px; border-bottom: 1px solid #2e3440; padding-bottom: 10px; }
		.gallery {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
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
		.card.in-video { border-color: var(--accent); }
		
		.badge {
			position: absolute;
			top: 18px; right: 18px;
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
		.image-container img { width: 100%; height: 100%; object-fit: cover; }
		.loading { color: #6b7280; font-size: 0.85rem; display: flex; flex-direction: column; align-items: center; gap: 8px; }
		.spinner { width: 20px; height: 20px; border: 2px solid #374151; border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
		@keyframes spin { to { transform: rotate(360deg); } }

		.prompt { margin-top: 8px; font-size: 0.8rem; color: #9ca3af; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
		.card-actions { margin-top: 10px; display: flex; justify-content: space-between; align-items: center; }
		.toggle-btn { background: #374151; color: white; padding: 6px 12px; font-size: 0.8rem; }
		.card.in-video .toggle-btn { background: #ef4444; }
	</style>
</head>
<body>

	<div class="header">
		<h1>🎬 Cloudflare AI Video Studio</h1>
		<p>Generates Ghibli scenes via Workers AI & compiles them into a slow-panning MP4 directly in your browser.</p>
	</div>

	<!-- VIDEO STUDIO -->
	<div class="studio">
		<div class="canvas-container">
			<span class="overlay-text" id="canvas-placeholder">Preview will render here during MP4 compilation...</span>
			<canvas id="video-canvas" width="1280" height="720"></canvas>
		</div>

		<div class="progress-bar-container" id="progress-container">
			<div class="progress-bar" id="progress-bar"></div>
		</div>
		<div class="status-text" id="status-text">Compiling video...</div>

		<div class="controls">
			<label class="upload-btn">
				📁 Upload Custom Image
				<input type="file" id="file-upload" accept="image/*" multiple>
			</label>
			<button id="render-btn" onclick="generateMP4()">
				🎞️ Render & Download MP4 Video
			</button>
		</div>
	</div>

	<!-- STORYBOARD GALLERY -->
	<h2>Storyboard Queue (<span id="queue-count">0</span> images ready)</h2>
	<div id="gallery" class="gallery"></div>

	<script>
		const prompts = ${JSON.stringify(prompts)};
		const gallery = document.getElementById("gallery");
		const queueCountEl = document.getElementById("queue-count");
		
		// Holds HTMLImageElements ready for video production
		const activeSlides = [];

		// 1. Initialize UI Cards
		prompts.forEach((prompt, index) => {
			const card = document.createElement("div");
			card.className = "card";
			card.id = \`card-\${index}\`;

			card.innerHTML = \`
				<div class="image-container" id="container-\${index}">
					<div class="loading"><div class="spinner"></div>Generating AI Scene \${index + 1}...</div>
				</div>
				<div class="prompt" title="\${prompt}">\${index + 1}. \${prompt}</div>
				<div class="card-actions">
					<span style="font-size: 0.75rem; color: #6b7280;">AI Generated</span>
					<button class="toggle-btn" id="btn-\${index}" disabled onclick="toggleSlide(\${index})">Loading...</button>
				</div>
			\`;
			gallery.appendChild(card);
		});

		// 2. Fetch AI Images Asynchronously
		async function fetchAIImage(index) {
			const container = document.getElementById(\`container-\${index}\`);
			const btn = document.getElementById(\`btn-\${index}\`);
			const card = document.getElementById(\`card-\${index}\`);

			try {
				const response = await fetch(\`/image/\${index}\`);
				if (!response.ok) throw new Error("Failed");

				const blob = await response.blob();
				const url = URL.createObjectURL(blob);

				const img = new Image();
				img.src = url;
				await img.decode();

				container.innerHTML = "";
				container.appendChild(img);

				// Add to active video queue
				const slideObj = { id: \`ai-\${index}\`, img: img, cardId: \`card-\${index}\` };
				activeSlides.push(slideObj);
				
				card.classList.add("in-video");
				btn.textContent = "Remove from Video";
				btn.disabled = false;
				updateQueueCount();

			} catch (e) {
				container.innerHTML = \`<div style="color:#ef4444; font-size:0.8rem;">Generation Failed</div>\`;
			}
		}

		// Trigger all AI generations
		prompts.forEach((_, i) => fetchAIImage(i));

		// 3. Handle User Uploaded Images
		document.getElementById('file-upload').addEventListener('change', async (e) => {
			const files = Array.from(e.target.files);
			for (const file of files) {
				const url = URL.createObjectURL(file);
				const img = new Image();
				img.src = url;
				await img.decode();

				const customId = "custom-" + Date.now() + Math.random();
				const card = document.createElement("div");
				card.className = "card in-video";
				card.id = customId;
				card.innerHTML = \`
					<div class="badge">Custom Upload</div>
					<div class="image-container"><img src="\${url}"></div>
					<div class="prompt">\${file.name}</div>
					<div class="card-actions">
						<span style="font-size: 0.75rem; color: #10b981;">Ready</span>
						<button class="toggle-btn" onclick="removeCustomSlide('\${customId}')">Remove</button>
					</div>
				\`;
				gallery.prepend(card);
				activeSlides.unshift({ id: customId, img: img, cardId: customId });
				updateQueueCount();
			}
		});

		function toggleSlide(index) {
			const cardId = \`card-\${index}\`;
			const card = document.getElementById(cardId);
			const btn = document.getElementById(\`btn-\${index}\`);
			const existingIdx = activeSlides.findIndex(s => s.cardId === cardId);

			if (existingIdx > -1) {
				activeSlides.splice(existingIdx, 1);
				card.classList.remove("in-video");
				btn.textContent = "Add to Video";
			} else {
				const img = card.querySelector("img");
				activeSlides.push({ id: \`ai-\${index}\`, img: img, cardId: cardId });
				card.classList.add("in-video");
				btn.textContent = "Remove from Video";
			}
			updateQueueCount();
		}

		function removeCustomSlide(id) {
			const idx = activeSlides.findIndex(s => s.id === id);
			if (idx > -1) activeSlides.splice(idx, 1);
			document.getElementById(id).remove();
			updateQueueCount();
		}

		function updateQueueCount() {
			queueCountEl.textContent = activeSlides.length;
		}

		/*
		 * 4. MP4 VIDEO COMPILATION & KEN BURNS ANIMATION ENGINE
		 */
		async function generateMP4() {
			if (activeSlides.length === 0) {
				alert("Please wait for images to generate or upload your own!");
				return;
			}

			if (typeof VideoEncoder === "undefined") {
				alert("Your browser does not support WebCodecs API (VideoEncoder). Please use modern Chrome, Edge, or Safari.");
				return;
			}

			const renderBtn = document.getElementById("render-btn");
			const progressContainer = document.getElementById("progress-container");
			const progressBar = document.getElementById("progress-bar");
			const statusText = document.getElementById("status-text");
			const placeholder = document.getElementById("canvas-placeholder");
			const canvas = document.getElementById("video-canvas");
			const ctx = canvas.getContext("2d");

			renderBtn.disabled = true;
			placeholder.style.display = "none";
			progressContainer.style.display = "block";
			statusText.style.display = "block";

			// Video Settings
			const WIDTH = 1280;
			const HEIGHT = 720;
			const FPS = 30;
			const SECONDS_PER_SLIDE = 3.5;
			const FRAMES_PER_SLIDE = FPS * SECONDS_PER_SLIDE;
			const TOTAL_FRAMES = activeSlides.length * FRAMES_PER_SLIDE;

			// Initialize MP4 Muxer
			const muxer = new Mp4Muxer.Muxer({
				target: new Mp4Muxer.ArrayBufferTarget(),
				video: {
					codec: 'avc',
					width: WIDTH,
					height: HEIGHT
				},
				fastStart: 'in-memory'
			});

			// Initialize WebCodecs VideoEncoder
			const videoEncoder = new VideoEncoder({
				output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
				error: (e) => console.error(e)
			});

			videoEncoder.configure({
				codec: 'avc1.4d002a', // H.264 Main Profile
				width: WIDTH,
				height: HEIGHT,
				bitrate: 5_000_000,   // 5 Mbps high quality
				framerate: FPS
			});

			// Animation Types for slight movements
			const effects = ['slide-left', 'slide-right', 'slide-down', 'zoom-in'];

			let currentFrame = 0;

			for (let i = 0; i < activeSlides.length; i++) {
				const img = activeSlides[i].img;
				// Pick a slight animation effect for this slide
				const effect = effects[i % effects.length];

				for (let f = 0; f < FRAMES_PER_SLIDE; f++) {
					// Progress from 0.0 to 1.0
					const p = f / FRAMES_PER_SLIDE;
					// Smooth ease-out curve
					const ease = 1 - Math.pow(1 - p, 3); 

					ctx.fillStyle = "#000";
					ctx.fillRect(0, 0, WIDTH, HEIGHT);

					// Calculate Ken Burns coordinates
					// Base scale is 1.15x so we have room to slide/pan without showing black edges
					const zoomScale = 1.15; 
					const drawWidth = WIDTH * zoomScale;
					const drawHeight = HEIGHT * zoomScale;
					const overflowX = drawWidth - WIDTH;   // ~192px
					const overflowY = drawHeight - HEIGHT; // ~108px

					let dx = 0, dy = 0, dw = drawWidth, dh = drawHeight;

					if (effect === 'slide-left') {
						// Slowly pan from right edge to left edge
						dx = -overflowX * (1 - ease * 0.7);
						dy = -overflowY / 2;
					} 
					else if (effect === 'slide-right') {
						// Slowly pan from left edge to right edge
						dx = -overflowX * (ease * 0.7);
						dy = -overflowY / 2;
					} 
					else if (effect === 'slide-down') {
						// Slowly slide downwards
						dx = -overflowX / 2;
						dy = -overflowY * (ease * 0.8);
					} 
					else if (effect === 'zoom-in') {
						// Slowly scale up from 1.05x to 1.18x
						const currentScale = 1.05 + (ease * 0.13);
						dw = WIDTH * currentScale;
						dh = HEIGHT * currentScale;
						dx = (WIDTH - dw) / 2;
						dy = (HEIGHT - dh) / 2;
					}

					// Draw frame to canvas
					ctx.drawImage(img, dx, dy, dw, dh);

					// Slight fade-in/fade-out at the transitions (first/last 10 frames)
					if (f < 10) {
						ctx.fillStyle = \`rgba(0,0,0,\${1 - (f / 10)})\`;
						ctx.fillRect(0, 0, WIDTH, HEIGHT);
					} else if (f > FRAMES_PER_SLIDE - 10) {
						ctx.fillStyle = \`rgba(0,0,0,\${(f - (FRAMES_PER_SLIDE - 10)) / 10})\`;
						ctx.fillRect(0, 0, WIDTH, HEIGHT);
					}

					// Timestamp in microseconds required by VideoFrame
					const timestamp = (currentFrame * 1000 * 1000) / FPS;
					const frame = new VideoFrame(canvas, { timestamp });
					
					// Encode frame (insert keyframe every 2 seconds)
					videoEncoder.encode(frame, { keyFrame: currentFrame % (FPS * 2) === 0 });
					frame.close();

					currentFrame++;

					// Update UI Progress every 10 frames to keep UI responsive
					if (currentFrame % 10 === 0) {
						const percent = Math.round((currentFrame / TOTAL_FRAMES) * 100);
						progressBar.style.width = percent + "%";
						statusText.textContent = \`Rendering Frame \${currentFrame} / \${TOTAL_FRAMES} (\${percent}%)\`;
						await new Promise(r => setTimeout(r, 1)); // Yield to browser event loop
					}
				}
			}

			statusText.textContent = "Finalizing MP4 file...";
			await videoEncoder.flush();
			muxer.finalize();

			// Download the compiled MP4
			const buffer = muxer.target.buffer;
			const blob = new Blob([buffer], { type: 'video/mp4' });
			const url = URL.createObjectURL(blob);
			
			const a = document.createElement('a');
			a.href = url;
			a.download = \`Ghibli_Story_\${Date.now()}.mp4\`;
			a.click();
			URL.revokeObjectURL(url);

			// Reset UI
			statusText.textContent = "✅ MP4 Downloaded!";
			renderBtn.disabled = false;
		}
	</script>
</body>
</html>
	`;
				}
