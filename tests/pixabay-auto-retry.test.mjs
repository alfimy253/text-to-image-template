import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHTML } from '../src/page.ts';
import { APP_JS } from '../src/client/app-js.ts';

const PAGE = createHTML();

/*
 * Auto-retry contract for the Pixabay image flow.
 *
 * The flow used to end at the first unfriendly answer:
 *   - "Pixabay rate limit (429). Please wait before searching again." was
 *     printed and the scene was dropped (one search per scene, no wait);
 *   - "The image batch stopped responding for 120 seconds." aborted the
 *     batch and finalised with "stopped";
 *   - "The clip took too long to load." dropped the clip after a single
 *     15 s probe.
 * Each of those now schedules a bounded, visible retry. These tests pin that
 * behaviour down.
 */
function studioWindow(options = {}) {
  const dom = new JSDOM(PAGE, { url: 'https://studio.test/free', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;

  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => {};
  w.HTMLMediaElement.prototype.load = () => {};
  w.URL.createObjectURL = () => 'blob:studio.test/' + Math.random().toString(36).slice(2);
  w.URL.revokeObjectURL = () => {};
  w.confirm = () => true;
  w.alert = () => {};
  w.HTMLCanvasElement.prototype.getContext = function () {
    return { fillRect() {}, clearRect() {}, fillText() {}, strokeText() {}, measureText: (t) => ({ width: 8 }), save() {}, restore() {}, beginPath() {}, closePath() {}, arc() {}, rect() {}, clip() {}, translate() {}, scale() {}, rotate() {}, setTransform() {}, setLineDash() {}, fill() {}, stroke() {}, createLinearGradient: () => ({ addColorStop() {} }) };
  };
  w.Image.prototype.decode = () => Promise.resolve();

  /* Fast timers so a test does not sit through real backoffs. */
  w.__PIXABAY_SCENE_RETRY = { attempts: 3, baseMs: 10, maxMs: 20, idleMs: 5000 };
  w.__IMAGE_AUTO_RETRY_TIMING = { limit: 2, minDelayMs: 10, maxDelayMs: 60, fallbackDelayMs: 20, tickMs: 5 };

  const calls = [];
  const state = { searchPlans: [], rateLimit: options.rateLimit || 0, rateLimitWaitSeconds: options.rateLimitWaitSeconds || 2 };

  w.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const path = new URL(url, 'https://studio.test').pathname;
    calls.push(path);
    if (path === '/api/session') return Response.json({ authenticated: true, user: { username: 'tester', usertype: 'free' } });
    if (path === '/api/credits') return Response.json({ plan: { id: 'free', label: 'Free', limits: { images: 10000 } }, remaining: { images: 10000 } });
    if (path === '/api/pipeline-capabilities') return Response.json({ singleAttemptScript: true, compactPrompts: true });
    if (path === '/api/media/search') {
      const urlObj = new URL(url, 'https://studio.test');
      state.searchPlans.push(urlObj.searchParams.get('q'));
      if (state.rateLimit > 0) {
        state.rateLimit--;
        return Response.json(
          { success: false, error: 'Pixabay rate limit (429). Please wait before searching again.' },
          { status: 429, headers: { 'Retry-After': String(state.rateLimitWaitSeconds) } }
        );
      }
      return Response.json({ success: true, provider: 'pixabay', hits: [
        { id: 900 + state.searchPlans.length, type: urlObj.searchParams.get('type') || 'image',
          pageURL: 'https://pixabay.com/photos/test/', user: 'Fixture artist', duration: 2 }
      ] });
    }
    if (path === '/api/media/asset') {
      return new Response(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]),
        { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    return new Response('{}', { status: 404 });
  };

  return { w, dom, calls, state };
}

function seedFlow(w, keywords) {
  w.addVideoAccordion();
  const project = w.__VIDEO_PROJECTS[0];
  project.script = 'Garden flowers help the garden. Flowers grow in the soil.';
  project._seoTopic = 'garden';
  project._seoMinutes = 1;
  project.imagePromptFlowId = 'imgflow-1-test';
  project.imagePrompts = keywords.map((q, i) => 'pixabay:' + JSON.stringify({ q: q, page: 1, index: 0, scene: i }));
  project.imagePromptTarget = keywords.length;
  project.imagePromptStates = {};
  project._imageFlowStopReason = '';
  return project;
}

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, label, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return true;
    await settle(10);
  }
  assert.fail('timed out waiting for ' + label);
}

