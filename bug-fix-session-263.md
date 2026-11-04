# Bug fix #263 — "the video finished with 3 images" (and why the flow sometimes never reached the images at all)

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

**Date:** 2026-10-26 · **Scope:** browser image flow (`requestImageChunk`), prompt-chunk failure
contract (`POST /api/image-prompts`), Quick Batch + editor integration · **Status:** implemented and
locally tested; **not deployed**.

Keeps every #262 decision: **3 images per 3 s per row** pacing, **10,000 images/day** for free, paid
and anonymous visitors, adaptive concurrency + request backoff instead of throttles. No new quota,
no new limit and no new counter was added by this fix.

## What was reported

> "There's a bug — the video finishes with 3 images only. Maybe it's server load management, I'm not
> sure how this happened… and the image processing is really slow / not proceeding."

## Root causes found

| # | Symptom | Root cause |
| --- | --- | --- |
| 1 | A 10-scene video "finishes" with exactly **3** images | `runProgressiveImagePipeline()` renders in chunks of 3, and each chunk was requested **exactly once** (`studioOffload.images(...)`, no retry). If every scene of chunk 2 hit a transient 5xx/overload, `requestBatchImages()` threw, `render()` set the flow's stop reason and `finalizeImagePromptFlow()` ended the row — with the three images of chunk 1 already in the gallery. |
| 2 | The flow stops before any image arrives | A prompt chunk that failed answered a blanket **502** with no `kind`, no `retryAfterMs` and no `Retry-After`, so the browser could not tell "the fleet is busy, wait" from "this request is invalid". Its retries were fixed `500 ms, 1000 ms` — shorter than any fleet cooldown — and a 4xx-shaped answer was retried anyway. |
| 3 | Same failure, opposite mistake | The client treated **429** (a load answer) as permanent: `status >= 400 && status < 500` won over `retryable`. One rate-limited scene therefore ended the whole chunk. |
| 4 | The prompt model answering "no new scenes" killed the video | The pipeline treated the empty/duplicate answer (a model result, not a load failure) as retryable, spent two more inferences on the same request and then threw — discarding a video that could have been finished with the images it already had. |
| 5 | Prompt-side overload did not slow images down | `handleGenerateImagePrompts()` classified failures but never fed the shared governor, so a busy **text** fleet did not arm the isolate cooldown that image calls already respect. |

## Changes

### 1 — `requestImageChunk()` in `src/client/app-js.ts` (new, ~8310)

One chunk of binary images with bounded, load-aware retries:

