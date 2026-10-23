/*
 * Modular Payment Screenshot Uploader (`src/client/payment-upload-js.ts`)
 *
 * Self-contained browser module (`window.PaymentScreenshotUploader`) that can
 * be mounted onto any container (such as `/upgrade`) without touching studio
 * globals. Handles screenshot selection, drag-and-drop, client image preview,
 * `FormData` upload to `POST /api/payments/upload`, and live submission status.
 */

export const PAYMENT_UPLOAD_CSS = `
.pay-uploader {
	border: var(--sh-border-w, 1px) solid var(--sh-line, #2a303c);
	border-radius: var(--sh-radius, 12px);
	background: var(--sh-panel-2, #1e222b);
	padding: 20px;
}

.pay-dropzone {
	border: 2px dashed var(--sh-line, #374151);
	border-radius: 10px;
	padding: 26px 18px;
	text-align: center;
	background: var(--sh-input, #12151b);
	cursor: pointer;
	transition: border-color 0.15s ease, background 0.15s ease;
}

.pay-dropzone:hover,
.pay-dropzone.drag-over {
	border-color: var(--sh-accent, #f59e0b);
}

.pay-dropzone input[type="file"] {
	display: none;
}

.pay-dropzone-title {
	font-weight: 700;
	font-size: 1rem;
	color: var(--sh-heading, #ffffff);
	margin-bottom: 4px;
}

.pay-dropzone-sub {
	font-size: 0.84rem;
	color: var(--sh-muted, #9ca3af);
}

.pay-preview-wrap {
	margin-top: 16px;
	display: none;
	align-items: center;
	gap: 16px;
	padding: 12px;
	border: 1px solid var(--sh-line, #2a303c);
	border-radius: 10px;
	background: var(--sh-panel, #171a21);
	flex-wrap: wrap;
}

.pay-preview-wrap.visible {
	display: flex;
}

.pay-preview-thumb {
	width: 140px;
	height: 96px;
	object-fit: cover;
	border-radius: 6px;
	border: 1px solid var(--sh-line, #2a303c);
	cursor: zoom-in;
}

.pay-preview-meta {
	flex: 1;
	min-width: 180px;
	font-size: 0.88rem;
}

.pay-field {
	margin-top: 14px;
}

.pay-field label {
	display: block;
	font-size: 0.84rem;
	font-weight: 600;
	color: var(--sh-muted, #9ca3af);
	margin-bottom: 6px;
}

.pay-status {
	margin-top: 14px;
	padding: 11px 14px;
	border-radius: 8px;
	font-size: 0.9rem;
	display: none;
}

.pay-status.visible {
	display: block;
}

.pay-status.ok {
	background: rgba(16, 185, 129, 0.14);
	border: 1px solid rgba(16, 185, 129, 0.45);
	color: #34d399;
}

.pay-status.err {
	background: rgba(239, 68, 68, 0.14);
	border: 1px solid rgba(239, 68, 68, 0.45);
	color: #f87171;
}

.pay-status.info {
	background: rgba(59, 130, 246, 0.14);
	border: 1px solid rgba(59, 130, 246, 0.45);
	color: #60a5fa;
}

.pay-history {
	margin-top: 22px;
}

.pay-history-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
	gap: 14px;
	margin-top: 12px;
}

.pay-history-card {
	border: var(--sh-border-w, 1px) solid var(--sh-line, #2a303c);
	border-radius: 10px;
	background: var(--sh-panel, #171a21);
	padding: 12px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.pay-history-card img {
	width: 100%;
	height: 150px;
	object-fit: cover;
	border-radius: 6px;
	cursor: zoom-in;
	border: 1px solid var(--sh-line, #2a303c);
}

.pay-badge {
	display: inline-flex;
	align-items: center;
	padding: 3px 9px;
	border-radius: 999px;
	font-size: 0.74rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.pay-badge.pending {
	background: rgba(245, 158, 11, 0.16);
	color: #fbbf24;
	border: 1px solid rgba(245, 158, 11, 0.4);
}

.pay-badge.approved {
	background: rgba(16, 185, 129, 0.16);
	color: #34d399;
	border: 1px solid rgba(16, 185, 129, 0.45);
}
`;

