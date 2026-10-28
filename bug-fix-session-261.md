# Bug fix #261 — Browser-owned generation, local usage record and compatibility

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

**Date:** 2026-10-26 · **Scope:** editor and Quick Batch · **Status:** implemented and locally tested;
not deployed to production.

Supersedes the default NDJSON transport and whole-voiceover/server-retry descriptions in earlier
pipeline documents. The three-prompts-first progressive flow, one prompt lookahead, 10/14/20
scene totals, partial-result handling, gallery limits and browser MP4 export remain.

## Diagnosis and changes

| Recommendation / issue | Implemented behavior |
| --- | --- |
| 1. Image transport | `POST /api/image` accepts one validated prompt/frame and returns raw image bytes. The browser schedules individual requests and receives Blobs directly: no base64 encoding/decoding or NDJSON image parsing on this path. Authentication, reservation, quota checks and observable-failure refunds stay server-side. No automatic replay after an ambiguous paid image request. Legacy `/api/image-batch` remains. |
| 2. Voiceover orchestration | Browser sanitizes/splits narration (400 characters/chunk, 8,000 total), schedules chunks, owns bounded retry/fallback passes, validates WAV/MP3 and joins compatible audio locally. `POST /api/voiceover` with `chunk:true` and an allowlisted `voiceIndex` makes one model call, not a server loop or server assembly. English fallback restarts the pass consistently rather than mixing voices/containers. Quick Batch bypasses its legacy whole-step retry wrapper in chunk mode, avoiding multiplied paid requests. |
| 3. Script retry ownership | Negotiated `singleAttempt:true` plus validated selected `keywordSet` performs one server writer call. Browser controls attempts 0–2, bounded backoff and model fallback selection; server revalidates keywords, output and model allowlists. Existing no-flag API behavior remains for legacy clients. |
| 4. Prompt preprocessing | Browser compacts first/last script context into `scriptIdea` (at most 480 characters), sends absolute scene ranges and bounded prior-scene context, and normalizes/deduplicates prompt batches. Full narration is omitted from negotiated compact requests. Server independently validates ranges, styles, sizes and model choices. |
| 5. Adaptive scheduling/backpressure | Shared browser runtime allows 1–3 active media jobs according to hardware hints, visibility and tracked Blob memory, plus one reserved text/control job. Prompts can therefore advance while three images render. Queue aging prevents indefinite deprioritization; canceled queued jobs are evicted even when a lane is full. Worker/cooperative audio assembly, bounded buffers and object URL/bitmap cleanup reduce retained browser resources. |
| 6. Cross-tab cooperation | Feature-detected Web Locks coordinate media/control slots across same-origin tabs. BroadcastChannel provides ephemeral claim/release coordination when locks are unavailable, with heartbeat/expiry. No scripts, prompts, media, jobs or credentials are stored for cooperation. Coordination is cooperative, not a security or quota boundary. |

`src/client/browser-offload.ts` is shared by both layouts and manual media generation.
`src/client/progressive-image-pipeline.ts` still sequences three prompts, their images and one
lookahead. Adapter callbacks resolve the live project index, so deleted or renumbered accordions
do not receive another project's results. Script retry/error/finally UI now follows the surviving
project rather than the original numeric accordion position.

### Protocol and lifecycle

- `GET /api/pipeline-capabilities`: unmetered, no-store version **261**, advertising
  `binaryImages`, `chunkVoiceover`, `singleAttemptScript`, `compactPrompts`. Lazy browser probe
  has a 5-second deadline; missing/failed/incompatible response selects legacy behavior until
  runtime disposal/reload. Do not probe by submitting a paid request.
- Browser request **and body** deadlines: images 165 seconds, script 105 seconds, voice chunks
  45 seconds, prompt requests 60 seconds (server prompt model wait 45 seconds).
- Stop, deletion, replacement and pagehide invalidate stale work, release queue claims and clean
  resources. AbortController aborts network where supported; logical cancellation also checks
  every 100 ms. Already-delivered images survive later failures; Stop never becomes success.
- Audio buffers are capped at 64 MiB. A transferable-buffer Web Worker performs supported
  WAV/MP3 joins with a 30-second deadline and cleanup. A cooperative main-thread fallback copies
  in 64 KiB slices. This is container joining, not universal codec transcoding.
