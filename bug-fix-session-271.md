# Bug Fix Session #271 — worker-mode flows, rotation audit, and the OpenRouter instruct provider

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

**Date:** 2026-10-26 · **Branch:** `arena/89a581b7-text-to-image-template`
**Scope:** (1) the *deployment-without-a-frontend* ("worker mode") system + user flows,
(2) a hang/leak audit of the #265 rotation, (3) a **second instruct-model API** that rotates
between Cloudflare Workers AI and **OpenRouter** (`meta-llama/llama-3.3-8b-instruct:free`).

Everything below is implemented, documented and covered by `npm test` (**260** cases green).

---

## 0. Summary of what changed

| # | Change | Where |
| --- | --- | --- |
| 1 | **OpenRouter provider** for every instruct-model call (SEO plan, script writer, scene prompts, raw API) | `src/modules/llm-openrouter.ts` (new) |
| 2 | **Provider rotation** Cloudflare ⟷ OpenRouter, sitting *above* the Worker-pool rotation | `createRelayRuntime()` in `src/modules/api-relay.ts` |
| 3 | **Second API** for external callers: `POST /api/llm/generate` | `src/index.ts` |
| 4 | Admin panel **LLM Providers & OpenRouter** (policy, key, health, test) | `src/client/config-page-js.ts` |
| 5 | Admin routes `GET /api/llm/status`, `GET/POST /api/llm/config`, `POST /api/llm/test` | `src/modules/llm-openrouter.ts` |
| 6 | **Hang fixes** found by the audit (6 defects, see §3) | relay + settings page |
| 7 | Worker-mode **system flow** and **user flow** documentation | this file, `userflow.md`, `README.md`, `system-rules.md` (RULE 33 addendum, RULE 34) |

---

## 1. Worker mode — what "deployed as a worker, no front end" actually means

Two different things are called *worker mode* in this repository. Both are documented here because
the rotation touches both.

### 1.1 System flow — the Worker as a headless API

When the same deployment is used only through its HTTP surface (a script, another service, a
mobile client, a `curl` call), no HTML is consumed and no browser renders anything. The Worker is
then just an API host, and the following flow applies:

```
                       ┌─────────────────────────────────────────────────────────┐
 external caller ─────▶│ Cloudflare Worker (this repo)                           │
 (no front end)        │                                                         │
                       │  1. routing            src/index.ts :: handleRequest()  │
                       │  2. env.AI upgrade     withRelayedAi() ── api-relay.ts  │
                       │       ├─ PROVIDER rotation   llm-openrouter.ts          │
                       │       │     cloudflare  ⟷  openrouter                   │
                       │       └─ POOL rotation      api-relay.ts                │
                       │             this Worker ⟷ backup Workers (admin URLs)   │
                       │  3. KV: accounts, credits, CMS, payments, cache         │
                       └─────────────────────────────────────────────────────────┘
```

Consequences of headless operation (all intentional, all pre-existing):

* **No cookie jar.** A caller must send `Cookie: yvs_session=…` itself, or `Cookie: yvs_free=1`
  to act as a guest. `POST /api/llm/generate` follows the same rule: signed-in **or** the guest
  cookie when KV is bound, `401` otherwise.
* **No `Origin` header.** Same-origin rules never apply, so no CORS preflight is needed and the
  relay CORS layer stays completely inert (it only reacts to `Origin`).
* **No `yvs_free` bootstrapping route.** `GET /free` sets that cookie in a browser; a headless
  caller sets the header by hand, or signs in with `POST /api/login` and keeps the
  `Set-Cookie` value.
* **No background-worker tab.** `GET /api/worker/poll` still exists, but nothing polls it unless
  an operator runs §1.2 or writes their own poller. Render jobs submitted through
  `POST /api/render` stay `queued` until a poller claims them.
* **HTML routes are still served** (`/`, `/studio`, `/free`, `/{day}/config/uvxyz`, CMS pages).
  A headless deployment simply ignores them; nothing in the API depends on them.

