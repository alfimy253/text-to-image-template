# Render App — script → MP3 (free online TTS, one male + one female voice)

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](../pixabay-media-migration.md).

A tiny local helper that turns a narration **script of up to 20,000 characters**
into **one MP3**, spoken by a **free, no-login** online text-to-speech site that
this app drives with **Playwright**. There is no account, no API key from a TTS
vendor, and no usage bill: the two things you give it are the script and a voice
type — **`male` or `female`, exactly one of each** — and the thing you get back is
an MP3 you can drop straight onto a video.

It lives next to the Cloudflare studio in this repo (`render-app/`) and can also be
zipped up and run anywhere with Node 20+.

---

## 1. Run it

```bash
cd render-app
npm install                 # playwright
npx playwright install chromium
npm start                   # http://localhost:8787
```

Open <http://localhost:8787>, paste the script, pick **Male voice** or
**Female voice**, press **🎧 Generate MP3**. The page shows a chunk-by-chunk
progress bar, then an inline player and a **⬇ Download MP3** link.

### Without a browser (wiring test)

`mock` is a built-in offline provider: it writes a real (silent) MP3 through the
same chunking + concatenation + job pipeline, so the UI, the routes and the file
output can be checked with no network at all:

```bash
npm run offline             # TTS_PROVIDER=mock node server.mjs
npm run check               # syntax check + the whole self-test (see §6)
```

### Environment

| Variable                  | Default     | Meaning                                                       |
| ------------------------- | ----------- | ------------------------------------------------------------- |
| `PORT`                    | `8787`      | HTTP port (bound to `0.0.0.0`).                                |
| `TTS_PROVIDER`            | `ttsmp3`    | `ttsmp3`, `text-to-speech` or `mock`.                          |
| `TTS_OUTPUT_DIR`          | `output`    | Where the finished MP3s are written (relative to `render-app`).|
| `TTS_CONVERT_TIMEOUT_MS`  | `120000`    | How long one chunk may take to come back.                      |
| `TTS_NAV_TIMEOUT_MS`      | `60000`     | Page-load timeout per chunk.                                   |
| `TTS_HEADFUL`             | unset       | Set to anything to watch the browser do its thing.             |

---

## 2. The API

Two routes, and nothing else is needed by the studio.

```
POST /api/tts
Content-Type: application/json

{
  "apiKey": "1290890909&aPiky2026",
  "script": "…up to 20,000 characters…",
  "voice":  "male" | "female",
  "provider": "ttsmp3"            // optional; defaults to TTS_PROVIDER
}
```

| Answer          | When                                                   |
| --------------- | ------------------------------------------------------ |
| `202`           | `{ "jobId", "chunks", "voice", "provider", "statusUrl" }` |
| `401`           | the hardcoded key is missing or wrong                   |
| `400`           | empty script, over 20,000 characters, a voice other than male/female, unknown provider |

```
GET /api/job/<id>   ->  { stage, done, total, percent, message, url, bytes, ms, error }
POST /api/job/<id>  ->  stop a job (it stops after the chunk in flight)
GET /media/<id>.mp3 ->  the finished file (also offered as a download)
GET /api/health     ->  voices, providers, the 20,000 cap
```

`stage` walks `queued → speaking → finishing → done` (or `error`).

The key is **hardcoded on purpose**: this is a private render helper that may sit
next to the studio, but it must never become an open text-to-speech relay. Jobs
live in memory only — a restart simply loses the queue, and nothing is stored on
disk except the MP3s in `output/`.

---

## 3. How a script becomes one MP3

