/**
 * DummyAudioGenerator.js
 *
 * 設計意図:
 * - 開発・テスト用のダミー音源を生成
 * - 実際の音源ファイルがなくても動作確認可能にする
 * - Web Audio API で直接 AudioBuffer を生成
 */

/**
 * ダミー音源（サイン波のビープ音）を生成
 * @param {AudioContext} audioContext
 * @param {number} duration - 秒
 * @param {number} [frequency=440] - 周波数 Hz
 * @returns {AudioBuffer}
 */
export function generateDummyAudio(audioContext, duration, frequency = 220) {
  const sampleRate = audioContext.sampleRate;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = audioContext.createBuffer(2, numSamples, sampleRate);

  const leftChannel = buffer.getChannelData(0);
  const rightChannel = buffer.getChannelData(1);

  // ビープ音のパターン（1秒ごとにビープ）
  const beepInterval = 1.0; // 秒
  const beepDuration = 0.1; // 秒
  const beepSamples = Math.floor(beepDuration * sampleRate);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const beepPhase = t % beepInterval;

    let amplitude = 0;

    // ビープ音の生成（各秒の開始時）
    if (beepPhase < beepDuration) {
      // エンベロープ（フェードイン・アウト）
      const env = Math.sin((beepPhase / beepDuration) * Math.PI);
      amplitude = Math.sin(2 * Math.PI * frequency * t) * env * 0.3;
    }

    // 低い持続音（BGM的）
    const bgmFreq = 110;
    const bgm = Math.sin(2 * Math.PI * bgmFreq * t) * 0.05;

    const sample = amplitude + bgm;
    leftChannel[i] = sample;
    rightChannel[i] = sample;
  }

  return buffer;
}

/**
 * AudioManager 用のダミー音源ローダー
 * 音源ファイルの代わりにこの関数で AudioBuffer を生成できる
 */
export class DummyAudioProvider {
  /**
   * @param {number} duration - 秒
   */
  constructor(duration) {
    this.duration = duration;
  }

  /**
   * AudioBuffer を生成
   * @param {AudioContext} audioContext
   * @returns {AudioBuffer}
   */
  createBuffer(audioContext) {
    return generateDummyAudio(audioContext, this.duration);
  }
}
