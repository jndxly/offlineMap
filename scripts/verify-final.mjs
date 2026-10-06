// 最终验证: 川陕边界渲染 + maxZoom
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const browser = await chromium.launch({
  executablePath: 'C:/Users/yanju/.agent-browser/browsers/chrome-154.0.8037.92/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
const r = await page.evaluate(() => {
  const map = window.__offlineMap;
  map.jumpTo({ center: [107.0, 32.6], zoom: 9 });
  return new Promise((resolve) => setTimeout(() => {
    const prov = map.queryRenderedFeatures({ layers: ['boundary-province'] });
    const nat = map.queryRenderedFeatures({ layers: ['boundary-national'] });
    const land = map.queryRenderedFeatures({ layers: ['official-land'] });
    resolve({ prov: prov.length, nat: nat.length, land: land.length, maxZoom: map.getMaxZoom() });
  }, 3000));
});
console.log(JSON.stringify(r));
console.log('console错误:', errs.length ? errs.slice(0, 3) : '无');
await browser.close();
