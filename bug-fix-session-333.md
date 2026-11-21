# Bug Fix Session 333: Instruct-model migration — Gemma 4 is now the only text model (2026-11-21)

## System documentation: text/instruct model policy

**Scope of this session:** every text call in the app — the SEO planner, the script writer, the
scene-prompt planner, the raw `POST /api/llm/generate` route, the Cloudflare probe on the settings
page, the OpenRouter default model, and every test that pinned the old slugs.

**Why:** the old instruct builds (`@cf/meta/llama-3.1-8b-instruct-fp8`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
and the OpenRouter `meta-llama/llama-3.3-8b-instruct:free` default, plus the
`@cf/mistralai/mistral-small-3.1-24b-instruct` slug that appeared in tests) are retired. All text
generation in the codebase now runs the same Gemma 4 instruct build, `@cf/google/gemma-4-26b-a4b-it`.
This session is not a re-architecture: the planner fallback list, the ladder, the provider rotation and
the relay contract all stay exactly as they were, with a single slug behind them.

### Current policy

| Layer | Current slug |
| --- | --- |
| Cloudflare Workers AI (planner, writer, prompts, `/api/script`, `/api/seo-plan`, `/api/image-prompts`, `/api/llm/generate`) | `@cf/google/gemma-4-26b-a4b-it` (`SCRIPT_MODEL`, `SEO_PLAN_FALLBACK_MODELS`, `DEFAULT_OPENROUTER_MODEL` — the OpenRouter-side default is `google/gemma-4-26b-a4b-it`) |
| OpenRouter (provider rotation default) | `google/gemma-4-26b-a4b-it` (overridable via `OPENROUTER_MODEL`) |
| TTS (deliberately unchanged) | `@cf/myshell-ai/melotts` + `@cf/deepgram/aura-2-en` / `aura-1` |
| Image models (deliberately unchanged) | `@cf/stabilityai/stable-diffusion-xl-base-1.0` + `@cf/black-forest-labs/flux-1-schnell` fallback |

### What changed

