# Bug Fix Session #244 — 2026-10-26

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

Five requests, all implemented and verified in `arena/4abf8a53-text-to-image-template`.

| # | Request (user's words) | Result |
| --- | --- | --- |
| 1 | Debug the bulk table **layout** processing error | Fixed: `table-layout: fixed` + `min-width` on `.batch-table-edit`, wrapping status cells, and the stalled-stream/abort defects that made a row look "stuck". |
| 2 | Retry failing steps **inside the row**, with **no error UI** — the row shows the editor's script-section loading animation while retrying | `batchRunStep()`: up to 4 attempts per step, backoff 0.8/1.6/3.2 s, status cell keeps `.va-spinner` + `va-loading-pulse`. Nothing about the retry is visible. |
| 3 | Debug why batch rows show **"signal" / "aborted"** errors | Root cause: `batchFetch()` aborts through its own `AbortController`, and `runBatchRow` printed `error.message` — the browser's `AbortError` text. Aborts/timeouts are now classified and never rendered. |
| 4 | Site Admin/CMS: **allow deleting a menu URL/page** | One `deleteCmsPage()` path used by the pill's **Delete** and a new **Delete This Page** button in the editor; confirmation, re-render, and the Top Menu / Footer link disappears on the next request. |
| 5 | Split Site Admin credits into **three pages**: Guest Credits by IP, Plans, Accounts Credits | The admin page now has seven tabs; the three credit surfaces are separate `#cfg-panel-*` sections with their own loaders. |

---

## 1. What was actually wrong

### 1.1 "signal" / "aborted" rows (requests 1 and 3)

`batchFetch(row, url, init, timeoutMs)` creates a per-row `AbortController`, stores it on
`row.controller`, and aborts it from a timer when `BATCH_REQUEST_TIMEOUT_MS` (240 s, 480 s for the
image batch) elapses. `stopBatchRows()` also aborts `row.controller`.

Everything the browser throws for that abort is a `DOMException` whose `message` is
**"signal is aborted without reason"** (or "The user aborted a request"). `runBatchRow`'s catch
did:

```js
const message = rowError && rowError.message ? rowError.message : String(rowError);
setBatchStage(row, "error", message);
```

…so the row's status cell rendered `⚠ signal is aborted without reason`. That is the "signal /
aborted" text the user saw. There was also **no retry**: the row simply failed.

Two secondary defects fed the same symptom:

- the NDJSON reader in `requestBatchImages` had **no deadline after the headers**: a stalled
  `/api/image-batch` stream waited forever, so the row sat in "Rendering the AI images" and only a
  page reload ended it;
- the batch table used the browser's **auto** table layout, so a long status line changed a
  column's measured width and shifted the other six **mid-processing** — the layout jump the user
  described as a layout error.

### 1.2 CMS delete (request 4)

`POST /api/config/cms/delete` and `DELETE /api/config/cms` already worked (`cms.ts`
`handleCmsApiRoutes`), and the saved-page pill already had a Delete button. What was missing was a
discoverable path from the **editor**: the only way to delete a page was a 0.75 rem button inside
the pill row above the form. Both affordances now share one function.

### 1.3 Credits were two cards in tab 1 (request 5)

`#cfg-panel-general` held a `.cfg-two-col` row with "Plans & Account Credits" and "Guest Credits
by IP" side by side. The admin had no separate Plans surface at all.

---

## 2. What changed

### `src/client/app-js.ts`

- **New constants** (right after `BATCH_RUN_CONCURRENCY`):
  `BATCH_STEP_ATTEMPTS = 4`, `BATCH_RETRY_BASE_MS = 800`, `BATCH_RETRY_MAX_MS = 4000`,
  `BATCH_STREAM_IDLE_TIMEOUT_MS = 90000`, and the mutable `batchRetryPolicy`
  (`{attempts, baseMs, maxMs}`, published as `window.__BATCH_RETRY`).
- **New helpers**: `batchRowBusy()`, `batchStatusHTML()`, `paintBatchRowStatus()`, `batchError()`,
  `batchDelay()`, `batchIsAbortError()`, `batchErrorBrief()`, `revokeBatchUrlsSince()`,
  `batchRetrySetting()`, `batchReadChunk()`, `batchRunStep()`.
- **`batchFetch()`** now remembers that *it* aborted (its own timeout) and rethrows a
  `TimeoutError`; a `row.stopRequested` abort becomes an `AbortError` ("The row was stopped"); any
  other abort is normalised to a retryable `TimeoutError`. Browser abort wording cannot escape.
- **`requestBatchImages()`** reads through `batchReadChunk()`, which cancels the reader and throws
  a retryable `TimeoutError` when the stream goes quiet for 90 s.
