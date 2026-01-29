/**
 * Game.js
 *
 * 設計意図:
 * - ゲーム全体のライフサイクルを管理するメインコントローラ
 * - フレーム更新（requestAnimationFrame）と音同期は明確に分離
 * - AudioManager から取得した audioTime を唯一の時間基準として使用
 * - 各サブシステム（Lane, Player, Chart, Judge, Notes）を統合
 */
import { GameRenderer } from './GameRenderer.js';
import { AudioManager } from '../audio/AudioManager.js';
import { LaneLoader } from '../lane/LaneLoader.js';
import { ArcLengthTable } from '../lane/ArcLengthTable.js';
import { LaneRenderer } from '../lane/LaneRenderer.js';
import { PlayerCursor } from '../player/PlayerCursor.js';
import { JudgeManager } from '../judge/JudgeManager.js';
import { NoteRenderer } from '../notes/NoteRenderer.js';
import { FixedChartProvider } from '../chart/FixedChartProvider.js';
import { AutoChartProvider } from '../chart/AutoChartProvider.js';

export class Game {
  /**
   * @param {HTMLElement} container - ゲームを描画するコンテナ
   */
  constructor(container) {
    this.container = container;

    // Core systems
    this.renderer = null;
    this.audioManager = null;

    // Lane data
    this.laneData = null;
    this.arcLengthTable = null;
    this.laneRenderer = null;

    // Player
    this.playerCursor = null;

    // Chart & Judge
    this.chart = null;
    this.chartProvider = null;
    this.judgeManager = null;
    this.noteRenderer = null;

    // Game state
    this.isRunning = false;
    this.isLoaded = false;
    this.audioDuration = 0;

    // Config
    this.config = null;

    // UI elements
    this.timeDisplay = null;
    this.scoreDisplay = null;
    this.comboDisplay = null;
    this.judgementDisplay = null;
    this.startButton = null;
    this.presetSelect = null;
    this.providerSelect = null;
    this.audioFileInput = null;
    this.bpmInput = null;
    this.notesPerBeatSelect = null;
    this.audioFileName = null;

    // Custom audio settings
    this.customBPM = 120;
    this.customNotesPerBeat = 1;

    // Animation frame ID
    this._animationFrameId = null;

    // Key event handler
    this._boundKeyDown = this._onKeyDown.bind(this);
  }

  /**
   * ゲームの初期化とリソースのロード
   * @param {Object} config - ゲーム設定
   */
  async init(config) {
    this.config = config;

    // UI の作成
    this._createUI();
    this._showLoading(true);

    try {
      // Renderer の初期化
      this.renderer = new GameRenderer(this.container);

      // AudioManager の初期化
      this.audioManager = new AudioManager();

      // JudgeManager の初期化
      this.judgeManager = new JudgeManager();
      this.judgeManager.onJudgement((note, judgement, diffMs) => {
        this._onJudgement(note, judgement, diffMs);
      });

      // レーンデータのロード
      this.laneData = await LaneLoader.load(config.laneUrl);

      // 音源の設定（ダミーまたは実ファイル）
      if (config.useDummyAudio) {
        this.audioDuration = config.audioDuration;
        await this.audioManager.loadDummyAudio(config.audioDuration);
      } else if (config.audioUrl) {
        // 音源をロードして duration を自動取得
        this.audioDuration = await this.audioManager.loadAudio(config.audioUrl);
      } else {
        throw new Error('Either audioUrl or useDummyAudio must be specified');
      }

      // BPM のデフォルト値を設定
      this.customBPM = config.defaultBPM || 120;

      // 弧長テーブルの構築
      this.arcLengthTable = new ArcLengthTable(this.laneData.points);

      // レーンの描画
      this.laneRenderer = new LaneRenderer(this.laneData.points);
      this.renderer.add(this.laneRenderer.getObject());

      // プレイヤーカーソルの初期化
      this.playerCursor = new PlayerCursor();
      this.renderer.add(this.playerCursor.getObject());

      // NoteRenderer の初期化
      this.noteRenderer = new NoteRenderer(this.arcLengthTable, this.audioDuration);
      this.renderer.add(this.noteRenderer.getObject());

      // ChartProvider の設定
      await this._setupChartProvider(config.chartProvider || 'auto');

      // 初期位置に配置
      const startPos = this.arcLengthTable.getPositionAtDistance(0);
      const startDir = this.arcLengthTable.getDirectionAtDistance(0);
      this.playerCursor.setPosition(startPos);
      this.playerCursor.setDirection(startDir);

      this.isLoaded = true;
      this._showLoading(false);
      this._showStartButton(true);

      // キーイベントを登録（ズーム操作用）
      document.addEventListener('keydown', this._boundKeyDown);

      // 最初のレンダリング
      this.renderer.render();

    } catch (error) {
      console.error('Game initialization failed:', error);
      this._showError('Failed to load game resources: ' + error.message);
    }
  }

