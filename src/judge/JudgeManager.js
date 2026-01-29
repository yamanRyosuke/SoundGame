/**
 * JudgeManager.js
 *
 * 設計意図:
 * - キー入力と判定処理を管理
 * - Chart と JudgementPreset を統合
 * - スコア計算とコンボ管理
 */
import { JudgementPresetManager } from './JudgementPreset.js';

/**
 * 判定結果のスコア値
 */
const SCORE_VALUES = {
  perfect: 1000,
  great: 800,
  good: 500,
  miss: 0
};

/**
 * 判定マネージャー
 */
export class JudgeManager {
  constructor() {
    /** @type {JudgementPresetManager} */
    this.presetManager = new JudgementPresetManager();

    // スコア
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;

    // 判定カウント
    this.counts = {
      perfect: 0,
      great: 0,
      good: 0,
      miss: 0
    };

    // イベントコールバック
    this._onJudgement = null;

    // 有効なキー
    this.validKeys = new Set(['W', 'A', 'S', 'D', 'w', 'a', 's', 'd']);
  }

  /**
   * 判定イベントのコールバックを設定
   * @param {Function} callback - (note, judgement, diffMs) => void
   */
  onJudgement(callback) {
    this._onJudgement = callback;
  }

  /**
   * キー入力を処理
   * @param {string} key - 押されたキー
   * @param {number} time - 現在の音楽時刻（秒）
   * @param {import('../chart/Chart.js').Chart} chart - 譜面
   * @returns {Object | null} 判定結果
   */
  processKeyInput(key, time, chart) {
    const upperKey = key.toUpperCase();

    if (!this.validKeys.has(key)) {
      return null;
    }

    const missWindow = this.presetManager.getMissWindow();
    const note = chart.getNoteForKey(upperKey, time, missWindow);

    if (!note) {
      // 対応するノーツがない（空振り）
      return null;
    }

    // 判定実行
    const diffMs = (time - note.t) * 1000;
    const judgement = this.presetManager.judge(diffMs);

    // ノーツを判定済みにする
    note.judged = true;
    note.judgement = judgement;

    // スコアとコンボを更新
    this._updateScore(judgement);

    // コールバック呼び出し
    if (this._onJudgement) {
      this._onJudgement(note, judgement, diffMs);
    }

    return {
      note,
      judgement,
      diffMs,
      score: this.score,
      combo: this.combo
    };
  }

  /**
   * 通過済みノーツを Miss として処理
   * @param {number} time - 現在の音楽時刻（秒）
   * @param {import('../chart/Chart.js').Chart} chart - 譜面
   * @returns {Object[]} Miss判定されたノーツの配列
   */
  processMissedNotes(time, chart) {
    const missWindow = this.presetManager.getMissWindow();
    const missedNotes = chart.getMissedNotes(time, missWindow);
    const results = [];

    missedNotes.forEach(note => {
      note.judged = true;
      note.judgement = 'miss';

      this._updateScore('miss');

      if (this._onJudgement) {
        this._onJudgement(note, 'miss', null);
      }

      results.push({
        note,
        judgement: 'miss',
        diffMs: null,
        score: this.score,
        combo: this.combo
      });
    });

    return results;
  }

  /**
   * スコアとコンボを更新
   * @param {string} judgement
   * @private
   */
  _updateScore(judgement) {
    // カウント更新
    this.counts[judgement]++;

    // スコア加算
    this.score += SCORE_VALUES[judgement];

    // コンボ処理
    if (judgement === 'miss') {
      this.combo = 0;
    } else {
      this.combo++;
      if (this.combo > this.maxCombo) {
        this.maxCombo = this.combo;
      }
    }
  }

  /**
   * 判定プリセットを変更
   * @param {string} presetName
   */
  setPreset(presetName) {
    this.presetManager.setCurrentPreset(presetName);
  }

  /**
   * 現在のプリセット名を取得
   * @returns {string}
   */
  getCurrentPresetName() {
    return this.presetManager.getCurrentPreset().name;
  }

  /**
   * 利用可能なプリセット一覧
   * @returns {string[]}
   */
  getAvailablePresets() {
    return this.presetManager.getAvailablePresets();
  }

  /**
   * 状態をリセット
   */
  reset() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = {
      perfect: 0,
      great: 0,
      good: 0,
      miss: 0
    };
  }

  /**
   * 結果サマリーを取得
   * @returns {Object}
   */
  getResult() {
    return {
      score: this.score,
      maxCombo: this.maxCombo,
      counts: { ...this.counts },
      preset: this.presetManager.getCurrentPreset().name
    };
  }
}
