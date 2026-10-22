# Bug Fix Session #206

**Date:** 2026-10-22
**Branch:** `arena/0b6124f3-text-to-image-template`
**Scope:** plan-based URL access, freemium (`/free`) entry, per-IP guest credits, and the guest
credits table.

This session continues the daily-credits work from Bug Fix Session #205 (`system-rules.md`
RULE 20). It adds a **third actor type** — a visitor with no account — and gives that visitor a
free, metered slice of the studio behind a dedicated URL.

---

## 1. What was asked

1. Add user-type-based URL restrictions.
2. Add freemium app access at **`/free`**.
3. A visitor who is **not logged in** gets:
   - **10 AI image generations per day**,
   - **unlimited AI script generation**,
   - **unlimited app use** (video projects, voiceovers, rendering).
4. Free/guest credit counts are **based on the IP address**.
5. Keep a **table that tracks credits per IP address**.
6. Document everything in the Markdown docs under the name **Bug Fix Session #206**.

---

## 2. The actor model

| Actor | Who | Credits key | Daily image limit |
| --- | --- | --- | --- |
| `anonymous` | no session, no `/free` cookie | none (blocked from metered routes) | 0 |
| `guest` | no session, came through `/free` | `ipcredits:<sha256(ip)>` | **10** |
| `free` (a.k.a. `free_user`) | signed-in account, default `usertype` | `credits:<username>` | **50** |
| `paid_user` | signed-in account promoted by an operator | `credits:<username>` | **1,200** |

`guest` is an **actor type, not an assignable plan**. `GET|POST /api/config/users` still only
accepts `free` and `paid_user`; any other value is a `400`.

Scripts, voiceovers and video projects stay **unlimited for every actor**, including `guest`.
The counters are recorded for the settings table but never block a request.

---

## 3. URL access matrix

Implemented by `PLAN_MODE_BY_ROUTE` + `appPageResponse()` in `src/index.ts` (RULE 21).

| Route | anonymous | `free` | `paid_user` | Notes |
| --- | --- | --- | --- | --- |
| `GET /` | ✅ | ✅ | ✅ | Marketing landing + studio entry gate |
| `GET /free` | ✅ | ✅ | ✅ | Freemium studio shell, sets `yvs_free=1` |
| `GET /studio` | ↪ `/free` | ✅ | ✅ | Account studio shell |
| `GET /paid` | ↪ `/free` | ↪ `/studio` | ✅ | Paid-tier entry (same shell today) |
| `GET /image/:i` | ✅ | ✅ | ✅ | Two fixed demo prompts, unmetered |
| `GET /image/gen` | ⛔ 401 unless `/free` cookie → 10/day/IP | 50/day | 1,200/day | The only metered route |
| `POST /api/script` | ✅ unlimited | ✅ unlimited | ✅ unlimited | Usage counted when identifiable |
| `POST /api/voiceover` | ✅ unlimited | ✅ unlimited | ✅ unlimited | Usage counted when identifiable |
| `POST /api/render` | ✅ (needs KV) | ✅ | ✅ | No credential change |
| `GET /api/credits` | ✅ guest summary after `/free` | ✅ | ✅ | `401` for a cold anonymous visitor |
| `GET /api/config/theme`, `GET /api/config/workers` | ✅ open | ✅ open | ✅ open | Read-only operator settings |
| `POST /api/config/theme`, `POST /api/config/workers`, `GET\|POST /api/config/users`, `GET\|POST /api/config/ipcredits` | password | password | password | Operator surface, `403` on a wrong/missing `pw` |

The `/free` route returns `200` for signed-in users too: the shell detects the session and keeps
the account's plan, which makes `/free` a safe "try it" link for everybody.

**Why a redirect instead of a 403:** the studio is a client-side shell, so a URL gate is a
navigation boundary, not a security boundary. The real enforcement is the credits gate on
`/image/gen` (and the session checks on the account APIs). Redirecting guests to `/free` keeps
the product usable instead of showing an error page.

---

## 4. The `/free` entry and the guest cookie

```
GET /free
  → 200 text/html
  → Set-Cookie: yvs_free=1; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400
  → <script>window.__PLAN_MODE = "freemium";</script> in front of the app bundle
```

- The cookie is the **freemium marker**: an anonymous `/image/gen` without it is `401`;
  with it the request spends from the IP bucket. It cannot be used to escape the limit —
  clearing it just re-locks the route, and the counters are keyed by IP, not by the cookie.
- The cookie is `HttpOnly` (the client never needs to read it) and scoped to `/`.
- `/free` is not a second app: it is the same cached HTML (`createHTML()`), theme included,
  plus the `window.__PLAN_MODE` hint. No extra render cost beyond the existing theme read.
