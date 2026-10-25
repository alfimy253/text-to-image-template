# Quick batch table — functionality, hanging-code audit and system requirements

Session #243 companion document. It explains how the **Quick batch table** (`#view-table`,
"Table" view of the studio) actually works, records the **leftover code this audit found and what
was done with it**, and states the **system requirements** the table depends on. Canonical rules
stay in `system-rules.md` RULE 25 (quick batch table) and RULE 22 (two views, one state). RULE 25 was
re-verified against the code by the Session #211 second pass, which added the Resolution and
Orientation columns, the three-lane run and the finished-row skip (`toberesolved.md` B1-B11).

---

## 1. What the table is

The studio has two views over the same state: the **Quick batch table** (`#view-table`) and the
**Editor** (`#view-editor`, the `Video N` accordions). The switch is `#layout-table` /
`#layout-editor` (`.view-switch-btn[data-layout]`) → `setStudioLayout("table" | "editor")`, which
only toggles the `active` class (`.view { display:none }` / `.view.active { display:block }`).
The choice is **memory only** — a reload always starts in the Editor, and RULE 15 forbids client
storage.

The table is a spreadsheet where **one row is one finished video** and nothing is posted to a
render endpoint:

| Column | Cell | Notes |
| --- | --- | --- |
| Script | `<textarea data-batch-field="script">` | plain narration text, typed or pasted; a row without one is skipped |
| Video style | `<select data-batch-field="style">` | the same ten styles as the script walkthrough (`SEO_IMAGE_STYLES`), default **Cinematic Film** |
| Min | `<input type="number" min="1" max="6">` | target length in minutes, default **1** |
| Resolution | `<select data-batch-field="resolution">` | 480 / 540 / 720 / 1024 px **long edge**, default **1024**; the live hint under it shows the pixels (`W×H`) | 
| Orientation | `<select data-batch-field="orientation">` | Square 1:1 / Landscape 16:9 / Portrait 9:16, default **landscape** |
| Preview | `Preview Here` → **▶ Preview** | plain text until the row is finished, then a live button |
| Export | `Export Video` → **⬇ Export Video** | same gate; both cells are rewritten from one flag, so they always unlock together |
| ✕ | `batch-row-del` | removes the row and revokes its object URLs |

