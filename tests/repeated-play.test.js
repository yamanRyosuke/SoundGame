import test from 'node:test';
import assert from 'node:assert/strict';
import { Chart } from '../src/chart/Chart.js';
import { RepeatedPlay, repeatCount } from '../src/chart/RepeatedPlay.js';

const song = () => new Chart({ audio: { duration: 10 }, laneId: 'x', notes: [1, 4.5, 9.5].map(t => ({ t, key: 'A', type: 'tap' })) });

test('repeat setting values', () => {
  assert.deepEqual(['1', '2', '3', 'endless', 'bogus'].map(repeatCount), [1, 2, 3, Infinity, 1]);
});

test('the same chart plays again each repetition, shifted by the song length', () => {
  const chart = song(), play = new RepeatedPlay(chart, 10, 3);
  assert.equal(play.length, 30);
  assert.deepEqual(play.chart.notes.map(n => n.t), [1, 4.5, 9.5, 11, 14.5, 19.5]);
  play.chart.notes[0].judged = true;
  assert.equal(chart.notes[0].judged, false, 'the saved chart keeps its own state');
  const { added } = play.advance(12);
  assert.deepEqual(added.map(n => n.t), [21, 24.5, 29.5]);
  assert.deepEqual(play.advance(29).added, [], 'no fourth repetition');
  assert.equal(play.cycleAt(35), 2);
  // A single play is exactly the original chart's timing.
  assert.deepEqual(new RepeatedPlay(chart, 10, 1).chart.notes.map(n => n.t), [1, 4.5, 9.5]);
});

test('endless play keeps going and only holds the nearby repetitions', () => {
  const play = new RepeatedPlay(song(), 10, Infinity);
  assert.equal(play.length, Infinity);
  let removedTotal = 0;
  for (let time = 0; time <= 1000; time += 0.5) {
    const { removed } = play.advance(time);
    removed.forEach(n => assert.ok(n.t < time - 9, 'only notes from a whole song ago are dropped'));
    removedTotal += removed.length;
    assert.ok(play.chart.notes.length <= 9);
    assert.ok(play.chart.notes.some(n => n.t > time), 'next notes are always ready');
  }
  assert.ok(removedTotal > 250);
  const times = play.chart.notes.map(n => n.t);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(play.chart.getNoteForKey('A', 1001, 120).t, 1001);
});
