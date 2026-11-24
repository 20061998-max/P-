import Link from 'next/link';
import { Download, Monitor, ShieldCheck, Smartphone, Wifi } from 'lucide-react';
import { PWAInstallButton } from '@/components/PWAInstallButton';

const PLANOS = [
  {
    nome: '1 Mês',
    publico: '30 dias em 1 aparelho exclusivo',
    preco: '30 dias',
    periodo: '· via WhatsApp',
    recursos: [
      'Código único do aparelho (bloqueado para terceiros)',
      'Pagamento combinado direto pelo WhatsApp',
      'Bloqueio automático após o vencimento',
    ],
  },
  {
    nome: '3 Meses / 6 Meses',
    publico: 'Mais escolhido para uso contínuo',
    preco: '90–180d',
    periodo: '· via WhatsApp',
    destaque: true,
    recursos: [
      'Validade estendida por 3 ou 6 meses sem internet',
      'Funciona em Android, iPhone, Android TV e LG webOS',
      'Renovação direta com mensagem pronta no WhatsApp',
    ],
  },
  {
    nome: '1 Ano ou Outros',
    publico: 'Anual ou validade sob medida',
    preco: '365d / Outros',
    periodo: '· via WhatsApp',
    recursos: [
      'Escolha 1 ano ou defina exatamente a validade em Outros',
      'Envie o código e receba o valor pelo WhatsApp',
      'Liberação imediata com chave exclusiva após o pagamento',
    ],
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <Link
            href="/"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            TelaCast
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#como-funciona" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Como funciona
            </a>
            <Link href="/assistir" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Assistir (App)
            </Link>
            <a href="#planos" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Planos
            </a>
            <Link href="/painel" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Painel
            </Link>
            <Link href="/admin" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Admin
            </Link>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/login"
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
            >
              Entrar na conta
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            <div className="lg:col-span-7 space-y-6">
              <p className="text-sm font-medium text-blue-700">
                Espelhamento nativo para Android · Acesso exclusivo pelo App
              </p>
              <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl text-balance">
                Espelhe a tela do seu Android com visualização exclusiva no App
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-slate-600">
                Sem cabos HDMI e sem servidor RTMP externo. Clientes assistem exclusivamente pelo
                aplicativo Android ou instalando este site como atalho App na tela inicial.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <PWAInstallButton />
                <a
                  href="/downloads/telacast.apk"
                  download
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  <Download className="h-4 w-4" />
                  Baixar APK Android
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-slate-500">
                <span>Compatível com Android 7.0 ao 15</span>
                <span aria-hidden="true">·</span>
                <span>Seletor de app único no Android 14+</span>
                <span aria-hidden="true">·</span>
                <span>Stream MJPEG a 20 FPS</span>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <span className="font-display text-sm font-semibold text-slate-900">
                    Transmissão em andamento
                  </span>
                  <span className="font-mono text-xs text-emerald-700">Ativo · 20 FPS</span>
                </div>
                <div className="rounded-lg bg-slate-900 p-4 text-slate-100">
                  <p className="text-xs text-slate-400">Endereço local do dispositivo</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-white tabular-nums">
                    http://192.168.1.50:8080
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs text-slate-600">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">Endpoint do stream</p>
                    <p className="mt-1 font-mono font-medium text-slate-900">/stream</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">Qualidade JPEG</p>
                    <p className="mt-1 font-mono font-medium text-slate-900 tabular-nums">70%</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="border-t border-slate-200 bg-white py-16">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Fluxo direto do telefone para o navegador
            </h2>
            <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 p-6 space-y-2">
                <Smartphone className="h-5 w-5 text-blue-700" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  01. Captura nativa Android 14+
                </h3>
                <p className="text-sm text-slate-600">
                  Usa MediaProjection com escolha de tela inteira ou aplicativo específico em
                  ForegroundService seguro.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 p-6 space-y-2">
                <Wifi className="h-5 w-5 text-blue-700" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  02. Servidor HTTP embutido
                </h3>
                <p className="text-sm text-slate-600">
                  O aparelho abre a porta 8080 na rede Wi-Fi e entrega quadros JPEG via
                  multipart/x-mixed-replace sem latência de nuvem.
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 p-6 space-y-2">
                <ShieldCheck className="h-5 w-5 text-blue-700" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  03. Validação de assinatura
                </h3>
                <p className="text-sm text-slate-600">
                  O aplicativo valida o token JWT no endpoint /api/verificar-assinatura antes de
                  liberar o espelhamento.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="planos" className="border-t border-slate-200 py-16">
          <div className="mx-auto max-w-6xl px-6">
            <div className="max-w-xl">
              <h2 className="font-display text-2xl font-bold text-slate-900">
                Planos de 1 mês a 1 ano e Outros (via WhatsApp)
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Todos os pagamentos são feitos via WhatsApp. Escolha o plano ou a validade desejada
                em Outros, envie o código do aparelho e receba o valor para liberação.
              </p>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {PLANOS.map((plano) => (
                <div
                  key={plano.nome}
                  className={`flex flex-col justify-between rounded-xl border bg-white p-6 ${
                    plano.destaque ? 'border-blue-700' : 'border-slate-200'
                  }`}
                >
                  <div>
                    <p className="text-xs font-medium text-slate-500">{plano.publico}</p>
                    <h3 className="mt-1 font-display text-lg font-bold text-slate-900">
                      {plano.nome}
                    </h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="font-display text-3xl font-bold text-slate-900 tabular-nums">
                        {plano.preco}
                      </span>
                      <span className="text-sm text-slate-500">{plano.periodo}</span>
                    </div>
                    <ul className="mt-6 space-y-2.5 text-sm text-slate-600">
                      {plano.recursos.map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Link
                    href="/assistir"
                    className={`mt-8 block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                      plano.destaque
                        ? 'bg-blue-700 text-white hover:bg-blue-800'
                        : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    Solicitar {plano.nome} no App
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
