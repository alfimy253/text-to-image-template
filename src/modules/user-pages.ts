/*
 * Modular User Account & Upgrade Pages (`src/modules/user-pages.ts`)
 *
 * Implements Requirement #2:
 *   - `GET /account`: User profile, current plan (`free` vs `paid_user`),
 *     daily credits meter, recent payment submissions, and prominent
 *     `Upgrade` button linking to `/upgrade`.
 *   - `GET /upgrade`: Local Payment Gateway details written on the dynamic
 *     site configuration page, step-by-step screenshot upload instructions,
 *     and the modular `PaymentScreenshotUploader` component.
 */

import {
	PAYMENT_UPLOAD_CSS,
	PAYMENT_UPLOAD_JS
} from "../client/payment-upload-js";
import { cmsPagesToNavItems, readCmsPages } from "./cms";
import {
	listUserPaymentRecords,
	readPaymentGatewayConfig,
	SessionAccountUser
} from "./payments";
import { escapeHtml, renderShellPage } from "./theme-shell";

const USER_PAGES_CSS = `
.acct-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
	gap: 20px;
}

.acct-plan-pill {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	padding: 5px 12px;
	border-radius: 999px;
	font-size: 0.8rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

.acct-plan-pill.paid {
	background: rgba(16, 185, 129, 0.16);
	color: #34d399;
	border: 1px solid rgba(16, 185, 129, 0.45);
}

.acct-plan-pill.free {
	background: rgba(245, 158, 11, 0.16);
	color: #fbbf24;
	border: 1px solid rgba(245, 158, 11, 0.45);
}

.acct-kv-list {
	display: grid;
	gap: 12px;
	margin: 18px 0;
}

.acct-kv-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
	padding-bottom: 10px;
	border-bottom: 1px solid var(--sh-line);
	font-size: 0.94rem;
}

.acct-kv-label {
	color: var(--sh-muted);
	font-weight: 600;
}

.gateway-box {
	background: var(--sh-input);
	border: var(--sh-border-w) solid var(--sh-line);
	border-radius: var(--sh-radius);
	padding: 18px 20px;
	white-space: pre-wrap;
	word-break: break-word;
	font-size: 0.96rem;
	line-height: 1.7;
}

.instructions-box {
	background: var(--sh-panel-2);
	border-left: 4px solid var(--sh-accent);
	border-radius: 8px;
	padding: 16px 18px;
	white-space: pre-wrap;
	word-break: break-word;
	font-size: 0.94rem;
	line-height: 1.7;
}

.inline-auth-tabs {
	display: flex;
	gap: 8px;
	margin-bottom: 14px;
}

.inline-auth-form {
	display: grid;
	gap: 12px;
	max-width: 440px;
}

.inline-auth-msg {
	font-size: 0.88rem;
	padding: 9px 12px;
	border-radius: 8px;
	display: none;
}

.inline-auth-msg.visible {
	display: block;
}

.inline-auth-msg.err {
	background: rgba(239, 68, 68, 0.14);
	border: 1px solid rgba(239, 68, 68, 0.45);
	color: #f87171;
}

.inline-auth-msg.ok {
	background: rgba(16, 185, 129, 0.14);
	border: 1px solid rgba(16, 185, 129, 0.45);
	color: #34d399;
}
`;

