# Bug Fix Session #273 — Scene Keyword Planner Wrong Scene Count Recovery

**Date:** 2026-10-29

## Symptom

Automatic scene planning in the Studio stopped on chunk 0 (`offset: 0, count: 3`) after all 3 bounded browser retries (`attempt` 0–2) with:

> `Stock image flow stopped: Stock search terms could not be generated or rendered: Scene keyword planner returned the wrong scene count 0 image(s) added to the gallery. Upload Image, GIF or MP4 is enabled again.`

## Root Causes

1. **JSON array extraction bug (`extractScenePlanJson` in `src/modules/image-prompts.ts`):**
   - `sliceBalanced(repaired, "{", "}", objStart)` ran *before* `sliceBalanced(repaired, "[", "]", arrStart)`. Whenever an 8B model (`@cf/meta/llama-3.1-8b-instruct-fp8` / `meta-llama/llama-3.3-8b-instruct:free`) returned a JSON array `[ {...}, {...}, {...} ]` with any surrounding text, `objStart` matched the first inner `{...}` object, `JSON.parse` succeeded on that single object (no `.scenes` field), and `!Array.isArray(planned)` threw `Scene keyword planner returned the wrong scene count`.
2. **Preamble `{...}` / `[...]` shadowing & NDJSON short-circuiting:**
   - `indexOf("{")` / `indexOf("[")` stopped on the first balanced JSON block in the reply, so echoing `Requested slots [...]` or a 1-item schema snippet in preamble prose shadowed the real `{"scenes":[...]}` plan. Similarly, NDJSON / comma-separated `{...}` scene objects parsed only the first object instead of reaching `salvageSceneObjects`.
3. **Rigid wrapper/field lookup (`parsed?.scenes` only):**
   - Valid 8B replies using `slots` (mirroring `"Requested slots"` in the prompt), `searches`, `stock_searches`, `prompts`, `items`, keyed scene maps (`{"0": ...}`), unwrapped single-scene objects on 1-slot tail chunks (`offset: 9, count: 1`), `"type": "photo"` (mirroring `"Pixabay PHOTO images"` in the prompt), `"keywords": ["word1", "word2"]` arrays, or multi-message chat arrays (`result[0]` reading a user/system prompt instead of the assistant message) were rejected as wrong scene count / invalid media type.
4. **Over-generation rejection when `planned.length !== count && planned.length !== total`:**
   - Emphasizing `"The COMPLETE video has exactly TWO Pixabay VIDEO scenes..."` caused 8B models to append the unrequested global video slot(s) (`4` scenes on chunk 0, `5` scenes on image-only chunks) or plan 1 scene per script paragraph / imperfect whole-video counts (`8, 9, 11, 12 !== 10`). Only exact `planned.length === total` was sliced.
5. **1-item schema example, missing post-script anchor, raw `pixabay:` token leakage, & blind retries:**
   - `buildStockSearchInstruction()` showed a 1-element example (`{"scenes":[{"type":"image","keywords":"short stock search keywords"}]}`), ended with up to 20,000 characters of multi-paragraph narration script with no closing anchor after the script, and passed raw `"pixabay:{\"q\":...}"` tokens in `Previous search selections`. Retries (`attempt > 0`) repeated `temperature: 0.4` without slot-count/type coaching or `previousError` context, and `handleGenerateImagePrompts` misclassified `"invalid JSON"` planner errors as `kind: "fatal"`.

## Fixes

- **`src/modules/image-prompts.ts`:**
  - Replaced the 1-item example in `buildStockSearchInstruction()` with an exact `slots.length`-matched JSON skeleton, unwrapped `pixabay:` tokens in `batch.previous` to plain search queries, and added a post-script `END OF SCRIPT.` closing anchor repeating the exact slot skeleton.
  - Upgraded `extractScenePlanJson()` to scan top-level balanced `{...}` and `[...]` blocks across fenced and unfenced sections, combine standalone NDJSON scene objects, fall back to loose quote/key normalization, and rank candidates so real scene-keyword plans always beat preamble fragments.
  - Added `extractPlannedScenes()` and `selectPlannedScenesForSlots()` to handle alternate wrapper keys, keyed maps, single-slot objects, `"photo"` → `"image"` normalization, string-array `keywords`, assistant-message selection in `aiText()`, and safe slot selection on over-generated replies while preserving strict per-slot media-type and 1–6 word / ≤100-char keyword checks.
  - Strengthened `attempt > 0` retry prompts with `previousError`, exact slot count/types, and temperature variation (`0.35` → `0.2` → `0.5`), and classified `Scene keyword planner ...` validation errors as `kind: "transient"`.
- **`src/client/progressive-image-pipeline.ts` & `src/client/app-js.ts`:**
  - Forwarded `previousError` on retry attempts (`attempt > 0`) and guarded `requestBatchPrompts` against non-JSON error responses.
- **`src/modules/pixabay.ts` & `e2e/index.ts`:**
  - Added `results.hits[index] || results.hits[0]` fallback when a distinct scene query returns fewer than `index + 1` valid filtered assets, and updated `e2e/index.ts` to mock Pixabay slot-planning requests.

## Verification

- `npm run test:pixabay`: **64/64 passing** (including new unit + JSDOM Editor retry/recovery regressions in `tests/pixabay-media.test.mjs` and `tests/pixabay-studio-flow.test.mjs`).
- `npx tsc --noEmit`: only the 30 pre-existing `src/index.ts` router diagnostics; zero errors in modified modules.
