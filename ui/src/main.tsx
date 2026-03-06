import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DeckPage } from './pages/DeckPage'
import { RecorderPage } from './pages/RecorderPage'

const isDeckRoute = window.location.pathname === '/deck' || window.location.pathname === '/deck/';
const isRecorderRoute = window.location.pathname === '/recorder' || window.location.pathname === '/recorder/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isRecorderRoute ? <RecorderPage /> : isDeckRoute ? <DeckPage /> : <App />}
  </StrictMode>,
)
