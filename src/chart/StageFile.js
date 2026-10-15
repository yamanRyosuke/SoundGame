import { Chart } from './Chart.js';

export function serializeStage(chart, offsetMs = 0) {
  return JSON.stringify({
    format: 'soundgame-stage', version: 1, audio: chart.audio, laneId: chart.laneId,
    generation: chart.generation, offsetMs,
    notes: chart.notes.map(({ t, type, key }) => ({ t, type, key }))
  }, null, 2);
}

export function parseStage(text, audio, laneId) {
  if (text.length > 2_000_000) throw new Error('譜面ファイルは2 MB以内にしてください');
  const data = JSON.parse(text);
  if (!data || data.format !== 'soundgame-stage' || data.version !== 1) throw new Error('対応していない譜面形式です');
  if (!audio?.hash || data.audio?.hash !== audio.hash) throw new Error('この譜面を作った音源を先に選んでください');
  if (!Number.isFinite(data.audio.duration) || Math.abs(data.audio.duration - audio.duration) > 0.1 || data.laneId !== laneId) throw new Error('音源の長さ、またはレーンが一致しません');
  if (!Array.isArray(data.notes) || data.notes.length > 10000) throw new Error('ノーツ数が不正です');
  let previous = -Infinity;
  for (const note of data.notes) {
    if (!note || !Number.isFinite(note.t) || note.t < 0 || note.t > audio.duration - 0.05 || note.t - previous < 0.05 || note.type !== 'tap' || !['W', 'A', 'S', 'D'].includes(note.key)) throw new Error('ノーツの時刻・種類・キーが不正です');
    previous = note.t;
  }
  if (!Number.isFinite(data.offsetMs) || Math.abs(data.offsetMs) > 250) throw new Error('同期補正が不正です');
  const chart = new Chart({ audio, laneId, notes: data.notes.map(({ t, type, key }) => ({ t, type, key })), generation: data.generation });
  return { chart, offsetMs: data.offsetMs };
}
