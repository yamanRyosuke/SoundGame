import { Chart } from './Chart.js';
import { composeNotes } from './AudioAnalysis.js';

export class MusicalChartProvider {
  constructor() {
    this.buffer = null;
    this.analysis = null;
    this.worker = null;
    this.reject = null;
  }

  cancel() {
    this.worker?.terminate();
    this.worker = null;
    this.reject?.(new DOMException('解析をキャンセルしました', 'AbortError'));
    this.reject = null;
  }

  async analyze(buffer, onProgress) {
    if (buffer === this.buffer && this.analysis) return this.analysis;
    this.cancel();
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./analysis.worker.js', import.meta.url), { type: 'module' });
      this.worker = worker;
      this.reject = reject;
      const finish = () => { worker.terminate(); this.worker = null; this.reject = null; };
      worker.onmessage = ({ data }) => {
        if (data.error) { finish(); reject(new Error(data.error)); }
        else if (data.result) { finish(); resolve(data.result); }
        else onProgress?.(data.progress);
      };
      worker.onerror = () => { finish(); reject(new Error('音源解析を開始できませんでした。再試行してください')); };
      const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i).slice());
      worker.postMessage({ channels, sampleRate: buffer.sampleRate }, channels.map(channel => channel.buffer));
    });
    this.buffer = buffer;
    this.analysis = result;
    return result;
  }

  async getChart(audio, lane, buffer, settings, onProgress) {
    const analysis = await this.analyze(buffer, onProgress);
    return new Chart({ audio, laneId: lane.laneId, notes: composeNotes(analysis, settings),
      generation: { algorithm: 'spectral-v1', ...settings, bpm: analysis.bpm, tempoConfidence: analysis.tempoConfidence } });
  }

  getType() { return 'musical'; }
}
