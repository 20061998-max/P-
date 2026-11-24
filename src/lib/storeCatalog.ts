import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

export type PixType = 'CPF' | 'CNPJ' | 'E-mail' | 'Telefone' | 'Aleatória';

export interface AppSettingsDoc {
  appName: string;
  tagline: string;
  whatsappNumber: string;
  pixKey: string;
  pixType: PixType;
  pixReceiverName: string;
  pixQrCodeDataUrl?: string;
  tvOnlyAntiRetransmission: boolean;
}

export interface PlanItem {
  id: string;
  name: string;
  subtitle: string;
  priceText: string;
  days: number;
  periodLabel: string;
  features: string[];
  featured: boolean;
  active: boolean;
  sortOrder: number;
}

export function sanitizePixQrCodeUrl(raw?: string): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 150000) return '';
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export const DEFAULT_SETTINGS: AppSettingsDoc = {
  appName: 'Jogos do Mengão',
  tagline: 'Transmissão exclusiva no App e Smart TV com elenco rubro-negro em campo.',
  whatsappNumber: '',
  pixKey: 'Configure sua chave Pix no Painel Admin',
  pixType: 'Aleatória',
  pixReceiverName: 'Administração Jogos do Mengão',
  pixQrCodeDataUrl: '',
  tvOnlyAntiRetransmission: true,
};

export const DEFAULT_PLANS: PlanItem[] = [
  {
    id: 'plan-1-mes',
    name: '1 Mês',
    subtitle: 'Acesso completo por 30 dias em 1 aparelho exclusivo',
    priceText: 'R$ 29,90',
    days: 30,
    periodLabel: '· Pix ou WhatsApp',
    features: [
      'Código único do aparelho (bloqueado se repassado a terceiros)',
      'Liberação rápida via Pix ou atendimento pelo WhatsApp',
      'Funciona no App instalado (Android, iOS, Android TV e LG webOS)',
    ],
    featured: false,
    active: true,
    sortOrder: 1,
  },
  {
    id: 'plan-3-meses',
    name: '3 Meses',
    subtitle: 'Mais escolhido para acompanhar os jogos na TV',
    priceText: 'R$ 79,90',
    days: 90,
    periodLabel: '· Pix ou WhatsApp',
    features: [
      'Validade estendida por 90 dias com verificação offline',
      'Proteção anti-retransmissão liberada exclusivamente para TVs',
      'Renovação imediata com mensagem pronta no WhatsApp',
    ],
    featured: true,
    active: true,
    sortOrder: 2,
  },
  {
    id: 'plan-6-meses',
    name: '6 Meses',
    subtitle: 'Meio ano de jogos do Mengão liberados',
    priceText: 'R$ 139,90',
    days: 180,
    periodLabel: '· Pix ou WhatsApp',
    features: [
      'Chave assinada exclusiva para o seu aparelho ou Smart TV',
      'Modo tela cheia e controle remoto para Android TV e LG webOS',
      'Suporte e pagamento direto via Pix ou WhatsApp',
    ],
    featured: false,
    active: true,
    sortOrder: 3,
  },
  {
    id: 'plan-1-ano',
    name: '1 Ano',
    subtitle: 'Temporada inteira do Mengão garantida',
    priceText: 'R$ 249,90',
    days: 365,
    periodLabel: '· Pix ou WhatsApp',
    features: [
      '365 dias de acesso offline validado no aparelho',
      'Trava anti-compartilhamento vinculada ao código do dispositivo',
      'Pagamento único via Pix ou WhatsApp',
    ],
    featured: false,
    active: true,
    sortOrder: 4,
  },
  {
    id: 'plan-outros',
    name: 'Outros',
    subtitle: 'Você escolhe a validade exata do plano',
    priceText: 'Sob consulta',
    days: 0,
    periodLabel: '· via WhatsApp',
    features: [
      'Informe quantos dias ou até qual data precisa assistir',
      'Envie sua validade e código para receber o valor no WhatsApp',
      'Chave gerada exatamente para a data combinada',
    ],
    featured: false,
    active: true,
    sortOrder: 5,
  },
];

