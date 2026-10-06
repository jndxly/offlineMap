// 验证 GCJ-02 算法实现 (标准测试向量)
const GCJ_A = 6378245.0, GCJ_EE = 0.00669342162296594323;
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function transformLon(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}
function gcjDelta(lng, lat) {
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLon(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [dLng, dLat];
}

// coordtransform 库标准测试向量: wgs84togcj02(116.404, 39.915) === [116.410244, 39.916404]
// wgs84togcj02(121.473701, 31.230416)? 上海
const tests = [
  [116.404, 39.915, '北京 (期望 GCJ ≈ 116.410244, 39.916404)'],
  [121.473701, 31.230416, '上海'],
  [114.17, 22.30, '香港'],
  [91.7, 27.5, '达旺'],
];
for (const [lng, lat, name] of tests) {
  const [dLng, dLat] = gcjDelta(lng, lat);
  console.log(
    `${name}: delta (${dLng.toFixed(6)}, ${dLat.toFixed(6)}) -> GCJ (${(lng + dLng).toFixed(6)}, ${(lat + dLat).toFixed(6)}); ` +
    `偏移 ${(dLng * 111320 * Math.cos((lat * Math.PI) / 180)).toFixed(0)} m 东, ${(dLat * 111320).toFixed(0)} m 北`
  );
}
