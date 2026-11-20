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


## Auth caps, 30-day session TTL, 4 MB payment screenshot cap, and 30 MB GIF caps (2026-11-18)

**Changes implemented:**

1. **Payment / phone screenshot upload capped at 4 MiB (4 MB) only** (`src/modules/payments.ts`, `src/client/payment-upload-js.ts`):
   - Lowered `MAX_PAYMENT_IMAGE_BYTES` (Worker) and `MAX_BYTES` (`/upgrade` client uploader) from `5 * 1024 * 1024` to `4 * 1024 * 1024` (4 MiB).
   - Enforced across multipart `POST /api/payments/upload` (both `file.size` and decoded byte length), JSON/data-URL base64 uploads (both pre-decode character guard and decoded byte length), client file selection/drag-drop, and submit click handler; updated all dropzone and `413` error messages to `4 MB`.
   - Regular still-image uploads (PNG/JPEG/WebP/etc.) in the Editor, timeline editor, and template composer intentionally have **no** 4 MB file-size cap.

2. **Signup username & email capped at 40 characters; total account count remains uncapped** (`src/index.ts`, `src/client/app-js.ts`, `src/modules/user-pages.ts`):
   - Added `AUTH_USERNAME_MAX_CHARS = 40` and `AUTH_EMAIL_MAX_CHARS = 40`.
   - `POST /api/signup` validates usernames with `/^[a-zA-Z0-9_]{3,40}$/` (3–40 letters, numbers, or `_`) and rejects trimmed/lowercased emails over 40 characters (`400`) before checking email syntax (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), bounding KV `email:<address>` keys well inside Cloudflare KV's 512-byte key limit. Total signup account count stays uncapped.
   - Updated `#auth-username` and `#auth-email` in the studio auth modal and `#ia-username` and `#ia-email` on `/account` & `/upgrade` to `maxlength="40"` with matching client-side validation and error messages.

3. **30-day KV TTL on login & signup sessions** (`src/index.ts`):
   - Added `AUTH_SESSION_TTL_SECONDS = 30 * 24 * 3600` (`2,592,000` seconds = 30 days) and passed `{ expirationTtl: AUTH_SESSION_TTL_SECONDS }` on `KV_BINDING.put("session:" + token, ...)` in both `POST /api/signup` and `POST /api/login`, matching `yvs_session` cookie `Max-Age=2592000`.
   - Added `authSessionExpired()` on `authSessionFromRequest()` and `GET /api/session` so pre-existing legacy sessions without a KV TTL whose `createdAt` is older than 30 days are rejected (`401`) and deleted from KV on access.

4. **30 MiB GIF file-size cap and 30 MiB decoded GIF frame memory cap** (`src/client/app-js.ts`, `src/client/timeline-editor.ts`, `src/client/markup.ts`, `src/client/template-composer-js.ts`, `src/client/template-ring-carousel.ts`):
   - **GIF file size (`MAX_GIF_FILE_BYTES = 30 * 1024 * 1024`):** Enforced in Editor accordion uploads (`#va-file-N`), legacy `#file-upload`, `prepareVideo()`, `parseGifBytes()`, `decodeGifFrames()`, timeline editor `addMediaFiles()`, `storeOneAsset()`, `storeProjectAssets()`, and template composer / 3D ring uploads. Files exceeding 30 MiB with a non-GIF extension/MIME have their first 6 bytes checked for `GIF87a`/`GIF89a` so renamed GIFs cannot bypass the 30 MiB limit while regular photos of any size remain completely uncapped and valid sibling uploads in the same batch still load.
   - **Timeline GIF metadata & Quick Batch hydration fix:** `addMediaFiles()` now persists normalized `type: "image/gif"` to IndexedDB even when a `.gif` file reports an empty browser `file.type`, and `src/client/app-js.ts` defines `decodeGifFrames(blob)` (enforcing both 30 MiB caps) so timeline GIFs hydrated into Quick Batch decode properly.
   - **Decoded GIF frame budget (`GIF_FRAME_BUDGET_BYTES = 30 * 1024 * 1024`):** Lowered `buildGifSlideFrames()` budget from 120 MiB to 30 MiB using floor downscaling, per-frame indexed pixel release (`frame.pixels = null`), full delta/disposal composition, and duration-preserving even frame subsampling whenever extreme frame counts would exceed 30 MiB at the spatial readability floor — keeping total retained RGBA frame bytes strictly `<= 30 MiB` while preserving exact `loopMs`. Added per-frame (`64M` px) and cumulative (`256M` px) indexed-pixel guards in `parseGifBytes()` against malformed LZW decompression bombs.
   - Updated on-screen upload notes in the Editor, `#file-upload`, and timeline editor inspector (RULE 18).

5. **Intentionally kept unchanged:** `/api/config/workers`, `/api/render*`, `/api/worker/*`, `putBlobStore`/`getBlobStore`, `workerRunJob`, `apiRenderVideo`, the admin Background Worker Mode card, archived `src/index.ts.original`, and standalone `render-app/`.

6. **Verified accompanying rules (code-checked):**
   - **RULE 8 (MeloTTS voiceover):** Server (`src/modules/voiceover.ts`) owns all text cleaning (`sanitizeVoiceoverText`), 8,000-char slicing (`VOICEOVER_MAX_CHARS`), `<= 400`-char chunking (`splitVoiceoverChunks`), 3-lane synthesis within a 90 s budget, per-chunk 3× `@cf/myshell-ai/melotts` retries, English Deepgram fallbacks (`@cf/deepgram/aura-2-en`, `@cf/deepgram/aura-1`), external fallback (`https://tts-api.netlify.app`), and WAV/MP3 joining. Browser (`src/client/app-js.ts`, `src/client/browser-offload.ts`) sends one full-text `POST /api/voiceover` (165 s timeout); Quick Batch retries a failed voice stage up to 30× at 20 s intervals, and the Editor owns the same 30 x 20 s ladder for its own voice step (`requestEditorVoiceoverWithClientRetries`). Both read `src/modules/retry-policy.ts` (stage `voiceover`).
   - **RULE 11 (Video output & presets):** No codec picker anywhere. Editor accordions encode 30 fps H.264 (`avc1.4d002a`) + AAC (`mp4a.40.2`, 128/160/192 kbps; silent when no audio) at the exact three presets (`854×480` @ 1.2 Mbps, `1280×720` @ 2.5 Mbps, `1280×720` @ 5 Mbps). Quick Batch reuses `generateMP4()` at 30 fps across `[480, 540, 720, 1024] × [1:1, 16:9, 9:16]` frame sizes; timeline editor exports `state.frame` at 30 fps H.264 + 160 kbps AAC (2.5/5 Mbps auto, with a `MediaRecorder` fallback when WebCodecs/`Mp4Muxer` is unavailable); template composer exports silent 30 fps 1080p H.264 @ 6 Mbps.

