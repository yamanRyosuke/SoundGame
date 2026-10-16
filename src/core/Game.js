import { GameRenderer } from './GameRenderer.js';
import { AudioManager } from '../audio/AudioManager.js';
import { LaneLoader } from '../lane/LaneLoader.js';
import { PREVIEW_COURSES, PLAYABLE_COURSES, getPreviewCourse } from '../lane/PreviewCourses.js';
import { ArcLengthTable } from '../lane/ArcLengthTable.js';
import { ParallelLanes, DEFAULT_SPEED } from '../lane/ParallelLanes.js';
import { laneForKey } from '../lane/LaneLayout.js';
import { LaneRenderer } from '../lane/LaneRenderer.js';
import { PlayerCursor } from '../player/PlayerCursor.js';
import { JudgeManager } from '../judge/JudgeManager.js';
import { NoteRenderer } from '../notes/NoteRenderer.js';
import { FixedChartProvider } from '../chart/FixedChartProvider.js';
import { AutoChartProvider } from '../chart/AutoChartProvider.js';
import { MusicalChartProvider } from '../chart/MusicalChartProvider.js';
import { serializeStage, parseStage } from '../chart/StageFile.js';
import { StageLibrary } from '../chart/StageLibrary.js';
import { createStageArchive, readStageArchive, prepareSavedStage } from '../chart/StageArchive.js';
import { GamepadInput, keyLabel } from '../input/GamepadInput.js';
import { followFrame, followSpan } from './FollowCamera.js';
import { CharacterField } from '../characters/CharacterField.js';
import { RepeatedPlay, REPEAT_OPTIONS, repeatCount } from '../chart/RepeatedPlay.js';

