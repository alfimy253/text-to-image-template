# Bug Fix Session 331 — Browser-owned pipeline management storage

Date: 2026-11-04
Branch: `arena/2aa7ded8-text-to-image-template` (active Arena task branch)
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

The active Quick Batch handoff is now the timeline route (the earlier editor-page implementation was superseded by Section 9):

- the giant inline `projectJson` query remains removed
- the URL carries `layout=timeline`, a stable `pipelinePage=<timeline-project-id>` for the row, and `projectEdit=<key>`
- the transition-only payload, including the small scene/timing description, stays in shared localStorage under `MEDIA_TRANSITION_STORAGE_PREFIX + key`
- a short cookie mirror carries `createdAt`, source/target IDs and the row vid
- large scene/audio `Blob`s travel through IndexedDB, never through localStorage or the URL
- no `child.__TRANSITION_PROJECT__` assignment is attempted
- `readTransitionProjectPayload()` accepts the payload only when localStorage `createdAt` matches the cookie mirror `createdAt`; both handoff entries are consumed
- `applyTransitionProject()` activates the timeline and returns before creating a `videoProjects` editor project or persisting pipeline-management state

Explanation: a child window object is not dependable for a new tab, so the short URL plus timestamp-matched localStorage/cookie handoff is used. Timing itself is stored separately under the stable row-specific timeline key, allowing Edit to reopen the row's prior timing without importing pipeline-management UI/state.

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

Pipeline-management pages still use a per-tab page id and page-scoped storage as described here. The active Quick Batch Edit route is a deliberate exception for timeline timing:

- the pipeline-management store can resolve its page id from `sessionStorage["ytvs.pipeline-page.v1"]` or a URL `pipelinePage` value
- regular pipeline-management snapshots use `ytvs.pipeline-management.v1.<pageId>` plus four page-scoped cookies
- Quick Batch rows on the source table keep their page-scoped `vid`; existing Editor projects keep `_pipelineVid`
- Quick Batch Edit now uses `targetPageId = timeline-<sourcePageId>-row-<rowId>` as the timeline project's stable localStorage/IndexedDB key; it does not call `freshPageId()` for this route
- the timeline page does not restore or persist a pipeline-management snapshot, and it creates no editor project/vids
- the stable timeline ID is intentional so re-opening Edit for the same row restores timing; it does not imply that pipeline-management data is shared between tabs

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
13. **Edit transition is timestamp-matched.** `openBatchEditPage()` no longer puts full project JSON in the URL and no longer relies on a child-window object. Shared localStorage `MEDIA_TRANSITION_STORAGE_PREFIX + key` plus a `ytvs_transition_project_<key>` cookie must have the same `createdAt`; both are removed after `readTransitionProjectPayload()` verifies them. The active Edit target is `layout=timeline`; see Section 9 for its stable row-scoped local timing store and IndexedDB-only Blob transfer.
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

- The original Session 331 storage work was recorded on `arena/2b49505f-text-to-image-template`; the active timeline follow-up is on `arena/2aa7ded8-text-to-image-template`.
- `bug-fix-session-331.md` is the documentation target.
- `git diff --check` is clean; `git status` still shows the existing working-tree changes.
- **No commit, push, merge, branch switch or PR was made.**

## 9. Quick Batch timeline-editor follow-up

This section records the active follow-up request and supersedes the earlier `layout=editor` description in Sections 4.4 and 4.6. Current code plus this section are authoritative; other Markdown files in the repository are stale for this task.

### 9.1 Request and acceptance criteria

The Quick Batch row's Edit action opens a new browser page/layout with:

- a preview on the left at about 30% of the page width and selected-element controls on the right;
- a Canva-like timeline dock along the bottom, focused on changing/extending scene and element durations;
- the visible arrangement starts with one shared text/graphics lane stacked above the pinned background/media lane; there is no separate overlay lane;
- Soundtrack is collapsed initially and contains three audio lanes (voiceover, sound effects and background music) when expanded. Users can add text/graphics lanes up to four total; text and graphics share each lane;
- client-side JavaScript/CSS only for timeline behavior: no server computation and no pipeline-management UI/state in the timeline;
- browser localStorage timing data per scene and per element;
- inspector controls reused from the inner scene editor of the existing Add video from template modal.

### 9.2 Active route and isolation

- Quick Batch Edit sets `layout=timeline`, `pipelinePage=<stable row-specific id>` and the short timestamp-matched `projectEdit` handoff key.
- The stable project ID is `timeline-<sourcePageId>-row-<rowId>`, so reopening Edit for a row recovers its timeline instead of creating a different timing key each time.
- `applyTransitionProject()` activates `#view-timeline`, exposes `#studio-app`, hides the landing/table/editor views and returns before creating a `videoProjects` editor project.
- The timeline startup branch skips `initVideoStudio()`, `bindStudioShell()`, `restorePipelineManagementState()`, pipeline-management persistence/listeners, landing action binding and auth initialization. The timeline module is an independent client layout; it does not run a Quick Batch generation, Worker, export or pipeline-management operation.
- `src/client/template-scene-editor.ts` exposes the existing text/range/select/checkbox/color inspector builders through `window.__REEL_SCENE_CONTROL_UI__`; its color palette is scoped to the active template-modal or timeline root.

### 9.3 Layout and track behavior

- `#view-timeline` is a separate view in `src/client/markup.ts`; `src/client/styles.ts` gives the preview/inspector workspace an approximately 30/70 split and places the horizontally scrollable track dock at the bottom.
- At boot, `normalizeState()` creates five state tracks: three audio lanes, one background-media lane and one shared text/graphics lane. The visible dock order is background media, text/graphics, then the collapsed Soundtrack group; expanding Soundtrack reveals its three audio lanes. Users can add visual lanes up to four total. **Superseded by Section 10.2:** the dock order is now text/graphics lanes first and the background-media lane pinned last (it is the lowest canvas layer, and the Pixabay images always live in it).
- Text and graphic clips share the same visual lane type. A migration folds legacy dedicated text tracks into the first shared lane and keeps their clips; existing visual/overlay-lane clips are retained as visual clips, not presented as a separate overlay lane.
- Media uploads fill empty scene placeholders first and append only after those are used. Media timing remains scene-based: extending or shortening a background scene ripples following scene starts and moves elements associated with that scene. Audio and visual-clip start/duration values remain independently editable in seconds.
- Text and graphic clips use absolute timeline seconds and may span multiple background-media scenes. The canvas renders active visual clips by their timeline ranges rather than gating them to the current scene, so text/graphics stay visible as the playhead crosses media boundaries. Existing template scene inspector controls remain available for editing their appearance.
- The canvas previews local images/GIFs/MP4s and timed text/graphics. localStorage holds timing/project metadata only; media bytes remain in IndexedDB.

### 9.4 Timing persistence and media handoff

- localStorage key: `ytvs.timeline-editor.v1.<timelineProjectId>`.
- The stored versioned state includes `durationSec`, `playheadSec`, `scenes[]` and `tracks[]`; each scene includes `startSec`, `durationSec`, media metadata and `elements[]`; every track item stores its own ID, start, duration, kind and selected visual/audio controls.
- Quick Batch builds the initial 12-scene timeline from its current slides, media, audio duration and subtitle cue start/end times. Subsequent edits update the corresponding scene and element timing before local persistence.
- Large Blob values (Pixabay media and voiceover) cross tabs through IndexedDB database `ytvs-timeline-editor-assets-v1`, object store `projects`, keyed by the stable timeline project ID. localStorage contains timing/metadata only.
- The timeline page waits briefly for the opener's IndexedDB write and then registers browser object URLs for preview. If a Blob cannot be transferred, timing still works and the page offers local file upload.

### 9.5 Files changed for the follow-up

| File | Change |
|---|---|
| `src/client/app-js.ts` | Builds the 12-scene handoff with three audio tracks, one background-media track and one shared text/graphics track; uses a stable row ID, transfers Blobs through IndexedDB, routes Edit to `layout=timeline`, and bypasses pipeline/video-studio startup on that route. |
| `src/client/markup.ts` | Adds the timeline page scaffold and script placeholder; updates the Quick Batch Edit hint. |
| `src/client/styles.ts` | Adds isolated responsive preview/inspector/timeline styling with a 30/70 workspace split. |
| `src/client/timeline-editor.ts` | Adds the client-only track UI, canvas preview, timing inspector, accordion controls, localStorage model and IndexedDB media bridge. |
| `src/client/template-scene-editor.ts` | Exposes the reusable inspector helpers and scopes the color picker to the active editor root. |
| `src/page.ts` | Imports and injects the timeline client script. |
| `tests/final-media-cap-actions.test.mjs` | Updates the Edit handoff contract for `layout=timeline` and stable per-row timing IDs. |
| `tests/timeline-editor.test.mjs` | Covers route isolation, the two initially visible lanes, collapsed Soundtrack, four-lane cap, legacy track migration, cross-scene visual timing, IndexedDB Blob transfer, reopen persistence, scene ripple behavior and layout split. |
| `bug-fix-session-331.md` | This section; it is the sole documentation target for the timeline follow-up. |

### 9.6 Validation status for the timeline follow-up

Validation completed for the corrected timeline track model:

```text
focused Quick Batch/timeline tests             29/29 pass
full npm test                                  521 total / 475 pass / 40 fail / 6 cancelled
baseline at HEAD (Section 8.7)                514 total / 468 pass / 40 fail / 6 cancelled
comparison                                     7 additional passes; failure/cancellation counts unchanged
npx wrangler deploy --dry-run                  exit 0; 2890.14 KiB (1332.19 KiB gzip)
npx tsc --noEmit --pretty false                30 diagnostics, all in src/index.ts
new timeline/app/page files                    no TypeScript diagnostics
JSDOM route and generated client scripts       parse and execute in focused tests
local Wrangler route check                    HTTP 200 for /free?layout=timeline&pipelinePage=timeline-preview-row-1
git diff --check                               clean
```

The full suite remains non-green. Its failure/cancellation totals match the Section 8.7 baseline; exact failure identities were not compared. All 29 focused Quick Batch/timeline tests pass, including legacy-track migration, four-lane cap, text and graphic preview across media-scene boundaries, IndexedDB Blob transfer, and row reopen persistence. The reopen test seeds `ytvs.timeline-editor.v1.<targetPageId>` after the transition-project localStorage entry. JSDOM plus an in-memory IndexedDB test validates Blob handoff and storage separation; the local route check is not a real-browser media-decoding test. No server-side timeline computation was added.

## 10. Background-layer timeline and Min-column removal (active request)

This section records the newest request on branch `arena/16e873bd-text-to-image-template`. It supersedes Section 9.3 for lane order and layer ownership, and it supersedes Section 9.1 / the Quick Batch column list wherever a "Min" column is still described. **The current code in this workspace is the source of truth**; older prose is only history.

The request, verbatim:

> Study code and the #331 md file make the code the source of truth and adjust the timeline layout.... the pixabay images must be in the background layer......edit doc #331 md file about this.......then remove minute column in the rows of table layout then document this request in 331 md then fix whats left to fix. In 331 md file

### 10.1 Code study that drove the two changes

Read from code, not from prose:

| Question | Answer found in code (before this section) |
|---|---|
| Where do Pixabay images live? | `batchTimelineState()` in `src/client/app-js.ts` builds one `background-media` track (`kind: "media"`) with 12 items, one per scene, `assetId: "scene-<n>"`. |
| Is that track really the bottom layer? | The canvas drew media first, but nothing in the model or the dock *said* so. `drawPreview()` had no layer vocabulary, any saved `kind: "media"` lane was rendered as another lane, and the dock listed the media lane **above** the text/graphics lanes - reading top-down, that looks like media sits on top. |
| What did `normalizeState()` do with a stray media lane? | Nothing. A saved project with `background-media` **and** a second `kind: "media"` track rendered both, in arbitrary order. |
| Where did row length come from? | `batchRunVoiceStep()` measures the decoded MP3 (`decodeBatchAudio`) and that value drives the slides; `row.minutes` was only the fallback (`measuredMs \|\| row.minutes * 60 * 1000`). |
| What was the `Min` column? | `src/client/markup.ts` `<th class="batch-col-min">Min</th>` plus a `batch-cell-min` `<td>` with `input.batch-minutes-input[data-batch-field="minutes"]` in `batchRowHTML()`, styled by 6% of the fixed table layout. |

