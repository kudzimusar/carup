import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import PreviewProvenanceBanner from './components/PreviewProvenanceBanner.tsx'
import { applyShowroomFavicon } from './components/brand/showroomFavicon'

// RX03-P2-R4: Option 5 browser icon only with the showroom presentation on (no-op when OFF).
applyShowroomFavicon()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {/* Outside AuthProvider: an unpaired preview cannot authenticate, and the reason must still show. */}
      <PreviewProvenanceBanner />
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

if ('serviceWorker' in navigator && !navigator.webdriver) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => {
      console.log('Service Worker registration failed:', err);
    });
  });
}
