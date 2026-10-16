/**
 * ArcLengthTable.js
 *
 * 設計意図:
 * - レーンの弧長（arc length）パラメータを事前計算してテーブル化
 * - 距離 → 位置/方向 の O(log n) 参照を提供
 * - 音楽進捗に基づく等速移動を正確に実現
 *
 * 仕組み:
 * - 各セグメント（隣接点間）の長さを計算し、累積距離テーブルを構築
 * - 距離クエリ時は二分探索でセグメントを特定し、線形補間で位置を算出
 */
import * as THREE from 'three';

export class ArcLengthTable {
  /**
   * @param {Array<[number, number, number]>} points - 3D点列
   */
  constructor(points) {
    if (!points || points.length < 2) {
      throw new Error('ArcLengthTable requires at least 2 points');
    }

    // Vector3 配列に変換
    this.points = points.map(p => new THREE.Vector3(p[0], p[1], p[2]));

    // 累積距離テーブル [0, d1, d1+d2, ...]
    this.cumulativeDistances = this._buildTable();

    // 総距離（キャッシュ）
    this.totalLength = this.cumulativeDistances[this.cumulativeDistances.length - 1];
  }

  /**
   * 累積距離テーブルを構築
   * @returns {number[]} 累積距離配列
   * @private
   */
  _buildTable() {
    const distances = [0];
    let cumulative = 0;

    for (let i = 1; i < this.points.length; i++) {
      const segmentLength = this.points[i].distanceTo(this.points[i - 1]);
      cumulative += segmentLength;
      distances.push(cumulative);
    }

    return distances;
  }

  /**
   * レーンの総距離を取得
   * @returns {number}
   */
  getTotalLength() {
    return this.totalLength;
  }

  /**
   * 距離から対応するセグメントインデックスを二分探索で特定
   * @param {number} distance - 先頭からの距離
   * @returns {number} セグメントの開始インデックス
   * @private
   */
  _findSegmentIndex(distance) {
    // clamp
    if (distance <= 0) return 0;
    if (distance >= this.totalLength) return this.points.length - 2;

    // 二分探索
    let low = 0;
    let high = this.cumulativeDistances.length - 1;

    while (low < high - 1) {
      const mid = Math.floor((low + high) / 2);
      if (this.cumulativeDistances[mid] <= distance) {
        low = mid;
      } else {
        high = mid;
      }
    }

    return low;
  }

  /**
   * 指定距離における位置を取得
   * @param {number} distance - 先頭からの距離
   * @returns {THREE.Vector3} 3D位置
   */
  getPositionAtDistance(distance) {
    // clamp
    const clampedDistance = Math.max(0, Math.min(distance, this.totalLength));

    const segmentIndex = this._findSegmentIndex(clampedDistance);

    const startDist = this.cumulativeDistances[segmentIndex];
    const endDist = this.cumulativeDistances[segmentIndex + 1];
    const segmentLength = endDist - startDist;

    // セグメント内の補間率
    const t = segmentLength > 0 ? (clampedDistance - startDist) / segmentLength : 0;

    // 線形補間
    const p0 = this.points[segmentIndex];
    const p1 = this.points[segmentIndex + 1];

    return new THREE.Vector3().lerpVectors(p0, p1, t);
  }

  /**
   * 指定距離における進行方向を取得（正規化ベクトル）
   * @param {number} distance - 先頭からの距離
   * @returns {THREE.Vector3} 方向ベクトル（正規化済み）
   */
  getDirectionAtDistance(distance) {
    // clamp
    const clampedDistance = Math.max(0, Math.min(distance, this.totalLength));

    const segmentIndex = this._findSegmentIndex(clampedDistance);

    const p0 = this.points[segmentIndex];
    const p1 = this.points[segmentIndex + 1];

    // セグメントの方向ベクトル
    const direction = new THREE.Vector3().subVectors(p1, p0).normalize();

    // 零ベクトル対策（同一点の場合）
    if (direction.lengthSq() === 0) {
      return new THREE.Vector3(1, 0, 0);
    }

    return direction;
  }

  /**
   * デバッグ情報を取得
   * @returns {Object}
   */
  getDebugInfo() {
    return {
      pointCount: this.points.length,
      segmentCount: this.points.length - 1,
      totalLength: this.totalLength,
      cumulativeDistances: [...this.cumulativeDistances]
    };
  }
}
