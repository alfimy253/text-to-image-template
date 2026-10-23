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
> **2026-10-23 explainer SEO rule set (RULE 7 rewritten):** the AI script rules are now — exactly
> **1 long-tail keyword said exactly 2×**, exactly **4 short keywords said exactly 2× each**, an AI
> **title (≤70 chars) that includes one of the short keywords**, and **at least 1 section heading**
> (every default AI script is an **explainer** video) **of which one — the same short keyword as the
> title's or another — includes a short keyword**. All documentation of the AI script written before
> 2026-10-23 was **deleted and replaced**: the old plan (2 long-tail keywords, 1-3 shorts under each,
> 2-5 shorts in total, long tail said ≥1×, shorts said 2-5×) no longer exists in any file. A future
> non-SEO / non-explainer script mode is documented in RULE 7 (not implemented).
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
  - Restriction: the rotating path is not an authorization boundary. The page still relies on
    the client-side password gate described below.
- The settings password is the literal `"#123admin%"`, duplicated in two places:
  - the Worker constant `CONFIG_PASSWORD` (`src/index.ts`), and
  - the client script `CONFIG_PASSWORD` (`src/client/config-page-js.ts`).
  - Restriction: the gate is a client-side `===` comparison, so it is cosmetic — the value is
    readable in the served HTML/JS. Its server-side uses are the six operator endpoints:
    `POST /api/config/theme`, `POST /api/config/workers`, `GET|POST /api/config/users` and
    `GET|POST /api/config/ipcredits` — the GETs take `?pw=`, the POSTs `body.pw`, and all six
    compare against `CONFIG_PASSWORD` (`403` otherwise).
  - Restriction: rotating the password therefore requires editing both files and redeploying.
- Appearance group (added with the theme feature, RULE 19):
  - **seven** radio cards (Studio / Aerial / Stellar / Night Lab / Warm Paper / Swiss /
    Neo Brutalist) with CSS-only preview swatches, a status line and a **Save theme** button;
    the group is hidden while the mode select is on "Background worker". The cards wrap
    (`flex: 1 1 150px`) so seven fit in rows rather than being squeezed into one.
  - Restriction: the preview is client-side only — picking a card restyles the page
    immediately but stores nothing, so an unsaved pick is lost on reload.
  - Restriction: the theme is a **global** setting (one page serves every visitor), not a
    per-user preference.
- Worker-mode UI switching:
  - Mode select "Web app" / "Background worker" toggles the modal groups and adds
    `body.cfg-worker-mode`, which hides `h1, h2, .audio-panel, .controls, #action-bar,
    #video-accordions, #gallery, #status-text, #progress-container` (both via injected CSS and
    via `hideStudio()` inline styles).
  - Restriction: only the *chrome* is hidden; the studio JS (and its render engine) is still
    fully loaded and is what performs the work.
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
  - The server appends `", 16:9 landscape, a completely text-free image"` to the prompt and
    sends a long `negative_prompt` banning text, CJK characters, subtitles, signs, logos,
    watermarks and numbers.
    - Restriction: no `width`/`height` parameters are sent — the code comment states the API
      rejects custom dimensions, so the "480 px landscape" size is a client display/format
      promise, not an API guarantee.
  - Client behaviour: each submit is **2 sequential requests** (`variant` 1 and 2).
    - The results panel keeps at most 4 cards; generating again while it holds 4 clears it
      first (revoking the object URLs).
    - "+ Add to Video" wraps the PNG in a `File` and pushes it as a normal still image, so it
      counts against the 25-image cap of that video.
    - If both variants fail the client `alert`s the last error; if one fails the status line
      reads "1 of 2 failed: <error>".

---

## RULE 7 — The AI script is an EXPLAINER SEO script: 1 long-tail keyword (exactly 2×) + exactly 4 short keywords (exactly 2× each) + an AI title and headings gate the SRT writer

> **Rule set of 2026-10-23.** This rule replaces every earlier SEO keyword plan; all documentation
> of the older script rules (2 long-tail keywords, 1-3 shorts under each, 2-5 shorts in total,
> long tail said ≥1×, shorts said 2-5×) was deleted on 2026-10-23 and nothing below predates it.

