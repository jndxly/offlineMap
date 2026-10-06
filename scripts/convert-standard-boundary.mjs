// 将 public/standard-2020 下的 SHP 边界数据转换为 WGS84 GeoJSON。
// 源数据投影: China Lambert Conformal Conic (2 标准纬线), Beijing 1954 / Krasovsky 椭球
//   标准纬线 30°/62°, 中央经线 105°, 无东移/北移偏量 (见 .prj)
// 输出: public/standard-2020/*.json (经纬度, 5 位小数, Douglas-Peucker 抽稀)
// 用法: node scripts/convert-standard-boundary.mjs
import { readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';

const DIR = 'public/standard-2020';

/* ---------------- Lambert Conformal Conic (2SP) 反投影 ---------------- */
const A = 6378245.0; // Krasovsky 1940 长半轴 (m)
const F = 1 / 298.3; // 扁率
const E2 = 2 * F - F * F;
const E = Math.sqrt(E2);
const LAT1 = (30 * Math.PI) / 180;
const LAT2 = (62 * Math.PI) / 180;
const LON0 = (105 * Math.PI) / 180;
const LAT0 = 0;

const mPhi = (lat) => Math.cos(lat) / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
const tPhi = (lat) =>
  Math.tan(Math.PI / 4 - lat / 2) /
  ((1 - E * Math.sin(lat)) / (1 + E * Math.sin(lat))) ** (E / 2);

const N = (Math.log(mPhi(LAT1)) - Math.log(mPhi(LAT2))) /
  (Math.log(tPhi(LAT1)) - Math.log(tPhi(LAT2)));
const FF = mPhi(LAT1) / (N * tPhi(LAT1) ** N);
const RHO0 = A * FF * tPhi(LAT0) ** N;

// 投影坐标 (m) -> [lon, lat] (度)
function inverseLCC(x, y) {
  const rho = Math.sqrt(x * x + (RHO0 - y) ** 2);
  const theta = Math.atan2(x, RHO0 - y);
  const t = (rho / (A * FF)) ** (1 / N);
  let lat = Math.PI / 2 - 2 * Math.atan(t); // 初值
  for (let i = 0; i < 16; i++) {
    const next =
      Math.PI / 2 -
      2 * Math.atan(t * ((1 - E * Math.sin(lat)) / (1 + E * Math.sin(lat))) ** (E / 2));
    if (Math.abs(next - lat) < 1e-13) { lat = next; break; }
    lat = next;
  }
  return [(theta / N + LON0) * (180 / Math.PI), (lat * 180) / Math.PI];
}

/* ---------------- 极简 SHP 读取 (BigEndian 头 + LittleEndian 记录) ---------------- */
// 返回 [{ kind: 'line'|'polygon', parts: [[ [x,y], ...], ... ] }] (投影坐标)
function readSHP(path) {
  const buf = readFileSync(path);
  let offset = 100; // 跳过 100 字节主文件头
  const features = [];
  while (offset + 8 <= buf.length) {
    const recLenWords = buf.readUInt32BE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + recLenWords * 2);
    offset += 8 + recLenWords * 2;
    if (body.length < 4) continue;
    const type = body.readInt32LE(0);
    if (type === 0) continue; // null shape
    if (type === 1 || type === 11 || type === 21) {
      // 点 (含 Z/M 变体, 仅取 X/Y)
      features.push({ kind: 'point', parts: [[[body.readDoubleLE(4), body.readDoubleLE(12)]]] });
      continue;
    }
    const base = type % 10; // 3 => 线, 5 => 面
    if (base !== 3 && base !== 5) throw new Error(`不支持的 shape type ${type}: ${path}`);
    const numParts = body.readInt32LE(36);
    const numPoints = body.readInt32LE(40);
    let p = 44;
    const parts = [];
    for (let i = 0; i < numParts; i++) parts.push(body.readInt32LE(p + i * 4));
    p += numParts * 4;
    const points = [];
    for (let i = 0; i < numPoints; i++) {
      points.push([body.readDoubleLE(p), body.readDoubleLE(p + 8)]);
      p += 16;
    }
    // 跳过 Z/M 附加字段 (不影响坐标)
    features.push({
      kind: base === 3 ? 'line' : 'polygon',
      parts: parts
        .map((start, i) => points.slice(start, i + 1 < parts.length ? parts[i + 1] : numPoints))
        .filter((ring) => ring.length > 1),
    });
  }
  return features;
}

/* ---------------- Douglas-Peucker 抽稀 ---------------- */
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

/* ---------------- 转换主流程 ---------------- */
function convert(shpName, outName, tolDeg) {
  const feats = readSHP(join(DIR, shpName));
  let inPts = 0, outPts = 0;
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const features = [];
  for (const f of feats) {
    const isPolygon = f.kind === 'polygon';
    const lines = f.parts
      .map((ring) => {
        inPts += ring.length;
        const geo = simplify(ring.map(([x, y]) => inverseLCC(x, y)), tolDeg).map(([lo, la]) => {
          if (lo < bbox[0]) bbox[0] = lo;
          if (la < bbox[1]) bbox[1] = la;
          if (lo > bbox[2]) bbox[2] = lo;
          if (la > bbox[3]) bbox[3] = la;
          return [r5(lo), r5(la)];
        });
        outPts += geo.length;
        // GeoJSON 面环要求首尾闭合
        if (isPolygon && geo.length >= 3) {
          const first = geo[0], last = geo[geo.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) geo.push([...first]);
        }
        return geo;
      })
      .filter((line) => (isPolygon ? line.length >= 4 : line.length >= 2));
    if (!lines.length) continue;
    let geometry;
    if (isPolygon) {
      // 每个 part 作为独立 polygon (标准地图数据基本无洞, 飞地单独成面)
      geometry =
        lines.length === 1
          ? { type: 'Polygon', coordinates: lines }
          : { type: 'MultiPolygon', coordinates: lines.map((ring) => [ring]) };
    } else {
      geometry =
        lines.length === 1
          ? { type: 'LineString', coordinates: lines[0] }
          : { type: 'MultiLineString', coordinates: lines };
    }
    features.push({ type: 'Feature', properties: {}, geometry });
  }
  const fc = { type: 'FeatureCollection', features };
  const outPath = join(DIR, outName);
  writeFileSync(outPath, JSON.stringify(fc));
  const sizeMB = statSync(outPath).size / 1024 / 1024;
  console.log(
    `${shpName} -> ${outName}: ${feats.length} 要素, 顶点 ${inPts} -> ${outPts}, ` +
      `bbox [${bbox.map((v) => v.toFixed(2)).join(', ')}], ${sizeMB.toFixed(2)} MB`
  );
}

convert('国界线.shp', 'national-boundary.json', 0.0002);
convert('线状省界.shp', 'province-boundary.json', 0.0005);
convert('线状县界.shp', 'county-boundary.json', 0.001);
convert('省级行政区.shp', 'province-areas.json', 0.0005);
