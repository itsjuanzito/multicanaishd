# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estrutura do repositório

Monorepo com dois apps independentes — não há `package.json` na raiz; sempre entre na pasta do app antes de rodar comandos:

- `frontend/` — App web Astro 5 SSR (o site de streaming MultiCanaisHD), deploy no Cloudflare Pages/Workers.
- `mobile/` — App Expo/React Native que espelha o comportamento e visual do app web.

## Regras obrigatórias do projeto

**[.agents/rules/code.md](.agents/rules/code.md) é vinculante para toda tarefa neste repositório** — leia antes de fazer qualquer alteração. Cobre o design system (paleta escura `#060911`/`#141414`, destaque `#DF0912` — rebrand V3, era `#FF5555`), o padrão de cadeia de `if` independentes para autorização em `/api/admin/*` (nunca `if/else if/else`), try/catch obrigatório em `await`s de SSR e em cada item de `Promise.all`, limites de tamanho de arquivo/função (500/20 linhas), e regras de SEO/indexação (nunca 5xx pro Googlebot, canonical limpo, sem query params no sitemap).

## Comandos (rodar dentro de `frontend/`)

```
npm run dev              # astro dev, localhost:4321
npm run build             # build de produção — OBRIGATÓRIO passar com zero erros antes de considerar a tarefa concluída
npm run preview           # preview do build de produção
npm run test:unit         # vitest run (testes unitários)
npm run test:unit:watch   # vitest em modo watch
npm run test:e2e          # playwright test (integração/E2E)
npm run test:e2e:ui       # playwright com UI
```

Rodar um único teste Vitest: `npx vitest run caminho/do/arquivo.test.js`
Rodar um único teste Playwright: `npx playwright test caminho/do/arquivo.spec.js -g "nome do teste"`

## Comandos (rodar dentro de `mobile/`)

```
npm start      # expo start
npm run android
npm run ios
npm run web
```

## Arquitetura (frontend)

Astro 5 com `output: "server"`, adapter Cloudflare, i18n (`pt` padrão, `en` com prefixo), Tailwind 4 (sintaxe `@import "tailwindcss"`, não a diretiva antiga `@tailwind`).

Arquitetura em camadas — **componentes/páginas nunca fazem query direta ao Supabase ou TMDB**, sempre passam pelos services:

| Camada | Localização | Responsabilidade |
|---|---|---|
| Stores | `src/store/` | Estado global do cliente via NanoStores (`authStore`, `favoritesStore`, `toastStore`) |
| Services | `src/services/` | Integrações externas: TMDB, Supabase, StreamBetter, Redis (ioredis/Upstash), EPG, logging Axiom, Livepix, Resend |
| Pages/API | `src/pages/api/` | Endpoints REST — orquestram services, nunca fazem queries cruas |
| Components | `src/pages/components/` | UI reutilizável, sem lógica de negócio pesada |

Subsistemas importantes:
- `src/middleware.js` — gate global de requisições: bloqueia user agents de bots ruins (com allowlist de crawlers legítimos de busca/social), redireciona host `pages.dev` para o domínio canônico, bloqueia requisições de prefetch/prerender para economizar cota, e tem um safety net em volta do `await next()` para erros de SSR. Adiciona `X-Robots-Tag: noindex` em rotas internas (`/api/*`, `/player/*`, `/login`, `/perfil`, `/moderacao`, `/results`, `/minha-lista`).
- `src/pages/api/admin/*` — autorização em 4 camadas: bypass localhost → licença B2B → token de sessão VIP → referer do domínio oficial. Cada camada é um `if` independente, nunca uma cadeia `else` (ver regras doc §2.1 — um bug passado causou meses de 403 para usuários não-VIP por causa de um `if/else` chain).
- Stack de player de conteúdo: embed público da StreamBetter (`src/services/streamEmbedService.js`) — filme, série, canal, jogo e evento tocam todos via iframe único (`https://streambetter.shop/...?key=sb_pk_...`), sem seleção de fonte no cliente.
- Cache: L1 em memória via `globalThis._bf_*` (com singleton lock), L2 via Redis/Cloudflare KV para dados semi-estáticos (sitemap TTL 6h, config TTL 10s).

## Stack (não presuma outras libs/métodos)

Astro 5 (SSR, adapter Cloudflare) · Tailwind CSS 4 · Supabase (Postgres) · Redis via ioredis (Upstash) + Cloudflare KV · NanoStores · Axiom (`axiomService.js`) · Vitest + Playwright · Resend (email) · Livepix (pagamentos VIP, PIX/crypto) · StreamBetter (player, embed público via chave `sb_pk_...`) · TMDB (metadados) · `@google/generative-ai`.

Se tiver dúvida se algo existe, verifique `src/services/` em vez de adivinhar.
