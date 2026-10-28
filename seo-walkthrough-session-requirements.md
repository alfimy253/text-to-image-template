# SEO Walkthrough Session — System Requirements, Implementation Record and Double-Check Audit

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

This document is the canonical record for the coding session that changed the
**Video N accordion form styling** and replaced the one-click **Generate SEO Script**
action with a **walkthrough**: SEO-plan selection → video image style → AI script →
AI image prompts → queued AI images.

It records, in order:

1. every system requirement given for that session, restated precisely;
2. how the current code implements each requirement;
3. the double-check evidence gathered after the implementation; and
4. at the bottom, two separate inconsistency registers:
   - **Register A** — inconsistencies between the newly coded session code and
     other (pre-existing) code;
   - **Register B** — inconsistencies between the documentation and the code.

The registers preserve the original double-check snapshot; the 2026-10-24 follow-up
at the end of this file records fixes to several entries and gives the current behavior.
Items not marked as resolved there remain open. Where older documentation and this document
disagree, the code is the behaviour users actually get, and Register B names the older passage
that is wrong.

---

## 1. System requirements for the session (SR-1 … SR-21)

### Accordion form standard

- **SR-1 — One radius/padding/margin standard.** Every form element inside a
  Video N (“video canvas”) accordion must use the same corner radius and the
  same padding as the **Upload MP3 Audio** button, and must have a **3px
  bottom margin**.
- **SR-2 — Dropdown labels above, never beside.** The label of every dropdown
  element in every Video N accordion must always be rendered **above** its
  dropdown, never on the side of it.
- **SR-3 — Text-entry rhythm.** Text input elements and textbox (`textarea`)
  elements must have a **5px bottom margin** and a **4px top margin** (this
  overrides the generic bottom margin in SR-1 for those elements).
- **SR-4 — Remove the caption section.** The **Captions (bottom)** section
  must be removed from the Video N accordion.

### Generate SEO Script walkthrough

- **SR-5 — Disable uploads and open a walkthrough.** When **Generate SEO
  Script** is clicked, the button labelled **Upload Image, GIF or MP4** for
  that video must be disabled, and a modal walkthrough must be shown while an
  API fetches an SEO plan for the topic the user previously input.
- **SR-6 — Two SEO keyword sets.** The SEO-plan API must fetch **two different
  SEO keyword sets** for that topic; each set contains long-tail and
  short-tail keywords (in this codebase’s RULE 7 terms: exactly one long-tail
  keyword, exactly four short keywords, a title and headings).
- **SR-7 — Closable modal, background work, automatic reopen.** While the two
  sets are being generated, the user may close the modal; generation must
  continue in the background, and when the sets arrive the modal must open
  (again) and display them.
- **SR-8 — User selects one set.** The user clicks a **Select** button on one
  of the two displayed SEO keyword sets — the set that targets the user’s
  script topic.
- **SR-9 — Video style selection next.** After the keyword-set selection, the
  flow moves to a **video style selection**: the style that AI image
  generation must use for this video’s images.
- **SR-10 — Close, loading animation, then script.** Once the SEO keyword set
  has been selected and the video image style has been input, the modal must
  close and the script section must show a **loading animation** while the AI
  script is awaited. The pre-existing code that displays the finished AI
  script in the script section must be kept.
- **SR-11 — Script first, image generation after.** AI script generation runs
  first; AI image generation is only called once the script has been shown.
- **SR-12 — Image-prompt counts by script length.** The instruct LLM must be
  asked for **10 image prompts for a 1-minute video, 14 for a 2–3-minute
  video, and 20 for a 4–5-minute video**.
- **SR-13 — Length is already chosen; default 1 minute.** The script length
  is already filled in by the client when the user writes the topic for the
  script; it **defaults to one minute**.
- **SR-14 — New image-prompt instruction.** A new LLM instruct query must
  produce the set of image prompts **according to the video script length
  (SR-12) and the selected image style (SR-9)**.
- **SR-15 — Queue image generation gently.** The client browser must wait for
  the image prompts, receive them in client-side JS, and then schedule an AI
  image-generation call **every 20 seconds**, so image workers are not
  flooded beyond their processing capacity.
- **SR-16 — Poll a dynamic URL every 30 seconds.** Before the queued image
  generation, the browser JS must poll for the image prompts: once the user
  has selected an SEO keyword set, the browser inquires at a **dynamic URL
  generated for that selection**, querying it **every 30 seconds**. At first
  the URL returns an **empty array**; it returns the complete image prompts
  (with design/style details) only when they have been generated.
- **SR-17 — Reuse the existing image generation.** When the prompts arrive,
  the browser calls the image-generation function that is **already written**
  in the codebase.
- **SR-18 — Images land in that video’s gallery.** As each generated image
  arrives, the gallery section of that specific Video N accordion is filled
  with it.
- **SR-19 — Destroy the dynamic URL at the end.** When all image prompts have
  been generated and the resulting images are set in the gallery, the
  image-prompt URL must be destroyed.
- **SR-20 — Gallery-count poller finishes the flow.** Client JS must check the
  count of images in the gallery, continuously polling UI changes; once the
  last image has been generated, that poller calls the API to destroy the
  image-prompt URL and then enables the **Upload Image, GIF or MP4** button
  again.
