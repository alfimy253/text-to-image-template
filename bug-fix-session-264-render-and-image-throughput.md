# Session #264 — editor-layout export hangs, and image throughput

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

Two reports, one investigation:

> "the editor layout videos failed video processing, it did not finish rendering the video"
> "the image generation is too slow"

Everything below was reproduced first (a JSDOM/`vm` harness that runs the real
`APP_JS` and the real `generateMP4()` against a recording canvas, stubbed
WebCodecs and a stubbed `<video>`), then fixed, then pinned by tests in
`tests/session-264-editor-render.test.mjs`.

## 1. Why the editor export never finished

`generateMP4()` advanced every MP4 slide by awaiting
`video.requestVideoFrameCallback()` **once per output frame**. That callback is
only delivered while the browser really composites the element, and every clip
the studio owns is detached:

- the editor layout builds its clip with `document.createElement("video")`
  while probing the upload and never attaches it (the card renders its own
  `<video>`);
- the legacy gallery lives in a `display:none` panel;
- a background/throttled tab presents no frames at all;
- a rejected `play()` (autoplay policy) leaves the element paused, and the old
  `prepareClip()` only `console.error`ed the rejection.

In all four cases the callback never fired, the `await` never settled, and
nothing had a deadline. The status line froze on the last
"Completed image N of M", `project.status` stayed `"rendering"` forever, no
alert appeared, and the bulk queue behind that project never started. Three
other values did the same thing by a different route:

| input | old behaviour |
| --- | --- |
| `duration === Infinity` (fragmented / MediaRecorder MP4) | `framesForSlide()` → Infinity → `for (f = 0; f < frames; f++)` never ends |
| `duration === NaN` (unreadable clip) | `framesForSlide()` → `NaN` → the slide renders zero frames, `TOTAL_FRAMES` becomes `NaN` |
| clip with no decoded frame yet | `drawImage(video, …)` throws `InvalidStateError` → the whole export aborts with "Video rendering failed" |

### Fixes

1. **Bounded capture with two modes** (`src/client/app-js.ts`).
   `nextClipFrame()` now races `requestVideoFrameCallback` against a 500 ms
   deadline and reports whether a frame really arrived; when it does not, that
   slide switches to deterministic seek-based capture
   (`captureClipFrameAt()` → `seekClipTo()` → `drawImage`) for the rest of the
   clip. Seeking and drawing work on hidden/detached elements and do not depend
   on wall-clock speed, the compositor or the tab being visible.
2. **`prepareClip()` returns a boolean** and awaits `waitForClipFrame()`
   (bounded at 4 s) instead of relying on `play()` succeeding.
3. **Clips are mounted for the export.** `mountClipForCapture()` parks a clip
   that is not composited (detached, or in a `display:none` panel) in an
   invisible off-viewport host for the duration of the render, so the fast
   real-time playback path works again; the `finally` block puts every clip
   back exactly where it was. The host is deliberately *not* `display:none`,
   which would stop presentation too.
4. **`slideDurationSec()` is hardened** — non-finite/`<= 0` falls back to the
   still-image length and everything is clamped to `MP4_MAX_DURATION_S`. Slides
   are therefore always a finite, bounded number of frames.
5. **One-frame slides no longer divide by zero** (`p = f / Math.max(1, frames - 1)`),
   closing `bug-audit.md` finding #9.
6. **`drawImage()` is guarded** by `drawableSlideSource()`; a clip with no
   decoded frame renders blank instead of failing the export.
7. **The encoder is watched**: `waitForEncoder()` throws on `encoderError`, a
   closed encoder, or a 15 s stall; `videoEncoder.flush()` is raced against a
   180 s deadline (with the timer always cleared). A dead encoder now reports an
   error instead of spinning.
