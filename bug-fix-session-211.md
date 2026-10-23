# Bug Fix Session #211

**Date:** 2026-10-23
**Branch:** `arena/0b6124f3-text-to-image-template`
**Scope:** the two **code** defects found by the 2026-10-22 documentation-vs-code audit — the
guest refund that erased the IP row's identity (§3.3) and the `GET /api/config/workers` handler
that threw when no KV binding existed (§6.1) — documented together with the 22-finding
documentation pass that found them.

Bug Fix Session #206 (`bug-fix-session-206.md`) built the freemium `/free` entry, the guest plan
and the `ipcredits:` table. The day after, the audit in `system-rules.md`
(*Documentation vs code — inconsistency register*, 2026-10-22) read every Markdown claim against
the working tree. Twenty-one of its 22 findings were prose drift; one (§3.3) was a defect in the
running Worker, and a second (§6.1) surfaced while fixing it. This session is the fix pass for
both, plus the evidence that the rest of the code was left alone.

---

## 1. What was asked

1. Treat the audit register as the work list, not as a list of opinions: fix the code defects it
   found, not only the sentences that describe them.
2. Keep the **guest refund** from destroying the guest row's `ip` / `maskedIp` / `hash` / `scope`
   fields.
3. Keep **`GET /api/config/workers`** from throwing when the Worker runs without a KV binding.
4. Record the work under the name **Bug Fix Session #211**.

---

## 2. Fix 1 — a guest refund erased the IP row's identity (§3.3)

### 2.1 What was wrong

`/image/gen` consumes one image credit **before** the model runs and refunds it when
`env.AI.run` throws. The guest path calls `creditRefundKey()`, which re-read the row with
`creditReadKey()` → `creditParseState()` and wrote the parsed state back.

`creditParseState()` only rebuilds the day, the four counters and `updatedAt`:

```json
{ "day": "…", "videos": 0, "images": 1, "scripts": 0, "voiceovers": 0, "updatedAt": "…" }
```

The guest identity (`ip`, `maskedIp`, `hash`, `scope`) lives **outside** that shape — it is
attached by `creditWriteKey()`/the consume path after parsing. So a failed generation rewrote
`ipcredits:<hash>` as a bare counter row: the settings page lost the masked address for that IP
until the next successful use, while the usage column still showed the spending.

Before (the refund lost the metadata):

```
creditRefundKey(env, creditGuest.key, "images")   // parse → decrement → put
```

### 2.2 The fix

`creditRefundKey()` now takes the identity as an optional fifth argument and merges it back
**after** the decrement and before the write:

```ts
async function creditRefundKey(
	env: any,
	key: any,
	kind: any,
	amount: any = 1,
	meta: any = null
): Promise<void> {

	const state = await creditReadKey(env, key);

	state[kind] = Math.max(0, (Number(state[kind]) || 0) - amount);
	state.updatedAt = new Date().toISOString();

	/*
	 * `creditReadKey()` rebuilds the state without the guest
	 * metadata, so the IP row must be merged back or a refund
	 * would erase the masked address the table shows.
	 */
	if (meta) {
		Object.assign(state, meta);
	}

	await creditWriteKey(env, key, state);
}
```

and the guest failure branch passes the four fields through the single helper that already
knows them:

```ts
await creditRefundKey(
	env,
	creditGuest.key,
	"images",
	1,
	guestCreditMeta(creditGuest)
);
```

`guestCreditMeta()` returns exactly the stored shape:

```json
{ "ip": "203.0.113.0", "maskedIp": "203.0.113.0",
  "hash": "fe0202870f2f0a7fcf7cefe9465a68bf9e055353", "scope": "ip" }
```

- `meta` is **opt-in** (`null` by default): the account refund (`credits:<username>`) has no
  identity fields and its behaviour is byte-for-byte unchanged.
- The only raw address in the flow is hashed; `ip` and `maskedIp` are both the masked value
  (`guestCreditIdentity()` sets `ip: masked`), so the refund cannot start persisting a raw IP.
