# Bug Fix Session #211

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

**Date:** 2026-10-23
**Branch:** `arena/0b6124f3-text-to-image-template`
**Scope:** the two **code** defects found by the 2026-10-22 documentation-vs-code audit — the
guest refund that erased the IP row's identity (§3.3) and the `GET /api/config/workers` handler
that threw when no KV binding existed (§6.1) — documented together with the 22-finding
documentation pass that found them.

Bug Fix Session #206 (`bug-fix-session-206.md`) built the freemium `/free` entry, the guest plan
and the `ipcredits:` table. The day after, the audit in `system-rules.md`
(*Documentation vs code — inconsistency register*, 2026-10-22) read every Markdown claim against
the working tree. Twenty-one of its 22 findings were prose drift; one (§3.3) was a defect in the
running Worker, and a second (§6.1) surfaced while fixing it. This session is the fix pass for
both, plus the evidence that the rest of the code was left alone.

---

## 1. What was asked

1. Treat the audit register as the work list, not as a list of opinions: fix the code defects it
   found, not only the sentences that describe them.
2. Keep the **guest refund** from destroying the guest row's `ip` / `maskedIp` / `hash` / `scope`
   fields.
3. Keep **`GET /api/config/workers`** from throwing when the Worker runs without a KV binding.
4. Record the work under the name **Bug Fix Session #211**.

---

## 2. Fix 1 — a guest refund erased the IP row's identity (§3.3)

### 2.1 What was wrong

`/image/gen` consumes one image credit **before** the model runs and refunds it when
`env.AI.run` throws. The guest path calls `creditRefundKey()`, which re-read the row with
`creditReadKey()` → `creditParseState()` and wrote the parsed state back.

`creditParseState()` only rebuilds the day, the four counters and `updatedAt`:

```json
{ "day": "…", "videos": 0, "images": 1, "scripts": 0, "voiceovers": 0, "updatedAt": "…" }
```

The guest identity (`ip`, `maskedIp`, `hash`, `scope`) lives **outside** that shape — it is
attached by `creditWriteKey()`/the consume path after parsing. So a failed generation rewrote
`ipcredits:<hash>` as a bare counter row: the settings page lost the masked address for that IP
until the next successful use, while the usage column still showed the spending.

Before (the refund lost the metadata):

```
creditRefundKey(env, creditGuest.key, "images")   // parse → decrement → put
```

### 2.2 The fix

`creditRefundKey()` now takes the identity as an optional fifth argument and merges it back
**after** the decrement and before the write:

```ts
async function creditRefundKey(
	env: any,
	key: any,
	kind: any,
	amount: any = 1,
	meta: any = null
): Promise<void> {

	const state = await creditReadKey(env, key);

	state[kind] = Math.max(0, (Number(state[kind]) || 0) - amount);
	state.updatedAt = new Date().toISOString();

	/*
	 * `creditReadKey()` rebuilds the state without the guest
	 * metadata, so the IP row must be merged back or a refund
	 * would erase the masked address the table shows.
	 */
	if (meta) {
		Object.assign(state, meta);
	}

	await creditWriteKey(env, key, state);
}
```

and the guest failure branch passes the four fields through the single helper that already
knows them:

```ts
await creditRefundKey(
	env,
	creditGuest.key,
	"images",
	1,
	guestCreditMeta(creditGuest)
);
```

`guestCreditMeta()` returns exactly the stored shape:

```json
{ "ip": "203.0.113.0", "maskedIp": "203.0.113.0",
  "hash": "fe0202870f2f0a7fcf7cefe9465a68bf9e055353", "scope": "ip" }
```

- `meta` is **opt-in** (`null` by default): the account refund (`credits:<username>`) has no
  identity fields and its behaviour is byte-for-byte unchanged.
- The only raw address in the flow is hashed; `ip` and `maskedIp` are both the masked value
  (`guestCreditIdentity()` sets `ip: masked`), so the refund cannot start persisting a raw IP.
- `Object.assign` runs after `updatedAt`, so the metadata cannot overwrite the timestamp.

### 2.3 Verification

A mock-KV harness bundles the real Worker (`esbuild src/index.ts --bundle --format=cjs`), sends a
guest request with a throwing `AI.run`, and then dumps the stored row:

