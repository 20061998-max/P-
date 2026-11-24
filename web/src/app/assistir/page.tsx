'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Copy, Download, KeyRound, Lock, Maximize2, MessageCircle, Play, ShieldCheck, Square } from 'lucide-react';
import { PWAInstallButton } from '@/components/PWAInstallButton';
import {
  getSavedOfflineLicenseState,
  OFFLINE_PLANS,
  verifyAndSaveOfflineKey,
  type OfflineLicenseState,
} from '@/lib/offlineLicense';

export default function AssistirPage() {
  const [isAppMode, setIsAppMode] = useState(false);
  const [offlineLicense, setOfflineLicense] = useState<OfflineLicenseState | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>('1 Mês');
  const [customValidity, setCustomValidity] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [erroLicenca, setErroLicenca] = useState<string | null>(null);

  const [hostIp, setHostIp] = useState('http://192.168.1.50:8080');
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      window.navigator.userAgent.includes('TelaCastAndroidApp');
    setIsAppMode(standalone);
    const checkLicense = () => {
      getSavedOfflineLicenseState().then((state) => {
        setOfflineLicense(state);
        if (!state.ativo) {
          abortRef.current?.abort();
          setConnected(false);
        }
      });
    };
    checkLicense();
    const timer = window.setInterval(checkLicense, 30000);
    window.addEventListener('focus', checkLicense);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', checkLicense);
      abortRef.current?.abort();
    };
  }, []);

  async function ativarChave(e: FormEvent) {
    e.preventDefault();
    setErroLicenca(null);
    const res = await verifyAndSaveOfflineKey(keyInput);
    setOfflineLicense(res);
    if (!res.ativo) {
      setErroLicenca(res.motivo ?? 'Chave inválida.');
    }
  }

  async function conectar() {
    abortRef.current?.abort();
    setErro(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setConnected(true);

    try {
      const res = await fetch(
        `${hostIp.replace(/\/$/, '')}/stream?token=${encodeURIComponent(token)}`,
        {
          headers: { 'X-TelaCast-App': 'TelaCast-PWA-App/1.0' },
          signal: controller.signal,
        }
      );
      if (!res.ok || !res.body) {
        setErro(`Acesso recusado (HTTP ${res.status}).`);
        setConnected(false);
        return;
      }

      const reader = res.body.getReader();
      let buf = new Uint8Array(0);
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        const merged = new Uint8Array(buf.length + value.length);
        merged.set(buf);
        merged.set(value, buf.length);
        buf = merged;

        let s = -1;
        for (let i = 0; i < buf.length - 1; i += 1) {
          if (buf[i] === 0xff && buf[i + 1] === 0xd8) {
            s = i;
            break;
          }
        }
        if (s === -1) continue;

        let e = -1;
        for (let i = s + 2; i < buf.length - 1; i += 1) {
          if (buf[i] === 0xff && buf[i + 1] === 0xd9) {
            e = i + 2;
            break;
          }
        }
        if (e === -1) continue;

        const jpeg = buf.slice(s, e);
        buf = buf.slice(e);
        const bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }));
        const canvas = canvasRef.current;
        if (canvas) {
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        }
        bitmap.close();
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErro('Falha ao conectar ao transmissor.');
        setConnected(false);
      }
    }
  }

  function desconectar() {
    abortRef.current?.abort();
    setConnected(false);
  }

  if (!isAppMode) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-6 py-12">
        <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-8 space-y-5">
          <div className="flex items-center gap-3">
            <Lock className="h-6 w-6 text-amber-700" />
            <h1 className="font-display text-2xl font-bold text-slate-900">
              Jogos e transmissões não abrem no site
            </h1>
          </div>
          <p className="text-sm leading-relaxed text-slate-600">
            Instale este site como atalho App na sua tela inicial e abra pelo atalho criado para
            assistir normalmente aos jogos e transmissões ao vivo.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <PWAInstallButton />
            <a
              href="/downloads/telacast.apk"
              download
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Baixar APK Android
            </a>
          </div>
          <Link href="/" className="block text-xs font-medium text-slate-500 hover:text-slate-900">
            Voltar para a página inicial
          </Link>
        </div>
      </div>
    );
  }

  if (!offlineLicense?.ativo) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-8 space-y-5">
          <div className="flex items-center gap-3">
            <KeyRound className="h-6 w-6 text-blue-400" />
            <h1 className="font-display text-xl font-bold text-white">
              Ativar assinatura offline pelo código do aparelho
            </h1>
          </div>
          <p className="text-sm text-slate-400">
            Código único por aparelho (chaves não funcionam se repassadas a terceiros). Todos os
            pagamentos são feitos via WhatsApp: escolha seu plano ou validade em Outros e envie
            para receber o valor.
          </p>

          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {OFFLINE_PLANS.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                    selectedPlan === plan.id
                      ? 'border-blue-500 bg-blue-600/20 text-white'
                      : 'border-slate-700 bg-slate-950 text-slate-300'
                  }`}
                >
                  {plan.id}
                </button>
              ))}
            </div>

            {selectedPlan === 'Outros' && (
              <input
                type="text"
                value={customValidity}
                onChange={(e) => setCustomValidity(e.target.value)}
                placeholder="Informe a validade desejada (ex: 45 dias ou até 20/01/2027)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
              />
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950 px-4 py-3">
            <span className="font-mono text-xl font-bold tracking-wider text-blue-400">
              {offlineLicense?.deviceCode ?? 'Gerando...'}
            </span>
            <button
              type="button"
              onClick={() =>
                offlineLicense?.deviceCode &&
                navigator.clipboard?.writeText(offlineLicense.deviceCode)
              }
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar código
            </button>
          </div>

          {offlineLicense?.deviceCode && (
            <a
              href={`https://wa.me/${(process.env.NEXT_PUBLIC_ADMIN_WHATSAPP ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(
                (() => {
                  const planDesc =
                    selectedPlan === 'Outros'
                      ? `Outros (Validade desejada: ${customValidity.trim() || 'a combinar'})`
                      : selectedPlan;
                  return offlineLicense.expira_em
                    ? `Olá! Quero RENOVAR minha assinatura do TelaCast.\nPlano escolhido: ${planDesc}\nCódigo do aparelho: ${offlineLicense.deviceCode}\nAguardo o valor para pagamento via WhatsApp.`
                    : `Olá! Instalei o app TelaCast e gostaria da chave de liberação.\nPlano escolhido: ${planDesc}\nCódigo do aparelho: ${offlineLicense.deviceCode}\nAguardo o valor para pagamento via WhatsApp.`;
                })()
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 py-2.5 text-xs font-semibold text-white hover:bg-emerald-600"
            >
              <MessageCircle className="h-4 w-4" />
              {offlineLicense.expira_em
                ? `Renovar (${selectedPlan}) e pagar no WhatsApp`
                : `Solicitar valor (${selectedPlan}) e pagar no WhatsApp`}
            </a>
          )}

          <form onSubmit={ativarChave} className="space-y-3">
            <input
              type="text"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Cole a chave TC1.xxx.yyy"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white"
            />
            {erroLicenca && <p className="text-xs text-red-400">{erroLicenca}</p>}
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-600"
            >
              Liberar App Offline
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      <div className="mx-auto max-w-5xl flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-emerald-400">
          <ShieldCheck className="h-4 w-4" />
          <span>
            TelaCast App · {offlineLicense.deviceCode} · {offlineLicense.plano} ·{' '}
            {offlineLicense.dias_restantes}d offline
          </span>
        </div>
        <button
          type="button"
          onClick={() => document.documentElement.requestFullscreen?.()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Tela cheia
        </button>
      </div>

      <div className="mx-auto max-w-5xl grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input
          type="url"
          value={hostIp}
          onChange={(e) => setHostIp(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white"
        />
        <input
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token da sessão (ex: TC-8F4A21)"
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-white"
        />
        <button
          type="button"
          onClick={connected ? desconectar : conectar}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white"
        >
          {connected ? (
            <>
              <Square className="h-3.5 w-3.5" />
              Desconectar
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              Assistir jogos / tela
            </>
          )}
        </button>
      </div>

      {erro && <p className="mx-auto max-w-5xl text-xs text-red-400">{erro}</p>}

      <div className="mx-auto max-w-5xl flex justify-center rounded-xl border border-slate-800 bg-black p-4 min-h-[60vh]">
        <canvas ref={canvasRef} className="max-h-[75vh] max-w-full object-contain" />
      </div>
    </div>
  );
}