const VIEW_KEY = 'soundgame.view';
const loadView = () => {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch { return {}; }
};

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
    this.stageLibrary = new StageLibrary();
    this.libraryReady = false;
    this._boundKeyDown = this._onKeyDown.bind(this);
    this._animationFrameId = null;
    this.inputMode = 'keyboard';
    this.gamepad = new GamepadInput((key, age) => this._onPadPress(key, age));
    this._boundPadConnected = () => this._pollPads();
    this._padFrameId = null;
    const view = loadView();
    this.cameraMode = ['chase', 'north', 'overview'].includes(view.camera) ? view.camera : 'chase';
    this.showGuide = view.guide !== false;
    // Only a distance the player picked is remembered, so the default can change.
    this.cameraDistance = Number.isFinite(view.cameraDistance) ? Math.max(0.5, Math.min(2.5, view.cameraDistance)) : 1.5;
    this.distanceChosen = Number.isFinite(view.cameraDistance);
    this.showDevUi = view.devUi !== false;
    this.travelSpeed = Number.isFinite(view.speed) ? Math.max(2, Math.min(6, view.speed)) : DEFAULT_SPEED;
    this.speedChosen = Number.isFinite(view.speed);
    this.repeat = REPEAT_OPTIONS.includes(view.repeat) ? view.repeat : '1';
    this.play = null;
  }

  async init(config) {
    this.config = config;
    this._createUI();
    await this._runTask(async () => {
      this.renderer = new GameRenderer(this.container);
      this._setView({ persist: false });
      this.audioManager = new AudioManager();
      this.judgeManager = new JudgeManager();
      this.judgeManager.onJudgement((note, judgement, diffMs) => {
        this.noteRenderer.showJudgementEffect(note, judgement);
        this._spawnCharacter(note, judgement);
        const timing = Number.isFinite(diffMs) ? ` ${diffMs < 0 ? '早い' : '遅い'} ${Math.abs(Math.round(diffMs))} ms` : '';
        this.judgementDisplay.textContent = judgement.toUpperCase() + timing;
        this.judgementDisplay.dataset.judgement = judgement;
        // Restart the CSS reaction even when the same judgement repeats.
        this.judgementDisplay.classList.remove('pop');
        void this.judgementDisplay.offsetWidth;
        this.judgementDisplay.classList.add('pop');
        this._updateScoreDisplay();
      });
      this.originalLane = await LaneLoader.load(config.laneUrl);
      this._setCourse(PLAYABLE_COURSES[0]);
      this.noteRenderer = new NoteRenderer(this.parallelLanes);
      this.renderer.add(this.noteRenderer.getObject());
      this.characterField = new CharacterField();
      this.renderer.add(this.characterField.getObject());
      await this.characterField.load();
      document.addEventListener('keydown', this._boundKeyDown);
      window.addEventListener('gamepadconnected', this._boundPadConnected);
      this._pollPads();
      this.isLoaded = true;
      // Keep saved stages available even if the bundled song fails to load.
      await this._refreshLibrary();
      if (config.useDummyAudio) await this.audioManager.loadDummyAudio(config.audioDuration);
      else await this.audioManager.loadAudio(config.audioUrl);
      this.audioDuration = this.audioManager.getDuration();
      await this._generate();
    });
  }

  settings() { return { difficulty: this.difficultySelect.value, focus: this.focusSelect.value }; }

  async _refreshLibrary(selectedId = this.librarySelect.value) {
    try {
      const stages = await this.stageLibrary.list();
      this.librarySelect.replaceChildren(new Option(stages.length ? 'ステージを選択' : 'まだ保存されていません', ''));
      for (const stage of stages) this.librarySelect.add(new Option(`${stage.name} · ${new Date(stage.createdAt).toLocaleString('ja-JP')}`, stage.id));
      this.librarySelect.value = selectedId;
      this.librarySummary.textContent = `保存したステージ（${stages.length}）`;
      this.libraryReady = true;
    } catch (error) {
      this.libraryReady = false;
      this.libraryStatus.textContent = error.message;
    }
  }

  _captureStage() {
    if (!this.chart?.notes.length || !this.audioManager.originalFile) throw new Error('保存できる音楽と譜面を先に読み込んでください');
    const name = this.stageName.value.trim();
    if (!name) throw new Error('ステージ名を入力してください');
    return {
      name, audioName: this.audioManager.meta.name, audioBlob: this.audioManager.originalFile,
      stageText: serializeStage(this.chart, this.offsetMs, this.laneCount),
      options: { ...this.settings(), provider: this.providerSelect.value, preset: this.panel.querySelector('#preset').value,
        bpm: Number(this.bpmInput.value), density: this.densitySelect.value }
    };
  }

  async _runLibraryTask(action) {
    const previousStatus = this.status.textContent;
    await this._runTask(async () => {
      this.libraryStatus.textContent = '処理中…';
      try {
        await action();
        if (this.status.textContent === '準備中…') this.status.textContent = previousStatus;
      } catch (error) {
        this.libraryStatus.textContent = error.message;
        throw error;
      }
    });
  }

  async _restoreSaved(record) {
    const prepared = await prepareSavedStage(record, [this.originalLane.laneId, ...PREVIEW_COURSES.map(course => course.laneId)]);
    const moved = this._useSavedCourse(prepared.chart, prepared.laneCount);
    this.audioManager.dispose();
    this.audioManager = prepared.audioManager;
    this.musicalProvider.cancel();
    this.musicalProvider.buffer = null;
    this.musicalProvider.analysis = null;
    this.offsetMs = prepared.offsetMs;
    this.panel.querySelector('#offset').value = this.offsetMs;
    const options = prepared.options;
    this.providerSelect.value = options.provider;
    this.difficultySelect.value = options.difficulty;
    this.focusSelect.value = options.focus;
    this.bpmInput.value = options.bpm;
    this.densitySelect.value = options.density;
    this.panel.querySelector('#preset').value = options.preset;
    this.judgeManager.setPreset(options.preset);
    this.stageName.value = record.name;
    this._useChart(prepared.chart);
    if (moved) this.status.textContent += ` · 片道コースは選べなくなったため「${this.laneData.name}」で開きました`;
  }

  // Saves from before laps may name a one-way course; notes are timed, so the
  // same chart plays on the first loop course instead.
  _useSavedCourse(chart, laneCount) {
    const saved = getPreviewCourse(chart.laneId);
    const course = saved?.oneWay ? PLAYABLE_COURSES[0] : saved || this.originalLane;
    this._setCourse(course, laneCount);
    chart.laneId = course.laneId;
    return course !== (saved || this.originalLane);
  }

  _download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  _setCourse(course, laneCount = this.laneCount) {
    this.laneData = course;
    this.arcLengthTable = new ArcLengthTable(course.points);
    this._setLaneCount(laneCount);
    this.courseSelect.value = course === this.originalLane ? 'original' : course.laneId;
    this._describeCourse();
    this.renderer.fitCourse(course.points);
    this.panel.querySelector('#zoom').value = '1';
  }

  _describeCourse() {
    const lap = this.parallelLanes.getLapTime();
    this.courseDescription.textContent = `${this.laneData.description || '比較用の小さな円コース。'} 1周 約${lap.toFixed(0)}秒、曲が終わるまで周回します。`;
  }

  setTravelSpeed(speed) {
    if (this.isRunning) return;
    this.travelSpeed = speed;
    this.speedChosen = true;
    this.parallelLanes.speed = speed;
    this.travelSpeedValue.textContent = `${speed.toFixed(1)}`;
    this._describeCourse();
    this._saveView();
    if (this.chart) { this.noteRenderer.createNotes(this.chart); this.noteRenderer.update(this.chart, 0); }
    this.renderer.render();
  }

  setCourse(id) {
    if (this.isRunning || this.isBusy || !this.isLoaded) return;
    const course = id === 'original' ? this.originalLane : getPreviewCourse(id);
    if (!course) return;
    this._setCourse(course);
    if (this.chart) {
      this.chart.laneId = course.laneId;
      this._useChart(this.chart);
    } else this.renderer.render();
  }

  _setLaneCount(count) {
    const layout = new ParallelLanes(this.arcLengthTable, count, this.travelSpeed);
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
    this._renderKeyLabels();
    this.timingCanvas.setAttribute('aria-label', `${count}レーンの次に押すキーとタイミング`);
    this._updatePlayerPosition(0);
  }

  _renderKeyLabels() {
    const label = key => keyLabel(key, this.inputMode);
    const lanes = this.parallelLanes.lanes;
    this.laneMapping.textContent = 'レーン順：' + lanes.map(lane => lane.keys.map(label).join(' / ')).join(' ｜ ') +
      (this.inputMode === 'pad' ? '（コントローラー）' : '');
    this.laneLegend.innerHTML = lanes.map(lane => '<span class="lane-group">' + lane.keys.map(key =>
      `<span style="color:#${laneForKey(key).color.toString(16).padStart(6, '0')}">${label(key)}</span>`).join(' ') + '</span>').join('');
    this.stopButton.textContent = this.inputMode === 'pad' ? '停止 / Menu' : '停止 / Esc';
  }

  _setInputMode(mode) {
    if (mode === this.inputMode) return;
    this.inputMode = mode;
    this._renderKeyLabels();
    this.noteRenderer?.setLabels(key => keyLabel(key, mode));
    if (!this.isRunning && this.chart) { this._drawTiming(this._timingTime ?? 0); this.renderer.render(); }
  }

  _pollPads() {
    cancelAnimationFrame(this._padFrameId);
    this.gamepad.poll();
    const connected = [...(navigator.getGamepads?.() ?? [])].some(pad => pad?.connected);
    this._padFrameId = connected ? requestAnimationFrame(() => this._pollPads()) : null;
  }

  _onPadPress(key, age) {
    if (!this.isLoaded) return;
    this._setInputMode('pad');
    if (key === 'MENU') {
      if (this.isRunning) this.stop(); else this.start();
      return;
    }
    if (!this.isRunning) return;
    this.judgeManager.processKeyInput(key, this.audioManager.getCurrentTime() - age - this.offsetMs / 1000, this.play.chart);
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
    chart.laneId = this.laneData.laneId;
    this.stageName.value = `${audio.name.replace(/\.[^.]+$/, '')} · ${this.laneData.name || '円'}`.slice(0, 100);
    this._useChart(chart);
  }

  _useChart(chart) {
    this.chart = chart;
    this.chart.reset();
    this.audioDuration = this.audioManager.getDuration();
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
      this.play = new RepeatedPlay(this.chart, this.audioDuration, repeatCount(this.repeat));
      this.noteRenderer.createNotes(this.play.chart);
      this.characterField.clear();
      this.result.hidden = true;
      this.judgementDisplay.textContent = '';
      await this.audioManager.play(0, { loops: this.play.loops });
      this.isRunning = true;
      this._gameLoop();
    } catch (error) { this.status.textContent = `再生できませんでした: ${error.message}`; }
    finally { this.isBusy = false; this._syncControls(); }
  }

  stop() {
    // Endless play only ends here, so it still gets a result.
    const endedEndless = this.isRunning && this.play?.loops === Infinity;
    this.isRunning = false;
    cancelAnimationFrame(this._animationFrameId);
    this._animationFrameId = null;
    this.audioManager?.stop();
    if (this.renderer?.following) { this.renderer.showOverview(); this.renderer.render(); }
    if (endedEndless) this._showResult(`エンドレス終了 · ${this.play.cycleAt(this._lastTime ?? 0) + 1}回目まで`);
    this._syncControls();
  }

  _onKeyDown(e) {
    if (e.shiftKey && e.code === 'KeyP' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey &&
        !e.target?.matches('input:not([type=range]):not([type=checkbox]):not([type=file]), textarea')) {
      e.preventDefault();
      this._setView({ devUi: !this.showDevUi });
      return;
    }
    if (e.target?.matches('input, select, textarea, button') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toUpperCase();
    if (!this.isRunning) return;
    if (key === 'ESCAPE') { this.stop(); return; }
    if (!['W', 'A', 'S', 'D'].includes(key)) return;
    e.preventDefault();
    this._setInputMode('keyboard');
    this.judgeManager.processKeyInput(key, this.audioManager.getCurrentTime() - this.offsetMs / 1000, this.play.chart);
  }

  _gameLoop() {
    if (!this.isRunning) return;
    const time = this.audioManager.getCurrentTime(), play = this.play;
    this._lastTime = time;
    const { added, removed } = play.advance(time);
    if (added.length) this.noteRenderer.addNotes(added);
    if (removed.length) this.noteRenderer.removeNotes(removed);
    this.judgeManager.processMissedNotes(time - this.offsetMs / 1000, play.chart);
    this._updatePlayerPosition(time);
    this._updateCamera(time);
    this.noteRenderer.update(play.chart, time);
    this.characterField.update(performance.now() / 1000, this.renderer.camera);
    this._updateScoreDisplay();
    this.timeDisplay.textContent = this._timeLabel(time);
    if (this.showGuide) this._drawTiming(time - this.offsetMs / 1000);
    this.renderer.render();
    if (time >= play.length) {
      // Finish every remaining note even when the final frame was delayed.
      this.judgeManager.processMissedNotes(play.length + 1, play.chart);
      this.stop();
      this._showResult(play.loops > 1 ? `${play.loops}回くり返し終了` : '曲終了');
      return;
    }
    this._animationFrameId = requestAnimationFrame(() => this._gameLoop());
  }

  _showResult(title) {
    const r = this.judgeManager.getResult();
    this.result.textContent = `${title} · Score ${r.score} · Max Combo ${r.maxCombo}\nPerfect ${r.counts.perfect} / Great ${r.counts.great} / Good ${r.counts.good} / Miss ${r.counts.miss}`;
    this.result.hidden = false;
    this._updateScoreDisplay();
  }

  _timeLabel(time) {
    const play = this.play, song = this.audioDuration;
    if (!play || play.loops === 1) return `${time.toFixed(1)} / ${song.toFixed(1)} 秒`;
    const cycle = play.cycleAt(time), within = time - cycle * song;
    const count = Number.isFinite(play.loops) ? `${cycle + 1} / ${play.loops}回目` : `${cycle + 1}回目（エンドレス）`;
    return `${within.toFixed(1)} / ${song.toFixed(1)} 秒 · ${count}`;
  }

  _updateCamera(time) {
    const now = performance.now(), dt = (now - (this._lastCameraAt ?? now)) / 1000;
    this._lastCameraAt = now;
    if (this.cameraMode === 'overview') return;
    const lanes = this.parallelLanes;
    const span = followSpan(lanes.speed) * this.cameraDistance;
    const { center, forward } = followFrame(lanes, lanes.getDistanceAtTime(time), span, this.cameraMode);
    this.renderer.follow(center, forward, span, dt);
  }

  _setView({ camera = this.cameraMode, guide = this.showGuide, distance, devUi = this.showDevUi, persist = true } = {}) {
    this.cameraMode = camera;
    this.showGuide = guide;
    if (distance !== undefined) { this.cameraDistance = distance; this.distanceChosen = true; }
    this.showDevUi = devUi;
    this.cameraDistanceValue.textContent = `${this.cameraDistance.toFixed(1)}倍`;
    if (persist) this._saveView();
    // Shift+P hides the studio panel and the guide together; the guide checkbox
    // still decides whether the guide returns with the panel.
    const guideShown = guide && devUi;
    if (!devUi && this.panel.contains(document.activeElement)) document.activeElement.blur();
    this.panel.hidden = !devUi;
    this.devUiHint.hidden = devUi;
    this.timingStrip.hidden = !guideShown;
    this.container.classList.toggle('guide-hidden', !guideShown);
    this.container.classList.toggle('dev-ui-hidden', !devUi);
    this.renderer?.setPanelVisible(devUi);
    this.renderer?.setBottomInset(guideShown ? 165 : 16);
    this.renderer?.render();
  }

  _saveView() {
    const saved = { camera: this.cameraMode, guide: this.showGuide, devUi: this.showDevUi,
      ...(this.distanceChosen && { cameraDistance: this.cameraDistance }), ...(this.speedChosen && { speed: this.travelSpeed }),
      repeat: this.repeat };
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(saved)); } catch { /* preference only */ }
  }

  // Perfect, Great and Good each send out their own characters beside the course.
  _spawnCharacter(note, judgement) {
    if (!this.isRunning || judgement === 'miss') return;
    const lanes = this.parallelLanes;
    const halfWidth = (lanes.lanes.at(-1).offset - lanes.lanes[0].offset) / 2 + 0.15;
    this.characterField.spawn(judgement, lanes.getPositionAtTime(note.t, note.key), this._placeNearCursor(note.t), halfWidth, performance.now() / 1000);
  }

  // A course-relative spot around the cursor at `time`.
  _placeNearCursor(time) {
    const lanes = this.parallelLanes, distance = lanes.getDistanceAtTime(time);
    return (along, across) => {
      const frame = lanes.getFrameAtDistance(distance + along);
      return frame.center.addScaledVector(frame.lateral.normalize(), across);
    };
  }

  _updatePlayerPosition(time) {
    this.playerCursor.setFrame(this.parallelLanes.getFrameAtDistance(this.parallelLanes.getDistanceAtTime(time)));
  }

  _updateScoreDisplay() {
    this.scoreDisplay.textContent = `Score ${this.judgeManager.score} · Combo ${this.judgeManager.combo}`;
  }

  _syncControls() {
    if (!this.panel) return;
    this.panel.querySelectorAll('input, select, button').forEach(el => { el.disabled = this.isBusy || this.isRunning || !this.isLoaded; });
    // Camera distance stays adjustable mid-song so it can be tuned while watching.
    this.cameraDistanceInput.disabled = !this.isLoaded;
    this.cancelButton.disabled = false;
    this.startButton.disabled = this.isBusy || this.isRunning || !this.chart?.notes.length;
    this.startButton.hidden = this.isRunning;
    this.stopButton.hidden = !this.isRunning;
    this.exportButton.disabled ||= !this.chart?.notes.length;
    this.saveStageButton.disabled ||= !this.libraryReady || !this.chart?.notes.length || !this.audioManager?.originalFile;
    this.archiveButton.disabled ||= !this.chart?.notes.length || !this.audioManager?.originalFile;
    this.openStageButton.disabled ||= !this.libraryReady || !this.librarySelect.value;
    this.manualSettings.hidden = this.providerSelect.value !== 'auto';
    this.musicalSettings.hidden = this.providerSelect.value !== 'musical';
    this.panel.classList.toggle('playing', this.isRunning);
    // Keyboard input must return to the game after clicking START.
    if (this.isRunning) document.activeElement?.blur();
  }

  _createUI() {
    const hud = document.createElement('div');
    hud.className = 'game-hud';
    hud.innerHTML = '<strong>ONE STROKE / SOUNDGAME</strong><div id="score"></div><div id="time"></div><div class="lane-legend"></div><div id="judgement" aria-live="off"></div><p class="dev-ui-hint" hidden>Shift + P でパネルを表示</p>';
    this.container.append(hud);
    this.scoreDisplay = hud.querySelector('#score');
    this.timeDisplay = hud.querySelector('#time');
    this.judgementDisplay = hud.querySelector('#judgement');
    this.laneLegend = hud.querySelector('.lane-legend');
    this.devUiHint = hud.querySelector('.dev-ui-hint');
    this.panel = document.createElement('aside');
    this.panel.className = 'studio-panel';
    this.panel.innerHTML = `
      <h1>曲からステージを作る</h1>
      <p class="hint">音の変化を拾って、押しやすい譜面へ。Shift + P で、このパネルと下の譜面ガイドを隠せます。</p>
      <details class="stage-library" open>
        <summary id="library-summary">保存したステージ（0）</summary>
        <label>ステージ名<input id="stage-name" maxlength="100" placeholder="曲名や難易度など"></label>
        <button id="save-stage" class="primary">音楽ごと保存</button>
        <label>保存済みステージ<select id="saved-stages"><option value="">まだ保存されていません</option></select></label>
        <button id="open-stage">選んだステージを開く</button>
        <p id="library-status" class="hint" role="status">音楽・譜面・形・レーン数を、このブラウザに保存します。</p>
        <div class="row"><button id="export-archive">音楽入りファイルを書出し</button><label class="file-button">音楽入りファイルを読込<input id="archive-file" type="file" accept=".soundstage"></label></div>
        <p class="hint">保存一覧は同じブラウザ・同じURLで使えます。ブラウザのデータ削除に備え、ファイルでも保管できます。保存は毎回新しく追加します。</p>
      </details>
      <label>ステージの形<select id="course">${PLAYABLE_COURSES.map(course => `<option value="${course.laneId}">${course.name}</option>`).join('')}<option value="original">円（比較用）</option></select></label>
      <p id="course-description" class="hint"></p>
      <label>曲のくり返し<select id="repeat"><option value="1">1回</option><option value="2">2回</option><option value="3">3回</option><option value="endless">エンドレス（停止するまで）</option></select></label>
      <label>進む速さ <output id="travel-speed-value">3.5</output><input id="travel-speed" type="range" min="2" max="6" step="0.5" value="3.5"></label>
      <label>レーン数<select id="lane-count"><option value="1">1本</option><option value="2">2本</option><option value="3">3本</option><option value="4" selected>4本</option></select></label>
      <p id="lane-mapping" class="hint" role="status"></p>
      <label>音源を選ぶ<input id="audio-file" type="file" accept="audio/*"></label>
      <p id="audio-name" class="filename"></p>
      <label>譜面の作り方<select id="provider"><option value="musical">音源を解析</option><option value="auto">等間隔（練習用）</option><option value="fixed">サンプル譜面</option></select></label>
      <div id="musical-settings" class="row">
        <label>譜面の難易度<select id="difficulty"><option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select></label>
        <label>拾う音<select id="focus"><option value="balanced">バランス</option><option value="rhythm">リズム重視</option><option value="melody">メロディー重視</option><option value="timbre">音色で統一</option></select></label>
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
      <details><summary>譜面JSON（音源別）</summary>
        <div class="row"><button id="export">譜面JSONを書出し</button><label class="file-button">譜面JSONを読込<input id="stage-file" type="file" accept=".json,application/json"></label></div>
        <p class="hint">こちらは音源を含みません。JSON と元の音源をセットで保管してください。</p>
      </details>
      <details><summary>判定・表示の調整</summary>
        <label>判定の厳しさ<select id="preset"><option value="loose">Loose</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select></label>
        <label>入力タイミング補正（ms）<input id="offset" type="number" min="-250" max="250" step="5" value="0"></label>
        <p class="hint">音に合わせて押しても早すぎる判定になる場合はマイナス、遅すぎる場合はプラスへ。</p>
        <label>全体表示の拡大<input id="zoom" type="range" min="0.3" max="2" step="0.1" value="1"></label>
      </details>
      <details class="camera-settings" open><summary>カメラ</summary>
        <label>プレイ中のカメラ<select id="camera-mode"><option value="chase">現在地を追う（進行方向が上）</option><option value="north">現在地を追う（向きは固定）</option><option value="overview">コース全体を表示</option></select></label>
        <label>カメラの距離 <output id="camera-distance-value">1.5倍</output><input id="camera-distance" type="range" min="0.5" max="2.5" step="0.1" value="1.5"></label>
        <p class="hint">左で近く大きく、右で遠く広く。プレイ中も動かせます。</p>
        <label class="check"><input id="show-guide" type="checkbox">画面下の譜面ガイドを表示</label>
        <p class="hint">ガイドを消すと、上のコースだけで遊べます。</p>
      </details>`;
    this.container.append(this.panel);
    const q = id => this.panel.querySelector('#' + id);
    this.stageName = q('stage-name'); this.librarySelect = q('saved-stages');
    this.librarySummary = q('library-summary'); this.libraryStatus = q('library-status');
    this.saveStageButton = q('save-stage'); this.openStageButton = q('open-stage'); this.archiveButton = q('export-archive');
    this.librarySelect.onchange = () => this._syncControls();
    this.saveStageButton.onclick = () => this._runLibraryTask(async () => {
      const record = this._captureStage();
      const id = await this.stageLibrary.save(record);
      await this._refreshLibrary(id);
      this.libraryStatus.textContent = `「${record.name}」を音楽ごと保存しました。`;
    });
    this.openStageButton.onclick = () => this._runLibraryTask(async () => {
      const record = await this.stageLibrary.get(this.librarySelect.value);
      await this._restoreSaved(record);
      this.libraryStatus.textContent = `「${record.name}」を開きました。STARTで遊べます。`;
    });
    this.archiveButton.onclick = () => this._runLibraryTask(async () => {
      const record = this._captureStage();
      this._download(createStageArchive(record), record.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '.soundstage');
      this.libraryStatus.textContent = '音楽入りのステージファイルを書き出しました。';
    });
    q('archive-file').onchange = e => {
      const file = e.target.files[0];
      if (file) this._runLibraryTask(async () => {
        const record = await readStageArchive(file);
        await this._restoreSaved(record);
        try {
          const id = await this.stageLibrary.save(record);
          await this._refreshLibrary(id);
          this.libraryStatus.textContent = `「${record.name}」を読み込み、保存一覧に追加しました。`;
        } catch (error) {
          this.libraryStatus.textContent = `ステージは開きました。一覧への保存はできませんでした：${error.message}`;
        }
      }).finally(() => { e.target.value = ''; });
    };
    this.courseSelect = q('course'); this.courseDescription = q('course-description');
    this.travelSpeedInput = q('travel-speed'); this.travelSpeedValue = q('travel-speed-value');
    this.travelSpeedInput.value = this.travelSpeed;
    this.travelSpeedValue.textContent = this.travelSpeed.toFixed(1);
    this.travelSpeedInput.oninput = e => this.setTravelSpeed(Number(e.target.value));
    q('repeat').value = this.repeat;
    q('repeat').onchange = e => { this.repeat = e.target.value; this._saveView(); };
    this.courseSelect.onchange = () => this.setCourse(this.courseSelect.value);
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
    q('camera-mode').value = this.cameraMode;
    q('camera-mode').onchange = e => this._setView({ camera: e.target.value });
    this.cameraDistanceInput = q('camera-distance');
    this.cameraDistanceValue = q('camera-distance-value');
    this.cameraDistanceInput.value = this.cameraDistance;
    this.cameraDistanceInput.oninput = e => this._setView({ distance: Number(e.target.value) });
    // Hand the keys back to the game after dragging the slider mid-song.
    this.cameraDistanceInput.onchange = e => { if (this.isRunning) e.target.blur(); };
    q('show-guide').checked = this.showGuide;
    q('show-guide').onchange = e => this._setView({ guide: e.target.checked });
    this.exportButton.onclick = () => {
      const blob = new Blob([serializeStage(this.chart, this.offsetMs, this.laneCount)], { type: 'application/json' });
      this._download(blob, `${this.audioManager.meta.name.replace(/\.[^.]+$/, '')}-${this.chart.generation?.difficulty || 'chart'}.json`);
    };
    q('stage-file').onchange = e => {
      const file = e.target.files[0];
      if (file) this._runTask(async () => {
        if (file.size > 2_000_000) throw new Error('譜面ファイルは2 MB以内にしてください');
        const { chart, offsetMs, laneCount } = parseStage(await file.text(), this.audioManager.meta, this.laneData.laneId,
          [this.originalLane.laneId, ...PREVIEW_COURSES.map(course => course.laneId)]);
        const moved = this._useSavedCourse(chart, laneCount);
        this.offsetMs = offsetMs; q('offset').value = offsetMs;
        this._useChart(chart);
        this.status.textContent += moved ? ` · 片道コースは選べなくなったため「${this.laneData.name}」で開きました` : ' · 保存譜面を読み込みました';
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
    timing.innerHTML = '<p>目印が判定バーと重なったら、表示された文字のキー（コントローラーではボタン）を押す</p><canvas width="1000" height="120" aria-label="次に押すキーとタイミング"></canvas>';
    this.timingCanvas = timing.querySelector('canvas');
    this.timingStrip = timing;
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
    this._timingTime = time;
    ctx.clearRect(0, 0, w, 120);
    ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this.parallelLanes.lanes.forEach((lane, i) => {
      const y = (i + 0.5) * 120 / this.laneCount;
      ctx.fillStyle = '#' + lane.color.toString(16).padStart(6, '0');
      ctx.globalAlpha = 0.3; ctx.fillRect(125, y, w - 125, 1); ctx.globalAlpha = 1;
      lane.keys.forEach((key, k) => {
        ctx.fillStyle = '#' + laneForKey(key).color.toString(16).padStart(6, '0');
        ctx.fillText(keyLabel(key, this.inputMode), 60 + (k - (lane.keys.length - 1) / 2) * 26, y);
      });
    });
    ctx.fillStyle = '#302d29'; ctx.fillRect(160, 2, 2, 116);
    const notes = (this.isRunning ? this.play?.chart : this.chart)?.notes || [];
    for (const note of notes) {
      const dt = note.t - time;
      if (note.judged || dt < -0.3 || dt > 3) continue;
      const x = 160 + dt / 3 * (w - 180);
      const lane = laneForKey(note.key), row = this.parallelLanes.laneForKey(note.key).index;
      const y = (row + 0.5) * 120 / this.laneCount;
      ctx.fillStyle = '#' + lane.color.toString(16).padStart(6, '0'); ctx.fillRect(x - 13, y - 12, 26, 24);
      ctx.fillStyle = '#ffffff'; ctx.fillText(keyLabel(note.key, this.inputMode), x, y);
    }
  }

  dispose() {
    this.stop(); this.musicalProvider.cancel();
    document.removeEventListener('keydown', this._boundKeyDown);
    window.removeEventListener('gamepadconnected', this._boundPadConnected);
    cancelAnimationFrame(this._padFrameId);
    this.noteRenderer?.dispose(); this.characterField?.dispose(); this.laneRenderer?.dispose(); this.playerCursor?.dispose();
    this.renderer?.dispose(); this.audioManager?.dispose();
    this.stageLibrary.close();
  }
}
