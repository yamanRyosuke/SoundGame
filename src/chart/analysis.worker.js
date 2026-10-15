import { analyzeAudio } from './AudioAnalysis.js';

self.onmessage = ({ data }) => {
  try {
    const result = analyzeAudio(data.channels, data.sampleRate, progress => self.postMessage({ progress }));
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
