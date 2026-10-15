# YouTube Vibe Studio — User Flow Documentation

> Reconstructed from a full code read of this repository (commit `e450ce5`, branch
> `arena/f83a7b6e-text-to-image-template`).
>
> Evidence base: `src/index.ts` (4 679 lines, all routes/APIs/KV logic), `src/page.ts`,
> `src/prompts.ts`, `src/client/markup.ts`, `src/client/styles.ts`,
> `src/client/app-js.ts` (13 596 lines, the whole studio UI + render engine),
> `src/client/template-composer-js.ts` (2 151 lines), `src/client/config-page-js.ts`,
> `wrangler.json`, `package.json`, `e2e/index.ts`. Revision of **2026-10-15**: the SEO script
> is now two AI stages (see §4.2 and `system-rules.md` RULE 7 / RULE 18).
>
> Companion document: **`system-rules.md`** — the high-level system rules with the
> indented technical detail, invariants and restrictions behind every flow below.

---

## 1. What the product is

A single-page **browser-side video studio** served by one Cloudflare Worker.

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Page + all UI code | Worker (`GET /`) | Serves one ~280 KB HTML string (CSS + JS inlined) |
| Video rendering | **The user's browser** (WebCodecs `VideoEncoder`/`AudioEncoder` + `mp4-muxer`) | Draws Ken-Burns slides, overlays, captions, subtitles and muxes an MP4 |
| AI images | Workers AI `@cf/stabilityai/stable-diffusion-xl-base-1.0` | `/image/:i` (demo prompts) and `/image/gen?prompt=` (per-video AI panel) |
| AI script (SRT) | Workers AI `@cf/meta/llama-3.1-8b-instruct-fp8`, **two stages** | `/api/script` — stage 1 plans the SEO keywords, stage 2 writes the SRT around them |
| Voiceover | Workers AI `@cf/myshell-ai/melotts` + free fallback TTS | `/api/voiceover`, proxied `/tts` |
| Accounts | KV namespace `KV_BINDING` | `/api/session`, `/api/login`, `/api/signup`, `/api/logout` (unlimited accounts, `email:<address>` uniqueness index) |
| Render jobs | KV (queued job records + chunked blobs) | `/api/render`, `/api/worker/*` — rendered by **other browser tabs** |

There is no server-side video encoder and no FFmpeg anywhere in the codebase.

### Actors

| Actor | Entry point | Capabilities |
| --- | --- | --- |
| **Studio user** | `GET /` | Must sign in (or KV unbound → open access). Builds up to 10 videos, uploads media, generates images/scripts/voiceovers, renders MP4s locally, can push a video to the render API |
| **Background worker operator** | `GET /config/uvxyz` | Password-gated settings page; runs an extra browser tab that polls `/api/worker/poll` and renders other users' queued jobs |
| **Anonymous caller** | Any route | All data routes (`/api/script`, `/api/voiceover`, `/api/render`, `/tts`, `/image/*`, `GET /api/config/workers`) are unauthenticated *(see restrictions)* |

---

## 2. Surface map (every route the Worker can answer)

