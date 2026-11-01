# Current code (latest) — the scriptwriting pipeline, why it was slow, and the note + event-loop + browser-memory rewrite

Snapshot of the scriptwriting pipeline on branch **`arena/baeafdab-text-to-image-template`** (base commit
`093c054`). Everything below is derived from the code in `src/`, measured with
`bench/script-pipeline-bench.mjs` and `bench/script-note-memory-bench.mjs`, and guarded by
`tests/script-notes-pipeline.test.mjs`, `tests/script-note-memory.test.mjs` and
`tests/script-pipeline-hang.test.mjs`.

---

## 0. TL;DR

| | before | after: note client | after: + warm note | after: + browser note |
| --- | --- | --- | --- | --- |
| Model calls for a script | planner **1** + writer **1..3** | planner 1 + writer 1 (keyword deficit **repaired locally**) | planner **0** + writer 1 | planner **0** + writer 1, **on the first run** |
| One keyword miss (7.2 s planner / 21 s writer) | **49.3 s** | **28.2 s** | **21.0 s** | **21.0 s** |
| Clean first reply | 28.2 s | 28.2 s | **21.0 s** | **21.0 s** |
| Waiting request | held for the whole 20–90 s, dies with the connection | held (legacy path) | `202` in **3 ms**, script collected from the note URL | `202` in **3 ms** |
| Client request ceiling | **105 s** on one response | **20 s** per request, retried | **20 s** | **20 s** |
| Can the wait end by itself? | no (one promise, one connection) | no (polled without a budget) | no (no stall guard) | **yes**: terminal note, 3-strike reads, 15 s stall window, 185 s ceiling |
| Where the plan lives | only in one response body | Worker KV note | KV + isolate cache | **+ `localStorage` (18 µs) and a cookie mirror (12 µs)** |

Measured with `node --import tsx bench/script-pipeline-bench.mjs` (planner 7.2 s, writer 21 s, page fetch
1.8 s). Pipeline-only overhead with a 0 ms model and a 0 ms fetch: **2–4 ms**.

**This round: retry instead of "give up".** The media side had no retry at all: a Pixabay `429` was
printed and the scene dropped, `The image batch stopped responding for 120 seconds.` **aborted** the batch,
and `The clip took too long to load.` was final after one 15 s attempt. All three now retry with bounded,
visible waits, honouring the provider's own `Retry-After` — see **§2c**.

**Previous round: hang-proofing.** The async ticket could hang in four distinct ways (`202` for work that never
started, `202 pending` forever when the isolate died, `empty` reported as terminal but ignored by the client,
and unbounded retries), and the table layout had no note path at all. All five are fixed and the fix is shared
by **every** script pipeline in **both** layouts — see **§2b**.

---

## 1. What the pipeline is made of

| Piece | File | Role |
| --- | --- | --- |
| `POST /api/script` | `src/modules/script-seo.ts` → `handleSeoScriptGeneration()` | keyword planner → SRT writer → validation → plain narration |
| `POST /api/seo-plan` | same file → `handleSeoPlanGeneration()` | Two selectable keyword sets for the walkthrough |
| Browser walkthrough | `src/client/app-js.ts` → `runSeoScriptRequest()` → `requestScriptWithNotes()` / `requestScriptNoteOnce()` (and `generateBatchRowScript()` for the table layout) | plan → pick set → style → script → poll the note |
| Browser note memory | **new** `src/client/script-notes-client.ts` | `localStorage` → cookie → in-page map, keyed on the canonical dynamic URL |
| Worker notes | **new** `src/modules/script-notes.ts` | research from a dynamic URL, keyword set, beat plan, script, timings, deterministic repair |
| Script event loop | **new** `src/modules/script-event-loop.ts` | Node-style `timers → pending → poll → check → close` scheduler |
| Note / async API | **new** `src/modules/script-notes-api.ts` | `POST /api/script/notes`, `GET|DELETE /api/script/notes/<id>`, `POST /api/script?async=1` |
| Model access | `env.AI.run()` + `runAiCallWithTimeout()` | 45 s planner budget, 90 s writer budget |
| Browser transport | `src/client/browser-offload.ts` → `scriptRequest(init, options)` | per-call `timeout` and `path` (so async mode + 20 s are possible) |

---

## 2. Why it was slow — findings, with the code that caused them

### 2.1 ~~Two model calls, strictly one after the other~~ — **fixed**
The planner ran inside the request and the writer could only start after it. Nothing carried the plan
forward between requests, so every run paid `planner + writer`.
**Fix:** the plan now lives in a note (browser first, KV second) and travels with the request — the first
run after the user picks a keyword set is a **single writer call**. See §3.1, §3.5 and the bench row
`note client + browser note (first run)`: **21.0 s, 0 planner calls**.