- `window.__PLAN_MODE` values: `freemium` (`/free`), `studio` (`/studio`), `paid` (`/paid`).
  The landing at `/` has no marker (`""`).

---

## 5. Per-IP credit table (the "db ops" part)

### 5.1 Key

```
ipcredits:<hash>
hash = sha256("yvs-guest:" + ip).hex.slice(0, 40)
```

- `ip` comes from `CF-Connecting-IP` (Cloudflare), then the first hop of `X-Forwarded-For`,
  then the literal `"unknown"` (local dev / harnesses without a socket address).
- The app salt `yvs-guest:` is fixed; the hash is stable across requests but cannot be
  reversed to an address without a dictionary of the whole IPv4 space.
- Requests with no identifiable address share one `unknown` bucket. That is deliberate:
  it fails closed (10 images total) instead of failing open.

### 5.2 Record shape

`ipcredits:<hash>` (TTL **2 days**) mirrors the account record so the same parser, summary and
lazy reset are reused:

```json
{
  "day": "2026-10-22",
  "videos": 0,
  "images": 7,
  "scripts": 3,
  "voiceovers": 2,
  "updatedAt": "2026-10-22T07:13:45.000Z",
  "ip": "203.0.113.0",
  "maskedIp": "203.0.113.0",
  "hash": "91e66ae50785edb77e83125540f281d3691dcf5f",
  "scope": "ip"
}
```

- `day` is the authoritative Asia/Taipei date (UTC+8). A record written on an earlier day
  parses back as zeros and is rewritten by the next consume — the same lazy rollover as
  account credits, no scheduled Worker.
- Only the **masked** address is stored (`203.0.113.0`, `2001:db8:1:2::`); the raw address is
  never written to KV.
- Guest records are written only when someone actually generates/transcribes, so an idle
  crawler does not create rows.
