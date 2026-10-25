# Bug Fix Session #248 — 2026-10-26

Pipelined queue advancement for the Quick batch table (`#view-table`).

| # | Request (user's words) | Result |
| --- | --- | --- |
| 1 | I don't like the flow for generate button in the quick batch table layout... Bec when i input Scripts in more than one rows then click generate there is a rule that 3 rows can process simultaneously but if i have 4 or more than three rows they didn't start processing until i finished the first three i need to start the generate button again.... | Fixed: replaced the rigid 3-lane worker loop with staggered pipelined queue advancement (`startUnprocessedRows()`). Up to 3 rows start simultaneously in early stages, and the 4th and subsequent rows start as soon as earlier rows advance in the pipeline. All rows process to completion without requiring a second click of Generate. |
| 2 | Let the other rows start when the first simultaneously processed rows move in the pipeline steps.. to do this you may add a function to start unprocessed rows when a row move to next step of processing ( ex. image generation ).. | Added `startUnprocessedRows(activeRow)` (and alias `startUnprocessedBatchRows`). When an active row moves to the next step of processing (stage `images` / image generation), its early-pipeline slot is vacated and `startUnprocessedRows()` immediately pulls and starts the next unprocessed row from `batchQueue`. |
| 3 | Document this in Bug Fix Session #248 | Documented in this file (`bug-fix-session-248.md`), with updates to `system-rules.md` RULE 25 and `quick-batch-table-system-requirements.md` §3.4. |

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

---

## 3. Verification

### Test suite

- **`tests/session-248.test.mjs`** (new, 4 tests):
  1. *Unprocessed row starts when an earlier row moves to image generation, before it finishes*:
     Configured 4 rows with an image generation delay. Verified that while Row 1 was in stage `images` (and not finished), Row 4 was already running (`row4.running === true`, executing voiceover). All 4 rows finished without any second Generate click.
  2. *5-row batch pipelines smoothly and never exceeds 3 simultaneous early-stage rows*:
     Verified with 5 rows that voiceover concurrency (`state.maxInFlight`) never exceeded `BATCH_RUN_CONCURRENCY = 3`, while all 5 rows completed sequentially through the pipeline.
  3. *`startUnprocessedRows` and `startUnprocessedBatchRows` exist and advance queued rows*:
     Verified function existence on `window` and in script scope.
  4. *Stop generating halts active rows and clears unprocessed queue so pending rows do not start*:
     Verified that clicking Stop terminates in-flight rows and leaves unstarted rows at `stage = "ready"` and `running = false`.

- **Existing test suites**:
  - `tests/quick-batch-table.test.mjs`: All 12 tests passed (including 5-row batch test asserting `state.maxInFlight === 3`).
  - `tests/session-244.test.mjs`: All 10 tests passed.
  - `tests/script-seo.test.mjs`: All 17 tests passed.
  - `tests/seo-plan-resilience.test.mjs`: All 8 tests passed.
  - `tests/render-app-tts.test.mjs`: All 5 tests passed.
  - `tests/seo-walkthrough.test.mjs`: All 15 tests passed.
  - `tests/studio-ui-session-243.test.mjs`: All 3 tests passed.
  - `tests/template-composer.test.mjs`: All 19 tests passed.
  - Overall `npm test`: **93 / 93 tests passed**.

---

## 4. Documentation updates

- **`system-rules.md`**:
  - Added Session #248 revision summary to the top header.
  - Updated RULE 25 under "Three rows at a time + staggered pipeline execution (Session #248)".
- **`quick-batch-table-system-requirements.md`**:
  - Updated §3.4 behavioural requirements #1 to document the pipelined advancement.
