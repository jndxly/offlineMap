import { useEffect, useRef } from "react";
// import maplibregl from "maplibre-gl";
import { Map, addProtocol, removeProtocol, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// import Map from 'react-map-gl/maplibre';
// import 'maplibre-gl/dist/maplibre-gl.css';

export default function OfflineMap() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;

    mapRef.current = new Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          "my-offline-tiles": {
            type: "vector", // 如果是栅格瓦片，改为 "raster"
            // 关键：路径前必须加 pmtiles:// 前缀
            // 假设你的 output.pmtiles 放在 public 根目录下
            url: "pmtiles:///shanghai-260923.pmtiles",
          },
        },
        layers: [
          // 这里的图层配置取决于你的 PMTiles 内部结构
          // 你需要根据实际的 source-layer 名称来写
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#f8f4f0" },
          },
        ],
      },
      center: [121.37, 31.13],
      zoom: 10,
    });

    return () => mapRef.current?.remove();
  }, []);

  return <div ref={mapContainer} style={{ width: "100%", height: "100vh" }} />;
}

