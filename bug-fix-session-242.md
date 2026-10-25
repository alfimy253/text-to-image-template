# Bug Fix Session #242 — plain narration scripts, the quick-batch table and the local render app

**Date:** 2026-10-25
**Area:** `POST /api/script` (`src/modules/script-seo.ts`), `POST /api/image-prompts`
(`src/modules/image-prompts.ts`), `POST /api/image-batch` (`src/modules/image-batch.ts`),
MODULE 1b / MODULE 1c / the SEO walkthrough in `src/client/app-js.ts`, `src/client/markup.ts`,
`src/client/styles.ts`, and the new `render-app/` (with `render-app-tts.zip`)
**Status:** fixed, covered by tests, verified in `workerd` (`wrangler deploy --dry-run`); the
render app is verified by `node selftest.mjs` and needs one live run per provider on the user's
machine (this sandbox has no browser and no route to the free TTS hosts)

---

## 1. What was reported

Eight items, all of them about the path *script → voice → images → video*:

1. the script generator still asked the model for SRT and the client still parsed timestamps;
2. the image-prompt answers were thin, so the guard padded them into unusable filler;
3. the walkthrough's tooltip promised "25-still cap" behaviour the table did not have;
4. a failed script stayed failed: one attempt, no message, the spinner never cleared;
5. the walkthrough and the voiceover modal fought over one shared overlay;
6. the quick-batch table's Export button opened a modal instead of producing a video;
7. there was no standalone renderer that could voice a 20,000-character script for free;
8. none of it was written down.

## 2. SRT is gone from the script path (item 1)

**Cause.** `handleSeoScriptGeneration` returned `{success, srt, script}`, `validateSrt` was the
only shape check, and the client stored `project.srt`, rendered a `Download .srt` link and
re-parsed cue timestamps before the voiceover. A user pasting their own script had to imitate
subtitle markup to get a video.

**Fix.**

- `plainScriptFromCues(cues, cuesPerParagraph = 4)` in `src/modules/script-seo.ts` renders the
  **validated cues** as prose paragraphs (four sentences each, one blank line between);
  `plainScriptFromSrt(srt)` is the same conversion for a body that still carries `srt`.
- `/api/script` now answers
  `{success, script, format:"plain", title, headings, keywords, lines, words, durationMs, minutes, model}`.
  There is no `srt` key. **Validation is unchanged**: the cue list is still built, still checked for
  overlap, cue length and `10 s … minutes*60 s + 1.5 s`, and keyword counts are still measured on
  spoken text — only the *payload shape* changed, so no keyword rule was weakened.
- `sanitizeInput` in `src/modules/image-prompts.ts` ignores `body.srt` entirely and takes
  `body.script || body.scriptIdea`.
- The client stores `project.script` (+ `scriptDurationMs`), the accordion shows a collapsible
  **plain narration script** box, and every "SRT" string in the tooltip, the button label, the
  modal note and the status lines became "script". `grep -n "SRT\|\.srt" src/index.ts
  src/client/app-js.ts` is now empty apart from the two helper names that exist *because* old
  bodies may still post `srt`.
- Cue timing for the finished video is derived, not parsed: `buildScriptCues(script, totalMs)`
  splits on sentence enders, wraps at 84 characters and shares out the decoded audio duration
  with a 1,200 ms floor per cue, so subtitles stay in sync without any timestamp input.

**Test.** `tests/seo-walkthrough.test.mjs` asserts `script.script`, `format === "plain"` and
`script.srt === undefined`; `tests/quick-batch-table.test.mjs` asserts `plainScriptFromSrt` and
that no SRT download/parser/label survives in the shipped client.

## 3. Prompts are padded to the guard, not to a count (item 2)

**Cause.** The guard counted **lines**. A model answer of `1. a scene / 2. another` was "long
enough", while a real paragraph answer was rejected and re-generated, and `applyImageStyleToPrompts`
appended a style sentence that pushed entries past the cap.

