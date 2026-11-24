import { useEffect, useState } from 'react';
import { Download, ExternalLink, Lock, Radio, ShieldCheck, Tv } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { DistributionCard } from './DistributionCard';
import { MengaoShield } from './MengaoShield';
import { PWAInstallButton } from './PWAInstallButton';
import { triggerDirectDownload, TvAutoInstallModal } from './TvAutoInstallModal';

interface LiveStatusInfo {
  isLive: boolean;
  title: string;
  sourceApp: string;
  viewerCount: number;
}

export function AppViewerView() {
  const [liveStatus, setLiveStatus] = useState<LiveStatusInfo | null>(null);
  const { apkStatus, isInstallable, install, openTvAppMode } = usePWAInstall();
  const [tvModalType, setTvModalType] = useState<'apk' | 'webos' | null>(null);

  useEffect(() => {
    const loadStatus = () => {
      fetch('/api/live/status')
        .then((res) => (res.ok ? res.json() : null))
        .then((data: LiveStatusInfo | null) => {
          if (data) setLiveStatus(data);
        })
        .catch(() => undefined);
    };
    loadStatus();
    const id = window.setInterval(loadStatus, 2500);
    return () => window.clearInterval(id);
  }, []);

  async function handleTvDownload(type: 'apk' | 'webos') {
    if (isInstallable) {
      await install().catch(() => false);
    }
    triggerDirectDownload(
      type === 'webos' ? '/api/download-webos' : '/api/download-apk',
      type === 'webos' ? 'JogosDoMengao-LG-webOS.zip' : apkStatus?.filename
    );
    setTvModalType(type);
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 space-y-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 space-y-6">
        <div className="flex items-start gap-4">
          <MengaoShield className="h-11 w-11 shrink-0" />
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-red-400">
              <Lock className="h-3.5 w-3.5" />
              <span>Acesso exclusivo fora do navegador comum</span>
            </div>
            <h1 className="mt-1 font-display text-3xl font-bold text-white">
              Jogos do Mengão rodam apenas no App e Smart TVs
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              A vitrine do site serve apenas para consultar valores, Pix, passo a passo e instalar o
              aplicativo. Para assistir aos jogos sem bloqueio, abra pelo atalho instalado ou baixe
              direto no navegador da sua Smart TV.
            </p>
          </div>
        </div>

        {liveStatus?.isLive && (
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs">
              <Radio className="h-4 w-4 animate-pulse text-emerald-400 shrink-0" />
              <div>
                <p className="font-bold text-white">
                  AO VIVO AGORA: {liveStatus.title}
                </p>
                <p className="text-emerald-200/80">
                  Fonte: {liveStatus.sourceApp} · {liveStatus.viewerCount} assistindo no App
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={openTvAppMode}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 font-mono text-[11px] font-semibold text-white hover:bg-emerald-600 cursor-pointer"
            >
              Abrir App Agora
            </button>
          </div>
        )}

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-300 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>Proteção Anti-Retransmissão Ativa</span>
          </div>
          <p>
            Não é permitido retransmitir ou capturar os jogos para terceiros: a retransmissão é
            liberada exclusivamente para Smart TVs (Android TV, LG webOS e Samsung Tizen).
          </p>
          <p className="text-zinc-400">
            Compatível com Android, iPhone/iPad (atalho PWA), Android TV (APK) e navegador direto da
            Smart TV.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <PWAInstallButton variant="primary" label="Instalar App / Atalho" />
          <button
            type="button"
            onClick={() => handleTvDownload('apk')}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            {apkStatus?.hasCompiledApk ? 'Baixar e Instalar APK TV' : 'APK Android / TV'}
          </button>
          <button
            type="button"
            onClick={() => handleTvDownload('webos')}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
          >
            <Tv className="h-3.5 w-3.5" />
            App LG webOS
          </button>
          <button
            type="button"
            onClick={openTvAppMode}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Modo Smart TV
          </button>
        </div>
      </div>

      {/* Auto-publicação do Site e APK na área de transmissão */}
      <DistributionCard appName="Jogos do Mengão" />

      {tvModalType && (
        <TvAutoInstallModal
          packageType={tvModalType}
          apkStatus={apkStatus}
          isInstallable={isInstallable}
          onInstallPwa={install}
          onOpenTvMode={openTvAppMode}
          onClose={() => setTvModalType(null)}
        />
      )}
    </div>
  );
}