**Verification:** `tests/session-331-caps-and-ttl.test.mjs` passed 7/7; existing suites `account-rows` (6/6), `public-entry-points` (9/9), `browser-local-render` (3/3), `session-264-editor-render` (10/10), `session-331-fixes` (11/11), `timeline-preview-parity` (2/2), `timeline-quick-batch-sync` (11/11), `timeline-tab-recovery` (6/6), targeted `timeline-editor` upload/export/media checks (6/6), `template-composer` (22/22), `retry-offload-worker` (9/9), and `api-relay` (40/40) all passed (142/142 total). All inline client bundles parsed cleanly, `npx wrangler deploy --dry-run` succeeded, `git diff --check` passed, and `tsc --noEmit` added zero new errors.

---

## Appendix — The whole system in plain English (beginner edition)

> **Who this is for.** Someone who has never built a website. No prior knowledge of servers, HTTP,
> cookies or JavaScript is assumed: every technical word is explained the first time it is used.
> Everything below was checked against the current code (`src/`), not against older notes.
> If you only read two sections, read **A** (what the app is) and **B** (the two halves).

### A. What this app actually is

**YouTube Vibe Studio** is a website that turns a **written script** into a **finished MP4 video**.

It does not film anything. It does not paint pictures with AI. In practice it:

1. lets the visitor type (or have AI write) a **narration script**;
2. has an AI voice **read that script aloud** → an MP3;
3. searches **Pixabay** (a free stock-photo/video site) for **14 matching pictures and clips**;
4. paints those pictures into animated slides with the script as **subtitles**;
5. **builds the MP4 video right inside the visitor's browser** and downloads it.

**The cooking-show analogy.** The visitor's browser is the **kitchen**: chopping, cooking and plating
(decoding images, drawing frames, encoding video) all happen there. The server is the **waiter**: it
takes orders, fetches ingredients from shops (AI text, AI voice, Pixabay), keeps the bill, and hands
things back. If the kitchen closes (tab closed), nothing that was only on the counter survives —
which is exactly why this app stores so much *in the browser*.

### B. The two halves: the page and the Worker

A website normally has a **front end** (what you see) and a **back end** (what answers questions
behind the scenes). Here they are:

| Half | Where it lives | Plain-English job | Analogy |
| --- | --- | --- | --- |
| **The page** (front end) | `src/client/*` — one big HTML page with inline CSS + JavaScript | Buttons, tables, canvas preview, the timeline editor, **the video encoder** | the kitchen |
| **The Worker** (back end) | `src/index.ts` + `src/modules/*` — one Cloudflare Worker | Decides what each URL returns; talks to AI, Pixabay, and the database | the waiter + the pantry |

**"Cloudflare Worker"** = a small program that runs on Cloudflare's computers and answers web
requests. It has no screen; it only returns text, HTML, JSON or image bytes. This project has
exactly **one** Worker file that receives every request, and a long chain of `if` statements picks
the right answer. There is no routing library, no framework, no bundler.

**"API"** = a URL that a program (not a person) calls to get data. Example: `POST /api/voiceover`
means "send a script, get audio back".

**"HTTP request"** = one question asked of the server: a **method** (`GET` = "give me something",
`POST` = "here is data, do something"), a **path** (`/api/script`), optional **headers**
(small labels) and an optional **body** (the data).

**Request → response in this app, in one diagram:**

```text
Visitor's browser                          Cloudflare Worker                    Outside world
-------------------                        -----------------                    ------------
click "Generate"  ──POST /api/script────▶  pick a model, ask for a script  ──▶  Workers AI / OpenRouter
                  ◀──── plain text ──────  validate keywords + length
                  ──POST /api/voiceover──▶  cut text into <=400-char chunks ─▶  MeloTTS (+fallback TTS)
                  ◀──── audio bytes ─────
                  ──POST /api/image-prompts▶ ask the text model for search words
                  ◀──── 14 search terms ──
                  ──GET /api/media/config──▶ here is the Pixabay key + limits
                  ──(browser talks to pixabay.com / cdn.pixabay.com directly)──▶  Pixabay
                  ──POST /api/media/claim─▶  reserve image credits
decode + draw + encode (all local)  ──▶  an .mp4 file appears in Downloads
```

Two things surprise beginners, so they are stated plainly:

- **The server never renders the video.** The browser has APIs called **WebCodecs** (encode video and
  audio) and a small library called **mp4-muxer** (wrap those pieces into an `.mp4` file). No FFmpeg,
  no render farm. If the browser is old, the export simply fails with a message.
- **The heavy media bytes mostly bypass the server.** The page fetches photos/clips from Pixabay
  itself; the Worker only hands out the configuration and keeps the credit count. This keeps the
  server cheap and fast.

### C. The words you will meet (mini-glossary)

| Word | What it means here, in one line |
| --- | --- |
| **Worker** | The single back-end program (`src/index.ts`) that answers every URL. |
| **Route** | One URL pattern the Worker recognises, e.g. `/api/script`. Unknown URLs get `404`. |
| **KV** | Cloudflare's simple key→value database. Used for accounts, sessions, credits, settings, CMS, receipts. |
| **Durable Object** | A tiny stateful helper. Here: one object that meters Pixabay calls so the app does not get rate-limited. |
| **Cookie** | A small text note the site asks the browser to keep and send back on every request. Used for login, the guest flag, and backup copies of projects (they are size-limited: ~4 KB each). |
| **localStorage** | A bigger per-website notebook inside the browser (megabytes). Survives reloads; lost if the visitor clears site data. |
| **IndexedDB** | An actual database inside the browser. Used for **media blobs** (the MP3 and the photos/clips), because cookies/localStorage are far too small for megabytes of video. |
| **Blob** | A chunk of binary data held in memory, e.g. one downloaded MP3. |
| **Object URL** | A temporary `blob:` link that lets an `<img>`/`<video>` play a Blob. |
| **JSON** | Text that represents structured data: `{"script":"...","minutes":2}`. |
| **Web Lock** | A browser feature that lets tabs take turns. `navigator.locks.request("name", …)` means "only one tab at a time may hold `name`". Used to guarantee **one editor per video**. |
| **Debounce / throttle** | "Wait a moment and only act once" / "act at most every N seconds". The timeline autosaves 180 ms after the last keystroke and publishes to the table at most once per 1.2 s. |
| **NDJSON** | One JSON object per line, streamed as it is produced (used by the legacy batch image route). |
| **HMAC ticket** | A signed, short-lived pass that proves a request really came from a trusted Worker (used by the API-rotation pool). |

