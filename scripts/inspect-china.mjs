// 深度解析 china-20260930.pmtiles：定位 gzip 流边界、尝试按 v3 目录解析
import { openSync, readSync, statSync } from 'fs';
import { createGunzip, inflateSync, gunzipSync } from 'zlib';

const PATH = 'public/china-20260930.pmtiles';
const fd = openSync(PATH, 'r');
const size = statSync(PATH).size;

function read(off, len) {
  const b = Buffer.alloc(len);
  const n = readSync(fd, b, 0, len, off);
  return b.slice(0, n);
}

// 1) 16384 处的 gzip 流：流式喂入直到结束，记录结束位置
const CH = 1 << 22;
const region = read(16384, CH);
const chunks = [];
const gun = createGunzip();
let ended = false;
gun.on('data', (c) => chunks.push(c));
const done = new Promise((res) => {
  gun.on('end', () => { ended = true; res(); });
  gun.on('error', (e) => { console.log('gunzip error:', e.message); res(); });
});
let consumed = 0;
for (let off = 0; off < CH; off += 4096) {
  gun.write(region.slice(off, off + 4096));
  consumed = off + 4096;
  if (ended) break;
  await new Promise((r) => setImmediate(r));
}
gun.end();
await done;
const data = Buffer.concat(chunks);
console.log('gzip stream at 16384: consumed bytes ~', consumed, ', decompressed len', data.length);
console.log('head hex:', data.slice(0, 48).toString('hex'));

// 2) 尝试按 v3 序列化目录解析解压结果
function readVarint(buf, pos) {
  let val = 0, shift = 0, p = pos;
  for (;;) {
    const b = buf[p++];
    val += shift < 28 ? (b & 0x7f) << shift : (b & 0x7f) * Math.pow(2, shift);
    if (b < 0x80) break;
    shift += 7;
    if (shift > 63) throw new Error('varint too long');
  }
  return [val, p];
}
try {
  let p = 0;
  let entryCount;
  [entryCount, p] = readVarint(data, p);
  console.log('directory entryCount =', entryCount);
  const entries = [];
  for (let i = 0; i < Math.min(entryCount, 5); i++) {
    let tileId, offset, length, runLength;
    [tileId, p] = readVarint(data, p);
    [offset, p] = readVarint(data, p);
    [length, p] = readVarint(data, p);
    [runLength, p] = readVarint(data, p);
    entries.push({ tileId, offset, length, runLength });
  }
  console.log('first entries:', entries);
} catch (e) {
  console.log('directory parse failed:', e.message);
}
