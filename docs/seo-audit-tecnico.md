# Auditoria técnica de SEO e Indexação — MultiCanaisHD

**Data:** 16/10/2026 · **Domínio canônico:** `multicanaishd.lol` · **Escopo:** `frontend/` (Astro 5 SSR + Cloudflare)

Este documento é o resultado de uma auditoria feita **contra o site em produção** (requisições reais
como Googlebot, leitura dos XMLs servidos, medição de status HTTP de todas as URLs do sitemap) e por
leitura do código. Tudo que está marcado como "medido" foi observado ao vivo; o resto é derivado do
código.

---

## 1. Resumo executivo

O sitemap **está tecnicamente correto e acessível** (HTTP 200, XML válido, host canônico, sem query
params, sem `noindex`). O problema de "não funciona no Search Console" **não é o arquivo** — é
(provavelmente) uma submissão antiga e o fato de o sitemap anunciar URLs que **outra camada do
próprio site bloqueia**.

Foram encontrados **quatro defeitos estruturais** que explicam boa parte das linhas da tela
"Indexação das páginas":

| # | Defeito | Sintoma no Search Console |
|---|---|---|
| 1 | Toda URL respondia **200 com e sem barra final**, cada uma com canonical própria | URLs duplicadas, espaço de rastreamento dobrado |
| 2 | O sitemap e os `hreflang` anunciam URLs que o **Cloudflare bloqueia com 451** | "Bloqueada devido a outro problema 4xx" |
| 3 | `hreflang` de `/filme/*` e `/serie/*` espelha o slug do idioma atual | "Página com redirecionamento" em massa |
| 4 | Sitemap cobre ~647 títulos de um catálogo de ~43 mil | "Rastreada, mas não indexada no momento" |
| 5 | **O cron-worker inteiro estava morto** — apontava para um domínio NXDOMAIN | Enriquecimento do catálogo parado; reconciliação de pagamento e notificações também |

Além disso: `/[slug]` transformava falha transitória do TMDB em **404 permanente**, `/genero/*`
servia **soft 404** indexável, e três serviços derrubavam rotas públicas com **500**.

---

## 2. O que foi corrigido nesta sessão

Todas as correções foram validadas com `npm run build` (zero erros) e testadas no worker de produção
real (`wrangler pages dev dist`), não só em dev — o desvio de barra final, por exemplo, **só** existe
no worker compilado.

### 2.1 URLs duplicadas por barra final — corrigido

**Antes (medido em produção):**

```
/serie/94664-mushoku-tensei-jobless-reincarnation-1   → 200, canonical = .../...-1
/serie/94664-mushoku-tensei-jobless-reincarnation-1/  → 200, canonical = .../...-1/   ← outra URL
/genero/acao/                                         → 200, canonical = /genero/acao/
```

`trailingSlash` estava no padrão `"ignore"`: as duas variantes eram páginas distintas, cada uma
declarando-se canônica. Isso **dobrava o espaço de rastreamento do site inteiro**.

**Correção:** `trailingSlash: "never"` em `frontend/astro.config.mjs`. O próprio Astro passa a
responder 301 (`astro/dist/core/app/index.js:296-324`).

**Depois (medido no worker de produção):**

```
/genero/acao/       → 301  Location: /genero/acao
/filmes-online/     → 301  Location: /filmes-online
/vip/               → 301  Location: /vip
/genero/acao        → 200
```

Links internos que apontavam para `/en/` (que agora redireciona) foram corrigidos para `/en`:
`components/Navigation.astro`, `components/EpisodioPage.astro`, `components/SeoLandingPage.astro`,
`components/FutebolHub.astro`, `pages/canal/[slug].astro`, `pages/genero/[id].astro`,
`utils/upstreamUnavailable.js`. **Medido:** `/en/calendario` hoje tem 74 links internos `/en/...` e
**zero** links PT — antes todos apontavam para a versão em português.

### 2.2 `/[slug]` desindexava URL válida por falha transitória — corrigido

`frontend/src/pages/[slug].astro` usava `.catch(() => null)` e depois tratava `null` como
"não existe" → **404 permanente**. Mas `getTMDBDetails` devolve `{ notFound: true }` (objeto) quando o
TMDB confirma que o id não existe (`services/tmdb.js:315-324`) e **lança** em timeout/429/5xx.