### 2.2 ~~Every request re-derived everything~~ — **fixed**
Keyword set, title, headings and section structure existed only in one response body.
**Fix:** a note is written the moment the user picks a set, refreshed after every script, and read from
`localStorage` (18 µs) / cookie (12 µs) / KV in that order.

### 2.3 ~~A validation failure re-generated the whole SRT~~ — **fixed**
The only failure feedback was a sentence, so a one-word keyword deficit cost a complete 21 s regeneration
(up to three). **Fix:** `repairKeywordShortfall()` patches valid cues in place, preserves timings, drops no
words, and re-validates — 49.3 s → 28.2 s.

### 2.4 Timeouts rejected the promise but did not cancel the inference — **open**
`runAiCallWithTimeout()` rejects on its timer while `env.AI.run()` keeps running, so a retry stacks a second
inference. Documented in §7.1 (needs `AbortSignal` support or a single-flight gate).

### 2.5 ~~Dead time on every retry path~~ — **fixed (client side)**
The client held one response for **105 s** while the server budgeted `45 + 90 + 90 s`, and slept
`500 × attempt` between retries.
**Fix:** with the negotiated async path every client request is capped at **20 s** — submit returns in
milliseconds and each poll is its own 20 s request — and the retry backoff is a flat **250 ms**.
The 105 s ceiling remains only for a Worker that advertises neither `scriptNotes` nor `asyncScript`
(one long response is unavoidable there); the code logs when that legacy path is taken.

### 2.6 ~~Long work was welded to the HTTP connection~~ — **fixed**
Work lived and died with the browser connection.
**Fix:** `POST /api/script?async=1` parks the job on the event loop under `ctx.waitUntil`, answers
`202 {noteId, noteUrl}` in ~3 ms, and the note URL is how the request "returns to itself".

---

## 2b. Hang audit — the note/event-loop fix could hang, and here is every variant

The rewrite above made the *slow* path fast, and in doing so introduced a new failure class: a request that
answers `202` and then **never terminates**. Probe with `/tmp/hang-probe.mjs` (drives the real
`worker.fetch`), reproduced for every entry point and both layouts. Each row is a real observed log line,
then the fix that now ships.

| # | Trigger | Observed | Root cause | Fix |
| --- | --- | --- | --- | --- |
| **H1** | Event loop queue is full (`maxQueue`) when `?async=1` arrives | `202` with a ticket whose note sits in `queued` **forever** (`PROBE1 … state after 600 ms: queued`) | `schedule()` rejects, `submitAsyncScriptJob()` swallowed the rejection **after** it had already written the note, so the client polled a note nobody would ever run | a full queue now runs the job **inline** under `ctx.waitUntil` (degraded mode, the work still happens) and the ticket says `mode:"inline"`; without a `waitUntil` there is nowhere for it to run, so the note is closed as `error` `SCRIPT_LOOP_QUEUE_FULL` and the response is **503** `{kind:"overload", retryAfterMs:1500}` — never a ticket for work that will not run |
| **H2** | Isolate dies (or the runtime evicts us) *after* the `202` | `GET /api/script/notes/<id>` answers `202 pending:true` **indefinitely** (`PROBE2 … terminal: false`) | nothing recorded when a run *starts* and nothing compared a note's age with anything | the note now carries `runStartedAt` + `deadlineMs`; `noteStaleReason()` (one rule, `src/modules/script-notes.ts`) is applied **inside the read handler**, which runs in a fresh isolate: a note `queued` past `queueGraceMs` (90 s) or running past `deadlineMs` (240 s) is closed as terminal `error` `SCRIPT_NOTE_STALE` and persisted, so every poller reaches an end. `GET` also returns `waitMs` (remaining budget) for live notes, which the page uses as its proof-of-life window |
| **H3** | Note was closed in state `empty` (planner produced nothing usable) | `200 {state:"empty", terminal:true}` and the client kept polling (`PROBE3`) | the client only treated `done` / `error` as terminal | the client treats **any** `terminal:true` as terminal: `done` → success, everything else → a retryable error carrying the note's `error` text, its `errorCode` and its `state`, so `empty` can never be polled again |
| **H4** | A poll response itself hangs / the note never advances | 20 s per-request timeout retried forever with 250 ms backoff; legacy path still budgeted **105 s** | retries bounded by attempt count only, not by time, and no per-poll stall detector | one shared budget: **20 s per request** (a hung poll is one of 3 failed reads, then the note is declared unreadable), `pollAfterMs` from the server, a **15 s no-progress window** that the note's own `waitMs` extends (so a long, honest writer call is never mistaken for a stall), and a hard wall-clock ceiling (`scriptNoteWaitMs`, default **185 s**) that ends the flow with `SCRIPT_TIMEOUT` |
| **H5** | Table layout (`layout-table`) had **no** note path at all — scripts were typed by hand, so the note + 20 s + async fix only existed in the editor accordion | the slow/hanging behaviour was unreachable from that layout, but so was the fix | the script request was welded to the accordion's `project` object | the requester is now a **layout-agnostic façade** `requestScriptWithNotes(context, {topic, minutes, speed})`, with `scriptContextForProject()` for the accordion and `batchRowScriptContext()` for a table row; the new per-row **✨ AI script** button (`data-batch-generate`, which opens no second `data-batch-action` slot) calls the same function, so both layouts get notes, async tickets, 20 s retries and every hang guard |

