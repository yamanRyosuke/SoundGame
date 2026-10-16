import * as THREE from 'three';

// Paper-cutout doodles that pop out when a note is hit. Each judgement has its
// own cast, so a crowd of Perfect characters looks different from Good ones.
export const CHARACTER_CAST = {
  perfect: { files: ['character_d', 'character_e_1', 'character_i'], height: 1.1 },
  great: { files: ['character_j', 'character_h', 'character_g'], height: 0.9 },
  good: { files: ['character_a', 'character_b', 'character_c'], height: 0.75 }
};
export const MOTIONS = ['hop', 'roll', 'jelly', 'flip'];
const POP_TIME = 0.4;
// Characters stay where they land and keep playing there, so the next lap
// passes the crowd again. Past this many, the oldest shrinks away.
export const MAX_CHARACTERS = 80;
const PAPER = [255, 253, 247];

// A small deterministic generator, so a replay of the same hits looks the same.
export function seededRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

const smooth = p => p * p * (3 - 2 * p);

/**
 * Body pose for a motion `t` seconds after the character landed. Pure, so the
 * motions can be tested without a renderer.
 * - hop: bouncy jumps, stretched in the air and squashed on landing
 * - roll: rolls back and forth along the ground, turning with the distance
 * - jelly: stays put and wobbles like jelly
 * - flip: jumps and spins once around its vertical axis like a paper cutout
 * @returns {{ side: number, lift: number, scaleX: number, scaleY: number, roll: number, spin: number }}
 */
export function characterPose(motion, t, { radius = 0.3, phase = 0, reach = 0.8 } = {}) {
  const pose = { side: 0, lift: 0, scaleX: 1, scaleY: 1, roll: 0, spin: 0 };
  if (motion === 'hop') {
    const period = 0.72, p = ((t + phase) % period) / period;
    pose.lift = 0.45 * radius * 4 * p * (1 - p) * 2;
    // Stretch while rising, squash for a moment after landing.
    const impact = Math.max(0, 1 - p / 0.18) * Math.min(1, t / 0.2);
    const stretch = Math.sin(Math.PI * p) * 0.12;
    pose.scaleY = 1 - 0.28 * impact + stretch;
  } else if (motion === 'roll') {
    // Ping-pong along the ground; the roll angle follows the distance travelled.
    const p = (t + phase) * 0.45;
    pose.side = reach * Math.sin(p);
    pose.roll = -pose.side / radius;
    pose.lift = 0.04 * Math.abs(Math.sin(p * 6));
  } else if (motion === 'jelly') {
    const wobble = Math.sin((t + phase) * 9) * (0.1 + 0.05 * Math.sin((t + phase) * 1.3));
    pose.scaleY = 1 + wobble;
  } else if (motion === 'flip') {
    const period = 1.4, p = ((t + phase) % period) / period;
    const air = p < 0.5 ? p / 0.5 : 0;
    pose.lift = 0.9 * radius * 4 * air * (1 - air);
    pose.spin = smooth(air) * Math.PI * 2;
    const landing = p >= 0.5 ? Math.max(0, 1 - (p - 0.5) / 0.12) : 0;
    pose.scaleY = 1 - 0.22 * landing;
  }
  // Keep the area roughly constant, which reads as soft and squishy.
  pose.scaleX = 1 / Math.sqrt(Math.max(0.2, pose.scaleY));
  return pose;
}

// Ink stays as drawn; only the areas enclosed by ink get paper, so the
// characters are opaque cutouts while the outside stays transparent.
export function fillEnclosed(data, width, height) {
  const ink = i => data[i * 4 + 3] > 60;
  const outside = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const i = stack.pop();
    if (outside[i] || ink(i)) continue;
    outside[i] = 1;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < width * (height - 1)) stack.push(i + width);
  }
  for (let i = 0; i < width * height; i++) {
    if (outside[i] || ink(i)) continue;
    data[i * 4] = PAPER[0]; data[i * 4 + 1] = PAPER[1]; data[i * 4 + 2] = PAPER[2]; data[i * 4 + 3] = 255;
  }
}

async function loadCutout(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const size = 256, pad = 4;
  const aspect = image.naturalWidth / image.naturalHeight || 1;
  const width = Math.round(aspect >= 1 ? size : size * aspect), height = Math.round(aspect >= 1 ? size / aspect : size);
  const canvas = document.createElement('canvas');
  canvas.width = width + pad * 2; canvas.height = height + pad * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, pad, pad, width, height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  fillEnclosed(pixels.data, canvas.width, canvas.height);
  ctx.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: canvas.width / canvas.height };
}