**Fix.** `IMAGE_PROMPT_MIN_PARAGRAPHS = 3`, `IMAGE_PROMPT_PARAGRAPH_MIN_WORDS = 30`,
`IMAGE_PROMPT_MAX_CHARS = 2600` and `enforceParagraphGuard()` now work on **paragraphs**:

- `splitPromptParagraphs` keeps the model's own paragraph breaks (a numbered list is still one
  scene per line, but the lines are grouped);
- a thin answer is **topped up** with generic, style-neutral paragraphs built from the topic and
  the video length — it is never rejected, and the model's own text always survives as paragraph 1;
- `applyImageStyleToPrompts` runs the guard first, then appends a single closing
  "Visual style: …" paragraph, and the whole entry is capped at 2600 characters;
- `rescuePromptList` re-joins a truncated JSON array so a half-streamed answer is still usable;
- `src/modules/image-batch.ts` shares `IMAGE_PROMPT_MAX_CHARS` and uses a paragraph-preserving
  `normalizeBatchPrompt`, plus `IMAGE_PROMPT_TIMEOUT_MS = 150000`, `IMAGE_BATCH_MAX_PROMPTS = 20`,
  `CONCURRENCY = 4`, `ATTEMPTS = 2`, 1024×576 and `num_steps: 20`.