### The invariants the fix is allowed to rely on

1. **Every `202` is a promise.** A ticket is only issued when the job is *actually* scheduled (inline counts);
   otherwise the client gets a `5xx` it can retry with backoff.
2. **Every note is reachable from `terminal:true`.** No state may sit non-terminal past its budget: the job
   itself is bounded by the loop's `deadlineMs`, and the **read handler** closes an over-budget note with
   `SCRIPT_NOTE_STALE`. The read handler is the one that matters — it runs in a fresh isolate, i.e. exactly
   when the runner is gone.
3. **The client never polls without a budget.** request 20 s → note read 20 s → 3 attempts → stall 15 s →
   wall clock 185 s (legacy 105 s, unchanged), then a user-facing sentence.
4. **One code path for every layout.** `scriptNoteWaitMs`, `scriptNotePollMs`, `scriptNoteStallMs` are
   advertised in `/api/capabilities` so the page and the tests use the server's numbers, not hard-coded ones.

### The same probes, after the fix

```
PROBE1 status: 503  {"success":false,"error":"The script queue is full - try again in a moment",
                     "kind":"overload","retryAfterMs":1500,…}
PROBE1 note state: error            (was: queued, forever)
PROBE2 status: 200  state: error  terminal: true  pending: false  errorCode: SCRIPT_NOTE_STALE
                     error: "SCRIPT_NOTE_STALE:queued:600s>90s"     (was: 202 pending, forever)
PROBE3 (server unchanged: 200 state "empty" terminal true) — the client now stops after one read per
       attempt instead of polling (tests/script-pipeline-hang.test.mjs H3)
```

Cost of the one bookkeeping write added per job (the note moves to `planning` when its run actually starts,
so the staleness clock is honest): a single KV put before a 20–90 s model call. The async bench is unchanged
(ticket **2 ms**, 33 polls, note `done`).


---

## 2c. From "give up" to "retry" — the Pixabay image flow and the clip probe

The script pipeline now *waits* correctly (20 s per request, notes, stall windows). The **media** side did
not: every guard there ended the flow and printed a sentence. Three of those sentences are literal
"give up" messages, and the only two-minute number in the whole client (`IMAGE_BATCH_IDLE_TIMEOUT_MS`,
**120 s**) **aborted** the batch instead of retrying it. This round turns all of them into retries.

| What the user saw | Where it was produced | What happens now |
| --- | --- | --- |
| `Pixabay rate limit (429). Please wait before searching again.` | `src/modules/pixabay.ts:183` (per-fingerprint budget) and `:229` (provider `429`), mirrored by `src/client/pixabay-direct.ts:318` / `:414`; a `Retry-After` header travels with it | the scene **waits the wait the provider asked for** and retries; if the whole pass still fails, the flow **schedules an automatic retry** with a visible countdown and re-searches only the missing scenes |
| `The image batch stopped responding for 120 seconds.` | `src/client/app-js.ts` `runImageBatch` → `armIdleTimer()` (`IMAGE_BATCH_IDLE_TIMEOUT_MS`, 120 s) | the timer still aborts the stuck stream (a stalled `fetch` must be cut), but it now **records the stop as retryable** and the finalizer re-arms the flow for whatever is still missing — up to `IMAGE_AUTO_RETRY_LIMIT` times |
| `The clip took too long to load.` | `probeMp4Duration` (`CLIP_PROBE_TIMEOUT_MS`, 15 s) | `probeMp4DurationWithRetry` tries **up to 3 times** with a fresh `<video>` element and a 400 ms × attempt backoff before the message is allowed through |
| `Some Pixabay searches failed; successful assets were kept.` / `Image generation was interrupted…` | `retryImagePromptFlow` / `runBinaryEditorImages` | each **scene** gets 3 attempts (429 / 5xx / network / timeout), and a single stalled scene is re-armed on a fresh `AbortController` instead of aborting the run |

### Three layers, in the order they fire