function clampStr(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.floor(Number(value) || 0);
  return Math.max(min, Math.min(max, n));
}

export function subscribePublicSettings(
  onChange: (settings: AppSettingsDoc) => void
): () => void {
  const ref = doc(db, 'settings', 'public');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onChange(DEFAULT_SETTINGS);
        return;
      }
      const d = snap.data() as Partial<AppSettingsDoc>;
      onChange({
        appName: d.appName || DEFAULT_SETTINGS.appName,
        tagline: d.tagline || DEFAULT_SETTINGS.tagline,
        whatsappNumber: typeof d.whatsappNumber === 'string' ? d.whatsappNumber : '',
        pixKey: typeof d.pixKey === 'string' ? d.pixKey : DEFAULT_SETTINGS.pixKey,
        pixType: (d.pixType as PixType) || DEFAULT_SETTINGS.pixType,
        pixReceiverName: d.pixReceiverName || DEFAULT_SETTINGS.pixReceiverName,
        pixQrCodeDataUrl: sanitizePixQrCodeUrl(d.pixQrCodeDataUrl),
        tvOnlyAntiRetransmission:
          typeof d.tvOnlyAntiRetransmission === 'boolean' ? d.tvOnlyAntiRetransmission : true,
      });
    },
    (error) => {
      console.warn('Firestore settings snapshot fallback:', error.message);
      onChange(DEFAULT_SETTINGS);
    }
  );
}

export function subscribePlans(
  includeInactive: boolean,
  onChange: (plans: PlanItem[]) => void
): () => void {
  const baseCol = collection(db, 'plans');
  const q = includeInactive ? query(baseCol) : query(baseCol, where('active', '==', true));

  return onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        onChange(DEFAULT_PLANS);
        return;
      }
      const items: PlanItem[] = snap.docs.map((docSnap) => {
        const d = docSnap.data() as Partial<PlanItem>;
        return {
          id: docSnap.id,
          name: d.name || 'Plano',
          subtitle: d.subtitle || '',
          priceText: d.priceText || 'Sob consulta',
          days: typeof d.days === 'number' ? d.days : 30,
          periodLabel: d.periodLabel || '· via WhatsApp',
          features: Array.isArray(d.features) ? d.features.map(String) : [],
          featured: Boolean(d.featured),
          active: d.active !== false,
          sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : 99,
        };
      });
      items.sort((a, b) => a.sortOrder - b.sortOrder);
      onChange(items);
    },
    (error) => {
      console.warn('Firestore plans snapshot fallback:', error.message);
      onChange(DEFAULT_PLANS);
    }
  );
}

export async function seedDefaultCatalogIfEmpty(adminToken?: string): Promise<void> {
  const existingPlans = await getDocs(collection(db, 'plans'));
  if (existingPlans.empty) {
    for (const plan of DEFAULT_PLANS) {
      await upsertPlan(plan);
    }
  }
  const settingsSnap = await getDoc(doc(db, 'settings', 'public'));
  if (!settingsSnap.exists()) {
    await savePublicSettings(DEFAULT_SETTINGS, adminToken, true);
  }
}