| Route | Method | Gate | Result |
| --- | --- | --- | --- |
| `/` | GET | none (client-side auth overlay) | Studio HTML |
| `/config/uvxyz` | GET | client-side password overlay | Studio HTML + `window.__CONFIG_PAGE=true` + injected settings script |
| `/image/:index` | GET | none | PNG (`X-Image-Index`); `400` if index outside `prompts[]`; `500` on AI error |
| `/image/gen?prompt=&variant=` | GET | none | PNG (`X-Image-Variant`); `400` if prompt empty |
| `/api/session` | GET | none | `200 {authenticated:true,user}` / `401` / `503` if KV unbound |
| `/api/signup` | POST | none | `200` + `Set-Cookie: yvs_session` / `400` / `403` (full) / `409` |
| `/api/login` | POST | none | `200` + cookie / `401` |
| `/api/logout` | POST | none | `200`, cookie cleared (`Max-Age=0`) |
| `/api/script` | POST | none | `{success:true,srt}` / `400` / `500` / `503` |
| `/api/voiceover` | POST | none | audio bytes (`attachment`, `audio/mpeg` or `audio/wav`) / `400` / `500` / `503` |
| `/tts?text=&lang=` | GET | none | Proxied audio (`audio/mpeg`), max 2 000 chars |
| `/api/render` | POST | none, **needs KV** | `{jobId}` / `{status:"busy"}` / `413` / `503` |
| `/api/render/:jobId` | GET | none, needs KV | job JSON, or the finished MP4 (`attachment`) / `404` / `500` |
| `/api/worker/poll` | GET | none, needs KV | `{job}` or `{job:null}` (claims the oldest queued job) |
| `/api/worker/deliver?job=` | POST | none, needs KV | stores raw MP4, job → `done` |
| `/api/worker/failed?job=` | POST | none, needs KV | job → `failed` with error text |
| `/api/config/theme` | GET / POST | GET: none · POST: `pw` body field | `{success,theme,themes:[default,strata,stellar]}` / `400 Unknown theme` / `403` / `503` |
| `/api/config/workers` | GET / POST | GET: none · POST: `pw` body field | registered worker URLs (max 3) |
| anything else | — | — | `404 Not Found` (plain text) |

---

## 3. Flow 0 — Page load and access gate

```
User opens /
   │
   ├─ Worker returns cached HTML (mp4-muxer 5.1.3 from unpkg + Oswald font from Google Fonts + inline CSS/JS)
   │
   ├─ Script executes (module order in app-js.ts)
   │    1. prompts[] injected from src/prompts.ts
   │    2. build 2 legacy AI cards into #gallery and immediately call fetchAIImage(0) + fetchAIImage(1)
   │         → 2 automatic GET /image/:i requests on every page load (cards end up hidden, output unused)
   │    3. wire the legacy panels: MP3 upload, title, sticker, captions, quality, gallery upload
   │    4. initVideoStudio() → hides every .audio-panel, .controls and #gallery
   │                          moves #render-btn into #action-bar as "🎬 Generate Videos"
   │    5. initAuth() → GET /api/session
   │
   └─ Branch on /api/session
        ├─ 200 OK ....... signed in → footer badge "👤 name" + Account link + Contact us + "Logout (name)"
        ├─ 401 .......... auth overlay (Sign in / Create account) — blocks the UI until success
        └─ 503 or network error → NO lock; studio is usable anonymously
```

**Sign in / sign up (overlay, Module 6)**

```
overlay → submitAuth()
   client-side validation first:
     username  ^[a-zA-Z0-9_]{3,20}$
     email     ^[^\s@]+@[^\s@]+\.[^\s@]+$   (sign-up only)
     password  length >= 6
     confirm   must equal password          (sign-up only)
   POST /api/signup  {username,email,password}   or   POST /api/login {username,password}
     ├─ 200 → hide overlay, showUserBadge(username,email)
     └─ else → setAuthError(data.error || "Request failed (<status>)")
Logout → POST /api/logout → footer hidden, overlay shown again (UI still locks even if the call fails)
```

---

## 4. Flow 1 — Create and fill a video ("Video N" accordion)

```
[+ Add Video]  (top-left #bulk-toggle)
   │  cap: VIDEO_MAX_VIDEOS = 10 → alert "You can add at most 10 videos."
   ▼
new project = { n, name:"Video N", assets:[], audioFile:null, audio:null, status:"empty", el }
   ▼
accordion = header + body
   header : 🎬 Video N · status pill · [☁️ API] · summary · ▼ collapse
   body   : LEFT 60%                              RIGHT 40%
            ├ Generate SEO Script With AI  ← FIRST block, with the always-visible hint line
            │           "SEO rule: 2 long-tail keywords · 2–5 short keywords ·
            │            every short keyword is said 2–5 times"
            │           topic, minutes 1-6, speech speed, ✨ Generate SEO Script,
            │           keyword chips (long-tail + short, each with its measured ×),
            │           collapsible SRT box (220 px), ⬇ Download .srt,
            │           🎙 Generate Voiceover (disabled until SRT exists)
            ├ Images / MP4s — upload + template link + collapsible gallery
            │           note: "Max 5 GIF · 25 images · 5 MP4 (1:00 each, silent)"
            ├ Audio — one MP3 (video length = MP3 length)
            ├ Title (top left) — text, font, colour
            ├ Captions (bottom) — up to 10 rows, each hh:mm:ss + ≤40 chars
            ├ Sticker (bottom right) — 7 presets
            └ Quality — 480p Light / 720p Balanced / 720p High
            └ AI Images — prompt textarea + "✨ Generate 2 Images" + results panel
                         note: "2 images per submit · 480px landscape"
```

