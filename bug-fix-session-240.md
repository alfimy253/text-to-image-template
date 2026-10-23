# Bug Fix Session #240

**Date:** 2026-10-23
**Branch:** `arena/0b6124f3-text-to-image-template`
**Scope:** adopt the chrome, element order and **four** extra skins of an uploaded
`video_bulk_production.html` reference into the studio, without adding its timeline and without
changing a single existing behaviour of the render engine.

The upload is a self-contained bulk-video mockup: sticky top bar, page heading, a **Bulk** table
view, an **Editor** view (accordions + preview monitor) and a **timeline dock**, all re-skinned by
four themes (Night Lab, Warm Paper, Swiss, Neo Brutalist). This session ports the structure and
the four skins into the real studio and leaves the mockup's dead widgets — timeline, left rail,
metric strip, in-bar theme picker, preview hero/scene-strip widgets — out of the markup entirely.

---

## 1. What was asked

1. Study the theme-system rules (`system-rules.md` RULE 19) before touching anything.
2. Restyle the studio to match the uploaded reference, adopting its **CSS and HTML element
   order**, while **preserving the current app's functions and JS**.
3. Add the upload's **four themes to the site app config** — the picker, the worker whitelist and
   the CSS — not a hard-coded stylesheet.
4. **Hide/remove the timeline**: HTML, CSS and JS. The app has no timeline engine.
5. Convert the current layout to the reference's two shapes:
   - a **table-like layout for bulk creation**, adopted *without* JS functionality, adapted to the
     current app;
   - an **editor-style layout**, adopted with its JS and the accordion's internal element layout
     preserved; new-theme editor elements with no counterpart here are ignored.
6. **Plan first**, then implement, then **document the code additions at the end** under
   **Bug Fix Session #240**.

Acceptance used for this session:

- the four new skins are selectable end-to-end (KV whitelist → CSS token block → settings picker →
  server-side injection), with no flash and junk rejected, **without breaking the existing three**;
- every ID/handler the studio script owns keeps working;
- the timeline is absent (and defensively hidden if a fragment ever reappears);
- `createHTML()` builds, the CSS parses, and the `tsc` error set is unchanged from `main`.

---

## 2. Plan of record

| # | Decision | Why |
| --- | --- | --- |
| 1 | **Seven skins, additive.** `default \| strata \| stellar` stay; add `nightlab \| paper \| swiss \| neo`. | A stored `config:theme` value must never become invalid. The `html[data-theme]` re-skin block is additive, so a new skin is tokens + one picker card + one swatch. |
| 2 | **Layout is global; themes are colour.** The new chrome applies to every skin, exactly as in the upload, where one markup serves all four skins. | Otherwise five skins would need a second, forked layout. |
| 3 | **Keep every id/class the JS owns.** Only *re-parent* them. | `app-js.ts` finds nodes by `id`/`class`, never by parent, so moving a node cannot break a handler. |
| 4 | **Editor view = build card + preview card.** | The upload's preview monitor maps 1:1 onto the real `<canvas>` preview. Its invented widgets (hero image, scene strip, detail grid, play button) have no function here and are omitted. |
| 5 | **Table view = read-only index** rendered from `videoProjects`. | "Adopt the table without its JS": no bulk operations, no search/duplicate/CSV/checkbox column. One real action per row — open that video in the Editor. |
| 6 | **Timeline: not rendered**, plus a `display:none` guard. | No engine, no UI. The guard is for stray fragments only. |
| 7 | **No client storage** (RULE 15). | The view choice lives in a module variable; a reload always boots into the Editor. |
| 8 | **Rail / metrics / in-bar theme picker omitted.** | No function. The theme picker already exists on the settings page (RULE 3/19) and a second picker would be a second source of truth. |

---

## 3. Code additions

### 3.1 `src/index.ts` — the whitelist

`CONFIG_THEMES` went from three names to seven, with the comment block that documents the mapping:

```ts
const CONFIG_THEMES = ["default", "strata", "stellar", "nightlab", "paper", "swiss", "neo"];
```

