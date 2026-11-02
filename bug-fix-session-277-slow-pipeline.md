# Session 277 — deep debug: the *slow* script pipeline

**Scope.** Session 276 made the script pipeline safe (bounded budgets, run
ownership, authoritative reads). This pass studied the same flow with a
**latency** lens: how long one async run takes, how much of that time is the
pipeline's own overhead, and where a slow-but-healthy run is either wasted or
mislabelled. It also re-audited the session-276 fixes themselves — and found one
of them introduced a slow-path regression.

Every number below is measured, with the harness in `/tmp/probes/m*.mjs`, against
two builds: the pre-audit baseline (`09bbf82`) and the current tree. The
session-276 code was measured before this pass's edits (it is quoted where it
differs from both).

---

## 1. The flow, with the clocks drawn

```
POST /api/script?async=1                              t = 0      ticket issued
  └─ noteRunStart("queued")  → runStartedAt = t0  ── the clock every promise uses
  └─ schedule(runJob)                                loop: 2 lanes, queue ≤ 24
  └─ 202 { noteId, noteUrl, pollAfterMs: 900 }

ScriptEventLoop (per isolate, shared, 2 lanes)
  wait: (queued + 1) / 2 runs          ← the wait nobody had bounded or estimated
  run:  withDeadline(budget − waitMs)  ← session 276 fix (budget starts at t0)

handleSeoScriptGeneration
  note read ........................ ~1 KV op
  planner  3 attempts × 45 s ceiling  ← ladder = 405 s
  research 1 fetch   × 4 s
  writer   3 attempts × 90 s ceiling  ← ladder = 405 s
  note writes: 1 per attempt (heartbeat, serialised) + terminal

GET /api/script/notes/<id>  (browser polls every 900 ms, 15 s stall guard, 185 s cap)
```

The five clocks, side by side — this is where the slowness lives:

| Clock | Value | Measured from | Consequence if they disagree |
|---|---|---|---|
| client ceiling | 185 s | first request | browser gives up first |
| note deadline | 240 s | ticket | watchdog closes the note |
| loop budget | 240 s | ticket (since s276) | body aborted |
| **retry ladder** | **405 s** | **first attempt** | **attempts 4-6 can never fit** |
| attempt ceilings | 45 s / 90 s | each call | a late call burns the tail of the run |

405 s of nominal work inside a 240 s promise: **165 s of the ladder is
unreachable**, and the pipeline had no idea. That is finding S1.

Second axis — per-run overhead. The note write chain is ordered and the
**terminal write waits for it**, so every attempt's heartbeat is on the critical
path to `done`:

```
attempt 1 → heartbeat write ┐
attempt 2 → heartbeat write ├─ serialised: 6 attempts = 6 writes
...                         │  terminal write waits for all of them
attempt 6 → heartbeat write ┘
```

Measured on the baseline (150 ms KV, 6 attempts): **9 writes**, `done` landing at
**1534 ms** — i.e. ~600 ms after the script itself was ready. That is S2.

Third axis — the session-276 KV budget. `SCRIPT_NOTE_KV_TIMEOUT_MS = 2000` made
a stalled binding a fast answer, but the store reported "timed out" as `null`,
i.e. **"there is no note"**:

```
healthy run in flight, KV answering in 2.5 s
  baseline  ─ 202 { state: "writing", terminal: false }   after 2522 ms
  session276 ─ 404 { state: "empty",   terminal: true  }   after 2023 ms   ← declared dead
  now        ─ 503 { terminal: false, code: SCRIPT_NOTE_STORE_BUSY }       ← unknown, retry
```

A terminal `404/empty` tells the browser "the run ended without a script". The
run was fine; only the store was slow. That is S3, and it was mine.

Fourth axis — admission. The queue was never part of the decision to hand out a
ticket:

```
3 jobs ahead, 1.2 s run budget, deep queue
  baseline ─ 202 "queued"; caller learns it never ran after 4518 ms
  now      ─ runs inline immediately; the verdict is there at 63 ms
```

That is S4.

---

## 2. Findings

### S1 — the retry ladder never fitted the run's promise *(wasted inference)*

No attempt knew how much budget was left, so the loop's abort was the only thing
that stopped the ladder:

```
budget 600 ms, 300 ms model, 2 planner failures
  baseline ─ planner #1 (48→348 ms, 552 ms left)
             planner #2 started at 349 ms with 251 ms left  ← cannot finish
             killed at 600 ms → "exceeded its 600 ms budget"
  now      ─ planner #1 (34→334 ms)
             #2 refused: "the run budget was exhausted (2996 ms left, 5000 needed)"
             verdict at 3041 ms, one failed attempt instead of two
```

