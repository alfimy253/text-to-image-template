# Bug Fix Session #241 — AI image generation: diagnosis, batch rendering and polling removal

**Date:** 2026-10-24
**Area:** `POST /api/image-prompts`, `POST /api/image-batch` (new), `GET /image/gen`, MODULE 8b in
`src/client/app-js.ts`
**Status:** fixed, covered by tests, verified in `workerd` (`wrangler dev`)

---

## 1. Symptom

After the **Generate SEO Script** walkthrough finished (plan → keyword set → image style → SRT),
the video's AI-image flow never produced usable images:

- the status line alternated between "Checking immediately, then every 30 seconds…" and
  "The prompt model is still working on N short scene prompts (N seconds elapsed)" and could stay
  there indefinitely;
- **Upload Image, GIF or MP4** and **✨ Generate SEO Script** stayed disabled for that video, so
  the user could not upload their own images either;
- when prompts did arrive, images appeared one at a time, roughly every 20 seconds, and a single
  failure stopped the queue;
- reloading did not help: the flow lives in memory, so the disabled controls were the only way
  out.

## 2. Root cause

The pipeline had four independent failure modes; any one of them is enough to make the feature
look "broken".

### 2.1 The prompt job ran on borrowed time (`ctx.waitUntil`)

`POST /api/image-prompts` answered `202` immediately and started the instruct-model call in
`ctx.waitUntil`, writing the prompt list back to KV (or an in-isolate `Map`) when it finished.

Cloudflare's own documentation is explicit:

> `waitUntil` has a 30-second time limit after invocation end … If any Promises have not settled
> after 30 seconds, they are canceled.
> — <https://developers.cloudflare.com/workers/runtime-apis/context/>

The job asked a 8B instruct model (`@cf/meta/llama-3.1-8b-instruct-fp8`) for **10–20 prompts of
~30 words each** with `max_tokens` up to 3 072 — 10–30 s for a single good answer, and up to
**three attempts** when the model answered short. That is 30–90 s of work on a 30 s budget. When
the isolate was recycled mid-flight, the KV record was never updated: it stayed
`status: "pending"` for its whole 1 h TTL.

The client had retries for *failed* polls (`IMAGE_PROMPT_POLL_MAX_FAILURES = 3`) but **no deadline
for a pending job**, so it kept polling every 30 s forever and never re-enabled the controls.

### 2.2 The prompt count was validated as a hard contract

`generateImagePrompts()` required exactly `imagePromptCountForMinutes(minutes)` prompts
(10 / 14 / 20). If the model produced 9 of 10 after three attempts, the code threw
`Image prompts incomplete (9 of 10) - try again`, which finalized the flow **before a single
image was rendered**. Asking a small instruct model for 20 distinct, well-formed scene sentences
in one JSON object is exactly the case where it under-delivers.

### 2.3 Images were rendered serially, 20 seconds apart

`scheduleAiImageQueue()` rendered prompt 1 immediately, then scheduled each next request
`AI_IMAGE_QUEUE_MS = 20 000` ms **after the previous attempt settled**, with a 90 s timeout and a
second attempt on transient errors. Ten images therefore needed **4–8 minutes** of wall time, and
nothing was visible until each individual request finished. A `401`/`429` stopped the queue
outright; a single stuck request blocked everything behind it.

### 2.4 The single-image route had no frame size and no retry

`/image/gen` called `env.AI.run(MODEL, {prompt, negative_prompt})` and nothing else, so SDXL
returned its default **square** image for a 16:9 gallery, and any transient model error became a
hard `500` for that scene (the queue retried once).

## 3. What changed

### 3.1 New module — `src/modules/image-batch.ts`

```
POST /api/image-batch   {prompts: string[]}   ->  application/x-ndjson
```

- `IMAGE_MODEL = @cf/stabilityai/stable-diffusion-xl-base-1.0`
- **16:9 by default**: `width: 1024`, `height: 576` (the model accepts 256–2048; the old code
  never sent it), `num_steps: 20`, random `seed`, shared text-free `negative_prompt`.
- **All at once**: renders with `IMAGE_BATCH_CONCURRENCY = 4` parallel lanes. No artificial
  spacing — the next image starts as soon as a lane is free.
