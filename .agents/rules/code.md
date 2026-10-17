# Diretrizes Oficiais MultiCanaisHD (Agentes de IA)
> **Versão 3.0** — Atualizado em Julho/2026 com lições aprendidas de bugs críticos em produção.

Sempre que você for dada uma tarefa para este projeto, você **DEVE OBRIGATORIAMENTE** seguir estes pilares. Nenhuma modificação deve comprometer essas diretrizes.

---

## 1. Design Premium & UI Impecável ("Páginas Bonitas")
O MultiCanaisHD não é um MVP. É uma plataforma de streaming premium de nível Netflix.

- **Identidade Visual**: Utilize SEMPRE a paleta oficial (rebrand V3, derivada da logo — ver commit da troca de cores).
  - Fundo escuro absoluto (atrás dos cards): `#060911`
  - Fundo dos cards/inputs: `#141414` ou `#1f1f1f` (inalterados)
  - Vermelho MultiCanaisHD (primário/destaque): `#DF0912` — nunca o antigo `#FF5555` (salmão/claro demais)
  - Nunca use cores genéricas (azul cru, verde cru, cinza padrão).
- **Micro-interações**: Tudo clicável deve ter `transition-colors`, `transition-transform` e hover states (`hover:scale-105`, `hover:bg-[#cf0811]`). Use Glassmorphism (`backdrop-blur` + fundos translúcidos) para modais e barras flutuantes.
- **Clean Layout**: Espaçamentos generosos, tipografia legível (Inter/Outfit via Google Fonts), ícones modernos. Evite aglomeração visual.
- **Responsividade Pura**: Toda nova UI DEVE funcionar de `320px` até ultrawide via Tailwind (`sm:`, `md:`, `lg:`, `xl:`).
- **Dark Mode nativo**: O site é 100% dark. Nunca adicione estilos de light mode.

---

## 2. Código "À Prova de Falhas" — Segurança e Estabilidade

### 2.1 Cadeia de Autorização — Regra de Ouro
**NUNCA USE `if / else if / else` MUTUAMENTE EXCLUSIVO para lógicas de autorização.**

Quando múltiplos mecanismos de autenticação existem (localhost bypass, licença B2B, sessão VIP, referer de domínio oficial), eles devem ser verificados como **blocos `if` independentes e sequenciais**, não como um único `else` chain:

```js
// ✅ CORRETO — todos os caminhos são verificados
if (isLocal) authorized = true;
if (!authorized && licenseKey) { /* verifica B2B */ }
if (!authorized && token) { /* verifica VIP */ }
if (!authorized && isOfficialReferer) authorized = true;

// ❌ ERRADO — o else bloqueia verificações posteriores
if (isLocal) { ... }
else if (licenseKey) { ... }  // se não tem key, pula VIP!
else { /* verifica VIP */ }
```

O `get-source.js` ficou meses retornando 403 para todos os usuários não-VIP em produção por causa deste padrão. **Nunca repita.**

### 2.2 Try/Catch em SSR — Safety Net obrigatório
- **Todo `await` fora de um try/catch existente em frontmatter Astro é um 5xx latente.**
- Em `Promise.all([A, B, C])`, **todos** os itens devem ter `.catch()` explícito retornando um fallback seguro, mesmo que o `Promise.all` já esteja dentro de um try/catch externo.
- O middleware tem um safety net global em volta do `await next()`. Isso não substitui o tratamento local — é o último recurso.

```js
// ✅ CORRETO
const [canais, vipChannels, session] = await Promise.all([
    fetchCanais().catch(() => []),
    fetchVipChannels().catch(() => []),
    supabase.auth.getSession().catch(() => ({ data: { session: null } }))
]);

// ❌ ERRADO — se fetchCanais() explodir, toda a página vira 5xx
const [canais, vipChannels] = await Promise.all([fetchCanais(), fetchVipChannels()]);
```

### 2.3 Referer e Autorização de API
- As rotas `/api/admin/*` usam um sistema de autorização em 4 camadas: localhost → licença B2B → token VIP → referer do domínio oficial.
- O referer check deve aceitar **qualquer página** de `multicanaishd.lol` — não apenas `/api/player` ou `/player/xtream`. Páginas de slug (`/serie/...`, `/filme/...`) também são origem legítima.
- **Nunca exponha** chaves de API, tokens, ou dados sensíveis em respostas de erro JSON ou logs de console no cliente.

