/*
 * Modular Payment Gateway & Screenshot Verification (`src/modules/payments.ts`)
 *
 * Implements Requirements #1, #2 (gateway backend), and #4 (admin paginated
 * screenshot review, transaction-number verification, and DB promotion to
 * `paid_user`) without coupling to the video studio engine.
 */

export const CONFIG_PAYMENT_GATEWAY_KEY = "config:payment_gateway";
export const PAYMENT_META_PREFIX = "payment:";
export const PAYMENT_IMAGE_PREFIX = "payment_img:";
export const PAYMENT_TXN_PREFIX = "payment_txn:";
export const MAX_PAYMENT_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MiB

export interface PaymentGatewayConfig {
	gatewayName: string;
	gatewayDetails: string;
	uploadInstructions: string;
	updatedAt: string;
}

export interface PaymentTransactionRecord {
	id: string;
	username: string;
	email: string;
	mimeType: string;
	fileName: string;
	fileSize: number;
	userNote: string;
	status: "pending" | "approved";
	transactionNumber: string;
	createdAt: string;
	approvedAt: string | null;
}

export interface SessionAccountUser {
	username: string;
	email: string;
	usertype: string;
}

export const DEFAULT_PAYMENT_GATEWAY: PaymentGatewayConfig = {
	gatewayName: "Local Payment Gateway",
	gatewayDetails:
		"Bank / E-Wallet Transfer\nAccount Name: Studio Billing\nAccount / Mobile Number: Set your local payment gateway details in the Site Configuration page.\nPlan Upgrade: Paid Plan (paid_user — 1,200 AI images/day)",
	uploadInstructions:
		"1. Send your payment using the Local Payment Gateway details listed above.\n" +
		"2. Take a clear screenshot of the completed payment confirmation showing the transaction/reference number.\n" +
		"3. Upload your payment transaction screenshot below and click Upload Payment Screenshot.\n" +
		"4. Once our site admin verifies the transaction number on your screenshot, your account will be upgraded to paid_user automatically.",
	updatedAt: ""
};

function payJson(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

function randomHex(byteCount: number): string {
	const arr = crypto.getRandomValues(new Uint8Array(byteCount));
	return Array.from(arr)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/*
 * Reverse-timestamp ID so KV `list({ prefix: "payment:" })` yields newest
 * submissions first in lexicographic order without scanning all records.
 */
function createSortablePaymentId(): string {
	const rev = Math.max(0, 9999999999999 - Date.now());
	return "pay-" + String(rev).padStart(13, "0") + "-" + randomHex(4);
}

export function detectImageMime(bytes: Uint8Array): string | null {
	if (!bytes || bytes.length < 12) return null;

	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "image/png";
	}

	// JPEG: FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}

	// GIF: GIF87a or GIF89a
	if (
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38 &&
		(bytes[4] === 0x37 || bytes[4] === 0x39) &&
		bytes[5] === 0x61
	) {
		return "image/gif";
	}

	// WEBP: RIFF....WEBP
	if (
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "image/webp";
	}

	return null;
}

function bytesToBase64(bytes: Uint8Array): string {
	const chunkSize = 0x8000;
	const parts: string[] = [];
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const slice = bytes.subarray(i, i + chunkSize);
		parts.push(String.fromCharCode(...slice));
	}
	return btoa(parts.join(""));
}

function base64ToBytes(b64: string): Uint8Array {
	const cleaned = b64.replace(/\s+/g, "");
	const bin = atob(cleaned);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		out[i] = bin.charCodeAt(i);
	}
	return out;
}

