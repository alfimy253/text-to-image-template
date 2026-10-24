# SEO Walkthrough Session — System Requirements, Implementation Record and Double-Check Audit

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

The registers are an audit record. Writing this document did **not** fix the
listed inconsistencies; items marked **Open** still describe the code as it
stands. Where older documentation and this document disagree, the code is the
behaviour users actually get, and Register B names the older passage that is
wrong.

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
   through `escapeHTML`) and shows step *2 · Choose a keyword set*. On plan
   failure the modal is closed, the accordion status line shows
   `SEO plan failed: …`, and the upload and script buttons are re-enabled.
4. **Selection (SR-8).** Each card’s **Select this set** button calls
   `selectSeoKeywordSet(n, idx)`, storing `project.selectedSeoSet` and
   advancing to step *3 · Video image style*, showing the chosen set’s
   chips above a labelled text input (`#seo-wt-style-input`, label above
   the field). Re-clicking Generate SEO Script with cached sets/a selection
   reopens the modal at the corresponding step without a new plan request.
5. **Style + script (SR-9, SR-10, SR-11).** **Generate Script & Images**
   (`confirmSeoStyleAndGenerate`) stores `project.videoImageStyle`
   (empty input falls back to `cinematic photorealistic, rich detail`),
   closes the modal, sets `project._imageFlowActive = true` and awaits
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
  `startImagePromptFlow(n)` records the gallery’s current child count as
  `aiGalleryBaseline` and POSTs
  `{topic, minutes, style, script: project.srt, keywordSet}` to
  `/api/image-prompts`. The handler validates (topic sanitised/capped at
  160 chars, minutes integer 1–6 default 1, style capped at 300 chars with
  the cinematic fallback), stores a `pending` job with `prompts: []` and
  answers **`202 {success, id, url: "/api/image-prompts/<id>", status,
  prompts: [], expectedCount, style, minutes}`** immediately. The LLM work
  runs in the background: `ctx.waitUntil(work)` when an execution context
  is supplied, otherwise the promise continues inside the isolate.
- **Storage.** With `KV_BINDING` bound, jobs are KV records
  `image-prompts:<id>` with a 1-hour TTL. Without KV (tests, the e2e
  fixture) an in-isolate `Map` is used instead.
- **Prompt instruction (SR-12, SR-14).** `buildImagePromptInstruction`
  tells the instruct model (`SCRIPT_MODEL`, the same llama instruct model
  as the script) to answer with only `{"prompts":[...]}`: exactly
  `imagePromptCountForMinutes(minutes)` prompts — **1 → 10, 2–3 → 14,
  4–5 → 20**, and 6 (the UI maximum, unspecified by SR-12) also → 20 —
  in script order, one distinct text-free scene each, every prompt ending
  in the user’s image style, with the SEO keywords and a 4,000-character
  script excerpt woven in. `generateImagePrompts` retries up to 3 times
  until the parsed list (`parseImagePrompts`: JSON object/array, or a
  numbered-list rescue; trimmed, de-duplicated, capped at 500 chars each)
  reaches the exact count, then marks the job `ready` (or `error`).
- **Polling (SR-16, second half).** The client polls the dynamic URL with
  `setInterval(..., IMAGE_PROMPT_POLL_MS)` where
  `IMAGE_PROMPT_POLL_MS = 30000` (first query 30 s after creation; the
  cadence constants are exposed as `window.__SEO_FLOW_TIMING`).
  `GET /api/image-prompts/<id>` answers `prompts: []` while `pending`,
  the full array when `ready`, the stored error when `error`, and `404`
  for a destroyed/unknown id.
- **Queued generation (SR-15, SR-17, SR-18).** When a poll returns a
  nonempty prompt array, polling stops and `scheduleAiImageQueue` runs:
  the first image is requested immediately, each subsequent one via
  `setTimeout(step, AI_IMAGE_QUEUE_MS)` (`20000`) scheduled **after** the
  previous request settles. Each image is fetched from the pre-existing
  `/image/gen` route through the existing `AI_ENDPOINT(prompt, variant)`
  builder and inserted into that video’s gallery with the pre-existing
  `addAiToVideo(n, file, blob)` path (which enforces the 25-image cap via
  `videoCounts` and builds the gallery card). Credits are the existing
  `/image/gen` daily image credits; `refreshCredits()` runs after each
  success.