So the two requests are consistent with the code: the Pixabay lane already **was** the paint background, it just was not modelled, labelled or ordered as one; and the typed `Min` column was a redundant input because the narration already sets the real length.

### 10.2 Change 1 - Pixabay images are the background layer

`src/client/timeline-editor.ts`

- New module constants: `MEDIA_TRACK_ID = "background-media"`, `MEDIA_TRACK_LABEL = "Pixabay & uploaded media · background"`, `MEDIA_TRACK_NAME = "BACKGROUND"`. Every media lookup (default state, normalisation, `mediaTrack()`, dock rendering, selection) now resolves through them, so "which lane are the Pixabay images in?" has exactly one answer.
- The background track is stamped `layer: 0` in `defaultTimeline()` and in `normalizeState()`.
- `normalizeState()` now collects every **stray** `kind: "media"` track (an older second Pixabay lane, an imported-clip lane, an overlay media lane) and folds its clips into the single background lane by id. Nothing is dropped and two competing backgrounds are impossible.
- Dock order changed to match the paint stack. The dock now reads top-down as the canvas stacks top-down:
  1. `TEXT & GRAPHICS` group title, `＋ Text` / `＋ Graphic`, then every visual lane (up to four);
  2. `BACKGROUND LAYER` group title (`pinned lowest · Pixabay, GIF, image or MP4`, `＋ Add media`), then the single background-media lane. Its label carries a `BG` badge and its `<small>` count.
  The background lane is last in the DOM, always `data-lane-track="background-media"`, and carries `te-background-lane`.
- `drawPreview()` is now explicitly layered: `/* Layer 0 — the background layer … */` draws the Pixabay image/GIF/MP4 (or the placeholder), then `/* Layers 1..4 — every text and graphic clip … */` runs `visualTracks().forEach(...)`. No media clip can be drawn by the visual loop, so text/graphics can never be hidden under a photo by accident.
- The placeholder frame prints a second line: `Background layer · text and graphics paint above it`.
- Inspector and status copy now name the layer ("…share the one background layer. It is pinned below every text and graphic clip.", "…to the background layer.").

`src/client/app-js.ts` (handoff hardening, same request - "fix what's left to fix")

- `openBatchEditPage()` now allocates the IndexedDB asset key with a `usedBackgroundKeys` set instead of `"scene-" + (index + 1)` blindly. The timeline has exactly one background layer keyed by scene id, so a duplicate row index previously overwrote an earlier Blob. Both Blobs now transfer.

`src/client/styles.ts`

- `.te-group-background` / `.te-group-fill-background` use a green-tinted panel, `.te-track-label.te-track-background` a tinted label, `.te-lane.te-background-lane` a tinted lane grid and `.te-track-badge` the small `BG` chip. The tint is the visual promise that the lane cannot be reordered above a text lane.

`src/client/markup.ts`

- The inspector hint and the dock footer now state the layer contract: text and graphics stack above the pinned background layer that holds every Pixabay image, GIF and upload.

### 10.3 Change 2 - the `Min` column is removed from the table

`src/client/markup.ts`

- `<th class="batch-col-min">Min</th>` is deleted. The header is now `Script · Video style · Resolution · Orientation · Actions`.
- The Quick Batch hint no longer says "the minimum minutes", and the comment block above `#view-table` documents the five remaining columns and records that `Min` is gone.

`src/client/app-js.ts`

- `batchRowHTML()` no longer renders `<td class="batch-cell batch-cell-min">` or the `input.batch-minutes-input`.
- `row.minutes` **is still part of the row model** (default `BATCH_MIN_MINUTES = 1`, clamped 1-6) because it is the silent fallback used when `decodeBatchAudio()` reports no duration. It is never rendered, and `syncBatchRowsFromDom()` keeps a defensive lookup so a cached older markup cannot lose a typed value.
- The module-1c column comment now lists four input columns plus Actions and explains that the measured narration, not a typed minute count, sets the row length.

`src/client/styles.ts`

- `.batch-col-min`, the `.batch-minutes-input` width rule and the `.batch-minutes-input` entry in the shared input rule are deleted.
- Widths rebalanced for five columns: script `40%` (was 34%), style `15%`, resolution `10%`, orientation `12%`, actions `23%` - 100%. Table `min-width` drops from `880px` to `820px`.

### 10.4 Behaviour that deliberately did not change

- `AUTO_MEDIA_TOTAL = 12`, 8 photos + 4 clips, `[1,4,7,10]` video positions and the two-call resolution/orientation contract are untouched.
- The 12-scene timing handoff, the stable per-row timeline project id, IndexedDB Blob transfer, the localStorage timing schema (`ytvs.timeline-editor.v1.<projectId>`) and the four-lane visual cap are untouched.
- No server route, Worker module, KV key or cookie schema was added or changed. Timeline editing remains client-only.
- A finished row still uses the measured voiceover length; a row that fails to decode still falls back to 1 minute (previously the user could raise that to 6 - the field is now gone, so the fallback is always `BATCH_MIN_MINUTES`).

### 10.5 Tests updated for the two changes

| Test file | Change |
|---|---|
| `tests/timeline-editor.test.mjs` | Lane order assertions flipped: the shared text/graphics lane now comes **before** `background-media`, which must be the last visible lane. New test *"Pixabay media is the one pinned background layer and every stray media lane is folded into it"* seeds a project with `background-media` + `overlay-media`, then asserts one media track, `layer === 0`, 12 clips preserved, `te-background-lane`, the `BACKGROUND … pinned lowest` heading and one `BG` badge. New test *"the preview canvas paints the background layer before text and graphics"* asserts the `Layer 0` / `Layers 1..4` order inside `drawPreview()` and that `mediaTrack()` resolves through `MEDIA_TRACK_ID`. |
| `tests/quick-batch-table.test.mjs` | Column list is now `Script · Video style · Resolution · Orientation · Actions`, and the file asserts `>Min<`, `batch-col-min` and `batch-minutes-input` are **absent** from the served markup. |
| `tests/session-244.test.mjs` | Fixed-layout test checks the five surviving `batch-col-*` classes and asserts `.batch-col-min` has no styling left. |
| `tests/final-media-cap-actions.test.mjs` | New test *"duplicate row media indices still reach the background layer as distinct scene keys"* drives the real Edit button and asserts two Blobs transfer as two distinct background keys. |
| `tests/final-media-cap-actions.test.mjs` | New test *"duplicate row media indices still reach the background layer as distinct scene keys"*: two row images with `index: 0` must transfer as `scene-1` + `scene-2`, neither dropped. |

### 10.6 Short simulation and debug

Static parse of the two generated client bundles:

```text
APP_JS              parses OK 628458 chars
TIMELINE_EDITOR_JS  parses OK 76663 chars
APP_CSS             487637 chars
```

Logic walk-through of the new layer model (no browser needed):

```text
mount layout=timeline (row 7)
  normalizeState(saved)
    fixed tracks        voiceover, sound-fx, background-music, background-media(layer 0)
    stray media lanes   overlay-media -> folded into background-media by item id
    visual lanes        visual-1 .. visual-4 (max 4)
  dock (DOM order)      TEXT & GRAPHICS group, visual-1..4, BACKGROUND LAYER group, background-media
  canvas paint order    Layer 0 background-media  ->  Layers 1..4 visual clips
  upload a photo        addMediaFiles() fills an empty placeholder first, else appends
                        -> still background-media, still layer 0
```

JSDOM walk-through of a seeded handoff (two normal media items plus one stray `overlay-media` lane and one caption), printed from the rendered dock:

```text
media tracks: [ 'background-media (layer 0, 3 clips)' ]
--- dock, in DOM order ---
GROUP: TEXT & GRAPHICS 1 / 4 lanes · above the background
  LABEL: Text & graphics 1 1 clip | te-track-label
  LANE : visual-1 | te-lane te-visual-lane | clips: 1
GROUP: BACKGROUND LAYER pinned lowest · Pixabay, GIF, image or MP4 + Add media
  LABEL: Pixabay & uploaded media · background BG 3 scenes | te-track-label te-track-background selected
  LANE : background-media | te-lane te-media-lane te-background-lane | clips: 3
GROUP: > Soundtrack 3 tracks
--- background lane clips ---
  garden.jpg · 0:00 · 0:20
  river.mp4 · 0:20 · 0:20
  stray.mp4 · 0:30 · 0:05
```

Served Quick Batch table, same JSDOM boot:

```text
header: Script | batch-col-script
        Video style | batch-col-style
        Resolution | batch-col-resolution
        Orientation | batch-col-orientation
        Actions | batch-col-actions
cells : batch-cell-script, batch-cell-style, batch-cell-resolution,
        batch-cell-orientation, batch-cell-action
minutes inputs in row: 0
row.minutes in model : 1
column count th/td   : 5 / 5
```

What those two dumps prove: the stray `overlay-media` lane is gone (one media track only), its clip arrived as the third background clip, the background lane is the **last** lane in the dock and the only one wearing `te-background-lane`, and the served table row has five cells with no minutes input while the model still carries `minutes: 1`.

### 10.7 Validation

```text
tests/timeline-editor.test.mjs          9/9 pass    (7 before, +2 new layer tests)
tests/quick-batch-table.test.mjs       14/14 pass
tests/session-244.test.mjs              8/10 pass   (2 failures identical at HEAD)
tests/final-media-cap-actions.test.mjs  9/9 pass    (8 before, +1 duplicate-index test)
focused total (those four files)       42 total / 40 pass / 2 fail
full npm test                          524 total / 478 pass / 40 fail / 6 cancelled
HEAD baseline (stashed tree, same run)  521 total / 475 pass / 40 fail / 6 cancelled
failure-identity diff vs HEAD           identical set - no new failures, 3 new passes
npx tsc --noEmit --pretty false        30 diagnostics, all src/index.ts (identical to HEAD)
npx wrangler deploy --dry-run          exit 0
bundle parse check (new Function)      APP_JS + TIMELINE_EDITOR_JS parse OK
served route (worker.fetch, no network) HTTP 200 on layout=timeline and layout=table
git diff --check                       clean
```

Notes on honesty of that table:

- The suite is **not green** and was never green at HEAD. The 40 failures / 6 cancellations are the pre-existing Pixabay, relay, image-batch and e2e groups already listed in Section 8.6. The comparison is by failure identity against a stashed copy of the HEAD tree, not a claim that every test passes.
- `npx wrangler dev` could not boot in this sandbox: it needs a remote proxy session and a `CLOUDFLARE_API_TOKEN`, which is not available here (the failure is `Failed to start the remote proxy session`). The route check was therefore done by importing the Worker default export and calling `worker.fetch()` directly for `/free?layout=timeline&…` and `/free?layout=table`. Both answer **200**, serve exactly five `batch-col-*` classes, contain no `>Min<` header and no `batch-minutes-input`, and contain the `BACKGROUND LAYER … pinned lowest` copy. That validates the served HTML, not a browser render.
- The layer behaviour is validated by JSDOM plus a source-order assertion inside `drawPreview()`. No real-browser canvas, IndexedDB decode, or screenshot of the new dock tint was captured.

### 10.8 What else was fixed, and what is still left to fix

Fixed while doing "fix what's left to fix":