- The identity fields survive a failed generation: the refund path re-merges them after the
  counter update (fixed in **Bug Fix Session #211**, `bug-fix-session-211.md` §2). Before that
  fix, a model error rewrote the row as counters only and the table lost its masked address.

### 5.3 Operator table

`GET /api/config/ipcredits?pw=…` returns up to 50 rows for the settings page:

```json
{
  "success": true,
  "day": "2026-10-22",
  "resetsAt": "2026-10-22T16:00:00.000Z",
  "plan": { "id": "guest", "label": "Guest", "limits": { "images": 10, "videos": null, "scripts": null, "voiceovers": null } },
  "rows": [
    {
      "key": "ipcredits:91e66ae50785edb77e83125540f281d3691dcf5f",
      "ip": "203.0.113.0",
      "hash": "91e66ae50785edb77e83125540f281d3691dcf5f",
      "day": "2026-10-22",
      "used": { "videos": 0, "images": 10, "scripts": 3, "voiceovers": 2 },
      "remaining": { "videos": null, "images": 0, "scripts": null, "voiceovers": null },
      "updatedAt": "2026-10-22T07:13:45.000Z"
    }
  ]
}
```

`POST /api/config/ipcredits {pw, key}` deletes one row (operator "Reset"), so the next request
from that address starts at zero. Both methods are password-gated (`403`) and KV-gated (`503`).

The settings page renders this as the **Guest credits by IP** table
(`.cfg-table`: masked IP · Images · Scripts · Voiceovers · Left today · Last seen · Reset),
hidden in background-worker mode like every other operator group.

---

## 6. API changes

### `GET /free`
- **All actors.** Serves the studio shell with `window.__PLAN_MODE = "freemium"` and sets
  `yvs_free=1` (1 day).
- Cache: `no-store`.

### `GET /studio`
- **Session required.** Anonymous → `302 Location: /free`.
- `window.__PLAN_MODE = "studio"`.

### `GET /paid`
- **`paid_user` required.** Anonymous → `302 /free`; `free` → `302 /studio`.
- `window.__PLAN_MODE = "paid"`.

### `GET /image/gen?prompt=&variant=`
Resolution order:

1. **Session** → consume from `credits:<username>` with the account plan (50 / 1,200).
2. **No session, `yvs_free=1`** → consume from `ipcredits:<hash>` with the guest plan (10).
3. **No session, no cookie** → `401`:
   `"Sign in to generate AI images — every free account gets 50 images per day. No account? Open /free for 10 images per day."`
4. **KV unbound** → open-access mode, unchanged (no gate, no counting).

At the limit: `429` with the authoritative counters and, for a guest, the extra sentence
`"Create a free account for 50 images per day."`

Success headers are unchanged, plus `X-Credit-Scope: account | ip`
(`guest` responses also report `X-Credit-Plan: guest` and `X-Credit-Images-Limit: 10`).

A failed model call refunds the credit for both account and guest keys.

### `GET /api/credits`
- Account: unchanged.
- Guest (`yvs_free=1`, no session): `200` with
  `{usertype:"guest", plan, day, resetsAt, used, remaining, authenticated:false, guest:true, scope:"ip", ip:"203.0.113.0", user:null}`.
- Cold anonymous: still `401`.

### `POST /api/script` · `POST /api/voiceover`
- Unchanged behavior (always allowed, including anonymous).
- Signed-in usage books against the account record; guest usage books against the IP record.
- Best effort: a credits failure can never fail the route, and no limit is enforced for
  `scripts`/`voiceovers` on any plan.

### `GET|POST /api/config/ipcredits`
New operator routes described in §5.3.

---

## 7. Client behavior

- `PLAN_MODE = window.__PLAN_MODE || ""` is read once at boot in `src/client/app-js.ts`.
- `initAuth()` still calls `GET /api/session` first:
  - `200` → normal signed-in studio (works on `/free` too, so a guest can sign in without
    losing the page).
  - `401` **on `/free`** → `authAccess = "freemium"`, the landing is hidden, the studio is
    shown, and `refreshCredits()` paints the guest pill.
  - `401` elsewhere → landing, as before.
  - network error on `/free` → guest mode (never a blank page).
- Signing out of `/free` returns to guest mode and re-reads the IP counters instead of
  bouncing to the landing.
- The credits pill shows **Guest · 10 / 10 left today**; the popover adds
  **"Create a free account — 50 images/day"**, which opens the sign-up overlay.
- The pre-submit quota check and the `429` handler both add the upgrade sentence in
  freemium mode.
- The auth overlay gained **"No account? Open the free studio — 10 AI images a day, counted
  per IP address."** with a link to `/free`.
- Landing page:
  - nav link **Free studio** → `/free`,
  - a line under the plans: "No account yet? **Open the free studio** — 10 AI images a day,
    counted per IP address.",
  - footer link **Try the free studio**.
- The landing and `/free` keep using the active theme (`html[data-theme]` tokens from RULE 19/20);
  no new palette was introduced.

---

## 8. Privacy and abuse notes

- **No raw IP storage.** Only a salted SHA-256 prefix and the masked network are stored.
  The masked value is what the operator table displays.
- **Shared networks share a bucket.** A school, office or carrier NAT gets 10 images per day
  for the whole egress address. This is the intended trade-off for a no-signup tier; a
  signed-in account is the upgrade path and is advertised in the pill and the `429` body.
- **The cookie is a marker, not a credential.** It only decides whether anonymous requests
  may spend from the IP bucket; the bucket itself follows the address.
- **KV is eventually consistent.** Two requests can read the same counter and overshoot by
  the number of in-flight requests, for guests and accounts alike. Bounded, and corrected at
  the daily reset. See `kv-scale-test.md`.
- **The password gate is a shared constant.** `/api/config/*` remains an operator tool for a
  trusted instance, not a multi-tenant billing console (documented in `bug-audit.md` #5).

---

## 9. Verification

All suites are mock-KV harnesses that import the real worker bundle
(`esbuild src/index.ts --bundle --format=cjs`) — no network, no Workers AI.

| Suite | Checks | Result |
| --- | --- | --- |
| `test-worker.cjs` (existing end-to-end credits flow) | 43 | ✅ |
| `test-credits.cjs` (account plans, 429, refund, rollover, config users) | 11 | ✅ |
| `test-legacy.cjs` (pre-credits accounts, `free_user` alias, bad plans) | 8 | ✅ |
| **`test-guest.cjs` (this session: `/free`, IP metering, table, URL gates)** | **15** | ✅ |
| **Total** | **77** | ✅ |

Guest suite coverage:

1. `/free` serves the shell, sets the cookie, injects `__PLAN_MODE`.
2. Anonymous `/image/gen` without the cookie → `401` naming `/free`.
3. First guest image → `200`, `X-Credit-Plan: guest`, limit 10, remaining 9, scope `ip`.
4. The 11th image on that IP → `429` + upgrade sentence + counters at zero.
5. A second IP keeps its own 10.
6. `/api/credits` returns the guest plan, masked IP and no session.
7. Scripts (×3) and voiceovers never 429 and are counted; videos/scripts/voiceovers stay unlimited.
8. `GET /api/config/ipcredits` lists masked rows, 40-hex hash, usage and remaining; the raw
   address never appears anywhere in the payload.
9. The table requires the password.
10. `POST /api/config/ipcredits` deletes a row.
11. `/studio` for a guest → `302 /free`.
12. `/studio` for a signed-in free user → `200` with `__PLAN_MODE = "studio"`.
13. `/paid`: free → `302 /studio`; paid → `200` with `__PLAN_MODE = "paid"`.
14. Accounts keep their own allowances (`paid_user`, scope `account`, limit 1,200).
15. No IP header → the `unknown` bucket.

`npx tsc` output is **byte-identical to the clean-`main` baseline**: 48 errors, same messages
(the repository's pre-existing strictness debt — `bug-audit.md` #11). No new type errors.

Live smoke test on `wrangler dev --local` (port 8787):

| Request | Result |
| --- | --- |
| `GET /free` | `200`, 708,161 B, `Set-Cookie: yvs_free=1`, `__PLAN_MODE = "freemium"` |
| `GET /studio` (anonymous) | `302 Location: /free` |
| `GET /paid` (anonymous) | `302 Location: /free` |
| `GET /api/credits` with cookie + `CF-Connecting-IP: 203.0.113.9` | `200`, plan `guest`, 10/10, `ip: "203.0.113.0"` |
| `GET /image/gen` (guest) | `500 "Binding AI needs to be run remotely"` locally; credit refunded (0 used afterwards) |
| `POST /api/script` + `/api/voiceover` (guest) | `500` locally (no AI); table shows `scripts:1`, `voiceovers:1` |
| `GET /api/config/ipcredits?pw=…` | `200` with the `203.0.113.0` row, hash `91e66ae5…`, raw IP absent |

UI harnesses (linkedom, the real HTML bundle):

- `/free` boot: landing hidden, studio visible, pill **Guest · 10 / 10 left today**,
  four unlimited/limited rows, **Create a free account — 50 images/day** CTA.
- Settings page: **Guest credits by IP** renders the header row and one row per IP, and
  **Reset** issues `POST /api/config/ipcredits` followed by a reload.

Known local-only limitation: `env.AI` is not available in `wrangler dev --local`, so the
success path of a real generation and its `X-Credit-*` headers cannot be observed there;
the mock harness covers it. There is no headless browser in this environment, so the visual
result is verified through the DOM harness and the CSS parse (0 errors), not by screenshot.

---

## 10. Files changed in this session

| File | Change |
| --- | --- |
| `src/index.ts` | `GUEST_PLAN`, `PLAN_MODE_BY_ROUTE`, freemium cookie, IP helpers (hash/mask), key-level credit primitives, `/free` `/studio` `/paid` routes, guest branches in `/image/gen`, `/api/credits`, `/api/script`, `/api/voiceover`, `GET\|POST /api/config/ipcredits` |
| `src/client/app-js.ts` | `PLAN_MODE`, freemium boot + logout, guest popover CTA, guest quota hint, auth-overlay guest note |
| `src/client/styles.ts` | `.auth-guest-note`, `.credit-signup`, `.landing-plans-guest` |
| `src/client/markup.ts` | nav **Free studio**, plans-section guest line, footer **Try the free studio** |
| `src/client/config-page-js.ts` | **Guest credits by IP** table + `loadGuestRows()` + reset handler |
| `README.md` | plans/limits, routes, settings page, docs index |
| `system-rules.md` | RULE 21, revision note, UI refinements |
| `userflow.md` | surface map, freemium flow |
| `bug-audit.md` | statuses + this session's section |
| `kv-scale-test.md` | guest operation counts |
| `bug-fix-session-206.md` | this document |

---

## 11. Follow-ups (not done here)

- **Real rate limiting.** The 10/day IP bucket is a product limit, not anti-abuse: an attacker
  with a pool of addresses gets 10 images per address. Cloudflare WAF/rate-limit rules are the
  right layer for that.
- **Durable counters.** KV is eventually consistent and the free plan is write-bound; see
  `kv-scale-test.md` §8. Durable Objects or D1 would make the bucket exact.
- **IPv6 granularity.** Masking to 4 groups is intentionally coarse; a subscriber usually
  controls a /64 or larger, so one bucket per /64 would be closer to "one visitor". The current
  mask is documented in `guestMaskedIp()`.
- **Paid-tier URL.** `/paid` currently serves the same studio with `__PLAN_MODE = "paid"`; it
  exists so paid-only surfaces have a natural address when they are added.
- **Failed `/api/script` still books a script.** Pre-existing behavior from Session #205
  (counters are telemetry and scripts are unlimited); safe to move after the AI call when the
  counter becomes meaningful.
