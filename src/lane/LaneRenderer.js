import * as THREE from 'three';
import { laneForKey } from './LaneLayout.js';

export class LaneRenderer {
  constructor(parallelLanes) {
    this.group = new THREE.Group();
    this.group.name = 'LaneRenderer';
    for (const lane of parallelLanes.lanes) this._createLane(parallelLanes, lane);
    const grid = new THREE.GridHelper(10, 20, 0x333344, 0x222233);
    grid.position.y = -0.04;
    this.group.add(grid);
  }

  _createLane(layout, lane) {
    const points = layout.getLanePoints(lane.key);
    // A narrow ribbon has a reliable width in WebGL, unlike LineBasicMaterial.linewidth.
    const vertices = [], indices = [];
    points.forEach((point, i) => {
      const side = layout.laterals[i].clone().multiplyScalar(0.012);
      vertices.push(point.x - side.x, point.y, point.z - side.z,
        point.x + side.x, point.y, point.z + side.z);
      if (i < points.length - 1) {
        const j = i * 2;
        indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({ color: lane.color, side: THREE.DoubleSide, transparent: true, opacity: 0.65 });
    const line = new THREE.Mesh(geometry, material);
    line.name = `Lane_${lane.key}`;
    this.group.add(line);

    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64 * lane.keys.length;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 48px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lane.keys.forEach((key, i) => {
      ctx.fillStyle = '#' + laneForKey(key).color.toString(16).padStart(6, '0');
      ctx.fillText(key, 32, 32 + 64 * i);
    });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    label.position.copy(points[0]); label.position.y += 0.18 + 0.11 * lane.keys.length;
    label.scale.set(0.25, 0.22 * lane.keys.length, 1);
    label.name = `LaneLabel_${lane.key}`;
    this.group.add(label);
  }

  getObject() { return this.group; }
  dispose() {
    this.group.traverse(child => {
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) { material?.map?.dispose(); material?.dispose(); }
    });
  }
}
