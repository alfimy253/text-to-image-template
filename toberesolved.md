# To Be Resolved — code vs documentation inconsistency register

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

> **Audit date:** 2026-10-25 (re-checked 2026-10-26) · **Branch:** `arena/4abf8a53-text-to-image-template`
> **Rule of this document:** the **code is the source of truth**. Where a Markdown file, a code
> comment or a user-visible hint disagrees with the working tree, the code wins and the prose is
> listed here with the evidence that settles it.
> **Session records:** `bug-fix-session-211.md` (second pass, 2026-10-25) and
> `bug-fix-session-244.md` (2026-10-26 — silent in-row retries, fixed table layout, one CMS delete
> path, three separate credit pages).
> **Canonical rules:** `system-rules.md`. **Actor flows:** `userflow.md`. **User-facing summary:**
> `README.md`.

---

## 0. How this register was built

1. Read the whole tree: `src/index.ts`, `src/page.ts`, `src/prompts.ts`, every `src/modules/*`
   file, `src/client/{app-js,styles,markup,config-page-js,template-composer-js,template-scene-editor}.ts`,
   the `tests/*.test.mjs` suites and the seven Markdown documents at the repository root.
2. For each claim that could be checked mechanically, the claim was grepped against the code:
   constants (`BATCH_RUN_CONCURRENCY`, `IMAGE_WIDTH`, `STICKER_*`, `MAX_*`), route bodies, DOM ids
   and CSS selectors, plus `npx tsc --noEmit` and `npm test` for the verification claims.
3. Every finding below was reproduced on the **working tree before the fix pass** (the quoted
   document text) and re-checked **after** it (the "code does" column always describes the final
   state).
4. Where the code was wrong, the code was fixed; where the prose was wrong, the prose was fixed.
   Nothing was resolved by deleting a working feature.

Status legend: **Fixed** = code + prose now agree, **Prose fixed** = only the document was wrong,
**Open** = still inconsistent, deliberately left for a later session.

---

## 1. Image pipeline (accordion AI panel + prompt/batch routes)

| # | Where | The document said | What the code actually does | Status |
| --- | --- | --- | --- | --- |
| A1 | `system-rules.md` RULE 6, "Client behaviour" | "each submit is **2 sequential requests** (`variant` 1 and 2)" | `submitAiImages()` builds the variant list and fires **both** requests through `Promise.all` — 2 parallel calls, 1 summary line | Prose fixed |
| A2 | `system-rules.md` RULE 6, restriction | "no `width`/`height` parameters are sent … the *480 px landscape* size is a client display/format promise" | `runImageModel()` in `src/modules/image-batch.ts` always sends `width: IMAGE_WIDTH (1024)` / `height: IMAGE_HEIGHT (576)`; `/image/gen` uses the same helper | Prose fixed |
| A3 | `system-rules.md` RULE 18 hint inventory, `README.md` hint table, `userflow.md` §4 + §4.1 B | hint `2 images per submit · 480px landscape`, status `Done — 480px landscape`, preview "480 px landscape" | the hint now reads **`2 images per submit · landscape 16:9 · 1024×576`** (placeholder and success line updated too), because that is the size the route really returns | Fixed |
| A4 | `src/client/app-js.ts` comment above `AI_IMAGE_WIDTH` | "DISPLAY size … 480px landscape" **and** "832x480, 16:9" (two different numbers in the same block) | neither number is a rendered file; the route renders 1024×576. The comment now says so, and names `toberesolved.md` | Prose fixed |
| A5 | `src/client/app-js.ts` `AI_IMAGE_WIDTH = 854` / `AI_IMAGE_HEIGHT = 480` | implied to be the generated size | **dead constants**: nothing reads them (only `index.ts.original` mirrors them). Left in place, documented as dead code | Open (see E1) |
| A6 | `src/client/styles.ts` `.va-ai-img` | `aspect-ratio: 854 / 480` | the returned PNG is 1024×576 (= 16/9). 854/480 = 1.7792 vs 1.7778 — a 0.08 % crop, invisible but not the real ratio | Open (cosmetic) |
| A7 | `system-rules.md` RULE 6 (demo slots) | `/image/:index` is still fetched twice per page view into the hidden gallery | confirmed in code (`prompts.forEach((_, index) => fetchAIImage(index))`) — the document and the code agree; listed only because two Workers AI generations per page view are burned on an invisible element | Open (documented waste) |

## 2. Quick batch table (`#view-table`)

