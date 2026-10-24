# YouTube Vibe Studio — User Flow Documentation

> Reconstructed from a full code read of the working tree on **2026-10-16**; §11 and the theme
> sections were revised on **2026-10-23** for Bug Fix Session #240. CMS, payments, the account
> dashboard and the two-gallery/3D-ring composer were verified and revised on **2026-10-24**.
>
> Evidence base: `src/index.ts` (7,215 lines, all routes/APIs/KV logic), `src/page.ts`,
> `src/prompts.ts`, `src/client/markup.ts` (897 lines), `src/client/styles.ts` (8,057 lines),
> `src/client/app-js.ts` (15,308 lines, the whole studio UI + render engine),
> `src/client/template-composer-js.ts`, `src/client/template-scene-editor.ts`,
> `src/client/template-ring-carousel.ts`, `src/client/template-shape-animations.ts`,
> `src/client/config-page-js.ts`, `src/client/payment-upload-js.ts`,
> `src/modules/{cms,payments,user-pages}.ts`, `wrangler.json`, `package.json`, `e2e/index.ts`. The SEO script has two AI stages and follows the
> **2026-10-23 explainer SEO rule set** (see §4.2 and `system-rules.md` RULE 7 / RULE 18) —
> every documentation of the AI script written before 2026-10-23 was deleted and replaced.
> This revision documents the day-rotating settings
> route, its Asia/Taipei date boundary, the two studio views (§11) and the seven skins.
>
> **Current revision (2026-10-23):** §4.1C and §4.2 reflect short/long-tail overlap without a
> long-tail length rule, one template gallery, animated Graphics elements, real layer/rotation
> controls and required 5–7-image ring uploads. Earlier UI-update notes are historical where
> explicitly marked. Requirements and acceptance criteria: `new_requirements.md` §6.
>
> Companion document: **`system-rules.md`** — the high-level system rules with the
> indented technical detail, invariants and restrictions behind every flow below.

---

## 1. What the product is

A single-page **browser-side video studio** served by one Cloudflare Worker.

| Piece | Where it runs | What it does |
| --- | --- | --- |
| Page + all UI code | Worker (`GET /`) | Serves one ~700 KB HTML string (landing, studio, CSS + JS inlined) |
| Video rendering | **The user's browser** (WebCodecs `VideoEncoder`/`AudioEncoder` + `mp4-muxer`) | Draws Ken-Burns slides, overlays, captions, subtitles and muxes an MP4 |
| AI images | Workers AI `@cf/stabilityai/stable-diffusion-xl-base-1.0` | `/image/:i` (demo prompts) and `/image/gen?prompt=` (per-video AI panel) |
| AI script (SRT) | Workers AI `@cf/meta/llama-3.1-8b-instruct-fp8`, **two stages** | `/api/script` — stage 1 plans the SEO keywords plus the explainer title and headings, stage 2 writes the SRT around them |
| Voiceover | Workers AI `@cf/myshell-ai/melotts` + free fallback TTS | `/api/voiceover`, proxied `/tts` |
| Accounts | KV namespace `KV_BINDING` | `/api/session`, `/api/login`, `/api/signup`, `/api/logout` (unlimited accounts, `email:<address>` uniqueness index) |
| CMS pages | KV `config:cms_pages` + shared theme shell | Up to 8 public flat pages; settings-only writes, public reads and top/footer links |
| Payments | KV receipt bytes/metadata/transaction index | Manual local-gateway instructions, signed-in uploads, admin approval → `paid_user`; no automated charge |
| Render jobs | KV (queued job records + chunked blobs) | `/api/render`, `/api/worker/*` — rendered by **other browser tabs** |

There is no server-side video encoder and no FFmpeg anywhere in the codebase.

### Actors

| Actor | Entry point | Capabilities |
| --- | --- | --- |
| **Studio user** | `GET /` | Sees the public landing page; signs in to enter the studio (or, if KV is unbound, enters through the primary CTA). Builds up to 10 videos, uploads media, generates images/scripts/voiceovers, renders MP4s locally, can push a video to the render API |
| **Background worker operator** | `GET /{current-day}/config/uvxyz` | Password-gated settings page; the current day-of-month in Asia/Taipei must match; runs an extra browser tab that polls `/api/worker/poll` and renders other users' queued jobs |
| **Settings administrator** | Same current-day settings URL | Edits gateway instructions, reviews/approves receipts, manages plans and creates/edits/deletes public CMS pages |
| **Anonymous caller** | Any route | `/api/script`, `/api/voiceover`, `/api/render`, `/tts`, `/image/:i` and `GET /api/config/workers` are unauthenticated. `/image/gen` is the exception: it needs a session or the `/free` guest cookie, and `/studio` + `/paid` need a session (RULE 21) |

---

## 2. Surface map (every route the Worker can answer)

