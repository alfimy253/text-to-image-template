# Bug Fix Session #251 — Quick Batch Table 3-stage pipeline repairs, 1,800-char style/anti-distortion guards, 3-per-3s pacing, and Node.js-style non-blocking image task queues

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

Date: 2026-10-26 · branch `arena/4b50e0b2-text-to-image-template`

## What was reported

1. *Debug and repair all three stages of the Quick Batch Table (`#view-table`) pipeline —
   Stage 1 (`POST /api/voiceover` + client audio timing), Stage 2 (`POST /api/image-prompts`),
   and Stage 3 (`POST /api/image-batch` + gallery/slide assembly) — plus table shell controls
   while preserving every `system-rules.md` invariant.*
2. *Set `IMAGE_PROMPT_MAX_CHARS = 1800`.*
3. *Instruct the system model to be extra careful in following the selected visual style without
   style drift, and enforce stronger guards against distorted images.*
4. *Make image generation produce **3 images per 3 seconds per video/row** so CPU will not break.*
5. *Use a **Node.js-like single-threaded, event-driven, non-blocking I/O task queue and
   background worker pool** for image tasks across the app so bursts of multiple tasks in a
   short time never block the main thread or overload CPU/memory.*

---

## 1 — Stage 1: Voiceover synthesis (`src/modules/voiceover.ts`, `src/index.ts`, `src/client/app-js.ts`)

### Root causes found

- **0-phoneme chunks crashed `@cf/myshell-ai/melotts` with `AiError: 3043`.** Markdown
  formatting, URLs, zero-width characters, emojis, or standalone punctuation left chunks with
  no speakable letters or digits, which MeloTTS rejects with an internal error.
- **Concatenated MP3 chunks carried duplicate ID3v2 headers.** Joining raw multi-chunk MP3
  outputs left ID3v2 metadata headers inside chunks `2..N`, causing browser WebAudio decoders
  to truncate duration or fail mid-stream.
- **Unvalidated external fallback & hung WebAudio decode.** When `FALLBACK_TTS_URL` returned an
  HTML/JSON error body (or hung), bytes could be appended into the audio stream; on the client,
  a suspended or stalled `AudioContext.decodeAudioData()` hung the row forever on
  `"Determining audio length"` (`stage = "timing"`).

### The fix

- Extracted voiceover synthesis into `src/modules/voiceover.ts` (`handleVoiceover`,
  `sanitizeVoiceoverText`, `splitVoiceoverChunks`, `stripMp3Id3Tag`, `joinVoiceoverPieces`) and
  wired `POST /api/voiceover` in `src/index.ts` to delegate to it.
- **Unicode speakable filtering (`/[\p{L}\p{N}]/u` across all 8 `VOICE_LANGS`):** strips
  URLs, markdown tokens, control/zero-width characters, lone surrogates, and standalone symbol
  runs, and re-checks every emitted chunk so 0-phoneme chunks never reach MeloTTS.
- **Bounded chunking (`VOICEOVER_CHUNK_MAX = 400` chars):** splits on sentence, clause, and word
  boundaries (`<= 400` chars), normalizes `{ audio }`, `Uint8Array`, `ArrayBuffer`,
  `ReadableStream`, and `Response` return shapes, reassembles multi-chunk `RIFF`/`WAVE`
  containers cleanly, and strips leading ID3v2 headers (`stripMp3Id3Tag`) on MP3 chunks `2..N`.
- **Sticky native Workers AI MP3 fallbacks + validated external fallback:** when English MeloTTS
  fails, falls back stickily to `@cf/deepgram/aura-2-en` and `@cf/deepgram/aura-1` before trying
  `FALLBACK_TTS_URL` under a 15 s timeout with strict audio magic-byte / `Content-Type`
  validation (rejecting HTML/JSON bodies).
- **Bounded client decode (`src/client/app-js.ts`):** `decodeBatchAudio()` calls
  `context.resume()` when suspended and races `decodeAudioData()` against
  `BATCH_AUDIO_DECODE_MS = 15000`, falling back cleanly to `row.minutes * 60000` ms if WebAudio
  stalls.

---

## 2 — Stage 2: Scene prompts, `IMAGE_PROMPT_MAX_CHARS = 1800`, strict style fidelity & anti-distortion (`src/modules/image-prompts.ts`, `src/modules/script-seo.ts`, `src/client/app-js.ts`)

### Root causes found

