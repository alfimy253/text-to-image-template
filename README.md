# YouTube Vibe Studio

A creator landing page and video studio served by one Cloudflare Worker. The studio runs
**entirely in the browser**: turn images, GIFs, MP4 clips and an MP3 into a finished MP4 with a
title, timestamp captions written from a plain narration script and a MeloTTS
voiceover. Stickers are gone: there is no sticker control and nothing is drawn over the frame.

> The repository started life as Cloudflare's `text-to-image-template`; the only part of the
> original that remains is the Workers AI image route. The README below describes **this**
> application.

## What it does

- **Public landing page.** A responsive introduction explains the studio; the top **Sign up** link
  and bottom **Log in** menu open the existing KV-backed account flow. A signed-out visitor can
  explore the landing page before entering the studio.
- **Videos stack, not one timeline.** Press **+ Add Video** to create up to **10** independent
  "Video N" accordions, each with its own images/GIFs/MP4s, MP3, title, quality, script and AI
  image panel — and a **🗑 Delete Video** button in the header that removes the video and
  renumbers the stack (Video 1..N, no gaps; the survivors keep their files, audio and script). **🎬 Generate Videos** renders them one after another.
- **Rendering is local and free.** WebCodecs `VideoEncoder` (H.264) + `AudioEncoder` (AAC) +
  `mp4-muxer` — no FFmpeg, no server rendering. Chrome/Edge stream the file straight to disk via
  the File System Access API; other browsers build it in memory.
- **AI on demand.** Stable Diffusion XL images per video panel (`/image/gen`), an **SEO explainer
  script** (`/api/script`: the AI first plans 1 long-tail keyword, exactly 4 short keywords, a
  title carrying one short keyword and at least one heading carrying one, then writes a plain
  narration script that *says* the long-tail keyword at least once and each short keyword at least
  twice —
  extra uses allowed, every rule enforced server-side), and a MeloTTS
  voiceover (`/api/voiceover`) with a free fallback TTS engine.
- **Generate SEO Script walkthrough.** Pressing **✨ Generate SEO Script** disables that video's
  **Upload Image, GIF or MP4** button and opens a walkthrough modal: `POST /api/seo-plan` plans
  two validated keyword sets; the user selects one and chooses from exactly ten image styles:
  **Cinematic Film, Editorial Magazine, Kinetic Typography, Neon Night, Minimalist, Retro Poster,
  Documentary, Split Composition, Dream Glow** or **Pop Comic**. The script is written from the
  selected set, then **one** `POST /api/image-prompts` returns the finished scene prompts in its
  response body — no job URL and no polling. The prompt LLM sees a compact, two-sentence script
  idea and returns broad, concise scenes consistently styled from the chosen option (**10**
  prompts for 1 minute, **14** for 2–3 minutes, **20** for 4–6 minutes); a short answer is topped
  up instead of rejected. The browser then sends **one** `POST /api/image-batch`, which renders
  every image **in parallel at 16:9 (1024×576)** and streams each finished image back as an
  NDJSON event, so the gallery fills up "all at once" instead of one image every 20 seconds. The
  batch respects the video's **25-still cap** (only the free slots are requested), refunds failed
  scenes, and always re-enables the upload/script controls. See `system-rules.md` RULE 24 and
  `bug-fix-session-241.md`.
- **Quick Batch table.** The studio's **Table** view is a spreadsheet of up to **10** rows —
  Script (plain text you can paste), Style, Minutes — with **＋ Add row** and
  **✦ Generate (N)**. Generate runs one row at a time (voiceover → prompts → batch images → slides
  → animation), a row that fails is marked failed on its own line, and **Preview Here** /
  **Export Video** only become buttons once that row has all four parts. Export reuses the studio's
  own in-browser WebCodecs renderer and downloads `YouTubeVibeStudio_Row<N>_<slug>.mp4`; nothing is
  posted to a render endpoint. See `system-rules.md` RULE 25.
- **Optional local render app.** `render-app/` (also shipped as `render-app-tts.zip`) turns a script
  of up to **20,000 characters** into one MP3 by driving a **free, no-login** online TTS site with
  Playwright, choosing between exactly two voices — **one male, one female** — behind a hardcoded
  key. It is a separate Node process, not a Worker route: see `render-app/README.md` and
  `system-rules.md` RULE 26.
