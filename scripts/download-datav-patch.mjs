// 补丁: 1) 从省级 _full 提取直辖市区/港澳区级要素; 2) 慢速重试被限流(403)的市级数据
// 用法: node scripts/download-datav-patch.mjs
import { existsSync, writeFileSync, readFileSync, readdirSync } from 'fs';

const DIR = '.datav';

// 1) 从已缓存的省级 _full 提取 district 级要素 (直辖市辖区、海南直辖县、港澳区)
const provinces = JSON.parse(readFileSync(`${DIR}/100000_full.json`, 'utf8')).features
  .map((f) => f.properties)
  .filter((p) => /^\d{6}$/.test(String(p.adcode)));

const countyFeatures = [];
const directDistricts = new Set(); // 直辖市/直筒子市代码
for (const prov of provinces) {
  const file = `${DIR}/${prov.adcode}_full.json`;
  if (!existsSync(file)) continue;
  const fc = JSON.parse(readFileSync(file, 'utf8'));
  for (const f of fc.features) {
    const p = f.properties;
    if (p.level === 'district' && f.geometry) {
      countyFeatures.push(f);
      directDistricts.add(String(p.adcode));
    }
  }
}
console.log(`省级 _full 内含 district 级要素: ${countyFeatures.length} 个`);

// 2) 合并此前已下载的市级县要素 (跳过已被 directDistricts 覆盖的直辖市重复)
if (existsSync(`${DIR}/county-features.json`)) {
  const prev = JSON.parse(readFileSync(`${DIR}/county-features.json`, 'utf8'));
  for (const f of prev.features) {
    if (f.properties.level === 'district' && directDistricts.has(String(f.properties.adcode))) continue;
    countyFeatures.push(f);
  }
}
console.log(`合并后县级要素: ${countyFeatures.length} 个`);

// 3) 找出缺失的市: 重试 403 的; 404 的(直筒子市/省直辖县级市)直接用市级几何充当县界
const URL = (code) => `https://geo.datav.aliyun.com/areas_v3/bound/${code}_full.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const covered = new Set(countyFeatures.map((f) => String(f.properties.adcode)));
const missingCities = [];
const cityGeoms = new Map(); // adcode -> 市级要素 (直筒子市回退用)
for (const prov of provinces) {
  const file = `${DIR}/${prov.adcode}_full.json`;
  if (!existsSync(file)) continue;
  const fc = JSON.parse(readFileSync(file, 'utf8'));
  for (const f of fc.features) {
    const p = f.properties;
    if ((p.level === 'city' || p.level === 'district') && f.geometry) {
      cityGeoms.set(String(p.adcode), f);
      if (p.level === 'city') {
        const prefix = String(p.adcode).slice(0, 4);
        const hasChildren = [...covered].some((adcode) => adcode.startsWith(prefix) && adcode !== String(p.adcode));
        if (!hasChildren && !directDistricts.has(String(p.adcode))) {
          missingCities.push({ code: String(p.adcode), name: p.name });
        }
      }
    }
  }
}
console.log(`待重试市级: ${missingCities.length} 个`);

for (const city of missingCities) {
  let ok = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(URL(city.code), { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(await res.text());
      for (const f of json.features) {
        if (f.geometry) countyFeatures.push(f);
      }
      ok = true;
      console.log(`  ok: ${city.name} (${json.features.length} 县要素)`);
      break;
    } catch (e) {
      if (String(e.message).includes('404')) break; // 直筒子市, 无下级
      console.log(`  重试 ${attempt} 失败 ${city.name}: ${e.message}`);
      await sleep(2000 * attempt);
    }
  }
  if (!ok) {
    // 回退: 该市本身几何作为县界 (直筒子市/省直辖县级市, 市界即县界)
    const geom = cityGeoms.get(city.code);
    if (geom) {
      countyFeatures.push(geom);
      console.log(`  回退(市级几何充当县界): ${city.name}`);
    }
  }
  await sleep(800); // 限流保护
}

writeFileSync(`${DIR}/county-features.json`, JSON.stringify({ type: 'FeatureCollection', features: countyFeatures }));
console.log(`\n最终县级要素: ${countyFeatures.length} 个, 已保存 .datav/county-features.json`);
