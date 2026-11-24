import { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  ImagePlus,
  KeyRound,
  LogOut,
  MessageCircle,
  MessageSquare,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Tv,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  setAdminPasscodeToken,
  subscribeAdminPasscodeToken,
} from '../lib/adminMemorySession';
import {
  ADMIN_EMAIL,
  auth,
  isAuthorizedAdminUser,
  signInWithGoogleAccount,
  signOutGoogleAccount,
} from '../lib/firebase';
import {
  buildAdminSendKeyToCustomerHref,
  formatWhatsappNumberForWaMe,
} from '../lib/offlineLicense';
import {
  AppSettingsDoc,
  deletePlanById,
  logOfflineLicenseToFirestore,
  PixType,
  PlanItem,
  sanitizePixQrCodeUrl,
  savePublicSettings,
  seedDefaultCatalogIfEmpty,
  upsertPlan,
} from '../lib/storeCatalog';
import { formatDatePtBr } from '../types';
import { AdminPasscodeForm } from './AdminPasscodeForm';
import { DistributionCard } from './DistributionCard';
import { LiveBroadcastPanel } from './LiveBroadcastPanel';
import { MengaoShield } from './MengaoShield';

interface OfflineLicenseItem {
  id: string;
  deviceCode: string;
  plano: string;
  dias: number;
  expira_em: string;
  activationKey: string;
  criado_em: string;
}