1. **Duplicate media indices overwrote a background clip.** `openBatchEditPage()` mapped every row image to `"scene-" + (index + 1)`, so two images reporting the same `media.index` collapsed onto one background key and the second Blob overwrote the first in IndexedDB. The handoff now walks a `usedBackgroundKeys` set and moves a duplicate to the next free slot. Guarded by *"duplicate row media indices still reach the background layer as distinct scene keys"* in `tests/final-media-cap-actions.test.mjs` (two `index: 0` images arrive as `scene-1` + `scene-2`).
2. **A stray media lane could compete with the background.** Covered in 10.2: `normalizeState()` folds any extra `kind: "media"` track into the single background lane instead of rendering both.
3. **The two client bundles were re-checked for syntax** after the edits (APP_JS 628,458 chars, TIMELINE_EDITOR_JS 76,663 chars, both parse).

Still open:

1. **No visual confirmation in a real browser.** The dock tint, the `BG` badge and the "background layer" placeholder line are styled and asserted statically; they were not eyeballed in Chrome/Safari at 100% and 125% zoom, and `wrangler dev` cannot boot in this sandbox (no `CLOUDFLARE_API_TOKEN`), so the route check is `worker.fetch()` rather than a served preview.
2. **The removed minute field leaves no way to lengthen a silent row.** If `decodeBatchAudio()` returns nothing, a row falls back to `BATCH_MIN_MINUTES = 1` and the UI can no longer raise it. Options if that matters: derive it from the script word count, or expose the value in the timeline inspector instead of the table.
3. **`row.minutes` is now non-editable UI state.** It is still in the pipeline-management snapshot, the Edit handoff (`basicSettings.minutes`) and the prompt request body, so it survives reloads at `1` (or an older saved value) and can drift from the measured narration. It is consistent, just not user-editable.
4. **Legacy markup tolerance.** `syncBatchRowsFromDom()` keeps a `[data-batch-field="minutes"]` lookup purely for a cached older client bundle. Delete it once no cached bundle can be in the wild.
5. **`layer: 0` is metadata, not a reorder control.** The background track stores `layer: 0` and is always rendered last, but there is no drag-to-reorder in the dock at all, so no other lane can be dragged under it. If lane reordering is ever added, it must keep the media lane pinned.
6. **The suite is still not green.** 40 failures / 6 cancellations are pre-existing (Section 8.6: no outer retry deadline, non-transactional persistence, dormant `/api/render*` code, `IMAGE_PROMPT_MAX_TOKENS` mismatch with `max_tokens: 2048`, stale legacy mocks; and Section 9.6: no real-browser media decode test). This section added no new failures.

### 10.9 Files touched in this section

| File | Change |
|---|---|
| `src/client/timeline-editor.ts` | Background-layer constants, `layer: 0`, stray-media folding, dock reorder (visuals above, background pinned last), explicit `Layer 0` / `Layers 1..4` painting, `BG` badge, layer copy in the inspector and placeholder. |
| `src/client/styles.ts` | Background-lane tint, group/label/lane/badge classes; `Min` column width and `.batch-minutes-input` rules removed; five-column widths; table `min-width` 880 → 820 px. |
| `src/client/markup.ts` | `Min` header removed, Quick Batch hint and comment block rewritten for five columns, timeline hint and dock footer describe the background layer. |
| `src/client/app-js.ts` | `batch-cell-min` cell and its minutes input removed from `batchRowHTML()`, defensive DOM sync kept, module-1c column comment rewritten; `openBatchEditPage()` allocates duplicate-safe background keys through `usedBackgroundKeys`. |
| `tests/timeline-editor.test.mjs` | Lane-order expectations flipped, two new background-layer tests. |
| `tests/quick-batch-table.test.mjs` | Five-column expectation plus explicit absence checks for `Min`. |
| `tests/session-244.test.mjs` | Fixed-layout test updated for five columns. |
| `tests/final-media-cap-actions.test.mjs` | New duplicate-index handoff test (Edit button driven, two Blobs, two distinct background keys). |
| `bug-fix-session-331.md` | This section. |

### 10.10 Status

- Branch: `arena/16e873bd-text-to-image-template` (the only branch this section was written on).
- The documented source of truth is the current code in this workspace; this file now matches it.
- No commit, push, merge or pull request was made as part of writing this section.

## 11. Full-width stacked timeline layout + dummy text instead of caption clips (active request)

This section records the newest request on branch `arena/3008d8cb-text-to-image-template`. It supersedes Section 9.3 (30/70 workspace split) and Section 10.2 (dock order is unchanged, but the dock is no longer a percentage of the viewport). **The current code in this workspace is the source of truth.**

The request, verbatim:

> Study the code and #331 md file and make the timeline editor on the right to move to the bottom with 100% width and the left preview video canvas let it take 100 percent of the width at the top with min 400 px height sticky on top then the bottom of it the selected elements section.....which has selected elements must always follow it and the timeline editor at the bottom must always follow on elements on the top of it meaning there might be some space at the bottom of page depending on the height of screen.... then remove the caption layer at the timeline tracks at the bottom but add a dummy text (at 0:00 time ) on all video that will open on that page which doesnt have text or graphics

### 11.1 Code study that drove the three changes

Read from code, not from prose:

| Question | Answer found in code (before this section) | Consequence |
|---|---|---|
| Where was the selected-element panel? | `src/client/markup.ts` put `.te-preview-panel` and `.te-inspector-panel` inside `.te-workspace`; `styles.ts` gave it `display: grid; grid-template-columns: minmax(270px, 30%) minmax(0, 70%)`. | The inspector was a **right column**, not a section under the preview. |
| How tall was the page? | `body.timeline-editor-page { overflow: hidden }`, `#studio-app.timeline-mode { height: 100dvh }`, `.timeline-editor-shell { height: 100dvh; overflow: hidden }`, `.te-dock { flex: 0 0 36%; max-height: 48% }`. | Everything was squeezed into one viewport; nothing could scroll and no empty space could exist under the dock. |
| Where did caption clips come from? | `batchTimelineState()` in `src/client/app-js.ts` looped over `row.subtitles` (subtitle cues) and pushed one `kind: "text"` clip per cue per scene with id `<sceneId>-caption-<n>` and name `Caption <n>`. | The timeline's first text/graphics lane was **only** subtitle cues, so a row without cues had an empty text lane. |
| Did the timeline lane hold anything else? | No. `visualItems` only ever received caption cues; graphics/text only appeared after the user pressed `＋ Text` / `＋ Graphic`. | "A video with no text or graphics" opened with an empty lane. |

### 11.2 Change 1 - vertical stack: full-width sticky preview, then selected elements, then the dock

The three regions are now siblings in the shell, in this exact order:

```text
.timeline-editor-shell   (flex column, min-height 100dvh, height auto)
├── .te-topbar           sticky top:0        — Back / title / Play
├── .te-preview-panel    sticky top:58px     — full width, stage floor 400px
├── .te-workspace        static              — selected-element section
│   └── .te-inspector-panel  position:static, width:100%
└── .te-dock             static              — timeline tracks + .te-dock-tail
```

`src/client/markup.ts`

- `.te-preview-panel` was moved **out** of `.te-workspace` so it is no longer trapped by a wrapper that ends right below it. It is now the second child of `.timeline-editor-shell`, `.te-workspace` holds only the selected-element section, and the dock follows.
- The section is annotated `1/3`, `2/3`, `3/3`, and a `.te-dock-tail` element (with an explanatory comment) closes the dock.

`src/client/styles.ts`

- The page is no longer locked to the viewport. `body.timeline-editor-page` keeps `overflow-x: hidden` but allows `overflow-y: auto`; `#studio-app.timeline-mode` and `.timeline-editor-shell` use `min-height: 100vh/100dvh; height: auto; overflow: visible`.
- `.te-workspace` is now `display: flex; flex-direction: column; width: 100%` instead of a two-column grid, and it is **not** sticky. The old `minmax(270px, 30%) minmax(0, 70%)` and `31% minmax(0, 69%)` rules are deleted, in the base block and in both media queries.
- `.te-preview-panel` is `position: sticky; top: 58px; width: 100%; flex: 0 0 auto`, so the preview takes the full page width at the top and stays pinned while the selected-element section and the dock scroll. `.te-topbar` is sticky at `top: 0` (z-index 40) so Play / Back stay reachable; the preview pins directly under it (58 px, 52 px below 560 px wide).
- Why the panel was moved: a sticky box only travels inside its **containing block**. While the preview lived in `.te-workspace` (which ends immediately below the preview), it had roughly zero travel and would have scrolled away with the element panel. As a direct child of the shell, its travel is the shell's content box, i.e. the element section plus the whole dock.
- `.te-preview-stage` is `min-height: 400px; height: clamp(400px, 52vh, 720px)`, so it never drops under 400 px and grows with a tall screen. `canvas#timeline-preview-canvas` keeps its 9:16 buffer while scaling up to fill that stage.
- `.te-inspector-panel` is `position: static; width: 100%; flex: 0 0 auto; overflow: visible` — the selected-element section always follows the preview and is never a side column.
- `.te-dock` is `flex: 0 0 auto; width: 100%; min-height: 320px; max-height: none`. It follows the element panel in normal flow. Because nothing is stretched to 100dvh, a tall screen simply shows empty space below the tracks.
- `.te-timeline-scroll` is `min-height: 220px` with **no** `max-height` any more: every lane (four text/graphics lanes plus three audio lanes) is reachable by scrolling the rows, and the dock grows instead of hiding rows behind a fixed 46dvh box. `overscroll-behavior` changed from `contain` to `auto` so a wheel gesture that reaches the end of the tracks continues to scroll the page (with `contain` the dock would trap the scroll).
- The `.te-dock-tail` (260 px, faintly striped to read as empty track space) provides the travel the pinned preview needs at the very end of the page. It also guarantees that when the page's last visible row is the playhead row, the sticky preview is still released *inside* the dock region, so the dock — never the preview — is the last thing on screen.

### 11.3 Change 2 - caption clips are gone from the tracks

`src/client/app-js.ts`

- `batchTimelineState()` no longer reads `row.subtitles`. The cue loop that produced `<sceneId>-caption-<n>` clips is deleted, so the Edit handoff can never create a caption clip. Subtitles are untouched for export: they still live on `row.subtitles` and are painted by the render path.

`src/client/timeline-editor.ts`

- New `isCaptionItem(item)`: true for ids ending in `-caption-<n>` or names starting with `Caption`. `normalizeState()` filters every migrated visual lane with it, so a project saved before this change (or an old handoff, or a legacy `text-*` track) loses its caption clips on open and keeps its text/graphic clips.

### 11.4 Change 3 - one dummy text at 0:00 for videos with no text or graphics

`src/client/app-js.ts` (`batchTimelineState()`)

- If the built visual lane has no `text`/`graphic` clip, one dummy is added: `id: "dummy-text-1"`, `kind: "text"`, `text: "Your text here"`, `startSec: 0`, `durationSec: min(6, scene 1 duration)`, `x: 50`, `y: 78`, `fontSize: 28`, `dummy: true`. It is pushed both onto `visual-1.items` and onto `scenes[0].elements`.

`src/client/timeline-editor.ts`

- Constants `DUMMY_TEXT = "Your text here"` and `DUMMY_TEXT_MAX_SEC = 6`.
- `dummyTextItem(scenes)` builds the same clip for the editor's own default state.
- `defaultTimeline()` ships it, and `normalizeState()` adds it when a saved project, an old handoff or a `layout=timeline` page opened without a handoff has **no** text/graphic clip at all. A project that already has text or graphics is never given a second dummy, and moving, restyling or deleting the dummy behaves exactly like any other text clip (nothing re-creates it inside a live session).

`src/client/markup.ts`

- The inspector hint and the dock footer explain both facts: the dummy text at 0:00, and that subtitle cues are not timeline clips.

### 11.5 What deliberately did not change

