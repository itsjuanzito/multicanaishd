// src/services/dmcaWatchService.js
//
// Detecção automática de bloqueio legal (HTTP 451) com auto-rotação Anti-DMCA.
//
// POR QUE EXISTE: o Cloudflare responde 451 ANTES da requisição chegar no Worker, então o
// servidor não tem como saber quais URLs estão bloqueadas — o log de requisição não vê nada.
// Quem vê é a Analytics API do Cloudflare (`httpRequestsAdaptiveGroups` filtrado por
// `edgeResponseStatus: 451`). Este serviço lê esse relatório, cruza com o canônico ATUAL de
// cada obra e rotaciona o slug quando ele bate.
//
// O TOKEN (CLOUDFLARE_ANALYTICS_TOKEN) NUNCA é hardcoded: vem de `getEnv`, que em produção lê
// a env var/secret do Cloudflare Pages. Ausente = `{ ok: false, motivo: 'token_ausente' }`,
// nunca exceção.
//
// A ZONA não é chumbada: o zone id muda quando o site troca de domínio (já trocou duas vezes),
// então é resolvido em runtime por `GET /client/v4/zones?name=<host canônico>` e cacheado no
// KV (`SESSION`) por 24h. O host vem de `getSiteUrl()`.
import { getEnv, getSiteUrl } from './env-adapter.js';
import { getConfig } from './configService.js';
import { rotateMediaUrl, resolveRotatedSlug, getActiveRotation } from './urlRotationService.js';
import { getTMDBDetails } from './tmdb.js';
import { slugDeDetalhes } from '../utils/canonicalSlug.js';

export const CHAVE_LOG = 'dmca_watch_log_v1';
export const PREFIXO_ZONA = 'cf_zone_v1:';
export const LIMITE_LOG = 100;
export const JANELA_MINUTOS = 120;

const TTL_ZONA_S = 60 * 60 * 24; // 24h
const TTL_LOG_S = 60 * 60 * 24 * 30; // 30 dias
const TETO_KV_MS = 8000;
const API_CLOUDFLARE = 'https://api.cloudflare.com/client/v4';

// Consulta validada contra a API real (zona do multicanaishd.lol, outubro/2026): devolve
// `data.viewer.zones[0].httpRequestsAdaptiveGroups = [{ count, dimensions: { clientRequestPath } }]`.
const CONSULTA_451 = `query($zone:String!,$since:Time!,$until:Time!){viewer{zones(filter:{zoneTag:$zone}){httpRequestsAdaptiveGroups(limit:500,filter:{edgeResponseStatus:451,datetime_geq:$since,datetime_leq:$until},orderBy:[count_DESC]){count dimensions{clientRequestPath}}}}}`;

