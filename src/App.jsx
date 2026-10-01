import { useEffect, useState } from 'react'
// import maplibregl from 'maplibre-gl';
import { Map, addProtocol, removeProtocol, setWorkerUrl } from "maplibre-gl";
import { Protocol } from 'pmtiles';
// import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import OfflineMap from './OfflineMap';

setWorkerUrl(workerUrl);
function App() {
  

  useEffect(() => {
    const protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);
    
    // 组件卸载时移除协议
    // return () => {
    //   removeProtocol("pmtiles");
    // };
  }, []);

  return <OfflineMap />;
}

export default App