- **SR-21 — Do not break the system.** The requirements, the existing
  documentation and the current code (and its consistency conventions) must
  be studied before coding, and the change must not break existing behaviour.

---

## 2. How the current code implements the requirements

### 2.1 Accordion form standard (SR-1 … SR-4)

| Requirement | Implementation | Where |
| --- | --- | --- |
| SR-1 | A final CSS block scopes `#video-accordions .video-accordion input[type="text"]`, `input[type="number"]`, `select` and `textarea` to `border-radius: 8px; padding: 12px 24px; margin-bottom: 3px; box-sizing: border-box; width: 100%` — the Upload MP3 Audio button’s (`.upload-btn`) proportions. Themed skins substitute `var(--t-radius-sm)` and Neo Brutalist substitutes `0`, matching those themes’ accordion-button corners. | `src/client/styles.ts`, “VIDEO ACCORDION FORM STANDARD” block near the end of `APP_CSS` |
| SR-2 | `label.quality-select` inside the accordion is `display: flex; flex-direction: column; align-items: stretch`, so the label text is an anonymous flex item on its own line and the nested `select` is full-width below it. This covers the Minutes/Speech and Font/Colour labelled dropdowns. Sticker and Quality are bare `select.quality-select` elements whose visible heading is the `.va-section-title` above them (see Register A-9 / B-7). | `src/client/styles.ts` (same block); markup in `videoAccordionHTML(n)` in `src/client/app-js.ts` |
| SR-3 | A more specific rule in the same block sets `margin-top: 4px; margin-bottom: 5px` for accordion text inputs and textareas. | `src/client/styles.ts` |
| SR-4 | The Captions (bottom) `.va-section` (title, `#va-captions-N`, Add Caption button) is deleted from `videoAccordionHTML(n)`. The hidden global caption rows remain as the render engine’s working state; `swapVaCaptionsIn/Out` now return early when `#va-captions-N` is absent, and the other `va-captions-N` readers were already null-guarded. | `src/client/app-js.ts` (`videoAccordionHTML`, `swapVaCaptionsIn`, `swapVaCaptionsOut`) |

### 2.2 Walkthrough state machine (SR-5 … SR-11)

The walkthrough lives in MODULE 8b of `src/client/app-js.ts`
(`generateScript`, `ensureSeoWalkthrough`, `selectSeoKeywordSet`,
`confirmSeoStyleAndGenerate`, `runSeoScriptRequest`) with the modal built
dynamically in the DOM, the same pattern as the pre-existing voiceover modal.
There is no walkthrough markup in `src/client/markup.ts`.

1. **Click.** `generateScript(n)` snapshots topic (topic input → video title
   → `"my video"`), minutes (Minutes dropdown, normalised to an integer
   1–6, otherwise 1 — SR-13) and speed onto the project
   (`_seoTopic`, `_seoMinutes`, `_seoSpeed`), clears any previous
   selection, disables `#va-upload-btn-N` via `setVaUploadEnabled(n, false)`
   and disables the Generate SEO Script button itself, then opens
   `#seo-walkthrough-modal` at step *1 · SEO plan* and POSTs `{topic}` to
   **`/api/seo-plan`**. `clickVaFiles(n)` also refuses to open the file
   picker while `#va-upload-btn-N` is disabled.
2. **Plan.** `handleSeoPlanGeneration` (`src/modules/script-seo.ts`) runs
   `planOneSeoKeywordSet` twice. Each run validates the model’s JSON with
   the unchanged RULE 7 validator `parseKeywordSet` (one nonempty long-tail
   with no length rule; exactly four unique 1–3-word shorts; title ≤ 70
   chars carrying a short; 1–12 headings, one carrying a short), up to 3
   attempts. The second run’s prompt (`buildSeoPlannerPrompt(topic, avoid)`)
   instructs the model not to reuse the first set’s long-tail or shorts,
   and a reply whose **combined** long-tail + ordered short list exactly
   equals the first set is rejected and retried (`keywordSetsEqual`).
   Success: `200 {success, topic, sets: [setA, setB], model}` where each
   set is `{title, headings, longTail, short: [...]}`.
3. **Closable / reopening (SR-7).** The modal’s Close button removes
   `#seo-walkthrough-modal` from the DOM; the in-flight `fetch` is not
   tied to the modal and keeps running. When the plan resolves,
   `generateScript` re-creates the modal if it is absent, renders both sets
   as `.seo-wt-card`s (`renderSeoPlanSets` + `seoSetChipsHTML`, all strings
   through `escapeHTML`) and shows step *2 · Choose a keyword set*. The
   script trigger is re-enabled once the plan is ready, so closing after the
   sets arrive no longer strands the cached-set/style reopen path. On plan
   failure the modal is closed, the accordion status line shows
   `SEO plan failed: …`, and upload/script buttons are re-enabled.
