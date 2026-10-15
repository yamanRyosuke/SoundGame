import { GameRenderer } from './GameRenderer.js';
import { AudioManager } from '../audio/AudioManager.js';
import { LaneLoader } from '../lane/LaneLoader.js';
import { ArcLengthTable } from '../lane/ArcLengthTable.js';
import { ParallelLanes } from '../lane/ParallelLanes.js';
import { laneForKey } from '../lane/LaneLayout.js';
import { LaneRenderer } from '../lane/LaneRenderer.js';
import { PlayerCursor } from '../player/PlayerCursor.js';
import { JudgeManager } from '../judge/JudgeManager.js';
import { NoteRenderer } from '../notes/NoteRenderer.js';
import { FixedChartProvider } from '../chart/FixedChartProvider.js';
import { AutoChartProvider } from '../chart/AutoChartProvider.js';
import { MusicalChartProvider } from '../chart/MusicalChartProvider.js';
import { serializeStage, parseStage } from '../chart/StageFile.js';

export class Game {
  constructor(container) {
    this.container = container;
    this.isRunning = false;
    this.isBusy = false;
    this.isLoaded = false;
    this.chart = null;
    this.offsetMs = 0;
    this.laneCount = 4;
    this.musicalProvider = new MusicalChartProvider();
    this._boundKeyDown = this._onKeyDown.bind(this);
    this._animationFrameId = null;
  }

  async init(config) {
    this.config = config;
    this._createUI();
    await this._runTask(async () => {
      this.renderer = new GameRenderer(this.container);
      this.audioManager = new AudioManager();
      this.judgeManager = new JudgeManager();
      this.judgeManager.onJudgement((note, judgement, diffMs) => {
        this.noteRenderer.showJudgementEffect(note, judgement);
        const timing = Number.isFinite(diffMs) ? ` ${diffMs < 0 ? '早い' : '遅い'} ${Math.abs(Math.round(diffMs))} ms` : '';
        this.judgementDisplay.textContent = judgement.toUpperCase() + timing;
        this.judgementDisplay.dataset.judgement = judgement;
        this._updateScoreDisplay();
      });
      this.laneData = await LaneLoader.load(config.laneUrl);
      this.arcLengthTable = new ArcLengthTable(this.laneData.points);
      this._setLaneCount(this.laneCount);
      this.noteRenderer = new NoteRenderer(this.parallelLanes, 1);
      this.renderer.add(this.noteRenderer.getObject());
      document.addEventListener('keydown', this._boundKeyDown);
      this.isLoaded = true;
      if (config.useDummyAudio) await this.audioManager.loadDummyAudio(config.audioDuration);
      else await this.audioManager.loadAudio(config.audioUrl);
      this.audioDuration = this.audioManager.getDuration();
      await this._generate();
    });
  }

  settings() { return { difficulty: this.difficultySelect.value, focus: this.focusSelect.value }; }

  _setLaneCount(count) {
    const layout = new ParallelLanes(this.arcLengthTable, count);
    const renderer = new LaneRenderer(layout);
    const cursor = new PlayerCursor(layout.lanes);
    for (const previous of [this.laneRenderer, this.playerCursor]) {
      if (previous) { this.renderer.remove(previous.getObject()); previous.dispose(); }
    }
    this.parallelLanes = layout;
    this.laneRenderer = renderer;
    this.playerCursor = cursor;
    this.laneCount = count;
    this.renderer.add(renderer.getObject());
    this.renderer.add(cursor.getObject());
    if (this.noteRenderer) this.noteRenderer.parallelLanes = layout;
    this.laneCountSelect.value = String(count);
    this.laneMapping.textContent = '内側から：' + layout.lanes.map(lane => lane.label).join(' ｜ ');
    this.laneLegend.innerHTML = layout.lanes.map(lane => '<span class="lane-group">' + lane.keys.map(key =>
      `<span style="color:#${laneForKey(key).color.toString(16).padStart(6, '0')}">${key}</span>`).join(' ') + '</span>').join('');
    this.timingCanvas.setAttribute('aria-label', `${count}レーンの次に押すキーとタイミング`);
    this._updatePlayerPosition(0);
  }

