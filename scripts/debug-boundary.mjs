// 用 @mapbox/vector-tile (maplibre 同源解析器) 验证瓦片 boundary 层的真实内容
import { openSync, readSync } from 'fs';
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

for (const file of ['public/china-20260930.pmtiles', 'public/taiwan-261001.pmtiles']) {
  const p = new PMTiles(new S(file));
  for (const [z, x, y] of [[8, 209, 97], [8, 193, 107], [4, 13, 6]]) {
    const t = await p.getZxy(z, x, y);
    if (!t || !t.data) { console.log(`${file} z${z}/${x}/${y}: no tile`); continue; }
    const vt = new VectorTile(new Protobuf(new Uint8Array(t.data)));
    const names = Object.keys(vt.layers);
    let log = `${file} z${z}/${x}/${y}: layers=${names.join(',')}`;
    if (vt.layers.boundary) {
      const bl = vt.layers.boundary;
      let featInfo = [];
      for (let i = 0; i < Math.min(bl.length, 6); i++) {
        const f = bl.feature(i);
        const g = f.loadGeometry();
        featInfo.push(`{type:${f.type}, admin_level:${f.properties.admin_level}, geom:${g.length}段/${g.reduce((s, l) => s + l.length, 0)}点}`);
      }
      log += ` | boundary(${bl.length}): ${featInfo.join(' ')}`;
    }
    console.log(log);
  }
}
