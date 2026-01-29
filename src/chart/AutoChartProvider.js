/**
 * AutoChartProvider.js
 *
 * 設計意図:
 * - 自動生成譜面を提供
 * - BPM ベースのノーツ配置
 * - 等間隔配置（フォールバック）
 */
import { ChartProvider } from './ChartProvider.js';
import { Chart } from './Chart.js';

/**
 * 自動譜面生成の設定
 * @typedef {Object} AutoChartConfig
 * @property {number} [bpm] - BPM（指定時は interval より優先）
 * @property {number} [notesPerBeat=1] - 1拍あたりのノーツ数（1=4分, 2=8分, 4=16分）
 * @property {number} [interval=1.0] - ノーツ間隔（秒）BPM未指定時に使用
 * @property {number} [startOffset=2.0] - 開始オフセット（秒）
 * @property {number} [endOffset=1.0] - 終了オフセット（秒）
 * @property {string[]} [keys=['W','A','S','D']] - 使用するキー
 * @property {string} [pattern='random'] - パターン（'random', 'sequential', 'alternate'）
 */

export class AutoChartProvider extends ChartProvider {
  /**
   * @param {AutoChartConfig} [config]
   */
  constructor(config = {}) {
    super();
    this.config = {
      bpm: config.bpm ?? null,
      notesPerBeat: config.notesPerBeat ?? 1,
      interval: config.interval ?? 1.0,
      startOffset: config.startOffset ?? 2.0,
      endOffset: config.endOffset ?? 1.0,
      keys: config.keys ?? ['W', 'A', 'S', 'D'],
      pattern: config.pattern ?? 'sequential'
    };
  }

  /**
   * 譜面を自動生成
   * @param {Object} audioMeta - 音源メタ情報 { src, duration }
   * @param {Object} lane - レーン情報 { laneId }
   * @returns {Promise<Chart>}
   */
  async getChart(audioMeta, lane) {
    const { bpm, notesPerBeat, interval, startOffset, endOffset, keys, pattern } = this.config;
    const duration = audioMeta.duration;

    // BPM からノーツ間隔を計算、なければ固定 interval を使用
    let noteInterval;
    if (bpm && bpm > 0) {
      // 1拍 = 60/BPM 秒、notesPerBeat で分割
      noteInterval = (60 / bpm) / notesPerBeat;
    } else {
      noteInterval = interval;
    }

    const notes = [];
    let keyIndex = 0;

    for (let t = startOffset; t < duration - endOffset; t += noteInterval) {
      const key = this._getNextKey(keys, keyIndex, pattern);
      keyIndex++;

      notes.push({
        t: t,
        type: 'tap',
        key: key
      });
    }

    const chartData = {
      audio: {
        src: audioMeta.src,
        duration: audioMeta.duration
      },
      laneId: lane?.laneId || 'auto',
      notes: notes
    };

    const bpmInfo = bpm ? `BPM=${bpm}, ${notesPerBeat}notes/beat` : `interval=${interval}s`;
    console.log(`Auto chart generated: ${notes.length} notes (${bpmInfo})`);
    return new Chart(chartData);
  }

  /**
   * 次のキーを取得
   * @param {string[]} keys
   * @param {number} index
   * @param {string} pattern
   * @returns {string}
   * @private
   */
  _getNextKey(keys, index, pattern) {
    switch (pattern) {
      case 'sequential':
        // 順番に
        return keys[index % keys.length];

      case 'alternate':
        // 2キーで交互
        return keys[index % 2];

      case 'random':
      default:
        // ランダム
        return keys[Math.floor(Math.random() * keys.length)];
    }
  }

  /**
   * 設定を更新
   * @param {AutoChartConfig} config
   */
  setConfig(config) {
    Object.assign(this.config, config);
  }

  /**
   * BPM を設定
   * @param {number} bpm
   * @param {number} [notesPerBeat=1]
   */
  setBPM(bpm, notesPerBeat = 1) {
    this.config.bpm = bpm;
    this.config.notesPerBeat = notesPerBeat;
  }

  /**
   * Provider の種別
   * @returns {string}
   */
  getType() {
    return 'auto';
  }
}
