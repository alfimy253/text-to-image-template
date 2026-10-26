/*
 * TEMPLATE_COMPOSER_JS — MODULE 9: the "Add video from
 * template" composer modal (15 click-to-edit Interactive scenes, including the
 * 3D Ring Carousel, and 13 non-particle graphics in the element dropdown, with live preview,
 * dynamic text layers, photo transitions / motion, animated backgrounds, and
 * WebCodecs + mp4-muxer MP4 export / download). The exported
 * MP4 can also be dropped into the accordion gallery as a
 * normal clip. Self-contained IIFE appended right after APP_JS
 * inside the same <script> tag.
 *
 * Legacy typography drawing routines were adapted from the uploaded
 * "Typography Motion Studio III" HTML. They remain internal to this
 * module; the modal exposes no Motion tab or Motion template cards.
 *
 * Escapes inside this string are intentional — do not reformat.
 */

import { REEL_SCENE_EDITOR_JS } from "./template-scene-editor";
import { TEMPLATE_RING_CAROUSEL_JS } from "./template-ring-carousel";
import { TEMPLATE_SHAPE_ANIMATIONS_JS } from "./template-shape-animations";

export const TEMPLATE_COMPOSER_JS = `	// =========================================================
	// MODULE 9: template-composer
	// =========================================================
	//
	// The "Add video from template" text link inside every
	// Video N accordion opens a modal with TWO views:
	//
	//   1. Gallery — live animated previews of 15 Interactive scenes.
	//      Animated graphics are element choices, not separate templates.
	//   2. Editor  — chosen template controls: dynamic
	//      text layers (each with its own text, colour,
	//      position, animation and size), animation
	//      speed, photo entry transitions + motion,
	//      up to 2 photos and 21 animated backgrounds.
	//
	// Export renders the SAME canvas engine used for the
	// preview to an MP4 (WebCodecs VideoEncoder + mp4-muxer,
	// no FFmpeg, no screen capture): every frame is drawn on
	// the canvas (1080x1920 portrait or 1920x1080 landscape),
	// wrapped in a VideoFrame, encoded to H.264 and muxed
	// in memory. The MP4 downloads to disk and can also be
	// added to the accordion's Images / MP4s gallery as a
	// normal MP4 asset (same 5-clip / 60-second caps apply).
	//
	// Everything lives inside an IIFE so none of the
	// composer's names (VARIATIONS, drawScene, layers, ...)
	// can collide with the studio's globals. Only
	// window.openTemplateModal / window.closeTemplateModal
	// are exposed for the accordion link.

	(function () {

		"use strict";

		const TPL_PORTRAIT_W = 1080;
		const TPL_PORTRAIT_H = 1920;
		const TPL_LANDSCAPE_W = 1920;
		const TPL_LANDSCAPE_H = 1080;

		let TPL_W = TPL_PORTRAIT_W;
		let TPL_H = TPL_PORTRAIT_H;
		let tplLandscape = false;

		const TPL_FPS = 30;
		const TPL_VIDEO_BITRATE = 6_000_000;
		const TPL_MAX_DURATION = 25;

		const DEG = Math.PI / 180;

		/*
		 * The modal is built once and then reused: closing
		 * only hides it. The accordion link can retarget it
		 * at another Video N; the last exported MP4 survives
		 * between opens.
		 */

		let modal = null;
		let modalVideo = 0;
		let canvas = null;
		let ctx = null;

		let titleEl = null;
		let statusEl = null;
		let progressEl = null;
		let durationEl = null;
		let orientEl = null;
		let exportBtn = null;
		let addBtn = null;
		let galleryView = null;
		let editorView = null;
		let layersHost = null;
		let photosHost = null;
		let playBtn = null;

		let galleryCanvases = [];

		let previewT = 0;
		let previewLast = 0;
		let previewRaf = 0;
		let paused = false;
		let exporting = false;

		let duration = 6;

		/* Up to 2 photos, shared across templates. */
		let photos = [];
		let photoUrls = [];

		/* Per-template working state (layers + controls). */
		const states = [];
		let currentVar = 0;

		let lastVideo = null;

		/*
		 * Result of the last successful export:
		 * { blob, url, duration, name }.
		 */

		// -------------------------------------------------
		// Control vocabularies (from the motion studio).
		// -------------------------------------------------

		const COLORS = [
			["White", "#ffffff"], ["Black", "#111111"], ["Cream", "#f6f0df"],
			["Red", "#ff3b30"], ["Orange", "#ff7a00"], ["Amber", "#ffb000"],
			["Yellow", "#ffe600"], ["Lime", "#c8ff00"], ["Green", "#22c55e"],
			["Emerald", "#00a86b"], ["Mint", "#62f5c8"], ["Teal", "#00b8a9"],
			["Cyan", "#00e5ff"], ["Sky", "#38bdf8"], ["Blue", "#2563eb"],
			["Navy", "#14213d"], ["Indigo", "#4f46e5"], ["Violet", "#7c3aed"],
			["Purple", "#9333ea"], ["Magenta", "#e600ff"], ["Pink", "#ff4fa3"],
			["Rose", "#fb7185"], ["Coral", "#ff6f61"], ["Brown", "#8b5e3c"],
			["Tan", "#d2b48c"], ["Gold", "#d4af37"], ["Silver", "#c0c0c0"],
			["Gray", "#808080"], ["Charcoal", "#333333"], ["Aqua", "#00ffff"]
		];

		const POSITIONS = [
			["Top Left", "tl"], ["Top Center", "tc"], ["Top Right", "tr"],
			["Middle Left", "ml"], ["Center", "mc"], ["Middle Right", "mr"],
			["Bottom Left", "bl"], ["Bottom Center", "bc"], ["Bottom Right", "br"]
		];

		const POS_CYCLE = ["mc", "tc", "bc", "tr", "bl", "tl", "br", "ml", "mr"];

		const TEXT_ANIMS = [
			["None", "none"],
			["Halo Warp", "v19warp"],
			["Terminal Fracture", "v20terminal"],
			["Ribbon Editorial", "v21editorial"],
			["Portal Type", "v22tunnel"],
			["Comic Burst", "v23pop"],
			["Dream Echo", "v24echo"],
			["Perspective Fold", "v25fold"],
			["Liquid Bloom", "v26liquid"]
		];

		const ANIM_PERIODS = {
			none: 1,
			v19warp: 3.4,
			v20terminal: 2.2,
			v21editorial: 4,
			v22tunnel: 3,
			v23pop: 2.5,
			v24echo: 3.2,
			v25fold: 3.6,
			v26liquid: 4
		};

		const IMAGE_ENTRIES = [
			["Fade In", "fade"],
			["Slide From Left", "slide-left"],
			["Slide From Right", "slide-right"],
			["Rise From Bottom", "rise"],
			["Drop From Top", "drop"],
			["Pop In", "pop"],
			["Spin In", "spin"],
			["3D Flip In", "flip"],
			["Blur Reveal", "blur"]
		];

		const ENTRY_SPEEDS = [
			["Flash \\u00b7 0.25s", 0.25],
			["Fast \\u00b7 0.4s", 0.4],
			["Quick \\u00b7 0.55s", 0.55],
			["Smooth \\u00b7 0.75s", 0.75],
			["Slow \\u00b7 1s", 1],
			["Cinematic \\u00b7 1.25s", 1.25]
		];

		const IMAGE_MOTIONS = [
			["No Motion", "none"],
			["Zoom In", "zoom-in"],
			["Zoom Out", "zoom-out"],
			["Pulse Zoom", "pulse"],
			["Pan Left + Zoom", "pan-left"],
			["Pan Right + Zoom", "pan-right"],
			["Drift Up + Zoom", "drift-up"],
			["Drift Down + Zoom", "drift-down"],
			["Ken Burns", "ken-burns"],
			["Rotate + Zoom", "rotate-zoom"]
		];

		const MOTION_PERIODS = {
			none: 1,
			"zoom-in": 6,
			"zoom-out": 6,
			pulse: 3,
			"pan-left": 6,
			"pan-right": 6,
			"drift-up": 5,
			"drift-down": 5,
			"ken-burns": 7,
			"rotate-zoom": 6
		};

		const BACKGROUNDS = [
			["Template default", "default"],
			["Photo \\u00b7 First picture (blurred)", "photo"],
			["Color \\u00b7 Signal Orange", "color01"],
			["Color \\u00b7 Poster Yellow", "color02"],
			["Color \\u00b7 Electric Blue", "color03"],
			["Color \\u00b7 Hot Pink", "color04"],
			["Color \\u00b7 Emerald", "color05"],
			["Color \\u00b7 Violet", "color06"],
			["Color \\u00b7 Cyan", "color07"],
			["Color \\u00b7 Warm Paper", "color08"],
			["Color \\u00b7 Ink Black", "color09"],
			["Color \\u00b7 Acid Lime", "color10"],
			["Neo Brutalist \\u00b7 Offset Poster", "neo01"],
			["Neo Brutalist \\u00b7 Collision Bands", "neo02"],
			["Neo Brutalist \\u00b7 Cutout Frame", "neo03"],
			["Swiss Grid \\u00b7 Classic", "swiss01"],
			["Swiss Grid \\u00b7 Red Axis", "swiss02"],
			["Swiss Grid \\u00b7 Blue Modular", "swiss03"],
			["CSS Pattern \\u00b7 Animated Angles", "prismic01"],
			["CSS Pattern \\u00b7 Square Shift", "prismic02"],
			["CSS Pattern \\u00b7 Wavy Rows", "prismic03"],
			["CSS Pattern \\u00b7 Geometric Cycle", "prismic04"]
		];

		/*
		 * Legacy internal motion-typography renderer definitions
		 * (variations 19-26); these are not gallery templates.
		 */

		const VARIATIONS = [
			{
				n: 19, name: "Halo Warp", tag: "Elastic",
				text: "WARP", color: "#ffffff", anim: "v19warp",
				vw: 9, base: "#ff4f87", deco: "halo",
				font: "Arial", ls: -0.1
			},
			{
				n: 20, name: "Terminal Fracture", tag: "Signal",
				text: "ERROR", color: "#baff39", anim: "v20terminal",
				vw: 8, base: "#07110d", deco: "scan",
				font: "monospace", ls: -0.1
			},
			{
				n: 21, name: "Ribbon Editorial", tag: "Editorial",
				text: "MUSE", color: "#18120d", anim: "v21editorial",
				vw: 8, base: "#f3ead7", deco: "ribbon",
				font: "Georgia", ls: 0
			},
			{
				n: 22, name: "Portal Type", tag: "Depth",
				text: "VOID", color: "#ffffff", anim: "v22tunnel",
				vw: 9, base: "#1428ff", deco: "portal",
				font: "Arial", ls: -0.11
			},
			{
				n: 23, name: "Comic Burst", tag: "Pop",
				text: "BOOM", color: "#111111", anim: "v23pop",
				vw: 9, base: "#ffd51f", deco: "burst",
				font: "Arial", ls: -0.12
			},
			{
				n: 24, name: "Dream Echo", tag: "Dream",
				text: "ECHO", color: "#e9e3ff", anim: "v24echo",
				vw: 8, base: "#0b0b12", deco: "ghost",
				font: "Arial", ls: -0.08
			},
			{
				n: 25, name: "Perspective Fold", tag: "Grid",
				text: "FOLD", color: "#111111", anim: "v25fold",
				vw: 8, base: "#f7f3e9", deco: "grid",
				font: "Arial", ls: -0.1, originLeft: true
			},
			{
				n: 26, name: "Liquid Bloom", tag: "Organic",
				text: "BLOOM", color: "#2b0820", anim: "v26liquid",
				vw: 9, base: "#ff6433", deco: "blob",
				font: "Georgia", ls: -0.09
			}
		];

		// -------------------------------------------------
		// Small maths helpers.
		// -------------------------------------------------

		function clamp(v, a, b) {
			return Math.max(a, Math.min(b, v));
		}

		function lerp(a, b, p) {
			return a + (b - a) * p;
		}

		function loop01(t, period) {
			const p = (t % period) / period;
			return p < 0 ? p + 1 : p;
		}

		function step01(p, n) {
			return Math.floor(clamp(p, 0, 0.9999) * n) / n;
		}

		/* CSS-compatible cubic-bezier easing (bisection). */
		function bezEase(x1, y1, x2, y2) {
			return function (p) {
				if (p <= 0) return 0;
				if (p >= 1) return 1;
				let lo = 0;
				let hi = 1;
				let t = 0.5;
				for (let i = 0; i < 18; i++) {
					t = (lo + hi) / 2;
					const x =
						3 * (1 - t) * (1 - t) * t * x1 +
						3 * (1 - t) * t * t * x2 +
						t * t * t;
					if (x < p) lo = t; else hi = t;
				}
				return (
					3 * (1 - t) * (1 - t) * t * y1 +
					3 * (1 - t) * t * t * y2 +
					t * t * t
				);
			};
		}

		const easeInOut = bezEase(0.42, 0, 0.58, 1);
		const easeWarp = bezEase(0.7, 0, 0.2, 1);
		const easePop = bezEase(0.2, 1.4, 0.4, 1);
		const easeEntry = bezEase(0.2, 0.9, 0.2, 1);

		/* Eased triangle 0 -> 1 -> 0 over one period. */
		function tri(t, period, ease) {
			const p = loop01(t, period);
			return p < 0.5 ? ease(p * 2) : ease((1 - p) * 2);
		}

		function fillTracked(c2d, text, x, y, tracking) {
			let cx = x;
			for (const ch of text) {
				c2d.fillText(ch, cx, y);
				cx += c2d.measureText(ch).width + tracking;
			}
		}

		function strokeTracked(c2d, text, x, y, tracking) {
			let cx = x;
			for (const ch of text) {
				c2d.strokeText(ch, cx, y);
				cx += c2d.measureText(ch).width + tracking;
			}
		}

		function measureTracked(c2d, text, tracking) {
			let w = 0;
			const chars = [...text];
			chars.forEach((ch, i) => {
				w += c2d.measureText(ch).width;
				if (i < chars.length - 1) w += tracking;
			});
			return w;
		}

		function fontStr(v, fs) {
			const px = Math.round(fs);
			if (v.font === "monospace") {
				return "900 " + px + "px monospace";
			}
			if (v.font === "Georgia") {
				return "italic bold " + px + "px Georgia, serif";
			}
			return "900 " + px + "px Arial, Helvetica, sans-serif";
		}

		// -------------------------------------------------
		// Text motion (per-layer animation, looping).
		// -------------------------------------------------

		function textMotion(anim, t) {
			const m = {
				rot: 0, sx: 1, sy: 1, skew: 0, dx: 0, dy: 0,
				alpha: 1, blur: 0, fillAlpha: 1,
				lsEm: null, clip: null, shadow: null
			};
			const period = ANIM_PERIODS[anim] || 1;
			const p = loop01(t, period);

			if (anim === "v19warp") {
				const q = tri(t, period, easeWarp);
				m.skew = lerp(-18, 12, q) * DEG;
				m.rot = lerp(-8, 5, q) * DEG;
				m.sx = m.sy = lerp(0.7, 1.18, q);
			}
			else if (anim === "v20terminal") {
				if (p < 0.35) {
					const q = step01(p / 0.35, 7);
					m.clip = [lerp(0, 0.18, q), 0, lerp(0, 0.42, q), 0];
					m.dx = lerp(0, -18, q);
					m.dy = lerp(0, 9, q);
				}
				else if (p < 0.38) {
					const q = step01((p - 0.35) / 0.03, 7);
					m.clip = [lerp(0.18, 0.55, q), 0, lerp(0.42, 0.08, q), 0];
					m.dx = lerp(-18, 20, q);
					m.dy = lerp(9, -7, q);
				}
				else {
					const q = step01((p - 0.38) / 0.62, 7);
					m.clip = [lerp(0.55, 0, q), 0, lerp(0.08, 0, q), 0];
					m.dx = lerp(20, 0, q);
					m.dy = lerp(-7, 0, q);
				}
				m.lsEm =
					p < 0.7
						? lerp(-0.1, 0.08, step01(p / 0.7, 7))
						: lerp(0.08, -0.1, step01((p - 0.7) / 0.3, 7));
			}
			else if (anim === "v21editorial") {
				const q = tri(t, period, easeInOut);
				m.rot = lerp(-14, 9, q) * DEG;
				m.dx = lerp(-25, 25, q);
				m.sx = m.sy = lerp(0.85, 1.1, q);
			}
			else if (anim === "v22tunnel") {
				const q = tri(t, period, easeInOut);
				const ry = lerp(-35, 35, q);
				m.sx = Math.cos(ry * DEG);
				m.sy = lerp(0.65, 1.25, q);
				m.fillAlpha = q;
			}
			else if (anim === "v23pop") {
				const q = tri(t, period, easePop);
				m.rot = lerp(-8, 5, q) * DEG;
				m.sx = m.sy = lerp(0.72, 1.15, q);
				m.shadow = {
					dx: lerp(14, -14, q),
					dy: 14,
					color: q < 0.5 ? "#ff3c74" : "#00cfff"
				};
			}
			else if (anim === "v24echo") {
				let q;
				if (p < 0.45) q = easeInOut(p / 0.45);
				else if (p < 0.6) q = 1;
				else q = 1 - easeInOut((p - 0.6) / 0.4);
				m.blur = lerp(8, 0, q);
				m.alpha = lerp(0.35, 1, q);
				m.sx = m.sy = lerp(1.35, 0.95, q);
			}
			else if (anim === "v25fold") {
				const q = tri(t, period, easeInOut);
				const ry = lerp(65, -20, q);
				m.sx = Math.cos(ry * DEG);
				m.sy = lerp(1, 1.08, q);
				m.rot = lerp(-4, 4, q) * DEG;
			}
			else if (anim === "v26liquid") {
				const q = tri(t, period, easeInOut);
				m.rot = lerp(-10, 8, q) * DEG;
				m.sx = lerp(0.75, 1.25, q);
				m.sy = lerp(1, 0.85, q);
			}

			return m;
		}

		// -------------------------------------------------
		// Photo entry (transition) + looping photo motion.
		// -------------------------------------------------

		function entryState(entry, d, t, stag) {
			const m = {
				alpha: 1, dx: 0, dy: 0,
				rot: 0, sx: 1, sy: 1, blur: 0
			};
			const tt = t - stag;
			if (tt <= 0) {
				m.alpha = 0;
				return m;
			}
			if (tt >= d) {
				return m;
			}
			const q = easeEntry(tt / d);
			if (entry === "fade") {
				m.alpha = q;
			}
			else if (entry === "slide-left") {
				m.alpha = q;
				m.dx = lerp(-90, 0, q);
			}
			else if (entry === "slide-right") {
				m.alpha = q;
				m.dx = lerp(90, 0, q);
			}
			else if (entry === "rise") {
				m.alpha = q;
				m.dy = lerp(90, 0, q);
			}
			else if (entry === "drop") {
				m.alpha = q;
				m.dy = lerp(-90, 0, q);
			}
			else if (entry === "pop") {
				m.alpha = q;
				m.sx = m.sy = lerp(0.25, 1, q);
				m.rot = lerp(-5, 0, q) * DEG;
			}
			else if (entry === "spin") {
				m.alpha = q;
				m.sx = m.sy = lerp(0.35, 1, q);
				m.rot = lerp(-28, 0, q) * DEG;
			}
			else if (entry === "flip") {
				m.alpha = q;
				m.sx = Math.max(0.02, Math.cos((1 - q) * Math.PI / 2));
			}
			else if (entry === "blur") {
				m.alpha = q;
				m.blur = lerp(18, 0, q);
				m.sx = m.sy = lerp(1.18, 1, q);
			}
			return m;
		}

		function motionState(motion, t, speed, startAt) {
			const m = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
			if (motion === "none") {
				return m;
			}
			const tt = t - startAt;
			if (tt <= 0) {
				return m;
			}
			const period = MOTION_PERIODS[motion] || 6;
			const p = loop01(tt * speed, period);
			const q = p < 0.5 ? easeInOut(p * 2) : easeInOut((1 - p) * 2);
			if (motion === "pulse") {
				m.sx = m.sy = lerp(1, 1.18, q);
			}
			else if (motion === "zoom-in") {
				m.sx = m.sy = lerp(1, 1.28, q);
			}
			else if (motion === "zoom-out") {
				m.sx = m.sy = lerp(1.28, 1, q);
			}
			else if (motion === "pan-left") {
				m.dx = lerp(18, -28, q);
				m.sx = m.sy = lerp(1.08, 1.14, q);
			}
			else if (motion === "pan-right") {
				m.dx = lerp(-28, 18, q);
				m.sx = m.sy = lerp(1.08, 1.14, q);
			}
			else if (motion === "drift-up") {
				m.dy = lerp(18, -30, q);
				m.sx = m.sy = lerp(1.05, 1.12, q);
			}
			else if (motion === "drift-down") {
				m.dy = lerp(-30, 18, q);
				m.sx = m.sy = lerp(1.05, 1.12, q);
			}
			else if (motion === "ken-burns") {
				m.dx = lerp(-12, 20, q);
				m.dy = lerp(10, -16, q);
				m.sx = m.sy = lerp(1.02, 1.3, q);
			}
			else if (motion === "rotate-zoom") {
				m.rot = lerp(-3, 4, q) * DEG;
				m.sx = m.sy = lerp(1.02, 1.24, q);
			}
			return m;
		}

		// -------------------------------------------------
		// Variation decoration (the template's own animated
		// artwork). Pseudo-style decorations are suppressed
		// when a background override is active, mirroring
		// the motion studio's has-selected-bg rule.
		// -------------------------------------------------

		function haloRing(c2d, W, H, S, t, baseInset) {
			const q = tri(t, 4, easeInOut);
			const inset = lerp(baseInset, 0.04, q);
			const rr = lerp(0.5, 0.08, q);
			const rot = lerp(0, 35, q) * DEG;
			const x = W * inset;
			const y = H * inset;
			const w = W - 2 * x;
			const h = H - 2 * y;
			c2d.save();
			c2d.translate(W / 2, H / 2);
			c2d.rotate(rot);
			c2d.translate(-W / 2, -H / 2);
			c2d.lineWidth = Math.max(1, 3 * S);
			c2d.strokeStyle = "#ffffff";
			c2d.beginPath();
			if (c2d.roundRect) {
				c2d.roundRect(x, y, w, h, rr * Math.min(w, h));
			}
			else {
				c2d.rect(x, y, w, h);
			}
			c2d.stroke();
			c2d.restore();
		}

		function drawDeco(c2d, W, H, S, v, t, pseudoOn) {
			if (v.deco === "halo") {
				if (!pseudoOn) return;
				haloRing(c2d, W, H, S, t, 0.12);
				haloRing(c2d, W, H, S, t - 2, 0.24);
			}
			else if (v.deco === "scan") {
				if (!pseudoOn) return;
				const period = Math.max(6, 17 * S);
				const off = loop01(t, 3) * 34 * S;
				c2d.fillStyle = "rgba(186,255,57,0.08)";
				for (let y = -period; y < H + period; y += period) {
					c2d.fillRect(0, y + off, W, Math.max(1, S));
				}
			}
			else if (v.deco === "ribbon") {
				const q = tri(t, 4, easeInOut);
				c2d.save();
				c2d.translate(W / 2, H * 0.42 + 45 * S);
				c2d.rotate(lerp(-12, 13, q) * DEG);
				c2d.scale(1, lerp(1, 0.35, q));
				c2d.fillStyle = "#ff5a36";
				c2d.fillRect(-0.75 * W, -45 * S, 1.5 * W, 90 * S);
				c2d.restore();
			}
			else if (v.deco === "portal") {
				const p = loop01(t, 5);
				const rot = p * Math.PI * 2;
				const sc = lerp(0.65, 1.25, p);
				c2d.save();
				c2d.translate(W / 2, H / 2);
				c2d.rotate(rot);
				c2d.scale(sc, sc);
				c2d.strokeStyle = "#ffffff";
				c2d.lineWidth = Math.max(2, 6 * S);
				c2d.beginPath();
				c2d.arc(0, 0, 130 * S, 0, Math.PI * 2);
				c2d.stroke();
				c2d.beginPath();
				c2d.arc(0, 0, 118 * S, 0, Math.PI * 2);
				c2d.stroke();
				c2d.restore();
			}
			else if (v.deco === "burst") {
				const p = loop01(t, 4);
				const rot = Math.floor(p * 4) / 4 * Math.PI * 2;
				const x = 0.12 * W;
				const y = 0.12 * H;
				const w = W - 2 * x;
				const h = H - 2 * y;
				const off = 40 * S;
				c2d.save();
				c2d.translate(W / 2, H / 2);
				c2d.rotate(rot);
				c2d.translate(-W / 2, -H / 2);
				c2d.lineWidth = Math.max(2, 8 * S);
				c2d.strokeStyle = "#111111";
				c2d.strokeRect(x + off, y, w, h);
				c2d.strokeRect(x - off, y, w, h);
				c2d.strokeRect(x, y + off, w, h);
				c2d.strokeRect(x, y - off, w, h);
				c2d.strokeRect(x, y, w, h);
				c2d.restore();
			}
			else if (v.deco === "ghost") {
				const q = tri(t, 5, easeInOut);
				const sc = lerp(1, 1.3, q);
				const x = 0.12 * W;
				const y = 0.12 * H;
				const w = W - 2 * x;
				const h = H - 2 * y;
				c2d.save();
				c2d.globalAlpha *= 0.38;
				c2d.translate(W / 2, H / 2);
				c2d.rotate(lerp(0, 20, q) * DEG);
				c2d.scale(sc, sc);
				c2d.translate(-W / 2, -H / 2);
				c2d.lineWidth = Math.max(2, 5 * S);
				c2d.strokeStyle = "#00e5ff";
				c2d.strokeRect(x + 18 * S, y + 18 * S, w, h);
				c2d.strokeStyle = "#8c67ff";
				c2d.strokeRect(x - 18 * S, y - 18 * S, w, h);
				c2d.strokeRect(x, y, w, h);
				c2d.restore();
			}
			else if (v.deco === "grid") {
				const period = Math.max(8, 34 * S);
				const off = loop01(t, 5) * period;
				c2d.strokeStyle = "rgba(17,17,17,0.133)";
				c2d.lineWidth = Math.max(1, S);
				for (let x = -period + off; x < W + period; x += period) {
					c2d.beginPath();
					c2d.moveTo(x, 0);
					c2d.lineTo(x, H);
					c2d.stroke();
				}
				for (let y = -period + off; y < H + period; y += period) {
					c2d.beginPath();
					c2d.moveTo(0, y);
					c2d.lineTo(W, y);
					c2d.stroke();
				}
			}
			else if (v.deco === "blob") {
				const q = tri(t, 4, easeInOut);
				const size = 300 * S;
				const A = [0.42, 0.58, 0.63, 0.37, 0.48, 0.38, 0.62, 0.52];
				const B = [0.65, 0.35, 0.40, 0.60, 0.35, 0.65, 0.35, 0.65];
				const r = A.map((a, i) => lerp(a, B[i], q));
				c2d.save();
				c2d.translate(W / 2, H / 2);
				c2d.rotate(lerp(0, 160, q) * DEG);
				const sc = lerp(0.8, 1.2, q);
				c2d.scale(sc, sc);
				blobPath(c2d, -size / 2, -size / 2, size, size, r);
				c2d.fillStyle = "#ffb7dc";
				c2d.fill();
				c2d.restore();
			}
		}

		function blobPath(c2d, x, y, w, h, r) {
			const rx = [r[0] * w, r[1] * w, r[2] * w, r[3] * w];
			const ry = [r[4] * h, r[5] * h, r[6] * h, r[7] * h];
			c2d.beginPath();
			c2d.moveTo(x + rx[0], y);
			c2d.lineTo(x + w - rx[1], y);
			c2d.ellipse(x + w - rx[1], y + ry[1], rx[1], ry[1], 0, -Math.PI / 2, 0);
			c2d.lineTo(x + w, y + h - ry[2]);
			c2d.ellipse(x + w - rx[2], y + h - ry[2], rx[2], ry[2], 0, 0, Math.PI / 2);
			c2d.lineTo(x + rx[3], y + h);
			c2d.ellipse(x + rx[3], y + h - ry[3], rx[3], ry[3], 0, Math.PI / 2, Math.PI);
			c2d.lineTo(x, y + ry[0]);
			c2d.ellipse(x + rx[0], y + ry[0], rx[0], ry[0], 0, Math.PI, Math.PI * 1.5);
			c2d.closePath();
		}

		// -------------------------------------------------
		// Background overrides (21 curated animated
		// backgrounds + the blurred photo). Percentage and
		// pixel geometry mirrors the motion studio CSS.
		// -------------------------------------------------

		function drawStripes(c2d, W, H, S, angleDeg, bands, offset) {
			c2d.save();
			c2d.translate(W / 2, H / 2);
			c2d.rotate((angleDeg - 90) * DEG);
			const big = Math.max(W, H) * 1.6;
			const period = bands.period * S;
			const x0 = -big / 2 + (offset % period) - period;
			for (let x = x0; x < big / 2 + period; x += period) {
				for (const b of bands.stops) {
					if (!b[2]) continue;
					c2d.fillStyle = b[2];
					c2d.fillRect(x + b[0] * S, -big / 2, (b[1] - b[0]) * S, big);
				}
			}
			c2d.restore();
		}

		function drawBgOverride(c2d, W, H, S, t, bg, photoArr) {
			if (bg === "photo") {
				c2d.fillStyle = "#111111";
				c2d.fillRect(0, 0, W, H);
				const img = photoArr && photoArr[0];
				if (img && img.width) {
					c2d.save();
					c2d.globalAlpha *= 0.62;
					if ("filter" in c2d) {
						c2d.filter = "blur(" + 22 * S + "px)";
					}
					const sc = Math.max(W / img.width, H / img.height) * 1.12;
					c2d.drawImage(
						img,
						(W - img.width * sc) / 2,
						(H - img.height * sc) / 2,
						img.width * sc,
						img.height * sc
					);
					c2d.restore();
				}
				return;
			}

			const solids = {
				color01: "#ff4d00", color02: "#ffd51f", color03: "#2457ff",
				color04: "#ff4f87", color05: "#00c98d", color06: "#7b4dff",
				color07: "#00cfff", color08: "#f5f0e6", color09: "#111111",
				color10: "#baff39"
			};
			if (solids[bg]) {
				c2d.fillStyle = solids[bg];
				c2d.fillRect(0, 0, W, H);
				return;
			}

			if (bg === "neo01") {
				c2d.fillStyle = "#ffd51f";
				c2d.fillRect(0, 0, W, H);
				const x = W * 0.12;
				const y = H * 0.10;
				const w = W - 2 * x;
				const h = H - 2 * y;
				c2d.save();
				c2d.translate(W / 2, H / 2);
				c2d.rotate(-5 * DEG);
				c2d.translate(-W / 2, -H / 2);
				c2d.fillStyle = "#2457ff";
				c2d.fillRect(x + 22 * S, y + 22 * S, w, h);
				c2d.fillStyle = "#ff4d00";
				c2d.fillRect(x, y, w, h);
				c2d.lineWidth = Math.max(2, 10 * S);
				c2d.strokeStyle = "#111111";
				c2d.strokeRect(x, y, w, h);
				c2d.restore();
				return;
			}

			if (bg === "neo02") {
				c2d.fillStyle = "#ff4f87";
				c2d.fillRect(0, 0, W, H);
				const x = -0.08 * W;
				const y = 0.18 * H;
				const w = 1.16 * W;
				const h = 0.34 * H;
				c2d.save();
				c2d.translate(W / 2, H / 2);
				c2d.rotate(7 * DEG);
				c2d.translate(-W / 2, -H / 2);
				c2d.fillStyle = "#2457ff";
				c2d.fillRect(x, y + 34 * S, w, h);
				c2d.fillStyle = "#baff39";
				c2d.fillRect(x, y, w, h);
				c2d.lineWidth = Math.max(2, 9 * S);
				c2d.strokeStyle = "#111111";
				c2d.strokeRect(x, y, w, h);
				c2d.restore();
				return;
			}

			if (bg === "neo03") {
				c2d.fillStyle = "#2457ff";
				c2d.fillRect(0, 0, W, H);
				const x = W * 0.08;
				const y = H * 0.08;
				const w = W - 2 * x;
				const h = H - 2 * y;
				c2d.fillStyle = "#ff4d00";
				c2d.fillRect(x + 18 * S, y + 18 * S, w, h);
				c2d.fillStyle = "#ffd51f";
				c2d.fillRect(x - 18 * S, y - 18 * S, w, h);
				c2d.save();
				c2d.beginPath();
				c2d.moveTo(x, y);
				c2d.lineTo(x + w * 0.78, y);
				c2d.lineTo(x + w * 0.78, y + h * 0.18);
				c2d.lineTo(x + w, y + h * 0.18);
				c2d.lineTo(x + w, y + h);
				c2d.lineTo(x + w * 0.20, y + h);
				c2d.lineTo(x + w * 0.20, y + h * 0.82);
				c2d.lineTo(x, y + h * 0.82);
				c2d.closePath();
				c2d.clip();
				c2d.fillStyle = "#f5f0e6";
				c2d.fillRect(x - 30 * S, y - 30 * S, w + 60 * S, h + 60 * S);
				c2d.restore();
				c2d.lineWidth = Math.max(2, 12 * S);
				c2d.strokeStyle = "#111111";
				c2d.strokeRect(x, y, w, h);
				return;
			}

			if (bg === "swiss01" || bg === "swiss02" || bg === "swiss03") {
				const cfg = {
					swiss01: {
						base: "#f5f0e6", op: 0.28,
						v: { period: 61, from: 59, to: 61, color: "#111111" },
						h: { period: 61, from: 59, to: 61, color: "#111111" }
					},
					swiss02: {
						base: "#ffffff", op: 1,
						v: { period: 83, from: 79, to: 83, color: "#ef3323" },
						h: { period: 41, from: 39, to: 41, color: "#111111" }
					},
					swiss03: {
						base: "#e9e3d4", op: 0.72,
						v: { period: 48, from: 0, to: 2, color: "#111111" },
						h: { period: 96, from: 0, to: 5, color: "#2457ff" }
					}
				}[bg];
				c2d.fillStyle = cfg.base;
				c2d.fillRect(0, 0, W, H);
				c2d.save();
				c2d.globalAlpha *= cfg.op;
				const drawGrid = (axis, g) => {
					const period = Math.max(4, g.period * S);
					const thick = Math.max(1, (g.to - g.from) * S);
					c2d.fillStyle = g.color;
					for (let p = g.from * S; p < (axis === "v" ? W : H) + period; p += period) {
						if (axis === "v") {
							c2d.fillRect(p, 0, thick, H);
						}
						else {
							c2d.fillRect(0, p, W, thick);
						}
					}
				};
				drawGrid("v", cfg.v);
				drawGrid("h", cfg.h);
				c2d.restore();
				return;
			}

			if (bg === "prismic01") {
				c2d.fillStyle = "#f5f0e6";
				c2d.fillRect(0, 0, W, H);
				const off = loop01(t, 1.1) * 116 * S;
				drawStripes(c2d, W, H, S, 125, {
					period: 58,
					stops: [
						[0, 10, "#111111"],
						[28, 38, "#ff4d00"]
					]
				}, off);
				return;
			}

			if (bg === "prismic02") {
				c2d.fillStyle = "#ffd51f";
				c2d.fillRect(0, 0, W, H);
				const size = Math.max(6, 28 * S);
				const p = loop01(t, 1.35);
				const off = Math.floor(p * 8) / 8 * size * 2;
				c2d.fillStyle = "#111111";
				for (let y = -size * 2; y < H + size * 2; y += size * 2) {
					for (let x = -size * 2; x < W + size * 2; x += size * 2) {
						c2d.fillRect(x + off, y + off, size, size);
						c2d.fillRect(x + off + size, y + off + size, size, size);
					}
				}
				return;
			}

			if (bg === "prismic03") {
				c2d.fillStyle = "#2457ff";
				c2d.fillRect(0, 0, W, H);
				const off = loop01(t, 1.15) * 140 * S;
				drawStripes(c2d, W, H, S, 100, {
					period: 70,
					stops: [
						[16, 20, "#ffffff"],
						[42, 48, "#ff4f87"]
					]
				}, off);
				return;
			}

			if (bg === "prismic04") {
				c2d.fillStyle = "#111111";
				c2d.fillRect(0, 0, W, H);
				const size = Math.max(8, 32 * S);
				const p = loop01(t, 1.5);
				const off = p * size * 2;
				const tris = [
					[0, 0, "#00cfff"],
					[size, 0, "#ff4d00"],
					[0, size, "#baff39"]
				];
				for (let y = -size * 2; y < H + size * 2; y += size * 2) {
					for (let x = -size * 2; x < W + size * 2; x += size * 2) {
						for (const tr of tris) {
							c2d.fillStyle = tr[2];
							c2d.beginPath();
							c2d.moveTo(x + tr[0] + off, y + tr[1] + off);
							c2d.lineTo(x + tr[0] + off + size * 2, y + tr[1] + off);
							c2d.lineTo(x + tr[0] + off, y + tr[1] + off + size * 2);
							c2d.closePath();
							c2d.fill();
						}
					}
				}
				return;
			}
		}

		// -------------------------------------------------
		// Photos (Instax-style frames, max 2).
		// -------------------------------------------------

		function drawPhotos(c2d, W, H, S, st, t) {
			const arr = st.photos || photos;
			const n = Math.min(arr.length, 2);
			const speed = st.speed || 1;
			for (let i = 0; i < n; i++) {
				const img = arr[i];
				if (!img || !img.width) {
					continue;
				}
				const cw = W * 0.336;
				const innerW = cw - 14 * S;
				const ih = innerW * (img.height / img.width);
				const chh = ih + 29 * S;
				const x = i === 0 ? W * 0.07 : W * 0.93 - cw;
				const y = i === 0 ? H * 0.92 - chh : H * 0.11;
				const stag = i * 0.12;
				const en = entryState(
					st.imageEntry || "pop",
					st.entrySpeed || 0.55,
					t,
					stag
				);
				const mo = motionState(
					st.imageMotion || "zoom-in",
					t,
					speed,
					(st.entrySpeed || 0.55) + stag
				);
				c2d.save();
				c2d.globalAlpha *= en.alpha;
				c2d.translate(
					x + cw / 2 + (en.dx + mo.dx) * S,
					y + chh / 2 + (en.dy + mo.dy) * S
				);
				c2d.rotate(en.rot + mo.rot);
				c2d.scale(en.sx * mo.sx, en.sy * mo.sy);
				if (en.blur > 0 && "filter" in c2d) {
					c2d.filter = "blur(" + en.blur * S + "px)";
				}
				c2d.shadowColor = "rgba(0,0,0,0.32)";
				c2d.shadowBlur = 30 * S;
				c2d.shadowOffsetY = 12 * S;
				c2d.fillStyle = "#ffffff";
				c2d.fillRect(-cw / 2, -chh / 2, cw, chh);
				c2d.shadowColor = "rgba(0,0,0,0)";
				c2d.shadowBlur = 0;
				c2d.shadowOffsetY = 0;
				c2d.drawImage(
					img,
					-innerW / 2,
					-chh / 2 + 7 * S,
					innerW,
					ih
				);
				c2d.restore();
			}
		}

		// -------------------------------------------------
		// Text layers (dynamic, each with its own controls).
		// -------------------------------------------------

		function drawLayer(c2d, W, H, S, v, layer, st, t) {
			const speed = st.speed || 1;
			const raw = String(
				layer.text === undefined || layer.text === null ? "" : layer.text
			).trim().toUpperCase();
			const text = raw || "TEXT";
			let fs = (layer.size || v.vw) * W * 0.0428;
			if (fs > H * 0.55) {
				fs = H * 0.55;
			}
			if (fs < 12) {
				fs = 12;
			}
			const m = textMotion(layer.anim || v.anim, t * speed);
			const lsEm =
				m.lsEm !== null && m.lsEm !== undefined ? m.lsEm : (v.ls || 0);
			const tracking = lsEm * fs;

			c2d.save();
			c2d.font = fontStr(v, fs);
			const tw = measureTracked(c2d, text, tracking);
			const th = fs * 1.28;

			const bx = layer.pos.endsWith("l")
				? 0
				: layer.pos.endsWith("r") ? -tw : -tw / 2;
			const by = layer.pos.startsWith("t")
				? 0
				: layer.pos.startsWith("b") ? -th : -th / 2;
			const ax = layer.pos.endsWith("l")
				? W * 0.04
				: layer.pos.endsWith("r") ? W * 0.96 : W * 0.5;
			const ay = layer.pos.startsWith("t")
				? H * 0.07
				: layer.pos.startsWith("b") ? H * 0.93 : H * 0.5;

			c2d.translate(ax + (m.dx || 0) * S, ay + (m.dy || 0) * S);

			if (v.originLeft) {
				c2d.translate(bx, 0);
				if (m.rot) {
					c2d.rotate(m.rot);
				}
				if (m.skew) {
					c2d.transform(1, 0, Math.tan(m.skew), 1, 0, 0);
				}
				c2d.scale(m.sx, m.sy);
				c2d.translate(-bx, 0);
			}
			else {
				if (m.rot) {
					c2d.rotate(m.rot);
				}
				if (m.skew) {
					c2d.transform(1, 0, Math.tan(m.skew), 1, 0, 0);
				}
				c2d.scale(m.sx, m.sy);
			}

			if (m.alpha !== 1) {
				c2d.globalAlpha *= m.alpha;
			}
			if (m.blur > 0 && "filter" in c2d) {
				c2d.filter = "blur(" + m.blur * S + "px)";
			}
			if (m.clip) {
				const cx0 = bx + tw * m.clip[3];
				const cy0 = by + th * m.clip[0];
				const cw0 = tw * (1 - m.clip[1] - m.clip[3]);
				const ch0 = th * (1 - m.clip[0] - m.clip[2]);
				c2d.beginPath();
				c2d.rect(cx0, cy0, cw0, ch0);
				c2d.clip();
			}

			c2d.textAlign = "left";
			c2d.textBaseline = "middle";
			const ty = by + th / 2 + fs * 0.03;

			if (v.n === 19) {
				c2d.fillStyle = "rgba(0,0,0,0.18)";
				fillTracked(c2d, text, bx, ty + 10 * S, tracking);
				c2d.fillStyle = layer.color;
				fillTracked(c2d, text, bx, ty, tracking);
			}
			else if (v.n === 20) {
				c2d.fillStyle = "#ff2b75";
				fillTracked(c2d, text, bx + 12 * S, ty, tracking);
				c2d.fillStyle = layer.color;
				fillTracked(c2d, text, bx, ty, tracking);
			}
			else if (v.n === 21) {
				c2d.globalCompositeOperation = "multiply";
				c2d.fillStyle = layer.color;
				fillTracked(c2d, text, bx, ty, tracking);
				c2d.globalCompositeOperation = "source-over";
			}
			else if (v.n === 22) {
				c2d.lineWidth = Math.max(2, 2.4 * S);
				c2d.lineJoin = "round";
				c2d.strokeStyle = "#ffffff";
				strokeTracked(c2d, text, bx, ty, tracking);
				if (m.fillAlpha > 0.01) {
					c2d.globalAlpha *= m.fillAlpha;
					c2d.fillStyle = layer.color;
					fillTracked(c2d, text, bx, ty, tracking);
				}
			}
			else if (v.n === 23) {
				const sh = m.shadow || {
					dx: 14, dy: 14, color: "#ff3c74"
				};
				const padX = 0.12 * fs;
				const padY = 0.05 * fs;
				const boxX = bx - padX;
				const boxY = by - padY;
				const boxW = tw + 2 * padX;
				const boxH = th + 2 * padY;
				c2d.fillStyle = sh.color;
				c2d.fillRect(
					boxX + sh.dx * S,
					boxY + sh.dy * S,
					boxW,
					boxH
				);
				c2d.fillStyle = "#ffd51f";
				c2d.fillRect(boxX, boxY, boxW, boxH);
				c2d.fillStyle = layer.color;
				fillTracked(c2d, text, bx, ty, tracking);
			}
			else if (v.n === 24) {
				c2d.save();
				c2d.shadowColor = "#8c67ff";
				c2d.shadowBlur = 12 * S;
				c2d.fillStyle = layer.color;
				fillTracked(c2d, text, bx, ty, tracking);
				c2d.shadowColor = "#00e5ff";
				c2d.shadowBlur = 35 * S;
				fillTracked(c2d, text, bx, ty, tracking);
				c2d.restore();
			}
			else if (v.n === 25) {
				const padX = 0.18 * fs;
				const padY = 0.08 * fs;
				c2d.lineWidth = Math.max(2, 6 * S);
				c2d.strokeStyle = layer.color;
				c2d.strokeRect(
					bx - padX,
					by - padY,
					tw + 2 * padX,
					th + 2 * padY
				);
				c2d.fillStyle = layer.color;
				fillTracked(c2d, text, bx, ty, tracking);
			}
			else {
				c2d.fillStyle = layer.color;
				fillTracked(c2d, text, bx, ty, tracking);
			}

			c2d.restore();
		}

		// -------------------------------------------------
		// The whole scene. The SAME function renders the
		// gallery thumbnails, the live editor preview and
		// every exported MP4 frame.
		// -------------------------------------------------

		function drawScene(c2d, W, H, t, v, st) {
			const S = H / 520;
			const bg = st.bg || "default";
			c2d.setTransform(1, 0, 0, 1, 0, 0);
			c2d.filter = "none";
			c2d.globalAlpha = 1;
			c2d.globalCompositeOperation = "source-over";
			c2d.clearRect(0, 0, W, H);
			c2d.fillStyle = bg === "default" ? v.base : "#111111";
			c2d.fillRect(0, 0, W, H);
			if (bg !== "default") {
				drawBgOverride(c2d, W, H, S, t, bg, st.photos || photos);
			}
			drawDeco(c2d, W, H, S, v, t, bg === "default");
			drawPhotos(c2d, W, H, S, st, t);
			for (const layer of st.layers) {
				drawLayer(c2d, W, H, S, v, layer, st, t);
			}
		}

		// -------------------------------------------------
		// Per-template working state.
		// -------------------------------------------------

		function defaultState(i) {
			const v = VARIATIONS[i];
			return {
				layers: [
					{
						text: v.text,
						color: v.color,
						pos: "mc",
						anim: v.anim,
						size: v.vw
					}
				],
				bg: "default",
				imageEntry: "pop",
				entrySpeed: 0.55,
				imageMotion: "zoom-in",
				speed: 1
			};
		}

		function varState(i) {
			if (!states[i]) {
				states[i] = defaultState(i);
			}
			return states[i];
		}

		function current() {
			return varState(currentVar);
		}

		function currentVarDef() {
			return VARIATIONS[currentVar];
		}

		// -------------------------------------------------
		// Preview loop (gallery thumbs + editor preview).
		// -------------------------------------------------

		function tick(now) {
			if (!modal || modal.style.display === "none") {
				previewRaf = 0;
				return;
			}
			const dt = Math.min(0.1, (now - previewLast) / 1000);
			previewLast = now;
			if (!paused && !exporting) {
				previewT += dt;
			}
			if (galleryView && galleryView.style.display !== "none") {
				for (const thumb of galleryCanvases) {
					if (!thumb) {
						continue;
					}
					drawScene(
						thumb.ctx,
						thumb.canvas.width,
						thumb.canvas.height,
						previewT % 12,
						thumb.v,
						thumb.st
					);
				}
			}
			else if (editorView && editorView.style.display !== "none" && !exporting) {
				const loopT = previewT % Math.max(1, duration);
				drawScene(ctx, TPL_W, TPL_H, loopT, currentVarDef(), current());
				if (progressEl) {
					progressEl.style.width =
						(loopT / Math.max(1, duration) * 100) + "%";
				}
			}
			previewRaf = requestAnimationFrame(tick);
		}

		function ensureTicking() {
			if (!previewRaf) {
				previewLast = performance.now();
				previewRaf = requestAnimationFrame(tick);
			}
		}

		// -------------------------------------------------
		// Gallery view (4-column live preview grid).
		// -------------------------------------------------

		function buildGallery() {
			const grid = document.getElementById("tm-grid");
			if (!grid) {
				return;
			}
			grid.innerHTML = "";
			galleryCanvases = [];
			VARIATIONS.forEach((v, i) => {
				const card = document.createElement("button");
				card.type = "button";
				card.className = "tm-gcard";
				card.setAttribute("data-i", String(i));
				card.innerHTML =
					'<span class="tm-gframe"><canvas class="tm-gcanvas" width="270" height="480"></canvas></span>' +
					'<span class="tm-gname">' + v.n + " \\u00b7 " + v.name + '</span>' +
					'<span class="tm-gtag">' + v.tag + '</span>';
				card.addEventListener("click", () => {
					openEditor(i);
				});
				grid.appendChild(card);
				const cv = card.querySelector("canvas");
				galleryCanvases.push({
					canvas: cv,
					ctx: cv.getContext("2d"),
					v: v,
					st: defaultState(i)
				});
			});
		}

		function showGallery() {
			if (!galleryView || !editorView) {
				return;
			}
			galleryView.style.display = "";
			editorView.style.display = "none";
			if (statusEl) {
				statusEl.textContent =
					"Pick a template \\u2014 each preview is the real animation";
			}
			if (exportBtn) {
				exportBtn.disabled = true;
			}
			if (addBtn) {
				addBtn.disabled = true;
			}
			if (progressEl) {
				progressEl.style.width = "0%";
			}
			ensureTicking();
		}

		// -------------------------------------------------
		// Editor view.
		// -------------------------------------------------

		function showView() {
			if (!galleryView || !editorView) {
				return;
			}
			galleryView.style.display = "none";
			editorView.style.display = "";
			if (exportBtn) {
				exportBtn.disabled = exporting;
			}
			if (addBtn) {
				addBtn.disabled = exporting;
			}
			ensureTicking();
		}

		function openEditor(i) {
			currentVar = i;
			const v = VARIATIONS[i];
			const st = varState(i);
			const nameEl = document.getElementById("tm-name");
			if (nameEl) {
				nameEl.textContent = v.n + " \\u00b7 " + v.name;
			}
			syncControlValues(st);
			rebuildLayerList();
			previewT = 0;
			showView();
			if (statusEl) {
				statusEl.textContent =
					"Editing " + v.name +
					" \\u2014 customise the layers, then export the MP4";
			}
			drawScene(ctx, TPL_W, TPL_H, 0, v, st);
		}

		function fillSelect(sel, options, value) {
			if (!sel) {
				return;
			}
			sel.innerHTML = options
				.map((o) => {
					return (
						'<option value="' + o[1] + '">' + o[0] + "</option>"
					);
				})
				.join("");
			if (value !== undefined) {
				sel.value = String(value);
			}
		}

		function syncControlValues(st) {
			fillSelect(
				document.getElementById("tm-entry"),
				IMAGE_ENTRIES,
				st.imageEntry
			);
			fillSelect(
				document.getElementById("tm-entry-speed"),
				ENTRY_SPEEDS,
				st.entrySpeed
			);
			fillSelect(
				document.getElementById("tm-motion"),
				IMAGE_MOTIONS,
				st.imageMotion
			);
			fillSelect(
				document.getElementById("tm-bg"),
				BACKGROUNDS,
				st.bg
			);
			const speedEl = document.getElementById("tm-speed");
			if (speedEl) {
				speedEl.value = String(st.speed);
			}
			updateSpeedLabel();
			if (durationEl) {
				durationEl.value = String(duration);
			}
			if (orientEl) {
				orientEl.value = tplLandscape ? "landscape" : "portrait";
			}
			renderPhotoThumbs();
		}

		function updateSpeedLabel() {
			const out = document.getElementById("tm-speed-val");
			const speedEl = document.getElementById("tm-speed");
			if (out && speedEl) {
				out.textContent =
					(Number(speedEl.value) || 1).toFixed(2)
						.replace(/\\.00$/, "")
						.replace(/(\\.\\d)0$/, "$1") + "\\u00d7";
			}
		}

		// -------------------------------------------------
		// Text layers accordion (dynamic, each layer has
		// its own controls: text, colour, position,
		// animation, size).
		// -------------------------------------------------

		function layerTitle(layer) {
			return (String(layer.text || "").trim() || "TEXT").toUpperCase();
		}

		function rebuildLayerList() {
			if (!layersHost) {
				return;
			}
			layersHost.innerHTML = "";
			const st = current();
			st.layers.forEach((layer, idx) => {
				layersHost.appendChild(buildLayerUI(layer, idx));
			});
			refreshDeleteState();
		}

		function refreshDeleteState() {
			if (!layersHost) {
				return;
			}
			const st = current();
			layersHost.querySelectorAll(".tm-tl-del").forEach((b) => {
				b.disabled = st.layers.length <= 1;
			});
		}

		function buildLayerUI(layer, idx) {
			const st = current();
			const v = currentVarDef();
			const item = document.createElement("div");
			item.className = "tm-tl" + (idx === 0 ? " open" : "");
			item.innerHTML =
				'<div class="tm-tl-toggle" role="button" tabindex="0" aria-expanded="' +
				(idx === 0 ? "true" : "false") +
				'">' +
				'<span class="tm-tl-caret" aria-hidden="true">&#9656;</span>' +
				'<span class="tm-tl-title"></span>' +
				'<button type="button" class="tm-tl-del" title="Remove this text layer" aria-label="Remove this text layer">&#215;</button>' +
				"</div>" +
				'<div class="tm-tl-body">' +
				'<div class="tpl-row">' +
				'<label class="tpl-field" style="flex:1"><input class="tm-tl-text" type="text" maxlength="12" placeholder="Text (max 12 chars)"><span>Text</span></label>' +
				'<button type="button" class="tm-tl-apply">Apply</button>' +
				"</div>" +
				'<div class="tm-grid3">' +
				'<label class="tpl-field"><select class="tm-tl-color"></select><span>Colour</span></label>' +
				'<label class="tpl-field"><select class="tm-tl-pos"></select><span>Position</span></label>' +
				'<label class="tpl-field"><select class="tm-tl-anim"></select><span>Text animation</span></label>' +
				"</div>" +
				'<div class="tpl-row"><label class="tpl-range"><input class="tm-tl-size" type="range" min="3" max="18" step="0.5"><span>Size <output class="tm-size-val">100%</output></span></label></div>' +
				"</div>";

			const head = item.querySelector(".tm-tl-toggle");
			const title = item.querySelector(".tm-tl-title");
			const input = item.querySelector(".tm-tl-text");
			const applyBtn = item.querySelector(".tm-tl-apply");
			const colorSel = item.querySelector(".tm-tl-color");
			const posSel = item.querySelector(".tm-tl-pos");
			const animSel = item.querySelector(".tm-tl-anim");
			const sizeRange = item.querySelector(".tm-tl-size");
			const sizeVal = item.querySelector(".tm-size-val");

			title.textContent = layerTitle(layer);
			input.value = layer.text || "";
			fillSelect(colorSel, COLORS, layer.color);
			fillSelect(posSel, POSITIONS, layer.pos);
			fillSelect(animSel, TEXT_ANIMS, layer.anim);
			sizeRange.value = String(layer.size || v.vw);

			const showSize = () => {
				const pct = Math.round(
					(layer.size || v.vw) / v.vw * 100
				);
				sizeVal.textContent = pct + "%";
			};
			showSize();

			const toggle = () => {
				const open = item.classList.toggle("open");
				head.setAttribute("aria-expanded", open ? "true" : "false");
			};
			head.addEventListener("click", (e) => {
				if (e.target.closest(".tm-tl-del")) {
					return;
				}
				toggle();
			});
			head.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					toggle();
				}
			});

			const applyText = () => {
				layer.text = input.value;
				title.textContent = layerTitle(layer);
			};
			input.addEventListener("input", applyText);
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					applyText();
				}
			});
			applyBtn.addEventListener("click", applyText);

			colorSel.addEventListener("change", () => {
				layer.color = colorSel.value;
			});
			posSel.addEventListener("change", () => {
				layer.pos = posSel.value;
			});
			animSel.addEventListener("change", () => {
				layer.anim = animSel.value;
			});
			sizeRange.addEventListener("input", () => {
				layer.size = parseFloat(sizeRange.value) || v.vw;
				showSize();
			});

			item.querySelector(".tm-tl-del").addEventListener("click", () => {
				removeLayer(layer);
			});

			return item;
		}

		function addLayer() {
			const st = current();
			const v = currentVarDef();
			const used = st.layers.map((l) => l.pos);
			let pos = "mc";
			for (const p of POS_CYCLE) {
				if (!used.includes(p)) {
					pos = p;
					break;
				}
			}
			st.layers.push({
				text: "NEW",
				color: v.color,
				pos: pos,
				anim: v.anim,
				size: v.vw
			});
			rebuildLayerList();
			if (layersHost) {
				const items = layersHost.querySelectorAll(".tm-tl");
				const last = items[items.length - 1];
				if (last) {
					if (last.scrollIntoView) {
						last.scrollIntoView({ block: "nearest" });
					}
					const inp = last.querySelector(".tm-tl-text");
					if (inp) {
						inp.focus();
						inp.select();
					}
				}
			}
		}

		function removeLayer(layer) {
			const st = current();
			if (st.layers.length <= 1) {
				return;
			}
			const idx = st.layers.indexOf(layer);
			if (idx < 0) {
				return;
			}
			st.layers.splice(idx, 1);
			rebuildLayerList();
		}

		// -------------------------------------------------
		// Photos (max 2).
		// -------------------------------------------------

		function renderPhotoThumbs() {
			if (!photosHost) {
				return;
			}
			photosHost.innerHTML = "";
			photos.forEach((img, i) => {
				const wrap = document.createElement("span");
				wrap.className = "tm-photo";
				wrap.innerHTML =
					'<img alt="Template photo ' + (i + 1) + '">' +
					'<button type="button" class="tm-photo-x" title="Remove this photo">&#215;</button>';
				wrap.querySelector("img").src = img.src;
				wrap.querySelector(".tm-photo-x").addEventListener("click", () => {
					removePhoto(i);
				});
				photosHost.appendChild(wrap);
			});
		}

		function removePhoto(i) {
			if (i < 0 || i >= photos.length) {
				return;
			}
			const url = photoUrls[i];
			if (url) {
				URL.revokeObjectURL(url);
			}
			photos.splice(i, 1);
			photoUrls.splice(i, 1);
			renderPhotoThumbs();
		}

		async function onPhotoFiles(event) {
			const files = Array.from(event.target.files || []).slice(0, 2);
			event.target.value = "";
			if (!files.length) {
				return;
			}
			for (const u of photoUrls) {
				URL.revokeObjectURL(u);
			}
			photoUrls = [];
			photos = [];
			for (const f of files) {
				const u = URL.createObjectURL(f);
				const im = new Image();
				im.src = u;
				try {
					await im.decode();
				}
				catch (decodeError) {
					URL.revokeObjectURL(u);
					continue;
				}
				photoUrls.push(u);
				photos.push(im);
			}
			renderPhotoThumbs();
			if (statusEl) {
				statusEl.textContent =
					photos.length + " photo" +
					(photos.length === 1 ? "" : "s") +
					" loaded \\u00b7 " + currentVarDef().name;
			}
		}

		function clearPhotos() {
			for (const u of photoUrls) {
				URL.revokeObjectURL(u);
			}
			photoUrls = [];
			photos = [];
			renderPhotoThumbs();
		}

		// -------------------------------------------------
		// Format / length.
		// -------------------------------------------------

		function setOrientation(landscape) {
			tplLandscape = !!landscape;
			TPL_W = tplLandscape
				? TPL_LANDSCAPE_W
				: TPL_PORTRAIT_W;
			TPL_H = tplLandscape
				? TPL_LANDSCAPE_H
				: TPL_PORTRAIT_H;
			if (canvas) {
				canvas.width = TPL_W;
				canvas.height = TPL_H;
			}
			const stage = document.getElementById("tm-stage");
			if (stage) {
				stage.classList.toggle("landscape", tplLandscape);
			}
			if (editorView && editorView.style.display !== "none") {
				drawScene(
					ctx,
					TPL_W,
					TPL_H,
					previewT % Math.max(1, duration),
					currentVarDef(),
					current()
				);
			}
		}

		// -------------------------------------------------
		// Export (SAME engine as the Video N accordions:
		// WebCodecs VideoEncoder + mp4-muxer, no FFmpeg,
		// no screen capture). Download renders and saves to disk;
		// Add to Video renders the same MP4 without saving to disk.
		// -------------------------------------------------

		async function exportMP4(options) {
			const shouldDownload = !options || options.download !== false;
			if (typeof VideoEncoder === "undefined") {
				alert(
					"Your browser does not support WebCodecs. Please use modern Chrome, Edge, or Safari."
				);
				return;
			}
			if (typeof Mp4Muxer === "undefined") {
				alert(
					"The MP4 muxer failed to load. Reload the page and try again."
				);
				return;
			}

			exporting = true;
			exportBtn.disabled = true;
			addBtn.disabled = true;
			if (progressEl) {
				progressEl.style.width = "0%";
			}

			let videoEncoder = null;

			try {
				const v = currentVarDef();
				const st = current();
				const total = Math.ceil(duration * TPL_FPS);
				statusEl.textContent = "Rendering " + total + " frames\\u2026";

				/*
				 * Same muxer setup as generateMP4():
				 * H.264 video track, built in memory.
				 * fastStart "in-memory" is safe here
				 * because the clip is tiny (max 25 s),
				 * so the file plays instantly in the
				 * gallery; the main engine uses false
				 * to save RAM on long videos.
				 */
				const muxer = new Mp4Muxer.Muxer({
					target: new Mp4Muxer.ArrayBufferTarget(),
					video: {
						codec: "avc",
						width: TPL_W,
						height: TPL_H
					},
					fastStart: "in-memory"
				});

				let encoderError = null;

				videoEncoder = new VideoEncoder({
					output: (chunk, meta) => {
						muxer.addVideoChunk(chunk, meta);
					},
					error: (error) => {
						console.error("VideoEncoder error:", error);
						encoderError = error;
					}
				});

				videoEncoder.configure({
					codec: "avc1.4d002a",
					width: TPL_W,
					height: TPL_H,
					bitrate: TPL_VIDEO_BITRATE,
					framerate: TPL_FPS
				});

				/*
				 * Same keyframe + backpressure
				 * policy as generateMP4().
				 */
				const KEYFRAME_INTERVAL = TPL_FPS * 10;
				const MAX_ENCODE_QUEUE = 12;

				for (let i = 0; i < total; i++) {
					drawScene(ctx, TPL_W, TPL_H, i / TPL_FPS, v, st);

					const timestamp = (i * 1_000_000) / TPL_FPS;
					const frame = new VideoFrame(canvas, {
						timestamp: timestamp
					});
					videoEncoder.encode(frame, {
						keyFrame: i % KEYFRAME_INTERVAL === 0
					});
					frame.close();

					while (
						videoEncoder.encodeQueueSize > MAX_ENCODE_QUEUE
					) {
						await new Promise((resolve) =>
							setTimeout(resolve, 8)
						);
					}

					if (encoderError) {
						throw encoderError;
					}

					if (progressEl) {
						progressEl.style.width =
							((i + 1) / total * 100) + "%";
					}

					if (i % 15 === 0) {
						statusEl.textContent =
							"Rendering frame " + (i + 1) + " / " + total;
						await new Promise((resolve) =>
							setTimeout(resolve, 0)
						);
					}
				}

				statusEl.textContent = "Finalizing MP4\\u2026";
				await videoEncoder.flush();
				if (encoderError) {
					throw encoderError;
				}
				muxer.finalize();

				const blob = new Blob([muxer.target.buffer], {
					type: "video/mp4"
				});
				const name =
					"template_" +
					v.name
						.toLowerCase()
						.replaceAll(" ", "_")
						.replaceAll("&", "and") +
					"_" +
					(tplLandscape ? "landscape" : "portrait") +
					".mp4";
				const url = URL.createObjectURL(blob);
				const previousUrl = lastVideo && lastVideo.url;
				if (previousUrl) {
					const urlInUse = videoProjects.some((project) =>
						project && project.assets.some((asset) => asset.url === previousUrl)
					);
					if (!urlInUse) URL.revokeObjectURL(previousUrl);
				}
				lastVideo = {
					blob: blob,
					url: url,
					duration: duration,
					name: name
				};

				if (shouldDownload) {
					const a = document.createElement("a");
					a.className = "tpl-download";
					a.href = url;
					a.download = name;
					a.textContent = "Download MP4";
					document.body.appendChild(a);
					a.click();
					a.remove();
				}

				if (progressEl) {
					progressEl.style.width = "100%";
				}
				statusEl.textContent = shouldDownload
					? "MP4 ready \\u2014 downloaded as " + name
					: "MP4 ready \\u2014 adding it to Video " + modalVideo;
				addBtn.disabled = false;
				addBtn.textContent = "\\u2795 Add to Video " + modalVideo;
				return lastVideo;
			}
			catch (err) {
				console.error(err);
				statusEl.textContent =
					"Export failed: " + ((err && err.message) || err);
				alert(
					"Video export failed: " + ((err && err.message) || err)
				);
				return null;
			}
			finally {
				if (
					videoEncoder &&
					videoEncoder.state !== "closed"
				) {
					try {
						videoEncoder.close();
					}
					catch (cleanupError) { }
				}
				exporting = false;
				exportBtn.disabled =
					!editorView || editorView.style.display === "none";
				addBtn.disabled =
					!editorView || editorView.style.display === "none";
				ensureTicking();
			}
		}

		// -------------------------------------------------
		// Add the composed MP4 to the target Video N as a
		// normal gallery asset (same shape + caps as an
		// uploaded MP4 clip).
		// -------------------------------------------------

		async function addTemplateToVideo() {
			if (exporting) return;
			const n = modalVideo;
			const project = videoProjects[n - 1];
			if (!project) {
				return;
			}
			const counts = videoCounts(project);
			if (counts.clips >= MAX_MP4_UPLOADS) {
				alert(
					"Video " + n +
					": you can add at most " +
					MAX_MP4_UPLOADS +
					" MP4 clips."
				);
				return;
			}

			const renderedVideo = await exportMP4({ download: false });
			if (!renderedVideo) return;

			addBtn.disabled = true;
			statusEl.textContent =
				"Adding the composed MP4 to Video " + n + "\\u2026";

			const file = new File(
				[renderedVideo.blob],
				renderedVideo.name,
				{ type: "video/mp4" }
			);
			const probed = document.createElement("video");
			probed.muted = true;
			probed.playsInline = true;
			probed.src = renderedVideo.url;

			try {
				await new Promise((resolve, reject) => {
					probed.addEventListener("loadedmetadata", resolve, {
						once: true
					});
					probed.addEventListener("error", reject, {
						once: true
					});
				});
			}
			catch (probeError) {
				addBtn.disabled = false;
				statusEl.textContent = "MP4 ready";
				alert(
					"The composed file could not be read as an MP4 clip."
				);
				return;
			}

			const clipDuration = probed.duration;
			if (clipDuration > MP4_MAX_DURATION_S) {
				addBtn.disabled = false;
				statusEl.textContent = "MP4 ready";
				alert(
					"The composed file is " +
					formatSeconds(clipDuration) +
					" long. Each MP4 clip must be at most " +
					formatSeconds(MP4_MAX_DURATION_S) +
					"."
				);
				return;
			}

			probed.loop = true;

			const asset = {
				kind: "mp4",
				file: file,
				videoEl: probed,
				duration: clipDuration,
				url: renderedVideo.url,
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
			const body = document.getElementById("va-body-" + n);
			if (body && body.style.display === "none") {
				toggleVideoAccordion(n);
			}
			const gallery = document.getElementById("va-gallery-" + n);
			if (gallery && gallery.style.display === "none") {
				toggleGalleryScroll(n);
			}

			addBtn.textContent = "\\u2705 Added to Video " + n;
			statusEl.textContent =
				"Added to Video " + n +
				" (" + formatSeconds(clipDuration) + ")" +
				" \\u2014 it plays in the final render like any other MP4 clip";
		}

		// -------------------------------------------------
		// Modal build / open / close.
		// -------------------------------------------------

		function buildModal(n) {
			modal = document.createElement("div");
			modal.id = "tpl-modal";
			modal.className = "modal-overlay";
			modal.innerHTML =
				'<div class="tpl-box">' +
				'<div class="tpl-head">' +
				'<div class="modal-title" id="tpl-title">\\ud83c\\udfac Add Video from Template \\u2014 Video ' + n + "</div>" +
				'<button type="button" class="tpl-x" id="tpl-x" title="Close">\\u2715</button>' +
				"</div>" +
				'<p class="tpl-sub" id="tpl-sub">Choose one of 15 Interactive scenes, including the 3D Ring Carousel. Add any of 13 animated objects from the Graphics dropdown. Edit text, layer order, rotation, positions, colours, stickers, animations, transitions, photos and backgrounds. The ring accepts 5–7 uploaded images in its bottom accordion. Download a portrait 9:16 or landscape 16:9 MP4 (max ' + TPL_MAX_DURATION + ' seconds) straight to disk, or render it directly into this video&rsquo;s Images / MP4s gallery like any uploaded clip.</p>' +

				'<div id="tm-gallery" class="tm-view">' +
				'<div class="tm-gallery-grid" id="tm-grid"></div>' +
				"</div>" +

				'<div id="tm-editor" class="tm-view" style="display:none">' +
				'<div class="tm-editorbar">' +
				'<button type="button" id="tm-back" class="tm-back" title="Back to all templates">\\u2190 Templates</button>' +
				'<span class="tm-tpl-name" id="tm-name"></span>' +
				'<label class="tpl-len"><select id="tpl-orientation"><option value="portrait" selected>Portrait 9:16</option><option value="landscape">Landscape 16:9</option></select><span>Format</span></label>' +
				'<label class="tpl-len"><input id="tpl-duration" type="number" min="1" max="25" value="6"><span>Length (seconds)</span></label>' +
				'<button type="button" id="tm-play" class="tm-tool" title="Pause / resume the preview">\\u23f8 Pause</button>' +
				'<button type="button" id="tm-restart" class="tm-tool" title="Restart the preview">\\u21ba Restart</button>' +
				"</div>" +
				'<div class="tm-main">' +
				'<div class="tm-previewcol">' +
				'<div class="tm-stage" id="tm-stage"><canvas id="tpl-canvas" width="1080" height="1920"></canvas></div>' +
				'<div class="tpl-timeline"><div class="tpl-progress" id="tpl-progress"></div></div>' +
				"</div>" +
				'<div class="tm-side">' +
				'<div class="tpl-editor tm-block">' +
				'<div class="tm-sec-title">Photos (optional, max 2)</div>' +
				'<div class="tm-photos" id="tm-photos"></div>' +
				'<div class="tpl-row">' +
				'<label class="tpl-file">\\ud83d\\uddbc\\ufe0f Choose pictures<input id="tm-files" type="file" accept="image/*" multiple></label>' +
				'<button type="button" id="tm-clear-photos" class="tm-tool">Remove all</button>' +
				"</div>" +
				'<div class="tm-sec-title">Motion &amp; transitions</div>' +
				'<div class="tm-grid3">' +
				'<label class="tpl-field"><select id="tm-entry"></select><span>Photo entry (transition)</span></label>' +
				'<label class="tpl-field"><select id="tm-entry-speed"></select><span>Entry speed</span></label>' +
				'<label class="tpl-field"><select id="tm-motion"></select><span>Photo motion</span></label>' +
				'<label class="tpl-field"><select id="tm-bg"></select><span>Background</span></label>' +
				'<label class="tpl-field"><input id="tm-speed" type="range" min="0.5" max="2" step="0.05" value="1"><span>Animation speed <output id="tm-speed-val">1\\u00d7</output></span></label>' +
				"</div>" +
				"</div>" +
				'<div class="tpl-editor tm-block">' +
				'<div class="tm-tl-head"><div class="tm-sec-title">Text layers</div><button type="button" id="tm-add-layer" class="tm-tl-add" title="Add a text layer" aria-label="Add a text layer">+</button></div>' +
				'<div id="tm-layers"></div>' +
				"</div>" +
				"</div>" +
				"</div>" +
				'<div class="tpl-tips">Tip: each template is a looping motion design \\u2014 text layers animate continuously (speed scales every animation), photos enter with the chosen transition and then loop their motion. The clip is silent \\u2014 upload an MP3 in the accordion to give the final video sound.</div>' +
				"</div>" +

				'<div class="tm-statusline"><span id="tpl-status" class="tpl-status">Pick a template \\u2014 each preview is the real animation</span></div>' +
				'<div class="tpl-actions">' +
				'<button type="button" id="tpl-export" class="tpl-primary" disabled>\\u2b07 Download MP4</button>' +
				'<button type="button" id="tpl-add" disabled>\\u2795 Add to Video ' + n + "</button>" +
				'<button type="button" id="tpl-close">\\u2715 Close</button>' +
				"</div>" +
				"</div>";

			document.body.appendChild(modal);

			canvas = document.getElementById("tpl-canvas");
			ctx = canvas.getContext("2d");
			titleEl = document.getElementById("tpl-title");
			statusEl = document.getElementById("tpl-status");
			progressEl = document.getElementById("tpl-progress");
			durationEl = document.getElementById("tpl-duration");
			orientEl = document.getElementById("tpl-orientation");
			exportBtn = document.getElementById("tpl-export");
			addBtn = document.getElementById("tpl-add");
			galleryView = document.getElementById("tm-gallery");
			editorView = document.getElementById("tm-editor");
			layersHost = document.getElementById("tm-layers");
			photosHost = document.getElementById("tm-photos");
			playBtn = document.getElementById("tm-play");

			buildGallery();

			document.getElementById("tm-back")
				.addEventListener("click", showGallery);

			playBtn.addEventListener("click", () => {
				paused = !paused;
				playBtn.textContent = paused
					? "\\u25b6 Play"
					: "\\u23f8 Pause";
			});

			document.getElementById("tm-restart")
				.addEventListener("click", () => {
					previewT = 0;
					paused = false;
					playBtn.textContent = "\\u23f8 Pause";
				});

			document.getElementById("tm-add-layer")
				.addEventListener("click", addLayer);

			document.getElementById("tm-files")
				.addEventListener("change", onPhotoFiles);

			document.getElementById("tm-clear-photos")
				.addEventListener("click", clearPhotos);

			orientEl.addEventListener("change", () => {
				setOrientation(orientEl.value === "landscape");
			});

			durationEl.addEventListener("change", () => {
				duration = clamp(
					Math.round(Number(durationEl.value) || 6),
					1,
					TPL_MAX_DURATION
				);
				durationEl.value = duration;
			});

			const stWired = (id, key, numeric) => {
				const el = document.getElementById(id);
				el.addEventListener("change", () => {
					const st = current();
					st[key] = numeric
						? Number(el.value)
						: el.value;
					if (key === "speed") {
						updateSpeedLabel();
					}
				});
				if (id === "tm-speed") {
					el.addEventListener("input", () => {
						current().speed = Number(el.value);
						updateSpeedLabel();
					});
				}
			};
			stWired("tm-entry", "imageEntry", false);
			stWired("tm-entry-speed", "entrySpeed", true);
			stWired("tm-motion", "imageMotion", false);
			stWired("tm-bg", "bg", false);
			stWired("tm-speed", "speed", true);

			exportBtn.addEventListener("click", exportMP4);
			addBtn.addEventListener("click", addTemplateToVideo);
			document.getElementById("tpl-close")
				.addEventListener("click", closeTemplateModal);
			document.getElementById("tpl-x")
				.addEventListener("click", closeTemplateModal);

			modal.addEventListener("click", (e) => {
				if (e.target === modal) {
					closeTemplateModal();
				}
			});

			document.addEventListener("keydown", (e) => {
				if (
					e.key === "Escape" &&
					modal &&
					modal.style.display !== "none"
				) {
					closeTemplateModal();
				}
			});
		}

		function openTemplateModal(n) {
			const project = videoProjects[n - 1];
			if (!project) {
				return;
			}
			modalVideo = n;
			if (!modal) {
				buildModal(n);
			}
			else {
				titleEl.textContent =
					"\\ud83c\\udfac Add Video from Template \\u2014 Video " + n;
				addBtn.textContent =
					"\\u2795 Add to Video " + n;
			}
			modal.style.display = "flex";
			showGallery();
			ensureTicking();
		}

		function closeTemplateModal() {
			if (!modal) {
				return;
			}
			modal.style.display = "none";
			if (previewRaf) {
				cancelAnimationFrame(previewRaf);
				previewRaf = 0;
			}
		}

		window.openTemplateModal = openTemplateModal;
		window.closeTemplateModal = closeTemplateModal;

		${REEL_SCENE_EDITOR_JS}
		${TEMPLATE_RING_CAROUSEL_JS}
		${TEMPLATE_SHAPE_ANIMATIONS_JS}
	})();
`;
