import { useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Smartphone, Tv, X } from 'lucide-react';
import { InstallPlatform, usePWAInstall } from '../hooks/usePWAInstall';
import { triggerDirectDownload, TvAutoInstallModal } from './TvAutoInstallModal';

interface PWAInstallButtonProps {
  variant?: 'primary' | 'outline';
  label?: string;
}

export function PWAInstallButton({
  variant = 'primary',
  label = 'Instalar App',
}: PWAInstallButtonProps) {
  const {
    isInstallable,
    isNativeStandalone,
    isSmartTv,
    detectedPlatform,
    apkStatus,
    install,
    openTvAppMode,
  } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [platformTab, setPlatformTab] = useState<InstallPlatform>('mobile');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [tvModalType, setTvModalType] = useState<'apk' | 'webos' | null>(null);

  useEffect(() => {
    setPlatformTab(detectedPlatform);
  }, [detectedPlatform]);

  if (isNativeStandalone) {
    return null;
  }

  async function handleClick() {
    if (isInstallable && (detectedPlatform === 'mobile' || isSmartTv)) {
      const ok = await install();
      if (ok) return;
    }
    setShowGuide(true);
  }

  async function handleTvDownloadAndAutoInstall(type: 'apk' | 'webos') {
    if (isInstallable) {
      await install().catch(() => false);
    }
    triggerDirectDownload(
      type === 'webos' ? '/api/download-webos' : '/api/download-apk',
      type === 'webos' ? 'JogosDoMengao-LG-webOS.zip' : apkStatus?.filename
    );
    setShowGuide(false);
    setTvModalType(type);
  }

  function handleCopyLink() {
    const tvLink = `${window.location.origin}/?mode=app&tv=1`;
    navigator.clipboard?.writeText(tvLink);
    setCopiedUrl(true);
    window.setTimeout(() => setCopiedUrl(false), 1800);
  }

  const btnStyle =
    variant === 'primary'
      ? 'bg-[#C8102E] text-white hover:bg-red-700'
      : 'border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800';

  const tabs: { id: InstallPlatform; label: string }[] = [
    { id: 'mobile', label: 'Android / PC' },
    { id: 'ios', label: 'iPhone / iPad' },
    { id: 'androidtv', label: 'Android TV' },
    { id: 'webos', label: 'TV LG webOS' },
  ];

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${btnStyle}`}
      >
        {isSmartTv ? <Tv className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
        {isSmartTv ? 'Instalar na TV' : label}
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <img
                  src="/pwa-192x192.png"
                  alt="Ícone do App Jogos do Mengão"
                  className="h-12 w-12 rounded-xl border border-zinc-700 object-cover shrink-0"
                />
                <div>
                  <h3
                    id="pwa-install-title"
                    className="font-display text-xl font-bold text-white"
                  >
                    Instalar App Jogos do Mengão
                  </h3>
                  <p className="mt-1 text-xs text-zinc-400">
                    Escolha seu celular ou Smart TV para instalar o atalho oficial com o escudo do Mengão.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                aria-label="Fechar instruções"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-900 p-1 sm:grid-cols-4">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPlatformTab(tab.id)}
                  className={`rounded-md px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                    platformTab === tab.id
                      ? 'bg-[#C8102E] text-white'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {platformTab === 'mobile' && (
              <div className="space-y-4">
                <ol className="space-y-2 text-sm text-zinc-200 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <li>1. Abra este endereço no Chrome ou Edge fora de pré-visualizações.</li>
                  <li>2. Toque no menu do navegador e selecione Instalar aplicativo.</li>
                  <li>3. Abra pelo ícone Jogos do Mengão criado para ativar e assistir.</li>
                </ol>
                {isInstallable && (
                  <button
                    type="button"
                    onClick={install}
                    className="w-full rounded-lg bg-[#C8102E] py-2.5 text-xs font-semibold text-white hover:bg-red-700"
                  >
                    Instalar atalho agora
                  </button>
                )}
              </div>
            )}

            {platformTab === 'ios' && (
              <ol className="space-y-2.5 text-sm text-zinc-200 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <li>1. Abra este site no navegador Safari do iPhone ou iPad.</li>
                <li>2. Toque no botão Compartilhar na barra inferior do Safari.</li>
                <li>3. Selecione Adicionar à Tela de Início e confirme em Adicionar.</li>
                <li>4. Abra o ícone Jogos do Mengão na tela inicial para assistir.</li>
              </ol>
            )}

            {platformTab === 'androidtv' && (
              <div className="space-y-3">
                <ol className="space-y-2 text-sm text-zinc-200 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <li>1. Baixe direto pelo navegador da sua Android TV (TV Bro / Odin / Chrome).</li>
                  <li>2. Ao concluir o download do APK, o instalador da TV abre para confirmar com OK.</li>
                  <li>3. Ou fixe/abra direto no navegador da TV pelo botão Modo TV abaixo.</li>
                </ol>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => handleTvDownloadAndAutoInstall('apk')}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#C8102E] py-2.5 px-3 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer"
                  >
                    <Download className="h-4 w-4" />
                    {apkStatus?.hasCompiledApk
                      ? 'Baixar e Auto-Instalar APK TV'
                      : 'Baixar Pacote Android TV'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowGuide(false);
                      openTvAppMode();
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 px-3 text-xs font-semibold text-white hover:bg-zinc-800 cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir Modo TV
                  </button>
                </div>
              </div>
            )}

            {platformTab === 'webos' && (
              <div className="space-y-3">
                <ol className="space-y-2 text-sm text-zinc-200 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <li>1. No navegador da TV LG (webOS) ou Samsung (Tizen), abra o link direto da TV.</li>
                  <li>2. Fixe nos aplicativos da TV ou baixe o pacote oficial LG webOS abaixo.</li>
                  <li>3. Smart TVs têm acesso liberado na trava anti-retransmissão.</li>
                </ol>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => handleTvDownloadAndAutoInstall('webos')}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#C8102E] py-2.5 px-3 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer"
                  >
                    <Tv className="h-4 w-4" />
                    Baixar e Instalar TV LG webOS
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowGuide(false);
                      openTvAppMode();
                    }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 py-2.5 px-3 text-xs font-semibold text-white hover:bg-zinc-800 cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir Modo TV
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800"
              >
                {copiedUrl ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    Link da TV copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copiar link direto da TV
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-700"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

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
    </>
  );
}
