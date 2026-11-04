# Bug Fix Session 331 — Browser-owned pipeline management storage

Date: 2026-11-04
Branch: `arena/2b49505f-text-to-image-template`
Source of truth: the current code in this workspace. This session does **not** use older rules Markdown as authority.

## 1. Purpose

Session 331 records the code study, the hanging-implementation audit, and the fixes requested for the **Quick Batch table** and **Editor** layouts. The active requirement is:

> Make local storage and cookie the storage for info for management of pipeline in batch table layout and editor layout. Make current code source of truth. Make a short logical simulation of code in current state, make a debug and simulation, and print the system rules based on code with no in-depth testing.

The follow-up requirement for this session is:

> For number 5 make three cookie or four to avoid limits. Fix number one, six and four and explain here. For number seven no ttl; the timestamp for local storage must be a match for the cookie. For number 8 make opening a new tab require a new local storage page with id and the vids that will be drafted on that tab will have ids and every new tab will have empty vids on both layout because there is a different local storage page.

The later follow-up request documented in section 8 is:

> Clear fix this Storage failures are silently swallowed — low/medium persistPipelineManagementState() catches all errors and only writes window.__PIPELINE_MANAGEMENT_SAVE__. There is no user-visible warning and no recovery UI. pipelineManagementStore.clear() exists but is not wired to any reset action For number two the generate button will work for video rows that is ready to be generated not on those unprepared staged Explain all these remaining problems in technical and another oversimplified versiin for newbie devs

## 2. Code study recorded in the previous review

### 2.1 Client bundle

`src/client/app-js.ts` is the main browser source of truth. It injects:

- `PIXABAY_DIRECT_JS`
- `BROWSER_OFFLOAD_JS`
- `BROWSER_USAGE_JS`
- `PROGRESSIVE_IMAGE_PIPELINE_JS`
- `SCRIPT_NOTES_CLIENT_JS`
- `PIPELINE_MANAGEMENT_STORE_JS`

Browser-owned storage systems:

| Concern | localStorage | Cookie |
|---|---:|---:|
| Script notes | full note | compact digest mirror |
| Usage ledger | full counts | two-day count mirror |
| Pipeline management | full per-page snapshot | four cookie chunks |

### 2.2 Fixed media plan

The active implementation uses:

- `AUTO_MEDIA_TOTAL = 12`
- `AUTO_VIDEO_SCENES = 4`
- `AUTO_IMAGE_SCENES = 8`
- video positions `[1,4,7,10]`
- upstream `per_page=12`
- 8 photo results and 4 video results
- up to 2 Pixabay pages
- global image ordinals in scene tokens

This is shared by `src/modules/pixabay.ts`, `src/modules/image-prompts.ts`, `src/client/pixabay-direct.ts`, `src/client/progressive-image-pipeline.ts`, `src/client/app-js.ts` and `src/index.ts`.

### 2.3 Retry and concurrency model

`batchRunPipelineStage()` owns Quick Batch non-media retries:

- one initial attempt
- at most 7 retries
- 40,000 ms backoff
- per-failed-stage reset
- silent UI
- STOP is not retried
- `MediaItemRetryExhausted` bypasses whole-stage retries

Media items have their own individual retry ladder. Successful media and object URLs are preserved.

Anti-hang guards already present:

- `BATCH_STREAM_IDLE_TIMEOUT_MS = 90000`
- `BATCH_AUDIO_DECODE_MS = 15000`
- `BATCH_IMAGE_STREAM_CONCURRENCY = 3`
- `CLIENT_DECODE_THREAD_POOL_SIZE = 3`
- reentrancy guard in `startUnprocessedRows()`

`src/client/browser-offload.ts` remains version-261 capability-gated and uses adaptive concurrency, a control lane, Web Locks, `BroadcastChannel`, cancellation and retry hints.

### 2.4 Quick Batch / Editor UI

Quick Batch has one `Actions` column:

- Preview
- Process Export
- Edit
- no row AI enhancer button

Edit uses `batchProjectJson()` and `openBatchEditPage()`. Before Session 331 it used inline `projectJson`, a localStorage fallback and a `noopener` child-window object assignment.

The editor pins its script textbox during script writing/retries and shares the fixed 12-scene media contract.

### 2.5 First pipeline-management storage implementation

The first implementation used:

- localStorage key `ytvs.pipeline-management.v1`
- cookie `ytvs_pipeline_management`
- `Max-Age=172800`
- compact cookie mirror with digest and timestamp
- `save()` write/read-back verification
- `load()` repair from local storage or restore from compact cookie
- hooks in layout changes, table render, stage changes, Edit handoff, editor flow start/finalize, transition application, startup and `beforeunload`
- a `storage` event listener

The short simulation showed normal save/read, cookie repair and cookie-only restore.

## 3. Hanging-implementation audit from the previous review

