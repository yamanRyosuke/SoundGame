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
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Camera (上から見下ろす視点)
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);

    // ズーム設定
    this.zoomLevel = 1.0;
    this.minZoom = 0.3;
    this.maxZoom = 2.0;
    this._basePosition = { x: 0, y: 8, z: 5 };
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

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.render();
  }

  /**
   * シーンをレンダリング
   */
  render() {
    this.renderer.render(this.scene, this.camera);
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
      this._basePosition.x * scale,
      this._basePosition.y * scale,
      this._basePosition.z * scale
    );
    this.camera.lookAt(0, 0, 0);
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