| Route | Method | Gate | Result |
| --- | --- | --- | --- |
| `/` | GET | none (public landing; client-side studio entry gate) | Landing page + studio HTML |
| `/free` | GET | none — **freemium entry**; sets `yvs_free=1` (1 day) | Studio HTML + `window.__PLAN_MODE="freemium"`; 10 AI images/day per IP, everything else unlimited |
| `/studio` | GET | session (`free_user` / `paid_user`) | Studio HTML + `window.__PLAN_MODE="studio"`; anonymous → `302 /free` |
| `/paid` | GET | session, `usertype: paid_user` | Studio HTML + `window.__PLAN_MODE="paid"`; anonymous → `302 /free`, free → `302 /studio` |
| `/account` | GET | none for page; session for dashboard data | Signed-out inline auth; signed-in profile, live credits, plan, six recent receipts and plan-aware studio/payment actions |
| `/upgrade` | GET | none for instructions; session for uploader | Public local-gateway details; signed-out inline auth or signed-in screenshot uploader/history |
| `/{current-day}/config/uvxyz` | GET | full-page inline unlock + server `/api/config/verify`; day must match Asia/Taipei today | Studio HTML + `window.__CONFIG_PAGE=true` + injected settings script; stale-day and bare legacy paths are `404` |
| `/{slug}` | GET | none; matched only after built-in routes | Saved public CMS page with top/footer navigation; unknown/nested/reserved slug → `404` |
| `/image/:index` | GET | none | PNG (`X-Image-Index`); `400` if index outside `prompts[]`; `500` on AI error. **Unmetered demo sample** |
| `/image/gen?prompt=&variant=` | GET | session **or** `yvs_free` guest cookie when KV is bound; **1 image credit** | PNG (`X-Image-Variant`, `X-Credit-*`, `X-Credit-Scope: account\|ip`); `400` if prompt empty; `401` only when both a session and the cookie are absent (message points at `/free`); `429 {error,credits}` daily limit spent; `500` on AI error (credit refunded) |
| `/api/session` | GET | none | `200 {authenticated:true,user,plan,credits}` / `401` / `503` if KV unbound |
| `/api/credits` | GET | session, or `yvs_free` guest cookie | `200 {usertype,plan,day,resetsAt,used,remaining,user}` / guest `200 {usertype:"guest",authenticated:false,guest:true,scope:"ip",ip,...}` / `401` / `503` |
| `/api/signup` | POST | none | `200` + `Set-Cookie: yvs_session` + `user{...,usertype:"free"}`, `plan`, `credits` / `400` / `409` (duplicate) / `503` (KV unbound); no account cap |
| `/api/login` | POST | none | `200` + cookie + `plan` + `credits` / `401` |
| `/api/logout` | POST | none | `200`, cookie cleared (`Max-Age=0`) |
| `/api/payments/upload` | POST | session + KV | Multipart/JSON image ≤5 MiB; verifies PNG/JPEG/WEBP/GIF bytes → `pending` receipt / `400` / `401` / `413` / `503` |
| `/api/payments/my` | GET | session | Own receipt history / `401`; empty list without KV |
| `/api/payments/image/:id` | GET | session, receipt owner | Private receipt bytes / `401` / `403` / `404` / `503` |
| `/api/config/verify` | POST | `pw` body | `{success:true,valid:true,theme}` / `403 {valid:false,error:"Wrong password"}` |
| `/api/config/payment-gateway` | GET / POST | GET public · POST `pw` | Read or update local-gateway name/details/instructions |
| `/api/config/payments` | GET | `pw` query + KV | Paginated review, default 5/max 24 per page, `all`/`pending`/`approved` filters |
| `/api/config/payments/image/:id` | GET | `pw` query | Admin receipt bytes |
| `/api/config/payments/approve` | POST | `pw` body + KV | Requires verified transaction number; unique transaction → receipt approved + user `paid_user` / `400` / `404` / `409` |
| `/api/cms/pages` | GET | none | Public saved pages and `maxPages:8`; empty without KV |
| `/api/config/cms` | GET / POST / DELETE | `pw` + KV | List / create or update (optional `id`) / delete; max 8, duplicate slug `409` |
| `/api/config/cms/delete` | POST | `pw` body + KV | Delete by page `id` or `slug`; releases a page slot |
| `/api/script` | POST | none | `{success:true,srt}` / `400` / `500` / `503` |
| `/api/voiceover` | POST | none | audio bytes (`attachment`, `audio/mpeg` or `audio/wav`) / `400` / `500` / `503` |
| `/tts?text=&lang=` | GET | none | Proxied audio (`audio/mpeg`), max 2 000 chars |
| `/api/render` | POST | none, **needs KV** | `{jobId}` / `{status:"busy"}` / `413` / `503` |
| `/api/render/:jobId` | GET | none, needs KV | job JSON, or the finished MP4 (`attachment`) / `404` / `500` |
| `/api/worker/poll` | GET | none, needs KV | `{job}` or `{job:null}` (claims the first `queued` record in the order `listRenderJobs()` returned them — parallel reads push as they resolve, so there is no FIFO guarantee) |
| `/api/worker/deliver?job=` | POST | none, needs KV | stores raw MP4, job → `done` |
| `/api/worker/failed?job=` | POST | none, needs KV | job → `failed` with error text |
| `/api/config/theme` | GET / POST | GET: none · POST: `pw` body field | `{success,theme,themes:[default,strata,stellar]}` / `400 Unknown theme` / `403` / `503` |
| `/api/config/workers` | GET / POST | GET: none · POST: `pw` body field | registered worker URLs (max 3); `GET` returns `{urls:[]}` without KV, `POST` is `503` |
| `/api/config/users?pw=` | GET | `pw` query param | up to 50 accounts with `usertype`, `plan`, used and remaining credits / `403` / `503` |
| `/api/config/users` | POST | `pw` body field | sets `usertype` (`free` / `paid_user`), optional `resetCredits` / `400` / `403` / `404` / `503` |
| `/api/config/ipcredits?pw=` | GET | `pw` query param | up to 50 guest rows: masked IP, hash, used, remaining, `updatedAt` / `403` / `503` |
| `/api/config/ipcredits` | POST | `pw` body field | `{key}` deletes one guest row (reset) / `400` / `403` / `503` |
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
   │    5. bindStudioShell() → paints the Bulk grid, wires #view-switch and [data-open]
   │                          (the Editor is the boot view; the choice is memory-only)
   │    6. bindLandingActions(); initAuth() → GET /api/session
   │
   └─ Branch on /api/session
        ├─ 200 OK ....... signed in → hide landing, show studio + footer badge "👤 name" + Account / Contact / Logout
        ├─ 401 .......... keep public landing visible; keep studio hidden until authentication succeeds
        └─ 503 or network error → keep landing visible; primary CTA opens the studio (open-access fallback)

Landing actions:
   top "Sign up" link → auth overlay in create-account mode
   nav "Plans" → #landing-plans section (Free: 50 AI images/day · Paid: 1,200/day;
                 unlimited videos, AI scripts and voiceovers on both; renews midnight UTC+8)
   nav "Free studio" / plans "Open the free studio" / footer "Try the free studio"
                 → GET /free (no account; 10 AI images/day per IP)
   bottom "Log in" menu → auth overlay in sign-in mode
   primary "Start creating" action → signup overlay when authentication is required,
                                     otherwise show the studio
   (the landing surface uses the active theme's tokens, so the skin chosen on the
    settings page — default, Aerial, Stellar, Night Lab, Warm Paper, Swiss or Neo
    Brutalist — covers the landing and the studio alike)
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
     ├─ 200 → hide overlay, open studio, showUserBadge(username,email)
     └─ else → setAuthError(data.error || "Request failed (<status>)")
Logout → POST /api/logout → on `/` the landing page returns and login stays available in the footer;
         on `/free` the page drops back to guest mode and re-reads the IP counters
```

---

## 3b. Flow 0.5 — Daily credits (plan, meter, renewal)

```
After signup / login / session restore:
   response carries { user.usertype, plan, credits }
   applyCredits() paints the fixed top-right pill:
        FREE  ·  48 / 50 left today   ▾
   clicking it opens the popover:
        Video projects  Unlimited
        AI images       48 / 50 left today
        AI scripts      Unlimited
        Voiceovers      Unlimited
        Used today: n images · n scripts · n voiceovers
        Renews in 7h 12m (midnight UTC+8)
   (the account box under the footer shows the same plan + image line)

Image generation (AI panel, 2 variants per submit):
   GET /image/gen?prompt=&variant=1
     ├─ 200  → PNG + X-Credit-Images-Remaining; credit consumed in KV
     ├─ 401  → the worker's error ("Sign in to generate AI images — … Open /free …")
     │          appears as "1 of 2 failed: …" in the AI status line (loop stops)
     ├─ 429  → same status-line form for "Daily image credits used up (50 images/day on the
     │          Free plan). Credits renew at midnight (UTC+8)." (loop stops, pill drops to 0)
     └─ 500  → model error; the consumed credit is refunded

Plans (user record user:<name>.usertype):
   free       unlimited videos · 50 AI images/day · unlimited AI scripts · unlimited voiceovers
   paid_user  unlimited videos · 1,200 AI images/day · unlimited AI scripts · unlimited voiceovers

