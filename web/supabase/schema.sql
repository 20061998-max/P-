-- ============================================================================
-- TelaCast SaaS - Schema SQL + RLS para Supabase (PostgreSQL)
-- ============================================================================

create extension if not exists "pgcrypto";

-- 1. Tabela profiles vinculada ao auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null unique,
  role text not null default 'user' check (role in ('user', 'admin')),
  status_assinatura text not null default 'pendente' check (
    status_assinatura in ('ativo', 'pendente', 'vencido', 'bloqueado')
  ),
  plano text not null default 'Mensal Pro',
  expira_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists idx_profiles_email on public.profiles (email);
create index if not exists idx_profiles_status on public.profiles (status_assinatura);

-- 2. Tabela de auditoria/idempotência de pagamentos (webhooks)
create table if not exists public.pagamentos_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  gateway text not null check (gateway in ('mercadopago', 'asaas')),
  evento_id text not null unique,
  valor_centavos integer not null default 0,
  plano text not null,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  processado_em timestamptz not null default now()
);

-- 3. Função auxiliar segura para checar se usuário autenticado é admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

-- 4. Habilitar Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.pagamentos_log enable row level security;

-- Política: usuário vê apenas o próprio perfil; admin vê todos
create policy "Usuarios veem apenas o proprio perfil"
  on public.profiles
  for select
  using (auth.uid() = id or public.is_admin());

-- Política: usuário pode atualizar apenas o próprio nome (sem escalar role/assinatura)
create policy "Usuarios atualizam proprio nome"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and status_assinatura = (select p.status_assinatura from public.profiles p where p.id = auth.uid())
    and expira_em is not distinct from (select p.expira_em from public.profiles p where p.id = auth.uid())
    and plano = (select p.plano from public.profiles p where p.id = auth.uid())
  );

-- Política: apenas admin pode gerenciar perfis e assinaturas de terceiros
create policy "Admins gerenciam qualquer perfil"
  on public.profiles
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- Política: apenas admins consultam logs de pagamento
create policy "Admins veem logs de pagamento"
  on public.pagamentos_log
  for select
  using (public.is_admin());

-- 5. Trigger para criar perfil automaticamente ao cadastrar no Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nome, email, role, status_assinatura, plano)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    new.email,
    'user',
    'pendente',
    'Mensal Pro'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