- **Template scene controls.** Graphic configuration has no Shapes & stickers heading/grid;
  **Delete element** sits beside **＋ Text / ＋ Graphic**, and the layer buttons match the neutral
  top-right **Pause** style without moving.
- **Server-side render API (no longer in the UI).** The former **☁️ API** button was removed in
  Session #243 — that header slot now holds **🗑 Delete Video**. The route set
  (`POST /api/render`, `GET /api/render/<id>`, `/api/worker/poll|deliver|failed`) and the
  background-worker mode on the current-day settings page remain in the code; nothing in the
  studio accordions calls them, and every video is rendered locally or through the quick batch
  table.
- **Accounts.** KV-backed sign-up/sign-in, unlimited accounts (each with an `email:<address>`
  uniqueness index).
- **Account dashboard and manual upgrades.** `/account` shows the signed-in profile, live daily
  allowance, plan, recent receipts and the correct studio destination (`/studio` for free,
  `/paid` for paid). `/upgrade` displays editable local-gateway instructions and a signed-in
  screenshot uploader. This is **manual payment verification**, not an automated payment provider:
  an administrator reviews the receipt, enters its transaction number and approves it, which sets
  `usertype = "paid_user"`; the next credit/request read receives the 1,200-image allowance.
  Receipt images are restricted to their owner or the settings administrator.
- **Basic CMS.** The current-day settings page's **CMS Pages** tab creates, edits and deletes up
  to **8** public, single-level pages. Blocks are paragraphs and HTTP(S) image URLs (two images
  per row), with reorder/remove controls and an escaped live preview. Each page can inject its
  link into the shared top menu or footer. Reserved/nested routes, duplicate slugs, data-URI image
  uploads and more than 100 blocks are rejected; public text is HTML-escaped.
- **Daily credits.** Every account is on a plan (`usertype`): **free** — unlimited video projects,
  unlimited AI scripts, unlimited voiceovers and **50 AI images per day**; **paid_user** —
  everything in free plus **1,200 AI images per day**. Counters live in KV
  (`credits:<username>`) and renew at midnight Asia/Taipei (UTC+8). The studio shows a credits
  pill with today's allowance, the image route returns `429` with the counters when the allowance
  is spent, and the settings page can promote an account to `paid_user` (or reset its counters).
  The landing page documents both plans and follows the active theme.
- **Freemium access (`/free`).** No account? `GET /free` opens the same studio with a **guest**
  plan: **10 AI images per day**, unlimited videos, AI scripts and voiceovers. Guest counters are
  keyed by a salted hash of the visitor's IP address (`ipcredits:<hash>`, 2-day TTL), so the limit
  is per network and cannot be reset by clearing cookies. With KV bound, anonymous image
  generation is only unlocked by the `yvs_free=1` cookie that `/free` sets; everything else stays
  sign-up-first. (Without a KV binding the gate is skipped and generation is unmetered — the same
  open-access mode as the other routes.)
  The settings page has a **Guest credits by IP** table (masked address, usage, remaining, last
  seen, reset). See `bug-fix-session-206.md`.
- **Plan-based URLs.** `/free` (everyone), `/studio` (`free_user` / `paid_user`) and `/paid`
  (`paid_user` only) serve the same shell in a different plan mode; guests are redirected to
  `/free`, free accounts to `/studio` (RULE 21).
- **Seven UI themes.** The current-day settings page → **Appearance** switches the whole studio
  between the built-in dark look, **Aerial** (blue sky, mountain backdrop, white accents),
  **Stellar** (violet gradient, frosted panels), **Night Lab** (charcoal + lime), **Warm Paper**
  (paper + coral), **Swiss** (white + electric blue) and **Neo Brutalist** (cream, 2px black
  borders, lime). Aerial and Stellar are HTML5UP-inspired; the last four are the studio's own
  skins. All of them are applied server-side so there is no flash.
  Aerial retains the legacy `strata` API/storage value, so saved selections still work.
  See `THIRD_PARTY_NOTICES.md` for the Aerial background attribution.
- **Two views, one state.** A sticky top bar switches between the **Bulk grid** (`#view-table`,
  labelled "Quick batch table" inside the card — see `system-rules.md` RULE 25) and the **Editor**,
  a *Build your video* accordion card (65% of the row, single-column sections inside) beside a
  sticky preview monitor that takes 35% — the same split in every theme. The table keeps its own
  list of up to 10 script rows and drives the very same render path as the Editor; the accordion
  counters it shares (`N of 10 videos`, `N in queue`) are refreshed by the same function, and the
  view choice is memory-only. There is deliberately **no timeline**.
