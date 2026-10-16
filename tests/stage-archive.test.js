import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../src/audio/AudioManager.js';
import { Chart } from '../src/chart/Chart.js';
import { serializeStage } from '../src/chart/StageFile.js';
import { createStageArchive, readStageArchive, prepareSavedStage } from '../src/chart/StageArchive.js';
import { Game } from '../src/core/Game.js';

globalThis.window = {
  OfflineAudioContext: class {
    async decodeAudioData(bytes) {
      if (!bytes.byteLength || new Uint8Array(bytes)[0] === 0) throw new Error('Invalid audio');
      structuredClone(bytes, { transfer: [bytes] }); // Real Web Audio can detach the input.
      return { duration: 4 };
    }
  }
};

async function fixture() {
  const audio = new AudioManager();
  await audio._decode(new Uint8Array([1, 2, 3, 4]).buffer, '曲.wav');
  const chart = new Chart({ audio: audio.meta, laneId: 'preview_spiral_v1',
    generation: { difficulty: 'hard', focus: 'melody' },
    notes: [{ t: 1, type: 'tap', key: 'A' }, { t: 1.05, type: 'tap', key: 'W' }, { t: 1.1, type: 'tap', key: 'D' }] });
  return { audio, record: { name: '音楽入りのステージ', audioName: '曲.wav', audioBlob: audio.originalFile,
    stageText: serializeStage(chart, -35, 2), options: { preset: 'loose', provider: 'musical', difficulty: 'hard', focus: 'melody' } } };
}

test('encoded audio survives a detached decode buffer and a later failed import', async () => {
  const { audio } = await fixture();
  assert.deepEqual([...new Uint8Array(await audio.originalFile.arrayBuffer())], [1, 2, 3, 4]);
  const original = audio.originalFile;
  await assert.rejects(audio._decode(new Uint8Array([0]).buffer, 'broken.wav'));
  assert.equal(audio.originalFile, original);
  assert.equal(audio.meta.name, '曲.wav');
});

test('portable stage restores exact music, notes, course, lanes, offset and settings without regeneration', async () => {
  const { record } = await fixture();
  const archive = createStageArchive(record);
  const restored = await readStageArchive(archive);
  assert.equal(restored.name, record.name);
  assert.equal(restored.stageText, record.stageText);
  assert.deepEqual(await restored.audioBlob.arrayBuffer(), await record.audioBlob.arrayBuffer());
  const ready = await prepareSavedStage(restored, ['lane_circle', 'preview_spiral_v1']);
  assert.equal(ready.audioManager.meta.name, '曲.wav');
  assert.equal(ready.chart.laneId, 'preview_spiral_v1');
  assert.equal(ready.offsetMs, -35);
  assert.equal(ready.laneCount, 2);
  assert.equal(ready.options.preset, 'loose');
  assert.equal(ready.options.difficulty, 'hard');
  assert.equal(ready.options.focus, 'melody');
  assert.deepEqual(ready.chart.notes.map(n => [n.t, n.key, n.judged]), [[1, 'A', false], [1.05, 'W', false], [1.1, 'D', false]]);
});

test('malformed archives, truncated manifests, unsupported courses and swapped audio are rejected', async () => {
  const { record } = await fixture();
  const archive = createStageArchive(record);
  await assert.rejects(readStageArchive(new Blob(['not a soundstage file'])));
  await assert.rejects(readStageArchive(archive.slice(0, 10)));
  await assert.rejects(readStageArchive(archive.slice(0, 20)));
  await assert.rejects(prepareSavedStage(record, ['lane_circle']));
  await assert.rejects(prepareSavedStage({ ...record, audioBlob: new Blob([new Uint8Array([5, 6])]) }, ['preview_spiral_v1']));
  assert.throws(() => createStageArchive({ ...record, name: '' }));
  assert.throws(() => createStageArchive({ ...record, audioBlob: new Blob([]) }));
});

test('failed saved-stage load preserves the already-open game and song', async () => {
  const { record, audio } = await fixture();
  const currentChart = { notes: [{ t: 2, key: 'S' }] };
  const game = { audioManager: audio, chart: currentChart, originalLane: { laneId: 'lane_circle' },
    _setCourse() { assert.fail('must validate before touching the current game'); } };
  await assert.rejects(Game.prototype._restoreSaved.call(game, { ...record, audioBlob: new Blob([new Uint8Array([0])]) }));
  assert.equal(game.audioManager, audio);
  assert.equal(game.chart, currentChart);
  assert.ok(audio.audioBuffer);
});
