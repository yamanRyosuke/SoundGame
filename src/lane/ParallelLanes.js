import * as THREE from 'three';
import { createLaneLayout } from './LaneLayout.js';

/**
 * All four lanes use the CENTER path's arc-length clock. Never build individual
 * arc-length clocks for the offset paths: on asymmetric curves they drift apart.
 * Miter joins preserve parallel segments. The same interpolated cross-section
 * places lane lines, notes, effects and the judgement bar at a given music time.
 */
export class ParallelLanes {
  constructor(centerline, laneCount = 4) {
    this.lanes = createLaneLayout(laneCount);
    this.centerline = centerline;
    this.points = centerline.points;
    if (centerline.getTotalLength() <= 1e-8) throw new Error('レーンに長さがありません');
    this.closed = this.points[0].distanceTo(this.points.at(-1)) < 1e-6;
    this.laterals = this.points.map((_, i) => this._lateralAtVertex(i));
  }

  _normalAtVertex(index, direction) {
    const count = this.closed ? this.points.length - 1 : this.points.length;
    const origin = this.points[index];
    for (let step = 1; step < count; step++) {
      let other = index + step * direction;
      if (this.closed) other = (other % count + count) % count;
      else if (other < 0 || other >= count) return null;
      const tangent = this.points[other].clone().sub(origin).multiplyScalar(direction);
      tangent.y = 0;
      if (tangent.lengthSq() > 1e-12) {
        tangent.normalize();
        return new THREE.Vector3(tangent.z, 0, -tangent.x);
      }
    }
    return null;
  }

  _lateralAtVertex(i) {
    if (this.closed && i === this.points.length - 1) i = 0;
    const incoming = this._normalAtVertex(i, -1);
    const outgoing = this._normalAtVertex(i, 1);
    if (!incoming && !outgoing) throw new Error('レーンには水平方向の長さが必要です');
    if (!incoming || !outgoing) return (incoming || outgoing).clone();
    const bisector = incoming.clone().add(outgoing);
    if (bisector.lengthSq() < 1e-10) return outgoing.clone();
    bisector.normalize();
    // Limit sharp-corner spikes. Ordinary curves and right angles use exact miters.
    return bisector.multiplyScalar(Math.min(2, 1 / Math.max(1e-6, bisector.dot(outgoing))));
  }

  getFrameAtDistance(distance) {
    const d = Math.max(0, Math.min(distance, this.centerline.getTotalLength()));
    const i = this.centerline._findSegmentIndex(d);
    const distances = this.centerline.cumulativeDistances;
    const length = distances[i + 1] - distances[i];
    const fraction = length > 0 ? (d - distances[i]) / length : 0;
    return {
      center: this.centerline.getPositionAtDistance(d),
      lateral: this.laterals[i].clone().lerp(this.laterals[i + 1], fraction),
      distance: d
    };
  }

  getPositionAtDistance(distance, key) {
    const { center, lateral } = this.getFrameAtDistance(distance);
    return center.addScaledVector(lateral, this.laneForKey(key).offset);
  }

  getPositionAtTime(time, duration, key) {
    return this.getPositionAtDistance(this.centerline.getDistanceAtTime(time, duration), key);
  }

  getLanePoints(key) {
    const offset = this.laneForKey(key).offset;
    return this.points.map((point, i) => point.clone().addScaledVector(this.laterals[i], offset));
  }

  laneForKey(key) {
    const lane = this.lanes.find(lane => lane.keys.includes(key));
    if (!lane) throw new Error(`Unknown lane key: ${key}`);
    return lane;
  }
}