### 1.2 User flow — an operator opening the settings URL in a tab ("background worker mode")

```
operator ──▶ GET /{day}/config/uvxyz            (Asia/Taipei day, e.g. /26/config/uvxyz)
             └─ studio HTML + CONFIG_PAGE_SCRIPT
                └─ Unlock: POST /api/config/verify {pw}
                   └─ TAB 1 "General & Themes"
                      ├─ theme cards → POST /api/config/theme
                      ├─ Registered Background Workers → GET/POST /api/config/workers
                      │     └─ saved URLs become the API-rotation pool (§2)
                      ├─ API Rotation & Backup Worker Pool          [bug fix #265]
                      │     ├─ GET  /api/relay/status   (health, probes)
                      │     ├─ POST /api/relay/config   (policy, pw)
                      │     └─ POST /api/relay/test     (fresh probes, pw)
                      ├─ LLM Providers & OpenRouter                 [bug fix #271]
                      │     ├─ GET  /api/llm/status     (providers, key source, health)
                      │     ├─ GET  /api/llm/config     (policy; key never echoed)
                      │     ├─ POST /api/llm/config     (policy + key, pw)
                      │     └─ POST /api/llm/test       (one prompt, both providers, pw)
                      └─ Background Worker Mode: Start Worker
                            loop: GET /api/worker/poll   (every 3 s while idle)
                                  └─ window.workerRunJob(job)      ← WebCodecs render
                                     └─ POST /api/worker/deliver?job=<id>
                                     └─ on error: POST /api/worker/failed?job=<id>
                                  └─ 15 min deadline (bug fix #271) → failed, loop continues
```

The tab keeps running while open; closing it stops polling. Rotation is orthogonal: the render
queue never leaves the primary Worker, while the studio's AI routes keep rotating.

### 1.3 Failure matrix additions for worker mode

| Situation | Detected by | Behaviour |
| --- | --- | --- |
| Headless caller without a cookie | `/api/llm/generate` | `401 "Sign in or open /free to use the LLM API"` |
| Renderer never settles | settings page `withWorkerDeadline()` | job reported `failed` after 15 min, polling resumes (was: stuck `busy` forever) |
| No background tab running | `POST /api/render` | job stays `queued` (documented, unchanged) |
| OpenRouter key rejected | `runOpenRouterCompletion` | circuit opens 60 s → 10 min; the call falls back to Cloudflare |
| Both providers down | `createRelayRuntime().run()` | the last provider error is surfaced (`502` on the raw API) |
| Pool + provider both failing | same | local Workers AI is always the final backstop |

---

## 2. Rotation: two nested layers

```
                     ┌─ PROVIDER rotation (new, bug fix #271) ─┐
 instruct call ─────▶│  cloudflare  ⟷  openrouter              │
                     └───────────────┬─────────────────────────┘
                                     │ "cloudflare"
                     ┌───────────────▼─────────────────────────┐
                     │  POOL rotation (bug fix #265)           │
                     │  this Worker ⟷ backup Workers (admin)   │
                     └─────────────────────────────────────────┘
```

* **Provider** decides *which vendor* runs the instruct model. `openrouter` spends **zero**
  Workers AI neurons; `cloudflare` spends neurons on whichever pool member answers.
* **Pool** decides *which deployment* runs a Cloudflare call. It never applies to OpenRouter
  calls, because those are a direct HTTPS call to `openrouter.ai` from the Worker that received
  the request.
* Only **instruct models** enter the provider rotation (`isInstructModel()`), so SDXL/Flux/MeloTTS/
  Aura/BGE never leave Workers AI.
* The nesting preserves the #265 guarantee: a `POST /api/relay/ai` compute call executes on the
  **raw** binding and never rotates again — not to another Worker **and** not to OpenRouter.

### 2.1 Who rotates, exactly

