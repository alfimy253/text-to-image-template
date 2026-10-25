# Bug Fix Session #248 — 2026-10-26

Pipelined queue advancement for the Quick batch table (`#view-table`).

| # | Request (user's words) | Result |
| --- | --- | --- |
| 1 | I don't like the flow for generate button in the quick batch table layout... Bec when i input Scripts in more than one rows then click generate there is a rule that 3 rows can process simultaneously but if i have 4 or more than three rows they didn't start processing until i finished the first three i need to start the generate button again.... | Fixed: replaced the rigid 3-lane worker loop with staggered pipelined queue advancement (`startUnprocessedRows()`). Up to 3 rows start simultaneously in early stages, and the 4th and subsequent rows start as soon as earlier rows advance in the pipeline. All rows process to completion without requiring a second click of Generate. |
| 2 | Let the other rows start when the first simultaneously processed rows move in the pipeline steps.. to do this you may add a function to start unprocessed rows when a row move to next step of processing ( ex. image generation ).. | Added `startUnprocessedRows(activeRow)` (and alias `startUnprocessedBatchRows`). When an active row moves to the next step of processing (stage `images` / image generation), its early-pipeline slot is vacated and `startUnprocessedRows()` immediately pulls and starts the next unprocessed row from `batchQueue`. |
| 3 | Understand the code and entire system bec i qa the entire bulk video creation the batch table cant work or finish a single row of video pls..debug | Fixed: diagnosed and resolved root causes preventing rows from finishing in QA/live usage: (1) In `e2e/index.ts`, `pngSignature` was only 12 bytes and returned for both audio and image models, breaking browser image decode (`Image.decode()`) and audio decode (`AudioContext.decodeAudioData()`); replaced with a fully valid 1x1 PNG (70 bytes) and a valid 1-second 44.1kHz 16-bit PCM WAV. (2) In `buildBatchSlides` (`src/client/app-js.ts`), decode warnings previously discarded slides (`continue;`), leaving `slides` empty and failing the row; slides are now preserved as designed. (3) In `startUnprocessedRows`, uncompleted rows were being re-harvested into `batchQueue` infinitely; added `batchAttemptedRows` to guarantee rows are only attempted once per pass. Single and multiple rows now complete all stages (`voice` -> `timing` -> `prompts` -> `images` -> `animate` -> `done`) and unlock Preview and Export. |
| 4 | Document this in Bug Fix Session #248 | Documented in this file (`bug-fix-session-248.md`), with updates to `system-rules.md` RULE 25 and `quick-batch-table-system-requirements.md` §3.4. |

---

## 1. What was actually wrong

### 1.1 The rigid 3-lane worker loop from Session #211

In Session #211, concurrency was introduced via fixed worker lanes:

```js
const laneCount = Math.max(1, Math.min(BATCH_RUN_CONCURRENCY, queue.length)); // 3
const lane = async function () {
    while (batchRunBusy && queue.length) {
        const row = queue.shift();
        if (!row || row.running) continue;
        row.running = true;
        try {
            if (await runBatchRow(row)) finished += 1;
        } finally {
            row.running = false;
        }
    }
};
await Promise.all(lanes);
```

In this architecture:
- Each lane pulled one row from `queue` and awaited `runBatchRow(row)` through the **entire** pipeline:
  `voice` (TTS) → `timing` (audio decode) → `prompts` (LLM) → `images` (SDXL NDJSON batch) → `animate` (slide assembly) → `done`.
- If the table had 4 or more rows (e.g. 4, 5, or 10 rows), lanes 1, 2, and 3 each took one row.
- Row 4 remained in `queue` and could **not** start until Lane 1, 2, or 3 completely finished all 5 stages.
- Because `images` (generating 10 to 20 SDXL images) is by far the longest step (30–90 seconds per row), Rows 1, 2, and 3 spent most of their time in `images`.
- During that entire time, the early pipeline services (`/api/voiceover` and `/api/image-prompts`) sat completely idle, while Row 4 sat at `ready` with no activity.
- Users seeing Row 4 untouched for minutes assumed it had failed to start or that the system only processed 3 rows at a time, leading them to think they needed to click Generate again once the first three rows finished.

### 1.2 Toolbar button state during `batchRunBusy`

In `updateBatchToolbar()`, the toolbar Generate button was previously assigned:
```js
generate.disabled = batchRunBusy || runnable === 0;
```
Setting `disabled = true` when `batchRunBusy` was true prevented the user from clicking the button to stop a slow run (the button text read `■ Stop generating`, but the element was disabled).