  setLaneCount(count) {
    if (this.isRunning || this.isBusy || !this.isLoaded) return;
    this._setLaneCount(count);
    // Reposition the existing notes; never regenerate or change their keys/times.
    if (this.chart) this._useChart(this.chart);
    else { this._drawTiming(0); this.renderer.render(); }
  }

  async _generate() {
    if (!this.audioManager.audioBuffer) throw new Error('音源を先に選んでください');
    const audio = this.audioManager.meta;
    const type = this.providerSelect.value;
    let chart;
    if (type === 'musical') {
      this.cancelButton.hidden = false;
      chart = await this.musicalProvider.getChart(audio, this.laneData, this.audioManager.audioBuffer, this.settings(), p => {
        this.status.textContent = `音源を解析中… ${Math.round(p * 100)}%`;
      });
    } else {
      const provider = type === 'fixed' ? new FixedChartProvider(this.config.chartUrl) : new AutoChartProvider({
        bpm: Number(this.bpmInput.value), notesPerBeat: Number(this.densitySelect.value), startOffset: 1, endOffset: 0.5, pattern: 'sequential'
      });
      chart = await provider.getChart(audio, this.laneData);
      chart.audio = audio;
      chart.notes = chart.notes.filter(n => n.t <= audio.duration - 0.25);
    }
    this._useChart(chart);
  }

  _useChart(chart) {
    this.chart = chart;
    this.chart.reset();
    this.audioDuration = this.audioManager.getDuration();
    this.noteRenderer.audioDuration = this.audioDuration;
    this.noteRenderer.createNotes(chart);
    this.judgeManager.reset();
    this._updateScoreDisplay();
    this._updatePlayerPosition(0);
    this.noteRenderer.update(chart, 0);
    this.renderer.render();
    this.audioFileName.textContent = this.audioManager.meta.name;
    this.result.hidden = true;
    this.judgementDisplay.textContent = '';
    this.timeDisplay.textContent = `0.0 / ${this.audioDuration.toFixed(1)} 秒`;
    const generation = chart.generation;
    const tempo = generation?.bpm ? ` · 推定 ${generation.bpm} BPM${generation.tempoConfidence < 0.2 ? '（参考値）' : ''}` : '';
    this.status.textContent = chart.notes.length ? `${chart.notes.length} ノーツ · ${this.audioDuration.toFixed(1)}秒${tempo}` : '目立つ発音が見つかりませんでした。別の音源か生成設定を試してください。';
    this._drawOverview();
    this._drawTiming(0);
  }

  async _runTask(action) {
    if (this.isRunning || this.isBusy) return;
    this.isBusy = true;
    this.status.textContent = '準備中…';
    this._syncControls();
    try { await action(); }
    catch (error) { this.status.textContent = error.name === 'AbortError' ? '解析をキャンセルしました。「譜面を生成」で再試行できます。' : `処理できませんでした: ${error.message}`; }
    finally { this.isBusy = false; this.cancelButton.hidden = true; this._syncControls(); }
  }

  async loadCustomAudio(file) {
    await this._runTask(async () => {
      await this.audioManager.loadAudioFromFile(file);
      // A successful song switch invalidates the old chart before analysis begins.
      this.chart = null;
      this.noteRenderer.clear();
      this.renderer.render();
      this.audioDuration = this.audioManager.getDuration();
      this.audioFileName.textContent = file.name;
      this.providerSelect.value = 'musical';
      this.result.hidden = true;
      await this._generate();
    });
    this.audioFileInput.value = '';
  }

  async start() {
    if (!this.chart?.notes.length || this.isRunning || this.isBusy) return;
    this.isBusy = true;
    this._syncControls();
    try {
      this.chart.reset();
      this.judgeManager.reset();
      this.noteRenderer.createNotes(this.chart);
      this.result.hidden = true;
      this.judgementDisplay.textContent = '';
      await this.audioManager.play();
      this.isRunning = true;
      this._gameLoop();
    } catch (error) { this.status.textContent = `再生できませんでした: ${error.message}`; }
    finally { this.isBusy = false; this._syncControls(); }
  }

