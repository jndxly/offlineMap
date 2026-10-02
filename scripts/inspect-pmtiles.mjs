import { readFileSync } from 'fs';
import { PMTiles } from 'pmtiles';

class NodeFileSource {
  constructor(path) {
    this.path = path;
    this.key = path;
  }
  getKey() { return this.key; }
  async getBytes(offset, length) {
    const buf = readFileSync(this.path);
    const ab = new ArrayBuffer(length);
    new Uint8Array(ab).set(buf.slice(offset, offset + length));
    return { data: ab };
  }
}

const p = new PMTiles(new NodeFileSource('public/china-20260930.pmtiles'));
const header = await p.getHeader();
console.log('header:', header);
const meta = await p.getMetadata();
console.log('metadata:', JSON.stringify(meta, null, 2));
