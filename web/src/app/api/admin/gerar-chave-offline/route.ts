import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createServiceRoleClient } from '@/lib/supabase/server';
import { generateOfflineActivationKey } from '@/lib/license';

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  const authHeader = req.headers.get('authorization');

  const {
    data: { user },
  } = authHeader?.startsWith('Bearer ')
    ? await supabase.auth.getUser(authHeader.slice(7).trim())
    : await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }

  const adminClient = createServiceRoleClient();
  const { data: profile } = await adminClient
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 403 });
  }

  const body = await req.json();
  const { deviceCode, dias, validade_ate, plano } = body as {
    deviceCode?: string;
    dias?: number;
    validade_ate?: string;
    plano?: string;
  };

  if (!deviceCode) {
    return NextResponse.json({ error: 'Informe o código do aparelho (TC-XXXX-XXXX).' }, { status: 400 });
  }

  try {
    const licenca = generateOfflineActivationKey({
      deviceCode,
      dias: Number(dias) || 30,
      validade_ate,
      plano: plano || 'Mensal Pro',
    });
    return NextResponse.json({ licenca });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
