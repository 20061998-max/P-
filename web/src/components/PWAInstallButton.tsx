'use client';

import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function PWAInstallButton({ label = 'Instalar App (Atalho)' }: { label?: string }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(standalone);
    setIsIOS(/iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()));

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (isInstalled) return null;

  async function handleInstall() {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
        return;
      }
    }
    setShowGuide(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleInstall}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors whitespace-nowrap"
      >
        <Smartphone className="h-4 w-4" />
        {label}
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 space-y-4">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Instalar atalho do App
            </h3>
            <p className="text-sm text-slate-600">
              {isIOS
                ? 'Toque no botão Compartilhar no Safari e escolha "Adicionar à Tela de Início".'
                : 'No menu do navegador, toque em "Instalar aplicativo" ou "Adicionar à tela inicial".'}
            </p>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
