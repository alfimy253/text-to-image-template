# Bug Fix Session 331: Quick Batch Table ↔ Timeline Transition Sync & 10-Word Generate Gate (2026-11-11)

## System documentation: Quick Batch and Timeline Editor

### Terminology in this file

- **Timeline editor** (also "Timeline Editor") is the Quick Batch row's separate editor page (`?layout=timeline`, `src/client/timeline-editor.ts`). Every rule below that used to say "the editor" now says **timeline editor** so it cannot be confused with anything else on the page.
- **Quick Batch media buttons** are the table's Generate / regenerate actions and the table-side media writes that persist a row's voiceover and images. They are separate from the Preview and Export buttons, which only read already-saved media.
- **Template composer** / **scene control UI** is a different editor surface inside the studio page (`src/client/template-composer-js.ts`, `src/client/template-scene-editor.ts`). It is always named explicitly; it is never called "the editor" in these rules.
- The media lock is **per row (per project)**: it applies to the one row whose project is open in a timeline editor, not to every row in the table. See the media-lock scope section at the end of this file.

### Important operating limitations

> Save and close standalone or older-version timeline editor tabs before using Edit: they cannot safely hand over unsaved memory. A click cannot be durably counted if browser storage or locking is unavailable. Real-browser crash and suspension behavior has not yet been tested.

Use the managed **Edit** button for coordinated editing. The coordination applies only to cooperating tabs on the same origin and in the same browser profile; it is not a server backup or cross-device synchronization. Do not clear browser storage or cookies while relying on these local projects. Saved content is shared through browser storage; unsaved in-memory edits are not automatically shared and cannot be recovered after a crash.

### Storage and ownership map

| Location / key | Purpose | Recovery and limits |
| --- | --- | --- |
| localStorage `ytvs.timeline-editor.v1.<projectId>` | Authoritative saved timeline: scenes, tracks, subtitles, project details, settings and media references. | New managed timeline editors load this saved project after gaining ownership. Invalid existing data is not intentionally replaced; browser clearing, quota and eviction still apply. |
| Cookies `ytvs_timeline_editor_<safeProjectId>_1` through `_8` | Existing multipart mirror of timeline/project details, including scenes, tracks and related metadata when they fit. | Kept separate from the counter. Parts carry version, identity, sequence, timestamp and digest. Overflow compaction can remove detail; a full backup may be unavailable. New lossy/long IDs use disambiguated names; legacy truncated names are read for migration and can already contain collisions. |
| localStorage `ytvs.pipeline-management.v1.<pageId>` and cookies `ytvs_pipeline_management_<pageId>_1` through `_4` | Quick Batch page-wide row state and a compact cookie mirror, including row/project-detail summaries. | The cookie mirror is size-limited and may omit rows or details; it is not the authoritative full timeline. |
| IndexedDB `ytvs-timeline-editor-assets-v1`, `projects` store | Media blobs and their metadata, keyed by project. | Local to the browser profile; the timeline cookies and localStorage contain references, not blob bytes. Media handoff and hydration are asynchronous and can fail. |
| localStorage `ytvs.transition-project.v1.<handoffKey>` and cookie `ytvs_transition_project_<handoffKey>` | Short-lived handoff identity and settings used to open a timeline editor. | Not another authoritative full project or media backup. |
| Cookie `ytvs_timeline_edit_counter_<encodedProjectId>` and localStorage `ytvs.timeline-edit-session.v1.<projectId>` | Separate per-project click counter and session ledger (`count`, requested token/count, owner token/count and revocation state). | Counter reservation uses a Web Lock and verifies the cookie write. Cookie and localStorage writes are not one transaction; unavailable/cleared storage or locking can prevent durable counting or reset the high-water mark. |

### Managed Edit lifecycle

1. Quick Batch identifies the row's existing project or derives its project ID, validates or initializes the main project, opens a popup under the click gesture and reserves a counter number under `ytvs-edit-counter:<projectId>`. Blocked popups and other handled unsuccessful attempts request a count without requesting takeover; they leave an existing owner in control. Failures to record a count are reported when reached.
2. The popup navigates with its session token and count. Once ready it publishes its request while holding a presence lock, then waits for the exclusive `ytvs-edit-owner:<projectId>` Web Lock. The owner observes a newer request through storage/focus/visibility events. Only the latest requested session can be granted ownership; a higher count belonging to a blocked popup does not itself displace the active timeline editor.
3. The existing owner freezes editing, finishes tracked media work, flushes dirty timeline changes and attempts table handback, clears its owner record, then releases the owner lock. The new owner loads the saved state. An open template composer delays this handoff until it is finished or closed. The older timeline editor displays the top-section read-only warning and its guarded saves and media writes are rejected.
4. If the owner cannot save or drain media, it retains ownership and warns; the new timeline editor waits. A suspended owner may also leave the new tab waiting. If a lock is released without clearing the owner record, the next timeline editor warns and asks whether to open the last saved state: confirmation cannot restore unsaved memory. Removing a row revokes the matching session.

