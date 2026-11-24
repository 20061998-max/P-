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

const KEYPAIR_FILE = path.resolve(process.cwd(), '.telacast-keypair.json');

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

function getOrCreateKeypair(): StoredKeypair {
  const envPriv = process.env.LICENSE_PRIVATE_KEY_PEM?.trim();
  const envPub = process.env.LICENSE_PUBLIC_KEY_PEM?.trim();
  if (envPriv && envPub) {
    const pubKeyObj = crypto.createPublicKey(envPub);
    const spkiDer = pubKeyObj.export({ type: 'spki', format: 'der' }) as Buffer;
    return {
      privateKeyPem: envPriv,
      publicKeyPem: envPub,
      publicKeyJwk: pubKeyObj.export({ format: 'jwk' }) as JsonWebKey,
      publicKeySpkiBase64: spkiDer.toString('base64'),
    };
  }

  if (fs.existsSync(KEYPAIR_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(KEYPAIR_FILE, 'utf-8')) as StoredKeypair;
    } catch {
      // Regenera se corrompido
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

  try {
    fs.writeFileSync(KEYPAIR_FILE, JSON.stringify(generated, null, 2), 'utf-8');
  } catch {
    // Em ambientes serverless read-only, configure LICENSE_PRIVATE_KEY_PEM e LICENSE_PUBLIC_KEY_PEM
  }
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

  return {
    id: `lic-${crypto.randomUUID().slice(0, 8)}`,
    deviceCode: normalizedCode,
    plano: input.plano,
    dias: days,
    expira_em: new Date(expSec * 1000).toISOString(),
    activationKey: `TC1.${payload.toString('base64url')}.${signature.toString('base64url')}`,
    criado_em: new Date().toISOString(),
  };
}
