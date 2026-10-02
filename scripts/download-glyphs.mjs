// 下载 Noto Sans 字体 glyph 分片到 public/fonts，供离线地图文字标注使用
// 用法: node scripts/download-glyphs.mjs
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'fs';

const BASE = 'https://tiles.openfreemap.org/fonts';
const FONTS = [
  { stack: 'Noto Sans Regular', dir: 'NotoSansRegular' },
  { stack: 'Noto Sans Bold', dir: 'NotoSansBold' },
];
const RANGES = 256; // 0-255.pbf ... 每片覆盖 256 个 unicode 码点

async function download(stack, dir, range) {
  const name = `${range * 256}-${range * 256 + 255}.pbf`;
  const file = `public/fonts/${dir}/${name}`;
  if (existsSync(file) && statSync(file).size > 0) {
    // 校验已有文件是否为合法 PBF（防止之前误存的 HTML 错误页）
    const head = readFileSync(file).slice(0, 5).toString();
    if (head !== '<!DOC') return false;
  }
  const url = `${BASE}/${encodeURIComponent(stack)}/${name}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('empty body');
      if (buf.slice(0, 5).toString() === '<!DOC') throw new Error('got HTML page, not PBF');
      writeFileSync(file, buf);
      return true;
    } catch (e) {
      if (attempt === 3) console.error(`FAIL ${stack} ${name}: ${e.message}`);
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }
  return false;
}

let total = 0;
for (const { stack, dir } of FONTS) {
  mkdirSync(`public/fonts/${dir}`, { recursive: true });
  const jobs = [];
  for (let r = 0; r < RANGES; r++) jobs.push(r);
  // 8 并发
  const queue = [...jobs];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const r = queue.shift();
      if (await download(stack, dir, r)) total++;
    }
  });
  await Promise.all(workers);
  console.log(`done: ${stack} -> public/fonts/${dir}`);
}
console.log(`downloaded ${total} files`);
