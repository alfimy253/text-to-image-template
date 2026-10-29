# Pixabay media implementation and studio-processing reference

**Updated 2026-10-29. Latest contract: text-LLM scene search keywords, scene totals from the script word count (6 / 8 / 10), two Pixabay video scenes per automatic video, no manual prompt/search section in editor accordions. Implemented locally, not deployed/live-provider verified.** See [bug-fix-session-275-scene-count-consistency.md](bug-fix-session-275-scene-count-consistency.md) for the wrong-scene-count debug and the reconciliation rules.

## Media policy

Pixabay supplies all external stock photos and clips. AI image generation remains disabled, including SDXL/FLUX fallbacks and relay inference. A text LLM is explicitly allowed to plan **search keywords**, not generate media or long art-direction prompts. Cloudflare hosting/KV, text AI, TTS, manual uploads and local template composition remain supported.

This document and the current addendum in `system-rules.md` supersede earlier deterministic/photo-only and manual-picker descriptions elsewhere in the repository.

## Scene planning from the entire script

`src/modules/image-prompts.ts` retains `/api/image-prompts` for transport compatibility, but its active instruction is `buildStockSearchInstruction()`:

- Read the **entire narration script** on every scene chunk request. Both studio layouts send `script`, not an opening/closing summary. A supplied full script takes precedence over legacy `scriptIdea`.
- Plan concrete, broad scenes that collectively portray the **general idea of the whole script**, not literal sentence-by-sentence illustrations.
- Return JSON only: `{"scenes":[{"type":"image","keywords":"community garden flowers"}, ...]}`.
- Ask for **1–5 word stock search terms** (not image prompts), enforce a maximum of 5 words and 100 characters, and reject art paragraphs, excessive wording or wrong media types. The instruction also offers the script's own long-tail + short SEO keywords as search vocabulary. The reply is **recovered before it is rejected** (`extractScenePlanJson`, `extractPlannedScenes`, `selectPlannedScenesForSlots`, sessions #272–#273): markdown code fences, prose before/after the object or array, preamble echoes of slot JSON, bare `[...]` arrays, NDJSON object sequences, alternate wrapper keys (`slots`, `searches`, `prompts`, `items`), keyed scene maps, single unwrapped scene objects on 1-slot chunks, `"photo"` → `"image"` slot aliases, string-array `keywords`, literal newlines/tabs inside string values and trailing commas are repaired; a truncated reply salvages its complete scene objects; and over-generated replies (whole-video plans or chunks appending unrequested global video slots) are matched/sliced to the requested slots while keeping strict per-slot media-type and keyword validation enforced. Every surviving entry still passes the full per-slot validation; a reply with no recoverable JSON remains `Scene keyword planner returned invalid JSON`, and an unreadable/empty model answer is reported as `Scene keyword planner returned an empty reply` instead of masquerading as invalid JSON.
- Each complete plan includes **exactly two `video` scenes**; remaining scenes are stock-photo `image` scenes. This is stated in every LLM instruction, including requests containing only photo slots.
- The reserved video positions are zero-based scene `1` and `total - 2`. Slot assignments are server-controlled, so retries and three-scene chunk boundaries cannot add or lose video slots.
- **Scene count follows the script word count** (Session #275): `sceneCountForScript()` / `countScriptWords()` in the Worker and `imageSceneTarget()` / `imageScriptWordCount()` in the browser apply the same brackets — **≤130 words → 6 scenes**, **>130 and ≤240 → 8**, **>240 and ≤500 → 10**, **>500 → 10** (the rule set ends at ten). So the totals are **4 photos + 2 videos / 6 photos + 2 videos / 8 photos + 2 videos**. Two clips are included in the total, not added on top. The 10/14/20-by-duration tiers remain only as a legacy ceiling (`imagePromptCountForMinutes()`) and never raise the word-count total; a caller may ask for fewer scenes (editor gallery room, minimum four) but not more.
- **Count reconciliation.** `selectPlannedScenesForSlots()` aligns any reply shape to the requested slots: explicit `.scene` ids (global or chunk-relative), a whole-video plan of exactly `total`, a whole-video plan of **any other length** (proportional mapping, nearest same-type entry when the boundary rounds onto the other media kind), a chunk-relative slice, a greedy same-type subsequence, then the reply's own order. A reply that fills only part of a chunk returns the valid **prefix** so the browser continues at the next offset; the old `wrong scene count` failure now only means the reply had no usable scene at all.
- One text-model call per planning request, 45-second budget, 2,048 output-token limit. Existing browser retries remain bounded (batch attempt 0–2; attempts after the first add a "Return ONLY the JSON object" reminder to the instruction so a chatty model converges instead of repeating the same wrapper); no image model or image-generation fallback runs.
- Script input above **20,000 characters** returns 400 instead of silently truncating the story. Actual text-provider context limits still apply.
- Editor space-constrained plans may use a validated smaller `sceneTotal` of at least four; they still reserve two video slots. The editor requires room for at least two stills and two clips before starting.

Legacy exported art-direction helper utilities remain for old imports/tests but are not on the active planning path.

## Search and delivery

`src/modules/pixabay.ts` owns the secret-backed provider adapter.

- `searchPixabay(env, {q,type,page,per_page:3,...})` accepts `per_page` explicitly and permits **only 3**. Every upstream photo/video search sends `per_page=3`. Returned hits may be fewer than three after safety filtering.
- New scene tokens encode `pixabay:` plus `{q,type,page,index,scene}`. `type` selects Pixabay image versus video search. Different planned scenes carry their own keywords; they are no longer successive pages of one fixed topic query.
- Both video searches select bounded MP4 renditions. Metadata must indicate a positive duration no longer than **60 seconds**; the browser probes the actual file again before insertion.
- Binary `/api/image` responses may now be JPEG/PNG/WebP **or MP4**. Browser transport validates these types and retains source metadata. Legacy NDJSON includes MIME/source fields and supports both media kinds.
- A failed video search/import is not silently replaced by a still or an AI-generated asset. A row cannot finish successfully without two distinct imported clip IDs. Planned editor export also verifies both clips are still present.

### Current routes

| Endpoint | Current behavior |
| --- | --- |
| `POST /api/image-prompts` | Authorized text-LLM stock-keyword planning from the whole script; optional three-scene batch/offset; no AI image generation. |
| `POST /api/image` | One planned photo or clip as binary bytes, with source metadata. |
| `POST /api/image-batch` | Legacy NDJSON events for planned photos/clips. |
| `GET /api/media/search?q=flowers&type=image&per_page=3` | Normalized stock results; API key never returned. |
| `GET /api/media/search?q=flowers&type=video&per_page=3` | Suitable short MP4 results. |
| `GET /api/media/asset?type=video&id=<id>&per_page=3` | Validated ID-based server import; not an arbitrary URL proxy. API remains available, but the editor manual search panel has been removed. |
| `GET /image/gen?prompt=<search terms>` | Compatibility stock-photo fetch. |
| `GET /image/<number>` | 410; old AI demo inference is removed. |

Stock routes stay on the primary origin, not backup-Worker browser rotation. Text-model provider/Worker rotation remains independent. Inbound relay rejects image models, including Qwen image generation.

## Reconstructing both video-processing layouts

### Quick Batch

1. Narration -> existing TTS MP3 -> Web Audio duration -> caption cues.
2. Browser requests up to three scene keywords per chunk, always supplying the whole script to the text planner. The complete plan is 6 / 8 / 10 scenes by script word count (#275), and each instruction reserves exactly two clip slots inside that plan. The browser computes the same total from the same script, so the two sides can never disagree.
3. Pixabay searches use `per_page=3`; server downloads validated media; binary or legacy NDJSON delivers bytes with provenance.
4. Client sorts by scene index, owns Blob URLs, decodes photos and probes MP4 clips. Video slides have `type:"mp4"`, `videoEl` and actual duration, not a fake `<img>` containing video bytes.
5. Exactly two distinct clips must be imported before completion. Missing clips leave the row unfinished with a visible error; usable media is retained.
6. Automatic scene windows are fitted to narration in integer 30-fps frame units. Clip windows are bounded by actual duration; stills fill the remaining frames. **Both planned clips are therefore inside the narration timeline**, rather than the later clip falling beyond an audio-truncated slideshow.
7. Preview respects each scene's duration and seeks/draws clips as videos. Export borrows row slides/audio/frame dimensions for the shared browser H.264/AAC WebCodecs/muxer engine, then restores shared state.
8. Preview and Export unlock together only after the media/slides/animation readiness checks pass. Row cleanup releases Blob URLs and video decoders.

### Editor / video accordions

1. SEO/script writing remains text AI. Its automatic media flow asks the text LLM for whole-script stock search keywords, then imports photos and exactly two clips into the existing gallery.
2. **Removed:** the manual image prompt/search textarea, Photos/Videos selector, Search button and candidate-results panel. Gallery, manual upload controls, templates and automatic media progress remain.
3. Scene insertion probes clips, rechecks caps, records source and scene index, rejects stale completions and preserves planned order despite out-of-order network completion.
4. Rerunning scene planning replaces prior **automatic** scenes, releasing their resources; manual uploads remain. A second run does not accumulate four automatic clips.
5. The renderer verifies both required, distinct planned clips before export. When narration exists, it fits the planned gallery into the narration timeline so both clips appear. Clip audio is silent; narration remains the master audio.
6. The existing bounded presentation/seek fallback still handles detached, autoplay-rejected or stalled clips. No server-side video encoding was added.

Manual-upload-only projects and local templates still use their existing processing; they do not invoke scene planning automatically.

## Limits, safety and provider compliance

- Projects / Quick Batch rows: **10 / 10**; Quick Batch concurrency: **3 rows**.
- Per editor video: **25 stills, 5 GIFs, 5 MP4 clips**, **60 seconds maximum per imported clip**. The automatic plan requires two free clip slots; manual clips still count against the same cap.
- Batch duration: **1–6 minutes**; maximum transport batch: **20 scenes**; scene queue pacing remains three per group per three seconds, up to six shared tasks per isolate.
- Frame options remain 480/540/720/1024 long edge and square/landscape/portrait. These control output/orientation, not source-media dimensions.
- Search and imports use existing account/guest authorization. Missing/unavailable authorization storage fails closed; `PIXABAY_ALLOW_UNMETERED="true"` is an explicit isolated local/test opt-out, not a public setting.
- The legacy `images` counter means stock-import fair use (including clips): **10,000 imports/day per actor**, not provider request capacity. Failed deliveries refund import units; listings and scene planning do not consume image-import units.
- Search responses are cached for **24 hours** and identical in-flight searches coalesce. `PIXABAY_RATE_LIMITER` Durable Object limits uncached requests to **90 per rolling 60 seconds per hashed key** within this primary deployment; returned provider cooldown is shared.
- Download targets/redirects must be HTTPS `pixabay.com` or `cdn.pixabay.com`. MIME, signatures and byte bounds are checked: **8 MiB/photo**, **16 MiB/clip**. Download materialization is serialized per isolate.
- Selected images are downloaded/cached server-side before same-origin Blob delivery; permanent provider image hotlinks are not renderer assets. Pixabay source/provenance remains recorded and a source link remains in the gallery/table.

Read https://pixabay.com/api/docs/ on 2026-10-29: default API allowance is **100 requests/60 seconds per key**, `per_page` accepts 3–200 (this app permits only 3), query length is at most 100 characters, and default accessible results are capped at 500/query. Search results must be cached 24 hours, search previews may temporarily hotlink images, intended-use images must first be downloaded server-side, displayed results should identify Pixabay, and systematic mass downloads are prohibited. Actual account/response headers remain authoritative. The app budget does not coordinate unrelated deployments using the same key.

Review https://pixabay.com/service/terms/ and https://pixabay.com/service/license-summary/ before release; API availability is not blanket clearance for identifiable people, trademarks or other third-party rights.

## Files, configuration and validation

- Planner: `src/modules/image-prompts.ts`.
- Search/downloads/budget: `src/modules/pixabay.ts`.
- Media transports: `src/modules/image-batch.ts`, `src/client/browser-offload.ts`.
- Failure tracing: `[image]` / `[pixabay]` request-correlated structured logs; bounded provider
  status/body diagnostics with key/prompt redaction; client console errors and request IDs in the
  surfaced binary-flow error message.
- Both layout pipelines/renderer wiring: `src/client/app-js.ts`.
- Routing/authorization: `src/index.ts`.
- Rate-limiter binding/SQLite migration: `wrangler.json`.

The supplied credential remains only in ignored `.dev.vars`; `.dev.vars.example` is a placeholder. For production, install `PIXABAY_API_KEY` through `npx wrangler secret put PIXABAY_API_KEY` and apply the checked-in Durable Object migration during deployment. No production deployment or live-account verification was performed.

**Focused tests:** `npm run test:pixabay` — **66/66 passing**. Coverage includes whole-script LLM instructions with post-script slot skeletons and unwrapped prior queries, two clip slots across all durations/chunk boundaries, strict planner validation with JSON and scene-count recovery (fences, prose wrappers, bare arrays, preamble echoes, alternate wrapper keys, NDJSON, over-generated chunks, single-slot tail objects, truncation, retry-tightened instructions with `previousError` feedback), single-hit Pixabay fallback, request-correlated/scrubbed provider-error logs and permanent-403 no-retry behavior, binary/NDJSON mixed media, both layouts through export, removed accordion controls, safe reruns and refusal to export with a missing required clip. Browser decode/WebCodecs/muxer edges are mocked: these tests are not a real-device playable-MP4 verification. The historical broad suite still contains superseded contracts, and the same 30 pre-existing TypeScript router diagnostics remain.

## Real-media hang audit and preview (2026-10-29)

See [QA findings, reproduction and playable outputs](qa-preview/README.md). Added bounded
provider/cache/body/cancellation waits, audio encoding and playback-start watchdogs, editor
media-decode deadlines, false-Ready prevention, failed-probe cleanup and final-frame duration.
Both layouts now have actual Chromium H.264 output verified by independent FFmpeg decode and
browser playback/seek checks: 15 seconds, 450 frames, eight photo scenes plus two moving clips.
The providers are fixtures and output is silent because headless Chromium lacks AAC encoding.
Live-account model/Pixabay/TTS and production deployment remain unverified.
