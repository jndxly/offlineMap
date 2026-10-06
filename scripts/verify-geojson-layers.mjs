// 验证页面加载的 GeoJSON 数据源与图层状态
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const browser = await chromium.launch({
  executablePath: 'C:/Users/yanju/.agent-browser/browsers/chrome-154.0.8037.92/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => errors.push(`请求失败: ${r.url()}`));
await page.goto('http://localhost:5173/', { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
  const map = window.__offlineMap;
  if (!map) return { error: 'no map' };
  const style = map.getStyle();
  const geoSources = Object.entries(style.sources)
    .filter(([id, s]) => s.type === 'geojson')
    .map(([id, s]) => ({ id, url: s.data }));
  const layers = style.layers.filter((l) => String(l.id).includes('boundary') || l.id === 'official-land')
    .map((l) => ({ id: l.id, type: l.type, source: l.source, minzoom: l.minzoom }));
  // 查询渲染后的要素数量 (中心点周边)
  const counts = {};
  for (const l of layers) {
    if (l.type === 'line') {
      const feats = map.queryRenderedFeatures({ layers: [l.id] });
      counts[l.id] = feats.length;
    } else if (l.type === 'fill') {
      const feats = map.queryRenderedFeatures({ layers: [l.id] });
      counts[l.id] = feats.length;
    }
  }
  return { loaded: map.loaded(), geoSources, layers, counts };
});
console.log(JSON.stringify(info, null, 2));
console.log('控制台错误:', errors.length ? errors.slice(0, 5) : '无');
await browser.close();
