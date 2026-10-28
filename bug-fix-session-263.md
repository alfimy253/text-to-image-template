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
