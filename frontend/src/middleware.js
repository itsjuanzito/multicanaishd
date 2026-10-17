import { defineMiddleware } from "astro:middleware";
import { setRuntimeEnv, setRuntimeWaitUntil, getSiteUrl, getEnv } from "./services/env-adapter.js";
import { destinoDeMigracao } from "./services/canonicalHost.js";
import { axiomService } from "./services/axiom-service.js";
import { isKidsProfile } from "./services/kidsProfile.js";

// Parâmetros que NUNCA podem ir pro log: são credenciais. `key` é a licença B2B paga,
// `g` é o grant de acesso VIP e `token`/`secret` falam por si. O resto da query string
// (id, type, source, season...) é justamente o que precisamos ver pra analisar abuso.
const QUERY_PARAMS_SENSIVEIS = new Set(['key', 'g', 'token', 'secret', 'access_token', 'password']);

function sanitizeQuery(searchParams) {
    const partes = [];
    for (const [chave, valor] of searchParams) {
        partes.push(`${chave}=${QUERY_PARAMS_SENSIVEIS.has(chave.toLowerCase()) ? '[redacted]' : valor}`);
    }
    return partes.length ? partes.join('&') : null;
}

// As duas listas abaixo ficam em escopo de módulo de propósito: são constantes, e declará-las
// dentro do handler fazia o Worker realocar dois arrays de ~30 strings em CADA requisição
// (11,21M por ciclo) só pra jogar fora em seguida. Alocação é barata, mas não é de graça, e
// este é literalmente o código mais executado do projeto.

// Allowlist: crawlers legítimos de search engines que NUNCA devem ser bloqueados
const ALLOWED_CRAWLERS = [
        // Google — todos os rastreadores oficiais
        'googlebot', 'google-inspectiontool', 'googleother', 'google-extended',
        'adsbot-google', 'googlebot-image', 'googlebot-news', 'googlebot-video',
        'google-read-aloud', 'google-safety', 'apis-google', 'google-site-verification',
        // Bing / Microsoft
        'bingbot', 'bingpreview', 'msnbot', 'adidxbot',
        // Outros search engines
        'duckduckbot', 'slurp', 'yahoo',
        'baiduspider', 'applebot',
        // Social / Bots de preview
        'facebookexternalhit', 'twitterbot', 'discordbot', 'telegrambot', 'whatsapp',
        'linkedinbot', 'pinterest',
        // Performance / Monitoring
        'lighthouse', 'pagespeed', 'chrome-lighthouse',
        'pingdom', 'gtmetrix', 'uptimerobot',
        // Agentes de IA "on-demand": buscam uma página específica a pedido de um usuário
        // real (ex: usuário pede pro ChatGPT/Perplexity abrir um link do MultiCanaisHD).
        // Diferente dos crawlers de treinamento abaixo, esses trazem descoberta/tráfego real.
    'chatgpt-user', 'perplexity-user', 'perplexitybot'
];

// Lista negra: crawlers de treinamento de IA em massa — raspam conteúdo sem
// trazer nenhum usuário/tráfego de volta, só consomem crawl budget e banda.
const BAD_BOTS = [
        'claudebot', 'claude-web', 'gptbot', 'meta-externalagent', 'amazonbot',
        // meta-webindexer: 64.813 requisições em 24h pra apenas 3.598 URLs distintas — 18
        // visitas por URL POR DIA, sendo que nenhuma página do catálogo muda nessa cadência.
        // Sozinho era 45% de todo o tráfego registrado no Axiom e quase metade da fatura de
        // CPU/KV da conta, sem devolver nenhum usuário (não é buscador que manda tráfego).
        // NÃO confundir com `facebookexternalhit`, que segue na allowlist acima: é aquele, e
        // não este, que gera o preview de link no WhatsApp/Facebook. Bloquear o webindexer
        // não afeta compartilhamento.
        'meta-webindexer',
        'dotbot', 'mj12bot', 'bytespider', 'petalbot',
        'serpstat', 'blexbot', 'ccbot',
        // SEO/crawl scrapers agressivos — raspam o catálogo inteiro repetidamente sem trazer tráfego
        'ahrefsbot', 'semrushbot', 'dataforseobot', 'seekportbot', 'barkrowler',
        'megaindex', 'exabot', 'gigablast', 'diffbot', 'webzio-extended', 'proximic',
        // Fingerprint fixa de bot disfarçado de celular antigo (Nexus 5 / Android 6.0, build
        // MRA58N) — visto repetidamente no Axiom raspando o catálogo, não é usuário real.
    'nexus 5 build/mra58n'
    // Nota: NÃO bloqueamos "curl/", "python-requests" etc. aqui — o próprio cron do
    // GitHub Actions chama /api/internal/check-status via curl. Bloquear esses UAs
    // globalmente derrubaria os crons internos.
];

