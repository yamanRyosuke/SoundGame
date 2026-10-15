import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArcLengthTable } from '../src/lane/ArcLengthTable.js';
import { ParallelLanes } from '../src/lane/ParallelLanes.js';
import { LANES, LANE_SPACING } from '../src/lane/LaneLayout.js';
import { LaneRenderer } from '../src/lane/LaneRenderer.js';
import { NoteRenderer } from '../src/notes/NoteRenderer.js';
import { PlayerCursor } from '../src/player/PlayerCursor.js';
import { readFileSync } from 'node:fs';

// Rendering geometry is testable without a browser/GPU; only label painting is stubbed.
globalThis.document = { createElement: () => ({ getContext: () => ({ clearRect() {}, fillText() {} }) }) };
const close = (a, b, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const layoutFor = points => new ParallelLanes(new ArcLengthTable(points));

test('four key lanes are equally spaced and assigned consistently on a straight', () => {
  const layout = layoutFor([[0, 0, 0], [0, 0, 10]]);
  assert.deepEqual(LANES.map(lane => lane.key), ['A', 'W', 'S', 'D']);
  for (const time of [0, 1, 3.1, 10]) {
    const positions = LANES.map(lane => layout.getPositionAtTime(time, 10, lane.key));
    positions.forEach(position => close(position.z, time));
    for (let i = 1; i < 4; i++) close(positions[i].distanceTo(positions[i - 1]), LANE_SPACING);
  }
});

test('circle lanes retain the same angular progress and meet at the closed seam', () => {
  const points = JSON.parse(readFileSync(new URL('../public/assets/lanes/lane_circle.json', import.meta.url))).points;
  const layout = layoutFor(points), total = layout.centerline.getTotalLength();
  for (let i = 0; i <= 100; i++) {
    const d = i / 100 * total;
    const center = layout.centerline.getPositionAtDistance(d);
    for (const lane of LANES) {
      const position = layout.getPositionAtDistance(d, lane.key);
      // Cross product = 0: no lane leads the others around the bend.
      close(center.x * position.z - center.z * position.x, 0, 0.001);
    }
  }
  for (const lane of LANES) close(layout.getPositionAtDistance(0, lane.key).distanceTo(layout.getPositionAtDistance(total, lane.key)), 0);
  const start = LANES.map(lane => layout.getPositionAtDistance(0, lane.key).length());
  assert.ok(start.every((radius, i) => i === 0 || radius > start[i - 1]));
});

test('asymmetric bends use shared time even when lane distances differ', () => {
  const layout = layoutFor([[0, 0, 0], [0, 0, 4], [2, 0, 6], [5, 0, 6], [7, 0, 8], [9, 0, 8]]);
  const total = layout.centerline.getTotalLength();
  const lengths = LANES.map(lane => new ArcLengthTable(layout.getLanePoints(lane.key).map(p => p.toArray())).getTotalLength());
  assert.ok(Math.max(...lengths) - Math.min(...lengths) > 1);
  for (let i = 0; i <= 100; i++) {
    const distance = total * i / 100;
    const frame = layout.getFrameAtDistance(distance);
    for (const lane of LANES) {
      const p = layout.getPositionAtTime(i, 100, lane.key);
      const expected = frame.center.clone().addScaledVector(frame.lateral, lane.offset);
      close(p.distanceTo(expected), 0);
    }
  }
});

test('lane ribbons, note, judgement effect and moving bar coincide at every note time', () => {
  const layout = layoutFor([[0, 1, 0], [0, 1, 4], [3, 2, 6], [5, 2, 3]]);
  const lines = new LaneRenderer(layout);
  const renderer = new NoteRenderer(layout, 20);
  const cursor = new PlayerCursor();
  for (const t of [0, 1.7, 8, 12.3, 20]) {
    cursor.setFrame(layout.getFrameAtDistance(layout.centerline.getDistanceAtTime(t, 20)));
    cursor.group.updateMatrixWorld(true);
    const chart = { notes: LANES.map(lane => ({ t, type: 'tap', key: lane.key, judged: false })) };
    renderer.createNotes(chart);
    assert.equal(renderer.noteMeshes.size, 4);
    LANES.forEach((lane, i) => {
      const note = chart.notes[i];
      const p = renderer.noteMeshes.get(note).mesh.position;
      const marker = cursor.markers[i].getWorldPosition(new THREE.Vector3());
      close(p.x, marker.x); close(p.z, marker.z); close(marker.y - p.y, 0.05);
      renderer.showJudgementEffect(note, 'perfect');
      const effect = renderer.effects.at(-1).mesh.position;
      close(effect.x, p.x); close(effect.z, p.z); close(effect.y - p.y, 0.01);

      // The actual rendered ribbon's center at each vertex is the keyed path.
      const geometry = lines.group.getObjectByName(`Lane_${lane.key}`).geometry;
      const vertices = geometry.attributes.position;
      layout.getLanePoints(lane.key).forEach((expected, j) => {
        const a = new THREE.Vector3().fromBufferAttribute(vertices, j * 2);
        const b = new THREE.Vector3().fromBufferAttribute(vertices, j * 2 + 1);
        close(a.add(b).multiplyScalar(0.5).distanceTo(expected), 0);
      });
    });
    chart.notes[0].judged = true;
    renderer.update(chart, t);
    assert.equal(renderer.noteMeshes.get(chart.notes[0]).mesh.visible, false);
    assert.equal(renderer.noteMeshes.get(chart.notes[1]).mesh.visible, true);
  }
  renderer.dispose(); lines.dispose(); cursor.dispose();
});

test('duplicate points and corners stay finite; zero-length paths are rejected', () => {
  const layout = layoutFor([[0, 0, 0], [0, 0, 0], [0, 0, 2], [2, 0, 2], [2, 0, 2]]);
  for (const d of [-10, 0, 2, 3, 4, 99]) for (const lane of LANES) {
    assert.ok(layout.getPositionAtDistance(d, lane.key).toArray().every(Number.isFinite));
  }
  assert.throws(() => layoutFor([[0, 0, 0], [0, 0, 0]]));
});
