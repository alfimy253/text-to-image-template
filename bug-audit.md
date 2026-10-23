# Bug & inconsistency audit

Full repository audit originally performed 2026-10-15, including the unlimited-signup,
SEO-script and theme changes. The settings-route finding below was rechecked on 2026-10-16 to
reflect the current day-rotating URL.

**How the audit was done**

- Full read of `src/index.ts`, `src/client/app-js.ts`, `src/client/template-composer-js.ts`,
  `src/client/config-page-js.ts`, `src/client/markup.ts`, `src/page.ts`, `src/prompts.ts`,
  `wrangler*.json(c)`, `package.json`, `tsconfig.json`, `e2e/index.ts`.
- The worker was bundled and **executed** against an instrumented KV (operation counting,
  production list-page semantics) and against real workerd KV via `wrangler dev` with 3,000+
  keys — see `kv-scale-test.md`.
- `tsc` was run **before and after** the change to separate pre-existing defects from new ones.
- `esbuild` was run with warnings enabled (catches parse-level hazards such as ASI).
- Every claim below was verified by reading the exact line(s) cited, not inferred.

Severity: **S1** security/abuse · **S2** correctness/data loss · **S3** dead code / wrong
documentation · **S4** cosmetic.

**2026-10-23 — Bug Fix Session #211.** The documentation-vs-code register in `system-rules.md`
found two runtime defects, both fixed in `src/index.ts` and recorded in
`bug-fix-session-211.md`: a guest credit refund used to rewrite `ipcredits:<hash>` without the
`ip`/`maskedIp`/`hash`/`scope` fields, and `GET /api/config/workers` used to throw a `TypeError`
when the Worker ran without a KV binding. The other 20 register findings were prose drift and are
listed in that register's resolution table.

**2026-10-23 — Bug Fix Session #240.** A feature session, not an audit: the studio adopted the
chrome and the four extra skins of an uploaded `video_bulk_production` reference. No new runtime
finding in the list below was touched. It did add one *structural* fact worth recording for the
next audit: `#video-accordions` used to exist **twice** in the served markup (one empty host in
each editor column); the pre-#240 `initVideoStudio()` wrote into the first match, so the second was
dead markup. The rebuild leaves exactly one host, inside `.editor-build`, and the legacy
audio/title/caption/controls panels now live in a `display:none` `.engine-panels` block instead of
being hidden at boot by script. Record: `bug-fix-session-240.md`; new rule: `system-rules.md`
RULE 22.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | S1 | Most data routes are anonymous (render, worker, `/api/script`, `/api/voiceover`, config GETs). **`/image/gen` is metered per account (RULE 20) or per IP for `/free` guests (RULE 21)** | partially fixed |
| 2 | S1 | `POST /api/worker/deliver` lets anyone overwrite any job's output | open |
| 3 | S1 | Sessions never expire in KV; cookie has no `Secure` | open |
| 4 | S1 | No rate limiting on login/signup/AI routes. **Images are capped per account per day** (50 free / 1,200 paid) **and per IP for guests** (10); scripts and voiceovers remain unlimited by design | partially fixed |
| 5 | S1 | Settings password hard-coded in Worker source; query-string admin credentials | open (documented) |
| 6 | S2 | `getBlobStore()` silently zero-fills missing parts → corrupt MP4 | open |
| 7 | S2 | Job claiming is neither FIFO nor atomic | open |
| 8 | S2 | ASI bug: `return` / `null;` returns `undefined` (`findWavChunk`) | open (benign today) |
| 9 | S3 | `frames - 1` divisor divides by zero for 1-frame slides | open |
| 10 | S3 | Two Workers AI image generations on **every page load** | open |
| 11 | S3 | `npm run check` can never pass: `tsc` fails with 48 errors on clean `main` | open |
| 12 | S3 | `src/index.ts.original` is a stale 21k-line duplicate of the worker | open |
| 13 | S3 | `README.md` documents a different product (stock template) | **fixed** |
| 14 | S3 | Three user-visible strings contradict the render engine | **fixed** |
| 15 | S3 | Hard 7-user signup cap + O(n) email scan that breaks at 1,000 users | **fixed** |
| 16 | S3 | Duplicated/inconsistent limits and unused client constants | open |
| 17 | S3 | `wrangler.json` ships a hard-coded KV namespace id | open |
| 18 | S4 | Unbounded client poll loop when no worker picks a job up | open |
| 19 | S4 | `/api/render` accepts asset-less jobs | open |
| 20 | S4 | Plaintext emails in the new `email:` index keys | open (by design, documented) |
| 21 | S3 | Script block was the *last* accordion section and said nothing about the SEO keywords the API enforces | **fixed** |

