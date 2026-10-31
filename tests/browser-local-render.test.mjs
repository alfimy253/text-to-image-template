import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './studio-render-harness.mjs';

function seed(w) {
  w.addVideoAccordion();
  const p = w.__VIDEO_PROJECTS[0];
  const clip = w.document.createElement('video');
  p.assets.push({ kind: 'mp4', file: new w.File(['x'], 'clip.mp4', { type: 'video/mp4' }), videoEl: clip, duration: 2, url: 'blob:clip', card: null });
  return p;
}

test('legacy studio entry renders locally without submitting or serializing media', async () => {
  const { w, stats } = harness();
  const project = seed(w);
  const oldFetch = w.fetch;
  let submissions = 0;
  w.fetch = (input, init) => {
    if (String(input) === '/api/render') submissions++;
    return oldFetch(input, init);
  };
  const oldRead = w.FileReader.prototype.readAsDataURL;
  w.FileReader.prototype.readAsDataURL = function () { throw new Error('unexpected base64 serialization'); };
  try {
    await w.apiRenderVideo(1);
    assert.equal(submissions, 0);
    assert.equal(project.status, 'done');
    assert.ok(stats().encoded > 0);
    assert.match(w.document.getElementById('status-text').textContent, /rendered in this browser/);
  } finally { w.FileReader.prototype.readAsDataURL = oldRead; w.close(); }
});

test('explicit remote mode still submits and falls back locally when busy', async () => {
  const { w } = harness();
  const project = seed(w);
  const oldFetch = w.fetch;
  let payload;
  w.fetch = (input, init) => {
    if (String(input) === '/api/render') {
      payload = JSON.parse(init.body);
      return Promise.resolve(new Response(JSON.stringify({ success: true, status: 'busy', inProgress: 10, max: 10 }), { headers: { 'Content-Type': 'application/json' } }));
    }
    return oldFetch(input, init);
  };
  try {
    await w.apiRenderVideo(1, { remote: true });
    assert.equal(payload.assets.length, 1);
    assert.equal(project.status, 'done');
  } finally { w.close(); }
});

test('local rendering refuses to overlap a worker using the shared renderer', async () => {
  const { w, warnings } = harness();
  const project = seed(w);
  w.__workerMode = true;
  try {
    await w.apiRenderVideo(1);
    assert.notEqual(project.status, 'done');
    assert.ok(warnings.some(message => /already being generated/.test(message)));
  } finally { w.close(); }
});