The second measurement is the interesting one: with a 6 s budget the baseline was
**still `planning` at 4226 ms** (attempt 2 in flight, doomed), while the current
code answers at **3041 ms** with a real reason. Same model, same failures — 1.2 s
earlier, one less paid inference, and a message an operator can act on.

**Fix.** `ScriptGenerationOptions.deadlineAtMs` (absolute, handed over by the
async route as `runStartedAt + jobDeadlineMs`) plus `attemptSlot()`:

* no attempt starts with fewer than `SCRIPT_MIN_ATTEMPT_MS` (5 s) left;
* every attempt's own timeout is **clamped** to what remains, so an attempt can
  never outlive the run (measured: a 5.7 s budget produced
  `model call timed out after 5700 ms`, not the 45 s ceiling);
* a run with no `deadlineAtMs` (the sync route) is unchanged.

### S2 — every attempt's heartbeat sat on the critical path to `done`

Heartbeats are deliberately not awaited (they overlap the next model call), which
is right — but they were all **appended** to the ordered chain, and the terminal
write drains that chain. Six attempts therefore delayed the verdict that the
browser was waiting for.

**Fix.** Heartbeats are coalesced: one in-flight write plus one pending slot, and
the newest snapshot replaces the pending one (a heartbeat only reports the
current state, so every snapshot but the last is dead on arrival).

```
150 ms KV, 6 attempts
  baseline ─ 9 writes  [queued, planning×4, writing×3, done]   done at 1534 ms
  now      ─ 5 writes  [queued, planning×2, writing, done]      done at 1236 ms
```

The regression test pins both the count (`puts ≤ 6`) and the latency
(`done` within ~2 writes of the script being ready).

### S3 — (introduced by session 276) a slow store was reported as an empty note

`withNoteBudget` resolved `null` on timeout, and `null` already meant "no note".
`handleScriptNoteRead` turned that into `404 { state: "empty", terminal: true }`
— a healthy run declared finished. Two further consequences: the *watchdog* used
the same read, so a slow store could also have produced a stale verdict, and
`submitAsyncScriptJob` could overwrite a note it could not read (losing the
keyword set and beat plan that make the next run cheap).

**Fix.** Reads now report **unavailable ≠ absent**
(`readScriptNoteChecked` → `{ note, unavailable }`):

* read route: unavailable → `503 { terminal:false, pending:true, code:
  SCRIPT_NOTE_STORE_BUSY, retryAfterMs }`; no staleness verdict is taken from a
  read that did not answer;
* submit route: unavailable → `503 SCRIPT_NOTE_STORE_BUSY` **before** any write,
  so the warm note survives (asserted: the stored JSON is byte-identical);
* client: a 503 with `terminal:false` counts as a **failed poll** (three in a row
  → the existing retryable `SCRIPT_NOTE_UNREADABLE`), never as a note state and
  never as proof of life.

While wiring that, the client test caught a real bug in my own patch:
`if (polled.status === 503 …)` referenced `polled`, which is scoped inside the
`try` — every real poll would have thrown `polled is not defined`. Now
`pollStatus` is captured outside the `try`. (This is exactly why the client half
of S3 has a DOM test rather than a shape assertion.)

### S4 — a deep queue handed out tickets it could not honour

`queueFull` only looked at `maxQueue`, so a caller behind 20 jobs got a 202 for
work that would be refused when its slot finally came — seconds later in the
harness, minutes in production.

**Fix.** `estimateQueueWaitMs()` = `ceil((queued + 1) / concurrency) × avgRunMs`
(session-276's loop now exposes an EWMA of settled `runMs`; a cold loop uses a
60 s estimate). If the estimate reaches the job's own budget the submission takes
the existing "cannot run it after the response" path — inline under `waitUntil`,
or an immediate `503 SCRIPT_QUEUE_ETA_EXCEEDED`. The decision is made **before**
the note write, so a refused submission cannot rewrite a note it will not run.

---

## 3. Fixing session 276's other side effects found on the slow path

* **memory-only runtimes were blind.** `readScriptNoteChecked` returned `null` for
  a "fresh" read when there is no KV binding — so the settled-note guard was
  disabled wherever the in-process mirror was the store (and in every unit test).
  Measured symptom: a `done` written over the watchdog's `SCRIPT_NOTE_STALE`.
  Now the mirror is authoritative when it is the only store.
* **the KV budget no longer `unref`s its timer.** In Node an `unref`'d 2 s timer
  can leave an awaited budget pending forever ("Promise resolution is still
  pending…"); in workerd `setTimeout` returns a number, so it was a no-op there
  and a hazard in tests. The note budget is part of the request's own lifetime —
  it keeps the loop alive, like the request does.
* **the loop's job-deadline watchdog still `unref`s** (it is a watchdog, not a
  keep-alive) — that is what stopped session 276's suite from taking 5 minutes.

---

## 4. The latency budget now, in one table

