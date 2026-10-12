import { startUpdates } from './lib/update';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './lib/install';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Offline support and installability. Skipped inside embedded previews.
const embedded = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
})();
if (!embedded && 'serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.MODE !== 'preview') {
  startUpdates();
}