```
GET /image/gen  (Cookie: yvs_free=1, CF-Connecting-IP: 203.0.113.44)
  → 500
ipcredits:fe0202870f2f0a7fcf7cefe9465a68bf9e055353
{"day":"2026-10-23","videos":0,"images":0,"scripts":0,"voiceovers":0,
 "updatedAt":"2026-10-22T16:28:07.061Z","ip":"203.0.113.0","maskedIp":"203.0.113.0",
 "hash":"fe0202870f2f0a7fcf7cefe9465a68bf9e055353","scope":"ip"}
```

The counter is back to `0` **and** the row still identifies the address. The existing
`test-credits.cjs` refund checks (account path) still pass unchanged.

---

## 3. Fix 2 — `GET /api/config/workers` threw without KV (§6.1)

### 3.1 What was wrong

RULE 16 promises the app boots without `KV_BINDING` (open-access / e2e mode), and the other
operator routes answer `503` in that mode. The workers route instead dereferenced the binding
directly:

```ts
const raw = await env.KV_BINDING.get(CONFIG_WORKERS_KEY);
```

With no binding that is a `TypeError: Cannot read properties of undefined (reading 'get')`
thrown out of `fetch()` — a Worker error (1101), not the JSON `503` every other route returns.
The theme route already self-defaulted (`"default"`), which is why the KV-less smoke test had
looked healthy until the settings page was opened: `loadWorkers()` is called on open, so the page
logged an unhandled rejection instead of rendering **None registered.**

### 3.2 The fix

Two guards, both inside the existing branches:

- **GET** returns an empty list instead of reading KV.
- **POST** returns the same storage error the render routes use, and only **after** the password
  check, so a wrong password is still a `403` and cannot probe the deployment mode.

```ts
if (request.method === "GET") {

	/*
	 * Without KV there are no stored URLs. Returning an
	 * empty list keeps the settings page usable in the
	 * KV-less (e2e) mode instead of throwing on the
	 * missing binding.
	 */
	if (!env.KV_BINDING) {
		return json({ success: true, urls: [] });
	}

	const raw = await env.KV_BINDING.get(CONFIG_WORKERS_KEY);
	…
}
…
if (!env.KV_BINDING) {
	return json(
		{ success: false, error: "User storage not configured (bind the KV namespace)" },
		503
	);
}
```

### 3.3 Why GET is `200` and POST is `503`

- `GET` is read-only and "no stored URLs" is a truthful answer in KV-less mode. The settings page
  treats a failed read as silence; a `200` renders the empty state and keeps the page usable.
  It also keeps the route's documented contract — *open, no password* — identical in both modes.
- `POST` is a write. It cannot succeed without KV, so it joins the render routes' existing
  `503 "User storage not configured (bind the KV namespace)"` wording instead of inventing a
  second failure language.

### 3.4 Verification

Bundled Worker, mock env without a KV binding (`{}`), then with one:

| Request | No KV (before) | No KV (now) | KV bound |
| --- | --- | --- | --- |
| `GET /api/config/workers` | `TypeError` → 500/1101 | **`200 {"success":true,"urls":[]}`** | `200` with the stored array |
| `POST /api/config/workers` wrong `pw` | `403` (checked before KV) | **`403 "Wrong password"`** | `403 "Wrong password"` |
| `POST /api/config/workers` correct `pw` | `TypeError` | **`503 "User storage not configured (bind the KV namespace)"`** | `200` + saved `urls` |

---

## 4. Behavioural contract after #211

| Surface | KV bound | KV unbound |
| --- | --- | --- |
| `GET /api/config/theme` | `200 {theme}` (stored or `"default"`) | `200 {theme:"default"}` (self-default, unchanged) |
| `GET /api/config/workers` | `200 {success,urls[]}` | `200 {success:true,urls:[]}` |
| `POST /api/config/workers` | `403` wrong `pw` · `200` saved | `403` wrong `pw` · `503` storage |
| `/image/gen` (guest, model error) | `500`, credit refunded, row identity intact | unmetered (no gate) |
| `/api/config/users`, `/api/config/ipcredits`, render routes | normal | `503` storage errors (unchanged) |

No request/response shape changed for a KV-bound deployment. Both fixes are local to the
failure paths.

---

## 5. Documentation updated in the same commit

