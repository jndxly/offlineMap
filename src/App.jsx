import { useEffect } from 'react';
import { addProtocol, removeProtocol, setWorkerUrl } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import OfflineMap from './OfflineMap';
import './App.css'

// maplibre-gl v6：worker 必须显式指定
setWorkerUrl(workerUrl);

function App() {
  useEffect(() => {
    // 注册 pmtiles:// 协议，浏览器内直接读取本地 .pmtiles 文件，无需服务端
    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);
    return () => removeProtocol('pmtiles');
  }, []);

  return <OfflineMap />;
}

export default App;