- **Temporal dead zone in `APP_JS`:** `SEO_IMAGE_STYLES` and `DEFAULT_SEO_IMAGE_STYLE` were
  declared thousands of lines below `MODULE 1c`, risking reference-before-initialization when
  table helpers ran early.
- **Context-window overflow & malformed LLM JSON:** requesting large `max_tokens` on 14–20
  three-paragraph prompts overflowed `@cf/meta/llama-3.1-8b-instruct-fp8`'s ~8,192-token window,
  and unescaped literal newlines/tabs or truncated JSON arrays caused `JSON.parse()` to fail
  even when complete scenes were already present.
- **Style drift & naive character slicing:** prompt instructions allowed live-action DSLR camera
  clichés to bleed into illustrated/comic/poster styles (and vice versa), lacked explicit
  anatomical/perspective composition rules, and used raw `.slice(0, maxSceneChars)` which could
  chop words mid-token or cut off Paragraph 3 when fitting under a tighter character budget.

### The fix

- **Hoisted style catalog** (`SEO_IMAGE_STYLES`, `DEFAULT_SEO_IMAGE_STYLE`) above `MODULE 1c` in
  `src/client/app-js.ts`.
- **Token budget + model fallback + JSON recovery (`src/modules/image-prompts.ts`, `src/modules/script-seo.ts`):**
  - Capped primary output budget at `IMAGE_PROMPT_MAX_TOKENS = 3584` and added
    `IMAGE_PROMPT_FALLBACK_MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]`.
  - Updated `aiText()` (both `image-prompts.ts` and `script-seo.ts`) to serialize pre-parsed
    object `response` payloads; added `repairJsonControlChars()` (escapes literal control chars
    inside JSON string literals and strips trailing commas), `salvageJsonPromptArray()` (recovers
    complete scene strings from truncated JSON arrays so retries only top up missing scenes), and
    hardened `rescuePromptList()`.
- **`IMAGE_PROMPT_MAX_CHARS = 1800` with proportional paragraph fitting:**
  - Set `IMAGE_PROMPT_MAX_CHARS = 1800` in both `src/modules/image-prompts.ts` and
    `src/modules/image-batch.ts` (`IMAGE_MODEL_PROMPT_MAX_CHARS = 1800`).
  - Added `fitParagraphsToBudget()` + `clipAtWordBoundary()` so oversized multi-paragraph prompts
    are trimmed proportionally across all paragraphs on word boundaries — keeping all 3 scene
    paragraphs plus the 4th closing `Visual style:` paragraph intact within `1,800` characters.
- **Strict style-fidelity discipline (`IMAGE_STYLE_DISCIPLINE`) & anti-distortion guard (`IMAGE_ANTI_DISTORTION_GUARD`):**
  - Added tailored medium-lock rules for every one of the 10 `IMAGE_STYLES` (`Cinematic Film`,
    `Editorial Magazine`, `Kinetic Typography`, `Neon Night`, `Minimalist`, `Retro Poster`,
    `Documentary`, `Split Composition`, `Dream Glow`, `Pop Comic`) forbidding cross-medium drift
    (e.g., banning DSLR lens clichés in `Pop Comic` / `Retro Poster` and cartoon/ink cues in
    `Documentary` / `Cinematic Film`).
  - Added `IMAGE_ANTI_DISTORTION_GUARD` in `buildImagePromptInstruction()` requiring 1–2 clearly
    separated focal subjects in grounded poses, natural human proportions, symmetrical facial
    features with aligned eyes, relaxed five-fingered hands, straight architectural lines,
    coherent single-viewpoint perspective, and solid non-merging object boundaries.
  - Reinforced both style lock and structural integrity in `enforceParagraphGuard()` and the
    closing `Visual style:` paragraph of `applyImageStyleToPrompts()`.

---

## 3 — Stage 3: Diffusion guardrails, 64 px SDXL alignment & model fallbacks (`src/modules/image-batch.ts`)

### Root causes found

- **`IMAGE_NEGATIVE_PROMPT` lacked anatomical/geometry guards:** previously it only listed text,
  CJK scripts, logos, and watermarks — nothing against deformed limbs, mutated/extra fingers,
  duplicate faces, or warped perspective.
