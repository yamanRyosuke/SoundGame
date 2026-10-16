import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudio, composeNotes, DIFFICULTIES } from '../src/chart/AudioAnalysis.js';
import { Chart } from '../src/chart/Chart.js';
import { parseStage, serializeStage } from '../src/chart/StageFile.js';

const rate = 22050;
function signal(duration, events) {
  const samples = new Float32Array(duration * rate);
  for (const [time, hz, amplitude = 0.7] of events) {
    for (let j = 0; j < rate * 0.16; j++) {
      const i = Math.round(time * rate) + j;
      if (i >= samples.length) break;
      const t = j / rate;
      samples[i] += Math.sin(2 * Math.PI * hz * t) * Math.min(1, t / 0.004) * Math.exp(-t * 25) * amplitude;
    }
  }
  return samples;
}

test('syncopated attacks are located within 45ms; silence stays empty', () => {
  const times = [0.8, 1.3, 1.55, 2.2, 4.5, 5.15, 5.4];
  const audio = signal(7, times.map((t, i) => [t, [110, 440, 880][i % 3]]));
  const analysis = analyzeAudio([audio], rate);
  for (const t of times) assert.ok(analysis.events.some(e => Math.abs(e.t - t) < 0.045), `missing attack ${t}: ${analysis.events.map(e => e.t)}`);
  assert.ok(!analysis.events.some(e => e.t > 2.4 && e.t < 4.4));
  const notes = composeNotes(analysis, { difficulty: 'hard' });
  assert.ok(notes.length >= 5);
  for (const n of notes) assert.ok(times.some(t => Math.abs(n.t - t) < 0.045));
  assert.deepEqual(analyzeAudio([new Float32Array(rate * 2)], rate).events, []);
});

test('spectral changes detect changing pitches even at constant loudness', () => {
  const samples = new Float32Array(rate * 4);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.4 * Math.sin(2 * Math.PI * [220, 440, 880, 660][Math.floor(i / rate)] * i / rate);
  const result = analyzeAudio([samples], rate);
  for (const t of [1, 2, 3]) assert.ok(result.events.some(e => Math.abs(e.t - t) < 0.06), `pitch change ${t}`);
  const pitches = result.events.filter(e => e.t > 0.9).map(e => Math.round(e.pitch));
  assert.ok(new Set(pitches).size >= 3);
});

test('stereo phase inversion does not cancel the song', () => {
  const audio = signal(3, [[1, 440], [2, 880]]);
  const mono = analyzeAudio([audio], rate);
  assert.deepEqual(analyzeAudio([audio, audio.map(v => -v)], rate), mono);
});

test('difficulty limits density, preserves determinism and avoids rapid same-key repeats', () => {
  const analysis = { duration: 14, events: Array.from({ length: 100 }, (_, i) => ({
    t: 0.8 + i * 0.12, strength: i % 4 === 0 ? 2 : 0.8, energy: 0.8,
    bands: i % 3 === 0 ? [3, 0.1, 0.2] : [0.1, 2, 0.2], pitch: 60 + i % 8
  })) };
  const counts = [];
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const notes = composeNotes(analysis, { difficulty });
    assert.deepEqual(notes, composeNotes(analysis, { difficulty }));
    counts.push(notes.length);
    const rule = DIFFICULTIES[difficulty];
    for (let i = 1; i < notes.length; i++) {
      const delta = notes[i].t - notes[i - 1].t;
      assert.ok(delta + 0.0001 >= rule.gap);
      if (notes[i].key === notes[i - 1].key) assert.ok(delta + 0.0001 >= rule.sameKeyGap);
      assert.ok(notes.filter(n => n.t >= notes[i].t && n.t < notes[i].t + 0.9999).length <= rule.maxPerSecond);
    }
  }
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2], counts.toString());
  assert.notDeepEqual(composeNotes(analysis, { focus: 'rhythm' }), composeNotes(analysis, { focus: 'melody' }));
});

test('stage round trip resets judgements and rejects mismatched audio and malformed notes', () => {
  const audio = { duration: 5, hash: 'original-song', name: 'song.wav' };
  const chart = new Chart({ audio, laneId: 'circle', notes: [{ t: 1, key: 'A', type: 'tap' }], generation: { difficulty: 'normal' } });
  chart.notes[0].judged = true;
  const text = serializeStage(chart, 35);
  const saved = parseStage(text, audio, 'circle');
  assert.equal(saved.chart.notes[0].judged, false);
  assert.equal(saved.offsetMs, 35);
  assert.throws(() => parseStage(text, { ...audio, hash: 'different-song' }, 'circle'));
  for (const change of [d => d.notes[0].t = -1, d => d.notes[0].key = 'X', d => d.notes[0].type = 'hold', d => d.notes.push({ ...d.notes[0] }), d => d.offsetMs = 1000]) {
    const data = JSON.parse(text); change(data);
    assert.throws(() => parseStage(JSON.stringify(data), audio, 'circle'));
  }
});

