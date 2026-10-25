# AI SEO keyword planning + script keyword retry — debug record (Session #243)

This document covers **why `POST /api/seo-plan` was failing** ("SEO plan failed: …" in the
walkthrough modal) and the **retry contract of every keyword function** in
`src/modules/script-seo.ts`, including the two retry loops that used to abort instead of
retrying. It is the companion to `system-rules.md` RULE 7 / RULE 24 and to
`seo-walkthrough-session-requirements.md`; neither rule changed.

---

## 1. The flow that was failing

| Step | Where | What happens |
| --- | --- | --- |
| 1 | `src/client/app-js.ts` → `generateScript(n)` | **✨ Generate SEO Script** disables `#va-upload-btn-N`, opens `#seo-walkthrough-modal-N` at the *SEO plan* step and `POST /api/seo-plan {topic}` |
| 2 | `src/index.ts` (route) → `handleSeoPlanGeneration()` | plans **two** validated keyword sets, in two sequential planner runs |
| 3 | `planOneSeoKeywordSet()` | builds `buildSeoPlannerPrompt(topic[, avoid])`, calls `env.AI.run(SCRIPT_MODEL, {prompt, max_tokens: 1024, temperature})`, validates with `parseKeywordSet()` |
| 4 | client `renderSeoPlanSets(n)` | renders one card per set; **Select this set** → style step → `POST /api/script {topic, minutes, speed, keywordSet}` |
| 5 | `handleSeoScriptGeneration()` | re-validates `keywordSet` (skips Stage 1) and runs the writer loop → `plainScriptFromCues()` → plain narration text |

Model: `SCRIPT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8"` (`src/index.ts`). The old
`@cf/meta/llama-3.1-8b-instruct` was retired by Cloudflare on **2026-05-30**, so the fp8 slug is
the correct current id — the failure was **not** a retired model. It was the retry/validation
contract around it.

---

## 2. Root causes found

### 2.1 A model error killed the whole plan (no retry at all)

`planOneSeoKeywordSet()` only retried **validation** failures. The `env.AI.run(...)` call was not
wrapped in `try/catch`, so any transport error — `AiError 3043`, a rate limit, a hung call, an
empty reply — propagated out of the function, out of `handleSeoPlanGeneration()` and became a
`500`. One bad call = "SEO plan failed" and the walkthrough dead-ended. The same pattern existed
in **both** Stage-1 (planner) and Stage-2 (writer) loops of `handleSeoScriptGeneration()`.

### 2.2 The second set was mandatory

`handleSeoPlanGeneration()` required **two** distinct sets. The second planner run is asked to
"produce a DIFFERENT keyword set", but the 8B instruct model frequently repeats itself under that
instruction, so `keywordSetsEqual()` rejected it three times and the request answered `500` even
though a perfectly valid first set had already been produced.

### 2.3 Only one exact JSON shape was accepted

`parseKeywordSet()` used to read `longTail` / `short` / `title` / `headings` **verbatim**. The
model regularly answers with `long_tail`, `longtail`, `shorts`, `shortKeywords`, a
comma-separated string instead of an array, `{"keyword": "..."}` objects, five shorts instead of
four, or wrapping quotes. Every one of those was rejected, then rejected again for the same
reason on all three attempts (the retry prompt only quoted the error, not the shape fix).

### 2.4 No per-call timeout

A hung Workers AI call held the request open with no upper bound.

---

## 3. Fixes applied (all in `src/modules/script-seo.ts` unless stated)

| # | Fix | Symbol |
| --- | --- | --- |
| 1 | **Transport retry + timeout**: every planner call is bounded (`SEO_PLAN_AI_TIMEOUT_MS = 45000`) and retried once on a thrown error / empty reply, with a 400 ms backoff | `runPlannerModelCall()` |
| 2 | **Model fallback**: after a model keeps failing, the planner moves to the next slug | `SEO_PLAN_FALLBACK_MODELS`, `planOneSeoKeywordSet(env, model, topic, avoid, fallbackModels)` |
| 3 | **Degraded success**: if the second set cannot be planned, the route answers `200 {success:true, partial:true, sets:[one], warning}` instead of `500` | `handleSeoPlanGeneration()` |
| 4 | **Lenient reply shapes** (still fully validated against RULE 7) | `pickField()`, `coerceStringList()`, `listEntryPhrase()`, `cleanPhrase()` used by `parseKeywordSet()` |
| 5 | **Extra shorts trimmed to four** instead of failing the plan; a reply with too few shorts is still an error (the validator never invents a keyword) | `parseKeywordSet()` |
| 6 | **Stage-1 planner loop retries model errors** — a thrown call consumes one of the three attempts | `handleSeoScriptGeneration()` |
| 7 | **Stage-2 writer loop retries model errors** the same way, clearing `prevCheck`/`prevAudit` so retry coaching stays truthful | `handleSeoScriptGeneration()` |
| 8 | **Client accepts one set** (`data.sets.length >= 1`) and shows the warning line, status text "One SEO keyword set is ready" | `src/client/app-js.ts` → `generateScript()` |

