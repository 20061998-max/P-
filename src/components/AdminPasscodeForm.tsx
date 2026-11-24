import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { ExternalLink, Eye, EyeOff, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { ADMIN_EMAIL, signOutGoogleAccount } from '../lib/firebase';
import { setAdminPasscodeToken } from '../lib/adminMemorySession';

interface PasscodeStatus {
  envPasscodeSet: boolean;
  claimed: boolean;
}

interface AdminPasscodeFormProps {
  title: string;
  subtitle: string;
  googleUser: User | null;
  authLoading: boolean;
  authError: string | null;
  onGoogleSignIn: () => Promise<void>;
}

export function AdminPasscodeForm({
  title,
  subtitle,
  googleUser,
  authLoading,
  authError,
  onGoogleSignIn,
}: AdminPasscodeFormProps) {
  const [status, setStatus] = useState<PasscodeStatus>({ envPasscodeSet: true, claimed: false });
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passcodeError, setPasscodeError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/passcode-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PasscodeStatus | null) => {
        if (data) setStatus(data);
      })
      .catch(() => undefined)
      .finally(() => setStatusLoaded(true));
  }, []);

  const isFirstRunSetup = statusLoaded && !status.envPasscodeSet && !status.claimed;
  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  const currentHref = typeof window !== 'undefined' ? window.location.href : '/';

  async function handlePasscodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasscodeError(null);
    const trimmed = password.trim();
    if (!trimmed) {
      setPasscodeError('Digite a senha de administrador.');
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = isFirstRunSetup ? '/api/admin/claim-passcode' : '/api/admin/login-passcode';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: trimmed }),
      });
      const data = (await res.json()) as { token?: string; erro?: string };
      if (!res.ok || !data.token) {
        setPasscodeError(data.erro || 'Não foi possível validar a senha.');
        return;
      }
      setPassword('');
      setAdminPasscodeToken(data.token);
    } catch {
      setPasscodeError('Erro de conexão com o servidor ao validar senha.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-7 space-y-5">
      <div className="flex items-center gap-3.5">
        <img
          src="/pwa-192x192.png"
          alt="Ícone Jogos do Mengão"
          className="h-12 w-12 rounded-xl border border-zinc-700 object-cover shrink-0"
        />
        <div>
          <h1 className="font-display text-2xl font-bold text-white leading-tight">{title}</h1>
          <p className="text-xs text-zinc-400">{subtitle}</p>
        </div>
      </div>

      {googleUser && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/50 p-3 text-xs text-red-200 space-y-2">
          <p>
            Conectado como <span className="font-mono">{googleUser.email}</span>, que não é a conta
            Google administradora autorizada ({ADMIN_EMAIL}).
          </p>
          <button
            type="button"
            onClick={() => signOutGoogleAccount()}
            className="underline font-semibold text-white cursor-pointer"
          >
            Sair desta conta e escolher outra
          </button>
        </div>
      )}

      {authError && (
        <p className="rounded-lg bg-red-950/70 px-3 py-2 text-xs text-red-300">{authError}</p>
      )}

      <button
        type="button"
        onClick={onGoogleSignIn}
        disabled={authLoading}
        className="inline-flex w-full items-center justify-center gap-2.5 rounded-lg bg-[#C8102E] py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
      >
        <Lock className="h-4 w-4" />
        {authLoading ? 'Conectando ao Google...' : 'Entrar com Conta Google Admin'}
      </button>

      {(isInIframe || authError) && (
        <a
          href={currentHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
        >
          <ExternalLink className="h-3.5 w-3.5 text-[#C8102E]" />
          Abrir site em nova aba para Login Google
        </a>
      )}

      <div className="relative flex items-center py-1">
        <div className="flex-grow border-t border-zinc-800" />
        <span className="mx-3 shrink-0 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
          ou entrar com senha admin
        </span>
        <div className="flex-grow border-t border-zinc-800" />
      </div>

      <form onSubmit={handlePasscodeSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-zinc-300">
            {isFirstRunSetup ? 'Configurar Senha Admin (1º Acesso)' : 'Senha de Administrador'}
          </label>
          <div className="relative mt-1">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete={isFirstRunSetup ? 'new-password' : 'current-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                isFirstRunSetup
                  ? 'Defina sua senha Admin (mín. 6 caracteres)'
                  : 'Digite sua senha de administrador'
              }
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 py-2.5 pl-3 pr-10 text-sm text-white focus:border-[#C8102E] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-white cursor-pointer"
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {isFirstRunSetup && (
            <p className="mt-1.5 text-[11px] text-zinc-400">
              Primeiro acesso: defina a senha aqui ou configure{' '}
              <span className="font-mono text-zinc-200">ADMIN_PASSCODE</span> nas variáveis de
              ambiente.
            </p>
          )}
        </div>

        {passcodeError && (
          <p className="rounded-lg bg-red-950/70 px-3 py-2 text-xs text-red-300">{passcodeError}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 py-2.5 text-sm font-semibold text-white hover:border-[#C8102E] hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
        >
          <KeyRound className="h-4 w-4 text-[#C8102E]" />
          {submitting
            ? 'Validando...'
            : isFirstRunSetup
              ? 'Salvar Senha e Entrar como Admin'
              : 'Entrar com Senha Admin'}
        </button>
      </form>

      <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-[11px] text-zinc-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span>Protegido contra força bruta (bloqueio automático após tentativas inválidas).</span>
      </div>
    </div>
  );
}