  /**
   * ChartProvider を設定
   * @param {string} type - 'fixed' or 'auto'
   * @private
   */
  async _setupChartProvider(type) {
    const audioMeta = {
      src: this.config.audioUrl,
      duration: this.audioDuration
    };

    if (type === 'fixed' && this.config.chartUrl) {
      this.chartProvider = new FixedChartProvider(this.config.chartUrl);
    } else {
      this.chartProvider = new AutoChartProvider({
        bpm: this.customBPM,
        notesPerBeat: this.customNotesPerBeat,
        startOffset: 1.0,
        endOffset: 1.0,
        pattern: 'sequential'
      });
    }

    // 譜面を取得
    this.chart = await this.chartProvider.getChart(audioMeta, this.laneData);

    // NoteRenderer の duration を更新
    this.noteRenderer.audioDuration = this.audioDuration;
    this.noteRenderer.totalLength = this.arcLengthTable.getTotalLength();

    // ノーツを描画
    this.noteRenderer.createNotes(this.chart);

    console.log(`Chart loaded (${this.chartProvider.getType()}): ${this.chart.getTotalNotes()} notes`);
  }

  /**
   * ChartProvider を切り替え
   * @param {string} type - 'fixed' or 'auto'
   */
  async switchChartProvider(type) {
    if (this.isRunning) return;

    await this._setupChartProvider(type);
    this.judgeManager.reset();
    this._updateScoreDisplay();
    this.renderer.render();
  }

  /**
   * カスタム音源ファイルを読み込み
   * @param {File} file
   */
  async loadCustomAudio(file) {
    if (this.isRunning) return;

    this._showLoading(true);
    this._showStartButton(false);

    try {
      // 音源を読み込み、duration を取得
      const duration = await this.audioManager.loadAudioFromFile(file);
      this.audioDuration = duration;

      // ファイル名を表示
      if (this.audioFileName) {
        this.audioFileName.textContent = file.name;
      }

      // 譜面を再生成
      await this._setupChartProvider('auto');
      this.judgeManager.reset();
      this._updateScoreDisplay();

      // 初期位置に戻す
      const startPos = this.arcLengthTable.getPositionAtDistance(0);
      const startDir = this.arcLengthTable.getDirectionAtDistance(0);
      this.playerCursor.setPosition(startPos);
      this.playerCursor.setDirection(startDir);

      this.renderer.render();
      this._showLoading(false);
      this._showStartButton(true);

      console.log(`Custom audio loaded: ${file.name}, duration=${duration.toFixed(2)}s`);
    } catch (error) {
      console.error('Failed to load custom audio:', error);
      this._showLoading(false);
      this._showStartButton(true);
      alert('音源ファイルの読み込みに失敗しました');
    }
  }