KV records:
   credits:<name> = { day:"YYYY-MM-DD", images, scripts, voiceovers, videos, updatedAt }  (TTL 2 days)
   a record whose day ≠ today reads as zero and is rewritten by the next generation

Settings page → Plans & credits:
   lists accounts (≤50) with plan + remaining images
   set free / paid_user, optional "reset today counters" → POST /api/config/users
```

---

## 3c. Flow 0.5b — Freemium guest (/free), Bug Fix Session #206

```
Visitor opens /free (or a landing/footer link to it)
   │
   ├─ Worker: 200 HTML + window.__PLAN_MODE="freemium"
   │          + Set-Cookie: yvs_free=1; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400
   │
   ├─ Script: initAuth() → GET /api/session
   │     ├─ 200 (signed in) → normal account studio (the /free URL is upgrade-safe)
   │     └─ 401 → authAccess="freemium": hide landing, show studio, GET /api/credits
   │                → {usertype:"guest", plan:{id:"guest",…}, remaining.images:10,
   │                   scope:"ip", ip:"203.0.113.0"}
   │                → pill "Guest · 10 / 10 left today"
   │
   ├─ AI images: GET /image/gen  (cookie present, no session)
   │     → worker hashes CF-Connecting-IP, spends ipcredits:<hash> with the guest plan
   │       200 → PNG + X-Credit-Plan: guest, X-Credit-Images-Limit: 10,
   │              X-Credit-Images-Remaining, X-Credit-Scope: ip
   │       429 → same "1 of 2 failed: …" status line with "Daily image credits used up
   │              (10 images/day on the Guest plan)... Create a free account for 50 images per day."
   │       500 → credit refunded
   │
   ├─ AI scripts / voiceovers / videos: unlimited for guests; usage is booked to the IP row
   │
   └─ Popover CTA "Create a free account — 50 images/day" → sign-up overlay
        (or the auth-overlay link back to /free)

Settings page → Guest credits by IP
   GET  /api/config/ipcredits?pw=…  → rows: 203.0.113.0 · images · scripts · voiceovers ·
                                        left today · last seen · [Reset]
   POST /api/config/ipcredits {pw,key} → delete that row
```

URL access for the same shell:

```
anonymous                     free_user                    paid_user
   /        landing             /        landing             /        landing
   /free    freemium             /free    studio              /free    studio
   /studio  → 302 /free          /studio  studio              /studio  studio
   /paid    → 302 /free          /paid    → 302 /studio       /paid    studio
```

---

## 3d. Flow 0.6 — Account dashboard and manual payment upgrade

```
GET /account
   ├─ no session → inline Sign In / Create Account card (not the studio overlay)
   │                successful auth reloads /account
   └─ session    → profile + live GET /api/credits + plan + recent payment receipts
                    free: Open Video Studio → /studio; Upgrade → /upgrade
                    paid: Open Video Studio → /paid; View Upgrade & Payment Details → /upgrade
                    up to 6 recent receipts appear with pending/approved status

GET /upgrade
   ├─ everyone can read the configured local-gateway + upload instructions
   ├─ no session → inline authentication; there is no anonymous upload
   └─ session    → PaymentScreenshotUploader mounts with history

Choose/drop a receipt
   client checks PNG/JPG/WEBP/GIF type and ≤5 MiB, shows an object-URL preview
   optional note (≤240 chars) → Upload Payment Screenshot
   POST multipart /api/payments/upload (JSON data URL is also accepted by the API)
   Worker re-checks authentication, size and actual image magic bytes
   KV puts payment_img:<id> (base64 bytes) + payment:<id> (pending metadata)
   history refreshes through GET /api/payments/my
   GET /api/payments/image/:id serves bytes only to the owner

Administrator → current-day settings → Payment Transactions
   GET /api/config/payments?pw=…&status=pending&page=1&limit=5
   inspect the private admin image, then enter the verified transaction/reference number
   POST /api/config/payments/approve {pw,id,transactionNumber}
     ├─ missing number / bad id → 400
     ├─ transaction already used by another payment → 409
     ├─ receipt or account missing → 404
     └─ success → payment.status="approved", payment_txn:<normalized-number> index,
                  user:<name>.usertype="paid_user"
The next /api/credits or /paid request rereads the user record: 1,200 images/day and Paid Studio
access apply without issuing a new session cookie.
```

This is a **manual local-payment workflow**. No card is charged and no payment-provider webhook
exists. A settings administrator can also change a plan directly under Plans & credits. There is
no receipt rejection/refund workflow. Without KV, uploads/approvals return `503`; wrong settings
passwords return `403`.

## 3e. Flow 0.7 — CMS Add Page, edit, publish and delete

```
Administrator → current-day settings → CMS Pages
   GET /api/config/cms?pw=… → saved pills + N / 8 counter
   + New Page / Reset clears the draft

Build the draft
   + Add Paragraph         → 200px-minimum textarea
   + Add Image (URL)       → one HTTP(S)-URL input
   + Add 2-Image Row       → two URL inputs
   ↑ / ↓ reorders blocks; Remove deletes one; every edit rerenders the escaped Live Preview
   Page URL is required; Title is optional (slug-derived fallback); Page Link chooses
   "Link Placed On Top Menu" or "Link Placed On Footer"

Save CMS Page → POST /api/config/cms {pw,id?,url,title,pageLink,blocks}
   client blocks a new page when N=8; the server independently enforces every rule:
     flat /^[a-z0-9][a-z0-9-_]{0,63}$/ slug; no root/nested/reserved route
     ≤8 pages · ≤100 blocks · title ≤120 chars · paragraph ≤20,000 chars
     images are http:// or https:// URLs only (≤1,000 chars); empty blocks are omitted
     duplicate slug → 409; invalid payload → 400; wrong pw → 403; no KV → 503
   existing id preserves id/createdAt and updates content/updatedAt; otherwise creates an id
   KV put config:cms_pages → response {page,pages,maxPages} → saved pill + live URL message

Publish/read
   GET /<slug> is tried after all built-in routes → public themed page or 404
   paragraph/title text is HTML-escaped; consecutive images render two per row and can open
   fullscreen; placement injects the link into the shared top menu or footer
   GET /api/cms/pages is public because every saved page is published (there is no draft state)

