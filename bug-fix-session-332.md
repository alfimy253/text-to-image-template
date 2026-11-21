# Bug Fix Session 332 — System Study, Editor-Layout Internals, and the "Relay endpoint answered 404" SEO-Plan Failure

**Date:** 2026-11-21
**Branch:** `arena/00a4e2bf-text-to-image-template` (from `main` @ `d070707`)
**Scope of this file:** (1) a code-derived map of the whole repository, (2) the canonical system rules as
they exist in the code, (3) an in-depth description of the **editor layout** and every function that
drives it, and (4) the investigation, reproduction, root cause and fix of the production error:

```
SEO plan failed: SEO planner model failed
(@cf/meta/llama-3.3-70b-instruct-fp8-fast: Relay endpoint answered 404)
```

> **Document hierarchy.** `system-rules.md` is the canonical rule book; `README.md`, `SYSTEM_FLOW.md`,
> `userflow.md`, `pixabay-media-migration.md` and the earlier `bug-fix-session-*.md` files are the
> history. This file is the Session 332 record: it restates the rules that matter for the editor
> layout, documents the internals those rules depend on, and settles the 404 investigation.
> Where this file and an older session file disagree, this file and the code win; where this file and
> `system-rules.md` disagree, `system-rules.md` wins (and the drift is listed in §12).

---

## Table of contents

