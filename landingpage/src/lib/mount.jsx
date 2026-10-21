import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import '../styles/global.css'

export function mount(app) {
  const el = document.getElementById('root')
  const tree = <StrictMode>{app}</StrictMode>
  // Production HTML is prerendered (see scripts/prerender.mjs); dev starts empty.
  if (el.firstElementChild) hydrateRoot(el, tree)
  else createRoot(el).render(tree)
}