What did **not** change (RULE 7 stays canonical):

* exactly **1** long-tail keyword (no word/character rule, said **≥1×**),
* exactly **4** unique short keywords, each **1–3 words**, said **≥2× each**, no nesting among the
  four shorts,
* title **≤70 chars** containing a short keyword, **1–12** headings **≤12 words** each with a short
  keyword in at least one,
* minimums only — over-use is never a rejection reason, short/long-tail overlap counts for both,
* three attempts per stage, same prompts and the same `500` messages when everything is exhausted.

---

## 4. Retry contract, function by function

| Function | Retries | On what | Gives up with |
| --- | --- | --- | --- |
| `runPlannerModelCall()` | `SEO_PLAN_TRANSPORT_ATTEMPTS = 2` calls per model | thrown error, timeout, empty reply | `{ok:false, error, attempts}` (never throws) |
| `planOneSeoKeywordSet()` | 3 validation attempts × each model in `[scriptModel, ...fallbacks]` | invalid JSON/RULE 7, identical-to-`avoid` set | `Error("SEO keywords invalid (<reason>) - try again")` or `Error("SEO planner model failed (...) - try again")` |
| `handleSeoPlanGeneration()` | first set: none; second set: one whole `planOneSeoKeywordSet()` run | second set missing | `200 partial` with one set (first set failure → `500`) |
| `parseKeywordSet()` | none (pure) | — | `{ok:false, error}` |
| Stage 1 in `handleSeoScriptGeneration()` | 3 attempts, model errors consume one | transport error, empty reply, invalid set | `500 "SEO keywords invalid (...) - try again"` |
| Stage 2 in `handleSeoScriptGeneration()` | 3 attempts, model errors consume one | transport error, invalid SRT, keyword deficit | `500 "Script output invalid (...) - try again"` |
| Browser `runSeoScriptRequest()` | `SCRIPT_RETRY_LIMIT = 2` (3 attempts total) | any non-OK `/api/script` | status line `Script failed after 3 attempts: …` (script box + chips restored) |

Observability: every stage logs `[seo-plan]` / `[script]` records with `reqId`, stage, attempt,
`ms`, the validation reason and — new — the transport error, so a failed plan can be diagnosed
from `wrangler tail` without reproducing it.

---

## 5. Verification

`tests/seo-plan-resilience.test.mjs` (new, 8 tests):

1. a thrown model error is retried on the **same** model;
2. the fallback slug is used when the primary keeps failing;
3. an empty reply consumes an attempt;
4. `seo-plan` answers `200 partial` with one set when the second cannot differ;
5. `seo-plan` still answers `500` when no set can be planned at all;
6. the fallback list contains `@cf/...` ids;
7. lenient reply shapes parse, and too-few shorts are still rejected;
8. `/api/script` retries a planner model error instead of returning `500`.

Existing suites are unchanged and green (`npm test` → 75 tests): `seo-walkthrough.test.mjs`
(two-set success, `keywordSet` skips the planner, invalid set → `400` with no AI call),
`script-seo.test.mjs` (RULE 7 validators), `quick-batch-table.test.mjs`,
`template-composer.test.mjs`, `studio-ui-session-243.test.mjs`.

---

## 6. Known limits after the fix

* Two sequential planner runs still mean up to **6 model calls** in the worst case (plus
  fallbacks). A plan is not streamed; the modal simply waits and can be closed (it re-opens when
  the sets arrive).
* The fallback model is a **bigger** model: more neurons per call. Plans only fall back after the
  primary has failed its transport attempts.
* `parseKeywordSet()` accepts formatting variety, **not** a rule violation: a set that genuinely
  breaks RULE 7 still fails after the third attempt.
* `/api/seo-plan` remains anonymous and does not record usage (RULE 24 register item A-12).
