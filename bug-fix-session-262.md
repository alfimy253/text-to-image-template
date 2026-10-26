# Bug fix #262 — Removing the hard image throttles, adding server-load balancing and request backoff

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