### 2.4 Regras Gerais
- **Optional Chaining obrigatório**: Use `data?.items?.map` e fallbacks `|| []` / `?? false`.
- **Estados Vazios (Empty States)**: Se dados vierem em branco, mostre uma UI informativa.
- **XSS/Injection**: Toda entrada de usuário deve ser sanitizada antes de renderizar ou persistir.
- **Rate Limiting**: APIs públicas e de autenticação devem ter rate limit. Nunca remova proteções existentes.

---

## 3. Clean Code & Manutenabilidade

### 3.1 Arquitetura

| Camada | Localização | Responsabilidade |
|---|---|---|
| **Stores** | `src/store/` | Estado global do cliente (authStore, favoritesStore, toastStore) |
| **Services** | `src/services/` | Conexões externas: TMDB, Supabase, StreamBetter, Redis, EPG, Axiom |
| **Pages/API** | `src/pages/api/` | Endpoints REST — orquestram services, nunca fazem queries cruas |
| **Components** | `src/pages/components/` | UI reutilizável — sem lógica de negócio pesada |

Componentes Astro **nunca** fazem queries diretas ao Supabase ou ao TMDB. Eles delegam para services.

### 3.2 Limites de Tamanho
- **Máximo absoluto**: 500 linhas por arquivo. Meta: 200-300.
- **Funções**: máximo 20 linhas. Se for maior, extraia em funções menores.

### 3.3 Qualidade de Escrita
- **Nomes significativos**: Variáveis e funções com nomes descritivos e únicos.
- **Comentários estratégicos**: Comente o "porquê" da decisão, não o "o quê". Sem comentários óbvios.
- **Flat Code**: Prefira guard clauses a aninhamentos profundos.
- **Bilinguismo**: Comentários e mensagens de usuário devem ter versão PT e EN quando adicionados.
- **Zero console.log em produção**: Só `console.error` e `console.warn` para erros graves.

### 3.4 Stack Real — Nada inventado

Stack atual do projeto:
- **Framework**: Astro 5.x (SSR, Cloudflare adapter)
- **Estilização**: Tailwind CSS 4.x (sintaxe nova — use `@import "tailwindcss"`, não `@tailwind base`)
- **Deploy**: Cloudflare Pages + Workers
- **Banco de Dados**: Supabase (PostgreSQL) via `@supabase/supabase-js` 2.x
- **Cache**: Redis via ioredis (Upstash) + Cloudflare KV (sessions, sitemap, config)
- **Estado Global**: NanoStores 1.x (`src/store/`)
- **Logs/Observabilidade**: Axiom via `axiomService.js`
- **Testes**: Vitest 4.x (unitários) + Playwright 1.59 (E2E)
- **Email**: Resend
- **Pagamentos VIP**: Livepix (PIX + crypto)
- **Player de Conteúdo**: embed público da StreamBetter (`streamEmbedService.js`, chave `sb_pk_...`) — um único iframe pra filme/série/canal/jogo/evento, sem seleção de fonte
- **Conteúdo/Metadados**: TMDB API + MangaDex API
- **IA**: Google Generative AI (`@google/generative-ai`)

**PROIBIDO** inventar métodos, propriedades ou bibliotecas. Se não tem certeza, leia o código existente em `src/services/`.

---

## 4. Otimização Extrema — Velocidade e SEO

### 4.1 Performance (TTFB sub-segundo)
- **Master Parallelization**: Use `Promise.all` ou `Promise.allSettled` para disparar todas as requisições SSR simultaneamente. Nunca encadeie `await` sequenciais se as chamadas são independentes.
- **Lazy Load**: Imagens usam `loading="lazy"`. Scripts de anúncios/analytics são carregados com `setTimeout` prolongado.
- **Cache L1 (RAM)**: Use `globalThis._bf_*` para cache em memória. Proteja com Singleton Lock para evitar race conditions.
- **Cache L2 (Redis/KV)**: Para dados semi-estáticos (config, sitemap, canais). TTL padrão: 6h para sitemap, 60s para config. O TTL de config era 10s; como `getConfig` roda no `BaseLayout` (toda página do site), isso custava uma leitura de KV a cada 10s **por isolate** para um blob que só muda quando alguém mexe no `/moderacao`. O painel não é afetado: ele lê com `getAllConfigs({ force: true })`.
- **Toda leitura de KV precisa de teto de tempo e de recuo após falha.** Cache é opcional por definição — nenhuma leitura de KV pode segurar o SSR. E ao falhar, marque a próxima tentativa (`nextAttemptAt` em `configService.js`): sem recuo, o volume de leitura sobe justamente quando o KV está degradado, realimentando o problema.
- **Evite polling**: EPG e heartbeat usam cache em memória para não desperdiçar cotas pagas.

### 4.2 SEO e Indexação — Regras Críticas