1. [What this application is](#1-what-this-application-is)
2. [Source map (what lives where)](#2-source-map-what-lives-where)
3. [Request lifecycle: one Worker, three layouts](#3-request-lifecycle-one-worker-three-layouts)
4. [System rules (canonical, code-derived)](#4-system-rules-canonical-code-derived)
5. [The three layouts and how they relate](#5-the-three-layouts-and-how-they-relate)
6. [Editor layout — anatomy and internals, in depth](#6-editor-layout--anatomy-and-internals-in-depth)
7. [Server-side SEO pipeline internals](#7-server-side-seo-pipeline-internals)
8. [API relay and provider rotation internals](#8-api-relay-and-provider-rotation-internals)
9. [The investigation: "Relay endpoint answered 404"](#9-the-investigation-relay-endpoint-answered-404)
10. [The fix (code changed in this session)](#10-the-fix-code-changed-in-this-session)
11. [Verification log](#11-verification-log)
12. [Known issues, drift and follow-ups](#12-known-issues-drift-and-follow-ups)
13. [Appendix A — symbol index](#appendix-a--symbol-index)
14. [Appendix B — error-message dictionary](#appendix-b--error-message-dictionary)
15. [Appendix C — operations runbook](#appendix-c--operations-runbook)

---

## 1. What this application is

A single Cloudflare Worker (`src/index.ts`, `main` in `wrangler.json`) that serves:

* a landing page, account/upgrade pages, the **studio** page (one HTML payload built from
  `src/client/markup.ts` + `src/client/styles.ts` + the client scripts),
* a **day-rotating settings page** at `/{day-of-month}/config/uvxyz` (day computed in Asia/Taipei,
  password `CONFIG_PASSWORD` in `src/index.ts`),
* the **AI routes** (`/api/script`, `/api/seo-plan`, `/api/voiceover`, `/tts`, `/api/image`,
  `/api/image-batch`, `/api/image-prompts`, `/image/gen`),
* the **relay** routes (`/api/relay/*`) that let those AI routes run on up to five registered backup
  Workers,
* KV-backed accounts, credits, CMS, manual payments, render jobs, and the Pixabay proxy.

The heavy media work (decoding, canvas painting, MediaRecorder/WebCodecs capture) happens **in the
browser** — RULE 1 and RULE 11. The Worker never renders video in the normal studio path; `/api/render`
plus the worker-mode poller is a legacy/optional path that is still routed.

### Runtime bindings (`wrangler.json`)

| Binding | Purpose |
| --- | --- |
| `AI` | Workers AI. Wrapped at request time by the relay runtime (`withRelayedAi`). |
| `KV_BINDING` | Accounts, sessions, credits, settings (`config:*`), CMS, render jobs, script notes. |
| `PIXABAY_RATE_LIMITER` | Durable Object (`PixabayRateLimiter`) guarding Pixabay traffic. |

`vars`: `PIXABAY_API_KEY`, `RELAY_SECRET` (must be **identical on every Worker in the relay pool**;
`GET /api/relay/status` reports `usingDefaultSecret: true` when the built-in fallback secret is used).

---

## 2. Source map (what lives where)

`src/` is 34 files / ~105,000 lines (including the 21,009-line `src/index.ts.original` legacy copy,
which is **not** compiled — only `src/index.ts` is `main`).

### 2.1 Server modules

| File | Lines | Responsibility |
| --- | ---: | --- |
| `src/index.ts` | 6,771 | The router. `export default { fetch }` → preflight → `handleRequest` → `applyRelayCors`. Holds `SCRIPT_MODEL`, `IMAGE_MODEL` legacy constants, config password, page routes, all AI route wiring, render API, worker poller, CMS/payments hooks. |
| `src/index.ts.original` | 21,009 | Historical single-file version. Dead code, kept for reference. Never imported. |
| `src/modules/api-relay.ts` | 2,114 | Worker↔Worker inference pool: config, pool resolution, weighted round robin, health/circuit breaker, HMAC compute tokens, browser tickets, `/api/relay/*` routes, CORS, provider rotation entry (`env.AI.run` replacement). |
| `src/modules/script-seo.ts` | 3,122 | `POST /api/seo-plan` (keyword planner) and `POST /api/script` (planner + writer + validation). RULE 7 enforcement, SRT→plain-narration conversion, retry ladders, script-note integration. |
| `src/modules/script-notes.ts` | 1,408 | Script note state machine in KV (research → plan → write → done), TTLs, guarded writes, outline/brief builders. |
| `src/modules/script-notes-api.ts` | 847 | `/api/script/notes` routes and the browser/client note contract. |
| `src/modules/script-event-loop.ts` | 738 | Cooperative yielding so long validation loops do not stall an isolate. |
| `src/modules/llm-openrouter.ts` | 815 | Provider rotation (Cloudflare ⟷ OpenRouter) for instruct models, key resolution, `isInstructModel`, `promptFromAiInput`. |
| `src/modules/image-prompts.ts` | 2,304 | Script→keyword planning for scenes, prompt/style guards, `/api/image-prompts`. |
| `src/modules/image-batch.ts` | 1,312 | NDJSON batch image endpoint, one event per scene, terminal event contract. |
| `src/modules/image-queue.ts` | 598 | Sequential/non-reentrant queue and pacing primitives. |
| `src/modules/image-load.ts` | 492 | **`classifyImageFailure()`** (the fatal/overload/transient classifier used by images *and* the relay), load governor, retry-after parsing. |
| `src/modules/pixabay.ts` | 483 | `/api/media/search` proxy, query normalisation, licence metadata. |
| `src/modules/voiceover.ts` | 1,200 | MeloTTS call, sanitising, chunking, retries, fallbacks, `/api/voiceover`. |
| `src/modules/payments.ts` | 901 | Manual payments, receipts upload/verify, credit grants. |
| `src/modules/user-pages.ts` | 550 | `/account`, `/upgrade`, auth page rendering, plan gating (RULE 21). |
| `src/modules/cms.ts` | 665 | CMS pages/slots injected into the shell. |
| `src/modules/theme-shell.ts` | 617 | Seven skins (RULE 19) and the theme token sheet. |
| `src/prompts.ts` | 2 | Legacy re-export only. |
| `src/page.ts` | 64 | Assembles the studio HTML document. |
| `src/client/*` | ~74,000 | Browser code (see below). |

### 2.2 Client modules

| File | Lines | Responsibility |
| --- | ---: | --- |
| `src/client/app-js.ts` | 30,134 | **The studio engine.** Editor layout (accordions), Quick Batch table, SEO walkthrough, image pipeline, voiceover, preview/export, persistence, timeline reconcile. 829 named `function` declarations inside the IIFE (plus their callbacks). |
| `src/client/styles.ts` | 11,006 | `APP_CSS`: every layout, theme overrides, the boolean-icon button rules. |
| `src/client/markup.ts` | 1,007 | `createStudioMarkup()`: the static DOM shell (top bar, three views, panels, modals, timeline page). |
| `src/client/timeline-editor.ts` | 5,333 | The separate timeline editor page (`?layout=timeline`): scenes, tracks, subtitles, autosave, multipart cookie mirror, Web Locks ownership, IndexedDB media. |
| `src/client/template-composer-js.ts` | 2,797 | Template composer / scene-control UI inside the studio page. |
| `src/client/template-scene-editor.ts` | 1,679 | Per-template scene editor (elements, timing, effects). |
| `src/client/config-page-js.ts` | 2,706 | Settings page: theme, workers, relay policy, LLM policy, CMS, payments. |
| `src/client/api-rotation.ts` | 272 | `API_ROTATION_JS`: wraps `window.fetch` for the eight AI paths, asks `/api/relay/endpoint`, calls what it is given, reports failures. |
| `src/client/pixabay-direct.ts` | 583 | Browser-first Pixabay fetching + credit claim/settle. |
| `src/client/pipeline-management-store.ts` | 587 | Page-wide Quick Batch localStorage + 4-part cookie mirror. |
| `src/client/browser-offload.ts` | 502 | Offloads retries/work to the browser (RULE 30). |
| `src/client/progressive-image-pipeline.ts` | 213 | Progressive delivery of images into the gallery. |
| `src/client/usage-ledger.ts` | 284 | Per-session usage accounting UI. |
| `src/client/payment-upload-js.ts` | 450 | Payment receipt upload UI. |
| `src/client/script-notes-client.ts` | 623 | Browser-side script-note memory (RULE 35). |
| `src/client/template-ring-carousel.ts` | 446 | Ring carousel template (RULE 13). |
| `src/client/template-shape-animations.ts` | 378 | Shape animation templates. |
| `src/client/aerial-background.ts`, `reel-scene-assets.ts` | 7, 12 | Aerial theme credit line; embedded scene placeholder asset. |

### 2.3 Tests, benches, docs

* `tests/` — 59 files, ~26,100 lines (`npm test` = `node --import tsx --test tests/*.test.mjs`).
  The suites that bound this session's work: `tests/api-relay.test.mjs` (48 tests at baseline),
  `tests/seo-plan-resilience.test.mjs`, `tests/seo-walkthrough.test.mjs`,
  and the new `tests/session-332-relay-404.test.mjs`.
* `bench/` — pipeline simulations, QA harnesses, wrangler bench configs.
* Root `*.md ` — the rule book and per-session records (`bug-fix-session-206 … 331`).
* `render-app/` — a **separate** key-gated MeloTTS helper (RULE 26). The Worker never calls it.

---

## 3. Request lifecycle: one Worker, three layouts

### 3.1 Server entry

```
export default { fetch(request, env, ctx) }
  ├─ relayPreflightResponse(request)          // CORS preflight for AI paths answered before routing
  ├─ handleRequest(request, env, ctx)
  │    ├─ baseEnv = env                        // raw bindings, kept for the inbound relay endpoint
  │    ├─ env = withRelayedAi(env, request, { preferLocal: !!ticket })   // env.AI := relay runtime
  │    ├─ GET /api/pipeline-capabilities      // non-billable, version 261
  │    ├─ canonical redirects (…/ → …)
  │    ├─ GET /  (landing)  ·  /account  ·  /upgrade
  │    ├─ plan gating (/free, /studio, /paid …)
  │    ├─ auth API (handleAuthApi)
  │    ├─ handleRelayRoutes(baseEnv)          // /api/relay/* — ALWAYS on raw bindings
  │    ├─ handleLlmRoutes(baseEnv)            // /api/llm/* admin
  │    ├─ POST /api/seo-plan → handleSeoPlanGeneration(request, env, SCRIPT_MODEL)
  │    ├─ POST /api/script   → handleSeoScriptGeneration(...)
  │    ├─ POST /api/image-prompts · /api/image-batch · /api/image (binary)
  │    ├─ POST /api/voiceover · /tts
  │    ├─ render API, worker poll/deliver/failed
  │    ├─ CMS, payments, config routes
  │    └─ 404
  └─ applyRelayCors(request, response, env)    // cross-origin reads only with a signed ticket
```

Two properties matter everywhere else in this document:

1. **`env.AI` is a runtime, not a binding.** Any code that calls `env.AI.run(model, input)` is
   transparently routed through the pool (`api-relay.ts`). No call site knows about rotation.
2. **The inbound relay endpoint runs on `baseEnv`.** A relayed call can never be relayed again, so
   Worker A → B → A loops are impossible by construction.

### 3.2 Client boot

```
GET /                      → createHTML() (markup + CSS + scripts)
window load                → app-js installs
  ├─ requestedStudioLayout()      // reads ?layout= and the stored layout
  ├─ setStudioLayout("editor"|"table")
  ├─ ensureEditorAccordionOnLoad()// editor layout always starts with one OPEN accordion
  ├─ restorePipelineManagementState()
  ├─ reconcileTimelineEdits()     // table layout
  └─ API_ROTATION_JS wraps window.fetch for the eight AI paths
```

### 3.3 The three layouts

| Layout | Where | Entry | Purpose |
| --- | --- | --- | --- |
| **Editor** (default) | `#view-editor` in `markup.ts`, built by `app-js.ts` | `#layout-editor`, `?layout=editor` | Per-video accordions: SEO script, Pixabay scenes, MP3, title, quality, preview, export. |
| **Bulk grid** (Quick Batch) | `#view-table` | `#layout-table`, `?layout=table` | One editable table row = one video; batch Generate, per-row Preview / Process / Edit. |
| **Timeline editor** | separate page `?layout=timeline` (`timeline-editor.ts`) | row **Edit** button (managed popup) | Frame-accurate scenes, tracks, subtitles; owns the saved project while it has the Web Lock. |

The template composer (`template-composer-js.ts` + `template-scene-editor.ts`) is **not** a layout: it
is a modal surface opened from the editor layout's “Add video from template” link and from the timeline
editor's “＋ Add Clips” button (both land in the same modal — Session 332).

---

## 4. System rules (canonical, code-derived)

These are the rules a change must not break. Numbers match `system-rules.md`; where a rule is stated
only in code/comments, the source is cited.

### 4.1 Media and scene integrity

* **RULE 6 / media policy (2026-10-29).** Pixabay photos and clips only. No SDXL/FLUX/AI image
  generation anywhere, including fallbacks. A non-visual model slug is refused by the relay
  (`permitsNonVisualModel()` → `410 "AI image generation is disabled; use Pixabay"`).
* **Fixed scene count — current code truth is 14 = 8 photos + 6 clips.**
  `AUTO_MEDIA_TOTAL = 14`, `AUTO_IMAGE_SCENES = 8`, `AUTO_VIDEO_SCENES = 6`
  (`src/client/app-js.ts:2648-2650`), and the Worker advertises the same contract in
  `/api/pipeline-capabilities` (`mediaSceneCap: 14`, `mediaImageScenes: 8`, `mediaVideoScenes: 6`,
  `per_page: 14`, `image_per_page: 8`, `video_per_page: 6`, `src/index.ts:348-382`). Pixabay is asked
  for 14 results upstream; 8 photos and 6 clips are exposed.
  > Older documents say **12 scenes (8 + 4)**: `README.md`, the governing media rule,
  > `bug-fix-session-275-scene-count-consistency.md` and the FINAL RULE block in `system-rules.md`.
  > Those statements are superseded by the code above. The editor accordion hint that still said
  > “4 stock video clips” was corrected in this session to “6 stock video clips” (see §12.8).
* **RULE 9.** Media limits are per video; the audio track dictates the video length.
* **RULE 11.** Output is fixed: 30 fps H.264 + AAC, quality presets only.
* **RULE 13.** One scene gallery, shared graphics elements, 5–7-image ring upload editor.

### 4.2 Script and keyword rules (RULE 7)

* One long-tail keyword, **said at least once**.
* Exactly **four short keywords** (≤ 3 words each), **each said at least twice**.
* Frequency is a **minimum, never an exact count and never a maximum**; over-use is never a rejection.
* One short keyword must appear in the title (≤ 70 chars); at least one heading (1–12 headings,
  ≤ 12 words each) must contain a short keyword.
* Short/long-tail overlap is allowed and shared occurrences count for both.
* No long-tail length rule.
* Counts are measured on the **spoken** text only (cue numbers, timestamps, title, headings excluded).
* The writer model answers in timestamped cues so length is machine-checkable, but **only plain
  narration leaves the Worker** (`plainScriptFromCues()`); subtitles are re-derived downstream.

### 4.3 Voice and audio

* **RULE 8.** MeloTTS, defensive sanitising (plain sentences only), chunking, retries, layered
  fallbacks; `/tts` fallback models exist but are AI routes, so they rotate.
* The narration is the **audio master**; scene timing follows it.
* **RULE 26.** `render-app/` is a separate key-gated helper; the Worker never calls it.

### 4.4 Accounts, credits, storage

* **RULE 2.** Accounts are KV-backed with no user cap; most data routes are anonymous.
* **RULE 15 / RULE 35.** KV data lifetime is bounded by TTLs; **script notes are client-side**.
  The Worker stores no script note the browser owns (see `script-notes.ts` TTLs and the guard rules).
* **RULE 20.** Daily credits are per account, plan-based, reset in Asia/Taipei.
* **RULE 21.** Plan URLs: `/free` (guest), `/studio` (free/paid), `/paid` (paid only).
* **RULE 22.** One shell, two views: layout state, not a second page.
* **RULE 3.** Settings page = `/{day}/config/uvxyz` in Asia/Taipei; yesterday's URL is a 404.

### 4.5 Inference routing (RULE 33 / RULE 34 — extended by RULE 36)

* **Local-only state.** KV, accounts, credits, CMS, payments and render jobs never leave the Worker
  that served the page. Only inference may run on a pool member.
* **Pool** = this Worker + up to **five** registered backup URLs (`config:workers`), deduplicated,
  validated as `http(s)://` and normalised to an origin (+ optional path) by `normalizeUrl()`.
* **Round robin only.** Local is entered into the ring `localWeight` times (default 1), each backup
  **3** times (`RELAY_BACKUP_RING_WEIGHT`). Local therefore answers 1 request in `1 + 3×backups`.
* **Local is the guaranteed backstop.** Cooling members move to the end of the list but are never
  removed; local is appended even beyond `maxAttempts`.
* **Health/circuit breaker.** `noteRelaySuccess` heals; `noteRelayFailure` opens the circuit with
  `cooldownMs × 2^(n-1)`, capped at 5 minutes. Health is keyed by URL-derived id so it survives the
  20 s pool cache rebuild.
* **Tokens.** Worker→worker calls carry an HMAC token (`x-yvs-relay-token`, TTL 120 s) binding the
  model slug **and** a SHA-256 digest of the body, so a backup cannot be asked to run anything the
  primary did not sign for. Browser tickets (`x-yvs-relay-ticket`, TTL 180 s) are path-scoped to the
  eight AI paths and never unlock account/config/payment/CMS routes.
* **Provider rotation (RULE 34).** Instruct models may go to OpenRouter or Cloudflare per
  `config:llm`; images and TTS stay on Workers AI.
* **RULE 36 (new, this session).** *A relayed member's HTTP/envelope answer is never a model verdict.*
  `ModelError` (the endpoint's own `kind:"model"`) is authoritative and fatal; `RelayError` (status
  line, token, route, network, deadline) is always transient: fail over and cool the member. See §9.

### 4.6 Failure classification (used by images and the relay)

`classifyImageFailure(error)` in `src/modules/image-load.ts`:

* `overload` — 429/502/503/504, capacity/quota/concurrency text.
* `transient` — 3043, timeouts, network, malformed/unexpected response, unknown defaults.
* `fatal` — 400/401/403/**404**, no such model/host, deprecated/retired model, invalid prompt,
  prompt too long, binding not configured, API key not configured, unsupported parameter.

> That `/\b404\b/` fatal pattern is the hinge of §9: it is correct for an image provider answer and
> wrong for a relay member's status line.

### 4.7 Client-side truths

* The browser **never picks, ranks or fails over an endpoint**: it asks `GET /api/relay/endpoint?path=…`
  and calls the URL it is given. It may *report* one failed URL (`&failed=<id>`, carrying the ticket)
  and then call the new answer — a report, not a rotation (`src/client/api-rotation.ts`).
* Unmanaged/older timeline-editor tabs are read-only (Web Locks ownership, Session 331).
* Cookies/localStorage are size-limited mirrors; IndexedDB holds media bytes; no cookie ever holds
  a blob.

---

## 5. The three layouts and how they relate

| Concern | Editor layout | Bulk grid (table) | Timeline editor |
| --- | --- | --- | --- |
| Unit | `<div class="video-accordion" id="video-N">` | `<tr>` in `#batch-rows` | saved project `ytvs.timeline-editor.v1.<id>` |
| State owner | `videoProjects[]` (app-js) | `batchRows[]` + `pipeline-management-store` | the timeline editor tab that holds the Web Lock |
| Script entry | “✨ Generate SEO Script” → walkthrough | Script cell (typed) → Generate | reads the table row's script |
| Media | Pixabay auto-scenes + manual uploads + template MP4s | Pixabay auto-scenes, saved to the row | all tracks, including uploaded blobs (IndexedDB) |
| Preview / Export | preview monitor + top Generate | per-row ▶ / ⚙ | timeline preview + its own export |
| Persistence | `videoProjects` snapshot in the pipeline store | the same store (page-wide) | localStorage + 8-part cookie + IndexedDB |

**Shared engine.** All three layouts use the same code paths for media search, voiceover and the
frame painter; the timeline editor exports `window.__TIMELINE_*` hooks that the table calls during
reconcile. Nothing in the editor layout writes a *second* project format: the editor's summary is
derived from `videoProjects` for the table (`composeEditorProjectDetail`).

---

## 6. Editor layout — anatomy and internals, in depth

### 6.1 Boot and layout switching

| Function | Lines (`app-js.ts`) | Behaviour |
| --- | ---: | --- |
| `requestedStudioLayout()` | 10,086 | Reads `?layout=` (explicit request wins) then the stored layout; `table` → table, anything else → editor. |
| `setStudioLayout(name)` | 10,125 | Sets `studioLayout`, clears `timeline-mode`/`timeline-editor-page` classes, deactivates `#view-timeline`, hides `#studio-heading` outside the editor layout, toggles `.active` on `#view-table` / `#view-editor`, syncs `aria-selected` on `[data-layout]`, renders the table when switching to it (`reconcileTimelineEdits()` then `renderBatchTable()`), re-enables the top Generate button in the editor layout, then persists (`persistPipelineManagementState("layout")`). |
| `activateTimelineEditorLayout()` | 10,093 | The reverse: marks the body/`#studio-app` with timeline classes, hides the editor-only heading, activates `#view-timeline`. |
| `ensureEditorAccordionOnLoad()` | 9,187 | Session 332: the editor layout always starts with **one open accordion**. Creates Video 1 if `videoProjects` is empty and re-opens `#va-body-1` if the restored state left it collapsed. The ＋ Add Video button is explicitly kept unpressed (`aria-expanded="false"`, no `.active/.pressed/.is-down`). |
| `openTemplateModalForTimeline()` | ~9,262 | Session 332: the timeline editor's “＋ Add Clips” opens the **same** template modal as the editor layout. Creates a `videoProjects` entry if needed and calls `window.openTemplateModal(n)`. |

Session 332 also removed the page heading copy from every layout; what remains is the ＋ Add Video
button, which belongs to the editor layout only (`markup.ts` “HEADING (Session 332)”, `styles.ts`
“Session 332 cut this block down to the ＋ Add Video button”).

### 6.2 Accordion anatomy (generated by `videoAccordionHTML(n)`, line 9,804)

| Region | Element ids | Notes |
| --- | --- | --- |
| Header | `#video-N`, `#va-status-N`, `#va-summary-N`, `#va-arrow-N` | `videoAccordionHTML()`; `toggleVideoAccordion(n)` flips `#va-body-N` and the arrow (`▼`/`▶`). |
| SEO script block | `#va-script-topic-N`, `#va-script-minutes-N` (1–6), `#va-script-speed-N` (super fast/fast/medium/slow), `#va-script-btn-N`, `#va-script-status-N`, `#va-script-keywords-N`, `#va-script-toggle-N`, `#va-script-box-N` | The button calls `generateScript(n)` → walkthrough. The keyword chips are a summary of the chosen set; the script box is the plain narration. |
| Voiceover | `#va-voice-btn-N` | Hidden until a script exists; `openVoiceoverModal(n)` (line 27,440). |
| Media | `#va-upload-btn-N`, `#va-template-link-N`, `#va-gallery-toggle-N`, `#va-ai-status-N`, `#va-image-keywords-N`, `#va-image-retry-N`, `#va-gallery-N`, hidden inputs `#va-file-N`, `#va-audio-N` | Upload button is **disabled for the whole SEO flow** (`setVaUploadEnabled(n, false)`), re-enabled on failure. “Retry Pixabay search” (`retryImagePromptFlow`) only appears after a failed/partial search. |
| Audio | `clickVaAudio(n)` → `#va-audio-N` change → `onVideoAudio(n)` | One MP3 per video; length = MP3 length. |
| Title / quality | `#va-title-N` (70 chars), `#va-font-N`, `#va-color-N`, `#va-quality-N` | Title is the fallback topic when the topic field is empty. |
| Footer | `#va-delete-N` → `deleteVideoAccordion(n)` | Removes the project, its media, its modal and (in the table) the derived row state. |

The preview monitor (`#video-canvas`, `#progress-bar`, `#status-text`, `#action-bar`) lives **outside**
the accordions in `markup.ts` and is shared by every video in the editor layout.

### 6.3 Project state model

`videoProjects[]` entries are plain objects:

```js
{
  n, name,                       // display identity (index-derived; re-derived after delete)
  assets: [],                    // { assetId?, index, kind, blob/url, meta }
  audioFile, audio,              // the MP3 (File + element/ArrayBuffer)
  status,                        // empty | ready | …
  el,                            // the accordion element
  script, topic,                 // narration text, topic
  videoImageStyle,               // one of the ten SEO_IMAGE_STYLES
  selectedSeoSet, seoSets,       // planner result(s) and the pick
  _seoTopic, _seoMinutes, _seoSpeed,
  _seoPlanBusy, _seoChoicePending,
  _imageFlowActive, _deleted,
  _imageRetryAttempts, …         // retry ladder bookkeeping
}
```

Invariants:

* Index → `n` is **not** stable. Every async flow re-resolves `n = videoProjects.indexOf(project) + 1`
  after an await and bails out when `project._deleted` (see `confirmSeoStyleAndGenerate`,
  `generateScript`, `selectSeoKeywordSet`).
* `_seoPlanBusy` blocks a second planner run for the same video; `_seoChoicePending` keeps the
  walkthrough unclosable (Escape) until the keyword set **and** style are confirmed.
* Uploads are disabled (`setVaUploadEnabled`) from the moment the plan starts until the gallery is
  filled or the flow fails.

### 6.4 The SEO walkthrough (RULE 24) — state machine

One modal **per video**: `seoWalkthroughModalId(n)`; `getSeoWalkthrough(n)` / `ensureSeoWalkthrough(n)`
create it lazily, `modalBringToFront()` raises it, `closeSeoWalkthrough(n)` closes only Video N.

```
        generateScript(n)
               │  reads topic/minutes/speed, clears seoSets, disables uploads
               ▼
  ┌───────────────────────┐  fetch POST /api/seo-plan {topic}
  │ step "plan" (loading) │ ──────────────► 200 {sets:[…], partial?}
  └───────────────────────┘                        │
               │ failure                            ▼
               │ (500 / network / empty sets)  step "sets": renderSeoPlanSets(n)
               ▼                                    │  user picks → selectSeoKeywordSet(n, i)
   setSeoWalkthroughError(n, "SEO plan failed: …")  ▼
   step stays "plan", button re-enabled,     step "style": choose SEO_IMAGE_STYLES
   Retry available                                    │  confirmSeoStyleAndGenerate(n)
                                                      ▼
                                            step "script": runSeoScriptRequest(n, …)
                                                      │  POST /api/script {topic, minutes, speed, keywordSet, …}
                                                      ▼
                                              script rendered into #va-script-box-n
                                              closeSeoWalkthrough(n) → startImagePromptFlow(n)
```

Key functions:

| Function | Lines | Contract |
| --- | ---: | --- |
| `generateScript(n)` | 23,716 | Entry from the accordion. Validates topic/minutes/speed, resets the two sets, disables uploads, shows the modal at `plan`, `fetch("/api/seo-plan")`, tolerates `partial: true` with one set, writes `project.seoSets`, re-opens the right accordion/modal after renumbering, and on any failure writes `"SEO plan failed: " + message` to `#va-script-status-n` **and** to the modal error slot. |
| `renderSeoPlanSets(n)` | 23,671 | Renders 1–2 selectable cards (title, headings, long-tail, four shorts). |
| `selectSeoKeywordSet(n, idx)` | 24,016 | Stores the pick, immediately writes the browser script-note memory (`topic`, `sourceUrl`, `minutes`, `speed`, `keywordSet`, `outline`), shows the style step. |
| `confirmSeoStyleAndGenerate(n)` | 24,091 | Stores `videoImageStyle`, moves to the `script` panel, sets `_imageFlowActive`, awaits `runSeoScriptRequest`, re-resolves `n`, re-enables the UI on failure, closes the modal and starts the image flow on success. |
| `runSeoScriptRequest(n, topic, minutes, speed)` | 27,099 | `POST /api/script` with the chosen set; the browser owns the retry ladder (initial write + up to 7 retries at 40 s spacing, `singleAttempt` requests), writes the note after each success. |
| `setSeoWalkthroughError`, `setSeoWalkthroughScriptStatus`, `showSeoWalkthroughStep` | 23,325 / 23,331 / 23,521 | UI plumbing; `showSeoWalkthroughStep` also toggles step chips (`active`/`done`) and the Escape-guard (`_seoChoicePending`). |
| `startImagePromptFlow(n)` | 24,619 | Automatic media flow: script → 14 scene keywords (8 photos + 6 clips) → Pixabay search → gallery. |
| `retryImagePromptFlow(n)` | 25,364 | Manual retry using the keywords already shown. |

`ensureSeoWalkthrough` survives a closed window: generation continues in the background and the modal
re-opens when there is something to choose, exactly as the modal's own copy promises.

### 6.5 Image flow inside the editor layout

* **Which media:** 8 distinct Pixabay photos + 6 Pixabay clips = **14 scenes**, fixed for every script
  length (`AUTO_MEDIA_TOTAL`). The gallery line `#va-ai-status-N` states the contract (“6 stock video
  clips and 8 distinct photos”, corrected this session) and is rewritten with live progress.
  `browserImageScenePositions(14)` places the photo scenes inside the clip scenes.
* **Ordering:** gallery cards are draggable; `onVideoFiles` appends uploads; `toggleGalleryScroll`
  collapses the strip; `#va-gallery-toggle-N` keeps the section usable on long galleries.
* **Failure paths:** every guard reports into `#va-script-status-N` / `#va-ai-status-N`; retryable
  stops schedule **one visible auto-retry** (countdown in the status line, bounded by
  `IMAGE_AUTO_RETRY_LIMIT = 2`, waiting `retryAfterMs` clamped to
  `[2 s, 120 s]`), re-running **only the missing scenes** so nothing is billed twice.
* **Cancellation:** Stop, a new flow, or deleting the video cancels the retry timer and the in-flight
  requests.
* **No manual prompt panel** exists any more (media policy 2026-10-29); “Retry Pixabay search” is the
  only manual escape hatch and it reuses the planned keywords.

### 6.6 Voiceover, subtitles, preview, export

* `syncVoiceoverButton(n)` shows `#va-voice-btn-N` once a script exists;
  `openVoiceoverModal(n)` posts `/api/voiceover` (MeloTTS) and applies the MP3 as the video's audio
  **and** derives timestamped captions from the narration (never the reverse).
* Preview paints into `#video-canvas` (1280×720 base) with the project's media, title font/colour and
  the style filter (`window.__videoStyleFilter`, `window.__videoStyleEffects`).
* `onGenerateClick()` renders the current video; the top-bar button stays disabled while
  `generating` is true.
* The editor layout is **not** the export owner for table rows: table Preview/Export read the row's
  saved project (`openBatchPreview`, `exportBatchRow`), which is why the timeline state is reconciled
  before either runs.

### 6.7 Persistence and handoff

| Store | Key | Owner |
| --- | --- | --- |
| localStorage | `ytvs.pipeline-management.v1.<pageId>` | page-wide snapshot: rows, editor projects, layout |
| cookies | `ytvs_pipeline_management_<pageId>_1..4` | compact mirror (may omit rows) |
| localStorage | `ytvs.timeline-editor.v1.<projectId>` | authoritative timeline project |
| cookies | `ytvs_timeline_editor_<safeId>_1..8` | multipart mirror (digest, version, part index) |
| localStorage | `ytvs.transition-project.v1.<handoffKey>` | short-lived handoff identity/settings |
| IndexedDB | `ytvs-timeline-editor-assets-v1` | media blobs (never in cookies) |

`persistPipelineManagementState(reason)` / `restorePipelineManagementState()` own the page snapshot;
the pipeline store reports failures through `#pipeline-storage-alert` (with a “Reset pipeline state”
button). Blank rows are purged on load (`purgeBlankRowArtifactsInStorage`). The timeline editor is the
only writer of a full project while it holds the ownership Web Lock (Session 331 rules).

---

## 7. Server-side SEO pipeline internals

### 7.1 `POST /api/seo-plan` — the planner

```
POST /api/seo-plan {topic}
  │  topic: control chars stripped, whitespace collapsed, ≤ 160 chars, "my video" if empty
  │  no AI binding → 503 {success:false,error:"AI binding not configured"}
  ▼
handleSeoPlanGeneration(request, env, SCRIPT_MODEL)
  │
  ├─ set #1: planOneSeoKeywordSet(env, scriptModel, topic)
  │     models = [scriptModel, ...SEO_PLAN_FALLBACK_MODELS]   // deduped, order preserved
  │     per model: up to 3 VALIDATION attempts (temp 0.55, then 0.4)
  │       per attempt: runPlannerModelCall() → up to 2 TRANSPORT attempts, 45 s each
  │         - "AI binding not configured" → immediate {ok:false}
  │         - empty reply → counted as a failure
  │         - thrown AiError/timeout → counted, 400·attempt backoff
  │       transport failure → record and move to the NEXT MODEL
  │       validation failure → retry same model with the exact problem in the prompt
  │
  ├─ set #2: planOneSeoKeywordSet(env, scriptModel, topic, {avoid:set#1})
  │     identical set → treated as a validation failure and retried
  │     still failing → DEGRADED SUCCESS: 200 {sets:[set#1], partial:true, warning}
  │
  └─ failure of set #1 → 500 {success:false, error:"SEO planner model failed (…) - try again"}
       console.error("[seo-plan] failed", {topic, stage:"first-set", ms, error})
```

Validation (`parseKeywordSet`) is deliberately lenient about *shape* (`long_tail`, `shorts`, objects,
delimited strings, five shorts → first four) and strict about RULE 7 (one long-tail, exactly four
shorts, title/heading constraints).

### 7.2 `POST /api/script` — planner + writer

Stage 1 reuses `planOneSeoKeywordSet` (unless the browser already sent the chosen `keywordSet`, in
which case the planner is skipped entirely — the walkthrough's whole point). Stage 2 writes
timestamped cues, validates them (`validateSrt`), repairs shortfalls (`repairKeywordShortfall`), and
returns **plain narration** plus the keyword set, title and headings.

Budget constants:

| Constant | Value | Meaning |
| --- | ---: | --- |
| `SEO_PLAN_AI_TIMEOUT_MS` | 45,000 | One planner transport attempt |
| `SEO_SCRIPT_AI_TIMEOUT_MS` | 90,000 | One writer attempt |
| `SEO_PROGRESS_BUDGET_MS` | 105,000 | Longest healthy silence (writer attempt + 15 s) |
| `SCRIPT_MIN_ATTEMPT_MS` | 5,000 | Smallest attempt worth starting |
| `SEO_PLAN_TRANSPORT_ATTEMPTS` | 2 | Transport attempts **per model** |
| `SCRIPT_BROWSER_RETRY_LIMIT` | 7 | Browser retries after the initial write |
| `SCRIPT_BROWSER_RETRY_BACKOFF_MS` | 40,000 | Spacing of those retries |

### 7.3 Models

```ts
const SCRIPT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";           // src/index.ts
export const SEO_PLAN_FALLBACK_MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
```

The fallback list exists because the cheapest 8B instruct model is the one that gets overloaded,
deprecated or produces garbage. Both slugs are **instruct** models, so both are allowed through
`permitsNonVisualModel()` and both can be routed to OpenRouter by RULE 34.

---

## 8. API relay and provider rotation internals

### 8.1 The three layers

1. **`withRelayedAi(env, request, options)`** — a Proxy whose `AI` property is
   `createRelayRuntime(...).ai`. Every existing `env.AI.run()` call site rotates with no change.
2. **`POST /api/relay/ai`** — inbound compute endpoint. HMAC token (model + body digest), body ≤ 512 KB,
   result ≤ 24 MB, model slug regex `^@[a-z0-9-]+/[A-Za-z0-9._/-]{2,120}$`, non-visual only, deadline
   240 s, **never relays again**.
3. **Browser hand-out** — `GET /api/relay/endpoint?path=…` returns `{url, local, endpointId, ticket}`;
   the studio calls exactly that URL. `src/client/api-rotation.ts` may report one failure
   (`&failed=<id>`) and call the next answer.

### 8.2 Selection and health

* `resolveRelayPool()` → `[local, ...≤5 backups]`, cached 20 s, deduped by origin, ids derived from
  the URL.
* `orderRelayCandidates()` → healthy members on the weighted ring, rotated by one slot per call;
  cooling members last; local appended as backstop.
* `pickRelayEndpoint()` → the server-side pick for the browser.
* `relayHealthSnapshot()` → per-member successes/failures/inFlight/openedUntil/lastError/ewma.

### 8.3 Error taxonomy (worker→worker)

| Situation | What `runRemoteModel` throws | Name | Fail over? |
| --- | --- | --- | --- |
| Network/DNS/TLS failure | the fetch rejection | `TypeError`/other | yes (transient) |
| Our deadline fired | `Relayed model call timed out after N s` | `TimeoutError` | yes |
| Caller aborted | AbortError | `AbortError` | no (never replay) |
| Member answers non-2xx with `kind:"model"` (or 400) | endpoint's message | `ModelError` | no (authoritative) |
| Member answers any other non-2xx (401/404/405/410/413/5xx) | `Relay endpoint answered <status>` | `RelayError` | **yes — after this session's fix** |
| Member returns `{ok:true,result}` | — | — | n/a |
| Member returns binary (`x-yvs-relay-result: binary`) | — | — | n/a |

The `RelayError` row is the fix in §10; before it, a 404 was re-classified as *fatal* by
`classifyImageFailure()` and stopped the chain.

---

## 9. The investigation: "Relay endpoint answered 404"

### 9.1 The message, decoded

The studio shows:

```
SEO plan failed: SEO planner model failed
(@cf/meta/llama-3.3-70b-instruct-fp8-fast: Relay endpoint answered 404)
```

Produced by three layers:

| Fragment | Source |
| --- | --- |
| `SEO plan failed: ` | `src/client/app-js.ts:23993` — the accordion status line and the walkthrough error slot |
| `SEO planner model failed (…) - try again` | `src/modules/script-seo.ts:1410` (`planOneSeoKeywordSet`, no usable reply) |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast: ` | the model whose transport error was recorded **last** (the fallback slug) |
| `Relay endpoint answered 404` | `src/modules/api-relay.ts:1074` (`runRemoteModel`, `!response.ok`, body had no `error`) |

It is an **HTTP 404 from a Worker pool member at `<backup>/api/relay/ai`**, not a Workers AI model
error. The receiving endpoint never answers 404: it answers 400 (bad JSON/slug), 401 (token/digest),
405 (non-POST), 410 (visual model), 413 (body too large), 503 (no AI binding), 504 (deadline) or 502
(model failed). A 404 can only come from *something that is not that route* — an older deployment, a
different app, a typo'd URL, a route/host binding that does not cover the path, or a paused Worker.

### 9.2 Reproduction (before the fix)

`/tmp/repro-404b.mjs` (throwaway; not committed) built a runtime for one request with:

* pool = local + `https://old-backup.example.workers.dev`,
* `fetchImpl` answering **404** (HTML body, empty body, and `text/plain` variants),
* a local `AI.run` that answers `"LOCAL OK"`.

Result for all three body variants:

```
call 0 OK: {"response":"LOCAL OK"}
call 1 THREW: Relay endpoint answered 404 [RelayError]
call 2 THREW: Relay endpoint answered 404 [RelayError]
call 3 THREW: Relay endpoint answered 404 [RelayError]
localCalls: 1
health: { "worker:https://old-backup…": { failures: 0, openedUntil: 0, state: "ready" } }
```

Three defects in one trace:

1. **No fail-over.** Only the call that happened to start on local succeeded. Every call that started
   on the backup aborted before the local backstop.
2. **No circuit breaking.** The dead member stayed `ready` and was picked again — with
   `localWeight 1` vs `RELAY_BACKUP_RING_WEIGHT 3`, that is ~75 % of calls.
3. **Misleading attribution.** The planner overwrote `transportError` per model, so the message named
   the last fallback slug even though *every* model had failed with the same pool error.

A JSON 404 body (`{"error":"not found"}`) did fail over in the same harness, because the body replaced
the message and `"not found"` happens not to match a FATAL pattern. That is why the bug looked
intermittent and why it only appeared with real (HTML/empty) 404s.

### 9.3 Causal chain, step by step

1. Editor layout → “✨ Generate SEO Script” → `generateScript(n)` → `POST /api/seo-plan`.
2. The Worker wraps `env` (`withRelayedAi`); `handleSeoPlanGeneration` → `planOneSeoKeywordSet`.
3. `runPlannerModelCall` → `env.AI.run(SCRIPT_MODEL, …)` → relay runtime.
4. Pool has a backup, so `orderRelayCandidates` may put it first (3 ring slots vs local's 1).
5. `runRemoteModel` → `POST https://<backup>/api/relay/ai` → **404**.
6. `runRemoteModel` builds `new Error("Relay endpoint answered 404")` with `name = "RelayError"`
   (no `kind` header, status ≠ 400).
7. `runViaWorkersAi` catch → `isTransientRelayFailure(error)`:
   * name is not `AbortError` / `TimeoutError` / `ModelError`;
   * message has no “binding not configured”;
   * `classifyImageFailure()` → message matches FATAL `/\b404\b/` → `kind: "fatal"` → **`false`**.
8. `if (!isTransientRelayFailure(error)) throw error;` → the chain aborts; **local never runs**.
9. `runRemoteModel` never records the failure (`noteRelayFailure` is only called for transient
   failures), so the member is not cooled and step 4 repeats next time.
10. `runPlannerModelCall` retries the same model once (2 transport attempts) → same 404.
11. `planOneSeoKeywordSet` moves to the fallback model → same 404 → `transportError` is overwritten
    to `"@cf/meta/llama-3.3-70b-instruct-fp8-fast: Relay endpoint answered 404"`.
12. `/api/seo-plan` answers **500** `{success:false, error:"SEO planner model failed (…70b…: Relay
    endpoint answered 404) - try again"}`.
13. The studio prefixes it with `SEO plan failed: ` and shows it in `#va-script-status-N` and the
    walkthrough.

So the 70B model was never asked anything. It is the *last* slug in the candidate list, nothing more.

### 9.4 Why the rest of the UI looked healthy

* Quick Batch rows use the same path but often start their script through the table, and any call that
  happened to land on local (1 in 4) succeeded — the failure looked like a flaky model.
* The browser rotation never saw the 404: the 404 happened **inside** the Worker (worker→worker), and
  `/api/seo-plan` itself answered 500.
* `GET /api/relay/pool` **does** hide unverified backups, but that is a different route; the compute
  path (`runViaWorkersAi`) uses the raw pool. So the settings page could look fine while the compute
  pool contained a dead member.

### 9.5 What a 404 on `/api/relay/ai` means operationally

| Possible cause | How to confirm |
| --- | --- |
| Backup runs an **older deployment** without Session 331 relay routes | `curl https://<backup>/api/relay/ping` → 404, or HTML `Not Found` |
| URL is **not this app** (wrong Worker/domain, a Pages project) | same ping; `/api/relay/status` shows `probeError: "HTTP 404"` |
| URL has a **path prefix** that the Worker's route does not cover | `normalizeUrl()` keeps non-`/api` paths; check the route pattern |
| Worker is **paused/deleted** | usually 1019/1042 or DNS failure, occasionally a plain 404 from the edge |
| Custom domain route added but **deployment targets a different zone** | ping on the workers.dev URL succeeds, the custom domain 404s |

RULE 36 makes all of those recoverable; the runbook in Appendix C makes them visible.

---

## 10. The fix (code changed in this session)

### 10.1 `src/modules/api-relay.ts` — `RelayError` is always transient

`isTransientRelayFailure()` now returns `true` for `name === "RelayError"` **before** the generic
classifier, with the reasoning documented in place: a member's status line says everything about that
deployment and nothing about the model. `ModelError` (endpoint `kind:"model"` or 400) remains fatal;
`AbortError` remains non-transient.

### 10.2 `src/modules/api-relay.ts` — a route-level 404 names the member

For 404/405/501 without a `kind` header, `runRemoteModel` appends
`" (<url> does not serve /api/relay/ai - an older or non-relay deployment)"` and tags the error with
`relayStatus` / `relayUrl` for diagnostics. The message prefix `Relay endpoint answered <status>` is
unchanged, so existing logs and docs still match, and the tag does not participate in the decision.

### 10.3 `src/modules/script-seo.ts` — every failed model is reported

`planOneSeoKeywordSet` collects `transportErrors[]` (`"<model>: <error>"`) instead of overwriting a
single string, and joins them (`"; "`) in both terminal messages. A pool-wide fault now reads:

```
SEO planner model failed (@cf/meta/llama-3.1-8b-instruct-fp8: Relay endpoint answered 404 …;
@cf/meta/llama-3.3-70b-instruct-fp8-fast: Relay endpoint answered 404 …) - try again
```

### 10.4 `src/client/api-rotation.ts` — 404/405/501 are dead endpoints for the browser too

`shouldFailover()` now covers 404, 405 and 501 in addition to 502/503/504 (and a missing response). A
backup that never had `/api/seo-plan` used to surface as `SEO plan failed: HTTP 404`; now the studio
reports the URL once (`&failed=<id>`) and calls the answer it gets back (normally this Worker). 400,
401/403 and 429 are deliberately **not** retried: those are the route's own answer and would repeat.

### 10.5 `src/client/app-js.ts` — one stale contract hint corrected

The editor accordion's media line (`#va-ai-status-N`) said “4 stock video clips and 8 distinct
photos” while `AUTO_VIDEO_SCENES = 6`. RULE 18 treats that copy as contract text, so it now reads
“6 stock video clips and 8 distinct photos”, matching `AUTO_MEDIA_TOTAL = 14`, the table note
(`markup.ts`) and `/api/pipeline-capabilities`. No test asserted the old string.

### 10.6 Tests

New `tests/session-332-relay-404.test.mjs` (7 tests):

| Test | Pins |
| --- | --- |
| 404 with an HTML body fails over to local | fail-over + `failedOver` stat + local AI called once |
| empty-bodied 404 fails over | the message path with no JSON to soften it |
| 401 transient vs `kind:"model"` fatal | the taxonomy boundary |
| planner reports every failed model | both slugs in one error |
| single model keeps the familiar text | `planner model failed (only-model: …) - try again` |
| browser 404 failover | two asks, `failed=<id>` reported, local answered, `failovers = 1` |
| healthy relayed answer unchanged | `x-yvs-relay-result` handling |

---

## 11. Verification log

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts` | OK (node_modules was absent in the workspace) |
| `node --import tsx /tmp/repro-404b.mjs` (pre-fix) | reproduced: 1 local answer, 3 throws, dead member `ready` |
| `node --import tsx --test tests/api-relay.test.mjs tests/seo-plan-resilience.test.mjs` (pre-fix) | **48/48 pass** — the defect had no coverage |
| `node --import tsx --test tests/session-332-relay-404.test.mjs tests/api-relay.test.mjs tests/seo-plan-resilience.test.mjs` (post-fix) | **55/55 pass** (10.7 s + 11.9 s runs) |
| `npx tsc --noEmit` | 32 errors, **all pre-existing in `src/index.ts`** (`TS7006`/`TS7053`/`TS18046`/`TS2345`); **none** in `api-relay.ts`, `script-seo.ts`, `api-rotation.ts`, `image-load.ts` |
| `node --import tsx --test tests/{session-332-relay-404,api-relay,seo-plan-resilience,seo-walkthrough,final-media-cap-actions,pixabay-studio-flow}.test.mjs` | **104 tests: 85 pass, 19 fail**, 61 s |
| Same three suites on a clean worktree of the **base commit** (`git worktree add /tmp/base332 HEAD`) | **19 fail, byte-for-byte the same test names** — the failures are pre-existing (they assert the superseded 12-scene/8+4 contract and older NDJSON flows), so this session causes **zero regressions** |
| `npm test` (full suite, 900 s cap) | did not complete inside the cap; the visible failures are the known legacy ones (e.g. `deep-debug-regressions.test.mjs` “VideoEncoder must use the row's Portrait 9:16 …”), unrelated to this change |

---

## 12. Known issues, drift and follow-ups

1. **`src/index.ts` does not typecheck cleanly** (32 errors, pre-existing). `npm run check` (`tsc &&
   wrangler deploy --dry-run`) therefore fails for reasons unrelated to this session.
2. **Legacy test failures** remain in `tests/deep-debug-regressions.test.mjs` and possibly other
   older suites; Session 331 recorded the same class of legacy failures.
3. **The compute pool does not require a verified ping.** `GET /api/relay/pool` filters unverified
   members; `runViaWorkersAi` does not. With RULE 36 a dead member now costs one failed hop and one
   cooldown instead of a dead request, but a probe-gated pool (opt-in, cached) would avoid even that.
   Not changed here: a probe per model call would add latency and load.
4. **`defaults` for OpenRouter**: an instruct call can still be permanently fatal if OpenRouter
   rejects the key (`ModelError`-class behaviour); that is intended.
5. **`normalizeUrl()` keeps non-`/api` path prefixes.** A backup registered as
   `https://x.workers.dev/app` will be called at `/app/api/relay/ai`; if the deployment does not serve
   that, the member now reports and cools instead of killing the plan. Documented in Appendix C.
6. **`src/index.ts.original`** remains in the tree (21 k lines of dead code) and is easy to confuse
   with the live router.
7. **Docs vs code drift** (unchanged by this session): page-heading copy, sticker references and
   AI-image wording are historical; RULE 17/`inconsistent.md` track these.
8. **Scene-count drift, now recorded.** The running code is **14 scenes (8 photos + 6 clips)**; the
   README intro, the governing media rule in `system-rules.md`, the FINAL RULE block and
   `bug-fix-session-275-scene-count-consistency.md` still describe **12 (8 + 4)**. The one
   *user-visible* stale hint — the editor accordion's
   `#va-ai-status-N` text (“Automatic Pixabay scenes include 4 stock video clips and 8 distinct
   photos”) — was corrected to “6 stock video clips” in this session, because RULE 18 makes that
   copy part of the contract. The Markdown statements were left as history: rewriting them safely
   means auditing every session file that repeats the old number, which is a documentation task, not
   a code fix.
9. **`SEO_PLAN_FALLBACK_MODELS` is a single slug.** Two independent planner faults still share the
   last-model naming: the fix now lists both, but adding a second, cheaper instruct model would give
   the planner a third chance. Not changed here (cost decision, and the pool no longer kills the
   call).

---

## Appendix A — symbol index

**Editor layout (editor = default studio view)**

| Symbol | File | Line |
| --- | --- | ---: |
| `videoAccordionHTML` | `src/client/app-js.ts` | 9,804 |
| `addVideoAccordion` | `src/client/app-js.ts` | 9,024 |
| `toggleVideoAccordion` | `src/client/app-js.ts` | 9,133 |
| `ensureEditorAccordionOnLoad` | `src/client/app-js.ts` | 9,187 |
| `openTemplateModalForTimeline` | `src/client/app-js.ts` | ~9,250 |
| `deleteVideoAccordion` | `src/client/app-js.ts` | 9,595 |
| `updateVideoStatus` | `src/client/app-js.ts` | 9,902 |
| `clickVaFiles` / `clickVaAudio` | `src/client/app-js.ts` | 9,750 / 9,772 |
| `setStudioLayout` | `src/client/app-js.ts` | 10,125 |
| `activateTimelineEditorLayout` | `src/client/app-js.ts` | 10,093 |
| `onVideoFiles` / `onVideoAudio` | `src/client/app-js.ts` | 17,466 / 17,716 |
| `generateScript` | `src/client/app-js.ts` | 23,716 |
| `ensureSeoWalkthrough` | `src/client/app-js.ts` | 23,364 |
| `renderSeoPlanSets` | `src/client/app-js.ts` | 23,671 |
| `selectSeoKeywordSet` | `src/client/app-js.ts` | 24,016 |
| `confirmSeoStyleAndGenerate` | `src/client/app-js.ts` | 24,091 |
| `startImagePromptFlow` | `src/client/app-js.ts` | 24,619 |
| `retryImagePromptFlow` | `src/client/app-js.ts` | 25,364 |
| `runSeoScriptRequest` | `src/client/app-js.ts` | 27,099 |
| `openVoiceoverModal` | `src/client/app-js.ts` | 27,440 |
| `syncVoiceoverButton` / `toggleScriptBox` | `src/client/app-js.ts` | 22,774 / 22,742 |
| `onGenerateClick` | `src/client/app-js.ts` | 18,420 |
| `composeEditorProjectDetail` | `src/client/app-js.ts` | 711 |
| `persistPipelineManagementState` | `src/client/app-js.ts` | 1,624 |

**Server**

| Symbol | File |
| --- | --- |
| `handleSeoPlanGeneration`, `planOneSeoKeywordSet`, `runPlannerModelCall`, `parseKeywordSet` | `src/modules/script-seo.ts` |
| `createRelayRuntime`, `withRelayedAi`, `orderRelayCandidates`, `runRemoteModel`, `runLocalModel`, `isTransientRelayFailure`, `handleRelayRoutes`, `handleRelayAiCall`, `probeRelayEndpoint` | `src/modules/api-relay.ts` |
| `classifyImageFailure`, `ImageLoadGovernor`, `parseRetryAfterMs` | `src/modules/image-load.ts` |
| `isInstructModel`, `orderLlmProviders`, `runOpenRouterCompletion` | `src/modules/llm-openrouter.ts` |
| `API_ROTATION_JS` (`shouldFailover`, `askForUrl`) | `src/client/api-rotation.ts` |

---

## Appendix B — error-message dictionary

| Message | Layer | Meaning / action |
| --- | --- | --- |
| `SEO plan failed: …` | studio UI | wraps whatever `/api/seo-plan` said; the modal offers Retry |
| `SEO planner model failed (…) - try again` | `script-seo.ts` | no model produced a usable set; the `(…)` lists every model's transport error |
| `SEO keywords invalid (…) - try again` | `script-seo.ts` | a model answered but broke RULE 7 after all attempts |
| `AI binding not configured` | `script-seo.ts` / relay | no `AI` binding on this Worker and no usable backup |
| `Relay endpoint answered <status>` | `api-relay.ts` | a pool member's HTTP answer; after the 404/405/501 branch it names the URL |
| `… does not serve /api/relay/ai - an older or non-relay deployment` | `api-relay.ts` | the member is not relay-capable: redeploy it or remove its URL |
| `Invalid or expired relay token` | `api-relay.ts` | `RELAY_SECRET` differs between Workers (401) |
| `Relay payload digest mismatch` | `api-relay.ts` | body changed between signing and delivery (401) |
| `Relayed model call timed out after N s` | `api-relay.ts` | per-attempt deadline (`TimeoutError`, transient) |
| `Relayed model call did not finish within N s` | `api-relay.ts` | receiving-side deadline (504 + `kind:transient`) |
| `AI image generation is disabled; use Pixabay` | `api-relay.ts` | a visual model slug was requested (410) |
| `Invalid model slug` | `api-relay.ts` | slug failed `RELAY_MODEL_PATTERN` (400) |
| `All API relay endpoints failed` | `api-relay.ts` | chain exhausted without a member answering |
| `Only one keyword set …` (`partial: true`) | `script-seo.ts` | degraded success, not an error |

---

## Appendix C — operations runbook

**Find the offending backup**

1. Open `https://<this-worker>/{today-in-Asia-Taipei}/config/uvxyz` (password `CONFIG_PASSWORD`).
2. Read the relay panel's endpoint list; press **Test** (`POST /api/relay/test`) to force a fresh probe.
3. Or by hand:
   * `curl -s https://<backup>/api/relay/ping` → must answer
     `{"success":true,"app":"youtube-vibe-studio","relay":1,"capabilities":{"ai":true,…}}`.
     `404`/HTML → that deployment predates the relay routes.
   * `curl -s 'https://<this-worker>/api/relay/status?probe=1'` → per member `reachable`,
     `probeError`, `lastError`, `coolingUntil`.
4. Remove the URL in the settings page (max 5) or redeploy the backup from this branch.

**Stop the bleeding immediately**

* Set `RELAY_ENABLED=false` in the Worker's variables (the pool then behaves like a single Worker), or
* clear `config:workers` in KV (`RELAY_WORKERS_KEY`), or
* set `config:relay` `{ "enabled": false }` via the settings page.

**Keep the pool healthy**

* `RELAY_SECRET` must be identical on every Worker (otherwise 401s).
* Every member must be deployed from Session 331 or later (relay routes + `/api/relay/ai`).
* Register origins, not deep links; `/api` prefixes are stripped by `normalizeUrl()`, other paths are
  kept and must exist on the target.
* Watch `GET /api/relay/status` `health`: a member with `consecutiveFailures` climbing and
  `lastError` containing `does not serve /api/relay/ai` is misconfigured.

**Confirm the fix in production**

1. `POST /api/seo-plan {"topic":"test"}` from the studio with a deliberately broken backup registered:
   the plan must still succeed (local answers), `GET /api/relay/status` must show the broken member
   `cooling` with `lastError` naming the missing route.
2. With all backups broken, the error (if any) must list every model with the same relay text — not
   just the 70B fallback.
3. Browser side: a backup missing `/api/seo-plan` must produce one `&failed=<id>` ask and a successful
   local answer instead of `SEO plan failed: HTTP 404`.
