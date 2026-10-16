/**
 * FixedChartProvider.js
 *
 * 設計意図:
 * - JSON ファイルから固定譜面を読み込む
 * - 手作業で作成された譜面を使用
 */
import { ChartProvider } from './ChartProvider.js';
import { Chart } from './Chart.js';

export class FixedChartProvider extends ChartProvider {
  /**
   * @param {string} chartUrl - 譜面 JSON の URL
   */
  constructor(chartUrl) {
    super();
    this.chartUrl = chartUrl;
  }

  /**
   * 譜面を取得
   * @param {Object} audioMeta - 音源メタ情報
   * @param {Object} lane - レーン情報
   * @returns {Promise<Chart>}
   */
  async getChart(audioMeta, lane) {
    const response = await fetch(this.chartUrl);
    if (!response.ok) {
      throw new Error(`Failed to load chart: ${response.status}`);
    }

    const data = await response.json();

    // audioMeta で上書き可能
    if (audioMeta) {
      data.audio = {
        src: audioMeta.src || data.audio?.src,
        duration: audioMeta.duration || data.audio?.duration
      };
    }

    // Sample note times/keys can be previewed on any selected course.
    if (lane) data.laneId = lane.laneId;

    return new Chart(data);
  }

  /**
   * Provider の種別
   * @returns {string}
   */
  getType() {
    return 'fixed';
  }
}