1. **Cross-tab storage event ping-pong.** A `storage` event called `restorePipelineManagementState()`, which called `setStudioLayout()` / `renderBatchTable()`, which called `persistPipelineManagementState()`, which wrote localStorage again and triggered another tab.
2. **No absolute deadline for a silent retry stage.** `batchRunPipelineStage()` can wait 7 × 40 seconds plus request time. If an awaited step never settles, the row remains pinned and silent.
3. **Web Locks loop can wait indefinitely.** `coordinated()` loops forever while a lock is unavailable unless cancellation or an API error occurs.
4. **Edit handoff with `noopener`.** `window.open(..., "noopener")` usually returns `null`, so child-window assignment is unreliable. The inline `projectJson` URL can be too long. The localStorage fallback is removed on first read.
5. **Cookie mirror can exceed browser limits.** A 20-row + 20-project compact mirror was measured at 4532 raw characters / 7554 encoded characters, above typical 4 KB cookie limits.
6. **Cookie-only restore was lossy.** `fromCompact()` did not restore scripts, titles, settings, `runBusy`, queued IDs, `finishedCount` or media-related management state. Active/done stages were forced back to `ready`.
7. **No TTL enforcement on localStorage, but cookies had TTL.** The cookie had `Max-Age=172800`; localStorage had no expiry check. The requirement is **no TTL**; the timestamp in localStorage must match the cookie.
8. **Storage-event restore can overwrite live work.** Another tab's snapshot could change layout, reset row stages, clear live flags, add rows and modify editor settings.
9. **Persistence hooks were not exhaustive.** Direct `retryImagePromptFlow()` start, some script textbox edits and some script-writing state changes were not individually hooked.
10. **Storage failures were swallowed.** `persistPipelineManagementState()` only wrote a debug global; `clear()` was unused. **Resolved by section 8:** failures now show a warning banner and `clear()` is wired to a reset button.
11. **Validation gap.** No full suite, TypeScript project check, Wrangler dry-run, server preview or commit/push after the storage integration.

## 4. Session 331 requirements and decisions

### 4.1 Number 5 — four cookies

Requirement: “make three cookie or four to avoid limits.”

Decision: **four cookie chunks** are used. The full management snapshot is split into four session cookies. Each chunk is bounded to `3800` encoded characters. The store also bounds rows, projects and script text until all four chunks fit.

Cookie names are page-scoped:

```text
ytvs_pipeline_management_<pageId>_1
ytvs_pipeline_management_<pageId>_2
ytvs_pipeline_management_<pageId>_3
ytvs_pipeline_management_<pageId>_4
```

### 4.2 Number 1 — cross-tab ping-pong fixed

Requirement: fix number one.

Implementation:

- `pipelineManagementRestoring` suppresses all persistence while a restore is running.
- `persistPipelineManagementState()` returns immediately when restoring.
- The `storage` listener only reacts to the current page's localStorage key.
- Every tab now has a different page key, so another tab's state cannot match this tab's key.

### 4.3 Number 6 — cookie-only restore fixed

Requirement: fix number six.

Implementation:

- Four cookies carry the **full bounded snapshot**, not a compact summary.
- The snapshot now includes `script`, `title`, `topic`, `style`, `minutes`, `resolution`, `orientation`, `quality`, `runBusy`, `queued`, `finishedCount`, `attempt`, `vid`, editor script and editor settings.
- `restorePipelineManagementState()` restores row scripts, editor scripts, titles, settings, vids, finished count and safe stage states.
- Media bytes, object URLs and actual filenames remain memory-only; live `running`, `retrying` and `stopRequested` flags are still cleared on reload.

### 4.4 Number 4 — Edit handoff fixed

Requirement: fix number four and explain it.

Implementation in `openBatchEditPage()`:

- the giant inline `projectJson` query is removed
- the URL carries only `layout=editor`, `pipelinePage=<targetPageId>` and `projectEdit=<key>`
- the full payload stays in shared localStorage under `MEDIA_TRANSITION_STORAGE_PREFIX + key`
- a short cookie mirror carries `createdAt`, source/target page IDs and the row vid
- no `child.__TRANSITION_PROJECT__` assignment is attempted
- `readTransitionProjectPayload()` accepts the payload only when the localStorage `createdAt` matches the cookie mirror `createdAt`
- both localStorage key and cookie mirror are removed after the read
- `applyTransitionProject()` assigns `project._pipelineVid`

Explanation: with `noopener`, a child window object is not dependable; the short URL plus timestamp-matched localStorage/cookie handoff is. A new tab still gets its own pipeline page id, while the explicit Edit transition is the only deliberate cross-page handoff.

### 4.5 Number 7 — no TTL, timestamp match

Requirement: “no ttl the timestamp for local storage must be a match for the cookie.”

Implementation:

- no `Max-Age` on active pipeline-management cookies; they are session cookies
- `pipelineManagementTtl: 0` in Worker capabilities
- no age-based rejection of localStorage state
- `save()` requires the localStorage `updatedAt` and cookie chunk `t` to match, and requires the same digest
- `load()` trusts the pair only when `local.updatedAt === cookie.t` and `digest(local) === cookie.h`
- a mismatch makes localStorage authoritative and rewrites the cookie chunks
- the transition handoff likewise requires `payload.createdAt === mirror.createdAt`

### 4.6 Number 8 — new tab page id and empty vids

Requirement: “make opening a new tab require a new local storage page with id and the vids that will be drafted on that tab will have ids and every new tab will have empty vids on both layout because there is different local storage page.”

Implementation:

- `sessionStorage["ytvs.pipeline-page.v1"]` holds the tab's page id
- a URL `pipelinePage` value can force a new page id for a newly opened tab
- `openBatchEditPage()` generates `targetPageId = pipelineManagementStore.freshPageId()` and puts it in the URL
- localStorage key is `ytvs.pipeline-management.v1.<pageId>`
- cookie names include `<pageId>`
- every Quick Batch row gets `vid = <pageId>-row-<id>`
- every Editor project gets `_pipelineVid = <pageId>-editor-<n>`
- the snapshot carries `pageId` and `videoIds`
- a new tab with a fresh page id has no matching localStorage key and no matching cookie chunks, so `load()` returns `none`
- both layouts therefore start with empty vids in that tab; the explicit Edit transition is the only exception