- The paint stack: background media is still layer 0 and pinned last in the dock; text/graphics lanes are still above it. Only the *page* order changed, not the *canvas* order.
- The 12-scene handoff, the stable per-row timeline project id (`timeline-<sourcePageId>-row-<rowId>`), the IndexedDB Blob bridge, the localStorage schema `ytvs.timeline-editor.v1.<projectId>`, the four-lane visual cap and the collapsed Soundtrack group.
- No server route, Worker module, KV key or cookie was added or changed. Timeline editing remains client-only.
- Subtitles still render into exported MP4s; only their representation as timeline clips is removed.

### 11.6 Tests updated for the three changes

| Test file | Change |
|---|---|
| `tests/timeline-editor.test.mjs` | The route test now expects the dummy text clip (`dummy-text-1`) in `visual-1` instead of the seeded caption, and asserts the caption text never reaches the page. The legacy-migration test asserts caption clips are dropped and the two graphic clips survive. The cross-scene test drives `dummy-text-1`. The ripple test expects `dummy-text-1` to move with scene 1. The layout test was replaced: it asserts the column stack, `position: sticky` on the preview, `min-height: 400px` on the stage, `width: 100%` on preview/inspector, `flex: 0 0 auto` on the dock, the `.te-dock-tail`, the absence of a `max-height` on the track scroller and the **absence** of the old 30/70 grid. New test *"the served timeline markup orders preview, then selected elements, then the dock"* proves the DOM order and that the preview is a sibling (not a child) of `.te-workspace`. New test *"timelines without text or graphics open with one dummy text clip at 0:00 and no caption clips"* covers an empty saved project, a graphic-only project that must not gain a dummy, the persisted move of the dummy and the absence of caption ids. |
| `tests/final-media-cap-actions.test.mjs` | New test *"a Quick Batch row hands off one dummy text at 0:00 instead of caption clips"* drives the real Edit button on a row that carries subtitle cues and asserts one `dummy-text-1` clip at 0:00, `dummy: true`, on the lane and on scene 1, with no `-caption-` ids anywhere. |

### 11.7 Validation

```text
node --import tsx --test tests/timeline-editor.test.mjs            10/10 pass
node --import tsx --test tests/final-media-cap-actions.test.mjs     10/10 pass
node --import tsx --test tests/quick-batch-table.test.mjs           all pass
node --import tsx --test tests/session-244.test.mjs                 8/10 pass, same 2 failures as HEAD (verified via git stash)
npx tsc --noEmit --pretty false                                     31 diagnostics, all in src/index.ts (unchanged)
```

Honesty notes:

- The pre-existing failures are not caused by this section: the two `session-244` failures (`a failing step is retried inside the row, and the row finishes`, `a timed-out request is retried quietly, unlike a stop`) fail identically on the unmodified tree.
- No real browser was available in this sandbox, so the sticky behaviour, the 400 px floor and the empty space under the dock are verified from the emitted CSS and by source assertions, not by a screenshot.
- One scroll interaction was found while reasoning about the new flow and fixed: with `overscroll-behavior: contain` on `.te-timeline-scroll`, a wheel over the tracks would never hand the scroll back to the page, so the page could not move once the pointer entered the dock. It is now `auto`.

### 11.8 Still open

1. **Real-browser eyeball.** Nothing here was rendered in Chrome/Safari at 100% and 125% zoom. The sticky offset (`top: 58px`, `52px` under 560 px) is tied to the topbar's `min-height`; if the topbar wraps to two lines the preview would pin slightly too high until the offset is re-derived from `getBoundingClientRect()`.
2. **`position: sticky` on a flex child needs a scrolling ancestor with room.** Any future change that puts `.te-preview-panel` back inside an `overflow: hidden` wrapper silently turns the pin off; the CSS comment records this.
3. **Sticky preview vs. a very short dock.** The pin is released when the shell's content box ends. The `.te-dock-tail` provides 260 px of that box; if the tail is ever removed, a document that ends exactly at the dock footer would unpin the preview one screen early and the dock would no longer be the last element in view.
4. **The dummy text is only added when the lane is empty.** A row that already has a graphic but no text gets no dummy. That is the requested behaviour ("doesn't have text or graphics"), but it means a graphics-only video has no placeholder text.
5. **`row.subtitles` is still alive for export.** Deleting the cue→clip mapping removed the only place the timeline reflected subtitles. If subtitle-aware timeline editing is wanted later it must come back as an explicit, user-toggled track rather than implicit caption clips. **(Superseded by Section 14: cue data now rides along in `timelineState.subtitles`, is burned onto the preview canvas, and renders as a hidden read-only tracks layer — still never as editable clips.)**
6. **The suite is still not green** (Section 8.6 / 10.8). This section added no new failures.

### 11.9 Files touched in this section

| File | Change |
|---|---|
| `src/client/styles.ts` | Page-height rules unlocked, column-stacked layout, sticky full-width preview with a `clamp(400px, 52vh, 720px)` stage, static full-width selected-element panel, flow-positioned dock, uncapped track scroller, `.te-dock-tail`, `overscroll-behavior` fix, responsive overrides updated. |
| `src/client/markup.ts` | The preview panel is lifted out of `.te-workspace` to become a sibling (`1/3`, `2/3`, `3/3`), `.te-dock-tail` added, timeline comment block, inspector hint and dock footer describe the new order and the dummy text. |
| `src/client/app-js.ts` | `batchTimelineState()` drops caption clips and adds the 0:00 dummy text when the lane has no text or graphics. |
| `src/client/timeline-editor.ts` | `isCaptionItem()`, `DUMMY_TEXT*` constants, `dummyTextItem()`, caption filtering and dummy seeding in `normalizeState()`, dummy in `defaultTimeline()`. |
| `tests/timeline-editor.test.mjs` | Dummy-text expectations, caption-drop expectations, rewritten layout test, new dummy-text test. |
| `tests/final-media-cap-actions.test.mjs` | New handoff test for the dummy text / absent caption clips. |
| `bug-fix-session-331.md` | This section. |

### 11.10 Status

- Branch: `arena/3008d8cb-text-to-image-template` (the only branch this section was written on).
- The documented source of truth is the current code in this workspace; this file now matches it.
- No commit, push, merge or pull request was made as part of writing this section.

## 12. Timeline controls, frame and video treatments (2026-11-06)

### Request
Add export in the timeline header and play/pause and export beneath the preview; constrain its height to 320px and match the studio theme. Make timeline edits immediately affect the canvas, add a draggable top seeker and an empty horizontal-scroll lane, preserve project frame orientation instead of always displaying 9:16, and apply video-style treatments to Quick Batch and editor output. Document the work here.

### Changes
- Quick Batch hands the selected frame dimensions, orientation and style into timeline project state, which is persisted with timing. Legacy projects without frame metadata default to landscape. The canvas buffer follows the stored dimensions (including intentional portrait or square projects); its stage is fixed at 320px and the shell uses studio theme tokens for its main surfaces and accent.
- Added header and preview export controls, a second synchronized play/pause control, draggable ruler playhead, and a blank top lane that can be dragged horizontally. The existing clip timing changes redraw immediately; gaps no longer show the selected or first background clip. Paused video seeks to the playhead and redraws when seeking completes.
- Timeline export records the current canvas in real time with MediaRecorder and mixes available timeline audio tracks via Web Audio. It downloads the browser-supported format, usually WebM; selected text outlines are omitted. It requires a browser supporting canvas capture and MediaRecorder, and the tab must remain open. Source-video audio and Quick Batch subtitle cues are not included in this timeline export. Browser codec and background-tab throttling can affect results. **(Subtitle-cue exclusion superseded by Section 14: cues are now painted onto the preview and every export path.)**
- Added shared CSS canvas-filter approximations for the Quick Batch style names, used for the table preview, timeline preview and shared renderer for Quick Batch and editor exports. The existing template filters are animation effects rather than a mapping for these Quick Batch style names, so these are new approximations, not exact template effects. Filters affect media rather than text overlays and depend on browser canvas filter support. The editor layout's own non-timeline asset previews are not styled by this change.

### Verification and limitations
- `node --import tsx --test tests/timeline-editor.test.mjs tests/quick-batch-table.test.mjs`: 26 passed, including a new frame persistence, seeking, gap and control test. Browser MediaRecorder/audio mixing and visual appearance were not exercised by these JSDOM tests.
- `npx tsc --noEmit` still reports numerous existing errors in `src/index.ts`; it is not a clean project-wide check.
- Timeline export is a real-time browser recording, not the existing Quick Batch MP4 encoder; it does not yet preserve subtitle cues or audio embedded in video clips. Theme coverage uses the application's theme tokens for major surfaces but some timeline track/inspector details retain their existing dark styling. **(Both limitations superseded by Sections 13 and 14: WebCodecs + `Mp4Muxer` MP4 export burns subtitle cues, and Section 14 re-themed every hardcoded track/inspector surface onto the `--t-*` studio tokens.)**

---

## 13. Timeline Export MP4 button & red inverted-triangle moving seeker handle (2026-11-06)

### 13.1 Request

1. Add an **Export** button in the timeline editor page (`#view-timeline`).
2. In the timeline at the bottom where there is a moving seeker when the video plays, add a **seeker handle** shaped like an **inverted triangle pointing down**, colored **red**, moving in sync as the seeker line moves.
3. Study the codebase and reference `bug-fix-session-331.md`, and document these changes in `bug-fix-session-331.md`.

### 13.2 Pre-change audit (what Section 12 left unfinished)

1. **Export UI & contrast across themes:**
   - `.te-topbar` rendered Export as a small muted `.te-secondary` button (`0.66rem`), `.te-dock-toolbar` at the bottom of `#view-timeline` had no Export control at all, and `--te-accent-ink` was set to `var(--bg)`, which turns primary CTA text near-invisible on light-background themes with bright accents (such as `neo`, where `--accent` is `#d8ff00` and `--bg` is `#f6f3e9`).
   - Clicking Export gave no button `disabled` / `aria-busy` state or visual progress bar, detached `<a download>` from `document.body` before `.click()`, and relied solely on real-time `MediaRecorder(canvas.captureStream(30))` (typically `.webm`, vulnerable to tab throttling) rather than the studio's existing browser-only WebCodecs + `mp4-muxer@5.1.3` `.mp4` pipeline (`src/client/markup.ts` already loads `mp4-muxer@5.1.3`).
2. **Seeker handle shape, color, clipping, and continuity:**
   - `.te-ruler .te-playhead` was styled as `width: 12px; margin-left: -5px; background: var(--te-accent);` inside `.te-ruler { overflow: hidden; }`, while `.te-playhead` in `.te-lane` was a `2px` red line (`#ff5263`).
   - That produced a 12×32px rectangular block in the theme accent color rather than a red downward-pointing inverted triangle (`▼`), clipped the left half of the handle at `0:00` (`left: 0px`), and left vertical breaks in the red seeker line across `.te-group-fill` header rows and collapsed audio lanes.

### 13.3 Timeline Export MP4 buttons & WebCodecs + `Mp4Muxer` offline `.mp4` renderer

1. **Prominent Export MP4 controls in all three timeline zones (`src/client/markup.ts`, `src/client/styles.ts`):**
   - **Sticky top header (`.te-topbar`):** primary CTA `<button type="button" class="te-export te-primary" id="timeline-export-btn" data-timeline-action="export">⬇ Export MP4</button>`.
   - **Preview transport bar (`.te-preview-controls`):** `<button type="button" class="te-export" data-timeline-action="export">⬇ Export MP4</button>` paired with synchronized live progress bar `#timeline-export-progress` / `#timeline-export-progress-bar`.
   - **Bottom timeline dock toolbar (`.te-dock-toolbar` / `.te-dock-actions`):** `<button type="button" class="te-export" data-timeline-action="export">⬇ Export MP4</button>` directly above the tracks so users editing at the bottom of the page can export without scrolling up.
   - Updated `--te-accent-ink: var(--t-on-accent, #10140d);` on `.timeline-editor-shell` (matching `#studio-app .app-generate`) so `.te-export` buttons stay high-contrast across all 7 studio themes (`default`, `strata`, `stellar`, `nightlab`, `paper`, `swiss`, `neo`).