export async function readPaymentGatewayConfig(env: {
	KV_BINDING?: KVNamespace;
}): Promise<PaymentGatewayConfig> {
	if (!env || !env.KV_BINDING) {
		return { ...DEFAULT_PAYMENT_GATEWAY };
	}
	try {
		const raw = await env.KV_BINDING.get(CONFIG_PAYMENT_GATEWAY_KEY);
		if (!raw) return { ...DEFAULT_PAYMENT_GATEWAY };
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") {
			return { ...DEFAULT_PAYMENT_GATEWAY };
		}
		const gatewayName =
			String(parsed.gatewayName ?? "").trim().slice(0, 120) ||
			DEFAULT_PAYMENT_GATEWAY.gatewayName;
		const gatewayDetails =
			String(parsed.gatewayDetails ?? "").trim().slice(0, 8000) ||
			DEFAULT_PAYMENT_GATEWAY.gatewayDetails;
		const uploadInstructions =
			String(parsed.uploadInstructions ?? "").trim().slice(0, 4000) ||
			DEFAULT_PAYMENT_GATEWAY.uploadInstructions;
		return {
			gatewayName,
			gatewayDetails,
			uploadInstructions,
			updatedAt: String(parsed.updatedAt ?? "")
		};
	} catch {
		return { ...DEFAULT_PAYMENT_GATEWAY };
	}
}

async function parseUploadedScreenshotRequest(request: Request): Promise<
	| {
			ok: true;
			bytes: Uint8Array;
			fileName: string;
			userNote: string;
	  }
	| { ok: false; status: number; error: string }
> {
	const contentType = (
		request.headers.get("Content-Type") || ""
	).toLowerCase();

	if (contentType.includes("multipart/form-data")) {
		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			return { ok: false, status: 400, error: "Invalid multipart form data." };
		}

		const fileEntry =
			form.get("screenshot") || form.get("file") || form.get("image");
		if (!fileEntry || typeof fileEntry === "string") {
			return {
				ok: false,
				status: 400,
				error: "Please select a payment transaction screenshot image to upload."
			};
		}

		const file = fileEntry as File;
		if (file.size === 0) {
			return { ok: false, status: 400, error: "Uploaded image file is empty." };
		}
		if (file.size > MAX_PAYMENT_IMAGE_BYTES) {
			return {
				ok: false,
				status: 413,
				error: "Screenshot image is too large (maximum 5 MB)."
			};
		}

		const bytes = new Uint8Array(await file.arrayBuffer());
		const userNote = String(form.get("userNote") ?? form.get("note") ?? "")
			.trim()
			.slice(0, 300);
		const fileName = String(file.name || "screenshot.png")
			.replace(/[^\w.\- ]+/g, "_")
			.slice(0, 120);

		return { ok: true, bytes, fileName, userNote };
	}

	// JSON base64 / dataUrl support for programmatic callers
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return {
			ok: false,
			status: 400,
			error: "Expected multipart/form-data or JSON upload payload."
		};
	}

	const rawData = String(
		body.dataUrl ?? body.imageBase64 ?? body.data ?? ""
	).trim();
	if (!rawData) {
		return {
			ok: false,
			status: 400,
			error: "Please provide a payment transaction screenshot image."
		};
	}

	const commaIdx = rawData.indexOf(",");
	const base64Part =
		rawData.startsWith("data:") && commaIdx !== -1
			? rawData.slice(commaIdx + 1)
			: rawData;

	const maxBase64Chars = Math.ceil((MAX_PAYMENT_IMAGE_BYTES * 4) / 3) + 4096;
	if (base64Part.length > maxBase64Chars) {
		return {
			ok: false,
			status: 413,
			error: "Screenshot image is too large (maximum 5 MB)."
		};
	}

	let bytes: Uint8Array;
	try {
		bytes = base64ToBytes(base64Part);
	} catch {
		return { ok: false, status: 400, error: "Invalid base64 image data." };
	}

	if (bytes.length === 0) {
		return { ok: false, status: 400, error: "Uploaded image file is empty." };
	}
	if (bytes.length > MAX_PAYMENT_IMAGE_BYTES) {
		return {
			ok: false,
			status: 413,
			error: "Screenshot image is too large (maximum 5 MB)."
		};
	}

	const fileName = String(body.fileName || "screenshot.png")
		.replace(/[^\w.\- ]+/g, "_")
		.slice(0, 120);
	const userNote = String(body.userNote ?? body.note ?? "")
		.trim()
		.slice(0, 300);

	return { ok: true, bytes, fileName, userNote };
}

