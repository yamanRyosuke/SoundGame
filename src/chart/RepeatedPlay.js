import { Chart } from './Chart.js';

export const REPEAT_OPTIONS = ['1', '2', '3', 'endless'];
export const repeatCount = value => value === 'endless' ? Infinity : Math.max(1, Math.min(3, Number(value) || 1));

// The same chart, once per repetition of the song, shifted by the song length.
// Copies, so the chart that is saved and exported keeps its own judgements.
export function cycleNotes(notes, cycle, duration) {
  return notes.map(note => ({ ...note, t: Number((note.t + cycle * duration).toFixed(4)), judged: false, judgement: null, cycle }));
}

/**
 * The notes for one play with the song repeated `loops` times (Infinity for
 * endless). Only the current, previous and next repetitions are kept, so an
 * endless session does not grow without bound.
 */
export class RepeatedPlay {
  constructor(chart, duration, loops) {
    if (!(duration > 0)) throw new Error('曲の長さが不正です');
    this.source = chart.notes;
    this.duration = duration;
    this.loops = loops;
    this.length = loops * duration;
    this.chart = new Chart({ audio: chart.audio, laneId: chart.laneId, generation: chart.generation, notes: [] });
    this.cycles = 0;
    this.advance(0);
  }

  cycleAt(time) {
    return Math.min(this.loops - 1, Math.floor(Math.max(0, time) / this.duration));
  }

  /**
   * Make sure the next repetition is ready and drop ones that finished a whole
   * song ago (all of their notes are judged by then).
   * @returns {{ added: object[], removed: object[] }}
   */
  advance(time) {
    const current = this.cycleAt(time), added = [], removed = [];
    while (this.cycles < Math.min(this.loops, current + 2)) {
      const notes = cycleNotes(this.source, this.cycles++, this.duration);
      this.chart.notes.push(...notes);
      added.push(...notes);
    }
    const keepFrom = current - 1;
    if (keepFrom > 0 && this.chart.notes[0]?.cycle < keepFrom) {
      removed.push(...this.chart.notes.filter(note => note.cycle < keepFrom));
      this.chart.notes = this.chart.notes.filter(note => note.cycle >= keepFrom);
    }
    return { added, removed };
  }
}
