import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/app.css'
import App from './App.tsx'

document.documentElement.style.setProperty('--ghost-mascot-url', `url("${import.meta.env.BASE_URL}ghost-mascot.svg?v=2")`)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
