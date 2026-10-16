import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { PREVIEW_COURSES } from '../src/lane/PreviewCourses.js';
import { ArcLengthTable } from '../src/lane/ArcLengthTable.js';
import { ParallelLanes } from '../src/lane/ParallelLanes.js';
import { GameRenderer } from '../src/core/GameRenderer.js';
import { Chart } from '../src/chart/Chart.js';
import { serializeStage, parseStage } from '../src/chart/StageFile.js';

test('five long courses have finite, continuous lanes without inverted inner bends', () => {
  assert.equal(PREVIEW_COURSES.length, 5);
  assert.equal(new Set(PREVIEW_COURSES.map(c => c.laneId)).size, 5);
  for (const course of PREVIEW_COURSES) {
    const center = new ArcLengthTable(course.points);
    assert.ok(center.totalLength > 50, course.name);
    for (let count = 1; count <= 4; count++) {
      const layout = new ParallelLanes(center, count);
      for (const lane of layout.lanes) {
        const points = layout.getLanePoints(lane.key);
        for (let i = 1; i < points.length; i++) {
          const delta = points[i].clone().sub(points[i - 1]);
          assert.ok(delta.toArray().every(Number.isFinite));
          assert.ok(delta.length() < 0.5, `${course.name}: discontinuity`);
          assert.ok(delta.dot(center.points[i].clone().sub(center.points[i - 1])) > 0, `${course.name}: inverted bend`);
        }
      }
      layout.speed = center.totalLength / 100;
      for (let i = 0; i <= 100; i++) {
        const frame = layout.getFrameAtDistance(center.totalLength * i / 100);
        for (const key of ['A', 'W', 'S', 'D']) {
          const expected = frame.center.clone().addScaledVector(frame.lateral, layout.laneForKey(key).offset);
          assert.ok(layout.getPositionAtTime(i, key).distanceTo(expected) < 1e-8);
        }
      }
    }
  }
});

test('figure eight crosses at separate heights', () => {
  const course = PREVIEW_COURSES.find(c => c.laneId === 'preview_eight_v1');
  const a = course.points[0], b = course.points[480];
  assert.ok(Math.abs(a[0] - b[0]) < 1e-8 && Math.abs(a[2] - b[2]) < 1e-8);
  assert.equal(Math.abs(a[1] - b[1]), 3);
});

test('camera fits all five courses and parallel-lane margins at several aspect ratios', () => {
  for (const aspect of [0.6, 1, 2.3, 4]) for (const course of PREVIEW_COURSES) {
    const renderer = Object.create(GameRenderer.prototype);
    renderer.camera = new PerspectiveCamera(60, aspect, 0.1, 1000);
    renderer.target = new Vector3();
    renderer.fitCourse(course.points);
    renderer.camera.updateMatrixWorld(true);
    const bounds = renderer.courseBounds;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const p = new Vector3(x, y, z).project(renderer.camera);
      assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && Math.abs(p.z) <= 1, course.name);
    }
  }
});

test('stage files restore another known course, keep legacy circle and reject unknown geometry', () => {
  const audio = { hash: 'test-song', duration: 10 };
  const supported = ['lane_circle', ...PREVIEW_COURSES.map(c => c.laneId)];
  for (const laneId of supported) {
    const chart = new Chart({ audio, laneId, notes: [{ t: 1, type: 'tap', key: 'D' }] });
    const saved = parseStage(serializeStage(chart, 20, 2), audio, 'lane_circle', supported);
    assert.equal(saved.chart.laneId, laneId);
    assert.equal(saved.laneCount, 2);
    assert.equal(saved.chart.notes[0].t, 1);
    assert.equal(saved.chart.notes[0].key, 'D');
  }
  const unknown = new Chart({ audio, laneId: 'unknown', notes: [] });
  assert.throws(() => parseStage(serializeStage(unknown), audio, 'lane_circle', supported));
});

test('loop courses keep lapping at a constant speed until the song ends; one-way courses are not offered', async () => {
  const { PLAYABLE_COURSES } = await import('../src/lane/PreviewCourses.js');
  const { DEFAULT_SPEED } = await import('../src/lane/ParallelLanes.js');
  assert.deepEqual(PLAYABLE_COURSES.map(c => c.name), ['ワインディング', 'クローバー', '立体8の字']);
  for (const course of PLAYABLE_COURSES) {
    const layout = new ParallelLanes(new ArcLengthTable(course.points), 4);
    assert.ok(layout.closed, course.name);
    assert.equal(layout.speed, DEFAULT_SPEED);
    const lap = layout.getLapTime(), total = layout.centerline.getTotalLength();
    // Same place one lap later, and still moving at 3 minutes.
    for (const t of [1, 7.3, 20]) assert.ok(layout.getPositionAtTime(t, 'A').distanceTo(layout.getPositionAtTime(t + lap, 'A')) < 1e-6);
    assert.ok(Math.abs(layout.getDistanceAtTime(180) - (180 * DEFAULT_SPEED) % total) < 1e-9);
    assert.ok(layout.getPositionAtTime(180, 'S').distanceTo(layout.getPositionAtTime(180.5, 'S')) > 1);
  }
  const oneWay = new ParallelLanes(new ArcLengthTable(PREVIEW_COURSES.find(c => c.oneWay).points), 4);
  assert.equal(oneWay.getDistanceAtTime(1e6), oneWay.centerline.getTotalLength());
});

test('a short loop never shows the next lap of notes on top of the current ones', async () => {
  const { NoteRenderer } = await import('../src/notes/NoteRenderer.js');
  globalThis.document ??= { createElement: () => ({ getContext: () => ({ clearRect() {}, fillText() {} }) }) };
  const circle = Array.from({ length: 65 }, (_, i) => [2 * Math.cos(i / 64 * Math.PI * 2), 0, 2 * Math.sin(i / 64 * Math.PI * 2)]);
  const layout = new ParallelLanes(new ArcLengthTable(circle), 4);
  const lap = layout.getLapTime();
  assert.ok(lap < 4);
  const renderer = new NoteRenderer(layout);
  const notes = [{ t: 1, key: 'A' }, { t: 1 + lap, key: 'A' }].map(n => ({ ...n, type: 'tap', judged: false }));
  const chart = { notes };
  renderer.createNotes(chart);
  renderer.update(chart, 0.9);
  assert.deepEqual(notes.map(n => renderer.noteMeshes.get(n).mesh.visible), [true, false]);
});