Toolbar: **＋ Add Row** (≤ `BATCH_ROW_LIMIT` = 10 rows) and **✦ Generate** (`#batch-generate`),
whose label carries the runnable row count. Pressing Generate **while a run is busy stops the
run** (`stopBatchRows()` marks `row.stopRequested` then aborts each row's `AbortController`) —
one control, no second button.

**Layout (Session #244):** `.batch-table-edit` is `table-layout: fixed` with a `min-width` inside
`.table-scroll`, and `.batch-row-status` wraps (`overflow-wrap: anywhere`). The seven percentage
columns therefore keep their widths while rows process; before this, one long status line or a
wide `<select>` let the browser re-measure the auto layout and shove the other columns sideways
mid-run.

**Timeouts (Session #244):** `batchFetch()` still caps a request at `BATCH_REQUEST_TIMEOUT_MS`
(240 s; the image batch gets 480 s) but reports its own timeout as a `TimeoutError` instead of
the browser's abort wording, and `batchReadChunk()` gives every NDJSON read an idle budget of
`BATCH_STREAM_IDLE_TIMEOUT_MS` = 90 s (a stalled stream is cancelled and retried) so a row can
never sit on "Rendering the AI images" forever.

The retry policy is published as `window.__BATCH_RETRY = {attempts, baseMs, maxMs}` so tests can
shorten the backoff; `window.__BATCH_ROWS` remains the live row array.

### Row pipeline (`runBatchRow`, three rows at a time since Session #211)

| Stage (`row.stage`) | Call | Result |
| --- | --- | --- |
| `voice` | `POST /api/voiceover {text, lang:"en"}` | MP3 blob → `row.mp3`, `row.mp3Url` |
| `timing` | `decodeBatchAudio(row, blob)` | `row.audio` (duration) + `row.subtitles` from the script |
| `prompts` | `POST /api/image-prompts {topic, minutes, style, resolution, orientation, script}` | `row.prompts` — 10 / 14 / 20 prompts by length, each written for the row's frame |
| `images` | `POST /api/image-batch {prompts, resolution, orientation}` (NDJSON stream) | `row.images` + one object URL per image, rendered at the row's frame |
| `animate` | `buildBatchSlides(row)` | `row.slides`, `row.animated = true` |
| `done` | — | `batchRowFinished(row)` true → Preview + Export unlock |
| `retry` | any step | **Silent, in-row.** `batchRunStep()` retries the failed step up to `BATCH_STEP_ATTEMPTS` = 4 times (backoff 0.8 / 1.6 / 3.2 s, capped at `BATCH_RETRY_MAX_MS` = 4 s). Nothing about the failure reaches the screen: the row keeps its normal stage label and paints the editor's script-section animation (`.va-spinner` + `va-loading-pulse`). Object URLs made by the failed attempt are revoked before the retry. |
| `ready` | after the last attempt | `row.error = ""` and `row.stage = "ready"` — no error text, no warning colour, no toast; the row is simply pending again for the next ✦ Generate. Aborts and timeouts are classified (`batchIsAbortError`) and are never rendered; a user Stop is reported as a stop. |

`batchRowFinished(row)` is the single definition of "finished": `row.mp3 && row.images.length &&
row.animated && row.slides.length`.

**Preview** opens a modal player (`#batch-preview-modal`, canvas + audio, rAF driven) and never
touches the Editor. **Export** calls the studio's own in-browser renderer
(`await generateMP4()` → `window.__lastRenderBlob` → `downloadBatchBlob`) and downloads
`YouTubeVibeStudio_Row<id>_<slug>.mp4`. `tests/quick-batch-table.test.mjs` asserts the export path
contains no `fetch(` and that `/api/render` is never called.

Rows are **independent of the accordions**: the table never reads or writes `videoProjects`, so
the Editor's own counters (`#concept-count`, `#preview-state`) are refreshed by
`renderBatchTable()` but the two lanes do not share assets.

---

## 2. Hanging-code audit (the "bulk grid" leftovers)

The previous sessions replaced the read-only **bulk grid** with this editable table. The audit
below is what was still lying around, and what was done about it.

| # | Finding | Status |
| --- | --- | --- |
| 1 | **Dead bulk-grid CSS**: `.bulk-panel`, `.bulk-panel-header`, `.bulk-panel-title`, `.bulk-arrow`, `.bulk-slot`, `.bulk-slot-top`, `.bulk-slot-name`, `.bulk-status`, `.bulk-summary`, `.bulk-slot-actions`, `.bulk-caption-wrap` (base block + five theme overrides) matched **no element in `markup.ts` and no code in `app-js.ts`**. | **Removed** from `src/client/styles.ts` (base rules + `html[data-theme]` / `html[data-theme="strata"]` selectors). `tests/studio-ui-session-243.test.mjs` now fails if any of those selectors come back. |
| 2 | **Dead batch-grid class names** `.batch-index`, `.batch-title`, `.batch-sub`, `.batch-badge`, `.batch-open` were already deleted from CSS; only a comment referenced them. | Comment kept as a "do not re-add" note; no code left. |
| 3 | **`#view-switch` / `#layout-table` / `#layout-editor` / `#top-generate` / `#action-hint`** look "unreferenced" to a static grep because they are wired through `data-layout` attributes and inline `onclick`, not through `getElementById`. | **Verified working**: `bindStudioShell()` binds every `[data-layout]` button to `setStudioLayout()`, which toggles `.view.active` and `aria-selected`. No orphan. |
| 4 | **`bulk-toggle` class on the ＋ Add Video button** (legacy name from the bulk-grid era) and `#bulk-banner` ("Bulk generation is in progress…") used by `renderAllVideos()`. | **Kept** — both are live; only the name is historical. Renaming would touch theme CSS for no behaviour change. |
| 5 | **`☁️ API` button + `apiRenderVideo()` module (MODULE 7)** — the per-video render-API flow. Per this session's instruction the **visual button is removed** (the header slot now holds **Delete Video**) and the JS was deliberately **left in place**, unreachable from the UI. It still serves the background-worker mode (`workerRunJob` in `config-page-js.ts`) and `renderVideoLocally()` is shared with it. | Button removed; JS kept (documented in the table above of §4). |
| 6 | **Caption plumbing** (`addVaCaptionRow`, `vaCaptionRowHTML`, `swapVaCaptionsIn/Out`) after the Captions section was dropped from the accordions (RULE 24) — the rows are the render engine's hidden working state. | **Kept** and still used by the renderer/`prepareVideo()`; not dead, but it is the one place where "empty by design" is normal. |
| 7 | **Row fields** — audited all of `mp3Url`, `subtitles`, `objectUrls`, `prompts`, `slides`, `animated`, `startedAt`, `finishedAt`, `detail`, `error`, `controller`, `audio`, `mp3`, `images`, `stage` (plus `resolution`, `orientation`, `running` since Session #211): every one is written **and** read. | No dead fields, no half-implemented "bulk" column. |
| 8 | **`window.__BATCH_ROWS`** test hook. | Live and documented; `window.__VIDEO_PROJECTS` was added in the same style for the accordion tests. |

The one genuine "unfinished because the previous session ran out of budget" item was **#1**: a
complete visual layer for a UI that no longer exists (11 class families × 5 themes). It was pure
payload with zero behaviour, so it is now gone.

---

## 3. System requirements

### 3.1 Runtime / bindings (server side)

| Requirement | Value | Why |
| --- | --- | --- |
| Cloudflare Worker with **`ai` binding** (`AI`) | required | `/api/voiceover`, `/api/image-prompts`, `/api/image-batch`, `/api/script`, `/api/seo-plan` |
| **`kv_namespaces` → `KV_BINDING`** | required for credits/accounts | without KV the app runs unmetered and account routes answer `503`; the table itself still works |
| Image model | `@cf/stabilityai/stable-diffusion-xl-base-1.0`, 20 steps, at the row's frame (default 1024×576 landscape; other sizes come from the Resolution/Orientation columns, short edge rounded to a multiple of 8) | `src/modules/image-batch.ts` |
| TTS model | `@cf/myshell-ai/melotts` + free fallback URL | `/api/voiceover`, 8,000 chars, chunked at 500 |
| Text model | `@cf/meta/llama-3.1-8b-instruct-fp8` (+ `llama-3.3-70b-instruct-fp8-fast` planner fallback) | `/api/image-prompts`, `/api/seo-plan`, `/api/script` |
| Route surface used by the table | `POST /api/voiceover`, `POST /api/image-prompts`, `POST /api/image-batch` | no job URL, no polling, no `/api/render` |

### 3.2 Browser requirements (client side)

| Requirement | Minimum | Why |
| --- | --- | --- |
| **WebCodecs** `VideoEncoder` (H.264) + `AudioEncoder` (AAC) | Chrome/Edge 94+, or any browser with WebCodecs | Export renders the row in-browser via `generateMP4()` + `mp4-muxer` |
| File System Access API | optional | Chrome/Edge stream the MP4 to disk; other browsers build it in memory |
| `AbortController` | required | per-row request timeouts and the Stop behaviour |
| `fetch` + `ReadableStream` reading (`response.body.getReader()`) | required | `/api/image-batch` is `application/x-ndjson` |
| `URL.createObjectURL` / `revokeObjectURL` | required | row images, MP3, preview |
| `requestAnimationFrame`, `<canvas>`, `<audio>` | required | Preview player and slide animation |
| `File`, `Blob`, `Image`, `createImageBitmap`/`HTMLImageElement` decode | required | slides are built from decoded images |
| Memory | grows with rows: ~10 rows × 10–20 images at up to 1024 px long edge (and up to 3 rows generating at once) | images stay in memory as blobs + object URLs until the row is removed |

### 3.3 Limits and timeouts (constants)

| Constant | Value | File |
| --- | --- | --- |
| `BATCH_ROW_LIMIT` | 10 rows (`= VIDEO_MAX_VIDEOS`) | `app-js.ts` |
| `BATCH_MIN_MINUTES` / `BATCH_MAX_MINUTES` | 1 / 6 | `app-js.ts` |
| `BATCH_REQUEST_TIMEOUT_MS` | 240 s (image batch: ×2 = 480 s) | `app-js.ts` |
| `BATCH_SLIDE_DECODE_MS` | 10 s per image decode | `app-js.ts` |
| `BATCH_RUN_CONCURRENCY` | 3 rows in flight at once | `app-js.ts` |
| `BATCH_RESOLUTIONS` / `BATCH_DEFAULT_RESOLUTION` | `[480, 540, 720, 1024]` / `1024` (long edge, px) | `app-js.ts` + `src/modules/image-batch.ts` |
| `BATCH_ORIENTATIONS` / `BATCH_DEFAULT_ORIENTATION` | `square \| landscape \| portrait` / `landscape` | `app-js.ts` |
| `IMAGE_BATCH_CONCURRENCY` | 4 images in parallel inside one request | `src/modules/image-batch.ts` |
| `IMAGE_BATCH_MAX_PROMPTS` | 20 per request | `src/modules/image-batch.ts` |
| Prompt count by length | 1 min → 10, 2–3 min → 14, 4–6 min → 20 | `src/modules/image-prompts.ts` |
| Voiceover | 8,000 characters, chunked at 500 | `src/index.ts` |
| AI images per day | 50 free · 1,200 paid · 10 guest/IP | README limits table |

### 3.4 Behavioural requirements

1. **Three rows at a time + pipelined advancement** (`BATCH_RUN_CONCURRENCY = 3`, Session #248).
   Initial processing starts up to 3 rows simultaneously. When any running row moves in the pipeline
   to the next step of processing (specifically `images` / image generation), `startUnprocessedRows()`
   starts the next unprocessed row from the queue immediately. The 4th and subsequent rows do not
   wait for earlier rows to reach `done`; all scripted rows process through the pipeline without
   requiring the user to click Generate again.
1a. **A finished row is never processed again.** The queue is
   `batchRowPending(row)` = has a script **and** `!batchRowFinished(row)` **and** `!row.running`, so
   rows whose Preview/Export buttons are already live are skipped; with nothing pending the table
   says so instead of starting a run. A failed row is pending again and is retried.
2. **A failed row fails alone**: it shows `⚠ <reason>` in its own status cell, keeps its text
   cells editable, and its Preview/Export cells stay plain text (no dead buttons).
3. **Preview and Export unlock together**, only when `batchRowFinished(row)` is true.
4. **Export never touches the network** — it reuses the Editor's renderer with
   `renderContext.batchRow = true`.
5. **The table must not disturb the Editor**: it never writes `videoProjects`; it only refreshes
   the shared counters.
6. **Rows survive editing**: `renderBatchTable()` rebuilds `<tbody>` only when the row *signature*
   (ids) changes, otherwise it patches status/action cells, so typing is never interrupted.
7. **Delete is real**: `removeBatchRow()` revokes every object URL of that row before splicing it.
8. **Two views, one state**: switching views must never reset a row or an accordion.

---

## 4. Verification

| Suite | Guards |
| --- | --- |
| `tests/quick-batch-table.test.mjs` | editable rows, three-lane generate, the finished-row skip, the resolution/orientation payloads (client + worker frame maths), per-row failure isolation, Preview+Export unlock together, export is client-side (`no /api/render`) |
| `tests/studio-ui-session-243.test.mjs` | no sticker section / no API button / Delete Video present; delete renumbers the accordion stack and keeps state; CSS proportions; **no `.bulk-*` selectors left** |
| `tests/seo-plan-resilience.test.mjs` | planner retry/fallback/partial-plan contract (see `script-keyword-retry-debug.md`) |
| `tests/session-248.test.mjs` | staggered pipelining queue advancement, 5-row voiceover concurrency cap, stop semantics, single row completion to `done`, no infinite re-queueing of failed rows |

`npm test` → **95 tests, 95 pass**.