| Stage | Before | After | Note |
|---|---|---|---|
| ticket (normal load) | 25-32 ms | 25 ms | unchanged |
| queue wait | unbounded, uninspected | refused when ≥ the run budget | S4 |
| planner/writer attempts | always 3 + 3 started | 3 + 3 only if each can finish | S1 |
| attempt ceiling | 45 s / 90 s regardless | `min(ceiling, remaining)` | S1 |
| note writes per run | 3 + attempts (9 at 6 attempts) | 3 + ~1 (5 at 6 attempts) | S2 |
| time from "script ready" to `done` in the store | ~2 writes | ~1 write | S2 |
| healthy run, 20 ms model | 87 ms | 80 ms | +2 authoritative reads, −1 stale write |
| slow store (2.5 s) | 2.5 s blocking 202 | 2.0 s → `503 retryable` | S3 |
| deep queue (3 ahead) | 202 → failure at 4518 ms | inline → verdict at 63 ms | S4 |

The trade is explicit: **+2 authoritative KV reads per run** (the settled-note
guard and the resume point) in exchange for **-4 writes** and a verdict that is
not behind a dead chain. On a warm store that is ~0 ms; on a 60 ms store it is
+120 ms of reads against ~-240 ms of writes.

---

## 5. Changes

| File | What changed |
|---|---|
| `src/modules/script-event-loop.ts` | `avgRunMs` EWMA in `stats()` (settled runs only) |
| `src/modules/script-notes.ts` | `NoteReadResult` / `readScriptNoteChecked` (unavailable ≠ absent), `kvRace`, memory-only freshness, KV budget keeps the loop alive |
| `src/modules/script-notes-api.ts` | `estimateQueueWaitMs`, admission before the ticket, `SCRIPT_NOTE_STORE_BUSY` on both routes, `deadlineAtMs` handed to the pipeline, watchdog refuses to judge an unreadable store |
| `src/modules/script-seo.ts` | `deadlineAtMs` + `planAttemptTimeoutMs`/`writeAttemptTimeoutMs`, `attemptSlot()` budget gate, clamped attempt timeouts, `SCRIPT_MIN_ATTEMPT_MS`, coalesced heartbeats |
| `src/client/app-js.ts` | a busy-store 503 is a failed poll (`pollStatus` captured outside the `try`), never a note state |
| `tests/script-slow-pipeline.test.mjs` | **new**, 9 regression tests: S1 ×3, S2, S3 ×3 (two worker + one DOM client), S4 ×2 |

---

## 6. Verification

```
tests/script-slow-pipeline.test.mjs                     9/9 pass   (new)
script suites (notes, hang, memory, 276-audit, slow)   58/58 pass  (39 + 10 + 9)
full suite                       465 tests: 401 pass, 58 fail, 6 cancelled
                                 (456 before this pass + the 9 new; pass count 401 = 392 + 9)
tsc --noEmit                     30 diagnostics, all in src/index.ts (untouched)
wrangler deploy --dry-run        bundles clean (2694 KiB)
```

The 58 failures and 6 cancellations are byte-for-byte the same set that fails on
`09bbf82` — all image/relay/Quick-Batch tests (`a client ticket authorizes only
the AI paths`, `image batch validates input…`, `5-row batch pipelines smoothly…`,
etc.). No script/notes test is in that set.

### Reproducing the measurements

```bash
node --import tsx /tmp/probes/m1-latency.mjs   <root> 0 20 0     # normal run
node --import tsx /tmp/probes/m2-budget.mjs    <root> 6000 3000  # S1 ladder
node --import tsx /tmp/probes/m3-chain.mjs     <root> 150 2 2    # S2 write chain
node --import tsx /tmp/probes/m4-slowkv.mjs    <root> 2500       # S3 slow store
node --import tsx /tmp/probes/m5-admission.mjs <root>            # S4 deep queue
```

`<root>` is a checkout of `09bbf82` for the "before" column.

---

## 7. Known limits

* `SCRIPT_MIN_ATTEMPT_MS = 5000` is a judgement call: a run with < 5 s left
  reports "budget exhausted" instead of trying. With the production 240 s budget
  it only ever fires near the end of a struggling run; the tests that need a
  script to succeed therefore use realistic budgets.
* The 405 s ladder still *exists*; it is now cut by the budget instead of being
  silently impossible. Shortening it (e.g. 2 planner / 2 writer attempts inside
  240 s) is a product decision, not a bug fix.
* `estimateQueueWaitMs` is an estimate from an EWMA: it can refuse a submission
  that a lucky idle lane would have run. It errs on the side of an honest 503
  with a `Retry-After`, which the client already retries.
* The +2 authoritative reads are per async run; the sync route keeps its single
  read (no watcher, no resume point).
* `request.clone().json()` in the note routes remains unbounded (client connection
  bounded, browser aborts at 20 s).
