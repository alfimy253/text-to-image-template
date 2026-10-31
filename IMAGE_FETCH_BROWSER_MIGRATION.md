# Image fetching: code study, deep debug, and browser-first migration

This document records what the code in `src/` actually does, the defects found in
the image-fetch path, and the change that moved Pixabay fetching from the
Cloudflare Worker into the browser UI. Code is the source of truth; every claim
below names the symbol it was read from. Where behavior could not be verified in
this sandbox (the sandbox has no outbound access to `pixabay.com` or
`cdn.pixabay.com`), it is labeled **unverified**.

---

## 1. Method

* Read the request router in `src/index.ts`, the media modules in
  `src/modules/`, and the browser modules in `src/client/`.
* Traced every path that can produce a scene image or clip:
  `requestImageChunk` → `studioOffload.images`, the legacy NDJSON
  `runImageBatch`, the editor `retryImagePromptFlow`, and the manual media
  routes.
* Diffed behavior against the regression suite (378 tests now; 358 before this
  change). The suite's pre-existing failure set is unchanged (§9).
* Booted the Worker with `wrangler dev --local` and exercised the new routes with
  a real `/free` cookie, including claim → settle → replay (§10).

---

## 2. Verified system flow (before the change)

```
browser                          Worker (src/index.ts)                 provider
-------                          ---------------------                 --------
requestImageChunk (app-js:9347)
  -> studioOffload.images (browser-offload:343)
     -> POST /api/image  ------------------------------------------>
        route at index.ts:1268
        -> handleImageBinary (image-batch.ts:1222)
           - request.json(), sanitizePrompts(), sanitizeImageFrame()
           - imageCreditHooks(...).consume(1)         (index.ts:5399)
           - sharedImageTaskQueue.enqueue(generateOneWithRetry)
             -> pixabaySceneImage (pixabay.ts:411)
                -> searchPixabay (pixabay.ts:138)
                     - DO budget: sharedBudget (pixabay.ts:85)
                     - fetch pixabay.com/api/
                     - edge/local 24 h search cache + in-flight coalescing
                -> downloadPixabay (pixabay.ts:320)
                     - serialized by module-level downloadTail
                     - fetch cdn.pixabay.com, bounded read, mime + magic-byte check
           - on failure: credits.refund(1) + imageFailureResponse
        <- bytes + X-Pixabay-Source
     <- Blob with blob.stockSource
  -> insertStockScene (app-js:18630) / row row.images
```

Other routes on the same pipeline:

| Path | Code | Notes |
| --- | --- | --- |
| Legacy batch | `handleImageBatch` (`image-batch.ts:786`) | NDJSON events; used only when the capability `binaryImages` is false. |
| Editor Retry | `retryImagePromptFlow` (`app-js:19142`) | `GET /api/media/search` then `GET /api/media/asset`; one credit per asset route. |
| Manual media search | `handlePixabayApi` (`pixabay.ts:443`) | `/api/media/search` free, `/api/media/asset` one credit (refunded when the response is not ok). |
| Capability negotiation | `GET /api/pipeline-capabilities` (`index.ts:245`) | `version: 261`; additive fields only. |

Media bytes reached the browser only as a same-origin response. No page code
called `pixabay.com`; the provider key existed only in the Worker environment.

## 3. Verified system flow (after the change)

```
browser                                            Worker                    provider
-------                                            ------                    --------
studioOffload.images (browser-offload:343)
  -> directBatchPlan (browser-offload:321)
     - GET /api/media/config  -------------------->
       route index.ts:451 -> mediaBrowserConfigResponse (index.ts:5148)
       <- {apiOrigin, key, assetHosts, limits, claimPath, settlePath}
     - POST /api/media/claim {count} ------------->
       route index.ts:456 -> handleMediaClaim (index.ts:5186)
         imageCreditHooks.consume(count)
         reservePixabayBudget(count)      (shared DO provider budget)
         KV media-claim:<id> = {subject, granted} TTL 900 s
       <- {claimId, granted, credits}
  -> per scene, in the existing scheduler:
     studioPixabayDirect.scene (pixabay-direct.ts:472)
       - search (pixabay-direct.ts:295)  ------------------------------> pixabay.com/api/
         (fetch with CORS; JSONP fallback if the answer is unreadable)
       - download (pixabay-direct.ts:383) -----------------------------> cdn.pixabay.com
         (8 MiB photo / 16 MiB clip, magic-byte check, in-memory LRU)
       <- Blob + stockSource
     on any browser failure: that scene only -> POST /api/image (fallback above)
  -> finally: POST /api/media/settle {claimId, delivered} ->
       handleMediaSettle (index.ts:5295) refunds granted - delivered
```

