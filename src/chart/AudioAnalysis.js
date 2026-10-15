// Pure DSP, shared by the browser worker and synthetic-audio tests.
const SIZE = 1024;
const TARGET_RATE = 22050;
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * p)] || 0;
};

function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const wr = Math.cos(-2 * Math.PI / len), wi = Math.sin(-2 * Math.PI / len);
    for (let i = 0; i < n; i += len) {
      let ar = 1, ai = 0;
      for (let j = 0; j < len / 2; j++) {
        const u = i + j, v = u + len / 2;
        const vr = real[v] * ar - imag[v] * ai;
        const vi = real[v] * ai + imag[v] * ar;
        real[v] = real[u] - vr; imag[v] = imag[u] - vi;
        real[u] += vr; imag[u] += vi;
        [ar, ai] = [ar * wr - ai * wi, ar * wi + ai * wr];
      }
    }
  }
}

export function analyzeAudio(channels, sampleRate, onProgress = () => {}) {
  if (!channels.length || !Number.isFinite(sampleRate) || sampleRate < 8000) throw new Error('音源の形式が不正です');
  const duration = channels[0].length / sampleRate;
  if (!duration || duration > 900) throw new Error('音源は15分以内にしてください');
  // Use the louder channel instead of summing: anti-phase stereo must not vanish.
  const channel = channels.reduce((best, data) => {
    let energy = 0;
    for (let i = 0; i < data.length; i += 64) energy += data[i] * data[i];
    return energy > best.energy ? { data, energy } : best;
  }, { data: channels[0], energy: -1 }).data;
  const rate = Math.min(sampleRate, TARGET_RATE);
  const ratio = sampleRate / rate;
  const samples = new Float32Array(Math.ceil(channel.length / ratio));
  // Area averaging provides low-pass filtering when reducing sample rate.
  for (let i = 0; i < samples.length; i++) {
    let sum = 0, weight = 0;
    const begin = i * ratio, end = Math.min(channel.length, begin + ratio);
    for (let j = Math.floor(begin); j < end; j++) {
      const w = Math.min(j + 1, end) - Math.max(j, begin);
      sum += channel[j] * w; weight += w;
    }
    samples[i] = sum / (weight || 1);
  }
  const hop = Math.round(rate * 0.01), step = hop / rate;
  const frames = Math.ceil(samples.length / hop);
  const flux = Array.from({ length: 3 }, () => new Float32Array(frames));
  const rms = new Float32Array(frames), pitches = new Float32Array(frames);
  const previous = new Float32Array(SIZE / 2);
  const real = new Float64Array(SIZE), imag = new Float64Array(SIZE);
  const window = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (SIZE - 1)));
  for (let f = 0; f < frames; f++) {
    let energy = 0;
    const start = f * hop - SIZE / 2;
    for (let i = 0; i < SIZE; i++) {
      const value = samples[start + i] || 0;
      real[i] = value * window[i]; imag[i] = 0;
      energy += value * value;
    }
    rms[f] = Math.sqrt(energy / SIZE);
    fft(real, imag);
    let strongest = 0, pitch = 0, totalMagnitude = 0;
    for (let k = 2; k < SIZE / 2; k++) {
      const hz = k * rate / SIZE;
      const magnitude = Math.hypot(real[k], imag[k]) / SIZE;
      const compressed = Math.log1p(100 * magnitude);
      const band = hz < 250 ? 0 : hz < 2000 ? 1 : 2;
      flux[band][f] += Math.max(0, compressed - previous[k]);
      previous[k] = compressed;
      if (hz >= 180 && hz <= 1800) {
        totalMagnitude += magnitude;
        if (magnitude > strongest) { strongest = magnitude; pitch = hz; }
      }
    }
    pitches[f] = strongest > totalMagnitude * 0.14 ? 69 + 12 * Math.log2(pitch / 440) : 0;
    if (f % 250 === 0) onProgress(f / frames);
  }
  const scales = flux.map(band => Math.max(1e-6, percentile(band, 0.95)));
  let maximum = 0;
  for (const value of rms) maximum = Math.max(maximum, value);
  const gate = Math.max(0.001, maximum * 0.025);
  const curves = flux.map((band, b) => Float32Array.from(band, v => v / scales[b]));
  const events = [];
  for (let f = 2; f < frames - 2; f++) {
    if (rms[f] < gate) continue;
    let strength = 0;
    const bands = curves.map(curve => curve[f]);
    for (let b = 0; b < 3; b++) {
      const curve = curves[b];
      if (curve[f] < curve[f - 1] || curve[f] <= curve[f + 1]) continue;
      let sum = 0, count = 0;
      for (let j = Math.max(0, f - 20); j <= Math.min(frames - 1, f + 20); j++) { sum += curve[j]; count++; }
      const threshold = sum / count * 1.5 + 0.12;
      if (curve[f] > threshold) strength = Math.max(strength, curve[f] - threshold);
    }
    if (!strength) continue;
    // The flux peak occurs during the attack. Backtrack a few frames to its rising edge.
    const dominant = bands.indexOf(Math.max(...bands));
    let attack = f;
    while (attack > Math.max(0, f - 4) && curves[dominant][attack - 1] > bands[dominant] * 0.15 && curves[dominant][attack - 1] <= curves[dominant][attack]) attack--;
    const t = Math.max(0, attack * step);
    const event = { t, strength, bands, pitch: pitches[Math.min(frames - 1, f + 2)], energy: rms[f] / (maximum || 1) };
    const last = events.at(-1);
    if (last && t - last.t < 0.065) {
      if (strength > last.strength) events[events.length - 1] = event;
    } else events.push(event);
  }
  const tempo = estimateTempo(events);
  onProgress(1);
  return { version: 1, duration, events, ...tempo };
}