- **Odd latent tensor crashes (`AiError: 3043`) on sub-1024 frames:** Quick Batch Table frames
  such as `720×408`, `544×304`, and `480×272` are multiples of 8 (validating SDXL's outer schema)
  but not multiples of 64 (`>= 512`), triggering UNet skip-connection shape errors on certain
  Workers AI shards.
- **Quadratic base64 encoding:** byte-by-byte string concatenation (`binary += String.fromCharCode(...)`)
  caused O(N²) allocations and CPU spikes on ~1 MB PNGs.

### The fix

- **Expanded `IMAGE_NEGATIVE_PROMPT`:** preserves all text/script/watermark exclusions and adds
  explicit negative tokens for `distorted, deformed, disfigured, bad anatomy, bad proportions,
  malformed limbs, extra limbs, missing limbs, fused limbs, floating limbs, extra fingers, fused
  fingers, too many fingers, mutated hands, poorly drawn hands, poorly drawn face, asymmetrical
  eyes, cross-eyed, duplicate faces, cloned body, twisted torso, warped perspective, bent
  architecture, melted objects, blurry, out of focus, jpeg artifacts, lowres, cropped, worst quality`.
- **CFG & fallback prompt guards:** passes `guidance: IMAGE_GUIDANCE_SCALE` (`7.5`) on 20-step
  `@cf/stabilityai/stable-diffusion-xl-base-1.0` calls; omits `guidance` on 4-step distilled
  `@cf/bytedance/stable-diffusion-xl-lightning`; appends positive style, perspective, anatomy,
  and text-free guardrails to `@cf/black-forest-labs/flux-1-schnell` fallback calls.
- **64 px SDXL dimension healing & MIME verification:** `sdxlSafeDimensions()` retries failed
  sub-1024 / non-64 frames at `1024×576` (landscape), `576×1024` (portrait), or `1024×1024`
  (square); `toImageBytes()` + `detectImageMime()` validate PNG/JPEG/WebP magic bytes and reject
  HTML/JSON error payloads; `bytesToBase64()` and `base64ToBytes()` use native
  `toBase64` / `fromBase64` or `Buffer` / `32 KiB` chunked encoding in O(N).

---

## 4 — Node.js-style Event-Driven Non-Blocking Image Task Queue, Worker Pool & 3-per-3s Pacing

To prevent CPU/memory spikes when multiple videos or rows submit many image tasks in a short
time — while enforcing **3 images per 3 seconds per video/row** — image execution now mirrors
Node.js / `libuv`'s single-threaded event-loop + background worker-pool architecture on both
the Worker and the browser client.

### Server (`src/modules/image-queue.ts`, `src/modules/image-batch.ts`, `src/index.ts`)

- **`ImageTaskQueue` (`sharedImageTaskQueue`):**
  - **Single-threaded non-blocking enqueue & microtask pump:** `POST /api/image-batch` and
    `GET /image/gen` register image tasks via `enqueue({ groupId, signal, execute })` in O(1)
    without blocking the caller; synchronous bursts coalesce into one microtask `pump()` pass,
    and rate-throttled lanes schedule a single exact one-shot `setTimeout` wakeup (zero polling).
  - **Zero head-of-line blocking:** every scene settles and streams out as soon as its own
    offloaded `env.AI.run()` call finishes; a slow scene in slot 1 never blocks slots 2 and 3 of
    the same row once the 3-second window replenishes.
  - **Bounded background I/O pool + per-row 3-per-3s rate governor:** caps total concurrent AI
    I/O across the isolate at `DEFAULT_GLOBAL_IMAGE_CONCURRENCY = 9` and per video/row at
    `IMAGE_BATCH_CONCURRENCY = 3` within a `IMAGE_BATCH_WAVE_INTERVAL_MS = 3000` ms sliding
    window (plus `IMAGE_BATCH_MIN_COOLDOWN_MS = 250` ms breathing room after a full 3-image
    burst), cycling **round-robin** (`groupRing`) across active rows so simultaneous rows progress
    fairly without starvation.
  - **Instant `AbortSignal` queue eviction & idle-lane GC:** aborting a request or closing the
    NDJSON stream immediately evicts queued tasks in place (before `env.AI.run()` is called),
    refunds all unrendered credits in `finally`, and sweeps idle group lanes automatically.
- **`EventLoopCpuSerializer` (`taskQueue.cpu`):**
  - Serializes synchronous post-I/O CPU work (`bytesToBase64` + JSON NDJSON line framing) so at
    most one image's base64 buffer is materialized per event-loop turn, calling `yieldEventLoop()`
    (`setTimeout(..., 0)`) between consecutive completions so heartbeats, aborts, and sibling
    requests interleave cleanly.

### Browser client (`window.__IMAGE_TASK_RUNTIME` in `src/client/app-js.ts`)

- **Unified event-driven client I/O queues (`createEventDrivenTaskQueue`):**
  - `appImageStreamQueue` (`BATCH_IMAGE_STREAM_CONCURRENCY = 3`) schedules `/api/image-batch`
    streams fairly in round-robin across Quick Batch Table (`requestBatchImages`) and Accordion
    Editor (`runImageBatch`), while `manualImageTaskQueue` (`concurrency = 3`) governs manual
    `/image/gen` clicks (`submitAiImages`). `stopBatchRows()` calls
    `appImageStreamQueue.cancelMatching(...)` to evict queued batch rows immediately.
  - Built strictly with event callbacks and one-shot `setTimeout` yields — **zero `setInterval`**
    anywhere in `APP_JS`.
- **Offloaded Web Worker background thread pool (`decodeBase64ImageOffThread`):**
  - Stream readers never block `reader.read()` with synchronous base64 decoding.
  - For payloads `>= 16,384` chars, decoding is offloaded to up to
    `CLIENT_DECODE_THREAD_POOL_SIZE = 3` reusable inline `Blob` Web Workers (`DECODE_WORKER_SOURCE`)
    that decode base64 off the main UI thread and transfer the `ArrayBuffer` back zero-copy via
    `postMessage({ id, ok: true, buffer }, [buffer])`.
  - Main-thread gallery/row insertions run in exact scene order on serialized promise chains
    (`imageCommitChain` in `requestBatchImages`, `galleryCommitChain` in `runImageBatch`) and are
    awaited before stream completion so all cards/slides are committed deterministically.
  - When `Worker` is unavailable (e.g. JSDOM or strict CSP), automatically falls back to
    `65,536`-char (`48 KiB` binary) chunks that yield to the browser event loop between slices.
  - `buildBatchSlides()` clears its `BATCH_SLIDE_DECODE_MS` timeout handle in `finally` and
    yields every 3 decoded slides.

---

## 5 — Quick Batch Table UI & Shell Repairs (`src/client/app-js.ts`)

- **Top-bar `#top-generate` integration:** bound via `removeAttribute("onclick")` +
  `addEventListener("click", onGenerateClick)` (working in both real browsers and JSDOM
  `outside-only`), dispatches `generateBatchRows()` / `stopBatchRows()` when in `"table"` layout,
  mirrors running/disabled/count state in `updateBatchToolbar()`, and restores `"✦ Generate"` when
  switching back to `"editor"` layout.
- **Control sync & RULE 25 clear-to-reset:** `bindBatchTable()` listens to `"change"` on
  `<select>` controls (`style`, `resolution`, `orientation`) without clobbering `minutes`
  mid-keystroke; `syncBatchRowsFromDom()` snapshots unfired/autofilled inputs before running;
  `resetClearedBatchRow()` resets a cleared finished row back to `stage = "empty"` and repaints
  Preview/Export cells back to pending text so typing a new script makes the row runnable anew.
- **Scene 0 ordering & live stream cancellation:** preserved `event.index === 0` (`Number.isFinite`
  instead of `Number(event.index) || images.length`), sorted `row.images` by `index` before
  `buildBatchSlides()`, attached a live `reader.cancel()` handle to `row.controller` during
  NDJSON streaming, sent `{ credentials: "same-origin" }` in `batchFetch()`, and applied credit
  summaries on HTTP errors.

---

## 6 — Codebase-Wide Deep Debug Audit & Fixes

Following a full read of all server modules (`src/index.ts`, `src/page.ts`, `src/modules/*.ts`)
and browser client bundles (`src/client/*.ts`), while respecting all intentional audit entries in
`toberesolved.md` (`E1`–`E9`), the following real runtime, concurrency, credit-accounting, stream,
and UI lifecycle bugs were identified and fixed:

1. **Cross-request Cloudflare Workers `IoContext` isolation & `DOMException` abort handling (`src/modules/image-queue.ts`):**
   - **Root causes:**
     1. `sharedImageTaskQueue` is a module-level singleton shared across concurrent HTTP requests
        in the same `workerd` isolate. Previously, when Request A's task finished and `pump()`
        synchronously invoked queued Request B's `task.execute()` (or armed a shared `wakeupTimer`),
        Request B's `env.AI.run()` I/O or timer executed inside **Request A's `IoContext`** — which
        in Cloudflare Workers throws `"Cannot perform I/O on behalf of a different request"` or
        cancels Request B's timer if Request A disconnects.
     2. In Node 22 and `workerd`, `AbortController.abort()` sets `signal.reason` to a `DOMException`
        (`reason instanceof Error === true`) whose `.name` getter is **read-only**; mutating
        `reason.name = "AbortError"` threw `TypeError: Cannot set property name of [DOMException] which has only a getter`.
     3. `EventLoopCpuSerializer.pendingCount` stayed `1` during the `finally` microtask after
        `resolve(result)` resumed the caller.
   - **Fixes:**
     - Every caller's `enqueue()` creates a per-task start gate (`notifyStart`); `pump()` only
       signals `notifyStart()`, so `task.execute()` always runs inside the **enqueuing request's
       own async context**. Rate-window sleep timers (`waitUntilSlotMs`) are armed per-request
       inside `enqueue()` with `signal` cleanup rather than a shared cross-request timer.
     - `createAbortError()` checks `reason.name === "AbortError"` before returning an `Error`
       instance and constructs a fresh `Error` otherwise without mutating read-only `DOMException`
       getters.
     - `EventLoopCpuSerializer` decrements `pending` before resolving the caller, and
       `ImageTaskQueue.stats()` prunes expired idle rate-window lanes before reporting `groups`.
2. **Accurate write-confirmed credit accounting & WHATWG `TransformStream` backpressure stall guard (`src/modules/image-batch.ts`):**
   - **Root causes:**
     1. `generated++` previously incremented *before* `await emitRawLine(ndjsonLine)` succeeded,
        so if the client disconnected (`reader.cancel()`) before the NDJSON frame flushed, the
        undelivered image was still counted as `generated` and **never refunded** in `finally`.
     2. In WHATWG `TransformStream`, if `readable`'s buffer (`highWaterMark: 1`) is full when a
        client abandons a stream without draining, `await writer.write(...)` blocks indefinitely on
        `backpressureChangePromise` (and `writer.abort()` queues behind the pending `sink.write`),
        preventing `finally` and `credits.refund()` from ever running.
     3. `sharedImageTaskQueue.cpu` shared `setTimeout(..., 0)` yields across requests, `heartbeat`
        used `void emit(...)` without overlap guard, and `request.signal` leaked its `"abort"`
        listener on normal completion.
   - **Fixes:**
     - `emitRawLine()` returns `Promise<boolean>` (`true` only when `writer.write` completes) and
       races `writer.write(...)` against a `200 ms` post-abort drain watchdog so a wedged
       `TransformStream` unblocks `finally` and refunds all undelivered credits immediately while
       preserving clean `{ type: "done" }` + `writer.close()` delivery for active readers.
     - `generated++` increments strictly when `delivered === true`; otherwise `stopController.abort()`
       cancels remaining scenes so all undelivered images are refunded.
     - Each `handleImageBatch` invocation creates its own request-local `EventLoopCpuSerializer`,
       guards `heartbeat` against overlapping writes, forwards `stopController.signal` into
       `generateOneWithRetry()`, and removes its `request.signal` listener in `finally`.
3. **Bare URL stripping, empty-output failover, homogeneous WAV/MP3 containers & abort handling (`src/modules/voiceover.ts`):**
   - **Root causes:**
     1. `sanitizeTextForTts()` unwrapped markdown `[label](url)` links into `label` cleanly, but left
        bare `https://...` / `www....` URLs intact — feeding `/` and `.` clusters into MeloTTS.
     2. If primary `@cf/myshell-ai/melotts` resolved HTTP 200 with empty/corrupt audio (`null` /
        `0` bytes), `synthesizeChunkPrimary` returned `null` immediately without retrying or failing
        over to `@cf/deepgram/aura-2-en` / `TTS_FALLBACK_URL`.
     3. If Chunk 1 succeeded as WAV (`RIFF`) on MeloTTS and Chunk 2 failed over to MP3 on Deepgram
        Aura-2, `joinVoiceoverPieces()` saw `pieces.every(isWavBytes) === false` and concatenated raw
        WAV RIFF bytes directly onto MP3 frames under `Content-Type: audio/mpeg`.
     4. Aborted client disconnects continued synthesizing remaining chunks instead of stopping early.
   - **Fixes:**
     - Stripped bare `https?://\S+` and `www\.\S+` URLs in `sanitizeTextForTts()`.
     - Treated empty/corrupt primary TTS responses as retryable model errors so all 3 attempts and
       the fallback TTS chain (`@cf/deepgram/aura-2-en` -> `TTS_FALLBACK_URL`) engage automatically.
     - Checked `request.signal.aborted` across chunk synthesis and returned `499 Voiceover cancelled`
       immediately on disconnect.
     - Added container homogeneity healing in `handleVoiceover()`: if earlier chunks produced WAV
       and a later chunk fails over to MP3 (or vice versa), the earlier WAV prefix chunks are
       re-synthesized via the MP3 fallback so every piece shares a single valid audio container.
4. **Empty-primary 70B fallback & 3-paragraph budget preservation (`src/modules/image-prompts.ts`):**
   - **Root causes:**
     1. When primary `@cf/meta/llama-3.1-8b-instruct-fp8` returned HTTP 200 with empty/unparseable
        text on all 3 attempts (`!collected.length && !lastError`), the fallback guard
        `if (collected.length < count && lastError)` skipped `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
     2. `parseImagePrompts()` used raw `.slice(0, IMAGE_PROMPT_MAX_CHARS)` before `applyImageStyleToPrompts`,
        which could clip Paragraph 3, and `extractJsonArray()` failed when LLM preambles contained a
        stray `[` before `{"prompts": [...]}`.
   - **Fixes:**
     - Changed the 70B fallback condition to `if (collected.length < count)` regardless of whether
       `lastError` was set.
     - Applied `fitParagraphsToBudget(p, IMAGE_PROMPT_MAX_CHARS)` inside `parseImagePrompts()` and
       added `{ ... }` object-slice fallback before bracket matching in `extractJsonArray()`.
5. **Bounded AI timeouts on SEO script generation (`src/modules/script-seo.ts`):**
   - Wrapped both the internal planner call (`45 s`) and the writer call (`90 s`) inside
     `handleSeoScriptGeneration()` with `runAiCallWithTimeout()` so a hung `env.AI.run()` attempt
     consumes one retry and advances instead of stalling the entire request.
6. **Accurate 429 credit-exhaustion error, `subject` logging & `/image/gen` timeout (`src/index.ts`):**
   - Added `subject: key` and an explicit exhausted `error` message (`"Daily image limit reached..."`)
     to `imageCreditHooks()` so `POST /api/image-batch` returns a clear user-facing 429 error instead
     of a generic fallback string, and wrapped `runImageModel()` inside `GET /image/gen` with an
     `IMAGE_ATTEMPT_TIMEOUT_MS` guard so a hung Workers AI call never permanently pins a slot in
     `sharedImageTaskQueue`.
7. **Pre-`atob()` OOM guard & safe KV JSON parsing (`src/modules/payments.ts`):**
   - Checked stripped base64 character length (`Math.floor((cleanB64.length * 3) / 4) > MAX_PAYMENT_IMAGE_BYTES`)
     *before* calling `atob()` to prevent Worker 128 MB heap OOM on oversized uploads (`413`), and
     wrapped KV record `JSON.parse()` calls in `try/catch` returning clean `500` JSON responses
     instead of uncaught Worker exceptions on malformed KV entries.
8. **Client Quick Batch Table body-read abort, `exportBatchRow` orientation dimensions & studio lifecycle safety (`src/client/app-js.ts`, `src/client/template-composer-js.ts`):**
   - **`batchFetch()` body consumption (`src/client/app-js.ts`):** added an optional
     `consumeResponse(response, controller)` callback inside `batchFetch` and used it in
     `requestBatchVoiceover` (`response.blob()`) and `requestBatchPrompts` (`response.json()`) so
     `row.controller` and the request timeout stay active throughout the entire body download,
     allowing `stopBatchRows()` to cancel slow audio/JSON downloads mid-stream; also chained
     `fetchControllerRef.abort()` inside `streamAbortHandle.abort()` on `requestBatchImages`.
   - **Quick Batch Table Portrait/Square MP4 dimensions (`src/client/app-js.ts`):** `exportBatchRow()`
     previously passed `renderContext` without dimensions so `generateMP4()` read global `#res-select`
     (always Landscape `1280×720`), squashing Portrait (`408×720` / `608×1080`) and Square
     (`720×720` / `1080×1080`) batch rows into 16:9 videos. `exportBatchRow()` now passes
     `frameWidth: dims.width, frameHeight: dims.height` from `batchRowDimensions(row)` and
     `generateMP4()` honors explicit even dimensions on `project`.
   - **Dynamic project resolution & clean `deleteVideoAccordion` (`src/client/app-js.ts`):**
     - `startImagePromptFlow()` aborts any prior `_imagePromptCreateController` and
       `_imageBatchController` and increments `project._imageFlowSeq` so stale flows cannot clobber
       `project._imageFlowActive` or overwrite newer prompts.
     - `runImageBatch()` tracks the `project` object reference (`flowProject`) and resolves
       `videoProjects.indexOf(flowProject) + 1` dynamically on every streamed image commit so
       deleting an earlier video mid-stream routes cards to the surviving video's renumbered index
       and never leaks deleted-video images into a surviving neighbor.
     - `deleteVideoAccordion(n)` marks `removed._deleted = true`, increments `_imageFlowSeq`, aborts
       `_imageBatchController` / `_imagePromptCreateController` / `_seoPlanController`, evicts
       queued tasks in `appImageStreamQueue` and `manualImageTaskQueue` matching `removed`, and
       revokes `removed.audio.url` and Manual AI `_displayUrl` object URLs.
     - `submitAiImages(n)` tags queued tasks with `{ project: flowProject }`, catches queue
       cancellation cleanly, and always re-enables `#va-ai-submit-N` in `finally`.
     - `generateVoiceover()` guards nullable `statusEl` (`#voiceover-modal-status-N` when modal is
       closed) and defers `URL.revokeObjectURL(url)` by `2,000 ms` on download.
   - **Atomic Ring photo upload URL tracking & DOM-attached MP4 download (`src/client/template-composer-js.ts`):**
     `onPhotoFiles()` only pushes `u` into `stagedUrls` after `await im.decode()` succeeds (revoking
     `u` immediately in `catch` on decode error so failed uploads never leave unrevoked blob URLs),
     and `exportMP4()` appends/removes its `<a download>` element on `document.body` with deferred
     URL revocation.

---

## Verification

- `tests/session-250-batch-pipeline.test.mjs` (13 tests): covers Stage 1 MeloTTS Unicode
  sanitization, ID3v2 stripping, Deepgram Aura / validated external fallbacks, and hung
  `decodeAudioData` recovery; Stage 2 8K context-window cap, truncated JSON salvage, model
  fallback, `IMAGE_PROMPT_MAX_CHARS = 1800` proportional 4-paragraph preservation, per-style
  `IMAGE_STYLE_DISCIPLINE`, and `IMAGE_ANTI_DISTORTION_GUARD`; Stage 3 64 px SDXL dimension
  alignment, Flux/Lightning fallbacks, real-clock 3-images-per-3-seconds pacing, mid-cooldown
  abort + credit refund, 24-task multi-row round-robin `ImageTaskQueue` + `EventLoopCpuSerializer`
  interleaving, `vm`-executed Web Worker thread-pool decoding + >64 KiB chunked event-loop
  fallback, and full JSDOM <-> real Worker `#view-table` integration.
- `tests/deep-debug-regressions.test.mjs` (new, 6 tests): covers `ImageTaskQueue` `AsyncLocalStorage`
  request-context isolation + `DOMException` `AbortError` handling + `EventLoopCpuSerializer.pendingCount`,
  `handleImageBatch` `reader.cancel()` credit refunds + wedged `TransformStream` backpressure abort
  watchdog, `handleVoiceover` bare URL stripping + empty-output failover + WAV->MP3 container
  healing + `499` `AbortSignal` cancellation, `generateImagePrompts` empty-primary 70B fallback +
  `parseImagePrompts` bracket preambles & 3-paragraph budget, Worker `429` credit message + payment
  upload `413` pre-`atob()` OOM & `500` corrupt-KV guards, and client `exportBatchRow` Portrait
  `408×720` encoder/muxer dimensions + `deleteVideoAccordion` mid-stream isolation.
- `npm test` → **120 / 120 tests passing** across all 12 test files.
- `npx wrangler deploy --dry-run` → clean bundle (`2263.21 KiB / gzip: 1172.25 KiB`); `0`
  TypeScript errors across all `src/modules/*.ts` and `src/client/*.ts` files.