The direct path never sends media bytes through the Worker. The Worker keeps the
three non-media responsibilities: configuration, credit authorization, and the
same-origin fallback.

### Browser runtime contract (`src/client/pixabay-direct.ts`)

| Concern | Implementation |
| --- | --- |
| Config | `GET /api/media/config`; cached 10 min when enabled, 60 s when disabled. `PIXABAY_BROWSER_FETCH=0/false/off/no` disables the direct path server-side. |
| Search | `pixabay.com/api/?key&q&per_page=3&page=1&safesearch=true`, plus `image_type=photo&orientation=` for photos (videos send neither). At most 2 photos / 3 clips. |
| JSONP | If `fetch` is rejected (CORS) the search retries through the provider's `callback` parameter; assets have no equivalent, hence the Worker fallback. |
| URL safety | HTTPS only, host in `pixabay.com`/`cdn.pixabay.com`, no credentials, port or `key` parameter; the final URL after redirects is checked too. |
| Bytes | Content-Length and post-read size caps, MIME allowlist, magic-byte validation (JPEG/PNG/WebP/MP4 `ftyp`). |
| Caching | Small in-memory LRU (`CACHE_MAX_BYTES` 48 MiB) keyed by `type:id`; not persisted. |
| Failure model | Errors carry `status`, `kind`, `retryAfterMs`, `fallback`. Provider 429 is retryable with the provider hint and is *not* re-routed in a loop; a CDN CORS refusal is remembered for 5 minutes so later scenes go straight to the Worker path. |
| Debug | `window.studioPixabayDebug()` prints the ring buffer (200 events) and counters; `window.__PIXABAY_DIRECT_DEBUG = true` enables per-success console lines. |

### Credit accounting

* `POST /api/media/claim {count}` reserves `count` import units through
  `imageCreditHooks.consume` and stores `media-claim:<uuid>` in KV for 900 s.
* The shared Pixabay Durable Object budget is drawn in the same call
  (`reservePixabayBudget`), so browser-side searches still count against the
  90-per-60 s provider budget.
* `POST /api/media/settle {claimId, delivered}` refunds `granted - delivered`.
  A scene that fell back to `/api/image` is refunded here and then charged by the
  Worker route, so it is never billed twice.
* Settle deletes the claim *before* refunding and returns 503 if the delete
  fails; a replayed settle finds no record and refunds 0.

---

## 4. Deep-debug findings

