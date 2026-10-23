/*
 * Shape & Motion objects adapted from the uploaded MotionGenie gallery.
 * This module runs inside TEMPLATE_COMPOSER_JS's IIFE, after the Reel scene
 * editor, so the objects share its controls and the composer's MP4 exporter.
 * Confetti and every other particle effect are deliberately excluded.
 */
export const TEMPLATE_SHAPE_ANIMATIONS_JS = `
		// =========================================================
		// SHAPE ANIMATIONS — 13 canvas objects, no particle effects
		// =========================================================
		const SHAPE_ANIMATIONS = [
			{ n: 47, name: "Morphing SVG Blob", kind: "blob", color: "#6366f1", accent: "#a855f7", background: "#0d111a", size: 42 },
			{ n: 48, name: "Rotating 3D Box", kind: "cube", color: "#6366f1", accent: "#22d3ee", background: "#0d111a", size: 44 },
			{ n: 49, name: "Pulsing Ripple Ring", kind: "ripple", color: "#6366f1", accent: "#818cf8", background: "#0d111a", size: 46 },
			{ n: 50, name: "Floating Glass Card", kind: "glass", color: "#e0e7ff", accent: "#818cf8", background: "#111827", size: 44 },
			{ n: 51, name: "Orbiting Satellite", kind: "orbit", color: "#818cf8", accent: "#22d3ee", background: "#0d111a", size: 46 },
			{ n: 52, name: "DNA Helix Pulse", kind: "helix", color: "#6366f1", accent: "#ec4899", background: "#0d111a", size: 46 },
			{ n: 53, name: "Infinite Tunnel Zoom", kind: "tunnel", color: "#6366f1", accent: "#ec4899", background: "#000000", size: 48 },
			{ n: 54, name: "Kaleidoscope Spinner", kind: "kaleidoscope", color: "#818cf8", accent: "#22d3ee", background: "#0d111a", size: 44 },
			{ n: 56, name: "Elastic Bounce Ball", kind: "ball", color: "#6366f1", accent: "#818cf8", background: "#0d111a", size: 40 },
			{ n: 57, name: "Audio Equalizer Bars", kind: "equalizer", color: "#6366f1", accent: "#22d3ee", background: "#0d111a", size: 44 },
			{ n: 58, name: "Diamond Crystal Spin", kind: "diamond", color: "#22d3ee", accent: "#4f46e5", background: "#0d111a", size: 40 },
			{ n: 59, name: "Neon Laser Beam", kind: "laser", color: "#22d3ee", accent: "#6366f1", background: "#000000", size: 42 },
			{ n: 60, name: "Shimmer Spinner Ring", kind: "spinner", color: "#6366f1", accent: "#a855f7", background: "#0d111a", size: 42 }
		];
		SHAPE_ANIMATIONS.forEach(function (scene) { scene.shapeAnimation = true; });

		let shapeMode = false;
		let shapeIndex = 0;
		let shapeStates = [];
		let shapeGalleryCanvases = [];
		let shapeEditorReady = false;

		function shapeDefaultState(index) {
			const scene = SHAPE_ANIMATIONS[index];
			return {
				color: scene.color,
				accent: scene.accent,
				background: scene.background,
				size: scene.size,
				speed: 1,
				x: 50,
				y: 50
			};
		}

		function shapeState(index) {
			if (!shapeStates[index]) shapeStates[index] = shapeDefaultState(index);
			return shapeStates[index];
		}

		function shapeRoundedRect(context, x, y, width, height, radius) {
			const r = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
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

		function shapeDrawCube(context, time, size, color, accent) {
			const vertices = [
				[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
				[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
			];
			const faces = [
				[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
				[2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]
			];
			const ay = time * 1.35;
			const ax = time * 0.82;
			const cosY = Math.cos(ay);
			const sinY = Math.sin(ay);
			const cosX = Math.cos(ax);
			const sinX = Math.sin(ax);
			const projected = vertices.map(function (vertex) {
				const x1 = vertex[0] * cosY - vertex[2] * sinY;
				const z1 = vertex[0] * sinY + vertex[2] * cosY;
				const y2 = vertex[1] * cosX - z1 * sinX;
				const z2 = vertex[1] * sinX + z1 * cosX;
				const perspective = 4.2 / (4.2 - z2);
				return {
					x: x1 * size * 0.31 * perspective,
					y: y2 * size * 0.31 * perspective,
					z: z2
				};
			});
			const ordered = faces.map(function (face, index) {
				const depth = face.reduce(function (sum, vertexIndex) {
					return sum + projected[vertexIndex].z;
				}, 0) / face.length;
				return { face: face, index: index, depth: depth };
			}).sort(function (a, b) { return a.depth - b.depth; });
			context.save();
			context.lineJoin = "round";
			context.lineWidth = Math.max(1.5, size * 0.018);
			ordered.forEach(function (item) {
				context.beginPath();
				item.face.forEach(function (vertexIndex, pointIndex) {
					const point = projected[vertexIndex];
					if (pointIndex === 0) context.moveTo(point.x, point.y);
					else context.lineTo(point.x, point.y);
				});
				context.closePath();
				context.globalAlpha = 0.3 + (item.depth + 2) * 0.1;
				context.fillStyle = item.index % 2 ? accent : color;
				context.fill();
				context.globalAlpha = 0.95;
				context.strokeStyle = item.index % 2 ? color : accent;
				context.stroke();
			});
			context.restore();
		}

		function shapeDrawObject(context, kind, time, size, color, accent) {
			context.save();
			context.strokeStyle = color;
			context.fillStyle = color;
			context.lineCap = "round";
			context.lineJoin = "round";

			if (kind === "blob") {
				const gradient = context.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
				gradient.addColorStop(0, color);
				gradient.addColorStop(1, accent);
				context.fillStyle = gradient;
				context.shadowColor = color;
				context.shadowBlur = size * 0.12;
				context.beginPath();
				for (let i = 0; i <= 72; i++) {
					const angle = i / 72 * Math.PI * 2;
					const radius = size * 0.43 * (1 + Math.sin(angle * 3 + time * 1.7) * 0.1 + Math.cos(angle * 2 - time * 1.25) * 0.065);
					const x = Math.cos(angle) * radius;
					const y = Math.sin(angle) * radius;
					if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
				}
				context.closePath();
				context.fill();
			}
			else if (kind === "cube") {
				shapeDrawCube(context, time, size, color, accent);
			}
			else if (kind === "ripple") {
				for (let i = 0; i < 3; i++) {
					const phase = (time * 0.58 + i / 3) % 1;
					context.save();
					context.globalAlpha = (1 - phase) * 0.72;
					context.strokeStyle = i % 2 ? accent : color;
					context.lineWidth = Math.max(1.5, size * 0.025 * (1 - phase * 0.45));
					context.beginPath();
					context.arc(0, 0, size * (0.14 + phase * 0.42), 0, Math.PI * 2);
					context.stroke();
					context.restore();
				}
				context.shadowColor = color;
				context.shadowBlur = size * 0.12;
				context.beginPath();
				context.arc(0, 0, size * 0.12, 0, Math.PI * 2);
				context.fill();
			}
			else if (kind === "glass") {
				context.translate(0, Math.sin(time * 1.65) * size * 0.08);
				context.rotate(Math.sin(time * 1.1) * 0.035);
				const width = size * 1.45;
				const height = size * 0.72;
				context.shadowColor = "rgba(0,0,0,0.45)";
				context.shadowBlur = size * 0.15;
				context.shadowOffsetY = size * 0.08;
				shapeRoundedRect(context, -width / 2, -height / 2, width, height, size * 0.09);
				context.globalAlpha = 0.15;
				context.fillStyle = "#ffffff";
				context.fill();
				context.shadowColor = "transparent";
				context.globalAlpha = 0.85;
				context.strokeStyle = color;
				context.lineWidth = Math.max(1.5, size * 0.018);
				context.stroke();
				context.globalAlpha = 0.9;
				context.fillStyle = accent;
				shapeRoundedRect(context, -width * 0.34, -height * 0.1, width * 0.42, height * 0.09, height * 0.04);
				context.fill();
				context.globalAlpha = 0.45;
				shapeRoundedRect(context, -width * 0.34, height * 0.09, width * 0.68, height * 0.055, height * 0.025);
				context.fill();
			}
			else if (kind === "orbit") {
				context.save();
				context.globalAlpha = 0.35;
				context.lineWidth = Math.max(1.5, size * 0.018);
				context.beginPath();
				context.arc(0, 0, size * 0.43, 0, Math.PI * 2);
				context.stroke();
				context.restore();
				context.fillStyle = color;
				context.shadowColor = color;
				context.shadowBlur = size * 0.09;
				context.beginPath();
				context.arc(0, 0, size * 0.12, 0, Math.PI * 2);
				context.fill();
				const angle = time * 1.7;
				const x = Math.cos(angle) * size * 0.43;
				const y = Math.sin(angle) * size * 0.43;
				context.fillStyle = accent;
				context.shadowColor = accent;
				context.beginPath();
				context.arc(x, y, size * 0.065, 0, Math.PI * 2);
				context.fill();
			}
			else if (kind === "helix") {
				const points = 9;
				for (let i = 0; i < points; i++) {
					const x = (i / (points - 1) - 0.5) * size * 1.15;
					const wave = Math.sin(time * 2.2 + i * 0.72) * size * 0.22;
					context.save();
					context.globalAlpha = 0.42;
					context.strokeStyle = i % 2 ? accent : color;
					context.lineWidth = Math.max(1, size * 0.014);
					context.beginPath();
					context.moveTo(x, wave);
					context.lineTo(x, -wave);
					context.stroke();
					context.restore();
					context.fillStyle = color;
					context.beginPath();
					context.arc(x, wave, size * 0.035, 0, Math.PI * 2);
					context.fill();
					context.fillStyle = accent;
					context.beginPath();
					context.arc(x, -wave, size * 0.035, 0, Math.PI * 2);
					context.fill();
				}
			}
			else if (kind === "tunnel") {
				for (let i = 0; i < 6; i++) {
					const phase = (time * 0.38 + i / 6) % 1;
					const side = size * (0.08 + phase * 0.92);
					context.save();
					context.rotate(time * 0.13 + i * 0.11);
					context.globalAlpha = Math.sin(phase * Math.PI) * 0.78;
					context.strokeStyle = i % 3 === 0 ? accent : color;
					context.lineWidth = Math.max(1.2, size * 0.018);
					context.strokeRect(-side / 2, -side / 2, side, side);
					context.restore();
				}
			}
			else if (kind === "kaleidoscope") {
				context.rotate(time * 0.85);
				context.lineWidth = Math.max(1.5, size * 0.022);
				context.setLineDash([size * 0.07, size * 0.045]);
				context.beginPath();
				context.arc(0, 0, size * 0.43, 0, Math.PI * 2);
				context.stroke();
				context.setLineDash([]);
				for (let i = 0; i < 8; i++) {
					context.save();
					context.rotate(i * Math.PI / 4);
					context.fillStyle = i % 2 ? accent : color;
					context.globalAlpha = 0.72;
					context.beginPath();
					context.moveTo(0, -size * 0.1);
					context.lineTo(size * 0.075, -size * 0.31);
					context.lineTo(0, -size * 0.39);
					context.lineTo(-size * 0.075, -size * 0.31);
					context.closePath();
					context.fill();
					context.restore();
				}
				context.fillStyle = accent;
				context.beginPath();
				context.arc(0, 0, size * 0.075, 0, Math.PI * 2);
				context.fill();
			}
			else if (kind === "ball") {
				const phase = (time % 1.35) / 1.35;
				const lift = 4 * phase * (1 - phase);
				const y = size * 0.34 - lift * size * 0.7;
				context.save();
				context.globalAlpha = 0.28 - lift * 0.15;
				context.fillStyle = "#000000";
				context.beginPath();
				context.ellipse(0, size * 0.46, size * (0.25 - lift * 0.07), size * 0.055, 0, 0, Math.PI * 2);
				context.fill();
				context.restore();
				context.save();
				context.translate(0, y);
				context.scale(1.08 - lift * 0.08, 0.9 + lift * 0.1);
				const gradient = context.createRadialGradient(-size * 0.08, -size * 0.1, 0, 0, 0, size * 0.32);
				gradient.addColorStop(0, accent);
				gradient.addColorStop(1, color);
				context.fillStyle = gradient;
				context.shadowColor = color;
				context.shadowBlur = size * 0.13;
				context.beginPath();
				context.arc(0, 0, size * 0.25, 0, Math.PI * 2);
				context.fill();
				context.restore();
			}
			else if (kind === "equalizer") {
				const bars = 7;
				for (let i = 0; i < bars; i++) {
					const wave = (Math.sin(time * (3.1 + i * 0.17) + i * 1.13) + 1) / 2;
					const barHeight = size * (0.18 + wave * 0.68);
					const x = (i - (bars - 1) / 2) * size * 0.16;
					context.fillStyle = i % 3 === 1 ? accent : color;
					context.shadowColor = context.fillStyle;
					context.shadowBlur = size * 0.045;
					shapeRoundedRect(context, x - size * 0.045, size * 0.43 - barHeight, size * 0.09, barHeight, size * 0.045);
					context.fill();
				}
			}
			else if (kind === "diamond") {
				context.rotate(time * 1.05);
				const gradient = context.createLinearGradient(-size * 0.35, -size * 0.35, size * 0.35, size * 0.35);
				gradient.addColorStop(0, color);
				gradient.addColorStop(1, accent);
				context.fillStyle = gradient;
				context.shadowColor = color;
				context.shadowBlur = size * 0.1;
				context.beginPath();
				context.moveTo(0, -size * 0.43);
				context.lineTo(size * 0.34, 0);
				context.lineTo(0, size * 0.43);
				context.lineTo(-size * 0.34, 0);
				context.closePath();
				context.fill();
				context.save();
				context.globalAlpha = 0.48;
				context.strokeStyle = "#ffffff";
				context.lineWidth = Math.max(1, size * 0.012);
				context.beginPath();
				context.moveTo(0, -size * 0.43);
				context.lineTo(0, size * 0.43);
				context.moveTo(-size * 0.34, 0);
				context.lineTo(size * 0.34, 0);
				context.stroke();
				context.restore();
			}
			else if (kind === "laser") {
				const pulse = 0.72 + (Math.sin(time * 4.2) + 1) * 0.14;
				context.globalAlpha = pulse;
				context.shadowColor = color;
				context.shadowBlur = size * 0.16;
				context.strokeStyle = color;
				context.lineWidth = Math.max(2, size * 0.035);
				context.beginPath();
				context.moveTo(-size * 0.92, 0);
				context.lineTo(size * 0.92, 0);
				context.stroke();
				context.shadowBlur = size * 0.05;
				context.strokeStyle = "#ffffff";
				context.lineWidth = Math.max(1, size * 0.009);
				context.stroke();
				context.fillStyle = accent;
				context.beginPath();
				context.arc(-size * 0.92, 0, size * 0.035, 0, Math.PI * 2);
				context.fill();
				context.beginPath();
				context.arc(size * 0.92, 0, size * 0.035, 0, Math.PI * 2);
				context.fill();
			}
			else if (kind === "spinner") {
				context.save();
				context.globalAlpha = 0.2;
				context.lineWidth = Math.max(3, size * 0.075);
				context.beginPath();
				context.arc(0, 0, size * 0.36, 0, Math.PI * 2);
				context.stroke();
				context.restore();
				context.rotate(time * 2.2);
				context.shadowColor = color;
				context.shadowBlur = size * 0.08;
				context.lineWidth = Math.max(3, size * 0.075);
				context.beginPath();
				context.arc(0, 0, size * 0.36, -Math.PI / 2, Math.PI * 0.65);
				context.stroke();
				context.strokeStyle = accent;
				context.lineWidth = Math.max(1.5, size * 0.028);
				context.beginPath();
				context.arc(0, 0, size * 0.25, Math.PI * 0.2, Math.PI * 1.25);
				context.stroke();
			}
			context.restore();
		}

		function shapeDrawScene(context, width, height, time, scene, state) {
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.globalAlpha = 1;
			context.globalCompositeOperation = "source-over";
			if ("filter" in context) context.filter = "none";
			context.clearRect(0, 0, width, height);
			context.fillStyle = state.background || scene.background;
			context.fillRect(0, 0, width, height);
			const glow = context.createRadialGradient(width * state.x / 100, height * state.y / 100, 0, width * state.x / 100, height * state.y / 100, Math.min(width, height) * 0.58);
			glow.addColorStop(0, state.color);
			glow.addColorStop(1, "rgba(0,0,0,0)");
			context.save();
			context.globalAlpha = 0.1;
			context.fillStyle = glow;
			context.fillRect(0, 0, width, height);
			context.restore();
			const size = Math.min(width, height) * Number(state.size) / 100;
			context.save();
			context.translate(width * Number(state.x) / 100, height * Number(state.y) / 100);
			shapeDrawObject(context, scene.kind, Math.max(0, time) * Number(state.speed || 1), size, state.color, state.accent);
			context.restore();
		}

		function shapeRedraw() {
			if (!shapeMode || !ctx || !editorView || editorView.style.display === "none") return;
			drawScene(ctx, TPL_W, TPL_H, previewT % Math.max(1, duration), SHAPE_ANIMATIONS[shapeIndex], shapeState(shapeIndex));
		}

		function shapeRenderControls() {
			const inspector = document.getElementById("tm-shape-inspector");
			if (!inspector) return;
			const state = shapeState(shapeIndex);
			inspector.innerHTML = "";
			reelAddSelect(inspector, "Object", SHAPE_ANIMATIONS.map(function (scene, index) {
				return [scene.n + " · " + scene.name, String(index)];
			}), String(shapeIndex), function (value) { shapeOpenEditor(Number(value)); });
			reelAddColor(inspector, "Main colour", state.color, function (value) { state.color = value; shapeRedraw(); });
			reelAddColor(inspector, "Accent colour", state.accent, function (value) { state.accent = value; shapeRedraw(); });
			reelAddColor(inspector, "Background", state.background, function (value) { state.background = value; shapeRedraw(); });
			reelAddRange(inspector, "Size", state.size, 12, 70, 1, function (value) { state.size = value; shapeRedraw(); }, "%");
			reelAddRange(inspector, "Speed", state.speed, 0.25, 2.5, 0.05, function (value) { state.speed = value; shapeRedraw(); }, "×");
			reelAddRange(inspector, "X %", state.x, 0, 100, 1, function (value) { state.x = value; shapeRedraw(); }, "%");
			reelAddRange(inspector, "Y %", state.y, 0, 100, 1, function (value) { state.y = value; shapeRedraw(); }, "%");
			const reset = reelButton("Reset object", "tm-scene-secondary", function () {
				shapeStates[shapeIndex] = shapeDefaultState(shapeIndex);
				shapeRenderControls();
				shapeRedraw();
			});
			inspector.appendChild(reset);
		}

		function shapeExitMode() {
			shapeMode = false;
			const controls = document.getElementById("tm-shape-controls");
			if (controls) controls.style.display = "none";
			const stage = document.getElementById("tm-stage");
			if (stage) stage.classList.remove("tm-shape-stage");
		}

		function shapeOpenEditor(index) {
			if (reelSceneMode) reelExitSceneMode();
			shapeMode = true;
			shapeIndex = Math.max(0, Math.min(SHAPE_ANIMATIONS.length - 1, Number(index) || 0));
			reelGalleryCategory = "shapes";
			const scene = SHAPE_ANIMATIONS[shapeIndex];
			const name = document.getElementById("tm-name");
			if (name) name.textContent = scene.n + " · " + scene.name;
			reelSetEditorControls(false);
			if (durationEl) durationEl.value = String(duration);
			previewT = 0;
			paused = false;
			if (playBtn) playBtn.textContent = "⏸ Pause";
			shapeRenderControls();
			showView();
			if (statusEl) statusEl.textContent = "Editing " + scene.name + " · adjust the animated object, then export or add it to Video " + modalVideo;
			drawScene(ctx, TPL_W, TPL_H, 0, scene, shapeState(shapeIndex));
			ensureTicking();
		}

		function shapeBuildGallery() {
			const grid = document.getElementById("tm-shape-grid");
			if (!grid) return;
			grid.innerHTML = "";
			shapeGalleryCanvases = [];
			SHAPE_ANIMATIONS.forEach(function (scene, index) {
				const card = document.createElement("button");
				card.type = "button";
				card.className = "tm-gcard tm-shape-card";
				card.setAttribute("data-shape", String(index));
				card.setAttribute("aria-label", "Edit " + scene.name);
				const frame = document.createElement("span");
				frame.className = "tm-gframe tm-scene-gframe";
				const preview = document.createElement("canvas");
				preview.className = "tm-gcanvas tm-scene-gcanvas";
				preview.width = 360;
				preview.height = 203;
				frame.appendChild(preview);
				const name = document.createElement("span");
				name.className = "tm-gname";
				name.textContent = scene.n + " · " + scene.name;
				const tag = document.createElement("span");
				tag.className = "tm-gtag";
				tag.textContent = "Shape animation · click to edit";
				card.appendChild(frame);
				card.appendChild(name);
				card.appendChild(tag);
				card.addEventListener("click", function () { shapeOpenEditor(index); });
				grid.appendChild(card);
				const previewContext = preview.getContext("2d");
				const state = shapeDefaultState(index);
				shapeGalleryCanvases.push({ canvas: preview, ctx: previewContext, scene: scene, state: state });
				if (previewContext) shapeDrawScene(previewContext, preview.width, preview.height, 0, scene, state);
			});
		}

		const shapeBaseDrawScene = drawScene;
		drawScene = function (context, width, height, time, scene, state) {
			if (scene && scene.shapeAnimation) {
				shapeDrawScene(context, width, height, time, scene, state);
				return;
			}
			return shapeBaseDrawScene(context, width, height, time, scene, state);
		};

		const shapeBaseCurrent = current;
		current = function () {
			return shapeMode ? shapeState(shapeIndex) : shapeBaseCurrent();
		};
		const shapeBaseCurrentVarDef = currentVarDef;
		currentVarDef = function () {
			return shapeMode ? SHAPE_ANIMATIONS[shapeIndex] : shapeBaseCurrentVarDef();
		};

		const shapeBaseTick = tick;
		tick = function (now) {
			shapeBaseTick(now);
			if (!modal || modal.style.display === "none" || !galleryView || galleryView.style.display === "none" || reelGalleryCategory !== "shapes") return;
			for (const preview of shapeGalleryCanvases) {
				if (preview && preview.ctx) shapeDrawScene(preview.ctx, preview.canvas.width, preview.canvas.height, previewT % 12, preview.scene, preview.state);
			}
		};

		const shapeBaseSetGalleryCategory = reelSetGalleryCategory;
		reelSetGalleryCategory = function (category) {
			const shapeGrid = document.getElementById("tm-shape-grid");
			const shapeTab = document.getElementById("tm-tab-shapes");
			if (category === "shapes") {
				reelGalleryCategory = "shapes";
				const sceneGrid = document.getElementById("tm-scene-grid");
				if (sceneGrid) sceneGrid.style.display = "none";
				if (shapeGrid) shapeGrid.style.display = "";
				const sceneTab = document.getElementById("tm-tab-scenes");
				if (sceneTab) {
					sceneTab.classList.remove("active");
					sceneTab.setAttribute("aria-pressed", "false");
				}
				if (shapeTab) {
					shapeTab.classList.add("active");
					shapeTab.setAttribute("aria-pressed", "true");
				}
				return;
			}
			if (shapeGrid) shapeGrid.style.display = "none";
			if (shapeTab) {
				shapeTab.classList.remove("active");
				shapeTab.setAttribute("aria-pressed", "false");
			}
			return shapeBaseSetGalleryCategory(category);
		};

		const shapeBaseSetEditorControls = reelSetEditorControls;
		reelSetEditorControls = function (sceneMode) {
			const shapeControls = document.getElementById("tm-shape-controls");
			const stage = document.getElementById("tm-stage");
			if (shapeMode) {
				shapeBaseSetEditorControls(false);
				const motion = document.getElementById("tm-motion-controls");
				const scenes = document.getElementById("tm-scene-controls");
				if (motion) motion.style.display = "none";
				if (scenes) scenes.style.display = "none";
				if (shapeControls) shapeControls.style.display = "";
				if (stage) {
					stage.classList.remove("tm-reel-stage");
					stage.classList.add("tm-shape-stage");
				}
				const description = document.getElementById("tpl-sub");
				if (description) description.textContent = "Edit a looping shape animation from the uploaded MotionGenie gallery. Change its colours, size, speed and position, then export it as an MP4 or add it to this video’s gallery. Particle effects are not included.";
				const tip = document.querySelector("#tpl-modal .tpl-tips");
				if (tip) tip.textContent = "The shape preview and MP4 export use the same canvas renderer. The clip is silent — upload an MP3 in the accordion to add sound.";
				return;
			}
			if (shapeControls) shapeControls.style.display = "none";
			if (stage) stage.classList.remove("tm-shape-stage");
			return shapeBaseSetEditorControls(sceneMode);
		};

		const shapeBaseOpenEditor = openEditor;
		openEditor = function (index) {
			shapeExitMode();
			return shapeBaseOpenEditor(index);
		};
		const shapeBaseOpenSceneEditor = reelOpenSceneEditor;
		reelOpenSceneEditor = function (index) {
			shapeExitMode();
			return shapeBaseOpenSceneEditor(index);
		};
		const shapeBaseShowGallery = showGallery;
		showGallery = function () {
			const returningFromShapes = shapeMode;
			if (returningFromShapes) shapeExitMode();
			const result = shapeBaseShowGallery();
			if (returningFromShapes) reelGalleryCategory = "shapes";
			reelSetGalleryCategory(reelGalleryCategory);
			return result;
		};

		const shapeBaseBuildModal = buildModal;
		buildModal = function (videoNumber) {
			shapeBaseBuildModal(videoNumber);
			if (shapeEditorReady) return;
			shapeEditorReady = true;
			const gallery = document.getElementById("tm-gallery");
			const tabs = document.querySelector("#tm-gallery .tm-gallery-tabs");
			const side = document.querySelector("#tm-editor .tm-side");
			if (!gallery || !tabs || !side) return;
			const shapeTab = document.createElement("button");
			shapeTab.type = "button";
			shapeTab.id = "tm-tab-shapes";
			shapeTab.className = "tm-gallery-tab";
			shapeTab.setAttribute("aria-pressed", "false");
			shapeTab.textContent = "Shape animations · 13";
			shapeTab.addEventListener("click", function () { reelSetGalleryCategory("shapes"); });
			tabs.appendChild(shapeTab);
			const shapeGrid = document.createElement("div");
			shapeGrid.id = "tm-shape-grid";
			shapeGrid.className = "tm-gallery-grid tm-shape-gallery-grid";
			shapeGrid.style.display = "none";
			gallery.appendChild(shapeGrid);
			const shapeControls = document.createElement("div");
			shapeControls.id = "tm-shape-controls";
			shapeControls.className = "tm-scene-controls tm-shape-controls";
			shapeControls.style.display = "none";
			shapeControls.innerHTML = '<div class="tm-scene-panel"><div class="tm-scene-kicker">SHAPES & MOTION</div><div class="tm-sec-title">Animated object</div><p class="tm-scene-hint">Thirteen canvas-rendered objects from the uploaded gallery. Particle effects are not included.</p><div id="tm-shape-inspector" class="tm-scene-inspector tm-shape-inspector"></div></div>';
			side.appendChild(shapeControls);
			shapeBuildGallery();
			reelSetGalleryCategory(reelGalleryCategory);
		};

		const shapeBaseOpenTemplateModal = window.openTemplateModal;
		window.openTemplateModal = function (videoNumber) {
			shapeExitMode();
			const result = shapeBaseOpenTemplateModal(videoNumber);
			reelSetGalleryCategory(reelGalleryCategory);
			return result;
		};
		const shapeBaseCloseTemplateModal = window.closeTemplateModal;
		window.closeTemplateModal = function () {
			shapeExitMode();
			return shapeBaseCloseTemplateModal();
		};
`;
