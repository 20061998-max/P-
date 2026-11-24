export type AppTab = 'inicio' | 'assistir' | 'assinante' | 'admin';

export type SubscriptionStatus = 'ativo' | 'pendente' | 'vencido' | 'bloqueado';

export interface UserProfile {
  id: string;
  nome: string;
  email: string;
  role: 'user' | 'admin';
  status_assinatura: SubscriptionStatus;
  plano: string;
  expira_em: string | null;
  dias_restantes?: number;
  criado_em: string;
}

export interface PaymentLog {
  id: string;
  user_id: string;
  gateway: 'mercadopago' | 'asaas';
  evento_id: string;
  plano: string;
  status: string;
  processado_em: string;
}

export interface VerifySubscriptionResponse {
  ativo: boolean;
  status_assinatura: SubscriptionStatus;
  plano: string | null;
  expira_em: string | null;
  dias_restantes?: number;
  nome: string | null;
}

export function formatDatePtBr(iso: string | null): string {
  if (!iso) return 'Sem validade ativa';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function statusLabel(status: SubscriptionStatus): string {
  switch (status) {
    case 'ativo':
      return 'Ativo';
    case 'pendente':
      return 'Pendente';
    case 'vencido':
      return 'Vencido';
    case 'bloqueado':
      return 'Bloqueado';
  }
}
