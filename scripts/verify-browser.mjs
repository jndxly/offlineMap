// 用 playwright-core 打开页面，捕获控制台错误并截图
// 用法: node scripts/verify-browser.mjs [url]
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const url = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || '.verify-map.png';
// 可选: node verify-browser.mjs <url> <截图路径> <lng> <lat> <zoom>
const lng = process.argv[4], lat = process.argv[5], zoom = process.argv[6];
const browser = await chromium.launch({
  executablePath: 'C:/Users/yanju/.agent-browser/browsers/chrome-154.0.8037.92/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

page.on('console', (msg) => {
  const t = msg.type();
  if (t === 'error' || t === 'warning') console.log(`[console.${t}]`, msg.text().slice(0, 500));
});
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 800)));
page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure()?.errorText));

await page.goto(url, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(3000);
if (lng && lat && zoom) {
  await page.evaluate(
    ([lng, lat, zoom]) => {
      const canvas = document.querySelector('.maplibregl-canvas');
      // 通过双击/拖拽模拟太复杂，直接用 maplibre 实例
      const map = window.__offlineMap;
      if (map) map.jumpTo({ center: [+lng, +lat], zoom: +zoom });
    },
    [lng, lat, zoom]
  );
}
await page.waitForTimeout(8000);
await page.screenshot({ path: out });
console.log('screenshot saved:', out);
await browser.close();
