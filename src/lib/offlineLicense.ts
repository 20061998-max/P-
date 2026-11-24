export interface OfflineLicenseState {
  deviceCode: string;
  ativo: boolean;
  plano: string | null;
  expira_em: string | null;
  dias_restantes: number;
  activationKey: string | null;
  motivo?: string;
}

export interface CustomerPreRegistration {
  customerName: string;
  customerWhatsapp: string;
}

export interface OfflinePlanOption {
  id: string;
  label: string;
  dias: number;
  priceText?: string;
}

export const OFFLINE_PLANS: OfflinePlanOption[] = [
  { id: '1 Mês', label: '1 Mês (30 dias)', dias: 30, priceText: 'R$ 29,90' },
  { id: '3 Meses', label: '3 Meses (90 dias)', dias: 90, priceText: 'R$ 79,90' },
  { id: '6 Meses', label: '6 Meses (180 dias)', dias: 180, priceText: 'R$ 139,90' },
  { id: '1 Ano', label: '1 Ano (365 dias)', dias: 365, priceText: 'R$ 249,90' },
  { id: 'Outros', label: 'Outros (escolher validade)', dias: 0, priceText: 'Sob consulta' },
];

const DB_NAME = 'mengao_offline_license_db';
const STORE_NAME = 'kv';
const CODE_TO_PLAN: Record<number, string> = {
  1: '1 Mês',
  2: '3 Meses',
  3: '6 Meses',
  4: '1 Ano',
  5: 'Mensal Básico',
  6: 'Mensal Pro',
  7: 'Mensal Estúdio',
  8: 'Outros',
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function base64UrlToBytes(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function normalizeDeviceCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

export async function getOrCreateDeviceCode(): Promise<string> {
  const saved = await idbGet<string>('deviceCode');
  if (saved && /^TC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(saved)) {
    return saved;
  }
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  const code = `TC-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
  await idbSet('deviceCode', code);
  return code;
}

export async function syncPublicKeyWhenOnline(): Promise<JsonWebKey | null> {
  try {
    const res = await fetch('/api/licenca/chave-publica');
    if (res.ok) {
      const data = (await res.json()) as {
        publicKeyJwk?: JsonWebKey;
        whatsappNumber?: string;
      };
      if (typeof data.whatsappNumber === 'string') {
        await idbSet('adminWhatsapp', data.whatsappNumber);
      }
      if (data.publicKeyJwk) {
        await idbSet('publicKeyJwk', data.publicKeyJwk);
        return data.publicKeyJwk;
      }
    }
  } catch {
    // Offline: utiliza chave pública já armazenada no IndexedDB
  }
  return idbGet<JsonWebKey>('publicKeyJwk');
}

export async function getSavedWhatsappNumber(): Promise<string> {
  try {
    const res = await fetch('/api/config/whatsapp');
    if (res.ok) {
      const data = (await res.json()) as { whatsappNumber?: string };
      if (typeof data.whatsappNumber === 'string') {
        await idbSet('adminWhatsapp', data.whatsappNumber);
        return data.whatsappNumber;
      }
    }
  } catch {
    // Offline: usa cache
  }
  return (await idbGet<string>('adminWhatsapp')) ?? '';
}

export async function reportDeviceHeartbeat(payload: {
  deviceCode: string;
  platform: string;
  isTv: boolean;
  licenseActive: boolean;
  planName: string | null;
  isStreaming?: boolean;
}): Promise<void> {
  try {
    await fetch('/api/app/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Offline: ignora silenciosamente
  }
}

export async function getSavedCustomerPreRegistration(): Promise<CustomerPreRegistration> {
  const saved = await idbGet<CustomerPreRegistration>('customerPreReg');
  return {
    customerName: saved?.customerName || '',
    customerWhatsapp: saved?.customerWhatsapp || '',
  };
}

export async function saveCustomerPreRegistration(
  profile: CustomerPreRegistration
): Promise<CustomerPreRegistration> {
  const clean: CustomerPreRegistration = {
    customerName: profile.customerName.trim().slice(0, 80),
    customerWhatsapp: profile.customerWhatsapp.replace(/\D/g, '').slice(0, 16),
  };
  await idbSet('customerPreReg', clean);
  return clean;
}

export function formatWhatsappNumberForWaMe(rawPhone: string): string {
  const digits = (rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  // Se vier DDD+Número brasileiro sem DDI 55 (10 ou 11 dígitos), prefixa 55 automaticamente
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    return `55${digits}`;
  }
  return digits;
}

export function buildCustomerPaymentWhatsappHref(params: {
  customerName: string;
  customerWhatsapp: string;
  deviceCode: string;
  adminWhatsapp?: string;
  expired?: boolean;
  selectedPlan?: string;
  customValidity?: string;
  priceText?: string;
}): string {
  const digits = formatWhatsappNumberForWaMe(params.adminWhatsapp || '');
  const selectedPlan = params.selectedPlan || '1 Mês';
  const planObj = OFFLINE_PLANS.find((p) => p.id === selectedPlan);
  const priceSuffix = params.priceText ? ` (${params.priceText})` : '';
  const planText =
    selectedPlan === 'Outros'
      ? `Outros (Validade desejada: ${params.customValidity?.trim() || 'a combinar'})`
      : planObj
        ? `${planObj.label}${priceSuffix}`
        : `${selectedPlan}${priceSuffix}`;

  const lines = [
    params.expired
      ? 'Olá! Já efetuei o pagamento Pix para RENOVAR minha assinatura do app Jogos do Mengão.'
      : 'Olá! Já efetuei o pagamento Pix para LIBERAR meu acesso no app Jogos do Mengão.',
    '',
    `Nome: ${params.customerName.trim()}`,
    `WhatsApp do cliente: ${params.customerWhatsapp.trim()}`,
    `Plano pago: ${planText}`,
    `Código do aparelho: ${params.deviceCode}`,
    '',
    'Aguardo minha chave de liberação!',
  ];
  const encoded = encodeURIComponent(lines.join('\n'));
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function buildAdminSendKeyToCustomerHref(params: {
  customerName: string;
  customerWhatsapp: string;
  appName: string;
  planName: string;
  deviceCode: string;
  expiresDateLabel: string;
  activationKey: string;
}): string {
  const digits = formatWhatsappNumberForWaMe(params.customerWhatsapp);
  const text = [
    `Olá, ${params.customerName.trim() || 'cliente'}!`,
    `Pagamento confirmado! Sua assinatura ${params.appName} (${params.planName}) foi liberada até ${params.expiresDateLabel} para o aparelho ${params.deviceCode}.`,
    '',
    'Cole esta chave de liberação no aplicativo:',
    params.activationKey,
  ].join('\n');
  const encoded = encodeURIComponent(text);
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function buildWhatsappSendCodeHref(
  deviceCode: string,
  adminWhatsapp?: string,
  expired?: boolean,
  selectedPlan = '1 Mês',
  customValidity = '',
  priceText?: string
): string {
  const digits = formatWhatsappNumberForWaMe(adminWhatsapp || '');
  const planObj = OFFLINE_PLANS.find((p) => p.id === selectedPlan);
  const priceSuffix = priceText ? ` (${priceText})` : '';
  const planText =
    selectedPlan === 'Outros'
      ? `Outros (Validade desejada: ${customValidity.trim() || 'a combinar'})`
      : planObj
        ? `${planObj.label}${priceSuffix}`
        : `${selectedPlan}${priceSuffix}`;
  const text = expired
    ? `Olá! Quero RENOVAR minha assinatura do app Jogos do Mengão.\nPlano escolhido: ${planText}\nCódigo do aparelho: ${deviceCode}\nAguardo os dados/valor para pagamento via Pix ou WhatsApp.`
    : `Olá! Instalei o app Jogos do Mengão e quero liberar meu acesso.\nPlano escolhido: ${planText}\nCódigo do aparelho: ${deviceCode}\nAguardo a chave de liberação após o pagamento via Pix/WhatsApp.`;
  const encoded = encodeURIComponent(text);
  return digits ? `https://wa.me/${digits}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export async function verifyAndSaveOfflineKey(
  activationKey: string
): Promise<OfflineLicenseState> {
  const deviceCode = await getOrCreateDeviceCode();
  const jwk = await syncPublicKeyWhenOnline();
  if (!jwk) {
    return {
      deviceCode,
      ativo: false,
      plano: null,
      expira_em: null,
      dias_restantes: 0,
      activationKey: null,
      motivo: 'Chave pública ainda não sincronizada neste aparelho.',
    };
  }

  const verification = await verifyOfflineKeyWithJwk(deviceCode, activationKey, jwk);
  if (verification.ativo) {
    await idbSet('activationKey', activationKey.trim());
  }
  return verification;
}

export async function getSavedOfflineLicenseState(): Promise<OfflineLicenseState> {
  const deviceCode = await getOrCreateDeviceCode();
  const savedKey = await idbGet<string>('activationKey');
  const jwk = await syncPublicKeyWhenOnline();

  if (!savedKey) {
    return {
      deviceCode,
      ativo: false,
      plano: null,
      expira_em: null,
      dias_restantes: 0,
      activationKey: null,
      motivo: 'Nenhuma chave de liberação ativada neste aparelho.',
    };
  }

  if (!jwk) {
    return {
      deviceCode,
      ativo: false,
      plano: null,
      expira_em: null,
      dias_restantes: 0,
      activationKey: savedKey,
      motivo: 'Chave pública indisponível para validação offline.',
    };
  }

  return verifyOfflineKeyWithJwk(deviceCode, savedKey, jwk);
}

export async function clearSavedOfflineLicense(): Promise<void> {
  await idbSet('activationKey', '');
}

async function verifyOfflineKeyWithJwk(
  deviceCode: string,
  rawKey: string,
  jwk: JsonWebKey
): Promise<OfflineLicenseState> {
  const cleanKey = rawKey.trim();
  const parts = cleanKey.split('.');
  if (parts.length !== 3 || parts[0] !== 'TC1') {
    return {
      deviceCode,
      ativo: false,
      plano: null,
      expira_em: null,
      dias_restantes: 0,
      activationKey: null,
      motivo: 'Formato de chave inválido.',
    };
  }

  try {
    const payload = base64UrlToBytes(parts[1]);
    const signature = base64UrlToBytes(parts[2]);
    if (payload.length !== 14 || signature.length !== 64) {
      throw new Error('Tamanho inválido');
    }

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    const sigBuffer = new Uint8Array(signature).buffer;
    const payloadBuffer = new Uint8Array(payload).buffer;

    const validSig = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      sigBuffer,
      payloadBuffer
    );

    if (!validSig) {
      return {
        deviceCode,
        ativo: false,
        plano: null,
        expira_em: null,
        dias_restantes: 0,
        activationKey: null,
        motivo: 'Assinatura da chave inválida.',
      };
    }

    const normalized = normalizeDeviceCode(deviceCode);
    const codeBytes = new TextEncoder().encode(normalized);
    const digestBuf = await crypto.subtle.digest('SHA-256', codeBytes);
    const digest = new Uint8Array(digestBuf);
    for (let i = 0; i < 4; i += 1) {
      if (payload[i] !== digest[i]) {
        return {
          deviceCode,
          ativo: false,
          plano: null,
          expira_em: null,
          dias_restantes: 0,
          activationKey: null,
          motivo: 'Esta chave pertence a outro aparelho.',
        };
      }
    }

    const view = new DataView(payloadBuffer);
    const expSec = view.getUint32(4, false);
    const planCode = view.getUint8(8);
    const plano = CODE_TO_PLAN[planCode] ?? 'Outros';
    const expMs = expSec * 1000;
    const nowMs = Date.now();

    if (expMs <= nowMs) {
      return {
        deviceCode,
        ativo: false,
        plano,
        expira_em: new Date(expMs).toISOString(),
        dias_restantes: 0,
        activationKey: cleanKey,
        motivo: 'Assinatura offline vencida. Gere uma nova chave para este aparelho.',
      };
    }

    const diasRestantes = Math.max(1, Math.ceil((expMs - nowMs) / (1000 * 60 * 60 * 24)));
    return {
      deviceCode,
      ativo: true,
      plano,
      expira_em: new Date(expMs).toISOString(),
      dias_restantes: diasRestantes,
      activationKey: cleanKey,
    };
  } catch {
    return {
      deviceCode,
      ativo: false,
      plano: null,
      expira_em: null,
      dias_restantes: 0,
      activationKey: null,
      motivo: 'Não foi possível validar a chave offline.',
    };
  }
}
