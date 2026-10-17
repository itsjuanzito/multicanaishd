-- Adiciona rastreamento de página atual + usuário logado à presença online,
-- usado pelo painel de moderação pra listar o que cada sessão está assistindo agora.
alter table online_presence add column if not exists current_path text;
alter table online_presence add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_online_presence_last_seen on online_presence (last_seen desc);
create index if not exists idx_online_presence_user_id on online_presence (user_id);
