import * as THREE from 'three';

// About 1.5 seconds of travel in view, kept between a readable close-up and a
// wide shot. Slow songs on short courses still show the lanes large enough.
export function followSpan(speed) {
  return Math.min(9, Math.max(2.5, speed * 1.5));
}

// Where the follow camera sits and which way it faces. 'chase' turns with the
// path toward a point ahead, so lanes keep their left-right order on every bend;
// 'north' keeps the overview's orientation.
export function followFrame(lanes, distance, span, mode = 'chase') {
  const center = lanes.getFrameAtDistance(distance).center;
  if (mode === 'north') return { center, forward: new THREE.Vector3(0, 0, -1) };
  const total = lanes.centerline.getTotalLength(), ahead = distance + span * 0.6;
  const forward = lanes.getFrameAtDistance(lanes.closed ? ahead : Math.min(total, ahead)).center.sub(center);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) {
    forward.copy(center).sub(lanes.getFrameAtDistance(Math.max(0, distance - span * 0.6)).center);
    forward.y = 0;
  }
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  return { center, forward: forward.normalize() };
}