### Implementation and verification pointers

- `src/client/app-js.ts`: row identity, Edit popup/counter reservation, Quick Batch reconciliation and project cleanup.
- `src/client/timeline-editor.ts`: project and multipart cookie persistence, session ledger and Web Locks, autosave and guarded media writes.
- `src/client/pipeline-management-store.ts`: page-wide Quick Batch localStorage and compact cookie mirror.
- `src/client/markup.ts` and `src/client/styles.ts`: top-section timeline editor warning; `src/client/template-composer-js.ts`: composer close notification for a waiting handoff.
- `tests/timeline-tab-authority.test.mjs` and `tests/timeline-single-project.test.mjs`: simulated storage, locks, handoff and recovery coverage. These jsdom tests do not establish real-browser crash, suspension, playback or multi-device behavior. See the verification summary at the end for results and known legacy test failures.

## Project-detail cookie and latest-timeline-editor investigation (2026-11-12)

The user's correction is right: the existing timeline cookies are **not merely a counter**. `buildTimelineCookieSnapshot()` in `src/client/timeline-editor.ts` clones the full saved timeline and composes its slides. Subject to the existing overflow compaction, it includes `projectDetail` (identity, title/topic, style/effects, frame and counts plus scene/slide/element arrays), timeline scenes and tracks, item timing, fit/trims, visual and audio metadata, subtitle cues, selection/playhead and update/row identity metadata. Blob bytes remain in the IndexedDB `projects` store. The data is JSON split over the existing `ytvs_timeline_editor_<safe-id>_1` through `_8` cookies with per-part project, count, index, timestamp, and digest. A small metadata-only transition cookie is separate. The four `ytvs_pipeline_management_<page>_*` cookies also contain a compact page-wide table mirror, including project details and row summaries; they are a different store.

Overflow behavior has **not** been repurposed for the counter: the timeline mirror still tries the complete project first, then removes duplicate arrays/caches and may reduce subtitles, text and scenes if necessary. If it still does not fit in eight parts, the local full project remains authoritative and the timeline editor reports that its cookie backup is unavailable. Pipeline cookies have their own four-part compaction and may omit whole rows. Browser cookies remain subject to eviction, domain limits and header size; legacy truncated project-cookie identifiers can collide. Current writes disambiguate long or lossy identifiers and read legacy snapshots for migration. This follow-up does not claim cookie-only recovery is complete after compaction, and it does not put binary media in cookies.

**Latest-tab flow:** each Edit click that reaches a usable storage/locking environment reserves an increasing per-project count in the independent `ytvs_timeline_edit_counter_<projectId>` cookie and a matching `ytvs.timeline-edit-session.v1.<projectId>` localStorage ledger. The latter is a high-water mark and request/owner record, not a replacement for the full project key or its detail cookies. A blocked pop-up is counted but does not request ownership. Counter allocation is serialized by a project-specific Web Lock. A successful popup waits on a separate exclusive project timeline-editor Web Lock; the current timeline editor freezes input, finishes tracked uploads, flushes its pending 180 ms autosave and hands back the full project before releasing its lock. Only the latest requested count can become owner. Older tabs get a persistent top-section read-only warning and are barred from project save, handback, project-cookie writes, and guarded timeline-editor-originated media writes. A removed row revokes its session. If saving or a media operation fails, the new tab waits and the old tab retains control; a template composer left open also delays handoff until it is closed so its uncommitted work is not silently discarded; if an ownership record survives without a lock (for example a crash or browser close), recovery asks before opening the last saved state.

