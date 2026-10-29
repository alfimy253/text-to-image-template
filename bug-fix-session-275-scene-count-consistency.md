# Bug Fix Session #275 — "Scene keyword planner returned the wrong scene count"

> **Media-source rule unchanged.** Pixabay photos/videos only, two video scenes per automatic
> video, no AI image generation. See [pixabay-media-migration.md](pixabay-media-migration.md).

**Date:** 2026-10-29 · **Branch:** `arena/c8f2545b-text-to-image-template`
**Scope:** the automatic Pixabay media flow (Quick Batch + editor), `POST /api/image-prompts`
and the scene-count rule in every document that states it.

---

## 1. Symptom

The studio stopped a video with:

> `Stock search terms could not be generated or rendered: Scene keyword planner returned the wrong scene count`
> `0 image(s) added to the gallery. Upload Image, GIF or MP4 is enabled again.`

The message is produced by `generateImagePrompts()` in `src/modules/image-prompts.ts`, and the
flow always retries three times (`batch.attempt` 0–2) before giving up.

## 2. Deep debug — what the code actually did

### 2.1 Where the count comes from (before #275)

| Side | Function | Total for a 1-minute video |
| --- | --- | --- |
| Worker | `imagePromptCountForMinutes(minutes)` | 10 (14 for 2–3 min, 20 for 4–6 min) |
| Browser | `imageSceneTarget(minutes)` (in `src/client/progressive-image-pipeline.ts`) | the same 10/14/20 |
| Editor | `Math.min(imageSceneTarget(minutes), availableImages + 2)` | 10 **or less**, sent as `sceneTotal` |
| The model | whatever it decided while reading the script | frequently 6–12 |

Four different opinions about one number. The Worker then demanded

```ts
const scenes = selectPlannedScenesForSlots(planned, slots, total, offset, count);
if (scenes.length !== count) throw new Error("Scene keyword planner returned the wrong scene count");
```

and `selectPlannedScenesForSlots()` only accepted a reply whose length was **exactly `count`** or
**exactly `total`** (plus an explicit `.scene` echo). Any other length fell through to
`return planned` and died on the count check above.

### 2.2 Reproduced failure matrix (pre-fix)

`bench/planner-count-audit.mjs` drives `generateImagePrompts()` with every realistic reply shape
for each total and each chunk offset. Before the fix:

```
total=10 offset=0 count=3
  chunk-exact=ok        chunk-relative=ok      whole=ok      no-scene-numbers-whole=ok
  whole+1=THROW wrong scene count    whole+2=THROW wrong scene count
  whole-1=THROW wrong scene count    whole-2=THROW wrong scene count
```

An 8B model that returns the **whole plan** with 8, 9, 11 or 12 scenes for a 10-scene video —
the single most common llm behaviour in the #272/#273 logs — could never satisfy the request,
no matter how good its search terms were. Two related dead ends:

* a **truncated** reply that salvaged 2 of 3 scenes threw (`wrong scene count`) and the whole
  video was abandoned even though the two scenes were valid;
* a chunk reply that **renumbered** its own scenes (`0,1,2` on the second chunk) or slipped one
  extra entry in front of the requested slots produced a mis-aligned slice or a media-type
  failure.

### 2.3 The count rule itself

The documents said 10/14/20 **per duration**, and every planner instruction said
`"EXACTLY 10"` for a 1-minute video. Nothing derived the count from the narration, so a short
script (a 5-word test row, a 90-word quick-batch script) still asked for ten scenes, and the
browser could clamp to a smaller `sceneTotal` that the model had never been told about.

## 3. Fixes

### 3.1 One word-count rule, two implementations, zero drift

`src/modules/image-prompts.ts`:

```ts
SCENE_COUNT_WORD_BRACKETS = [{ maxWords: 130, scenes: 6 },
                             { maxWords: 240, scenes: 8 },
                             { maxWords: 500, scenes: 10 }]
countScriptWords(script)      // Unicode word finder; SRT cue numbers/WEBVTT/--> ignored
sceneCountForScript(script)   // <=130 -> 6, <=240 -> 8, <=500 -> 10, more -> 10
sceneCountCeiling(script, minutes)
resolveSceneTotal(input)
```

`src/client/progressive-image-pipeline.ts` mirrors it exactly with
`imageScriptWordCount()` / `imageSceneTarget(script, minutes)` (the JS lives inside a template
literal, so the word test is built without inline `\p{...}`/`\u` escapes). Both sides now return
the same number for the same script — pinned by a parity test that evaluates the browser string
in a `vm` context and compares it with the Worker functions for 14 script lengths × 3 durations.

`imagePromptCountForMinutes()` (10/14/20) remains exported for legacy callers and acts only as a
**ceiling**; it can never raise the word-count total.

### 3.2 Deterministic reconciliation instead of an exact-length gate

`selectPlannedScenesForSlots()` now builds candidates in priority order and takes the first one
that fills every slot (unique entry, requested media type, 1–5 word search term):

1. explicit `.scene` numbers (global ids, or chunk-relative `0..count-1`),
2. a whole-video plan of exactly `total` (slice by offset — the old behaviour),
3. a whole-video plan of **any other length** — proportional mapping
   `round(scene * (L-1) / (total-1))`, de-duplicated, plus a variant that swaps in the nearest
   unused entry of the required media type,
4. a chunk-relative slice (`planned[offset..]` when the model echoed earlier scenes),
5. a greedy in-order same-type subsequence,
6. the reply's own order.

If nothing fills the chunk, the **longest valid prefix** is returned. `generateImagePrompts()`
therefore only throws when the reply contains no usable scene at all:

