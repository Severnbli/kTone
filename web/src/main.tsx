import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isAndroidApp } from './platform';
import { registerServiceWorker } from './registerSW';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Android updates its packaged assets when the APK is updated.
if (import.meta.env.PROD && !isAndroidApp() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    registerServiceWorker().catch(() => undefined);
  });
}
