// 下载 DataV (areas_v3) 省市级区划数据到 .datav/，用于生成最新行政边界
// 用法: node scripts/download-datav.mjs
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

const DIR = '.datav';
mkdirSync(DIR, { recursive: true });

const URL = (code) => `https://geo.datav.aliyun.com/areas_v3/bound/${code}_full.json`;

async function fetchJson(code) {
  const file = `${DIR}/${code}_full.json`;
  if (existsSync(file)) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch { /* 重下 */ }
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(URL(code), { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const json = JSON.parse(text);
      if (!json.features?.length) throw new Error('空要素');
      writeFileSync(file, text);
      return json;
    } catch (e) {
      if (attempt === 3) { console.log(`  !! ${code} 下载失败: ${e.message}`); return null; }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

// 省级列表来自已下载的 100000_full.json
const nation = JSON.parse(readFileSync(`${DIR}/100000_full.json`, 'utf8'));
const provinces = nation.features
  .map((f) => f.properties)
  .filter((p) => /^\d{6}$/.test(String(p.adcode)) && p.adcode !== '100000_JD');
console.log(`省级行政区: ${provinces.length} 个`);

// 第一轮: 省级 -> 市级 adcode
const cityCodes = [];
for (const prov of provinces) {
  const fc = await fetchJson(prov.adcode);
  if (!fc) continue;
  for (const f of fc.features) {
    const p = f.properties;
    if (/^\d{6}$/.test(String(p.adcode))) cityCodes.push({ code: p.adcode, name: p.name, prov: prov.name });
  }
  console.log(`  ${prov.name}: ${fc.features.length} 下级`);
}
console.log(`市级单位: ${cityCodes.length} 个, 开始下载 (并发 12)...`);

// 第二轮: 并发下载市级 -> 县级要素
const CONCURRENCY = 12;
let done = 0;
const queue = [...cityCodes];
const countyFeatures = [];
const failures = [];
async function worker() {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    const fc = await fetchJson(item.code);
    if (fc) {
      for (const f of fc.features) {
        const p = f.properties;
        if (/^\d{6}$/.test(String(p.adcode)) && f.geometry) countyFeatures.push(f);
      }
    } else {
      failures.push(item);
    }
    done++;
    if (done % 50 === 0) console.log(`  进度 ${done}/${cityCodes.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`完成: 县级要素 ${countyFeatures.length} 个, 失败 ${failures.length} 个${failures.length ? ': ' + failures.map((f) => f.name).join(',') : ''}`);

// 缓存合并结果, 供后续生成脚本使用
writeFileSync(`${DIR}/county-features.json`, JSON.stringify({ type: 'FeatureCollection', features: countyFeatures }));
console.log('已保存 .datav/county-features.json');
