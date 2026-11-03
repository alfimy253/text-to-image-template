# Session 278 — who owns a retry? The browser.
> **⚠ SUPERSEDED BY [RULE 35](RULE-35-client-side-script-notes.md) — 2026-11-03 (FIXED IN CODE).**
> This is a historical bug-fix record. It describes the *retired* implementation in which
> script notes were written to Cloudflare KV and polled through async
> tickets. **No script detail is written to KV any more.** Script notes live client-side in
> `localStorage` + the `ytvs_note` cookie with digest/timestamp/script-length consistency
> checks; the Worker's note store is ephemeral memory only (0 KV reads / 0 KV writes). The
> `?async=1` path is now a synchronous compatibility degradation and `asyncScript` is `0`.
> Every KV-note statement below is void; see `system-rules.md` RULE 35 for the current rule.

**Request (verbatim):** *"Study code and check if all retry of code is in browser, because I changed my mind — now the entries (retries) should be in **browser**."*

So this is an audit first (a table of every retry in the codebase with its owner) and then
a move: the retries the worker was doing *for the page* now belong to the page, which
already had an attempt counter, a backoff and a failure-feedback loop of its own.

The pipeline was paying for the same hope twice. One `Generate Script` click could cost
**18 paid inferences** in the worst case (page: 3 attempts × worker: 3 planner + 3 writer),
and the worker's own ladder (3 × 45 s + 3 × 90 s = 405 s) could not fit the 240 s the note
layer promised — the last attempt was always started and then thrown away
(`bug-fix-session-277-slow-pipeline.md`, finding S1).

---

## 1. The audit — who retried what, before this session

