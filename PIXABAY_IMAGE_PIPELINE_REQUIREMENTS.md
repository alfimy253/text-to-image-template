# Pixabay image pipelines and retry requirements

This file records the image-flow behavior traced from the implementation and the retry contract that must remain true in both studio layouts.

## Shared provider path (updated: browser-first)

> **Change of decision.** The earlier rule ("the browser must never call
> `pixabay.com` and must never receive the key") has been superseded by an
> explicit product decision: image fetching starts in the browser UI. See
> [`IMAGE_FETCH_BROWSER_MIGRATION.md`](IMAGE_FETCH_BROWSER_MIGRATION.md).

The layouts use different browser orchestration, and both now fetch media in the
page first:

```text
studioPixabayDirect.scene            (src/client/pixabay-direct.ts)
  -> GET /api/media/config           (provider origin + key + limits)
  -> POST /api/media/claim           (reserve import units)
  -> browser searchPixabay-equivalent request to pixabay.com/api/
  -> normalize/validate hits with the same rules as src/modules/pixabay.ts
  -> choose hit in the page
  -> browser download from cdn.pixabay.com
  -> validate size, MIME and signatures
  -> POST /api/media/settle          (refund granted - delivered)
```

`src/modules/pixabay.ts` (`searchPixabay`, `downloadPixabay`,
`pixabaySceneImage`) remains the **same-origin fallback** for any scene the
browser could not read (CORS refusal, provider error, blocked CDN) and for
clients that do not negotiate `directMedia`. The Worker metadata fetch still uses
`redirect: "manual"`; the browser path re-checks the final URL after redirects.

The provider key is handed to the page by `/api/media/config` for an
authenticated or `/free` session, and is never placed in the page HTML. The
direct path can be disabled server-side with `PIXABAY_BROWSER_FETCH=0`.

## Editor layout: per-video gallery

The editor stores state in `videoProjects`, independently of Quick Batch rows.

### Initial image flow

```text
startImagePromptFlow(video)
  -> runProgressiveImagePipeline
  -> POST /api/image-prompts in small prompt chunks
  -> store visible `pixabay:{q,type,index,scene}` tokens
  -> renderImageKeywords
  -> render each image chunk
      -> binary capability: browser requestImageChunk / studioOffload.images
         -> POST /api/image per scene
         -> Worker handleImageBinary -> generateOneWithRetry
         -> runImageModel -> pixabaySceneImage -> Pixabay search + download
      -> legacy capability: POST /api/image-batch and consume its NDJSON stream
  -> insert successful results into that video's gallery by scene index
  -> finalize the flow and restore upload controls
```

A failure is attached to its scene; the editor preserves successfully imported assets. Flow finalization exposes the visible **Retry Pixabay search** control and enables uploads again.

### Required behavior for the editor Retry button

The button in the editor markup is `#va-image-retry-N`, wired to `retryImagePromptFlow(N)`.

When a usable planned keyword list exists, clicking it must:

1. Use the existing visible keyword tokens; do not call the planner or replace the terms.
2. Skip each scene already represented by the same `imagePromptFlowId` and scene index.
3. Fetch each missing scene in the browser first (`studioPixabayDirect.scene`), with one claimed import unit per scene.
4. On a browser failure, refund that unit and issue the same-origin `GET /api/media/search` + `GET /api/media/asset` fallback for that scene only.
5. Insert successful results with their original scene index, retain earlier successes, and keep failed scenes retryable.
6. Keep provider credentials out of page state and out of logs; the key is delivered only by `/api/media/config`, and the direct path must be disableable without a client deploy.

The only exception is when no usable keyword list exists (for example, the planner never produced one): the retry function may fall back to `startImagePromptFlow` to create new terms.

The retry sequence is deliberately different from the initial image-generation pipeline: the browser makes explicit same-origin search and asset requests so it can retry only missing scenes without rerunning prompt planning.

## Quick Batch table layout: independent rows

Quick Batch stores state in `batchRows`; its code intentionally does not read or write `videoProjects`.

### Row image flow

```text
Generate / runBatchRow(row)
  -> voiceover and timing
  -> runProgressiveImagePipeline
  -> POST /api/image-prompts in chunks using row script/style/frame
  -> requestBatchImages
      -> binary capability: browser requestImageChunk / studioOffload.images
         -> POST /api/image per scene
         -> Worker handleImageBinary -> same Pixabay search/download pipeline
      -> legacy capability: POST /api/image-batch and consume NDJSON
  -> retain scene indices and sort row.images
  -> validate complete scene set and two distinct Pixabay video clips
  -> decode/animate slides -> enable Actions Preview and Process Export
```

### Quick Batch recovery is not the editor Retry behavior

Quick Batch has no per-row **Retry Pixabay search** button, but client JavaScript now retries each failed Quick Batch pipeline stage silently up to seven times with a 40-second backoff before each retry (FINAL RULE). `#top-generate` remains the manual recovery action for a row whose client ladder was exhausted; it does not replace the automatic stage retries. A manual whole-row rerun can still discard earlier successful media and repeat successful work/credit usage. Do not treat the top-level Generate control as an editor retry or silently route it through `retryImagePromptFlow`.

A future table-specific scene retry must be designed against row state and row scene indices. It must not read/write `videoProjects`, and it must use the same browser-first fetch (direct attempt, refunded unit, same-scene Worker fallback).

## Failure simulation and regression expectations

The code paths are tested with deterministic fixtures; tests do not need a live Pixabay key or provider request.

- `tests/pixabay-media.test.mjs` simulates a provider redirect and verifies the metadata fetch uses the supported manual mode, rejects the redirect response, and does not request the foreign `Location`.
- `tests/pixabay-image-ui.test.mjs` simulates the editor flow stopping with visible terms, adds one earlier successful scene, then clicks the actual Retry button handler. One `/api/media/search` fails with a simulated provider/redirect error. The first click keeps other successes; a second click searches only the failed scene. Neither click re-plans terms or duplicates prior imports.
- `tests/pixabay-studio-flow.test.mjs` simulates a persistent 502 for one Quick Batch scene through the browser image-request path. The browser exhausts its bounded retries; the row has five of six scenes, including both required clips. The row must remain in error rather than becoming Actions-ready. Clearing the simulated outage and clicking the table Generate control reruns and completes the row.

## Completion invariant

A Quick Batch row must not be marked done merely because it has some images and the two required clips. Every planned scene index must have usable media before the row can animate and expose Actions. `runBatchRow` enforces this invariant before checking clip count. The editor has a different partial-success contract: keep delivered gallery assets and let its scene-specific browser Retry button fill only the gaps.


---

## RULE 35 — script notes are client-side only (2026-11-03)

> **FIXED IN CODE.** Script details (narration, keyword set, beat plan, research facts,
> timings, note state and the success payload) are **never written to Cloudflare KV**. The
> durable copy is the browser's `localStorage["ytvs.script-notes.v1"]` full note plus the
> compact `ytvs_note` cookie mirror, reconciled by digest + timestamp + script-length checks
> (`src/client/script-notes-client.ts`). The Worker keeps only an ephemeral per-isolate memory
> copy (`src/modules/script-notes.ts`: 0 KV reads / 0 KV writes). The script route writes no
> credit KV record, `?async=1` degrades to a synchronous response, and capabilities advertise
> `asyncScript: 0`, `scriptNoteKvWrites: 0`,
> `scriptNoteConsistency: "digest+timestamp+scriptLength"`.
>
> Canonical specification: [RULE-35-client-side-script-notes.md](RULE-35-client-side-script-notes.md)
> · Normative rule: `system-rules.md` RULE 35 · Verification:
> `tests/script-note-client-only.test.mjs` (12/12). Any older KV-note statement in this
> document is superseded and void.

---

## FINAL RULE — QUICK BATCH TABLE LAYOUT (2026-11-04)

This is the final, code-backed rule for the **Quick Batch table layout** and the **shared Editor media pipeline**. It supersedes every older Markdown/session note about one-request tables, Worker-owned media retries, variable scene totals, separate Preview/Export columns, or row script buttons.

1. Client JavaScript owns retries for every failed **non-media** pipeline stage in this layout: voice, scene plan / prompts and animation. One initial attempt is followed by at most **7 retries** (8 total attempts); every retry waits **40 seconds** first. Only the failed stage is reset and repeated. Earlier successful stages are kept; there is no whole-row restart and no duplicate paid batch.
2. **Image and video imports are the exception in BOTH layouts.** Only the individually failed photo or clip is retried from client JavaScript, using the same 7-retry / 40-second ladder per item. Successful media, object URLs and recorded filenames are preserved. There is no whole-stage, whole-batch or whole-row media restart, and a failed stage-level retry must not revoke a successful image.
3. Every automatic video in **both** the Editor and Quick Batch table plans exactly **12 Pixabay scenes for every script length and duration**: **4 silent videos + 8 photos**. Scene planning and Pixabay searches always target those same 12 results (8 image results and 4 video results). Client JS records the filename of every selected scene and rejects duplicate filenames in one video; alternate Pixabay result indexes/pages are searched for the failed item so no similar image repeats in one video. A duplicate or missing scene is retried individually and must not strand the row.
4. Retries are silent. The row keeps its script textarea, working stage label and `.va-spinner` continuously; no error, retry, attempt, warning or abort wording is painted in the table UI. After an exhausted ladder the row returns silently to `ready`.
5. A missing scene plan must be retried by client JS, and the row must continue to the next pipeline once a plan arrives.
6. In the **Editor layout**, the script textbox is pinned while script writing/retries run: no state paint, toggle or accordion renumber may hide it over time.
7. The **last table column is `Actions`** with icons for **Preview** (same existing function), **Process Export** and **Edit**. Edit opens a new page with a **transition-only project JSON** payload carrying the row's basic settings from `batchProjectJson()`; `applyTransitionProject()` consumes it for the transition only. The rows have **no AI enhancer button**.
8. `src/client/app-js.ts` is the source of truth. `AUTO_MEDIA_TOTAL = 12`, `AUTO_VIDEO_SCENES = 4`, `AUTO_IMAGE_SCENES = 8`, `MEDIA_ITEM_MAX_RETRIES = 7`, `MEDIA_ITEM_RETRY_BACKOFF_MS = 40000`, `retryFailedMediaOnly()`, `requestBatchImagesWithIndividualRetries()`, `runEditorMediaWithIndividualRetries()`, `batchActionCell()`, `batchProjectJson()` and `applyTransitionProject()` define the live contract. Worker capabilities advertise `mediaSceneCap: 12`, `mediaVideoScenes: 4`, `mediaImageScenes: 8`, `mediaItemRetryOwner: "browser"`, `mediaItemRetries: 7`, `mediaItemRetryBackoffMs: 40000`, `mediaFilenameDedupe: "per-video"` and `quickBatchActionsColumn: "preview-process-export-edit"`. `BATCH_PIPELINE_MAX_RETRIES = 7` and `BATCH_PIPELINE_RETRY_BACKOFF_MS = 40000` still govern the non-media stage ladder. Older Quick Batch table statements in this file are superseded wherever they conflict.