- **Completion and teardown (SR-19, SR-20).** A second interval,
  `GALLERY_WATCH_MS = 1000`, polls `#va-gallery-N`’s child count. When it
  reaches `aiGalleryBaseline + imagePromptExpected`,
  `finalizeImagePromptFlow` clears all three timers, sends
  `DELETE /api/image-prompts/<id>` (the record is removed; subsequent
  GETs answer `404`), and re-enables **Upload Image, GIF or MP4** and the
  Generate SEO Script button with the status
  `AI images done — N image(s) in the gallery. …`. If image requests
  failed, finalisation also runs after the last prompt has been attempted
  so the buttons are not left disabled on the all-failed path.

### 2.4 Requirement-by-requirement conformance

| Req. | Status | Note |
| --- | --- | --- |
| SR-1 | Implemented, scoped | Only text/number inputs, selects and textareas under `#video-accordions` are covered; buttons follow the separate pre-existing accordion-button rule. See A-9. |
| SR-2 | Implemented for labelled dropdowns | Minutes/Speech and Font/Colour labels are stacked above. Sticker/Quality have section titles, not `<label>` elements. See A-9. |
| SR-3 | Implemented | Accordion text inputs/textareas: 4px top, 5px bottom. |
| SR-4 | Implemented | Visible section removed; caption plumbing remains as dead/guarded code. See A-13. |
| SR-5 | Implemented | Upload button disabled at click; modal shows step 1 while `/api/seo-plan` runs. |
| SR-6 | Partially implemented | Two validated sets; “different” is enforced only as “not the identical long-tail + ordered-shorts combination”, and the prompt’s stronger wording is not validated. See A-10. |
| SR-7 | Implemented during generation | Close removes the modal; the fetch continues; success re-creates and reopens it. Closing **after** the sets arrive strands the flow (A-1). |
| SR-8 | Implemented | Select buttons on both cards store the chosen set. |
| SR-9 | Implemented | Style step with labelled text input; empty input uses a default style. |
| SR-10 | Implemented with a defect | Loading animation shows while awaiting the script and the old display path is kept; a failed **re**-generation leaves the spinner in the box instead of restoring the previous SRT (A-5). |
| SR-11 | Implemented | Image-prompt job is created only after script success is displayed. |
| SR-12 | Implemented (+ assumption) | 10/14/20 for 1 / 2–3 / 4–5 min; 6 min (unspecified) also maps to 20. |
| SR-13 | Implemented | Minutes come from the existing dropdown, default/selected 1; server also defaults omitted minutes to 1. |
| SR-14 | Implemented as instruction only | Count and style are in the LLM instruction and the count is validated exactly; the presence of the style in each returned prompt is **not** validated. See A-14. |
| SR-15 | Implemented approximately | First image immediately on prompt arrival, then one call per 20 s **after** the previous settles — not a fixed wall-clock 20 s ticker. See A-8. |
| SR-16 | Deviation in sequencing | The dynamic URL is created **after** style confirmation and after the script succeeds, not at the moment of keyword-set selection; polling itself is every 30 s and returns `[]` until ready. See A-11. |
| SR-17 | Partially implemented | Reuses the existing `/image/gen` endpoint builder `AI_ENDPOINT` and the gallery inserter `addAiToVideo`, but bypasses the existing panel generator `submitAiImages` and its pre-checks. See A-7. |
| SR-18 | Implemented | Images are added to `#va-gallery-N` of the same accordion. |
| SR-19 | Implemented on the happy path | DELETE is sent at finalisation; several error/edge paths never DELETE (A-3, A-4). |
| SR-20 | Implemented on the happy path | 1 s gallery-count poller finalises at baseline + expected; cap/removal/in-flight races can defeat it (A-2). |
| SR-21 | Verified as far as tested | Full test suite, type check and dry-run pass; live mock-AI route checks pass. Edge defects are logged in Register A rather than silently fixed. |

---

## 3. Double-check evidence (this audit)

Run after `npm ci` (dependencies are not persisted between sessions):

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
  - `POST /api/image-prompts {"minutes":3,"style":"neon noir"}` → `202`,
    then `GET` → `status:"ready"` with **14** prompts, `DELETE` → destroyed,
    next `GET` → `404`;
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
code. All items are **Open** (documented, not fixed) unless stated.

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
