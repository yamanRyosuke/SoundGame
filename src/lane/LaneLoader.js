/**
 * LaneLoader.js
 *
 * 設計意図:
 * - Blender から書き出された レーン JSON を読み込む
 * - データ取得のみを担当（パース・バリデーション）
 * - 弧長計算や描画とは独立
 */

/**
 * レーンデータの型定義（JSDocによる型ヒント）
 * @typedef {Object} LaneData
 * @property {string} laneId - レーンの識別子
 * @property {Array<[number, number, number]>} points - 3D点列 [[x,y,z], ...]
 */

export class LaneLoader {
  /**
   * レーン JSON を読み込む
   * @param {string} url - JSON ファイルの URL
   * @returns {Promise<LaneData>} レーンデータ
   * @throws {Error} 読み込みまたはパースに失敗した場合
   */
  static async load(url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to load lane data: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // バリデーション
    LaneLoader._validate(data);

    return data;
  }

  /**
   * レーンデータのバリデーション
   * @param {any} data
   * @throws {Error} バリデーションエラー
   * @private
   */
  static _validate(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid lane data: not an object');
    }

    if (typeof data.laneId !== 'string') {
      throw new Error('Invalid lane data: missing or invalid laneId');
    }

    if (!Array.isArray(data.points)) {
      throw new Error('Invalid lane data: points must be an array');
    }

    if (data.points.length < 2) {
      throw new Error('Invalid lane data: at least 2 points required');
    }

    // 各点のバリデーション
    for (let i = 0; i < data.points.length; i++) {
      const point = data.points[i];
      if (!Array.isArray(point) || point.length !== 3) {
        throw new Error(`Invalid lane data: point[${i}] must be [x, y, z]`);
      }
      if (point.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
        throw new Error(`Invalid lane data: point[${i}] contains invalid number`);
      }
    }
  }
}
