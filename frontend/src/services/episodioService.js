// src/services/episodioService.js
// Resolve os dados de uma página de episódio e diz à ROTA o que fazer.
//
// O controle de fluxo (redirect 301, rewrite pro 404, indisponibilidade de origem) tem que
// acontecer na rota: `Astro.redirect`/`Astro.rewrite` chamados dentro de um componente não
// produzem resposta nenhuma — o render simplesmente termina e o corpo sai vazio, com status
// 200. Por isso este serviço devolve uma decisão, e quem a executa é a página.
//
// Control flow must live in the route: Astro.redirect/rewrite called from inside a component
// silently yields an empty 200 body. This service returns a decision; the route acts on it.
import { getTMDBDetails, getTMDBSeasonDetails } from "./tmdb.js";
import { slugDeDetalhes } from "../utils/canonicalSlug.js";
import { resolveRotatedSlug } from "./urlRotationService.js";

// Tetos iguais aos da rota de série: barram lixo (?episode=999999) sem julgar série longa —
// novelas diárias passam de 1500 episódios com folga.
const MAX_TEMPORADA = 200;
const MAX_EPISODIO = 20000;

/**
 * @param {{slug: string, temporada: string, episodio: string}} params  Params da rota.
 * @param {string} lang  'pt' | 'en'
 * @returns {Promise<{tipo: 'notFound'|'redirect'|'unavailable'|'ok', motivo?: string, destino?: string, dados?: object}>}
 */
export async function resolverEpisodio(params, lang = "pt") {
    const { slug, temporada, episodio } = params || {};
    const langPrefix = lang === "pt" ? "" : `/${lang}`;

    const idMatch = String(slug || "").match(/^(\d+)/);
    const id = idMatch ? idMatch[1] : null;
    const numeroTemporada = parseInt(temporada, 10);
    const numeroEpisodio = parseInt(episodio, 10);

    if (!id || !numerosValidos(numeroTemporada, numeroEpisodio)) {
        return { tipo: "notFound", motivo: "invalid_episode_params" };
    }

    const [detalhes, temporadaDados] = await Promise.all([
        getTMDBDetails(id, "tv", lang).catch((e) => {
            console.error("[Episodio] Fallback TMDB details:", e.message);
            return null;
        }),
        getTMDBSeasonDetails(id, numeroTemporada, lang).catch((e) => {
            console.error("[Episodio] Fallback TMDB season:", e.message);
            return null;
        }),
    ]);

    if (detalhes?.notFound) {
        return { tipo: "notFound", motivo: "tmdb_not_found" };
    }

    // Falha transitória de origem NÃO pode virar 404: 3.506 erros 5xx já paralisaram a
    // indexação do site uma vez, e desindexar por timeout é o mesmo erro com outra roupa.
    if (!detalhes) {
        return { tipo: "unavailable" };
    }

    // Temporada que o TMDB confirma NÃO existir = 404 legítimo. Antes este caso caía no mesmo
    // caminho de uma falha transitória (`episodios = []` → tipo "ok") e a página renderizava
    // 200, self-canonical, com título "Episódio N" e lista vazia — soft 404 em massa, já que
    // numerosValidos() só limita 1..200 de temporada por 1..20000 de episódio.
    if (temporadaDados?.notFound) {
        return { tipo: "notFound", motivo: "season_not_found" };
    }

    // Temporada que não carregou por falha de origem: 200 + noindex (unavailable), nunca 404
    // e nunca 200 com lista vazia. Sem a lista não há episódio para montar a página.
    if (temporadaDados === null) {
        return { tipo: "unavailable" };
    }

    // Se a série sofreu rotação Anti-DMCA, o slug rotacionado tem prioridade sobre o base —
    // mesma regra da página da série (ver serie/[slug].astro), senão o link "Ver a série" e o
    // "Início" desta página levam pro slug antigo e voltam a saltar pra URL rotacionada via 301.
    // O idioma é o DESTA rota: cada idioma tem sua própria coluna de rotação em url_rotations.
    const canonicalSlugEpisodio = slugDeDetalhes(id, detalhes, lang);
    const slugCanonico = await resolveRotatedSlug(id, "series", canonicalSlugEpisodio, lang);

    const caminhoCanonico = `${langPrefix}/serie/${slugCanonico}/temporada-${numeroTemporada}/episodio-${numeroEpisodio}`;
    if (slug !== slugCanonico) {
        return { tipo: "redirect", destino: caminhoCanonico };
    }

    const episodios = temporadaDados?.episodes || [];
    const episodioAtual = episodios.find((ep) => ep.episode_number === numeroEpisodio) || null;

    // Chegando aqui a temporada carregou (os dois casos de falha saíram acima), então episódio
    // fora da lista é 404 legítimo — não sobra caminho em que `episodios` chegue vazio.
    if (!episodioAtual) {
        return { tipo: "notFound", motivo: "episode_not_in_season" };
    }

    return {
        tipo: "ok",
        dados: {
            id,
            lang,
            langPrefix,
            slugCanonico,
            caminhoCanonico,
            detalhes,
            episodios,
            episodioAtual,
            numeroTemporada,
            numeroEpisodio,
        },
    };
}

function numerosValidos(temporada, episodio) {
    if (Number.isNaN(temporada) || Number.isNaN(episodio)) return false;
    if (temporada < 1 || episodio < 1) return false;
    return temporada <= MAX_TEMPORADA && episodio <= MAX_EPISODIO;
}