2. **Browser-only WebCodecs H.264 + AAC `Mp4Muxer` export (`src/client/timeline-editor.ts`):**
   - Keeps RULE 1 / RULE 11 / RULE 28 intact: 100% browser-side rendering with zero Worker endpoints or network calls.
   - **Primary path (`exportTimelineMp4`):** When `window.VideoEncoder`, `window.VideoFrame`, and `window.Mp4Muxer` are available:
     - Mixes unmuted timeline audio tracks (`voiceover`, `sound-fx`, `background-music`) via `AudioContext.decodeAudioData` + `OfflineAudioContext` (with a pure-JS stereo PCM mixer fallback when `OfflineAudioContext` is absent) and encodes AAC (`"mp4a.40.2"`, 160 kbps) via `AudioEncoder` with bounded backpressure and flush timeouts.
     - Renders deterministic 30 fps frames at even project dimensions (`exportWidth × exportHeight`) onto an offscreen canvas (`paintTimelineFrameAt`), seeking background `<video>` elements with a bounded timeout (`seekVideoForExport`), applying `window.__videoStyleFilter(state.videoStyle)` on Layer 0, and painting Layers 1..4 text/graphics clips above it with selection outlines suppressed (`!recorder && !isExporting`).
     - Encodes H.264 (`"avc1.4d002a"` with `"avc1.42001f"` fallback via `VideoEncoder.isConfigSupported`), muxes video + AAC chunks into `Mp4Muxer.Muxer` (`fastStart: "in-memory"` up to 120s), closes every `VideoFrame` and encoder in `finally`, downloads `YouTubeVibeStudio_<slug>.mp4` via a `document.body`-attached `<a download>`, records `window.__TIMELINE_LAST_EXPORT__`, and restores `state.playheadSec` + UI button/progress state.
   - **Fallback path (`exportTimelineMediaRecorder`):** Preserves real-time `MediaRecorder(canvas.captureStream(30))` recording when WebCodecs or `Mp4Muxer` is unavailable in the browser, now upgraded with MIME negotiation (`video/mp4` preferred before `video/webm`), live percentage updates on `#timeline-export-progress-bar`, synchronized button `disabled` state, and `document.body`-attached `<a download>`.
   - Exposed `window.__TIMELINE_EDITOR__.exportTimeline` returning a Promise with `{ ok, format, mode, fileName, size }`.

### 13.4 Red inverted-triangle seeker handle (`▼`) & continuous moving seeker line

1. **Inverted-triangle geometry & unified `#ef4444` red (`src/client/styles.ts`):**
   - Replaced the `12px` accent rectangle on `.te-ruler .te-playhead` with a `2px` `#ef4444` vertical stem (`margin-left: -1px`) matching `.te-playhead` across every track row.
   - Added `.te-playhead-handle` inside `.te-ruler .te-playhead`:
     - `width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 13px solid #ef4444; left: 50%; transform: translateX(-50%);` — forming a crisp 16×13px **red inverted triangle pointing straight down** into the `2px` red seeker line, with `filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .55))` and a `24×24px` `::after` hit-target cushion (`cursor: ew-resize`).
   - Changed `.te-ruler` to `overflow: visible` with `z-index: 12` at rest and `#timeline-track-grid[data-scrolled="1"] .te-ruler { z-index: 8; }` when `#timeline-scroll.scrollLeft > 2`, so the full inverted triangle at `0:00` is never clipped in half while scrolled ticks still mask cleanly behind the sticky `TRACKS` corner (`z-index: 11`).
2. **Continuous seeker line & synchronized playback/scrubbing (`src/client/timeline-editor.ts`):**
   - `playheadHtml(leftPx, withHandle)` emits `<span class="te-playhead te-ruler-playhead" data-playhead ...><span class="te-playhead-handle" data-playhead-handle title="Drag seeker handle"></span></span>` in `.te-ruler`, and `<span class="te-playhead" data-playhead ...>` across `.te-group-fill` rows (`position: relative; overflow: hidden;`) as well as all `.te-lane` rows (including collapsed audio lanes), eliminating vertical gaps.
   - `updatePlayhead()` updates `style.left` on every `[data-playhead]` element on each `previewTick` animation frame and `setPlayhead()` call, moving the red inverted-triangle handle and the vertical red seeker line in exact lockstep, and gently scrolls `#timeline-scroll` horizontally during playback when the moving seeker passes the visible right edge.
   - `grid` `pointerdown` recognizes `[data-playhead-handle]` directly (in addition to `.te-ruler`), captures the pointer when available, and scrubs smoothly via `pointermove` / `seekAt()`.

### 13.5 Verification

- `node --import tsx --test tests/timeline-editor.test.mjs tests/quick-batch-table.test.mjs tests/final-media-cap-actions.test.mjs tests/template-composer.test.mjs tests/public-entry-points.test.mjs` — **67 / 67 passing** (`0` failures), including 3 new tests in `tests/timeline-editor.test.mjs`:
  1. CSS + DOM + `requestAnimationFrame` playback + pointer-scrubbing verification for the red inverted-triangle seeker handle (`.te-playhead-handle`).
  2. End-to-end WebCodecs (`VideoEncoder` + `VideoFrame` + `AudioEncoder` + `EncodedAudioChunk`) + `Mp4Muxer` `.mp4` export verification across all 3 Export MP4 buttons, progress UI, body-attached `<a download>`, and playhead restoration.
  3. `MediaRecorder` fallback verification when WebCodecs / `Mp4Muxer` is absent.
- `node --import tsx -e 'import { TIMELINE_EDITOR_JS } from "./src/client/timeline-editor.ts"; import { APP_JS } from "./src/client/app-js.ts"; new Function(TIMELINE_EDITOR_JS); new Function(APP_JS.replace("__PROMPTS_JSON__", "[]"));'` — **JS syntax OK**.
- `npx wrangler deploy --dry-run` — **bundle compiles cleanly** (`2931.01 KiB / gzip: 1342.74 KiB`).

### 13.6 Files touched in this section

| File | Change |
|---|---|
| `src/client/markup.ts` | Upgraded `.te-topbar` and `.te-preview-controls` Export buttons to `.te-export` (`⬇ Export MP4`), added `#timeline-export-progress` / `#timeline-export-progress-bar`, and added a third `.te-export` button in `.te-dock-toolbar` above the bottom timeline tracks. |
| `src/client/styles.ts` | Added `--te-accent-ink: var(--t-on-accent, #10140d)` and `.te-export` / `.te-export-progress*` styles; replaced the rectangular `.te-ruler .te-playhead` block with a `2px` `#ef4444` stem + `.te-playhead-handle` red downward-pointing inverted triangle (`border-top: 13px solid #ef4444`) + unclipped `0:00` ruler stacking + continuous `.te-group-fill` playhead rules. |
| `src/client/timeline-editor.ts` | Emitted `[data-playhead-handle]` inside `.te-ruler` and continuous `[data-playhead]` segments across group-fill and lane rows; added playback horizontal auto-follow and direct handle scrubbing; implemented offline WebCodecs H.264 + AAC `Mp4Muxer` `.mp4` export (`exportTimelineMp4`) with `MediaRecorder` fallback (`exportTimelineMediaRecorder`) and `api.exportTimeline`. |
| `tests/timeline-editor.test.mjs` | Updated Export button count (`3`) and added JSDOM tests for the red inverted-triangle seeker handle (playback sync + drag scrubbing), WebCodecs + `Mp4Muxer` MP4 video/audio export, and `MediaRecorder` fallback. |
| `bug-fix-session-331.md` | Added Section 13 documenting the audit, architecture, CSS/JS changes, and verification results. |

### 13.7 Status

- Branch: `arena/f7b837b7-text-to-image-template` (`active`).
- All timeline, Quick Batch, composer, and public entry-point test suites pass (`67 / 67`) and `wrangler deploy --dry-run` succeeds.

---

## 14. Subtitles back on the preview, full theme trace, hidden subtitle layer, and neon/VHS effect filters (2026-11-06)

### 14.1 Request

1. Make the subtitle appear again on the timeline editor **video preview** (Section 11.3 removed captions as timeline clips; the cues must render on the preview canvas instead).
2. Trace the **black theme** of the timeline editor — some sections appear in black; the timeline editor must have the same theme as the site theme (studio `--t-*` tokens across all 7 themes: `default`, `strata`, `stellar`, `nightlab`, `paper`, `swiss`, `neo`).
3. Once subtitle layers appear in the timeline tracks, **hide** them — subtitles must not be editable because they rely on the music.
4. Add image/video **effect filters** on the video preview: the video templates modal of the editor layout has image filters like neon effect and VHS effect — copy those onto the timeline preview, applied once the video style is passed into timeline editor details from Quick Batch row values.
5. Study the code and `bug-fix-session-331.md`, then document the work here.

### 14.2 Pre-change audit

1. **Subtitles had no representation in the timeline at all.** After Section 11.3 `batchTimelineState()` dropped the cue→clip loop entirely, so `timelineState` carried no subtitle data; `defaultTimeline()` had no `subtitles` slot and neither `drawPreview()` nor the WebCodecs `paintTimelineFrameAt()` painter knew about cues. The only `drawSubtitles` in the codebase is the global painter in `app-js.ts`, which expects real decoded media and a full canvas 2D API — calling it from the timeline would crash the JSDOM canvas mock (no `measureText`, `rect` or `createRadialGradient`) and would draw behind the timeline's own layer stack.
2. **The timeline CSS was a hardcoded dark island.** The block from `body.timeline-editor-page {` to the end of `styles.ts` (≈1260 lines) hardcoded its own palette instead of the studio tokens: page background `#101116`, inspector panel `#101116`, group rows `#191b22`/`#20232a`, track labels `#20222a`, toolbar buttons `#22252d`/`#292c34`, inputs `#1d2027`, ~25 line colours (`#30333d`, `#282b33`, `#363944`, `#3a3d46`, `#454852`, …), ~14 ink colours (`#f3f4f6`, `#e5e7eb`, `#d4d7df`, …) and ~9 muted colours (`#9398a5`, `#9297a2`, `#aeb2bd`, …). The `--t-*` tokens exist only on the six named `html[data-theme]` selectors, never on `:root`, so new rules must carry a dark fallback (`var(--t-line, #30333d)`) or the `default` theme breaks.
3. **Hidden rows need CSS, not just attributes.** The track grid rows are `display: flex` at author origin, so a `hidden` attribute (UA origin `display: none`) cannot hide them, and any wrapper element inside `.te-track-grid` would become one grid item and break the row/column structure — a hidden layer has to be emitted as sibling rows and killed with `display: none !important`.
4. **The effects live in `template-scene-editor.ts`, not the composer.** Grepping `markup.ts`, `styles.ts` and `template-composer-js.ts` for `neon`/`vhs` finds nothing; the reusable effect overlays are inside `reelDrawBackground()` (neon radial glow, VHS/glitch scanline bars, duotone) next to `reelBackgroundMotion()`'s animated seconds input. The timeline already receives `state.videoStyle` from Quick Batch (`videoStyle: row.style` in `batchTimelineState()`) and already runs it through `window.__videoStyleFilter` on Layer 0 (Section 12) — but that CSS filter is only the backdrop pass, not the modal's neon/VHS overlays.

### 14.3 Change 1 — subtitle cues ride along and burn onto the preview canvas

