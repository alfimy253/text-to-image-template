# Session 279 — three users, three videos each: measure it, then take the retries out of the browser

**Request (verbatim).** *"study code make code the source of truth but make documentation
secondary guide and make a testing for how fast can three user finish a set of three videos
each …and then make a strategy to make faster results of tests by off loading script retries
and all pipeline retries in js from browser……then check for hanging implementation from that
strategy clean the code from that strategy then check for tests again by simulation and see
if theres change in speed of pipeline"*

So, in order:

1. a **measurement** — three concurrent users, three videos each, timed end to end;
2. a **strategy** — make that measurement faster by moving script retries and every other
   pipeline retry out of the browser's JS;
3. a **hang audit + cleanup** of what that strategy leaves behind;
4. the **same measurement again**, and the difference.

Everything below is read out of `src/` (code is the source of truth; the older session docs
are the secondary guide and are cited only for intent). Every number is measured by
`bench/three-users-three-videos.mjs`, checked into the branch with its baseline output in
`bench/pipeline-sim/results/`.

---

## 1. The measurement: what is real and what is simulated

`bench/three-users-three-videos.mjs` boots **three jsdom windows** and runs **three Quick
Batch rows in each** — nine videos — concurrently, against one shared simulated Worker
isolate.

| Half | Source | Real? |
| --- | --- | --- |
| Browser | `src/page.ts` + `src/client/app-js.ts` (+ `browser-offload`, `pixabay-direct`, `progressive-image-pipeline`, `api-rotation`) evaluated in jsdom through `tests/studio-render-harness.mjs` | **the shipped page**, only device edges stubbed (canvas 2D, WebCodecs, mp4-muxer, media elements) |
| Worker | `src/index.ts` router → `script-seo`, `script-notes`, `script-notes-api`, `script-event-loop`, `image-prompts`, `image-batch`, `pixabay`, `voiceover` | **the shipped worker**, real routing and real capability negotiation |
| AI binding | `bench/pipeline-sim/model.mjs` | simulated: latency per stage + deterministic transient `AiError 3043` + deterministic invalid replies (an SEO audit rejection, an unparseable scene plan) |
| Pixabay API/CDN, external TTS | `bench/pipeline-sim/model.mjs` | simulated: search 450 ms, photo 700 ms, clip 1400 ms, 5 % transient failures, real payload shapes and magic bytes |
| Network | 60 ms round trip per request, both directions | simulated |
| KV | absent | notes use the isolate mirror (session 277 made it authoritative for memory-only runtimes); credit gates open via `PIXABAY_ALLOW_UNMETERED`. Identical in every build compared, and not what retry ownership changes |
| Local encode | `--render-ms 9000` per video, added after the row is finished | modelled: WebCodecs is stubbed, and the device encode is the one cost no retry strategy touches |

Deliberately **not** simulated: nothing in the retry path. Attempts, backoffs, budgets, the
900 ms note poll, the 2-lane script loop, the image task queue, the load governor, credit
reservation/refund and the browser's media scheduler are all the shipped code deciding for
itself.

Provider latency is the only thing `--scale` touches. The browser's own constants (900 ms
poll, 250 ms script backoff, 800·2ⁿ image/prompt backoff, 100 ms scheduler ticks, 45 s/75 s
worker budgets) are part of the thing under test and are never scaled.

```
node --import tsx bench/three-users-three-videos.mjs                     # production latencies
node --import tsx bench/three-users-three-videos.mjs --scale 0.25        # 4× faster providers
node --import tsx bench/three-users-three-videos.mjs --json-out /tmp/x.json
node --import tsx bench/pipeline-sim/compare.mjs before.json after.json
```

### 1.1 Baseline — three users, three videos each, production latencies

`bench/pipeline-sim/results/baseline-scale1.json` (seed `base100`, planner 7.2 s, writer
21 s, scene planner 4 s, TTS 3 s, TTS transient failure rate 25 %, writer invalid-reply rate
12 %, 60 ms RTT, 2 script lanes):

| | value |
| --- | --- |
| **Makespan — all nine videos exported** | **226.1 s** |
| **Pipeline makespan — all nine rows finished (before local encode)** | **183.3 s** |
| Finished | 9 / 9 |
| per user (scripts → media → total) | u1 139.6 s → 43.7 s → 210.4 s · u2 157.4 s → 37.7 s → 222.2 s · u3 117.9 s → 38.1 s → 183.1 s |
| Worker requests | **1061** |
| … of which note polls | **934 (88 %)** |
| … `POST /api/script?async=1` | **12 for 9 videos** (3 browser-level retries) |
| … `POST /api/voiceover` | **29 for 18 chunks** (11 retries) |
| … `POST /api/image-prompts` | **21 for 18 chunks** (3 retries) |
| … `POST /api/image` (browser media fallback) | **20** |
| Model calls | planner 9 · writer 12 · scene planner 21 · TTS 29 = **71 inferences** |
| Model time | 487.8 s of inference inside a 183.3 s pipeline (2 lanes + browser serialisation) |
| Provider | 65 searches · 36 photos · 22 clips · 7 failures |
| Stage medians per video | script **116 s** · voice **11.8 s** · prompts **5.3 s** · images **15.1 s** · animate ~0 s |

