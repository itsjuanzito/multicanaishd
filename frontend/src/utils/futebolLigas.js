// src/utils/futebolLigas.js
// Configuração das ligas que ganham página própria de "futebol ao vivo".
// Config for the leagues that get their own "live soccer" landing page.
//
// O campo `matchers` casa contra `game.data.league`, que vem da API de jogos como texto
// livre ("Brasileirão Série A", "CONMEBOL Libertadores", "UEFA Champions League"...). Por
// isso é uma lista de substrings normalizadas, não igualdade: a fonte muda o rótulo sem
// avisar e uma página de liga vazia é pior do que uma página com um jogo a mais.

import { slugify } from "./slugify.js";

/**
 * Normaliza o nome da liga pra comparação por substring.
 * Reaproveita o slugify oficial (minúsculo, sem acento, sem pontuação) e devolve com
 * espaços em vez de hífens, pra que matchers de duas palavras ("serie a") casem natural.
 */
export const normalizarLiga = (valor) => {
    if (!valor) return "";
    return slugify(valor).replace(/-/g, " ").trim();
};

export const LIGAS = [
    {
        slug: "futebol-ao-vivo",
        matchers: null, // null = aceita qualquer liga (hub geral)
        pt: {
            nome: "Futebol Ao Vivo",
            titulo: "Futebol Ao Vivo Hoje - Assistir Jogos Online Grátis em HD",
            heading: "Futebol ao vivo hoje",
            descricao: "Veja os jogos de futebol ao vivo hoje e assista online grátis em HD no MultiCanaisHD. Grade atualizada com horário, campeonato e transmissão de cada partida.",
            intro: "Todos os jogos de hoje em uma página só: quem já está em campo, quem entra mais tarde e o link direto para a transmissão de cada partida.",
        },
        en: {
            nome: "Live Soccer",
            titulo: "Live Soccer Today - Watch Matches Online Free in HD",
            heading: "Live soccer today",
            descricao: "See today's live soccer matches and watch them online free in HD on MultiCanaisHD. Updated schedule with kickoff time, competition and stream for every game.",
            intro: "Every match of the day in one place: what is already being played, what kicks off later, and a direct link to each broadcast.",
        },
    },
    {
        slug: "brasileirao",
        matchers: ["brasileirao", "brasileiro", "serie a", "serie b", "campeonato brasileiro"],
        pt: {
            nome: "Brasileirão",
            titulo: "Brasileirão Ao Vivo - Assistir Jogos do Brasileirão Online Grátis",
            heading: "Brasileirão ao vivo",
            descricao: "Assista aos jogos do Brasileirão ao vivo online grátis em HD. Confira a rodada de hoje com horários, times e transmissão ao vivo no MultiCanaisHD.",
            intro: "A rodada do Campeonato Brasileiro reunida aqui: partidas em andamento, os próximos confrontos do dia e o acesso direto a cada transmissão.",
        },
        en: {
            nome: "Brasileirao",
            titulo: "Brasileirao Live - Watch Brazilian League Matches Online Free",
            heading: "Brasileirao live",
            descricao: "Watch Brasileirao matches live online free in HD. Today's round with kickoff times, teams and live streams on MultiCanaisHD.",
            intro: "The Brazilian league round in one page: matches in progress, the next fixtures of the day and direct access to every stream.",
        },
    },
    {
        slug: "libertadores",
        matchers: ["libertadores", "conmebol", "sudamericana"],
        pt: {
            nome: "Libertadores",
            titulo: "Libertadores Ao Vivo - Assistir Jogos Online Grátis em HD",
            heading: "Libertadores ao vivo",
            descricao: "Assista aos jogos da Libertadores ao vivo online grátis em HD. Veja os confrontos de hoje com horário e transmissão direto no MultiCanaisHD.",
            intro: "Os jogos da Libertadores e da Sul-Americana do dia, com quem já está em campo e os horários dos confrontos que ainda vão começar.",
        },
        en: {
            nome: "Libertadores",
            titulo: "Libertadores Live - Watch Matches Online Free in HD",
            heading: "Libertadores live",
            descricao: "Watch Libertadores matches live online free in HD. Today's fixtures with kickoff times and streams on MultiCanaisHD.",
            intro: "Libertadores and Sudamericana fixtures for the day, with live matches first and kickoff times for the rest.",
        },
    },
    {
        slug: "champions-league",
        matchers: ["champions", "uefa", "europa league", "premier league", "laliga", "la liga", "serie a italia", "bundesliga"],
        pt: {
            nome: "Champions League",
            titulo: "Champions League Ao Vivo - Assistir Jogos Online Grátis em HD",
            heading: "Champions League e futebol europeu ao vivo",
            descricao: "Assista à Champions League e ao futebol europeu ao vivo online grátis em HD. Jogos de hoje com horário, campeonato e transmissão no MultiCanaisHD.",
            intro: "Champions, Premier League, LaLiga e o resto do futebol europeu do dia, com as partidas ao vivo no topo da grade.",
        },
        en: {
            nome: "Champions League",
            titulo: "Champions League Live - Watch Matches Online Free in HD",
            heading: "Champions League and European soccer live",
            descricao: "Watch the Champions League and European soccer live online free in HD. Today's matches with kickoff times and streams on MultiCanaisHD.",
            intro: "Champions League, Premier League, LaLiga and the rest of the European schedule, with live matches listed first.",
        },
    },
];

/** Config de uma liga pelo slug, ou null se o slug não existir. */
export const obterLiga = (slug) => LIGAS.find((liga) => liga.slug === slug) || null;

/** True se o jogo pertence à liga. Liga sem `matchers` (hub geral) aceita tudo. */
export const jogoPertenceALiga = (jogo, liga) => {
    if (!liga?.matchers) return true;
    const nomeLiga = normalizarLiga(jogo?.data?.league);
    if (!nomeLiga) return false;
    return liga.matchers.some((termo) => nomeLiga.includes(termo));
};