1. **Inside one scene** (`retryImagePromptFlow`, `SCENE_RETRY_ATTEMPTS = 3`, base 800 ms, capped 15 s).
   The wait is `retryAfterMs` when the server sent one (body field, or the `Retry-After` header read by
   `mediaRetryHintMs`), otherwise 800 ms → 1.6 s. "No results for this keyword" is *not* retried — that is
   an answer, not a transmission error (`SCENE_RETRYABLE`).
2. **One scene that stops answering** (`armSceneWatchdog`, `SCENE_IDLE_TIMEOUT_MS = 90 s`). It aborts only
   *that attempt*, swaps in a new `AbortController`, and continues the attempt loop. Before, an abort of the
   shared controller broke out of the whole run.
3. **The flow itself** (`maybeScheduleImageAutoRetry` in `finalizeImagePromptFlow`). Every stop reason passes
   through `imageAutoRetryPlan`, which decides retry vs. verdict, then `scheduleImageAutoRetry` paints
   `Pixabay is busy — retrying the missing scenes automatically in 12s (attempt 1 of 2)…` and calls
   `retryImagePromptFlow(n)` when the countdown ends. The re-run reuses `project.imagePrompts` and
   `imageSceneGapCount()` so **delivered scenes are never searched or billed twice**.

### The numbers

| Constant | Value | Meaning |
| --- | --- | --- |
| `IMAGE_AUTO_RETRY_LIMIT` | **2** | automatic retries per flow; after that the manual "Retry Pixabay search" button is the path |
| `IMAGE_AUTO_RETRY_MIN_MS` / `_MAX_MS` | **2 000 / 120 000** | a provider hint is clamped into this window, so a 1-hour Pixabay reset cannot freeze the tab |
| `IMAGE_AUTO_RETRY_FALLBACK_MS` | **15 000** | wait when the stop reason carried no hint (× attempt) |
| `IMAGE_AUTO_RETRY_TICK_MS` | **500** | countdown refresh (a chained `setTimeout`, not `setInterval` — the client still contains none) |
| `SCENE_RETRY_ATTEMPTS` | **3** | per scene, per pass |
| `SCENE_RETRY_BASE_MS` / `_MAX_MS` | **800 / 15 000** | exponential backoff when the server gave no wait |
| `SCENE_IDLE_TIMEOUT_MS` | **90 000** | one scene that stops answering is aborted **and re-armed** |
| `CLIP_PROBE_ATTEMPTS` / `_RETRY_DELAY_MS` | **3 / 400** | a clip that failed to load gets a fresh element and another 15 s window |

### What is deliberately **not** retried

`IMAGE_VERDICT_REASON` short-circuits the planner: a missing API key (`Pixabay API key is not configured`),
`401`/`403`, a full gallery, a spent allowance or a quota refusal answer identically on every attempt.
Retrying them would replace a precise sentence with a countdown — the exact failure
`tests/pixabay-studio-flow.test.mjs` caught while this was being written.

### Bounds and cancellation

* At most **2** automatic retries **× 3** scene attempts, then the flow ends the old way and the button is
  shown (`tests/pixabay-auto-retry.test.mjs`, "the automatic retry is capped…").
* Solved by: starting another flow (`startImagePromptFlow` resets the budget), the Retry button
  (`retryImagePromptFlow` cancels a pending countdown), and deleting the video
  (`cancelImageAutoRetry` on `_deleted`). There is still no Stop button for this flow — the cancellation
  points above are the whole surface.
* Every window is overridable for tests: `window.__IMAGE_AUTO_RETRY_TIMING`,
  `window.__PIXABAY_SCENE_RETRY`, `window.__CLIP_PROBE_TIMING`.
* Observability: `console.info("[seo-image-flow] auto retry …")` on every transition and a rolling
  `window.__IMAGE_AUTO_RETRY_LOG` (last 12 entries: `scheduled` / `running` / `skipped` / `cancelled`).

---

## 3. What was built

### 3.1 Browser note memory (`src/client/script-notes-client.ts`) — **new**

Three backends, tried in this order on every read:

| Backend | What it holds | Typical cost | When it is used |
| --- | --- | --- | --- |
| in-page map | the newest 24 notes | 0 µs | same page session |
| `localStorage` (`ytvs.script-notes.v1`) | full note: keyword set, beat plan, script, timings | **18 µs** | normal repeat run (survives reloads) |
| cookie (`ytvs_note`) | compact mirror: note id, keyword set, ≤4 beats | **12 µs** | private mode / storage disabled / quota exhausted |

* Keyed on `u:<canonical url>` (or `t:<topic>`) + `|minutes|speed` — the same collapse rules as the Worker,
  so `https://www.example.com/x/?utm_source=a#top` and `example.com/x` are the same entry.
* TTL 7 days, capped at 24 entries / 256 KB; quota errors drop the oldest half and retry once, then fall
  back to the cookie and the page map (the store never throws into the UI).
