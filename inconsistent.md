# Editor and Quick Batch pipeline inconsistency audit

**Audit date:** 2026-10-30

**Scope:** the local working tree, including its existing uncommitted changes. Code is the source of truth. This report identifies problems and recommendations; it does not change the application or claim that a live Pixabay error is fixed.

## How the pipelines actually work

| Stage | Editor / video accordions | Quick Batch / table |
| --- | --- | --- |
| Input and state | User chooses an SEO set; the text model writes the script, which is stored on an Editor `videoProjects` entry. Manual assets and voiceover can also be added. | Each `batchRows` entry has its own typed/pasted script, style, minutes, frame and runtime assets. It does **not** generate a script via `/api/script` and does not share row assets with `videoProjects`. |
| Narration | Voiceover is a separate Editor action; projects can also be manual-only or have no audio. | TTS is first. The MP3 is saved and decoded; decoded duration normally drives cues and scene timing. |
| Scene plan | Full script and selected SEO keywords go to `/api/image-prompts` in progressive chunks. Gallery capacity can reduce the target, with a minimum viable plan of two stills and two clips. | Full row script goes to the same planner in progressive chunks. Target is 6/8/10 based on word count. |
| Stock delivery | Binary `/api/image` when advertised, otherwise `/api/image-batch` NDJSON. Imported results enter that project's gallery with scene ordering and provenance. | The same binary/legacy alternatives; results are sorted into the row and decoded into slides. |
| Validation / export | Automatic flows require two distinct imported Pixabay clip IDs at finalization and again at export. Export uses the shared in-browser renderer. | Completion requires two distinct clips during the run, then `batchRowFinished` gates Preview and Export together. Export temporarily borrows the shared renderer state. |

