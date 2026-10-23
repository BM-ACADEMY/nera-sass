// Renders each page to static HTML so content is visible to crawlers (and Meta's
// app review) before JavaScript runs. React then hydrates on top of it.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const ssrDir = path.join(root, 'dist-ssr')
const entry = fs.readdirSync(ssrDir).find((f) => /^entry-server\.m?js$/.test(f))
const { render } = await import(pathToFileURL(path.join(ssrDir, entry)).href)

const pages = { 'index.html': 'home', 'privacy-policy/index.html': 'privacy', 'terms/index.html': 'terms' }

for (const [file, page] of Object.entries(pages)) {
  const target = path.join(root, 'dist', file)
  const html = fs.readFileSync(target, 'utf8')
  if (!html.includes('<!--app-html-->')) throw new Error(`Missing <!--app-html--> in ${file}`)
  fs.writeFileSync(target, html.replace('<!--app-html-->', render(page)))
  console.log(`prerendered ${file}`)
}

fs.rmSync(ssrDir, { recursive: true, force: true })
