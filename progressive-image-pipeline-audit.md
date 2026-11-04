# Progressive image pipeline — diagnosis, implementation and rollout

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

Date: 2026-10-26

## Scope and evidence

Reviewed the editor walkthrough (`startImagePromptFlow`, `seoFetchWithTimeout`, `runImageBatch`, finalization/deletion), Quick Batch (`runBatchRow`, `batchFetch`, stream reading, Stop, row scheduling), the Worker prompt/batch routes, existing image/decode queues, and regression tests. Relevant documentation: README, `system-rules.md` RULES 24/25/28, `userflow.md` flows 6/7 and migration notes, `quick-batch-table-system-requirements.md`, and `bug-fix-session-251.md` (context/token limits, encoding, cancellation and lifecycle fixes).

This report and the progressive-flow addenda supersede the older **one prompt request → one full image stream** descriptions. The retired KV/waitUntil prompt-job architecture is NOT reintroduced.

## 1. Why the reported failure is possible

Reported editor status:

> AI image flow stopped: Image prompts could not be generated: signal is aborted without reason 0 image(s) added to the gallery. Upload Image, GIF or MP4 is enabled again.

The code establishes a reproducible failure mechanism, but production logs are needed to identify which timeout or upstream interruption caused any particular historical occurrence.

### A. Nested model retries exceed the browser's deadline

Before this change, `generateImagePrompts()` could run three primary calls, then two fallback calls if no prompts were collected. Each call had a **150-second** budget. The editor stopped waiting after **180 seconds**; Quick Batch used **240 seconds**. The server could therefore still be working after its caller had disconnected. Merely increasing the browser timeout would preserve a long blank-gallery phase rather than repair the flow.

`withTimeout()` rejects its waiting promise; it does **not** cancel the underlying Workers AI inference. A timeout is wall-clock waiting, not proof of a Worker CPU-limit violation.

### B. Large prompt output encourages truncation and repeated calls

One request asked for 12 scenes, each with three paragraphs of at least 30 words, while the primary output ceiling was 3,584 tokens. Even 20 × 90 words is already 1,800 words before JSON, style direction and longer descriptions. Partial JSON salvage was valuable, but the full-list gate still forced clients to wait for all server top-up attempts before rendering an image.

### C. Abort ownership and error reporting differ by layout

- Editor: the timeout called `controller.abort()` without classifying its cause; its error message was interpolated directly into the final status. That explains the raw browser wording. Its controller/timer also ended after headers, before JSON consumption.
- Quick Batch: `batchFetch()` already protected response-body consumption and normalized aborts. It nevertheless shared the same oversized, sequential server generation path and full-list gate. Quick Batch deliberately keeps errors out of the visible row per Session #244; diagnostics are in the console.
- Once prompt generation failed, neither path had started image rendering, so zero gallery images was expected. Restoring upload controls was correct cleanup, not the cause.

### D. A naive parallel rewrite would introduce new bugs

Simply putting prompt and image requests in `Promise.all()` would make Quick Batch's single `row.controller` slot race. Stop would cancel only whichever operation last wrote that slot. Reusing `runImageBatch()` repeatedly would overwrite, rather than accumulate, success/failure counts. Retrying an entire consumed image stream could duplicate images and charge credits again. Finalizing after the first three images would incorrectly unlock controls while later work remained active.

## 2. Implemented flow

Shared browser code: `src/client/progressive-image-pipeline.ts`, embedded into `APP_JS`.

```text
voice/script preparation (existing behavior)
  ↓
request scenes 0..2 (at most 3)
  ↓
render chunk 0 ─────────────────┐
request scenes 3..5 concurrently│
  ↓ wait for both operations ──┘
render chunk 1 ─────────────────┐
request scenes 6..8 concurrently│
  ↓                            ┘
repeat, then drain final images and finalize once
```