export async function savePublicSettings(
  input: AppSettingsDoc,
  adminToken?: string,
  onlyIfMissing = false
): Promise<void> {
  const path = 'settings/public';
  const payload = {
    appName: clampStr(input.appName || 'Jogos do Mengão', 60),
    tagline: clampStr(input.tagline || DEFAULT_SETTINGS.tagline, 160),
    whatsappNumber: clampStr(input.whatsappNumber.replace(/\D/g, ''), 30),
    pixKey: clampStr(input.pixKey || '', 140),
    pixType: (['CPF', 'CNPJ', 'E-mail', 'Telefone', 'Aleatória'].includes(input.pixType)
      ? input.pixType
      : 'Aleatória') as PixType,
    pixReceiverName: clampStr(input.pixReceiverName || '', 80),
    pixQrCodeDataUrl: sanitizePixQrCodeUrl(input.pixQrCodeDataUrl),
    tvOnlyAntiRetransmission: Boolean(input.tvOnlyAntiRetransmission),
    updatedAt: serverTimestamp(),
  };

  if (adminToken && !onlyIfMissing) {
    await fetch('/api/admin/config-public', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        whatsappNumber: payload.whatsappNumber,
        pixKey: payload.pixKey,
        pixType: payload.pixType,
        pixReceiverName: payload.pixReceiverName,
        pixQrCodeDataUrl: payload.pixQrCodeDataUrl,
        tvOnlyAntiRetransmission: payload.tvOnlyAntiRetransmission,
      }),
    }).catch(() => undefined);
  }

  try {
    if (onlyIfMissing) {
      await setDoc(doc(db, 'settings', 'public'), payload, { merge: false });
    } else {
      await setDoc(doc(db, 'settings', 'public'), payload);
    }
  } catch (error) {
    if (onlyIfMissing) return;
    // Se as regras remotas no console Firebase ainda não tiverem sido publicadas com pixQrCodeDataUrl,
    // salva os demais campos no Firestore e mantém o QR Code sincronizado pelo servidor Express.
    const errMsg = error instanceof Error ? error.message.toLowerCase() : '';
    if (errMsg.includes('permission') || errMsg.includes('insufficient')) {
      try {
        const legacyPayload = {
          appName: payload.appName,
          tagline: payload.tagline,
          whatsappNumber: payload.whatsappNumber,
          pixKey: payload.pixKey,
          pixType: payload.pixType,
          pixReceiverName: payload.pixReceiverName,
          tvOnlyAntiRetransmission: payload.tvOnlyAntiRetransmission,
          updatedAt: serverTimestamp(),
        };
        await setDoc(doc(db, 'settings', 'public'), legacyPayload);
        return;
      } catch {
        // segue para tratamento padrão abaixo
      }
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function upsertPlan(plan: PlanItem): Promise<void> {
  const safeId =
    plan.id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 64) || `plan-${Date.now()}`;

  const features = plan.features
    .map((f) => clampStr(f, 160))
    .filter(Boolean)
    .slice(0, 8);

  const payload = {
    name: clampStr(plan.name || 'Novo Plano', 60),
    subtitle: clampStr(plan.subtitle || '', 140),
    priceText: clampStr(plan.priceText || 'Sob consulta', 40),
    days: clampInt(plan.days, 0, 3650),
    periodLabel: clampStr(plan.periodLabel || '· Pix ou WhatsApp', 40),
    features,
    featured: Boolean(plan.featured),
    active: Boolean(plan.active),
    sortOrder: clampInt(plan.sortOrder, 0, 999),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'plans', safeId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `plans/${safeId}`);
  }
}

export async function deletePlanById(planId: string): Promise<void> {
  const safeId = planId.replace(/[^a-zA-Z0-9_-]/g, '');
  try {
    await deleteDoc(doc(db, 'plans', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `plans/${safeId}`);
  }
}

export async function logOfflineLicenseToFirestore(entry: {
  id: string;
  deviceCode: string;
  plano: string;
  dias: number;
  expira_em: string;
  activationKey: string;
}): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const safeId = entry.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `lic-${Date.now()}`;
  try {
    await setDoc(doc(db, 'offline_licenses', safeId), {
      deviceCode: clampStr(entry.deviceCode.toUpperCase(), 20),
      plano: clampStr(entry.plano, 60),
      dias: clampInt(entry.dias, 1, 3650),
      expira_em: clampStr(entry.expira_em, 40),
      activationKey: clampStr(entry.activationKey, 256),
      createdByUid: uid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `offline_licenses/${safeId}`);
  }
}
