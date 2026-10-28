# API rotation across the backup Workers

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

**Session #265 — 2026-10-26.** This document describes how the backup Worker URLs that the
settings page has always stored are now *used*, so the daily Workers AI bill (10,000 neurons on
the free plan, per account) and the inference load are spread across every deployment the operator
has.

> **Before this change.** `/{day}/config/uvxyz` → *Registered Background Workers* saved up to
> three URLs into KV (`config:workers`) and **nothing in the codebase ever contacted them**. The
> userflow said so explicitly: *"The registered worker URLs are stored only. Nothing in the
> codebase ever contacts them."* Every image, scene-prompt batch, SEO plan, script and voiceover
> ran on the deployment that served the page.

---

## 1. The pool

```
            ┌──────────────────────────────────────────────┐
browser ───▶│ primary Worker                               │
            │  routing · cookies · KV · credits · payments │
            │  env.AI  ──▶ rotation runtime                │
            └───────┬───────────────┬──────────────┬───────┘
                    │               │              │
            POST /api/relay/ai  POST /api/relay/ai  POST /api/relay/ai
                    ▼               ▼              ▼
              backup #1        backup #2       backup #3
              (same code)      (same code)     (same code)
```

A member is:

| Member | URL source | Notes |
| --- | --- | --- |
| This Worker | `new URL(request.url).origin` | always in the pool, always the final backstop |
| Backup 1–3 | KV `config:workers` (settings page) | validated as `http(s)`, ≤ 500 chars, deduplicated against our own origin |
| Extra | `RELAY_WORKERS` env var (comma separated) | deployment-wide, no KV write needed |
| Extra | `resolveRelayPool(..., { envWorkers })` | programmatic/test seam only |

The pool is cached **20 s per isolate**; `POST /api/config/workers` and
`POST /api/relay/config` invalidate it immediately. A deployment with no backups resolves to
`[this Worker]` and behaves exactly as before.

## 2. What rotates

Every `env.AI.run(model, payload)` call in the Worker runs through the rotation runtime, because
`withRelayedAi()` replaces only the `AI` binding on `env`. That covers **every** AI path with no
call-site changes:

| Route | Model work |
| --- | --- |
| `GET /image/:i` | demo SDXL image |
| `GET /image/gen` | single studio image |
| `POST /api/image` | binary image (one credit) |
| `POST /api/image-batch` | NDJSON batch of images |
| `POST /api/image-prompts` | scene-prompt writer |
| `POST /api/script` | SEO planner + writer |
| `POST /api/seo-plan` | two keyword sets |
| `POST /api/voiceover` | MeloTTS / Aura fallbacks |
| `GET /tts` | fallback TTS proxy |

What does **not** rotate, deliberately: accounts, sessions, credits, `/api/credits`, payments,
CMS, themes, worker queue/render jobs, and the HTML pages. KV stays on the primary Worker, so a
credit counter, a payment record or a session can never be split across two deployments.

## 3. The wire protocol

### 3.1 Worker → Worker

```
POST <backup>/api/relay/ai
x-yvs-relay-token: <base64url(payload)>.<hex HMAC-SHA256>
content-type: application/json

{"model":"@cf/stabilityai/stable-diffusion-xl-base-1.0","input":{...}}
```

* `payload = {v:1, k:"ai", exp, m:"<model>", d:"<sha256(body)>"}` — signed with `RELAY_SECRET`
  (or the built-in fallback), valid for **120 s**, and bound to the exact model slug and body.
* The endpoint **never relays again**. That single rule is what makes A → B → A loops
  impossible, even if a Worker is registered in its own pool by mistake.
* `stream` is stripped from forwarded payloads: the backup returns one complete answer, so the
  parser on the primary sees the same shapes `env.AI.run()` produces (`{response}`, a chat array,
  an `ArrayBuffer`, a `ReadableStream`, base64 audio…).

Response:

| Header | Meaning |
| --- | --- |
| `x-yvs-relay-result: json` | body `{ok:true, result:<json>}` |
| `x-yvs-relay-result: binary` | raw bytes (`Content-Type` = what the model produced) |
| `x-yvs-relay-error-kind: model` | the model rejected this call (do **not** retry elsewhere) |
| `x-yvs-relay-error-kind: transient` | pool problem (overload, no binding, timeout) → fail over |

Limits: request body ≤ **512 KiB**, result ≤ **24 MiB**, model slug must match
`@scope/name` (Workers AI slugs only — a relayed call can never be pointed at an arbitrary URL).

### 3.2 Browser → any member (optional)

`GET /api/relay/pool` (same-origin) answers:

