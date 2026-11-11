# Bug Fix Session 331: Quick Batch Table ↔ Timeline Transition Sync & 50-Word Generate Gate (2026-11-11)

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
- **Issue:** The Generate button processed rows regardless of script length and did not handle the 50-word minimum requirement.
- **Fix Applied (`src/client/app-js.ts`):**
  - Added `const WORD_COUNT_MIN = 50;`.
  - Added helper `batchRowWordCount(row)` to count words in `row.script`.
  - Added helper `batchRowHasMinWords(row, min = WORD_COUNT_MIN)`.
  - Updated `batchRowReadyForGeneration(row)` to return `false` if `batchRowWordCount(row) < WORD_COUNT_MIN`.
  - Updated `generateBatchRows()`:
    - Added check for `insufficientWords` rows (script exists but < 50 words).
    - Shows error modal: `"Generate skipped: Row(s) [ID] script is less than 50 words (currently [X] words). Please expand the script to at least 50 words."`
    - Skips generating insufficient rows while allowing valid rows (>= 50 words) to proceed.

### 3. Preservation of Timeline Edits (Audio/Voiceover vs Scenes/Graphics)
- **Issue:** Regenerating a row with existing timeline edits would trigger a full pipeline run, including Pixabay image search, overwriting preserved scenes/graphics.
- **Fix Applied (`src/client/app-js.ts`):**
  - Updated the `batchRunPipelineStage` call for `"prompts"` (Pixabay search stage):
    - Added check: `if (row.timelineEdited && batchRowTimelinePendingRegen(row))`.
    - If true, **skips** the Pixabay search and image generation, preserving `row.timeline.sceneItems` and `row.projectDetail.scenes`.
    - Returns existing prompts/scenes and proceeds only to **Audio/Voiceover** regeneration (`batchRunVoiceStep` and `timing` stage).
  - This ensures audio/voiceover changes are applied while scenes and graphics from the timeline editor remain intact.

### 4. Documentation Target
- Added **Section 32** to `bug-fix-session-331.md` detailing the specific code changes, transition sync fixes, 50-word gate implementation, and preservation logic.

---
## Sources of Truth
1. **Code:** `/home/user/text-to-image-template/src/client/app-js.ts` (Main logic), `/home/user/text-to-image-template/src/client/timeline-editor.ts` (Timeline logic).
2. **Markdown:** `bug-fix-session-331.md` (Sections 0–31 updated; Section 32 added).
