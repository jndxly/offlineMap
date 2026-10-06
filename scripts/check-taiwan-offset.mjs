// 检测 DataV 台湾省界与 OSM (WGS84) 台湾东海岸的偏移
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
const p = new PMTiles(new S('public/taiwan-261001.pmtiles'));

// 台湾东海岸 (直线海岸, OSM 台湾社区制图质量高, WGS84)
const BOX = [121.2, 23.0, 121.9, 25.3];
const areas = JSON.parse(readFileSync('public/standard-2024/province-areas.json', 'utf8'));
const tw = areas.features.find((f) => f.properties.adcode === 710000);
const datavPts = [];
for (const poly of tw.geometry.coordinates) {
  for (const ring of poly) {
    for (const [lo, la] of ring) {
      if (lo >= BOX[0] && lo <= BOX[2] && la >= BOX[1] && la <= BOX[3]) datavPts.push([lo, la]);
    }
  }
}

const Z = 11;
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
          // 过滤瓦片裁剪产生的边缘伪点 (贴瓦片边界的点不是真实海岸线)
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
console.log('台湾东海岸: DataV 点', datavPts.length, ', OSM 岸线点', osmPts.length);

const distM = (a, b) => {
  const dLat = (a[1] - b[1]) * 111320;
  const dLon = (a[0] - b[0]) * 111320 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return [Math.sqrt(dLat * dLat + dLon * dLon), dLon];
};
const ds = [];
const samples = [];
for (const pt of datavPts) {
  let best = [Infinity, 0, null];
  for (const q of osmPts) {
    const [d, dx] = distM(pt, q);
    if (d < best[0]) best = [d, dx, q];
  }
  ds.push(best);
  samples.push({ datav: pt, osm: best[2], d: best[0] });
}
ds.sort((a, b) => a[0] - b[0]);
samples.sort((a, b) => a.d - b.d);
if (ds.length) {
  const med = ds[Math.floor(ds.length / 2)];
  console.log('最近距离中位数:', med[0].toFixed(0), 'm');
  console.log('贴合最好/中间/最差样本 (DataV点 -> OSM点):');
  for (const idx of [0, Math.floor(samples.length / 2), samples.length - 1]) {
    const s = samples[idx];
    console.log(`  DataV [${s.datav[0].toFixed(4)}, ${s.datav[1].toFixed(4)}] -> OSM [${s.osm ? s.osm[0].toFixed(4) : '-'}, ${s.osm ? s.osm[1].toFixed(4) : '-'}] 距离 ${s.d.toFixed(0)} m`);
  }
  // DataV 点纬度分布
  console.log('DataV 点纬度范围:', Math.min(...datavPts.map((p) => p[1])).toFixed(2), '-', Math.max(...datavPts.map((p) => p[1])).toFixed(2));
} else {
  console.log('无对比数据');
}