function estimateTempo(events) {
  if (events.length < 5) return { bpm: null, tempoConfidence: 0 };
  const histogram = new Float64Array(201);
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < Math.min(i + 9, events.length); j++) {
      const delta = events[j].t - events[i].t;
      if (delta < 0.2 || delta > 2) continue;
      let bpm = 60 / delta;
      while (bpm < 70) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      const bin = Math.round(bpm);
      histogram[bin] += Math.sqrt(events[i].strength * events[j].strength) / (j - i);
    }
  }
  let best = 0, score = 0, total = 0;
  for (let bpm = 70; bpm <= 180; bpm++) {
    const value = histogram[bpm - 1] + histogram[bpm] + histogram[bpm + 1];
    total += histogram[bpm];
    if (value > score) { best = bpm; score = value; }
  }
  return { bpm: best || null, tempoConfidence: total ? Math.min(1, score / total) : 0 };
}

export const DIFFICULTIES = {
  easy: { gap: 0.30, sameKeyGap: 0.45, maxPerSecond: 3, threshold: 0.65 },
  normal: { gap: 0.18, sameKeyGap: 0.30, maxPerSecond: 5, threshold: 0.35 },
  hard: { gap: 0.115, sameKeyGap: 0.23, maxPerSecond: 7, threshold: 0.12 }
};

export function composeNotes(analysis, { difficulty = 'normal', focus = 'balanced' } = {}) {
  const preset = DIFFICULTIES[difficulty];
  if (!preset || !['balanced', 'rhythm', 'melody'].includes(focus)) throw new Error('譜面設定が不正です');
  const weights = focus === 'rhythm' ? [1.5, 0.5, 1.2] : focus === 'melody' ? [0.4, 1.8, 0.4] : [1, 1.1, 0.8];
  const candidates = analysis.events.filter(e => e.t >= 0.5 && e.t <= analysis.duration - 0.25).map(e => ({
    ...e, score: e.strength * (0.4 + e.energy) * (0.5 + Math.max(...e.bands.map((v, i) => v * weights[i])))
  }));
  const reference = percentile(candidates.map(e => e.score), 0.65);
  const accepted = [];
  // Select musical accents first. Enforce spacing and a sliding one-second density cap.
  for (const event of candidates.sort((a, b) => b.score - a.score || a.t - b.t)) {
    if (event.score < reference * preset.threshold) continue;
    if (accepted.some(e => Math.abs(e.t - event.t) < preset.gap)) continue;
    const nearby = accepted.filter(e => Math.abs(e.t - event.t) < 1).map(e => e.t).concat(event.t).sort((a, b) => a - b);
    if (nearby.some((t, i) => i >= preset.maxPerSecond && t - nearby[i - preset.maxPerSecond] < 1)) continue;
    accepted.push(event);
  }
  accepted.sort((a, b) => a.t - b.t);
  const keys = ['A', 'S', 'W', 'D'];
  const notes = [];
  let previousPitch = 0, keyIndex = 0, repeated = 0;
  for (const event of accepted) {
    const last = notes.at(-1);
    const band = event.bands.indexOf(Math.max(...event.bands));
    if (!last || event.t - last.t > 1.2) { keyIndex = band === 0 ? 0 : band === 2 ? 3 : 1; previousPitch = 0; repeated = 0; }
    if (event.pitch && focus !== 'rhythm' && band !== 0) {
      if (previousPitch && Math.abs(event.pitch - previousPitch) >= 1) keyIndex = Math.max(0, Math.min(3, keyIndex + Math.sign(event.pitch - previousPitch)));
      else if (!previousPitch) keyIndex = Math.round(event.pitch) % 4;
      previousPitch = event.pitch;
    } else keyIndex = band === 0 ? 0 : band === 2 ? 3 : 1;
    if (last?.key === keys[keyIndex]) repeated++; else repeated = 0;
    if (last?.key === keys[keyIndex] && (event.t - last.t < preset.sameKeyGap || repeated >= 2)) {
      keyIndex = (keyIndex + 1) % 4; repeated = 0;
    }
    notes.push({ t: Number(event.t.toFixed(4)), type: 'tap', key: keys[keyIndex] });
  }
  return notes;
}
