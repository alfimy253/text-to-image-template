# Bug Fix Session #249 — account rows carry the email + plan, accounts are labelled with their plan, free plan = 70,000 images/day

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

Date: 2026-10-26 · branch `arena/3897f37c-text-to-image-template`

## What was reported

1. *The user email key's value must be at `user:<username>` too, and the plan value
   (`free` / `paid_user`) must be in that value as well — check the same username,
   since the username is unique.*
2. *Debug why the users are not labelled with a detail about their plans.*
3. *Make the free plan have 70,000 credits for now.*

## 1 + 2 — Why accounts were not labelled

The KV namespace holds two kinds of account keys:

| key | value (before) | written by |
| --- | --- | --- |
| `user:<username>` | `{username, email?, salt, hash, usertype?, createdAt}` | `POST /api/signup`, settings page, payment approval |
| `email:<address>` | `{username}` | `POST /api/signup` only |

Two real defects followed from that layout:

- **Rows written before the credits system / the email index are incomplete.** An
  account created by an older build has no `usertype` (so it silently read as `free`)
  and sometimes no `email` at all — its address existed only in the `email:<address>`
  pointer, which the settings page never consulted. Nothing was ever written back,
  so the row stayed incomplete forever. That is the "users are not labelled with a
  plan detail" symptom: the table could only print the raw `usertype` string, and for
  legacy rows it printed `free` with a blank email.
- **Plan changes drifted.** `POST /api/config/users` (and payment approval) updated
  `user:<username>.usertype` but never the `email:<address>` pointer, so the two keys
  described different states of the same account.

Additionally the Accounts table itself rendered only
`<code>username</code> free · 47/50 images left` — no email, no plan label, no limit
name — and the plan `<option>` labels were hard-coded copy that could drift from
`CREDIT_PLANS`.

### The fix

- `user:<username>` is now the single source of truth, keyed by the **unique username**:
  `{ username, email, usertype, createdAt, updatedAt, salt, hash }`.
- `email:<address>` mirrors the same triple `{ username, email, usertype }`; it stays a
  pointer index (O(1) uniqueness check) but no longer says less than the row.
- `authRepairUserRecord()` heals both directions, bounded:
  - the reverse email map (`address -> username`) fills a missing `email` on the row;
  - a row with an email recreates a missing `email:<address>` pointer;
  - a username-only pointer is upgraded to the full triple;
  - nothing is ever re-pointed at a different username, so a stale pointer cannot take
    over an account.
  Writes happen only when something is actually missing, so steady state costs zero
  writes. `GET /api/config/users` and the plan-change POST both run it.
- `GET /api/config/users` now returns `planLabel` + `planImages` per row, plus
  `shown` / `total` / `hasMore`; rows are listed newest-first.
- The Accounts table renders one row per account: **username + email**, a plan badge
  (`Free plan · 70,000 AI images / day`, `Paid plan · 1,200 AI images / day`) and
  `69,997 of 70,000 images left today · 3 used`. The plan picker re-labels itself from
  the payload, so the numbers on the page are always the numbers the meter enforces.
- Payment approval (`src/modules/payments.ts`) writes the email + plan into both keys.

### KV operation budget

`GET /api/config/users` worst case (50 accounts): 1 list (users) + 1 list (emails)
+ 50 user reads + 50 email-index reads (`AUTH_EMAIL_SCAN_MAX`) + 50 credits reads
≈ 152 ops, still far below the 1,000-op per-invocation limit. `tests/account-rows.test.mjs`
asserts the bound.

## 3 — Free plan is 70,000 AI images/day

`CREDIT_PLANS.free.limits.images` went from `50` to `70000`. Everything user-facing is
derived from that constant or from the API payload, and the literal copy that duplicated
it was updated:

- worker: 429 quota copy, 401 sign-in copy, signup comments, settings-page docblock;
- studio: credits pill/popover (`70,000 / 70,000 left today`), quota alert, guest
  popover CTA, auth overlay plan note, client fallback limit;
- landing page: marquee + free plan card;
- settings page: Accounts Credits copy, plan `<option>` labels, plan panel numbers
  (now thousands-separated through `fmtNum()`);
- docs: `README.md`, `system-rules.md` (RULE 20 + copy table), `userflow.md`.

New `creditFormatNumber()` helpers (worker + studio) and `fmtNum()` (settings page) print
limits as `70,000` instead of `70000`; the paid 1,200 limit gets the same treatment.

> Note: the free plan now exceeds the paid 1,200/day allowance. That is what was asked
> for "for now" — raise `CREDIT_PLANS.paid_user.limits.images` when the paid tier should
> sit above free again.

## Tests

- `tests/account-rows.test.mjs` (new, 6 tests): plan numbers in `CREDIT_PLANS` + the API,
  user row / email index mirroring, legacy-row healing from the unique username,
  plan-change sync, signup writes both keys, and the KV operation budget.