4. **Selection (SR-8).** Each card’s **Select this set** button calls
   `selectSeoKeywordSet(n, idx)`, storing `project.selectedSeoSet` and
   advancing to step *3 · Video image style*, showing the chosen set’s
   chips above a theme-styled dropdown (`#seo-wt-style-select`). The dropdown
   contains exactly ten canonical values; a change is saved on the project
   so closing/reopening preserves the choice. Re-clicking Generate SEO
   Script with cached sets/a selection reopens the modal without a new plan.
5. **Style + script (SR-9, SR-10, SR-11).** **Generate Script & Images**
   (`confirmSeoStyleAndGenerate`) stores `project.videoImageStyle` from the
   selected canonical dropdown option (default `Cinematic Film`), closes
   the modal, sets `project._imageFlowActive = true` and awaits
   `runSeoScriptRequest(n, topic, minutes, speed)`. That function is the
   pre-existing script generator, kept intact except that it now also
   sends `keywordSet: project.selectedSeoSet` and drives
   `setScriptLoading(n, true/false)`, which puts the `.va-script-loading`
   spinner/pulse animation into `#va-script-box-N` while the request is
   awaited. The server (`handleSeoScriptGeneration`) re-validates a
   supplied `keywordSet` with `parseKeywordSet` **before** usage tracking
   (invalid or non-object → `400`, no AI call) and skips its Stage-1
   planner when one is supplied (planner trace source `client-selected`);
   without `keywordSet` the route behaves exactly as RULE 7 describes.
   On success the kept, pre-existing display path runs unchanged:
   `project.srt`, SEO chips via `renderSeoKeywords`, SRT box, title
   autofill, Download .srt reveal and `syncVoiceoverButton`. On script
   failure the walkthrough re-enables the upload and script buttons and
   does not start the image flow.

### 2.3 Image prompts and queued images (SR-12 … SR-20)

Implemented in `src/modules/image-prompts.ts`, routed in `src/index.ts`
next to `/api/script`, and driven by MODULE 8b’s
`startImagePromptFlow` / `pollImagePromptOnce` / `scheduleAiImageQueue` /
`generateQueuedAiImage` / `watchGalleryCompletion` /
`finalizeImagePromptFlow`.

- **Job creation (SR-16, first half).** After the script is shown,
  `startImagePromptFlow(n)` records the gallery baseline and available still
  slots, then POSTs `{topic, minutes, style, script: project.srt, keywordSet}`
  to `/api/image-prompts`. The handler sanitises/caps the topic at 160 chars,
  requires minutes 1–6 (default 1), normalises the style against the ten
  canonical labels (default `Cinematic Film`, unknown values → `400`), and
  compacts the SRT to a two-sentence script idea capped at 480 characters.
  It stores a `pending` job with `prompts: []` and immediately answers
  **`202 {success, id, url: "/api/image-prompts/<id>", status, prompts: [],
  expectedCount, style, minutes}`**. LLM work runs via `ctx.waitUntil(work)`
  when an execution context is supplied; otherwise the promise continues
  inside the isolate.
- **Storage.** With `KV_BINDING` bound, jobs are KV records
  `image-prompts:<id>` with a 1-hour TTL. Without KV (tests, the e2e
  fixture) an in-isolate `Map` is used instead.
- **Prompt instruction (SR-12, SR-14).** `buildImagePromptInstruction`
  tells the instruct model (`SCRIPT_MODEL`, the same llama instruct model
  as the script) to answer with only `{"prompts":[...]}`: exactly
  `imagePromptCountForMinutes(minutes)` prompts — **1 → 10, 2–3 → 14,
  4–6 → 20** — in opening-to-closing order, each a concise text-free scene
  representing the whole idea rather than a cue-by-cue retelling. The LLM
  sees only the opening and closing spoken sentences (≤480 chars), not the
  full transcript. `generateImagePrompts` retries up to 3 times until the
  parsed list reaches the exact count, then `applyImageStyleToPrompts`
  appends consistent guidance for the selected style to every prompt before
  the job becomes `ready` (or `error`).
- **Polling (SR-16, second half).** After validating the returned dynamic
  same-origin URL, job id and expected count, the client polls immediately,
  then every `IMAGE_PROMPT_POLL_MS = 30000` (`window.__SEO_FLOW_TIMING`).
  Poll requests time out at 60 s and retry up to three transient failures;
  a terminal job error or `404` enters finalization instead of merely
  stopping the poller.
- **Queued generation (SR-15, SR-17, SR-18).** When a poll returns the
  exact prompt count, polling stops and `scheduleAiImageQueue` runs: the
  first image is requested immediately, each subsequent one via
  `setTimeout(step, AI_IMAGE_QUEUE_MS)` (`20000`) after the prior attempt
  settles. Each image is fetched through `AI_ENDPOINT` from `/image/gen`;
  the queue handles binary responses, daily-credit errors and bounded
  retries/timeouts. `addAiToVideo(n, file, blob, jobId, true)` inserts into
  that video's gallery, returns an explicit success value, tags the asset
  and card with the prompt-job id, and enforces the 25-still cap. The target
  is limited to currently available gallery slots; `refreshCredits()` runs
  after each success.
