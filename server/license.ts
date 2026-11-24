import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface OfflineLicenseRecord {
  id: string;
  deviceCode: string;
  plano: string;
  dias: number;
  expira_em: string;
  activationKey: string;
  criado_em: string;
}

interface StoredKeypair {
  privateKeyPem: string;
  publicKeyPem: string;
  publicKeyJwk: JsonWebKey;
  publicKeySpkiBase64: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const KEYPAIR_FILE = path.join(DATA_DIR, 'license-keypair.json');
const OFFLINE_LOG_FILE = path.join(DATA_DIR, 'offline-licenses.json');

const PLAN_TO_CODE: Record<string, number> = {
  '1 Mês': 1,
  '3 Meses': 2,
  '6 Meses': 3,
  '1 Ano': 4,
  'Mensal Básico': 5,
  'Mensal Pro': 6,
  'Mensal Estúdio': 7,
  Outros: 8,
};

function normalizePemEnv(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

function getOrCreateKeypair(): StoredKeypair {
  const envPriv = normalizePemEnv(process.env.LICENSE_PRIVATE_KEY_PEM);
  const envPub = normalizePemEnv(process.env.LICENSE_PUBLIC_KEY_PEM);
  if (envPriv && envPub) {
    try {
      const pubKeyObj = crypto.createPublicKey(envPub);
      crypto.createPrivateKey(envPriv);
      const spkiDer = pubKeyObj.export({ type: 'spki', format: 'der' }) as Buffer;
      return {
        privateKeyPem: envPriv,
        publicKeyPem: envPub,
        publicKeyJwk: pubKeyObj.export({ format: 'jwk' }) as JsonWebKey,
        publicKeySpkiBase64: spkiDer.toString('base64'),
      };
    } catch (err) {
      console.error('Chaves PEM inválidas nas variáveis de ambiente:', err);
    }
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(KEYPAIR_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(KEYPAIR_FILE, 'utf-8')) as StoredKeypair;
    } catch {
      // Recria caso o arquivo esteja corrompido
    }
  }

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });

  const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const generated: StoredKeypair = {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    publicKeyJwk: publicKey.export({ format: 'jwk' }) as JsonWebKey,
    publicKeySpkiBase64: spkiDer.toString('base64'),
  };

  fs.writeFileSync(KEYPAIR_FILE, JSON.stringify(generated, null, 2), 'utf-8');
  return generated;
}

export function getPublicLicenseKey() {
  const kp = getOrCreateKeypair();
  return {
    publicKeyJwk: kp.publicKeyJwk,
    publicKeySpkiBase64: kp.publicKeySpkiBase64,
  };
}

export function normalizeDeviceCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

export function generateOfflineActivationKey(input: {
  deviceCode: string;
  dias?: number;
  validade_ate?: string;
  plano: string;
}): OfflineLicenseRecord {
  const normalizedCode = normalizeDeviceCode(input.deviceCode);
  if (!/^TC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizedCode)) {
    throw new Error('Código do aparelho inválido. Use o formato TC-XXXX-XXXX.');
  }

  const planCode = PLAN_TO_CODE[input.plano] ?? 2;
  const nowSec = Math.floor(Date.now() / 1000);
  let days = Math.max(1, Math.min(3650, Math.floor(input.dias || 30)));
  let expSec = nowSec + days * 24 * 60 * 60;

  if (input.validade_ate && /^\d{4}-\d{2}-\d{2}$/.test(input.validade_ate.trim())) {
    const endOfDayMs = new Date(`${input.validade_ate.trim()}T23:59:59`).getTime();
    if (Number.isNaN(endOfDayMs) || endOfDayMs <= Date.now()) {
      throw new Error('A data de validade precisa ser futura.');
    }
    expSec = Math.floor(endOfDayMs / 1000);
    days = Math.max(1, Math.ceil((endOfDayMs - Date.now()) / (1000 * 60 * 60 * 24)));
  }

  // Payload binário compacto (14 bytes):
  // [0..3] deviceHash (4 bytes SHA-256 do deviceCode)
  // [4..7] expSec (uint32 big-endian)
  // [8]    planCode (1..3)
  // [9..10] days (uint16 big-endian)
  // [11..13] nonce aleatório (3 bytes)
  const payload = Buffer.alloc(14);
  const deviceDigest = crypto.createHash('sha256').update(normalizedCode).digest();
  deviceDigest.copy(payload, 0, 0, 4);
  payload.writeUInt32BE(expSec, 4);
  payload.writeUInt8(planCode, 8);
  payload.writeUInt16BE(Math.min(65535, days), 9);
  crypto.randomBytes(3).copy(payload, 11);

  const kp = getOrCreateKeypair();
  const signature = crypto.sign('sha256', payload, {
    key: kp.privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });

  const activationKey = `TC1.${payload.toString('base64url')}.${signature.toString('base64url')}`;

  const record: OfflineLicenseRecord = {
    id: `lic-${crypto.randomUUID().slice(0, 8)}`,
    deviceCode: normalizedCode,
    plano: input.plano,
    dias: days,
    expira_em: new Date(expSec * 1000).toISOString(),
    activationKey,
    criado_em: new Date().toISOString(),
  };

  saveOfflineLicenseRecord(record);
  return record;
}

