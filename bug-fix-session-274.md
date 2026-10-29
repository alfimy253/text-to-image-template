# Bug Fix Session #274 — "The image server is busy right now … 0 image(s) added" (a stopped flow that promised to continue)

**Date:** 2026-10-29 · **Branch:** `arena/10351414-text-to-image-template`

## Symptom

> `Pixabay image flow stopped: The image server is busy right now — images pause for about 5 s`
> `and then continue. 0 image(s) added to the gallery. Upload Image, GIF or MP4 is enabled again.`

Scene keywords were planned fine, then every image failed and the flow ended — while the status
line promised the opposite ("pause … and then continue"), and the real cause never reached the UI.

## How the system works (the path the error travels)

1. `startImagePromptFlow()` → `runProgressiveImagePipeline()` requests scene keywords in chunks of
   ≤3 (`POST /api/image-prompts`, one LLM call — no Pixabay key needed).
2. Each rendered chunk goes through `requestImageChunk()` → `studioOffload.images()` → one
   `POST /api/image` per scene (binary #261 route), with at most 3 bounded retry rounds.
3. `runBinaryEditorImages()` sets `project._imageFlowStopReason` when every scene of a chunk
   failed (or a 401/403/429 appeared); for a failure carrying `kind:"overload"` **or a bare
   `status === 503`** it uses `describeImageLoadFailure()`.
4. `finalizeImagePromptFlow()` prints `Pixabay image flow stopped: <reason> N image(s) added …`.

## Root causes

1. **The server's `503` could not be told apart from load.** Without `PIXABAY_API_KEY` (running
   the Worker without `.dev.vars`, or any deployment missing the secret) `handleImageBinary()`/
   `handleImageBatch()` answered a **bare** `503 {"error":"Pixabay API key is not configured"}`
   — no `kind`, no `Retry-After`. Verified on `wrangler dev`: `/api/image-prompts` returns `200`
   (planning works), `/api/image` returns `503` for every scene. The credit-hook 503s
   ("Media authorization storage is unavailable", "Credit authorization unavailable…") had the
   same shape.
2. **The client treated any `503` as fleet load.** `describeImageLoadFailure()` selected the busy
   text with `error.kind === "overload" || error.status === 503`. With no hint it defaulted to
   "about **5 s**" — exactly the reported wording — for a failure that would never recover, and it
   discarded the real `error.message`.
3. **The browser wasted three retry rounds on a permanent answer.** `responseError()` computed
   `retryable` from the status alone (`>= 500`), so a fatal configuration 503 was retried like
   transient load (800 ms + 1600 ms of pointless waits per chunk).
4. **(Blocking, found while reproducing) The production Worker could not boot at all.**
   `src/index.ts` had `export const IMAGE_DAILY_LIMIT = 10000`. Because `wrangler.json` configures
   the `PIXABAY_RATE_LIMITER` Durable Object, workerd validates **every** named export of the main
   module at startup and only accepts functions/ExportedHandlers:
   `TypeError: Incorrect type for map entry 'IMAGE_DAILY_LIMIT' … The Workers runtime failed to
   start.` (reproduced on the pinned wrangler 4.123.0 and on 4.155.0). `wrangler deploy --dry-run`
   and the test suite never execute the worker, so this shipped unnoticed; the configs without DO
   bindings (`wrangler.e2e.jsonc`) still booted — with a mock LLM but **no Pixabay key**, which is
   exactly the environment of root cause 1.

## Reproduction

- Server: `npx wrangler dev --config wrangler.e2e.jsonc`, then
  `POST /api/image {"prompt":"garden flowers"}` → `503 {"error":"Pixabay API key is not configured"}`
  while `POST /api/image-prompts` → `200`. (Main config: before the fix the runtime refused to
  start; after the fix `/api/image` answers `503 {"error":"Pixabay API key is not configured",
  "kind":"fatal"}` in ~16 ms.)
- Client: `tests/pixabay-studio-flow.test.mjs` drives the real editor flow against that exact
  response. Before the fix the status line was the reported busy/5 s message byte-for-byte.

## Fixes

### 1 — `src/index.ts` + `src/modules/image-batch.ts` (boot blocker)