**Correção:** falha transitória → `upstreamUnavailableResponse(lang)` (200 + `noindex`, a URL volta ao
índice sozinha no próximo rastreamento); 404 só quando o TMDB confirma ausência. Também trocado
`slugify()` por `contentSlug()` na montagem do destino do 301 — `slugify` devolve string **vazia** para
título em script não-latino, gerando destinos como `/serie/123-` que exigiam um segundo 301.

### 2.3 Soft 404 em `/genero/*` — corrigido

`/genero/qualquer-coisa-inventada` renderizava a página completa, com título/description, canonical
própria e "Nenhum título encontrado" — **com HTTP 200**. A lista de slugs adivinháveis é infinita.

**Correção em `frontend/src/pages/genero/[id].astro`:**
- slug desconhecido (não está em `utils/genres.js` e não é id numérico) → **404**;
- origem/cache indisponível → 200 + `noindex` (nunca 404: a URL é válida);
- gênero realmente vazio → **404**;
- quando o cache de disponibilidade está frio, a página usa o mesmo *fallback sem filtro* que
  `api/explore.js` e `api/discover.js` já usavam, em vez de renderizar vazio.

**Medido:** `/genero/nao-existe-xyz` → **404** (antes 200); `/genero/acao` → 200 com 18 cards;
`/genero/anime` → 200; `/en/genero/acao?page=2` → 200.

> Bônus: `/en/genero/[slug]` descartava a query string, então **a paginação em inglês não existia**.
> Corrigido.

### 2.4 5xx em rotas públicas — corrigido (§2.2 das regras do projeto)

`getSuperflixIds()` era o único item de `Promise.all` sem `.catch()` em três lugares. Uma falha dele
rejeitava o `Promise.all` inteiro:

- `pages/api/explore.js:83-86` → **500** num endpoint que o Googlebot rastreia;
- `pages/api/discover.js:74-77` → **500**;
- `services/trendingService.js:99-102` → home sem hero e sem Top 10.

Corrigido com `getSuperflixIds().catch(() => null)`; os três já tinham o caminho "sem filtro" pronto.

### 2.5 Outras correções aplicadas

| Arquivo | Correção |
|---|---|
| `pages/404.astro:14` | `fetchTrending()` sem `.catch()` fazia o safety net do middleware devolver **200** "Erro Interno" em **toda** página 404 — o Google parava de remover URLs mortas |
| `services/sitemapService.js` (`gerarEGravarLotes`) | Geração **degradada** (sem entradas dinâmicas) era gravada no KV e substituía por 6h um sitemap bom por um com ~25 páginas. O flag `degradado` era calculado e **nunca consumido**. Agora não sobrescreve o cache |
| `services/content-lists.js:133` | `.sort(() => Math.random() - 0.5)` fazia o conjunto de 16 títulos **mudar a cada recrawl** (TTL 5 min) — conteúdo instável, pior que duplicado. Agora ordenação determinística (tem-player → nota). `console.log` de produção removido |
| `pages/calendario.astro:61-65` | `buildPlayerUrl` não usava `langPrefix`: em `/en/calendario` todos os cards apontavam para URLs PT |
| `pages/genero/[id].astro` | JSON-LD usava `Astro.url.href` (com `?page=`) divergindo do `<link rel="canonical">`; cópia local de `slugify` trocada pela fonte única `contentSlug` |

### 2.6 Novo: verificação e rotação em lote das URLs bloqueadas (painel)

Em **/moderacao → Substituição & rotação de URL** há agora um bloco **"URLs bloqueadas por
notificação (451)"** com dois botões:

- **Verificar bloqueios** — testa o endereço **atual** de cada rotação e lista as que não respondem 200.
- **Rotacionar bloqueadas** — rotaciona em lote (reusa `POST /api/admin/url-rotations`, que já
  invalida o cache do sitemap no fim) só as obras que responderam **451**.

**Como a detecção funciona (e por que no navegador):** o Cloudflare responde 451 **antes** da
requisição chegar no Worker — o servidor não vê a requisição, então não tem como saber quais URLs
estão bloqueadas. O navegador do painel tem: `/moderacao` e `/serie/...` são o mesmo domínio, logo
cada `HEAD` disparado dali passa pelo WAF igual a uma visita normal e o status é legível (same-origin,
sem CORS). É por isso que a verificação é client-side e não um endpoint de servidor.

**Limite conhecido, avisado na própria UI:** a rotação só altera o slug **pt-BR**
(`filme/[slug].astro:204-206`). Se o 451 caiu na URL `/en/` da obra — que tem slug próprio, derivado do
nome em inglês — este botão **não** a move; a regra correspondente precisa ser revista no painel do
Cloudflare. Das 52 URLs medidas, 45 são PT (resolvidas pelo botão) e 7 são `/en`.