async function serveStoredPaymentImage(
	env: { KV_BINDING?: KVNamespace },
	paymentId: string
): Promise<Response> {
	if (!env || !env.KV_BINDING) {
		return payJson({ success: false, error: "Storage not configured" }, 503);
	}
	const raw = await env.KV_BINDING.get(PAYMENT_IMAGE_PREFIX + paymentId);
	if (!raw) {
		return payJson({ success: false, error: "Image not found" }, 404);
	}
	try {
		const parsed = JSON.parse(raw) as { mimeType?: string; data?: string };
		const bytes = base64ToBytes(String(parsed.data || ""));
		const detected = detectImageMime(bytes) || parsed.mimeType || "image/png";
		return new Response(bytes, {
			status: 200,
			headers: {
				"Content-Type": detected,
				"Content-Length": String(bytes.length),
				"Cache-Control": "private, max-age=300",
				"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
				"X-Content-Type-Options": "nosniff"
			}
		});
	} catch {
		return payJson({ success: false, error: "Corrupted image record" }, 500);
	}
}

export async function listUserPaymentRecords(
	env: { KV_BINDING?: KVNamespace },
	username: string
): Promise<PaymentTransactionRecord[]> {
	if (!env || !env.KV_BINDING || !username) return [];
	try {
		const listed = await env.KV_BINDING.list({
			prefix: PAYMENT_META_PREFIX,
			limit: 200
		});
		const records = await Promise.all(
			listed.keys.map(async (k) => {
				try {
					const raw = await env.KV_BINDING!.get(k.name);
					return raw ? (JSON.parse(raw) as PaymentTransactionRecord) : null;
				} catch {
					return null;
				}
			})
		);
		const target = username.toLowerCase();
		return records.filter(
			(r): r is PaymentTransactionRecord =>
				Boolean(r && String(r.username || "").toLowerCase() === target)
		);
	} catch {
		return [];
	}
}

