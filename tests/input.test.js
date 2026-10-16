import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/Game.js';
import { GamepadInput, keyLabel } from '../src/input/GamepadInput.js';

test('input ignores held-key repeats and form editing, and applies timing offset once', () => {
  const hits = [];
  const game = { isRunning: true, offsetMs: 40, audioManager: { getCurrentTime: () => 2 },
    judgeManager: { processKeyInput: (...args) => hits.push(args) }, chart: {}, _setInputMode() {} };
  const event = { key: 'w', repeat: false, target: { matches: () => false }, preventDefault() {} };
  Game.prototype._onKeyDown.call(game, event);
  Game.prototype._onKeyDown.call(game, { ...event, repeat: true });
  Game.prototype._onKeyDown.call(game, { ...event, target: { matches: () => true } });
  assert.equal(hits.length, 1);
  assert.equal(hits[0][0], 'W');
  assert.equal(hits[0][1], 1.96);
});

test('Xbox face buttons map to the WASD diamond, once per press, with the pad age', () => {
  const presses = [];
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  const pad = { index: 0, connected: true, timestamp: 1000, buttons };
  let now = 1020;
  const input = new GamepadInput((key, age) => presses.push([key, age]), { getPads: () => [pad, null], now: () => now });
  for (const i of [2, 3, 0, 1, 9, 4]) buttons[i].pressed = true;
  input.poll();
  input.poll();
  assert.deepEqual(presses.map(p => p[0]), ['S', 'D', 'A', 'W', 'MENU']);
  assert.ok(presses.every(p => Math.abs(p[1] - 0.02) < 1e-9));
  for (const button of buttons) button.pressed = false;
  input.poll();
  buttons[0].pressed = true; now = 1500;
  input.poll();
  assert.deepEqual(presses.at(-1), ['S', 0.05]);
  assert.deepEqual(['A', 'W', 'S', 'D'].map(key => keyLabel(key, 'pad')), ['X', 'Y', 'A', 'B']);
  assert.deepEqual(['A', 'W', 'S', 'D'].map(key => keyLabel(key)), ['A', 'W', 'S', 'D']);
});

test('pad presses judge earlier by their age and Menu toggles play', () => {
  const hits = [], calls = [];
  const game = { isLoaded: true, isRunning: true, offsetMs: 40, audioManager: { getCurrentTime: () => 2 },
    judgeManager: { processKeyInput: (...args) => hits.push(args) }, chart: {},
    _setInputMode: mode => calls.push(mode), stop: () => calls.push('stop'), start: () => calls.push('start') };
  Game.prototype._onPadPress.call(game, 'D', 0.01);
  assert.equal(hits[0][0], 'D');
  assert.ok(Math.abs(hits[0][1] - 1.95) < 1e-9);
  Game.prototype._onPadPress.call(game, 'MENU', 0);
  game.isRunning = false;
  Game.prototype._onPadPress.call(game, 'MENU', 0);
  Game.prototype._onPadPress.call(game, 'W', 0);
  assert.equal(hits.length, 1);
  assert.deepEqual(calls, ['pad', 'pad', 'stop', 'pad', 'start', 'pad']);
});
