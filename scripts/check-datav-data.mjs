// 检查全国轮廓 100000.json 与九段线要素的结构
import { readFileSync } from 'fs';

const outline = JSON.parse(readFileSync('.datav/100000.json', 'utf8'));
console.log('100000.json:', outline.type, '要素数:', outline.features?.length ?? 1);
const of = outline.features ? outline.features[0] : outline;
console.log('  properties:', JSON.stringify(of.properties));
console.log('  geometry type:', of.geometry.type);
const polys = of.geometry.type === 'Polygon' ? [of.geometry.coordinates] : of.geometry.coordinates;
console.log('  polygon 数:', polys.length, '最大环点数:', Math.max(...polys.map((p) => p[0].length)));
const obbox = [Infinity, Infinity, -Infinity, -Infinity];
for (const poly of polys) for (const ring of poly) for (const [lo, la] of ring) {
  if (lo < obbox[0]) obbox[0] = lo; if (la < obbox[1]) obbox[1] = la;
  if (lo > obbox[2]) obbox[2] = lo; if (la > obbox[3]) obbox[3] = la;
}
console.log('  bbox:', obbox.map((v) => v.toFixed(2)).join(', '));

// 九段线要素 (100000_full.json 中的 100000_JD)
const full = JSON.parse(readFileSync('.datav/100000_full.json', 'utf8'));
const jd = full.features.find((f) => f.properties.adcode === '100000_JD');
console.log('\n九段线要素:');
console.log('  properties:', JSON.stringify(jd.properties));
console.log('  geometry type:', jd.geometry.type);
const jdPolys = jd.geometry.type === 'Polygon' ? [jd.geometry.coordinates] : jd.geometry.coordinates;
console.log('  polygon 数:', jdPolys.length, '各环点数:', jdPolys.map((p) => p[0].length).join(','));
const jbbox = [Infinity, Infinity, -Infinity, -Infinity];
for (const poly of jdPolys) for (const ring of poly) for (const [lo, la] of ring) {
  if (lo < jbbox[0]) jbbox[0] = lo; if (la < jbbox[1]) jbbox[1] = la;
  if (lo > jbbox[2]) jbbox[2] = lo; if (la > jbbox[3]) jbbox[3] = la;
}
console.log('  bbox:', jbbox.map((v) => v.toFixed(2)).join(', '));