Nothing else in the Worker changed. `POST /api/config/theme` lower-cases the body value and
checks it against this array before the KV key is touched, so the new names are accepted and any
other string still returns `400 Unknown theme`. `GET /api/config/theme` now reports all seven in
`themes`, which is what the picker renders from.

### 3.2 `src/client/styles.ts` — four skins + the studio shell

**Four token blocks** (before `.aerial-credit`), each a complete `--t-*` set so a skin only has to
override what differs from the default:

| skin | backdrop | panel | accent | ink | shape |
| --- | --- | --- | --- | --- | --- |
| `nightlab` | `#0b0d12` | `#141923` | lime `#baff61` | `#f5f6fa` | 15px radius |
| `paper` | `#f0ece3` | `#fffdf7` | coral `#e85f42` | `#272720` | soft radius |
| `swiss` | `#f4f5f7` | `#ffffff` | `#2364f5` | `#15171b` | tight radius |
| `neo` | `#f6f3e9` | `#fffdf5` | `#d8ff00` | `#111111` | 2px `#111` borders, `4px 4px 0 #111` shadow, uppercase |

`--t-on-accent` is picked for contrast, not for taste: every pair was measured with the WCAG
relative-luminance formula and all of them clear 4.5:1 (Night Lab 15.6, Warm Paper 5.5, Swiss
5.0, Neo 16.4; the default/strata/stellar pairs were re-measured too).

**One layout block** — `STUDIO SHELL (Bug Fix Session #240)` — inserted before the final
`@media (max-width:560px)`. It styles only the new chrome, keyed off `#studio-app`:

- `.app-top` — sticky bar (`z-index: 60`), `.app-brand`, `.app-mark`, `.app-name`,
  `.view-switch` + `.view-switch-btn(.active)`, `.app-generate`.
- `.app-main` — the 1180px column, `.heading` (kills the legacy `.header::after` rule),
  `.kicker`, `.heading-actions .bulk-toggle` (the fixed "+ Add Video" bubble becomes a normal
  button in the heading).
- `.view` / `.view.active` — the two views are siblings and only one is ever displayed.
- `.studio-card` + `.card-head` + `.card-note` + `.preview-dot`.
- The table: `.table-scroll`, `.batch-table`, `.batch-index`, `.batch-title`, `.batch-sub`,
  `.batch-badge` (+ `[data-state="rendering|queued|done|error|skipped"]` tints), `.batch-open`,
  `.table-empty`.
- The editor: `.studio` becomes a two-column grid (`minmax(320px,2fr) minmax(0,3fr)`),
  `.editor-build` flattens `.video-accordion` to a bordered list row, `.preview-card` is sticky
  at `top: 84px` and owns the canvas/progress/status/action-bar spacing.
- `.engine-panels { display: none }` — the four legacy `.audio-panel`s and `.controls` were
  already hidden by `initVideoStudio()` at boot; failing closed in CSS removes the
  first-paint flash.
- The **timeline guard** — `.timeline, .timehead, .timebody, .cliprow, .playhead, .wave
  { display: none !important }`.
- Themed repeats for every surface the skins must re-colour, and `#studio-app:not([hidden]) ~
  .credit-pill { top: 78px }` (66px under 560px) so the fixed credits pill parks under the new
  bar instead of on top of it.
- Breakpoints at 1100 / 860 / 560px: the editor grid collapses to one column, the preview card
  stops being sticky, the top bar wraps.

**Picker support:** the four `.cfg-preview-nightlab|paper|swiss|neo` swatches, plus
`flex-wrap` on `.cfg-themes` and `flex: 1 1 150px` on `.cfg-theme` so seven cards wrap into rows
instead of being squeezed into one.

### 3.3 `src/client/markup.ts` — the new element order