### D. Where everything lives (file map)

```text
src/index.ts .............. the Worker: every route + accounts + credits + settings (~6,700 lines)
src/page.ts ............... glues the HTML shell together once and caches it
src/prompts.ts ............ the two legacy demo prompts

src/client/
  markup.ts ............... the HTML skeleton (top bar, both views, timeline page, modals)
  styles.ts ............... all CSS, including the seven themes
  app-js.ts ............... THE main browser program (~29,800 lines): editor, Quick Batch table,
                            renderer, GIF decoder, subtitle painter, browser storage
  timeline-editor.ts ...... the separate timeline editor page (?layout=timeline) + locking + autosave
  template-composer-js.ts . "Add video from template" gallery + 15 interactive scenes
  template-scene-editor.ts  the scene/layer/text controls shared by composer and timeline
  template-ring-carousel.ts the 5–7 image 3D ring template
  template-shape-animations.ts 13 animated graphic objects
  progressive-image-pipeline.ts  the browser loop that asks for scene keywords in batches
  pixabay-direct.ts ....... browser-first Pixabay search + download + claim/settle
  browser-offload.ts ...... capability negotiation + timeouts for AI routes
  api-rotation.ts ......... asks the Worker which backup URL should run one AI call
  config-page-js.ts ....... the 7-tab day-rotated settings page
  script-notes-client.ts .. localStorage + cookie note memory (RULE 35)
  pipeline-management-store.ts  per-page Quick Batch state (1 localStorage key + 4 cookies)
  usage-ledger.ts ......... local-only "what I made today" counter (never authorizes anything)
  payment-upload-js.ts .... receipt uploader on /upgrade
  reel-scene-assets.ts .... bundled sample photos
  aerial-background.ts .... Aerial theme backdrop

src/modules/
  script-seo.ts ........... SEO keyword planning + narration writer + validation
  script-notes.ts ......... in-memory note store (0 KV writes) + stale-note detection
  script-notes-api.ts ..... the legacy note routes + hang budgets
  script-event-loop.ts .... small Node-style scheduler for the two-stage script work
  image-prompts.ts ........ legacy server-side planner (browser now plans 14 Pixabay search terms from the script)
  pixabay.ts .............. search, cache, download, byte validation, rate limiting
  image-batch.ts .......... credit reservation, per-scene work, retries, refunds, transport
  image-load.ts ........... adaptive concurrency governor (starts at 3, grows to 6, halves on overload)
  image-queue.ts .......... fair per-group task queue (so one row cannot starve the others)
  voiceover.ts ............ MeloTTS + chunking + fallback TTS proxy
  llm-openrouter.ts ....... instruct-model provider rotation (Cloudflare ⇄ OpenRouter)
  api-relay.ts ............ backup-Worker pool, health, circuit breaker, signed tickets
  cms.ts .................. up to 8 flat public pages, escaped rendering
  payments.ts ............. receipt storage + admin approval → paid_user
  user-pages.ts ........... the /account and /upgrade pages
  theme-shell.ts .......... shared shell for standalone pages + CMS

tests/ .................... 53 jsdom/node test files (~620 checks)   `npm test`
bench/ .................... load/simulation scripts (not part of the app)
e2e/ ...................... local fixtures for workerd integration tests
render-app/ ............... a SEPARATE Node+Playwright script→MP3 helper (never called by the Worker)
wrangler.json ............. bindings: AI, KV_BINDING, PIXABAY_RATE_LIMITER
```

### D-2. Retry mechanics — 30 retries per pipeline step, 20 s apart (2026-11-20)

**Why this section exists.** Every retry number used to be typed into prose (README, session notes,
comments, `/api/capabilities`) and into three different places in the page script. They disagreed.
Since 2026-11-20 there is exactly **one** place a retry limit or backoff is written down:
[`src/modules/retry-policy.ts`](src/modules/retry-policy.ts). Everything else reads it.

> **Code wins.** If any sentence below ever disagrees with `src/modules/retry-policy.ts`, the file
> is right and the sentence is a bug in this document.

#### The rule in one line

**Every pipeline step retries up to 30 times (31 attempts in total), waits 20 seconds before each
retry, and the browser owns the ladder.**

```
attempt 1 ──fail──► wait 20 s ──► attempt 2 ──fail──► wait 20 s ──► … ──► attempt 31 ──fail──► verdict
```

30 retries x 20 s = **600 s (10 minutes) of patience per step**, on top of the time each attempt
itself takes. That is deliberate: the studio would rather wait out a busy fleet than hand the user a
failure they cannot act on.

#### The table (the live numbers)

| Pipeline step | Ladder owner | Retries after the first attempt | Wait before each retry | Stage key in `retry-policy.ts` |
| --- | --- | --- | --- | --- |
| SEO planning — `POST /api/seo-plan`, editor walkthrough | browser | **30** | **20 s** | `seoPlan` |
| Script writing — `POST /api/script`, Editor and Quick Batch | browser | **30** | **20 s** | `scriptWrite` |
| Photos and clips — Pixabay import, **per failed item** | browser | **30** | **20 s** | `media` |
| Voiceover — `POST /api/voiceover`, editor | browser | **30** | **20 s** | `voiceover` |
| Quick Batch — any failed non-media stage (prompts, voice, animate) | browser | **30** | **20 s** | `batchPipeline` |
| Editor image flow — scene plan + missing scenes after a retryable stop | browser | **30** | **20 s** (a server `Retry-After` hint wins, clamped 2 s–120 s) | `imageFlow` |
| Render / export (canvas + WebCodecs) | — | **none** | — | — |

