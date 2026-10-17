# Contrato do player externo (redirect)

O que o site externo precisa implementar para tocar o catálogo do MultiCanaisHD.

Trocar `multicanaishd.lol` pelo domínio real e `SEGREDO` pela `REDIRECT_SIGNING_SECRET`,
que precisa ser **o mesmo valor** nos dois projetos Cloudflare.

## Visão geral

O MultiCanaisHD vira catálogo/SEO. O usuário clica em "Assistir" numa página de filme ou série
e é levado para `https://<seu-dominio>/watch?token=<token>`. Esse token é a única coisa que
atravessa: ele é assinado com HMAC-SHA256 e prova que a requisição saiu do MultiCanaisHD.

O site externo **não acessa o Supabase e não descobre nada sozinho**. Quem decide se o
usuário é VIP é o MultiCanaisHD, e a resposta viaja dentro do token.

## 1. A página `/watch`

Recebe `GET /watch?token=<token>`.

O token tem o formato `<payload>.<assinatura>`, ambos em base64url. O payload é legível sem
o segredo — use para montar a tela:

```json
{
  "type": "movie",        // "movie" ou "tv"
  "id": "603",            // ID do TMDB
  "season": "2",          // só quando type = "tv"
  "episode": "3",         // só quando type = "tv"
  "tier": "diamond",      // "free" | "vip" | "diamond"
  "isVip": true,          // conveniência: tier != "free"
  "displayName": "Fulano",
  "userId": "uuid",       // ausente para visitante
  "lang": "pt",           // "pt" ou "en"
  "exp": 1787131329       // expiração (unix). Vale 6h.
}
```

Ler o payload serve para exibição ("Olá, Fulano"). **Não confie nele para liberar fonte
premium** — quem aplica o gate é o MultiCanaisHD, nos endpoints abaixo.

## 2. Listar as fontes disponíveis

```http
POST https://multicanaishd.lol/api/redirect/source
Content-Type: application/json
User-Agent: SeuPlayer/1.0

{ "token": "<token>" }
```

Resposta:

```json
{
  "tier": "free",
  "sources": [
    { "id": "source1", "allowed": true,  "requiredTier": "free" },
    { "id": "source2", "allowed": false, "requiredTier": "diamond" },
    { "id": "source3", "allowed": false, "requiredTier": "vip" },
    { "id": "source4", "allowed": true,  "requiredTier": "free" },
    { "id": "source5", "allowed": true,  "requiredTier": "free" },
    { "id": "source6", "allowed": true,  "requiredTier": "free" }
  ]
}
```

Monte o seletor ("Player principal", "Player 2"...) com os que têm `allowed: true`.
`source1` é a fonte padrão e é sempre livre.

## 3. Resolver a fonte escolhida

```http
POST https://multicanaishd.lol/api/redirect/source
Content-Type: application/json
User-Agent: SeuPlayer/1.0

{ "token": "<token>", "source": "source1" }
```

Resposta:

```json
{ "url": "https://superflixapi.pro/filme/603#noLink", "type": "embed", "source": "source1" }
```

Coloque a `url` num `<iframe>`. Vale para todas as fontes, inclusive a `source2` — que
devolve um wrapper `https://multicanaishd.lol/player/xtream?s=...` já assinado.

Erros:

| Status | Significado |
|---|---|
| 400 | `source` desconhecida |
| 401 | token inválido, adulterado ou expirado (mais de 6h) |
| 403 | usuário não tem o tier exigido. Vem com `requiredTier` e `tier` |
| 404 | fonte não tem esse título |

## 4. Reportar o playback (opcional)

Quando o vídeo começar de fato, para alimentar o painel de presença online:

```http
POST https://multicanaishd.lol/api/redirect/report
Content-Type: application/json
User-Agent: SeuPlayer/1.0

{ "token": "<token>", "sessionId": "<id-da-sessao-do-seu-site>" }
```

## 5. Armadilhas

- **Mande sempre um `User-Agent`.** Se você chamar do servidor, o `fetch` do Cloudflare
  Workers não manda nenhum, e o middleware do MultiCanaisHD trata User-Agent vazio como bot e
  bloqueia a requisição.
- **CORS:** só a origem configurada em `REDIRECT_TARGET_DOMAIN` no MultiCanaisHD é liberada.
  Se você chamar do navegador de outro domínio, o preflight falha. Chamar do servidor não
  passa por CORS.
- **O token expira em 6h.** Depois disso o usuário precisa voltar ao MultiCanaisHD e clicar de
  novo. Um `401` durante uma troca de fonte quase sempre é isso.
- **A `source2` (Nixplay) tem menos cobertura pelo caminho externo** do que no site: títulos
  que dependem de override manual ou do fallback StreamBetter respondem 404 aqui.

## 6. Configuração

No Cloudflare do **site externo**:

| Variável | Valor |
|---|---|
| `REDIRECT_SIGNING_SECRET` | `SEGREDO` (o mesmo do MultiCanaisHD) |

No Cloudflare do **MultiCanaisHD**:

| Variável | Valor |
|---|---|
| `REDIRECT_SIGNING_SECRET` | `SEGREDO` |
| `REDIRECT_TARGET_DOMAIN` | o domínio do site externo, sem barra no fim |

`REDIRECT_TARGET_DOMAIN` é o interruptor do fluxo inteiro: enquanto ela não existir, o
MultiCanaisHD continua com o player embutido e ninguém é redirecionado. Setar essa variável é
o último passo, depois que o `/watch` estiver de pé e testado.