## 5. Implementation contract

### `src/client/pipeline-management-store.ts`

Exports `PIPELINE_MANAGEMENT_STORE_JS` and creates `createPipelineManagementStore(window)`.

Returned contract:

```text
pageId
localStorageKey
cookieNames[4]
cookieCount = 4
ttl = 0
freshPageId()
digest()
boundedSnapshot()
save()
load()
clear()
```

`save()` returns:

```text
ok, localStorage, cookies, cookieCount, timestampMatched,
digest, updatedAt, pageId, layout, videoIds, cookieMaxValue, ttl
```

`load()` returns:

```text
snapshot, source, repairedCookie, debug
```

Sources:

- `localStorage+cookies`
- `localStorage` with repaired cookies
- `cookies`
- `none`

### `src/client/app-js.ts`

Added/changed:

- `pipelineManagementRestoring`
- `ensurePipelineVideoIds()`
- full snapshot with scripts and vids
- restore of scripts, settings, vids and safe management stages
- suppressed persistence during restore
- page-scoped storage event guard
- short Edit URL with `pipelinePage`
- transition cookie mirror
- `_pipelineVid` on transition project

### `src/index.ts` capabilities

```text
pipelineManagementStorage: "client:localStorage+cookies"
pipelineManagementPageId: "sessionStorage:ytvs.pipeline-page.v1"
pipelineManagementLocalKeyPrefix: "ytvs.pipeline-management.v1."
pipelineManagementCookiePrefix: "ytvs_pipeline_management_"
pipelineManagementCookieChunks: 4
pipelineManagementScope: "quick-batch+editor"
pipelineManagementTtl: 0
pipelineManagementConsistency: "updatedAt+digest"
pipelineManagementNewTabState: "empty"
pipelineManagementVideoIds: "page-id-scoped"
```

## 6. Short simulation / debug

`simulations/pipeline-management.mjs` is a short logical walkthrough, not a test suite.

Observed result:

```text
page A: pageId p_pagea_1
        localStorageKey ytvs.pipeline-management.v1.p_pagea_1
        four cookies, ttl 0
save: ok=true, cookies=4, timestampMatched=true, videoIds=5
normal load: localStorage+cookies, rows=3, projects=2,
             firstScript preserved, firstTitle preserved,
             runBusy preserved, queued preserved
cookie chunks: count=4, maxValueLength=1018, limit=3800
cookie-only full restore: source=cookies, rows=3, projects=2,
                          scripts/titles/runBusy/queued/videoIds preserved
timestamp mismatch: source=localStorage, repairedCookie=true,
                     timestampMatched=false
new tab: pageId p_pageb_1, different localStorageKey,
         different cookieNames, load source=none,
         rows=0, projects=0, videoIds=0
```

Client script parse:

```text
APP_JS syntax OK 615318
```

## 7. Validation boundary

Session 331 deliberately keeps validation short:

- no full `npm test`
- no `npx tsc --noEmit` project check
- no `npm run check` / Wrangler dry-run
- no server preview
- no commit or push

Only the short simulation, client-script syntax parse and `git diff --check` are part of this session's verification boundary.

Later broken-code, syntax and fix-verification passes did run broader checks; those results are recorded in section 8.7. The short boundary above describes the original Session 331 storage-integration pass only.

---

## Current code and system

**Section label:** `current-code-and-system`
**Input boundary:** this section was derived from non-Markdown source, config, support-code inventories and static reads only. No other Markdown file was consulted as an authority. The only Markdown written is this target document.

### Study boundary and code surface

Static inventory of the workspace:

| Surface | Files | Role |
|---|---:|---|
| `src/**/*.ts` | 37 TypeScript files, 70,031 lines | Runtime Worker + browser source of truth |
| `tests/*.mjs` | 46 files | JSDOM/Worker test harnesses; inventoried, not used as runtime authority |
| `bench/*` | 12 files | Benchmarks and smoke harnesses |
| `e2e/*` | 2 files | End-to-end Worker fixtures |
| `render-app/*` | 5 files | Separate render helper service |
| `simulations/*` | 1 file | `pipeline-management.mjs` short logical simulation |
| Config | `package.json`, `wrangler.json`, `tsconfig.json`, `worker-configuration.d.ts` | Scripts, bindings, compiler/runtime types |

`src/index.ts.original` is a 21,009-line backup file, not the active Worker entry. `wrangler.json` points `main` at `src/index.ts`.

`package.json` defines: `npm test` as `node --import tsx --test tests/*.test.mjs`, `npm run dev` as `wrangler dev`, `npm run check` as `tsc && wrangler deploy --dry-run`, and `npm run deploy` as `wrangler deploy`.

`wrangler.json` declares the `AI` binding, `KV_BINDING`, the `PIXABAY_RATE_LIMITER` Durable Object with SQLite migration `pixabay-rate-limit-v1`, observability, compatibility date `2025-10-08`, and `PIXABAY_API_KEY` in `vars`.

### Runtime architecture from code