- already-delivered scenes are **never** re-requested (no duplicate gallery slots, no double billing,
  no replay of an ambiguous paid image — RULE 30 / #261);
- only the scenes that failed are asked again, up to 3 rounds;
- the wait is the server's `retryAfterMs` hint when present,
  otherwise `min(800 * 2^(round-1), 15000)` ms — jitter-free per round but staggered per chunk, so a
  burst of rows does not retry in lockstep;
- permanent answers (`400/401/403/404/422`, or `error.retryable === false`) are never retried;
  `429` and `408` **are** retried, because they mean "come back in a moment";
- `onImage(blob, index)` always receives the **original** prompt index, even for a retried subset
  (`gallery slots and scene numbers depend on it`), and every returned result carries its scene
  index, not the slot inside the retry round;
- a cancellation leaves holes that are reported as `AbortError` failures, never as successes;
- the retry wait itself is cancellable (`pauseWhileActive`, 250 ms slices) and the media scheduler
  now wakes at least every 250 ms while a `Retry-After` hold is pending. Before, a 20 s hold had no
  re-check, so a stopped row looked "stuck generating" for the whole window.

Used by both call sites: Quick Batch (`requestBatchImages`, ~8390) and the editor
(`runBinaryEditorImages`, ~18000). `window.__REQUEST_IMAGE_CHUNK` exposes it for tests.

### 2 — `POST /api/image-prompts` answers load like the image route (`src/modules/image-prompts.ts`)

- `sharedImageLoadGovernor.observeFailure(error)` classifies the failure **and** arms the
  isolate-wide cooldown, so a text-fleet overload slows the next image call too;
- **overload → `503` + `Retry-After` + `{kind:"overload", retryAfterMs, code:"IMAGE_PROMPT_MODEL_FAILED", prompts:[]}`**;
  everything else stays `502`; an aborted request is classified `transient` and never poisons the
  governor;
- the hint is the provider's `Retry-After` when given, else the live governor cooldown floored at
  1 s;
- unchanged: `batch.count` 1–3, `batch.attempt` 0–2, exactly ONE inference per attempt, and
  validation before any paid call (a bad body is still a `400`, never a `502`).

### 3 — The browser keeps the server's load answer (`src/client/app-js.ts`)

The three prompt-chunk call sites now attach `status`, `kind` and `retryAfterMs` to the thrown
error; the legacy NDJSON fallback does the same for `/api/image-batch`. `requestNext()` in
`progressive-image-pipeline.ts` uses them:

- waits `min(max(hint, 800 * 2^attempt * jitter), 15000)` ms instead of `500 * (attempt + 1)`;
- treats `4xx` (except `429`/`408`) as permanent;
- treats "the model returned no new scene prompts" as **permanent**, so the video finishes with the
  images it already has instead of burning two more inferences and then failing.

### 4 — Pacing constants are derived, not duplicated (`src/modules/image-batch.ts`)

`IMAGE_BATCH_CONCURRENCY` and `IMAGE_BATCH_WAVE_INTERVAL_MS` now read
`DEFAULT_GROUP_IMAGE_CONCURRENCY` / `DEFAULT_GROUP_WINDOW_MS` from `image-queue.ts`. Before, the
per-request wave and the queue's own group budget were two independent `3`s that could drift apart —
the same class of bug as "the row finished early". **Values are unchanged: 3 images per 3 s.**

## What was explicitly *not* changed

- **Pacing:** still 3 images per 3 s per row (`IMAGE_BATCH_CONCURRENCY = 3`,
  `IMAGE_BATCH_WAVE_INTERVAL_MS = 3000`, `IMAGE_BATCH_MIN_COOLDOWN_MS = 250`).
- **Credits:** still one ceiling, `IMAGE_DAILY_LIMIT = 10000`, for free, paid and guest. No per-window
  quota, no per-plan split.
- **Load governor:** still starts at 3, ceiling 6, `+1` after 4 successes, halved on overload, with
  the #262 cooldown and jittered backoff. No additional global rate window was added.
- **Transport/ownership:** binary `/api/image` per scene, one credit per image, refund on failure, no
  automatic replay of a delivered image (#261), no cross-request timers (#251).

## Verification

- `tests/session-263-partial-image-flow.test.mjs` (8 tests):
  1. pacing is 3/3 s and the ceiling is 10,000/day;
  2. a failed chunk retries only its failed scenes, keeps original indices and pays once per scene;
  3. `429`/5xx are retried, `400` is not, and usable scenes still arrive;
  4. **regression:** a 503 on the second chunk of a 10-scene Quick Batch row now finishes with **10**
     images (the reported "3 images" bug), with scenes 0–2 requested exactly once;
  5. a prompt chunk overload answers `503` + `Retry-After` + `kind` + `retryAfterMs`;
  6. `batch.attempt: 3` is still rejected with `400` before any inference;
  7. **regression:** a `503` + `Retry-After` on the prompt chunk for scene 3 is waited out and the
     row still finishes with 10 images;
  8. `/api/pipeline-capabilities` still advertises the negotiated transport.
- `npm test` → **191/191 passing**; `npx tsc --noEmit` → only the 30 pre-existing `src/index.ts`
  diagnostics (unchanged baseline); `wrangler deploy --dry-run` clean.
- Local end-to-end smoke on `wrangler.accounting-e2e.jsonc` (mock AI, real local KV): `/free` 200,
  `POST /api/image` 200 `image/png`, `POST /api/image-prompts` 200 with a 3-scene batch, and
  `batch.attempt: 3` → `400`.

## Known limitations

- The retry rounds are bounded (3) and each round waits at most 15 s; a fleet that is unavailable for
  longer than that still ends the video. It now ends with **the images it already rendered** (and the
  row can be regenerated), instead of appearing to have completed at 3 images.
- `requestImageChunk()` retries at chunk granularity: 3 scenes share one round, so one stubborn scene
  can hold its two siblings for one backoff window.
- Like #262, the governor is per isolate and in memory: it is a load-shedding heuristic, not a
  fleet-wide admission controller.


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
