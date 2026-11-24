import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallPlatform = 'mobile' | 'ios' | 'androidtv' | 'webos';

export interface ApkBuildStatus {
  hasCompiledApk: boolean;
  filename: string;
  sizeBytes: number;
  updatedAt: string | null;
}

export function detectTvBrowserInfo(uaInput?: string) {
  const ua = uaInput ?? (typeof window !== 'undefined' ? window.navigator.userAgent : '');
  const uaLower = ua.toLowerCase();
  const win =
    typeof window !== 'undefined'
      ? (window as unknown as {
          PalmSystem?: unknown;
          webOSSystem?: unknown;
          tizen?: unknown;
        })
      : {};

  const isWebOS =
    Boolean(win.PalmSystem || win.webOSSystem) ||
    /web0s|webos|netcast|lg browser|lg smart/i.test(ua);

  const isTizen =
    Boolean(win.tizen) ||
    /tizen|smart-tv|smarttv|samsungbrowser.*tv/i.test(uaLower);

  const isAndroidTV =
    /android tv|googletv|bravia|aft[a-z0-9]|mibox|shield|tv bro|odin|puffintv|hisense.*tv|philips.*tv|tcl.*tv|android.*tv/i.test(
      uaLower
    );

  const isGenericSmartTv =
    /smart-tv|smarttv|hbbtv|nettv|viera|vidaa|roku|chromecast|crkey|xbox|playstation/i.test(
      uaLower
    );

  const isIOS = /iphone|ipad|ipod/.test(uaLower);
  const isSmartTv = isWebOS || isTizen || isAndroidTV || isGenericSmartTv;

  return {
    isIOS,
    isWebOS,
    isTizen,
    isAndroidTV,
    isSmartTv,
  };
}

export function isAppUrlRequested(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.get('mode') === 'app' ||
    params.get('tv') === '1' ||
    window.location.pathname === '/tv'
  );
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isNativeStandalone, setIsNativeStandalone] = useState(false);
  const [isAppModeUrl, setIsAppModeUrl] = useState(() => isAppUrlRequested());
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroidTV, setIsAndroidTV] = useState(false);
  const [isWebOS, setIsWebOS] = useState(false);
  const [isTizen, setIsTizen] = useState(false);
  const [isSmartTv, setIsSmartTv] = useState(false);
  const [apkStatus, setApkStatus] = useState<ApkBuildStatus | null>(null);

  useEffect(() => {
    const win = window as unknown as {
      PalmSystem?: unknown;
      webOSSystem?: unknown;
      navigator: Navigator & { standalone?: boolean };
    };

    const checkNativeStandalone = () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      win.navigator.standalone === true ||
      Boolean(win.PalmSystem || win.webOSSystem) ||
      window.navigator.userAgent.includes('TelaCastAndroidApp');

    setIsNativeStandalone(checkNativeStandalone());
    setIsAppModeUrl(isAppUrlRequested());

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => setIsNativeStandalone(checkNativeStandalone());
    const onPopState = () => setIsAppModeUrl(isAppUrlRequested());
    mediaQuery.addEventListener?.('change', onDisplayChange);
    window.addEventListener('popstate', onPopState);

    const detected = detectTvBrowserInfo();
    setIsIOS(detected.isIOS);
    setIsWebOS(detected.isWebOS);
    setIsTizen(detected.isTizen);
    setIsAndroidTV(detected.isAndroidTV);
    setIsSmartTv(detected.isSmartTv);

    fetch('/api/apk-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ApkBuildStatus | null) => {
        if (data) setApkStatus(data);
      })
      .catch(() => undefined);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsNativeStandalone(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      mediaQuery.removeEventListener?.('change', onDisplayChange);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const detectedPlatform: InstallPlatform = isWebOS
    ? 'webos'
    : isAndroidTV || isTizen || isSmartTv
      ? 'androidtv'
      : isIOS
        ? 'ios'
        : 'mobile';

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsNativeStandalone(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  const openTvAppMode = () => {
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.searchParams.set('mode', 'app');
    url.searchParams.set('tv', '1');
    window.history.pushState({}, '', url.toString());
    setIsAppModeUrl(true);
  };

  const exitTvAppMode = () => {
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.searchParams.delete('mode');
    url.searchParams.delete('tv');
    window.history.pushState({}, '', url.toString());
    setIsAppModeUrl(false);
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled: isNativeStandalone || isAppModeUrl,
    isNativeStandalone,
    isAppModeUrl,
    isIOS,
    isAndroidTV,
    isWebOS,
    isTizen,
    isSmartTv,
    detectedPlatform,
    apkStatus,
    install,
    openTvAppMode,
    exitTvAppMode,
  };
}