1. **Single Worker entry.** `src/index.ts` exports the default `{ fetch }` object and exports `PixabayRateLimiter` from `src/modules/pixabay.ts`.
2. **Cached page assembly.** `src/page.ts::createHTML()` caches one HTML string and substitutes `APP_CSS`, `API_ROTATION_JS`, `APP_JS`, `TEMPLATE_COMPOSER_JS` and `JSON.stringify(prompts)` into `src/client/markup.ts::PAGE_MARKUP`.
3. **Main client bundle.** `src/client/app-js.ts` injects `PIXABAY_DIRECT_JS`, `BROWSER_OFFLOAD_JS`, `BROWSER_USAGE_JS`, `PROGRESSIVE_IMAGE_PIPELINE_JS`, `SCRIPT_NOTES_CLIENT_JS` and `PIPELINE_MANAGEMENT_STORE_JS`. It contains 355 function declarations in the static scan.
4. **Secondary client modules.** `api-rotation.ts`, `config-page-js.ts`, `payment-upload-js.ts`, `template-composer-js.ts`, `template-ring-carousel.ts`, `template-scene-editor.ts`, `template-shape-animations.ts`, `styles.ts`, `aerial-background.ts` and `reel-scene-assets.ts` supply rotation, admin, payment, template, CSS and bundled asset code.
5. **Worker modules.** `pixabay.ts`, `image-prompts.ts`, `image-batch.ts`, `image-load.ts`, `image-queue.ts`, `script-seo.ts`, `script-notes.ts`, `script-notes-api.ts`, `script-event-loop.ts`, `voiceover.ts`, `llm-openrouter.ts`, `api-relay.ts`, `cms.ts`, `payments.ts`, `theme-shell.ts` and `user-pages.ts` implement API routes, queues, planning, media, auth-adjacent pages and admin surfaces.

### User flow

1. **Page load.** The Worker canonicalizes public page URLs, applies the selected theme and CMS links, and returns cached HTML from `createHTML()`. Browser scripts are evaluated in one page context.
2. **Client boot.** `app-js.ts` executes, in order: `initVideoStudio()`, `bindStudioShell()`, `restorePipelineManagementState()`, `applyTransitionProject()`, `bindLandingActions()`, `initAuth()`, then `persistPipelineManagementState("startup")`. It installs page-scoped `storage` and `beforeunload` listeners.
3. **Identity and credits.** The shell calls `/api/session` and `/api/credits`. Login, signup and logout use `/api/login`, `/api/signup` and `/api/logout`. `/account` and `/upgrade` are standalone themed pages; `/upgrade` mounts the payment screenshot uploader. The Worker's KV/session remains the authority for credits and authorization.
4. **Layout selection.** `setStudioLayout("editor" | "table")` toggles `#view-editor` / `#view-table` and `[data-layout]` buttons. Each tab receives a pipeline page id from `sessionStorage["ytvs.pipeline-page.v1"]` or a `pipelinePage` URL parameter. `restorePipelineManagementState()` restores only that page's state; a new tab starts empty in both layouts.
5. **Editor script flow.** A user adds a video accordion, enters topic/minutes/style/resolution/orientation/quality and starts script writing. The browser uses `/api/script` with client-owned retry handling. `script-seo.ts` may use internal timestamped cues for validation but returns **plain narration text only**. The finished note is stored by `script-notes-client.ts` in localStorage + cookie, not KV. The script textbox stays pinned during writing and retries.
6. **Editor voiceover.** The plain script goes to `/api/voiceover`. `voiceover.ts` sanitizes typography/emoji, splits into bounded sentence chunks, calls MeloTTS with Deepgram/external fallbacks, and returns MP3 audio.
7. **Editor scene planning.** The full script goes to `/api/seo-plan` and/or `/api/image-prompts`. `image-prompts.ts` plans typed Pixabay keyword scenes, not generated image prompts. The active planner call uses `max_tokens: 2048`; `IMAGE_PROMPT_MAX_TOKENS = 3584` remains an exported compatibility constant.
8. **Editor media import.** `pixabay-direct.ts` reads `/api/media/config`, claims credits with `/api/media/claim`, searches `https://pixabay.com/api/` or `/api/videos/`, downloads from `cdn.pixabay.com`, validates bytes and settles unused credits with `/api/media/settle`. When direct mode is unavailable, `browser-offload.ts` / `/api/image` / `/api/image-batch` provide binary or NDJSON delivery. Both paths target the fixed 12-scene plan.
9. **Editor completion.** Successful photo and MP4 assets fill the gallery, object URLs are retained in memory, filenames are deduplicated per video, and Preview / MP4 export use client-side WebCodecs rendering. `apiRenderVideo()` and `/api/render/*` remain as legacy worker-render code, but the static scan found no active call site for `apiRenderVideo`.
10. **Quick Batch flow.** A user adds rows, types or pastes each plain script, and selects style/resolution/orientation. `#batch-generate` runs only prepared, idle `ready`/`queued` rows, not unprepared `staged` rows. `generateBatchRows()` starts up to `BATCH_RUN_CONCURRENCY` rows; `startUnprocessedRows()` has a reentrancy guard and starts later rows as early-stage capacity opens.
11. **Quick Batch pipeline.** Each row proceeds voice → timing → prompts → combined Pixabay media → animation → done. `batchRunPipelineStage()` owns silent non-media retries. Media items use individual retries. `batchRowFinished()` requires `row.mp3`, `row.animated`, exactly 12 images, exactly 12 slides, 4 `video/mp4` clips and 12 unique filenames.
12. **Quick Batch actions.** The last `Actions` column contains Preview, Process Export and Edit. Edit calls `openBatchEditPage()`: it writes a transition-only payload to shared localStorage and a short cookie mirror, then opens a short URL carrying `layout=editor`, `pipelinePage=<targetPageId>` and `projectEdit=<key>`. `applyTransitionProject()` consumes the payload only when `createdAt` matches, forces the editor layout, and assigns `_pipelineVid`. This is the explicit exception to the otherwise-empty new-tab rule.
13. **Secondary flows.** The template composer modal offers 15 interactive scenes, a 3D ring carousel, reel scenes, 13 shape animations and WebCodecs MP4 export. The day-prefixed config page manages themes, backup Workers, relay status, LLM provider config, users, IP credits, payments and CMS. CMS pages are limited to 8 single-level non-reserved URLs. Payment screenshots are uploaded and reviewed through the payment routes.