// `/filme/<id-slug>` ou `/serie/<id-slug>`, com prefixo `/en` opcional. É a página da obra:
// filme não tem sub-caminho (`/filme/x/algo` não casa), canal, gênero e estáticos não casam.
const CAMINHO_OBRA = /^\/(?:(en)\/)?(filme|serie)\/(\d+)-([^/?#]+?)\/?$/i;

// `/serie/<id-slug>/temporada-<N>/episodio-<M>` (com `/en` opcional). A rotação Anti-DMCA é do
// slug da SÉRIE: o caminho do episódio muda junto quando o slug da série rotaciona, então o
// alvo aqui continua sendo a série — só o `path` guardado mostra qual episódio foi o gatilho.
const CAMINHO_EPISODIO = /^\/(?:(en)\/)?(serie)\/(\d+)-([^/?#]+?)\/temporada-(\d+)\/episodio-(\d+)\/?$/i;

const TETO_KV = Symbol('kv-timeout');

/** Teto de tempo para qualquer operação de KV — cache é opcional, não pode segurar o cron. */
function comTeto(promessa, ms) {
    return Promise.race([
        promessa,
        new Promise((resolve) => setTimeout(() => resolve(TETO_KV), ms)),
    ]);
}

async function lerKv(chave) {
    try {
        const kv = getEnv('SESSION');
        if (typeof kv?.get !== 'function') return null;
        const valor = await comTeto(kv.get(chave), TETO_KV_MS);
        if (valor === TETO_KV) return null;
        return valor ?? null;
    } catch (e) {
        return null;
    }
}

async function gravarKv(chave, valor, opcoes = {}) {
    try {
        const kv = getEnv('SESSION');
        if (typeof kv?.put !== 'function') return false;
        const resultado = await comTeto(kv.put(chave, valor, opcoes), TETO_KV_MS);
        return resultado !== TETO_KV;
    } catch (e) {
        return false;
    }
}

/** Host canônico atual (sem protocolo/porta) — base da resolução de zona. */
function hostCanonico() {
    try {
        return new URL(getSiteUrl()).hostname.toLowerCase();
    } catch (e) {
        return '';
    }
}

/** Monta a obra alvo — o slug é sempre o da obra, nunca `temporada-N/episodio-M`. */
function criarAlvo(path, match, ehEpisodio) {
    const [, prefixoEn, rota, mediaId, cauda] = match;
    const alvo = {
        path,
        mediaId,
        mediaType: rota.toLowerCase() === 'serie' ? 'series' : 'movie',
        lang: prefixoEn ? 'en' : 'pt',
        slug: `${mediaId}-${cauda}`,
    };
    if (ehEpisodio) alvo.ehEpisodio = true;
    return alvo;
}

/**
 * Extrai a obra de um caminho bloqueado. Devolve `null` para tudo que não é página de
 * conteúdo (canal, gênero, assets). Episódio de série é escopo: o alvo é a série dona dele.
 */
export function parseCaminhoBloqueado(path) {
    if (typeof path !== 'string') return null;
    const limpo = path.trim();
    const episodio = CAMINHO_EPISODIO.exec(limpo);
    if (episodio) return criarAlvo(limpo, episodio, true);
    const obra = CAMINHO_OBRA.exec(limpo);
    if (obra) return criarAlvo(limpo, obra, false);
    return null;
}

/** Janela dos últimos `JANELA_MINUTOS` minutos, em ISO-8601 (formato aceito por `Time!`). */
export function montarJanela(agora = Date.now()) {
    return {
        since: new Date(agora - JANELA_MINUTOS * 60000).toISOString(),
        until: new Date(agora).toISOString(),
    };
}

async function buscarZoneNaApi(token, host) {
    try {
        const resposta = await fetch(`${API_CLOUDFLARE}/zones?name=${encodeURIComponent(host)}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!resposta.ok) return null;
        const json = await resposta.json();
        const id = json?.result?.[0]?.id;
        return typeof id === 'string' && id ? id : null;
    } catch (e) {
        return null;
    }
}

/**
 * Zone id do domínio canônico: KV (24h) → API de zonas por nome. Sem KV a resolução continua
 * funcionando (só não fica cacheada). Sem token/host/zona devolve `null` — quem chama decide
 * o `motivo` da falha.
 */
export async function resolverZoneId({ token, host }) {
    if (!token || !host) return null;
    const chave = `${PREFIXO_ZONA}${host}`;
    const cacheada = await lerKv(chave);
    if (cacheada) return String(cacheada);
    const id = await buscarZoneNaApi(token, host);
    if (!id) return null;
    await gravarKv(chave, id, { expirationTtl: TTL_ZONA_S });
    return id;
}

async function consultar451({ token, zone, janela }) {
    const resposta = await fetch(`${API_CLOUDFLARE}/graphql`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: CONSULTA_451,
            variables: { zone, since: janela.since, until: janela.until },
        }),
    });
    if (!resposta.ok) throw new Error(`Cloudflare GraphQL HTTP ${resposta.status}`);
    const json = await resposta.json();
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
        throw new Error(json.errors[0]?.message || 'erro GraphQL');
    }
    const grupos = json?.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups;
    return Array.isArray(grupos) ? grupos : [];
}

/** Slug base canônico pelo TMDB (sem rotação). `null` = não deu para determinar. */
async function baseDoTmdb(mediaId, mediaType, lang) {
    try {
        const detalhes = await getTMDBDetails(mediaId, mediaType === 'series' ? 'tv' : 'movie', lang);
        if (!detalhes) return null;
        return slugDeDetalhes(mediaId, detalhes, lang) || null;
    } catch (e) {
        return null;
    }
}

/**
 * Base canônica da obra: o `original_slug` da rotação (quando existe) é a fonte barata e
 * exata; sem linha de rotação, cai no slug do TMDB no idioma do caminho.
 */
async function baseCanonica(mediaId, mediaType, lang) {
    const rotacao = await getActiveRotation(mediaId, mediaType).catch(() => null);
    const daRotacao = (lang === 'en' ? rotacao?.original_slug_en : rotacao?.original_slug) || null;
    if (daRotacao) return daRotacao;
    return baseDoTmdb(mediaId, mediaType, lang);
}

/**
 * Slug canônico ATUAL da obra no idioma do caminho — a peça central da guarda anti-loop.
 * `null` quando não há base de slug (nem rotação, nem TMDB).
 */
export async function canonicoAtual(mediaId, mediaType, lang, cache = null) {
    const chave = `${mediaType}:${mediaId}:${lang}`;
    if (cache?.has(chave)) return cache.get(chave);
    const base = await baseCanonica(mediaId, mediaType, lang);
    let canonico = null;
    if (base) {
        canonico = await resolveRotatedSlug(mediaId, mediaType, base, lang).catch(() => null);
    }
    if (cache) cache.set(chave, canonico || null);
    return canonico || null;
}

async function rotacionar(alvo) {
    try {
        const resultado = await rotateMediaUrl({
            input: alvo.slug,
            forcedType: alvo.mediaType,
            lang: alvo.lang,
        });
        return { alvo, acao: 'rotacionado', novoSlug: resultado?.newSlug || null };
    } catch (error) {
        // Um erro de rotação NÃO pode derrubar o laço: vira uma entrada `erro` e o próximo
        // caminho é processado normalmente.
        return { alvo, acao: 'erro', motivo: String(error?.message || error).slice(0, 180) };
    }
}

/**
 * GUARDA ANTI-LOOP.
 *
 * Rotacionar por 451 é idempotente só enquanto o slug bloqueado É o canônico. Depois da
 * rotação, o caminho antigo continua aparecendo no relatório por até 2h (e o Cloudflare
 * eventualmente serve 301), mas o canônico já é outro. Sem comparar os dois, o job
 * rotacionaria a mesma obra a cada execução, para sempre, queimando o slug novo em minutos.
 */
async function processarCaminho(caminho, ctx) {
    const alvo = parseCaminhoBloqueado(caminho.path);
    if (!alvo) return { alvo: null, acao: 'informativo', motivo: 'fora_de_escopo' };
    // A guarda compara o slug da OBRA (para episódio, o slug da série): o caminho pode ter
    // temporada/episódio, mas quem rotaciona é a série.
    const canonico = await canonicoAtual(alvo.mediaId, alvo.mediaType, alvo.lang, ctx.bases)
        .catch(() => null);
    if (!canonico) return { alvo, acao: 'ignorado', motivo: 'sem_canonico' };
    if (canonico !== alvo.slug) return { alvo, acao: 'ignorado', motivo: 'slug_antigo' };
    if (!ctx.autoRotate) return { alvo, acao: 'informativo', motivo: 'auto_rotate_desligado' };
    const resultado = await rotacionar(alvo);
    // A rotação muda o canônico (o L1 do urlRotationService já foi atualizado). Sem descartar
    // o cache desta execução, a página da série e um episódio dela no mesmo lote rotacionariam
    // duas vezes — a segunda tem que enxergar o canônico novo e cair em `slug_antigo`.
    if (resultado.acao === 'rotacionado') {
        ctx.bases.delete(`${alvo.mediaType}:${alvo.mediaId}:${alvo.lang}`);
    }
    return resultado;
}

function montarEntrada(path, count, resultado) {
    const entrada = { em: new Date().toISOString(), path, count, acao: resultado.acao };
    if (resultado.alvo) {
        entrada.mediaId = resultado.alvo.mediaId;
        entrada.mediaType = resultado.alvo.mediaType;
        entrada.lang = resultado.alvo.lang;
        // Deixa explícito no log que o gatilho foi um episódio e que a série foi rotacionada.
        if (resultado.alvo.ehEpisodio) entrada.ehEpisodio = true;
    }
    if (resultado.novoSlug) entrada.novoSlug = resultado.novoSlug;
    if (resultado.motivo) entrada.motivo = resultado.motivo;
    return entrada;
}

/** Anel de no máximo 100 entradas no KV, TTL 30 dias. Falhar em logar não falha a execução. */
async function registrarLog(entradas) {
    if (!entradas.length) return false;
    try {
        const anteriores = await lerLogDmca();
        const anel = [...entradas, ...anteriores].slice(0, LIMITE_LOG);
        return await gravarKv(CHAVE_LOG, JSON.stringify(anel), { expirationTtl: TTL_LOG_S });
    } catch (error) {
        console.error('[dmcaWatch] Falha ao gravar o log:', error?.message || error);
        return false;
    }
}

/** Log de detecções (mais recentes primeiro). Nunca lança. */
export async function lerLogDmca() {
    try {
        const raw = await lerKv(CHAVE_LOG);
        if (!raw) return [];
        const lista = JSON.parse(raw);
        return Array.isArray(lista) ? lista : [];
    } catch (e) {
        return [];
    }
}

/** O token da Analytics API está configurado neste ambiente? (usado pelo painel.) */
export function tokenAnalyticsConfigurado() {
    return Boolean(getEnv('CLOUDFLARE_ANALYTICS_TOKEN'));
}

async function configAutoRotate() {
    try {
        return (await getConfig('DMCA_AUTO_ROTATE', 'on')) === 'on';
    } catch (e) {
        return true;
    }
}

function resumir({ janela, resultados, autoRotate }) {
    const contar = (acao) => resultados.filter((r) => r.acao === acao).length;
    return {
        ok: true,
        janela,
        caminhos: resultados.length,
        rotacionados: contar('rotacionado'),
        ignorados: contar('ignorado'),
        erros: contar('erro'),
        autoRotate,
    };
}

async function varrerCaminhos({ grupos, janela, autoRotate }) {
    const ctx = { autoRotate, bases: new Map() };
    const resultados = [];
    const entradas = [];
    for (const grupo of grupos) {
        const path = String(grupo?.dimensions?.clientRequestPath || '');
        if (!path) continue;
        const count = Number(grupo?.count) || 0;
        const resultado = await processarCaminho({ path, count }, ctx);
        resultados.push(resultado);
        entradas.push(montarEntrada(path, count, resultado));
    }
    await registrarLog(entradas);
    return resumir({ janela, resultados, autoRotate });
}

/**
 * Executa a detecção e a auto-rotação. NUNCA lança: qualquer falha volta como
 * `{ ok: false, motivo, ... }` para o endpoint do cron responder 200.
 */
export async function executarDmcaWatch() {
    const token = getEnv('CLOUDFLARE_ANALYTICS_TOKEN');
    if (!token) return { ok: false, motivo: 'token_ausente' };
    const janela = montarJanela();
    try {
        const zone = await resolverZoneId({ token, host: hostCanonico() });
        if (!zone) return { ok: false, motivo: 'zona_nao_resolvida', janela };
        const grupos = await consultar451({ token, zone, janela });
        const autoRotate = await configAutoRotate();
        return await varrerCaminhos({ grupos, janela, autoRotate });
    } catch (error) {
        console.error('[dmcaWatch] Falha na execução:', error?.message || error);
        return {
            ok: false,
            motivo: 'falha_execucao',
            erro: String(error?.message || error),
            janela,
        };
    }
}