- **Large accordion controls.** In every theme, buttons inside each **Video N** accordion use the
  Upload Image proportions (`12px 24px` padding, 1rem type, at least 48px high/wide). Neo
  Brutalist gives every one of those buttons square corners, including icon and remove buttons.
- **Template composer.** The "Add video from template" link opens one gallery of
  **Interactive scenes · 15**: the 14 Reel designs (Kinetic Typography, Duotone, Neon,
  Glitch Art and Vox Magazine) plus **3D Ring Carousel**. There are no Motion or
  Graphics/Shape-animation gallery tabs or cards, and no "15 editable designs" accordion
  in any template's configuration; use **← Templates** to choose another design.
  In Reel scenes, element tags sit below the preview. Select a text or graphic element to
  edit it, drag it to reposition, use **+ Front layer** / **- Back Layer** to move it one
  layer forward/backward, and use **Rotate degrees** (0–360°, 1° steps) to rotate it.
  Layer limits disable the corresponding button; the background always stays behind elements.
  **＋ Text** becomes **＋ Graphic** for a selected graphic. The **Graphics** dropdown has the
  original nine shapes/stickers plus all **13 animated objects**: Morphing SVG Blob, Rotating
  3D Box, Pulsing Ripple Ring, Floating Glass Card, Orbiting Satellite, DNA Helix Pulse,
  Infinite Tunnel Zoom, Kaleidoscope Spinner, Elastic Bounce Ball, Audio Equalizer Bars,
  Diamond Crystal Spin, Neon Laser Beam and Shimmer Spinner Ring. These are real elements with
  main/accent colours, size, motion, speed, position, rotation and layer controls, not separate
  templates. Particle/confetti effects remain omitted. Compact colour boxes offer 12 solids,
  a custom colour and one row of four gradients.
  The **3D Ring Video Template** has a **Ring images** accordion at the bottom of its controls:
  upload **5–7 images together** to replace the cards. Invalid counts, non-images or unreadable
  files keep the previous valid set; thumbnails allow removal down to five images. Both export
  actions require a valid decoded set. The ring uses exactly those images for preview/export,
  with visibility, rotation-speed, radius, card-size, 3D-tilt, 0–360° rotation, X/Y and reset
  controls. Reset keeps uploads; images remain in browser memory only. Bundled samples are
  preview-only until the user uploads their own images; no remote image service is required.
  Every editor uses the same canvas for preview and H.264 MP4 export (WebCodecs + mp4-muxer,
  no screen capture). **⬇ Download MP4** is the only download action; **➕ Add to Video N**
  renders without downloading and inserts the clip directly into that accordion's gallery.
  Portrait 9:16 or landscape 16:9, 1–25 s.

## Limits worth knowing

| Thing | Limit |
| --- | --- |
| Videos per session | 10 |
| Assets per video | 25 images · 5 GIFs · 5 MP4s (60 s each) |
| Slide timing | 9 s per image/GIF; MP4 clips play in full; the list repeats to cover the MP3 |
| Captions | 10 rows, 40 characters each; last caption capped at 10 s on screen |
| Script | 1-6 minutes, `super fast` / `fast` / `medium` / `slow`; plain narration text — no SRT, no timestamps needed |
| SEO keywords | exactly 1 long-tail (no word/character length rule, said **at least once**) + exactly 4 short keywords (≤3 words, each said **at least twice**); **minimums only — extra uses are allowed and never rejected**; short/long-tail overlap allowed, shared uses count for both; one short in the AI title (≤70 chars), one in a heading |
| Ring template images | 5–7 decoded uploads, required before Download MP4 or Add to Video; separate from the normal two background photos |
| Element rotation / layers | 0–360°, 1° steps; layer buttons move the selected text/graphic one step, never behind the background |
| Voiceover | 8,000 characters max, chunked at 500; English in the UI |
| Render API | 10 in-flight jobs, 60 MB payload, outputs kept 2 h (job records 1 h) |
| CMS | 8 pages · 100 blocks/page · flat slug up to 64 chars · paragraph text up to 20,000 chars/block · HTTP(S) image URLs only |
| Payment screenshots | PNG/JPEG/WEBP/GIF magic bytes · 5 MiB · authentication required · manual admin approval |
| Theme | one setting for the whole deployment: `default` · `strata` · `stellar` · `nightlab` · `paper` · `swiss` · `neo` |
| Free plan (`usertype: free`) | unlimited videos · 50 AI images/day · unlimited AI scripts · unlimited voiceovers |
| Paid plan (`usertype: paid_user`) | unlimited videos · 1,200 AI images/day · unlimited AI scripts · unlimited voiceovers |
| Free-plan alias | `free_user` (or any value other than `paid_user`) is read as `free` |
| Guest plan (`/free`, no account) | unlimited videos · **10 AI images/day per IP address** · unlimited AI scripts · unlimited voiceovers |
| Credit renewal | daily at midnight Asia/Taipei (UTC+8); `credits:<username>` and `ipcredits:<hash>` records expire after 2 days |
| Guest IP records | only a salted SHA-256 hash + masked address (`203.0.113.0`) are stored, never the raw IP |
| Quality | 480p/1.2 Mbps · 720p/2.5 Mbps · 720p/5 Mbps, 30 fps |