export const PAYMENT_UPLOAD_JS = `
(function() {
	"use strict";

	var MAX_BYTES = 5 * 1024 * 1024;

	function esc(s) {
		return String(s == null ? "" : s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	function formatSize(bytes) {
		if (bytes < 1024) return bytes + " B";
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
		return (bytes / (1024 * 1024)).toFixed(2) + " MB";
	}

	function mount(target, options) {
		var container = typeof target === "string"
			? document.querySelector(target)
			: target;
		if (!container) return null;
		var opts = options || {};

		container.innerHTML =
			'<div class="pay-uploader">' +
				'<label class="pay-dropzone" id="pay-dropzone" for="payment-screenshot-file">' +
					'<input type="file" id="payment-screenshot-file" name="screenshot" accept="image/png,image/jpeg,image/webp,image/gif" />' +
					'<div class="pay-dropzone-title">\\ud83d\\udcf8 Click or Drop Payment Transaction Screenshot</div>' +
					'<div class="pay-dropzone-sub">PNG, JPG, WEBP or GIF \\u00b7 Max 5 MB \\u00b7 Make sure the transaction number is readable</div>' +
				'</label>' +
				'<div class="pay-preview-wrap" id="pay-preview-wrap">' +
					'<img class="pay-preview-thumb" id="pay-preview-thumb" alt="Selected payment screenshot preview" title="Click to view fullscreen" />' +
					'<div class="pay-preview-meta">' +
						'<div><strong id="pay-preview-name"></strong></div>' +
						'<div class="site-muted" id="pay-preview-size"></div>' +
						'<button type="button" class="site-btn" id="pay-clear-btn" style="margin-top:8px;padding:5px 12px;font-size:0.8rem;">Remove selection</button>' +
					'</div>' +
				'</div>' +
				'<div class="pay-field">' +
					'<label for="payment-user-note">Optional Note / Reference Info</label>' +
					'<input type="text" class="site-input" id="payment-user-note" maxlength="240" placeholder="Optional note for admin (e.g. sender name or payment app)" />' +
				'</div>' +
				'<div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center;">' +
					'<button type="button" class="site-btn site-btn-primary" id="payment-upload-submit">\\u2b06 Upload Payment Screenshot</button>' +
				'</div>' +
				'<div class="pay-status" id="payment-upload-status" role="status"></div>' +
			'</div>' +
			'<div class="pay-history" id="payment-history-section">' +
				'<h3 style="margin:0 0 4px;">Your Uploaded Payment Screenshots</h3>' +
				'<div class="site-muted" id="payment-history-note">Loading your payment submissions...</div>' +
				'<div class="pay-history-grid" id="payment-history-grid"></div>' +
			'</div>';

		var fileInput = container.querySelector("#payment-screenshot-file");
		var dropzone = container.querySelector("#pay-dropzone");
		var previewWrap = container.querySelector("#pay-preview-wrap");
		var previewThumb = container.querySelector("#pay-preview-thumb");
		var previewName = container.querySelector("#pay-preview-name");
		var previewSize = container.querySelector("#pay-preview-size");
		var clearBtn = container.querySelector("#pay-clear-btn");
		var noteInput = container.querySelector("#payment-user-note");
		var submitBtn = container.querySelector("#payment-upload-submit");
		var statusBox = container.querySelector("#payment-upload-status");
		var historyNote = container.querySelector("#payment-history-note");
		var historyGrid = container.querySelector("#payment-history-grid");

		var selectedFile = null;
		var previewObjectUrl = null;
		var uploading = false;

		function setStatus(kind, message) {
			if (!statusBox) return;
			if (!message) {
				statusBox.className = "pay-status";
				statusBox.textContent = "";
				return;
			}
			statusBox.className = "pay-status visible " + kind;
			statusBox.textContent = message;
		}

		function clearFileSelection() {
			selectedFile = null;
			if (fileInput) fileInput.value = "";
			if (previewObjectUrl) {
				URL.revokeObjectURL(previewObjectUrl);
				previewObjectUrl = null;
			}
			if (previewThumb) {
				previewThumb.removeAttribute("src");
				previewThumb.removeAttribute("data-fullscreen-src");
			}
			if (previewWrap) previewWrap.classList.remove("visible");
		}

		function applyFile(file) {
			if (!file) return;
			if (file.size > MAX_BYTES) {
				setStatus("err", "That image is larger than 5 MB. Please choose a smaller screenshot.");
				return;
			}
			if (file.type && !/^image\\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
				setStatus("err", "Unsupported file format. Please choose a PNG, JPG, WEBP or GIF screenshot.");
				return;
			}
			setStatus("", "");
			if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
			selectedFile = file;
			previewObjectUrl = URL.createObjectURL(file);
			if (previewThumb) {
				previewThumb.src = previewObjectUrl;
				previewThumb.setAttribute("data-fullscreen-src", previewObjectUrl);
				previewThumb.setAttribute("data-fullscreen-caption", file.name);
			}
			if (previewName) previewName.textContent = file.name;
			if (previewSize) previewSize.textContent = formatSize(file.size);
			if (previewWrap) previewWrap.classList.add("visible");
		}

		if (fileInput) {
			fileInput.addEventListener("change", function() {
				if (fileInput.files && fileInput.files[0]) {
					applyFile(fileInput.files[0]);
				}
			});
		}

		if (dropzone) {
			["dragenter", "dragover"].forEach(function(evtName) {
				dropzone.addEventListener(evtName, function(e) {
					e.preventDefault();
					dropzone.classList.add("drag-over");
				});
			});
			["dragleave", "drop"].forEach(function(evtName) {
				dropzone.addEventListener(evtName, function(e) {
					e.preventDefault();
					dropzone.classList.remove("drag-over");
				});
			});
			dropzone.addEventListener("drop", function(e) {
				if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
					applyFile(e.dataTransfer.files[0]);
				}
			});
		}

		if (clearBtn) {
			clearBtn.addEventListener("click", clearFileSelection);
		}

		function loadMyPayments() {
			fetch("/api/payments/my", { credentials: "same-origin" })
				.then(function(r) {
					if (r.status === 401) return { unauthorized: true };
					return r.json().catch(function() { return {}; });
				})
				.then(function(d) {
					if (!historyGrid || !historyNote) return;
					historyGrid.innerHTML = "";
					if (d && d.unauthorized) {
						historyNote.textContent = "Sign in to view and upload payment transaction screenshots.";
						return;
					}
					var list = (d && d.payments) || [];
					if (!list.length) {
						historyNote.textContent = "No payment transaction screenshots uploaded yet.";
						return;
					}
					historyNote.textContent = list.length + " uploaded payment screenshot(s). Click any image to view fullscreen.";
					list.forEach(function(item) {
						var imgSrc = "/api/payments/image/" + encodeURIComponent(item.id);
						var card = document.createElement("div");
						card.className = "pay-history-card";
						var badgeCls = item.status === "approved" ? "approved" : "pending";
						var badgeTxt = item.status === "approved" ? "\\u2713 Approved (paid_user)" : "\\u23f3 Pending Admin Verification";
						card.innerHTML =
							'<img src="' + esc(imgSrc) + '" data-fullscreen-src="' + esc(imgSrc) + '" data-fullscreen-caption="' + esc(item.fileName || item.id) + '" alt="Payment screenshot" loading="lazy" />' +
							'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
								'<span class="pay-badge ' + badgeCls + '">' + badgeTxt + '</span>' +
								'<span class="site-muted" style="font-size:0.76rem;">' + esc((item.createdAt || "").replace("T", " ").slice(0, 16)) + '</span>' +
							'</div>' +
							(item.transactionNumber
								? '<div style="font-size:0.82rem;"><strong>Verified Txn #:</strong> ' + esc(item.transactionNumber) + '</div>'
								: '') +
							(item.userNote
								? '<div class="site-muted" style="font-size:0.8rem;">Note: ' + esc(item.userNote) + '</div>'
								: '');
						historyGrid.appendChild(card);
					});
				})
				.catch(function() {
					if (historyNote) historyNote.textContent = "Could not load payment history.";
				});
		}

		if (submitBtn) {
			submitBtn.addEventListener("click", function() {
				if (uploading) return;
				if (!selectedFile) {
					setStatus("err", "Please select a payment transaction screenshot image first.");
					return;
				}
				uploading = true;
				submitBtn.disabled = true;
				submitBtn.textContent = "Uploading screenshot...";
				setStatus("info", "Uploading your payment transaction screenshot...");

				var fd = new FormData();
				fd.append("screenshot", selectedFile, selectedFile.name || "screenshot.png");
				if (noteInput && noteInput.value.trim()) {
					fd.append("userNote", noteInput.value.trim());
				}

				fetch("/api/payments/upload", {
					method: "POST",
					body: fd,
					credentials: "same-origin"
				})
					.then(function(r) {
						return r.json().catch(function() { return {}; }).then(function(body) {
							return { ok: r.ok, status: r.status, body: body };
						});
					})
					.then(function(res) {
						if (res.ok && res.body && res.body.success) {
							clearFileSelection();
							if (noteInput) noteInput.value = "";
							setStatus(
								"ok",
								"Payment screenshot uploaded! Our admin will verify the transaction number and upgrade your account to paid_user."
							);
							loadMyPayments();
							if (typeof opts.onUploaded === "function") {
								opts.onUploaded(res.body.payment);
							}
						} else {
							setStatus(
								"err",
								(res.body && res.body.error) || ("Upload failed (" + res.status + ").")
							);
						}
					})
					.catch(function() {
						setStatus("err", "Network error while uploading screenshot. Please try again.");
					})
					.finally(function() {
						uploading = false;
						submitBtn.disabled = false;
						submitBtn.textContent = "\\u2b06 Upload Payment Screenshot";
					});
			});
		}

		loadMyPayments();

		return {
			reloadHistory: loadMyPayments,
			clear: clearFileSelection
		};
	}

	window.PaymentScreenshotUploader = {
		mount: mount
	};
})();
`;