---

## 1. Fixed in this change

### 15 — Hard user cap + email scan that cannot scale

- **Before:** `AUTH_MAX_USERS = 7` + `403 "Full: max 7 users"`, and email uniqueness was
  `list({prefix:"user:"})` followed by **one `get` per user**. Two scaling defects were measured
  (`kv-scale-test.md` §4): KV `list()` returns **at most 1,000 keys** (never paginated here, so
  accounts past #1,000 were invisible to the scan), and one `get` per account exceeds the
  documented **1,000 external operations per invocation** at ~1,000 users (measured: aborted at
  1,001 ops → `500`).
- **After:** the cap is gone (`src/index.ts` — "USER AUTH HELPERS (KV-backed, unlimited
  users)"), and email uniqueness is a single keyed read of `email:<address>`
  (`AUTH_EMAIL_PREFIX` in `src/index.ts`), written at signup. Accounts predating the index are
  covered by a bounded legacy scan that only runs while the namespace holds
  `<= AUTH_LEGACY_SCAN_MAX` (200) accounts — i.e. `<= 200` gets, always inside the operation
  budget.
- **Client:** the overlay's "(max 7 user accounts)" copy and the client `AUTH_MAX_USERS` constant
  are gone (the overlay copy lived at `src/client/app-js.ts:8875` in commit `e450ce5`).
- **Stale comments:** five comments still advertised the removed cap and were corrected —
  `src/index.ts` (route index and "Create an account (max 7)"), `src/client/app-js.ts` (module
  header), `src/client/styles.ts` (auth overlay note), plus the unrelated
  `addVideoAccordion()` "max 7" comment, which now says "max 10" to match
  `VIDEO_MAX_VIDEOS = 10` (audit #16).
- **Verified** against the real worker in both harnesses:
  - 25 consecutive signups → 25 × `200` (previously the 8th was impossible);
  - at a 3,000-key namespace: signup `200` (was `403`), 10/10 further signups `200`, signup cost
    **6 KV ops** (`2 gets + 3 puts + 1 list`) with **no per-user scan**;
  - duplicate email → `409` in **4.8 ms**, costing **1 read**;
  - duplicate username → `409`;
  - legacy account (no `email:` key) in a small namespace → still `409` via the bounded scan;
  - login/session unchanged (2 ops / 1 op).
- **Free-tier consequence of "unlimited":** the app no longer bounds growth, Cloudflare does —
  **≈333 new accounts/day** (3 writes each) and **≈1,000 logins/day** (1 write each) against the
  1,000-writes/day allowance; page loads (1 read) stay far under 100,000 reads/day.

### 13 — README described a different product

`README.md` was the untouched Cloudflare template text ("generate an image from the prompt
*cyberpunk cat*", `cloudflare/templates/text-to-image-template`, C3 instructions) while the
repository is "YouTube Vibe Studio". Rewritten to describe the real application, its limits,
routes and its documentation set.

### 14 — Three user-visible strings contradicted the engine

| Location | Said | Engine actually does |
| --- | --- | --- |
| `markup.ts` (est.) | "(8s per image)" | `SLIDE_SECONDS_MIN = SLIDE_SECONDS_MAX = 9` (`app-js.ts:1251`) |
| `markup.ts` (audio note) | "Slideshow timing will stretch to match this track." | slides are fixed 9 s and the list **repeats** to cover the track (`getSlideSequence`) |
| `markup.ts` (sticker note) | "White **200 × 80** rectangle…" | `STICKER_WIDTH = 435`, `STICKER_HEIGHT = 150` (`app-js.ts:252,265`) |

All three corrected in `src/client/markup.ts`.


### 21 — The script block contradicted the API contract (fixed)

The old accordion section was titled **"Script (SRT) — AI model"**, sat *after* Quality in the
left column, and said nothing about the requirements the server had started enforcing
(`/api/script` plans an SEO keyword set and counts it in the spoken SRT). A user could only
discover the rule from a `500 "Script output invalid (…)"` status line.

**Fixed** in the same change as the API work, and kept in step with the **2026-10-23 explainer
SEO rule set revision** — every pre-2026-10-23 script rule value (2 long-tail keywords, 2-5
short keywords, "at least 1×" / "2-5×" ranges, 1-3 shorts per long tail) was deleted from all
documentation; the current rules live in `system-rules.md` RULE 7:

- the block is now the **first** section of `.va-left` and is titled **"Generate SEO Script With
  AI"**;
- a permanent hint line states the rule before the first click
  (`SEO rule (explainer): 1 long-tail keyword said exactly 2× · exactly 4 short keywords said
  exactly 2× each · one short keyword is in the title · one is in a heading`), and the button
  tooltip repeats it;
- after a successful run the SEO plan chips (`renderSeoKeywords()`, `#va-script-keywords-N`) show
  the AI title, the headings and every keyword with its **measured** count (each keyword must
  measure exactly 2×) and its own tooltip;
- the status line ends with `· SEO: 1 long-tail (2×) + 4 short keywords (2× each) · title + N
  heading(s)`.

Documentation updated in the same change: `system-rules.md` **RULE 7** (rewritten for the
explainer SEO rule set) and **RULE 18** (the ≈71-string user-hint inventory), `userflow.md`
§4.2 + §9 + §10, `README.md` ("Hints you will see in the UI" + limits table), `kv-scale-test.md`
§5/§8 (the Workers AI neuron cost doubled; KV is untouched).

- New drift risk recorded in `system-rules.md` RULE 17: the SEO hint copy is hand-duplicated from
  the Worker's `SEO_*` constants, so the two must be changed together.

---

## 2. Open findings — security & abuse (S1)

### 1 — Every data route is anonymous

**Evidence.** `handleAuthApi` only claims `/api/session`, `/api/login`, `/api/signup`,
`/api/logout` (inside `handleAuthApi()`); the session cookie is read in exactly three places
(`POST /api/signup` and `POST /api/login` write it, `GET /api/session` looks it up, and
`POST /api/logout` deletes it). No other route consults the session, and
the browser-side overlay (`initAuth`, `app-js.ts`) is a UI gate only.

**Impact.** Anyone who can reach the Worker URL can, without an account:

- `POST /api/render` — queue jobs; 10 in-flight jobs are enough to make the app return
  `{status:"busy"}` for everyone (the cap becomes a denial-of-service lever against real users);
- `GET /api/worker/poll` — **claim other people's jobs and read their media**: the response
  carries the video's assets and audio track as base64 (`POST /api/render`);
- `GET /api/render/<id>` — download another user's finished MP4 (ids are random, but the endpoint
  itself performs no ownership check);
- `POST /api/script`, `POST /api/voiceover`, `GET /tts`, `GET /image/*` — consume Workers AI
  quota and CPU;
- `GET /api/config/workers` — read the registered worker URLs.

**Recommended fix.** Require the session cookie on every non-page route (a small
`requireSession(request, env)` helper returning `401` when absent), then scope jobs to their
owner (`job.owner = username`) and check ownership in `/api/render/:id`. Worker endpoints need
their own secret (see #5) rather than the user session, since the worker tab may be a different
user.

### 2 — `POST /api/worker/deliver` can overwrite any job's output

**Evidence.** `/api/worker/deliver?job=<id>` stores the **raw request body** as `file-<jobId>`
and flips the job to `done` with no authentication or job-state check
(`src/index.ts` deliver branch). `/api/worker/failed` likewise lets anyone mark a job failed.

**Impact.** Content injection (a user downloads an attacker-supplied MP4 under their own video's
name) and job sabotage. Combined with #1 the API is effectively open.

**Recommended fix.** A shared worker secret (`Authorization: Bearer …` compared with
`crypto.subtle.timingSafeEqual`-style equality) on all three `/api/worker/*` routes; refuse
delivery unless the job is `running`.

### 3 — Sessions never expire in KV; cookie lacks `Secure`

**Evidence.** Both session writes pass no expiry options —
`put("session:" + token, JSON.stringify({username, email, createdAt}))`
(`POST /api/signup` and `POST /api/login`) — whereas job and blob writes all use
`expirationTtl`. The cookie is
`yvs_session=…; HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000` (`authSessionCookie`,
`authSessionCookie()`) — no `Secure`.

**Impact.** Every login permanently adds a KV key: with the cap removed this now grows without
bound (the 1 GB free storage is consumed by stale sessions, not by users). The cookie can be sent
over plain HTTP if the Worker is ever exposed on `http://` (SameSite=Strict mitigates CSRF, not
transport).

**Recommended fix.** `expirationTtl: 30 * 24 * 3600` on session writes (matching the cookie),
cycle the token on login, delete sessions on password change, add `Secure` to the cookie
(and consider a signed cookie so login needs no KV write at all).

### 4 — No rate limiting anywhere

**Evidence.** No counter, no `Retry-After`, no IP check in any route. Login is a PBKDF2 verify
(100k iterations, deliberately expensive — CPU cost per attempt is the only brake), signup writes
3 KV keys, and the AI routes each trigger paid/limited upstream inference.

**Impact.** Password brute force; signup spam (with the cap gone, storage abuse is now possible);
`/api/voiceover` + `/api/script` + `/image/*` abuse burns the Workers AI allowance (10,000
neurons/day on the free plan) and the KV write quota.

**Recommended fix.** Per-IP + per-username throttling (Durable Object or KV counter with a short
TTL), a login attempt counter with backoff, and a hard cap on concurrent unauthenticated AI calls.

### 5 — Settings password is hard-coded; some admin APIs put it in the query string

**Evidence.** The active Worker has `CONFIG_PASSWORD = "#123admin%"` in `src/index.ts`.
The current `src/client/config-page-js.ts` does **not** contain that literal: its inline unlock
card posts the entered value to `POST /api/config/verify`, then keeps it in memory as
`unlockedPw`. Server-side config/admin routes compare body/query `pw` against the constant and
return `403` on mismatch. The older client-side duplicate remains only in the unimported
`src/index.ts.original` snapshot.

**Impact.** Anyone with the source has the shared administrator password; it is not a per-admin
credential. The rotating settings path is only an address convention, not authentication. Admin
payment list/image URLs also serialize `?pw=…`, which can expose the password through browser
history, copied URLs and HTTP logs. The current full-page settings client itself does not ship
the literal in its script.

**Recommended fix.** Move the password into a Worker secret (`env.CONFIG_PASSWORD`), replace
query-string credentials with a short-lived signed admin session, and rotate without editing
application source.

---

## 3. Open findings — correctness (S2)

### 6 — `getBlobStore()` silently zero-fills missing parts

**Evidence.** In `getBlobStore()`, each part is read with
`await env.KV_BINDING.get("blob:"+id+":"+i, "stream")` and `if (!body) { return; }`
(`getBlobStore()`) — a missing part leaves its slice of the pre-allocated `Uint8Array` as
zeros, and the function still returns `{bytes, contentType, total}`.

**Impact.** A partially expired or partially written blob produces a **corrupt MP4/JSON with no
error**: the download returns `Content-Length: idx.total` (full size) and `200 OK`. Expiry is
per-key with `expirationTtl: 7200`, so parts of the same blob can expire between reads.
The workbook also shows this pattern biting in practice: a 20 MB payload is 1 part, but a 45 MB
one is 3 parts.

**Recommended fix.** Collect a missing-part flag and return `null` (callers already handle
`null`), or verify all parts before assembling and fail the GET with `500 "Output file
incomplete"`.

### 7 — Job claiming is neither FIFO nor atomic

**Evidence.** `listRenderJobs()` reads the keys with
`Promise.all(list.keys.map(...))` and pushes into an array — so the order is **completion
order**, not key order — and the poll handler takes the first match
(`jobs.find(j => j.status === "queued")`). Claiming is a separate `put`, so two workers polling
simultaneously can both read `queued` and both claim.

**Impact.** Jobs are not processed oldest-first (a long queue can starve a job indefinitely), and
two workers can burn CPU rendering the same job twice, with the second `deliver` overwriting the
first.

**Recommended fix.** Sort by `createdAt` (or use a monotonically sortable job id) before
selecting; guard the claim with a conditional write (Durable Object or a `claim:<jobId>` marker
written with `putIfAbsent` semantics outside KV) — KV alone cannot express compare-and-swap.

### 8 — ASI bug: `return` on its own line returns `undefined`

**Evidence.** `findWavChunk` contains

```js
			return
				null;
```

which, by automatic semicolon insertion, is `return;` followed by a dead `null;` expression.
esbuild reports it: `[WARNING] The following expression is not returned because of an
automatically-inserted semicolon [semicolon-after-return]`.  A scan of all five source files found
this to be the **only** bare-`return` continuation in the repository.

**Impact.** **Currently benign** — both call sites treat the result as truthy/absent
(`const fmtBytes = fmtRef ? … : new Uint8Array(16)` and `if (dRef) { … }`), so `undefined` and
`null` behave identically. It becomes a real bug the moment a caller compares with `=== null`.

**Recommended fix.** `return null;` on one line (or drop the `null` and document that the function
returns `undefined`).

---

## 4. Open findings — dead code & documentation (S3)

### 9 — One-frame slides divide by zero

`const p = f / (frames - 1);` (`app-js.ts`, inside the frame loop). `framesForSlide()` returns
`Math.max(1, Math.round(30 * duration))`, so a slide whose duration is `<= 1/60 s` yields
`frames === 1` → `p = 0/0 = NaN` → `ease = NaN` → the canvas receives non-finite transforms and
the frame renders blank (per spec, non-finite draw arguments are ignored). Reachable only with an
MP4 asset of ~10 ms; still-slides (9 s) and MP4s of any normal length are unaffected.
**Fix:** `const p = frames > 1 ? f / (frames - 1) : 1;`

### 10 — Two AI images are generated on every page load and thrown away

The client builds two legacy "AI scene" cards (`prompts.forEach`, `app-js.ts:2031`) and then calls
`fetchAIImage(index)` for each (`app-js.ts:2260`), which issues `GET /image/<i>` → a real
Stable-Diffusion-XL run. `initVideoStudio()` then hides `#gallery`, so the results are never
displayed. `fetchAIImage` only bails out when its DOM nodes are missing — they exist.
**Impact:** every page view costs two image generations of latency and upstream quota. (Note: the
model page lists SDXL as *Beta*, unit pricing `$0.00 per step`; the app's non-beta models —
`llama-3.1-8b-instruct-fp8` and `melotts` — are the ones billed against the 10,000 neurons/day
free allowance.) **Fix:** delete the `fetchAIImage` loop (or gate it behind an explicit user
action).

### 11 — `npm run check` can never pass

`package.json` defines `"check": "tsc && wrangler deploy --dry-run"`, but `tsc` reports **48
errors** on a clean `main` checkout (verified by `git stash`: 48 before, 48 after this change — no
new errors were introduced). The codebase is untyped JS-in-TS under `"strict": true`:
implicit-`any` parameters throughout `src/index.ts` (e.g. `fetch(request, env)` at line 22,
`putBlobStore`/`getBlobStore`/`listRenderJobs` helpers, `handleAuthApi` at 3411-3413), dynamic
indexing of `SPEED_WORDS` (635, 671), `error` typed `unknown` (1235, 1244), and
`json(data, status = 200, setCookie = null)` whose `setCookie` param is inferred as `null`
(3270, 3756, 3861, 3897).
**Impact:** the documented verification step fails immediately, so the `wrangler deploy --dry-run`
half never runs; type regressions cannot be caught by CI.
**Fix:** annotate the `src/index.ts` signatures (`(request: Request, env: Env)`, `json(...,
setCookie: string | null = null)`, `Record<string, number>` for `SPEED_WORDS`), fix `unknown`
error handling, then keep `tsc` green.

### 12 — `src/index.ts.original` is a stale duplicate of the worker

21,009 lines shadowing `src/index.ts`. It is not imported and not type-checked (tsconfig includes
`.ts` only), but it still contains the **old** auth code, including `AUTH_MAX_USERS = 7` and the
pre-index signup scan — so `grep` results (and any future edit) can target the wrong file.
**Fix:** delete it, or move it out of `src/` with a header explaining it is a historical snapshot.

### 16 — Duplicated and unused constants / inconsistent limits

- `VIDEO_BATCH_SIZE = 2` (`app-js.ts:6149`) is documented as batch rendering in two comments and
  never read; the queue is strictly sequential.
- `AI_IMAGE_WIDTH = 854` / `AI_IMAGE_HEIGHT = 480` (`app-js.ts:8266`) are unused, and the
  surrounding comments disagree with each other ("480px landscape (832x480)" vs "854x480"); the
  model call passes no dimensions at all. The **user-visible copy repeats the same claim**: the
  accordion note `2 images per submit · 480px landscape` and the placeholder
  `Describe the image (always 480px landscape)` both promise a size the route cannot request —
  they are hint strings, so they are covered by the RULE 18 inventory and must be fixed in the
  same change as the dimensions.
- `SLIDE_SECONDS_MIN = SLIDE_SECONDS_MAX = 9` makes `getSecondsPerSlide()` (`app-js.ts:1343`) dead
  weight — its clamp can only ever return 9.
- `STATUS_COLORS.queued` is unreachable; no client path assigns `queued` to a video.
- `AUTH_MAX_USERS` was duplicated in both worker and client (removed with the cap).
- `/tts` caps input at 2,000 chars (`GET /tts` in `src/index.ts`) while `/api/voiceover` accepts 8,000
  (the 8,000-char cap) and chunks at 500 — three different limits for the same upstream engine. `/tts`
  also always labels its output `audio/mpeg`, even when the upstream returns WAV, whereas
  `/api/voiceover` sniffs the container.
- `VIDEO_MAX_VIDEOS = 10` vs the `addVideoAccordion()` comment "max 7".

### 17 — Hard-coded KV namespace id

`wrangler.json:15` pins `"id": "a0f6ab6caaef487ca95a01cbd13cbb53"`. Deploying this repository to a
different Cloudflare account either fails or binds a namespace that is not yours — the classic
symptom is secrets, jobs and accounts landing in someone else's namespace. **Fix:** replace with
a placeholder and document `wrangler kv namespace create KV_BINDING`.

---

## 5. Open findings — low severity (S4)

### 18 — Unbounded client poll loop

`apiRenderVideo` polls `GET /api/render/<id>` every 4 s inside `while (true)`
(`apiRenderVideo()` in `app-js.ts`) with no attempt cap, timeout or cancel button. In practice the loop ends when
the job record expires (1-hour `expirationTtl`) and the request 404s — but a dead worker costs
~900 pointless polls and leaves the status line spinning until then.

### 19 — `/api/render` accepts asset-less jobs

`const assets = Array.isArray(body.assets) ? body.assets : []` — an empty array is accepted. The
job is stored, a worker claims it, `generateMP4()` alerts and returns `"skipped"`, and
`workerRunJob` throws `"render produced no output"`. A junk submission therefore occupies one of
the 10 render slots before failing. `project` is likewise unvalidated.

### 20 — Plaintext emails in the new index key names

`email:<address>` keys are readable by anyone with KV access or a `list()` call. This is **not a
new disclosure** — the address was already stored in plaintext inside the user record and the old
code enumerated exactly those records — but if that matters for compliance, hash the key
(`email:<sha256(lowercased address)>`) and keep the address only in the value.

---

## 6. Checked and found correct (no action)

- **No XSS found.** The accordions, AI result cards, auth overlay, footer and the config page build
  nodes with `createElement`/`textContent`. The only three `innerHTML` writes are the legacy cards
  and the legacy custom-image card, and both escape user text via `escapeHTML()` (the four `innerHTML` assignments in the legacy card builders). File names, prompts and the worker's `job.name` never
  reach an unescaped `innerHTML`.
- **Sticker coverage is complete.** All seven UI option values (`none`, `like`, `love`,
  `subscribe`, `like-subscribe`, `watch`, `watch-like-subscribe`) exist in `STICKER_PRESETS` and in
  both selects (main markup + accordion).
- **Caption timing is consistent.** `getCaptions()` sorts by `timeMs` and `drawCaptions()` compares
  `caption.timeMs`; the 10 s cap applies to the last caption only, as documented.
- **Template composer respects the MP4 cap** — `addTemplateToVideo()` checks
  `counts.clips >= MAX_MP4_UPLOADS` before adding the composed clip.
- **The composer cannot collide with studio globals** (single IIFE; only
  `openTemplateModal`/`closeTemplateModal` are exported).
- **Blob chunking is sound** (`subarray` views on write, parallel reads into one pre-allocated
  buffer); 20 MB chunks sit inside the 25 MiB KV value limit.
- **No unhandled ASI hazards** other than #8 — every other bare `return` in all five source files
  is followed by a closing brace.
- **KV uses the nine key families listed in `system-rules.md` RULE 15**, and every TTL matches the
  flows documented in `userflow.md`: 3600 s jobs, 7200 s blobs, and the 2-day `credits:` /
  `ipcredits:` counters.
- **The user-visible hint strings match the code** (re-measured on the served pages 2026-10-23:
  21 tooltips · 7 placeholders · 35 `alert()` call sites · 17 note/hint/tip class usages plus
  7 notes/status elements in the settings script ≈ 87 strings — see `system-rules.md` RULE 18 for
  the full inventory; the settings script contributes 7 note/status elements and 2 alerts; the
  studio's onboarding hint was reworded from "red" to "round" for the themes). Every limit quoted in copy equals its constant — `Max 5 GIF · 25
  images · 5 MP4 (1:00 each, silent)` ↔ `MAX_*_UPLOADS`/`MP4_MAX_DURATION_S`, `Add a video (up
  to 10)` ↔ `VIDEO_MAX_VIDEOS`, `Caption text (max 40 characters)` ↔ `CAPTION_MAX_CHARS`, the
  sticker rectangle 435 × 150 ↔ `STICKER_WIDTH/HEIGHT`, `max 25 seconds` ↔ the composer cap,
  and the new SEO hints ↔ `SEO_*`. The only exception is the 480 px claim in #16.
  - Caveat (by design, not fixed): the client cannot import the Worker's constants, so all of
    this copy is duplicated by hand — see RULE 17 "Duplicated SEO copy".
- **Theme injection is whitelisted and cannot inject markup** (checked 2026-10-15).
  `POST /api/config/theme` lower-cases the value and rejects anything outside
  `CONFIG_THEMES = [default, strata, stellar]` with `400` *before* KV is touched, and
  `applyTheme()` rebuilds the attribute as `data-theme="<name>"` from that same list, so a
  crafted value such as `strata" onload="…` never reaches the HTML (verified: `400`, and the
  served tag stays `<html lang="en">`). The GET is anonymous but discloses only the skin
  name; the KV read cannot cache (a theme change must apply on the next load); and a KV read
  error degrades to the default look with the page still `200` instead of failing the studio
  route. The CSS itself is additive — `html[data-theme=…]`-scoped — so the default skin is
  byte-identical to the pre-theme build.

---

## 7. Suggested order of work

1. **Authenticate the API** (#1, #2) — nothing else on this list matters while the render and
   worker endpoints are open. Start by scoping jobs to their owner.
2. **Session hygiene** (#3) — TTL, rotation, `Secure`.
3. **Rate limiting** (#4) and **move the settings password to a secret** (#5).
4. **Fail loudly on missing blob parts** (#6) and **sort/claim jobs deterministically** (#7).
5. **Repair the toolchain** (#11, #12, #17) so regressions can be caught: green `tsc`, delete the
   stale duplicate, parameterise the namespace id.
6. **Small clean-ups** (#8, #9, #10, #16, #18, #19) — one line each, mostly deletions.

---

## Credits & plans (2026-10-22)

- `/image/gen` is no longer anonymous: when `KV_BINDING` is bound it resolves a session (plan
  from `user:<name>.usertype`), else the `/free` guest cookie (10/day per IP), else `401`;
  every call consumes one image credit (`429` at the daily limit, refund on model error).
  Without a KV binding the gate is skipped, as in the previous open-access mode.
  `/image/:i` (the two fixed demo prompts) stays unmetered so the landing page can render its
  sample cards before sign-in.
- Per-account counters live in `credits:<username>` and are lazy-reset by comparing the stored
  `day` with the current Asia/Taipei date — there is no scheduled Worker.
- Plans are stored on the user record (`user:<username>.usertype`, `free` | `paid_user`) and are
  changed from the settings page via `/api/config/users`. "Paid" is operator-assigned; no payment
  provider is integrated.
- Remaining risk: KV is eventually consistent, so parallel generations can overshoot a limit by
  the number of in-flight requests. Bounded and self-correcting at the daily reset.

---

## Bug Fix Session #206 — freemium access and per-IP credits (2026-10-22)

Full record: `bug-fix-session-206.md`; system rule: `system-rules.md` RULE 21.

- **New public surface.** `GET /free` serves the studio to anyone and marks the browser with
  `yvs_free=1`. `GET /studio` (accounts) and `GET /paid` (`paid_user`) are the plan-restricted
  variants; guests are redirected to `/free`.
- **Guest plan.** 10 AI images/day per IP; videos, scripts and voiceovers unlimited. A cold
  anonymous `/image/gen` without the cookie stays `401`, so the freemium tier is reachable only
  through the documented URL.
- **IP table.** Guest counters live in `ipcredits:<sha256("yvs-guest:"+ip)>` (2-day TTL) and are
  surfaced to operators by `GET /api/config/ipcredits` + the settings **Guest credits by IP**
  table. Only the masked address (`203.0.113.0`) is stored; the raw IP is never written.
- **Known limits (accepted, documented):**
  - Rotating IP addresses multiplies the 10/day allowance. The bucket is a product limit, not
    anti-abuse; a WAF/rate-limit rule is the right control for that.
  - Shared NAT (office, school, carrier) gets 10 images/day for the whole egress address.
  - `/paid` and `/studio` are navigation gates on a client-side shell; API metering remains the
    real boundary.
  - KV eventual consistency can overshoot the guest limit by the number of in-flight requests.
- **Privacy.** No raw address is persisted. The hash is salted (`yvs-guest:`) and truncated to
  40 hex characters; the operator view shows the network-masked address only.