| Route | Model | Provider rotation | Pool rotation |
| --- | --- | --- | --- |
| `POST /api/seo-plan` | instruct (llama-3.1-8b / 3.3-70b fallback) | ✅ | ✅ (when on Cloudflare) |
| `POST /api/script` | instruct | ✅ | ✅ |
| `POST /api/image-prompts` | instruct | ✅ | ✅ |
| `POST /api/llm/generate` | instruct | ✅ (or forced) | ✅ (when on Cloudflare) |
| `GET /image/:i`, `GET /image/gen`, `POST /api/image`, `POST /api/image-batch` | SDXL / Flux | ❌ | ✅ |
| `POST /api/voiceover`, `GET /tts` | MeloTTS / Aura | ❌ | ✅ |
| `POST /api/relay/ai` | any | ❌ (never) | ❌ (never) |
| auth, credits, CMS, payments, settings, render queue | — | ❌ | ❌ |

---

## 3. Hang / defect audit of the #265 rotation (all fixed)

"Anything hanging" was checked in three layers: the Worker relay, the browser rotation and the
settings page. Seven real defects were found and fixed (H7 was in the new module and was caught by the same audit).

| # | Defect | Symptom | Fix |
| --- | --- | --- | --- |
| H1 | **Pool ids were random** (`worker-<n>-<random>`) | health/circuit state is keyed by id, so every 20 s pool-cache rebuild reset every member's history: a broken backup looked healthy again and was retried forever | ids are derived from the URL (`worker:<url>`), so history survives cache rebuilds and identical URLs share state |
| H2 | **`/api/relay/pool` blocked on probes** when the route had no `waitUntil` | the studio's first pool read could wait up to 8 s × members | probe timeout cut to 5 s, probes run in parallel, `ctx.waitUntil` used when available, and browser requests are never delayed by the pool (`refreshPool(false)`) |
| H3 | **Cross-origin read was granted to any `Origin` + any ticket string** | CORS allowed a third-party page to read AI output with a forged ticket | `applyRelayCors()` now verifies the HMAC ticket **and** the path before adding the header |
| H4 | **Browser rotation dropped the query string** | a rotated `/image/gen?prompt=…` or `/tts?text=…` would have called the bare path | the wrapper rotates `pathname + search` (`targetOf()`), matching still uses the pathname |
| H5 | **A rotated request could be re-relayed** | the backup would relay the inference back to the primary that just sent it (2 extra hops) | `preferLocal` — a request carrying a rotation ticket always executes locally |
| H6 | **Background-worker tab could hang forever** | `await window.workerRunJob(job)` had no deadline; a stalled renderer left the tab `busy` (polling stopped) and the queue stalled | `withWorkerDeadline()` (15 min) reports the job failed and resumes polling |
| H7 | **An OpenRouter call could outlive its deadline** (defect in the new module, caught during this audit) | passing the caller's `AbortSignal` straight to `fetch` left the timeout with nothing to abort, and an *already*-aborted caller never settled at all | one internal controller owns both the timeout and the caller signal; a pre-aborted caller throws `AbortError` before any socket opens; a timeout is reported as `TimeoutError` and opens the circuit |

Two further hardening items landed with the same session:

* `readLlmConfig()` cache key includes KV presence, so a KV-less (e2e) env cannot serve a stale
  policy.
* `describeLlmProviders()` returns **key metadata only** (`source`, last six characters); the
  secret is never part of a serializable report.

### 3.1 Verified as *not* hanging (checked, left alone)

* `pollOnce()` — the only timer is `workerTimer`, cleared by `setWorkerActive(false)`.
* Browser pool refresh — single-flight (`state.loading`) and 45 s TTL.
* `rotatedFetch()` recursion — bounded by the endpoint list; local is the last entry.
* `orderRelayCandidates()` — every loop removes at least one element; all-zero weights terminate.
* `runLocalModel()` / `runRemoteModel()` — bounded by `timeoutMs` and the request `AbortSignal`;
  `inFlight` is decremented exactly once (the old double decrement was removed).
* `/api/relay/ai` — bounded by the caller's timeout; the receiver holds no pool state.

---

## 4. The OpenRouter provider (`src/modules/llm-openrouter.ts`)