| # | Where | The document said | What the code actually does | Status |
| --- | --- | --- | --- | --- |
| B1 | `system-rules.md` RULE 25, "Pipeline (`runBatchRow`, one row at a time behind `batchRunBusy`)" | rows run **one at a time** | `generateBatchRows()` starts `BATCH_RUN_CONCURRENCY = 3` lanes that pull from one pending queue (`batchRowPending()`); a lane takes the next row as soon as it finishes | Fixed |
| B2 | `quick-batch-table-system-requirements.md` §3.4.1 | "**One row at a time, sequentially**" | three rows render simultaneously (and the next starts immediately) | Prose fixed |
| B3 | `userflow.md` §16.2 | "`generateBatchRows()`: sequential, guarded by `batchRunBusy`" | three lanes behind one `batchRunBusy` | Prose fixed |
| B4 | `bug-fix-session-242.md` (batch summary) | toolbar reads "■ **Stop after the current row**"; "`generateBatchRows()` is sequential" | the label is **■ Stop generating** and the run is three lanes; the historical record now says when it changed | Prose fixed |
| B5 | `system-rules.md` RULE 25, stage machine | `empty → ready → queued → voice → …` | **no code ever assigns `stage = "queued"`**; `BATCH_STAGE_LABELS.queued` and its colour rule exist, a row goes `ready → voice` when a lane picks it up. RULE 25 now documents the dead label | Prose fixed |
| B6 | `system-rules.md` RULE 25, row shape | `{id, script, style, minutes, stage, …}` | the row also carries **`resolution`**, **`orientation`** and **`running`** (plus everything the list already had) | Fixed |
| B7 | `system-rules.md` RULE 25, "Preview" | "1024 × 576 canvas" | the modal canvas is sized from `batchRowDimensions(row)` (e.g. 408×720 for 720 px portrait) | Fixed |
| B8 | `quick-batch-table-system-requirements.md` §3.2 memory row | "~10 rows × 14–20 images at 1024×576" | 10–20 prompts per row and the frame comes from the row (480–1024 px long edge); up to three rows generate at once | Prose fixed |
| B9 | `system-rules.md` RULE 25 (export) | export described as if it matched the table's images | `exportBatchRow()` renders at the studio's hidden quality setting (854×480 / 1280×720), **not** at the row frame. Now documented as a known limit (the new columns control the AI images + the preview) | Prose fixed |
| B10 | `system-rules.md` RULE 18, `README.md`, `userflow.md` §16.2 | Generate "runs every row that has a script" | Generate runs every row that has a script **and is not finished**; with nothing pending it shows `Every row with a script is already finished …` instead of starting | Fixed |
| B11 | `system-rules.md` RULE 18 hint inventory + the `#batch-generate` tooltip | "Generate every row that has a script: voiceover, AI images and the animation" | tooltip and hint now carry the skip + "three rows at a time" wording | Fixed |
| B12 | `quick-batch-table-system-requirements.md` §1 column table | 5 columns + ✕ (Script, Style, Min, Preview, Export) | 7 columns: Script, Style, Min, **Resolution**, **Orientation**, Preview, Export (+ ✕ in the script cell) | Fixed |
| B13 | `userflow.md` §16.2, `quick-batch-table-system-requirements.md` §1 | `POST /api/image-prompts {topic, minutes, style, script}` and `POST /api/image-batch {prompts}` | both bodies carry **`resolution`** and **`orientation`**; the worker validates them (`imageFrameFor()`, `sanitizeImageFrame()`) and `buildImagePromptInstruction()` writes a `FRAME:` paragraph into every scene prompt | Fixed |
| B14 | `src/client/app-js.ts` comments around `VIDEO_BATCH_SIZE = 2` (bulk queue) | "Batches of `VIDEO_BATCH_SIZE`: each video fully finishes before the next starts" — self-contradictory, and the loop never reads the constant | `runGenerationQueue()` is strictly `for n = 1 … N` sequential. RULE 14 documents the mismatch accurately; the **comments** are the inconsistent text | Open (E2) |

## 3. Editor (accordion) UI numbers

