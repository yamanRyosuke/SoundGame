/**
 * GameRenderer.js
 *
 * 設計意図:
 * - Three.js のシーン・カメラ・レンダラーを管理
 * - ゲームロジックとは独立した描画責務のみを担当
 * - リサイズ対応やピクセル比の最適化を一元管理
 */
import * as THREE from 'three';

export class GameRenderer {
  /**
   * @param {HTMLElement} container - canvas を挿入するコンテナ要素
   */
  constructor(container) {
    this.container = container;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xfbfaf7);

    // Camera (上から見下ろす視点)
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);

    // ズーム設定
    this.zoomLevel = 1.0;
    this.minZoom = 0.3;
    this.maxZoom = 2.0;
    this._basePosition = { x: 0, y: 8, z: 5 };
    this.target = new THREE.Vector3();
    this._updateCameraPosition();
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);
    this.renderer.autoClear = false;
    this._updateViewport();

    // Lighting
    this._setupLighting();

    // Resize handler
    this._boundOnResize = this._onResize.bind(this);
    window.addEventListener('resize', this._boundOnResize);
  }

  /**
   * シーンにライトを追加
   * @private
   */
  _setupLighting() {
    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    // Directional light
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 10, 5);
    this.scene.add(directional);
  }

  /**
   * ウィンドウリサイズ時の処理
   * @private
   */
  _onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.renderer.setSize(width, height);
    this._updateViewport();
    this.render();
  }

  /**
   * シーンをレンダリング
   */
  render() {
    this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    this.renderer.clear();
    const { x, y, width, height } = this.viewport;
    this.renderer.setViewport(x, y, width, height);
    this.renderer.render(this.scene, this.camera);
  }

  _updateViewport() {
    // Keep the complete preview above the timing strip and left of the studio.
    const width = Math.max(120, window.innerWidth - (window.innerWidth > 700 ? 370 : 32));
    const height = Math.max(100, window.innerHeight - 330);
    this.viewport = { x: 16, y: 165, width, height };
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.courseBounds) this._fitCamera();
  }

  fitCourse(points) {
    this.courseBounds = new THREE.Box3().setFromPoints(points.map(p => new THREE.Vector3(...p))).expandByScalar(1.2);
    this.zoomLevel = 1;
    this._fitCamera();
  }

  _fitCamera() {
    const bounds = this.courseBounds;
    bounds.getCenter(this.target);
    const direction = new THREE.Vector3(0, 1, 0.45).normalize();
    const up = new THREE.Vector3(0, direction.z, -direction.y);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * this.camera.aspect;
    let distance = 1;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const p = new THREE.Vector3(x, y, z).sub(this.target);
      distance = Math.max(distance, Math.abs(p.x) / tanH + p.dot(direction), Math.abs(p.dot(up)) / tanV + p.dot(direction));
    }
    this._basePosition = direction.multiplyScalar(distance * 1.05);
    this._updateCameraPosition();
  }

  /**
   * シーンにオブジェクトを追加
   * @param {THREE.Object3D} object
   */
  add(object) {
    this.scene.add(object);
  }

  /**
   * シーンからオブジェクトを削除
   * @param {THREE.Object3D} object
   */
  remove(object) {
    this.scene.remove(object);
  }

  /**
   * カメラ位置を更新（ズームレベルに基づく）
   * @private
   */
  _updateCameraPosition() {
    const scale = 1 / this.zoomLevel;
    this.camera.position.set(
      this.target.x + this._basePosition.x * scale,
      this.target.y + this._basePosition.y * scale,
      this.target.z + this._basePosition.z * scale
    );
    this.camera.lookAt(this.target);
  }

  /**
   * ズームイン
   * @param {number} [amount=0.1]
   */
  zoomIn(amount = 0.1) {
    this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + amount);
    this._updateCameraPosition();
  }

  /**
   * ズームアウト
   * @param {number} [amount=0.1]
   */
  zoomOut(amount = 0.1) {
    this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - amount);
    this._updateCameraPosition();
  }

  /**
   * ズームレベルを設定
   * @param {number} level
   */
  setZoom(level) {
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, level));
    this._updateCameraPosition();
  }

  /**
   * 現在のズームレベルを取得
   * @returns {number}
   */
  getZoom() {
    return this.zoomLevel;
  }

  /**
   * リソースの解放
   */
  dispose() {
    window.removeEventListener('resize', this._boundOnResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