### 4.1 Request shape

```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <key>
Content-Type: application/json

{ "model": "meta-llama/llama-3.3-8b-instruct:free",
  "messages": [ {"role":"system","content":"<system prompt>"},
                {"role":"user","content":"<prompt>"} ],
  "temperature": 0.7, "max_tokens": 500 }
```

`buildOpenRouterPayload()` maps the existing Workers AI payload onto this shape:
`prompt → messages[1]`, `max_tokens → max_tokens` (clamped to `maxTokensCap`, default 4096),
`temperature` clamped to `0–2` (default 0.7). The answer is read by `openRouterText()`
(`choices[0].message.content`, an array-of-parts variant, `choices[0].text`, or `output_text`) and
returned in the **same shape** `env.AI.run()` produces:

```json
{ "response": "<text>", "provider": "openrouter", "model": "meta-llama/llama-3.3-8b-instruct:free", "ms": 812 }
```

so `aiText()` and every validator/keyword audit in `script-seo.ts` / `image-prompts.ts` are
unchanged.

### 4.2 Key resolution

| Priority | Source | How |
| --- | --- | --- |
| 1 | `OPENROUTER_API_KEY` (or `OPEN_ROUTER_KEY`) | `wrangler secret put OPENROUTER_API_KEY` |
| 2 | KV `config:llm` → `apiKey` | *LLM Providers & OpenRouter* → **OpenRouter API key** → Save |
| 3 | *(none)* | no key anywhere → the OpenRouter half is skipped and every instruct call runs on Workers AI |

> **No key is compiled into the source, on purpose.** A key committed to a public repository is a
> leaked key: GitHub push protection rejects such a push, and anyone reading the source could spend
> the quota. Save the key once with
>
> ```bash
> npx wrangler secret put OPENROUTER_API_KEY
> ```
>
> or paste it into *LLM Providers & OpenRouter* → **OpenRouter API key** → **Save LLM Settings**
> (it is stored in KV `config:llm`, never in git). `GET /api/llm/status` then reports
> `keyConfigured: true`; until then the admin card shows a warning and the rotation stays on
> Cloudflare.

The key is **never** returned: `GET /api/llm/config` answers `hasStoredKey`, `keySource`
(`env` / `kv` / `none`) and `keyTail` (last six characters) only.

### 4.3 Provider selection

| `config:llm.provider` | Order | Notes |
| --- | --- | --- |
| `rotate` (default) | weighted pick, then the other provider | 1/1 alternates exactly (`cloudflare, openrouter, cloudflare, …`); any other weighting is a weighted random pick |
| `cloudflare` | `cloudflare` | Workers AI only; the pool still rotates the deployment |
| `openrouter` | `openrouter → cloudflare` | OpenRouter first, Cloudflare as the safety net |

* A failed provider (429/5xx/network/empty reply/bad key) falls through to the other one; the
  caller only sees an error when **both** fail.
* OpenRouter failures open a circuit: 60 s, doubling to 10 min. While cooling, `rotate` and
  `openrouter` both resolve to Cloudflare only — a rejected key never slows every script request.
* `enabled:false` (or `OPENROUTER_ENABLED=false`) pins everything to Workers AI.

### 4.4 Configuration (`config:llm`)

| Field | Default | Range / notes |
| --- | --- | --- |
| `enabled` | `true` | master switch |
| `provider` | `rotate` | `rotate` \| `cloudflare` \| `openrouter` |
| `model` | `meta-llama/llama-3.3-8b-instruct:free` | env `OPENROUTER_MODEL` overrides |
| `cloudflareWeight` | `1` | 0–10 |
| `openrouterWeight` | `1` | 0–10 (0 removes it from the rotation) |
| `timeoutMs` | `90000` | 5 s – 240 s |
| `maxTokensCap` | `4096` | 128 – 32768 |
| `maxPromptChars` | `40000` | 1 000 – 200 000 (raw API only) |
| `systemPrompt` | *"You are a helpful AI assistant…"* | ≤ 4 000 chars |
| `apiKey` | *(none)* | KV fallback for the environment key |

