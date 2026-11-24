import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';

export default async function PainelPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const agora = new Date();
  const expiraEm = profile?.expira_em ? new Date(profile.expira_em) : null;
  const assinaturaAtiva =
    profile?.status_assinatura === 'ativo' && Boolean(expiraEm && expiraEm > agora);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-8 px-6 py-4">
          <Link href="/" className="font-display text-lg font-bold text-slate-900">
            TelaCast
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
            <Link href="/painel" className="text-slate-900">
              Minha assinatura
            </Link>
            {profile?.role === 'admin' && (
              <Link href="/admin" className="hover:text-slate-900">
                Painel Admin
              </Link>
            )}
          </nav>
          <a
            href="/downloads/telacast.apk"
            download
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            Baixar APK
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12 space-y-8">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Olá, {profile?.nome ?? user.email}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Acompanhe sua assinatura para liberar o espelhamento no aplicativo Android.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-xs font-medium text-slate-500">Status da assinatura</p>
            <p
              className={`mt-2 font-display text-xl font-bold ${
                assinaturaAtiva ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {profile?.status_assinatura ?? 'pendente'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-xs font-medium text-slate-500">Plano atual</p>
            <p className="mt-2 font-display text-xl font-bold text-slate-900">
              {profile?.plano ?? 'Mensal Pro'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-xs font-medium text-slate-500">Data de vencimento</p>
            <p className="mt-2 font-mono text-lg font-semibold text-slate-900 tabular-nums">
              {expiraEm ? expiraEm.toLocaleDateString('pt-BR') : 'Sem validade ativa'}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              {assinaturaAtiva ? 'Renovar assinatura (+30 dias)' : 'Ativar assinatura mensal'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Pagamento via Pix ou Cartão (Mercado Pago / Asaas) com liberação imediata via webhook.
            </p>
          </div>
          <Link
            href="/#planos"
            className="rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap"
          >
            {assinaturaAtiva ? 'Renovar agora' : 'Assinar plano'}
          </Link>
        </div>
      </main>
    </div>
  );
}