```json
{
  "success": true, "version": 1,
  "enabled": true, "clientRotation": true, "strategy": "round-robin",
  "endpoints": [
    {"id":"local","url":"","local":true,"verified":true},
    {"id":"worker-1-ab12cd","url":"https://backup.workers.dev","local":false,"verified":true}
  ],
  "ticket": "<signed, 180 s>", "expiresAt": 1761500000000
}
```

* Only backups that answered `GET /api/relay/ping` within the last 60 s are advertised
  (`verified: true`), so an old deployment or a paused Worker is never rotated to.
* The **ticket** is an HMAC token scoped to `RELAY_AI_PATHS` (`/api/image`, `/api/image-batch`,
  `/api/image-prompts`, `/api/script`, `/api/seo-plan`, `/api/voiceover`, `/image/gen`, `/tts`).
  It carries only `username / email / plan` (or `guest:true`) — never a password, never a cookie.
  It is only issued when rotation is enabled, client rotation is on, and the caller is signed in
  (or is an allowed guest).
* `src/client/api-rotation.ts` wraps `window.fetch`: for an allow-listed AI path it picks the next
  verified member (round robin, **local included**) and calls `<member><path>` with
  `x-yvs-relay-ticket` and `credentials:"omit"` — a backup never sees the primary's cookies.
* A transport error, `502`, `503` or `504` falls through to the next member and finally to local;
  a failed member is skipped for 30 s.
* CORS: a cross-origin **preflight** on an AI path is answered `204`; the actual response only
  gains `Access-Control-Allow-Origin` when a valid ticket is presented. A random page cannot read
  AI output from a visitor's browser, and cannot drain `/image/gen`.

## 4. Selection, health and circuit breaking

| Strategy | Behaviour |
| --- | --- |
| `round-robin` (default) | rotates the starting member per model call, so consecutive calls spread evenly |
| `least-pending` | fewest in-flight calls, then lowest moving latency |
| `weighted` | random weighted choice; `localWeight` (0–10) vs weight 1 per backup |

* A call that fails with an overload/transient/network error opens that member's circuit for
  `cooldown × 2^(n-1)`, capped at **5 min** (default base **30 s**).
* A success closes it again and updates the moving latency (`ewma`).
* Cooling members are **moved to the end, never removed**: a fully cooled pool still answers.
* Local is always appended as the last resort even when `maxAttempts` is exhausted.
* A request that arrives **with a rotation ticket** (the browser deliberately chose this member)
  runs its inference locally instead of relaying it back to the primary it just came from; ordinary
  failover still applies if the local call fails.
* `maxAttempts` (1–5, default 3) bounds how many members one call may try.
* Everything lives in isolate memory. It is a load-shedding heuristic, not a quota — no Durable
  Object, no migration, no new KV key beyond `config:relay`.

## 4b. The provider layer above the pool (bug fix #271)

Bug fix #271 added a second instruction-model provider, so a Cloudflare call is now the *inner*
half of a two-level rotation:

```
instruct call → provider rotation (cloudflare ⟷ openrouter) → worker-pool rotation (this Worker ⟷ backups)
```

* `openrouter` calls never touch the pool: they are one HTTPS request to `openrouter.ai` from the
  Worker that received the studio call, and spend no Workers AI neurons.
* `cloudflare` calls use everything in this document unchanged.
* Only instruct models enter the provider layer; images and TTS stay on Workers AI and still use
  the pool exactly as described above.
* A `POST /api/relay/ai` compute call stays single-hop in **both** directions: it executes the raw
  binding and is never relayed again, and it is never forwarded to OpenRouter.

Details: `bug-fix-session-271.md` and `system-rules.md` RULE 34.

## 4c. Defects found and fixed in this layer (audit, bug fix #271)

| Defect | Fix |
| --- | --- |
| Random pool ids reset every member's circuit history on each 20 s cache rebuild | ids are derived from the URL (`worker:<url>`) |
| `/api/relay/pool` could block on probes | probes are parallel, 5 s bounded, run in `ctx.waitUntil` when available, and never delay a generation |
| CORS granted a cross-origin read to any `Origin` + any ticket string | the HMAC ticket **and** the path are verified before the header is added |
| Browser rotation dropped the query string of `/image/gen` / `/tts` | the wrapper rotates `pathname + search` |
| A rotated request could be re-relayed back to the primary | `preferLocal`: a request carrying a ticket executes locally |
| Background-worker tab could hang forever on a stalled renderer | `withWorkerDeadline()` (15 min) reports the job failed and resumes polling |

## 5. Configuration

