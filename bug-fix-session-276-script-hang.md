# Session 276 — deep debug: the script pipeline hang
> **⚠ SUPERSEDED BY [RULE 35](RULE-35-client-side-script-notes.md) — 2026-11-03 (FIXED IN CODE).**
> This is a historical bug-fix record. It describes the *retired* implementation in which
> script notes were written to Cloudflare KV and polled through async
> tickets. **No script detail is written to KV any more.** Script notes live client-side in
> `localStorage` + the `ytvs_note` cookie with digest/timestamp/script-length consistency
> checks; the Worker's note store is ephemeral memory only (0 KV reads / 0 KV writes). The
> `?async=1` path is now a synchronous compatibility degradation and `asyncScript` is `0`.
> Every KV-note statement below is void; see `system-rules.md` RULE 35 for the current rule.

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
* a **stalled KV binding** hung all three note routes with no ceiling at all — *historical*: RULE 35 removed KV from the note store entirely;
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
        │  1. read/seed the note, noteRunStart("queued")  ──► ephemeral memory (RULE 35: no KV)
        │  2. schedule(runJob) on the loop                ──► ScriptEventLoop
        │  3. answer 202 { noteId, noteUrl, pollAfterMs }
        ▼
ScriptEventLoop.schedule → runJob                script-event-loop.ts
        │  phases: timers → pending → poll → check → close
        │  onStart: noteRunActive("planning")             ──► ephemeral memory
        │  body:    handleSeoScriptGeneration  (deadline + AbortSignal)
        │  onError: noteRunFailed(...)                    ──► ephemeral memory
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

### The note store — memory only (RULE 35, 2026-11-03)

`scriptNoteStore(env)` **ignores `env.KV_BINDING`**. There is one layer, a bounded
per-isolate `Map`; the durable note is the browser's `localStorage` full copy plus the
`ytvs_note` cookie digest mirror, reconciled by digest/timestamp/script-length checks.

```ts
get(id)  { return memory.get(id); }        // 0 KV reads
put(note){ return memory.put(note); }      // 0 KV writes
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

### F6 — HISTORICAL: a stalled KV binding hung every note route *(removed by RULE 35)*

`kvNoteStore` swallowed *errors* but had no *ceiling*: `await kv.get(...)` on a
degraded binding parks the request indefinitely. Measured with a binding that
never settles:

```
POST /api/script?async=1 with a stalled KV:   HUNG
GET  /api/script/notes/<id> with a stalled KV: HUNG
POST /api/script/notes with a stalled KV:      HUNG
```

**Current fix (RULE 35):** the KV binding is no longer used by the note store at all, so a
stalled binding cannot hang a note route. `kvNoteStore()` survives only as a memory-only
deprecated shim; the 2 s `withNoteBudget` timeout is obsolete. Script notes live in
`localStorage` + a cookie with explicit consistency checks between those two stores.

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
6. **Every external await in the note routes has a ceiling** (no KV I/O under RULE 35,
   research 4 s, model attempts 45 s / 90 s, job 240 s).
7. **The scheduler yields**: no synchronous pump may run forever.

---

## 5. Changes

| File | What changed |
|---|---|
| `src/modules/script-event-loop.ts` | default job budget (+ constructor override), budget measured from acceptance, queue-expired jobs fail without running, pump iteration cap + macrotask yield, `isClosed()`, deadline timer `unref`'d |
| `src/modules/script-notes.ts` | `runId`/`noteRunAdopt`, strictly increasing `runStartedAt`, `noteWriteAllowed`, `writeScriptNoteGuarded`, `readScriptNoteFresh`, `noteRunDone` clears `errorCode`, **RULE 35: memory-only store, zero KV reads/writes/deletes** |
| `src/modules/script-notes-api.ts` | RULE 35 `clientSideOnly`/`persisted:false` responses; fresh + guarded transitions (`markRunning`, `failNote`), skip-if-settled body, duplicate-ticket adoption, closed-loop fallback, inline verdict write inside `waitUntil`, watchdog re-reads before closing |
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
