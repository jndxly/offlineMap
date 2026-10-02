import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
   optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  plugins: [react()],
  server: {
    host: true, // 监听 0.0.0.0，允许局域网/外部通过本机 IP 访问
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