- `Object.assign` runs after `updatedAt`, so the metadata cannot overwrite the timestamp.

### 2.3 Verification

A mock-KV harness bundles the real Worker (`esbuild src/index.ts --bundle --format=cjs`), sends a
guest request with a throwing `AI.run`, and then dumps the stored row:

```
GET /image/gen  (Cookie: yvs_free=1, CF-Connecting-IP: 203.0.113.44)
  → 500
ipcredits:fe0202870f2f0a7fcf7cefe9465a68bf9e055353
{"day":"2026-10-23","videos":0,"images":0,"scripts":0,"voiceovers":0,
 "updatedAt":"2026-10-22T16:28:07.061Z","ip":"203.0.113.0","maskedIp":"203.0.113.0",
 "hash":"fe0202870f2f0a7fcf7cefe9465a68bf9e055353","scope":"ip"}
```

The counter is back to `0` **and** the row still identifies the address. The existing
`test-credits.cjs` refund checks (account path) still pass unchanged.

---

## 3. Fix 2 — `GET /api/config/workers` threw without KV (§6.1)

### 3.1 What was wrong

RULE 16 promises the app boots without `KV_BINDING` (open-access / e2e mode), and the other
operator routes answer `503` in that mode. The workers route instead dereferenced the binding
directly:

```ts
const raw = await env.KV_BINDING.get(CONFIG_WORKERS_KEY);
```

With no binding that is a `TypeError: Cannot read properties of undefined (reading 'get')`
thrown out of `fetch()` — a Worker error (1101), not the JSON `503` every other route returns.
The theme route already self-defaulted (`"default"`), which is why the KV-less smoke test had
looked healthy until the settings page was opened: `loadWorkers()` is called on open, so the page
logged an unhandled rejection instead of rendering **None registered.**

### 3.2 The fix

Two guards, both inside the existing branches:

- **GET** returns an empty list instead of reading KV.
- **POST** returns the same storage error the render routes use, and only **after** the password
  check, so a wrong password is still a `403` and cannot probe the deployment mode.

```ts
if (request.method === "GET") {

	/*
	 * Without KV there are no stored URLs. Returning an
	 * empty list keeps the settings page usable in the
	 * KV-less (e2e) mode instead of throwing on the
	 * missing binding.
	 */
	if (!env.KV_BINDING) {
		return json({ success: true, urls: [] });
	}

	const raw = await env.KV_BINDING.get(CONFIG_WORKERS_KEY);
	…
}
…
if (!env.KV_BINDING) {
	return json(
		{ success: false, error: "User storage not configured (bind the KV namespace)" },
		503
	);
}
```

### 3.3 Why GET is `200` and POST is `503`

- `GET` is read-only and "no stored URLs" is a truthful answer in KV-less mode. The settings page
  treats a failed read as silence; a `200` renders the empty state and keeps the page usable.
  It also keeps the route's documented contract — *open, no password* — identical in both modes.
- `POST` is a write. It cannot succeed without KV, so it joins the render routes' existing
  `503 "User storage not configured (bind the KV namespace)"` wording instead of inventing a
  second failure language.

### 3.4 Verification

Bundled Worker, mock env without a KV binding (`{}`), then with one:

| Request | No KV (before) | No KV (now) | KV bound |
| --- | --- | --- | --- |
| `GET /api/config/workers` | `TypeError` → 500/1101 | **`200 {"success":true,"urls":[]}`** | `200` with the stored array |
| `POST /api/config/workers` wrong `pw` | `403` (checked before KV) | **`403 "Wrong password"`** | `403 "Wrong password"` |
| `POST /api/config/workers` correct `pw` | `TypeError` | **`503 "User storage not configured (bind the KV namespace)"`** | `200` + saved `urls` |

---

## 4. Behavioural contract after #211

