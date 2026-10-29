# Script writing and Pixabay keyword pipeline: code audit

This is a code-based audit of the editor and Quick Batch paths in the current working tree. It uses mocked AI, Pixabay and browser-media boundaries; it is **not** a live provider or production deployment verification. For the stock API, limits and console log guide, see [Pixabay media reference](pixabay-media-migration.md).

## Actual flows

| Stage | Editor accordions | Quick Batch table |
| --- | --- | --- |
| Script input | `generateScript` posts the topic to `/api/seo-plan`, presents one or two validated SEO sets, and lets the user select one. `confirmSeoStyleAndGenerate` calls `/api/script` with that set. | The user types or pastes each row's narration. **The table does not call the SEO planner or write a script.** |
| Script writer | `handleSeoScriptGeneration` revalidates the selected set; the model writes SRT, the Worker validates timing and the minimum occurrence of one long-tail and four short keywords, then returns plain spoken text. With negotiated `singleAttemptScript`, one writer call per request is retried by the browser up to three times; permanent 4xx other than 408/429 stop immediately. Legacy requests can also retry within the Worker. | Uses the row's text verbatim for TTS, captions and keyword planning. |
| Media planning | `startImagePromptFlow` passes the full script, selected SEO vocabulary, topic and a gallery-cap-adjusted scene total to `/api/image-prompts`. | After TTS and audio timing, `requestBatchPrompts` passes the full row script, topic derived from the row, frame and style. There is no selected SEO set to pass. |
| Shared planner | `runProgressiveImagePipeline` requests at most three typed scene slots per chunk. `generateImagePrompts` reads the complete script, requests 1–5-word stock search terms, validates/reconciles model output, emits `pixabay:` tokens, and reserves video scenes 1 and total−2. Both layouts use 6/8/10 total scenes by script word count (editor can reduce the total for available gallery space). | Same, with lookahead and up to two parallel rendering chunks when advertised by the Worker. The server asks for one text model call per chunk; browser retries up to three times on retryable failures. |
| Fetch/delivery | The Worker searches Pixabay page 1 (up to two usable photos exposed per keyword), chooses one hit per scene, downloads and validates it, and sends image/video bytes to the browser. Exactly two distinct video clips are required. | Same stock adapter and clip requirement. |

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