### 4.1 Media intake — three independent entry points

**A. Upload (`📁 Upload Image, GIF or MP4`)**

```
per file, in order, one at a time
  classify: image/gif → GIF · video/mp4|.m4v → MP4 · everything else → still image
  caps per video (counted on the live asset list):
     images <= 25      → else alert + stop the whole batch
     GIFs   <= 5       → else alert + stop the whole batch
     MP4s   <= 5       → else alert + stop the whole batch
  MP4 only: probe with a hidden <video>; duration > 60 s → alert + skip that file
  GIF/image: decoded lazily (GIF frames are only parsed at render time)
  asset = { kind, file, url(object URL), card }  → buildVaCard() → updateVideoStatus()
  drag & drop a card → syncVaOrder() makes DOM order the render order
                     → refreshVaTips() renumbers "#n · name · size · kind"
```

**B. AI images (right panel)**

```
type prompt → [✨ Generate 2 Images]
  results panel already holds 4 cards? → clear it first (object URLs revoked)
  variant = 1 → GET /image/gen?prompt=…&variant=1
  variant = 2 → GET /image/gen?prompt=…&variant=2      (2 sequential calls per submit)
  card = 480 px landscape preview + [+ Add to Video] + [Fullscreen]
     + Add to Video → counts against the 25-image cap, appended to this video's gallery
  status line: "Done — 480px landscape" or "1 of 2 failed: <server error>"
```

