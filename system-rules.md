# YouTube Vibe Studio — System Rules

> Every rule below was verified against the current working tree on **2026-10-16**. Each
> high-level rule is followed by
> **indented** sub-points: the technical detail that implements it, then the restrictions,
> invariants and side-effects that follow from it. File references use `path:line` where a
> single anchor exists.
>
> 2026-10-15 revisions: RULE 18 (the user-visible hint inventory) was added, and RULE 19 (the
> skins) was added when the settings page gained its Appearance group. On 2026-10-16, RULE 3
> was updated for the Asia/Taipei day-rotating settings route.
> 2026-10-22 revisions: RULE 20 (daily credits, plans, `/api/credits`, `/api/config/users`) was
> added, the landing page was re-skinned onto the RULE 19 theme tokens instead of its own palette,
> and `/image/gen` became session-gated and metered.
> **Bug Fix Session #206 (2026-10-22):** RULE 21 was added — plan-based URLs (`/free`, `/studio`,
> `/paid`), the freemium guest plan (10 AI images/day per IP), and the `ipcredits:` table behind
> the settings page. The full session record is `bug-fix-session-206.md`.
> **2026-10-23 documentation consistency pass:** the 22 findings from the 2026-10-22 audit were
> fixed across `system-rules.md`, `README.md`, `userflow.md`, `bug-audit.md`, `kv-scale-test.md`
> and `bug-fix-session-206.md`; the resolved register is at the end of this file.
> **Bug Fix Session #211 (2026-10-23):** the two runtime defects that pass found — a guest refund
> erasing the IP row's identity (§3.3) and `GET /api/config/workers` throwing without a KV
> binding (§6.1) — were fixed in `src/index.ts`. The full record is `bug-fix-session-211.md`.
> **2026-10-24 keyword-frequency rule (RULE 7 updated):** SEO keyword frequency is now a
> **minimum, never an exact count and never a maximum**: the **1 long-tail keyword must appear
> at least once** and **each of the 4 short keywords must appear at least twice**. Extra uses are
> allowed and are never retried or rejected; the `*_FREQ_MAX` constants were deleted. This
> supersedes the earlier "said exactly 2×" wording everywhere in the repo
> (`src/modules/script-seo.ts`, `src/client/app-js.ts`, `tests/script-seo.test.mjs`,
> `README.md`, `userflow.md`, `new_requirements.md`, `bug-audit.md`).
>
> **2026-10-23 explainer SEO rule set (RULE 7 rewritten):** the AI script rules are — exactly
> **1 long-tail keyword**, exactly **4 short keywords**, an AI
> **title (≤70 chars) that includes one of the short keywords**, and **at least 1 section heading**
> (every default AI script is an **explainer** video) **of which one — the same short keyword as the
> title's or another — includes a short keyword**. All documentation of the AI script written before
> 2026-10-23 was **deleted and replaced**: the old plan (2 long-tail keywords, 1-3 shorts under each,
> 2-5 shorts in total, long tail said ≥1×, shorts said 2-5×) no longer exists in any file. A future
> non-SEO / non-explainer script mode is documented in RULE 7 (not implemented).
>
> **Session #211 second pass (2026-10-25): editor + table corrections.** A 30% smaller
> delete icon on every accordion gallery card, a per-video lock on **Generate 2 Images** while
> that video's script & style walkthrough renders, three simultaneous rows in the Quick batch
> table, finished rows skipped by Generate, and two new per-row columns (**Resolution**,
> **Orientation**) that travel into both image calls. RULEs 6, 18, 25, 27 were corrected against
> the code; the inconsistency register is `toberesolved.md` and the session record is
> `bug-fix-session-211.md` (second pass).
>
> **Session #243 (2026-10-25): UI corrections + planner resilience.** The accordion **Sticker**
> section (and the sticker renderer behind it) is gone; the removed **☁️ API** header button is
> replaced by **🗑 Delete Video**, which renumbers the stack; the generated-image delete icon is
> 40% smaller and the Add to Video / Fullscreen buttons 30% smaller in every theme; the dead
> bulk-grid CSS from Session #240 was deleted; and `POST /api/seo-plan` now retries, falls back to
> a second model and can answer with one set (`partial: true`). See **RULE 27** at the end of this
> file, `script-keyword-retry-debug.md` and `quick-batch-table-system-requirements.md`.
>
> **Session #244 (2026-10-26): silent in-row retries, fixed table layout, three credit pages.**
> The Quick batch table no longer has an error state: a failed step is retried inside its row
> (up to 4 attempts, exponential backoff) while the row keeps the editor's script-section loading
> animation, then goes back to **Ready** with `row.error = ""` — no error text, no warning colour,
> no toast, and no browser abort wording ("signal is aborted without reason") ever reaching the
> table (RULE 25). The seven columns are `table-layout: fixed` so processing cannot reflow the
> table, and each NDJSON read has a 90 s idle budget. The Site Admin page now has **seven** tabs:
> General & Themes, **Guest Credits by IP**, **Plans**, **Accounts Credits**, Local Payment
> Gateway, Payment Transactions, CMS Pages (RULE 18). A CMS page (and the Top Menu / Footer link
> it renders) can be deleted from its saved-page pill **or** from the editor's **Delete This
> Page** button. Session record: `bug-fix-session-244.md`.
>
> **Session #248 (2026-10-26): quick batch table staggered pipeline execution.**
> When 4 or more rows have scripts and Generate is clicked, the table starts up to
> `BATCH_RUN_CONCURRENCY = 3` rows simultaneously in the early pipeline steps (voice, timing,
> prompts). As soon as any running row moves to the next step of processing (stage `images` /
> image generation), `startUnprocessedRows(activeRow)` starts the next unprocessed row from the
> queue immediately, filling the vacated early-pipeline slot instead of waiting for the first three
> rows to completely finish the whole pipeline (`done`). Concurrency in the early stages remains
> strictly bounded by 3, while subsequent rows process without requiring the user to press Generate
> again. Session record: `bug-fix-session-248.md`.
>
> **Session #251 (2026-10-26): 3-stage pipeline hardening, 1,800-char style/anti-distortion guards,
> 3-images-per-3-seconds pacing, and Node.js-style non-blocking image queues.**
> Extracted `POST /api/voiceover` into `src/modules/voiceover.ts` (Unicode `/[\p{L}\p{N}]/u`
> speakable filtering, `<= 400`-char chunking, MP3 ID3v2 header stripping, sticky Deepgram Aura
> fallbacks, bounded 15 s client `decodeBatchAudio`); capped `IMAGE_PROMPT_MAX_CHARS = 1800`
> across `src/modules/image-prompts.ts` and `src/modules/image-batch.ts` with proportional
> 4-paragraph preservation, per-style `IMAGE_STYLE_DISCIPLINE` locks, `IMAGE_ANTI_DISTORTION_GUARD`,
> and expanded SDXL/Flux anti-distortion prompts; added 64 px SDXL dimension healing and model
> fallbacks; and introduced `src/modules/image-queue.ts` (`ImageTaskQueue` +
> `EventLoopCpuSerializer`) plus client `window.__IMAGE_TASK_RUNTIME` (round-robin event-driven
> queues + off-thread Web Worker base64 decoding) pacing generation at **3 images per 3 seconds
> per video/row** without blocking the main thread. See **RULE 28** and `bug-fix-session-251.md`.
>
> **Current SEO/template revision (2026-10-23):** short/long-tail overlap is allowed with shared
> counts; long-tail keywords have no word/character length rule. RULE 13 now has one scene gallery,
> animated objects in Graphics, working layer/rotation controls and required 5–7 ring uploads.
> Full requirements and acceptance criteria: `new_requirements.md` §6.
>
> Companion documents: `userflow.md` (the actor-level flows these rules produce),
> `README.md` (the user-facing summary), `bug-audit.md`, `kv-scale-test.md`,
> `bug-fix-session-206.md` and `bug-fix-session-211.md` (evidence).

---

## RULE 1 — One Cloudflare Worker serves everything; the browser does the heavy work

- The Worker is a single default-exported `fetch(request, env)` handler with sequential
  `if` branches and **no router library** (`src/index.ts:124`).
  - Routes are matched in a fixed order: `/` → `/free` `/studio` `/paid` → `/image/:i` →
    `/image/gen` → auth API (`/api/session`, `/api/credits`, `/api/login`, `/api/signup`,
    `/api/logout`) → render KV guard → `/{current-day}/config/uvxyz` → `/api/script` →
    `/api/voiceover` → `/tts` → `/api/render` (POST) → `/api/render/:id` (GET) →
    `/api/worker/*` → `/api/config/theme` → `/api/config/workers` → `/api/config/users` →
    `/api/config/ipcredits` → 404.
  - Unmatched requests fall through to `new Response("Not Found", { status: 404 })`.
    - Restriction: the 404 body is plain text, not JSON — clients that always
      `.json()` will swallow it (the client relies on status codes instead).
- No server-side video encoding exists anywhere.
  - The only "renderer" is the browser: WebCodecs `VideoEncoder` (H.264 `avc1.4d002a`) +
    `AudioEncoder` (AAC) + `mp4-muxer@5.1.3`, loaded from `https://unpkg.com` by the page.
    - Restriction: rendering requires a modern Chromium/Safari-grade browser with WebCodecs
      *and* the CDN `unpkg.com` reachable; either missing = hard failure (`alert` +
      status `error`), no server fallback.
    - Restriction: `showSaveFilePicker` (streaming to disk) exists only in Chromium; Safari
      and Firefox always take the in-memory path.
- The page is a single cached string.
  - `createHTML()` memoises the assembled HTML in a module-level `CACHED_HTML`
    (`src/page.ts`), replacing 4 placeholders **once per isolate**:
    `__APP_CSS__`, `__APP_JS__`, `__TEMPLATE_COMPOSER_JS__`, `__PROMPTS_JSON__`.
  - Replacements use *replacer functions* so `$&`-style patterns inside the injected
    JS/CSS are never interpreted; the cached string is never mutated afterwards.
    - Every HTML route `.replace()`s a **copy**: the settings page prepends
      `window.__CONFIG_PAGE = true;` and injects the settings script; `/`, `/free`, `/studio`,
      `/paid` and the settings page stamp `data-theme="…"` (RULE 19) and the three plan routes
      also inject `window.__PLAN_MODE` (RULE 21). The cached string itself is still never
      mutated.
    - Restriction: `__PROMPTS_JSON__` (from `src/prompts.ts`) is the **only** server-side
      interpolation into the client script — every other value the client needs comes from
      an API call.
- The client is one giant inline script, not a bundle.
  - `src/client/app-js.ts` + `src/client/template-composer-js.ts` are shipped in the same
    `<script>` tag (`src/client/markup.ts`); `src/client/styles.ts` is inlined in `<style>`.
  - Both source files are template literals — the escapes (`\``, `\${`, `\\uXXXX`) are
    load-bearing and must not be "reformatted".
  - `src/index.ts.original` (21 009 lines) is the pre-split single-file version, still in
    the tree; it is dead code (nothing imports it) but is the byte-reference for the split.

---

## RULE 2 — Accounts are KV-backed with no user cap; most data routes stay anonymous