**ATENÇÃO**: 3.506 erros 5xx no Search Console paralisaram a indexação por semanas. Ciclos de "Validação Iniciada" que nunca terminam são causados por 5xx persistentes — o Google reduz o crawl budget após 5xx em massa.

- **Nenhuma página SSR pode retornar 5xx ao Googlebot.** O middleware intercepta exceções SSR com um safety net, mas cada página deve ter seu próprio try/catch.
- **Canonical limpo**: Em páginas de conteúdo (`/filme/`, `/serie/`, `/manga/`, `/canal/`), o `<link rel="canonical">` NUNCA inclui `?season=X&episode=Y` ou outros query params dinâmicos.
- **Sitemap sem query params**: O `sitemap.xml` só gera URLs base — nunca variantes com `?season=`.
- **noindex por header**: Páginas internas (`/api/*`, `/player/*`, `/login`, `/perfil`, `/moderacao`, `/results`, `/minha-lista`) recebem `X-Robots-Tag: noindex, nofollow` via middleware.
- **Sem notificação proativa de indexação**: IndexNow e Google Indexing API foram removidos (credencial presa ao domínio antigo + teto de 180/dia estourando em 90% das tentativas). A descoberta de páginas novas é 100% `sitemap.xml` + rastreamento orgânico do Googlebot — não reintroduza chamadas de notificação por SSR.
- **Redirects 301**: Se o slug na URL não corresponde ao slug canônico do título, redirecione 301.

---

## 5. Procedimento do Agente (Foco e Precisão Cirúrgica)

- **Pare antes de escrever**: Não adivinhe requisitos ambíguos. Pergunte.
- **Simplicidade primeiro**: O código existe para resolver problemas. Não crie abstrações que não servem a nada hoje.
- **Escopo mínimo**: Modifique apenas o que o pedido exige. Não toque em código funcional adjacente.
- **Sinalize ineficiências**: Se ao modificar um arquivo detectar um gargalo grave, sinalize e ofereça a correção — mas não faça sem aprovação.
- **Leia antes de escrever**: Antes de criar algo novo, verifique se já existe equivalente em `src/services/` ou `src/pages/components/`.
- **Alinhamento Mobile ↔ Web**: O app mobile (`/mobile`) deve espelhar o comportamento e visual do frontend web. Em caso de dúvida, consulte o frontend.

---

## 6. Blindagem e Testes

| Situação | Tipo de Teste | Ferramenta |
|---|---|---|
| Nova funcionalidade | Integração (Golden Path) | Playwright (`npm run test:e2e`) |
| Refatoração sem feature nova | Unitário | Vitest (`npm run test:unit`) |
| Bug crítico corrigido | Regressão | Playwright |

- **Tática de Guerrilha**: Escreva a funcionalidade + o teste do Caminho Feliz imediatamente.
- **Testes de autorização**: Qualquer mudança em auth/VIP deve ter teste para usuário não-autenticado, VIP e admin.
- **Antes do deploy**: `npm run build` é obrigatório. Zero erros de compilação.

---

## 7. Diretrizes para Mobile (React Native / Expo)

- **500 linhas máximo** por arquivo. Meta: 200-300.
- **Estilos desacoplados**: Se o arquivo ultrapassar 300 linhas, extraia `StyleSheet.create` para `NomeDoComponente.styles.ts`.
- **Componentes atômicos**: Quebre telas grandes em componentes menores.
- **Memoização sistemática**: `React.memo` e `useCallback` em telas pesadas.
- **Paridade visual com Web**: Mesma paleta `#060911` / `#DF0912`, mesmos padrões de UX. O mobile ainda não recebeu o rebrand V3 — atualizar ao tocar nessas telas.

---

## 8. Segurança de Rotas de API

- **Toda rota em `/api/admin/`** exige validação explícita de autorização nas 4 camadas (ver 2.1). Nunca assuma que uma rota está protegida só pelo path.
- **Webhooks** (pagamentos, Discord) devem validar assinatura HMAC do payload. Nunca processe sem verificar a origem.
- **Dados sensíveis no cliente**: Tokens, chaves de API e credenciais NUNCA devem aparecer em respostas JSON retornadas ao navegador, nem em atributos `data-*` de HTML.
- **SQL Injection**: Use sempre os métodos parametrizados do Supabase SDK. Nunca concatene strings SQL.
- **Rate Limit**: Endpoints de login, signup e reset de senha devem ter rate limit por IP.
- **CORS**: Endpoints da API pública (`/api/index`, `/api/player`) podem ser acessados cross-origin. Todos os outros validam origem via referer ou token.