- **Two attempts per image** (`IMAGE_BATCH_ATTEMPTS`) with a 500 ms backoff and a 75 s
  per-attempt ceiling (`IMAGE_ATTEMPT_TIMEOUT_MS`).
- **Streamed result events** (one JSON object per line):

| Event | Payload |
| --- | --- |
| `start` | `requested`, `count` (granted), `concurrency`, `width`, `height`, `model`, `credits` |
| `tick` | `at` — every 10 s, keeps the connection warm while renders run |
| `image` | `index`, `ok: true`, `mime`, `data` (base64), `bytes` **or** `index`, `ok: false`, `error` |
| `done` | `requested`, `count`, `generated`, `failed`, `skipped`, `ms`, `credits` |
| `error` | unexpected stream failure (the `done` event still follows) |

- **Robust decode**: `env.AI.run` may answer a `ReadableStream`, an `ArrayBuffer`, a typed array,
  a `Response`, a base64 string or `{image: "<base64>"}`; `toImageBytes()` accepts all of them and
  validates the PNG signature.
- **Credits**: one credit per generated image is reserved **before** the first render (a single
  KV read/write instead of N racing ones). If the daily allowance cannot cover the whole batch,
  only the remaining images are granted and `skipped` reports the difference. Every granted scene
  that does not reach the browser (failed, or never started because the client disconnected) is
  refunded in one write before `done`. `handleImageBatch()` receives `consume`/`refund` hooks,
  so account vs. `/free` guest accounting stays in `src/index.ts`.
- **Bounded input**: prompts are trimmed, de-duplicated, capped at 600 chars each and 20 per
  batch (`IMAGE_BATCH_MAX_PROMPTS`).

### 3.2 `src/modules/image-prompts.ts` — synchronous prompt writer

- `POST /api/image-prompts` now runs the LLM **inside the request** and answers
  `200 {success, prompts, count, expectedCount, style, minutes, model, ms}`.
- Removed: the job store, the KV `image-prompts:<id>` records, `waitUntil`, `makeJobId`, the GET
  and DELETE handlers, `IMAGE_PROMPT_JOB_TTL_SECONDS`. The retired URL answers **`410 Gone`** with
  a migration hint (`handleRemovedImagePromptJobRoute`).
