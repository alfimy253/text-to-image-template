/*
 * Bench harness (temporary) — wraps the REAL worker from ../src/index.ts and adds
 * three test-only routes so we can measure KV behaviour under load:
 *
 *   GET /__seed?n=3000   write n user records (one KV put each)
 *   GET /__stats         list("user:") → how many keys come back in one page
 *   GET /__wipe          delete every user: key
 *
 * Everything else is forwarded untouched to the production worker.
 */
import worker from "../src/index";

const SALT = "0123456789abcdef0123456789abcdef";

async function hashOf(password: string, saltHex: string) {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt: Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16))), iterations: 100000, hash: "SHA-256" },
		key,
		256
	);
	return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/__seed") {
			const n = Number(url.searchParams.get("n") || 3000);
			const from = Number(url.searchParams.get("from") || 1);
			const hash = await hashOf("password123", SALT);
			const t0 = Date.now();
			for (let i = from; i < from + n; i++) {
				await env.KV_BINDING.put(
					`user:u${i}`,
					JSON.stringify({ username: `u${i}`, email: `user${i}@example.com`, salt: SALT, hash, createdAt: "2026-01-01T00:00:00Z" })
				);
			}
			return Response.json({ seeded: n, ms: Date.now() - t0 });
		}

		if (url.pathname === "/__stats") {
			const t0 = Date.now();
			const page = await env.KV_BINDING.list({ prefix: "user:" });
			return Response.json({
				firstPageKeys: page.keys.length,
				list_complete: (page as any).list_complete,
				hasCursor: Boolean((page as any).cursor),
				ms: Date.now() - t0,
			});
		}

		if (url.pathname === "/__scan") {
			// Faithful copy of the email-uniqueness loop in /api/signup (once the
			// 7-user cap check is out of the way): 1 list + 1 get per listed user.
			const target = "nobody@example.com";
			let ops = 0;
			const t0 = Date.now();
			const list = await env.KV_BINDING.list({ prefix: "user:" });
			ops++;
			let scanned = 0;
			let hitLimit: string | null = null;
			try {
				for (const key of list.keys) {
					const raw = await env.KV_BINDING.get(key.name);
					ops++;
					scanned++;
					if (raw) {
						const existing = JSON.parse(raw);
						if (existing && existing.email === target) break;
					}
				}
			} catch (e) {
				hitLimit = (e as Error).message;
			}
			return Response.json({ listedKeys: list.keys.length, scanned, ops, ms: Date.now() - t0, hitLimit });
		}

		if (url.pathname === "/__wipe") {
			let deleted = 0;
			let cursor: string | undefined;
			do {
				const page: any = await env.KV_BINDING.list({ prefix: "user:", cursor });
				for (const k of page.keys) {
					await env.KV_BINDING.delete(k.name);
					deleted++;
				}
				cursor = page.list_complete ? undefined : page.cursor;
			} while (cursor);
			return Response.json({ deleted });
		}

		return worker.fetch(request, env, ctx) as Promise<Response>;
	},
};
