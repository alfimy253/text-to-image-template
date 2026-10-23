import { REEL_SCENE_MOOD_DATA } from "./reel-scene-assets";

/**
 * Reel Editor scene mode, adapted from the user-supplied Reel Editor v4 HTML.
 * It runs inside TEMPLATE_COMPOSER_JS's existing IIFE so it can reuse the
 * modal's WebCodecs exporter, orientation controls, photos, and gallery target.
 */
export const REEL_SCENE_EDITOR_JS = `
		// =========================================================
		// INTERACTIVE REEL SCENES — click-to-edit DOM-style scenes
		// drawn on the same canvas used by the MP4 exporter.
		// =========================================================
		const REEL_SCENE_IMAGE_DATA = ${JSON.stringify(REEL_SCENE_MOOD_DATA)};
		const REEL_SCENE_IMAGES = REEL_SCENE_IMAGE_DATA.map(function (src) {
			const image = new Image();
			image.src = src;
			return image;
		});
		const REEL_FILTER_SUPPORTED = typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;
		const REEL_SCENE_IMAGES_READY = Promise.all(REEL_SCENE_IMAGES.map(function (image) {
			return new Promise(function (resolve) {
				if (image.complete) {
					resolve();
					return;
				}
				image.onload = resolve;
				image.onerror = resolve;
			});
		}));

		const REEL_SCENES = [
			{ name: "Ideas Move Fast", style: "kinetic", text: "Ideas Move Fast", sub: "Words slide in on staggered beats.", image: 0, graphic: "none" },
			{ name: "Alphabet Aerobics", style: "kinetic", text: "Alphabet Aerobics", sub: "Letters bounce off the baseline.", image: 4, graphic: "letters" },
			{ name: "Two Colors. Zero Noise.", style: "duotone", text: "Two Colors. Zero Noise.", sub: "A split field that never sits still.", image: 1, graphic: "none" },
			{ name: "Shape Study", style: "duotone", text: "Shape Study", sub: "One gradient, many silhouettes.", image: 2, graphic: "triangle" },
			{ name: "Voltage", style: "neon", text: "Voltage", sub: "Pink tubes flicker in the dark.", image: 0, graphic: "none" },
			{ name: "Pointing Up", style: "neon", text: "Pointing Up", sub: "A neon line draws the eye.", image: 5, graphic: "arrow" },
			{ name: "Sunset Strip", style: "neon", text: "Sunset Strip", sub: "A synth grid scrolls to the horizon.", image: 3, graphic: "synth" },
			{ name: "Signal Lost", style: "glitch", text: "Signal Lost", sub: "RGB channels split and recombine.", image: 3, graphic: "none" },
			{ name: "Broadcast", style: "glitch", text: "Broadcast", sub: "A small set loses the picture.", image: 1, graphic: "square" },
			{ name: "Scrambled", style: "glitch", text: "Scrambled", sub: "Characters shuffle, then settle.", image: 0, graphic: "none" },
			{ name: "The Story Behind", style: "vox", text: "The Story Behind", sub: "Long reads, explained visually.", image: 2, graphic: "none" },
			{ name: "Long Reads", style: "vox", text: "Long Reads", sub: "Editorial motion, magazine style.", image: 5, graphic: "star" },
			{ name: "Tearing", style: "glitch", text: "Tearing", sub: "A sweep band rolls down the frame.", image: 0, graphic: "none" },
			{ name: "VHS Nineteen Ninety Seven", style: "glitch", text: "VHS Nineteen Ninety Seven", sub: "Tracking distortion, no tape required.", image: 3, graphic: "none" }
		];
		REEL_SCENES.forEach(function (scene) { scene.reelScene = true; });

		const REEL_TEXT_ANIMS = [
			["None", "none"], ["Kinetic words", "kinetic"], ["Neon flicker", "neon"],
			["RGB glitch", "glitch"], ["Duotone gradient", "duotone"],
			["Scale pulse", "scale"], ["3D flip", "flip"]
		];
		const REEL_SHAPE_ANIMS = [
			["None", "none"], ["Float", "float"], ["Spin", "spin"],
			["Pulse", "pulse"], ["Glow", "glow"]
		];
		const REEL_TRANSITIONS = [
			["None", "none"], ["Fade", "fade"], ["Slide up", "slide"],
			["Zoom", "zoom"], ["3D flip", "flip"]
		];
		const REEL_BG_EFFECTS = [
			["None", "none"], ["Blur in", "blur-in"], ["Glow pulse", "glow"],
			["Color shift", "color"], ["Float", "float"],
			["Slow zoom in", "zoom-in"], ["Slow zoom out", "zoom-out"],
			["Scanlines", "scanlines"], ["Duotone split", "duotone"]
		];
		const REEL_BG_TRANSITIONS = [
			["None", "none"], ["Zoom", "zoom"], ["Flip", "flip"],
			["Circle mask", "mask"], ["Gradient wipe", "gradient"]
		];
		const REEL_GRAPHICS = [
			["Circle", "circle", "◯"], ["Square", "square", "■"],
			["Triangle", "triangle", "▲"], ["Star", "star", "★"],
			["Heart", "heart", "♥"], ["Arrow", "arrow", "➜"],
			["Gear", "gear", "⚙"], ["Synth grid", "synth", "▤"], ["Letters", "letters", "ABC"]
		];
		const REEL_COLOR_SWATCHES = [
			["White", "#ffffff"], ["Ink", "#111111"], ["Cream", "#f6f0df"],
			["Red", "#ff3b30"], ["Orange", "#ff7a00"], ["Yellow", "#ffe600"],
			["Lime", "#c8ff00"], ["Green", "#22c55e"], ["Cyan", "#00e5ff"],
			["Blue", "#2563eb"], ["Violet", "#7c3aed"], ["Pink", "#ff4fa3"]
		];
		const REEL_COLOR_GRADIENTS = [
			{ name: "Sunset", value: "gradient:sunset", colors: ["#ff6b35", "#ec4899"] },
			{ name: "Ocean", value: "gradient:ocean", colors: ["#22d3ee", "#2563eb"] },
			{ name: "Lime", value: "gradient:lime", colors: ["#d8ff00", "#00a86b"] },
			{ name: "Violet", value: "gradient:violet", colors: ["#818cf8", "#a855f7"] }
		];
		const REEL_STYLE_OPTIONS = [
			["Kinetic typography", "kinetic"], ["Duotone", "duotone"],
			["Neon", "neon"], ["Glitch art", "glitch"], ["Vox magazine", "vox"]
		];

		let reelSceneMode = false;
		let reelGalleryCategory = "scenes";
		let reelSceneIndex = 0;
		let reelSelectedElement = "headline";
		let reelPreviousOrientation = null;
		let reelSceneDrag = null;
		let reelSceneHitAreas = [];
		let reelSceneStates = [];
		let reelSceneGalleryCanvases = [];
		let reelSceneEditorReady = false;
		let reelMotionDescription = "";
		let reelMotionTipText = "";

		function reelClamp(value, min, max) {
			return Math.max(min, Math.min(max, value));
		}

		function reelSceneDefaultState(index) {
			const scene = REEL_SCENES[index];
			const isVox = scene.style === "vox";
			let headlineAnim = "none";
			let backgroundEffect = "none";
			if (scene.style === "kinetic") headlineAnim = "kinetic";
			if (scene.style === "duotone") {
				headlineAnim = "duotone";
				backgroundEffect = "duotone";
			}
			if (scene.style === "neon") {
				headlineAnim = "neon";
				backgroundEffect = "glow";
			}
			if (scene.style === "glitch") {
				headlineAnim = "glitch";
				backgroundEffect = "scanlines";
			}
			return {
				style: scene.style,
				background: {
					image: "mood:" + scene.image,
					effect: backgroundEffect,
					speed: 1,
					transition: "zoom",
					transitionSpeed: 1
				},
				elements: {
					eyebrow: {
						type: "text", label: "Eyebrow", text: ("0" + (index + 1)).slice(-2) + " · " + scene.style.toUpperCase() + " SCENE",
						x: 6, y: 7, size: 13, color: isVox ? "#dc2626" : "#c4a87c",
						font: "mono", align: "left", anim: "none", transition: "fade",
						transitionSpeed: 1, speed: 1, visible: true, deleted: false
					},
					headline: {
						type: "text", label: "Headline", text: scene.text,
						x: 50, y: 39, size: 56, color: isVox ? "#0f172a" : (scene.style === "glitch" ? "#ffffff" : "#ffffff"),
						font: "sans", align: "center", anim: headlineAnim,
						transition: "slide", transitionSpeed: 1, speed: 1,
						visible: true, deleted: false
					},
					sub: {
						type: "text", label: "Sub text", text: scene.sub,
						x: 50, y: 63, size: 16, color: isVox ? "#64748b" : "#dddddd",
						font: "sans", align: "center", anim: "none", transition: "fade",
						transitionSpeed: 1, speed: 1, visible: true, deleted: false
					},
					graphic: {
						type: "graphic", label: "Graphic", kind: scene.graphic === "none" ? "circle" : scene.graphic,
						x: 50, y: 80, size: 64, color: scene.style === "neon" ? "#ff2d95" : "#7aac2b",
						anim: "float", transition: "zoom", transitionSpeed: 1,
						speed: 1, visible: scene.graphic !== "none", deleted: false
					}
				}
			};
		}

		function reelSceneState(index) {
			if (!reelSceneStates[index]) reelSceneStates[index] = reelSceneDefaultState(index);
			return reelSceneStates[index];
		}

		function reelSelectedState() {
			return reelSceneState(reelSceneIndex);
		}

		function reelNormalizeScenePhotos() {
			reelSceneStates.forEach(function (state) {
				if (!state || !state.background || String(state.background.image).indexOf("photo:") !== 0) return;
				const photoIndex = Number(String(state.background.image).split(":")[1]);
				if (!photos[photoIndex]) state.background.image = "mood:0";
			});
		}

		function reelNameForElement(key, element) {
			if (key === "bg") return "Background";
			return element && element.label ? element.label : key;
		}

		function reelRegisterHit(key, x, y, width, height) {
			reelSceneHitAreas.push({
				key: key,
				x: x, y: y, width: width, height: height
			});
		}

		function reelCoverImage(context, image, width, height, zoom, offsetX, offsetY) {
			if (!image || !image.naturalWidth) return;
			const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * (zoom || 1);
			const drawWidth = image.naturalWidth * scale;
			const drawHeight = image.naturalHeight * scale;
			context.drawImage(
				image,
				(width - drawWidth) / 2 + (offsetX || 0),
				(height - drawHeight) / 2 + (offsetY || 0),
				drawWidth,
				drawHeight
			);
		}

		function reelBackgroundImage(background) {
			const token = String(background.image || "mood:0");
			if (token.indexOf("photo:") === 0) {
				const photoIndex = Number(token.split(":")[1]);
				return photos[photoIndex] || REEL_SCENE_IMAGES[0];
			}
			const moodIndex = Number(token.split(":")[1]);
			return REEL_SCENE_IMAGES[reelClamp(isFinite(moodIndex) ? moodIndex : 0, 0, REEL_SCENE_IMAGES.length - 1)] || REEL_SCENE_IMAGES[0];
		}

		function reelBackgroundMotion(effect, time, speed, width, height) {
			const motion = { zoom: 1, x: 0, y: 0, filter: "none" };
			const phase = (time * (speed || 1)) % 7;
			const pulse = (Math.sin(phase / 7 * Math.PI * 2 - Math.PI / 2) + 1) / 2;
			if (effect === "blur-in") {
				const q = reelClamp(time / Math.max(0.15, 2.4 * (speed || 1)), 0, 1);
				motion.filter = "blur(" + ((1 - q) * 18) + "px) brightness(" + (0.5 + q * 0.5) + ")";
			}
			else if (effect === "glow") {
				motion.filter = "brightness(" + (1 + pulse * 0.42) + ") saturate(" + (1 + pulse * 0.25) + ")";
			}
			else if (effect === "color") {
				motion.filter = "hue-rotate(" + ((time * 60 * (speed || 1)) % 360) + "deg) saturate(1.3)";
			}
			else if (effect === "float") {
				motion.zoom = 1.06;
				motion.y = Math.sin(time * 2 * Math.PI / 4 * (speed || 1)) * height * 0.018;
			}
			else if (effect === "zoom-in") {
				motion.zoom = 1 + pulse * 0.22;
			}
			else if (effect === "zoom-out") {
				motion.zoom = 1.22 - pulse * 0.22;
			}
			if (!REEL_FILTER_SUPPORTED) motion.filter = "none";
			return motion;
		}

		function reelDrawBackground(context, width, height, time, state, scale) {
			const style = state.style;
			const bg = state.background;
			const image = reelBackgroundImage(bg);
			const motion = reelBackgroundMotion(bg.effect, time, bg.speed, width, height);
			context.fillStyle = style === "vox" ? "#f9f9fa" : "#07090d";
			context.fillRect(0, 0, width, height);
			const transitionDuration = Math.max(0.15, 0.9 * (bg.transitionSpeed || 1));
			const q = reelClamp(time / transitionDuration, 0, 1);
			context.save();
			if (time < transitionDuration && bg.transition !== "none") {
				if (bg.transition === "zoom") {
					context.translate(width / 2, height / 2);
					context.scale(1.55 - 0.55 * q, 1.55 - 0.55 * q);
					context.translate(-width / 2, -height / 2);
				}
				else if (bg.transition === "flip") {
					context.translate(width / 2, height / 2);
					context.scale(Math.max(0.025, q), 1);
					context.translate(-width / 2, -height / 2);
				}
				else if (bg.transition === "mask") {
					context.beginPath();
					context.arc(width / 2, height / 2, Math.max(width, height) * (0.02 + q * 1.1), 0, Math.PI * 2);
					context.clip();
				}
				else if (bg.transition === "gradient") {
					context.beginPath();
					context.rect(0, 0, width * q, height);
					context.clip();
				}
			}
			if (image && image.naturalWidth) {
				if ("filter" in context) context.filter = motion.filter;
				const alpha = style === "vox" ? 0.12 : 0.9;
				context.globalAlpha = alpha;
				reelCoverImage(context, image, width, height, motion.zoom, motion.x, motion.y);
				context.globalAlpha = 1;
				if ("filter" in context) context.filter = "none";
			}
			context.restore();

			if (style === "vox") {
				context.fillStyle = "rgba(249,249,250,0.78)";
				context.fillRect(0, 0, width, height);
			}
			else {
				const shade = context.createLinearGradient(0, 0, 0, height);
				shade.addColorStop(0, "rgba(0,0,0,0.25)");
				shade.addColorStop(0.52, "rgba(0,0,0,0.24)");
				shade.addColorStop(1, "rgba(0,0,0,0.7)");
				context.fillStyle = shade;
				context.fillRect(0, 0, width, height);
			}

			if (style === "duotone" || bg.effect === "duotone") {
				const shift = ((time * 14 * (bg.speed || 1)) % 100) / 100;
				const duo = context.createLinearGradient(width * (shift - 0.5), 0, width * (shift + 1), 0);
				duo.addColorStop(0, "rgba(255,107,53,0.42)");
				duo.addColorStop(0.5, "rgba(255,107,53,0.12)");
				duo.addColorStop(1, "rgba(46,196,182,0.44)");
				context.fillStyle = duo;
				context.fillRect(0, 0, width, height);
			}
			if (style === "neon") {
				const glow = context.createRadialGradient(width * 0.5, height * 0.5, width * 0.03, width * 0.5, height * 0.5, width * 0.72);
				glow.addColorStop(0, "rgba(255,45,149,0.08)");
				glow.addColorStop(1, "rgba(0,0,0,0.52)");
				context.fillStyle = glow;
				context.fillRect(0, 0, width, height);
			}
			if (style === "glitch" || bg.effect === "scanlines") {
				context.save();
				context.globalAlpha = 0.3;
				context.fillStyle = "rgba(0,0,0,0.72)";
				const lineHeight = Math.max(2, Math.round(2 * scale));
				const gap = Math.max(5, Math.round(7 * scale));
				const scroll = Math.floor((time * 24 * (bg.speed || 1)) % gap);
				for (let y = -gap; y < height + gap; y += gap) {
					context.fillRect(0, y + scroll, width, lineHeight);
				}
				context.restore();
			}
		}

		function reelTransitionState(element, time, scale) {
			const result = { alpha: 1, dx: 0, dy: 0, sx: 1, sy: 1, rotation: 0 };
			const transition = element.transition || "none";
			if (transition === "none") return result;
			const duration = Math.max(0.12, 0.82 * (element.transitionSpeed || 1));
			const q = reelClamp(time / duration, 0, 1);
			if (transition === "fade") result.alpha = q;
			else if (transition === "slide") {
				result.alpha = q;
				result.dy = (1 - q) * 36 * scale;
			}
			else if (transition === "zoom") {
				result.alpha = q;
				result.sx = result.sy = 0.55 + q * 0.45;
			}
			else if (transition === "flip") {
				result.alpha = q;
				result.sx = Math.max(0.035, Math.abs(Math.cos((1 - q) * Math.PI / 2)));
			}
			return result;
		}

		function reelWrapText(context, value, maxWidth) {
			const paragraphs = String(value || "").split("\\n");
			const lines = [];
			paragraphs.forEach(function (paragraph) {
				const words = paragraph.split(" ");
				let line = "";
				words.forEach(function (word) {
					const candidate = line ? line + " " + word : word;
					if (line && context.measureText(candidate).width > maxWidth) {
						lines.push(line);
						line = word;
					}
					else line = candidate;
				});
				if (line || !paragraph) lines.push(line);
			});
			return lines.length ? lines : [""];
		}

		function reelDrawLine(context, text, x, y, align, maxWidth) {
			context.textAlign = align;
			context.fillText(text, x, y, maxWidth);
		}

		function reelGradientDefinition(value) {
			return REEL_COLOR_GRADIENTS.find(function (gradient) {
				return gradient.value === value;
			}) || null;
		}

		function reelSolidColor(value, fallback) {
			const gradient = reelGradientDefinition(value);
			return gradient ? gradient.colors[0] : (value || fallback);
		}

		function reelColorCss(value) {
			const gradient = reelGradientDefinition(value);
			return gradient ? "linear-gradient(135deg," + gradient.colors.join(",") + ")" : value;
		}

		function reelPaint(context, value, width, height, fallback) {
			const definition = reelGradientDefinition(value);
			if (!definition) return value || fallback;
			const halfWidth = Math.max(1, Number(width) || 1) / 2;
			const halfHeight = Math.max(1, Number(height) || 1) / 2;
			const gradient = context.createLinearGradient(-halfWidth, -halfHeight, halfWidth, halfHeight);
			definition.colors.forEach(function (color, index) {
				gradient.addColorStop(index / Math.max(1, definition.colors.length - 1), color);
			});
			return gradient;
		}

		function reelDrawText(context, width, height, scale, time, state, key, element, hitAreas) {
			if (!element.visible || element.deleted) return;
			const fontSize = Math.max(10, Number(element.size) || 24) * scale;
			const family = element.font === "serif" ? "Georgia, serif" : element.font === "mono" ? "'JetBrains Mono', monospace" : "Arial, Helvetica, sans-serif";
			context.save();
			context.font = (key === "eyebrow" ? "700 " : "800 ") + Math.round(fontSize) + "px " + family;
			const lines = reelWrapText(context, element.text || "", width * 0.82);
			const lineHeight = fontSize * 1.22;
			const maxLine = Math.max.apply(null, lines.map(function (line) { return context.measureText(line).width; }));
			const x = width * (Number(element.x) / 100);
			const y = height * (Number(element.y) / 100);
			const align = element.align || "center";
			const left = align === "left" ? x : align === "right" ? x - maxLine : x - maxLine / 2;
			const top = key === "eyebrow" ? y : y - lineHeight * (lines.length - 1) / 2 - lineHeight / 2;
			const bounds = {
				x: Math.max(0, left - 7 * scale),
				y: Math.max(0, top - 7 * scale),
				width: Math.min(width, maxLine + 14 * scale),
				height: Math.min(height, lineHeight * lines.length + 14 * scale)
			};
			hitAreas.push({ key: key, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });

			const transition = reelTransitionState(element, time, scale);
			const motionTime = time * (state.speed || 1) * (element.speed || 1);
			let sx = transition.sx;
			let sy = transition.sy;
			let alpha = transition.alpha;
			let rotation = transition.rotation;
			if (element.anim === "scale") {
				const pulse = (Math.sin(motionTime * Math.PI * 2) + 1) / 2;
				sx *= 1 + pulse * 0.08;
				sy *= 1 + pulse * 0.08;
			}
			else if (element.anim === "flip") {
				sx *= 0.88 + Math.abs(Math.cos(motionTime * Math.PI)) * 0.12;
			}
			if (element.anim === "neon") {
				const phase = (motionTime % 2.5) / 2.5;
				if ((phase > 0.18 && phase < 0.22) || (phase > 0.53 && phase < 0.57)) alpha *= 0.48;
				context.shadowColor = reelGradientDefinition(element.color)
					? reelSolidColor(element.color, "#ff2d95")
					: "#ff2d95";
				context.shadowBlur = 24 * scale;
			}
			context.translate(x + transition.dx, y + transition.dy);
			context.rotate(rotation);
			context.scale(sx, sy);
			context.globalAlpha *= alpha;
			context.textBaseline = "middle";
			context.fillStyle = reelPaint(context, element.color, maxLine, lineHeight, "#ffffff");
			if (element.anim === "duotone") {
				const shift = (motionTime % 3) / 3;
				const gradient = context.createLinearGradient(-maxLine / 2 - shift * width * 0.25, 0, maxLine / 2 + width * 0.25, 0);
				gradient.addColorStop(0, "#ff6b35");
				gradient.addColorStop(1, "#2ec4b6");
				context.fillStyle = gradient;
			}
			if (element.anim === "glitch") {
				context.save();
				context.globalAlpha *= 0.72;
				context.fillStyle = "#00f0ff";
				lines.forEach(function (line, index) {
					const lineY = top + lineHeight * index + lineHeight / 2 - y;
					reelDrawLine(context, line, -3 * scale, lineY, align, width * 0.82);
				});
				context.fillStyle = "#ff2d40";
				lines.forEach(function (line, index) {
					const lineY = top + lineHeight * index + lineHeight / 2 - y;
					reelDrawLine(context, line, 3 * scale, lineY, align, width * 0.82);
				});
				context.restore();
			}
			if (element.anim === "kinetic" && motionTime < 1.1) {
				let wordIndex = 0;
				lines.forEach(function (line, lineIndex) {
					const words = line.split(" ").filter(Boolean);
					const widths = words.map(function (word) { return context.measureText(word).width; });
					const space = context.measureText(" ").width;
					const totalWidth = widths.reduce(function (sum, currentWidth) { return sum + currentWidth; }, 0) + Math.max(0, words.length - 1) * space;
					let cursor = align === "left" ? 0 : align === "right" ? -totalWidth : -totalWidth / 2;
					words.forEach(function (word, wordIndexInLine) {
						const q = reelClamp((motionTime - wordIndex * 0.12) / 0.6, 0, 1);
						context.save();
						context.globalAlpha *= q;
						context.fillText(word, cursor, top + lineHeight * lineIndex + lineHeight / 2 - y + (1 - q) * 24 * scale);
						context.restore();
						cursor += widths[wordIndexInLine] + space;
						wordIndex++;
					});
				});
			}
			else {
				lines.forEach(function (line, index) {
					const lineY = top + lineHeight * index + lineHeight / 2 - y;
					if (element.anim === "glitch") {
						context.save();
						context.globalAlpha *= 0.4;
						context.fillStyle = "#00f0ff";
						reelDrawLine(context, line, -3 * scale, lineY, align, width * 0.82);
						context.fillStyle = "#ff2d40";
						reelDrawLine(context, line, 3 * scale, lineY, align, width * 0.82);
						context.restore();
					}
					reelDrawLine(context, line, 0, lineY, align, width * 0.82);
				});
			}
			context.restore();
		}

		function reelDrawStar(context, radius) {
			context.beginPath();
			for (let i = 0; i < 10; i++) {
				const angle = -Math.PI / 2 + i * Math.PI / 5;
				const r = i % 2 === 0 ? radius : radius * 0.43;
				const px = Math.cos(angle) * r;
				const py = Math.sin(angle) * r;
				if (i === 0) context.moveTo(px, py); else context.lineTo(px, py);
			}
			context.closePath();
		}

		function reelDrawGraphic(context, width, height, scale, time, state, key, element, hitAreas) {
			if (!element.visible || element.deleted) return;
			const size = Math.max(16, Number(element.size) || 64) * scale;
			const x = width * Number(element.x) / 100;
			const y = height * Number(element.y) / 100;
			const transition = reelTransitionState(element, time, scale);
			const motionTime = time * (state.speed || 1) * (element.speed || 1);
			let sy = transition.sy;
			let sx = transition.sx;
			let dy = transition.dy;
			let rotation = 0;
			if (element.anim === "float") dy += Math.sin(motionTime * Math.PI * 2 / 2.4) * 6 * scale;
			if (element.anim === "spin") rotation = motionTime * Math.PI * 2 / 3;
			if (element.anim === "pulse") sx *= 1 + (Math.sin(motionTime * Math.PI * 2 / 1.4) + 1) * 0.09, sy *= 1 + (Math.sin(motionTime * Math.PI * 2 / 1.4) + 1) * 0.09;
			context.save();
			context.translate(x + transition.dx, y + dy);
			context.rotate(rotation);
			context.scale(sx, sy);
			context.globalAlpha *= transition.alpha;
			const graphicPaint = reelPaint(context, element.color, size, size, "#7aac2b");
			context.fillStyle = graphicPaint;
			context.strokeStyle = graphicPaint;
			context.lineWidth = Math.max(2, size * 0.08);
			if (element.anim === "glow" || state.style === "neon") {
				context.shadowColor = reelSolidColor(element.color, "#ff2d95");
				context.shadowBlur = (12 + (Math.sin(motionTime * 4) + 1) * 8) * scale;
			}
			if (element.kind === "letters") {
				context.font = "900 " + Math.round(size * 0.58) + "px Arial, sans-serif";
				context.textAlign = "center";
				context.textBaseline = "middle";
				context.fillStyle = graphicPaint;
				context.fillText("A B C", 0, 0, size * 2.4);
			}
			else if (element.kind === "synth") {
				context.strokeStyle = graphicPaint;
				context.lineWidth = Math.max(1, 1.5 * scale);
				for (let i = 0; i < 6; i++) {
					const yy = size * (0.15 + i * 0.15);
					context.beginPath();
					context.moveTo(-size, yy);
					context.lineTo(size, yy);
					context.stroke();
				}
				for (let i = -4; i <= 4; i++) {
					context.beginPath();
					context.moveTo(i * size * 0.23, size * 0.12);
					context.lineTo(i * size * 0.55, size);
					context.stroke();
				}
			}
			else {
				context.beginPath();
				if (element.kind === "circle") context.arc(0, 0, size / 2, 0, Math.PI * 2);
				else if (element.kind === "square") context.rect(-size / 2, -size / 2, size, size);
				else if (element.kind === "triangle") {
					context.moveTo(0, -size / 2);
					context.lineTo(size / 2, size / 2);
					context.lineTo(-size / 2, size / 2);
					context.closePath();
				}
				else if (element.kind === "star") reelDrawStar(context, size / 2);
				else if (element.kind === "heart") {
					context.moveTo(0, size * 0.42);
					context.bezierCurveTo(-size * 0.2, size * 0.25, -size * 0.52, 0, -size * 0.42, -size * 0.2);
					context.bezierCurveTo(-size * 0.34, -size * 0.52, -size * 0.05, -size * 0.48, 0, -size * 0.25);
					context.bezierCurveTo(size * 0.05, -size * 0.48, size * 0.34, -size * 0.52, size * 0.42, -size * 0.2);
					context.bezierCurveTo(size * 0.52, 0, size * 0.2, size * 0.25, 0, size * 0.42);
				}
				else if (element.kind === "arrow") {
					context.moveTo(-size * 0.48, -size * 0.13);
					context.lineTo(size * 0.13, -size * 0.13);
					context.lineTo(size * 0.13, -size * 0.4);
					context.lineTo(size * 0.5, 0);
					context.lineTo(size * 0.13, size * 0.4);
					context.lineTo(size * 0.13, size * 0.13);
					context.lineTo(-size * 0.48, size * 0.13);
					context.closePath();
				}
				else if (element.kind === "gear") reelDrawStar(context, size / 2);
				if (element.kind === "gear") {
					context.fill();
					context.globalCompositeOperation = "destination-out";
					context.beginPath();
					context.arc(0, 0, size * 0.14, 0, Math.PI * 2);
					context.fill();
				}
				else context.fill();
			}
			hitAreas.push({ key: key, x: x - size * 0.62, y: y + dy - size * 0.62, width: size * 1.24, height: size * 1.24 });
			context.restore();
		}

		function reelDrawSelection(context, hitAreas, selected, width, height, scale) {
			const match = hitAreas.find(function (area) { return area.key === selected; });
			if (!match) {
				if (selected === "bg") {
					context.save();
					context.strokeStyle = "rgba(122,172,43,0.9)";
					context.lineWidth = Math.max(1, 1.5 * scale);
					context.setLineDash([7 * scale, 5 * scale]);
					context.strokeRect(3 * scale, 3 * scale, width - 6 * scale, height - 6 * scale);
					context.restore();
				}
				return;
			}
			context.save();
			context.strokeStyle = "#7aac2b";
			context.lineWidth = Math.max(1, 1.6 * scale);
			context.setLineDash([6 * scale, 4 * scale]);
			context.strokeRect(match.x, match.y, match.width, match.height);
			context.setLineDash([]);
			const handle = 7 * scale;
			context.fillStyle = "#7aac2b";
			context.fillRect(match.x - handle / 2, match.y - handle / 2, handle, handle);
			context.fillRect(match.x + match.width - handle / 2, match.y - handle / 2, handle, handle);
			context.fillRect(match.x - handle / 2, match.y + match.height - handle / 2, handle, handle);
			context.fillRect(match.x + match.width - handle / 2, match.y + match.height - handle / 2, handle, handle);
			context.restore();
		}

		function reelDrawScene(context, width, height, time, scene, state, showSelection) {
			const scale = width / 1120;
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.filter = "none";
			context.globalAlpha = 1;
			context.globalCompositeOperation = "source-over";
			context.clearRect(0, 0, width, height);
			reelSceneHitAreas = [];
			reelRegisterHit("bg", 0, 0, width, height);
			reelDrawBackground(context, width, height, time, state, scale);
			const hitAreas = reelSceneHitAreas;
			Object.keys(state.elements).forEach(function (key) {
				const element = state.elements[key];
				if (element.type === "graphic") reelDrawGraphic(context, width, height, scale, time, state, key, element, hitAreas);
				else reelDrawText(context, width, height, scale, time, state, key, element, hitAreas);
			});
			if (showSelection) reelDrawSelection(context, hitAreas, reelSelectedElement, width, height, scale);
			if (showSelection) reelSceneHitAreas = hitAreas;
		}

		const reelBaseDrawScene = drawScene;
		drawScene = function (context, width, height, time, scene, state) {
			if (scene && scene.reelScene) {
				const showSelection = context === ctx && reelSceneMode && !exporting && editorView && editorView.style.display !== "none";
				reelDrawScene(context, width, height, time, scene, state, showSelection);
				return;
			}
			return reelBaseDrawScene(context, width, height, time, scene, state);
		};

		const reelBaseCurrent = current;
		current = function () {
			return reelSceneMode ? reelSceneState(reelSceneIndex) : reelBaseCurrent();
		};
		const reelBaseCurrentVarDef = currentVarDef;
		currentVarDef = function () {
			return reelSceneMode ? REEL_SCENES[reelSceneIndex] : reelBaseCurrentVarDef();
		};
		const reelBaseTick = tick;
		tick = function (now) {
			reelBaseTick(now);
			if (!modal || modal.style.display === "none" || !galleryView || galleryView.style.display === "none" || reelGalleryCategory !== "scenes") return;
			for (const preview of reelSceneGalleryCanvases) {
				if (preview && preview.ctx) drawScene(preview.ctx, preview.canvas.width, preview.canvas.height, previewT % 12, preview.scene, preview.state);
			}
		};

		function reelSetGalleryCategory() {
			reelGalleryCategory = "scenes";
			const sceneGrid = document.getElementById("tm-scene-grid");
			if (sceneGrid) sceneGrid.style.display = "";
			const sceneTab = document.getElementById("tm-tab-scenes");
			if (sceneTab) {
				sceneTab.classList.add("active");
				sceneTab.setAttribute("aria-pressed", "true");
			}
		}

		function reelBuildSceneGallery() {
			const grid = document.getElementById("tm-scene-grid");
			if (!grid) return;
			grid.innerHTML = "";
			reelSceneGalleryCanvases = [];
			REEL_SCENES.forEach(function (scene, index) {
				const card = document.createElement("button");
				card.type = "button";
				card.className = "tm-gcard tm-scene-card";
				card.setAttribute("data-scene", String(index));
				const frame = document.createElement("span");
				frame.className = "tm-gframe tm-scene-gframe";
				const preview = document.createElement("canvas");
				preview.className = "tm-gcanvas tm-scene-gcanvas";
				preview.width = 360;
				preview.height = 203;
				frame.appendChild(preview);
				const name = document.createElement("span");
				name.className = "tm-gname";
				name.textContent = (index + 1) + " · " + scene.name;
				const tag = document.createElement("span");
				tag.className = "tm-gtag";
				tag.textContent = scene.style + " · click to edit";
				card.appendChild(frame);
				card.appendChild(name);
				card.appendChild(tag);
				card.addEventListener("click", function () { reelOpenSceneEditor(index); });
				grid.appendChild(card);
				reelSceneGalleryCanvases.push({
					canvas: preview,
					ctx: preview.getContext("2d"),
					scene: scene,
					state: reelSceneDefaultState(index)
				});
			});
		}

		function reelButton(text, className, onClick) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = className || "";
			button.textContent = text;
			button.addEventListener("click", onClick);
			return button;
		}

		function reelMakeField(parent, labelText) {
			const label = document.createElement("label");
			label.className = "tm-scene-field" + ((labelText === "Text" || labelText === "BG image") ? " tm-scene-wide" : "");
			const caption = document.createElement("span");
			caption.className = "tm-scene-field-label";
			caption.textContent = labelText;
			label.appendChild(caption);
			parent.appendChild(label);
			return label;
		}

		function reelAddTextInput(parent, label, value, maxLength, onChange) {
			const field = reelMakeField(parent, label);
			const input = document.createElement("input");
			input.type = "text";
			input.value = value || "";
			input.maxLength = maxLength || 120;
			input.addEventListener("input", function () { onChange(input.value); });
			field.appendChild(input);
			return input;
		}

		function reelAddColor(parent, label, value, onChange) {
			const field = reelMakeField(parent, label);
			const input = document.createElement("input");
			input.type = "color";
			input.value = /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#ffffff";
			input.addEventListener("input", function () { onChange(input.value); });
			field.appendChild(input);
		}

		function reelAddSceneColor(parent, label, value, onChange) {
			const field = document.createElement("div");
			field.className = "tm-scene-field tm-scene-color-field";
			const caption = document.createElement("span");
			caption.className = "tm-scene-field-label";
			caption.textContent = label;
			field.appendChild(caption);
			parent.appendChild(field);
			const current = reelButton("", "tm-scene-color-current", function () {});
			current.style.background = reelColorCss(value);
			current.setAttribute("aria-label", "Choose " + label.toLowerCase());
			current.setAttribute("aria-expanded", "false");
			current.title = "Choose " + label.toLowerCase();
			const picker = document.createElement("span");
			picker.className = "tm-scene-color-popover";
			picker.style.display = "none";
			picker.setAttribute("role", "group");
			picker.setAttribute("aria-label", label + " palette");

			const closePicker = function () {
				picker.style.display = "none";
				current.setAttribute("aria-expanded", "false");
			};
			const choose = function (nextValue) {
				current.style.background = reelColorCss(nextValue);
				onChange(nextValue);
				closePicker();
			};
			current.addEventListener("click", function (event) {
				event.preventDefault();
				event.stopPropagation();
				const opening = picker.style.display === "none";
				document.querySelectorAll("#tpl-modal .tm-scene-color-popover").forEach(function (other) {
					other.style.display = "none";
				});
				document.querySelectorAll("#tpl-modal .tm-scene-color-current").forEach(function (other) {
					other.setAttribute("aria-expanded", "false");
				});
				if (opening) {
					picker.style.display = "block";
					current.setAttribute("aria-expanded", "true");
				}
			});

			const solidTitle = document.createElement("span");
			solidTitle.className = "tm-scene-color-title";
			solidTitle.textContent = "Colours";
			picker.appendChild(solidTitle);
			const solids = document.createElement("span");
			solids.className = "tm-scene-color-swatches";
			REEL_COLOR_SWATCHES.forEach(function (swatch) {
				const button = reelButton("", "tm-scene-color-swatch", function (event) {
					event.preventDefault();
					event.stopPropagation();
					choose(swatch[1]);
				});
				button.style.background = swatch[1];
				button.title = swatch[0];
				button.setAttribute("aria-label", swatch[0]);
				solids.appendChild(button);
			});
			const custom = document.createElement("input");
			custom.type = "color";
			custom.className = "tm-scene-color-custom";
			const solidValue = reelSolidColor(value, "#ffffff");
			custom.value = /^#[0-9a-f]{6}$/i.test(solidValue || "") ? solidValue : "#ffffff";
			custom.title = "Custom colour";
			custom.setAttribute("aria-label", "Custom colour");
			custom.addEventListener("input", function () {
				current.style.background = custom.value;
				onChange(custom.value);
			});
			custom.addEventListener("change", closePicker);
			custom.addEventListener("click", function (event) { event.stopPropagation(); });
			solids.appendChild(custom);
			picker.appendChild(solids);

			const gradientTitle = document.createElement("span");
			gradientTitle.className = "tm-scene-color-title";
			gradientTitle.textContent = "Gradients";
			picker.appendChild(gradientTitle);
			const gradients = document.createElement("span");
			gradients.className = "tm-scene-gradient-row";
			REEL_COLOR_GRADIENTS.forEach(function (gradient) {
				const button = reelButton("", "tm-scene-gradient-swatch", function (event) {
					event.preventDefault();
					event.stopPropagation();
					choose(gradient.value);
				});
				button.style.background = reelColorCss(gradient.value);
				button.title = gradient.name + " gradient";
				button.setAttribute("aria-label", gradient.name + " gradient");
				gradients.appendChild(button);
			});
			picker.appendChild(gradients);
			field.appendChild(current);
			field.appendChild(picker);
			return field;
		}

		function reelAddSelect(parent, label, options, value, onChange) {
			const field = reelMakeField(parent, label);
			const select = document.createElement("select");
			options.forEach(function (option) {
				const item = document.createElement("option");
				item.value = String(option[1]);
				item.textContent = String(option[0]);
				select.appendChild(item);
			});
			select.value = String(value);
			select.addEventListener("change", function () { onChange(select.value); });
			field.appendChild(select);
			return select;
		}

		function reelAddRange(parent, label, value, min, max, step, onChange, suffix) {
			const field = reelMakeField(parent, label);
			const range = document.createElement("input");
			range.type = "range";
			range.min = String(min);
			range.max = String(max);
			range.step = String(step);
			range.value = String(value);
			const readout = document.createElement("output");
			readout.className = "tm-scene-range-value";
			const update = function () {
				const number = Number(range.value);
				readout.textContent = (Number.isInteger(number) ? String(number) : number.toFixed(1)) + (suffix || "");
				onChange(number);
			};
			range.addEventListener("input", update);
			const row = document.createElement("span");
			row.className = "tm-scene-range-row";
			row.appendChild(range);
			row.appendChild(readout);
			field.appendChild(row);
			const number = Number(value);
			readout.textContent = (Number.isInteger(number) ? String(number) : number.toFixed(1)) + (suffix || "");
			return range;
		}

		function reelAddCheckbox(parent, label, checked, onChange) {
			const field = reelMakeField(parent, label);
			const input = document.createElement("input");
			input.type = "checkbox";
			input.checked = !!checked;
			input.className = "tm-scene-checkbox";
			input.addEventListener("change", function () { onChange(input.checked); });
			field.appendChild(input);
		}

		function reelRenderScenePhotoThumbs() {
			const host = document.getElementById("tm-scene-photos");
			if (!host) return;
			host.innerHTML = "";
			photos.forEach(function (photo, index) {
				const thumb = document.createElement("button");
				thumb.type = "button";
				thumb.className = "tm-scene-photo-thumb";
				thumb.title = "Use uploaded photo " + (index + 1) + " as the scene background";
				const image = document.createElement("img");
				image.alt = "Uploaded scene background " + (index + 1);
				image.src = photo.src;
				thumb.appendChild(image);
				thumb.addEventListener("click", function () {
					reelSelectedState().background.image = "photo:" + index;
					reelSelectedElement = "bg";
					reelRenderSceneControls();
					reelRedrawScene();
				});
				host.appendChild(thumb);
			});
		}

		function reelRenderSceneControls() {
			if (!reelSceneEditorReady) return;
			const state = reelSelectedState();
			const objectsHost = document.getElementById("tm-scene-objects");
			const inspector = document.getElementById("tm-scene-inspector");
			const badge = document.getElementById("tm-scene-selection-badge");
			if (!objectsHost || !inspector) return;
			const addButton = document.getElementById("tm-scene-add-text");
			const selectedForAdd = state.elements[reelSelectedElement];
			const graphicSelected = !!(selectedForAdd && selectedForAdd.type === "graphic");
			if (addButton) {
				addButton.textContent = graphicSelected ? "＋ Graphic" : "＋ Text";
				addButton.title = graphicSelected ? "Add a graphic element" : "Add a text element";
				addButton.setAttribute("aria-label", graphicSelected ? "Add a graphic element" : "Add a text element");
			}
			objectsHost.innerHTML = "";
			const bgButton = reelButton("Background", "tm-scene-object", function () { reelSelectSceneElement("bg"); });
			bgButton.classList.toggle("selected", reelSelectedElement === "bg");
			bgButton.setAttribute("aria-pressed", reelSelectedElement === "bg" ? "true" : "false");
			objectsHost.appendChild(bgButton);
			Object.keys(state.elements).forEach(function (key) {
				const element = state.elements[key];
				const button = reelButton((element.deleted ? "× " : "") + reelNameForElement(key, element), "tm-scene-object", function () { reelSelectSceneElement(key); });
				button.classList.toggle("selected", reelSelectedElement === key);
				button.classList.toggle("deleted", !!element.deleted);
				button.setAttribute("aria-pressed", reelSelectedElement === key ? "true" : "false");
				objectsHost.appendChild(button);
			});
			if (badge) {
				const selected = state.elements[reelSelectedElement];
				badge.textContent = reelNameForElement(reelSelectedElement, selected) + " selected · drag to move";
			}
			inspector.innerHTML = "";
			const heading = document.createElement("div");
			heading.className = "tm-scene-inspector-title";
			heading.textContent = reelNameForElement(reelSelectedElement, state.elements[reelSelectedElement]);
			inspector.appendChild(heading);

			if (reelSelectedElement === "bg") {
				const background = state.background;
				const imageOptions = REEL_SCENE_IMAGES.map(function (_, index) { return ["Mood image " + (index + 1), "mood:" + index]; });
				photos.forEach(function (_, index) { imageOptions.push(["Uploaded photo " + (index + 1), "photo:" + index]); });
				reelAddSelect(inspector, "BG image", imageOptions, background.image, function (value) { background.image = value; reelRedrawScene(); });
				reelAddSelect(inspector, "Scene style", REEL_STYLE_OPTIONS, state.style, function (value) { state.style = value; reelRedrawScene(); });
				reelAddSelect(inspector, "BG effect", REEL_BG_EFFECTS, background.effect, function (value) { background.effect = value; reelRedrawScene(); });
				reelAddRange(inspector, "BG speed", background.speed, 0.5, 2, 0.1, function (value) { background.speed = value; reelRedrawScene(); }, "×");
				reelAddSelect(inspector, "BG transition", REEL_BG_TRANSITIONS, background.transition, function (value) { background.transition = value; reelRedrawScene(); });
				reelAddRange(inspector, "Transition speed", background.transitionSpeed, 0.25, 2, 0.05, function (value) { background.transitionSpeed = value; reelRedrawScene(); }, "×");
				const photoTitle = document.createElement("div");
				photoTitle.className = "tm-scene-subtitle";
				photoTitle.textContent = "Use your own background photo (up to 2)";
				inspector.appendChild(photoTitle);
				const photoControls = document.createElement("div");
				photoControls.className = "tm-scene-photo-controls";
				const choose = document.createElement("label");
				choose.className = "tm-scene-upload";
				choose.textContent = "＋ Choose photo";
				const fileInput = document.createElement("input");
				fileInput.type = "file";
				fileInput.accept = "image/*";
				fileInput.multiple = true;
				fileInput.addEventListener("change", async function (event) {
					await onPhotoFiles(event);
					reelNormalizeScenePhotos();
					reelRenderScenePhotoThumbs();
					reelRenderSceneControls();
					reelRedrawScene();
				});
				choose.appendChild(fileInput);
				photoControls.appendChild(choose);
				const clear = reelButton("Remove all", "tm-scene-secondary", function () {
					clearPhotos();
					reelNormalizeScenePhotos();
					reelRenderScenePhotoThumbs();
					reelRenderSceneControls();
					reelRedrawScene();
				});
				photoControls.appendChild(clear);
				inspector.appendChild(photoControls);
				const photoThumbs = document.createElement("div");
				photoThumbs.id = "tm-scene-photos";
				photoThumbs.className = "tm-scene-photos";
				inspector.appendChild(photoThumbs);
				reelRenderScenePhotoThumbs();
				return;
			}

			const element = state.elements[reelSelectedElement];
			if (!element) return;
			if (element.deleted) {
				const restore = reelButton("Restore element", "tm-scene-primary", function () {
					element.deleted = false;
					element.visible = true;
					reelRenderSceneControls();
					reelRedrawScene();
				});
				inspector.appendChild(restore);
				return;
			}
			if (element.type === "graphic") {
				reelAddCheckbox(inspector, "Visible", element.visible, function (value) { element.visible = value; reelRedrawScene(); });
				reelAddSelect(inspector, "Shape", REEL_GRAPHICS.map(function (item) { return [item[0], item[1]]; }), element.kind, function (value) { element.kind = value; reelRedrawScene(); });
				const stickerTitle = document.createElement("div");
				stickerTitle.className = "tm-scene-subtitle";
				stickerTitle.textContent = "Shapes & stickers";
				inspector.appendChild(stickerTitle);
				const stickers = document.createElement("div");
				stickers.className = "tm-scene-sticker-grid";
				REEL_GRAPHICS.forEach(function (shape) {
					const sticker = reelButton(shape[2] + " " + shape[0], "tm-scene-sticker", function () { element.kind = shape[1]; reelRenderSceneControls(); reelRedrawScene(); });
					sticker.classList.toggle("selected", element.kind === shape[1]);
					stickers.appendChild(sticker);
				});
				inspector.appendChild(stickers);
				reelAddRange(inspector, "Size", element.size, 20, 160, 1, function (value) { element.size = value; reelRedrawScene(); }, " px");
				reelAddSceneColor(inspector, "Color", element.color, function (value) { element.color = value; reelRedrawScene(); });
				reelAddSelect(inspector, "Animation", REEL_SHAPE_ANIMS, element.anim, function (value) { element.anim = value; reelRedrawScene(); });
			}
			else {
				reelAddTextInput(inspector, "Text", element.text, 120, function (value) {
					element.text = value;
					const activeButton = objectsHost.querySelector(".selected");
					if (activeButton && activeButton !== bgButton) activeButton.textContent = reelNameForElement(reelSelectedElement, element);
					reelRedrawScene();
				});
				reelAddRange(inspector, "Font size", element.size, 10, 110, 1, function (value) { element.size = value; reelRedrawScene(); }, " px");
				reelAddSceneColor(inspector, "Color", element.color, function (value) { element.color = value; reelRedrawScene(); });
				reelAddSelect(inspector, "Font", [["Archivo / sans", "sans"], ["Georgia / serif", "serif"], ["JetBrains Mono", "mono"]], element.font, function (value) { element.font = value; reelRedrawScene(); });
				reelAddSelect(inspector, "Text align", [["Left", "left"], ["Center", "center"], ["Right", "right"]], element.align, function (value) { element.align = value; reelRedrawScene(); });
				reelAddSelect(inspector, "Animation", REEL_TEXT_ANIMS, element.anim, function (value) { element.anim = value; reelRedrawScene(); });
			}
			reelAddSelect(inspector, "Enter transition", REEL_TRANSITIONS, element.transition, function (value) { element.transition = value; reelRedrawScene(); });
			reelAddRange(inspector, "Transition speed", element.transitionSpeed, 0.25, 2, 0.05, function (value) { element.transitionSpeed = value; reelRedrawScene(); }, "×");
			reelAddRange(inspector, "Element speed", element.speed, 0.5, 2, 0.1, function (value) { element.speed = value; reelRedrawScene(); }, "×");
			reelAddRange(inspector, "X %", element.x, 0, 100, 1, function (value) { element.x = value; reelSyncPositionRanges(); reelRedrawScene(); }, "%");
			reelAddRange(inspector, "Y %", element.y, 0, 100, 1, function (value) { element.y = value; reelSyncPositionRanges(); reelRedrawScene(); }, "%");
			const deleteButton = reelButton("Delete element", "tm-scene-delete", function () {
				element.deleted = true;
				element.visible = false;
				reelSelectedElement = "bg";
				reelRenderSceneControls();
				reelRedrawScene();
			});
			inspector.appendChild(deleteButton);
		}

		function reelSyncPositionRanges() {
			const inspector = document.getElementById("tm-scene-inspector");
			if (!inspector) return;
			const element = reelSelectedState().elements[reelSelectedElement];
			if (!element) return;
			const labels = inspector.querySelectorAll(".tm-scene-field-label");
			for (let i = 0; i < labels.length; i++) {
				const field = labels[i].parentElement;
				const range = field && field.querySelector("input[type=range]");
				if (!range) continue;
				if (labels[i].textContent === "X %") {
					range.value = String(element.x);
					const output = range.parentElement.querySelector("output");
					if (output) output.textContent = element.x + "%";
				}
				if (labels[i].textContent === "Y %") {
					range.value = String(element.y);
					const output = range.parentElement.querySelector("output");
					if (output) output.textContent = element.y + "%";
				}
			}
		}

		function reelSelectSceneElement(key) {
			reelSelectedElement = key;
			reelRenderSceneControls();
			reelRedrawScene();
		}

		function reelRedrawScene() {
			if (!reelSceneMode || !ctx || !editorView || editorView.style.display === "none") return;
			drawScene(ctx, TPL_W, TPL_H, previewT % Math.max(1, duration), currentVarDef(), current());
		}

		function reelAddTextElement() {
			const state = reelSelectedState();
			let count = 1;
			while (state.elements["text" + count]) count++;
			const key = "text" + count;
			state.elements[key] = {
				type: "text", label: "Text " + count, text: "New text",
				x: 50, y: 50, size: 32, color: "#ffffff", font: "sans", align: "center",
				anim: "none", transition: "fade", transitionSpeed: 1,
				speed: 1, visible: true, deleted: false
			};
			reelSelectSceneElement(key);
		}

		function reelAddGraphicElement() {
			const state = reelSelectedState();
			let count = 2;
			while (state.elements["graphic" + count]) count++;
			const key = "graphic" + count;
			const selected = state.elements[reelSelectedElement];
			const source = selected && selected.type === "graphic" ? selected : state.elements.graphic;
			state.elements[key] = {
				type: "graphic", label: "Graphic " + count,
				kind: source ? source.kind : "circle",
				x: reelClamp((source ? Number(source.x) : 50) + 8, 5, 95),
				y: reelClamp((source ? Number(source.y) : 50) + 8, 5, 95),
				size: source ? Number(source.size) : 64,
				color: source ? source.color : "#7aac2b",
				anim: source ? source.anim : "float",
				transition: source ? source.transition : "zoom",
				transitionSpeed: source ? Number(source.transitionSpeed) : 1,
				speed: source ? Number(source.speed) : 1,
				visible: true, deleted: false
			};
			reelSelectSceneElement(key);
		}

		function reelAddSceneElement() {
			const selected = reelSelectedState().elements[reelSelectedElement];
			if (selected && selected.type === "graphic") reelAddGraphicElement();
			else reelAddTextElement();
		}

		function reelBuildSceneList() {
			const host = document.getElementById("tm-scene-list");
			if (!host) return;
			host.innerHTML = "";
			REEL_SCENES.forEach(function (scene, index) {
				const button = reelButton((index + 1) + " · " + scene.name, "tm-scene-list-button", function () {
					reelOpenSceneEditor(index);
				});
				button.classList.toggle("active", index === reelSceneIndex);
				host.appendChild(button);
			});
		}

		function reelSetEditorControls(sceneMode) {
			const motion = document.getElementById("tm-motion-controls");
			const scene = document.getElementById("tm-scene-controls");
			const objects = document.getElementById("tm-scene-objects");
			const badge = document.getElementById("tm-scene-selection-badge");
			const stage = document.getElementById("tm-stage");
			if (motion) motion.style.display = sceneMode ? "none" : "";
			if (scene) scene.style.display = sceneMode ? "" : "none";
			if (objects) objects.style.display = sceneMode ? "flex" : "none";
			if (badge) badge.style.display = sceneMode ? "" : "none";
			if (stage) stage.classList.toggle("tm-reel-stage", !!sceneMode);
			const description = document.getElementById("tpl-sub");
			if (description) description.textContent = sceneMode
				? "Click a scene element to select it, or drag it on the canvas. The inspector changes for text, shapes and backgrounds. Your edits are rendered into the exported MP4 and can be added to this video’s gallery."
				: reelMotionDescription;
			const tip = document.querySelector("#tpl-modal .tpl-tips");
			if (tip) tip.textContent = sceneMode
				? "Scene text, stickers and animated backgrounds are rendered into the exported clip. The clip is silent — upload an MP3 in the accordion to add sound."
				: reelMotionTipText;
		}

		function reelOpenSceneEditor(index) {
			if (!reelSceneMode) reelPreviousOrientation = tplLandscape;
			reelSceneMode = true;
			reelGalleryCategory = "scenes";
			reelSceneIndex = reelClamp(index, 0, REEL_SCENES.length - 1);
			reelSelectedElement = "headline";
			const scene = REEL_SCENES[reelSceneIndex];
			const name = document.getElementById("tm-name");
			if (name) name.textContent = (reelSceneIndex + 1) + " · " + scene.name;
			reelSetEditorControls(true);
			if (orientEl) orientEl.value = "landscape";
			tplLandscape = true;
			TPL_W = TPL_LANDSCAPE_W;
			TPL_H = TPL_LANDSCAPE_H;
			if (canvas) {
				canvas.width = TPL_W;
				canvas.height = TPL_H;
			}
			const stage = document.getElementById("tm-stage");
			if (stage) stage.classList.add("landscape");
			if (durationEl) durationEl.value = String(duration);
			previewT = 0;
			paused = false;
			if (playBtn) playBtn.textContent = "\\u23f8 Pause";
			showView();
			if (statusEl) statusEl.textContent = "Editing scene " + (reelSceneIndex + 1) + " · click an element to configure it, then export or add it to Video " + modalVideo;
			reelBuildSceneList();
			reelRenderSceneControls();
			drawScene(ctx, TPL_W, TPL_H, 0, scene, reelSceneState(reelSceneIndex));
			ensureTicking();
		}

		const reelBaseOpenEditor = openEditor;
		openEditor = function (index) {
			if (reelSceneMode) reelExitSceneMode();
			reelSetEditorControls(false);
			return reelBaseOpenEditor(index);
		};

		const reelBaseShowGallery = showGallery;
		showGallery = function () {
			const returningFromScenes = reelSceneMode;
			reelBaseShowGallery();
			if (returningFromScenes) {
				reelExitSceneMode();
				reelGalleryCategory = "scenes";
			}
			reelSetEditorControls(false);
			reelSetGalleryCategory(reelGalleryCategory);
		};

		function reelExitSceneMode() {
			if (!reelSceneMode) return;
			reelSceneMode = false;
			if (reelPreviousOrientation !== null) {
				const orientation = reelPreviousOrientation;
				reelPreviousOrientation = null;
				setOrientation(orientation);
				if (orientEl) orientEl.value = orientation ? "landscape" : "portrait";
			}
			reelSceneDrag = null;
			reelSceneHitAreas = [];
		}

		function reelScenePoint(event) {
			const rect = canvas.getBoundingClientRect();
			return {
				x: (event.clientX - rect.left) / Math.max(1, rect.width) * canvas.width,
				y: (event.clientY - rect.top) / Math.max(1, rect.height) * canvas.height,
				rect: rect
			};
		}

		function reelHitTest(point) {
			for (let i = reelSceneHitAreas.length - 1; i >= 0; i--) {
				const area = reelSceneHitAreas[i];
				if (point.x >= area.x && point.x <= area.x + area.width && point.y >= area.y && point.y <= area.y + area.height) return area.key;
			}
			return "bg";
		}

		function reelBindCanvas() {
			if (!canvas || canvas.dataset.reelBound === "1") return;
			canvas.dataset.reelBound = "1";
			canvas.addEventListener("pointerdown", function (event) {
				if (!reelSceneMode || !editorView || editorView.style.display === "none") return;
				const point = reelScenePoint(event);
				const key = reelHitTest(point);
				reelSelectSceneElement(key);
				const element = reelSelectedState().elements[key];
				if (element && !element.deleted && element.visible !== false) {
					reelSceneDrag = {
						key: key,
						startX: event.clientX,
						startY: event.clientY,
						originX: Number(element.x),
						originY: Number(element.y)
					};
					try { canvas.setPointerCapture(event.pointerId); } catch (error) { }
				}
				event.preventDefault();
			});
			canvas.addEventListener("pointermove", function (event) {
				if (!reelSceneMode) return;
				if (reelSceneDrag) {
					const element = reelSelectedState().elements[reelSceneDrag.key];
					const rect = canvas.getBoundingClientRect();
					if (!element) return;
					element.x = reelClamp(reelSceneDrag.originX + (event.clientX - reelSceneDrag.startX) / Math.max(1, rect.width) * 100, 0, 100);
					element.y = reelClamp(reelSceneDrag.originY + (event.clientY - reelSceneDrag.startY) / Math.max(1, rect.height) * 100, 0, 100);
					reelSyncPositionRanges();
					reelRedrawScene();
					event.preventDefault();
				}
				else {
					canvas.style.cursor = reelHitTest(reelScenePoint(event)) === "bg" ? "default" : "grab";
				}
			});
			const finishDrag = function () { reelSceneDrag = null; };
			canvas.addEventListener("pointerup", finishDrag);
			canvas.addEventListener("pointercancel", finishDrag);
		}

		const reelBaseBuildModal = buildModal;
		buildModal = function (videoNumber) {
			reelBaseBuildModal(videoNumber);
			if (reelSceneEditorReady) return;
			reelSceneEditorReady = true;
			const gallery = document.getElementById("tm-gallery");
			const motionGrid = document.getElementById("tm-grid");
			const side = document.querySelector("#tm-editor .tm-side");
			const stage = document.getElementById("tm-stage");
			if (!gallery || !motionGrid || !side || !stage) return;
			reelMotionDescription = document.getElementById("tpl-sub").textContent;
			reelMotionTipText = document.querySelector("#tpl-modal .tpl-tips").textContent;

			const tabs = document.createElement("div");
			tabs.className = "tm-gallery-tabs";
			tabs.innerHTML = '<button type="button" id="tm-tab-scenes" class="tm-gallery-tab active" aria-pressed="true">Interactive scenes · ' + REEL_SCENES.length + '</button>';
			gallery.insertBefore(tabs, motionGrid);
			motionGrid.remove();
			galleryCanvases = [];
			const sceneGrid = document.createElement("div");
			sceneGrid.id = "tm-scene-grid";
			sceneGrid.className = "tm-gallery-grid tm-scene-gallery-grid";
			sceneGrid.style.display = "none";
			gallery.appendChild(sceneGrid);
			document.getElementById("tm-tab-scenes").addEventListener("click", function () { reelSetGalleryCategory("scenes"); });

			const motionControls = document.createElement("div");
			motionControls.id = "tm-motion-controls";
			motionControls.className = "tm-motion-controls";
			while (side.firstChild) motionControls.appendChild(side.firstChild);
			side.appendChild(motionControls);

			const sceneControls = document.createElement("div");
			sceneControls.id = "tm-scene-controls";
			sceneControls.className = "tm-scene-controls";
			sceneControls.style.display = "none";
			sceneControls.innerHTML = '<div class="tm-scene-panel"><div class="tm-scene-panel-head"><div><div class="tm-scene-kicker">REEL EDITOR</div><div class="tm-sec-title">Scene elements</div></div><button type="button" id="tm-scene-add-text" class="tm-scene-add">＋ Text</button></div><p class="tm-scene-hint">Click an object in the preview to load its controls. Drag to move it.</p><div id="tm-scene-inspector" class="tm-scene-inspector"></div></div><details class="tm-scene-switcher"><summary>Scenes · ' + REEL_SCENES.length + ' editable designs</summary><div id="tm-scene-list" class="tm-scene-list"></div></details>';
			side.appendChild(sceneControls);
			document.getElementById("tm-scene-add-text").addEventListener("click", reelAddSceneElement);

			const objects = document.createElement("div");
			objects.id = "tm-scene-objects";
			objects.className = "tm-scene-objects";
			objects.style.display = "none";
			objects.setAttribute("aria-label", "Scene elements");
			if (stage.parentNode) stage.parentNode.insertBefore(objects, stage.nextSibling);

			const badge = document.createElement("div");
			badge.id = "tm-scene-selection-badge";
			badge.className = "tm-scene-selection-badge";
			badge.style.display = "none";
			badge.textContent = "Headline selected · drag to move";
			stage.appendChild(badge);
			reelBuildSceneGallery();
			reelBindCanvas();
			reelSetGalleryCategory(reelGalleryCategory);
		};

		const reelBaseExportMP4 = exportMP4;
		exportMP4 = async function (options) {
			if (reelSceneMode) {
				await REEL_SCENE_IMAGES_READY;
				if (document.fonts && document.fonts.ready) await document.fonts.ready;
			}
			return reelBaseExportMP4(options);
		};

		const reelBaseOpenTemplateModal = window.openTemplateModal;
		window.openTemplateModal = function (videoNumber) {
			reelExitSceneMode();
			reelGalleryCategory = "scenes";
			const result = reelBaseOpenTemplateModal(videoNumber);
			reelSetGalleryCategory(reelGalleryCategory);
			return result;
		};
		const reelBaseCloseTemplateModal = window.closeTemplateModal;
		window.closeTemplateModal = function () {
			reelExitSceneMode();
			reelSetEditorControls(false);
			return reelBaseCloseTemplateModal();
		};
		window.openTemplateModal = window.openTemplateModal;
		window.closeTemplateModal = window.closeTemplateModal;
		ensureTicking();
`;
