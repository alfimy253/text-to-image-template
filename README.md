# YouTube Vibe Studio

A creator landing page and video studio served by one Cloudflare Worker. The studio runs
**entirely in the browser**: turn images, GIFs, MP4 clips and an MP3 into a finished MP4 with a
title, sticker, timestamp captions, AI-written SRT subtitles and a MeloTTS voiceover.

> The repository started life as Cloudflare's `text-to-image-template`; the only part of the
> original that remains is the Workers AI image route. The README below describes **this**
> application.

## What it does

- **Public landing page.** A responsive introduction explains the studio; the top **Sign up** link
  and bottom **Log in** menu open the existing KV-backed account flow. A signed-out visitor can
  explore the landing page before entering the studio.
- **Videos stack, not one timeline.** Press **+ Add Video** to create up to **10** independent
  "Video N" accordions, each with its own images/GIFs/MP4s, MP3, title, sticker, captions,
  quality, script and AI image panel. **🎬 Generate Videos** renders them one after another.
- **Rendering is local and free.** WebCodecs `VideoEncoder` (H.264) + `AudioEncoder` (AAC) +
  `mp4-muxer` — no FFmpeg, no server rendering. Chrome/Edge stream the file straight to disk via
  the File System Access API; other browsers build it in memory.
- **AI on demand.** Stable Diffusion XL images per video panel (`/image/gen`), an **SEO script**
  (`/api/script`: the AI first plans 2 long-tail keywords plus 2-5 short ones, then writes an SRT
  script that *says* those keywords the required number of times — every rule enforced
  server-side), and a MeloTTS voiceover (`/api/voiceover`) with a free fallback TTS engine.
- **Optional server-side rendering.** **☁️ API** uploads a video's whole payload to KV and a
  background worker tab (the same app opened at its current-day settings URL, e.g.
  `/16/config/uvxyz` on 2026-10-16 in Asia/Taipei) claims the job, renders it in *its* browser
  and delivers the MP4 back — the studio polls and downloads it. If 10 jobs are already in
  flight the app renders the video locally instead.
- **Accounts.** KV-backed sign-up/sign-in, unlimited accounts (each with an `email:<address>`
  uniqueness index).
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
- **Three UI themes.** The current-day settings page → **Appearance** switches the whole studio
  between the built-in dark look, **Aerial** (blue sky, mountain backdrop, white accents), and
  **Stellar** (violet gradient, frosted panels) — HTML5UP-inspired skins, applied server-side so
  there is no flash.
  Aerial retains the legacy `strata` API/storage value, so saved selections still work.
  See `THIRD_PARTY_NOTICES.md` for the Aerial background attribution.
- **Template composer.** The "Add video from template" link opens a modal with a **4-column
  gallery of live animated previews** of 8 motion-typography templates (Halo Warp, Terminal
  Fracture, Ribbon Editorial, Portal Type, Comic Burst, Dream Echo, Perspective Fold, Liquid
  Bloom — ported from the uploaded Typography Motion Studio III HTML). Picking one opens an
  editor with a live canvas preview and studio-styled controls: **dynamic text layers** (each
  with its own text, colour, position, animation and size — the + button adds more), animation
  speed (0.5×–2×), photo entry transitions and motion, up to 2 photos, and 21 animated
  backgrounds. **⬇ Export MP4** renders the same canvas engine to a real H.264 MP4
  (WebCodecs + mp4-muxer, no screen capture) and downloads it; **➕ Add to Video N** drops it
  into the accordion's gallery as a normal clip. Portrait 9:16 or landscape 16:9, 1–25 s.

## Limits worth knowing

| Thing | Limit |
| --- | --- |
| Videos per session | 10 |
| Assets per video | 25 images · 5 GIFs · 5 MP4s (60 s each) |
| Slide timing | 9 s per image/GIF; MP4 clips play in full; the list repeats to cover the MP3 |
| Captions | 10 rows, 40 characters each; last caption capped at 10 s on screen |
| Script | 1-6 minutes, `super fast` / `fast` / `medium` / `slow`, valid SRT required |
| SEO keywords | exactly 2 long-tail (≥1× in the script) + 2-5 short keywords (each said 2-5×); 1-3 shorts under each long tail |
| Voiceover | 8,000 characters max, chunked at 500; English in the UI |
| Render API | 10 in-flight jobs, 60 MB payload, outputs kept 2 h (job records 1 h) |
| Theme | one setting for the whole deployment: `default` · `strata` · `stellar` |
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
| Video accordion, **Generate SEO Script With AI** (first block of the left column) | `SEO rule: 2 long-tail keywords · 2–5 short keywords · every short keyword is said 2–5 times` |
| ✨ **Generate SEO Script** button | tooltip: *AI plans 2 long-tail keywords and 2-5 short keywords (each short said 2-5 times) and writes the SRT script around them* |
| Keyword chips (after a successful run) | `long-tail keyword — must be said at least 1×` · `short keyword — must be said 2–5×`, each chip showing the measured count, e.g. `coffee brewing 4×` |
| Video accordion, media block | `Max 5 GIF · 25 images · 5 MP4 (1:00 each, silent)`; **Add video from template** tooltip says *max 25 seconds*; the template modal's tip line says each template is a looping motion design and the clip is silent |
| Video accordion, **AI Images** | `2 images per submit · 480px landscape` (also the status line for failures) |
| 🎙 **Generate Voiceover** | tooltip: *Speak the script (SRT) to MP3 with MeloTTS (English) + apply it as subtitles*; modal note repeats that the voice is fixed English and the MP3 must be uploaded manually |
| ☁️ **API** button | tooltip: *Send all of this video's elements to the render API* |
| Main panel notes | slideshow repeats to cover the track · captions sit 4/7 up from the bottom, 17px Bookman, last one capped at 10 s · sticker is a 435 × 150 white rectangle hanging 40 px past the right edge |
| Onboarding | `Click the round Add Video button (top left), then press Generate.` |
| Settings page, Appearance | `Current theme: Aerial.` · `Preview only — press Save theme to apply it for everyone.` · `Saved — reload the studio page to see the new theme.` |
| Blocking alerts | only for hard failures and cap breaches (e.g. `You can add at most 25 images (jpg, png, jpeg).`); the AI script instead reports `Script failed: <error>` in its status line so a retry can start immediately |