Stored in KV `config:relay`, edited in **General & Themes → API Rotation & Backup Worker Pool**:

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | rotate the inference hop across the pool |
| `clientRotation` | `true` | let the studio rotate whole AI requests too |
| `strategy` | `round-robin` | see §4 |
| `localWeight` | `1` | weight of this Worker under `weighted` |
| `maxAttempts` | `3` | members tried per model call (1–5) |
| `timeoutMs` | `100000` | per-attempt timeout (5 s – 240 s) |
| `cooldownMs` | `30000` | circuit-breaker base (1 s – 600 s) |

Environment overrides (no KV needed):

* `RELAY_SECRET` — HMAC secret for relay tokens and client tickets. **Set the same value on every
  Worker in the pool.** Without it a built-in fallback is used and `GET /api/relay/status`
  reports `usingDefaultSecret: true` (anyone with this source could mint a token, exactly like the
  hard-coded administrator password).
* `RELAY_ENABLED=false` — force rotation off for one deployment (e.g. a backup that should only
  serve its own traffic).
* `RELAY_WORKERS=https://a.workers.dev,https://b.workers.dev` — pool members without touching KV.

## 6. Admin endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/relay/ping` | none | `{app, relay:1, capabilities}` — identifies a relay-capable deployment |
| `GET /api/relay/pool` | none (ticket only for a signed-in caller) | what the studio may rotate to |
| `GET /api/relay/status` | none | config, every member, health, probe results |
| `GET /api/relay/config` | none | current policy + defaults |
| `POST /api/relay/config` | settings password (`{pw}`) | save the policy |
| `POST /api/relay/test` | settings password (`{pw}`) | force a fresh probe of every backup |
| `POST /api/relay/ai` | HMAC relay token | execute one model call locally |

`GET /api/relay/status` and `GET /api/config/workers` disclose the same URLs, so the status route
adds no new information exposure.

## 7. Runbook

1. Deploy this version to the primary **and to every backup** (a backup without
   `/api/relay/ping` is simply never used).
2. Set the same `RELAY_SECRET` on all of them (`wrangler secret put RELAY_SECRET`).
3. Open `/{day}/config/uvxyz` → *General & Themes*, paste the backup URLs, **Save Workers**.
4. Press **Test Endpoints Now**: every member must report `reachable`.
5. Watch the table while generating: `Served` (`successes/failures`) and `Avg ms` show the spread.
   A member that keeps failing goes to `cooling` and is skipped automatically.
6. To take a Worker out of rotation without touching this site: set `RELAY_ENABLED=false` on that
   Worker (it still answers its own traffic) or remove its URL.

## 7b. Background worker mode

The same settings page also hosts **Background Worker Mode** (a tab polls `/api/worker/poll`,
renders the MP4 locally with WebCodecs and posts it to `/api/worker/deliver`). Rotation is
orthogonal to it and works in that mode unchanged: the relay endpoints are plain Worker routes, so
a page that is busy rendering jobs still rotates the AI paths the studio uses, the configuration
card is the same card, and nothing about the queue (`/api/render*`, `/api/worker/*`) is routed
anywhere. A backup in `cooling` never blocks a render job.

## 8. What this does and does not fix

* **Does** spread Workers AI inference across every account/deployment in the pool, so the primary
  no longer burns its whole 10,000-neuron daily budget while three backups sit idle, and each
  member does less CPU work per request.
* **Does** keep the app working when a member is overloaded or offline (circuit breaker + local
  backstop).
* **Does** keep quota *accounting* where it belongs: image credits are still counted once, on the
  Worker that served the request, in its own KV (`credits:<user>` / `ipcredits:<hash>`).
* **Does not** merge per-account quotas. Each deployment has its own KV namespace unless the
  operator binds one shared namespace; the free-plan neuron allowance is per account, which is the
  limit this feature spreads.
* **Does not** add a Durable Object, a migration, a new binding or a new secret requirement.
* **Does not** rotate HTML, auth, settings, payments, CMS, render jobs or the worker queue.

## 9. Tests

`tests/api-relay.test.mjs` (34 cases) pins the contract: pool resolution and deduplication, all
three strategies, the circuit breaker, token signing/expiry/tamper/kind, `env.AI` upgrade,
JSON and binary results, failover chains, "invalid model slug is rejected before any endpoint is
contacted", the inbound compute endpoint (401/413/502/503, body-digest binding), the password-gated
config/test routes, pool verification and ticket issuance, CORS preflight/read rules, ticket auth
on `/api/image` end-to-end, refusal of a ticket on account/settings/payment routes, the two-Worker
A → B relay, the no-loop guarantee, and the browser rotation/fallback wrapper.
