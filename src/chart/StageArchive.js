import { AudioManager } from '../audio/AudioManager.js';
import { parseStage } from './StageFile.js';
import { FOCUSES } from './AudioAnalysis.js';

const MAGIC = 'SNDSTG01';
const MAX_AUDIO = 100 * 1024 * 1024;
const MAX_META = 2_100_000;

export function validateSavedStage(record) {
  if (!record || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 100 ||
      typeof record.audioName !== 'string' || !record.audioName || record.audioName.length > 500 ||
      typeof record.stageText !== 'string' || record.stageText.length > 2_000_000 ||
      !(record.audioBlob instanceof Blob) || !record.audioBlob.size || record.audioBlob.size > MAX_AUDIO) {
    throw new Error('保存ステージの内容が不正です');
  }
  return record;
}

// A small UTF-8 manifest followed by original audio bytes avoids base64 inflation.
export function createStageArchive(record) {
  validateSavedStage(record);
  const { name, audioName, stageText, options } = record;
  const manifest = new TextEncoder().encode(JSON.stringify({ name, audioName, stageText, options }));
  if (manifest.byteLength > MAX_META) throw new Error('ステージ情報が大きすぎます');
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode(MAGIC));
  new DataView(header.buffer).setUint32(8, manifest.byteLength, true);
  return new Blob([header, manifest, record.audioBlob], { type: 'application/octet-stream' });
}

export async function readStageArchive(file) {
  if (file.size < 13 || file.size > MAX_AUDIO + MAX_META + 12) throw new Error('ステージファイルのサイズが不正です');
  const header = await file.slice(0, 12).arrayBuffer();
  if (new TextDecoder().decode(header.slice(0, 8)) !== MAGIC) throw new Error('音楽入りの .soundstage ファイルを選んでください');
  const length = new DataView(header).getUint32(8, true);
  if (!length || length > MAX_META || 12 + length >= file.size) throw new Error('ステージファイルが壊れています');
  const manifest = JSON.parse(await file.slice(12, 12 + length).text());
  return validateSavedStage({ ...manifest, audioBlob: file.slice(12 + length) });
}

export function savedOptions(options = {}) {
  const pick = (key, choices, fallback) => choices.includes(options?.[key]) ? options[key] : fallback;
  return {
    preset: pick('preset', ['loose', 'normal', 'hard'], 'normal'),
    provider: pick('provider', ['musical', 'auto', 'fixed'], 'musical'),
    difficulty: pick('difficulty', ['easy', 'normal', 'hard'], 'normal'),
    focus: pick('focus', FOCUSES, 'balanced'),
    bpm: Number.isFinite(options?.bpm) && options.bpm >= 60 && options.bpm <= 300 ? options.bpm : 120,
    density: pick('density', ['1', '2', '4'], '1')
  };
}

// Decode and validate off to the side. A corrupt save must not replace the song
// the player already has open, or silently regenerate its chart.
export async function prepareSavedStage(record, supportedLaneIds) {
  validateSavedStage(record);
  const audioManager = new AudioManager();
  try {
    await audioManager._decode(await record.audioBlob.arrayBuffer(), record.audioName);
    const stage = parseStage(record.stageText, audioManager.meta, supportedLaneIds[0], supportedLaneIds);
    return { ...stage, audioManager, options: savedOptions(record.options) };
  } catch (error) {
    audioManager.dispose();
    throw error;
  }
}
