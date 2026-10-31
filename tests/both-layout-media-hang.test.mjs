import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './studio-render-harness.mjs';

test('quick batch stalled narration read falls back instead of hanging', async () => {
  const { w } = harness();
  const timeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 30000 ? 5 : ms, ...args);
  w.getAudioContext = () => ({ state: 'running' });
  const row = w.addBatchRow({ script: 'A sentence.' });
  try {
    const result = await w.decodeBatchAudio(row, { arrayBuffer: () => new Promise(() => {}) });
    assert.equal(result, 0);
    assert.equal(row.audio, null);
  } finally { w.close(); }
});
