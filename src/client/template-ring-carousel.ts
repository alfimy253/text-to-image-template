/*
 * 3D Ring Carousel — the only object ported from the uploaded
 * editorial_magazine_experience.html. The magazine page-flip view, audio,
 * ambient particles, Tailwind UI and sound controls are deliberately omitted.
 * It runs inside the composer IIFE and uses the interactive-scene canvas and
 * WebCodecs exporter, so preview and MP4 frames share one deterministic renderer.
 */

export const TEMPLATE_RING_CAROUSEL_JS = `
		// =========================================================
		// INTERACTIVE SCENE: 3D RING CAROUSEL (8 editorial cards)
		// =========================================================
		const RING_CAROUSEL_SCENE = {
			name: "3D Ring Carousel",
			style: "editorial",
			text: "",
			sub: "Eight editorial cards on an auto-rotating 3D ring.",
			image: 0,
			graphic: "none",
			reelScene: true,
			ringCarousel: true
		};
		REEL_SCENES.push(RING_CAROUSEL_SCENE);

		const RING_CAROUSEL_IMAGE_URLS = [
			"https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=800&q=80",
			"https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80",
			"https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=800&q=80",
			"https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=800&q=80",
			"https://images.unsplash.com/photo-1500917293891-ef795e70e1f6?auto=format&fit=crop&w=800&q=80",
			"https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&w=800&q=80",
			"https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=800&q=80",
			"https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=800&q=80"
		];
		let ringCarouselImages = [];
		let ringCarouselImagesReady = null;

		function ringEnsureImages() {
			if (ringCarouselImagesReady) return ringCarouselImagesReady;
			ringCarouselImages = RING_CAROUSEL_IMAGE_URLS.map(function (url) {
				const image = new Image();
				image.crossOrigin = "anonymous";
				const ready = new Promise(function (resolve) {
					let settled = false;
					let timeoutId = 0;
					const finish = function () {
						if (settled) return;
						settled = true;
						if (timeoutId) clearTimeout(timeoutId);
						resolve(image);
					};
					image.onload = finish;
					image.onerror = function () {
						image.__ringFailed = true;
						finish();
					};
					timeoutId = setTimeout(function () {
						image.__ringFailed = true;
						finish();
					}, 8000);
					image.src = url;
					if (image.complete) Promise.resolve().then(finish);
				});
				image.__ringReady = ready;
				return image;
			});
			ringCarouselImagesReady = Promise.all(ringCarouselImages.map(function (image) { return image.__ringReady; }));
			return ringCarouselImagesReady;
		}

		function ringCarouselElement() {
			return {
				type: "carousel",
				label: "3D Ring Carousel",
				x: 50,
				y: 52,
				size: 100,
				radius: 100,
				tilt: -6,
				speed: 1,
				visible: true,
				deleted: false
			};
		}

		const ringBaseSceneDefaultState = reelSceneDefaultState;
		reelSceneDefaultState = function (index) {
			const scene = REEL_SCENES[index];
			if (scene && scene.ringCarousel) {
				return {
					style: "editorial",
					background: {
						image: "mood:0",
						effect: "none",
						speed: 1,
						transition: "none",
						transitionSpeed: 1
					},
					elements: { carousel: ringCarouselElement() }
				};
			}
			return ringBaseSceneDefaultState(index);
		};

		function ringRoundedRect(context, x, y, width, height, radius) {
			const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
			context.beginPath();
			context.moveTo(x + r, y);
			context.lineTo(x + width - r, y);
			context.quadraticCurveTo(x + width, y, x + width, y + r);
			context.lineTo(x + width, y + height - r);
			context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
			context.lineTo(x + r, y + height);
			context.quadraticCurveTo(x, y + height, x, y + height - r);
			context.lineTo(x, y + r);
			context.quadraticCurveTo(x, y, x + r, y);
			context.closePath();
		}

		function ringDrawImageCover(context, image, x, y, width, height) {
			if (!image || !image.naturalWidth || image.__ringFailed) return false;
			const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
			const drawWidth = image.naturalWidth * scale;
			const drawHeight = image.naturalHeight * scale;
			context.drawImage(
				image,
				x + (width - drawWidth) / 2,
				y + (height - drawHeight) / 2,
				drawWidth,
				drawHeight
			);
			return true;
		}

		function ringDrawFallback(context, x, y, width, height, index) {
			const gradient = context.createLinearGradient(x, y, x + width, y + height);
			const palettes = [
				["#3b2f2f", "#c39a6b"], ["#20262a", "#728c85"],
				["#27232e", "#9d7b8f"], ["#262b35", "#b7a58a"]
			];
			const palette = palettes[index % palettes.length];
			gradient.addColorStop(0, palette[0]);
			gradient.addColorStop(1, palette[1]);
			context.fillStyle = gradient;
			context.fillRect(x, y, width, height);
			context.save();
			context.globalAlpha *= 0.24;
			context.strokeStyle = "#ffffff";
			context.lineWidth = Math.max(0.6, width * 0.018);
			for (let line = -2; line < 7; line++) {
				context.beginPath();
				context.moveTo(x + line * width * 0.22, y + height);
				context.lineTo(x + (line + 3) * width * 0.22, y);
				context.stroke();
			}
			context.restore();
		}

		function ringDrawCard(context, image, card, base, index) {
			const x = card.screenX - card.width / 2;
			const y = card.screenY - card.height / 2;
			const radius = Math.max(1, 12 * base * card.perspective);
			context.save();
			context.globalAlpha = card.alpha;
			context.shadowColor = "rgba(0,0,0,0.72)";
			context.shadowBlur = Math.max(2, 28 * base * card.perspective);
			context.shadowOffsetY = Math.max(1, 15 * base * card.perspective);
			ringRoundedRect(context, x, y, card.width, card.height, radius);
			context.fillStyle = "#121216";
			context.fill();
			context.restore();

			context.save();
			context.globalAlpha = card.alpha;
			ringRoundedRect(context, x, y, card.width, card.height, radius);
			context.clip();
			if (!ringDrawImageCover(context, image, x, y, card.width, card.height)) {
				ringDrawFallback(context, x, y, card.width, card.height, index);
			}
			const shade = context.createLinearGradient(x, y, x, y + card.height);
			shade.addColorStop(0, "rgba(0,0,0,0.18)");
			shade.addColorStop(0.52, "rgba(0,0,0,0)");
			shade.addColorStop(1, "rgba(0,0,0,0.68)");
			context.fillStyle = shade;
			context.fillRect(x, y, card.width, card.height);
			if (card.width > 28 && card.height > 42) {
				const fontSize = Math.max(5, 9 * base * card.perspective);
				context.font = "600 " + fontSize + "px Montserrat, Arial, sans-serif";
				context.textAlign = "left";
				context.textBaseline = "middle";
				context.fillStyle = "#f5d88f";
				context.fillText("L'Élite Collection", x + card.width * 0.07, y + card.height * 0.91, card.width * 0.86);
			}
			context.restore();

			context.save();
			context.globalAlpha = card.alpha;
			ringRoundedRect(context, x, y, card.width, card.height, radius);
			context.strokeStyle = "rgba(255,255,255,0.24)";
			context.lineWidth = Math.max(0.5, base * card.perspective);
			context.stroke();
			context.restore();
		}

		function ringDrawCarousel(context, width, height, time, scene, state, showSelection) {
			const scale = width / 1120;
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.filter = "none";
			context.globalAlpha = 1;
			context.globalCompositeOperation = "source-over";
			context.clearRect(0, 0, width, height);
			context.fillStyle = "#08080a";
			context.fillRect(0, 0, width, height);

			const element = state.elements.carousel || ringCarouselElement();
			const centerX = width * (Number(element.x) / 100);
			const centerY = height * (Number(element.y) / 100);
			const halo = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.62);
			halo.addColorStop(0, "rgba(245,158,11,0.12)");
			halo.addColorStop(0.52, "rgba(61,45,35,0.08)");
			halo.addColorStop(1, "rgba(0,0,0,0.46)");
			context.fillStyle = halo;
			context.fillRect(0, 0, width, height);

			const base = Math.min(width / 1200, height / 700);
			context.save();
			context.globalAlpha = 0.34;
			context.fillStyle = "#000000";
			context.beginPath();
			context.ellipse(centerX, centerY + 210 * base, 410 * base, 62 * base, 0, 0, Math.PI * 2);
			context.fill();
			context.restore();

			const hitAreas = [{ key: "carousel", x: 0, y: 0, width: width, height: height }];
			reelSceneHitAreas = hitAreas;
			if (element.visible && !element.deleted) {
				const images = ringCarouselImagesReady ? ringCarouselImages : [];
				const rotation = time * 21 * (Number(element.speed) || 0) * Math.PI / 180;
				const tilt = (Number(element.tilt) || 0) * Math.PI / 180;
				const radius = 380 * ((Number(element.radius) || 100) / 100);
				const cards = RING_CAROUSEL_IMAGE_URLS.map(function (_, index) {
					const angle = index / RING_CAROUSEL_IMAGE_URLS.length * Math.PI * 2 + rotation;
					const xBase = Math.sin(angle) * radius;
					const zBase = Math.cos(angle) * radius;
					const yBase = Math.sin(tilt) * zBase;
					const zTilt = Math.cos(tilt) * zBase;
					const perspective = Math.max(0.18, Math.min(3, 1200 / Math.max(240, 1200 - zTilt)));
					const depth = Math.max(0, Math.min(1, (zTilt + radius) / Math.max(1, radius * 2)));
					return {
						index: index,
						z: zTilt,
						perspective: perspective,
						screenX: centerX + xBase * base * perspective,
						screenY: centerY + yBase * base * perspective,
						width: 240 * ((Number(element.size) || 100) / 100) * base * perspective * Math.max(0.055, Math.abs(Math.cos(angle))),
						height: 344 * ((Number(element.size) || 100) / 100) * base * perspective,
						alpha: 0.46 + depth * 0.54
					};
				});
				cards.sort(function (a, b) { return a.z - b.z; });
				cards.forEach(function (card) {
					const image = images[card.index];
					ringDrawCard(context, image, card, base, card.index);
				});
			}
			if (showSelection) reelDrawSelection(context, hitAreas, "carousel", width, height, scale);
		}

		const ringBaseDrawScene = reelDrawScene;
		reelDrawScene = function (context, width, height, time, scene, state, showSelection) {
			if (scene && scene.ringCarousel) {
				ringDrawCarousel(context, width, height, time, scene, state, showSelection);
				return;
			}
			return ringBaseDrawScene(context, width, height, time, scene, state, showSelection);
		};

		const ringBaseRenderSceneControls = reelRenderSceneControls;
		reelRenderSceneControls = function () {
			const scene = REEL_SCENES[reelSceneIndex];
			const addButton = document.getElementById("tm-scene-add-text");
			if (!scene || !scene.ringCarousel) {
				if (addButton) addButton.style.display = "";
				return ringBaseRenderSceneControls();
			}
			const state = reelSelectedState();
			const element = state.elements.carousel;
			const objectsHost = document.getElementById("tm-scene-objects");
			const inspector = document.getElementById("tm-scene-inspector");
			const badge = document.getElementById("tm-scene-selection-badge");
			if (!objectsHost || !inspector || !element) return;
			reelSelectedElement = "carousel";
			if (addButton) addButton.style.display = "none";
			objectsHost.innerHTML = "";
			const tag = reelButton("3D Ring Carousel", "tm-scene-object selected", function () {
				reelSelectSceneElement("carousel");
			});
			tag.setAttribute("aria-pressed", "true");
			objectsHost.appendChild(tag);
			if (badge) badge.textContent = "3D Ring Carousel selected · drag to move";
			inspector.innerHTML = "";
			const heading = document.createElement("div");
			heading.className = "tm-scene-inspector-title";
			heading.textContent = "3D Ring Carousel";
			inspector.appendChild(heading);
			const note = document.createElement("div");
			note.className = "tm-scene-subtitle";
			note.textContent = "8 editorial cards · ring only · no particles";
			inspector.appendChild(note);
			reelAddCheckbox(inspector, "Visible", element.visible, function (value) { element.visible = value; reelRedrawScene(); });
			reelAddRange(inspector, "Rotation speed", element.speed, 0, 3, 0.05, function (value) { element.speed = value; reelRedrawScene(); }, "×");
			reelAddRange(inspector, "Ring radius", element.radius, 55, 145, 1, function (value) { element.radius = value; reelRedrawScene(); }, "%");
			reelAddRange(inspector, "Card size", element.size, 50, 150, 1, function (value) { element.size = value; reelRedrawScene(); }, "%");
			reelAddRange(inspector, "3D tilt", element.tilt, -30, 30, 1, function (value) { element.tilt = value; reelRedrawScene(); }, "°");
			reelAddRange(inspector, "X %", element.x, 0, 100, 1, function (value) { element.x = value; reelSyncPositionRanges(); reelRedrawScene(); }, "%");
			reelAddRange(inspector, "Y %", element.y, 0, 100, 1, function (value) { element.y = value; reelSyncPositionRanges(); reelRedrawScene(); }, "%");
			const reset = reelButton("Reset carousel", "tm-scene-secondary", function () {
				state.elements.carousel = ringCarouselElement();
				reelSelectedElement = "carousel";
				reelRenderSceneControls();
				reelRedrawScene();
			});
			inspector.appendChild(reset);
		};

		const ringBaseBuildSceneGallery = reelBuildSceneGallery;
		reelBuildSceneGallery = function () {
			ringEnsureImages();
			return ringBaseBuildSceneGallery();
		};

		const ringBaseExportMP4 = exportMP4;
		exportMP4 = async function (options) {
			if (reelSceneMode && REEL_SCENES[reelSceneIndex] && REEL_SCENES[reelSceneIndex].ringCarousel) {
				await ringEnsureImages();
			}
			return ringBaseExportMP4(options);
		};
`;