  stop() {
    this.isRunning = false;
    cancelAnimationFrame(this._animationFrameId);
    this._animationFrameId = null;
    this.audioManager?.stop();
    this._syncControls();
  }

  _onKeyDown(e) {
    if (e.target?.matches('input, select, textarea, button') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toUpperCase();
    if (!this.isRunning) return;
    if (key === 'ESCAPE') { this.stop(); return; }
    if (!['W', 'A', 'S', 'D'].includes(key)) return;
    e.preventDefault();
    this.judgeManager.processKeyInput(key, this.audioManager.getCurrentTime() - this.offsetMs / 1000, this.chart);
  }

  _gameLoop() {
    if (!this.isRunning) return;
    const time = this.audioManager.getCurrentTime();
    this.judgeManager.processMissedNotes(time - this.offsetMs / 1000, this.chart);
    this._updatePlayerPosition(Math.min(1, time / this.audioDuration));
    this.noteRenderer.update(this.chart, time);
    this._updateScoreDisplay();
    this.timeDisplay.textContent = `${time.toFixed(1)} / ${this.audioDuration.toFixed(1)} 秒`;
    this._drawTiming(time - this.offsetMs / 1000);
    this.renderer.render();
    if (time >= this.audioDuration) {
      // Finish every remaining note even when the final frame was delayed.
      this.judgeManager.processMissedNotes(this.audioDuration + 1, this.chart);
      const r = this.judgeManager.getResult();
      this.stop();
      this.result.textContent = `曲終了 · Score ${r.score} · Max Combo ${r.maxCombo}\nPerfect ${r.counts.perfect} / Great ${r.counts.great} / Good ${r.counts.good} / Miss ${r.counts.miss}`;
      this.result.hidden = false;
      this._updateScoreDisplay();
      return;
    }
    this._animationFrameId = requestAnimationFrame(() => this._gameLoop());
  }

  _updatePlayerPosition(progress) {
    const distance = this.arcLengthTable.getTotalLength() * progress;
    this.playerCursor.setFrame(this.parallelLanes.getFrameAtDistance(distance));
  }

  _updateScoreDisplay() {
    this.scoreDisplay.textContent = `Score ${this.judgeManager.score} · Combo ${this.judgeManager.combo}`;
  }

  _syncControls() {
    if (!this.panel) return;
    this.panel.querySelectorAll('input, select, button').forEach(el => { el.disabled = this.isBusy || this.isRunning || !this.isLoaded; });
    this.cancelButton.disabled = false;
    this.startButton.disabled = this.isBusy || this.isRunning || !this.chart?.notes.length;
    this.startButton.hidden = this.isRunning;
    this.stopButton.hidden = !this.isRunning;
    this.exportButton.disabled ||= !this.chart?.notes.length;
    this.manualSettings.hidden = this.providerSelect.value !== 'auto';
    this.musicalSettings.hidden = this.providerSelect.value !== 'musical';
    this.panel.classList.toggle('playing', this.isRunning);
    // Keyboard input must return to the game after clicking START.
    if (this.isRunning) document.activeElement?.blur();
  }

  _createUI() {
    const hud = document.createElement('div');
    hud.className = 'game-hud';
    hud.innerHTML = '<strong>ONE STROKE / SOUNDGAME</strong><div id="score"></div><div id="time"></div><div class="lane-legend"></div><div id="judgement" aria-live="off"></div>';
    this.container.append(hud);
    this.scoreDisplay = hud.querySelector('#score');
    this.timeDisplay = hud.querySelector('#time');
    this.judgementDisplay = hud.querySelector('#judgement');
    this.laneLegend = hud.querySelector('.lane-legend');
    this.panel = document.createElement('aside');
    this.panel.className = 'studio-panel';
    this.panel.innerHTML = `
      <h1>曲からステージを作る</h1>
      <p class="hint">音の変化を拾って、押しやすい譜面へ。</p>
      <label>レーン数<select id="lane-count"><option value="1">1本</option><option value="2">2本</option><option value="3">3本</option><option value="4" selected>4本</option></select></label>
      <p id="lane-mapping" class="hint" role="status"></p>
      <label>音源を選ぶ<input id="audio-file" type="file" accept="audio/*"></label>
      <p id="audio-name" class="filename"></p>
      <label>譜面の作り方<select id="provider"><option value="musical">音源を解析</option><option value="auto">等間隔（練習用）</option><option value="fixed">サンプル譜面</option></select></label>
      <div id="musical-settings" class="row">
        <label>譜面の難易度<select id="difficulty"><option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select></label>
        <label>拾う音<select id="focus"><option value="balanced">バランス</option><option value="rhythm">リズム重視</option><option value="melody">メロディー重視</option></select></label>
      </div>
      <div id="manual-settings" class="row" hidden>
        <label>BPM<input id="bpm" type="number" min="60" max="300" value="120"></label>
        <label>細かさ<select id="density"><option value="1">4分</option><option value="2">8分</option><option value="4">16分</option></select></label>
      </div>
      <button id="generate" class="primary">譜面を生成</button>
      <button id="cancel" hidden>解析をキャンセル</button>
      <p id="status" role="status"></p>
      <canvas id="overview" width="560" height="90" aria-label="曲全体のノーツ分布"></canvas>
      <p class="hint">無音は休符に。音色・音の高さの変化を配置に反映します。メロディーは混ざった音からの推定です。</p>
      <div class="row"><button id="export">譜面を保存</button><label class="file-button">譜面を読込<input id="stage-file" type="file" accept=".json,application/json"></label></div>
      <p class="hint">JSON と元の音源をセットで保管してください。</p>
      <details><summary>判定・表示の調整</summary>
        <label>判定の厳しさ<select id="preset"><option value="loose">Loose</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select></label>
        <label>入力タイミング補正（ms）<input id="offset" type="number" min="-250" max="250" step="5" value="0"></label>
        <p class="hint">音に合わせて押しても早すぎる判定になる場合はマイナス、遅すぎる場合はプラスへ。</p>
        <label>レーンの拡大<input id="zoom" type="range" min="0.3" max="2" step="0.1" value="1"></label>
      </details>`;
    this.container.append(this.panel);
    const q = id => this.panel.querySelector('#' + id);
    this.laneCountSelect = q('lane-count'); this.laneMapping = q('lane-mapping');
    this.laneCountSelect.onchange = () => this.setLaneCount(Number(this.laneCountSelect.value));
    this.audioFileInput = q('audio-file'); this.audioFileName = q('audio-name');
    this.providerSelect = q('provider'); this.difficultySelect = q('difficulty'); this.focusSelect = q('focus');
    this.bpmInput = q('bpm'); this.densitySelect = q('density'); this.status = q('status');
    this.cancelButton = q('cancel'); this.exportButton = q('export'); this.overview = q('overview');
    this.manualSettings = q('manual-settings'); this.musicalSettings = q('musical-settings');
    this.providerSelect.onchange = () => this._syncControls();
    this.audioFileInput.onchange = () => { const file = this.audioFileInput.files[0]; if (file) this.loadCustomAudio(file); };
    q('generate').onclick = () => this._runTask(async () => {
      const bpm = Number(this.bpmInput.value);
      if (this.providerSelect.value === 'auto' && (!Number.isFinite(bpm) || bpm < 60 || bpm > 300)) throw new Error('BPMは60〜300で指定してください');
      await this._generate();
    });
    this.cancelButton.onclick = () => this.musicalProvider.cancel();
    q('preset').onchange = e => this.judgeManager.setPreset(e.target.value);
    q('offset').onchange = e => {
      const value = Number(e.target.value);
      this.offsetMs = Number.isFinite(value) ? Math.max(-250, Math.min(250, value)) : 0;
      e.target.value = this.offsetMs;
    };
    q('zoom').oninput = e => { this.renderer.setZoom(Number(e.target.value)); this.renderer.render(); };
    this.exportButton.onclick = () => {
      const blob = new Blob([serializeStage(this.chart, this.offsetMs, this.laneCount)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `${this.audioManager.meta.name.replace(/\.[^.]+$/, '')}-${this.chart.generation?.difficulty || 'chart'}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    q('stage-file').onchange = e => {
      const file = e.target.files[0];
      if (file) this._runTask(async () => {
        if (file.size > 2_000_000) throw new Error('譜面ファイルは2 MB以内にしてください');
        const { chart, offsetMs, laneCount } = parseStage(await file.text(), this.audioManager.meta, this.laneData.laneId);
        this._setLaneCount(laneCount);
        this.offsetMs = offsetMs; q('offset').value = offsetMs;
        this._useChart(chart);
        this.status.textContent += ' · 保存譜面を読み込みました';
      }).finally(() => { e.target.value = ''; });
    };
    this.startButton = document.createElement('button');
    this.startButton.id = 'start-button'; this.startButton.textContent = 'START';
    this.startButton.onclick = () => this.start();
    this.stopButton = document.createElement('button');
    this.stopButton.id = 'stop-button'; this.stopButton.textContent = '停止 / Esc';
    this.stopButton.onclick = () => this.stop(); this.stopButton.hidden = true;
    this.result = document.createElement('div'); this.result.className = 'result'; this.result.hidden = true;
    const timing = document.createElement('section'); timing.className = 'timing-strip';
    timing.innerHTML = '<p>目印が判定バーと重なったら、表示された文字のキーを押す</p><canvas width="1000" height="120" aria-label="次に押すキーとタイミング"></canvas>';
    this.timingCanvas = timing.querySelector('canvas');
    this.container.append(this.startButton, this.stopButton, this.result, timing);
  }

  _drawOverview() {
    const ctx = this.overview.getContext('2d'), w = this.overview.width, h = this.overview.height;
    ctx.clearRect(0, 0, w, h);
    for (const note of this.chart.notes) {
      const lane = laneForKey(note.key);
      ctx.fillStyle = '#' + lane.color.toString(16).padStart(6, '0');
      const row = this.parallelLanes.laneForKey(note.key).index;
      ctx.fillRect(note.t / this.audioDuration * w, (row + 0.5) * h / this.laneCount - 6, 2, 12);
    }
  }

  _drawTiming(time) {
    const ctx = this.timingCanvas.getContext('2d'), w = this.timingCanvas.width;
    ctx.clearRect(0, 0, w, 120);
    ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this.parallelLanes.lanes.forEach((lane, i) => {
      const y = (i + 0.5) * 120 / this.laneCount;
      ctx.fillStyle = '#' + lane.color.toString(16).padStart(6, '0');
      ctx.globalAlpha = 0.3; ctx.fillRect(125, y, w - 125, 1); ctx.globalAlpha = 1;
      lane.keys.forEach((key, k) => {
        ctx.fillStyle = '#' + laneForKey(key).color.toString(16).padStart(6, '0');
        ctx.fillText(key, 60 + (k - (lane.keys.length - 1) / 2) * 26, y);
      });
    });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(160, 2, 2, 116);
    for (const note of this.chart?.notes || []) {
      const dt = note.t - time;
      if (note.judged || dt < -0.3 || dt > 3) continue;
      const x = 160 + dt / 3 * (w - 180);
      const lane = laneForKey(note.key), row = this.parallelLanes.laneForKey(note.key).index;
      const y = (row + 0.5) * 120 / this.laneCount;
      ctx.fillStyle = '#' + lane.color.toString(16).padStart(6, '0'); ctx.fillRect(x - 13, y - 12, 26, 24);
      ctx.fillStyle = '#101421'; ctx.fillText(note.key, x, y);
    }
  }

  dispose() {
    this.stop(); this.musicalProvider.cancel();
    document.removeEventListener('keydown', this._boundKeyDown);
    this.noteRenderer?.dispose(); this.laneRenderer?.dispose(); this.playerCursor?.dispose();
    this.renderer?.dispose(); this.audioManager?.dispose();
  }
}