- **The explainer SEO rules (the complete contract, enforced server-side):**
  1. Exactly **1 long-tail keyword** (`SEO_LONG_TAIL = 1`), at most **6 words**
     (`SEO_LONG_WORDS_MAX`), and its spoken frequency is **min = max = exactly 2**
     (`SEO_LONG_FREQ_MIN = SEO_LONG_FREQ_MAX = 2`) — not 1 time, not 3 times.
  2. Exactly **4 short keywords** (`SEO_SHORT_TOTAL = 4`), each at most **3 words**
     (`SEO_SHORT_WORDS_MAX`), and **each one is said exactly 2 times**
     (`SEO_SHORT_FREQ_MIN = SEO_SHORT_FREQ_MAX = 2`).
  3. **One of the 4 short keywords must be included in the video title** — the AI-planned title is
     at most **70 characters** (`SEO_TITLE_MAX`, matching the title input's `maxlength`).
  4. **Another short keyword — or the same one — must be included in a heading.** Because the
     default AI script always creates an **explainer video**, there is **at least 1 heading**
     (`SEO_HEADINGS_MIN = 1`), each at most **12 words** (`SEO_HEADING_WORDS_MAX`); the headings
     follow the explainer's section order.
- Request contract (`POST /api/script` with `{topic, minutes, speed}`) is unchanged by the SEO work.
  - `topic` defaults to `"my video"`, trimmed and cut to 160 chars server-side (the dialog's
    `maxlength` is 120).
  - `minutes` defaults to 1; anything not an integer in **1..6** → `400 "Minutes must be 1-6"`.
  - `speed` must be one of `super fast | fast | medium | slow` → else `400`.
    - Word targets per minute: 210 / 170 / 140 / 110 (used only to steer the prompt).
  - `env.AI` missing → `503 "AI binding not configured"`.
- **Two AI stages per request**, both on `SCRIPT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8"`
  (`SEO_*` constants, `parseKeywordSet()`, `keywordUsageError()` and the two stage builders
  in `src/index.ts`). The rules are **redundant by design**: they are stated to the model in the
  stage-2 prompt *and* independently re-checked by the server after every generation.
  1. **Keyword planner** — `max_tokens: 512`, `temperature: 0.6`, **3 attempts**, JSON only:
     `{"title":"…","headings":["…","…"],"longTail":"one long tail keyword","short":["s1","s2","s3","s4"]}`.
     - `longTail` is lenient about shape: a bare string, `["one entry"]` or `{keyword:"…"}` all
       read as the one long-tail keyword (an old-shape answer is not punished with a retry).
     - the 4 shorts dedupe-collapse first, then must be **exactly 4**; an empty short, a short
       longer than 3 words, an empty/over-long long tail, a missing/over-long title, a title that
       carries no short keyword, a missing/empty/over-long heading list or headings of which none
       carries a short keyword are all rejected (inclusion is tested with `keywordCount()` —
       `\b`-anchored, case-insensitive).
     - Restriction: nothing requires a keyword to be a literal substring of the topic — the
       planner is only *asked* for keywords "closely related to the topic", so that is a prompt
       rule, not an enforced one.
     - 3 rejected plans → `500 {success:false, error:"SEO keywords invalid (<reason>) - try again"}`
       and **the writer is never called**: a hopeless topic costs only the cheap stage.
       - Reason strings are stable contract text: `no JSON object in the keyword output`,
         `the keyword reply was not valid JSON`, `the JSON needs a "longTail" keyword`,
         `the long-tail keyword "x" is longer than 6 words`, `the JSON needs a "short" array`,
         `a short keyword is empty`, `the short keyword "x" is longer than 3 words`,
         `there must be exactly 4 short keywords, not N`, `the JSON needs a "title" string`,
         `the title is longer than 70 characters`,
         `the title must include at least one of the short keywords`,
         `the JSON needs a "headings" array with at least 1 heading`, `a heading is empty`,
         `the heading "x" is longer than 12 words`,
         `at least one heading must include a short keyword`.
  2. **SRT writer** — `max_tokens: 2048`, `temperature: 0.7`, **3 attempts**; the prompt is
     `basePrompt` ("You are a professional video script writer for **EXPLAINER** videos - every
     default script explains its topic section by section, in natural spoken English. Answer with
     ONLY valid SRT subtitle text, nothing else.") plus a hard-coded **SEO brief that redundantly
     restates every rule**: the exact title text and the exact headings (fixed, in section order,
     never altered or spelled out aloud), the long-tail keyword said **exactly 2× — "not 1 time
     and not 3 times"**, each of the 4 short keywords said **exactly 2×**, all worked into natural
     spoken sentences and never read out as a list.
     - The old `@cf/meta/llama-3.1-8b-instruct` was deprecated (comment dated 2026-05-30), so
       don't "restore" the free model name.
     - Response parsing accepts three shapes: `result[0].message.content`, `result.response`,
       or a bare string (helper `aiText`).
- SRT validation (`validateSrt`) — every rule is a hard gate and the SEO work did not touch it:
  - Control characters are stripped; a fenced code block (a line of three backticks) is unwrapped.
  - Everything before the first numeric cue line is discarded; no cue found → invalid.
  - Every timestamp must match `H{1,2}:MM:SS,mmm` on both sides of `-->`.
  - `startMs < endMs` and no cue may overlap the previous cue's end.
  - At least one cue with text and a positive duration must survive.
  - Total duration must be `>= 10 000 ms` and `<= minutes*60 000 + 1 500 ms` (1.5 s tolerance).
    - Restriction: both bounds are rejections, not trims — "too short" is as invalid as "too long".
- **Keyword frequencies are enforced after generation, on the spoken words only**
  (`srtSpokenText()` drops cue numbers and timestamp lines; `keywordCount()` lower-cases, treats a
  run of whitespace as one space and anchors both ends with `\b`):
  - the **long-tail** keyword must appear **exactly 2** times — below *and* above are failures;
  - **each of the 4 short** keywords must appear **exactly 2** times — below *and* above are
    failures;
  - the first violation in rule order (long tail first, then the shorts in list order) becomes the
    retry reason handed to the model:
    `the long-tail keyword "x" appears 1 time(s); it must appear exactly 2 times`,
    `the long-tail keyword "x" appears 3 times; it must appear exactly 2 times`,
    `the short keyword "x" appears 1 time(s); it must appear exactly 2 times`,
    `the short keyword "x" appears 3 times; it must appear exactly 2 times`.
  - Restriction: `\b` anchoring means a glued word never counts (`budgetgear` ≠ `budget gear`) and
    the keyword `ai` is not matched inside `said`. A short keyword that also occurs inside the
    long-tail phrase counts there too — the writer prompt keeps them separable in practice.
- Retry policy: **3 attempts per stage**; every writer retry re-sends the same keyword set with
  `" Your previous attempt was rejected: <exact reason> Try again and fix that exact problem."`
  - After 3 writer failures → `500 {success:false, error:"Script output invalid (<reason>) - try again"}`.
- Success payload:
  `{success:true, srt, title, headings, keywords:{longTail:{keyword,count,min:2,max:2}, short:[{keyword,count,min:2,max:2}]}, model}`.
  - `title` and `headings` are the planner's verified strings; `longTail` is now a **single
    object** (the old payload listed an array of 2 long tails with nested shorts).
  - Restriction: `count` is the **measured** frequency in the returned script — the UI displays it,
    and a keyword can only be listed with `count = 2`, because the same numbers gate the response.
  - Restriction: **each request costs at least 2 Workers AI calls** (up to 6 with retries)
    against the 10 000 neurons/day free allocation.
- Client side (`src/client/app-js.ts`, video accordion):
  - The SEO block is the **first** `.va-section` of `.va-left`, titled
    **"Generate SEO Script With AI"**, with the always-visible hint line
    `SEO rule (explainer): 1 long-tail keyword said exactly 2× · exactly 4 short keywords said exactly 2× each · one short keyword is in the title · one is in a heading`
    and a matching button tooltip. See RULE 18 for the hint inventory.
  - The client still sends only `{topic, minutes, speed}`: the user never picks keywords, title or
    headings — the UI only reports the ones the model produced and the server verified.
  - On success `generateScript()` stores `project.srt`, `project.seoTitle` and
    `project.seoHeadings`; **if the video title input `#va-title-N` is still empty it is autofilled
    with `title.slice(0, 70)`** (the input's `maxlength` is 70, so the SEO title always fits); it
    fills `#va-script-box-N`, renders the SEO plan chips into `#va-script-keywords-N`
    (`renderSeoKeywords(n, data)` — a Title row, a Headings row, the long-tail chip and the 4 short
    chips, each count shown as `N×`, every string passed through `escapeHTML()`), reveals the SRT
    box + **⬇ Download .srt** and calls `syncVoiceoverButton(n)`, which reveals + enables
    **🎙 Generate Voiceover** — the button ships hidden (`style="display:none"` + `disabled`) in the
    accordion markup and stays hidden for as long as the video has no generated script.
  - The status line reads
    `Script ready — N lines (<speed> speech, <minutes> min) · SEO: 1 long-tail (2×) + 4 short keywords (2× each) · title + K heading(s)`.
  - Restriction: on failure the status line becomes `Script failed: <error>` and the previous chips
    and SRT box stay on screen — nothing is cleared or replaced.
- **Future: scripts without SEO / non-explainer scripts (documented, NOT implemented).** The whole
  SEO layer is isolated so a future plain-script mode can bypass it without touching anything
  else: the rules live only in the `SEO_*` constants, `parseKeywordSet()`, the stage-2 SEO brief
  and `keywordUsageError()`. A non-SEO mode skips stage 1 (the planner), uses `basePrompt` without
  the SEO brief, skips `keywordUsageError()`, and returns the payload without
  `title`/`headings`/`keywords`; request validation, `validateSrt`, the retry loops, the credit
  telemetry and the client SRT box all stay exactly as they are.

---


## RULE 8 — Voiceover is MeloTTS with defensive sanitising, chunking, retries and a foreign fallback

- `POST /api/voiceover` with `{text, lang}`:
  - `env.AI` missing → `503`; empty text after cleaning → `400 "No script text to speak"`;
    `lang` must be one of `en, zh, es, fr, hi, it, ja, ko` → else `400`.
    - Restriction: the UI locks the voice select to **English only** (`disabled` select). The
      other seven languages are reachable only by calling the API directly.
  - Text cleaning before synthesis (each step exists because the upstream TTS failed on it):
    - strip control characters, collapse whitespace, `trim`;
    - cap at **8 000 characters** — with a surrogate-pair guard so an emoji is never cut in half;
    - normalise `—`/`–` → `-`, `…` → `...`, curly quotes → straight quotes, NBSP → space;
    - drop lone surrogates.
      - Rationale in code: a lone surrogate or unusual typography in the prompt triggers
        upstream `AiError 3043: Internal server error`.
  - Chunking: sentences are matched with `/[^.!?…]+[.!?…]*\s*/g` and packed into chunks of at
    most **500 characters**; a single sentence longer than 500 chars is hard-split at 500 with
    the same emoji guard.
    - Restriction: chunks are synthesised **sequentially** in a `for` loop, so a long script is
      as slow as the sum of its chunks.
  - Per chunk: up to **3 attempts** with `400 ms * attempt` backoff; any failure logs
    `[voiceover] tts error` and falls through to the free fallback TTS
    (`FALLBACK_TTS_URL = "https://tts-api.netlify.app/"`, called with `?text=&lang=`).
    - Restriction: a third-party host is now a runtime dependency of voiceover; if it also
      fails the route returns `500 "TTS failed (chunk i of n): <last error>"`.
  - Output normalisation: each chunk's audio is accepted as `ArrayBuffer`, `ReadableStream`,
    `{byteLength}`, `{arrayBuffer()}`, base64 string, or `{audio: base64}`.
    - Non-empty bytes are required or the route 500s with
      `"Unexpected TTS output (chunk i of n)"`.
  - Container handling: if **every** piece starts with `RIFF`, the fmt chunk of the first piece
    and the data chunks of all pieces are reassembled into one valid WAV (correct RIFF sizes,
    28-byte header) and returned as `audio/wav` + `voiceover.wav`; otherwise the bytes are
    concatenated as `audio/mpeg` + `voiceover.mp3`.
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
- Subtitles (the applied SRT script):
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

## RULE 13 — The template composer is a self-contained module with its own caps

- Everything lives in an IIFE (`src/client/template-composer-js.ts`) so its helpers cannot
  collide with the studio's globals; only `window.openTemplateModal` and
  `window.closeTemplateModal` are exported.
- The modal has two views:
  - **Gallery** — a 4-column grid of live animated previews of the **8 motion-typography
    templates** (19 Halo Warp, 20 Terminal Fracture, 21 Ribbon Editorial, 22 Portal Type,
    23 Comic Burst, 24 Dream Echo, 25 Perspective Fold, 26 Liquid Bloom — ported from the
    uploaded Typography Motion Studio III HTML; gallery thumbnails run the same `drawScene()`
    as the export).
  - **Editor** — a live canvas preview plus controls:
    - **Text layers accordion** (dynamic): each layer has its own text (≤12 chars),
      30-colour palette, 9 positions, 9 text animations (None + the 8 template motions)
      and a size slider (3–18, % readout against the template's base size); `+` adds a
      layer (next free position from the POS cycle), × removes (disabled at 1 layer).
    - **Motion & transitions**: photo entry transition (9), entry speed (6), photo motion
      (10 looping motions), background (**Template default** = the template's own look, or
      the blurred first photo, 10 colours, 3 neo-brutalist, 3 Swiss grids, 4 animated CSS
      patterns), and an animation-speed slider (0.5×–2×) that scales every loop.
    - **Photos**: at most **2 images** (`files.slice(0,2)`, extras silently ignored).
- Inputs: a portrait 9:16 (1080 × 1920) or landscape 16:9 (1920 × 1080) canvas and a length of
  **1–25 s** (`TPL_MAX_DURATION = 25`, default 6, clamped).
- Export renders the SAME canvas engine as the preview — WebCodecs `VideoEncoder`
  `avc1.4d002a`, `TPL_FPS = 30`, `TPL_VIDEO_BITRATE = 6 000 000`, muxed with `mp4-muxer`,
  no FFmpeg and **no screen capture**. The MP4 downloads to disk automatically (plus a
  `Download MP4` link for a re-download).
  - Missing `VideoEncoder` or missing `Mp4Muxer` (CDN failed) → `alert` + abort.
- The exported MP4 can be appended to the target accordion's gallery as a normal MP4 asset, so it
  plays inside the final render like an uploaded clip and obeys the 5-clip cap.
- The modal is built once and reused: closing hides it, so photos/last export survive; the
  accordion link retargets the same modal at another Video N. Per-template editing state
  (layers + controls) is remembered for the life of the tab.

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
- **Client-only gates:** both the account overlay and the settings password are cosmetic from a
  security standpoint; apart from `/image/gen` (metered) and the password-gated
  `/api/config/users` + `/api/config/ipcredits`, no data route checks a credential (see RULE 2,
  RULE 3).
- **Duplicated SEO copy:** the client's SEO hint text and chip tooltips (RULE 18) are hand-copied
  from the Worker's `SEO_*` constants (RULE 7): changing a constant without changing the copy
  leaves the UI stating the old rule, and nothing fails loudly.
- **Duplicated source of truth:** the settings password and the model ids
  (`MODEL`, `SCRIPT_MODEL`, `VOICEOVER_MODEL`) are hard-coded; the password exists in both the
  Worker and the client script.
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
- Counts, re-measured on the two served pages on 2026-10-23 (after Bug Fix Session #240):
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
| `SEO rule (explainer): 1 long-tail keyword said exactly 2× · exactly 4 short keywords said exactly 2× each · one short keyword is in the title · one is in a heading` | video accordion, SEO section (`.va-note`, always visible) | `SEO_LONG_TAIL = 1`, `SEO_SHORT_TOTAL = 4`, `SEO_LONG_FREQ_MIN/MAX = SEO_SHORT_FREQ_MIN/MAX = 2` (RULE 7) |
| `AI plans 1 long-tail keyword (said exactly 2x), exactly 4 short keywords (each said exactly 2x) plus the explainer title and headings, then writes the SRT script around them` | **✨ Generate SEO Script** button tooltip | the same SEO constants |
| `Long-tail keyword — must be said exactly 2×` · `Short keyword — must be said exactly 2×; one short keyword is in the title and one in a heading` · `Explainer title — includes at least one short keyword` · `Section heading — at least one heading includes a short keyword` | SEO plan chips, `renderSeoKeywords()` tooltips | `SEO_LONG_FREQ_MIN/MAX = 2`, `SEO_SHORT_FREQ_MIN/MAX = 2`, title/heading inclusion rules (RULE 7) |
| `Max 5 GIF · 25 images · 5 MP4 (1:00 each, silent)` | video accordion, media section (`.va-note`) | `MAX_GIF_UPLOADS = 5`, `MAX_IMAGE_UPLOADS = 25`, `MAX_MP4_UPLOADS = 5`, `MP4_MAX_DURATION_S = 60` |
| `2 images per submit · 480px landscape` | video accordion, AI images section (`.va-note`, doubles as the status line) | the route always asks SDXL for 2 images; **the 480 is not enforced anywhere** (bug-audit #16) |
| `Add a video (up to 10)` | `+ Add Video` button tooltip | `VIDEO_MAX_VIDEOS = 10` |
| `Caption text (max 40 characters)` | caption row placeholder (accordion + main panel) | `CAPTION_MAX_CHARS = 40` |
| `Each caption appears centred horizontally at 4/7 of the height from the bottom, in 17px Bookman … The last caption is capped at 10 seconds on screen.` | main panel caption note (`.audio-note`) | `CAPTION_FONT_SIZE = 17`, `CAPTION_MAX_VISIBLE_MS = 10 000`, overlay geometry (RULE 10) |
| `The slideshow repeats to cover the whole track.` | main panel audio note | slide timing: the asset list loops to cover the MP3 (RULE 9) |
| `White 435 × 150 rectangle, square corners, flush with the bottom right corner and hanging 40px past the right edge.` | main panel sticker note | `STICKER_WIDTH = 435`, `STICKER_HEIGHT = 150`, sticker geometry (RULE 10) |
| `MeloTTS (Cloudflare AI) speaks the script as an English MP3 (one fixed voice). The MP3 can be uploaded as this video's audio track.` | voiceover modal note | `/api/voiceover` with the locked English select (RULE 8) |
| `Speak the script (SRT) to MP3 with MeloTTS (English) + apply it as subtitles` | **🎙 Generate Voiceover** tooltip | the two modal actions (voiceover + subtitles toggle) |
| `Send all of this video's elements to the render API` | **☁️ API** tooltip | the `/api/render` payload (RULE 4) |
| `Compose a portrait or landscape MP4 (max 25 seconds) from a design template …` | `Add video from template` tooltip | the composer caps 1-25 s (RULE 13) |
| `Tip: each template is a looping motion design … The clip is silent …` | composer panel (`.tpl-tips`) | composer motion controls + the silent-clip rule (RULE 13) |
| `Theme for the studio page — every visitor sees it. Aerial and Stellar follow the HTML5UP designs of the same name; Night Lab, Warm Paper, Swiss and Neo Brutalist are the studio's own skins.` | settings page, Appearance group (`.cfg-note`) | RULE 19 (seven skins, global setting) |
| `Built-in dark studio (default)` · `Blue sky, mountains, white accents` · `Violet gradient, frosted panels` · `Charcoal lab, lime accent` · `Warm light paper, coral accent` · `Clean white, electric blue` · `Cream, hard black lines, lime` | theme cards (`.cfg-theme-sub`) | what each skin in `CONFIG_THEMES` looks like |
| `Current theme: Studio (default).` / `Current theme: Night Lab.` / `Current theme: Neo Brutalist.` | Appearance status line (`themeLabel()`) | the value stored under `config:theme` |
| `Preview only — press Save theme to apply it for everyone.` | Appearance status line after picking | the preview is client-side only (RULE 19) |
| `Saved — reload the studio page to see the new theme.` | Appearance status line after saving | server-side injection on the next page render |
| `Free plan: 50 AI images every day · unlimited videos, AI scripts and voiceovers.` / `Paid plan (paid_user): 1,200 AI images every day.` | auth overlay (`.auth-plan-note`) | `CREDIT_PLANS.free/paid_user.limits` (RULE 20) |
| `No account? Open the free studio — 10 AI images a day, counted per IP address.` | auth overlay (`.auth-guest-note`, link to `/free`) | `GUEST_PLAN.limits.images = 10`, `ipcredits:` keying (RULE 21) |
| `Daily credits` · `Video projects Unlimited` · `AI images N / limit left today` · `AI scripts Unlimited` · `Voiceovers Unlimited` · `Used today: n images · n scripts · n voiceovers` · `Renews in Nh Nm (midnight UTC+8)` | credits pill + popover (`.credit-pill`, `.credit-popover`) | `CREDIT_PLANS`, `creditSummary()`, `creditResetsAt()` (RULE 20) |
| `Create a free account — 50 images/day` | guest credits popover (`.credit-signup`) | the `free` plan's image limit vs the guest's 10 (RULE 21) |
| `Daily image credits used up (N images/day on the <plan> plan). Credits renew at midnight (UTC+8).` + `Create a free account for 50 images per day.` (guests) | `429` body, shown in `#va-ai-status-N` and the quota alert | the same plan limits + the guest upgrade path (RULE 20/21) |
| `Sign in to generate AI images — every free account gets 50 images per day. No account? Open /free for 10 images per day.` | `401` body from `/image/gen` | the `free` and guest image limits |
| `Free: 50 AI images per day. Paid (paid_user): 1,200 AI images per day. … Counters renew every day at midnight (UTC+8).` | settings page, Plans & credits (`.cfg-note`) | `CREDIT_PLANS` + `creditResetsAt()` (RULE 20) |
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
  (guests also get `Create a free account for 50 images per day.`).
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
- Restriction: **the AI script never alerts.** A failed script writes `Script failed: <error>` into
  the section's `.va-note` status line, so the previous SRT, its chips and the download button stay
  on screen (do not "fix" this into an alert — it is deliberate, so a retry can start immediately).
- Restriction: `alert()` is the **only** modal feedback and it blocks the UI thread; long-running
  flows therefore report progress through the per-video `#va-status-N` / `#va-script-status-N`
  status lines and only use an alert for the terminal failure.

### Onboarding and empty-state hints

- `Click ＋ Add Video above, then press Generate.` (`.action-hint` in the preview card; the
  button it names is the **＋ Add Video** control in the page heading, and **Generate** exists
  twice by design — `#render-btn` in the action bar and `#top-generate` in the top bar).
- `Every video in this project` → `N videos · read-only index` (`#batch-note`),
  `N of 10 videos` (`#concept-count`), `idle` → `N in queue` (`#preview-state`) and
  `No videos yet — press ＋ Add Video to start, then open it here or in the Editor.`
  (`#batch-empty`, Bug Fix Session #240). The first three are written by `renderBatchTable()`,
  so they always agree with `videoProjects`; the `10` in the count is a hand-copied duplicate of
  `VIDEO_MAX_VIDEOS`, the same drift risk as the rest of this table.
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

---

## RULE 20 — Daily credits are per-account, plan-based and reset in Asia/Taipei

- Every user record (`user:<username>`) carries `usertype`; `free_user` and any missing/unknown
  value read as the canonical `free` plan (so pre-credits accounts keep working).
  - `free` — unlimited video projects, unlimited AI scripts, unlimited voiceovers and
    **50 AI images per day**.
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
  - Restriction: there is no payment provider here — "paid" means an operator set
    `usertype: "paid_user"`.
  - Restriction: the settings password is a shared constant bundled with the settings page script,
    so a public deployment cannot treat this route as a secure billing console. It is an operator
    tool for a trusted instance; real billing needs per-user roles and a payment provider.
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
  - The guest popover adds **Create a free account — 50 images/day** (opens the sign-up
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
  - `#view-table` — the **Bulk grid**: a read-only index of `videoProjects`, one row per video
    (number, title, prompt excerpt, scene counts, MP3 length, state, **Open ↗**).
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
- The grid is a **view, not a controller** (Bug Fix Session #240):
  - `renderBatchTable()` rebuilds `#batch-rows` from the same `videoProjects` array the engine
    uses; it never creates, copies, deletes or persists a project.
  - **Open ↗** calls `focusVideoInEditor(n)`, which switches the view, expands `#va-body-N` /
    `#va-arrow-N` with the same inline-`display` mechanism as `toggleVideoAccordion()` and scrolls
    the accordion into view.
  - A delegated `input` listener on `#video-accordions` re-renders the grid when `#va-title-N` or
    `#va-ai-prompt-N` changes, and `updateVideoStatus(n)` re-renders it after a status change, so
    the two views cannot show different states.
  - Restriction: there are **no bulk operations** — no checkbox column, duplicate, delete, export,
    search or queue badge. The uploaded reference had them; this app does not, and the grid
    deliberately does not pretend to.
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
- Record: `bug-fix-session-240.md`.

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