Edit / Delete
   Edit restores id, fields and blocks; saving at the 8-page cap is allowed for an existing id
   Delete posts /api/config/cms/delete {pw,id} → removes the record and releases one slot
   (API also accepts slug; if both id and slug are present, id wins and only one page is removed)
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
   body   : ONE COLUMN — every .va-section stacks full width (3px bottom margin each)
            ├ Generate SEO Script With AI  ← FIRST block, with the always-visible hint line
            │           "SEO rule (explainer): 1 long-tail keyword said at least 1× ·
            │            exactly 4 short keywords said at least 2× each · minimums only,
            │            extra uses are allowed · one short keyword is in the title ·
            │            one is in a heading · overlap allowed, shared uses count for
            │            both · no long-tail length rule"
            │           topic, minutes 1-6, speech speed, ✨ Generate SEO Script,
            │           SEO plan chips (title + headings + long-tail + 4 shorts,
            │            each keyword with its measured ×),
            │           collapsible SRT box (220 px), ⬇ Download .srt,
            │           🎙 Generate Voiceover (hidden until an SRT exists, then
            │            revealed + enabled by syncVoiceoverButton())
            ├ Images / MP4s — upload + template link + collapsible gallery
            │           note: "Max 5 GIF · 25 images · 5 MP4 (1:00 each, silent)"
            ├ AI Images — directly under the gallery: prompt textarea +
            │           "✨ Generate 2 Images" + results panel (thumb grid)
            │           note: "2 images per submit · 480px landscape"
            ├ Audio — one MP3 (video length = MP3 length)
            ├ Title (top left) — text, font, colour
            ├ Captions (bottom) — up to 10 rows, each hh:mm:ss + ≤40 chars
            ├ Sticker (bottom right) — 7 presets
            └ Quality — 480p Light / 720p Balanced / 720p High
```

Across all seven themes, every button in the accordion (including its header API/disclosure
controls and card/caption remove buttons) has a minimum 48 × 48 px target, 12px 24px padding and
1rem type, matching the Upload Image button's proportions. Under **Neo Brutalist**, all of these
buttons have `border-radius: 0`; other themes retain their own corner tokens.

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

**B. AI images (panel under the gallery)**

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
GALLERY — Interactive scenes · 15 (one live-preview grid):
  14 Reel designs: Kinetic Typography · Duotone · Neon · Glitch Art · Vox Magazine
  15 3D Ring Carousel (3D Ring Video Template)
  No Motion or Graphics/Shape-animation tab/cards; no editable-designs config accordion.
click a card → EDITOR
  toolbar: [← Templates] · scene name · Format (9:16 1080×1920 | 16:9 1920×1080) ·
           Length (1–25 s, default 6) · [⏸ Pause]/[▶ Play] · [↺ Restart]
  preview: live canvas, element tags underneath, loop progress bar

Reel scene: select text/graphic by tag or canvas click; drag to move
  text   → content, font, colour, size, alignment, animation, transition/speed, X/Y
  graphic→ Graphics dropdown (9 original shapes + 13 animated objects), main/accent colour,
           size, animation, transition/speed, X/Y, visibility, add/clone and delete/restore
  both   → Rotate degrees [0…360°, 1° step] + live degree readout
           [+ Front layer] / [- Back Layer] move ONE layer step, disable at boundaries
           background stays behind; tags, frontmost selection and MP4 use the same order
           paused preview redraws on rotation/layer edits; rotated hit targets follow objects
  [＋ Text] becomes [＋ Graphic] for a graphic and clones its settings into a new top layer
  colours: 12 solids + custom colour + four gradients; animated geometry has main/accent colours
  background retains mood/uploaded photo, style, effect, speed and transition controls

Graphics dropdown's 13 animated entries (not separate templates):
  Morphing SVG Blob · Rotating 3D Box · Pulsing Ripple Ring · Floating Glass Card ·
  Orbiting Satellite · DNA Helix Pulse · Infinite Tunnel Zoom · Kaleidoscope Spinner ·
  Elastic Bounce Ball · Audio Equalizer Bars · Diamond Crystal Spin · Neon Laser Beam ·
  Shimmer Spinner Ring. Confetti/particle effects remain excluded.

3D Ring Video Template:
  one carousel tag; visibility, spin speed (0–3×), radius (55–145%), card size (50–150%),
  3D tilt (-30°…30°), whole-ring rotation (0–360°), X/Y, [Reset carousel]
  BOTTOM accordion: Ring images [count / 7 (min 5)]
     Choose ring images → select 5–7 image files together (replaces complete set)
       4/8 files, non-images or failed decode → inline error, previous valid set kept
       success → thumbnails/count update; preview uses exactly those cards
       remove from 7→6→5; removal disabled at five; reset preserves images
     Download/Add disabled until 5–7 images decode, and during upload/export
     stale decodes cannot overwrite a newer selection or expose this accordion elsewhere
     bundled sample cards are preview-only; no remote image host or eight-card rule

[⬇ Download MP4] → shared canvas → WebCodecs H.264 @ 6 Mbps, 30 fps → mp4-muxer → download
[➕ Add to Video N] → same render, no download → probe MP4 → target accordion gallery
                     counts toward five-MP4 cap; clip max 25 s; silent
The modal is reused. Per-scene edits and ring images survive closing/retargeting, in browser
memory only; page reload resets them. Ring uploads are separate from the two background photos.
```

### 4.2 Generate SEO Script With AI

The script block is the **first** section of the left column. It starts with the static hint line
(the only place the SEO rule is stated before the first click) and the button tooltip carries the
same rule; the SEO plan chips only appear *after* a successful run. The rule set below is the
**2026-10-23 explainer SEO rule set** — every documentation of the older script rules was deleted.

