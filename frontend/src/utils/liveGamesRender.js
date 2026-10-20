// src/utils/liveGamesRender.js
// Agrupa jogos por esporte e gera o HTML dos cards compactos da home.
// Usado pelo SSR (set:html) e pelo sync do cliente, para os dois nunca divergirem.

import { slugify } from "./slugify.js";

const DEFAULT_DURATION = 9000;
const MAX_PER_SPORT = 8;
const MAX_SPORTS = 4;

const SPORTS = {
    futebol: { icon: "⚽", pt: "Futebol", en: "Soccer" },
    basquete: { icon: "🏀", pt: "Basquete", en: "Basketball" },
    beisebol: { icon: "⚾", pt: "Beisebol", en: "Baseball" },
    tenis: { icon: "🎾", pt: "Tênis", en: "Tennis" },
    volei: { icon: "🏐", pt: "Vôlei", en: "Volleyball" },
    "futebol-americano": { icon: "🏈", pt: "Futebol Americano", en: "American Football" },
};

const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const toSeconds = (ts) => {
    const n = Number(ts);
    if (!n) return 0;
    return n > 9999999999 ? Math.floor(n / 1000) : n;
};

const timeLabel = (start) =>
    new Date(start * 1000).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Sao_Paulo",
    });

/** Aceita o jogo cru da API (title/data/sport) e o formato do cliente (nome/hora_inicio). */
export function normalizeGame(raw) {
    const title = raw?.title || raw?.nome || "";
    const parts = title.split(/\s+[xX]\s+/);
    const start = toSeconds(raw?.data?.timer?.start ?? raw?.hora_inicio);
    const end = toSeconds(raw?.data?.timer?.end ?? raw?.hora_fim) || (start ? start + DEFAULT_DURATION : 0);
    const home = raw?.data?.teams?.home;
    const away = raw?.data?.teams?.away;
    const sportRaw = String(raw?.sport || raw?.data?.sport || "").trim();
    const sportSlug = sportRaw ? slugify(sportRaw) : "futebol";
    return {
        id: raw?.id || `jogo_${slugify(title)}`,
        title,
        slug: slugify(title),
        canalId: `jogo_${slugify(title)}`,
        start,
        end,
        league: raw?.data?.league || "",
        home: home?.name ? home : { name: parts[0]?.trim() || "", image: null },
        away: away?.name ? away : { name: parts[1]?.trim() || "", image: null },
        sportSlug,
        sportName: sportRaw || SPORTS.futebol.pt,
    };
}

/** Descarta encerrados, ordena (ao vivo, depois por início) e agrupa por esporte (futebol primeiro). */
export function groupGames(rawGames, now = Math.floor(Date.now() / 1000)) {
    const games = (rawGames || [])
        .map(normalizeGame)
        .filter((g) => !g.end || now <= g.end)
        .sort((a, b) => {
            const liveA = a.start && now >= a.start ? 0 : 1;
            const liveB = b.start && now >= b.start ? 0 : 1;
            return liveA - liveB || a.start - b.start;
        });

    const groups = [];
    for (const game of games) {
        let group = groups.find((g) => g.slug === game.sportSlug);
        if (!group) {
            const meta = SPORTS[game.sportSlug] || { icon: "🏅", pt: game.sportName, en: game.sportName };
            group = { slug: game.sportSlug, meta, games: [] };
            groups.push(group);
        }
        if (group.games.length < MAX_PER_SPORT) group.games.push(game);
    }
    groups.sort((a, b) => (b.slug === "futebol") - (a.slug === "futebol"));
    return groups.slice(0, MAX_SPORTS);
}

export const groupsSignature = (groups) =>
    groups.map((g) => `${g.slug}:${g.games.map((x) => x.id).join(",")}`).join("|");