Web Locks are required for this managed Edit flow; if unavailable or the counter cookie cannot be written, opening fails closed. The existing project-detail cookies are not replaced by the counter cookie. Cookie clearing, localStorage clearing, browser eviction or a crash can still remove unsaved work or reset a counter when both records are lost. Current direct timeline routes obtain the same project owner lock without counting an Edit click; if the lock cannot be obtained they are read-only. Tabs running older application code do not participate in the lock protocol: save and close older-version timeline editor tabs before using the managed Edit flow. Some activation attempts can still be unrecorded when Web Locks, cookies or localStorage are unavailable or an exception happens before allocation; the browser cannot guarantee a durable counter while its storage is blocked. The UI reports counter-write failure when reached. Coordination only covers cooperating same-origin tabs in the same browser profile; it is not cross-device synchronization. Real-browser lock, suspension and crash behavior has not been verified by the jsdom mocks.

## System-flow and overflow investigation — single main project follow-up (2026-11-12)

Historical investigation: the later rules and verification at the bottom supersede any conflicting details in this section.

This investigation and the follow-up at the end supersede older Section 32 examples that assign compact `sceneItems` into structured project details. It concerns the browser implementation, not a server-side project database.

1. **Identity and row state.** Quick Batch retains a page-wide row snapshot via `pipeline-management-store.ts`. A row's existing `timelineKey`, timeline page id, or project-detail target is preferred; otherwise its project id is derived from the table page and row id. The complete project lives at `ytvs.timeline-editor.v1.<projectId>` in localStorage. Row timeline/slide/project-detail data are derived or compatibility summaries, not a second full timeline editor project.
2. **Edit handoff and timeline editor boot.** Edit syncs row inputs and reconciles. On first use it writes the complete project before opening the timeline; subsequent edits read the same main key. A short random transition key and cookie carry identity/settings, not another full `timelineState`. The timeline editor reads the main project first, falling back to a valid per-project cookie only when localStorage has no project. Boot normalizes in memory, but does not write an existing project merely because a tab opened. New projects and cookie recoveries may be saved at boot. A corrupt stored project or incomplete cookie-only backup is not deliberately replaced.
3. **Save and handback.** Editor changes are debounced (180 ms), saved as the full project, mirrored into cookies, and summarized for the originating table (publication is throttled). The save path checks the last-read raw value before writing; a changed project is reported instead of being knowingly overwritten, and Back does not publish/close after an unsaved conflict. Page lifecycle handlers flush pending changes. Table reconciliation and preview can read the complete project and use the summary as a fallback.
4. **Media.** Blobs are stored separately in IndexedDB by project id; localStorage and cookies hold references and metadata, not media bytes. Row-to-timeline-editor handoff is asynchronous. The timeline editor retries hydration while pending; repeated Edit handoffs fill missing asset ids without replacing existing timeline-editor-owned ids or voiceover. A read/merge/write now runs in a single IndexedDB readwrite transaction. Missing assets, failed IndexedDB writes, object URL lifetimes, browser decoding and seek timing can still affect playback.
5. **Generation and validation.** The Generate handler checks whitespace-separated word count against 10, shows the actual count for short rows, and skips those rows. For a regenerable edited row, the initial reset, scene search, image generation and slide rebuild no longer discard its composition; voiceover is regenerated while the saved project and visuals remain. A failed regeneration restores the previous row voice data. The generation watermark prevents automatic repeated regeneration until another edit.
6. **Preview, export, and cleanup.** Edited table preview uses the timeline editor's shared frame painter with the saved project's scenes, tracks, effects, visual elements, templates and subtitles when available. The table MP4 export remains a separate rendering/audio path. Row cleanup uses page identity when finding timeline/transition artifacts, including cross-page blank-row cleanup, to avoid deleting another table's same-numbered row.

### Existing cookie format and capacity

- Per-project timeline cookies already used numeric suffixes `_1` through `_8`, each encoded value capped around 3,800 characters. The encoder tries 1–8 chunks and the metadata includes version, safe project id, part count and index, timestamp, digest, and data. Numeric suffixes are retained for compatibility rather than introducing a redundant `part1` format.
- Both table and timeline editor readers validate project identity, bounded count, ordering, common timestamp and digest. Writes are read back and verified; an oversized or unverified backup is cleared rather than left as a misleading older/partial mirror. Full localStorage remains authoritative even if a compact cookie has a newer timestamp.
- If the full cookie snapshot is too large, the existing fallback progressively removes duplicate detail, then may remove subtitles, truncate text, or omit scene data. New reduced snapshots are marked and their recovery is warned about; legacy reduced cookies have no such marker. If even the reduced form exceeds eight parts, there is no cookie backup and the timeline editor warns, although a successful localStorage save remains intact. Incomplete/damaged backups are not silently promoted when no full local project exists.
- These are session cookies subject to browser per-domain counts, eviction, and request-header limits; eight parts per project do not guarantee capacity for unlimited projects. The separate page-wide pipeline-management mirror uses four cookies and its own compaction/row-dropping rules. Neither cookie system can hold IndexedDB media blobs.
- Legacy safe cookie ids truncate to 64 characters, so existing long project ids can collide in old cookie names. The later follow-up below disambiguates new writes and preserves compatible legacy reads. Legacy normalization also has limits (including a 100-scene cap and migration/clamping of some track data); it is not a lossless serializer for arbitrary future project structures.

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

