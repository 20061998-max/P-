import { useEffect, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, Tv, X } from 'lucide-react';
import { ApkBuildStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface TvAutoInstallModalProps {
  packageType: 'apk' | 'webos';
  apkStatus: ApkBuildStatus | null;
  isInstallable: boolean;
  onInstallPwa: () => Promise<boolean>;
  onOpenTvMode: () => void;
  onClose: () => void;
}

export function triggerDirectDownload(url: string, suggestedFilename?: string) {
  const link = document.createElement('a');
  link.href = url;
  if (suggestedFilename) {
    link.download = suggestedFilename;
  }
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function TvAutoInstallModal({
  packageType,
  apkStatus,
  isInstallable,
  onInstallPwa,
  onOpenTvMode,
  onClose,
}: TvAutoInstallModalProps) {
  const [pwaTriggered, setPwaTriggered] = useState(false);

  const isCompiledApk = packageType === 'apk' && Boolean(apkStatus?.hasCompiledApk);
  const downloadedFile =
    packageType === 'webos'
      ? 'JogosDoMengao-LG-webOS.zip'
      : apkStatus?.filename || 'JogosDoMengao-v1.0.0.apk';

  async function handleInstallShortcutNow() {
    const accepted = await onInstallPwa();
    if (accepted) {
      setPwaTriggered(true);
    } else {
      onOpenTvMode();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tv-autoinstall-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-950 p-6 text-zinc-100 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#C8102E] text-white shrink-0">
              <Tv className="h-5 w-5" />
            </div>
            <div>
              <h3 id="tv-autoinstall-title" className="font-display text-xl font-bold text-white">
                Auto-Instalação para Smart TV
              </h3>
              <p className="text-xs text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Download iniciado: {downloadedFile}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-xs leading-relaxed text-zinc-200 space-y-2">
          {packageType === 'apk' ? (
            isCompiledApk ? (
              <>
                <p className="font-semibold text-white">
                  O instalador oficial (.apk) foi enviado para a memória da TV.
                </p>
                <p>
                  1. No navegador da TV (TV Bro / Downloader / Chrome), o instalador do Android abre
                  automaticamente ao concluir o download — basta pressionar{' '}
                  <strong className="text-white">OK &rarr; Instalar</strong> na confirmação do sistema.
                </p>
                <p className="text-zinc-400">
                  2. Ou use o botão abaixo para abrir e fixar o App agora mesmo direto no navegador
                  da TV sem precisar aguardar.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-amber-300">
                  Pacote de código Android baixado ({downloadedFile})
                </p>
                <p>
                  Para o Android TV abrir o instalador nativo <span className="font-mono">.apk</span>{' '}
                  sozinho, suba este repositório no GitHub para o{' '}
                  <span className="font-mono">GitHub Actions</span> compilar o APK automaticamente e
                  coloque em <span className="font-mono">public/downloads/JogosDoMengao.apk</span>.
                </p>
                <p className="text-zinc-300">
                  Enquanto isso, você já pode rodar e instalar o{' '}
                  <strong className="text-white">Modo Smart TV Nativo (PWA)</strong> direto aqui no
                  navegador da TV clicando abaixo!
                </p>
              </>
            )
          ) : (
            <>
              <p className="font-semibold text-white">
                Pacote LG webOS baixado ({downloadedFile})
              </p>
              <p>
                Em Smart TVs LG webOS / Samsung Tizen, você pode fixar este site na barra de apps
                pelo menu do navegador ou abrir imediatamente o modo TV abaixo.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            autoFocus
            onClick={handleInstallShortcutNow}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#C8102E] px-4 py-3 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
          >
            <ExternalLink className="h-4 w-4" />
            {isInstallable && !pwaTriggered
              ? 'Instalar e Abrir App na TV Agora'
              : 'Abrir Modo Smart TV Agora'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 cursor-pointer"
          >
            Continuar na página
          </button>
        </div>
      </div>
    </div>
  );
}

interface TvAutoInstallBannerProps {
  onOpenAppMode: () => void;
}

export function TvAutoInstallBanner({ onOpenAppMode }: TvAutoInstallBannerProps) {
  const { isSmartTv, isNativeStandalone, isWebOS, isInstallable, apkStatus, install } =
    usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [modalType, setModalType] = useState<'apk' | 'webos' | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if ((isSmartTv || params.get('autoinstall') === 'tv') && !isNativeStandalone && isInstallable) {
      // Exibe destaque imediato na TV para 1 clique com o controle remoto
    }
  }, [isSmartTv, isNativeStandalone, isInstallable]);

  if ((!isSmartTv && typeof window !== 'undefined' && !window.location.search.includes('tv=1')) || isNativeStandalone || dismissed) {
    return null;
  }

  async function handleAutoInstallTv() {
    if (isInstallable) {
      const ok = await install();
      if (ok) return;
    }
    const pkgType: 'apk' | 'webos' = isWebOS ? 'webos' : 'apk';
    triggerDirectDownload(
      pkgType === 'webos' ? '/api/download-webos' : '/api/download-apk',
      pkgType === 'webos' ? 'JogosDoMengao-LG-webOS.zip' : apkStatus?.filename
    );
    setModalType(pkgType);
  }

  return (
    <>
      <div className="border-b border-[#C8102E]/60 bg-gradient-to-r from-[#C8102E]/25 via-zinc-900 to-zinc-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3 text-xs sm:text-sm">
            <Tv className="h-5 w-5 text-[#C8102E] shrink-0" />
            <div>
              <span className="font-bold text-white">Smart TV detectada:</span>{' '}
              <span className="text-zinc-200">
                Instale o app na TV com 1 clique ou abra o Player TV em tela cheia.
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAutoInstallTv}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#C8102E] px-3.5 py-2 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Auto-Instalar na TV
            </button>
            <button
              type="button"
              onClick={onOpenAppMode}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 cursor-pointer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir Modo TV
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              aria-label="Dispensar aviso da Smart TV"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {modalType && (
        <TvAutoInstallModal
          packageType={modalType}
          apkStatus={apkStatus}
          isInstallable={isInstallable}
          onInstallPwa={install}
          onOpenTvMode={onOpenAppMode}
          onClose={() => setModalType(null)}
        />
      )}
    </>
  );
}
