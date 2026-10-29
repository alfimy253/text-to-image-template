# YouTube Vibe Studio

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

## Media direction: Pixabay keywords, photos and two clips

The text LLM reads the full narration and plans short Pixabay **search terms (1–5 words)** that
portray the general idea of the entire script. It does **not** generate images. Each automatic
video contains exactly **two Pixabay video scenes**, with remaining scenes using stock photos.
The scene total follows the **script word count**: **≤130 words → 6 scenes**, **≤240 → 8**,
**≤500 → 10** (10 beyond 500 words) — i.e. 4+2 / 6+2 / 8+2 photos+clips. The script's own
long-tail and short SEO keywords are offered to the planner as search vocabulary.

Both Quick Batch and editor automatically import and process the mixed media. The editor's
manual image-prompt/search section has been removed; normal uploads and the media gallery
remain. Narration remains the audio master, and scene timing keeps both clips in the export.
Photo searches return up to **two usable images from page 1** per keyword; each scene imports one selected image. Video searches return up to three clips from page 1. Pixabay requires `per_page=3` upstream, so the server requests three and caps photo results locally. Every planned and searched keyword is logged in the Worker console; see [search debugging](pixabay-media-migration.md#search-debugging-and-latency).

See [the implementation reference](pixabay-media-migration.md) for the whole-script planner,
limits, APIs and deployment checks, and
[bug-fix-session-275-scene-count-consistency.md](bug-fix-session-275-scene-count-consistency.md)
for the word-count scene rule and the wrong-scene-count debug. See also [the script and image keyword deep-debug audit](script-image-debug-audit.md) for both layouts and the reproduced fixes. `npm run test:pixabay` exercises the flow with mocked
browser-media boundaries. Production deployment and live-account/real-device smoke checks
remain outstanding. The inventory below describes pre-migration behavior where it discusses
AI-generated images or the removed manual prompt panel.

## Existing runtime feature inventory (pre-Pixabay migration)


A creator landing page and video studio served by one Cloudflare Worker. The studio runs
**entirely in the browser**: turn images, GIFs, MP4 clips and an MP3 into a finished MP4 with a
title, timestamp captions written from a plain narration script and a MeloTTS
voiceover. Stickers are gone: there is no sticker control and nothing is drawn over the frame.

> The repository started life as Cloudflare's `text-to-image-template`; the only part of the
> original that remains is the Workers AI image route. The README below describes **this**
> application.

## What it does

- **Public landing page.** A responsive introduction explains the studio; the top **Sign up** link
  and bottom **Log in** menu open the existing KV-backed account flow. These are also direct links
  to `/signup` and `/login`, which open the corresponding form on `/account`. A signed-out visitor
  can explore the landing page before entering the studio.
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
  selected set, then the **browser-managed progressive pipeline** requests up to **three** scene
  prompts, starts rendering them, and requests the next prompt batch concurrently. One batch
  of lookahead bounds buffering; there is no job URL, polling, or server-side video management.
  Totals are **6 / 8 / 10** scenes by script word count (≤130 / ≤240 / ≤500), capped by the
  free editor gallery slots. Each prompt request makes one model
  call (45 s budget); the browser retries transient prompt failures up to twice with a 60 s
  request/body timeout, waiting the server's `Retry-After`/`retryAfterMs` hint (bounded at 15 s)
  instead of a fixed 500 ms. Paid images are never automatically replayed. **Bug fix #263** retries
  a failed image chunk **per scene** (only the scenes that failed, original indices, never a
  delivered image), so one busy chunk no longer ends a 10-scene video after the first three
  images; pacing stays **3 images per 3 s per row** and the ceiling stays **10,000 images/day**.
  See [bug-fix-session-263.md](bug-fix-session-263.md). **Bug fix #261** negotiates
  binary per-image responses, browser voiceover chunk assembly, single-attempt script calls,
  compact prompts, adaptive scheduling and ephemeral cross-tab cooperation, with feature-detected
  older-browser fallbacks. Legacy NDJSON remains available. The **25-still cap**, refunds and
  control cleanup remain. Bug fix #261 also keeps a **local-only usage record** (localStorage +
  a two-day counts cookie) for the credits popover; it never authorizes a request and adds no
  Durable Object or migration. Existing KV quotas remain best-effort under concurrency; review
  [#261 implementation, compatibility and limits](bug-fix-session-261.md) before deploying. See
  also the [progressive pipeline audit](progressive-image-pipeline-audit.md).
- **API rotation across backup Workers.** The up-to-three backup Worker URLs registered on the
  settings page were previously stored only. They now form a live **API pool** with the primary
  deployment: every AI route (`/image/:i`, `/image/gen`, `/api/image`, `/api/image-batch`,
  `/api/image-prompts`, `/api/script`, `/api/seo-plan`, `/api/voiceover`, `/tts`) runs its model
  call on whichever member the policy picks, so the 10,000-neurons/day Workers AI allowance and
  the inference load are spread instead of spent on one deployment. Rotation has three strategies
  (round robin, least pending, weighted), per-member health with a 30 s → 5 min circuit breaker,
  automatic failover back to the primary, and an optional browser mode that rotates the whole AI
  request with a signed, path-scoped ticket. Accounts, sessions, credits, payments, CMS and render
  jobs never leave the primary Worker. See [api-relay-rotation.md](api-relay-rotation.md).
- **Two instruct-model providers, rotated.** The SEO planner, the script writer, the
  scene-prompt writer and the raw `POST /api/llm/generate` API can run the instruct model on
  **Cloudflare Workers AI** or on **OpenRouter** (`meta-llama/llama-3.3-8b-instruct:free` by
  default). This rotation sits *above* the backup-worker rotation: choosing Cloudflare still
  spreads the call across every registered backup, while OpenRouter spends no Workers AI neurons
  at all. A failed provider falls through to the other one, a rejected key opens a 60 s → 10 min
  circuit, and image/voiceover models never leave Workers AI. The settings page configures the
  weights, the model slug, the timeout and the API key, and reports each provider's health. See
  [bug-fix-session-271.md](bug-fix-session-271.md).
- **Local usage record.** Bug fix #261 counts today's delivered images, scripts, voiceovers and
  MP4 exports in this browser (`localStorage` per tab + a two-day counts cookie) and shows them in
  the credits popover with a clear button. It is display/history only: records are editable and
  per-device, the Worker never reads them for authorization, and `/api/credits` remains the
  authoritative server summary.
- **Quick Batch table.** The studio's **Table** view is a spreadsheet of up to **10** rows —
  Script (plain text you can paste), Style, Minutes, **Resolution** (480 / 540 / 720 / 1024 px long
  edge) and **Orientation** (square 1:1, landscape 16:9, portrait 9:16) — with **＋ Add row** and
  **✦ Generate (N)**. Both frame columns are sent to `/api/image-prompts` (each scene is written
  for that shape) and to `/api/image-batch` (SDXL really renders at that size), and the preview
  canvas uses the row's frame. Generate starts **three early-stage rows at a time** (voiceover →
  progressive prompt/image chunks → slides → animation); the next queued row starts when the
  first image chunk begins. Stop cancels prompt lookahead and image streaming together. Usable
  partial images are retained on a later failure; row errors remain quiet in the console, and a
  row that is **already finished is skipped** —
  its MP3/images/animation are in memory, so pressing Generate again never re-bills it.
  **Preview Here** / **Export Video** only become buttons once that row has all four parts. Export
  reuses the studio's own in-browser WebCodecs renderer and downloads
  `YouTubeVibeStudio_Row<N>_<slug>.mp4`; nothing is posted to a render endpoint. See
  `system-rules.md` RULE 25.
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
- **Accounts.** KV-backed sign-up/sign-in, unlimited accounts. Each account is one row keyed by
  its unique username — `user:<username>` holds `username`, `email` and the plan (`usertype`) —
  plus an `email:<address>` index whose value mirrors `{ username, email, usertype }`, so the same
  email + plan is readable from either key.
