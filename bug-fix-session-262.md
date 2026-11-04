# Bug fix #262 — Removing the hard image throttles, adding server-load balancing and request backoff

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

**Date:** 2026-10-26 · **Scope:** image generation (`/image/gen`, `POST /api/image`,
`POST /api/image-batch`), credits, browser media scheduler · **Status:** implemented and locally
tested; **not deployed**.

Supersedes the "fixed wait = safety" assumptions of `bug-fix-session-251.md` (3-per-3 s pacing stays,
but it is no longer the only brake) and keeps every transport/ownership rule of
`bug-fix-session-261.md` (binary images, one credit per image, no automatic replay of an ambiguous
paid request, refunds for unrendered scenes).

## What was reported

> "Image processing is not working, not proceeding. Remove the rules on limit of image generation
> per a specific time… just add mechanics to handle server load — balancing and request backoff once
> the server signals server load failure."

Follow-up from the user: **keep** the 3-images-per-3-seconds pacing, **keep** credits at
**10,000 per day**, and nothing else.

## Root causes found

| # | Symptom | Root cause |
| --- | --- | --- |
| 1 | Generation stops after a handful of images | `GUEST_PLAN.limits.images = 10` and `wrangler.json` binds `KV_BINDING`, so every anonymous `/free` visitor got ten images per day and then a permanent `429`. Paid accounts had **1,200**/day while free had 70,000 — the paid plan looked like a downgrade. |
| 2 | A busy fleet looked like a broken app | `generateOneWithRetry()` used a fixed `500 ms * attempt` retry for *every* error and stopped after two attempts. There was no overload classification, no `Retry-After`, no jitter, and no global slowdown: every scene in every request retried at the same moment. |
| 3 | Retries multiplied paid provider work | A retired model slug or a rejected prompt was retried like a transient error, and the per-attempt timeout did not bound the retry sequence. |
| 4 | Per-request pacing queues multiplied the concurrency cap | `handleImageBatch()` created its own `ImageTaskQueue` whenever custom timing was passed, each with `DEFAULT_GLOBAL_IMAGE_CONCURRENCY = 6`. N concurrent rows therefore allowed `6 × N` provider calls, which is exactly the load the pacing was supposed to prevent. |
| 5 | The browser had no way to react to load | `responseError()` in `browser-offload.ts` only recorded `retryable`/`status`. `Retry-After` was ignored, so the queue fired the next scene into an overloaded fleet, and the UI leaked raw provider text. |

## Changes

### 1 — One daily ceiling: `IMAGE_DAILY_LIMIT = 10000` (`src/index.ts`)

- `CREDIT_PLANS.free.limits.images`, `CREDIT_PLANS.paid_user.limits.images` and
  `GUEST_PLAN.limits.images` all read the exported constant, so free, paid and anonymous visitors
  share the same 10,000 images/day.
- Every surface derives the number from the plan payload: `X-Credit-Images-Limit`, the `429` body,
  the `401` upgrade hint, the credits popover, the auth overlay, the landing plan cards, the
  settings **Plans / Accounts / Guest credits** tables, the payment instructions and the upgrade
  page. All of them were updated to 10,000.
- Unchanged: the Asia/Taipei lazy daily rollover, the 2-day record TTL, refunds for unrendered
  images, fail-open on a credits outage, `401` for a cold anonymous request when KV is bound, and
  the accepted KV non-atomicity limitation from #261.

### 2 — `src/modules/image-load.ts` (new): classification, AIMD governor, backoff math

- `classifyImageFailure(error)` → `{ kind: "overload" | "transient" | "fatal", retryable,
  retryAfterMs, reason }`:
  - **overload**: `429/502/503/504`, capacity, rate limit, overloaded, service/temporarily
    unavailable, resource exhausted, allocation/quota exceeded, concurrency limit;
  - **transient**: `3043`, internal error, timeouts, ECONNRESET/network/fetch failures, empty or
    non-image payloads, malformed responses;
  - **fatal**: `400/401/403/404`, missing/retired/deprecated model, invalid or too-long prompt,
    unbound binding, unsupported parameter.
- `parseRetryAfterMs()` normalises a provider hint from `retryAfterMs` (already ms), `retryAfter`
  (seconds when < 1000), an HTTP `Retry-After` header (seconds or HTTP date) or the message text
  (`retry after 3s`, `retry after 250ms`).
- `ImageLoadGovernor` (shared singleton `sharedImageLoadGovernor`):
  - **AIMD**: start 3, `+1` after 4 consecutive successes, ceiling 6, floor 1; overload halves the
    ceiling immediately.
  - **Cooldown**: `base * 2^(streak-1)` (750 ms … 10 s) published as `cooldownRemainingMs`; the
    streak grows at most once per cooldown window, so the primary + two fallbacks inside one doomed
    scene are one load event.
  - **`retryDelayMs(attempt, hint)`**: provider hint wins (clamped to 20 s); otherwise
    `800 ms * 2^(attempt-1)` with 50–100 % jitter.
  - `snapshot()` exposes limit/streak/cooldown/success counts for logs, headers and stream events.

### 3 — `src/modules/image-queue.ts`: the queue reads load live

- New `governor` option (defaults to the shared governor, `null` disables it for pure pacing).
- `effectiveGlobalConcurrency() = min(maxGlobalConcurrency, governor.limit)` — the static 6 is now a
  ceiling, not a promise.
- `earliestSlotAt()` folds `governor.cooldownRemainingMs` into `readyAt`, so new work sleeps in the
  caller's own `IoContext` (`abortableSleep`) exactly like the #251 rate windows. No cross-request
  timer is introduced.