1. **Handoff (`src/client/app-js.ts`, `batchTimelineState()` L9172):** maps `row.subtitles` into `timelineState.subtitles` — `{ startMs, endMs, text }`, empty/zero-length cues dropped, capped at 400 — and returns it from the state builder next to `videoStyle` (L9288–9289). The cue loop that created `<sceneId>-caption-<n>` clips stays deleted (Section 11.3 unchanged: cues are data, never clips). `localStorage` persistence and `applyTransitionProject` → `window.__TIMELINE_PROJECT__` → boot carry it through unchanged.
2. **Persistence (`src/client/timeline-editor.ts`):** `normalizeSubtitles(list)` (L283) validates the array (≤400 cues, clamped non-negative ms, `endMs > startMs`, trimmed non-empty text). `defaultTimeline()` gains `subtitles: []` and `normalizeState()` (L458) reads `base.subtitles` with a fallback to `transition.timelineState.subtitles`, so both a restored project and a fresh handoff populate it.
3. **Local guarded painter:** `drawTimelineSubtitles(context, cues, timestampMs, width, height)` (L1284) — a timeline-local copy of the shared cue painting behaviour, fully guarded against the JSDOM canvas mock: picks the active cue (`startMs ≤ t < endMs`), centres it horizontally (`textAlign = "center"`, `textBaseline = "middle"`) at `y = height - height / 3` using `SUBTITLE_FONT_SIZE = 22` px and `SUBTITLE_FONT_STACK = 'Bookman Old Style', 'Bookman', 'URW Bookman L', Georgia, serif` (L43–44), splits the text on `"\n"` up to 6 lines with `lineHeight = 26`, `padX = 10`, `padY = 6`. The `rgba(0, 0, 0, 0.55)` backdrop box is sized to the widest line — `measureText` when present, `line.length * 22 * 0.5` otherwise, clamped to `width - 20` — and painted with `fillRect` or a `beginPath()/rect()/fill()` fallback; the white lines then use `fillText(text, x, y, maxLineWidth)`.
4. **Both render paths call it:** `drawPreview()` calls it after all visuals/layers (L1397) and the WebCodecs/`MediaRecorder` export painter `paintTimelineFrameAt()` calls it per frame at `seconds * 1000` (L1567) — so the interactive preview, the MP4 export and the fallback recording all burn the same cues in. (This supersedes the Section 12 note that subtitle cues are excluded from timeline export.)
5. **Heading details:** `updateProjectHeading()` (L2095) now appends ` · <state.videoStyle> style`, so the frame details row shows which Quick Batch style the preview is rendering with.

### 14.4 Change 2 — the black island is re-themed onto the studio `--t-*` tokens

Programmatic pass over the timeline block in `src/client/styles.ts` (from `body.timeline-editor-page {` to the end of the file) with per-pattern expected-count assertions:

1. **Structural surfaces now point at the site's live theme variables:** the page background `#101116` → `var(--bg)`; `.te-inspector-panel` `#101116` → `var(--card)`; `.te-lane.collapsed` → `var(--t-panel-3, #101116)`; `--te-border` → `var(--t-line, #30333d)`.
2. **~70 hardcoded declarations wrapped as `var(--t-X, <same hex>)`** — preserving the exact dark values as the `default`-theme fallback (tokens are absent from `:root`):
   - *panels*: `#191b22`, `#20222a`, `#20232a`, `#191d15`, `#1b2116`, `#1b1e25`, `#1c1f26`, `#161a12`, `#1d2417`, `#252830`, `#2c3a22`, `#20251c`, `#17191f`, `#14161c`, `#16181f`, `#333741` → `--t-panel`/`--t-panel-2`/`--t-panel-3`;
   - *lines/borders*: `#30333d`, `#282b33`, `#363944`, `#3a3d46`, `#454852`, `#454853`, `#41454f`, `#41444e`, `#535761`, `#373a43`, `#2d3039`, `#24272f`, `#2e3526`, `#3a4430`, `#30323a`, `#454955` → `--t-line`/`--t-line-2`;
   - *inks*: `#f3f4f6`, `#e5e7eb`, `#d4d7df`, `#cdd1da`, `#c0c3cb`, `#d8dbe2`, `#c5cbd4`, `#c7cbd4`, `#d5d7de`, `#b9bec8`, `#dff3bf`, `#e7e9ef`/`#dce6cf` → `--t-ink`/`--t-btn2-ink`;
   - *muteds*: `#9398a5`, `#9297a2`, `#aeb2bd`, `#a1a5b0`, `#9ea3af`, `#747986`, `#a9aebb`, `#bdc1ca`, `#bcd79a` → `--t-muted`/`--t-accent-ink`;
   - *controls*: `#22252d`/`#292c34` → `--t-btn2-bg`, `#1d2027` → `--t-input`, `rgba(255, 255, 255, .12)` progress track → `--t-track`, `#a6d85b`/`#bbdf86` → `--t-accent-ink`, `#fca5a5` → `#ef4444` (unified with the Section 13 seeker red).
