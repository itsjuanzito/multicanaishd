// Worker dedicado aos crons do MultiCanaisHD.
//
// Por que existe separado do app Astro: o site roda em Cloudflare *Pages*, e Pages não
// suporta Cron Triggers (é recurso só de Workers). Em vez de migrar o site inteiro pra
// Workers só por causa disso, este Worker minúsculo carrega os agendamentos e não encosta
// no deploy do site.
//
// Substitui os workflows do GitHub Actions, que estouravam a cota da conta: eram ~20.300
// execuções/mês num plano de 2.000 minutos, e o GitHub cobra 1 minuto cheio por job mesmo
// quando o trabalho é um curl de 2 segundos.
// Domínio canônico. Vem do ambiente quando existir (`env.SITE_URL`), com fallback fixo.
//
// O literal fixo já custou caro: era `https://multicanaishd.lol`, que hoje é NXDOMAIN — o
// domínio não existe mais (migração para .lol). Como TODO job deste Worker passa por aqui,
// os quatro morriam no DNS antes de chegar no site, em silêncio: o `enrich-catalog` parou de
// progredir e o catálogo do sitemap ficou congelado em ~167 títulos dos ~43 mil disponíveis.
// `reconcile-payments` e `notificar` pararam junto.
//
// Ler do ambiente é o que impede a repetição: a próxima troca de domínio é uma var no painel,
// não uma edição de código. O fallback mantém o Worker funcionando mesmo sem a var definida.
const SITE_URL_PADRAO = 'https://multicanaishd.lol';
const resolverSiteUrl = (env) => String(env?.SITE_URL || SITE_URL_PADRAO).trim().replace(/\/+$/, '');

// Timeout por job. O Worker tem teto de wall time por invocação e um endpoint pendurado não
// pode impedir os outros jobs do mesmo tick de rodarem.
const JOB_TIMEOUT_MS = 60000;

// Um único Cron Trigger (*/5) dispara tudo; a cadência real de cada job vem do
// `everyMinutes` daqui. Isso mantém o Worker dentro do limite de 3 triggers do plano free
// e deixa as cadências num lugar só, em vez de espalhadas por 6 arquivos de workflow.
const HTTP_JOBS = [
    { name: 'check-status', path: '/api/internal/check-status', everyMinutes: 5 },
    { name: 'enrich-catalog', path: '/api/internal/enrich-catalog', everyMinutes: 10 },
    { name: 'notificar', path: '/api/cron/notificar', everyMinutes: 15 },
    // Rede de segurança do crédito de VIP: reconfirma na API do LivePix os
    // pagamentos `pending` e ativa quem já pagou, sem depender do webhook chegar.
    // 10min é o atraso máximo aceito pra um cliente que acabou de pagar; abaixo
    // disso o ganho é pequeno e o custo em chamadas ao LivePix cresce à toa.
    { name: 'reconcile-payments', path: '/api/internal/reconcile-payments', everyMinutes: 10 },
    // Pré-aquece o cache do sitemap: invalida e regenera. Ele é servido por 6h (KV) e a
    // geração de uma passada fria custa segundos (dezenas de listas no TMDB, mais 2 chamadas
    // por série no ar para montar as URLs de episódio). Sem este job, quem paga esse tempo é
    // a PRIMEIRA requisição depois do TTL — que costuma ser o Googlebot, e busca de sitemap
    // que demora demais vira "não foi possível buscar" no Search Console, exatamente o
    // sintoma que motivou esta auditoria.
    //
    // O endpoint é o `warm-sitemap`, e não `/sitemap.xml`, de propósito: bater na rota do
    // sitemap com cache quente responde do KV e NÃO renova o TTL, então o cache expirava no
    // meio do intervalo e ficava horas frio até o próximo tick.
    //
    // 300min (5h) é mais curto que o TTL de 6h: o `%` do dispatcher alinha ao relógio de
    // parede, então na virada do dia o intervalo cai para 4h — ainda abaixo do TTL.
    { name: 'sitemap-warm', path: '/api/internal/warm-sitemap', everyMinutes: 300 },
    // Detecção automática de bloqueio legal (451) com auto-rotação Anti-DMCA. Lê o relatório
    // da Analytics API do Cloudflare e move o canônico das obras bloqueadas.
    //
    // 10min porque o 451 já bloqueia o Googlebot entre a queda e a rotação, e o relatório tem
    // latência de agregação de poucos minutos — correr mais rápido que isso só gasta leitura,
    // já que a guarda anti-loop (slug do caminho === canônico atual) evita repetir a rotação.
    // 10 é divisível pelo trigger de 5min, então o job cai em todo minuto múltiplo de 10.
    { name: 'dmca-watch', path: '/api/internal/dmca-watch', everyMinutes: 10 }
];

/** Minutos decorridos desde a meia-noite UTC — alinha `everyMinutes` ao relógio de parede. */
function minutesOfDay(date) {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function isHttpJobDue(job, date) {
    return minutesOfDay(date) % job.everyMinutes === 0;
}

/**
 * Chama um endpoint interno do site. O segredo vai no header `Authorization`, nunca na query
 * string como faziam os workflows — assim ele não vaza em log de acesso nem em referer.
 */
async function runHttpJob(job, env) {
    const response = await fetch(`${resolverSiteUrl(env)}${job.path}`, {
        headers: {
            Authorization: `Bearer ${env.CRON_SECRET}`,
            // middleware.js bloqueia com 403 qualquer request de User-Agent vazio como
            // bot cru — fetch() do Worker não manda UA nenhum por padrão.
            'User-Agent': 'multicanaishd-cron-worker'
        },
        signal: AbortSignal.timeout(JOB_TIMEOUT_MS)
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return { name: job.name, ok: true };
}

/** Nunca propaga erro: um job quebrado não pode derrubar os outros do mesmo tick. */
async function runSafely(name, task) {
    try {
        return await task();
    } catch (error) {
        console.error(`[Cron] ${name} falhou:`, error?.message || error);
        return { name, ok: false, error: String(error?.message || error) };
    }
}

async function runDueJobs(date, env) {
    const pending = HTTP_JOBS
        .filter((job) => isHttpJobDue(job, date))
        .map((job) => runSafely(job.name, () => runHttpJob(job, env)));

    return Promise.all(pending);
}

export default {
    async scheduled(event, env) {
        const date = new Date(event.scheduledTime);
        // Loga o alvo uma vez por tick: sem isso, um SITE_URL morto só aparece como quatro
        // "fetch failed" genéricos, que foi como este Worker ficou parado sem ninguém notar.
        console.log(`[Cron] alvo=${resolverSiteUrl(env)}`);
        const results = await runDueJobs(date, env);
        console.log(`[Cron] ${date.toISOString()}`, JSON.stringify(results));
    },

    // Substitui o `workflow_dispatch` dos workflows: permite disparar o ciclo na mão.
    // Sem isso, um Worker de cron não tem como ser testado a não ser esperando o horário.
    async fetch(request, env) {
        const authHeader = request.headers.get('authorization');
        if (!env.CRON_SECRET || authHeader !== `Bearer ${env.CRON_SECRET}`) {
            return new Response('Não autorizado.', { status: 401 });
        }

        const results = await runDueJobs(new Date(), env);
        return Response.json({ success: true, alvo: resolverSiteUrl(env), results });
    }
};