```
[hint] "SEO rule (explainer): 1 long-tail keyword said at least 1× · exactly 4 short keywords
        said at least 2× each · minimums only, extra uses are allowed · one short keyword is in
        the title · one is in a heading · short/long-tail overlap is allowed and shared uses
        count for both · no long-tail length rule"
topic   = script-topic input  OR (if empty) the video's title  OR "my video"
minutes = 1..6 (default 1)
speed   = super fast(210 wpm) | fast(170) | medium(140) | slow(110)
  │
  ▼ POST /api/script {topic,minutes,speed}      ← still the only fields the client sends
  │
  ├─ STAGE 1  keyword planner (llama-3.1-8b-instruct-fp8, max_tokens 1024, temp 0.55 (0.4 retry))
  │      asks for one JSON object:
  │        {"title":"…","headings":["…","…"],"longTail":"one long tail keyword",
  │         "short":["s1","s2","s3","s4"]}
  │      verified: exactly 1 nonempty long-tail (NO word/character length rule) · exactly 4 unique shorts (≤3 words each) ·
  │      title ≤70 chars including at least one short keyword · ≥1 heading (≤12 words each)
  │      of which at least one includes a short keyword (the same one as the title's or another)
  │      short/long-tail overlap explicitly ALLOWED, including an identical phrase in both roles
  │      invalid → retry up to 3× with " Your previous attempt was rejected: <reason> …"
  │      3 failures → 500 "SEO keywords invalid (<reason>) - try again"
  │                  (status line shows "Script failed: SEO keywords invalid (…) - try again")
  │
  ├─ STAGE 2  SRT writer (same model, 2048–4096 tokens by duration, temp 0.65 / 0.4 retry) — an EXPLAINER script
  │      prompt = basePrompt ("professional video script writer for EXPLAINER videos … ONLY
  │      valid SRT") + a hard-coded SEO brief that REDUNDANTLY restates every rule: the
  │      explainer title and the headings (structure only, never altered or spoken), the
  │      long-tail said AT LEAST 1×, each of the 4 shorts said AT LEAST 2× + "Work every
  │      keyword into natural spoken sentences - never read them out as a list"
  │      shared-count brief: a long-tail use also supplies the nested short's uses, so a
  │      nested short needs fewer standalone uses (reverse containment counts too)
  │      validateSrt: SRT shape, no overlap, 10 s … minutes*60 s + 1.5 s
  │      (the ≤42-char cue target is prompt text only — the validator does not enforce it)
  │      then keyword counts on the SPOKEN text only (cue numbers/timestamps stripped):
  │        long-tail ≥1 · each of the 4 shorts ≥2 (MINIMUMS ONLY — extra uses are valid)
  │      any deficit → retry up to 3× with the exact reason + per-keyword/cue counts and the
  │      exact number of uses still missing; keywords already at their minimum are marked KEEP
  │      3 failures → 500 "Script output invalid (<reason>) - try again"
  │
  ├─ success → project.srt + project.seoTitle + project.seoHeadings stored
  │            the video title input #va-title-N is autofilled with title.slice(0,70)
  │              when it is still empty (the input's maxlength is 70)
  │            #va-script-box-N filled with the SRT;
  │            SEO plan chips rendered in #va-script-keywords-N (escapeHTML'd):
  │              Title     [Easy Home Coffee Brewing: A Beginner Guide]
  │              Headings  [How does home coffee brewing work?] [What does an espresso setup cost?]
  │              Long-tail [easy home coffee brewing 2×]
  │              Short     [coffee brewing 2×] [home barista 2×] [espresso setup 2×] [morning routine 2×]
  │            SRT box + ⬇ Download .srt become visible; 🎙 Generate Voiceover revealed + enabled
  │            (syncVoiceoverButton(): the button ships hidden and only appears once project.srt exists)
  │            status line: "Script ready — N lines (medium speech, 1 min) · SEO: 1 long-tail (≥1×) +
  │                          4 short keywords (≥2× each) · title + 2 headings"
  │
  └─ failure → status line "Script failed: <error>"  (no alert)
               the previous SRT, chips and download button stay on screen
```

Hints in this flow (inventory: `system-rules.md` RULE 18): the section hint line, the
**✨ Generate SEO Script** tooltip, the chip tooltips
(`Long-tail keyword — must be said at least 1×` /
`Short keyword — must be said at least 2×; shared occurrences inside the long-tail count too; one short keyword is in the title and one in a heading` /
`Explainer title — includes at least one short keyword` /
`Section heading — at least one heading includes a short keyword`), the
`Topic (uses the video title if empty)` placeholder and the `Script ready … · SEO: …` status line.

### 4.3 Voiceover

```
[🎙 Generate Voiceover]  (accordion, hidden until project.srt exists — then revealed + enabled)
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
> video project — it is dead in the client. The **job** statuses
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
/{current-day}/config/uvxyz  → password gate → [Instance mode: Background worker] → [▶ Start worker]
   pollOnce() every 3 s (5 s after a network error) while polling is on:
     GET /api/worker/poll
        server first expires any "running" job older than 10 min → failed("worker timed out")
        then claims the first queued job in the array `listRenderJobs()` built — the parallel
        gets push in completion order, not key order, so no FIFO guarantee: status → "running",
        claimedAt = now
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

## 7. Flow 4 — Day-rotating settings page

The route is `/{current-day}/config/uvxyz`, where `{current-day}` is the unpadded day of month
(1–31) in **Asia/Taipei**. For example, the valid URL on 2026-10-16 is
`/16/config/uvxyz`; it changes at midnight Asia/Taipei. A stale day and the old bare
`/config/uvxyz` route both return `404`.

```
GET /{current-day}/config/uvxyz
  ├─ same studio HTML (including the active theme), with window.__CONFIG_PAGE=true
  │  and CONFIG_PAGE_SCRIPT injected before </body>; initAuth() returns immediately
  └─ the script builds a real full-page #cfg-page on body.cfg-real-page
     (not the retired fixed overlay/settings modal)

Unlock Site Configuration
  enter administrator password → POST /api/config/verify {pw}
     ├─ wrong → 403 {valid:false,error:"Wrong password"} → inline error
     └─ valid → {valid:true,theme} → hide unlock card, show #cfg-unlocked-view
                the entered value stays in memory as unlockedPw for subsequent admin APIs;
                the hard-coded literal is not embedded in this client script

Four full-page tabs
  1. General & Themes
     seven theme cards + Save Theme; registered worker URLs; Background Worker Mode;
     Plans & credits (free/paid_user + optional counter reset); Guest credits by IP
     background mode polls /api/worker/poll and renders queued jobs until Stop/tab close
  2. Local Payment Gateway
     GET /api/config/payment-gateway loads name/details/instructions
     Save → POST same route {pw,gatewayName,gatewayDetails,uploadInstructions}
     /upgrade reads the saved public instructions
  3. Payment Transactions
     paginated all/pending/approved receipt review → admin image → verified transaction number
     Approve follows Flow 0.6 and promotes the receipt owner to paid_user
  4. CMS Pages (Max 8)
     Add Page / Live Preview / saved-page Edit & Delete follow Flow 0.7
