# YouTube Vibe Studio — System Rules

> Every rule below was verified against the current working tree on **2026-10-16**. Each
> high-level rule is followed by
> **indented** sub-points: the technical detail that implements it, then the restrictions,
> invariants and side-effects that follow from it. File references use `path:line` where a
> single anchor exists.
>
> 2026-10-15 revisions: RULE 7 was reworked for the two-stage SEO script (keyword planner +
> SRT writer), RULE 18 (the user-visible hint inventory) was added, and RULE 19 (the three
> skins) was added when the settings page gained its Appearance group. On 2026-10-16, RULE 3
> was updated for the Asia/Taipei day-rotating settings route.
>
> Companion documents: `userflow.md` (the actor-level flows these rules produce),
> `README.md` (the user-facing summary), `bug-audit.md` and `kv-scale-test.md` (evidence).

---

## RULE 1 — One Cloudflare Worker serves everything; the browser does the heavy work

- The Worker is a single default-exported `fetch(request, env)` handler with sequential
  `if` branches and **no router library** (`src/index.ts:124`).
  - Routes are matched in a fixed order: `/` → `/image/:i` → `/image/gen` → auth API →
    KV guard → `/{current-day}/config/uvxyz` → `/api/script` → `/api/voiceover` → `/tts` →
    `/api/render` (POST) → `/api/render/:id` (GET) → `/api/worker/*` →
    `/api/config/theme` → `/api/config/workers`.
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
    - Two routes `.replace()` a **copy**: `/{current-day}/config/uvxyz` (prepends
      `window.__CONFIG_PAGE = true;` and injects the settings script) and, since the theme
      feature, **both** HTML routes, which stamp `data-theme="…"` into the `<html>` tag
      (see RULE 19). The cached string itself is still never mutated.
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

## RULE 2 — Accounts are KV-backed with no user cap and client-side-only enforcement

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
  - Duplicate username → `409` (`user:<lowercased>`, 1 keyed read).
  - Duplicate email → `409`, checked with **one keyed read** of the index
    `email:<lowercased address>`, written on every successful signup.
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
  - Measured scaling (see `kv-scale-test.md`): session/login/signup cost a constant
    1 read / 1 read + 1 write / 1 list regardless of namespace size — 3,000 keys neither slows
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
  - `GET /api/session` reads the cookie, looks up KV, returns `{authenticated:true,user}`,
    or `401` when the cookie/record is missing.
- The sign-in gate is **UI-only**.
  - `initAuth()` runs `GET /api/session`; on `200` it opens the studio and shows the account
    footer. On `401` it keeps the public landing visible and the studio hidden; the top **Sign up**
    link, bottom **Log in** link and primary studio CTA open the existing auth modal. On `503`
    (KV unbound) or a network error, the landing remains visible and the primary CTA opens the
    studio, preserving the previous open-access fallback.
    - Restriction: no route except the auth endpoints themselves checks a session. Every
      data/rendering endpoint (`/image/*`, `/api/script`, `/api/voiceover`, `/tts`,
      `/api/render*`, `/api/worker/*`, `GET /api/config/workers`) is anonymous. The login
      modal is a usability gate, not an authorization boundary.
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
  - the Worker constant `CONFIG_PASSWORD` (`src/index.ts:355`), and
  - the client script `CONFIG_PASSWORD` (`src/client/config-page-js.ts`).
  - Restriction: the gate is a client-side `===` comparison, so it is cosmetic — the value is
    readable in the served HTML/JS. Its server-side uses are `POST /api/config/workers` and
    `POST /api/config/theme`, both of which require `body.pw === CONFIG_PASSWORD`.
  - Restriction: rotating the password therefore requires editing both files and redeploying.
- Appearance group (added with the theme feature, RULE 19):
  - three radio cards (Studio / Strata / Stellar) with CSS-only preview swatches, a status
    line and a **Save theme** button; the group is hidden while the mode select is on
    "Background worker".
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
  - `GET /api/config/workers` returns `{success:true, urls}` with **no password**.
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