```
script (≤ 20,000 chars)
   │
   ├─ split on sentence boundaries into chunks of ≤ 280 characters
   │  (a sentence longer than the cap is cut on a word, then hard-sliced)
   │
   ├─ for each chunk, in a fresh page:
   │     1. open the host
   │     2. type the text into its textarea
   │     3. read the host's own voice <select> and pick the ONE option
   │        that names the requested gender (English preferred)
   │     4. press its convert button
   │     5. capture the MP3 — a browser download event, or the
   │        <audio src> / a[download] link the page reveals
   │
   └─ concatenate the chunk MP3s (ID3 tags of later chunks dropped)
          → output/<jobId>.mp3
```

One browser is launched per job and closed when the job ends; a fresh page is used
per chunk because free hosts leave their form filled after a conversion.

## 4. The two voices

The app never invents voice ids and never offers a third choice. Each gender has
one matcher, applied to the labels the host itself lists:

```js
male:   /\b(?<!fe)male\b|\bdave\b|\bdavid\b|\bgeorge\b|\bguy\b|\badam\b|\bryan\b/i
female: /\bfemale\b|\bsusan\b|\bamy\b|\bemma\b|\bzira\b|\bjoan\b|\bkate\b/i
```

The lookbehind in the male rule is load-bearing: **"female" ends in "male"**, so a
bare `/male/` would hand the male slot a female voice. The selection is
deterministic — same host, same option, every run — which is what keeps a long
script from changing narrator halfway through.

## 5. If a host changes its markup

Everything host-specific is one object at the top of `lib/tts-engine.mjs`:

```js
ttsmp3: {
	url: "https://www.ttsmp3.com/",
	textarea: ["textarea[name='text']", "#text", "textarea"],
	voiceSelect: ["select[name='voice']", "select"],
	submit: ["button[type='submit']", "input[type='submit']", "button:has-text('Convert')"],
	download: ["a[download]", "#download_link a", "a:has-text('Download')"]
}
```

Each list is tried **in order**, so a renamed id is a one-line edit — and a new
free site is a new key in the same object (`/api/health` lists what is available).
`text-to-speech` is kept as the fallback provider for exactly this reason.

Note that this sandbox has no route to those hosts and cannot install Chromium, so
the live path is verified by the person running it (`npm start`, then
`TTS_HEADFUL=1 npm start` to watch). The offline path is verified in CI.

## 6. Self-test

```bash
npm run check
```

runs `node --check` on the three source files and then `selftest.mjs`, which
asserts the key, the 20,000 cap, the two-voice rule, chunk packing (nothing lost,
nothing over the cap), a real MP3 out of the offline provider, ID3-safe
concatenation, and the HTTP round trip: 401 without the key, 400 on every bad
request, `202 → done → MP3 download` on a good one.

## 7. Files

```
render-app/
├── server.mjs            node:http: the two API routes + the static page
├── selftest.mjs          npm run check
├── package.json
├── lib/tts-engine.mjs    chunking, providers, Playwright driver, MP3 join
├── public/index.html      the page (20k counter, two voice radios, progress)
├── public/app.js          submit + poll + player
├── public/styles.css
└── output/                finished MP3s (git-ignored)
```

## 8. Handing it to the studio

`output/` is the only thing written; nothing in the studio's own routes changes.
The studio's voiceover panel (`/api/voiceover`) keeps working as before — this app
is the option for when a script should be voiced without Cloudflare AI, or on a
machine with no Workers deployment at all.


---

## RULE 35 — script notes are client-side only (2026-11-03)

> **FIXED IN CODE.** Script details (narration, keyword set, beat plan, research facts,
> timings, note state and the success payload) are **never written to Cloudflare KV**. The
> durable copy is the browser's `localStorage["ytvs.script-notes.v1"]` full note plus the
> compact `ytvs_note` cookie mirror, reconciled by digest + timestamp + script-length checks
> (`src/client/script-notes-client.ts`). The Worker keeps only an ephemeral per-isolate memory
> copy (`src/modules/script-notes.ts`: 0 KV reads / 0 KV writes). The script route writes no
> credit KV record, `?async=1` degrades to a synchronous response, and capabilities advertise
> `asyncScript: 0`, `scriptNoteKvWrites: 0`,
> `scriptNoteConsistency: "digest+timestamp+scriptLength"`.
>
> Canonical specification: [RULE-35-client-side-script-notes.md](../RULE-35-client-side-script-notes.md)
> · Normative rule: `system-rules.md` RULE 35 · Verification:
> `tests/script-note-client-only.test.mjs` (12/12). Any older KV-note statement in this
> document is superseded and void.