- **Completion and teardown (SR-19, SR-20).** `GALLERY_WATCH_MS = 1000`
  checks only job-tagged cards whose parent is `#va-gallery-N` (not total
  children or the original baseline). Finalization occurs once the available
  successful-image target is reached or the queue has attempted its usable
  prompts, including partial/all-failed/cap-limited runs. It clears all
  timers, aborts in-flight requests, retries DELETE once if necessary, and
  re-enables **Upload Image, GIF or MP4** plus the script trigger. The final
  status reports the actual tagged image count and any failure/limit reason.

### 2.4 Requirement-by-requirement conformance

| Req. | Status | Note |
| --- | --- | --- |
| SR-1 | Implemented, scoped | Only text/number inputs, selects and textareas under `#video-accordions` are covered; buttons follow the separate pre-existing accordion-button rule. See A-9. |
| SR-2 | Implemented for labelled dropdowns | Minutes/Speech and Font/Colour labels are stacked above. Sticker/Quality have section titles, not `<label>` elements. See A-9. |
| SR-3 | Implemented | Accordion text inputs/textareas: 4px top, 5px bottom. |
| SR-4 | Implemented | Visible section removed; caption plumbing remains as dead/guarded code. See A-13. |
| SR-5 | Implemented | Upload button disabled at click; modal shows step 1 while `/api/seo-plan` runs. |
| SR-6 | Partially implemented | Two validated sets; “different” is enforced only as “not the identical long-tail + ordered-shorts combination”, and the prompt’s stronger wording is not validated. See A-10. |
| SR-7 | Implemented | Close removes the modal while the plan continues; success re-creates/reopens it, and the script trigger remains enabled once sets are ready so cached sets/style can reopen. |
| SR-8 | Implemented | Select buttons on both cards store the chosen set. |
| SR-9 | Implemented | Theme-aware labelled dropdown with exactly ten canonical styles; the selected value persists when reopened. |
| SR-10 | Implemented with a defect | Loading animation shows while awaiting the script and the old display path is kept; a failed **re**-generation leaves the spinner in the box instead of restoring the previous SRT (A-5). |
| SR-11 | Implemented | Image-prompt job is created only after script success is displayed. |
| SR-12 | Implemented (+ assumption) | 10/14/20 for 1 / 2–3 / 4–5 min; 6 min (unspecified) also maps to 20. |
| SR-13 | Implemented | Minutes come from the existing dropdown, default/selected 1; server also defaults omitted minutes to 1. |
| SR-14 | Implemented | The LLM receives a ≤480-character opening/closing script idea and instructions for concise general scenes; styles are canonicalized and consistent direction is appended to every validated prompt. |
| SR-15 | Implemented | First image immediately on prompt arrival, then each next request 20 s after the previous attempt settles; the queue respects cap, credit and retry limits. |
| SR-16 | Deviation in sequencing | The dynamic URL is created **after** style confirmation and after the script succeeds, not at the moment of keyword-set selection; polling itself is every 30 s and returns `[]` until ready. See A-11. |
| SR-17 | Implemented via existing primitives | Uses the existing `/image/gen` endpoint builder, daily credit gate and `addAiToVideo` gallery inserter; the custom queue remains necessary to honor one-prompt-at-a-time cadence. |
| SR-18 | Implemented | Images are added to `#va-gallery-N` of the same accordion. |
| SR-19 | Implemented best-effort | All terminal/error/partial paths attempt DELETE, retrying once; a double DELETE failure is logged and the job's one-hour TTL remains the last-resort cleanup. |
| SR-20 | Implemented | 1 s watcher counts only job-tagged cards in the target gallery; cap-limited, partial, failed and successful queues all finalize and re-enable controls. |
| SR-21 | Verified as far as tested | Full tests and Wrangler dry-run pass; `tsc` still reports the existing 36 diagnostics in `src/index.ts`. Mock-worker and jsdom client-flow tests cover the full plan-to-gallery path. |

---

## 3. Original double-check evidence (historical snapshot)

These results describe the original walkthrough pass before the 2026-10-24 follow-up; use §6
for current verification and behavior. Run after `npm ci` (dependencies are not persisted between
sessions):

- `npm test` — **40 tests, 40 pass, 0 fail**, including the five new
  `tests/seo-walkthrough.test.mjs` tests: two different plan sets from
  `/api/seo-plan`; `/api/script` with a selected `keywordSet` calls only
  the writer (planner skipped); an invalid selected set is `400` with zero
  AI calls; prompt counts 10/14/20 and instruction/parse behaviour; and the
  create → poll-until-ready → DELETE → `404` job lifecycle.
- `npx tsc` — **36 errors**, all pre-existing in `src/index.ts`; none in
  `src/modules/script-seo.ts`, `src/modules/image-prompts.ts` or the client
  files. The count is unchanged from before this session’s code.
- `npx wrangler deploy --dry-run` — succeeds.
- Live mock-AI checks (`npm run e2e:dev`, `wrangler.e2e.jsonc`):
  - `POST /api/seo-plan {"topic":"key light setup"}` → `200` with two sets;
  - Historical pre-follow-up behavior: `POST /api/image-prompts {"minutes":3,"style":"neon noir"}` → `202`,
    then `GET` → `status:"ready"` with **14** prompts, `DELETE` → destroyed,
    next `GET` → `404`. The fixed catalog now rejects unsupported free-text labels with `400`;
    current coverage is in §6.
  - served `/free` HTML contains **0** occurrences of `Captions (bottom)`
    and contains the `va-upload-btn-` hook.