The same run with providers 4× faster (`results/baseline-scale025.json`) finishes **8 / 9**:
one row dies with `TTS chunk failed` because the browser's voiceover ladder is three
whole-restart attempts against a 25 %-failing TTS model, and a restart re-buys the chunks
that already succeeded.

---

## 2. The retry inventory, read out of the code

### 2.1 Owned by the browser (JS in the page)

| # | Ladder | Source | Attempts / wait |
| --- | --- | --- | --- |
| B1 | Script, editor accordion | `app-js.ts` `runSeoScriptRequest` + `scriptAttempts()` | 3, 250 ms or the server's `retryAfterMs` (≤5 s) |
| B2 | Script, quick-batch row | `app-js.ts` `generateBatchRowScript` | 3, same |
| B3 | Script request timeout | `SCRIPT_REQUEST_TIMEOUT_MS` 20 s (async) / `SCRIPT_LEGACY_TIMEOUT_MS` 105 s | — |
| B4 | Note poll | `SCRIPT_NOTE_POLL_MS` 900, stall 15 s, 3 failed polls, ceiling 185 s | — |
| B5 | Voiceover, chunk mode | `browser-offload.ts` `voiceover()` | **3 attempts over the whole chunk set**, 500·(n+1) ms, rotates `voiceIndex`; chunks requested **one after another** |
| B6 | Any batch step | `app-js.ts` `batchRunStep` | `BATCH_STEP_ATTEMPTS` 4, backoff 800 → 1600 → 3200 ms |
| B7 | Scene-keyword batch | `progressive-image-pipeline.ts` `requestNext` | 3 (`batch.attempt` 0-2), 800·2ⁿ jittered, ≤15 s |
| B8 | Image chunk rounds | `app-js.ts` `requestImageChunk` | 3 rounds over the scenes still missing, `max(hint, 800·2ⁿ)`, ≤15 s |
| B9 | Editor media auto-retry | `app-js.ts` `retryImagePromptFlow`, `scheduleImageAutoRetry`, `IMAGE_AUTO_RETRY_LIMIT` | bounded, minute-scale countdown |
| B10 | Clip metadata probe | `app-js.ts` `probeMp4DurationWithRetry`, `CLIP_PROBE_TIMEOUT_MS` 15 s | 2-3 (device, not provider) |
| B11 | Capability probe | `browser-offload.ts` `capabilities()` | re-probe after a 3 s stampede guard |

### 2.2 Owned by the Worker

| # | Ladder | Source | Attempts / budget |
| --- | --- | --- | --- |
| W1 | Script planner + writer | `script-seo.ts` `plannerAttemptLimit` / `writerAttemptLimit` | **1 + 1 when the page sends `browserRetries: true`** (what the page does today), 3 + 3 otherwise; every attempt clamped to the run budget by `attemptSlot()` |
| W2 | `/api/seo-plan` | `planOneSeoKeywordSet` + `runPlannerModelCall` | 3 validation attempts × `SEO_PLAN_FALLBACK_MODELS`, 1 transport retry per call |
| W3 | Scene-keyword planner | `image-prompts.ts` `generateImagePrompts` | **one** call per request — the ladder is B7's |
| W4 | Media scene | `image-batch.ts` `generateOneWithRetry` | 4 attempts on overload / 2 otherwise, inside `IMAGE_RETRY_BUDGET_MS` 45 s, `IMAGE_ATTEMPT_TIMEOUT_MS` 75 s per attempt, governor backoff + `Retry-After` |
| W5 | Voiceover, chunk mode | `voiceover.ts` | **one** call, `502 {retryable:true}` — the ladder is B5's |
| W6 | Voiceover, full-text mode | `voiceover.ts` | 3 attempts per chunk + EN fallback models + external TTS, **sequential** over chunks (no browser caller uses it today) |
| W7 | Relay rotation | `api-relay.ts` | `settings.maxAttempts` 3 + local backstop (provider-level, not user-level) |

### 2.3 Where the two owners overlap

Session 278 moved the script ladder into the page to stop one click costing 18 inferences.
It did that, and the audit it left behind (`bug-fix-session-278-browser-retry-owner.md` §4)
names the media ladder as the next candidate. Measured now, the overlap is the pipeline's
main structural cost — **the same hope is bought twice, and the second purchase is the
expensive one**:

| Stage | Browser buys | Worker already bought | Extra cost of one browser attempt |
| --- | --- | --- | --- |
| Script | 3 requests (B1/B2) | 1 planner + 1 writer (W1) | a fresh `POST /api/script?async=1`, loop re-admission (`estimateQueueWaitMs`), a **new 900 ms-quantised poll stream**, 250 ms backoff, and the note's keyword set has to be sent back to be reused |
| Scene keywords | 3 requests (B7) | 1 call (W3) | a fresh request through the control lane of the browser scheduler + 800·2ⁿ ms |
| Media scene | 3 rounds (B8) | 4 attempts / 45 s (W4) | up to **12 provider attempts per scene**, a fresh credit reservation per round, a fresh place in the image task queue |
| Voiceover | 3 whole restarts (B5) | 1 call per chunk (W5) | every restart re-synthesises the chunks that already succeeded, sequentially |

---

## 3. Findings from the baseline run

**F1 — the browser never fetches the two required clips itself (bug).**
`src/client/pixabay-direct.ts` builds every provider search as
`state.apiOrigin + "/api/?" + params` — for video scenes too. Pixabay serves videos at
`/api/videos/`, which is exactly what the Worker path does
(`src/modules/pixabay.ts`: `https://pixabay.com/api/${type === "video" ? "videos/" : ""}`).
A browser video search therefore returns **photo** hits, `normalizeHits(type:"video")`
rejects every one of them (`no videos.small.url`), the scene fails `no-hit` and falls back to
`POST /api/image`. Measured: **20 fallback requests and 22 clip downloads through the
isolate for nine videos** — both clips of every video take the slow transport the
browser-first migration was written to avoid. The unit test masks it:
`tests/pixabay-direct-browser.test.mjs` answers `/api/` with video hits when `image_type` is
absent, which the real provider does not do.

**F2 — voiceover chunks are sequential in the browser.** `browser-offload.voiceover()`
`await`s each chunk inside a `for` loop: two chunks × 3 s = 6 s floor per video before any
retry, and the ladder's restart is all-or-nothing. The worker's own full-text path (W6) is
sequential too, so moving ownership without changing it would not help; the chunk pool has
to become bounded-concurrent.

**F3 — polling is 88 % of the traffic.** 934 note GETs for nine scripts (up to 162 for one
note). Each poll is a full isolate invocation, and every browser script retry (F4) opens a
second poll stream for the same work.

**F4 — a browser retry re-queues behind everyone.** The retry is a new submission, so it
re-enters `estimateQueueWaitMs()`; with nine jobs on two lanes the third attempt of a script
can be refused (`503 SCRIPT_QUEUE_ETA_EXCEEDED`) *after* the user has already waited two
model calls, and the note's warm keyword set only helps if the page remembered to send it
back.

**F5 — one row in nine dies outright at 4× provider speed.** The browser's three
whole-restart voiceover attempts are weaker than the worker's per-chunk ladder (3 attempts +
two fallback models + external TTS), so the faster the providers get, the more visible the
weaker owner becomes.

**F6 — the script stage is 63 % of the pipeline.** Median 116 s per video, of which the
model accounts for ~28 s: the rest is lane queueing (2 lanes, 9 jobs), poll quantisation and
retries. Any strategy that does not reduce *submissions per script* cannot move the
makespan much.

---

## 4. The strategy: one retry owner per stage, and it is the Worker

**Rule.** For every stage of the pipeline exactly one place retries: the Worker, inside the
request (or the note run) that the browser is already waiting for. The browser keeps
*cancellation*, *timeouts*, *the note poll* and *transport fallbacks* — none of which are
retry ladders — and stops looping.

Why this is faster, in the units the baseline measured:

1. **A worker retry costs one model call.** A browser retry costs a model call *plus* a round
   trip (60 ms), loop re-admission, a new poll stream quantised at 900 ms, and a backoff
   (250 ms script, 800·2ⁿ ms media/prompts). F3/F4 are that difference, 934 polls and 12
   submissions for nine scripts.
2. **The worker retries with what it already paid for.** The validated keyword set, the beat
   plan, the note and the research stay in the run's scope; the browser has to serialise them
   back and hope the note is still warm (session 278's `resumeKeywordSet` exists only because
   the retry left the isolate).
3. **One owner means one budget.** `attemptSlot()` (session 277) already refuses an attempt
   that cannot finish inside the run's promise and clamps each attempt's timeout to what is
   left. A browser ladder cannot see that budget — it only sees its own 185 s ceiling — which
   is how the pre-277 ladder came to have 165 s of unreachable attempts.
4. **Fewer requests, fewer side effects.** Each avoided browser round also avoids a credit
   reservation/refund pair, an image-queue slot, a note write and an isolate invocation.
