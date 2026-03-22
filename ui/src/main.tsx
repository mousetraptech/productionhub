import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DeckPage } from './pages/DeckPage'
import { RecorderPage } from './pages/RecorderPage'
import { WebhooksPage } from './pages/WebhooksPage'

const path = window.location.pathname.replace(/\/$/, '');

function getPage() {
  switch (path) {
    case '/deck': return <DeckPage />;
    case '/recorder': return <RecorderPage />;
    case '/webhooks': return <WebhooksPage />;
    default: return <App />;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {getPage()}
  </StrictMode>,
)