---

## 2.7 a 2.12 — Segunda rodada de correções

### 2.7 CRÍTICO — o cron-worker inteiro estava parado (domínio NXDOMAIN)

`cron-worker/src/index.js` tinha `SITE_URL = 'https://multicanaishd.lol'` chumbado. Medido:

```
nslookup multicanaishd.lol  →  *** Non-existent domain
curl https://multicanaishd.lol/robots.txt → Could not resolve host
```

O domínio **não existe mais** (migração para `.lol`). Como todo job passa por esse `SITE_URL`,
os **quatro** jobs morriam no DNS antes de chegar no site: `check-status` (5 min),
`enrich-catalog` (10 min), `notificar` (15 min) e `reconcile-payments` (10 min).

**Consequência direta na indexação:** o `enrich-catalog` é quem alimenta o catálogo do sitemap.
Parado, o catálogo enriquecido ficou congelado em **~167 títulos** — é essa a razão da cobertura
de ~647 títulos, não um defeito do código do sitemap (que já consumia o catálogo enriquecido
corretamente).

**Corrigido:** `SITE_URL` agora vem de `env.SITE_URL` com fallback `https://multicanaishd.lol`, e o
tick loga o alvo (`[Cron] alvo=...`) — sem isso, um domínio morto aparece só como quatro
`fetch failed` genéricos. Também corrigidos os mesmos resíduos em
`.github/workflows/enrich-catalog.yml` (apontava para `multicanaishd.lol`), `mobile/src/utils/profile.ts`
(`multicanaishd.lol`) e no `manifest.json` da extensão de Discord Presence (`multicanaishd.lol`).

### 2.8 hreflang de conteúdo resolvido de verdade (não espelhado)

`SEO.astro` montava `ptUrl`/`enUrl` espelhando o path e trocando o prefixo `/en`. Como o slug
canônico de `/filme`, `/serie` e episódio **depende do idioma**, o alternate do outro idioma
apontava para uma URL que responde 301 — e o Google descarta o par de idiomas inteiro.

**Corrigido com um mapa de slugs pt/en** (`services/contentSlugPairs.js`): a geração do sitemap,
que já calculava os dois slugs para cada item, agora grava um blob por host no KV
(`slug_pairs_v1:<host>`, TTL 6h). A página lê esse blob (uma leitura por isolate, com cache L1 e
recuo) e passa as URLs reais por `alternates` ao `SEO.astro`.

Sem o mapa, a página **omite** o alternate — mesmo critério conservador que o sitemap já usava
("melhor não anunciar do que anunciar URL que redireciona").

A decisão virou função pura (`utils/hreflang.js`) e está testada, porque a sutileza é justamente
o que quebra: `alternates` **ausente** = a rota não sabe (hub/gênero/canal) → espelha, que ali é
correto; `alternates` **presente com os dois lados nulos** = a rota confirma que não sabe →
omite. Tratar os dois como iguais foi o bug de uma versão intermediária desta própria correção.

### 2.9 JSON-LD e redirect de idioma apontando para o PT

Em `/en/*`, `Astro.url.pathname` é o path **PT** (a rota /en reescreve para a PT com `?lang=en`).
Três lugares usavam `${siteUrl}${Astro.url.pathname}` e declaravam URL em português numa página
inglesa: `urlTemplate` e breadcrumb do JSON-LD de filme e série. Pior: o redirect que limpa
parâmetro de tracking mandava `/en/filme/x?fbclid=…` para `/filme/x` — o oposto do canônico que
a própria página declara. Todos passaram a usar `langPrefix`.

### 2.10 Soft 404 de episódio inexistente → 404 real

`getTMDBSeasonDetails` lançava em qualquer `!res.ok`, então "a temporada não existe" (404 do
TMDB) era indistinguível de timeout. O serviço não tinha como separar os casos e devolvia
`tipo: "ok"` com lista vazia → a rota renderizava **200 indexável**, self-canonical, com título
"Episódio N" e nenhum episódio. Como o guard só limita 1..200 de temporada por 1..20000 de
episódio, eram milhões de URLs de soft 404 por série.

Agora `getTMDBSeasonDetails` marca `{ notFound: true }` no 404 e o serviço responde **404** só
nesse caso; falha transitória continua sendo 200 + noindex (nunca 404 — a regra que já custou
3.506 erros no Search Console).