| File | Change |
| --- | --- |
| `src/index.ts` | `SCRIPT_MODEL` → `@cf/google/gemma-4-26b-a4b-it` (the TTS model `VOICEOVER_MODEL` is untouched). The comment above it now records the Gemma-4-only policy instead of the llama-3.1-8b deprecation story. |
| `src/modules/script-seo.ts` | `SEO_PLAN_FALLBACK_MODELS` → `["@cf/google/gemma-4-26b-a4b-it"]`. Since the primary and the fallback are now the same slug, the dedup in `planOneSeoKeywordSet()` collapses the candidate list to one model and the walkthrough `alternateModel` rotation degrades to the same-model retry — the correct behaviour when a single instruct model is shipped. Comment references to the 8B/70B builds were re-worded. |
| `src/modules/image-prompts.ts` | Comment block rewritten (the planner now runs the same Gemma 4 slug; `IMAGE_PROMPT_MAX_TOKENS` stays at 3584 and there is no second fallback model). `IMAGE_PROMPT_FALLBACK_MODELS` remains `[]` (the fallback parameter is unused; retries are coaching on the same model). |
| `src/modules/llm-openrouter.ts` | `DEFAULT_OPENROUTER_MODEL` → `google/gemma-4-26b-a4b-it` (OpenRouter's provider-prefixed slug for the same Gemma 4 instruct build). The constants comment and the `/api/llm/status` provider descriptor now name the Gemma slug instead of the 8B llama build. The family-classification regexes (`INSTRUCT_MODEL` / `NON_INSTRUCT_MODEL`) were intentionally kept — they classify any instruct/text slug for the relay, not this deployment's pinned model, and `gemma` is already a first-class family there. |
| `src/modules/api-relay.ts` | Comment example slug only (the `SEO planner model failed (<slug>: Relay endpoint answered 404)` illustration) → the Gemma slug. |
| `src/modules/script-notes.ts` | Two comment references to the 8B model → the instruct model. |
| `src/client/app-js.ts` | Comment only (SCRIPT_MODEL description). |
| `src/client/config-page-js.ts` | Settings-page input placeholder → `google/gemma-4-26b-a4b-it`. |
| `e2e/index.ts` | Mock dispatch key off `gemma` instead of `llama` (the old `m.includes("llama")` would no longer match any text call). |
| `tests/api-relay.test.mjs` | The ~20 synthetic `@cf/meta/llama` fixtures → the real Gemma slug (`@cf/google/gemma-4-26b-a4b-it`). Still exercises an instruct slug through the relay. |
| `tests/llm-openrouter.test.mjs` | The instruct-model list (the three retired @cf slugs → the Gemma Workers AI slug + the OpenRouter slug), the `runtime.ai.run(slug)` fixtures and the config/placeholder/settings assertions → Gemma. |
| `tests/session-250-batch-pipeline.test.mjs` | The heading/mock/expected slug → `@cf/google/gemma-4-26b-a4b-it`; part 1 keeps the max_tokens assertion; part 2 (the old "falls back to 70B" branch) now asserts the real contract: when the single instruct slug fails, every attempt stays on that slug and the route answers an error — never a second model. The `model.includes("llama")` writer classifier → `gemma`. |
| `tests/deep-debug-regressions.test.mjs` | The empty-primary branch now asserts the real contract (single Gemma slug → empty reply propagates as the planner error, and only the Gemma slug is ever called). |
| `tests/session-332-relay-404.test.mjs` | Two fixtures + the doc comment → the Gemma slug. |
| `tests/session-261-browser-offload.test.mjs` | No instruct-slug fixtures (verified — no old slugs). |
| `README.md`, `system-rules.md`, `userflow.md`, `quick-batch-table-system-requirements.md`, `seo-walkthrough-session-requirements.md` | Current-state docs updated to the Gemma slug (and, where they quoted the "direct `meta-llama` default", to the OpenRouter slug `google/gemma-4-26b-a4b-it`). |

### Deliberately NOT changed (and why)

- **TTS models are not text models** — `@cf/myshell-ai/melotts` and the `@cf/deepgram/aura-2-en` /
  `@cf/deepgram/aura-1` English fallbacks stay exactly as they were. Voiceover audio synthesis is not
  text generation; Gemma cannot speak. Same for the Pixabay scene-keyword path (no model at all) and
  the image routes (Pixabay only).
- **`src/index.ts.original`** — the 21,009-line pre-split snapshot is dead reference-only code that is
  never imported; rewriting it would falsify the reference. Its old slugs remain, visibly inside a
  file that is documented as stale.
- **`worker-configuration.d.ts`** — the generated Workers AI model catalog (`wrangler types`). It is a
  machine-generated catalog of every valid slug, not a usage; hand-editing it would break the type
  contract. `@cf/google/gemma-4-26b-a4b-it` is already in it (`Base_Ai_Cf_Google_Gemma_4_26B_A4B_IT`).
- **`bench/pipeline-sim/results/*.json`** — historical benchmark outputs recorded with the old models.
  Rewriting the record would falsify the measurement; they are kept untouched as dated evidence.
- **Historical `bug-fix-session-*.md` / `bug-audit.md` / `script-keyword-retry-debug.md`** — dated
  session records describing what the code did at the time. Their slugs are left intact; this file is
  the current authority.
- **`INSTRUCT_MODEL` / `NON_INSTRUCT_MODEL`** — family classification regexes, not deployments. The
  relay refuses slugs that are neither clearly instruct nor TTS; the `gemma` family was already first
  class and is now the only one shipped. The `@hf/thebloke/deepseek-coder-6.7b-instruct-awq` slug
  survives in `tests/llm-openrouter.test.mjs` purely as the "any instruct slug passes" control — it
  is not a pinned deployment.
- **The `safe` relay contract** — `isInstructModel("@cf/google/gemma-4-26b-a4b-it")` returns `true`,
  and `permitsNonVisualModel` accepts it, so the relay, the provider rotation and the pool logic are
  unchanged for the new slug.

### Verification log (this session)

- `node --import tsx --test tests/llm-openrouter.test.mjs tests/session-332-relay-404.test.mjs tests/api-relay.test.mjs tests/session-250-batch-pipeline.test.mjs`
  → 78/84 pass; the 6 failures are all pre-existing baseline failures (the `502 !== 200` in the Stage-2
  sub-test that fails at its sub-test 1 in a pristine checkout, and five "Pixabay API key is not
  configured" / live-network fixture failures), not migration-caused.
- `tests/deep-debug-regressions.test.mjs` → the rewritten empty-reply test passes; the remaining
  failures (`reader.cancel()` refund, worker-credit exhaustion, client export/delete) and the
  end-of-file hang are pre-existing (identical in the pristine baseline).
- `tests/progressive-image-pipeline.test.mjs` (3 failures — fixed 12-scene rule vs 14-scene plan) and
  `tests/seo-walkthrough.test.mjs` / `tests/script-notes-pipeline.test.mjs` (10 failures) — identical
  in the pristine baseline; not model-related.
- `tests/session-331-*.test.mjs`, `tests/session-261-browser-offload.test.mjs`,
  `tests/seo-plan-resilience.test.mjs` → 39 pass / 4 fail, identical to the baseline.
- `npx tsc --noEmit` → 31 pre-existing `src/index.ts` implicit-any errors, none related to the slug
  change (no `gemma`/`llama`/`mistral` errors reported).
- `grep -rn "llama\|mistral\|instruct\|deepseek" --include=*.ts --include=*.mjs src tests e2e bench/pipeline-sim/model.mjs`
  → only intentional historical-note comments, the `INSTRUCT_MODEL` classification regex token list,
  and the `deepseek-coder` "any instruct slug passes" control remain.

### Notes / follow-ups

- `SEO_PLAN_FALLBACK_MODELS` and the image-prompt planner both describe the same single slug, so no
  second model is ever asked for. The planner's candidate list still dedups, so there is no wasted
  double-call. If a genuine fallback model is ever re-added, it must be a Gemma 4 instruct build —
  the old llama fallback slug is retired, not commented out.
- The `OPENROUTER_MODEL` env var still overrides the OpenRouter slug for any deployment that wants a
  different OpenRouter-side slug; the default is now Gemma.
- Historical docs that quote the old slugs still describe the code as it was at the time and were
  deliberately left untouched; this file (and the code) is the current authority.