Environment variables: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_ENABLED=false`.
No new binding, no migration.

---

## 5. The second API — `POST /api/llm/generate`

A raw instruct-model endpoint for callers that are not the studio, routed through the same
rotation the studio uses.

```http
POST /api/llm/generate
Cookie: yvs_session=<token>          (or: Cookie: yvs_free=1)
Content-Type: application/json

{ "prompt": "Write five scene prompts about a golden retriever in a red sports car.",
  "maxTokens": 500,
  "temperature": 0.7,
  "systemPrompt": "optional override",
  "provider": "cloudflare" | "openrouter"     // optional; omit to rotate
}
```

```json
{ "success": true, "text": "…", "provider": "openrouter",
  "model": "meta-llama/llama-3.3-8b-instruct:free", "ms": 812,
  "rotation": { "relayed": 1, "local": 0, "failedOver": 0, "openrouter": 1,
                "cloudflare": 0, "providerFallback": 0, "endpoints": ["backup.workers.dev"] } }
```

| Case | Answer |
| --- | --- |
| No session and no guest cookie (KV bound) | `401` |
| Body is not a JSON object / no prompt | `400` |
| Prompt over `maxPromptChars` | `413` |
| Unknown `provider` | `400` |
| Both providers fail | `502` with the last provider error |
| Usage | recorded as the same `scripts` counter as `/api/script` (never blocks, never billed as an image) |

Admin routes for the same feature:

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/llm/status` | none | providers, model, key source/tail, health, `keyConfigured` |
| `GET /api/llm/config` | none | policy (`apiKey` blanked) + defaults |
| `POST /api/llm/config` | settings password | save the policy and/or the key |
| `POST /api/llm/test` | settings password | one tiny prompt to OpenRouter and/or Cloudflare, with timings |

---

## 6. Runbook

1. Deploy, then set the key once:
   `npx wrangler secret put OPENROUTER_API_KEY` (or save it on the settings page). With no key
   every instruct call stays on Workers AI and the admin card says so — nothing breaks.
2. With no `config:llm` the default policy is `rotate` with weights 1/1, so as soon as a key
   exists half the instruct calls go to OpenRouter.
3. Open `/{day}/config/uvxyz` → *LLM Providers & OpenRouter* → **Test Providers**. Both rows must
   say OK, with a timing each.
4. Choose the policy:
   * *Rotate* — half the instruct work leaves Workers AI (default).
   * *Cloudflare only* — the pre-#271 behaviour (with the #265 pool rotation still active).
   * *OpenRouter only* — maximum neuron saving; Cloudflare remains the fallback.
5. Watch `served`, `avg ms` and `last error` in the provider list; a red last error with a
   `cooling` badge means the key or the model slug is wrong, and Cloudflare is answering.
6. If the OpenRouter model is retired, change the slug in the same card (or
   `OPENROUTER_MODEL`); the free catalogue changes without notice.

---

## 7. Verification

```
npm test                      → 260/260 pass (was 236 after #265)
npx wrangler deploy --dry-run → bundles clean
npx tsc --noEmit              → same 30 pre-existing implicit-any errors as the base commit,
                                none in the new modules
```

`tests/llm-openrouter.test.mjs` (24 cases) pins: instruct-only routing, prompt extraction,
rotation order/weights/pinning, the cooling circuit, payload mapping and clamping, error handling,
empty replies, key resolution and non-leakage (including "no key ⇒ Cloudflare only"), the `env.AI.run()` result shape, image models never
leaving Workers AI, both fallback directions, the nested pool rotation, config validation and
password gating, status/test routes, the raw API (auth, validation, explicit provider, rotation
report), a relayed call never reaching OpenRouter, and the settings-page panel.

`tests/api-relay.test.mjs` (34 cases) keeps the #265 contract, with the pool tests pinning
`provider: "cloudflare"` so the two rotations are tested independently.
