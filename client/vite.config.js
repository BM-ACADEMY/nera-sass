import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Dev proxy goes to the same backend the app calls (VITE_API_URL)
  const apiTarget = new URL(env.VITE_API_URL).origin

  return {
    plugins: [react()],
    server: {
      // Must match CORS_ORIGINS in server/.env
      port: Number(env.PORT),
      strictPort: true,
      proxy: {
        // Forward all /api/* requests to the local Express backend
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        // Forward webhook routes too
        '/webhook': {
          target: apiTarget,
          changeOrigin: true,
        },
        // Socket.io — must proxy both HTTP polling and WebSocket upgrade
        '/socket.io': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,  // enable WebSocket proxying
        },
        // Forward local static file uploads
        '/uploads': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
