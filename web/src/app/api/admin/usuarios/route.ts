import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createServiceRoleClient } from '@/lib/supabase/server';

async function requireAdmin(req: NextRequest) {
  const supabase = await createServerSupabase();
  const authHeader = req.headers.get('authorization');

  const {
    data: { user },
  } = authHeader?.startsWith('Bearer ')
    ? await supabase.auth.getUser(authHeader.slice(7).trim())
    : await supabase.auth.getUser();

  if (!user) return null;

  const adminClient = createServiceRoleClient();
  const { data: profile } = await adminClient
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') return null;
  return { user, adminClient };
}

export async function GET(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  let query = ctx.adminClient
    .from('profiles')
    .select('id, nome, email, role, status_assinatura, plano, expira_em, criado_em')
    .order('criado_em', { ascending: false });

  if (q) {
    query = query.or(`nome.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ usuarios: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireAdmin(req);
  if (!ctx) {
    return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
  }

  const body = await req.json();
  const { userId, acao, plano } = body as {
    userId?: string;
    acao?: 'renovar_30_dias' | 'bloquear' | 'alterar_plano';
    plano?: string;
  };

  if (!userId || !acao) {
    return NextResponse.json({ error: 'Parâmetros userId e acao são obrigatórios.' }, { status: 400 });
  }

  const { data: target } = await ctx.adminClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (!target) {
    return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
  }

  if (acao === 'renovar_30_dias') {
    const now = new Date();
    const current = target.expira_em ? new Date(target.expira_em) : null;
    const base = current && current > now ? current : now;
    const nextExp = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: updated, error } = await ctx.adminClient
      .from('profiles')
      .update({ status_assinatura: 'ativo', expira_em: nextExp })
      .eq('id', userId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ usuario: updated });
  }

  if (acao === 'bloquear') {
    const { data: updated, error } = await ctx.adminClient
      .from('profiles')
      .update({ status_assinatura: 'bloqueado' })
      .eq('id', userId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ usuario: updated });
  }

  if (acao === 'alterar_plano' && plano) {
    const { data: updated, error } = await ctx.adminClient
      .from('profiles')
      .update({ plano })
      .eq('id', userId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ usuario: updated });
  }

  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
}
