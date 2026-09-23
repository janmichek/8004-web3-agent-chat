import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT || 8787}`,
        changeOrigin: true,
      },
      '/mcp': {
        target: `http://localhost:${process.env.API_PORT || 8787}`,
        changeOrigin: true,
      },
    },
  },
})
