# Third-party notices

> **Media-source decision — 2026-10-29 (supersedes conflicting media requirements below).**
> We use **Pixabay images and Pixabay videos**, not AI-generated images.
> No Cloudflare/SDXL/FLUX or other AI image provider is part of the target architecture,
> including fallbacks. **Runtime status: LLM-planned Pixabay keywords and mixed photo/video flows
> are implemented locally; editor prompt controls are removed.** Deployment/live-provider checks remain; old AI-image descriptions are legacy history,
> not the new media policy. Cloudflare hosting/KV, text AI, TTS, manual uploads and local
> templates are not removed by this decision. See the authoritative
> [Pixabay policy, current coded limits and implementation checklist](pixabay-media-migration.md).

## Aerial by HTML5 UP

- Design and mountain background: **Aerial**, by **HTML5 UP / @ajlkn**.
- Original design: https://html5up.net/aerial
- License: Creative Commons Attribution 3.0 (CC BY 3.0).
- License information: https://html5up.net/license
- License text: https://creativecommons.org/licenses/by/3.0/
- Background source mirror: https://github.com/anubhavsrivastava/gatsby-starter-aerial/blob/master/src/assets/images/bg.jpg

The JPEG is unmodified and base64-encoded in `src/client/aerial-background.ts` for inline delivery
by the existing single-Worker page. The app-specific CSS adapts the blue mountain backdrop,
diagonal overlay and white typography to a scrolling video editor; it is not a verbatim copy
of the fixed-screen landing page. A visible attribution appears when this theme is active.
The legacy `strata` API/storage value now selects this adaptation, labelled **Aerial** in settings.

## Stellar design inspiration

The Stellar skin uses app-specific CSS inspired by **Stellar**, by **HTML5 UP / @ajlkn**:
https://html5up.net/stellar (CC BY 3.0; license links above).


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
> Canonical specification: [RULE-35-client-side-script-notes.md](RULE-35-client-side-script-notes.md)
> · Normative rule: `system-rules.md` RULE 35 · Verification:
> `tests/script-note-client-only.test.mjs` (12/12). Any older KV-note statement in this
> document is superseded and void.