## Hints you will see in the UI

The app explains its own rules in the interface, so nothing here should surprise a user. These are
the strings that carry the rules (the full inventory, with the constant each one mirrors, is
`system-rules.md` → **RULE 18**):

| Where | Hint |
| --- | --- |
| Video accordion, **Generate SEO Script With AI** (first block of the left column) | `SEO rule (explainer): 1 long-tail keyword said at least 1× · exactly 4 short keywords said at least 2× each · minimums only, extra uses are allowed · one short keyword is in the title · one is in a heading · short/long-tail overlap is allowed and shared uses count for both · no long-tail length rule` |
| ✨ **Generate SEO Script** button | tooltip: *AI plans 1 long-tail keyword (said at least once), exactly 4 short keywords (each said at least twice) plus the explainer title and headings, then writes the plain narration script around them. Extra uses are allowed. Short keywords may overlap the long-tail (shared uses count for both); no long-tail length rule.* |
| SEO plan chips (after a successful run) | Title row · Headings row · `long-tail keyword — must be said at least 1×` · `short keyword — must be said at least 2×; shared occurrences inside the long-tail count too; one short keyword is in the title and one in a heading`, each keyword chip showing the measured count, e.g. `coffee brewing 2×` (a count above the minimum is valid) |
| Video accordion, media block | `Max 5 GIF · 25 images · 5 MP4 (1:00 each, silent)`; **Add video from template** tooltip says *max 25 seconds*; the modal explains the selected editor's motion controls and reminds users the exported clip is silent |
| Template element inspector | `+ Front layer` / `- Back Layer`, `Layer N of M`, `Rotate degrees` + live `N°` readout (0–360°) |
| Ring template, bottom accordion | `Ring images · N / 7 (min 5)`; choose 5–7 images together; inline errors preserve previous images |
| Video accordion, **AI Images** | `2 images per submit · 480px landscape` (also the status line for failures) |
| 🎙 **Generate Voiceover** | tooltip: *Speak the script to MP3 with MeloTTS (English) + apply it as subtitles*; modal note repeats that the voice is fixed English and the MP3 must be uploaded manually |
| Video accordion header | **🗑 Delete Video** — tooltip: *Delete this video with its images, MP4s, audio and script* (replaces the removed ☁️ API button; deleting renumbers the stack) |
| Main panel notes | slideshow repeats to cover the track · captions sit 4/7 up from the bottom, 17px Bookman, last one capped at 10 s |
| Onboarding | `Click ＋ Add Video above, then press Generate.` |
| Bulk grid (batch table) / editor heads | `One row — one video` → `N rows · M with a script` (`#batch-note`) · `N of 10 videos` (`#concept-count`) · `idle` / `N in queue` / `table generating` (`#preview-state`) · empty state `No rows yet — press ＋ Add Row, paste a script, pick a style and press ✨ Generate.` (`#batch-empty`) |
| Settings page, Appearance | `Current theme: Night Lab.` · `Preview only — press Save theme to apply it for everyone.` · `Saved — reload the studio page to see the new theme.` |
| Blocking alerts | only for hard failures and cap breaches (e.g. `You can add at most 25 images (jpg, png, jpeg).`); the AI script instead reports `Script failed after 3 attempts: <error>` in its status line (two retries happen first, silently) so a retry can start immediately |