## RULE 7 — The AI script is an SEO script: a keyword plan (2 long-tail, 2-5 short) gates the SRT writer

- Request contract (`POST /api/script` with `{topic, minutes, speed}`) is unchanged by the SEO work.
  - `topic` defaults to `"my video"`, trimmed and cut to 160 chars server-side (the dialog's
    `maxlength` is 120).
  - `minutes` defaults to 1; anything not an integer in **1..6** → `400 "Minutes must be 1-6"`.
  - `speed` must be one of `super fast | fast | medium | slow` → else `400`.
    - Word targets per minute: 210 / 170 / 140 / 110 (used only to steer the prompt).
  - `env.AI` missing → `503 "AI binding not configured"`.
- **Two AI stages per request**, both on `SCRIPT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8"`
  (`src/index.ts:1187` SEO constants, `:1355` keyword parser, `:1652` frequency check,
   `:1762` keyword stage, `:1888` writer stage).
  1. **Keyword planner** — `max_tokens: 512`, `temperature: 0.6`, **3 attempts**, JSON only:
     `{"longTail":[{"keyword":"…","short":["…","…"]},{…}]}`.
     - exactly **2 long-tail keywords** (`SEO_LONG_TAIL`), each at most **6 words**
       (`SEO_LONG_WORDS_MAX`);
     - **1-3 short keywords under each** long tail (`SEO_SHORT_PER_LONG_MIN/MAX`), each at most
       **3 words** (`SEO_SHORT_WORDS_MAX`), and **2-5 unique shorts in total**
       (`SEO_SHORT_TOTAL_MIN/MAX`);
     - duplicates collapse before the total is counted, so 1 short repeated under both long tails
       still counts as 1; the two long-tail keywords must differ; an empty keyword or an empty
       short is rejected.
     - Restriction: nothing checks that a short keyword is not also a long-tail, and nothing
       requires a keyword to be a literal substring of the topic - the planner is only *asked* for
       keywords "closely related to the topic", so that is a prompt rule, not an enforced one.
     - 3 rejected plans → `500 {success:false, error:"SEO keywords invalid (<reason>) - try again"}`
       and **the writer is never called**: a hopeless topic costs only the cheap stage.
       - Reason strings are stable contract text: `no JSON object in the keyword output`,
         `the keyword reply was not valid JSON`, `the JSON needs a "longTail" array`,
         `there must be exactly 2 long-tail keywords, not N`,
         `"<long tail>" needs 1-3 short keywords, not N`, `the short keyword "x" is longer than 3 words`,
         `there must be 2-5 short keywords in total, not N`, `the two long-tail keywords must be different`.
  2. **SRT writer** — `max_tokens: 2048`, `temperature: 0.7`, **3 attempts**; the prompt is
     `basePrompt` plus a hard-coded SEO brief that names every long tail ("say each … at least
     once"), every short ("say each … between 2 and 5 times") and closes with
     `Work every keyword into natural spoken sentences - never read them out as a list`.
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
  - every **short** keyword must appear **2-5** times (`SEO_SHORT_FREQ_MIN/MAX`); **both** bounds
    are failures, not trims;
  - every **long-tail** keyword must appear **>= 1** time (`SEO_LONG_FREQ_MIN`), with no upper bound;
  - the first violation in list order becomes the retry reason handed to the model, e.g.
    `the short keyword "x" appears 1 time(s); it must appear 2-5 times`,
    `the short keyword "x" appears 8 times; use it at most 5 times`,
    `the long-tail keyword "x" never appears; say it at least 1 time`.
  - Restriction: `\b` anchoring means a glued word never counts (`budgetgear` ≠ `budget gear`) and
    the keyword `ai` is not matched inside `said`.
- Retry policy: **3 attempts per stage**; every writer retry re-sends the same keyword set with
  `" Your previous attempt was rejected: <exact reason> Try again and fix that exact problem."`
  - After 3 writer failures → `500 {success:false, error:"Script output invalid (<reason>) - try again"}`.
- Success payload:
  `{success:true, srt, keywords:{longTail:[{keyword,count,short[]}], short:[{keyword,count,min:2,max:5}]}, model}`.
  - Restriction: `count` is the **measured** frequency in the returned script - the UI displays it,
    and a keyword can only be listed with a count inside its rule, because the same numbers gate
    the response.
  - Restriction: **each request now costs at least 2 Workers AI calls** (up to 6 with retries)
    against the 10 000 neurons/day free allocation - twice the old price for every script.
- Client side (`src/client/app-js.ts`, video accordion):
  - The SEO block is the **first** `.va-section` of `.va-left`, titled
    **"Generate SEO Script With AI"**, with the always-visible hint line
    `SEO rule: 2 long-tail keywords · 2–5 short keywords · every short keyword is said 2–5 times`
    and a matching button tooltip. See RULE 18 for the hint inventory.
  - The client still sends only `{topic, minutes, speed}`: the user never picks keywords, and the
    UI only reports the ones the model produced.
  - On success `generateScript()` stores `project.srt`, fills `#va-script-box-N`, renders the
    keyword chips into `#va-script-keywords-N` (`renderSeoKeywords()`, every keyword passed through
    `escapeHTML()`), reveals the SRT box + **⬇ Download .srt** and enables **🎙 Generate Voiceover**.
  - Restriction: on failure the status line becomes `Script failed: <error>` and the previous chips
    and SRT box stay on screen (same as the old SRT behaviour) - nothing is cleared or replaced.

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

  - `FPS = 30` is a constant, not configurable (`app-js.ts:12155`); `KEYFRAME_INTERVAL = FPS * 10`
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
    (`MAX_ENCODE_QUEUE`, `app-js.ts:12597`) and rethrows any asynchronous encoder error.
  - Progress bar: audio owns the first 25 %, video frames the remaining 75 %.
  - Cleanup always closes the encoder and aborts a half-written file stream.

---

## RULE 12 — GIFs are decoded one frame at a time under a memory budget

- The client ships its own GIF pipeline (no library): LZW decode → de-interlace → per-frame
  compositing → disposal handling → `{width,height,frames[],startMs[],loopMs}`.
- Memory guard: `BUDGET_BYTES = 120 MB` for all stored frames
  (`frames * w * h * 4`); if exceeded, every frame is downscaled by
  `sqrt(BUDGET / raw)` clamped to a floor of `0.15` (`app-js.ts:5661`).
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
  - `session:<hex token>` — no TTL (permanent until logout).
  - `job:<jobId>` — TTL 3600 s.
  - `blob:<id>:<part>` and `blob:<id>:_idx` — TTL 7200 s (payloads *and* delivered MP4s).
  - `config:workers` — no TTL (single JSON string).
- Consequences to state plainly to users:
  - a delivered MP4 is downloadable for roughly 2 hours, and its job record disappears after 1;
  - a browser tab close discards all studio work (no localStorage/IndexedDB usage at all);
  - accounts and sessions are effectively permanent, so any KV cleanup must be manual.

---

## RULE 16 — Build, deploy and verification rules

- `wrangler.json`: `main = src/index.ts`, `compatibility_date = 2025-10-08`,
  `ai.binding = AI`, `observability.enabled = true`, `upload_source_maps = true`, and one KV
  namespace binding `KV_BINDING` with a **hard-coded production namespace id**.
  - Restriction: without `KV_BINDING` the app still boots, but auth answers `503` and all
    render/worker routes answer `503 "Render storage not configured (bind the KV namespace)"`.
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
  security standpoint; every data route is anonymous (see RULE 2, RULE 3).
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
> blocking `alert()` boxes. The inventory below was taken on **2026-10-15**, after the SEO script
> change. Changing a limit or a rule without changing these strings leaves the UI lying to the user.

- Discovery pattern for an audit: search `title="`, `placeholder="`, `alert(` and
  `class="…note…"` / `class="…hint…"` / `class="…tip…"` in the three template literals that become
  the page — `src/client/app-js.ts` (`APP_JS`), `src/client/markup.ts` (`PAGE_MARKUP`) and
  `src/client/template-composer-js.ts` (`TEMPLATE_COMPOSER_JS`).
- Counts, measured on the two served pages on 2026-10-18: **21 tooltips · 7 placeholders ·
  34 `alert()` call sites** (32 in the studio script: 26 `app-js.ts` + 6 `template-composer-js.ts`;
  2 in the settings script) **· 13 note/hint/tip class usages** in the studio markup plus
  **7 notes/status elements** built by the settings script — ≈ 82 user-visible hint strings.
  - Per source file: `app-js.ts` 26/13/5 (alerts/tooltips/placeholders), `template-composer-js.ts`
    6/7/1, `markup.ts` 0/1/1, `config-page-js.ts` 2/0/0.
  - Restriction: every one of them is a literal inside a template literal, and the client has no
    access to the Worker's constants - each number in a hint is a **hand-copied duplicate** of a
    constant, i.e. the same drift risk as the hard-coded settings password (RULE 3) and the
    duplicated model ids (RULE 17).

### Hints that mirror a limit or a rule (change them together)

| Hint text (abridged) | Where it lives | Mirrors |
| --- | --- | --- |
| `SEO rule: 2 long-tail keywords · 2–5 short keywords · every short keyword is said 2–5 times` | video accordion, SEO section (`.va-note`, always visible) | `SEO_LONG_TAIL = 2`, `SEO_SHORT_TOTAL_MIN/MAX = 2/5`, `SEO_SHORT_FREQ_MIN/MAX = 2/5` (RULE 7) |
| `AI plans 2 long-tail keywords and 2-5 short keywords (each short said 2-5 times) and writes the SRT script around them` | **✨ Generate SEO Script** button tooltip | the same SEO constants |
| `Long-tail keyword — must be said at least 1×` · `Short keyword — must be said 2–5×` | keyword chips, `renderSeoKeywords()` tooltips | `SEO_LONG_FREQ_MIN = 1`, `SEO_SHORT_FREQ_MIN/MAX = 2/5` |
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
| `Theme for the studio page — every visitor sees it. Strata and Stellar follow the HTML5UP designs of the same name.` | settings page, Appearance group (`.cfg-note`) | RULE 19 (three skins, global setting) |
| `Built-in dark studio (default)` · `Light panels, teal accents` · `Violet gradient, frosted panels` | theme cards (`.cfg-theme-sub`) | what each skin in `CONFIG_THEMES` looks like |
| `Current theme: Studio (default).` / `Current theme: Strata.` | Appearance status line | the value stored under `config:theme` |
| `Preview only — press Save theme to apply it for everyone.` | Appearance status line after picking | the preview is client-side only (RULE 19) |
| `Saved — reload the studio page to see the new theme.` | Appearance status line after saving | server-side injection on the next page render |

### Blocking `alert()` boxes (31 — the app's only modal feedback)

- Media intake: `You can add at most <n> images (jpg, png, jpeg).` / `… GIFs.` / `… MP4 clips.`,
  `'<file>' is <n>s long. Each MP4 clip must be at most 1:00.`, `'<file>' could not be read as an MP4 clip.`,
  `Could not read that audio file. Please upload a valid MP3.`,
  `Could not decode that GIF animation. It was added as a still image instead.`,
  `You can add at most 10 videos.`
- AI images: `Enter an image prompt first.`, `Image generation failed: <error>`
- Render: `Please wait for images to generate or upload your own!` (also gates the **🎬 Generate
  Videos** button), `<project>: add at least one image, GIF or MP4 first.`,
  `A video is already being generated — please wait for it to finish.`,
  `Your browser does not support WebCodecs. Please use modern Chrome, Edge, or Safari.`,
  `Your browser cannot encode audio (WebCodecs AudioEncoder missing). Rendering a silent video.`,
  `Audio could not be encoded. Rendering a silent video.`,
  `Video rendering failed: <error>\n\nTry reducing the number of images or closing other browser tabs.`
- Render API (**☁️ API**): `API error: <error>`, `API: <message>`, `API: job expired or not found.`
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

- `Click the round Add Video button (top left), then press Generate.` (`.action-hint` in the
  main panel; it said "red" until the theme work — the button is amber in the default skin
  but teal or white in the other two).
- `Pick a template — each preview is the real animation` (composer status),
  `Preview:` (main panel caption preview).
- Placeholders: `Enter your video title...` (main panel + accordion), `Topic (uses the video title
  if empty)`, `Describe the image (always 480px landscape)`, `Text (max 12 chars)` (composer
  text-layer input).
- Restriction: the settings page breaks the alert convention on purpose — it reports through
  status lines (`.cfg-note`, `.cfg-status`) instead of `alert()`s, so a failed theme save
  leaves the picker usable.
- Restriction: inside a video accordion the *only* explanation of the SEO rule is the always-visible
  `.va-note` line under the section title - the keyword chips appear only **after** a successful
  generation, so the rule must be readable *before* the first click. That is why the hint line is
  static markup (`videoAccordionHTML()`) and not generated together with the chips.

---

## RULE 19 — The studio ships three skins, chosen globally on the settings page

- Three looks, selected by the `data-theme` attribute on `<html>`; **absence of the attribute is
  the default** (the amber-on-charcoal studio look that shipped first).
  - `strata` — legacy API/storage value for **Aerial**: blue sky and a bundled mountain
    backdrop, diagonal overlays, white type and translucent blue panels, adapted from
    HTML5 UP Aerial by @ajlkn (CC BY 3.0; see `THIRD_PARTY_NOTICES.md`). Saved Strata
    choices get the new look without a KV migration. Motion respects reduced-motion settings.
  - `stellar` — pink-to-violet 45° gradient backdrop with a fixed dot overlay and frosted
    translucent panels (same provenance: HTML5UP "Stellar").
  - Restriction: the CSS is **additive**. Every rule is scoped `html[data-theme=…]` (or
    `html[data-theme]`), so without the attribute not a single declaration applies and the default
    look is byte-identical to before the feature.
- Storage and API:
  - one KV key, `config:theme`, value `default | strata | stellar`, no `expirationTtl`.
  - `GET /api/config/theme` → `{success, theme, themes:[default,strata,stellar]}`; open (no
    password).
    - Restriction: it is the only config GET besides `/api/config/workers` that answers
      anonymously; it leaks nothing but the skin name, and the page itself already carries it.
  - `POST /api/config/theme` `{pw, theme}` → `403` wrong password, `400 Unknown theme` (anything
    outside the whitelist, including lowercase misses and attribute-injection attempts),
    `503 Theme storage unavailable` if the KV write throws.
  - Restriction: only the three whitelisted strings can ever be written or injected — the value
    is lower-cased and checked against `CONFIG_THEMES` **before** the key is touched, and
    `applyTheme()` only ever builds `data-theme="<name>"` from that whitelist.
- Injection is server-side, so there is no flash of the wrong theme:
  - `applyTheme(html, theme)` rewrites a **copy** of the cached page at the literal
    `<html lang="en">` → `<html lang="en" data-theme="strata|stellar">`; `default` returns the
    cached string untouched (1 `String.replace` for a themed page, 0 for the default).
  - Both HTML routes do it: `GET /` and `GET /{current-day}/config/uvxyz`.
  - Restriction: it costs **one extra KV read per page render** (see `kv-scale-test.md` §5) and
    cannot be cached across requests, because a theme change must apply on the next load.
  - Degradation: no `KV_BINDING` → `default`; a throwing `KV_BINDING.get` → `default` (the page
    still serves 200 — a broken KV never takes the studio down); a throwing `put` → the JSON `503`
    above.
- The picker lives in the settings page's **Appearance** group (RULE 3) and previews instantly by
  setting/removing `data-theme` on `document.documentElement`.
  - Restriction: the theme names exist in **three** places that must be kept in step — the worker
    whitelist (`CONFIG_THEMES`), the CSS token blocks (`html[data-theme="…"]`) and the picker's
    `themeOptions` array. A fourth theme needs all three (plus a preview class), and the worker's
    `400` is the only guard against a half-added theme.
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
