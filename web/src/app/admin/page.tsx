'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';

interface UsuarioProfile {
  id: string;
  nome: string;
  email: string;
  role: 'user' | 'admin';
  status_assinatura: 'ativo' | 'pendente' | 'vencido' | 'bloqueado';
  plano: string;
  expira_em: string | null;
  criado_em: string;
}

interface OfflineLicenseRecord {
  id: string;
  deviceCode: string;
  plano: string;
  dias: number;
  expira_em: string;
  activationKey: string;
  criado_em: string;
}

export default function AdminPage() {
  const [usuarios, setUsuarios] = useState<UsuarioProfile[]>([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [deviceCode, setDeviceCode] = useState('');
  const [diasOffline, setDiasOffline] = useState(30);
  const [validadeDate, setValidadeDate] = useState(() => {
    const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [planoOffline, setPlanoOffline] = useState('1 Mês');
  const [ultimaChave, setUltimaChave] = useState<OfflineLicenseRecord | null>(null);
  const [erroChave, setErroChave] = useState<string | null>(null);

  async function carregarUsuarios(q = '') {
    setCarregando(true);
    setErro(null);
    const res = await fetch(`/api/admin/usuarios?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      setErro('Acesso restrito a administradores autenticados.');
      setCarregando(false);
      return;
    }
    const data = await res.json();
    setUsuarios(data.usuarios ?? []);
    setCarregando(false);
  }

  useEffect(() => {
    carregarUsuarios();
  }, []);

  async function executarAcao(
    userId: string,
    acao: 'renovar_30_dias' | 'bloquear' | 'alterar_plano',
    plano?: string
  ) {
    const res = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, acao, plano }),
    });
    if (res.ok) {
      carregarUsuarios(busca);
    }
  }

  async function gerarChaveOffline(e: FormEvent) {
    e.preventDefault();
    setErroChave(null);
    const res = await fetch('/api/admin/gerar-chave-offline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceCode: deviceCode.trim().toUpperCase(),
        dias: diasOffline,
        validade_ate: validadeDate,
        plano: planoOffline,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErroChave(data.error ?? 'Erro ao gerar chave offline.');
      return;
    }
    setUltimaChave(data.licenca);
    setDeviceCode('');
  }

  const total = usuarios.length;
  const ativos = usuarios.filter((u) => u.status_assinatura === 'ativo').length;
  const vencidosOuBloqueados = usuarios.filter(
    (u) => u.status_assinatura === 'vencido' || u.status_assinatura === 'bloqueado'
  ).length;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <Link href="/" className="font-display text-lg font-bold text-slate-900">
            TelaCast Admin
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/painel" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Voltar ao painel
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium text-slate-500">Total de usuários</p>
            <p className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {total}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium text-slate-500">Assinantes ativos</p>
            <p className="mt-2 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {ativos}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium text-slate-500">Vencidos ou bloqueados</p>
            <p className="mt-2 font-display text-2xl font-bold text-red-700 tabular-nums">
              {vencidosOuBloqueados}
            </p>
          </div>
        </div>

        {/* Gerador de Chave Offline por Código do Celular / TV */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">
              Gerar chave offline por código do celular / TV
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Emita uma licença ECDSA P-256 vinculada ao código TC-XXXX-XXXX para validação 100%
              offline dentro do aplicativo ou atalho.
            </p>
          </div>

          <form onSubmit={gerarChaveOffline} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <input
              type="text"
              value={deviceCode}
              onChange={(e) => setDeviceCode(e.target.value.toUpperCase())}
              placeholder="TC-XXXX-XXXX"
              required
              className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase focus:border-blue-700 focus:outline-none"
            />
            <select
              value={planoOffline}
              onChange={(e) => {
                const name = e.target.value;
                setPlanoOffline(name);
                const map: Record<string, number> = {
                  '1 Mês': 30,
                  '3 Meses': 90,
                  '6 Meses': 180,
                  '1 Ano': 365,
                };
                const d = map[name] ?? 30;
                setDiasOffline(d);
                setValidadeDate(new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="1 Mês">1 Mês</option>
              <option value="3 Meses">3 Meses</option>
              <option value="6 Meses">6 Meses</option>
              <option value="1 Ano">1 Ano</option>
              <option value="Outros">Outros (Personalizado)</option>
            </select>
            <select
              value={diasOffline}
              onChange={(e) => {
                const d = Number(e.target.value);
                setDiasOffline(d);
                if (d > 0) {
                  setValidadeDate(new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
                }
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums"
            >
              <option value={30}>1 mês (30 dias)</option>
              <option value={90}>3 meses (90 dias)</option>
              <option value={180}>6 meses (180 dias)</option>
              <option value={365}>1 ano (365 dias)</option>
              <option value={0}>Outros (escolher data)</option>
            </select>
            <input
              type="date"
              value={validadeDate}
              onChange={(e) => setValidadeDate(e.target.value)}
              required
              className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Gerar chave offline
            </button>
          </form>

          {erroChave && <p className="text-xs text-red-700">{erroChave}</p>}

          {ultimaChave && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-emerald-900">
                  Chave emitida para {ultimaChave.deviceCode} · {ultimaChave.plano} ·{' '}
                  {ultimaChave.dias} dias (vence em{' '}
                  {new Date(ultimaChave.expira_em).toLocaleDateString('pt-BR')})
                </span>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(
                    `Sua assinatura TelaCast (${ultimaChave.plano}) foi liberada até ${new Date(
                      ultimaChave.expira_em
                    ).toLocaleDateString('pt-BR')} para o aparelho ${ultimaChave.deviceCode}.\n\nCole esta chave no aplicativo:\n${ultimaChave.activationKey}`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  Enviar no WhatsApp
                </a>
              </div>
              <div className="break-all rounded border border-emerald-200 bg-white p-2 font-mono text-xs text-slate-900">
                {ultimaChave.activationKey}
              </div>
            </div>
          )}
        </section>

        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 p-5">
            <h1 className="font-display text-lg font-bold text-slate-900">
              Gestão de assinantes
            </h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                carregarUsuarios(busca);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome ou e-mail..."
                className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-700 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Buscar
              </button>
            </form>
          </div>

          {erro ? (
            <div className="p-8 text-center text-sm text-red-700">{erro}</div>
          ) : carregando ? (
            <div className="p-8 text-center text-sm text-slate-500">Carregando usuários...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Usuário</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Plano</th>
                    <th className="px-5 py-3 font-medium">Vencimento</th>
                    <th className="px-5 py-3 text-right font-medium">Ações rápidas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {usuarios.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-900">{u.nome}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="px-5 py-3 font-medium">{u.status_assinatura}</td>
                      <td className="px-5 py-3">
                        <select
                          value={u.plano}
                          onChange={(e) =>
                            executarAcao(u.id, 'alterar_plano', e.target.value)
                          }
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                        >
                          <option value="Mensal Básico">Mensal Básico</option>
                          <option value="Mensal Pro">Mensal Pro</option>
                          <option value="Mensal Estúdio">Mensal Estúdio</option>
                        </select>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs tabular-nums text-slate-600">
                        {u.expira_em
                          ? new Date(u.expira_em).toLocaleDateString('pt-BR')
                          : '—'}
                      </td>
                      <td className="px-5 py-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => executarAcao(u.id, 'renovar_30_dias')}
                          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                        >
                          Ativar +30d
                        </button>
                        <button
                          type="button"
                          onClick={() => executarAcao(u.id, 'bloquear')}
                          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          Bloquear
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