| Reply | Before | After |
| --- | --- | --- |
| whole plan, exact total | ok | ok |
| whole plan, ±1 / ±2 / ±3 scenes | `wrong scene count` | ok — mapped onto the requested slots |
| chunk renumbered `0,1,2` | mis-aligned or type error | ok — aligned to the requested offsets |
| truncated reply (2 of 3 valid scenes) | `wrong scene count`, video abandoned | 2-scene batch, browser continues at the next offset |
| `{"scenes":[]}` | `wrong scene count` | `wrong scene count` (unchanged) |
| no JSON at all | `invalid JSON` | `invalid JSON` (unchanged) |
| empty answer | `empty reply` | `empty reply` (unchanged) |
| entries with 6+ word prose | media-type/count error | `must return concise 1-5 word search terms` |
| all-image reply for a video slot | type error | `must return search keywords for the assigned media types` |

Media types stay **server-controlled**: a slot never silently becomes the other kind, so the
"exactly two distinct clips" guarantee is untouched.

### 3.3 The instruction now says what a `keywords` value is

`buildStockSearchInstruction()`:

* `Each "keywords" value is a SHORT STOCK SEARCH TERM of 1-5 words … the words a person would
  type into the Pixabay search box.`
* `Write search terms, NOT image prompts: no sentences, art direction, camera or lens
  instructions, mood paragraphs, style words, negative prompts or invented details.`
* `The COMPLETE video is EXACTLY <total> scenes because the script is <N> word(s) long — never
  plan one scene per script paragraph and never change the total.`
* `SEO search terms for this video (reuse their subject words when they fit the scene …)` —
  the selected set's **long-tail keyword plus its four short keywords** are passed as search
  vocabulary (context only, never rendered).
* The retry line repeats the 1–5 word contract.

`cleanSceneKeywords()` enforces the same limit (`SCENE_KEYWORDS_MAX_WORDS = 5`,
`SCENE_KEYWORDS_MAX_CHARS = 100`), so a pasted art prompt can no longer become a Pixabay query.
`scorePlanCandidate()` scores with the same validator, so a prose plan can no longer out-rank a
real keyword plan during JSON recovery.

### 3.4 Client call sites

`imageSceneTarget(row.script, row.minutes)` in Quick Batch (pipeline total + progress copy) and
`imageSceneTarget(project.script || "", project._seoMinutes || 1)` in the editor, whose
`sceneTotal` still clamps to the free gallery slots. The editor note now explains the word-count
rule instead of "10 for 1 minute, 14 for 2–3 minutes, 20 for 4–6 minutes".

## 4. Rules now documented

| Script words | Scenes | Photos + clips |
| --- | --- | --- |
| ≤ 130 | **6** | 4 + 2 |
| > 130 and ≤ 240 | **8** | 6 + 2 |
| > 240 and ≤ 500 | **10** | 8 + 2 |
| > 500 | **10** (the rule set ends at ten) | 8 + 2 |

* Words are counted from the narration text (cue numbers, `WEBVTT`, `-->` timestamps and
  punctuation-only tokens are ignored).
* Two of the scenes are always Pixabay videos at zero-based `1` and `total - 2`; the rest are
  photos. The clips are inside the total, not added on top.
* A caller may ask for **fewer** scenes (editor gallery room, minimum four) but never more than
  the script's rule allows; `sceneTotal` above the limit is a `400`.
* Every `keywords` value is a **1–5 word search term**, not an image prompt.

Updated documents: `system-rules.md` (governing media rule + the batch/progressive section),
`pixabay-media-migration.md` (planner contract, totals, reconciliation, Quick Batch step 2),
`README.md` (media direction, walkthrough totals, `/api/image-prompts` row),
`userflow.md`, `quick-batch-table-system-requirements.md`, and a supersession note in
`new_requirements.md`.

## 5. Verification

* `node --import tsx bench/planner-count-audit.mjs` — **90/90 ok** across totals 6/8/10 and every
  chunk offset (pre-fix: 20 `wrong scene count` throws in the same matrix).
* `npm run test:pixabay` — **60/60** (`pixabay-media` 46, `pixabay-studio-flow` 14,
  `session-264-editor-render` 10). New coverage:
  * scene-count brackets, SRT word counting and the `>` 500-word cap,
  * route-level `expectedCount` / video-slot positions for 6 / 8 / 10, smaller total accepted,
    larger total `400`,
  * the whole-plan-off-by-N matrix (6/8/10 totals × every offset × every length), scene numbers
    glued to the requested slots, unique search terms per slot,
  * renumbered chunk replies,
  * 1–5 word instruction text + SEO keyword pass-through + 6-word prose rejection,
  * browser/Worker word-count parity (14 script lengths × 3 durations),
  * studio flows updated to the 6-scene rule, including the transient-failure retry path.
* `npx tsc --noEmit` — only the 30 pre-existing `src/index.ts` router diagnostics.
* Per-file comparison against the pre-change baseline shows **no new failures** anywhere in the
  suite; the two additions are the new tests (`pixabay-media` 42 → 46,
  `progressive-image-pipeline` 11 → 12 passing; the 2 legacy prompt-string failures there are
  unchanged).

## 6. Operator notes

* A remaining `wrong scene count` now really means "the model returned no usable scene"; the
  route still answers `502 {kind:"transient"}` so the browser retries twice.
* A short batch is normal and logged as `[image-prompts] partial scene plan {offset, requested,
  accepted, planned, total}`; the browser continues from `offset + accepted` and keeps the media
  it already imported.
* Short scripts now cost fewer Pixabay searches: a 90-word script plans 6 scenes (6 searches)
  instead of 10.
