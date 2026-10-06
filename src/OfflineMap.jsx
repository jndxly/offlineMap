import { useEffect, useRef, useState } from 'react';
import { Map, Marker, NavigationControl, ScaleControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { offlineStyle } from './mapStyle';
import markerRedUrl from './assets/marker_red.png';

// 数据范围（大陆: china-20260930.pmtiles [73.5, 18.1, 135.1, 53.6]
//          台湾: taiwan-261001.pmtiles [118.10, 20.73, 122.93, 26.60]，已包含在大陆范围内）
const BOUNDS = [73.5, 18.1, 135.1, 53.6];

// 解析用户输入的经纬度，支持 "116.39, 39.90" / "116.39,39.90" / "116.39 39.90" 等格式
function parseLngLat(input) {
  const parts = String(input)
    .replace(/[，；;、]/g, ' ')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

export default function OfflineMap() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const searchMarkerRef = useRef(null); // 用户搜索位置的红点标记
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new Map({
      container: mapContainer.current,
      style: offlineStyle,
      center: [116.3974, 39.9097], // 北京天安门
      zoom: 11,
      minZoom: 0,
      maxZoom: 14, // 数据最高到 z14
      maxBounds: [
        [BOUNDS[0] - 0.5, BOUNDS[1] - 0.4],
        [BOUNDS[2] + 0.5, BOUNDS[3] + 0.4],
      ],
      attributionControl: { compact: true },
    });

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    // 在指定位置添加 ⭐ 标记
    const STAR_LNG_LAT = [121.37, 31.13];
    const markerEl = document.createElement('div');
    markerEl.textContent = '⭐';
    markerEl.style.fontSize = '24px';
    markerEl.style.cursor = 'pointer';
    markerEl.title = '点击查看经纬度';

    const marker = new Marker({ element: markerEl })
      .setLngLat(STAR_LNG_LAT)
      .addTo(map);

    // 点击标记时打印当前经纬度信息
    markerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const lngLat = marker.getLngLat();
      console.log(`标记经纬度: 经度 ${lngLat.lng}, 纬度 ${lngLat.lat}`);
    });

    mapRef.current = map;
    if (import.meta.env.DEV) window.__offlineMap = map; // 便于调试

    return () => {
      marker.remove();
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    const lngLat = parseLngLat(query);
    if (!lngLat) {
      setError('请输入有效的经纬度，例如：116.397, 39.909');
      return;
    }
    setError('');
    const map = mapRef.current;
    if (!map) return;

    // 在用户输入的经纬度处放置/移动红色图片标记
    if (searchMarkerRef.current) {
      searchMarkerRef.current.setLngLat(lngLat);
    } else {
      const markerEl = document.createElement('img');
      markerEl.src = markerRedUrl;
      markerEl.alt = '搜索位置';
      markerEl.style.width = '25px';
      markerEl.style.height = '34px';
      markerEl.style.cursor = 'pointer';
      searchMarkerRef.current = new Marker({ element: markerEl })
        .setLngLat(lngLat)
        .addTo(map);
    }

    map.flyTo({ center: lngLat, zoom: 14 });
  };

  return (
    <div className="map-page">
      <form className="search-bar" onSubmit={handleSearch}>
        <input
          type="text"
          value={query}
          placeholder="输入经纬度（如：116.397, 39.909）"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit">搜索</button>
        {error && <span className="search-error">{error}</span>}
      </form>
      <div ref={mapContainer} className="map-view" />
    </div>
  );
}
