import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHTML } from '../src/page.ts';
import { APP_JS } from '../src/client/app-js.ts';

const PAGE = createHTML();

/* Minimal studio harness for one editor video: enough DOM and fetch stubs
 * to run startImagePromptFlow end to end against mocked /api/image-prompts
 * and /api/image-batch endpoints. */
function studioWindow() {
  const dom = new JSDOM(PAGE, {
    url: 'https://studio.test/free',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;

  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLMediaElement.prototype.load = () => {};
  w.URL.createObjectURL = () => 'blob:studio.test/' + Math.random().toString(36).slice(2);
  w.URL.revokeObjectURL = () => {};
  w.confirm = () => true;
  w.alert = () => {};

  w.HTMLCanvasElement.prototype.getContext = function () { return { fillRect() {}, clearRect() {}, fillText() {}, strokeText() {}, measureText: (t) => ({ width: 8 }), save() {}, restore() {}, beginPath() {}, closePath() {}, arc() {}, rect() {}, clip() {}, translate() {}, scale() {}, rotate() {}, setTransform() {}, setLineDash() {}, fill() {}, stroke() {}, createLinearGradient: () => ({ addColorStop() {} }) }; };
  w.Image.prototype.decode = () => Promise.resolve();

  const calls = [];
  w.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const path = new URL(url, 'https://studio.test').pathname;
    calls.push(path);
    if (path === '/api/session') {
      return new Response(JSON.stringify({ authenticated: true, user: { username: 'tester', usertype: 'free' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path === '/api/credits') {
      return new Response(JSON.stringify({ plan: { id: 'free', label: 'Free', limits: { images: 10000 } }, remaining: { images: 10000 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path === '/api/pipeline-capabilities') {
      return new Response(JSON.stringify({ singleAttemptScript: true, compactPrompts: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path === '/api/image-prompts') {
      const body = JSON.parse(String(init.body || '{}'));
      const offset = Number(body.batch && body.batch.offset) || 0;
      const rounds = [['garden flowers', 'sunny garden', 'herbs in pots'], ['roses in a vase', 'leafy mint', 'terracotta tiles']];
      const round = rounds[Math.floor(offset / 3)] || [];
      const prompts = round.map(function (q, i) {
        return 'pixabay:' + JSON.stringify({ q: q, page: 1, index: i, scene: offset + i + 1 });
      });
      return new Response(JSON.stringify({ success: true, prompts: prompts }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path === '/api/image-batch') {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(JSON.stringify({ type: 'start', count: 3 }) + '\n'));
          controller.enqueue(enc.encode(JSON.stringify({ type: 'done', count: 3, generated: 0, failed: 0 }) + '\n'));
          controller.close();
        }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
    }
    return new Response('{}', { status: 404 });
  };
  return { w, dom, calls };
}

test('Pixabay search keywords planned from the script are shown in the video accordion', async t => {
  const { w, calls } = studioWindow();
  t.after(() => { domClose(w); });
  w.eval(APP_JS.replace('__PROMPTS_JSON__', '[]'));
  await new Promise((r) => setTimeout(r, 40));

  w.addVideoAccordion();
  const project = w.__VIDEO_PROJECTS[0];
  project.script = 'Garden flowers help the garden. Flowers grow in the soil.';
  project._seoTopic = 'garden';
  project._seoMinutes = 1;
  project._imageFlowActive = true;

  await w.startImagePromptFlow(1);

  const box = w.document.getElementById('va-image-keywords-1');
  assert.ok(box, 'keywords box exists');
  assert.equal(box.style.display, '', 'keywords box is visible');
  assert.ok(box.textContent.includes('garden flowers'), 'shows keyword "garden flowers"');
  assert.ok(box.textContent.includes('sunny garden'), 'shows keyword "sunny garden"');
  assert.ok(box.textContent.includes('herbs in pots'), 'shows keyword "herbs in pots"');
  assert.ok(box.textContent.includes('roses in a vase'), 'shows keyword "roses in a vase"');
  assert.equal(box.querySelectorAll('.va-seo-chip').length, 6, 'one chip per planned scene');

  const retry = w.document.getElementById('va-image-retry-1');
  assert.ok(retry, 'retry button exists');
  assert.equal(retry.style.display, '', 'retry button is visible after a flow');

  /* The flow stopped because no two Pixabay video clips were delivered: a
   * stopped flow is exactly when the user needs the retry button. */
  assert.equal(w.document.getElementById('va-ai-status-1').textContent.indexOf('Pixabay image flow stopped'), 0);

  /* Retrying re-plans keywords from the script: the prompt endpoint is hit again. */
  const before = calls.filter((p) => p === '/api/image-prompts').length;
  await w.retryImagePromptFlow(1);
  await new Promise((r) => setTimeout(r, 200));
  const after = calls.filter((p) => p === '/api/image-prompts').length;
  assert.equal(after, before + 2, 'retry re-ran the Pixabay keyword plan (two batches)');

  const boxAgain = w.document.getElementById('va-image-keywords-1');
  assert.equal(boxAgain.style.display, '', 'keywords are still shown after the retry');
});

test('the keywords box and retry button are hidden before a flow runs', async t => {
  const { w, calls } = studioWindow();
  t.after(() => { domClose(w); });
  w.eval(APP_JS.replace('__PROMPTS_JSON__', '[]'));
  await new Promise((r) => setTimeout(r, 40));
  w.addVideoAccordion();

  assert.equal(w.document.getElementById('va-image-keywords-1').style.display, 'none');
  assert.equal(w.document.getElementById('va-image-retry-1').style.display, 'none');

  /* Rendering with no planned prompts keeps the box hidden. */
  w.__VIDEO_PROJECTS[0].imagePrompts = [];
  w.renderImageKeywords(1);
  assert.equal(w.document.getElementById('va-image-keywords-1').style.display, 'none');
});

function domClose(w) { try { w.close(); } catch (_) {} }