export async function handlePaymentRoutes(
	request: Request,
	url: URL,
	env: { KV_BINDING?: KVNamespace },
	configPassword: string,
	resolveSessionUser: (
		req: Request,
		e: { KV_BINDING?: KVNamespace }
	) => Promise<SessionAccountUser | null>
): Promise<Response | null> {
	const path = url.pathname;

	// 1. Public/Admin Payment Gateway Config
	if (path === "/api/config/payment-gateway") {
		if (request.method === "GET") {
			const gateway = await readPaymentGatewayConfig(env);
			return payJson({ success: true, gateway });
		}
		if (request.method === "POST") {
			const body = (await request.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			if (String(body.pw ?? "") !== configPassword) {
				return payJson({ success: false, error: "Wrong password" }, 403);
			}
			if (!env || !env.KV_BINDING) {
				return payJson(
					{
						success: false,
						error: "Payment config storage not configured (bind the KV namespace)"
					},
					503
				);
			}
			const gatewayName =
				String(body.gatewayName ?? "").trim().slice(0, 120) ||
				DEFAULT_PAYMENT_GATEWAY.gatewayName;
			const gatewayDetails = String(body.gatewayDetails ?? "")
				.trim()
				.slice(0, 8000);
			const uploadInstructions =
				String(body.uploadInstructions ?? "").trim().slice(0, 4000) ||
				DEFAULT_PAYMENT_GATEWAY.uploadInstructions;

			if (!gatewayDetails) {
				return payJson(
					{
						success: false,
						error: "Please enter the local payment gateway details."
					},
					400
				);
			}

			const updated: PaymentGatewayConfig = {
				gatewayName,
				gatewayDetails,
				uploadInstructions,
				updatedAt: new Date().toISOString()
			};

			await env.KV_BINDING.put(
				CONFIG_PAYMENT_GATEWAY_KEY,
				JSON.stringify(updated)
			);
			return payJson({ success: true, gateway: updated });
		}
		return payJson({ success: false, error: "Method not allowed" }, 405);
	}

	// 2. User Upload Payment Screenshot (`POST /api/payments/upload`)
	if (path === "/api/payments/upload" && request.method === "POST") {
		if (!env || !env.KV_BINDING) {
			return payJson(
				{
					success: false,
					error: "Payment storage not configured (bind the KV namespace)"
				},
				503
			);
		}
		const sessionUser = await resolveSessionUser(request, env);
		if (!sessionUser) {
			return payJson(
				{
					success: false,
					authenticated: false,
					error: "Please sign in to your account before uploading a payment screenshot."
				},
				401
			);
		}

		const parsed = await parseUploadedScreenshotRequest(request);
		if (!parsed.ok) {
			return payJson({ success: false, error: parsed.error }, parsed.status);
		}

		const mimeType = detectImageMime(parsed.bytes);
		if (!mimeType) {
			return payJson(
				{
					success: false,
					error:
						"Unsupported file format. Please upload a PNG, JPG, WEBP or GIF screenshot image."
				},
				400
			);
		}

		const id = createSortablePaymentId();
		const record: PaymentTransactionRecord = {
			id,
			username: sessionUser.username,
			email: sessionUser.email || "",
			mimeType,
			fileName: parsed.fileName,
			fileSize: parsed.bytes.length,
			userNote: parsed.userNote,
			status: "pending",
			transactionNumber: "",
			createdAt: new Date().toISOString(),
			approvedAt: null
		};

		await env.KV_BINDING.put(
			PAYMENT_IMAGE_PREFIX + id,
			JSON.stringify({
				mimeType,
				data: bytesToBase64(parsed.bytes)
			})
		);
		await env.KV_BINDING.put(PAYMENT_META_PREFIX + id, JSON.stringify(record));

		return payJson({
			success: true,
			payment: record
		});
	}

	// 3. User's Own Payment Submissions (`GET /api/payments/my`)
	if (path === "/api/payments/my" && request.method === "GET") {
		if (!env || !env.KV_BINDING) {
			return payJson({ success: true, payments: [] });
		}
		const sessionUser = await resolveSessionUser(request, env);
		if (!sessionUser) {
			return payJson(
				{ success: false, authenticated: false, error: "Not signed in" },
				401
			);
		}
		const payments = await listUserPaymentRecords(env, sessionUser.username);
		return payJson({ success: true, payments });
	}

	// 4. User's Own Uploaded Image (`GET /api/payments/image/:id`)
	const userImgMatch = path.match(/^\/api\/payments\/image\/(pay-[a-z0-9-]+)$/);
	if (userImgMatch && request.method === "GET") {
		if (!env || !env.KV_BINDING) {
			return payJson({ success: false, error: "Storage not configured" }, 503);
		}
		const sessionUser = await resolveSessionUser(request, env);
		if (!sessionUser) {
			return payJson({ success: false, error: "Not signed in" }, 401);
		}
		const id = userImgMatch[1];
		const metaRaw = await env.KV_BINDING.get(PAYMENT_META_PREFIX + id);
		if (!metaRaw) {
			return payJson({ success: false, error: "Payment not found" }, 404);
		}
		let meta: PaymentTransactionRecord;
		try {
			meta = JSON.parse(metaRaw) as PaymentTransactionRecord;
		} catch {
			return payJson({ success: false, error: "Corrupted payment record" }, 500);
		}
		if (
			String(meta.username || "").toLowerCase() !==
			sessionUser.username.toLowerCase()
		) {
			return payJson({ success: false, error: "Forbidden" }, 403);
		}
		return serveStoredPaymentImage(env, id);
	}

	// 5. Admin Paginated Payment Screenshots (`GET /api/config/payments`)
	if (path === "/api/config/payments" && request.method === "GET") {
		if (url.searchParams.get("pw") !== configPassword) {
			return payJson({ success: false, error: "Wrong password" }, 403);
		}
		if (!env || !env.KV_BINDING) {
			return payJson(
				{
					success: false,
					error: "Payment storage not configured (bind the KV namespace)"
				},
				503
			);
		}

		const requestedPage = Math.max(
			1,
			parseInt(url.searchParams.get("page") || "1", 10) || 1
		);
		const limit = Math.min(
			24,
			Math.max(1, parseInt(url.searchParams.get("limit") || "5", 10) || 5)
		);
		const statusFilter = (
			url.searchParams.get("status") || "all"
		).toLowerCase();

		const listed = await env.KV_BINDING.list({
			prefix: PAYMENT_META_PREFIX,
			limit: 500
		});

		let items: Array<
			PaymentTransactionRecord & {
				accountUsertype: string;
				imageUrl: string;
			}
		> = [];

		if (statusFilter === "all") {
			const total = listed.keys.length;
			const totalPages = Math.max(1, Math.ceil(total / limit));
			const safePage = Math.min(requestedPage, totalPages);
			const sliceKeys = listed.keys.slice(
				(safePage - 1) * limit,
				safePage * limit
			);

			const loaded = await Promise.all(
				sliceKeys.map(async (k) => {
					try {
						const raw = await env.KV_BINDING!.get(k.name);
						return raw ? (JSON.parse(raw) as PaymentTransactionRecord) : null;
					} catch {
						return null;
					}
				})
			);

			const validRecords = loaded.filter(
				(r): r is PaymentTransactionRecord => r !== null
			);

			items = await Promise.all(
				validRecords.map(async (rec) => {
					let accountUsertype = "free";
					try {
						const uRaw = await env.KV_BINDING!.get(
							"user:" + String(rec.username || "").toLowerCase()
						);
						if (uRaw) {
							const uParsed = JSON.parse(uRaw);
							accountUsertype =
								String(uParsed.usertype || "").toLowerCase() === "paid_user"
									? "paid_user"
									: "free";
						}
					} catch {
						accountUsertype = "free";
					}
					return {
						...rec,
						accountUsertype,
						imageUrl:
							"/api/config/payments/image/" +
							encodeURIComponent(rec.id) +
							"?pw=" +
							encodeURIComponent(configPassword)
					};
				})
			);

			return payJson({
				success: true,
				items,
				pagination: {
					page: safePage,
					limit,
					total,
					totalPages,
					hasPrev: safePage > 1,
					hasNext: safePage < totalPages
				}
			});
		}

		// Filtered by status (`pending` or `approved`)
		const allLoaded = (
			await Promise.all(
				listed.keys.map(async (k) => {
					try {
						const raw = await env.KV_BINDING!.get(k.name);
						return raw ? (JSON.parse(raw) as PaymentTransactionRecord) : null;
					} catch {
						return null;
					}
				})
			)
		).filter(
			(r): r is PaymentTransactionRecord =>
				Boolean(r && r.status === statusFilter)
		);

		const total = allLoaded.length;
		const totalPages = Math.max(1, Math.ceil(total / limit));
		const safePage = Math.min(requestedPage, totalPages);
		const pageSlice = allLoaded.slice(
			(safePage - 1) * limit,
			safePage * limit
		);

		items = await Promise.all(
			pageSlice.map(async (rec) => {
				let accountUsertype = "free";
				try {
					const uRaw = await env.KV_BINDING!.get(
						"user:" + String(rec.username || "").toLowerCase()
					);
					if (uRaw) {
						const uParsed = JSON.parse(uRaw);
						accountUsertype =
							String(uParsed.usertype || "").toLowerCase() === "paid_user"
								? "paid_user"
								: "free";
					}
				} catch {
					accountUsertype = "free";
				}
				return {
					...rec,
					accountUsertype,
					imageUrl:
						"/api/config/payments/image/" +
						encodeURIComponent(rec.id) +
						"?pw=" +
						encodeURIComponent(configPassword)
				};
			})
		);

		return payJson({
			success: true,
			items,
			pagination: {
				page: safePage,
				limit,
				total,
				totalPages,
				hasPrev: safePage > 1,
				hasNext: safePage < totalPages
			}
		});
	}

	// 6. Admin Serve Payment Screenshot Image (`GET /api/config/payments/image/:id`)
	const adminImgMatch = path.match(
		/^\/api\/config\/payments\/image\/(pay-[a-z0-9-]+)$/
	);
	if (adminImgMatch && request.method === "GET") {
		if (url.searchParams.get("pw") !== configPassword) {
			return payJson({ success: false, error: "Wrong password" }, 403);
		}
		return serveStoredPaymentImage(env, adminImgMatch[1]);
	}

	// 7. Admin Verify Transaction Number & Approve -> Upgrade User to `paid_user`
	if (path === "/api/config/payments/approve" && request.method === "POST") {
		const body = (await request.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		if (String(body.pw ?? "") !== configPassword) {
			return payJson({ success: false, error: "Wrong password" }, 403);
		}
		if (!env || !env.KV_BINDING) {
			return payJson(
				{
					success: false,
					error: "User storage not configured (bind the KV namespace)"
				},
				503
			);
		}

		const id = String(body.id ?? "").trim();
		const transactionNumber = String(body.transactionNumber ?? "")
			.trim()
			.slice(0, 120);

		if (!/^pay-[a-z0-9-]+$/.test(id)) {
			return payJson({ success: false, error: "Invalid payment ID." }, 400);
		}
		if (!transactionNumber) {
			return payJson(
				{
					success: false,
					error:
						"Enter the verified transaction number from the screenshot before approving."
				},
				400
			);
		}

		const metaRaw = await env.KV_BINDING.get(PAYMENT_META_PREFIX + id);
		if (!metaRaw) {
			return payJson(
				{ success: false, error: "Payment transaction not found." },
				404
			);
		}

		let payment: PaymentTransactionRecord;
		try {
			payment = JSON.parse(metaRaw) as PaymentTransactionRecord;
		} catch {
			return payJson(
				{ success: false, error: "Corrupted payment transaction record." },
				500
			);
		}
		const txnKey =
			PAYMENT_TXN_PREFIX + transactionNumber.toLowerCase().replace(/\s+/g, "");
		const existingTxnRaw = await env.KV_BINDING.get(txnKey);
		if (existingTxnRaw) {
			try {
				const existingTxn = JSON.parse(existingTxnRaw) as { paymentId?: string };
				if (existingTxn.paymentId && existingTxn.paymentId !== id) {
					return payJson(
						{
							success: false,
							error: `Transaction number "${transactionNumber}" was already used to approve another payment.`
						},
						409
					);
				}
			} catch {
				// ignore malformed index entry
			}
		}

		const userKey = "user:" + String(payment.username || "").toLowerCase();
		const userRaw = await env.KV_BINDING.get(userKey);
		if (!userRaw) {
			return payJson(
				{
					success: false,
					error: `Account "${payment.username}" was not found in database.`
				},
				404
			);
		}

		let userRecord: Record<string, unknown>;
		try {
			userRecord = JSON.parse(userRaw) as Record<string, unknown>;
		} catch {
			return payJson(
				{ success: false, error: "Corrupted user account record." },
				500
			);
		}
		userRecord.usertype = "paid_user";
		userRecord.upgradedAt = new Date().toISOString();
		userRecord.verifiedTransactionNumber = transactionNumber;
		userRecord.updatedAt = userRecord.upgradedAt;
		if (!userRecord.username) {
			userRecord.username = String(payment.username || "");
		}
		/*
		 * The account row is the source of truth for both the email
		 * and the plan, so a row written by an older build is
		 * completed from the payment record while we are here.
		 */
		const accountEmail = String(
			userRecord.email || payment.email || ""
		)
			.trim()
			.toLowerCase();
		if (accountEmail) {
			userRecord.email = accountEmail;
		}

		await env.KV_BINDING.put(userKey, JSON.stringify(userRecord));

		/*
		 * Mirror the new plan into the email index, which stores the
		 * same { username, email, usertype } triple as the user row.
		 */
		if (accountEmail) {
			await env.KV_BINDING.put(
				"email:" + accountEmail,
				JSON.stringify({
					username: String(userRecord.username || payment.username || ""),
					email: accountEmail,
					usertype: "paid_user"
				})
			);
		}

		payment.status = "approved";
		payment.transactionNumber = transactionNumber;
		payment.approvedAt = new Date().toISOString();

		await env.KV_BINDING.put(PAYMENT_META_PREFIX + id, JSON.stringify(payment));
		await env.KV_BINDING.put(
			txnKey,
			JSON.stringify({
				paymentId: id,
				username: payment.username,
				transactionNumber,
				approvedAt: payment.approvedAt
			})
		);

		return payJson({
			success: true,
			payment,
			user: {
				username: String(userRecord.username || payment.username),
				email: String(userRecord.email || payment.email || ""),
				usertype: "paid_user"
			}
		});
	}

	return null;
}
