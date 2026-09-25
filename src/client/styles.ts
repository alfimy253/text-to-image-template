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
		 * overlay (KV-backed, max 7
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
		 * The design picker cards are 18%
		 * narrower (max-width 82%) so the
		 * modal's bottom buttons stay
		 * visible without scrolling.
		 */

		#tpl-modal .tpl-designs {

			display:
				grid;

			grid-template-columns:
				repeat(5, 1fr);

			gap:
				10px;

			max-width:
				82%;

			margin:
				0 auto 14px auto;
		}


		#tpl-modal .tpl-design {

			background:
				#1b1b20;

			border:
				2px solid transparent;

			border-radius:
				12px;

			padding:
				8px;

			cursor:
				pointer;
		}


		#tpl-modal .tpl-design.selected {

			border-color:
				#ffd83d;

			background:
				#24242a;
		}


		#tpl-modal .tpl-design canvas {

			width:
				100%;

			height:
				auto;

			display:
				block;

			border-radius:
				8px;

			background:
				#111;
		}


		#tpl-modal .tpl-design b {

			display:
				block;

			font-size:
				13px;

			margin:
				7px 2px 2px;

			color:
				#fff;
		}


		#tpl-modal .tpl-design small {

			display:
				block;

			color:
				#999;

			font-size:
				11px;

			line-height:
				1.3;

			margin:
				0 2px 3px;
		}


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
		 * Portrait preview stage, 18%
		 * narrower than before (443px
		 * instead of 540px) so the
		 * Add / Close buttons at the
		 * bottom of the modal stay in
		 * view.
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


		@media (max-width: 800px) {

			#tpl-modal .tpl-designs {

				grid-template-columns:
					repeat(3, 1fr);
			}
		}


		@media (max-width: 520px) {

			#tpl-modal .tpl-designs {

				grid-template-columns:
					repeat(2, 1fr);
			}


			#tpl-modal .tpl-status {

				width:
					100%;

				margin-left:
					0;
			}
		}

`;
