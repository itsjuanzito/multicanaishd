# MultiCanaisHD Discord Rich Presence

Mostra "Assistindo X" no perfil pessoal do Discord do usuário enquanto ele usa o MultiCanaisHD — igual ao PreMID, mas para o nosso site.

Página de instruções pro usuário final: `/richpresence` no site (link em `frontend/src/pages/richpresence.astro`).

## Por que existem duas partes

O Discord não expõe nenhuma API server-side para setar a Rich Presence pessoal de um usuário. Isso só é possível via IPC local do Discord Desktop (named pipe), e extensões de navegador não podem abrir named pipes diretamente por sandboxing de segurança. Por isso o fluxo é (igual ao PreMID):

```
site MultiCanaisHD (content script)
   -> extensão (background service worker, cliente WebSocket)
      -> ws://127.0.0.1:32172 (servidor local do multicanaishd-presence-host.exe)
         -> named pipe do Discord Desktop (discord-rpc)
```

Sem Native Messaging, sem pareamento por ID de extensão — a extensão simplesmente conecta na porta local fixa, exatamente como o PreMID App faz. O `.exe` roda continuamente em segundo plano e se registra pra iniciar junto com o Windows na primeira execução.

**Trade-off de segurança conhecido**: por não ter pareamento por ID, qualquer aba do navegador poderia teoricamente abrir uma conexão WebSocket nessa porta e mandar uma atividade falsa pro Discord do usuário. Isso não expõe dados nem executa código — só permite "brincar" com o texto do status. É o mesmo risco que o PreMID e ferramentas similares aceitam.

## Partes

- `extension/` — extensão Chrome/Edge (Manifest V3). Lê o que o usuário está assistindo direto do DOM/window das páginas do MultiCanaisHD e manda via WebSocket, sem precisar de API nova.
- `native-host/` — código fonte do `host.js`, empacotado com `pkg` num único `.exe` standalone (sem exigir Node.js no PC do usuário final). Sobe um servidor WebSocket local persistente e fala com o Discord via `discord-rpc`.

## Setup (desenvolvimento)

1. `cd native-host && npm install` (dependências de build, incluindo `pkg`).
2. Preencher `DISCORD_CLIENT_ID` em `native-host/host.js` com o Client ID criado no [Discord Developer Portal](https://discord.com/developers/applications) (ver seção abaixo).
3. `npm run build-exe` — gera `frontend/public/downloads/multicanaishd-presence-host.exe` (é esse arquivo que fica disponível pra download na página `/richpresence`).
4. Carregar `extension/` como "extensão sem pacote" em `chrome://extensions` (modo desenvolvedor).
5. Rodar o `.exe` gerado (duplo-clique ou `./multicanaishd-presence-host.exe` no terminal) — ele sobe o servidor local e se registra pra iniciar com o Windows, sem pedir nada.
6. Abrir Discord Desktop, abrir um filme/série/canal logado no MultiCanaisHD local, ver a Rich Presence atualizar.

**Importante**: sempre que mudar `host.js` ou `content-script.js`/`background.js`, é preciso rodar `npm run build-exe` de novo e regenerar o zip da extensão (`frontend/public/downloads/multicanaishd-discord-presence-extension.zip`) pra quem for baixar da página `/richpresence` pegar a versão atualizada.

## Registrar a aplicação no Discord

1. Acessar https://discord.com/developers/applications com a conta Discord dedicada ao projeto.
2. "New Application" → nome "MultiCanaisHD".
3. Em "Rich Presence" → "Art Assets", subir os ícones: `multicanaishd_logo` (fallback caso o pôster falhe ao carregar), `movie`, `tv`, `live` (selinho pequeno no canto, indicando o tipo de conteúdo). A imagem grande do card usa o pôster/capa do filme/série/canal diretamente (URL https), não precisa subir uma pra cada título.
4. Copiar o "Application ID" (Client ID) e colocar em `DISCORD_CLIENT_ID` em `native-host/host.js`.

## Limitações conhecidas

- Só funciona com o Discord Desktop aberto (Rich Presence via IPC não existe no Discord Web/mobile).
- Só Chrome/Edge por enquanto (Manifest V3). Firefox pode ser adicionado depois com pequenas mudanças de manifest.
- Só Windows por enquanto (o `.exe` é buildado com target `node18-win-x64`).
- O `.exe` não é assinado digitalmente, então o SmartScreen do Windows ou antivírus podem alertar na primeira execução — isso é esperado, não malware.
