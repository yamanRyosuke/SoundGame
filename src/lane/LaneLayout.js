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

export function validateLaneCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('レーン数は1〜4で指定してください');
  return count;
}

// Keep neighbouring keys together; assign the remainder to the inner lanes.
export function createLaneLayout(count = 4) {
  validateLaneCount(count);
  let nextKey = 0;
  return Array.from({ length: count }, (_, index) => {
    const size = Math.floor(4 / count) + (index < 4 % count ? 1 : 0);
    const keys = LANES.slice(nextKey, nextKey + size).map(lane => lane.key);
    nextKey += size;
    return { index, key: keys[0], keys, label: keys.join(' / '),
      color: keys.length === 1 ? laneForKey(keys[0]).color : 0xaab8d0,
      offset: (index - (count - 1) / 2) * LANE_SPACING };
  });
}
