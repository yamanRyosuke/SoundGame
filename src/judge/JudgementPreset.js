/**
 * JudgementPreset.js
 *
 * 設計意図:
 * - 判定基準のプリセット定義
 * - 難易度に応じた判定ウィンドウの切り替え
 * - 拡張可能な構造（カスタムプリセット追加可能）
 */

/**
 * 判定ウィンドウ（ミリ秒）
 * @typedef {Object} JudgementWindows
 * @property {number} perfect - Perfect 判定の閾値
 * @property {number} [great] - Great 判定の閾値
 * @property {number} [good] - Good 判定の閾値
 * @property {number} miss - Miss 判定の閾値（これを超えると Miss）
 */

/**
 * 判定プリセット
 * @typedef {Object} JudgementPreset
 * @property {string} name - プリセット名
 * @property {JudgementWindows} windowsMs - 判定ウィンドウ（ミリ秒）
 */

/**
 * 定義済みプリセット
 */
export const PRESETS = {
  /** 緩い判定（初心者向け） */
  loose: {
    name: 'Loose',
    windowsMs: {
      perfect: 80,
      great: 140,
      good: 200,
      miss: 200
    }
  },

  /** 標準判定 */
  normal: {
    name: 'Normal',
    windowsMs: {
      perfect: 40,
      great: 80,
      good: 120,
      miss: 120
    }
  },

  /** 厳しい判定（上級者向け） */
  hard: {
    name: 'Hard',
    windowsMs: {
      perfect: 25,
      great: 50,
      good: 80,
      miss: 80
    }
  }
};

/**
 * 判定プリセットマネージャー
 */
export class JudgementPresetManager {
  constructor() {
    /** @type {Object<string, JudgementPreset>} */
    this.presets = { ...PRESETS };

    /** @type {JudgementPreset} */
    this.currentPreset = this.presets.normal;
  }

  /**
   * プリセットを取得
   * @param {string} name - プリセット名
   * @returns {JudgementPreset | null}
   */
  getPreset(name) {
    return this.presets[name] || null;
  }

  /**
   * 現在のプリセットを設定
   * @param {string} name - プリセット名
   * @returns {boolean} 成功したか
   */
  setCurrentPreset(name) {
    const preset = this.presets[name];
    if (preset) {
      this.currentPreset = preset;
      console.log(`Judgement preset changed to: ${preset.name}`);
      return true;
    }
    console.warn(`Preset not found: ${name}`);
    return false;
  }

  /**
   * 現在のプリセットを取得
   * @returns {JudgementPreset}
   */
  getCurrentPreset() {
    return this.currentPreset;
  }

  /**
   * カスタムプリセットを追加
   * @param {string} key - プリセットキー
   * @param {JudgementPreset} preset - プリセットデータ
   */
  addPreset(key, preset) {
    this.presets[key] = preset;
  }

  /**
   * 利用可能なプリセット名一覧を取得
   * @returns {string[]}
   */
  getAvailablePresets() {
    return Object.keys(this.presets);
  }

  /**
   * 時間差から判定結果を取得
   * @param {number} diffMs - 判定時刻との差（ミリ秒、絶対値）
   * @returns {string} 判定結果（'perfect', 'great', 'good', 'miss'）
   */
  judge(diffMs) {
    const windows = this.currentPreset.windowsMs;
    const absDiff = Math.abs(diffMs);

    if (absDiff <= windows.perfect) return 'perfect';
    if (windows.great && absDiff <= windows.great) return 'great';
    if (windows.good && absDiff <= windows.good) return 'good';
    return 'miss';
  }

  /**
   * Miss判定の閾値を取得（ミリ秒）
   * @returns {number}
   */
  getMissWindow() {
    return this.currentPreset.windowsMs.miss;
  }
}
