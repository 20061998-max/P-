import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createServiceRoleClient } from '@/lib/supabase/server';

function timingSafeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyMercadoPagoSignature(req: NextRequest, dataId: string, secret: string): boolean {
  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id') ?? '';
  if (!xSignature) return false;

  const parts = Object.fromEntries(
    xSignature.split(',').map((item) => {
      const [k, v] = item.trim().split('=');
      return [k, v];
    })
  );

  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${parts.ts};`;
  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');

  return timingSafeMatch(parts.v1, expectedHmac);
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'PAYMENT_WEBHOOK_SECRET não configurado no servidor.' },
      { status: 500 }
    );
  }

  const rawBody = await req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Payload JSON inválido.' }, { status: 400 });
  }

  // Suporta Asaas (asaas-access-token) ou Mercado Pago (x-signature HMAC)
  const asaasToken = req.headers.get('asaas-access-token');
  const dataObj = (body.data as Record<string, unknown> | undefined) ?? {};
  const dataId = String(dataObj.id ?? body.id ?? '');

  const isAsaasValid = asaasToken ? timingSafeMatch(asaasToken, webhookSecret) : false;
  const isMpValid = dataId ? verifyMercadoPagoSignature(req, dataId, webhookSecret) : false;

  if (!isAsaasValid && !isMpValid) {
    return NextResponse.json({ error: 'Assinatura de webhook inválida.' }, { status: 401 });
  }

  // Normaliza eventos de pagamento aprovado (Asaas PAYMENT_RECEIVED / PAYMENT_CONFIRMED ou MP approved)
  const eventType = String(body.event ?? body.action ?? body.type ?? '');
  const paymentObj = (body.payment as Record<string, unknown> | undefined) ?? {};
  const statusStr = String(paymentObj.status ?? body.status ?? '').toLowerCase();

  const isApproved =
    eventType === 'PAYMENT_CONFIRMED' ||
    eventType === 'PAYMENT_RECEIVED' ||
    statusStr === 'approved' ||
    statusStr === 'confirmed' ||
    statusStr === 'received';

  if (!isApproved) {
    return NextResponse.json({ ignored: true, motivo: 'Evento não representa pagamento aprovado.' });
  }

  const externalRef = String(
    paymentObj.externalReference ?? body.external_reference ?? dataObj.external_reference ?? ''
  ).trim();
  const payerEmail = String(
    (body.payer as Record<string, unknown> | undefined)?.email ??
      paymentObj.customerEmail ??
      body.email ??
      ''
  )
    .trim()
    .toLowerCase();
  const plano = String(body.plano ?? paymentObj.description ?? 'Mensal Pro');
  const eventoId = String(body.id ?? paymentObj.id ?? dataId ?? crypto.randomUUID());

  if (!externalRef && !payerEmail) {
    return NextResponse.json(
      { error: 'Identificador do usuário ausente (external_reference ou email).' },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();

  // Verifica idempotência
  const { data: existingLog } = await supabase
    .from('pagamentos_log')
    .select('id')
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (existingLog) {
    return NextResponse.json({ ok: true, idempotent: true });
  }

  // Localiza perfil por ID (external_reference) ou e-mail
  const query = externalRef
    ? supabase.from('profiles').select('*').eq('id', externalRef).maybeSingle()
    : supabase.from('profiles').select('*').eq('email', payerEmail).maybeSingle();

  const { data: profile, error: profileErr } = await query;
  if (profileErr || !profile) {
    return NextResponse.json({ error: 'Perfil do assinante não encontrado.' }, { status: 404 });
  }

  // Soma +30 dias a partir de agora ou da data de expiração futura existente
  const now = new Date();
  const currentExp = profile.expira_em ? new Date(profile.expira_em) : null;
  const baseDate = currentExp && currentExp > now ? currentExp : now;
  const novaExpiracao = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({
      status_assinatura: 'ativo',
      plano,
      expira_em: novaExpiracao.toISOString(),
    })
    .eq('id', profile.id);

  if (updateErr) {
    return NextResponse.json({ error: 'Falha ao atualizar assinatura.' }, { status: 500 });
  }

  await supabase.from('pagamentos_log').insert({
    user_id: profile.id,
    gateway: isAsaasValid ? 'asaas' : 'mercadopago',
    evento_id: eventoId,
    plano,
    status: 'aprovado',
    payload: body,
  });

  return NextResponse.json({
    ok: true,
    user_id: profile.id,
    status_assinatura: 'ativo',
    expira_em: novaExpiracao.toISOString(),
  });
}
