# New Modular Requirements & Architecture (`new_requirements.md`)

**Last Updated:** 2026-10-23  
**Scope:** SEO overlap rules and template-editor controls (see §6), Modular Payment Screenshot Upload, `/account` & `/upgrade` Flows, Configurable Local Payment Gateway, Full-Page Dynamic Site Configuration, Admin Payment Verification (`paid_user` Upgrade), and Basic Flat CMS (Max 8 Pages).

**Latest request:** [SEO overlap/no long-tail length rule, 5–7 ring-image uploads, removal of the design accordion, layer/rotation controls, and the Graphics dropdown](#seo-template-requirements) — full requirements and acceptance criteria in §6.

---

## 1. Design Goals & Safety Principles

All functionality documented here is implemented as **self-contained, modular subsystems** (`src/modules/*` and `src/client/payment-upload-js.ts`) wired into `src/index.ts` via clean delegation hooks so that existing application code remains untouched and regression-free:

1. **Zero interference with the Video Studio & WebCodecs Engine:** `#studio-app`, `#video-canvas`, scene accordions, AI image generation, MeloTTS voiceovers, and `mp4-muxer` compilation are preserved by the CMS/payment integration. The explicitly requested SEO/template-editor changes are specified separately in §6; the shared preview/export engine remains in use.
2. **Background Worker Compatibility:** Even though `/{current-day}/config/uvxyz` now renders as a **real full page** (`#cfg-page`) rather than a modal overlay, `#studio-app` and `#video-canvas` remain mounted off-screen in the DOM so `window.workerRunJob(job)` continues to render queued MP4 jobs seamlessly when Background Worker Mode is enabled.
3. **7-Theme Compatibility:** All standalone pages (`/account`, `/upgrade`, and `/<cms-slug>`) read `config:theme` and honour all 7 skins (`default`, `strata`, `stellar`, `nightlab`, `paper`, `swiss`, `neo`).
4. **KV-less / Open-Access Resilience:** Every new route degrades gracefully when `KV_BINDING` is unbound (such as `wrangler.e2e.jsonc`), returning defaults on reads and structured `503` JSON messages on writes without throwing uncaught exceptions.
5. **Cloudflare KV Scaling Budget:** Payment metadata (`payment:<revTsId>`) is separated from binary base64 payloads (`payment_img:<id>`) and indexed newest-first via reverse timestamps so paginated admin queries cost `1 list + pageLimit gets`, well inside Cloudflare Workers' 1,000 KV operations per invocation limit.

---

## 2. Detailed Functional Requirements

### Requirement 1 — Modular Payment Transaction Screenshot Upload

- **Purpose:** Allow signed-in users to upload a screenshot of their completed payment transaction for manual admin verification.
- **Client Module (`src/client/payment-upload-js.ts`):**
  - Exposes `window.PaymentScreenshotUploader.mount(target, options)` as an independent IIFE component.
  - Supports click-to-browse and drag-and-drop file selection (`PNG`, `JPG/JPEG`, `WEBP`, `GIF`, up to `5 MB`).
  - Displays an instant client-side thumbnail preview (with click-to-fullscreen inspection), file name/size summary, and an optional user note/reference input.
  - Uploads via `FormData` (`POST /api/payments/upload`) with inline status feedback (never `alert()`).
  - Automatically lists the signed-in user's previously uploaded payment screenshots (`GET /api/payments/my`) with live status badges (`Pending Admin Verification` vs `Approved (paid_user)`) and click-to-fullscreen previews (`GET /api/payments/image/:id`).
- **Backend Validation & Security (`src/modules/payments.ts`):**
  - Requires an authenticated `yvs_session` cookie (`401` when signed out).
  - Validates **binary magic bytes** (`PNG`, `JPEG`, `GIF87a/89a`, `RIFF..WEBP`) rather than trusting client-supplied `Content-Type` or file extensions (`400` on invalid bytes, `413` if `> 5 MiB`).
  - Serves stored images with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` and `X-Content-Type-Options: nosniff`.

---

### Requirement 2 — `/account` & `/upgrade` Pages + Configurable Local Payment Gateway

- **User Account Page (`GET /account` in `src/modules/user-pages.ts`):**
  - Displays the signed-in user's `username`, `email`, current account plan (`free` vs `paid_user`), and live daily AI image credit counter (`GET /api/credits`).
  - Includes a prominent **Upgrade** button (`#account-upgrade-btn`, `href="/upgrade"`) that navigates the user to `/upgrade`.
  - Lists the user's recent payment screenshot submissions and approval statuses.
  - When visited while signed out, provides an inline Sign In / Create Account card alongside the Upgrade call-to-action.
  - Studio footer `Account` (`#account-link`) and `Upgrade` (`#upgrade-link`) links navigate directly to `/account` and `/upgrade`.
- **Upgrade Page (`GET /upgrade` in `src/modules/user-pages.ts`):**
  - Displays the **Local Payment Gateway details** (`gatewayName` and `gatewayDetails`) written by the site owner on the dynamic site configuration page.
  - Displays clear **step-by-step instructions** (`uploadInstructions`) explaining how to complete payment and upload the payment transaction screenshot.
  - Mounts `window.PaymentScreenshotUploader` (`#upgrade-payment-uploader`) for signed-in users (or shows an inline Sign In / Create Account form first if the visitor is signed out).
- **Site Owner Payment Gateway Editor (`/{current-day}/config/uvxyz` → Tab 2: `Local Payment Gateway`):**
  - Allows the administrator to configure `Payment Gateway Title`, `Local Payment Gateway Details`, and `User Screenshot Upload Instructions`, persisted in KV under `config:payment_gateway` via `POST /api/config/payment-gateway`.

---

### Requirement 3 — Dynamic Site Configuration as a Real Full Page (Not a Modal)

- **URL & Rotation:** Continues to use the daily rotating path `/{Asia-Taipei-day}/config/uvxyz` (stale day numbers and bare `/config/uvxyz` return `404`) and administrator password `CONFIG_PASSWORD`.
- **Full-Page Architecture (`src/client/config-page-js.ts`):**
  - Replaces the legacy `.cfg-overlay` / `.cfg-box` fixed modal backdrop with a **real full-page document layout** (`body.cfg-real-page` + `<main id="cfg-page" class="cfg-page">`), complete with a top header bar, inline password unlock card (`POST /api/config/verify`), and tabbed navigation.
  - **Single Dynamic Config URL:** All four administrative sections run as tabs within the exact same `/{current-day}/config/uvxyz` page:
    1. `1. General & Themes` (7 appearance skins, registered background workers, background worker mode, account plans & credits, guest credits by IP)
    2. `2. Local Payment Gateway`
    3. `3. Payment Transactions`
    4. `4. CMS Pages (Max 8)`

---

### Requirement 4 — Admin Uploaded Payment Transactions View, Pagination & `paid_user` Approval

- **Location:** Tab `3. Payment Transactions` inside `/{current-day}/config/uvxyz` (same dynamic config URL).
- **Features:**
  - **Pagination & Filtering:** Paginates through uploaded payment screenshots (`GET /api/config/payments?pw=...&page=<n>&limit=5&status=all|pending|approved`) with `← Previous Page`, `Page X of Y (N total submissions)`, and `Next Page →` controls plus status filtering.
  - **Click-to-Fullscreen Receipt Inspection:** Clicking any payment screenshot thumbnail or its `⛶ Fullscreen Screenshot` button opens the high-resolution image inside a full-viewport lightbox (`#cfg-fs-viewer`, `Esc` or backdrop click to close).
  - **Transaction Number Verification & Database Promotion (`POST /api/config/payments/approve`):**
    - Admin enters the verified `transactionNumber` shown on the user's payment screenshot and clicks **Verify & Approve (Set paid_user)**.
    - Rejects empty transaction numbers (`400`) and prevents reusing a transaction number already bound to a different payment submission (`409` via `payment_txn:<normalizedTxn>`).
    - Updates `user:<lowercased_username>.usertype = "paid_user"` in `KV_BINDING` and marks `payment:<id>.status = "approved"`.
    - Because `creditSessionUser()` re-reads `user:<username>` on every request, the user immediately receives the `paid_user` allowance (`1,200` AI images/day) and `GET /paid` studio access without needing to log out or re-authenticate.

---

### Requirement 5 — Basic Flat CMS (Max 8 Pages + Live Preview)

- **Location:** Tab `4. CMS Pages (Max 8)` inside `/{current-day}/config/uvxyz` + public rendering at `GET /<slug>`.
- **Constraints & Rules (`src/modules/cms.ts`):**
  - **Maximum 8 pages (`CMS_MAX_PAGES = 8`):** Creating a 9th page returns `400`; existing pages can be edited or deleted at any time.
  - **No Nested Pages:** Only single-segment slugs (`/about`, `/faq`, `/pricing-ph`, etc.) are allowed. Any URL containing nested slashes (e.g. `/docs/getting-started`) is rejected with `400`.
  - **Reserved Slug Guard:** Built-in routes (`free`, `studio`, `paid`, `account`, `upgrade`, `tts`, `image`, `api`, `config`, `login`, `signup`, `logout`, `admin`, `favicon.ico`, `robots.txt`) cannot be overwritten by CMS pages.
- **CMS Editor Controls (Left Column):**
  - **Page URL (`#cms-page-url`, required):** Required input for the single-level page slug/path.
  - **Page Title (`#cms-page-title`):** Page heading and menu link label (auto-derived from slug when omitted).
  - **`Page Link` Dropdown (`#cms-page-link`):** Selects where the page link is placed across site navigation:
    - `Link Placed On Top Menu`
    - `Link Placed On Footer`
  - **`+ Add Paragraph` Button (`#cms-add-paragraph-btn`):** Appends a paragraph editor block containing a `<textarea class="cms-paragraph-textbox">` styled with `min-height: 200px`.
  - **`+ Add Image (URL)` & `+ Add 2-Image Row (URLs)` Buttons:** Appends URL-only image inputs (`http://` or `https://` only — **no file upload or `data:` URIs**).
  - Block reordering (`↑` / `↓`) and removal (`Remove`).
- **Right-Section Live Preview (`#cms-live-preview`):**
  - Updates in real time on every keystroke or block change.
  - Renders consecutive images in a strict 2-column grid (`grid-template-columns: repeat(2, minmax(0, 1fr))` — **max 2 images per line**) and allows clicking any image to inspect it fullscreen.
- **Public CMS Pages & Global Navigation Injection:**
  - Visiting `GET /<slug>` renders the themed CMS page with paragraphs and 2-per-line image grids where clicking any image opens it fullscreen (`[data-fullscreen-src]`).
  - Pages with `Link Placed On Top Menu` are automatically injected into the Top Menu across `/`, `/free`, `/studio`, `/paid`, `/account`, `/upgrade`, and all CMS pages.
  - Pages with `Link Placed On Footer` are automatically injected into the Footer across `/`, `/free`, `/studio`, `/paid`, `/account`, `/upgrade`, and all CMS pages.

---

## 3. Route & API Summary

| Method | Path | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/account` | Public / Session | User account dashboard with plan tier, daily credits, submissions, and `Upgrade` button (`href="/upgrade"`). |
| `GET` | `/upgrade` | Public / Session | Displays configured Local Payment Gateway details, upload instructions, and `PaymentScreenshotUploader`. |
| `GET` | `/<slug>` | Public | Renders a published single-level CMS page (themed, max 2 images/line, click-to-fullscreen). |
| `GET` | `/{day}/config/uvxyz` | Password-gated UI | Real full-page Dynamic Site Configuration (`General & Themes`, `Local Payment Gateway`, `Payment Transactions`, `CMS Pages`). |
| `POST` | `/api/config/verify` | Config password | Verifies administrator password and returns `{ success, valid, theme }`. |
| `GET` | `/api/config/payment-gateway` | Public | Reads current `config:payment_gateway` details and instructions. |
| `POST` | `/api/config/payment-gateway` | Config password | Saves `gatewayName`, `gatewayDetails`, and `uploadInstructions` to KV. |
| `POST` | `/api/payments/upload` | Signed-in user | Uploads a validated PNG/JPEG/WEBP/GIF payment screenshot (`<= 5 MB`) via `multipart/form-data` or JSON. |
| `GET` | `/api/payments/my` | Signed-in user | Lists the authenticated user's uploaded payment transactions (newest first). |
| `GET` | `/api/payments/image/:id` | Signed-in owner | Serves the authenticated user's own uploaded screenshot binary image. |
| `GET` | `/api/config/payments` | Config password | Paginated list of uploaded payment screenshots (`?pw=...&page=1&limit=5&status=all\|pending\|approved`). |
| `GET` | `/api/config/payments/image/:id` | Config password | Serves any uploaded payment screenshot image for admin preview / fullscreen inspection. |
| `POST` | `/api/config/payments/approve` | Config password | Verifies `transactionNumber`, marks payment `approved`, and updates `user:<username>.usertype = "paid_user"`. |
| `GET` | `/api/cms/pages` | Public | Lists published CMS page definitions (`maxPages: 8`). |
| `GET` | `/api/config/cms` | Config password | Lists CMS pages for the configuration editor. |
| `POST` | `/api/config/cms` | Config password | Creates or updates a flat CMS page (enforces required URL, no nesting, max 8 pages, URL-only images). |
| `POST` | `/api/config/cms/delete` | Config password | Deletes a CMS page by `id` or `slug`. |

---

## 4. Cloudflare KV Storage Schema

| KV Key | Value Shape | Notes |
| :--- | :--- | :--- |
| `config:payment_gateway` | `{ gatewayName, gatewayDetails, uploadInstructions, updatedAt }` | Displayed on `/upgrade` and edited on `/{day}/config/uvxyz`. |
| `payment:pay-<revTs13>-<hex>` | `{ id, username, email, mimeType, fileName, fileSize, userNote, status, transactionNumber, createdAt, approvedAt }` | Lightweight metadata; `9999999999999 - Date.now()` sorts newest-first in `KV.list({ prefix: "payment:" })`. |
| `payment_img:pay-<revTs13>-<hex>` | `{ mimeType, data: "<base64>" }` | Separated from `payment:` prefix so pagination never reads image blobs unnecessarily. |
| `payment_txn:<normalizedTxn>` | `{ paymentId, username, transactionNumber, approvedAt }` | Prevents duplicate reuse of the same transaction number across different submissions. |
| `user:<lowercased_username>` | `{ username, email, salt, hash, usertype: "free" \| "paid_user", ... }` | Updated to `usertype: "paid_user"` upon admin payment approval. |
| `config:cms_pages` | `CmsPageRecord[]` (max 8 entries) | Stores flat `slug`, `url`, `title`, `pageLink`, and `blocks` (`paragraph` / URL `image`). |

---

## 5. Module File Map

- `src/modules/theme-shell.ts` — Shared 7-theme HTML shell, Top Menu & Footer CMS navigation renderer, and `[data-fullscreen-src]` fullscreen image lightbox.
- `src/modules/payments.ts` — Payment gateway KV config, binary image magic-byte validation, screenshot upload/serving, paginated admin listing, and transaction-number approval (`paid_user` promotion).
- `src/client/payment-upload-js.ts` — Reusable `window.PaymentScreenshotUploader` client module mounted on `/upgrade`.
- `src/modules/user-pages.ts` — Server-rendered `/account` and `/upgrade` pages with inline session support.
- `src/modules/cms.ts` — Flat CMS validation, KV persistence (max 8 pages), public `/<slug>` renderer, and `applyCmsLinksToStudioHtml()` marker injection.
- `src/client/config-page-js.ts` — Real full-page Dynamic Site Configuration UI (`#cfg-page`) housing all 4 admin tabs under `/{day}/config/uvxyz`.
- `src/modules/script-seo.ts` — Modular Explainer SEO Script Engine (`POST /api/script`) with Stage-1 short/long-tail overlap support (no long-tail length rule), Unicode/symbol-safe `keywordCount()`, resilient SRT cue canonicalization, pinpoint cue-level retry coaching, and correlated `[script]` structured logging.


---

<a id="seo-template-requirements"></a>

## 6. Current SEO & Video Template Requirements — 2026-10-23

This revision supersedes earlier descriptions of mutually exclusive short/long-tail phrases,
2–6-word long-tail keywords, an eight-card-only ring, a separate graphics/shape gallery, or the
"Scenes · 15 editable designs" configuration accordion.

### Requirement 6 — Fix SEO planning: allow short/long-tail overlap, without a long-tail length rule

- A short keyword **may occur within the long-tail phrase**; the same phrase may also serve both
  roles. Neither the planner prompt nor the validator imposes a minimum/maximum word count or
  character length on the long-tail keyword. Empty/non-keyword values remain invalid.
- Preserve the existing contract: exactly **one long-tail**, exactly **four unique short
  keywords** (1–3 words each), every keyword measured **exactly twice** in spoken SRT, an AI title
  of at most 70 characters containing a short keyword, and at least one heading containing a
  short keyword. Existing short-to-short nesting restrictions remain unchanged.
- **Shared-count rule:** saying `morning yoga poses` twice already says the short keyword `yoga`
  twice. Do not require two additional standalone uses. Equivalently, if a one-word long-tail is
  inside a longer short phrase, those short-phrase uses count toward the long-tail too.
- Stage 2 and its retries must explain shared counts, not coach the model to insert each phrase
  independently. Three standalone/nested total uses are still rejected; overlap is not a waiver
  of the two-use rule. Unicode/hyphen-safe matching and SRT timing validation remain in force.
- **Acceptance:** overlapping and one-word/>6-word long-tail plans pass; two shared occurrences
  satisfy both roles; an extra third use fails; planner/writer prompts and UI hints agree.
- **Implementation:** `src/modules/script-seo.ts`, `src/client/app-js.ts`; deterministic overlap
  fixture in `e2e/index.ts`.

### Requirement 7 — 3D Ring Video Template: 5–7 uploaded images in a bottom accordion

- Keep the gallery template **3D Ring Carousel** (scene 15). Add a **Ring images** upload accordion
  at the **bottom of its configuration controls**, shown only for this template.
- A file selection replaces the complete image set and must contain **at least 5 and at most 7
  decodable image files**. Reject 4/8 files, non-images and unreadable batches with inline feedback
  while keeping the previous valid set; do not silently truncate or partially replace it.
- Display thumbnails, names and the current count. Allow removal from 7→6→5; disable removal at
  five. Replacement/removal releases unused object URLs. Stale asynchronous decodes cannot
  overwrite a newer selection or reveal ring controls after switching templates.
- Download MP4 and Add to Video require 5–7 decoded images and wait for uploads to finish. Use the
  **actual uploaded count and images** for ring spacing, live preview and exported frames.
  Upload changes are blocked during a ring export. The six bundled sample cards are preview-only,
  not a substitute for required uploads; there is no remote-photo dependency.
- Keep images in the browser session, separate from the ordinary two background-photo uploads.
  Closing/reopening the reusable modal preserves them; page reload does not. Reset carousel
  resets transforms only and keeps the selected images.
- **Acceptance:** 5 and 7 images work in both actions; invalid batches preserve state; the upload
  accordion is absent/hidden on every other template; previews and MP4 contain the same cards.
- **Implementation:** `src/client/template-ring-carousel.ts`, `src/client/styles.ts`.

### Requirement 8 — Remove the "15 editable designs" accordion from every template configuration

- Remove the entire scene-switcher accordion, its list, builder and obsolete styling. Do not
  merely change its title or hide one copy with CSS. This does **not** remove the 15 gallery
  templates or the new Ring images upload accordion.
- **← Templates** remains the route back to the gallery. No changes to the administrator's
  site-configuration tabs are needed: this request concerns the template editor's config area.
- **Acceptance:** no `.tm-scene-switcher`, `#tm-scene-list` or editable-design accordion in the
  generated modal DOM for any template.
- **Implementation:** `src/client/template-scene-editor.ts`, `src/client/styles.ts`.

### Requirement 9 — Functional text/graphic layer controls

- Add the exact labels **+ Front layer** and **- Back Layer** to the selected text/graphic's
  inspector. Each click moves that element **one position** forward/backward, not all the way
  to the front/back. Disable buttons at their boundaries and show its layer position.
- Keep the background behind all elements. Use one saved element order for object tags,
  preview paint order, frontmost hit-testing and MP4 rendering. Newly added elements start on
  top; switching templates or reopening the modal retains each scene's order.
- Deleted elements do not consume layer-button steps; they can still be restored. The ring is
  one carousel object, not a collection of independently layered text/graphic elements.
- **Acceptance:** overlapping text/graphics visibly change order; the frontmost object receives
  canvas selection; exported frames use that same order.
- **Implementation:** `reelElementKeys()`, `reelMoveElementLayer()` and
  `reelAddElementTransforms()` in `src/client/template-scene-editor.ts`.

### Requirement 10 — Functional rotation-degree slider

- Add **Rotate degrees**, **0–360°**, **1° steps**, to every selectable text/graphic inspector,
  including the animated graphics, with a live degree readout. Add the same whole-ring rotation
  control to the ring inspector, separately from 3D tilt and automatic spin speed.
- Save the angle per element and combine it with existing entry/loop animations. Redraw on
  slider input even when the preview is paused. Rotated canvas hit targets/selection bounds
  follow the element; the export must apply the same canvas rotation, not CSS-only transforms.
- **Acceptance:** a 90° text/graphic rotation changes its actual draw transform in preview and
  exported frames, and the rotated object remains selectable/draggable.
- **Implementation:** `src/client/template-scene-editor.ts`, `src/client/template-ring-carousel.ts`.

### Requirement 11 — Move all animated graphics into Graphics; remove their gallery tab

- Keep one **Interactive scenes · 15** gallery. Remove the separate Graphics/Shape-animation tab,
  its cards/grid and standalone object editor/mode, rather than only hiding the navigation.
- The selected graphic's **Graphics** dropdown contains **22 choices**: nine existing
  shapes/stickers plus all thirteen animated objects: Morphing SVG Blob, Rotating 3D Box, Pulsing
  Ripple Ring, Floating Glass Card, Orbiting Satellite, DNA Helix Pulse, Infinite Tunnel Zoom,
  Kaleidoscope Spinner, Elastic Bounce Ball, Audio Equalizer Bars, Diamond Crystal Spin, Neon
  Laser Beam and Shimmer Spinner Ring. Confetti/particle effects stay excluded.
- These objects render inside the scene as graphics, with main/accent colours, size, speed,
  position, transition/animation, rotation, layering, visibility, add/clone and delete controls.
  They use the existing deterministic canvas renderer and the same MP4 path as the scene.
- **Acceptance:** all 13 appear and render from the dropdown in all 14 Reel templates; neither
  graphics tab/cards nor standalone shape mode are present in the modal.
- **Implementation:** graphic registry in `src/client/template-scene-editor.ts`, object geometry
  in `src/client/template-shape-animations.ts`, updated modal copy in `template-composer-js.ts`.

### Verification & scope

- `npm test`: **32 passing tests** covering SEO API/validator behavior and DOM/canvas-transform tests, including image
  boundaries, decode errors/races, URL cleanup, persistent edits, all object renderers, layer
  hit-testing, rotation and both render actions. Test codecs are stubbed; the render loop is real.
- `npx wrangler deploy --dry-run`: production Worker bundle builds successfully.
- Local Worker/browser smoke checks: the SEO UI succeeds with the deterministic overlapping,
  >6-word fixture; real Chromium renders all 13 objects and the ring, produces a valid H.264 MP4,
  and adds a separately rendered MP4 directly to the video accordion without downloading it.
- Live Cloudflare AI availability was **not** exercised; `e2e/index.ts` uses a mock model. The
  full `npm run check` is still blocked by 36 pre-existing `src/index.ts` type errors, not by these
  changes. No deployment, KV migration or new production endpoint is required by this revision.
