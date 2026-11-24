import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Globe,
  MessageCircle,
  RefreshCw,
  Share2,
  Smartphone,
  Tv,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { triggerDirectDownload, TvAutoInstallModal } from './TvAutoInstallModal';

export interface PublicDistributionConfig {
  autoPublishEnabled?: boolean;
  publishedSiteUrl?: string;
  publishedApkUrl?: string;
  publishedWebosUrl?: string;
  lastPublishedAt?: string | null;
}

interface DistributionCardProps {
  appName: string;
  adminToken?: string | null;
  compact?: boolean;
}

export function DistributionCard({ appName, adminToken, compact = false }: DistributionCardProps) {
  const [config, setConfig] = useState<PublicDistributionConfig>({});
  const [copiedField, setCopiedField] = useState<'site' | 'apk' | 'pwa' | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<string | null>(null);
  const [tvModalType, setTvModalType] = useState<'apk' | 'webos' | null>(null);

  const { apkStatus, isInstallable, install, openTvAppMode } = usePWAInstall();

  const fallbackOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const siteUrl = (config.publishedSiteUrl || fallbackOrigin).replace(/\/$/, '');
  const pwaUrl = siteUrl ? `${siteUrl}/?mode=app&tv=1` : '/?mode=app&tv=1';
  const apkUrl = config.publishedApkUrl || (siteUrl ? `${siteUrl}/api/download-apk` : '/api/download-apk');
  const webosUrl =
    config.publishedWebosUrl || (siteUrl ? `${siteUrl}/api/download-webos` : '/api/download-webos');

  async function loadPublicConfig() {
    try {
      const res = await fetch('/api/config/public');
      if (res.ok) {
        const data = (await res.json()) as PublicDistributionConfig;
        setConfig(data);
      }
    } catch {
      // mantém fallback local
    }
  }

  useEffect(() => {
    void loadPublicConfig();
  }, []);

  function copyLink(value: string, field: 'site' | 'apk' | 'pwa') {
    navigator.clipboard?.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 1800);
  }

  async function handleTvPackageDownload(type: 'apk' | 'webos') {
    if (isInstallable) {
      await install().catch(() => false);
    }
    triggerDirectDownload(
      type === 'webos' ? '/api/download-webos' : '/api/download-apk',
      type === 'webos' ? 'JogosDoMengao-LG-webOS.zip' : apkStatus?.filename
    );
    setTvModalType(type);
  }

  async function handleAutoPublishNow() {
    if (!adminToken) return;
    setPublishing(true);
    setPublishFeedback(null);
    try {
      const res = await fetch('/api/admin/auto-publicar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ siteUrl: fallbackOrigin }),
      });
      if (res.ok) {
        const data = (await res.json()) as { published: PublicDistributionConfig };
        setConfig(data.published);
        setPublishFeedback('Site e APK publicados automaticamente na área de transmissão!');
      } else {
        setPublishFeedback('Não foi possível publicar automaticamente.');
      }
    } catch {
      setPublishFeedback('Erro de conexão ao auto-publicar.');
    } finally {
      setPublishing(false);
    }
  }

  const shareMessage = `Acesse o ${appName} direto pelo navegador do celular ou Smart TV:\n\nSite Oficial: ${siteUrl}\nAbrir Modo TV / App: ${pwaUrl}\nAPK Android / TV: ${apkUrl}\nSmart TV LG webOS: ${webosUrl}`;
  const whatsappShareHref = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
            <Share2 className="h-3.5 w-3.5" />
            <span>
              Auto-Publicação Ativa · Site, Modo TV e APK na Área de Transmissão
            </span>
          </div>
          <h3 className="mt-1 font-display text-lg font-bold text-white">
            Links Oficiais do Site e Aplicativo ({appName})
          </h3>
          {config.lastPublishedAt && (
            <p className="text-[11px] text-zinc-400">
              Última publicação automática: {new Date(config.lastPublishedAt).toLocaleString('pt-BR')}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {adminToken && (
            <button
              type="button"
              onClick={handleAutoPublishNow}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#C8102E] px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${publishing ? 'animate-spin' : ''}`} />
              {publishing ? 'Publicando...' : 'Auto-Publicar Site e APK'}
            </button>
          )}
          <a
            href={whatsappShareHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600 whitespace-nowrap"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Compartilhar Site + APK
          </a>
        </div>
      </div>

      {publishFeedback && (
        <p className="rounded-lg bg-emerald-950/60 px-3 py-2 text-xs text-emerald-300">
          {publishFeedback}
        </p>
      )}

      <div className={`grid grid-cols-1 gap-3 ${compact ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
        {/* Site publicado */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
            <Globe className="h-3.5 w-3.5 text-[#C8102E]" />
            <span>Site e Link Direto Smart TV</span>
          </div>
          <p className="font-mono text-[11px] text-zinc-400 truncate">{pwaUrl}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => copyLink(siteUrl, 'site')}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-100 hover:bg-zinc-800 cursor-pointer"
            >
              {copiedField === 'site' ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copiar Site
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => copyLink(pwaUrl, 'pwa')}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-100 hover:bg-zinc-800 cursor-pointer"
            >
              {copiedField === 'pwa' ? 'Link TV copiado' : 'Copiar Link TV'}
            </button>
          </div>
        </div>

        {/* APK Android / TV */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-zinc-200">
            <span className="inline-flex items-center gap-2">
              <Smartphone className="h-3.5 w-3.5 text-[#C8102E]" />
              APK Android &amp; TV
            </span>
            <span className="font-mono text-[10px] text-zinc-400">
              {apkStatus?.hasCompiledApk ? '.apk pronto' : 'build GitHub Actions'}
            </span>
          </div>
          <p className="font-mono text-[11px] text-zinc-400 truncate">{apkUrl}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleTvPackageDownload('apk')}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#C8102E] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-red-700 cursor-pointer"
            >
              <Download className="h-3 w-3" />
              {apkStatus?.hasCompiledApk ? 'Baixar e Instalar APK' : 'Baixar Pacote APK'}
            </button>
            <button
              type="button"
              onClick={() => copyLink(apkUrl, 'apk')}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-100 hover:bg-zinc-800 cursor-pointer"
            >
              {copiedField === 'apk' ? 'Link copiado' : 'Copiar link APK'}
            </button>
          </div>
        </div>

        {/* LG webOS */}
        {!compact && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
              <Tv className="h-3.5 w-3.5 text-[#C8102E]" />
              <span>Smart TV LG webOS</span>
            </div>
            <p className="font-mono text-[11px] text-zinc-400 truncate">{webosUrl}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleTvPackageDownload('webos')}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-100 hover:bg-zinc-800 cursor-pointer"
              >
                <Download className="h-3 w-3" />
                Baixar pacote TV LG
              </button>
            </div>
          </div>
        )}
      </div>

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