### 1.3 QA defect: batch table cannot work or finish a single row of video

During QA and browser testing of bulk video creation, single batch rows could not complete or reach `done` due to a combination of three root causes:

1. **Truncated mock payloads in `e2e/index.ts` breaking real browser decoders**:
   - `e2e/index.ts` defined `pngSignature` as `[137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]` (12 bytes) and returned it for **both** image generation (`@cf/stabilityai/stable-diffusion-xl-base-1.0`) and voiceover (`@cf/myshell-ai/melotts`).
   - In unit test environments (JSDOM), `Image.prototype.decode` was undefined and was skipped, masking the defect.
   - In a real browser (Chrome/Firefox/Safari/Edge during QA), `typeof img.decode === "function"` is true. Browsers native image decoders rejected the truncated 12-byte PNG with `EncodingError: The image data could not be decoded`.
   - Similarly, returning 12 bytes of PNG for audio broke `AudioContext.decodeAudioData()`.

2. **Discarding slides on decode error in `buildBatchSlides()`**:
   - In `buildBatchSlides()`, the `catch (loadError)` block previously performed `continue;`, skipping any slide whose `img.decode()` failed.
   - When all slides were skipped, `slides.length` remained 0, throwing `Error: None of the row's images could be prepared`.
   - This directly contradicted the design comment ("the slide is kept and the exporter's own draw call is where a broken image would show up").

3. **Infinite re-queue loop in `startUnprocessedRows()`**:
   - When a row failed its quiet attempts in `batchRunStep`, `runBatchRow()` marked the row `stage = "ready"` and `running = false`.
   - In `startUnprocessedRows()`, `batchQueue.length === 0` triggered harvesting of `batchRows.filter(batchRowPending)`.
   - Because the failed row had a script, was not finished, and had `running === false`, `batchRowPending()` evaluated to `true`.
   - The failed row was re-harvested into `batchQueue` and restarted immediately, causing an infinite loop where rows repeatedly failed, retried, and prevented the batch run from ever ending or completing a row.

---

## 2. What changed

### `src/client/app-js.ts`

1. **Queue and in-flight tracking state**:
   - `batchQueue = []`: Holds the queue of pending rows to be processed during the active generate pass.
   - `batchActivePromises = new Set()`: Tracks the promises for all currently executing row pipelines.
   - `batchFinishedCount = 0`: Tracks the number of successfully completed rows.

2. **`startUnprocessedRows(activeRow)`** (and alias `startUnprocessedBatchRows`):
   - Defined as a first-class function and exposed on `window.startUnprocessedRows` and `window.startUnprocessedBatchRows`.
   - Inspects the number of rows currently in early pipeline steps (`voice`, `timing`, `prompts`):
     ```js
     const earlyCount = batchRows.filter(function (r) {
         if (!r || !r.running) return false;
         if (activeRow && String(r.id) === String(activeRow.id)) return false;
         return r.stage !== "images" && r.stage !== "animate" && r.stage !== "done";
     }).length;
     ```
   - Calculates available early-pipeline capacity: `availableSlots = Math.max(0, BATCH_RUN_CONCURRENCY - earlyCount)`.
   - For each available slot, shifts the next unprocessed row from `batchQueue`, sets `row.running = true`, and starts `runBatchRow(targetRow)`.
   - In each running row's `finally` block: clears `row.running = false`, deletes the promise from `batchActivePromises`, and invokes `startUnprocessedRows()` to ensure any remaining queued rows start.

3. **Pipeline step triggers in `runBatchRow()` and `batchRunStep()`**:
   - When a row completes prompt generation and transitions to the next step of processing (stage `images` / image generation), `startUnprocessedRows(row)` is called immediately.
   - Inside `batchRunStep()`, when `attempt === 1` and `stage === "images"`, `startUnprocessedRows(row)` is also called to ensure the transition is registered and subsequent queued rows start.

4. **`generateBatchRows()`**:
   - Initializes `batchQueue` from `batchRows.filter(batchRowPending)`.
   - Clears `batchActivePromises` and starts the initial wave of rows via `startUnprocessedRows()`.
   - Awaits all active pipelines and their staggered successors:
     ```js
     while (batchActivePromises.size > 0) {
         await Promise.all(Array.from(batchActivePromises));
     }
     ```
   - Sets `batchRunBusy = false` and re-renders the table.

5. **`stopBatchRows()` & `removeBatchRow()`**:
   - `stopBatchRows()` sets `batchRunBusy = false`, clears `batchQueue = []`, and aborts all active row controllers.
   - `removeBatchRow(id)` removes the row from `batchQueue` if it was queued.

