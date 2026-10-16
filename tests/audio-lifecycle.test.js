import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../src/audio/AudioManager.js';

class Context {
  currentTime = 0;
  state = 'running';
  destination = {};
  async resume() {}
  createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
  createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop() {} }; }
  close() {}
}
globalThis.window = {
  AudioContext: Context,
  OfflineAudioContext: class {
    async decodeAudioData(bytes) {
      if (!bytes.byteLength) throw new Error('Invalid audio');
      return { duration: 3 };
    }
  }
};

test('song ending retains final time; replay, stop and pause preserve correct lifecycle', async () => {
  const audio = new AudioManager();
  await audio._decode(new Uint8Array([1, 2, 3]).buffer, 'song.wav');
  await audio.play();
  audio.audioContext.currentTime = 1;
  assert.equal(audio.getCurrentTime(), 1);
  audio.pause();
  assert.equal(audio.getCurrentTime(), 1);
  await audio.resume();
  audio.sourceNode.onended();
  assert.equal(audio.getCurrentTime(), 3);
  await audio.play();
  assert.equal(audio.getCurrentTime(), 0);
  audio.stop();
  assert.equal(audio.getCurrentTime(), 0);
});

test('failed audio import does not invalidate the previous decoded song', async () => {
  const audio = new AudioManager();
  await audio._decode(new Uint8Array([1]).buffer, 'good.wav');
  const buffer = audio.audioBuffer, meta = audio.meta;
  await assert.rejects(audio._decode(new ArrayBuffer(0), 'bad.wav'));
  assert.equal(audio.audioBuffer, buffer);
  assert.equal(audio.meta, meta);
});