  /**
   * BPM を変更して譜面を再生成
   * @param {number} bpm
   * @param {number} notesPerBeat
   */
  async updateBPM(bpm, notesPerBeat) {
    if (this.isRunning) return;

    this.customBPM = bpm;
    this.customNotesPerBeat = notesPerBeat;

    await this._setupChartProvider('auto');
    this.judgeManager.reset();
    this._updateScoreDisplay();
    this.renderer.render();

    console.log(`BPM updated: ${bpm}, notesPerBeat: ${notesPerBeat}`);
  }

  /**
   * ゲームを開始（ユーザークリックから呼び出される）
   */
  async start() {
    if (!this.isLoaded || this.isRunning) return;

    this._showStartButton(false);
    this._showLoading(true);

    try {
      // 譜面とスコアをリセット
      this.chart.reset();
      this.judgeManager.reset();
      this.noteRenderer.createNotes(this.chart);
      this._updateScoreDisplay();

      // 音楽再生開始
      await this.audioManager.play();

      this.isRunning = true;
      this._showLoading(false);

      // ゲームループ開始
      this._gameLoop();
    } catch (error) {
      console.error('Failed to start game:', error);
      this._showLoading(false);
      this._showStartButton(true);
    }
  }

  /**
   * ゲームを停止
   */
  stop() {
    this.isRunning = false;

    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }

    this.audioManager.stop();

