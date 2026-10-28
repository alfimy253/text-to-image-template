# KV scale test — will a 3,000-user KV slow the system, and is it allowed on the free plan?

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

Tested on 2026-10-15 against the real worker code (`src/index.ts`) and Cloudflare's own
runtime (`wrangler 4.123.0` / workerd local KV).

## Verdict

| Question | Answer |
| --- | --- |
| Is a 3,000-key namespace allowed on Cloudflare's **free** plan? | **Yes.** Keys/namespace are **unlimited** on Free and Paid. 3,000 user records ≈ 0.7 MB of the 1 GB free storage. Nothing about the key count violates the plan. |
| Does 3,000 keys **slow the system**? | **No.** Every hot path is a keyed `get()` — measured flat from 6 → 3,000 → 10,000 keys (details below). |
| Can this app actually have 3,000 users? | **Yes, since the fix below.** `AUTH_MAX_USERS` (7) and its `403 "Full: max 7 users"` are gone; signup now succeeds at 3,000+ keys for 6 KV ops. (§8) |
| Would simply raising the cap have worked? | **No — two hard blockers** (1,000-key `list()` page + the 1,000-operations-per-invocation limit). Both were fixed by the email index. See §4 and §8. |
| What actually breaks the free plan? | **Not user count — the operation pattern.** Background-worker polling burns the 1,000 list-ops/day allowance in ~50 minutes; one server-side render costs ~8 of the 1,000 writes/day. See §5. |

---

## 1. Method

Two independent tests, because "is it slow" (behaviour) and "is it allowed" (quota) are
different questions.

**Test A — real worker code, instrumented KV.** `src/index.ts` bundled with esbuild, run in
Node against a mock KV that reproduces the documented production semantics: `list()` returns at
most 1,000 keys (default *and* maximum), `list_complete`/`cursor` pagination, `get(key,"stream")`,
and per-operation counting. This measures **operations per request**, which is what KV quota and
latency actually scale with.

**Test B — real runtime, real KV engine.** The production worker wrapped by a test-only harness
(`bench/harness-worker.ts`, `bench/wrangler.bench.jsonc`) run under
`wrangler dev` (workerd + Miniflare KV), seeded with 3,000 and 10,000 user records, timed over
HTTP with `curl`.

```bash
# reproduce
npm install
npx wrangler dev --config bench/wrangler.bench.jsonc --port 8788      # test-only wrapper, never deployed
curl "http://127.0.0.1:8788/__seed?n=2500&from=1"                     # seed in chunks (long seeds can kill local workerd)
curl "http://127.0.0.1:8788/__stats"                                  # proves the 1,000-key page cap
curl -w "%{time_total}\n" -X POST http://127.0.0.1:8788/api/login \
  -H 'Content-Type: application/json' -d '{"username":"u1","password":"password123"}'
curl "http://127.0.0.1:8788/__scan"                                   # the signup email scan, priced
curl "http://127.0.0.1:8788/__wipe"
```

---

## 2. Operations per request — flat in user count (Test A)

Real worker, instrumented KV. `session` = `GET /api/session` with a valid cookie,
`login` = `POST /api/login` with valid credentials, `signup` = `POST /api/signup` with a new
username/email. **These columns are the pre-fix measurements (2026-10-15)**: the `403` rows show
the removed 7-user cap, and session/login have cost more since the credits work — see the
2026-10-22 table in §8 for current counts.

| Users in namespace | session | login | signup |
| --- | --- | --- | --- |
| 7 | 1 get → **200** | 1 get + 1 put → **200** | 1 list → **403** |
| 100 | 1 get → 200 | 1 get + 1 put → 200 | 1 list → 403 |
| 1,000 | 1 get → 200 | 1 get + 1 put → 200 | 1 list → 403 |
| 3,000 | 1 get → 200 | 1 get + 1 put → 200 | 1 list → 403 |
| 10,000 | 1 get → 200 | 1 get + 1 put → 200 | 1 list → 403 |

Operation counts are **identical at every size** — nothing scans the user set. (The expensive
part of login is PBKDF2-HMAC-SHA256, 100,000 iterations, entirely CPU.)

## 3. Wall-clock in the real runtime (Test B)

Averages over 10 requests (5 for signup), local workerd:

| Endpoint | 6 user keys | 3,000 user keys | 10,000 user keys |
| --- | --- | --- | --- |
| `GET /api/session` | 4.0 ms | 3.4 ms | 3.6 ms |
| `POST /api/login` (PBKDF2 100k) | 18.4 ms | 18.4 ms | 19.0 ms |
| `POST /api/signup` | 7.1 ms | 2.8 ms | 5 ms (403) |
| `GET /api/worker/poll` (empty queue) | 3.1 ms | 3.3 ms | 6.5 ms |
| `GET /api/config/workers` | — | 4.4 ms | — |
| `GET /api/render/does-not-exist` | — | 2.9 ms | — |
| `POST /api/signup` response *(before the fix)* | 403 (7 users reached) | `{"error":"Full: max 7 users"}` | `{"error":"Full: max 7 users"}` |
| `POST /api/signup` response *(after the fix, §8)* | 200 | 200 | 200 |

**Conclusion: 3,000 user keys cost nothing.** The differences are run-to-run noise; the login
figure is dominated by password hashing, not KV.

*(Absolute values are local-engine numbers, not production edge latencies. The operation counts,
the list-page cap and the quota maths are what transfer to production.)*

## 4. Why 3,000 real users would still not work

Both blockers appear only if the 7-user cap is raised, making the signup path reachable.

**4a. `list()` returns at most 1,000 keys — the email-uniqueness check silently under-scans.**

```
GET /__stats  →  {"firstPageKeys":1000,"list_complete":false,"hasCursor":true}
```

measured in the real runtime with 3,000 *and* 10,000 user records. The pre-fix signup handler
called `KV_BINDING.list({ prefix: "user:" })` and never followed `cursor`/`list_complete`, so:

- the 7-user cap check only ever sees `min(real_users, 1000)` — any list-based count in the app
  saturates at 1,000;
- the duplicate-email loop only inspects the first 1,000 accounts. User #1,001 onwards can
  register a second account with an already-used email.

**4b. The same scan breaks the documented per-invocation operation limit.**

The uniqueness check does **one `get` per listed user**. Cloudflare documents a cap of
**1,000 operations to external services per Worker invocation** (KV reads included). Measured:

| Users | Signup with the cap raised | Ops before abort |
| --- | --- | --- |
| 7 | 200 OK | 11 ops |
| 1,000 | **aborted → 500** | 1,001 ops |
| 3,000 | **aborted → 500** | 1,001 ops |

(The mock enforces the documented 1,000-op rule; in production the 1,001st KV operation fails.)
Measured cost of the scan itself in the real runtime: `{"listedKeys":1000,"scanned":1000,"ops":1001,"ms":576}`
— i.e. even the truncated 1,000-key scan is already over the limit, and each KV read is a
network operation in production.

**4c. Creating the 3,000 accounts also blows the daily write quota.** Every signup writes
2 keys (`user:<name>`, and `session:<token>` when they log in) → 6,000 writes against the
1,000 writes/day free allowance: at least three days of writes, with nothing else writing.

## 5. What actually breaks the free plan (same measurements)

Free-plan KV allowances (Cloudflare docs): **100,000 reads/day · 1,000 writes/day ·
1,000 deletes/day · 1,000 list requests/day · 1 GB storage**. Further operations of that type
fail with an error until 00:00 UTC. API routes on this worker also do up to 1,000 external
operations per invocation.

Measured cost per action (2026-10-15, **before** the accounts-cap fix and the credits work; the
current numbers are in §8):

| Action | reads | writes | lists | deletes |
| --- | --- | --- | --- | --- |
| Studio page render (`GET /`) — theme lookup | 1 | — | — | — |
| Studio page load (session check, `/api/session`) | 1 | — | — | — |
| Login | 1 | 1 | — | — |
| Logout | — | — | — | 1 |
| Signup (below the cap) | 1 + 1 per existing user | 2 | 1 | — |
| Signup (at/over the cap) | — | — | 1 | — |
| **Render submit** (`POST /api/render`) | — | 3–4 (20 MB payload chunks + job) | 1 | — |
| **Worker poll** (`/api/worker/poll`) | 1 per `job:` key (0–12+) | 1 when it claims | 1 | — |
| Worker deliver (30 MB MP4) | 1 | 4 (2 file chunks + index + job) | — | — |
| Studio job status poll (every 4 s) | 1 | — | — | — |
| Studio MP4 download (30 MB) | 4 (job + index + 2 chunks) | — | — | — |
| **Whole server-render cycle** (submit → poll → deliver → download) | **12** | **8** | **2** | 0 |

Queue depth effect on one poll:

```
0 jobs : 1 list
1 job  : 1 list + 3 gets + 1 put
10 jobs: 1 list + 12 gets + 1 put
```

Daily budgets on the free plan, from these numbers (2026-10-15, before the credits work — §8
re-derives the session/login costs that changed):