### 2.11 Paginação de `/genero` passou a ser crawlável

O SSR já sabia paginar (`?page=N`), mas o único controle era um `<button>` **sem href**: o
Googlebot via 20 títulos por gênero e o resto do catálogo dependia 100% do sitemap. Virou
`<a href="?page=N+1" rel="next">`, com `preventDefault` mantendo o carregamento por API para o
usuário. Dois bugs antigos caíram junto: `data-next-page` estava fixo em 6 (da página 2 em diante
o "Carregar mais" repetia o mesmo bloco) e anime paginava em unidade diferente de filme/série
(agora `data-step` distingue); o spinner de "Fim dos resultados" também ficava girando para sempre.

### 2.12 Sitemap: canal de ID numérico canonicalizado + geração que não acumula memória

- `/canal/<id-numérico>` respondia 200 com canonical própria, concorrendo com `/canal/<nome>`.
  Agora 301 para o slug do nome. Slugs de jogo (`jogo-*`, `a-x-b`) ficaram de fora de propósito:
  são efêmeros e já saem com noindex.
- `gerarEGravarLotes` montava **todos** os XMLs em memória antes do primeiro `put`. Com os ~43 mil
  títulos que o enriquecimento agora vai alcançar, são dezenas de MB de string contra o limite de
  128 MB do Worker — o sitemap começaria a falhar justamente ao ficar completo. Passou a renderizar
  e gravar **um lote por vez**, e a chave `total` (o ponteiro que o índice usa) só é gravada depois
  que todos os lotes foram gravados, para o índice nunca anunciar um `/sitemap-N.xml` que responde
  404.

### 2.13 URLs de episódio agora entram no sitemap

`/serie/{slug}/temporada-N/episodio-M` existia, era self-canonical, tinha título/sinopse/schema
próprios e era linkada pela página da série — mas **nenhuma** era anunciada. Para um site de
streaming, "assistir <série> episódio N dublado" é uma fatia real de busca.

**Por que não entram todas:** o catálogo tem ~12,6 mil séries; todo episódio de toda série são
milhões de URLs, acima do limite de 50 mil por arquivo do protocolo e inviável de gerar no
Worker. O corte é por valor e por custo:

- só séries **atualmente no ar** (fonte `tv/on_the_air`) — ninguém busca "série cancelada em
  2011 temporada 3 episódio 7";
- teto de séries por geração (2 chamadas ao TMDB cada): `SITEMAP_EPISODIOS_MAX_SERIES` (padrão 25);
- teto de episódios por série, para novela de 1.500 capítulos não dominar o arquivo:
  `SITEMAP_EPISODIOS_POR_SERIE` (padrão 30);
- só a temporada mais recente, ignorando a temporada 0 (extras).

O slug da URL do episódio vem do **mesmo mapa** `paresDeSlug` que a entrada da série usa, então é
impossível o sitemap anunciar uma URL que a rota responde 301. Sem o par conhecido, a série é
pulada em vez de chutada. Resultado medido localmente: **+884 URLs de episódio** (2.286 `<loc>` no
lote, contra 1.290 antes), com o alternate correto — PT `/serie/247718-terra-da-mafia/…` ↔ EN
`/en/serie/247718-mobland/…`, que é justamente onde o espelhamento de path erraria.

**Efeito colateral tratado:** a geração foi de ~2,2s para ~9,2s (as chamadas extras ao TMDB).
Como o cache do sitemap dura 6h, quem pagava esse tempo era a **primeira** requisição depois do
TTL — normalmente o Googlebot, e sitemap lento demais vira "não foi possível buscar" no Search
Console. Foi adicionado um job `sitemap-warm` no cron-worker (a cada 5h, abaixo do TTL de 6h)
que regenera o cache fora do caminho do crawler.

### 2.14 Preciso mexer em `SITE_URL` para trocar de domínio?

Em parte. `getSiteUrl()` é a fonte única de canonical, `hreflang`, JSON-LD, `robots.txt` e
sitemap, e as chaves de cache são **por host** (`sitemap_v5:<host>`, `slug_pairs_v1:<host>`), o
que faz o cache se invalidar sozinho na troca. Mas há literais que **não** acompanham:

