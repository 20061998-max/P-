'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [modo, setModo] = useState<'login' | 'cadastro'>('login');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setMensagem(null);
    setCarregando(true);

    const supabase = createClient();

    if (modo === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setCarregando(false);
      if (error) {
        setErro(error.message);
        return;
      }
      router.push('/painel');
      router.refresh();
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { nome } },
      });
      setCarregando(false);
      if (error) {
        setErro(error.message);
        return;
      }
      setMensagem('Cadastro realizado! Verifique seu e-mail ou entre no painel.');
      router.push('/painel');
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-md rounded-xl border border-slate-200 bg-white p-8">
        <Link href="/" className="font-display text-lg font-bold text-slate-900">
          TelaCast
        </Link>
        <h1 className="mt-4 font-display text-2xl font-bold text-slate-900">
          {modo === 'login' ? 'Entrar na sua conta' : 'Criar conta de assinante'}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Use as mesmas credenciais no aplicativo Android para liberar o espelhamento.
        </p>

        <div className="mt-6 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setModo('login')}
            className={`rounded-md py-2 text-xs font-semibold transition-colors ${
              modo === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => setModo('cadastro')}
            className={`rounded-md py-2 text-xs font-semibold transition-colors ${
              modo === 'cadastro' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {modo === 'cadastro' && (
            <div>
              <label className="block text-xs font-medium text-slate-700">Nome completo</label>
              <input
                type="text"
                required
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
                placeholder="Seu nome"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700">E-mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
              placeholder="voce@empresa.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
              placeholder="Mínimo 6 caracteres"
            />
          </div>

          {erro && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>
          )}
          {mensagem && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              {mensagem}
            </p>
          )}

          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {carregando
              ? 'Processando...'
              : modo === 'login'
                ? 'Entrar no painel'
                : 'Cadastrar e continuar'}
          </button>
        </form>
      </div>
    </div>
  );
}
