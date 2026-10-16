// Xbox layout on the standard Gamepad mapping. The face buttons form the same
// diamond as W/A/S/D: X left, Y top, A bottom, B right.
export const PAD_KEYS = { 2: 'A', 3: 'W', 0: 'S', 1: 'D' };
export const PAD_MENU = 9;
const PAD_LABELS = { A: 'X', W: 'Y', S: 'A', D: 'B' };

export const keyLabel = (key, mode = 'keyboard') => mode === 'pad' ? PAD_LABELS[key] : key;

// Browsers expose pads only by polling. Report each newly pressed button once,
// with how long ago the pad changed state so a slow frame does not delay the hit.
export class GamepadInput {
  constructor(onPress, { getPads = () => navigator.getGamepads?.() ?? [], now = () => performance.now() } = {}) {
    this.onPress = onPress;
    this.getPads = getPads;
    this.now = now;
    this.held = new Map();
  }

  poll() {
    for (const pad of this.getPads()) {
      if (!pad?.connected) continue;
      const held = this.held.get(pad.index) ?? new Set();
      const age = Math.min(0.05, Math.max(0, (this.now() - pad.timestamp) / 1000)) || 0;
      pad.buttons.forEach((button, i) => {
        if (!button.pressed) { held.delete(i); return; }
        if (held.has(i)) return;
        held.add(i);
        if (i in PAD_KEYS) this.onPress(PAD_KEYS[i], age);
        else if (i === PAD_MENU) this.onPress('MENU', age);
      });
      this.held.set(pad.index, held);
    }
  }
}