`maxAttempts` is always `maxRetries + 1` (31). The object is injected into the page script
(`APP_JS` embeds `PIPELINE_RETRY_POLICY`) and advertised by `/api/pipeline-capabilities`, so the page,
the API and this document can no longer drift.

#### What the browser exposes (reading the live policy)

Nobody has to guess a number; these are live in devtools:

| Global | Meaning |
| --- | --- |
| `window.PIPELINE_RETRY` (inside the page) | the whole table — `stages.<step>.maxRetries / maxAttempts / backoffMs / owner` |
| `window.__SCRIPT_RETRY_TIMING` | script-writing ladder (`maxRetries: 30`, `backoffMs: 20000`, `owner: "browser"`) |
| `window.__SEO_PLAN_RETRY_TIMING` + `__SEO_PLAN_RETRY_LOG` | SEO planning ladder and its per-attempt log |
| `window.__BATCH_PIPELINE_RETRY_TIMING` + `__BATCH_PIPELINE_RETRY_LOG` | Quick Batch stage ladder |
| `window.__MEDIA_ITEM_RETRY_TIMING` + `__MEDIA_ITEM_RETRY_LOG` | per-item photo/clip ladder |
| `window.__VOICE_RETRY_TIMING` + `__VOICE_RETRY_LOG` | editor voiceover ladder |
| `window.__IMAGE_AUTO_RETRY_TIMING` + `__IMAGE_AUTO_RETRY_LOG` | editor image-flow auto-retry |
| `GET /api/pipeline-capabilities` | `browserScriptRetries`, `seoPlanRetries`, `batchPipelineRetries`, `mediaItemRetries`, `editorVoiceRetries`, `pipelineRetryPolicy` — all from the same file |

The `*_LOG` arrays record every `attempt`, `attempt-failed`, `backoff`, `success`, `verdict` and
`budget-exhausted` event, which is how a support session answers "did it really try thirty times?".

#### The Worker's own (much smaller) ladders

A single HTTP request cannot survive 600 s of sleeping, so the big ladder lives in the browser and
the Worker keeps a **fast inner ladder inside one attempt**. These are not a second pipeline ladder
and they are not the numbers above:

| Inside one request | File | Attempts | Wait |
| --- | --- | --- | --- |
| SEO planner transport | `script-seo.ts` | `SEO_PLAN_TRANSPORT_ATTEMPTS = 2` per model call, up to 3 validation attempts per model, 1 fallback model; one set, including retries and fallback, must fit within a 120 s deadline | 400 ms between transport attempts |
| Script writing | `script-seo.ts` | 1 inference per request when the browser owns the ladder; legacy path 3 planner + 3 writer | none |
| Scene prompts | `image-prompts.ts` | `IMAGE_PROMPT_ATTEMPTS = 3` | exponential 400 ms, inside a total budget |
| Image generation | `image-batch.ts` | `IMAGE_OVERLOAD_ATTEMPTS = 4` on load-shedding, 2 otherwise | exponential 800 ms → 20 s, inside a 45 s budget |
| Voiceover | `voiceover.ts` | `VOICEOVER_CHUNK_ATTEMPTS = 3` per chunk, then fallback models | 400 ms x attempt |
| Relay failover | `api-relay.ts` | `maxAttempts = 3` endpoints | none, 180 s chain budget |

#### What is deliberately NOT retried

* **A verdict.** A 4xx that cannot change (bad topic, missing AI binding, rejected credential, a
  refused script) stops the ladder immediately — 30 retries of a request that is wrong by
  construction would only waste ten minutes. 408, 409, 425, 429 and 5xx are retried.
* **A cancellation.** Deleting the video, Stop, or closing the flow cancels the pending 20 s wait
  and the in-flight request. Nothing is painted as a failure afterwards.
* **A stop with a spent budget.** When the 31st attempt fails, the ladder reports one quiet verdict
  (`budget-exhausted`) instead of a silently spinning UI.

#### What each retry keeps

* **Quick Batch:** only the failed *stage* is reset. Successful earlier stages, delivered media,
  object URLs and recorded filenames stay. No row restart, no duplicate paid batch.
* **Editor media:** only the individual failed photo/clip is requested again; a delivered asset is
  never re-requested or revoked.
* **SEO planning:** each browser attempt requests **one validated keyword set** (one long-tail,
  four distinct short keywords, a title and headings). The Worker stops as soon as it has a
  valid set and returns `sets: [set]`. One set is a complete plan, not a partial result. The Editor
  shows a single card, even if an older relay Worker sends multiple sets. Accept the card with
  **Use this keyword set**, then choose a visual style. The 120 s Worker budget, 150 s browser
  timeout, and 30 browser retries at 20 s intervals are unchanged. Deleting the video cancels planning.

#### Where to change it

One file, two constants:

```ts
export const PIPELINE_RETRY_MAX = 30;          // retries after the first attempt
export const PIPELINE_RETRY_BACKOFF_MS = 20_000; // wait before each retry
```

Change them and the editor, the Quick Batch table, the page globals and `/api/capabilities` all move
together. `.md` files that still quote the old **7 retries / 40 s** rule are historical session
notes, not instructions.

#### Verification

* `tests/pipeline-retry-policy.test.mjs` — asserts the code table is 30 / 20 000, that `APP_JS` is
  built from it, that no step ladder falls back to a hand-written number, and that
  `/api/pipeline-capabilities` agrees.
* `tests/seo-plan-client-retries.test.mjs` — 4 attempts when the plan recovers on the fourth,
  exactly **31** when it never does, a 4xx verdict not retried, a 429 retried.
* `tests/script-writing-client-retries.test.mjs`, `tests/script-retry-owner.test.mjs`,
  `tests/retry-offload-worker.test.mjs`, `tests/final-media-cap-actions.test.mjs`,
  `tests/pixabay-auto-retry.test.mjs` — the same numbers through the UI.
* jsdom suites compress the **wait only** via `window.__PIPELINE_RETRY_SPEED`; the advertised
  `backoffMs` is still 20 000, and a real 20 s request timeout is never shortened.

### E. All the system rules, one line each

The full rules live in `system-rules.md` (very long, very technical). This is the oversimplified
translation. **The code is the source of truth**; if a rule here disagrees with the code, the code wins.

