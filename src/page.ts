// =============================================================
// FRONTEND — page assembly
// =============================================================
//
// The page HTML is a constant (the only interpolation is the
// fixed prompts array), so it is built once per isolate and
// reused. Re-building a ~280 KB string on every request wastes
// CPU and creates constant GC pressure. The /config/uvxyz route
// only .replace()es copies of it, so the cached string is never
// mutated.
//
// The old single template literal now lives in imported text
// modules (markup + CSS + the two client scripts). The
// placeholders are substituted here with replacer FUNCTIONS so
// no $-patterns in the inserted text are ever special, and the
// result is byte-identical to the single-file version.

import { prompts } from "./prompts";
import { PAGE_MARKUP } from "./client/markup";
import { APP_CSS } from "./client/styles";
import { APP_JS } from "./client/app-js";
import { TEMPLATE_COMPOSER_JS } from "./client/template-composer-js";

let CACHED_HTML: string | null =
	null;

export function createHTML(): string {

	if (CACHED_HTML) {
		return CACHED_HTML;
	}

	CACHED_HTML =
		PAGE_MARKUP
			.replace(
				"__APP_CSS__",
				() => APP_CSS
			)
			.replace(
				"__APP_JS__",
				() => APP_JS
			)
			.replace(
				"__TEMPLATE_COMPOSER_JS__",
				() => TEMPLATE_COMPOSER_JS
			)
			.replace(
				"__PROMPTS_JSON__",
				() => JSON.stringify(prompts)
			);

	return CACHED_HTML;

}