## Preview parity follow-up
- The edited-row preview and the Timeline Editor preview/export-frame painter now use the same canvas painter for background fit/filter, scene effects, ordered visual tracks, template-baked elements, placeholders, and subtitles. The timeline editor's selection outlines remain timeline-editor-only.
- The table preview takes the latest applicable saved full timeline snapshot when available, including its subtitles and visual tracks; it hydrates browser media separately and retains a compact-summary fallback if the full snapshot is unavailable. Publication timestamps now identify the saved timeline snapshot rather than a later publish time.
- Reconciliation no longer replaces structured `projectDetail.scenes` and `slideItems` with compact `sceneItems`. An explicitly empty media track remains empty, allowing visual-only previews of finished edited rows.
- This follow-up addresses **preview** parity. Quick Batch MP4 export still uses its separate encoding/painting pipeline; identical exported frames are not guaranteed by this change. Asset loading and browser media seeking can also temporarily show a placeholder or an earlier video frame while data loads.
- Regression coverage: `tests/timeline-preview-parity.test.mjs` and the timeline handoff tests in `tests/timeline-quick-batch-sync.test.mjs`.

## Single-project implementation request and fix (2026-11-12)

**Request:** Implement one authoritative full timeline project per Quick Batch row: first Edit creates it, subsequent Edits reopen its latest saved state rather than reconstructing it from row summaries. Investigate existing cookie behavior, support up to eight parts safely, and document the system/overflow investigation above and the request/fix here after coding.

**Implemented:** `src/client/app-js.ts` now establishes or reuses the main project and keeps the transition payload as an identity/settings envelope; it rejects unreadable project/cookie data and reports failed main writes. It prefers full projects for timeline editor handoff and preview, scopes cleanup by page, preserves edited compositions through voiceover regeneration, fixes the escaped word-count regex in the embedded JavaScript, and keeps the short-script warning from being overwritten. `src/client/timeline-editor.ts` preserves explicit empty lanes/subtitles, avoids saving an existing project on boot, detects common stale-tab saves, blocks invalid-project writes, checks cookie integrity/overflow, and merges media in one IndexedDB transaction. The previously implemented shared preview painter remains in place.

**Verification:** `tests/timeline-single-project.test.mjs` covers first/repeated Edit, stale tabs, empty content, local vs newer cookie, eight parts, damaged/oversized backup, page-scoped cleanup, 10-word feedback, voice-only regeneration, invalid storage, non-destructive media handoff, quota failure, and direct timeline editor recovery. Targeted timeline editor/export tests passed 6/6; preview, Session 331 and subtitle suites passed 20/20. The existing full `timeline-quick-batch-sync` suite remains 7/11: tests 1, 2, 4 and 6 also failed on the archived HEAD baseline from the earlier investigation. The full timeline editor suite previously exhausted the Node heap; targeted tests were used. Wrangler dry-run succeeded. `tsc --noEmit` still reports errors in unchanged `src/index.ts`; a clean baseline type-check has not been established.

**Remaining limitations:** The earlier raw localStorage read/compare/write guard is not itself atomic. Managed Edit sessions now use the exclusive Web Lock protocol described above; unmanaged or older-code tabs do not have that guarantee. A reduced or legacy cookie cannot guarantee complete recovery, and browser eviction/storage quotas may remove data. Initial media handoff is asynchronous; the retry window is bounded and no real-browser IndexedDB concurrency or playback verification was performed. Timeline normalization/migration still changes some legacy content. Quick Batch MP4 export still has a separate renderer and audio path; exact timeline editor/table export pixel, timing and audio parity is not established by these jsdom/canvas-spy tests. No server backup or multi-device synchronization is introduced.

## Latest-tab counter, autosave handoff and warning fix (2026-11-12)

**Request:** Investigate the cookies used for project details, then implement the per-row Edit-click counter cookie, automatic save/handoff, latest-tab control, and warnings for older tabs without losing the existing project-detail cookie data.

