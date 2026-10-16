import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CharacterField, CHARACTER_CAST, MOTIONS, MAX_CHARACTERS, characterPose, fillEnclosed } from '../src/characters/CharacterField.js';

const fieldWithCutouts = () => {
  const field = new CharacterField();
  for (const cast of Object.values(CHARACTER_CAST)) {
    for (const file of cast.files) field.cutouts.set(file, { material: new THREE.MeshBasicMaterial(), aspect: 1 });
  }
  return field;
};
const place = (along, across) => new THREE.Vector3(across, 0, -along);

test('each hit judgement brings its own cast; Miss brings nobody', () => {
  const casts = Object.values(CHARACTER_CAST).map(cast => cast.files);
  assert.equal(new Set(casts.flat()).size, casts.flat().length, 'casts must not share characters');
  const field = fieldWithCutouts();
  assert.equal(field.spawn('miss', new THREE.Vector3(), place, 0.7, 0), null);
  for (const judgement of ['perfect', 'great', 'good']) {
    for (let i = 0; i < 12; i++) {
      const c = field.spawn(judgement, new THREE.Vector3(), place, 0.7, i);
      assert.ok(CHARACTER_CAST[judgement].files.includes(c.file), `${judgement} got ${c.file}`);
      assert.ok(MOTIONS.includes(c.motion));
      // Lands ahead of the hit and clear of the lanes.
      assert.ok(c.target.z < -0.7 && Math.abs(c.target.x) > 0.7 + c.width / 2);
    }
  }
  assert.ok(field.characters.filter(c => c.judgement === 'perfect').every(c => c.height > CHARACTER_CAST.good.height));
});

test('characters stay where they land, and the oldest shrink away past the cap', () => {
  const field = fieldWithCutouts();
  const first = field.spawn('great', new THREE.Vector3(5, 0, 5), place, 0.7, 0);
  field.update(0.2, null);
  assert.ok(first.root.position.distanceTo(first.target) > 0.1, 'still leaping mid-air');
  field.update(3, null);
  assert.ok(first.root.position.distanceTo(first.target) < 1e-9);
  for (let i = 0; i < MAX_CHARACTERS; i++) field.spawn('good', new THREE.Vector3(), place, 0.7, 4);
  assert.equal(field.characters.filter(c => !c.leaving).length, MAX_CHARACTERS);
  assert.equal(first.leaving, 4);
  field.update(4.5, null);
  assert.ok(!field.characters.includes(first));
  field.clear();
  assert.equal(field.characters.length, 0);
  assert.equal(field.group.children.length, 0);
});

test('motions stay on the ground, squash softly and roll with the distance', () => {
  for (const motion of MOTIONS) {
    for (let t = 0; t < 6; t += 0.05) {
      const pose = characterPose(motion, t, { radius: 0.4, phase: 0.3, reach: 0.5 });
      for (const v of Object.values(pose)) assert.ok(Number.isFinite(v));
      assert.ok(pose.lift >= 0 && pose.lift < 0.8, `${motion} lift ${pose.lift}`);
      assert.ok(pose.scaleY > 0.6 && pose.scaleY < 1.3);
      assert.ok(Math.abs(pose.scaleX * pose.scaleY - Math.sqrt(pose.scaleY)) < 1e-9, 'area-preserving squash');
    }
  }
  const lifts = Array.from({ length: 100 }, (_, i) => characterPose('hop', i * 0.01).lift);
  assert.ok(Math.max(...lifts) > 0.1 && Math.min(...lifts) < 0.01, 'hop leaves and touches the ground');
  for (const t of [0.5, 2, 4.4]) {
    const pose = characterPose('roll', t, { radius: 0.3 });
    assert.ok(Math.abs(pose.roll + pose.side / 0.3) < 1e-9, 'rolling, not sliding');
  }
  const spins = Array.from({ length: 140 }, (_, i) => characterPose('flip', i * 0.01).spin);
  assert.ok(Math.max(...spins) > 6, 'one full paper spin');
});

test('enclosed areas get paper, the outside stays transparent', () => {
  const size = 9, data = new Uint8ClampedArray(size * size * 4);
  const ink = (x, y) => { data[(y * size + x) * 4 + 3] = 255; };
  for (let i = 2; i <= 6; i++) { ink(i, 2); ink(i, 6); ink(2, i); ink(6, i); }
  fillEnclosed(data, size, size);
  const alpha = (x, y) => data[(y * size + x) * 4 + 3];
  assert.equal(alpha(4, 4), 255);
  assert.deepEqual([...data.slice((4 * size + 4) * 4, (4 * size + 4) * 4 + 3)], [255, 253, 247]);
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(8, 4), 0);
  assert.equal(alpha(2, 2), 255);
});