| Surface | KV bound | KV unbound |
| --- | --- | --- |
| `GET /api/config/theme` | `200 {theme}` (stored or `"default"`) | `200 {theme:"default"}` (self-default, unchanged) |
| `GET /api/config/workers` | `200 {success,urls[]}` | `200 {success:true,urls:[]}` |
| `POST /api/config/workers` | `403` wrong `pw` · `200` saved | `403` wrong `pw` · `503` storage |
| `/image/gen` (guest, model error) | `500`, credit refunded, row identity intact | unmetered (no gate) |
| `/api/config/users`, `/api/config/ipcredits`, render routes | normal | `503` storage errors (unchanged) |

No request/response shape changed for a KV-bound deployment. Both fixes are local to the
failure paths.

---

## 5. Documentation updated in the same commit

| Where | Change |
| --- | --- |
| Register §3.3 | marked fixed; resolution names `creditRefundKey(…, meta)` and the harness |
| Register §6.1 | new finding + resolution (the KV-less throw was not in the original 22) |
| `system-rules.md` RULE 3 | `GET /api/config/workers` documents the KV-less `200`/`503` split |
| `system-rules.md` header | records the 2026-10-23 pass and points at this document |
| `userflow.md` §2 | route table notes the KV-less behaviour |
| `README.md` | documentation index lists this session |
| `bug-fix-session-211.md` | this document |

The 20 prose findings are recorded in the register's resolution table and in
*Additional drift found while fixing* (`system-rules.md`, end of file).

---

## 6. Verification

All suites are mock-KV harnesses that import the real Worker bundle — no network, no Workers AI.

| Suite | Checks | Result |
| --- | --- | --- |
| `test-worker.cjs` (end-to-end credits flow) | 43 | ✅ |
| `test-credits.cjs` (plans, 429, refund, rollover, config users) | 11 | ✅ |
| `test-legacy.cjs` (pre-credits accounts, alias, bad plans) | 8 | ✅ |
| `test-guest.cjs` (`/free`, IP metering, table, URL gates) | 15 | ✅ |
| **Total** | **77** | ✅ |

- `npx tsc --noEmit`: **48 errors**, the `sort -u` message set is identical to the
  clean-`main` baseline (`bug-audit.md` #11). Neither fix adds a type error.
- `createHTML()`: **708,110 B**, 2 `<script` tags, 1 `<style>` — page size unchanged by a
  server-only fix.
- Live smoke on `wrangler dev` (port 8787):

| Request | Result |
| --- | --- |
| `GET /free` | `200`, 708,161 B, `Set-Cookie: yvs_free=1`, `__PLAN_MODE = "freemium"` |
| `GET /studio` (anonymous) | `302 → /free` |
| `GET /api/credits` (guest cookie + `CF-Connecting-IP`) | `200`, `usertype:"guest"`, `scope:"ip"`, `remaining.images:10` |
| `GET /api/config/workers` | `200 {"success":true,"urls":[]}` |
| `GET /image/gen` (guest) | local `500` (AI binding is remote-only); credit refunded, identity intact |

---

## 7. Files changed in this session

| File | Change |
| --- | --- |
| `src/index.ts` | `creditRefundKey(env, key, kind, amount = 1, meta = null)` + guest call site (4 lines); KV-less guards in `GET`/`POST /api/config/workers` (30 lines) |
| `system-rules.md` | register marked resolved + §6 (additional drift); RULE 3 caveat; header revision note |
| `README.md` | documentation index |
| `userflow.md` | route table note |
| `bug-audit.md`, `kv-scale-test.md`, `bug-fix-session-206.md`, `src/page.ts` | the prose corrections from the same pass |
| `bug-fix-session-211.md` | this document |

---

## 8. Follow-ups (not done here)

- **`/image/gen` still fails open on a KV error.** The credit gate is wrapped in
  `try { … } catch { /* never block */ }`, so a KV read failure permits an unmetered generation.
  That is a deliberate availability trade-off (the pre-credits Worker had no gate at all), but if
  the quota ever becomes a billing control it should fail closed with a `503`.
- **No TTL on `session:` keys** and **no atomic claim for render jobs** are pre-existing and
  documented in `bug-audit.md` #3 and #7; this session did not touch them.
- **The register is the audit trail, not a changelog.** Future passes should append a new
  numbered session document instead of rewriting resolved entries.