| # | Finding (evidence) | Impact | Status |
| --- | --- | --- | --- |
| 1 | Every media byte traversed the isolate: `downloadPixabay` serializes downloads with a module-level `downloadTail` and materializes the full asset in Worker memory (`pixabay.ts:320`). Queue wait alone can reach 300 s. | Slow scenes, isolate memory pressure, provider latency inside the Worker request budget. | **Fixed by design**: the page downloads directly. |
| 2 | A zero-hit search was cached for 24 h, identical to a hit (`cachePut` + `localSearch.set` before this change). | One transient empty provider answer made every retry in that isolate return "no media" all day. | **Fixed** (`pixabay.ts:263`): empty answers are not kept in the isolate cache; edge copy is 30 s. Regression test added. |
| 3 | `pixabaySceneImage` required an explicit `page` in the token. A token like `pixabay:{"q":"garden","type":"image"}` failed with 422 "Invalid stock scene selection" even though the field is optional everywhere else. | Saved/older project tokens, hand-built tokens and the new browser path could be rejected. | **Fixed** (`pixabay.ts:411`): missing `page`/`index` default to 1/0. Verified live against `wrangler dev`. |
| 4 | The editor retry reset `project.aiImagesDone = imported`, discarding scenes already in the gallery. | Progress text under-reported and could jump backwards. | **Fixed** (`app-js.ts:19240` area): now increments. |
| 5 | `settle` used a fresh `config()`; if the config probe had flipped to disabled while a claim was live, the refund was skipped. | A reserved unit could be lost. | **Fixed**: settle uses the config that issued the claim. |
| 6 | A settle whose KV delete failed still refunded, so a replay could refund twice. | Double refund. | **Fixed**: delete-before-refund, 503 on delete failure. Test added. |
| 7 | Browser fetches bypassed `searchPixabay`, so the shared provider budget no longer protected the API key. | Bursts of browser requests could hit Pixabay's per-key limit. | **Fixed**: `reservePixabayBudget` is called by the claim route (DO-backed). Tests added. |
| 8 | Pixabay CORS behavior is not guaranteed; a blocked `cdn.pixabay.com` read would have left the direct path unusable. | Feature would break silently in some browsers/networks. | **Mitigated**: JSONP search fallback, per-scene Worker fallback, 5-minute CDN hold. Real-browser CORS remains **unverified** here. |
| 9 | Credit consume is a KV read-modify-write (`creditConsumeKey`, `index.ts:4418`); parallel requests can over-grant. | Allowance can exceed its nominal limit under concurrency. | **Known, unchanged** (pre-existing; the browser claim batches one call per chunk, which reduces the window). |
| 10 | Abandoning a tab after `claim` leaves units reserved until the record expires. | Up to 15 minutes of reserved credit. | **Accepted**; TTL bounds it and normal exits settle in `finally`. |

### Why the Worker fallback stays

`cdn.pixabay.com` may not return a readable CORS header for every request, and
corporate proxies/mobile carriers can block the CDN. A failed direct read is
therefore not a user-facing error: the same scene is fetched through
`/api/image`, with the same validation. The console shows both attempts:

```
[studio-image] browser Pixabay fetch fell back to the Worker {sceneIndex, status, kind, error}
[studio-image] scene delivered {transport: 'browser' | 'worker'}
```

---

## 5. Debug runbook

Browser (this is where fetching now happens):

1. Open DevTools → Console. Every direct failure logs with the `[pixabay-direct]`
   prefix. Successful searches/downloads are quiet unless
   `window.__PIXABAY_DIRECT_DEBUG = true`.
2. Run `studioPixabayDebug()` to print the last 80 events with counters
   (`scenes`, `direct`, `failed`, `searches`, `downloads`, `claims`, `refunded`)
   and the current config snapshot.
3. Network tab: `pixabay.com/api/` and `cdn.pixabay.com` requests now come from
   the page. A CORS block appears as a failed request with no readable response.
4. Frequency: a CORS block sets a 5-minute hold (`assetCorsBlockedForMs` in the
   debug snapshot), so only the first asset attempt per window appears.

Worker:

* `[pixabay]` search/download traces are now only produced by the fallback path
  and by the manual media routes.
* `[media-claim]` / `[media-settle]` log credit or KV failures.
* `/api/image` errors still return `requestId`, `kind` and credits.

Interpretation:

| Symptom | Likely cause | Next step |
| --- | --- | --- |
| Every scene is `transport: worker` | CDN CORS refused (hold active) | Compare `assetCorsBlockedForMs`; test the CDN in another browser. |
| Browser search fails but JSONP returns hits | API CORS header missing | Downloads still fall back; consider a CDN asset proxy if it persists. |
| 429 with `retryAfterMs` | Provider key budget | Wait; check other deployments using the same key. |
| 404 / "No suitable Pixabay media" | Keyword too narrow | Edit the scene keyword or upload media. |
| 401 | No session and no `/free` cookie | Open `/free` first. |

---

## 6. Security and operations

* **The Pixabay key is now intentionally readable by the page** through
  `/api/media/config` for authenticated/free-entry sessions. It is a public
  provider key, not an account secret, but it can be scraped and uses the
  account's quota. Rotate it with `npx wrangler secret put PIXABAY_API_KEY` and
  remove it from `wrangler.json` (it has been checked in plaintext and should be
  treated as exposed).