- `tests/session-244.test.mjs`: fixtures now use 70,000 / 1,200 and assert that every
  account row carries its email + plan detail, and that the plan picker is payload-driven.
- `npm test` → 101 passing. `npx tsc` reports the same 37 pre-existing errors as
  `main` (no new ones).


---

## RULE 35 — script notes are client-side only (2026-11-03)

> **FIXED IN CODE.** Script details (narration, keyword set, beat plan, research facts,
> timings, note state and the success payload) are **never written to Cloudflare KV**. The
> durable copy is the browser's `localStorage["ytvs.script-notes.v1"]` full note plus the
> compact `ytvs_note` cookie mirror, reconciled by digest + timestamp + script-length checks
> (`src/client/script-notes-client.ts`). The Worker keeps only an ephemeral per-isolate memory
> copy (`src/modules/script-notes.ts`: 0 KV reads / 0 KV writes). The script route writes no
> credit KV record, `?async=1` degrades to a synchronous response, and capabilities advertise
> `asyncScript: 0`, `scriptNoteKvWrites: 0`,
> `scriptNoteConsistency: "digest+timestamp+scriptLength"`.
>
> Canonical specification: [RULE-35-client-side-script-notes.md](RULE-35-client-side-script-notes.md)
> · Normative rule: `system-rules.md` RULE 35 · Verification:
> `tests/script-note-client-only.test.mjs` (12/12). Any older KV-note statement in this
> document is superseded and void.

---

## FINAL RULE — QUICK BATCH TABLE LAYOUT (2026-11-04)

This is the final, code-backed rule for the **Quick Batch table layout** and the **shared Editor media pipeline**. It supersedes every older Markdown/session note about one-request tables, Worker-owned media retries, variable scene totals, separate Preview/Export columns, or row script buttons.

1. Client JavaScript owns retries for every failed **non-media** pipeline stage in this layout: voice, scene plan / prompts and animation. One initial attempt is followed by at most **7 retries** (8 total attempts); every retry waits **40 seconds** first. Only the failed stage is reset and repeated. Earlier successful stages are kept; there is no whole-row restart and no duplicate paid batch.
2. **Image and video imports are the exception in BOTH layouts.** Only the individually failed photo or clip is retried from client JavaScript, using the same 7-retry / 40-second ladder per item. Successful media, object URLs and recorded filenames are preserved. There is no whole-stage, whole-batch or whole-row media restart, and a failed stage-level retry must not revoke a successful image.
3. Every automatic video in **both** the Editor and Quick Batch table plans exactly **12 Pixabay scenes for every script length and duration**: **4 silent videos + 8 photos**. Scene planning and Pixabay searches always target those same 12 results (8 image results and 4 video results). Client JS records the filename of every selected scene and rejects duplicate filenames in one video; alternate Pixabay result indexes/pages are searched for the failed item so no similar image repeats in one video. A duplicate or missing scene is retried individually and must not strand the row.
4. Retries are silent. The row keeps its script textarea, working stage label and `.va-spinner` continuously; no error, retry, attempt, warning or abort wording is painted in the table UI. After an exhausted ladder the row returns silently to `ready`.
5. A missing scene plan must be retried by client JS, and the row must continue to the next pipeline once a plan arrives.
6. In the **Editor layout**, the script textbox is pinned while script writing/retries run: no state paint, toggle or accordion renumber may hide it over time.
7. The **last table column is `Actions`** with icons for **Preview** (same existing function), **Process Export** and **Edit**. Edit opens a new page with a **transition-only project JSON** payload carrying the row's basic settings from `batchProjectJson()`; `applyTransitionProject()` consumes it for the transition only. The rows have **no AI enhancer button**.
8. `src/client/app-js.ts` is the source of truth. `AUTO_MEDIA_TOTAL = 12`, `AUTO_VIDEO_SCENES = 4`, `AUTO_IMAGE_SCENES = 8`, `MEDIA_ITEM_MAX_RETRIES = 7`, `MEDIA_ITEM_RETRY_BACKOFF_MS = 40000`, `retryFailedMediaOnly()`, `requestBatchImagesWithIndividualRetries()`, `runEditorMediaWithIndividualRetries()`, `batchActionCell()`, `batchProjectJson()` and `applyTransitionProject()` define the live contract. Worker capabilities advertise `mediaSceneCap: 12`, `mediaVideoScenes: 4`, `mediaImageScenes: 8`, `mediaItemRetryOwner: "browser"`, `mediaItemRetries: 7`, `mediaItemRetryBackoffMs: 40000`, `mediaFilenameDedupe: "per-video"` and `quickBatchActionsColumn: "preview-process-export-edit"`. `BATCH_PIPELINE_MAX_RETRIES = 7` and `BATCH_PIPELINE_RETRY_BACKOFF_MS = 40000` still govern the non-media stage ladder. Older Quick Batch table statements in this file are superseded wherever they conflict.
