create table if not exists ranking_winners (
  id uuid primary key default gen_random_uuid(),
  season_label text not null,
  position integer not null,
  user_id uuid not null,
  username text not null,
  nickname text,
  avatar text,
  is_vip boolean not null default false,
  vip_plan text,
  total_hours numeric not null default 0,
  movies_count integer not null default 0,
  episodes_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_ranking_winners_season on ranking_winners (season_label, position);

-- Leitura pública: a página de ranking mostra os ganhadores da temporada anterior
-- via cliente anon (RLS se aplica); a gravação usa a service role key no reset de ranking.
alter table ranking_winners enable row level security;

drop policy if exists "ranking_winners_public_read" on ranking_winners;
create policy "ranking_winners_public_read"
  on ranking_winners for select
  to anon, authenticated
  using (true);