```

> The registered worker URLs are **stored only**. Nothing in the codebase ever contacts
> them — each operator opens its own current-day settings URL and that tab polls the API itself.

---

## 8. Failure & edge-path matrix (as implemented)

| Situation | Detected by | User-visible behaviour |
| --- | --- | --- |
| KV namespace not bound | worker route guards | Auth: `503` → landing stays public; primary CTA opens the studio. Render API: `503 "Render storage not configured (bind the KV namespace)"`. `GET /api/config/workers`: `200 {urls:[]}`; its `POST`: `503 "User storage not configured (bind the KV namespace)"` (Bug Fix Session #211) |
| AI binding missing | `/api/script`, `/api/voiceover` | `503 "AI binding not configured"` |
| Image index out of range | `/image/:i` | `400 {success:false,error:"Invalid image index"}` |
| Empty prompt | `/image/gen` | `400 "Missing prompt"` |
| Model error | `/image/:i`, `/image/gen` | `500` with the model's message |
| Keyword plan not valid JSON / not exactly 1 long-tail + 4 shorts / title or heading rule violated | stage-1 planner | up to 3 attempts, then `500 "SEO keywords invalid (<reason>) - try again"` — the SRT writer is never called |
| Short keyword said fewer than twice (minimum 2 uses) | server `keywordUsageError()` on the spoken text | counts as invalid → retried with the exact reason; after 3 attempts `500 "Script output invalid (<reason>) - try again"`. **More** than twice is valid. |
| Long-tail keyword never said (minimum 1 use) | server `keywordUsageError()` | same as above. **Two or more** uses are valid — there is no maximum. |
| Script output not parseable SRT | server `validateSrt()` | up to 3 attempts, then `500 "Script output invalid (<reason>) - try again"` |
| Script shorter than 10 s or longer than minutes+1.5 s | server `validateSrt()` | counts as invalid → retried |
| MeloTTS `AiError 3043` | `/api/voiceover` | 3 retries/chunk → free fallback engine → else `500 "TTS failed (chunk i of n): …"` |
| MeloTTS returns WAV instead of MP3 | `/api/voiceover` | container detected by magic bytes, merged as WAV (`audio/wav`) |
| Voiceover text empty | `/api/voiceover` | `400 "No script text to speak"` |
| Theme not in `CONFIG_THEMES` | `POST /api/config/theme` | `400 "Unknown theme"`, nothing written |
| Theme KV write fails | `POST /api/config/theme` | `503 "Theme storage unavailable"` (JSON, shown in the status line) |
| Theme KV missing or erroring | all five HTML routes (`/`, `/free`, `/studio`, `/paid`, `/{current-day}/config/uvxyz`) | falls back to the built-in look, page still `200` |
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
| Session cookie invalid | `/api/session` | `401` → on `/` the landing stays visible and studio entry opens the auth overlay; on `/free` the same answer boots the guest studio |
| Email already registered | `/api/signup` | `409 "Email already in use"` (1 keyed read of the `email:` index; accounts predating the index are covered by a bounded scan while the namespace holds <= 200 accounts) |
| Duplicate username / email | `/api/signup` | `409 "Username already taken"` / `409 "Email already in use"` |
| Wrong sign-in credentials | `/api/login` | `401 "Invalid username or password"` (never reveals which field) |
| Anonymous payment upload / another user's receipt | payment routes | Upload `401`; owner image route returns `401` signed out or `403` for a different account |
| Invalid/oversized receipt | uploader + `/api/payments/upload` | Client explains type/5 MiB rule; server independently returns `400`/`413` after checking actual bytes |
| Missing/duplicate approval transaction | `/api/config/payments/approve` | Missing number `400`; number already tied to another receipt `409`; missing receipt/account `404` |
| Invalid CMS URL or duplicate slug | `/api/config/cms` | Nested/reserved/malformed URL `400`; duplicate slug `409`; unknown public slug `404` |
| Ninth CMS page / too many blocks | editor + `/api/config/cms` | Client explains the cap; server returns `400` (8 pages, 100 blocks); editing an existing id at cap remains valid |
| Wrong settings password | config CMS/payment APIs | `403 {success:false,error:"Wrong password"}`; no data is written |

---

## 9. Code map (where each flow lives)

| Flow | Primary code |
| --- | --- |
| Page assembly / caching | `src/page.ts`, `src/client/markup.ts`, `src/client/styles.ts` |
| Routes, KV, jobs, auth | `src/index.ts` (ordered route handler; `getCurrentConfigPath()` builds the current-day settings URL, which is matched only by the settings-page GET route; unmatched paths return `404`) |
| Accordions, gallery, queue | `src/client/app-js.ts` MODULE 1-4 (`initVideoStudio()`, `addVideoAccordion()`, `videoAccordionHTML()`, `onVideoFiles()`, `runGenerationQueue()`) |
| Shell / two views | MODULE 1b (`setStudioLayout()`, `renderBatchTable()`, `batchTitle()`, `batchPrompt()`, `batchScenes()`, `focusVideoInEditor()`, `bindStudioShell()`) — reads `videoProjects`, never mutates it |
| AI images panel | MODULE 5 (`submitAiImages()`, `addAiResultCard()`, `addAiToVideo()`) |
| Auth UI | MODULE 6 (`buildAuthOverlay()`, `submitAuth()`, `initAuth()`) |
| Render API + worker | MODULE 7 (`collectVideoPayload()`, `apiRenderVideo()`, `renderVideoLocally()`, `workerRunJob()`) |
| Script / subtitles / voiceover | MODULE 8-9 (`renderSeoKeywords()`, `generateScript()`, `openVoiceoverModal()`, `generateVoiceover()`, `toggleSubtitles()`) — the accordion markup puts the SEO section first in `.va-left` (`videoAccordionHTML()`) |
| Render engine | `generateMP4()`; audio helper `encodeAudioTrack()`; GIF frame decoder `buildGifSlideFrames()` |
| Template composer | `src/client/template-composer-js.ts` (`drawScene()`, `exportMP4()`, `addTemplateToVideo()`, `openTemplateModal()`), `src/client/template-scene-editor.ts` (Interactive gallery/editor), `src/client/template-ring-carousel.ts` (scene 15 renderer, image loading and controls), `src/client/reel-scene-assets.ts` (bundled backdrops), `src/client/template-shape-animations.ts` (13 non-particle animated Graphics element renderers) |
| CMS | `src/modules/cms.ts` (validation, KV record, APIs, public page/navigation injection), CMS section of `src/client/config-page-js.ts` (draft editor/live preview) |
| Payments | `src/modules/payments.ts` (upload/storage/owner/admin/approval routes), `src/client/payment-upload-js.ts` (signed-in uploader/history), payment sections of `src/client/config-page-js.ts` |
| Account / upgrade dashboard | `src/modules/user-pages.ts` (session-aware HTML and plan-aware actions), `src/modules/theme-shell.ts` (shared navigation), `src/index.ts` (`/api/credits` and session reread) |
| Themes | `src/client/styles.ts` (token blocks + shared reskin, appended at the end of `APP_CSS`), `src/index.ts` (`CONFIG_THEMES`, `normalizeTheme`/`readTheme`/`applyTheme` at the top of the module) |
| Settings page | `src/client/config-page-js.ts` (single escaped string) |

---

## 10. End-to-end happy path (one paragraph)

Sign in → `+ Add Video` → drop 3 images, an MP3 and a title → in the first block,
**Generate SEO Script With AI** (2 min, fast): the AI plans 1 long-tail keyword (said at least
once), exactly 4 short keywords (each said at least twice) plus the explainer title and headings, and
writes the SRT around them; the chips under the button show the whole SEO plan with each
keyword's measured count, and an empty video title is autofilled from the AI title → apply subtitles → optionally generate a voiceover and upload it as the audio track →
press **🎬 Generate Videos** → the browser decodes everything, encodes audio then video,
draws Ken-Burns slides with title/sticker/captions/subtitles, muxes an MP4 and saves it to disk →
the status pill turns green *done* and the summary reads "Bulk complete: 1 saved, 0 skipped, 0 failed."

Or, for server-mediated rendering: press **☁️ API** on that video, leave the tab polling, and let a
current-day settings-route worker tab (Flow 3) pick the job up, render it in *its* browser and deliver the MP4
back — the original tab downloads `API_Video1.mp4`.

## 11. Flow 5 — The two studio views (Bug Fix Session #240)

The studio page is one state behind two views. Nothing is duplicated: both read the same
`videoProjects` array and the same accordions.

```
#studio-app
  header.app-top   VIBE STUDIO · [#view-switch: ▦ Bulk grid | ▯ Editor] · [✦ Generate]
  main.app-main
    .heading       VIDEO WORKSPACE · "🎬 YouTube Vibe Studio" · [＋ Add Video]
    .aerial-credit (Aerial skin only) · #bulk-banner (bulk warning, when running)
    section#view-table.view    Batch canvas: table#batch-rows  (read-only)
    section#view-editor.view.active
      .studio
        .studio-card.editor-build  "Build your video"  N of 10 videos · #video-accordions
        .studio-card.preview-card  "Preview monitor"   canvas · progress · #status-text · action bar
        .engine-panels             the legacy 4 × .audio-panel + .controls stack (display:none)
  #gallery · #required-modal       (siblings of <main>, exactly as before)
```

**Switching**

```
[▦ Bulk grid] → setStudioLayout("table")  → #view-table.active, #view-editor hidden
                                          → renderBatchTable() redraws every row
[▯ Editor]    → setStudioLayout("editor") → #view-editor.active (the boot view)
```

- The choice lives in a module variable. Reload always starts in the **Editor** (RULE 15: no
  client storage).
- Both buttons carry `aria-selected`; the active one has `.active`.

**The Bulk grid**

- One row per `videoProjects[i]`: `01` · title (+ the first 64 characters of that video's AI
  image prompt, or “No prompt yet”) · scene counts (`3 img · 1 GIF · 2 MP4`, or `—`) · audio
  (`MP3 1:42`, or `—`) · state badge · **Open ↗**.
- Title = the live `#va-title-N` field, falling back to `Video N`; prompt = `#va-ai-prompt-N`.
- The card head shows `N videos · read-only index`; the editor card head shows `N of 10 videos`;
  the preview card head shows `N in queue` (or `idle`).
- **No bulk operations.** No checkboxes, no duplicate/delete/export/search — the reference's
  toolbar is not ported.
- **Open ↗** → `focusVideoInEditor(n)`: switch to the Editor, expand `#va-body-N`, set
  `#va-arrow-N` to ▼ and scroll that accordion into view.
- Empty state: `No videos yet — press ＋ Add Video to start, then open it here or in the Editor.`

**Keeping the two views in sync**

- A delegated `input` listener on `#video-accordions` re-renders the grid when a
  `#va-title-N` or `#va-ai-prompt-N` changes.
- `updateVideoStatus(n)` re-renders it after every status change, so a render started in the
  Editor is visible in the grid.
- Uploads, AI images, scripts and voiceovers are unchanged — they all still happen in the
  accordion (Flow 1), and the grid simply reflects their results.

**What was deliberately not ported** from the uploaded reference: the timeline dock, the left
rail, the metric strip, the in-bar theme picker, and the preview monitor's hero image, scene
strip, details grid and play button. None of them have an engine here. See
`bug-fix-session-240.md` §6.

## UI update — Aerial / Stellar / template modal (2026-10-15)

> Historical template-gallery composition; the current gallery/editor flow is §4.1C above.

Appearance now labels the former Strata option **Aerial** (the persisted/API value is still
`strata` for backwards compatibility). Its bundled mountain background, blue sky, diagonal
overlay and white typography adapt the HTML5 UP Aerial design to the scrolling studio.
Stellar's main studio and accordion backgrounds are 10% less opaque relative to their original
alpha; accordion backdrop blur is 20% stronger.

In **Add video from template**, the modal keeps its live-preview gallery and editor, now with two
selectable gallery tabs. The existing 8 motion-typography templates (Halo Warp, Terminal Fracture,
Ribbon Editorial, Portal Type, Comic Burst, Dream Echo, Perspective Fold, Liquid Bloom — ported
from the uploaded Typography Motion Studio III HTML) retain their dynamic text-layer, photo-motion,
and animated-background controls. The new **Interactive scenes** tab adds 14 designs adapted from
the uploaded Reel Editor v4 HTML. In this editor, clicking a text layer, graphic or background
loads that element's controls; canvas elements can also be dragged, text can be added, and stickers,
position, colour, size, animation and enter transitions can be changed per object. Both editors
render the same scene canvas used by the H.264 MP4 exporter (WebCodecs + mp4-muxer, no screen
capture). **⬇ Download MP4** renders and downloads the file; **➕ Add to Video N** renders without
downloading and inserts the result into the accordion gallery. Reopening/retargeting and the
existing gallery-insertion flow are preserved.

## UI update — Shape animations + accordion controls (2026-10-23)

> Historical: the separate Shape gallery below has been removed. All 13 objects now live in
> the Graphics dropdown (§4.1C); the larger accordion-button styling remains current.

The uploaded MotionGenie gallery adds a third **Shape animations** tab to the template modal.
Its 13 canvas-rendered Shapes & Motion objects retain their original reference numbers (47–54
and 56–60); Confetti Burst and particle effects are not ported. Each card opens an editable,
looping object preview with colour, background, size, speed and position controls, and exports
through the existing WebCodecs MP4 path. The modal still reuses per-object state and the existing
Add to Video N flow. Video accordion buttons now share the larger Upload Image proportions in
all themes, while Neo Brutalist makes every accordion button square-cornered.

## UI update — Reel element tags, gradients and direct accordion export (2026-10-24)

Interactive-scene element tags now sit in the left column immediately below the preview. Selecting
a graphic changes **＋ Text** to **＋ Graphic**; the action clones that graphic's visual settings into
a new offset element, selects it and adds its tag. Text and graphic colour controls use compact
boxes with 12 solid swatches, a custom colour and exactly one four-gradient row (Sunset, Ocean,
Lime, Violet). Gradient fills are real canvas gradients, so preview and MP4 frames match.

The footer now has one **Download MP4** action and no separate re-download link. **Add to Video N**
runs the same frame-by-frame WebCodecs/muxer render with the download step disabled, probes the
new file and inserts it directly into the target accordion; it no longer depends on a prior
manual export.

## UI update — 3D Ring Carousel + Motion gallery removal (2026-10-24)

> Historical: the two-tab/eight-card behavior below has been superseded by §4.1C. There is
> now one scene gallery and the ring requires 5–7 uploaded images.

This supersedes the gallery composition in the earlier UI-update notes. The template modal now
opens on **Interactive scenes** and has only two tabs: **Interactive scenes · 15** and **Shape
animations · 13**. The Motion tab and all Motion cards are removed from the DOM.

Scene 15, **3D Ring Carousel**, ports only the uploaded editorial demo's eight-card rotating ring.
Its canvas renderer uses eight CORS-loaded editorial images with deterministic fallbacks,
perspective/depth sorting and time-based rotation. Controls cover visibility, speed, radius, card
size, tilt, X/Y and reset. The demo's flip book, Web Audio, ambient particles, fonts and magazine
chrome are not ported. Both Download MP4 and direct Add to Video N use the shared exporter.


## Current requirement revision — SEO overlap and template controls (2026-10-23)

- **SEO:** short/long-tail phrases may overlap; shared occurrences count for both, without any
  long-tail word/character length rule. Frequency is a **minimum only**: the one long-tail must
  appear at least once and each of the four shorts at least twice. Extra uses are allowed and
  never rejected (no `*_FREQ_MAX`).
- **Ring:** upload 5–7 images together in the bottom accordion; invalid batches preserve prior
  images, and both render actions require a valid set.
- **Configuration:** the "15 editable designs" accordion is removed from every template; use
  **← Templates**. The new ring-image accordion is intentionally retained.
- **Elements:** **+ Front layer** / **- Back Layer** move text/graphics one layer step;
  **Rotate degrees** applies real 0–360° canvas rotation in preview/export and hit-testing.
- **Graphics:** all 13 animated objects are in Graphics, alongside the original nine shapes;
  the separate graphics gallery tab, cards and standalone editor are removed.
- Tests: `npm test`; production bundling: `npx wrangler deploy --dry-run`. Local browser smoke
  checks exercised real H.264 download and direct Add to Video insertion. The SEO fixture is
  mock AI; live model availability and the pre-existing legacy TypeScript errors are separate.

See `new_requirements.md` §6 for acceptance criteria, source-file mappings and verification scope.

## 12. Flow 6 — Generate SEO Script walkthrough (this revision)

1. In a Video N accordion the user writes a topic (or leaves it to fall back to the video
   title), picks Minutes (default **1**) and Speech, then presses **✨ Generate SEO Script**.
   That video's **Upload Image, GIF or MP4** button disables immediately and the walkthrough
   modal opens at *1 · SEO plan* while `POST /api/seo-plan` plans **two different** SEO keyword
   sets (long-tail + short-tail keywords, title and headings for each).
2. The user may close the modal while the plan is generated — the request keeps running in the
   background, and when the two sets arrive the modal **re-opens by itself** at
   *2 · Choose a keyword set*, showing both sets as cards.
3. The user clicks **Select this set** on the set that targets their topic. The modal advances
   to *3 · Video image style*; the user types the style for the AI-generated images and presses
   **Generate Script & Images**.
4. The modal closes and the script section shows a loading animation while
   `POST /api/script` writes the SRT from the selected set (the planner is skipped; the set is
   re-validated server-side). The finished script appears in the script box exactly as before,
   with the SEO plan chips, Download .srt and Generate Voiceover.
5. With the script shown, the browser creates a dynamic image-prompt URL
   (`POST /api/image-prompts`) and **polls it every 30 seconds**. Until the AI finishes writing
   the prompts (count by script length: **10** for 1 minute, **14** for 2–3 minutes, **20** for
   4–5 minutes, all in the chosen image style) the URL answers an empty array.
6. When the prompts arrive, the browser generates **one image every 20 seconds** through the
   normal AI image route and drops each finished image into that video's gallery. A watcher
   keeps polling the gallery count; once the last image is in the gallery it **destroys the
   dynamic URL** (`DELETE /api/image-prompts/<id>`) and **re-enables Upload Image, GIF or MP4**,
   so the user can add their own media again.

The accordion form controls follow one standard throughout: every form element uses the
Upload MP3 Audio button's corner radius and padding with a 3px bottom margin (text inputs and
textareas: 4px top / 5px bottom), dropdown labels always sit above their dropdown, and there
is no Captions section in the accordion.