test('stage files preserve lane count and original keys; legacy stages default to four', () => {
  const audio = { duration: 5, hash: 'original-song' };
  const notes = ['A', 'W', 'S', 'D'].map((key, i) => ({ t: i + 0.5, key, type: 'tap' }));
  const chart = new Chart({ audio, laneId: 'circle', notes });
  for (const count of [1, 2, 3, 4]) {
    const saved = parseStage(serializeStage(chart, 10, count), audio, 'circle');
    assert.equal(saved.laneCount, count);
    assert.deepEqual(saved.chart.notes.map(n => n.key), ['A', 'W', 'S', 'D']);
    assert.deepEqual(saved.chart.notes.map(n => n.t), [0.5, 1.5, 2.5, 3.5]);
  }
  const data = JSON.parse(serializeStage(chart));
  delete data.laneCount;
  assert.equal(parseStage(JSON.stringify(data), audio, 'circle').laneCount, 4);
  for (const laneCount of [0, 5, 2.5, '3', null]) {
    assert.throws(() => parseStage(JSON.stringify({ ...data, laneCount }), audio, 'circle'));
    assert.throws(() => serializeStage(chart, 0, laneCount));
  }
});

function drumLoop(duration) {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const samples = new Float32Array(duration * rate);
  // A sustained chord under the drums, like a real mix.
  for (let i = 0; i < samples.length; i++) samples[i] = 0.08 * [262, 330, 392].reduce((sum, hz) => sum + Math.sin(2 * Math.PI * hz * i / rate), 0);
  const hits = [];
  const sounds = {
    kick: t => Math.sin(2 * Math.PI * (50 * t + 70 / 30 * (1 - Math.exp(-30 * t)))) * Math.exp(-t * 18),
    snare: t => (0.7 * (random() * 2 - 1) + 0.5 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 22),
    hat: (() => { let last = 0; return t => { const n = random() * 2 - 1, v = n - last; last = n; return 0.6 * v * Math.exp(-t * 60); }; })()
  };
  const pattern = ['kick', 'hat', 'snare', 'hat', 'kick', 'kick', 'snare', 'hat'];
  for (let beat = 0, t = 0.6; t < duration - 0.5; beat++, t += 0.25) {
    if ((beat * 5) % 7 === 3) continue;
    const kind = pattern[beat % pattern.length];
    hits.push({ t, kind });
    const amplitude = 0.5 + 0.4 * random();
    for (let j = 0; j < rate * 0.2; j++) {
      const i = Math.round(t * rate) + j;
      if (i < samples.length) samples[i] += amplitude * Math.min(1, j / 40) * sounds[kind](j / rate);
    }
  }
  return { samples, hits };
}

test('timbre mode gives each drum sound its own consistent key', () => {
  const { samples, hits } = drumLoop(16);
  const analysis = analyzeAudio([samples], rate);
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const notes = composeNotes(analysis, { difficulty, focus: 'timbre' });
    assert.deepEqual(notes, composeNotes(analysis, { difficulty, focus: 'timbre' }));
    assert.ok(notes.length >= 10, `${difficulty}: ${notes.length}`);
    const keysBySound = {};
    for (const note of notes) {
      const hit = hits.find(h => Math.abs(h.t - note.t) < 0.045);
      assert.ok(hit, `note ${note.t} is not on a drum hit`);
      (keysBySound[hit.kind] ??= []).push(note.key);
    }
    const main = {};
    for (const [kind, keys] of Object.entries(keysBySound)) {
      main[kind] = keys.sort((a, b) => keys.filter(k => k === b).length - keys.filter(k => k === a).length)[0];
      assert.ok(keys.filter(k => k === main[kind]).length / keys.length >= 0.9, `${difficulty} ${kind}: ${keys}`);
    }
    assert.equal(new Set(Object.values(main)).size, Object.keys(main).length, `${difficulty}: ${JSON.stringify(main)}`);
    const rule = DIFFICULTIES[difficulty];
    for (let i = 1; i < notes.length; i++) {
      const delta = notes[i].t - notes[i - 1].t;
      assert.ok(delta + 0.0001 >= rule.gap);
      if (notes[i].key === notes[i - 1].key) assert.ok(delta + 0.0001 >= rule.sameKeyGap);
    }
  }
});
