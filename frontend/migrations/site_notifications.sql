create table if not exists site_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  link text,
  created_at timestamptz not null default now()
);

create index if not exists idx_site_notifications_created_at on site_notifications (created_at desc);

-- Leitura pública: o sino de notificações usa o cliente anon (RLS se aplica),
-- o envio usa a service role key no painel de moderação (ignora RLS).
alter table site_notifications enable row level security;

drop policy if exists "site_notifications_public_read" on site_notifications;
create policy "site_notifications_public_read"
  on site_notifications for select
  to anon, authenticated
  using (true);
