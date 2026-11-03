# RULE 35 — Script notes are client-side only (implemented 2026-11-03)

> **Status: FIXED IN CODE.** This is the canonical requirement-and-implementation record.
> Every other Markdown file in this repository carries a pointer to this rule. Where an older
> document describes `script-note:<id>` KV records, "authoritative KV notes", an async note
> poller, or a KV credit write from `/api/script`, that text is **superseded and void** — it
> describes the pre-RULE-35 implementation and is kept only as a historical bug-fix record.
> `system-rules.md` RULE 35 is the normative system rule.

## 1. Requirement (verbatim intent)

> "The details about the script put in KV should not be existing anymore. Edit it then fix the
> entire system. Remove all writes on KV using script and put it in localStorage and cookie in
> client side. There must be checks that make it consistent between those storages. Write this
> requirement in all documentation … study the code and system rules."

Resolved as:

1. **No script detail is ever written to Cloudflare KV.** This covers the narration text, the
   SEO keyword set, the beat/outline plan, researched source facts, timings, the exact success
   payload, and any note state (`queued → … → done|error`).
2. **The durable copy lives in the browser**, in **both** `localStorage`
   (`ytvs.script-notes.v1`) **and** a cookie (`ytvs_note`). The Worker holds at most an
   ephemeral, per-isolate in-memory copy for the lifetime of one request chain.
3. **There must be explicit consistency checks between the two client stores** — a digest,
   timestamp and script-length comparison with reconciliation on read, on write-back, after
   storage events, and for quota, corruption, staleness and expiry cases.
4. **The entire flow keeps working**: script route, note routes, async compatibility ticket,
   poll/watchdog paths, SEO planner/writer/repair, editor accordion, Quick Batch table, and
   the render hand-off.
5. **All documentation** states the new requirement, including `system-rules.md`.

## 2. Scope of "all writes on KV using script"

Removed KV writes:

| Old write | New behaviour |
| --- | --- |
| `kvNoteStore.put()` → `KV_BINDING.put("script-note:<id>", …)` for every note transition | `noteMemoryStore()` — bounded `Map` in the isolate; **0 KV gets, 0 puts, 0 deletes** |
| `readScriptNoteFresh()` / `readScriptNoteChecked()` → authoritative KV `get` | memory lookup only; `unavailable` is always `false` |
| `creditConsume()` / `guestCreditConsume()` called from the `/api/script` route | removed; scripts are unlimited and the browser usage ledger keeps counts only |
| `noteRunDone()` writing the finished script + payload to KV | the finished script is returned in the HTTP response and stored by the browser |
| `/api/render` persisting a whole `project` object into a KV blob | `collectVideoPayload()` omits script fields, and the route strips `script`, `scriptText`, `narration`, `note`, `scriptNote`, `outline`, `seoHeadings`, `seoPlan`, `keywordSet` defensively before serialising |

**Not in scope** (unchanged): account/session/email keys, `config:*`, `credits:*` /
`ipcredits:*` for paid image quotas, CMS pages, payment proofs, theme, API-relay/rotation
state, and the RULE 4 `job:` / `blob:` render-job families. Those are different subsystems and
none of them contain AI-generated script notes. User-authored caption/subtitle overlays belong
to the render job family, not the script-note store.

## 3. Implementation map

| File | RULE 35 change |
| --- | --- |
| `src/modules/script-notes.ts` | `SCRIPT_NOTE_STORAGE = "client:localStorage+cookie"`, `SCRIPT_NOTE_KV_READS = 0`, `SCRIPT_NOTE_KV_WRITES = 0`; `noteMemoryStore()`, `scriptNoteWriteLog()`, `clearScriptNoteWriteLog()`, `scriptNotePersistencePolicy()`; `scriptNoteStore(env)` ignores `env.KV_BINDING`; `kvNoteStore()` remains only as a **memory-only** deprecated shim; `readScriptNoteFresh()` no longer makes a second copy |
| `src/modules/script-notes-api.ts` | note write/read/delete and the `?async=1` 202 ticket now return `clientSideOnly: true`, `persisted: false`, `storage: ["localStorage:ytvs.script-notes.v1", "cookie:ytvs_note"]`; the KV-busy `SCRIPT_NOTE_STORE_BUSY` branch is annotated unreachable |
| `src/modules/script-seo.ts` | RULE 35 header; the note hint is a browser-owned copy; every Worker note write goes to memory only |
| `src/index.ts` | capabilities advertise `asyncScript: 0`, `scriptNoteStorage: "client:localStorage+cookie"`, `scriptNoteKvWrites: 0`, `scriptNoteConsistency: "digest+timestamp+scriptLength"`; no credit KV write in the script route; `?async=1` degrades to synchronous `handleSeoScriptGeneration()`; `/api/render` strips script-like fields from the persisted project |
| `src/client/script-notes-client.ts` | full note in `localStorage["ytvs.script-notes.v1"]`, compact digest mirror in cookie `ytvs_note`, in-page memory fallback; `put/get/remove/clear/check/stats/digestOf`; `consistencyReport()` + `reconcile()`; quota/TTL/corruption/expiry/staleness handling; `storage` event invalidation |
| `src/client/app-js.ts` | detects `clientSideNotes`, disables async note polling, uses `POST /api/script` synchronously, audits localStorage↔cookie on read and write-back, exposes `window.__SCRIPT_NOTE_CONSISTENCY` for tests/QA |
| `tests/script-note-client-only.test.mjs` | 12 checks: zero KV ops, no source-level note KV writes, no credit/async writes in the route, client-only API responses, digest/reconciliation/repair/expiry/removal, and a studio integration test with one synchronous request and zero polls |

