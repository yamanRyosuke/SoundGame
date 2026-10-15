// Decode once for analysis and playback. Failed imports preserve the current song.
export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.audioBuffer = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.isPlaying = false;
    this.isLoaded = false;
    this.volume = 1;
    this._pausePosition = 0;
    this._playStartTime = 0;
    this.meta = null;
  }

  async loadAudio(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`音源を取得できませんでした (${response.status})`);
    return this._decode(await response.arrayBuffer(), url.split('/').pop());
  }

  async loadAudioFromFile(file) {
    if (file.size > 100 * 1024 * 1024) throw new Error('音源ファイルは100 MB以内にしてください');
    return this._decode(await file.arrayBuffer(), file.name);
  }

  async _decode(bytes, name) {
    if (bytes.byteLength > 100 * 1024 * 1024) throw new Error('音源ファイルは100 MB以内にしてください');
    const Context = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoder = new Context(1, 1, 44100);
    const hashBytes = await crypto.subtle.digest('SHA-256', bytes);
    const buffer = await decoder.decodeAudioData(bytes);
    if (!buffer.duration || buffer.duration > 900) throw new Error('音源は15分以内にしてください');
    const hash = Array.from(new Uint8Array(hashBytes), b => b.toString(16).padStart(2, '0')).join('');
    this.stop();
    this.audioBuffer = buffer;
    this.meta = { src: name, name, duration: buffer.duration, hash };
    this.isLoaded = true;
    return buffer.duration;
  }

  async loadDummyAudio(duration, frequency = 220) {
    const context = new window.OfflineAudioContext(1, 1, 44100);
    const buffer = context.createBuffer(1, Math.ceil(44100 * duration), 44100);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) {
      const t = i / 44100, phase = t % 1;
      channel[i] = phase < 0.1 ? Math.sin(2 * Math.PI * frequency * t) * Math.sin(phase * Math.PI / 0.1) * 0.3 : 0;
    }
    this.stop();
    this.audioBuffer = buffer;
    this.meta = { src: 'dummy', name: 'テスト音源', duration, hash: `dummy-${duration}-${frequency}` };
    this.isLoaded = true;
  }

  async play(offset = 0) {
    if (!this.audioBuffer) throw new Error('音源が読み込まれていません');
    if (!this.audioContext) {
      const Context = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new Context();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.volume;
      this.gainNode.connect(this.audioContext.destination);
    }
    // Resume before yielding, while the START click grants playback permission.
    await this.audioContext.resume();
    this.stop();
    const source = this.audioContext.createBufferSource();
    source.buffer = this.audioBuffer;
    source.connect(this.gainNode);
    this.sourceNode = source;
    this._playStartTime = this.audioContext.currentTime - offset;
    this._pausePosition = offset;
    this.isPlaying = true;
    source.onended = () => {
      if (this.sourceNode !== source) return;
      this._pausePosition = this.audioBuffer.duration;
      this.isPlaying = false;
      source.disconnect();
      this.sourceNode = null;
    };
    source.start(0, offset);
  }

  stop() {
    const source = this.sourceNode;
    this.sourceNode = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* already ended */ }
      source.disconnect();
    }
    this.isPlaying = false;
    this._pausePosition = 0;
  }

  pause() {
    const position = this.getCurrentTime();
    this.stop();
    this._pausePosition = position;
  }

  async resume() { if (!this.isPlaying) await this.play(this._pausePosition); }
  getCurrentTime() {
    return this.isPlaying ? Math.min(this.audioBuffer.duration, this.audioContext.currentTime - this._playStartTime) : this._pausePosition;
  }
  getDuration() { return this.audioBuffer?.duration || 0; }
  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gainNode) this.gainNode.gain.value = this.volume;
  }
  dispose() {
    this.stop();
    this.gainNode?.disconnect();
    this.audioContext?.close();
    this.audioContext = null;
    this.audioBuffer = null;
  }
}