test('a 429 with Retry-After is waited out and retried automatically', async (t) => {
  /* Every search of the first pass answers 429; the automatic retry then finds
   * Pixabay healthy again. Nothing is clicked in between. */
  const { w, calls, state } = studioWindow({ rateLimit: 3 });
  t.after(() => { try { w.close(); } catch (_) {} });
  w.eval(APP_JS.replace('__PROMPTS_JSON__', '[]'));
  await settle(40);
  const project = seedFlow(w, ['garden flowers', 'sunny garden']);

  await w.retryImagePromptFlow(1);

  /* Pass 1: two scenes x three attempts, then a scheduled retry. */
  assert.equal(state.searchPlans.length, 4,
    'the rate-limited scene is attempted three times, the healthy one once');
  assert.ok(project._imageAutoRetry && project._imageAutoRetry.kind === 'rate-limit',
    'the 429 armed a scheduled automatic retry');
  const statusText = w.document.getElementById('va-ai-status-1').textContent;
  assert.match(statusText, /retrying the missing scenes automatically in \d+s \(attempt 1 of 2\)/,
    'the wait is visible as a countdown, not as a bare failure: ' + statusText);

  await waitFor(() => project.assets.length === 2, 'the automatic retry to import both scenes');

  assert.equal(project._imageAutoRetries, 1, 'exactly one automatic retry ran');
  assert.equal(state.searchPlans.length, 5, 'the automatic retry searched only the missing scene');
  assert.equal(project.imagePromptStates['0'].state, 'imported');
  assert.equal(project.imagePromptStates['1'].state, 'imported');

  const log = w.__IMAGE_AUTO_RETRY_LOG || [];
  assert.ok(log.some((e) => e.event === 'scheduled' && e.kind === 'rate-limit'), 'the retry was scheduled as a rate-limit wait');
  assert.ok(log.some((e) => e.event === 'running' && e.attempt === 1), 'the scheduled retry actually ran');
  assert.equal(calls.filter((p) => p === '/api/media/search').length, 5);
});

test('the automatic retry is capped and then hands control back to the button', async (t) => {
  const { w, calls } = studioWindow();
  t.after(() => { try { w.close(); } catch (_) {} });
  w.eval(APP_JS.replace('__PROMPTS_JSON__', '[]'));
  await settle(40);
  const project = seedFlow(w, ['garden flowers']);

  project._imageAutoRetries = 2;
  const armed = w.maybeScheduleImageAutoRetry(project, 'The image batch stopped responding for 120 seconds.');
  assert.equal(armed, false, 'the retry budget is spent after two automatic attempts');
  assert.ok(!project._imageAutoRetry, 'no timer is armed');
  assert.equal(project._imageFlowRetry, null, 'the marker is cleared so a later finalize cannot loop');
  assert.equal(calls.filter((p) => p === '/api/media/search').length, 0, 'nothing is searched');
});

test('an idle batch is planned as an automatic retry instead of a verdict', async () => {
  const { w, dom } = studioWindow();
  try {
    w.eval(APP_JS.replace('__PROMPTS_JSON__', '[]'));
    await settle(40);
    const project = seedFlow(w, ['garden flowers', 'sunny garden']);

    project._imageFlowRetry = { kind: 'idle', retryable: true, hintMs: 25, reason: 'The image batch stopped responding for 120 seconds.' };
    const plan = w.imageAutoRetryPlan(project, 'The image batch stopped responding for 120 seconds.');
    assert.ok(plan, 'the 120 s idle abort is retryable');
    assert.equal(plan.kind, 'idle');
    assert.equal(plan.attempt, 1);
    assert.equal(w.imageSceneGapCount(project), 2, 'both scenes are counted as missing');

    /* Delivered scenes are never counted again, so a retry cannot re-bill them. */
    const gallery = w.document.getElementById('va-gallery-1');
    const card = w.document.createElement('div');
    gallery.appendChild(card);
    project.assets.push({ kind: 'image', sceneIndex: 0, imagePromptFlowId: project.imagePromptFlowId,
      stockSource: { provider: 'pixabay', id: 1 }, url: 'blob:x', card: card, file: { name: 'a.jpg' } });
    assert.equal(w.imageSceneGapCount(project), 1, 'only the missing scene is retried');
  } finally {
    try { dom.window.close(); } catch (_) {}
  }
});

