// One ordering and palette for the path, notes, cursor and timing guide.
export const LANE_SPACING = 0.36;
export const LANES = [
  { key: 'A', color: 0xff4488 },
  { key: 'W', color: 0x4488ff },
  { key: 'S', color: 0x44ff88 },
  { key: 'D', color: 0xffaa44 }
].map((lane, i) => ({ ...lane, offset: (i - 1.5) * LANE_SPACING }));

export function laneForKey(key) {
  const lane = LANES.find(lane => lane.key === key);
  if (!lane) throw new Error(`Unknown lane key: ${key}`);
  return lane;
}