```
#studio-app
  header.app-top            .app-brand(.app-mark,.app-name) · #view-switch(#layout-table,#layout-editor) · #top-generate
  main.app-main
    .header.heading         .heading-copy(.kicker,h1,p) · .heading-actions(#bulk-toggle)
    .aerial-credit
    #bulk-banner
    section#view-table.view .studio-card.table-card   card-head(#batch-note) · table.batch-table > tbody#batch-rows · #batch-empty
    section#view-editor.view.active
      .studio
        .studio-card.editor-build   card-head(#concept-count) · #video-accordions
        .studio-card.preview-card   card-head(.preview-dot,#preview-state) · .canvas-container(#video-canvas)
                                    · #progress-container > #progress-bar · #status-text · #action-bar > #action-hint
        .engine-panels              4 × .audio-panel + .controls (upload / #quality-select / #render-btn)
  #gallery
  #required-modal
```

- `#video-accordions` was duplicated in the pre-session tree (one in each card); it now exists
  **once**, in `.editor-build`. `initVideoStudio()` was already written against a single host.
- The legacy audio/title/captions/controls stack was lifted out of the preview column into
  `.engine-panels`, which is `display:none`. Its ids (`#file-upload`, `#upload`,
  `#quality-select`, `#render-btn`, `.audio-panel`) are untouched — they are the engine's working
  state and `#render-btn` is still moved into `#action-bar` at boot.
- `#gallery` and `#required-modal` are now siblings of `<main>`, not descendants of the old
  `.studio` box, so overlay/gallery positioning is unchanged.
- The action hint reads **"Click ＋ Add Video above, then press Generate."** — the button it
  names is now in the page heading.
- The demo's timeline, rail, metric strip and preview widgets are **not emitted at all**.

### 3.4 `src/client/app-js.ts` — MODULE 1b

A new module immediately before `MODULE 2: video-gallery`. It reads the engine's existing state
and never mutates it:

| function | does |
| --- | --- |
| `setStudioLayout(name)` | sets the module variable, toggles `.active` on `#view-table` / `#view-editor`, sets `.active` + `aria-selected` on `[data-layout]`, re-renders the grid when switching to it. |
| `renderBatchTable()` | rebuilds `#batch-rows` from `videoProjects` — index, title, prompt, scenes, audio, state, open; updates `#batch-note`, `#batch-empty`, `#concept-count` and `#preview-state`. |
| `batchTitle(n, project)` | the live `#va-title-N` value, falling back to `project.name`. |
| `batchPrompt(n)` | a 64-char excerpt of `#va-ai-prompt-N` (whitespace collapsed), else `No prompt yet`. |
| `batchScenes(project)` | `videoCounts()` → `"3 img · 1 GIF · 2 MP4"`, or `—`. |
| `focusVideoInEditor(n)` | switches to the Editor, opens `#va-body-N` + `#va-arrow-N` **the same way `toggleVideoAccordion()` does** (inline `display`, not a class), and scrolls it into view. |
| `bindStudioShell()` | view-switch clicks, delegated `[data-open]` clicks, delegated `input` on `#video-accordions` (so `va-title-*` / `va-ai-prompt-*` edits refresh their row), then one initial render. |

Boot is now `initVideoStudio(); bindStudioShell(); bindLandingActions(); initAuth();`.

Two existing functions gained one line each: `updateVideoStatus(n)` re-renders the grid (a
status change must be visible in the table), and the render path that writes `#status-text`
leaves `#preview-state` alone — it is a queue counter, not a render message.

### 3.5 `src/client/config-page-js.ts` — the picker

`themeOptions` went from three entries to seven (Night Lab, Warm Paper, Swiss, Neo Brutalist, each
with a `sub` line and its `cfg-preview-*` class), and a `themeLabel(theme)` helper now maps a
stored value to the card's display name, so the status line reads
`Current theme: Night Lab.` instead of a hand-written two-branch ternary. The Appearance note names
all seven skins.

---

## 4. Behaviour of the new views

- **Boot** = Editor, exactly as before this session (the canvas is the place users start).
- **Bulk grid** is an index: it shows each video's number, the title typed into the accordion, the
  first 64 characters of its AI image prompt, its scene counts, its MP3 length, its status and one
  **Open ↗** button. It creates nothing, deletes nothing and uploads nothing — every edit still
  happens in the accordion.