| Rule | What it means if you have never seen this app |
| --- | --- |
| **Governing media rule** | Pictures and clips are **real Pixabay stock**, never AI-drawn. AI is only used for *words* (planning search terms, writing the script) and *speech*. |
| **RULE 1** | One Worker answers everything. The browser does the heavy work (encoding, drawing). The HTML page is built once and reused. |
| **RULE 2** | Accounts are rows in KV. No cap on how many accounts exist. Signup: username 3–40 letters/digits/underscore, password ≥ 6, valid email ≤ 40 characters. Logging in lasts 30 days (both the cookie and the KV session record expire after 30 days). |
| **RULE 3** | The admin/settings page lives at `/{day-of-month}/config/uvxyz`, where the day is computed in **Asia/Taipei**. So on 18 Nov 2026 it is `/18/config/uvxyz`; yesterday's URL is a 404. It has its own password. |
| **RULE 4–5** | An old "render on the server" queue still exists in code but no button uses it. Everything renders in the browser now. |
| **RULE 6** | Pixabay replaces the old AI image generator. Photos must be JPEG/PNG/WebP ≤ 8 MB; clips MP4 ≤ 60 s and ≤ 16 MB; the file's first bytes are checked so an error page can never be saved as "an image". |
| **RULE 7** | The AI script must contain **exactly 1 long-tail keyword said at least once** and **exactly 4 short keywords each said at least twice**. Extra mentions are always fine. One short keyword must appear in the title and one in a heading. |
| **RULE 8** | The voice is MeloTTS. The browser sends the full script in one request (Quick Batch retries a failed stage **30× at 20 s intervals**, and the editor retries its own voice step 30× at 20 s intervals); the Worker cleans the text, cuts it into ≤ 400-character pieces (≤ 8,000 characters total), retries up to 3× per chunk, falls back to Deepgram Aura (English) and an external TTS service if needed, and stitches the audio back together. |
| **RULE 9** | Per video: **25 images, 5 GIFs, 5 MP4s (≤ 60 s each)**. A still picture stays on screen **9 seconds**. **The MP3 decides the video length** — slides repeat until the audio is covered. |
| **RULE 10** | Title and captions are painted per frame at fixed positions (title top-left, captions 4/7 up from the bottom). Up to **10 captions of 40 characters**; the last one stops showing after ~10 s. |
| **RULE 11** | Output is always **30 fps H.264 video + AAC audio**. Only three quality presets: 480p/1.2 Mbps, 720p/2.5 Mbps, 720p/5 Mbps. No codec picker. |
| **RULE 12** | Each GIF upload is capped at **30 MiB** (Editor, timeline editor, and templates; regular photos have no file-size cap) and decoded frame memory is strictly capped at **30 MiB**, so a giant GIF cannot freeze or crash the tab. |
| **RULE 13** | One template gallery (15 interactive scenes). The ring template needs **5–7 uploaded images** before it can export. Layers and rotation (0–360°) are shared controls. |
| **RULE 14** | The Editor's bulk render runs **one video at a time** in the order shown, and cannot be started twice. |
| **RULE 15** | Every KV record has a lifetime: sessions expire in 30 days, credits in 2 days, render jobs in 1 h, blobs in 2 h; accounts/settings are permanent. Script notes are **never** in KV (see RULE 35). |
| **RULE 16** | Build/deploy rules: `wrangler.json` names the entry, bindings and compatibility date; type-check + dry-run before deploy. |
| **RULE 17** | A historical list of spots where old comments disagree with the code. Read it as "trust the code". |
| **RULE 18** | Every tooltip, note, placeholder and alert **is a promise**: the constant behind each one must match (e.g. "25 images" must really be 25). |
| **RULE 19** | Seven skins: default, Aerial (`strata`), Stellar, Night Lab, Warm Paper, Swiss, Neo Brutalist. **One choice for the whole site**, set in settings, applied by the server so nothing flashes. |
| **RULE 20** | Each account gets **10,000 images per day**, unlimited videos/scripts/voiceovers. The counter resets at **midnight Asia/Taipei (UTC+8)**. A failed model call is refunded. |
| **RULE 21** | Three studio addresses: `/free` (anyone, sets a 1-day guest cookie), `/studio` (signed-in), `/paid` (paid only). Guests get their own **10,000 image/day allowance keyed to their network address** (only a hash + masked IP are stored). No account → most data routes say `401`. |
| **RULE 22** | One studio shell, **two views**: the Quick Batch **table** and the **Editor** accordions. Switching is memory-only (not saved). |
| **RULE 23** | CMS, manual payments and the account dashboard reuse the shell but have their **own** password/session checks. Admin routes need the settings password. |
| **RULE 24** | The "✨ Generate SEO Script" walkthrough: plan one keyword set → review and accept it → pick a visual style → write the script → fetch the images. The modal can be closed while it works. |
| **RULE 25** | The **Quick Batch table is a second editor, not a second engine**: it reuses the same renderer. Row states walk `empty → ready → voice → timing → prompts → images → animate → done` (or silently back to `ready`). |
| **RULE 26** | `render-app/` is a **separate** local Node tool (script → MP3 via Playwright). The Worker never calls it and it is not needed to use the studio. |
| **RULE 27** | UI decisions: no sticker button, Delete Video sits in each accordion, no "☁️ API" button, the planner retries instead of freezing. |
| **RULE 28** | Prompts are capped at **1,800 characters**; image work is paced (~3 images per 3 s per row); queueing is non-blocking so the page stays responsive. |
| **RULE 29–31** | The browser, not the server, drives the **progressive** image loop (ask for 3 keywords → render → ask for the next 3). Credits are reserved up front and refunded for anything not delivered. The server load-balances and answers `503 + Retry-After` instead of hard-failing. |
| **RULE 32** | Retries happen **per scene**, never "restart the whole video", and a slow clip capture is bounded so a row cannot hang forever. |
| **RULE 33** | Up to **5 backup Workers** can be registered. AI calls are spread **round-robin**, with health checks, a cooldown when one misbehaves, and only AI paths ever leave the primary. |
| **RULE 34** | The text model itself rotates between **Cloudflare Workers AI** and **OpenRouter**; a broken key is benched for a while and the call falls through to the other provider. |
| **RULE 35** | **Script details never touch the server's database.** The durable copy is the visitor's `localStorage` + a compact cookie, compared by digest/timestamp/length. The Worker keeps only a throwaway in-memory copy. |
| **FINAL RULE (Quick Batch layout)** | Non-media stages fail → the browser retries **30 times, 20 s apart, silently**. Photos/clips fail → only the **individual failed item** is retried on the same ladder. Every video plans **14 scenes = 8 photos + 6 clips**, whatever the script length. The last table column is **Actions** (Preview ▶, Process export ⚙, Edit ✎). |

