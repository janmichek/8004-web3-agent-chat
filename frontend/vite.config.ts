import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
      process: 'process/browser',
    },
  },
  optimizeDeps: {
    include: ['buffer', 'process', '@web3auth/modal'],
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ['/api', '/mcp', '/a2a', '/.well-known/agent-card.json'].map((path) => [
        path,
        { target: `http://localhost:${process.env.API_PORT || 8787}`, changeOrigin: true },
      ]),
    ),
  },
})