| Where | Change |
| --- | --- |
| Register §3.3 | marked fixed; resolution names `creditRefundKey(…, meta)` and the harness |
| Register §6.1 | new finding + resolution (the KV-less throw was not in the original 22) |
| `system-rules.md` RULE 3 | `GET /api/config/workers` documents the KV-less `200`/`503` split |
| `system-rules.md` header | records the 2026-10-23 pass and points at this document |
| `userflow.md` §2 | route table notes the KV-less behaviour |
| `README.md` | documentation index lists this session |
| `bug-fix-session-211.md` | this document |

The 20 prose findings are recorded in the register's resolution table and in
*Additional drift found while fixing* (`system-rules.md`, end of file).

---

## 6. Verification

All suites are mock-KV harnesses that import the real Worker bundle — no network, no Workers AI.

| Suite | Checks | Result |
| --- | --- | --- |
| `test-worker.cjs` (end-to-end credits flow) | 43 | ✅ |
| `test-credits.cjs` (plans, 429, refund, rollover, config users) | 11 | ✅ |
| `test-legacy.cjs` (pre-credits accounts, alias, bad plans) | 8 | ✅ |
| `test-guest.cjs` (`/free`, IP metering, table, URL gates) | 15 | ✅ |
| **Total** | **77** | ✅ |