// Rotas de transmissão ao vivo (TV aberta e futebol). `/calendario` fica de fora de
// propósito: é o calendário de lançamentos de filmes, não conteúdo ao vivo.
const LIVE_ROUTE_PREFIXES = [
    '/canais', '/canal',
    '/futebol-ao-vivo', '/brasileirao', '/champions-league', '/libertadores'
];

function isLiveRoute(pathname) {
    const semIdioma = pathname.startsWith('/en/') ? pathname.slice(3) : pathname;
    return LIVE_ROUTE_PREFIXES.some(prefixo => semIdioma === prefixo || semIdioma.startsWith(prefixo));
}

export const onRequest = defineMiddleware(async (context, next) => {
    const url = context.url.pathname;
    const request = context.request;
    const host = request.headers.get('host') || '';

    // 1. BLOQUEIO DE BOTS AGRESSIVOS (LISTA NEGRA EXPLÍCITA)
    const userAgent = (request.headers.get('user-agent') || '').toLowerCase();

    const isAllowedCrawler = ALLOWED_CRAWLERS.some(c => userAgent.includes(c));

    // Webhooks de gateway de pagamento são server-to-server e podem chegar sem User-Agent
    // (ou com um UA genérico). O filtro anti-bot abaixo roda ANTES de tudo — antes do
    // setRuntimeEnv, antes da rota — então um 403 aqui é invisível: nenhum log da rota,
    // nenhum aviso no Discord, e o VIP simplesmente nunca ativa. Foi exatamente esse o
    // sintoma do pagamento de R$ 19,90 de 2026-09-09. Isentar não abre brecha: cada
    // webhook confere o pagamento contra a API do próprio gateway antes de conceder nada.
    const isWebhookRoute = url.startsWith('/api/webhooks/');

    // User-agent vazio: navegador de verdade sempre manda um. Sinal forte de script/bot cru.
    // Exceção: verificadores de tag de redes de anúncio (ex: Monetag) rodam server-side sem
    // UA identificável e só checam a home — liberar só "/" não abre brecha pro resto do site.
    const isEmptyUserAgent = userAgent.trim() === '' && url !== '/';

    const isBadBot = !isAllowedCrawler && !isWebhookRoute &&
        (isEmptyUserAgent || BAD_BOTS.some(bot => userAgent.includes(bot)));

    if (isBadBot) {
        // Tenta logar o bloqueio, mas não deixa isso quebrar o bloqueio real
        try {
            const runtime = context.locals.runtime;
            if (axiomService && typeof axiomService.logRequest === 'function') {
                const logPromise = axiomService.logRequest({
                    method: request.method,
                    url: url,
                    status: 403,
                    duration: 0,
                    userAgent: userAgent,
                    ip: request.headers.get("cf-connecting-ip") || "0.0.0.0",
                    host: host,
                    platform: "multicanaishd-blocked-bot"
                });

                if (runtime?.ctx?.waitUntil) {
                    runtime.ctx.waitUntil(logPromise);
                }
            }
        } catch (e) {
            console.error("[Middleware] Erro ao logar bot bloqueado:", e);
        }

        // no-store: a decisão depende do User-Agent, mas a chave de cache da Cloudflare é só
        // a URL. Um 403 cacheado numa URL de conteúdo serviria "Acesso Negado" pra usuários reais.
        return new Response('Acesso Negado para Crawlers e IAs.', {
            status: 403,
            headers: { 'Cache-Control': 'private, no-store' }
        });
    }

    // 2. REDIRECIONAMENTO OBRIGATÓRIO (Mata o pages.dev)
    // Captura o env runtime já aqui (antes do previsto na etapa 4) para que getSiteUrl()
    // enxergue a var SITE_URL nesse ponto — sem isso, cairia sempre no default hardcoded.
    if (host.includes('pages.dev')) {
        try {
            const runtimeEarly = context.locals.runtime;
            if (runtimeEarly && runtimeEarly.env) setRuntimeEnv(runtimeEarly.env);
        } catch (e) {}
        return context.redirect(`${getSiteUrl(context.url)}${url}${context.url.search}`, 301);
    }

    // 2.1 REDIRECIONAMENTO DE DOMINIO LEGADO (ver services/canonicalHost.js)
    // Consolida a autoridade de SEO num dominio so e evita servir zona de anuncio aprovada
    // pro dominio antigo. Todo legado vai DIRETO pro canonico, sem escala: encadear
    // .click -> .lat -> .cfd recriaria a cadeia de redirect eliminada em 95f5170.
    // Ativar uma migracao nova = trocar SITE_URL no painel, sem tocar em codigo.
    try {
        const runtimeEarly = context.locals.runtime;
        if (runtimeEarly && runtimeEarly.env) setRuntimeEnv(runtimeEarly.env);
    } catch (e) {}

    const destinoLegado = destinoDeMigracao(host);
    if (destinoLegado) {
        return context.redirect(`https://${destinoLegado}${url}${context.url.search}`, 301);
    }

    // 3. BLOQUEIO DE PREFETCH/PRERENDER (ECONOMIA DE COTA):
    // Usamos .includes() para pegar variações como "prefetch;prerender" do Chrome
    const purpose = (request.headers.get('purpose') || '').toLowerCase();
    const secPurpose = (request.headers.get('sec-purpose') || '').toLowerCase();
    const xPurpose = (request.headers.get('x-purpose') || '').toLowerCase();
    const mozPrefetch = (request.headers.get('x-moz-prefetch') || '').toLowerCase();

    if (purpose.includes('prefetch') || secPurpose.includes('prefetch') || 
        xPurpose.includes('prefetch') || mozPrefetch.includes('prefetch')) {
        // no-store: decisão baseada em header de propósito, não na URL — não pode virar
        // uma resposta vazia cacheada pra quem abrir a página de verdade.
        return new Response(null, {
            status: 204,
            headers: { 'Cache-Control': 'private, no-store' }
        });
    }

    // 3. FILTRO DE ASSETS: Não processar imagens/css/js no middleware
    // Excluímos explicitamente as rotas de sitemap (índice e lotes) pois são rotas SSR
    // dinâmicas que precisam das variáveis de ambiente e do safety-net anti-5xx abaixo.
    const isSitemapRoute = url === '/sitemap.xml' || /^\/sitemap-\d+\.xml$/.test(url);
    const isStatic = (/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?|map|txt|xml)$/i.test(url) ||
                     url.startsWith('/_astro')) &&
                     !isSitemapRoute;

    if (isStatic) return next();

    const startTime = performance.now();
    
    try {
        // Captura as variáveis de ambiente da Cloudflare (Runtime)
        const runtime = context.locals.runtime;
        
        if (runtime && runtime.env) {
            setRuntimeEnv(runtime.env);
        }

        // NORMALIZAÇÃO DO waitUntil — não remova achando que é redundante.
        // O @astrojs/cloudflare expõe `locals.runtime.ctx.waitUntil`; `locals.runtime.waitUntil`
        // NÃO existe (ver node_modules/@astrojs/cloudflare/dist/utils/handler.js). O projeto
        // inteiro, porém, chama `locals.runtime.waitUntil(...)` — uns 20 pontos entre páginas,
        // endpoints e este middleware. Todos eram no-op silencioso: o `if` nunca era verdadeiro
        // e o trabalho de background virava fire-and-forget, morrendo junto com o isolate.
        //
        // Consequências reais que isso causou: nenhum log de API chegava no Axiom (só os 403 de
        // bot bloqueado, que usam `ctx.waitUntil` direto e por isso funcionavam), e as escritas
        // de cache no KV podiam ser cortadas no meio — voltando como miss depois e sendo
        // regravadas, alimentando o custo de KV.
        //
        // Corrigido aqui, num lugar só: `locals` é o mesmo objeto que desce pra toda página e
        // endpoint, então preencher `waitUntil` aqui conserta todos os call sites de uma vez.
        if (runtime && typeof runtime.waitUntil !== 'function' && typeof runtime.ctx?.waitUntil === 'function') {
            runtime.waitUntil = (promise) => runtime.ctx.waitUntil(promise);
        }

        if (runtime && typeof runtime.waitUntil === 'function') {
            setRuntimeWaitUntil(runtime.waitUntil.bind(runtime));
        }
    } catch (e) {
        console.error("[Middleware] Erro ao carregar runtime env:", e);
    }

    // Perfil infantil: TV ao vivo, jogos e eventos não passam por aqui.
    //
    // O gate mora no middleware (e não no cliente) porque o site é SSR: esconder o link no
    // menu depois da hidratação deixaria a rota acessível por URL direta, que é justamente
    // o caminho que uma criança usaria sem querer. Transmissão ao vivo não tem como ser
    // filtrada por classificação em tempo real — por isso some inteira, em vez de tentar
    // separar o que é apropriado.
    if (isKidsProfile(context) && isLiveRoute(url)) {
        const destino = url.startsWith('/en/') ? '/en' : '/';
        return context.redirect(destino, 302);
    }

    // Executa a requisição — protegido contra exceções SSR que geram 5xx para crawlers
    let response;
    try {
        response = await next();
    } catch (ssrError) {
        console.error(`[Middleware] SSR exception on ${url}:`, ssrError?.message || ssrError);

        try {
            const logErrorPromise = axiomService.logError(ssrError, {
                url,
                method: request.method,
                userAgent: request.headers.get('user-agent'),
                platform: 'multicanaishd-ssr-exception'
            });
            if (context.locals.runtime?.waitUntil) {
                context.locals.runtime.waitUntil(logErrorPromise);
            }
        } catch (logErr) {
            console.error('[Middleware] Erro ao logar exceção SSR no Axiom:', logErr.message);
        }

        // Retorna uma resposta com status 200 para nunca entregar 5xx a crawlers
        // (regra do projeto — ver .agents/rules/code.md). O erro real já foi logado no Axiom acima.
        // Sitemaps precisam de um corpo XML válido nesse fallback — um HTML de erro aqui também
        // invalidaria o sitemap para o Google, mesmo com status 200.
        if (isSitemapRoute) {
            const emptyRoot = url === '/sitemap.xml' ? 'sitemapindex' : 'urlset';
            response = new Response(
                `<?xml version="1.0" encoding="UTF-8"?><${emptyRoot} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></${emptyRoot}>`,
                {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/xml; charset=utf-8',
                        'X-Robots-Tag': 'noindex',
                        'Cache-Control': 'private, no-store'
                    }
                }
            );
        } else {
            response = new Response(
                `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Erro - MultiCanaisHD</title><meta name="robots" content="noindex"></head><body style="background:#060911;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center"><h1>Erro Interno</h1><p>Tente novamente em instantes.</p><a href="/" style="color:#DF0912">Voltar ao Início</a></div></body></html>`,
                {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'X-Robots-Tag': 'noindex',
                        // Crítico com cache de borda ligado: esta resposta é 200, logo é cacheável
                        // por padrão. Sem no-store, uma falha transitória de SSR congelaria a página
                        // de erro por todo o TTL numa URL que voltou a funcionar.
                        'Cache-Control': 'private, no-store'
                    }
                }
            );
        }
    }
    const duration = Math.round(performance.now() - startTime);

    // OTIMIZAÇÃO: Não logar chamadas de API de sucesso (200) que são muito frequentes
    // Isso economiza MUITA cota na Cloudflare e no Axiom
    const isInternalApi = url.startsWith('/api') || url.startsWith('/_image');

    const shouldNoindexByHeader = (
        url.startsWith('/api/') ||
        url.startsWith('/player/') ||
        url.startsWith('/redirect/') ||
        url.startsWith('/en/redirect/') ||
        url.startsWith('/results') ||
        url.startsWith('/en/results') ||
        url.startsWith('/login') ||
        url.startsWith('/en/login') ||
        url.startsWith('/perfil') ||
        url.startsWith('/en/perfil') ||
        url.startsWith('/perfis') ||
        url.startsWith('/en/perfis') ||
        url.startsWith('/minha-lista') ||
        url.startsWith('/en/minha-lista') ||
        url.startsWith('/moderacao') ||
        url.startsWith('/status') ||
        url.startsWith('/en/status')
    );

    if (shouldNoindexByHeader) {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }

    // Chamadas de API bem-sucedidas eram descartadas por completo aqui. O efeito colateral
    // foi caro: quando alguém passou a martelar /api/admin/get-source pra extrair URLs da
    // Nixplay, tudo respondia 200 e NADA aparecia no Axiom — o dono do provedor via as
    // conexões e nós não víamos requisição nenhuma. Agora amostramos, em vez de cegar:
    // uma fração dos 200 é logada, com `sampleRate` pra reconstruir o volume real.
    // Erros (>= 400) continuam sendo logados integralmente, sem amostragem.
    let apiSampleRate = 1;
    if (isInternalApi && response.status < 400) {
        const taxa = Number(getEnv('API_LOG_SAMPLE_RATE', '0.05'));
        if (!(taxa > 0) || Math.random() >= taxa) {
            return response;
        }
        apiSampleRate = taxa;
    } else if (response.status === 200) {
        // Página servida com sucesso é o evento mais repetitivo e menos informativo do log:
        // eram ~115 mil por dia, todos iguais. E como `axiomService.ingest()` faz `flush()`
        // explícito (1 POST HTTP por evento, ver o comentário lá — é proposital e correto),
        // cada um desses virava uma SUBREQUISIÇÃO extra pendurada na requisição do usuário.
        // Era a maior fonte isolada das ~1,7 milhão de subrequisições diárias da conta.
        // Amostrar aqui não cega o painel: `sampleRate` reconstrói o volume real na query
        // (`summarize sum(1.0/sampleRate)`), que é o mesmo mecanismo já usado nas APIs acima.
        //
        // Redirects (3xx) e erros (>= 400) seguem logados INTEGRALMENTE de propósito: são
        // baixo volume e são justamente o sinal de diagnóstico — foi o log completo dos 301
        // que revelou o bug de slug de idioma.
        const taxa = Number(getEnv('PAGE_LOG_SAMPLE_RATE', '0.1'));
        if (!(taxa > 0) || Math.random() >= taxa) {
            return response;
        }
        apiSampleRate = taxa;
    }

    // Log Assíncrono para o Axiom (Otimização: não bloqueia o retorno da resposta)
    // Se estiver na Cloudflare, usamos o context.waitUntil para garantir que o log seja enviado
    if (axiomService && typeof axiomService.logRequest === 'function') {
        const logPromise = axiomService.logRequest({
            method: context.request.method,
            // Usa "url" (capturado antes do next()) em vez de context.url.pathname —
            // Astro.rewrite("/404") muda context.url internamente, o que fazia todo
            // 404 do site aparecer genericamente como "/404" nos logs, escondendo qual
            // página real estava quebrada.
            url: url,
            status: response.status,
            duration: duration,
            userAgent: context.request.headers.get('user-agent'),
            referer: context.request.headers.get('referer'),
            ip: request.headers.get("cf-connecting-ip") || "127.0.0.1",
            host: host,
            query: apiSampleRate < 1 ? sanitizeQuery(context.url.searchParams) : null,
            sampleRate: apiSampleRate
        });

        if (context.locals.runtime?.waitUntil) {
            context.locals.runtime.waitUntil(logPromise);
        }
    }

    return response;
});