const INLINE_AUTH_WIDGET_JS = `
(function() {
	var authRoot = document.getElementById("inline-auth-widget");
	var logoutBtn = document.getElementById("account-logout-btn");
	var creditsEl = document.getElementById("account-credits-live");

	if (creditsEl) {
		fetch("/api/credits", { credentials: "same-origin" })
			.then(function(r) {
				if (r.status === 503) return { openAccess: true };
				return r.json().catch(function() { return null; });
			})
			.then(function(d) {
				if (!d) return;
				if (d.openAccess) {
					creditsEl.textContent = "Unlimited (Open Access)";
				} else if (d.remaining && d.plan && d.plan.limits && typeof d.remaining.images === "number") {
					creditsEl.textContent = d.remaining.images + " / " + d.plan.limits.images + " AI images remaining today";
				}
			})
			.catch(function() {});
	}

	if (logoutBtn) {
		logoutBtn.addEventListener("click", function() {
			logoutBtn.disabled = true;
			fetch("/api/logout", { method: "POST", credentials: "same-origin" })
				.finally(function() {
					window.location.reload();
				});
		});
	}

	if (!authRoot) return;
	var mode = new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "login";
	var tabLogin = document.getElementById("ia-tab-login");
	var tabSignup = document.getElementById("ia-tab-signup");
	var emailWrap = document.getElementById("ia-email-wrap");
	var submitBtn = document.getElementById("ia-submit-btn");
	var form = document.getElementById("ia-form");
	var msg = document.getElementById("ia-msg");

	function syncMode(nextMode) {
		mode = nextMode;
		if (tabLogin) tabLogin.className = mode === "login" ? "site-btn site-btn-primary" : "site-btn";
		if (tabSignup) tabSignup.className = mode === "signup" ? "site-btn site-btn-primary" : "site-btn";
		if (emailWrap) emailWrap.style.display = mode === "signup" ? "block" : "none";
		if (submitBtn) submitBtn.textContent = mode === "signup" ? "Create Account" : "Sign In";
		if (msg) {
			msg.className = "inline-auth-msg";
			msg.textContent = "";
		}
	}

	syncMode(mode);
	if (tabLogin) tabLogin.addEventListener("click", function() { syncMode("login"); });
	if (tabSignup) tabSignup.addEventListener("click", function() { syncMode("signup"); });

	if (form) {
		form.addEventListener("submit", function(e) {
			e.preventDefault();
			var username = (document.getElementById("ia-username").value || "").trim();
			var email = (document.getElementById("ia-email").value || "").trim();
			var password = document.getElementById("ia-password").value || "";
			var endpoint = mode === "signup" ? "/api/signup" : "/api/login";
			var payload = mode === "signup"
				? { username: username, email: email, password: password }
				: { username: username, password: password };

			if (submitBtn) submitBtn.disabled = true;
			fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify(payload)
			})
				.then(function(r) { return r.json().catch(function() { return {}; }); })
				.then(function(d) {
					if (d && d.success) {
						if (msg) {
							msg.className = "inline-auth-msg visible ok";
							msg.textContent = "Signed in! Reloading...";
						}
						window.location.reload();
					} else {
						if (msg) {
							msg.className = "inline-auth-msg visible err";
							msg.textContent = (d && d.error) || "Authentication failed.";
						}
					}
				})
				.catch(function() {
					if (msg) {
						msg.className = "inline-auth-msg visible err";
						msg.textContent = "Network error. Please try again.";
					}
				})
				.finally(function() {
					if (submitBtn) submitBtn.disabled = false;
				});
		});
	}
})();
`;

function renderInlineAuthCard(heading: string, subheading: string): string {
	return `
		<div class="site-card" id="inline-auth-widget">
			<h2 style="margin-top:0;">${escapeHtml(heading)}</h2>
			<p class="site-muted" style="margin-top:0;">${escapeHtml(subheading)}</p>
			<div class="inline-auth-tabs">
				<button type="button" class="site-btn site-btn-primary" id="ia-tab-login">Sign In</button>
				<button type="button" class="site-btn" id="ia-tab-signup">Create Free Account</button>
			</div>
			<form class="inline-auth-form" id="ia-form">
				<div>
					<label class="site-muted" for="ia-username" style="display:block;font-size:0.84rem;margin-bottom:4px;">Username</label>
					<input class="site-input" type="text" id="ia-username" required autocomplete="username" />
				</div>
				<div id="ia-email-wrap" style="display:none;">
					<label class="site-muted" for="ia-email" style="display:block;font-size:0.84rem;margin-bottom:4px;">Email</label>
					<input class="site-input" type="email" id="ia-email" autocomplete="email" />
				</div>
				<div>
					<label class="site-muted" for="ia-password" style="display:block;font-size:0.84rem;margin-bottom:4px;">Password</label>
					<input class="site-input" type="password" id="ia-password" required autocomplete="current-password" />
				</div>
				<div class="inline-auth-msg" id="ia-msg"></div>
				<div>
					<button type="submit" class="site-btn site-btn-primary" id="ia-submit-btn">Sign In</button>
				</div>
			</form>
		</div>
	`;
}

