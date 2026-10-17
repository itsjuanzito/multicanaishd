// src/services/sitemapEpisodios.js
//
// URLs de episódio no sitemap.
//
// A rota `/serie/{slug}/temporada-N/episodio-M` já existe, é self-canonical, tem título,
// sinopse e schema próprios e é linkada pela página da série — mas NENHUMA delas era
// anunciada. Para um site de streaming, "assistir <série> episódio N dublado" é uma fatia
// real de busca, e era a maior categoria de conteúdo do site fora do sitemap.
//
// Por que não entram TODAS: o catálogo tem ~12,6 mil séries. Anunciar todo episódio de toda
// série significa milhões de URLs, muito acima do limite de 50 mil por arquivo do protocolo,
// e um custo de geração que estoura o Worker. Então o corte é por VALOR e por CUSTO:
//   - só séries atualmente no ar (fonte `tv/on_the_air`), que são as que têm demanda por
//     episódio específico — ninguém busca "série cancelada em 2011 temporada 3 episódio 7";
//   - teto de séries processadas por geração (cada uma custa 2 chamadas ao TMDB);
//   - teto de episódios por série, para uma novela de 1.500 capítulos não dominar o arquivo.
//
// Os dois tetos são ajustáveis por env (`SITEMAP_EPISODIOS_MAX_SERIES` e
// `SITEMAP_EPISODIOS_POR_SERIE`) porque o número certo depende do plano da Cloudflare e de
// quanto rastreamento se quer. Com os padrões, o acréscimo é de ~25×2 chamadas ao TMDB e no
// máximo ~1.500 entradas — pequeno o bastante para não ameaçar o orçamento de subrequests.
import { getEnv } from './env-adapter.js';

const MAX_SERIES_PADRAO = 25;
const MAX_EPISODIOS_PADRAO = 30;
const CONCORRENCIA = 5;

/**
 * Lê o teto do ambiente, com fallback. Aceita 0 para desligar a coleta.
 *
 * O cuidado aqui não é cosmético: `Number('')` é 0, então ler a env crua e comparar `>= 0`
 * transformava "variável não definida" em "desligado" — o recurso simplesmente não rodava em
 * produção sem ninguém perceber, e o único sinal seria a ausência de URLs de episódio.
 * String vazia/ausente vale o PADRÃO; só o "0" digitado significa desligar.
 */
export function lerLimite(nomeEnv, padrao) {
    const bruto = getEnv(nomeEnv, '');
    if (bruto === null || bruto === undefined || String(bruto).trim() === '') return padrao;
    const numero = Number(bruto);
    if (!Number.isFinite(numero) || numero < 0) return padrao;
    return Math.floor(numero);
}

/**
 * Temporada mais recente "normal" (season_number > 0) segundo os detalhes do TMDB.
 * Especial/temporada 0 é descartada: costuma ser extras e não é o que a busca procura.
 * @returns {number|null} número da temporada
 */
export function temporadaMaisRecente(detalhes) {
    const temporadas = (detalhes?.seasons || [])
        .map((s) => Number(s?.season_number))
        .filter((n) => Number.isInteger(n) && n > 0);
    if (temporadas.length === 0) return null;
    return temporadas.reduce((maior, n) => (n > maior ? n : maior));
}

/**
 * Monta as entradas do sitemap para uma série. Puro de propósito: é a parte que decide URL e
 * `lastmod`, ou seja, exatamente o que precisa de teste sem rede.
 *
 * `enSlug` nulo significa que o slug canônico em inglês é desconhecido — e aí o alternate NÃO
 * é emitido (mesma regra do resto do sitemap): chutar produziria uma URL que responde 301.
 */
export function montarEntradasDeEpisodios({ id, ptSlug, enSlug, temporada, episodios }) {
    if (!id || !ptSlug || !Number.isInteger(temporada)) return [];
    const semEn = !enSlug;

    return (episodios || [])
        .filter((ep) => Number.isInteger(Number(ep?.episode_number)) && Number(ep.episode_number) > 0)
        .sort((a, b) => Number(a.episode_number) - Number(b.episode_number))
        .slice(0, lerLimite('SITEMAP_EPISODIOS_POR_SERIE', MAX_EPISODIOS_PADRAO))
        .map((ep) => {
            const sufixo = `/temporada-${temporada}/episodio-${ep.episode_number}`;
            // Episódio ainda sem data de exibição não vira lastmod — o Google recusa data
            // inventada, e o TTL do resto do arquivo já cobre o recrawl.
            const data = typeof ep.air_date === 'string' && ep.air_date >= '1970-01-01' ? ep.air_date : null;
            return {
                path: `/serie/${id}-${ptSlug}${sufixo}`,
                enPath: semEn ? null : `/serie/${id}-${enSlug}${sufixo}`,
                enUnknown: semEn,
                image: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null,
                title: ep.name || `Episódio ${ep.episode_number}`,
                priority: '0.6',
                changefreq: 'monthly',
                lastmod: data,
            };
        });
}

/**
 * Coleta as entradas de episódio das séries candidatas.
 *
 * `paresDeSlug` é o mapa já calculado por coletarEntradas (`tv:<id>` -> {pt, en}) — usar o
 * MESMO slug que a entrada da série garante que o sitemap não anuncie uma URL que a rota de
 * destino responde 301. Sem par, a série é pulada em vez de chutada.
 *
 * Nenhum caminho lança: cada item é isolado, para uma série problemática não derrubar a
 * geração do sitemap inteiro (regra §2.2 do code.md).
 */
export async function coletarEntradasDeEpisodios({
    candidatos = [],
    paresDeSlug = {},
    obterDetalhes,
    obterTemporada,
} = {}) {
    const limite = lerLimite('SITEMAP_EPISODIOS_MAX_SERIES', MAX_SERIES_PADRAO);
    if (limite === 0 || typeof obterDetalhes !== 'function' || typeof obterTemporada !== 'function') {
        return [];
    }

    const processarSerie = async (id) => {
        const par = paresDeSlug[`tv:${Number(id)}`];
        if (!par?.pt) return [];
        try {
            const detalhes = await obterDetalhes(id);
            if (!detalhes || detalhes.notFound) return [];

            const temporada = temporadaMaisRecente(detalhes);
            if (temporada === null) return [];

            const dados = await obterTemporada(id, temporada);
            if (!dados?.episodes?.length) return [];

            return montarEntradasDeEpisodios({
                id,
                ptSlug: par.pt,
                enSlug: par.en,
                temporada,
                episodios: dados.episodes,
            });
        } catch (e) {
            console.error(`[Sitemap] Falha ao coletar episódios da série ${id}:`, e?.message || e);
            return [];
        }
    };

    const alvo = candidatos.slice(0, limite);
    const entradas = [];
    for (let i = 0; i < alvo.length; i += CONCORRENCIA) {
        const resultados = await Promise.all(alvo.slice(i, i + CONCORRENCIA).map(processarSerie));
        for (const lista of resultados) entradas.push(...lista);
    }
    return entradas;
}
