import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const AUTHORIZED_ADMIN_EMAIL = 'josuelroque05052020@gmail.com';
const CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface CachedCerts {
  certs: Record<string, string>;
  expiresAt: number;
}

let certCache: CachedCerts | null = null;

function getFirebaseProjectId(): string {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as { projectId?: string };
      if (parsed.projectId) return parsed.projectId;
    }
  } catch {
    // fallback
  }
  return process.env.FIREBASE_PROJECT_ID || '';
}

async function fetchGoogleCerts(): Promise<Record<string, string>> {
  if (certCache && Date.now() < certCache.expiresAt) {
    return certCache.certs;
  }
  const res = await fetch(CERT_URL);
  if (!res.ok) {
    throw new Error('Não foi possível obter certificados públicos do Google Firebase.');
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  const certs = (await res.json()) as Record<string, string>;
  certCache = {
    certs,
    expiresAt: Date.now() + Math.max(60, maxAgeSec) * 1000,
  };
  return certs;
}

export interface VerifiedGoogleAdmin {
  uid: string;
  email: string;
  name: string;
}

export async function verifyFirebaseAdminToken(
  idToken: string
): Promise<VerifiedGoogleAdmin | null> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;

  const projectId = getFirebaseProjectId();
  if (!projectId) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8')) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== 'RS256' || !header.kid) return null;

    const certs = await fetchGoogleCerts();
    const pem = certs[header.kid];
    if (!pem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const signature = Buffer.from(parts[2], 'base64url');
    const valid = verifier.verify(pem, signature);
    if (!valid) return null;

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };

    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.sub || !payload.exp || payload.exp <= nowSec) return null;
    if (payload.aud !== projectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (payload.email_verified !== true) return null;
    if (!payload.email || payload.email.trim().toLowerCase() !== AUTHORIZED_ADMIN_EMAIL) {
      return null;
    }

    return {
      uid: payload.sub,
      email: payload.email.trim().toLowerCase(),
      name: payload.name || 'Administrador Mengão',
    };
  } catch {
    return null;
  }
}