- Static audit: every claim in §2 was re-read against
  `src/client/app-js.ts` (MODULE 8b), `src/client/styles.ts`,
  `src/modules/script-seo.ts`, `src/modules/image-prompts.ts`,
  `src/index.ts` and `e2e/index.ts`; the findings are Registers A and B.

---

## 4. Assumptions and interpretations made while coding

1. **“Different” sets (SR-6)** were implemented as *not-the-same
   combination*: the second set may reuse individual shorts, the title or
   headings as long as its long-tail + ordered short list is not identical
   to the first set’s. The planner prompt asks for more than the validator
   enforces.
2. **6-minute scripts (SR-12)** are not covered by the requirement; the
   existing UI/API allow 1–6 minutes, so 6 maps to the largest specified
   bucket, 20 prompts.
3. **Dynamic-URL timing (SR-16 vs SR-9/SR-11)** was resolved in favour of
   dependency order: prompts need the style (chosen after the set) and
   image generation must wait for the script, so the URL is created after
   both, while still being a direct consequence of the selection.
4. **“Already-written image generation” (SR-17)** was read as the existing
   `/image/gen` route plus `AI_ENDPOINT`/`addAiToVideo`, not the AI Images
   panel’s two-image `submitAiImages` submit.
5. **Empty image style** is not an error; it falls back to
   `cinematic photorealistic, rich detail` so the flow cannot stall on an
   optional-looking field.
6. **Closing the modal** means removing it and rebuilding it on arrival
   (the voiceover-modal pattern), not hiding it; `hideSeoWalkthrough`
   exists but is unused.

---

## Register A — Inconsistencies between the newly coded session code and other code

Severity: **H** = can strand or corrupt a user flow, **M** = behaviour
differs from the surrounding system’s conventions, **L** = cosmetic/dead
code. This register records the original snapshot; §6 lists follow-up resolutions
(A-1 through A-4, A-7 and the style portion of A-14) and remaining open items.

- **A-1 (H) — Closing the modal after the sets arrive strands the flow.**
  `generateScript` disables both the upload button and the Generate SEO
  Script button at click time and only re-enables them at finalisation or
  failure. If the user closes `#seo-walkthrough-modal` at step 2 or 3,
  no enabled control can reopen it: the “reopen with cached sets/selection”
  branches at the top of `generateScript` are unreachable because the only
  button that calls it is `disabled`. SR-7 is therefore only safe while
  the plan is still generating. *Fix direction: re-enable the script
  button (or add another reopen affordance) while awaiting a choice.*
- **A-2 (H) — Gallery-count completion can be defeated or triggered early.**
  `watchGalleryCompletion` compares `#va-gallery-N` **child count** with
  `aiGalleryBaseline + imagePromptExpected`, but `addAiToVideo` enforces a
  **still-image** cap, users can remove gallery cards, and unrelated
  additions (AI Images panel, template composer) also add children.
  Consequences: with a nearly-full gallery the target is unreachable and,
  when no request “failed”, `scheduleAiImageQueue` never finalises — the
  URL lives until its TTL and the upload button stays disabled; with
  unrelated additions the target can be reached **early**, and an image
  request already in flight can still add a card (and even schedule the
  next timeout) after finalisation, because there is no cancellation.
- **A-3 (H) — `addAiToVideo` has no success signal, so counts lie.**
  It returns `undefined` and, at the 25-image cap, only `alert()`s and
  returns; `generateQueuedAiImage` nevertheless increments
  `project.aiImagesDone`, so the final status can claim images are “in
  the gallery” that were refused, and the queue does not count cap
  refusals as failures (feeding A-2). The pre-existing panel flow only
  calls it from a button click where the alert is the feedback.
- **A-4 (M) — Prompt-poll error paths do not destroy the URL or stop the
  gallery watcher.** On `status:"error"`, a network error, or an external
  `404`, `pollImagePromptOnce` clears the prompt poller and re-enables the
  buttons but leaves `_galleryWatcher` running and never sends DELETE;
  the job record survives until its 1-hour TTL (or isolate death).
  Finalisation also never checks the DELETE response’s status, so a
  failed destroy is reported as success.
- **A-5 (M) — A failed script regeneration destroys the displayed SRT.**
  `setScriptLoading(n, true)` replaces `#va-script-box-N`’s content with
  the spinner, and the `false` path only restores visibility when a SRT
  exists — it never restores the text. On failure after a previous
  successful script, the box keeps showing “Writing your SEO script…”
  (stopped animation), contradicting RULE 7’s “previous SRT stays on
  screen” behaviour; Download .srt and Generate Voiceover also remain
  usable against the old `project.srt` while the new request is in flight.