- `IMAGE_DAILY_LIMIT` moved to `src/modules/image-batch.ts` (sub-module exports are internal after
  bundling and unaffected); `src/index.ts` now **imports** it and exports nothing but functions /
  the handler object. `PixabayRateLimiter` (the DO class) stays exported.
- `npm run dev` boots again on the production config (`GET / 200`, DO registered).

### 2 — server: configuration failures are not load (`src/modules/image-batch.ts`, `src/modules/image-load.ts`)

- Both missing-key answers now carry **`kind: "fatal"`** (still `503`, still no `Retry-After`,
  still refunded): `{"error":"Pixabay API key is not configured","kind":"fatal"}`.
- `classifyImageFailure()` gained `/api key (?:is )?not configured/i` under `FATAL_PATTERNS`, so
  any path that classifies the error directly stops after one attempt too.

### 3 — browser: honest stop reason, no fake recovery (`src/client/app-js.ts`, `src/client/browser-offload.ts`)

- `describeImageLoadFailure()` uses the "busy … pause and continue" wording **only** for
  `kind:"overload"` (the RULE 31 contract). Every other failure surfaces its own `error.message`.
- `responseError()` reads `kind` first and keeps `retryable = (status >= 500 || status === 429)
  && kind !== "fatal"`, so fatal 503s fail fast instead of burning three retry rounds.

### 4 — tests

- **New regression** in `tests/pixabay-studio-flow.test.mjs`: the real editor flow fed the exact
  keyless `503` must show `Pixabay API key is not configured`, must **not** show
  "pause for about N s and then continue", must add 0 images and re-enable the upload button.
- **New boot guard** in `tests/session-262-load-balancing.test.mjs`: every named export of
  `src/index.ts` must be a function/ExportedHandler (would have caught root cause 4).
- `IMAGE_DAILY_LIMIT` imports in `session-262`/`session-263` repointed to `modules/image-batch.ts`.

### 5 — docs

- `system-rules.md` RULE 31 (HTTP contract + browser back-off bullets) and the message table now
  document the `kind:"fatal"` 503 exception and the strict `kind:"overload"` gate for the busy
  wording.

## Result for the user-visible status line

| | Text |
| --- | --- |
| Before | `Pixabay image flow stopped: The image server is busy right now — images pause for about 5 s and then continue. 0 image(s) added to the gallery. Upload Image, GIF or MP4 is enabled again.` |
| After | `Pixabay image flow stopped: Pixabay API key is not configured 0 image(s) added to the gallery. Upload Image, GIF or MP4 is enabled again.` |

A genuine fleet overload (`kind:"overload"` + `Retry-After`) still shows the documented busy text
and still gets its 3 hint-aware retry rounds (RULE 31/32 unchanged).

## Verification

- `npm run test:pixabay`: **65/65** (64 pre-existing + 1 new regression).
- `npm test`: **316 tests, 253 pass, 57 fail, 6 cancelled** — the 57 failures are byte-identical
  to the pre-change baseline (verified by `git stash` re-run: same 63 unique failing/cancelled
  names); both new tests pass. Those 57 are pre-existing Pixabay-migration drift (mostly
  `env.AI.run`-era tests such as the #262 binary-load suite) and are **out of scope** for this
  session; they were failing before any line below was touched.
- `npx tsc --noEmit`: exactly the documented **30 pre-existing `src/index.ts` diagnostics**, none
  in modified modules.
- `git diff --check`: clean.
- Manual: `wrangler dev` (production config) boots and `POST /api/image` answers the fatal 503;
  `wrangler dev --config wrangler.e2e.jsonc` hot-reloaded the same shape.

## Remaining limits / follow-ups

- **The environment still needs a real `PIXABAY_API_KEY`** (`.dev.vars` locally, Worker secret in
  production) before any image can be imported; this session makes the missing-key case fail fast
  and say so, it does not provision the key. This sandbox cannot reach `pixabay.com`, so a live
  import was not possible here.
- `runImageModel()` no longer reports provider outcomes to `sharedImageLoadGovernor` (the
  `noteSuccess`/`noteFailure` wiring of #262 was lost in the Pixabay migration — the governor's
  image-side state never moves). Not required to fix this report; recorded here for a future
  session together with the 57 legacy-suite failures.
