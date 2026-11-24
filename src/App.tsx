/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { AdminView } from './components/AdminView';
import { AppShellView } from './components/AppShellView';
import { AppViewerView } from './components/AppViewerView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingView } from './components/LandingView';
import { MengaoShield } from './components/MengaoShield';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SubscriberView } from './components/SubscriberView';
import { TvAutoInstallBanner } from './components/TvAutoInstallModal';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  AppSettingsDoc,
  DEFAULT_PLANS,
  DEFAULT_SETTINGS,
  PlanItem,
  subscribePlans,
  subscribePublicSettings,
} from './lib/storeCatalog';
import { AppTab } from './types';

function MainApp() {
  const [activeTab, setActiveTab] = useState<AppTab>('inicio');
  const [preselectedPlan, setPreselectedPlan] = useState<string | undefined>(undefined);
  const [settings, setSettings] = useState<AppSettingsDoc>(DEFAULT_SETTINGS);
  const [plans, setPlans] = useState<PlanItem[]>(DEFAULT_PLANS);
  const { isInstalled, isSmartTv, openTvAppMode } = usePWAInstall();

  useEffect(() => {
    let serverConfigOverlay: Partial<AppSettingsDoc> = {};
    let serverPlansOverlay: PlanItem[] | undefined;

    const applyMerged = (next: AppSettingsDoc) => {
      setSettings({
        ...next,
        whatsappNumber: serverConfigOverlay.whatsappNumber || next.whatsappNumber,
        pixKey:
          serverConfigOverlay.pixKey && serverConfigOverlay.pixKey !== ''
            ? serverConfigOverlay.pixKey
            : next.pixKey,
        pixType: serverConfigOverlay.pixType || next.pixType,
        pixReceiverName: serverConfigOverlay.pixReceiverName || next.pixReceiverName,
        pixQrCodeDataUrl:
          serverConfigOverlay.pixQrCodeDataUrl && serverConfigOverlay.pixQrCodeDataUrl !== ''
            ? serverConfigOverlay.pixQrCodeDataUrl
            : next.pixQrCodeDataUrl,
        tvOnlyAntiRetransmission:
          typeof serverConfigOverlay.tvOnlyAntiRetransmission === 'boolean'
            ? serverConfigOverlay.tvOnlyAntiRetransmission
            : next.tvOnlyAntiRetransmission,
      });
    };

    const unsubSettings = subscribePublicSettings(applyMerged);
    const unsubPlans = subscribePlans(activeTab === 'admin', (firestorePlans) => {
      if (serverPlansOverlay && serverPlansOverlay.length > 0) {
        setPlans(
          activeTab === 'admin'
            ? serverPlansOverlay
            : serverPlansOverlay.filter((p) => p.active !== false)
        );
      } else {
        setPlans(firestorePlans);
      }
    });

    const initialBuildIdRef = { current: null as string | null };
    const lastConfigVersionRef = { current: null as number | null };

    const loadServerPublic = () => {
      fetch('/api/config/public', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (
            cfg: (Partial<AppSettingsDoc> & {
              customPlans?: PlanItem[];
              configVersion?: number;
            }) | null
          ) => {
            if (!cfg) return;
            serverConfigOverlay = cfg;
            if (typeof cfg.configVersion === 'number') {
              lastConfigVersionRef.current = cfg.configVersion;
            }
            if (Array.isArray(cfg.customPlans) && cfg.customPlans.length > 0) {
              serverPlansOverlay = cfg.customPlans;
              setPlans(
                activeTab === 'admin'
                  ? cfg.customPlans
                  : cfg.customPlans.filter((p) => p.active !== false)
              );
            }
            setSettings((prev) => ({
              ...prev,
              whatsappNumber: cfg.whatsappNumber || prev.whatsappNumber,
              pixKey: cfg.pixKey || prev.pixKey,
              pixType: cfg.pixType || prev.pixType,
              pixReceiverName: cfg.pixReceiverName || prev.pixReceiverName,
              pixQrCodeDataUrl:
                typeof cfg.pixQrCodeDataUrl === 'string' && cfg.pixQrCodeDataUrl
                  ? cfg.pixQrCodeDataUrl
                  : prev.pixQrCodeDataUrl,
              tvOnlyAntiRetransmission:
                typeof cfg.tvOnlyAntiRetransmission === 'boolean'
                  ? cfg.tvOnlyAntiRetransmission
                  : prev.tvOnlyAntiRetransmission,
            }));
          }
        )
        .catch(() => undefined);
    };

    const checkAppVersionAndSync = () => {
      fetch('/api/app/version', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((info: { buildId?: string; configVersion?: number } | null) => {
          if (!info) return;
          if (typeof info.configVersion === 'number') {
            if (
              lastConfigVersionRef.current !== null &&
              info.configVersion !== lastConfigVersionRef.current
            ) {
              loadServerPublic();
            }
            lastConfigVersionRef.current = info.configVersion;
          }
          if (info.buildId) {
            if (initialBuildIdRef.current === null) {
              initialBuildIdRef.current = info.buildId;
            } else if (initialBuildIdRef.current !== info.buildId) {
              initialBuildIdRef.current = info.buildId;
              if ('serviceWorker' in navigator) {
                void navigator.serviceWorker
                  .getRegistration()
                  .then((reg) => reg?.update())
                  .catch(() => undefined);
              }
              window.location.reload();
            }
          }
        })
        .catch(() => undefined);
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        loadServerPublic();
        checkAppVersionAndSync();
      }
    };

    loadServerPublic();
    checkAppVersionAndSync();
    const versionPollId = window.setInterval(checkAppVersionAndSync, 25000);
    window.addEventListener('mengao-catalog-refresh', loadServerPublic);
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      unsubSettings();
      unsubPlans();
      window.clearInterval(versionPollId);
      window.removeEventListener('mengao-catalog-refresh', loadServerPublic);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [activeTab]);

  // Navegação por controle remoto (D-Pad: setas + OK) para navegadores de Smart TVs
  useEffect(() => {
    const handleTvRemoteKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTextInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (isTextInput) return;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (tag === 'textarea' || tag === 'select') return;
      } else {
        return;
      }

      if (!isSmartTv && !isTextInput && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') {
        return;
      }

      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        )
      ).filter((el) => el.offsetParent !== null);

      if (focusables.length === 0) return;

      const idx = target ? focusables.indexOf(target) : -1;
      const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';

      if (isSmartTv || idx >= 0) {
        if (tag === 'input' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
        } else if (!isTextInput && isSmartTv) {
          e.preventDefault();
        } else {
          return;
        }
        const nextIdx =
          idx === -1
            ? 0
            : forward
              ? (idx + 1) % focusables.length
              : (idx - 1 + focusables.length) % focusables.length;
        focusables[nextIdx]?.focus();
        focusables[nextIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    };

    window.addEventListener('keydown', handleTvRemoteKey);
    return () => window.removeEventListener('keydown', handleTvRemoteKey);
  }, [isSmartTv]);

  function handleNavigate(tab: AppTab, plan?: string) {
    if (plan) setPreselectedPlan(plan);
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Quando aberto pelo atalho/app instalado, /?mode=app, /?tv=1 ou /tv, entra direto no App Player
  if (isInstalled) {
    return <AppShellView settings={settings} plans={plans} />;
  }

  const navItems: { id: AppTab; label: string }[] = [
    { id: 'inicio', label: 'Vitrine' },
    { id: 'assistir', label: 'Assistir' },
    { id: 'assinante', label: 'Ativação' },
    { id: 'admin', label: 'Painel Admin' },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-zinc-950 text-zinc-100">
      <TvAutoInstallBanner onOpenAppMode={openTvAppMode} />

      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 py-3">
          {/* Zone 1: Brand mark */}
          <button
            type="button"
            onClick={() => handleNavigate('inicio')}
            className="inline-flex items-center gap-2.5 font-display text-xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MengaoShield className="h-7 w-7 shrink-0" />
            <span>{settings.appName}</span>
          </button>

          {/* Zone 2: Clean single-line text navigation links */}
          <nav className="flex items-center gap-6 overflow-x-auto text-sm font-medium">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
                    active
                      ? 'border-[#C8102E] text-white font-semibold'
                      : 'border-transparent text-zinc-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="hidden sm:flex items-center shrink-0">
            <PWAInstallButton variant="primary" label="Instalar App" />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {activeTab === 'inicio' && (
          <LandingView settings={settings} plans={plans} onNavigate={handleNavigate} />
        )}
        {activeTab === 'assistir' && <AppViewerView />}
        {activeTab === 'assinante' && (
          <SubscriberView
            settings={settings}
            plans={plans}
            preselectedPlan={preselectedPlan}
          />
        )}
        {activeTab === 'admin' && <AdminView settings={settings} plans={plans} />}
      </main>

      <footer className="border-t border-zinc-800 bg-zinc-950">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-6 text-xs text-zinc-400 sm:flex-row sm:items-center">
          <span>
            {settings.appName} · Vitrine pública, gestão Google Admin e reprodução exclusiva no App e
            Smart TVs
          </span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={openTvAppMode}
              className="hover:text-white cursor-pointer"
            >
              Abrir Modo Smart TV
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
