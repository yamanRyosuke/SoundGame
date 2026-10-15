/**
 * main.js
 *
 * One Stroke Rhythm Game - エントリポイント
 */
import './style.css';
import { Game } from './core/Game.js';

// ゲーム設定
const CONFIG = {
  // レーン設定
  laneUrl: './assets/lanes/lane_circle.json',

  // 音源設定（デフォルト音源）
  audioUrl: './assets/audio/BGMsound3.wav',
  useDummyAudio: false,

  // デフォルト BPM（音源に合わせて調整してください）
  defaultBPM: 120,

  // 譜面設定
  chartProvider: 'musical',
  chartUrl: './assets/charts/chart_circle_sample.json'
};

// アプリケーション起動
async function main() {
  const container = document.getElementById('app');

  if (!container) {
    console.error('Container element #app not found');
    return;
  }

  // ゲームインスタンスの作成
  const game = new Game(container);

  // 開発用: グローバルに公開
  if (import.meta.env.DEV) {
    window.game = game;
    console.log('Development mode: game instance available as window.game');
  }

  // ゲームの初期化
  await game.init(CONFIG);

  console.log('Game initialized successfully');
  console.log('Controls: W/A/S/D keys to hit notes');
}

// DOMContentLoaded 後に起動
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