| # | Where | The document said | What the code actually does | Status |
| --- | --- | --- | --- | --- |
| C1 | `system-rules.md` RULE 27 | `.va-card-remove` is "**12×12**, inset 1.2 px, `padding: 0`, `font-size: 0.5rem`" | **8.4 × 8.4 px**, inset 1.2 px, `padding: 0`, `font-size: 0.35rem`, ✕ centred by flex — 30 % off the type and 30 % off the red badge on top of #243's 40 % | Fixed |
| C2 | `tests/studio-ui-session-243.test.mjs` (test as documentation) | asserted `width: 12px` / `height: 12px` for `.va-card-remove` | the assertion now pins 8.4 px + 0.35rem, so the suite documents the current size instead of blocking it | Fixed |
| C3 | `system-rules.md` RULE 18 hint inventory | still listed `White 435 × 150 rectangle …` with `STICKER_WIDTH` / `STICKER_HEIGHT` | the live client has **no** sticker note and no `STICKER_*` constant (they exist only in the dead `src/index.ts.original`); RULE 27 already said stickers were removed. The row was deleted | Prose fixed |
| C4 | `system-rules.md` RULE 18 hint inventory | still listed the `☁️ API` tooltip "Send all of this video's elements to the render API" | the live client renders **🗑 Delete Video** in that slot; the string survives only in `src/index.ts.original`. The row was deleted and `userflow.md` §5/§6/§10 now marks the old flow as historical | Prose fixed |
| C5 | `userflow.md` §4 | "every button in the accordion … has a minimum 48 × 48 px target, 12px 24px padding and 1rem type" | three deliberate exceptions: the AI-card **+ Add to Video / Fullscreen** buttons (0.7rem, 8px 17px) and the gallery **✕** (8.4 px badge). The paragraph now lists them instead of claiming a blanket rule | Prose fixed |
| C6 | `src/client/app-js.ts` comments ("the hidden panels … sticker …") and `styles.ts` ("Sticker / Quality are bare") | a sticker panel is one of the hidden engine panels | the sticker panel was deleted from `markup.ts` in #243; the comments no longer list it | Prose fixed |
| C7 | `system-rules.md` RULE 4 / `userflow.md` §6 | `/api/render` payload `project:{title,font,color,sticker,quality,captions,subtitles}` | `collectVideoPayload()` no longer sends a sticker field and the worker does not read one; the flow diagrams were corrected (the route itself is unchanged and still reachable from the settings page's worker mode) | Prose fixed |
| C8 | `system-rules.md` RULE 6 (AI panel) | nothing locked the manual **Generate 2 Images** button while the script/style walkthrough rendered | new behaviour: the button is disabled for **that video only** (`setVaAiGenerateEnabled()`), `submitAiImages()` refuses a programmatic click, and `finalizeImagePromptFlow()` re-enables it. Other accordions stay live | Fixed (code gained the rule the docs lacked) |

## 4. Verification claims (numbers in the documents)

| # | Where | The document said | What the tree actually does | Status |
| --- | --- | --- | --- | --- |
| D1 | `bug-audit.md` #11, `bug-fix-session-206.md`, `bug-fix-session-211.md` (first pass) | "`tsc` fails with **48** errors on clean `main`" | `npx tsc --noEmit` reports **37** errors on both `HEAD` and the fixed tree (same messages; the count drifts with the tree). All three documents now state 37 for 2026-10-25 and keep the original count as the historical measurement | Prose fixed |
| D2 | `system-rules.md` RULE 27, `quick-batch-table-system-requirements.md` §4, `script-keyword-retry-debug.md` | "`npm test` → **75 / 75**" | **79 / 79** after this pass (4 new cases in `tests/quick-batch-table.test.mjs`) | Prose fixed |
| D3 | `quick-batch-table-system-requirements.md` §4 suite description | "sequential generate" | "three-lane generate, the finished-row skip, the resolution/orientation payloads" | Prose fixed |

---

## 5. Still open after this pass

| # | Item | Why it is still open |
| --- | --- | --- |
| E1 | `AI_IMAGE_WIDTH = 854` / `AI_IMAGE_HEIGHT = 480` in `app-js.ts` are dead, and `.va-ai-img` still uses `aspect-ratio: 854 / 480` | Deleting a public constant / changing a card ratio is a visual decision, not an audit fix. Both are referenced from `bug-audit.md` #16; the comments now state the truth (1024×576 is the rendered size) |
| E2 | The bulk-queue comments describe `VIDEO_BATCH_SIZE = 2` batching that `runGenerationQueue()` never implements | Implementing two-at-a-time rendering in the Editor is a behaviour change nobody asked for; RULE 14 documents the gap honestly. If the Editor should also render two videos at once, that is a future session (the Quick batch table already does three) |
| E3 | `/image/:index` is still fetched twice per page view into the hidden `#gallery` | Two wasted Workers AI generations per load (RULE 6). Removing the call would change the demo route's usage story; left as a documented cost |
| E4 | The `/api/render` + worker-mode path has **no UI entry point** | Deliberate (#243): the module and routes are kept for the settings page's background-worker mode. Documented as historical in `userflow.md` §6 instead of being deleted |
| E5 | `render-app-tts.zip` duplicates `render-app/` | The zip is a distribution artefact; whether it should be regenerated per change is a release question, not a code/documentation mismatch |
| E6 | `src/index.ts.original` is dead but is quoted by three documents as if it were live | Kept on purpose as the pre-split byte reference (RULE 1). Any *new* document must name it explicitly — this register does |
| E7 | `batchStatusText()`'s `⚠ …` branch and the `.batch-row-status[data-stage="error"]` colour rule are now unreachable from the batch table | Session #244 removed the error stage from `runBatchRow` (silent retries + `stage = "ready"`). The branch and the CSS rule are kept because `openBatchPreview()` and older call sites still pass a stage through `setBatchStage()`, and deleting a public status colour is a UI decision. Documented in RULE 25 |
| E8 | The Table tab is still labelled **▦ Bulk grid** in `#view-switch` while the card head reads **Quick batch table** | Carried over from the #242 audit; renaming the tab is a copy decision, and RULE 22 records the mismatch |
| E9 | `BATCH_STAGE_LABELS.queued` / `"Queued"` is still dead copy (nothing assigns `stage = "queued"`; Session #244 parks a failed row on `"ready"` instead) | Same reasoning as E7 — a user-visible string, not a code-vs-doc mismatch; the label is documented as dead in RULE 25 |

---

## 6. Re-running the audit

```bash
# 1. the type baseline (both numbers must match this register)
npx tsc --noEmit 2>&1 | wc -l          # 36 on 2026-10-26 (was 37 on 2026-10-25)

# 2. the behaviour baseline
npm test                               # 89 tests, 89 pass

# 2b. the session #244 contract (silent retries, no abort text, three credit pages)
node --import tsx --test tests/session-244.test.mjs   # 10 tests, 10 pass

# 3. the two claims that broke most often
grep -rn "sequential\|one at a time" *.md          # batch table must say "three lanes" now
grep -rn "480px landscape" src/ README.md userflow.md system-rules.md   # must be empty

# 4. dead-constant check
grep -rn "AI_IMAGE_WIDTH\|STICKER_WIDTH" src/ | grep -v index.ts.original

# 5. the live smoke (wrangler local, no AI binding)
npx wrangler dev --local --port 8787
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/free                     # 200
curl -s -X POST http://127.0.0.1:8787/api/image-prompts -H 'Content-Type: application/json' \
  -d '{"topic":"x","minutes":1,"style":"Cinematic Film","script":"hi","resolution":999}' # 400
```

---

## 7. Documents touched by this pass

| Document | What changed |
| --- | --- |
| `system-rules.md` | revision note; RULE 6 (parallel variants, real 1024×576 size, per-video AI-button lock); RULE 18 (AI-panel copy, batch hint + tooltips, new resolution/orientation hint row, sticker + API rows removed); RULE 25 (three lanes, finished-row skip, frame columns, `running`, dead `queued`, preview canvas, CSS list, export-frame limit); RULE 27 (8.4 px / 0.35rem badge, 79/79) |
| `README.md` | Quick Batch table paragraph, AI Images hint row, new batch column/hint rows, doc index entry for this register |
| `userflow.md` | §4 accordion list (no sticker, real AI hint, locked button), §4.1 B (parallel variants, 1024×576), §5/§6/§10 (API flow marked historical), §16.2 (three lanes, frame payloads, skip-finished, Stop label, preview canvas), button-proportion paragraph |
| `quick-batch-table-system-requirements.md` | column table, pipeline stages with frame fields, constants (3 lanes + resolutions), image model size, memory, §3.4.1/§3.4.1a, row-field audit, verification table, 79/79 |
| `bug-fix-session-242.md` | the two statements the #211 second pass superseded (Stop label, sequential run, preview canvas) |
| `bug-audit.md`, `bug-fix-session-206.md`, `bug-fix-session-211.md`, `script-keyword-retry-debug.md` | the stale `tsc` / test-count measurements |
| `src/client/app-js.ts`, `src/client/styles.ts` | the misleading comments behind A4, C6 (code changes themselves are in `bug-fix-session-211.md`) |
| `tests/studio-ui-session-243.test.mjs`, `tests/quick-batch-table.test.mjs` | assertions updated to the current sizes + 4 new Session #211 cases; the batch-table failure case was rewritten for Session #244 (quiet retries, no error cell) |
| `tests/session-244.test.mjs` | **new**: 10 jsdom checks for the silent retry loop, the editor's loading animation, abort-wording suppression, the fixed table layout, the three credit pages and both CMS delete paths |
| `bug-fix-session-244.md` | **new**: the session record for the four defects above |
| `system-rules.md`, `userflow.md`, `quick-batch-table-system-requirements.md`, `README.md`, `bug-audit.md` | Session #244 pass: RULE 25 (silent retries, fixed layout, stream idle budget), RULE 18 (seven tabs, three credit pages, two delete paths), the flow diagrams, the session index |
| `toberesolved.md` | this register |