- Image inference retains the existing bounded provider fallback chain (potentially six, and
  for some configurations eight calls), not a promise of one provider call per image. Aborts
  stop subsequent fallbacks, not an already-running provider inference.

## Usage record: browser localStorage + cookie (no Durable Object)

Bug fix #261 records what this browser generated **for display and local history** in
`localStorage` and a short-lived cookie. It deliberately does **not** add a Durable Object,
database, wrangler binding or migration, and it is not a server-side accounting system.

### What is stored

- Per-kind success counts for the current Asia/Taipei day: images, scripts, voiceovers, MP4
  exports. Failed/cancelled attempts are kept only as short event markers, never added to counts.
- A random per-tab id generated in memory, a date, and up to 40 `{time, kind, outcome, count}`
  events per tab. Each tab writes its own `yvs-usage-261:tab:<id>` key, so simultaneous tabs
  append rather than overwrite; totals merge same-day keys when displayed.
- A compact cookie `yvs_usage_261` with the same counts and day only:
  `v=261;d=YYYY-MM-DD;i=n;s=n;o=n;m=n` (URL-encoded). `Max-Age=172800` (two days), `Path=/`,
  `SameSite=Lax`, and `Secure` on HTTPS. It is written by JavaScript, so it is not `HttpOnly`.
- The latest `/api/credits` summary (plan id/label, used/remaining counters, day) is mirrored
  locally **without** username, email, session cookie or generated content.
- No prompts, narration, audio, images, uploaded files, credentials or server tokens are stored.
- Each tab key is capped at about 3.5 KB and 40 events; obsolete tab keys are pruned after two
  days, with at most 24 retained. Storage/cookie failures (private mode, blocked storage, quota)
  fall back to memory for the current tab and never block generation.

### What it is not

- The Worker **never reads** these records to grant, deny, refund or price a request. Cookies and
  localStorage are trivially editable and clearable, so they cannot enforce a paid quota.
- Clearing the local record from the credits popover ("Clear this device's usage record") only
  erases this browser's display record. It does not restore server credits, and a full local
  record does not earn extra ones.
- Counts are per browser profile/device, not per account: two accounts in one profile share the
  display, while one account on two devices shows two separate records.
- Local counts can lag or be lost (storage cleared, quota, private mode, another tab's write,
  clock/day-boundary changes). `/api/credits` remains the authoritative server summary.
- The cookie is sent to the same origin on normal requests like any non-`HttpOnly` cookie. It
  contains counts only and must not be used as an identity or entitlement token.

### Existing server counters and the accepted quota limitation

Metered requests still use the pre-existing KV-backed counters and session/guest authentication,
and failures are refunded as before. **KV is not distributed-atomic**: simultaneous requests can
read the same value and overwrite each other. Local concurrency testing made this visible: twelve
simultaneous guest `/api/image` requests were all served in the local workerd fixture while the
KV summary recorded only two, i.e. the 10-image guest allowance was over-granted and the summary
under-counted. The opposite (count inflation) is also possible.

Consequences, accepted for this change:

- Server quotas and usage summaries are **best-effort**, not exact, under concurrency or retries.
- The browser record improves the user's own visibility but cannot repair this; treating it as
  authoritative would both leak bypasses and create false denials.
- If exact paid-usage enforcement, cross-device accounting or auditable billing becomes a
  requirement, a server-side serialized store (for example a Durable Object) or another atomic
  counter is still required. Keep this limitation in user-facing terms; do not market the quota
  as exact.
- Existing behavior is otherwise unchanged: `429` at the observed limit, observable-failure
  refunds, fail-open on a credits-subsystem outage (same as before), and `401` for a cold
  anonymous request when KV is bound. No production deployment is part of this fix.

### Display and controls

- The credit popover shows "This device today: …" plus the notice that server credits are
  authoritative, and a "Clear this device's usage record" button.
- The signed-in account box appends the same local line (and a title tooltip) after the plan line.
  It renders only when the local record has counts.
- Recording happens on delivered images, successful scripts, completed voiceovers and completed
  MP4 exports in both layouts. A failed image/script/voiceover adds a short error marker only.

## Older-browser workarounds