- **A-6 (M) — The walkthrough modal is a global singleton in a per-video
  system.** Every other accordion feature is keyed by `n`, but
  `ensureSeoWalkthrough` removes and rebuilds the one
  `#seo-walkthrough-modal`, and `renderSeoPlanSets`/`selectSeoKeywordSet`
  write into global IDs. Starting (or completing) a plan for Video 2 while
  Video 1’s plan is in flight overwrites Video 1’s modal; Video 1’s
  completion then renders its cards into Video 2’s modal (the card buttons
  still carry Video 1’s index). Accordions are otherwise fully independent
  (up to 10 concurrent projects).
- **A-7 (M) — The queue bypasses the existing AI-panel safeguards.**
  `submitAiImages` pre-checks the daily credit pill, stops the batch on
  `401`/`429`, caps the results panel and reports per-variant failures.
  `generateQueuedAiImage` re-implements the fetch with none of the
  pre-check/stop behaviour: after a `429` it keeps issuing one request
  every 20 s for every remaining prompt, and after a `401` likewise;
  server-side credit enforcement is the only guard.
- **A-8 (M) — Stale snapshots and stale cached sets.** Topic, minutes and
  speed are snapshotted when Generate SEO Script is clicked
  (`_seoTopic/_seoMinutes/_seoSpeed`) and cached `seoSets`/
  `selectedSeoSet` are reopened without comparing them to the current
  inputs. Editing the topic (or minutes/speed, possible while the modal
  is closed) after a plan therefore scripts and images the **old** topic
  with sets the user believes belong to the new one.
- **A-9 (M) — The “all form elements / all dropdown labels” rules are
  narrower than stated.** The unified CSS covers only
  `input[type=text|number]`, `select` and `textarea` inside
  `#video-accordions`; hidden file inputs are excluded by design and
  buttons rely on a different pre-existing rule. Sticker and Quality
  dropdowns have no `<label>` element at all (their `.va-section-title`
  acts as the heading), so SR-2’s “label above” holds visually but not
  semantically, and they have no label association for assistive tech.
- **A-10 (M) — “Two different sets” is weaker in code than in the prompt.**
  The second planner prompt says “do NOT reuse its long-tail … do NOT
  reuse its short keywords”, but `keywordSetsEqual` only rejects a reply
  whose long-tail **and** ordered short list are both identical; the
  second set may legally reuse every short, the title and the headings.
  The e2e fixture does exactly that (same four shorts, different
  long-tail) and still passes the flow.
- **A-11 (M) — Sequencing deviation from SR-16’s literal wording.** The
  dynamic URL is generated only after style confirmation **and** a
  successful script, not “once the user selected the SEO keyword set”;
  and the first image fires immediately when prompts arrive, so the
  20-second spacing is *settle-time + 20 s*, not a metronome. Both were
  deliberate interpretations (see §4) but they are not the literal text.
- **A-12 (M) — New AI routes ignore the system’s usage/auth conventions.**
  `/api/seo-plan` and `/api/image-prompts` are anonymous (consistent with
  `/api/script`) but, unlike `/api/script`, they never invoke the
  `onValidated` usage recorder, so up to 9 extra instruct-model calls per
  walkthrough are invisible to the script counters; and the capability
  URL itself is unauthenticated — anyone with the UUID can poll or DELETE
  it. `/image/gen`, by contrast, is session/guest-gated and metered.
- **A-13 (L) — Caption removal left dead and half-wired code.** With the
  accordion section gone, `vaCaptionRowHTML`, `addVaCaptionRow`,
  `removeVaCaptionRow` and the accordion branch of the caption summary
  can never produce rows; `collectVideoPayload(n)` therefore always sends
  `captions: []` for accordion videos, while the render/worker payload
  format, the hidden global caption rows and the caption render engine
  all still exist. The feature is removed from the UI but not from the
  system.
- **A-14 (L) — Style/topic/length limits disagree across layers.** Style
  input `maxlength=200` (client) vs 300-char server cap vs the
  instruction builder’s different fallback string; topic input
  `maxlength=120` vs the APIs’ 160-char cap; image-prompt style presence
  in returned prompts is instructed but never verified, unlike the
  exactly-validated prompt count and the heavily-validated SEO sets.
- **A-15 (L) — Storage/lifetime mismatch for prompt jobs.** In production
  the dynamic URL is a KV record (1 h TTL); in no-KV mode it is an
  in-isolate `Map` entry that vanishes on isolate recycle, and without an
  execution context the background promise is fire-and-forget. The client
  cannot distinguish these lifetimes, and a job that outlives its browser
  tab is only ever removed by TTL.

---

## Register B — Inconsistencies between the documentation and the code

This register covers documentation that does not match the code as it now
stands — including passages written for this session. Older passages are
**not** rewritten by this document; they are listed so a reader knows which
text to distrust. The canonical behaviour is §2 above plus RULE 24 in
`system-rules.md` as corrected by this register.

- **B-1 — The accordion still documented as having per-video captions.**
  `README.md` (“each with its own … captions”, and the Limits table’s
  “Captions | 10 rows…”), `userflow.md` §4 (the accordion diagram lists
  “Captions (bottom) — up to 10 rows”), §5/§6 (caption rows swapped in/out
  per video, `captions` in the render payload from the accordion) and
  `system-rules.md` RULE 9/10 passages describe an accordion caption UI
  that SR-4 removed. What remains true: the hidden global caption rows,
  the caption drawing engine, and API-supplied `captions` in worker jobs.