| # | Retry ladder | Where | Owner **before** | Cost per click |
|---|---|---|---|---|
| 1 | Script planner: 3 validation attempts, each a single inference (`script-seo.ts`, planner loop) | worker | **worker** | up to 3 |
| 2 | Script writer: 3 attempts (`script-seo.ts`, writer loop) | worker | **worker** | up to 3 |
| 3 | `planOneSeoKeywordSet`: 3 attempts × every slug in `SEO_PLAN_FALLBACK_MODELS`, each call 2 transport attempts (`/api/seo-plan`) | worker | **worker** | up to 6–8 |
| 4 | Script request, whole-request: `SCRIPT_RETRY_LIMIT + 1` = 3 attempts, 250 ms backoff, aborts on `retryable === false` | browser | **browser** ✅ | ×3 on top of #1–#2 |
| 5 | Quick-batch table row script (`generateBatchRowScript`) | browser | **none — one attempt, no retry at all** ❌ | ×1 |
| 6 | Voiceover, chunk mode (the browser pipeline's path): one TTS call, `502 {retryable:true}` on failure | worker | **browser** ✅ (worker does not retry) | — |
| 7 | Voiceover, legacy non-chunk path: 3-attempt MeloTTS loop + external fallback | worker | worker (browser never uses it) | — |
| 8 | Image generation: `IMAGE_BATCH_ATTEMPTS = 2`, `IMAGE_OVERLOAD_ATTEMPTS = 4`, 45 s retry budget, 75 s per attempt, `Retry-After` backoff | worker | **worker** | up to 4 per image |
| 9 | Image prompt / media fetch: `IMAGE_AUTO_RETRY_LIMIT`, `retryImagePromptFlow`, direct Pixabay fetch | browser | **browser** ✅ | — |
| 10 | `api-relay.ts` endpoint rotation (`settings.maxAttempts`) across backup Workers + local backstop | worker | worker (provider-level, not user-level) | — |
| 11 | Note polling: 503 `SCRIPT_NOTE_STORE_BUSY` + `retryAfterMs`, stall guard, wall clock | browser | **browser** ✅ | — |

Two real defects fell out of the audit itself:

* **#5**: the table layout had **no retry of its own** — its only retry *was* the worker's
  ladder. Making the worker single-attempt without fixing this would have made a batch row
  a single-try operation.
* **#3** is not part of the browser contract: `planOneSeoKeywordSet` is only called from
  `src/modules/script-seo.ts` (the `/api/seo-plan` route); no browser caller drives it
  directly, so it keeps its own ladder.

---

## 2. The new contract

```
POST /api/script { ..., browserRetries: true, attempt: n, previousFailure: "...", keywordSet: {...} }
```

* `browserRetries: true` ⇒ the worker makes **exactly one planner attempt and one writer
  attempt** per request (`plannerAttemptLimit = 1`, `writerAttemptLimit = 1`).
* On failure the worker answers `500` with a verdict the page can act on:

```json
{
  "success": false,
  "error": "Script output invalid (too short) - try again",
  "retryable": true,
  "failure": { "stage": "writer", "reason": "too short", "attempts": 1, "retryable": true },
  "keywordSet": { "title": "...", "headings": ["..."], "longTail": "...", "short": ["..."] },
  "noteId": "nt-…", "noteUrl": "/api/script/notes/nt-…"
}
```

* `stage` is `planner` | `writer` | `pipeline` (or `aborted`, which is never retryable).
* `keywordSet` is the **resume point**: the page stores it and sends it back as
  `keywordSet` on the next attempt, and the worker treats it exactly like a warm note —
  the planner is skipped, so attempt 2 costs one writer call instead of two.
* `/api/pipeline-capabilities` now advertises `scriptRetryOwner: "browser"` and
  `browserScriptRetries: 3`. The page only sends the flag when it sees the number, so a new
  page against an old worker (and an old page against a new worker) behave exactly as before.
* Attempt 1+ also rotates the model slug (`SEO_PLAN_FALLBACK_MODELS`), so a retry is not a
  replay of the same call — previously that rotation only existed in the walkthrough.
* A missing AI binding now answers `503 { retryable: false }`. It is a fact about the
  deployment, not about the attempt; the page stops instead of spending three tries.
  The same classifier (`permanentFailure`) drops `retryable` for auth/quota errors.

### The page's side

* `requestScriptWithNotes` reads `caps.browserScriptRetries`, keeps the attempt limit in
  `scriptAttemptLimit`/`scriptAttempts()` (default 3, clamped 1–5) and sends
  `browserRetries` on every request.
* The editor loop and `generateBatchRowScript` both use that limit, both feed
  `previousFailure` forward, both honour `retryable === false`, and both wait
  `retryAfterMs` when the worker asks for a specific pause (clamped to 5 s).
* A resume set **outranks** a local seed (`resumeKeywordSet || seededKeywordSet`): the
  worker's validated plan cannot contradict the note, while a local seed can be older.
* The note poll path forwards `failureStage` with the terminal error, so the *async* path
  (the one the browser actually uses) reports the same verdict as the synchronous one.

---

## 3. Measured

| Scenario | Inferences before | Inferences now |
|---|---|---|
| planner fails, one click (3 page attempts) | 3 × 3 = **9** | 3 × 1 = **3** |
| writer fails, one click | 3 × (3 + 3) = **18** | 2 + 1 + 1 = **4** (attempt 1 plans, attempt 2/3 resume) |
| planner fails, **legacy** client (no flag) | 3 | **3 — unchanged** |
| writer fails, legacy client | 6 | **6 — unchanged** |

The numbers are asserted, not estimated: `tests/script-retry-owner.test.mjs` counts
`env.AI.run` calls (1 for a flagged planner failure, 3 for the legacy ladder, 2 for a
flagged planner+writer run, 1 for a resumed attempt).

---

## 4. What is still worker-owned, and why

* **Image generation** (`image-batch.ts`): `IMAGE_BATCH_ATTEMPTS = 2`,
  `IMAGE_OVERLOAD_ATTEMPTS = 4`, `IMAGE_RETRY_BUDGET_MS = 45000`,
  `IMAGE_ATTEMPT_TIMEOUT_MS = 75000`, plus governor backoff and `Retry-After`.
  These retries are welded to **credit reservation/refund** and to the streaming pacing of
  one batch response — moving them to the page means teaching both layouts to re-request
  individual failed slots and to reconcile refunds. The client currently says
  `[batch-table] partial binary image batch; no automatic replay`, i.e. it has no replay
  path to own today. This is the next candidate, not something to bolt on inside a script
  fix.
* **`api-relay.ts` endpoint rotation** (`settings.maxAttempts` + local backstop): choosing
  another backup Worker is a provider-level failover; a page cannot see the fleet.
* **Legacy voiceover** (non-chunk MeloTTS loop): no browser caller uses this path; chunk
  mode is already one call per request with the page owning the retry.
* **`/api/seo-plan`** (`planOneSeoKeywordSet`, 3 attempts × fallback slugs): only reachable
  from inside the pipeline, not from a page request, so it is not part of the contract.

---

## 5. Tests

`tests/script-retry-owner.test.mjs` (new, 10 tests):

| # | Guard |
|---|---|
| W1 | `browserRetries: true` → exactly **one** planner inference, 500 naming `planner` with `attempts: 1` |
| W2 | no flag → the legacy **three** planner attempts (`attempts: 3`) |
| W3 | writer failure returns `failure.stage: "writer"` **and** the validated `keywordSet` |
| W4 | replaying that set with `attempt: 1` does **one** writer call, no planner prompt, different model slug, `previousFailure` in the prompt |
| W5 | missing AI binding → `503`, `retryable: false` (page stops) |
| W6 | capabilities advertise `scriptRetryOwner: "browser"` + `browserScriptRetries: 3` |
| W7 | the async note records `failureStage: "planner"` and the poll returns it |
| B1 | the real `APP_JS` makes **3** attempts and stops (no fourth), every body carries `browserRetries`, the failure is fed forward |
| B2 | attempt 2 replays the worker's `keywordSet` (not the local pick) and stops at 2 requests when it succeeds |
| B3 | `retryable: false` from the worker ⇒ exactly 1 request |

Results:

* `script-retry-owner` **10/10**.
* Script suites (`script-notes-pipeline`, `script-hang-audit`, `script-slow-pipeline`,
  `seo-plan-resilience`, `script-note-memory`, `script-seo`, `seo-walkthrough`,
  `script-pipeline-hang`, `quick-batch-table`, `session-250-batch-pipeline`,
  `deep-debug-regressions` + the new file): **116 pass / 142**, failing set **identical to
  baseline** `09bbf82` (the 26 image/relay/e2e failures are pre-existing in this sandbox —
  no network, no AI binding).
* Full suite, both trees: **identical failing set** (58 fail + 6 cancelled in each); only
  the numbering differs because this branch adds 28 tests (19 from sessions 276/277, 9 from
  session 278 at that point, 10 now).
* `tsc --noEmit`: **only** the 30 pre-existing `src/index.ts` diagnostics.
* `wrangler deploy --dry-run`: bundle builds (2.7 MiB / 1.29 MiB gzip).

---

## 6. Compatibility

* Requests **without** `browserRetries` keep 3 planner + 3 writer attempts — proven by W2
  and by the untouched `seo-plan-resilience` suite.
* Old workers ignore `browserRetries` (unknown body field) and keep their ladder; the page
  falls back to 3 attempts because no `browserScriptRetries` is advertised.
* Every new field in the error body is additive; the only behaviour change for an old page
  is that a missing AI binding is now `503 retryable:false` instead of a bare 503 — an old
  page already treats `retryable: false` as "stop".


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
