import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/core/Game.js';

test('input ignores held-key repeats and form editing, and applies timing offset once', () => {
  const hits = [];
  const game = { isRunning: true, offsetMs: 40, audioManager: { getCurrentTime: () => 2 },
    judgeManager: { processKeyInput: (...args) => hits.push(args) }, chart: {} };
  const event = { key: 'w', repeat: false, target: { matches: () => false }, preventDefault() {} };
  Game.prototype._onKeyDown.call(game, event);
  Game.prototype._onKeyDown.call(game, { ...event, repeat: true });
  Game.prototype._onKeyDown.call(game, { ...event, target: { matches: () => true } });
  assert.equal(hits.length, 1);
  assert.equal(hits[0][0], 'W');
  assert.equal(hits[0][1], 1.96);
});