* The cookie is trimmed until it fits 3.4 KB (beats → 2 → 0 → drop keyword set); measured footprint:
  **3.4 KB in localStorage, 1.03 KB in the cookie**.
* `outlineFor(keywordSet, minutes, speed)` builds a beat plan from the headings the user just picked
  (140/170/210/110 words per minute by speed), so the browser can hand the worker a plan **without any
  network call**.
* No secrets, no tokens, no prompt text: a note is the public keyword set, heading titles and the script the
  user already sees. `clear()` removes both stores.

**Why the browser copy is faster than the server one:** a KV read is a network round trip
(tens–hundreds of ms) that must finish before a token is generated; a `localStorage` read is a synchronous
property access plus one `JSON.parse` — 18 µs measured, 5–6 orders of magnitude cheaper — and it works while
offline. KV stays authoritative (shared across devices, validated server-side, survives a cleared browser).

### 3.2 Worker notes (`src/modules/script-notes.ts`)

A note record holds: dynamic-URL key, state (`queued → planning → writing → repairing → done|error`),
researched source (title/description/headings/keywords/facts), validated `keywordSet`, `outline` (beat plan
with word budgets), `script`, `durationMs`, `timings`, `repairedKeywords`, `origin` (`server`/`browser`) and
the exact success `payload` for async pollers. Stored in KV as `script-note:<id>` (TTL 7 d, mirrored into a
bounded in-isolate map).

* `canonicalSourceUrl()` (`:169`) / `scriptNoteId()` (`:237`) — same collapse rules as the browser, FNV-1a id.
* `topicFromUrl()` — a URL topic becomes a prompt subject (`/morning-yoga-routine` → "morning yoga routine"),
  never a raw URL; once research lands, the writer uses the real page title.
* `researchSourceUrl()` (`:592`) — model-free page read: 4 s timeout, 400 KB cap, text types only, `http(s)`
  only, private hosts refused.
* `buildNoteOutline()` (`:709`) / `buildNoteWriterBrief()` (`:752`) — beat plan + the compact prompt block.
* `repairKeywordShortfall()` (`:835`) — deterministic keyword patch (see §2.3).
* `sanitizeClientNote()` — the browser hint is untrusted: beats clamped to 8 entries / 110 + 200 chars,
  keyword set re-validated with `parseKeywordSet`, stale (>7 d) or invalid hints ignored.

### 3.3 Script event loop (`src/modules/script-event-loop.ts`)

`timers → pending → poll → check → close` (`:94`), `nextTick`/`immediate`/`defer`, concurrency **2**,
queue cap 24 (`SCRIPT_LOOP_QUEUE_FULL` degrades to inline), per-job `deadlineMs`, `onStart/onFinish/onError`
hooks that move the note's state, `drain()` for `ctx.waitUntil`, and `stats()` (ticks, per-phase counters,
active/queued, wait/run times) exposed in `debug.eventLoop`. The page research is a job in the same `poll`
phase as the planner, so a page read hides inside the planner call instead of adding to it.

### 3.4 Note + async API (`src/modules/script-notes-api.ts`)

| Route | What it does |
| --- | --- |
| `POST /api/script/notes` | Write a note down: `{url?, topic?, minutes?, speed?, keywordSet?, refresh?}` → `{noteId, noteUrl, researchMs, note}` |
| `GET /api/script/notes/<id>` | `state`, `pending`, `terminal`, `outline`, `keywords`, `script`, `result` (the exact sync payload), `error`; `202` + `Retry-After` while running |
| `DELETE /api/script/notes/<id>` | Forget it |
| `POST /api/script?async=1` | `202 {pending, noteId, noteUrl, pollAfterMs}` in ~3 ms; the job runs on the loop |

```mermaid
sequenceDiagram
    participant B as Browser (localStorage/cookie)
    participant W as Worker
    participant L as ScriptEventLoop
    participant N as Note (KV)
    B->>B: pick keyword set → note written locally (18 µs)
    B->>W: POST /api/script?async=1 {useNotes, note:{keywordSet,outline}}
    W->>N: state=queued
    W->>L: schedule(job, deadline 240 s)
    W-->>B: 202 {noteId, noteUrl, pollAfterMs}   (3 ms)
    Note over L: waitUntil keeps the isolate alive; planner skipped (browser carried the plan)
    L->>N: state=writing → done {script, payload, outline}
    loop every ~900 ms, 20 s per poll
        B->>N: GET /api/script/notes/<id>
        N-->>B: 202 {state} / 200 {state:"done", result}
    end
    B->>B: store the finished note (script + beats) for the next run
```

### 3.5 Pipeline wiring (`src/modules/script-seo.ts`)

