# Session 276 — deep debug: the script pipeline hang

**Scope.** Independently review the "Bound script job lifecycle hangs" change
(commit `09bbf82`, PR #43), study the script system end to end, and debug the
hang it claims to have removed. The previous pass bounded three things it knew
about; this pass was asked to find what it missed.

**Bottom line.** The three named fixes are real and correct, but they do not
close the hang class:

* the *symptom* the previous pass targeted (an abandoned run publishing `done`
  over the loop's terminal `error`) **still reproduced in 3 of 4 measured
  deadlines** — the abort check ran before the write was queued, not before it
  was issued;
* a job that declared **no** deadline was still unbounded, and one such job
  pinned its concurrency slot, every queued job and `drain()` forever;
* an **unbounded `setImmediate`/`nextTick` chain** spun inside one synchronous
  `pump()` and never gave the runtime control back (hard CPU hang);
* a **closed loop** still answered `202` for work that could not run;
* a **stalled KV binding** hung all three note routes with no ceiling at all;
* a note the watchdog had already closed was **resurrected** by its own runner,
  which also paid for a planner + writer call after the browser had stopped
  polling.

Seven residual hang paths are fixed here, each with a regression test
(`tests/script-hang-audit.test.mjs`, 10 tests). Nothing in the existing
script/notes contract changed: **39/39** stay green, and the full suite keeps its
pre-existing totals (456 tests, 392 pass, 58 fail, 6 cancelled — the 58 failures
are the same image/relay/client ones that failed before this change, byte for
byte).

---

## 1. The system, as implemented

Four modules own a script request. Reading them in flow order is the whole
debugging story, because every hang in this report is one of these boundaries
being crossed without a budget.

```
POST /api/script?async=1                          src/index.ts
        │  (route wiring; ctx.waitUntil, the isolate's shared loop)
        ▼
submitAsyncScriptJob                             script-notes-api.ts
        │  1. read/seed the note, noteRunStart("queued")  ──► KV (script-note:<id>)
        │  2. schedule(runJob) on the loop                ──► ScriptEventLoop
        │  3. answer 202 { noteId, noteUrl, pollAfterMs }
        ▼
ScriptEventLoop.schedule → runJob                script-event-loop.ts
        │  phases: timers → pending → poll → check → close
        │  onStart: noteRunActive("planning")             ──► KV
        │  body:    handleSeoScriptGeneration  (deadline + AbortSignal)
        │  onError: noteRunFailed(...)                    ──► KV
        ▼
handleSeoScriptGeneration                        script-seo.ts
        │  reuseScript? → return the note's payload
        │  note read → planner (3×, 45 s) → research (4 s) → writer (3×, 90 s)
        │  every write goes through one ordered promise chain (`noteWrites`)
        │  terminal write: noteRunDone/noteRunFailed → await persistNote()
        ▼
GET /api/script/notes/<id>                       script-notes-api.ts
        │  cache→KV read, staleness watchdog, terminal flag
        ▼
client poll loop (requestScriptNoteOnce)          client/app-js.ts
          900 ms poll, 15 s stall guard, 185 s ceiling, 3 failed polls
```

### The five clocks (and why they must agree)

| Clock | Where | Was measured from | Meaning |
|---|---|---|---|
| `SCRIPT_NOTE_QUEUE_GRACE_MS` = 90 s | reader watchdog | `runStartedAt` | a note may sit in `queued` this long |
| `SCRIPT_NOTE_DEADLINE_MS` = 240 s | reader watchdog | `runStartedAt` | a *started* run may take this long |
| `deadlineMs` (loop) = 240 s | `withDeadline` | **job start** ← bug | when the loop aborts the body |
| `SEO_PLAN/SCRIPT_AI_TIMEOUT_MS` 45 s / 90 s | `runAiCallWithTimeout` | the call | one model attempt |
| client `stallMs` 15 s / ceiling 185 s | `requestScriptNoteOnce` | last state change | when the browser stops |

The reader judges a run from **the ticket** (`runStartedAt` is written when
`submitAsyncScriptJob` accepts it). The loop judged it from **the moment a slot
freed**. Those differ by the whole queue wait, which is unbounded in practice
(24 queued jobs × 240 s). A runner could therefore keep working, and keep
writing, for minutes after the note's own watchdog had declared it dead.

### The note store's two layers

`scriptNoteStore(env)` merges an isolate-local `Map` with KV:

```ts
get(id)  { const cached = await memory.get(id); if (cached) return cached; … }
put(note){ await Promise.all([memory.put(note), kv.put(note)]) }
```

Cache-first reads are fast and right for the hot path, and they were the second
root cause: **any verdict decided from a cache-first read is decided from a copy
that another isolate may already have superseded.**

### The loop's phase machine

`pump()` runs `timers → pending → poll → check → close` synchronously; `poll`
starts jobs while `active < concurrency`; `schedule()` coalesces a duplicate id
onto the running job; `close()` settles every waiter. Two properties matter for
hangs: the loop is a **process-wide singleton** (`scriptEventLoop()`), and a
slot is only freed when the job's *promise* settles — not when the model call
ends.

---

## 2. Verifying the previous pass, claim by claim

| Claim in the previous response | Verdict | Evidence |
|---|---|---|
| "The deadline started after `onStart`, which performs KV work" | **true, fixed** | `withDeadline` arms the timer around `work()`, which awaits `onStart` first |
| "Failed-job reporting could block job settlement" | **true, fixed** | `onError` races a 1 s timer; `runJob` always reaches `finally` |
| "The queue-full inline fallback had no job deadline" | **true, fixed** | inline `Promise.race([work, deadline])` + `AbortController` |
| "Prevented late completions from changing a job's cancelled state" | **true for the job snapshot** | `runJob`'s `finally` skips settle when `state === "cancelled"` |
| "…so a note cannot flip `error → done`" | **FALSE in practice** | reproduced on the committed code: 3 of 4 deadlines ended `done` while the loop recorded `error` |
| "The note-route helper is now used by the router" | true | `isScriptNoteRoute` / `matchScriptNoteRoute` in `index.ts` |
| "The client trusts the server's `terminal` flag" | true | `const terminal = note.terminal === true` |
| "`SCRIPT_JOB_MAX_WAIT_MS` removed" | true | only the client's `SCRIPT_NOTE_MAX_WAIT_MS` remains |
| "`activeNote` is immutable" | cosmetic | the *binding* is `const`; the object is still mutated (by design) |

The regression tests added by that pass (`event-loop deadlines include a stalled
onStart hook…`, `…an expired deadline cancels the run, so a note cannot flip
error -> done`) pass — but they exercise the *hook* and the *stage-boundary*
abort, not the write chain, which is why the flip survived.

---

## 3. What still hung — reproduced, then fixed

Every finding below was reproduced against the committed code with a throwaway
harness before any edit. The harnesses are `/tmp/probes/p*.mjs` (not committed;
the measured output is quoted, and each case is now a committed test).

### F1 — A job with no deadline was unbounded *(hang: slot starvation)*

```js
const loop = new ScriptEventLoop({ concurrency: 1 });
loop.schedule(() => new Promise(() => {}), { id: "forever" });   // no deadlineMs
```

`deadlineMs` was documented as `0/absent = unbounded`. Measured:

```
no-deadline job: HUNG after 801 ms
queued behind it: HUNG
drain(): HUNG [{"id":"forever","state":"active"},{"id":"second","state":"queued"}]
```

One such job owns a slot forever; with `concurrency: 2` two of them wedge the
whole isolate. Every later script queues, every note stays `queued`, and
`drain()` (which `waitUntil` may be holding) never resolves.

**Fix.** `SCRIPT_LOOP_DEFAULT_JOB_DEADLINE_MS` (300 s, constructor-overridable)
so a job that declares no budget inherits one; the watchdog timer is `unref`'d
so it cannot keep the isolate alive by itself (this one mattered: the first
version of the fix made the test process wait 5 minutes).

```
no-deadline job: rejected: script job forever exceeded its 60 ms budget after 62 ms
queued behind it: ok
drain(): drained
```

### F2 — The deadline ignored the queue wait *(hang: work after the verdict)*

`runJob` stamped `startedAt = Date.now()` and `withDeadline` armed the budget
from there, while the note's own watchdog counts from the ticket. A job that
waited 200 s for a slot then got a fresh 240 s.

**Fix.** `budgetFor(job)` subtracts `snapshot.waitMs` (stamped by
`startReadyJobs`) and the timer uses the remainder. A job whose budget is
already spent in the queue never runs its body:

```
rejected: script job late waited 140 ms in the queue and spent its 50 ms budget
(ran === false)
```

### F3 — The `error → done` flip survived *(hang: terminal state lie)*

The pipeline queues writes on `noteWrites` so a heartbeat never blocks a model
call. `if (aborted())` was evaluated **before the write was enqueued**, so a
write that dequeue-ed after the deadline still issued. Measured with a KV whose
`put` takes 120 ms:

```
deadline=120ms -> note error  (loop job: error, "exceeded its 120 ms budget")
deadline=150ms -> note done   (loop job: error)     ← flip
deadline=200ms -> note done   (loop job: error)     ← flip
deadline=260ms -> note done   (loop job: error)     ← flip
```

The client had already been told the run failed; the note then said `done` with
no script body for that verdict.

**Fixes (two, because either one alone leaves a window).**

1. `persistNote` re-checks `options.signal?.aborted` **at write time**, inside
   the chain, and drops the write if the caller has already judged the run.
2. `writeScriptNoteGuarded` applies `noteWriteAllowed(current, incoming)`:
   * a *different* run may only take the note over if its `runStartedAt` is
     **strictly later**;
   * within one run the **first terminal verdict is final** — `done` may not
     land on `error`, `error` may not land on `done`, and a late heartbeat may
     not reopen a judged note.

```
deadline=120/150/200/260ms -> note error in all four cases, loop job error
```

### F4 — A settled note was resurrected by its own runner *(hang: wasted work)*

The watchdog closes a note whose job is still queued (90 s grace). The job then
ran anyway: `markRunning` saw a terminal note and skipped its own write, but the
body still called the planner and the writer, and `noteRunDone` published
`done` over `SCRIPT_NOTE_STALE`. Measured:

```
t=0     queued:        [202, 'queued', '',            false]
t=150   watchdog:      [200, 'error',  'SCRIPT_NOTE_STALE', true]
t=1050  job ran:       [200, 'done',   'SCRIPT_NOTE_STALE', true]   ← resurrected + 2 model calls
```

A `done` note carrying `errorCode: SCRIPT_NOTE_STALE` is not a state any client
can interpret.

**Fix.** `markRunning` reads **fresh** (`readScriptNoteFresh`), records
`settled`, and `runJob` returns before touching a model when the note is already
terminal. `noteRunDone` also clears `errorCode` so a success never carries a
dead verdict's code. Measured after the fix: `error / SCRIPT_NOTE_STALE`,
**0 model calls**.

The complementary case — a *retry* arriving while that job is still in flight —
is handled by `noteRunAdopt`: the retry re-arms the **same** run (keeps
`runId`, refreshes `runStartedAt`) instead of minting a second owner whose
writes the guard would reject. Result: the note goes back to `queued`, the job
finishes, `state: done`, `errorCode: null`.

### F5 — A closed loop still issued tickets *(hang: 90 s of false hope)*

`queueFull` was computed from `loop.stats().queued` only. A closed loop rejects
`schedule()` with "script event loop is closed" — checked nowhere. Measured:

```
status: 202 mode: loop note state: queued terminal: false onValidated calls: 0
```

The client polls a note that only the watchdog can ever close, 90 s later.

**Fix.** `queueFull = loop.isClosed() || queued >= maxQueue`, so both refusals
reach the same two branches. Measured after: with `waitUntil` → `202 mode:
inline`, the job runs, note `done`; without `waitUntil` → `503`, note `error`,
`terminal: true`, and a distinct `SCRIPT_LOOP_CLOSED` code. The inline failure
write is now handed to `waitUntil` instead of being a detached `void
failNote(...)` that the isolate could drop.

### F6 — A stalled KV binding hung every note route *(hang: unbounded I/O)*

`kvNoteStore` swallowed *errors* but had no *ceiling*: `await kv.get(...)` on a
degraded binding parks the request indefinitely. Measured with a binding that
never settles:

```
POST /api/script?async=1 with a stalled KV:   HUNG
GET  /api/script/notes/<id> with a stalled KV: HUNG
POST /api/script/notes with a stalled KV:      HUNG
```

**Fix.** `SCRIPT_NOTE_KV_TIMEOUT_MS = 2000` applied by `withNoteBudget` to every
get/put/delete in `kvNoteStore` (the pending op is left to settle on its own).
A note is an optimisation, so "the binding did not answer" is reported as "no
note", not as a hung request. After: all three settle.

### F7 — The pump never yielded *(hang: CPU livelock)*

`pump()` is a do/while over `pumpAgain`, and `nextTick()`/`immediate()` re-arm
it. A `setImmediate(flush)`-shaped chain therefore runs entirely inside one
synchronous call — no timer, no continuation, no response:

```
(node --import tsx probe, killed at 4 s, never printed)
```

**Fix.** `SCRIPT_LOOP_MAX_PUMP_ITERATIONS = 1000`; past it the pump defers the
remainder to a macrotask (`setTimeout(…, 0)`, `unref`'d), keeping the phase
order while guaranteeing the runtime gets control back. After: the timer fires
(`YIELDED after 28000 ticks`).

### F8 (adjacent) — The watchdog could close a *finished* note

The reader decided from a cache-first copy. If the runner in another isolate had
written `done`, this isolate's stale `planning` copy still looked expired, and
the watchdog wrote `error` over it. **Fix:** the watchdog re-reads **fresh**
before judging (`readScriptNoteFresh`), re-evaluates `noteStaleReason` on that
copy, and logs "already settled elsewhere" instead of closing a finished
script. Test 9 in the new suite pins this.

---

## 4. The invariants this leaves behind

1. **A job is never unbounded.** Absent `deadlineMs` → the default budget.
2. **A budget belongs to the job, not the slot.** It starts when the ticket is
   issued, and a job that spent it queueing does not start.
3. **A job writes no model calls for a note that is already settled.**
4. **A run owns its writes** (`runId` + strictly increasing `runStartedAt`), and
   **its first terminal verdict is final**.
5. **A verdict is read and written through the authoritative store**, not the
   isolate cache.
6. **Every external await in the note routes has a ceiling** (KV 2 s, research
   4 s, model attempts 45 s / 90 s, job 240 s).
7. **The scheduler yields**: no synchronous pump may run forever.

---

## 5. Changes

| File | What changed |
|---|---|
| `src/modules/script-event-loop.ts` | default job budget (+ constructor override), budget measured from acceptance, queue-expired jobs fail without running, pump iteration cap + macrotask yield, `isClosed()`, deadline timer `unref`'d |
| `src/modules/script-notes.ts` | `runId`/`noteRunAdopt`, strictly increasing `runStartedAt`, `noteWriteAllowed`, `writeScriptNoteGuarded`, `readScriptNoteFresh`, `noteRunDone` clears `errorCode`, `SCRIPT_NOTE_KV_TIMEOUT_MS` + `withNoteBudget` around every KV op |
| `src/modules/script-notes-api.ts` | fresh + guarded transitions (`markRunning`, `failNote`), skip-if-settled body, duplicate-ticket adoption, closed-loop fallback, inline verdict write inside `waitUntil`, watchdog re-reads before closing |
| `src/modules/script-seo.ts` | the write chain re-checks the abort at write time and routes terminal writes through the guard (`fresh: true`) |
| `tests/script-hang-audit.test.mjs` | **new**, 10 regression tests, one per finding above |

`git diff --stat`: 4 files, +456 / −67.

---

## 6. Verification

```
tests/script-hang-audit.test.mjs                     10/10 pass   (new)
script-notes-pipeline + script-pipeline-hang +
  script-note-memory                                  39/39 pass   (unchanged)
all four together                                     49/49 pass
full suite                       456 tests, 392 pass, 58 fail, 6 cancelled
                                 (446 + the 10 new; failure set identical to baseline)
tsc --noEmit                     30 diagnostics, all in src/index.ts (untouched);
                                 zero in the four changed modules
wrangler deploy --dry-run        bundles clean (2686 KiB)
```

The 58 failures and 6 cancellations are the **same** image/relay/Quick-Batch
tests that fail on `09bbf82` before this change (verified by diffing the failing
test names: empty diff). They are unrelated to the script pipeline and are not
touched here.

### Re-running the evidence

The committed tests are the reproducible form, but the standalone probes are
kept in `/tmp/probes/` for a manual before/after:

```bash
node --import tsx /tmp/probes/p1-nodeadline.mjs    # slot starvation
node --import tsx /tmp/probes/p2-flip.mjs          # error -> done flip
node --import tsx /tmp/probes/p3-stale-resurrect.mjs
node --import tsx /tmp/probes/p4-closed-loop.mjs
node --import tsx /tmp/probes/p5-kv-hang.mjs
node --import tsx /tmp/probes/p6b-pump-infinite.mjs
```

---

## 7. Known limits (deliberately not changed)

* **KV is eventually consistent.** The guard narrows the reviving window; it
  cannot make two isolates agree instantly. Nothing in this Worker can
  (no CAS, no Durable Object in front of the note store).
* **The 90 s queue grace can still misfire** when the loop is genuinely
  congested (24 queued × 240 s is far longer than the browser's 185 s
  ceiling). The note is then closed early — correctly, and now permanently;
  a retry adopts the still-running job instead of fighting it. A proper fix is
  a queue-wait hint on the ticket, which would change the client contract.
* **`request.clone().json()`** in the note routes is still unbounded; it is
  bounded in practice by the client connection, and the browser already aborts
  at 20 s.
* The 30 `tsc` diagnostics in `src/index.ts` are pre-existing and out of scope.
