import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { ativo: false, erro: 'Token JWT ausente no cabeçalho Authorization.' },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7).trim();
  const supabase = createServiceRoleClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json(
      { ativo: false, erro: 'Token inválido ou expirado.' },
      { status: 401 }
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('nome, status_assinatura, plano, expira_em')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json(
      { ativo: false, erro: 'Perfil não encontrado.' },
      { status: 404 }
    );
  }

  const agora = new Date();
  const expiraEm = profile.expira_em ? new Date(profile.expira_em) : null;
  const dentroDaValidade = Boolean(expiraEm && expiraEm.getTime() > agora.getTime());
  const ativo = profile.status_assinatura === 'ativo' && dentroDaValidade;

  return NextResponse.json({
    ativo,
    status_assinatura: profile.status_assinatura,
    plano: profile.plano,
    expira_em: profile.expira_em,
    nome: profile.nome,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