## 13. Audit addendum — SEO walkthrough double-check (corrections to §4, §4.2, §10 and Flow 6)

> Added by the double-check of the SEO walkthrough session. The canonical record —
> every session requirement (SR-1 … SR-21), the implementation map, verification
> evidence and the full inconsistency registers — is
> `seo-walkthrough-session-requirements.md`. Flow 6 (§12) is the current flow;
> this addendum lists where the rest of this document (and Flow 6 itself) still
> disagrees with the code.

**Corrections to earlier sections of this document**

- §4's accordion diagram still shows "Captions (bottom) — up to 10 rows …". That
  section was removed from the accordion (SR-4); captions survive only as the
  hidden global engine rows and as API-supplied worker-job payloads.
- §4.2's "POST /api/script {topic,minutes,speed} ← still the only fields the
  client sends" and §10's one-click happy path describe direct API use, not the
  studio: the client now runs Flow 6 (`/api/seo-plan` → select a set → image
  style → `/api/script` with `keywordSet`).
- §2's surface map and §9's code map omit `POST /api/seo-plan`,
  `POST /api/image-prompts` and `GET`/`DELETE /api/image-prompts/:id`, and file
  the flow under MODULE 8 only; the walkthrough is MODULE 8b plus
  `src/modules/image-prompts.ts`.
