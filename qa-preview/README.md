# Mixed-media hang audit and playable QA — 2026-10-29

Production media direction remains **LLM-planned Pixabay photos/videos, never AI-generated images**.
This directory contains **local-fixture QA output**, not live Pixabay results or a production deployment.

## Open the proof

The `Studio QA preview` live server opens `index.html` at `/` with both playable samples.
`sample-quick-batch.mp4` is also presented directly in the conversation.

| Actual browser export | Scenes | Duration / frames | Output |
|---|---|---|---|
| Quick Batch | 8 photo scenes + 2 distinct clips | 15.00 s / 450 at 30 fps | H.264, 720×408 |
| Accordion editor | 8 photo scenes + 2 distinct clips | 15.00 s / 450 at 30 fps | H.264, 854×480 low preset |

Both clips are inside the narration timeline: **1.5–3.0 seconds** and **12.0–13.5 seconds**.
Both MP4s are the **unmodified output of the app's real WebCodecs + mp4-muxer renderer**;
FFmpeg generated only the two input fixtures, then independently decoded the exports.

`results.json` contains actual browser results, planner/search counters, warnings, playback/seek
checks and changing-pixel hashes in both clip windows. `verification.txt` records independent
FFmpeg decoding of **450/450 frames in each file, zero decode errors**. Frame screenshots
visually confirm both labeled clips and subtitles.

### Important limits of this proof

- The real markup, client JS, whole-script planner handler, provider adapter, media import,
  JPEG/MP4/MP3 decoders, scene timing, H.264 encoder and muxer run without codec/canvas mocks.
- **The LLM, Pixabay HTTP responses, credits/auth and speech response are fixtures.** The QA server
  directly invokes planner/media handlers, not the production auth/credit router. It never reads
  `.dev.vars`, never uses the user's API key, and rejects non-fixture provider fetches.
- Eight planning calls receive the full sample script. The stub returns short typed keywords;
  this verifies instruction construction and slot validation, **not live model keyword quality**.
- Eight photo scenes deliberately reuse one image. Two distinct moving input MP4s are labeled
  `QA VIDEO 1` and `QA VIDEO 2`. They are photo pan/zoom fixtures, **not Pixabay stock footage**.
- The 15-second MP3 input is a quiet test tone, not synthesized speech. **The exports are silent**:
  this Chromium build reports AAC encoding unsupported. The app warns and completes its existing
  silent-video fallback. Audible AAC output and actual TTS remain unverified.
- Browser logs include expected AAC-fallback messages and failed external decorative/placeholder
  image loads blocked by QA network isolation. There were **zero uncaught page errors**.
- The muxer is the app's exact **5.1.3** version, served locally instead of its external CDN.
- This is a short real-media run, not a 6-minute/multi-row stress test, production deployment,
  live-account test, full-suite-green claim or cross-browser certification.

## Reproduced risks and fixes

| Risk | Fix / regression evidence |
|---|---|
| AAC backpressure queue can spin forever; `flush()` can never settle | 15 s queue watchdog, 30 s flush deadline; close encoder on timeout or unsupported configuration; AAC capability check bounded at 5 s |
| Clip `play()` can remain pending before frame fallback is reached | 5 s startup deadline, pause and fall back to seek-based capture |
| Editor image/audio decode and narration-duration measurement can remain pending | Photo deadline 10 s; editor/narration audio decode deadline 20 s |
| Quick Batch silently accepts a rejected/timed-out photo decode | Reject and report failure, do not mark row ready; release prepared clip decoders on failure |
| A stalled asset body or its `cancel()` can lock serialized downloads | Bound reads including streamed bodies; do not await cancellation; release lock in `finally` |
| Cancelled queued download waits for all earlier downloads | Return promptly on abort while retaining queue order for later waiters |
| Shared metadata search ignores caller cancellation / cancelled caller can cause duplicate work | Subscriber-specific cancellation; shared search survives for other subscribers; in-flight cleanup belongs to shared work |
| Cache or shared budget can remain pending | 2 s cache match/read/write bound (cache faults are misses/best-effort); 5 s shared-budget bound (fail closed) |
| Real muxer loses final frame duration | Supply `VideoFrame.duration`; verified 15.00 s rather than 14.97 s |

Provider metadata fetch/body deadline remains 20 s; asset fetch/body deadline remains 30 s.
Subscriber search waits are bounded at 35 s to include shared-budget/cache overhead.
Queued asset waits have a 5-minute ceiling and abort immediately on caller cancellation.
Cache TTL, shared 90/min budget, `per_page=3`, download byte caps and two-clip validation remain unchanged.
The **local QA preview server** additionally implements HTTP byte ranges, verified by real MP4 playback/seek tests.

## Validation

- **56/56 focused regression tests passed**, including 12 new stall/cleanup/timing tests.
- Both layouts exported real playable MP4s; both files play and seek in Chromium.
- FFmpeg independently decoded both exports without errors; all 450 frames present in each.
- Wrangler deployment dry-run passed. **No deployment performed.**
- Client JS syntax and `git diff --check` passed.
- Typecheck still reports **30 pre-existing diagnostics in `src/index.ts`**; unchanged diagnostic set.
  The broad historical test suite is not being claimed green.

## Reproduce (Linux, Node 22+, `gh`, `tar`, DejaVu Sans)

Optional heavy tooling is installed **without editing package manifests/lockfiles**:

```sh
npm ci
npm install --no-save --package-lock=false playwright-core@1.64.1 @sparticuz/chromium@153.0.0 @ffmpeg-installer/linux-x64@4.1.0 mp4-muxer@5.1.3
node bench/qa-pixabay-fixtures.mjs
node --import tsx bench/qa-pixabay-server.mjs
```

Keep that server running; in another terminal:

```sh
node bench/qa-pixabay-browser.mjs
node bench/qa-pixabay-playback.mjs
npm run test:pixabay
npx wrangler deploy --dry-run
```

Open port **8765**, `/` for the report or `/free` for the fixture studio. Scripts default to
`http://127.0.0.1:8765` from the sandbox only; the browser-facing app uses relative API paths.
Set `QA_PORT` on the server and `QA_URL` on browser scripts if changing the port.
`qa-browser.mjs` extracts Chromium's packaged Linux libraries under ignored `.cache` when needed.
A 3-minute watchdog bounds the browser export run. Input fixtures/binaries stay out of Git in
`.cache`, `node_modules` and Chromium's temporary extraction directory.

### Fixture attribution

Source photograph: [OpenCV samples/data/fruits.jpg](https://github.com/opencv/opencv/blob/4.x/samples/data/fruits.jpg).
Modified into moving pan/zoom test clips with labels; reused in sample video exports.
Copyright belongs to the original contributors; see upstream repository and accompanying
`fixture-license.txt` (OpenCV repository Apache-2.0 license). No Pixabay sourcing or licensing
claim is made for these fixtures. No AI image generation is used.