### Route surface from code

| Group | Routes |
|---|---|
| Public pages | `/`, `/free/`, `/studio/`, `/paid/`, `/account/`, `/upgrade/`, `/signup/`, `/login/`, `/{day}/config/uvxyz`, CMS `/<slug>` |
| Capabilities | `/api/pipeline-capabilities` |
| Session / credits | `/api/session`, `/api/credits`, `/api/login`, `/api/signup`, `/api/logout` |
| Script / notes | `/api/script`, `/api/script?async=1`, `/api/script/notes`, `/api/script/notes/<id>`, `/api/seo-plan` |
| Voiceover | `/api/voiceover` |
| Scene planning / media | `/api/image-prompts`, `/api/image`, `/api/image-batch`, `/api/media/config`, `/api/media/search`, `/api/media/asset`, `/api/media/claim`, `/api/media/settle` |
| Provider endpoints | `https://pixabay.com/api/`, `https://pixabay.com/api/videos/`, `https://cdn.pixabay.com/...` |
| Config / admin | `/api/config/theme`, `/api/config/workers`, `/api/config/users`, `/api/config/ipcredits`, `/api/config/verify`, `/api/config/payment-gateway`, `/api/config/payments`, `/api/config/payments/approve`, `/api/config/payments/image/`, `/api/config/cms`, `/api/config/cms/delete`, `/api/cms/pages` |
| Payments | `/api/payments/upload`, `/api/payments/my`, `/api/payments/image/` |
| LLM / relay | `/api/llm/status`, `/api/llm/config`, `/api/llm/test`, `/api/llm/generate`, `/api/relay/ai`, `/api/relay/ping`, `/api/relay/pool`, `/api/relay/status`, `/api/relay/config`, `/api/relay/test` |
| Worker jobs / legacy render | `/api/render`, `/api/render/<id>`, `/api/worker/poll`, `/api/worker/deliver`, `/api/worker/failed` |

### System rules