```text
validate ─► note context (body.note = browser hint) ─► read/create note (+hit)
   ├─ research page   (loop job, PARALLEL with the planner)
   └─ keyword set     : top-level keywordSet ▸ body.note.keywordSet ▸ KV note ▸ planner
        └─ await research ─► beat plan ─► writer brief
             └─ writer (1..3 attempts) ─► SRT valid but keyword short? ─► local repair
                  └─ success ─► note write-back + browser payload {noteId, outline, timings}
```

Body additions: `useNotes`/`notes`, `noteId`, `sourceUrl`/`url`, `note`, `reuseScript`, `repairKeywords`.
Response additions: `noteId`, `noteUrl`, `noteHits`, `notePlannerSkipped`, `noteOrigin`, `outline`,
`repaired`, `repairedKeywords`, `repairMs`, `timings`, `debug.eventLoop`.

### 3.6 Worker routing (`src/index.ts`)

Note routes before `/api/script`, shared `scriptNoteDeps` (fetch, `ctx.waitUntil`, isolate loop),
`?async=1` → `submitAsyncScriptJob()` with the same credit callback, and additive capabilities:
`scriptNotes: 1`, `asyncScript: 1`, `noteRepair: 1`, `scriptNotePollMs: 900` (`version` stays 261).
The hang budgets are advertised the same way: `scriptNoteWaitMs: 185000`, `scriptNoteStallMs: 15000`,
`scriptNoteQueueGraceMs: 90000`, `scriptNoteDeadlineMs: 240000` — and `GET /api/script/notes/<id>` receives
those budgets so the read handler and the page can never disagree about when a note is dead.

### 3.7 Browser request path (`src/client/app-js.ts`)

* On keyword-set selection → `scriptNoteMemory.put({keywordSet, outline: outlineFor(...)})`.
* On script request → `note: {keywordSet, outline, updatedAt}` + `useNotes` (only when `scriptNotes` is
  advertised), async when `asyncScript` is advertised.
* `requestScriptNoteOnce()` polls the note URL: `pollAfterMs` cadence (900 ms default), **20 s per read**,
  185 s ceiling, cancellation-aware, tolerant of a dropped read but not of three in a row, and it stops on
  **any** terminal note — not only `done`/`error` (H3), with a stall window that the note's `waitMs` extends (H4).
* `requestScriptWithNotes(context, {topic, minutes, speed})` is the only script requester: the editor
  accordion and the quick-batch table both go through it, so neither layout can drift back to the 105 s path.
* `fetchWithTimeout()` and `studioOffload.scriptRequest({timeout, path})` make the 20 s ceiling and the async
  path real for both transport branches; a timeout is `retryable`, so the existing 3-attempt loop retries in
  ~250 ms instead of after 105 s.
* On success the note (id, keyword set, beats, script, duration) is written to browser memory.

---

## 4. Correctness, compatibility and safety

* **Opt-in everywhere.** Notes need `useNotes`/`notes`/`noteId`/URL (or the async route); the client switches
  only when the Worker advertises `scriptNotes`/`asyncScript`. Old clients and old Workers behave exactly as
  before — the legacy "3 model calls on a keyword deficit" test still passes.
* **Precedence is explicit:** top-level `keywordSet` ▸ `body.note.keywordSet` ▸ KV note ▸ planner. A server
  note is never overwritten by a browser copy, so a stale tab cannot rewrite a plan.
* **Browser hints are untrusted:** re-validated (`parseKeywordSet`, clamped beats, 7-day TTL), ignored when
  corrupt/stale, and they only fill gaps.
* **Repair is validated, not trusted:** the patched SRT is re-run through `validateSrt()` and
  `keywordUsageError()`, timings preserved, no cue loses a word.
* **Research is bounded and SSRF-safe:** `http(s)` only, private hosts refused, 4 s, 400 KB, text only.
* **Billing unchanged:** notes (Browser or KV) are non-billable metadata; async uses the same `onValidated`
  credit callback as sync.
* **Failure containment:** storage errors, unreachable URLs, a full loop queue, a failed note write — all
  degrade to the previous behaviour instead of failing the script.

---

## 5. Measured results

### 5.1 Pipeline (`bench/script-pipeline-bench.mjs`)

```bash
node --import tsx bench/script-pipeline-bench.mjs
node --import tsx bench/script-pipeline-bench.mjs --planner-ms 7200 --writer-ms 21000 --fetch-ms 1800
```

Recorded run:

