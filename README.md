# YouTube Vibe Studio

A single-page video studio that runs **entirely in the browser** and is served by one Cloudflare
Worker. Turn images, GIFs, MP4 clips and an MP3 into a finished MP4 with a title, sticker,
timestamp captions, AI-written SRT subtitles and a MeloTTS voiceover.

> The repository started life as Cloudflare's `text-to-image-template`; the only part of the
> original that remains is the Workers AI image route. The README below describes **this**
> application.

## What it does

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
  background worker tab (the same app opened at `/config/uvxyz`) claims the job, renders it in
  *its* browser and delivers the MP4 back — the studio polls and downloads it. If 10 jobs are
  already in flight the app renders the video locally instead.
- **Accounts.** KV-backed sign-up/sign-in, unlimited accounts (each with an `email:<address>`
  uniqueness index).
- **Three UI themes.** `/config/uvxyz` → **Appearance** switches the whole studio between the
  built-in dark look, **Strata** (light panels, teal accents) and **Stellar** (violet gradient,
  frosted panels) — HTML5UP-inspired skins, applied server-side so there is no flash.
- **Template composer.** The "Add video from template" link builds a portrait 9:16 or landscape
  16:9 MP4 (1-25 s) from up to 5 images in 5 designs (Full Focus, Split Story, Triple Stack,
  Photo Burst, Pan & Zoom) and drops it into the accordion's gallery as a normal clip.

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
| Video accordion, media block | `Max 5 GIF · 25 images · 5 MP4 (1:00 each, silent)`; **Add video from template** tooltip says *max 25 seconds* |
| Video accordion, **AI Images** | `2 images per submit · 480px landscape` (also the status line for failures) |
| 🎙 **Generate Voiceover** | tooltip: *Speak the script (SRT) to MP3 with MeloTTS (English) + apply it as subtitles*; modal note repeats that the voice is fixed English and the MP3 must be uploaded manually |
| ☁️ **API** button | tooltip: *Send all of this video's elements to the render API* |
| Main panel notes | slideshow repeats to cover the track · captions sit 4/7 up from the bottom, 17px Bookman, last one capped at 10 s · sticker is a 435 × 150 white rectangle hanging 40 px past the right edge |
| Onboarding | `Click the round Add Video button (top left), then press Generate.` |
| Settings page, Appearance | `Current theme: Strata.` · `Preview only — press Save theme to apply it for everyone.` · `Saved — reload the studio page to see the new theme.` |
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
  app answers `503` on those routes when it is missing, and the sign-in overlay stays open)

The settings page at **`/config/uvxyz`** is password-gated. It picks the **theme** for every
visitor (Appearance → *Studio / Strata / Stellar* → **Save theme**), registers background worker
URLs, and can switch a tab into "Background worker" mode to consume the render queue.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /` | The studio |
| `GET /config/uvxyz` | Settings / background-worker page |
| `GET /image/:i` · `GET /image/gen?prompt=&variant=` | Workers AI images |
| `POST /api/script` | SEO keyword plan + AI script → validated SRT (with keyword counts) |
| `POST /api/voiceover` · `GET /tts` | MeloTTS voiceover / fallback TTS proxy |
| `GET /api/session` · `POST /api/signup` · `POST /api/login` · `POST /api/logout` | Accounts |
| `POST /api/render` · `GET /api/render/:jobId` | Submit a render job / poll and download |
| `GET /api/worker/poll` · `POST /api/worker/deliver` · `POST /api/worker/failed` | Background worker queue |
| `GET`/`POST /api/config/workers` | Registered worker URLs (max 3, `POST` needs the settings password) |
| `GET`/`POST /api/config/theme` | Current UI theme / set it (`default`, `strata`, `stellar`; `POST` needs the settings password) |

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

## Notes for contributors

- `src/index.ts` holds every route; `src/page.ts` assembles the page from
  `src/client/{markup,styles,app-js,template-composer-js}.ts` and is cached per isolate.
- The client files are template literals whose escapes are load-bearing — do not reformat them.
- `src/index.ts.original` is a stale pre-split snapshot of the worker (kept for reference only;
  never imported).
- `npm run check` currently fails at the `tsc` step (the codebase is untyped JS-in-TS); see
  `bug-audit.md` #11.