- **B-2 — `userflow.md` §4.2 and §10 describe the pre-walkthrough script
  flow.** §4.2’s diagram says the client sends only
  `{topic, minutes, speed}` to `POST /api/script` and the AI plans then
  writes in one click; §10’s happy path repeats it. The studio client now
  first calls `POST /api/seo-plan`, lets the user select a set and a
  style, and sends `{topic, minutes, speed, keywordSet}`; only direct API
  callers and the no-walkthrough path still match §4.2. RULE 7’s client
  bullet in `system-rules.md` carries the same history and is only partly
  superseded by its RULE 24 note; it also attributes the success handling
  to `generateScript()` where the code now splits it between
  `generateScript` (plan), `confirmSeoStyleAndGenerate` (style) and
  `runSeoScriptRequest` (script display).
- **B-3 — Route inventories omit the new routes.** `userflow.md` §2’s
  surface map has no `/api/seo-plan` or `/api/image-prompts*` rows, and
  §9’s code map still files the whole flow under MODULE 8 /
  `generateScript()` with no mention of MODULE 8b or
  `src/modules/image-prompts.ts`. `system-rules.md` RULE 1’s route-order
  list likewise predates both routes (they are matched immediately before
  `/api/script` in `src/index.ts`). `README.md`’s route table **does**
  list them.
- **B-4 — “Two different SEO keyword sets” is overstated in this
  session’s own docs.** `README.md`, `userflow.md` Flow 6 and
  `system-rules.md` RULE 24 (and the `handleSeoPlanGeneration` header
  comment, “guaranteed different (different long-tail and short
  keywords)”) claim a stronger guarantee than `keywordSetsEqual`
  enforces: only an identical long-tail + ordered-shorts combination is
  rejected, so the two sets may share all four shorts, the title and the
  headings — as the e2e fixture’s second set demonstrably does (A-10).
- **B-5 — RULE 24’s teardown guarantee is stronger than the code.**
  RULE 24 states that if some images fail “the flow still finalises …
  so the URL is never leaked and the upload button never stays disabled.”
  That holds only for image-request failures after prompts arrive; the
  prompt-error, external-404, gallery-cap, card-removal and in-flight
  races in A-2/A-4 can leave the URL alive until TTL and/or the watcher
  running. RULE 24 also says generation finishes “via `ctx.waitUntil`”
  without mentioning the no-context fire-and-forget fallback.
- **B-6 — RULE 24 / Flow 6 sequencing vs SR-16.** The session docs
  describe the implemented order (script → create prompt URL → poll),
  while the original requirement text (SR-16) says the dynamic URL is
  generated once the keyword set is selected. The docs do not flag this
  as the deliberate deviation recorded in §4 item 3 — a reader comparing
  requirement and docs will find the discrepancy unexplained outside
  this document.
- **B-7 — Form-standard wording overreaches.** `README.md`,
  `system-rules.md` RULE 24 and `userflow.md` Flow 6 say “every form
  element” shares the Upload MP3 proportions and “dropdown labels always
  sit above their dropdown”. The CSS covers only text/number inputs,
  selects and textareas in the accordion (A-9); the walkthrough modal’s
  own controls are outside `#video-accordions` (only the style input is
  separately styled to match), and Sticker/Quality have headings rather
  than labels (A-9). The docs also omit that themed skins replace the
  8px radius with the theme radius token (Neo: 0).
- **B-8 — User-visible hints were not updated for the walkthrough.**
  RULE 18’s inventory (`system-rules.md`, echoed in `README.md`) still
  presents the **Generate SEO Script** tooltip (“AI plans 1 long-tail
  keyword … then writes the SRT script around them”) and the section hint
  as the complete pre-click explanation. Neither the tooltip nor the hint
  in the code mentions the two-set selection, the image style, the
  disabled upload button, or the queued images — so the documented
  “contract text” no longer describes what the button actually starts.
- **B-9 — Counts for 6-minute scripts are documented inconsistently.**
  `README.md`’s walkthrough bullet and route table give the count table
  as “10 / 14 / 20 by script length 1 / 2–3 / 4–5 min” and stop there,
  while the UI and both APIs accept 6 minutes and
  `imagePromptCountForMinutes(6)` returns 20; only RULE 24 and this
  document mention the 6-minute mapping. The modal’s own note in the
  code (“10 for 1 minute, 14 for 2–3 minutes, 20 for 4–5 minutes”) has
  the same gap.
- **B-10 — “The image generation function already written” is ambiguous
  in the docs.** Flow 6 says images are generated “through the normal AI
  image route”, and RULE 24 says “through the existing `/image/gen` route
  (`AI_ENDPOINT`) … via the existing `addAiToVideo` path”, which is
  accurate; but a reader of MODULE 5’s documentation (`userflow.md`
  §4.1 B, `system-rules.md` AI-images passages) would reasonably expect
  the panel function `submitAiImages` — with its credit pre-check and
  401/429 stop — to be the reused function. It is not called by the queue
  at all (A-7), and MODULE 5’s header comment still describes the panel
  as the accordion’s “40% right panel”, which predates the one-column
  accordion.
