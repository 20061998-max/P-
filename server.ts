import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';
import { verifyFirebaseAdminToken } from './server/firebaseAuth.ts';
import { signJwt, verifyJwt } from './server/jwt.ts';
import {
  attachLiveRelay,
  broadcastAppUpdate,
  forceStopLiveBroadcast,
  getLiveBroadcastStatus,
} from './server/liveRelay.ts';
import {
  createRateLimiter,
  exploitShieldMiddleware,
  getClientIp,
  getSecurityStats,
  recordSecurityEvent,
  securityHeadersMiddleware,
} from './server/security.ts';
import {
  activateSubscriptionDays,
  autoPublishDistribution,
  claimAdminPasscode,
  clearAllDeveloperMessages,
  createDeveloperMessage,
  createPaymentRequest,
  createUserProfile,
  deleteCustomPlan,
  deleteDeveloperMessageById,
  deletePaymentRequestById,
  findPaymentRequestById,
  findProfileByEmail,
  findProfileById,
  getAdminWhatsapp,
  getConfigVersion,
  getCustomPlans,
  getDeviceStats,
  getPublicAppConfig,
  hasClaimedAdmin,
  hasClaimedAdminPasscode,
  listDeveloperMessages,
  listPaymentRequests,
  listProfiles,
  listRecentPayments,
  markPaymentRequestRenewed,
  purgeExpiredDeveloperMessages,
  recordPaymentLog,
  sanitizeProfile,
  ServerPlanRecord,
  setAdminWhatsapp,
  updateProfileById,
  updatePublicAppConfig,
  upsertCustomPlan,
  upsertDeviceHeartbeat,
  UserProfileRecord,
  verifyClaimedAdminPasscode,
  verifyPassword,
} from './server/store.ts';
import {
  generateOfflineActivationKey,
  getPublicLicenseKey,
  listOfflineLicenses,
} from './server/license.ts';

const PORT = Number(process.env.PORT) || 3000;

const APK_CANDIDATE_PATHS = [
  path.resolve(process.cwd(), 'public', 'downloads', 'JogosDoMengao.apk'),
  path.resolve(process.cwd(), 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
  path.resolve(process.cwd(), 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
];

function resolveCompiledApkPath(): string | null {
  for (const candidate of APK_CANDIDATE_PATHS) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

const PUBLIC_CORS_PATHS = new Set([
  '/api/licenca/chave-publica',
  '/api/app/heartbeat',
  '/api/app/version',
  '/api/config/public',
  '/api/config/whatsapp',
  '/api/live/status',
  '/api/apk-status',
  '/api/download-apk',
  '/api/download-webos',
]);

const SERVER_BOOT_TIMESTAMP = Date.now();
const SERVER_BOOT_ISO = new Date(SERVER_BOOT_TIMESTAMP).toISOString();

function resolveWebBuildId(): string {
  const candidates = [
    path.resolve(process.cwd(), 'dist', 'index.html'),
    path.resolve(process.cwd(), 'src', 'App.tsx'),
    path.resolve(process.cwd(), 'src', 'components', 'LiveBroadcastPanel.tsx'),
  ];
  let maxMtime = 0;
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const mtime = Math.floor(fs.statSync(filePath).mtimeMs);
        if (mtime > maxMtime) maxMtime = mtime;
      }
    } catch {
      // ignore
    }
  }
  return `v-${maxMtime || SERVER_BOOT_TIMESTAMP}`;
}

function timingSafeStrMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

interface AuthedRequest extends Request {
  authUser?: UserProfileRecord;
  googleAdmin?: { uid: string; email: string; name: string };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ erro: 'Token JWT ausente no cabeçalho Authorization.' });
    return;
  }
  const payload = verifyJwt(header.slice(7).trim());
  if (!payload) {
    res.status(401).json({ erro: 'Token inválido ou expirado.' });
    return;
  }
  if (payload.sub === 'admin-passcode' && payload.role === 'admin') {
    req.authUser = {
      id: 'admin-passcode',
      nome: 'Administrador · Jogos do Mengão',
      email: payload.email || 'josuelroque05052020@gmail.com',
      role: 'admin',
      status_assinatura: 'ativo',
      plano: 'Administrador',
      expira_em: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      criado_em: new Date().toISOString(),
    };
    next();
    return;
  }
  const profile = findProfileById(payload.sub);
  if (!profile) {
    res.status(404).json({ erro: 'Perfil de usuário não encontrado.' });
    return;
  }
  req.authUser = profile;
  next();
}

