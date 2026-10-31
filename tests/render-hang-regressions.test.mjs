import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { CONFIG_PAGE_SCRIPT } from '../src/client/config-page-js.ts';
import { harness } from './studio-render-harness.mjs';

const pending = () => new Promise(() => {});
function accelerate(w, times) {
  const original = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms, ...args) => original(fn, times.includes(ms) ? 5 : ms, ...args);
}

test('stalled font loading falls back and unrelated document fonts do not block export', async () => {
  const { w, warnings } = harness();
  accelerate(w, [8000]);
  w.document.getElementById('title-input').value = 'Title';
  Object.defineProperty(w.document, 'fonts', { configurable: true, value: { load: pending, ready: pending() } });
  try {
    await w.loadTitleFont();
    await w.loadCaptionFont();
    assert.ok(warnings.some(x => /Title font loading timed out/.test(x)));
    assert.ok(warnings.some(x => /Caption font loading timed out/.test(x)));
    Object.defineProperty(w.document, 'fonts', { configurable: true, value: { load: () => Promise.resolve([]), ready: pending() } });
    await Promise.race([w.loadTitleFont(), new Promise((_, reject) => setTimeout(() => reject(new Error('waiting for unrelated fonts')), 100))]);
  } finally { w.close(); }
});

test('unreadable GIF does not block later projects or leave the render lock held', async () => {
  const { w } = harness();
  accelerate(w, [30000]);
  w.addVideoAccordion();
  w.addVideoAccordion();
  const first = w.__VIDEO_PROJECTS[0], second = w.__VIDEO_PROJECTS[1];
  first.assets.push({ kind: 'gif', file: { arrayBuffer: pending }, url: 'blob:gif' });
  const clip = w.document.createElement('video');
  second.assets.push({ kind: 'mp4', file: new w.File(['x'], 'clip.mp4', { type: 'video/mp4' }), videoEl: clip, duration: 2, url: 'blob:clip' });
  try {
    await w.runGenerationQueue();
    assert.equal(first.status, 'error');
    assert.equal(second.status, 'done');
    assert.equal(w.document.getElementById('render-btn').disabled, false);
    assert.match(w.document.getElementById('status-text').textContent, /1 saved, 0 skipped, 1 failed/);
  } finally { w.close(); }
});

test('stalled audio file reads fail rather than holding the local renderer', async () => {
  const { w } = harness();
  accelerate(w, [30000]);
  w.addVideoAccordion();
  const project = w.__VIDEO_PROJECTS[0];
  project.audioFile = { name: 'audio.mp3', arrayBuffer: pending };
  try {
    await assert.rejects(w.prepareVideo(1), /Reading the audio file timed out/);
  } finally { w.close(); }
});

test('timed-out worker render cannot deliver a late result', async () => {
  const { w } = harness();
  const originalGenerate = w.generateMP4;
  const oldFetch = w.fetch;
  let delivered = false;
  w.generateMP4 = async () => { w.__lastRenderBlob = new w.Blob(['video'], { type: 'video/mp4' }); return 'done'; };
  w.fetch = (url, init) => { if (String(url).startsWith('/api/worker/deliver')) delivered = true; return oldFetch(url, init); };
  try {
    await assert.rejects(w.workerRunJob({ id: 'late', project: {}, assets: [], _workerTimedOut: true }), /timed out/);
    assert.equal(delivered, false);
    assert.equal(w.__workerMode, false);
  } finally { w.generateMP4 = originalGenerate; w.close(); }
});

test('worker timeout stops new claims until the old render actually settles', async () => {
  const dom = new JSDOM('<button id="cfg-worker-toggle"></button><div id="cfg-worker-log"></div><div id="cfg-worker-dot"></div><div id="cfg-worker-state"></div>', { runScripts: 'outside-only', url: 'https://studio.test' });
  const w = dom.window;
  accelerate(w, [15 * 60 * 1000, 3000]);
  let finish, claimedJob;
  w.workerRunJob = job => { claimedJob = job; return new Promise(resolve => { finish = resolve; }); };
  let claims = 0, failed = 0;
  w.fetch = async url => {
    if (url === '/api/worker/poll') { claims++; return { ok: true, json: async () => ({ job: { id: 'one' } }) }; }
    if (url.startsWith('/api/worker/failed')) { failed++; return { ok: true }; }
    throw new Error('unexpected request');
  };
  const start = CONFIG_PAGE_SCRIPT.indexOf('\tvar workerActive = false;');
  const end = CONFIG_PAGE_SCRIPT.indexOf('\n\tdocument.getElementById("cfg-worker-toggle").addEventListener', start);
  assert.ok(start > 0 && end > start);
  w.eval(CONFIG_PAGE_SCRIPT.slice(start, end) + '\nwindow.__workerTest = { start: function() { setWorkerActive(true); }, busy: function() { return workerBusy; } };');
  try {
    w.__workerTest.start();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(claims, 1);
    assert.equal(failed, 1);
    assert.equal(claimedJob._workerTimedOut, true);
    assert.equal(w.__workerTest.busy(), true);
    w.__workerTest.start();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(claims, 1);
    finish();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(w.__workerTest.busy(), false);
  } finally { w.close(); }
});
