# API de download direto da redetoons (não oficial)

Documentação de engenharia reversa de como o MultiCanaisHD consome o serviço de download
direto (.mp4) da redetoons. Implementação de referência em
[`frontend/src/services/directDownloadService.js`](../frontend/src/services/directDownloadService.js).

## ⚠️ Antes de usar em outro projeto

Isto **não é uma API pública documentada pela redetoons**. É uma Supabase Edge Function que
o front-end deles (`redetoons.lol`) chama, autenticada com uma `apikey` e um header
customizado que vêm embutidos no bundle JS público do site — qualquer visitante do site
recebe essas credenciais no navegador, mas isso não é a mesma coisa que um contrato de API
estável para terceiros.

Implicações práticas:
- **Pode quebrar sem aviso.** Se a redetoons rotacionar a `apikey`, mudar o valor de
  `x-rt-client`, ou trocar de projeto Supabase (já aconteceu uma vez — a API anterior era
  `redetoons.cards/api/player`, uma API própria, completamente diferente desta), a chamada
  para de funcionar. Não há changelog ou aviso prévio.
- **Sem SLA, sem limite de taxa documentado.** Trate como best-effort: sempre com timeout
  curto e fallback silencioso (nunca deixe a falha desse serviço quebrar a página).
- **Credenciais não são segredo, mas não é um convite.** A `apikey` abaixo é a *anon key*
  pública do projeto Supabase deles — o mesmo valor que qualquer navegador recebe ao abrir
  `redetoons.lol`. Não é uma chave privada roubada, mas também não é uma API que eles
  publicaram para consumo de terceiros.
- **Se puder, revalide antes de depender disso em produção**: abra `redetoons.lol` num
  navegador com DevTools, vá em Network, dispare um download, e confirme que a `apikey` e o
  `x-rt-client` abaixo ainda coincidem com o que o site realmente manda.

## Como redescobrir as credenciais (se estas expirarem)

1. Abra `https://redetoons.lol` e liste os bundles JS carregados na home (`view-source` ou
   DevTools → Network → filtro JS). O bundle principal costuma se chamar algo como
   `index-<hash>.js`.
2. Baixe o bundle (`curl` com User-Agent de navegador — ver seção de headers) e procure por:
   - Um JWT no formato `eyJ...` com `"ref":"<algum-id>"` e `"role":"anon"` no payload
     decodificado em base64 — essa é a `apikey`.
   - A string literal `x-rt-client` seguida do valor que a acompanha no código (hoje
     `rt-web-2026`).
3. Confirme o path da função: procure por `get-download-link` no mesmo bundle — o trecho
   mostra os `searchParams` exatos que o site monta (`tmdbId`, `type`, e `season`/`episode`
   só quando `type === "tv"`).

## Endpoint

```
GET https://xgkkldquttqobprpjghc.supabase.co/functions/v1/get-download-link
```

### Query params

| Param | Obrigatório | Valores | Observação |
|---|---|---|---|
| `tmdbId` | sim | ID numérico do TMDB | Mesmo ID usado nas páginas do TMDB (themoviedb.org) |
| `type` | sim | `movie` ou `tv` | **Não é `movie`/`serie`** — série usa `tv` |
| `season` | só se `type=tv` | número | 1-indexed |
| `episode` | só se `type=tv` | número | 1-indexed |

### Headers obrigatórios

| Header | Valor | Por quê |
|---|---|---|
| `apikey` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhna2tsZHF1dHRxb2JwcnBqZ2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMzMwMjYsImV4cCI6MjEwMDcwOTAyNn0.U7KpckNTtQ0bl68YFn-Awm3zOefR5gxL2OScdsZfRIs` | Anon key pública do projeto Supabase deles. Sem isso: `403`. |
| `x-rt-client` | `rt-web-2026` | Header customizado que a função checa. Sem isso: `403`. |

### Headers recomendados (não confirmados como obrigatórios, mas usados pelo MultiCanaisHD)

| Header | Valor | Por quê |
|---|---|---|
| `User-Agent` | um UA de navegador real (ex: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`) | Requisições sem UA de navegador levam bloqueio em outras rotas da redetoons; mantenha por segurança mesmo que esta função específica não exija. |
| `Origin` | `https://redetoons.lol` | Imita a origem esperada pela função. |

### Exemplo de chamada

```bash
curl -s \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhna2tsZHF1dHRxb2JwcnBqZ2hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxMzMwMjYsImV4cCI6MjEwMDcwOTAyNn0.U7KpckNTtQ0bl68YFn-Awm3zOefR5gxL2OScdsZfRIs" \
  -H "x-rt-client: rt-web-2026" \
  -H "Origin: https://redetoons.lol" \
  -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" \
  "https://xgkkldquttqobprpjghc.supabase.co/functions/v1/get-download-link?tmdbId=1726&type=movie"
```