1. **Code is the authority.** `src/index.ts` is the Worker entry; `src/client/app-js.ts` is the main browser source of truth. `src/index.ts.original` is not runtime.
2. **Capabilities are version 261.** `/api/pipeline-capabilities` advertises `binaryImages`, `chunkVoiceover`, `singleAttemptScript`, `compactPrompts`, `directMedia`, `apiRelay`, script-note client storage, retry ownership, fixed media caps and Session 331 pipeline-management storage.
3. **No AI-generated images.** `pixabay.ts` states “Pixabay stock media. No AI calls or provider fallback.” The text LLM plans keywords and scripts; it does not generate images.
4. **Fixed 12-scene media cap.** Every automatic video in both layouts has exactly 12 scenes: 4 Pixabay videos and 8 Pixabay photos. `videoScenePositions(12)` returns `[1,4,7,10]`; `imagePromptCountForMinutes()` always returns 12.
5. **Pixabay contract.** `PIXABAY_PER_PAGE = 12`, `PIXABAY_IMAGE_RESULTS = 8`, `PIXABAY_VIDEO_RESULTS = 4`, `PIXABAY_MAX_PAGES = 2`, cache TTL 24 hours, photo limit 8 MiB, clip limit 16 MiB, HTTPS provider/CDN hosts only, magic-byte validation, and a shared 90-request/60-second rate limiter. `/api/media/config` mirrors `perPage: 12`, `imageResults: 8`, `videoResults: 4`.
6. **Script output is plain narration.** Internal SRT cue numbers and timestamps are validation-only; the client never parses subtitle timestamps. Keyword frequency and script validation live in `script-seo.ts`.
7. **Script notes are client-side only.** `script-notes.ts`, `script-notes-api.ts` and `script-notes-client.ts` forbid KV writes for script details. localStorage `ytvs.script-notes.v1` holds up to 24 entries with a 7-day TTL; cookie `ytvs_note` is a compact digest/timestamp/scriptLength mirror. `/api/pipeline-capabilities` sets `asyncScript: 0` and `scriptNoteKvWrites: 0`.
8. **Usage records are advisory.** `usage-ledger.ts` stores per-browser counts in `yvs-usage-261` localStorage and `yvs_usage_261` cookie with a two-day cookie lifetime. It is not an authorization source; `/api/credits` and Worker KV remain authoritative.
9. **Retry ownership is split.** Worker owns planner, voiceover and image-provider ladders outside the Quick Batch browser pipeline. Browser owns script writing, failed Quick Batch non-media stages, and individual failed media items. The Quick Batch budgets are 7 retries with 40,000 ms backoff; media items use the same ladder. Quick Batch retries are silent and preserve earlier successes.
10. **Browser offload is capability-gated.** `browser-offload.ts` accepts only capabilities `version === 261`, uses adaptive concurrency, a reserved control lane, Web Locks, `BroadcastChannel`, cancellation, retry-after backoff and binary `/api/image` delivery. It declares no local/session storage or provider secrets of its own; `pixabay-direct.ts` separately handles the Worker-issued Pixabay config.
11. **Pipeline management is per tab.** `sessionStorage["ytvs.pipeline-page.v1"]` or `?pipelinePage=` defines `pageId`. localStorage uses `ytvs.pipeline-management.v1.<pageId>`; four session cookies use `ytvs_pipeline_management_<pageId>_1..4`. Rows receive `vid = <pageId>-row-<id>`; editor projects receive `_pipelineVid = <pageId>-editor-<n>`.
12. **Pipeline management has no TTL.** Active cookies have no `Max-Age`; `pipelineManagementTtl: 0`. Trust requires the localStorage `updatedAt` to equal the cookie chunk `t` and the FNV digest to match. A mismatch repairs cookies from localStorage. A new page id has no matching stores, so it starts empty.
13. **Edit transition is timestamp-matched.** `openBatchEditPage()` no longer puts full project JSON in the URL and no longer relies on a `noopener` child object. Shared localStorage `MEDIA_TRANSITION_STORAGE_PREFIX + key` plus a `ytvs_transition_project_<key>` cookie must have the same `createdAt`; both are removed after `readTransitionProjectPayload()` verifies them.
14. **Quick Batch completion is strict.** `batchRowFinished()` requires MP3, animation, 12 images, 12 slides, 4 MP4 clips and 12 unique stock filenames. Preview and Export unlock together; the Actions column has no AI enhancer button.
15. **API rotation is scoped.** `api-rotation.ts` rotates only allow-listed AI paths to verified backup Workers with a ticket and `credentials: "omit"`; cookies and non-AI routes stay on the primary origin. `api-relay.ts` rotates the Worker's inference hop while KV, credits, CMS and payments remain local.
16. **Export is client-side in the active Quick Batch path.** `exportBatchRow()` uses browser WebCodecs/MP4 generation. `/api/render*` and `workerRunJob` remain present as legacy worker-job code in `app-js.ts`; no active `apiRenderVideo()` call was found in the static scan.
17. **Admin and standalone pages are separate.** `theme-shell.ts` supports seven themes and reusable CMS links. `cms.ts` limits pages to 8 single-level URLs and reserves app/API paths. `payments.ts` stores gateway metadata, screenshots and transaction verification in KV; admin approval promotes users to `paid_user`.
18. **Template composer is independent.** `template-composer-js.ts` and its scene modules provide interactive scenes, shape animations and WebCodecs MP4 export that can also drop a clip into an accordion gallery. They do not own the 12-scene Pixabay pipeline.
19. **A failed or unverified pipeline save is user-visible.** Partial localStorage/cookie success, a thrown quota error, a rejected cookie chunk or an `updatedAt`/digest mismatch must surface in the alert banner; only a fully verified `saved.ok === true` hides it.
20. **Quick Batch Generate targets `ready` or `queued` only.** A script alone is not enough. Staged, running, retrying, stopped, busy and finished rows are excluded, and the toolbar's ready count is the authoritative affordance.
21. **Reset is destructive by design.** `pipelineManagementStore.clear()` removes this page's localStorage record and four cookie chunks; in-memory rows/queue/active promises are cleared and editor projects receive fresh page-scoped pipeline IDs. It is recovery, not an undo stack.
22. **The store still has no TTL.** The warning/reset path does not add expiry. A new tab gets a new `pageId` and starts empty; stale records for old page IDs are not automatically garbage-collected.

### Observed code-level caveats

- `IMAGE_PROMPT_MAX_TOKENS = 3584` is exported from `image-prompts.ts`, but the active `env.AI.run()` planner call uses `max_tokens: 2048`. The active call is the runtime rule.
- `browser-offload.ts` says it keeps no local/session storage or provider secrets; this is true for that module. `pixabay-direct.ts` deliberately receives a Worker-issued Pixabay key through `/api/media/config` for browser-first provider fetching.
- `wrangler.json` currently contains `PIXABAY_API_KEY` in `vars`; `/api/media/config` returns it only when browser media fetching is enabled.
- Script notes and the usage ledger have their own TTLs; Session 331's pipeline-management store specifically has none.
- `/api/render*` and `/api/worker/*` routes and client helpers remain in the codebase even though the active Quick Batch export path is client-side.
- Support code under `tests/`, `bench/`, `e2e/`, `render-app/` and `simulations/` was inventoried but not treated as runtime authority. No test suite, TypeScript project check, Wrangler dry-run, server preview, commit or push was performed for that static documentation pass; later fix verification is recorded in section 8.7. No commit or push has been made.

## 8. Follow-up fixes: visible storage recovery and Ready-only Generate

This section documents the two fixes requested after broken-code and syntax audits. It is derived from the current code, not from past rules Markdown.

### 8.1 Request and acceptance criteria

Verbatim request:

> Clear fix this Storage failures are silently swallowed — low/medium persistPipelineManagementState() catches all errors and only writes window.__PIPELINE_MANAGEMENT_SAVE__. There is no user-visible warning and no recovery UI. pipelineManagementStore.clear() exists but is not wired to any reset action For number two the generate button will work for video rows that is ready to be generated not on those unprepared staged Explain all these remaining problems in technical and another oversimplified versiin for newbie devs

Acceptance criteria:

1. A failed or unverified pipeline-management save must be visible to the user.
2. A recovery/reset UI must call `pipelineManagementStore.clear()`.
3. Generate must start only rows marked ready/queued and leave staged, running, retrying, stopped, busy, finished or unprepared rows unchanged.
4. The problems must be explained in technical language and in an oversimplified newbie-dev version. Section 8.6 also records the loose ends that remain.

### 8.2 Files changed

| File | Fix |
|---|---|
| `src/client/markup.ts` | Adds hidden `#pipeline-storage-alert` banner with `role="alert"`, `aria-live="assertive"`, `#pipeline-storage-message` and `#pipeline-storage-reset`. |
| `src/client/app-js.ts` | Adds `pipelineStorageFailureText()`, `showPipelineStorageWarning()`, `hidePipelineStorageWarning()`, `resetPipelineManagementState()`, window recovery hooks, `BATCH_GENERATABLE_STAGES`, `batchRowReadyForGeneration()`, ready-only `generateBatchRows()`, ready-count toolbar, reset-button binding. |
| `tests/final-media-cap-actions.test.mjs` | Adds a simulated localStorage quota failure, visible-warning/reset test, and staged-row refusal test. |
| `tests/quick-batch-table.test.mjs` | Aligns toolbar expectations with `N rows · M with a script · R ready` and disabled Generate when no rows are ready. |
| `bug-fix-session-331.md` | This documentation section, updated purpose, resolved hanging item 10, validation note and system rules 19–22. |

### 8.3 Fix 1 — storage failures are visible and recoverable

#### Before

`persistPipelineManagementState()` caught write/verification errors, attached `window.__PIPELINE_MANAGEMENT_SAVE__`, and continued silently. `pipelineManagementStore.clear()` existed but had no caller in the UI.

Failure classes included:

- `localStorage.setItem()` quota/security exceptions;
- `save()` returning `ok: false` because localStorage, cookie chunks or timestamp/digest verification failed;
- a thrown exception before a debug result could be recorded.

#### Current save path

`persistPipelineManagementState(reason)`:

1. returns early while `pipelineManagementSaving` or `pipelineManagementRestoring` is true;
2. calls `pipelineManagementStore.save(pipelineManagementSnapshot())`;
3. on `saved.ok === true`, calls `hidePipelineStorageWarning()`;
4. otherwise calls `pipelineStorageFailureText(saved, null)` and `showPipelineStorageWarning(detail)`;
5. logs `[pipeline-storage] save was not verified` to `console.warn`;
6. records `saved.reason` and still writes `window.__PIPELINE_MANAGEMENT_SAVE__`;
7. in the `catch` branch, builds an error-specific message and shows the same warning.

`pipelineStorageFailureText()` distinguishes an unknown failure, `saved.reason`, `localStorage === false`, `cookies !== cookieCount`, and `timestampMatched === false`.

#### Current recovery UI

`showPipelineStorageWarning(detail)`:

- sets `window.__PIPELINE_MANAGEMENT_WARNING__ = { visible: true, detail }`;
- writes a concrete message into `#pipeline-storage-message`;
- reveals `#pipeline-storage-alert`, sets `data-state="error"`;
- falls back to `console.warn` and `showRequiredModal([text])` if the banner nodes are absent.

`#pipeline-storage-reset` is bound in `bindStudioShell()` to `resetPipelineManagementState()`. That function:

1. calls `pipelineManagementStore.clear()`;
2. clears `window.__PIPELINE_MANAGEMENT_STATE__`, `__PIPELINE_MANAGEMENT_SAVE__` and `__PIPELINE_MANAGEMENT_LOAD__`;
3. resets saving/restoring flags;
4. empties `batchRows`, `batchQueue`, `batchAttemptedRows` and `batchActivePromises`, and clears `batchRunBusy`/`batchFinishedCount`;
5. resets editor `_pipelineVid` values and active-flow flags;
6. hides the warning;
7. re-renders the table and persists a fresh `"storage-reset"` snapshot;
8. records `window.__PIPELINE_MANAGEMENT_RESET__`.

`window.resetPipelineManagementState` and `window.__PIPELINE_MANAGEMENT_STORE__` are exposed for deterministic recovery. Reset is destructive recovery, not undo: it throws away the broken saved management state for this page.

### 8.4 Fix 2 — Generate is readiness-gated

`src/client/app-js.ts` now declares:

```text
BATCH_GENERATABLE_STAGES = ["ready", "queued"]

batchRowReadyForGeneration(row) =
  row exists
  AND batchRowHasScript(row)
  AND !batchRowFinished(row)
  AND !row.running
  AND !row.retrying
  AND !row.stopRequested
  AND !batchRowBusy(row)
  AND BATCH_GENERATABLE_STAGES.includes(row.stage)
```

Wiring:

