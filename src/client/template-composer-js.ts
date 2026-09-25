/*
 * TEMPLATE_COMPOSER_JS — MODULE 9: the "Add video from
 * template" composer modal (5 TikTok designs, 1-25 s,
 * FFmpeg.wasm export, adds the MP4 into the accordion
 * gallery). Self-contained IIFE appended right after APP_JS
 * inside the same <script> tag.
 *
 * Verbatim copy; do not reformat the escapes.
 */

export const TEMPLATE_COMPOSER_JS = `	// =========================================================
	// MODULE 9: template-composer
	// =========================================================
	//
	// The "Add video from template" text link inside every
	// Video N accordion opens a modal that composes a
	// vertical 9:16 TikTok-style MP4 (max 25 seconds) from
	// up to 5 uploaded images using 5 design templates
	// (Full Focus, Split Story, Triple Stack, Photo Burst,
	// Film Strip) — the same composer as the standalone
	// "TikTok 5-Design Video Composer" page.
	//
	// The composed MP4 is added to that accordion's
	// Images / MP4s gallery as a normal MP4 asset, so it
	// plays inside the final render like any uploaded clip
	// (same 5-clip / 60-second caps apply).
	//
	// Everything lives inside an IIFE so none of the
	// composer's names (designs, draw, frame, cover, ...)
	// can collide with the studio's globals. Only
	// window.openTemplateModal / window.closeTemplateModal
	// are exposed for the accordion link.
	//
	// Export uses FFmpeg.wasm (loaded lazily from jsDelivr
	// with a dynamic import the first time Export MP4 is
	// clicked), exactly like the standalone composer.

	(function () {

		"use strict";

		const TPL_W =
			1080;

		const TPL_H =
			1920;

		const TPL_FPS =
			12;

		const TPL_MAX_DURATION =
			25;

		/*
		 * The modal is built once and then
		 * reused: closing only hides it, so the
		 * loaded images, chosen design, FFmpeg
		 * instance and last composed MP4 survive
		 * between opens (the link can retarget
		 * the modal at another Video N).
		 */

		let modal =
			null;

		let modalVideo =
			0;

		let canvas =
			null;

		let ctx =
			null;

		let thumbsHost =
			null;

		let titleEl =
			null;

		let statusEl =
			null;

		let progressEl =
			null;

		let durationEl =
			null;

		let exportBtn =
			null;

		let addBtn =
			null;

		let downloadHost =
			null;

		let headlineEl =
			null;

		let subtextEl =
			null;

		let headlineSizeEl =
			null;

		let subSizeEl =
			null;

		let textColorEl =
			null;

		let fontEl =
			null;

		let bgModeEl =
			null;

		let bgColorEl =
			null;

		let bgBlurEl =
			null;

		let bgOpacityEl =
			null;

		let images =
			[];

		let imageUrls =
			[];

		let selectedDesign =
			0;

		let duration =
			10;

		let playing =
			false;

		let playStart =
			0;

		let raf =
			0;

		let backgroundImage =
			null;

		let backgroundObjectUrl =
			null;

		let ffmpeg =
			null;

		let ffmpegLoaded =
			false;

		let fetchFileFn =
			null;

		/*
		 * Result of the last successful export:
		 * { blob, url, duration, name }.
		 */

		let lastVideo =
			null;

		const designs = [
			{
				name: "Full Focus",
				desc: "One hero photo with cinematic zoom",
				fn: drawFullFocus
			},
			{
				name: "Split Story",
				desc: "Two-photo vertical story layout",
				fn: drawSplitStory
			},
			{
				name: "Triple Stack",
				desc: "Three stacked photo moments",
				fn: drawTripleStack
			},
			{
				name: "Photo Burst",
				desc: "Five framed photos with magazine energy",
				fn: drawPhotoBurst
			},
			{
				name: "Film Strip",
				desc: "Main photo with moving film-strip accents",
				fn: drawFilmStrip
			}
		];

		// -------------------------------------------------
		// Drawing helpers (same maths as the standalone
		// composer, drawing into the modal's 1080x1920
		// canvas context).
		// -------------------------------------------------

		function clamp(v, a, b) {
			return Math.max(a, Math.min(b, v));
		}

		function cover(img, x, y, w, h, zoom) {

			if (zoom === undefined) {
				zoom = 1;
			}

			const s =
				Math.max(
					w / img.width,
					h / img.height
				) * zoom;

			const dw =
				img.width * s;

			const dh =
				img.height * s;

			const sx =
				x + (w - dw) / 2;

			const sy =
				y + (h - dh) / 2;

			ctx.drawImage(
				img,
				sx,
				sy,
				dw,
				dh
			);
		}

		function frame(img, x, y, w, h, zoom, border) {

			if (zoom === undefined) {
				zoom = 1;
			}

			if (border === undefined) {
				border = 24;
			}

			ctx.save();

			ctx.shadowColor =
				"rgba(0,0,0,.38)";

			ctx.shadowBlur =
				28;

			ctx.shadowOffsetY =
				15;

			ctx.fillStyle =
				"#fff";

			ctx.fillRect(x, y, w, h);

			ctx.restore();

			ctx.save();

			ctx.beginPath();

			ctx.rect(
				x + border,
				y + border,
				w - border * 2,
				h - border * 2
			);

			ctx.clip();

			cover(
				img,
				x + border,
				y + border,
				w - border * 2,
				h - border * 2,
				zoom
			);

			ctx.restore();
		}

		function drawBackground() {

			/*
			 * Default background: the first
			 * uploaded image, blurred and
			 * translucent. Can be switched to a
			 * solid color or a separate uploaded
			 * photo.
			 */

			const mode =
				bgModeEl.value;

			const color =
				bgColorEl.value;

			const blur =
				Number(bgBlurEl.value || 0);

			const opacity =
				Number(bgOpacityEl.value || 45) / 100;

			ctx.save();

			ctx.clearRect(0, 0, TPL_W, TPL_H);

			if (mode === "color") {

				ctx.fillStyle =
					color;

				ctx.fillRect(0, 0, TPL_W, TPL_H);

			}
			else {

				ctx.fillStyle =
					"#111";

				ctx.fillRect(0, 0, TPL_W, TPL_H);

				const img =
					(mode === "upload" && backgroundImage)
						? backgroundImage
						: images[0];

				if (img) {

					ctx.globalAlpha =
						opacity;

					ctx.filter =
						"blur(" + blur + "px)";

					/*
					 * Oversize the background
					 * slightly so the blur never
					 * exposes transparent edges.
					 */
					cover(
						img,
						-40,
						-40,
						TPL_W + 80,
						TPL_H + 80,
						1.05
					);

					ctx.filter =
						"none";

					ctx.globalAlpha =
						1;

					/*
					 * Gentle dark overlay keeps
					 * foreground photos and text
					 * readable.
					 */
					ctx.fillStyle =
						"rgba(0,0,0,.28)";

					ctx.fillRect(0, 0, TPL_W, TPL_H);
				}
			}

			ctx.restore();
		}

		function safe(i) {
			return images[i % images.length];
		}

		function textOverlay(t) {

			const fade =
				Math.min(
					1,
					t / 0.6,
					(duration - t) / 0.8
				);

			ctx.save();

			ctx.globalAlpha =
				clamp(fade, 0, 1);

			ctx.textAlign =
				"center";

			ctx.fillStyle =
				textColorEl.value;

			ctx.shadowColor =
				"#000b";

			ctx.shadowBlur =
				18;

			ctx.font =
				"800 " + headlineSizeEl.value +
				"px " + fontEl.value;

			ctx.fillText(
				headlineEl.value,
				TPL_W / 2,
				150
			);

			ctx.font =
				"600 " + subSizeEl.value +
				"px " + fontEl.value;

			ctx.fillStyle =
				"rgba(255,255,255,.92)";

			ctx.fillText(
				subtextEl.value,
				TPL_W / 2,
				215
			);

			ctx.restore();
		}

		// -------------------------------------------------
		// The five design templates.
		// -------------------------------------------------

		function drawFullFocus(t) {

			drawBackground();

			const z =
				1 + 0.09 * clamp(t / duration, 0, 1);

			ctx.save();

			ctx.globalAlpha =
				0.28;

			cover(safe(0), 0, 0, TPL_W, TPL_H, z * 0.94);

			ctx.restore();

			frame(safe(0), 95, 310, 890, 1210, z, 30);

			textOverlay(t);
		}

		function drawSplitStory(t) {

			drawBackground();

			const a =
				safe(0);

			const b =
				safe(1);

			frame(
				a,
				75,
				270,
				930,
				720,
				1 + 0.08 * clamp(t / duration, 0, 1),
				26
			);

			frame(
				b,
				75,
				1015,
				930,
				720,
				1 + 0.10 * clamp(
					Math.max(0, t - 1) /
					Math.max(1, duration - 1),
					0,
					1
				),
				26
			);

			textOverlay(t);
		}

		function drawTripleStack(t) {

			drawBackground();

			const ys =
				[270, 800, 1330];

			for (let i = 0; i < 3; i++) {

				frame(
					safe(i),
					85,
					ys[i],
					910,
					470,
					1 + 0.07 * clamp(
						(t - i * 0.7) /
						Math.max(1, duration - 1),
						0,
						1
					),
					22
				);
			}

			textOverlay(t);
		}

		function drawPhotoBurst(t) {

			drawBackground();

			const specs = [
				[95, 300, 430, 520, -0.08],
				[555, 260, 430, 520, 0.07],
				[165, 870, 430, 520, 0.05],
				[585, 900, 430, 520, -0.06],
				[325, 1420, 430, 360, 0.015]
			];

			specs.forEach((p, i) => {

				ctx.save();

				ctx.translate(
					p[0] + p[2] / 2,
					p[1] + p[3] / 2
				);

				ctx.rotate(p[4]);

				frame(
					safe(i),
					-p[2] / 2,
					-p[3] / 2,
					p[2],
					p[3],
					1 + 0.06 * clamp(
						(t - i * 0.5) /
						Math.max(1, duration - 1),
						0,
						1
					),
					22
				);

				ctx.restore();
			});

			textOverlay(t);
		}

		function drawFilmStrip(t) {

			drawBackground();

			const main =
				safe(0);

			const z =
				1 + 0.11 * clamp(t / duration, 0, 1);

			frame(main, 150, 360, 780, 1080, z, 30);

			ctx.save();

			ctx.globalAlpha =
				0.9;

			const speed =
				180 * (t % duration);

			for (let i = 0; i < 5; i++) {

				const x =
					((i * 250 - speed) % (TPL_W + 300)) - 150;

				frame(safe(i), x, 150, 190, 260, 1, 16);

				frame(safe(i), x, 1510, 190, 260, 1, 16);
			}

			ctx.restore();

			textOverlay(t);
		}

		// -------------------------------------------------
		// Design picker cards (miniature previews of each
		// layout using the loaded images).
		// -------------------------------------------------

		function renderDesignCards() {

			thumbsHost.innerHTML =
				"";

			designs.forEach((d, i) => {

				const el =
					document.createElement("div");

				el.className =
					"tpl-design" +
					(i === selectedDesign ? " selected" : "");

				const c =
					document.createElement("canvas");

				c.width =
					180;

				c.height =
					320;

				el.appendChild(c);

				const label =
					document.createElement("b");

				label.textContent =
					(i + 1) + ". " + d.name;

				el.appendChild(label);

				const sm =
					document.createElement("small");

				sm.textContent =
					d.desc;

				el.appendChild(sm);

				el.onclick = () => {

					selectedDesign =
						i;

					const all =
						thumbsHost.querySelectorAll(
							".tpl-design"
						);

					for (const x of all) {

						x.classList.remove(
							"selected"
						);
					}

					el.classList.add(
						"selected"
					);

					draw(0);
				};

				thumbsHost.appendChild(el);

				const ti =
					c.getContext("2d");

				ti.clearRect(0, 0, c.width, c.height);

				ti.fillStyle =
					"#161616";

				ti.fillRect(0, 0, c.width, c.height);

				if (images.length) {

					const positions = [
						[[0, 55, 180, 205]],
						[[8, 45, 164, 110], [8, 168, 164, 110]],
						[[8, 35, 164, 78], [8, 121, 164, 78], [8, 207, 164, 78]],
						[[12, 40, 72, 100], [96, 32, 72, 105], [22, 155, 72, 100], [91, 160, 72, 100], [54, 235, 72, 68]],
						[[38, 70, 104, 145], [0, 15, 32, 45], [148, 15, 32, 45], [0, 260, 32, 45], [148, 260, 32, 45]]
					][i];

					positions.forEach((q, j) => {

						const im =
							images[j % images.length];

						const s =
							Math.max(
								q[2] / im.width,
								q[3] / im.height
							);

						const dw =
							im.width * s;

						const dh =
							im.height * s;

						ti.fillStyle =
							"#fff";

						ti.fillRect(
							q[0] - 3,
							q[1] - 3,
							q[2] + 6,
							q[3] + 6
						);

						ti.save();

						ti.beginPath();

						ti.rect(q[0], q[1], q[2], q[3]);

						ti.clip();

						ti.drawImage(
							im,
							q[0] + (q[2] - dw) / 2,
							q[1] + (q[3] - dh) / 2,
							dw,
							dh
						);

						ti.restore();
					});
				}

				ti.fillStyle =
					"#fff";

				ti.font =
					"bold 11px Arial";

				ti.textAlign =
					"center";

				ti.fillText(d.name, 90, 310);
			});
		}

		// -------------------------------------------------
		// Preview engine.
		// -------------------------------------------------

		function draw(t) {

			if (t === undefined) {
				t = 0;
			}

			ctx.clearRect(0, 0, TPL_W, TPL_H);

			if (!images.length) {

				drawBackground();

				ctx.fillStyle =
					"#fff";

				ctx.textAlign =
					"center";

				ctx.font =
					"700 54px Arial";

				ctx.fillText(
					"Choose your photos",
					TPL_W / 2,
					TPL_H / 2
				);

				return;
			}

			designs[selectedDesign].fn(t);
		}

		function loop(now) {

			if (!playing) {
				return;
			}

			const t =
				(now - playStart) / 1000;

			if (t >= duration) {

				playing =
					false;

				draw(duration);

				progressEl.style.width =
					"100%";

				return;
			}

			progressEl.style.width =
				(t / duration * 100) + "%";

			draw(t);

			raf =
				requestAnimationFrame(loop);
		}

		function startPreview() {

			if (!images.length) {
				return;
			}

			cancelAnimationFrame(raf);

			playing =
				true;

			playStart =
				performance.now();

			progressEl.style.width =
				"0%";

			raf =
				requestAnimationFrame(loop);
		}

		function stopPreview() {

			playing =
				false;

			cancelAnimationFrame(raf);

			draw(0);

			progressEl.style.width =
				"0%";
		}

		// -------------------------------------------------
		// Inputs.
		// -------------------------------------------------

		async function onTplFiles(event) {

			const files =
				Array.from(
					event.target.files || []
				).slice(0, 5);

			/*
			 * Allows the same file to be
			 * selected again later.
			 */
			event.target.value =
				"";

			if (!files.length) {
				return;
			}

			for (const u of imageUrls) {

				URL.revokeObjectURL(u);
			}

			imageUrls =
				[];

			images =
				[];

			for (const f of files) {

				const u =
					URL.createObjectURL(f);

				imageUrls.push(u);

				const im =
					new Image();

				im.src =
					u;

				await im.decode();

				images.push(im);
			}

			statusEl.textContent =
				images.length +
				" image" +
				(images.length === 1 ? "" : "s") +
				" loaded \u00b7 " +
				designs[selectedDesign].name;

			exportBtn.disabled =
				images.length === 0;

			renderDesignCards();

			draw(0);
		}

		async function onTplBackgroundFile(event) {

			const file =
				event.target.files &&
				event.target.files[0];

			if (!file) {
				return;
			}

			if (backgroundObjectUrl) {

				URL.revokeObjectURL(
					backgroundObjectUrl
				);
			}

			backgroundObjectUrl =
				URL.createObjectURL(file);

			const im =
				new Image();

			im.src =
				backgroundObjectUrl;

			await im.decode();

			backgroundImage =
				im;

			bgModeEl.value =
				"upload";

			draw(0);
		}

		// -------------------------------------------------
		// Export (FFmpeg.wasm, loaded on first export).
		// -------------------------------------------------

		async function loadFFmpeg() {

			if (ffmpegLoaded) {
				return;
			}

			statusEl.textContent =
				"Loading FFmpeg\u2026";

			const ffmpegMod =
				await import(
					"https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js"
				);

			const utilMod =
				await import(
					"https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js"
				);

			ffmpeg =
				new ffmpegMod.FFmpeg();

			const base =
				"https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

			await ffmpeg.load({
				coreURL:
					await utilMod.toBlobURL(
						base + "/ffmpeg-core.js",
						"text/javascript"
					),
				wasmURL:
					await utilMod.toBlobURL(
						base + "/ffmpeg-core.wasm",
						"application/wasm"
					)
			});

			fetchFileFn =
				utilMod.fetchFile;

			ffmpegLoaded =
				true;
		}

		async function exportMP4() {

			if (!images.length) {
				return;
			}

			exportBtn.disabled =
				true;

			addBtn.disabled =
				true;

			playing =
				false;

			cancelAnimationFrame(raf);

			downloadHost.innerHTML =
				"";

			try {

				await loadFFmpeg();

				const total =
					Math.ceil(duration * TPL_FPS);

				statusEl.textContent =
					"Rendering " + total + " frames\u2026";

				for (let i = 0; i < total; i++) {

					draw(i / TPL_FPS);

					const blob =
						await new Promise(
							(r) =>
								canvas.toBlob(
									r,
									"image/jpeg",
									0.82
								)
						);

					await ffmpeg.writeFile(
						"frame_" +
						String(i).padStart(5, "0") +
						".jpg",
						await fetchFileFn(blob)
					);

					progressEl.style.width =
						((i + 1) / total * 70) + "%";
				}

				statusEl.textContent =
					"Encoding MP4\u2026";

				await ffmpeg.exec([
					"-y",
					"-framerate", String(TPL_FPS),
					"-i", "frame_%05d.jpg",
					"-c:v", "libx264",
					"-preset", "ultrafast",
					"-crf", "25",
					"-pix_fmt", "yuv420p",
					"-movflags", "+faststart",
					"output.mp4"
				]);

				const data =
					await ffmpeg.readFile(
						"output.mp4"
					);

				const blob =
					new Blob(
						[data.buffer],
						{ type: "video/mp4" }
					);

				const name =
					"template_" +
					designs[selectedDesign]
						.name
						.toLowerCase()
						.replaceAll(" ", "_") +
					".mp4";

				const url =
					URL.createObjectURL(blob);

				lastVideo = {
					blob: blob,
					url: url,
					duration: duration,
					name: name
				};

				const a =
					document.createElement("a");

				a.className =
					"tpl-download";

				a.href =
					url;

				a.download =
					name;

				a.textContent =
					"Download MP4";

				downloadHost.appendChild(a);

				progressEl.style.width =
					"100%";

				statusEl.textContent =
					"MP4 ready \u2014 add it to Video " +
					modalVideo + " or download it";

				addBtn.disabled =
					false;

				addBtn.textContent =
					"\u2795 Add to Video " + modalVideo;

				for (let i = 0; i < total; i++) {

					try {

						await ffmpeg.deleteFile(
							"frame_" +
							String(i).padStart(5, "0") +
							".jpg"
						);
					}
					catch (cleanupError) { }
				}

				try {

					await ffmpeg.deleteFile(
						"output.mp4"
					);
				}
				catch (cleanupError) { }
			}
			catch (err) {

				console.error(err);

				statusEl.textContent =
					"Export failed: " +
					((err && err.message) || err);

				alert(
					"FFmpeg export failed. If this is the first export, reload the page and try again. Details: " +
					((err && err.message) || err)
				);
			}
			finally {

				exportBtn.disabled =
					images.length === 0;
			}
		}

		// -------------------------------------------------
		// Add the composed MP4 to the target Video N as a
		// normal gallery asset (same shape + caps as an
		// uploaded MP4 clip).
		// -------------------------------------------------

		async function addTemplateToVideo() {

			if (!lastVideo) {
				return;
			}

			const n =
				modalVideo;

			const project =
				videoProjects[n - 1];

			if (!project) {
				return;
			}

			const counts =
				videoCounts(project);

			if (counts.clips >= MAX_MP4_UPLOADS) {

				alert(
					"Video " + n +
					": you can add at most " +
					MAX_MP4_UPLOADS +
					" MP4 clips."
				);

				return;
			}

			addBtn.disabled =
				true;

			statusEl.textContent =
				"Adding the composed MP4 to Video " + n + "\u2026";

			const file =
				new File(
					[lastVideo.blob],
					lastVideo.name,
					{ type: "video/mp4" }
				);

			const probed =
				document.createElement("video");

			probed.muted =
				true;

			probed.playsInline =
				true;

			probed.src =
				lastVideo.url;

			try {

				await new Promise(
					(resolve, reject) => {

						probed.addEventListener(
							"loadedmetadata",
							resolve,
							{ once: true }
						);

						probed.addEventListener(
							"error",
							reject,
							{ once: true }
						);
					}
				);
			}
			catch (probeError) {

				addBtn.disabled =
					false;

				statusEl.textContent =
					"MP4 ready";

				alert(
					"The composed file could not be read as an MP4 clip."
				);

				return;
			}

			const clipDuration =
				probed.duration;

			if (clipDuration > MP4_MAX_DURATION_S) {

				addBtn.disabled =
					false;

				statusEl.textContent =
					"MP4 ready";

				alert(
					"The composed file is " +
					formatSeconds(clipDuration) +
					" long. Each MP4 clip must be at most " +
					formatSeconds(MP4_MAX_DURATION_S) +
					"."
				);

				return;
			}

			probed.loop =
				true;

			const asset = {
				kind: "mp4",
				file: file,
				videoEl: probed,
				duration: clipDuration,
				url: lastVideo.url,
				card: null
			};

			project.assets.push(asset);

			buildVaCard(n, asset);

			updateVideoStatus(n);

			/*
			 * Make sure the new card is
			 * actually visible: expand the
			 * accordion and its gallery if
			 * either is collapsed.
			 */

			const body =
				document.getElementById(
					"va-body-" + n
				);

			if (
				body &&
				body.style.display === "none"
			) {

				toggleVideoAccordion(n);
			}

			const gallery =
				document.getElementById(
					"va-gallery-" + n
				);

			if (
				gallery &&
				gallery.style.display === "none"
			) {

				toggleGalleryScroll(n);
			}

			addBtn.textContent =
				"\u2705 Added to Video " + n;

			statusEl.textContent =
				"Added to Video " + n +
				" (" + formatSeconds(clipDuration) + ")" +
				" \u2014 it plays in the final render like any other MP4 clip";
		}

		// -------------------------------------------------
		// Modal build / open / close.
		// -------------------------------------------------

		function buildModal(n) {

			modal =
				document.createElement("div");

			modal.id =
				"tpl-modal";

			modal.className =
				"modal-overlay";

			modal.innerHTML =
				'<div class="tpl-box">' +
				'<div class="tpl-head">' +
				'<div class="modal-title" id="tpl-title">\ud83c\udfac Add Video from Template \u2014 Video ' + n + '</div>' +
				'<button type="button" class="tpl-x" id="tpl-x" title="Close">\u2715</button>' +
				'</div>' +
				'<p class="tpl-sub">Upload up to 5 images, choose one of the five TikTok designs, preview it, then export a vertical 9:16 MP4 (max ' + TPL_MAX_DURATION + ' seconds). The composed clip is added to this video\u2019s Images / MP4s gallery and plays inside the final render like any uploaded MP4.</p>' +
				'<div class="tpl-controls">' +
				'<label class="tpl-file">Choose 1\u20135 images<input id="tpl-files" type="file" accept="image/*" multiple></label>' +
				'<label class="tpl-len">Length <input id="tpl-duration" type="number" min="1" max="25" value="10"></label>' +
				'<button type="button" id="tpl-play">\u25b6 Preview</button>' +
				'<button type="button" id="tpl-stop">\u25a0 Stop</button>' +
				'<button type="button" id="tpl-export" class="tpl-primary" disabled>Export MP4</button>' +
				'<span id="tpl-status" class="tpl-status">Choose images first</span>' +
				'</div>' +
				'<div class="tpl-designs" id="tpl-designs"></div>' +
				'<div class="tpl-editor">' +
				'<div class="tpl-row">' +
				'<input id="tpl-headline" type="text" value="GOOD VIBES" placeholder="Headline">' +
				'<input id="tpl-subtext" type="text" value="NEW ADVENTURES" placeholder="Subtext">' +
				'<input id="tpl-headline-size" type="number" min="30" max="180" value="82" title="Headline size">' +
				'<input id="tpl-sub-size" type="number" min="20" max="100" value="42" title="Subtext size">' +
				'<input id="tpl-text-color" type="color" value="#ffffff" title="Text color">' +
				'<select id="tpl-font"><option>Arial</option><option>Georgia</option><option>Impact</option><option>Trebuchet MS</option><option>Courier New</option></select>' +
				'<select id="tpl-bg-mode" title="Background">' +
				'<option value="image">First image</option>' +
				'<option value="color">Solid color</option>' +
				'<option value="upload">Uploaded photo</option>' +
				'</select>' +
				'<input id="tpl-bg-color" type="color" value="#161616" title="Background color">' +
				'<label class="tpl-file tpl-file-sm">Upload background<input id="tpl-bg-file" type="file" accept="image/*"></label>' +
				'<label class="tpl-range">Blur <input id="tpl-bg-blur" type="range" min="0" max="24" value="10"></label>' +
				'<label class="tpl-range">Opacity <input id="tpl-bg-opacity" type="range" min="0" max="100" value="45"></label>' +
				'</div>' +
				'</div>' +
				'<div class="tpl-stage">' +
				'<canvas id="tpl-canvas" width="1080" height="1920"></canvas>' +
				'</div>' +
				'<div class="tpl-timeline"><div class="tpl-progress" id="tpl-progress"></div></div>' +
				'<div class="tpl-tips">Tip: the default background uses the first uploaded image with blur and opacity. You can switch to a solid color or upload a separate background photo. The composed clip is silent \u2014 upload an MP3 in the accordion to give the final video sound.</div>' +
				'<div id="tpl-download"></div>' +
				'<div class="tpl-actions">' +
				'<button type="button" id="tpl-add" class="tpl-primary" disabled>\u2795 Add to Video ' + n + '</button>' +
				'<button type="button" id="tpl-close">\u2715 Close</button>' +
				'</div>' +
				'</div>';

			document.body.appendChild(modal);

			canvas =
				document.getElementById("tpl-canvas");

			ctx =
				canvas.getContext("2d");

			thumbsHost =
				document.getElementById("tpl-designs");

			titleEl =
				document.getElementById("tpl-title");

			statusEl =
				document.getElementById("tpl-status");

			progressEl =
				document.getElementById("tpl-progress");

			durationEl =
				document.getElementById("tpl-duration");

			exportBtn =
				document.getElementById("tpl-export");

			addBtn =
				document.getElementById("tpl-add");

			downloadHost =
				document.getElementById("tpl-download");

			headlineEl =
				document.getElementById("tpl-headline");

			subtextEl =
				document.getElementById("tpl-subtext");

			headlineSizeEl =
				document.getElementById("tpl-headline-size");

			subSizeEl =
				document.getElementById("tpl-sub-size");

			textColorEl =
				document.getElementById("tpl-text-color");

			fontEl =
				document.getElementById("tpl-font");

			bgModeEl =
				document.getElementById("tpl-bg-mode");

			bgColorEl =
				document.getElementById("tpl-bg-color");

			bgBlurEl =
				document.getElementById("tpl-bg-blur");

			bgOpacityEl =
				document.getElementById("tpl-bg-opacity");

			document.getElementById("tpl-files")
				.addEventListener("change", onTplFiles);

			document.getElementById("tpl-bg-file")
				.addEventListener("change", onTplBackgroundFile);

			durationEl.addEventListener(
				"change",
				() => {

					duration =
						clamp(
							Math.round(
								Number(durationEl.value) || 10
							),
							1,
							TPL_MAX_DURATION
						);

					durationEl.value =
						duration;
				}
			);

			const bgIds = [
				"tpl-bg-mode",
				"tpl-bg-color",
				"tpl-bg-blur",
				"tpl-bg-opacity"
			];

			for (const id of bgIds) {

				const el =
					document.getElementById(id);

				el.addEventListener(
					"input",
					() => draw(0)
				);

				el.addEventListener(
					"change",
					() => draw(0)
				);
			}

			const textIds = [
				"tpl-headline",
				"tpl-subtext",
				"tpl-headline-size",
				"tpl-sub-size",
				"tpl-text-color",
				"tpl-font"
			];

			for (const id of textIds) {

				document.getElementById(id)
					.addEventListener(
						"input",
						() => draw(0)
					);
			}

			document.getElementById("tpl-play")
				.addEventListener("click", startPreview);

			document.getElementById("tpl-stop")
				.addEventListener("click", stopPreview);

			exportBtn.addEventListener(
				"click",
				exportMP4
			);

			addBtn.addEventListener(
				"click",
				addTemplateToVideo
			);

			document.getElementById("tpl-close")
				.addEventListener("click", closeTemplateModal);

			document.getElementById("tpl-x")
				.addEventListener("click", closeTemplateModal);

			modal.addEventListener(
				"click",
				(e) => {

					if (e.target === modal) {

						closeTemplateModal();
					}
				}
			);

			document.addEventListener(
				"keydown",
				(e) => {

					if (
						e.key === "Escape" &&
						modal &&
						modal.style.display !== "none"
					) {

						closeTemplateModal();
					}
				}
			);

			renderDesignCards();

			draw(0);
		}

		function openTemplateModal(n) {

			const project =
				videoProjects[n - 1];

			if (!project) {
				return;
			}

			modalVideo =
				n;

			if (!modal) {

				buildModal(n);
			}
			else {

				titleEl.textContent =
					"\ud83c\udfac Add Video from Template \u2014 Video " + n;

				addBtn.textContent =
					"\u2795 Add to Video " + n;

				/*
				 * A previously composed MP4 can
				 * also be added to this video.
				 */
				if (lastVideo) {

					addBtn.disabled =
						false;
				}
			}

			modal.style.display =
				"flex";
		}

		function closeTemplateModal() {

			if (!modal) {
				return;
			}

			playing =
				false;

			cancelAnimationFrame(raf);

			modal.style.display =
				"none";
		}

		window.openTemplateModal =
			openTemplateModal;

		window.closeTemplateModal =
			closeTemplateModal;

	})();
`;