## Respostas

### Sucesso — `200 OK`

```json
{
  "url": "https://cloud-delivery.app/dl/<token-longo>.mp4?n=Homem.de.Ferro.redetoons.mp4&exp=1786068395&sig=<assinatura>",
  "filename": "Homem.de.Ferro.redetoons.mp4",
  "expiresAt": 1786068395
}
```

- `url`: link direto e assinado (não precisa de headers extras pra baixar — é um GET puro
  numa CDN diferente, `cloud-delivery.app`). Expira em `expiresAt` (epoch em segundos).
- `filename`: nome sugerido pelo servidor, **vem com a marca "redetoons" embutida** (ex:
  `Titulo.redetoons.mp4`, ou `Titulo.S01E01.redetoons.mp4` pra episódios). Dá pra limpar essa
  string pra exibir na SUA UI (título, descrição do card etc.):
  ```js
  filename.replace(/\.mp4$/i, "").replace(/redetoons/gi, "").replace(/\.+$/, "").trim();
  ```
  **Isso não muda o nome do arquivo que o navegador salva.** O `filename` da resposta JSON e
  o parâmetro `n=` embutido na própria `url` são o mesmo valor, e `n=` faz parte do que a
  assinatura (`sig=`) do link cobre — mudar `n=` (ex: pra `multicanaishd.mp4`) invalida a
  assinatura e o link vira `403 Forbidden` (testado). O nome final do arquivo baixado vem do
  header `Content-Disposition` que `cloud-delivery.app` manda na hora da resposta, montado a
  partir desse mesmo `n=` — travado, não é possível sobrescrever com o atributo HTML
  `download="..."`: navegadores modernos (Chrome/Firefox) **ignoram esse atributo quando o
  link é de outra origem** (aqui, `cloud-delivery.app` ≠ o domínio do seu site) e usam o nome
  que o `Content-Disposition` do servidor de origem mandar.
  A única forma de renomear de verdade é seu backend baixar o arquivo inteiro e reenviar pro
  usuário com um `Content-Disposition` próprio — ou seja, proxiar um arquivo de ~1-3GB por
  download. O MultiCanaisHD decidiu conscientemente não fazer isso (ver comentário em
  `TorrentModal.astro`, seção "A CDN de origem tem proteção anti-hotlink...") e aceita a marca
  da redetoons no nome do arquivo salvo em troca de banda zero no próprio servidor.
- `expiresAt`: o link de download em si expira — não cacheie o `url` por muito tempo. O
  MultiCanaisHD cacheia a resposta inteira por 6h e, na prática, a maioria dos downloads
  acontece dentro da janela de validade porque o usuário clica pouco depois de abrir a
  página; se for guardar por mais tempo, refaça a chamada perto da hora de uso.

### Não encontrado — `404`

```json
{ "error": "not_found" }
```

Título sem versão de download disponível no catálogo deles. Trate como estado normal (não
é erro do seu app), não como falha.

### Tipo inválido — `400`

```json
{ "error": "bad_type" }
```

Acontece se `type` não for exatamente `movie` ou `tv` (ex: mandar `serie`, `series`, `show`).

### Sem autenticação — `403`

Corpo vazio ou HTML de erro do Supabase. Falta `apikey` e/ou `x-rt-client`, ou os valores
estão desatualizados (ver seção de rediscovery acima).

## Baixando o arquivo pro usuário (dica de implementação)

O CDN de origem (`cloud-delivery.app`) tem proteção anti-hotlink: se detectar `Referer` de um
domínio diferente do deles, redireciona pra um vídeo de "bloqueado" em vez do arquivo real.
Pra baixar direto da origem sem passar pelo seu servidor (evita pagar banda de um arquivo de
~1-3GB por download), omita o Referer no link:

```html
<a href="URL_DO_JSON.url" rel="noreferrer" referrerpolicy="no-referrer" download="nome.mp4">
```

Gerenciadores de download externos (IDM e similares) podem ignorar essa política e reenviar
o Referer da aba de qualquer forma — isso é uma limitação do gerenciador, não do seu código.

## Resumo do fluxo mínimo

1. Tenha o `tmdbId` do título (do TMDB) e, se for série, `season`/`episode`.
2. `GET /functions/v1/get-download-link?tmdbId=X&type=movie|tv[&season=Y&episode=Z]` com os
   dois headers obrigatórios.
3. Se `200`: monte um link `<a>` com `rel="noreferrer" referrerpolicy="no-referrer"` apontando
   pro campo `url` da resposta, com o `filename` limpo da marca deles.
4. Se `404`/`400`/`403`: trate como "download indisponível pra este título" — nunca propague
   como erro de página.