```
Pipeline overhead with a 0 ms model and a 0 ms page fetch: 4 ms

| scenario                                                | calls (planner/writer) | response | waits for |
| ------------------------------------------------------- | ---------------------- | -------- | --------- |
| legacy, first writer reply misses a keyword             | 1/2                    | 200      | 49287 ms  |
| legacy, clean first reply                               | 1/1                    | 200      | 28232 ms  |
| note client, cold note + source URL                     | 1/1 (repaired)         | 200      | 28231 ms  |
| note client, warm note (run 1)                          | 1/1 (repaired)         | 200      | 28228 ms  |
| note client, warm note (run 2)                          | 0/1                    | 200      | 21023 ms  |
| note client + browser note (first run, misses keyword)  | 0/1 (repaired)         | 200      | 21025 ms  |
| note client + browser note (first run, clean reply)     | 0/1                    | 200      | 21023 ms  |
| async submit (ticket returned immediately)              | —                      | 202      | 3 ms      |
| async job finished (note polled 33×)                    | 1/1                    | 200      | 28852 ms  |
```

* **one keyword miss: 49.3 s → 28.2 s (−43 %)** — repair instead of a second full regeneration.
* **repeat run: 28.2 s → 21.0 s (−25 %)** — planner skipped.
* **first run with a browser note: 28.2 s → 21.0 s, and 49.3 s → 21.0 s (−57 %) on the keyword-miss path** —
  the serial planner→writer chain is gone from the very first request.
* **the waiting request is 3 ms**; the work happens in the note.

### 5.2 Browser memory (`bench/script-note-memory-bench.mjs`)

```bash
node --import tsx bench/script-note-memory-bench.mjs --ops 20000
```

```
| operation                             | µs/op | notes                                        |
| ------------------------------------- | ----- | -------------------------------------------- |
| get from localStorage                 | 18.28 | repeat script for the same topic/URL         |
| get from cookie mirror                | 11.64 | localStorage blocked (private mode / quota)  |
| canonicalUrl + keyFor                 |  3.15 | URL + topic + minutes + speed → key          |
| miss (empty storage)                  |  5.73 | first visit: falls through to the network    |
| put (localStorage + cookie mirror)    | 60.29 | after a finished script                      |

Stored note size: 3.4 KB in localStorage, 1.03 KB in the cookie mirror.
```

So the browser copy costs ~0.02 ms against a KV read's one network round trip (tens to hundreds of ms). The
server note remains the cross-device, authoritative copy; the browser copy is what makes the plan available
before the first token.

---

## 6. Tests

`tests/script-notes-pipeline.test.mjs` (13):
dynamic-URL canonicalization · model-free research + SSRF refusal + timeout · note write/read round trip ·
URL-topic research and warm reuse · **a browser note removes the planner on the first run** ·
**corrupt/stale browser notes are ignored** · **a server note outranks the browser copy** · warm note skips
the planner (+ `reuseScript` = 0 calls) · keyword deficit repaired locally while the legacy 3-call contract
is preserved · repair keeps timings and words · async `202 → loop → note done` · event-loop phase order +
concurrency + queue cap + failure isolation · writer-brief size.

`tests/script-note-memory.test.mjs` (6):
canonical keying matches the Worker · localStorage round trip on reload · cookie fallback with
`localStorage` throwing · cookie budget/expiry/24-entry cap · client beat plan without a network call ·
**studio integration**: keyword pick seeds the note, the request carries `note`, async mode is used, the note
URL is polled, the script is applied and mirrored back into `localStorage`.

`tests/script-pipeline-hang.test.mjs` (9, **new this round**) — every hang in §2b, one test each:
**H1** a full queue answers `503` + terminal note (and `202 mode:"inline"` when `waitUntil` exists) ·
**H2** a note whose runner died is closed as `SCRIPT_NOTE_STALE`, while a genuinely running note is left alone
and reports `waitMs` · **H3** a terminal `empty` note stops the flow after one read per attempt ·
**H4** a note that never advances ends inside the advertised budget, with a user-facing sentence ·
**H5** a quick-batch row writes its script through the same note pipeline, and the button refuses an empty
cell · the advertised budgets (`scriptNoteWaitMs < scriptNoteDeadlineMs`) · the page exposes the same numbers
(`window.__SCRIPT_PIPELINE_TIMING`).

`tests/pixabay-auto-retry.test.mjs` (6, **new this round**) — the §2c contract:
a `429` + `Retry-After` is waited out and the flow retries itself with a countdown and no click · the retry
budget is capped and then hands control back to the button · the idle abort is *planned* as a retry and
delivered scenes are never counted again · a real silent `/api/image-batch` stream trips the guard (30 ms via
`__SEO_FLOW_TIMING`) and arms the countdown · a rejected credential is a verdict, not a retry · the clip probe
retries once and succeeds, and only gives up after three attempts.

`tests/pixabay-image-ui.test.mjs` (2, **updated**) — the same walkthrough now expects the transient `502`
to be absorbed by the in-scene retry (6 searches for 4 missing scenes, all 4 imported) instead of lost, and
a second click with a complete gallery to search nothing at all.