| Arquivo | O que é | Por que importa |
|---|---|---|
| `frontend/src/services/canonicalHost.js:14` | `HOSTS_LEGADOS` | **O mais crítico.** O domínio atual precisa ser ACRESCENTADO à lista, senão o domínio antigo deixa de responder 301 para o novo e as duas propriedades passam a concorrer no índice |
| `frontend/src/services/env-adapter.js:103` | `DEFAULT_SITE_URL` | Fallback quando não há env nem URL de requisição (ex.: crons) |
| `frontend/astro.config.mjs:43` | `site:` | Fallback de build |
| `cron-worker/wrangler.toml` | `[vars] SITE_URL` | Os jobs apontam para cá |
| `.github/workflows/enrich-catalog.yml` | URL do curl | Disparo manual |
| `mobile/src/utils/profile.ts` | `SITE_URL` | Avatares no app |
| `discord-presence/extension/manifest.json` | `host_permissions` | Extensão só roda no domínio listado |

Fora do repositório: propriedade + sitemap no Search Console, domínio customizado no Cloudflare
Pages, URLs de redirect no Supabase Auth, **URL de webhook dos provedores de pagamento ATIVOS**
(VeloraPay e, se estiver em uso, NOWPayments — LivePix e Discord foram descontinuados), e a
aprovação da zona de anúncio no Monetag (que é por domínio).

### 2.15 Os bloqueios legais são replicados ZONA A ZONA (e o `.homes` ficou de fora)

Medição do mesmo caminho notificado em cada domínio:

| Domínio | Resposta |
|---|---|
| `multicanaishd.lol` | **451** |
| `multicanaishd.lol` | **451** |
| `multicanaishd.lol` | **451** |
| `multicanaishd.lol` | 301 (nunca teve) |
| `multicanaishd.lol` | **200 — as regras não foram replicadas** |

Três zonas seguidas com a mesma regra, e a mais antiga (`.click`) sem ela: isso mostra que alguém
vinha **portando as regras a cada migração de domínio**. Não é bloqueio automático da Cloudflare —
ninguém replicaria regra por caminho específico em três zonas. O `error code: 1026` que a resposta
devolve **não existe na lista pública de erros da Cloudflare** (o índice vai de 1000 a 1041 e
1101 a 1204), o que confirma ser uma resposta customizada de regra de WAF.

Consequência no `.homes`: o conteúdo notificado está no ar (200) e **sendo anunciado no sitemap**.
Replicar as regras na zona do `.homes` é o passo mais urgente da migração — mais que qualquer item
de SEO. Não consegui ler as regras para portar automaticamente: o token do `wrangler` não tem
permissão de leitura de WAF (403 no endpoint de rulesets).

### 2.16 Cuidado com POST em URL de domínio legado

Medido durante a migração:

```
POST https://multicanaishd.lol/api/webhooks/velorapay    → 301   (o corpo do POST se perde)
POST https://multicanaishd.lol/api/webhooks/velorapay  → 401   (chega no app, auth correta)
```

