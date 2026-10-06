// 检测 DataV 香港 (810000) 区级边界与 OSM (WGS84) 维多利亚港海岸线的偏移 (原始 vs GCJ反算)
import { readFileSync, openSync, readSync } from 'fs';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Protobuf = require('pbf').default ?? require('pbf');

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

class S {
  constructor(p) { this.fd = openSync(p, 'r'); this.key = p; }
  getKey() { return this.key; }
  async getBytes(o, l) {
    const b = Buffer.alloc(l);
    readSync(this.fd, b, 0, l, o);
    const ab = new ArrayBuffer(l);
    new Uint8Array(ab).set(b);
    return { data: ab };
  }
}
const p = new PMTiles(new S('public/china-20260930.pmtiles'));

// 维多利亚港一带
const BOX = [114.10, 22.24, 114.27, 22.36];
const hk = JSON.parse(readFileSync('.datav/810000_full.json', 'utf8'));
const datavPts = [];
for (const f of hk.features) {
  if (!f.geometry) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lo, la] of ring) {
        if (lo >= BOX[0] && lo <= BOX[2] && la >= BOX[1] && la <= BOX[3]) datavPts.push([lo, la]);
      }
    }
  }
}

const Z = 12;
const tileXY = (lon, lat) => {
  const n = 2 ** Z;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n)];
};
const [x0, y0] = tileXY(BOX[0], BOX[3]);
const [x1, y1] = tileXY(BOX[2], BOX[1]);
const osmPts = [];
for (let tx = x0; tx <= x1; tx++) {
  for (let ty = y0; ty <= y1; ty++) {
    const t = await p.getZxy(Z, tx, ty);
    if (!t || !t.data) continue;
    const vt = new VectorTile(new Protobuf(new Uint8Array(t.data)));
    const wl = vt.layers.water;
    if (!wl) continue;
    for (let i = 0; i < wl.length; i++) {
      const feat = wl.feature(i);
      if (feat.type !== 3) continue;
      for (const ring of feat.loadGeometry()) {
        for (const pt of ring) {
          if (pt.x <= 1 || pt.x >= wl.extent - 1 || pt.y <= 1 || pt.y >= wl.extent - 1) continue; // 瓦片边缘伪点
          const n = 2 ** Z;
          const lo = ((tx + pt.x / wl.extent) / n) * 360 - 180;
          const la = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + pt.y / wl.extent)) / n))) * 180) / Math.PI;
          if (lo >= BOX[0] && lo <= BOX[2] && la >= BOX[1] && la <= BOX[3]) osmPts.push([lo, la]);
        }
      }
    }
  }
}
console.log('香港维港: DataV 区界点', datavPts.length, ', OSM 岸线点', osmPts.length);

const distM = (a, b) => {
  const dLat = (a[1] - b[1]) * 111320;
  const dLon = (a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return [Math.sqrt(dLat * dLat + dLon * dLon), dLon, dLat];
};
const raw = [], corr = [];
for (const pt of datavPts) {
  let best = null, bestC = null;
  const w = gcjToWgs(pt[0], pt[1]);
  for (const q of osmPts) {
    const [d, dx, dy] = distM(pt, q);
    if (!best || d < best[0]) best = [d, dx, dy];
    const [dc, dxc, dyc] = distM(w, q);
    if (!bestC || dc < bestC[0]) bestC = [dc, dxc, dyc];
  }
  if (best) raw.push(best);
  if (bestC) corr.push(bestC);
}
raw.sort((a, b) => a[0] - b[0]);
corr.sort((a, b) => a[0] - b[0]);
const medR = raw[Math.floor(raw.length / 2)];
const medC = corr[Math.floor(corr.length / 2)];
console.log(`原始:   中位 ${medR[0].toFixed(0)} m (东 ${medR[1].toFixed(0)} m, 北 ${medR[2].toFixed(0)} m)`);
console.log(`GCJ反算: 中位 ${medC[0].toFixed(0)} m (东 ${medC[1].toFixed(0)} m, 北 ${medC[2].toFixed(0)} m)`);
console.log(medC[0] < medR[0] - 100 ? '✓ GCJ 修正有效' : '不明确');
