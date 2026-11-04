# Script writing and Pixabay keyword pipeline: code audit

This is a code-based audit of the editor and Quick Batch paths in the current working tree. It uses mocked AI, Pixabay and browser-media boundaries; it is **not** a live provider or production deployment verification. For the stock API, limits and console log guide, see [Pixabay media reference](pixabay-media-migration.md).

## Actual flows

| Stage | Editor accordions | Quick Batch table |
| --- | --- | --- |
| Script input | `generateScript` posts the topic to `/api/seo-plan`, presents one or two validated SEO sets, and lets the user select one. `confirmSeoStyleAndGenerate` calls `/api/script` with that set. | The user types or pastes each row's narration. **The table does not call the SEO planner or write a script.** |
| Script writer | `handleSeoScriptGeneration` revalidates the selected set; the model writes SRT, the Worker validates timing and the minimum occurrence of one long-tail and four short keywords, then returns plain spoken text. With negotiated `singleAttemptScript`, one writer call per request is retried by the browser up to four times; permanent 4xx other than 408/429 stop immediately. Legacy requests can also retry within the Worker. | Uses the row's text verbatim for TTS, captions and keyword planning. |
| Media planning | `startImagePromptFlow` passes the full script, selected SEO vocabulary, topic and a gallery-cap-adjusted scene total to `/api/image-prompts`. | After TTS and audio timing, `requestBatchPrompts` passes the full row script, topic derived from the row, frame and style. There is no selected SEO set to pass. |
| Shared planner | `runProgressiveImagePipeline` requests at most three typed scene slots per chunk. `generateImagePrompts` reads the complete script, requests 1–5-word stock search terms, validates/reconciles model output, emits `pixabay:` tokens, and reserves video scenes 1 and total−2. Both layouts use 12 total scenes by script word count (editor can reduce the total for available gallery space). | Same, with lookahead and up to two parallel rendering chunks when advertised by the Worker. **Quick Batch table rows follow FINAL RULE:** client JS retries every failed pipeline stage seven times after a 40 s backoff; older three-attempt statements are superseded for that layout only. |
| Fetch/delivery | Client JS searches Pixabay pages 1-2 (eight photo results and four video results per 12-scene plan), records every selected filename, rejects duplicates and retries only failed media items. The Worker fallback validates bytes and sends them to the browser. | Same contract in both layouts. |

The search-term model is not an image generator. Styles are validated for compatibility but do not guarantee that Pixabay photos have a particular visual style.

## Reproduced problems and changes

1. **Scene-count disagreement:** the browser counted whitespace-separated tokens and treated emoji as words, while the Worker counted Unicode letters/numbers and split punctuation-separated words. At a 130/240-word boundary this produced different totals, wrong video-slot types, 400s, or partial flows. The browser now uses the Worker's exact token rule, including subtitle line filtering. Regression tests exercise accented and non-Latin text, punctuation, emoji and both layout pipelines at a boundary.
2. **Lost SEO plan:** reopening a walkthrough only reused a cached plan if it contained exactly two sets, despite the server deliberately returning one set on partial success. It now reuses any nonempty validated set list.
3. **Wrong accordion after deletion:** an in-flight SEO plan or writer could complete after a different accordion was deleted and use the old index to update controls, open a modal, or launch media planning on the wrong project. Completion now resolves the original project's live index, ignores deleted projects, and preserves busy/upload locks when accordions are rebuilt. Queued work with a project owner is canceled by identity rather than an obsolete index.
4. **Duplicate writer and misleading retries:** repeated style confirmation could start multiple script requests, and permanent 4xx failures in the legacy path were retried and reported as three attempts even when fewer ran. Confirmation now ignores an active flow; permanent 4xx stop; the failure reports the actual attempt count. Transient 408/429 and 5xx still retry. Editor and legacy Quick Batch keyword requests now also correctly retry HTTP 408.
5. **Parallel media drain:** a failed render could be thrown before another already-started parallel render was drained. The shared orchestrator now waits for that render before surfacing the original failure, avoiding early finalization while paid work is still completing.

## Reading the logs

- SEO planner and script writer: Worker `[seo-plan]` and `[script]` logs include attempt, model, failure reason and timings; the editor browser console has `[script-seo]` request/attempt/final status. A validated script response can include `debug` traces when explicitly requested by the API caller.
- Stock planner: Worker `[image-prompts] started` includes script character count, scene total, chunk offset/count/attempt; `[image-prompts] planned.keyword` contains the selected scene, media type, offset, attempt and term; `[image-prompts] ready` shows accepted count and elapsed time. Partial model replies advance by the accepted prefix; malformed/no-usable replies can be retried by the browser with `previousError`.
- Pixabay: `[pixabay] search.keywords` logs each normalized search, including cache hits. `provider-search.request` appears only on an actual upstream fetch; response/rejection logs show HTTP status, timing and rate-limit data. Match the scene index and request ID with `[image]` logs; see `download.dequeued` for queue wait. These are Worker logs, not automatically browser console logs.
- Search terms and SEO terms can contain user-derived information. Restrict log access and retention. API keys are redacted; don't log full scripts or provider URLs containing keys.

## Remaining risks and limits

- No live AI/Pixabay call was made here. Provider-specific authorization, rate limit, quality and actual latency still need verification using real Worker logs. `wrangler.json` was not changed.
- `/api/seo-plan` runs two sets sequentially, with per-model retries/fallbacks and 45-second individual model-call deadlines. The browser uses a plain fetch for this stage: there is no overall client-side SEO-plan deadline, and deleting a project does not currently abort that fetch. Slow/repeated model failures can therefore make this step appear stuck; late results are now ignored safely. Script writing has a 90-second model-call limit and the negotiated client call has a 105-second deadline; retries can extend total wall time.
- Each image-keyword chunk has a 45-second model deadline and a 60-second client deadline, followed by Pixabay budget/cache/search and serialized downloads. Multiple chunks and backoff can add time; a timeout bounds the waiter, not necessarily cancellation of underlying AI inference.
- Quick Batch retains partial media after a later pipeline failure. If the retained media includes two distinct clips, its current completion path can still build a shorter video; the editor reports its flow failure. This audit records that behavior rather than changing the product's partial-delivery policy.
- The full narration is limited to 20,000 characters for image planning. The text-model context limit can be lower in practice, especially for long scripts.

## Validation

Run:

```sh
node --import tsx --test tests/script-seo.test.mjs tests/seo-plan-resilience.test.mjs tests/pixabay-media.test.mjs tests/pixabay-studio-flow.test.mjs tests/script-image-deep-debug.test.mjs
```

These tests use fixtures and mocked AI/browser boundaries. They exercise SRT and keyword validation, editor SEO-to-script-to-stock-planner wiring, both layouts' whole-script planning and 408 retry, first-page search and downloads, Unicode count parity, partial-plan reopening, renumber/deletion races, duplicate prevention and concurrent render draining. The older broad test suite includes superseded AI-image contracts; see the existing migration reference for that limitation.


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