**Changes:** `app-js.ts` opens a popup under the click gesture and reserves a session before navigation; `timeline-editor.ts` keeps the counter cookie separate from existing eight-part timeline snapshots and uses Web Locks, an owner ledger, autosave/media draining and stale-write checks. The warning is rendered near the timeline editor's top section in `markup.ts` and `styles.ts`. A blocked popup counts as a click without displacing the current owner. Session revocation prevents a removed row's timeline editor from recreating the project. Existing standalone/legacy timeline editor tabs cannot write once a managed session record exists. Interrupted owner recovery requires confirmation; this does not recreate unsaved edits.

**Verification:** `tests/timeline-tab-authority.test.mjs` passed 8/8 (open composer wait, handoff before debounce, full project-detail cookie contents, stale project/media writes, blocked popup, failed autosave, simultaneous counters, row removal, missing Web Locks and abandoned-owner warning). `tests/timeline-single-project.test.mjs` passed 11/11; preview/Session 331/subtitle suites passed 20/20. The existing timeline Quick Batch sync suite passed 7/11; its four failures were also observed on archived HEAD during the earlier investigation. Wrangler dry-run succeeded. Tests use jsdom and a mocked lock manager/IndexedDB, not real concurrent browser processes.


## Latest debug fixes and operating rules (2026-11-12)

These rules describe the current code and supersede earlier session notes where they differ.

1. **Count and handoff.** Each handled Edit activation reserves a number in the separate counter cookie and localStorage ledger before project validation. A blocked or invalid attempt is counted when storage and locks work but does not take ownership. A popup first becomes a candidate; only after its timeline editor code starts and holds its presence lock does it request takeover. Failed navigation or a popup that closes or does not become ready within 60 seconds cancels the candidate. The current owner retains control when a waiting request is cancelled or found absent during handoff. The latest valid request, not a blocked popup, can become owner.
2. **Save before ownership transfer.** The current timeline editor freezes input, drains pending media writes, retries unresolved failed media using the original in-memory blobs, saves dirty timeline state, and releases its project lock. An open template composer delays takeover. A timeline editor tab that has lost authority is read-only. A revoked/deleted project is rejected when a queued timeline editor attempts to acquire it. Recovery after an unclean owner exit asks before opening the last saved state; it cannot restore unsaved memory.
3. **Quick Batch media is locked while the timeline editor is open — and only for the row (project) being edited in that timeline editor.** The lock is scoped to one project id, not to the whole table. For each row the scope is the id resolved by `batchTimelinePageIdForRow(row) || batchRowMediaPageId(row)` — the row's `timelineKey`, timeline page id or project-detail target, otherwise the derived `timeline-<pageId>-row-<rowId>` id. `batchRowMediaLocked(row)` checks only that row's id against (a) the per-tab `ytvs-edit-open:<projectId>:<token>` open-view locks held by every open timeline editor view, including a stale read-only one, and (b) that project's `ytvs.timeline-edit-session.v1.<projectId>` ledger, which keeps the row locked while it records an `owner`, an unexpired `candidate` (60 s) or `requestActive` (a storage read failure also fails closed for that row). Generation/regeneration and table-side media writes for that row acquire the same per-project `ytvs-edit-owner:<projectId>` lock and re-check the open-view locks, so they fail closed while any current-version timeline editor tab for that project is open. Rows that are not open in a timeline editor keep their media buttons: Generate still queues them, `persistBatchRowMedia()` still writes their IndexedDB assets, and only the locked rows are skipped and named in the "Close the timeline editor before changing Quick Batch media for row(s) …" message. The table toolbar note ("Media locked while a timeline editor is open") is only a table-wide hint that at least one row is locked; it does not lock the other rows. If Quick Batch generation already holds the lock, a timeline editor opened for that row waits until the operation and its media persistence finish. Quick Batch can generate that row's media again after all timeline editor tabs for that project are closed and ownership is released. An interrupted owner may still require recovery before media changes are allowed. Explicit row removal remains destructive and revokes the associated timeline editor session.
4. **Direct timeline editor routes.** Current direct timeline routes acquire the same owner lock and use the same save/handoff rules without incrementing the Edit-click counter. If they cannot obtain safe control or browser locks are unavailable, they open read-only. They do not silently purge an independent project merely because there is no matching scripted Quick Batch row.
5. **Project cookies and media.** The project-detail cookie data and its existing multipart format remain separate from the counter cookie. Short safe identifiers keep their old names; long or lossy identifiers receive disambiguated names. Readers can recover valid legacy snapshots, and cleanup avoids deleting a verified foreign legacy snapshot. Incomplete/corrupt newer parts are not silently replaced by an older legacy backup. Cookie capacity and eviction still apply, and a reduced backup may omit details. Missing referenced media is reported with a retry button; retry does not recreate a blob that is no longer in IndexedDB.
6. **Safety limits.** Save and close older-version timeline editor tabs before using the new flow; they cannot participate in its locks. Storage/lock failures can prevent counting and fail closed. Clearing browser data can remove projects, media, counters or recovery evidence. The protocol covers cooperating tabs in one browser profile, not other devices or older code. jsdom lock and IndexedDB mocks do not prove behavior under real browser crashes, suspension or process scheduling.