### F. The user flows, step by step

#### F1. First visit → account

```text
open "/"  ── landing page (sign up / log in links)
   │
   ├─ "Sign up" → GET /account?mode=signup → fill username/password/email → POST /api/signup
   │                 → session cookie (30 days) → /studio
   ├─ "Log in"  → GET /account            → POST /api/login
   └─ "Try it"  → GET /free  → sets yvs_free=1 for 1 day → same studio, guest mode
```

- `/studio` without a session redirects to `/free`; `/paid` without a paid plan redirects to `/studio`.
- These URLs decide **which studio mode** the page boots in (`window.__PLAN_MODE`). They are a
  navigation boundary, not a security boundary — the real "do you have credits?" check happens on
  every metered API call.
- `/account` shows plan, today's usage, receipts; `/upgrade` explains manual payment, and the visitor
  uploads a receipt screenshot (≤ 4 MiB). An admin later approves it with a transaction number, and
  only then does the account become `paid_user`.

#### F2. The Editor (the accordion view)

1. **＋ Add Video** → a "Video N" card appears (max **10**). Each card holds its own files, MP3,
   title, quality and script; deleting a card renumbers the rest.
2. **✨ Generate SEO Script** opens the 4-step walkthrough (plan → review keyword set → choose style →
   write & fetch). It can be closed while it works; the result lands in the card's Script box.
3. **📁 Upload Image, GIF or MP4** adds up to 25 stills / 5 GIFs (≤ 30 MiB each) / 5 MP4s, or
   **Add video from template** builds a 1–25 s clip from one of the 15 interactive scenes.
4. **🎵 Upload MP3 Audio** (or the generated voiceover) sets the length of the video.
5. **Title**, **Quality** (480p/720p/720p-high) — plain controls.
6. **✦ Generate** (top bar) renders the cards **one after another** and downloads each MP4.

#### F3. Quick Batch table (the fast lane)

```text
＋ Add Row  → paste a script (>= 10 words) → pick style / resolution / orientation
   │
   ✦ Generate
   │   row1: voice ─▶ timing ─▶ prompts ─▶ images ─▶ animate ─▶ done ┐
   │   row2: voice ─▶ timing ─▶ prompts ─▶ images ─▶ animate ─▶ done ├ 3 at a time,
   │   row3: ...                                                      ┘ next starts early
   ▼
Actions column unlocks on the finished row:  ▶ Preview   ⚙ Process export   ✎ Edit
```

Rules a beginner will bump into immediately:

- **Fewer than 10 words → nothing happens.** A dialog names the row(s) and the count.
  (The constant is `WORD_COUNT_MIN = 10`.)
- **An already-finished row is skipped**, because its MP3/images/animation are already in memory;
  re-running it would only cost credits.
- **Generate doubles as Stop** while rows are running.
- **10 rows max**, **5 rows per page**, and finished rows are remembered for **24 hours**
  (`ytvs.quick-batch-completed.v1`, at most 40 entries) purely so a refresh is not a total loss.
- A row that fails a non-media stage retries **7 times × 40 s silently** — the row keeps its normal
  "working" look and never paints an error.

#### F4. Edit → the timeline editor (the part with real traffic rules)

Pressing **✎ Edit** opens a **new tab** with `?layout=timeline`. Because a video must never be edited
in two tabs at once, four mechanisms cooperate:

1. **A click counter cookie** (`ytvs_timeline_edit_counter_<project>`) plus a small localStorage
   ledger get a new increasing number — so the newest click can be identified even if a popup is
   blocked.
2. **A Web Lock** named `ytvs-edit-owner:<project>` — only one tab may hold it. The old tab finishes
   its save, hands the project back, then releases; only then does the new tab continue.
3. **A presence lock** `ytvs-edit-open:<project>:<tab>` — the Quick Batch table watches these to know
   "this row's media is off-limits right now".
4. **The saved project itself** lives in `localStorage["ytvs.timeline-editor.v1.<project>"]`, with an
   **8-part cookie backup**. Media blobs live in the IndexedDB database
   `ytvs-timeline-editor-assets-v1`, never in a cookie or URL.

What the user sees:

```text
Quick Batch row  ──✎ Edit──▶  new tab: timeline editor
                                scenes on a timeline, text/graphic layers,
                                subtitles burned in, preview canvas, Export MP4
                                     │  (every edit autosaves 180 ms later)
                                     ▼
                              "← Quick Batch"
                                     │  save → publish a summary to the table → release the lock
                                     ▼
                          table row reopens with ▶ Preview / ⚙ Export using the edited project
```

- While that tab is open, **that row's** Generate/media buttons are locked. Other rows are fine.
- A tab that has lost ownership becomes **read-only** and shows a warning; its saves are refused.
- If the previous editor crashed, the next one asks before opening the last saved state — it cannot
  bring back unsaved memory.

#### F5. Export

Both the table's ⚙ and the timeline's **⬇ Export MP4** end in the same browser encoder:
paint frame → encode H.264 → encode AAC → mux → save. Chromium browsers stream straight to disk;
other browsers build the file in memory and warn above ~250 MB. **Nothing is uploaded.**

#### F6. Settings page (administrator)

One page, password-protected, at today's day-stamped URL, with seven tabs:

| Tab | What it controls |
| --- | --- |
| 1. General & Themes | the seven skins, backup-Worker URLs, background-worker mode |
| 2. Guest Credits by IP | per-network guest usage, reset |
| 3. Plans | plan descriptions |
| 4. Accounts Credits | set `free` / `paid_user`, reset today's counters |
| 5. Local Payment Gateway | the bank/wallet text shown on `/upgrade` |
| 6. Payment Transactions | paginated receipts, approve with a unique transaction number |
| 7. CMS Pages | create/edit/delete up to 8 flat public pages |

#### F7. Public pages and CMS