async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ erro: 'Token de administrador ausente.' });
    return;
  }
  const rawToken = header.slice(7).trim();

  // 1. Valida JWT administrativo (senha admin ou sessão local)
  const localPayload = verifyJwt(rawToken);
  if (localPayload && localPayload.role === 'admin') {
    if (localPayload.sub === 'admin-passcode') {
      req.googleAdmin = {
        uid: 'admin-passcode',
        email: localPayload.email,
        name: 'Administrador (Senha)',
      };
      next();
      return;
    }
    const profile = findProfileById(localPayload.sub);
    if (profile && profile.role === 'admin') {
      req.authUser = profile;
      next();
      return;
    }
  }

  // 2. Valida Firebase ID Token da conta Google autorizada
  const googleAdmin = await verifyFirebaseAdminToken(rawToken);
  if (googleAdmin) {
    req.googleAdmin = googleAdmin;
    next();
    return;
  }

  res.status(403).json({ erro: 'Acesso restrito ao administrador autorizado (Google ou Senha Admin).' });
}

function isSubscriptionValid(profile: UserProfileRecord): boolean {
  if (profile.status_assinatura !== 'ativo' || !profile.expira_em) return false;
  return new Date(profile.expira_em).getTime() > Date.now();
}

function collectProjectFiles(dirPath: string, rootPrefix: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'build') {
      continue;
    }
    const full = path.join(dirPath, entry.name);
    const rel = `${rootPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      results.push(...collectProjectFiles(full, rel));
    } else {
      results.push(rel);
    }
  }
  return results.sort();
}

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const apiLimiter = createRateLimiter({
    name: 'api-geral',
    windowMs: 60 * 1000,
    maxRequests: 240,
    blockDurationMs: 60 * 1000,
  });
  const authLimiter = createRateLimiter({
    name: 'login-admin',
    windowMs: 5 * 60 * 1000,
    maxRequests: 7,
    blockDurationMs: 180 * 1000,
    skipSuccessfulLogins: true,
  });
  const customerSubmitLimiter = createRateLimiter({
    name: 'envio-cliente',
    windowMs: 60 * 1000,
    maxRequests: 25,
    blockDurationMs: 60 * 1000,
  });

  // Auto-limpeza de mensagens com mais de 5 dias ao iniciar e a cada hora
  purgeExpiredDeveloperMessages();
  const purgeTimer = setInterval(() => purgeExpiredDeveloperMessages(), 60 * 60 * 1000);
  purgeTimer.unref();

  app.use(securityHeadersMiddleware(isProduction));
  app.use(express.json({ limit: '512kb' }));
  app.use(exploitShieldMiddleware);

  // Endpoints leves para monitoramento/keep-alive (Render Health Check, UptimeRobot, cron-job.org)
  app.get(['/healthz', '/api/health'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      service: 'jogos-do-mengao',
      status: 'online',
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api', apiLimiter.middleware);

  app.get('/.well-known/security.txt', (_req, res) => {
    res.type('text/plain').send(
      [
        'Contact: mailto:josuelroque05052020@gmail.com',
        'Preferred-Languages: pt-BR, en',
        'Policy: Protegido com OWASP Headers, Rate Limiting, ECDSA P-256 e Shield Anti-Exploit.',
      ].join('\n')
    );
  });

  app.use((req, res, next) => {
    if (PUBLIC_CORS_PATHS.has(req.path)) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, X-TelaCast-App, X-Device-Type'
      );
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  // 1. Auth: Registro e Login
  app.post('/api/auth/register', (req, res) => {
    const { nome, email, password, plano } = req.body as {
      nome?: string;
      email?: string;
      password?: string;
      plano?: string;
    };

    if (!nome?.trim() || !email?.trim() || !password || password.length < 6) {
      res.status(400).json({ erro: 'Informe nome, e-mail válido e senha com no mínimo 6 caracteres.' });
      return;
    }

    try {
      const created = createUserProfile({
        nome,
        email,
        password,
        role: 'user',
        plano: plano || '1 Mês',
      });
      const token = signJwt({ sub: created.id, email: created.email, role: created.role });
      res.status(201).json({ token, profile: sanitizeProfile(created) });
    } catch (err) {
      res.status(409).json({ erro: err instanceof Error ? err.message : 'Erro ao cadastrar.' });
    }
  });

  app.post('/api/auth/login', authLimiter.middleware, (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email?.trim() || !password) {
      res.status(400).json({ erro: 'Informe e-mail e senha.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail === 'josuelroque05052020@gmail.com') {
      const envPasscode = process.env.ADMIN_PASSCODE?.trim();
      const adminMatched = envPasscode
        ? timingSafeStrMatch(password.trim(), envPasscode)
        : verifyClaimedAdminPasscode(password.trim());
      if (adminMatched) {
        authLimiter.recordSuccess(req);
        const token = signJwt({
          sub: 'admin-passcode',
          email: 'josuelroque05052020@gmail.com',
          role: 'admin',
        });
        res.json({
          token,
          profile: {
            id: 'admin-passcode',
            nome: 'Administrador · Jogos do Mengão',
            email: 'josuelroque05052020@gmail.com',
            role: 'admin',
            status_assinatura: 'ativo',
            plano: 'Administrador',
            expira_em: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
            criado_em: new Date().toISOString(),
            dias_restantes: 365,
          },
        });
        return;
      }
    }

    const user = findProfileByEmail(email);
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      recordSecurityEvent('brute_force_block', getClientIp(req), req.path, 'Tentativa de login com senha inválida');
      res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
      return;
    }

    authLimiter.recordSuccess(req);
    const token = signJwt({ sub: user.id, email: user.email, role: user.role });
    res.json({ token, profile: sanitizeProfile(user) });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ profile: sanitizeProfile(req.authUser!) });
  });

  // 2. Autenticação Admin por Senha (com proteção anti-força bruta + scrypt) e status bootstrap
  app.get('/api/admin/passcode-status', (_req, res) => {
    res.json({
      envPasscodeSet: Boolean(process.env.ADMIN_PASSCODE?.trim()),
      claimed: hasClaimedAdminPasscode(),
    });
  });

  app.post('/api/admin/claim-passcode', authLimiter.middleware, (req, res) => {
    const { password } = req.body as { password?: string };
    const envPasscode = process.env.ADMIN_PASSCODE?.trim();

    if (envPasscode || hasClaimedAdminPasscode()) {
      res.status(409).json({ erro: 'Senha de administrador já configurada. Use o login padrão.' });
      return;
    }

    const candidate = typeof password === 'string' ? password.trim() : '';
    if (candidate.length < 6 || candidate.length > 128) {
      res.status(400).json({ erro: 'A senha de administrador deve ter entre 6 e 128 caracteres.' });
      return;
    }

    try {
      claimAdminPasscode(candidate);
      authLimiter.recordSuccess(req);
      const token = signJwt({
        sub: 'admin-passcode',
        email: 'josuelroque05052020@gmail.com',
        role: 'admin',
      });
      res.status(201).json({ token });
    } catch (err) {
      res.status(409).json({ erro: err instanceof Error ? err.message : 'Erro ao configurar senha.' });
    }
  });

  app.post('/api/admin/login-passcode', authLimiter.middleware, (req, res) => {
    const { password } = req.body as { password?: string };
    const candidate = typeof password === 'string' ? password.trim() : '';
    if (!candidate) {
      res.status(400).json({ erro: 'Informe a senha de administrador.' });
      return;
    }

    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    const matched = envPasscode
      ? timingSafeStrMatch(candidate, envPasscode)
      : verifyClaimedAdminPasscode(candidate);

    if (!matched) {
      recordSecurityEvent(
        'brute_force_block',
        getClientIp(req),
        req.path,
        'Senha de administrador incorreta'
      );
      res.status(401).json({ erro: 'Senha de administrador incorreta.' });
      return;
    }

    authLimiter.recordSuccess(req);
    const token = signJwt({
      sub: 'admin-passcode',
      email: 'josuelroque05052020@gmail.com',
      role: 'admin',
    });
    res.json({ token });
  });

  app.get('/api/admin/seguranca', requireAdmin, (_req, res) => {
    res.json(getSecurityStats());
  });

  app.get('/api/admin/bootstrap-status', (_req, res) => {
    res.json({
      claimed: hasClaimedAdmin(),
      envPasscodeSet: Boolean(process.env.ADMIN_PASSCODE?.trim()),
    });
  });

  app.post('/api/admin/claim', (req, res) => {
    const { nome, email, password, passcode } = req.body as {
      nome?: string;
      email?: string;
      password?: string;
      passcode?: string;
    };

    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    if (envPasscode) {
      if (!passcode || !timingSafeStrMatch(passcode, envPasscode)) {
        res.status(403).json({ erro: 'Código de administrador inválido.' });
        return;
      }
      const adminEmail = email?.trim() || 'admin@jogosdomengao.app';
      let admin = findProfileByEmail(adminEmail);
      if (!admin) {
        admin = createUserProfile({
          nome: nome?.trim() || 'Administrador',
          email: adminEmail,
          password: password && password.length >= 6 ? password : envPasscode,
          role: 'admin',
          plano: '1 Ano',
        });
      } else if (admin.role !== 'admin') {
        admin = updateProfileById(admin.id, (c) => ({ ...c, role: 'admin' }))!;
      }
      const token = signJwt({ sub: admin.id, email: admin.email, role: 'admin' });
      res.json({ token, profile: sanitizeProfile(admin) });
      return;
    }

    if (hasClaimedAdmin()) {
      res.status(409).json({ erro: 'Administrador já configurado. Faça login normalmente.' });
      return;
    }

    if (!nome?.trim() || !email?.trim() || !password || password.length < 6) {
      res.status(400).json({ erro: 'Informe nome, e-mail e senha (mínimo 6 caracteres).' });
      return;
    }

    try {
      const admin = createUserProfile({
        nome,
        email,
        password,
        role: 'admin',
        plano: '1 Ano',
      });
      const token = signJwt({ sub: admin.id, email: admin.email, role: 'admin' });
      res.status(201).json({ token, profile: sanitizeProfile(admin) });
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : 'Erro ao criar admin.' });
    }
  });

  // 3. Verificação de assinatura para o aplicativo Android (/api/verificar-assinatura)
  const handleVerifySubscription = (req: AuthedRequest, res: Response) => {
    const safe = sanitizeProfile(req.authUser!);
    const ativo = isSubscriptionValid(req.authUser!);
    res.json({
      ativo,
      status_assinatura: safe.status_assinatura,
      plano: safe.plano,
      expira_em: safe.expira_em,
      dias_restantes: safe.dias_restantes,
      nome: safe.nome,
    });
  };
  app.get('/api/verificar-assinatura', requireAuth, handleVerifySubscription);
  app.post('/api/verificar-assinatura', requireAuth, handleVerifySubscription);

  // 4. Webhook de pagamento
  app.post('/api/webhook-pagamento', (req, res) => {
    const configuredSecret = process.env.PAYMENT_WEBHOOK_SECRET?.trim();
    const asaasHeader = req.headers['asaas-access-token'];
    const mpSig = req.headers['x-signature'];

    if (configuredSecret) {
      const validAsaas =
        typeof asaasHeader === 'string' && timingSafeStrMatch(asaasHeader, configuredSecret);
      let validMp = false;
      if (typeof mpSig === 'string') {
        const dataId = String(req.body?.data?.id ?? req.body?.id ?? '');
        const reqId = String(req.headers['x-request-id'] ?? '');
        const parts = Object.fromEntries(
          mpSig.split(',').map((p) => p.trim().split('=') as [string, string])
        );
        if (parts.ts && parts.v1 && dataId) {
          const manifest = `id:${dataId};request-id:${reqId};ts:${parts.ts};`;
          const expected = crypto
            .createHmac('sha256', configuredSecret)
            .update(manifest)
            .digest('hex');
          validMp = timingSafeStrMatch(parts.v1, expected);
        }
      }

      if (!validAsaas && !validMp) {
        res.status(401).json({ erro: 'Assinatura de webhook inválida.' });
        return;
      }
    }

    const body = req.body as Record<string, unknown>;
    const eventType = String(body.event ?? body.action ?? body.type ?? '');
    const paymentObj = (body.payment as Record<string, unknown> | undefined) ?? {};
    const statusStr = String(paymentObj.status ?? body.status ?? '').toLowerCase();

    const approved =
      eventType === 'PAYMENT_CONFIRMED' ||
      eventType === 'PAYMENT_RECEIVED' ||
      statusStr === 'approved' ||
      statusStr === 'confirmed' ||
      statusStr === 'received';

    if (!approved) {
      res.json({ ignored: true, motivo: 'Evento não representa pagamento aprovado.' });
      return;
    }

    const externalRef = String(paymentObj.externalReference ?? body.external_reference ?? '').trim();
    const payerEmail = String(
      (body.payer as Record<string, unknown> | undefined)?.email ??
        paymentObj.customerEmail ??
        body.email ??
        ''
    )
      .trim()
      .toLowerCase();
    const plano = String(body.plano ?? paymentObj.description ?? '1 Mês');
    const eventoId = String(body.id ?? paymentObj.id ?? crypto.randomUUID());

    const profile = externalRef ? findProfileById(externalRef) : findProfileByEmail(payerEmail);
    if (!profile) {
      res.status(404).json({ erro: 'Assinante não encontrado.' });
      return;
    }

    const isNew = recordPaymentLog({
      user_id: profile.id,
      gateway: typeof asaasHeader === 'string' ? 'asaas' : 'mercadopago',
      evento_id: eventoId,
      plano,
      status: 'aprovado',
    });

    if (!isNew) {
      res.json({ ok: true, idempotent: true });
      return;
    }

    const updated = activateSubscriptionDays(profile.id, 30, plano)!;
    res.json({
      ok: true,
      profile: sanitizeProfile(updated),
    });
  });

  // 5. Telemetria de dispositivos usando o app Jogos do Mengão
  app.post('/api/app/heartbeat', (req, res) => {
    const { deviceCode, platform, isTv, licenseActive, planName, isStreaming } = req.body as {
      deviceCode?: string;
      platform?: string;
      isTv?: boolean;
      licenseActive?: boolean;
      planName?: string | null;
      isStreaming?: boolean;
    };

    if (!deviceCode?.trim()) {
      res.status(400).json({ erro: 'deviceCode ausente.' });
      return;
    }

    try {
      const record = upsertDeviceHeartbeat({
        deviceCode,
        platform: platform || 'pwa',
        isTv: Boolean(isTv),
        licenseActive: Boolean(licenseActive),
        planName: planName || null,
        isStreaming: Boolean(isStreaming),
      });
      res.json({ ok: true, device: record });
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : 'Dados inválidos.' });
    }
  });

  app.get('/api/admin/dispositivos', requireAdmin, (_req, res) => {
    res.json(getDeviceStats());
  });

  // 6. Rotas administrativas (/api/admin/*)
  app.get('/api/admin/usuarios', requireAdmin, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const usuarios = listProfiles(q);
    const pagamentos = listRecentPayments();
    res.json({ usuarios, pagamentos });
  });

  app.post('/api/admin/usuarios/:id/renovar', requireAdmin, (req, res) => {
    const rawDays = Number((req.body as { dias?: number } | undefined)?.dias);
    const days = rawDays === 7 || rawDays === 30 || rawDays === 90 ? rawDays : 30;
    const updated = activateSubscriptionDays(String(req.params.id), days);
    if (!updated) {
      res.status(404).json({ erro: 'Usuário não encontrado.' });
      return;
    }
    res.json({ usuario: sanitizeProfile(updated) });
  });

  app.post('/api/admin/usuarios/:id/bloquear', requireAdmin, (req, res) => {
    const updated = updateProfileById(String(req.params.id), (c) => ({
      ...c,
      status_assinatura: c.status_assinatura === 'bloqueado' ? 'vencido' : 'bloqueado',
    }));
    if (!updated) {
      res.status(404).json({ erro: 'Usuário não encontrado.' });
      return;
    }
    res.json({ usuario: sanitizeProfile(updated) });
  });

  app.patch('/api/admin/usuarios/:id/plano', requireAdmin, (req, res) => {
    const { plano } = req.body as { plano?: string };
    if (!plano?.trim()) {
      res.status(400).json({ erro: 'Plano inválido.' });
      return;
    }
    const updated = updateProfileById(String(req.params.id), (c) => ({
      ...c,
      plano: plano.trim().slice(0, 60),
    }));
    if (!updated) {
      res.status(404).json({ erro: 'Usuário não encontrado.' });
      return;
    }
    res.json({ usuario: sanitizeProfile(updated) });
  });

  // 6b. Config pública (WhatsApp, Pix, trava anti-retransmissão) e Licenciamento Offline
  app.get('/api/config/whatsapp', (_req, res) => {
    res.json({ whatsappNumber: getAdminWhatsapp() });
  });

  app.get('/api/config/public', (req, res) => {
    const cfg = getPublicAppConfig();
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = req.get('host') || '';
    const inferredOrigin =
      process.env.APP_URL?.replace(/\/$/, '') || (host ? `${proto}://${host}` : '');
    const siteUrl = cfg.publishedSiteUrl || inferredOrigin;
    res.json({
      ...cfg,
      customPlans: getCustomPlans(),
      publishedSiteUrl: siteUrl,
      publishedApkUrl:
        cfg.publishedApkUrl === '/api/download-apk' && siteUrl
          ? `${siteUrl}/api/download-apk`
          : cfg.publishedApkUrl,
      publishedWebosUrl:
        cfg.publishedWebosUrl === '/api/download-webos' && siteUrl
          ? `${siteUrl}/api/download-webos`
          : cfg.publishedWebosUrl,
    });
  });

  app.get('/api/live/status', (_req, res) => {
    res.json(getLiveBroadcastStatus());
  });

  app.patch('/api/admin/config-whatsapp', requireAdmin, (req, res) => {
    const { whatsappNumber } = req.body as { whatsappNumber?: string };
    const saved = setAdminWhatsapp(whatsappNumber || '');
    broadcastAppUpdate({
      kind: 'config',
      configVersion: getConfigVersion(),
      buildId: resolveWebBuildId(),
    });
    res.json({ whatsappNumber: saved });
  });

  app.patch('/api/admin/config-public', requireAdmin, (req, res) => {
    const body = req.body as {
      whatsappNumber?: string;
      pixKey?: string;
      pixType?: string;
      pixReceiverName?: string;
      pixQrCodeDataUrl?: string;
      tvOnlyAntiRetransmission?: boolean;
      autoPublishEnabled?: boolean;
      publishedSiteUrl?: string;
    };
    const updated = updatePublicAppConfig(body);
    broadcastAppUpdate({
      kind: 'config',
      configVersion: getConfigVersion(),
      buildId: resolveWebBuildId(),
    });
    res.json(updated);
  });

  app.put('/api/admin/plans', requireAdmin, (req, res) => {
    const body = req.body as {
      plan?: ServerPlanRecord;
      seedDefaults?: ServerPlanRecord[];
    };
    if (!body?.plan || !body.plan.id) {
      res.status(400).json({ erro: 'Dados do plano inválidos.' });
      return;
    }
    const plans = upsertCustomPlan(body.plan, body.seedDefaults);
    broadcastAppUpdate({
      kind: 'config',
      configVersion: getConfigVersion(),
      buildId: resolveWebBuildId(),
    });
    res.json({ ok: true, plans });
  });

  app.delete('/api/admin/plans/:id', requireAdmin, (req, res) => {
    const body = (req.body || {}) as { seedDefaults?: ServerPlanRecord[] };
    const plans = deleteCustomPlan(String(req.params.id), body.seedDefaults);
    broadcastAppUpdate({
      kind: 'config',
      configVersion: getConfigVersion(),
      buildId: resolveWebBuildId(),
    });
    res.json({ ok: true, plans });
  });

  // 6c. Pré-cadastro de cliente + confirmação "Já efetuei o pagamento" -> "Renovar agora"
  app.post('/api/clientes/pagamento-informado', customerSubmitLimiter.middleware, (req, res) => {
    const body = req.body as {
      customerName?: string;
      customerWhatsapp?: string;
      deviceCode?: string;
      planName?: string;
      planPrice?: string;
      planDays?: number;
      customValidity?: string;
    };
    try {
      const solicitacao = createPaymentRequest({
        customerName: body.customerName || '',
        customerWhatsapp: body.customerWhatsapp || '',
        deviceCode: body.deviceCode || '',
        planName: body.planName || '1 Mês',
        planPrice: body.planPrice || 'Sob consulta',
        planDays: Number(body.planDays) || 0,
        customValidity: body.customValidity || '',
      });
      res.status(201).json({ ok: true, solicitacao });
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : 'Dados inválidos.' });
    }
  });

  app.get('/api/admin/solicitacoes', requireAdmin, (_req, res) => {
    res.json({ solicitacoes: listPaymentRequests() });
  });

  app.post('/api/admin/solicitacoes/:id/renovar', requireAdmin, (req, res) => {
    const reqId = String(req.params.id);
    const existing = findPaymentRequestById(reqId);
    if (!existing) {
      res.status(404).json({ erro: 'Solicitação de cliente não encontrada.' });
      return;
    }

    const body = (req.body as { dias?: number; validade_ate?: string; plano?: string } | undefined) || {};
    const effectivePlan = body.plano?.trim() || existing.planName || '1 Mês';
    const validadeAte = body.validade_ate?.trim() || undefined;
    const rawDays = Number(body.dias);
    const effectiveDays =
      Number.isFinite(rawDays) && rawDays > 0
        ? rawDays
        : existing.planDays > 0
          ? existing.planDays
          : 30;

    try {
      const chave = generateOfflineActivationKey({
        deviceCode: existing.deviceCode,
        dias: effectiveDays,
        validade_ate: validadeAte,
        plano: effectivePlan,
      });
      const solicitacao = markPaymentRequestRenewed(reqId, {
        activationKey: chave.activationKey,
        expira_em: chave.expira_em,
        dias: chave.dias,
        plano: chave.plano,
      });
      res.json({ ok: true, solicitacao, chave });
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : 'Erro ao renovar aparelho.' });
    }
  });

  app.delete('/api/admin/solicitacoes/:id', requireAdmin, (req, res) => {
    const deleted = deletePaymentRequestById(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ erro: 'Solicitação não encontrada.' });
      return;
    }
    res.json({ ok: true });
  });

  // 6d. Mensagens dos clientes para o Desenvolvedor (auto-exclusão após 5 dias ou exclusão manual)
  app.post('/api/mensagens-dev', customerSubmitLimiter.middleware, (req, res) => {
    const body = req.body as {
      senderName?: string;
      senderWhatsapp?: string;
      category?: string;
      message?: string;
    };
    try {
      const mensagem = createDeveloperMessage({
        senderName: body.senderName || '',
        senderWhatsapp: body.senderWhatsapp || '',
        category: body.category || 'Suporte',
        message: body.message || '',
      });
      res.status(201).json({ ok: true, mensagem });
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : 'Dados inválidos.' });
    }
  });

  app.get('/api/admin/mensagens', requireAdmin, (_req, res) => {
    res.json({ mensagens: listDeveloperMessages(), retentionDays: 5 });
  });

  app.delete('/api/admin/mensagens/:id', requireAdmin, (req, res) => {
    const deleted = deleteDeveloperMessageById(String(req.params.id));
    if (!deleted) {
      res.status(404).json({ erro: 'Mensagem não encontrada ou já expirada.' });
      return;
    }
    res.json({ ok: true });
  });

  app.delete('/api/admin/mensagens', requireAdmin, (_req, res) => {
    const removed = clearAllDeveloperMessages();
    res.json({ ok: true, removed });
  });

  app.post('/api/admin/auto-publicar', requireAdmin, (req, res) => {
    const { siteUrl } = req.body as { siteUrl?: string };
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = req.get('host') || '';
    const fallbackOrigin =
      process.env.APP_URL?.replace(/\/$/, '') || (host ? `${proto}://${host}` : '');
    const targetOrigin = (siteUrl || fallbackOrigin).trim().replace(/\/$/, '');
    const published = autoPublishDistribution(targetOrigin);
    broadcastAppUpdate({
      kind: 'config',
      configVersion: getConfigVersion(),
      buildId: resolveWebBuildId(),
    });
    res.json({
      published,
      pwaInstallUrl: targetOrigin ? `${targetOrigin}/?mode=app` : '/?mode=app',
    });
  });

  app.post('/api/admin/broadcast-handoff-token', requireAdmin, (req: AuthedRequest, res) => {
    const adminEmail =
      req.googleAdmin?.email || req.authUser?.email || 'josuelroque05052020@gmail.com';
    const handoffToken = signJwt({
      sub: 'admin-passcode',
      email: adminEmail,
      role: 'admin',
    });
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = req.get('host') || '';
    const serverUrl =
      process.env.APP_URL?.replace(/\/$/, '') || (host ? `${proto}://${host}` : '');
    const wsUrl = serverUrl
      ? serverUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') + '/ws/live'
      : '';
    res.json({
      token: handoffToken,
      serverUrl,
      wsUrl,
    });
  });

  app.post('/api/admin/live/stop', requireAdmin, (_req, res) => {
    forceStopLiveBroadcast();
    res.json({ ok: true, state: getLiveBroadcastStatus() });
  });

  app.get('/api/licenca/chave-publica', (_req, res) => {
    res.json({
      ...getPublicLicenseKey(),
      whatsappNumber: getAdminWhatsapp(),
      tvOnlyAntiRetransmission: getPublicAppConfig().tvOnlyAntiRetransmission,
    });
  });

  app.get('/api/admin/chaves-offline', requireAdmin, (_req, res) => {
    res.json({ chaves: listOfflineLicenses(), whatsappNumber: getAdminWhatsapp() });
  });

  app.post('/api/admin/gerar-chave-offline', requireAdmin, (req, res) => {
    const { deviceCode, dias, validade_ate, plano } = req.body as {
      deviceCode?: string;
      dias?: number;
      validade_ate?: string;
      plano?: string;
    };
    if (!deviceCode?.trim()) {
      res.status(400).json({ erro: 'Informe o código do aparelho (ex: TC-A1B2-C3D4).' });
      return;
    }
    try {
      const record = generateOfflineActivationKey({
        deviceCode,
        dias: Number(dias) || 30,
        validade_ate,
        plano: plano?.trim() || '1 Mês',
      });
      res.status(201).json({ chave: record });
    } catch (err) {
      res.status(400).json({ erro: err instanceof Error ? err.message : 'Erro ao gerar chave.' });
    }
  });

  // 7. Downloads de pacotes para Smart TV LG webOS e Android (.apk)
  app.get('/api/download-webos', async (_req, res) => {
    const zip = new JSZip();
    const webosFiles = collectProjectFiles(path.resolve(process.cwd(), 'webos'), 'webos');
    for (const rel of webosFiles) {
      const innerName = rel.replace(/^webos\//, '');
      zip.file(innerName, fs.readFileSync(path.resolve(process.cwd(), rel)));
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="JogosDoMengao-LG-webOS.zip"');
    res.send(buffer);
  });

  const DEFAULT_RELEASE_APK_URL =
    'https://github.com/20061998-max/App-jogos-do-meng-o-v2/releases/download/latest/JogosDoMengao.apk';
  const GITHUB_LATEST_RELEASE_API =
    'https://api.github.com/repos/20061998-max/App-jogos-do-meng-o-v2/releases/tags/latest';

  let cachedExternalApkMeta: {
    sizeBytes: number;
    updatedAt: string;
    fetchedAt: number;
  } | null = null;

  function resolveExternalApkUrl(): string | null {
    const raw = process.env.APK_DOWNLOAD_URL?.trim() || DEFAULT_RELEASE_APK_URL;
    try {
      const parsed = new URL(raw);
      return parsed.protocol === 'https:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  async function resolveApkStatusSnapshot() {
    const compiledPath = resolveCompiledApkPath();
    if (compiledPath) {
      const stat = fs.statSync(compiledPath);
      return {
        hasCompiledApk: true,
        filename: 'JogosDoMengao.apk',
        sizeBytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        downloadUrl: '/api/download-apk',
      };
    }

    const externalApkUrl = resolveExternalApkUrl();
    if (externalApkUrl) {
      const now = Date.now();
      if (!cachedExternalApkMeta || now - cachedExternalApkMeta.fetchedAt > 60_000) {
        try {
          const resp = await fetch(GITHUB_LATEST_RELEASE_API, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'JogosDoMengao-Server' },
          });
          if (resp.ok) {
            const rel = (await resp.json()) as {
              published_at?: string;
              assets?: { name?: string; size?: number; updated_at?: string }[];
            };
            const asset = rel.assets?.find((a) => a.name === 'JogosDoMengao.apk');
            if (asset) {
              cachedExternalApkMeta = {
                sizeBytes: Number(asset.size) || 0,
                updatedAt: asset.updated_at || rel.published_at || SERVER_BOOT_ISO,
                fetchedAt: now,
              };
            }
          }
        } catch {
          // fallback abaixo
        }
      }
      return {
        hasCompiledApk: true,
        filename: 'JogosDoMengao.apk',
        sizeBytes: cachedExternalApkMeta?.sizeBytes ?? 0,
        updatedAt: cachedExternalApkMeta?.updatedAt ?? SERVER_BOOT_ISO,
        downloadUrl: '/api/download-apk',
      };
    }

    return {
      hasCompiledApk: false,
      filename: 'JogosDoMengao.apk',
      sizeBytes: 0,
      updatedAt: null,
      downloadUrl: null,
    };
  }

  app.get('/api/apk-status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await resolveApkStatusSnapshot());
  });

  app.get('/api/app/version', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      buildId: resolveWebBuildId(),
      configVersion: getConfigVersion(),
      apk: await resolveApkStatusSnapshot(),
    });
  });

  app.get('/api/download-apk', async (_req, res) => {
    const compiledPath = resolveCompiledApkPath();
    if (compiledPath) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="JogosDoMengao.apk"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(compiledPath);
      return;
    }

    const externalApkUrl = resolveExternalApkUrl();
    if (externalApkUrl) {
      res.redirect(302, externalApkUrl);
      return;
    }

    res.status(404).json({
      erro: 'APK ainda não disponível neste servidor. Faça o build ou configure APK_DOWNLOAD_URL.',
    });
  });

  // 8. Vite dev middleware ou static production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  attachLiveRelay(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Jogos do Mengão server listening on http://localhost:${PORT}`);
  });
}

startServer();