- Totals stay **10 / 14 / 20** for 1 / 2–3 / 4–6 minutes. Editor additionally caps its target at the gallery's free still-image slots.
- A complete 10-scene run normally makes prompt/image chunks **3 + 3 + 3 + 1**. A short model answer is accepted, and the next offset advances by the number actually accepted, not by three.
- Per video/row there is at most **one image chunk plus one prompt lookahead**. The producer cannot buffer the entire remaining video while rendering is slow.
- Historical editor prompt requests got at most three browser attempts, with 500/1,000 ms backoff. **Quick Batch table rows now follow FINAL RULE:** client JavaScript retries each failed pipeline stage seven times after a 40 s backoff, including a missing scene plan. Older one-request/three-attempt statements in this audit are superseded for that layout only.
- Both concurrent operations get rejection handlers immediately. A later prompt error does not bypass the already-started image drain. A rendering failure cancels the prompt lookahead without retrying it.
- Exact duplicate prompt strings within/across accepted chunks are rejected. Three duplicate/empty answers stop the pipeline rather than loop indefinitely. Semantic paraphrase detection is not provided.

### Stateless prompt protocol

Existing fields remain unchanged. New callers add:

```json
{
  "topic": "Morning forest",
  "minutes": 1,
  "style": "Documentary",
  "script": "...",
  "batch": {
    "offset": 3,
    "count": 3,
    "attempt": 0,
    "previous": ["brief preceding scene description"]
  }
}
```

- `count`: integer 1–3; offset/count must fit the duration-derived scene total.
- `attempt`: optional integer 0–2. Attempt 0 uses the primary model; retries use the server-allowlisted fallback. The browser cannot specify an arbitrary model slug.
- `previous`: last four string previews, clipped to 160 characters each. Instructions include the requested absolute scene range and overall total to reduce story restarts and repetitions.
- One inference per batch request; **45-second** model wait budget, **60-second** browser request/body budget. Output allowance is 600 tokens per requested scene, with the existing overall ceiling.
- Response adds `batch: {offset, requested, nextOffset}`; `expectedCount` remains the duration-derived total. `model` reports the selected model.
- Existing parsing salvage, three-paragraph/style/anti-distortion guard and 1,800-character prompt limit remain in place. Frame validation is unchanged.
- Calls without `batch` retain the legacy all-prompts response for compatibility. Thus old open tabs are not automatically migrated and can still encounter the old long wait; reload to get the new client.
- Invalid batch/body shapes fail before inference. Upstream abort wording is normalized; model failures return 502 with `code: IMAGE_PROMPT_MODEL_FAILED`.

## 3. Browser versus Worker responsibilities