8. **The upload probe can no longer hang the accordion.**
   `probeMp4Duration()` attaches the probe off-screen (some browsers refuse to
   load a detached video), gives metadata a 15 s deadline, resolves the
   `Infinity` case the standard way (seek past the end, read the duration the
   element settles on) and rewinds to 0, and rejects with an actionable message
   when the container is unusable. Both upload paths (editor accordion and the
   dashboard "Create" restore) use it. Before this, a clip that fired neither
   `loadedmetadata` nor `error` left the upload promise pending forever — the
   clip never appeared and Generate looked like it did nothing.
9. **`play()` rejections are swallowed** when the export resumes clip previews
   afterwards (they surface as unhandled rejections, not as `try/catch`).

## 2. Why image generation felt serial

Four separate causes, each measured in the harness:

1. **A failed capability probe was cached for the whole session.** The first
   `/api/pipeline-capabilities` call runs while the page boots and was given
   5 s. A cold start or a flaky connection rejected it, the empty answer was
   memoised, and every later image/script/voiceover request silently used the
   legacy base64 + NDJSON path — several times slower than the binary path.
   A *definitive* old-server answer is still cached forever (the 261 contract is
   asked once); a *failed probe* is now dropped and re-negotiated, with a 3 s
   guard so a burst of callers cannot stampede the route.
2. **A cancelled `/image/gen` kept its queue slot and its paid inference.**
   The browser's `AbortSignal` was never forwarded to `runImageModel()`, so a
   closed tab or a cancelled submission held a shared image-queue slot for up to
   `IMAGE_ATTEMPT_TIMEOUT_MS` (75 s) *and* paid for the fallback ladder. The
   batch route already forwarded it; the single-image route now does too.
3. **The browser was the narrowest pipe.** `limits()` (3 on a capable device, 1
   when the tab is hidden or memory is tight) is the budget for heavy media —
   voiceover chunks, renders, decodes — and it was also the ceiling for
   `/api/image`, a 1 MB response the page never decodes on the main thread.
   Three batch rows render at once, each asking for three images: nine requests
   ready to go, three ever in flight. Images now get a *negotiated* ceiling
   (`imageSlots`, advertised by `/api/pipeline-capabilities`), defaulting to the
   documented adaptive limit when the field is absent. `limits()` itself and
   every other media job are unchanged.
4. **Every row waited for its slowest three images.** The progressive pipeline
   rendered one 3-scene chunk at a time. It now accepts `parallelRenders`, and
   the quick-batch table opts into two chunks when the Worker advertises
   `imageChunks`, so a ten-scene row keeps up to six images busy instead of
   idling four times. Prompt batches still stay at three scenes (the server's
   `batch.count <= 3` contract), offsets still advance by the accepted count,
   retries still never re-render a paid batch, and already-started images are
   still drained before an error surfaces. The editor accordion flow keeps
   `parallelRenders = 1` on purpose: its images become ordered slides, and
   out-of-order insertion would reorder the video.

The per-row 3-per-3 s server pacing, the shared load governor (start 3,
`+1` per 4 successes, ceiling 6, halved on overload), `IMAGE_DAILY_LIMIT`, and
the 20-image ceiling are all untouched. No new limits, counters or KV keys.

## Tests

`tests/session-264-editor-render.test.mjs` (10 cases):

- a clip that never presents frames finishes the export instead of hanging;
- an autoplay-rejected clip is captured by seeking;
- `duration: Infinity` cannot make the frame loop unbounded;
- a visible clip still uses real-time playback capture;
- a detached clip is mounted during the render and put back afterwards;
- the probe resolves `Infinity` to the real length, rewinds to 0, and rejects
  (instead of hanging) on an undecodable file;
- a failed capability probe is retried, while a definitive old-server answer is
  cached;
- a cancelled `/image/gen` spends exactly one model call.

`npm test` → **202/202**. `npx tsc --noEmit` → 30 errors, identical to the
pre-change baseline. `npx wrangler deploy --dry-run` succeeds.


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
