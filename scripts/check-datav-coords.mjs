// 实测 DataV 行政边界的坐标系: 用 OSM pmtiles (WGS84) 的海岸线做参照
// 若 DataV 边界相对 OSM 海岸线有 ~400-700m 系统性偏移 -> GCJ-02; 若 <100m -> WGS84
// 方法: 取山东成山头 (122.68, 37.40) 与海南临高角 (109.7, 20.0) 两个海岸尖角,
//       对比 DataV 省界顶点与 OSM water 层多边形顶点的最近距离及方向
// 用法: node scripts/check-datav-coords.mjs
import { readFileSync, openSync, readSync } from 'fs';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Protobuf = require('pbf').default ?? require('pbf');

class NodeFileSource {
  constructor(path) { this.fd = openSync(path, 'r'); this.key = path; }
  getKey() { return this.key; }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length);
    readSync(this.fd, buf, 0, length, offset);
    const ab = new ArrayBuffer(length);
    new Uint8Array(ab).set(buf);
    return { data: ab };
  }
}
const p = new PMTiles(new NodeFileSource('public/china-20260930.pmtiles'));

// DataV 县级原始要素 (未抽稀, 顶点最密集, 与 DataV 服务端数据一致)
const counties = JSON.parse(readFileSync('.datav/county-features.json', 'utf8'));

function collectNearLines(fc, lon0, lat0, lon1, lat1) {
  const pts = [];
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        for (const [lo, la] of ring) {
          if (lo >= lon0 && lo <= lon1 && la >= lat0 && la <= lat1) pts.push([lo, la]);
        }
      }
    }
  }
  return pts;
}

// OSM water 层顶点 (z10 瓦片范围)
async function osmWaterNear(lon0, lat0, lon1, lat1) {
  const Z = 10;
  const tileXY = (lon, lat) => {
    const n = 2 ** Z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    return [x, y];
  };
  const [x0, y0] = tileXY(lon0, lat1); // 西北
  const [x1, y1] = tileXY(lon1, lat0); // 东南
  const pts = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const t = await p.getZxy(Z, tx, ty);
      if (!t || !t.data) continue;
      const vt = new VectorTile(new Protobuf(new Uint8Array(t.data)));
      const wl = vt.layers.water;
      if (!wl) continue;
      for (let i = 0; i < wl.length; i++) {
        const feat = wl.feature(i);
        if (feat.type !== 3) continue; // 面
        for (const ring of feat.loadGeometry()) {
          for (const pt of ring) {
            const n = 2 ** Z;
            const lo = ((tx + pt.x / wl.extent) / n) * 360 - 180;
            const la = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + pt.y / wl.extent)) / n))) * 180) / Math.PI;
            if (lo >= lon0 && lo <= lon1 && la >= lat0 && la <= lat1) pts.push([lo, la]);
          }
        }
      }
    }
  }
  return pts;
}

const distM = (a, b) => {
  const dLat = (a[1] - b[1]) * 111320;
  const dLon = (a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return [Math.sqrt(dLat * dLat + dLon * dLon), dLon, dLat];
};

/* ---------------- 标准 GCJ-02 偏移算法 (公开算法) ---------------- */
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
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [0, 0];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLon(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [dLng, dLat]; // WGS84 -> GCJ02 的偏移量
}
// GCJ02 -> WGS84 (一阶近似)
function gcjToWgs(lng, lat) {
  const [dLng, dLat] = gcjDelta(lng, lat);
  return [lng - dLng, lat - dLat];
}

for (const [name, box] of [
  ['山东成山头', [122.60, 37.32, 122.78, 37.50]],
  ['浙江象山港', [121.70, 29.72, 121.95, 29.95]],
  ['广东汕头南澳', [116.65, 23.25, 117.00, 23.55]],
  ['江苏连云港', [119.25, 34.55, 119.65, 34.85]],
  ['海南临高角', [109.60, 19.90, 109.80, 20.10]],
]) {
  const datavPts = collectNearLines(counties, ...box);
  const osmPts = await osmWaterNear(...box);
  console.log(`\n${name}: DataV 边界点 ${datavPts.length} 个, OSM 水域岸线点 ${osmPts.length} 个`);
  if (!datavPts.length || !osmPts.length) { console.log('  数据不足'); continue; }
  // 每个 DataV 点到 OSM 岸线的最近距离与位移方向
  const devs = [];
  const devsCorrected = [];
  for (const pt of datavPts) {
    let best = null;
    for (const q of osmPts) {
      const [d, dx, dy] = distM(pt, q);
      if (!best || d < best[0]) best = [d, dx, dy];
    }
    devs.push(best[0]);
    // GCJ-02 -> WGS84 反算后再测
    const wgs = gcjToWgs(pt[0], pt[1]);
    let bestC = Infinity;
    for (const q of osmPts) {
      const [d] = distM(wgs, q);
      if (d < bestC) bestC = d;
    }
    devsCorrected.push(bestC);
  }
  devs.sort((a, b) => a - b);
  devsCorrected.sort((a, b) => a - b);
  const med = devs[Math.floor(devs.length / 2)];
  const medC = devsCorrected[Math.floor(devsCorrected.length / 2)];
  const mid = datavPts[Math.floor(datavPts.length / 2)];
  const [dLng, dLat] = gcjDelta(mid[0], mid[1]);
  console.log(`  最近距离中位数: 原始 ${med.toFixed(0)} m, GCJ反算后 ${medC.toFixed(0)} m (n=${devs.length})`);
  console.log(`  该点 GCJ 理论偏移量: 东 ${dLng * 111320 * Math.cos(mid[1] * Math.PI / 180) > 0 ? '+' : ''}${(dLng * 111320 * Math.cos(mid[1] * Math.PI / 180)).toFixed(0)} m, 北 ${(dLat * 111320).toFixed(0)} m`);
  console.log(`  判定: ${medC < med - 100 ? 'DataV 为 GCJ-02 (反算后更贴合)' : medC > med + 100 ? 'DataV 为 WGS84 (反算后更偏离)' : '不明确'}`);
}
