/**
 * AudioManager.js
 *
 * 設計意図:
 * - Web Audio API を使用した音源再生管理
 * - audioContext.currentTime を唯一の時間基準として使用
 * - フレーム更新（requestAnimationFrame）とは独立した音同期の基盤
 *
 * 重要な設計判断:
 * - AudioContext はユーザージェスチャー後（play() 呼び出し時）に作成
 * - 再生開始時の audioContext.currentTime をキャプチャ
 * - getCurrentTime() は「再生開始からの経過時間」を返す
 * - これにより、フレームレートに依存しない正確な音同期を実現
 */

export class AudioManager {
  constructor() {
    /** @type {AudioContext | null} */
    this.audioContext = null;

    /** @type {AudioBuffer | null} */
    this.audioBuffer = null;

    /** @type {AudioBufferSourceNode | null} */
    this.sourceNode = null;

    /** @type {GainNode | null} */
    this.gainNode = null;

    // 再生状態
    this.isPlaying = false;

    // ロード完了フラグ
    this.isLoaded = false;

    // 再生開始時刻（audioContext.currentTime 基準）
    this._playStartTime = 0;

    // 一時停止時の位置（将来の拡張用）
    this._pausePosition = 0;

    // 音量
    this.volume = 1.0;

    // 遅延ロード用のデータ保持
    this._pendingAudioData = null;  // ArrayBuffer for real audio
    this._pendingDummyConfig = null; // { duration, frequency } for dummy audio
  }

  /**
   * AudioContext の初期化（ユーザージェスチャー後に呼び出す）
   * @returns {Promise<void>}
   * @private
   */
  async _initAudioContext() {
    if (this.audioContext) {
      // 既存の AudioContext が suspended なら resume
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      return;
    }

    // AudioContext の作成（ブラウザ互換性対応）
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContextClass();

    // GainNode の作成
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.volume;
    this.gainNode.connect(this.audioContext.destination);

    console.log('AudioContext initialized');
  }