3. **Deliberately kept constant:** clip-identity gradients and label inks (purple/blue/gold clip groups, `.te-export-btn`'s green gradient block), the `#08090c` video letterbox/placeholder, `#d1d5db` placeholder text over video, `#ef4444` seeker/error red (test-locked), `#7f1d1d`/`#431b20`/`#fecaca` destructive delete colours, `#d5f7a1` selection ring, `rgba(166, 216, 91, …)` accent wash — these are self-contained on purpose, exactly like the kept section 12 note for clip gradients.
4. Verified each `--t-*` token exists on all six `html[data-theme]` selectors (multi-line values on `strata`/`stellar` etc.), and the result follows the site convention: 150 pre-existing `var(--t-X, <fallback>)` usages use the same fallback form.

### 14.5 Change 3 — the subtitle layer appears in the tracks, then stays hidden and read-only

1. **Cues never enter `state.tracks`** (unchanged Section 11.3 invariant), so nothing selects, drags, ripples or lengthens them; `isCaptionItem()` continues to drop legacy `<scene>-caption-<n>` clips on open.
2. **`renderTimeline()` (L665–674)** emits, as sibling rows inside `#timeline-track-grid` (only when cues exist):
   - `.te-subtitle-group` — a `te-group-title`-shaped header reading `SUBTITLES · locked to the music · hidden, not editable` (`aria-hidden`);
   - `.te-subtitle-fill` — the matching `te-group-fill` row carrying its own playhead segment, and `.te-subtitle-label` — the sticky left label row rendering `Voiceover subtitles` + `<small>N cues · read-only</small>`;
   - `.te-subtitle-lane` (`data-lane-track="subtitles"`, `aria-hidden="true"`) containing one `.te-clip.text` per cue via `subtitleClipFor()` (L293; ids `subtitle-1..N`, label = cue text, read-only flags), rendered with the normal `htmlTrackItem()` so the rows stay grid-aligned.
3. **CSS kill switch (`styles.ts` ~L10195):** `.te-subtitle-group, .te-subtitle-fill, .te-subtitle-label, .te-subtitle-lane { display: none !important; }` — author-level `!important` beats the `display: flex` of the row rules and works on every theme; the rows exist for structure/audit but are invisible in the dock.
4. **Copy updated (`src/client/markup.ts`):** the inspector hint (L877) and dock footer now say subtitle cues follow the music, paint on the preview, and their timeline layer stays hidden and read-only.

### 14.6 Change 4 — neon and VHS effects copied from the video templates modal onto the preview

1. **`drawStyleEffects(context, width, height, seconds)` (L1333)** reads `state.videoStyle` (the Quick Batch row style handed over in `timelineState.videoStyle`) and paints byte-faithful copies of the two overlays `reelDrawBackground()` uses in `template-scene-editor.ts`:
   - `/neon/i` → the modal's `style === "neon"` block verbatim: `createRadialGradient(w * 0.5, h * 0.5, w * 0.03, w * 0.5, h * 0.5, w * 0.72)` with two stops — `rgba(255,45,149,0.08)` at 0 → `rgba(0,0,0,0.52)` at 1 — painted as a full-frame `fillRect` (pink core, darkened edges), wrapped in a `typeof context.createRadialGradient === "function"` guard the timeline adds so bare canvas test doubles no-op;
   - `/retro|vhs|glitch/i` → the modal's `style === "glitch" || bg.effect === "scanlines"` block, minus the modal-only `bg.speed` factor: `save()`, `globalAlpha = 0.3`, `fillStyle = "rgba(0,0,0,0.72)"`, `scale = max(0.5, height / 720)`, `effectLine = max(2, round(2 * scale))`, `gap = max(5, round(7 * scale))`, `scroll = floor((seconds * 24) % gap)`, then `for (y = -gap; y < height + gap; y += gap) fillRect(0, y + scroll, width, effectLine)` and `restore()` — rolling black bars at a 12 px pitch / 4 px thickness on a 1280-px-tall (9:16) canvas (7 px pitch / 2 px thickness at 720p), animated by the playhead time.
2. **Called unconditionally in both painters:** `drawPreview()` (L1382, after the placeholder and below the visuals so text stays legible) and `paintTimelineFrameAt()` (L1557) — exports get the identical effect. Deliberately there is **no `drawn`/media gate**: JSDOM never decodes media (so a gated call would be untestable), and the requested behaviour is the effect on the video preview regardless of asset state — the overlays read over the empty placeholder too. The Section 12 Layer-0 `__videoStyleFilter` CSS filter pass is untouched; backdrop filter + modal overlays now stack the way the template modal's do.

### 14.7 Notes, gotchas and deliberate decisions

1. **Backticks inside comments break the string-template client bundles.** `APP_JS`, `TIMELINE_EDITOR_JS`, `APP_CSS` and `PAGE_MARKUP` are template literals, so a `` ` `` anywhere in their body — including an innocent code-style comment — terminates the string. Rewriting `batchTimelineState()`'s cue comment this way failed esbuild with `Expected ";" but found "timelineState"` at `app-js.ts:9178`. Comments inside these four files must use plain quotes, never backticks.
2. **The shared global `window.drawSubtitles` cannot serve the timeline.** It assumes `measureText`, `rect`, `createRadialGradient` and a real media context; the JSDOM canvas mock lacks them, so calling it from the timeline would throw. Hence the guarded, self-contained `drawTimelineSubtitles` painter instead of reusing the global.
3. **Hiding a grid row needs CSS, not attributes.** The author-level `display: flex` on `.te-lane`/`.te-track-label` beats the UA-origin `[hidden] { display: none }`, so the `.te-subtitle-*` rows ship `aria-hidden` *and* a `display: none !important` rule. A wrapper element was rejected separately: anything direct-child of `.te-track-grid` becomes one grid item and would break the two-column row layout — hence sibling rows.
4. **The hidden clips deliberately keep `.te-clip` / `.text` classes.** They are rendered through the normal `htmlTrackItem()` so widths, playhead segments and grid math stay identical to real lanes; side effect: the route fixture now counts **15** `.te-clip` elements (12 media + dummy + 2 cues), not the 13 a "no subtitle clips" reading would suggest. The test asserts the cues sit inside the hidden `aria-hidden` lane instead of counting them away.
5. **`drawStyleEffects` runs with no `drawn`/media gate** (see 14.6.2): a gate would make the effect assertions unreachable in JSDOM, and effects should be visible on the video preview even before stock media decodes. Positioning still guarantees legibility — it is called after the placeholder but before Layers 1..4, so burned subtitles and user text paint above the overlays.
6. **`assert.deepStrictEqual` rejects cross-realm objects.** Cue objects created inside `window.eval` carry the JSDOM realm's `Object.prototype`, so a structural deep-equal against host-realm literals fails even when every field matches (both sides printed identically). The handoff test maps cues into host objects first: `Array.from(state.subtitles, (cue) => ({ startMs, endMs, text }))`.
7. **Every new token use keeps a dark fallback.** `--t-*` variables exist only on the six named `html[data-theme]` selectors, never on `:root`, so `var(--t-line)` alone would compute invalid on the `default` theme. All ~70 wraps use `var(--t-X, <original hex>)`, matching the 150 pre-existing fallback-form usages in `styles.ts`.
8. **Sandbox housekeeping:** `node_modules` was reclaimed between tool calls mid-session (`ERR_MODULE_NOT_FOUND: tsx`) — re-run `npm install` before tests if imports suddenly vanish. `/tmp` scratch scripts are likewise not guaranteed to survive between calls.

### 14.8 Verification

- `node --import tsx --test tests/timeline-editor.test.mjs tests/quick-batch-table.test.mjs tests/final-media-cap-actions.test.mjs tests/template-composer.test.mjs tests/public-entry-points.test.mjs tests/editor-subtitles-parity.test.mjs` — **77 / 77 passing**, including 3 new tests in `tests/timeline-editor.test.mjs`:
  1. *"subtitle cues paint on the timeline preview while their tracks layer stays hidden and read-only"* — cue data survives `normalizeState`, the group/label/lane rows exist with `aria-hidden` and one clip per cue, CSS hides all four classes, cues never enter `state.tracks`, and ruler seeks at ≈0.83s / 3s / 6s show cue 1 / cue 2 / nothing in `previewContext.drawnTexts`;
  2. *"the timeline preview applies the passed row video style plus the template-modal neon and VHS effects"* — `state.videoStyle` and the heading carry `Retro Poster style`, Layer-0 `__videoStyleFilter` hooks exist in both painters, and real seeks record rolling scanline `fillRect` bands (Retro/VHS) and a `createRadialGradient` call (Neon Night);
  3. *"timeline chrome follows the site theme instead of hardcoded black"* — `doesNotMatch` the old `background: #101116` page/inspector/collapsed rules, matches `var(--bg)` / `var(--card)` / `--te-border: var(--t-line, #30333d)`, and pins the themed tokens incl. `var(--t-input, #1d2027)` and the subtitle-lane hide rule.
- `tests/final-media-cap-actions.test.mjs` handoff test extended: `timelineState.subtitles` deep-equals the row cues `[{0, 2000, "Quiet rooftop gardens"}, {2000, 4000, "in the morning"}]` while caption ids stay zero.
- Full `npm test` compared against a clean-stash baseline of the base commit: **identical failure set (46 pre-existing failures in API-relay/worker suites, zero regressions from this work; 488/534 pass on both).**
- `npx wrangler deploy --dry-run` — **bundle compiles cleanly** (`2941.38 KiB / gzip: 1345.54 KiB`).
- `npx tsc --noEmit` — still exactly the 30 pre-existing errors in `src/index.ts` (none in any file touched here), same as the base commit.

### 14.9 Files touched in this section

| File | Change |
|---|---|
| `src/client/app-js.ts` | `batchTimelineState()` rewritten cue-data comment; maps `row.subtitles` → `timelineState.subtitles` (≤400, validated) and returns it beside `videoStyle`. |
| `src/client/timeline-editor.ts` | `normalizeSubtitles` + `subtitleClipFor`; `defaultTimeline.subtitles` + `normalizeState` persistence (handoff fallback); `drawTimelineSubtitles` + `drawStyleEffects` and their hooks in `drawPreview` / `paintTimelineFrameAt`; hidden sibling subtitle rows in `renderTimeline`; `updateProjectHeading` shows the passed style. |
| `src/client/styles.ts` | Full theme-token pass over the timeline CSS block (~70 `var(--t-X, <fallback>)` wraps, page/inspector/collapsed → `--bg`/`--card`/`--t-panel-3`); `.te-subtitle-*` `display: none !important` rule; group-label `#bcd79a` → `--t-accent-ink`. |
| `src/client/markup.ts` | Inspector hint and dock footer copy: cues paint on the preview, layer is hidden and read-only. |
| `tests/timeline-editor.test.mjs` | Fixture gains two cues (`A quiet morning` / `Across scene two`); clip count 13 → 15 with the hidden `aria-hidden` lane; 3 new tests (preview burn, neon/VHS effects, theme tokens). |
| `tests/final-media-cap-actions.test.mjs` | Handoff test asserts `timelineState.subtitles` deep-equals the row's two cues. |
| `bug-fix-session-331.md` | This section, plus supersede markers on the Section 11.7 / 12 notes this work replaces. |

### 14.10 Status

- Branch: `arena/88ef7082-text-to-image-template` (`active`); committed and pushed as `9873df0` *"Section 14: timeline subtitles on preview, studio theme trace, hidden subtitle layer, neon/VHS effects"* (7 files, +499/−100).
- Validation set 77/77 green; full suite failure set identical to the base commit (no regressions); `wrangler deploy --dry-run` compiles (`2941.38 KiB / gzip: 1345.54 KiB`); `new Function(TIMELINE_EDITOR_JS)` / `new Function(APP_JS…)` syntax checks pass.
- Known follow-ups: subtitle cues remain unselectable-by-design (the layer is invisible; there is no toggle to reveal it); `npx tsc --noEmit` remains unclean on `src/index.ts` from earlier sessions (30 errors, identical on the base commit).

---

## 15. Row video style into the project detail, and the template-modal effects on every scene (2026-11-06)

This section records the newest request on branch `arena/4d1103b2-text-to-image-template`. It supersedes Section 14.6 for the effect set (the neon/VHS pair is no longer the whole story: the duotone double gradient is added and the effect list becomes project data). **The current code in this workspace is the source of truth.**

The request, verbatim:

> Study code and reference the md file #331 ... And when the edit icon on table layout rows are clicked the video style must be added to the project detail and passed to the time line editor ....and the video effects must be applied if cinematic is applied apply the double gradient on video and image using thee css on add video from template image effect. ....if neon was selected on row use vhs effects along with neon image effect these are already existing css code apply this to all scenes.......document the request in #331 md file and then study code and document them in 331 md file.....

Split into four acceptance criteria:

1. Pressing the ✎ action in a Quick Batch **table** row must put that row's **video style** into the **project detail** and pass it to the **timeline editor**.
2. When the row style is **cinematic**, apply the **double gradient** from the "Add video from template" image effects to the **video and the image** frames.
3. When the row style is **neon**, apply the **VHS effect together with the neon image effect**.
4. Those treatments must be **applied to all scenes**, not just the preview or the first scene - and all of it documented here.

### 15.1 Code study that drove the changes

Read from the code, not from prose:

| Question | Answer found in code (before this section) | Consequence |
|---|---|---|
| Did the Edit handoff already carry the style? | Yes, twice: `batchProjectJson()` set `basicSettings.style = row.style \|\| "Cinematic Film"` and `batchTimelineState()` set `videoStyle`. | The style arrived, but only as loose scalars. There was no project-detail object. |
| Did a **project detail** exist? | No. `grep -rn "projectDetail"` over `src/` and `tests/` returned **zero hits**. | Criteria 1 could not be met by the old payload. |
| Did the ✎ click read the live control? | No. The click handler called `openBatchEditPage(row)` with the model row. Only the `input`/`change` listeners called `syncBatchRowInput()`, and `syncBatchRowsFromDom()` re-read a control **only** when `_batchTouched` was set. | A style picked but not yet committed could be dropped from the handoff. |
| Which effects did the timeline paint? | `drawStyleEffects()` (Section 14.6) painted the neon radial glow for `/neon/i` and the rolling scanlines for `/retro\|vhs\|glitch/i`, both keyed off the project-wide `state.videoStyle`. | No double gradient anywhere, and no per-scene effect data. |
| Where does the "Add video from template" image effect live? | `src/client/template-scene-editor.ts` → `reelDrawBackground()`: the "Duotone gradient" block at L400 (`createLinearGradient` with `rgba(255,107,53,…)` → `rgba(46,196,182,…)`, i.e. the **double gradient**), the neon glow at L409 (`createRadialGradient`, pink `rgba(255,45,149,0.08)` → `rgba(0,0,0,0.52)`), and the VHS/scanline block at L416 (`globalAlpha 0.3`, 2 px bars on a 7 px pitch, scrolling with time). | All three are **canvas** painters. There is no CSS gradient or CSS filter for them in the repository. |
| What CSS does exist for a row style? | `window.__videoStyleFilter(style)` (app-js L7497) - a ten-entry `contrast()/saturate()/hue-rotate()` map. | The CSS filter stays; the three modal treatments ride on top of it. |
| Did Quick Batch paint the effects? | No. `batchPreviewTick()` (table Preview) and `generateMP4()` (the shared MP4 renderer) applied `__videoStyleFilter` only. | "Apply to all scenes" would have been false for the table layout and for every exported frame. |
| Did scenes carry effect metadata? | No. `batchTimelineState()` scenes held only timing + media fields. | There was nowhere to say "this treatment applies to scene 7". |

So the four criteria reduce to: **one style → effect mapping**, **one painter per effect**, **per-scene effect lists**, and **a project-detail carrier** for the style.

### 15.2 Change 1 - the Edit click reads the live style and the handoff carries a project detail

`src/client/app-js.ts`

1. **`syncBatchRowFromDom(row)` (L11680).** The ✎ handler is now `openBatchEditPage(syncBatchRowFromDom(row) || row)`. It re-reads exactly two controls from that row's `<tr>`: `[data-batch-field="script"]` and `[data-batch-field="style"]`, so the payload can never carry a stale style. The other controls are deliberately **not** re-read: they already commit on `change`, and normalising them here would rewrite a value the table never displayed (a model value of `"720p"` renders as `1024` via `batchResolution()`, which would silently change an existing handoff contract).
2. **`batchProjectDetail(row, timelineState)` (L9459).** New project-detail builder. It returns:
   ```text
   id, rowId, vid, title, topic,
   style, effects[], effectLabel,
   resolution, orientation, quality, frame,
   sceneCount, scenes[] (id, index, mediaType, startSec, durationSec, effects[])
   ```
   `scenes[]` is the proof that the treatment is a project-wide promise, not a preview trick.
3. **`batchProjectJson(row)`** now builds the timeline state once and uses `timelineState.videoStyle` for `basicSettings.style` (one source, not two), adds `projectDetail`, and `openBatchEditPage()` fills `projectDetail.vid`, `sourcePageId` and `targetPageId` once the stable row project id is allocated.
4. **The short cookie mirror** gains `style` and `effects`, so a handoff can be audited from the cookie alone (its `createdAt` matching rule is unchanged).

`src/client/timeline-editor.ts`

5. **`normalizeProjectDetail(raw, fallback, scenes)` (L275)** validates and re-resolves `state.projectDetail`, including a per-scene `effects` list. `normalizeState()` populates it from `transition.projectDetail` (the new handoff) or synthesises it from `basicSettings` for an older payload.
6. **The style resolution chain** in `normalizeState()` is now: saved `base.videoStyle` → `transition.projectDetail.style` → `transition.basicSettings.style` → `"Cinematic Film"`. Every scene also stores `videoStyle` beside its `effects`.
7. **`updateProjectHeading()` (L2270)** prints the project detail: `Quick Batch row 7 · 12 scenes · Cinematic Film style · double gradient · browser-only timing`. The existing `/Retro Poster style/` contract still matches.
8. **`api.getProjectDetail()` / `api.getStyleEffects()`** expose the detail and the resolver for deterministic debugging; `state.projectDetail` is persisted by the existing `persistNow()` because it is part of `state`.

### 15.3 Change 2 - one effect mapping, shared by every surface

`src/client/app-js.ts` (L7548, next to `__videoStyleFilter`):

```text
window.__videoStyleEffects(style) -> ["duotone"] | ["neon","vhs"] | ["vhs"] | []
window.__VIDEO_STYLE_EFFECT_LABELS = { duotone: "double gradient", neon: "neon glow", vhs: "VHS scanlines" }
window.__videoStyleEffectLabel(effects)
window.__paintVideoStyleEffects(context, width, height, seconds, style, effects)
```

| Row style | Effects | What is painted |
|---|---|---|
| `Cinematic Film` (also anything matching `/duotone\|cinematic/i`) | `duotone` | the modal's **double gradient**: a moving `createLinearGradient` with `rgba(255,107,53,0.42)` → `rgba(255,107,53,0.12)` → `rgba(46,196,182,0.44)` |
| `Neon Night` (anything matching `/neon/i`) | `neon` + `vhs` | the pink radial glow **and** the rolling black bars |
| `Retro Poster` (anything matching `/retro\|vhs\|glitch/i`) | `vhs` | the rolling black bars |
| any other style | none | the existing CSS filter only |

`src/client/timeline-editor.ts` keeps `styleEffectsFor()` (L241) and `normalizeEffects()` (L257): the shared `window.__videoStyleEffects()` is consulted first, and `STYLE_EFFECT_FALLBACK` (`Cinematic Film → duotone`, `Neon Night → neon+vhs`, `Retro Poster → vhs`) keeps the timeline bundle standalone in the same guarded way it already uses `window.__videoStyleFilter`.

### 15.4 Change 3 - the treatments are applied to all scenes

1. **Handoff (`batchTimelineState()`):** `videoStyle` and `styleEffects` are computed once, every one of the 12 `scenes[]` is stamped with `effects: styleEffects.slice()` and `videoStyle`, and the timeline state carries `videoStyleEffects` at the root.
2. **Timeline load (`normalizeState()`, `defaultTimeline()`):** every scene keeps (or receives) its own `effects` list, so a saved project, an old handoff and a bare `layout=timeline` page all behave the same.
3. **Timeline painters:** `drawStyleEffects(context, width, height, seconds, scene)` (L1476) now takes the **scene**. `drawPreview()` passes the active scene and `paintTimelineFrameAt()` passes the scene for exported frames, so the seeker crossing scene 1 → scene 12 repaints the treatment every time. The order matches the modal: duotone → neon → VHS bars, above the background media and below text/graphics and subtitles.
4. **Quick Batch table layout:** `batchPreviewTick()` and the shared MP4 renderer `generateMP4()` both call `window.__paintVideoStyleEffects(...)` after the media draw and before the title/captions. Scenes in the table Preview and every exported frame therefore carry the same double gradient / neon + VHS treatment as the timeline.

### 15.5 Why the effect is canvas code, not CSS

The request says "using the css on add video from template image effect". In this codebase the "Add video from template" image treatments are **not** CSS: `reelDrawBackground()` paints them with `createLinearGradient`, `createRadialGradient` and `fillRect` on a canvas. The only CSS-ish layer for a row style is `window.__videoStyleFilter()`, which is a canvas `filter` string, not a stylesheet gradient.

Section 12/14 already took this reading ("the existing template filters are animation effects rather than a mapping for these Quick Batch style names"), and this section keeps it: the painters are **byte-faithful copies** of the modal blocks (colours, stop offsets, alpha, bar pitch, scroll rate), the CSS filter still runs on Layer 0, and **no CSS file was touched**. The two modal-only inputs the timeline cannot have - `bg.speed` for the VHS scroll and the per-scene `style` switch - are replaced by the project style and the playhead time, exactly as Section 14.6 did for the scanlines.

### 15.6 Files touched in this section

| File | Change |
|---|---|
| `src/client/app-js.ts` | `videoStyleEffects()`/`__videoStyleEffects`, `__VIDEO_STYLE_EFFECT_LABELS`, `__videoStyleEffectLabel`, `__paintVideoStyleEffects()`; `batchProjectDetail()`; `projectDetail` + style/effects in the cookie mirror; per-scene `effects`/`videoStyle` and root `videoStyleEffects` in `batchTimelineState()`; `batchProjectJson()` builds the timeline state once; `syncBatchRowFromDom()` + live style on the ✎ click; effect painting in `batchPreviewTick()` and `generateMP4()`. |
| `src/client/timeline-editor.ts` | `STYLE_EFFECT_*` constants; `styleEffectsFor()`, `normalizeEffects()`, `effectLabel()`, `normalizeProjectDetail()`; style resolution chain incl. `projectDetail.style`; per-scene `effects`/`videoStyle` in `normalizeState()` and `defaultTimeline()`; `drawStyleEffects(…, scene)` with the duotone double gradient; scene-aware calls in `drawPreview()` / `paintTimelineFrameAt()`; heading prints the detail; `api.getProjectDetail()` / `api.getStyleEffects()`. |
| `src/client/markup.ts` | Inspector hint and dock footer describe the style-driven treatments on all scenes and in the exported MP4. |
| `tests/timeline-editor.test.mjs` | Canvas double now records `fillRect` calls and gradient stops; retro/VHS test updated; two new tests (neon + VHS on every scene, cinematic double gradient on image and video scenes); source assertions switched to `includes()` for the new resolver. |
| `tests/final-media-cap-actions.test.mjs` | New test: the ✎ click carries the live style into `basicSettings`, `projectDetail` and `timelineState` (12 scenes stamped), for both a cinematic and a neon row. |
| `bug-fix-session-331.md` | This section. |

### 15.7 Verification

```text
node --import tsx --test tests/timeline-editor.test.mjs tests/quick-batch-table.test.mjs \
  tests/final-media-cap-actions.test.mjs tests/template-composer.test.mjs \
  tests/public-entry-points.test.mjs tests/editor-subtitles-parity.test.mjs     80 / 80 pass
node --import tsx --test tests/timeline-editor.test.mjs                          20 / 20 pass
node --import tsx --test tests/final-media-cap-actions.test.mjs                  11 / 11 pass
new Function(APP_JS) / new Function(TIMELINE_EDITOR_JS)                          syntax OK
full npm test (this tree)                                                        537 total / 490 pass / 41 fail / 6 cancelled
full npm test (HEAD worktree, same sandbox)                                      534 total / 488 pass / 40 fail / 6 cancelled
failure-identity diff vs HEAD                                                    identical, except one flaky voiceover test (below)
npx tsc --noEmit --pretty false                                                  30 diagnostics, all src/index.ts (identical to HEAD)
npx wrangler deploy --dry-run                                                    exit 0 - 2960.25 KiB (1350.96 KiB gzip)
createHTML() served markup                                                       new hint + dock footer copy present
```

The three extra tests are this section's (+2 in `tests/timeline-editor.test.mjs`, +1 in `tests/final-media-cap-actions.test.mjs`). The failure-identity diff against a `git worktree` of HEAD is empty **except** `handleVoiceover strips bare URLs, fails over when MeloTTS returns empty output, heals WAV->MP3 container switches, and honors AbortSignal` in `tests/deep-debug-regressions.test.mjs`, which failed once inside the loaded full run and passes twice in isolation on **both** trees (an earlier full run of this tree matched HEAD exactly at 40 failures / 491 passes). It is a pre-existing load-sensitive test in a Worker/voiceover suite that this section does not touch.

What the new tests actually assert:

1. *"a Neon Night row applies the neon image effect together with the VHS effect on every scene"* - `state.videoStyleEffects === ["neon","vhs"]`, all 12 scenes and all 12 project-detail scenes carry `neon,vhs`, the heading names both, and seeking at 0.83 s **and** 5.8 s paints a radial gradient with the modal's `rgba(255,45,149,0.08)` stop **and** fillRects wider than 300 px with a height of 9 px or less (the rolling bars).
2. *"a Cinematic Film row paints the template-modal double gradient on every video and image scene"* - `["duotone"]` on the project, on all 12 scenes, and a linear gradient whose three stops are exactly `rgba(255,107,53,0.42)`, `rgba(255,107,53,0.12)`, `rgba(46,196,182,0.44)` is repainted at 1 s (image scene) and 10 s (video scene), with different `x0`/`x1` (the gradient moves).
3. *"the edit icon passes the row's live video style into the project detail and the timeline handoff"* - the style select is changed **without** dispatching `change`, the ✎ button is clicked, and `basicSettings.style`, `projectDetail.style/effects/effectLabel/sceneCount/scenes[]`, `timelineState.videoStyle/effects/scenes[]`, the localStorage payload and the cookie mirror all agree. A second pass with `change` dispatched and `Neon Night` selected yields `["neon","vhs"]` everywhere.

Honesty notes:

- The suite is **not** green and was never green: the 40 failures / 6 cancellations are the pre-existing Pixabay, relay, image-batch and e2e groups already listed in Sections 8.6, 10.8, 11.8 and 14.10. The HEAD worktree comparison in 15.7 shows the same failure set; the focused set is fully green.
- Everything is verified in JSDOM with a recording canvas double. No real browser was available in this sandbox, so the visual weight of the double gradient and the neon + VHS pairing was not eyeballed frame by frame.
- The double gradient is asserted by its **stops and its moving endpoints**, not by pixels: a canvas mock cannot rasterise.

### 15.8 Notes, gotchas and deliberate decisions

1. **Cross-realm `deepStrictEqual` strikes again.** `state.videoStyleEffects` and `state.projectDetail.effects` are arrays created inside the JSDOM realm, so every assertion goes through `Array.from(...)` (Section 14.7.6 found the same trap for cue objects).
2. **Regex literals inside `assert.match` are fragile when the test is generated.** Source assertions that needed `\/` were switched to `TIMELINE_EDITOR_JS.includes('if (/neon/i.test(text)) list.push("neon")')`, which cannot be mangled by escaping layers.
3. **`scene.effects` is load-time data.** Changing `state.videoStyle` in a live session does **not** re-stamp existing scenes (nothing in the UI changes the style today). A future style switcher must call `__videoStyleEffects()` and rewrite `scene.effects` for all scenes.
4. **The Edit click re-reads only script + style.** Re-reading the frame controls would normalise a value the table never showed (`"720p"` → `1024`), changing a handoff contract that other tests pin.
5. **Two painters, one mapping.** `__paintVideoStyleEffects()` lives in `app-js.ts` (used by the table preview and both MP4 renderers) and `drawStyleEffects()` lives in the timeline bundle. The duplication is deliberate and matches the existing `drawSubtitles` split: the timeline must paint without depending on a table-layout module, so the **mapping** is shared (`window.__videoStyleEffects`) while the **painting** is local with a fallback map.
6. **Effects are painted with no media gate.** A scene whose blob has not decoded still gets the treatment over the placeholder, for the same reason as Section 14.5 (JSDOM never decodes media, and the treatment belongs to the style, not the asset).
7. **No CSS and no server work.** `styles.ts`, all Worker routes, KV keys, cookies and the storage schemas are untouched; the only new persisted field is `state.projectDetail` inside the existing per-row `ytvs.timeline-editor.v1.<id>` record.
8. **`bg.speed` stays modal-only.** The modal multiplies the scanline scroll and the duotone shift by `bg.speed`; the timeline uses the playhead time so exports stay deterministic.

### 15.9 Still open

1. **Real-browser eyeball.** The double gradient over a bright Pixabay photo, and the neon + VHS stack, are asserted structurally, not visually.
2. **`row.style` and the canvas filter are not per scene.** `state.videoStyle` still drives `__videoStyleFilter` on Layer 0; a scene-level style override would need the filter call to read `scene.videoStyle` too.
3. **The editor layout's non-timeline gallery previews remain unstyled** (unchanged boundary from Section 12) even though the shared `generateMP4()` renderer now paints the treatments.
4. **A style switcher in the timeline does not exist**, so `scene.effects` cannot drift in practice - see 15.8.3 for what must happen if one is added.
5. **The suite is still not green** (Sections 8.6, 10.8, 11.8, 14.10); `npx tsc --noEmit` still reports the long-standing `src/index.ts` diagnostics.

### 15.10 Status

- Branch: `arena/4d1103b2-text-to-image-template` (the only branch this section was written on).
- The documented source of truth is the current code in this workspace; this file now matches it.
- Focused suites 80/80 green; no new full-suite failures relative to the pre-existing set.