- **Account dashboard and manual upgrades.** `/account` shows the signed-in profile, live daily
  allowance, plan, recent receipts and the correct studio destination (`/studio` for free,
  `/paid` for paid). `/upgrade` displays editable local-gateway instructions and a signed-in
  screenshot uploader. This is **manual payment verification**, not an automated payment provider:
  an administrator reviews the receipt, enters its transaction number and approves it, which sets
  `usertype = "paid_user"`. Image allowances are identical on every plan (10,000/day), so an
  upgrade changes studio access, not the daily image ceiling.
  Receipt images are restricted to their owner or the settings administrator.
- **Basic CMS.** The current-day settings page's **CMS Pages** tab creates, edits and deletes up
  to **8** public, single-level pages. Blocks are paragraphs and HTTP(S) image URLs (two images
  per row), with reorder/remove controls and an escaped live preview. Each page can inject its
  link into the shared top menu or footer. Reserved/nested routes, duplicate slugs, data-URI image
  uploads and more than 100 blocks are rejected; public text is HTML-escaped.
- **Daily credits.** Every account is on a plan (`usertype`): **free** — unlimited video projects,
  unlimited AI scripts, unlimited voiceovers and **10,000 AI images per day**; **paid_user** —
  everything in free plus **10,000 AI images per day** (the same ceiling; the paid plan is about
  studio access, not a bigger image quota). Counters live in KV
  (`credits:<username>`) and renew at midnight Asia/Taipei (UTC+8). The studio shows a credits
  pill with today's allowance, the image route returns `429` with the counters when the allowance
  is spent, and the settings page can promote an account to `paid_user` (or reset its counters).
  The landing page documents both plans and follows the active theme.