**C. Template composer (`Add video from template` link → #tpl-modal)**

```
upload up to 5 images (extra files ignored — slice(0,5))
pick orientation: Portrait 9:16 (1080×1920)  |  Landscape 16:9 (1920×1080)
pick 1 of 5 designs: Full Focus · Split Story · Triple Stack · Photo Burst · Pan & Zoom
set Length (1–25 s, default 10, clamped)
[▶ Preview] loops the design on a canvas · [■ Stop]
[Export] → WebCodecs H.264 avc1.4d002a @ 6 Mbps, 30 fps, mp4-muxer in memory
        → MP4 added to THIS accordion's gallery as a normal MP4 asset
          (counts against the 5-MP4 cap; ≤25 s so always under the 60 s cap)
the modal is built once and reused: images/design/last export survive closing;
the link can retarget the same modal at another Video N
```

### 4.2 Generate SEO Script With AI

The script block is the **first** section of the left column. It starts with the static hint line
(the only place the SEO rule is stated before the first click) and the button tooltip carries the
same rule; the keyword chips only appear *after* a successful run.

```
[hint] "SEO rule: 2 long-tail keywords · 2–5 short keywords · every short keyword is said 2–5 times"
topic   = script-topic input  OR (if empty) the video's title  OR "my video"
minutes = 1..6 (default 1)
speed   = super fast(210 wpm) | fast(170) | medium(140) | slow(110)
  │
  ▼ POST /api/script {topic,minutes,speed}      ← still the only fields the client sends
  │
  ├─ STAGE 1  keyword planner (llama-3.1-8b-instruct-fp8, max_tokens 512, temp 0.6)
  │      asks for one JSON object: {"longTail":[{"keyword":…,"short":[…,…]},{…}]}
  │      accepts exactly 2 long-tail (≤6 words) with 1-3 shorts each (≤3 words),
  │      2-5 unique shorts in total, two different long-tails
  │      invalid → retry up to 3× with " Your previous attempt was rejected: <reason> …"
  │      3 failures → 500 "SEO keywords invalid (<reason>) - try again"
  │                  (status line shows "Script failed: SEO keywords invalid (…) - try again")
  │
  ├─ STAGE 2  SRT writer (same model, max_tokens 2048, temp 0.7), prompt = basePrompt + SEO brief
  │      prompt lists the long-tails ("say each at least once") and the shorts
  │      ("say each between 2 and 5 times") + "work every keyword into natural spoken sentences"
  │      validateSrt: SRT shape, ≤42-char cues, no overlap, 10 s … minutes*60 s + 1.5 s
  │      then keyword counts on the SPOKEN text only (cue numbers/timestamps stripped):
  │        every short 2-5× (both bounds fail) · every long-tail ≥1× (no upper bound)
  │      any violation → retry up to 3× with the exact reason attached
  │      3 failures → 500 "Script output invalid (<reason>) - try again"
  │
  ├─ success → project.srt stored, #va-script-box-N filled with the SRT
  │            keyword chips rendered in #va-script-keywords-N (escapeHTML'd):
  │              Long-tail   [easy home coffee brewing 1×] [budget espresso setup 2×]
  │              Short       [coffee brewing 4×] [home barista 2×] [espresso setup 3×]
  │            SRT box + ⬇ Download .srt become visible; 🎙 Generate Voiceover enabled
  │            status line: "Script ready — N lines (medium speech, 1 min) · SEO: 2 long-tail + 4 short keywords"
  │
  └─ failure → status line "Script failed: <error>"  (no alert)
               the previous SRT, chips and download button stay on screen
```

Hints in this flow (inventory: `system-rules.md` RULE 18): the section hint line, the
**✨ Generate SEO Script** tooltip, the two chip tooltips
(`Long-tail keyword — must be said at least 1×` / `Short keyword — must be said 2–5×`), the
`Topic (uses the video title if empty)` placeholder and the `Script ready … · SEO: …` status line.

### 4.3 Voiceover

```
[🎙 Generate Voiceover]  (accordion, only when project.srt exists)
   ▼ modal (id voiceover-modal)
     Voice select: "English (en)"    ← fixed + disabled in the UI
     textarea: read-only spoken text = SRT with cue numbers/timestamps stripped
     [🎧 Generate Voiceover (MP3)] → POST /api/voiceover {text, lang:"en"}
        server: strip control chars → collapse whitespace → cap 8 000 chars
                (never splitting a surrogate pair) → normalise — – … ' ' " " NBSP
                → split into ≤500-char sentence chunks (over-long sentences hard-split)
                → per chunk: 3 attempts with 400/800 ms backoff
                → if still failing: free fallback TTS (tts-api.netlify.app)
                → detect container per chunk; merge (WAV → rebuilt RIFF header)
        → browser downloads YouTubeVibeStudio_<Title>_voiceover.mp3|.wav
        → user must upload that file as the video's MP3 track manually
     [📝 Apply Subtitles to Video] → parse SRT cues into project.subtitles (toggle on/off)
        status: "Subtitles applied (N cues) — shown below the caption"
```

---

## 5. Flow 2 — "🎬 Generate Videos" (local, in-browser render)

```
[🎬 Generate Videos]
  │
  ├─ generating already true?          → ignore the click
  ├─ no video accordions?              → modal: "Click the red + button to add a video first."
  ├─ any video without assets?         → modal lists "Video N: add at least one image, GIF or MP4."
  │
  ▼ runGenerationQueue()
   banner "⚠️ Bulk generation is in progress…" shown, button disabled
   snapshot the engine's working state (slides, audio, caption rows, title, font, colour, sticker, quality)
   │
   for n = 1 … videoProjects.length        (STRICTLY SEQUENTIAL — one video at a time)
     status = "rendering" → updateVideoStatus()
     prepareVideo(n):  decode MP3 (AudioContext.decodeAudioData)  ·  decode stills  ·
                       decode + composite GIF frames (120 MB frame budget)  ·  reuse probed MP4 elements
     swap that video's caption rows into the hidden engine rows, copy its title/font/colour/sticker/quality
     activeSlides ← this video's slides, currentAudio ← this video's MP3
     renderContext = { fileName:"YouTubeVibeStudio_<VideoN>.mp4", subtitles: project.subtitles || [] }
     result = generateMP4()   → "done" | "skipped" | "error"
     restore the engine's own state; caption rows swapped back
   banner hidden, button re-enabled
   status line: "Bulk complete: <done> saved, <skipped> skipped, <failed> failed."
```

### `generateMP4()` internals (browser)

```
no slides                 → alert, return "skipped"
no window.VideoEncoder    → alert "browser does not support WebCodecs", return "error"

pick output target:
  showSaveFilePicker available AND not window.__workerMode
      → save dialog opens while the click is still a user gesture
      → stream straight to disk (memory flat, no size limit)
      → dialog cancelled (AbortError) → return "skipped"
  otherwise → build the whole MP4 in memory (ArrayBufferTarget)
      → if estimated size > 250 MB → confirm() "may crash the tab" → declined = "skipped"

settings: quality preset → W×H + video bitrate + audio bitrate; FPS = 30
          canvas resized to W×H; title font + caption font + sticker art preloaded
          slides = getSlideSequence()   (repeat from the start until the audio ends;
                                         final slide trimmed to end exactly with the audio)
          KEYFRAME_INTERVAL = 30 × 10 frames (10 s; no visual transitions)

audio first: encodeAudioTrack(buffer, VIDEO_SECONDS, audioBitrate)
             AAC, ≤ 2 channels, 1024-sample blocks, s16 PCM blocks built on the fly
             → owns the first 25 % of the progress bar
             → failure or no AudioEncoder = silent video (alert, continue)

muxer: Mp4Muxer.Muxer
   target: FileSystemWritableFileStreamTarget (8 MB chunks) | ArrayBufferTarget
   video: avc, W×H · audio track only added when AAC chunks exist · fastStart:false

per slide → per frame:
   clear canvas → Ken-Burns effect cycling [slide-left, slide-right, slide-down, zoom-in]
                → draw image/GIF frame/clip frame → title → sticker → captions → subtitles
   GIF: current frame chosen from the decoded loop timeline, blitted from a scratch canvas
   MP4 slide: prepared (pause → seek 0 → play muted) and advanced one frame per video frame
   flushAudioUpTo(frameTimestamp) writes every AAC chunk whose timestamp has arrived
   waitForEncoder(): pause while encodeQueueSize > 12, rethrow any encoder error
   progress bar = 25 % + 75 % × (frames done / total frames)

finalize: videoEncoder.flush() → flushAudioUpTo(∞) → muxer.finalize()
save:     streaming → fileStream.close()   |   in memory → Blob + <a download> click
          (in worker mode the click is suppressed and the Blob is kept on window.__lastRenderBlob)
status:   "✓ MP4 saved to disk with audio!" / "✓ MP4 Downloaded!" etc. → return "done"
cleanup:  encoder closed, aborted file stream released, render button re-enabled
```

### Per-video status lifecycle (client)

```
empty ──▶ rendering ──▶ done
                   ├──▶ skipped   (no slides, or user cancelled the save dialog / the 250 MB warning)
                   └──▶ error     (no WebCodecs, encoder failure, exception)
```

> `STATUS_COLORS` also defines `queued` (blue), but no code path ever assigns it to a
> video project — it is dead in the client (`app-js.ts:6152` region). The **job** statuses
> used by the server are a different set: `queued → running → done | failed`.

---

## 6. Flow 3 — "☁️ API" button (server render job + background worker)

```
[☁️ API] in a Video N header
  │  every asset file + the MP3 are read as base64 (FileReader) and POSTed inline
  ▼ POST /api/render { name, project:{title,font,color,sticker,quality,captions,subtitles},
                       assets:[{name,type,data}], audio:{name,type,data}|null }
  │
  ├─ payload JSON > 60 MB → 413 "Payload too large (max 60MB)" → alert
  ├─ >= 10 jobs already queued/running → 200 {status:"busy", inProgress, max:10}
  │        → the browser renders THIS video itself (renderVideoLocally(n)) and says
  │          "API is busy (10/10 jobs) — rendering <name> in this browser …"
  ├─ success → {jobId} ; server stores the payload as a chunked KV blob (20 MB chunks, 2 h TTL)
  │            and a job record {id,name,status:"queued",createdAt,payloadId} (1 h TTL)
  │
  ▼ poll loop (every 4 s) until done
     GET /api/render/<jobId>
       200 + Content-Type video/*  → download "API_<VideoN>.mp4"        → stop
       200 + JSON                 → still queued/running, keep polling
       404                        → "job expired or not found"          → stop
       500                        → "Render failed: <job.error>"        → stop
```

### Who renders the job? A background worker tab.

```
/config/uvxyz  → password gate → [Instance mode: Background worker] → [▶ Start worker]
   pollOnce() every 3 s (5 s after a network error) while polling is on:
     GET /api/worker/poll
        server first expires any "running" job older than 10 min → failed("worker timed out")
        then claims the oldest queued job: status → "running", claimedAt = now
        returns { job:{id,name,project,assets(base64),audio} }   (or {job:null})
     → window.workerRunJob(job)
          rebuild File objects from base64, probe MP4s, rebuild caption rows,
          set title/font/colour/sticker/quality from job.project,
          run the SAME generateMP4() engine with window.__workerMode = true
          → POST /api/worker/deliver?job=<id> with the raw MP4 body
             server stores file-<jobId> blob (2 h TTL), job → done + fileId + size + finishedAt
          → status "✅ Delivered "<name>" — waiting for jobs..."
     on error → POST /api/worker/failed?job=<id> {error} → job → failed (error ≤300 chars)
          status "❌ Job failed: <msg> — waiting for jobs..."
[■ Stop worker] clears the timer; "Stopped."
```

The studio user's polling loop then sees `200 + video/mp4` and the file downloads as
`API_<name>.mp4`.

---

## 7. Flow 4 — Settings page `/config/uvxyz`

```
GET /config/uvxyz
  ├─ same studio HTML (including the theme chosen under Appearance), with
  │  <script>window.__CONFIG_PAGE = true;</script> prepended
  │  and the CONFIG_PAGE_SCRIPT injected before </body>
  │  (initAuth() returns immediately → no sign-in lock on this page)
  ▼
password overlay ("⚙️ Studio Settings — Enter the settings password")
  wrong  → "Wrong password."
  right  → settings modal
     ├─ Appearance (app mode only)     → Studio / Aerial / Stellar radio cards
     │    GET /api/config/theme preloads the current skin; picking a card previews it
     │    instantly (client-side only, "Preview only — press Save theme …")
     │    [Save theme] → POST /api/config/theme {pw, theme}
     │        server: pw must match, theme must be in the whitelist → stored as config:theme
     │        → "Saved — reload the studio page to see the new theme."
     │        (both HTML routes stamp data-theme on <html> from then on — no flash)
     ├─ Instance mode: [Web app]        → "Background workers" group
     │    3 optional URL inputs (placeholder https://your-worker.workers.dev)
     │    GET /api/config/workers preloads the list → "Registered: …" / "None registered."
     │    [Save workers] → POST /api/config/workers {pw, urls}
     │        server: pw must match, ≤3 URLs after trim/filter, each ≤500 chars and ^https?://
     │        → {success:true,urls} → list re-rendered     |  else alert("Save failed: …")
     └─ Instance mode: [Background worker] → body.cfg-worker-mode, studio sections hidden
           [▶ Start worker] → the polling loop of Flow 3 (keeps running until Stop or tab close)
           status line reflects: waiting / rendering "name" / delivered / failed
```

> The registered worker URLs are **stored only**. Nothing in the codebase ever contacts
> them — each operator opens its own `/config/uvxyz` tab and that tab polls the API itself.

---

## 8. Failure & edge-path matrix (as implemented)

| Situation | Detected by | User-visible behaviour |
| --- | --- | --- |
| KV namespace not bound | worker route guards | Auth: `503` → client leaves the app **open, no lock**. Render API: `503 "Render storage not configured (bind the KV namespace)"` |
| AI binding missing | `/api/script`, `/api/voiceover` | `503 "AI binding not configured"` |
| Image index out of range | `/image/:i` | `400 {success:false,error:"Invalid image index"}` |
| Empty prompt | `/image/gen` | `400 "Missing prompt"` |
| Model error | `/image/:i`, `/image/gen` | `500` with the model's message |
| Keyword plan not valid JSON / wrong shape | stage-1 planner | up to 3 attempts, then `500 "SEO keywords invalid (<reason>) - try again"` — the SRT writer is never called |
| Short keyword said fewer than 2× or more than 5× | server `keywordUsageError()` on the spoken text | counts as invalid → retried with the exact reason; after 3 attempts `500 "Script output invalid (<reason>) - try again"` |
| Long-tail keyword never said | server `keywordUsageError()` | same as above (≥1× required, no upper bound) |
| Script output not parseable SRT | server `validateSrt()` | up to 3 attempts, then `500 "Script output invalid (<reason>) - try again"` |
| Script shorter than 10 s or longer than minutes+1.5 s | server `validateSrt()` | counts as invalid → retried |
| MeloTTS `AiError 3043` | `/api/voiceover` | 3 retries/chunk → free fallback engine → else `500 "TTS failed (chunk i of n): …"` |
| MeloTTS returns WAV instead of MP3 | `/api/voiceover` | container detected by magic bytes, merged as WAV (`audio/wav`) |
| Voiceover text empty | `/api/voiceover` | `400 "No script text to speak"` |
| Theme not in `CONFIG_THEMES` | `POST /api/config/theme` | `400 "Unknown theme"`, nothing written |
| Theme KV write fails | `POST /api/config/theme` | `503 "Theme storage unavailable"` (JSON, shown in the status line) |
| Theme KV missing or erroring | `GET /`, `GET /config/uvxyz` | falls back to the built-in look, page still `200` |
| Voiceover language not in `VOICE_LANGS` | `/api/voiceover` | `400 "Unknown voice language"` (UI only offers `en`) |
| `/tts` text over 2 000 chars | `/tts` | `400 "Text too long (max 2000 chars)"` |
| Upstream TTS HTTP error | `/tts` | `502 "TTS service error (<status>)"` / `502 "TTS proxy failed: …"` |
| Render payload over 60 MB | `/api/render` | `413 "Payload too large (max 60MB)"` |
| 10 jobs in flight | `/api/render` | `200 {status:"busy"}` → client renders locally instead |
| Job record expired/unknown | `/api/render/:id`, deliver, failed | `404` |
| Worker died mid-render | `/api/worker/poll` | jobs stuck `running` > 10 min → `failed "worker timed out"` |
| Delivered MP4 empty | `/api/worker/deliver` | `400 "Empty file"` |
| Output blob missing when polling | `/api/render/:id` | `500 "Output file missing"` |
| Browser lacks WebCodecs | `generateMP4()` | alert "Please use modern Chrome, Edge, or Safari." → status `error` |
| Browser lacks AudioEncoder | `generateMP4()` | alert "Rendering a silent video." → continues without audio |
| Save dialog cancelled | `showSaveFilePicker` AbortError | status `skipped`, no download |
| In-memory file > 250 MB | `generateMP4()` | `confirm()` warning → declined = `skipped` |
| Large GIF | `buildGifSlideFrames()` | frames downscaled (scale ≥ 0.15) to stay under a 120 MB buffer budget |
| MP4 clip > 60 s | `onVideoFiles()` probe | alert + that file is skipped |
| Upload over a per-kind cap | `onVideoFiles()` | alert + the rest of the batch stops |
| Session cookie invalid | `/api/session` | `401` → overlay |
| Email already registered | `/api/signup` | `409 "Email already in use"` (1 keyed read of the `email:` index; accounts predating the index are covered by a bounded scan while the namespace holds <= 200 accounts) |
| Duplicate username / email | `/api/signup` | `409 "Username already taken"` / `409 "Email already in use"` |
| Wrong sign-in credentials | `/api/login` | `401 "Invalid username or password"` (never reveals which field) |

---

## 9. Code map (where each flow lives)

| Flow | Primary code |
| --- | --- |
| Page assembly / caching | `src/page.ts`, `src/client/markup.ts`, `src/client/styles.ts` |
| Routes, KV, jobs, auth | `src/index.ts` (`/` ~L34, `/image/:i` ~L56, `/image/gen` ~L144, KV guard + render/worker gate ~L482, `/config/uvxyz` ~L509, `/api/script` ~L566 — SEO constants/helpers ~L1075-1600, keyword stage ~L1650, SRT stage ~L1776-1990, `/api/voiceover` ~L2036, `/tts` ~L3205, `/api/render` ~L3324 and `/api/render/:id` ~L3480, `/api/worker/*` ~L3600-3900, `/api/config/workers` ~L4168, auth API ~L4161-4679) |
| Accordions, gallery, queue | `src/client/app-js.ts` MODULE 1-4 (`initVideoStudio` L6176, `addVideoAccordion` L6250, `onVideoFiles` L6687, `runGenerationQueue` L7902) |
| AI images panel | MODULE 5 (`submitAiImages` L8298, `addAiResultCard` L8495, `addAiToVideo` L8666) |
| Auth UI | MODULE 6 (`buildAuthOverlay` L8850, `submitAuth` L9298, `initAuth` L10789) |
| Render API + worker | MODULE 7 (`collectVideoPayload` L9655, `apiRenderVideo` L9766, `renderVideoLocally` L10060, `workerRunJob` L10364) |
| Script / subtitles / voiceover | MODULE 8-9 (`renderSeoKeywords` L10982, `generateScript` L11066, `openVoiceoverModal` L11513, `generateVoiceover` L11587, `toggleSubtitles` L11769) — the accordion markup itself is `videoAccordionHTML()` L6424, with the SEO section first in `.va-left` |
| Render engine | `generateMP4` L11773 → encode/mux/finalize L12302-13340; audio `encodeAudioTrack` L3177; GIF decoder L5200-6160 |
| Template composer | `src/client/template-composer-js.ts` (`exportMP4` L1307, `addTemplateToVideo` L1660, modal L1836-2151) |
| Themes | `src/client/styles.ts` (token blocks + shared reskin, appended at the end of `APP_CSS`), `src/index.ts` (`CONFIG_THEMES`, `normalizeTheme`/`readTheme`/`applyTheme` at the top of the module) |
| Settings page | `src/client/config-page-js.ts` (single escaped string) |

---

## 10. End-to-end happy path (one paragraph)

Sign in → `+ Add Video` → drop 3 images, an MP3 and a title → in the first block,
**Generate SEO Script With AI** (2 min, fast): the AI plans 2 long-tail + 2-5 short keywords and
writes the SRT around them, and the chips under the button show each keyword with its measured
count → apply subtitles → optionally generate a voiceover and upload it as the audio track →
press **🎬 Generate Videos** → the browser decodes everything, encodes audio then video,
draws Ken-Burns slides with title/sticker/captions/subtitles, muxes an MP4 and saves it to disk →
the status pill turns green *done* and the summary reads "Bulk complete: 1 saved, 0 skipped, 0 failed."

Or, for server-mediated rendering: press **☁️ API** on that video, leave the tab polling, and let a
`/config/uvxyz` worker tab (Flow 3) pick the job up, render it in *its* browser and deliver the MP4
back — the original tab downloads `API_Video1.mp4`.

## UI update — Aerial / Stellar / template modal (2026-10-15)

Appearance now labels the former Strata option **Aerial** (the persisted/API value is still
`strata` for backwards compatibility). Its bundled mountain background, blue sky, diagonal
overlay and white typography adapt the HTML5 UP Aerial design to the scrolling studio.
Stellar's main studio and accordion backgrounds are 10% less opaque relative to their original
alpha; accordion backdrop blur is 20% stronger.

In **Add video from template**, choose one of the same five designs from the **Template**
dropdown instead of preview cards. The single canvas preview stays exactly 80px high in both
formats. Labels sit below editor values, with live blur/opacity readouts. The sticky bottom
Add/Close buttons are horizontally and vertically centered. Reopening/retargeting the modal,
image upload, preview playback, MP4 export and gallery insertion retain the existing flow.
