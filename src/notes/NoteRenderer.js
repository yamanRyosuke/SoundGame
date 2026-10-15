/**
 * NoteRenderer.js
 *
 * 設計意図:
 * - 譜面上のノーツを Three.js で可視化
 * - 各ノーツをレーン上の適切な位置に配置
 * - 判定結果に応じた視覚的フィードバック
 */
import * as THREE from 'three';
import { laneForKey } from '../lane/LaneLayout.js';

/**
 * キーごとの色
 */
/**
 * 判定結果の色
 */
const JUDGEMENT_COLORS = {
  perfect: 0x996122,
  great: 0x39754e,
  good: 0x376b9b,
  miss: 0xad405d
};

// テキストラベル用のテクスチャキャッシュ
const labelTextureCache = new Map();

/**
 * キーラベル用のテクスチャを生成
 * @param {string} key
 * @returns {THREE.CanvasTexture}
 */
function createLabelTexture(key) {
  if (labelTextureCache.has(key)) {
    return labelTextureCache.get(key);
  }

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 背景（透明）
  ctx.clearRect(0, 0, size, size);

  // テキスト
  ctx.fillStyle = '#302d29';
  ctx.font = 'bold 48px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(key, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  labelTextureCache.set(key, texture);

  return texture;
}

export class NoteRenderer {
  /**
   * @param {import('../lane/ParallelLanes.js').ParallelLanes} parallelLanes
   * @param {number} audioDuration - 音源の長さ（秒）
   */
  constructor(parallelLanes, audioDuration) {
    this.parallelLanes = parallelLanes;
    this.audioDuration = audioDuration;

    // コンテナ
    this.group = new THREE.Group();
    this.group.name = 'NoteRenderer';

    // Note identity also distinguishes different keys at the same music time.
    this.noteMeshes = new Map();

    // 判定エフェクト用
    this.effects = [];
  }

  /**
   * 譜面からノーツを生成
   * @param {import('../chart/Chart.js').Chart} chart
   */
  createNotes(chart) {
    // 既存のノーツをクリア
    this.clear();

    chart.notes.forEach(note => {
      const mesh = this._createNoteMesh(note);
      if (mesh) {
        this.group.add(mesh);
        this.noteMeshes.set(note, { mesh, note });
      }
    });

    console.log(`NoteRenderer: Created ${this.noteMeshes.size} note meshes`);
  }

  /**
   * 単一ノーツのメッシュを作成
   * @param {Object} note
   * @returns {THREE.Group}
   * @private
   */
  _createNoteMesh(note) {
    // 時刻から位置を計算
    const position = this.parallelLanes.getPositionAtTime(note.t, this.audioDuration, note.key);

    // ノーツ全体を格納するグループ
    const noteGroup = new THREE.Group();
    noteGroup.position.copy(position);
    noteGroup.position.y += 0.02;
    noteGroup.name = `Note_${note.key}_${note.t}`;

    // ジオメトリ（ひし形/ダイヤ）
    const geometry = new THREE.CircleGeometry(0.13, 4);
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(Math.PI / 4);

    // キーに応じた色
    const color = laneForKey(note.key).color;
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });

    const mesh = new THREE.Mesh(geometry, material);
    noteGroup.add(mesh);

    // 輪郭
    const edgeGeometry = new THREE.EdgesGeometry(geometry);
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x302d29 });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    noteGroup.add(edges);

    // キーラベル（スプライト）
    const labelTexture = createLabelTexture(note.key);
    const labelMaterial = new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      depthTest: false
    });
    const label = new THREE.Sprite(labelMaterial);
    label.scale.set(0.25, 0.25, 1);
    label.position.set(0, 0.15, 0); // ノーツの少し上に配置
    noteGroup.add(label);

    return noteGroup;
  }

  /**
   * ノーツの表示を更新（判定済みノーツを非表示に）
   * @param {import('../chart/Chart.js').Chart} chart
   */
  update(chart, time = 0) {
    chart.notes.forEach(note => {
      const entry = this.noteMeshes.get(note);
      if (entry) entry.mesh.visible = !note.judged && note.t >= time - 0.3 && note.t <= time + 4;
    });

    // エフェクトの更新
    this._updateEffects();
  }

  /**
   * 判定エフェクトを表示
   * @param {Object} note
   * @param {string} judgement
   */
  showJudgementEffect(note, judgement) {
    const position = this.parallelLanes.getPositionAtTime(note.t, this.audioDuration, note.key);

    // エフェクト用リング
    const geometry = new THREE.RingGeometry(0.1, 0.2, 16);
    geometry.rotateX(-Math.PI / 2);

    const color = JUDGEMENT_COLORS[judgement] || 0xffffff;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide
    });

    const effect = new THREE.Mesh(geometry, material);
    effect.position.copy(position);
    effect.position.y += 0.03;

    this.group.add(effect);
    this.effects.push({
      mesh: effect,
      life: 1.0,
      decay: 0.05
    });
  }

  /**
   * エフェクトを更新
   * @private
   */
  _updateEffects() {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      effect.life -= effect.decay;

      if (effect.life <= 0) {
        this.group.remove(effect.mesh);
        effect.mesh.geometry.dispose();
        effect.mesh.material.dispose();
        this.effects.splice(i, 1);
      } else {
        effect.mesh.material.opacity = effect.life;
        effect.mesh.scale.setScalar(1 + (1 - effect.life) * 2);
      }
    }
  }

  /**
   * Three.js オブジェクトを取得
   * @returns {THREE.Group}
   */
  getObject() {
    return this.group;
  }

  /**
   * クリア
   */
  clear() {
    // ノーツメッシュを削除
    this.noteMeshes.forEach(entry => {
      this.group.remove(entry.mesh);
      // グループ内の全オブジェクトを dispose
      entry.mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          // Label textures are shared by every note and replay.
          child.material.dispose();
        }
      });
    });
    this.noteMeshes.clear();

    // エフェクトを削除
    this.effects.forEach(effect => {
      this.group.remove(effect.mesh);
      effect.mesh.geometry.dispose();
      effect.mesh.material.dispose();
    });
    this.effects = [];
  }

  /**
   * リソースの解放
   */
  dispose() {
    this.clear();
  }
}