## 4. Client consistency contract

The cookie mirror is deliberately compact so it fits browser cookie limits:

```text
{ v: 2, k: <note key>, h: <FNV-1a digest of the canonical full note>,
  at: <updatedAt>, sl: <full script length>, sp: <480-char preview>,
  kw: [longTail, short…], o: [<4 beats>] }
```

`digestOf()` hashes a **canonical** projection (version, key, keyword set, outline, title,
headings, facts, state, script, timestamps), so re-ordered object keys cannot create a false
mismatch. Checks performed by `check()` / `consistencyReport()`:

- **digest** — the cookie digest must equal the digest of the localStorage note;
- **timestamp** — the two `updatedAt` values must agree (a stale side is repaired from the newer one);
- **script length** — `sl` must equal the length of the full script (a partial cookie-only restore keeps the original `sl`);
- **schema version** — unknown/older versions are dropped and re-reconciled;
- **TTL** — 7 days, 24 entries, 256 KB localStorage ceiling; expired entries are pruned;
- **quota / disabled storage** — `localStorage` failure falls back to the cookie and then to the in-page `Map`;
- **corruption** — invalid JSON, wrong types, oversized or truncated payloads are discarded rather than trusted;
- **removal / storage events** — `remove()` clears both stores, and another tab's write invalidates the in-page copy;
- **write-back verification** — `put()` re-reads both stores and repairs them before returning.

`stats()` exposes `checks`, `mismatches`, `repairs`, `digestFailures` and `scriptChecks` so QA
and tests can assert that reconciliation actually happened. This is a consistency aid, not a
security boundary: both stores are user-editable and the Worker re-validates every hint.

## 5. Route / compatibility behaviour

- `POST /api/script` is the only script path used by current clients. It receives the browser
  hint in `body.note`, re-validates it, and returns the finished script in the response. The
  browser then writes it to localStorage + cookie and runs `check()`.
- `POST /api/script/notes`, `GET|DELETE /api/script/notes/<id>` and the watchdog still exist for
  old clients, but their store is per-isolate memory; responses say `persisted: false`. A Worker
  restart loses the note — **intended**, because the client re-sends its own copy.
- `?async=1` is accepted as a compatibility parameter and degrades to the synchronous handler
  rather than parking a ticket in KV. Capabilities advertise `asyncScript: 0` so fresh clients
  never poll.
- `scriptUsage` no longer touches KV; scripts are unlimited on both plans and the counts-only
  browser usage ledger (`RULE 30`) is the only usage record.

## 6. Rules superseded / amended

- **RULE 2** ("no `localStorage`/`sessionStorage`/IndexedDB anywhere in the client") — the
  HttpOnly session cookie is still the auth mechanism, but RULE 35 adds two client stores for
  script notes and keeps the RULE 30 counts-only usage stores.
- **RULE 15** ("nothing is persisted client-side", "tab close discards all studio work") —
  amended: script notes survive a tab close in localStorage + cookie. The KV TTL table no
  longer contains a script-note family.
- **RULE 17** / inconsistency register — the "KV TTLs bound all data" retention model is no
  longer universal.
- **RULE 30** ("No persistent video jobs or media in client storage") — still true for media;
  script notes are text metadata and are now explicitly an allowed exception.
- Historical session documents 276/277/278/279 and `current_code_latest.md` describe the
  retired KV note implementation. Their KV-note statements are void; consult this rule and
  `system-rules.md` RULE 35 for current behaviour.

## 7. Verification (2026-11-03)

- `tests/script-note-client-only.test.mjs` evaluates the generated browser JS in a VM, so
  `SCRIPT_NOTES_CLIENT_JS` is syntax-checked on every run.
- `npx tsc --noEmit -p tsconfig.json` → no errors in any edited module; only the pre-existing
  `src/index.ts` diagnostics remain (implicit `any` / `{}` indexing in untouched handlers).
- `node --import tsx --test tests/script-note-client-only.test.mjs` → **12/12 pass**.
- `node --import tsx --test tests/script-*.test.mjs` → **108/108 pass** (two stale
  session-279 watchdog tests were repaired to shorten the ticket's own promised queue grace,
  and three KV-era assertions were rewritten for the memory-only store).
- `npm test` → **499 tests / 438 pass / 55 fail** versus the pre-change baseline of
  **487 / 424 / 57**. All 12 new tests pass, two pre-existing failures were fixed, and the set
  of failing test names is a strict subset of the baseline — **zero regressions**. The 55
  remaining failures are unrelated pre-existing failures in the api-relay, image-batch,
  credit, Quick Batch and #261/#262 groups.
- Source-level guard: no executable `kv.put(...)` of a script-note key remains anywhere in
  `src/`; the only `script-note:` strings are RULE 35 rationale comments.