    // 結果を表示
    const result = this.judgeManager.getResult();
    console.log('Game Result:', result);
  }

  /**
   * キー入力ハンドラ
   * @param {KeyboardEvent} e
   * @private
   */
  _onKeyDown(e) {
    const key = e.key.toUpperCase();

    // ズーム操作（ゲーム中でも操作可能）
    if (key === 'Q') {
      this.renderer.zoomOut(0.2);
      this._updateZoomDisplay();
      this.renderer.render();
      return;
    }
    if (key === 'E') {
      this.renderer.zoomIn(0.2);
      this._updateZoomDisplay();
      this.renderer.render();
      return;
    }

    // ゲーム中のノーツ入力
    if (!this.isRunning) return;
    if (!['W', 'A', 'S', 'D'].includes(key)) return;

    const audioTime = this.audioManager.getCurrentTime();
    this.judgeManager.processKeyInput(key, audioTime, this.chart);
  }

  /**
   * 判定コールバック
   * @param {Object} note
   * @param {string} judgement
   * @param {number|null} diffMs
   * @private
   */
  _onJudgement(note, judgement, diffMs) {
    // エフェクト表示
    this.noteRenderer.showJudgementEffect(note, judgement);

    // UI 更新
    this._updateScoreDisplay();
    this._showJudgement(judgement, diffMs);
  }

  /**
   * ゲームループ
   * @private
   */
  _gameLoop() {
    if (!this.isRunning) return;

    this._animationFrameId = requestAnimationFrame(() => this._gameLoop());

    // 音楽の現在時刻を取得（唯一の時間基準）
    const audioTime = this.audioManager.getCurrentTime();

    // 進捗率を計算
    const progress = Math.min(audioTime / this.audioDuration, 1.0);

    // Miss判定（通過済みノーツ）
    this.judgeManager.processMissedNotes(audioTime, this.chart);

    // プレイヤーカーソルの位置を更新
    this._updatePlayerPosition(progress);

    // ノーツ表示を更新
    this.noteRenderer.update(this.chart);

    // UI 更新
    this._updateTimeDisplay(audioTime);
    this._updateScoreDisplay();

    // レンダリング
    this.renderer.render();

    // 曲が終了したら停止
    if (progress >= 1.0) {
      this.stop();
      this._showStartButton(true);
      this._showResult();
    }
  }

  /**
   * プレイヤーカーソルの位置を更新
   * @param {number} progress - 進捗率 (0.0 ~ 1.0)
   * @private
   */
  _updatePlayerPosition(progress) {
    const totalLength = this.arcLengthTable.getTotalLength();
    const distance = totalLength * progress;

    const position = this.arcLengthTable.getPositionAtDistance(distance);
    const direction = this.arcLengthTable.getDirectionAtDistance(distance);

    this.playerCursor.setPosition(position);
    this.playerCursor.setDirection(direction);
  }

  /**
   * UI 要素の作成
   * @private
   */
  _createUI() {
    // Overlay container
    const overlay = document.createElement('div');
    overlay.id = 'ui-overlay';
    this.container.appendChild(overlay);

    // 左上: 時間・スコア
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    overlay.appendChild(leftPanel);

    this.timeDisplay = document.createElement('div');
    this.timeDisplay.id = 'time-display';
    this.timeDisplay.textContent = '00:00.000';
    leftPanel.appendChild(this.timeDisplay);

    this.scoreDisplay = document.createElement('div');
    this.scoreDisplay.id = 'time-display';
    this.scoreDisplay.textContent = 'Score: 0';
    leftPanel.appendChild(this.scoreDisplay);

    this.comboDisplay = document.createElement('div');
    this.comboDisplay.id = 'time-display';
    this.comboDisplay.textContent = 'Combo: 0';
    leftPanel.appendChild(this.comboDisplay);

    // 右上: 設定
    const rightPanel = document.createElement('div');
    rightPanel.style.cssText = 'position:fixed;top:16px;right:16px;display:flex;flex-direction:column;gap:8px;pointer-events:auto;';
    this.container.appendChild(rightPanel);

    // プリセット選択
    const presetLabel = document.createElement('label');
    presetLabel.style.cssText = 'color:#fff;font-size:12px;';
    presetLabel.textContent = 'Judgement:';
    rightPanel.appendChild(presetLabel);

    this.presetSelect = document.createElement('select');
    this.presetSelect.style.cssText = 'padding:4px;';
    ['loose', 'normal', 'hard'].forEach(preset => {
      const opt = document.createElement('option');
      opt.value = preset;
      opt.textContent = preset.charAt(0).toUpperCase() + preset.slice(1);
      if (preset === 'normal') opt.selected = true;
      this.presetSelect.appendChild(opt);
    });
    this.presetSelect.addEventListener('change', () => {
      this.judgeManager.setPreset(this.presetSelect.value);
    });
    rightPanel.appendChild(this.presetSelect);

    // Provider 選択
    const providerLabel = document.createElement('label');
    providerLabel.style.cssText = 'color:#fff;font-size:12px;margin-top:8px;';
    providerLabel.textContent = 'Chart:';
    rightPanel.appendChild(providerLabel);

    this.providerSelect = document.createElement('select');
    this.providerSelect.style.cssText = 'padding:4px;';
    ['auto', 'fixed'].forEach(type => {
      const opt = document.createElement('option');
      opt.value = type;
      opt.textContent = type.charAt(0).toUpperCase() + type.slice(1);
      this.providerSelect.appendChild(opt);
    });
    this.providerSelect.addEventListener('change', () => {
      this.switchChartProvider(this.providerSelect.value);
    });
    rightPanel.appendChild(this.providerSelect);

    // --- 音源ファイル選択 ---
    const audioLabel = document.createElement('label');
    audioLabel.style.cssText = 'color:#fff;font-size:12px;margin-top:12px;border-top:1px solid #444;padding-top:12px;';
    audioLabel.textContent = 'Custom Audio:';
    rightPanel.appendChild(audioLabel);

    this.audioFileInput = document.createElement('input');
    this.audioFileInput.type = 'file';
    this.audioFileInput.accept = 'audio/*';
    this.audioFileInput.style.cssText = 'width:100%;font-size:11px;';
    this.audioFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.loadCustomAudio(file);
      }
    });
    rightPanel.appendChild(this.audioFileInput);

    this.audioFileName = document.createElement('div');
    this.audioFileName.style.cssText = 'color:#aaa;font-size:10px;word-break:break-all;';
    this.audioFileName.textContent = 'No file selected';
    rightPanel.appendChild(this.audioFileName);

    // --- BPM 入力 ---
    const bpmLabel = document.createElement('label');
    bpmLabel.style.cssText = 'color:#fff;font-size:12px;margin-top:8px;';
    bpmLabel.textContent = 'BPM:';
    rightPanel.appendChild(bpmLabel);

    const bpmRow = document.createElement('div');
    bpmRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
    rightPanel.appendChild(bpmRow);

    this.bpmInput = document.createElement('input');
    this.bpmInput.type = 'number';
    this.bpmInput.min = '60';
    this.bpmInput.max = '300';
    this.bpmInput.value = '120';
    this.bpmInput.style.cssText = 'width:60px;padding:4px;';
    bpmRow.appendChild(this.bpmInput);

    // Notes per beat 選択
    this.notesPerBeatSelect = document.createElement('select');
    this.notesPerBeatSelect.style.cssText = 'padding:4px;';
    [
      { value: 1, label: '4分' },
      { value: 2, label: '8分' },
      { value: 4, label: '16分' }
    ].forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      this.notesPerBeatSelect.appendChild(option);
    });
    bpmRow.appendChild(this.notesPerBeatSelect);

    // Apply BPM ボタン
    const applyBpmBtn = document.createElement('button');
    applyBpmBtn.textContent = 'Apply';
    applyBpmBtn.style.cssText = 'padding:4px 8px;font-size:11px;cursor:pointer;';
    applyBpmBtn.addEventListener('click', () => {
      const bpm = parseInt(this.bpmInput.value, 10);
      const notesPerBeat = parseInt(this.notesPerBeatSelect.value, 10);
      if (bpm >= 60 && bpm <= 300) {
        this.updateBPM(bpm, notesPerBeat);
      }
    });
    bpmRow.appendChild(applyBpmBtn);

    // --- ズーム設定 ---
    const zoomLabel = document.createElement('label');
    zoomLabel.style.cssText = 'color:#fff;font-size:12px;margin-top:12px;border-top:1px solid #444;padding-top:12px;';
    zoomLabel.textContent = 'Zoom (Q/E):';
    rightPanel.appendChild(zoomLabel);

    const zoomRow = document.createElement('div');
    zoomRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
    rightPanel.appendChild(zoomRow);

    // ズームアウトボタン
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.textContent = '−';
    zoomOutBtn.style.cssText = 'padding:4px 10px;font-size:14px;cursor:pointer;';
    zoomOutBtn.addEventListener('click', () => {
      this.renderer.zoomOut(0.2);
      this._updateZoomDisplay();
      this.renderer.render();
    });
    zoomRow.appendChild(zoomOutBtn);

    // ズームスライダー
    this.zoomSlider = document.createElement('input');
    this.zoomSlider.type = 'range';
    this.zoomSlider.min = '0.3';
    this.zoomSlider.max = '2.0';
    this.zoomSlider.step = '0.1';
    this.zoomSlider.value = '1.0';
    this.zoomSlider.style.cssText = 'width:80px;';
    this.zoomSlider.addEventListener('input', () => {
      this.renderer.setZoom(parseFloat(this.zoomSlider.value));
      this._updateZoomDisplay();
      this.renderer.render();
    });
    zoomRow.appendChild(this.zoomSlider);

    // ズームインボタン
    const zoomInBtn = document.createElement('button');
    zoomInBtn.textContent = '+';
    zoomInBtn.style.cssText = 'padding:4px 10px;font-size:14px;cursor:pointer;';
    zoomInBtn.addEventListener('click', () => {
      this.renderer.zoomIn(0.2);
      this._updateZoomDisplay();
      this.renderer.render();
    });
    zoomRow.appendChild(zoomInBtn);

    // ズーム表示
    this.zoomDisplay = document.createElement('span');
    this.zoomDisplay.style.cssText = 'color:#fff;font-size:11px;min-width:35px;';
    this.zoomDisplay.textContent = '100%';
    zoomRow.appendChild(this.zoomDisplay);

    // 判定表示（中央）
    this.judgementDisplay = document.createElement('div');
    this.judgementDisplay.style.cssText = `
      position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);
      font-size:32px;font-weight:bold;color:#fff;
      text-shadow:0 0 10px rgba(0,0,0,0.8);
      pointer-events:none;opacity:0;transition:opacity 0.1s;
    `;
    this.container.appendChild(this.judgementDisplay);

    // Start button
    this.startButton = document.createElement('button');
    this.startButton.id = 'start-button';
    this.startButton.textContent = 'START';
    this.startButton.style.display = 'none';
    this.startButton.addEventListener('click', () => this.start());
    this.container.appendChild(this.startButton);

    // Loading indicator
    this.loadingIndicator = document.createElement('div');
    this.loadingIndicator.id = 'loading';
    this.loadingIndicator.textContent = 'Loading...';
    this.loadingIndicator.style.display = 'none';
    this.container.appendChild(this.loadingIndicator);
  }

  /**
   * ズーム表示を更新
   * @private
   */
  _updateZoomDisplay() {
    const zoom = this.renderer.getZoom();
    this.zoomSlider.value = zoom.toString();
    this.zoomDisplay.textContent = `${Math.round(zoom * 100)}%`;
  }

  /**
   * 時間表示を更新
   * @param {number} time
   * @private
   */
  _updateTimeDisplay(time) {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const milliseconds = Math.floor((time % 1) * 1000);
    this.timeDisplay.textContent =
      `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
  }

  /**
   * スコア表示を更新
   * @private
   */
  _updateScoreDisplay() {
    this.scoreDisplay.textContent = `Score: ${this.judgeManager.score}`;
    this.comboDisplay.textContent = `Combo: ${this.judgeManager.combo}`;
  }

  /**
   * 判定を表示
   * @param {string} judgement
   * @param {number|null} diffMs
   * @private
   */
  _showJudgement(judgement, diffMs) {
    const colors = {
      perfect: '#ffff00',
      great: '#00ff00',
      good: '#00ffff',
      miss: '#ff0000'
    };

    this.judgementDisplay.textContent = judgement.toUpperCase();
    this.judgementDisplay.style.color = colors[judgement] || '#fff';
    this.judgementDisplay.style.opacity = '1';

    setTimeout(() => {
      this.judgementDisplay.style.opacity = '0';
    }, 200);
  }

  /**
   * 結果を表示
   * @private
   */
  _showResult() {
    const result = this.judgeManager.getResult();
    alert(`
Game Over!

Score: ${result.score}
Max Combo: ${result.maxCombo}

Perfect: ${result.counts.perfect}
Great: ${result.counts.great}
Good: ${result.counts.good}
Miss: ${result.counts.miss}
    `.trim());
  }

  /**
   * ローディング表示の切り替え
   * @param {boolean} show
   * @private
   */
  _showLoading(show) {
    if (this.loadingIndicator) {
      this.loadingIndicator.style.display = show ? 'block' : 'none';
    }
  }

  /**
   * スタートボタンの表示切り替え
   * @param {boolean} show
   * @private
   */
  _showStartButton(show) {
    if (this.startButton) {
      this.startButton.style.display = show ? 'block' : 'none';
    }
  }

  /**
   * エラー表示
   * @param {string} message
   * @private
   */
  _showError(message) {
    this._showLoading(false);
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#f55;font-size:16px;text-align:center;max-width:80%;';
    errorDiv.textContent = message;
    this.container.appendChild(errorDiv);
  }

  /**
   * リソースの解放
   */
  dispose() {
    this.stop();
    document.removeEventListener('keydown', this._boundKeyDown);
    if (this.renderer) this.renderer.dispose();
    if (this.audioManager) this.audioManager.dispose();
    if (this.noteRenderer) this.noteRenderer.dispose();
  }
}
