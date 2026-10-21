import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // Pre-bundle every Radix primitive up front so adding a shadcn component
    // never leaves the running dev server with an "Outdated Optimize Dep".
    optimizeDeps: {
      include: [
        '@radix-ui/react-alert-dialog',
        '@radix-ui/react-dialog',
        '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-select',
        '@radix-ui/react-slot',
        '@radix-ui/react-tooltip',
        'sonner',
        'socket.io-client',
      ],
    },
    server: {
      // Must match ADMIN_PANEL_URL / CORS_ORIGINS in server/.env
      port: Number(env.PORT),
      strictPort: true,
    },
  }
})