const crest = (team) => {
    const src = team.image && /^https?:\/\//.test(team.image)
        ? (team.image.includes("cloudfront.net") ? `${team.image}?w=96&h=96&fit=max` : team.image)
        : "";
    const inner = src
        ? `<img src="${esc(src)}" alt="${esc(team.name)}" width="40" height="40" class="w-full h-full object-contain" loading="lazy" decoding="async" />`
        : `<span class="text-[10px] font-black text-white/50">${esc(team.name?.charAt(0) || "?")}</span>`;
    return `<div class="w-10 h-10 shrink-0 bg-white/5 rounded-full p-1.5 border border-white/10 group-hover:border-[#DF0912]/40 transition-colors duration-300 flex items-center justify-center">${inner}</div>`;
};

const statusBadge = (game, isPt, now) => {
    if (game.start && now >= game.start && now <= game.end) {
        return `<div class="flex items-center gap-1.5 bg-[#DF0912] px-2 py-1"><span class="relative flex h-1.5 w-1.5"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span><span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span></span><span class="text-[9px] font-black text-white uppercase tracking-wider italic">${isPt ? "AO VIVO" : "LIVE"}</span></div>`;
    }
    if (game.start && now < game.start) {
        const diffMin = Math.ceil((game.start - now) / 60);
        const label = diffMin > 60
            ? `${isPt ? "ÀS" : "AT"} ${timeLabel(game.start)}`
            : `${isPt ? "EM" : "IN"} ${diffMin}MIN`;
        return `<div class="flex items-center gap-1.5 bg-[#FFCC00] px-2 py-1"><span class="text-[9px] font-black text-black uppercase tracking-wider italic">${label}</span></div>`;
    }
    return `<div class="flex items-center gap-1.5 bg-[#FFCC00] px-2 py-1"><span class="text-[9px] font-black text-black uppercase tracking-wider italic">${isPt ? "EM BREVE" : "SOON"}</span></div>`;
};

const teamCol = (team) =>
    `<div class="flex flex-col items-center gap-1.5 flex-1 min-w-0">${crest(team)}<span class="text-[11px] font-bold text-white uppercase tracking-tight text-center truncate max-w-full">${esc(team.name)}</span></div>`;

const cardHtml = (game, { isPt, langPrefix, isVip, now }) => {
    const vip = isVip(game);
    const vipBadge = vip
        ? `<div class="absolute bottom-2 right-2 z-20"><svg class="w-3.5 h-3.5 text-[#DF0912]" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div>`
        : "";
    return `<a href="${esc(langPrefix)}/canal/${esc(game.slug)}" data-is-vip="${vip}" data-canal-id="${esc(game.canalId)}" data-game-end="${game.end || ""}" class="bf-live-card group relative flex flex-col gap-3 shrink-0 snap-start w-[250px] sm:w-[calc(25%-9px)] sm:min-w-[230px] bg-[#0E111A] border border-white/5 hover:border-[#DF0912]/50 p-3 transition-all duration-300 hover:-translate-y-0.5">
        <div class="flex items-center justify-between gap-2">${statusBadge(game, isPt, now)}<span class="text-[8px] font-black text-white/60 uppercase tracking-wider truncate">${esc(game.league)}</span></div>
        ${game.away.name
            ? `<div class="flex items-center justify-between gap-2">${teamCol(game.home)}<span class="text-lg font-black text-[#DF0912] italic">VS</span>${teamCol(game.away)}</div>`
            : `<div class="flex items-center min-h-[62px]"><span class="text-sm font-black text-white uppercase tracking-tight line-clamp-2">${esc(game.title)}</span></div>`}
        ${vipBadge}
    </a>`;
};

export function renderGroupsHtml(groups, { isPt, langPrefix = "", isVip = () => false, now = Math.floor(Date.now() / 1000) }) {
    return groups
        .map((group) => {
            const name = isPt ? group.meta.pt : group.meta.en;
            const cards = group.games.map((g) => cardHtml(g, { isPt, langPrefix, isVip, now })).join("");
            return `<div class="bf-sport-group" data-sport="${esc(group.slug)}">
                <h3 class="flex items-center gap-2 mb-2 text-[11px] font-black uppercase tracking-[0.25em] text-white/60"><span>${group.meta.icon}</span>${esc(name)}</h3>
                <div class="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">${cards}</div>
            </div>`;
        })
        .join("");
}
