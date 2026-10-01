import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
   optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  plugins: [react()],
  server: { 
    //用来配置跨域
    proxy: {
      '/amap1': {
        target: 'http://127.0.0.1:3000',//目标服务器地址
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/amap1/, '')
      },
    }
  }
})