- **Freemium access (`/free`).** No account? `GET /free` opens the same studio with a **guest**
  plan: **10,000 Pixabay image imports per day**, unlimited videos, AI scripts and voiceovers (Pixabay
  provider rate limits also apply). Guest counters are
  keyed by a salted hash of the visitor's IP address (`ipcredits:<hash>`, 2-day TTL), so the limit
  is per network and cannot be reset by clearing cookies. With KV bound, anonymous image
  generation is only unlocked by the `yvs_free=1` cookie that `/free` sets; everything else stays
  sign-up-first. Without a KV binding the studio can still open, but accounts are unavailable.
  Stock-media access also fails closed unless `PIXABAY_ALLOW_UNMETERED=true` is explicitly enabled
  for local testing.
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
| Free plan (`usertype: free`) | unlimited videos · 10,000 AI images/day · unlimited AI scripts · unlimited voiceovers |
| Paid plan (`usertype: paid_user`) | unlimited videos · 10,000 AI images/day · unlimited AI scripts · unlimited voiceovers |
| Free-plan alias | `free_user` (or any value other than `paid_user`) is read as `free` |
| Guest plan (`/free`, no account) | unlimited videos · **10,000 AI images/day per IP address** · unlimited AI scripts · unlimited voiceovers |
| Account row | `user:<username>` = `{ username, email, usertype }` (keyed by the unique username) · `email:<address>` mirrors the same email + plan |
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
| Video accordion, **AI Images** | `2 images per submit · landscape 16:9 · 1024×576` (placeholder: *Describe the image (always landscape 16:9, 1024×576)*; also the status line for failures: `Done — landscape 16:9 · 1024×576` or `1 of 2 failed: <error>`) |
| 🎙 **Generate Voiceover** | tooltip: *Speak the script to MP3 with MeloTTS (English) + apply it as subtitles*; modal note repeats that the voice is fixed English and the MP3 must be uploaded manually |
| Video accordion header | **🗑 Delete Video** — tooltip: *Delete this video with its images, MP4s, audio and script* (replaces the removed ☁️ API button; deleting renumbers the stack) |
| Main panel notes | slideshow repeats to cover the track · captions sit 4/7 up from the bottom, 17px Bookman, last one capped at 10 s |
| Onboarding | `Click ＋ Add Video above, then press Generate.` |
| Bulk grid (batch table) / editor heads | `One row — one video` → `N rows · M with a script` (`#batch-note`) · `N of 10 videos` (`#concept-count`) · `idle` / `N in queue` / `table generating` (`#preview-state`) · empty state `No rows yet — press ＋ Add Row, paste a script, pick a style and press ✨ Generate.` (`#batch-empty`) |
| Quick batch table columns | `Script` · `Video style` · `Min` · `Resolution` (`480px` / `540px` / `720px` / `1024px`, with a live `W×H` hint underneath) · `Orientation` (`Square 1:1` / `Landscape 16:9` / `Portrait 9:16`) · `Preview` · `Export` |
| Quick batch table hint + tooltips | *… pick the video image style, the minimum minutes, the AI image resolution and the frame orientation … a row that is empty is skipped, and so is a row that is already finished … Three rows render at the same time.* · Generate tooltip: *Generate every row that has a script and is not finished yet … three rows at a time* · busy label `■ Stop generating` |
| Settings page, Appearance | `Current theme: Night Lab.` · `Preview only — press Save theme to apply it for everyone.` · `Saved — reload the studio page to see the new theme.` |
| Blocking alerts | only for hard failures and cap breaches (e.g. `You can add at most 25 images (jpg, png, jpeg).`); the AI script reports the actual number of attempts and the error in its status line (transient failures may receive up to two retries) so a retry can start immediately |

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

