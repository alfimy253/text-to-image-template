import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './studio-render-harness.mjs';

const script = 'Morning yoga opens the shoulders. Long tails follow the breath.';
function setup() {
  const h = harness(), w = h.w;
  w.HTMLAnchorElement.prototype.click = function () {};
  w.addVideoAccordion();
  const project = w.__VIDEO_PROJECTS[0];
  project.script = script;
  project.scriptDurationMs = 60000;
  w.openVoiceoverModal(1);
  w.requestEditorVoiceover = async () => ({ ok: true, blob: async () => new w.Blob(['voice'], { type: 'audio/mpeg' }) });
  w.measureBlobMs = async () => 12000;
  return { ...h, project };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('editor voiceover attaches only when no audio exists and uses quick-batch cue timings', async () => {
  const { w, project } = setup();
  try {
    await w.generateVoiceover(1);
    assert.ok(project.audioFile instanceof w.File);
    assert.equal(project.audioFile.type, 'audio/mpeg');
    assert.deepEqual(plain(project.subtitles), plain(w.buildScriptCues(script, 12000)));
    assert.match(w.document.getElementById('voiceover-subtitles-1').textContent, /Subtitles ON/);
    w.toggleSubtitles(1);
    assert.equal(project.subtitles, null);
    w.toggleSubtitles(1);
    assert.deepEqual(plain(project.subtitles), plain(w.buildScriptCues(script, 12000)));
  } finally { w.close(); }
});

test('editor keeps uploaded audio and an explicit subtitles-off choice', async () => {
  const { w, project } = setup();
  const existing = new w.File(['old'], 'existing.mp3', { type: 'audio/mpeg' });
  project.audioFile = existing;
  project.audio = { duration: 9 };
  project.subtitles = w.buildScriptCues(script, 9000);
  w.toggleSubtitles(1);
  try {
    await w.generateVoiceover(1);
    assert.equal(project.audioFile, existing);
    assert.equal(project.subtitles, null);
    assert.match(w.document.getElementById('voiceover-status-1').textContent, /existing audio was kept/);
  } finally { w.close(); }
});

test('empty voiceover does not attach audio or enable subtitles', async () => {
  const { w, project } = setup();
  w.requestEditorVoiceover = async () => ({ ok: true, blob: async () => new w.Blob([], { type: 'audio/mpeg' }) });
  try {
    await w.generateVoiceover(1);
    assert.equal(project.audioFile, null);
    assert.ok(!project.subtitles || !project.subtitles.length);
    assert.match(w.document.getElementById('voiceover-status-1').textContent, /returned no audio/);
  } finally { w.close(); }
});

test('audio selected while voiceover measurement is pending is not overwritten', async () => {
  const { w, project } = setup();
  let release;
  w.measureBlobMs = () => new Promise(resolve => { release = resolve; });
  const generating = w.generateVoiceover(1);
  try {
    while (!release) await new Promise(resolve => setTimeout(resolve, 0));
    const selected = new w.File(['user'], 'user.mp3', { type: 'audio/mpeg' });
    w.onVideoAudio(1, { target: { files: [selected], value: 'selected' } });
    release(12000);
    await generating;
    assert.equal(project.audioFile, selected);
    assert.equal(project._voiceoverDurationMs, 0);
  } finally { w.close(); }
});

test('editor retimes enabled subtitles to the actually selected audio before render', async () => {
  const { w, project } = setup();
  const file = { name: 'selected.mp3', arrayBuffer: async () => new ArrayBuffer(1) };
  project.audioFile = file;
  project.subtitles = w.buildScriptCues(script, 60000);
  w.getAudioContext = () => ({ decodeAudioData: async () => ({ duration: 8 }) });
  try {
    await w.prepareVideo(1);
    assert.deepEqual(plain(project.subtitles), plain(w.buildScriptCues(script, 8000)));
    project.subtitles = null;
    await w.prepareVideo(1);
    assert.equal(project.subtitles, null);
  } finally { w.close(); }
});

test('shared subtitle painter draws wrapped lines separately in both layouts', () => {
  const { w } = setup();
  const textCalls = [], boxes = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, fill() {},
    measureText: text => ({ width: text.length * 10 }),
    rect: (...args) => boxes.push(args), fillText: (...args) => textCalls.push(args) };
  try {
    w.drawSubtitles(ctx, [{ startMs: 0, endMs: 1000, text: 'First line\nSecond line' }], 500, 320, 180);
    assert.deepEqual(textCalls.map(x => x[0]), ['First line', 'Second line']);
    assert.ok(textCalls[0][2] < textCalls[1][2]);
    assert.ok(boxes[0][2] <= 320);
    w.drawSubtitles(ctx, [{ startMs: 0, endMs: 1000, text: 'Short' }], 500, 320, 180);
    assert.equal(textCalls[2][0], 'Short');
    assert.equal(textCalls[2][2], 120);
  } finally { w.close(); }
});

test('quick batch and editor exports both pass their cues to the shared renderer', async () => {
  const { w, project } = setup();
  const cues = w.buildScriptCues(script, 2000);
  const clip = w.document.createElement('video');
  const file = new w.File(['x'], 'clip.mp4', { type: 'video/mp4' });
  project.assets.push({ kind: 'mp4', file, videoEl: clip, duration: 2, url: 'blob:clip' });
  project.subtitles = cues;
  const draw = w.drawSubtitles;
  let received = [];
  w.drawSubtitles = function (ctx, subs, ...args) { if (subs.length) received.push(plain(subs)); return draw(ctx, subs, ...args); };
  try {
    await w.runGenerationQueue();
    assert.equal(project.status, 'done');
    assert.deepEqual(received[0], plain(cues));
    received = [];
    const rowClip = w.document.createElement('video');
    const row = w.addBatchRow({ script, mp3: new w.Blob(['voice']), images: [{}], animated: true, subtitles: cues, slides: [{ id: 'slide', type: 'mp4', videoEl: rowClip, img: rowClip, duration: 2 }] });
    await w.exportBatchRow(row.id);
    assert.equal(row.stage, 'done');
    assert.deepEqual(received[0], plain(cues));
  } finally { w.close(); }
});