- **B-11 — Small API-shape drifts between docs and code.** (a) The docs
  call DELETE “destroying the URL — later polls get 404”, but DELETE is
  idempotent and also returns `200 {destroyed:true}` for ids that never
  existed. (b) A failed prompt job is polled as
  `200 {success:true, status:"error", prompts:[]}` rather than the
  `success:false` shape the other JSON APIs use. (c) `README.md` says
  `/api/script` “accepts a user-selected `keywordSet`”, without noting
  that `keywordSet: null` is treated as absent (planner runs) while a
  non-object or invalid set is a `400`. (d) The e2e fixture documents its
  second set as the “different” set while sharing the first set’s shorts
  (see B-4).
- **B-12 — This session’s docs omit the stranded-close and multi-video
  caveats.** Neither RULE 24, Flow 6 nor the modal’s own note (“You can
  close this walkthrough — the SEO plan keeps generating…”) warns that
  closing the modal **after** the sets arrive leaves both buttons
  disabled with no reopen path (A-1), or that the single global modal is
  shared by all accordions (A-6). The note’s promise is true only during
  the planning step.

*End of the session record. Registers A and B are the bottom-of-document
lists requested for this double-check; every item in them is an observed
code/documentation mismatch, not a planned fix.*

---

## 6. Follow-up fixes — 2026-10-24

This section is the current source of truth for the six fixes requested after the original
snapshot above. The earlier Register A/B entries remain as audit history; they are not claims
that the resolved defects still reproduce.

### UI and image style

- The template scene graphic inspector no longer renders the **Shapes & stickers** heading or
  sticker-box grid. **Delete element** is in the same header row as **＋ Text / ＋ Graphic**, and
  is hidden/disabled for the background or a deleted/unselected element. The **+ Front layer**
  and **- Back Layer** controls retain their position and share `.tm-tool` styling with the
  top-right **Pause** button.
- SEO keyword-set and selected-set cards use white backgrounds with readable dark text, themed
  borders/accents and a theme-aware style dropdown. The dropdown exposes exactly: `Cinematic
  Film`, `Editorial Magazine`, `Kinetic Typography`, `Neon Night`, `Minimalist`, `Retro Poster`,
  `Documentary`, `Split Composition`, `Dream Glow`, and `Pop Comic`. The chosen value persists
  when the modal is closed/reopened; the server accepts only these canonical labels.
- `summarizeScriptIdea()` extracts the opening and closing spoken sentences and caps the result
  at 480 characters; image-prompt instructions ask for concise broad scenes conveying the
  script's central idea rather than detailed SRT cue-by-cue retellings. The selected style's
  direction is appended to each prompt after exact-count parsing, keeping every scene consistent.

### Flow diagnosis and correction

The failure path was in client-side orchestration rather than the script or image model route:
`addAiToVideo()` returned no success value at the 25-still cap, so the queue counted refused
images as successes. Meanwhile, gallery completion compared total DOM children against
`baseline + expected prompts`, which could be unreachable for a nearly-full gallery or reached
early by unrelated cards. Prompt polling waited for its first 30-second interval and terminal
poll/404 paths did not reliably destroy the job or stop the gallery watcher; image-credit
`401`/`429` responses could also let the queue continue. Those paths could leave the dynamic job
and upload button hanging even though the script had already been generated.

The client now validates the same-origin dynamic URL, matching job id and expected count; polls
immediately and then every 30 seconds with bounded retries/timeouts; schedules images 20 seconds
after each prior attempt settles; stops on exhausted credits and hard gallery errors; and tags
each inserted asset/card with the prompt-job id. Available capacity is computed against the
25-still cap. Completion counts only tagged cards in the correct video gallery and finalizes
when the target is reached or the queue has attempted its usable prompts. Success, partial,
cap-limited, prompt-error, 404 and image-error paths all clear timers, abort outstanding requests,
attempt DELETE (retry once), report actual inserted images and re-enable the controls. Server
`[image-gen]` logs include variant, prompt length and latency/result but not prompt content.

### Verification

- `npm test` — **45 tests, 45 pass, 0 fail**. Coverage includes a Worker-level mock-AI sequence
  through SEO plan → selected-set script → dynamic prompt job → poll → `/image/gen` → DELETE,
  plus a jsdom client-flow test that fills a gallery to 24/25, verifies one tagged image lands in
  the correct gallery, confirms the cap, checks the chosen style and partial-result finalization,
  and asserts the upload/script controls are re-enabled.
- `npx wrangler deploy --dry-run` succeeds. `npx tsc --noEmit --pretty false` still reports the
  36 pre-existing diagnostics in `src/index.ts`; the revised modules/client add no TypeScript
  diagnostics. Live Cloudflare model availability is not exercised by the mock suite.
- Register A items **A-1, A-2, A-3, A-4, A-7** and the style-catalog/output portion of **A-14**
  are resolved by this follow-up. Other historical items remain outside scope unless separately
  changed.
