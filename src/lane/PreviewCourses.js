import { CatmullRomCurve3, Vector3 } from 'three';

const sample = (fn, count = 960, closed = false) => {
  const points = Array.from({ length: count + 1 }, (_, i) => fn(i / count));
  if (closed) points[count] = [...points[0]];
  return points;
};
const spline = points => {
  const curve = new CatmullRomCurve3(points.map(([x, z]) => new Vector3(x, 0, z)), true, 'centripetal');
  return sample(t => curve.getPoint(t).toArray(), 960, true);
};

// Versioned IDs keep exported stages tied to reproducible geometry.
export const PREVIEW_COURSES = [
  {
    laneId: 'preview_winding_v1', name: 'ワインディング',
    description: '長い直線と大小のカーブをつないだ周回コース。',
    points: spline([[-12, 6], [-14, 0], [-11, -6], [-4, -7], [0, -3], [5, -6], [12, -5], [14, 0], [10, 6], [4, 7], [0, 2], [-5, 6]])
  },
  {
    laneId: 'preview_clover_v1', name: 'クローバー',
    description: '4つの大きなふくらみと、くびれを巡るコース。',
    points: sample(t => {
      const a = t * Math.PI * 2, r = 10 + 2.5 * Math.cos(4 * a);
      return [r * Math.cos(a), 0, r * Math.sin(a)];
    }, 960, true)
  },
  {
    laneId: 'preview_switchbacks_v1', name: 'つづら折り',
    description: '5本の直線をヘアピンで折り返す、片道のロングコース。',
    points: (() => {
      const points = [];
      for (let row = 0; row < 5; row++) {
        const direction = row % 2 === 0 ? 1 : -1, z = -10 + row * 5;
        for (let i = 0; i <= 160; i++) points.push([direction * (-11 + 22 * i / 160), 0, z]);
        if (row < 4) for (let i = 1; i < 80; i++) {
          const a = i / 80 * Math.PI;
          points.push([direction * (11 + 2.5 * Math.sin(a)), 0, z + 2.5 * (1 - Math.cos(a))]);
        }
      }
      return points;
    })()
  },
  {
    laneId: 'preview_spiral_v1', name: 'スパイラル',
    description: '外側から中心へ、約3周かけて巻き込む片道コース。',
    points: sample(t => {
      const a = t * Math.PI * 6, r = 14 - 11 * t;
      return [r * Math.cos(a), 0, r * Math.sin(a)];
    }, 1440)
  },
  {
    laneId: 'preview_eight_v1', name: '立体8の字',
    description: '中央を立体交差で渡り、左右のループを巡るコース。',
    points: sample(t => {
      const a = t * Math.PI * 2;
      return [14 * Math.sin(a), 1.5 * (1 + Math.cos(a)), 8 * Math.sin(2 * a)];
    }, 960, true)
  }
];

export function getPreviewCourse(laneId) {
  return PREVIEW_COURSES.find(course => course.laneId === laneId);
}
