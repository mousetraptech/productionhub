import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DeckPage } from './pages/DeckPage'

const isDeckRoute = window.location.pathname === '/deck' || window.location.pathname === '/deck/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDeckRoute ? <DeckPage /> : <App />}
  </StrictMode>,
)
