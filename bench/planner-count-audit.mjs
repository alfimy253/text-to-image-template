/*
 * Session #275 deep-debug harness — scene-count reconciliation audit.
 *
 * Runs generateImagePrompts() against every realistic 8B reply shape for the
 * word-count totals (6 / 8 / 10 scenes) and every chunk offset:
 *   chunk-exact, chunk-relative (renumbered), whole plan, whole plan without
 *   `.scene` ids, and whole plans one/two/three scenes over or under.
 *
 * "ok" means the returned scene numbers are glued to the requested slots.
 * Before #275 the `whole±1` / `whole±2` columns all threw
 * `Scene keyword planner returned the wrong scene count`.
 *
 * Run: node --import tsx bench/planner-count-audit.mjs
 */
import { generateImagePrompts } from '../src/modules/image-prompts.ts';

function typesFor(total, opts = {}) {
	const videoA = opts.videoA ?? 1, videoB = opts.videoB ?? total - 2;
	return Array.from({ length: total }, (_, s) => (s === videoA || s === videoB ? 'video' : 'image'));
}
function plan(kind, total, offset, count) {
	const globalTypes = typesFor(total);
	if (kind === 'chunk-exact') {
		return Array.from({ length: count }, (_, i) => ({ scene: offset + i, type: globalTypes[offset + i], keywords: 'topic scene ' + (offset + i) }));
	}
	if (kind === 'chunk-relative') {
		return Array.from({ length: count }, (_, i) => ({ scene: i, type: globalTypes[offset + i], keywords: 'topic scene ' + (offset + i) }));
	}
	if (kind === 'whole') {
		return Array.from({ length: total }, (_, s) => ({ scene: s, type: globalTypes[s], keywords: 'topic scene ' + s }));
	}
	if (kind.startsWith('whole+')) {
		const n = total + Number(kind.slice(6));
		const t = typesFor(n);
		return Array.from({ length: n }, (_, s) => ({ scene: s, type: t[s], keywords: 'wide topic scene ' + s }));
	}
	if (kind.startsWith('whole-')) {
		const n = total - Number(kind.slice(6));
		const t = typesFor(n);
		return Array.from({ length: n }, (_, s) => ({ scene: s, type: t[s], keywords: 'topic scene ' + s }));
	}
	if (kind === 'no-scene-numbers-whole') {
		return Array.from({ length: total }, (_, s) => ({ type: globalTypes[s], keywords: 'topic scene ' + s }));
	}
	if (kind === 'no-scene-numbers-chunk') {
		return Array.from({ length: count }, (_, i) => ({ type: globalTypes[offset + i], keywords: 'topic scene ' + (offset + i) }));
	}
	throw new Error('kind ' + kind);
}

const kinds = ['chunk-exact', 'chunk-relative', 'whole', 'no-scene-numbers-whole', 'no-scene-numbers-chunk',
	'whole+1', 'whole+2', 'whole-1', 'whole-2', 'whole+3'];

for (const total of [6, 8, 10]) {
	for (let offset = 0; offset < total; offset += 3) {
		const count = Math.min(3, total - offset);
		const row = [];
		for (const kind of kinds) {
			let reply;
			try { reply = plan(kind, total, offset, count); } catch { continue; }
			let result;
			try {
				const tokens = await generateImagePrompts(
					{ AI: { run: async () => ({ response: JSON.stringify({ scenes: reply }) }) } },
					'text',
					{ topic: 'forest', script: 'word '.repeat({ 6: 100, 8: 200, 10: 400 }[total]), minutes: 1, totalScenes: total, batch: { offset, count, attempt: 0, previous: [] } }
				);
				const scenes = tokens.map(t => JSON.parse(t.slice(8)));
				const expected = Array.from({ length: count }, (_, i) => offset + i);
				const got = scenes.map(s => s.scene);
				result = JSON.stringify(got) === JSON.stringify(expected) ? 'ok' : 'WRONG-MAP ' + JSON.stringify(got);
			} catch (e) { result = 'THROW ' + e.message; }
			row.push(kind + '=' + result);
		}
		console.log(`total=${total} offset=${offset} count=${count}\n  ` + row.join('\n  '));
	}
}