5. **The weak owner disappears.** F5's dead row is the browser's 3 restarts losing to a
   25 %-failing TTS model; the worker's ladder (3 attempts + 2 fallback models + external
   TTS, per chunk, concurrently) is strictly stronger *and* cheaper in wall-clock.

### 4.1 The negotiated contract

```jsonc
GET /api/pipeline-capabilities
{
  "version": 261,
  "retryOwner": "worker",            // one owner, every stage
  "scriptRetryOwner": "worker",  "workerScriptRetries": 3,
  "voiceRetryOwner": "worker",   "serverVoiceChunks": 3,
  "promptRetryOwner": "worker",  "workerPromptAttempts": 3,
  "imageRetryOwner": "worker",   "workerImageAttempts": 4,
  "browserScriptRetries": 3          // compat only: a cached pre-279 page reads this
}
```

* **The page** makes exactly one request per stage, sends no `browserRetries` flag (so the
  worker keeps its ladder), and shows the worker's own attempt count from
  `failure.attempts` in the status line instead of counting attempts itself.
* **A cached pre-279 page** still reads `browserScriptRetries`, still sends
  `browserRetries: true`, still gets one worker attempt per request and still retries three
  times — unchanged behaviour, no broken tab.
* **A 279 page against a pre-279 worker** sends no flag, so that worker runs its legacy
  3 + 3 script ladder, its per-chunk voiceover ladder and its 4-attempt media ladder inside
  one request. Degraded (no concurrent chunks) but correct, and never a hang.

### 4.2 Per-stage plan

| Stage | Worker side | Browser side |
| --- | --- | --- |
| **Script** | `plannerAttemptLimit`/`writerAttemptLimit` back to 3 + 3 (unless a legacy page asks for 1 + 1), and the ladder **rotates the model slug per attempt** — the rotation the browser used to provide via `attempt` | delete B1/B2's loops, `scriptAttempts()`, `SCRIPT_RETRY_BACKOFF_MS` for scripts, `previousFailure`, `resumeKeywordSet`; keep B3/B4 (timeout + poll) |
| **Scene keywords** | `generateImagePrompts` retries inside the request: up to 3 attempts, reusing the existing `attempt > 0` coaching text and temperature shift, bounded by a total budget and the request signal | delete B7's 3-attempt loop and its 800·2ⁿ backoff; keep the cancellation checks and the "no new prompts" permanent verdict |
| **Voiceover** | full-text request synthesises chunks through a **bounded pool** (`serverVoiceChunks`), each chunk keeping W6's ladder (3 attempts → EN fallback models → external TTS), the whole request bounded by a deadline | delete B5: no chunk splitting, no assembly, no 3× restart in the page; one `POST /api/voiceover {text, lang}` |
| **Media** | unchanged — W4 already owns it (4 attempts / 45 s / governor backoff) | delete B8's rounds: one pass, and a scene the worker could not deliver is a verdict, not another round |
| **Browser-first media** | fix F1: video searches go to `/api/videos/` | the per-scene Worker fallback stays — it is a *transport* change for the same attempt (CORS refusal, blocked CDN), not a second retry owner |

### 4.3 The hang rules this strategy has to satisfy

Moving retries into the request means the request now holds the ladder, so every ladder
inherits the request's lifetime. Non-negotiable, and each is pinned by a test:

1. **Per-attempt timeout** — no attempt waits on a model or provider without one
   (`SEO_PLAN_AI_TIMEOUT_MS`, `SEO_SCRIPT_AI_TIMEOUT_MS`, `VOICEOVER_AI_TIMEOUT_MS`,
   `IMAGE_ATTEMPT_TIMEOUT_MS`, `IMAGE_PROMPT_BATCH_TIMEOUT_MS`).
2. **Absolute deadline for the ladder** — the script run keeps `deadlineAtMs` +
   `attemptSlot()`; the prompt ladder and the voiceover pool get the same shape (a total
   budget, checked before each attempt).
3. **No attempt starts that cannot finish** — `attemptSlot()` returns `null` and the ladder
   reports *why* instead of starting a doomed call.
4. **Cancellation is checked at every stage boundary** and propagated into the in-flight
   call (`request.signal`, `AbortSignal`).
5. **Permanent failures stop the ladder** — `permanentFailure()` for auth/quota/missing
   binding, `kind: "fatal"` for a missing provider key, 4xx (not 429/408) for media.
6. **Concurrency never widens because of a retry** — retries run inside the existing
   ceilings (2 script lanes, the shared image task queue, the new bounded voiceover pool),
   so a retrying fleet cannot multiply its own load.
7. **No floating promises** — every background write/task stays reachable
   (`ctx.waitUntil`, the note write chain) as sessions 276/277 established.
