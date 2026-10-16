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

const easeOut = p => 1 - (1 - p) ** 3;
const flat = geometry => geometry.rotateX(-Math.PI / 2);

/**
 * 判定ごとのエフェクト。良い判定ほど大きく長く、派手になる。
 * - perfect: 二重の輪、8本の光線、舞い上がる粒、中心の閃光
 * - great: 太い輪と4本の光線
 * - good: 細く小さい輪がすぐ消える
 * - miss: 揺れながら沈む×印
 */
const EFFECT_STYLES = {
  perfect: { duration: 0.6, rings: [{ to: 0.62, width: 0.1 }, { delay: 0.1, to: 0.4, width: 0.06 }], rays: 8, sparks: 7, flash: true },
  great: { duration: 0.45, rings: [{ to: 0.48, width: 0.08 }], rays: 4 },
  good: { duration: 0.3, rings: [{ to: 0.3, width: 0.045 }], opacity: 0.65 },
  miss: { duration: 0.5, cross: true }
};

export function createJudgementEffect(judgement) {
  const style = EFFECT_STYLES[judgement] ?? EFFECT_STYLES.good;
  const color = JUDGEMENT_COLORS[judgement] ?? 0x302d29;
  const strength = style.opacity ?? 1;
  const group = new THREE.Group();
  group.name = `Effect_${judgement}`;
  const parts = [];
  const add = (geometry, animate) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: strength, side: THREE.DoubleSide, depthWrite: false
    }));
    group.add(mesh);
    parts.push(t => animate(mesh, t));
    return mesh;
  };
  const progress = (t, delay = 0) => Math.min(1, Math.max(0, (t - delay) / (style.duration - delay)));

  for (const ring of style.rings ?? []) {
    add(flat(new THREE.RingGeometry(1 - ring.width / ring.to, 1, 40)), (mesh, t) => {
      const p = progress(t, ring.delay);
      mesh.visible = t >= (ring.delay ?? 0);
      mesh.scale.setScalar(0.1 + (ring.to - 0.1) * easeOut(p));
      mesh.material.opacity = strength * (1 - p);
    });
  }
  for (let i = 0; i < (style.rays ?? 0); i++) {
    const angle = (i + 0.5) / style.rays * Math.PI * 2;
    const ray = add(flat(new THREE.PlaneGeometry(0.05, 0.18)), (mesh, t) => {
      const p = progress(t), r = 0.16 + 0.42 * easeOut(p);
      mesh.position.set(Math.sin(angle) * r, 0, Math.cos(angle) * r);
      mesh.scale.set(1, 1, 1 - p);
      mesh.material.opacity = strength * (1 - p);
    });
    ray.rotation.y = angle;
  }
  for (let i = 0; i < (style.sparks ?? 0); i++) {
    const angle = i / style.sparks * Math.PI * 2 + 0.4, reach = 0.4 + 0.15 * (i % 3);
    add(flat(new THREE.CircleGeometry(0.04, 4)), (mesh, t) => {
      const p = progress(t);
      mesh.position.set(Math.sin(angle) * (0.1 + reach * easeOut(p)), 0.4 * p * (1 - p), Math.cos(angle) * (0.1 + reach * easeOut(p)));
      mesh.rotation.y = p * 6;
      mesh.material.opacity = strength * (1 - p * p);
    });
  }
  if (style.flash) {
    add(flat(new THREE.CircleGeometry(0.24, 24)), (mesh, t) => {
      const p = Math.min(1, t / 0.15);
      mesh.scale.setScalar(0.6 + 0.6 * p);
      mesh.material.opacity = 0.45 * (1 - p);
    });
  }
  if (style.cross) {
    for (const angle of [Math.PI / 4, -Math.PI / 4]) {
      const bar = add(flat(new THREE.PlaneGeometry(0.08, 0.36)), (mesh, t) => {
        mesh.material.opacity = 1 - progress(t) ** 2;
      });
      bar.rotation.y = angle;
    }
    parts.push(t => {
      const p = progress(t);
      group.children.forEach(child => { child.position.x = 0.05 * Math.sin(t * 55) * (1 - p); child.position.y = -0.12 * p; });
    });
  }
  const animate = t => parts.forEach(part => part(t));
  animate(0);
  return { group, duration: style.duration, animate };
}

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
   */
  constructor(parallelLanes) {
    this.parallelLanes = parallelLanes;

    // コンテナ
    this.group = new THREE.Group();
    this.group.name = 'NoteRenderer';

    // Note identity also distinguishes different keys at the same music time.
    this.noteMeshes = new Map();

    // 判定エフェクト用
    this.effects = [];

    // キーボードとコントローラーで表示する文字を切り替える
    this.labelFor = key => key;
  }

  /**
   * ノーツの文字を差し替える（判定用のキーは変えない）
   * @param {(key: string) => string} labelFor
   */
  setLabels(labelFor) {
    this.labelFor = labelFor;
    for (const { note, label } of this.noteMeshes.values()) label.material.map = createLabelTexture(labelFor(note.key));
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
        this.noteMeshes.set(note, { mesh, note, label: mesh.getObjectByName('label') });
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
    const position = this.parallelLanes.getPositionAtTime(note.t, note.key);

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
    const labelTexture = createLabelTexture(this.labelFor(note.key));
    const labelMaterial = new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      depthTest: false
    });
    const label = new THREE.Sprite(labelMaterial);
    label.name = 'label';
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
    // On a short loop the next lap's notes sit on the same spot; show less
    // than one lap ahead so they never overlap the current ones.
    const ahead = Math.min(4, this.parallelLanes.getLapTime() - 0.5);
    chart.notes.forEach(note => {
      const entry = this.noteMeshes.get(note);
      if (entry) entry.mesh.visible = !note.judged && note.t >= time - 0.3 && note.t <= time + ahead;
    });

    // エフェクトの更新
    this._updateEffects();
  }

  /**
   * 判定エフェクトを表示（判定ごとに形・大きさ・長さが違う）
   * @param {Object} note
   * @param {string} judgement
   */
  showJudgementEffect(note, judgement) {
    const effect = createJudgementEffect(judgement);
    effect.group.position.copy(this.parallelLanes.getPositionAtTime(note.t, note.key));
    effect.group.position.y += 0.03;
    this.group.add(effect.group);
    this.effects.push({ ...effect, born: performance.now() });
  }

  /**
   * エフェクトを更新
   * @private
   */
  _updateEffects(now = performance.now()) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i];
      const t = (now - effect.born) / 1000;
      if (t >= effect.duration) {
        this._disposeEffect(effect);
        this.effects.splice(i, 1);
      } else effect.animate(t);
    }
  }

  _disposeEffect(effect) {
    this.group.remove(effect.group);
    effect.group.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
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
    this.effects.forEach(effect => this._disposeEffect(effect));
    this.effects = [];
  }

  /**
   * リソースの解放
   */
  dispose() {
    this.clear();
  }
}
