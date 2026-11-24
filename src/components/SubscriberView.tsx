import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  MessageCircle,
  QrCode,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import {
  buildCustomerPaymentWhatsappHref,
  buildWhatsappSendCodeHref,
  getSavedCustomerPreRegistration,
  getSavedOfflineLicenseState,
  OfflineLicenseState,
  saveCustomerPreRegistration,
  verifyAndSaveOfflineKey,
} from '../lib/offlineLicense';
import { AppSettingsDoc, PlanItem, sanitizePixQrCodeUrl } from '../lib/storeCatalog';
import { formatDatePtBr } from '../types';
import { DeveloperMessageBox } from './DeveloperMessageBox';
import { MengaoShield } from './MengaoShield';

interface SubscriberViewProps {
  settings: AppSettingsDoc;
  plans: PlanItem[];
  preselectedPlan?: string;
}

interface PaymentConfirmationResult {
  requestId: string;
  whatsappHref: string;
  planName: string;
  planPrice: string;
  deviceCode: string;
  customerName: string;
}

export function SubscriberView({
  settings,
  plans,
  preselectedPlan,
}: SubscriberViewProps) {
  const activePlans = plans.filter((p) => p.active);
  const [offlineState, setOfflineState] = useState<OfflineLicenseState | null>(null);
  const [selectedPlanName, setSelectedPlanName] = useState<string>(
    preselectedPlan || activePlans[0]?.name || '1 Mês'
  );
  const [customValidity, setCustomValidity] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerWhatsapp, setCustomerWhatsapp] = useState('');
  const [paymentSending, setPaymentSending] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentConfirmation, setPaymentConfirmation] =
    useState<PaymentConfirmationResult | null>(null);

  const [activationInput, setActivationInput] = useState('');
  const [offlineFeedback, setOfflineFeedback] = useState<string | null>(null);
  const [copiedDeviceCode, setCopiedDeviceCode] = useState(false);
  const [copiedPix, setCopiedPix] = useState(false);

  const pixQrSrc = sanitizePixQrCodeUrl(settings.pixQrCodeDataUrl);

  useEffect(() => {
    if (preselectedPlan) {
      setSelectedPlanName(preselectedPlan);
    }
  }, [preselectedPlan]);

  useEffect(() => {
    const syncState = () => {
      getSavedOfflineLicenseState().then(setOfflineState);
    };
    syncState();
    void getSavedCustomerPreRegistration().then((saved) => {
      if (saved.customerName) setCustomerName((prev) => prev || saved.customerName);
      if (saved.customerWhatsapp) setCustomerWhatsapp((prev) => prev || saved.customerWhatsapp);
    });
    window.addEventListener('focus', syncState);
    return () => window.removeEventListener('focus', syncState);
  }, []);

  const chosenPlan = activePlans.find((p) => p.name === selectedPlanName) || activePlans[0];

  async function handleConfirmPayment() {
    setPaymentError(null);
    const cleanName = customerName.trim();
    const cleanDigits = customerWhatsapp.replace(/\D/g, '');
    if (cleanName.length < 2) {
      setPaymentError('Preencha seu nome completo no pré-cadastro antes de confirmar o pagamento.');
      return;
    }
    if (cleanDigits.length < 10) {
      setPaymentError(
        'Informe seu número de WhatsApp com DDD (ex: 21999999999) para receber sua chave.'
      );
      return;
    }
    if (!offlineState?.deviceCode) {
      setPaymentError('Aguarde a geração do código exclusivo deste aparelho.');
      return;
    }

    const whatsappHref = buildCustomerPaymentWhatsappHref({
      customerName: cleanName,
      customerWhatsapp: cleanDigits,
      deviceCode: offlineState.deviceCode,
      adminWhatsapp: settings.whatsappNumber,
      expired: Boolean(offlineState.expira_em),
      selectedPlan: selectedPlanName,
      customValidity,
      priceText: chosenPlan?.priceText,
    });

    setPaymentSending(true);
    try {
      await saveCustomerPreRegistration({
        customerName: cleanName,
        customerWhatsapp: cleanDigits,
      });

      const res = await fetch('/api/clientes/pagamento-informado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          customerName: cleanName,
          customerWhatsapp: cleanDigits,
          deviceCode: offlineState.deviceCode,
          planName: selectedPlanName,
          planPrice: chosenPlan?.priceText || 'Sob consulta',
          customValidity,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPaymentError(data.erro || 'Não foi possível registrar seu pagamento no momento.');
        return;
      }

      setPaymentConfirmation({
        requestId: data.solicitacao?.id || '',
        whatsappHref,
        planName: selectedPlanName,
        planPrice: chosenPlan?.priceText || 'Sob consulta',
        deviceCode: offlineState.deviceCode,
        customerName: cleanName,
      });

      // Abre o WhatsApp do administrador sem usar window.open (compatível com links externos)
      const anchor = document.createElement('a');
      anchor.href = whatsappHref;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setPaymentError('Falha de rede ao registrar pré-cadastro. Tente novamente.');
    } finally {
      setPaymentSending(false);
    }
  }

  async function handleActivateOffline(e: React.FormEvent) {
    e.preventDefault();
    setOfflineFeedback(null);
    const result = await verifyAndSaveOfflineKey(activationInput);
    setOfflineState(result);
    if (result.ativo) {
      setActivationInput('');
      setOfflineFeedback(
        `Acesso liberado no aparelho (${result.plano}) · válido por ${result.dias_restantes} dias.`
      );
    } else {
      setOfflineFeedback(result.motivo || 'Chave de liberação inválida para este aparelho.');
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12 space-y-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-7 sm:p-8 space-y-6">
        <div className="flex items-start gap-3.5">
          <MengaoShield className="h-10 w-10 shrink-0" />
          <div>
            <h1 className="font-display text-2xl font-bold text-white">
              Ativação e Pagamento · {settings.appName}
            </h1>
            <p className="mt-1 text-sm text-zinc-300">
              Faça seu pré-cadastro, pague via Pix (chave ou QR Code), clique em{' '}
              <strong className="text-white">Já efetuei o pagamento</strong> e receba sua chave de
              liberação no WhatsApp.
            </p>
          </div>
        </div>

        {/* Pré-Cadastro Obrigatório do Cliente */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <UserCheck className="h-4 w-4 text-[#C8102E]" />
            <span>1. Pré-Cadastro do Cliente (obrigatório para liberação)</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-medium text-zinc-300">
                Seu nome completo
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={80}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Ex: João Silva"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-300">
                Seu WhatsApp (com DDD)
              </label>
              <input
                type="tel"
                required
                maxLength={20}
                value={customerWhatsapp}
                onChange={(e) => setCustomerWhatsapp(e.target.value)}
                placeholder="Ex: (21) 99999-9999"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
              />
            </div>
          </div>
          <p className="text-[11px] text-zinc-400">
            Seus dados e o código deste aparelho vão direto para o administrador liberar seu acesso e
            enviar sua chave neste WhatsApp.
          </p>
        </div>

        {/* Seleção de Planos Dinâmicos */}
        <div className="space-y-2.5">
          <p className="text-xs font-medium text-zinc-300">
            2. Selecione o plano desejado (valores definidos pelo administrador)
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {activePlans.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedPlanName(plan.name)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  selectedPlanName === plan.name
                    ? 'border-[#C8102E] bg-[#C8102E]/15 text-white'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                <div className="text-xs font-semibold">{plan.name}</div>
                <div className="mt-1 font-mono text-sm font-bold text-white tabular-nums">
                  {plan.priceText}
                </div>
              </button>
            ))}
          </div>

          {selectedPlanName === 'Outros' && (
            <div className="pt-1">
              <label className="block text-xs font-medium text-zinc-300">
                Informe a validade desejada (ex: 15 dias, 2 meses ou até 20/01/2027)
              </label>
              <input
                type="text"
                value={customValidity}
                onChange={(e) => setCustomValidity(e.target.value)}
                placeholder="Ex: 45 dias ou até 20/01/2027"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Dados Pix + QR Code do Admin */}
        {(settings.pixKey || pixQrSrc) && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4 min-w-0">
              {pixQrSrc && (
                <div className="shrink-0 rounded-lg bg-white p-2 border border-zinc-700">
                  <img
                    src={pixQrSrc}
                    alt="QR Code Pix"
                    className="h-28 w-28 object-contain"
                  />
                </div>
              )}
              <div className="space-y-1 min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                  <QrCode className="h-3.5 w-3.5 text-[#C8102E]" />
                  3. Pague via Pix ({settings.pixType}) · {settings.pixReceiverName}
                </p>
                {settings.pixKey && (
                  <p className="font-mono text-xs text-white break-all">{settings.pixKey}</p>
                )}
                {pixQrSrc && (
                  <p className="text-[11px] text-zinc-400">
                    Escaneie o QR Code ao lado ou copie a chave Pix.
                  </p>
                )}
              </div>
            </div>
            {settings.pixKey && (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(settings.pixKey);
                  setCopiedPix(true);
                  window.setTimeout(() => setCopiedPix(false), 1800);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                {copiedPix ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copiedPix ? 'Pix copiado' : 'Copiar Pix'}
              </button>
            )}
          </div>
        )}

        {/* Código Único do Aparelho + Confirmação de Pagamento */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
            <span>Código exclusivo deste aparelho (bloqueado se repassado)</span>
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <code className="font-mono text-lg font-bold text-white tabular-nums">
              {offlineState?.deviceCode || 'Gerando...'}
            </code>
            <button
              type="button"
              disabled={!offlineState?.deviceCode}
              onClick={() => {
                if (!offlineState?.deviceCode) return;
                navigator.clipboard?.writeText(offlineState.deviceCode);
                setCopiedDeviceCode(true);
                window.setTimeout(() => setCopiedDeviceCode(false), 1800);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-800"
            >
              {copiedDeviceCode ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copiar código
                </>
              )}
            </button>
          </div>

          {paymentError && (
            <p className="rounded-lg bg-red-950/70 px-3 py-2 text-xs text-red-300">
              {paymentError}
            </p>
          )}

          <button
            type="button"
            disabled={paymentSending || !offlineState?.deviceCode}
            onClick={handleConfirmPayment}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-3 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {paymentSending
              ? 'Registrando pagamento e abrindo WhatsApp...'
              : `Já efetuei o pagamento (${selectedPlanName} · ${chosenPlan?.priceText || 'Pix'})`}
          </button>

          {paymentConfirmation && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/60 p-3.5 space-y-2 text-xs text-emerald-100">
              <p className="font-semibold text-emerald-300">
                Pré-cadastro e pagamento enviados para o Painel Admin!
              </p>
              <p className="text-emerald-200/90">
                Seu pedido ({paymentConfirmation.planName} · aparelho{' '}
                <code className="font-mono font-bold">{paymentConfirmation.deviceCode}</code>) já
                aparece na aba <strong>Ativação e Renovação</strong> do administrador.
              </p>
              <a
                href={paymentConfirmation.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
              >
                <MessageCircle className="h-4 w-4" />
                Abrir WhatsApp com plano, dados e código do aparelho
              </a>
            </div>
          )}

          {offlineState?.deviceCode && (
            <a
              href={buildWhatsappSendCodeHref(
                offlineState.deviceCode,
                settings.whatsappNumber,
                Boolean(offlineState.expira_em),
                selectedPlanName,
                customValidity,
                chosenPlan?.priceText
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <MessageCircle className="h-3.5 w-3.5 text-emerald-400" />
              Dúvidas antes do Pix? Falar no WhatsApp
            </a>
          )}
        </div>

        {offlineState?.ativo && (
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/60 p-4 text-xs text-emerald-200 space-y-1">
            <p className="font-semibold">
              Assinatura ativa neste aparelho · {offlineState.plano}
            </p>
            <p className="font-mono tabular-nums">
              Válida até {formatDatePtBr(offlineState.expira_em)} ({offlineState.dias_restantes} dias
              restantes)
            </p>
          </div>
        )}

        {/* Ativação com a chave recebida */}
        <form onSubmit={handleActivateOffline} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-300">
              4. Chave de liberação recebida no WhatsApp
            </label>
            <textarea
              required
              rows={3}
              value={activationInput}
              onChange={(e) => setActivationInput(e.target.value)}
              placeholder="Cole aqui a chave TC1... gerada pelo administrador para este aparelho"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          {offlineFeedback && (
            <p
              className={`rounded-lg px-3 py-2 text-xs ${
                offlineState?.ativo
                  ? 'bg-emerald-950/80 text-emerald-300'
                  : 'bg-red-950/80 text-red-300'
              }`}
            >
              {offlineFeedback}
            </p>
          )}

          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C8102E] py-2.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            <KeyRound className="h-4 w-4" />
            Validar e liberar acesso offline
          </button>
        </form>
      </div>

      <DeveloperMessageBox compact />
    </div>
  );
}