Um `301` em POST faz a maioria dos clientes refazer a requisição como GET, **descartando o corpo** —
o webhook nunca chega ao app. É literalmente o incidente já documentado em
`cron-worker/src/index.js` ("Foi um 301 desses, na URL cadastrada no painel do LivePix, que derrubou
o webhook de pagamento em setembro/2026").

Agravante que não existe hoje, mas vale saber: a rede de segurança cobre isso —
`api/internal/reconcile-payments.js` roda a cada 10 min e reconfirma na API da **VeloraPay**. O
efeito de uma URL de webhook desatualizada é **atraso de até 10 minutos**, não pagamento perdido.
Mesmo assim, a URL no painel do provedor deve apontar para o domínio canônico: depender da rede de
segurança esconde a falha em vez de corrigi-la.


**Resumo:** `SITE_URL` resolve tudo que o app emite; a lista acima é o que precisa de mão humana.

---

## 3. Achados **não** corrigidos (exigem decisão sua)

### 3.1 CRÍTICO — 451 do Cloudflare em URLs que o site anuncia como canônicas

**Isto é o achado mais grave e não está no repositório.**

Medição de **todas** as URLs de conteúdo do sitemap:

| Conjunto | 200 | 451 | 301 | 404 |
|---|---|---|---|---|
| PT (`/filme/`, `/serie/`) — 723 URLs | 677 | **45** | 1 | 0 |
| `/en/*` — 491 URLs | 483 | **7** | 0 | **1** |

O `451` **não vem do app** (não existe `451` em nenhum lugar do `src/`). A resposta é do Cloudflare:

```
HTTP/1.1 451 Unavailable For Legal Reasons
Content-Type: text/plain; charset=UTF-8
Content-Length: 17
Server: cloudflare

error code: 1026
```

São regras de WAF/legal block do painel do Cloudflare, aplicadas a **caminhos exatos**. Exemplos
medidos:

```
/serie/57041-gintama            → 301 → /serie/57041-gintama-1 → 451   ← o canônico é o bloqueado
/serie/95479-jujutsu-kaisen     → 451                                  ← canônico bloqueado
/serie/95479-jujutsu-kaisen/    → 200                                  ← mesma página, sem barra, passa
/en/serie/65733-doraemon        → 451                                  ← o /en da obra, slug diferente
/serie/65733-doraemon-o-gato-do-futuro → 200                           ← a página PT em si está OK
```

**Causa raiz (operacional, não de código).** Existem dois mecanismos de anti-DMCA que não conversam:

1. **Cloudflare WAF** (fora do repositório) → responde 451 no caminho exato da notificação.
2. **`services/urlRotationService.js`** (no banco) → cria `${slug}-${n}` e responde 301.

O bloqueio chega **depois** da última rotação, então o slug que o banco considera **atual** é
justamente o que o Cloudflare bloqueia. Como ninguém rotaciona de novo, o sitemap e o `hreflang`
seguem anunciando ao Google a URL bloqueada.

**Solução implementada:** o painel de moderação agora detecta e rotaciona em lote (§2.6). Rotacionar
move o canônico para um slug livre, que volta a responder 200 e é anunciado no sitemap (o cache é
invalidado na hora).

**Solução considerada e descartada (com o dono do projeto):** trazer o bloqueio para dentro do app —
uma tabela `legal_blocks`, a rota respondendo 451 pelo próprio app e o sitemap/hreflang omitindo a URL
automaticamente. Foi implementada e depois removida por decisão explícita: o dono **não quer** um
mecanismo de bloqueio no app, quer apenas **ver e resolver** os bloqueios que o Cloudflare já aplica.
Enquanto o bloqueio morar só no WAF, o sitemap não tem como respeitá-lo sozinho — daí a verificação
sob demanda no painel.

**Contrapartida a considerar:** cada rotação zera o histórico da URL (a nova nasce sem cliques,
posição ou links) e deixa mais um 301 para trás. "Volta a indexar" **não** é o mesmo que "volta a
ranquear". Se a intenção for manter a obra fora do índice de forma limpa e auditável, a arquitetura do
app-side block é o caminho — ela está descrita acima caso a decisão mude.


### 3.2 ✅ RESOLVIDO — `hreflang` de conteúdo apontava para URL que responde 301

Ver §2.8. Era o achado mais sistemático da auditoria: `components/SEO.astro` montava as duas URLs
espelhando o **mesmo** path e só trocando o prefixo `/en`. Como o slug canônico PT e o EN do mesmo
título diferem em boa parte do catálogo, o alternate do outro idioma caía no 301 da rota de destino
(exemplo real: `/filme/598-cidade-de-deus` declarava `hreflang="en"` apontando para
`/en/filme/598-cidade-de-deus`, enquanto o canônico EN é `/en/filme/598-city-of-god`) — e o Google
descarta o par de idiomas inteiro quando o alternate não responde 200.

Hoje as rotas de conteúdo passam os slugs reais (`services/contentSlugPairs.js`) e a decisão vive em
`utils/hreflang.js`, coberta por teste. Continua valendo para **qualquer rota de conteúdo nova**:
passar `alternates` ao `BaseLayout`, não confiar no espelhamento.

### 3.3 ALTO — Cobertura do sitemap: ~647 títulos de ~43 mil

O índice de sitemap tem **1 lote** com **1.291 URLs** (medido). Dessas, ~531 são páginas de conteúdo.

A fonte dinâmica é só `TMDB_SITEMAP_PAGES = 4` (`services/sitemapXml.js:14`) × 6 listas
(popular / top_rated / now_playing / tv popular / tv top_rated / tv on_the_air) — ordem de grandeza de
algumas centenas de títulos.

O catálogo real de disponibilidade, medido no log do próprio serviço, é **30.942 filmes + 12.638
séries**. Ou seja: **o sitemap anuncia ~1,5% do catálogo**. É uma explicação direta para
"Rastreada, mas não indexada no momento: 4.660" — o Google encontra páginas por links internos, não
pelo sitemap.

`getEnrichedCatalogEntries()` e `getContentList()` contribuem pouco hoje (o lote local saiu com 1.290
URLs, praticamente igual ao de produção).

**Causa raiz (encontrada na segunda rodada): não é o código do sitemap — é o cron que alimenta o
catálogo.** O sitemap já consome `getEnrichedCatalogEntries()`; o que estava parado era o
`enrich-catalog`, porque o cron-worker inteiro apontava para `multicanaishd.lol` (domínio NXDOMAIN,
ver §2.7). Com o cron consertado, o enriquecimento volta a andar a 80 títulos por execução, a cada
10 minutos (~11,5 mil/dia), e o catálogo chega aos ~43 mil em cerca de 4 dias — **sem nova mudança de
código no sitemap**.

Consequência de desenho que precisa de atenção durante esse crescimento: o Google vai receber de uma
vez um sitemap que sai de 1,3 mil para dezenas de milhares de URLs. Isso é o objetivo, mas vale
acompanhar as métricas de rastreamento nas primeiras semanas, e não existe hoje nenhum sinal de
"cobertura do sitemap" no painel — só o log do endpoint de enriquecimento.


### 3.4 MÉDIO — pendências que continuam abertas

| Achado | Onde | Impacto |
|---|---|---|
| `/ranking` é 100% client-side e o SSR só tem `<a href="#">` (link morto) | `pages/ranking.astro:82, 307, 464` | Hub que não descobre nada e expõe link quebrado |
| Hubs SEO expõem só 18 links e não têm paginação | `components/SeoLandingPage.astro:180` | 4 hubs × 18 links, com forte sobreposição entre si e com `/explorar` |
| Canal fixo com origem fora → 200 indexável "Transmissão Encerrada" | `pages/canal/[slug].astro:126-149` | Conteúdo contraditório durante instabilidade. **Decisão documentada no próprio arquivo**: o noindex ali já causou desindexação de canais reais (SBT, ESPN) numa instabilidade passageira, então a alternativa é pior. Deixei como está. |
| Cache de borda `s-maxage=3600` mantém slug rotacionado como 200 por até 1h | `filme/[slug].astro:8-11`, `serie/[slug].astro:8-11` | URL denunciada continua servível após a rotação |
| `slugify()` num `<script is:inline>` do carrossel personalizado | `pages/index.astro:599,625` | Único ponto restante de link `/serie/123-`. O script **não passa pelo Vite**, então não dá para importar `contentSlug` sem reestruturar (bundlar o script ou expor em `window`). Impacto de SEO ~zero: o carrossel depende de histórico de exibição, e crawler não tem histórico. |
| Não existe hub `/genero` | — | 25 páginas de gênero dependem só do sitemap |
| `sitemapService.js` está com ~570 linhas | `services/sitemapService.js` | Acima do teto de 500 do `code.md`. Já estava estourado antes desta auditoria; o próximo passo natural é extrair `fetchMassiveTMDB` para um módulo próprio. |

### 3.5 Fora do escopo de SEO, mas achado no caminho

`tests/integration/referral.test.js` importa `src/services/affiliateService.js`, que foi **removido** no
commit `bdfa47a` ("feat(v3): remove sistema de indicações e a venda self-service de chaves B2B"). O
teste ficou órfão e **quebra o `npm run test:unit` inteiro** (erro de resolução de import, exit 1),
mascarando qualquer regressão real nos outros 193 testes. Não removi porque apagar teste não é decisão
minha — mas é uma linha de limpeza que vale fazer.

---

## 4. Sobre o "sitemap não funciona no Search Console"

O sitemap, medido agora com User-Agent de Googlebot:

```
https://multicanaishd.lol/sitemap.xml    → 200, application/xml, X-Sitemap-Cache: HIT, 198 bytes
https://multicanaishd.lol/sitemap-1.xml  → 200, 766 KB, 1.294 <loc>, XML bem-formado
robots.txt                            → "Sitemap: https://multicanaishd.lol/sitemap.xml"  ✓
http://multicanaishd.lol/sitemap.xml     → 200 (sem redirect cross-domain)
multicanaishd.lol / .lat / .click        → 301 → multicanaishd.lol ✓ (consolidação correta)
www.multicanaishd.lol                    → 522  ✗ (sem origem — ver abaixo)
```

Verificado: XML válido (parseado), URLs absolutas, mesmo host, sem query params, sem `lastmod`
inválido, `Content-Type` correto, nada bloqueado pelo `robots.txt`, e a rota de sitemap está
explicitamente excluída do filtro de assets do middleware.

**Como o arquivo está tecnicamente correto, as explicações prováveis para o erro no GSC são, em
ordem:**

1. **Submissão antiga.** O sitemap já foi um arquivo único de 8,7 MB com 22 mil URLs, e o comentário
   em `services/sitemapService.js:46-49` registra que ele já anunciou URLs do domínio **`.cfd`** —
   o Search Console **recusa um sitemap com URLs de outra propriedade**. Se a entrada no GSC é dessa
   época, o status de erro fica congelado até o Google re-rastrear.
   **Ação:** em *Sitemaps*, remover `sitemap.xml` e adicionar de novo `https://multicanaishd.lol/sitemap.xml`,
   depois usar **"Testar sitemap ao vivo"**. O teste ao vivo busca na hora e mostra quantas URLs foram
   lidas — é o diagnóstico definitivo.

2. **`www.multicanaishd.lol` responde 522** (mediado agora). Se em algum momento foi submetido o sitemap
   em `www`, o Google recebe erro de servidor. O `www` precisa de um registro DNS/CNAME funcional ou
   de uma regra de redirect no Cloudflare. **Vale conferir isso hoje** — 522 em qualquer variante do
   domínio também entra no relatório como erro de servidor.

3. **Excesso de 451 no sitemap** (52 URLs de conteúdo). Isso não impede a leitura do arquivo, mas o
   Search Console reporta as URLs individualmente e derruba a confiança no sitemap. Resolver o item
   §3.1 melhora o número.

Uma observação importante: **o sitemap ser aceito não resolve a indexação.** As linhas da sua tela
têm causas distintas, e cada uma precisa da correção correspondente: duplicata de barra final (§2.1),
`hreflang`→301 (§2.8), 451 (§3.1) e cobertura (§3.3).

---

## 5. Prioridade sugerida

Já corrigido e verificado (build limpo, 209 testes passando, sem publicação):
§2.1 a §2.14 — barra final, `hreflang`, JSON-LD de `/en`, soft 404 de gênero e de episódio, 5xx,
sitemap degradado/memória, paginação de `/genero`, canonical de `/canal`, links internos de `/en`,
ordem determinística das listas, painel de bloqueio legal, **o cron-worker morto** e as **URLs de
episódio no sitemap**.

O que falta, em ordem de impacto:

1. **Publicar.** Nada disso está no ar até um push no `main` — e o cron-worker tem deploy próprio
   (`wrangler deploy` em `cron-worker/`). Sem isso, o cron continua morto e o catálogo do sitemap
   continua congelado.
2. **Verificar o `www` (522)** e **re-submeter o sitemap** com "Testar sitemap ao vivo".
3. **Conferir `/api/internal/enrich-catalog`** depois do deploy: a resposta deve crescer o
   `processed` a cada 10 min. O catálogo leva ~4 dias para chegar aos ~43 mil títulos
   (80 por execução × 6/hora ≈ 11,5 mil/dia).
4. **Abrir /moderacao → "Verificar bloqueios"** e rodar "Rotacionar bloqueadas" — tira as 45 URLs 451
   do PT do sitemap. As 7 de `/en` dependem de revisão das regras no Cloudflare (§3.1).
5. **Ler `Segurança e ações manuais` e `Core Web Vitals` no Search Console.** O primeiro decide se
   o trabalho técnico tem como surtir efeito; o segundo é a lacuna que esta auditoria não cobriu
   (a home entrega ~626 KB de HTML, o que sugere LCP ruim).
6. `/ranking` com SSR e hubs com paginação (§3.4).

**Antes de qualquer coisa:** conferir **Segurança e ações manuais** no Search Console. Se houver ação
manual, trocar de domínio **não** resolve — leva o problema junto, e o domínio novo ainda começa com
zero autoridade (o cenário esperado é queda, não recuperação).

---

## 6. Como reproduzir as medições

O script usado para testar o status HTTP de todas as URLs do sitemap ficou em
`scratch/seo-check-status.mjs`:

```bash
# extrai as URLs de um lote do sitemap
curl -s https://multicanaishd.lol/sitemap-1.xml | grep -o '<loc>[^<]*' | sed 's/<loc>//' > urls.txt
node scratch/seo-check-status.mjs urls.txt 16
```

Para validar localmente **o comportamento de produção** (o desvio de barra final não existe no
`astro dev`, só no worker compilado):

```bash
cd frontend && npm run build
npx wrangler pages dev dist --port 4322
curl -sI http://127.0.0.1:4322/genero/acao/   # esperado: 301 → /genero/acao
```
