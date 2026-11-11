# Bug Fix Session 331: Quick Batch Table ↔ Timeline Transition Sync & 10-Word Generate Gate (2026-11-11)

## Section 32: Transition Fixes, Generate Button Logic, and Table Layout Sync

### 1. Transition Fix: Timeline Editor → Table Layout (Preview & Export Sync)
- **Issue:** The Preview button (`▶`) and Export (`⚙`) in the Quick Batch Table Layout previously rendered the original table state instead of the exact video rendered inside the Timeline Editor.
- **Fix Applied (`src/client/app-js.ts`):**
  - Modified `openBatchPreview(id)` and `exportBatchRow(id)` to explicitly reconcile `row.projectDetail` and `row.slideItems` from the timeline state (`row.timeline.sceneItems`) when `row.timelineEdited` is true.
  - Added logic:
    ```typescript
    if (row.timelineEdited) {
        applyTimelineEditToBatchRow(row);
        if (row.timeline && Array.isArray(row.timeline.sceneItems)) {
            row.projectDetail = row.projectDetail || {};
            row.projectDetail.scenes = row.timeline.sceneItems;
            row.slideItems = row.timeline.sceneItems;
        }
    }
    ```
  - This ensures `paintTimelineVisualElements` and `resolveBatchRowTimelineElements` use the updated timeline elements for both preview canvas painting and MP4 encoding.

### 2. Generate Button Fix: Word Count Threshold & Error Message
- **Issue:** The Generate button processed rows regardless of script length and did not handle the minimum-word requirement.
- **Current rule:** A scripted table row needs **at least 10 words** to be eligible for generation.
- **Fix Applied (`src/client/app-js.ts`):**
  - Added `const WORD_COUNT_MIN = 10;`.
  - Added helper `batchRowWordCount(row)` to count words in `row.script`.
  - Added helper `batchRowHasMinWords(row, min = WORD_COUNT_MIN)`.
  - Updated `batchRowReadyForGeneration(row)` to return `false` if `batchRowWordCount(row) < WORD_COUNT_MIN`.
  - Updated `generateBatchRows()`:
    - Detects scripted rows with fewer than 10 words.
    - Shows an error message with each affected row ID and word count, asking for at least 10 words.
    - Skips generating insufficient rows while allowing eligible rows to proceed.

### 3. Preservation of Timeline Edits (Audio/Voiceover vs Scenes/Graphics)
- **Issue:** Regenerating a row with existing timeline edits would trigger a full pipeline run, including Pixabay image search, overwriting preserved scenes/graphics.
- **Fix Applied (`src/client/app-js.ts`):**
  - Updated the `batchRunPipelineStage` call for `"prompts"` (Pixabay search stage):
    - Added check: `if (row.timelineEdited && batchRowTimelinePendingRegen(row))`.
    - If true, **skips** the Pixabay search and image generation, preserving `row.timeline.sceneItems` and `row.projectDetail.scenes`.
    - Returns existing prompts/scenes and proceeds only to **Audio/Voiceover** regeneration (`batchRunVoiceStep` and `timing` stage).
  - This ensures audio/voiceover changes are applied while scenes and graphics from the timeline editor remain intact.

### 4. Documentation Target
- Added **Section 32** to `bug-fix-session-331.md` detailing the specific code changes, transition sync fixes, 10-word gate implementation, and preservation logic.

## Section 33: Generate Button Reachability and Updated Minimum
- The table toolbar now leaves Generate enabled when a scripted row is below the 10-word minimum. This allows the click handler to show the validation message instead of leaving the button apparently inactive.
- Scripts with fewer than 10 words are excluded from generation; rows with at least 10 words remain eligible.
- The toolbar change is covered by a regression test in `tests/session-331-fixes.test.mjs`.
- **Source of truth:** the current implementation is `WORD_COUNT_MIN = 10` and the row readiness / toolbar / generation checks in `src/client/app-js.ts`.