export async function renderAccountPageResponse(
	request: Request,
	env: { KV_BINDING?: KVNamespace },
	theme: string,
	resolveSessionUser: (
		req: Request,
		e: { KV_BINDING?: KVNamespace }
	) => Promise<SessionAccountUser | null>
): Promise<Response> {
	const [cmsPages, sessionUser] = await Promise.all([
		readCmsPages(env),
		resolveSessionUser(request, env)
	]);

	const isPaid =
		sessionUser &&
		String(sessionUser.usertype || "").toLowerCase() === "paid_user";
	const userPayments = sessionUser
		? await listUserPaymentRecords(env, sessionUser.username)
		: [];

	const submissionsHtml =
		sessionUser && userPayments.length > 0
			? `<div style="display:grid;gap:10px;margin-top:14px;">` +
				userPayments
					.slice(0, 6)
					.map((item) => {
						const imgSrc =
							"/api/payments/image/" + encodeURIComponent(item.id);
						const approved = item.status === "approved";
						return `
						<div style="display:flex;align-items:center;gap:12px;padding:10px;border:1px solid var(--sh-line);border-radius:8px;background:var(--sh-panel-2);flex-wrap:wrap;">
							<img src="${escapeHtml(imgSrc)}" data-fullscreen-src="${escapeHtml(
								imgSrc
							)}" data-fullscreen-caption="${escapeHtml(
								item.fileName
							)}" alt="Payment receipt" style="width:68px;height:48px;object-fit:cover;border-radius:6px;cursor:zoom-in;" />
							<div style="flex:1;min-width:160px;">
								<div style="font-weight:700;font-size:0.88rem;">${
									approved
										? "✓ Approved (paid_user)"
										: "⏳ Pending Verification"
								}</div>
								<div class="site-muted" style="font-size:0.78rem;">${escapeHtml(
									item.createdAt.replace("T", " ").slice(0, 16)
								)}${
									item.transactionNumber
										? " · Txn #" + escapeHtml(item.transactionNumber)
										: ""
								}</div>
							</div>
						</div>`;
					})
					.join("") +
				`</div>`
			: `<p class="site-muted">No payment screenshots submitted yet.</p>`;

	const bodyHtml = sessionUser
		? `
		<div class="acct-grid">
			<section class="site-card">
				<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
					<div>
						<h1 style="margin:0 0 6px;font-size:1.75rem;">My Account</h1>
						<p class="site-muted" style="margin:0;">Manage your studio profile, daily AI image allowance and plan tier.</p>
					</div>
					<span class="acct-plan-pill ${isPaid ? "paid" : "free"}">
						${isPaid ? "★ Paid Plan (paid_user)" : "Free Plan"}
					</span>
				</div>

				<div class="acct-kv-list">
					<div class="acct-kv-row">
						<span class="acct-kv-label">Username</span>
						<strong>${escapeHtml(sessionUser.username)}</strong>
					</div>
					<div class="acct-kv-row">
						<span class="acct-kv-label">Email</span>
						<span>${escapeHtml(sessionUser.email || "—")}</span>
					</div>
					<div class="acct-kv-row">
						<span class="acct-kv-label">Account Type</span>
						<code>${escapeHtml(isPaid ? "paid_user" : "free")}</code>
					</div>
					<div class="acct-kv-row">
						<span class="acct-kv-label">Daily AI Credits</span>
						<span id="account-credits-live">Checking credits...</span>
					</div>
				</div>

				<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:20px;">
					<a href="/upgrade" class="site-btn site-btn-primary" id="account-upgrade-btn">
						${isPaid ? "View Upgrade & Payment Details →" : "⚡ Upgrade to Paid Plan →"}
					</a>
					<a href="${isPaid ? "/paid" : "/studio"}" class="site-btn">Open Video Studio</a>
					<button type="button" class="site-btn" id="account-logout-btn">Sign Out</button>
				</div>
			</section>

			<section class="site-card">
				<h2 style="margin-top:0;font-size:1.3rem;">Upgrade & Payment Status</h2>
				<p class="site-muted" style="margin-top:0;">
					${
						isPaid
							? "Your account has been verified and upgraded to paid_user."
							: "Want Paid Studio access and the same 10,000 AI images/day ceiling, with priority generation? Click Upgrade to pay via our local payment gateway and upload your transaction screenshot."
					}
				</p>
				${submissionsHtml}
				<div style="margin-top:18px;">
					<a href="/upgrade" class="site-btn site-btn-primary">Go to /upgrade</a>
				</div>
			</section>
		</div>
	`
		: `
		<div class="acct-grid">
			${renderInlineAuthCard(
				"Sign In to Your Account",
				"Sign in or create a free account to view your profile, daily credits, and upgrade status."
			)}
			<section class="site-card">
				<h2 style="margin-top:0;">Ready to Upgrade?</h2>
				<p class="site-muted">
					Upgrade to <strong>paid_user</strong> for high-volume daily AI image generation and full Paid Studio access. View our local payment gateway details and submit your payment screenshot on the Upgrade page.
				</p>
				<div style="margin-top:18px;">
					<a href="/upgrade" class="site-btn site-btn-primary" id="account-upgrade-btn">⚡ Upgrade to Paid Plan →</a>
				</div>
			</section>
		</div>
	`;

	const html = renderShellPage({
		title: "My Account",
		description: "Manage your account and upgrade your studio plan.",
		theme,
		activePath: "/account",
		cmsLinks: cmsPagesToNavItems(cmsPages),
		bodyHtml,
		extraCss: USER_PAGES_CSS,
		extraScriptsHtml: `<script>${INLINE_AUTH_WIDGET_JS}</script>`
	});

	return new Response(html, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=UTF-8",
			"Cache-Control": "no-store"
		}
	});
}