- **`runBatchRow()`** runs all four steps through `batchRunStep()`. Its catch no longer writes an
  error: it logs a `console.warn` and sets `stage = "ready"`, `error = ""`.
- **`setBatchStage()` / `refreshBatchRowCells()` / `batchRowHTML()`** paint the status cell through
  `batchStatusHTML()` and set `data-loading="1"` while the row works.
- **`stopBatchRows()`** sets `row.stopRequested = true` (and `retrying = false`) *before* aborting.

### `src/client/styles.ts`

```css
#studio-app .batch-table-edit { white-space: normal; table-layout: fixed; min-width: 880px; }
#studio-app .batch-row-status { … overflow-wrap: anywhere; word-break: break-word; }
#studio-app .batch-row-status[data-loading="1"] {
    display: flex; align-items: center; gap: 8px;
    animation: va-loading-pulse 1.2s ease-in-out infinite;   /* the editor's own keyframes */
}
```

`.va-spinner` and `@keyframes va-loading-pulse` are reused unchanged, so the row's animation is
the editor script box's animation.

### `src/client/config-page-js.ts`

- **Seven tabs**: `general | guests | plans | accounts | payment-gateway | payments | cms`, with
  `activateTab()` lazily loading `loadGuests()`, `loadCreditUsers()`, `loadPaymentsPage()`,
  `loadGatewayConfig()`, `loadCmsPages()`.
- **Tab 2 Guest Credits by IP**: the guest list + Refresh (unchanged behaviour, own page).
- **Tab 3 Plans**: `renderPlansPanel(d)` renders one row per plan definition from
  `GET /api/config/users`'s `plans[]` (Free 50/day, Paid 1,200/day) plus the read-only Guest plan
  (10/day per IP), each with its account count and today's images used; `#cfg-plans-refresh`.
- **Tab 4 Accounts Credits**: username, plan select, "Reset today counters", Save Plan and the
  account list.
- **CMS delete**: `deleteCmsPage(page)` (confirm → `POST /api/config/cms/delete {pw,id,slug}` →
  re-render pills/counter/editor from the response) is called by the pill's Delete and by the new
  `#cms-delete-btn` ("Delete This Page"), which `setCmsDeleteEnabled()` shows only while
  `#cms-edit-id` holds an id.

### Tests

- `tests/session-244.test.mjs` (new, 10 tests): silent retry to success, the editor's animation
  reused (`data-loading` + `.va-spinner`), abort wording never rendered, a permanently failing step
  showing no error UI, the fixed table layout, the three credit pages + plan definitions, and both
  CMS delete paths.
- `tests/quick-batch-table.test.mjs`: the old "a row that fails mid-run reports it in its own cell"
  test was rewritten to the new contract (quiet retries, row back to `ready`, cells still text).

---

## 3. Verification

| Gate | Result |
| --- | --- |
| `npm test` | **89 / 89 pass** (79 before + 10 new) |
| `npx tsc --noEmit` | 36 errors, all pre-existing in `src/index.ts` (37 before); none in a touched file |
| `APP_JS` / `CONFIG_PAGE_SCRIPT` parse | both compile (`new Function` / `node --check`) |
| `wrangler dev` smoke — settings page | `/26/config/uvxyz` → 200; all seven `data-cfg-tab` values present, plus `#cms-delete-btn`, `#cfg-plans-list`, `#cfg-panel-guests` |
| `wrangler dev` smoke — studio | `/free` → 200 (1.92 MB); `table-layout: fixed` and `batch-row-status[data-loading="1"]` present |
| `wrangler dev` smoke — CMS API | create `/about-us` → list → `POST /api/config/cms/delete {pw,id}` → `{success:true, pages:[]}` (200) |

Local `wrangler dev` cannot run the AI binding (`Binding AI needs to be run remotely`), so the
image/prompt steps were exercised through the jsdom fetch mocks in the tests, not against a live
model. Everything else — retries, aborts, layout, admin tabs, CMS delete — is covered by the
jsdom tests and the HTTP smoke test above.

---

## 4. Notes / restrictions

- A retry is **invisible by design**: the stage label is painted once and a retry does not touch it.
  The only evidence is `console.warn("[batch-table] row N step X attempt I of 4 did not finish -
  retrying quietly")`.
- A row that exhausts its attempts goes back to **Ready — press ✦ Generate** and stays pending, so
  the next Generate retries it. It still reports `row.error === ""`.
- `batchStatusText()`'s `⚠ …` branch and the `[data-stage="error"]` colour rule are kept (they are
  still reachable from `openBatchPreview()`'s informational path and older call sites) but the
  batch table no longer assigns `stage = "error"`.
- `BATCH_STAGE_LABELS.queued` is still dead copy (`toberesolved.md` B5); this session did not
  change that.
