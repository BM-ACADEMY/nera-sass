import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))

const ROUTES = ['privacy-policy', 'terms']

// Serve /privacy-policy and /terms (no trailing slash, no .html) from their
// folder index in dev and preview, the way static hosts do in production.
function cleanRoutes() {
  const rewrite = (req, _res, next) => {
    const [path, query = ''] = req.url.split('?')
    const route = path.replace(/^\/|\/$/g, '')
    if (ROUTES.includes(route)) req.url = `/${route}/index.html${query && '?' + query}`
    next()
  }
  return {
    name: 'clean-routes',
    configureServer: (server) => { server.middlewares.use(rewrite) },
    configurePreviewServer: (server) => { server.middlewares.use(rewrite) },
  }
}

export default defineConfig(({ isSsrBuild }) => ({
  base: '/',
  plugins: [react(), cleanRoutes()],
  // gsap/lenis ship ESM without "type": "module", so bundle them for the prerender step
  ssr: { noExternal: ['gsap', '@gsap/react', 'lenis'] },
  build: isSsrBuild
    ? {}
    : {
        rollupOptions: {
          input: {
            main: r('./index.html'),
            ...Object.fromEntries(ROUTES.map((p) => [p, r(`./${p}/index.html`)])),
          },
        },
      },
}))
