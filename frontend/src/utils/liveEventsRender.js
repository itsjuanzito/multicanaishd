// src/utils/liveEventsRender.js
// HTML dos cards de eventos ao vivo da home. Usado pelo SSR (set:html) e pela
// recuperação no cliente, para os dois nunca divergirem.

const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// starts_at vem do D1 como "YYYY-MM-DD HH:MM:SS" (UTC, sem zona) ou ISO.
export const eventStartMs = (startsAt) => {
    if (!startsAt) return 0;
    const raw = String(startsAt).trim().replace(" ", "T");
    const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`).getTime();
    return Number.isFinite(t) ? t : 0;
};

const timeLabel = (ms) =>
    new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" });

const badge = (startMs, isPt, now) => {
    if (!startMs || now >= startMs) {
        return `<div class="flex items-center gap-1.5 bg-[#DF0912] px-2 py-1"><span class="relative flex h-1.5 w-1.5"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span><span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span></span><span class="text-[9px] font-black text-white uppercase tracking-wider italic">${isPt ? "AO VIVO" : "LIVE"}</span></div>`;
    }
    const diffMin = Math.ceil((startMs - now) / 60000);
    const label = diffMin > 60 ? `${isPt ? "ÀS" : "AT"} ${timeLabel(startMs)}` : `${isPt ? "EM" : "IN"} ${diffMin}MIN`;
    return `<div class="flex items-center gap-1.5 bg-[#FFCC00] px-2 py-1"><span class="text-[9px] font-black text-black uppercase tracking-wider italic">${label}</span></div>`;
};

const isUrl = (u) => typeof u === "string" && /^https?:\/\//.test(u);

const circle = (src, title) =>
    `<div class="w-12 h-12 shrink-0 bg-white/5 rounded-full overflow-hidden border border-white/10 group-hover:border-[#DF0912]/40 transition-colors duration-300 flex items-center justify-center">${
        isUrl(src)
            ? `<img src="${esc(src)}" alt="${esc(title)}" width="48" height="48" class="w-full h-full object-cover object-top" loading="lazy" decoding="async" />`
            : `<span class="text-[10px] font-black text-white/50">${esc(title?.charAt(0) || "?")}</span>`
    }</div>`;

const cardHtml = (event, { isPt, langPrefix, now }) => {
    const startMs = eventStartMs(event.starts_at);
    const versus = isUrl(event.image1_url) && isUrl(event.image2_url);
    const body = versus
        ? `<div class="flex items-center justify-center gap-4">${circle(event.image1_url, event.title)}<span class="text-lg font-black text-[#DF0912] italic">VS</span>${circle(event.image2_url, event.title)}</div>
        <span class="text-[11px] font-bold text-white uppercase tracking-tight text-center line-clamp-2">${esc(event.title)}</span>`
        : `<div class="flex items-center gap-3 min-h-[48px]">${circle(event.image1_url || event.cover_url, event.title)}<span class="text-[11px] font-bold text-white uppercase tracking-tight line-clamp-2">${esc(event.title)}</span></div>`;
    return `<a href="${esc(langPrefix)}/evento/${esc(event.slug)}" data-event-start="${startMs || ""}" class="bf-event-card group relative flex flex-col gap-3 shrink-0 snap-start w-[250px] sm:w-[calc(25%-9px)] sm:min-w-[230px] bg-[#0E111A] border border-white/5 hover:border-[#DF0912]/50 p-3 transition-all duration-300 hover:-translate-y-0.5">
        <div class="flex items-center justify-between gap-2">${badge(startMs, isPt, now)}</div>
        ${body}
    </a>`;
};

export function renderEventsHtml(events, { isPt, langPrefix = "", now = Date.now() }) {
    const cards = (events || []).slice(0, 8).map((e) => cardHtml(e, { isPt, langPrefix, now })).join("");
    return `<div class="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">${cards}</div>`;
}
