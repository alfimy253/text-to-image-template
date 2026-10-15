import { AERIAL_BACKGROUND } from "./aerial-background";

/*
 * APP_CSS — every byte of the page CSS (studio + video
 * accordions + modals + the template-composer modal).
 * Injected into <style> by page.ts. Verbatim copy; do not
 * reformat the escapes.
 */

export const APP_CSS = `

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

			background:
				var(--bg);

			color:
				var(--text);

			font-family:
				system-ui,
				-apple-system,
				sans-serif;

			padding:
				20px;
		}


		.header {

			text-align:
				center;

			margin-bottom:
				25px;
		}


		.header h1 {

			font-size:
				2rem;

			color:
				var(--accent);

			margin-bottom:
				8px;
		}


		.header p {

			color:
				#9ca3af;

			font-size:
				0.95rem;
		}


		.studio {

			max-width:
				900px;

			margin:
				0 auto 40px auto;

			background:
				var(--card);

			border:
				1px solid #2e3440;

			border-radius:
				12px;

			padding:
				20px;

			display:
				flex;

			flex-direction:
				column;

			align-items:
				center;
		}


		.canvas-container {

			width:
				100%;

			aspect-ratio:
				16 / 9;

			background:
				#000;

			border-radius:
				8px;

			overflow:
				hidden;

			position:
				relative;

			display:
				flex;

			align-items:
				center;

			justify-content:
				center;

			box-shadow:
				0 10px 30px
				rgba(0,0,0,0.5);
		}


		canvas {

			width:
				100%;

			height:
				100%;

			object-fit:
				contain;
		}


		.overlay-text {

			position:
				absolute;

			color:
				#6b7280;

			font-size:
				1.2rem;

			pointer-events:
				none;
		}


		/* =================================================
		   AUDIO PANEL
		   ================================================= */

		.audio-panel {

			width:
				100%;

			margin-top:
				18px;

			background:
				#14171c;

			border:
				1px solid #2e3440;

			border-radius:
				10px;

			padding:
				16px;

			display:
				flex;

			flex-direction:
				column;

			gap:
				12px;
		}


		.audio-title {

			font-size:
				0.78rem;

			letter-spacing:
				0.08em;

			text-transform:
				uppercase;

			color:
				#9ca3af;
		}


		.audio-row {

			display:
				flex;

			align-items:
				center;

			gap:
				12px;

			flex-wrap:
				wrap;
		}


		.audio-empty {

			font-size:
				0.85rem;

			color:
				#6b7280;
		}


		.audio-details {

			display:
				flex;

			flex-direction:
				column;

			gap:
				10px;
		}


		.audio-name {

			font-size:
				0.9rem;

			color:
				var(--text);

			word-break:
				break-all;
		}


		.audio-name span {

			color:
				#10b981;

			font-weight:
				bold;
		}


		.audio-panel audio {

			width:
				100%;

			height:
				38px;
		}


		.audio-actions {

			display:
				flex;

			justify-content:
				space-between;

			align-items:
				center;

			gap:
				12px;

			flex-wrap:
				wrap;
		}


		.audio-note {

			font-size:
				0.78rem;

			color:
				#6b7280;
		}


		.remove-audio-btn {

			background:
				#ef4444;

			color:
				#fff;

			border:
				none;

			padding:
				8px 14px;

			font-size:
				0.8rem;

			font-weight:
				bold;

			border-radius:
				8px;

			cursor:
				pointer;
		}


		.remove-audio-btn:hover {

			opacity:
				0.9;
		}


		.estimate {

			font-size:
				0.82rem;

			color:
				#9ca3af;

			border-top:
				1px dashed #2e3440;

			padding-top:
				10px;
		}


		.estimate b {

			color:
				var(--accent);
		}


		.quality-select {

			display:
				inline-flex;

			align-items:
				center;

			gap:
				8px;

			font-size:
				0.85rem;

			color:
				#9ca3af;
		}


		.quality-select select {

			background:
				#0f1115;

			color:
				var(--text);

			border:
				1px solid #374151;

			border-radius:
				8px;

			padding:
				10px 12px;

			font-size:
				0.85rem;

			cursor:
				pointer;
		}


		.title-row {

			display:
				flex;

			gap:
				10px;

			flex-wrap:
				wrap;
		}


		.title-row input[type="text"] {

			flex:
				1 1 260px;

			background:
				#0f1115;

			color:
				var(--text);

			border:
				1px solid #374151;

			border-radius:
				8px;

			padding:
				10px 12px;

			font-size:
				0.9rem;

			outline:
				none;
		}


		.title-row input[type="text"]:focus {

			border-color:
				var(--accent);
		}


		.controls {

			display:
				flex;

			gap:
				15px;

			margin-top:
				20px;

			width:
				100%;

			justify-content:
				center;

			flex-wrap:
				wrap;
		}


		button,
		.upload-btn {

			background:
				var(--accent);

			color:
				#000;

			border:
				none;

			padding:
				12px 24px;

			font-size:
				1rem;

			font-weight:
				bold;

			border-radius:
				8px;

			cursor:
				pointer;

			transition:
				transform 0.1s,
				opacity 0.2s;

			display:
				inline-flex;

			align-items:
				center;

			gap:
				8px;
		}


		button:hover,
		.upload-btn:hover {

			opacity:
				0.9;

			transform:
				translateY(-1px);
		}


		button:disabled {

			background:
				#374151;

			color:
				#9ca3af;

			cursor:
				not-allowed;

			transform:
				none;
		}


		.upload-btn {

			background:
				#2563eb;

			color:
				white;
		}


		.upload-btn.audio {

			background:
				#7c3aed;
		}


		input[type="file"] {
			display: none;
		}


		.progress-bar-container {

			width:
				100%;

			background:
				#2e3440;

			height:
				10px;

			border-radius:
				5px;

			margin-top:
				15px;

			overflow:
				hidden;

			display:
				none;
		}


		.progress-bar {

			width:
				0%;

			height:
				100%;

			background:
				#10b981;

			transition:
				width 0.1s;
		}


		.status-text {

			margin-top:
				8px;

			font-size:
				0.85rem;

			color:
				#10b981;

			display:
				none;
		}


		h2 {

			margin-bottom:
				15px;

			border-bottom:
				1px solid #2e3440;

			padding-bottom:
				10px;
		}


		.gallery {

			display:
				grid;

			grid-template-columns:
				repeat(
					auto-fill,
					minmax(280px, 1fr)
				);

			gap:
				16px;
		}


		.card {

			background:
				var(--card);

			border:
				2px solid transparent;

			border-radius:
				10px;

			padding:
				10px;

			transition:
				border-color 0.2s;

			position:
				relative;
		}


		.card.in-video {

			border-color:
				var(--accent);
		}


		.badge {

			position:
				absolute;

			top:
				18px;

			right:
				18px;

			background:
				var(--accent);

			color:
				#000;

			font-size:
				0.75rem;

			font-weight:
				bold;

			padding:
				3px 8px;

			border-radius:
				12px;

			z-index:
				10;
		}


		.image-container {

			width:
				100%;

			aspect-ratio:
				16 / 9;

			background:
				#0f1115;

			border-radius:
				6px;

			display:
				flex;

			align-items:
				center;

			justify-content:
				center;

			overflow:
				hidden;
		}


		.image-container img {

			width:
				100%;

			height:
				100%;

			object-fit:
				cover;
		}


		.loading {

			color:
				#6b7280;

			font-size:
				0.85rem;

			display:
				flex;

			flex-direction:
				column;

			align-items:
				center;

			gap:
				8px;
		}


		.spinner {

			width:
				20px;

			height:
				20px;

			border:
				2px solid #374151;

			border-top-color:
				var(--accent);

			border-radius:
				50%;

			animation:
				spin 1s linear infinite;
		}


		@keyframes spin {

			to {
				transform:
					rotate(360deg);
			}

		}


		.prompt {

			margin-top:
				8px;

			font-size:
				0.8rem;

			color:
				#9ca3af;

			line-height:
				1.4;

			display:
				-webkit-box;

			-webkit-line-clamp:
				2;

			-webkit-box-orient:
				vertical;

			overflow:
				hidden;
		}


		.card-actions {

			margin-top:
				10px;

			display:
				flex;

			justify-content:
				space-between;

			align-items:
				center;
		}


		.toggle-btn {

			background:
				#374151;

			color:
				white;

			padding:
				6px 12px;

			font-size:
				0.8rem;
		}


		.card.in-video
		.toggle-btn {

			background:
				#ef4444;
		}

	
		/* =================================================
		   TIMESTAMP CAPTIONS (MAX 10)
		   ================================================= */

		.caption-head {

			display:
				flex;

			align-items:
				center;

			gap:
				12px;

			flex-wrap:
				wrap;
		}


		.add-caption-btn {

			background:
				var(--accent);

			color:
				#000;

			border:
				none;

			padding:
				9px 16px;

			font-size:
				0.85rem;

			font-weight:
				bold;

			border-radius:
				8px;

			cursor:
				pointer;

			display:
				inline-flex;

			align-items:
				center;

			gap:
				6px;
		}


		.add-caption-btn:hover {

			opacity:
				0.9;
		}


		.add-caption-btn:disabled {

			background:
				#374151;

			color:
				#9ca3af;

			cursor:
				not-allowed;
		}


		.add-caption-btn .plus {

			font-size:
				1.1rem;

			line-height:
				1;
		}


		.caption-count {

			font-size:
				0.78rem;

			color:
				#6b7280;
		}


		#caption-rows {

			display:
				flex;

			flex-direction:
				column;

			gap:
				8px;
		}


		.caption-row {

			display:
				flex;

			align-items:
				center;

			gap:
				10px;

			background:
				#0f1115;

			border:
				1px solid #2e3440;

			border-radius:
				8px;

			padding:
				10px 12px;

			flex-wrap:
				wrap;
		}


		.caption-time {

			display:
				flex;

			align-items:
				center;

			gap:
				4px;

			color:
				#9ca3af;

			font-weight:
				bold;
		}


		.caption-time input {

			width:
				46px;

			background:
				#14171c;

			color:
				var(--text);

			border:
				1px solid #374151;

			border-radius:
				6px;

			padding:
				8px 6px;

			font-size:
				0.85rem;

			text-align:
				center;

			outline:
				none;
		}


		.caption-time input:focus {

			border-color:
				var(--accent);
		}


		.caption-text-wrap {

			flex:
				1 1 240px;

			display:
				flex;

			align-items:
				center;

			gap:
				8px;
		}


		.caption-text {

			flex:
				1;

			background:
				#14171c;

			color:
				var(--text);

			border:
				1px solid #374151;

			border-radius:
				6px;

			padding:
				9px 12px;

			font-size:
				0.88rem;

			outline:
				none;
		}


		.caption-text:focus {

			border-color:
				var(--accent);
		}


		.caption-chars {

			font-size:
				0.72rem;

			color:
				#6b7280;

			min-width:
				34px;

			text-align:
				right;
		}


		.caption-remove {

			background:
				#ef4444;

			color:
				#fff;

			border:
				none;

			width:
				30px;

			height:
				30px;

			border-radius:
				8px;

			font-size:
				1rem;

			font-weight:
				bold;

			cursor:
				pointer;

			line-height:
				1;
		}


		.caption-remove:hover {

			opacity:
				0.9;
		}


		.caption-sample {

			display:
				inline-block;

			background:
				#ffffff;

			color:
				#000000;

			font-family:
				'Bookman Old Style',
				'Bookman',
				'URW Bookman L',
				Georgia,
				serif;

			font-size:
				17px;

			padding:
				5px 12px;

			border-radius:
				6px;
		}

		/* =====================================================
		   BULK VIDEO QUEUE
		   ===================================================== */

		.header {

			position:
				relative;
		}


		.bulk-toggle {

			position:
				absolute;

			top:
				10px;

			left:
				10px;

			width:
				44px;

			height:
				44px;

			border-radius:
				50%;

			border:
				none;

			background:
				#ff0000;

			color:
				#ffffff;

			font-size:
				30px;

			line-height:
				1;

			cursor:
				pointer;

			z-index:
				20;
		}


		.bulk-banner {

			max-width:
				980px;

			margin:
				0 auto 16px auto;

			padding:
				12px 16px;

			background:
				#7f1d1d;

			color:
				#ffffff;

			border-radius:
				10px;

			font-weight:
				600;

			text-align:
				center;
		}


		.bulk-panel {

			max-width:
				980px;

			margin:
				0 auto 25px auto;

			padding:
				14px 18px;

			background:
				var(--card);

			border:
				1px solid #2e3440;

			border-radius:
				12px;
		}


		.bulk-panel-header {

			display:
				flex;

			justify-content:
				space-between;

			align-items:
				center;

			margin-bottom:
				10px;
		}


		.bulk-panel-title {

			font-family:
				'Oswald',
				sans-serif;

			font-size:
				1.1rem;

			color:
				var(--text);
		}


		.bulk-arrow {

			background:
				none;

			border:
				none;

			color:
				var(--text);

			font-size:
				20px;

			line-height:
				1;

			cursor:
				pointer;
		}


		.bulk-slot {

			border-top:
				1px solid #2e3440;

			padding:
				10px 0;
		}


		.bulk-slot-top {

			display:
				flex;

			align-items:
				center;

			gap:
				12px;

			margin-bottom:
				8px;
		}


		.bulk-slot-name {

			font-weight:
				700;

			min-width:
				70px;
		}


		.bulk-status {

			font-size:
				0.75rem;

			padding:
				2px 10px;

			border-radius:
				999px;

			background:
				#374151;

			color:
				#d1d5db;
		}


		.bulk-summary {

			color:
				#9ca3af;

			font-size:
				0.85rem;
		}


		.bulk-slot-actions {

			display:
				flex;

			gap:
				8px;

			flex-wrap:
				wrap;
		}


		.bulk-caption-wrap {

			margin-top:
				10px;
		}

		/* =====================================================
		   VIDEO SECTIONS (stacked Video N accordions)
		   ===================================================== */

		.action-bar {

			display:
				flex;

			align-items:
				center;

			gap:
				14px;

			max-width:
				980px;

			margin:
				18px auto 14px auto;
		}


		.action-hint {

			color:
				#9ca3af;

			font-size:
				0.9rem;
		}


		#video-accordions {

			max-width:
				980px;

			margin:
				0 auto;
		}


		.video-accordion {

			background:
				var(--card);

			border:
				1px solid #2e3440;

			border-radius:
				12px;

			margin-bottom:
				14px;

			overflow:
				hidden;
		}


		.va-header {

			display:
				flex;

			align-items:
				center;

			gap:
				12px;

			padding:
				12px 16px;

			background:
				#14161a;
		}


		.va-title {

			font-family:
				'Oswald',
				sans-serif;

			font-size:
				1.1rem;
		}


		.va-status {

			font-size:
				0.75rem;

			padding:
				2px 10px;

			border-radius:
				999px;

			background:
				#374151;

			color:
				#d1d5db;
		}


		.va-api-btn {

			background:
				#1d4ed8;

			border:
				none;

			border-radius:
				6px;

			color:
				#ffffff;

			font-size:
				0.75rem;

			padding:
				6px 10px;

			cursor:
				pointer;
		}


		.va-api-btn:hover {

			background:
				#2563eb;
		}


		.va-summary {

			color:
				#9ca3af;

			font-size:
				0.85rem;

			flex:
				1;
		}


		.va-arrow {

			background:
				none;

			border:
				none;

			color:
				var(--text);

			font-size:
				0.75rem;

			line-height:
				1;

			padding:
				6px 10px;

			cursor:
				pointer;
		}


		.va-body {

			display:
				flex;

			gap:
				16px;

			padding:
				4px 16px 14px 16px;

			align-items:
				flex-start;
		}


		/*
		 * Left = 60% of the accordion,
		 * right = 40% (AI panel).
		 */

		.va-left {

			width:
				60%;

			min-width:
				0;
		}


		.va-right {

			width:
				40%;

			min-width:
				0;
		}


		/*
		 * AI image panel (right 40%)
		 */

		.va-ai-prompt {

			width:
				100%;

			box-sizing:
				border-box;

			background:
				#0f1115;

			border:
				1px solid #2e3440;

			border-radius:
				8px;

			color:
				var(--text);

			padding:
				8px;

			font-size:
				0.85rem;

			resize:
				vertical;

			margin-top:
				8px;
		}


		.va-ai-results {

			display:
				flex;

			flex-direction:
				column;

			gap:
				10px;

			margin-top:
				10px;
		}


		.va-ai-card {

			border:
				1px solid #2e3440;

			border-radius:
				8px;

			background:
				#0f1115;

			padding:
				6px;
		}


		/*
		 * 480px landscape (854x480)
		 */

		.va-ai-img {

			width:
				100%;

			aspect-ratio:
				854 / 480;

			object-fit:
				cover;

			display:
				block;

			border-radius:
				4px;

			background:
				#000000;
		}


		.va-ai-label {

			font-size:
				0.72rem;

			color:
				#9ca3af;

			margin-top:
				4px;

			white-space:
				nowrap;

			overflow:
				hidden;

			text-overflow:
				ellipsis;
		}


		.va-ai-actions {

			display:
				flex;

			gap:
				8px;

			margin-top:
				8px;

			flex-wrap:
				wrap;
		}


		.upload-btn.small {

			padding:
				6px 10px;

			font-size:
				0.75rem;
		}


		.ai-fullscreen-overlay {

			position:
				fixed;

			top:
				0;

			left:
				0;

			right:
				0;

			bottom:
				0;

			background:
				rgba(0, 0, 0, 0.92);

			display:
				none;

			align-items:
				center;

			justify-content:
				center;

			z-index:
				200;

			cursor:
				zoom-out;
		}


		.ai-fullscreen-img {

			max-width:
				95vw;

			max-height:
				92vh;

			object-fit:
				contain;
		}


		.ai-fullscreen-note {

			position:
				absolute;

			bottom:
				18px;

			color:
				#9ca3af;

			font-size:
				0.8rem;
		}


		/*
		 * Drag handle + hover tooltip
		 * on gallery cards
		 */

		.va-card-handle {

			position:
				absolute;

			top:
				2px;

			left:
				2px;

			z-index:
				4;

			cursor:
				grab;

			color:
				#d1d5db;

			background:
				rgba(0, 0, 0, 0.55);

			border-radius:
				4px;

			padding:
				1px 5px;

			font-size:
				13px;

			line-height:
				1.3;

			user-select:
				none;
		}


		.va-card-handle:active {

			cursor:
				grabbing;
		}


		.va-card-tip {

			position:
				absolute;

			left:
				8px;

			right:
				8px;

			bottom:
				8px;

			z-index:
				5;

			background:
				rgba(0, 0, 0, 0.85);

			color:
				#ffffff;

			font-size:
				0.7rem;

			padding:
				4px 8px;

			border-radius:
				6px;

			opacity:
				0;

			pointer-events:
				none;

			transition:
				opacity 0.15s;

			white-space:
				nowrap;

			overflow:
				hidden;

			text-overflow:
				ellipsis;
		}


		.va-card:hover .va-card-tip {

			opacity:
				1;
		}


		.va-section {

			border-top:
				1px solid #2e3440;

			padding:
				10px 0;
		}


		.va-section:first-child {

			border-top:
				none;
		}


		.va-section-title {

			font-weight:
				700;

			margin-bottom:
				8px;
		}


		.va-note {

			display:
				block;

			color:
				#9ca3af;

			font-size:
				0.78rem;

			margin-top:
				6px;
		}


		.va-row {

			display:
				flex;

			gap:
				10px;

			margin-top:
				8px;

			flex-wrap:
				wrap;
		}


			/*
			 * The SEO keywords the worker
			 * counted in the spoken script:
			 * two long-tail keywords and the
			 * short ones with their 2-5x hits.
			 */

		.va-seo-keywords {

			margin-top:
				10px;

			padding:
				8px 10px;

			background:
				#0b0e14;

			border:
				1px solid
				#374151;

			border-radius:
				6px;
		}


		.va-seo-heading {

			color:
				#9ca3af;

			font-size:
				0.78rem;

			margin-bottom:
				6px;
		}


		.va-seo-row {

			display:
				flex;

			align-items:
				center;

			flex-wrap:
				wrap;

			gap:
				6px;

			margin-top:
				6px;
		}


		.va-seo-label {

			color:
				#9ca3af;

			font-size:
				0.72rem;

			text-transform:
				uppercase;

			letter-spacing:
				0.04em;

			min-width:
				58px;
		}


		.va-seo-chip {

			display:
				inline-block;

			padding:
				2px 8px;

			border-radius:
				999px;

			font-size:
				0.78rem;

			color:
				#e5e7eb;

			background:
				#1f2937;

			border:
				1px solid
				#374151;
		}


		.va-seo-chip b {

			color:
				#22d3ee;
		}


		.va-seo-chip.long {

			border-color:
				#4b5563;
		}


		.va-script-actions {

			justify-content:
				flex-end;
		}


		.va-audio-line {

			margin-left:
				10px;

			color:
				#d1d5db;

			font-size:
				0.85rem;
		}


		/*
		 * The gallery is a scroll
		 * area (same strategy as
		 * the SRT script box):
		 * max 250px tall, with a
		 * wide arrow toggle above.
		 */

		.va-gallery {

			display:
				grid;

			grid-template-columns:
				repeat(
					auto-fill,
					minmax(140px, 1fr)
				);

			gap:
				10px;

			margin-top:
				10px;

			max-height:
				250px;

			overflow-y:
				auto;
		}


		/*
		 * Wide show/hide toggle
		 * button (arrow icon) for
		 * the scroll areas.
		 */

		.va-scroll-toggle {

			display:
				block;

			width:
				100%;

			box-sizing:
				border-box;

			background:
				#1f2937;

			color:
				#e5e7eb;

			border:
				1px solid
				#374151;

			border-radius:
				6px;

			padding:
				6px 10px;

			margin-top:
				10px;

			font-size:
				0.75rem;

			cursor:
				pointer;
		}


		.va-scroll-toggle:hover {

			background:
				#374151;
		}


		/*
		 * The generated SRT script:
		 * a scroll area with a FIXED
		 * 220px height (min = max).
		 */

		.va-script-box {

			height:
				220px;

			min-height:
				220px;

			max-height:
				220px;

			overflow-y:
				auto;

			box-sizing:
				border-box;

			background:
				#0b0e14;

			border:
				1px solid
				#374151;

			border-radius:
				6px;

			padding:
				8px;

			margin-top:
				10px;

			font-family:
				"Courier New",
				monospace;

			font-size:
				0.75rem;

			line-height:
				1.4;

			white-space:
				pre-wrap;

			color:
				#d1d5db;
		}


		.va-card {

			position:
				relative;

			border:
				1px solid #2e3440;

			border-radius:
				8px;

			background:
				#0f1115;

			padding:
				6px;

			cursor:
				grab;
		}


		.va-card.dragging {

			opacity:
				0.4;
		}


		.va-card.drag-over {

			border-color:
				#f59e0b;
		}


		.va-card img,
		.va-card video {

			width:
				100%;

			height:
				90px;

			object-fit:
				contain;

			display:
				block;

			border-radius:
				4px;
		}


		.va-card-label {

			font-size:
				0.72rem;

			color:
				#9ca3af;

			margin-top:
				4px;

			white-space:
				nowrap;

			overflow:
				hidden;

			text-overflow:
				ellipsis;
		}


		.va-card-remove {

			position:
				absolute;

			top:
				2px;

			right:
				2px;

			width:
				20px;

			height:
				20px;

			border-radius:
				50%;

			border:
				none;

			background:
				#b91c1c;

			color:
				#ffffff;

			cursor:
				pointer;

			line-height:
				1;
		}


		.modal-overlay {

			position:
				fixed;

			top:
				0;

			left:
				0;

			right:
				0;

			bottom:
				0;

			background:
				rgba(0, 0, 0, 0.6);

			display:
				flex;

			align-items:
				center;

			justify-content:
				center;

			z-index:
				100;
		}


		.modal-box {

			background:
				#181b20;

			border:
				1px solid #2e3440;

			border-radius:
				12px;

			padding:
				20px 24px;

			max-width:
				520px;

			width:
				90%;
		}


		.modal-title {

			font-size:
				1.1rem;

			font-weight:
				700;

			margin-bottom:
				12px;
		}


		.modal-box ul {

			margin:
				0 0 16px 20px;

			color:
				#f3f4f6;
		}


		/* =====================================================
		   ROUND 13
		   ===================================================== */

		/*
		 * Fix 1: all accordion dropdowns
		 * and text fields adopt the
		 * caption-input style, full width.
		 */

		.va-left input[type="text"],
		.va-left select,
		.va-ai-prompt {

			width:
				100%;

			box-sizing:
				border-box;

			background:
				#14171c;

			color:
				var(--text);

			border:
				1px solid #374151;

			border-radius:
				6px;

			padding:
				9px 12px;

			font-size:
				0.88rem;

			outline:
				none;
		}


		.va-left input[type="text"]:focus,
		.va-left select:focus,
		.va-ai-prompt:focus {

			border-color:
				#f59e0b;
		}


		/*
		 * Font / Colour row: each label
		 * takes half, the select fills
		 * the rest of its label.
		 */

		.va-row .quality-select {

			flex:
				1 1 0;

			min-width:
				0;

			display:
				flex;

			align-items:
				center;

			gap:
				8px;
		}


		.va-row .quality-select select {

			flex:
				1 1 0;

			min-width:
				0;
		}


		/*
		 * Sticker / Quality are bare
		 * selects carrying the
		 * .quality-select class.
		 */

		select.quality-select {

			display:
				block;

			width:
				100%;
		}


		/*
		 * Fix 4: the add-video button is
		 * rectangular with a label.
		 */

		.bulk-toggle {

			width:
				auto;

			height:
				auto;

			padding:
				10px 16px;

			border-radius:
				8px;

			font-size:
				0.95rem;

			font-weight:
				700;
		}


		/*
		 * Fix 5: sign-in / sign-up
		 * overlay (KV-backed, unlimited
		 * users).
		 */

		.auth-overlay {

			position:
				fixed;

			top:
				0;

			left:
				0;

			right:
				0;

			bottom:
				0;

			background:
				rgba(0, 0, 0, 0.85);

			display:
				none;

			align-items:
				center;

			justify-content:
				center;

			z-index:
				150;
		}


		.auth-box {

			background:
				#181b20;

			border:
				1px solid #2e3440;

			border-radius:
				12px;

			padding:
				24px;

			width:
				90%;

			max-width:
				380px;
		}


		.auth-title {

			font-size:
				1.25rem;

			font-weight:
				700;

			margin-bottom:
				4px;
		}


		.auth-sub {

			color:
				#9ca3af;

			font-size:
				0.8rem;

			margin-bottom:
				14px;
		}


		.auth-error {

			color:
				#f87171;

			font-size:
				0.8rem;

			min-height:
				1.1em;

			margin-bottom:
				8px;
		}


		.auth-field {

			margin-bottom:
				12px;
		}


		.auth-field label {

			display:
				block;

			color:
				#9ca3af;

			font-size:
				0.78rem;

			margin-bottom:
				5px;
		}


		.auth-field input {

			width:
				100%;

			box-sizing:
				border-box;

			background:
				#14171c;

			color:
				var(--text);

			border:
				1px solid #374151;

			border-radius:
				6px;

			padding:
				9px 12px;

			font-size:
				0.88rem;

			outline:
				none;
		}


		.auth-field input:focus {

			border-color:
				#f59e0b;
		}


		.auth-submit {

			width:
				100%;

			justify-content:
				center;

			margin-top:
				4px;
		}


		.auth-switch {

			background:
				none;

			border:
				none;

			color:
				#9ca3af;

			font-size:
				0.8rem;

			cursor:
				pointer;

			margin-top:
				12px;

			padding:
				0;
		}


		.auth-switch:hover {

			color:
				#d1d5db;
		}


		.auth-footer {

			padding:
				14px 24px 22px;

			text-align:
				center;
		}


		.auth-footer-hr {

			border:
				none;

			border-top:
				1px solid #e5e7eb;

			margin:
				0 0 14px;
		}


		.auth-footer-row {

			display:
				flex;

			align-items:
				center;

			justify-content:
				center;

			gap:
				18px;

			flex-wrap:
				wrap;

			font-size:
				0.85rem;
		}


		.auth-footer-user {

			white-space:
				nowrap;

			font-weight:
				600;

			color:
				#1f2937;
		}


		.auth-footer-link {

			white-space:
				nowrap;

			color:
				#2563eb;

			text-decoration:
				underline;

			cursor:
				pointer;
		}


		.auth-footer-link:hover {

			color:
				#1d4ed8;
		}


		.auth-account-box {

			margin:
				12px auto 0;

			max-width:
				340px;

			background:
				#f9fafb;

			border:
				1px solid #e5e7eb;

			border-radius:
				8px;

			padding:
				10px 16px;

			font-size:
				0.85rem;

			color:
				#374151;
		}


		.auth-account-line {

			padding:
				2px 0;
		}


		.auth-logout {

			background:
				#374151;

			color:
				#e5e7eb;

			border:
				none;

			border-radius:
				6px;

			padding:
				6px 12px;

			font-size:
				0.78rem;

			cursor:
				pointer;
		}


		.auth-logout:hover {

			background:
				#4b5563;
		}


		/* =====================================================
		 * BUTTON STANDARDIZATION (accordion)
		 * All buttons inside a Video accordion share the
		 * same SMALL size as the Fullscreen button
		 * (.upload-btn.small: 6px 10px / 0.75rem).
		 * ===================================================== */

		.va-body .upload-btn,
		.va-body .upload-btn.small {

			padding:
				6px 10px;

			font-size:
				0.75rem;

			font-weight:
				bold;

			border-radius:
				6px;
		}


		/*
		 * 4px margin on top + bottom of
		 * every button inside the video
		 * accordion.
		 */

		.va-body button {

			margin-top:
				4px;

			margin-bottom:
				4px;
		}


		/* =====================================================
		 * VOICEOVER MODAL (MeloTTS -> MP3 + subtitles)
		 * ===================================================== */

		.voiceover-voice-label {

			display:
				block;

			margin-bottom:
				10px;
		}


		.voiceover-voice-label select {

			margin-left:
				8px;
		}


		.voiceover-label {

			font-size:
				0.8rem;

			color:
				#9ca3af;

			margin-bottom:
				4px;
		}


		.voiceover-textarea {

			width:
				100%;

			box-sizing:
				border-box;

			background:
				#0b0e14;

			color:
				#d1d5db;

			border:
				1px solid
				#374151;

			border-radius:
				6px;

			padding:
				8px;

			font-family:
				"Courier New",
				monospace;

			font-size:
				0.78rem;

			line-height:
				1.4;

			resize:
				vertical;

			margin-bottom:
				10px;
		}


		.voiceover-textarea:disabled {

			opacity:
				0.85;
		}


		.voiceover-actions {

			display:
				flex;

			gap:
				8px;

			flex-wrap:
				wrap;

			margin-bottom:
				8px;
		}


		/*
		 * The card remove button is
		 * absolutely positioned, so the
		 * 4px button margins would
		 * shift it: keep it in place.
		 */
		.va-body .va-card-remove {

			margin-top:
				0;

			margin-bottom:
				0;
		}

		/*
		 * Caption row x button:
		 * same small look as the
		 * other buttons.
		 */
		.va-body .caption-remove {

			background:
				#374151;

			border:
				none;

			border-radius:
				6px;

			color:
				#d1d5db;

			font-size:
				0.75rem;

			line-height:
				1;

			padding:
				6px 10px;

			cursor:
				pointer;
		}


		.va-body .caption-remove:hover {

			background:
				#4b5563;
		}

		/* =====================================================
		   ADD VIDEO FROM TEMPLATE (composer modal)
		   ===================================================== */

		/*
		 * The text link inside every Video N
		 * accordion (Images / MP4s section).
		 */

		.va-template-link {

			display:
				inline-block;

			margin:
				8px 2px 2px 2px;

			color:
				#60a5fa;

			font-size:
				0.8rem;

			text-decoration:
				underline;

			cursor:
				pointer;
		}


		.va-template-link:hover {

			color:
				#93c5fd;
		}


		/*
		 * Composer modal shell. The overlay
		 * reuses .modal-overlay; everything
		 * else is scoped to #tpl-modal so the
		 * composer's dark theme never leaks
		 * into the studio styles.
		 */

		#tpl-modal .tpl-box {

			background:
				#0d0d0f;

			border:
				1px solid #2e3440;

			border-radius:
				14px;

			padding:
				18px;

			width:
				min(1100px, 96vw);

			max-height:
				92vh;

			overflow-y:
				auto;

			color:
				#fff;
		}


		#tpl-modal .tpl-head {

			display:
				flex;

			align-items:
				center;

			justify-content:
				space-between;

			gap:
				10px;

			margin-bottom:
				4px;
		}


		#tpl-modal .tpl-x {

			background:
				#303037;

			border:
				0;

			border-radius:
				8px;

			color:
				#fff;

			font-size:
				0.9rem;

			padding:
				7px 11px;

			cursor:
				pointer;
		}


		#tpl-modal .tpl-sub {

			color:
				#a8a8b0;

			font-size:
				0.85rem;

			line-height:
				1.45;

			margin:
				0 0 14px;
		}


		#tpl-modal .tpl-controls {

			display:
				flex;

			flex-wrap:
				wrap;

			gap:
				9px;

			align-items:
				center;

			background:
				#1b1b20;

			padding:
				13px;

			border-radius:
				14px;

			margin-bottom:
				14px;
		}


		#tpl-modal .tpl-controls button,
		#tpl-modal .tpl-controls label.tpl-file {

			border:
				0;

			border-radius:
				10px;

			padding:
				10px 13px;

			cursor:
				pointer;

			background:
				#303037;

			color:
				#fff;

			font-weight:
				700;

			font-size:
				0.85rem;
		}


		#tpl-modal button.tpl-primary {

			background:
				#ffd83d;

			color:
				#111;
		}


		#tpl-modal button:disabled {

			opacity:
				0.45;

			cursor:
				not-allowed;
		}


		#tpl-modal input[type="file"] {

			display:
				none;
		}


		#tpl-modal .tpl-status {

			color:
				#bbb;

			font-size:
				13px;

			margin-left:
				auto;
		}


		#tpl-modal .tpl-len {

			display:
				flex;

			align-items:
				center;

			gap:
				6px;

			color:
				#bbb;

			font-size:
				13px;
		}


		#tpl-modal .tpl-len input {

			width:
				65px;

			background:
				#29292e;

			color:
				#fff;

			border:
				1px solid #3b3b42;

			border-radius:
				8px;

			padding:
				9px;
		}


		#tpl-modal .tpl-len select {

			background:
				#29292e;

			color:
				#fff;

			border:
				1px solid #3b3b42;

			border-radius:
				8px;

			padding:
				9px;

			cursor:
				pointer;
		}


		/*
		 * Compact template selection replaces the preview-card grid.
		 */

		#tpl-modal .tpl-design-picker {
			display: flex;
			flex-direction: column;
			gap: 6px;
			margin: 0 0 14px;
		}
		#tpl-modal .tpl-design-picker select {
			padding: 10px;
			border: 1px solid #374151;
			border-radius: 8px;
			background: #19191e;
			color: #fff;
		}
		#tpl-modal .tpl-design-picker small { color: #aaa; }
		#tpl-modal .tpl-field,
		#tpl-modal .tpl-len,
		#tpl-modal .tpl-row label.tpl-range {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 5px;
		}
		#tpl-modal .tpl-field span,
		#tpl-modal .tpl-range span { font-size: 12px; }

		#tpl-modal .tpl-editor {

			background:
				#1b1b20;

			border-radius:
				12px;

			padding:
				10px;

			margin-bottom:
				14px;
		}


		#tpl-modal .tpl-row {

			display:
				flex;

			gap:
				7px;

			align-items:
				center;

			overflow-x:
				auto;
		}


		#tpl-modal .tpl-row input,
		#tpl-modal .tpl-row select {

			height:
				38px;

			border:
				1px solid #3b3b42;

			border-radius:
				8px;

			background:
				#29292e;

			color:
				#fff;

			padding:
				0 9px;

			outline:
				none;
		}


		#tpl-modal .tpl-row input[type="text"] {

			min-width:
				145px;

			flex:
				1;
		}


		#tpl-modal .tpl-row input[type="number"] {

			width:
				76px;
		}


		#tpl-modal .tpl-row input[type="color"] {

			width:
				44px;

			padding:
				3px;
		}


		#tpl-modal .tpl-row label.tpl-file {

			border:
				0;

			border-radius:
				10px;

			padding:
				9px 12px;

			cursor:
				pointer;

			background:
				#303037;

			color:
				#fff;

			font-weight:
				700;

			font-size:
				0.8rem;

			white-space:
				nowrap;
		}


		#tpl-modal .tpl-row label.tpl-range {

			display:
				flex;

			align-items:
				center;

			gap:
				6px;

			color:
				#bbb;

			font-size:
				13px;

			white-space:
				nowrap;
		}


		/*
		 * Preview sizing is constrained to 80px below for both formats.
		 */

		#tpl-modal .tpl-stage {

			width:
				min(100%, 443px);

			margin:
				auto;

			background:
				#000;

			border-radius:
				16px;

			overflow:
				hidden;

			box-shadow:
				0 18px 55px rgba(0, 0, 0, 0.6);
		}


		/*
		 * Landscape preview stage
		 * (16:9 canvas): wider than the
		 * portrait stage but still
		 * compact so the bottom
		 * buttons stay visible.
		 */

		#tpl-modal .tpl-stage.landscape {

			width:
				min(100%, 660px);
		}


		#tpl-modal #tpl-canvas {

			width:
				100%;

			height:
				auto;

			display:
				block;

			background:
				#111;
		}


		#tpl-modal .tpl-timeline {

			height:
				8px;

			background:
				#29292d;

			margin-top:
				12px;

			border-radius:
				8px;

			overflow:
				hidden;
		}


		#tpl-modal .tpl-progress {

			height:
				100%;

			width:
				0;

			background:
				#ffd83d;
		}


		#tpl-modal .tpl-tips {

			color:
				#999;

			font-size:
				13px;

			line-height:
				1.5;

			margin:
				12px 0;
		}


		#tpl-modal a.tpl-download {

			display:
				inline-block;

			color:
				#111;

			background:
				#7cf0a2;

			padding:
				11px 15px;

			border-radius:
				10px;

			font-weight:
				800;

			text-decoration:
				none;

			margin-top:
				10px;
		}


		/*
		 * Stuck to the bottom of the
		 * scroll area so Add / Close
		 * are always reachable.
		 */

		#tpl-modal .tpl-actions {

			display:
				flex;

			flex-wrap:
				wrap;

			gap:
				9px;

			align-items:
				center;

			margin-top:
				14px;

			position:
				sticky;

			bottom:
				0;

			background:
				#0d0d0f;

			padding:
				10px 0 2px;
		}


		#tpl-modal .tpl-actions button {

			border:
				0;

			border-radius:
				10px;

			padding:
				11px 15px;

			cursor:
				pointer;

			background:
				#303037;

			color:
				#fff;

			font-weight:
				700;

			font-size:
				0.9rem;
		}


		#tpl-modal .tpl-actions button.tpl-primary {

			background:
				#ffd83d;

			color:
				#111;
		}




		@media (max-width: 520px) {



			#tpl-modal .tpl-status {

				width:
					100%;

				margin-left:
					0;
			}
		}



		/* =====================================================
		 * THEMES — optional skins for the whole studio.
		 *
		 *  html[data-theme="strata"]   Aerial-inspired sky, mountains,
		 *      diagonal overlays and white type (legacy storage key).
		 *  html[data-theme="stellar"]  pink-to-violet gradient
		 *      backdrop with frosted translucent panels.
		 *  (no attribute)              the built-in amber studio.
		 *
		 * Design language borrowed from the HTML5UP demos "Aerial"
		 * and "Stellar" (html5up.net, @ajlkn, CC BY 3.0); the rules
		 * below are written for this app, not copied from them.
		 *
		 * Every token is re-declared per theme, then one shared
		 * block re-skins the components from those tokens.
		 * ===================================================== */

		html[data-theme="strata"] {
			--bg: #348cb2;
			--card: rgba(12, 46, 66, 0.48);
			--accent: #ffffff;
			--text: #ffffff;

			--t-backdrop:
				#348cb2;
			--t-panel:
				rgba(12, 46, 66, 0.48);
			--t-panel-2:
				rgba(255, 255, 255, 0.06);
			--t-panel-3:
				rgba(255, 255, 255, 0.12);
			--t-line:
				rgba(255, 255, 255, 0.22);
			--t-line-2:
				rgba(255, 255, 255, 0.7);
			--t-ink:
				#ffffff;
			--t-ink-out:
				rgba(255, 255, 255, 0.7);
			--t-heading:
				#ffffff;
			--t-heading-out:
				#ffffff;
			--t-muted:
				rgba(255, 255, 255, 0.8);
			--t-muted-out:
				rgba(255, 255, 255, 0.8);
			--t-accent-ink:
				#ffffff;
			--t-input:
				rgba(8, 36, 54, 0.55);
			--t-btn-bg:
				transparent;
			--t-btn-ink:
				#ffffff;
			--t-btn-line:
				#ffffff;
			--t-btn-bg-hover:
				#ffffff;
			--t-btn-ink-hover:
				#245b75;
			--t-btn2-bg:
				transparent;
			--t-btn2-ink:
				#ffffff;
			--t-btn2-line:
				rgba(255, 255, 255, 0.7);
			--t-btn2-bg-hover:
				rgba(255, 255, 255, 0.12);
			--t-on-accent:
				#245b75;
			--t-shadow:
				0 1px 3px rgba(0, 0, 0, 0.14);
			--t-radius:
				8px;
			--t-radius-sm:
				4px;
			--t-ok:
				#ffffff;
			--t-track:
				rgba(0, 0, 0, 0.12);
		}

		html[data-theme="stellar"] {
			--bg: #5f4d93;
			--card: rgba(255, 255, 255, 0.12);
			--accent: #ffffff;
			--text: rgba(255, 255, 255, 0.92);

			--t-backdrop:
				#5f4d93;
			--t-panel:
				rgba(255, 255, 255, 0.12);
			--t-panel-2:
				rgba(255, 255, 255, 0.075);
			--t-panel-3:
				rgba(0, 0, 0, 0.18);
			--t-line:
				rgba(255, 255, 255, 0.3);
			--t-line-2:
				rgba(255, 255, 255, 0.35);
			--t-ink:
				#ffffff;
			--t-ink-out:
				rgba(255, 255, 255, 0.8);
			--t-heading:
				#ffffff;
			--t-heading-out:
				#ffffff;
			--t-muted:
				rgba(255, 255, 255, 0.72);
			--t-muted-out:
				rgba(255, 255, 255, 0.8);
			--t-accent-ink:
				#ffffff;
			--t-input:
				rgba(255, 255, 255, 0.075);
			--t-btn-bg:
				rgba(255, 255, 255, 0.85);
			--t-btn-ink:
				#5f4d93;
			--t-btn-line:
				transparent;
			--t-btn-bg-hover:
				#ffffff;
			--t-btn-ink-hover:
				#4a3a78;
			--t-btn2-bg:
				rgba(255, 255, 255, 0.1);
			--t-btn2-ink:
				#ffffff;
			--t-btn2-line:
				rgba(255, 255, 255, 0.35);
			--t-btn2-bg-hover:
				rgba(255, 255, 255, 0.24);
			--t-on-accent:
				#5f4d93;
			--t-shadow:
				0 1px 3px rgba(0, 0, 0, 0.18);
			--t-radius:
				10px;
			--t-radius-sm:
				8px;
			--t-ok:
				#ffffff;
			--t-track:
				rgba(0, 0, 0, 0.28);
		}


		.aerial-credit { display: none; }
		html[data-theme="strata"] .aerial-credit { display: block; text-align: center; font-size: 11px; margin: -10px 0 20px; color: rgba(255,255,255,.8); }
		html[data-theme="strata"] .aerial-credit a { color: inherit; }

		/* ---- backdrop + hero ------------------------------- */

		/* Aerial by HTML5 UP / @ajlkn (CC BY 3.0).
		 * Adapted for a scrolling studio, not a fixed landing page.
		 * Background bundled inline so the theme has no remote image dependency.
		 */
		html[data-theme="strata"] body {
			background-color: #348cb2;
			background-image:
				linear-gradient(135deg, rgba(255,255,255,.14) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.08) 75%),
				url("data:image/jpeg;base64,${AERIAL_BACKGROUND}");
			background-size: 640px 640px, auto 100vh;
			background-position: center, 0 bottom;
			background-repeat: repeat, repeat-x;
			background-attachment: fixed;
			color: var(--t-ink-out);
			animation: aerial-drift 90s linear infinite;
		}
		@keyframes aerial-drift {
			from { background-position: center, 0 bottom; }
			to { background-position: center, -1500px bottom; }
		}
		@media (prefers-reduced-motion: reduce) {
			html[data-theme="strata"] body { animation: none; }
		}

		html[data-theme="stellar"] body {
			background-color:
				var(--t-backdrop);
			background-image:
				radial-gradient(
					rgba(255, 255, 255, 0.22) 1px,
					rgba(255, 255, 255, 0) 1px
				),
				linear-gradient(
					45deg,
					#e37682 15%,
					#5f4d93 85%
				);
			background-size:
				24px 24px, 100% 100%;
			background-attachment:
				fixed, fixed;
			color:
				var(--t-ink-out);
		}

		html[data-theme] body {
			font-family:
				"Source Sans Pro",
				"Segoe UI",
				Helvetica,
				Arial,
				sans-serif;
			font-weight:
				400;
		}

		html[data-theme="strata"] .header {
			padding:
				44px 16px 26px 16px;
			margin-bottom:
				20px;
		}

		html[data-theme="stellar"] .header {
			max-width:
				900px;
			margin:
				0 auto 22px auto;
			padding:
				34px 24px;
			background:
				var(--t-panel);
			border:
				1px solid var(--t-line);
			border-radius:
				var(--t-radius);
			-webkit-backdrop-filter: blur(8px);
			backdrop-filter:
				blur(8px);
		}

		html[data-theme] .header h1 {
			color:
				var(--t-heading-out);
			font-size:
				2.45rem;
			font-weight:
				300;
			letter-spacing:
				-0.02em;
			margin-bottom:
				10px;
			border-bottom:
				0;
			padding-bottom:
				0;
		}

		html[data-theme] .header p {
			color:
				var(--t-muted-out);
			font-size:
				0.78rem;
			letter-spacing:
				0.18em;
			text-transform:
				uppercase;
		}

		html[data-theme="strata"] .header::after {
			content:
				"";
			display:
				block;
			width:
				72px;
			height:
				2px;
			margin:
				20px auto 0 auto;
			background:
				var(--accent);
		}

		html[data-theme="stellar"] .header::after {
			content:
				"";
			display:
				block;
			width:
				100%;
			height:
				1px;
			margin:
				18px 0 0 0;
			background:
				var(--t-line);
		}


		/* ---- surfaces ------------------------------------- */

		html[data-theme] .studio,
		html[data-theme] .video-accordion,
		html[data-theme] .bulk-panel,
		html[data-theme] .modal-box,
		html[data-theme] .auth-box,
		html[data-theme] #tpl-modal .tpl-box {
			background:
				var(--t-panel);
			border:
				1px solid var(--t-line);
			border-radius:
				var(--t-radius);
			color:
				var(--t-ink);
			-webkit-backdrop-filter: blur(8px);
			backdrop-filter:
				blur(8px);
			box-shadow:
				var(--t-shadow);
		}

		html[data-theme] .audio-panel,
		html[data-theme] .va-seo-keywords,
		html[data-theme] .va-script-box,
		html[data-theme] .voiceover-textarea,
		html[data-theme] .cfg-status {
			background:
				var(--t-panel-2);
			border:
				1px solid var(--t-line);
			color:
				var(--t-ink);
		}

		html[data-theme] .auth-account-box {
			color:
				var(--t-ink);
		}

		html[data-theme] .va-header {
			background:
				var(--t-panel-2);
			border-bottom:
				1px solid var(--t-line);
			color:
				var(--t-ink);
		}

		html[data-theme] .va-card,
		html[data-theme] .va-ai-card,
		html[data-theme] .auth-account-box,
		html[data-theme] #tpl-modal .tpl-design,
		html[data-theme] .card {
			background:
				var(--t-panel-2);
			border-color:
				var(--t-line);
			color:
				var(--t-ink);
		}

		html[data-theme] #tpl-modal .tpl-design.selected,
		html[data-theme] .card.in-video {
			border-color:
				var(--accent);
		}

		html[data-theme] .va-section,
		html[data-theme] .bulk-slot,
		html[data-theme] h2,
		html[data-theme] .estimate,
		html[data-theme] .auth-footer-hr {
			border-color:
				var(--t-line);
		}

		html[data-theme] .canvas-container {
			background:
				#0b0d11;
			border:
				1px solid var(--t-line);
			box-shadow:
				none;
		}

		html[data-theme] .cfg-box {
			background:
				var(--t-panel);
			border:
				1px solid var(--t-line);
			color:
				var(--t-ink);
		}

		html[data-theme] .ai-fullscreen-overlay {
			background:
				rgba(0, 0, 0, 0.92);
		}


		/* Relative 10% alpha reduction: .12 × .9 = .108.
		 * Backdrop blur +20%: 8px × 1.2 = 9.6px (content stays sharp).
		 */
		html[data-theme="stellar"] .studio,
		html[data-theme="stellar"] .video-accordion {
			background: rgba(255, 255, 255, 0.108);
		}
		html[data-theme="stellar"] .video-accordion {
			-webkit-backdrop-filter: blur(9.6px);
			backdrop-filter: blur(9.6px);
		}
		html[data-theme="strata"] .header h1 {
			font-weight: 900;
			letter-spacing: -0.035em;
			font-size: clamp(2rem, 5vw, 3.8rem);
			text-shadow: 0 2px 12px rgba(0, 0, 0, .15);
		}
		html[data-theme="strata"] .header p {
			text-transform: none;
			letter-spacing: .02em;
			font-size: 1rem;
		}
		html[data-theme="strata"] .va-status,
		html[data-theme="strata"] .bulk-status {
			background: rgba(8, 36, 54, .55);
			color: #ffffff;
		}

		/* ---- type ----------------------------------------- */

		html[data-theme] h2 {
			color:
				var(--t-heading);
			font-weight:
				400;
			border-bottom:
				1px solid var(--t-line);
			padding-bottom:
				10px;
		}

		html[data-theme] .va-section-title,
		html[data-theme] .audio-title,
		html[data-theme] .cfg-group-title,
		html[data-theme] .va-seo-label,
		html[data-theme] .voiceover-label {
			color:
				var(--t-heading);
			font-weight:
				600;
			text-transform:
				uppercase;
			letter-spacing:
				0.08em;
			font-size:
				0.78rem;
		}

		html[data-theme] .va-title,
		html[data-theme] .modal-title,
		html[data-theme] .auth-title,
		html[data-theme] .cfg-title,
		html[data-theme] .tpl-head,
		html[data-theme] #tpl-modal .tpl-box,
		html[data-theme] .tpl-status {
			color:
				var(--t-heading);
		}

		html[data-theme] .va-note,
		html[data-theme] .audio-note,
		html[data-theme] .caption-count,
		html[data-theme] .caption-chars,
		html[data-theme] .estimate,
		html[data-theme] .quality-select,
		html[data-theme] .va-summary,
		html[data-theme] .prompt,
		html[data-theme] .audio-empty,
		html[data-theme] .va-card-label,
		html[data-theme] .va-seo-heading,
		html[data-theme] .cfg-note,
		html[data-theme] .cfg-sub,
		html[data-theme] .auth-sub,
		html[data-theme] .auth-field label,
		html[data-theme] .cfg-field label,
		html[data-theme] #tpl-modal .tpl-sub,
		html[data-theme] #tpl-modal .tpl-tips,
		html[data-theme] .tpl-len span,
		html[data-theme] .bulk-summary,
		html[data-theme] .bulk-caption-wrap,
		html[data-theme] .va-ai-label,
		html[data-theme] .voiceover-voice-label {
			color:
				var(--t-muted);
		}

		html[data-theme] .audio-title,
		html[data-theme] .action-hint {
			color:
				var(--t-muted-out);
		}

		html[data-theme] .status-text {
			color:
				var(--t-ok);
		}

		html[data-theme] .va-template-link,
		html[data-theme] .estimate b,
		html[data-theme] .auth-footer-link {
			color:
				var(--t-accent-ink);
		}


		/* ---- controls ------------------------------------- */

		html[data-theme] .upload-btn,
		html[data-theme] .auth-submit,
		html[data-theme] .va-seo-chip,
		html[data-theme] .cfg-btn {
			background:
				var(--t-btn-bg);
			color:
				var(--t-btn-ink);
			border:
				1px solid var(--t-btn-line);
			border-radius:
				var(--t-radius-sm);
			font-weight:
				600;
			letter-spacing:
				0.06em;
			text-transform:
				uppercase;
			font-size:
				0.82rem;
			box-shadow:
				none;
		}

		html[data-theme] .upload-btn:not(.small),
		html[data-theme] .cfg-btn {
			padding:
				11px 20px;
		}

		html[data-theme] .upload-btn:hover:not(:disabled),
		html[data-theme] .auth-submit:hover:not(:disabled),
		html[data-theme] .cfg-btn:hover {
			background:
				var(--t-btn-bg-hover);
			color:
				var(--t-btn-ink-hover);
			transform:
				none;
			opacity:
				1;
		}

		html[data-theme] .upload-btn:disabled,
		html[data-theme] .cfg-btn:disabled {
			background:
				var(--t-btn2-bg);
			color:
				var(--t-muted);
			border-color:
				var(--t-line);
			opacity:
				0.6;
		}

		html[data-theme] .va-api-btn,
		html[data-theme] .va-scroll-toggle,
		html[data-theme] .toggle-btn,
		html[data-theme] .add-caption-btn,
		html[data-theme] .caption-remove,
		html[data-theme] .remove-audio-btn,
		html[data-theme] .auth-switch,
		html[data-theme] .auth-logout,
		html[data-theme] .cfg-btn.alt,
		html[data-theme] #tpl-modal .tpl-actions button,
		html[data-theme] #tpl-modal label.tpl-file,
		html[data-theme] #tpl-modal a.tpl-download,
		html[data-theme] #tpl-modal .tpl-x {
			background:
				var(--t-btn2-bg);
			color:
				var(--t-btn2-ink);
			border:
				1px solid var(--t-btn2-line);
			border-radius:
				var(--t-radius-sm);
			letter-spacing:
				0.03em;
		}

		html[data-theme] .va-arrow {
			color:
				var(--t-muted);
		}

		html[data-theme] .va-api-btn:hover,
		html[data-theme] .va-scroll-toggle:hover,
		html[data-theme] .toggle-btn:hover,
		html[data-theme] .add-caption-btn:hover,
		html[data-theme] .auth-switch:hover,
		html[data-theme] .auth-logout:hover,
		html[data-theme] .cfg-btn.alt:hover,
		html[data-theme] #tpl-modal .tpl-actions button:hover,
		html[data-theme] #tpl-modal a.tpl-download:hover {
			background:
				var(--t-btn2-bg-hover);
			color:
				var(--t-btn2-ink);
		}

		html[data-theme] .bulk-toggle {
			background:
				var(--accent);
			color:
				var(--t-on-accent);
			border:
				2px solid var(--t-btn-line);
			box-shadow:
				var(--t-shadow);
		}

		html[data-theme="stellar"] .bulk-toggle {
			border-color:
				rgba(255, 255, 255, 0.5);
		}

		html[data-theme] .badge {
			background:
				var(--accent);
			color:
				var(--t-on-accent);
		}

		html[data-theme] #tpl-modal button.tpl-primary {
			background:
				var(--t-btn-bg-hover);
			color:
				var(--t-btn-ink-hover);
			border:
				1px solid var(--t-btn-line);
		}

		html[data-theme] .va-status,
		html[data-theme] .bulk-status {
			background:
				var(--t-panel-3);
			color:
				var(--t-ink);
			border:
				1px solid var(--t-line);
		}


		html[data-theme] .progress-bar-container {
			background:
				var(--t-track);
		}

		html[data-theme] .progress-bar {
			background:
				var(--accent);
		}

		html[data-theme="stellar"] .progress-bar {
			background:
				#ffffff;
		}

		html[data-theme] .va-seo-chip b {
			color:
				var(--t-accent-ink);
		}


		/* ---- form fields ---------------------------------- */

		html[data-theme] input[type="text"],
		html[data-theme] input[type="number"],
		html[data-theme] input[type="password"],
		html[data-theme] input[type="color"],
		html[data-theme] select,
		html[data-theme] textarea,
		html[data-theme] .title-row input[type="text"],
		html[data-theme] .caption-text,
		html[data-theme] .caption-time input,
		html[data-theme] .va-ai-prompt,
		html[data-theme] .quality-select select,
		html[data-theme] select.quality-select,
		html[data-theme] .cfg-field input,
		html[data-theme] .cfg-field select,
		html[data-theme] .auth-field input,
		html[data-theme] .voiceover-voice-label select {
			background:
				var(--t-input);
			color:
				var(--t-ink);
			border:
				1px solid var(--t-line-2);
			border-radius:
				var(--t-radius-sm);
		}

		html[data-theme] input[type="text"]::placeholder,
		html[data-theme] textarea::placeholder {
			color:
				var(--t-muted);
		}

		html[data-theme] input[type="text"]:focus,
		html[data-theme] select:focus,
		html[data-theme] textarea:focus,
		html[data-theme] .cfg-field input:focus,
		html[data-theme] .cfg-field select:focus {
			border-color:
				var(--accent);
			outline:
				none;
		}

		html[data-theme] select option {
			background: var(--t-backdrop);
			color: var(--t-ink);
		}

		html[data-theme="strata"] .va-script-box,
		html[data-theme="strata"] .voiceover-textarea {
			color:
				#ffffff;
		}

		html[data-theme] .caption-sample,
		html[data-theme] .caption-sample * {
			background:
				#ffffff;
			color:
				#000000;
		}

		html[data-theme] .bulk-banner {
			background:
				rgba(127, 29, 29, 0.92);
			color:
				#ffffff;
			border:
				1px solid rgba(255, 255, 255, 0.25);
			border-radius:
				var(--t-radius-sm);
		}


		/* ---- theme picker (settings page) ----------------- */

		.cfg-themes {
			display:
				flex;
			gap:
				8px;
			margin:
				8px 0 4px 0;
		}

		.cfg-theme {
			flex:
				1 1 0;
			display:
				flex;
			flex-direction:
				column;
			gap:
				6px;
			padding:
				8px;
			background:
				#14171c;
			border:
				2px solid #2e3440;
			border-radius:
				10px;
			cursor:
				pointer;
		}

		.cfg-theme:hover {
			border-color:
				#4b5563;
		}

		.cfg-theme.active {
			border-color:
				#f59e0b;
		}

		.cfg-theme input {
			position:
				absolute;
			opacity:
				0;
			pointer-events:
				none;
		}

		.cfg-theme-name {
			font-size:
				0.82rem;
			font-weight:
				600;
			color:
				#f3f4f6;
		}

		.cfg-theme-sub {
			font-size:
				0.7rem;
			line-height:
				1.35;
			color:
				#9ca3af;
		}

		.cfg-theme-preview {
			height:
				34px;
			border-radius:
				6px;
			border:
				1px solid rgba(255, 255, 255, 0.18);
		}

		.cfg-preview-default {
			background:
				linear-gradient(
					135deg,
					#0f1115 0%,
					#181b20 55%,
					#f59e0b 55%,
					#f59e0b 70%,
					#181b20 70%
				);
		}

		.cfg-preview-strata {
			background: linear-gradient(135deg, rgba(255,255,255,.22) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.12) 75%), linear-gradient(#348cb2, #b5d5df);
		}

		.cfg-preview-stellar {
			background:
				linear-gradient(
					135deg,
					#e37682 0%,
					#5f4d93 100%
				);
		}

		html[data-theme] .cfg-theme {
			background:
				var(--t-panel-2);
			border-color:
				var(--t-line);
		}

		html[data-theme] .cfg-theme.active {
			border-color:
				var(--accent);
		}

		html[data-theme] .cfg-theme-name {
			color:
				var(--t-heading);
		}

		html[data-theme] .cfg-theme-sub {
			color:
				var(--t-muted);
		}

		#tpl-modal .tpl-stage,
		#tpl-modal .tpl-stage.landscape {
			width: 100%;
			height: 80px;
			min-height: 80px;
			max-height: 80px;
			border-radius: 8px;
		}
		#tpl-modal #tpl-canvas {
			width: 100%;
			height: 80px;
			min-height: 80px;
			max-height: 80px;
			object-fit: contain;
		}
		#tpl-modal .tpl-actions {
			justify-content: center;
			align-items: center;
			min-height: 64px;
			padding: 10px 0;
			z-index: 1;
		}
		html[data-theme] #tpl-modal .tpl-actions {
			background: var(--t-backdrop);
		}
		html[data-theme] #tpl-modal .tpl-editor {
			background: var(--t-panel-2);
		}
		html[data-theme] #tpl-modal .tpl-design-picker small {
			color: var(--t-muted);
		}

`;