Status lines (`#va-status-N`, `#va-script-status-N`, `#va-ai-status-N`) are the normal progress
channel; the script line ends with `Script ready — N lines (<speed> speech, <minutes> min) · SEO:
1 long-tail (≥1×) + 4 short keywords (≥2× each) · title + N heading(s)`.

**Keyword-frequency rule (minimum-only).** The long-tail keyword must appear **at least once**
in the spoken script and each of the four short keywords **at least twice**. There is no maximum:
a keyword said three or four times is accepted and never triggers a retry. Repetition is counted
on the spoken dialogue only (cue numbers, timestamps, title and headings do not count), and a
short keyword nested inside a long-tail occurrence counts for both roles. The server returns
`min` (and `max: null` = unbounded) with every measured `count`; the full contract is
`system-rules.md` → RULE 7.


## Setup

```bash
npm install

# create your own KV namespace and put its id in wrangler.json
npx wrangler kv namespace create KV_BINDING

npx wrangler dev      # local development
npx wrangler deploy   # deploy
npx wrangler tail     # live logs
```

Bindings in `wrangler.json`:

- `ai` → Workers AI (required by `/image/*`, `/api/script`, `/api/voiceover`)
- `kv_namespaces` → `KV_BINDING` (required by accounts, the render API/worker queue, persistent
  CMS pages and payment uploads/approvals; the landing page remains available if it is missing,
  and the studio can still be opened through its primary CTA. Account/render routes and CMS/payment
  writes answer `503` without KV. Public CMS listing/pages are empty/404 without stored pages.)