* Set `PIXABAY_BROWSER_FETCH=0` to return to the previous server-only path
  without a deploy of client code.
* `Cache-Control: no-store` is set on config, claim and settle answers.
* Direct provider traffic now leaves from the user's IP. This reduces Worker
  egress and memory but means provider rate limiting is per key, not per Worker
  IP; the claim route keeps the Durable Object budget meaningful.

---

## 7. Operational rollout / rollback

| Action | Effect |
| --- | --- |
| Deploy as-is | Browser fetches first; Worker fallback per scene. |
| `PIXABAY_BROWSER_FETCH=0` | Config answers `direct: false`; the client keeps using `/api/image`. No client deploy needed. |
| Old client + new Worker | Ignores `directMedia`, keeps using existing routes; new routes are additive. |
| New client + old Worker | `/api/media/config` 404 → direct disabled; existing behavior. |

---

## 8. Files changed

| File | Change |
| --- | --- |
| `src/client/pixabay-direct.ts` (new) | Browser Pixabay runtime: config, search/JSONP, download + validation, scene, claim/settle, debug ring buffer. |
| `src/client/browser-offload.ts` | `images()` now plans a direct batch (claim), fetches scenes in the page, and falls back per scene; always settles. |
| `src/client/app-js.ts` | Injects the runtime; editor Retry tries the browser first; progress counter fix. |
| `src/index.ts` | `/api/media/config`, `/api/media/claim`, `/api/media/settle`; `directMedia` capability; provider-budget reservation. |
| `src/modules/pixabay.ts` | Empty-result cache fix; optional token `page`/`index`; exported `reservePixabayBudget`. |
| `tests/pixabay-direct-browser.test.mjs` (new) | 12 tests: contract, selection, CORS fallback, invalid bytes, 429 hint, JSONP, claim/settle, offload integration, editor retry. |
| `tests/pixabay-direct-routes.test.mjs` (new) | 10 tests: capabilities, config, flag, auth, claim/settle accounting, quota, foreign claim, unmetered mode, provider budget, delete failure. |
| `tests/pixabay-fetch-regressions.test.mjs` (new) | 5 tests: empty-result cache, budget helper, token defaults. |

---

## 9. Test status

* `npm run test:pixabay`: 86/86 pass.
* New focused tests: 27/27 pass.
* Full suite: **314 pass / 58 fail / 6 cancelled** after the change versus
  **294 pass / 58 fail / 6 cancelled** before it (358 tests). The failure set is
  byte-for-byte identical (diffed by test name); the extra passes are the new
  tests. The 58 failures are the repository's existing superseded contracts and
  were not introduced here.
* `npx tsc`: 31 diagnostics before and after (all pre-existing).

## 10. Live verification (wrangler dev)

With the Worker running locally and a real `/free` cookie:

* `GET /api/pipeline-capabilities` → `directMedia: 1`.
* `GET /api/media/config` → 200 with provider origin, key and limits.
* `POST /api/media/claim {count:2}` → granted 2, KV record written, credits 2.
* `POST /api/media/settle {claimId, delivered:1}` → refunded 1; replay → 0.
* `POST /api/image` with a page-less token now reaches the provider instead of
  returning 422 (the sandbox network block produces the expected 502).

---

## 11. Known limitations / unverified

* **CORS for `pixabay.com/api/` and `cdn.pixabay.com`** was not measurable from
  this sandbox. The design tolerates either answer: JSONP for search, Worker
  fallback for bytes.
* No shared browser-side search cache; each scene performs its own search
  (keywords usually differ). Repeated identical searches are cheap at provider
  level but do consume budget.
* Claim records expire after 15 minutes; an abandoned tab is not refunded
  earlier than that.
* Provider fairness now depends on the user's network; the Durable Object budget
  is reserved at claim time, not at fetch time.
* The checked-in `PIXABAY_API_KEY` in `wrangler.json` should be rotated and moved
  to a secret; browser-first fetching makes the key visible to users by design.
