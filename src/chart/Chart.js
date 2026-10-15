/**
 * Chart.js
 *
 * 設計意図:
 * - 譜面データの型定義と基本操作
 * - 固定譜面・自動生成譜面で共通のデータ構造
 * - 仕様書の JSON フォーマットに準拠
 */

/**
 * ノーツの種別
 * @typedef {'tap' | 'hold' | 'chord' | 'roll'} NoteType
 */

/**
 * 単一ノーツのデータ
 * @typedef {Object} Note
 * @property {number} t - 判定時刻（秒）
 * @property {NoteType} type - ノーツ種別
 * @property {string} [key] - 入力キー（tap/hold用: W/A/S/D）
 * @property {string[]} [keys] - 入力キー（chord用）
 * @property {number} [t2] - 終了時刻（hold用）
 * @property {boolean} [judged] - 判定済みフラグ（実行時に付与）
 * @property {string} [judgement] - 判定結果（実行時に付与）
 */

/**
 * 音源情報
 * @typedef {Object} AudioMeta
 * @property {string} src - 音源ファイルパス
 * @property {number} duration - 長さ（秒）
 */

/**
 * 譜面データ
 * @typedef {Object} ChartData
 * @property {AudioMeta} audio - 音源情報
 * @property {string} laneId - レーン ID
 * @property {Note[]} notes - ノーツ配列
 */

/**
 * 譜面クラス
 */
export class Chart {
  /**
   * @param {ChartData} data
   */
  constructor(data) {
    this.audio = data.audio;
    this.laneId = data.laneId;
    this.generation = data.generation || null;

    // ノーツを時刻順にソートしてコピー
    this.notes = [...data.notes].sort((a, b) => a.t - b.t);

    // 各ノーツに判定フラグを初期化
    this.notes.forEach(note => {
      note.judged = false;
      note.judgement = null;
    });
  }

  /**
   * 指定時刻周辺の未判定ノーツを取得
   * @param {number} time - 現在時刻（秒）
   * @param {number} windowMs - 判定ウィンドウ（ミリ秒）
   * @returns {Note[]}
   */
  getNotesInWindow(time, windowMs) {
    const windowSec = windowMs / 1000;
    return this.notes.filter(note =>
      !note.judged &&
      Math.abs(note.t - time) <= windowSec
    );
  }

  /**
   * 指定キーに対応する未判定ノーツを取得（最も近いもの）
   * @param {string} key - 入力キー
   * @param {number} time - 現在時刻（秒）
   * @param {number} windowMs - 判定ウィンドウ（ミリ秒）
   * @returns {Note | null}
   */
  getNoteForKey(key, time, windowMs) {
    const windowSec = windowMs / 1000;
    const candidates = this.notes.filter(note => {
      if (note.judged) return false;
      if (Math.abs(note.t - time) > windowSec) return false;

      // キーのマッチング
      if (note.type === 'tap' || note.type === 'hold') {
        return note.key === key;
      } else if (note.type === 'chord') {
        return note.keys && note.keys.includes(key);
      }
      return false;
    });

    if (candidates.length === 0) return null;

    // 最も時刻が近いノーツを返す
    return candidates.reduce((closest, note) =>
      Math.abs(note.t - time) < Math.abs(closest.t - time) ? note : closest
    );
  }

  /**
   * 通過済み（Miss）の未判定ノーツを取得
   * @param {number} time - 現在時刻（秒）
   * @param {number} windowMs - Miss判定の閾値（ミリ秒）
   * @returns {Note[]}
   */
  getMissedNotes(time, windowMs) {
    const windowSec = windowMs / 1000;
    return this.notes.filter(note =>
      !note.judged &&
      (time - note.t) > windowSec
    );
  }

  /**
   * 全ノーツ数を取得
   * @returns {number}
   */
  getTotalNotes() {
    return this.notes.length;
  }

  /**
   * 判定済みノーツ数を取得
   * @returns {number}
   */
  getJudgedCount() {
    return this.notes.filter(n => n.judged).length;
  }

  /**
   * 判定結果の集計を取得
   * @returns {Object<string, number>}
   */
  getJudgementCounts() {
    const counts = {};
    this.notes.forEach(note => {
      if (note.judged && note.judgement) {
        counts[note.judgement] = (counts[note.judgement] || 0) + 1;
      }
    });
    return counts;
  }

  /**
   * 譜面をリセット（再プレイ用）
   */
  reset() {
    this.notes.forEach(note => {
      note.judged = false;
      note.judgement = null;
    });
  }
}
