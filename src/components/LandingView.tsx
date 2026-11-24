import { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Lock,
  MessageCircle,
  QrCode,
  ShieldCheck,
  Smartphone,
  Tv,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { DeveloperMessageBox } from './DeveloperMessageBox';
import { MengaoShield } from './MengaoShield';
import { PWAInstallButton } from './PWAInstallButton';
import { triggerDirectDownload, TvAutoInstallModal } from './TvAutoInstallModal';
import { AppSettingsDoc, PlanItem, sanitizePixQrCodeUrl } from '../lib/storeCatalog';
import { AppTab } from '../types';

interface LandingViewProps {
  settings: AppSettingsDoc;
  plans: PlanItem[];
  onNavigate: (tab: AppTab, preselectedPlan?: string) => void;
}

const CAMISAS_MENGAO = [
  {
    numero: '14',
    funcao: 'Camisa 14 · Criação e armador no meio-campo',
  },
  {
    numero: '9',
    funcao: 'Camisa 9 · Artilharia e referência na área',
  },
  {
    numero: '27',
    funcao: 'Camisa 27 · Velocidade e gols em decisões',
  },
  {
    numero: '1',
    funcao: 'Camisa 1 · Segurança absoluta debaixo das traves',
  },
  {
    numero: '8',
    funcao: 'Camisa 8 · Liderança e motor do meio-campo',
  },
  {
    numero: '18',
    funcao: 'Camisa 18 · Intensidade e passes verticais',
  },
];

const PASSOS_LIBERACAO = [
  {
    step: '01. Instale o App no celular ou Smart TV',
    desc: 'Toque em Instalar App para criar o atalho no Android/iPhone ou baixe o pacote direto para Android TV e TV LG webOS.',
  },
  {
    step: '02. Copie o código exclusivo do seu aparelho',
    desc: 'Ao abrir o app Jogos do Mengão instalado, ele gera um código único (ex: TC-A1B2-C3D4) que só funciona naquele dispositivo.',
  },
  {
    step: '03. Pague via Pix ou combine no WhatsApp',
    desc: 'Escolha um dos planos abaixo (ou validade personalizada em Outros), faça o Pix ou fale direto no WhatsApp enviando seu código.',
  },
  {
    step: '04. Cole a chave de liberação e assista',
    desc: 'Você recebe sua chave assinada (TC1...) para colar no app e liberar os jogos na hora, com bloqueio automático ao vencer.',
  },
];

export function LandingView({ settings, plans, onNavigate }: LandingViewProps) {
  const [heroImgError, setHeroImgError] = useState(false);
  const [tvImgError, setTvImgError] = useState(false);
  const [copiedPix, setCopiedPix] = useState(false);
  const [tvModalType, setTvModalType] = useState<'apk' | 'webos' | null>(null);
  const { apkStatus, isInstallable, install, openTvAppMode } = usePWAInstall();

  const visiblePlans = plans.filter((p) => p.active);

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

  function handleCopyPix() {
    if (!settings.pixKey) return;
    navigator.clipboard?.writeText(settings.pixKey);
    setCopiedPix(true);
    window.setTimeout(() => setCopiedPix(false), 1800);
  }

  const whatsappDirectHref = settings.whatsappNumber
    ? `https://wa.me/${settings.whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(
        `Olá! Vim pela vitrine do ${settings.appName} e quero contratar um plano.`
      )}`
    : `https://wa.me/?text=${encodeURIComponent(
        `Olá! Vim pela vitrine do ${settings.appName} e quero contratar um plano.`
      )}`;

  return (
    <div className="space-y-20 pb-20">
      {/* 1. Hero Vitrine Rubro-Negra */}
      <section className="mx-auto max-w-6xl px-6 pt-10 lg:pt-14">
        <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <div className="flex items-center gap-3">
              <MengaoShield className="h-11 w-11 shrink-0" />
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-400">
                <span>Vitrine Oficial</span>
                <span aria-hidden="true">·</span>
                <span>Android &amp; iOS</span>
                <span aria-hidden="true">·</span>
                <span>Android TV &amp; LG webOS</span>
              </div>
            </div>

            <h1 className="font-display text-4xl font-extrabold tracking-tight text-white sm:text-6xl text-balance leading-[1.04]">
              {settings.appName}: os jogos do Mengão direto no seu App e TV
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-zinc-300">
              {settings.tagline} Acompanhe cada lance das camisas sagradas rubro-negras sem
              travamentos, com ativação exclusiva por aparelho e proteção contra retransmissão fora
              das Smart TVs.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <PWAInstallButton variant="primary" label="Instalar App / Atalho" />
              <button
                type="button"
                onClick={() => handleTvPackageDownload('apk')}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                {apkStatus?.hasCompiledApk ? 'Baixar e Instalar APK TV' : 'APK Android / TV'}
              </button>
              <button
                type="button"
                onClick={() => handleTvPackageDownload('webos')}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Tv className="h-3.5 w-3.5" />
                App LG webOS
              </button>
              <button
                type="button"
                onClick={openTvAppMode}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir na TV
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4 border-t border-zinc-800 pt-6">
              <div>
                <p className="font-display text-2xl font-bold text-white tabular-nums">
                  App Exclusivo
                </p>
                <p className="text-xs text-zinc-400">Não abre em abas comuns</p>
              </div>
              <div>
                <p className="font-display text-2xl font-bold text-red-500 tabular-nums">
                  Somente TVs
                </p>
                <p className="text-xs text-zinc-400">Proteção anti-retransmissão</p>
              </div>
              <div>
                <p className="font-display text-2xl font-bold text-white tabular-nums">
                  Pix / WhatsApp
                </p>
                <p className="text-xs text-zinc-400">Liberação por código único</p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-full min-h-[340px] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
              {!heroImgError ? (
                <img
                  src="/src/assets/images/hero_maracana_mengao_1795416535516.jpg"
                  alt="Estádio do Maracanã lotado com bandeiras rubro-negras em noite de jogo"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-8 text-center text-zinc-400">
                  <MengaoShield className="h-14 w-14" />
                  <p className="mt-3 text-sm font-semibold text-white">{settings.appName}</p>
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-5">
                <p className="text-xs font-medium text-zinc-200">
                  Maracanã · Transmissão otimizada para celular e Smart TVs
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Camisas do Mengão em Campo (Apenas números das camisas) */}
      <section className="border-y border-zinc-800 bg-zinc-900/60 py-16">
        <div className="mx-auto max-w-6xl px-6 space-y-8">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl font-bold text-white">
                Camisas do Mengão em destaque no App
              </h2>
              <p className="mt-2 text-sm text-zinc-300">
                Cada lance do Manto Sagrado na palma da mão ou direto na tela grande da sala.
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-zinc-400 tabular-nums">
              #14 · #9 · #27 · #1 · #8 · #18
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAMISAS_MENGAO.map((camisa) => (
              <div
                key={camisa.numero}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 flex items-center gap-4"
              >
                <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-lg border border-[#C8102E]/60 bg-gradient-to-b from-[#C8102E]/25 to-zinc-950">
                  <span className="font-display text-3xl font-extrabold leading-none text-white tabular-nums">
                    #{camisa.numero}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-display text-xl font-bold tracking-tight text-[#C8102E] tabular-nums">
                    Camisa {camisa.numero}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">{camisa.funcao}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. Vitrine de Planos e Valores (Atualizados pelo Admin) */}
      <section id="planos" className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-bold text-white">
              Planos e valores do {settings.appName}
            </h2>
            <p className="mt-2 text-sm text-zinc-300">
              Valores atualizados em tempo real pelo administrador. Escolha o seu plano ou defina
              uma validade sob medida em Outros e envie o código do aparelho.
            </p>
          </div>
          <a
            href={whatsappDirectHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-600 whitespace-nowrap shrink-0 self-start"
          >
            <MessageCircle className="h-4 w-4" />
            Falar no WhatsApp
          </a>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {visiblePlans.map((plano) => (
            <div
              key={plano.id}
              className={`flex flex-col justify-between rounded-xl border p-6 ${
                plano.featured
                  ? 'border-[#C8102E] bg-zinc-900'
                  : 'border-zinc-800 bg-zinc-950'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                  <span>{plano.days > 0 ? `${plano.days} dias de acesso` : 'Validade sob medida'}</span>
                  {plano.featured && (
                    <span className="font-semibold text-red-400">Mais escolhido</span>
                  )}
                </div>
                <h3 className="mt-1.5 font-display text-2xl font-bold text-white">{plano.name}</h3>
                <p className="mt-1 text-xs text-zinc-400">{plano.subtitle}</p>

                <div className="mt-4 flex flex-wrap items-baseline gap-1.5 border-y border-zinc-800 py-3">
                  <span className="font-display text-3xl font-extrabold text-white tabular-nums">
                    {plano.priceText}
                  </span>
                  <span className="text-xs text-zinc-400">{plano.periodLabel}</span>
                </div>

                <ul className="mt-4 space-y-2 text-xs leading-relaxed text-zinc-300">
                  {plano.features.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C8102E]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                onClick={() => onNavigate('assinante', plano.name)}
                className={`mt-6 w-full rounded-lg px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  plano.featured
                    ? 'bg-[#C8102E] text-white hover:bg-red-700'
                    : 'border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800'
                }`}
              >
                {plano.name === 'Outros'
                  ? 'Escolher validade e solicitar'
                  : `Assinar ${plano.name} · ${plano.priceText}`}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Passo a Passo até a Liberação + Dados Pix */}
      <section className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-4">
            <div>
              <h2 className="font-display text-3xl font-bold text-white">
                Passo a passo até a liberação no App
              </h2>
              <p className="mt-2 text-sm text-zinc-300">
                Processo simples e seguro sem exigir conta bancária integrada no aplicativo.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {PASSOS_LIBERACAO.map((item) => (
                <div
                  key={item.step}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 space-y-2"
                >
                  <h3 className="font-display text-lg font-bold text-white">{item.step}</h3>
                  <p className="text-xs leading-relaxed text-zinc-300">{item.desc}</p>
                </div>
              ))}
            </div>

            {/* Dados Pix + QR Code em tempo real */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4 min-w-0">
                {sanitizePixQrCodeUrl(settings.pixQrCodeDataUrl) && (
                  <img
                    src={sanitizePixQrCodeUrl(settings.pixQrCodeDataUrl)}
                    alt="QR Code Pix para pagamento"
                    className="h-24 w-24 shrink-0 rounded-lg border border-zinc-700 bg-white object-contain p-1"
                  />
                )}
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                    <QrCode className="h-4 w-4 text-[#C8102E]" />
                    <span>Pagamento via Pix ({settings.pixType}) · {settings.pixReceiverName}</span>
                  </div>
                  <p className="font-mono text-sm font-semibold text-white break-all">
                    {settings.pixKey || 'Solicite a chave Pix pelo WhatsApp'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {settings.pixKey && (
                  <button
                    type="button"
                    onClick={handleCopyPix}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 whitespace-nowrap"
                  >
                    {copiedPix ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        Pix copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copiar Pix
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onNavigate('assinante')}
                  className="rounded-lg bg-[#C8102E] px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 whitespace-nowrap"
                >
                  Ativar meu código
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col gap-4">
            <div className="flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 min-h-[260px]">
              {!tvImgError ? (
                <img
                  src="/src/assets/images/tv_app_mengao_showcase_1795416536194.jpg"
                  alt="Smart TV exibindo partida ao vivo pelo app Jogos do Mengão"
                  referrerPolicy="no-referrer"
                  onError={() => setTvImgError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-6 text-zinc-400">
                  <Tv className="h-10 w-10 text-[#C8102E]" />
                  <p className="mt-2 text-sm font-semibold text-white">TV Android &amp; LG webOS</p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-2.5">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>Proteção Anti-Retransmissão e Anti-Repasse</span>
              </div>
              <p className="text-xs leading-relaxed text-zinc-300">
                <Lock className="inline h-3.5 w-3.5 mr-1 text-red-400" />
                {settings.tvOnlyAntiRetransmission
                  ? 'Retransmissão bloqueada no app e no navegador: somente Smart TVs (Android TV e LG webOS) estão autorizadas a receber espelhamento.'
                  : 'Chaves criptografadas exclusivas por aparelho impedem o repasse da assinatura para terceiros.'}
              </p>
              <p className="text-xs text-zinc-400 flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5" />
                Bloqueio de captura de tela (FLAG_SECURE) no Android para evitar cópia dos jogos.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Mensagem direta para o Desenvolvedor (apagada automaticamente após 5 dias) */}
      <section className="mx-auto max-w-6xl px-6">
        <DeveloperMessageBox />
      </section>

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
