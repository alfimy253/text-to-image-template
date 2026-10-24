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


		/*
		 * ONE COLUMN ONLY: every section
		 * inside a video accordion stacks
		 * full width (the AI images panel
		 * now sits under the gallery).
		 */

		.va-body {

			display:
				flex;

			flex-direction:
				column;

			gap:
				0;

			padding:
				4px 16px 14px 16px;

			align-items:
				stretch;
		}


		/*
		 * Single column: the left wrapper
		 * is the accordion's only column.
		 */

		.va-left {

			width:
				100%;

			min-width:
				0;
		}


		/*
		 * AI image panel (under the
		 * Images / MP4s gallery)
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


		/*
		 * The AI panel is full width now:
		 * lay its result cards out like the
		 * gallery thumbs instead of one huge
		 * full-width stack.
		 */

		.va-ai-results {

			display:
				grid;

			grid-template-columns:
				repeat(
					auto-fill,
						minmax(160px, 1fr)
				);

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

			/*
			 * 3px of breathing room after
			 * every accordion section.
			 */

			margin-bottom:
				3px;
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
			 * the one long-tail keyword and
			 * the four short keywords, each
			 * with its measured hits (the
			 * minimum is 1x long-tail and
			 * 2x per short; higher counts are
			 * valid).
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
		 * Upload-style buttons share the larger Upload Image
		 * proportions (12px 24px / 1rem). The final accordion
		 * rule below extends the same tap target to every button.
		 * ===================================================== */

		.va-body .upload-btn,
		.va-body .upload-btn.small {

			padding:
				12px 24px;

			font-size:
				1rem;

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
		 * Caption row x button: the final accordion rule
		 * below gives it the same large tap target as
		 * the other buttons.
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


		/* -----------------------------------------------------
		 * Bulk-video reference skins (Bug Fix Session #240).
		 * Token blocks only: the shared
		 * html[data-theme] block below re-skins every
		 * component from --t-*, so a new skin needs no
		 * component rules of its own.
		 *
		 * Palette + type are taken from the four themes in
		 * the uploaded "video_bulk_production" reference
		 * (Night Lab, Warm Paper, Swiss, Neo Brutalist).
		 * ----------------------------------------------------- */

		html[data-theme="nightlab"] {
			--bg: #0b0d12;
			--card: #141923;
			--accent: #baff61;
			--text: #f5f6fa;

			--t-backdrop: #0b0d12;
			--t-panel: #141923;
			--t-panel-2: #1b2130;
			--t-panel-3: #0e1219;
			--t-line: #2c3444;
			--t-line-2: #3a4457;
			--t-ink: #f5f6fa;
			--t-ink-out: #f5f6fa;
			--t-heading: #f5f6fa;
			--t-heading-out: #f5f6fa;
			--t-muted: #929bad;
			--t-muted-out: #929bad;
			--t-accent-ink: #baff61;
			--t-input: #0c1017;
			--t-btn-bg: #baff61;
			--t-btn-ink: #10140d;
			--t-btn-line: #baff61;
			--t-btn-bg-hover: #ccff8d;
			--t-btn-ink-hover: #10140d;
			--t-btn2-bg: #1b2130;
			--t-btn2-ink: #f5f6fa;
			--t-btn2-line: #2c3444;
			--t-btn2-bg-hover: #262f40;
			--t-on-accent: #10140d;
			--t-shadow: 0 12px 30px #0002;
			--t-radius: 15px;
			--t-radius-sm: 10px;
			--t-ok: #baff61;
			--t-track: #0e1219;
		}

		html[data-theme="paper"] {
			--bg: #f0ece3;
			--card: #fffdf7;
			--accent: #e85f42;
			--text: #272720;

			--t-backdrop: #f0ece3;
			--t-panel: #fffdf7;
			--t-panel-2: #f5f0e7;
			--t-panel-3: #faf5ed;
			--t-line: #ded8cc;
			--t-line-2: #cfc7b7;
			--t-ink: #272720;
			--t-ink-out: #272720;
			--t-heading: #272720;
			--t-heading-out: #272720;
			--t-muted: #777367;
			--t-muted-out: #777367;
			--t-accent-ink: #c8472c;
			--t-input: #fffdf7;
			--t-btn-bg: #fffdf7;
			--t-btn-ink: #272720;
			--t-btn-line: #ded8cc;
			--t-btn-bg-hover: #f5f0e7;
			--t-btn-ink-hover: #111111;
			--t-btn2-bg: #f5f0e7;
			--t-btn2-ink: #272720;
			--t-btn2-line: #ded8cc;
			--t-btn2-bg-hover: #ebe4d7;
			--t-on-accent: #10140d;
			--t-shadow: 0 12px 30px #0001;
			--t-radius: 15px;
			--t-radius-sm: 10px;
			--t-ok: #2f7d4f;
			--t-track: #f5f0e7;
		}

		html[data-theme="swiss"] {
			--bg: #f4f5f7;
			--card: #ffffff;
			--accent: #2364f5;
			--text: #15171b;

			--t-backdrop: #f4f5f7;
			--t-panel: #ffffff;
			--t-panel-2: #f8f9fb;
			--t-panel-3: #f8f9fb;
			--t-line: #dfe3e8;
			--t-line-2: #c9d0d9;
			--t-ink: #15171b;
			--t-ink-out: #15171b;
			--t-heading: #15171b;
			--t-heading-out: #15171b;
			--t-muted: #6d737d;
			--t-muted-out: #6d737d;
			--t-accent-ink: #1b4fd0;
			--t-input: #f8f9fb;
			--t-btn-bg: #ffffff;
			--t-btn-ink: #15171b;
			--t-btn-line: #dfe3e8;
			--t-btn-bg-hover: #f8f9fb;
			--t-btn-ink-hover: #15171b;
			--t-btn2-bg: #f8f9fb;
			--t-btn2-ink: #15171b;
			--t-btn2-line: #dfe3e8;
			--t-btn2-bg-hover: #eef1f5;
			--t-on-accent: #ffffff;
			--t-shadow: 0 8px 28px rgba(22, 29, 45, 0.07);
			--t-radius: 14px;
			--t-radius-sm: 9px;
			--t-ok: #1b7f4b;
			--t-track: #f8f9fb;
		}

		html[data-theme="neo"] {
			--bg: #f6f3e9;
			--card: #fffdf5;
			--accent: #d8ff00;
			--text: #111111;

			--t-backdrop: #f6f3e9;
			--t-panel: #fffdf5;
			--t-panel-2: #f0ecdf;
			--t-panel-3: #f0ecdf;
			--t-line: #111111;
			--t-line-2: #111111;
			--t-ink: #111111;
			--t-ink-out: #111111;
			--t-heading: #111111;
			--t-heading-out: #111111;
			--t-muted: #555348;
			--t-muted-out: #555348;
			--t-accent-ink: #111111;
			--t-input: #fffdf5;
			--t-btn-bg: #fffdf5;
			--t-btn-ink: #111111;
			--t-btn-line: #111111;
			--t-btn-bg-hover: #d8ff00;
			--t-btn-ink-hover: #111111;
			--t-btn2-bg: #f0ecdf;
			--t-btn2-ink: #111111;
			--t-btn2-line: #111111;
			--t-btn2-bg-hover: #e4dfcf;
			--t-on-accent: #111111;
			--t-shadow: 4px 4px 0 #111111;
			--t-radius: 3px;
			--t-radius-sm: 2px;
			--t-ok: #166534;
			--t-track: #f0ecdf;
		}

		/* Flat, border-forward skins: the upload's per-theme
		 * rules reduced to the app's surface vocabulary. */

		html[data-theme="neo"] body,
		html[data-theme="paper"] body,
		html[data-theme="swiss"] body {
			background-image: none;
		}

		html[data-theme="neo"] .studio-card,
		html[data-theme="neo"] .video-accordion,
		html[data-theme="neo"] .modal-box,
		html[data-theme="neo"] .auth-box,
		html[data-theme="neo"] .cfg-box {
			border-width: 2px;
			border-color: var(--t-line);
			box-shadow: var(--t-shadow);
		}

		html[data-theme="neo"] .upload-btn,
		html[data-theme="neo"] #render-btn,
		html[data-theme="neo"] .app-generate,
		html[data-theme="neo"] .bulk-toggle,
		html[data-theme="neo"] .view-switch,
		html[data-theme="neo"] .view-switch-btn.active {
			border-width: 2px;
			border-color: #111111;
			border-radius: 2px;
			text-transform: uppercase;
			letter-spacing: 0.02em;
			transform: none;
		}

		html[data-theme="neo"] .upload-btn:active,
		html[data-theme="neo"] #render-btn:active,
		html[data-theme="neo"] .app-generate:active {
			box-shadow: 1px 1px 0 #111111;
			transform: translate(2px, 2px);
		}

		html[data-theme="neo"] .app-top {
			border-bottom-width: 3px;
			border-bottom-color: #111111;
		}

		html[data-theme="paper"] .studio-card,
		html[data-theme="swiss"] .studio-card {
			box-shadow: var(--t-shadow);
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
			flex-wrap:
				wrap;
			gap:
				8px;
			margin:
				8px 0 4px 0;
		}

		.cfg-theme {
			flex:
				1 1 150px;
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

		/* Bug Fix Session #240 skins: four colour chips. */

		.cfg-preview-nightlab {
			background:
				linear-gradient(
					135deg,
					#0b0d12 0%,
					#1b2130 55%,
					#baff61 55%,
					#baff61 70%,
					#1b2130 70%
				);
		}

		.cfg-preview-paper {
			background:
				linear-gradient(
					135deg,
					#f0ece3 0%,
					#fffdf7 55%,
					#e85f42 55%,
					#e85f42 70%,
					#f5f0e7 70%
				);
		}

		.cfg-preview-swiss {
			background:
				linear-gradient(
					135deg,
					#f4f5f7 0%,
					#ffffff 55%,
					#2364f5 55%,
					#2364f5 70%,
					#f8f9fb 70%
				);
		}

		.cfg-preview-neo {
			background:
				linear-gradient(
					135deg,
					#f6f3e9 0%,
					#fffdf5 55%,
					#d8ff00 55%,
					#d8ff00 70%,
					#111111 70%
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

		/* =====================================================
		 * PUBLIC LANDING PAGE + ACCESSIBLE STUDIO GATE
		 * ===================================================== */

		#studio-app[hidden] {
			display: none !important;
		}

		#studio-app:not([hidden]) {
			display: block;
		}

		.landing-page {
			--landing-ink: #f3f4f6;
			--landing-muted: #a6a7b0;
			--landing-faint: #83848d;
			/* Same accent as the studio theme (html[data-theme]). */
			--landing-accent: var(--accent);
			--landing-accent-rgb: 245, 158, 11;
			--landing-accent-hover: #fbbf24;
			--landing-on-accent: #1a1713;
			--landing-line: rgba(255, 255, 255, 0.11);
			--landing-line-strong: rgba(255, 255, 255, 0.23);
			--landing-panel: rgba(255, 255, 255, 0.05);
			--landing-panel-2: rgba(255, 255, 255, 0.022);
			--landing-panel-line: rgba(255, 255, 255, 0.095);
			--landing-nav-bg: rgba(15, 17, 21, 0.62);
			--landing-footer-bg: rgba(11, 12, 16, 0.42);
			position: relative;
			isolation: isolate;
			width: calc(100% + 40px);
			min-height: 100vh;
			margin: -20px -20px 0;
			overflow: hidden;
			background-color: var(--bg);
			background-image:
				radial-gradient(ellipse at 74% 14%, rgba(var(--landing-accent-rgb), 0.12), transparent 34%),
				radial-gradient(ellipse at 9% 55%, rgba(80, 81, 118, 0.12), transparent 34%),
				linear-gradient(180deg, #0f1115 0%, #121318 58%, #0f1115 100%);
			color: var(--landing-ink);
			font-family: "Source Sans Pro", system-ui, -apple-system, sans-serif;
		}

		.landing-page::before {
			position: absolute;
			inset: 0;
			z-index: -1;
			background-image:
				linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
				linear-gradient(90deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px);
			background-size: 72px 72px;
			content: "";
			mask-image: linear-gradient(to bottom, black, transparent 78%);
			pointer-events: none;
		}

		.landing-page a {
			color: inherit;
			text-decoration: none;
		}

		.landing-page button {
			font: inherit;
		}

		.landing-nav {
			position: relative;
			z-index: 2;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 24px;
			max-width: 1440px;
			height: 82px;
			margin: 0 auto;
			padding: 0 clamp(24px, 7vw, 100px);
			border-bottom: 1px solid var(--landing-line);
			background: var(--landing-nav-bg);
			-webkit-backdrop-filter: blur(16px);
			backdrop-filter: blur(16px);
		}

		.landing-brand {
			display: inline-flex;
			align-items: center;
			gap: 11px;
			flex: 0 0 auto;
		}

		.landing-brand-mark {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 36px;
			height: 36px;
			border: 1px solid rgba(var(--landing-accent-rgb), 0.48);
			border-radius: 11px;
			background: linear-gradient(145deg, rgba(var(--landing-accent-rgb), 0.22), rgba(var(--landing-accent-rgb), 0.04));
			color: var(--landing-accent);
			font-size: 1.05rem;
			font-weight: 900;
			letter-spacing: -0.08em;
		}

		.landing-brand-name {
			color: var(--landing-ink);
			font-size: 0.77rem;
			font-weight: 400;
			letter-spacing: 0.2em;
		}

		.landing-brand-name b {
			color: var(--landing-accent);
			font-weight: 700;
		}

		.landing-nav-links {
			display: flex;
			align-items: center;
			gap: clamp(22px, 3.6vw, 48px);
			color: var(--landing-muted);
			font-size: 0.87rem;
		}

		.landing-nav-links a,
		.landing-footer-menu a {
			transition: color 160ms ease;
		}

		.landing-nav-links a:hover,
		.landing-footer-menu a:hover {
			color: var(--landing-accent);
		}

		.landing-signup {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 14px;
			min-height: 42px;
			padding: 0 18px;
			border: 1px solid rgba(var(--landing-accent-rgb), 0.5);
			border-radius: 7px;
			background: rgba(var(--landing-accent-rgb), 0.08);
			color: var(--landing-ink) !important;
			font-size: 0.86rem;
			font-weight: 600;
			transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
		}

		.landing-signup span {
			color: var(--landing-accent);
			font-size: 1rem;
		}

		.landing-signup:hover {
			transform: translateY(-1px);
			border-color: var(--landing-accent);
			background: rgba(var(--landing-accent-rgb), 0.15);
		}

		.landing-main {
			position: relative;
			z-index: 1;
			max-width: 1440px;
			margin: 0 auto;
		}

		.landing-hero {
			display: grid;
			grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.06fr);
			align-items: center;
			gap: clamp(36px, 6vw, 86px);
			padding: 92px clamp(24px, 7vw, 100px) 96px;
		}

		.landing-hero-copy {
			position: relative;
			z-index: 1;
		}

		.landing-eyebrow {
			display: flex;
			align-items: center;
			gap: 10px;
			margin-bottom: 22px;
			color: var(--landing-accent);
			font-size: 0.68rem;
			font-weight: 700;
			letter-spacing: 0.2em;
			line-height: 1.5;
		}

		.landing-eyebrow > span {
			width: 7px;
			height: 7px;
			border-radius: 50%;
			background: var(--landing-accent);
			box-shadow: 0 0 16px rgba(var(--landing-accent-rgb), 0.7);
		}

		.landing-hero h1 {
			max-width: 700px;
			margin: 0;
			color: var(--landing-ink);
			font-size: clamp(3.3rem, 6.5vw, 6.35rem);
			font-weight: 600;
			letter-spacing: -0.075em;
			line-height: 0.97;
		}

		.landing-hero h1 span,
		.landing-section-heading h2 span,
		.landing-feature-heading h2 span,
		.landing-cta h2 span {
			color: var(--landing-accent);
		}

		.landing-lead {
			max-width: 480px;
			margin-top: 27px;
			color: var(--landing-muted);
			font-size: clamp(1rem, 1.2vw, 1.13rem);
			line-height: 1.75;
		}

		.landing-actions {
			display: flex;
			align-items: center;
			gap: 23px;
			flex-wrap: wrap;
			margin-top: 31px;
		}

		.landing-primary {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 22px;
			min-height: 52px;
			padding: 0 21px;
			border: 1px solid var(--landing-accent);
			border-radius: 7px;
			background: var(--landing-accent);
			color: var(--landing-on-accent);
			font-size: 0.92rem;
			font-weight: 700;
			cursor: pointer;
			box-shadow: 0 8px 28px rgba(var(--landing-accent-rgb), 0.14);
			transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
		}

		.landing-primary:hover {
			transform: translateY(-2px);
			background: var(--landing-accent-hover);
			box-shadow: 0 12px 34px rgba(var(--landing-accent-rgb), 0.24);
		}

		.landing-primary span {
			font-size: 1.05rem;
		}

		.landing-secondary {
			display: inline-flex;
			align-items: center;
			gap: 10px;
			color: var(--landing-ink) !important;
			font-size: 0.88rem;
			transition: color 160ms ease;
		}

		.landing-secondary:hover {
			color: var(--landing-accent) !important;
		}

		.landing-secondary-play {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 28px;
			height: 28px;
			border: 1px solid rgba(255, 255, 255, 0.3);
			border-radius: 50%;
			font-size: 0.58rem;
			padding-left: 2px;
		}

		.landing-microcopy {
			display: flex;
			align-items: center;
			gap: 12px;
			margin-top: 27px;
			color: var(--landing-faint);
			font-size: 0.76rem;
		}

		.landing-microcopy i {
			width: 3px;
			height: 3px;
			border-radius: 50%;
			background: var(--landing-faint);
		}

		.landing-hero-art {
			position: relative;
			display: flex;
			align-items: center;
			justify-content: center;
			min-width: 0;
			min-height: 455px;
		}

		.landing-orbit {
			position: absolute;
			border: 1px solid rgba(var(--landing-accent-rgb), 0.12);
			border-radius: 50%;
			pointer-events: none;
		}

		.landing-orbit-one {
			width: min(94%, 535px);
			aspect-ratio: 1;
		}

		.landing-orbit-two {
			width: min(76%, 435px);
			aspect-ratio: 1;
			border-color: rgba(255, 255, 255, 0.055);
		}

		.landing-preview-card {
			position: relative;
			z-index: 1;
			width: min(100%, 570px);
			padding: 13px;
			border: 1px solid rgba(255, 255, 255, 0.15);
			border-radius: 15px;
			background: linear-gradient(150deg, rgba(38, 39, 47, 0.96), rgba(19, 20, 26, 0.96));
			box-shadow: 0 30px 90px rgba(0, 0, 0, 0.5), 0 0 55px rgba(var(--landing-accent-rgb), 0.055);
			transform: rotate(1.2deg);
		}

		.landing-preview-topbar {
			display: flex;
			align-items: center;
			min-height: 29px;
			padding: 0 3px 10px;
			color: #777983;
			font-size: 0.55rem;
			font-weight: 700;
			letter-spacing: 0.12em;
		}

		.preview-window-dots {
			display: flex;
			gap: 4px;
			margin-right: 12px;
		}

		.preview-window-dots i {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			background: #555762;
		}

		.preview-window-dots i:first-child {
			background: #d57771;
		}

		.preview-window-dots i:nth-child(2) {
			background: #d9ae5e;
		}

		.preview-window-dots i:nth-child(3) {
			background: #76a981;
		}

		.preview-project-name {
			flex: 1;
		}

		.preview-ready {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			color: #a7c69e;
			letter-spacing: 0.08em;
		}

		.preview-ready i {
			width: 5px;
			height: 5px;
			border-radius: 50%;
			background: #9fc78e;
			box-shadow: 0 0 8px rgba(159, 199, 142, 0.65);
		}

		.landing-preview-canvas {
			padding: 5px;
			border: 1px solid rgba(255, 255, 255, 0.07);
			border-radius: 9px;
			background: #0e0f14;
		}

		.preview-scene {
			position: relative;
			aspect-ratio: 16 / 9;
			overflow: hidden;
			border-radius: 5px;
			background:
				linear-gradient(180deg, #364252 0%, #695d66 52%, #d38b70 100%);
		}

		.preview-scene::after {
			position: absolute;
			inset: 0;
			background: linear-gradient(180deg, transparent 40%, rgba(13, 13, 17, 0.68) 100%);
			content: "";
		}

		.preview-sun {
			position: absolute;
			top: 16%;
			right: 19%;
			width: 16%;
			aspect-ratio: 1;
			border-radius: 50%;
			background: #f1c28d;
			box-shadow: 0 0 50px rgba(241, 194, 141, 0.3);
		}

		.preview-cloud {
			position: absolute;
			z-index: 1;
			height: 9%;
			border-radius: 50%;
			background: rgba(246, 221, 203, 0.24);
			filter: blur(9px);
		}

		.preview-cloud-one {
			top: 23%;
			left: 15%;
			width: 28%;
		}

		.preview-cloud-two {
			top: 37%;
			right: 20%;
			width: 22%;
			opacity: 0.7;
		}

		.preview-mountain {
			position: absolute;
			bottom: -1px;
			left: 0;
			width: 100%;
			height: 65%;
			clip-path: polygon(0 67%, 14% 44%, 25% 58%, 43% 22%, 58% 57%, 73% 36%, 86% 55%, 100% 31%, 100% 100%, 0 100%);
		}

		.preview-mountain-back {
			background: linear-gradient(145deg, #3e4857, #343340 68%);
		}

		.preview-mountain-front {
			z-index: 1;
			height: 46%;
			background: linear-gradient(130deg, #26323a, #171e28 72%);
			clip-path: polygon(0 44%, 17% 61%, 32% 37%, 47% 65%, 68% 30%, 82% 56%, 100% 40%, 100% 100%, 0 100%);
		}

		.preview-scene-caption {
			position: absolute;
			z-index: 2;
			bottom: 13%;
			left: 0;
			width: 100%;
			color: rgba(255, 255, 255, 0.92);
			font-size: clamp(0.8rem, 1.65vw, 1.2rem);
			font-weight: 700;
			letter-spacing: 0.19em;
			text-align: center;
			text-shadow: 0 2px 9px rgba(0, 0, 0, 0.6);
		}

		.preview-scene-caption b {
			color: #f6c27d;
			font-weight: 700;
		}

		.preview-scene-play {
			position: absolute;
			z-index: 3;
			top: 50%;
			left: 50%;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 48px;
			height: 48px;
			padding-left: 3px;
			border: 1px solid rgba(255, 255, 255, 0.6);
			border-radius: 50%;
			background: rgba(20, 20, 24, 0.3);
			color: white;
			font-size: 0.8rem;
			transform: translate(-50%, -50%);
			-webkit-backdrop-filter: blur(4px);
			backdrop-filter: blur(4px);
		}

		.preview-control-row {
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 11px 5px 9px;
			color: #9b9da6;
			font-size: 0.58rem;
		}

		.preview-play-mini {
			color: var(--landing-accent);
			font-size: 0.65rem;
		}

		.preview-time {
			white-space: nowrap;
		}

		.preview-time i {
			color: #5f6069;
			font-style: normal;
		}

		.preview-wave {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 2px;
			flex: 1;
			height: 16px;
		}

		.preview-wave i {
			width: 2px;
			height: 32%;
			border-radius: 3px;
			background: rgba(var(--landing-accent-rgb), 0.75);
		}

		.preview-wave i:nth-child(3n) { height: 78%; }
		.preview-wave i:nth-child(4n) { height: 53%; }
		.preview-wave i:nth-child(5n) { height: 92%; }
		.preview-wave i:nth-child(7n) { height: 66%; }

		.preview-export {
			padding: 4px 7px;
			border: 1px solid rgba(255, 255, 255, 0.14);
			border-radius: 4px;
			color: #d6d6da;
			font-size: 0.51rem;
			font-weight: 700;
			letter-spacing: 0.08em;
		}

		.preview-timeline {
			padding: 9px 5px 3px;
			border-top: 1px solid rgba(255, 255, 255, 0.08);
		}

		.preview-timeline-label {
			margin-bottom: 5px;
			color: #686a75;
			font-size: 0.48rem;
			font-weight: 700;
			letter-spacing: 0.16em;
		}

		.preview-timeline-clips {
			display: grid;
			grid-template-columns: 1.1fr 0.82fr 1fr 0.74fr;
			gap: 4px;
			height: 24px;
			margin-bottom: 5px;
		}

		.preview-timeline-clips span {
			border: 1px solid rgba(255, 255, 255, 0.11);
			border-radius: 3px;
			background: linear-gradient(135deg, #76645c, #39434a 58%, #20252d);
		}

		.preview-timeline-clips span:nth-child(2) {
			background: linear-gradient(135deg, #b07d65, #58505b 54%, #30323b);
		}

		.preview-timeline-clips span:nth-child(3) {
			background: linear-gradient(135deg, #4b626b, #9a7565 55%, #302c37);
		}

		.preview-audio-track {
			display: flex;
			align-items: center;
			gap: 8px;
			height: 17px;
			padding: 0 7px;
			border: 1px solid rgba(var(--landing-accent-rgb), 0.19);
			border-radius: 3px;
			background: rgba(var(--landing-accent-rgb), 0.055);
			color: rgba(245, 190, 126, 0.78);
			font-size: 0.45rem;
			letter-spacing: 0.12em;
		}

		.preview-audio-track i {
			flex: 1;
			height: 5px;
			background: repeating-linear-gradient(90deg, rgba(var(--landing-accent-rgb), 0.55) 0 2px, transparent 2px 5px);
			opacity: 0.65;
		}

		.preview-float {
			position: absolute;
			z-index: 2;
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 11px 14px;
			border: 1px solid rgba(255, 255, 255, 0.14);
			border-radius: 8px;
			background: rgba(28, 29, 36, 0.94);
			box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
			color: #e9e8e5;
			font-size: 0.73rem;
			font-weight: 600;
			letter-spacing: 0.02em;
			-webkit-backdrop-filter: blur(12px);
			backdrop-filter: blur(12px);
		}

		.preview-float span {
			color: var(--landing-accent);
			font-size: 1rem;
		}

		.preview-float-top {
			top: 33px;
			left: -13px;
		}

		.preview-float-bottom {
			right: -9px;
			bottom: 22px;
		}

		.landing-proof {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 26px;
			max-width: 1240px;
			margin: 0 auto;
			padding: 26px clamp(24px, 5vw, 64px);
			border-top: 1px solid var(--landing-line);
			border-bottom: 1px solid var(--landing-line);
		}

		.landing-proof-item {
			display: flex;
			align-items: center;
			gap: 14px;
			min-width: 0;
		}

		.proof-icon {
			display: flex;
			align-items: center;
			justify-content: center;
			flex: 0 0 36px;
			width: 36px;
			height: 36px;
			border: 1px solid rgba(var(--landing-accent-rgb), 0.25);
			border-radius: 50%;
			background: rgba(var(--landing-accent-rgb), 0.07);
			color: var(--landing-accent);
			font-size: 0.9rem;
		}

		.landing-proof-item b,
		.landing-proof-item span:not(.proof-icon) {
			display: block;
		}

		.landing-proof-item b {
			margin-bottom: 3px;
			color: var(--landing-ink);
			font-size: 0.84rem;
			font-weight: 600;
		}

		.landing-proof-item span:not(.proof-icon) {
			color: var(--landing-muted);
			font-size: 0.72rem;
			line-height: 1.45;
		}

		.landing-section {
			max-width: 1240px;
			margin: 0 auto;
			padding: 118px clamp(24px, 5vw, 64px);
		}

		.landing-process {
			display: grid;
			grid-template-columns: minmax(0, 0.72fr) minmax(0, 1.28fr);
			align-items: start;
			gap: clamp(42px, 7vw, 100px);
		}

		.landing-section-heading .landing-eyebrow,
		.landing-feature-heading .landing-eyebrow,
		.landing-cta .landing-eyebrow {
			margin-bottom: 18px;
		}

		.landing-section-heading h2,
		.landing-feature-heading h2,
		.landing-cta h2 {
			margin: 0;
			color: var(--landing-ink);
			font-size: clamp(2.45rem, 4.3vw, 4.35rem);
			font-weight: 600;
			letter-spacing: -0.07em;
			line-height: 1.02;
		}

		.landing-section-heading > p:last-child {
			max-width: 350px;
			margin-top: 19px;
			color: var(--landing-muted);
			font-size: 0.96rem;
			line-height: 1.7;
		}

		.landing-steps {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 18px;
			padding-top: 8px;
		}

		.landing-step {
			min-height: 225px;
			padding: 18px 14px 12px 0;
			border-top: 1px solid var(--landing-line-strong);
		}

		.landing-step-top {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-bottom: 36px;
			color: var(--landing-faint);
			font-size: 0.6rem;
			font-weight: 700;
			letter-spacing: 0.15em;
		}

		.step-glyph {
			color: var(--landing-accent);
			font-size: 1.1rem;
		}

		.landing-step h3,
		.landing-feature-card h3 {
			margin-bottom: 10px;
			color: var(--landing-ink);
			font-size: 1.04rem;
			font-weight: 600;
			letter-spacing: -0.025em;
		}

		.landing-step p,
		.landing-feature-card p {
			color: var(--landing-muted);
			font-size: 0.83rem;
			line-height: 1.68;
		}

		.landing-feature-band {
			padding: 78px clamp(24px, 5vw, 64px) 84px;
			border-top: 1px solid var(--landing-line);
			border-bottom: 1px solid var(--landing-line);
			background: var(--landing-panel-2);
		}

		.landing-feature-heading,
		.landing-feature-grid {
			max-width: 1112px;
			margin-right: auto;
			margin-left: auto;
		}

		.landing-feature-heading {
			margin-bottom: 44px;
		}

		.landing-feature-heading h2 {
			font-size: clamp(2.25rem, 3.7vw, 3.55rem);
		}

		.landing-feature-grid {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 14px;
		}

		.landing-feature-card {
			position: relative;
			min-height: 210px;
			padding: 23px 22px;
			border: 1px solid var(--landing-panel-line);
			border-radius: 9px;
			background: linear-gradient(145deg, var(--landing-panel), var(--landing-panel-2));
			transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
		}

		.landing-feature-card:hover {
			transform: translateY(-3px);
			border-color: rgba(var(--landing-accent-rgb), 0.38);
			background: rgba(255, 255, 255, 0.055);
		}

		.feature-index {
			display: block;
			margin-bottom: 28px;
			color: var(--landing-accent);
			font-size: 0.7rem;
			font-weight: 700;
			letter-spacing: 0.17em;
		}

		.landing-feature-card h3 {
			padding-right: 18px;
			font-size: 1rem;
		}

		.feature-arrow {
			position: absolute;
			top: 20px;
			right: 20px;
			color: var(--landing-faint);
			font-size: 1rem;
		}

		.landing-cta {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 32px;
			max-width: 1112px;
			margin: 0 auto;
			padding: 96px 24px 100px;
		}

		.landing-cta h2 {
			font-size: clamp(2.5rem, 4.5vw, 4.4rem);
		}

		.landing-cta-button {
			flex: 0 0 auto;
			min-width: 190px;
		}

		.landing-footer {
			position: relative;
			z-index: 1;
			max-width: 1440px;
			margin: 0 auto;
			padding: 27px clamp(24px, 7vw, 100px) 17px;
			border-top: 1px solid var(--landing-line);
			background: var(--landing-footer-bg);
		}

		.landing-footer-brand {
			display: flex;
			align-items: center;
			gap: 12px;
		}

		.landing-footer-brand > div > * {
			display: block;
		}

		.landing-footer-brand b {
			color: var(--landing-ink);
			font-size: 0.69rem;
			letter-spacing: 0.18em;
		}

		.landing-footer-brand > div > span {
			margin-top: 4px;
			color: var(--landing-muted);
			font-size: 0.72rem;
		}

		.landing-footer-menu {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 13px;
			margin: 22px 0 20px;
			color: var(--landing-muted);
			font-size: 0.82rem;
		}

		.landing-footer-menu a {
			color: var(--landing-accent);
			font-weight: 700;
		}

		.landing-footer-menu a span {
			margin-left: 3px;
		}

		.landing-footer-bottom {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 16px;
			padding-top: 14px;
			border-top: 1px solid var(--landing-line);
			color: var(--landing-faint);
			font-size: 0.68rem;
		}

		/*
		 * The landing page follows the SAME skins as the studio
		 * (client/styles.ts THEMES block). The theme's own body
		 * backdrop (Aerial sky / Stellar gradient) shows through
		 * by making the landing surface transparent, and every
		 * landing token is re-declared from the theme tokens so
		 * panels, rules, accents and type match the studio
		 * exactly instead of using a second, hand-mixed palette.
		 */

		html[data-theme] .landing-page {
			background-color: transparent;
			background-image: none;
			--landing-ink: var(--t-ink);
			--landing-muted: var(--t-muted);
			--landing-faint: var(--t-muted-out);
			--landing-accent: var(--t-heading);
			--landing-accent-rgb: 255, 255, 255;
			--landing-accent-hover: var(--t-btn-bg-hover);
			--landing-on-accent: var(--t-on-accent);
			--landing-line: var(--t-line);
			--landing-line-strong: var(--t-line-2);
			--landing-panel: var(--t-panel);
			--landing-panel-2: var(--t-panel-2);
			--landing-panel-line: var(--t-line);
			--landing-nav-bg: rgba(12, 30, 44, 0.16);
			--landing-footer-bg: rgba(12, 30, 44, 0.2);
		}

		/* The backdrop itself is the studio theme's body skin. */
		html[data-theme] .landing-page::before {
			display: none;
		}

		html[data-theme="strata"] .landing-page {
			--landing-nav-bg: rgba(12, 46, 66, 0.32);
			--landing-footer-bg: rgba(12, 46, 66, 0.4);
		}

		html[data-theme="stellar"] .landing-page {
			--landing-nav-bg: rgba(40, 28, 66, 0.32);
			--landing-footer-bg: rgba(40, 28, 66, 0.4);
		}

		html[data-theme] .landing-nav {
			border-bottom-color: var(--t-line);
		}

		html[data-theme] .landing-brand-mark {
			border-color: var(--t-line-2);
			background: var(--t-btn2-bg);
			color: var(--landing-accent);
		}

		html[data-theme] .landing-signup {
			border-color: var(--t-btn-line);
			background: var(--t-btn2-bg);
			color: var(--t-ink) !important;
		}

		html[data-theme] .landing-signup:hover {
			border-color: var(--t-btn-bg-hover);
			background: var(--t-btn2-bg-hover);
		}

		html[data-theme] .landing-primary {
			border-color: var(--t-btn-line);
			background: var(--t-btn-bg);
			color: var(--t-btn-ink);
		}

		html[data-theme] .landing-primary:hover {
			background: var(--t-btn-bg-hover);
			color: var(--t-btn-ink-hover);
		}

		html[data-theme] .landing-secondary {
			color: var(--t-ink-out) !important;
		}

		html[data-theme] .landing-secondary-play {
			border-color: var(--t-line-2);
		}

		/*
		 * The preview illustration is a dark video-editor mock in
		 * every skin. On translucent skins it becomes a frosted
		 * panel so it reads as part of the theme instead of a
		 * black hole in the middle of the hero.
		 */
		html[data-theme] .landing-preview-card {
			border-color: var(--t-line);
			background: var(--t-panel);
			box-shadow: 0 30px 90px rgba(0, 0, 0, 0.25), 0 0 55px rgba(0, 0, 0, 0.08);
			-webkit-backdrop-filter: blur(8px);
			backdrop-filter: blur(8px);
		}

		html[data-theme] .landing-preview-topbar,
		html[data-theme] .preview-control-row,
		html[data-theme] .preview-timeline {
			border-color: var(--t-line);
		}

		html[data-theme] .preview-project-name,
		html[data-theme] .preview-ready,
		html[data-theme] .preview-time,
		html[data-theme] .preview-timeline-label,
		html[data-theme] .preview-export,
		html[data-theme] .preview-wave i {
			color: var(--t-muted);
		}

		html[data-theme] .preview-float {
			border-color: var(--t-line);
			background: var(--t-panel);
			color: var(--t-ink);
			-webkit-backdrop-filter: blur(8px);
			backdrop-filter: blur(8px);
		}

		html[data-theme] .preview-timeline-clips span {
			border-color: var(--t-line);
		}

		html[data-theme] .landing-feature-card:hover {
			border-color: var(--t-line-2);
			background: var(--t-panel-3);
		}

		html[data-theme] .landing-plan-card {
			border-color: var(--t-line);
			background: var(--t-panel);
			-webkit-backdrop-filter: blur(8px);
			backdrop-filter: blur(8px);
		}

		html[data-theme] .landing-plan-card.landing-plan-featured {
			border-color: var(--t-line-2);
			background: var(--t-panel-3);
		}

		html[data-theme] .landing-plan-check {
			border-color: var(--t-line-2);
			background: var(--t-btn2-bg);
			color: var(--t-ink);
		}

		html[data-theme] .landing-page h2 {
			padding: 0;
			border: 0;
			color: var(--landing-ink);
			font-weight: 600;
		}

		.landing-page a:focus-visible,
		.landing-page button:focus-visible,
		.auth-close:focus-visible,
		.auth-switch:focus-visible,
		.auth-submit:focus-visible {
			outline: 2px solid var(--landing-accent, #f59e0b);
			outline-offset: 4px;
		}

		@media (max-width: 1020px) {
			.landing-hero {
				grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
				gap: 34px;
				padding-top: 75px;
				padding-bottom: 82px;
			}

			.landing-hero h1 {
				font-size: clamp(3.15rem, 6.5vw, 5.4rem);
			}

			.landing-hero-art {
				min-height: 390px;
			}

			.landing-process {
				grid-template-columns: 1fr;
				gap: 44px;
			}

			.landing-section-heading > p:last-child {
				max-width: 470px;
			}
		}

		@media (max-width: 780px) {
			.landing-nav {
				height: 72px;
			}

			.landing-hero {
				grid-template-columns: 1fr;
				gap: 40px;
				padding-top: 72px;
				padding-bottom: 66px;
			}

			.landing-hero-copy {
				max-width: 650px;
			}

			.landing-hero h1 {
				font-size: clamp(3.4rem, 9vw, 5.5rem);
			}

			.landing-lead {
				max-width: 560px;
			}

			.landing-hero-art {
				width: min(100%, 620px);
				min-height: 0;
				margin: 0 auto;
				padding: 24px 10px;
			}

			.landing-proof {
				grid-template-columns: 1fr;
				gap: 20px;
				max-width: none;
				padding-top: 25px;
				padding-bottom: 25px;
			}

			.landing-proof-item {
				max-width: 450px;
			}

			.landing-steps,
			.landing-feature-grid {
				grid-template-columns: 1fr;
			}

			.landing-step {
				min-height: 0;
				padding-bottom: 20px;
			}

			.landing-step-top {
				margin-bottom: 21px;
			}

			.landing-feature-card {
				min-height: 0;
			}

			.feature-index {
				margin-bottom: 18px;
			}
		}

		@media (max-width: 560px) {
			.landing-page {
				width: calc(100% + 40px);
				margin-right: -20px;
				margin-left: -20px;
			}

			.landing-nav {
				gap: 10px;
				height: 68px;
				padding-right: 18px;
				padding-left: 18px;
			}

			.landing-brand {
				gap: 8px;
			}

			.landing-brand-mark {
				width: 32px;
				height: 32px;
				border-radius: 9px;
			}

			.landing-brand-name {
				font-size: 0.66rem;
				letter-spacing: 0.15em;
			}

			.landing-nav-links {
				display: none;
			}

			.landing-signup {
				min-height: 38px;
				gap: 8px;
				padding: 0 12px;
				font-size: 0.79rem;
			}

			.landing-hero {
				gap: 28px;
				padding: 62px 22px 54px;
			}

			.landing-eyebrow {
				gap: 8px;
				margin-bottom: 18px;
				font-size: 0.59rem;
				letter-spacing: 0.15em;
			}

			.landing-hero h1 {
				font-size: clamp(3rem, 13vw, 4.35rem);
				letter-spacing: -0.073em;
			}

			.landing-lead {
				margin-top: 20px;
				font-size: 0.97rem;
			}

			.landing-actions {
				align-items: flex-start;
				gap: 17px;
				margin-top: 25px;
			}

			.landing-primary {
				min-height: 48px;
				gap: 15px;
				padding: 0 16px;
				font-size: 0.86rem;
			}

			.landing-secondary {
				font-size: 0.81rem;
			}

			.landing-microcopy {
				flex-wrap: wrap;
				gap: 8px;
				margin-top: 21px;
				font-size: 0.69rem;
			}

			.landing-hero-art {
				padding: 19px 0;
			}

			.landing-preview-card {
				padding: 9px;
				border-radius: 11px;
			}

			.preview-float {
				gap: 6px;
				padding: 8px 10px;
				font-size: 0.65rem;
			}

			.preview-float-top {
				left: -6px;
			}

			.preview-float-bottom {
				right: -5px;
			}

			.preview-scene-caption {
				font-size: clamp(0.68rem, 3vw, 0.9rem);
				letter-spacing: 0.12em;
			}

			.preview-scene-play {
				width: 38px;
				height: 38px;
			}

			.landing-section {
				padding: 77px 22px;
			}

			.landing-section-heading h2,
			.landing-feature-heading h2,
			.landing-cta h2 {
				font-size: clamp(2.35rem, 10vw, 3.3rem);
			}

			.landing-process {
				gap: 34px;
			}

			.landing-feature-band {
				padding: 63px 22px 67px;
			}

			.landing-feature-heading {
				margin-bottom: 30px;
			}

			.landing-cta {
				align-items: flex-start;
				flex-direction: column;
				padding: 72px 22px 76px;
			}

			.landing-cta-button {
				width: 100%;
			}

			.landing-footer {
				padding: 24px 22px 15px;
			}

			.landing-footer-bottom {
				align-items: flex-start;
				flex-direction: column;
				gap: 6px;
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.landing-page *,
			.landing-page *::before,
			.landing-page *::after {
				transition-duration: 0.01ms !important;
				scroll-behavior: auto !important;
			}
		}

		/* Auth dialog is opened only from a landing-page account action. */
		.auth-box {
			position: relative;
			max-height: calc(100vh - 32px);
			overflow-y: auto;
		}

		.auth-plan-note {
			margin: 0 0 14px;
			padding: 9px 11px;
			border: 1px solid rgba(245, 158, 11, 0.28);
			border-radius: 8px;
			background: rgba(245, 158, 11, 0.07);
			color: #d1d5db;
			font-size: 0.72rem;
			line-height: 1.55;
		}

		html[data-theme] .auth-plan-note {
			border-color: var(--t-line);
			background: var(--t-btn2-bg);
			color: var(--t-muted);
		}

		/* "No account? Open the free studio" (freemium entry, /free) */
		.auth-guest-note {
			margin: -6px 0 14px;
			color: #9ca3af;
			font-size: 0.76rem;
			line-height: 1.5;
		}

		.auth-guest-note a {
			color: #fbbf24;
			font-weight: 600;
			text-decoration: underline;
		}

		html[data-theme] .auth-guest-note {
			color: var(--t-muted);
		}

		html[data-theme] .auth-guest-note a {
			color: var(--t-ink);
		}

		.auth-close {
			position: absolute;
			top: 11px;
			right: 12px;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 31px;
			height: 31px;
			border: 1px solid #3b404b;
			border-radius: 50%;
			background: transparent;
			color: #b7bac2;
			font-size: 1.25rem;
			line-height: 1;
			cursor: pointer;
		}

		.auth-close:hover {
			border-color: #f59e0b;
			color: #ffffff;
		}

		html[data-theme] .auth-close {
			border-color: var(--t-line);
			background: var(--t-btn2-bg);
			color: var(--t-ink);
		}

		html[data-theme="strata"] .auth-close:hover,
		html[data-theme="stellar"] .auth-close:hover {
			border-color: var(--t-line-2);
			background: var(--t-btn2-bg-hover);
		}


		/* =====================================================
		 * TEMPLATE COMPOSER — Interactive gallery and element editor
		 * (tm-* classes). Animated graphics live in the Graphics
		 * dropdown; the 3D Ring has its own image-upload accordion. #tpl-modal
		 * inherits the active studio theme through --t-* tokens.
		 * ===================================================== */

		#tpl-modal .tm-view {
			margin-bottom: 4px;
		}

		#tpl-modal .tm-gallery-grid {
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			gap: 12px;
			margin: 4px 0 14px;
		}

		#tpl-modal .tm-gcard {
			display: block;
			padding: 8px;
			background: #141418;
			border: 2px solid #2e3440;
			border-radius: 12px;
			cursor: pointer;
			color: #fff;
			text-align: left;
			transition: border-color 0.15s ease, transform 0.15s ease;
		}

		#tpl-modal .tm-gcard:hover {
			border-color: #f59e0b;
			transform: translateY(-2px);
		}

		#tpl-modal .tm-gframe {
			display: block;
			aspect-ratio: 9 / 16;
			border-radius: 8px;
			overflow: hidden;
			background: #000;
		}

		#tpl-modal .tm-gcanvas {
			display: block;
			width: 100%;
			height: 100%;
		}

		#tpl-modal .tm-gname {
			display: block;
			margin-top: 8px;
			font-size: 0.82rem;
			font-weight: 700;
			color: #fff;
		}

		#tpl-modal .tm-gtag {
			display: block;
			margin-top: 2px;
			font-size: 0.7rem;
			color: #9ca3af;
			text-transform: uppercase;
			letter-spacing: 0.08em;
		}

		#tpl-modal .tm-editorbar {
			display: flex;
			flex-wrap: wrap;
			gap: 9px;
			align-items: center;
			background: #1b1b20;
			border-radius: 12px;
			padding: 10px 12px;
			margin-bottom: 12px;
		}

		#tpl-modal .tm-back,
		#tpl-modal .tm-tool,
		#tpl-modal .tm-tl-apply,
		#tpl-modal .tm-tl-add,
		#tpl-modal .tm-photo-x {
			border: 0;
			border-radius: 10px;
			padding: 9px 12px;
			cursor: pointer;
			background: #303037;
			color: #fff;
			font-weight: 700;
			font-size: 0.82rem;
		}

		#tpl-modal .tm-back:hover,
		#tpl-modal .tm-tool:hover,
		#tpl-modal .tm-photo-x:hover {
			background: #3a3a42;
		}

		#tpl-modal .tm-tpl-name {
			font-weight: 700;
			color: #fff;
			margin-right: auto;
			font-size: 0.95rem;
		}

		#tpl-modal .tm-main {
			display: grid;
			grid-template-columns: minmax(220px, 40%) 1fr;
			gap: 14px;
			align-items: start;
		}

		#tpl-modal .tm-stage {
			width: 100%;
			background: #000;
			border-radius: 16px;
			overflow: hidden;
			box-shadow: 0 18px 55px rgba(0, 0, 0, 0.6);
		}

		#tpl-modal .tm-stage #tpl-canvas {
			width: 100%;
			height: auto;
			min-height: 0;
			max-height: none;
			display: block;
			background: #111;
		}

		#tpl-modal .tm-side {
			display: flex;
			flex-direction: column;
			gap: 12px;
			min-width: 0;
		}

		#tpl-modal .tm-block {
			margin-bottom: 0;
		}

		#tpl-modal .tm-sec-title {
			font-size: 0.72rem;
			font-weight: 800;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			color: #e5e7eb;
			margin: 2px 0 8px;
		}

		#tpl-modal .tm-grid3 {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: 8px;
			margin-top: 6px;
		}

		#tpl-modal .tm-grid3 .tpl-field,
		#tpl-modal .tm-tl-body .tpl-field {
			display: flex;
			flex-direction: column;
			gap: 5px;
			min-width: 0;
			width: 100%;
		}

		#tpl-modal .tm-grid3 input,
		#tpl-modal .tm-grid3 select,
		#tpl-modal .tm-tl-body input,
		#tpl-modal .tm-tl-body select {
			height: 38px;
			border: 1px solid #3b3b42;
			border-radius: 8px;
			background: #29292e;
			color: #fff;
			padding: 0 9px;
			outline: none;
			width: 100%;
			min-width: 0;
		}

		#tpl-modal .tm-grid3 input[type="range"],
		#tpl-modal .tm-tl-body input[type="range"] {
			height: 22px;
			padding: 0;
			background: transparent;
			border: 0;
			accent-color: #f59e0b;
			cursor: pointer;
		}

		#tpl-modal .tm-grid3 .tpl-field span,
		#tpl-modal .tm-tl-body .tpl-field span,
		#tpl-modal .tm-tl-body .tpl-range span {
			font-size: 12px;
			color: #9ca3af;
		}

		#tpl-modal .tm-photos {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-bottom: 8px;
		}

		#tpl-modal .tm-photo {
			position: relative;
			display: inline-block;
			width: 74px;
			height: 74px;
			border-radius: 8px;
			overflow: hidden;
			border: 1px solid #3b3b42;
		}

		#tpl-modal .tm-photo img {
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: block;
		}

		#tpl-modal .tm-photo-x {
			position: absolute;
			top: 3px;
			right: 3px;
			padding: 0;
			width: 20px;
			height: 20px;
			border-radius: 50%;
			background: rgba(20, 20, 24, 0.85);
			font-size: 12px;
			line-height: 1;
		}

		#tpl-modal .tm-tl-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
		}

		#tpl-modal .tm-tl-add {
			width: 28px;
			height: 28px;
			padding: 0;
			border-radius: 8px;
			font-size: 1.15rem;
			line-height: 1;
			background: #f59e0b;
			color: #111;
		}

		#tpl-modal .tm-tl-add:hover {
			background: #ffd83d;
		}

		#tpl-modal .tm-tl {
			border: 1px solid #2e3440;
			border-radius: 10px;
			margin-top: 8px;
			background: #141418;
			overflow: hidden;
		}

		#tpl-modal .tm-tl-toggle {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 10px;
			background: #1b1b20;
			cursor: pointer;
			user-select: none;
		}

		#tpl-modal .tm-tl-toggle:hover {
			background: #22222a;
		}

		#tpl-modal .tm-tl-caret {
			display: inline-block;
			transition: transform 0.18s ease;
			font-size: 10px;
			width: 10px;
			flex: 0 0 auto;
			color: #9ca3af;
		}

		#tpl-modal .tm-tl.open .tm-tl-caret {
			transform: rotate(90deg);
		}

		#tpl-modal .tm-tl-title {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: 0.82rem;
			font-weight: 700;
			color: #fff;
		}

		#tpl-modal .tm-tl-del {
			flex: 0 0 auto;
			width: 22px;
			height: 22px;
			padding: 0;
			border: 0;
			border-radius: 6px;
			cursor: pointer;
			background: #7f1d1d;
			color: #fff;
			font-size: 14px;
			line-height: 1;
		}

		#tpl-modal .tm-tl-del:hover {
			background: #991b1b;
		}

		#tpl-modal .tm-tl-del:disabled {
			opacity: 0.35;
			cursor: not-allowed;
		}

		#tpl-modal .tm-tl-body {
			display: none;
			padding: 10px;
			border-top: 1px solid #2e3440;
		}

		#tpl-modal .tm-tl.open .tm-tl-body {
			display: block;
		}

		#tpl-modal .tm-tl-apply {
			background: #f59e0b;
			color: #111;
			align-self: flex-end;
			height: 38px;
		}

		#tpl-modal .tm-tl-apply:hover {
			background: #ffd83d;
		}

		#tpl-modal .tm-statusline {
			margin: 12px 0 0;
			display: flex;
		}

		#tpl-modal .tm-statusline .tpl-status {
			margin-left: 0;
			width: 100%;
		}

		@media (max-width: 900px) {
			#tpl-modal .tm-main {
				grid-template-columns: 1fr;
			}
		}

		@media (max-width: 860px) {
			#tpl-modal .tm-gallery-grid {
				grid-template-columns: repeat(2, 1fr);
			}
		}

		@media (max-width: 520px) {
			#tpl-modal .tm-gallery-grid {
				grid-template-columns: repeat(2, 1fr);
				gap: 8px;
			}

			#tpl-modal .tm-tpl-name {
				width: 100%;
				margin-right: 0;
			}
		}

		html[data-theme] #tpl-modal .tm-gcard,
		html[data-theme] #tpl-modal .tm-editorbar,
		html[data-theme] #tpl-modal .tm-tl,
		html[data-theme] #tpl-modal .tm-tl-toggle {
			background: var(--t-panel-2);
			border-color: var(--t-line);
			color: var(--t-ink);
		}

		html[data-theme] #tpl-modal .tm-gcard:hover {
			border-color: var(--accent);
		}

		html[data-theme] #tpl-modal .tm-gname,
		html[data-theme] #tpl-modal .tm-tpl-name,
		html[data-theme] #tpl-modal .tm-sec-title,
		html[data-theme] #tpl-modal .tm-tl-title {
			color: var(--t-heading);
		}

		html[data-theme] #tpl-modal .tm-gtag,
		html[data-theme] #tpl-modal .tm-tl-caret,
		html[data-theme] #tpl-modal .tm-grid3 .tpl-field span,
		html[data-theme] #tpl-modal .tm-tl-body .tpl-field span,
		html[data-theme] #tpl-modal .tm-tl-body .tpl-range span {
			color: var(--t-muted);
		}

		html[data-theme] #tpl-modal .tm-back,
		html[data-theme] #tpl-modal .tm-tool,
		html[data-theme] #tpl-modal .tm-photo-x {
			background: var(--t-btn2-bg);
			color: var(--t-btn2-ink);
			border: 1px solid var(--t-btn2-line);
		}

		html[data-theme] #tpl-modal .tm-back:hover,
		html[data-theme] #tpl-modal .tm-tool:hover {
			background: var(--t-btn2-bg-hover);
			color: var(--t-btn2-ink);
		}

		html[data-theme] #tpl-modal .tm-tl-add,
		html[data-theme] #tpl-modal .tm-tl-apply {
			background: var(--t-btn-bg-hover);
			color: var(--t-btn-ink-hover);
			border: 1px solid var(--t-btn-line);
		}

		html[data-theme] #tpl-modal .tm-grid3 input,
		html[data-theme] #tpl-modal .tm-grid3 select,
		html[data-theme] #tpl-modal .tm-tl-body input,
		html[data-theme] #tpl-modal .tm-tl-body select {
			background: var(--t-input);
			color: var(--t-ink);
			border: 1px solid var(--t-line-2);
		}

		html[data-theme] #tpl-modal .tm-grid3 input[type="range"],
		html[data-theme] #tpl-modal .tm-tl-body input[type="range"] {
			background: transparent;
			border: 0;
		}

		html[data-theme] #tpl-modal .tm-stage {
			background: #0b0d11;
			box-shadow: none;
			border: 1px solid var(--t-line);
		}

		html[data-theme] #tpl-modal .tm-tl-body {
			border-top-color: var(--t-line);
		}

		html[data-theme] #tpl-modal .tm-photo {
			border-color: var(--t-line);
		}

		/* =====================================================
		 * LANDING — daily credits / plans
		 * ===================================================== */

		.landing-plans {
			padding: 84px clamp(24px, 5vw, 64px) 90px;
			border-top: 1px solid var(--landing-line);
		}

		.landing-plans-heading {
			max-width: 1112px;
			margin: 0 auto 44px;
		}

		.landing-plans-heading h2 {
			max-width: 760px;
		}

		.landing-plans-heading > p:last-child {
			max-width: 620px;
			margin-top: 18px;
			color: var(--landing-muted);
			font-size: 0.95rem;
			line-height: 1.7;
		}

		.landing-plan-grid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 16px;
			max-width: 1112px;
			margin: 0 auto;
		}

		.landing-plan-card {
			position: relative;
			display: flex;
			flex-direction: column;
			gap: 16px;
			padding: 28px 26px 26px;
			border: 1px solid var(--landing-panel-line);
			border-radius: 12px;
			background: linear-gradient(145deg, var(--landing-panel), var(--landing-panel-2));
		}

		.landing-plan-card.landing-plan-featured {
			border-color: rgba(var(--landing-accent-rgb), 0.45);
			background: linear-gradient(145deg, rgba(var(--landing-accent-rgb), 0.09), var(--landing-panel-2));
		}

		.landing-plan-top {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 14px;
		}

		.landing-plan-badge {
			display: inline-flex;
			align-items: center;
			min-height: 26px;
			padding: 0 10px;
			border: 1px solid rgba(var(--landing-accent-rgb), 0.4);
			border-radius: 5px;
			color: var(--landing-accent);
			font-size: 0.62rem;
			font-weight: 700;
			letter-spacing: 0.16em;
		}

		.landing-plan-price {
			color: var(--landing-ink);
			font-size: 1.35rem;
			font-weight: 700;
			letter-spacing: -0.03em;
		}

		.landing-plan-price span {
			margin-left: 3px;
			color: var(--landing-faint);
			font-size: 0.66rem;
			font-weight: 400;
			letter-spacing: 0.02em;
		}

		.landing-plan-card h3 {
			color: var(--landing-ink);
			font-size: 1.3rem;
			font-weight: 600;
			letter-spacing: -0.03em;
		}

		.landing-plan-card > p {
			color: var(--landing-muted);
			font-size: 0.85rem;
			line-height: 1.65;
		}

		.landing-plan-list {
			display: grid;
			gap: 10px;
			margin: 2px 0 6px;
			padding: 0;
			list-style: none;
		}

		.landing-plan-list li {
			display: flex;
			align-items: center;
			gap: 10px;
			color: var(--landing-muted);
			font-size: 0.85rem;
		}

		.landing-plan-list b {
			color: var(--landing-ink);
			font-weight: 700;
		}

		.landing-plan-check {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			flex: 0 0 auto;
			width: 18px;
			height: 18px;
			border: 1px solid rgba(var(--landing-accent-rgb), 0.45);
			border-radius: 50%;
			background: rgba(var(--landing-accent-rgb), 0.08);
			color: var(--landing-accent);
			font-size: 0.58rem;
		}

		.landing-plan-card .landing-primary {
			margin-top: auto;
			width: 100%;
		}

		.landing-plan-note {
			color: var(--landing-faint);
			font-size: 0.72rem;
			line-height: 1.55;
			text-align: center;
		}

		.landing-plans-reset {
			max-width: 1112px;
			margin: 22px auto 0;
			color: var(--landing-faint);
			font-size: 0.75rem;
		}

		/* Freemium entry line under the plans */
		.landing-plans-guest {
			max-width: 1112px;
			margin: 8px auto 0;
			color: var(--landing-faint);
			font-size: 0.75rem;
		}

		.landing-plans-guest a {
			color: var(--landing-ink);
			font-weight: 600;
			text-decoration: underline;
			text-underline-offset: 3px;
		}

		.landing-plans-guest a:hover {
			color: var(--landing-accent);
		}

		@media (max-width: 780px) {
			.landing-plan-grid {
				grid-template-columns: 1fr;
			}
		}

		@media (max-width: 560px) {
			.landing-plans {
				padding: 68px 22px 74px;
			}
		}

		/* =====================================================
		 * DAILY CREDITS — studio pill + popover
		 * ===================================================== */

		.credit-pill {
			position: fixed;
			top: 16px;
			right: 16px;
			z-index: 70;
			display: flex;
			flex-direction: column;
			align-items: flex-end;
			gap: 8px;
			font-family: "Source Sans Pro", system-ui, sans-serif;
		}

		.credit-pill[hidden] {
			display: none !important;
		}

		.credit-pill-btn {
			display: inline-flex;
			align-items: center;
			gap: 9px;
			min-height: 38px;
			padding: 0 13px;
			border: 1px solid rgba(245, 158, 11, 0.38);
			border-radius: 999px;
			background: rgba(15, 17, 21, 0.82);
			color: #f3f4f6;
			font: inherit;
			font-size: 0.78rem;
			cursor: pointer;
			-webkit-backdrop-filter: blur(10px);
			backdrop-filter: blur(10px);
			transition: border-color 160ms ease, background 160ms ease;
		}

		.credit-pill-btn:hover {
			border-color: var(--accent);
			background: rgba(24, 27, 32, 0.92);
		}

		.credit-pill-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: var(--accent);
			box-shadow: 0 0 10px rgba(245, 158, 11, 0.65);
		}

		.credit-pill-plan {
			color: #fbbf24;
			font-size: 0.64rem;
			font-weight: 700;
			letter-spacing: 0.12em;
			text-transform: uppercase;
		}

		.credit-pill-sep {
			width: 1px;
			height: 14px;
			background: rgba(255, 255, 255, 0.18);
		}

		.credit-pill-images {
			color: #d1d5db;
		}

		.credit-pill-caret {
			color: #9ca3af;
			font-size: 0.7rem;
		}

		.credit-popover {
			width: 268px;
			padding: 14px;
			border: 1px solid #2e3440;
			border-radius: 12px;
			background: #14161c;
			box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
			color: #f3f4f6;
		}

		.credit-popover[hidden] {
			display: none !important;
		}

		.credit-popover-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding-bottom: 10px;
			border-bottom: 1px solid #2e3440;
			font-size: 0.82rem;
			font-weight: 700;
		}

		.credit-plan-tag {
			padding: 3px 8px;
			border: 1px solid rgba(245, 158, 11, 0.45);
			border-radius: 999px;
			color: #fbbf24;
			font-size: 0.6rem;
			font-weight: 700;
			letter-spacing: 0.12em;
			text-transform: uppercase;
		}

		.credit-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 7px 0;
			color: #9ca3af;
			font-size: 0.78rem;
		}

		.credit-row b {
			color: #f3f4f6;
			font-weight: 600;
			text-align: right;
		}

		.credit-used,
		.credit-reset {
			margin-top: 8px;
			padding-top: 9px;
			border-top: 1px solid #262b33;
			color: #6b7280;
			font-size: 0.68rem;
			line-height: 1.5;
		}

		/* Guest popover CTA: free studio -> free account */
		.credit-signup {
			width: 100%;
			margin-top: 10px;
			padding: 9px 10px;
			border: 1px solid rgba(245, 158, 11, 0.45);
			border-radius: 8px;
			background: rgba(245, 158, 11, 0.12);
			color: #fbbf24;
			font: inherit;
			font-size: 0.72rem;
			font-weight: 700;
			cursor: pointer;
		}

		.credit-signup:hover {
			background: rgba(245, 158, 11, 0.2);
		}

		html[data-theme] .credit-signup {
			border-color: var(--t-line-2);
			background: var(--t-btn2-bg);
			color: var(--t-ink);
		}

		html[data-theme] .credit-signup:hover {
			background: var(--t-btn2-bg-hover);
		}

		#auth-account-credits {
			color: #fbbf24;
		}

		html[data-theme] .credit-pill-btn {
			border-color: var(--t-line-2);
			background: var(--t-panel);
			color: var(--t-ink);
		}

		html[data-theme] .credit-pill-btn:hover {
			border-color: var(--t-btn-line);
			background: var(--t-panel-3);
		}

		html[data-theme] .credit-pill-plan {
			color: var(--t-ink);
		}

		html[data-theme] .credit-pill-images {
			color: var(--t-ink-out);
		}

		html[data-theme] .credit-pill-dot {
			background: var(--accent);
			box-shadow: none;
		}

		html[data-theme] .credit-pill-sep {
			background: var(--t-line);
		}

		html[data-theme] .credit-pill-caret {
			color: var(--t-muted);
		}

		html[data-theme] .credit-popover {
			border-color: var(--t-line);
			background: var(--t-backdrop);
			color: var(--t-ink);
			box-shadow: var(--t-shadow);
		}

		html[data-theme] .credit-popover-head,
		html[data-theme] .credit-used,
		html[data-theme] .credit-reset {
			border-color: var(--t-line);
			color: var(--t-muted);
		}

		html[data-theme] .credit-row {
			color: var(--t-muted);
		}

		html[data-theme] .credit-row b {
			color: var(--t-ink);
		}

		html[data-theme] .credit-plan-tag {
			border-color: var(--t-line-2);
			color: var(--t-ink);
		}

		html[data-theme] #auth-account-credits {
			color: var(--t-ink);
		}

		/* =====================================================
		 * STUDIO SHELL (Bug Fix Session #240)
		 *
		 * Layout adopted from the uploaded "video_bulk_production"
		 * reference: a sticky top bar, a page heading, and two
		 * views — a Bulk grid table and an Editor split into
		 * "Build your video" (the existing accordions) and a
		 * Preview monitor (the existing canvas).
		 *
		 * Tokens fall back to the built-in palette, so the
		 * default skin needs no data-theme attribute and the six
		 * themed skins inherit through --t-*.
		 *
		 * The reference's timeline, rail, metrics and preview
		 * widgets have no function in this app: no markup is
		 * emitted for them (see the guard at the end of this
		 * block for stray fragments).
		 * ===================================================== */

		#studio-app {
			min-height: 100vh;
			color: var(--t-ink, var(--text));
		}

		#studio-app[hidden] {
			display: none !important;
		}

		#studio-app .app-top {
			position: sticky;
			top: 0;
			z-index: 60;
			display: flex;
			align-items: center;
			gap: 12px;
			padding: 10px 18px;
			background: var(--t-panel, var(--card));
			border-bottom: 1px solid var(--t-line, #2e3440);
			-webkit-backdrop-filter: blur(16px);
			backdrop-filter: blur(16px);
		}

		#studio-app .app-brand {
			display: flex;
			align-items: center;
			gap: 9px;
			font-weight: 800;
			letter-spacing: -0.02em;
		}

		#studio-app .app-mark {
			display: grid;
			place-items: center;
			width: 31px;
			height: 31px;
			border-radius: 10px;
			background: var(--accent);
			color: var(--t-on-accent, #10140d);
			font-family: 'Oswald', sans-serif;
			font-size: 1rem;
		}

		#studio-app .app-name {
			font-size: 0.95rem;
			text-transform: uppercase;
			letter-spacing: 0.02em;
		}

		#studio-app .app-name b {
			color: var(--accent);
		}

		#studio-app .grow {
			flex: 1;
		}

		#studio-app .view-switch {
			display: flex;
			gap: 3px;
			padding: 4px;
			background: var(--t-panel-2, #1b2130);
			border: 1px solid var(--t-line, #2e3440);
			border-radius: 11px;
		}

		#studio-app .view-switch-btn {
			border: 0;
			background: transparent;
			color: var(--t-muted, #9ca3af);
			padding: 8px 11px;
			border-radius: 7px;
			font-size: 0.72rem;
			font-weight: 800;
			cursor: pointer;
		}

		#studio-app .view-switch-btn:hover,
		#studio-app .app-generate:hover,
		#studio-app .batch-open:hover {
			transform: none;
		}

		#studio-app .view-switch-btn:hover {
			color: var(--t-ink, var(--text));
		}

		#studio-app .view-switch-btn.active {
			background: var(--accent);
			color: var(--t-on-accent, #10140d);
		}

		#studio-app .app-generate {
			border: 1px solid var(--accent);
			background: var(--accent);
			color: var(--t-on-accent, #10140d);
			padding: 10px 13px;
			border-radius: 10px;
			font-weight: 800;
			font-size: 0.8rem;
			cursor: pointer;
		}

		#studio-app .app-generate:hover {
			filter: brightness(1.06);
		}

		#studio-app .app-main {
			display: flex;
			flex-direction: column;
			gap: 16px;
			max-width: 1180px;
			margin: 0 auto;
			padding: 22px 18px 40px;
		}

		/* ---- heading ---------------------------------------- */

		#studio-app .heading {
			display: flex;
			align-items: flex-end;
			gap: 15px;
			flex-wrap: wrap;
			text-align: left;
			margin: 0;
			padding: 0;
		}

		#studio-app .heading::after {
			display: none;
			content: none;
		}

		#studio-app .kicker {
			color: var(--accent);
			font-size: 0.62rem;
			font-weight: 900;
			letter-spacing: 0.16em;
			text-transform: uppercase;
			margin-bottom: 8px;
		}

		#studio-app .heading h1 {
			margin: 0;
			font-family: 'Oswald', sans-serif;
			font-size: clamp(1.6rem, 2.6vw, 2.2rem);
			line-height: 1.05;
			letter-spacing: -0.02em;
			color: var(--t-heading-out, var(--accent));
			border: 0;
			padding: 0;
			text-shadow: none;
		}

		#studio-app .heading p {
			margin: 8px 0 0;
			color: var(--t-muted-out, #9ca3af);
			font-size: 0.9rem;
			letter-spacing: 0;
			text-transform: none;
			line-height: 1.5;
		}

		#studio-app .heading-actions {
			margin-left: auto;
			display: flex;
			gap: 8px;
			flex-wrap: wrap;
		}

		#studio-app .heading-actions .bulk-toggle {
			position: static;
			width: auto;
			height: auto;
			border-radius: 10px;
			padding: 10px 14px;
			font-size: 0.82rem;
			font-weight: 800;
			background: transparent;
			color: var(--t-ink, var(--text));
			border: 1px solid var(--t-line, #2e3440);
		}

		#studio-app .heading-actions .bulk-toggle:hover {
			border-color: var(--accent);
			color: var(--accent);
		}

		/* ---- views + cards ---------------------------------- */

		#studio-app .view {
			display: none;
		}

		#studio-app .view.active {
			display: block;
		}

		#studio-app .studio-card {
			background: var(--t-panel, var(--card));
			border: 1px solid var(--t-line, #2e3440);
			border-radius: var(--t-radius, 12px);
			box-shadow: var(--t-shadow, none);
			overflow: hidden;
			color: var(--t-ink, var(--text));
		}

		#studio-app .card-head {
			display: flex;
			align-items: center;
			gap: 9px;
			padding: 13px 16px;
			border-bottom: 1px solid var(--t-line, #2e3440);
		}

		#studio-app .card-head strong {
			font-size: 0.8rem;
			letter-spacing: 0.02em;
		}

		#studio-app .card-note {
			margin-left: auto;
			color: var(--t-muted, #9ca3af);
			font-size: 0.7rem;
		}

		#studio-app .preview-dot {
			width: 7px;
			height: 7px;
			border-radius: 50%;
			background: var(--accent);
			box-shadow: 0 0 10px var(--accent);
			flex: 0 0 auto;
		}

		/* ---- bulk grid -------------------------------------- */

		#studio-app .table-scroll {
			overflow: auto;
		}

		#studio-app .batch-table {
			width: 100%;
			border-collapse: collapse;
			white-space: nowrap;
		}

		#studio-app .batch-table th {
			text-align: left;
			padding: 10px 12px;
			background: var(--t-panel-2, #14161a);
			color: var(--t-muted, #9ca3af);
			font-size: 0.62rem;
			font-weight: 800;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			border-bottom: 1px solid var(--t-line, #2e3440);
		}

		#studio-app .batch-table td {
			padding: 10px 12px;
			border-bottom: 1px solid var(--t-line, #2e3440);
			color: var(--t-ink, var(--text));
			font-size: 0.82rem;
			vertical-align: middle;
		}

		#studio-app .batch-table tbody tr:last-child td {
			border-bottom: 0;
		}

		#studio-app .batch-table tbody tr:hover {
			background: var(--t-panel-3, rgba(255, 255, 255, 0.03));
		}

		#studio-app .batch-index {
			color: var(--t-muted, #9ca3af);
			font-variant-numeric: tabular-nums;
		}

		#studio-app .batch-title {
			font-weight: 700;
		}

		#studio-app .batch-sub {
			color: var(--t-muted, #9ca3af);
			font-size: 0.7rem;
			margin-top: 3px;
		}

		#studio-app .batch-badge {
			display: inline-block;
			padding: 4px 9px;
			border-radius: 999px;
			border: 1px solid var(--t-line, #2e3440);
			background: var(--t-panel-2, #1b2130);
			font-size: 0.68rem;
			font-weight: 800;
			text-transform: lowercase;
		}

		#studio-app .batch-badge[data-state="rendering"],
		#studio-app .batch-badge[data-state="queued"] {
			border-color: #b45309;
			color: #b45309;
			background: rgba(180, 83, 9, 0.1);
		}

		#studio-app .batch-badge[data-state="done"] {
			border-color: #15803d;
			color: #15803d;
			background: rgba(21, 128, 61, 0.1);
		}

		#studio-app .batch-badge[data-state="error"],
		#studio-app .batch-badge[data-state="skipped"] {
			border-color: #b91c1c;
			color: #b91c1c;
			background: rgba(185, 28, 28, 0.1);
		}

		#studio-app .batch-open {
			border: 1px solid var(--t-line, #2e3440);
			background: transparent;
			color: var(--t-ink, var(--text));
			border-radius: 8px;
			padding: 6px 10px;
			font-size: 0.72rem;
			font-weight: 700;
			cursor: pointer;
		}

		#studio-app .batch-open:hover {
			border-color: var(--accent);
			color: var(--accent);
		}

		#studio-app .table-empty {
			padding: 22px 16px;
			color: var(--t-muted, #9ca3af);
			font-size: 0.82rem;
			text-align: center;
		}

		#studio-app .table-empty[hidden] {
			display: none;
		}

		/* ---- editor ----------------------------------------- */

		#studio-app .studio {
			display: grid;
			/* Every theme shares this one grid: the
			   preview monitor takes 35% of the row
			   and Build-your-video takes the wider
			   remaining 65%. */
			grid-template-columns: minmax(320px, 65fr) minmax(0, 35fr);
			gap: 14px;
			align-items: start;
			max-width: none;
			margin: 0;
			background: transparent;
			border: 0;
			border-radius: 0;
			padding: 0;
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
			box-shadow: none;
		}

		#studio-app .engine-panels {
			display: none;
		}

		#studio-app #video-accordions {
			max-width: none;
			margin: 0;
		}

		#studio-app .editor-build .video-accordion {
			background: transparent;
			border: 0;
			border-bottom: 1px solid var(--t-line, #2e3440);
			border-radius: 0;
			box-shadow: none;
			margin: 0;
			-webkit-backdrop-filter: none;
			backdrop-filter: none;
		}

		#studio-app .editor-build .video-accordion:last-child {
			border-bottom: 0;
		}

		#studio-app .editor-build .va-header {
			background: transparent;
			padding: 14px 15px;
		}

		#studio-app .editor-build .video-accordion:hover > .va-header {
			background: var(--t-panel-3, rgba(255, 255, 255, 0.03));
		}

		#studio-app .editor-build .va-body {
			padding: 0 15px 15px;
		}

		#studio-app .preview-card {
			position: sticky;
			top: 84px;
			display: flex;
			flex-direction: column;
		}

		#studio-app .preview-card .canvas-container {
			margin: 14px 14px 0;
			width: auto;
		}

		#studio-app .preview-card .progress-bar-container {
			margin: 12px 14px 0;
		}

		#studio-app .preview-card .status-text {
			margin: 10px 14px 0;
			font-size: 0.78rem;
			text-align: center;
		}

		#studio-app .preview-card .action-bar {
			margin: 12px 14px 14px;
			max-width: none;
			flex-wrap: wrap;
		}

		#studio-app #render-btn {
			background: var(--accent);
			color: var(--t-on-accent, #000000);
			border: 1px solid var(--accent);
			font-weight: 800;
			padding: 11px 16px;
			border-radius: 10px;
		}

		#studio-app #render-btn:hover {
			opacity: 0.92;
			transform: none;
		}

		#studio-app .preview-card .action-hint {
			font-size: 0.78rem;
		}

		/* ---- timeline guard --------------------------------- */

		/*
		 * The reference mockup ships a timeline dock. This app
		 * has no timeline engine, so no timeline markup is
		 * emitted; this guard keeps any future stray fragment
		 * from rendering a dead UI.
		 */

		#studio-app .timeline,
		#studio-app .timehead,
		#studio-app .timebody,
		#studio-app .cliprow,
		#studio-app .playhead,
		#studio-app .wave {
			display: none !important;
		}

		/* ---- themed chrome ---------------------------------- */

		html[data-theme] #studio-app .app-top {
			background: var(--t-panel);
			border-bottom-color: var(--t-line);
			color: var(--t-ink);
		}

		html[data-theme] #studio-app .heading h1 {
			color: var(--t-heading-out);
			font-weight: 700;
		}

		html[data-theme] #studio-app .heading p {
			color: var(--t-muted-out);
		}

		html[data-theme] #studio-app .studio-card {
			background: var(--t-panel);
			border-color: var(--t-line);
			box-shadow: var(--t-shadow);
			border-radius: var(--t-radius);
		}

		html[data-theme] #studio-app .card-head {
			border-bottom-color: var(--t-line);
		}

		html[data-theme] #studio-app .batch-table th {
			background: var(--t-panel-2);
			color: var(--t-muted);
			border-bottom-color: var(--t-line);
		}

		html[data-theme] #studio-app .batch-table td {
			border-bottom-color: var(--t-line);
		}

		html[data-theme] #studio-app .batch-badge {
			background: var(--t-panel-2);
			border-color: var(--t-line);
		}

		html[data-theme] #studio-app .view-switch {
			background: var(--t-panel-2);
			border-color: var(--t-line);
		}

		html[data-theme] #studio-app .view-switch-btn {
			color: var(--t-muted);
		}

		html[data-theme] #studio-app .view-switch-btn.active {
			background: var(--accent);
			color: var(--t-on-accent);
		}

		html[data-theme] #studio-app .editor-build .video-accordion,
		html[data-theme] #studio-app .editor-build .va-header {
			background: transparent;
		}

		html[data-theme] #studio-app .heading-actions .bulk-toggle {
			border-color: var(--t-line);
			background: var(--t-btn2-bg);
			color: var(--t-btn2-ink);
		}

		html[data-theme] #studio-app .heading-actions .bulk-toggle:hover {
			border-color: var(--accent);
			color: var(--accent);
		}

		html[data-theme] #studio-app .app-generate {
			border-color: var(--accent);
			background: var(--accent);
			color: var(--t-on-accent);
		}

		/*
		 * The credit pill is fixed. While the studio is on
		 * screen, park it under the sticky top bar; on the
		 * landing page it keeps its own corner.
		 */

		#studio-app:not([hidden]) ~ .credit-pill {
			top: 78px;
		}

		@media (max-width: 1100px) {
			#studio-app .studio {
				grid-template-columns: minmax(280px, 65fr) minmax(0, 35fr);
			}
		}

		@media (max-width: 860px) {
			#studio-app .studio {
				grid-template-columns: 1fr;
			}

			#studio-app .preview-card {
				position: static;
			}

			#studio-app .app-top {
				flex-wrap: wrap;
			}
		}

		@media (max-width: 560px) {
			#studio-app .app-main {
				padding: 14px 10px 30px;
			}

			#studio-app .heading-actions {
				margin-left: 0;
				width: 100%;
			}

			#studio-app .heading-actions .bulk-toggle {
				flex: 1;
			}

			#studio-app .app-top {
				padding: 8px 10px;
				gap: 8px;
			}

			#studio-app .app-name {
				display: none;
			}

			#studio-app .app-generate {
				padding: 9px 11px;
				font-size: 0.74rem;
			}

			#studio-app:not([hidden]) ~ .credit-pill {
				top: 66px;
			}
		}

		@media (max-width: 560px) {
			.credit-pill {
				top: 8px;
				right: 8px;
			}

			.credit-pill-btn {
				min-height: 34px;
				padding: 0 10px;
				gap: 7px;
				font-size: 0.71rem;
			}

			.credit-popover {
				width: 246px;
			}
		}

		/* Modular CMS Top Menu & Footer Links inside Studio */
		.app-top-cms-links {
			display: flex;
			align-items: center;
			gap: 14px;
			flex-wrap: wrap;
			padding: 8px 24px;
			border-bottom: 1px solid var(--t-line, rgba(255, 255, 255, 0.09));
			background: var(--t-panel, rgba(20, 22, 28, 0.85));
			font-size: 0.82rem;
		}

		.app-top-cms-links a,
		.studio-cms-footer-links a {
			color: var(--t-muted, #9ca3af);
			text-decoration: none;
			font-weight: 600;
			transition: color 0.15s ease;
		}

		.app-top-cms-links a:hover,
		.studio-cms-footer-links a:hover {
			color: var(--t-text, #f59e0b);
		}

		.studio-cms-footer {
			margin-top: 28px;
			padding: 16px 24px;
			border-top: 1px solid var(--t-line, rgba(255, 255, 255, 0.09));
			display: flex;
			justify-content: center;
		}

		.studio-cms-footer-links {
			display: flex;
			align-items: center;
			gap: 18px;
			flex-wrap: wrap;
			font-size: 0.85rem;
		}

		/* Reel Editor v4 scene gallery + click-to-edit inspector */
		#tpl-modal .tm-gallery-tabs {
			display: flex;
			gap: 8px;
			margin: 4px 0 14px;
			padding: 5px;
			background: #111116;
			border: 1px solid rgba(255,255,255,.08);
			border-radius: 10px;
		}

		#tpl-modal .tm-gallery-tab {
			flex: 1;
			border: 1px solid transparent;
			border-radius: 8px;
			background: transparent;
			color: #9b9ba5;
			padding: 10px 12px;
			font: 700 .78rem 'JetBrains Mono', monospace;
			letter-spacing: .06em;
			cursor: pointer;
			transition: background .15s ease, color .15s ease, border-color .15s ease;
		}

		#tpl-modal .tm-gallery-tab:hover,
		#tpl-modal .tm-gallery-tab.active {
			background: rgba(122,172,43,.15);
			border-color: rgba(122,172,43,.6);
			color: #c8f36f;
		}

		#tpl-modal .tm-scene-gframe {
			aspect-ratio: 16 / 9;
		}

		#tpl-modal .tm-scene-gcanvas {
			object-fit: cover;
		}

		#tpl-modal .tm-reel-stage {
			position: relative;
			border: 1px solid rgba(122,172,43,.55);
		}

		#tpl-modal .tm-scene-selection-badge {
			position: absolute;
			z-index: 3;
			top: 10px;
			left: 10px;
			max-width: calc(100% - 20px);
			padding: 7px 11px;
			border: 1px solid rgba(255,255,255,.24);
			border-radius: 999px;
			background: rgba(0,0,0,.64);
			color: #fff;
			font: 700 10px 'JetBrains Mono', monospace;
			letter-spacing: .08em;
			text-transform: uppercase;
			pointer-events: none;
			backdrop-filter: blur(6px);
		}

		#tpl-modal .tm-motion-controls {
			display: flex;
			flex-direction: column;
			gap: 12px;
		}

		#tpl-modal .tm-scene-controls {
			min-width: 0;
			color: #e8e8ec;
			font-family: 'Archivo', Arial, sans-serif;
		}

		#tpl-modal .tm-scene-panel {
			padding: 14px;
			border: 1px solid rgba(255,255,255,.1);
			border-radius: 12px;
			background: linear-gradient(145deg, rgba(255,255,255,.055), rgba(255,255,255,.025));
			box-shadow: 0 12px 34px rgba(0,0,0,.2);
		}

		#tpl-modal .tm-scene-panel-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			margin-bottom: 6px;
		}

		#tpl-modal .tm-scene-kicker {
			margin-bottom: 3px;
			color: #7aac2b;
			font: 700 9px 'JetBrains Mono', monospace;
			letter-spacing: .17em;
		}

		#tpl-modal .tm-scene-panel .tm-sec-title {
			margin: 0;
			color: #f3f3f6;
			font: 700 12px 'JetBrains Mono', monospace;
			letter-spacing: .11em;
			text-transform: uppercase;
		}

		#tpl-modal .tm-scene-add,
		#tpl-modal .tm-scene-primary {
			border: 1px solid #7aac2b;
			border-radius: 8px;
			background: #7aac2b;
			color: #10120c;
			padding: 8px 10px;
			font-weight: 800;
			font-size: 11px;
			cursor: pointer;
		}

		#tpl-modal .tm-scene-hint {
			margin: 4px 0 12px;
			color: #8c8c97;
			font: 10px 'JetBrains Mono', monospace;
			letter-spacing: .035em;
			line-height: 1.55;
		}

		#tpl-modal .tm-scene-objects {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-bottom: 12px;
		}

		#tpl-modal .tm-scene-object {
			border: 1px solid rgba(255,255,255,.13);
			border-radius: 999px;
			background: #17171d;
			color: #c7c7d0;
			padding: 7px 10px;
			font: 700 9px 'JetBrains Mono', monospace;
			text-transform: uppercase;
			letter-spacing: .045em;
			cursor: pointer;
			transition: .15s ease;
		}

		#tpl-modal .tm-scene-object:hover,
		#tpl-modal .tm-scene-object.selected {
			border-color: #7aac2b;
			background: rgba(122,172,43,.17);
			color: #c8f36f;
		}

		#tpl-modal .tm-scene-object.deleted {
			color: #85858f;
			text-decoration: line-through;
		}

		#tpl-modal .tm-scene-inspector {
			display: grid;
			grid-template-columns: repeat(2, minmax(0,1fr));
			gap: 9px;
			padding-top: 11px;
			border-top: 1px solid rgba(255,255,255,.09);
		}

		#tpl-modal .tm-scene-inspector-title,
		#tpl-modal .tm-scene-subtitle {
			grid-column: 1 / -1;
			color: #c4a87c;
			font: 700 9px 'JetBrains Mono', monospace;
			letter-spacing: .13em;
			text-transform: uppercase;
		}

		#tpl-modal .tm-scene-field {
			display: flex;
			flex-direction: column;
			gap: 5px;
			min-width: 0;
			color: #8b8b96;
			font: 9px 'JetBrains Mono', monospace;
			letter-spacing: .09em;
			text-transform: uppercase;
		}

		#tpl-modal .tm-scene-field-label {
			min-height: 12px;
		}

		#tpl-modal .tm-scene-wide {
			grid-column: 1 / -1;
		}

		#tpl-modal .tm-scene-field input:not([type="range"]):not([type="checkbox"]),
		#tpl-modal .tm-scene-field select {
			width: 100%;
			min-width: 0;
			height: 36px;
			border: 1px solid rgba(255,255,255,.14);
			border-radius: 7px;
			background: #16161c;
			color: #e8e8ec;
			padding: 0 9px;
			font: 12px 'Archivo', Arial, sans-serif;
			letter-spacing: normal;
			text-transform: none;
		}

		#tpl-modal .tm-scene-field input[type="color"] {
			padding: 3px;
			cursor: pointer;
		}

		#tpl-modal .tm-scene-color-field {
			position: relative;
		}

		#tpl-modal .tm-scene-color-current {
			width: 32px;
			height: 32px;
			min-width: 32px;
			padding: 0;
			border: 1px solid rgba(255,255,255,.28);
			border-radius: 6px;
			box-shadow: inset 0 0 0 2px rgba(0,0,0,.16);
			cursor: pointer;
		}

		#tpl-modal .tm-scene-color-current:hover,
		#tpl-modal .tm-scene-color-current[aria-expanded="true"] {
			border-color: #c8f36f;
			outline: 2px solid rgba(200,243,111,.18);
			outline-offset: 2px;
		}

		#tpl-modal .tm-scene-color-popover {
			position: absolute;
			z-index: 40;
			top: calc(100% + 7px);
			left: 0;
			width: 218px;
			padding: 10px;
			border: 1px solid rgba(255,255,255,.16);
			border-radius: 9px;
			background: #111117;
			box-shadow: 0 16px 40px rgba(0,0,0,.48);
			letter-spacing: normal;
			text-transform: none;
		}

		#tpl-modal .tm-scene-color-title {
			display: block;
			margin: 0 0 7px;
			color: #a8a8b3;
			font: 700 9px 'JetBrains Mono', monospace;
			letter-spacing: .09em;
			text-transform: uppercase;
		}

		#tpl-modal .tm-scene-color-swatches {
			display: grid;
			grid-template-columns: repeat(7, 22px);
			gap: 6px;
			margin-bottom: 11px;
		}

		#tpl-modal .tm-scene-color-swatch,
		#tpl-modal .tm-scene-field input[type="color"].tm-scene-color-custom {
			width: 22px;
			height: 22px;
			min-width: 22px;
			padding: 0;
			border: 1px solid rgba(255,255,255,.22);
			border-radius: 4px;
			background-clip: padding-box;
			cursor: pointer;
		}

		#tpl-modal .tm-scene-color-swatch:hover,
		#tpl-modal .tm-scene-color-swatch:focus-visible,
		#tpl-modal .tm-scene-gradient-swatch:hover,
		#tpl-modal .tm-scene-gradient-swatch:focus-visible {
			border-color: #c8f36f;
			outline: 2px solid rgba(200,243,111,.28);
			outline-offset: 1px;
		}

		#tpl-modal .tm-scene-gradient-row {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 6px;
			width: 100%;
		}

		#tpl-modal .tm-scene-gradient-swatch {
			width: 100%;
			height: 24px;
			padding: 0;
			border: 1px solid rgba(255,255,255,.24);
			border-radius: 4px;
			cursor: pointer;
		}

		#tpl-modal .tm-previewcol > .tm-scene-objects {
			margin: 12px 0 10px;
		}

		#tpl-modal .tm-scene-range-row {
			display: flex;
			align-items: center;
			gap: 8px;
			min-height: 36px;
		}

		#tpl-modal .tm-scene-field input[type="range"] {
			width: 100%;
			min-width: 0;
			margin: 0;
			accent-color: #7aac2b;
			cursor: pointer;
		}

		#tpl-modal .tm-scene-range-value {
			min-width: 35px;
			color: #c8f36f;
			font: 10px 'JetBrains Mono', monospace;
			text-align: right;
		}

		#tpl-modal .tm-scene-checkbox {
			width: 18px;
			height: 18px;
			accent-color: #7aac2b;
		}

		#tpl-modal .tm-scene-sticker-grid {
			grid-column: 1 / -1;
			display: grid;
			grid-template-columns: repeat(4, minmax(0,1fr));
			gap: 5px;
		}

		#tpl-modal .tm-scene-sticker {
			min-width: 0;
			border: 1px solid rgba(255,255,255,.12);
			border-radius: 7px;
			background: #16161c;
			color: #d4d4db;
			padding: 7px 3px;
			font: 9px 'JetBrains Mono', monospace;
			cursor: pointer;
		}

		#tpl-modal .tm-scene-sticker.selected,
		#tpl-modal .tm-scene-sticker:hover {
			border-color: #7aac2b;
			color: #c8f36f;
		}

		#tpl-modal .tm-scene-delete,
		#tpl-modal .tm-scene-secondary {
			border: 1px solid rgba(255,82,98,.45);
			border-radius: 7px;
			background: transparent;
			color: #ff7885;
			padding: 8px 10px;
			font-size: 10px;
			font-weight: 700;
			cursor: pointer;
		}

		#tpl-modal .tm-scene-photo-controls {
			grid-column: 1 / -1;
			display: flex;
			gap: 7px;
		}

		#tpl-modal .tm-scene-upload {
			position: relative;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-height: 34px;
			border: 1px solid rgba(122,172,43,.58);
			border-radius: 7px;
			background: rgba(122,172,43,.13);
			color: #c8f36f;
			padding: 0 10px;
			font: 700 10px 'JetBrains Mono', monospace;
			cursor: pointer;
		}

		#tpl-modal .tm-scene-upload input {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			opacity: 0;
			cursor: pointer;
		}

		#tpl-modal .tm-scene-photos {
			grid-column: 1 / -1;
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
		}

		#tpl-modal .tm-scene-photo-thumb {
			width: 50px;
			height: 50px;
			padding: 0;
			border: 1px solid rgba(255,255,255,.18);
			border-radius: 7px;
			overflow: hidden;
			background: #17171d;
			cursor: pointer;
		}

		#tpl-modal .tm-scene-photo-thumb:hover {
			border-color: #7aac2b;
		}

		#tpl-modal .tm-scene-photo-thumb img {
			width: 100%;
			height: 100%;
			object-fit: cover;
		}

		#tpl-modal .tm-scene-layer-controls {
			grid-column: 1 / -1;
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 8px;
		}

		#tpl-modal .tm-scene-layer-button {
			padding: 9px 12px;
			min-height: 36px;
			border: 1px solid rgba(122,172,43,.6);
			border-radius: 7px;
			background: rgba(122,172,43,.12);
			color: #c8f36f;
			font-size: 11px;
			font-weight: 700;
			cursor: pointer;
		}

		#tpl-modal .tm-scene-layer-button:hover:not(:disabled) {
			background: rgba(122,172,43,.25);
		}

		#tpl-modal .tm-scene-layer-button:disabled,
		#tpl-modal .tm-ring-remove:disabled {
			opacity: .4;
			cursor: not-allowed;
		}

		#tpl-modal .tm-scene-layer-position {
			color: #a3a3b2;
			font-size: 10px;
		}

		#tpl-modal .tm-ring-upload {
			margin-top: 12px;
			border: 1px solid rgba(122,172,43,.4);
			border-radius: 12px;
			background: rgba(122,172,43,.045);
			overflow: hidden;
		}

		#tpl-modal .tm-ring-upload summary {
			padding: 14px;
			color: #c8f36f;
			font: 700 11px 'JetBrains Mono', monospace;
			cursor: pointer;
		}

		#tpl-modal .tm-ring-upload-body { padding: 0 14px 14px; }

		#tpl-modal .tm-ring-status {
			font-size: 11px;
			line-height: 1.5;
			color: #c4c4cf;
		}

		#tpl-modal .tm-ring-thumbs {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
			gap: 9px;
		}

		#tpl-modal .tm-ring-thumb {
			position: relative;
			min-width: 0;
			padding: 5px;
			border: 1px solid rgba(255,255,255,.14);
			border-radius: 8px;
			background: #17171d;
		}

		#tpl-modal .tm-ring-thumb img {
			display: block;
			width: 100%;
			aspect-ratio: 3 / 4;
			object-fit: cover;
			border-radius: 4px;
		}

		#tpl-modal .tm-ring-thumb span {
			display: block;
			margin-top: 5px;
			color: #c4c4cf;
			font-size: 10px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		#tpl-modal .tm-ring-remove {
			position: absolute;
			top: 8px;
			right: 8px;
			width: 25px;
			height: 25px;
			padding: 0;
			border: 1px solid rgba(255,255,255,.3);
			border-radius: 50%;
			background: rgba(10,10,14,.85);
			color: #fff;
			font-size: 18px;
			cursor: pointer;
		}

		@media (max-width: 700px) {
			#tpl-modal .tm-scene-inspector { grid-template-columns: 1fr 1fr; }
			#tpl-modal .tm-scene-panel { padding: 10px; }
		}

		/* =====================================================
		 * VIDEO ACCORDION BUTTONS — every theme
		 * Match the Upload Image button's larger proportions:
		 * 12px 24px padding, 1rem type and a 48px tap target.
		 * The ID scope intentionally wins over older small-button
		 * rules and each theme's compact control overrides.
		 * ===================================================== */
		#video-accordions .video-accordion button {
			box-sizing: border-box;
			min-width: 48px;
			min-height: 48px;
			padding: 12px 24px;
			font-size: 1rem;
			line-height: 1.25;
			font-weight: 700;
			align-items: center;
			justify-content: center;
		}

		/* Neo Brutalist uses truly square corners on every accordion
		 * button, including icon, remove, API and disclosure buttons. */
		html[data-theme="neo"] #video-accordions .video-accordion button {
			border-radius: 0;
		}

		@media (max-width: 560px) {
			#tpl-modal .tm-gallery-tabs {
				flex-wrap: wrap;
			}
			#tpl-modal .tm-gallery-tab {
				flex: 1 1 30%;
			}
		}

`;