export async function renderUpgradePageResponse(
	request: Request,
	env: { KV_BINDING?: KVNamespace },
	theme: string,
	resolveSessionUser: (
		req: Request,
		e: { KV_BINDING?: KVNamespace }
	) => Promise<SessionAccountUser | null>
): Promise<Response> {
	const [cmsPages, gateway, sessionUser] = await Promise.all([
		readCmsPages(env),
		readPaymentGatewayConfig(env),
		resolveSessionUser(request, env)
	]);

	const isPaid =
		sessionUser &&
		String(sessionUser.usertype || "").toLowerCase() === "paid_user";

	const uploaderSectionHtml = sessionUser
		? `
		<section class="site-card">
			<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
				<h2 style="margin:0;font-size:1.35rem;">Upload Payment Transaction Screenshot</h2>
				<span class="acct-plan-pill ${isPaid ? "paid" : "free"}">
					Signed in as ${escapeHtml(sessionUser.username)} (${
						isPaid ? "paid_user" : "free"
					})
				</span>
			</div>
			<p class="site-muted" style="margin-top:0;">
				Upload a clear screenshot of your completed payment showing the transaction/reference number.
			</p>
			<div id="upgrade-payment-uploader"></div>
		</section>
	`
		: renderInlineAuthCard(
				"Sign In Before Uploading Your Payment Screenshot",
				"Please sign in (or create an account) first so we know which account to upgrade to paid_user once your payment screenshot is verified."
			);

	const bodyHtml = `
		<section class="site-card">
			<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
				<div>
					<h1 style="margin:0 0 8px;font-size:1.85rem;">Upgrade to Paid Plan</h1>
					<p class="site-muted" style="margin:0;">
						Complete your payment via our local payment gateway below, then upload your payment transaction screenshot for verification.
					</p>
				</div>
				<a href="/account" class="site-btn">← Back to Account</a>
			</div>

			<div class="acct-grid" style="margin-top:22px;">
				<div>
					<h2 style="margin:0 0 10px;font-size:1.2rem;">${escapeHtml(
						gateway.gatewayName
					)}</h2>
					<div class="gateway-box" id="local-payment-gateway-details">${escapeHtml(
						gateway.gatewayDetails
					)}</div>
				</div>
				<div>
					<h2 style="margin:0 0 10px;font-size:1.2rem;">How to Upload Your Payment Screenshot</h2>
					<div class="instructions-box" id="payment-upload-instructions">${escapeHtml(
						gateway.uploadInstructions
					)}</div>
				</div>
			</div>
		</section>

		${uploaderSectionHtml}
	`;

	const mountUploaderJs = `
${PAYMENT_UPLOAD_JS}
${INLINE_AUTH_WIDGET_JS}
(function() {
	if (window.PaymentScreenshotUploader && document.getElementById("upgrade-payment-uploader")) {
		window.PaymentScreenshotUploader.mount("#upgrade-payment-uploader");
	}
})();
`;

	const html = renderShellPage({
		title: "Upgrade Plan",
		description:
			"Local payment gateway details and payment transaction screenshot upload.",
		theme,
		activePath: "/upgrade",
		cmsLinks: cmsPagesToNavItems(cmsPages),
		bodyHtml,
		extraCss: USER_PAGES_CSS + "\n" + PAYMENT_UPLOAD_CSS,
		extraScriptsHtml: `<script>${mountUploaderJs}</script>`
	});

	return new Response(html, {
		status: 200,
		headers: {
			"Content-Type": "text/html; charset=UTF-8",
			"Cache-Control": "no-store"
		}
	});
}
