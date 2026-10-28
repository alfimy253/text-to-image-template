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