- **Background worker mode dies in ~50 minutes.** It polls every 3 s = 28,800 polls/day; each
  poll costs 1 list against the 1,000 lists/day allowance → `1000 × 3 s = 50 min`. After that
  the polls error and the worker stops delivering jobs.
- **≈125 server-rendered videos/day** (8 writes each) before the writes allowance is gone —
  fewer once logins (1 write each) and job claiming are counted.
- **≈1,000 logins/day** (1 write each); page loads are cheap (2 reads: the theme lookup plus the
  `/api/session` check) against 100,000 reads/day.
- **Theme switches are free in practice**: one `GET /api/config/theme` read when the settings
  page unlocks and one `put config:theme` per **Save theme** — 1 write, the same allowance
  logins use (so a long theme-tweaking session eats into the ≈1,000-writes/day budget).
- **Storage is a non-issue**: 3,000 users ≈ 0.7 MB, 10,000 users ≈ 2.3 MB, versus 1 GB.

**Workers AI is the other free-plan pool (and the SEO script doubled its cost).**
The free allocation is **10,000 neurons/day, shared by every model** (images, script,
voiceover). Since 2026-10-15 one `POST /api/script` is **at least 2 AI calls** — the keyword
planner (up to 3 attempts) plus the SRT writer (up to 3 attempts) — where it used to be one
call, so script-heavy sessions now spend the image budget twice as fast. The KV numbers in
this document are unaffected: the SEO change adds no KV operations (the keyword set lives
only inside the request).

## 6. If you actually want 3,000 users

1. ~~`AUTH_MAX_USERS` must change (it is 7)~~ — **done**, and the cap check itself (a `list()`
   that saturates at 1,000) was removed with it. See §8.
2. ~~Replace the linear email scan with a deterministic key (`email:<lowercased>` → 1 read)~~ —
   **done** (§8). Moving accounts to **D1** is still the better long-term home if this ever
   becomes multi-tenant: 5 GB storage, 5 million rows read/day, 100,000 rows written/day and a
   real `UNIQUE` index on email.
3. Sessions: keep 1 KV write per login, or switch to a signed (HMAC) cookie to make login free
   of writes.
4. Replace the 3-second polling worker queue: Cloudflare **Queues** (10,000 ops/day free) or a
   Durable Object, or at minimum poll much less often and skip the `list()` when idle.
5. Watch the per-invocation budget: no request may make more than 1,000 external operations.

## 7. Test limitations

- Local workerd (Miniflare) KV, not the production edge: absolute latencies are indicative of
  behaviour, not of production timings; the *counts*, the 1,000-key list page and the quota
  arithmetic are the transferable results.
- Miniflare does not enforce the 1,000-ops-per-invocation rule; Test A models it explicitly.
- Seeding 10,000 keys in a single local request (15 s) crashed the local workerd once — seed in
  chunks via `/__seed?n=2500&from=…`. The keys survived; the second run measured 10,000 keys.
- The mock KV stores without TTL expiry, so TTL-related behaviour (job/blob cleanup) is not
  exercised here.

---

## 8. After the fix — the user cap is gone (verified 2026-10-15)

**Change.** `AUTH_MAX_USERS` and its `403 "Full: max 7 users"` were removed from
`src/index.ts`, and the email-uniqueness check was moved from a full scan to a keyed index:

- signup reads `email:<lowercased address>` — 1 read — and writes it on success;
- accounts created before the index existed have no such key, so a **bounded** legacy scan runs
  (`list({prefix:"user:", limit: 201})`, then `get` per record) **only** while the namespace holds
  <= 200 accounts, i.e. always inside the 1,000-operations-per-invocation budget;
- the client's "(max 7 user accounts)" copy and its `AUTH_MAX_USERS` constant are gone.

**Re-verified in the real runtime** (`wrangler dev`, workerd KV) with a **3,000-key** namespace:

| Check | Result |
| --- | --- |
| `POST /api/signup` at 3,000 users | **200** (was `403`) in 27 ms |
| 10 further signups at 3,000+ keys | **10/10 × 200** (the old cap allowed 7 accounts in total) |
| Duplicate email | **409** in 4.8 ms (1 KV read, no scan) |
| Duplicate username | **409** |
| `POST /api/login` afterwards | **200** |

**Operation cost per request (instrumented harness, 2026-10-15 — before the credits work; the
2026-10-22 table below supersedes the session/login rows):**

