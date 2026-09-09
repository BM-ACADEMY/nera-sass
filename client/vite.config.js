import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward all /api/* requests to the local Express backend
      '/api': {
        target: 'http://localhost:3600',
        changeOrigin: true,
      },
      // Forward webhook routes too
      '/webhook': {
        target: 'http://localhost:3600',
        changeOrigin: true,
      },
      // Socket.io — must proxy both HTTP polling and WebSocket upgrade
      '/socket.io': {
        target: 'http://localhost:3600',
        changeOrigin: true,
        ws: true,  // enable WebSocket proxying
      },
      // Forward local static file uploads
      '/uploads': {
        target: 'http://localhost:3600',
        changeOrigin: true,
      },
    },
  },
})

