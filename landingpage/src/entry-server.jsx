import { renderToString } from 'react-dom/server'
import Home from './pages/Home'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'

const pages = { home: Home, privacy: Privacy, terms: Terms }

export function render(page) {
  const Page = pages[page]
  return renderToString(<Page />)
}
