// 在 china-20260930.pmtiles 尾部寻找 gzip 流（叶目录 / 元数据 JSON / 根目录）
import { openSync, readSync, statSync } from 'fs';
import { gunzipSync } from 'zlib';

const PATH = 'public/china-20260930.pmtiles';
const size = statSync(PATH).size;
const fd = openSync(PATH, 'r');

const SCAN = 128 * 1024 * 1024; // 扫描最后 128MB
const start = size - SCAN;
const buf = Buffer.alloc(SCAN);
readSync(fd, buf, 0, SCAN, start);
console.log('file size', size, 'scan from', start);

// 找出所有 gzip 魔数位置 1f 8b 08
const positions = [];
for (let i = 0; i < SCAN - 3; i++) {
  if (buf[i] === 0x1f && buf[i + 1] === 0x8b && buf[i + 2] === 0x08) positions.push(i);
}
console.log('gzip magic count in tail:', positions.length);
console.log('first 5 @file-offset:', positions.slice(0, 5).map((p) => start + p));
console.log('last 5 @file-offset:', positions.slice(-5).map((p) => start + p));

// 对尾部每个候选尝试 gunzip（限制尝试数量，从后往前）
function tryGunzip(pos) {
  const maxLen = Math.min(SCAN - pos, 32 * 1024 * 1024);
  const candidates = [maxLen, 1 << 20, 1 << 16];
  for (const len of candidates) {
    try {
      return gunzipSync(buf.slice(pos, pos + len));
    } catch (e) {
      if (e.code !== 'Z_BUF_ERROR' && e.code !== 'Z_DATA_ERROR') {
        // stream 不完整，跳过
      }
    }
  }
  return null;
}

// 先看最后一个（可能是 metadata JSON 或目录）
for (const p of positions.slice(-8).reverse()) {
  const out = tryGunzip(p);
  if (!out) {
    console.log(`@${start + p}: (无法完整解压)`);
    continue;
  }
  const head = out.slice(0, 120).toString('latin1');
  console.log(`@${start + p}: len=${out.length} head=${JSON.stringify(head.slice(0, 100))}`);
}