test('a rejected credential is a verdict, not a retryable stop', async () => {
  const { w, dom } = studioWindow();
  try {
    w.eval(APP_JS.replace('__PROMPTS_JSON__', '[]'));
    await settle(40);
    const project = seedFlow(w, ['garden flowers']);

    project._imageFlowRetry = { kind: 'auth', retryable: false, hintMs: 0, reason: 'Pixabay rejected the search. Check server configuration.' };
    assert.equal(w.imageAutoRetryPlan(project, 'Pixabay rejected the search. Check server configuration.'), null,
      '401/403 must not be retried automatically');
  } finally {
    try { dom.window.close(); } catch (_) {}
  }
});

test('the clip probe retries before reporting "The clip took too long to load."', async () => {
  const { w, dom } = studioWindow();
  try {
    w.eval(APP_JS.replace('__PROMPTS_JSON__', '[]'));
    await settle(40);

    /* One transient failure, then success: the clip is kept, not dropped. */
    let attempts = 0;
    w.probeMp4Duration = async function () {
      attempts++;
      if (attempts === 1) throw new Error('The clip took too long to load.');
      return 4.5;
    };
    const duration = await w.probeMp4DurationWithRetry('blob:studio.test/clip.mp4', 3, null);
    assert.equal(duration, 4.5, 'the retried probe returns the real duration');
    assert.equal(attempts, 2, 'the first failure produced exactly one retry');

    /* A clip that never loads still fails, but only after the attempt budget. */
    attempts = 0;
    w.probeMp4Duration = async function () {
      attempts++;
      throw new Error('The clip took too long to load.');
    };
    await assert.rejects(
      () => w.probeMp4DurationWithRetry('blob:studio.test/broken.mp4', 3, null),
      /took too long to load/,
      'the original message survives the retry ladder'
    );
    assert.equal(attempts, 3, 'three attempts before giving up');
  } finally {
    try { dom.window.close(); } catch (_) {}
  }
});

test('a batch stream that goes silent trips the idle guard, which plans a retry instead of a verdict', async (t) => {
  const { w } = studioWindow();
  t.after(() => { try { w.close(); } catch (_) {} });
  w.eval(APP_JS.replace('__PROMPTS_JSON__', '[]'));
  await settle(40);

  /* 30 ms instead of the production 120 s, so the guard is observable. */
  w.__SEO_FLOW_TIMING.imageBatchIdleTimeoutMs = 30;

  const project = seedFlow(w, ['garden flowers', 'sunny garden']);
  project._imageFlowActive = true;
  project._imageFlowSeq = 7;

  const baseFetch = w.fetch;
  w.fetch = async (input, init = {}) => {
    const path = new URL(String(input && input.url ? input.url : input), 'https://studio.test').pathname;
    if (path !== '/api/image-batch') return baseFetch(input, init);
    /* One event, then silence: exactly the stall the guard exists for. The
     * stream errors when the guard aborts, like a real fetch would. */
    const signal = init && init.signal;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'start', count: 2 }) + '\n'));
        if (signal) {
          signal.addEventListener('abort', function () {
            try { controller.error(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })); } catch (_) {}
          });
        }
      }
    }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
  };

  await w.runImageBatch(1, project.imagePrompts, project.imagePromptFlowId, project, 7, 0);

  assert.match(project._imageFlowStopReason, /stopped responding for 0 seconds|stopped responding/i,
    'the idle guard still reports why it cut the stream');
  assert.ok(project._imageFlowRetry && project._imageFlowRetry.retryable === true,
    'the idle abort is remembered as retryable, not as a verdict');

  /* finalizeImagePromptFlow clears this before it asks for a retry. */
  project._imageFlowActive = false;
  const armed = w.maybeScheduleImageAutoRetry(project, project._imageFlowStopReason);
  assert.equal(armed, true, 'the flow re-arms itself instead of ending');
  assert.ok(project._imageAutoRetry && project._imageAutoRetry.kind === 'idle');
  const countdown = w.document.getElementById('va-ai-status-1').textContent;
  assert.match(countdown, /retrying the missing scenes automatically in \d+s \(attempt 1 of 2\)/,
    'the wait is visible: ' + countdown);
  w.cancelImageAutoRetry(project);
});
