# Bug Fix Session #272 — Pixabay scene keyword planner: "Scene keyword planner returned invalid JSON"

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

**Date:** 2026-10-28 · **Branch:** `arena/1f8d191c-text-to-image-template`
**Scope:** the reported studio status line

> `Pixabay image flow stopped: Stock search terms could not be generated or rendered:`
> `Scene keyword planner returned invalid JSON 0 image(s) added to the gallery.`
> `Upload Image, GIF or MP4 is enabled again.`

---

## 1. The failing flow — where each phrase comes from

| Step | Where | What happens |
| --- | --- | --- |
| 1 | `src/client/app-js.ts` → `runProgressiveImagePipeline()` (`src/client/progressive-image-pipeline.ts`) | the editor / Quick Batch automatic media flow plans scene keywords in browser-managed chunks of ≤ 3 (`batch: {offset, count, attempt 0-2}`), at most 3 attempts per chunk with backoff |
| 2 | `POST /api/image-prompts` → `handleGenerateImagePrompts()` → `generateImagePrompts()` (`src/modules/image-prompts.ts`) | one `env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", …)` call (45 s budget, 2,048 output tokens) plans `{"scenes":[{"type","keywords"}]}` |
| 3 | the model reply | was parsed with a bare `JSON.parse()` after only trimming a leading <code>```json</code> fence and a trailing fence |
| 4 | any parse throw | became **"Scene keyword planner returned invalid JSON"** → `502` → after three browser attempts `finalizeImagePromptFlow()` prints the status line above and re-enables **Upload Image, GIF or MP4** |

The recovery half of the message ("0 image(s) added … Upload … enabled again") is the flow's
designed graceful stop and works correctly; the bug is that the planner declared a usable
reply "invalid JSON" over **formatting**, stopping a flow that had a valid plan in hand.

## 2. Root cause

The strict parser rejected replies that contained a usable plan:

1. **Prose around the JSON** — "Here are the searches: `{...}` Let me know…", including
   ```` ```json ```` fences with trailing text (the fence trim only matched at string
   start/end, so trailing prose after the closing fence survived into `JSON.parse`).
2. **Literal newlines/tabs inside JSON string values and trailing commas** —
   `repairJsonControlChars()` already existed in the same file for the legacy
   `parseImagePrompts()` path but was never applied to the planner.
3. **Truncated JSON** — no salvage of complete scene objects.
4. **Empty or wrapper-shaped model answers** — `aiText()` returned `""` for shapes it did
   not know (chat transcripts, `choices[0].message.content` **part arrays**, `{text}`, a
   string `{result}`), so `JSON.parse("")` threw and an empty reply masqueraded as
   "invalid JSON".

The fp8 instruct model — and the #271 OpenRouter rotation's free 8B model — routinely wrap
JSON in chatter, so all three browser attempts could fail on presentation while the plan
itself was fine. The legacy art-prompt parser (`parseImagePrompts`) already tolerated every
one of these deviations; the newer Pixabay keyword planner never got that treatment.

## 3. Fixes — all in `src/modules/image-prompts.ts`

| # | Fix | Symbol |
| --- | --- | --- |
| 1 | **Recover before rejecting**: fenced-block extraction, prose trimming via string-aware balanced slices, control-char/trailing-comma repair, salvage of complete scene objects from truncation | `extractScenePlanJson()`, `sliceBalanced()`, `salvageSceneObjects()` (reusing `repairJsonControlChars()`) |
| 2 | **Honest empty-reply reporting** — an unreadable/empty answer no longer says "invalid JSON" | `Error("Scene keyword planner returned an empty reply")` |
| 3 | **`aiText()` reads every known provider-rotation shape** | chat transcripts, content-part arrays, `{text}`, string `{result}` (`contentText()`) |
| 4 | **Whole-plan replies are sliced to the requested chunk** (`[offset, offset+count)`) and fully re-validated — "do not add the other video slots to this chunk" is a common model miss | `generateImagePrompts()` |
| 5 | **Retry attempts converge**: `attempt` 1–2 append "RETRY: … Return ONLY the JSON object — no prose …, no markdown code fences", and the base instruction now says "Return JSON only — no prose before or after the object, no markdown code fences" | `buildStockSearchInstruction()` + retry line in `generateImagePrompts()` |

What did **not** change (pinned by `tests/pixabay-media.test.mjs` and `pixabay-media-migration.md`):

* one model call per planning request, no fallback models, 45 s / 2,048-token budget;
* exact scene count per request — a short reply (or one that is neither the requested count
  nor the complete plan) is still `Scene keyword planner returned the wrong scene count`;
* the per-slot `type` echo is still enforced (wrong media types rejected);
* 2–5 keywords, ≤ 6 words / ≤ 100 characters, no art paragraphs;
* a prose-only reply ("oops") still fails with `invalid JSON` — a plan with no JSON at all
  is still not a plan;
* video slots stay server-controlled at zero-based scenes `videoScenePositions(total)`.

## 4. Verification

* `npm run test:pixabay` — **60/60 passing** (4 new cases: recovery variants across fences /
  prose wrappers / control characters / truncation, empty-vs-invalid distinction,
  full-plan chunk slicing, retry-tightened instructions).
* Broad-suite failures are **unchanged** against a stashed baseline (deep-debug 4,
  progressive-image-pipeline 2, seo-walkthrough 9, llm-openrouter 1, session-250 5). Those
  files still describe the superseded pre-Pixabay prompt-string contract (70B fallback,
  `{"prompts":[…]}` replies, "Visual style" suffixes) — documented as legacy history in
  `pixabay-media-migration.md`.
* `npx tsc --noEmit` — the same 30 pre-existing `src/index.ts` diagnostics, none in
  `image-prompts.ts`.
* A manual repro harness (not committed) confirmed the exact reported error before the fix
  for: fenced JSON + trailing prose, prose preamble + JSON, literal newline in a keyword
  string, trailing comma, `{text}` / chat / content-part shapes and empty replies. After the
  fix every recoverable variant yields 3 validated `pixabay:` tokens; truncated replies now
  report `wrong scene count` (2 of 3 scenes salvaged), empty replies report `empty reply`,
  and only genuinely JSON-free prose reports `invalid JSON`.

## 5. Operator notes

The status line the user saw is the designed graceful stop (0 images added, uploads
re-enabled). After this fix the same model formatting noise is recovered automatically and
the flow continues; a remaining "Scene keyword planner returned invalid JSON" means the
model returned no JSON at all. The route already logs `[image-prompts] failed` with `kind`,
`retryAfterMs` and the message (`wrangler tail`), which distinguishes planner-content
failures from fleet overload (503 + Retry-After).


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
