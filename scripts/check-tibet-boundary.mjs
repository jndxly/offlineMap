// 检查现有 pmtiles (OSM 数据) 中西藏/藏南一带的国界与官方标准地图 (GS(2020)4619) 的偏差。
// 用 @mapbox/vector-tile (与 maplibre 同源) 解码瓦片 boundary 层,
// 取 admin_level=2 的国界线, 与 national-boundary.json 官方国界逐点求最近距离。
// 用法: node scripts/check-tibet-boundary.mjs
import { readFileSync, openSync, readSync } from 'fs';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Protobuf = require('pbf').default ?? require('pbf');

class NodeFileSource {
  constructor(path) {
    this.path = path;
    this.key = path;
    this.fd = openSync(path, 'r'); // 2.6GB 文件不能用 readFileSync
  }
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

/* 官方国界 (GS(2020)4619), 取藏南一带: 经度 88-97, 纬度 26-29.5 */
const official = JSON.parse(readFileSync('public/standard-2020/national-boundary.json', 'utf8'));
const REGION = { lon0: 88, lon1: 97, lat0: 26, lat1: 29.5 };
const officialPts = [];
for (const f of official.features) {
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const line of lines) {
    for (const [lo, la] of line) {
      if (lo >= REGION.lon0 && lo <= REGION.lon1 && la >= REGION.lat0 && la <= REGION.lat1) {
        officialPts.push([lo, la]);
      }
    }
  }
}

/* 该区域 z8 瓦片范围 (x: 西->东, y: 北(小)->南(大)) */
const Z = 8;
const tileXY = (lon, lat) => {
  const n = 2 ** Z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return [x, y];
};
const [x0, y0] = tileXY(REGION.lon0, REGION.lat1); // 西北角
const [x1, y1] = tileXY(REGION.lon1, REGION.lat0); // 东南角

const tileToLngLat = (tx, ty, x, y, extent) => {
  const n = 2 ** Z;
  const lon = ((tx + x / extent) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + y / extent)) / n))) * 180) / Math.PI;
  return [lon, lat];
};

const osmLevel2 = []; // OSM 国界线 (admin_level=2) 顶点
const osmAll = [];    // OSM 全部边界线 (任意 admin_level) 顶点
const adminLevels = new Map();
let tileCount = 0;
for (let tx = x0; tx <= x1; tx++) {
  for (let ty = y0; ty <= y1; ty++) {
    const t = await p.getZxy(Z, tx, ty);
    if (!t || !t.data) continue;
    const vt = new VectorTile(new Protobuf(new Uint8Array(t.data)));
    const bl = vt.layers.boundary;
    if (!bl) continue;
    tileCount++;
    for (let i = 0; i < bl.length; i++) {
      const feat = bl.feature(i);
      const level = feat.properties.admin_level;
      adminLevels.set(level, (adminLevels.get(level) ?? 0) + 1);
      if (feat.type !== 2) continue;
      const geom = feat.loadGeometry();
      for (const line of geom) {
        for (const pt of line) {
          const [lo, la] = tileToLngLat(tx, ty, pt.x, pt.y, bl.extent);
          osmAll.push([lo, la]);
          if (level === 2) osmLevel2.push([lo, la]);
        }
      }
    }
  }
}

console.log(`官方国界顶点(藏南区域): ${officialPts.length}`);
console.log(`含 boundary 层的瓦片: ${tileCount}`);
console.log(`OSM boundary admin_level 分布:`, Object.fromEntries(adminLevels));
console.log(`OSM 国界线(admin_level=2)顶点: ${osmLevel2.length}, 全部边界顶点: ${osmAll.length}`);

if (!osmLevel2.length) {
  console.log('!! 该区域 OSM 数据无国界线, 无法对比');
  process.exit(0);
}

/* 距离 (km, 平面近似) */
const distKm = (a, b) => {
  const dLat = (a[1] - b[1]) * 111.32;
  const dLon = (a[0] - b[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.sqrt(dLat * dLat + dLon * dLon);
};
const nearest = (pt, pts) => {
  let best = Infinity;
  for (const q of pts) { const d = distKm(pt, q); if (d < best) best = d; }
  return best;
};

/* 官方边界点到 OSM 国界的最近距离 */
const devs = officialPts.map((pt) => ({ pt, d: nearest(pt, osmLevel2) }));
devs.sort((a, b) => b.d - a.d);
const mean = devs.reduce((s, x) => s + x.d, 0) / devs.length;
const p50 = devs[Math.floor(devs.length * 0.5)].d;
const p95 = devs[Math.floor(devs.length * 0.05)].d;
console.log(`\n官方国界点 -> OSM 国界(admin_level=2)最近距离: 均值 ${mean.toFixed(1)} km, p50 ${p50.toFixed(1)} km, p95 ${p95.toFixed(1)} km, 最大 ${devs[0].d.toFixed(1)} km`);
console.log('偏差最大的 8 个点 (经度, 纬度, 偏差km):');
for (const { pt, d } of devs.slice(0, 8)) console.log(`  ${pt[0].toFixed(3)}, ${pt[1].toFixed(3)}  ${d.toFixed(1)} km`);

/* 达旺: 官方标准地图中位于中国西藏境内 */
const TAWANG = [91.7, 27.5];
console.log(`\n达旺 (${TAWANG.join(', ')}) 距官方国界: ${nearest(TAWANG, officialPts).toFixed(1)} km, 距 OSM 国界: ${nearest(TAWANG, osmLevel2).toFixed(1)} km`);