**Test.** the guard tests in `tests/image-prompts.test.mjs` plus the "3-paragraph guard" case in
`tests/quick-batch-table.test.mjs` (`countPromptParagraphs(...) >= 3`, "what the model wrote stays
as paragraph 1", and a full prompt that must come back untouched).

## 4. Walkthrough: three attempts, real messages, one modal at a time (items 3–5)

- **Retry (4).** `SCRIPT_RETRY_LIMIT = 2` → **3 attempts** per step. `requestSeoScriptOnce` throws
  with the server's reason; `runSeoScriptRequest` shows
  "Script failed (…); retrying (N of 2)…" mid-flight and
  "Script failed after 3 attempts: …" at the end. A generated-script failure no longer needs a
  page reload: the box, the status line and both buttons are restored on every path.
- **One modal per video (5).** A `MODAL STACK` block owns `MODAL_BASE_Z_INDEX = 1200`,
  `openModal`/`closeModal`/`topModal`/`modalBlocksEscape`; ids are
  `seo-walkthrough-modal-<n>` / `voiceover-modal-<n>`; `Esc` only closes the top one; while a step
  is `sets` or `style` the modal carries `data-await-choice="1"` so it cannot be dismissed by
  accident. Two videos can be walked through at once, each stacked 10 z-index points above the
  other, and the SEO plan of one never lands in the accordion of another.
- **Walk-away copy (3).** Both exits — "close this window" and "keep the images and close" — end
  with the same sentence: the script, the chosen style and the image count are already saved on
  the video, and closing the modal never loses them. The tooltip no longer promises a 25-still
  cap for the table flow (the table is capped by **rows**, 10 of them, and by
  `IMAGE_BATCH_MAX_PROMPTS`).

## 5. Quick Batch table (items 6, and the two-view shell)

`#view-switch` toggles **Table** and **Editor**; the table view (`#view-table`) is a real editor:

| column    | control                                            |
| --------- | -------------------------------------------------- |
| Script    | `<textarea class="batch-textarea">` (plain prose)  |
| Style     | `<select class="batch-select">` (the ten styles)   |
| Minutes   | `<input class="batch-minutes" type="number" 1-6>`  |
| Preview   | one button, enabled only when the row is finished  |
| Export    | one button, enabled only when the row is finished  |

Rules that the implementation is built around:

- rows live in `const batchRows = []` (also `window.__BATCH_ROWS`), **not** in `videoProjects`;
  `BATCH_ROW_LIMIT = VIDEO_MAX_VIDEOS` (10), minutes clamped to 1…6, and the blank row is seeded
  **once** so an emptied table stays empty;
- `renderBatchTable()` skips rebuilding while the id signature is unchanged — typing is never
  interrupted by a re-render — and `updateBatchToolbar()` owns `#batch-note`
  ("N rows · M with a script"), `#batch-empty`, `#batch-generate`
  ("✦ Generate (N)" / "■ Stop generating" — it read "■ Stop after the current row" until the
  Session #211 second pass, when one run became three lanes) and `#batch-add-row`;
- `batchRowFinished(row) = row.mp3 && row.images.length && row.animated && row.slides.length` is
  the **single** gate feeding both action cells: an unfinished row shows
  `<span class="batch-pending">Preview Here</span>` / `Export Video` text, a finished row shows two
  working buttons. Preview and export therefore unlock together, and scriptless rows never get a
  button at all;
- one row failing sets `stage = "error"` on **that** row only; the others keep running
  (`generateBatchRows()` was sequential behind `batchRunBusy` when this session ran — since the
  Session #211 second pass it runs `BATCH_RUN_CONCURRENCY = 3` lanes and skips finished rows;
  `stopBatchRows()` aborts through `row.controller`, `BATCH_REQUEST_TIMEOUT_MS = 240000`);
- preview is an injected `#batch-preview-modal` (1024×576 canvas then; since the Session #211
  second pass the canvas takes the row's own Resolution/Orientation frame, `requestAnimationFrame`, the
  exporter's own Ken Burns zoom-in of 1 → 1.08 per slide cover-fit, `drawSubtitles`, and the slide
  list looping at `slideDurationSec(row.slides[0])`), opened through `openModal` so it stacks with
  the walkthrough; slide decode is raced against `BATCH_SLIDE_DECODE_MS = 10000` and a non-promise
  `play()` is tolerated;
- export (`exportBatchRow`) snapshots the live editor (`activeSlides`, `currentAudio`, caption
  rows, `#title-input`, `window.__workerMode`), sets
  `renderContext = {fileName: "YouTubeVibeStudio_Row<N>_<slug>.mp4", subtitles: row.subtitles, batchRow: true}`,
  clears the title, `await generateMP4()`, downloads `window.__lastRenderBlob` and restores
  everything in `finally`. **No `/api/render` call exists anywhere in the client** — the export is
  the same in-browser WebCodecs path the editor uses, and a test asserts the export body contains
  no `fetch(`.

**Tests.** `tests/quick-batch-table.test.mjs` (8 tests) builds the table from `PAGE_HTML`, boots
the real client in jsdom and runs **one whole Generate through mocked routes**
(`/api/voiceover`, `/api/image-prompts`, `/api/image-batch` NDJSON): finished rows turn both cells
into buttons, per-row errors stay per-row, defaults are `minutes 1` / `Cinematic Film`, and export
never POSTs `/api/render`.

## 6. Render app (item 7)

`render-app/` is a standalone Node helper; `render-app-tts.zip` is the same directory as a
drop-in for another machine.

- `server.mjs` — `node:http`, no framework. `POST /api/tts` **requires**
  `apiKey === "1290890909&aPiky2026"`, accepts a script of ≤ **20,000 characters** and
  `voice: "male" | "female"`; `GET /api/job/:id` streams
  `{stage, done, total, percent, message, url, bytes, ms, error}`; `POST /api/job/:id` stops a job;
  the MP3 is served from `output/`.
- `lib/tts-engine.mjs` — sentence chunks of ≤ 280 characters, **exactly two** voice choices, each
  resolved by matching the *host's own* `<option>` labels
  (`/\b(?<!fe)male\b|…` for the male slot; the lookbehind matters because "female" ends in "male"),
  conversion captured from a real download event or an `<audio src>` / `a[download]` reveal, and MP3
  frames concatenated with the later chunks' ID3 tags dropped so the joined file stays playable.
- Providers: `ttsmp3` (default) and `text-to-speech` are free no-login sites driven by Playwright;
  `mock` writes a silent MP3 through the identical pipeline so the app is testable with no network.
- `public/` keeps the 20,000-character counter honest and never stores anything in the browser.

`cd render-app && node selftest.mjs` → **31 checks**, covering the contract, chunk packing, the
offline render, the MP3 join and the full HTTP round trip including the 401 and 400 paths.
`tests/render-app-tts.test.mjs` (5 tests) keeps it pinned from the repo's own suite: the key, the
cap, the two voices, the free-host selection rules, `playwright` as a declared dependency and the
"no render route in the studio" invariant.

## 6b. Second pass: dangling code and the doc drift it caused

A follow-up sweep looked for *unfinished* pieces rather than wrong behaviour — the failure mode of a
generation that stops mid-edit. Bundles were extracted from their template literals and checked with
`node --check` plus `tsc --noEmit --allowJs --checkJs`, which reports `TS2304 Cannot find name` — the
signature of a spliced-out identifier:

- **two live crashes, both pre-existing and both fixed:** the auth overlay's `keydown` listener
  dereferenced `e` where the parameter is `event` (every keypress threw `ReferenceError: e is not
  defined`, and Escape never closed the overlay), and the worker-mode project restore read
  `p.captions || ns || []` where `ns` exists nowhere (any payload without captions crashed).
- **four leftovers of the replaced read-only grid, removed:** the `[data-open]` listener,
  `focusVideoInEditor()`, the `#video-accordions` `input` → `renderBatchTable()` sync listener, and
  the `.batch-index` / `.batch-title` / `.batch-sub` / `.batch-badge[data-state]` / `.batch-open` CSS
  (plus its theme override). `batchRowId()` and `hideSeoWalkthrough()` — added earlier in this
  session, never called — were deleted too.
- **one half-done rename finished:** `.batch-col-preview` / `.batch-col-export` had no width rule
  while the other three columns did; they now do, so every emitted `.batch-*` class is styled and
  every `.batch-*` selector greps back to emitted markup.
- **what was checked and found sound:** no undefined identifiers in *any* shipped bundle (studio,
  composer, ring carousel, scene editor, shape animations, settings page, payment uploader), every
  `data-*` attribute read by JS is emitted by the code that reads it, the render app wires all 12 of
  its page ids and honours its abort signal between chunks, and `tsc` over the Worker still reports
  exactly the same 36 pre-existing errors as before this session.
- The leftovers that are guarded no-ops in the shipped app (`#va-captions-N` lookups,
  `addVaCaptionRow`, `toggleAccountBox`) are **documented, not deleted** — see the register in
  `bug-audit.md` #21-#23.
- Two documentation errors this session had introduced were corrected against the code: the preview
  zoom is the exporter's Ken Burns **1 → 1.08 per slide**, not "8% zoom"; `addBatchRow()` returns
  `null`, not `false`; the plain-script helper is `plainScriptFromCues()`; and RULE 22 no longer
  claims the table can jump to an accordion.

## 7. Docs (item 8)

`README.md`, `userflow.md`, `new_requirements.md` (§7) and `system-rules.md`
(RULE 7 script shape, RULE 8 voiceover input, RULE 18 hint inventory, RULE 22 two-view shell,
RULE 24 prompt/batch rules, new RULE 25 for the batch table and RULE 26 for the render app) were
rewritten for the above; `render-app/README.md` documents the helper on its own.

## 8. Deliberate non-changes

- the API answer stays **JSON, not MP3 bytes**: a 20,000-character script is minutes of audio and
  several chunk requests, so a job id + progress + a downloadable file is the only shape that can
  show anything while it works;
- the key is hardcoded rather than read from config, because this helper must not become an open
  TTS relay; it is not a user secret and grants nothing on the Worker;
- `npm run check` (`tsc`) still fails with 36 pre-existing `src/index.ts` type errors (missing
  `Env` bindings/workerd types) — unchanged by this session; the gates are `npm test`
  (**59 pass**) and `npx wrangler deploy --dry-run`.
