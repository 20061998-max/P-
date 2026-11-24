import { NextFunction, Request, Response } from 'express';

export type SecurityEventKind =
  | 'rate_limit'
  | 'brute_force_block'
  | 'scanner_probe'
  | 'payload_sanitized'
  | 'ws_flood';

export interface SecurityEventEntry {
  id: string;
  kind: SecurityEventKind;
  ip: string;
  path: string;
  detail: string;
  timestamp: string;
}

const MAX_EVENTS = 50;
const recentEvents: SecurityEventEntry[] = [];
const counters = {
  rateLimitBlocks: 0,
  bruteForceBlocks: 0,
  scannerBlocks: 0,
  sanitizedPayloads: 0,
  wsFloodBlocks: 0,
};

function maskIp(rawIp: string): string {
  const clean = rawIp.replace(/^::ffff:/, '').trim() || 'unknown';
  const ipv4Parts = clean.split('.');
  if (ipv4Parts.length === 4) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.*.*`;
  }
  return clean.slice(0, 12);
}

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function recordSecurityEvent(
  kind: SecurityEventKind,
  rawIp: string,
  reqPath: string,
  detail: string
): void {
  if (kind === 'rate_limit') counters.rateLimitBlocks += 1;
  else if (kind === 'brute_force_block') counters.bruteForceBlocks += 1;
  else if (kind === 'scanner_probe') counters.scannerBlocks += 1;
  else if (kind === 'payload_sanitized') counters.sanitizedPayloads += 1;
  else if (kind === 'ws_flood') counters.wsFloodBlocks += 1;

  recentEvents.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    ip: maskIp(rawIp),
    path: reqPath.slice(0, 80),
    detail: detail.slice(0, 140),
    timestamp: new Date().toISOString(),
  });

  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.length = MAX_EVENTS;
  }
}

export function getSecurityStats() {
  return {
    protections: [
      {
        id: 'owasp-headers',
        name: 'Cabeçalhos OWASP + Content Security Policy (CSP)',
        description:
          'Bloqueia XSS, MIME-sniffing, vazamento de referrer e origens não autorizadas.',
        active: true,
      },
      {
        id: 'brute-force-shield',
        name: 'Bloqueio Anti-Força Bruta & Rate Limiting Deslizante',
        description:
          'Limita requisições por IP e bloqueia progressivamente tentativas repetidas de senha.',
        active: true,
      },
      {
        id: 'exploit-shield',
        name: 'Escudo Anti-Injeção, Path Traversal & Scanners',
        description:
          'Neutraliza Prototype Pollution (__proto__), operadores $ NoSQL e sondas a arquivos sensíveis.',
        active: true,
      },
      {
        id: 'crypto-offline-ecdsa',
        name: 'Criptografia ECDSA P-256 + Anti-Retransmissão Smart TV',
        description:
          'Chaves assinadas por hardware/código único e bloqueio de retransmissão fora de Smart TVs.',
        active: true,
      },
      {
        id: 'ws-flood-guard',
        name: 'Proteção WebSocket Anti-Flood & Payload Limitado',
        description:
          'Limita conexões simultâneas por IP no canal ao vivo e valida tokens no servidor.',
        active: true,
      },
    ],
    counters: { ...counters },
    totalBlocked:
      counters.rateLimitBlocks +
      counters.bruteForceBlocks +
      counters.scannerBlocks +
      counters.wsFloodBlocks,
    recentEvents: [...recentEvents],
  };
}

/**
 * Cabeçalhos OWASP modernos (compatíveis com iframe do preview AI Studio e popup Google Auth).
 */
export function securityHeadersMiddleware(isProduction: boolean) {
  const cspDirectives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self' https://apis.google.com https://accounts.google.com https://www.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "connect-src 'self' ws: wss: https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://www.googleapis.com https://accounts.google.com",
    "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com",
    "worker-src 'self' blob:",
  ].join('; ');

  return (req: Request, res: Response, next: NextFunction) => {
    res.removeHeader('X-Powered-By');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    // Mantém display-capture, microphone, fullscreen e autoplay liberados para transmissão no celular e TV
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), display-capture=(self), fullscreen=(self), autoplay=(self)'
    );

    const proto = req.headers['x-forwarded-proto'];
    if (isProduction && (req.secure || proto === 'https')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    if (isProduction) {
      res.setHeader('Content-Security-Policy', cspDirectives);
    }

    next();
  };
}

const SCANNER_PATH_PATTERNS = [
  /\/\.(env|git|svn|hg|htaccess|htpasswd|ds_store)/i,
  /\/(wp-admin|wp-login\.php|xmlrpc\.php|phpmyadmin|pma|adminer|cgi-bin)/i,
  /\.\.[/\\]/,
  /%2e%2e/i,
  /\.(bak|sql|sqlite|db|log|ini|conf)$/i,
];

function sanitizeObjectRecursive(value: unknown, depth = 0): { sanitized: unknown; modified: boolean } {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return { sanitized: value, modified: false };
  }

  if (Array.isArray(value)) {
    let modified = false;
    const out = value.map((item) => {
      const res = sanitizeObjectRecursive(item, depth + 1);
      if (res.modified) modified = true;
      return res.sanitized;
    });
    return { sanitized: out, modified };
  }

  const record = value as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  let modified = false;

  for (const [key, val] of Object.entries(record)) {
    if (
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      key.startsWith('$')
    ) {
      modified = true;
      continue;
    }
    const res = sanitizeObjectRecursive(val, depth + 1);
    if (res.modified) modified = true;
    clean[key] = res.sanitized;
  }

  return { sanitized: clean, modified };
}

export function exploitShieldMiddleware(req: Request, res: Response, next: NextFunction) {
  const rawUrl = req.originalUrl || req.url || '/';
  const clientIp = getClientIp(req);

  if (SCANNER_PATH_PATTERNS.some((re) => re.test(rawUrl))) {
    recordSecurityEvent('scanner_probe', clientIp, req.path, `Sonda bloqueada: ${req.path}`);
    res.status(403).json({ erro: 'Acesso negado pela proteção anti-invasão.' });
    return;
  }

  if (req.body && typeof req.body === 'object') {
    const resBody = sanitizeObjectRecursive(req.body);
    if (resBody.modified) {
      req.body = resBody.sanitized;
      recordSecurityEvent('payload_sanitized', clientIp, req.path, 'Chave maliciosa removida do JSON');
    }
  }

  if (req.query && typeof req.query === 'object') {
    const resQuery = sanitizeObjectRecursive(req.query);
    if (resQuery.modified) {
      req.query = resQuery.sanitized as Request['query'];
      recordSecurityEvent('payload_sanitized', clientIp, req.path, 'Parâmetro malicioso removido da URL');
    }
  }

  next();
}

interface RateBucket {
  timestamps: number[];
  blockedUntil: number;
  failures: number;
}

export function createRateLimiter(options: {
  name: string;
  windowMs: number;
  maxRequests: number;
  blockDurationMs: number;
  skipSuccessfulLogins?: boolean;
}) {
  const buckets = new Map<string, RateBucket>();

  // Limpeza periódica para evitar crescimento de memória
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets.entries()) {
      b.timestamps = b.timestamps.filter((t) => now - t < options.windowMs);
      if (b.timestamps.length === 0 && b.blockedUntil <= now) {
        buckets.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  cleanupTimer.unref();

  function middleware(req: Request, res: Response, next: NextFunction) {
    const ip = getClientIp(req);
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket) {
      bucket = { timestamps: [], blockedUntil: 0, failures: 0 };
      buckets.set(ip, bucket);
    }

    if (bucket.blockedUntil > now) {
      const retryAfter = Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      recordSecurityEvent(
        options.skipSuccessfulLogins ? 'brute_force_block' : 'rate_limit',
        ip,
        req.path,
        `Bloqueio temporário (${options.name}): aguarde ${retryAfter}s`
      );
      res.status(429).json({
        erro: `Muitas tentativas detectadas. Aguarde ${retryAfter} segundos para tentar novamente.`,
      });
      return;
    }

    bucket.timestamps = bucket.timestamps.filter((t) => now - t < options.windowMs);
    bucket.timestamps.push(now);

    if (bucket.timestamps.length > options.maxRequests) {
      bucket.failures += 1;
      const multiplier = Math.min(4, bucket.failures);
      bucket.blockedUntil = now + options.blockDurationMs * multiplier;
      const retryAfter = Math.ceil((bucket.blockedUntil - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      recordSecurityEvent(
        options.skipSuccessfulLogins ? 'brute_force_block' : 'rate_limit',
        ip,
        req.path,
        `Limite excedido em ${options.name} (${bucket.timestamps.length}/${options.maxRequests})`
      );
      res.status(429).json({
        erro: `Limite de requisições excedido (${options.name}). Bloqueado por ${retryAfter}s.`,
      });
      return;
    }

    next();
  }

  function recordSuccess(req: Request) {
    const ip = getClientIp(req);
    buckets.delete(ip);
  }

  return { middleware, recordSuccess };
}

const activeWsPerIp = new Map<string, number>();
const MAX_WS_PER_IP = 12;

export function canAcceptWsConnection(remoteIp: string | undefined, reqPath: string): boolean {
  const ip = (remoteIp || 'unknown').replace(/^::ffff:/, '');
  const current = activeWsPerIp.get(ip) || 0;
  if (current >= MAX_WS_PER_IP) {
    recordSecurityEvent(
      'ws_flood',
      ip,
      reqPath,
      `Excesso de conexões WebSocket simultâneas (${current}/${MAX_WS_PER_IP})`
    );
    return false;
  }
  activeWsPerIp.set(ip, current + 1);
  return true;
}

export function releaseWsConnection(remoteIp: string | undefined): void {
  const ip = (remoteIp || 'unknown').replace(/^::ffff:/, '');
  const current = activeWsPerIp.get(ip) || 0;
  if (current <= 1) {
    activeWsPerIp.delete(ip);
  } else {
    activeWsPerIp.set(ip, current - 1);
  }
}