- **Lenient top-up**: if the model returns fewer prompts than the target, the next attempt asks
  only for the missing scenes (`exactly 4 image prompts` + the last few prompts as "do not
  repeat"). If it still under-delivers, the prompts it did produce are used — `count` is
  reported honestly instead of throwing.
- Each model call is bounded (`IMAGE_PROMPT_TIMEOUT_MS = 90 s`), and a total failure answers
  `502 {success:false, error}` instead of leaving a job behind.

### 3.3 `src/index.ts` — one shared credit gate

- Added `imageCreditHooks(request, env)`, used by **both** `/image/gen` and `/api/image-batch`:
  no KV → open access (unchanged), session → account allowance, `yvs_free=1` → IP guest
  allowance, otherwise `401` with the existing "Open /free" message.
  `consume(amount)` reserves up to `amount` and reports `granted`; `refund(amount)` restores
  failed images and returns the fresh summary.
- `creditExhaustedMessage()` and `creditResponseHeaders()` keep the `X-Credit-*` headers and the
  `429` copy identical for both routes.
- `/image/gen` now renders through `runImageModel()` (16:9, retries are still the batch's job) and
  refunds its single credit on failure, as before.
- Route table: `POST /api/image-prompts` and `POST /api/image-batch`; `GET`/`DELETE
  /api/image-prompts/<id>` → `410`.

### 3.4 `src/client/app-js.ts` — MODULE 8b rewritten

- `startImagePromptFlow(n)` is now **two awaited requests**:
  1. `POST /api/image-prompts` (180 s timeout) → `project.imagePrompts`;
  2. `runImageBatch(n, prompts, flowId)` → `POST /api/image-batch`, read the NDJSON stream with
     `response.body.getReader()`, insert each image as it lands.
- **Deleted**: `IMAGE_PROMPT_POLL_MS`, `AI_IMAGE_QUEUE_MS`, `GALLERY_WATCH_MS`,
  `IMAGE_PROMPT_POLL_MAX_FAILURES`, `pollImagePromptOnce()`, `scheduleAiImageQueue()`,
  `generateQueuedAiImage()`, `watchGalleryCompletion()`, the `DELETE` teardown, `seoDelay()` and
  every `setInterval` in the file. There is no timer left that can outlive the flow.
- The batch has an **idle watchdog** (`IMAGE_BATCH_IDLE_TIMEOUT_MS = 120 s`): every line —
  including `tick` — resets it, so a long render never trips it, but a dead stream aborts.
- Each `image` event becomes a `Blob` → `File` → `addAiToVideo(n, file, blob, flowId, true)`;
  cards are tagged `imgflow-<video>-<stamp>`. The 25-still cap is applied **before** the request,
  so credits are never spent on images that cannot be inserted.
- `finalizeImagePromptFlow()` runs once (`_imageFlowFinalizing` guard), aborts any in-flight
  request, re-enables **Upload Image, GIF or MP4** and **✨ Generate SEO Script**, and reports
  added / failed / stopped-early counts.
- The manual AI panel (`submitAiImages`) now requests **both** variants concurrently instead of
  one after the other.

## 4. Verification

| Check | Result |
| --- | --- |
| `npm test` | **51/51 pass** (`tests/seo-walkthrough.test.mjs` rewritten for the batch flow: one prompt POST, one batch POST, zero GET/DELETE job calls, zero `/image/gen` calls in the walkthrough, cap handling, prompt-failure path, credit refunds, 16:9 payload) |
| `npx tsc --noEmit` | 37 pre-existing errors, **none** in `image-batch.ts` / `image-prompts.ts` (baseline was 48 before this session removed the untyped polling code; see `bug-audit.md` §11) |
| `npx wrangler deploy --dry-run` | bundles cleanly (2.09 MiB, 1.1 MiB gzip) |
| `wrangler dev --config wrangler.e2e.jsonc` | `POST /api/image-prompts` → 200 with 10 styled prompts; `POST /api/image-batch` → NDJSON `start` + 3 × `image` + `done`; `GET /image/gen` → 200 `image/png`; `GET /api/image-prompts/<id>` → 410; `GET /free` → 200 |
| Credit accounting (guest plan, stubbed KV) | batch of 3 → `used.images = 3`; failing model → refunded to `0`; anonymous request → `401`; partial allowance → renders only the granted count and reports `skipped` |

Sample stream (4 prompts, 1 forced failure):

```json
{"type":"start","requested":4,"count":4,"concurrency":4,"width":1024,"height":576,"model":"@cf/stabilityai/stable-diffusion-xl-base-1.0","credits":{…}}
{"type":"image","index":0,"ok":true,"mime":"image/png","data":"iVBORw0KGgo…","bytes":1048576}
{"type":"image","index":2,"ok":false,"error":"AiError: 3043 Internal server error"}
{"type":"done","requested":4,"count":4,"generated":3,"failed":1,"skipped":0,"ms":18422,"credits":{"remaining":{"images":47}}}
```

## 5. Compatibility / migration

- **Breaking:** `GET`/`DELETE /api/image-prompts/<id>` are gone (`410`) and `POST
  /api/image-prompts` no longer returns `{id, url}` — it returns the prompts. Any other client
  must switch to the synchronous call and, if it wants images, to `/api/image-batch`.
- `GET /image/gen?prompt=&variant=` keeps its contract (status codes, `X-Credit-*`,
  `X-Image-Variant`).
- Existing KV data needs no migration; `image-prompts:*` keys (1 h TTL) simply expire.
- `window.__SEO_FLOW_TIMING` now exposes `imagePromptRequestTimeoutMs` and
  `imageBatchIdleTimeoutMs` (the old `imagePromptPollMs`, `aiImageQueueMs`, `galleryWatchMs`
  entries no longer exist).

## 6. Remaining notes / follow-ups

- A batch is bounded by the 20-prompt model limit and 4 parallel lanes; a slow upstream makes the
  stream longer, not broken (the client sees `tick` events).
- `/api/image-prompts` and `/api/image-batch` are still reachable without a session when the KV
  binding is absent (open-access mode), matching the rest of the worker's local/e2e behaviour.
  With KV bound, images are metered; the prompt writer itself is unmetered (unchanged from
  RULE 24 / audit item A-12).
- `npm run check` still fails on the 37 pre-existing `tsc` errors described in `bug-audit.md`
  §11 — that is unrelated to this change and untouched here.
