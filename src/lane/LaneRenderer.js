/**
 * LaneRenderer.js
 *
 * 設計意図:
 * - レーンの点列を Three.js で可視化
 * - 描画のみを担当（データ計算は ArcLengthTable が担当）
 * - ラインとグリッドでレーンを表現
 */
import * as THREE from 'three';

export class LaneRenderer {
  /**
   * @param {Array<[number, number, number]>} points - 3D点列
   */
  constructor(points) {
    // コンテナオブジェクト
    this.group = new THREE.Group();
    this.group.name = 'LaneRenderer';

    // レーンラインの作成
    this._createLaneLine(points);

    // グリッド（床の参照用）
    this._createGrid();
  }

  /**
   * レーンラインを作成
   * @param {Array<[number, number, number]>} points
   * @private
   */
  _createLaneLine(points) {
    // メインライン（太い）
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(points.length * 3);

    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i][0];
      positions[i * 3 + 1] = points[i][1];
      positions[i * 3 + 2] = points[i][2];
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // メインライン
    const mainMaterial = new THREE.LineBasicMaterial({
      color: 0x4a90e2,
      linewidth: 2 // 注意: WebGL では linewidth > 1 は効かない環境が多い
    });
    const mainLine = new THREE.Line(geometry, mainMaterial);
    mainLine.name = 'LaneMainLine';
    this.group.add(mainLine);

    // グロー用の太めライン（透明度で重ねる）
    const glowMaterial = new THREE.LineBasicMaterial({
      color: 0x4a90e2,
      transparent: true,
      opacity: 0.3
    });
    const glowLine = new THREE.Line(geometry.clone(), glowMaterial);
    glowLine.name = 'LaneGlowLine';
    glowLine.scale.set(1.02, 1.02, 1.02);
    this.group.add(glowLine);

    // 始点・終点マーカー
    this._addMarker(points[0], 0x00ff88, 'StartMarker');
    this._addMarker(points[points.length - 1], 0xff4444, 'EndMarker');
  }

  /**
   * マーカー（球体）を追加
   * @param {[number, number, number]} position
   * @param {number} color
   * @param {string} name
   * @private
   */
  _addMarker(position, color, name) {
    const geometry = new THREE.SphereGeometry(0.08, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color });
    const marker = new THREE.Mesh(geometry, material);
    marker.name = name;
    marker.position.set(position[0], position[1], position[2]);
    this.group.add(marker);
  }

  /**
   * グリッド（床）を作成
   * @private
   */
  _createGrid() {
    const gridHelper = new THREE.GridHelper(10, 20, 0x333344, 0x222233);
    gridHelper.name = 'Grid';
    this.group.add(gridHelper);
  }

  /**
   * Three.js オブジェクトを取得
   * @returns {THREE.Group}
   */
  getObject() {
    return this.group;
  }

  /**
   * リソースの解放
   */
  dispose() {
    this.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}
