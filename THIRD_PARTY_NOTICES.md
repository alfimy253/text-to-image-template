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