Status lines (`#va-status-N`, `#va-script-status-N`, `#va-ai-status-N`) are the normal progress
channel; the script line ends with `Script ready — N lines (<speed> speech, <minutes> min) · SEO:
2 long-tail + N short keywords`.


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
- `kv_namespaces` → `KV_BINDING` (required by accounts, the render API and the worker queue; the
  landing page remains available if it is missing, and the studio can still be opened through its
  primary CTA. Account and render routes answer `503` without KV.)

The settings page is password-gated and uses **`/{current-day}/config/uvxyz`**, where
`{current-day}` is the unpadded day of month (1–31) in **Asia/Taipei**. For example, on
2026-10-16 the URL is **`/16/config/uvxyz`**; it changes at midnight Asia/Taipei. The old bare
`/config/uvxyz` path and any stale day-prefixed path return `404`. The page picks the **theme**
for every visitor (Appearance → *Studio / Aerial / Stellar* → **Save theme**), manages **plans
& credits** (set an account to `free` or `paid_user`, optionally reset today's counters), reviews
**guest credits by IP** (masked address, today's usage, remaining images, reset), registers
background worker URLs, and can switch a tab into "Background worker" mode to consume the render
queue. The landing page uses the same theme tokens as the studio, so the chosen skin covers the
whole site.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /` | Public landing page; studio view when signed in or opened from the CTA |
| `GET /free` | Freemium studio for everyone; sets `yvs_free=1` so guests can spend 10 image credits/day per IP |
| `GET /studio` | Account studio (`free_user` / `paid_user`); guests are redirected to `/free` |
| `GET /paid` | Paid-tier studio (`paid_user` only); guests → `/free`, free accounts → `/studio` |
| `GET /{current-day}/config/uvxyz` | Settings / background-worker page; current Asia/Taipei day only (e.g. `/16/config/uvxyz` on 2026-10-16) |
| `GET /image/:i` | Workers AI demo image (unmetered, index into `prompts[]`) |
| `GET /image/gen?prompt=&variant=` | Workers AI image for the studio; costs 1 image credit — session (50/1,200 per day) or `yvs_free` guest (10/day per IP); `401` for a cold anonymous request when KV is bound, `429` at the limit, `X-Credit-*` headers on success |
| `POST /api/script` | SEO keyword plan + AI script → validated SRT (with keyword counts) |
| `POST /api/voiceover` · `GET /tts` | MeloTTS voiceover / fallback TTS proxy |
| `GET /api/session` · `POST /api/signup` · `POST /api/login` · `POST /api/logout` | Accounts (session/signup/login include `usertype`, `plan` and `credits`) |
| `GET /api/credits` | Today's plan, used counters, remaining allowances and `resetsAt` — for the signed-in user, or the IP-keyed guest plan after `/free` |
| `POST /api/render` · `GET /api/render/:jobId` | Submit a render job / poll and download |
| `GET /api/worker/poll` · `POST /api/worker/deliver` · `POST /api/worker/failed` | Background worker queue |
| `GET`/`POST /api/config/workers` | Registered worker URLs (max 3, `POST` needs the settings password) |
| `GET`/`POST /api/config/theme` | Current UI theme / set it (`default`, `strata`, `stellar`; `POST` needs the settings password) |
| `GET`/`POST /api/config/users` | Accounts with plan + today's usage / set `usertype` (`free`, `paid_user`) and reset counters — both need the settings password |
| `GET`/`POST /api/config/ipcredits` | Guest credits table (masked IP, usage, remaining) / delete one IP row (reset) — both need the settings password |

## Documentation

- **`userflow.md`** — every actor-level flow (page load, auth, per-video setup, local render,
  render API + worker, settings page) plus a failure/edge-path matrix and a code map.
- **`system-rules.md`** — the high-level system rules with the nested technical detail,
  invariants and restrictions behind each of them (RULE 7 = the SEO script, RULE 18 = the
  inventory of every user-visible hint: tooltips, notes, placeholders and alerts, RULE 19 =
  the three themes and where the choice is stored).
- **`kv-scale-test.md`** — measured KV behaviour (operations per request, list-page caps,
  free-tier allowance maths) with the reproduction commands.
- **`bug-audit.md`** — the current bug and inconsistency audit, with severity and fixes.
- **`bug-fix-session-206.md`** — Bug Fix Session #206: plan-based URLs (`/free`, `/studio`,
  `/paid`), freemium guest access, the per-IP credits table and its verification evidence.

## Notes for contributors

- `src/index.ts` holds every route; `src/page.ts` assembles the page from
  `src/client/{markup,styles,app-js,template-composer-js}.ts` and is cached per isolate.
- The client files are template literals whose escapes are load-bearing — do not reformat them.
- `src/index.ts.original` is a stale pre-split snapshot of the worker (kept for reference only;
  never imported).
- `npm run check` currently fails at the `tsc` step (the codebase is untyped JS-in-TS); see
  `bug-audit.md` #11.
