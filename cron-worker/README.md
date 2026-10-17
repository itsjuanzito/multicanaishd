# multicanaishd-cron

Worker dedicado aos agendamentos do MultiCanaisHD. Substitui os workflows de cron do GitHub
Actions, que estouravam a cota da conta.

## Por que um Worker separado

O site roda em Cloudflare **Pages**, e Pages não suporta Cron Triggers — é recurso exclusivo
de Workers. Este Worker minúsculo carrega só os agendamentos e chama os endpoints internos
que já existem no site, sem tocar no deploy do `frontend/`.

## Por que saiu do GitHub Actions

O plano Free dá 2.000 minutos/mês em repositórios privados e cobra **1 minuto cheio por job**,
mesmo quando o trabalho é um `curl` de 2 segundos. Os crons somavam ~20.300 execuções/mês —
cerca de 10x o limite. Cron Triggers de Worker não têm esse custo.

## Jobs e cadências

Um único trigger `*/5` dispara o dispatcher; cada job roda na sua própria cadência
(`HTTP_JOBS` em `src/index.js`).

| Job | Cadência | Workflow que substituiu |
|---|---|---|
| `check-status` | 5 min | `check-status.yml` |
| `enrich-catalog` | 10 min | `enrich-catalog.yml` |
| `notificar` | 15 min | `monitor-lancamentos.yml` |
| `reconcile-payments` | 10 min | — |

Todos são um GET autenticado no site. O antigo `refresh-superflix` foi removido: o catálogo
agora vem de `/api/titles/ids` da StreamBetter, carregado pelo próprio site
(`frontend/src/services/superflix-ids.js`).

## Setup

```
cd cron-worker
npm install
npx wrangler kv namespace list          # pegue o id do namespace do binding SESSION
# preencha o id em wrangler.toml
npx wrangler secret put CRON_SECRET     # mesmo valor que o site usa
npx wrangler deploy
```

## Testar sem esperar o horário

```
npx wrangler tail                       # logs ao vivo
curl -H "Authorization: Bearer $CRON_SECRET" https://multicanaishd-cron.<subdominio>.workers.dev
```

O handler `fetch` roda o mesmo ciclo do agendamento e devolve o resultado de cada job —
é o substituto do `workflow_dispatch`.

## Segredos que deixaram de ser necessários

O script antigo escrevia no KV pela API REST, exigindo `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_KV_NAMESPACE_ID` e `CLOUDFLARE_API_TOKEN`. Com o binding, nenhum dos três é
usado — dá pra revogar o API token e apagar os três secrets do GitHub.
