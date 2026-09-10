import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { fileURLToPath, URL } from 'node:url'

// CJS 互操作：该插件是 CJS 产物（module.exports = { default: fn }），
// 本配置走 nodenext 语义，ESM 的 default 导入不会自动展开，直接用 require 取 .default
const require = createRequire(import.meta.url)
const cesium = require('vite-plugin-cesium').default

export default defineConfig({
  // cesium 插件负责拷贝 Cesium 的 Workers/Assets/Widgets/ThirdParty 静态资源，
  // 并注入 CESIUM_BASE_URL：瓦片与 Web Worker 都按这个路径取资源，缺了会白屏。
  plugins: [react(), cesium()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 前端只写/api/xxx，由dev server转发到后端
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // WebSocket 实时位置流：前端连 /ws/positions，dev server 转发到后端
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
      },
      // 高德 JS API：前端只写 /amap/xxx，由 dev server 转发到高德，避免暴露 key 来源与跨域
      '/amap': {
        target: 'https://webapi.amap.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/amap/, ''),
      },
    },
  },
  build: {
    // Cesium 单包体积远超 Vite 默认 500kB 告警阈值，调高避免无意义告警刷屏
    chunkSizeWarningLimit: 4096,
  },
})
