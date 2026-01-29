/**
 * ChartProvider.js
 *
 * 設計意図:
 * - 譜面取得の抽象インターフェース
 * - Fixed（固定譜面）と Auto（自動生成）で共通のAPI
 * - 依存性注入による切り替え可能な設計
 */
import { Chart } from './Chart.js';

/**
 * ChartProvider 基底クラス（インターフェース）
 * @abstract
 */
export class ChartProvider {
  /**
   * 譜面を取得
   * @param {Object} audioMeta - 音源メタ情報 { src, duration }
   * @param {Object} lane - レーン情報 { laneId, points }
   * @returns {Promise<Chart>}
   * @abstract
   */
  async getChart(audioMeta, lane) {
    throw new Error('getChart must be implemented by subclass');
  }

  /**
   * Provider の種別を取得
   * @returns {string}
   * @abstract
   */
  getType() {
    throw new Error('getType must be implemented by subclass');
  }
}