6. **`updateBatchToolbar()`**:
   - Keeps `generate.disabled = batchRunBusy ? false : (runnable === 0)`.
   - While `batchRunBusy` is active, the button displays `■ Stop generating` and remains clickable so the user can cancel the run.

7. **Row initialization in `createBatchRow()`**:
   - Explicitly sets `running: false`.
   - Sets initial stage to `"ready"` if seeded with a non-empty script, or `"empty"` otherwise.

8. **Slide retention in `buildBatchSlides()`**:
   - In `buildBatchSlides()`, removed `continue;` from `catch (loadError)`.
   - If `img.decode()` rejects or times out, a warning is logged but the slide is kept as intended, preventing the row from failing animation assembly when images are present.

9. **Single-pass tracking via `batchAttemptedRows`**:
   - Introduced `batchAttemptedRows = new Set()` in `app-js.ts`.
   - Populated when a row is started from `batchQueue`.
   - Excludes already-attempted rows from dynamic queue harvesting so uncompleted rows park cleanly at `ready` after their configured quiet attempts rather than re-queueing infinitely.
   - Cleared on `stopBatchRows()` and at the start of each user-initiated `generateBatchRows()` pass.

### `e2e/index.ts`

1. **Valid 1x1 PNG for image models**:
   - Replaced truncated 12-byte `pngSignature` with a fully valid 1x1 PNG (70 bytes with valid IHDR, IDAT, and IEND chunks) that decodes cleanly in all browsers.

2. **Valid audio WAV for voiceover models**:
   - Implemented `mockAudioResponse()` returning a valid 1-second 44.1kHz 16-bit PCM WAV (RIFF/WAVE header, `fmt ` and `data` chunks) when `@cf/myshell-ai/melotts` is requested.
   - Browsers successfully decode audio duration and timing through `AudioContext.decodeAudioData()`.

---

## 3. Verification

### Test suite

- **`tests/session-248.test.mjs`** (6 tests):
  1. *Unprocessed row starts when an earlier row moves to image generation, before it finishes*:
     Configured 4 rows with an image generation delay. Verified that while Row 1 was in stage `images` (and not finished), Row 4 was already running (`row4.running === true`, executing voiceover). All 4 rows finished without any second Generate click.
  2. *5-row batch pipelines smoothly and never exceeds 3 simultaneous early-stage rows*:
     Verified with 5 rows that voiceover concurrency (`state.maxInFlight`) never exceeded `BATCH_RUN_CONCURRENCY = 3`, while all 5 rows completed sequentially through the pipeline.
  3. *`startUnprocessedRows` and `startUnprocessedBatchRows` exist and advance queued rows*:
     Verified function existence on `window` and in script scope.
  4. *Stop generating halts active rows and clears unprocessed queue so pending rows do not start*:
     Verified that clicking Stop terminates in-flight rows and leaves unstarted rows at `stage = "ready"` and `running = false`.
  5. *Single row in batch table runs to done and unlocks both preview and export*:
     Verified that a single row processes through all stages (`voice` -> `timing` -> `prompts` -> `images` -> `animate` -> `done`), retains slides even under decode warnings, and unlocks live Preview and Export buttons.
  6. *Failing row exits pass cleanly and does not re-queue infinitely in the same pass*:
     Verified that when a row encounters an upstream failure, it exhausts its quiet retry attempts, parks cleanly at `ready`, and does not trigger an infinite harvesting loop.

- **Existing test suites**:
  - `tests/quick-batch-table.test.mjs`: All 12 tests passed (including 5-row batch test asserting `state.maxInFlight === 3`).
  - `tests/session-244.test.mjs`: All 10 tests passed.
  - `tests/script-seo.test.mjs`: All 17 tests passed.
  - `tests/seo-plan-resilience.test.mjs`: All 8 tests passed.
  - `tests/render-app-tts.test.mjs`: All 5 tests passed.
  - `tests/seo-walkthrough.test.mjs`: All 15 tests passed.
  - `tests/studio-ui-session-243.test.mjs`: All 3 tests passed.
  - `tests/template-composer.test.mjs`: All 19 tests passed.
  - Overall `npm test`: **95 / 95 tests passed**.

---

## 4. Documentation updates

- **`system-rules.md`**:
  - Added Session #248 revision summary to the top header.
  - Updated RULE 25 under "Three rows at a time + staggered pipeline execution (Session #248)".
- **`quick-batch-table-system-requirements.md`**:
  - Updated §3.4 behavioural requirements #1 to document the pipelined advancement.
