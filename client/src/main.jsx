import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './shadcn.css'
import './index.css'
import './alliance.css'
import App from './App.jsx'
import { installFriendlyAxiosErrors } from './services/axiosFriendly.js'

// Direct axios calls show plain-language errors too.
installFriendlyAxiosErrors()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