---

## FINAL RULE — QUICK BATCH TABLE LAYOUT (2026-11-04)

This is the final, code-backed rule for the **Quick Batch table layout** and the **shared Editor media pipeline**. It supersedes every older Markdown/session note about one-request tables, Worker-owned media retries, variable scene totals, separate Preview/Export columns, or row script buttons.

1. Client JavaScript owns retries for every failed **non-media** pipeline stage in this layout: voice, scene plan / prompts and animation. One initial attempt is followed by at most **7 retries** (8 total attempts); every retry waits **40 seconds** first. Only the failed stage is reset and repeated. Earlier successful stages are kept; there is no whole-row restart and no duplicate paid batch.
2. **Image and video imports are the exception in BOTH layouts.** Only the individually failed photo or clip is retried from client JavaScript, using the same 7-retry / 40-second ladder per item. Successful media, object URLs and recorded filenames are preserved. There is no whole-stage, whole-batch or whole-row media restart, and a failed stage-level retry must not revoke a successful image.
3. Every automatic video in **both** the Editor and Quick Batch table plans exactly **12 Pixabay scenes for every script length and duration**: **4 silent videos + 8 photos**. Scene planning and Pixabay searches always target those same 12 results (8 image results and 4 video results). Client JS records the filename of every selected scene and rejects duplicate filenames in one video; alternate Pixabay result indexes/pages are searched for the failed item so no similar image repeats in one video. A duplicate or missing scene is retried individually and must not strand the row.
4. Retries are silent. The row keeps its script textarea, working stage label and `.va-spinner` continuously; no error, retry, attempt, warning or abort wording is painted in the table UI. After an exhausted ladder the row returns silently to `ready`.
5. A missing scene plan must be retried by client JS, and the row must continue to the next pipeline once a plan arrives.
6. In the **Editor layout**, the script textbox is pinned while script writing/retries run: no state paint, toggle or accordion renumber may hide it over time.
7. The **last table column is `Actions`** with icons for **Preview** (same existing function), **Process Export** and **Edit**. Edit opens a new page with a **transition-only project JSON** payload carrying the row's basic settings from `batchProjectJson()`; `applyTransitionProject()` consumes it for the transition only. The rows have **no AI enhancer button**.
8. `src/client/app-js.ts` is the source of truth. `AUTO_MEDIA_TOTAL = 12`, `AUTO_VIDEO_SCENES = 4`, `AUTO_IMAGE_SCENES = 8`, `MEDIA_ITEM_MAX_RETRIES = 7`, `MEDIA_ITEM_RETRY_BACKOFF_MS = 40000`, `retryFailedMediaOnly()`, `requestBatchImagesWithIndividualRetries()`, `runEditorMediaWithIndividualRetries()`, `batchActionCell()`, `batchProjectJson()` and `applyTransitionProject()` define the live contract. Worker capabilities advertise `mediaSceneCap: 12`, `mediaVideoScenes: 4`, `mediaImageScenes: 8`, `mediaItemRetryOwner: "browser"`, `mediaItemRetries: 7`, `mediaItemRetryBackoffMs: 40000`, `mediaFilenameDedupe: "per-video"` and `quickBatchActionsColumn: "preview-process-export-edit"`. `BATCH_PIPELINE_MAX_RETRIES = 7` and `BATCH_PIPELINE_RETRY_BACKOFF_MS = 40000` still govern the non-media stage ladder. Older Quick Batch table statements in this file are superseded wherever they conflict.
