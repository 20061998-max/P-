import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, MessageSquarePlus, Send } from 'lucide-react';
import { getSavedCustomerPreRegistration } from '../lib/offlineLicense';

interface DeveloperMessageBoxProps {
  compact?: boolean;
}

const CATEGORIES = ['Suporte', 'Pagamento', 'Dúvida', 'Sugestão', 'Outro'] as const;

export function DeveloperMessageBox({ compact = false }: DeveloperMessageBoxProps) {
  const [senderName, setSenderName] = useState('');
  const [senderWhatsapp, setSenderWhatsapp] = useState('');
  const [category, setCategory] = useState<string>('Suporte');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  useEffect(() => {
    void getSavedCustomerPreRegistration().then((saved) => {
      if (saved.customerName) setSenderName((prev) => prev || saved.customerName);
      if (saved.customerWhatsapp) setSenderWhatsapp((prev) => prev || saved.customerWhatsapp);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSentNotice(null);
    setSending(true);
    try {
      const res = await fetch('/api/mensagens-dev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName,
          senderWhatsapp,
          category,
          message,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.erro || 'Não foi possível enviar a mensagem.');
        return;
      }
      setMessage('');
      setSentNotice(
        'Mensagem enviada para o desenvolvedor! Ela fica salva com segurança no site por até 5 dias.'
      );
    } catch {
      setErrorMsg('Falha de conexão ao enviar mensagem.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900 ${
        compact ? 'p-5' : 'p-6 sm:p-7'
      } space-y-4`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5 text-[#C8102E]" />
            <h3 className="font-display text-xl font-bold text-white">
              Enviar Mensagem para o Desenvolvedor
            </h3>
          </div>
          <p className="text-xs text-zinc-400">
            Fale diretamente com quem desenvolveu o app sobre dúvidas, suporte ou melhorias.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
          <Clock className="h-3.5 w-3.5 text-amber-400" />
          Auto-exclusão após 5 dias
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="sm:col-span-5">
            <label className="block text-xs font-medium text-zinc-300">Seu nome</label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="Como devemos te chamar"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="sm:col-span-4">
            <label className="block text-xs font-medium text-zinc-300">
              Seu WhatsApp (opcional)
            </label>
            <input
              type="tel"
              maxLength={20}
              value={senderWhatsapp}
              onChange={(e) => setSenderWhatsapp(e.target.value)}
              placeholder="(21) 99999-9999"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-zinc-300">Assunto</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300">Sua mensagem</label>
          <textarea
            required
            minLength={5}
            maxLength={1000}
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Escreva aqui sua mensagem para o desenvolvedor..."
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
          />
        </div>

        {errorMsg && (
          <p className="rounded-lg bg-red-950/70 px-3 py-2 text-xs text-red-300">{errorMsg}</p>
        )}

        {sentNotice && (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-950/60 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{sentNotice}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[11px] text-zinc-500">
            Armazenada no site por 5 dias para análise e removida automaticamente.
          </span>
          <button
            type="submit"
            disabled={sending}
            className="inline-flex items-center gap-2 rounded-lg bg-[#C8102E] px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? 'Enviando...' : 'Enviar para o Desenvolvedor'}
          </button>
        </div>
      </form>
    </div>
  );
}