| Missing/blocked feature | Behavior |
| --- | --- |
| Web Locks | BroadcastChannel coordination if available. |
| BroadcastChannel and Web Locks | Conservative adaptive per-tab queue; server checks remain the only gate. |
| Worker, transferable assembly or Blob-worker CSP permission | Cooperative local audio assembly; detached input buffers are reread from retained Blobs. |
| `Blob.arrayBuffer()` | FileReader-based media reads. |
| AbortController | Finite Promise deadlines and logical cancellation; late results are discarded, but the underlying request may continue. |
| `localStorage` blocked or full | Memory-only record for the current tab; generation continues. |
| Cookies blocked | The cookie mirror is skipped; `localStorage` and the in-memory record still work. |
| Device memory/core hints | Conservative defaults; hidden tabs and memory pressure reduce media concurrency to one. |
| New server capabilities | Legacy NDJSON images, full voiceover request and original script behavior, negotiated before generation. |

These are feature-level workarounds within the application's existing modern JavaScript/fetch/
Promise/Blob baseline, **not IE compatibility**. WebCodecs/MP4 export retains its existing browser
requirements; this patch does not add a universal video encoder. BroadcastChannel suspension and
expiry can overlap work; neither that fallback nor client locks enforce quotas.

## Verification and reproduction

- Full suite: **170/170** tests passing (includes earlier progressive regressions and 5 new
  browser-usage tests).
- New usage-record coverage: per-kind counting and unknown-kind rejection, 40-event cap,
  same-day multi-tab merge, two-day pruning and Taipei-day reset, stale-key replacement,
  memory-only fallback when storage throws, cookie attributes/counts and absence of content,
  `/api/credits` mirror containing no identity/session/content, clear behavior, offline sync
  failure, capability negotiation without any DO binding, and the editor popover + clear button.
- Focused #261 browser tests cover transport/no-replay, authentication, cancellation and refunds,
  single-attempt validation, audio containers/worker fallback, old-browser APIs, both layout
  adapters, reserved control capacity, queued cancellation, retry multiplication and renumbered
  script cleanup.
- Real local workerd + KV, deterministic AI: the smoke run serves binary images and a binary WAV
  chunk against a fixture-marked endpoint, asserts every response is either an image or a quota
  rejection, and reports the accepted KV race instead of pretending the balance is exact.
- TypeScript still reports **30 pre-existing diagnostics in `src/index.ts`**, identical to the
  original commit after normalizing line/path changes; no new diagnostics. `npm run check`
  therefore remains blocked by the baseline errors, not a clean typecheck.
- Wrangler deployment dry-run succeeds with the existing AI and KV bindings only.
- `git diff --check` is clean. No production deployment or actual-provider load test performed.

Reproduce offline-provider integration in separate terminals:

```sh
CLOUDFLARE_SEND_METRICS=false npm run e2e:accounting -- --ip 0.0.0.0 --port 8787
npm run e2e:accounting:smoke
node --import tsx --test tests/session-261*.test.mjs
npm test
CLOUDFLARE_SEND_METRICS=false npx wrangler deploy --dry-run
```

`wrangler.accounting-e2e.jsonc` is local-only, with mock AI and a local KV namespace. The smoke
script requires the fixture response header before any generation and creates a fresh synthetic
subject, so it cannot accidentally test a production endpoint. `STUDIO_TEST_URL` can point to
this fixture on a different port. Do not deploy that fixture.

## Resource implications and remaining limits

Raw image responses remove base64 expansion/framing from the negotiated Worker path; browser
chunk assembly removes full-voiceover buffer merging there. Compact context reduces request and
model input size. These are architectural reductions, **not measured production CPU savings**.
More HTTP requests and browser work are explicit costs; small requests alone do not guarantee
lower fleet-wide CPU or provider spend. The existing image fallback chain, legacy protocols,
server validation and KV writes still perform Worker work, and the browser record adds small
local writes (no server traffic).

Worker wait timeouts cannot cancel `env.AI.run`; provider work may finish after cancellation.
An unobservable disconnect after response handoff cannot guarantee a delivery-based refund.
User retries are explicit new work, not automatic image replay. Runtime memory tracking covers
owned media, not every decoder/GPU allocation. No persistent queue/resume is introduced.

Actual older-device/browser visual testing, real provider quality tests, production CPU/latency/
request/KV measurements, and any decision about atomic server accounting remain rollout tasks.
The live development preview uses mock inference; it is not evidence of production performance.