`/` landing · `/account` · `/upgrade` · `/free` `/studio` `/paid` · `/{day}/config/uvxyz` ·
`/<slug>` for a published CMS page (flat slugs only, reserved words blocked, text HTML-escaped so a
"page" can never inject code).

### G. What the browser remembers (and what the server does)

| Store | Key | Holds | Size limit / lifetime |
| --- | --- | --- | --- |
| Cookie | `yvs_session` | login token | 30 days |
| Cookie | `yvs_free` | "this visitor came through /free" | 1 day |
| Cookie | `ytvs_note` | compact copy of the newest script note | ≤ 3.4 KB |
| Cookie | `ytvs_timeline_editor_<id>_1…_8` | backup of one timeline project | 8 × ~3.8 KB |
| Cookie | `ytvs_pipeline_management_<page>_1…_4` | backup of the Quick Batch page | 4 × ~3.8 KB |
| Cookie | `ytvs_timeline_edit_counter_<id>` | "who clicked Edit last" | session |
| Cookie | `ytvs_transition_project_<key>` | tiny "which row am I opening" note | short-lived |
| localStorage | `ytvs.timeline-editor.v1.<id>` | **the real saved timeline project** | megabytes-ish |
| localStorage | `ytvs.pipeline-management.v1.<page>` | **the real Quick Batch rows** | ≤ 8 rows, 8,000 chars/script |
| localStorage | `ytvs.script-notes.v1` | script notes | 24 entries / 7 days |
| localStorage | `ytvs.quick-batch-completed.v1` | finished-row archive | 40 entries / 24 h |
| IndexedDB | `ytvs-timeline-editor-assets-v1` | **MP3 + photos + clips (the bytes)** | browser quota |
| KV (server) | `user:`, `email:`, `session:`, `credits:`, `ipcredits:`, `config:*`, `payment:*` | accounts, 30-day sessions, counters, settings, receipts | see RULE 15 |

**Plain rule of thumb:** the server knows *who you are and how much you may spend*. Your browser
knows *what you made*. Clearing site data deletes your projects; deleting your account does not.

### H. The "only one editor" rule, explained with a library book

The timeline project is a **library book**. `localStorage` is the shelf, the cookies are a photocopy
in case the shelf is empty, and IndexedDB is the box of photographs tucked inside the book.

- **Borrowing** = holding `ytvs-edit-owner:<project>`. Only one borrower at a time.
- **The waiting list** = the counter cookie. The newest number gets the book next.
- **The sticky note on the desk** = `ytvs-edit-open:...`, telling the Quick Batch table
  "this book is on loan — don't reshuffle its pictures".
- **Photocopying on the way out** = save + publish, so the table sees the edit.
- **A book returned without a checkout slip** = a crash. The next borrower is asked
  "the previous one didn't say it finished — open the last saved version?"; unsaved scribbles are gone.

This machinery is **per project**, not per table: only the row whose video is open loses its buttons.

### I. What happens when things go wrong (the failure menu)

| Situation | What the code does | What the visitor sees |
| --- | --- | --- |
| Script-writing model fails | Browser retries **7×**, 40 s apart, one inference per try | a normal spinner; no error text in Quick Batch |
| A pipeline stage fails (voice/plan/animate) | Only that stage is retried on the same ladder; earlier work kept | the row keeps its working label |
| One photo/clip fails | Only that **item** is retried; successful files and filenames are kept | the rest of the gallery stays |
| Everything still fails | the row returns quietly to `ready` | buttons stay locked; press Generate again |
| Pixabay is rate-limiting (`429`) | the server's `Retry-After` hint is honoured; no tight loop | progress pauses, then continues |
| Image fleet overloaded | server answers `503 + Retry-After`, load governor halves concurrency | the browser waits instead of piling on |
| Allowance spent | request refused with the counters | "daily allowance exhausted" + reset time |
| Popup blocked on Edit | the click is still counted; the current editor keeps control | a dialog asking to allow pop-ups |
| Two tabs edit the same video | newest request wins; loser becomes read-only | top-of-page warning in the old tab |
| Storage full / blocked | save fails **closed**: nothing is silently overwritten | a red storage banner with a "Reset" button |
| Browser has no WebCodecs | export refuses up front | "use modern Chrome, Edge or Safari" |
| Video would be huge in memory | asks for confirmation first | "this may crash the tab — continue?" |
| Tab closed mid-edit | `pagehide` flushes one last save | whatever was not saved is gone (and it says so) |

### J. Limits cheat sheet (memorise these and you know the app)

| Thing | Limit |
| --- | --- |
| Account signup & login | username 3–40 chars (`[a-zA-Z0-9_]`) · email ≤ 40 chars · password ≥ 6 · session TTL 30 days (no account count cap) |
| Videos in the Editor · rows in Quick Batch | 10 · 10 (5 per page) |
| Minimum script for a Quick Batch row | **10 words** |
| Scenes per automatic video | **14 = 8 photos + 6 clips** (clips at slots 2, 4, 6, 9, 11, 14) |
| Uploads per video | 25 images (no file-size cap) · 5 GIFs (≤ 30 MiB file, ≤ 30 MiB decoded frames) · 5 MP4s (60 s each) |
| Still-picture duration | 9 s (list repeats until the MP3 ends) |
| Captions | 10 rows · 40 characters · last one hidden after ~10 s |
| Voiceover | ≤ 8,000 characters, chunks ≤ 400, 8 languages (`en` default) |
| Images per day | **10,000** per account **and** per guest network; reset 00:00 Asia/Taipei |
| Image pacing | ~3 images / 3 s per row; 14 max per legacy batch request |
| Video output | 30 fps, H.264 + AAC, presets 854×480 · 1280×720 · 1280×720-high |
| Timeline editor | ≤ 60 min project, ≤ 80 s per item slider, min clip 0.25 s, ≤ 4 visual tracks, ≤ 100 media files (GIFs ≤ 30 MiB; regular images uncapped) |
| Backup Workers | 5 |
| Settings page | `/{day}/config/uvxyz`, password-gated, Asia/Taipei day |
| CMS | 8 pages · 100 blocks · flat slug ≤ 64 chars |
| Payment receipt | 4 MiB, PNG/JPEG/WebP/GIF only |

### K. How to run and check it yourself

```bash
npm install
npx wrangler kv namespace create KV_BINDING   # paste the id into wrangler.json
npx wrangler dev                              # local server with bindings
npx wrangler deploy                           # publish
npm test                                      # 53 files / ~620 checks (jsdom + node)
npx tsc --noEmit                              # type-check (some pre-existing errors in src/index.ts)
```

