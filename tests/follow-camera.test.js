import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PREVIEW_COURSES } from '../src/lane/PreviewCourses.js';
import { ArcLengthTable } from '../src/lane/ArcLengthTable.js';
import { ParallelLanes } from '../src/lane/ParallelLanes.js';
import { followFrame, followSpan } from '../src/core/FollowCamera.js';
import { createJudgementEffect } from '../src/notes/NoteRenderer.js';

test('chase camera keeps A on the left and D on the right on every course', () => {
  for (const course of PREVIEW_COURSES) {
    const lanes = new ParallelLanes(new ArcLengthTable(course.points), 4);
    const total = lanes.centerline.getTotalLength();
    for (let d = 0; d <= total; d += total / 60) {
      const { center, forward } = followFrame(lanes, d, 4);
      assert.ok(Math.abs(forward.length() - 1) < 1e-6 && forward.y === 0);
      const right = forward.clone().cross(new THREE.Vector3(0, 1, 0));
      const side = key => lanes.getPositionAtDistance(d, key).sub(center).dot(right);
      assert.ok(side('A') < side('W') && side('W') < side('S') && side('S') < side('D'), `${course.laneId} at ${d.toFixed(1)}`);
    }
  }
});

test('follow view spans about 1.5 seconds of travel within readable limits', () => {
  assert.equal(followSpan(0.4), 2.5);
  assert.ok(Math.abs(followSpan(4) - 6) < 1e-9);
  assert.equal(followSpan(20), 9);
  const lanes = new ParallelLanes(new ArcLengthTable(PREVIEW_COURSES[0].points), 2);
  assert.deepEqual(followFrame(lanes, 10, 4, 'north').forward.toArray(), [0, 0, -1]);
});

test('each judgement has its own effect, and better judgements are bigger and longer', () => {
  const effects = Object.fromEntries(['perfect', 'great', 'good', 'miss'].map(j => [j, createJudgementEffect(j)]));
  const reach = effect => {
    effect.animate(effect.duration * 0.7);
    return new THREE.Box3().setFromObject(effect.group).getSize(new THREE.Vector3()).x;
  };
  assert.ok(effects.perfect.duration > effects.great.duration && effects.great.duration > effects.good.duration);
  assert.ok(effects.perfect.group.children.length > effects.great.group.children.length);
  assert.ok(effects.great.group.children.length > effects.good.group.children.length);
  assert.ok(reach(effects.perfect) > reach(effects.great) && reach(effects.great) > reach(effects.good));
  assert.equal(effects.miss.group.children.length, 2);
  assert.ok(reach(effects.miss) < reach(effects.good) * 1.5);
  for (const effect of Object.values(effects)) {
    effect.animate(effect.duration);
    effect.group.children.forEach(child => assert.ok(!child.visible || child.material.opacity < 0.01));
  }
});

test('camera distance setting scales the follow span and overview skips following', async () => {
  const { Game } = await import('../src/core/Game.js');
  const lanes = new ParallelLanes(new ArcLengthTable(PREVIEW_COURSES[0].points), 4);
  const spans = [];
  const game = { arcLengthTable: lanes.centerline, parallelLanes: lanes, audioDuration: 60, cameraMode: 'chase',
    renderer: { follow: (center, forward, span) => spans.push(span) } };
  for (const distance of [0.5, 1, 2]) {
    game.cameraDistance = distance;
    Game.prototype._updateCamera.call(game, 0.3);
  }
  const base = followSpan(lanes.centerline.getTotalLength() / 60);
  assert.deepEqual(spans.map(s => +(s / base).toFixed(6)), [0.5, 1, 2]);
  game.cameraMode = 'overview';
  Game.prototype._updateCamera.call(game, 0.4);
  assert.equal(spans.length, 3);
});
