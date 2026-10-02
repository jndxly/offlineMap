import { useEffect, useRef } from 'react';
import { Map, NavigationControl, ScaleControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { offlineStyle } from './mapStyle';

// 数据范围（大陆: china-20260930.pmtiles [73.5, 18.1, 135.1, 53.6]
//          台湾: taiwan-261001.pmtiles [118.10, 20.73, 122.93, 26.60]，已包含在大陆范围内）
const BOUNDS = [73.5, 18.1, 135.1, 53.6];

export default function OfflineMap() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);

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

    mapRef.current = map;
    if (import.meta.env.DEV) window.__offlineMap = map; // 便于调试

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  return (
    <div
      ref={mapContainer}
      style={{ width: '100vw', height: '100vh' }}
    />
  );
}
