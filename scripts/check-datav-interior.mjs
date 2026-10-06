// 决定性判定 DataV 坐标系: 内陆省界对比 (数据集差异小, GCJ 偏移可清晰分辨)
// 在 川陕交界/晋冀交界 取 DataV 县界顶点, 与 OSM pmtiles boundary 层 admin_level=4 省界对比,
// 分别测量 原始/GCJ反算 后的最近距离
// 用法: node scripts/check-datav-interior.mjs
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

/* GCJ-02 标准算法 */
const GCJ_A = 6378245.0, GCJ_EE = 0.00669342162296594323;
function transformLat(x, y) {
  let r = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return r;
}
function transformLon(x, y) {
  let r = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  r += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  r += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return r;
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
  return [dLng, dLat];
}
const gcjToWgs = (lng, lat) => { const [dLng, dLat] = gcjDelta(lng, lat); return [lng - dLng, lat - dLat]; };

const distM = (a, b) => {
  const dLat = (a[1] - b[1]) * 111320;
  const dLon = (a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLon * dLon);
};

/* OSM boundary (admin_level=4 省界) 顶点, z11 */
async function osmProvinceBoundary(box) {
  const [lon0, lat0, lon1, lat1] = box;
  const Z = 11;
  const tileXY = (lon, lat) => {
    const n = 2 ** Z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
    return [x, y];
  };
  const [x0, y0] = tileXY(lon0, lat1);
  const [x1, y1] = tileXY(lon1, lat0);
  const pts = [];
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const t = await p.getZxy(Z, tx, ty);
      if (!t || !t.data) continue;
      const vt = new VectorTile(new Protobuf(new Uint8Array(t.data)));
      const bl = vt.layers.boundary;
      if (!bl) continue;
      for (let i = 0; i < bl.length; i++) {
        const feat = bl.feature(i);
        if (feat.properties.admin_level !== 4) continue; // 省界
        if (feat.type !== 2) continue;
        for (const line of feat.loadGeometry()) {
          for (const pt of line) {
            const n = 2 ** Z;
            const lo = ((tx + pt.x / bl.extent) / n) * 360 - 180;
            const la = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + pt.y / bl.extent)) / n))) * 180) / Math.PI;
            if (lo >= lon0 - 0.1 && lo <= lon1 + 0.1 && la >= lat0 - 0.1 && la <= lat1 + 0.1) pts.push([lo, la]);
          }
        }
      }
    }
  }
  return pts;
}

/* DataV 县界顶点 (未抽稀) */
const counties = JSON.parse(readFileSync('.datav/county-features.json', 'utf8'));
function datavNear(box) {
  const [lon0, lat0, lon1, lat1] = box;
  const pts = [];
  for (const f of counties.features) {
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

for (const [name, box] of [
  ['川陕交界(米仓山)', [106.8, 32.3, 107.5, 32.9]],
  ['晋冀交界(太行山)', [113.6, 37.2, 114.4, 37.9]],
]) {
  const osmPts = await osmProvinceBoundary(box);
  const datavPts = datavNear(box);
  console.log(`\n${name}: OSM 省界点 ${osmPts.length}, DataV 县界点 ${datavPts.length}`);
  if (!osmPts.length || !datavPts.length) { console.log('  数据不足'); continue; }
  const raw = [], corr = [];
  let near = 0;
  for (const pt of datavPts) {
    let best = Infinity;
    for (const q of osmPts) {
      const d = distM(pt, q);
      if (d < best) best = d;
    }
    if (best > 1500) continue; // 只取贴近省界的点, 排除盒内远处县界
    near++;
    let bestC = Infinity;
    const w = gcjToWgs(pt[0], pt[1]);
    for (const q of osmPts) {
      const dc = distM(w, q);
      if (dc < bestC) bestC = dc;
    }
    raw.push(best); corr.push(bestC);
  }
  console.log(`  贴近省界的 DataV 点: ${near} 个`);
  if (near < 10) { console.log('  样本不足'); continue; }
  raw.sort((a, b) => a - b); corr.sort((a, b) => a - b);
  const med = raw[Math.floor(raw.length / 2)], medC = corr[Math.floor(corr.length / 2)];
  const p90 = raw[Math.floor(raw.length * 0.9)], p90C = corr[Math.floor(corr.length * 0.9)];
  console.log(`  原始:   中位 ${med.toFixed(0)} m, p90 ${p90.toFixed(0)} m`);
  console.log(`  GCJ反算: 中位 ${medC.toFixed(0)} m, p90 ${p90C.toFixed(0)} m`);
  console.log(`  判定: ${medC < med - 100 ? 'DataV 为 GCJ-02' : medC > med + 100 ? 'DataV 为 WGS84' : '不明确'}`);
}
