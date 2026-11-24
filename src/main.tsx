import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

let refreshingSw = false;
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshingSw) return;
    refreshingSw = true;
    window.location.reload();
  });
}

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    const checkUpdate = () => {
      void registration.update().catch(() => undefined);
    };
    window.setInterval(checkUpdate, 60 * 1000);
    window.addEventListener('focus', checkUpdate);
    window.addEventListener('online', checkUpdate);
  },
});

createRoot(document.getElementById('root')!).render(<App />);