Optional environment variables for API rotation (no new binding is required):

- `RELAY_SECRET` — HMAC secret for relay tokens and browser tickets. **Use the same value on every
  Worker in the pool.** Without it a built-in fallback is used and the settings page warns about it.
- `RELAY_ENABLED=false` — keep one deployment out of the pool (it still serves its own traffic).
- `RELAY_WORKERS=https://a.workers.dev,https://b.workers.dev` — pool members without a KV write.

Optional environment variables for the instruct-model providers (bug fix #271):

- `OPENROUTER_API_KEY` — the OpenRouter key (`npx wrangler secret put OPENROUTER_API_KEY`).
  Preferred over the key saved on the settings page. **No key is compiled into the source** — with
  no key the OpenRouter half of the rotation is skipped, every instruct call stays on Workers AI,
  and the admin card says so.
- `OPENROUTER_MODEL` — override the model slug (default
  `meta-llama/llama-3.3-8b-instruct:free`).
- `OPENROUTER_ENABLED=false` — keep one deployment on Workers AI only.

The settings page is password-gated and uses **`/{current-day}/config/uvxyz`**, where
`{current-day}` is the unpadded day of month (1–31) in **Asia/Taipei**. For example, on
2026-10-16 the URL is **`/16/config/uvxyz`**; it changes at midnight Asia/Taipei. The old bare
`/config/uvxyz` path and any stale day-prefixed path return `404`. The page picks the **theme**
for every visitor (Appearance → *Studio / Aerial / Stellar / Night Lab / Warm Paper / Swiss /
Neo Brutalist* → **Save theme**), manages **plans
& credits** (set an account to `free` or `paid_user`, optionally reset today's counters), reviews
**guest credits by IP** (masked address, today's usage, remaining images, reset), registers
background worker URLs, configures the **API Rotation & Backup Worker Pool** (enable rotation,
strategy, weights, timeout, browser rotation, live per-worker health and a *Test Endpoints* probe),
and can switch a tab into "Background worker" mode to consume the render queue. Its other tabs edit the **Local Payment Gateway** instructions, review paginated **Payment
Transactions** and approve verified transaction numbers, and manage **CMS Pages** with the Add
Page editor/live preview. The landing page uses the same theme tokens as the studio, so the chosen
skin covers the whole site.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /` | Public landing page; studio view when signed in or opened from the CTA |
| `GET /free` | Freemium studio for everyone; sets `yvs_free=1` so guests can spend 10,000 image credits/day per IP, subject to Pixabay rate limits |
| `GET /studio` | Account studio (`free_user` / `paid_user`); guests are redirected to `/free` |
| `GET /paid` | Paid-tier studio (`paid_user` only); guests → `/free`, free accounts → `/studio` |
| `GET /signup` · `GET /login` | Direct links to the corresponding signed-out account form on `/account` |
| `GET /account` | Account dashboard: inline auth when signed out; profile, credits, plan, recent receipts and studio/payment actions when signed in |
| `GET /upgrade` | Public local-gateway instructions; inline auth when signed out, screenshot uploader/history when signed in |
| `GET /{current-day}/config/uvxyz` | Settings / background-worker page; current Asia/Taipei day only (e.g. `/16/config/uvxyz` on 2026-10-16) |
| `GET /{slug}` | Public CMS page after all built-in routes; one flat non-reserved slug, otherwise `404` |
| `GET /image/:i` | Workers AI demo image (unmetered, index into `prompts[]`) |
| `GET /image/gen?prompt=&variant=` | Workers AI image for the studio; costs 1 image credit — session or `yvs_free` guest (10,000 images/day on every plan); `401` for a cold anonymous request when KV is bound, `429` at the limit, `503` + `Retry-After` when the image fleet is shedding load, `X-Credit-*` headers on success |
| `POST /api/script` | SEO plan (title + headings + 1 long-tail + 4 shorts) + AI explainer script → validated **plain-text** script (`{script, format:"plain"}` — no `srt` key is returned) plus keyword counts; accepts a user-selected `keywordSet` from `/api/seo-plan`, which is re-validated and skips the planner. Negotiated `singleAttempt:true,attempt:0–2` performs one writer call; browser owns retries |
| `POST /api/seo-plan` | Two different validated SEO keyword sets (title + headings + 1 long-tail + 4 shorts each) for a topic, for the walkthrough's Select step |
| `POST /api/image-prompts` | Synchronous scene prompts: optional `batch:{offset,count:1–3,attempt:0–2,previous}` performs one model call; `200 {prompts,count,expectedCount,batch?,style,minutes}`. Browser manages the progressive 6/8/10 word-count totals and retries. Without `batch`, legacy all-prompts/top-up behavior remains; `400` invalid input, `502` model failure, `503` no AI binding. The old `GET`/`DELETE /api/image-prompts/:id` job URL answers `410` |
| `GET /api/pipeline-capabilities` | No-store version 261 negotiation; missing/failed support falls back before paid work. No new binding or migration is required. |
| `POST /api/image` | One prompt plus resolution/orientation → binary image, one KV credit reservation; no browser auto-replay, observable-failure refund. Quota checks are best-effort under concurrency (KV is not atomic). |
| `POST /api/image-batch` | One request, every image: `{prompts: string[]}` (≤20) → `application/x-ndjson` with `start`/`tick`/`image`/`done` events. Renders in parallel at 1024×576, 1 image credit per prompt up front (account or `/free` guest allowance) refunded for failures; `401` anonymous, `429` no credits, `400` invalid prompts |
| `POST /api/voiceover` · `GET /tts` | `chunk:true` returns one binary WAV/MP3 chunk (≤400 chars, allowlisted voiceIndex); browser schedules/joins. No flag retains full legacy narration. `/tts` is the fallback proxy. |
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
| `GET`/`POST /api/config/workers` | Registered worker URLs (max 3, `POST` needs the settings password); these URLs form the API rotation pool |
| `GET /api/relay/pool` | Rotation pool for the studio (`local` + verified backups) and, for a signed-in caller, a 3-minute ticket scoped to the AI paths |
| `GET /api/relay/status` · `GET /api/relay/config` · `GET /api/relay/ping` | Pool + health + probe results / current rotation policy / "relay-capable deployment" probe |
| `POST /api/relay/config` · `POST /api/relay/test` | Save the rotation policy / force a fresh probe of every backup — both need the settings password |
| `POST /api/relay/ai` | Worker-to-worker inference hop: one model call, HMAC-token authenticated, never relayed again |
| `POST /api/llm/generate` | Raw instruct-model API (`{prompt,maxTokens?,temperature?,systemPrompt?,provider?}`) → `{text,provider,model,ms}`; signed-in or `/free` guest, `401`/`400`/`413`/`502`; rotates Cloudflare ⟷ OpenRouter unless `provider` is given |
| `GET /api/llm/status` · `GET`/`POST /api/llm/config` | Provider health, model, key source (metadata only) / rotation policy (POST needs the settings password; the key is write-only) |
| `POST /api/llm/test` | Settings password; sends one tiny prompt to OpenRouter and Cloudflare and returns each result with timings |
| `GET`/`POST /api/config/theme` | Current UI theme / set it (`default`, `strata`, `stellar`, `nightlab`, `paper`, `swiss`, `neo`); the GET is open, the POST needs the settings password |
| `GET`/`POST /api/config/users` | Accounts with email, plan label + today's usage (legacy rows are healed with their email + plan on read) / set `usertype` (`free`, `paid_user`), reset counters — both need the settings password |
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
- **`toberesolved.md`** — the code-vs-documentation inconsistency register (code is the source of
  truth): every claim that disagreed with the working tree, what the code really does, and whether
  the Session #211 second pass fixed it.
- **`quick-batch-table-system-requirements.md`** — Session #244 (+ the #211 second-pass columns,
  the three-lane run and the Session #244 silent-retry policy): how the Quick batch table works
  row by row, the hanging bulk-grid code the audit found and removed, and the system requirements
  (bindings, browser APIs, limits, timeouts) it depends on.
- **`new_requirements.md`** — the modular CMS/payment/account notes and KV schema plus the
  SEO overlap, ring uploads, layer/rotation and Graphics-dropdown requirements (§6);
  the README, userflow and system rules describe the verified current behavior.
- **`kv-scale-test.md`** — measured KV behaviour (operations per request, list-page caps,
  free-tier allowance maths) with the reproduction commands.
- **`bug-fix-session-271.md`** — Session #271: the worker-mode (headless API + background-worker
  tab) system and user flows, the hang/defect audit of the #265 rotation (six defects, all fixed),
  the OpenRouter instruct provider and its rotation above the worker pool, the raw
  `POST /api/llm/generate` API, configuration, runbook and verification.
- **`api-relay-rotation.md`** — Session #265: the backup-worker pool, the
  `POST /api/relay/ai` wire protocol, rotation strategies, health/circuit breaking, browser
  rotation and its ticket/CORS rules, configuration, runbook and limits.
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
- **`bug-fix-session-244.md`** — Bug Fix Session #244: silent in-row retries for the Quick batch
  table (the editor's script-section loading animation, no error UI), the fixed table layout and
  the abort/stalled-stream fixes that removed the "signal is aborted" rows, one shared CMS delete
  path (pill + **Delete This Page**), and the Site Admin split into seven tabs with **Guest
  Credits by IP**, **Plans** and **Accounts Credits** as separate pages.
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
# optional: local KV + mock AI integration for #261 binary/chunk routes
CLOUDFLARE_SEND_METRICS=false npm run e2e:accounting -- --ip 0.0.0.0 --port 8787
npm run e2e:accounting:smoke
```

`npm test` (verified on Node 22.22.3) covers the SEO planner/writer contract and a DOM/canvas-transform harness for the
composer, including image counts, failed/stale decodes, object-URL cleanup, layer order,
rotated hit testing, every animated graphic and both MP4 actions. The harness stubs the codecs,
not the application render loop. `e2e/index.ts` provides a deterministic AI fixture with an
overlapping, >6-word long-tail plan for `npm run e2e:dev`; this is **mock AI**, not a live model.
The local usage record (localStorage plus a two-day counts cookie) is display-only and is never
read by the Worker for authorization; clearing it does not change server credits. The accounting
fixture proves the binary/chunk routes work with real local KV, but KV quota checks are not
atomic, so it reports races instead of asserting an exact balance. Actual Chromium/WebCodecs
download and direct gallery insertion were also smoke-tested.

`npm run check` still stops on the **30 pre-existing TypeScript errors in `src/index.ts`**;
the standalone Wrangler dry-run succeeds. This revision does not claim to fix those unrelated
legacy type errors or to verify live Cloudflare model availability.

## Playable mixed-media QA

[Hang audit and sample exports](qa-preview/README.md): actual Chromium exports from Quick Batch
and the editor, plus independent decode/playback checks. Both contain eight photo scenes and
two moving clips. These are **labeled local-provider fixtures, not live Pixabay/LLM/TTS output**;
AAC is unsupported in the test browser, so samples exercise the explicit silent-video fallback.
The live QA preview server on port 8765 shows both playable MP4s and the verification report.
