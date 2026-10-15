import * as THREE from 'three';
import { createLaneLayout } from '../lane/LaneLayout.js';

// A single cross-lane bar is driven by one centerline frame, including on bends.
export class PlayerCursor {
  constructor(lanes = createLaneLayout()) {
    this.lanes = lanes;
    this.group = new THREE.Group();
    this.group.name = 'PlayerCursor';
    this.bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.025, 0.045),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
    this.group.add(this.bar);
    this.markers = this.lanes.map(lane => {
      const geometry = new THREE.RingGeometry(0.075, 0.105, 20);
      geometry.rotateX(-Math.PI / 2);
      const marker = new THREE.Mesh(geometry,
        new THREE.MeshBasicMaterial({ color: lane.color, side: THREE.DoubleSide }));
      marker.name = `Cursor_${lane.key}`;
      this.group.add(marker);
      return marker;
    });
  }

  setFrame({ center, lateral }) {
    this.group.position.copy(center);
    this.group.position.y += 0.07;
    this.group.rotation.y = -Math.atan2(lateral.z, lateral.x);
    const length = lateral.length();
    this.bar.scale.x = (this.lanes.at(-1).offset - this.lanes[0].offset) * length + 0.25;
    this.markers.forEach((marker, i) => { marker.position.x = this.lanes[i].offset * length; });
  }

  getObject() { return this.group; }
  dispose() {
    this.group.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
  }
}
