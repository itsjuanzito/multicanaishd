-- Perfis por conta (estilo Netflix) — benefício do MultiCanaisHD VIP Black.
--
-- Antes desta tabela, TODO dado de consumo vivia em colunas planas de `profiles`
-- (favorites, history, watched_movies, watched_episodes). Aqui cada perfil vira uma
-- linha, inclusive o principal — nada de caminho especial pro "perfil original", que
-- é só a linha com is_main = true.
--
-- O que continua na conta (`profiles`) e NÃO se divide por perfil:
--   is_vip / vip_until / pagamentos  -> a assinatura é da conta
--   username / nickname              -> identidade pública única (ranking, comentários)
--   active_seconds / ranking_active_seconds -> ranking é por conta, senão daria pra
--                                              farmar horas em 5 perfis ao mesmo tempo

create table if not exists account_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  avatar text not null default '1',
  is_kids boolean not null default false,
  is_main boolean not null default false,
  favorites jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  watched_movies jsonb not null default '[]'::jsonb,
  watched_episodes jsonb not null default '{}'::jsonb,
  last_update_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_account_profiles_account on account_profiles (account_id, created_at);

-- Exatamente um perfil principal por conta: é o fallback de quem perde o Black.
create unique index if not exists idx_account_profiles_one_main
  on account_profiles (account_id) where is_main;

-- Teto de 5 perfis por conta, aplicado no banco. A UI também limita, mas o cliente
-- fala direto com o Supabase (sem endpoint intermediário), então o limite precisa
-- existir aqui pra não depender da boa-fé do front.
create or replace function enforce_account_profiles_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from account_profiles where account_id = new.account_id) >= 5 then
    raise exception 'PROFILE_LIMIT_REACHED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_account_profiles_limit on account_profiles;
create trigger trg_account_profiles_limit
  before insert on account_profiles
  for each row execute function enforce_account_profiles_limit();

-- O perfil principal nunca pode ser apagado: é pra onde a conta volta quando o Black
-- expira (os extras ficam salvos, apenas bloqueados).
create or replace function protect_main_account_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_main then
    raise exception 'CANNOT_DELETE_MAIN_PROFILE';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_account_profiles_protect_main on account_profiles;
create trigger trg_account_profiles_protect_main
  before delete on account_profiles
  for each row execute function protect_main_account_profile();

-- RLS: o cliente lê e escreve com o token do próprio usuário (mesmo padrão de `profiles`),
-- então cada conta só enxerga os perfis dela.
alter table account_profiles enable row level security;

drop policy if exists "account_profiles_owner_select" on account_profiles;
create policy "account_profiles_owner_select"
  on account_profiles for select
  to authenticated
  using (account_id = auth.uid());

drop policy if exists "account_profiles_owner_insert" on account_profiles;
create policy "account_profiles_owner_insert"
  on account_profiles for insert
  to authenticated
  with check (account_id = auth.uid());

drop policy if exists "account_profiles_owner_update" on account_profiles;
create policy "account_profiles_owner_update"
  on account_profiles for update
  to authenticated
  using (account_id = auth.uid())
  with check (account_id = auth.uid());

drop policy if exists "account_profiles_owner_delete" on account_profiles;
create policy "account_profiles_owner_delete"
  on account_profiles for delete
  to authenticated
  using (account_id = auth.uid());

-- Backfill: cada conta existente ganha seu perfil principal já com o histórico atual.
-- Sem isso o usuário abriria o site e veria a lista e o histórico vazios.
-- O trigger de limite roda em INSERT, então contas sem perfil algum passam numa boa.
--
-- As chaves com "_" no início de watched_episodes (_nickname, _nickname_changes_count,
-- _vip_nickname_changes_count, _active_seconds) NÃO vêm junto: são identidade/contadores
-- da conta, não episódios vistos. Elas continuam morando só em `profiles.watched_episodes`
-- — se fossem copiadas, cada perfil passaria a ter seu próprio nickname.
insert into account_profiles (account_id, name, avatar, is_main, favorites, history, watched_movies, watched_episodes)
select
  p.id,
  coalesce(nullif(trim(p.username), ''), split_part(p.email, '@', 1), 'Perfil 1'),
  coalesce(p.avatar, '1'),
  true,
  coalesce(p.favorites, '[]'::jsonb),
  coalesce(p.history, '[]'::jsonb),
  coalesce(p.watched_movies, '[]'::jsonb),
  (
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(coalesce(p.watched_episodes, '{}'::jsonb)) as e
    where left(e.key, 1) <> '_'
  )
from profiles p
where not exists (
  select 1 from account_profiles ap where ap.account_id = p.id
);

-- Realtime: o cliente escuta UPDATE da linha do perfil ativo pra sincronizar entre abas
-- e dispositivos, igual já fazia com `profiles`. Idempotente pra migration poder rerodar.
do $$
begin
  alter publication supabase_realtime add table account_profiles;
exception
  when duplicate_object then null;
end;
$$;