| Request | KV ops | Detail |
| --- | --- | --- |
| Signup, namespace > 200 accounts | **6** | 2 gets + 1 list + 3 puts (user, email index, session) |
| Signup, namespace <= 200 accounts | 6 + up to 200 | the bounded legacy scan |
| Signup rejected (duplicate email) | **1** | the index read |
| Login | **2** | 1 get + 1 put |
| `GET /api/session` | **1** | 1 get |

**Free-plan consequence of "unlimited":** the app no longer bounds growth, the plan does —
≈**333 new accounts/day** (3 writes each) and ≈**1,000 logins/day** (1 write each) on the
1,000-writes/day allowance, while page loads (1 read) stay far below 100,000 reads/day. Sessions
are still written **without a TTL**, so they accumulate forever and are now the main storage
consumer (`bug-audit.md` #3).

**Update 2026-10-15 (SEO script):** `POST /api/script` was split into two AI stages, but it
still touches **no KV keys at all**, so every operation count and allowance in this document
stands unchanged. Only the Workers AI side of the free plan got more expensive — see §5.

**Update 2026-10-15 (themes):** the studio now reads one extra KV key per HTML render
(`config:theme`, 1 read — see the table in §5) and the settings page writes it on
**Save theme** (1 write). Both are inside the free-plan allowances quoted above; the only
new failure mode is a KV read that throws, which falls back to the built-in look instead of
failing the page (`system-rules.md` RULE 19).

**Update 2026-10-22 (daily credits):** derivations from the code, not new wrangler measurements.

| Operation | KV ops now | Detail |
| --- | --- | --- |
| `GET /api/session` | **3 reads** | session + `user:<name>` (for `usertype`) + `credits:<name>` |
| `POST /api/login` | **3** | 1 user read + 1 session write + 1 credits read (the plan comes from the record already read) |
| `POST /api/signup` | **3 writes + 2 reads + 1 list** | user + email-index reads, the bounded legacy `list()`, then user, email index and session writes |
| `GET /api/credits` | **3 reads** | session + user + credits |
| `GET /image/gen` | **4 ops** | session read + user read + credits read + credits write (1 image) |
| `POST /api/script` · `/api/voiceover` | **+4 ops** each when signed in | session + user reads, credits read + write |
| `GET /api/config/users?pw=` | 1 list + up to **100 reads** | 50 accounts × (user + credits) |

Consequences for the free plan (1,000 writes / 100,000 reads per day):

- Image generations are **write-bound**: at most ~1,000 metered images/day across the whole
  deployment, i.e. 20 free accounts at their full 50/day, or one paid account's 1,200/day does
  not fit in a single day's writes. A production launch needs Durable Objects or D1 for counters
  (the KV record is deliberately small and TTL-bounded so migrating is mechanical).
- Reads are not the constraint: ~25,000 metered generations/day fit in the read allowance.
- The settings-page listing is bounded at 50 accounts on purpose: 101 ops per load leaves room
  under the 1,000-operations-per-invocation limit.

**Bug Fix Session #206 (2026-10-22, freemium `/free`):** guest traffic adds one KV record per
address per day, keyed `ipcredits:<sha256>`, with the same 2-day TTL and lazy daily reset.

| Operation | KV ops now | Detail |
| --- | --- | --- |
| `GET /free` | **1 read** | `config:theme`; the `yvs_free` cookie is a response header, no KV write |
| `GET /studio` (signed in) | **3 reads** | theme + session + user record |
| `GET /image/gen` (guest, no session cookie) | **2 ops** | `ipcredits:` read + write |
| `GET /image/gen` (guest with a stale session cookie) | **3 ops** | failed session read + `ipcredits:` read + write |
| `GET /image/gen` (cold anonymous) | **0 ops** | no cookie to look up, `401` returned before KV |
| `GET /api/credits` (guest) | **1 read** | `ipcredits:` read |
| `GET /api/config/ipcredits?pw=` | 1 list + up to **51 reads** | 50 IP records (one get each) |

Consequences:

- Guest generations are **write-bound exactly like account generations**: one KV write per image.
  A busy freemium day shares the same ~1,000-writes/day free-plan ceiling; 10 images per address
  means at most 100 distinct guest addresses can max out their allowance per day on the free
  plan.
- Guest rows are only created by a metered call, and a row is one small JSON value expiring
  after 2 days, so the table cannot grow without bound while `expirationTtl` is honoured.
- `GET /api/config/ipcredits` is bounded at 50 rows for the same per-invocation reason as
  `GET /api/config/users`: 51 ops per load leaves headroom under the 1,000-operation limit.
- The `unknown` bucket (requests with no address header) is one row for the whole deployment;
  it fails closed at 10 images rather than open.