- `batchRowPending()` returns `batchRowReadyForGeneration(row)`.
- `generateBatchRows()` builds `targets` with `batchRows.filter(batchRowReadyForGeneration)`.
- `startUnprocessedRowsBody()` harvests only pending rows.
- If no targets exist, `generateBatchRows()` shows a required-modal explanation. It distinguishes “every scripted row is already finished” from “Generate starts only rows marked Ready; staged, running, retrying, stopped or unfinished rows are left unchanged.”
- `updateBatchToolbar()` counts `scripted` and `runnable`, writes `N rows · M with a script · R ready`, labels Generate with the ready count, and disables `#batch-generate` / `#top-generate` when `runnable === 0`.
- A row with a script but stage `staged` is no longer queueable.

Excluded states: no script, `staged`, `running`, `retrying`, `stopRequested`, `busy`, `finished`, or any stage outside `ready`/`queued`.

### 8.5 Oversimplified version for newbie devs

1. **Storage:** before, the app failed to save the table's state and shrugged. Now a big orange warning says “I could not save this”, and **Reset pipeline state** throws away the broken saved state and starts clean. Alarm = warning banner; clean slate = `clear()`.
2. **Generate:** before, the button could grab any row with a script, even if it was only sitting on the workbench. Now it grabs only rows with a green **READY** sticker. Staged, cooking, being fixed, stopped, busy and finished rows stay where they are. Script alone is not enough.
3. **Reset warning:** the reset button is a fire extinguisher, not a time machine. It clears saved state; it does not restore an older version.

### 8.6 Remaining problems

The two named problems are fixed. These loose ends from the earlier code audit remain:

1. **No outer retry deadline.** `1 + 7` attempts with 40,000 ms backoff can exceed 280 seconds plus request time, and a never-settling request can pin a row silently.
2. **`generateBatchRows()` waits on `Promise.all()` in a `while` loop.** There is no global timeout for the generation pass.
3. **Web Locks and progressive loops use `for (;;)`.** Some wait loops have no deadline and rely on an external condition eventually changing.
4. **Persistence remains event-driven, not transactional.** Eleven explicit `persistPipelineManagementState()` call sites cover layout, Edit handoff, table render, batch stage, editor start/finalize, transition apply, startup, beforeunload and reset. A mutation that bypasses those hooks or crashes before one is not durably captured. The new warning detects save failure; it does not make all mutations atomic.
5. **No TTL means stale page records accumulate.** This is intentional under the no-TTL directive, but old `pageId` localStorage keys/cookies are not garbage-collected. Duplicated tabs can also clone `sessionStorage` page IDs unless the URL supplies `?pipelinePage=`.
6. **Dormant legacy render/worker code remains.** `/api/render*`, `/api/worker/*` and `apiRenderVideo()` are still present although active Quick Batch export is client-side WebCodecs.
7. **Token constant mismatch persists.** `IMAGE_PROMPT_MAX_TOKENS = 3584` is exported, but the active `env.AI.run()` planner uses `max_tokens: 2048`.
8. **Validation debt persists.** Full suite has 40 pre-existing failures and 6 cancellations; `tsc --noEmit` has 30 diagnostics. No new failures were introduced relative to HEAD.
9. **Legacy mocks still assume older media plans.** Strict `batchRowFinished()`, fixed 12/4/8 media and `[1,4,7,10]` positions conflict with older expectations such as `[2,5,7,10]` or `[1,8]`.

Oversimplified: the cook can still retry too long, the waiter can still wait forever, old order slips pile up, an old oven remains wired up, the recipe card disagrees with the cook, and the old checklist still has red marks. What changed is that a broken order pad now sounds an alarm, and the oven now refuses unprepared trays.

### 8.7 Short simulation, debug and validation

`node --import tsx simulations/pipeline-management.mjs` exits 0 and prints:

```text
[debug] page A { pageId: 'p_pagea_1', ttl: 0 }
[debug] save {
  ok: true, localStorage: true, cookies: 4, cookieCount: 4,
  timestampMatched: true, digest: '1k5jlyv',
  updatedAt: 1730000000000, videoIds: 5,
  cookieMaxValue: 3800, ttl: 0
}
[debug] cookie chunks { count: 4, maxValueLength: 1018, limit: 3800 }
[debug] cookie-only full restore { source: 'cookies', rows: 3, projects: 2, videoIds: 5 }
[debug] timestamp mismatch { source: 'localStorage', repairedCookie: true, repaired: true }
[debug] new tab { pageId: 'p_pageb_1', rows: 0, projects: 0, videoIds: 0 }
```

Fix verification:

```text
tests/final-media-cap-actions.test.mjs   8/8 pass
tests/quick-batch-table.test.mjs         14/14 pass
full npm test                            514 tests / 468 pass / 40 fail / 6 cancelled
vs HEAD                                  0 new failures; 15 HEAD failures removed
npx tsc --noEmit                         30 diagnostics, identical to HEAD
wrangler deploy --dry-run                exit 0
syntax audit                             107 TS/JS parse, 0 problems
                                         15 generated JS strings, 0 problems
APP_JS syntax                            OK 619809
node --import tsx simulation             exit 0
git diff --check                         clean
```

The JSDOM tests simulate a `Storage.prototype.setItem` quota failure, visible warning, successful reset, staged-row refusal and ready-row generation. They are logical simulations, not a real-browser quota or multi-tab cookie test. The full suite is not green; “no new failures” is a comparison against HEAD, not a claim that all tests pass.

### 8.8 Status

- Documented on branch `arena/2b49505f-text-to-image-template`.
- `bug-fix-session-331.md` is the documentation target.
- `git diff --check` is clean; `git status` still shows the existing working-tree changes.
- **No commit, push, merge, branch switch or PR was made.**