Full suite: `node --import tsx --test tests/*.test.mjs` → **435 tests, 371 pass, 58 fail** (6 cancelled).
The 58 failures are pre-existing on the base commit (**401 tests, 337 pass, 58 fail** for the *first* round's
base; the same list — all in the Pixabay/media/binary-relay flow — fails with and without this work, verified
by stashing the change and re-running the affected files). This work adds 28 passing tests and removes no
coverage; `tsc` reports **no new errors** versus the base commit (diff of the sorted error lists is empty).

---

## 7. Where the remaining time goes

| # | Item | Status |
| --- | --- | --- |
| 7.1 | Cancel the abandoned inference (`env.AI.run` keeps running after our timeout, so retries stack) | **open** — needs `AbortSignal` support or a single-flight gate |
| 7.2 | Cross-isolate job state (the loop is per isolate; a poll on another isolate reads the KV note but cannot resume the job) | **open** — one Durable Object per note id would make jobs resumable |
| 7.3 | Pre-warm the note during the walkthrough (research the URL while the user picks a set) | partially done — the browser note covers the plan; the page research still starts on the script request |
| 7.4 | Notes for the scene planner (`src/modules/image-prompts.ts` re-derives scene keywords every request) | **open** |
| 7.5 | Stream the writer so the first scenes can render before the script ends | **open** |
| 7.6 | Resume a note whose isolate died (the note is now *closed* honestly, but the work is not resumed) | **open** — needs 7.2 |
| 7.8 | There is no Stop button for the Pixabay image flow; cancellation is "start another flow / retry / delete the video" | **open** — the countdown is cancellable, the flow itself has no stop control |
| 7.9 | The 429 wait can reach `IMAGE_AUTO_RETRY_MAX_MS` (120 s), so a heavily-throttled key still feels slow | by design — the alternative is a silent failure; a queue that spreads scenes over minutes would fix it |
| 7.7 | A deep queue still waits (90 s grace, then `SCRIPT_NOTE_STALE`); a priority lane would keep a fresh ticket ahead of a batch | **open** |

---

## 8. File map of this change

| File | Change |
| --- | --- |
| `src/client/script-notes-client.ts` | **new** — browser note memory: localStorage → cookie → page map, canonical URL keying, client beat plan |
| `src/modules/script-notes.ts` | **new** — dynamic-URL notes, research, beat plan, writer brief, deterministic repair, KV/memory store, `sanitizeClientNote` |
| `src/modules/script-event-loop.ts` | **new** — phased scheduler, concurrency, queue cap, deadlines, stats |
| `src/modules/script-notes-api.ts` | **new** — note routes + `POST /api/script?async=1` |
| `src/modules/script-seo.ts` | note-aware pipeline: browser/KV note precedence, planner skip, parallel research, local repair, timings, write-back |
| `src/index.ts` | note routes, async route, `ctx.waitUntil`, capability flags |
| `src/client/app-js.ts` | **this round:** `probeMp4DurationWithRetry` + `CLIP_PROBE_ATTEMPTS`, per-scene retries in `retryImagePromptFlow` (with a re-arming 90 s watchdog and `Retry-After` parsing), the flow-level `scheduleImageAutoRetry` / `maybeScheduleImageAutoRetry` countdown, and the retry markers set by the 120 s idle timer and the 429/503 batch path. Earlier: seed on keyword pick, send `note`, async submit + note polling, 20 s request ceiling, 250 ms retry backoff, mirror the finished note; **this round:** one layout-agnostic requester (`requestScriptWithNotes` + `scriptContextForProject` / `batchRowScriptContext`), the hang-proof poller (terminal state, 3-strike reads, stall window, ceiling), the quick-batch row's ✨ script button, `__SCRIPT_PIPELINE_TIMING` for tests |
| `src/client/styles.ts` | `.batch-row-ai` (the row's script button) |
| `src/client/browser-offload.ts` | `scriptRequest({timeout, path})` — per-call ceiling and async path |
| `tests/script-notes-pipeline.test.mjs` | **new** — 13 tests |
| `tests/script-note-memory.test.mjs` | **new** — 6 tests |
| `tests/script-pipeline-hang.test.mjs` | **new** — 9 hang regressions (H1–H5, advertised budgets, exposed timing) |
| `tests/pixabay-auto-retry.test.mjs` | **new** — 6 tests for the auto-retry ladder (429 wait, cap, idle plan, silent-stream guard, verdict, clip probe) |
| `tests/pixabay-image-ui.test.mjs` | **updated** — the transient search failure is now absorbed by the scene retry |
| `bench/script-pipeline-bench.mjs` | **new** — pipeline before/after |
| `bench/script-note-memory-bench.mjs` | **new** — browser memory cost |
| `SYSTEM_FLOW.md` | route map updated |