The settings page is password-gated and uses **`/{current-day}/config/uvxyz`**, where
`{current-day}` is the unpadded day of month (1–31) in **Asia/Taipei**. For example, on
2026-10-16 the URL is **`/16/config/uvxyz`**; it changes at midnight Asia/Taipei. The old bare
`/config/uvxyz` path and any stale day-prefixed path return `404`. The page picks the **theme**
for every visitor (Appearance → *Studio / Aerial / Stellar / Night Lab / Warm Paper / Swiss /
Neo Brutalist* → **Save theme**), manages **plans
& credits** (set an account to `free` or `paid_user`, optionally reset today's counters), reviews
**guest credits by IP** (masked address, today's usage, remaining images, reset), registers
background worker URLs, and can switch a tab into "Background worker" mode to consume the render
queue. Its other tabs edit the **Local Payment Gateway** instructions, review paginated **Payment
Transactions** and approve verified transaction numbers, and manage **CMS Pages** with the Add
Page editor/live preview. The landing page uses the same theme tokens as the studio, so the chosen
skin covers the whole site.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /` | Public landing page; studio view when signed in or opened from the CTA |
| `GET /free` | Freemium studio for everyone; sets `yvs_free=1` so guests can spend 10 image credits/day per IP |
| `GET /studio` | Account studio (`free_user` / `paid_user`); guests are redirected to `/free` |
| `GET /paid` | Paid-tier studio (`paid_user` only); guests → `/free`, free accounts → `/studio` |
| `GET /account` | Account dashboard: inline auth when signed out; profile, credits, plan, recent receipts and studio/payment actions when signed in |
| `GET /upgrade` | Public local-gateway instructions; inline auth when signed out, screenshot uploader/history when signed in |
| `GET /{current-day}/config/uvxyz` | Settings / background-worker page; current Asia/Taipei day only (e.g. `/16/config/uvxyz` on 2026-10-16) |
| `GET /{slug}` | Public CMS page after all built-in routes; one flat non-reserved slug, otherwise `404` |
| `GET /image/:i` | Workers AI demo image (unmetered, index into `prompts[]`) |
| `GET /image/gen?prompt=&variant=` | Workers AI image for the studio; costs 1 image credit — session (50/1,200 per day) or `yvs_free` guest (10/day per IP); `401` for a cold anonymous request when KV is bound, `429` at the limit, `X-Credit-*` headers on success |
| `POST /api/script` | SEO plan (title + headings + 1 long-tail + 4 shorts) + AI explainer script → validated **plain-text** script (`{script, format:"plain"}` — no `srt` key is returned) plus keyword counts; accepts a user-selected `keywordSet` from `/api/seo-plan`, which is re-validated and skips the planner |
| `POST /api/seo-plan` | Two different validated SEO keyword sets (title + headings + 1 long-tail + 4 shorts each) for a topic, for the walkthrough's Select step |
| `POST /api/image-prompts` | Synchronous scene prompts: `200 {prompts, count, expectedCount, style, minutes}` (count 10/14/20 by script length 1 / 2–3 / 4–6 min, in the chosen image style; short answers are topped up); `400` invalid input, `502` model failure, `503` no AI binding. The old `GET`/`DELETE /api/image-prompts/:id` job URL answers `410` |
| `POST /api/image-batch` | One request, every image: `{prompts: string[]}` (≤20) → `application/x-ndjson` with `start`/`tick`/`image`/`done` events. Renders in parallel at 1024×576, 1 image credit per prompt up front (account or `/free` guest allowance) refunded for failures; `401` anonymous, `429` no credits, `400` invalid prompts |
| `POST /api/voiceover` · `GET /tts` | MeloTTS voiceover / fallback TTS proxy |
| `GET /api/session` · `POST /api/signup` · `POST /api/login` · `POST /api/logout` | Accounts (session/signup/login include `usertype`, `plan` and `credits`) |
| `GET /api/credits` | Today's plan, used counters, remaining allowances and `resetsAt` — for the signed-in user, or the IP-keyed guest plan after `/free` |
| `POST /api/payments/upload` | Signed-in PNG/JPEG/WEBP/GIF receipt upload (multipart or JSON data URL), max 5 MiB; creates a `pending` record |
| `GET /api/payments/my` · `GET /api/payments/image/:id` | Signed-in user's receipt history / owner-only receipt bytes |
| `POST /api/config/verify` | Verifies the settings password for the full-page inline unlock and returns the active theme |
| `GET`/`POST /api/config/payment-gateway` | Public gateway details / update name, details and upload instructions with the settings password |
| `GET /api/config/payments` · `GET /api/config/payments/image/:id` | Password-gated paginated admin review (default 5, max 24/page) / admin receipt bytes |
| `POST /api/config/payments/approve` | Password-gated approval with a required, unique transaction number; marks receipt approved and promotes its account to `paid_user` |
| `GET /api/cms/pages` | Public saved CMS page list (`maxPages: 8`); no authentication because saved pages are public |
| `GET`/`POST`/`DELETE /api/config/cms` · `POST /api/config/cms/delete` | Password-gated CMS list / create-or-update / delete; `POST` accepts an optional page `id`, and duplicate slugs return `409` |
| `POST /api/render` · `GET /api/render/:jobId` | Submit a render job / poll and download |
| `GET /api/worker/poll` · `POST /api/worker/deliver` · `POST /api/worker/failed` | Background worker queue |
| `GET`/`POST /api/config/workers` | Registered worker URLs (max 3, `POST` needs the settings password) |
| `GET`/`POST /api/config/theme` | Current UI theme / set it (`default`, `strata`, `stellar`, `nightlab`, `paper`, `swiss`, `neo`); the GET is open, the POST needs the settings password |
| `GET`/`POST /api/config/users` | Accounts with plan + today's usage / set `usertype` (`free`, `paid_user`) and reset counters — both need the settings password |
| `GET`/`POST /api/config/ipcredits` | Guest credits table (masked IP, usage, remaining) / delete one IP row (reset) — both need the settings password |

## Documentation

- **`userflow.md`** — every actor-level flow (page load, auth, per-video setup, local render,
  render API + worker, settings page) plus a failure/edge-path matrix and a code map.
- **`system-rules.md`** — the high-level system rules with the nested technical detail,
  invariants and restrictions behind each of them (RULE 7 = the SEO script, RULE 18 = the
  inventory of every user-visible hint: tooltips, notes, placeholders and alerts, RULE 19 =
  the seven themes and where the choice is stored, RULE 22 = the studio shell and its two views,
  RULE 23 = CMS, payments and the account dashboard, RULE 25 = the Quick Batch table,
  RULE 26 = the local render app).
- **`script-keyword-retry-debug.md`** — Session #243: why `POST /api/seo-plan` was failing, the
  retry contract of every keyword function, the transport-retry / model-fallback / one-set
  (`partial: true`) fixes and their tests.
- **`quick-batch-table-system-requirements.md`** — Session #243: how the Quick batch table works
  row by row, the hanging bulk-grid code the audit found and removed, and the system requirements
  (bindings, browser APIs, limits, timeouts) it depends on.
- **`new_requirements.md`** — the modular CMS/payment/account notes and KV schema plus the
  SEO overlap, ring uploads, layer/rotation and Graphics-dropdown requirements (§6);
  the README, userflow and system rules describe the verified current behavior.
- **`kv-scale-test.md`** — measured KV behaviour (operations per request, list-page caps,
  free-tier allowance maths) with the reproduction commands.
- **`bug-audit.md`** — the current bug and inconsistency audit, with severity and fixes.
- **`bug-fix-session-206.md`** — Bug Fix Session #206: plan-based URLs (`/free`, `/studio`,
  `/paid`), freemium guest access, the per-IP credits table and its verification evidence.
- **`bug-fix-session-211.md`** — Bug Fix Session #211: the two runtime defects found by the
  2026-10-22 register — a guest refund erasing the IP row's identity, and
  `GET /api/config/workers` throwing without a KV binding — with the before/after code and the
  77-check verification.
- **`bug-fix-session-240.md`** — Bug Fix Session #240: the studio shell (top bar, two views,
  read-only bulk grid, hidden legacy panels, no timeline) and the four extra skins ported from
  the uploaded `video_bulk_production` reference, with the 44-check DOM harness and the 36-check
  route harness.
- **`bug-fix-session-242.md`** — Bug Fix Session #242: plain-text scripts (SRT removed from the
  whole path), the three-paragraph prompt guard, script retry + stacking modals, the Quick Batch
  table's Preview/Export unlock rule, and the new `render-app/`.
- **`render-app/README.md`** — the standalone script → MP3 helper: how to run it, its two API
  routes, the 20,000-character cap, its two voices and how to retarget a host.
- **`seo-walkthrough-session-requirements.md`** — the SEO walkthrough record: original
  requirements and audit snapshot plus the 2026-10-24 fix follow-up. Its recorded regression
  verification was **45 passing tests** (the suite is **64** as of 2026-10-25), including
  Worker-route and jsdom gallery-flow coverage;
  the original Register A/B findings are marked as historical where this follow-up resolves them.

## Notes for contributors

- `src/index.ts` holds the route table and delegates the modular CMS/payment/account surfaces to
  `src/modules/{cms,payments,user-pages}.ts`; `src/page.ts` assembles and caches the studio page.
  The SEO planner/writer lives in `src/modules/script-seo.ts` (plus the two-set
  `/api/seo-plan` handler and the `keywordSet` fast path), the synchronous prompt writer lives in
  `src/modules/image-prompts.ts`, and the streamed batch renderer (16:9 model call, parallel
  lanes, NDJSON events, credit refunds) lives in `src/modules/image-batch.ts`.
  Template code is split across `template-composer-js.ts`, `template-scene-editor.ts`,
  `template-ring-carousel.ts` and `template-shape-animations.ts`.
- The client files are template literals whose escapes are load-bearing — do not reformat them.
- `src/index.ts.original` is a stale pre-split snapshot of the worker (kept for reference only;
  never imported).
- `npm run check` currently fails at the `tsc` step (the codebase is untyped JS-in-TS); see
  `bug-audit.md` #11.

### Regression checks for the SEO/template revision

```sh
npm ci
npm test
npx wrangler deploy --dry-run
```

`npm test` (verified on Node 22.22.3) covers the SEO planner/writer contract and a DOM/canvas-transform harness for the
composer, including image counts, failed/stale decodes, object-URL cleanup, layer order,
rotated hit testing, every animated graphic and both MP4 actions. The harness stubs the codecs,
not the application render loop. `e2e/index.ts` provides a deterministic AI fixture with an
overlapping, >6-word long-tail plan for `npm run e2e:dev`; this is **mock AI**, not a live model.
Actual Chromium/WebCodecs download and direct gallery insertion were also smoke-tested.

`npm run check` still stops on the **36 pre-existing TypeScript errors in `src/index.ts`**;
the standalone Wrangler dry-run succeeds. This revision does not claim to fix those unrelated
legacy type errors or to verify live Cloudflare model availability.
