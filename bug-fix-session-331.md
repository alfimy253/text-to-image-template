# Bug Fix Session 331 — Browser-owned pipeline management storage

Date: 2026-11-04 (sections 1–24); claim-verification pass 2026-11-09
Branch: `arena/1bf21096-text-to-image-template` (active Arena task branch; earlier sections were written on the branches named in their own Status blocks)
Source of truth: the current code in this workspace. This session does **not** use older rules Markdown as authority. On 2026-11-09 every claim below was re-checked against the code, done items were removed from the open lists and uncertain ones were tagged **DONE** — start with §0.

## 0. System user flow — the whole product in one pass (verified against code, 2026-11-09)

> **Added by the 2026-11-09 claim-verification pass.** Every statement below was checked against the files named in parentheses; nothing is copied from another Markdown file. §0.10 records what was checked, what was removed from the later "Still open" lists because it is already done, what carries a **DONE** tag, and which old claims in this file were corrected.

### 0.1 One-sentence summary

A Cloudflare Worker (`src/index.ts`) serves one cached HTML page (`src/page.ts` → `src/client/markup.ts`) whose browser bundle (`APP_JS` with six inlined client modules, plus `API_ROTATION_JS`, `TEMPLATE_COMPOSER_JS` and `TIMELINE_EDITOR_JS`) turns a plain narration script into a fixed **12-scene** stock-media video (`4` Pixabay videos + `8` Pixabay photos) entirely in the browser, with the Worker supplying scripts, voiceover, Pixabay credentials and API-relay routing.

### 0.2 The three layouts a user can be in

| Layout | How the user gets there | Purpose | Code anchor |
|---|---|---|---|
| Quick Batch **table** | `[data-layout="table"]` switch in the studio shell | Many script rows → finished videos, with silent stage progress | `src/client/app-js.ts` `setStudioLayout()`, `renderBatchTable()` |
| **Editor** | `[data-layout="editor"]` switch | One video per accordion: script → voiceover → Pixabay gallery → preview → MP4 | `initVideoStudio()`, `addVideoAccordion()` |
| **Timeline** (`?layout=timeline`) | The `✎` Edit icon on a **finished** Quick Batch row (`openBatchEditPage()`) | Timing/element editor for one row: 70/30 preview, tracks, scene media, text/graphics, MP4 export | `src/client/timeline-editor.ts`, `applyTransitionProject()` |

The timeline is a separate page. Its boot branch runs only `applyTransitionProject()`; it never calls `initVideoStudio()`, `bindStudioShell()`, `restorePipelineManagementState()`, the pipeline persistence listeners, `bindLandingActions()` or `initAuth()` (`src/client/app-js.ts`, boot tail). Media bytes travel by IndexedDB (`ytvs-timeline-editor-assets-v1`), timing lives under `ytvs.timeline-editor.v1.<projectId>`.

### 0.3 Quick Batch (table layout) — the end-to-end user flow

1. **Land.** The Worker canonicalises the URL, applies the theme/CMS shell and returns the cached HTML. `/free` opens the studio directly.
2. **Boot the shell** (table and editor layouts share it), in this order: `initVideoStudio()` → `bindStudioShell()` → `restorePipelineManagementState()` → `purgeCompletedBatchRows()` → `restoreCompletedBatchRows()` → `scheduleCompletedBatchPurge()` → `applyTransitionProject()` → `ensureEditorAccordionOnLoad()` → `bindLandingActions()` → `initAuth()` → `persistPipelineManagementState("startup")` → one `storage` listener and one `beforeunload` listener.
3. **Add rows.** Up to `VIDEO_MAX_VIDEOS = 10` rows (`BATCH_ROW_LIMIT`); the pipeline store keeps at most 8 (`MAX_ITEMS = 8`).
4. **Fill a row.** Script, video style, resolution, orientation, quality. `row.minutes` still exists as a silent fallback (1–6) but has **no** rendered control — the `Min` column is gone.
5. **Press ✦ Generate.** `generateBatchRows()` runs only rows that pass `batchRowReadyForGeneration()` — has a script, stage `ready` or `queued`, not running/retrying/stopped/busy/finished. Staged or unprepared rows are refused with a modal that says so, and the toolbar shows `N rows with a script · R ready`. Concurrency is `BATCH_RUN_CONCURRENCY = 3`, and `startUnprocessedRows()` is reentrancy-guarded so later rows start as early stages free up.
6. **Watch the stages** (silent): `voice` → `timing` → `prompts` → `images` → `animate` → `done`. Non-media failures are retried in place by `batchRunPipelineStage()` (1 + 7 attempts, 40 s backoff, only the failed stage reset, STOP never retried). Media items run their own 7-attempt ladder and never restart a whole stage.
7. **Finish gate.** A row is finished only when `batchRowFinished()` is true: MP3 + animation + exactly 12 images + 12 slides + 4 `video/mp4` clips + 12 unique stock filenames.
8. **Act.** All three Action icons are always drawn — `▶` preview, `⚙` process export, `✎` edit — and all three stay `disabled` until the row is finished. There is no text in the Actions column.
9. **Export.** Preview and export are client-side WebCodecs/`generateMP4()`; `/api/render*` and `apiRenderVideo()` still exist but have **no active call site**.
10. **Survive a refresh.** A successful render/export is archived in `ytvs.quick-batch-completed.v1`, shown 5 per page (`BATCH_PAGE_SIZE = 5`), and deleted by the browser after 24 h (`BATCH_COMPLETED_TTL_MS`), with an hourly purge.
11. **Edit.** `✎` writes a transition-only payload to `MEDIA_TRANSITION_STORAGE_PREFIX + key` with a `ytvs_transition_project_<key>` cookie mirror, moves the media Blobs through IndexedDB and opens `?layout=timeline&pipelinePage=timeline-<pageId>-row-<id>&projectEdit=<key>`. The payload is accepted only when the localStorage `createdAt` equals the cookie mirror's `createdAt`; both entries are consumed on read.

### 0.4 Editor layout — the user flow

1. The editor boots with **one accordion already open** (`ensureEditorAccordionOnLoad()`); the `＋ Add Video` button stays unpressed and is editor-only.
2. The user sets topic, minutes, style, resolution, orientation and quality, then starts script writing. `/api/script` is called with client-owned retries; the script textbox stays pinned while writing/retrying; the finished note is stored **client-side only** (`script-notes-client.ts`, localStorage + cookie, never KV).
3. Voiceover: `/api/voiceover` chunks, sanitises and synthesises the MP3.
4. Planning: `/api/seo-plan` and `/api/image-prompts` return typed Pixabay keyword scenes (never AI images).
5. Media: `pixabay-direct.ts` reads `/api/media/config`, claims credits (`/api/media/claim`), searches/downloads Pixabay directly, validates bytes and settles unused credits (`/api/media/settle`). When direct mode is unavailable, `browser-offload.ts` uses `/api/image` (binary) or `/api/image-batch` (NDJSON) under capability version 261.
6. The gallery fills to the fixed 12-scene plan; preview and MP4 export are client-side. State survives a refresh through the same pipeline-management store as the table.

### 0.5 Timeline editor — the user flow

1. Opening Edit builds the 12-scene timeline from the row (`batchTimelineState()`): a pinned **Scene Media** background lane (`layer: 0`, Pixabay images/GIF/MP4), up to **4** text/graphics lanes, a collapsed Soundtrack group with voiceover, sound effects and background music, and a hidden read-only **SUBTITLES** layer built from the row's cues. If no text or graphic exists, one dummy text clip is seeded at `0:00`.
2. Selection drives a 70/30 stage row: a background clip (or its child) opens the 30 % child panel on the left; anything else keeps the full-width preview.
3. Editing: seconds sliders stop at `MAX_TIMING_SEC = 80`; clips can be dragged and resized in the dock; text and graphics can be dragged on the preview canvas (X/Y percentages, `item.x` / `item.y`); children are clamped inside their background clip; `⧉ Duplicate` always puts the copy immediately after the original (a background duplicate clones its scene and children).
4. `resolveTimelineOverlaps()` runs on every addition, duplicate, import, timing change, undo/redo and load, and pushes later boxes clear (1 ms `TIMING_EPSILON_SEC`), with children following their background.
5. `Ctrl/⌘ + Z` and `Ctrl/⌘ + Shift + Z` undo/redo the timing/element model (not binary media). `＋ Text` / `＋ Graphic` are sticky and never placed in an occupied window at creation time. `＋ Add Clips` opens the template composer's own modal; the appended MP4 becomes the last Scene Media scene. `⬇ Export MP4` renders the open project offline with WebCodecs + `window.Mp4Muxer`.
6. Everything autosaves to `ytvs.timeline-editor.v1.<projectId>`; closing the tab and re-opening the same row restores the timing.
7. **Back to the table** publishes the edit (§26): `publishTimelineEdit()` writes a compact per-scene summary into the table page's pipeline store (`ytvs.pipeline-management.v1.<pageId>` + its four cookies) under the row's own `vid`, so the row comes back with `timelineEdited`, the edited length, the edited scene order and the edited per-scene seconds — which is what `▶` Preview and `⚙` Export then render.

### 0.6 Storage, tabs and recovery