- `PIXABAY_ALLOW_UNMETERED=true` lets local runs import stock media without KV (dev only).
- `RELAY_SECRET` must be identical on every Worker in a rotation pool.
- `render-app/` is optional and independent: `cd render-app && npm install && npm start`.

**Verification of this appendix (2026-11-18):** documentation-only change; no source code was
modified. `tests/session-331-fixes.test.mjs` and `tests/timeline-preview-parity.test.mjs` pass;
`tests/final-media-cap-actions.test.mjs` reports 10/14 with four failures (`Edit opens a new page…`,
`…one dummy text at 0:00…`, `…live video style…`, `Generate refuses unprepared staged rows…`) and
`tests/deep-debug-regressions.test.mjs` has one frame-size assertion failure — all five are
**pre-existing on this branch as received** and unrelated to this document.

### L. The whole thing in ten sentences

1. One small program on Cloudflare answers every URL; one big page in the browser does all the work.
2. Signup/login lives in Cloudflare KV; a cookie remembers you for 30 days.
3. An AI plans keywords and writes a plain narration script (1 long-tail ≥ 1×, 4 short ≥ 2× each).
4. A second AI speaks it; the MP3 is cut into small chunks and stitched back together.
5. The browser turns the script into 14 short Pixabay search phrases (three content words at every 12th–15th word, articles removed).
6. Your browser itself downloads 8 photos and 6 clips and checks they are really images/video.
7. Every video buys its scenes from a 10,000-per-day allowance that resets at Taipei midnight.
8. A canvas paints the slides, subtitles and titles; WebCodecs encodes them at 30 fps.
9. The Quick Batch table runs three rows at a time; the timeline editor edits one video at a time
   under a browser lock, saving into localStorage with cookie backups.
10. Everything is stored in **your** browser, so a reload can keep your work — and clearing site data
    can destroy it.

**One-line summary:** *write a script → the browser plans stock searches from the script and speaks it → your browser
downloads the pictures, paints the slides, and encodes the MP4 locally.*

### N. Browser scene-keyword planning (2026-11-19)

**What changed:** The studio no longer POSTs the narration script to `/api/image-prompts` for a text model to plan Pixabay search keywords. Scene keywords are now planned entirely in the browser from the row's script.

**How it works** (`src/client/app-js.ts`, `planBrowserSceneKeywords(script, totalScenes)`):

1. **Three words at every x-th word.** The planner walks the script's content words and takes three at every x-th position, where x is drawn once from the arithmetic sequence `[12, 13, 14, 15]`. If the script runs out before all scenes are filled, positions wrap around to the start.
2. **Articles removed.** Selected words are filtered through the stopword list (`SCRIPT_KEYWORD_STOPWORDS`, `SCRIPT_KEYWORD_WEAK_WORDS`) so articles (`a`, `an`, `the`) and other short function words never reach Pixabay.
3. **Scene types fixed.** Six scenes are video and eight are photos, at positions `[1, 3, 5, 8, 10, 13]` (zero-based), matching `BROWSER_VIDEO_POSITIONS`.
4. **Browser-side only.** `requestBatchPrompts` (Quick Batch) and the Editor's prompt request both call `planBrowserSceneKeywords` from `row.script` / `project.script`, slice by batch offset/count, and return `pixabay:JSON` tokens. No text model is consulted and `/api/image-prompts` is not called for these flows.

**Scene counts:** All constants moved from 12 to 14 — `AUTO_MEDIA_TOTAL=14`, `AUTO_VIDEO_SCENES=6`, `AUTO_IMAGE_SCENES=8`, plus matching constants in `src/modules/image-prompts.ts`, `src/modules/pixabay.ts`, `src/modules/image-batch.ts`, `src/client/progressive-image-pipeline.ts`, `src/client/pixabay-direct.ts`, and `src/index.ts` (worker capabilities `mediaSceneCap: 14`, `mediaVideoScenes: 6`, `mediaImageScenes: 8`).

**Tests:** `session-331-fixes.test.mjs` (11/11), `final-media-cap-actions.test.mjs` (14/14), `quick-batch-table.test.mjs` (8 pass / 7 pre-existing failures, unchanged from baseline).

### M. Documentation drift found while writing this appendix (code wins)

Old numbers in the prose documents no longer match the code. They are listed here instead of
being silently repeated, because a beginner reading the wrong number would design the wrong thing:

| Where the old number lives | Old claim | What the code actually does |
| --- | --- | --- |
| `README.md` "Limits worth knowing" → Voiceover | "chunked at 500" | `VOICEOVER_MAX_CHUNK = 400` in `src/modules/voiceover.ts`; `/api/voiceover` rejects a chunk over 400 characters |
| `README.md` "Limits worth knowing" → Captions, and the quoted on-screen hint in `system-rules.md` RULE 18 | "last caption capped at 12 s" | `CAPTION_MAX_VISIBLE_MS = 10 000` (10 s) in `src/client/app-js.ts` — the *hint text* still says 12 s, so the copy and the constant disagree |
| `system-rules.md` RULE 33, opening line | "up to four backup Worker URLs" | `MAX_RELAY_WORKERS = 5` (`src/modules/api-relay.ts`) and the `config/workers` validator slices to 5 (`src/index.ts`); the settings page accepts five |
| Retry prose in `THIRD_PARTY_NOTICES.md`, `api-relay-rotation.md`, `bug-audit.md`, `bug-fix-session-*.md`, `IMAGE_FETCH_BROWSER_MIGRATION.md`, `PIXABAY_IMAGE_PIPELINE_REQUIREMENTS.md`, `RULE-35-client-side-script-notes.md` | "7 retries, 40 s apart" | `PIPELINE_RETRY_MAX = 30` and `PIPELINE_RETRY_BACKOFF_MS = 20 000` in `src/modules/retry-policy.ts` (see §D-2). Those files are dated session records; the code and §D-2 win. |

None of these is a new bug — they are documentation lag. The quickest fix is to correct the prose
(500 → 400, 12 s → 10 s, four → five, 7 / 40 s → 30 / 20 s) or, for the caption hint, to decide which
number is intended and change the constant or the copy so they match. This appendix uses the **code**
values throughout.
