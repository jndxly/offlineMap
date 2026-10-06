// 从 .datav/ 缓存生成项目用边界 GeoJSON -> public/standard-2024/
// 数据源: 阿里云 DataV GeoAtlas (areas_v3, 源自高德, 行政区划更新至 2024 年,
//         边界画法与官方标准地图一致: 藏南按传统习惯线, 含九段线与台湾)
// ⚠ 坐标系: DataV 数据为 GCJ-02 (已实测: 香港区界相对 OSM WGS84 偏移 +597m 正东,
//         与 GCJ-02 在香港的理论偏移一致; 川陕/晋冀内陆省界同样 ~400-500m 偏移)。
//         本脚本先做 GCJ-02 -> WGS84 反算, 再抽稀输出。
// 用法: node scripts/build-datav-boundaries.mjs
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';

const SRC = '.datav';
const OUT = 'public/standard-2024';
mkdirSync(OUT, { recursive: true });

/* ---------------- GCJ-02 -> WGS84 (标准公开算法) ---------------- */
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}
function gcjDelta(lng, lat) {
  // 偏移场仅定义在中国区域内, 域外为 0
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [0, 0];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLon(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [dLng, dLat];
}
// GCJ02 -> WGS84 (一阶近似, 偏移场平滑, 残差 < 1m)
const gcjToWgs = (lng, lat) => {
  const [dLng, dLat] = gcjDelta(lng, lat);
  return [lng - dLng, lat - dLat];
};

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

// 环 -> 线 (GCJ02->WGS84 反算, 去掉首尾重复闭合点, 抽稀)
const ringToLine = (ring, tol) => {
  let pts = ring;
  if (pts.length > 2) {
    const f = pts[0], l = pts[pts.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) pts = pts.slice(0, -1);
  }
  return simplify(pts.map(([lo, la]) => gcjToWgs(lo, la)), tol).map(([lo, la]) => [r5(lo), r5(la)]);
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

/* ---------------- 2. 省级行政区面 (排除九段线要素, GCJ->WGS84) ---------------- */
const provFeaturesRaw = full.features.filter((f) => f.properties.adcode !== '100000_JD');
const convGeom = (geom) => {
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map((ring) => ring.map(([lo, la]) => gcjToWgs(lo, la))) };
  }
  return {
    type: 'MultiPolygon',
    coordinates: geom.coordinates.map((poly) => poly.map((ring) => ring.map(([lo, la]) => gcjToWgs(lo, la)))),
  };
};
const provFeatures = provFeaturesRaw.map((f) => ({ ...f, geometry: convGeom(f.geometry) }));
saveFC('province-areas.json', provFeatures);

/* ---------------- 3. 省界线: 省级要素所有环 ---------------- */
const provinceLines = [];
for (const f of provFeaturesRaw) {
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