**Verification:** The timeline editor suite passed 37/37 when split into five test processes to avoid Node heap exhaustion. The updated Quick Batch sync suite passed 11/11; some earlier failures were stale test assumptions about minimum word count, asynchronous handoff and preserving the edited composition. Authority and single-project suites passed 19/19. The new recovery and edge-case suites passed 12/12 (popup failure/readiness and candidate expiry, failed media retry, revoked queued timeline editor, Quick Batch media lock including stale open tabs, direct route, long and legacy cookie IDs, waiting-request cancellation and missing-media retry). Preview, Session 331 and subtitle suites passed 20/20. Wrangler dry-run and `git diff --check` passed. `tsc --noEmit` still reports pre-existing errors in unchanged `src/index.ts`. Concurrent browser behavior is not yet verified in a real browser.


## Media-lock scope and "editor" wording clarification (2026-11-17)

**Question investigated:** rule 3 of the latest operating rules read "Quick Batch media is locked while the editor is open", which can be misread as a table-wide lock. Does the code lock every Quick Batch row, or only the row/video whose project is open in the timeline editor?

**Finding — the lock is per row (per project).** A Quick Batch row's media is locked only while *that row's* project is open in a timeline editor. Other rows keep their Generate/media buttons and their asset writes:

- `src/client/app-js.ts` — `refreshBatchOpenEditorLocks()` reads `navigator.locks.query()` and keeps the `ytvs-edit-open:` lock names; `batchRowMediaLocked(row)` then matches those names against `ytvs-edit-open:<that row's project id>:` only. The same row's `ytvs.timeline-edit-session.v1.<projectId>` ledger keeps it locked while it records an `owner`, an unexpired `candidate` (60 s) or `requestActive`; a storage read failure fails closed for that row only.
- `batchRowReadyForGeneration(row)` returns false for a locked row, so `generateBatchRows()` drops it from `targets` while still queueing the other rows. When nothing is runnable, the modal lists only the locked rows ("Close the timeline editor before changing Quick Batch media for row(s): …").
- `runBatchRow(row)` resolves that row's project id and calls `window.__TIMELINE_EDITOR__.runWithTableMediaLock(id, …)`; the wrapper in `src/client/timeline-editor.ts` requests `ytvs-edit-owner:<id>` with `ifAvailable`, re-checks the `ytvs-edit-open:<id>:` view locks, then reads the per-project session ledger. `api.storeProjectAssets` routes table-side media writes through the same lock, and `persistBatchRowMedia()` uses that API — so the edited row's asset writes are refused while the timeline editor holds the project, and other rows' writes are unaffected.
- The timeline editor's owner lock uses the same `ytvs-edit-owner:<projectId>` name, so table and timeline editor serialize on one row/project and never on the whole table.
- The table toolbar note ("Media locked while a timeline editor is open") is produced by `batchRows.some(batchRowMediaLocked)` and is a table-wide hint that at least one row is locked; it is not a lock on the other rows.
- Regression coverage: `tests/timeline-tab-recovery.test.mjs` — "Quick Batch cannot change project media while an editor owns it" and "Quick Batch media remains blocked while a stale editor tab is still open" both assert the per-project lock, that the locked row's `batchRowReadyForGeneration()` is false, and that writes succeed again once that project's owner lock and view locks are released.

**Documentation change (this session):** rule 3 now states the row/project scope explicitly, that the toolbar note is only a hint, and that rows not open in a timeline editor keep their media buttons. Every clause in this file that meant the Quick Batch timeline editor now says **timeline editor** instead of "editor", and the terminology block at the top records that convention. No source code changed: the implementation already matched the clarified rule.
