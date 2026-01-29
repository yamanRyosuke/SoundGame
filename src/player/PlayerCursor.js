/**
 * PlayerCursor.js
 *
 * 設計意図:
 * - プレイヤーを表す黄色い三角形カーソル
 * - 位置と向きを外部から設定可能（Game.js が制御）
 * - 描画のみを担当、ゲームロジックは持たない
 */
import * as THREE from 'three';

export class PlayerCursor {
  constructor() {
    // コンテナオブジェクト
    this.group = new THREE.Group();
    this.group.name = 'PlayerCursor';

    // 三角形カーソルの作成
    this._createCursor();

    // 内部状態
    this._position = new THREE.Vector3();
    this._direction = new THREE.Vector3(1, 0, 0);
  }

  /**
   * 三角形カーソルを作成
   * @private
   */
  _createCursor() {
    // 三角形のジオメトリ（進行方向を +X とする）
    const shape = new THREE.Shape();
    const size = 0.25;

    // 三角形の頂点（先端が +X 方向）
    shape.moveTo(size, 0);           // 先端
    shape.lineTo(-size * 0.6, size * 0.5);  // 左後ろ
    shape.lineTo(-size * 0.6, -size * 0.5); // 右後ろ
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);

    // Y軸回転で XZ 平面に配置するため、Z軸周りに -90度回転して配置
    // Three.js の ShapeGeometry は XY 平面に生成されるため、XZ 平面に変換
    geometry.rotateX(-Math.PI / 2);

    // 黄色いマテリアル
    const material = new THREE.MeshBasicMaterial({
      color: 0xffdd00,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'CursorMesh';

    // 輪郭線
    const edgeGeometry = new THREE.EdgesGeometry(geometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xff8800,
      linewidth: 2
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.name = 'CursorEdges';

    this.group.add(mesh);
    this.group.add(edges);

    // 少し浮かせる（レーンの上に表示）
    this.group.position.y = 0.05;
  }

  /**
   * 位置を設定
   * @param {THREE.Vector3} position
   */
  setPosition(position) {
    this._position.copy(position);
    this.group.position.x = position.x;
    // Y は固定（浮かせる）
    this.group.position.z = position.z;
  }

  /**
   * 進行方向を設定（カーソルの向きを更新）
   * @param {THREE.Vector3} direction - 正規化された方向ベクトル
   */
  setDirection(direction) {
    this._direction.copy(direction);

    // XZ 平面での回転角を計算
    // 三角形は +X 方向が先端なので、atan2(z, x) で角度を求め、符号反転
    const angle = Math.atan2(direction.z, direction.x);
    this.group.rotation.y = -angle;
  }

  /**
   * 現在位置を取得
   * @returns {THREE.Vector3}
   */
  getPosition() {
    return this._position.clone();
  }

  /**
   * 現在の方向を取得
   * @returns {THREE.Vector3}
   */
  getDirection() {
    return this._direction.clone();
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