function saveOfflineLicenseRecord(record: OfflineLicenseRecord) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const list = listOfflineLicenses();
  list.unshift(record);
  fs.writeFileSync(OFFLINE_LOG_FILE, JSON.stringify(list.slice(0, 50), null, 2), 'utf-8');
}

export function listOfflineLicenses(): OfflineLicenseRecord[] {
  if (!fs.existsSync(OFFLINE_LOG_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(OFFLINE_LOG_FILE, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as OfflineLicenseRecord[]) : [];
  } catch {
    return [];
  }
}

const CODE_TO_PLAN_SERVER: Record<number, string> = {
  1: '1 Mês',
  2: '3 Meses',
  3: '6 Meses',
  4: '1 Ano',
  5: 'Mensal Básico',
  6: 'Mensal Pro',
  7: 'Mensal Estúdio',
  8: 'Outros',
};

export function verifyOfflineActivationKey(
  deviceCode: string,
  rawKey: string
): { ativo: boolean; plano: string | null; expira_em: string | null; motivo?: string } {
  const normalizedCode = normalizeDeviceCode(deviceCode);
  if (!/^TC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizedCode)) {
    return { ativo: false, plano: null, expira_em: null, motivo: 'Código do aparelho inválido.' };
  }

  const parts = rawKey.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'TC1') {
    return { ativo: false, plano: null, expira_em: null, motivo: 'Formato de chave inválido.' };
  }

  try {
    const payload = Buffer.from(parts[1], 'base64url');
    const signature = Buffer.from(parts[2], 'base64url');
    if (payload.length !== 14 || signature.length !== 64) {
      return { ativo: false, plano: null, expira_em: null, motivo: 'Tamanho da chave inválido.' };
    }

    const kp = getOrCreateKeypair();
    const ok = crypto.verify(
      'sha256',
      payload,
      { key: kp.publicKeyPem, dsaEncoding: 'ieee-p1363' },
      signature
    );
    if (!ok) {
      return { ativo: false, plano: null, expira_em: null, motivo: 'Assinatura da chave inválida.' };
    }

    const deviceDigest = crypto.createHash('sha256').update(normalizedCode).digest();
    if (!deviceDigest.subarray(0, 4).equals(payload.subarray(0, 4))) {
      return {
        ativo: false,
        plano: null,
        expira_em: null,
        motivo: 'Esta chave pertence a outro aparelho.',
      };
    }

    const expSec = payload.readUInt32BE(4);
    const planCode = payload.readUInt8(8);
    const plano = CODE_TO_PLAN_SERVER[planCode] ?? 'Outros';
    const expMs = expSec * 1000;
    const expIso = new Date(expMs).toISOString();
    if (expMs <= Date.now()) {
      return {
        ativo: false,
        plano,
        expira_em: expIso,
        motivo: 'Assinatura vencida. Renove com o administrador.',
      };
    }

    return { ativo: true, plano, expira_em: expIso };
  } catch {
    return { ativo: false, plano: null, expira_em: null, motivo: 'Falha ao validar chave.' };
  }
}
