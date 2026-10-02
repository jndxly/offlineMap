// 全文件扫描 china-20260930.pmtiles：用部分解压快速判断每个 gzip 流的内容类型
// 目的：确认文件中是否存在元数据 JSON（'{' 开头）或目录（varint 开头），即归档是否曾被完整生成
import { openSync, readSync, statSync } from 'fs';
import { gunzipSync, constants } from 'zlib';

const PATH = 'public/china-20260930.pmtiles';
const size = statSync(PATH).size;
const fd = openSync(PATH, 'r');

const CH = 8 * 1024 * 1024;
let jsonHits = [], dirHits = [], mvt = 0, failed = 0, total = 0;
let offset = 16384; // 跳过头部区
let prevTail = Buffer.alloc(0);

while (offset < size) {
  const len = Math.min(CH, size - offset);
  const buf = Buffer.alloc(len);
  readSync(fd, buf, 0, len, offset);
  const region = Buffer.concat([prevTail, buf]);
  const regionBase = offset - prevTail.length;

  for (let i = 0; i < region.length - 8; i++) {
    if (region[i] === 0x1f && region[i + 1] === 0x8b && region[i + 2] === 0x08) {
      total++;
      const win = Math.min(region.length - i, 4096);
      let out = null;
      try {
        out = gunzipSync(region.slice(i, i + win), { finishFlush: constants.Z_SYNC_FLUSH });
      } catch {
        failed++;
        continue;
      }
      if (!out || out.length === 0) { failed++; continue; }
      const c = out[0];
      if (c === 0x7b) {
        jsonHits.push(regionBase + i);
      } else if (c === 0x0a) {
        mvt++;
      } else {
        // 非 MVT 非 JSON：可能是目录（varint entryCount 开头）
        if (dirHits.length < 20) dirHits.push([regionBase + i, c, out.slice(0, 24).toString('hex')]);
      }
    }
  }
  prevTail = region.slice(region.length - 8);
  offset += len;
  if ((offset / CH) % 16 === 0) process.stderr.write(`\rscanned ${((offset) / 1073741824).toFixed(1)} GiB`);
}
process.stderr.write('\n');
console.log('total gzip candidates:', total, 'MVT:', mvt, 'failed:', failed);
console.log('JSON candidates:', jsonHits.slice(0, 20));
console.log('non-MVT non-JSON candidates (first 20):');
for (const d of dirHits) console.log(' ', d);