- **Open ↗** switches to the Editor, expands that accordion and scrolls to it, using the same
  inline-`display` mechanism as the accordion's own arrow, so the two never disagree.
- **Typing** in `#va-title-N` or `#va-ai-prompt-N` refreshes the row live (delegated `input`
  listener, so accordions created later are covered).
- **The view choice is memory-only** (RULE 15) — no `localStorage`, no cookie.

---

## 5. Checks run

| check | result |
| --- | --- |
| `esbuild src/page.ts` bundle | OK |
| `createHTML()` | **737,212 B** (CSS 440,176 B, inline studio JS ≈274,250 B) |
| `css-tree` parse of the served CSS | 0 errors |
| linkedom structure harness (`layout.cjs`, 44 checks) | **44/44** |
| worker/KV route harness (`test-240.cjs`, 36 checks) | **36/36** |
| `npx tsc --noEmit` vs `main` | **32 diagnostics before and after, identical set** (`git archive HEAD` extracted and compiled side by side) |
| theme GET / POST, all seven values | `200`, and the served `<html>` carries `data-theme="…"` |
| junk theme value (`bogus`), hostile case (`NEO`) | `400` / normalised to `neo` |
| `wrangler dev` smoke (`0.0.0.0:8787`) | `/` 200, `/free` 200, settings page 200, six skins injected in turn |

The 44-check harness asserts the structure *and* the behaviour: top-bar order, the two views as
siblings, `#video-accordions` exactly once inside `.editor-build`, the canvas/progress/status/
action-bar inside `.preview-card`, four `.audio-panel`s inside `.engine-panels`, `#gallery` and
`#required-modal` outside `<main>`, no timeline markup, and then — after evaluating the served
script — row generation, live title/prompt sync, the view switch, Open→Editor→expanded, the
accordion arrow, the 10-video cap and the asset-less generate block.

---

## 6. Deliberately not done

- **No timeline.** No markup, no CSS beyond the guard, no JS.
- **No bulk operations** in the table (no checkboxes, duplicate, delete, export, search). The
  upload's toolbar is omitted; the table is an index, as asked.
- **No left rail, metric strip, preview hero/scene strip/detail grid/play button.** None of them
  have a counterpart function in this app.
- **No in-bar theme picker.** The settings page owns the theme (RULE 19); a second picker would be
  a second source of truth.
- **No new state.** The grid renders `videoProjects`; nothing is copied, cached or persisted.
- **No change to the render engine, the API routes, the credits system or the composer.**

---

## 7. Files changed

| file | change |
| --- | --- |
| `src/index.ts` | `CONFIG_THEMES` 3 → 7 (+ comment) |
| `src/client/styles.ts` | 4 token blocks, the studio-shell layout block, 4 swatches, picker wrap |
| `src/client/markup.ts` | new top bar / heading / two views / editor grid; single `#video-accordions`; `.engine-panels`; hint copy |
| `src/client/app-js.ts` | MODULE 1b (7 functions), one call in `updateVideoStatus()`, new boot order |
| `src/client/config-page-js.ts` | `themeOptions` 3 → 7, `themeLabel()`, Appearance note |
| `system-rules.md` | RULE 3, RULE 18, RULE 19 rewritten for seven skins and the new shell |
| `userflow.md` | new §11 (the two views) + header counts |
| `README.md` | feature bullet, limits, theme list |
| `bug-audit.md` | session note |
| `bug-fix-session-240.md` | this document |

---

## 8. Follow-ups (not done here)

- The table's **Scenes** and **Audio** cells read from `project.assets` / `project.audio`; a video
  mid-render shows the assets it already has, not a percentage. Wiring `#preview-state` to the
  render loop would make it a true progress readout.
- `#batch-sub` excerpts `va-ai-prompt-N` only. If the prompt ever moves into the project model,
  the DOM read should be replaced by a field read.
- The upload's **theme picker in the top bar** is intentionally absent; if a per-view switch is
  ever wanted it must stay a *client-side preview* of the same global setting, never a second
  stored preference.
