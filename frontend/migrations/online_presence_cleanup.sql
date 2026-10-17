-- Limpeza de online_presence: a tabela recebia um upsert por visitante e nunca era podada,
-- o que esgotou o Disk IO Budget do Supabase. Rodar uma vez no SQL Editor.

-- 1. Remove o acumulado (em lotes menores se a tabela for muito grande, repetir até 0 linhas)
delete from online_presence where last_seen < now() - interval '1 day';

-- 2. Poda recorrente a cada hora via pg_cron (Database > Extensions > pg_cron)
create extension if not exists pg_cron;
select cron.schedule(
    'online-presence-cleanup',
    '0 * * * *',
    $$delete from online_presence where last_seen < now() - interval '1 day'$$
);

-- 3. Recupera o espaço e reconstrói estatísticas (rodar separado, fora de transação)
-- vacuum (analyze) online_presence;