- `npx tsc --noEmit`: **48 errors at the time of that pass** (37 on the same tree on 2026-10-25), the `sort -u` message set is identical to the
  clean-`main` baseline (`bug-audit.md` #11). Neither fix adds a type error.
- `createHTML()`: **708,110 B**, 2 `<script` tags, 1 `<style>` — page size unchanged by a
  server-only fix.
- Live smoke on `wrangler dev` (port 8787):

| Request | Result |
| --- | --- |
| `GET /free` | `200`, 708,161 B, `Set-Cookie: yvs_free=1`, `__PLAN_MODE = "freemium"` |
| `GET /studio` (anonymous) | `302 → /free` |
| `GET /api/credits` (guest cookie + `CF-Connecting-IP`) | `200`, `usertype:"guest"`, `scope:"ip"`, `remaining.images:10` |
| `GET /api/config/workers` | `200 {"success":true,"urls":[]}` |
| `GET /image/gen` (guest) | local `500` (AI binding is remote-only); credit refunded, identity intact |

---

## 7. Files changed in this session

| File | Change |
| --- | --- |
| `src/index.ts` | `creditRefundKey(env, key, kind, amount = 1, meta = null)` + guest call site (4 lines); KV-less guards in `GET`/`POST /api/config/workers` (30 lines) |
| `system-rules.md` | register marked resolved + §6 (additional drift); RULE 3 caveat; header revision note |
| `README.md` | documentation index |
| `userflow.md` | route table note |
| `bug-audit.md`, `kv-scale-test.md`, `bug-fix-session-206.md`, `src/page.ts` | the prose corrections from the same pass |
| `bug-fix-session-211.md` | this document |

---

## 8. Follow-ups (not done here)

- **`/image/gen` still fails open on a KV error.** The credit gate is wrapped in
  `try { … } catch { /* never block */ }`, so a KV read failure permits an unmetered generation.
  That is a deliberate availability trade-off (the pre-credits Worker had no gate at all), but if
  the quota ever becomes a billing control it should fail closed with a `503`.
- **No TTL on `session:` keys** and **no atomic claim for render jobs** are pre-existing and
  documented in `bug-audit.md` #3 and #7; this session did not touch them.
- **The register is the audit trail, not a changelog.** Future passes should append a new
  numbered session document instead of rewriting resolved entries.

---
---

# Bug Fix Session #211 — second pass

**Date:** 2026-10-25
**Branch:** `arena/4abf8a53-text-to-image-template`
**Scope:** the editor and Quick-batch-table corrections of this session (delete-icon proportions,
a per-video lock on the manual AI-image button, three simultaneous table rows, finished rows never
re-run, and two new per-row columns: **Resolution** and **Orientation**), plus the
code-vs-documentation register at `toberesolved.md`.

> The first pass above (2026-10-23) fixed two Worker defects found by an audit. This second pass is
> a **different work item** that happens to carry the same session number; nothing in it touches
> the credit/refund logic or the KV-less guards described above. The branch, not the session number,
> is what ties it to a checkout.

---

## 1. What was asked

1. A **code-vs-documentation inconsistency register**, built by reading the whole codebase first,
   with the **code as the source of truth** and the Markdown files referenced (not rewritten)
   where they disagree — `toberesolved.md`.
2. **Editor:** on the image gallery of every accordion, the delete button is **30 % smaller in
   font-size** and its red shape gets **30 % less padding**.
3. **Editor:** while the images of a video's **script & style modal** are generating, that video's
   **✦ Generate 2 Images** button is disabled — but **other videos' accordions may still generate
   at the same time**.
4. **Quick batch table:** debug why generation felt sequential and make **at least 3 rows run
   simultaneously**.
5. **Quick batch table:** never re-process a row that already has a live **Preview** button.
6. **Quick batch table:** add a **Resolution** column (480 / 540 / 720 … px, passed into the image
   prompt generation) and an **Orientation** column (square / landscape / portrait).
7. Fix all of it without breaking anything else, test everything, and record it here.

---

## 2. Fix 1 — the gallery delete badge is 30 % smaller again

`src/client/styles.ts`, `.va-card-remove` (the ✕ on every accordion image card):

| Property | #243 (before) | #211 (now) | Change |
| --- | --- | --- | --- |
| `font-size` | `0.5rem` | `0.35rem` | −30 % |
| badge box (the red shape) | `12 × 12 px` | `8.4 × 8.4 px` | −30 % |
| `padding` | `0` | `0` | the original 2 px padding of the 20×20 badge was already scaled away in #243, so the **badge box itself carries the 30 % padding reduction** |
| glyph centring | inline text | `display:flex` + `align-items/justify-content:center` | so the smaller circle still reads as one target |

The rule sits after the accordion button rules, so all seven themes inherit it (no per-theme
override existed for this selector, and none was added). `tests/studio-ui-session-243.test.mjs`
pinned the old `12px`; it now pins **8.4px + 0.35rem + padding 0 + the red background**, so the
suite documents the new proportions instead of blocking them.

## 3. Fix 2 — the manual AI button is locked per video, never globally

The walkthrough (`confirmSeoStyleAndGenerate` → `startImagePromptFlow` → `runImageBatch`) owns
`/api/image-batch` for its video. The accordion's own **✦ Generate 2 Images** button
(`#va-ai-btn-<n>`) used to stay live, so a click during the flow opened a **second** stream into the
same gallery and spent the same credits twice.

```
setVaAiGenerateEnabled(n, enabled)            // new helper next to setVaUploadEnabled()
  startImagePromptFlow(n)        -> setVaAiGenerateEnabled(n, false)   // before the first await
  finalizeImagePromptFlow(n)     -> setVaAiGenerateEnabled(n, true)    // every exit path ends here
  submitAiImages(n)              -> returns early + status line while project._imageFlowActive
```

- The lock is **strictly positional**: only `va-ai-btn-<n>` is touched, so Video 2 (or Video 10)
  keeps a live button and may generate its own images while Video 1's walkthrough renders.
- A disabled button does not fire clicks, but the guard inside `submitAiImages()` also covers a
  programmatic/keyboard call; it writes
  *"The script & image-style window is generating this video's AI images — the manual button
  unlocks when it finishes."* into that video's status line.
- Re-enabling happens exactly once, in `finalizeImagePromptFlow()`, which is reached by the
  no-images-left branch, the prompt-failure branch and the normal end of the batch — so the button
  can never stay stuck disabled.

## 4. Fix 3 — why the table was sequential, and the three-lane run

**Diagnosis.** `generateBatchRows()` awaited one row after another:

```js
for (const row of targets) {
    if (!batchRunBusy) break;
    if (await runBatchRow(row)) finished += 1;
}
```

Every `runBatchRow()` is four sequential network waits (`/api/voiceover` → `/api/image-prompts` →
`/api/image-batch` → slide decode). The loop had **no** `Promise.all`, no lane pool and no shared
queue, so a ten-row table paid 4 × 10 waits even though the browser, the Worker and the credit
ledger can serve several rows at once. The only thing that ever overlapped was inside one
`/api/image-batch` request (4 images in parallel, worker side).

**Fix.** `BATCH_RUN_CONCURRENCY = 3`, one shared queue, `Promise.all` over the lanes:

```js
const queue = targets.slice();
const lane = async () => {
    while (batchRunBusy && queue.length) {
        const row = queue.shift();
        if (!row || row.running) continue;
        row.running = true;
        try { if (await runBatchRow(row)) finished += 1; }
        finally { row.running = false; }
    }
};
await Promise.all(Array.from({ length: Math.min(3, queue.length) }, lane));
```

- Each row keeps its own `controller`, `objectUrls`, `images`, `slides` and status cell, so three
  pipelines never write to each other's state; the DOM patches stay per row
  (`setBatchStage` uses `[data-batch-row="<id>"]`).
- Lanes pull work, so a finished row immediately hands its slot to the next pending row (no
  wave-by-wave batching) and a table of 1 or 2 rows simply runs 1 or 2 lanes.
- `stopBatchRows()` clears `batchRunBusy` (all lanes exit at the top of their loop) and aborts every
  live `row.controller`; the toolbar label became **■ Stop generating** (it said *Stop after the
  current row*, which was only true for one lane).
- A failed row still fails alone: it is marked `stage = "error"` and is *pending* again, so the next
  Generate retries it.

## 5. Fix 4 — a finished row is never generated again

`batchRowPending(row)` is the new single predicate for "needs work":

```js
batchRowHasScript(row) && !batchRowFinished(row) && !row.running
```

`batchRowFinished()` (`mp3 && images.length && animated && slides.length`) is exactly the same
condition that enables the Preview and Export buttons, so **a row whose Preview button is live is
by definition skipped**. Pressing ✦ Generate again with nothing pending shows
`showRequiredModal(["Every row with a script is already finished — its Preview and Export buttons
are live. …"])` instead of starting a run, and the row keeps its in-memory MP3/images/animation
(no new credits, no wasted voiceover). A row that is mid-run is skipped too (`row.running`), so a
second click can never double-charge a live row.

Note that the toolbar count (`#batch-note`, `✦ Generate (N)`) still counts *scripted* rows: the
button stays clickable after a run and explains itself on the next press rather than silently
disabling. Clear a finished row's script to make it runnable again.

## 6. Fix 5 — Resolution and Orientation columns

### 6.1 Client

Two new cells between **Min** and **Preview**:

| Column | Control | Values | Default |
| --- | --- | --- | --- |
| Resolution | `select[data-batch-field="resolution"]` | `480px` · `540px` · `720px` · `1024px` (**long edge**) | `1024` |
| Orientation | `select[data-batch-field="orientation"]` | `Square 1:1` · `Landscape 16:9` · `Portrait 9:16` | `landscape` |

The row also carries `row.resolution` / `row.orientation`, written back by `syncBatchRowInput()`
from **both** the `input` and `change` events (selects are inconsistent across browsers), and the
small hint under the select is rewritten by `refreshBatchRowFrame()` to the exact pixels
(`W×H`). `batchRowDimensions(row)` mirrors the worker's maths, so the hint, the preview canvas and
the real render can never disagree:

| Resolution | landscape 16:9 | portrait 9:16 | square 1:1 |
| --- | --- | --- | --- |
| 480 | 480 × 272 | 272 × 480 | 480 × 480 |
| 540 | **544** × 304 | 304 × 544 | **544 × 544** |
| 720 | 720 × 408 | 408 × 720 | 720 × 720 |
| 1024 | 1024 × 576 | 576 × 1024 | 1024 × 1024 |

540 is not a multiple of 8 (SDXL's requirement), so the long edge lands on 544 and the hint says so.

### 6.2 Both image calls carry the frame

```
POST /api/image-prompts {topic, minutes, style, resolution, orientation, script}
POST /api/image-batch  {prompts, resolution, orientation}
```

`src/modules/image-batch.ts` gained the single source of truth:

```ts
export const IMAGE_RESOLUTIONS = [480, 540, 720, 1024] as const;
export const IMAGE_ORIENTATIONS = ["square", "landscape", "portrait"] as const;
export function imageFrameFor(resolution, orientation): {resolution, orientation, width, height}
export function sanitizeImageFrame(body): ImageFrame | { error: string }
```

- `handleImageBatch()` validates the two optional fields **before** spending credits
  (`400` for `resolution: 999` or `orientation: "diagonal"`), threads the frame into
  `generateOneWithRetry()` → `runImageModel({width, height})`, and echoes
  `width/height/resolution/orientation` in the `start` event and the server log. Missing fields
  keep the historical 1024×576 landscape frame, so every existing caller is untouched.
- `src/modules/image-prompts.ts` validates the same fields, returns them in the JSON and writes a
  **FRAME** paragraph into the prompt instruction — so the scene is *composed* for the shape, not
  just cropped into it:
  - portrait → *"Compose vertically: a tall subject or vertical leading lines, the focal point in
    the lower or middle third … no wide panoramic detail."*
  - square → *"Compose for a square crop: one centred focal point, generous negative space … nothing
    important in the extreme corners."*
  - landscape → *"Compose wide: keep the subject laterally balanced with headroom …"*
- The preview modal's canvas is now the row's frame instead of a fixed 1024×576.

### 6.3 What the columns deliberately do **not** change

`exportBatchRow()` still renders the MP4 through the studio's shared renderer at the hidden quality
setting (854×480 / 1280×720). The columns control the **AI images** and the **preview**; changing
the export canvas would mean changing the editor's quality contract. This is stated in RULE 25 and
in `toberesolved.md` (B9) rather than left implicit.

## 7. Documentation: `toberesolved.md` + the corrected files

New register (`toberesolved.md`) with **32 findings** in four finding groups — image pipeline (A1-A7), Quick
batch table (B1-B14), editor UI numbers (C1-C8), verification numbers (D1-D3) and the items left
open (E1-E6) — each row naming the document, the quoted claim, what the code really does and the
status. Highlights of what the audit caught **before** it was fixed:

- RULE 6 claimed the AI panel sends "2 **sequential** requests" — the code uses `Promise.all`.
- RULE 6 / RULE 18 / README / userflow promised "480 px landscape" images — the route renders
  **1024×576**; the hint, the placeholder and the success line were all wrong.
- RULE 18's hint inventory still listed two hints that no longer exist anywhere in the live client:
  the **sticker note** (`STICKER_WIDTH = 435`) and the **☁️ API** tooltip (replaced by 🗑 Delete
  Video in #243). `userflow.md` still drew the API button in the accordion header, still drew a
  sticker being composited into the MP4, and still promised a 48×48 px minimum target for every
  accordion button.
- RULE 25 promised a `queued` stage that **no code assigns**, a 1024×576 preview canvas, a row shape
  without the new fields, and a one-row-at-a-time pipeline.
- Four documents quoted stale measurements: "48 `tsc` errors" (**37** on this tree) and
  "75/75 tests" (**79/79** now).

Every affected file was corrected (table in `toberesolved.md` §7), and the six items that are
genuinely still inconsistent are listed openly in §5 — dead constants (`AI_IMAGE_WIDTH` /
`AI_IMAGE_HEIGHT`), the `VIDEO_BATCH_SIZE` comments, the hidden `#gallery` demo fetches, the
UI-less `/api/render` module, the duplicated `render-app-tts.zip` and the dead
`src/index.ts.original` that older documents still quote.

## 8. Verification

| Check | Result |
| --- | --- |
| `npm test` | **79 tests, 79 pass** (75 before; 4 new cases) |
| New: `three rows render at the same time, and a finished row is never generated twice` | 5 scripted rows → `maxInFlight === 3` on `/api/voiceover`, 5 voiceovers total; a second Generate adds **0** requests and shows the "already finished" modal; every row keeps both live buttons |
| New: `the resolution and orientation columns travel with both image calls` | 720 px portrait row → `/api/image-prompts {resolution:720, orientation:"portrait"}` **and** `/api/image-batch {resolution:720, orientation:"portrait"}`; `batchRowDimensions()` = 408×720; select `change` writes back to the row |
| New: `the worker validates the frame and writes it into every scene prompt` | `imageFrameFor()` for all four sizes and three orientations (incl. 540 → 544), `sanitizeImageFrame()` rejects 999 / "diagonal", instruction contains `FRAME: … PORTRAIT frame at 408x720 px (720 px long edge)` + `Compose vertically` |
| New: `the accordion's Generate AI Image button is locked only while its own walkthrough renders` | Video 1 locked, Video 2 live during the flow; `submitAiImages(1)` refused with the unlock message; Video 1 unlocked after `finalizeImagePromptFlow()` |
| `tests/studio-ui-session-243.test.mjs` | now pins `.va-card-remove` at 8.4 px / 0.35rem / padding 0 |
| `npx tsc --noEmit` | **37 errors** — identical to the `HEAD` baseline (no new type error; all in pre-existing `src/index.ts` code) |
| `createHTML()` | **1,909,415 B**, 2 `<script`, 1 `<style>` (page assembly unchanged in shape) |
| Live smoke, `wrangler dev --local --port 8792` | `/` `200` · `/free` `200` · `/studio` `302` · `/paid` `302` · `/api/config/workers` `200` · `POST /api/image-prompts` with `resolution:999` → `400 "Resolution must be one of 480, 540, 720 or 1024 (pixels, long edge)"` · anonymous `POST /api/image-batch` → `401` · signed-up cookie + `orientation:"diagonal"` → `400` · `{prompts:["a cat"], resolution:720, orientation:"portrait"}` → `200 application/x-ndjson` with `start {width:408, height:720, resolution:720, orientation:"portrait"}`, one honest `image{ok:false,"Binding AI needs to be run remotely"}` (local dev has no AI binding) and a `done` that **refunded** the credit · `/api/image-prompts` with a valid frame → `502` from the unsupported local binding (frame echo `resolution:480, orientation:square` in the log) |

## 9. Files changed in this pass

| File | Change |
| --- | --- |
| `src/client/styles.ts` | `.va-card-remove` 8.4 px / 0.35rem / flex-centred (Fix 1); `.batch-col-resolution` + `.batch-col-orientation` widths, the two new selects in the input rule, column widths rebalanced |
| `src/client/app-js.ts` | `setVaAiGenerateEnabled()` + lock/guard (Fix 2); `BATCH_RUN_CONCURRENCY`, `batchRowPending()`, three-lane `generateBatchRows()`, `row.running`, Stop label (Fix 3/4); `BATCH_RESOLUTIONS` / `BATCH_ORIENTATIONS` / `batchRowDimensions()` / `refreshBatchRowFrame()`, two row cells, `change` listener, frame fields on both image calls, framed preview canvas (Fix 5); corrected AI-panel copy + comments |
| `src/client/markup.ts` | two new `<th>` (Resolution, Orientation), updated hint + Generate tooltip + block comment |
| `src/modules/image-batch.ts` | `IMAGE_RESOLUTIONS` / `IMAGE_ORIENTATIONS` / `imageFrameFor()` / `sanitizeImageFrame()`, frame validation + per-image `width/height` + `start` event fields |
| `src/modules/image-prompts.ts` | frame validation, frame in the response, `FRAME` paragraph in the prompt instruction |
| `tests/quick-batch-table.test.mjs` | 4 new cases (lanes + skip, columns, worker frame, per-video lock) |
| `tests/studio-ui-session-243.test.mjs` | delete-badge assertion updated to 8.4 px / 0.35rem |
| `system-rules.md`, `README.md`, `userflow.md`, `quick-batch-table-system-requirements.md`, `bug-fix-session-242.md`, `bug-audit.md`, `bug-fix-session-206.md`, `bug-fix-session-211.md`, `script-keyword-retry-debug.md` | the prose corrections listed in `toberesolved.md` §7 |
| `toberesolved.md` | the new inconsistency register |

## 10. Follow-ups (not done here)

- **One export frame for every row.** The new columns size the AI images and the preview, not the
  MP4 canvas (still the studio quality setting). If a row should export at its own frame, the
  renderer's `quality` contract has to grow a per-row override first (`toberesolved.md` B9).
- **Worker-side row parallelism costs credits three times as fast.** Three lanes consume the daily
  image allowance in a third of the wall-clock time; the batch route still refunds per failed
  scene, but a 10-row table on the free plan can now exhaust 50 images in one press. The credit
  gate is unchanged on purpose.
- **Dead code stays documented, not deleted.** `AI_IMAGE_WIDTH` / `AI_IMAGE_HEIGHT`,
  `VIDEO_BATCH_SIZE`, the `/api/render` module and `src/index.ts.original` are still in the tree
  (`toberesolved.md` §5). They are audit items, not this session's work.
