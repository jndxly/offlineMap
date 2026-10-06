// 从 .datav/ 缓存生成项目用边界 GeoJSON -> public/standard-2024/
// 数据源: 阿里云 DataV GeoAtlas (areas_v3, 源自天地图/民政部, 行政区划更新至 2024 年,
//         边界画法与官方标准地图一致: 藏南按传统习惯线, 含九段线与台湾)
// 用法: node scripts/build-datav-boundaries.mjs
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';

const SRC = '.datav';
const OUT = 'public/standard-2024';
mkdirSync(OUT, { recursive: true });

/* ---------------- Douglas-Peucker 抽稀 (与 convert-standard-boundary.mjs 一致) ---------------- */
function sqSegDist(p, a, b) {
  let x = a[0], y = a[1];
  const dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const tt = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (tt > 1) { x = b[0]; y = b[1]; }
    else if (tt > 0) { x += dx * tt; y += dy * tt; }
  }
  const ddx = p[0] - x, ddy = p[1] - y;
  return ddx * ddx + ddy * ddy;
}
function simplify(points, tolDeg) {
  const pts = points.filter((pt, i) => i === 0 || pt[0] !== points[i - 1][0] || pt[1] !== points[i - 1][1]);
  if (pts.length <= 2) return pts;
  const sqTol = tolDeg * tolDeg;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(pts[i], pts[first], pts[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sqTol) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
const r5 = (v) => Math.round(v * 1e5) / 1e5;

// 多边形几何 -> 环列表 (MultiPolygon 展开一层, 每个环是 [ [lon,lat], ... ])
const ringsOf = (geom) =>
  (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates).flat();

// 环 -> 线 (去掉首尾重复闭合点, 抽稀)
const ringToLine = (ring, tol) => {
  let pts = ring;
  if (pts.length > 2) {
    const f = pts[0], l = pts[pts.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) pts = pts.slice(0, -1);
  }
  return simplify(pts, tol).map(([lo, la]) => [r5(lo), r5(la)]);
};

function saveFC(name, features) {
  const path = `${OUT}/${name}`;
  writeFileSync(path, JSON.stringify({ type: 'FeatureCollection', features }));
  const sizeMB = statSync(path).size / 1024 / 1024;
  let pts = 0;
  for (const f of features) {
    const g = f.geometry;
    if (g.type === 'LineString') pts += g.coordinates.length;
    else pts += g.coordinates.reduce((s, l) => s + l.length, 0);
  }
  console.log(`${name}: ${features.length} 要素, ${pts} 顶点, ${sizeMB.toFixed(2)} MB`);
}

/* ---------------- 1. 国界线: 全国轮廓 + 九段线 ---------------- */
const outline = JSON.parse(readFileSync(`${SRC}/100000.json`, 'utf8'));
const nationFC = outline.features ? outline.features[0] : outline;
const full = JSON.parse(readFileSync(`${SRC}/100000_full.json`, 'utf8'));
const jd = full.features.find((f) => f.properties.adcode === '100000_JD');

const nationalLines = [];
for (const ring of ringsOf(nationFC.geometry)) {
  const line = ringToLine(ring, 0.0002);
  if (line.length >= 2) nationalLines.push(line);
}
for (const ring of ringsOf(jd.geometry)) {
  const line = ringToLine(ring, 0); // 九段线保持原精度
  if (line.length >= 2) nationalLines.push(line);
}
saveFC('national-boundary.json', [
  {
    type: 'Feature',
    properties: { name: '国界线(含九段线)' },
    geometry: { type: 'MultiLineString', coordinates: nationalLines },
  },
]);

/* ---------------- 2. 省级行政区面 (排除九段线要素) ---------------- */
const provFeatures = full.features.filter((f) => f.properties.adcode !== '100000_JD');
saveFC('province-areas.json', provFeatures);

/* ---------------- 3. 省界线: 省级要素所有环 ---------------- */
const provinceLines = [];
for (const f of provFeatures) {
  for (const ring of ringsOf(f.geometry)) {
    const line = ringToLine(ring, 0.0005);
    if (line.length >= 2) provinceLines.push(line);
  }
}
saveFC('province-boundary.json', [
  {
    type: 'Feature',
    properties: { name: '省界线' },
    geometry: { type: 'MultiLineString', coordinates: provinceLines },
  },
]);

/* ---------------- 4. 县界线 ---------------- */
const counties = JSON.parse(readFileSync(`${SRC}/county-features.json`, 'utf8'));
const countyLines = [];
for (const f of counties.features) {
  if (!f.geometry) continue;
  for (const ring of ringsOf(f.geometry)) {
    const line = ringToLine(ring, 0.005); // 县界容差加大, 控制 GeoJSON 体积 (z9+ 显示足够)
    if (line.length >= 2) countyLines.push(line);
  }
}
saveFC('county-boundary.json', [
  {
    type: 'Feature',
    properties: { name: '县界线' },
    geometry: { type: 'MultiLineString', coordinates: countyLines },
  },
]);

/* ---------------- 校验: 关键点位 ---------------- */
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inAreas = (pt) => provFeatures.some((f) => {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return polys.some((poly) => poly.some((ring, i) => (i === 0 ? pointInRing(pt, ring) : !pointInRing(pt, ring))));
});
for (const [name, pt] of [
  ['达旺(藏南)', [91.7, 27.5]],
  ['台北', [121.5, 25.05]],
  ['阿克赛钦', [79.5, 35.5]],
]) {
  console.log(`校验 ${name}: ${inAreas(pt) ? '✓ 在国土范围内' : '★ 异常'}`);
}