- `POST /api/signup` enforces, in this order:
  - `username` must match `^[a-zA-Z0-9_]{3,20}$` → otherwise `400`.
  - `password.length >= 6` → otherwise `400`.
  - `email` must match `^[^\s@]+@[^\s@]+\.[^\s@]+$` → otherwise `400`.
  - **There is no user cap** (the old `AUTH_MAX_USERS = 7` / `403 "Full: max 7 users"` check is
    gone). Growth is bounded only by the KV plan and by crypto cost, not by the app.
    - Restriction: with no cap, a namespace that is never pruned grows forever in both accounts
      and sessions (sessions are written with no TTL — see below), against the 1 GB free storage.
    - Restriction: signup is 2 reads + 1 list + 3 writes (user record, email index, session), so
      the free plan allows ≈333 new accounts/day on the 1,000-writes/day allowance.
  - Duplicate email → `409`, checked first with **one keyed read** of the index
    `email:<lowercased address>`, written on every successful signup.
  - Duplicate username → `409` (`user:<lowercased>`, 1 keyed read).
    - Restriction: the index key is the plaintext address (the address was already in the user
      record; hashing the key is the hardening option if that matters). See audit #20.
  - Legacy accounts (created before the index existed) have no `email:` key, so signup also runs
    a **bounded** scan: `list({prefix:"user:", limit: 201})`, and only when that returns
    `<= 200` keys does it `get` each record looking for the address.
    - Restriction: in a namespace with `<= 200` accounts, signup pays up to 200 extra reads
      (measured: 33 ops on a 29-account namespace — well inside the 1,000-op budget).
    - Restriction: a namespace with more than 200 accounts can only have been created *after*
      the index landed, so the scan is skipped there and signup costs a flat 6 ops regardless of
      namespace size (measured at 3,000 keys: 2 gets + 1 list + 3 puts).
  - This replaced two defects that are now fixed (see `bug-audit.md` #15): the old code used
    `list()` as an account counter (**max 1,000 keys per page**, never paginated, so accounts
    past #1,000 were invisible) and did one `get` per user to test emails (**1,000 external
    operations per invocation**, so signup failed from ~1,000 accounts; measured abort at
    1,001 ops → `500`).
  - Measured scaling (see `kv-scale-test.md`): session costs a constant 3 reads (session +
    `user:` + `credits:`), login 3 ops (user read + session write + credits read) and signup
    6 ops (2 gets + 1 list + 3 puts) regardless of namespace size — 3,000 keys neither slows
    the app nor breaches the free plan's 1 GB / unlimited-keys allowance. The free-plan risk is
    the *operation pattern* (worker polling burns the 1,000 list/day allowance in ~50 minutes),
    not the user count.
- Password storage: PBKDF2-SHA-256, 100 000 iterations, 16-byte random salt, 256-bit output,
  hex encoded (`authHashPassword`).
  - The iteration count is capped at 100 000 **because the Workers runtime rejects more**
    (comment in code) — do not raise it without re-checking the runtime limit.
  - Verification is a plain string compare of hex hashes (no constant-time compare).
- Sessions: a 32-byte random token (hex) is the KV key `session:<token>`, value
  `{username,email,createdAt}`.
  - Cookie: `yvs_session=<token>; HttpOnly; Path=/; SameSite=Strict; Max-Age=2592000` (30 days).
    - Restriction: no `Secure` attribute is set, and the KV session record is written
      **without an expiry**, so sessions live in KV forever while the cookie dies in 30 days.
    - Restriction: there is no session rotation, no device list, and logout deletes only the
      one token.
  - `GET /api/session` reads the cookie, looks up KV, and returns
    `{authenticated:true, user:{username,email,usertype}, plan, credits}`, or `401` when the
    cookie/record is missing. The plan/credits reads are best-effort: a KV error falls back to
    the free plan and empty counters instead of failing the session.
- The sign-in gate is **UI-only**.
  - `initAuth()` runs `GET /api/session`; on `200` it opens the studio and shows the account
    footer. On `401` it keeps the public landing visible and the studio hidden; the top **Sign up**
    link, bottom **Log in** link and primary studio CTA open the existing auth modal. On `503`
    (KV unbound) or a network error, the landing remains visible and the primary CTA opens the
    studio, preserving the previous open-access fallback.
    - Restriction: `/image/:i`, `/api/script`, `/api/voiceover`, `/tts`, `/api/render*`,
      `/api/worker/*`, `GET /api/config/theme` and `GET /api/config/workers` never check a
      session; the login modal is a usability gate for the studio UI, not an authorization
      boundary for them. The exceptions are `/image/gen` (session or freemium cookie, metered —
      RULES 20/21), the plan routes `/studio` and `/paid` (session, RULE 21), and the
      password-gated `/api/config/users` + `/api/config/ipcredits` (RULE 3).
  - The auth modal is built lazily when an account action is used; the HttpOnly cookie is the
    persistence mechanism (no `localStorage`/`sessionStorage`/IndexedDB anywhere in the client).
    - Restriction: closing the tab loses all unsaved studio state (uploads, prompts, scripts)
      — nothing is persisted client-side.

---

## RULE 3 — The settings page is a day-rotating second view of the same Worker

- `GET /{current-day}/config/uvxyz` returns the studio HTML plus the settings script;
  `initAuth()` bails out immediately in that page (`window.__CONFIG_PAGE`), so **no account
  login** is required.
  - `{current-day}` is the unpadded day of month (1–31) in **Asia/Taipei**, computed per request
    with `Intl.DateTimeFormat`; for example, the route is `/16/config/uvxyz` on 2026-10-16.
    It changes at midnight Asia/Taipei. The old bare `/config/uvxyz` path and a stale day path
    fall through to the normal plain-text `404`.
  - Restriction: the rotating path is not an authorization boundary. The full-page inline
    unlock card posts the entered password to `POST /api/config/verify`; valid/invalid responses
    come from the Worker, not a client-side comparison.
- The settings password is the literal `"#123admin%"` in the active Worker constant
  `CONFIG_PASSWORD` (`src/index.ts`). The current config client contains no copy: it stores only
  the operator-entered value in memory as `unlockedPw` and sends it to password-gated APIs.
  `src/index.ts.original` is a stale, unimported snapshot with an older duplicated client gate.
  - Server-side checks cover config verification, theme/worker writes, account/IP-credit admin,
    payment-gateway writes, payment review/images/approval and CMS admin APIs. They compare the
    supplied body/query `pw` against `CONFIG_PASSWORD` and return `403` on mismatch. Public
    exceptions are intentional (for example theme/worker reads, gateway read and public CMS read).
  - Restriction: the password is hard-coded in server source and some admin image/list URLs put
    it in the query string. Rotate by editing the active Worker constant and redeploying; a real
    deployment should move it to a Worker secret and avoid query-string credentials.
- **General & Themes** (RULE 19):
  - **seven** radio cards (Studio / Aerial / Stellar / Night Lab / Warm Paper / Swiss /
    Neo Brutalist) with CSS-only preview swatches, a status line and a **Save theme** button.
    The cards wrap (`flex: 1 1 150px`) so seven fit in rows rather than being squeezed into one.
  - Restriction: the preview is client-side only — picking a card restyles the page
    immediately but stores nothing, so an unsaved pick is lost on reload.
  - Restriction: the theme is a **global** setting (one page serves every visitor), not a
    per-user preference.
- **Full-page/worker mode:** the config script builds `#cfg-page` on `body.cfg-real-page` with
  **seven** tabs (Session #244): `general | guests | plans | accounts | payment-gateway | payments
  | cms`, each its own `#cfg-panel-*` section, switched by `activateTab()` which also lazily
  loads that tab's data (`loadGuests`, `loadCreditUsers`, `loadPaymentsPage`,
  `loadGatewayConfig`, `loadCmsPages`). Credits were two adjacent cards in tab 1 before, and are
  now three separate pages: **2. Guest Credits by IP** (`#cfg-guests-list`,
  `#cfg-guests-refresh`), **3. Plans** (`#cfg-plans-list` from the `plans[]` in
  `GET /api/config/users`, plus the read-only guest plan) and **4. Accounts Credits**
  (`#cfg-credit-user`, `#cfg-credit-plan`, `#cfg-credit-reset`, `#cfg-plan-save`,
  `#cfg-users-list`). The General tab's **Background Worker Mode**
  card has Start/Stop and a polling log. `#studio-app` is moved off-screen and visually hidden,
  but its canvas, JS and render engine remain alive to perform claimed jobs.
- Registered worker URLs:
  - `POST /api/config/workers` trims the array, drops empties, keeps at most **3** URLs, and
    rejects any entry longer than 500 chars or not matching `^https?://` → `400`.
  - `GET /api/config/workers` returns `{success:true, urls}` with **no password**; with no
    `KV_BINDING` it answers `{success:true, urls:[]}` (200) so the settings page still renders,
    while `POST` answers `503 "User storage not configured"` like the other operator endpoints.
    - Restriction: the registry is readable by anyone and its entries are never contacted by
      the system — dispatching to registered workers does not exist. Each worker operator must
      open their own current-day settings tab and press **Start worker**; that tab polls the queue.

---

## RULE 4 — Render jobs are KV records; the payload and the MP4 are chunked KV blobs

- Job submission: `POST /api/render` accepts `{name, project, assets[], audio}`.
  - `name` is sliced to 60 chars; `assets` must be an array (else `[]`); the JSON payload is
    re-serialised and rejected with `413` when `payload.length > 60 MB`.
    - Restriction: the size test happens **after** the string is built, so a request that is
      far too large costs full parse + stringify before being refused.
    - Restriction: assets/audio travel as **base64** (≈ 4/3 inflation), so the real file
      budget is closer to ~45 MB.
  - Concurrency cap: if `>= MAX_RENDER_JOBS (10)` jobs are `queued` or `running`, the server
    answers `200 {success:true, status:"busy", inProgress, max}`.
    - Restriction: `busy` is intentionally **not** an error — the client treats it as a signal
      to render that video in the caller's own browser.
    - Restriction: the count comes from a KV `list()` and is eventually consistent, so the cap
      can be overshot slightly.
  - Job id format: `job-<base36 timestamp>-<6 random base36 chars>`; the record is
    `job:<id>` = `{id,name,status:"queued",createdAt,payloadId}` with `expirationTtl: 3600`.
- Blob storage (`putBlobStore` / `getBlobStore`):
  - Split into `BLOB_CHUNK_SIZE = 20 MB` parts: `blob:<id>:<i>` plus an index record
    `blob:<id>:_idx` = `{parts,total,contentType}`.
  - All blob keys use `expirationTtl: 7200` (2 h) — both job payloads and delivered MP4s
    vanish after 2 hours; job records vanish after 1 hour.
    - Restriction: if a download is not started within ~1 h the job record 404s, and the file
      itself is gone after 2 h.
  - Reads fetch all parts with `Promise.all` and copy each chunk straight into one
    pre-allocated `Uint8Array(idx.total)` (chunks are views via `subarray()` on write, so no
    gratuitous 20 MB copies).
    - Restriction: a delivered MP4 is fully buffered in Worker memory before being streamed
      back, so very large outputs are bounded by the isolate's memory limit.
- Job lifecycle and statuses:
  - `queued` → (poll) `running` + `claimedAt` → `done` + `fileId/size/finishedAt`, or
    `failed` + `error`.
  - `GET /api/render/<id>`: `404` if the record is gone; if `done` and a `fileId` exists it
    returns the MP4 as `attachment; filename="<sanitised name>.mp4"` with
    `Content-Length` and the stored content type; if `failed` it returns `500` with the stored
    error; otherwise the status JSON.
    - Restriction: the MP4 filename is sanitised to `[A-Za-z0-9_-]` only.
  - Any job stuck in `running` for more than `10 * 60 * 1000` ms is reaped to
    `failed "worker timed out"` by the **next poll** (`/api/worker/poll`).
- Job claiming is not atomic.
  - `listRenderJobs()` lists `job:` keys and then `Promise.all`-gets them; the poll handler
    picks the first `queued` job, flips it to `running`, and re-`put`s it.
    - Restriction: two workers polling in the same instant can both read `queued` and both
      start rendering the same job (last writer wins; the second delivery overwrites the first).
      KV has no compare-and-swap here.
    - Restriction: there is no backoff, lease renewal or worker identity — a worker that dies
      is only detected after the 10-minute reaper, and only when another worker polls.

---

## RULE 5 — The current-day settings route in worker mode is the only job consumer

- The worker tab polls `/api/worker/poll` on a self-rescheduling `setTimeout`: **3 s** on
  success, **5 s** after a network error, and stops immediately when **Stop worker** is pressed.
  - The tab must stay open and focused enough to keep timers running; closing it stops the
    whole worker silently (no server-side registration/heartbeat).
  - In worker mode `window.__workerMode = true` is set for the duration of the job.
    - Effect: `generateMP4()` skips `showSaveFilePicker` and, on the in-memory path, keeps the
      final Blob on `window.__lastRenderBlob` instead of clicking a download anchor.
    - Effect: the same browser therefore must be able to encode the whole job **in memory**,
      including the 250 MB confirmation — which is a `confirm()` dialog no one is watching.
      A `false` answer would yield `skipped` and thus "render produced no output".
- Delivery: `POST /api/worker/deliver?job=<id>` takes the **raw body** as the MP4.
  - Empty body → `400 "Empty file"`; unknown job → `404`; success stores `file-<jobId>` and
    marks the job `done`.
  - Failure reporting: `POST /api/worker/failed?job=<id>` with `{error}`; the message is sliced
    to 300 chars. A worker that fails *before* calling this leaves the job `running` until the
    10-minute reaper.
- Each worker rebuilds the job from the wire format.
  - Asset base64 → `File` objects; kind is inferred from filename/extension/type
    (`.gif`/`image/gif` → GIF, `.mp4`/`.m4v`/`video/mp4` → MP4, else still image);
    MP4s are probed with a `<video>` element for duration; `job.project` rebuilds the title,
    font, colour, sticker, quality and caption rows; subtitles come from
    `job.project.subtitles`.
  - Restriction: the worker renders with the *caller's* settings but the *worker tab's* fonts
    and browser — an operator on a slow machine makes the whole queue slow, and any per-frame
    rendering difference (font availability) shows up in the delivered file.

---

## RULE 6 — AI images: one fixed SDXL model, two entry points, no size control

- Model: `MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0"` (`src/prompts.ts`), used by
  both image routes through `env.AI.run(MODEL, { prompt })`.
- `GET /image/:index` — the demo slots.
  - `index` must be an integer inside `prompts[]` (currently 2 entries) or `400`.
  - Response headers: `Content-Type: image/png`, `Cache-Control: no-store`, `X-Image-Index`.
    - Restriction: the studio's visible UI no longer uses this route, yet the page still calls
      it twice on load: the legacy card builder does
      `prompts.forEach((_, index) => fetchAIImage(index))` into the (later hidden) `#gallery`.
      That is **two Workers AI image generations per page view** whose output is never shown.
      `fetchAIImage` only early-returns when its DOM nodes are absent — and they are present.
- `GET /image/gen?prompt=&variant=` — the per-video AI panel.
  - `prompt` is required (`400 "Missing prompt"` otherwise); `variant` is echoed back in
    `X-Image-Variant`; also `Cache-Control: no-store`.
  - Dispatched through the shared Node.js-style non-blocking `sharedImageTaskQueue`
    (`src/modules/image-queue.ts`, keyed per user/IP group — see RULE 28). The server appends
    `", 16:9 landscape, a completely text-free image"` to the prompt, condenses prompts to
    `IMAGE_MODEL_PROMPT_MAX_CHARS = 1800`, sends `IMAGE_NEGATIVE_PROMPT` banning both text/scripts
    and anatomical/structural distortion (`distorted, deformed, bad anatomy, extra/fused fingers,
    warped perspective, bent architecture, …`), sets `guidance: 7.5` on 20-step SDXL base, heals
    odd sub-1024 dimensions via `sdxlSafeDimensions()`, falls back to
    `@cf/bytedance/stable-diffusion-xl-lightning` and `@cf/black-forest-labs/flux-1-schnell`, and
    renders at `IMAGE_WIDTH = 1024` / `IMAGE_HEIGHT = 576` (16:9) defaults. The panel's hint says
    **landscape 16:9 · 1024×576** for exactly that reason; the old "480 px landscape" wording (and
    the unused `AI_IMAGE_WIDTH = 854` / `AI_IMAGE_HEIGHT = 480` pair next to it) never described a
    rendered file. See `toberesolved.md` A1-A3.
  - Client behaviour: each submit schedules **2 parallel requests** (`variant` 1 and 2, dispatched
    through `manualImageTaskQueue` inside `Promise.all`, not one after the other).
    - Restriction: while *this* video's script & style walkthrough is rendering its images
      (`project._imageFlowActive`), its **✨ Generate 2 Images** button is disabled
      (`setVaAiGenerateEnabled(n, false)`, re-enabled in `finalizeImagePromptFlow()`), and
      `submitAiImages(n)` refuses a programmatic click. The lock is per video: another
      accordion's button stays live and may generate at the same time.
    - The results panel keeps at most 4 cards; generating again while it holds 4 clears it
      first (revoking the object URLs).
    - "+ Add to Video" wraps the PNG in a `File` and pushes it as a normal still image, so it
      counts against the 25-image cap of that video.
    - If both variants fail the client `alert`s the last error; if one fails the status line
      reads "1 of 2 failed: <error>".

---

## RULE 7 — SEO keyword frequency is minimum-only; short/long-tail overlap is allowed and there is no long-tail length rule

> **Canonical rule (2026-10-24):** the one long-tail keyword must appear **at least once**; each
> of the four short keywords must appear **at least twice**. There is **no maximum** — extra
> uses are always valid and are never retried. Counts are measured on the spoken text only.
> Enforced by `keywordUsageError()`/`keywordUsageAudit()` with `SEO_LONG_FREQ_MIN = 1` and
> `SEO_SHORT_FREQ_MIN = 2`, covered by `tests/script-seo.test.mjs`.
>
> **Payload update (2026-10-25, Session #242):** the answer is a **plain narration script**, not an
> SRT file. Cue timing remains the server's *internal* working format — it is what makes overlap,
> duration and per-cue keyword auditing possible — but it is converted by `plainScriptFromCues()`
> before the response, and no client, tooltip or stored project field mentions SRT any more. The
> keyword rules, the validators and the retry counts are unchanged.

- **Current contract (2026-10-24), enforced in `src/modules/script-seo.ts`:**
  1. Exactly **one nonempty long-tail keyword**, spoken **at least once** (1 or more uses).
     There is **no maximum use count** and **no minimum or maximum word count or character
     length** for that keyword. A one-word or >6-word long-tail phrase is valid;
     title/topic/heading limits are separate rules.
  2. Exactly **four unique short keywords**, each **1–3 words** and spoken **at least twice**
     (2 or more uses each). There is **no maximum use count**. The existing restriction against
     containment among the four shorts remains; it no longer applies between short and long-tail
     roles.
  3. **Minimum-only enforcement:** extra uses are always valid. `keywordUsageError()` and the
     keyword audit only report a keyword that falls *below* its minimum, so a third or fourth use
     of a short keyword is accepted rather than retried. Each keyword in the response carries its
     `min` and `max: null` (unbounded). The canonical constants are `SEO_LONG_FREQ_MIN = 1` and
     `SEO_SHORT_FREQ_MIN = 2`; there is deliberately **no** `SEO_LONG_FREQ_MAX` or
     `SEO_SHORT_FREQ_MAX`.
  4. AI title: **≤70 characters**, including at least one short keyword.
  5. **1–12 headings**, each **≤12 words**, at least one including a short keyword. The same
     short may appear in the title and a heading; those metadata strings are not spoken SRT.
- **Overlap is explicitly allowed, not a validation failure.** If `yoga` is a short and
  `morning yoga poses` is the long-tail, every long-tail use also counts as a `yoga` use: one
  long-tail use already supplies one of the two `yoga` uses, so one standalone `yoga` use
  reaches the minimum. Identical phrases may serve both roles; a one-word long-tail contained in
  a longer short also shares its occurrences. Every measured total must reach its minimum
  (long-tail **≥1**, each short **≥2**); extra uses are allowed.
- Request: `POST /api/script {topic, minutes, speed}`.
  - Topic defaults to `my video`, normalizes whitespace/control characters and caps at 160
    characters; that is **not** a long-tail keyword length restriction.
  - Minutes: integer **1–6**, default 1; invalid → `400 "Minutes must be 1-6"`.
  - Speed: `super fast | fast | medium | slow`, targeting 210/170/140/110 words per minute;
    invalid → `400`; missing AI binding → `503 "AI binding not configured"`.
  - Usage tracking happens after request validation; scripts remain unlimited on all plans.
- **Two AI stages** on `@cf/meta/llama-3.1-8b-instruct-fp8`, **three attempts per stage**:
  1. **Planner:** JSON `{title, headings, longTail, short:[s1,s2,s3,s4]}`; 1024 output tokens,
     temperature 0.55 first, 0.4 on retries. Output token budgeting is a model call setting,
     not a keyword word/character rule. `parseKeywordSet()` accepts string/object/array
     long-tail shapes, deduplicates shorts and checks the title/heading contract.
     - No mutually-exclusive short/long-tail requirement and no 2–6-word gate remain.
     - The prompt states the minimum frequency (long-tail ≥1, short ≥2, extra uses allowed),
       allows shared phrases, and explains that a short nested in the long-tail needs fewer
       standalone uses.
     - Three rejected plans → `500 "SEO keywords invalid (<reason>) - try again"`; no writer call.
  2. **Writer:** natural spoken explainer SRT only; tokens scale from 2048 to 4096 with duration,
     temperature 0.65 first, 0.4 on retries. `keywordOverlapInstructions()` computes concrete
     minimum-frequency and shared-use guidance, including how many additional standalone uses a
     short nested in the long-tail still needs given the long-tail minimum. Title/headings steer structure but are
     not read verbatim. The subtitle line-length target is prompt guidance, not a validator cap.
     - Server re-checks SRT and **measured** keyword totals after each response. Retry coaching
       includes the preceding valid SRT, each keyword's count/cues and the exact number of uses
       still missing; a keyword at or above its minimum is explicitly marked KEEP. Over-use is
       never a failure, so no removal coaching exists.
     - Three rejected scripts → `500 "Script output invalid (<reason>) - try again"`.
- **Matching and SRT invariants:** `keywordCount()` uses Unicode letter/number boundaries,
  escaped literal symbols, typography normalization and equivalent whitespace/hyphen runs.
  `café`, `c++`, `c#` and `.net` are supported; glued substrings such as `ai` in `said` do not
  count. `srtSpokenText()` joins spoken lines/cues, so long phrases may span subtitle breaks.
  - `validateSrt()` strips fences/control characters and leading/trailing model commentary,
    preserves numeric dialogue, canonicalizes cue indexes and validates comma-millisecond
    timestamps. Cue start < end, cues never overlap, and total duration is **10 seconds to
    selected minutes × 60 seconds + 1.5 seconds**. These rules have not been relaxed.
  - Keyword audits compare the long-tail count against **≥1** and every short count against
    **≥2**; there is no upper bound, so `ok` means "minimum reached". Title/headings, cue
    numbers and timestamps are not included. First-violation errors still name the role, phrase,
    measured total and required minimum, e.g.
    `the short keyword "a" appears 1 time(s); it must appear at least 2 time(s)`.
- Success:
  `{success:true,script,format:"plain",title,headings,keywords:{longTail:{keyword,count,min:1,max:null},short:[{keyword,count,min:2,max:null}]},lines,words,durationMs,minutes,model}`
  — there is **no `srt` key**; `script` is the validated cues as prose paragraphs (4 sentences per
  paragraph, a blank line between them). A body that still posts `srt` is accepted and converted by
  `plainScriptFromSrt()`, and `lines`/`words`/`durationMs` are recomputed from the plain text.
  (`max: null` = no upper bound; every count is measured, never substituted).
  Optional debug output carries the correlated request ID and planner/writer attempt traces.
  Every successful count is measured, never substituted with the required value.
  Each successful request uses at least two model calls, at most six with retries; live model
  failures remain possible and are reported as errors, not silently replaced with unverified SRT.
- Client side (`src/client/app-js.ts`, video accordion):
  - The SEO block is the **first** `.va-section` of `.va-left`, titled
    **"Generate SEO Script With AI"**, with the always-visible hint line
    `SEO rule (explainer): 1 long-tail keyword said at least 1× · exactly 4 short keywords said at least 2× each · minimums only, extra uses are allowed · one short keyword is in the title · one is in a heading · short/long-tail overlap is allowed and shared uses count for both · no long-tail length rule`
    and a matching button tooltip. See RULE 18 for the hint inventory.
  - Originally the client sent only `{topic, minutes, speed}` and the user never picked keywords.
    **Superseded by RULE 24:** the walkthrough now has the user pick one of two planned sets and
    sends it back as `keywordSet`; the server re-validates it with `parseKeywordSet` and skips
    the planner, otherwise this bullet still applies. The UI still only *reports* the title,
    headings and counts the model produced and the server verified.
  - On success `generateScript()` stores `project.script` (+ `project.scriptDurationMs`), `project.seoTitle` and
    `project.seoHeadings`; **if the video title input `#va-title-N` is still empty it is autofilled
    with `title.slice(0, 70)`** (the input's `maxlength` is 70, so the SEO title always fits); it
    fills `#va-script-box-N`, renders the SEO plan chips into `#va-script-keywords-N`
    (`renderSeoKeywords(n, data)` — a Title row, a Headings row, the long-tail chip and the 4 short
    chips, each count shown as `N×`, every string passed through `escapeHTML()`), reveals the plain
    script box (`#va-script-box-N` + `.va-script-text`, labelled "Script" and collapsible through
    **"▼ Script"**) and calls `syncVoiceoverButton(n)`, which reveals + enables
    **🎙 Generate Voiceover** — the button ships hidden (`style="display:none"` + `disabled`) in the
    accordion markup and stays hidden for as long as the video has no generated script.
  - The status line reads
    `Script ready — N lines (<speed> speech, <minutes> min) · SEO: 1 long-tail (≥1×) + 4 short keywords (≥2× each) · title + K heading(s)`.
  - Restriction: a failed request is retried client-side (`SCRIPT_RETRY_LIMIT = 2`, so **3 attempts**
    in total, mid-flight status `Script failed (<reason>); retrying (N of 2)...`), and only then does
    the status line become `Script failed after 3 attempts: <error>`; the previous chips and script
    box stay on screen — nothing is cleared or replaced, and both buttons are re-enabled on every
    path so a failure never needs a page reload.
- **Future: scripts without SEO / non-explainer scripts (documented, NOT implemented).** The whole
  SEO layer is isolated so a future plain-script mode can bypass it without touching anything
  else: the rules live only in the `SEO_*` constants, `parseKeywordSet()`, the stage-2 SEO brief
  and `keywordUsageError()`. A non-SEO mode skips stage 1 (the planner), uses `basePrompt` without
  the SEO brief, skips `keywordUsageError()`, and returns the payload without
  `title`/`headings`/`keywords`; request validation, `validateSrt`, the retry loops, the credit
  telemetry and the client script box all stay exactly as they are. (Since Session #242 the client
  box already *is* plain text, so such a mode is a server-side change only.)

---


## RULE 8 — Voiceover is MeloTTS with defensive sanitising, chunking, retries and layered fallbacks

- `POST /api/voiceover` with `{text, lang}` (`src/modules/voiceover.ts`, invoked after the credit
  gate in `src/index.ts`):
  - `env.AI` missing → `503`; empty or non-speakable text after cleaning (no Unicode
    `/[\p{L}\p{N}]/u` letter/digit) → `400 "No script text to speak"`; `lang` must be one of
    `en, zh, es, fr, hi, it, ja, ko` → else `400`.
    - Restriction: the UI locks the voice select to **English only** (`disabled` select). The
      other seven languages are reachable only by calling the API directly.
  - Text cleaning before synthesis (`sanitizeVoiceoverText`, each step exists because upstream
    MeloTTS failed with `AiError 3043` on 0-phoneme or malformed inputs):
    - strip URLs, markdown syntax, control/zero-width characters, and lone surrogates;
    - cap at **8 000 characters** — with a surrogate-pair guard so an emoji is never cut in half;
    - normalise `—`/`–` → `-`, `…` → `...`, curly quotes → straight quotes, NBSP → space, and
      collapse standalone symbol/emoji runs.
  - Chunking (`splitVoiceoverChunks`): sentences, clauses, and words are packed into chunks of at
    most **`VOICEOVER_CHUNK_MAX = 400` characters** (with surrogate-pair-safe hard splits on
    unbroken tokens) and re-filtered so every emitted chunk contains speakable `/[\p{L}\p{N}]/u`
    characters.
    - Restriction: chunks are synthesised **sequentially** in a `for` loop, so a long script is
      as slow as the sum of its chunks.
  - Per chunk: up to **3 attempts** on `@cf/myshell-ai/melotts` with `400 ms * attempt` backoff;
    for English (`lang === "en"`), if MeloTTS fails, falls back stickily to native Workers AI MP3
    models (`@cf/deepgram/aura-2-en`, `@cf/deepgram/aura-1`), and finally to
    `FALLBACK_TTS_URL = "https://tts-api.netlify.app/"` under a 15 s timeout with strict audio
    magic-byte / `Content-Type` validation (HTML/JSON error pages are rejected).
  - Output normalisation: each chunk's audio is accepted as `Response`, `ArrayBuffer`,
    `Uint8Array`, `ReadableStream`, `{byteLength}`, `{arrayBuffer()}`, base64 string, or
    `{audio: base64}`.
  - Container handling (`joinVoiceoverPieces`): if **every** piece starts with `RIFF`, the fmt
    chunk of the first piece and the data chunks of all pieces are reassembled into one valid WAV
    (correct RIFF sizes, 28-byte header) and returned as `audio/wav` + `voiceover.wav`; otherwise
    leading duplicate ID3v2 headers on chunks `2..N` are stripped (`stripMp3Id3Tag`) before
    concatenating as `audio/mpeg` + `voiceover.mp3`.
    - Restriction: mixed containers (some WAV, some MP3) silently fall into the "MP3" branch and
      produce a file that players may not decode cleanly. Documented as "rare".
  - The response is always `Content-Disposition: attachment` — the browser downloads it; it is
    never auto-attached as the video's audio track.
- `/tts` is a separate, simpler proxy of the same free engine.
  - `GET /tts?text=&lang=`; `text` required (`400`), hard cap **2 000 characters** (`400`).
  - Restriction: it always labels the response `audio/mpeg` with `Cache-Control: no-cache`,
    even if the upstream returned WAV — this route does no container detection.

---

## RULE 9 — Media limits are per video, and the audio track dictates the video length

- Per-video caps (enforced in the accordion uploader and reused by the AI panel):
  - `MAX_IMAGE_UPLOADS = 25` still images (`app-js.ts:60`).
  - `MAX_GIF_UPLOADS = 5` GIFs (`app-js.ts:56`).
  - `MAX_MP4_UPLOADS = 5` MP4 clips (`app-js.ts:64`), each `MP4_MAX_DURATION_S = 60` s
    (`app-js.ts:68`), probed at upload time.
    - Any file that is neither GIF nor MP4 is treated as a still image.
    - Hitting a cap raises an `alert` **and stops processing the rest of that upload batch**
      (`break`), so later files in the same pick are silently dropped.
  - A template-composed MP4 is inserted as a normal MP4 asset and counts against the same
    5-clip cap (it is ≤ 25 s, so the 60 s rule never bites).
- Video length rule: **the MP3 is the timeline.**
  - Stills and GIFs occupy `SLIDE_SECONDS_MIN = SLIDE_SECONDS_MAX = 9` s each
    (`app-js.ts:1251`), i.e. always exactly 9 s.
  - MP4 slides occupy their own full duration.
  - With audio, `getSlideSequence()` repeats the asset list from the beginning until the track
    is covered, and the final slide is copied with `_partialSec` set so it ends exactly with the
    audio (`while totalSeconds < duration - 0.05`, hard guard `10000` iterations).
  - Without audio the video is one pass over the assets.
  - `getSecondsPerSlide()` still computes `audioDuration / slides` but is clamped to 9..9 — the
    dynamic-timing behaviour is inert by design (min === max).
- Upload handling invariants:
  - Each input's `value` is cleared right after reading so the same file can be re-selected.
  - Object URLs are created per asset and revoked on removal; GIF frame data is decoded lazily.
  - The gallery DOM order **is** the render order (`syncVaOrder` rewrites `project.assets`
    from the card order after a drag-and-drop).
  - `updateVideoStatus()` recomputes the header summary ("N images · N GIFs · N MP4 (m:ss) ·
    MP3 m:ss · N captions") and `refreshVaTips()` renumbers the card tooltips `#1 …`.

---

## RULE 10 — Overlays are drawn per frame with fixed geometry

- Title (top-left):
  - `TITLE_FONT_SIZE = 22` canvas pixels, `TITLE_MARGIN = 24` px (`app-js.ts:167,171`);
    input `maxlength="70"`; fonts Oswald (web font, preconnected from Google Fonts) / Bauhaus /
    Bookman; colours white / black / green.
  - Drawn straight onto every frame — no background box, no highlight.
- Sticker (bottom-right):
  - A white rectangle `STICKER_WIDTH = 435` × `STICKER_HEIGHT = 150`, square corners
    (`STICKER_RADIUS = 0`), flush to the bottom-right and deliberately hanging
    `STICKER_EXCEED_RIGHT = 40` px past the right edge — the stated purpose is covering a
    watermark.
  - 7 presets: none, 👍 Like, ❤️ Love it, 🔔 Subscribe, 👍🔔 Like & Subscribe, 🎬 Watch Video,
    🎬👍🔔 Watch, Like & Subscribe; emoji rendered from a system emoji stack with per-emoji
    measurement and a label layout that auto-shrinks text between
    `STICKER_TEXT_MIN = 14` and `STICKER_TEXT_MAX = 16` px.
- Timestamp captions (bottom area):
  - Max `MAX_CAPTIONS = 10` rows; each row is `hh:mm:ss` + up to `CAPTION_MAX_CHARS = 40`
    characters (input `maxlength`).
  - 17 px Bookman, black text on a **white highlight rectangle with square corners**, centred
    at `y = height - height*4/7` (4/7 of the height up from the bottom).
  - A caption stays on screen until the next caption's timestamp; the **last** caption is cut
    off after `CAPTION_MAX_VISIBLE_MS = 10 000` ms.
- Subtitles (the cues derived from the plain script by `buildScriptCues(script, totalMs)` — a
  sentence split, 84-character wrapping and a 1 200 ms floor per cue; no timestamp file is read):
  - 22 px Bookman, white text on a translucent black box (`rgba(0,0,0,0.55)`, padding 10 px ×
    6 px, box height = font size + 16), centred at `x = width/2`,
    `y = height - height/3` (1/3 up from the bottom) — deliberately **below** the caption band
    (captions sit higher, at 4/7).
  - Only the cue whose `[startMs, endMs)` contains the current frame timestamp is drawn; more
    than one cue at that instant is impossible because the server rejects overlapping cues.
  - Applied per video via `project.subtitles` (parsed cues), toggled by the voiceover modal;
    the render context carries them into every local render, the API job and the worker render.

---

## RULE 11 — Output encoding is fixed: 30 fps H.264 + AAC, quality presets only

- Quality presets (`QUALITY_PRESETS`, `app-js.ts:1188`):

  | Preset | Resolution | Video bitrate | Audio bitrate |
  | --- | --- | --- | --- |
  | `low` (480p · Light) | 854 × 480 | 1 200 000 | 128 000 |
  | `balanced` (720p · Balanced, default) | 1280 × 720 | 2 500 000 | 160 000 |
  | `high` (720p · High) | 1280 × 720 | 5 000 000 | 192 000 |

  - `FPS = 30` is a constant, not configurable (`FPS` in `app-js.ts`); `KEYFRAME_INTERVAL = FPS * 10`
    (10 s) and creates no visual transitions.
  - The canvas is resized to the preset before encoding, otherwise `VideoFrame` and
    `VideoEncoder` disagree on dimensions.
  - There is no codec, container, orientation or CRF choice exposed anywhere.
- Audio path:
  - The MP3 is decoded with the Web Audio API (`decodeAudioData`), then re-encoded to AAC.
  - `encodeAudioTrack` caps channels at 2, reuses one `Int16Array(1024 * channels)` PCM block,
    and maps each encoder output back to its timestamp via a `pendingTimestamps` queue.
  - The audio track is written **first**, so the muxer only declares an audio track when real
    AAC chunks exist; otherwise the MP4 is silent.
  - Audio is trimmed to `VIDEO_SECONDS`; if the video were longer than the audio, the remainder
    would be silence — but the repeat logic prevents that case.
- Muxing and memory:
  - `fastStart: false` on purpose: `"in-memory"` (fastStart) keeps every chunk until finalize
    and is what crashed tabs; the trade-off is the metadata lands at the end of the file.
  - Streaming target uses `FileSystemWritableFileStreamTarget(fileStream, {chunkSize: 8 MB})`;
    the fallback is `ArrayBufferTarget` and a Blob download.
  - Memory safety net: when **not** streaming, `estimatedBytes = seconds * (videoBitrate +
    audioBitrate) / 8`; above **250 MB** the user must confirm "may crash the tab"
    (declining returns `skipped`).
  - Encoder backpressure: `waitForEncoder()` blocks while `encodeQueueSize > 12`
    (`MAX_ENCODE_QUEUE` in `app-js.ts`) and rethrows any asynchronous encoder error.
  - Progress bar: audio owns the first 25 %, video frames the remaining 75 %.
  - Cleanup always closes the encoder and aborts a half-written file stream.

---

## RULE 12 — GIFs are decoded one frame at a time under a memory budget

- The client ships its own GIF pipeline (no library): LZW decode → de-interlace → per-frame
  compositing → disposal handling → `{width,height,frames[],startMs[],loopMs}`.
- Memory guard: `BUDGET_BYTES = 120 MB` for all stored frames
  (`frames * w * h * 4`); if exceeded, every frame is downscaled by
  `sqrt(BUDGET / raw)` clamped to a floor of `0.15` (`BUDGET_BYTES` in `app-js.ts`, 120 MB).
  - Restriction: huge GIFs still decode at full size first; the budget only limits what stays
    in memory, and the floor means a pathological GIF can still exceed the target.
- At render time a scratch canvas holds the current GIF frame; the frame index is derived from
  the video-frame timestamp modulo the GIF loop duration (`gifFrameIndexAt`), so GIF timing
  stays independent of the 9 s slide length.

---

## RULE 13 — One scene gallery, shared Graphics elements, and a 5–7-image ring upload editor

- The composer remains an isolated IIFE; only `window.openTemplateModal` and
  `window.closeTemplateModal` are public. The same deterministic canvas engine powers preview
  and MP4 export. See `new_requirements.md` §6 for individual requirements and acceptance tests.
- **Gallery:** one **Interactive scenes · 15** grid, with the 14 Reel designs plus scene 15,
  **3D Ring Carousel**. No Motion or Graphics/Shape-animation tab, cards, grid or standalone
  shape editor remains in the DOM. There is no "Scenes · 15 editable designs" accordion or
  `tm-scene-list` in any template configuration; **← Templates** returns to the gallery.
- **Text and graphic elements (the 14 Reel templates):**
  - Tags below the preview select elements; canvas click selects the frontmost visible object,
    and dragging moves it. Text, font, colour, alignment, size, speed, animation, transition,
    visibility/deletion/restoration and X/Y remain editable. **＋ Text** changes to **＋ Graphic**
    when a graphic is selected and adds an offset clone of its graphic settings. The active
    **Delete element** button shares the panel header row with that add control; it is hidden for
    background/no selection. The former **Shapes & stickers** heading and sticker-box grid are
    absent from this scene editor.
  - **+ Front layer** / **- Back Layer** move one element **one step** forward/backward.
    Their placement stays fixed and both use the same neutral `.tm-tool` button treatment as the
    top-right **Pause** control. Buttons disable at the ends; deleted objects are skipped.
    `reelElementKeys()` supplies
    the same saved order to the tag list, renderer and hit-testing; new objects append on top.
    Background is not a reorderable element and always stays behind them. The gear's hole
    uses even-odd fill rather than erasing lower layers.
  - **Rotate degrees:** **0–360°, 1° steps**, saved per element, with a live readout. Static
    rotation combines with entry/loop animations and redraws even while paused. Hit rectangles
    are transformed with the canvas matrix; inverse-transform hit tests follow rotated objects.
    Exactly the same rotation/order is used for MP4 frames, not a CSS-only effect.
  - Compact colour boxes retain 12 solids, custom colour and four gradients. Animated geometry
    uses solid main/accent colours from that palette (gradient tokens resolve to a solid stop
    for the geometry's own multi-colour fills).
- **Graphics dropdown:** 22 choices — the nine original stickers/shapes plus all 13 non-particle
  MotionGenie objects (47–54 and 56–60): Morphing SVG Blob, Rotating 3D Box, Pulsing Ripple Ring,
  Floating Glass Card, Orbiting Satellite, DNA Helix Pulse, Infinite Tunnel Zoom, Kaleidoscope
  Spinner, Elastic Bounce Ball, Audio Equalizer Bars, Diamond Crystal Spin, Neon Laser Beam,
  Shimmer Spinner Ring. Confetti Burst Canvas and all particle effects remain excluded.
  - `REEL_GRAPHIC_OBJECTS` registers these as `motion:<kind>` scene graphics. They have
    main/accent colours, size (20–480 base pixels, default 240 on selection), speed, X/Y,
    rotation, layer order, visibility, add/clone and delete controls; no separate background
    picker or independent export engine is created. Original shapes keep a 20–160 size range.
- **3D Ring Video Template (gallery name: 3D Ring Carousel):**
  - One carousel object with visibility, automatic rotation speed (0–3×), radius (55–145%),
    card size (50–150%), 3D tilt (-30°–30°), whole-ring rotation (0–360°), X/Y and reset.
    Cards remain perspective/depth sorted (380-unit base radius, 240×344 base cards,
    1200-unit perspective, -6° tilt, 21°/second spin at 1×).
  - A **Ring images** accordion is the **last control section**, shown only on this template.
    Choose **5–7 image files together** to replace the complete set. Both count boundaries
    and successful decoding are required. Reject invalid counts, non-images and corrupt batches
    inline; keep the previous set intact. There is no silent truncation or partial replacement.
  - Display thumbnails, names and count. Removal works only above five; reset keeps images.
    Replacement/removal revokes unused object URLs; superseded decodes cannot overwrite newer
    files. A decode finishing after a template switch cannot show ring controls on that template.
  - Preview and export use the actual uploaded count/images. Download/Add stay disabled until
    5–7 images are decoded, and during upload/export. Upload changes are blocked during render.
    Six bundled mood images provide preview-only samples; there are no remote ring-photo URLs.
    Uploads are browser-session-only, separate from the normal two background photos.
  - Only the reference's ring is ported; flip book, audio, ambient particles, page chrome and
    external UI dependencies are not. Its cards are one carousel, not independent text layers.
- **Export:** portrait 1080×1920 or landscape 1920×1080; **1–25 seconds**, default 6.
  WebCodecs H.264 `avc1.4d002a`, 30 fps, 6 Mbps and in-memory `mp4-muxer`, no capture/FFmpeg.
  Download MP4 is the only download action. Add to Video renders the same frames without an
  anchor download, probes the MP4 and inserts it into the target accordion (normal five-clip cap).
  Closing/reopening reuses scene state in memory; reload discards it. Clips are silent.
- Modules: `template-composer-js.ts` (modal/export), `template-scene-editor.ts` (elements/order/
  transforms/Graphics registry), `template-ring-carousel.ts` (ring/uploads),
  `template-shape-animations.ts` (13 object renderers), `reel-scene-assets.ts` (bundled samples).

---

## RULE 14 — The bulk queue is strictly sequential and non-reentrant

- `onGenerateClick()` refuses to start while `generating` is true, and validates the whole
  stack first:
  - no accordions → modal "Click the red + button to add a video first."
  - any accordion with zero assets → modal listing every offending video.
- `runGenerationQueue()` processes `n = 1 … N` **one at a time**; each video fully finishes
  (or fails) before the next begins.
  - Restriction: `VIDEO_BATCH_SIZE = 2` exists and is described in two comments as batch
    rendering, but the loop never reads it — the batching behaviour described in the comments
    is not implemented.
  - The engine's own state (hidden panels, `activeSlides`, `currentAudio`, caption row
    elements, title/font/colour/sticker/quality) is snapshotted before the run and restored
    after, because the queue "borrows" the legacy single-video engine to render each video.
    - Consequence: the queue is not reentrant; `renderVideoLocally()` (the API-busy fallback)
      respects the same `generating` flag and `alert`s if a bulk run is in progress.
- The bulk banner (`#bulk-banner`) warns: "do not move or delete your image or MP4 files until
  it finishes" — asset files are only read at render time (they are kept as `File` references).
  - Restriction: moving/renaming/deleting the source files before rendering breaks the run.

---

## RULE 15 — Data lifetime is bounded by KV TTLs, and nothing is persisted client-side

- KV key families:
  - `user:<lowercased username>` — no TTL (permanent).
  - `email:<lowercased address>` — no TTL (signup uniqueness index; plaintext address).
  - `session:<hex token>` — no TTL (permanent until logout).
  - `job:<jobId>` — TTL 3600 s.
  - `blob:<id>:<part>` and `blob:<id>:_idx` — TTL 7200 s (payloads *and* delivered MP4s).
  - `config:workers` — no TTL (single JSON string).
  - `config:theme` — no TTL (one of `default | strata | stellar`).
  - `credits:<lowercased username>` — TTL 2 days (RULE 20 daily counters).
  - `ipcredits:<40-hex hash>` — TTL 2 days (RULE 21 guest counters).
- Consequences to state plainly to users:
  - a delivered MP4 is downloadable for roughly 2 hours, and its job record disappears after 1;
  - a browser tab close discards all studio work (no localStorage/IndexedDB usage at all);
  - accounts, sessions, the email index and the two config keys are permanent, so any KV cleanup
    must be manual; the two credit families are the only TTL-bounded user data and simply start
    a fresh day at zero after they expire.

---

## RULE 16 — Build, deploy and verification rules

- `wrangler.json`: `main = src/index.ts`, `compatibility_date = 2025-10-08`,
  `ai.binding = AI`, `observability.enabled = true`, `upload_source_maps = true`, and one KV
  namespace binding `KV_BINDING` with a **hard-coded production namespace id**.
  - Restriction: without `KV_BINDING` the app still boots, but auth answers `503` and all
    render/worker routes answer `503 "Render storage not configured (bind the KV namespace)"`.
    The two open config GETs keep working: `/api/config/theme` self-defaults to `"default"` and
    `/api/config/workers` returns `200 {success:true,urls:[]}` (Bug Fix Session #211); their
    `POST`s answer `503`.
  - Restriction: TypeScript types come from `worker-configuration.d.ts` via
    `"types": ["./worker-configuration.d.ts"]`; run `npm run cf-typegen` after changing bindings.
- Scripts: `dev` (`wrangler dev`), `deploy` (`wrangler deploy`), `check` (`tsc && wrangler
  deploy --dry-run`), `cf-typegen`, `e2e:dev`
  (`wrangler dev --config wrangler.e2e.jsonc`).
- E2E config (`wrangler.e2e.jsonc` → `e2e/index.ts`) re-exports the worker with a stubbed `Env`
  whose `AI.run` returns a fake PNG signature and which has **no KV**.
  - Restriction: under e2e the image routes are happy-path only, the render API/worker routes
    return `503`, and the auth API returns `503` (which the client treats as "open access").
    Tests cannot exercise anything KV-backed without adding a binding.
- The repository ships `src/index.ts.original` (21 009 lines) next to the split modules; it is
  reference-only and must not be wired back in (`.gitignore` ignores `*.orig`, but this file is
  tracked as `.ts`).

---

## RULE 17 — Known contradictions, dead code and points of drift

- **Comment vs code – video cap:** `addVideoAccordion()`'s comment says "max 7" (video-count comment, unrelated to the removed user cap) while
  `VIDEO_MAX_VIDEOS = 10` and the button tooltip says "Add a video (up to 10)".
- **Comment vs code – batching:** `VIDEO_BATCH_SIZE = 2` is described as batch rendering but is
  never read; the queue is sequential.
- **Dead status:** `STATUS_COLORS` defines `queued`, but no client code assigns it to a video.
- **Dead dimensions:** `AI_IMAGE_WIDTH = 854` / `AI_IMAGE_HEIGHT = 480` exist while comments
  also mention "832x480"; nothing passes them to the model, and the route can't accept
  dimensions at all.
- **Unused demo cost:** the page still runs 2 Workers AI image generations on load into a
  hidden gallery (see RULE 6).
- **`/tts` mislabels containers:** always `audio/mpeg`, even for WAV bytes (see RULE 8).
- **Racy job claim:** two workers can claim the same job (see RULE 4).
- **Non-atomic uniqueness:** the duplicate-username/email checks are read-then-write, so two
  simultaneous signups can both succeed with the same username or email (see RULE 2). The old
  7-user cap that this entry used to describe no longer exists.
- **Entry UI is not the security boundary:** the account overlay and settings unlock are client
  UI, but their APIs enforce sessions, credits and the settings password server-side. The current
  settings unlock calls `/api/config/verify`; it is not the removed client-only `===` gate.
- **Duplicated SEO copy:** the client's SEO hint text and chip tooltips (RULE 18) are hand-copied
  from the Worker's `SEO_*` constants (RULE 7): changing a constant without changing the copy
  leaves the UI stating the old rule, and nothing fails loudly.
- **Hard-coded operator configuration:** the settings password and model ids
  (`MODEL`, `SCRIPT_MODEL`, `VOICEOVER_MODEL`) live in Worker source. The password has one active
  constant; the older client-side duplicate exists only in the unimported `.original` snapshot.
- **Unbounded-job detail:** a `busy` response is treated as success-with-fallback rather than an
  error by design — do not "fix" it to `429`, the client depends on `200 + status:"busy"`.

---

## RULE 18 — User-visible hints are contract text (the UI hint inventory)

> The app explains itself with copy, not with a manual: tooltips (`title=`), grey note lines
> (`.va-note`, `.audio-note`, `.tpl-tips`, `.action-hint`), fixed placeholders, status lines and
> blocking `alert()` boxes. The inventory below was taken on **2026-10-15** and re-taken on
> **2026-10-23** after the explainer SEO rule set revision (RULE 7). Changing a limit or a rule
> without changing these strings leaves the UI lying to the user.

- Discovery pattern for an audit: search `title="`, `placeholder="`, `alert(` and
  `class="…note…"` / `class="…hint…"` / `class="…tip…"` in the three template literals that become
  the page — `src/client/app-js.ts` (`APP_JS`), `src/client/markup.ts` (`PAGE_MARKUP`) and
  `src/client/template-composer-js.ts` (`TEMPLATE_COMPOSER_JS`).
- Historical counts, measured on the two served pages on 2026-10-23 after Bug Fix Session #240
  **before** the current dynamic template controls (those additions are documented in RULE 13):
  **22 tooltips · 7 placeholders · 35 `alert()` call sites** (33 in the studio script: 27
  `app-js.ts` + 6 `template-composer-js.ts`; 2 in the settings script) **· 17 note/hint/tip class
  usages** in the page markup (13 of them predate Bug Fix Session #206) plus **7 notes/status
  elements** built by the settings script — ≈ 88 user-visible hint strings.
  - Per source file: `app-js.ts` 27/13/5 (alerts/tooltips/placeholders), `template-composer-js.ts`
    6/7/1, `markup.ts` 0/2/1, `config-page-js.ts` 2/0/0.
  - Bug Fix Session #240 moved the Add Video button into the page heading and added the top bar,
    the two views and four status lines — one extra tooltip (**Generate** in the top bar) and
    four extra status elements (`#batch-note`, `#concept-count`, `#preview-state`,
    `#batch-empty`), all listed below. No new `alert()` and no new placeholder.
  - Bug Fix Session #206 added the credits/guest strings listed below (auth overlay notes, the
    credits popover, the `401`/`429` bodies, the settings guest table) **and one alert** — the
    pre-submit quota box in `submitAiImages()` — which is why the alert count moved from 34 to 35.
    The tooltip/placeholder counts did not change.
  - Restriction: every one of them is a literal inside a template literal, and the client has no
    access to the Worker's constants - each number in a hint is a **hand-copied duplicate** of a
    constant, i.e. the same drift risk as the hard-coded settings password (RULE 3) and the
    duplicated model ids (RULE 17).

### Hints that mirror a limit or a rule (change them together)

| Hint text (abridged) | Where it lives | Mirrors |
| --- | --- | --- |
| `SEO rule (explainer): 1 long-tail keyword said at least 1× · exactly 4 short keywords said at least 2× each · minimums only, extra uses are allowed · one short keyword is in the title · one is in a heading · short/long-tail overlap is allowed and shared uses count for both · no long-tail length rule` | video accordion, SEO section (`.va-note`, always visible) | `SEO_LONG_TAIL = 1`, `SEO_SHORT_TOTAL = 4`, `SEO_LONG_FREQ_MIN = 1`, `SEO_SHORT_FREQ_MIN = 2` (no `*_FREQ_MAX`; RULE 7) |
| `AI plans 1 long-tail keyword (said at least once), exactly 4 short keywords (each said at least twice) plus the explainer title and headings, then writes the plain narration script around them. Extra uses are allowed. Short keywords may overlap the long-tail (shared uses count for both); no long-tail length rule.` | **✨ Generate SEO Script** button tooltip | the same SEO constants |
| `Long-tail keyword — must be said at least 1×` · `Short keyword — must be said at least 2×; shared occurrences inside the long-tail count too; one short keyword is in the title and one in a heading` · `Explainer title — includes at least one short keyword` · `Section heading — at least one heading includes a short keyword` | SEO plan chips, `renderSeoKeywords()` tooltips (the `N×` shown is the measured count, which may exceed the minimum) | `SEO_LONG_FREQ_MIN = 1`, `SEO_SHORT_FREQ_MIN = 2`, title/heading inclusion rules (RULE 7) |
| `Max 5 GIF · 25 images · 5 MP4 (1:00 each, silent)` | video accordion, media section (`.va-note`) | `MAX_GIF_UPLOADS = 5`, `MAX_IMAGE_UPLOADS = 25`, `MAX_MP4_UPLOADS = 5`, `MP4_MAX_DURATION_S = 60` |
| `2 images per submit · landscape 16:9 · 1024×576` (placeholder: `Describe the image (always landscape 16:9, 1024×576)`; success line: `Done — landscape 16:9 · 1024×576`) | video accordion, AI images section (`.va-note`, doubles as the status line) | two `GET /image/gen` requests of one image each, rendered by `runImageModel()` at `IMAGE_WIDTH = 1024` / `IMAGE_HEIGHT = 576` (the old `480px landscape` copy was wrong — `toberesolved.md` A2/A3) |
| `Add a video (up to 10)` | `+ Add Video` button tooltip | `VIDEO_MAX_VIDEOS = 10` |
| `Caption text (max 40 characters)` | caption row placeholder (accordion + main panel) | `CAPTION_MAX_CHARS = 40` |
| `Each caption appears centred horizontally at 4/7 of the height from the bottom, in 17px Bookman … The last caption is capped at 10 seconds on screen.` | main panel caption note (`.audio-note`) | `CAPTION_FONT_SIZE = 17`, `CAPTION_MAX_VISIBLE_MS = 10 000`, overlay geometry (RULE 10) |
| `The slideshow repeats to cover the whole track.` | main panel audio note | slide timing: the asset list loops to cover the MP3 (RULE 9) |
| `MeloTTS (Cloudflare AI) speaks the script as an English MP3 (one fixed voice). The MP3 can be uploaded as this video's audio track.` | voiceover modal note | `/api/voiceover` with the locked English select (RULE 8) |
| `Speak the script to MP3 with MeloTTS (English) + apply it as subtitles` | **🎙 Generate Voiceover** tooltip | the two modal actions (voiceover + subtitles toggle) |
| `One row — one video` (`#batch-note`, rewritten live as `N rows · M with a script`) · `Type or paste a script in the first box, pick the video image style, the minimum minutes, the AI image resolution and the frame orientation, then press ✨ Generate at the top right of the table. … a row that is empty is skipped, and so is a row that is already finished … Three rows render at the same time. …` | **Quick batch table** (`.card-note`, `.va-note.batch-hint`) | `BATCH_ROW_LIMIT = VIDEO_MAX_VIDEOS = 10`, minutes 1-6, `BATCH_RUN_CONCURRENCY = 3`, `batchRowPending()`, `batchRowFinished()` (RULE 25) |
| `Add another row (10 rows at most)` · `Generate every row that has a script and is not finished yet: voiceover, AI images and the animation, three rows at a time` | `#batch-add-row` / `#batch-generate` tooltips | the row cap, the three-lane pipeline and the finished-row skip (RULE 25) |
| `480px` / `540px` / `720px` / `1024px` and `Square 1:1` / `Landscape 16:9` / `Portrait 9:16` (plus the live `W×H` hint under the resolution select) | Quick batch table columns 4-5 (`batch-resolution-select`, `batch-orientation-select`) | `BATCH_RESOLUTIONS`, `BATCH_ORIENTATIONS`, `batchRowDimensions()` client-side and `imageFrameFor()` worker-side (RULE 25) |
| `No rows yet — press ＋ Add Row, paste a script, pick a style and press ✨ Generate.` | `#batch-empty` | the table is seeded with one blank row **once**, so an emptied table stays empty (RULE 25) |
| `Plain narration script - the words the voiceover reads. Timestamps are not needed.` | the accordion's **▼ Script** tooltip | the plain-script payload of `/api/script` (RULE 7) |
| `Compose a portrait or landscape MP4 (max 25 seconds) from a design template …` | `Add video from template` tooltip | the composer caps 1-25 s (RULE 13) |
| `+ Front layer` / `- Back Layer` · `Layer N of M` | text/graphic inspector | one-step saved paint order; disabled at boundaries (RULE 13) |
| `Rotate degrees` + live `N°` readout | text/graphic and ring inspectors | 0–360°, 1° steps; real canvas rotation (RULE 13) |
| `Ring images · N / 7 (min 5)` / `Choose 5–7 images together …` | bottom ring-image accordion and inline upload status | 5–7 decodable images, atomic replacement, same cards in preview/export (RULE 13) |
| `Tip: each template is a looping motion design … The clip is silent …` (motion editor) / `Scene text, stickers and animated backgrounds are rendered into the exported clip …` (Reel scene editor) | composer panel (`.tpl-tips`, changes with editor mode) | the active editor controls + the silent-clip rule (RULE 13) |
| `Theme for the studio page — every visitor sees it. Aerial and Stellar follow the HTML5UP designs of the same name; Night Lab, Warm Paper, Swiss and Neo Brutalist are the studio's own skins.` | settings page, Appearance group (`.cfg-note`) | RULE 19 (seven skins, global setting) |
| `Built-in dark studio (default)` · `Blue sky, mountains, white accents` · `Violet gradient, frosted panels` · `Charcoal lab, lime accent` · `Warm light paper, coral accent` · `Clean white, electric blue` · `Cream, hard black lines, lime` | theme cards (`.cfg-theme-sub`) | what each skin in `CONFIG_THEMES` looks like |
| `Current theme: Studio (default).` / `Current theme: Night Lab.` / `Current theme: Neo Brutalist.` | Appearance status line (`themeLabel()`) | the value stored under `config:theme` |
| `Preview only — press Save theme to apply it for everyone.` | Appearance status line after picking | the preview is client-side only (RULE 19) |
| `Saved — reload the studio page to see the new theme.` | Appearance status line after saving | server-side injection on the next page render |
| `Free plan: 70,000 AI images every day · unlimited videos, AI scripts and voiceovers.` / `Paid plan (paid_user): 1,200 AI images every day.` | auth overlay (`.auth-plan-note`) | `CREDIT_PLANS.free/paid_user.limits` (RULE 20) |
| `No account? Open the free studio — 10 AI images a day, counted per IP address.` | auth overlay (`.auth-guest-note`, link to `/free`) | `GUEST_PLAN.limits.images = 10`, `ipcredits:` keying (RULE 21) |
| `Daily credits` · `Video projects Unlimited` · `AI images N / limit left today` · `AI scripts Unlimited` · `Voiceovers Unlimited` · `Used today: n images · n scripts · n voiceovers` · `Renews in Nh Nm (midnight UTC+8)` | credits pill + popover (`.credit-pill`, `.credit-popover`) | `CREDIT_PLANS`, `creditSummary()`, `creditResetsAt()` (RULE 20) |
| `Create a free account — 70,000 images/day` | guest credits popover (`.credit-signup`) | the `free` plan's image limit vs the guest's 10 (RULE 21) |
| `Daily image credits used up (N images/day on the <plan> plan). Credits renew at midnight (UTC+8).` + `Create a free account for 70,000 images per day.` (guests) | `429` body, shown in `#va-ai-status-N` and the quota alert | the same plan limits + the guest upgrade path (RULE 20/21) |
| `Sign in to generate AI images — every free account gets 70,000 images per day. No account? Open /free for 10 images per day.` | `401` body from `/image/gen` | the `free` and guest image limits |
| `Free: 70,000 AI images per day. Paid (paid_user): 1,200 AI images per day. … Counters renew every day at midnight (UTC+8).` | settings page, Accounts Credits (`.cfg-sub`) | `CREDIT_PLANS` + `creditResetsAt()` (RULE 20) |
| `Guest credits by IP` / `Visitors who never sign in (GET /free) get 10 AI images per day. …` | settings page, guest table (`.cfg-group-title`, `.cfg-note`) | `GUEST_PLAN`, the `ipcredits:` table (RULE 21) |

### Blocking `alert()` boxes (35 — the app's only modal feedback)

- Media intake: `You can add at most <n> images (jpg, png, jpeg).` / `… GIFs.` / `… MP4 clips.`,
  `'<file>' is <n>s long. Each MP4 clip must be at most 1:00.`, `'<file>' could not be read as an MP4 clip.`,
  `Could not read that audio file. Please upload a valid MP3.`,
  `Could not decode that GIF animation. It was added as a still image instead.`,
  `You can add at most 10 videos.`
  Inside an accordion the three media caps are prefixed with `Video <n>: ` (e.g.
  `Video 2: you can add at most 5 GIFs.`).
- AI images: `Enter an image prompt first.`, `Image generation failed: <error>`, and the
  pre-submit quota alert
  `Daily image credits used up (N images/day on the <plan> plan). Credits renew at midnight (UTC+8).`
  (guests also get `Create a free account for 70,000 images per day.`).
- Render: `Please wait for images to generate or upload your own!` (also gates the **🎬 Generate
  Videos** button), `<project>: add at least one image, GIF or MP4 first.`,
  `A video is already being generated — please wait for it to finish.`,
  `Your browser does not support WebCodecs. Please use modern Chrome, Edge, or Safari.`,
  `Your browser cannot encode audio (WebCodecs AudioEncoder missing). Rendering a silent video.`,
  `Audio could not be encoded. Rendering a silent video.`,
  `Video rendering failed: <error>\n\nTry reducing the number of images or closing other browser tabs.`
- Render API (**☁️ API**): `API error: <error>`, `API: <message>`, `API: job expired or not found.`,
  `Render failed: <error>`.
- Composer: `The MP4 muxer failed to load. Reload the page and try again.`,
  `Your browser does not support WebCodecs. Please use modern Chrome, Edge, or Safari.`,
  `Video export failed: <error>`, `Video N: you can add at most 5 MP4 clips.`,
  `The composed file could not be read as an MP4 clip.`,
  `The composed file is <n>s long. Each MP4 clip must be at most 1:00.`
- Restriction: **the AI script never alerts.** A failed script is retried and only then writes
  `Script failed after 3 attempts: <error>` into the section's `.va-note` status line, so the
  previous script and its SEO chips stay on screen (do not "fix" this into an alert — it is
  deliberate, so a retry can start immediately).
- Restriction: `alert()` is the **only** modal feedback and it blocks the UI thread; long-running
  flows therefore report progress through the per-video `#va-status-N` / `#va-script-status-N`
  status lines and only use an alert for the terminal failure.

### Onboarding and empty-state hints

- `Click ＋ Add Video above, then press Generate.` (`.action-hint` in the preview card; the
  button it names is the **＋ Add Video** control in the page heading, and **Generate** exists
  twice by design — `#render-btn` in the action bar and `#top-generate` in the top bar).
- `One row — one video` → `N rows · M with a script` (`#batch-note`),
  `N of 10 videos` (`#concept-count`), `idle` → `table generating` (`#preview-state`) and
  `No rows yet — press ＋ Add Row, paste a script, pick a style and press ✨ Generate.`
  (`#batch-empty`). `#batch-note` and both button labels are written by `updateBatchToolbar()`, the
  rows and the two editor counters by `renderBatchTable()`, so the two views cannot disagree; the
  `10` in the count is a hand-copied duplicate of `VIDEO_MAX_VIDEOS` (= `BATCH_ROW_LIMIT`), the same
  drift risk as the rest of this table.
- `Pick a template — each preview is the real animation` (composer status),
  `Preview:` (main panel caption preview).
- Placeholders: `Enter your video title...` (main panel + accordion), `Topic (uses the video title
  if empty)`, `Describe the image (always 480px landscape)`, `Text (max 12 chars)` (composer
  text-layer input).
- Restriction: the settings page reports through status lines (`.cfg-note`, `.cfg-status`) for
  the theme save and every guest-table action, so a failed theme save leaves the picker usable;
  only the worker-URL save uses `alert()` (`Save failed: …` — 2 of the 35 call sites).
- Restriction: inside a video accordion the *only* explanation of the SEO rule is the always-visible
  `.va-note` line under the section title - the keyword chips appear only **after** a successful
  generation, so the rule must be readable *before* the first click. That is why the hint line is
  static markup (`videoAccordionHTML()`) and not generated together with the chips.

---

## RULE 19 — The studio ships seven skins, chosen globally on the settings page

- Seven looks, selected by the `data-theme` attribute on `<html>`; **absence of the attribute is
  the default** (the amber-on-charcoal studio look that shipped first).
  - `strata` — legacy API/storage value for **Aerial**: blue sky and a bundled mountain
    backdrop, diagonal overlays, white type and translucent blue panels, adapted from
    HTML5 UP Aerial by @ajlkn (CC BY 3.0; see `THIRD_PARTY_NOTICES.md`). Saved Strata
    choices get the new look without a KV migration. Motion respects reduced-motion settings.
  - `stellar` — pink-to-violet 45° gradient backdrop with a fixed dot overlay and frosted
    translucent panels (same provenance: HTML5UP "Stellar").
  - `nightlab` — charcoal lab (#0b0d12 backdrop, #141923 panels) with a lime `#baff61` accent
    and 15px corners. The first of the four skins ported from the uploaded
    `video_bulk_production` reference (Bug Fix Session #240).
  - `paper` — warm paper (#f0ece3 / #fffdf7) with a coral `#e85f42` accent, dark ink and soft
    corners; the light skin with the most surface texture.
  - `swiss` — white (#f4f5f7 / #ffffff) with electric blue `#2364f5`, tight corners and no
    shadow; the neutral light skin.
  - `neo` — cream (#f6f3e9 / #fffdf5) with lime `#d8ff00`, 2px `#111` borders, a hard
    `4px 4px 0 #111` shadow and uppercase labels; the brutalist skin.
  - Restriction: the four new skins changed **colour tokens only**. The layout they sit in is the
    same for every skin (RULE 22) — exactly like the uploaded reference, where one markup serves
    all four of its skins.
  - Restriction: the CSS is **additive**. Every rule is scoped `html[data-theme=…]` (or
    `html[data-theme]`), so without the attribute not a single declaration applies and the default
    look is byte-identical to before the feature.
- Storage and API:
  - one KV key, `config:theme`, value
    `default | strata | stellar | nightlab | paper | swiss | neo`, no `expirationTtl`. The three
    pre-#240 values keep working unchanged; no KV migration was needed to add four skins.
  - `GET /api/config/theme` → `{success, theme, themes:[default,strata,stellar,nightlab,paper,
    swiss,neo]}`; open (no password). The `themes` array is what the picker renders, so the
    settings page and the whitelist cannot drift apart by omission.
    - Restriction: it is the only config GET besides `/api/config/workers` that answers
      anonymously; it leaks nothing but the skin name, and the page itself already carries it.
  - `POST /api/config/theme` `{pw, theme}` → `403` wrong password, `400 Unknown theme` (anything
    outside the whitelist, including lowercase misses and attribute-injection attempts),
    `503 Theme storage unavailable` if the KV write throws.
  - Restriction: only the seven whitelisted strings can ever be written or injected — the value
    is lower-cased and checked against `CONFIG_THEMES` **before** the key is touched, and
    `applyTheme()` only ever builds `data-theme="<name>"` from that whitelist. `NEO` is accepted
    as `neo`; `bogus` is a `400`.
- Injection is server-side, so there is no flash of the wrong theme:
  - `applyTheme(html, theme)` rewrites a **copy** of the cached page at the literal
    `<html lang="en">` → `<html lang="en" data-theme="<name>">` for any of the six non-default
    names; `default` returns the cached string untouched (1 `String.replace` for a themed page,
    0 for the default).
  - Every HTML route does it: `GET /`, `/free`, `/studio`, `/paid` (the three plan routes
    through `appPageResponse()`) and `GET /{current-day}/config/uvxyz`.
  - Restriction: it costs **one extra KV read per page render** (see `kv-scale-test.md` §5) and
    cannot be cached across requests, because a theme change must apply on the next load.
  - Degradation: no `KV_BINDING` → `default`; a throwing `KV_BINDING.get` → `default` (the page
    still serves 200 — a broken KV never takes the studio down); a throwing `put` → the JSON `503`
    above.
- The picker lives in the settings page's **Appearance** group (RULE 3) and previews instantly by
  setting/removing `data-theme` on `document.documentElement`.
  - Restriction: the theme names exist in **four** places that must be kept in step — the worker
    whitelist (`CONFIG_THEMES`, `src/index.ts`), the CSS token block (`html[data-theme="…"]`
    in `src/client/styles.ts`), the picker's `themeOptions` array
    (`src/client/config-page-js.ts`) and the card's swatch class
    (`.cfg-preview-<name>`). A new theme needs all four; the worker's `400` is the only guard
    against a half-added theme, and a missing swatch only degrades to an empty chip.
  - Restriction: `applyTheme()` matches the literal `<html lang="en">`; changing that tag (for
    example adding a second attribute in `markup.ts`) silently disables theming everywhere.
  - Unrelated to the theme: the studio's *rendered* output (fonts, colours, sticker, captions) is
    fixed in the render engine (RULE 10/11) and never follows the UI skin.

### UI refinements (2026-10-15)

- Stellar `.studio` and `.video-accordion` surface alpha is reduced **relatively by 10%**:
  `0.12 × 0.9 = 0.108`. This changes background alpha, not element opacity; text remains sharp.
- Stellar accordion backdrop blur is increased **by 20%**: `8px × 1.2 = 9.6px`.
  CSS blur has no percentage unit. Other surfaces retain their existing 8px blur.
- The template composer keeps all five designs in a single native, labelled dropdown.
  The old grid and miniature canvases are removed. The main preview and its canvas have
  `height`, `min-height`, and `max-height` of **80px** in both orientations.
  `object-fit: contain` preserves proportions; export remains 1080×1920 or 1920×1080.
  **Superseded 2026-10-18** — the composer was rebuilt around the 8 motion-typography
  templates (RULE 13): a 4-column live-preview gallery replaces the design dropdown and the
  80px strip; the five photo designs are gone.
- Editor values have labels beneath them. Blur/opacity sliders show live numeric values.
  The sticky Add/Close footer centers its buttons on both axes.

### UI refinements (2026-10-23)

- Every `button` inside `#video-accordions .video-accordion` now has a **48px minimum width and
  height**, **12px 24px padding**, **1rem** type and **1.25** line-height in all seven themes.
  This matches the Upload Image button's proportions and supersedes the older compact-control
  rules; wide disclosure buttons remain full width.
- `html[data-theme="neo"] #video-accordions .video-accordion button` sets `border-radius: 0`,
  including API, disclosure, card-remove and caption-remove controls. Other themes keep their
  existing radius tokens.
- The 13 non-particle animated objects are now scene elements in the **Graphics** dropdown
  (RULE 13), not a separate gallery. They add no server route, persisted state or particle engine.

---

## RULE 20 — Daily credits are per-account, plan-based and reset in Asia/Taipei

- Every user record (`user:<username>`) carries `usertype`; `free_user` and any missing/unknown
  value read as the canonical `free` plan (so pre-credits accounts keep working).
  - `free` — unlimited video projects, unlimited AI scripts, unlimited voiceovers and
    **70,000 AI images per day**.
  - `paid_user` — the same unlimited tools plus **1,200 AI images per day**.
  - New accounts are written with `usertype: "free"` by `POST /api/signup`.
- Today's counters live in `credits:<username>`:
  `{day:"YYYY-MM-DD", videos, images, scripts, voiceovers, updatedAt}` with a 2-day TTL.
  - The `day` stamp is authoritative: a record from an earlier day parses back as all-zero usage
    and is rewritten by the next consume, so no cron / scheduled Worker is needed.
  - The boundary is midnight Asia/Taipei (UTC+8, no DST); `creditDay()` and `creditResetsAt()`
    use a fixed `+8h` offset and the API reports the next reset as an ISO timestamp.
  - Restriction: the TTL only garbage-collects dormant accounts; the reset itself is lazy and
    depends on a request arriving.
- Enforcement is server-side; the client is only a hint.
  - `GET /image/gen` — with KV bound it resolves a session → the account plan, else the
    `yvs_free` freemium cookie → `GUEST_PLAN` (RULE 21), else `401`. It consumes one `images`
    credit *before* the model runs and **refunds** it when `env.AI.run` throws. At the daily
    limit it answers `429 {success:false,error,credits}`; success responses carry
    `X-Credit-Plan`, `X-Credit-Images-Limit`, `X-Credit-Images-Remaining`, `X-Credit-Day`,
    `X-Credit-Reset` and `X-Credit-Scope` (`account` or `ip`).
  - The two fixed demo prompts on `/image/:i` are samples and stay unmetered (the landing page
    fetches them before anyone signs in).
  - `POST /api/script` and `POST /api/voiceover` are unlimited; their counters increment as
    best-effort telemetry and a credits failure can never fail the route.
  - With `KV_BINDING` unbound (open-access/e2e mode) there is no gate and no counting, which
    preserves the previous behavior.
- `GET /api/credits` returns
  `{usertype, plan:{id,label,limits}, day, resetsAt, used, remaining}`; a `null` limit/remaining
  field means "unlimited".
- Plan changes are a settings-page DB operation:
  - `GET /api/config/users?pw=…` lists up to 50 accounts with plan, today's usage and remaining
    allowances (one user read + one credits read per account).
  - `POST /api/config/users {pw, username, usertype, resetCredits?}` rewrites
    `user:<name>.usertype` and optionally deletes `credits:<name>`.
  - Both are password-gated (`403`) and KV-gated (`503`); the plan change applies on the account's
    next request because every credit read re-reads the user record.
  - There is no automated payment provider. "Paid" means an operator either set
    `usertype: "paid_user"` directly or approved an uploaded receipt with a verified transaction
    number (RULE 23). Both paths reread the same user record on the next request.
  - Restriction: the settings password is one shared constant hard-coded in Worker source, not a
    per-admin credential. A public deployment should move it to a secret and add per-user roles;
    real billing still needs a payment provider.
  - Restriction: KV is eventually consistent, so concurrent generations can overshoot by the
    in-flight count; the overshoot is bounded and self-corrects at the next daily reset.
- Client:
  - `/api/session`, signup and login already return `plan` + `credits`; the studio paints the
    fixed `.credit-pill` (plan + `N / limit left today`) and its popover (unlimited rows, used
    today, reset countdown).
  - `submitAiImages()` pre-checks the remaining images, stops the variant loop on `401`/`429`,
    applies the `credits` payload returned by a `429`, and refreshes `/api/credits` after the pair.
  - Sign-out clears the pill (`resetCredits()`); the account box shows a
    "Plan: … — … left today" line.

### UI refinements (2026-10-22)

- The landing page no longer carries a second, hand-mixed palette.
  `html[data-theme] .landing-page` remaps every `--landing-*` token to the active theme's `--t-*`
  tokens, makes the landing surface transparent so the skin's own body backdrop (Aerial sky /
  Stellar gradient) shows through, and re-skins the nav, buttons, preview card, feature cards and
  the new plan cards.
- `--landing-accent` now defaults to `var(--accent)` (the studio amber `#f59e0b`, previously
  `#f5ad57`); themed skins use the theme's heading/accent token (white).
- New landing section `#landing-plans` (nav link **Plans**) documents both plans and the nightly
  renewal at midnight UTC+8.

---

## RULE 21 — Plan-based URLs and the freemium (/free) guest tier

**Bug Fix Session #206.** The site serves the same studio shell from three plan-specific
addresses and gives visitors without an account a small, IP-metered allowance.

- **Actor types.** `anonymous` (no session, no freemium cookie), `guest` (no session, came
  through `/free`), `free` and `paid_user` (session). `guest` is an actor, not an assignable
  plan: `GET|POST /api/config/users` still accepts only `free` and `paid_user`.
- **URL matrix** (`PLAN_MODE_BY_ROUTE` + `appPageResponse()` in `src/index.ts`):

  | Route | anonymous | `free` | `paid_user` |
  | --- | --- | --- | --- |
  | `GET /` | landing | landing | landing |
  | `GET /free` | freemium studio + cookie | studio shell | studio shell |
  | `GET /studio` | `302 /free` | studio | studio |
  | `GET /paid` | `302 /free` | `302 /studio` | studio |

  - `/free`, `/studio` and `/paid` return the identical cached HTML plus
    `window.__PLAN_MODE` (`freemium` / `studio` / `paid`) and `Cache-Control: no-store`.
  - `/free` answers `200` for signed-in users too; the client keeps the account session, so
    the same URL works as a "try it" link and as the guest entry.
  - Restriction: the studio is client-side, so these routes are navigation boundaries, not a
    security boundary. The data boundary is the credits gate on `/image/gen`.
- **Freemium cookie.** `GET /free` sets
  `yvs_free=1; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`.
  - Anonymous `/image/gen` without the cookie is `401` (message points at `/free`).
  - The cookie only unlocks the IP bucket; it carries no identity and cannot raise the limit.
- **Guest plan (`GUEST_PLAN`).** `{id:"guest", label:"Guest", limits:{videos:null, images:10,
  scripts:null, voiceovers:null}}` — 10 AI images per day, everything else unlimited.
- **Per-IP counters.** Key `ipcredits:<sha256("yvs-guest:" + ip).hex.slice(0,40)>`.
  - Address source: `CF-Connecting-IP`, else the first `X-Forwarded-For` hop, else `"unknown"`
    (one shared bucket — fails closed at 10 images).
  - Record: `{day, videos, images, scripts, voiceovers, updatedAt, ip, maskedIp, hash, scope}`,
    TTL 2 days, same lazy Asia/Taipei rollover as `credits:<username>` (RULE 20). A model
    failure refunds the image and re-merges the identity, so the row keeps its masked address.
  - Only the masked address is persisted (`203.0.113.0` / `2001:db8:1:2::`); the raw address is
    never written.
  - Restriction: one bucket per egress address — a shared NAT gets 10/day for the whole network.
  - Restriction: KV is eventually consistent, so concurrent guest requests can overshoot by the
    in-flight count (same as accounts).
- **Enforcement.**
  - `GET /image/gen` resolves session → account plan, else `yvs_free` cookie → guest plan, else
    `401`. A model failure refunds the credit for both key types; success carries
    `X-Credit-Scope: account|ip` in addition to the RULE 20 headers.
  - `POST /api/script` and `POST /api/voiceover` remain unlimited for every actor; guests book
    usage against the IP record as best-effort telemetry.
  - `GET /api/credits` returns the guest summary (`authenticated:false, guest:true, scope:"ip"`,
    masked `ip`) for a freemium cookie instead of `401`.
- **Operator table.** `GET /api/config/ipcredits?pw=…` lists up to 50 guest rows
  (masked IP, hash, used, remaining, `updatedAt`); `POST {pw, key}` deletes one row (reset).
  Both are password-gated (`403`) and KV-gated (`503`). The settings page renders them as the
  **Guest credits by IP** table and hides the group in background-worker mode.
- **Client.**
  - `PLAN_MODE = window.__PLAN_MODE || ""`; on `/free`, a `401` from `/api/session` boots the
    studio as `authAccess = "freemium"` and paints the guest credits pill
    (**Guest · 10 / 10 left today**).
  - The guest popover adds **Create a free account — 70,000 images/day** (opens the sign-up
    overlay); the `429` body and pre-submit check add the same upgrade hint.
  - Signing out of `/free` returns to guest mode rather than the landing page.
  - The auth overlay links to `/free`; the landing nav, plans section and footer all link to
    the freemium studio.
- **Documentation.** The complete session record (matrix, payloads, privacy notes, test
  evidence) is `bug-fix-session-206.md`.


---

## RULE 22 — The studio shell is one state behind two views

- The studio page is a **shell** (top bar, page heading) around two sibling views inside
  `main.app-main`; exactly one carries `.active` and the layout block does the rest
  (`#studio-app .view { display: none }` / `.view.active { display: block }`):
  - `#view-table` — the **Quick Batch table**. Until Session #242 this was a read-only index of
    `videoProjects` (number, title, prompt excerpt, scene counts, MP3 length, state, **Open ↗**);
    it is now an editable sheet of its own rows (Script / Style / Min / Preview / Export), described
    in **RULE 25**. The read-only index and its **Open ↗** jump (`focusVideoInEditor(n)`,
    `[data-open]`) were removed with it: a batch row has no accordion to jump to. The tab is still
    labelled "▦ Bulk grid" in `#view-switch` while the card head reads "Quick batch table" — noted
    in `bug-audit.md` rather than "fixed", because the shipped label is what users see today.
  - `#view-editor` — the **Editor**: `.studio-card.editor-build` (`#video-accordions`) beside
    `.studio-card.preview-card` (canvas, progress, status, action bar). It is the boot view.
    The `#studio-app .studio` grid — shared by **every theme** — gives the preview monitor
    **35%** of the row (`minmax(0, 35fr)`) and the build column the wider **65%**
    (`minmax(320px, 65fr)`; `minmax(280px, 65fr)` at ≤1100px, stacked `1fr` at ≤860px).
    Inside each accordion, `.va-body` is **one column**: every `.va-section` (SEO script,
    Images / MP4s, **AI Images directly under the gallery**, Audio, Title, Captions, Sticker,
    Quality) stacks full width in `.va-left` with a 3px bottom margin.
- The switch is `#view-switch` → `[data-layout="table"|"editor"]`, handled by
  `setStudioLayout()`. The choice is a **module variable**; RULE 15 forbids client storage, so a
  reload always starts in the Editor.
- The grid is a **view, not a controller** (Bug Fix Session #240), and the batch table keeps that
  shape: nothing in `#view-table` touches the render engine's globals directly; it either calls the
  engine's own functions (`generateMP4`, `drawSubtitles`) or works on its own row objects.
  - The old read-only index renderer is gone: `renderBatchTable()` now paints `#batch-rows` from the
    table's own `batchRows` array and, at the end, still refreshes the editor counters
    (`#concept-count` = `videoProjects.length`, `#preview-state` = `table generating` while a row
    runs). The counters therefore agree with the accordions without the table ever writing to
    `videoProjects`.
  - ~~**Open ↗** calls `focusVideoInEditor(n)`~~ and ~~a delegated `input` listener on
    `#video-accordions` re-renders the grid when `#va-title-N` / `#va-ai-prompt-N` changes~~: both
    belonged to the read-only grid and were **deleted on 2026-10-25** (Session #242) once that
    markup was replaced — nothing emitted `[data-open]` any more and an accordion title edit had
    nothing to update in the table. `updateVideoStatus(n)` → `renderBatchTable()` is what keeps the
    counters in sync.
  - Restriction: the *grid* has **no bulk operations** — no checkbox column, duplicate, delete,
    search or queue badge, and no bulk export. The batch **table** adds exactly two batch-shaped
    controls, `#batch-add-row` and `#batch-generate`, and its Export is per row (RULE 25). The
    uploaded reference had more; this app does not, and neither view pretends to.
- Only **re-parenting** was allowed: `initVideoStudio()` hides `.audio-panel`, `.controls` and
  `#gallery`, moves `#render-btn` into `#action-bar`, and every handler looks nodes up by `id` or
  class — never by parent. The legacy panels live on in `.engine-panels`
  (`display: none` in CSS, so nothing flashes before the script runs) and their ids
  (`#file-upload`, `#upload`, `#quality-select`, …) are still in the DOM.
- **No timeline.** The reference's `.timeline` dock (`.timehead`, `.timebody`, `.cliprow`,
  `.playhead`, `.wave`) has no engine in this app, so no markup or JS is emitted; a
  `display: none !important` guard keeps a stray fragment from ever rendering.
- The shell is **global**, not per-skin (RULE 19): the seven skins recolour it through `--t-*`.
  Omitted because they had no function: the reference's left rail, metric strip, in-bar theme
  picker, preview hero / scene strip / detail grid / play button.
- The fixed credits pill is parked under the sticky bar with
  `#studio-app:not([hidden]) ~ .credit-pill { top: 78px }` (66px under 560px); on the landing page
  it keeps its own corner.
- Record: `bug-fix-session-240.md`, extended by `bug-fix-session-242.md` (the table became an
  editor — RULE 25 — and the modal stack made the two views' overlays coexist). The dangling
  leftovers of the old grid were removed in that session rather than kept "just in case"; the
  register is in `bug-audit.md`.

---

## RULE 23 — CMS, manual payments and the account dashboard share the shell but not the auth boundary

- **Modules.** `src/modules/cms.ts` owns CMS validation/KV/public rendering;
  `src/modules/payments.ts` owns gateway/receipt/approval routes; `src/modules/user-pages.ts`
  owns `/account` and `/upgrade`; `src/client/config-page-js.ts` owns their settings editors;
  `src/client/payment-upload-js.ts` owns the signed-in uploader. `src/modules/theme-shell.ts`
  supplies shared navigation and fullscreen image behavior.
- **Account dashboard (`GET /account`).**
  - Signed out → inline Sign In / Create Account; successful authentication reloads the page.
  - Signed in → escaped username/email, account type, live `GET /api/credits`, plan pill and up to
    six recent receipts. Free users get **Open Video Studio → `/studio`** and **Upgrade →
    `/upgrade`**; paid users get **Open Video Studio → `/paid`** and **View Upgrade & Payment
    Details → `/upgrade`**. The free `/studio` destination is intentional: `/free` is the guest
    entry, not the signed-in free-account dashboard destination.
  - `creditSessionUser()` rereads `user:<name>`; an approval or direct operator plan change thus
    affects the next credits/paid-route request without replacing the session cookie.
- **CMS pages.**
  - KV key `config:cms_pages` holds one JSON array, maximum **8** records. `GET /api/cms/pages`
    and `GET /<slug>` are public reads: every saved page is published; there is no draft state.
    List/create/update/delete under `/api/config/cms*` require the settings password and KV.
  - A slug is flat and lowercase-normalized: `^[a-z0-9][a-z0-9-_]{0,63}$`. Root, nested paths,
    query/fragment/space/backslash forms and reserved app/API slugs are rejected. A duplicate
    slug returns `409`. A new ninth page returns `400`; updating an existing id at the cap works.
  - A page has title (≤120 chars, slug-derived fallback), `pageLink` (top menu or footer),
    `createdAt`/`updatedAt`, and ≤100 blocks. Paragraphs are ≤20,000 chars; empty blocks drop.
    Images are HTTP(S) URLs ≤1,000 chars only—no file upload, data URI or `javascript:` URL.
    Public text/title/navigation values are HTML-escaped; consecutive images render two per row.
  - The settings Add Page editor supports paragraph, single-image and two-image-row buttons,
    reorder/remove, reset/new, saved-page edit/delete pills and an escaped live preview. Create
    and update share `POST /api/config/cms`; optional `id` selects update. Delete by id or slug
    releases a slot; if both are supplied, id takes precedence and only one record is removed. Public `/<slug>` matching occurs after built-in routes, otherwise `404`.
  - **Deleting a page / menu URL (Session #244).** Two affordances share one client function,
    `deleteCmsPage(page)`: the **Delete** button on each saved-page pill and **Delete This Page**
    beside *Save CMS Page* (`#cms-delete-btn`, visible only while `#cms-edit-id` is set —
    `setCmsDeleteEnabled()` in `editCmsPage()` / `resetCmsEditor()`). Both confirm, POST
    `{pw, id, slug}` to `/api/config/cms/delete`, then re-render the pills, the `N / 8` counter and
    the editor from the response's own `pages[]`. The Top Menu / Footer link is not cached anywhere:
    `applyCmsLinksToStudioHtml()` re-reads the KV list on every HTML response, so the link is gone
    on the next request.
  - Top/footer placement injects links into the shared shell/studio navigation. Without KV the
    public list is empty/public pages are `404`; password-gated CMS routes return `503`.
- **Manual local payments.**
  - There is **no automated charge, provider session or webhook**. `GET
    /api/config/payment-gateway` is public; its password-gated `POST` edits the gateway name,
    details and upload instructions stored at `config:payment_gateway`. `/upgrade` always shows
    those instructions, but mounts the uploader only for a session.
  - `POST /api/payments/upload` requires session + KV and accepts multipart or JSON/data-URL.
    PNG/JPEG/WEBP/GIF are detected from actual bytes, not only the filename/MIME declaration;
    maximum **5 MiB**. The client also validates type/size and posts an optional ≤240-char note.
    Success stores base64 bytes at `payment_img:<id>` and pending metadata at `payment:<id>`.
  - `GET /api/payments/my` returns only the session user's records. `GET
    /api/payments/image/:id` requires the owner; anonymous → `401`, another owner → `403`.
    Admin list/image routes use the settings password; admin image URLs carry it as a query
    parameter, so deployments must treat those URLs/logs as sensitive.
  - Admin review is paginated (default 5, maximum 24/page) with `all`/`pending`/`approved`
    filters. The implementation lists up to 500 metadata keys; status-filtered reads load that
    bounded set before paginating. User history scans a bounded recent set rather than providing
    a complete export. These are deliberate scale restrictions, not unlimited payment ledgers.
  - `POST /api/config/payments/approve` requires a nonempty transaction number (≤120 chars).
    `payment_txn:<lowercase-number-without-whitespace>` prevents the same number approving a
    different receipt (`409`). Success marks the receipt approved, writes that index and sets
    `user:<name>.usertype="paid_user"`; the next request receives 1,200 images/day and `/paid`.
  - Restrictions: there is no rejection/refund workflow, KV updates are not transactional, and
    concurrent approvals/generation remain subject to KV eventual consistency. The settings
    password is the same shared operator constant documented in RULE 20, not per-admin auth.

### Verification (2026-10-24)

- Local KV-backed route audit: **47 checks** for CMS create/edit/delete/public navigation,
  receipt ownership/upload/approval, immediate paid credits and free/paid dashboard actions;
  **17 more checks** for the CMS page/block caps and grouped-image/mixed-delete regressions.
- Real client markup/script harnesses: **22 CMS editor checks** and **21 payment uploader checks**.
  The template harness passed **133 checks / 31,106 canvas operations**, including ring fallback,
  controls and both MP4 destinations for ring and Shape scenes.
- Generated HTML/inline JS and CSS parsed; `/`, `/free`, `/account`, `/upgrade`, `/api/cms/pages`
  and the current-day settings route returned `200`; Wrangler deploy dry-run passed. TypeScript
  still has only the 36 pre-existing `src/index.ts` diagnostics, none in the changed modules.

---

## Documentation vs code — inconsistency register (2026-10-22)

> Produced by reading every Markdown file against the working tree at commit `e53796f`
> (`src/index.ts` 7,156 lines at that commit — 7,205 after the fix pass · `src/client/app-js.ts`
> 14,832 lines · served page 708,110 B with 1 inline script · CSS 420,563 B). Behavioural claims were re-checked by bundling the worker with
> esbuild and running it against a counting mock KV; counts were re-measured on the source with
> `grep`/`wc`; sizes come from `createHTML()` and the CSS parse.
>
> Severity: **H** = would give a reader the wrong access-control or data-retention model ·
> **M** = wrong behaviour, number, or API shape · **L** = stale copy, anchor, or historical table.
>
> **Status (2026-10-23): every finding below is fixed.** Twenty-one were documentation-only;
> §3.3 also needed a code change (`creditRefundKey()` now re-merges the guest identity on a
> refund), and §6.1 — found while fixing — needed a two-line guard.
> The entries are kept verbatim as the record of what was wrong; what changed is in the table
> below and in *Additional drift found while fixing*. Verification: the four mock-KV suites pass
> (43 + 11 + 8 + 15 = 77 checks), `npx tsc --noEmit` still reports only the pre-existing 48
> errors, and the live `wrangler dev` smoke test was re-run (`/free`, `/studio`, `/api/credits`,
> `/image/gen` refund).

| # | Resolution |
| --- | --- |
| 1.1 | RULE 2, RULE 17 and `userflow.md` §1 now list the anonymous routes and the three exceptions. |
| 1.2 | RULE 20 documents session → `yvs_free` → `401`, plus `X-Credit-Scope`; the `bug-audit.md` "Credits & plans" bullet was rewritten. |
| 1.3 | `README.md` routes table + freemium bullet and `userflow.md` §2 now say "when KV is bound"; the unbound open mode is stated. |
| 1.4 | RULE 1's route list now includes the plan routes, all five auth paths and the two config GETs, before the `404`. |
| 1.5 | RULE 3 and `bug-audit.md` #5 list all six password-checked endpoints; the theme/workers GETs are marked open. |
| 1.6 | `bug-fix-session-206.md` §3 split the row into one open row and one password row. |
| 1.7 | RULE 1, RULE 19 and `userflow.md` §7 say "every HTML route (five today)". |
| 2.1 | RULE 18 recounts 35 alerts (27 + 6 + 2), adds the quota alert, `Render failed:` and the `Video N:` cap messages, and the heading now says 35. |
| 2.2 | RULE 18 (table + RULE 3's card list) now quote the Aerial card, the Aerial group note and "Current theme: Aerial." |
| 2.3 | RULE 18 scopes "never alerts" to the theme save and names the two worker-save alerts. |
| 2.4 | `bug-audit.md`'s verified bullet is re-measured (21/7/35/17 ≈ 87) and defers to RULE 18 instead of restating counts. |
| 2.5 | RULE 2 and `kv-scale-test.md` §8 use 3-read session, 3-op login and 6-op signup (2 gets + 1 list + 3 puts). |
| 3.1 | RULE 15 lists all nine key families and their TTLs; the "permanent" sentence is scoped to the non-credit keys. |
| 3.2 | `bug-audit.md`'s verified list points at RULE 15's nine families. |
| 3.3 | **Code fixed (Bug Fix Session #211):** `creditRefundKey(env,key,kind,amount=1,meta=null)` merges the identity back after the state read, and the guest failure path passes `guestCreditMeta(creditGuest)`. Harness: a throwing `AI.run` returns `500` and the `ipcredits:` row keeps `ip`/`maskedIp`/`hash`/`scope`. Record: `bug-fix-session-211.md` §2. |
| 4.1 | `userflow.md` §3c shows `usertype:"guest"` plus the plan object. |
| 4.2 | `userflow.md` §3b/§3c describe the `<n> of 2 failed: <error>` status line and the final alert. |
| 4.3 | `userflow.md` §8 adds the `/free` guest boot and lists all five theme routes. |
| 4.4 | `userflow.md` §2/§6 and `bug-audit.md` #7 now describe the completion-order claim (no FIFO guarantee). |
| 5.1 | `userflow.md` header re-measured (≈7,200 / 14,832 lines, ~700 KB) and the `src/page.ts` comment was updated. |
| 5.2 | Drifted `path:line` references were replaced with function/constant names in RULE 3/11/19, `userflow.md` §9, `bug-audit.md` and `kv-scale-test.md` §4a; the table above is kept as the historical record. |
| 5.3 | `kv-scale-test.md` §2/§5 are labelled pre-fix measurements, §8's signup row is corrected to 2 gets + 1 list + 3 puts, and §4a now cites the pre-fix signup handler. |

### 1. Access control, gates and routes

**1.1 "Every data route is anonymous" — RULE 2, RULE 17, `userflow.md` §1. [H] — ✅ fixed 2026-10-23**
Doc says: RULE 2's heading promises *client-side-only enforcement* and its restriction says
"no route except the auth endpoints themselves checks a session. Every data/rendering endpoint
(`/image/*`, …) is anonymous"; RULE 17 repeats "every data route is anonymous"; userflow's actor
table says "All data routes (… `/image/*` …) are unauthenticated".
Code does: `/image/gen` resolves the session before generating (`src/index.ts:355–424`), `/studio`
and `/paid` resolve it before serving the shell (`:167–216`), and `/api/credits` reads it as well.
Still anonymous: `/image/:i`, `/api/script`, `/api/voiceover`, `/tts`, `/api/render*`,
`/api/worker/*`, `GET /api/config/theme`, `GET /api/config/workers`.
Fix: replace the three passages with that list.

**1.2 `/image/gen` documented as session-only — RULE 20 and `bug-audit.md` "Credits & plans". [H] — ✅ fixed 2026-10-23**
Doc says: "with KV bound it requires a session (`401` otherwise)" and "requires `yvs_session` …
(`401` signed out, `429` at the daily limit)".
Code does: session → `yvs_free` cookie → guest plan (`GUEST_PLAN`, 10/day per IP) → only a request
with neither gets `401` (`src/index.ts:341–424`). Success also carries `X-Credit-Scope`
(`:496`). The audit bullet also contradicts its own "Bug Fix Session #206" section a few lines
below it.
Fix: add the guest step and `X-Credit-Scope` to RULE 20; reword the audit bullet.

**1.3 The `401` is documented as unconditional — `README.md` routes table + freemium bullet. [M] — ✅ fixed 2026-10-23**
Doc says: "`401` cold anonymous" and "Anonymous image generation is only unlocked by the
`yvs_free=1` cookie that `/free` sets".
Code does: when `KV_BINDING` is unbound the whole gate is skipped (`if (env && env.KV_BINDING)`,
`src/index.ts:355`) and generation stays free and unmetered — exactly as RULE 20 and
`bug-fix-session-206.md` §6 (resolution order, item 4) say. `userflow.md` §2 repeats the absolute claim.
Fix: write "with KV bound" in both places.

**1.4 Route order list — RULE 1. [M] — ✅ fixed 2026-10-23**
Doc says: `/` → `/image/:i` → `/image/gen` → auth API → KV guard → settings → `/api/script` →
`/api/voiceover` → `/tts` → `/api/render` → `/api/render/:id` → `/api/worker/*` →
`/api/config/theme` → `/api/config/workers`.
Code does: `/free` `/studio` `/paid` are matched immediately after `/` (`src/index.ts:167`), and
`/api/config/users` (`:4651`) and `/api/config/ipcredits` (`:5013`) are matched after
`/api/config/workers`, before the 404 (`:5207`).
Fix: extend the list (order is load-bearing: `/image/gen` is matched after `/image/:i`).

**1.5 Only two endpoints use the settings password — RULE 3 and `bug-audit.md` #5. [M] — ✅ fixed 2026-10-23**
Doc says: "Its server-side uses are `POST /api/config/workers` and `POST /api/config/theme`"; the
audit says "The only server-side checks are `POST /api/config/workers` and
`POST /api/config/theme`".
Code does: six endpoints compare the same constant — `POST /api/config/theme`
(`src/index.ts:4410`), `POST /api/config/workers` (`:4559`), `GET|POST /api/config/users`
(`:4662`/`:4668`) and `GET|POST /api/config/ipcredits` (`:5023`/`:5029`) — each returning
`403 Wrong password`.
Fix: list all six and keep the "the gate is not a real auth boundary" conclusion.

**1.6 `GET|POST /api/config/*` marked password-only — `bug-fix-session-206.md` §3. [L] — ✅ fixed 2026-10-23**
Doc says: a single row, "`GET|POST /api/config/*` | password | password | password".
Code does: `GET /api/config/theme` (`src/index.ts:4378`) and `GET /api/config/workers` (`:4506`)
answer anonymously; only the two GETs for users/ipcredits need `?pw=`. RULE 3, RULE 19 and
`userflow.md` §2 already say this correctly.
Fix: split the row into "theme/workers GET open, everything else password".

**1.7 "Both HTML routes" — RULE 1, RULE 19, `userflow.md` §7. [L] — ✅ fixed 2026-10-23**
Doc says: "Two routes `.replace()` a copy … and **both** HTML routes, which stamp
`data-theme="…"`"; "Both HTML routes do it: `GET /` and `GET /{current-day}/config/uvxyz`"; "(both
HTML routes stamp data-theme on `<html>` from then on)".
Code does: five routes serve the shell and all call `applyTheme()` — `/` (`src/index.ts:140`),
`/free` `/studio` `/paid` (through `appPageResponse`, `:6363`) and the settings page (`:898`).
Fix: say "every HTML route (5 today)" and stop counting them.

### 2. Credits, counts and UI contract text

**2.1 `alert()` counts and inventory — RULE 18. [M] — ✅ fixed 2026-10-23**
Doc says: "34 `alert()` call sites (32 in the studio script: 26 `app-js.ts` + 6
`template-composer-js.ts`; 2 in the settings script)", while the section heading says
"Blocking `alert()` boxes (31 …)".
Code does: 27 in `app-js.ts` + 6 in `template-composer-js.ts` = 33 in the page, plus 2 in
`config-page-js.ts` = **35**; `app-js.ts` is the file that is off (27, not 26; the quota alert at
`app-js.ts:8365` is one of the call sites the old count missed). The bullet list also omits the per-video cap alerts
(`Video N: you can add at most … GIFs/images/MP4 clips`, `:6744`, `:6762`, `:6779`, `:8766`), the
`Render failed: <error>` alert (`:11211`) and the quota alert itself.
Fix: recount to 35, and either add the five missing messages or state that the list covers distinct
messages only.

**2.2 Theme strings — RULE 18 table. [M] — ✅ fixed 2026-10-23**
Doc says: the theme cards are `Built-in dark studio (default)` · `Light panels, teal accents` ·
`Violet gradient, frosted panels`; the group note says "Strata and Stellar follow the HTML5UP
designs"; the status line is "Current theme: … / Current theme: Strata."
Code does: `Blue sky, mountains, white accents` for the Aerial card, "Aerial and Stellar follow
the HTML5UP designs of the same name", and "Current theme: Aerial." (the `themeOptions` array and
`loadTheme` in `config-page-js.ts`).
Fix: update the three strings (the rest of the repo already uses Aerial).

**2.3 "The settings page never alerts" — RULE 18 restriction. [L] — ✅ fixed 2026-10-23**
Doc says: "the settings page breaks the alert convention … it reports through status lines
(`.cfg-note`, `.cfg-status`) instead of `alert()`s".
Code does: the worker-save handler has two alerts (`alert("Save failed: …")`,
`alert("Save failed: network error")`) — RULE 18's own per-file line already says
`config-page-js.ts 2/0/0`.
Fix: scope the sentence to the theme save, which does use `themeStatus`.

**2.4 Tooltip/placeholder/alert totals — `bug-audit.md` "every claim verified" section. [L] — ✅ fixed 2026-10-23**
Doc says: "20 tooltips · 8 placeholders · 34 `alert()` call sites … ≈ 82 strings".
Code does: 21 `title="` · 7 `placeholder="` · 35 alerts. Per file, as alerts/tooltips/
placeholders: `app-js.ts` 27/13/5, `template-composer-js.ts` 6/7/1, `markup.ts` 0/1/1 and
`config-page-js.ts` 2/0/0. RULE 18 already quotes 21/7; only its alert number is wrong (see 2.1).
Fix: reference RULE 18 instead of restating the numbers.

**2.5 Signup and session operation counts — RULE 2 and `kv-scale-test.md`. [L] — ✅ fixed 2026-10-23**
Doc says: "session/login/signup cost a constant 1 read / 1 read + 1 write / 1 list"; the KV doc's
credits table says signup is "3 writes + 3 reads".
Code does: signup at a >200-key namespace is **2 gets + 1 list + 3 puts = 6 ops** (re-measured with
the counting mock; RULE 2's own bullet states those six ops), and `GET /api/session` has been
**3 reads** since the credits work (session + `user:` + `credits:`). At ≤200 keys signup adds one
get per existing account.
Fix: reuse the six-op sentence and the 3-read session figure in both documents.

### 3. KV records and data lifetime

**3.1 The KV key-family list is incomplete — RULE 15. [M] — ✅ fixed 2026-10-23**
Doc says: five families — `user:`, `session:`, `job:`, `blob:`, `config:workers`.
Code does: nine — add `email:<address>` (`src/index.ts:5266`), `config:theme` (`:33`),
`credits:<username>` (`:5384`) and `ipcredits:<hash>` (`:5476`). The credits/ipcredits records
carry a **2-day TTL** (`:5692`), so "accounts and sessions are effectively permanent" is no longer
the whole story.
Fix: add the four rows, their TTLs, and a note that the two credit families are the only
TTL-bounded user data.

**3.2 "Sessions, jobs and blobs are the only KV key families" — `bug-audit.md` verified list. [M] — ✅ fixed 2026-10-23**
Doc says exactly that.
Code does: the nine families above; even `config:workers` and `email:` contradict the sentence.
Fix: delete the sentence or point at RULE 15.

**3.3 Guest record shape is not preserved by a refund — RULE 21 and `bug-fix-session-206.md` §5.2. [M] — ✅ fixed 2026-10-23**
Doc says: the record is
`{day, videos, images, scripts, voiceovers, updatedAt, ip, maskedIp, hash, scope}`, and the
operator table always shows the masked address.
Code does: `creditRefundKey()` rewrites the state without the `meta` object
(`src/index.ts:5929`), so a failed guest image leaves
`{day, videos, images, scripts, voiceovers, updatedAt}` — no `ip`/`maskedIp`/`hash`/`scope`. The
settings query then falls back to `ip: "unknown"` (`:5120`), so the row loses its address after any
model failure. Verified by running the bundled worker with a throwing `AI.run`: `500`, then the
`ipcredits:` value above.
Fix: either pass the identity into the refund so `meta` survives, or document the "unknown" row;
until then the doc's record shape is aspirational.

### 4. Client flows and failure paths

**4.1 `/api/credits` guest shape — `userflow.md` §3c. [L] — ✅ fixed 2026-10-23**
Doc says: `→ {plan:"guest", remaining.images:10, scope:"ip", ip:"203.0.113.0"}`.
Code does: `plan` is an object (`{id:"guest", label:"Guest", limits:{…}}`); the string "guest" is in
`usertype` (`src/index.ts:6594–6640`, plus `authenticated:false`, `guest:true`, `user:null`).
Fix: show `usertype:"guest"` and the plan object.

**4.2 401/429 text presented as the status line — `userflow.md` §3b/§3c. [L] — ✅ fixed 2026-10-23**
Doc says: `401 → "Sign in to generate AI images"` and `429 → "Daily image credits used up (…)"` as
the visible line.
Code does: those sentences are the worker's JSON `error` values; the AI panel writes
`"<n> of 2 failed: <error>"` into `#va-ai-status-N`, and only when both variants fail does it
`alert("Image generation failed: <error>")` (`app-js.ts:8538–8560`).
Fix: label them "worker `error`" and add the status-line form.

**4.3 Failure matrix ignores `/free` — `userflow.md` §8. [M] — ✅ fixed 2026-10-23**
Doc says: "Session cookie invalid → `401` → landing page stays visible; studio entry opens the auth
overlay", and "Theme KV missing or erroring → `GET /`, `GET /{current-day}/config/uvxyz`".
Code does: on `/free` an invalid session (or a network error) boots the **guest** studio
(`app-js.ts:12070–12090`), and the theme fallback covers all five HTML routes (see 1.7).
Fix: add the `/free` exception and the other routes to those two rows.

**4.4 Worker poll "oldest" vs "not FIFO" — `userflow.md` §2/§6 vs `bug-audit.md` #7. [L] — ✅ fixed 2026-10-23**
Doc says: the poll "claims the oldest queued job" (userflow), while the audit says claiming is
"neither FIFO nor atomic" and "Jobs are not processed oldest-first".
Code does: `jobs.find(j => j.status === "queued")` over the KV `list()` order, with no explicit sort
(`src/index.ts:4141`). The two documents cannot both be right as written; the code has no ordering
guarantee of its own.
Fix: describe it as "the first queued key in KV's lexicographic list (job ids are time-prefixed)"
and align audit #7.

### 5. Sizes, line anchors and historical tables

**5.1 File sizes and line counts. [L] — ✅ fixed 2026-10-23**
Doc says: `src/index.ts` (4,922 lines) and `src/client/app-js.ts` (13,860 lines) in
`userflow.md`'s evidence header; "~640 KB HTML string" in `userflow.md` §1 and the `src/page.ts`
comment.
Actual at `e53796f`: 7,156 and 14,832 lines; 708,110 bytes (≈692 KiB) — 7,205 lines after the fix
pass, with `app-js.ts` and the page size unchanged. The 4,922/13,860 pair predates both the
credits and the #206 work.
Fix: re-measure or drop exact numbers; "≈700 KB" is accurate enough for prose.

**5.2 `path:line` anchors have drifted. [L] — ✅ fixed 2026-10-23**
Of the 15 unique `src/index.ts:NNN` references outside this register, only `:124` (the `fetch`
handler) still lands on the described code. Representative drift:

| Documented | Described as | What that line is now | Correct line (at `e53796f`) |
| --- | --- | --- | --- |
| `src/index.ts:355` (RULE 3, audit #5) | `CONFIG_PASSWORD` | `null;` | 631 |
| `src/index.ts:4046` (audit #15) | user-auth helpers banner | `headers: {` | 5248 |
| `src/index.ts:4064` (audit #15) | `AUTH_EMAIL_PREFIX` | `"failed"` | 5266 |
| `src/index.ts:4383` (kv-scale §4a) | `list({prefix:"user:"})` | `request.method ===` | 6800 |
| `src/index.ts:3236` (audit #16) | `/tts` 2 000-char cap | blank line | 3735 |
| `app-js.ts:11039` (userflow §9) | `initAuth` | (credits module) | 11973 |
| `app-js.ts:12150` (userflow §9) | `generateMP4` | (voiceover modal) | 13122 |
| `app-js.ts:12155` (RULE 11) | `FPS = 30` | `toggleScriptBox` | 13391 |
| `app-js.ts:12597` (RULE 11) | `MAX_ENCODE_QUEUE` | `let current` | 13833 |
| `app-js.ts:9951` (audit #18) | render-API poll loop | `authAccess = "required";` | 11154 |

The same drift affects `userflow.md` §9 (every entry after `addAiToVideo` is 70–1 300 lines low)
and `bug-audit.md` #15/#16. The "Correct line" values above were measured at `e53796f`; the
2026-10-23 fixes added 30 lines below `src/index.ts:4520` (the no-KV guard for
`/api/config/workers`), so treat the symbol names, not the numbers, as the durable reference.
Fix: cite function/constant names instead of line numbers, or re-measure anchors at the end of the
change (they are the first thing to rot).

**5.3 Pre-fix cap tables still presented as current — `kv-scale-test.md` §2/§5. [M] — ✅ fixed 2026-10-23**
Doc says: the §2 table shows `signup → 1 list → 403` at 7/100/1,000/3,000/10,000 keys, and §5 has
"Signup (below the cap)" / "Signup (at/over the cap)" rows.
Code does: there is no cap (removed in audit #15); signup at 3,000 keys returns `200` in 6 ops
(2 gets + 1 list + 3 puts). The document's own verdict and §8 say this, so §2/§5 now contradict
§8; §4a's `src/index.ts:4383` anchor is also stale (see 5.2).
Fix: mark §2/§5 as pre-fix measurements (they are valuable history) and re-anchor §4a.

### 6. Additional drift found while fixing (2026-10-23)

These were not in the original 22; they surfaced while editing the affected sections and are
fixed in the same pass.

**6.1 `GET /api/config/workers` crashed without a KV binding. [M] — fixed in code (Bug Fix
Session #211, `bug-fix-session-211.md` §3).** RULE 3
documented it as an open endpoint and RULE 16 promises the app boots without KV, but the handler
dereferenced `env.KV_BINDING` unguarded: a KV-less request threw a `TypeError` out of `fetch()`
(`500`/Workers error 1101) instead of returning a list. It now returns `{success:true,urls:[]}`
(200) and `POST` returns `503 "User storage not configured (bind the KV namespace)"`.

**6.2 RULE 18's note-line total excluded Bug Fix Session #206. [L] — fixed.** The sentence said
"13 note/hint/tip class usages ... ≈ 82 strings" and that #206 added "no new alerts". The page now
has 17 note/hint/tip class usages (four were added with the guest notes) and #206 added the
pre-submit quota alert, so the totals are 17 / ≈ 87 and the alert count is 35.

**6.3 RULE 2's `/api/session` payload was incomplete. [L] — fixed.** It returned
`{authenticated:true,user}` in the rule, while the route has returned
`user:{username,email,usertype}` + `plan` + `credits` since the credits work.

**6.4 RULE 2's duplicate-check order was reversed. [L] — fixed.** The code checks the
`email:` index first and `user:<name>` second; the rule listed username first.

**6.5 RULE 3 still called the second theme card "Strata". [L] — fixed.** The UI label is
**Aerial**; `strata` is only the stored/API value (RULE 19). The card list now says
Studio / Aerial / Stellar.

**6.6 `userflow.md` over-claimed two behaviours. [L] — fixed.** §4.2 said `validateSrt()` enforces
"≤42-char cues" (it is prompt text only; the validator checks shape, overlap and duration), and §3
said logout always returns to the landing page (on `/free` it drops to guest mode).

**6.7 `bug-fix-session-206.md` pointed at a nonexistent §9. [L] — fixed.** The KV follow-up now
cites `kv-scale-test.md` §8, the last section of that document.

### Suggested fix order

1. **Access-control prose first** (1.1–1.3): those three passages define how the system is
   understood and are now materially wrong.
2. **Contract text and inventories** (2.1, 2.2, 3.3): the UI strings and the record shape are
   what future changes copy from.
3. **Totals, anchors and history** (2.4, 2.5, 5.1–5.3): mechanical, can be batched in one pass.

> Method note for the next audit: the fastest reliable cross-check is the pair of harnesses in
> `bug-fix-session-206.md` §9 (77 checks) plus `grep -c 'alert('`, `wc -l` and a `createHTML()`
> byte count. Do not trust a line number written before the last feature branch.

### Register addendum — Bug Fix Session #240 (2026-10-23)

> The feature session that adopted the `video_bulk_production` chrome and four extra skins changed
> the page structure, the skin count and a handful of UI strings. Everything it invalidated is
> listed here, and every entry was fixed in the same commit.

| # | Drift | Resolution |
| --- | --- | --- |
| 7.1 | RULE 19 said **three** skins and named the theme names in three places. | Rule retitled **seven skins**; four token blocks, four picker cards and four swatches added; the "three places" restriction is now **four** (whitelist, token block, `themeOptions`, `.cfg-preview-*`). |
| 7.2 | RULE 3 described three Appearance cards. | Now seven, wrapping at `flex: 1 1 150px`. |
| 7.3 | RULE 18 quoted `Click the round Add Video button (top left), then press Generate.` and the three-card theme notes. | Rewritten for the heading button, plus the four new status lines (`#batch-note`, `#concept-count`, `#preview-state`, `#batch-empty`), the seven-card theme note and the `themeLabel()` status line. Tooltip count 21 → **22**; alerts and placeholders unchanged. |
| 7.4 | **No rule described the page structure.** §3 of every earlier document described `.header` + `.studio` + hidden panels. | New **RULE 22** documents the shell (`app-top`, `main.app-main`, two views, `.engine-panels`), the read-only grid, the memory-only view choice and the absence of the timeline. |
| 7.5 | `README.md` and `userflow.md` claimed three themes and a single-canvas studio. | Feature bullet, limits, `userflow.md` §11 and the header counts updated. |
| 7.6 | No document said what the studio deliberately *lacks*. | RULE 22 and `bug-fix-session-240.md` §6 name the dropped reference widgets (timeline, rail, metrics, in-bar picker, preview fake widgets, bulk operations). |

## RULE 24 — The Generate SEO Script walkthrough: two selectable keyword sets, an image style, then queued AI images

> Added with this revision. RULE 7's keyword contract is unchanged; RULE 24 only changes
> *when* each stage runs and *who chooses* the keyword set.

- **Accordion form standard (all Video N accordions).** Every form element inside
  `#video-accordions` (`input[type=text]`, `input[type=number]`, `select`, `textarea`) shares the
  **Upload MP3 Audio** button's proportions — `border-radius: 8px`, `padding: 12px 24px` — with a
  **3px bottom margin**; themed skins use the theme's button radius token instead, and Neo
  Brutalist stays square like its buttons. **Text inputs and textareas** override the rhythm with
  **4px top / 5px bottom** margins. **Dropdown labels always sit above their dropdown**
  (`label.quality-select` is a column: label text on its own line, select full width below it),
  never beside it. The accordion has **no Captions (bottom) section** any more; the hidden global
  caption rows remain the render engine's working state, and every `va-captions-N` consumer
  tolerates the missing container.
- **Step 1 — SEO plan (`POST /api/seo-plan {topic}`).** Clicking **✨ Generate SEO Script**
  immediately disables that video's **Upload Image, GIF or MP4** button
  (`#va-upload-btn-N`, also honoured by `clickVaFiles`) and opens the walkthrough modal
  (`#seo-walkthrough-modal`) at the *SEO plan* step. The server plans **two validated** keyword
  sets (each: 1 long-tail, exactly 4 shorts, a title and headings, all per RULE 7); the second
  planner call is instructed to differ, and an identical long-tail + ordered-short combination
  is rejected/retried by `planOneSeoKeywordSet`/`keywordSetsEqual` in `src/modules/script-seo.ts`.
  The modal may be
  closed while the plan is being generated; the fetch continues in the background and the modal
  **re-opens automatically** when the two sets arrive. On plan failure the modal closes, the
  status line shows the error and the upload + script buttons are re-enabled.
- **Step 2 — selection + video image style.** Each set is a white, theme-accented card with its title, headings,
  long-tail and short chips and a **Select this set** button. Selecting a set advances the modal
  to the *Video image style* step, where a labelled dropdown offers exactly **Cinematic Film**,
  **Editorial Magazine**, **Kinetic Typography**, **Neon Night**, **Minimalist**, **Retro Poster**,
  **Documentary**, **Split Composition**, **Dream Glow** and **Pop Comic**. The selected value is
  retained when the modal is closed and reopened. **Generate Script & Images** closes the modal,
  shows the **loading animation on the script section** (`.va-script-loading` spinner in
  `#va-script-box-N`) and calls `POST /api/script` with `{topic, minutes, speed, keywordSet}`.
  A supplied `keywordSet` is re-validated by `parseKeywordSet` (invalid → `400`, no AI call,
  no usage count) and **skips the Stage-1 planner**; requests without it behave exactly as
  RULE 7 describes. The plain-script display, SEO chips, title autofill and voiceover reveal are
  unchanged (since Session #242 there is no **Download .srt** control anywhere in the studio). Script failure ends the flow: upload + script buttons are
  re-enabled. Minutes come from the existing Minutes dropdown and **default to 1**.
- **Step 3 — image prompts (synchronous, no job URL).** Once the script is shown,
  `POST /api/image-prompts {topic, minutes, style, script, keywordSet}` runs the prompt writer
  **inside the request** and answers `200 {success, prompts, count, expectedCount, style,
  minutes, model, ms}`. There is no job id, no `waitUntil` background work, no KV job record and
  no poll URL (see *RULE 24 — BATCH IMAGE PIPELINE* below for why the old job was removed); the
  retired `GET`/`DELETE /api/image-prompts/<id>` URL answers `410` with a migration hint. The
  route validates `topic`/`minutes`/`style` first (unknown style → `400`, no AI call). Instead of
  sending the full SRT to the prompt writer, the worker compacts it to at most the opening and
  closing spoken sentences (≤480 characters) and asks for concise, broad scenes portraying the
  central idea, not a literal cue-by-cue retelling. The target count follows the script length:
  **1 min → 10, 2–3 min → 14, 4–6 min → 20**. The count is a **target, not a contract**: a short
  answer is topped up with a second call that asks only for the missing scenes, and if the model
  still answers short the prompts it produced are used (a 7-of-10 batch is returned instead of an
  error). Every prompt is a single text-free scene suffixed with the selected style's consistent
  visual direction. `env.AI` missing → `503`; the model call is bounded by
  `IMAGE_PROMPT_TIMEOUT_MS` (90 s) and a failure → `502 {success:false, error}`.
- **Step 4 — one batch request renders every image.** The browser sends the usable prompts
  (capped by the video's remaining still slots) to **`POST /api/image-batch`** as
  `{prompts: string[]}` (≤20). The worker reserves one image credit per prompt up front (account
  allowance, or the `/free` IP allowance; anonymous → `401`, none left → `429`; a partial
  allowance renders only the granted images), then renders them **in parallel**
  (`IMAGE_BATCH_CONCURRENCY = 4`) with `@cf/stabilityai/stable-diffusion-xl-base-1.0` at
  **1024×576 (16:9)**, `num_steps: 20`, the shared text-free negative prompt and a random seed;
  each image gets 2 attempts with a 500 ms backoff and a 75 s per-attempt ceiling. The response is
  an **`application/x-ndjson` stream**: `start` (count, size, model, credits), `tick` every 10 s,
  one `image {index, ok, mime, data(base64)}` per scene as it finishes (or `{ok:false, error}`),
  and a final `done {requested, count, generated, failed, skipped, ms, credits}`. Every granted
  scene that never reaches the browser — failed, or unrendered because the client disconnected —
  is refunded in one credit write before `done`. The client reads the stream with
  `response.body.getReader()`, inserts each image into that video's gallery through
  `addAiToVideo` (tagged `imgflow-<video>-<stamp>` and counted against the 25-still cap) and
  keeps the flow alive with an idle watchdog (`IMAGE_BATCH_IDLE_TIMEOUT_MS`, 120 s without a
  byte aborts). **There are no interval timers, no gallery watcher and no DELETE**: the stream's
  `done` event is the completion signal, and the flow finalizes once, reporting the number of
  tagged images added, failures and any stop reason, then re-enables **Upload Image, GIF or MP4**
  and the script button. `[image-batch]` logs record request/count/concurrency/timing and never
  log prompt contents.

---

## RULE 24 AUDIT ADDENDUM — corrections and inconsistency register (double-check)

> This is the original double-check snapshot of the SEO walkthrough; its open-item list is
> historical after the follow-up fixes recorded at the end of this file. The full
> requirement-by-requirement record and updated verification evidence live in
> `seo-walkthrough-session-requirements.md`. The new follow-up section is canonical for the
> image flow; nothing here changes RULE 7's keyword contract.

**Corrections to RULE 24's wording**

1. "Two different keyword sets" means, in code, only that the second set's
   *combined* long-tail + ordered four shorts are not identical to the first set's
   (`keywordSetsEqual`). The second set may reuse individual shorts, the title and
   the headings; the planner prompt asks for more than the validator enforces.
2. The form standard covers accordion text/number inputs, selects and textareas
   only (buttons follow the older accordion-button rule), and Sticker/Quality are
   bare selects headed by their section title — they have no `<label>` element.
3. The dynamic image-prompt URL is created after style confirmation **and** after
   the script succeeds, not at the moment the keyword set is selected (a deliberate
   dependency-order interpretation of the original requirement).
4. Queued generation fires the first image immediately when prompts arrive, then
   schedules each next call 20 s **after the previous request settles**; it reuses
   `AI_ENDPOINT` (`/image/gen`) and `addAiToVideo`, not the AI panel's
   `submitAiImages` and its credit pre-check / 401 / 429 stop behaviour.
5. RULE 24's teardown guarantee ("the URL is never leaked and the upload button
   never stays disabled") holds only on the happy path and the all-images-failed
   path. It does **not** hold for the edge paths in the register below.

**Inconsistencies with other code (from Register A of the session record)**

- Closing the walkthrough modal after the sets arrive strands the flow: both the
  upload and Generate SEO Script buttons are disabled, so the cached-set reopen
  branches in `generateScript()` are unreachable (A-1).
- Gallery completion is judged by DOM child count (`baseline + expectedCount`),
  while `addAiToVideo` enforces a still-image cap and returns no success value:
  a nearly-full, edited or externally-grown gallery can make finalisation
  unreachable or premature, an in-flight image can land (and reschedule) after
  finalisation, and cap refusals are still counted as "done" (A-2, A-3).
- Prompt-poll error/external-404 paths never DELETE the dynamic URL and leave the
  1 s gallery watcher running; finalisation never checks the DELETE status (A-4).
- **Resolved 2026-10-25 (A-5):** a failed script *regeneration* used to leave the loading spinner in
  the script box instead of restoring the previous script. `runSeoScriptRequest()` now retries
  (`SCRIPT_RETRY_LIMIT = 2`) and restores the box, the status line and both buttons on every path.
- **Resolved 2026-10-25 (A-6):** the walkthrough modal is no longer a global singleton. The modal
  stack (`MODAL_BASE_Z_INDEX = 1200`) gives every video its own `seo-walkthrough-modal-<n>` /
  `voiceover-modal-<n>`, stacked 10 levels apart, with `Esc` closing only the topmost one and
  `data-await-choice="1"` keeping a decision step from being dismissed by accident.
- Topic/minutes/speed are snapshotted and cached sets are reopened without
  comparison, so edits made while the modal is closed are silently ignored (A-8).
- `/api/seo-plan` and `/api/image-prompts` are anonymous and never record usage,
  unlike `/api/script`'s `onValidated` telemetry; the prompt URL is an
  unauthenticated capability URL (A-12). Caption code
  (`vaCaptionRowHTML`/`addVaCaptionRow`/`swapVaCaptions*`) remains as dead or
  always-empty plumbing after SR-4 (A-13).

**Inconsistencies between documentation and code (from Register B)**

- This file's RULE 7 client bullet, RULE 18 hint inventory and RULE 1 route-order
  list predate the walkthrough: the client no longer simply sends
  `{topic, minutes, speed}` in one click, the Generate SEO Script tooltip/hint do
  not mention set selection, image style, the disabled upload button or queued
  images, and neither new route appears in the route order.
- `userflow.md` §4's accordion diagram still lists a Captions (bottom) section,
  §4.2/§10 describe the one-click script flow, and §2/§9 omit the new routes and
  MODULE 8b; `README.md` still describes each accordion as having its own captions
  and gives the 10-caption limit. See `userflow.md` §13 for the matching register.
- The session's own summary texts (`README.md`, RULE 24, `userflow.md` Flow 6)
  overstate "two different sets", "every form element" and the teardown guarantee
  as detailed in the corrections above and in B-4/B-5/B-7 of the session record.

---

## RULE 24 — BATCH IMAGE PIPELINE (2026-10-24, supersedes the queue in Step 4 above)

> The polling/job architecture documented in the RULE 24 addendum is **removed**. This section is
> canonical for image generation; `bug-fix-session-241.md` records the diagnosis and evidence.

**Why the old pipeline could not work reliably**

1. `POST /api/image-prompts` answered `202` and ran the prompt LLM in `ctx.waitUntil`. Cloudflare
   cancels unsettled `waitUntil` promises **30 seconds after the response is sent**
   ([Context (ctx) docs](https://developers.cloudflare.com/workers/runtime-apis/context/)). The
   job asked a 8B instruct model for up to 20 × ~30-word prompts (`max_tokens` up to 3 072) and
   retried up to 3 times, i.e. 60–180 s of work on a ≤30 s budget. When the isolate was killed
   the KV record stayed `pending` forever — and the client had **no deadline for a pending job**,
   only `IMAGE_PROMPT_POLL_MAX_FAILURES` for failed polls — so the browser polled every 30 s
   indefinitely while the upload button stayed disabled. That is the "AI images never appear"
   symptom.
2. The prompt count was validated **strictly**. A model that answered 9 of 10 prompts threw
   `Image prompts incomplete (9 of 10) - try again` after 3 attempts and the whole flow ended
   before a single image was rendered.
3. Images were generated **serially**, one every 20 s *after the previous attempt settled*, with
   90 s timeouts and one retry. Ten images therefore took 4–8 minutes, and nothing was shown
   until each request finished.
4. `/image/gen` never sent `width`/`height`, so SDXL returned its default square image for a
   landscape gallery, and the route had no retry of its own.

**The contract at that revision** (progressive client batching now superseded by RULE 29)

| Route | Behaviour |
| --- | --- |
| `POST /api/image-prompts` | Synchronous. `200 {prompts, count, expectedCount, style, minutes, model, ms}`; `400` invalid input; `502` model failure; `503` no `AI` binding. Short answers are topped up, never fatal. |
| `POST /api/image-batch` | `200 application/x-ndjson`; `400` invalid/too many prompts; `401` anonymous when KV is bound; `429` no credits (JSON, with `credits`); `503` no `AI` binding. Events: `start`, `tick`, `image`, `done` (plus `error` on an unexpected stream failure). |
| `GET`/`DELETE /api/image-prompts/<id>` | `410 Gone` — the poll URL no longer exists. |
| `GET /image/gen?prompt=&variant=` | Unchanged contract for the manual AI panel (1 image, 1 credit, `X-Credit-*`); now shares the 16:9 model call and the credit gate with the batch route. |

**Client rules**

- `startImagePromptFlow(n)` is two awaited requests: prompts, then the batch. No `setInterval`,
  no `setTimeout` queue, no `DELETE`, no gallery watcher.
- The batch stream is consumed line-by-line; each `image` event becomes a `Blob`/`File` and is
  inserted immediately, so the gallery fills progressively.
- Exactly one finalize per flow (`_imageFlowFinalizing` guard): abort controllers are cancelled,
  `Upload Image, GIF or MP4` and **✨ Generate SEO Script** are re-enabled, and the status line
  reports `<n> image(s) added`, failures, or the stop reason.
- The 25-still cap is applied *before* the request: only `min(prompts, free slots)` prompts are
  sent, so credits are never spent on images that cannot be inserted.

**Remaining known limits**

- A single batch is capped at 20 prompts (`IMAGE_PROMPT_MAX_CHARS = 1800` per prompt) and
  dispatched through the Node.js-style non-blocking `sharedImageTaskQueue` at **3 images per
  3 seconds per video/row** (`IMAGE_BATCH_CONCURRENCY = 3`, `IMAGE_BATCH_WAVE_INTERVAL_MS = 3000`,
  `DEFAULT_GLOBAL_IMAGE_CONCURRENCY = 9` round-robin across active batches — see **RULE 28**). A
  very slow upstream makes the batch take longer, but the browser keeps receiving `tick` events and
  the 120 s idle watchdog only fires when the stream goes completely silent.
- Motion graphics/animations are unaffected; only AI image generation changed.

## RULE 24 FOLLOW-UP — style dropdown, template controls and image-flow reliability (2026-10-24)

This follow-up supersedes the original snapshot above for the changed controls and image-flow
failure paths. The following earlier audit items are resolved in code: A-1 (cached plan/style
modal can be reopened), A-2/A-3 (flow-tagged gallery completion, cap-aware targets, and an explicit
`addAiToVideo` success result), A-4 (terminal and external failures finalize and DELETE), and A-7
(credit exhaustion and `401`/`429` stop the queue). A-14's style input/catalog mismatch is also
resolved: the client and worker share the ten canonical style labels, the worker rejects unknown
styles, and each returned prompt receives the selected style direction. A-5 (failed SRT
regeneration), A-6 (global modal with overlapping video plans), A-8 (stale topic/length snapshot),
A-12 (anonymous prompt-job routes/usage telemetry), A-13 (legacy caption plumbing) and A-15
(job-store lifetime) remain outside this follow-up.

- **Template scene editor.** The Shapes & stickers heading and sticker-box grid are removed from
  the graphic-configuration inspector. **Delete element** sits next to **＋ Text / ＋ Graphic**
  and appears only for a selected non-background element. Layer controls retain their position
  and use `.tm-tool`, matching the top-right **Pause** button. SEO keyword-set cards are white
  (including the selected-set card), with readable dark content, theme border/accent and a
  separately themed style dropdown.
- **Prompt generation.** The style selector contains exactly the ten values listed in RULE 24.
  `summarizeScriptIdea()` forwards at most the opening and closing spoken sentence (≤480 chars),
  and `buildImagePromptInstruction()` requests concise, general representative scenes that
  convey the central idea rather than retelling each SRT cue. Count validation remains exact;
  the selected style is appended consistently to every prompt.
- **End-to-end flow.** Prompt-job creation validates the dynamic same-origin URL, returned job id
  and expected count. The client polls immediately then every 30 seconds with bounded transient
  retries/timeouts; image requests use `/image/gen`, one initial request then 20-second
  settle-based spacing, bounded retry/timeouts and the existing daily-credit gate. Generated
  cards are tagged to the job and inserted into the selected video's own gallery. Only tagged
  cards count toward completion; the 25-still cap limits the target, and partial successes,
  failures and terminal errors all delete the prompt URL, clear timers/abort requests and
  re-enable uploads/script generation. Logs correlate job/video/position and latency without
  recording prompt contents.

---

## RULE 25 — The Quick Batch table is a second editor, not a second engine

> **Added 2026-10-25 (Session #242).** `#view-table` takes a list of scripts and turns every row
> into a finished video **through the same client code the Editor uses**. It owns its rows, its own
> stage machine and its own gating rule; the only thing it shares with the accordions is the
> render function itself.

- **Ownership.** Rows live in `const batchRows = []` inside `APP_JS` (also handed out as
  `window.__BATCH_ROWS` for tests and the console), **never** in `videoProjects`.
  `BATCH_ROW_LIMIT = VIDEO_MAX_VIDEOS` (10) and the cap is enforced by
  `addBatchRow()` returning `null` + `showRequiredModal([...])`, not by a silent no-op.
  `bindBatchTable()` seeds **one** blank row once (`batchTableSeeded`), so deleting every row
  leaves the table empty — `renderBatchTable()` must never re-seed.
- Row shape: `{id, script, style, minutes, resolution, orientation, stage, detail, error, mp3,
  mp3Url, audio, prompts[], images[], objectUrls[], slides[], subtitles[], animated, startedAt,
  finishedAt, controller, running}`.
  `minutes` is clamped to 1…6 on input; `style` is one of the ten walkthrough styles
  (**Cinematic Film** is the default); `resolution` is one of `BATCH_RESOLUTIONS`
  (`480 / 540 / 720 / 1024`, default **1024** — the long edge) and `orientation` one of
  `square | landscape | portrait` (default **landscape**); `stage` walks
  `empty → ready → voice → timing → prompts → images → animate → done`, and back to `ready`
  when the row could not finish (Session #244 — there is no visible error stage any more).
  - Restriction: `BATCH_STAGE_LABELS.queued` ("Queued") and its colour rule still exist, but no
    code ever assigns `stage = "queued"` — a row goes straight from `ready` to `voice` when its
    lane picks it up. The label is dead copy (`toberesolved.md` B5).
- **Frame maths.** `batchRowDimensions(row)` (client) and `imageFrameFor()` (worker) are the same
  rule: the resolution is the **long edge**, the short edge is `round(res × 9/16)` for 16:9, both
  rounded to a multiple of 8 (SDXL's requirement), and `square` makes both edges the long one. So
  480 → 480×272, 540 → 544×304 (540 is not a multiple of 8), 720 → 720×408, 1024 → 1024×576.
- **The gating rule.** `batchRowFinished(row)` — `row.mp3 && row.images.length && row.animated &&
  row.slides.length` — is the *single* condition behind both action cells. Until it is true the
  cells are text (`<span class="batch-pending">Preview Here</span>`, `Export Video`); afterwards
  they are buttons, **both at once**. There is no preview-only or export-only state, and a row with
  no script never gets a control at all (`generateBatchRows()` skips it).
- **Pipeline** (`runBatchRow`):
  `POST /api/voiceover {text, lang:"en"}` → `decodeBatchAudio` (bounded by
  `BATCH_AUDIO_DECODE_MS = 15000`, resuming suspended `AudioContext`s and falling back to
  `row.minutes * 60000` ms) → `buildScriptCues(script, ms)` →
  `POST /api/image-prompts {topic, minutes, style, resolution, orientation, script}` →
  `POST /api/image-batch {prompts, resolution, orientation}` (NDJSON via `appImageStreamQueue` at
  `BATCH_IMAGE_STREAM_CONCURRENCY = 3` and off-thread `decodeBase64ImageOffThread`) →
  `buildBatchSlides` → `animated = true`. `BATCH_REQUEST_TIMEOUT_MS = 240000` bounds each request
  and `BATCH_SLIDE_DECODE_MS = 10000` bounds each `img.decode()` (timer cleared in `finally`,
  yielding every 3 decoded slides). Both `#batch-generate-btn` and top-bar `#top-generate` trigger
  `generateBatchRows()` / `stopBatchRows()` when in `"table"` layout, `syncBatchRowsFromDom()`
  captures unfired inputs before running, and `resetClearedBatchRow()` resets a cleared finished
  row back to `stage = "empty"` with pending Preview/Export text.
- **Three rows at a time + staggered pipeline execution (Session #248).** `generateBatchRows()`
  builds the pending queue (`batchRowPending(row)` = has a script **and** `!batchRowFinished(row)`
  **and** `!row.running`), starts up to `BATCH_RUN_CONCURRENCY = 3` rows simultaneously in the
  early pipeline steps (`voice`, `timing`, `prompts`) behind one `batchRunBusy` flag. When any
  active row moves to the next step of processing (stage `images` / image generation),
  `startUnprocessedRows(activeRow)` starts the next unprocessed row from the queue immediately.
  Thus, 4th and subsequent rows do not wait for earlier rows to completely finish the whole
  pipeline (`done` through images and slides); early-stage concurrency stays bounded at 3, and all
  scripted rows run to completion without requiring a second click of Generate. Each row keeps its
  own controller/object URLs, and a finished row unlocks its buttons without waiting for the rest
  of the table.
- **A finished row is never generated again.** Because the queue is built from
  `batchRowPending()`, pressing ✦ Generate again skips every row whose Preview/Export buttons are
  already live: its MP3, images and slides are in memory, so re-running it would re-bill the
  credits and throw the animation away. With no pending row left the table shows
  `showRequiredModal(["Every row with a script is already finished …"])` instead of starting a run.
  (A *failed* row is pending again and is retried by the next Generate; clear a finished row's
  script to make it runnable anew.)
- **Isolation + silent retries (Session #244).** A failure is contained to its own row **and is
  never shown**. Every step runs through `batchRunStep(row, stage, detail, step)`:
  - up to `BATCH_STEP_ATTEMPTS` = 4 attempts with exponential backoff
    (`BATCH_RETRY_BASE_MS` = 800 ms, capped at `BATCH_RETRY_MAX_MS` = 4000 ms);
  - the row's stage label is painted once (attempt 1) and **not touched** on a retry, so the UI
    shows the same working state for attempt 1 and attempt 4;
  - while a row works (`voice | timing | prompts | images | animate`) its status cell renders
    `<span class="va-spinner"></span><span class="batch-status-text">…</span>` with
    `data-loading="1"` — the editor's script-section animation (`.va-spinner` +
    `va-loading-pulse`), not a new one;
  - object URLs created by a failed attempt are revoked before the retry
    (`revokeBatchUrlsSince`), so a retried voice/image step cannot leak or double-count;
  - aborts and timeouts are classified (`batchIsAbortError`): a stop (`row.stopRequested`) is not
    retried, and no `AbortError`/`"signal is aborted without reason"` text can reach the table;
  - when the last attempt fails the row is left at `stage = "ready"`, `row.error = ""`, with the
    failure in `console.warn` only — the next ✦ Generate retries it. `batchStatusText()`'s
    `⚠ …` error branch is kept for older call sites but nothing in the batch table assigns it.

  `stopBatchRows()` marks `row.stopRequested` **before** aborting `row.controller`, clears
  `batchRunBusy`, and the toolbar button reads **■ Stop generating**.
- **Layout must not move while processing (Session #244).** `.batch-table-edit` is
  `table-layout: fixed` with a `min-width` inside `.table-scroll`, and `.batch-row-status` uses
  `overflow-wrap: anywhere`. The seven percentage column widths are therefore stable for the whole
  run; the old auto layout re-measured a column from its content, so one long status line or a
  wide `<select>` shifted every other column sideways mid-processing.
- **Streams have an idle budget (Session #244).** `batchReadChunk(reader)` races each
  `reader.read()` against `BATCH_STREAM_IDLE_TIMEOUT_MS` = 90000 ms and cancels the reader on a
  stall; the timeout is retryable, so a dead NDJSON stream becomes a quiet retry instead of a row
  that waits forever. `batchFetch()` reports its own `BATCH_REQUEST_TIMEOUT_MS` as a
  `TimeoutError` (never the browser's abort wording). The policy is published as
  `window.__BATCH_RETRY = {attempts, baseMs, maxMs}` for tests.
- **Preview** is an injected `#batch-preview-modal` opened via `openModal` (so it stacks correctly
  over a walkthrough, RULE 7): a canvas the size of the row's own frame
  (`batchRowDimensions(row)`, e.g. 408 × 720 for 720 px portrait) + `requestAnimationFrame`, the exporter's own Ken
  Burns zoom-in (1 → 1.08 across each slide, cover-fit, black letterbox), slides drawn from
  `row.slides` with the list looping at `slideDurationSec(row.slides[0])` (9 s when the helper is
  unavailable), `drawSubtitles(context, row.subtitles, timestampMs, width, height)` for the
  subtitles, and a `play()` result that is not a promise is tolerated.
- **Export** is not a second renderer. `exportBatchRow(id)` (guarded by `batchRenderBusy`)
  snapshots `activeSlides`, `currentAudio`, the caption rows, `#title-input` and
  `window.__workerMode`, points `renderContext` at
  `{fileName: "YouTubeVibeStudio_Row<N>_<slug>.mp4", subtitles: row.subtitles, batchRow: true}`,
  clears the title, `await generateMP4()`, downloads `window.__lastRenderBlob` and restores the
  snapshot in `finally`. **The studio contains no `/api/render` client call in this path and the
  export body contains no `fetch(`** — a test asserts both, because a row export must not turn
  into a server job.
- The CSS is named after the markup that is actually emitted — `batch-cell batch-cell-script` /
  `-style` / `-min` / `-action` on the `<td>`s, `.batch-script-input`, `.batch-style-select`,
  `.batch-minutes-input`, `.batch-resolution-select`, `.batch-orientation-select` (with
  `.batch-col-resolution` / `.batch-col-orientation` widths), `.batch-row-head` / `-no` / `-sub` / `-status` (which also carries the
  `data-stage` attribute behind the status colours), `.batch-row-del`, `.batch-pending`,
  `.batch-live`, `.batch-preview-box|canvas|bar|note` — so every selector in `styles.ts` can be
  grepped from `app-js.ts` and every emitted class has a rule. The rules the replaced read-only
  grid left behind (`.batch-index`, `.batch-title`, `.batch-sub`, `.batch-badge[data-state=…]`,
  `.batch-open`) were deleted together with the markup they matched, and `.batch-col-preview` /
  `.batch-col-export` gained the width rules the other three columns already had.
- **Export frame.** The MP4 is still written by the studio renderer at the hidden quality
  setting (`854×480` low, `1280×720` balanced/high); the two new columns control the **AI images**
  and the **preview**, not the export canvas. That difference is documented, not hidden
  (`toberesolved.md` B9).
- Covered by `tests/quick-batch-table.test.mjs` (jsdom, whole Generate runs against mocked
  `/api/voiceover`, `/api/image-prompts` and `/api/image-batch`): three lanes in flight, the
  finished-row skip, and the resolution/orientation payloads on both image calls.

---

## RULE 26 — `render-app/` is a separate, key-gated TTS helper; the Worker never calls it

> **Added 2026-10-25 (Session #242).** A local Node service that turns a script of up to
> **20,000 characters** into **one MP3** by driving a **free, no-login** online TTS site with
> Playwright. `render-app-tts.zip` at the repository root is the same directory, for running it on
> another machine.

- **The Worker is unchanged.** No route in `src/index.ts` proxies to it, no client code posts to
  it, and it has no KV binding. It exists for the case Cloudflare AI is not available; the
  studio's `/api/voiceover` (RULE 8) stays the normal path.
- **Hardcoded key.** Every request must carry `apiKey === "1290890909&aPiky2026"` or the answer is
  `401`. This is not a user secret and grants nothing on the Worker — it exists so the helper never
  becomes an open text-to-speech relay. The markup and the payload carry `name='apiKey'` /
  `apiKey` deliberately.
- **Exactly two voices.** `male` and `female`, one choice each, selected by matching the **host's
  own** `<option>` labels:
  `/\b(?<!fe)male\b|\bdave\b|\bdavid\b|\bgeorge\b|\bguy\b|\badam\b|\bryan\b/i` and
  `/\bfemale\b|\bsusan\b|\bamy\b|\bemma\b|\bzira\b|\bjoan\b|\bkate\b/i`.
  The negative lookbehind in the male rule is load-bearing: "female" ends in "male", so a bare
  `/male/` would hand the male slot a female voice. A request for any other voice is `400`.
- **Chunking and joining.** Sentences are packed into chunks of ≤ 280 characters (an over-long
  sentence is cut on a word, then hard-sliced); each chunk is converted in a **fresh page** —
  free hosts leave their form filled — and the returned MP3 frames are concatenated with the later
  chunks' ID3 tags dropped, so the joined file still plays. Nothing is re-encoded.
- **Jobs, not bytes.** `POST /api/tts` answers `202 {jobId, chunks, …}`; the page polls
  `GET /api/job/<id>` (`{stage, done, total, percent, message, url, bytes, ms, error}`) and
  downloads `GET /media/<id>.mp3`. A 20k script is minutes of audio, so a single blocking response
  is not an option. Jobs live in memory only; the only files written are the MP3s in
  `render-app/output/`, which is git-ignored. `POST /api/job/<id>` aborts a run **between chunks**
  (the page's Stop button does exactly that); a conversion already handed to the host is allowed to
  finish, which is the only honest behaviour against a third-party site.
- **Providers are data, not code.** `HOSTS` in `lib/tts-engine.mjs` maps a provider id to
  `{url, textarea[], voiceSelect[], submit[], download[]}`; each selector list is tried in order,
  so a renamed control on the host is a one-line edit and a new free site is a new key.
  `ttsmp3` is the default, `text-to-speech` the fallback, and `mock` writes a silent MP3 through
  the same pipeline so the app is verifiable offline (`TTS_PROVIDER=mock`, `npm run offline`).
- **Verification.** `cd render-app && npm run check` → 31 checks (contract, key, cap, voices,
  chunk packing, MP3 join, HTTP round trip incl. 401/400). `tests/render-app-tts.test.mjs` keeps the
  same invariants pinned from the repo suite. The live browser path must be run by the operator:
  this sandbox has no Chromium and no route to the free hosts.
- See `render-app/README.md` for setup and `bug-fix-session-242.md` for the decision record.

---

## RULE 27 — Session #243 corrections: no sticker, Delete Video, smaller AI-card controls, no API button, resilient planner

> Added 2026-10-25. Nothing here changes RULE 7's keyword contract, RULE 8's voiceover, RULE 22's
> two views or RULE 25's quick-batch table; it records UI removals and two retry guarantees.

- **No sticker anywhere in the studio.** The `Video N` accordion has no *Sticker (bottom right)*
  section, the hidden global `#sticker-select` engine panel is deleted from `markup.ts`, and the
  renderer no longer draws one (`STICKER_*` constants, `STICKER_PRESETS`, `getSticker()`,
  `stickerEmojiString()`, `emojiCodePoints()`, `loadStickerAssets()`, `measureEmoji()`,
  `stickerPath()` and `drawSticker()` were removed, including the embedded emoji PNG data).
  `generateMP4()` frames contain the image, the title overlay and the captions only. Template
  scene *graphic* stickers (RULE 13's Graphics dropdown) are a different feature and are untouched.
- **`🗑 Delete Video` replaces the `☁️ API` button** in every accordion header
  (`#va-delete-N`, class `.va-delete-btn`). The API button is removed **visually only** - the
  `apiRenderVideo()` module, `collectVideoPayload()`, `renderVideoLocally()` and the server routes
  are still in the code and are now unreachable from the studio (the settings page's
  background-worker mode still uses the same bundled helpers). Style follows the theme button tokens
  (`html[data-theme] .va-delete-btn`).
- **Delete renumbers the stack.** `deleteVideoAccordion(n)` asks for confirmation, revokes the
  removed video's object URLs, closes its transient per-video modals
  (`seo-walkthrough-modal-N`, `voiceover-modal-N` for every index >= n), splices
  `videoProjects`, then rebuilds the survivors as `Video 1..N` via
  `captureVideoAccordionState()` / `restoreVideoAccordionState()`: title, font, colour, quality,
  script topic/minutes/speed, the SEO chips, the script box, the status line, the MP3 line and
  every gallery card are carried over. Every lookup in the studio is positional, so **the stack
  must never contain a gap**; this is the invariant the delete path exists to preserve.
  `window.__VIDEO_PROJECTS` exposes the live array for tests, like `window.__BATCH_ROWS`.
- **Generated-image controls are smaller, in every theme.** `.va-card-remove` (the ✕ on an
  AI-generated image card) was made 40% smaller than the original 20×20 / 2 px circle in #243
  (**12×12**, inset 1.2 px, `padding: 0`, `font-size: 0.5rem`) and **Session #211 took another
  30% off**: the box is now **8.4×8.4**, the glyph `font-size: 0.35rem`, still `padding: 0` with
  the ✕ centred by flex (the original badge's 2 px padding scaled to nothing, so the badge itself
  carries the 30% reduction). `.va-body .va-ai-actions .upload-btn(.small)`
  (`+ Add to Video`, `Fullscreen`) is 30% smaller than the accordion standard: **0.7rem** type and
  **8px 17px** padding instead of `1rem` / `12px 24px`. Both live after the accordion-button rule
  in `styles.ts`, so the seven themes inherit them without per-theme overrides.
- **Planner resilience (`POST /api/seo-plan`).** `runPlannerModelCall()` bounds every planner call
  (`SEO_PLAN_AI_TIMEOUT_MS = 45000`) and retries a transport error / empty reply once on the same
  model; `planOneSeoKeywordSet()` keeps 3 validation attempts per model and then tries
  `SEO_PLAN_FALLBACK_MODELS`; `handleSeoPlanGeneration()` treats only the **first** set as
  mandatory and answers `200 {success:true, partial:true, sets:[one], warning}` when the second
  cannot differ (the client renders one card and continues). `parseKeywordSet()` accepts
  `long_tail` / `shorts` / `shortKeywords` / object entries / delimited strings and trims a fifth
  short, while still enforcing every RULE 7 rule.
- **Stage loops retry model errors.** In `handleSeoScriptGeneration()` a thrown `env.AI.run()`
  now consumes one of the three attempts (planner and writer) instead of aborting the request; the
  planner prompt repeats the ask and the writer coaching is cleared so no stale SRT is reused.
- **Dead bulk-grid CSS deleted.** `.bulk-panel`, `.bulk-panel-header`, `.bulk-panel-title`,
  `.bulk-arrow`, `.bulk-slot`, `.bulk-slot-top`, `.bulk-slot-name`, `.bulk-status`, `.bulk-summary`,
  `.bulk-slot-actions` and `.bulk-caption-wrap` (plus their five theme selectors) styled no
  element; they are gone. `.bulk-toggle` (the ＋ Add Video button) and `#bulk-banner` keep their
  historical names because they are still live.
- **Verification.** `tests/studio-ui-session-243.test.mjs` (accordion has no sticker / no API
  button / Delete Video present; delete renumbering keeps state; CSS proportions; no `.bulk-*`
  left) and `tests/seo-plan-resilience.test.mjs` (8 planner/retry cases). `npm test` →
  **79/79** after the Session #211 second pass (the four new table/editor cases live in
  `tests/quick-batch-table.test.mjs`).

---

## RULE 28 — Session #251: 1,800-char style/anti-distortion guards, 3-per-3s pacing, Node.js-style non-blocking image queues & 3-stage pipeline repairs

> Added 2026-10-26. Full root-cause and verification record: `bug-fix-session-251.md`.

- **`IMAGE_PROMPT_MAX_CHARS = 1800` across writer and renderer.** Both `src/modules/image-prompts.ts`
  and `src/modules/image-batch.ts` (`IMAGE_MODEL_PROMPT_MAX_CHARS = 1800`) enforce the 1,800-char
  prompt ceiling (comfortably below SDXL's 2,048-char schema cap). `fitParagraphsToBudget()` trims
  over-budget multi-paragraph prompts proportionally across paragraphs on word boundaries so all
  three scene paragraphs plus the closing `Visual style:` paragraph remain intact; `condensePromptForModel()`
  preserves the closing `Visual style:` directive if a raw caller passes a longer string.
- **Strict style-fidelity discipline (`IMAGE_STYLE_DISCIPLINE`) & anti-distortion guards.**
  - Every style in `IMAGE_STYLES` carries a medium-specific lock rule in `src/modules/image-prompts.ts`
    forbidding style drift across incompatible art mediums (e.g., no DSLR lens clichés inside
    `Pop Comic` or `Retro Poster`; no cartoon/ink cues inside `Documentary` or `Cinematic Film`).
  - `IMAGE_ANTI_DISTORTION_GUARD` instructs the prompt writer to compose 1–2 clearly separated
    focal subjects in grounded poses, natural human proportions, symmetrical facial features with
    aligned eyes, relaxed five-fingered hands, straight architectural lines, coherent
    single-viewpoint perspective, and solid non-merging object boundaries; `enforceParagraphGuard()`
    and `applyImageStyleToPrompts()` reinforce both locks on every prompt.
  - `IMAGE_NEGATIVE_PROMPT` (`src/modules/image-batch.ts`) bans anatomical, limb, hand/finger,
    facial, and perspective distortions alongside text/watermarks; 20-step SDXL base uses
    `IMAGE_GUIDANCE_SCALE = 7.5`; `@cf/black-forest-labs/flux-1-schnell` receives positive style,
    perspective, anatomy, and text-free guardrails.
- **Prompt LLM & SDXL resilience.**
  - `src/modules/image-prompts.ts` caps primary output tokens at `IMAGE_PROMPT_MAX_TOKENS = 3584`
    (preventing 8,192-token context-window overflow on `@cf/meta/llama-3.1-8b-instruct-fp8`), falls
    back to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, escapes unescaped control characters inside
    JSON string literals (`repairJsonControlChars`), and salvages complete scenes from truncated
    JSON arrays (`salvageJsonPromptArray`) so retries only request missing scenes.
  - `runImageModel()` (`src/modules/image-batch.ts`) heals non-64-multiple sub-1024 frames via
    `sdxlSafeDimensions()` (`1024×576`, `576×1024`, `1024×1024`), validates PNG/JPEG/WebP magic
    bytes (`detectImageMime`), encodes base64 in O(N), and falls back to
    `@cf/bytedance/stable-diffusion-xl-lightning` and `@cf/black-forest-labs/flux-1-schnell`.
- **Node.js-style event-driven non-blocking image task queues & worker pools (3 images / 3 s per video/row).**
  - **Worker (`src/modules/image-queue.ts`):** `sharedImageTaskQueue` (`ImageTaskQueue`) coordinates
    both `POST /api/image-batch` and `GET /image/gen` on a single-threaded, non-blocking event loop.
    Callers `enqueue()` in O(1); bursts coalesce into one microtask `pump()` pass; rate-throttled
    lanes arm exact one-shot wakeup timers (zero polling); offloaded `env.AI.run()` calls execute
    concurrently up to `DEFAULT_GLOBAL_IMAGE_CONCURRENCY = 9` globally and
    `IMAGE_BATCH_CONCURRENCY = 3` per video/row within a `IMAGE_BATCH_WAVE_INTERVAL_MS = 3000` ms
    sliding window (`IMAGE_BATCH_MIN_COOLDOWN_MS = 250` ms breathing gap after full bursts),
    scheduled **round-robin** across active groups with **zero head-of-line blocking** and instant
    `AbortSignal` queue eviction + credit refund. `EventLoopCpuSerializer` (`taskQueue.cpu`) runs
    synchronous `bytesToBase64` + JSON NDJSON framing one image per event-loop turn via
    `yieldEventLoop()`.
  - **Browser client (`window.__IMAGE_TASK_RUNTIME` in `src/client/app-js.ts`):**
    `createEventDrivenTaskQueue` (`appImageStreamQueue` at `BATCH_IMAGE_STREAM_CONCURRENCY = 3` and
    `manualImageTaskQueue` at `3`) schedules Quick Batch Table (`requestBatchImages`), Editor SEO
    walkthrough (`runImageBatch`), and Manual AI panel (`submitAiImages`) requests fairly in
    round-robin with instant `cancelMatching()` eviction on `stopBatchRows()` and **zero
    `setInterval`**. `decodeBase64ImageOffThread()` offloads base64 payloads `>= 16,384` chars to up
    to `CLIENT_DECODE_THREAD_POOL_SIZE = 3` reusable `Blob` Web Workers transferring `ArrayBuffer`s
    zero-copy, commits DOM cards/slides in arrival order on serialized promise chains, and falls
    back automatically to `65,536`-char (`48 KiB` binary) event-loop-yielding slices when `Worker`
    is unavailable.
- **Deep-debug isolation, credit-refund, container & studio invariants.**
  - **Cloudflare `IoContext` request isolation (`src/modules/image-queue.ts`):** `ImageTaskQueue`
    uses per-caller `notifyStart` gates and per-request rate-window timers so `task.execute()` and
    all timers execute strictly inside the **enqueuing request's own async `IoContext`** (never on
    behalf of whichever earlier request's `finally` triggered `pump()`), handles read-only
    `DOMException` `AbortError` instances without mutating `.name`, and decrements
    `EventLoopCpuSerializer.pendingCount` before resolving callers.
  - **Write-confirmed billing & backpressure stall guard (`src/modules/image-batch.ts`):**
    `emitRawLine()` resolves `true` only after `writer.write()` succeeds and races `writer.write()`
    against a `200 ms` post-abort drain watchdog so a wedged `TransformStream` never blocks
    `finally` or `credits.refund(refundable)`; `generated++` is incremented strictly on confirmed
    writes so `reader.cancel()` refunds every undelivered scene; `EventLoopCpuSerializer` is
    instantiated per request; `GET /image/gen` bounds `runImageModel()` with
    `IMAGE_ATTEMPT_TIMEOUT_MS`; and `imageCreditHooks()` supplies `subject` + explicit 429
    exhaustion messaging.
  - **Homogeneous voiceover containers & empty-output failover (`src/modules/voiceover.ts`):**
    `sanitizeTextForTts()` strips bare `https?://` and `www.` URLs alongside markdown links; empty
    primary MeloTTS outputs trigger retry + Aura-2 / `TTS_FALLBACK_URL` failover; `request.signal`
    cancels mid-synthesis with HTTP `499`; and if a later chunk fails over from WAV (`RIFF`) to MP3,
    earlier WAV chunks are re-synthesized via the MP3 fallback so `joinVoiceoverPieces()` never
    mixes WAV and MP3 containers.
  - **Prompt/SEO/payment resilience (`src/modules/image-prompts.ts`, `script-seo.ts`, `payments.ts`):**
    `generateImagePrompts()` falls back to 70B whenever `collected.length < count` (even if primary
    returned empty HTTP 200 replies), `parseImagePrompts()` uses `fitParagraphsToBudget()` and
    `{...}` object fallback before `[...]`, `handleSeoScriptGeneration()` bounds planner (`45 s`)
    and writer (`90 s`) calls with `runAiCallWithTimeout()`, and `payments.ts` checks base64 byte
    size *before* `atob()` (`413`) and guards KV `JSON.parse()` calls (`500`).
  - **Quick Batch orientation export & accordion deletion safety (`src/client/app-js.ts`,
    `template-composer-js.ts`):** `batchFetch()` keeps `row.controller` + timeout active across
    `consumeResponse` body reads (`blob()` / `json()`); `exportBatchRow()` passes
    `frameWidth`/`frameHeight` from `batchRowDimensions(row)` into `generateMP4()` so Portrait and
    Square rows render at their true aspect ratios instead of global `#res-select`;
    `runImageBatch()` resolves `videoProjects.indexOf(flowProject) + 1` dynamically while
    `deleteVideoAccordion()` marks `_deleted`, increments `_imageFlowSeq`, aborts active
    controllers, evicts queued tasks in `appImageStreamQueue` / `manualImageTaskQueue`, and revokes
    audio + AI card blob URLs so deleted videos never leak images into renumbered survivors;
    `template-composer-js.ts` revokes failed `im.decode()` object URLs immediately and attaches
    `<a download>` to `document.body`.
- **Verification.** `tests/session-250-batch-pipeline.test.mjs` (13 tests) and
  `tests/deep-debug-regressions.test.mjs` (6 deep-debug regression tests); `npm test` →
  **120/120** passing across all 12 test files; `npx wrangler deploy --dry-run` clean.



## RULE 29 — Browser-managed progressive image pipeline (2026-10-26)

This supersedes RULES 24/25/28 wherever they describe one full prompt request followed by one
full-video image request, or automatic replay of an entire consumed image step. See
[`progressive-image-pipeline-audit.md`](progressive-image-pipeline-audit.md) for diagnosis,
resource implications, compatibility and rollout checks.

- Both editor and Quick Batch use `runProgressiveImagePipeline`: request at most three prompts,
  render that chunk while requesting the next, drain both, repeat. One lookahead only; totals
  remain 10/14/20, capped by free editor gallery slots.
- `POST /api/image-prompts` accepts optional `batch:{offset,count,attempt,previous}`. Batch mode
  validates count 1–3 and the absolute range, makes **one** AI call with a **45 s** wait budget,
  and returns `batch:{offset,requested,nextOffset}`. Browser request + JSON timeout is **60 s**;
  up to two transient retries use the server-approved fallback. No nested server top-up/retries
  in batch mode. Legacy calls without `batch` remain compatible.
- Never replay a consumed image chunk automatically. Keep authoritative credits/refunds on the
  Worker. Browser owns orchestration, decoding, object URLs, timing, slides and MP4 export;
  Worker retains validation, AI access, metering and bounded streamed image work.
- Stop/deletion/replacement cancels both request types. Prompt lookahead must not overwrite
  the image stream's controller. Editor counters accumulate across chunks and finalization
  restores controls after the whole flow, including partial/error exits.
- Quick Batch translates chunk-local indices to absolute scene indices. Release the next row's
  early-stage slot when the first image chunk starts. Later failures may produce a partial
  slideshow from usable images; Stop is not partial success. Quiet-table error policy remains.
- Small chunks bound per-request work, not fleet-wide CPU. Base64 encoding still costs Worker
  CPU and wire bytes; AI wait is not CPU time. More HTTP/KV operations are the tradeoff. No
  persistence/resume, no waitUntil prompt jobs, and no guarantee of cancelling AI inference
  after a waiting-promise timeout. Production CPU/latency measurements remain necessary.


## RULE 30 — Bug fix #261: browser offload and atomic credits (2026-10-26)

This supersedes RULE 29 and earlier rules where they describe default NDJSON images,
server-assembled voiceover or nested script retries. The three-prompts-first flow remains.
Canonical implementation, limits, verification and rollout: [bug-fix-session-261.md](bug-fix-session-261.md).

- Negotiate `/api/pipeline-capabilities` before generation. Binary `/api/image` returns one
  image; browser schedules bounded individual requests, never automatically replays paid images.
  Preserve legacy routes for missing capabilities, not as a replay after ambiguous paid work.
- Browser owns narration splitting, chunk retry/voice passes and WAV/MP3 assembly; chunk mode
  makes one allowlisted server inference per ≤400-character request. Do not wrap chunk-mode
  voiceover in Quick Batch's legacy whole-step retry loop.
- Selected-keyword `singleAttempt` script requests make one server writer call; browser owns
  attempts 0–2. Browser compacts prompt context/ranges/dedup; server independently validates
  content, keywords, frame, ranges and model allowlists. Never trust browser quota decisions.
- Shared adaptive media lane (1–3) plus reserved control lane (1) prevents prompt starvation.
  Cancel queued work before capacity checks; resolve live accordion identity in every callback,
  including script error/finally cleanup. Track/revoke owned URLs and release bitmaps/buffers.
- Web Locks/BroadcastChannel are ephemeral cooperation only. Missing APIs use per-tab scheduling;
  missing Worker/Blob.arrayBuffer/AbortController use cooperative assembly/FileReader/logical
  cancellation with finite deadlines. Modern JS/fetch baseline and export requirements remain.
- Browser usage record: delivered images/scripts/voiceovers/MP4 exports are counted today in
  `localStorage` (one key per tab, merged for display) plus a two-day counts-only cookie, with a
  clear button in the credits popover. Store counts and kind/outcome markers only — never
  prompts, narration, media, identity or session tokens. Storage/cookie failure falls back to
  memory. The Worker must never read these records to grant, deny, refund or price work; they are
  per-device, user-editable display history. `/api/credits` remains the server summary.
- No Durable Object, database or wrangler migration is added by #261. Existing KV counters and
  authentication remain the only server gate, and they are **not atomic**: concurrent requests
  can over- or under-count, so quotas/summaries are best-effort. Never describe them as exact;
  do not use the local record to paper over this or to create client-side denials. Exact paid
  accounting would require a server-side serialization store and a separate, deliberate change.
- No persistent video jobs or media in client storage. More HTTP requests/browser work cost
  resources; do not claim production CPU savings without measurements. Timeouts cannot cancel
  active provider inference or guarantee refunds for invisible delivery.