- Flow 6's "two different SEO keyword sets" overstates the code: only an
  identical long-tail + ordered-shorts combination is rejected for the second
  set (the e2e fixture's second set shares all four shorts). Flow 6 also omits
  the 6-minute mapping (20 prompts), which only RULE 24 and the session record
  document.

**Bottom list 1 — inconsistencies between the new session code and other code**

1. Closing the modal at the keyword-set or style step strands the video: upload
   and Generate SEO Script are both disabled, so nothing can reopen the modal.
2. Gallery-count completion (DOM children vs. baseline + expected) conflicts
   with the 25-still cap, card removal and unrelated gallery additions;
   `addAiToVideo` returns no success signal, so refused images are counted as
   done and finalisation can be unreachable, premature, or raced by an
   in-flight request.
3. Prompt-poll error/404 paths do not destroy the dynamic URL and leave the
   gallery watcher running; DELETE's response status is never checked.
4. A failed script regeneration leaves the spinner in the SRT box instead of
   the previous script (§4.2's "previous SRT stays on screen" no longer holds
   for the box), while Download/Voiceover remain usable mid-request.
5. The single global walkthrough modal contradicts the per-video independence
   of the accordions: overlapping flows for two videos overwrite one modal.
6. The image queue bypasses `submitAiImages`' credit pre-check and 401/429
   stop; topic/minutes/speed snapshots and cached sets ignore later edits;
   the new API routes record no usage, unlike `/api/script`.

**Bottom list 2 — inconsistencies between documentation and code**

1. This document (§4, §5, §6), `README.md` (accordion description, caption
   limits) and `system-rules.md` RULE 9/10 still document per-accordion
   captions that the code no longer offers.
2. This document §4.2/§10, and RULE 7's client bullet in `system-rules.md`,
   describe the one-click `{topic, minutes, speed}` script flow; the studio
   client now uses the walkthrough and sends `keywordSet` (B-2).
3. This document §2/§9 and RULE 1's route list in `system-rules.md` omit the
   three new routes; RULE 18's hint inventory and the Generate SEO Script
   tooltip/hint do not describe the walkthrough they now start (B-3, B-8).
4. The session's own summaries (`README.md`, RULE 24, Flow 6 above) overstate
   "two different sets", "every form element / labels above dropdowns" (bare
   Sticker/Quality selects have no `<label>`), and the guarantee that the
   prompt URL is always destroyed and the upload button always re-enabled
   (B-4, B-5, B-7).
5. The dynamic URL's creation timing in Flow 6 (after the script) differs
   from the original requirement's "once the user selected the SEO keyword
   set" without Flow 6 flagging the deviation (B-6); DELETE is idempotent
   `200` even for unknown ids, and a failed prompt job polls as
   `200 {success:true, status:"error"}` rather than `success:false` (B-11).