interface DeviceRecord {
  deviceCode: string;
  platform: string;
  isTv: boolean;
  licenseActive: boolean;
  planName: string;
  isStreaming: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface DeviceStatsResponse {
  onlineAgora: number;
  totalInstalados: number;
  ativosComLicenca: number;
  tvsConectadas: number;
  transmitindoAgora: number;
  dispositivos: DeviceRecord[];
}

interface SecurityStatsResponse {
  protections: {
    id: string;
    name: string;
    description: string;
    active: boolean;
  }[];
  counters: {
    rateLimitBlocks: number;
    bruteForceBlocks: number;
    scannerBlocks: number;
    sanitizedPayloads: number;
    wsFloodBlocks: number;
  };
  totalBlocked: number;
  recentEvents: {
    id: string;
    kind: string;
    ip: string;
    path: string;
    detail: string;
    timestamp: string;
  }[];
}

interface PaymentRequestItem {
  id: string;
  customerName: string;
  customerWhatsapp: string;
  deviceCode: string;
  planName: string;
  planPrice: string;
  planDays: number;
  customValidity: string;
  status: 'pendente' | 'liberado';
  createdAt: string;
  renewedAt?: string;
  expira_em?: string;
  activationKey?: string;
  diasLiberados?: number;
}

interface DeveloperMessageItem {
  id: string;
  senderName: string;
  senderWhatsapp: string;
  category: string;
  message: string;
  createdAt: string;
  expiresAt: string;
}

interface AdminViewProps {
  settings: AppSettingsDoc;
  plans: PlanItem[];
}

export function AdminView({ settings, plans }: AdminViewProps) {
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [adminIdToken, setAdminIdToken] = useState<string | null>(null);
  const [passcodeToken, setPasscodeToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [deviceStats, setDeviceStats] = useState<DeviceStatsResponse>({
    onlineAgora: 0,
    totalInstalados: 0,
    ativosComLicenca: 0,
    tvsConectadas: 0,
    transmitindoAgora: 0,
    dispositivos: [],
  });
  const [securityStats, setSecurityStats] = useState<SecurityStatsResponse | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Settings form state
  const [formSettings, setFormSettings] = useState<AppSettingsDoc>(settings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [qrUploadError, setQrUploadError] = useState<string | null>(null);

  // Plans management state
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanItem | null>(null);
  const [planFeaturesText, setPlanFeaturesText] = useState('');
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanPrice, setNewPlanPrice] = useState('');
  const [newPlanDays, setNewPlanDays] = useState(30);
  const [newPlanSubtitle, setNewPlanSubtitle] = useState('');
  const [newPlanFeatures, setNewPlanFeatures] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const [planFeedback, setPlanFeedback] = useState<string | null>(null);

  // Customer pre-registrations & activation/renewal requests
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequestItem[]>([]);
  const [renewDaysByRequest, setRenewDaysByRequest] = useState<Record<string, number>>({});
  const [renewDateByRequest, setRenewDateByRequest] = useState<Record<string, string>>({});
  const [renewingRequestId, setRenewingRequestId] = useState<string | null>(null);
  const [requestFeedback, setRequestFeedback] = useState<string | null>(null);
  const [copiedRequestKeyId, setCopiedRequestKeyId] = useState<string | null>(null);

  // Developer messages (5-day auto-expiry + manual delete)
  const [devMessages, setDevMessages] = useState<DeveloperMessageItem[]>([]);
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null);
  const [clearingAllMsgs, setClearingAllMsgs] = useState(false);

  // Offline key generator state
  const [deviceCodeInput, setDeviceCodeInput] = useState('');
  const [offlineDays, setOfflineDays] = useState<number>(30);
  const [validadeDate, setValidadeDate] = useState<string>(() => {
    const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [offlinePlan, setOfflinePlan] = useState('1 Mês');
  const [generatedKey, setGeneratedKey] = useState<OfflineLicenseItem | null>(null);
  const [offlineKeys, setOfflineKeys] = useState<OfflineLicenseItem[]>([]);
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [copiedGenerated, setCopiedGenerated] = useState(false);

  const isGoogleAdmin = isAuthorizedAdminUser(googleUser);
  const isAuthorizedAdmin = isGoogleAdmin || Boolean(passcodeToken);

  async function getAdminToken(): Promise<string | null> {
    if (googleUser && isGoogleAdmin) {
      try {
        return await googleUser.getIdToken();
      } catch {
        return passcodeToken;
      }
    }
    return passcodeToken;
  }

  useEffect(() => {
    setFormSettings(settings);
  }, [settings]);

  useEffect(() => {
    const unsubPasscode = subscribeAdminPasscodeToken(setPasscodeToken);
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setGoogleUser(user);
      setAuthReady(true);
      if (user && isAuthorizedAdminUser(user)) {
        void user.getIdToken().then(setAdminIdToken).catch(() => setAdminIdToken(null));
      } else {
        setAdminIdToken(null);
      }
    });
    return () => {
      unsubPasscode();
      unsubAuth();
    };
  }, []);

  async function fetchAdminServerData() {
    const token = await getAdminToken();
    if (!token || !isAuthorizedAdmin) return;
    setLoadingStats(true);
    try {
      const [statsRes, keysRes, secRes, reqRes, msgRes] = await Promise.all([
        fetch('/api/admin/dispositivos', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/admin/chaves-offline', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/admin/seguranca', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/admin/solicitacoes', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/admin/mensagens', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (statsRes.ok) {
        setDeviceStats((await statsRes.json()) as DeviceStatsResponse);
      }
      if (keysRes.ok) {
        const keyData = await keysRes.json();
        setOfflineKeys(keyData.chaves ?? []);
      }
      if (secRes.ok) {
        setSecurityStats((await secRes.json()) as SecurityStatsResponse);
      }
      if (reqRes.ok) {
        const reqData = await reqRes.json();
        setPaymentRequests(reqData.solicitacoes ?? []);
      }
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        setDevMessages(msgData.mensagens ?? []);
      }
    } finally {
      setLoadingStats(false);
    }
  }

  useEffect(() => {
    if (!isAuthorizedAdmin) return;
    if (googleUser && isGoogleAdmin) {
      googleUser.getIdToken().then((idToken) => {
        void seedDefaultCatalogIfEmpty(idToken).catch(() => undefined);
      });
    }
    void fetchAdminServerData();
    const interval = window.setInterval(() => {
      void fetchAdminServerData();
    }, 15000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorizedAdmin, isGoogleAdmin, googleUser?.uid, passcodeToken]);

  async function handleGoogleSignIn() {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const user = await signInWithGoogleAccount();
      if (!isAuthorizedAdminUser(user)) {
        setAuthError(
          `A conta ${user.email || 'selecionada'} não é a conta administradora autorizada (${ADMIN_EMAIL}).`
        );
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Falha ao entrar com Google.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOutAll() {
    setAdminPasscodeToken(null);
    if (googleUser) {
      await signOutGoogleAccount().catch(() => undefined);
    }
  }

  async function handleQrFileChange(file: File | null) {
    setQrUploadError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setQrUploadError('Selecione uma imagem PNG, JPG ou WebP do seu QR Code Pix.');
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Não foi possível ler a imagem do QR Code.'));
        el.src = objectUrl;
      });
      const maxDim = 320;
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const width = Math.max(120, Math.round(img.width * scale));
      const height = Math.max(120, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setQrUploadError('Erro ao processar a imagem do QR Code no navegador.');
        return;
      }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      let dataUrl = canvas.toDataURL('image/webp', 0.9);
      if (!dataUrl.startsWith('data:image/webp') || dataUrl.length > 140000) {
        dataUrl = canvas.toDataURL('image/png');
      }
      if (dataUrl.length > 140000) {
        dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      }
      const clean = sanitizePixQrCodeUrl(dataUrl);
      if (!clean) {
        setQrUploadError('A imagem do QR Code ficou grande demais. Tente uma imagem menor.');
        return;
      }
      setFormSettings((prev) => ({ ...prev, pixQrCodeDataUrl: clean }));
    } catch (err) {
      setQrUploadError(
        err instanceof Error ? err.message : 'Não foi possível carregar o QR Code.'
      );
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    const token = await getAdminToken();
    if (!token) return;
    setSavingSettings(true);
    setSettingsMsg(null);
    const sanitizedSettings: AppSettingsDoc = {
      ...formSettings,
      pixQrCodeDataUrl: sanitizePixQrCodeUrl(formSettings.pixQrCodeDataUrl),
    };
    try {
      if (googleUser && isGoogleAdmin) {
        await savePublicSettings(sanitizedSettings, token);
        setSettingsMsg('Configurações, chave Pix e QR Code salvos no Firebase e servidor!');
      } else {
        const res = await fetch('/api/admin/config-public', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            whatsappNumber: sanitizedSettings.whatsappNumber,
            pixKey: sanitizedSettings.pixKey,
            pixType: sanitizedSettings.pixType,
            pixReceiverName: sanitizedSettings.pixReceiverName,
            pixQrCodeDataUrl: sanitizedSettings.pixQrCodeDataUrl,
            tvOnlyAntiRetransmission: sanitizedSettings.tvOnlyAntiRetransmission,
          }),
        });
        if (!res.ok) {
          throw new Error('Não foi possível salvar no servidor.');
        }
        setSettingsMsg('WhatsApp, chave Pix, QR Code e Anti-Retransmissão salvos no servidor!');
      }
      window.dispatchEvent(new Event('mengao-catalog-refresh'));
    } catch (err) {
      setSettingsMsg(err instanceof Error ? err.message : 'Erro ao salvar configurações.');
    } finally {
      setSavingSettings(false);
    }
  }

  function getDefaultDaysForRequest(req: PaymentRequestItem): number {
    if (renewDaysByRequest[req.id] !== undefined) {
      return renewDaysByRequest[req.id];
    }
    const matched = plans.find((p) => p.name === req.planName);
    if (matched && matched.days > 0) return matched.days;
    const normalized = req.planName.toLowerCase();
    if (normalized.includes('1 ano')) return 365;
    if (normalized.includes('6 mes')) return 180;
    if (normalized.includes('3 mes')) return 90;
    return 30;
  }

  async function handleRenewRequest(req: PaymentRequestItem) {
    const token = await getAdminToken();
    if (!token) return;
    const dias = getDefaultDaysForRequest(req);
    const validade_ate = renewDateByRequest[req.id] || '';
    setRenewingRequestId(req.id);
    setRequestFeedback(null);
    try {
      const res = await fetch(`/api/admin/solicitacoes/${encodeURIComponent(req.id)}/renovar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dias,
          validade_ate: dias === 0 ? validade_ate : undefined,
          plano: req.planName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRequestFeedback(data.erro || 'Não foi possível gerar a chave para este pedido.');
        return;
      }
      if (data.solicitacao) {
        setPaymentRequests((prev) =>
          prev.map((item) => (item.id === req.id ? (data.solicitacao as PaymentRequestItem) : item))
        );
      }
      if (isGoogleAdmin && data.chave) {
        await logOfflineLicenseToFirestore(data.chave).catch(() => undefined);
      }
      setRequestFeedback(
        `Chave gerada para ${req.customerName} (${req.deviceCode})! Agora clique em "Enviar para o cliente".`
      );
      await fetchAdminServerData();
    } finally {
      setRenewingRequestId(null);
    }
  }

  async function handleDeleteRequest(requestId: string) {
    const token = await getAdminToken();
    if (!token) return;
    const res = await fetch(`/api/admin/solicitacoes/${encodeURIComponent(requestId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setPaymentRequests((prev) => prev.filter((item) => item.id !== requestId));
    }
  }

  async function handleDeleteDevMessage(messageId: string) {
    const token = await getAdminToken();
    if (!token) return;
    setDeletingMsgId(messageId);
    try {
      const res = await fetch(`/api/admin/mensagens/${encodeURIComponent(messageId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setDevMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
    } finally {
      setDeletingMsgId(null);
    }
  }

  async function handleClearAllDevMessages() {
    const token = await getAdminToken();
    if (!token) return;
    setClearingAllMsgs(true);
    try {
      const res = await fetch('/api/admin/mensagens', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setDevMessages([]);
      }
    } finally {
      setClearingAllMsgs(false);
    }
  }

  function formatRemainingRetention(expiresAt: string): string {
    const diffMs = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(diffMs) || diffMs <= 0) return 'Expira em breve';
    const totalHours = Math.ceil(diffMs / (60 * 60 * 1000));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return days > 0 ? `Apaga em ${days}d ${hours}h` : `Apaga em ${hours}h`;
  }

  function startEditingPlan(plan: PlanItem) {
    setEditingPlanId(plan.id);
    setPlanDraft({ ...plan });
    setPlanFeaturesText(plan.features.join('\n'));
    setPlanFeedback(null);
  }

  async function handleSaveEditedPlan(e: React.FormEvent) {
    e.preventDefault();
    if (!planDraft) return;
    const token = await getAdminToken();
    setSavingPlan(true);
    setPlanFeedback(null);
    try {
      const updated: PlanItem = {
        ...planDraft,
        features: planFeaturesText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8),
      };
      if (token) {
        await fetch('/api/admin/plans', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ plan: updated, seedDefaults: plans }),
        });
      }
      if (googleUser && isGoogleAdmin) {
        await upsertPlan(updated);
      }
      window.dispatchEvent(new Event('mengao-catalog-refresh'));
      setEditingPlanId(null);
      setPlanDraft(null);
      setPlanFeedback(`Plano "${updated.name}" atualizado na vitrine!`);
    } catch (err) {
      setPlanFeedback(err instanceof Error ? err.message : 'Não foi possível salvar o plano.');
    } finally {
      setSavingPlan(false);
    }
  }

  async function handleCreateNewPlan(e: React.FormEvent) {
    e.preventDefault();
    if (!newPlanName.trim() || !newPlanPrice.trim()) return;
    const token = await getAdminToken();
    setSavingPlan(true);
    setPlanFeedback(null);
    try {
      const slug = `plan-${newPlanName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;
      const item: PlanItem = {
        id: slug,
        name: newPlanName.trim(),
        subtitle: newPlanSubtitle.trim() || 'Plano personalizado do Mengão',
        priceText: newPlanPrice.trim(),
        days: Math.max(0, Math.min(3650, Math.floor(newPlanDays))),
        periodLabel: '· Pix ou WhatsApp',
        features: newPlanFeatures
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8),
        featured: false,
        active: true,
        sortOrder: plans.length + 1,
      };
      if (token) {
        await fetch('/api/admin/plans', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ plan: item, seedDefaults: plans }),
        });
      }
      if (googleUser && isGoogleAdmin) {
        await upsertPlan(item);
      }
      window.dispatchEvent(new Event('mengao-catalog-refresh'));
      setNewPlanName('');
      setNewPlanPrice('');
      setNewPlanDays(30);
      setNewPlanSubtitle('');
      setNewPlanFeatures('');
      setPlanFeedback(`Novo plano "${item.name}" adicionado na vitrine!`);
    } catch (err) {
      setPlanFeedback(err instanceof Error ? err.message : 'Não foi possível criar o plano.');
    } finally {
      setSavingPlan(false);
    }
  }

  async function handleDeletePlan(planId: string, planName: string) {
    const token = await getAdminToken();
    setSavingPlan(true);
    setPlanFeedback(null);
    try {
      if (token) {
        await fetch(`/api/admin/plans/${encodeURIComponent(planId)}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ seedDefaults: plans }),
        });
      }
      if (googleUser && isGoogleAdmin) {
        await deletePlanById(planId);
      }
      window.dispatchEvent(new Event('mengao-catalog-refresh'));
      if (editingPlanId === planId) {
        setEditingPlanId(null);
        setPlanDraft(null);
      }
      setPlanFeedback(`Plano "${planName}" removido.`);
    } catch (err) {
      setPlanFeedback(err instanceof Error ? err.message : 'Não foi possível remover o plano.');
    } finally {
      setSavingPlan(false);
    }
  }

  function handleDaysPresetChange(days: number) {
    setOfflineDays(days);
    if (days > 0) {
      const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      setValidadeDate(target.toISOString().slice(0, 10));
    }
    if (days === 30) setOfflinePlan('1 Mês');
    else if (days === 90) setOfflinePlan('3 Meses');
    else if (days === 180) setOfflinePlan('6 Meses');
    else if (days === 365) setOfflinePlan('1 Ano');
    else setOfflinePlan('Outros');
  }

  function handleOfflinePlanSelect(planName: string) {
    setOfflinePlan(planName);
    const matched = plans.find((p) => p.name === planName);
    if (matched && matched.days > 0) {
      setOfflineDays(matched.days);
      setValidadeDate(
        new Date(Date.now() + matched.days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      );
    } else {
      setOfflineDays(0);
    }
  }

  async function handleGenerateOfflineKey(e: React.FormEvent) {
    e.preventDefault();
    const token = await getAdminToken();
    if (!token) return;
    setOfflineError(null);
    setGeneratingKey(true);
    try {
      const res = await fetch('/api/admin/gerar-chave-offline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          deviceCode: deviceCodeInput,
          dias: offlineDays,
          validade_ate: validadeDate,
          plano: offlinePlan,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOfflineError(data.erro || 'Não foi possível gerar a chave.');
        return;
      }
      setGeneratedKey(data.chave);
      setDeviceCodeInput('');
      if (isGoogleAdmin) {
        await logOfflineLicenseToFirestore(data.chave).catch(() => undefined);
      }
      await fetchAdminServerData();
    } finally {
      setGeneratingKey(false);
    }
  }

  if (!authReady) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center text-sm text-zinc-400">
        Verificando sessão Google...
      </div>
    );
  }

  if (!isAuthorizedAdmin) {
    return (
      <div className="px-4 py-12 sm:px-6 sm:py-16">
        <AdminPasscodeForm
          title="Painel Admin · Jogos do Mengão"
          subtitle="Entre com sua Conta Google Admin ou Senha de Administrador"
          googleUser={googleUser}
          authLoading={authLoading}
          authError={authError}
          onGoogleSignIn={handleGoogleSignIn}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 space-y-8">
      {/* Cabeçalho do Administrador */}
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3.5">
          <MengaoShield className="h-10 w-10 shrink-0" />
          <div>
            <h1 className="font-display text-3xl font-bold text-white">
              Administração · {settings.appName}
            </h1>
            <p className="text-xs text-zinc-400">
              {isGoogleAdmin
                ? `Conectado via Google: ${googleUser?.displayName || 'Administrador'} (${googleUser?.email})`
                : 'Conectado via Senha de Administrador (sessão protegida em memória)'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!isGoogleAdmin && (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={authLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
            >
              {authLoading ? 'Conectando ao Google...' : 'Conectar também conta Google'}
            </button>
          )}
          {!isGoogleAdmin && typeof window !== 'undefined' && window.self !== window.top && (
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
            >
              <ExternalLink className="h-3.5 w-3.5 text-[#C8102E]" />
              Abrir em nova aba
            </a>
          )}
          <button
            type="button"
            onClick={() => fetchAdminServerData()}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-zinc-100 hover:bg-zinc-800 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingStats ? 'animate-spin' : ''}`} />
            Atualizar uso
          </button>
          <button
            type="button"
            onClick={handleSignOutAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair do Admin
          </button>
        </div>
      </div>

      {authError && (
        <div className="flex flex-col gap-2 rounded-xl border border-red-900/60 bg-red-950/60 p-4 text-xs text-red-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{authError}</span>
          {typeof window !== 'undefined' && (
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-800/80 bg-zinc-950 px-3 py-1.5 font-semibold text-white hover:bg-zinc-900"
            >
              <ExternalLink className="h-3.5 w-3.5 text-[#C8102E]" />
              Abrir em nova aba para Login Google
            </a>
          )}
        </div>
      )}

      {/* 0. Função Transmitir Ao Vivo (Escolher App Nativo) + Auto-Publicação Site e APK */}
      <LiveBroadcastPanel getAdminToken={getAdminToken} appName={settings.appName} />
      <DistributionCard appName={settings.appName} adminToken={adminIdToken || passcodeToken} />

      {/* 1. Pessoas usando o aplicativo em tempo real */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-[#C8102E]" />
            <h2 className="font-display text-2xl font-bold text-white">
              Quantas pessoas estão usando seu app
            </h2>
          </div>
          <span className="text-xs text-zinc-400">Atualização automática a cada 15s</span>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-xs text-zinc-400">Usando agora (online)</p>
            <p className="mt-2 font-display text-4xl font-extrabold text-emerald-400 tabular-nums">
              {deviceStats.onlineAgora}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-xs text-zinc-400">Aparelhos instalados</p>
            <p className="mt-2 font-display text-4xl font-extrabold text-white tabular-nums">
              {deviceStats.totalInstalados}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-xs text-zinc-400">Licenças ativas</p>
            <p className="mt-2 font-display text-4xl font-extrabold text-white tabular-nums">
              {deviceStats.ativosComLicenca}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-xs text-zinc-400">Smart TVs pareadas</p>
            <p className="mt-2 font-display text-4xl font-extrabold text-red-400 tabular-nums">
              {deviceStats.tvsConectadas}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-800 bg-zinc-950 text-zinc-400">
              <tr>
                <th className="px-5 py-3 font-medium">Código do aparelho</th>
                <th className="px-5 py-3 font-medium">Plataforma / Tipo</th>
                <th className="px-5 py-3 font-medium">Atividade</th>
                <th className="px-5 py-3 font-medium">Licença / Plano</th>
                <th className="px-5 py-3 font-medium">Último sinal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {deviceStats.dispositivos.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-zinc-400">
                    Nenhum aparelho abriu o App ainda. Assim que um cliente instalar e abrir o app
                    Jogos do Mengão, ele aparecerá aqui.
                  </td>
                </tr>
              ) : (
                deviceStats.dispositivos.map((dev) => {
                  const isOnlineNow =
                    Date.now() - new Date(dev.lastSeenAt).getTime() <= 3 * 60 * 1000;
                  return (
                    <tr key={dev.deviceCode} className="hover:bg-zinc-950/60">
                      <td className="px-5 py-3 font-mono font-semibold text-white">
                        {dev.deviceCode}
                      </td>
                      <td className="px-5 py-3 text-zinc-300">
                        {dev.isTv ? 'Smart TV' : 'Celular / PWA'} · {dev.platform}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`font-semibold ${
                            isOnlineNow ? 'text-emerald-400' : 'text-zinc-400'
                          }`}
                        >
                          {dev.isStreaming
                            ? 'Assistindo agora'
                            : isOnlineNow
                              ? 'App aberto agora'
                              : 'Offline'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-zinc-300">
                        {dev.licenseActive ? `Ativo · ${dev.planName}` : 'Aguardando chave'}
                      </td>
                      <td className="px-5 py-3 font-mono text-zinc-400 tabular-nums">
                        {new Date(dev.lastSeenAt).toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Configurações de WhatsApp, Pix e Anti-Retransmissão */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#C8102E]" />
          <h2 className="font-display text-2xl font-bold text-white">
            WhatsApp, Pix e Proteção Anti-Retransmissão
          </h2>
        </div>

        <form onSubmit={handleSaveSettings} className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-zinc-300">Nome do App e Vitrine</label>
            <input
              type="text"
              required
              maxLength={60}
              value={formSettings.appName}
              onChange={(e) => setFormSettings({ ...formSettings, appName: e.target.value })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-8">
            <label className="block text-xs font-medium text-zinc-300">Frase de destaque na Vitrine</label>
            <input
              type="text"
              required
              maxLength={160}
              value={formSettings.tagline}
              onChange={(e) => setFormSettings({ ...formSettings, tagline: e.target.value })}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-zinc-300">
              Seu WhatsApp (DDI + DDD + número)
            </label>
            <input
              type="tel"
              value={formSettings.whatsappNumber}
              onChange={(e) => setFormSettings({ ...formSettings, whatsappNumber: e.target.value })}
              placeholder="5521999999999"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-zinc-300">Tipo da Chave Pix</label>
            <select
              value={formSettings.pixType}
              onChange={(e) =>
                setFormSettings({ ...formSettings, pixType: e.target.value as PixType })
              }
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-[#C8102E] focus:outline-none"
            >
              <option value="CPF">CPF</option>
              <option value="CNPJ">CNPJ</option>
              <option value="E-mail">E-mail</option>
              <option value="Telefone">Telefone</option>
              <option value="Aleatória">Aleatória</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-zinc-300">Chave Pix</label>
            <input
              type="text"
              maxLength={140}
              value={formSettings.pixKey}
              onChange={(e) => setFormSettings({ ...formSettings, pixKey: e.target.value })}
              placeholder="Sua chave Pix para recebimento"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-zinc-300">Nome do recebedor Pix</label>
            <input
              type="text"
              maxLength={80}
              value={formSettings.pixReceiverName}
              onChange={(e) =>
                setFormSettings({ ...formSettings, pixReceiverName: e.target.value })
              }
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          {/* QR Code Pix (Upload ou link HTTPS) */}
          <div className="md:col-span-12 rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <QrCode className="h-4 w-4 text-[#C8102E]" />
                <span>QR Code Pix (exibido para o cliente na Vitrine e no App)</span>
              </div>
              {sanitizePixQrCodeUrl(formSettings.pixQrCodeDataUrl) && (
                <button
                  type="button"
                  onClick={() =>
                    setFormSettings({ ...formSettings, pixQrCodeDataUrl: '' })
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-zinc-800 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                  Remover QR Code
                </button>
              )}
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="shrink-0 flex h-28 w-28 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden">
                {sanitizePixQrCodeUrl(formSettings.pixQrCodeDataUrl) ? (
                  <div className="h-full w-full bg-white p-1.5 flex items-center justify-center">
                    <img
                      src={sanitizePixQrCodeUrl(formSettings.pixQrCodeDataUrl)}
                      alt="Prévia QR Code Pix"
                      className="h-full w-full object-contain"
                    />
                  </div>
                ) : (
                  <QrCode className="h-8 w-8 text-zinc-600" />
                )}
              </div>

              <div className="flex-1 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 cursor-pointer">
                    <ImagePlus className="h-4 w-4 text-[#C8102E]" />
                    <span>Enviar imagem do QR Code (PNG/JPG)</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        void handleQrFileChange(file);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                  <span className="text-[11px] text-zinc-400">
                    Ajustado automaticamente para leitura nítida no celular e TV.
                  </span>
                </div>

                <div>
                  <label className="block text-[11px] text-zinc-400">
                    Ou cole uma URL HTTPS da imagem do QR Code (opcional)
                  </label>
                  <input
                    type="url"
                    value={
                      formSettings.pixQrCodeDataUrl?.startsWith('https://')
                        ? formSettings.pixQrCodeDataUrl
                        : ''
                    }
                    onChange={(e) =>
                      setFormSettings({
                        ...formSettings,
                        pixQrCodeDataUrl: e.target.value,
                      })
                    }
                    placeholder="https://..."
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
                  />
                </div>

                {qrUploadError && (
                  <p className="text-xs text-red-300">{qrUploadError}</p>
                )}
              </div>
            </div>
          </div>

          <div className="md:col-span-9 flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
            <input
              id="tvOnlyToggle"
              type="checkbox"
              checked={formSettings.tvOnlyAntiRetransmission}
              onChange={(e) =>
                setFormSettings({
                  ...formSettings,
                  tvOnlyAntiRetransmission: e.target.checked,
                })
              }
              className="h-4 w-4 accent-[#C8102E]"
            />
            <label htmlFor="tvOnlyToggle" className="text-xs text-zinc-200 cursor-pointer">
              <span className="font-semibold text-white">Proteção Anti-Retransmissão:</span>{' '}
              bloquear retransmissão para outros aparelhos e liberar transmissão somente para Smart
              TVs (Android TV e LG webOS).
            </label>
          </div>

          <div className="md:col-span-3 flex items-center">
            <button
              type="submit"
              disabled={savingSettings}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C8102E] px-4 py-3 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {savingSettings ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
        </form>

        {settingsMsg && (
          <p className="rounded-lg bg-emerald-950/60 px-3 py-2 text-xs text-emerald-300">
            {settingsMsg}
          </p>
        )}
      </section>

      {/* 3. Gerenciar Planos, Valores e Adicionar Novos Planos */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-6">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              Gerenciar Planos e Valores da Vitrine
            </h2>
            <p className="text-xs text-zinc-400">
              Edite preços, nomes e duração ou adicione novos planos instantaneamente.
            </p>
          </div>
          {planFeedback && (
            <span className="text-xs font-semibold text-emerald-400">{planFeedback}</span>
          )}
        </div>
        {!isGoogleAdmin && (
          <p className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-2.5 text-xs text-amber-200">
            Para criar ou editar planos na vitrine sincronizada do Firebase, clique em{' '}
            <strong className="text-white">Conectar também conta Google</strong> no topo.
          </p>
        )}

        {/* Lista de planos com edição inline */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 flex flex-col justify-between gap-4"
            >
              {editingPlanId === plan.id && planDraft ? (
                <form onSubmit={handleSaveEditedPlan} className="space-y-3">
                  <input
                    type="text"
                    required
                    value={planDraft.name}
                    onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })}
                    placeholder="Nome do plano"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-white"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={planDraft.priceText}
                      onChange={(e) => setPlanDraft({ ...planDraft, priceText: e.target.value })}
                      placeholder="Valor (ex: R$ 29,90)"
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-white"
                    />
                    <input
                      type="number"
                      min={0}
                      max={3650}
                      value={planDraft.days}
                      onChange={(e) =>
                        setPlanDraft({ ...planDraft, days: Number(e.target.value) })
                      }
                      placeholder="Dias"
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-white"
                    />
                  </div>
                  <input
                    type="text"
                    value={planDraft.subtitle}
                    onChange={(e) => setPlanDraft({ ...planDraft, subtitle: e.target.value })}
                    placeholder="Descrição curta"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white"
                  />
                  <textarea
                    rows={3}
                    value={planFeaturesText}
                    onChange={(e) => setPlanFeaturesText(e.target.value)}
                    placeholder="Benefícios (1 por linha)"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white"
                  />
                  <div className="flex items-center gap-4 text-xs text-zinc-300">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={planDraft.active}
                        onChange={(e) => setPlanDraft({ ...planDraft, active: e.target.checked })}
                      />
                      Visível na vitrine
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={planDraft.featured}
                        onChange={(e) =>
                          setPlanDraft({ ...planDraft, featured: e.target.checked })
                        }
                      />
                      Destaque
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={savingPlan}
                      className="flex-1 rounded-md bg-[#C8102E] py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPlanId(null);
                        setPlanDraft(null);
                      }}
                      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                      <span>{plan.active ? 'Ativo na vitrine' : 'Oculto'}</span>
                      <span className="font-mono tabular-nums">{plan.days}d</span>
                    </div>
                    <h3 className="mt-1 font-display text-xl font-bold text-white">{plan.name}</h3>
                    <p className="font-mono text-lg font-bold text-red-400 tabular-nums">
                      {plan.priceText}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">{plan.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
                    <button
                      type="button"
                      onClick={() => startEditingPlan(plan)}
                      className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800"
                    >
                      Editar valor / texto
                    </button>
                    <button
                      type="button"
                      disabled={savingPlan}
                      onClick={() => handleDeletePlan(plan.id, plan.name)}
                      className="rounded-md border border-red-900/60 bg-red-950/40 p-1.5 text-red-400 hover:bg-red-950"
                      aria-label={`Excluir plano ${plan.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Adicionar Novo Plano */}
        <form
          onSubmit={handleCreateNewPlan}
          className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-4"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Plus className="h-4 w-4 text-[#C8102E]" />
            <span>Adicionar novo plano na vitrine</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <input
                type="text"
                required
                value={newPlanName}
                onChange={(e) => setNewPlanName(e.target.value)}
                placeholder="Nome (ex: Plano Libertadores)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <input
                type="text"
                required
                value={newPlanPrice}
                onChange={(e) => setNewPlanPrice(e.target.value)}
                placeholder="Valor (ex: R$ 49,90)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <input
                type="number"
                min={0}
                max={3650}
                value={newPlanDays}
                onChange={(e) => setNewPlanDays(Number(e.target.value))}
                placeholder="Dias"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
              />
            </div>
            <div className="md:col-span-3">
              <input
                type="text"
                value={newPlanSubtitle}
                onChange={(e) => setNewPlanSubtitle(e.target.value)}
                placeholder="Descrição curta"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={savingPlan}
                className="w-full rounded-lg bg-[#C8102E] px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                Adicionar plano
              </button>
            </div>
          </div>
          <input
            type="text"
            value={newPlanFeatures}
            onChange={(e) => setNewPlanFeatures(e.target.value)}
            placeholder="Benefício principal (opcional)"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
          />
        </form>
      </section>

      {/* 4. Ativação e Renovação (Pré-cadastros + Renovar Agora + Gerador Manual) */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-[#C8102E]" />
            <div>
              <h2 className="font-display text-2xl font-bold text-white">
                Ativação e Renovação
              </h2>
              <p className="text-xs text-zinc-400">
                Clientes que preencheram o pré-cadastro e clicaram em &ldquo;Já efetuei o pagamento&rdquo;.
                Confirme o Pix, clique em <strong className="text-white">Renovar agora</strong> e depois
                em <strong className="text-white">Enviar para o cliente</strong>.
              </p>
            </div>
          </div>
          <span className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1 font-mono text-xs text-zinc-300">
            {paymentRequests.filter((r) => r.status === 'pendente').length} pendente(s) ·{' '}
            {paymentRequests.length} total
          </span>
        </div>

        {requestFeedback && (
          <p className="rounded-lg border border-emerald-800 bg-emerald-950/60 px-4 py-2.5 text-xs text-emerald-200">
            {requestFeedback}
          </p>
        )}

        {/* Lista de Pedidos de Ativação / Renovação */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
            <UserCheck className="h-4 w-4 text-emerald-400" />
            <span>Pré-Cadastros &amp; Pagamentos Informados pelo Cliente</span>
          </div>

          {paymentRequests.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-xs text-zinc-400">
              Nenhum cliente enviou confirmação de pagamento ainda. Assim que alguém preencher o
              pré-cadastro e clicar em &ldquo;Já efetuei o pagamento&rdquo;, o pedido aparece aqui
              automaticamente com o botão <strong>Renovar agora</strong>.
            </div>
          ) : (
            <div className="space-y-3">
              {paymentRequests.map((req) => {
                const selectedDays = getDefaultDaysForRequest(req);
                const sendHref =
                  req.activationKey && req.expira_em
                    ? buildAdminSendKeyToCustomerHref({
                        customerName: req.customerName,
                        customerWhatsapp: req.customerWhatsapp,
                        appName: settings.appName,
                        planName: req.planName,
                        deviceCode: req.deviceCode,
                        expiresDateLabel: formatDatePtBr(req.expira_em),
                        activationKey: req.activationKey,
                      })
                    : '';

                return (
                  <div
                    key={req.id}
                    className={`rounded-xl border p-4 space-y-3 ${
                      req.status === 'pendente'
                        ? 'border-amber-700/60 bg-zinc-950'
                        : 'border-emerald-800/70 bg-zinc-950'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-white">{req.customerName}</span>
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              req.status === 'pendente'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            }`}
                          >
                            {req.status === 'pendente'
                              ? 'Aguardando confirmação Pix'
                              : `Liberado até ${formatDatePtBr(req.expira_em || null)}`}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-300">
                          <span>
                            WhatsApp cliente:{' '}
                            <strong className="font-mono text-white">{req.customerWhatsapp}</strong>
                          </span>
                          <span>
                            Plano: <strong className="text-white">{req.planName}</strong> (
                            {req.planPrice}
                            {req.customValidity ? ` · ${req.customValidity}` : ''})
                          </span>
                          <span>
                            Aparelho:{' '}
                            <code className="font-mono font-bold text-red-300">{req.deviceCode}</code>
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          Enviado em {new Date(req.createdAt).toLocaleString('pt-BR')}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Duração para ${req.customerName}`}
                          value={selectedDays}
                          onChange={(e) =>
                            setRenewDaysByRequest((prev) => ({
                              ...prev,
                              [req.id]: Number(e.target.value),
                            }))
                          }
                          className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white focus:border-[#C8102E] focus:outline-none"
                        >
                          <option value={30}>30 dias (1 mês)</option>
                          <option value={90}>90 dias (3 meses)</option>
                          <option value={180}>180 dias (6 meses)</option>
                          <option value={365}>365 dias (1 ano)</option>
                          <option value={15}>15 dias</option>
                          <option value={0}>Data personalizada</option>
                        </select>

                        {selectedDays === 0 && (
                          <input
                            type="date"
                            value={
                              renewDateByRequest[req.id] ||
                              new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                                .toISOString()
                                .slice(0, 10)
                            }
                            onChange={(e) =>
                              setRenewDateByRequest((prev) => ({
                                ...prev,
                                [req.id]: e.target.value,
                              }))
                            }
                            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-white"
                          />
                        )}

                        <button
                          type="button"
                          disabled={renewingRequestId === req.id}
                          onClick={() => void handleRenewRequest(req)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#C8102E] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          {renewingRequestId === req.id
                            ? 'Gerando...'
                            : req.status === 'liberado'
                              ? 'Renovar novamente'
                              : 'Renovar agora'}
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDeleteRequest(req.id)}
                          aria-label={`Excluir solicitação de ${req.customerName}`}
                          className="rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-400 hover:bg-red-950/60 hover:text-red-300 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {req.activationKey && (
                      <div className="rounded-lg border border-emerald-800/70 bg-emerald-950/40 p-3 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-emerald-300">
                            Chave de liberação pronta ({req.diasLiberados || selectedDays} dias):
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(req.activationKey || '');
                                setCopiedRequestKeyId(req.id);
                                window.setTimeout(() => setCopiedRequestKeyId(null), 1800);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-zinc-800 cursor-pointer"
                            >
                              {copiedRequestKeyId === req.id ? (
                                <>
                                  <Check className="h-3.5 w-3.5" />
                                  Chave copiada
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5" />
                                  Copiar chave
                                </>
                              )}
                            </button>

                            <a
                              href={sendHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                              Enviar para o cliente
                            </a>
                          </div>
                        </div>
                        <p className="break-all font-mono text-[11px] text-emerald-100">
                          {req.activationKey}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Gerador Manual por Código */}
        <div className="border-t border-zinc-800 pt-5 space-y-4">
          <h3 className="text-sm font-bold text-white">
            Gerador Manual de Chave por Código do Aparelho
          </h3>

          <form onSubmit={handleGenerateOfflineKey} className="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-end">
            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-zinc-300">
                Código do aparelho (WhatsApp)
              </label>
              <input
                type="text"
                required
                value={deviceCodeInput}
                onChange={(e) => setDeviceCodeInput(e.target.value.toUpperCase())}
                placeholder="TC-A1B2-C3D4"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm uppercase text-white focus:border-[#C8102E] focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-300">Duração</label>
              <select
                value={offlineDays}
                onChange={(e) => handleDaysPresetChange(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-[#C8102E] focus:outline-none"
              >
                <option value={30}>1 mês (30 dias)</option>
                <option value={90}>3 meses (90 dias)</option>
                <option value={180}>6 meses (180 dias)</option>
                <option value={365}>1 ano (365 dias)</option>
                <option value={0}>Outros (escolher data)</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-medium text-zinc-300">Data de validade</label>
              <input
                type="date"
                required
                value={validadeDate}
                onChange={(e) => setValidadeDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white focus:border-[#C8102E] focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-300">Plano</label>
              <select
                value={offlinePlan}
                onChange={(e) => handleOfflinePlanSelect(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-[#C8102E] focus:outline-none"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
                {!plans.some((p) => p.name === 'Outros') && <option value="Outros">Outros</option>}
              </select>
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={generatingKey}
                className="w-full rounded-lg bg-[#C8102E] px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 whitespace-nowrap"
              >
                {generatingKey ? 'Gerando...' : 'Gerar chave'}
              </button>
            </div>
          </form>

          {offlineError && (
            <p className="rounded-lg bg-red-950/70 px-3 py-2 text-xs text-red-300">{offlineError}</p>
          )}

          {generatedKey && (
            <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-200">
                  Chave gerada para {generatedKey.deviceCode} · {generatedKey.plano} · vence em{' '}
                  {formatDatePtBr(generatedKey.expira_em)} ({generatedKey.dias}d)
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(generatedKey.activationKey);
                      setCopiedGenerated(true);
                      window.setTimeout(() => setCopiedGenerated(false), 1800);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-zinc-800"
                  >
                    {copiedGenerated ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Copiada
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copiar chave
                      </>
                    )}
                  </button>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      `Sua assinatura ${settings.appName} (${generatedKey.plano}) foi liberada até ${formatDatePtBr(
                        generatedKey.expira_em
                      )} para o aparelho ${generatedKey.deviceCode}.\n\nCole esta chave no aplicativo:\n${generatedKey.activationKey}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                    Enviar no WhatsApp
                  </a>
                </div>
              </div>
              <p className="break-all font-mono text-xs text-emerald-100">
                {generatedKey.activationKey}
              </p>
            </div>
          )}

          {offlineKeys.length > 0 && (
            <div className="overflow-x-auto border-t border-zinc-800 pt-4">
              <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-zinc-400">
                <Tv className="h-3.5 w-3.5" />
                Últimas chaves offline emitidas
              </p>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-zinc-800 text-zinc-400">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Aparelho</th>
                    <th className="py-2 pr-4 font-medium">Plano</th>
                    <th className="py-2 pr-4 font-medium">Dias</th>
                    <th className="py-2 pr-4 font-medium">Validade</th>
                    <th className="py-2 font-medium">Chave</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {offlineKeys.slice(0, 8).map((item) => (
                    <tr key={item.id}>
                      <td className="py-2 pr-4 font-mono font-semibold text-white">
                        {item.deviceCode}
                      </td>
                      <td className="py-2 pr-4 text-zinc-300">{item.plano}</td>
                      <td className="py-2 pr-4 font-mono tabular-nums text-zinc-300">
                        {item.dias}d
                      </td>
                      <td className="py-2 pr-4 font-mono tabular-nums text-zinc-400">
                        {formatDatePtBr(item.expira_em)}
                      </td>
                      <td className="py-2 font-mono text-[11px] text-zinc-500 truncate max-w-[240px]">
                        {item.activationKey}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* 5. Blindagem & Proteção Anti-Hacker em Tempo Real */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 className="font-display text-2xl font-bold text-white">
                Blindagem &amp; Proteção Anti-Hacker Ativa
              </h2>
              <p className="text-xs text-zinc-400">
                Defesas OWASP gratuitas em camada de servidor contra invasões, força bruta e roubo de sinal.
              </p>
            </div>
          </div>
          <span className="font-mono text-xs font-semibold text-emerald-400">
            {securityStats ? `${securityStats.totalBlocked} ataques bloqueados` : 'Escudo ativo'}
          </span>
        </div>

        {securityStats && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-[11px] text-zinc-400">Bloqueios Força Bruta</p>
                <p className="mt-1 font-display text-3xl font-bold text-white tabular-nums">
                  {securityStats.counters.bruteForceBlocks}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-[11px] text-zinc-400">Rate Limit (Flood)</p>
                <p className="mt-1 font-display text-3xl font-bold text-white tabular-nums">
                  {securityStats.counters.rateLimitBlocks}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-[11px] text-zinc-400">Scanners &amp; Probes</p>
                <p className="mt-1 font-display text-3xl font-bold text-white tabular-nums">
                  {securityStats.counters.scannerBlocks}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-[11px] text-zinc-400">Injeções Neutralizadas</p>
                <p className="mt-1 font-display text-3xl font-bold text-white tabular-nums">
                  {securityStats.counters.sanitizedPayloads}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {securityStats.protections.map((prot) => (
                <div
                  key={prot.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 flex items-start gap-3"
                >
                  <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-white">{prot.name}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-400 leading-relaxed">
                      {prot.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {securityStats.recentEvents.length > 0 && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-2">
                <p className="text-xs font-semibold text-zinc-300">
                  Últimos eventos suspeitos neutralizados
                </p>
                <div className="space-y-1.5 max-h-44 overflow-y-auto font-mono text-[11px]">
                  {securityStats.recentEvents.slice(0, 10).map((ev) => (
                    <div
                      key={ev.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900 pb-1 text-zinc-400"
                    >
                      <span className="text-amber-300">{ev.detail}</span>
                      <span>
                        {ev.ip} · {new Date(ev.timestamp).toLocaleTimeString('pt-BR')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* 6. Mensagens para o Desenvolvedor (Retenção automática de 5 dias) */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-[#C8102E]" />
            <div>
              <h2 className="font-display text-2xl font-bold text-white">
                Mensagens de Clientes para o Desenvolvedor
              </h2>
              <p className="text-xs text-zinc-400">
                Armazenadas no site com limpeza automática a cada 5 dias. Você pode apagar qualquer
                mensagem manualmente a qualquer horário.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              {devMessages.length} mensagem(ns)
            </span>
            {devMessages.length > 0 && (
              <button
                type="button"
                disabled={clearingAllMsgs}
                onClick={() => void handleClearAllDevMessages()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/70 bg-red-950/50 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-950 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {clearingAllMsgs ? 'Apagando...' : 'Apagar todas'}
              </button>
            )}
          </div>
        </div>

        {devMessages.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-xs text-zinc-400">
            Nenhuma mensagem de cliente armazenada no momento.
          </div>
        ) : (
          <div className="space-y-3">
            {devMessages.map((msg) => {
              const replyDigits = formatWhatsappNumberForWaMe(msg.senderWhatsapp);
              const replyHref = replyDigits
                ? `https://wa.me/${replyDigits}?text=${encodeURIComponent(
                    `Olá ${msg.senderName}, recebemos sua mensagem no app ${settings.appName} sobre "${msg.category}".`
                  )}`
                : '';

              return (
                <div
                  key={msg.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white">{msg.senderName}</span>
                        <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-200">
                          {msg.category}
                        </span>
                        <span className="rounded border border-amber-900/60 bg-amber-950/40 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                          {formatRemainingRetention(msg.expiresAt)}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400">
                        Recebida em {new Date(msg.createdAt).toLocaleString('pt-BR')}
                        {msg.senderWhatsapp ? ` · WhatsApp: ${msg.senderWhatsapp}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {replyHref && (
                        <a
                          href={replyHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600"
                        >
                          <MessageCircle className="h-3 w-3" />
                          Responder
                        </a>
                      )}
                      <button
                        type="button"
                        disabled={deletingMsgId === msg.id}
                        onClick={() => void handleDeleteDevMessage(msg.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-red-900/60 bg-red-950/40 px-2.5 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-950 disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                        {deletingMsgId === msg.id ? 'Apagando...' : 'Apagar'}
                      </button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-xs text-zinc-200 leading-relaxed">
                    {msg.message}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