  /**
   * 音源ファイルを読み込み（ArrayBuffer のみ取得、デコードは play 時）
   * @param {string} url - 音源ファイルの URL
   * @returns {Promise<number>} 音源の長さ（秒）
   */
  async loadAudio(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load audio: ${response.status} ${response.statusText}`);
    }

    // ArrayBuffer を取得
    const arrayBuffer = await response.arrayBuffer();
    this._pendingAudioData = arrayBuffer;
    this._pendingDummyConfig = null;
    this.audioBuffer = null;
    this.isLoaded = true;

    // duration を取得するために一時的にデコード
    const tempContext = new (window.AudioContext || window.webkitAudioContext)();
    const tempBuffer = await tempContext.decodeAudioData(arrayBuffer.slice(0));
    const duration = tempBuffer.duration;
    tempContext.close();

    console.log(`Audio file fetched: duration=${duration.toFixed(2)}s`);
    return duration;
  }

  /**
   * ダミー音源の設定を保存（生成は play 時）
   * @param {number} duration - 秒
   * @param {number} [frequency=220] - ビープ音の周波数
   * @returns {Promise<void>}
   */
  async loadDummyAudio(duration, frequency = 220) {
    // 設定だけ保持（AudioContext なしでも可能）
    this._pendingDummyConfig = { duration, frequency };
    this._pendingAudioData = null;
    this.isLoaded = true;

    console.log(`Dummy audio configured: duration=${duration}s (will generate on play)`);
  }

  /**
   * File オブジェクトから音源を読み込み
   * @param {File} file - 音源ファイル
   * @returns {Promise<number>} 音源の長さ（秒）
   */
  async loadAudioFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          this._pendingAudioData = e.target.result;
          this._pendingDummyConfig = null;
          this.audioBuffer = null; // 既存のバッファをクリア
          this.isLoaded = true;

          // duration を取得するために一時的にデコード
          const tempContext = new (window.AudioContext || window.webkitAudioContext)();
          const tempBuffer = await tempContext.decodeAudioData(this._pendingAudioData.slice(0));
          const duration = tempBuffer.duration;
          tempContext.close();

          console.log(`Audio file loaded: ${file.name}, duration=${duration.toFixed(2)}s`);
          resolve(duration);
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * 保留中の音源データを実際にデコード/生成
   * @returns {Promise<void>}
   * @private
   */
  async _preparePendingAudio() {
    if (this.audioBuffer) return; // 既に準備済み

    if (this._pendingAudioData) {
      // 実音源のデコード
      this.audioBuffer = await this.audioContext.decodeAudioData(this._pendingAudioData);
      this._pendingAudioData = null;
      console.log(`Audio decoded: duration=${this.audioBuffer.duration.toFixed(2)}s`);
    } else if (this._pendingDummyConfig) {
      // ダミー音源の生成
      const { duration, frequency } = this._pendingDummyConfig;
      this._generateDummyBuffer(duration, frequency);
      this._pendingDummyConfig = null;
      console.log(`Dummy audio generated: duration=${duration}s`);
    }
  }

  /**
   * ダミー音源バッファを生成
   * @param {number} duration
   * @param {number} frequency
   * @private
   */
  _generateDummyBuffer(duration, frequency) {
    const sampleRate = this.audioContext.sampleRate;
    const numSamples = Math.floor(sampleRate * duration);
    this.audioBuffer = this.audioContext.createBuffer(2, numSamples, sampleRate);

    const leftChannel = this.audioBuffer.getChannelData(0);
    const rightChannel = this.audioBuffer.getChannelData(1);

    // ビープ音のパターン（1秒ごとにビープ）
    const beepInterval = 1.0;
    const beepDuration = 0.1;

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const beepPhase = t % beepInterval;

      let amplitude = 0;

      // ビープ音の生成（各秒の開始時）
      if (beepPhase < beepDuration) {
        const env = Math.sin((beepPhase / beepDuration) * Math.PI);
        amplitude = Math.sin(2 * Math.PI * frequency * t) * env * 0.3;
      }

      // 低い持続音（BGM的）
      const bgm = Math.sin(2 * Math.PI * 110 * t) * 0.05;

      const sample = amplitude + bgm;
      leftChannel[i] = sample;
      rightChannel[i] = sample;
    }
  }

  /**
   * 再生を開始（ユーザージェスチャー内で呼び出すこと）
   * @param {number} [offset=0] - 開始位置（秒）
   * @returns {Promise<void>}
   */
  async play(offset = 0) {
    // AudioContext の初期化（ユーザージェスチャー内なので許可される）
    await this._initAudioContext();

    // 保留中の音源を準備
    await this._preparePendingAudio();

    if (!this.audioBuffer) {
      console.warn('AudioManager: No audio loaded');
      return;
    }

    // 既存の sourceNode があれば停止
    this.stop();

    // 新しい AudioBufferSourceNode を作成
    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.connect(this.gainNode);

    // 再生終了時のコールバック
    this.sourceNode.onended = () => {
      this.isPlaying = false;
    };

    // 再生開始時刻を記録
    this._playStartTime = this.audioContext.currentTime - offset;

    // 再生開始
    this.sourceNode.start(0, offset);
    this.isPlaying = true;

    console.log('Audio playback started');
  }

  /**
   * 再生を停止
   */
  stop() {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (e) {
        // 既に停止している場合は無視
      }
      this.sourceNode = null;
    }
    this.isPlaying = false;
    this._pausePosition = 0;
  }

  /**
   * 一時停止（将来の拡張用）
   */
  pause() {
    if (this.isPlaying) {
      this._pausePosition = this.getCurrentTime();
      this.stop();
    }
  }

  /**
   * 一時停止からの再開（将来の拡張用）
   */
  async resume() {
    if (!this.isPlaying && this._pausePosition > 0) {
      await this.play(this._pausePosition);
    }
  }

  /**
   * 現在の再生時刻を取得（唯一の時間基準）
   *
   * @returns {number} 再生開始からの経過時間（秒）
   *
   * 重要:
   * この値を全てのゲームロジックで時間基準として使用する。
   * requestAnimationFrame のタイムスタンプは使用しない。
   */
  getCurrentTime() {
    if (!this.audioContext || !this.isPlaying) {
      return this._pausePosition;
    }

    return this.audioContext.currentTime - this._playStartTime;
  }

  /**
   * 音量を設定
   * @param {number} value - 音量（0.0 ~ 1.0）
   */
  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gainNode) {
      this.gainNode.gain.value = this.volume;
    }
  }

  /**
   * 音源の長さを取得
   * @returns {number} 秒単位
   */
  getDuration() {
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  }

  /**
   * リソースの解放
   */
  dispose() {
    this.stop();

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.audioBuffer = null;
    this._pendingAudioData = null;
    this._pendingDummyConfig = null;
  }
}
