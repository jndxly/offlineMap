// 验证 GCJ-02 修正效果: 用修正后的 province-areas.json 顶点对比 OSM (WGS84) 海岸线
// 修正前香港维港区界偏移中位数 597m (正东), 修正后应降至 <150m
import { readFileSync, openSync, readSync } from 'fs';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Protobuf = require('pbf').default ?? require('pbf');

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

const BOX = [114.10, 22.24, 114.27, 22.36];
const areas = JSON.parse(readFileSync('public/standard-2024/province-areas.json', 'utf8'));
const hk = areas.features.find((f) => f.properties.adcode === 810000);
const datavPts = [];
for (const poly of hk.geometry.type === 'Polygon' ? [hk.geometry.coordinates] : hk.geometry.coordinates) {
  for (const ring of poly) {
    for (const [lo, la] of ring) {
      if (lo >= BOX[0] && lo <= BOX[2] && la >= BOX[1] && la <= BOX[3]) datavPts.push([lo, la]);
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
          if (pt.x <= 1 || pt.x >= wl.extent - 1 || pt.y <= 1 || pt.y >= wl.extent - 1) continue;
          const n = 2 ** Z;
          const lo = ((tx + pt.x / wl.extent) / n) * 360 - 180;
          const la = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + pt.y / wl.extent)) / n))) * 180) / Math.PI;
          if (lo >= BOX[0] && lo <= BOX[2] && la >= BOX[1] && la <= BOX[3]) osmPts.push([lo, la]);
        }
      }
    }
  }
}
console.log('修正后香港维港: 边界点', datavPts.length, ', OSM 岸线点', osmPts.length);
const distM = (a, b) => {
  const dLat = (a[1] - b[1]) * 111320;
  const dLon = (a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return [Math.sqrt(dLat * dLat + dLon * dLon), dLon, dLat];
};
const ds = [];
for (const pt of datavPts) {
  let best = null;
  for (const q of osmPts) {
    const [d, dx, dy] = distM(pt, q);
    if (!best || d < best[0]) best = [d, dx, dy];
  }
  if (best) ds.push(best);
}
ds.sort((a, b) => a[0] - b[0]);
const med = ds[Math.floor(ds.length / 2)];
console.log(`最近距离中位数: ${med[0].toFixed(0)} m (修正前 597 m), 位移: 东 ${med[1].toFixed(0)} m 北 ${med[2].toFixed(0)} m`);
console.log(med[0] < 200 ? '✓ 修正生效' : '✗ 仍有偏移');