| Browser owns | Worker must retain |
| --- | --- |
| Video/row lifecycle, prompt offsets and next-batch decisions | Validation and supported model selection |
| Prompt retry/backoff and one-batch lookahead | Workers AI binding calls (not CPU inference in the request's JavaScript) |
| Fair image-stream admission (existing three-stream queue) | Account/guest credit authorization, reservation and refunds |
| Decoding via existing Web Worker pool/cooperative fallback | Per-request bounded image dispatch and stream safety |
| Blob/object URL lifecycle and gallery commits | Existing image output encoding and NDJSON response |
| Subtitle timing, slides, animation, preview and MP4 export | No persistent video state, no prompt-job KV, no polling job runner |

Video assembly/export was already browser-side and remains so. No video render endpoint, server encoding job, or credential exposure is added. The Worker cannot safely delegate metering, AI bindings or authoritative refunds to an untrusted browser.

### Why this reduces pressure without a large Worker CPU requirement

The new client path asks the Worker to parse/style only up to four prompts at once and render only up to four images per image invocation. It removes nested server prompt retry/top-up loops from that path. Decoding, video processing and pipeline decisions stay on the client. Image streams are drained rather than buffering all 10–20 images in one JSON response. Existing request-local image task/CPU serializers remain defense in depth.

**This is not a claim of zero CPU or lower total image bytes.** NDJSON still base64-encodes images in the Worker (about 33% wire expansion, before JSON), and every image still incurs inference, credit and transfer work. More chunks mean more HTTP requests and credit read/write operations. CPU yielding reduces event-loop stalls, not the CPU time charged for the same encoding. Existing queue limits are per browser/request/isolate, NOT a global fleet-wide or multi-tab quota.

A future measured optimization is a binary per-image transport (or signed object-storage delivery), with browser admission limited to three images. That would remove server base64 overhead, but changes stream framing, credit reconciliation and storage/security requirements; it is intentionally not bundled into this timeout fix. Use real Worker CPU telemetry before choosing that migration.

## 4. Lifecycle and partial-result semantics

### Editor

The existing project identity + `_imageFlowSeq` checks still prevent deleted/replaced flows from committing into another video. Both prompt and image controllers are aborted on replacement/deletion. Prompt timeout ownership now includes JSON consumption. Image counters accumulate across chunks; filenames include absolute scene offsets. All chunks use one flow ID, so finalization counts every card inserted by this run. Controls unlock only after the pipeline settles, not after chunk one. A premature stream EOF without `done` is a failure; delivered images are kept.

### Quick Batch

Prompt lookahead has a separate owner (`row._promptOwner`); the image stream retains `row.controller`. Stop aborts both. The next unprocessed row is released when the first image chunk begins, preserving the three-early-lane scheduling contract. Image indices are translated from per-chunk to absolute indices and sorted within chunks, so out-of-order completion does not scramble slideshow order. Frame/style values are sent on every prompt/image request.

Prompt/image orchestration no longer runs inside a whole-step retry that could discard or replay paid images. Voiceover and slide-preparation retries retain their existing policy. If a later batch fails, usable images already delivered can still become a partial slideshow; the warning is logged, following the existing quiet-table policy. A run with no images returns to a pending state. A user Stop is never converted into partial success. Finished rows remain skipped by subsequent Generate presses.

The editor gallery retains its existing arrival-order insertion behavior within an image chunk; this change does not add drag-order/timeline semantics. Quick Batch has explicit scene-index ordering.

### Remaining operational limits

- Closing/reloading the tab loses in-memory orchestration and assets, as required by the existing no-client-storage rule. This is not a resumable background job.
- A disconnected browser cannot reliably tell whether an in-flight inference completed. The client never automatically retries an image stream, preventing duplicate paid submissions; authoritative refunds stay server-side.
- The prompt wait timeout cannot guarantee cancellation of an underlying `AI.run()`. A browser retry can overlap a slow upstream inference. There is no persistent dedupe/job table in this design.
- A model may answer short, repeat a scene semantically, or remain unavailable. Partial output is preferable to fabricating a full successful run.
- Browser stream limits do not protect against many tabs/users; production-scale admission/rate limiting is a separate server policy.
- The legacy route remains heavier for compatibility. Removing it should be a separately announced API migration.

## 5. Validation and rollout

Tests exercise the actual shared scheduler plus both UI adapters: overlap, one-lookahead backpressure, 12 totals, short batches, retry offsets, permanent errors, no replay of paid images, duplicate-output termination, partial drains, Stop cancelling both concurrent requests, server batch validation, one-inference behavior, fallback, paragraph/style/frame preservation, and timeout coverage through JSON consumption. Existing credit/refund, lifecycle/deletion, orientation/export and out-of-order tests remain active.

Validation: **`npm test` — 137 passed, 0 failed**; **`wrangler deploy --dry-run` — passed**; **`git diff --check` — passed**. The repository's strict TypeScript baseline has **30 existing diagnostics in `src/index.ts`**; a clean HEAD comparison confirms the final diagnostic output is unchanged (no new diagnostics from these changes). Consequently `npm run check` is still blocked by the baseline typecheck, although the Worker bundle dry-run succeeds independently.

Before production rollout:

1. Deploy the Worker/client bundle together and reload old tabs.
2. In DevTools, verify prompt bodies use `batch.count <= 3`; for a full one-minute run expect offsets 0, 3, 6, 9. Artificially delay prompt batch two and confirm the first images appear before it completes.
3. Check editor control cleanup on first-batch failure, later-batch failure, deletion/renumbering, and a full gallery. Check Quick Batch Stop while both request types are pending.
4. Test actual Cloudflare AI latency/error rates with 1-, 3- and 6-minute videos and portrait/square/landscape rows. Unit/DOM tests use mocked AI, not production credentials or live generation.
5. Monitor `[image-prompts]` and `[seo-image-flow]` timing/error logs, Worker CPU time and peak memory, credit balances/refunds, and prompt request counts. Wall-clock latency is not CPU time. Do not claim a measured CPU improvement without those measurements.

No production deployment was performed by this change.


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