Relevant entry points: [`startImagePromptFlow`](src/client/app-js.ts#L18453), [`requestBatchPrompts`](src/client/app-js.ts#L9171), [`runBatchRow`](src/client/app-js.ts#L9993), [`prepareVideo`](src/client/app-js.ts#L12895), and [`exportBatchRow`](src/client/app-js.ts#L10931). Shared planning uses [`runProgressiveImagePipeline`](src/client/progressive-image-pipeline.ts#L39); the Worker planner is in [`image-prompts.ts`](src/modules/image-prompts.ts#L1619), and the stock adapter is in [`pixabay.ts`](src/modules/pixabay.ts#L137).

**Current media contract:** word counts up to 130 / 240 / above 240 select 6 / 8 / 10 scenes (10 also applies above 500 words). Each plan reserves two video scenes. A photo search exposes **up to two usable images from page 1**, not a guarantee of two hits; upstream requests `per_page=3` because Pixabay requires at least three. Video search exposes up to three usable clips. One selected hit is imported per scene. See [`pixabay-media-migration.md:15–37`](pixabay-media-migration.md#L15) and [`pixabay.ts:137–157,355–372`](src/modules/pixabay.ts#L137).

## Prioritized findings

### 1. High — Table can report success when export has no decoded narration

**Status: reproduced in a mocked layout integration; export consequence confirmed by code tracing.**

- `decodeBatchAudio` catches any decoding failure or timeout, returns zero, and leaves `row.audio` unset: [`app-js.ts:9099–9158`](src/client/app-js.ts#L9099).
- The caller falls back to the row's minutes and proceeds with subtitles, media, and `done`: [`app-js.ts:10021–10067`](src/client/app-js.ts#L10021). `batchRowFinished` checks the MP3 blob but not `row.audio`: [`app-js.ts:7991–8000`](src/client/app-js.ts#L7991).
- Preview uses `new Audio(row.mp3Url)` ([`app-js.ts:10642–10645`](src/client/app-js.ts#L10642)); export instead sets `currentAudio = row.audio` ([`app-js.ts:11048–11049`](src/client/app-js.ts#L11048)), and the encoder creates an audio track only if `currentAudio` exists ([`app-js.ts:20569–20591`](src/client/app-js.ts#L20569)). Thus a playable MP3 that fails Web Audio decode may play in preview but produce a silent export, without the missing-AudioEncoder warning. Whether a particular failed MP3 plays in an HTML audio element depends on the browser and failure cause; playback itself was not tested.
- **Probe:** force `AudioContext.decodeAudioData` to reject, run a successful fixture row: `row.mp3` exists, `row.audio === null`, `row.stage === 'done'`, and `batchRowFinished(row) === true`.
- This qualifies the narration-master/timing claims in [`README.md:23`](README.md#L23) and [`pixabay-media-migration.md:58–65`](pixabay-media-migration.md#L58). Independently, a missing AAC encoder or an encoding exception deliberately alerts and continues with silent video ([`app-js.ts:20569–20578,20629–20649`](src/client/app-js.ts#L20569)); the documentation should not promise unconditional narration.
- **Recommendation:** require a decoded, usable audio buffer for narrated table export, or retry/offer an explicit failure state. Treat encoder failure as an export failure unless the user explicitly accepts a silent output. Test actual muxed audio and preview behavior in a real browser.

### 2. High — Edits can mix different versions of a table row

**Status: reproduced for edits while running; completed-row behavior established by code.**

- Row script/style/minutes/frame controls remain editable during a run ([`app-js.ts:8611–8640`](src/client/app-js.ts#L8611)). Input handlers mutate the live row ([`app-js.ts:11727–11825`](src/client/app-js.ts#L11727)). TTS, cue generation, planner chunks, media requests and export read fields at different times ([`app-js.ts:10021–10101`](src/client/app-js.ts#L10021), [`app-js.ts:9171–9180`](src/client/app-js.ts#L9171), [`app-js.ts:11004–11024`](src/client/app-js.ts#L11004)).
- **Probe:** pause the TTS response, edit the enabled script textarea via its normal `input` event, then release the response. TTS had received `Old garden narration.`, while the subsequent planner received `New ocean narration.` The run completed.
- After a row finishes, editing a **nonempty** script or another setting does not invalidate its existing assets; finished rows are skipped ([`app-js.ts:10180–10187`](src/client/app-js.ts#L10180)). Clearing the script is a special reset ([`app-js.ts:11205–11214,11272–11283`](src/client/app-js.ts#L11205)). Thus a changed field can describe old audio/media, and changed frame settings may affect export even though media was selected under earlier settings.
- **Recommendation:** freeze/snapshot all generation inputs per run and lock or queue edits; invalidate relevant outputs when a completed row changes, or visibly distinguish saved inputs from the current draft. Add integration tests for mid-run and post-completion edits, including orientation and subtitles.

### 3. High — Planned scene count is not a completeness gate

**Status: reproduced for a failed photo in both binary paths.**

- **Probe:** for a six-scene fixture, return HTTP 422 for one photo but deliver the other five scenes, including two distinct clips. Table has six planned prompts, five images and five slides, but is `done` and `batchRowFinished` is true. Editor has five assets and one recorded failure; its render queue reaches `done` using the mocked renderer. This is not a real encoded-media verification.
- Table logs a partial binary chunk but returns the successful images without recording a row-level failure ([`app-js.ts:9468–9474`](src/client/app-js.ts#L9468)); it can also retain earlier chunks after a later pipeline error ([`app-js.ts:10104–10115`](src/client/app-js.ts#L10104)). The finished gate only requires at least one image and one slide. The visible done detail gives slide count, but does not explicitly say a planned photo failed ([`app-js.ts:10133–10143`](src/client/app-js.ts#L10133)).
- Editor counts failures and **does show** a failure count in the final status ([`app-js.ts:18647–18659,18991–19015`](src/client/app-js.ts#L18647)), but the export gate enforces clips rather than the full planned scene count ([`app-js.ts:12902–12906`](src/client/app-js.ts#L12902)).
- The 6/8/10 policy in [`README.md:14–22`](README.md#L14) and [`pixabay-media-migration.md:15–25,58–63`](pixabay-media-migration.md#L15) describes the **plan**, not a guaranteed completed asset count. Partial-result retention is also a documented design in [`script-image-debug-audit.md`](script-image-debug-audit.md); retaining delivered media is not itself an accidental regression. The inconsistency is treating incomplete results as ordinary completion and not making the table's missing scenes explicit.
- **Recommendation:** choose and document a product policy: require all planned scenes, or mark output as partial with expected/actual counts and explicit user acceptance. Preserve successfully delivered assets without silently replaying them.

### 4. Medium/high — Binary HTTP 408 is explicitly intended to retry, but cannot

**Status: reproduced through the shared binary transport.**

- [`browser-offload.ts:280–300`](src/client/browser-offload.ts#L280) sets `retryable` true for 5xx/429 (unless fatal), but false for HTTP 408. [`app-js.ts:9410–9419`](src/client/app-js.ts#L9410) explicitly excludes 408 from permanent client errors, then nevertheless treats any `retryable === false` as permanent. Both Editor and Table call this shared `requestImageChunk`.
- **Probe:** make one scene's first `/api/image` response 408 and make a hypothetical second attempt succeed. Only one request was made; the other five scenes let the table finish partially. This concerns the **binary media** response path, not the separate planner retry handling.
- **Recommendation:** make the classifier and retry consumer agree on 408, while preserving explicitly fatal responses and bounded cancellation-aware retries; test both layouts and verify successful scenes are not replayed.

### 5. Medium/high — Editor reruns discard previous automatic assets before preflight succeeds

**Status: code-traced risk, not separately reproduced end to end.**

- [`app-js.ts:18465–18478`](src/client/app-js.ts#L18465) sets `_requiresStockClips`, revokes/removes prior automatic assets and only then calculates available room. The room check and all subsequent planner/provider requests can fail ([`app-js.ts:18512–18517`](src/client/app-js.ts#L18512)). Manual uploads are retained, consistent with [`pixabay-media-migration.md:72`](pixabay-media-migration.md#L72), but a failed replacement has already destroyed the previous automatic set.
- `_requiresStockClips` is set before those failures and `prepareVideo` subsequently requires two distinct automatic clips ([`app-js.ts:12902–12906`](src/client/app-js.ts#L12902)). Therefore attempting an automatic run can prevent export until its stock requirement is satisfied, including when the user might otherwise want a manual-only result. The report does not assume that manual-only fallback was intended after an attempted automatic run.
- **Recommendation:** preflight before destructive changes, stage a replacement until validated, and define/reset the automatic-flow requirement explicitly on cancellation/failure or when the user chooses manual-only mode. Test prior successful assets, insufficient space, planner error and cancellation.

### 6. Medium — An all-video partial timeline can be shorter than narration

**Status: code-traced edge case; reachability and real-browser output not independently reproduced.**

- With partial results allowed, a flow can retain just the two required clips if other scenes fail, subject to the chunk-level error behavior. [`fitStockSceneTimeline`](src/client/app-js.ts#L9860) bounds each video to its actual duration/window and gives remaining frames **only to stills**. With no stills, remaining frames are never assigned. For example, two 2-second clips and 60 seconds of narration give only 4 seconds of slide windows.
- The renderer calculates output length from slide frames ([`app-js.ts:20448–20480`](src/client/app-js.ts#L20448)) and supplies that duration to audio encoding ([`app-js.ts:20589–20593`](src/client/app-js.ts#L20589)). This can truncate narration rather than make it the master timeline. The same fit helper is used for both table and qualifying Editor slides ([`app-js.ts:9988`](src/client/app-js.ts#L9988), [`app-js.ts:13055–13056`](src/client/app-js.ts#L13055)).
- **Recommendation:** explicitly handle zero stills, e.g. freeze a final video frame or add a fallback visual for the remainder; verify the full timeline and actual muxed audio. Also test very short narration versus the minimum frame per scene.

### 7. Medium — Two distinct clips are checked only after selection, without alternate selection

**Status: code-traced availability risk; not reproduced against live Pixabay.**

[`pixabaySceneImage`](src/modules/pixabay.ts#L355) chooses the indexed result or the first hit independently per scene. Two searches can therefore return the same clip ID; the table and Editor subsequently reject the pair ([`app-js.ts:10113–10115`](src/client/app-js.ts#L10113), [`app-js.ts:18977–18980`](src/client/app-js.ts#L18977)). This is consistent with the stated two-distinct-clips safety rule, but there is no cross-scene alternate-ID selection in this path even if another page-1 result is available. Different search keywords do not guarantee distinct provider IDs.

**Recommendation:** coordinate video selection with an exclusion set and try suitable other already-returned page-1 hits, or report the duplicate explicitly and allow a targeted retry. Do not silently replace a clip with a still or search later pages.

### 8. Medium — Retry-after caps may end media attempts before provider cooldown expires

**Status: code-traced timing risk, not timed against a live provider.**

Pixabay's local/shared limit can advertise a 60-second or longer reset ([`pixabay.ts:176–185,203–214`](src/modules/pixabay.ts#L176)). Binary media scheduling caps a noted hold at 20 seconds ([`browser-offload.ts:11–18,333`](src/client/browser-offload.ts#L11)); the chunk retry delay is capped at 15 seconds and defaults to three rounds ([`app-js.ts:9343–9345,9426–9432`](src/client/app-js.ts#L9343)). Depending on Worker retries, other queued work and timing, the client can consume its available rounds while the provider cooldown remains active. This is a bounded-wait policy, not proof of the user's actual provider failure.

**Recommendation:** preserve the true next-eligible timestamp or present a clear retry-later state; keep waits cancellable and respect a documented total deadline. Add a fake-clock test for long 429 cooldowns and both transports.

### 9. Low/medium — Frame wording overstates stock-source control

**Status: code/documentation comparison.**

[`quick-batch-table-system-requirements.md:83`](quick-batch-table-system-requirements.md#L83) says images are rendered at the row's frame. The stock adapter does not resize the Pixabay source to that frame: requested dimensions guide search orientation ([`image-batch.ts:556`](src/modules/image-batch.ts#L556)); layout/export apply output dimensions separately. Equal width and height also select `landscape`, not `all`, in [`pixabay.ts:365–367`](src/modules/pixabay.ts#L365). Editor's binary call passes an empty frame and the legacy call passes only prompts ([`app-js.ts:18627–18631,18838–18847`](src/client/app-js.ts#L18627)), so default landscape is used for automatic stock lookup.

**Recommendation:** describe source size as provider-dependent and frame as output composition/search guidance. If square or Editor orientation should influence search differently, make the desired mapping explicit and test it; do not promise square source images.

## Documentation contradictions and supersession

1. **State ownership.** [`quick-batch-table-system-requirements.md:35`](quick-batch-table-system-requirements.md#L35) says both views share state, but its own [lines 98–100](quick-batch-table-system-requirements.md#L98) say the correct opposite. [`userflow.md:964–965,1273`](userflow.md#L964) similarly says one state; its historical bulk-grid paragraph at [lines 994–999](userflow.md#L994) already says that grid was superseded. Replace the unqualified headings/introductions with separate table rows and Editor projects, while noting they share renderer infrastructure.
2. **Provider, route, scene count and authorization.** [`quick-batch-table-system-requirements.md:130–137,163–166`](quick-batch-table-system-requirements.md#L130) still lists SDXL, the old duration-based 10/14/20 scene totals, an NDJSON-only route surface and unmetered operation when KV is absent. This conflicts with the document's own current-policy banner, its [pipeline table](quick-batch-table-system-requirements.md#L76), [`pixabay-media-migration.md:3–7,33–45,84`](pixabay-media-migration.md#L3), and the actual fail-closed hook ([`src/index.ts:5067–5079`](src/index.ts#L5067)). The explicit `PIXABAY_ALLOW_UNMETERED="true"` exception is for isolated local/test use; the audit did not alter configuration.
3. **Failure visibility.** [`quick-batch-table-system-requirements.md:86–87`](quick-batch-table-system-requirements.md#L86) says final failure returns to ready with no error. Current non-stop failures set `error` and paint a warning ([`app-js.ts:10160–10170,8164–8169`](src/client/app-js.ts#L10160)), matching [`pixabay-media-migration.md:62`](pixabay-media-migration.md#L62). In contrast, a partly successful binary batch has the missing-photo visibility problem in finding 3. Old comments near `runBatchRow` also describe silent failure and should not be treated as current behavior.
4. **Historical versus current material.** [`README.md:34`](README.md#L34) explicitly labels its older inventory pre-Pixabay; old references there are historical, not evidence that AI images are active. Likewise, [`new_requirements.md:18–23`](new_requirements.md#L18) labels its earlier scene totals superseded. Preserve useful history but link every current operational section to the migration reference, and avoid unlabelled conflicting constants and route descriptions.
5. **Plan versus delivered result.** The current migration document correctly describes the planner's 6/8/10 targets and two-clip gate, but should distinguish planned totals from partial completion (finding 3), decoded-audio failure (finding 1), and timeline limitations (finding 6) rather than stating unconditional narration coverage.
6. **Search diagnostics and privacy.** Always-on Worker logs include `[image-prompts] planned.keyword`, `[pixabay] search.keywords` and, for real upstream requests, `[pixabay] provider-search.request` ([`image-prompts.ts:1606`](src/modules/image-prompts.ts#L1606), [`pixabay.ts:153–154,190–192`](src/modules/pixabay.ts#L153)). Cache hits do not issue an upstream request. Configured API-key text is redacted, but search keywords derive from user content and may themselves be sensitive. Keep the always-on logging requirement; document log access, retention and redaction limitations rather than treating these logs as private.

## Validation and limits

Executed against the local working tree:

- `npm run test:pixabay` — **79 passed, 0 failed** (mocked Pixabay/layout fixtures).
- `node --import tsx --test tests/script-seo.test.mjs tests/seo-plan-resilience.test.mjs tests/pixabay-media.test.mjs tests/pixabay-studio-flow.test.mjs tests/script-image-deep-debug.test.mjs` — **103 passed, 0 failed**.
- Four one-off integration probes using the setup in [`tests/pixabay-studio-flow.test.mjs:1–67`](tests/pixabay-studio-flow.test.mjs#L1) — **4 passed**: partial photo failure in both layouts; Web Audio decode rejection; binary HTTP 408; and editing a running table row during deferred TTS. The temporary probe file was removed after execution, so those four are observations from this audit rather than committed regression tests. The descriptions in findings 1–4 specify the injected conditions and assertions needed to recreate them.
- An earlier broad `npm test` on this working tree reported **273 passed, 57 failed, 6 cancelled**. Many failures target older AI-image contracts, but no controlled baseline proves all were pre-existing; this audit did not reclassify or fix them. An earlier `npx tsc --noEmit --pretty false` exited nonzero with existing router/index diagnostics; no clean project-wide typecheck is claimed.

Fixtures mock TTS, Pixabay/network responses and browser media/WebCodecs components. They do not establish live provider behavior, production deployment, actual audible output, or real browser encoding quality. Findings labelled code-traced are hypotheses for targeted regressions, not claims that their full user scenarios were observed. No application fixes were made as part of this report.
