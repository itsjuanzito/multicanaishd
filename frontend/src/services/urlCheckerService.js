// src/services/urlCheckerService.js
//
// Checagem SOB DEMANDA de URLs soltas — alimenta o endpoint /api/admin/check-urls do painel de
// moderação.
//
// Por que existe: o painel só sabia testar as rotações JÁ cadastradas. Quando o Cloudflare
// aplica 451 numa URL que ninguém rotacionou (ou numa URL /en/), não havia como descobrir o
// status sem abrir cada link na mão. Aqui o operador cola qualquer lista e vê o status.
//
// Regra que manda no desenho: nenhuma URL pode derrubar a resposta inteira. Cada item tem seu
// próprio .catch() (code.md §2.2) e falha vira `status: 0` + `erro`, nunca exceção.

export const MAX_URLS_POR_CHAMADA = 50;
const CONCORRENCIA = 5;
const TIMEOUT_MS = 10000;
// O UA do Googlebot é o ponto da checagem: o 451 do Cloudflare costuma ser aplicado por regra
// que distingue crawler de visitante. Um UA de navegador pode devolver 200 onde o Google vê 451.
export const UA_GOOGLEBOT =
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const HOSTS_INTERNOS = [
    /^localhost$/i,
    /\.localhost$/i,
    /\.internal$/i,
    /\.local$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^\[?::1\]?$/,
];

/**
 * Normaliza uma linha colada pelo operador em URL absoluta.
 * Aceita caminho relativo ("/filme/603-matrix") — é o caso natural dentro do painel, que roda
 * no mesmo domínio — e resolve contra a origem do request.
 * @returns {URL|null} null quando a entrada não é uma URL http(s) utilizável.
 */
export function prepararAlvo(entrada, origem) {
    const texto = String(entrada ?? '').trim();
    if (!texto) return null;
    try {
        const url = new URL(texto.startsWith('/') ? `${origem}${texto}` : texto);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url;
    } catch (e) {
        return null;
    }
}

/** Bloqueia alvos de rede interna (SSRF): o endpoint é autenticado, mas o Worker não é um proxy. */
export function hostBloqueado(url) {
    if (!url) return true;
    const host = String(url.hostname || '').toLowerCase();
    return HOSTS_INTERNOS.some((padrao) => padrao.test(host));
}

async function sondar(url, metodo) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        return await fetch(url.toString(), {
            method: metodo,
            redirect: 'manual',
            signal: controller.signal,
            headers: { 'User-Agent': UA_GOOGLEBOT, Accept: 'text/html,application/xhtml+xml,*/*' },
        });
    } finally {
        clearTimeout(timer);
    }
}

function descreverErro(erro) {
    if (erro?.name === 'AbortError' || erro?.name === 'TimeoutError') return 'timeout (10s)';
    return erro?.message || 'falha de rede';
}

/**
 * HEAD primeiro (barato) com fallback pra GET quando o método não é suportado ou falha:
 * alguns proxies/regras recusam HEAD, e o alvo aqui é o status que o Google receberia.
 */
async function checarUm(url) {
    let resposta;
    try {
        resposta = await sondar(url, 'HEAD');
        if (resposta.status === 405 || resposta.status === 501) {
            resposta = await sondar(url, 'GET');
        }
    } catch (erro) {
        return { url: url.toString(), status: 0, location: null, erro: descreverErro(erro) };
    }
    return {
        url: url.toString(),
        status: resposta.status,
        location: resposta.headers.get('location') || null,
    };
}

function semDuplicatas(lista) {
    const vistos = new Set();
    return lista.filter((url) => {
        if (vistos.has(url.href)) return false;
        vistos.add(url.href);
        return true;
    });
}

/**
 * Checa até MAX_URLS_POR_CHAMADA URLs com concorrência limitada.
 * Entradas inválidas/bloqueadas não são fetchadas — viram resultado com status 0 e motivo.
 * @returns {Promise<Array<{url: string, status: number, location: string|null, erro?: string}>>}
 */
export async function checarUrls(entradas, origem) {
    const linhas = Array.isArray(entradas) ? entradas : [];
    const validas = [];
    const invalidas = [];

    for (const linha of linhas) {
        const url = prepararAlvo(linha, origem);
        if (!url) {
            invalidas.push({ url: String(linha ?? '').trim(), status: 0, location: null, erro: 'URL inválida' });
            continue;
        }
        if (hostBloqueado(url)) {
            invalidas.push({ url: url.toString(), status: 0, location: null, erro: 'host interno bloqueado' });
            continue;
        }
        validas.push(url);
    }

    const alvos = semDuplicatas(validas).slice(0, MAX_URLS_POR_CHAMADA);
    const resultados = [];

    for (let i = 0; i < alvos.length; i += CONCORRENCIA) {
        const lote = alvos.slice(i, i + CONCORRENCIA);
        const parciais = await Promise.all(
            lote.map((url) =>
                checarUm(url).catch((erro) => ({
                    url: url.toString(),
                    status: 0,
                    location: null,
                    erro: descreverErro(erro),
                })),
            ),
        );
        resultados.push(...parciais);
    }

    return [...resultados, ...invalidas];
}