export class CharacterField {
  constructor(baseUrl = './assets/characters/') {
    this.group = new THREE.Group();
    this.group.name = 'CharacterField';
    this.baseUrl = baseUrl;
    this.cutouts = new Map();
    this.characters = [];
    this.random = seededRandom(1);
    this.shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x302d29, transparent: true, opacity: 0.12, depthWrite: false });
    this.shadowGeometry = new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2);
  }

  // Load every cutout up front; a failed image only leaves that one out.
  async load() {
    const files = Object.values(CHARACTER_CAST).flatMap(cast => cast.files);
    await Promise.all(files.map(async file => {
      try {
        const { texture, aspect } = await loadCutout(`${this.baseUrl}${file}.svg`);
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
        this.cutouts.set(file, { material, aspect });
      } catch (error) {
        console.warn(`キャラクター画像を読み込めませんでした: ${file}`, error);
      }
    }));
  }

  /**
   * Pop a character for a judgement out of `from` (the hit note) onto a spot
   * beside the course a little ahead of the player, where it then stays.
   * Ahead, so the player sees it before passing it. Miss, or an unknown
   * judgement, spawns nothing.
   * @param {string} judgement
   * @param {THREE.Vector3} from - hit position
   * @param {(along: number, across: number) => THREE.Vector3} place - world
   *   position of a spot `along` ahead of the cursor and `across` from the centre line
   * @param {number} laneHalfWidth - half the width of all lanes
   * @param {number} now - seconds (performance clock)
   */
  spawn(judgement, from, place, laneHalfWidth, now) {
    const cast = CHARACTER_CAST[judgement];
    if (!cast) return null;
    const files = cast.files.filter(file => this.cutouts.has(file));
    if (!files.length) return null;
    const pick = list => list[Math.floor(this.random() * list.length)];
    const file = pick(files), { material, aspect } = this.cutouts.get(file);
    const height = cast.height * (0.9 + this.random() * 0.25), width = height * aspect;
    const side = this.random() < 0.5 ? -1 : 1;
    const target = place(0.8 + this.random() * 2.6, side * (laneHalfWidth + 0.35 + width / 2 + this.random() * 1.1));

    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.scale.set(width * 0.9, 1, Math.min(width, height) * 0.5);
    shadow.position.y = 0.005;
    root.add(shadow, body);
    root.position.copy(from);
    this.group.add(root);

    const character = {
      root, body, shadow, file, judgement, width, height, from: from.clone(), target, born: now,
      motion: pick(MOTIONS), params: { radius: Math.min(width, height) / 2, phase: this.random() * 2, reach: 0.25 + this.random() * 0.35 }
    };
    this.characters.push(character);
    while (this.characters.filter(c => !c.leaving).length > MAX_CHARACTERS) {
      this.characters.find(c => !c.leaving).leaving = now;
    }
    return character;
  }

  update(now, camera) {
    for (let i = this.characters.length - 1; i >= 0; i--) {
      const c = this.characters[i];
      if (c.leaving && now - c.leaving > 0.3) {
        this.group.remove(c.root);
        c.body.geometry.dispose();
        this.characters.splice(i, 1);
        continue;
      }
      this._pose(c, now, camera);
    }
  }

  _pose(c, now, camera) {
    const t = now - c.born;
    let scale = 1, base;
    if (t < POP_TIME) {
      // Leap from the hit note to its spot, growing with a little overshoot.
      const p = t / POP_TIME;
      base = c.from.clone().lerp(c.target, smooth(p));
      scale = Math.min(1.15, p * 1.6) - Math.max(0, p - 0.7) * 0.5;
      c.body.rotation.set(0, 0, (1 - p) * Math.PI * 2);
      c.body.scale.set(scale, scale, 1);
      c.body.position.set(0, c.height / 2 * scale + Math.sin(Math.PI * p) * 0.8, 0);
      c.shadow.scale.x = c.width * 0.9 * scale;
    } else {
      const pose = characterPose(c.motion, t - POP_TIME, c.params);
      base = c.target;
      if (c.leaving) scale = Math.max(0, 1 - (now - c.leaving) / 0.3);
      c.body.scale.set(pose.scaleX * scale, pose.scaleY * scale, 1);
      // Slide along the cutout's own horizontal, so rolling always turns the right way on screen.
      c.body.position.set(pose.side, (c.height / 2) * pose.scaleY * scale + pose.lift, 0);
      c.shadow.position.x = pose.side;
      c.body.rotation.set(0, pose.spin, pose.roll);
      c.shadow.scale.x = c.width * 0.9 * scale * (1 - Math.min(0.5, pose.lift));
    }
    c.root.position.copy(base);
    // Stand upright and turn toward the camera around the vertical axis only.
    if (camera) c.root.rotation.y = Math.atan2(camera.position.x - base.x, camera.position.z - base.z);
  }

  clear() {
    for (const c of this.characters) { this.group.remove(c.root); c.body.geometry.dispose(); }
    this.characters = [];
    this.random = seededRandom(1);
  }

  getObject() { return this.group; }

  dispose() {
    this.clear();
    for (const { material } of this.cutouts.values()) { material.map?.dispose(); material.dispose(); }
    this.shadowGeometry.dispose();
    this.shadowMaterial.dispose();
  }
}