- Per-row **3 images / 3 seconds** pacing (`IMAGE_BATCH_CONCURRENCY = 3`,
  `IMAGE_BATCH_WAVE_INTERVAL_MS = 3000`, `IMAGE_BATCH_MIN_COOLDOWN_MS = 250`) is unchanged, and the
  per-request pacing queue in `handleImageBatch()` now passes the shared governor so its own pool
  cannot multiply the fleet ceiling.

### 4 — `src/modules/image-batch.ts`: honest retries and honest HTTP

- `runImageModel()` routes **every** provider call (primary, dimension-healed retry, each fallback)
  through `runProvider()`, which reports success/overload to the governor. The fallback chain is now
  visible to the load model instead of hiding behind the outer result.
- `generateOneWithRetry()`:
  - `fatal` → stop after the first attempt (`IMAGE_BATCH_ATTEMPTS = 2` no longer applies);
  - `overload` → up to `IMAGE_OVERLOAD_ATTEMPTS = 4` attempts;
  - `transient` → the historical two attempts;
  - backoff is `governor.retryDelayMs()`, and the whole ladder must fit `IMAGE_RETRY_BUDGET_MS =
    45000`;
  - returns `{ ok:false, error, kind, retryAfterMs }` (`ImageSceneFailure`).
- `/api/image-batch` streams `{type:"image", ok:false, kind, retryAfterMs}` per failed scene,
  includes `load` in `start`, and `overloadFailures` / `retryAfterMs` / `load` in `done`.
- `POST /api/image`: `503` + `Retry-After` + `{error, kind:"overload", retryAfterMs, load, credits}`
  on load, `502` for other failures, `499` for cancellation, one refund in every failure path.
- `GET /image/gen` mirrors the same contract (503/Retry-After vs 500) and still refunds.

### 5 — Browser (`src/client/browser-offload.ts`, `src/client/app-js.ts`)

- `responseError()` records `status`, `kind` and `retryAfterMs` (header wins over the JSON hint).
- `noteBackoff(ms)` (capped at 20 s) holds **media** jobs until the server-declared window elapses;
  the reserved control lane keeps running so prompt lookahead is never frozen. `stats()` exposes
  `backoffMs`; `dispose()` clears it.
- `images()` reports `retryAfterMs` per failed image and remembers the window; the voiceover retry
  pass prefers the hint over its fixed 500 ms step.
- The editor shows "The image server is busy right now — images pause for about N s and then
  continue." instead of a raw provider string. A failed paid image is still **never** replayed.

### 6 — Docs

`README.md`, `userflow.md` and `system-rules.md` (RULE 20, RULE 21, RULE 31, the message table and
the blocking-alert list) now describe 10,000 images/day on every plan and the load/backoff contract.

## Verification

- **Full suite: 183/183 passing** (`npm test`), including the 170 pre-existing tests and the 13 new
  ones in `tests/session-262-load-balancing.test.mjs`:
  - classification of overload/transient/fatal samples and `Retry-After` normalisation;
  - additive increase, halving, cooldown doubling, same-window de-duplication, floor/ceiling,
    jitter and hint clamping;
  - the queue following the governor's live ceiling, waiting out its cooldown, and still pacing one
    row at 3-per-3 s;
  - a load failure retried to success, a fatal error **not** retried (3 provider calls = one
    attempt), an unrecovered overload streaming `kind`/`retryAfterMs`/`load`;
  - binary `503` + `Retry-After` with exactly one refund, and the #261 `502` regression guard;
  - the browser pausing media for the declared window while control work continues;
  - the worker reporting 10,000 images/day for the guest tier.
- `tests/deep-debug-regressions.test.mjs` and `tests/account-rows.test.mjs` were updated for the new
  ceiling (the guest exhaustion case seeds the record at 10,000 instead of spending ten images).
- `npx tsc --noEmit`: still exactly the **30 pre-existing diagnostics in `src/index.ts`**, no new
  ones in any module, so `npm run check` remains blocked by the same baseline as before #261/#262.
- `CLOUDFLARE_SEND_METRICS=false npx wrangler deploy --dry-run` succeeds (2,339 KiB upload, `AI` +
  `KV_BINDING` only — no new binding, Durable Object or migration).
- `git diff --check` is clean.

Reproduce:

```sh
npm install
npm test                                             # 183/183
node --import tsx --test tests/session-262-load-balancing.test.mjs
npx tsc --noEmit                                     # 30 pre-existing src/index.ts diagnostics
CLOUDFLARE_SEND_METRICS=false npx wrangler deploy --dry-run
```

No production deployment or real-provider load test was performed.

## Remaining limits (do not over-claim)

- The governor is **in-memory per isolate**. It is a load-shedding heuristic, not admission control:
  it never denies a request, does not synchronise across isolates or PoPs, and forgets everything on
  isolate restart. Fleet-wide admission control would need a serialized store (Durable Object or
  equivalent) as a deliberate change.
- KV credit counters remain best-effort under concurrency (see #261): simultaneous requests can
  still over- or under-count, so the 10,000/day ceiling is a fair-use limit, not exact billing.
- Retries can add provider calls: a scene hitting sustained overload may make up to four attempts
  across the model chain. Fatal errors are explicitly *not* retried, and the retry budget bounds the
  time, but the cost is not zero.
- Timeouts still cannot cancel an already-running `env.AI.run()`; a bounded ladder bounds the
  Worker's patience, not the provider's work.
- The 20-second client backoff cap means a server asking for longer is only obeyed for 20 s; the
  browser then retries its queued work (the server can answer `503` again).
- Real fleet behaviour, provider `Retry-After` quality and production CPU/latency numbers remain
  rollout measurements, not proven results.


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