- **Page identity.** `?pipelinePage=` wins, otherwise `sessionStorage["ytvs.pipeline-page.v1"]`, otherwise a freshly generated `pageId`. A new tab gets a new id and therefore an empty table and editor; a **duplicated** tab clones `sessionStorage` and therefore shares the id (documented caveat, §8.6 #5).
- **Pipeline management** (table + editor): full snapshot in `ytvs.pipeline-management.v1.<pageId>`, mirrored in **four** session cookies `ytvs_pipeline_management_<pageId>_1..4` (chunks capped at 3800 encoded chars, no `Max-Age`, `ttl: 0`). A save is trusted only when the localStorage `updatedAt` equals the cookie `t` **and** the FNV digest matches; a mismatch repairs the cookies from localStorage. The store bounds rows/projects to 8 and scripts to 800 chars until all four chunks fit.
- **Recovery.** A failed or unverified save shows `#pipeline-storage-alert` with a **Reset pipeline state** button (`resetPipelineManagementState()` → `pipelineManagementStore.clear()`), which wipes this page's record, four cookies and the in-memory rows/queue.
- **No TTL** on pipeline management; stale page ids are not garbage-collected.
- **Timeline**: separate key, IndexedDB for media bytes; no pipeline-management read or write at all.

### 0.7 AI, relay and media request flow

1. For an allow-listed AI path the browser first calls `GET /api/relay/endpoint?path=…` (`src/client/api-rotation.ts`).
2. The Worker picks the endpoint (`pickRelayEndpoint()` in `src/modules/api-relay.ts`): a round-robin ring where this UI Worker appears `localWeight` times (default 1) and every backup `RELAY_BACKUP_RING_WEIGHT = 3` times — with one backup the UI Worker answers 1 request in 4, with five (the `MAX_RELAY_WORKERS = 5` cap) 1 in 16.
3. A local pick returns the relative path and no ticket; a backup pick mints a short-lived 3-minute client ticket scoped to the AI paths. The browser then calls **exactly** the given URL (ticket, `credentials: "omit"`, CORS). If it does not answer, the browser reports once with `&failed=<id>` and calls the new answer, then falls back to its own origin.
4. Pixabay media never goes through a model: the Worker hands out the key through `/api/media/config`, and the browser fetches `pixabay.com` / `cdn.pixabay.com` directly (12 per page, pages 1–2, photo 8 MiB / clip 16 MiB, magic-byte validation, shared rate limiter).

### 0.8 Export flow

Both user-facing exports are browser-side: Quick Batch row export (`exportBatchRow()` → `generateMP4()`) and timeline export (`⬇ Export MP4` → `window.Mp4Muxer`). The legacy worker-render routes (`/api/render`, `/api/render/<id>`, `/api/worker/poll|deliver|failed`) and the `apiRenderVideo()` / `workerRunJob()` helpers remain in the source but are dormant.

### 0.9 Where each flow lives

| Concern | File |
|---|---|
| Worker routes, capabilities, HTML caching | `src/index.ts`, `src/page.ts` |
| Page markup, storage banner, timeline scaffold | `src/client/markup.ts` |
| Studio + Quick Batch + editor + pipeline store hooks | `src/client/app-js.ts` |
| Per-tab localStorage + 4-cookie store | `src/client/pipeline-management-store.ts` |
| Timeline model, tracks, canvas, export | `src/client/timeline-editor.ts` |
| Timeline CSS, dock, 70/30, panels | `src/client/styles.ts` |
| Relay hand-out and ring | `src/modules/api-relay.ts`, `src/client/api-rotation.ts` |
| Scripts, SEO, prompts, media, voiceover | `src/modules/script-seo.ts`, `image-prompts.ts`, `pixabay.ts`, `image-batch.ts`, `voiceover.ts` |
| Template composer modal | `src/client/template-composer-js.ts` |
| Admin/config page | `src/client/config-page-js.ts` |

### 0.10 Claim-verification pass — 2026-11-09

#### 0.10.1 Method and limits

- Static reading of the files named above plus targeted `grep`/`sed` checks for every constant, cookie name, key and function named in this document.
- `npm install` (78 packages), then `npx tsc --noEmit` and per-file `node --import tsx --test` runs. The single serial `npm test` does not finish inside this sandbox (it was still running at 25 min), so the suite was measured **per file** (43 of the 45 `*.test.mjs` files completed, `-P 6`, 240 s per file; `deep-debug-regressions` and `session-264-editor-render` never finished, `session-250` was re-run separately).
- `node --import tsx simulations/pipeline-management.mjs` re-run: exit 0 with the same transcript as §6 / §8.7.
- **Not available:** a real browser, `wrangler dev` (no `CLOUDFLARE_API_TOKEN`), and the `deep-debug-regressions` and `session-264-editor-render` suites (neither finishes in a 240 s / 700 s window). Anything that needs eyes — sticky offsets, gradients, drag feel — remains an open item, as the later sections already say.

#### 0.10.2 Measured state at this pass (baseline commit `407ab86`, clean tree)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **30** diagnostics, **all** in `src/index.ts` (unchanged from the documented count) |
| `tests/timeline-editor.test.mjs` | 35 / 35 pass |
| `tests/quick-batch-table.test.mjs` | 15 / 15 pass |
| `tests/final-media-cap-actions.test.mjs` | 11 / 11 pass (61 / 61 with the two above) |
| `tests/template-composer.test.mjs` | 20 / 20 pass |
| `tests/api-relay.test.mjs` | 31 / 36 pass (the 5 documented binary/Pixabay cases) |
| `tests/session-244.test.mjs` | 8 / 10 (the 2 documented retry cases) |
| `tests/session-250-batch-pipeline.test.mjs` | 8 / 13 (5 failures, one more than the old note) |
| `tests/seo-walkthrough.test.mjs` | 7 / 17 (10 failures, AI-image-disabled fixtures) |
| `tests/session-262-load-balancing.test.mjs` | 9 / 14 |
| `tests/session-261-browser-offload.test.mjs` | 13 / 23, 4 failures + 6 cancellations |
| `tests/llm-openrouter.test.mjs` | 23 / 24 |
| Aggregate of the 43 completed test files | **540 tests / 502 pass / 32 fail / 6 cancelled** |
| Not completed | `deep-debug-regressions` (> 700 s), `session-264-editor-render` (> 240 s) |
| Simulation | exit 0; four cookie chunks, `timestampMatched: true`, cookie-only restore of rows/projects/scripts/`runBusy`/`queued`, new-tab page id empty |
| Source inventory | `src/**/*.ts` **38** files / **77,211** lines; `tests/*.mjs` **47** (45 `*.test.mjs`); `bench/` **14** entries; `APP_JS` **386** function declarations; `src/index.ts.original` 21,009 lines |

The suite is therefore still not green, exactly as §8.6 / §10.8 / §20.15 / §21.11 / §22.18 say — but the aggregate failure count is now **32 + the unfinished files**, not "40", and the failure causes are the fixture/provider ones listed in §24.15, not "legacy media-plan mocks".

#### 0.10.3 Claims checked and found correct

| Claim (section) | Verdict | Evidence |
|---|---|---|
| Four page-scoped cookie chunks, 3800-char cap, no TTL (§4.1, §4.5, rules 11–12) | correct | `pipeline-management-store.ts`: `COOKIE_COUNT = 4`, `MAX_COOKIE_VALUE = 3800`, `ttl: 0`, `writeCookies()` sets no `Max-Age` |
| Trust requires `updatedAt` + digest match; mismatch repairs cookies (§4.5) | correct | store `load()` timestamp/digest comparison and `writeCookies()` repair |
| Cross-tab ping-pong fixed (§4.2) | correct | `pipelineManagementRestoring` guards both `persistPipelineManagementState()` and the restore body; `storage` listener filters on `localStorageKey` |
| Cookie-only restore is no longer lossy (§4.3) | correct | four cookies carry the bounded full snapshot; `restorePipelineManagementState()` restores scripts, titles, settings, `runBusy`, `queued`, `finishedCount`, vids |
| Edit handoff is short, timestamp-matched and `noopener` object-free (§4.4, rule 13) | correct | `openBatchEditPage()` + `readTransitionProjectPayload()` (`createdAt` equality, both entries removed) |
| Storage failure is visible and `clear()` is wired (§3 #10, rule 19) | correct | `#pipeline-storage-alert` / `#pipeline-storage-reset` in `markup.ts`; `showPipelineStorageWarning()` + `resetPipelineManagementState()` |
| Generate only starts ready/queued rows (§8, rule 20) | correct | `BATCH_GENERATABLE_STAGES = ["ready","queued"]`, `batchRowReadyForGeneration()` |
| Finished gate 12/12/4 + 12 unique filenames (§2.4, rule 14 first half) | correct | `batchRowFinished()` |
| Fixed media plan 12 / 4 / 8, `[1,4,7,10]`, `per_page=12`, pages 1–2 (§2.2, rules 4–5) | correct | `AUTO_MEDIA_TOTAL/VIDEO/IMAGE` in `app-js.ts`; `videoScenePositions()`; `PIXABAY_PER_PAGE = 12`; page guard `1 or 2` |
| 7 retries × 40 s, per-stage reset, media ladder, STOP not retried (§2.3, rule 9) | correct | `BATCH_PIPELINE_MAX_RETRIES = 7`, `BATCH_PIPELINE_RETRY_BACKOFF_MS = 40000`, `MediaItemRetryExhausted` bypass |
| Anti-hang guards 90 s / 15 s / 3 / 3 (§2.3) | correct | `BATCH_STREAM_IDLE_TIMEOUT_MS`, `BATCH_AUDIO_DECODE_MS`, `BATCH_IMAGE_STREAM_CONCURRENCY`, `CLIENT_DECODE_THREAD_POOL_SIZE` |
| Eleven explicit persistence call sites (§8.6 #4) | correct | 11 quoted `persistPipelineManagementState("<reason>")` calls |
| Dormant legacy render code (§8.6 #6, rule 16) | correct | `/api/render*`, `/api/worker/*`, `apiRenderVideo()`, `workerRunJob()` present; no active call |
| `IMAGE_PROMPT_MAX_TOKENS = 3584` vs active `max_tokens: 2048` (§8.6 #7) | correct | `image-prompts.ts` export vs the `env.AI.run` call |
| Server-side relay hand-out, round robin, UI Worker smaller share, 5 backups, 3-minute ticket (§24.3–24.7) | correct | `RELAY_ENDPOINT_PATH`, `MAX_RELAY_WORKERS = 5`, `RELAY_BACKUP_RING_WEIGHT = 3`, `pickRelayEndpoint()` |
| Five completed rows per page, 24 h client deletion (§24.9) | correct | `BATCH_PAGE_SIZE = 5`, `BATCH_COMPLETED_TTL_MS = 24 h`, hourly purge |
| Overlap resolver on every add/timing/duplicate/import/load (§24.10) | correct | `resolveTimelineOverlaps()` call sites (8) + `TIMING_EPSILON_SEC = 0.001` |
| 80 s slider cap, four visual lanes, hidden subtitle layer, dummy text (§11, §20, §21) | correct | `MAX_TIMING_SEC = 80`, `MAX_VISUAL_TRACKS = 4`, `.te-subtitle-*` aria-hidden lane, `dummyTextItem()` |
| 10 px child panel, square neo buttons, borderless top scroll layer (§21–§22) | correct | `#timeline-child-panel * { font-size: 10px !important }`; the `html[data-theme="neo"] … { border-radius: 0 !important }` sweep; scroll-lane border rules removed |
| Red inverted-triangle seeker (§13.4) | correct | `.te-playhead-handle` with `border-top: 13px solid #ef4444` |
| `＋ Add Clips` opens the composer modal; `＋ Add Video` is editor-only; helper paragraph removed (§22) | correct | `openTemplateClipsModal()` → `window.__TIMELINE_TEMPLATE_CLIP__`; `#bulk-toggle` only in the editor markup; no `batch-hint` paragraph |
| `apiRenderVideo()` has no active call site (rule 16) | correct | only its definition remains |

#### 0.10.4 Claims that were wrong or stale — corrected in this pass

| # | Old claim | Reality | Where fixed |
|---|---|---|---|
| 1 | Page assembly injects `APP_CSS`, `API_ROTATION_JS`, `APP_JS`, `TEMPLATE_COMPOSER_JS` and prompts | It also injects **`TIMELINE_EDITOR_JS`** (`src/page.ts` lines 24 / 54) | "Runtime architecture" #2 |
| 2 | `src/**/*.ts` 37 files / 70,031 lines; `tests/*.mjs` 46; `bench/*` 12; 355 function declarations in `APP_JS` | **38 / 77,211**; **47** (45 `*.test.mjs`); **14**; **386** | "Study boundary and code surface" |
| 3 | Boot order is `initVideoStudio` → `bindStudioShell` → `restorePipelineManagementState` → `applyTransitionProject` → `bindLandingActions` → `initAuth` → persist | Completed-row purge/restore/schedule and `ensureEditorAccordionOnLoad()` now sit between restore and `applyTransitionProject()` | "User flow" #2 |
| 4 | Edit opens a short URL with `layout=editor` and "forces the editor layout" | It opens **`layout=timeline`**; `applyTransitionProject()` activates `#view-timeline` and returns before creating an editor project | "User flow" #12, rule 13 |
| 5 | Route table has no relay hand-out route | **`GET /api/relay/endpoint`** exists and is the only way the studio learns a backup URL | "Route surface" |
| 6 | Rule 14: "Preview and Export unlock together" | **Three** icons unlock together (`▶`, `⚙`, `✎`), all disabled until `batchRowFinished()` | rule 14 |
| 7 | Rule 15: "`api-rotation.ts` rotates … to verified backup Workers with a ticket" | The **Worker** now chooses the endpoint; the browser asks, waits and calls exactly that URL | rule 15 |
| 8 | §8.6 #9 "legacy mocks still assume older media plans ([2,5,7,10], [1,8])" | No such fixtures exist; every Pixabay/batch test uses `[1,4,7,10]`. The real causes of the red tests are the ones in §24.15 | §8.6 #9 |
| 9 | §8.6 #8 / §9.6 "40 failures, 6 cancellations, 514–521 tests" | At this pass: **32 failures + 6 cancellations** across 43 completed files (540 tests), plus two suites that do not finish; `tsc` still 30 | §8.6 #8, §8.7, §9.6 |
| 10 | §2.5 "first implementation": one cookie `ytvs_pipeline_management`, `Max-Age=172800`, compact digest mirror | Superseded: **four page-scoped session cookies**, no `Max-Age`, full bounded snapshot | §2.5 |
| 11 | §4.2 "Every tab now has a different page key" | True for a newly **opened** tab; a **duplicated** tab clones `sessionStorage` and shares the page id | §4.2, §8.6 #5 |
| 12 | §21.14 annotation: "the `＋ Add media` overlap note still stands" | It does not: after §22.9 `＋ Add Clips` is the composer and `＋ Add media` is the file/IndexedDB picker | §21.14 |
| 13 | §10.8 #6 / §17.11 #7 / §22.18 counts (e.g. "timeline-editor 33/33") | Current: timeline-editor **35**, quick-batch-table **15**, final-media-cap-actions **11** | the three status lines |

#### 0.10.5 Items removed from the open lists because they are already done

Removed from the sections named below; each is now evidenced in §0.10.3 and is **no longer a to-do**:

| Was open in | Item | Why it is done |
|---|---|---|
| §3 audit | 1 — cross-tab storage ping-pong | `pipelineManagementRestoring` guard + page-scoped key + filtered listener |
| §3 audit | 4 — `noopener` Edit handoff, giant inline `projectJson` | `openBatchEditPage()` writes a transition payload + cookie mirror and opens a short `layout=timeline` URL; no child-window object |
| §3 audit | 5 — cookie mirror can exceed 4 KB | four 3800-char chunks + `boundedSnapshot()` (simulation: max chunk 1018 chars) |
| §3 audit | 6 — cookie-only restore lossy | four cookies carry the full snapshot; restore covers scripts/titles/settings/flags |
| §3 audit | 7 — localStorage had no TTL rule but cookies did | no TTL anywhere; trust is `updatedAt` + digest equality |
| §3 audit | 10 — storage failures swallowed, `clear()` unused | banner + **Reset pipeline state** button |
| §3 audit | 11 — no validation after the integration | validation runs exist (§0.10.2) |
| §11.8 | 5 — subtitles deleted from the timeline | cue data rides in `timelineState.subtitles`, burns onto the preview/export and renders as a hidden read-only lane (§14) |
| §17.11 | 2 — "no ripple option for duplicates; overlaps resolved by array order" | `resolveTimelineOverlaps()` pushes later boxes clear on duplicate/add/timing/load (§24.10) |
| §20.17 | 1 — `BACKGROUND ELEMENT` panel at 7.5 px is too small | the panel is **10 px** since §21.6, with a `#timeline-child-panel *` catch-all |
| §21.14 | 3 — "a commit while an export is running is not blocked" | `openTemplateClipsModal()` and `appendTemplateClip()` both guard `isExporting \|\| recorder` (§22.9) |
| §21.14 | 5 — `＋ Add Clips` and `＋ Add media` "overlap in source" | they are two different surfaces: composer modal vs file/IndexedDB picker (§22.9) |
| §22.17 | 1 — "`✎ Edit` unlocking with the row is a judgement call" | the decision is made and coded: all three icons share the `batchRowFinished()` lock (§22.11) |
| §22.17 | 2 — "the boot accordion is created for `layout=table` boots too" | `ensureEditorAccordionOnLoad()` returns immediately unless `studioLayout === "editor"` |
| §22.17 | 4 — "item 9 guards adding, not dragging; a canvas drag can still overlap" | the §24.10 resolver runs on timing edits and drags too |

#### 0.10.6 Items tagged DONE (present in code, not exercised at runtime)

**DONE** is used narrowly here: the change exists and is statically verified, but this pass could not exercise it in a real browser, so it should not be treated as an open to-do without a fresh reason.

- **§15.9 #3 — "editor layout's non-timeline gallery previews remain unstyled".** DONE (code-verified): every preview/export path shares `generateMP4()` and `__videoStyleEffects()`; not eyeballed in a browser.
- **§22.17 — the "`＋ Add Clips` no longer offers a plain file picker" note.** DONE (code-verified): the timeline bundle's `add-clips` action only calls `openTemplateClipsModal()`, and `appendTemplateClip()` is the only append path; the composer's inner surfaces were not clicked through.
- **§24.15 — the "no more drawdown" note under §24.5's reading.** DONE (code-verified): the browser-side cursor/skip-list/failover state is gone; only `window.__yvsApiRotation.stats()` counters remain. Whether the user meant a different "drawdown" is still unconfirmed.

#### 0.10.7 What genuinely remains open (index)

Everything else keeps its original section and wording: the retry/backoff deadline, `for (;;)` waits, non-transactional persistence and no garbage collection (§3, §8.6); the missing minute control and the `[data-batch-field="minutes"]` tolerance (§10.8); the real-browser eyeball items (§11.8, §15.9, §16.10, §17.11); no lane reordering, no media drag, no canvas resize/rotate (§10.8, §16.10); no drag-to-reparent or multi-select (§17.11); undo/redo not covering binary media (§20.17); the clips modal's lack of trimming and the unpersisted queue (§21.14); the composer modal's missing "clips you already have" list and the sub-second epsilon (§22.17); the red test files and the slow `session-264` suite (§24.15); and the dormant `/api/render*` code plus the `IMAGE_PROMPT_MAX_TOKENS` mismatch (§8.6).

#### 0.10.8 Reproducing this pass

```text
npm install
npx tsc --noEmit                                  # 30 diagnostics, all src/index.ts
node --import tsx --test tests/timeline-editor.test.mjs tests/quick-batch-table.test.mjs tests/final-media-cap-actions.test.mjs
node --import tsx --test tests/template-composer.test.mjs tests/api-relay.test.mjs
node --import tsx simulations/pipeline-management.mjs
git status --porcelain                            # clean tree at 407ab86 before the edit
```

## 1. Purpose

> **2026-11-09:** this file now opens with §0 — a single system-wide user-flow summary plus the claim-verification pass that removed the already-done items from the later "Still open" lists. Sections 1–24 keep their original wording (history), with in-place status annotations where the code has moved on.
>
> **2026-11-09 (later):** **§25** records the five fixes requested after that verification pass — pill-shaped SEO walkthrough steps, the removed Pixabay link, a duplicate media filename moving the Pixabay result page, script-anchored scene keywords (no language model) and a timeline whose length is its content. Each one is coded, tested and verified there.

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

> **Partly superseded by §22.11 (2026-11-08):** the `Actions` column still holds Preview, Process Export and Edit, but an unfinished row no longer prints the `Preview Here · Export Video` sentence — all three icons are drawn for every row and stay `disabled` until `batchRowFinished(row)`, which now includes `✎ Edit`.

Quick Batch has one `Actions` column:

- Preview
- Process Export
- Edit
- no row AI enhancer button

Edit uses `batchProjectJson()` and `openBatchEditPage()`. Before Session 331 it used inline `projectJson`, a localStorage fallback and a `noopener` child-window object assignment.

The editor pins its script textbox during script writing/retries and shares the fixed 12-scene media contract.

### 2.5 First pipeline-management storage implementation

> **Superseded by §4.1–§4.5 (verified 2026-11-09):** the shipped store uses **four page-scoped session cookies** (`ytvs_pipeline_management_<pageId>_1..4`, 3800-char chunks), there is **no `Max-Age`** and no TTL at all, and each cookie carries a slice of the **full** bounded snapshot rather than a compact digest mirror. The paragraph below is the history of the first attempt only.

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

Status legend (2026-11-09 verification): **DONE** = fixed in code and re-checked in this pass; **OPEN** = still true today.

1. **Cross-tab storage event ping-pong. — DONE.** `pipelineManagementRestoring` now blocks `persistPipelineManagementState()` during a restore, the `storage` listener only reacts to this page's `localStorageKey`, and every independently opened tab has its own page key. *Residual caveat:* a **duplicated** tab clones `sessionStorage`, so it shares the page id and can still receive its own write-back; see §8.6 #5.
2. **No absolute deadline for a silent retry stage. — OPEN.** `batchRunPipelineStage()` still allows 1 + 7 attempts with 40 s backoff plus request time; a step that never settles still pins the row silently (`BATCH_PIPELINE_MAX_RETRIES = 7`, `BATCH_PIPELINE_RETRY_BACKOFF_MS = 40000`).
3. **Web Locks loop can wait indefinitely. — OPEN.** `coordinated()` in `browser-offload.ts` and `requestNext()` in `progressive-image-pipeline.ts` both still use `for (;;)` with no deadline, relying on cancellation or an external condition.
4. **Edit handoff with `noopener`. — DONE.** `openBatchEditPage()` no longer uses inline `projectJson` or a child-window object: it writes the transition payload to `MEDIA_TRANSITION_STORAGE_PREFIX + key`, mirrors `createdAt` in a cookie, and opens a short `?layout=timeline&pipelinePage=…&projectEdit=…` URL. `readTransitionProjectPayload()` consumes both entries only when the timestamps match.
5. **Cookie mirror can exceed browser limits. — DONE.** Four page-scoped cookies of ≤ 3800 encoded chars plus `boundedSnapshot()` (8 rows / 8 projects / 800-char scripts, shrinking until it fits). The simulation measures a 1018-char maximum chunk.
6. **Cookie-only restore was lossy. — DONE.** The four cookies carry slices of the same bounded full snapshot, and `restorePipelineManagementState()` restores scripts, titles, topic/style/minutes/resolution/orientation/quality, `runBusy`, `queued`, `finishedCount`, vids and the safe (`empty`/`writing`/`ready`/`queued`) stages.
7. **No TTL enforcement on localStorage, but cookies had TTL. — DONE.** No `Max-Age` on the active cookies, `pipelineManagementTtl: 0`, and trust requires `local.updatedAt === cookie.t` plus a matching digest; a mismatch repairs the cookies from localStorage.
8. **Storage-event restore can overwrite live work. — OPEN (narrowed).** The listener still calls `restorePipelineManagementState()` unconditionally for a matching key, and restore still sets the layout, rewrites row settings/stages and clears live flags. With per-page keys this only affects tabs that share a page id (a duplicated tab).
9. **Persistence hooks were not exhaustive. — OPEN.** `retryImagePromptFlow()` still starts without a `persistPipelineManagementState()` call, and some script textbox/writing transitions still rely on the surrounding render/stage hooks.
10. **Storage failures were swallowed. — DONE** (section 8). `showPipelineStorageWarning()` drives `#pipeline-storage-alert`, and `resetPipelineManagementState()` is bound to `#pipeline-storage-reset` and calls `pipelineManagementStore.clear()`.
11. **Validation gap. — DONE.** Later sections ran the suite, `tsc --noEmit`, the simulation and route checks; §0.10.2 re-measures them (30 `src/index.ts` diagnostics; 540 tests / 502 pass / 32 fail / 6 cancelled across the 43 files that complete here).

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
- Every **newly opened** tab has a different page key, so another tab's state cannot match this tab's key. *Verified caveat (2026-11-09):* a **duplicated** tab clones `sessionStorage`, so it keeps the same `pageId` and the same key; see §8.6 #5.

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

Bounds (re-verified 2026-11-09, `src/client/pipeline-management-store.ts`): `COOKIE_COUNT = 4`, `MAX_COOKIE_VALUE = 3800`, `MAX_ITEMS = 8` rows **and** 8 editor projects, `MAX_SCRIPT_CHARS = 800` (halved until the four chunks fit, then rows/projects dropped, and finally the whole snapshot emptied). `restorePipelineManagementState()` also slices to 8 rows / 8 projects, so a table with 9–10 rows (`BATCH_ROW_LIMIT = 10`) only persists the first 8.

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

**Re-run 2026-11-09 (verified):** `node --import tsx simulations/pipeline-management.mjs` still exits 0 with the same transcript — four chunks (max 1018 / limit 3800), `timestampMatched: true`, cookie-only restore of 3 rows + 2 projects with scripts/titles/`runBusy`/`queued`, mismatch repair from localStorage, and an empty new-tab page (`p_pageb_1`). The only additions to the output are the `pageId`/`layout` echo fields.

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
| `src/**/*.ts` | **38** TypeScript files, **77,211** lines (re-counted 2026-11-09; was 37 / 70,031) | Runtime Worker + browser source of truth |
| `tests/*.mjs` | **47** files (**45** `*.test.mjs` + 2 harnesses; was listed as 46) | JSDOM/Worker test harnesses; inventoried, not used as runtime authority |
| `bench/*` | **14** entries (was 12) | Benchmarks and smoke harnesses |
| `e2e/*` | 2 files | End-to-end Worker fixtures |
| `render-app/*` | 5 files | Separate render helper service |
| `simulations/*` | 1 file | `pipeline-management.mjs` short logical simulation |
| Config | `package.json`, `wrangler.json`, `tsconfig.json`, `worker-configuration.d.ts` | Scripts, bindings, compiler/runtime types |

`src/index.ts.original` is a 21,009-line backup file, not the active Worker entry. `wrangler.json` points `main` at `src/index.ts`.

`package.json` defines: `npm test` as `node --import tsx --test tests/*.test.mjs`, `npm run dev` as `wrangler dev`, `npm run check` as `tsc && wrangler deploy --dry-run`, and `npm run deploy` as `wrangler deploy`.

`wrangler.json` declares the `AI` binding, `KV_BINDING`, the `PIXABAY_RATE_LIMITER` Durable Object with SQLite migration `pixabay-rate-limit-v1`, observability, compatibility date `2025-10-08`, and `PIXABAY_API_KEY` in `vars`.

### Runtime architecture from code

1. **Single Worker entry.** `src/index.ts` exports the default `{ fetch }` object and exports `PixabayRateLimiter` from `src/modules/pixabay.ts`.
2. **Cached page assembly.** `src/page.ts::createHTML()` caches one HTML string and substitutes `APP_CSS`, `API_ROTATION_JS`, `APP_JS`, `TEMPLATE_COMPOSER_JS`, **`TIMELINE_EDITOR_JS`** (added by §9; re-verified 2026-11-09 at `src/page.ts` lines 24 and 54) and `JSON.stringify(prompts)` into `src/client/markup.ts::PAGE_MARKUP`.
3. **Main client bundle.** `src/client/app-js.ts` injects `PIXABAY_DIRECT_JS`, `BROWSER_OFFLOAD_JS`, `BROWSER_USAGE_JS`, `PROGRESSIVE_IMAGE_PIPELINE_JS`, `SCRIPT_NOTES_CLIENT_JS` and `PIPELINE_MANAGEMENT_STORE_JS` (verified as the six template interpolations at the top of the file). It contains **386** function declarations in the 2026-11-09 static scan (was 355).
4. **Secondary client modules.** `api-rotation.ts`, `config-page-js.ts`, `payment-upload-js.ts`, `template-composer-js.ts`, `template-ring-carousel.ts`, `template-scene-editor.ts`, `template-shape-animations.ts`, `styles.ts`, `aerial-background.ts` and `reel-scene-assets.ts` supply rotation, admin, payment, template, CSS and bundled asset code.
5. **Worker modules.** `pixabay.ts`, `image-prompts.ts`, `image-batch.ts`, `image-load.ts`, `image-queue.ts`, `script-seo.ts`, `script-notes.ts`, `script-notes-api.ts`, `script-event-loop.ts`, `voiceover.ts`, `llm-openrouter.ts`, `api-relay.ts`, `cms.ts`, `payments.ts`, `theme-shell.ts` and `user-pages.ts` implement API routes, queues, planning, media, auth-adjacent pages and admin surfaces.

### User flow

1. **Page load.** The Worker canonicalizes public page URLs, applies the selected theme and CMS links, and returns cached HTML from `createHTML()`. Browser scripts are evaluated in one page context.
2. **Client boot.** `app-js.ts` executes, in order: `initVideoStudio()`, `bindStudioShell()`, `restorePipelineManagementState()`, then the completed-row block (`purgeCompletedBatchRows()`, `restoreCompletedBatchRows()`, `scheduleCompletedBatchPurge()` — §24.9), `applyTransitionProject()`, `ensureEditorAccordionOnLoad()` (editor layout only — §22.10), `bindLandingActions()`, `initAuth()`, then `persistPipelineManagementState("startup")`. It installs one page-scoped `storage` listener and one `beforeunload` listener. A `?layout=timeline` boot runs only `applyTransitionProject()` and none of the above.
3. **Identity and credits.** The shell calls `/api/session` and `/api/credits`. Login, signup and logout use `/api/login`, `/api/signup` and `/api/logout`. `/account` and `/upgrade` are standalone themed pages; `/upgrade` mounts the payment screenshot uploader. The Worker's KV/session remains the authority for credits and authorization.
4. **Layout selection.** `setStudioLayout("editor" | "table")` toggles `#view-editor` / `#view-table` and `[data-layout]` buttons. Each tab receives a pipeline page id from `sessionStorage["ytvs.pipeline-page.v1"]` or a `pipelinePage` URL parameter. `restorePipelineManagementState()` restores only that page's state; a new tab starts empty in both layouts.
5. **Editor script flow.** A user adds a video accordion, enters topic/minutes/style/resolution/orientation/quality and starts script writing. The browser uses `/api/script` with client-owned retry handling. `script-seo.ts` may use internal timestamped cues for validation but returns **plain narration text only**. The finished note is stored by `script-notes-client.ts` in localStorage + cookie, not KV. The script textbox stays pinned during writing and retries.
6. **Editor voiceover.** The plain script goes to `/api/voiceover`. `voiceover.ts` sanitizes typography/emoji, splits into bounded sentence chunks, calls MeloTTS with Deepgram/external fallbacks, and returns MP3 audio.
7. **Editor scene planning.** The full script goes to `/api/seo-plan` and/or `/api/image-prompts`. `image-prompts.ts` plans typed Pixabay keyword scenes, not generated image prompts. The active planner call uses `max_tokens: 2048`; `IMAGE_PROMPT_MAX_TOKENS = 3584` remains an exported compatibility constant.
8. **Editor media import.** `pixabay-direct.ts` reads `/api/media/config`, claims credits with `/api/media/claim`, searches `https://pixabay.com/api/` or `/api/videos/`, downloads from `cdn.pixabay.com`, validates bytes and settles unused credits with `/api/media/settle`. When direct mode is unavailable, `browser-offload.ts` / `/api/image` / `/api/image-batch` provide binary or NDJSON delivery. Both paths target the fixed 12-scene plan.
9. **Editor completion.** Successful photo and MP4 assets fill the gallery, object URLs are retained in memory, filenames are deduplicated per video, and Preview / MP4 export use client-side WebCodecs rendering. `apiRenderVideo()` and `/api/render/*` remain as legacy worker-render code, but the static scan found no active call site for `apiRenderVideo`.
10. **Quick Batch flow.** A user adds rows, types or pastes each plain script, and selects style/resolution/orientation. `#batch-generate` runs only prepared, idle `ready`/`queued` rows, not unprepared `staged` rows. `generateBatchRows()` starts up to `BATCH_RUN_CONCURRENCY` rows; `startUnprocessedRows()` has a reentrancy guard and starts later rows as early-stage capacity opens.
11. **Quick Batch pipeline.** Each row proceeds voice → timing → prompts → combined Pixabay media → animation → done. `batchRunPipelineStage()` owns silent non-media retries. Media items use individual retries. `batchRowFinished()` requires `row.mp3`, `row.animated`, exactly 12 images, exactly 12 slides, 4 `video/mp4` clips and 12 unique filenames.
12. **Quick Batch actions.** The last `Actions` column draws Preview, Process Export and Edit for **every** row, all disabled until `batchRowFinished()` is true. Edit calls `openBatchEditPage()`: it writes a transition-only payload to shared localStorage and a short cookie mirror, then opens a short URL carrying **`layout=timeline`** (not `layout=editor` — superseded by §9), `pipelinePage=timeline-<sourcePageId>-row-<rowId>` and `projectEdit=<key>`. `applyTransitionProject()` consumes the payload only when `createdAt` matches, activates `#view-timeline` and returns before creating an editor project or a `_pipelineVid`. This is the explicit exception to the otherwise-empty new-tab rule.
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
| LLM / relay | `/api/llm/status`, `/api/llm/config`, `/api/llm/test`, `/api/llm/generate`, `/api/relay/endpoint` (**added by §24.3**), `/api/relay/ai`, `/api/relay/ping`, `/api/relay/pool`, `/api/relay/status`, `/api/relay/config`, `/api/relay/test` |
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
14. **Quick Batch completion is strict.** `batchRowFinished()` requires MP3, animation, 12 images, 12 slides, 4 MP4 clips and 12 unique stock filenames. **Preview, Process Export and Edit unlock together** (three icons, all `disabled` + `aria-disabled="true"` before that; superseded by §22.11 on 2026-11-08); the Actions column has no text and no AI enhancer button.
15. **API rotation is server-decided.** *Superseded by §24.3–§24.7 (verified 2026-11-09):* for an allow-listed AI path `api-rotation.ts` asks `GET /api/relay/endpoint?path=…` and calls exactly the URL it is handed (ticket + `credentials: "omit"` for a backup, the relative path for this Worker); the round-robin ring and the failure/cooldown decision live in `api-relay.ts`, and cookies, non-AI routes, KV, credits, CMS and payments stay on the primary origin. The browser no longer holds a cursor, skip list or failover order.
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
- A **newly opened** tab starts empty, but a **duplicated** tab inherits `sessionStorage["ytvs.pipeline-page.v1"]` and therefore the same page id, localStorage key and cookie names. That is the one case where two tabs share pipeline management state; an explicit `?pipelinePage=` overrides it.
- `/api/relay/pool` still exists for diagnostics, but the studio no longer calls it (§24.7); the browser's only pre-call is `/api/relay/endpoint`.
- The pipeline store persists at most 8 rows while the table allows 10 (`BATCH_ROW_LIMIT = 10`); rows 9–10 are live-only and are not restored after a reload.
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

> Re-verified 2026-11-09 (§0.10): items 1–7 are still unfulfilled in the current code, item 8 is re-measured, item 9 is a corrected claim, and done items were removed.

The two named problems are fixed. These loose ends from the earlier code audit remain:

1. **No outer retry deadline.** `1 + 7` attempts with 40,000 ms backoff can exceed 280 seconds plus request time, and a never-settling request can pin a row silently.
2. **`generateBatchRows()` waits on `Promise.all()` in a `while` loop.** There is no global timeout for the generation pass.
3. **Web Locks and progressive loops use `for (;;)`.** Some wait loops have no deadline and rely on an external condition eventually changing.
4. **Persistence remains event-driven, not transactional.** Eleven explicit `persistPipelineManagementState()` call sites (verified: 11 quoted reasons) cover layout, Edit handoff, table render, batch stage, editor start/finalize, transition apply, startup, completed-row purge, beforeunload and reset. A mutation that bypasses those hooks or crashes before one is not durably captured, and `retryImagePromptFlow()` still starts unhooked (§3 #9). The warning detects save failure; it does not make all mutations atomic.
5. **No TTL means stale page records accumulate.** This is intentional under the no-TTL directive, but old `pageId` localStorage keys/cookies are not garbage-collected (`clear()` only touches the current page). A **duplicated** tab clones the `sessionStorage` page id and therefore shares this page's rows until the URL supplies a different `?pipelinePage=`; a newly opened tab is empty.
6. **Dormant legacy render/worker code remains.** `/api/render*`, `/api/worker/*`, `apiRenderVideo()` and `workerRunJob()` are still present although active Quick Batch export is client-side WebCodecs, and no call site invokes them (verified).
7. **Token constant mismatch persists.** `IMAGE_PROMPT_MAX_TOKENS = 3584` is exported from `image-prompts.ts`, but the active `env.AI.run()` planner uses `max_tokens: 2048` (verified).
8. **Validation debt persists, but the numbers changed.** Measured 2026-11-09 on a clean tree: **540 tests / 502 pass / 32 fail / 6 cancelled** across the 43 files that complete in this sandbox, plus `deep-debug-regressions` and `session-264-editor-render` which do not finish (240 s / 700 s windows). `npx tsc --noEmit` still reports **30** diagnostics, all in `src/index.ts`. The old "40 failures / 514–521 tests" figure is stale; see §0.10.2.
9. **Corrected 2026-11-09:** the old claim that legacy mocks still expect `[2,5,7,10]` or `[1,8]` no longer holds — every Pixabay/batch fixture uses `[1,4,7,10]`. The red files are the provider/fixture ones listed in §24.15 (`seo-walkthrough` 10, `session-262` 5, `api-relay` 5, `session-261` 4 + 6 cancelled, `session-250` 5, `session-244` 2, `llm-openrouter` 1), which fail on "AI image generation is disabled; use Pixabay" / missing `PIXABAY_KEY` fixtures rather than on media-plan drift.

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

--- re-measured 2026-11-09 (see §0.10.2) ---
tests/timeline-editor.test.mjs           35/35
tests/quick-batch-table.test.mjs         15/15
tests/final-media-cap-actions.test.mjs   11/11
tests/template-composer.test.mjs         20/20
tests/api-relay.test.mjs                 31/36  (5 pre-existing)
43 completed test files                  540 tests / 502 pass / 32 fail / 6 cancelled
deep-debug-regressions, session-264      did not finish (240 s / 700 s windows)
npx tsc --noEmit                         30 diagnostics, all src/index.ts
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

> **Re-measured 2026-11-09:** the relevant files are `timeline-editor` 35/35, `quick-batch-table` 15/15 and `final-media-cap-actions` 11/11 (the timeline route/handoff assertions live there); across the 43 test files that complete in this sandbox the total is 540 / 502 pass / 32 fail / 6 cancelled. The historical numbers in the block above are kept as the record of that session.

The full suite remains non-green. Its failure/cancellation totals match the Section 8.7 baseline; exact failure identities were not compared. All 29 focused Quick Batch/timeline tests pass, including legacy-track migration, four-lane cap, text and graphic preview across media-scene boundaries, IndexedDB Blob transfer, and row reopen persistence. The reopen test seeds `ytvs.timeline-editor.v1.<targetPageId>` after the transition-project localStorage entry. JSDOM plus an in-memory IndexedDB test validates Blob handoff and storage separation; the local route check is not a real-browser media-decoding test. No server-side timeline computation was added.

## 10. Background-layer timeline and Min-column removal (active request)

> **Partly superseded by §21.3 and §21.9 (2026-11-08):** the `pinned lowest · Pixabay, GIF, image or MP4` caption no longer exists, that cell now also carries `＋ Add Clips`, and the lane label is `Scene Media`.

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

Still open (re-verified 2026-11-09, §0.10 — done items removed, uncertain ones tagged **DONE**):

1. **No visual confirmation in a real browser.** The dock tint, the `BG` badge and the "background layer" placeholder line are styled and asserted statically; they were not eyeballed in Chrome/Safari at 100% and 125% zoom, and `wrangler dev` cannot boot in this sandbox (no `CLOUDFLARE_API_TOKEN`), so the route check is `worker.fetch()` rather than a served preview.
2. **The removed minute field leaves no way to lengthen a silent row.** If `decodeBatchAudio()` returns nothing, a row falls back to `BATCH_MIN_MINUTES = 1` and the UI can no longer raise it. Options if that matters: derive it from the script word count, or expose the value in the timeline inspector instead of the table.
3. **`row.minutes` is now non-editable UI state.** It is still in the pipeline-management snapshot, the Edit handoff (`basicSettings.minutes`) and the prompt request body, so it survives reloads at `1` (or an older saved value) and can drift from the measured narration. It is consistent, just not user-editable.
4. **Legacy markup tolerance.** Verified 2026-11-09, still open: `syncBatchRowsFromDom()` still reads `[data-batch-field="minutes"]` (`src/client/app-js.ts`, the `syncBatchRowInput()` fallback) purely for a cached older client bundle. Delete it once no cached bundle can be in the wild.
5. **`layer: 0` is metadata, not a reorder control.** Verified 2026-11-09, still open: the background track stores `layer: 0` and is always rendered last, and `src/client/timeline-editor.ts` has no reorder action at all (`grep reorder` → none), so no other lane can be dragged under it. If lane reordering is ever added, it must keep the media lane pinned.
6. **The suite is still not green.** Re-measured 2026-11-09: 32 failures + 6 cancellations across the 43 files that finish here, with `deep-debug-regressions` and `session-264-editor-render` not finishing; the causes are the provider/fixture ones in §24.15 plus the structural ones in §8.6, not "stale legacy mocks" (corrected — no `[2,5,7,10]`/`[1,8]` fixtures exist). The focused timelines suites are green: 61/61. This section added no new failures.

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

> Re-verified 2026-11-09 (§0.10): every item below is still unfulfilled in the current code; done items were removed and uncertain ones are tagged **DONE**.

1. **Real-browser eyeball.** Nothing here was rendered in Chrome/Safari at 100% and 125% zoom. The sticky offset (`top: 58px`, `52px` under 560 px) is tied to the topbar's `min-height`; if the topbar wraps to two lines the preview would pin slightly too high until the offset is re-derived from `getBoundingClientRect()`.
2. **`position: sticky` on a flex child needs a scrolling ancestor with room.** Any future change that puts `.te-preview-panel` back inside an `overflow: hidden` wrapper silently turns the pin off; the CSS comment records this.
3. **Sticky preview vs. a very short dock.** The pin is released when the shell's content box ends. The `.te-dock-tail` provides 260 px of that box; if the tail is ever removed, a document that ends exactly at the dock footer would unpin the preview one screen early and the dock would no longer be the last element in view.
4. **The dummy text is only added when the lane is empty.** A row that already has a graphic but no text gets no dummy. That is the requested behaviour ("doesn't have text or graphics"), but it means a graphics-only video has no placeholder text.
5. **The suite is still not green** (Section 8.6 / 10.8; re-measured in §0.10.2). This section added no new failures.

> Removed 2026-11-09: the old item 5 ("`row.subtitles` is still alive for export… no place in the timeline") is **done** — cue data rides in `timelineState.subtitles`, burns onto the preview and export canvases (§14.3) and renders as a hidden read-only SUBTITLES lane (§14.5). Never as editable clips, which stays the design.

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

> Re-verified 2026-11-09 (§0.10): every item below is still unfulfilled in the current code; done items were removed and uncertain ones are tagged **DONE**.

1. **Real-browser eyeball.** The double gradient over a bright Pixabay photo, and the neon + VHS stack, are asserted structurally, not visually.
2. **`row.style` and the canvas filter are not per scene.** `state.videoStyle` still drives `__videoStyleFilter` on Layer 0; a scene-level style override would need the filter call to read `scene.videoStyle` too.
3. **The editor layout's non-timeline gallery previews remain unstyled** (unchanged boundary from Section 12) even though the shared `generateMP4()` renderer now paints the treatments. **DONE (code-verified 2026-11-09; not eyeballed):** every preview/export path resolves effects through `__videoStyleEffects()` and the shared renderer, so this is no longer a known gap — re-open only if a real browser shows an unstyled gallery preview.
4. **A style switcher in the timeline does not exist**, so `scene.effects` cannot drift in practice - see 15.8.3 for what must happen if one is added.
5. **The suite is still not green** (Sections 8.6, 10.8, 11.8, 14.10; re-measured 2026-11-09 in §0.10.2 — 32 fail + 6 cancelled across 43 completed files); `npx tsc --noEmit` still reports the same **30** diagnostics, all in `src/index.ts`.

### 15.10 Status

- Branch: `arena/4d1103b2-text-to-image-template` (the only branch this section was written on); committed and pushed as `5e74958` *"Section 15: row video style into the project detail, template-modal double gradient and neon+VHS on every scene"*.
- The documented source of truth is the current code in this workspace; this file now matches it.
- Focused suites 80/80 green; full-suite failure identity identical to a HEAD worktree (one pre-existing load-sensitive voiceover test excepted, see 15.7); `wrangler deploy --dry-run` compiles (2960.25 KiB / 1350.96 KiB gzip); `tsc --noEmit` unchanged at the 30 pre-existing `src/index.ts` diagnostics.

## 16. Timeline dock: an empty scroll layer at the bottom, a new lane per element, and text/graphics dragged on the preview canvas (2026-11-07)

### 16.1 Request

Four asks about the timeline editor page:

1. Add an **extra layer, empty, at the bottom-most of the tracks**, whose job is to act as a **scroll bar** but which **looks only like a layer** - not like a scrollbar widget.
2. Clicking **+ Text** or **+ Graphic** on the tracks must **produce a new layer on top of the existing layer**, with the text or graphic added to it (one new lane per added element, stacked above the previous lanes).
3. When a **graphic or text is selected**, it must be **draggable on the preview video canvas**.
4. That drag must **update the x / y points** of the element, and the inspector values must stay in sync.

Scope decisions taken from the standing constraints: `bug-fix-session-331.md` is the only doc target, the current workspace code is the source of truth, existing CSS/canvas code is reused, and no new artwork was invented.

### 16.2 Code study that drove the changes

Read-only audit before any edit (`src/client/timeline-editor.ts`, `src/client/styles.ts`, `src/client/markup.ts`):

1. `renderTimeline()` builds the dock HTML string. It emitted the pinned **`SCROLL` corner + `.te-scroll-lane[data-scroll-lane]` first, at the top** of `.te-track-grid`, then the ruler, the text/graphics group, the subtitle group, the background lane and the soundtrack group. The pan gesture lives in the **grid `pointerdown`** handler: `event.target.closest("[data-scroll-lane]")` sets `activeDrag = { mode: "scroll", startX, scrollLeft }`, and the `document` `pointermove` handler writes `document.getElementById("timeline-scroll").scrollLeft = activeDrag.scrollLeft - (event.clientX - activeDrag.startX)`. Any new element carrying `data-scroll-lane` therefore pans the dock for free.
2. `addVisualElement(kind, targetTrack)` **reused** a lane: it fell back to `selectedTrack()`, then to `visualTracks()[0]`, then to `addVisualTrack()`. So **+ Text / + Graphic could not satisfy "a new layer on top"** without changing that path. `addVisualTrack()` **appends** to `state.tracks` (i.e. to the end of the visual group) and is capped by `MAX_VISUAL_TRACKS = 4`.
3. Paint order in `drawPreview()`: Layer 0 is the pinned background lane, then visual lanes are painted **in state order**, so the **last** visual track in state paints **last = highest on the canvas**. No paint-order change was needed for "new lane on top"; only the **dock's reading order** had to be flipped.
4. There was **no canvas item dragging anywhere** in the bundle. Text/graphic items carry `x`/`y` as 0-100 percentages (`text` defaults `50 / 78`, `graphic` defaults `50 / 50`) and the inspector exposes them through `addRange("X position"/"Y position", ...)`, whose callback is `item.x = value; drawPreview(); scheduleSave();`. `addRange` is `controlUI.addRange` (= `reelAddRange` from `template-scene-editor.ts`, which listens on `input` for live values) with a plain number-input fallback in JSDOM.
5. `#timeline-preview-canvas` is inside `.te-preview-stage`, drawn into a fixed `1280x720` buffer and scaled by CSS (`max-width/max-height: 100%`, `object-fit: contain`), so a pointer must be converted through `getBoundingClientRect()` before it can be turned into percentages.

### 16.3 Change 1 - the dock now closes with an empty scroll layer

`renderTimeline()` appends one more row **after the soundtrack group, as the last row of the grid**:

```html
<div class="te-track-label te-track-scroll">
  <span class="te-track-scroll-label">SCROLL LAYER<small>empty · drag to pan</small></span>
</div>
<div class="te-scroll-layer" data-scroll-lane data-scroll-layer="bottom"
     style="width:<track width>px" title="Empty layer: drag left or right to scroll the tracks">
  <span class="te-scroll-hint">Empty scroll layer · drag horizontally to pan the tracks</span>
</div>
```

Deliberate properties:

- **It looks like a lane.** `.te-scroll-layer` reuses the exact lane recipe: `background-color: var(--te-lane)`, the same `repeating-linear-gradient` 80 px grid, `min-height: 44px`, a bottom hairline, and the same 156 px sticky label column. Its hint is styled like the existing `.te-lane-empty-static` pill and is `position: sticky; left: 8px`, so it stays readable after the tracks have been panned.
- **It is not a scrollbar widget.** No `overflow-x: scroll`, no `::-webkit-scrollbar` rules; the gesture is the same grab-drag the pinned lane already used (`cursor: grab` / `:active { cursor: grabbing }`, `touch-action: pan-x`).
- **It is not a track.** It carries **no `.te-lane` class and no `data-lane-track`**, so it can never be selected, seeked on, moved, resized, deleted or counted as a lane; the existing `.te-lane` / `data-lane-track` lookups in the bundle and in the tests are untouched.
- **It pans the dock with the code that already existed** - the grid `pointerdown` handler only needed the element to carry `data-scroll-lane`.

The pinned `SCROLL` lane at the top is kept: the request was to *add* a layer, not to move the existing handle.

### 16.4 Change 2 - every + Text / + Graphic opens a new lane on top

`addVisualElementFromAction(kind)` (the handler behind `add-text` / `add-graphic`, shared by the track buttons and the selected-element header) changed from "reuse the selected lane" to:

```text
lanes < 4  -> addVisualTrack()  (appends to the visual group = highest layer), then addVisualElement(kind, created)
lanes = 4  -> addVisualElement(kind, lanes[last]) and a status line that says the element
              was added to the top layer because four lanes are already open
```

`renderTimeline()` also renders the visual lanes **in reverse state order** (`dockVisuals = visuals.slice().reverse()`), so the newest/highest lane is the **first lane under the TEXT & GRAPHICS header** and the oldest one sits directly above the background lane - the dock now reads top-down like the canvas. Nothing else changed: state order (paint order), the lane ids (`visual-<n>-<ts>`), the labels (`Text & graphics n`), the `n / 4` counter and the four-lane cap all behave as before.

### 16.5 Change 3 - text and graphics are dragged on the preview canvas

New block in the bundle (above `previewTick`), all geometry mirroring `drawText()` / `drawGraphic()`:

- `canvasFrameSize()` / `canvasPointerPoint(event)` - convert `clientX/clientY` into the canvas **buffer** space through `getBoundingClientRect()`, so a CSS-scaled canvas still maps 1:1.
- `itemBounds(item, width, height)` - the grab box. Graphic = a `size` square centred on its anchor; text = its line box (`fontSize * 1.2 * lines`, widest line at `0.6 * fontSize` per character) plus padding, offset by `align` (`left`/`center`/`right`), which is exactly where `drawText` paints.
- `canvasDraggableEntries(seconds)` - every **visible** `text`/`graphic` clip whose start/duration window contains the playhead, **highest layer first**.
- `canvasHitTest(point, seconds)` - first box that contains the pointer; if none does, the **selected** clip is returned when it is a live text/graphic, so a small element never needs pixel-perfect aiming.
- `beginCanvasDrag / moveCanvasDrag / endCanvasDrag` - pointer flow:

```text
pointerdown  hit test -> chooseItem() if it was not the selection -> canvasDrag = {id, startX/Y, originX/Y, width, height}
             cursor: grabbing, setPointerCapture when available
pointermove  dx/dy in buffer px -> /width*100 -> + origin -> clamp 0..100 -> round to 0.1 -> item.x / item.y
             drawPreview() + syncPositionControls(item); a 0.15 % dead zone keeps a plain click a click
pointerup    renderInspector() + persistNow() + status "Text moved - x 55%, y 60%."
```

- Media and audio clips are **not** draggable: `canvasHitTest` only ever returns `text`/`graphic` entries, and the fallback requires the selected clip to be one of those, so a background clip can never be nudged.
- If the selected text/graphic is **not live at the playhead**, the pointerdown writes a status line ("Move the playhead into this clip's time range before dragging it on the canvas.") instead of failing silently.
- A selected graphic gets a **dashed selection box** (`drawSelectionBox`) so it reads as draggable; it is gated by `!recorder && !isExporting`, so exports and the table preview never carry it.
- The canvas is registered with `pointerdown` / `pointermove` (hover sets `cursor: grab`) / `pointerup` / `pointercancel`, and the `document` `pointermove` handler now checks `canvasDrag` first so a drag survives the pointer leaving the canvas. `touch-action: none` was added to `canvas#timeline-preview-canvas` so the gesture works on touch screens.

### 16.6 Change 4 - the inspector X/Y stays in sync with the drag

The two position ranges are tagged by `tagPositionControl(input, "x" | "y")`, which only sets `data-te-position`. During a drag, `syncPositionControls(item)` writes the new percentage into the matching input and re-fires an `input` event, so the shared range control updates its own readout **and** the model through the same callback the slider uses. A `.te-inspector-note` line under the sliders tells the user the clip can be dragged ("Tip: drag this text clip directly on the preview canvas ..."), and the canvas `aria-label` / `title`, the preview note and the dock footer were updated to describe the drag and the scroll layer.

### 16.7 Files touched in this section

| File | Change |
| --- | --- |
| `src/client/timeline-editor.ts` | bottom scroll layer rows; reversed dock order for visual lanes; `addVisualElementFromAction` opens a lane per click; canvas drag block (`canvasFrameSize`, `canvasPointerPoint`, `textLines`, `itemBounds`, `canvasDraggableEntries`, `canvasHitTest`, `beginCanvasDrag`, `moveCanvasDrag`, `endCanvasDrag`, `syncPositionControls`, `drawSelectionBox`); `tagPositionControl`; canvas pointer listeners; `canvasDrag` state |
| `src/client/styles.ts` | `.te-track-scroll`, `.te-track-scroll-label`, `.te-scroll-layer`, `.te-scroll-layer .te-scroll-hint`; `touch-action: none` on `canvas#timeline-preview-canvas` |
| `src/client/markup.ts` | canvas `aria-label`/`title`, preview note, selected-element hint and dock footer copy for the new lane behaviour and the canvas drag |
| `tests/timeline-editor.test.mjs` | +3 tests (scroll layer, lane per click, canvas drag); the two existing tests that assumed a single shared visual lane were updated |
| `bug-fix-session-331.md` | this section |

No Worker route, KV key, cookie, storage schema or persisted field changed: `x`/`y` were already part of the saved element, so a drag only rewrites existing data.

### 16.8 Verification

```text
```text
node --import tsx --test tests/timeline-editor.test.mjs tests/quick-batch-table.test.mjs \
  tests/final-media-cap-actions.test.mjs tests/template-composer.test.mjs \
  tests/public-entry-points.test.mjs tests/editor-subtitles-parity.test.mjs      83 / 83 pass
node --import tsx --test tests/timeline-editor.test.mjs                           23 / 23 pass   (20 before this section)
new Function(TIMELINE_EDITOR_JS)                                                  syntax OK
createHTML() served markup                                                        SCROLL LAYER label, canvas drag aria-label/title, preview note and dock footer copy present
full npm test (this tree)                                                         540 total / 494 pass / 40 fail / 6 cancelled   (759 s, exit 1)
full npm test (worktree of 62f046e, same sandbox, run in parallel)                537 total / 491 pass / 40 fail / 6 cancelled   (exit 1)
failure-name diff vs 62f046e                                                      empty - 46 "not ok" lines on both sides, identical set
npx tsc --noEmit --pretty false                                                   30 diagnostics, all src/index.ts (identical to 62f046e)
npx wrangler deploy --dry-run                                                     exit 0 - 2974.81 KiB (1354.99 KiB gzip); 62f046e was 2960.25 / 1350.96
```

The three extra tests are this section's own (+3 in `tests/timeline-editor.test.mjs`); nothing was added to or removed from any other suite, and the failing/cancelled sets are **identical** to the previous commit, so no pre-existing test changed state. The 40 failures / 6 cancellations are the same pre-existing Pixabay, relay, image-batch and e2e groups listed in Sections 8.6, 10.8, 11.8 and 14.10.
```

What the new tests assert:

1. *"the dock ends in an empty scroll layer that pans the tracks and reads as one more layer"* - exactly two `[data-scroll-lane]` handles, `[data-scroll-layer="bottom"]` is the **last child** of the grid and sits **after** the background lane, it has no `.te-lane` class, no `data-lane-track`, no clips/playhead/empty-track button; the CSS block carries `var(--te-lane)`, the `repeating-linear-gradient` grid, `cursor: grab` and `min-height: 44px` but no scrollbar rules; the sticky hint exists; a pointerdrag on it moves `#timeline-scroll.scrollLeft` by exactly the pointer delta (120 px, then back to 0) and changes no clip.
2. *"each + Text and + Graphic click opens a new lane on top of the lanes already open"* - one click = one new lane, the element lives in the new lane, the previous lane is untouched, the new lane is the **first** `.te-lane` row and the background stays the last, the counter reads `2 / 4` then `3 / 4`, the newest lane is above the previous one in state order, a manual lane brings it to `4 / 4`, a fifth element does **not** open a fifth lane but lands in the current top layer with a status message, and the scroll layer never enters the lane count.
3. *"a selected text or graphic is dragged on the preview canvas and the drag writes the inspector x and y"* - the tagged X/Y inputs exist and start at `50 / 50`; a 64 x 72 px drag on a 1280 x 720 buffer writes exactly `55 / 60` into the item **and** into both inputs; an out-of-canvas drag clamps to `100 / 100`; the cursor is released and the status line reports `Graphic moved - x 55%, y 60%`; `size` is untouched; the saved element carries `x: 55, y: 60`; a text clip drags the same way (`40 / 78`, only the moved axis changes); and after selecting `media-1`, a pointer drag on the canvas moves nothing and keeps the media selection.

Honesty notes:

- The suite is still not green and never was: 40 failures / 6 cancellations, the same pre-existing groups as 62f046e (identical failure-name set, see the block above).
- Everything is verified in JSDOM. jsdom ships no `PointerEvent`, so the tests dispatch `MouseEvent` objects with `pointerdown`/`pointermove`/`pointerup` type names, which the listeners handle identically. jsdom also does not clamp `scrollLeft`, which is why the pan assertion drags back to the **original** x instead of past 0.
- The drag was not eyeballed in a real browser: the px -> % maths, the clamping, the inspector wiring and the persisted numbers are asserted, the *feel* (grab box size, cursor changes) is not.

### 16.9 Notes, gotchas and deliberate decisions

1. **Dock order is not state order any more.** State order is the paint order (last visual track paints last, on top); the dock lists visual lanes reversed so the highest layer is the top row. Anything that walks `.te-lane` in DOM order sees highest-first; anything that walks `state.tracks` still sees lowest-first.
2. **The bottom scroll layer must never be a `.te-lane`.** Several existing tests and the bundle itself count/scan `.te-lane` and `data-lane-track`; reusing those hooks would have made the empty layer selectable, seekable and counted as a track.
3. **+ Text now consumes a lane.** The old cap test looped three manual `addVisualTrack()` calls after one `addTextElement`; it now loops two, because the element action itself opens a lane. The cap itself (four) is unchanged.
4. **The old "one shared lane" assumption was dropped in two tests.** `text and graphics continue rendering ...` and the cap test both used `state.tracks.find(kind === "visual")` to reach an element added later; with a lane per element the lookup has to span the visual lanes (`filter(...).flatMap(...)`). The production behaviour the tests were pinning (a clip keeps rendering for its full seconds-based range across scene boundaries) is unchanged.
5. **`item.x` / `item.y` are the only new writers of position.** No new field, no schema bump: the drag writes the same percentages the sliders write, then `persistNow()` saves the existing record.
6. **The graphic selection box is a preview-only affordance.** It is drawn in `drawPreview()` behind `!recorder && !isExporting`, exactly like the text selection stroke that already existed, so exports stay clean.
7. **`syncPositionControls` re-fires `input` instead of calling the callback directly.** That keeps the range control's own `<output>` readout correct in the real UI (where `addRange` is `reelAddRange`) and is a no-op in the number-input fallback, where the model was already written by the drag.
8. **No CSS variable was invented.** The new rules use the existing `--te-lane`, `--t-line`, `--t-line-2`, `--t-panel-2`, `--t-panel-3`, `--t-muted` tokens with the same fallbacks as their neighbours.

### 16.10 Still open

> Re-verified 2026-11-09 (§0.10): every item below is still unfulfilled in the current code; done items were removed and uncertain ones are tagged **DONE**.

1. **Real-browser eyeball** of the drag feel and of the scroll layer's weight next to a real lane.
2. **The four-lane cap still applies**, so the fifth `+ Text` lands in the current top lane instead of a fifth layer (by design, and the status line says so). Raising `MAX_VISUAL_TRACKS` would be a one-line change plus its test.
3. **The drag is X/Y only** - no resize/rotate handles on the canvas, no keyboard nudging, and no snapping to the centre lines.
4. **Media clips cannot be dragged**; the pinned background stays a cover-fit layer.
5. **The suite is still not green** (Sections 8.6, 10.8, 11.8, 14.10; see §0.10.2), and `npx tsc --noEmit` still reports the same 30 `src/index.ts` diagnostics. This section's timeline assertions remain green (`timeline-editor` 35/35).

### 16.11 Status
- Branch: `arena/4d1103b2-text-to-image-template` (the only branch this section was written on).
- The documented source of truth is the current code in this workspace; this file now matches it.
- Focused suites 83/83 green; `tests/timeline-editor.test.mjs` 23/23; full-suite total 540 with a failure-name set identical to `62f046e`; `wrangler deploy --dry-run` compiles (2974.81 KiB / 1354.99 KiB gzip); `tsc --noEmit` unchanged at the 30 pre-existing `src/index.ts` diagnostics.
- Commit: `4118106` *"Section 16: bottom empty scroll layer, a new lane per text/graphic click, and canvas drag for text and graphics"* (this doc record follows in a second commit, the same pattern as 15.10).

## 17. Duplicate placement, background-owned child text/graphics, and the 70 / 30 child panel (2026-11-07)

### 17.1 Request

The request in this session, verbatim:

> Study code and system make the code the source of truth.....then the md file #331 must also be reference as secondary source of truth........then make a way so we can duplicate a selected element if bg element like video or images are selected then the element must be placed in the timeline in the next time unit after the original when duplicated....when text or graphics ( those that.appear in timeline ) is duplicated it (the duplicate) will be shown in the timeline in the same manner too as bg elements which is next to the original or after the original timing ends......when inside a background element (gif, vids images) or when it is selected there will be add graphic and add text button ...but this child text or graphics timing will be dependent on the bg element only ....it will be dragged to have its position placed and the preview canvas will be shrinked to 70 percent while the left section (30% width) will have the added graphics or text section for editing the elements ...when another timeline element is selected the left section of child element will no longer be shown and the preview canvas will be 100% width again............document this requirements in #331 md file

Acceptance criteria read out of it:

1. **Duplicate a selected element.** A duplicated background clip (Pixabay image, GIF, video/MP4) is placed in the timeline **in the next time unit after the original**.
2. **Duplicate a text or graphic** (the clips that already appear in the timeline): the copy lands **next to the original / after the original timing ends**, the same way background clips do.
3. **A background clip offers ＋ Graphic and ＋ Text.** Selecting (or being "inside") a background element exposes the two add buttons.
4. **The child's timing depends on the background element only** - not on the playhead, not on free timeline time.
5. **The child is dragged on the preview canvas to place it** (the existing canvas drag).
6. **The preview canvas shrinks to 70 %** while the left section (30 % width) shows the added graphics / text section for editing the elements.
7. **Selecting another timeline element hides the left child section** and the preview canvas returns to **100 % width**.
8. **This document** records the requirements and the implementation.

Source-of-truth order used for this section: the current workspace code first; `bug-fix-session-331.md` second (Sections 9-16 explain how the timeline editor reached this state). No older rules Markdown was consulted as authority.

### 17.2 Code study that drove the changes (pre-change audit)

Read before editing (`src/client/timeline-editor.ts`, `src/client/styles.ts`, `src/client/markup.ts`, `tests/timeline-editor.test.mjs`):

1. **Page layout was a vertical stack.** `#timeline-editor` is a flex column: `.te-topbar` (sticky, 58 px), then `.te-preview-panel` (sticky, 320 px stage, `width: 100%`), then `.te-workspace` (the full-width selected-element panel), then `.te-dock`. Section 11 removed the old 30 / 70 side-by-side grid, so the current CSS is the only layout authority; there was **no left section at all** and no `.te-stage-row`.
2. **The item model had no parent relation.** `normalizeItem()` normalized `kind`, `startSec`, `durationSec`, `assetId`, `label`, `visible` and the per-kind fields (`x`/`y`/`fontSize`/`graphic`/`size`/`volume`/`muted`). Nothing linked a text clip to a media clip. The only relations were `sceneId` (a clip belongs to a scene) and the media track itself (`MEDIA_TRACK_ID = "background-media"`, `mediaTrack()`).
3. **The only timeline timing path is `itemTimingChanged(found, newStart, newDuration, rippleDuration, quietInspector)`.** It owns inspector edits, clip drags (`move`), clip resizes (`resize`) and the public `api.setItemTiming`. For a media clip it ripples the following media clips and moves every visual clip that shares the scene (`sceneElementTracks()` + `sceneId`). For visual clips it never touched anything else - so "child timing depends on the background" had to be implemented here or it would be bypassed by the dock drag/resize paths.
4. **`addVisualElement(kind, targetTrack)`** used `activeSceneAt(state.playheadSec)` and `state.playheadSec` for the new clip (start = playhead, duration = 4 s). `addVisualElementFromAction(kind)` (the ＋ Text / ＋ Graphic action) always opens a **new lane** on top (Section 16, capped at `MAX_VISUAL_TRACKS = 4`). There was **no way to create a clip owned by a background clip**, and no duplicate action anywhere in the bundle.
5. **The inspector is rebuilt from `renderInspector()`** (called on every selection change) and `renderItemControls()` renders the per-kind fields. `renderTrackControls()` renders the track-level controls (media upload, audio upload, text/graphic buttons for a visual lane) and `renderItemControls()` handles `media`, `audio`, `text`, `graphic`. The media branch had no child actions.
6. **Canvas drag already exists for text and graphics** (Section 16): `canvasHitTest` → `beginCanvasDrag` / `moveCanvasDrag` / `endCanvasDrag`, writing `item.x` / `item.y` as 0-100 % and syncing `#timeline-inspector [data-te-position]` through `syncPositionControls()`. Media and audio clips are **not** draggable. Requirement 5 therefore needed no new drag code - only the guarantee that a child lands inside its window and that the playhead is inside it, otherwise the drag is refused with a status line.
7. **`deleteSelectedItem()`** deleted the media clip, its scene and every visual clip with that `sceneId`, and revoked the object URL only when no other clip used the `assetId`. It knew nothing about a `parentId`.
8. **Markup and CSS hooks used by tests** are pinned: `.te-preview-panel` must keep `position: sticky` and `width: 100%`; `.te-workspace` must stay `flex-direction: column`; the lane hooks are `.te-lane` / `data-lane-track`. The new left section had to be additive.

### 17.3 Change 1 - the duplicate rule: always the slot right after the original

New action `duplicate` (`⧉ Duplicate`) in the selected-element header, one rule for every clip kind:

```text
copy.startSec    = original.startSec + original.durationSec
copy.durationSec = original.durationSec
copy.id          = makeId(kind)          (never the original id)
copy.label       = "<original label> copy" (or "copy 2", "copy 3" when taken)
copy placed      = right after the original in the same track array
selection        = the copy
```

- For a **background clip** this is exactly the requested "next time unit": one background clip occupies one unit of the timeline, so the copy starts where the original ends (`0:00 - 0:05` → copy at `0:05`).
- For a **text, graphic or audio clip** it is the requested "after the original timing ends" (`2 s + 3 s` → copy at `5 s`).
- `duplicateLabelFor()` strips an existing ` copy` / ` copy 2` suffix before numbering, so repeated duplications do not produce `copy copy copy`.

Background-specific behaviour (`duplicateSelectedItem()`):

1. **The copy gets its own scene.** The source scene is deep-copied, the copy gets a fresh `sceneId`, a `"<source name> copy"` name, the copy's `startSec`/`durationSec`, the same `assetId`, `mediaType`, `mediaName` and `mediaSource`; it is spliced **immediately after the source scene** and every `scene.index` is renumbered. `syncScenesFromTracks()` then keeps the copy's scene in sync with the copy clip, and the saved project carries a real scene record for it.
2. **The copy reuses the same local media asset** (`assetId`), so no Blob/object URL is duplicated; `deleteSelectedItem()` still only revokes the URL when no clip uses that `assetId` any more.
3. **The copy owns copies of the background's children.** Every child clip whose `parentId` is the original is copied into the same lane with the same offset inside the window and `parentId = copy.id` / `sceneId = copy.sceneId`, so the duplicated scene is never an empty background. A child that only partly sits inside the original window is clamped by the same window maths.
4. **A duplicated child stays a child only when it fits.** If a child's copy range ends after the background window, the copy becomes a **free clip** (`parentId = ""`, `sceneId` from the scene under its new start) and the status line says so.

### 17.4 Change 2 - a background clip owns its child text and graphics

**Model.** `normalizeItem()` now writes `parentId` (string, defaults to `""`). No schema bump: an older saved project simply has no `parentId` and loads unchanged. `normalizeState()` calls the new `bindChildTimings(tracks)` on every load, which drops a link whose media clip no longer exists and clamps a live link back inside the background window.

New helpers, all in the bundle next to `mediaTrack()` / `visualTracks()`:

| Helper | Job |
| --- | --- |
| `childWindow(parentItem)` | the background clip's own `[start, start + duration]` |
| `childItemsFor(parentItem)` | every visual clip whose `parentId` is that clip, sorted by start |
| `backgroundContext()` | the background clip the current selection belongs to (the clip itself, or a child's parent). `null` for every other selection - this is the single switch for the 70 / 30 layout |
| `clampChildToParent(item)` | clamps one child into the window and re-links its `sceneId` |
| `syncChildrenToParent(parentItem)` | clamps every child after the background was moved or resized |
| `bindChildTimings(tracks)` | the same clamping at load, without touching `state` |

**Timing authority.** `itemTimingChanged()` is the only timing writer, so both directions are enforced there:

- Editing a **child** (`track.kind === "visual"` and `parentId`) runs `clampChildToParent(item)` first: the child can never start before the window, never end after it, and never be shorter than `MIN_CLIP_SEC` (0.25 s).
- Editing a **background clip** runs `syncChildrenToParent(item)` after the existing scene ripple: children already moved with the scene ripple, the clamp then keeps them inside the new window (shrinking a background shortens/clamps its children; moving it moves them).

**Creation.** `addVisualElement(kind, targetTrack, parentItem)` accepts an optional parent: with one, `startSec`/`durationSec` are the background window (not the playhead, not 4 s), `sceneId` is the background's scene and `parentId` is the background id. `addChildVisualElement(kind, parentItem)` is the action behind every child button: it resolves the parent (explicit or `backgroundContext()`), opens a **new lane on top** like every other ＋ Text / ＋ Graphic click (Section 16 stays true), respects the four-lane cap (at the cap the child lands in the top lane and the status line says so), and parks the playhead at the window start when it sits outside the window so the child is **visible and draggable on the preview canvas**.

**The two buttons.** They exist in two places, both gated by the background clip:

1. **The background clip's inspector** - a new "Child text & graphics" section with `＋ Child text` / `＋ Child graphic` and a note that names how many children are bound and where they are edited.
2. **The 30 % left child panel** - `data-timeline-action="add-child-text"` / `"add-child-graphic"` in the panel header.

The global header `＋ Text` / `＋ Graphic` deliberately keeps its old behaviour (free clip at the playhead in a new lane). They are page-level actions, they are what several existing tests pin, and mixing "sometimes a child" into them would make the same button mean two things depending on the selection. The child actions are the ones that live on the background element, exactly as requested.

**Persistence.** `parentId` rides along in `persistNow()` → `localStorage` (`ytvs.timeline-editor.v1.<pageId>`) automatically; no cookie, KV key, Worker route or handoff field changed. `deleteSelectedItem()` now also drops every clip whose `parentId` is the deleted background clip, so a child can never outlive its owner.

### 17.5 Change 3 - the 70 / 30 stage row and the left child section

**Markup** (`src/client/markup.ts`): the preview panel and the new panel share one wrapper, so the pair behaves as one region:

```html
<div class="te-stage-row" id="timeline-stage-row">
  <section class="te-preview-panel" aria-label="Video preview"> ... unchanged ... </section>
  <aside class="te-child-panel" id="timeline-child-panel" hidden>
    <div class="te-child-head"> BACKGROUND ELEMENT / #timeline-child-title / #timeline-child-window </div>
    <div class="te-child-actions"> ＋ Child text | ＋ Child graphic </div>
    <p class="te-child-hint"> child timing + drag copy </p>
    <div id="timeline-child-list"></div>
    <div id="timeline-child-editor"></div>
  </aside>
</div>
```

The reading order is unchanged: stage row → selected-element panel → dock.

**The switch** is `renderChildPanel()`, called at the end of every `renderInspector()`:

```text
parent = backgroundContext()
row.classList.toggle("te-child-open", Boolean(parent))   (add/remove, no toggle(force))
panel.hidden = !parent
parent ?  fill the head (label + "Pinned window 0:00 - 0:05 · n child elements"),
          list every childItemsFor(parent) as a selectable row (time + ✕ delete),
          and render renderItemControls() for the selected child into #timeline-child-editor
        :  clear the list and the editor
```

**Styling** (`src/client/styles.ts`):

```css
.te-stage-row { position: sticky; top: 58px; z-index: 20; display: flex; width: 100%; }
.te-stage-row > .te-preview-panel { flex: 1 1 auto; }
.te-stage-row.te-child-open > .te-preview-panel { flex: 0 0 70%; max-width: 70%; width: 70%; }
.te-stage-row.te-child-open > .te-child-panel { flex: 0 0 30%; max-width: 30%; }
.te-child-panel { max-height: calc(100vh - 70px); overflow-y: auto; border-left: 1px solid var(--te-border); }
.te-child-panel[hidden] { display: none !important; }
@media (max-width: 860px) {                       /* one column again */
  .te-stage-row { position: static; flex-direction: column; }
}
```

- **The row is the sticky box now, not the panel.** Moving `.te-preview-panel` into a wrapper would have made its own sticky inert (a sticky child cannot travel inside a box exactly as tall as itself), so `.te-stage-row` took over the `top: 58px` / `z-index: 20` pin and `.te-preview-panel` kept its declared `position: sticky` (now inert and harmless, and still the hook two tests assert). The pin therefore survives the extra wrapper.
- The child panel is static inside the pinned row, scrolls on its own above `calc(100vh - 70px)`, and is bounded by the row so the whole pair stays on screen under the 58 px topbar.
- Below 860 px the row stacks into one column **and stops being the sticky box** (`position: static`): a pinned box taller than the viewport would hide the bottom of the child panel and it could never be scrolled to. The preview panel simply pins itself again, exactly as it did before this section.
- `[hidden]` is forced to `display: none` because `.te-child-panel` is a flex container (a plain `hidden` attribute loses to `display: flex`).
- No new colour token: the panel uses `--te-border`, `--te-lane`, `--te-accent`, `--te-muted`, `--t-btn2-*` with the same fallbacks as its neighbours.

**Selection behaviour:**

| Selection | Preview | Child panel |
| --- | --- | --- |
| nothing / a track row | 100 % | hidden |
| a text, graphic or audio clip **that is not a child** | 100 % | hidden |
| a **background clip** | 70 % | open (buttons, list, editor of the selected child) |
| a **child** of a background clip | 70 % | open, that child selected and editable |

The last row is the one deliberate reading of "another timeline element": a child is not "another" element, it is still *inside* the background element, and requirement 6 asks the left section to be where the child is **edited**. Closing the panel the moment the user clicks one of its own rows would make the section unusable. Every other timeline element (text, graphic, audio, a track row, empty space) closes it and restores the full-width preview.

**Child editing in the left section.** `renderItemControls()` is reused, so the child gets its full text/graphic controls (content, font, colour, alignment, X / Y, visibility) **plus** the parent-bound timing pair:

```text
Start inside background (seconds)      min = background.start      max = background.end - 0.25
Duration inside background (seconds)   min = 0.25                   max = background.end - child.start
```

with a note naming the background clip and its window. The dock drag, the resize handle, the canvas drag and `api.setItemTiming` all pass through the same clamp, so a child cannot be dragged out of its owner from any surface. `syncPositionControls()` now writes into **both** `#timeline-inspector` and `#timeline-child-editor`, so a canvas drag keeps the 30 % panel's X / Y readouts in sync too.

### 17.6 Change 4 - the child is dragged on the preview canvas

No new drag code: a child is an ordinary text/graphic clip, so Section 16's canvas drag already moves it. Two small additions make it reliable for children:

1. `addChildVisualElement()` parks the playhead inside the background window when it was outside, because a clip is only painted (and therefore only draggable) while the playhead is inside its range.
2. The child editor carries the same `data-te-position` tags as the inspector, so the drag writes the percentages into both surfaces.

### 17.7 Files touched in this section

| File | Change |
| --- | --- |
| `src/client/timeline-editor.ts` | `parentId` in `normalizeItem`; `bindChildTimings` in `normalizeState`; helpers `childWindow` / `childItemsFor` / `backgroundContext` / `clampChildToParent` / `syncChildrenToParent`; child clamp + `syncChildrenToParent` in `itemTimingChanged`; parent-bound timing ranges and the media "Child text & graphics" section in `renderItemControls`; duplicate button wiring + `renderChildPanel()` in `renderInspector`; `renderChildPanel()`; `addVisualElement(kind, track, parentItem)`; `addChildVisualElement`; `duplicateLabelFor` / `duplicateSelectedItem`; child cleanup in `deleteSelectedItem`; `add-child-text` / `add-child-graphic` / `duplicate` actions; child row select / child delete / Enter-Space in `bindEvents`; both-host `syncPositionControls`; `api.duplicateSelectedItem`, `api.addChildElement`, `api.getBackgroundContext`, `api.getChildElements` |
| `src/client/styles.ts` | `.te-stage-row` (the new sticky box), the 70 / 30 `te-child-open` rules, `.te-child-panel` + `[hidden]`, `.te-child-head`, `.te-child-actions`, `.te-child-hint` / `.te-child-empty`, `.te-child-list`, `.te-child-row` (+ `.selected`, `-label`, `-time`, `-delete`), `.te-child-editor`, `.te-child-editor-title`, the `max-width: 860px` stack fallback |
| `src/client/markup.ts` | `.te-stage-row` wrapper around the preview panel, the `#timeline-child-panel` aside (head, two child buttons, hint, list, editor), `#timeline-duplicate-element` (`⧉ Duplicate`), updated reading-order comment and selected-element hint copy |
| `tests/timeline-editor.test.mjs` | +3 tests (26 total) |
| `bug-fix-session-331.md` | this section |

No Worker route, KV key, cookie, IndexedDB record, storage schema or handoff field changed. The only new persisted field is `parentId` on a visual clip, and it is optional.

### 17.8 Verification

```text
node --import tsx --test tests/timeline-editor.test.mjs tests/quick-batch-table.test.mjs \
  tests/final-media-cap-actions.test.mjs tests/template-composer.test.mjs \
  tests/public-entry-points.test.mjs tests/editor-subtitles-parity.test.mjs    86 / 86 pass
node --import tsx --test tests/timeline-editor.test.mjs                         26 / 26 pass   (23 before this section)
node --check on the generated bundle                                         syntax OK
createHTML() served markup                                                   stage row + child panel + duplicate button present
npx tsc --noEmit --pretty false                                              31 diagnostics, every one in src/index.ts
                                                                             and byte-identical to a 459be7b worktree
npx wrangler deploy --dry-run                                                exit 0 - 3004.31 KiB (1361.60 KiB gzip)
                                                                             459be7b was 2974.81 / 1354.99
```

Full-suite comparison: see 17.9 (run in parallel against a worktree of `459be7b` in the same sandbox).

What the three new tests assert:

1. *"a duplicated background clip lands in the next time unit after the original and carries its own scene and children"* - a background clip selected by clicking its dock clip enables `⧉ Duplicate`; after the click the copy `startSec` is exactly `original.startSec + original.durationSec` (5 s), it keeps the duration, the `assetId`, the label suffix, and sits immediately after the original in the background lane; it owns a **new scene** inserted directly after the original scene, and the background's child graphic is copied with `parentId` / `sceneId` pointing at the copy at the same offset; the save writes both the copy and its scene.
2. *"a duplicated text, graphic or audio clip starts when the original timing ends"* - a text at 2 s + 3 s is copied to 5 s in the same lane, immediately after the original, with the same content; a graphic at 1 s + 2 s is copied to 3 s; a **child** copy that no longer fits the background window becomes a free clip (`parentId: ""`) and the status line says so; all three copies survive a save/read.
3. *"a selected background clip shrinks the preview to 70 % and opens the 30 % child panel with child timing bound to the clip"* - selecting a text keeps the panel hidden and the row out of `te-child-open`; selecting the background clip opens it, names the clip and its `0:00 - 0:05` window, shows both child buttons in the panel **and** in the clip's inspector; `＋ Child text` creates `parentId: "media-1"`, start 0, duration 5 (the window, not the playhead), lists it as the selected row, mounts the child editor with `Start inside background` / `Duration inside background`; `setItemTiming` clamps a 4 s + 10 s edit to 4 s + 1 s and a 30 s edit to 4.75 s + 0.25 s; moving the background to 2 s + 8 s carries the child and the panel window to `0:02 - 0:10`; selecting another clip hides the panel, clears the list and removes `te-child-open`; selecting the child again re-opens the background context; the served markup and the stylesheet carry the panel ids, the child actions, the duplicate button and the 70 % / 30 % / `[hidden]` rules.

Honesty notes:

- Everything is verified in **JSDOM**. jsdom has no layout engine, so the 70 / 30 split is asserted as *state* (`te-child-open` + CSS text) and not as pixel widths. **No real browser was available in this sandbox**, so the visual weight of the panel, the sticky row's behaviour with a long child list, and the drag feel were not eyeballed.
- The child drag reuses Section 16's pointer maths and is covered by that existing test; the new tests assert the child **can** be dragged (it is a normal text/graphic clip with `data-te-position` in both editors) rather than repeating the pixel arithmetic.
- `formatTime()` floors seconds, so a window label reads `0:02 - 0:10` even when the underlying values are fractional.

### 17.9 Full suite and static checks

| Check | This branch | `459be7b` worktree (same sandbox, parallel run) |
| --- | --- | --- |
| `npm test` | see the block below | see the block below |
| `npx tsc --noEmit --pretty false` | 31 diagnostics, all `src/index.ts`, identical set | 31 diagnostics, all `src/index.ts` |
| `npx wrangler deploy --dry-run` | exit 0, 3004.31 KiB / 1361.60 KiB gzip | exit 0, 2974.81 KiB / 1354.99 KiB gzip |

```text
full npm test (this tree, final code)              543 total / 497 pass / 40 fail / 6 cancelled
full npm test (worktree of 459be7b, parallel)      540 total / 494 pass / 40 fail / 6 cancelled
failure-name diff vs 459be7b                       empty - 46 "not ok" lines on both sides, identical set
```

The +3 tests are this section's own (26 - 23 in `tests/timeline-editor.test.mjs`); no test was added to or removed from any other suite, and the same 40 failures / 6 cancellations exist on both sides.

The failure/cancellation sets are the same pre-existing Pixabay, relay, image-batch and e2e groups listed in Sections 8.6, 10.8, 11.8 and 14.10; nothing this section touched moved a test from pass to fail.

### 17.10 Notes, gotchas and deliberate decisions

1. **Duplicate never copies the binary.** A duplicated background clip points at the same `assetId`; the IndexedDB record is untouched and the object URL is still revoked only when the last clip that used it is deleted.
2. **Duplicate can overlap the next scene - by design.** "Next time unit after the original" is literally `start + duration`, and for the 12 fixed scenes that boundary is exactly where the following scene starts. The copy is spliced **immediately after the original in the track array**, and `activeMediaAt()` takes the first match, so inside the overlap the copy is the background that paints. Nothing is rippled or pushed. If "insert and ripple the rest" is wanted later, it is a change inside `duplicateSelectedItem()` only.
3. **A duplicated background copies its children.** The child relation is ownership, so the copy owns copies; a child that would fall outside the copy's window is clamped. A duplicated **text/graphic** copies only itself.
4. **A child copy can detach.** If `copy.start + copy.duration` does not fit in the background window, the copy becomes a free clip and the status line says so - the alternative (clamping it on top of the original) would silently stack two identical children.
5. **The global ＋ Text / ＋ Graphic stay free clips.** Only the background clip's own buttons (`＋ Child text` / `＋ Child graphic`, in the inspector and in the 30 % panel) create children. The existing "one new lane per click" contract and its tests are untouched.
6. **A child keeps its background context open.** Selecting a child leaves the preview at 70 % and the panel open, because the panel is where the child is edited; every other clip closes it. This is the one place where "another timeline element" was read as "another element that is not part of this background".
7. **The stage row is the sticky box.** `.te-preview-panel` keeps its `position: sticky` declaration (tests pin it) but is inert inside `.te-stage-row`; the row carries `top: 58px` and `z-index: 20`. Removing the row later means moving the pin back onto the panel.
8. **Child timing is not a separate clock.** It is a clamp applied by `itemTimingChanged()` and `clampChildToParent()`, so every surface (inspector, 30 % panel, dock drag, resize handle, `api.setItemTiming`, load) goes through one rule. No field stores an offset; the child stores absolute seconds like every other clip.
9. **`bindChildTimings()` is load-time repair.** An old project with a stale `parentId` (the media clip was deleted in a different tab) loads with a free clip instead of a broken reference.
10. **The four-lane cap still applies.** At the cap a child lands in the current top lane and the status line says it (same contract as Section 16's ＋ Text).
11. **`parentId` is the only new persisted field** and it defaults to `""`; no `version` bump was needed because `normalizeItem()` fills it on read.

### 17.11 Still open

> Re-verified 2026-11-09 (§0.10): every item below is still unfulfilled in the current code; done items were removed and uncertain ones are tagged **DONE**.

1. **Real-browser eyeball** of the 70 / 30 split, the sticky row with the panel open, the panel's density at 320 px wide, and the transition when the panel opens/closes.
2. **No drag-to-reparent.** A free text cannot be dropped onto a background clip to become its child, and a child cannot be promoted to a free clip from the UI (only by duplicating it out of the window).
3. **No multi-select duplicate.** `⧉ Duplicate` works on the one selected clip; no marquee selection, no `Ctrl / ⌘ + D` shortcut.
4. **The child list is not virtualised.** It renders every child of the selected background (bounded in practice by four lanes of clips).
5. **The 30 % panel does not replace the inspector.** The selected child's controls appear in both places; both write the same model, and a canvas drag keeps both X / Y readouts in sync, but a plain inspector slider edit does not re-render the panel until the next selection/`renderInspector()` — `renderChildPanel()` is still called only from the end of `renderInspector()` (verified 2026-11-09).
6. **The suite is still not green** (Sections 8.6, 10.8, 11.8, 14.10; see §0.10.2), and `npx tsc --noEmit` still reports **30** `src/index.ts` diagnostics.

> Removed 2026-11-09: the old item 2 ("no ripple option for duplicates — overlaps are resolved by array order") is **done**. §24.10's `resolveTimelineOverlaps()` runs on every duplicate/add/import/timing change and pushes the later boxes clear, with children following their background.

### 17.13 Appendix A - code map of what was coded

Location anchors are inside `src/client/timeline-editor.ts`, which exports one template string (`TIMELINE_EDITOR_JS`); the numbers below are the positions **in that file at commit `bf976af`** (the code commit of this section; `c71006c` only edits this document). "New" means added by Section 17, "changed" means an existing function gained Section 17 logic.

| # | Symbol | Line | Status | What it does after Section 17 |
| --- | --- | --- | --- | --- |
| 1 | `normalizeItem(item, track)` | 419 | changed | adds `out.parentId = String(out.parentId \|\| "")` next to the existing per-kind normalisation |
| 2 | `normalizeState(raw)` | 458 | changed | calls `bindChildTimings(tracks)` right after `tracks = tracks.concat(visualLayers)` and before the scenes are normalised |
| 3 | `childWindow(parentItem)` | 664 | new | returns `{ start, end }` of the background clip (`end = start + max(MIN_CLIP_SEC, duration)`) |
| 4 | `childItemsFor(parentItem)` | 669 | new | `[{ track, item }]` of every visual clip whose `parentId` equals the clip id, sorted by `startSec` |
| 5 | `backgroundContext()` | 684 | new | the selected background clip, or the parent of the selected child; `null` for anything else |
| 6 | `clampChildToParent(item)` | 695 | new | drops a dangling `parentId`, otherwise clamps start/duration into the window and re-links `sceneId` |
| 7 | `syncChildrenToParent(parentItem)` | 705 | new | runs `clampChildToParent` over every child of a background clip |
| 8 | `bindChildTimings(tracks)` | 713 | new | the same repair at load, working on the array passed in (no `state` access) |
| 9 | `itemTimingChanged(...)` | 998 | changed | `if (track.kind === "visual" && item.parentId) clampChildToParent(item);` and `if (track.kind === "media") syncChildrenToParent(item);` |
| 10 | `renderItemControls(inspector, track, item)` | 1161 | changed | parent-aware `Start inside background` / `Duration inside background` ranges + note; the `media` branch gains a "Child text & graphics" section with `＋ Child text` / `＋ Child graphic` |
| 11 | `renderInspector()` | 1267 | changed | toggles `#timeline-duplicate-element` with the selection and ends with `renderChildPanel()` |
| 12 | `renderChildPanel()` | 1323 | new | the 70 / 30 switch, the head, the child list, the child editor |
| 13 | `addVisualElement(kind, targetTrack, parentItem)` | 1412 | changed | optional third argument; with a parent the timing is the background window and the item carries `parentId` |
| 14 | `addChildVisualElement(kind, parentItem)` | 1453 | new | the child action: resolve parent → new lane (or top lane at the cap) → create → park the playhead inside the window → status |
| 15 | `duplicateLabelFor(source)` | 1486 | new | `"<label> copy"`, `"<label> copy 2"`, … stripping an existing suffix first |
| 16 | `duplicateSelectedItem()` | 1500 | new | the whole duplicate rule (clip, background scene, children, detached child) |
| 17 | `deleteSelectedItem()` | 1587 | changed | a deleted background clip also deletes every clip whose `parentId` is that clip |
| 18 | `syncPositionControls(item)` | 2195 | changed | writes the dragged X / Y into `#timeline-inspector` **and** `#timeline-child-editor` |
| 19 | `handleAction(action, target)` | 2271 | changed | three new actions: `add-child-text`, `add-child-graphic`, `duplicate` |
| 20 | `bindEvents()` | 2789 | changed | `[data-child-delete-id]` (select + delete), `[data-child-id]` (select), Enter / Space on a child row, all wired before the clip handler |
| 21 | `api` (bottom of the bundle) | 3026+ | changed | new public test surface: `duplicateSelectedItem()`, `addChildElement(kind)`, `getBackgroundContext()`, `getChildElements(parentId?)` |

Nothing else in the bundle changed: `drawPreview()`, `renderTimeline()`, `htmlTrackItem()`, the export paths (`paintTimelineFrameAt`, `exportTimelineMp4`, `exportTimelineMediaRecorder`), `persistNow()`, `addMediaFiles()`, `addAudioFile()` and the scene/subtitle machinery are untouched. A child therefore paints, exports and persists through the exact code paths every other text/graphic clip uses.

Markup and stylesheet anchors:

| File | Anchor | Status | What it is |
| --- | --- | --- | --- |
| `src/client/markup.ts` | line 850 | new | `<div class="te-stage-row" id="timeline-stage-row">` wrapping the preview panel and the child aside |
| `src/client/markup.ts` | 870–882 | new | `#timeline-child-panel` aside: `#timeline-child-title`, `#timeline-child-window`, the two `add-child-*` buttons, `#timeline-child-list`, `#timeline-child-editor` |
| `src/client/markup.ts` | 895 | new | `#timeline-duplicate-element` (`⧉ Duplicate`, `hidden disabled` until a clip is selected) |
| `src/client/markup.ts` | hint copy | changed | the selected-element hint now explains duplicate, the child panel and the 70 / 30 switch |
| `src/client/styles.ts` | 9285–9478 | new | `.te-stage-row` (the sticky box), the `te-child-open` 70 / 30 rules, `.te-child-panel` and its children, the `[hidden]` guard, the `max-width: 860px` fallback |
| `tests/timeline-editor.test.mjs` | 1034, 1095, 1139 | new | the three tests (background duplicate, text/graphic/audio duplicate, 70 / 30 child panel) |

### 17.14 Appendix B - DOM and action contract

The panel is driven by four hooks; anything else is presentational:

| Hook | Kind | Owner | Meaning |
| --- | --- | --- | --- |
| `#timeline-stage-row` | id | markup → `renderChildPanel()` | the flex row; carries `.te-child-open` while the 70 / 30 split is active |
| `#timeline-child-panel` | id | markup → `renderChildPanel()` | the 30 % aside; `hidden` when there is no background context |
| `data-timeline-action="duplicate"` | action | markup (`#timeline-duplicate-element`) | `handleAction` → `duplicateSelectedItem()` |
| `data-timeline-action="add-child-text"` | action | markup (panel) | `handleAction` → `addChildVisualElement("text")` |
| `data-timeline-action="add-child-graphic"` | action | markup (panel) | `handleAction` → `addChildVisualElement("graphic")` |
| `data-child-id="<clip id>"` | attribute | rendered rows | selects that child (`chooseItem`); Enter / Space do the same |
| `data-child-delete-id="<clip id>"` | attribute | rendered rows | selects then deletes that child |
| `[data-te-position="x" \| "y"]` | attribute | the range controls | the canvas drag writes these; now in both `#timeline-inspector` and `#timeline-child-editor` |

Rendered text the user reads (all produced by `renderChildPanel()` / `addChildVisualElement()`):

```text
#timeline-child-title   -> the background clip label            e.g. "Scene 1"
#timeline-child-window  -> "Pinned window 0:00 – 0:05 · 1 child element"
row label               -> "Text · Add your text" / "Graphic · circle"
row time                -> "0:00 · 0:05"
editor title            -> "Editing child text" / "Editing child graphic"
empty list              -> "No child text or graphic yet. Use ＋ Child text or ＋ Child graphic above."
empty editor            -> "Select a child element in the list to edit it here, or drag it on the preview canvas ..."
status after add        -> "Added a child text inside Scene 1 (0:00 – 0:05). Drag it on the preview canvas to place it."
status after duplicate  -> 'Duplicated "Scene 1" at 0:05 - right after the original ends.'
status on a detached copy-> "... The copy falls outside the background window, so it is now a free clip."
status with no parent   -> "Select a background clip (Pixabay image, GIF or MP4) before adding a child text or graphic."
```

### 17.15 Appendix C - what the saved project looks like

`parentId` is the only new field. A project with one background clip, one child text and one duplicated background scene serialises like this (values shortened):

```json
{
  "version": 3,
  "projectId": "timeline-p_source_test-row-7",
  "scenes": [
    { "id": "scene-1", "index": 0, "name": "Scene 1", "startSec": 0, "durationSec": 5,
      "mediaAssetId": "a-scene-1", "elements": [{ "id": "text-x1", "kind": "text", "parentId": "media-1", "startSec": 0, "durationSec": 5, "x": 50, "y": 78 }] },
    { "id": "scene-m3", "index": 1, "name": "Scene 1 copy", "startSec": 5, "durationSec": 5,
      "mediaAssetId": "a-scene-1", "elements": [{ "id": "text-c9", "kind": "text", "parentId": "media-c7", "startSec": 5, "durationSec": 5 }] },
    { "id": "scene-2", "index": 2, "name": "Scene 2", "startSec": 5, "durationSec": 5 }
  ],
  "tracks": [
    { "id": "background-media", "kind": "media", "items": [
      { "id": "media-1",  "sceneId": "scene-1", "assetId": "a-scene-1", "label": "Scene 1",      "startSec": 0, "durationSec": 5 },
      { "id": "media-c7", "sceneId": "scene-m3", "assetId": "a-scene-1", "label": "Scene 1 copy", "startSec": 5, "durationSec": 5 }
    ] },
    { "id": "visual-2-…", "kind": "visual", "items": [
      { "id": "text-x1", "kind": "text", "parentId": "media-1", "sceneId": "scene-1", "startSec": 0, "durationSec": 5 }
    ] }
  ]
}
```

Notes: the duplicated clip keeps the **same `assetId`** (one IndexedDB blob, two clips) and the copied child points at the **copy**, not the original. Load order is `normalizeItem` → `bindChildTimings` → scene normalisation, so a project saved by an older build (no `parentId`) loads unchanged and a project whose parent disappeared loads the child as a free clip.

### 17.16 Appendix D - the three algorithms, as coded

**D1 - panel switch** (`renderChildPanel()`, called at the end of every `renderInspector()`):

```text
parent = backgroundContext()          // selected media clip, or parent of the selected child
clear #timeline-child-list and #timeline-child-editor
row.classList.add/remove("te-child-open")
panel.hidden = (parent == null)
if (parent == null) return             // preview back to 100 %
title  = parent.label
window = "Pinned window " + formatTime(parent.start) + " – " + formatTime(parent.end)
for each child in childItemsFor(parent):
    row = div.te-child-row (+ .selected when it is the selection)
          span.te-child-row-label  ("Text · …" | "Graphic · …")
          span.te-child-row-time   ("0:00 · 0:05")
          button.te-child-row-delete [data-child-delete-id]
if the selection IS a child of parent:
    editor = "Editing child text" | "Editing child graphic" + renderItemControls(editorRoot, track, item)
else:
    editor = "Select a child element in the list to edit it here ..."
```

**D2 - child creation and clamping**:

```text
addChildVisualElement(kind, parentItem?):
    parent = (parentItem is media) ? parentItem : backgroundContext()
    if !parent            -> status "Select a background clip …", return null
    track  = visualTracks().length >= MAX_VISUAL_TRACKS ? visualTracks().last : addVisualTrack()
    item   = addVisualElement(kind, track, parent)
    playhead: if outside [parent.start, parent.end) -> parent.start   // so it is painted and draggable
    status "Added a child <kind> inside <label> (start – end) …"

addVisualElement(kind, track, parent):
    start    = parent ? parent.startSec                                   : playhead
    duration = parent ? parent.durationSec                                : 4
    sceneId  = parent ? parent.sceneId : activeSceneAt(playhead).id
    item.parentId = parent ? parent.id : ""

clampChildToParent(item):                       // called on every child timing edit and after a background edit
    parent = findItem(item.parentId)
    if !parent or parent.kind != "media" -> item.parentId = "", return
    item.startSec    = clamp(startSec,    parent.start,        parent.end - MIN_CLIP_SEC)
    item.durationSec = clamp(durationSec, MIN_CLIP_SEC,        parent.end - item.startSec)
    item.sceneId     = parent.sceneId
```

**D3 - duplicate** (`duplicateSelectedItem()`):

```text
source = selected clip in its track;  copy = deepCopy(source)
copy.id   = makeId(source.kind)
copy.label= duplicateLabelFor(source)
start     = source.startSec + source.durationSec          // the one placement rule
copy.startSec = start;  copy.durationSec = source.durationSec

if source.kind == "media":
    sceneCopy = deepCopy(source scene), new id, name + " copy", start/duration = copy's,
                assetId/mediaType/mediaName/mediaSource from the clip, elements = []
    scenes.splice(indexOf(sourceScene) + 1, 0, sceneCopy); renumber scene.index
    copy.sceneId = sceneCopy.id
    track.items.splice(indexOf(source) + 1, 0, copy)
    for each child of source:
        childCopy = deepCopy(child); new id; parentId = copy.id; sceneId = sceneCopy.id
        childCopy.startSec    = clamp(start + (child.start - source.start), start, start + duration - 0.25)
        childCopy.durationSec = clamp(child.duration, 0.25, start + duration - childCopy.startSec)
        push childCopy into the child's own lane
else:
    track.items.splice(indexOf(source) + 1, 0, copy)
    if source.parentId:
        fits = copy.start + copy.duration <= parent.start + parent.duration + 0.001
        fits ? (copy.parentId = parent.id, copy.sceneId = parent.sceneId)
             : (copy.parentId = "", copy.sceneId = activeSceneAt(copy.start).id, detachedChild = true)

selection = copy;  ensureTimelineEnd(copy.end);  renderTimeline + renderInspector + drawPreview + scheduleSave
status 'Duplicated "<label>" at <time> - right after the original ends.' (+ detachment note)
```

### 17.17 Appendix E - behaviour matrix (before / after this section)

| Surface | Before Section 17 | After Section 17 |
| --- | --- | --- |
| duplicate action | none existed in the bundle | `⧉ Duplicate` in the selected-element header for any selected clip; hidden+disabled with no clip selected |
| background clip copy | - | copy at `original.end`, own cloned scene, same `assetId`, children copied |
| text / graphic / audio copy | - | copy at `original.end`, same lane, right after the original, `"<label> copy"` |
| child copy outside window | - | becomes a free clip with a status line |
| linking a text to a media clip | no field existed | `parentId`, optional, repaired on load |
| new text / graphic timing | playhead start, 4 s, current scene | unchanged for the global ＋ Text / ＋ Graphic; **background window** for `＋ Child text` / `＋ Child graphic` |
| moving / resizing a background clip | moved the clips that share its `sceneId` | same ripple **plus** every child clamped into the new window |
| editing a child's timing | free 0 … cap | bounded by `background.start … background.end - 0.25` on every surface |
| background selected (layout) | preview 100 %, inspector below | preview **70 %** + 30 % child panel on the left, inspector unchanged below |
| text / graphic / audio selected | full-width preview | full-width preview, child panel hidden |
| child selected | full-width preview, inspector controls | 70 / 30 kept (still inside the background), child edited in both the left panel and the inspector |
| child on the preview canvas | draggable like any text | same drag; playhead is parked inside the window so it is painted and grabbable, X / Y sync in both editors |
| deleting a background clip | clip + scene + scene-linked elements | same **plus** every clip whose `parentId` is that clip |
| load | tracks/scenes normalised | same **plus** `bindChildTimings()` (dangling link → free clip, live link → clamped) |
| persistence | `sceneId`, `startSec`, `durationSec`, … | same **plus** `parentId`; no new key, cookie, KV entry or handoff field |

### 17.18 Appendix F - the flows as built (manual walkthrough)

**F1 - duplicate a background scene (the "next time unit" rule)**

1. Open a Quick Batch row → **Edit** → the timeline page. The background clip of Scene 1 is selected by default and the 30 % child panel is already open.
2. Click **⧉ Duplicate** in the selected-element header.
3. The dock now ends Scene 1 with a `Scene 1 copy` clip at `0:05` (immediately after the original), its scene exists in the project (`Scene 1 copy`), and the selection jumps to the copy. The status line reads `Duplicated "Scene 1" at 0:05 - right after the original ends.`

**F2 - duplicate a text or graphic**

1. Select the text clip in the dock (or add one with the global ＋ Text).
2. Set `Start 2 s`, `Duration 3 s` in the inspector.
3. **⧉ Duplicate** → a `Text copy` clip starts at `5 s`, listed next to the original in the same lane.
4. A child text whose window ends with the background duplicates to a **free clip** at the background's end; the status line says so.

**F3 - child text / graphic inside a background element**

1. Select the background clip (click `Scene 1` in the BACKGROUND lane). The preview becomes 70 % and the left 30 % panel appears with `Pinned window 0:00 – 0:05`.
2. Click `＋ Child text`. A new text lane appears on top, the child starts at `0:00` for `5 s` (the clip's window), and it is listed and selected in the left panel.
3. Drag the child on the preview canvas to place it; the left panel's X / Y readouts follow the drag.
4. In the left panel set `Start inside background 1 s` / `Duration inside background 2 s` → the child now lives inside the window only; trying `30 s` clamps it to the last 0.25 s.
5. Move the background clip to `2 s`, duration `8 s` → the child follows and the panel window reads `0:02 – 0:10`.
6. Click the subtitle lane, an audio clip, a text clip or a track row → the panel closes and the preview is 100 % wide again. Click the child again (dock or panel) → the panel returns with that child selected.

**F4 - cleanup**

1. Delete the background clip (`Delete`) → its children disappear with it.
2. Reload the page → the remaining `parentId` links are repaired by `bindChildTimings()`; a child whose background is gone comes back as a free clip instead of a broken reference.

### 17.19 Appendix G - how to re-verify by hand

```text
node --import tsx --test tests/timeline-editor.test.mjs                26 / 26
node --import tsx --test tests/timeline-editor.test.mjs \
  tests/quick-batch-table.test.mjs tests/final-media-cap-actions.test.mjs \
  tests/template-composer.test.mjs tests/public-entry-points.test.mjs \
  tests/editor-subtitles-parity.test.mjs                              86 / 86
npm test                        543 total / 497 pass / 40 fail / 6 cancelled (failure set identical to 459be7b)
npx tsc --noEmit --pretty false 31 diagnostics, all src/index.ts (identical to 459be7b)
npx wrangler deploy --dry-run   exit 0, 3004.31 KiB / 1361.60 KiB gzip
```

The three Section 17 tests are the executable specification of 17.3 / 17.4 / 17.5: they create the flows in F1-F3 through the real DOM (clicked buttons, `api` calls, `MouseEvent` pointer drags) and assert the resulting numbers, classes, text and saved JSON. The visual result (70 / 30 widths, sticky behaviour) still needs a real browser; that is item 1 of 17.11.

### 17.20 Status

- Branch: `arena/e8450094-text-to-image-template` (the only branch this section was written on).
- The documented source of truth is the current code in this workspace; this file is the secondary reference and now matches it.
- Focused suites 86 / 86 green; `tests/timeline-editor.test.mjs` 26 / 26 (23 before + 3 new); full suite 543 total / 497 pass / 40 fail / 6 cancelled with a failure-name set identical to `459be7b`; `tsc --noEmit` identical to `459be7b` (31 pre-existing `src/index.ts` diagnostics); `wrangler deploy --dry-run` compiles at 3004.31 KiB / 1361.60 KiB gzip.
- Commit: `bf976af` *"Section 17: duplicate placement after the original, background-owned child text/graphics, and the 70/30 child panel"*. The code-level record of that commit is Appendix A-G (17.13-17.19): symbol/line map, DOM and action contract, saved JSON shape, the three algorithms as coded, the before/after behaviour matrix, the manual walkthroughs and the re-verification commands.
- Follow-up doc commit: `c71006c` *"Section 17: record the commit hash in the status block"* and the Appendix commit that follows it; neither touches code.

## 18. Remove verbose timeline editor UI hints & vertically center preview video at 70 % width (2026-11-07)

### 18.1 Request & authority order

- **Primary source of truth:** current workspace code (`src/client/markup.ts`, `src/client/timeline-editor.ts`, `src/client/styles.ts`, `tests/timeline-editor.test.mjs`).
- **Secondary source of truth:** `bug-fix-session-331.md` (Sections 11–17).
- **Changes requested:**
  1. Remove the three verbose hint texts from the timeline editor UI (`#view-timeline`):
     - Selected-element panel `<p class="tm-scene-hint">Select a clip in the timeline to edit its start and duration. …</p>`.
     - Child timing bound-window note (`Child of the background clip "<label>" (<start> – <end>). Its timing depends on that clip only: move or resize the background to move the whole window.`) rendered for child elements in `renderItemControls()`.
     - Child panel `<p class="te-child-hint">Child text and graphics are timed by this background clip only: …</p>`.
  2. Vertically center the video on the preview canvas on the timeline editor page when the preview width is 70 % (`.te-stage-row.te-child-open` above `860px`).

### 18.2 Root-cause study & implementation

1. **Hint removal (`src/client/markup.ts`, `src/client/timeline-editor.ts`, `src/client/styles.ts`):**
   - Removed `<p class="tm-scene-hint">…</p>` inside `#view-timeline .te-inspector-panel .tm-scene-panel` and `<p class="te-child-hint">…</p>` inside `#timeline-child-panel` in `src/client/markup.ts` (and dropped the dead `.te-child-hint` selector in `src/client/styles.ts`).
   - Removed `boundNote` creation in `renderItemControls()` (`src/client/timeline-editor.ts`), which previously injected the `Child of the background clip …` `.te-inspector-note` into both `#timeline-child-editor` and `#timeline-inspector` whenever a child clip was selected. All child timing range clamps (`Start inside background`, `Duration inside background`) and other status/inspector notes remain unchanged.

2. **Vertical centering at 70 % preview width (`src/client/styles.ts`):**
   - When a background clip or one of its children is selected on viewports wider than `860px`, `#timeline-stage-row` receives `.te-child-open` (`display: flex; align-items: stretch`): `.te-preview-panel` shrinks to `70%` width and `#timeline-child-panel` takes `30%`. When child controls expand `#timeline-child-panel` up to `calc(100vh - 70px)`, `.te-preview-panel` stretches to match the row height while `.te-preview-stage` stays capped at `320px`; because `.te-preview-panel` defaulted to `justify-content: flex-start`, the preview block remained pinned to the top of the stretched 70 % panel.
   - Added `justify-content: center` on `.te-stage-row.te-child-open > .te-preview-panel`, fixed `.te-stage-row.te-child-open .te-preview-stage` to `flex: 0 0 320px; align-items: center; justify-content: center`, ensured `canvas#timeline-preview-canvas` carries `flex: 0 1 auto; align-self: center; margin: auto` (so width-constrained frames inside the `320px` stage also center on both axes), set `.te-child-panel { align-self: stretch }`, and reset `.te-stage-row.te-child-open > .te-preview-panel { justify-content: flex-start }` inside `@media (max-width: 860px)` where the preview returns to `100%` width.

### 18.3 Verification

- `node --import tsx --test tests/timeline-editor.test.mjs`: `27 / 27` pass (updated Section 17 child-editor assertion + added dedicated test covering hint removal and 70 % vertical centering rules).
- Focused suites (`timeline-editor`, `quick-batch-table`, `final-media-cap-actions`, `template-composer`, `public-entry-points`, `editor-subtitles-parity`): `87 / 87` pass.
- `npx wrangler deploy --dry-run`: exit `0` (`3002.55 KiB` / `1360.96 KiB` gzip).

## 19. Timeline editor bottom gallery cleanup, Selected Scene background-only inspector, Scene's media label, dock/scroll copy removal, and equal-height 70/30 columns (2026-11-08)

> **Partly superseded by §21.5 and §21.9 (2026-11-08):** the lane label is now `Scene Media`, and `Selected Scene` became a *runtime* label — the heading reads `Selected element` for every selection that is not a Scene Media box.

### 19.1 Request & authority order

- **Primary source of truth:** current workspace code (`src/client/app-js.ts`, `src/client/markup.ts`, `src/client/timeline-editor.ts`, `src/client/styles.ts`, `tests/timeline-editor.test.mjs`).
- **Secondary source of truth:** `bug-fix-session-331.md`.
- **Changes requested on `layout=timeline`:**
  1. Remove the two "video generating" cards (`#gallery`: `Generating AI Scene 1...`, `Generating AI Scene 2...`) appearing at the bottom-most part of the timeline editor.
  2. Rename the `TIMELINE EDITOR - Selected element` section below the preview canvas to `Selected Scene`, and make it contain the background media only — not child text or child graphics.
  3. Rename `Pixabay & uploaded media · background` to `Scene's media`.
  4. Remove the `.te-dock-footer` explanatory paragraph (`Text and graphics lanes stack above the pinned background layer, ... painted on all scenes and in the exported MP4.`) and the `Text moved - ...` status readout.
  5. Make the preview canvas / 70 % column the same height as the 30 % column once two columns are shown (`.te-stage-row.te-child-open`).
  6. Remove the `SCROLL LAYER` and `empty · drag to pan` text on the bottom scroll lane.

### 19.2 Root-cause study & implementation

1. **Bottom `#gallery` cards (`src/client/app-js.ts`, `src/client/styles.ts`, `src/client/timeline-editor.ts`):**
   - Top-level `prompts.forEach(...)` in `src/client/app-js.ts` appended `card-0` and `card-1` (`Generating AI Scene 1...`, `Generating AI Scene 2...`) into `#studio-app > #gallery` before route branching, while `layout=timeline` skipped `initVideoStudio()` (which hid `#gallery` in normal studio modes) and `#studio-app.timeline-mode` did not hide `#gallery`.
   - Guarded `prompts.forEach(...)` to skip card creation and hide `#gallery` when `layout=timeline` is active, cleared/hid `#gallery` inside `activateTimelineEditorLayout()` and `timeline-editor.ts` `boot()`, and added `body.timeline-editor-page #gallery` + `#studio-app.timeline-mode > #gallery` to the `display: none !important` rule in `src/client/styles.ts`.

2. **`Selected Scene` background-media-only inspector (`src/client/markup.ts`, `src/client/timeline-editor.ts`):**
   - Renamed `<div class="tm-sec-title">Selected element</div>` to `<div class="tm-sec-title">Selected Scene</div>` (and `aria-label="Selected scene controls"`).
   - Removed the `"Child text & graphics"` subsection (`＋ Child text`, `＋ Child graphic`, `childNote`) from `renderItemControls()` for `media` items so a background scene renders `Timing` + `Background media` only.
   - Updated `renderInspector()` so whenever a background clip or one of its child text/graphics is active (`backgroundContext()`), the bottom `Selected Scene` inspector resolves to the parent background media clip on `mediaTrack()` and `#timeline-element-selector` renders no child text/graphic pills, while `#timeline-child-panel` (the 30 % column) continues to list and edit the child text/graphics. Free (non-child) timeline clips remain editable when selected.

3. **Media track label (`src/client/timeline-editor.ts`, `src/client/app-js.ts`):**
   - Updated `MEDIA_TRACK_LABEL` in `src/client/timeline-editor.ts` and the Quick Batch handoff track label in `src/client/app-js.ts` from `Pixabay & uploaded media · background` / `Pixabay & uploaded media` to `Scene's media`.

4. **Dock footer & drag status removal (`src/client/markup.ts`, `src/client/timeline-editor.ts`, `src/client/styles.ts`):**
   - Removed the `.te-dock-footer` explanatory `<span>` from `src/client/markup.ts`, hid `.te-dock-footer` whenever `#timeline-status` is empty (`.te-dock-footer[hidden] { display: none !important; }` + `setStatus()`), and removed the `Graphic moved - ...` / `Text moved - ...` `setStatus()` call from `endCanvasDrag()`.

5. **Equal-height 70 % / 30 % columns & preview stage (`src/client/styles.ts`):**
   - Set `.te-stage-row.te-child-open > .te-preview-panel` (`width: 70%; align-self: stretch; max-height: calc(100vh - 70px)`) and `.te-stage-row.te-child-open > .te-child-panel` (`width: 30%; align-self: stretch`) to share identical stretched column bounds, and updated `.te-stage-row.te-child-open .te-preview-stage` from `flex: 0 0 320px` to `flex: 1 1 auto; height: auto; min-height: 320px; max-height: none` so the preview canvas stage expands vertically to match the 30 % column height (resetting back to `100%` width and `320px` stage height inside `@media (max-width: 860px)`).

6. **Bottom scroll-lane label copy removal (`src/client/timeline-editor.ts`):**
   - Removed `<span class="te-track-scroll-label">SCROLL LAYER<small>empty · drag to pan</small></span>` from `.te-track-label.te-track-scroll`, preserving the empty bottom scroll layer row and horizontal drag-to-pan behavior.

### 19.3 Verification

- `node --import tsx --test tests/timeline-editor.test.mjs`: `28 / 28` pass (including full `createHTML()` + JSDOM `layout=timeline` boot verifying `#gallery` has 0 cards and `display: none`, `Selected Scene` + `Scene's media` labels, background-only `Selected Scene` inspector during child text/graphic selection, removed dock/scroll-layer copy, and equal-height 70 % / 30 % CSS rules).
- Related suites (`public-entry-points`, `quick-batch-table`, `studio-ui-session-243`, `template-composer`): `45 / 45` pass.
- `npx wrangler deploy --dry-run`: exit `0` (`3001.47 KiB` / `1360.72 KiB` gzip).

## 20. Timeline editor: Undo / Redo, track & panel copy removal, no vertical grid lines, non-overlapping background boxes, sticky ＋ Text / ＋ Graphic, 80 s timing sliders, and 7.5 px BACKGROUND ELEMENT type (2026-11-08)

### 20.1 Request & authority order

- **Primary source of truth:** the current workspace code — `src/client/markup.ts`, `src/client/timeline-editor.ts`, `src/client/styles.ts` (plus `src/client/app-js.ts` as the Quick Batch handoff producer) and `tests/timeline-editor.test.mjs`.
- **Secondary source of truth:** this file, sections 11–19 (the timeline editor's history of record). Where the two disagreed, the code won: every item below was located in the code first, then changed, then re-verified from the served markup and the booted JSDOM app.
- **Changes requested on `layout=timeline`:**
  1. Add **Undo** and **Redo** buttons to the timeline editor page.
  2. Remove the text *"drag this text clip directly on the preview canvas to set X and Y without the sliders"*.
  3. In the tracks layer, remove the text `pixabay-1046.mp4 · pixabay · background layer`.
  4. In the Selected Scene section, remove the newline between the media label (e.g. `pixabay-1046.mp4`) and the label `Selected Scene`.
  5. Remove the eyebrow text `TIMELINE EDITOR` above `Selected Scene`.
  6. Remove the vertical lines in the timeline tracks and in the per-second timing ruler.
  7. On the background layer, the scene boxes must not overlap.
  8. Remove the text `3 / 4 lanes · above the background`.
  9. On the text & graphics track, `＋ Text` / `＋ Graphic` must be sticky to the left and must sit on the front-most layer — not on the same indexing layer as the track.
  10. Remove the text `SCROLL`.
  11. Remove the `＋ Lane 3 / 4` button next to the zoom control.
  12. In every selected-element section, the seconds slider must have a maximum of **80 s**.
  13. In the **BACKGROUND ELEMENT** section (the 30 % column next to the 70 % preview canvas), the font size must be **7.5 px** only.
  14. Document all of it here.

### 20.2 Code study that drove the changes (pre-change audit)

| # | Where the thing actually lived before this section |
|---|---|
| 1 | `src/client/markup.ts` `.te-topbar` had only Back / heading / save-status / Play / Export; no history control existed anywhere in the bundle, and `TIMELINE_EDITOR_JS` had no snapshot stack. |
| 2 | `renderItemControls()` in `src/client/timeline-editor.ts` appended a `div.te-inspector-note` starting with `Tip: drag this text clip directly on the preview canvas …` for `kind === "text"` (and the graphic twin `Tip: drag this graphic directly …`). |
| 3 | `renderItemControls()` built the Background media note as `item.label + " · " + item.mediaSource + " · background layer"` — that is exactly the `pixabay-1046.mp4 · pixabay · background layer` string; the file name itself comes from the Quick Batch handoff (`mediaName` in `batchTimelineState()`, `src/client/app-js.ts`). |
| 4 | `renderInspector()` created `div.tm-scene-inspector-title` with the clip label as the **first child of `#timeline-element-selector`**, i.e. on its own row below the `Selected Scene` heading — the "newline". |
| 5 | `src/client/markup.ts` `.tm-scene-panel-head` shipped `<div class="tm-scene-kicker">TIMELINE EDITOR</div>` above `</div><div class="tm-sec-title">Selected Scene</div>`. |
| 6 | Vertical lines came from three places: `.te-ruler-tick { border-left: 1px solid … }` + `.te-ruler-tick i` (ruler), and the `repeating-linear-gradient(90deg, … 80px … 82px)` stripes on `.te-lane`, `.te-lane.te-background-lane`, `.te-group-fill` and `.te-scroll-layer`. |
| 7 | `htmlTrackItem()` drew every clip as `left = startSec * pps; width = durationSec * pps` with no neighbour awareness, so a saved/rippled scene whose duration ran past the next scene's start painted over it (the dock is the only place the overlap was visible; the canvas resolves the active scene by `find()`, so it never showed the bug). |
| 8 | `renderTimeline()` emitted `<small>&lt;n&gt; / 4 lanes · above the background</small>` inside the `TEXT & GRAPHICS` group label. |
| 9 | The two buttons lived in `div.te-group-fill.te-visual-actions` (grid column 2, first row of the tracks grid) as plain inline buttons: they scrolled away horizontally with the tracks, and they shared the lanes' stacking context with no `z-index` of their own (clips paint at 2, the selected clip at 4, the playhead at 6, the label column at 5, the ruler at 12) so a lane/clip could sit above them. |
| 10 | `renderTimeline()` emitted `<div class="te-grid-corner">SCROLL</div>` over the drag-to-pan scroll lane. |
| 11 | `src/client/markup.ts` `.te-dock-actions` shipped `<button class="te-secondary" data-timeline-action="add-layer">＋ Lane <span id="timeline-layer-count">1 / 4</span></button>` next to `.te-zoom`, and `renderTimeline()` kept `#timeline-layer-count` in sync. |
| 12 | `renderItemControls()` computed `cap = Math.min(MAX_DURATION_SEC, Math.max(60, state.durationSec * 2, item.startSec + item.durationSec))` for Start/Duration, and `Trim in` used a hard-coded `0…600`. |
| 13 | The 30 % column (`#timeline-child-panel`) inherited the shared `.tm-scene-*` typography (0.56–0.72 rem), with no panel-specific size rule. |

Two measurement facts came out of the audit and decided the implementation:

- **The lane stripes were not aligned with the time ruler.** With `durationSec = 60` the pixels-per-second is `1080 / 60 ≈ 18` (capped at 48), i.e. an 80 px stripe is 4.44 s — not a tick. So the "vertical lines" on the tracks were decoration that actively lied about time; removing them is also a correctness win, and the ruler is now the only time reference.
- **`persistNow()` is the single mutation funnel.** Every add/delete/duplicate/ripple/drag/upload already ends in `persistNow()` (directly or through the 180 ms debounced `scheduleSave()`), which is why the history stack is hooked there instead of at ~25 call sites.

### 20.3 Change 1 — Undo / Redo (`src/client/markup.ts`, `src/client/timeline-editor.ts`, `src/client/styles.ts`)

- **Markup:** two buttons in the sticky top bar, right after the save-status readout and before Play:
  `#timeline-undo` (`data-timeline-action="undo"`, `\u21b6 Undo`) and `#timeline-redo` (`data-timeline-action="redo"`, `\u21b7 Redo`), both `class="te-history"`, both `disabled` in the initial markup, with `title`/`aria-label` copy that names the shortcut.
- **Styles:** `.te-history` joins the shared `.te-back / .te-play / …` button rule (8 px 11 px padding, `.74rem`, weight 800), `.te-history:disabled { opacity: .38; cursor: default }` keeps the pair in place (no top-bar reflow), and the `max-width: 560px` block shrinks it to `6px 7px / .62rem`.
- **History model:** `historyUndo` / `historyRedo` are arrays of JSON strings of the **editable project data only** — `{ durationSec, scenes, tracks }` from `snapshotProject()`. Selection (`selectedTrackId`, `selectedItemId`), `playheadSec`, `zoom` and `updatedAt` are excluded, so selecting a clip, scrubbing or zooming never creates an undo step.
  - `HISTORY_LIMIT = 80` snapshots per stack (oldest shifted out).
  - `recordHistoryEntry()` runs from `persistNow()` **before** the write: it pushes the previous `lastSnapshot`, clears `historyRedo`, stores the new snapshot and refreshes the buttons. Because `scheduleSave()` debounces, a whole slider sweep or a whole canvas drag collapses into **one** step.
  - `restoreSnapshot()` parses a snapshot, restores `durationSec` / `scenes` / `tracks`, re-clamps the playhead, re-resolves the selection (`findTrack` / `findItem`, falling back to the media lane and to "nothing selected"), then re-renders timeline + inspector + preview + readout.
  - `applyHistorySnapshot()` wraps restore + an immediate `persistNow()` with `suppressHistory = true`, so undoing both repaints and rewrites the localStorage entry without recording itself.
  - `undo()` / `redo()` move one entry between the stacks, set the save status to `Undo · n steps left` / `Redo · n steps left`, and refresh the buttons (`updateHistoryButtons()` also publishes `window.__TIMELINE_EDITOR_HISTORY__ = { undo, redo }`).
  - `resetHistory()` is called once at the end of `boot()` (after the first `persistNow()`), so opening a project — and its normalisation — is the baseline, never an undo step.
- **Wiring:** `handleAction()` accepts `undo` / `redo`; the delegated click handler in `bindEvents()` routes `[data-timeline-action]` to it, so the markup buttons work with no extra listeners. A new document-level `keydown` listener adds **Ctrl/Cmd+Z** = undo and **Ctrl/Cmd+Shift+Z** / **Ctrl/Cmd+Y** = redo, and deliberately ignores keystrokes whose target is an input, textarea, select or contenteditable so the browser keeps native text undo inside the inspector fields.
- **API:** `api.undo()`, `api.redo()` and `api.getHistory()` are exported alongside the existing `api.*` surface, and `updateHistoryButtons()` keeps both buttons' `disabled` / `aria-disabled` state honest after every restore.

### 20.4 Change 2 — the two drag tips are gone (`src/client/timeline-editor.ts`)

- Deleted the `textDragNote` block (`Tip: drag this text clip directly on the preview canvas to set X and Y without the sliders.`) from the `kind === "text"` branch of `renderItemControls()`.
- Deleted its graphic twin `graphicDragNote` (`Tip: drag this graphic directly on the preview canvas …`) for symmetry: the request named the text string, and leaving the graphic one would have kept the same sentence on screen for the other element kind.
- Nothing else changed: the canvas drag itself, `data-te-position` tagging of the X/Y sliders, `syncPositionControls()` and the dashed selection box are untouched.

### 20.5 Change 3 — the Background media note is the clip name only (`src/client/timeline-editor.ts`)

- `info.textContent` is now `String(item.label || item.name || "Media")` when the clip has an asset; the empty-state sentence ("No media file is attached to this scene yet. …") is unchanged.
- So `pixabay-1046.mp4 · pixabay · background layer` renders as `pixabay-1046.mp4`: the `· <provider>` and `· background layer` suffixes are gone, and the section heading already says `Background media`.
- No markup change to the model: `item.mediaSource` and `scene.mediaSource` are still carried in state and in localStorage (only the render changed), so nothing else that reads the provider broke.

### 20.6 Change 4 + 5 — one line for `Selected Scene` + clip name, and no eyebrow (`src/client/markup.ts`, `src/client/timeline-editor.ts`, `src/client/styles.ts`)

- **Markup:** the panel head is now `<div class="te-scene-heading"><div class="tm-sec-title">Selected Scene</div><span id="timeline-selected-name" class="te-selected-name"></span></div>`; the eyebrow `<div class="tm-scene-kicker">TIMELINE EDITOR</div>` is deleted.
- **JS:** `renderInspector()` no longer creates `div.tm-scene-inspector-title` inside `#timeline-element-selector`; it writes the same label into `#timeline-selected-name` instead (`inspectorItem.label || inspectorItem.name || kind`, or the track label, or `""`). The element pills (`button.tm-scene-object`) still render below, unchanged.
- **CSS:** `.te-inspector-panel .te-scene-heading { display: flex; align-items: baseline; gap: 8px; flex-wrap: nowrap }` and `.te-inspector-panel .te-selected-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .72rem }` — the clip name sits inline, on the same line, to the right of `Selected Scene`, and truncates instead of wrapping. That is the "newline between the label and Selected Scene" from the request.
- The `BACKGROUND ELEMENT` kicker in the 30 % panel is left in place (it is a different section and was not named).

### 20.7 Change 6 — no vertical lines in the tracks and the timing ruler (`src/client/styles.ts`)

- `.te-ruler-tick`: `border-left: 0` (was `1px solid var(--t-line, #454853)`) — the second-scale labels no longer hang a full-height line through the ruler and the tracks below.
- `.te-ruler-tick i`: `display: none` (was a 1 px × 5 px dash drawn at the tick).
- `.te-lane`: `background-image: none` (was the 80/82 px `repeating-linear-gradient`), so a lane is a plain band.
- `.te-lane.te-background-lane`: `background: var(--t-panel-2, #161a12)` (stripe gradient removed, tint and border kept so the background lane still reads as the lowest layer).
- `.te-group-fill`: `background: var(--t-panel-2, #191b22)` (same stripe removal).
- `.te-scroll-layer`: `background-image: none` (same stripe removal; the grab cursor, the 44 px band and the sticky hint stay).
- Kept: the horizontal lane separators (`border-bottom`), the red 2 px playhead and its inverted-triangle handle, and horizontal ruler-formatting. Only **vertical** lines were removed.

### 20.8 Change 7 — background scene boxes can never overlap (`src/client/timeline-editor.ts`)

- New helper `clampClipBox(track, item)`: it starts from the clip's own `startSec` / `durationSec` and then, for every other clip in the same track that starts **after** it, shortens the drawn duration to the remaining gap (`duration = max(0, otherStart - start)`).
- `htmlTrackItem()` now renders `left` / `width` from `clampClipBox()` instead of the raw values, so two adjacent background scene boxes butt-join instead of painting over each other even when a saved project (or a duration ripple) leaves a clip running past its neighbour.
- This is a **render-level** guard by design: the stored timing is not silently rewritten behind the user's back (that would make Undo lie about what it restores). Real timing edits still go through `itemTimingChanged()` / the inspector / the dock drag, which clamp and ripple for real.
- The minimum drawn width stays `12px`, so a fully covered clip is still visible and clickable in the lane.

### 20.9 Change 8 — the lane-count readout is gone (`src/client/timeline-editor.ts`)

- The `TEXT & GRAPHICS` group label no longer appends `<small>n / 4 lanes · above the background</small>`; it renders `TEXT &amp; GRAPHICS` only.
- The `#timeline-layer-count` DOM sync (`visuals.length + " / " + MAX_VISUAL_TRACKS`) was deleted from `renderTimeline()` because the element no longer exists.
- Behaviour is unchanged: `＋ Text` / `＋ Graphic` still open a new lane on top, and the four-lane cap still reports itself through `setStatus()` (`… at the cap the new element lands in the current top layer`).

### 20.10 Change 9 — `＋ Text` / `＋ Graphic` are sticky-left and front-most (`src/client/timeline-editor.ts`, `src/client/styles.ts`)

- **Markup (generated):** the two buttons are wrapped in `<span class="te-visual-actions-sticky">` inside the existing `div.te-group-fill.te-visual-actions` cell, so the playhead span stays a direct child of the fill cell as before.
- **CSS:**
  - `.te-visual-actions-sticky { position: sticky; left: 156px; z-index: 30; display: inline-flex; gap: 6px; padding: 3px 8px; border-right: 1px solid …; background: var(--t-panel-2, #191b22) }`.
  - `left: 156px` is the label-column width, so the pinned pair sits exactly at the left edge of the **tracks area**, right next to the lane labels, and never covers them (the label column is sticky at 5, the ruler at 12, the playhead at 6, clips at 2–4 — the buttons at 30 are the front-most layer of the dock).
  - `.te-group-fill.te-visual-actions { overflow: visible }` is required: `overflow: hidden` would turn the cell into its own scroll container and kill the sticky travel. This is the only reason the cell's overflow is overridden for this one row.
  - The `max-width: 560px` block sets `.te-visual-actions-sticky { left: 132px }` to follow the narrower label column there.
  - The opaque `background` + `border-right` keep the buttons readable while the tracks scroll underneath them.
- Result: panning the dock horizontally leaves the pair in place (sticky against `#timeline-scroll`), and no lane, clip or playhead can ever paint over them.

### 20.11 Change 10 + 11 — `SCROLL` and the `＋ Lane n / 4` button are removed (`src/client/markup.ts`, `src/client/timeline-editor.ts`, `src/client/styles.ts`)

- `renderTimeline()` now emits `<div class="te-grid-corner te-grid-corner-scroll" aria-hidden="true"></div>` instead of `<div class="te-grid-corner">SCROLL</div>`; the cell stays (so the CSS grid keeps its two columns aligned with the label column) and `.te-grid-corner-scroll { padding: 0 }` keeps it visibly empty. The drag-to-pan behaviour of the lane below it is untouched.
- `src/client/markup.ts` `.te-dock-actions` no longer ships the `＋ Lane <span id="timeline-layer-count">` button at all, so the toolbar is now `Timeline 1:00` … `Zoom [slider] 1×` … `⬇ Export MP4`.
- Dead code removed with it: the `#timeline-layer-count` sync, the `.te-secondary` / `.te-secondary span` rules and the `.te-secondary` entry in the shared button selector list and in the `max-width: 560px` block. The `add-layer` action itself is kept in `handleAction()` and `api.addVisualTrack()` because it is still reachable through the API and by `＋ Text` / `＋ Graphic` when they open a lane.

### 20.12 Change 12 — every seconds slider stops at 80 s (`src/client/timeline-editor.ts`)

- New constant `MAX_TIMING_SEC = 80` next to `MAX_DURATION_SEC = 3600`.
- `renderItemControls()` now uses `var cap = MAX_TIMING_SEC` for `Start (seconds)` and `Duration (seconds)` in **every** selected-element section (background clips, text, graphic, audio and the child variants `Start inside background` / `Duration inside background`), replacing `Math.min(MAX_DURATION_SEC, Math.max(60, state.durationSec * 2, …))`.
- `Trim in (seconds)` — the last seconds slider of the Background media section — also moved from `0…600` to `0…MAX_TIMING_SEC`, with the stored value clamped into the new range when rendered.
- Non-seconds sliders are untouched (`Volume` 0–1, `X`/`Y` 0–100 %, `Font size` 10–140 px, `Size` 12–500 px).
- `MAX_DURATION_SEC` still governs the project length and the model clamps, so a project longer than 80 s can still exist (a Quick Batch row is handed over with e.g. 12 × 15 s); the 80 s bound is the upper end of the range control, as requested.

### 20.13 Change 13 — 7.5 px type in the `BACKGROUND ELEMENT` panel (`src/client/styles.ts`)

> **Superseded by §21.6 (2026-11-08):** the panel is `10px !important` now, with an extra `#timeline-child-panel *` catch-all — no `7px` / `7.5px` declaration is left in `APP_CSS`.

- One rule set, scoped to `#timeline-child-panel` (the 30 % column shown while a background clip or one of its children is selected, i.e. the panel that sits next to the 70 % preview canvas):
  - the panel root, `.tm-scene-kicker`, `.te-child-head strong`, `.te-child-head small`, `.te-child-actions .tm-scene-add`, `.te-child-empty`, `.te-child-row-label`, `.te-child-row-time`, `.te-child-row-delete`, `.te-child-editor-title`, `.tm-scene-subtitle`, `.tm-scene-field`, `.tm-scene-field-label`, `.tm-scene-range-value`, `.tm-scene-note` and `.te-inspector-note` all get `font-size: 7.5px !important; line-height: 1.4`.
  - the inputs and buttons the panel re-uses (`.tm-scene-field input:not([type=range]):not([type=checkbox])`, `.tm-scene-field select`, `.tm-scene-add`, `.tm-scene-upload`) get `font-size: 7.5px !important` as well, while keeping their `min-height` so the tap target stays usable.
- `!important` is deliberate: the panel re-uses the shared `.tm-scene-*` component styles, whose specificity (`0.72rem`, `0.66rem`, …) would otherwise win on some selectors. The selector list is explicit so nothing outside the panel is affected, and the `Selected Scene` panel (100 % wide) keeps its normal typography.

### 20.14 Files touched in this section

| File | What changed |
|---|---|
| `src/client/markup.ts` | `+/− Undo` & `Redo` buttons in `.te-topbar`; `TIMELINE EDITOR` eyebrow removed; `Selected Scene` + inline `#timeline-selected-name`; `＋ Lane` / `#timeline-layer-count` removed from `.te-dock-actions`; header comment updated. |
| `src/client/timeline-editor.ts` | `MAX_TIMING_SEC = 80`; history stack (`snapshotProject`, `recordHistoryEntry`, `restoreSnapshot`, `applyHistorySnapshot`, `undo`, `redo`, `resetHistory`, `updateHistoryButtons`, `suppressHistory`, `HISTORY_LIMIT`); `undo` / `redo` actions + Ctrl/Cmd+Z / Shift+Z / Y shortcuts; `api.undo` / `api.redo` / `api.getHistory`; `clampClipBox()`; `SCROLL` corner, lane-count readout, both drag tips and the `· provider · background layer` note removed; sticky wrapper for the two add buttons; the selected clip name moved inline into `#timeline-selected-name`. |
| `src/client/styles.ts` | `.te-history` (+ mobile size); `.te-scene-heading` / `.te-selected-name`; `.te-visual-actions-sticky` + `.te-group-fill.te-visual-actions { overflow: visible }` (+ 132 px override); `.te-grid-corner-scroll`; `.te-ruler-tick` `border-left: 0`; `.te-ruler-tick i { display: none }`; stripes removed from `.te-lane`, `.te-lane.te-background-lane`, `.te-group-fill`, `.te-scroll-layer`; `#timeline-child-panel` 7.5 px typography; `.te-secondary` rules deleted. |
| `tests/timeline-editor.test.mjs` | 3 assertions updated to the new behaviour (no lane stripes, no `#timeline-layer-count` / `add-layer` button, no `.te-inspector-note` drag tip) + one new test (29 total) covering every item of this section. |

### 20.15 Verification

- `node --import tsx --test tests/timeline-editor.test.mjs`: **29 / 29** pass (28 existing + 1 new). The new test — *"timeline editor undo/redo steps through edits, the copy clean-up, sticky add buttons, 80 s timing sliders and 7.5 px child panel type"* — boots the real page in JSDOM and asserts:
  - the four removed strings (`drag this text clip directly …`, `without the sliders`, `TIMELINE EDITOR` kicker, `SCROLL` corner) and the removed `＋ Lane` / `n / 4` markup are absent from the served HTML;
  - `#timeline-undo` / `#timeline-redo` exist, start `disabled`, become enabled on the first edit, and **actually reverse / re-apply** an added text clip *and* its edited timing (element present after redo, `startSec === 3`); the Ctrl+Z and Ctrl+Shift+Z shortcuts do the same;
  - the `Selected Scene` panel has no `.tm-scene-kicker` and no `.tm-scene-inspector-title`, and the clip name is in `#timeline-selected-name`;
  - the Background media note no longer contains `background layer`;
  - the timing controls' `max` is `80` (and no `60` remains);
  - every background scene box ends at or before the next box's `left`;
  - `.te-lane` has `background-image: none`, `.te-ruler-tick` has `border-left: 0` and the background lane lost its gradient;
  - `.te-visual-actions-sticky` is `position: sticky; left: 156px; z-index: 30`, the filler cell is `overflow: visible`, and the wrapper holds exactly `add-text` + `add-graphic`;
  - `#timeline-child-panel` resolves to `font-size: 7.5px !important`.
- Related suites: `quick-batch-table`, `final-media-cap-actions`, `public-entry-points`, `template-composer`, `session-250-batch-pipeline` → `90 / 95` pass, with the **same five** `session-250-batch-pipeline` failures (`handleGenerateImagePrompts`, `runImageModel`, `handleImageBatch`, the end-to-end Quick Batch test, and the hung `decodeAudioData` timeout) present on the untouched base commit `4fe5a30` — verified by `git stash` + re-run.
- `npx wrangler deploy --dry-run`: exit `0` (no build or bundle regression).
- `npx tsc --noEmit`: unchanged from the base commit (the pre-existing `src/index.ts` diagnostics only).
- Manual boot check: the generated page was served on port 8788 and inspected at `?layout=timeline`; the rendered dock now shows an empty scroll corner, `TEXT &amp; GRAPHICS` with the sticky `＋ Text` / `＋ Graphic` pair, plain (stripe-free) lanes, and a toolbar with no `＋ Lane` button.

### 20.16 Notes, gotchas and deliberate decisions

- **History granularity is the save, not the mutation.** Because the snapshot is taken inside `persistNow()`, one debounced burst = one undo step. A consequence: a single inspector commit and an immediately following one within 180 ms merge — deliberate, it matches how the user perceives one gesture.
- **Undo never records itself.** `applyHistorySnapshot()` sets `suppressHistory`, restores, persists, then clears it. Without that flag the restore would push a snapshot and "undo" would become a no-op ping-pong.
- **Selection is not history.** Restoring a snapshot re-resolves the current selection against the restored tracks and falls back to the media lane — an undone `delete` therefore lands with the clip visible again but *not* necessarily selected. This keeps clicking around free of history noise.
- **`clampClipBox` is render-only.** Overlap is fixed in the dock without rewriting the model, so Undo/Redo and the saved JSON keep describing exactly what the user set. Real clamps stay in `itemTimingChanged()`.
- **Sticky needs a non-clipping parent.** `.te-group-fill.te-visual-actions { overflow: visible }` is load-bearing; restoring `overflow: hidden` on that cell would silently un-pin the buttons.
- **`left: 156px` is the label column.** It is duplicated (`.te-group-title` / `.te-track-label` is `width: 156px`), and the `560px` breakpoint carries the matching `132px`. If the label column width ever changes, both values must move together.
- **7.5 px is intentional** for the narrow panel, not a typo for `0.75rem`; it is applied with `!important` and an explicit selector list to beat the shared `.tm-scene-*` sizes.
- **The 80 s cap is a UI bound.** `MAX_DURATION_SEC = 3600` still governs the model, so existing longer projects still load and play; only the range controls stop at 80 s.
- **`add-layer` survives as an action** (API/`addVisualTrack`) even though the toolbar button is gone, so nothing else that calls it breaks.

### 20.17 Still open

> Re-verified 2026-11-09 (§0.10): every item below is still unfulfilled in the current code; done items were removed and uncertain ones are tagged **DONE**.

- Undo/Redo does not yet cover binary media (uploaded Blobs live in IndexedDB), only the timing/element model — `snapshotProject()` serialises `durationSec`, `scenes` and `tracks` only, so undoing an upload restores the clip metadata but the asset is re-read from IndexedDB on reload.
- Redo history is intentionally dropped on every new edit (standard linear history); a branching history is out of scope.

> Removed 2026-11-09: the old first bullet ("the `BACKGROUND ELEMENT` panel at 7.5 px is too small") is **done** — since §21.6 the panel is **10 px** with a `#timeline-child-panel * { font-size: 10px !important }` catch-all, and no `7.5px` rule survives in `src/client/styles.ts`.

### 20.18 Status

- All 14 requested items are implemented in code, covered by assertions, and documented above.
- Test state: `tests/timeline-editor.test.mjs` **29 / 29**; related suites unchanged against the base commit; `wrangler deploy --dry-run` green.

## 21. Background header cleanup, collapsible TEXT & GRAPHICS lanes, `Selected element`, 10 px child panel, white top scroll layer, the ＋ Add Clips modal and the `Scene Media` label (2026-11-08)

### 21.1 Request & authority order

- **Primary source of truth:** the workspace code — `src/client/timeline-editor.ts` (the whole editor bundle), `src/client/markup.ts` (the served shell), `src/client/styles.ts` (`APP_CSS`), `src/client/app-js.ts` (the Quick Batch handoff that produces the state) and `tests/timeline-editor.test.mjs`. Every item below was located in that code **first**; this file was used only as the history of record.
- **Secondary source of truth:** sections 11–20 of this file. Where an older line no longer matches the code, the code wins and the stale line is listed in **21.13 Superseded copy in this file** instead of being rewritten — the older sections stay as written at the time.
- **Changes requested on `layout=timeline`:**
  1. Remove the text `pinned lowest` from the group title `BACKGROUND LAYER / pinned lowest`.
  2. Make the **TEXT & GRAPHICS** layer tracks collapsible, with the same style and font as the Soundtrack tracks.
  3. In the section above the tracks, the `Selected Scene` title must read `Selected element` whenever the selection is **not** a box from the scene media track.
  4. Once the preview canvas is at the **70 / 30** split, every text size in the right-hand (30 %) panel must be **10 px** — not 7 px, not 7.5 px.
  5. The scroll layer at the **top** must be white.
  6. `＋ Add media` on the track layer gets `margin-left: 5px`; the text next to it is removed; a **`＋ Add Clips`** button sits next to it and opens a modal in the editor layout like **Add video from template** — every video added from that modal is queued at the **right-most end** of the time track in the scene media layer.
  7. The label `Scene's Media` becomes `Scene Media`.
  8. Document all of it here.

### 21.2 Code study that drove the changes (pre-change audit)

| # | Where the thing actually lived before this section |
|---|---|
| 1 | `renderTimeline()` emitted the background header as `'<div class="te-group-title te-group-background"><span class="te-group-label">' + esc(MEDIA_TRACK_NAME) + ' LAYER <small>pinned lowest · Pixabay, GIF, image or MP4</small></span><button … data-timeline-action="add-media">＋ Add media</button></div>'` — one `<small>` carried both the `pinned lowest` copy (item 1) and the "text next to" the button (item 6). |
| 2 | The group head was a dead `<span class="te-group-label">TEXT & GRAPHICS</span>` (0.56 rem / 900 weight / `letter-spacing: .08em`) while the lanes below it rendered unconditionally. The collapse pattern already existed twice in the same function: the `Soundtrack` head (`<button class="te-group-toggle" data-timeline-action="toggle-sound" aria-expanded> ▾ Soundtrack <small>3 tracks</small></button>` + `if (state.soundExpanded)`) and the per-lane `<button class="te-track-toggle" data-track-toggle>` with `track.expanded === false` → `.te-lane.collapsed`. |
| 3 | `src/client/markup.ts` `.tm-scene-panel-head` shipped a **static** `<div class="tm-sec-title">Selected Scene</div>`; `renderInspector()` only ever updated the sibling `#timeline-selected-name`. `renderInspector()` already computes `bgParent = backgroundContext()`, `inspectorTrack = bgParent ? mediaTrack() : track` and `inspectorItem = bgParent \|\| item`, so the panel's real subject was available at exactly the right place. |
| 4 | `src/client/styles.ts` had the panel's whole typography in one selector list capped at `font-size: 7.5px !important`, plus a second list for inputs/selects/`.tm-scene-add`/`.tm-scene-upload`. Those two `7.5px` declarations were the **only** `7px` / `7.5px` rules in `APP_CSS` (`grep -n "font-size: 7px\|font-size: 7\.5px"`), and `template-scene-editor.ts` — whose `__REEL_SCENE_CONTROL_UI__` builders fill `#timeline-child-editor` — emits more classes than the list named. |
| 5 | The top of the grid is `<div class="te-grid-corner te-grid-corner-scroll" aria-hidden="true"></div><div class="te-scroll-lane" data-scroll-lane …>` (timeline-editor.ts) with `.te-scroll-lane { background: var(--te-lane) }` and `.te-grid-corner-scroll { padding: 0 }`. The bottom strip is a different pair of rules (`.te-track-scroll` / `.te-scroll-layer`) and was left alone. |
| 6 | `#timeline-media-upload` is a hidden `<input>` in `markup.ts` that `handleAction("add-media")` clicks, and `addMediaFiles()` **prefers to reuse a pending placeholder** (`track.items.find(item => !item.assetId)`), which is the opposite of "always the right-most end". The composer modal the copy had to match (`#tpl-modal .tpl-box / .tpl-head / .tpl-x / .tpl-sub / .tm-gallery-grid / .tm-gcard / .tpl-actions`) is scoped to `#tpl-modal`, and its logic lives in `TEMPLATE_COMPOSER_JS` targeting studio accordions — not reusable from the timeline bundle. |
| 7 | `MEDIA_TRACK_LABEL = "Scene's media"` (timeline-editor.ts) and `label: "Scene's media"` in `batchTimelineState()` (app-js.ts). `normalizeState()` builds the media track from `DEFAULT_TRACK_SPECS`, whose `label` is `MEDIA_TRACK_LABEL`, so the constant — not the saved JSON — is what the dock renders. |

Two measurement facts came out of the audit and decided the implementation:

- `.te-group-title` is `width: 156px`, `position: sticky`, `z-index: 5`, and its sibling `.te-group-fill` is `overflow: hidden`. Content in the label cell can therefore wrap and can paint over the filler cell, but never the reverse — that is where the two background buttons had to live.
- `snapshotProject()` serialises only `durationSec`, `scenes` and `tracks`; `persistNow()` writes the **whole** state. A UI flag such as `soundExpanded` is saved for free and is invisible to Undo — the new `visualsExpanded` flag is deliberately built the same way.

### 21.3 Changes 1 + 6a — the background header loses its caption and gains ＋ Add Clips (`src/client/timeline-editor.ts`, `src/client/styles.ts`)

> **Partly superseded by §22.3 (2026-11-08):** `＋ Add media` / `＋ Add Clips` no longer sit in the 156 px label cell — `.te-group-background { flex-wrap: wrap }` and `.te-group-background .te-add-inline { margin-left: 5px }` are gone, and the pair lives in the row's fill cell inside `.te-background-actions-sticky`, sticky-left like `＋ Text` / `＋ Graphic`. The caption removal and the `BACKGROUND LAYER` label still stand.

- The emitted header is now
  `<div class="te-group-title te-group-background"><span class="te-group-label">BACKGROUND LAYER</span><button class="te-add-inline" data-timeline-action="add-media">＋ Add media</button><button class="te-add-inline" data-timeline-action="add-clips">＋ Add Clips</button></div>`
  — the entire `<small>pinned lowest · Pixabay, GIF, image or MP4</small>` node is gone, which satisfies both "remove the text `pinned lowest`" and "the text next to ＋ Add media must be removed".
- CSS, in the existing `.te-group-background` block: `flex-wrap: wrap; row-gap: 4px` plus the new `.te-group-background .te-add-inline { margin-left: 5px }`. `.te-group-label` is `width: 100%`, so the caption keeps the first line and the two buttons share the second, each starting 5 px inside the cell; the row grows past its `min-height: 31px` on its own (grid rows are `minmax(44px, auto)`-sized by content) and the cell's `z-index: 5` keeps it painting above the neighbouring `overflow: hidden` filler.
- `＋ Add media` keeps its behaviour untouched (it still clicks `#timeline-media-upload`); only its sibling is new.

### 21.4 Change 2 — TEXT & GRAPHICS is a collapsible group, in the Soundtrack's own style (`src/client/timeline-editor.ts`, `src/client/styles.ts`)

- New state flag `visualsExpanded`: `true` in `defaultTimeline()`, `base.visualsExpanded !== false` in `normalizeState()` (so it persists through `persistNow()` and an older saved project simply opens expanded), and `true` in the `batchTimelineState()` handoff in `app-js.ts`. It is **not** added to `snapshotProject()`, so folding a group is never an undo step.
- The header is now the Soundtrack's own markup: `<button type="button" class="te-group-toggle" data-timeline-action="toggle-visuals" aria-expanded="…"><span class="te-chevron">▾ / ▸</span> TEXT & GRAPHICS <small>n track(s)</small></button>`. Because it is `.te-group-toggle`, it inherits that class's font (0.69 rem / 850 weight) verbatim — the two group heads now render with one style — and the `<small>` lane count re-uses `.te-group-toggle small`.
- `handleAction()` gained `toggle-visuals` next to `toggle-sound`, with the same body: flip, `renderTimeline()`, `scheduleSave()`.
- The lane rows are emitted only while expanded (`if (state.visualsExpanded) { dockVisuals.forEach(…) }`), and each lane label gained the per-lane chevron the audio lanes use (`<button class="te-track-toggle" data-track-toggle="…" aria-expanded title="Expand or collapse …">`), with the lane itself getting `.te-lane.collapsed` and skipping its empty hint and its clips. **No new lane CSS was needed**: `.te-lane` / `.te-lane.collapsed` are generic, `.te-visual-lane` has no rule of its own, and the existing `toggle-track` action already flips `track.expanded` for any track id.
- Two small rules keep the longer copy honest: `.te-group-visuals .te-group-toggle { row-gap: 2px }` and `.te-group-visuals .te-group-toggle small { margin-left: 4px }` (the count follows the words instead of pushing itself to the edge of the 156 px cell).
- The `＋ Text` / `＋ Graphic` pair deliberately stays in the sticky filler cell while the group is folded, so an element can still be added; `addVisualElementFromAction()` and `addChildVisualElement()` set `state.visualsExpanded = true` first, so a new element is never added into a lane the user cannot see.

### 21.5 Change 3 — `Selected Scene` only for a Scene Media box, `Selected element` for everything else (`src/client/markup.ts`, `src/client/timeline-editor.ts`)

> **Partly superseded by §22.5 (2026-11-08):** the non-scene label is capitalised — `Selected Element`, with `aria-label="Selected Element controls"` — and the panel's second `＋ Text` button (`#timeline-add-text`) is removed. `Selected Scene` for a Scene Media box is unchanged.

- The static heading became addressable: `<div class="tm-sec-title" id="timeline-selected-title">Selected Scene</div>`. The default copy is unchanged, so the panel reads "Selected Scene" before the editor boots.
- `renderInspector()` re-titles it right after it writes `#timeline-selected-name`:
  `onMediaLayer = inspectorItem && inspectorItem.kind === "media"`, `mediaTrackOnly = !inspectorItem && inspectorTrack && inspectorTrack.kind === "media"`, then `"Selected Scene"` for either and `"Selected element"` otherwise. The panel's `aria-label` follows the same split (`Selected scene controls` / `Selected element controls`).
- The rule keys off **what the section is actually editing**, not off the raw click: `bgParent = backgroundContext()` already re-resolves a selected child text/graphic to its parent background box, so a child selection keeps `Selected Scene` — which is also what the §19 requirement ("the Selected Scene section holds the background media only") asks the panel to show. A text clip, a graphic, an audio clip or a bare visual lane are elements.

### 21.6 Change 4 — 10 px through the 30 % panel (`src/client/styles.ts`)

- Both declarations of the existing `#timeline-child-panel` typography block moved from `font-size: 7.5px !important` to `font-size: 10px !important` (the selector list and its `line-height: 1.4` are unchanged), and the block's comment no longer promises 7.5 px.
- New catch-all immediately after it: `#timeline-child-panel * { font-size: 10px !important; }`. `renderItemControls()` fills the panel through `__REEL_SCENE_CONTROL_UI__` (`template-scene-editor.ts`), which emits `.tm-scene-checkbox`, `.tm-scene-range-row`, `.tm-scene-photo-*` and the colour-popover classes; none of those are in the explicit list, so the wildcard is what makes "all 10 px" literal. The explicit list still wins the tie (`#timeline-child-panel .x` is more specific than `#timeline-child-panel *`) and keeps its line-height, and the inputs keep their `min-height` so the tap targets do not shrink.
- These were the only `7px` / `7.5px` declarations in `APP_CSS`; the new test asserts `assert.doesNotMatch(APP_CSS, /font-size:\s*7(\.5)?px/)`, i.e. none survive anywhere.

### 21.7 Change 5 — the top scroll layer is white (`src/client/styles.ts`)

> **Partly superseded by §22.4 (2026-11-08):** the white strip keeps no border at all — `.te-scroll-lane { border: 0 }` and `.te-grid-corner-scroll { padding: 0; border: 0 }`, dropping the `border-bottom` / `border-right` it inherited from `.te-grid-corner`. The `#ffffff` background and the bottom layer's lane look are unchanged.

- `.te-scroll-lane { background: #ffffff }` (was `var(--te-lane)`) and `.te-grid-corner-scroll { padding: 0; background: #ffffff }`, so the handle and the label-side cell above it read as one continuous white strip.
- The bottom strip (`.te-track-scroll`, `.te-scroll-layer`, `.te-scroll-hint`) keeps the lane look: only the top layer was asked for, and §16's "reads as one more layer" behaviour is untouched. The drag-to-pan pointer handling in `bindEvents()` was not modified.

### 21.8 Change 6b — the ＋ Add Clips modal (`src/client/markup.ts`, `src/client/timeline-editor.ts`, `src/client/styles.ts`)

> **Superseded by §22.9 (2026-11-08):** the timeline's own picker is deleted — `#timeline-clips-modal`, the whole `.te-clips-*` CSS block, `renderClipsModal()` / `closeClipsModal()` / `addClipsFiles()` / `toggleClipQueue()` / `clearClipQueue()` / `clipsLibrary()` and the card grid. `＋ Add Clips` now opens `#tpl-modal`, the very modal `Add video from template` opens, and the composed MP4 comes back through `window.__TIMELINE_TEMPLATE_CLIP__` → `appendTemplateClip()` → the §21 append-at-the-right-most-end path, which is the part of this section that still stands.

- **Where it lives:** a `#timeline-clips-modal` overlay inside `#timeline-editor`, right after the two hidden file inputs. Inside that root is deliberate — the editor's click delegation (`[data-timeline-action]`) is bound to `#timeline-editor`, so a body-level node would never see its buttons; `.timeline-editor-shell` is `overflow: visible`, so a `position: fixed` overlay is not clipped.
- **How it looks:** its own `.te-clips-*` block at the end of `APP_CSS` mirrors the composer shell rather than re-using it, because every composer rule is scoped to `#tpl-modal` (`.tpl-box`, `.tpl-head`, `.tpl-x`, `.tpl-sub`, `.tm-gallery-grid`, `.tm-gcard`, `.tpl-actions`): overlay `position: fixed; inset: 0; z-index: 120` + `.te-clips-overlay[hidden] { display: none }`, box `#0d0d0f` / `1px solid #2e3440` / `border-radius: 14px` / `padding: 18px` / `width: min(1100px, 96vw)` / `max-height: 92vh` / `overflow-y: auto`, a head with the title and a `✕`, a muted subtitle, a 4-column card grid, a status line (`role="status"`) and a `position: sticky; bottom: 0` action row whose primary button is the composer's `#f59e0b` → `#ffd83d` yellow; `.te-clips-grid` drops to two columns under 900 px, like the composer gallery.
- **What it lists:** `clipsAvailable()` walks `assetMap` and keeps every `image/*` / `video/mp4` blob — that is exactly the Quick Batch handoff's `scene-<n>` media (which arrives through `registerStoredAssets()` → `registerAsset()`, so it already has an object URL) plus anything uploaded here. Each card shows a real thumbnail (`<img>` for stills, `<video preload="metadata" muted>` for MP4 — `assetMap[id].image` is intentionally left detached because the canvas owns that element), the file name, the type or an `already on the layer · adds a copy` tag for a clip that is already placed, and `＋ Queue` / `✓ Queued`. A project with nothing stored gets an honest empty state instead of a blank grid.
- **How it queues:** `clipsQueue` is a module-level array of asset ids — deliberately **not** part of `state`, because a pending modal selection is not an edit and must not appear in the saved project or in Undo. Clicking a card toggles membership (`aria-pressed`), `Clear queue` empties it, the primary button reads `＋ Add n clip(s) to the end` and is disabled at zero, and `addClipsFiles()` (the modal's own `＋ Upload` input) registers + persists each accepted file (`api.storeAsset`), probes an MP4's length with `probeDuration(file, "video")`, and auto-queues it. `registerAsset()` gained a `durationSec` field for that purpose.
- **Where it lands:** `appendQueuedClips()` computes `nextStart = max(item.startSec + item.durationSec)` over the media track and **appends** each queued clip there, one new scene per clip, back to back (`nextStart += duration`), with `mediaType` derived from the mime type, the row's `videoStyle` / `videoStyleEffects` copied onto the scene, duration clamped into `MIN_CLIP_SEC … MAX_DURATION_SEC`. It never looks for a placeholder, so unlike `addMediaFiles()` it cannot overwrite a pending scene. Afterwards: `ensureTimelineEnd(nextStart)`, select the last clip, `renderTimeline(); renderInspector(); drawPreview(); scheduleSave()`, a `Queued n clips at the right-most end of Scene Media (from m:ss to m:ss).` status, and the modal closes with an empty queue.
- **Kept in sync:** `renderTimeline()` re-lists the grid when (and only when) the modal is open — guarded by `if (!isExporting && !recorder)` so an export never pays for the extra pass — which is what makes an upload through ＋ Add media appear as a card immediately. `Escape` (a document keydown that checks `!modal.hidden`) and a click on the backdrop both close it; a click inside the box never does.
- **Reachable for tests and console work:** `api.openClipsModal` / `api.closeClipsModal` / `api.clipsLibrary` / `api.getClipsQueue` / `api.toggleClipQueue` / `api.clearClipsQueue` / `api.addClipsFiles` / `api.appendQueuedClips`.

### 21.9 Change 7 — `Scene's media` → `Scene Media` (`src/client/timeline-editor.ts`, `src/client/app-js.ts`)

- `MEDIA_TRACK_LABEL = "Scene Media"`, and the `batchTimelineState()` handoff track literal is `{ id: "background-media", kind: "media", label: "Scene Media", expanded: true, items: mediaItems }`.
- Because `normalizeState()` rebuilds the media track from `DEFAULT_TRACK_SPECS` (which uses `MEDIA_TRACK_LABEL`) rather than trusting the saved label, **already-saved projects re-label themselves on the next load** — no migration was needed. The lane still shows its `BG` badge and `n scenes` count.

### 21.10 Files touched in this section

| File | What changed |
|---|---|
| `src/client/timeline-editor.ts` | `MEDIA_TRACK_LABEL = "Scene Media"`; `visualsExpanded` in `defaultTimeline()` and `normalizeState()`; the `TEXT & GRAPHICS` head became a `te-group-toggle` (`toggle-visuals`) and its lanes render only while expanded, each with the audio lanes' `te-track-toggle` + `.te-lane.collapsed`; the background header dropped its `<small>` and gained `＋ Add Clips`; `handleAction()` + `toggle-visuals` / `add-clips` / `clips-close` / `clips-clear` / `clips-add`; `renderTimeline()` refreshes an open clips modal; `renderInspector()` re-titles `#timeline-selected-title` and the panel `aria-label`; `addVisualElementFromAction()` / `addChildVisualElement()` re-open a folded group; `registerAsset()` records `durationSec`; the ＋ Add Clips module (`clipsQueue`, `clipsAvailable`, `clipsStatus`, `clipsQueued`, `toggleClipQueue`, `clearClipQueue`, `renderClipsModal`, `openClipsModal`, `closeClipsModal`, `addClipsFiles`, `appendQueuedClips`); the modal's card/backdrop clicks and the Escape handler in `bindEvents()`; eight new `api.*` entries. |
| `src/client/markup.ts` | `id="timeline-selected-title"` on the heading; the `#timeline-clips-modal` overlay (head + `✕`, subtitle, `＋ Upload` label with `#timeline-clips-files`, `#timeline-clips-count`, `#timeline-clips-grid`, `#timeline-clips-status`, `#timeline-clips-commit` / `clips-clear` / `clips-close`) after the two hidden file inputs, inside `#timeline-editor`. |
| `src/client/styles.ts` | `.te-group-background { flex-wrap: wrap; row-gap: 4px }` + `.te-group-background .te-add-inline { margin-left: 5px }`; `.te-group-visuals .te-group-toggle` (`row-gap`, `small { margin-left: 4px }`); `#timeline-child-panel` 7.5 px → **10 px** in both blocks + the `#timeline-child-panel *` 10 px catch-all; `.te-scroll-lane` and `.te-grid-corner-scroll` → `#ffffff`; the whole `.te-clips-*` modal block (+ its 900 px grid breakpoint) at the end of the stylesheet. |
| `src/client/app-js.ts` | `batchTimelineState()` gained `visualsExpanded: true` and the media track's `label: "Scene Media"`. |
| `tests/timeline-editor.test.mjs` | 33 tests (29 → 33): five assertions that encoded the old copy re-targeted (`pinned lowest` → gone, `Scene's media` → `Scene Media`, `7.5px` → `10px`, the two `.tm-sec-title` markup strings, `TEXT & GRAPHICS` now asserted on the toggle) and four new tests — see 21.11. |

### 21.11 Verification

- `node --import tsx --test tests/timeline-editor.test.mjs` → **33 / 33 pass** (40 s).
- The new tests, all of which boot the real page in JSDOM (`createHTML()` + `APP_JS` + `TIMELINE_EDITOR_JS`):
  1. *route isolation / lanes* (extended): the visuals header is a `.te-group-toggle` carrying `TEXT & GRAPHICS` and `1 track`; clicking `toggle-visuals` folds the group (`.te-lane` count 2 → 1, only `background-media` survives, the sticky `＋ Text` / `＋ Graphic` pair stays) and re-opens it; `[data-track-toggle="visual-1"]` folds one lane (`expanded === false`, `.te-lane.collapsed`, its clips unpainted) and re-opens it.
  2. *`the section above the tracks says Selected Scene only for a Scene Media box`*: media clip → `Selected Scene`; added text clip → `Selected element`; graphic → `Selected element`; background clip + `addChildElement("text")` → `Selected Scene`; `visual-1` track selected → `Selected element`; `background-media` track selected → `Selected Scene` + `aria-label="Selected scene controls"`.
  3. *`the top scroll layer is white and the clip picker borrows the composer's shell`*: `.te-scroll-lane` and `.te-grid-corner-scroll` are `#ffffff`, `.te-scroll-layer` is not; the modal ships inside the editor shell, is `position: fixed`, `[hidden]` really hides it, and its box/actions/primary button carry the composer's `#0d0d0f` / sticky / `#f59e0b` treatment.
  4. *`＋ Add Clips queues every chosen clip at the right-most end of the Scene Media layer`* + *`the clips modal uploads on its own and never steals a pending placeholder`*: the modal starts closed with a disabled action; ＋ Add Clips opens it and states the empty case; an ＋ Add media upload appears as a card (the open modal re-lists on `renderTimeline()`); a card click queues (`aria-pressed="true"`, `＋ Add 1 clip to the end`, enabled), a second click de-queues, the commit adds exactly one clip whose `startSec === max(end of the existing clips)`, one scene per clip, the last clip becomes the selected one, the queue empties, the modal closes and `#timeline-status` reports the right-most end; a direct `addClipsFiles()` of two PNGs plus a `text/plain` file queues only the two images, appends both **after** the right-most end, and leaves a deliberately forced pending placeholder untouched (12 → 14 items, still 1 pending); an empty queue adds nothing and says `Queue at least one clip first.`; dismissal is covered too — the head `✕`, a click on the backdrop and an `Escape` keydown all close the modal, while a click inside the box (on the grid) does not
- Updated assertions: `assert.doesNotMatch(heading, /pinned lowest/i)` + `assert.doesNotMatch(heading, /Pixabay/i)` + `assert.equal(heading.trim(), "BACKGROUND LAYER")` + `.te-group-background .te-add-inline { margin-left: 5px }` + the `["add-media", "add-clips"]` button order; the media lane's first text node is `"Scene Media"` and `Scene's media` appears nowhere in `#view-timeline` or in `APP_JS`'s track literal; the child panel's rule, its inputs rule and the new catch-all all resolve to `10px !important` and `APP_CSS` matches no `font-size: 7px` / `7.5px` at all.
- Computed-style spot check in JSDOM (throwaway script, deleted after use): `.te-scroll-lane` and `.te-grid-corner-scroll` → `rgb(255, 255, 255)`, the bottom `.te-scroll-layer` still `var(--te-lane)`; `#timeline-child-panel` and every node inside it (`.te-child-head strong/small`, `.tm-scene-kicker`, `.tm-scene-add`, `.te-child-row-label`, plus an injected `.tm-scene-field` and its checkbox) → `10px`, while `.tm-sec-title` outside the panel is untouched; the visuals toggle and the Soundtrack toggle resolve to the same computed font; `margin-left: 5px`; `.te-group-background` `flex-wrap: wrap`; the modal's `[hidden]` overlay computes `display: none`, opens to `display: flex`, its box computes `rgb(13, 13, 15)`, and the disabled primary button computes the disabled grey.
- `npx tsc --noEmit`: 31 error lines, **byte-identical to the same command at `e783116`** (all of them pre-existing `src/index.ts` diagnostics; none in a file this section touched).
- `npx wrangler deploy --dry-run`: exit `0`, `Total Upload: 3038.08 KiB / gzip: 1370.99 KiB`.
- Whole suite `node --import tsx --test --test-concurrency=4 tests/*.test.mjs`: `550 tests, 504 pass, 40 fail, 6 cancelled`. The 40 failures sit in eight files (`api-relay`, `session-261-browser-offload`, `session-262-load-balancing`, `session-250-batch-pipeline`, `seo-walkthrough`, `deep-debug-regressions`, `session-244`, `llm-openrouter`). Those eight were re-run as a group with the changes applied **and** on a stashed (pristine `e783116`) tree: **`141 tests / 95 pass / 40 fail` in both cases**, i.e. identical. They are the pre-existing Worker/relay/image-batch groups already recorded in sections 8.6 and 20.15 — no regression from this section, and no new failure was introduced in any file.

### 21.12 Notes, gotchas and deliberate decisions

> **Partly superseded by §22.3 and §22.9 (2026-11-08):** "The buttons stay in the 156 px label cell and wrap" (and the note that moving them into `.te-group-fill-background` would leave the row without a header) no longer describes the code — they moved into the fill cell and the header stayed. "The modal re-uses the composer's *look*, not its classes" and "No stock search inside the modal" are gone with the picker: it *is* the composer's modal now.

- **Both readings of "remove the text" are satisfied by one removal.** Item 1 named `pinned lowest` and item 6 named "the text next to ＋ Add media"; both are the same `<small>` node, so it is deleted whole rather than half-edited into `· Pixabay, GIF, image or MP4`.
- **The buttons stay in the 156 px label cell and wrap.** They could not be pushed onto the caption's line: `.te-group-title` is 156 px (132 px under 560 px) and the pair is ~140 px wide, so `flex-wrap` (with the label's `width: 100%`) puts them on a second line. The alternative — moving them into `.te-group-fill-background` — would have left the background row without a header at all.
- **`visualsExpanded` is saved but not undoable, on purpose.** `persistNow()` writes the whole state, so the fold survives a reload; `snapshotProject()` covers `durationSec` / `scenes` / `tracks`, so Undo never fights the flag. The per-lane `track.expanded` **is** inside `tracks` and therefore undoable — exactly as the audio lanes already behaved, and consistency with Soundtrack was the request.
- **No new lane CSS for the fold.** `.te-lane.collapsed`, `.te-track-toggle` and the `toggle-track` action were already generic; the visual lanes were wired to them rather than given a parallel vocabulary, which is why "same style and font as the soundtrack" holds for both the group head and the individual lanes.
- **The modal re-uses the composer's *look*, not its classes.** Every `#tpl-modal` rule is id-scoped and `openTemplateModal()` in `TEMPLATE_COMPOSER_JS` drives studio accordions, so `.te-clips-*` re-declares the same shell (same hexes, radii, widths and the sticky yellow action row) under names the timeline bundle owns.
- **No stock search inside the modal.** The timeline bundle deliberately makes no Worker call (it is the editor's standing rule), and `src/client/pixabay-direct.ts` needs `/api/media/config`, `/claim` and `/settle`. The picker is therefore the row's own media (IndexedDB handoff + uploads) — the honest superset of "the videos this row already has". If a stock browser is wanted later, it has to arrive as a Worker-backed endpoint, not as another `fetch` from this bundle.
- **The queue is transient by design.** `clipsQueue` is a module-level array, so a reload with the modal open starts empty. Committing is the only step that touches `state` — which keeps a half-built queue out of both the saved JSON and the history stack.
- **Append-only, never in-place.** `addMediaFiles()` still fills the first pending scene placeholder (that is what the ＋ Add media flow is for); `appendQueuedClips()` explicitly does not. A test forces a placeholder to exist and asserts it survives, because "queued to the right-most end" and "reused slot" are contradictory and the second is the existing behaviour of the other button.
- **`Selected element` follows the panel, not the click.** A child text/graphic is re-resolved to its background box (`backgroundContext()`), so the heading stays `Selected Scene` there; that is the §19 contract ("the section shows the background media only") and re-titling it would have contradicted the panel below it.
- **10 px is applied with the panel's own `!important`, and now with a wildcard.** The wildcard is the load-bearing part: without it the shared control builders keep their own sizes. If a future control renders text through a nested element with an inline `style="font-size:…"`, inline styles beat even `!important` on a selector, so such a control would need the panel list extended.
- **Only the top strip turned white.** `.te-scroll-lane` also carries `cursor: grab` and `touch-action: pan-x`, both untouched, and the bottom `.te-scroll-layer` keeps the lane tokens on purpose.

### 21.13 Superseded copy in this file

The older sections are kept as they were written; each of the three headings below now carries a one-line pointer to this section. These are the specific lines that no longer describe the code:

- §10 (*Background-layer timeline and Min-column removal*) — its dock-order note, its `GROUP: BACKGROUND LAYER pinned lowest · Pixabay, GIF, image or MP4 + Add media` transcript and its `Pixabay & uploaded media · background` lane label. The caption is gone (21.3) and the lane label is `Scene Media` (21.9).
- §19's "renames `Selected element` → `Selected Scene`" outcome: the static default is still `Selected Scene`, but `Selected element` is back as a **runtime** label for every non-scene selection (21.5).
- §20.13's 7.5 px `#timeline-child-panel` typography, including its "7.5 px is intentional" note in 20.16 — the panel is 10 px now, with a wildcard (21.6).

### 21.14 Still open

> Re-verified 2026-11-09 (§0.10): every item below is still unfulfilled in the current code; done items were removed and uncertain ones are tagged **DONE**.

> **Superseded by §22.9 (2026-11-08), verified 2026-11-09:** a commit during an export *is* blocked (`openTemplateClipsModal()` and `appendTemplateClip()` both guard `isExporting || recorder`), the transient queue is no longer user-visible (`clipsQueue` is a one-shot buffer drained inside `appendTemplateClip()`), and `＋ Add Clips` (composer modal) and `＋ Add media` (file/IndexedDB picker) are now two different surfaces, not two flavours of the same append.

- The clips modal has no trimming, reordering or per-clip duration control; a queued MP4 keeps its probed length (5 s for stills and for anything that cannot be probed).
- The queue is not persisted, so pending composer picks are lost on reload (21.12).
- A folded `TEXT & GRAPHICS` group still hides its lanes from drag-on-canvas selection, because the clip is not in the DOM; auto-opening the group on add was chosen over keeping the selection working while folded.

> Removed 2026-11-09: the old "a commit while an export is running is not blocked" and "`＋ Add Clips` and `＋ Add media` overlap in source" bullets are **done** (§22.9 / §22.1).

### 21.15 Status

- All 7 code changes are implemented, and this section documents each of them (item 8).
- Test state: `tests/timeline-editor.test.mjs` **33 / 33**; the eight failing files of the wider suite fail with **identical counts** on a pristine `e783116` (141 / 95 / 40 both ways); `tsc --noEmit` unchanged; `wrangler deploy --dry-run` green.

## 22. Background-row buttons in the fill cell, a borderless top scroll layer, `Selected Element`, heading + helper copy removal, square neo buttons, ＋ Add Clips = the template composer's own modal, one open accordion on first load, locked Actions icons with no text, and non-overlapping ＋ Text / ＋ Graphic placement (2026-11-08)

### 22.1 Request & authority order

The request, item by item, as it was given (item 10 is this section):

1. **Timeline editor** — remove the `Add clips` and `Add media` buttons from the bottom of the BACKGROUND LAYER label cell; copy the positioning pattern of `＋ Text` / `＋ Graphic`, i.e. the two buttons must sit in the layer/row to the right of the "Background Layer" text, on one line. Also: **no border on the scroll layer at the top of the tracks**.
2. The heading `Selected element` must read **`Selected Element`** (capital E), and the **`Text`** button rendered on the new line below it must go.
3. Remove the long Quick-table helper paragraph that begins "Type or paste a script in the first box, pick the video image style … the export is built in this browser."
4. Remove `VIDEO WORKSPACE`, `🎬 YouTube Vibe Studio` and `Generates AI scenes, adds your MP3 soundtrack, and exports a cinematic MP4…` from the editor layout, the table layout **and** the timeline editor page. On the Quick Batch **table** layout, remove the `＋ Add Video` button above the table — it belongs to the editor layout only.
5. Neo-brutalism: **all buttons square, no rounded corners** — including button-like designs.
6. The `Add Clips` button on the timeline tracks must open **exactly the same modal** that `Add Video From Template` opens — change the current implementation to that.
7. The editor layout must have **one accordion open on first page load**, and the `＋ Add Video` control must **not** carry clicked-down/pressed styling.
8. Quick Batch table: for rows **not yet ready** for generation, the Actions-column buttons must already be rendered but **disabled / not clickable**, and there must be **no text** in the Actions column for those rows.
9. When `＋ Text` or `＋ Graphic` is clicked on the timeline, the newly added element must **not occupy the same time span** as any element in the text/graphics or media scene tracks — prevent the overlap in JS.
10. **Document the prompt in `bug-fix-session-331.md`.**

Authority order for this section, as for §19–§21: **the current workspace code is the first source of truth, this file the second.** Where an older section describes behaviour this section changed, the older text stays as it was written and is listed in 22.16 (*Superseded copy in this file*) instead of being rewritten.

### 22.2 Code study that drove the changes (pre-change audit)

- **The background row** put its label and its two buttons in the same 156 px cell: `.te-group-title.te-group-background` held `.te-group-label` ("BACKGROUND LAYER") plus `＋ Add media` / `＋ Add Clips`, and §21.3's `flex-wrap: wrap` + `.te-group-background .te-add-inline { margin-left: 5px }` forced the pair onto a **second line under the words**. The pattern item 1 asks to copy already existed one row below: the visual lanes keep `＋ Text` / `＋ Graphic` in a `.te-visual-actions-sticky` span inside the row's **fill cell** (`.te-group-fill`), `position: sticky; left: 156px; z-index: 30`.
- **The top scroll layer** had been painted white in §21.7, but `.te-scroll-lane` still carried its own `border-bottom` and `.te-grid-corner-scroll` inherited `border-right`/`border-bottom` from the shared `.te-grid-corner` rule — so a line was drawn under the white band and down its left edge.
- **`renderInspector()`** set `#timeline-selected-title` to `Selected element` (§21.5's lower-case e) and the panel still rendered `#timeline-add-text` — a second `＋ Text` on its own line under the heading — beside `#timeline-add-graphic`.
- **`PAGE_MARKUP`** carried `.batch-hint` (the "Type or paste a script…" paragraph) above the Quick Batch table, and `#studio-heading` carried `.kicker` (`VIDEO WORKSPACE`), `.heading h1` (`🎬 YouTube Vibe Studio`) and `.heading p` (`Generates AI scenes…`) in **every** layout, with `#bulk-toggle` (`＋ Add Video`) inside `.heading-actions`. Two themed variants re-painted the same three nodes.
- **The neo skin** gave buttons `border-radius: 2px`, and dozens of button-like elements (chips, pills, toggles, file labels, everything with a `[data-*]` click hook) inherited radii from **id-scoped** rules such as `#studio-app …` that out-specificity any `html[data-theme="neo"]` selector.
- **`＋ Add Clips`** opened the timeline's own `#timeline-clips-modal` (§21.8): a separate picker with its own `.te-clips-*` CSS block, upload input, card grid and queue. `Add video from template` opens `#tpl-modal`, built at runtime by `TEMPLATE_COMPOSER_JS`'s `openTemplateModal(n)` — which needs a studio accordion, and `videoProjects` lives **only** in `APP_JS`'s script scope (never on `window`), unreachable from the timeline bundle.
- **On load** nothing created an accordion: the editor layout could boot completely empty, and `#studio-app .heading-actions .bulk-toggle` gave `＋ Add Video` a **permanent** pressed look (`box-shadow` + `transform: translate`) that only `:active` should have.
- **`batchActionCell()`** printed the `Preview Here · Export Video` sentence inside a `.batch-pending` pill for unfinished rows and drew the icons only for finished ones; `✎ Edit` was always live.
- **`addVisualElement()`** placed every free element at the playhead. On a Quick Batch handoff the 12 Scene Media clips fill 0–60 s wall to wall and the seeded `dummy-text-1` sits at 0–4 s, so a new `＋ Text` landed **exactly on top of** both — item 9's overlap.

### 22.3 Change 1 (item 1a) — the two buttons move into the background row's fill cell (`src/client/timeline-editor.ts`, `src/client/styles.ts`)

`renderTimeline()` now emits the label cell with the label only, and puts the pair in the fill cell on the right, wrapped in one sticky span exactly like the visual lanes' `＋ Text` / `＋ Graphic` (timeline-editor.ts:1120–1128):

```js
html += '<div class="te-group-fill te-group-fill-background te-background-actions"><span class="te-background-actions-sticky">' +
    '<button type="button" class="te-add-inline" data-timeline-action="add-media">＋ Add media</button>' +
    '<button type="button" class="te-add-inline" data-timeline-action="add-clips">＋ Add Clips</button></span>' +
    playheadHtml(playheadLeft, false) + '</div>';
```

CSS (styles.ts:10465–10500): `.te-group-fill.te-background-actions` is `display:flex; align-items:center; gap:6px; padding:3px 8px; overflow:visible` (a hidden overflow would make the cell its own scroll container and `sticky` would never move), and `.te-background-actions-sticky` is `position:sticky; left:156px; z-index:30; display:inline-flex; gap:6px; flex:0 0 auto; flex-wrap:nowrap; white-space:nowrap; padding:3px 8px; border-right:1px solid var(--t-line-2); background:var(--t-panel-2,#191d15)`. Under the 560 px breakpoint the sticky offset follows the narrower label column (`left:132px`, styles.ts:10903). The `border-top` that used to belong to `.te-group-background` moved onto `.te-group-background, .te-group-fill-background` so the row still separates from the lane above it now that the buttons are in the fill cell; §21.3's `.te-group-background { flex-wrap: wrap }` and `.te-group-background .te-add-inline { margin-left: 5px }` are deleted.

### 22.4 Change 2 (item 1b) — the top scroll layer keeps no border (`src/client/styles.ts`)

`.te-scroll-lane` is now `height:26px; border:0; background:#ffffff; cursor:grab; touch-action:pan-x` (styles.ts:10250–10257) and `.te-grid-corner-scroll` is `padding:0; border:0; background:#ffffff` (styles.ts:10223–10227), which also drops the borders it inherited from `.te-grid-corner`. The white band therefore ends where the ruler begins with nothing drawn between them, and nothing is drawn down its left edge either. The empty layer at the **bottom** of the dock keeps the lane look — only the top one was asked for.

### 22.5 Change 3 (item 2) — `Selected Element`, and no second `＋ Text` (`src/client/timeline-editor.ts`, `src/client/markup.ts`)

`renderInspector()` writes `"Selected Element"` for every non-scene selection and `"Selected Scene"` for a Scene Media box, and the panel's `aria-label` follows it (`"Selected Element controls"` / `"Selected scene controls"`, timeline-editor.ts:1498–1500). The baked markup keeps `Selected Scene` as the static default (markup.ts:891) so nothing is served that the runtime does not immediately re-title. `#timeline-add-text` — the `＋ Text` button on its own line under the heading — is removed from `PAGE_MARKUP`; `#timeline-add-graphic` stays, and the dock's `[data-timeline-action="add-text"]` is now the only `＋ Text` on the page.

### 22.6 Change 4 (item 3) — the Quick-table helper paragraph is gone (`src/client/markup.ts`)

The whole `.batch-hint` block ("Type or paste a script in the first box, pick the video image style … the export is built in this browser.") is deleted from the served markup, with a comment marking the removal (markup.ts:393). The Pixabay `.va-note` under the direct-search panel is a different node and stays. `system-rules.md:1023` quotes the same paragraph — that file is not this project's history of record, so it is listed in 22.16 rather than edited.

### 22.7 Change 5 (item 4) — the heading copy is gone from all three layouts, and `＋ Add Video` is editor-only (`src/client/markup.ts`, `src/client/app-js.ts`, `src/client/styles.ts`)

`#studio-heading` now holds **only** `.heading-actions > #bulk-toggle` (`＋ Add Video`) — the `VIDEO WORKSPACE` kicker, the `🎬 YouTube Vibe Studio` title and the `Generates AI scenes…` line are deleted from the markup, together with their `.kicker`, `.heading h1`, `.heading p` rules and both themed variants (styles.ts:7625–7660, 8181–8183). Visibility is layout-driven:

- `setStudioLayout()` → `studioHeading.hidden = studioLayout !== "editor"` (app-js.ts:7532–7533), so the table layout no longer shows `＋ Add Video` above the table;
- `activateTimelineEditorLayout()` → `studioHeading.hidden = true` (app-js.ts:7499–7500), so the timeline page shows none of it.

Because `#studio-app .heading { display:flex }` beats the `hidden` attribute, `#studio-app .heading[hidden] { display:none }` was added, and `#studio-app.timeline-mode .heading` joined the existing `display:none !important` group (styles.ts:7649, 9158). The brand still lives where it belongs: `<title>`, the meta description, the sticky top bar (`VIBE STUDIO`), the landing page and the sign-in modal.

### 22.8 Change 6 (item 5) — neo-brutalism: every button is square (`src/client/styles.ts`)

The neo skin's existing button rule went from `border-radius: 2px` to `0`, and a new sweep (styles.ts:4273–4320) forces `border-radius: 0 !important` on everything button-like under `html[data-theme="neo"]`: the elements (`button`, `summary`, `input[type=button|submit|reset]`, `input[type=file]::file-selector-button`), the ARIA roles (`button`, `tab`, `menuitem`, `option`), the click hooks (`[onclick]`, `[data-layout]`, `[data-timeline-action]`, `[data-batch-action]`, `[data-track-select]`, `[data-track-toggle]`, `[data-child-id]`), the class-name patterns (`[class*="-btn"]`, `"btn-"`, `"-toggle"`, `"-chip"`, `"-pill"`, `"-badge"`, `"-link"`, `"-cta"`, `"-action"`, plus every child of a `[class*="-actions"]` row) and an explicit list of the studio's own controls (`.bulk-toggle`, `.upload-btn`, `.app-generate`, `.view-switch`, `.view-switch-btn`, `.tm-gallery-tab`, `.tm-scene-object`, `.tm-scene-add`, `.tm-scene-delete`, `.tm-scene-upload`, `.tpl-file`, `.tpl-primary`, `.te-add-inline`, `.te-clip`, `.te-lane-empty`, `.te-history`, `.te-track-badge`, `.badge`, `.credit-pill`). The `!important` is deliberate: without it the id-scoped rules win. The neo tokens `--t-radius: 3px` / `--t-radius-sm: 2px` are **left alone** on purpose, so panels, cards, inputs and modals keep their radius — the request was about buttons.

### 22.9 Change 7 (item 6) — `＋ Add Clips` opens the template composer's own modal (`src/client/timeline-editor.ts`, `src/client/app-js.ts`, `src/client/template-composer-js.ts`, `src/client/markup.ts`, `src/client/styles.ts`)

The timeline's own picker is deleted whole: `#timeline-clips-modal` and its head/subtitle/`＋ Upload` label/`#timeline-clips-files`/`#timeline-clips-count`/`#timeline-clips-grid`/`#timeline-clips-status`/commit-clear-close row are gone from `PAGE_MARKUP`, the 5 421-character `.te-clips-*` CSS block is gone from `APP_CSS` (replaced by a note comment, styles.ts:10933), and `renderClipsModal()`, the `[data-clips-card]` handlers, the `#timeline-clips-files` change listener and the modal's Escape/backdrop handling are gone from `TIMELINE_EDITOR_JS`. The api lost `clipsLibrary`, `closeClipsModal`, `toggleClipQueue`, `clearClipsQueue` and `addClipsFiles`.

What replaces it is a three-part hand-off, because the composer needs a studio accordion and `videoProjects` is script-scoped inside `APP_JS`:

1. **`APP_JS` opens the modal** — `openTemplateModalForTimeline()` (app-js.ts:6660–6681, exported as `window.openTemplateModalForTimeline`): if `window.openTemplateModal` is missing it returns `false`; if `videoProjects` is empty it calls `addVideoAccordion()`; then `window.openTemplateModal(n)` for the last project. That is the same function the editor layout's `Add video from template` link calls, so the modal is *literally* the same one (`#tpl-modal`, built at template-composer-js.ts:2169).
2. **`TIMELINE_EDITOR_JS` asks for it** — `openTemplateClipsModal()` (timeline-editor.ts:2085–2103) guards `isExporting || recorder`, prefers `window.openTemplateModalForTimeline()`, falls back to `window.openTemplateModal(videoProjects.length)` for a page that loaded the composer without `APP_JS`'s helper, and reports through `setStatus()` when neither is available. `handleAction()` routes `add-clips` to it (timeline-editor.ts:2733).
3. **The composed MP4 comes back to the timeline** — `appendTemplateClip(clip)` (timeline-editor.ts:2105–2120) validates the bytes (`clip.blob || clip.file`), refuses while an export runs, refuses past `MAX_MEDIA_FILES`, registers the asset, persists it through `api.storeAsset(pageId, …)`, queues it and returns `appendQueuedClips()` — the §21 append path, i.e. **after the right-most Scene Media clip, one scene per clip, `mediaSource: "template composer"`**. It is registered as `window.__TIMELINE_TEMPLATE_CLIP__` **inside `bindEvents()`** (timeline-editor.ts:3400), never at module top: everything before the `routeRequested()` guard runs on every layout, and a sink registered on the editor layout would silently steal composed clips from the Video N galleries.
4. **The composer honours the sink** — `timelineClipSink()` (template-composer-js.ts:2022–2026) and a branch in `addTemplateToVideo()` (template-composer-js.ts:2100–2128) that runs **before** the gallery path: it calls `sink({ blob, file, name, durationSec: clipDuration })`, re-enables the Add button, reports `Added to the Scene Media layer (0:06) — at the right-most end of the timeline` or `The timeline could not take this clip; nothing was added`, and **keeps the modal open** so several clips can be composed in a row. With no sink registered — the editor layout — the `MAX_MP4_UPLOADS` 5-clip cap, `project.assets.push(asset)`, `buildVaCard()` and `updateVideoStatus()` all behave exactly as before, and the sink branch skips the cap on purpose: the timeline's own limit is `MAX_MEDIA_FILES`.

### 22.10 Change 8 (item 7) — one open accordion on first load, and `＋ Add Video` unpressed (`src/client/app-js.ts`, `src/client/styles.ts`)

`ensureEditorAccordionOnLoad()` (app-js.ts:6617–6657, exported as `window.__ensureEditorAccordionOnLoad`) runs in the boot's non-timeline branch, after `restorePipelineManagementState()` / `applyTransitionProject()` (app-js.ts:24053): it returns early unless `studioLayout === "editor"`; creates `Video 1` through `addVideoAccordion()` when the studio is empty; re-opens `#va-body-1` through `toggleVideoAccordion(1)` if the restored state left it collapsed (an accordion the page loads with must be **open**, not merely present); and strips `active` / `pressed` / `is-down` from `#bulk-toggle` while forcing `aria-expanded="false"` and `aria-pressed="false"`.

The pressed look itself was CSS, not state: `#studio-app .heading-actions .bulk-toggle` carried a permanent `box-shadow` + `transform: translate(...)`. Those now sit only on `:active` (`box-shadow:1px 1px 0 var(--t-line); transform:translate(1px,1px)`), with `box-shadow:none; transform:none` on the base rule and on `:hover` (styles.ts:7666–7710), so the button reads as unpressed until it is actually being pressed.

### 22.11 Change 9 (item 8) — the Actions column draws three locked icons and no text (`src/client/app-js.ts`, `src/client/styles.ts`)

`batchActionCell(row, kind)` (app-js.ts:9751–9767) renders `▶ Preview`, `⚙ Process export` and `✎ Edit` for **every** row, ready or not:

```js
const ready = batchRowFinished(row);
const locked = ready ? "" : ' disabled aria-disabled="true"';
const classes = "upload-btn small batch-action-btn" + (ready ? " batch-live" : "");
const suffix = " unlocks when this row is generated";
```

Each button carries `title="Preview"` / `"Process export"` / `"Edit timing in the new timeline editor"` when ready and the same title plus the suffix when not, an `aria-label`, and **no text node at all** — the cell prints nothing but the three glyphs. `batchRowFinished()` stays the single flag behind all three, so they still unlock together at the same moment. The delegated `[data-batch-action]` handler now returns early on `target.disabled || target.getAttribute("aria-disabled") === "true"` (app-js.ts:13150–13162), which keeps a synthetic dispatch out too. `.batch-pending` and its dashed pill are deleted from `APP_CSS` (styles.ts:8012–8020); `.batch-action-btn:disabled { cursor: not-allowed }` stays so a locked icon still reads as locked.

### 22.12 Change 10 (item 9) — a new `＋ Text` / `＋ Graphic` never shares a timed window (`src/client/timeline-editor.ts`)

Three helpers plus a rewritten `addVisualElement()` (timeline-editor.ts:1637–1758):

- `TIMING_EPSILON_SEC = 0.001` — touching edges (`end === start`) are not an overlap.
- `occupiedVisualWindows()` merges **every** item of **every** visual lane with every item of the Scene Media lane (audio lanes are excluded — a soundtrack is not picture space), clamps each to `[0, MAX_DURATION_SEC]`, and sorts by start. The seeded `dummy-text-1` counts as taken space, because it is a real editable clip; subtitle cues never enter the list, because they are not in `state.tracks` at all.
- `visualWindowIsFree(start, duration)` — true when no occupied window intersects `[start, start+duration)` beyond the epsilon.
- `freeVisualWindow(duration)` — (1) the playhead's own window when it is free; (2) otherwise the **first gap from 0 s** wide enough for the whole clip, scanning the merged intervals; (3) otherwise append after the right-most end and report `appended: true`.

`addVisualElement()` uses it **only when `parentItem` is absent**: a child of a background clip keeps `childWindow(parent)`, which is the §20 contract (a child lives inside its own scene). The scene is then resolved from where the element actually landed — `activeSceneAt(start) || activeSceneAt(state.playheadSec) || state.scenes[0]` — because a window appended past the last scene has no scene of its own. The playhead **follows** the new element (`state.playheadSec = start` when it was outside the window), so the element just added is the element on screen and can be dragged on the canvas immediately; `ensureTimelineEnd(start + duration)` still grows the project when the element lands past the end. `addVisualElementFromAction()` reports the window it took: `Text added in its own lane at 1:00 – 1:04 — the first timed space no other text, graphic or Scene Media clip occupies.` (and keeps the `top layer` wording for the four-lane capped case). `api.freeVisualWindow` / `api.occupiedVisualWindows` are exported for tests.

### 22.13 Files touched in this section

| File | What changed |
|---|---|
| `src/client/timeline-editor.ts` | The background row's label/fill split with `.te-background-actions-sticky` (1120–1128); `"Selected Element"` + its `aria-label` (1488–1500); `TIMING_EPSILON_SEC`, `occupiedVisualWindows()`, `visualWindowIsFree()`, `freeVisualWindow()` (1637–1682); `addVisualElement()` rewritten around the free window, the scene resolution and the playhead parking (1706–1758); `addVisualElementFromAction()`'s status copy (2194–2216); `openTemplateClipsModal()` + `appendTemplateClip()` replacing the whole `#timeline-clips-modal` module (2071–2160); `window.__TIMELINE_TEMPLATE_CLIP__` registered in `bindEvents()` (3400); api block rewritten (`openClipsModal`, `appendTemplateClip`, `freeVisualWindow`, `occupiedVisualWindows`; `clipsLibrary` / `closeClipsModal` / `toggleClipQueue` / `clearClipsQueue` / `addClipsFiles` removed). |
| `src/client/app-js.ts` | `ensureEditorAccordionOnLoad()` + `openTemplateModalForTimeline()` and their two `window` exports (6617–6685); `studioHeading.hidden = true` in `activateTimelineEditorLayout()` (7499) and `= studioLayout !== "editor"` in `setStudioLayout()` (7532); `batchActionCell()` (9751–9767); the disabled/`aria-disabled` guard in the `[data-batch-action]` delegation (13150–13162); the boot call to `ensureEditorAccordionOnLoad()` (24053). |
| `src/client/template-composer-js.ts` | `timelineClipSink()` (2022–2026) and the sink branch of `addTemplateToVideo()` (2100–2128) with its two status sentences; the gallery path is untouched when no sink is registered. |
| `src/client/markup.ts` | `#studio-heading` reduced to `.heading-actions > #bulk-toggle` (321–352); the `.batch-hint` paragraph deleted (393); `#timeline-add-text` deleted, `#timeline-add-graphic` kept (902); the whole `#timeline-clips-modal` overlay deleted. |
| `src/client/styles.ts` | The neo `border-radius: 2px` → `0` fix plus the `border-radius: 0 !important` sweep (4230–4320); the heading block cut down to `＋ Add Video` with `.heading[hidden] { display:none }` and the unpressed `.heading-actions .bulk-toggle` (7625–7710); the themed `.heading h1` / `.heading p` variants deleted (8181–8232); the `.batch-pending` rule deleted (8012–8020); `#studio-app.timeline-mode .heading` added to the `display:none !important` group (9158); `.te-grid-corner-scroll` and `.te-scroll-lane` → `border:0` (10219–10257); `.te-group-fill.te-background-actions` + `.te-background-actions-sticky` (10465–10500) and their 560 px variant (10903); the `.te-clips-*` block deleted (10933). |
| `tests/timeline-editor.test.mjs` | Test 10 (background buttons) re-targeted at the sticky-in-fill-cell contract; test 22 (dock actions) clicks `.te-visual-actions-sticky [data-timeline-action="add-text"]` and asserts `#timeline-add-text` is null; test 23 (canvas drag) drags the new element where it actually landed; test 29's overlap tolerance widened to half a pixel with an exact per-second timing assertion added; test 30's three `Selected element` expectations capitalised; tests 31–33 replaced by three new ones for the borderless white strip, the composer-modal hand-off and the append-only guarantee. |
| `tests/quick-batch-table.test.mjs`, `tests/final-media-cap-actions.test.mjs`, `tests/script-pipeline-hang.test.mjs`, `tests/session-244.test.mjs`, `tests/render-hang-regressions.test.mjs` | Re-targeted at the new contracts: no `"Preview Here"` / `"Export Video"` / `.batch-pending`; three locked icons per unfinished row and no words in the cell; a new `finishRow()` fixture so an Edit-handoff test can unlock its row; the boot-created `Video 1` taken into account (`accordionsOnBoot`, and a drain loop in the render-queue test). |

### 22.14 Verification

- `node --import tsx --test tests/timeline-editor.test.mjs` → **33 / 33 pass** (47 s). The tests that carry this section:
  1. *background buttons* (re-targeted): the label cell holds `BACKGROUND LAYER` and nothing else; `.te-background-actions-sticky` sits inside `.te-group-fill.te-background-actions` on the same row, computes `position: sticky`, `left: 156px`, `z-index: 30`, `overflow: visible` on the cell, `flex-wrap: nowrap` and `white-space: nowrap` on the wrapper, in the order `["add-media", "add-clips"]`; the old `.te-group-background .te-add-inline` rule no longer exists in `APP_CSS`.
  2. *dock actions* (re-targeted): `＋ Text` is clicked through `.te-visual-actions-sticky [data-timeline-action="add-text"]`, `#timeline-add-text` is `null` and `#timeline-add-graphic` survives; the heading reads `Selected Element` and the panel's `aria-label` is `Selected Element controls`.
  3. *canvas drag* (re-targeted): the newly added element is dragged where it actually landed — the test now asserts `state.playheadSec === text.startSec` and `text.startSec === 64` (the graphic took 60–64 on a wall-to-wall 0–60 s timeline) instead of resetting the playhead to 0, which used to work only because elements were added *at* the playhead.
  4. *undo/redo + 80 s sliders* (tolerance fixed): the dock-overlap loop now allows half a pixel, because `left` and `width` are each painted with `toFixed(1)` and the project grew to 65 s (a fractional pixels-per-second), and an exact per-second timing assertion was added beside it.
  5. *`the top scroll layer is white and borderless, and ＋ Add Clips opens the studio's own template modal`*: `.te-scroll-lane` and `.te-grid-corner-scroll` are `#ffffff` **and** `border: 0`, the bottom `.te-scroll-layer` is not white; `#timeline-clips-modal` / `#timeline-clips-grid` are absent from `createHTML()`, no `.te-clips-*` rule survives in `APP_CSS`, `TEMPLATE_COMPOSER_JS` still builds `modal.id = "tpl-modal"`, and both halves of the bridge exist (`window.openTemplateModalForTimeline` in `APP_JS`, its use in `TIMELINE_EDITOR_JS`).
  6. *`＋ Add Clips opens the Add video from template modal and its MP4 lands at the right-most end of Scene Media`*: with the opener stubbed (building the real `#tpl-modal` means painting 15 canvas previews), one click calls it once and the dock names the modal; `window.__TIMELINE_TEMPLATE_CLIP__({ blob, file, name, durationSec: 6 })` appends exactly one clip at the old right-most end, `mediaSource: "template composer"`, selected, one scene per clip, the lane paints it, the queue drains, the timeline grows, and the composer's own source is asserted to check the sink **before** `project.assets.push(asset)` and to keep the `MAX_MP4_UPLOADS` cap inside `if (!sink) {`.
  7. *`a composed clip never steals a pending placeholder and the next one lands after it`*: with a placeholder forced into scene 1, two hand-offs go 12 → 14 items at 60 and 65 s, the pending count is unchanged, the last clip is selected; a hand-off with no bytes and an empty queue both add nothing and say so.
- `tests/quick-batch-table.test.mjs` **14 / 14**, `tests/final-media-cap-actions.test.mjs` **11 / 11**, `tests/public-entry-points.test.mjs` **9 / 9**, `tests/render-hang-regressions.test.mjs` **5 / 5**, `tests/script-pipeline-hang.test.mjs` **19 / 19**, `tests/session-244.test.mjs` **8 / 2** (its two pre-existing failures). New or re-targeted assertions there: no `"Preview Here"` / `"Export Video"` / `.batch-pending` anywhere in the sources; a drafted row draws exactly `["preview", "export", "edit"]`, all `disabled` + `aria-disabled="true"`, with no two-letter word in the cell; a finished row (new `finishRow()` fixture: MP3, `animated`, 12 images with 4 MP4s and 12 distinct filenames, 12 slides carrying `_partialSec`, and `row.audio.duration`) unlocks all three and still prints no words; the row's four action buttons are `["remove", "preview", "export", "edit"]`; a failing/aborted row keeps every icon locked; and the render-queue test drains the boot-created `Video 1` before adding its own two.
- **Whole suite, per file, against a pristine tree**: `node --import tsx --test` over all 45 `tests/*.test.mjs` on this branch → **544 tests, 504 pass, 40 fail**; the same command on a pristine `git archive HEAD` (`4967ef7`) checkout → **544 / 504 / 40**, with **no per-file difference at all**. The 40 failures are the eight pre-existing Worker/relay/image-batch files already recorded in §8.6, §20.15 and §21.11: `api-relay` 10, `seo-walkthrough` 9, `session-250-batch-pipeline` 5, `session-262-load-balancing` 5, `session-261-browser-offload` 4, `deep-debug-regressions` 4, `session-244` 2, `llm-openrouter` 1. Three files *did* regress mid-section and were fixed before this comparison — `render-hang-regressions` (the boot accordion shifted `__VIDEO_PROJECTS` indices and added a "skipped" to the bulk status), `script-pipeline-hang` and `session-244` (both still expected the old two-button / no-icon Actions cell). All three were test-contract updates, not source bugs.
- `npx tsc --noEmit` → **30 errors, byte-identical count to the pristine tree**, every one a pre-existing `src/index.ts` diagnostic; none in a file this section touched.
- `npx wrangler deploy --dry-run` → exit `0`, `Total Upload: 3049.16 KiB / gzip: 1375.84 KiB`.
- Bundle parse check (throwaway `vm.Script` over `APP_JS`, `TIMELINE_EDITOR_JS`, `TEMPLATE_COMPOSER_JS`, deleted after use): all three parse. This matters more than usual here — these files are TS template literals, so a literal backtick has to be written `` \` `` and a literal `"` inside a **double-quoted** JS string must not be written `\"`; both mistakes compile fine under `tsc` and only surface as a browser-side `Unexpected token`.
- Grep-level audit of the served strings: `Selected element`, `#timeline-clips-modal`, `.te-clips-`, `.batch-pending`, `"Preview Here"` and `"Export Video"` (as Actions copy) appear nowhere in `src/client/`. The remaining hits for `VIDEO WORKSPACE` / `🎬 YouTube Vibe Studio` / `Generates AI scenes` / `Type or paste a script` are the comments that record these removals, plus the surfaces item 4 did not name: `<title>`, the meta description, the landing brand and footer, and the sign-in modal's `🎬 YouTube Vibe Studio` title. `⬇ Export Video` also survives **inside the ▶ Preview modal** (app-js.ts:12263) — a different surface from the table's Actions column.

### 22.15 Notes, gotchas and deliberate decisions

- **"Not yet ready for generation" is implemented as `batchRowFinished(row)`.** That is the same single flag which already gated Preview/Export, so all three icons still unlock together, at one moment. The consequence worth naming: **`✎ Edit` is now locked until the row is generated**, which supersedes the earlier "Edit is always live" behaviour (see 22.16 and 22.17). The alternative reading — "ready" as `row.stage === "ready"`, i.e. *has a script* — would have made Preview and Export clickable on a row with no MP3 and no animation, so it was rejected.
- **"No text" means no words, not no glyphs.** The cell's only content is `▶`, `⚙` and `✎` inside the three buttons; the tests assert `/[A-Za-z]{2,}/` finds nothing rather than asserting an empty `textContent`, which the icons would fail.
- **The boot accordion lives in the non-timeline branch only.** `timelineEditorRouteRequested()` → `applyTransitionProject()` and nothing else, so the timeline page still creates no `Video N` (`__VIDEO_PROJECTS.length === 0` is asserted there). For a `layout=table` boot the accordion *is* created and hidden, so it is already there when the user switches to the editor layout; the price is an empty `Video 1` in `persistPipelineManagementState("startup")` and one extra "skipped" in a bulk render of an otherwise empty studio.
- **`＋ Add Video` unpressed was a CSS problem, not a state problem.** No code path added `active`/`pressed` to `#bulk-toggle`; `#studio-app .heading-actions .bulk-toggle` simply carried the pressed shadow and translate permanently. `ensureEditorAccordionOnLoad()` still strips those classes and forces `aria-expanded`/`aria-pressed` to `"false"`, because a restored state could have left them behind.
- **The sink is registered inside `bindEvents()`, never at module top.** Everything above the `routeRequested()` guard in `TIMELINE_EDITOR_JS` runs on *every* layout; a top-level `window.__TIMELINE_TEMPLATE_CLIP__` would have made the editor layout's composer hand its MP4s to a timeline that is not on screen. `timelineClipSink()` tolerates the sink being absent, which is what keeps the editor layout's gallery path byte-for-byte unchanged.
- **The composer keeps its modal open after a hand-off.** One `＋ Add Clips` click can compose several clips in a row, each appended after the previous one; closing after the first would have made the button a one-shot.
- **`openTemplateModalForTimeline()` may create a `Video N` as a side effect.** `openTemplateModal(n)` needs a project to attach the composed asset to, and on the timeline page that project is only a container — its gallery is never shown. It uses the **last** project, so a studio that already has videos does not grow.
- **Item 9 treats the Scene Media lane as picture space and audio lanes as not.** The request named "the text/graphics or media scene tracks"; a voiceover or soundtrack under a new caption is normal and was left alone. The seeded `dummy-text-1` counts as occupied (it is a real, editable clip), subtitle cues do not (they are not in `state.tracks`).
- **Appending grows the project, deliberately.** On a wall-to-wall Quick Batch timeline every second from 0–60 s is taken, so the first `＋ Text` lands at 60 s and `ensureTimelineEnd()` takes the project to 65 s; the next lands at 64 s, and so on. Trimming an existing clip to fit a new one was not an option — the request was to avoid the overlap, not to move somebody else's clip. This is also why the dock-box tolerance in the undo/redo test moved from 0.001 px to 0.5 px: the longer project makes pixels-per-second fractional, and `left`/`width` are each rounded with `toFixed(1)`.
- **The playhead follows the element it just added.** `canvasHitTest()` only picks an item while the playhead is inside `[startSec, startSec + durationSec)`, so without the parking step a new element appended at 60 s would be undraggable on the canvas until the user moved the playhead by hand.
- **Children keep their parent's window.** `freeVisualWindow()` is used only when `parentItem` is absent; a `＋ Child text` on a background clip still takes `childWindow(parent)`, exactly as §20 defined it.
- **Square buttons needed `!important`.** Every competing radius in this app sits in an id-scoped rule (`#studio-app …`, `#tpl-modal …`), which out-specificities `html[data-theme="neo"] …` no matter how long the selector list gets. The neo radius *tokens* (`--t-radius: 3px`, `--t-radius-sm: 2px`) were left alone on purpose: the request named buttons and button-like designs, not panels, cards, inputs or modals.
- **`hidden` needed a CSS partner.** `#studio-app .heading { display: flex }` beats the `hidden` attribute's UA `display: none`, so `#studio-app .heading[hidden] { display: none }` was added and `#studio-app.timeline-mode .heading` joined the existing `!important` group; without them the heading would still have occupied its row on the table and timeline pages.

### 22.16 Superseded copy in this file

Older sections are kept exactly as they were written. These are the lines that no longer describe the code:

- **§2.4 / §"Current code and system" item 12** — "Quick Batch has one `Actions` column: Preview, Process Export, Edit" is still the list, but the *unfinished-row* rendering it implied (the `Preview Here · Export Video` placeholder sentence, `.batch-pending`) is gone: all three icons are drawn for every row and locked until the row is finished (22.11). "Edit … calls `openBatchEditPage()`" is still true, but Edit is no longer reachable on a drafted row.
- **§20.6 and §21.5** — `Selected element` as the runtime label for a non-scene selection: it is now `Selected Element`, with `Selected Element controls` on the panel (22.5). §19's `Selected Scene` remains the media-case label and the baked-markup default.
- **§21.3 and §21.12** — the placement of `＋ Add media` / `＋ Add Clips` **inside the 156 px label cell** with `.te-group-background { flex-wrap: wrap }` and `.te-group-background .te-add-inline { margin-left: 5px }`, and the two notes defending it ("The buttons stay in the 156 px label cell and wrap", "moving them into `.te-group-fill-background` … would have left the background row without a header at all"). The pair now lives in the fill cell on the right of the label, sticky like `＋ Text` / `＋ Graphic`, and the header is still there (22.3).
- **§21.7** — the white top scroll layer *with* the borders it inherited from `.te-grid-corner`: both the strip and its corner cell are `border: 0` now (22.4).
- **§21.8, §21.10, §21.11 (tests 3 and 4) and §21.12** — the whole `#timeline-clips-modal` picker: its markup, the `.te-clips-*` CSS block, `clipsQueue` as a user-visible queue, `renderClipsModal()` / `openClipsModal()` / `closeClipsModal()` / `addClipsFiles()` / `toggleClipQueue()` / `clearClipQueue()` / `clipsLibrary()`, the card grid, the `＋ Upload` input and the commit/clear/close row, plus the notes "The modal re-uses the composer's *look*, not its classes" and "No stock search inside the modal". `＋ Add Clips` opens `#tpl-modal` — the composer's own modal — and the composed MP4 comes back through `window.__TIMELINE_TEMPLATE_CLIP__` (22.9).
- **§21.14** — "A commit while an export is running is not blocked": both `openTemplateClipsModal()` and `appendTemplateClip()` guard `isExporting || recorder`. Also "The queue is not persisted, so an open modal with pending picks loses them on reload": there is no queue UI any more — `clipsQueue` is a one-shot internal buffer drained inside `appendTemplateClip()`. And "`＋ Add Clips` and `＋ Add media` overlap in source": they are now two different surfaces (a composer and a file/IndexedDB picker) rather than two flavours of the same append.
- **`system-rules.md:1023`** (outside this file) quotes the Quick-table helper paragraph that 22.6 removed. That document is not this project's history of record, so it was left untouched and is listed here instead.

### 22.17 Still open

> Re-verified 2026-11-09 (§0.10): every item below is still unfulfilled in the current code; done items were removed and uncertain ones are tagged **DONE**.

- `＋ Add Clips` no longer offers a plain file picker or the row's own already-uploaded media; it is the composer (prompt → scenes → effects → MP4). `＋ Add media`, on the same row, is the file/IndexedDB path. If a "clips you already have" list is wanted inside that modal, it belongs in `TEMPLATE_COMPOSER_JS`, not in the timeline bundle (which still makes no Worker call by design). **DONE (code-verified 2026-11-09; the composer's inner surfaces were not clicked through):** the timeline's `add-clips` action only calls `openTemplateClipsModal()`, so no plain picker remains in the timeline bundle.
- Occupancy is measured in seconds with a 1 ms epsilon (`TIMING_EPSILON_SEC = 0.001`), so sub-millisecond touching is not detected (and is not visible either).
- The neo sweep is a selector list: a future button-like class matching none of its patterns, with its own radius in an id-scoped rule, would need adding to the list (`html[data-theme="neo"] … { border-radius: 0 !important }`).

> Removed 2026-11-09, all three already done:
> - **"`✎ Edit` unlocking with the row is the one judgement call."** — decided and coded: all three Action icons share the `batchRowFinished()` lock (`batchActionCell()`), and Edit is documented as unlocking with the row (§22.11).
> - **"The boot accordion is created for `layout=table` boots as well."** — `ensureEditorAccordionOnLoad()` returns immediately unless `studioLayout === "editor"`, so no empty `Video 1` is persisted from the table layout.
> - **"Item 9 guards adding, not dragging; a drag can still overlap."** — §24.10's `resolveTimelineOverlaps()` runs on timing edits and drags as well as on adds, duplicates, imports and load.

### 22.18 Status

- All nine code items are implemented (22.3–22.12), and item 10 — documenting the prompt — is this section.
- Test state at the time: `tests/timeline-editor.test.mjs` **33 / 33**; the whole suite **544 tests / 504 pass / 40 fail**, with **identical per-file counts** on a pristine `4967ef7` tree; `npx tsc --noEmit` unchanged at 30 pre-existing `src/index.ts` diagnostics; `npx wrangler deploy --dry-run` green.
- **Re-measured 2026-11-09 (§0.10.2):** `timeline-editor` **35/35**, `quick-batch-table` **15/15**, `final-media-cap-actions` **11/11**; 43 completed files total **540 / 502 / 32 / 6 cancelled**; `tsc` still **30**.

## 23. Timeline editor: a clip exported from the Add video from template modal becomes the last Scene Media scene (2026-11-09)

### 23.1 Request & authority order

> Study code (source of the truth) and the md file 331 (source of truth) and then i found a bug in the timeline editor the exported clip from the modal in timeline page must be added to the scene media track at the end of the layer as scene in mp4

Authority order for this section, unchanged from §9.1: the shipped code is the source of truth for what happens, this file is the source of truth for why, and the request above is the change. Nothing here adds a server route, a Worker module, a KV key or a cookie; the timeline stays a browser-only layout.

### 23.2 Code study that drove the change (pre-change audit)

The append machinery built in §21.8 and §22.9 is correct and stays:

| Piece | Where | What it already did |
| --- | --- | --- |
| Sink registration | `src/client/timeline-editor.ts`, inside `bindEvents()` | `window.__TIMELINE_TEMPLATE_CLIP__ = function (clip) { return appendTemplateClip(clip); }` — registered only on `layout=timeline`, so the editor layout is untouched. |
| `appendTemplateClip(clip)` | `src/client/timeline-editor.ts` | Guards `state`, the blob, the timeline's own export, `MAX_MEDIA_FILES` and the missing media lane; registers the asset; queues it; drains the queue. |
| `appendQueuedClips()` | `src/client/timeline-editor.ts` | Computes `nextStart = max(item.startSec + item.durationSec)` over the Scene Media lane, pushes one media item **and one scene** per clip back to back from there, selects the last one, calls `ensureTimelineEnd(nextStart)`, repaints and saves. |
| `timelineClipSink()` / sink branch | `src/client/template-composer-js.ts` | `addTemplateToVideo()` (the **➕ Add to Video N** button) checks the sink before `project.assets.push(asset)` and, when it exists, hands `{ blob, file, name, durationSec }` over and returns. |

The gap was in the other button. The modal's primary control is **⬇ Download MP4**, wired directly to `exportMP4()` (`exportBtn.addEventListener("click", exportMP4)`). `exportMP4()` rendered the MP4, downloaded it, and returned `lastVideo` — it never consulted `timelineClipSink()`. So on the timeline page:

1. rendering a clip and clicking **⬇ Download MP4** downloaded `template_<scene>_portrait.mp4` and added **nothing** to the timeline;
2. the Scene Media lane therefore had no new scene, `state.durationSec` never grew, and the timeline's own **⬇ Export MP4** could not contain the clip;
3. the surviving **Add** button said **➕ Add to Video N** — a numbered accordion that page never renders — while the modal's primary **⬇ Download MP4** control was the one that added nothing, so the wording pointed away from the only path that worked.

A second, smaller gap: `appendQueuedClips()` reported `Queued 1 clip at the right-most end of Scene Media (…)`, which never said that the clip had become a scene of the exported MP4, and it did not refresh the project heading that prints the scene count.

### 23.3 Change 1 — one hand-off helper, used by both buttons (`src/client/template-composer-js.ts`)

Two small functions sit beside `timelineClipSink()`:

- `timelineClipTarget(n)` returns `"Video"` when the timeline sink exists and `"Video " + n` otherwise — the single source of the modal's target name. The timeline page has no `Video N` accordion, so its button is the plain **➕ Add to Video**; the editor layout keeps **➕ Add to Video N** to name the accordion the clip lands in.
- `handClipToTimeline(renderedVideo, clipDuration)` performs the whole hand-off: it returns `0` when there is no sink or no bytes, wraps the blob in a `File` named after the render, and calls the sink with `{ blob, file, name, durationSec }`. Its return value is the sink's "how many clips landed" count, so the modal can report success or refusal. A `try/catch` keeps a throwing sink from breaking the modal.

`exportMP4()` now calls it in its success path, **only when `shouldDownload !== false`**:

```js
let timelineLanded = 0;
if (shouldDownload) {
    timelineLanded = handClipToTimeline(lastVideo);
}
```

That is exactly the "exported clip must be added" contract: the download still happens (the `<a download>` click above is unchanged), and the same render is appended at the right-most end of Scene Media, one scene per clip, so it is the last scene of the timeline MP4. The **➕** button keeps its own hand-off through the same helper inside `addTemplateToVideo()`; because that path renders with `download: false`, the two branches can never append the same render twice. With no sink registered (the editor layout) `handClipToTimeline()` returns `0`, so nothing about the gallery behaviour changes.

### 23.4 Change 2 — the modal says what it will do (`src/client/template-composer-js.ts`)

- Every button label is built from `timelineClipTarget(n)`: **➕ Add to Video** on `layout=timeline`, **➕ Add to Video N** everywhere else; the "✅ Added to …" reset uses the same helper. The destination is explained by the status line and the timeline's own "Scene Media" lane label, not by renaming the button.
- After a successful download hand-off the status line reads `MP4 ready — downloaded as <file> and added at the end of the Scene Media layer`; if the timeline refuses (its own export is running, the media lane is missing, the 100-clip cap), it reads `… but the timeline could not take the clip` instead of silently succeeding.
- On the timeline page `buildModal()` rewrites `#tpl-sub` so the paragraph describes Scene Media and the timeline MP4 instead of the `Video N` gallery. The editor layout keeps the original paragraph byte for byte.

### 23.5 Change 3 — the timeline reports the new last scene (`src/client/timeline-editor.ts`)

- `appendQueuedClips()` calls `updateProjectHeading()` after the append, so the heading's scene count and the `state.scenes` list agree immediately.
- The dock status is now `Added n clip(s) at the right-most end of Scene Media (from m:ss to m:ss) — it is the last scene of the exported MP4.` The append itself still runs `ensureTimelineEnd(nextStart)`, which grows `state.durationSec` (rounded up to the 5 s grid) so the timeline's own export covers the new scene.

### 23.6 Files touched in this section

| File | Change |
| --- | --- |
| `src/client/template-composer-js.ts` | `timelineClipTarget()` + `handClipToTimeline()`; the `shouldDownload` hand-off in `exportMP4()`; `addTemplateToVideo()` re-uses the helper; Scene Media button labels, status sentences and the timeline `#tpl-sub` copy. |
| `src/client/timeline-editor.ts` | Append status names the new last scene of the exported MP4; `updateProjectHeading()` after an append; the ＋ Add Clips hint mentions both modal buttons. The sink, queue and append geometry are unchanged. |
| `src/client/markup.ts` | The timeline page's comment block records that both composer buttons land in Scene Media. |
| `tests/timeline-editor.test.mjs` | Test 32's source assertion follows the helper (`handClipToTimeline(renderedVideo, clipDuration)`, `durationSec: seconds`, the `shouldDownload` hand-off). New test 34 proves a composed clip is the last Scene Media **scene** and that the timeline MP4 export renders its window. |
| `tests/template-composer.test.mjs` | New test 20 proves **⬇ Download MP4** both downloads and lands the clip, the **➕** button only lands it, the hidden gallery stays empty, and the editor layout keeps `Add to Video N`. |
| `bug-fix-session-331.md` | This section. |

### 23.7 Verification

- `node --import tsx --test tests/timeline-editor.test.mjs` → **34 / 34 pass** (33 before, +1 new).
- `node --import tsx --test tests/template-composer.test.mjs` → **20 / 20 pass** (19 before, +1 new).
- `node --import tsx --test tests/final-media-cap-actions.test.mjs tests/quick-batch-table.test.mjs tests/public-entry-points.test.mjs` → **34 / 34 pass**.
- `npx tsc --noEmit` → the same **30** pre-existing `src/index.ts` diagnostics as §22.18, none in a file this section touched.
- Served-bundle parse check: `createHTML()`'s `<script>` body (~1.98 MB after `APP_JS` + `TEMPLATE_COMPOSER_JS` + `TIMELINE_EDITOR_JS`) is accepted by `new Function(...)`, so the new template-literal escaping survives page assembly. The composer's `\u2014`/`\u2795` escapes were kept at the same two-backslash depth as the surrounding lines, which resolves to one backslash in the served JavaScript and therefore to the intended glyphs.

New coverage in detail:

1. *timeline editor test 34 — a composed clip is the last Scene Media scene and the timeline MP4 export renders it*: a 5 s project receives `window.__TIMELINE_TEMPLATE_CLIP__({ blob, name: "closing-card.mp4", durationSec: 1 })`; the clip starts at the old right-most end (5 s), the project grows to 10 s on the 5 s grid, the matching `state.scenes` entry is last and carries the clip's scene id/asset id/name, `exportTimeline()` encodes **300** frames (10 s × 30 fps, i.e. the appended scene's whole window), and frames inside that window draw the composed clip's `<video>` rather than a placeholder.
2. *template composer test 20 — on the timeline page Download MP4 also appends the clip to the end of Scene Media*: with the sink registered, `#tpl-add` reads exactly **➕ Add to Video**, `exportMP4({ download: true })` renders 30 frames, downloads once **and** calls the sink once with the clip's own length and a `Blob`; the status names Scene Media as the destination; **➕** appends a second clip without a second download and without filling `videoProjects[0].assets`; deleting the sink and re-opening the modal restores **➕ Add to Video 1** and the gallery push.

### 23.8 Notes, gotchas and deliberate decisions

- **Download and Add both land the clip, on purpose.** The request named the *exported* clip, and on the timeline page the export button is the modal's primary control. Keeping Download download-only would have left the reported bug in place; the append is idempotent per render, so a user who exports three clips gets three scenes, which is the same rule the ➕ button already followed.
- **No double append is possible.** `exportMP4()` only hands over when `shouldDownload !== false`; `addTemplateToVideo()` renders with `download: false` and hands over itself. One render, one scene.
- **The sink stays registered inside `bindEvents()`.** §22.15's reason is unchanged: a top-level registration would let the editor layout's composer hand its MP4s to a timeline that is not on screen.
- **The editor layout is byte-for-byte unchanged where it matters.** With no sink: same labels, same `MAX_MP4_UPLOADS` cap, same `project.assets.push(asset)`, same `buildVaCard()`/`updateVideoStatus()`, same download. Test 20's last third asserts it.
- **The appended clip is a scene, not a second overlay.** It goes into the one pinned `background-media` lane (`layer: 0`) as one `tracks` item plus one `state.scenes` entry with `mediaSource: "template composer"`; `syncScenesFromTracks()` then keeps `mediaAssetId`, timing and label in step on every save.
- **The timeline MP4 renders it because the project grew.** `ensureTimelineEnd(nextStart)` rounds up to the 5 s grid, and `exportTimelineMp4()` derives its frame count from `state.durationSec`; test 34 pins both halves (duration 10 s, 300 encoded frames, real `drawImage` of the composed video).
- **§22.9 is partly superseded.** Its "only the ＋ Add button hands the clip over" description is no longer the whole contract: the **⬇ Download MP4** path now lands the clip too. The rest of §22.9 (the sink, `appendTemplateClip()`, append-at-the-right-most-end, one scene per clip) still stands exactly as written.

### 23.9 Status

- The reported bug is fixed: a clip exported from the Add video from template modal on `layout=timeline` is appended at the right-most end of the Scene Media layer as a new scene, and the timeline's Export MP4 renders it in order at the end. The ➕ path keeps the same destination with clearer copy.
- Test state for the touched suites: timeline **34 / 34**, template composer **20 / 20**, related Quick Batch/media/entry suites **34 / 34**; `npx tsc --noEmit` at the 30 pre-existing diagnostics.

## 24. Server-side API rotation, round robin with a smaller share for the UI Worker, five backup URLs, completed Quick-Batch rows that survive a refresh (five per page, deleted after 24 h), and a timeline that resolves overlapping boxes on every add (2026-11-09)

### 24.1 Request & authority order

The request, in the user's words:

1. "Check the admin page; make the rotation of all backup API URL happen on the server. The pipeline API URL must be rotated in the CF server that serves the UI; the client browser JS must ask for the URL of a specific pipeline API and wait, then call that given URL."
2. "In the admin page the default rotation scheme must be round robin, but less API work must be given to the UI CF server."
3. "No more drawdown for rotation scheme."
4. "Allow up to 5 text inputs of CF backup server in the admin" (was 3).
5. "When the page is refreshed for the editor and Quick Batch table layouts, the rows with a successful export or render must still remain in the page, paginated at 5 items per page, and every 24 hrs the client browser JS must delete them."
6. "Any overlapping boxes in the track layers must be moved in the timeline so no overlapping boxes remain, and the overlap-adjusting JS must trigger when an element or scene is added to the timeline."
7. "Document all of this in `bug-fix-session-331.md`."

Authority order, unchanged from §21–§23: **the code is the first source of truth, this file the second**. Every change below was written after reading the exact function it touches; no behaviour was inferred from a comment alone.

### 24.2 Code study that drove the changes (pre-change audit)

| Area | What the code actually did before this section |
| --- | --- |
| `src/client/api-rotation.ts` | Wrapped `window.fetch`; fetched `GET /api/relay/pool` (pool + signed ticket), then chose the endpoint **in the browser**: local cursor, per-endpoint 30 s skip list, round-robin over local + verified backups, own failover loop. That is exactly the decision the request moves to the server. |
| `src/modules/api-relay.ts` | `resolveRelayPool()` read `config:workers`; `orderRelayCandidates()` implemented three strategies (`round-robin`, `least-pending`, `weighted`) with a module-level cursor and a health/circuit store; `/api/relay/pool` advertised verified endpoints + a ticket; `/api/relay/config` stored the policy; `RELAY_AI_PATHS` covered only `/api/script`, `/api/seo-plan`, `/api/voiceover`, `/tts`. |
| `src/index.ts` | `POST /api/config/workers` trimmed the list with `.slice(0, 3)`; the route table comment said "up to 3 worker URLs". |
| `src/client/config-page-js.ts` | Three worker inputs `#cfg-worker-url-1..3`; the relay card carried `#cfg-relay-client` ("rotate whole AI requests in the browser") and a three-option `#cfg-relay-strategy` dropdown; the save handler posted `strategy` and `clientRotation`. |
| `src/client/app-js.ts` | Quick-batch rows lived in `batchRows` and were mirrored by `pipelineManagementStore` (script/title/style only). `renderBatchTable()` drew **every** row; nothing paginated. `setBatchStage(row, "done", …)` marked a successful render/export, but on reload the stored row came back as `ready` and no completion time existed. |
| `src/client/timeline-editor.ts` | `clampClipBox()` shortened the *drawn* box when two clips shared seconds; the **model** kept the overlap. `itemTimingChanged()` rippled only forward, and a moved/duplicated/imported clip could sit on top of its neighbour. Adds (`addMediaFiles`, `appendQueuedClips`, `addVisualElement`, `addAudioFile`, `duplicateSelectedItem`) each wrote `startSec` without a lane-wide check. |

`grep -rn "drawdown"` over the whole repository returns **nothing**: "no more drawdown" was not an existing feature name. §24.5 records how it was resolved.

### 24.3 Change 1 — the rotation is decided on the server (`src/modules/api-relay.ts`, `src/index.ts`)

A new route, `GET /api/relay/endpoint?path=/api/script` (`RELAY_ENDPOINT_PATH`), is the only way the studio now learns where a pipeline call goes:

- It validates the path against `RELAY_AI_PATHS` (400 for anything else, so `/api/config/*`, `/api/payments/*`, `/api/session`, CMS and account routes can never be handed out).
- It reads `config:relay` + `config:workers`, and calls **`pickRelayEndpoint(pool, config)`** — the same `orderRelayCandidates()` the Worker uses for its own model calls. The browser never sees the candidate list, the cursor, the health state or a cooldown.
- A backup pick mints the same short-lived `client` ticket `/api/relay/pool` already issued (identity or guest; 3-minute TTL; scoped to `RELAY_AI_PATHS`). A pick of this Worker answers with the relative path and **no** ticket.
- An anonymous visitor whose slot is a backup is answered by the UI Worker (`local: true, reason: "no client ticket"`), so rotation can never turn a working request into a 401.
- `&failed=<endpoint id>` (sent with the ticket from the previous answer) reports that the given URL did not answer. `readRelayTicket()` proves the reporter was really handed that URL, then `noteRelayFailure()` opens the circuit breaker — the server, not the browser, decides what happens next.
- `isRelayPath()` includes the new route, so preflights, CORS and the "unknown `/api/relay/*` falls through" behaviour are unchanged.

`POST /api/relay/ai` (worker→worker compute) and `/api/relay/pool` (diagnostics) are untouched in shape; `/api/relay/pool` is simply no longer used by the studio.

### 24.4 Change 2 — round robin only, and the UI Worker gets the smaller share (`src/modules/api-relay.ts`)

- `RelayStrategy` is now the single literal `"round-robin"`; `normalizeRelayConfig()` drops any stored `least-pending` / `weighted` value, and the `least-pending` / `weighted` branches are gone from `orderRelayCandidates()`. A policy saved by an older build keeps its other fields and silently becomes round robin.
- The ring (`relayRing()`) enters the **local** (UI) Worker `config.localWeight` times (default **1**) and every backup **`RELAY_BACKUP_RING_WEIGHT = 3`** times. One shared cursor walks the ring, so the share is exact and fixed: with one backup the UI Worker answers 1 request in 4 (25 %), with five backups 1 in 16 (≈ 6 %). `localWeight: 0` keeps this Worker out of the ring entirely while still leaving it as the last resort when every backup is cooling.
- Cooling members still move to the end instead of disappearing, so a pool whose backups are all broken still answers.

### 24.5 Change 3 — "no more drawdown for rotation scheme"

The term does not exist in the repository (no `drawdown` anywhere in `src/` or `tests/`), so it is resolved with the reading that matches change 1: **the browser no longer draws/consumes anything from the pool.** Before this section `api-rotation.ts` kept its own cursor, its own 30 s skip list and its own failover order — it *drew down* the endpoint list by itself. That state (`state.cursor`, `state.failUntil`, `state.endpoints`, `orderEndpoints()`, `refreshPool()`, `usable()`) is deleted; the only bookkeeping left in the browser is the counters exposed on `window.__yvsApiRotation.stats()` for diagnostics. If "drawdown" was meant as something else (a billing/credit drawdown, or a visual "drawdown" of the timeline), say so and this section is amended — the code change above is the only interpretation the repository supports.

### 24.6 Change 4 — five backup Worker URLs (`src/client/config-page-js.ts`, `src/modules/api-relay.ts`, `src/index.ts`)

- `MAX_RELAY_WORKERS = 5` is exported and used by `resolveRelayPool()`; the cap is applied **after** junk/duplicate filtering (capping the raw list would let five bad entries hide a good sixth — test 1 in `tests/api-relay.test.mjs` guards exactly that).
- `POST /api/config/workers` stores `.slice(0, 5)`; the route table comment in `src/index.ts` says "up to 5 worker URLs".
- The admin card renders `#cfg-worker-url-1..5`, `renderWorkersList()` fills five inputs, and the save handler collects five. Copy reads "Up to 5 extra deployments of this same app".

### 24.7 Change 5 — the browser asks, waits, then calls the given URL (`src/client/api-rotation.ts`)

`API_ROTATION_JS` is rewritten around one rule: *ask, wait, call exactly that*.

1. For an allow-listed AI path the wrapper calls `GET /api/relay/endpoint?path=…` on this origin (`credentials: "same-origin"`, `cache: "no-store"`, 8 s abort guard) and **waits** for the answer.
2. `local: true` → the original, unmodified same-origin request through `nativeFetch` (cookies, streaming, downloads all unchanged). A backup → `fetch(<given.url> + <original query>)` with the answer's `x-yvs-relay-ticket`, `credentials: "omit"`, `mode: "cors"`.
3. If the given URL does not answer (network error, 502/503/504) the wrapper asks **once more** with `&failed=<endpointId>` and calls the new answer; after that it falls back to this origin. A streamed body is never replayed.
4. Non-AI paths, `/api/relay/*` and cross-origin URLs are passed straight through with no ask.
5. `AI_PATHS` now matches `RELAY_AI_PATHS`: the four text/voice paths **plus** `/api/image`, `/api/image-batch`, `/api/image-prompts` and `/image/gen`. The list had drifted: the old header claimed the image routes rotated while the array left them out, so image work never left the UI Worker. `RELAY_AI_PATHS` gained those four paths in the same commit, which is also what made the pre-existing ticket/preflight tests (§24.12) pass.

### 24.8 Change 6 — the admin page (`src/client/config-page-js.ts`)

- `#cfg-relay-client` (browser rotation) and `#cfg-relay-strategy` (scheme dropdown) are **gone**. A new `#cfg-relay-scheme` line states "Round robin — the only scheme; the server picks, the studio never rotates by itself".
- `#cfg-relay-weight` is relabelled "This Worker's ring weight" with a hint giving the real arithmetic (1 in 4 with one backup, 1 in 16 with five, 0 keeps pipeline calls off this Worker).
- `loadRelayConfig()` no longer writes a scheme or a client switch; the save handler posts `enabled`, `localWeight`, `maxAttempts`, `timeoutMs` only.
- The card copy explains `GET /api/relay/endpoint` and says the decision is made on this Worker.

### 24.9 Change 7 — completed Quick-Batch rows survive a refresh, five per page, deleted after 24 h (`src/client/app-js.ts`, `src/client/markup.ts`)

- New client-only archive `ytvs.quick-batch-completed.v1` in `localStorage`: id, vid, title, topic, script, style, minutes, resolution, orientation, quality, kind (`render` | `export`), detail, slide count and `completedAt`. Media blobs are **not** stored — they only ever lived in browser memory.
- `recordCompletedBatchRow(row, kind)` runs on a successful render (`setBatchStage(row, "done", …)` after the animation step) and on a successful export (`exportBatchRow()` after the MP4 download). Re-recording refreshes the timestamp in place.
- `restoreCompletedBatchRows()` runs at boot for the table/editor shell: it re-reads the archive, writes back the pruned list, and re-creates each row as a completed row (`stage: "done"`, detail `Rendered|Exported <date> · kept 24 h`, `_archived: true`). A row the pipeline store already restored is marked completed instead of duplicated.
- Pagination: `BATCH_PAGE_SIZE = 5`; `renderBatchTable()` draws only `visibleBatchRows()`, the printed row number stays global (row 6 shows `06` on page 2), `batchTableSignature()` includes the page, and a new pager `#batch-pager` (`#batch-page-prev`, `#batch-page-label`, `#batch-page-next`) appears as soon as there is a second page. Adding a row opens that row's page; removing a row clamps the page.
- 24 h deletion: `readCompletedBatchRows()` never returns an entry older than `BATCH_COMPLETED_TTL_MS` (24 h), `purgeCompletedBatchRows()` runs at boot and hourly (`BATCH_PURGE_INTERVAL_MS`), and it also removes the restored row itself when its archive entry expired. `removeBatchRow()` deletes the archive entry immediately when the user removes a row by hand.
- A restored completed row is a **record**, not a re-renderable row: Preview/Export stay locked because the media bytes are gone. The row, its script and its completion status stay on the page for 24 h, which is exactly what the request asked for.

### 24.10 Change 8 — no overlapping boxes in a timeline lane (`src/client/timeline-editor.ts`)

- `resolveTrackOverlaps(track)` sorts a lane by `startSec` and walks it left to right: a clip that starts before the previous one ends is **moved** to that end (its length is kept; a lane that would run past `MAX_DURATION_SEC` is trimmed instead). A child text/graphic (with `parentId`) may only move inside its background clip's window, and is shortened to the rest of that window rather than pushed outside the clip.
- `resolveTimelineOverlaps()` runs the resolver on **every** lane, moves the children of a background clip that moved by the same delta, re-reads the scene list (`syncScenesFromTracks()`), grows the timeline end and clamps the playhead.
- It is triggered by **every** addition — `addMediaFiles()`, `appendQueuedClips()` (the composer hand-off), `addVisualElement()` (＋ Text / ＋ Graphic and ＋ Child …), `addAudioFile()`, `duplicateSelectedItem()` — and also by `itemTimingChanged()` (drag/resize/inspector), `applyHistorySnapshot()` (undo/redo) and `boot()` (a project saved before this rule is cleaned on load).
- `clampClipBox()` stays as the drawing guard it always was; after this pass it has nothing to hide.

### 24.11 Files touched in this section

| File | Change |
| --- | --- |
| `src/modules/api-relay.ts` | `RELAY_ENDPOINT_PATH`, `MAX_RELAY_WORKERS`, `RELAY_BACKUP_RING_WEIGHT`; round-robin-only normalisation; `relayRing()` / rewritten `orderRelayCandidates()` / `pickRelayEndpoint()`; `mintRelayClientTicket()`; the `/api/relay/endpoint` route (pick, ticket, `&failed=` report); image paths added to `RELAY_AI_PATHS`; five-worker pool cap. |
| `src/client/api-rotation.ts` | Full rewrite: ask → wait → call the given URL; one recovery report; no cursor, no skip list, no endpoint list, no client-side failover order. |
| `src/client/config-page-js.ts` | Five worker inputs; scheme + browser-rotation controls removed; ring-weight copy; save payload trimmed; relay card copy explains server-side picking. |
| `src/index.ts` | `/api/config/workers` cap 3 → 5; route comment lists `GET /api/relay/endpoint`. |
| `src/client/app-js.ts` | Completed-row archive, restore, hourly purge, five-per-page pagination, pager binding, record-on-render/export, forget-on-remove, boot wiring. |
| `src/client/markup.ts` | `#batch-pager` markup (hidden until there is a second page). |
| `src/client/timeline-editor.ts` | `resolveTrackOverlaps()` / `resolveTimelineOverlaps()` and their call sites (five adds, timing edits, undo/redo, boot). |
| `tests/api-relay.test.mjs` | Strategy test rewritten as the weighted-ring test; policy-save, admin-page and browser-runtime tests follow the new contract; new tests for `/api/relay/endpoint` and the five-worker cap. |
| `tests/quick-batch-table.test.mjs` | New test: archive → restore → five per page → 24 h deletion. |
| `tests/timeline-editor.test.mjs` | Two assertions follow the overlap rule; new test proves the resolver runs on every add. |
| `bug-fix-session-331.md` | This section. |

### 24.12 Verification

- `node --import tsx --test tests/api-relay.test.mjs` → **31 pass / 5 fail**. The five failures (`binary model results survive the relay as bytes`, `the compute endpoint returns raw bytes…`, `a model failure at the endpoint is reported…`, `the studio can rotate /api/image…`, `worker A relays a real /api/image model call…`) are the same pre-existing failures this suite had before this section (24 pass / 10 fail at `4c0b2b1`); they are Pixabay-key/binary-relay cases unrelated to the hand-out. **Five previously failing tests now pass** (`a client ticket authorizes only the AI paths`, `only AI paths answer a preflight…`, `the Worker serves /api/relay/ping…`, `the studio can rotate /api/image…`'s siblings and `a rotated GET keeps its query string` was rewritten and passes) because `RELAY_AI_PATHS` now includes the image routes.
- `node --import tsx --test tests/quick-batch-table.test.mjs` → **15 / 15** (14 before, +1 new).
- `node --import tsx --test tests/timeline-editor.test.mjs` → **35 / 35** (34 before, +1 new).
- `node --import tsx --test tests/template-composer.test.mjs` → **20 / 20**.
- Per-file suite sweep after the change: `pixabay-media` 58, `script-pipeline-hang` 19, `pixabay-studio-flow` 18, `progressive-image-pipeline` 18, `script-seo` 17, `final-media-cap-actions` + `session-248` 17, `script-note-client-only` 12, `script-retry-owner` 12, `pixabay-direct-browser` 12, `script-hang-audit` 10, `pixabay-direct-routes` 10, `public-entry-points` 9, `script-image-deep-debug` 9, `script-slow-pipeline` 9, `retry-offload-worker` 9, `session-263` 9, `account-rows` 6, `script-note-memory` 6, `pixabay-auto-retry` 6, `render-app-tts` 5, `render-hang-regressions` 5, `script-writing-client-retries` 5, `editor-subtitles-parity` 7, `browser-local-render` 3, `studio-ui-session-243` 3, `both-layout-media-hang` 1 — all pass.
- Unchanged pre-existing failures elsewhere: `seo-walkthrough` 10, `session-262` 5, `session-261` 4, `session-250` 4, `deep-debug-regressions` 4, `session-244` 2, `llm-openrouter` 1 (image model disabled / Pixabay key) — the same files §22.18 and §23.7 already recorded as failing at the baseline.
- `npx tsc --noEmit` → the same **30** pre-existing `src/index.ts` diagnostics; nothing in a file this section touched.

New coverage in detail:

1. *api-relay — `GET /api/relay/endpoint` hands out the server's round-robin URL for one AI path*: four asks with one backup return the UI Worker exactly once and `https://backup.test/api/script` three times; the backup answer carries a signed `client` ticket naming the user and the full `RELAY_AI_PATHS`; a non-AI path is refused with 400; `POST` is 405; an anonymous caller is answered by the UI Worker (`local: true`, no ticket, `reason: "no client ticket"`) on all three backup slots.
2. *api-relay — the admin page accepts five backup Worker URLs and the pool keeps all five*: six posted URLs store five, and `resolveRelayPool()` returns this Worker + five backups.
3. *quick-batch-table — a finished row survives a reload, five rows per page, and the browser deletes it after 24 hours*: seven rows recorded as renders/exports land in the archive with timestamps; clearing the table and re-running the boot restore brings seven `done` rows back with `kept 24 h` detail; page 1 shows five rows and page 2 the remaining two (the pager appears, the label flips, Prev returns); rewriting the timestamps past 24 h makes `readCompletedBatchRows()` return nothing and `purgeCompletedBatchRows()` delete both the rows and the archive.
4. *timeline-editor — overlapping boxes are moved clear, and every element or scene addition re-runs the pass*: a clip dragged onto the clip before it is moved back to that clip's end; a composed clip added through `window.__TIMELINE_TEMPLATE_CLIP__`, five text elements (which hit the four-lane cap), and a duplicate each leave every lane with no two boxes over the same second.

### 24.13 Notes, gotchas and deliberate decisions

- **The browser can still recover from a dead URL, but it cannot rotate.** The single re-ask with `&failed=` exists so a paused/failed backup costs one retried request instead of a broken studio; the *choice* of the next URL is still the server's. That is why the wrapper never retries the same URL and never falls back to a second backup on its own.
- **Image routes now rotate.** `RELAY_AI_PATHS` gained `/api/image`, `/api/image-batch`, `/api/image-prompts`, `/image/gen`. Those are billed AI calls (the whole point of the pool) and they remain out of reach of the settings/payment/account routes. This also removed the pre-existing drift where `api-rotation.ts`'s header claimed image rotation while its array excluded it.
- **Tickets are still the only cross-origin credential.** A backup has no cookie for this origin; the ticket is scoped to `RELAY_AI_PATHS`, expires in three minutes, and `applyRelayCors()` still refuses to add CORS headers to any other path. The `&failed=` report is ignored unless it carries a ticket this Worker signed.
- **A restored completed row is a record.** The MP4 and the 12 slides are browser-memory objects; persisting them would mean writing tens of MB into `localStorage`. The row, its script, its style and its completion time survive; Preview/Export stay locked. This is stated in the row's detail text so the lock is never a mystery.
- **The archive is separate from the pipeline store on purpose.** `pipelineManagementStore` mirrors the *editable* table (script/title/style, 8 rows, no TTL); the archive mirrors *finished* rows (40 entries, 24 h). A row can be in both: restore then marks the pipeline row completed instead of adding a duplicate.
- **A child clip is pinned to its background clip.** The overlap resolver moves children inside their parent's window and shortens them to the rest of that window; pushing them outside would break the §21 rule that a child lives inside its background clip. A child with no room left in the window keeps its place and the drawing guard truncates it — the only deliberate exception to "no overlapping boxes".
- **The overlap resolver can lengthen a timeline.** Pushing the later clip right is the only way to keep both clips' lengths; `ensureTimelineEnd()` then grows `state.durationSec` on the 5 s grid. Two existing timeline assertions encoded the old overlapping geometry and were updated (scene 2 now starts at 10 s, not 8 s; the ruler-seek fixture seeks before moving a clip).
- **`/api/relay/pool` survives as a diagnostic.** It still lists verified endpoints and mints a ticket; the studio simply does not call it any more. Nothing in the browser depends on it.
- **`clientRotation` survives as a stored field.** Old `config:relay` documents still parse; the flag no longer switches anything off, and the admin page no longer offers it.

### 24.14 Superseded copy in this file

- §22.12 / §22.13's "a new ＋ Text / ＋ Graphic never shares a timed window" describes only the *placement* heuristic (`freeVisualWindow()`). It is now backed by a real model-level pass (§24.10) that also covers drags, duplicates, imports, audio and undo/redo.
- §23's "up to 3" wording for backup Workers (and `src/index.ts`'s route comment) is superseded by §24.6.
- The api-relay module header's "optionally the studio itself rotates the whole AI request" paragraph and §24.7's browser rotation are superseded by the server-side hand-out in §24.3.

### 24.15 Still open

> Re-verified 2026-11-09 (§0.10): every item below is still unfulfilled in the current code; done items were removed and uncertain ones are tagged **DONE**.

- **Re-measured 2026-11-09 (per-file, `-P 6`, 240 s cap):** `seo-walkthrough` 10, `session-250` **5** (previously 4), `session-261` 4 (+6 cancelled), `session-262` 5, `session-244` 2, `llm-openrouter` 1 and `api-relay`'s five binary/Pixabay cases fail exactly as they do at baseline (clean tree, commit `407ab86`); none is caused by this section and each needs its own investigation (mostly "AI image generation is disabled; use Pixabay" / missing `PIXABAY_KEY` in the fixtures). `deep-debug-regressions` still shows failures but did not finish inside 700 s, so its exact count was not re-established here.
- `tests/session-264-editor-render.test.mjs` did not finish inside a 240 s per-file window in this sandbox (nor 700 s for `deep-debug-regressions`); neither file was changed by this section and both need a longer, isolated run before they can be called green.
- "No more drawdown" is implemented under the reading in §24.5. **DONE (code-verified 2026-11-09):** the browser-side cursor / skip list / failover state is gone and only `window.__yvsApiRotation.stats()` counters remain; if the user meant a different drawdown, that needs one more follow-up.
- The editor layout's own completed-project rows keep using `pipelineManagementStore` (title/script/style/stage). They survive a refresh but do not carry the 24 h archive or the five-per-page pager, because the request named "rows" in the Quick Batch table; extending the archive to the accordion list is a separate change.

### 24.16 Status

- All seven requested items are implemented: server-side rotation behind `GET /api/relay/endpoint` (the browser asks, waits and calls exactly the given URL), round robin as the only scheme with the UI Worker on the smaller ring share, the browser-side pool drawdown removed, five backup URL inputs, completed Quick-Batch rows that survive a refresh with five-per-page pagination and a 24 h client-side deletion, and a timeline overlap resolver that runs on every element/scene addition, timing edit, undo/redo and load.
- Test state for the touched suites: api-relay **31 / 36** (5 pre-existing failures), quick-batch-table **15 / 15**, timeline-editor **35 / 35**, template-composer **20 / 20**, plus the other suites listed in §24.12 at their baseline; `npx tsc --noEmit` at the 30 pre-existing diagnostics. **Re-verified 2026-11-09:** those four counts are unchanged, `final-media-cap-actions` is **11 / 11**, and the server-side hand-out/rotary constants (`RELAY_ENDPOINT_PATH`, `MAX_RELAY_WORKERS = 5`, `RELAY_BACKUP_RING_WEIGHT = 3`, `pickRelayEndpoint()`) are present as described.

## 25. Five editor fixes: pill-shaped walkthrough steps, no Pixabay link, duplicate filenames move the search page, script-anchored scene keywords, and a content-length timeline (2026-11-09)

> Coded and verified after §0 and §24; everything below was checked against the code at `407ab86` before the edit and against the edited tree after it.

### 25.1 Request → change → proof

| # | Request (verbatim intent) | Old behaviour in the code | What was changed | Proof |
|---|---|---|---|---|
| 1 | Make the SEO walkthrough modal steps look like the Status-column tags of the uploaded HTML ([SEO plan > Choose a keyword set > Video image style > Script + images]) | `.seo-wt-steps/.seo-wt-step` were 999 px capsule bubbles with hard-coded `#374151` text and a cyan `#22d3ee` active chip (`src/client/styles.ts` 9013–9033) | `.seo-wt-step` now uses the reference `.pill` recipe — inline-flex, `padding: 3px 8px`, `border-radius: 4px`, `font: 600 .74rem 'JetBrains Mono'`, `background: var(--t-panel-2)`, `color: var(--t-muted)`, `border: 1px solid var(--t-line)`, `white-space: nowrap`; `.active` uses the theme accent, `.done` uses the reference success green (`rgba(16,185,129,.14)` / `#34d399`), with a ✓ prefix | `tests/session-331-fixes.test.mjs` (CSS rule + `done` toggle assertions) |
| 2 | Remove the Pixabay link on the editor layout (“Stock media from Pixabay”) | The gallery heading row rendered `<a href="https://pixabay.com/" …>Stock media from Pixabay</a>` (`src/client/app-js.ts` 7247); the quick-batch table also linked the word “Pixabay” (`src/client/markup.ts` 400) | The anchor is deleted; the `Images / MP4s — drag cards to reorder` title, upload button and template link stay. The second link on the same page becomes plain text (the attribution sentence is kept) | `tests/session-331-fixes.test.mjs` (no `pixabay.com` in `APP_JS` or `PAGE_MARKUP`) |
| 3 | A “Duplicate Pixabay filename rejected for scene N” error must move the Pixabay result page and use the first photo of the new page | `acceptMediaBlob()` rejected the duplicate and the retry ladder only rotated `index` (`base + attempt`) % 8; the page changed only after a full 8 (image) / 4 (video) rotation, so a duplicate at index 0 re-read the *same* page | Each rejection increments `owner._mediaDuplicatePages["scene-N"]`; `alternateMediaPrompt(prompt, attempt, scene, owner)` then sets `page = 1 + ((startPage − 1 + duplicates) % 2)` and `index = floor(duplicates / 2)`. First duplicate ⇒ page 2, index 0 (first photo of the new page); later duplicates walk that page instead of repeating `(page 1, index 0)`. Without an owner the old rotation is untouched | `tests/final-media-cap-actions.test.mjs` (new test: image + video, legacy caller) |
| 4 | Plan scene image keywords from the script text itself (words that are in the script **and** in the SEO keyword plan first, matched to each scene’s word-occurrence timing, no articles/adjectives/short words, duplicates allowed when the word is in the SEO plan) | `/api/image-prompts` asked the instruct model for 1–5 word searches; the client sent no timing and no source | New deterministic planner in `src/modules/image-prompts.ts` (`timedScriptWords`, `isSceneKeywordWord`, `planScriptSceneKeywords`, `planScriptSceneQuery`). The client now sends `keywordSource: "script"` + `durationSec` from both layouts; `generateImagePrompts()` returns before touching `env.AI`. Words are character-weighted onto the verified voiceover length, the 12 scene windows are cut from it, and each window’s content words are ranked long-tail (3) → short keyword (2) → plain script word (1) | `tests/session-331-fixes.test.mjs` (10 tests incl. HTTP 200 with `{}` env, timing windows, stopword rejection, SEO priority) |
| 5 | The video length in the timeline must not depend on stretched seconds / remaining space; it must be the end of the last element or last background scene | `maxTimelineEnd()` seeded itself from `state.durationSec`, and `ensureTimelineEnd()` rounded every growth up to the next 5 s (`Math.ceil(clamped / 5) * 5`), so an export was a multiple of the ruler, not the content | `timelineContentEnd()` measures the last item on any lane; `maxTimelineEnd()` clamps it; `ensureTimelineEnd()` assigns it (and re-clamps the playhead); `persistNow()` and `restoreSnapshot()` store/restore the measured value instead of a max/rounding | `tests/timeline-editor.test.mjs` (updated 6 s expectation + new shrink/grow/persist test) |

### 25.2 Fix 1 — the walkthrough steps are status pills

`src/client/styles.ts` (replaces the old 999 px bubbles):

```css
.seo-wt-step {
	display: inline-flex; align-items: center; gap: 4px;
	padding: 3px 8px; border-radius: 4px;
	border: 1px solid var(--t-line, #374151);
	background: var(--t-panel-2, #1b212b);
	color: var(--t-muted, #9ca3af);
	font-family: 'JetBrains Mono', monospace;
	font-size: 0.74rem; font-weight: 600; line-height: 1.4; white-space: nowrap;
}
.seo-wt-step.done   { color: #34d399; border-color: rgba(16,185,129,.55); background: rgba(16,185,129,.14); }
.seo-wt-step.done::before   { content: "✓"; font-size: .72rem; }
.seo-wt-step.active { color: var(--t-heading, #f9fafb); border-color: var(--accent, #22d3ee); background: var(--t-panel-3, #232b37); font-weight: 700; box-shadow: inset 0 -2px 0 var(--accent, #22d3ee); }
.seo-wt-step.active::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--accent, #22d3ee); }
```

`showSeoWalkthroughStep()` (`src/client/app-js.ts`) gained the state class:

```js
const stepOrder = ["plan", "sets", "style", "script"];
const stepIndex = stepOrder.indexOf(step);
chip.classList.toggle("active", chip.getAttribute("data-step") === step);
chip.classList.toggle("done", chipIndex > -1 && stepIndex > -1 && chipIndex < stepIndex);
```

Notes:

- No `.pill` class existed in `src/client/styles.ts`, so the reference HTML was **transcribed** into the design tokens the app already has (`--t-panel-2`, `--t-line`, `--t-muted`, `--t-panel-3`, `--accent`, `--t-heading`, all defined per theme). No new colour vocabulary was invented.
- `--accent` differs per theme (`#baff61` in the dark theme, `#f59e0b` at the root), which is intended: the open step wears the theme accent, exactly like the reference's `.pill.accent`.

### 25.3 Fix 2 — no Pixabay link

- `src/client/app-js.ts`: `…drag cards to reorder</div><a href="https://pixabay.com/" …>Stock media from Pixabay</a>` → `…drag cards to reorder</div>`.
- `src/client/markup.ts`: `Stock photos and clips from <a …>Pixabay</a> · 12 results per search…` → `Stock photos and clips from Pixabay · 12 results per search…` (same sentence, no outbound anchor).
- `grep -rn "pixabay.com/" src/client/` now only matches a code comment in `pixabay-direct.ts`.

### 25.4 Fix 3 — a duplicate filename moves the result page

`src/client/app-js.ts`:

```js
function mediaDuplicatePages(owner, scene) { /* owner._mediaDuplicatePages["scene-" + scene] */ }
function noteMediaDuplicate(owner, scene)       { /* +1, returns the new count */ }

function acceptMediaBlob(owner, blob, scene) {
	…
	if (!reserveMediaFilename(owner, filename)) {
		noteMediaDuplicate(owner, scene);      // NEW: remembers this rejection
		mediaItemRetryLog({ event: "duplicate-filename", …, pageSteps: mediaDuplicatePages(owner, scene) });
		return false;
	}
	…
}

function alternateMediaPrompt(prompt, attempt, scene, owner) {
	… /* unchanged index rotation */
	var duplicates = mediaDuplicatePages(owner, scene);
	if (duplicates > 0) {
		var startPage = Math.max(1, Math.floor(Number(token.page) || 1));
		page = 1 + ((startPage - 1 + duplicates) % MEDIA_MAX_PIXABAY_PAGES);   // page 1 → 2 → 1 …
		ordinal = Math.floor(duplicates / MEDIA_MAX_PIXABAY_PAGES) % limit;    // first hit, then next index
	}
	… /* token gains duplicatePages + uniqueFilename: "required" */
}
```

Wiring: `retryFailedMediaOnly(owner, …)` now passes `owner` into `alternateMediaPrompt`, and both producers already hand in the right owner — the Quick Batch row (`requestBatchImagesWithIndividualRetries(row, …)`) and the editor project (`runEditorMediaWithIndividualRetries(…, project, …)`). The duplicate key is the **absolute** scene number in both paths (`sceneForIndex()` for the table, `sceneOffset + index` for the editor), so the counter always lands on the scene that failed.

Bounds that are deliberately unchanged:

- `MEDIA_MAX_PIXABAY_PAGES = 2` in the client and `MAX_PAGES = 2` in `src/client/pixabay-direct.ts`, so the round trip is page 1 → page 2. Two pages × 8 photos (or × 4 clips) still gives 16 (8) distinct candidates per scene, and `(page, index)` is never repeated, which is what the retry ladder needs; raising the page budget is a one-constant change in two files if a scene ever exhausts it.
- The token still carries `uniqueFilename: "required"`, so a second rejection is still detected rather than silently accepted.

### 25.5 Fix 4 — scene keywords come from the script, timed per scene

#### 25.5.1 The planner

`src/modules/image-prompts.ts` (new exports):

| Symbol | Purpose |
|---|---|
| `SCRIPT_KEYWORD_STOPWORDS` | articles, pronouns, prepositions, auxiliaries, conjunctions, question words, fillers, number words, generic nouns (`thing`, `way`, `make`, `go`, …) |
| `SCRIPT_KEYWORD_WEAK_WORDS` | flat adjectives/adverbs (`very`, `great`, `important`, `typical`, `monthly`, …) and flat verbs (`use`, `need`, `turn`, `stay`, …) |
| `isSceneKeywordWord(word)` | the single content-word gate: ≥ 3 chars, not a number, not in either list |
| `timedScriptWords(script, durationSec)` | every word with `{ word, startSec, endSec, ordinal }`, character-weighted (the 90th character of a 900-character script is spoken at 10 % of the video) |
| `scenePlanDuration(input)` | the verified `durationSec`, else words ÷ 2.5 (150 spoken words/minute), else `minutes × 60` |
| `planScriptSceneKeywords(input, total, offset, count)` | one plan per scene: `{ scene, startSec, endSec, query, words, planMatched }` |
| `planScriptSceneQuery(...)` | the per-window selection described below |

Per scene `s` of `total`: `startSec = duration × s / total`, `endSec = duration × (s + 1) / total`. Inside that window:

1. keep only content words (`isSceneKeywordWord`);
2. rank them `longTail → 3`, `short[] → 2`, plain script word → 1, tie-broken by the order they are spoken;
3. take at most **5 words / 100 characters**, then re-sort the chosen words into **spoken order** so the query reads like the sentence;
4. if the window has no content word (a silent stretch), borrow the nearest content word in time;
5. if the script has none at all, fall back to the SEO set, then the topic.

The SEO words must be **in the script window too** — the plan ranks, it never injects a word the narrator does not say in that scene. Duplicates across scenes are allowed on purpose (the request asks for that when the word is in the SEO plan); the token’s per-scene `index` ordinal is what keeps two scenes from reading the same Pixabay result.

#### 25.5.2 No model on the in-app path

```ts
if (input.keywordSource === "script") {
	const plans = planScriptSceneKeywords(input, total, offset, count);
	return plans.map((plan, index) => "pixabay:" + JSON.stringify({
		q: plan.query, type: slots[index].type, page: 1,
		index: slot.type === "video" ? positions.indexOf(scene) : imageScenePositions(total).indexOf(scene),
		scene: plan.scene
	}));
}
if (!env?.AI) throw new Error("Scene keyword planner AI binding not configured");   // legacy path only
```

- `ImagePromptInput` gained `keywordSource?: "script"` and `durationSec?: number`; `sanitizeInput()` accepts/validates both (`durationSec` clamped to 1…3600).
- The instruct-model planner (`buildStockSearchInstruction`, the 3-attempt ladder in `handleGenerateImagePrompts`) is **kept** for callers that send no `keywordSource`, which is why `tests/pixabay-media.test.mjs` (58/58) still passes unchanged.
- Client wiring (three request bodies, verified by test): the editor flow sends `keywordSource: "script"` + `durationSec: editorScenePlanDuration(project)` (decoded voiceover → `_voiceoverDurationMs` → `scriptDurationMs` → `_seoMinutes × 60`); the quick-batch row sends `keywordSource: "script"` + `durationSec: batchScenePlanDuration(row)` (`row.audio.duration`, else `minutes × 60`).
- The walkthrough copy under **Video image style** was rewritten to describe what the code now does (scene window + SEO priority + skipped stops words + the fixed 12-scene plan), replacing the stale "6/8/10 scenes by word count" sentence.

### 25.6 Fix 5 — the timeline is exactly as long as its content

`src/client/timeline-editor.ts`:

```js
function timelineContentEnd() {
	var end = 0;
	(state && state.tracks || []).forEach(function (track) {
		(track && track.items || []).forEach(function (item) {
			if (!item) return;
			var start = Math.max(0, number(item.startSec, 0));
			var duration = Math.max(MIN_CLIP_SEC, number(item.durationSec, MIN_CLIP_SEC));
			end = Math.max(end, start + duration);
		});
	});
	return end;
}
function maxTimelineEnd() { return clamp(timelineContentEnd(), 1, MAX_DURATION_SEC); }
function ensureTimelineEnd(_end) {              // the argument is now only a hint
	if (!state) return;
	state.durationSec = maxTimelineEnd();
	state.playheadSec = clamp(state.playheadSec, 0, state.durationSec);
}
```

- Removed: the `state.durationSec` seed (a long project could never shrink) and the `Math.ceil(clamped / 5) * 5` rounding (a 6 s project exported as 10 s).
- `persistNow()` writes `maxTimelineEnd()`; `restoreSnapshot()` re-measures a loaded/undone project from its own items.
- The export follows the same number (`exportTimeline()` reads `state.durationSec`), so a 5 s scene + a 1 s composed clip renders exactly 6 s / 180 frames at 30 fps.
- Nothing else uses the length as a *limit*: `setItemTiming`, `appendTemplateClip`, `addAudioFile` and `addMediaFiles` still extend the project past the old end (the new end is simply re-measured), and the child-element clamp is still the parent clip, not the canvas.

### 25.7 Tests changed and added

| File | Change |
|---|---|
| `tests/timeline-editor.test.mjs` | the composed-clip export now expects `state.durationSec === 6` (was 10, “rounded to the 5 s grid”) and 180 encoded frames (was 300); new test “the timeline length follows the last placed item, never the stretched ruler” (restore = 60 s, 7.5 s exact, element at 8 + 1.25 = 9.25, shrink to 8.5, persisted value equals the model) |
| `tests/final-media-cap-actions.test.mjs` | new test “a duplicate Pixabay filename moves the search to the next result page”: page 2/index 0 on the first duplicate, page 1/index 1 on the second, legacy caller unchanged, video variant included |
| `tests/pixabay-studio-flow.test.mjs` | the item-retry test now addresses scene 0 by its token (`scene === 0`) instead of a model keyword; the editor ladder test became a direct `handleGenerateImagePrompts` ladder test (the editor no longer calls the model) |
| `tests/session-331-fixes.test.mjs` (new, 10 tests) | pills CSS + `done` state; no Pixabay link in `APP_JS`/`PAGE_MARKUP`; script-plan windows; stopword/adjective gate; SEO priority over plain script words; 12 distinct tokens without an AI binding; per-chunk scenes; HTTP 200 from `/api/image-prompts` with `{}` env; voiceover-driven windows; client wiring of `keywordSource` + `durationSec` |

### 25.8 Verification (this pass)

```text
npx tsc --noEmit                                  # 30 diagnostics, all src/index.ts (unchanged baseline)

# Session 331 suites
session-331-fixes                10 / 10
timeline-editor                  36 / 36
final-media-cap-actions          12 / 12

# Media / keyword / layout suites
pixabay-media                    58 / 58
pixabay-studio-flow              18 / 18
pixabay-direct-browser           12 / 12
pixabay-direct-routes            10 / 10
pixabay-image-ui                  2 /  2
pixabay-auto-retry                6 /  6
pixabay-fetch-regressions         5 /  5
quick-batch-table                15 / 15
quick-batch-pipeline-retries      4 /  4
progressive-image-pipeline       18 / 18
session-263-partial-image-flow    9 /  9
both-layout-media-hang            1 /  1
script-seo                       17 / 17
seo-plan-resilience               8 /  8
studio-ui-session-243             3 /  3
template-composer                20 / 20
public-entry-points               9 /  9
render-app-tts                    5 /  5
editor-subtitles-parity           7 /  7
```

Baseline comparison for the files that are already red at `407ab86` (run from a clean worktree of `407ab86` in the same sandbox):

| File | At `407ab86` | After this section |
|---|---|---|
| `seo-walkthrough` | 7 pass / 10 fail | 7 / 10 — **identical failing test names** (verified with a diff of the `not ok` lines) |
| `session-250-batch-pipeline` | 8 pass / 5 fail | 8 / 5 — identical |

`deep-debug-regressions` and `session-264-editor-render` still do not finish inside a 700 s / 240 s window (unchanged from §24.15); neither file was touched here.

### 25.9 Small print and judgement calls

- **Adjectives are a judgement call.** Only *flat* describing words are filtered (`SCRIPT_KEYWORD_WEAK_WORDS`). Words that describe an image (`neon`, `rusty`, `sunlit`) are kept, because they are exactly what a stock search needs. The list is data, not logic: adding a word is a one-line change.
- **“Duplicates allowed” is implemented as “allowed across scenes, never within one”.** Two scenes may search the same word (the request asks for that when the word is in the SEO plan), but each scene still carries its own `index` ordinal so Pixabay returns a different asset.
- **`durationSec` is the verified voiceover when one exists.** Before the voiceover is generated the planner uses the worker’s measured `scriptDurationMs`; failing both it assumes 2.5 words/second, then the project’s minutes. A later voiceover therefore does not retro-fit old tokens — the next plan uses the real length.
- **The 5 s rule is gone everywhere, not just for media.** A caption or a music cue that runs past the last scene still counts (it is still on screen), which is why `timelineContentEnd()` reads every lane.
- **`MEDIA_MAX_PIXABAY_PAGES` is still 2.** The fix moves the page; it does not add new pages beyond the provider budget the client and `pixabay-direct.ts` already agreed on.
- **Not exercised in a real browser.** The pill styling, the removed link and the page-move were verified by source assertions, JSDOM tests and the HTTP/planner tests above — not by eye in a real Chromium session.

## 26. Timeline → Quick Batch hand-back: the edits a user makes in the timeline editor come back with the row and drive its table status, Preview and Export (2026-11-09)

**Status: coded and verified.** Request, verbatim:

> "make sure when the link to get back to the quick batch table is clicked from the timeline editor the changes must be stored on cookie and localstorage and accessible by the rows action button so it reflects in the table layout and the preview buttons etc"

### 26.1 What was wrong

The timeline editor and the Quick Batch table are two different pages with two different stores, and nothing carried an edit from one to the other:

- `src/client/timeline-editor.ts` saved its project under its own key (`ytvs.timeline-editor.v1.<projectId>`) and, on **Back**, simply navigated to the table. The row in the table was never told that anything changed.
- `src/client/app-js.ts` (the table page) restored rows from the pipeline store, but a row's saved snapshot had no field for a timeline edit, so even if one had been written it would have been dropped by `boundedSnapshot()`.
- The row's Action buttons (✎ / ▶ / ⚙) read `row.slides` only, and `row.slides` is rebuilt from the original media in a fixed order at fixed lengths. So a re-ordered or re-timed timeline was invisible to Preview and Export.

### 26.2 The contract that was added

**Published payload** — `window.__PUBLISH_TIMELINE_EDIT__({ sourcePageId, rowId, vid, key, summary, reason })` returns

```text
{ ok, reason, source: "localStorage+cookies", pageId, rows, cookies: 4, timestampMatched, updatedAt }
```

**Summary** — compact, bounded, and deliberately *not* the whole project (no blobs, no captions, no audio):

```text
{ v: 1, updatedAt, key, pageId, sourcePageId, rowId, vid,
  durationSec, sceneCount, clipCount, textCount, videoStyle, frame: { width, height },
  scenes: [ [mediaIndex, durationSec, typeCode], … ] }        // typeCode 0=image 1=video 2=gif
```

`mediaIndex` is 0-based (`scene-1` → `0`), and the array order **is** the playback order.

### 26.3 Timeline side (`src/client/timeline-editor.ts`)

| Piece | Behaviour |
|---|---|
| `sceneNumberOf(value)` | Reads the trailing digits without a regex (`lastIndexOf("scene-")` + digit scan), returns `-1` when the value is not a scene id, and `scene-1 → 0`. |
| `timelineEditSummary()` | Builds the summary above from the live model: `maxTimelineEnd()` for `durationSec`, one entry per Scene Media item in lane order, the clip's own length, a type code from the media kind. |
| `publishTimelineEdit(force)` | Calls the table's global and stores both results on `window.__TIMELINE_EDIT_PUBLISH__` and `window.__TIMELINE_HANDOFF__` (the second is what a browser check reads). |
| `schedulePublish(force)` | Throttles to `PUBLISH_INTERVAL_MS = 1200`; a forced call always wins. |
| `persistNow()` | Unchanged save path, plus `schedulePublish(false)` on success. |
| `publishReady` | `false` until the project has loaded (set just before `resetHistory()`), so no partial summary is ever published during boot. |
| Back click (`#timeline-back`) | `persistNow()`, then a **forced** publish, then `window.close()`; when the tab cannot close it navigates with `pipelinePage=state.sourcePageId` and `layout=table` (and drops `pipelinePage` when there is no source page, so the tab keeps its own). |
| `beforeunload` | Forced publish too, so closing the tab is the same as pressing Back. |

`pipelinePage` is deliberately kept on the Back URL: it is the storage namespace, and dropping it would fork a second, empty table.

### 26.4 Table side (`src/client/app-js.ts`)

- `publishTimelineEdit(payload)` resolves the right store — `timelineEditStoreFor(sourcePageId)` returns the page's own store, or a new one built by `window.__PIPELINE_MANAGEMENT_STORE_FACTORY__` (`createPipelineManagementStore(win, pageId)`, exported from `pipeline-management-store.ts`) — then merges the summary into that page's row by `vid` (falling back to `id`) and saves. The save is the normal one: localStorage first, four cookie chunks second, and `ok` only when the cookie timestamp/digest matches.
- `applyTimelineEditToBatchRow(row)` is the single place that turns a saved edit into playback behaviour:
  - scene **order** comes from `edit.scenes`;
  - each scene's **length** lands on `slide._partialSec`, which `slideDurationSec()` already prefers (so Preview and the WebCodecs export both read it);
  - slides are found by id — `-img-` / `-clip-` / `-gif-` plus `trailingDigits()` (`batch-7-img-3` → 3) — and fall back to the slide's position when a slide is unnamed, first hit wins;
  - a slide the edit no longer places is **appended** rather than dropped;
  - the row is stamped with `timelineEdited`, `timelineDurationSec`, `timelineSceneCount`.
- `batchStatusText()` prints the hand-back in the Status cell (`… · timeline edit 43s`), so the table layout itself shows that the row was edited.
- `reconcileTimelineEdits()` picks up an edit published **while the table is already open** (another tab pressed Back): it applies only rows whose `timelineUpdatedAt` is newer, returns the count, and is idempotent — a second call returns `0`. `row.script` is never touched.
- Boot order: `window.__PUBLISH_TIMELINE_EDIT__` is assigned at the export tail of `app-js.ts` because the timeline page's script runs **first**; the timeline reads the global at publish time, not at parse time.

### 26.5 Two bugs found while verifying

1. **`SLIDE_SECONDS_MIN` is `9`, and it is a default, not a floor.** The first version clamped the edited length with `Math.max(SLIDE_SECONDS_MIN, seconds)`, so every hand-back scene was flattened to 9 s and the edit silently did nothing. The clamp is now `Math.min(MP4_MAX_DURATION_S, Math.max(0.1, seconds))` — positive and bounded like a clip, but the editor's own number survives.
2. **Regex digit parsing did not survive the string-embedded build.** `\d` was collapsed to `d` when the client modules were emitted into the `APP_JS` string, so both the scene index and the slide lookup matched nothing. Both were replaced with character-code scanners (`sceneNumberOf`, `trailingDigits`) that contain no backslash at all.

### 26.6 Tests added

| File | Test | Asserts |
|---|---|---|
| `tests/timeline-editor.test.mjs` | "the Back link hands the edit back to the Quick Batch table (Session 331 follow-up)" | publish `ok`, `pageId` is the table page, `cookies: 4`, `timestampMatched: true`, 12 scene entries with `mediaIndex` 0–11 exactly once each, first scene carries the edited length, the four cookie chunks re-assemble into the same JSON as localStorage, and the timeline project is still saved under its own key |
| `tests/final-media-cap-actions.test.mjs` | "a timeline edit comes back into the table: the row is re-timed and its Preview paints the edit" | restore applies the stored edit: `timelineEdited`, `timelineDurationSec 42.5`, 12 scenes, Status cell shows `timeline edit` + the edited length, `row.slides` re-ordered to the saved order, `_partialSec` 6.5 / 3, `slideDurationSec()` reads the edit |
| `tests/final-media-cap-actions.test.mjs` | "a newer edit published while the table is open is picked up without touching the rest of the row" | `reconcileTimelineEdits()` applies a newer edit, returns `1`, is idempotent (`0` second time), and leaves `row.script` unchanged |

Realm note: arrays read out of the JSDOM window must be copied with `Array.from(...)` before `assert.deepEqual`, because `deepStrictEqual` compares prototypes and a JSDOM-realm `Array` has a different `Array.prototype`.

### 26.7 Verification (this pass)

```text
npx tsc --noEmit                       # 30 diagnostics, all src/index.ts (unchanged baseline)

timeline-editor                 37 / 37   (was 36; +1 hand-back test)
final-media-cap-actions         14 / 14   (was 12; +2 hand-back tests)
quick-batch-table               15 / 15
session-331-fixes               10 / 10
pixabay-media                   58 / 58
session-250-batch-pipeline       8 / 13   (pre-existing at 407ab86: same 5 failures: 5, 7, 8, 9, 10)
```

### 26.8 Small print and judgement calls

- **The browser is the only store.** The hand-back rides the existing pipeline store — localStorage plus the four `ytvs_pipeline_management_<pageId>_1..4` cookie chunks — so it inherits the existing 8-row / 800-char bounding and the timestamp+digest verification. No new server endpoint, no KV.
- **A summary, not a project.** Captions, audio, text content and media bytes stay in the timeline project and IndexedDB. The table needs order, length and kind to paint and to render; anything more would blow the cookie budget for no visible gain.
- **Throttled, not debounced.** A slider drag publishes at most once every 1.2 s; Back and `beforeunload` force one final publish so the last state is never lost.
- **Position fallback is a compatibility path.** Real slides are named after their image, so id matching is the normal path; the positional fallback only exists for slides created before the naming existed.
- **Not exercised in a real browser.** The hand-back was verified by JSDOM tests against the real client modules and by the store's own save/verify result; the Back navigation itself was not clicked in a real Chromium page.

## 27. Server API rotation: the round-robin is arithmetically sound, and every wait in it is now bounded (2026-11-09)

**Status: audited, four bugs fixed, one fail-over metric repaired, tests green.** Request, verbatim:

> "make sure the rotation on server is logical check for hanging implementation"

Scope: `src/modules/api-relay.ts` (pool, ring, health, relay, endpoint hand-out) and `src/client/api-rotation.ts` (the caller that obeys it), plus the provider rotation in `src/modules/llm-openrouter.ts` that sits above it.

### 27.1 What "logical" means here, and what the numbers are

The rotation is one weighted ring walked by one cursor. The local (UI) Worker is entered `config.localWeight` times (default `1`); every backup is entered `RELAY_BACKUP_RING_WEIGHT = 3` times. Walking that ring with a cursor is a true round robin in which the UI Worker always carries the smaller share:

| Registered backups | Ring length | UI Worker share | Each backup share |
|---|---|---|---|
| 0 | 1 | 100 % (the pre-rotation behaviour) | — |
| 1 | `1 + 3 = 4` | 25 % | 75 % |
| 2 | `1 + 6 = 7` | 14 % | 43 % each |
| 3 | `1 + 9 = 10` | 10 % | 30 % each |
| 4 | `1 + 12 = 13` | 8 % | 23 % each |
| 5 | `1 + 15 = 16` | 6 % | 19 % each |

`tests/api-relay.test.mjs` now walks 160 picks over a five-backup pool and asserts exactly 10 / 30 / 30 / 30 / 30 / 30, so the table is a pinned contract rather than a comment. The same test pins the two edges: `localWeight: 0` removes the UI Worker from the hand-out while every backup still takes its turn, and a pool whose backups have all cooled still answers — on the UI Worker, because a cooling member is pushed to the end of the list, never removed.

Two smaller logical points were checked and are correct as written:

- **The ring is rebuilt per call, from the healthy members only**, so a cooled member leaves the ring entirely (its slots go to the others) instead of occupying slots that then have to be skipped.
- **`preferLocal`** (set when a request arrives carrying a rotation ticket) pulls the local member to the front, so work the browser just sent here is executed here and never bounced back to the Worker the studio left. A relayed call cannot relay again because `handleRelayRoutes` is dispatched with `baseEnv` (the raw bindings), and the compute endpoint calls `ai.run` directly.

### 27.2 The hangs that were real

| # | What hung | Why | Fixed |
|---|---|---|---|
| 1 | A **slow/hanging backup** failed the whole request instead of failing over | our own per-attempt deadline aborts the `fetch`, which rejects with `AbortError`; `isTransientRelayFailure()` reads `AbortError` as "the caller cancelled" and `runViaWorkersAi` rethrows it immediately | `abortSignalFor()` now records whether *our* timer fired and `runRemoteModel()` re-labels that case as a `TimeoutError` (transient) → the next member runs, and finally local |
| 2 | A **browser failure report never cooled anything** | the report arrives on `GET /api/relay/endpoint?failed=<id>` with the ticket of the answer that handed out the URL, but `readRelayTicket()` is path-scoped to the AI paths, and the endpoint path is not one — so the very ticket the Worker minted was rejected | new `readRelayReportTicket()` verifies the HMAC and expiry and requires a scope made only of AI paths; the route then cools the reported member |
| 3 | A report could cool **any** id, including `local` | the route fed `failed=<anything>` straight into `noteRelayFailure()` | the reported id must match a **backup of this pool** (`!entry.local`), so `failed=local` and unknown ids do nothing |
| 4 | One `env.AI.run()` could wait **(maxAttempts + 1) x timeoutMs** | each attempt was allowed the full per-attempt timeout, and the local backstop is appended *beyond* `maxAttempts`; with defaults that is 400 s, with the largest configurable timeout it is 24 minutes | new `RELAY_CHAIN_MAX_MS = 180_000` gives the whole chain one budget (`timeoutMs x attempts`, capped); each attempt gets `min(timeoutMs, remaining)`, and a member is skipped when fewer than 250 ms are left |
| 5 | The **inbound compute endpoint** had no deadline at all | `POST /api/relay/ai` awaited `ai.run()` and the result decoding with nothing bounding them; a hung binding pinned the isolate until the platform killed it | `withDeadline()` bounds `ai.run` **plus** `encodeRelayResult` at `RELAY_ENDPOINT_MAX_MS = 240_000` (the largest budget the policy can be configured with, so a legitimate long call is never cut) and answers `504` + `kind: transient`, which is exactly what makes the caller fail over |

### 27.3 The fail-over that was never reported

`stats.failedOver` only incremented on the *remote* success path (`if (attemptIndex > 1)`), so the most common fail-over of all — a backup failed and **the UI Worker answered** — reported `failedOver: 0`. The local branch now increments it too. This is diagnostics, not behaviour, but the `rotation` block that diagnostic routes return (`relayRuntimeOf(env).stats()`, e.g. `POST /api/llm/generate` in `src/index.ts`) reports it, so a pool that was failing over looked idle.

### 27.4 Every wait in the path, and its bound

| Wait | Bound | What happens when it fires |
|---|---|---|
| Browser asks for an endpoint (`GET /api/relay/endpoint`) | `ASK_TIMEOUT_MS = 8000` (`src/client/api-rotation.ts`) | `null` answer → the original same-origin request runs on the UI Worker |
| Browser retries after a failed rotated call | `MAX_ASK_ATTEMPTS = 2`, and only for replayable bodies (`string`/`Blob`/`FormData`/`URLSearchParams`) | the last response is returned to the caller; a streamed body is never replayed |
| One relayed model call | `min(policy.timeoutMs, chain remaining)`, floored at 1 s | `TimeoutError` → next member → local |
| One whole `env.AI.run()` chain | `RELAY_CHAIN_MAX_MS = 180 s` | the last error is thrown; the request ends |
| Local `ai.run` | race against the same per-attempt timeout | `TimeoutError` (transient) → next member |
| Inbound `/api/relay/ai` compute | `RELAY_ENDPOINT_MAX_MS = 240 s` (model **and** decoding) | `504` transient → the caller fails over |
| Reachability probe | 5 s per member, all members in parallel | that member is cached `reachable: false` for 60 s |
| `GET /api/relay/pool` probes | backgrounded via `ctx.waitUntil` when available | the route answers immediately |
| Circuit breaker | 30 s doubling to a 300 s ceiling, reset on success | the member leaves the ring while it cools |
| Attempts per call | `maxAttempts` (1–5) + the local backstop | the last error is thrown |

Nothing in the file loops without a counter: the ring walk is `for (i < ring.length)`, the attempt loop is `for (entry of attempts)`, the provider loop is `for (index < providers.length)`, and `readStreamBytes()` is bounded by `RELAY_MAX_RESULT_BYTES`. `orderLlmProviders()` returns at most two providers, each tried once.

### 27.5 Tests added and repaired

| File | Change |
|---|---|
| `tests/api-relay.test.mjs` | **new** “the UI Worker's share shrinks as backups are added: 1 slot in (1 + 3 x backups)” (160 picks → 10 local / 30 each; `localWeight: 0`; fully cooled pool falls back to local) |
| `tests/api-relay.test.mjs` | **new** “a backup that never answers times out, is cooled, and the call still lands on the UI Worker” — a fetch that accepts the connection and never answers; `timeoutMs: 5000`; the call resolves on local, the chain stays under `RELAY_CHAIN_MAX_MS`, and the member's circuit is open with a timeout error recorded |
| `tests/api-relay.test.mjs` | **new** “a timeout is transient but a cancelled request is not” — a pre-aborted request surfaces as `AbortError` and is **not** replayed on another member |
| `tests/api-relay.test.mjs` | **new** “a browser failure report needs a signed ticket and can only cool a backup” — no ticket ⇒ nothing; forged ticket ⇒ nothing; `failed=local` ⇒ nothing; the real ticket ⇒ the backup cools and the next three hand-outs avoid it; a ticket scoped past the AI paths ⇒ refused |
| `tests/api-relay.test.mjs` | **repaired (5 tests, pre-existing red at `407ab86`)** the `/api/image` fixtures were stale: Session 331 §25 removed AI image generation, so every one of them died on “AI image generation is disabled; use Pixabay” before reaching the relay. The binary-relay contract now rides on `@cf/myshell-ai/melotts`, and the two end-to-end route tests use `/api/voiceover` (a ticket-only caller, real `audio/mpeg` bytes) instead of the Pixabay importer |
| `tests/llm-openrouter.test.mjs` | “an image model never reaches OpenRouter” now asserts the image guard (nothing is spent, the error points at Pixabay) instead of expecting a Cloudflare answer |

### 27.6 Verification (this pass)

```text
npx tsc --noEmit                       # 30 diagnostics, all src/index.ts (unchanged baseline)

api-relay                       40 / 40   (was 36 tests: 31 pass / 5 stale-red)
llm-openrouter                  24 / 24   (was 23 / 24 - one stale image test)
pixabay-media                   58 / 58
public-entry-points              9 /  9
session-331-fixes               10 / 10
```

### 27.7 Small print and judgement calls

- **Health, cursors and cooldowns are per isolate.** They live in module memory, so a report or a timeout cools the member only for the isolate that saw it, and a brand-new isolate starts its cursor at slot 0 — which is the **local** slot. Under bursty traffic spread across many cold isolates the UI Worker therefore takes more than its 1-in-16 share; under steady traffic on warm isolates it takes exactly its share. Making the cursor start at a random offset would remove the warm-up bias, but the deterministic start is what the pinned ring tests (and a debuggable admin page) rely on, so it is left as is and documented.
- **The browser still asks once per AI call.** Each `/api/script`, `/api/image`, `/api/voiceover` … costs one extra same-origin `GET /api/relay/endpoint` (KV reads cached 15–20 s inside the isolate) before the real request. That is the price of the server owning the pick; the 8 s cap plus the local fallback keeps it from ever being a hang.
- **The endpoint's 240 s deadline is a hang guard, not a policy.** It equals the largest `timeoutMs` the policy can store, so no legitimate configuration is ever cut short by it; the shorter, user-facing guard is the caller's own per-attempt timeout.
- **A timed-out `ai.run` on the receiving Worker keeps running.** JavaScript cannot cancel it; the isolate is released when it settles, and the caller has already failed over.
- **The 5 repaired tests were red before this pass.** They failed at `407ab86` on the Pixabay-only policy added in §25, not on anything in the rotation, which is why §25's table listed `session-250-batch-pipeline` and `seo-walkthrough` as the only known reds — `api-relay` was not re-run in that pass. Retargeting them restored coverage of the binary relay path, which no passing test had covered since §25.
- **Not exercised against real Cloudflare Workers.** The timing paths are pinned with stubbed bindings and fetch functions inside the test process; the 5 s timeout test really waits 5 s, but no test waits out the 180 s chain budget or the 240 s endpoint deadline.

## 28. Quick Batch regenerate fix (finished rows stay clickable, can be regenerated, and survive a reload), Delete Video moved to the bottom of the accordion, and search keywords capped at three words (2026-11-10)

### 28.1 The request

1. **Quick Batch table.** A finished row must be regenerable. Preview, Process export and Edit must stay clickable after generation, must still work after the row is edited in the timeline editor, and a timeline edit must reset the row so it can be generated again.
2. Document the request and the fix here, after section 27.
3. **Editor layout.** The Delete Video button takes the look of the top-bar Generate button, sits inside the accordion body at the bottom, and spans the full accordion width.
4. **Image search keywords** are at most three words.

Standing constraints from the user: treat this log and the other `.md` files as possibly stale and check them against the code; do not break the code or the system.

### 28.2 What the code actually did (verified, not taken from this log)

Section 24.9 says a restored completed row is a *record*, with Preview and Export locked, because media bytes were never persisted. That was true of the code, but it is what the user is asking to change. Tracing the path again showed three separate faults:

| # | Where | What happened |
|---|---|---|
| A | `restorePipelineManagementState` (~1270) → `hydrateBatchRowAssetsFromTimeline` | The restore set `stage = "done"` and started hydration **without awaiting it**. The restore runs inside `APP_JS`, and the timeline editor script (`window.__TIMELINE_EDITOR__`, the only reader of the IndexedDB media) is emitted in the same page block **after** it. So on every reload hydration returned `false` at once, and the row came back with no mp3, images or slides. |
| B | `batchRowReadyForGeneration` | It accepted only `ready` / `queued`, so a `done` row with no media could not be generated. With its buttons locked as well, the row was stuck: Preview, Export, Edit and Generate were all disabled. |
| C | `openBatchEditPage` (the only writer of the row's media to IndexedDB) | A finished row's voiceover and Pixabay media were written to IndexedDB **only when the row was opened in the timeline**. A row that finished and was never opened had no copy to restore from. |

Two other points from the trace:

- `batchRowFinished()` treats a row as finished from the stored `_storedFinished` / `_storedMp3` / `_storedAnimated` flags alone (clause (b)). The existing tests depend on that for a cookie-restored, timeline-edited row, so it is kept.
- The timeline-edit regeneration reset was already in place: `batchRowTimelinePendingRegen()` returns true when the edit is newer than `_timelineRegeneratedAt`, and `batchRowReadyForGeneration()` admits such a row. That behaviour is pinned by the existing sync test and is unchanged.

### 28.3 The fix (`src/client/app-js.ts`)

**Media is kept on finish (fault C).**

- The asset-transfer block that used to live inline in `openBatchEditPage` is now `persistBatchRowMedia(row)`. `openBatchEditPage` and the successful end of `runBatchRow` both call it. The key is `batchRowMediaPageId(row)` = `timeline-<pageId>-row-<id>`, the same key `openBatchEditPage` has always used.
- `hydrateBatchRowAssetsFromTimeline` reads from that same key, so writing and reading agree (before, it used the timeline's own key, which can differ).

**Restore waits for the timeline editor, then rebuilds (fault A).**

- `recoverBatchRowMedia(row)` replaces the un-awaited hydration call in the restore. It sets `_recoveringMedia`, yields one tick (`batchDelay(0)`) so the timeline editor script has loaded, waits for any hydration already in flight, hydrates, and then runs `rebuildBatchSlidesFromItems(row)`.
- `rebuildBatchSlidesFromItems` rebuilds the slides from the stored `slideItems` (the same timing data `composeBatchSlideItems` writes). It reuses `cloneOrReuseBatchSlide` and the restored media, and does not decode or probe anything again.
- When recovery finishes, the row is repainted (`paintBatchRowStatus`, `renderBatchTable`).

**A finished row that cannot be restored becomes a record (demotion).**

- If `stage === "done"` and `batchRowFinished()` is still false after recovery, `demoteBatchRowToRecord(row)` clears the `_stored*` flags and sets `detail` to "Media not kept - Generate builds it again". Nothing is shown as an error.

**Generation gate (fault B).**

- `batchRowReadyForGeneration()` now also admits `done` rows that are not finished, so a demoted record can be generated again. Finished rows (live buttons) are still excluded, and a row with `_recoveringMedia` is never queued.

**Timeline edits (item 1, last point).** No change to the logic. The edit still makes the row pending regeneration, which is now honoured for restored rows too, because the gate no longer blocks a `done` row.

### 28.4 Delete Video (item 3)

- `videoAccordionHTML` (`app-js.ts` ~8570–8640): the button left the header and now sits in `va-body`, after `va-left` and before the body's closing `</div>`. The class `va-delete-btn`, the id `va-delete-N`, the title and the `deleteVideoAccordion(N)` handler are unchanged.
- `styles.ts`: `.va-delete-btn` is a full-width block with the Generate button's look: accent background, `var(--t-on-accent)` text, `1px solid var(--accent)`, `10px 13px` padding, `10px` radius, weight 800, `0.8rem`, and a `brightness(1.06)` hover. The accent override (`html[data-theme] #studio-app .va-delete-btn`) and the neo square/uppercase rules follow the `.app-generate` ones; the small-screen size matches too. The old red `#dc2626` hover is removed. `html[data-theme] .va-delete-btn` stays in the grey-list selector, which `studio-ui-session-243` checks; the accent rule wins over it by specificity.

### 28.5 Keywords (item 4)

- `SCENE_KEYWORDS_MAX_WORDS` and `SCRIPT_KEYWORD_MAX_WORDS` are 3 (`image-prompts.ts`). The planner instruction, the error messages and the comments now say 1–3 words.
- The no-model planner's raw-topic fallback used to be capped only by characters, so a long topic could still reach Pixabay as a long phrase. It now goes through `clampSceneQuery`, so it obeys the same three-word limit.
- **Judgement call:** `cleanSceneKeywords()` **rejects** a reply with more than three words (the existing §275 behaviour for prose); it does not trim it to its first three words. Trimming would turn a sentence such as "a calm misty morning" into "a calm misty", which is not a usable search term. If the user meant trimming, this is the one place to change.
- `system-rules.md` line 24 now reads 1–3 words, the same as the code.

### 28.6 Tests changed or added

| File | Change |
|---|---|
| `tests/pixabay-media.test.mjs` | #7 now expects "1-3 word search terms" in the prompt and error. The four-word reply case is now a rejection; a three-word reply is accepted. |
| `tests/session-331-fixes.test.mjs` | The keyword-set test asserts a three-word plan. |
| `tests/timeline-quick-batch-sync.test.mjs` | The Req 3 cookie test now waits one tick for media recovery before asserting that the row is regenerable (the gate is deliberate). **New:** "a finished row restored after reload gets its media back from IndexedDB, rebuilds its slides and stays live" (12 media, voiceover, 12 rebuilt slides with media, `batchRowFinished` true, not queued). **New:** "a finished row whose media cannot be found is demoted to a record that Generate can build again". |

### 28.7 Verification

```text
npx tsc --noEmit                         30 diagnostics, all in src/index.ts (unchanged baseline)

Per-file runs on this branch (npm test runs them all in one process; see 28.8). Totals: 524 subtests passing across the 44 files that finish.
  quick-batch-table                 15 / 15
  timeline-quick-batch-sync          6 /  6   (was 4: two new tests)
  session-331-fixes                 10 / 10
  pixabay-media                     58 / 58
  studio-ui-session-243              3 /  3
  timeline-editor                   37 / 37
  + 33 other files, all green
  44 files were run in the loop: 39 green, 5 with pre-existing failures (listed below)
```

**Failing files, each confirmed identical on the untouched commit `cbaa888` (extracted with `git archive`, same node_modules):**

| File | Failing | Note |
|---|---|---|
| `deep-debug-regressions` | 4 of 6 | Also hangs at the end (timeout). Pre-existing. |
| `session-264-editor-render` | hangs after 10 subtests | Same stall on the baseline. |
| `seo-walkthrough` | 3 | Pre-existing. |
| `session-244` | 2 | Pre-existing. |
| `session-250-batch-pipeline` | 5 | Pre-existing (same five names on baseline). |
| `session-261-browser-offload` | 4 | Pre-existing. |
| `session-262-load-balancing` | 5 | Pre-existing. |

None of these failures is in a test this section touched, and none failed for a reason in this change. They are real but unrelated to this work, and they should be picked up separately.

### 28.8 Small print and judgement calls

- **No real browser was available** (no Chromium, no playwright-core in devDependencies), so everything was verified in JSDOM. The Delete Video button's look is checked against the CSS rules, not in a rendered page. Please look at it once in a browser.
- **Only rows that finish after this change keep their media across a reload.** A row that finished before it, with no IndexedDB copy, comes back as a record and can be generated again. That is the intended fallback.
- **The `_recoveringMedia` gate blocks Generate on a restored row for a moment** (one tick plus the IndexedDB read). That is deliberate: without it a run could start while old media is being put back.
- **`npm test` does not finish in this sandbox**: `deep-debug-regressions` and `session-264-editor-render` stall on the untouched commit too. The per-file loop above is the reliable check.
- The keyword limit is three, as the user asked. It is tighter than the earlier five-word rule (§25 and §275), and `system-rules.md` has been updated to match.
